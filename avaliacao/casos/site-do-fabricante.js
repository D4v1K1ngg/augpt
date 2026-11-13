'use strict';

/** Site do fabricante (13/11, nucleo.pesquisar): a pergunta cita a marca → busca "site:" junto das primeiras e a página oficial é lida. */

const nucleo = require('../../src/agent/nucleo');
const { oficiaisDaPergunta } = require('../../src/tools/imitacao');

async function rodar(pergunta, modo = 'normal') {
  const buscas = [];
  const lidas = [];
  const deps = {
    chamar: async (messages, opcoes = {}) => (opcoes.json ? { content: '{}', chamadas: [] } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
    escrever: async () => 'ok',
    buscar: async (q) => {
      buscas.push(q);
      const site = /site:(\S+)/.exec(q)?.[1];
      return site ? [{ titulo: 'Archer AX73 | AX5400', url: `https://www.${site}/br/archer-ax73/`, resumo: 'especificações' }] : Array.from({ length: 4 }, (_, i) => ({ titulo: `${q} ${i}`, url: `https://s${i}.com/${i}`, resumo: 'texto' }));
    },
    lerPagina: async (url) => (lidas.push(url), { texto: 'conteúdo da página '.repeat(30) }),
  };
  await nucleo.pesquisar({ pergunta, modo, deps, hoje: 'x', buscasIniciais: ['TP-Link Archer AX73 jogos'] });
  return { buscas, lidas };
}

module.exports = [
  {
    nome: 'site do fabricante: "TP link ax 73" busca site:tp-link.com junto das primeiras e lê a página oficial; "Windows" é Microsoft; sem marca, nenhuma busca a mais; modo rápido não busca',
    tipo: 'unidade',
    async executar() {
      const comMarca = await rodar('O roteador TP link ax 73 é bom para jogos ?');
      const semMarca = await rodar('qual roteador é bom para jogos?');
      const rapido = await rodar('O roteador TP link ax 73 é bom para jogos ?', 'rapido');
      return [
        comMarca.buscas.includes('site:tp-link.com TP-Link Archer AX73 jogos') || `buscas: ${comMarca.buscas}`,
        comMarca.lidas.some((u) => /tp-link\.com/.test(u)) || `lidas: ${comMarca.lidas}`,
        !semMarca.buscas.some((q) => /site:/.test(q)) || 'sem marca, sem site:',
        !rapido.buscas.some((q) => /site:/.test(q)) || 'modo rápido não busca o fabricante',
        oficiaisDaPergunta('como otimizar o windows 11 para jogos?')[0] === 'microsoft.com' || 'Windows → microsoft.com',
      ];
    },
  },
];
