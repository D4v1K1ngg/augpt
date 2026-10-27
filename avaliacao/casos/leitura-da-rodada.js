'use strict';

/**
 * A rodada da pesquisa não espera a página mais lenta (27/10, medido: leitura direta < 2 s, pelo
 * intermediário 3–12 s): quando uma página da rodada fica pronta, as outras têm mais uma folga; a que
 * chegar depois ainda entra nas fontes se a escrita não começou.
 */

const nucleo = require('../../src/agent/nucleo');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function pesquisador(roteiro) {
  let passo = 0;
  return async (messages, opcoes = {}) => {
    if (opcoes.json) return { content: '{}', chamadas: [] };
    const r = roteiro[passo++];
    return { content: '', chamadas: (r || [['pronto', {}]]).map(([name, args]) => ({ function: { name, arguments: args } })) };
  };
}

module.exports = [
  {
    nome: 'leitura da rodada: com 3 páginas rápidas e 1 lenta, a rodada segue logo depois da folga; a lenta vira "demorando" e, chegando antes da escrita, entra nas fontes',
    tipo: 'unidade',
    async executar() {
      const tempos = { 'https://a.com/x': 50, 'https://b.com/x': 120, 'https://d.com/x': 80, 'https://c.com/x': 900 };
      const deps = {
        // 1ª rodada: busca; 2ª: lê as 4 (3 rápidas cumprem o mínimo); depois pronto
        chamar: pesquisador([
          [['buscar_na_web', { buscas: ['assunto x'] }]],
          [['ler_pagina', { fonte: 1, foco: 'x' }], ['ler_pagina', { fonte: 2, foco: 'x' }], ['ler_pagina', { fonte: 3, foco: 'x' }], ['ler_pagina', { fonte: 4, foco: 'x' }]],
        ]),
        escrever: async () => 'ok',
        buscar: async () => Object.keys(tempos).map((url, i) => ({ titulo: `página ${i}`, url, resumo: 'assunto x resumo' })),
        lerPagina: async (url) => (await esperar(tempos[url] || 10), { texto: `${url} fala do assunto x. `.repeat(40) }),
        folgaDaRodadaMs: 200,
        prazoDaPaginaMs: 8000,
      };
      const t0 = Date.now();
      const fontes = await nucleo.pesquisar({ pergunta: 'o que é o assunto x?', modo: 'normal', deps, hoje: 'x', assuntos: [] });
      const total = Date.now() - t0;
      const lenta = fontes.find((f) => f.url === 'https://c.com/x');
      await esperar(1000); // a lenta chega depois: com a escrita começada, não muda mais as fontes
      return [
        total < 900 || `a pesquisa esperou a página lenta: ${total} ms`,
        fontes.filter((f) => f.trechos.length).some((f) => f.url === 'https://a.com/x') || 'a rápida foi lida',
        (lenta && lenta.trechos.length === 0) || 'a lenta chegou depois da escrita começar e não entrou',
      ];
    },
  },
];
