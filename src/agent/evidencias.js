'use strict';

/**
 * Livro de evidências (Evidence Store) — Etapa C da revisão v2 do plano de
 * pesquisa (2026-09-28; ideia trazida pela análise do ChatGPT que o Davi
 * pediu e ajustada aqui).
 *
 * O problema que resolve: o motor lia a evidência certa e a PERDIA no
 * caminho — página → texto → LLM → texto → regex → texto → LLM. No 14º
 * teste real, 11 tópicos do Reddit sobre IEM pra FPS foram lidos e nenhum
 * nome deles chegou à resposta; nas RTX, os números de FPS foram lidos e
 * nenhum chegou. Aqui cada coisa concreta que o material afirma vira um
 * OBJETO com ID, e as etapas seguintes (ranking, tabela, citações, resposta,
 * verificação) leem daqui em vez de reler texto.
 *
 * Tipos usados hoje:
 *   recomendacao | critica | mencao  — comentário da comunidade sobre um produto
 *   benchmark                        — número medido (FPS, %, etc.) com condições
 *   especificacao                    — dado de ficha (VRAM, TDP, driver...)
 *   uso-profissional                 — "jogador X usa o produto Y" (modo dado de uso)
 *   preco                            — preço com data e moeda
 *
 * O status de um produto × critério (corroborado, fonte única, contraditório)
 * é CALCULADO pelo código a partir das evidências — nunca "confiança 0,91"
 * dita pelo modelo.
 */

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9$%+]+/g, ' ')
    .trim();

/** Chave de fonte independente: tópico por URL (sem query), site por domínio. */
function chaveDeFonte(url) {
  const u = String(url || '');
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^www\./, '');
    // tópico de fórum/Reddit é uma conversa própria; página de site é o site
    if (/\/(comments|topic|threads|t)\//i.test(x.pathname)) return `${host}${x.pathname.replace(/\/$/, '')}`;
    return host;
  } catch {
    return u || 'fonte';
  }
}

// token que muda o MODELO ("ZSN Pro" × "ZSN Pro X", "Cloud II" × "Cloud II Wireless")
const TOKEN_DE_MODELO = /^(\d+\w*|x|s|se|pro|max|plus|ultra|mini|lite|ti|super|xt|xtx|gre|wireless|core|ii|iii|iv|v|mk\w*|gen\d*|rgb|air|neo|elite|nova)$/;
/**
 * Mesmo produto? Igual, ou um contido no outro quando a sobra é só MARCA
 * ("Hexa" × "Truthear Hexa") — nunca quando a sobra muda o modelo (achado do
 * revisor: a célula do "KZ ZSN Pro" pegava o veredito do "KZ ZSN Pro X").
 */
function mesmoProduto(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!curto.every((t) => longo.includes(t))) return false;
  const sobra = longo.filter((t) => !curto.includes(t));
  return sobra.length > 0 && sobra.every((t) => !TOKEN_DE_MODELO.test(t) && t.length >= 3);
}

const STATUS = {
  CORROBORADO: 'corroborado', // 2+ fontes independentes a favor
  FONTE_UNICA: 'fonte única',
  CONTRADITORIO: 'contraditório', // a favor e contra
  INDIRETO: 'indireto', // deduzido (ex.: fone com fio → sem atraso de transmissão)
  SEM_DADOS: 'sem dados',
  NAO_SE_APLICA: 'não se aplica',
};

class Evidencias {
  constructor() {
    this.itens = [];
    this.contador = 0;
    this.vistas = new Set();
  }

  /**
   * Registra uma evidência. Campos: tipo, produto (ou produtoA/produtoB),
   * criterio, valor, unidade, condicoes {}, url, fonte (rótulo curto, ex.
   * "r/iems"), trecho (literal da fonte), votos, tom, doUso, tecnico,
   * consulta. Duplicata (mesmo tipo, produto, fonte e trecho) é ignorada.
   * Devolve a evidência (com id) ou a já existente.
   */
  adicionar(ev = {}) {
    const chave = [ev.tipo, normalizar(ev.produto || `${ev.produtoA}|${ev.produtoB}`), chaveDeFonte(ev.url), normalizar(ev.trecho).slice(0, 160), JSON.stringify(ev.condicoes || {})].join('\u0000');
    if (this.vistas.has(chave)) return this.itens.find((i) => i.chave === chave) || null;
    this.vistas.add(chave);
    this.contador += 1;
    const item = {
      id: `E${String(this.contador).padStart(4, '0')}`,
      chave,
      tipo: ev.tipo || 'mencao',
      produto: ev.produto || null,
      produtoA: ev.produtoA || null,
      produtoB: ev.produtoB || null,
      criterio: ev.criterio || null,
      valor: ev.valor ?? null,
      valorB: ev.valorB ?? null,
      unidade: ev.unidade || null,
      condicoes: ev.condicoes || {},
      url: ev.url || '',
      fonte: ev.fonte || chaveDeFonte(ev.url),
      fonteChave: chaveDeFonte(ev.url),
      trecho: String(ev.trecho || '').slice(0, 400),
      votos: Number(ev.votos) || 0,
      tom: ev.tom || null,
      doUso: Boolean(ev.doUso),
      tecnico: Boolean(ev.tecnico),
      origem: ev.origem || null,
    };
    this.itens.push(item);
    return item;
  }

