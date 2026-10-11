'use strict';

/**
 * Afirmação → evidência (Etapa I da revisão v2, 2026-09-28; ideia da análise
 * do ChatGPT: "número certo no contexto errado").
 *
 * O verificador de sempre procura o NÚMERO no material: "113" está lá, então
 * "a RTX 5080 faz 113 FPS em 1440p" passava — mesmo que 113 fosse o FPS em
 * 4K. Aqui cada afirmação numérica da resposta (FPS, %, preço em R$) vira
 * {produto, valor, unidade, resolução, jogo} e é conferida contra o livro de
 * evidências (evidencias.js): mesmo produto, mesmo valor (com tolerância de
 * arredondamento) E a mesma condição quando a afirmação diz uma.
 *
 *   sustentada      — há evidência com produto, valor e condição
 *   contexto-errado — o valor existe, mas de outra condição (resolução, jogo)
 *                     ou de outro produto
 *   sem-evidencia   — nenhuma evidência com esse valor
 *
 * `extras` traz os valores CALCULADOS pelo código (mediana por resolução),
 * que também são respaldo: {valor, unidade, resolucao, produto}.
 */

const semAcento = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const RESOLUCAO = [
  [/\b(4k|2160p|uhd)\b/, '4K'],
  [/\b(1440p|qhd|2k)\b/, '1440p'],
  [/\b(1080p|full hd|fhd)\b/, '1080p'],
];
function resolucaoDe(t) {
  const n = semAcento(t);
  for (const [re, r] of RESOLUCAO) if (re.test(n)) return r;
  return null;
}

const paraNumero = (s) => Number(String(s).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
const perto = (a, b) => Math.abs(a - b) <= Math.max(0.15, Math.abs(b) * 0.01);

/** Produtos que o livro conhece (nomes + a parte com número, "5080"). */
function produtosDoLivro(livro) {
  const nomes = new Set();
  for (const e of livro?.itens || []) for (const n of [e.produto, e.produtoA, e.produtoB]) if (n) nomes.add(n);
  return [...nomes].map((nome) => {
    const numero = (semAcento(nome).match(/\d{3,5}/) || [])[0];
    const sufixo = /\bti\b/i.test(nome) ? '\\s?ti' : '(?!\\s?(ti|super)\\b)';
    const re = numero ? new RegExp(`\\b${numero}${sufixo}`, 'i') : new RegExp(`\\b${semAcento(nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return { nome, re };
  });
}

/**
 * Afirmações numéricas da resposta: frase com número + unidade (fps, %, R$)
 * e um produto conhecido. Linha de tabela fica de fora (é montada pelo código).
 */
function extrairAfirmacoes(texto, produtos) {
  const saida = [];
  const frases = String(texto || '')
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l))
    .join('\n')
    .split(/(?<=[.!?])\s+|\n+/);
  for (const frase of frases) {
    const n = semAcento(frase);
    const mencoes = produtos.filter((p) => p.re.test(n));
    if (!mencoes.length) continue;
    const re = /(r\$\s?)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(fps|%|reais)?/gi;
    let m;
    while ((m = re.exec(n))) {
      const unidade = m[1] || m[3] === 'reais' ? 'BRL' : m[3] === 'fps' ? 'fps' : m[3] === '%' ? '%' : null;
      if (!unidade) continue;
      // produto da afirmação: o citado mais perto ANTES do número
      let dono = null;
      let melhor = -1;
      for (const p of mencoes) {
        const g = new RegExp(p.re.source, 'gi');
        let x;
        while ((x = g.exec(n))) if (x.index < m.index && x.index > melhor) {
          melhor = x.index;
          dono = p.nome;
        }
      }
      saida.push({
        afirmacao: frase.trim().slice(0, 240),
        produto: dono || mencoes[0].nome,
        valor: paraNumero(m[2]),
        unidade,
        resolucao: resolucaoDe(frase),
      });
    }
  }
  return saida;
}

/** Confere uma afirmação no livro (e nos valores calculados). */
function conferir(a, livro, extras = []) {
  const itens = livro?.itens || [];
  const candidatos = [];
  for (const e of itens) {
    if (a.unidade === 'fps' && e.tipo === 'benchmark' && e.unidade === 'fps') {
      if (e.produtoA === a.produto && perto(a.valor, e.valor)) candidatos.push({ e, cond: e.condicoes?.resolucao, doProduto: true });
      if (e.produtoB === a.produto && e.valorB != null && perto(a.valor, e.valorB)) candidatos.push({ e, cond: e.condicoes?.resolucao, doProduto: true });
      if ((e.produtoA !== a.produto && perto(a.valor, e.valor)) || (e.produtoB !== a.produto && e.valorB != null && perto(a.valor, e.valorB))) candidatos.push({ e, cond: e.condicoes?.resolucao, doProduto: false });
    }
    if (a.unidade === '%' && e.tipo === 'benchmark' && e.condicoes?.percentual != null && perto(Math.abs(a.valor), Math.abs(e.condicoes.percentual))) {
      candidatos.push({ e, cond: e.condicoes?.resolucao, doProduto: true });
    }
    if (a.unidade === 'BRL' && e.tipo === 'preco' && perto(a.valor, e.valor)) candidatos.push({ e, cond: null, doProduto: e.produto === a.produto });
  }
  for (const x of extras) {
    if (x.unidade === a.unidade && perto(Math.abs(a.valor), Math.abs(x.valor))) candidatos.push({ e: { id: 'calculado', trecho: x.rotulo || 'calculado pelo código' }, cond: x.resolucao || null, doProduto: !x.produto || x.produto === a.produto || a.unidade === '%' });
  }
  if (!candidatos.length) return { ...a, status: 'sem-evidencia', evidencia: null };
  const certo = candidatos.find((c) => c.doProduto && (!a.resolucao || !c.cond || c.cond === a.resolucao));
  if (certo) return { ...a, status: 'sustentada', evidencia: certo.e.id };
  const c = candidatos[0];
  const motivo = !c.doProduto ? `o valor é de outro produto` : `o valor é de ${c.cond || 'outra condição'}, não de ${a.resolucao}`;
  return { ...a, status: 'contexto-errado', evidencia: c.e.id, motivo };
}

/**
 * Todas as afirmações numéricas da resposta, conferidas. Sem livro com
 * evidência numérica, devolve [] (nada a conferir).
 */
function verificarAfirmacoes(texto, livro, extras = []) {
  const numericas = (livro?.itens || []).some((e) => ['benchmark', 'preco'].includes(e.tipo));
  if (!numericas && !extras.length) return [];
  const produtos = produtosDoLivro(livro);
  if (!produtos.length) return [];
  return extrairAfirmacoes(texto, produtos).map((a) => conferir(a, livro, extras));
}

/** Valores calculados pelo código na comparação de desempenho (medianas, preço). */
function extrasDoDesempenho(agregado) {
  const x = [];
  for (const [res, r] of Object.entries(agregado?.porResolucao || {})) {
    if (!r) continue;
    for (const v of [r.mediana, r.min, r.max]) x.push({ valor: v, unidade: '%', resolucao: res === 'geral' ? null : res, rotulo: `mediana/faixa ${res}` });
  }
  if (agregado?.sinteticos) x.push({ valor: agregado.sinteticos.mediana, unidade: '%', rotulo: 'teste sintético' });
  return x;
}

module.exports = { verificarAfirmacoes, extrairAfirmacoes, conferir, produtosDoLivro, extrasDoDesempenho, resolucaoDe };
