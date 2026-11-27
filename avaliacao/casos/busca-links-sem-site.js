'use strict';

/**
 * Links sem site (27/11, Davi: as citações levavam a "http:///go/v1/Ab7xyk…"). O Google passou a devolver o link do
 * resultado como redirecionamento relativo ("/go/v1/<código>"); o SearXNG completa com "http://" e o endereço fica sem
 * site. O código expira, então o resultado sai já na busca (normalizar, por onde passam todos os buscadores).
 */

const { normalizar } = require('../../src/tools/search');

module.exports = [
  {
    nome: 'busca: resultado com link sem site ("http:///go/v1/…" do Google pelo SearXNG) sai; o com site fica',
    tipo: 'unidade',
    executar() {
      const r = normalizar([
        { titulo: 'SIMGOT SUPERMIX 4 REVIEW - ...', url: 'http:///go/v1/Ab7xyk1Y2IgGawmT6AHxaQtoLVSVHVXFON11GWth', resumo: 'x' },
        { titulo: 'Simgot Supermix 4 Review', url: 'https://thousandtime.com/gadget/simgot-supermix-4-review/', resumo: 'y' },
        { titulo: 'sem esquema', url: '/go/v1/AbBJ9QS4lc0X', resumo: 'z' },
      ], 'searxng');
      return [r.length === 1 && r[0].url.startsWith('https://thousandtime.com/') || JSON.stringify(r.map((x) => x.url))];
    },
  },
];
