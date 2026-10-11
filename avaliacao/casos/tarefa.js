'use strict';

const assert = require('assert');
const { ESTADOS, Tarefa } = require('../../src/agent/tarefa');
const { Agent, extrairRecomendacaoCritico } = require('../../src/agent/loop');

module.exports = [
  {
    nome: 'modelo explícito de tarefa preserva objetivo, evidências e transições',
    tipo: 'unidade',
    executar() {
      const tarefa = new Tarefa('Fazer de novo aquilo para o outro arquivo');
      tarefa.interpretar({ ativa: 'Ler o arquivo atual', alternativas: ['Ler o arquivo anterior'], confianca: 'alta' });
      tarefa.definirSubtarefas(['Ler o arquivo atual', 'Responder ao usuário']);
      tarefa.definirCriterios(['Arquivo lido', 'Resposta verificada']);
      tarefa.registrarPlano(['Ler o arquivo atual', 'Responder ao usuário']);
      tarefa.transicionar(ESTADOS.PLANEJANDO, 'interpretação concluída');
      tarefa.transicionar(ESTADOS.EXECUTANDO, 'plano criado');
      tarefa.registrarAcao({ nome: 'ler_arquivo', argumentos: { caminho: 'atual.txt' }, resultado: 'conteúdo' });
      tarefa.registrarEvidencia({ origem: 'ler_arquivo', texto: 'conteúdo do arquivo atual', subtarefa: 'Ler o arquivo atual' });
      tarefa.registrarCritica({ fase: 'plano', texto: 'o arquivo atual é o alvo correto' });
      tarefa.registrarRepeticao({ nome: 'ler_arquivo', argumentos: { caminho: 'atual.txt' }, numero: 3, motivo: 'mesma ação sem novo resultado' });
      tarefa.marcarPlanoAnterior('insuficiente', 'arquivo não continha a evidência esperada');
      tarefa.registrarPlano(['Buscar fonte alternativa', 'Responder ao usuário'], { motivo: 'arquivo não continha a evidência esperada' });
      tarefa.registrarVerificacao({ verificacao: { respondeAoPedido: true, aprovado: true, totalSuspeitas: 0 }, cobertura: { nivel: 'boa' }, confianca: { nivel: 'alta' } });

      const operacional = JSON.parse(tarefa.resumo(4000, { incluirObjetivoOriginal: false }));
      const completo = tarefa.serializar();
      const recomendacao = extrairRecomendacaoCritico(
        '{"status":"replanejar","problema":"A fonte está fora do assunto","subtarefa":"Ler o arquivo atual","evidenciaFaltante":"conteúdo relevante","proximaEstrategia":"usar outra fonte"}'
      );
      const agente = new Agent({ config: {} });
      agente.tarefa = new Tarefa('Pesquisar um assunto');
      agente.tarefa.transicionar(ESTADOS.PLANEJANDO, 'interpretação concluída');
      agente.tarefa.transicionar(ESTADOS.EXECUTANDO, 'plano criado');
      agente.iteracao = 1;
      agente.replanejamentosFeitos = 0;
      agente.replanejamentoPendente = null;
      agente.replanejamentoChaves = new Set();
      agente.replanejamentoCooldownAte = 0;
      const perguntarNoEntendimento = { status: 'perguntar', problema: 'falta o plano', proximaEstrategia: '' };
      agente.aplicarRecomendacaoCritico(perguntarNoEntendimento, 'entendimento');
      const replanejar = { status: 'replanejar', problema: 'fonte irrelevante', proximaEstrategia: 'usar fonte oficial' };
      agente.aplicarRecomendacaoCritico(replanejar, 'plano');
      agente.aplicarRecomendacaoCritico(replanejar, 'plano');

      return [
        completo.objetivoOriginal === 'Fazer de novo aquilo para o outro arquivo' || 'objetivo original foi perdido',
        completo.interpretacao.ativa === 'Ler o arquivo atual' || 'interpretação ativa ausente',
        operacional.objetivoOriginal === undefined || 'objetivo bruto contaminou o contexto operacional',
        operacional.subtarefas.length === 2 || 'subtarefas não foram registradas',
        operacional.evidencias.length === 1 || 'evidência não foi registrada',
        operacional.criticas.length === 1 || 'crítica não foi registrada',
        operacional.repeticoes.length === 1 || 'repetição não foi registrada',
        completo.planos.length === 2 || 'histórico de planos não foi preservado',
        completo.planos[0].status === 'insuficiente' || 'plano anterior não foi marcado como insuficiente',
        tarefa.acaoBloqueada('ler_arquivo', { caminho: 'atual.txt' }) || 'estratégia anterior não bloqueou repetição',
        operacional.verificacaoFinal.cobertura === 'boa' || 'verificação final não foi registrada',
        operacional.criteriosResultado.every((item) => item.atendido === true) || 'critérios não foram avaliados',
        completo.estado === ESTADOS.EXECUTANDO || 'estado atual incorreto',
        tarefa.repetirAcao('ler_arquivo', { caminho: 'atual.txt' }) === 1 || 'assinatura de ação não foi preservada',
        recomendacao?.status === 'replanejar' || 'status estruturado não foi reconhecido',
        recomendacao?.evidenciaFaltante === 'conteúdo relevante' || 'evidência faltante não foi reconhecida',
        agente.tarefa.estado === ESTADOS.REPLANEJANDO || 'replanejamento não foi agendado',
        agente.replanejamentoChaves.size === 1 || 'diagnóstico repetido agendou mais de um replanejamento',
        assert.throws(() => tarefa.transicionar(ESTADOS.CONCLUIDA), /Transição de tarefa inválida/) || true,
      ];
    },
  },

  {
    // Item 3 do consenso com o Davi sobre o documento de arquitetura
    // (2026-09-21): auditando `Tarefa` com a mesma lente do bug do Item 1
    // (loop.js), achei que `hipoteses` era o único campo acumulável sem
    // janela — diferente de evidências/ações/críticas/transições, que já
    // entram em resumo()/serializar() só com os últimos N. Numa tarefa com
    // muitas hipóteses, isso deixava o `.slice(0, limite)` final de
    // resumo() (corte cego por TAMANHO do JSON inteiro) truncar o objeto no
    // meio, arriscando cortar campos que vêm depois na ordem (ex.:
    // verificacaoFinal, transicoes) sem nenhum critério.
    nome: 'Tarefa.resumo()/serializar(): hipóteses acumuladas entram só com uma janela dos últimos N, mesmo padrão de evidências/ações/críticas',
    tipo: 'unidade',
    executar() {
      const tarefa = new Tarefa('Investigar um assunto com muitas hipóteses ao longo da execução');
      // mais hipóteses do que a janela (12) — cada texto único pra não cair no dedup de adicionarHipotese
      for (let n = 1; n <= 15; n += 1) {
        tarefa.adicionarHipotese(`Hipótese número ${n}`, { confirmada: n % 2 === 0 });
      }

      const operacional = JSON.parse(tarefa.resumo(4000, { incluirObjetivoOriginal: false }));
      const completo = tarefa.serializar();

      return [
        tarefa.hipoteses.length === 15 || 'a lista bruta interna deveria continuar com todas as 15 hipóteses (só a EXPORTAÇÃO janela)',
        operacional.hipoteses.length === 12 || `resumo() deveria expor só as últimas 12 hipóteses, expôs ${operacional.hipoteses.length}`,
        completo.hipoteses.length === 12 || `serializar() deveria expor só as últimas 12 hipóteses, expôs ${completo.hipoteses.length}`,
        operacional.hipoteses[0].texto === 'Hipótese número 4' || `esperava a janela começar na hipótese mais antiga ainda dentro do limite (nº 4), veio "${operacional.hipoteses[0]?.texto}"`,
        operacional.hipoteses.at(-1).texto === 'Hipótese número 15' || 'a hipótese mais RECENTE precisa estar na janela — é a que mais importa pra decisão atual',
      ];
    },
  },

  {
    // Análise comparativa 2026-09-21, item 1 ("persistir Tarefa por
    // conversa"): retomarDe() é o que faz o checklist salvo de uma execução
    // INTERROMPIDA voltar pra uma nova Tarefa (ver loop.js: run(),
    // parâmetro tarefaAnterior). Reaproveita atualizarSubtarefas(), já
    // testada — este caso cobre só o filtro de entrada (quando semeia,
    // quando não) e que status/ordem sobrevivem.
    nome: 'Tarefa.retomarDe(): semeia checklist pendente da execução anterior; concluída/vazia não tem efeito',
    tipo: 'unidade',
    executar() {
      const anteriorComPendente = new Tarefa('Investigar 5 páginas sobre X').serializar();
      anteriorComPendente.subtarefas = [
        { id: 'tarefa-1', chave: 'ler pagina 1', texto: 'Ler página 1', status: 'feito' },
        { id: 'tarefa-2', chave: 'ler pagina 2', texto: 'Ler página 2', status: 'pendente' },
        { id: 'tarefa-3', chave: 'ler pagina 3', texto: 'Ler página 3', status: 'pendente' },
      ];

      const nova = new Tarefa('Investigar 5 páginas sobre X').retomarDe(anteriorComPendente);
      const semNadaPendente = new Tarefa('Outro objetivo').retomarDe({
        subtarefas: [{ id: 'x', chave: 'a', texto: 'A', status: 'feito' }],
      });
      const semSubtarefas = new Tarefa('Objetivo qualquer').retomarDe({ subtarefas: [] });
      const semAnterior = new Tarefa('Objetivo qualquer').retomarDe(null);

      return [
        nova.subtarefas.length === 3 || `esperava o checklist inteiro (3 itens) retomado, veio ${nova.subtarefas.length}`,
        nova.subtarefas.filter((s) => s.status === 'pendente').length === 2 ||
          'os 2 itens pendentes da execução anterior precisam continuar pendentes',
        nova.subtarefas.find((s) => s.texto === 'Ler página 1')?.status === 'feito' ||
          'o item já feito na execução anterior precisa continuar feito (não é pra reabrir trabalho concluído)',
        semNadaPendente.subtarefas.length === 0 ||
          'uma Tarefa anterior sem NENHUM item pendente (tudo feito) não deve semear nada — não há "trabalho que falta"',
        semSubtarefas.subtarefas.length === 0 || 'subtarefas vazia não deve lançar erro nem semear nada',
        semAnterior.subtarefas.length === 0 || 'tarefaAnterior null/undefined precisa ser no-op seguro',
      ];
    },
  },
];