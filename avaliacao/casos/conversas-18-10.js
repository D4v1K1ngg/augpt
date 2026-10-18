'use strict';

/**
 * Conversas reais de 17-18/10: "Acesse esse site" e "realize login" viraram
 * pesquisa (um "Relatório Técnico" inventado sobre a UNIP, sem abrir o site);
 * a prova de 10 questões pesquisou na web e foi cortada na 4ª.
 */

const { tipoDoPedido, comEnderecoDaConversa } = require('../../src/agent/tipo-de-pedido');
const { podeFicarSemBusca, lerEntendimento } = require('../../src/agent/nucleo');

const conversa = [{ role: 'user', content: "Acesse esse site 'https://www.unip.br/'" }, { role: 'assistant', content: 'Abri o site.' }];
const tipo = (t) => tipoDoPedido(comEnderecoDaConversa(t, conversa)).tipo;

module.exports = [
  {
    nome: 'conversas 18/10: abrir site e fazer login vão para o navegador (o endereço da mensagem anterior vai junto); ler, resumir e perguntar sobre login continuam pesquisa',
    tipo: 'unidade',
    executar() {
      return [
        tipo("Acesse esse site 'https://www.unip.br/'") === 'site' || 'acesse esse site',
        tipo('acessa esse site aqui pra min https://www.unip.br') === 'site' || 'acessa esse site',
        tipo("realize login nessa pagina pra min 'https://www.unip.br/aluno/central/'") === 'site' || 'realize login + url',
        tipo('realize login no site da unip') === 'site' || 'login sem url',
        tipo('voce cosegue realizar login nesse site pra min ?') === 'site' || 'login nesse site (url da conversa)',
        comEnderecoDaConversa('realize login nesse site', conversa) === 'realize login nesse site (https://www.unip.br/)' || 'endereço junto',
        tipoDoPedido('acesse o site https://x.com e resuma o artigo').tipo !== 'site' || 'resumir é leitura',
        tipoDoPedido('o que é login social?').tipo !== 'site' || 'pergunta sobre login',
        tipoDoPedido('Quem sera que vai ganhar como presidente no Brasil ?').tipo !== 'site' || 'pergunta comum',
        comEnderecoDaConversa('Quem vai ganhar a eleição?', conversa) === 'Quem vai ganhar a eleição?' || 'sem ação, sem endereço',
      ];
    },
  },
  {
    nome: 'conversas 18/10: questão de exatas com a conta no enunciado resolve sem pesquisar, mesmo se o modelo pedir busca; questão de história pesquisa',
    tipo: 'unidade',
    executar() {
      const prova = String.raw`Responda: Questão 1 — Álgebra. Seja \(x,y\in\mathbb{R}\), com \(x+y=6\). Questão 2 — Qual o menor n?`;
      return [
        podeFicarSemBusca(prova) || 'prova de exatas',
        podeFicarSemBusca('Questão 1 — Álgebra. Seja x+y=6 e xy=8') || 'sem LaTeX',
        lerEntendimento('{"precisa_buscar": true, "assuntos": ["álgebra"]}', prova).precisaBuscar === false || 'modelo pediu busca',
        !podeFicarSemBusca('Questão 1: quem descobriu o Brasil?') || 'história pesquisa',
        lerEntendimento('{"precisa_buscar": true}', 'qual a melhor rtx 5080?').precisaBuscar === true || 'produto pesquisa',
      ];
    },
  },
];
