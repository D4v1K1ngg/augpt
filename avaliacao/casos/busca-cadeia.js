'use strict';

/**
 * A cadeia de busca (27/10, análise do Davi): sem o SearXNG, o DuckDuckGo falhava e o Marginalia dava 429 —
 * cada busca esperava ~22 s e acabava na Wikipedia; a Jina (com chave) estava depois dela e nunca era chamada.
 * Buscadores trocados por falsos aqui (sem rede).
 */

const fs = require('fs');
const path = require('path');
const search = require('../../src/tools/search');

const raiz = path.join(__dirname, '../..');

function comFalsos(comportamento, fn) {
  const originais = search.CADEIA.map((p) => p.fn);
  const chamados = [];
  search.CADEIA.forEach((p) => {
    p.fn = async () => {
      chamados.push(p.nome);
      const c = comportamento[p.nome];
      if (c instanceof Error) throw c;
      return c ? c.map((u) => ({ url: u, titulo: u, resumo: '' })) : [];
    };
  });
  search.limparPausas();
  return Promise.resolve(fn(chamados)).finally(() => {
    search.CADEIA.forEach((p, i) => (p.fn = originais[i]));
    search.limparPausas();
  });
}
const tres = (n) => [`https://a.com/${n}`, `https://b.com/${n}`, `https://c.com/${n}`];

module.exports = [
  {
    nome: 'busca: a ordem é SearXNG → Jina → Ollama → DuckDuckGo → DuckDuckGo Lite → Marginalia → Wikipedia (a Wikipedia por último)',
    tipo: 'unidade',
    executar() {
      return [search.CADEIA.map((p) => p.nome).join(' → ') === 'searxng → jina → ollama → duckduckgo → duckduckgo-lite → marginalia → wikipedia' || search.CADEIA.map((p) => p.nome).join(' → ')];
    },
  },
  {
    nome: 'busca: sem SearXNG, a Jina responde antes da Wikipedia; quem falhou (rede, 429) fica de fora nas buscas seguintes; "sem chave" e "sem resultados" não pausam',
    tipo: 'unidade',
    async executar() {
      const r = [];
      await comFalsos({ jina: tres('j'), wikipedia: tres('w') }, async (chamados) => {
        const x = await search.buscar('cotação dólar hoje');
        r.push((x.provedor === 'jina' && chamados.join() === 'searxng,jina') || `${x.provedor} | ${chamados}`);
      });
      await comFalsos({ jina: new Error('sem chave configurada'), ollama: new Error('sem chave configurada'), duckduckgo: new Error('fetch failed'), 'duckduckgo-lite': new Error('fetch failed'), marginalia: new Error('HTTP 429'), wikipedia: tres('w') }, async (chamados) => {
        await search.buscar('primeira');
        const antes = chamados.length;
        const x = await search.buscar('segunda');
        const depois = chamados.slice(antes);
        r.push((depois.join() === 'searxng,jina,ollama,wikipedia' && x.falhas.some((f) => /duckduckgo: pulado/.test(f))) || `segunda busca chamou: ${depois} | ${JSON.stringify(x.falhas)}`);
        const p = search.buscadoresPausados();
        r.push((p.duckduckgo && p.marginalia && !p.jina && p.marginalia - p.duckduckgo > 60_000) || `pausas: ${JSON.stringify(p)}`);
      });
      return r;
    },
  },
  {
    nome: 'busca: a chave do Ollama chega em todos os lugares que buscam (núcleo, resposta rápida, ferramentas) e tem campo em Ajustes; a busca embutida parada é religada antes da execução',
    tipo: 'unidade',
    executar() {
      const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
      const contar = (f) => (ler(f).match(/ollamaKey/g) || []).length;
      return [
        contar('src/agent/loop-nucleo.js') >= 2 || 'núcleo',
        contar('src/agent/resposta-rapida.js') >= 1 || 'resposta rápida',
        contar('src/tools/web.js') >= 2 || 'ferramentas',
        /ollamaKey: ''/.test(ler('src/config.js')) || 'config',
        /id="cfgOllamaKey"/.test(ler('renderer/index.html')) && /ollamaKey: \$\('cfgOllamaKey'\)/.test(ler('renderer/app-ajustes.js')) || 'Ajustes',
        /await garantirBuscaEmbutida\(\);\s*criarAgente\(idConversa\)/.test(ler('electron/main.js')) || 'religar antes da execução',
      ];
    },
  },
];
