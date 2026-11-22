'use strict';

/**
 * 22/11 (Davi: "pode testar tudo"; a régua em avaliacao/recuperacao/): o embedding das páginas separado da memória
 * (embeddinggemma, peso da palavra pelo modelo), o reranker opcional que nunca segura a pesquisa, os vetores da memória
 * com o nome do modelo e o embed em lotes.
 */

const { ordenar } = require('../../src/agent/nucleo/ranking');
const ollama = require('../../src/llm/ollama');
const { embedDasPaginas } = require('../../src/agent/embed-paginas');
const { ordenarPorHibrido } = require('../../src/agent/memory');
const { Reranker } = require('../../src/reranker');
const { recomendarModelos } = require('../../src/verificador-de-hardware');
const config = require('../../src/config');

// vetores de mentira: o "sentido" de cada texto é o eixo da palavra que ele tem
const EIXOS = ['memoria', 'grave', 'carro'];
const vetorDe = (t) => EIXOS.map((e) => (String(t).includes(e) ? 1 : 0.01));
const embedFalso = (extra = {}) => Object.assign(async (textos) => textos.map(vetorDe), extra);

module.exports = [
  {
    nome: 'trechos das páginas: o peso da palavra exata vem do modelo (0 no embeddinggemma); o reranker só muda a ordem e, fora do ar ou com resposta torta, fica a ordem do embedding',
    tipo: 'unidade',
    async executar() {
      // "grave" tem a palavra da pergunta ("som") e nada do sentido; "memoria" tem o sentido
      const itens = [{ texto: 'som som som do fone, grave' }, { texto: 'a pergunta sobre memoria virtual' }];
      const pergunta = 'memoria do som';
      const comPalavras = await ordenar(pergunta, itens, { embed: embedFalso({ pesoPalavras: 1 }) });
      const soSentido = await ordenar(pergunta, itens, { embed: embedFalso({ pesoPalavras: 0 }) });
      const tres = [{ texto: 'memoria a' }, { texto: 'memoria b' }, { texto: 'carro c' }];
      const invertido = await ordenar('memoria', tres, { embed: embedFalso({ pesoPalavras: 0, quantos: 3, reordenar: async (_q, t) => t.map((x) => (x.includes('c') ? 9 : x.includes('b') ? 5 : 1)) }) });
      const caiu = await ordenar('memoria', tres, { embed: embedFalso({ pesoPalavras: 0, reordenar: async () => { throw new Error('fora do ar'); } }) });
      const torto = await ordenar('memoria', tres, { embed: embedFalso({ pesoPalavras: 0, reordenar: async () => [1] }) });
      return [
        /som/.test(comPalavras[0].texto) && /memoria/.test(soSentido[0].texto) || `peso: ${comPalavras[0].texto} / ${soSentido[0].texto}`,
        invertido.map((x) => x.texto.slice(-1)).join('') === 'cba' && typeof invertido[0].nota === 'number' || `reranker: ${invertido.map((x) => x.texto).join()}`,
        caiu.length === 3 && /memoria/.test(caiu[0].texto) || 'reranker fora do ar',
        torto.length === 3 && /memoria/.test(torto[0].texto) || 'reranker com resposta incompleta',
      ];
    },
  },
  {
    nome: 'trechos das páginas: embeddinggemma quando instalado (com os prefixos de busca), o embedModel quando não; o reranker só entra ligado e instalado',
    tipo: 'unidade',
    async executar() {
      const original = { listModels: ollama.listModels, embed: ollama.embed };
      const enviados = [];
      try {
        ollama.listModels = async (host) => (host === 'h-com' ? [{ name: 'embeddinggemma:300m' }, { name: 'nomic-embed-text:latest' }] : [{ name: 'nomic-embed-text:latest' }]);
        ollama.embed = async ({ model, input }) => { enviados.push({ model, input }); return input.map(() => [1, 0]); };
        const rer = { instalado: () => true, reordenar: async () => null };
        const comGemma = await embedDasPaginas({ host: 'h-com', embedModel: 'nomic-embed-text', embedPaginas: 'embeddinggemma:300m', reranker: true }, { reranker: rer });
        const semGemma = await embedDasPaginas({ host: 'h-sem', embedModel: 'nomic-embed-text', embedPaginas: 'embeddinggemma:300m', reranker: true }, { reranker: { instalado: () => false } });
        const desligado = await embedDasPaginas({ host: 'h-com', embedPaginas: 'embeddinggemma:300m', reranker: false }, { reranker: rer });
        await comGemma(['pergunta', 'trecho']);
        return [
          comGemma.modelo === 'embeddinggemma:300m' && comGemma.pesoPalavras === 0 && typeof comGemma.reordenar === 'function' && comGemma.quantos === 20 || 'com o embeddinggemma',
          enviados[0].input[0] === 'task: search result | query: pergunta' && enviados[0].input[1] === 'title: none | text: trecho' || JSON.stringify(enviados[0]),
          semGemma.modelo === 'nomic-embed-text' && semGemma.pesoPalavras === 0.5 && !semGemma.reordenar || 'sem o embeddinggemma: o nomic, como era',
          !desligado.reordenar || 'reranker desligado',
          config.DEFAULTS.embedPaginas === 'embeddinggemma:300m' && config.DEFAULTS.reranker === false && config.DEFAULTS.rerankerQuantos === 20 || 'padrões',
        ];
      } finally {
        Object.assign(ollama, original);
      }
    },
  },
  {
    nome: 'memória: vetor de outro modelo (mesmo tamanho) não entra na comparação; item antigo sem o nome conta como nomic',
    tipo: 'unidade',
    executar() {
      const v = [1, 0, 0];
      const itens = [
        { id: 'gemma', texto: 'x', vec: [1, 0, 0], vecModelo: 'embeddinggemma:300m' },
        { id: 'antigo', texto: 'y', vec: [0.9, 0.1, 0] },
        { id: 'nomic', texto: 'z', vec: [0.8, 0.2, 0], vecModelo: 'nomic-embed-text:latest' },
      ];
      const ids = ordenarPorHibrido({ itens, vec: v, consultaTokens: [], k: 5, tokensDoItem: () => new Map(), modelo: 'nomic-embed-text' }).map((i) => i.id);
      return [ids.join() === 'antigo,nomic' || ids.join()];
    },
  },
  {
    nome: 'reranker: não instalado devolve null; erro do servidor devolve null (a pesquisa segue); sem lugar na placa, liga no processador',
    tipo: 'unidade',
    async executar() {
      const r0 = new Reranker('C:/nao-existe/reranker');
      const nulo = await r0.reordenar('q', ['a']);
      const chamadas = [];
      const processo = (falha) => ({ exitCode: falha ? 1 : null, stderr: { on() {} }, on() {}, kill() {} });
      const r = new Reranker('C:/nao-existe/reranker', {
        iniciarProcesso: (_exe, args) => { chamadas.push(args.slice(-1)[0]); return processo(args.includes('99')); },
        buscar: async (url) => (/health/.test(url) ? { ok: true } : /rerank/.test(url) ? { ok: true, json: async () => ({ results: [{ index: 1, relevance_score: 2 }, { index: 0, relevance_score: -1 }] }) } : { ok: false }),
      });
      r.instalado = () => true;
      const notas = await r.reordenar('q', ['a', 'b']);
      const ruim = new Reranker('C:/nao-existe/reranker', { iniciarProcesso: () => processo(false), buscar: async (url) => (/health/.test(url) ? { ok: true } : { ok: false, status: 500 }) });
      ruim.instalado = () => true;
      const comErro = await ruim.reordenar('q', ['a']);
      r.parar();
      ruim.parar();
      return [
        nulo === null || 'não instalado',
        chamadas.join() === '99,0' || `placa e depois processador: ${chamadas}`,
        notas?.join() === '-1,2' || `notas ${notas}`,
        comErro === null && /500/.test(ruim.ultimoErro) || `erro: ${comErro} ${ruim.ultimoErro}`,
      ];
    },
  },
  {
    nome: 'embed em lotes de 64 (o Ollama recusa 663 trechos de uma vez) e as boas-vindas baixam o embeddinggemma (páginas) e o nomic (memória)',
    tipo: 'unidade',
    async executar() {
      const fetchOriginal = global.fetch;
      const tamanhos = [];
      try {
        global.fetch = async (_url, o) => { const corpo = JSON.parse(o.body); tamanhos.push(corpo.input.length); const r = JSON.stringify({ embeddings: corpo.input.map(() => [1]) }); return { ok: true, status: 200, json: async () => JSON.parse(r), text: async () => r }; };
        const v = await ollama.embed({ host: 'http://127.0.0.1:1', model: 'm', input: Array.from({ length: 150 }, (_, i) => `t${i}`) }).catch((e) => e.message);
        const rec = recomendarModelos({ vramGB: 16, ramTotalGB: 32 });
        return [
          Array.isArray(v) && v.length === 150 && tamanhos.join() === '64,64,22' || `lotes ${tamanhos} ${typeof v === 'string' ? v : ''}`,
          rec.embedding.nome === 'embeddinggemma:300m' && rec.memoria.nome === 'nomic-embed-text' || 'boas-vindas',
        ];
      } finally {
        global.fetch = fetchOriginal;
      }
    },
  },
];
