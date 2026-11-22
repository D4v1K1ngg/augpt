'use strict';

/**
 * O embedding que escolhe os trechos das páginas lidas (22/11, Davi: "pode testar tudo"). Medido com 25 páginas reais do
 * cache e 31 perguntas em português (muitas páginas em inglês), o trecho certo entre os 5 primeiros, as 25 páginas juntas:
 *   nomic-embed-text + palavra exata (metade cada, como era): 19/31 · embeddinggemma só pelo sentido: 29/31 ·
 *   embeddinggemma + reranker (bge-reranker-v2-m3): 31/31. Respostas do Qwen 3.5 9B certas: 24 → 27 → 29 de 31.
 * O nomic é feito para inglês; com um embedding multilíngue bom, a palavra exata só atrapalha (com 15% dela, o
 * embeddinggemma perde 2 a 3 acertos) — o peso das palavras vem do modelo.
 *
 * Fica SEPARADO de `embedModel` (a memória e a busca nos arquivos do PC, que guardam vetores em disco): o embeddinggemma
 * e o nomic têm 768 dimensões, e vetores dos dois seriam comparados sem erro e sem sentido. As páginas não guardam
 * vetores — cada pergunta calcula os seus —, então trocar este modelo não mexe em nada gravado.
 *
 * O filtro de fontes fora do assunto (nucleo/index.js) usa a semelhança deste modelo; recalibrado em 22/11 com as
 * mesmas páginas: com o embeddinggemma a página da resposta ficou a no máximo 0,103 da melhor (o nomic, 0,239) e os
 * limites de hoje (0,25 / 0,12) tiram 96% das páginas de outro assunto (o nomic, 42%) sem perder a certa (o nomic perdia
 * 1 de 31) — os limites ficaram.
 */

const ollama = require('../llm/ollama');

// prefixos de busca de cada modelo (o embeddinggemma foi treinado com eles) e o peso da palavra exata
const PERFIS = [
  { re: /embeddinggemma/i, consulta: 'task: search result | query: ', texto: 'title: none | text: ', pesoPalavras: 0 },
  { re: /bge-m3|qwen3-embedding/i, consulta: '', texto: '', pesoPalavras: 0 },
];
const PADRAO = { consulta: '', texto: '', pesoPalavras: 0.5 };

let instaladosCache = { host: '', em: 0, nomes: [] };
async function instalados(host) {
  if (instaladosCache.host === host && Date.now() - instaladosCache.em < 60000) return instaladosCache.nomes;
  const nomes = await ollama.listModels(host).then((l) => l.map((m) => m.name)).catch(() => []);
  instaladosCache = { host, em: Date.now(), nomes };
  return nomes;
}
const temModelo = (nomes, m) => nomes.some((n) => n === m || n === `${m}:latest`);

/** Qual modelo usar para as páginas: o de `embedPaginas` se estiver instalado; senão o `embedModel` (como era). */
async function modeloDasPaginas(config = {}) {
  const preferido = config.embedPaginas;
  if (preferido && temModelo(await instalados(config.host), preferido)) return preferido;
  return config.embedModel || 'nomic-embed-text';
}

/**
 * A função `embed` do `ordenar` (nucleo/ranking.js) para as páginas: o 1º texto é a pergunta, os outros são os trechos
 * (cada um com o seu prefixo). Leva junto `pesoPalavras`, `modelo` e, com o reranker ligado, `reordenar`/`quantos`.
 */
async function embedDasPaginas(config = {}, { signal, reranker = null } = {}) {
  const modelo = await modeloDasPaginas(config);
  const perfil = PERFIS.find((p) => p.re.test(modelo)) || PADRAO;
  const embed = (textos) => ollama.embed({ host: config.host, model: modelo, input: textos.map((t, i) => (i === 0 ? perfil.consulta : perfil.texto) + t), signal });
  embed.modelo = modelo;
  embed.pesoPalavras = perfil.pesoPalavras;
  if (reranker && config.reranker === true && reranker.instalado()) {
    embed.reordenar = (consulta, textos) => reranker.reordenar(consulta, textos);
    embed.quantos = Math.max(2, Number(config.rerankerQuantos) || 20);
  }
  return embed;
}

module.exports = { embedDasPaginas, modeloDasPaginas, PERFIS };
