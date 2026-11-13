'use strict';

/** Cruzamento das fontes (13/11, nucleo.cruzarFontes): o código conta sites diferentes, não páginas. */

const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'cruzamento: ponto em 2 sites vira "confirmado"; 2 páginas do mesmo site contam 1; divergência só entre sites diferentes; fonte inventada sai; JSON quebrado não acrescenta nada',
    tipo: 'unidade',
    async executar() {
      const usadas = [
        { n: 1, url: 'https://a.com/x', pontos: ['ativar o Modo de Jogo'] },
        { n: 2, url: 'https://a.com/y', pontos: ['desligar o HAGS'] },
        { n: 3, url: 'https://b.org/z', pontos: ['ativar o Modo de Jogo', 'ligar o HAGS'] },
      ];
      const resposta = {
        grupos: [{ ponto: 'ativar o Modo de Jogo', fontes: [1, 3, 9] }, { ponto: 'desligar o HAGS', fontes: [1, 2] }],
        divergencias: [
          { sobre: 'HAGS', versoes: [{ diz: 'desligar', fontes: [2] }, { diz: 'ligar', fontes: [3] }] },
          { sobre: 'mesmo site', versoes: [{ diz: 'x', fontes: [1] }, { diz: 'y', fontes: [2] }] },
        ],
      };
      const chamar = async () => ({ content: JSON.stringify(resposta) });
      const t = await nucleo.cruzarFontes('como otimizar o windows?', usadas, { chamar });
      const quebrado = await nucleo.cruzarFontes('x', usadas, { chamar: async () => ({ content: 'não sei' }) });
      const umaSo = await nucleo.cruzarFontes('x', usadas.slice(0, 1), { chamar });
      return [
        /- ativar o Modo de Jogo \[1\]\[3\] — 2 sites/.test(t) || t,
        /Só um site traz[^\n]*\n- desligar o HAGS \[1\]\[2\]/.test(t) || 'duas páginas do mesmo site contam um',
        /HAGS: desligar \[2\] × ligar \[3\]/.test(t) && !/mesmo site:/.test(t) || 'divergência só entre sites diferentes',
        !/\[9\]/.test(t) || 'fonte que não existe sai',
        quebrado === '' && umaSo === '' || 'sem material para cruzar, nada',
      ];
    },
  },
];