  /** Evidências de um produto (nome normalizado igual, ou contido nos dois sentidos). */
  doProduto(nome, tipo = null) {
    const n = normalizar(nome);
    if (!n) return [];
    return this.itens.filter((i) => {
      if (tipo && (Array.isArray(tipo) ? !tipo.includes(i.tipo) : i.tipo !== tipo)) return false;
      return mesmoProduto(normalizar(i.produto || ''), n);
    });
  }

  porTipo(tipo) {
    return this.itens.filter((i) => (Array.isArray(tipo) ? tipo.includes(i.tipo) : i.tipo === tipo));
  }

  porId(id) {
    return this.itens.find((i) => i.id === id) || null;
  }

  /** Produtos com evidência de um tipo, na ordem em que apareceram. */
  produtos(tipo = null) {
    const vistos = new Map();
    for (const i of this.itens) {
      if (!i.produto || (tipo && (Array.isArray(tipo) ? !tipo.includes(i.tipo) : i.tipo !== tipo))) continue;
      const n = normalizar(i.produto);
      if (!vistos.has(n)) vistos.set(n, i.produto);
    }
    return [...vistos.values()];
  }

  /**
   * O que a comunidade diz de um produto, contado por FONTE independente
   * (tópico), não por comentário: recomendações, críticas, fontes do uso,
   * comentários técnicos. É o que a resposta mostra — nunca uma "nota".
   */
  resumoDaComunidade(nome) {
    const ev = this.doProduto(nome, ['recomendacao', 'critica', 'mencao']);
    const fontes = (t) => new Set(ev.filter((e) => e.tipo === t).map((e) => e.fonteChave)).size;
    return {
      recomendacoes: fontes('recomendacao'),
      criticas: fontes('critica'),
      mencoes: fontes('mencao'),
      fontesDoUso: new Set(ev.filter((e) => e.tipo === 'recomendacao' && e.doUso).map((e) => e.fonteChave)).size,
      tecnicas: ev.filter((e) => e.tecnico && e.tipo !== 'mencao').length,
      votos: ev.filter((e) => e.tipo === 'recomendacao').reduce((s, e) => s + e.votos, 0),
    };
  }

  /**
   * Status de um produto num critério, a partir das evidências com
   * `criterio` (ou dos vereditos que o chamador passar): a favor em 2+
   * fontes independentes = corroborado; em 1 = fonte única; a favor e contra
   * = contraditório.
   */
  static status({ aFavor = [], contra = [], deduzido = false, aplica = true } = {}) {
    if (!aplica) return STATUS.NAO_SE_APLICA;
    const af = new Set(aFavor).size;
    const ct = new Set(contra).size;
    if (af && ct) return STATUS.CONTRADITORIO;
    if (af >= 2) return STATUS.CORROBORADO;
    if (af === 1) return STATUS.FONTE_UNICA;
    if (ct) return STATUS.CONTRADITORIO;
    if (deduzido) return STATUS.INDIRETO;
    return STATUS.SEM_DADOS;
  }

  /**
   * A célula produto × critério lida do livro (Etapa I: a matriz vira uma
   * VISÃO do livro, não a fonte da verdade). Junta as avaliações daquele
   * produto naquele critério: o veredito, o status e os IDs das evidências.
   * null quando o livro não tem avaliação dessa célula.
   */
  celula(produto, criterio) {
    const ev = this.doProduto(produto, 'avaliacao').filter((e) => normalizar(e.criterio) === normalizar(criterio));
    if (!ev.length) return null;
    return {
      veredito: ev[0].trecho,
      status: ev[0].valor || null,
      dominios: new Set(ev.map((e) => e.fonte).filter(Boolean)),
      ids: ev.map((e) => e.id),
    };
  }

  get tamanho() {
    return this.itens.length;
  }

  /** Pro registro de execução: tudo, sem a chave interna, com teto. */
  serializar(teto = 400) {
    return this.itens.slice(0, teto).map(({ chave, fonteChave, ...resto }) => resto); // eslint-disable-line no-unused-vars
  }
}

module.exports = { Evidencias, STATUS, chaveDeFonte, mesmoProduto, normalizarEvidencia: normalizar };
