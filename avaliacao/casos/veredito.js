'use strict';

/**
 * "X é bom para Y?" (23/11, item 2 — o ChatGPT sobre a resposta do "o fone simgot em6l é bom para se jogar pubg?": um
 * cartão "1. Simgot EM6L" sozinho e o "qual eu escolheria" vazio). Sobre UM produto: pesquisa de recomendação, resposta
 * em veredito.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'veredito: "X é bom/boa para Y?", "vale a pena o X?", "o X presta/serve?" sobre um produto viram veredito (o nome vem do entendimento, mesmo em minúsculas); "qual o melhor", "X ou Y", "vale a pena X ou esperar Y", "me recomende um" continuam recomendação; o escritor recebe o formato sem cartões; o app busca o preço de hoje dele',
    tipo: 'unidade',
    executar() {
      const a = (q, assunto) => nucleo.avaliaUmProduto(q, [assunto]);
      const formato = nucleo.formatoDoVeredito('Simgot EM6L');
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      return [
        a('O fone simgot em6l é bom para se jogar pubg ?', 'Simgot EM6L') === 'Simgot EM6L' || 'em minúsculas, o nome do entendimento',
        a('a air fryer Mondial AFN-50-BI é boa para 4 pessoas?', 'Mondial AFN-50-BI') === 'Mondial AFN-50-BI' || '"boa"',
        Boolean(a('vale a pena comprar a RTX 5070 Ti?', 'RTX 5070 Ti') && a('o mouse Logitech G305 presta para FPS?', 'Logitech G305') && a('o dunu titan s é bom ?', 'Dunu Titan S') && a('o EM6L é bom ou ruim para FPS?', 'Simgot EM6L')) || 'vale a pena, presta, é bom?, bom ou ruim',
        [['Qual o melhor fone intra auricular para pubg?', 'fone'], ['Simgot EM6L ou Truthear Hexa para PUBG?', 'Simgot EM6L'], ['vale a pena a RTX 5070 Ti ou esperar a 5080?', 'RTX 5070 Ti'], ['me recomende um fone bom para pubg', 'fone'], ['compare o EM6L com o Hexa, qual é bom?', 'Simgot EM6L']].every(([q, s]) => a(q, s) === null) || 'escolher entre vários continua recomendação',
        a('o fone é bom para pubg?', '') === null || 'sem o nome do produto, não é veredito',
        /não monte uma lista de opções nem cartões "#### N\."/.test(formato) && /### 👍 O que elogiam/.test(formato) && /### 👎 O que criticam/.test(formato) && /nunca como prova de que é bom para o uso/.test(formato) || formato,
        /content: avaliado && usadas\.length \? `\$\{pergunta\}\$\{formatoDoVeredito\(avaliado\)\}/.test(ler('src/agent/nucleo/index.js')) || 'o veredito vem antes do formato de recomendação',
        /\(pedePreco \|\| r\.avaliado\)/.test(ler('src/agent/loop-nucleo.js')) || 'o preço de hoje do produto avaliado',
      ];
    },
  },
];
