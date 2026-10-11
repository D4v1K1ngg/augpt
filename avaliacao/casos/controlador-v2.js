'use strict';

/**
 * Controlador v2 (05/10/2026, execuções reais do contracheque, EPZ × Dunu,
 * táticas e fones). Um caso por item:
 *   1. guarda de repetição pela ação completa + página
 *   2. prompt de decisão cabe na janela
 *   3. status da tarefa separado de "concluido"
 *   4. progresso observável no navegador
 *   5. checklist marcado pela ação executada
 *   6. orçamento único de vetos; "perguntar" do crítico só com falta confirmada
 *   7. crítica por evento
 *   8. pergunta já respondida não se repete
 */

const { executarCasoAgente } = require('../motor');
const { caberNaJanela, chaveDeRepeticao, itemDaAcao, mesmaPergunta } = require('../../src/agent/loop');
const { statusDaTarefa } = require('../../src/registro');
const nav = require('../../src/tools/navegador');

// sessão de navegador falsa com estado: login → início → contracheque → emitido
function sessaoDoPortal() {
  const paginas = {
    login: { url: 'https://portal.exemplo/Interno', titulo: 'Login', elementos: ['[1] campo "Usuário"', '[2] campo "Senha"', '[3] botão "Entrar"'], texto: 'Acesso restrito.' },
    inicio: { url: 'https://portal.exemplo/Interno/inicio', titulo: 'Início', elementos: ['[1] link "Sair"', '[2] link "Contracheque"', '[3] link "Férias"'], texto: 'Bem-vindo.' },
    contracheque: { url: 'https://portal.exemplo/Interno/contracheque', titulo: 'Contracheque', elementos: ['[1] link "Início"', '[2] campo "Período"', '[3] botão "Emitir"'], texto: 'Folhas mensais.' },
    emitido: { url: 'https://portal.exemplo/Interno/contracheque/08-2026', titulo: 'Contracheque 08/2026', elementos: ['[1] link "Voltar"', '[2] botão "Download PDF"'], texto: 'Contracheque emitido.' },
  };
  let atual = 'login';
  const campos = {};
  const pagina = () => ({ ...paginas[atual], elementos: paginas[atual].elementos.map((e) => (campos[`${atual}:${e[1]}`] ? `${e} = "${campos[`${atual}:${e[1]}`]}"` : e)), truncado: false });
  return {
    acoes: [],
    async navegar() {
      atual = 'login';
      return pagina();
    },
    async ler() {
      return pagina();
    },
    async preencher(n, v) {
      this.acoes.push(`preencher:${atual}:${n}`);
      campos[`${atual}:${n}`] = n === 2 && atual === 'login' ? '' : v;
      return pagina();
    },
    async clicar(n) {
      this.acoes.push(`clicar:${atual}:${n}`);
      const proxima = { 'login:3': 'inicio', 'inicio:2': 'contracheque', 'contracheque:3': 'emitido' }[`${atual}:${Number(n)}`];
      if (proxima) atual = proxima;
      return pagina();
    },
  };
}

const PEDIDO_PORTAL = "acesse o portal 'https://portal.exemplo/Interno', entre com o usuário e a senha, vá em Contracheque e clique em Emitir";

