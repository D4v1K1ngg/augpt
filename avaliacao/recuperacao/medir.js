'use strict';

/**
 * Régua da escolha de trechos (22/11/2026). Mede, com o código do AuGPT (src/agent/embed-paginas.js e
 * src/agent/nucleo/ranking.js), se o trecho que responde cada uma das 31 perguntas cai entre os 5 primeiros:
 *   pagina — só os trechos da página da resposta (o que o AuGPT faz em cada página lida);
 *   tema   — as páginas do mesmo assunto juntas;
 *   tudo   — as 25 páginas juntas (o mais difícil).
 * Com --respostas, o modelo principal também responde cada pergunta só com os 5 trechos (as páginas do assunto) e a
 * resposta é conferida pelo fato que ela precisa ter.
 *
 * Os textos vêm do cache do AuGPT (<dados do app>/cache-paginas): rode no PC onde as páginas foram lidas.
 *
 * Uso (na pasta do AuGPT, com o Ollama ligado):
 *   node avaliacao/recuperacao/medir.js                  # nomic (como era) × embeddinggemma × embeddinggemma + reranker
 *   node avaliacao/recuperacao/medir.js --respostas      # e as respostas do modelo (alguns minutos)
 *
 * 22/11 (Qwen 3.5 9B, RTX 5070 Ti): trecho certo entre os 5 primeiros, "tudo": nomic 19/31, embeddinggemma 29/31,
 * + reranker 31/31; respostas certas (conferência automática): 24, 27 e 29 de 31.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ordenar, pedacos } = require('../../src/agent/nucleo/ranking');
const { embedDasPaginas } = require('../../src/agent/embed-paginas');
const { rerankerDe } = require('../../src/reranker');

const dados = process.env.AUGPT_DADOS || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'AuGPT');
const config = { host: 'http://127.0.0.1:11434', embedModel: 'nomic-embed-text', ...JSON.parse(fs.readFileSync(path.join(dados, 'config.json'), 'utf8')) };
const { paginas: urls, perguntas } = require('./perguntas.json');
const norm = (t) => String(t).replace(/\s+/g, ' ').toLowerCase();

function lerDoCache(url) {
  const pasta = path.join(dados, 'cache-paginas');
  // o nome do arquivo é o sha1 da chave (src/tools/web.js); sem saber a chave, procura pelo url dentro
  for (const f of fs.readdirSync(pasta)) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(pasta, f), 'utf8'));
      if (j.url === url) return j.pagina?.texto || '';
    } catch {
      /* arquivo do cache ilegível: segue */
    }
  }
  return '';
}

(async () => {
  const textos = urls.map(lerDoCache);
  const faltam = urls.filter((_, i) => !textos[i]);
  if (faltam.length) console.log(`atenção: ${faltam.length} página(s) fora do cache, as perguntas delas ficam de fora:\n  ${faltam.join('\n  ')}`);
  const validas = perguntas.filter((q) => textos[q.p]);
  const trechosDe = textos.map((t, i) => pedacos(t).map((texto, k) => ({ texto, pagina: i, k })));
  const reranker = rerankerDe(dados);
  const variantes = [
    ['nomic + palavra exata (como era)', { ...config, embedPaginas: 'nomic-embed-text', reranker: false }],
    ['embeddinggemma', { ...config, embedPaginas: 'embeddinggemma:300m', reranker: false }],
    ...(reranker?.instalado() ? [['embeddinggemma + reranker', { ...config, embedPaginas: 'embeddinggemma:300m', reranker: true }]] : []),
  ];
  if (!reranker?.instalado()) console.log('(o reranker não está instalado: Ajustes → Componentes)');
  for (const [nome, cfg] of variantes) {
    const embed = await embedDasPaginas(cfg, { reranker });
    const t0 = Date.now();
    const linha = [];
    const escolhidos = {};
    for (const cenario of ['pagina', 'tema', 'tudo']) {
      let a1 = 0;
      let a5 = 0;
      for (const q of validas) {
        const pags = cenario === 'pagina' ? [q.p] : cenario === 'tema' ? [...new Set(perguntas.filter((x) => x.tema === q.tema).map((x) => x.p))] : textos.map((_, i) => i);
        const ordem = await ordenar(q.q, pags.flatMap((i) => trechosDe[i]), { embed, maximo: 5 });
        const pos = ordem.findIndex((it) => norm(it.texto).includes(norm(q.agulha)));
        if (pos === 0) a1 += 1;
        if (pos >= 0) a5 += 1;
        if (cenario === 'tema') escolhidos[q.q] = ordem;
      }
      linha.push(`${cenario}: ${a5}/${validas.length} (1º lugar ${a1})`);
    }
    console.log(`${nome.padEnd(34)} ${embed.modelo.padEnd(22)} ${linha.join(' · ')} · ${Math.round((Date.now() - t0) / 1000)} s`);
    if (process.argv.includes('--respostas')) {
      let certas = 0;
      for (const q of validas) {
        const material = escolhidos[q.q].map((s) => s.texto).join('\n…\n').slice(0, 5000);
        const r = await fetch(`${config.host}/api/chat`, { method: 'POST', body: JSON.stringify({ model: config.model, stream: false, think: false, options: { temperature: 0, num_ctx: 8192, num_predict: 200 }, messages: [{ role: 'user', content: `Responda em português, em uma ou duas frases, usando só o material abaixo. Se o material não responder, diga "não encontrei".\n\nMATERIAL:\n${material}\n\nPERGUNTA: ${q.q}` }] }) }).then((x) => x.json());
        const resp = r.message?.content || '';
        if (new RegExp(q.fato, 'i').test(resp) && !/não encontrei/i.test(resp.slice(0, 40))) certas += 1;
      }
      console.log(`${''.padEnd(34)} respostas certas (${config.model}): ${certas}/${validas.length}`);
    }
  }
  reranker?.parar();
  // impressão digital das perguntas: se o arquivo mudar, os números deixam de ser comparáveis com os de antes
  console.log(`\nperguntas.json ${crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'perguntas.json'))).digest('hex').slice(0, 8)}`);
})();
