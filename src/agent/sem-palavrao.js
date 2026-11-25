'use strict';

/**
 * Palavrão de fórum na resposta (25/11, régua: o mouse sem fio saiu "uma opção de 'puta de uma melhora'" — o comentário
 * do Reddit, traduzido). A resposta fala como o AuGPT, não como o fórum: o intensificador vira "baita"/"demais", o resto
 * sai mascarado. Se o próprio usuário usou palavrão na pergunta, a resposta fica como está.
 */
const TROCAS = [
  [/\bputa de (?:uma?|uns|umas)\s+/gi, 'baita '],
  [/\b(uma?|uns|umas) puta\s+/gi, '$1 baita '],
  [/\b(?:pra|para) caralho\b/gi, 'demais'],
  [/\bdo caralho\b/gi, 'excelente'],
  [/\b(?:fucking|freaking)\s+/gi, ''],
];
const PALAVRAO = /\b(porra|caralho|merda|foda|fodido|fodida|foder|bosta|cacete|puta|fuck|shit)\b/gi;

function semPalavrao(texto, pergunta = '') {
  if (new RegExp(PALAVRAO.source, 'i').test(String(pergunta))) return texto;
  let saida = String(texto || '');
  for (const [re, por] of TROCAS) saida = saida.replace(re, por);
  return saida.replace(PALAVRAO, (p) => `${p[0]}${'*'.repeat(p.length - 1)}`);
}

module.exports = { semPalavrao };
