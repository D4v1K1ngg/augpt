'use strict';

const { Evidencias } = require('./evidencias');

const ESTADOS = Object.freeze({
  INTERPRETANDO: 'interpretando',
  PLANEJANDO: 'planejando',
  EXECUTANDO: 'executando',
  VERIFICANDO: 'verificando',
  REPLANEJANDO: 'replanejando',
  AGUARDANDO_USUARIO: 'aguardando_usuario',
  CONCLUIDA: 'concluida',
  BLOQUEADA: 'bloqueada',
});

const TRANSICOES = {
  [ESTADOS.INTERPRETANDO]: new Set([ESTADOS.PLANEJANDO, ESTADOS.AGUARDANDO_USUARIO, ESTADOS.BLOQUEADA]),
  [ESTADOS.PLANEJANDO]: new Set([ESTADOS.EXECUTANDO, ESTADOS.REPLANEJANDO, ESTADOS.AGUARDANDO_USUARIO, ESTADOS.BLOQUEADA]),
  [ESTADOS.EXECUTANDO]: new Set([ESTADOS.VERIFICANDO, ESTADOS.REPLANEJANDO, ESTADOS.AGUARDANDO_USUARIO, ESTADOS.BLOQUEADA]),
  [ESTADOS.VERIFICANDO]: new Set([ESTADOS.EXECUTANDO, ESTADOS.REPLANEJANDO, ESTADOS.CONCLUIDA, ESTADOS.BLOQUEADA]),
  [ESTADOS.REPLANEJANDO]: new Set([ESTADOS.PLANEJANDO, ESTADOS.EXECUTANDO, ESTADOS.BLOQUEADA]),
  [ESTADOS.AGUARDANDO_USUARIO]: new Set([ESTADOS.EXECUTANDO, ESTADOS.PLANEJANDO, ESTADOS.BLOQUEADA]),
  [ESTADOS.CONCLUIDA]: new Set(),
  [ESTADOS.BLOQUEADA]: new Set(),
};

const limitarTexto = (valor, limite) => String(valor ?? '').trim().slice(0, limite);

/**
 * Item 3 do consenso com o Davi sobre o documento de arquitetura (2026-09-21,
 * "avaliar se um 'Context State' formal faz falta"): a resposta encontrada
 * foi não — `Tarefa` já FAZ esse papel (objetivo, hipóteses com confirmação,
 * checklist, evidências, ações, transições — tudo estruturado, não texto
 * livre) e já é injetada na decisão via `resumo()`. Auditando esta classe com
 * a mesma lente do bug do Item 1 (loop.js, compactação de histórico), achei
 * só um ponto correspondente: `evidencias`/`acoes`/`falhas`/`repeticoes`/
 * `criticas`/`transicoes`/`planos` já entram em `resumo()`/`serializar()`
 * com uma JANELA dos últimos N (não um corte cego por tamanho — é o mesmo
 * padrão bom que `paraEnvio()`/`RESULTADOS_INTEGRAIS` usam em loop.js), mas
 * `hipoteses` não tinha essa janela — numa tarefa com muitas hipóteses
 * acumuladas, o `.slice(0, limite)` final de `resumo()` (corte cego por
 * TAMANHO do JSON inteiro) podia truncar o objeto no meio, cortando os
 * campos que vêm depois (`verificacaoFinal`, `transicoes`) sem nenhum
 * critério. Mesma correção, mesmo lugar: janela dos últimos N, não corte
 * cego. `subtarefas` (o checklist) fica de fora de propósito — diferente de
 * hipótese ou ação, um item de checklist ainda PENDENTE não é "história
 * antiga que pode encolher", é trabalho que falta fazer.
 */
const LIMITE_HIPOTESES_NO_RESUMO = 12;

