'use strict';

/**
 * Pesquisa mais rápida (19/10, revisão da pesquisa, item 2): as primeiras páginas de cada busca
 * são lidas enquanto o modelo decide, e as ações da mesma rodada rodam ao mesmo tempo.
 */

const nucleo = require('../../src/agent/nucleo');

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// modelo falso: rodada 1 busca; rodada 2 (depois de "pensar" 250 ms) pede as fontes 1 e 2 juntas
function modelo({ pensarMs = 250 } = {}) {
  let passo = 0;
  const roteiro = [
    { ferramentas: [['buscar_na_web', { buscas: ['fone dunu titan s review'] }]] },
    { ferramentas: [['ler_pagina', { fonte: 1, foco: 'x' }], ['ler_pagina', { fonte: 2, foco: 'x' }]] },
  ];
  return {
    chamar: async (messages, opcoes = {}) => {
      if (opcoes.json) return { content: JSON.stringify({ precisa_buscar: true, produto: false, assuntos: ['Dunu Titan S'], pergunta: 'o que é o dunu titan s' }), chamadas: [] };
      if (passo === 1) await esperar(pensarMs);
      const r = roteiro[passo++];
      if (!r) return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
      return { content: '', chamadas: r.ferramentas.map(([name, args]) => ({ function: { name, arguments: args } })) };
    },
    escrever: async (messages, onToken) => (onToken('O Dunu Titan S é um fone [1].'), 'O Dunu Titan S é um fone [1].'),
  };
}

module.exports = [
  {
    nome: 'pesquisa adiantada: as 2 primeiras páginas de cada busca começam a ser lidas enquanto o modelo decide (cada uma é baixada uma vez só); as duas leituras pedidas juntas terminam no tempo de uma; o tópico fora do assunto não é adiantado',
    tipo: 'unidade',
    async executar() {
      const baixadas = [];
      const quando = {};
      const t0 = Date.now();
      let fimDaPesquisa = 0;
      const m = modelo();
      await nucleo.responder({
        pergunta: 'o que é o dunu titan s',
        modo: 'rapido',
        deps: {
          chamar: m.chamar,
          escrever: async (...a) => ((fimDaPesquisa = Date.now() - t0), m.escrever(...a)),
          buscar: async () => [
            { titulo: 'Dunu Titan S review', url: 'https://a.com/titan', resumo: 'Dunu Titan S' },
            { titulo: 'Dunu Titan S teste', url: 'https://b.com/titan', resumo: 'Dunu Titan S' },
            { titulo: 'Adata é confiável? Esse SSD vale a pena?', url: 'https://c.com/ssd', resumo: 'SSD Adata' },
          ],
          // cada página leva 300 ms para baixar
          lerPagina: async (url) => {
            baixadas.push(url);
            quando[url] = Date.now() - t0;
            await esperar(300);
            return { texto: `conteúdo sobre o Dunu Titan S ${'texto '.repeat(40)}` };
          },
          emit: () => {},
        },
      });
      const unicas = new Set(baixadas);
      return [
        // a leitura começou ANTES de o modelo terminar de decidir (ele "pensou" 250 ms)
        quando['https://a.com/titan'] < 200 && quando['https://b.com/titan'] < 200 || `começaram em ${JSON.stringify(quando)}`,
        unicas.size === baixadas.length || `baixou de novo: ${baixadas.join(', ')}`,
        !baixadas.includes('https://c.com/ssd') || 'adiantou o tópico fora do assunto',
        // decidir (250 ms) + ler já adiantado: bem menos que 250 + 300 + 300 (em fila, sem adiantar)
        fimDaPesquisa < 700 || `pesquisa levou ${fimDaPesquisa} ms`,
      ];
    },
  },
];
