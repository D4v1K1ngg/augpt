'use strict';

/**
 * A resposta nova é a mesma da vez anterior? (4/11, no app: "Qual o preço hoje dessa fonte?" abriu com o
 * mesmo parágrafo da resposta de antes, palavra por palavra, e repetiu o "não encontrei".) Compara as palavras
 * do texto, sem links, imagens e blocos: 90% ou mais em comum, nos dois sentidos, é a mesma resposta — só a
 * repetição de verdade; respostas parecidas (58% naquele caso) ficam. Resposta curta não conta.
 */
const palavras = (t) => String(t || '')
  .replace(/```[\s\S]*?```|!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)/g, ' ')
  .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

function mesmaResposta(anterior, nova) {
  const a = palavras(anterior);
  const b = palavras(nova);
  if (a.length < 40 || b.length < 40) return false;
  const conta = (lista) => lista.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const ca = conta(a);
  const cb = conta(b);
  let comum = 0;
  for (const [w, n] of cb) comum += Math.min(n, ca.get(w) || 0);
  return comum / b.length >= 0.9 && comum / a.length >= 0.9;
}

module.exports = { mesmaResposta };