// Revisão v3 (03/10): o loop comparava o checklist SEM acento e esta chave
// COM acento — "Pesquisar opções de fones" ficava `feito` aqui e `pendente`
// no checklist (que vetava o responder). Uma chave só, usada pelos dois.
function normalizarSubtarefa(texto) {
  return limitarTexto(texto, 240)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const VAZIAS_DO_ITEM = new Set(['sobre', 'para', 'pelo', 'pela', 'como', 'qual', 'quais', 'entre', 'mais', 'site', 'pesquisar', 'buscar', 'procurar', 'verificar', 'analisar', 'encontrar', 'informacoes', 'informacao', 'dados', 'sobre', 'usando', 'fontes', 'oficial']);
const palavrasDoItem = (t) =>
  normalizarSubtarefa(t)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !VAZIAS_DO_ITEM.has(p));

/**
 * Qual item PENDENTE do checklist esta leitura atende (revisão v3): antes,
 * qualquer leitura marcava como feito o PRIMEIRO pendente, fosse qual fosse.
 * Agora o item precisa dividir palavras de assunto com a consulta/URL da
 * leitura (2+ palavras, ou metade das palavras do item). Nenhum casa → null
 * (não marca nada; o modelo segue o plano normalmente).
 */
function itemDaLeitura(checklist = [], alvo = '') {
  // raiz de 5 letras: "preço"/"preços", "fone"/"fones" (achado do revisor)
  const raiz = (p) => p.slice(0, 5);
  const doAlvo = new Set(palavrasDoItem(alvo).map(raiz));
  if (!doAlvo.size) return null;
  let melhor = null;
  let melhorN = 0;
  for (const item of checklist) {
    if (item?.status !== 'pendente') continue;
    const palavras = [...new Set(palavrasDoItem(item.texto).map(raiz))];
    if (!palavras.length) continue;
    const comuns = palavras.filter((p) => doAlvo.has(p)).length;
    if ((comuns >= 2 || comuns / palavras.length >= 0.5) && comuns > melhorN) {
      melhor = item;
      melhorN = comuns;
    }
  }
  return melhor;
}

const ACOES_DE_PAGINA = new Set(['clicar', 'preencher_campo', 'enviar_formulario', 'ver_pagina', 'voltar_pagina', 'rolar_pagina']);

function assinaturaDaAcao(nome, argumentos = {}) {
  return `${String(nome || '').trim()}|${JSON.stringify(argumentos || {})}`.slice(0, 1000);
}

class Tarefa {
  constructor(objetivo) {
    const original = limitarTexto(objetivo, 4000);
    this.objetivoOriginal = original;
    this.interpretacao = { ativa: original, alternativas: [], confianca: null };
    this.hipoteses = [];
    this.subtarefas = [];
    this.planos = [];
    this.criteriosSucesso = [];
    this.criteriosResultado = [];
    this.evidencias = [];
    // Etapa C (revisão v2, 2026-09-28): evidência ESTRUTURADA (produto,
    // tipo, valor, condições, fonte, trecho literal, id) — o motor de
    // pesquisa grava aqui; tabela, citações, ranking e verificação leem daqui.
    // `evidencias` acima continua sendo o registro em texto de sempre.
    this.livro = new Evidencias();
    this.acoes = [];
    this.falhas = [];
    this.repeticoes = [];
    this.acoesBloqueadas = [];
    this.criticas = [];
    this.lacunas = [];
    this.verificacaoFinal = null;
    this.estado = ESTADOS.INTERPRETANDO;
    this.transicoes = [{ de: null, para: this.estado, motivo: 'tarefa recebida' }];
  }

  interpretar({ ativa, alternativas = [], confianca = null } = {}) {
    if (ativa) this.interpretacao.ativa = limitarTexto(ativa, 4000);
    this.interpretacao.alternativas = alternativas
      .map((item) => limitarTexto(item, 1000))
      .filter(Boolean)
      .slice(0, 5);
    this.interpretacao.confianca = confianca ? limitarTexto(confianca, 40) : null;
    return this;
  }

  adicionarHipotese(texto, { confirmada = null } = {}) {
    const valor = limitarTexto(texto, 500);
    if (!valor || this.hipoteses.some((item) => item.texto === valor)) return this;
    this.hipoteses.push({ texto: valor, confirmada });
    return this;
  }

