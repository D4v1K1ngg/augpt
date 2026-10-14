'use strict';

/**
 * Checagens por código da qualidade de TEXTO das respostas de produto (14/10).
 * O juiz lê o conteúdo; isto mede o que ele não pega bem: frase-fórmula
 * repetida entre as opções, comentário colado no lugar de explicação e termo
 * técnico sem explicação. Usadas por avaliacao/qualidade/perguntas.js.
 */

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// frases que o próprio código escreve igual em todo cartão (rótulo fixo, não é redação)
const FRASE_DO_CODIGO = /^(ponto de atencao )?(sem evidencia sobre|o material lido nao trouxe|a critica abaixo)|^na comunidade recomendado em|^faixa de preco/;

/** Blocos "#### N. Nome" da resposta (os cartões). */
function cartoes(resposta) {
  return String(resposta || '')
    .split(/^#### \d+\. /m)
    .slice(1)
    .map((b) => b.split(/^### /m)[0]);
}

/** Trincas de palavras de uma frase (para comparar frases parecidas, não só iguais). */
function trincas(frase) {
  const p = normalizar(frase).split(' ');
  const s = new Set();
  for (let i = 0; i + 2 < p.length; i += 1) s.add(`${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  return s;
}
const semelhanca = (a, b) => {
  if (!a.size || !b.size) return 0;
  let comum = 0;
  for (const t of a) if (b.has(t)) comum += 1;
  return comum / Math.min(a.size, b.size);
};

/**
 * Frases (8+ palavras) que se repetem — iguais ou quase — em cartões
 * diferentes. Ignora o nome do produto (cada cartão tem o seu).
 */
function frasesRepetidas(resposta, { limite = 0.6 } = {}) {
  const blocos = cartoes(resposta).map((b) => {
    const nome = normalizar(b.split('\n')[0]);
    return String(b)
      .replace(/^>.*$/gm, '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map((f) => normalizar(f).replace(nome, ' '))
      .filter((f) => f.split(' ').length >= 8 && !FRASE_DO_CODIGO.test(f))
      .map((f) => ({ f, t: trincas(f) }));
  });
  const repetidas = [];
  for (let i = 0; i < blocos.length; i += 1)
    for (let j = i + 1; j < blocos.length; j += 1)
      for (const a of blocos[i]) for (const b of blocos[j]) if (semelhanca(a.t, b.t) >= limite) repetidas.push([a.f, b.f]);
  return repetidas;
}

/** Trecho entre aspas com 10+ palavras FORA das citações em bloco ("> ...") — comentário colado no meio do texto. */
function comentariosColados(resposta) {
  const corpo = String(resposta || '').replace(/^>.*$/gm, '');
  return (corpo.match(/["“][^"“”\n]{20,600}["”]/g) || []).filter((q) => q.split(/\s+/).length >= 10);
}

/** Explicações entre parênteses ("palco sonoro (a sensação de espaço…)"): 4+ palavras, não é número, fonte nem link. */
function termosExplicados(resposta) {
  // fora: citação em bloco, título, linha de tabela e link
  const corpo = String(resposta || '').replace(/^(>|#|\|).*$/gm, '').replace(/\]\([^)]*\)/g, ']');
  return (corpo.match(/\(([^()\n]{12,220})\)/g) || []).filter((p) => {
    const d = p.slice(1, -1);
    return d.split(/\s+/).length >= 4 && !/^\s*[\d.,%$R€ -]+/.test(d) && !/https?:|r\/\w|preços? nas páginas|mediana|tópicos? da comunidade|votos|tradução|^números? \d|não quer dizer|ordem de consenso/i.test(d);
  });
}

/** As checagens prontas para o gabarito. `minimoExplicados`: quantas explicações de termo a resposta precisa ter. */
function checagensDeTexto({ minimoExplicados = 2 } = {}) {
  return [
    { nome: 'nenhuma frase repetida entre as opções', ok: (r) => frasesRepetidas(r).length === 0 },
    { nome: 'nenhum comentário colado no meio do texto', ok: (r) => comentariosColados(r).length === 0 },
    { nome: `explica termos técnicos (${minimoExplicados}+ explicações entre parênteses)`, ok: (r) => termosExplicados(r).length >= minimoExplicados },
  ];
}

module.exports = { checagensDeTexto, frasesRepetidas, comentariosColados, termosExplicados, cartoes, normalizar };
