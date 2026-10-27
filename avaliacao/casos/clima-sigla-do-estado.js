'use strict';

/**
 * Clima com a sigla do estado (27/10, no teste da voz): "clima em Vitória ES" → "Não achei a cidade Vitória ES";
 * e "Vitória, ES" ia para Vitoria, Espanha ("ES" também é o código do país). A busca de cidade é de mentira aqui.
 */

const { acharCidade } = require('../../src/agent/clima-no-chat');

const RESULTADOS = {
  results: [
    { name: 'Vitoria-Gasteiz', admin1: 'País Basco', country: 'Espanha', country_code: 'ES', latitude: 42.8, longitude: -2.6, population: 250000 },
    { name: 'Vitória', admin1: 'Espírito Santo', country: 'Brasil', country_code: 'BR', latitude: -20.3, longitude: -40.3, population: 320000 },
  ],
};
const deps = { baixar: async (url) => ({ ok: true, texto: JSON.stringify(/name=Vit%C3%B3ria(&|$)/.test(url) || /name=Vitoria(&|$)/.test(url) ? RESULTADOS : { results: [] }) }) };

module.exports = [
  {
    nome: 'clima: "Vitória ES", "Vitória-ES" e "Vitória, ES" são do Espírito Santo (sigla de estado só vale no Brasil); "Vitoria, Espanha" continua na Espanha',
    tipo: 'unidade',
    async executar() {
      const r = [];
      for (const n of ['Vitória ES', 'Vitória-ES', 'Vitória, ES']) {
        const c = await acharCidade(n, { deps });
        r.push(/Vitória, ES/.test(c?.rotulo || '') || `${n} → ${c?.rotulo}`);
      }
      const es = await acharCidade('Vitoria, Espanha', { deps });
      r.push(/Espanha/.test(es?.rotulo || '') || `Espanha → ${es?.rotulo}`);
      return r;
    },
  },
];