  definirSubtarefas(itens = []) {
    for (const item of itens) this.adicionarSubtarefa(item);
    return this;
  }

  registrarPlano(itens = [], { status = 'ativo', motivo = null } = {}) {
    const passos = itens.map((item) => limitarTexto(item?.texto || item, 240)).filter(Boolean).slice(0, 10);
    if (!passos.length) return this;
    this.planos.push({ numero: this.planos.length + 1, status, motivo: motivo ? limitarTexto(motivo, 600) : null, passos });
    return this;
  }

  marcarPlanoAnterior(status, motivo = '') {
    const plano = this.planos.at(-1);
    if (plano && plano.status === 'ativo') {
      plano.status = status;
      plano.motivo = limitarTexto(motivo, 600) || plano.motivo;
    }
    if (status === 'insuficiente') {
      for (const acao of this.acoes) {
        // Controlador v2 (05/10): ação de PÁGINA ("clicar [3]") não vira
        // estratégia bloqueada — o mesmo número é outro elemento em outra
        // página; quem cuida de repetição nela é o guarda com a impressão
        // digital da página (loop.js, chaveDeRepeticao)
        // navegar também (2ª revisão): bloquear a URL do login impedia
        // recomeçar o fluxo depois de um replanejamento
        if (ACOES_DE_PAGINA.has(acao.nome) || acao.nome === 'navegar') continue;
        if (!this.acoesBloqueadas.includes(acao.assinatura)) this.acoesBloqueadas.push(acao.assinatura);
      }
    }
    return this;
  }

  adicionarSubtarefa(texto) {
    const valor = limitarTexto(texto, 240);
    const chave = normalizarSubtarefa(valor);
    if (!chave || this.subtarefas.some((item) => item.chave === chave)) return this;
    this.subtarefas.push({ id: `tarefa-${this.subtarefas.length + 1}`, chave, texto: valor, status: 'pendente' });
    return this;
  }

  atualizarSubtarefas(checklist = []) {
    for (const item of checklist) {
      if (!item?.texto) continue;
      this.adicionarSubtarefa(item.texto);
      const alvo = this.subtarefas.find((subtarefa) => subtarefa.chave === normalizarSubtarefa(item.texto));
      if (alvo && ['pendente', 'feito', 'pulado'].includes(item.status)) alvo.status = item.status;
    }
    return this;
  }

  marcarSubtarefaComEvidencia(texto) {
    const chave = normalizarSubtarefa(texto);
    const alvo = this.subtarefas.find((item) => item.chave === chave);
    if (alvo && alvo.status === 'pendente') alvo.status = 'feito';
    return this;
  }

  /**
   * Semeia o checklist retomado de uma execução ANTERIOR interrompida da
   * mesma conversa (pedido do Davi 2026-09-21, análise comparativa dos 5
   * projetos de referência, item 1 — o análogo do `research_plan.md` que o
   * web-ui/deep_research_agent.py grava e relê pra continuar depois de
   * reiniciar; ver `loop.js: run()`, parâmetro `tarefaAnterior`).
   *
   * Só repassa o CHECKLIST (`subtarefas`, com o status de cada item) — não
   * hipótese, evidência ou ação da execução anterior: aquelas podem não valer
   * mais pro objetivo deste turno (pode ser um pedido parecido mas não
   * idêntico), e reinjetar sem critério arrisca confundir o modelo com
   * contexto de um raciocínio que já não se aplica. O checklist é o único
   * pedaço que continua sendo "trabalho que falta fazer" de forma confiável
   * entre execuções — e reaproveita `atualizarSubtarefas()`, já testada,
   * sem duplicar a lógica de mesclagem.
   *
   * Sem efeito (e sem custo) quando não sobrou nenhuma subtarefa `pendente`
   * no anterior — o caso comum, de turnos que nunca chegam a usar checklist.
   */
  retomarDe(anterior) {
    const subtarefas = Array.isArray(anterior?.subtarefas) ? anterior.subtarefas : [];
    if (!subtarefas.some((item) => item?.status === 'pendente')) return this;
    this.atualizarSubtarefas(subtarefas);
    return this;
  }