module.exports = [
  {
    nome: 'controlador v2 (1): "clicar [3]" no login e "clicar [3]" no contracheque são ações diferentes; a mesma ação na mesma página é a mesma',
    tipo: 'unidade',
    executar() {
      const A = { impressao: 'aaa' };
      const B = { impressao: 'bbb' };
      return [
        chaveDeRepeticao('clicar', { numero: 3 }, A) !== chaveDeRepeticao('clicar', { numero: 3 }, B) || 'página diferente',
        chaveDeRepeticao('clicar', { numero: 3 }, A) === chaveDeRepeticao('clicar', { numero: '3' }, A) || 'mesmo clique (número como texto)',
        chaveDeRepeticao('preencher_campo', { numero: 1, valor: 'x' }, A) !== chaveDeRepeticao('preencher_campo', { numero: 1, valor: 'y' }, A) || 'valor diferente',
        chaveDeRepeticao('perguntar_usuario', { pergunta: 'a?' }) !== chaveDeRepeticao('perguntar_usuario', { pergunta: 'b?' }) || 'perguntas diferentes (antes: a 3ª pergunta qualquer era barrada)',
        chaveDeRepeticao('pesquisar_e_ler', { consulta: 'X', paginas: 3 }) === chaveDeRepeticao('pesquisar_e_ler', { consulta: 'x' }) || 'busca continua pela consulta',
      ];
    },
  },
  {
    nome: 'controlador v2 (1, 4, 5 — ponta a ponta, caso real do contracheque): login, Contracheque e Emitir passam sem "ação repetida"; o plano é marcado pela ação; a página diz o que mudou',
    tipo: 'unidade',
    async executar() {
      const sessao = sessaoDoPortal();
      const obtido = await executarCasoAgente({
        nome: 'v2 portal',
        pedido: PEDIDO_PORTAL,
        navegador: sessao,
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial: '- Acesse o portal\n- Clique em Contracheque\n- Clique em Emitir',
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://portal.exemplo/Interno' } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 1, valor: 'usuario' } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 2, valor: 'segredo' } },
          { ferramenta: 'clicar', argumentos: { numero: 3 } },
          { ferramenta: 'clicar', argumentos: { numero: 2 } },
          { ferramenta: 'clicar', argumentos: { numero: 3 } },
          { ferramenta: 'responder', argumentos: { foco: 'emitido' } },
        ],
        redacao: 'Contracheque emitido.',
        maxIterations: 12,
      });
      const gates = obtido.copiloto.map((c) => c.gate);
      return [
        !gates.includes('acao-repetida') || `ação repetida barrada: ${gates.join(', ')}`,
        sessao.acoes.join(' ') === 'preencher:login:1 preencher:login:2 clicar:login:3 clicar:inicio:2 clicar:contracheque:3' || sessao.acoes.join(' '),
        (obtido.checklist || []).filter((i) => i.status === 'feito').map((i) => i.texto).join(' | ') === 'Acesse o portal | Clique em Contracheque | Clique em Emitir' || JSON.stringify(obtido.checklist),
        obtido.ok || obtido.motivo,
        /MUDANÇA NA PÁGINA: sim/.test(obtido.promptDecisao) || 'mudança da página no prompt',
        obtido.registro.statusDaTarefa?.status === 'sucesso' || JSON.stringify(obtido.registro.statusDaTarefa) + ' :: ' + obtido.resposta.slice(0, 600),
      ];
    },
  },
  {
    nome: 'controlador v2 (1, 4): o mesmo clique numa página que não mudou é barrado já na 2ª vez; três ações sem mudar a página param o navegador',
    tipo: 'unidade',
    async executar() {
      const parada = {
        async navegar() {
          return { url: 'https://x.exemplo/', titulo: 'Igual', elementos: ['[1] botão "A"', '[2] botão "B"', '[3] botão "C"', '[4] botão "D"'], texto: 'nada muda', truncado: false };
        },
        async clicar() {
          return this.navegar();
        },
        async ler() {
          return this.navegar();
        },
      };
      const repetido = await executarCasoAgente({
        nome: 'v2 mesmo clique',
        pedido: 'abra https://x.exemplo/ e clique no botão A',
        navegador: parada,
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://x.exemplo/' } },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Não mudou.',
      });
      const semProgresso = await executarCasoAgente({
        nome: 'v2 sem progresso',
        pedido: 'abra https://x.exemplo/ e encontre o botão certo',
        navegador: parada,
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://x.exemplo/' } },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'clicar', argumentos: { numero: 2 } },
          { ferramenta: 'clicar', argumentos: { numero: 3 } },
          { ferramenta: 'clicar', argumentos: { numero: 4 } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Não achei.',
        maxIterations: 10,
      });
      const g1 = repetido.copiloto.map((c) => c.gate);
      const g2 = semProgresso.copiloto.map((c) => c.gate);
      return [
        g1.includes('acao-repetida') || `2º clique igual na mesma página: ${g1}`,
        /mesma página/.test(repetido.erros.join(' ')) || repetido.erros.join(' | '),
        /MUDANÇA NA PÁGINA: NENHUMA/.test(repetido.promptDecisao) || 'aviso de página igual no prompt',
        g2.includes('sem-progresso') || `três sem mudança: ${g2}`,
        /PROGRESSO \(aviso do sistema\)/.test(semProgresso.promptDecisao) || 'aviso depois de 2 sem mudança',
      ];
    },
  },
  {
    nome: 'controlador v2 (2): o prompt de decisão cabe na janela — corta memória, encurta histórico antigo, mantém as últimas mensagens',
    tipo: 'unidade',
    executar() {
      const historico = [{ role: 'user', content: 'Comece.' }];
      for (let i = 0; i < 30; i += 1) {
        historico.push({ role: 'assistant', content: `decisão ${i} ${'x'.repeat(400)}` });
        historico.push({ role: 'user', content: `RESULTADO ${i} ${'y'.repeat(2500)}` });
      }
      const volatil = ['SITUAÇÃO:\nplano', `MEMÓRIA RELEVANTE (de tarefas PASSADAS): ${'m'.repeat(3000)}`, `MODELO EXPLÍCITO DA TAREFA: ${'t'.repeat(3600)}`];
      const r = caberNaJanela({ sistema: 's'.repeat(17000), historico, volatil, numCtx: 9216, reserva: 600, razao: 2.8 });
      const chars = r.mensagens.reduce((n, m) => n + m.content.length, 0);
      const ultima = r.mensagens.filter((m) => m.role !== 'system').at(-1);
      const pequeno = caberNaJanela({ sistema: 'curto', historico: historico.slice(0, 3), volatil: ['SITUAÇÃO'], numCtx: 9216 });
      return [
        chars / 2.8 <= 9216 - 600 - 300 || `estimativa ${Math.round(chars / 2.8)} tokens`,
        r.cortes[0] === 'memoria' || `ordem dos cortes: ${r.cortes}`,
        !r.mensagens.some((m) => /MEMÓRIA RELEVANTE/.test(m.content)) || 'memória saiu primeiro',
        /RESULTADO 29/.test(ultima.content) || 'a última mensagem fica',
        r.mensagens[1].content === 'Comece.' || 'a primeira mensagem fica',
        pequeno.cortes.length === 0 || 'prompt pequeno não é mexido',
      ];
    },
  },
  {
    nome: 'controlador v2 (3): status da tarefa — "concluido" que diz "não encontrei" é parcial; plano incompleto é parcial; sem resposta é falha',
    tipo: 'unidade',
    executar() {
      return [
        statusDaTarefa({ resultado: 'concluido', resposta: 'Pronto: o PDF foi baixado.', checklist: [{ texto: 'a', status: 'feito' }] }).status === 'sucesso' || 'sucesso',
        statusDaTarefa({ resultado: 'concluido', resposta: 'Fiz o login, mas não encontrei a opção Contracheque.', checklist: [] }).status === 'parcial' || 'resposta admite falha',
        statusDaTarefa({ resultado: 'concluido', resposta: 'Ok.', checklist: [{ texto: 'Clique em Emitir', status: 'pendente' }, { texto: 'Responder ao usuário', status: 'pendente' }] }).motivos[0] === '1 item(ns) do plano não feito(s)' || 'item de entrega final não conta',
        statusDaTarefa({ resultado: 'limite', resposta: null }).status === 'falha' || 'sem resposta',
        statusDaTarefa({ resultado: 'interrompido' }).status === 'interrompido' || 'interrompido',
      ];
    },
  },
  {
    nome: 'controlador v2 (5): item do plano casado pelo rótulo do elemento clicado ou pelo site aberto',
    tipo: 'unidade',
    executar() {
      const ck = [
        { texto: 'Acesse o site portal.exemplo', status: 'pendente' },
        { texto: 'Clique em contracheque na página inicial', status: 'pendente' },
        { texto: 'Clique em emitir', status: 'pendente' },
      ];
      return [
        itemDaAcao(ck, { nome: 'clicar', rotulo: 'Contracheque' })?.texto === ck[1].texto || 'rótulo',
        itemDaAcao(ck, { nome: 'navegar', url: 'https://www.portal.exemplo/Interno' })?.texto === ck[0].texto || 'site',
        itemDaAcao(ck, { nome: 'clicar', rotulo: 'Sair' }) === null || 'elemento sem item',
        nav.rotuloDoElemento({ elementos: ['[1] link "Sair"', '[2] link "Contracheque"'] }, 2) === 'Contracheque' || 'rótulo do elemento',
      ];
    },
  },
  {
    nome: 'controlador v2 (6): orçamento único — checklist pendente e crítico bloqueando somam no máximo 2 vetos ao responder',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v2 orcamento de vetos',
        pedido: 'O que é NP-completo? O que é thrashing? Como funciona o Paxos?',
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial: '- Responder o que é NP-completo\n- Responder o que é thrashing\n- Responder como funciona o Paxos',
        criticaAutomatica: '{"status":"bloquear","problema":"material insuficiente"}',
        roteiro: Array.from({ length: 6 }, () => ({
          ferramenta: 'responder',
          argumentos: { foco: 'insistindo' },
          plano: ['Responder o que é NP-completo', 'Responder o que é thrashing', 'Responder como funciona o Paxos'],
        })),
        redacao: 'Resposta.',
      });
      const vetos = obtido.copiloto.filter((c) => ['checklist-pendente', 'tarefa-bloqueada', 'tarefa-aguardando_usuario', 'material-insuficiente'].includes(c.gate));
      return [vetos.length <= 2 || `vetos: ${vetos.map((v) => v.gate)}`, obtido.ok || obtido.motivo];
    },
  },
  {
    nome: 'controlador v2 (6): "perguntar" da crítica periódica sem falta confirmada no início não põe a tarefa esperando o usuário',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v2 perguntar sem falta',
        pedido: 'Leia base.txt e resuma',
        arquivos: { 'base.txt': 'Conteúdo do arquivo com 2 números: 10 e 20.' },
        config: { criticaPeriodica: true },
        criticaDoPlano: '{"status":"perguntar","problema":"A falta de informação que somente o usuário pode fornecer é ambígua"}',
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt', inicio: 1 } },
          { ferramenta: 'responder', argumentos: { foco: 'resumo' } },
        ],
        redacao: 'Resumo: 10 e 20.',
      });
      const gates = obtido.copiloto.map((c) => c.gate);
      return [
        obtido.chamadasCriticaPlano >= 1 || 'a crítica rodou',
        !gates.includes('tarefa-aguardando_usuario') || `vetou: ${gates}`,
        !obtido.perguntouAoUsuario || 'perguntou ao usuário',
        obtido.ok || obtido.motivo,
      ];
    },
  },
  {
    nome: 'controlador v2 (7): crítica por evento — sem nada errado não roda; depois de um erro de ferramenta roda',
    tipo: 'unidade',
    async executar() {
      const base = {
        pedido: 'Leia base.txt e resuma',
        arquivos: { 'base.txt': 'Conteúdo com 2 números: 10 e 20.' },
        redacao: 'Resumo.',
      };
      const calmo = await executarCasoAgente({
        ...base,
        nome: 'v2 evento calmo',
        config: { criticaPeriodica: true, criticaPeriodicaModo: 'evento' },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
          { ferramenta: 'responder', argumentos: { foco: 'resumo' } },
        ],
      });
      const comErro = await executarCasoAgente({
        ...base,
        nome: 'v2 evento erro',
        config: { criticaPeriodica: true, criticaPeriodicaModo: 'evento' },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nao-existe.txt' } },
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'resumo' } },
        ],
      });
      const frequencia = await executarCasoAgente({
        ...base,
        nome: 'v2 frequencia',
        config: { criticaPeriodica: true },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
          { ferramenta: 'responder', argumentos: { foco: 'resumo' } },
        ],
      });
      return [
        calmo.chamadasCriticaPlano === 0 || `sem evento rodou ${calmo.chamadasCriticaPlano}x`,
        comErro.chamadasCriticaPlano === 1 || `com erro rodou ${comErro.chamadasCriticaPlano}x`,
        frequencia.chamadasCriticaPlano >= 1 || 'modo de sempre continua rodando',
        (comErro.registro.criticasPorEvento || [])[0]?.evento === 'erro-de-ferramenta' || JSON.stringify(comErro.registro.criticasPorEvento),
      ];
    },
  },
  {
    nome: 'controlador v2 (8): pergunta já respondida não se repete — o agente recebe a resposta que já tem',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v2 pergunta repetida',
        pedido: 'Leia base.txt e me diga o que fazer',
        arquivos: { 'base.txt': 'Instruções com 3 passos.' },
        respostaDoUsuario: 'sim, está correta',
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'A senha informada está correta?' } },
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'A senha está correta? Verifique e informe.' } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Ok.',
      });
      const gates = obtido.copiloto.map((c) => c.gate);
      return [
        mesmaPergunta('A senha informada está correta?', 'A senha está correta? Verifique e informe.') || 'mesma pergunta',
        !mesmaPergunta('Qual período você quer?', 'A senha está correta?') || 'perguntas diferentes',
        gates.includes('pergunta-repetida') || `gates: ${gates}`,
        /sim, está correta/.test(obtido.promptDecisao) || 'a resposta já dada volta pro agente',
        (obtido.registro.dialogos || []).length === 1 || `perguntas feitas: ${(obtido.registro.dialogos || []).length}`,
      ];
    },
  },
  {
    nome: 'controlador v2 (1): estratégia marcada como insuficiente não bloqueia "clicar [3]" para sempre (o mesmo número é outro elemento em outra página)',
    tipo: 'unidade',
    executar() {
      const { Tarefa } = require('../../src/agent/tarefa');
      const t = new Tarefa('x');
      t.registrarAcao({ nome: 'clicar', argumentos: { numero: 3 } });
      t.registrarAcao({ nome: 'pesquisar_e_ler', argumentos: { consulta: 'abc' } });
      t.marcarPlanoAnterior('insuficiente', 'teste');
      return [
        !t.acaoBloqueada('clicar', { numero: 3 }) || 'clique bloqueado como estratégia',
        t.acaoBloqueada('pesquisar_e_ler', { consulta: 'abc' }) || 'busca continua bloqueada como estratégia',
      ];
    },
  },
];
