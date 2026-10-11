'use strict';

const ollama = require('../llm/ollama');

/**
 * Similaridade de cosseno entre dois vetores do mesmo tamanho. Extraído de
 * memory.js para ser compartilhado por qualquer lugar que precise comparar
 * embeddings — hoje memória vetorial e o fallback semântico de skills, no
 * futuro também a comparação de objetivos parecidos (criação automática de
 * skills).
 */
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Vetor de embedding para um texto, ou null se o modelo de embedding não
 * estiver disponível (sem baixar, host fora do ar, etc.). Silencioso de
 * propósito: quem chama decide o que fazer na ausência — degradar para
 * léxico, pular um fallback, ou ambos.
 */
async function vetorDe(texto, { host, embedModel } = {}) {
  if (!embedModel) return null;
  try {
    const [vec] = await ollama.embed({ host, model: embedModel, input: String(texto).slice(0, 4000) });
    return vec || null;
  } catch {
    return null;
  }
}

module.exports = { cosine, vetorDe };