  definirCriterios(itens = []) {
    this.criteriosSucesso = itens.map((item) => limitarTexto(item, 300)).filter(Boolean).slice(0, 12);
    this.criteriosResultado = this.criteriosSucesso.map((texto) => ({ texto, atendido: null, motivo: null }));
    return this;
  }

  registrarAcao({ nome, argumentos = {}, resultado = '', erro = null, duracao = null, aprovada = null } = {}) {
    const acao = {
      indice: this.acoes.length + 1,
      nome: limitarTexto(nome, 120),
      argumentos: argumentos && typeof argumentos === 'object' ? argumentos : {},
      resultado: limitarTexto(resultado, 1000),
      erro: erro ? limitarTexto(erro, 500) : null,
      duracao,
      aprovada,
      assinatura: assinaturaDaAcao(nome, argumentos),
    };
    this.acoes.push(acao);
    if (erro) {
      this.falhas.push({ tipo: 'acao', acao: acao.indice, motivo: acao.erro });
      // "erro definitivo" = marca de tools/erros.js (404, 403, endereço bloqueado…)
      if (/não existe na pasta|arquivo.*não existe|nomes parecidos|caminho.*fora|informe "|erro definitivo:/i.test(acao.erro)) {
        if (!this.acoesBloqueadas.includes(acao.assinatura)) this.acoesBloqueadas.push(acao.assinatura);
      }
    }
    return acao;
  }

  registrarEvidencia({ origem, texto, subtarefa = null, url = null } = {}) {
    const evidencia = {
      origem: limitarTexto(origem, 240),
      texto: limitarTexto(texto, 1200),
      subtarefa: subtarefa ? normalizarSubtarefa(subtarefa) : null,
      url: url ? limitarTexto(url, 500) : null,
    };
    if (evidencia.texto) this.evidencias.push(evidencia);
    return evidencia;
  }

  registrarRepeticao({ nome, argumentos = {}, numero = 0, motivo = '' } = {}) {
    this.repeticoes.push({
      nome: limitarTexto(nome, 120),
      assinatura: assinaturaDaAcao(nome, argumentos),
      numero,
      motivo: limitarTexto(motivo, 300),
    });
    return this;
  }

  registrarVerificacao({ verificacao = null, cobertura = null, confianca = null } = {}) {
    this.verificacaoFinal = {
      respondeAoPedido: verificacao?.respondeAoPedido ?? null,
      aprovado: verificacao?.aprovado ?? null,
      totalSuspeitas: verificacao?.totalSuspeitas ?? null,
      cobertura: cobertura?.nivel || null,
      confianca: confianca?.nivel || confianca || null,
    };
    const atende = this.verificacaoFinal.respondeAoPedido === true &&
      this.verificacaoFinal.cobertura !== 'ausente' &&
      (this.verificacaoFinal.totalSuspeitas === null || this.verificacaoFinal.totalSuspeitas === 0);
    this.criteriosResultado = this.criteriosSucesso.map((texto) => ({
      texto,
      atendido: atende,
      motivo: atende ? 'verificação final compatível' : 'verificação final encontrou lacunas ou suspeitas',
    }));
    return this;
  }

  registrarCritica({ texto, fase = null, reorientacao = null } = {}) {
    const critica = {
      texto: limitarTexto(texto, 600),
      fase: fase ? limitarTexto(fase, 80) : null,
      reorientacao: reorientacao ? limitarTexto(reorientacao, 500) : null,
      status: null,
      subtarefa: null,
      evidenciaFaltante: null,
    };
    if (critica.texto) this.criticas.push(critica);
    return critica;
  }

