'use strict';

/**
 * Sugestões de próxima pergunta (16/11, fase 4 do visual novo): 3 perguntas curtas no fim da última resposta, que o
 * usuário clica para continuar. Uma chamada pequena ao mesmo modelo da conversa (já carregado), em JSON; resposta
 * ilegível ou lenta = sem sugestões (nunca atrapalha).
 */

function pedidoDeSugestoes(pergunta, resposta, idioma = 'pt') {
  const em = idioma === 'en' ? 'in English' : 'em português do Brasil';
  return `O usuário perguntou: "${String(pergunta).slice(0, 600)}"
A resposta dada (resumo): "${String(resposta).replace(/!\[[^\]]*\]\([^)]*\)|```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').slice(0, 1500)}"

Sugira 3 perguntas curtas que ESTE usuário faria em seguida, ${em}: aprofundar um ponto da resposta, comparar, ou o próximo passo prático. Cada uma com até 9 palavras, escrita como o usuário escreveria (primeira pessoa), sem repetir a pergunta feita.
Responda SÓ com um JSON: {"sugestoes": ["…", "…", "…"]}`;
}

/** As sugestões do texto do modelo: até 3, curtas, sem repetir a pergunta nem umas às outras. */
function lerSugestoes(texto, pergunta = '') {
  let lista = [];
  try {
    const j = JSON.parse(String(texto || '').replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/)[0]);
    lista = Array.isArray(j.sugestoes) ? j.sugestoes : [];
  } catch {
    return [];
  }
  const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const vistas = new Set([norm(pergunta)]);
  const boas = [];
  for (const s of lista) {
    const t = String(s || '').replace(/\s+/g, ' ').trim().replace(/^["'“]|["'”]$/g, '');
    if (t.length < 6 || t.length > 90 || vistas.has(norm(t))) continue;
    vistas.add(norm(t));
    boas.push(/[?!.]$/.test(t) ? t : `${t}?`);
    if (boas.length === 3) break;
  }
  return boas;
}

module.exports = { pedidoDeSugestoes, lerSugestoes };
