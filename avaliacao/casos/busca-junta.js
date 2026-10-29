'use strict';

/**
 * A busca junta buscadores quando o primeiro traz pouco (29/10, análise do projeto: o SearXNG era aceito até com
 * 1 resultado e o Ollama e a Jina nunca entravam) e mede quanto cada um levou.
 */

const search = require('../../src/tools/search');

// troca os buscadores de verdade por falsos durante o teste
async function comBuscadores(falsos, fn) {
  const originais = search.CADEIA.map((p) => p.fn);
  search.limparPausas();
  search.CADEIA.forEach((p) => {
    p.fn = falsos[p.nome] || (async () => []);
  });
  try {
    return await fn();
  } finally {
    search.CADEIA.forEach((p, i) => {
      p.fn = originais[i];
    });
    search.limparPausas();
  }
}
const r = (url) => ({ url, titulo: url, resumo: '' });

module.exports = [
  {
    nome: 'busca: poucos resultados ou um site só → o próximo buscador também entra e os dois se juntam (sem repetir); o bastante para no primeiro; "site:" vale só a quantidade; falha passa ao próximo; os tempos de cada um',
    tipo: 'unidade',
    async executar() {
      const chamados = [];
      const marcar = (nome, lista) => async () => (chamados.push(nome), lista);
      const pouco = await comBuscadores({ searxng: marcar('searxng', [r('https://a.com/1')]), ollama: marcar('ollama', [r('https://a.com/1'), r('https://b.com/2'), r('https://c.com/3')]) }, () => search.buscar('x'));
      const umSite = await comBuscadores({ searxng: async () => [r('https://a.com/1'), r('https://a.com/2'), r('https://a.com/3')], ollama: async () => [r('https://b.com/1')] }, () => search.buscar('x'));
      chamados.length = 0;
      const bom = await comBuscadores({ searxng: marcar('searxng', [r('https://a.com/1'), r('https://b.com/2'), r('https://c.com/3')]), ollama: marcar('ollama', [r('https://d.com/1')]) }, () => search.buscar('x'));
      const chamadosNoBom = [...chamados];
      const comunidade = await comBuscadores({ searxng: async () => [r('https://reddit.com/1'), r('https://reddit.com/2'), r('https://reddit.com/3')], ollama: async () => [r('https://b.com/1')] }, () => search.buscar('site:reddit.com fone'));
      const falhou = await comBuscadores({ searxng: async () => { throw new Error('fetch failed'); }, ollama: async () => [r('https://a.com/1'), r('https://b.com/2'), r('https://c.com/3')] }, () => search.buscar('x'));
      return [
        (pouco.provedor === 'searxng+ollama' && pouco.resultados.length === 3) || JSON.stringify({ p: pouco.provedor, n: pouco.resultados.length }),
        pouco.resultados.find((x) => x.url === 'https://b.com/2')?.provedor === 'ollama' || 'de onde veio cada resultado',
        umSite.provedor === 'searxng+ollama' || `um site só: ${umSite.provedor}`,
        (bom.provedor === 'searxng' && JSON.stringify(chamadosNoBom) === '["searxng"]') || `bastante: ${bom.provedor} ${chamadosNoBom}`,
        comunidade.provedor === 'searxng' || `site: ${comunidade.provedor}`,
        (falhou.provedor === 'ollama' && /searxng: fetch failed/.test(falhou.falhas.join())) || JSON.stringify(falhou),
        typeof pouco.tempos?.searxng === 'number' && typeof pouco.tempos?.ollama === 'number' || 'tempos',
      ];
    },
  },
  {
    nome: 'tempos da pesquisa: o núcleo mede as etapas e as chamadas, a busca anota buscadores e falhas, o registro guarda e o relatório mostra',
    tipo: 'unidade',
    async executar() {
      const fs = require('fs');
      const path = require('path');
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      const nucleo = ler('src/agent/nucleo/index.js');
      const loop = ler('src/agent/loop-nucleo.js');
      return [
        /if \(deps\.tempos && !deps\.medido\) deps = medirDeps\(deps\);/.test(nucleo) || 'mede as chamadas uma vez só',
        ['entendimento', 'pesquisa', 'material', 'escrita', 'conferencia'].every((e) => nucleo.includes(`etapa('${e}'`)) || 'as cinco etapas',
        (loop.match(/\.then\(anotarBusca\)|anotarBusca\(await search\.buscar/g) || []).length >= 4 || 'todas as buscas anotadas (inclusive a da comunidade)',
        /tempos \}\);/.test(loop) && /if \(e\?\.tempos\) d\.tempos = e\.tempos;/.test(ler('src/registro.js')) || 'vai para o registro',
        /function linhasDeTempo/.test(ler('renderer/app-historico.js')) || 'relatório',
        /if \(!tempos\.primeiraPalavraMs\) tempos\.primeiraPalavraMs = Date\.now\(\) - inicio;/.test(loop) || 'a primeira palavra',
      ];
    },
  },
  {
    nome: 'mais rápido (29/10): o modelo carrega antes da pergunta (app aberto, "Ei Jarvis", digitando; mesmo contexto do agente); conversa óbvia pula o entendimento — produto e notícia não',
    tipo: 'unidade',
    async executar() {
      const fs = require('fs');
      const path = require('path');
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      const nucleo = require('../../src/agent/nucleo');
      const main = ler('electron/main.js');
      const pula = async (p) => {
        let chamadas = 0;
        const deps = { chamar: async (m, o) => (chamadas++, { content: o?.json ? '{"precisa_buscar": true}' : '' }), escrever: async () => 'ok', emit: () => {}, buscar: async () => [], lerPagina: async () => ({}) };
        await nucleo.responder({ pergunta: p, deps });
        return chamadas === 0;
      };
      return [
        /ipcMain\.handle\('agent:aquecer'[\s\S]{0,600}numCtx: 16384, numPredict: 1/.test(main) && /agent\?\.rodando \|\| Date\.now\(\) - aquecidoEm < 2 \* 60_000/.test(main) || 'aquecer com o contexto do agente, sem repetir',
        /api\.agent\.aquecer\?\.\(\)/.test(ler('renderer/escuta.js')) && /setTimeout\(aquecerModelo, 8000\)/.test(ler('renderer/app-abas.js')) || '"Ei Jarvis", digitando e ao abrir',
        (await pula('E aí, tudo bem?')) && (await pula('Estou meio cansado hoje')) && (await pula('Você acha que vale a pena aprender violão depois dos 30?')) || 'conversa óbvia pula',
        !(await pula('Você acha que a RTX 5070 vale a pena?')) && !(await pula('o que você acha do fone Simgot EM6L?')) && !(await pula('Você acha que vale a pena comprar um notebook?')) || 'produto não pula',
        !(await pula('O que você acha das notícias de hoje?')) && !(await pula('Quanto tempo uma calopsita vive?')) || 'notícia e fato não pulam',
      ];
    },
  },
];