  registrarRecomendacaoCritico({ texto, fase = null, recomendacao = null } = {}) {
    const critica = this.registrarCritica({ texto, fase, reorientacao: recomendacao?.proximaEstrategia });
    if (recomendacao) {
      critica.status = recomendacao.status;
      critica.subtarefa = recomendacao.subtarefa || null;
      critica.evidenciaFaltante = recomendacao.evidenciaFaltante || null;
    }
    return critica;
  }

  definirLacunas(lacunas = []) {
    this.lacunas = lacunas.map((item) => limitarTexto(item, 180)).filter(Boolean).slice(0, 20);
    return this;
  }

  transicionar(para, motivo = '') {
    if (!Object.values(ESTADOS).includes(para)) {
      throw new Error(`Estado de tarefa inválido: ${para}`);
    }
    if (para === this.estado) return this;
    if (!TRANSICOES[this.estado]?.has(para)) {
      throw new Error(`Transição de tarefa inválida: ${this.estado} -> ${para}`);
    }
    const anterior = this.estado;
    this.estado = para;
    this.transicoes.push({ de: anterior, para, motivo: limitarTexto(motivo, 300) });
    return this;
  }

  repetirAcao(nome, argumentos = {}) {
    const assinatura = assinaturaDaAcao(nome, argumentos);
    return this.acoes.filter((acao) => acao.assinatura === assinatura).length;
  }

  acaoBloqueada(nome, argumentos = {}) {
    return this.acoesBloqueadas.includes(assinaturaDaAcao(nome, argumentos));
  }

  resumo(limite = 5000, { incluirObjetivoOriginal = true } = {}) {
    const resumo = {
      ...(incluirObjetivoOriginal ? { objetivoOriginal: this.objetivoOriginal } : {}),
      interpretacao: this.interpretacao,
      hipoteses: this.hipoteses.slice(-LIMITE_HIPOTESES_NO_RESUMO),
      estado: this.estado,
      planos: this.planos.slice(-4),
      subtarefas: this.subtarefas,
      criteriosSucesso: this.criteriosSucesso,
      criteriosResultado: this.criteriosResultado,
      // O resumo vai para o modelo a cada rodada: não duplica o conteúdo bruto
      // já presente no histórico/dossiê.
      evidencias: this.evidencias.slice(-8).map(({ origem, subtarefa, url }) => ({ origem, subtarefa, url })),
      acoes: this.acoes.slice(-8).map(({ indice, nome, argumentos, erro, aprovada, assinatura }) => ({
        indice, nome, argumentos, erro, aprovada, assinatura,
      })),
      falhas: this.falhas.slice(-8),
      repeticoes: this.repeticoes.slice(-8),
      acoesBloqueadas: this.acoesBloqueadas.slice(-20),
      criticas: this.criticas.slice(-6),
      lacunas: this.lacunas,
      verificacaoFinal: this.verificacaoFinal,
      transicoes: this.transicoes.slice(-8),
    };
    return JSON.stringify(resumo).slice(0, limite);
  }

  serializar() {
    return {
      objetivoOriginal: this.objetivoOriginal,
      interpretacao: this.interpretacao,
      hipoteses: this.hipoteses.slice(-LIMITE_HIPOTESES_NO_RESUMO),
      estado: this.estado,
      planos: this.planos.slice(-4),
      subtarefas: this.subtarefas,
      criteriosSucesso: this.criteriosSucesso,
      criteriosResultado: this.criteriosResultado,
      evidencias: this.evidencias.slice(-8),
      acoes: this.acoes.slice(-8),
      falhas: this.falhas.slice(-8),
      repeticoes: this.repeticoes.slice(-8),
      acoesBloqueadas: this.acoesBloqueadas.slice(-20),
      criticas: this.criticas.slice(-6),
      lacunas: this.lacunas,
      verificacaoFinal: this.verificacaoFinal,
      transicoes: this.transicoes.slice(-8),
    };
  }
}

module.exports = { ESTADOS, Tarefa, assinaturaDaAcao, normalizarSubtarefa, itemDaLeitura };