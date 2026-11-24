'use strict';

/**
 * Perguntas que saíam sem pesquisa (24/11, Davi: "dá uma olhada geral para perguntas sem pesquisa"). Nos registros: a
 * régua das táticas de PUBG ora pesquisava, ora não — quando o entendimento escolhia ler o PC e a internet do usuário, o
 * núcleo desligava a web se a pergunta não fosse "aberta", e "táticas" não era. Guia e produto agora pesquisam com os
 * dados do PC juntos. Os erros de rota de 18/11 (questão de prova em "ajustes de rede", "Minhas respostas: …" em
 * "consultar o PC") já não acontecem: ficam aqui para não voltarem.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const rotas = require('../../src/agent/rotas-do-codigo');

module.exports = [
  {
    nome: 'sem pesquisa: depois de ler o PC, guia ("táticas de PUBG no PC") e produto continuam pesquisando; a questão de prova de redes e o "Minhas respostas: …" não caem em rota do app; o entendimento manda pesquisar as táticas, o fone e a questão de estudo',
    tipo: 'unidade',
    executar() {
      const fonte = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      const questaoDeRedes = 'Pergunta 1\n\n    Uma das camadas da Gerência de Dispositivos de Entrada/Saída são os Device Drivers ou drives. Qual é a função dos drives?\n    a. Realizar a comunicação do subsistema de E/S com os dispositivos.\n    b. Criar uma interface e gerenciar um dispositivo.\n    c. Gerar requisições de interrupções.\n    d. Executar as rotinas de Entrada/Saída.';
      const respostas = 'Minhas respostas: 1. Você já possui um DAC (dongle) externo ou está disposto a comprar um para melhorar o som do Supermix 4? — tenho uma sound blaster g6';
      const busca = (q) => nucleo.lerEntendimento(JSON.stringify({ precisa_buscar: false }), q).precisaBuscar;
      return [
        /\(!PERGUNTA_ABERTA\.test\(String\(pergunta \|\| ''\)\) && !PEDE_GUIA\.test\(String\(pergunta \|\| ''\)\) && !ent\.produto\) \|\| COMO_ESTA\.test/.test(fonte) || 'guia e produto pesquisam com os dados do PC',
        !rotas.escolherRota({ objetivo: questaoDeRedes, conversa: [] }) || 'questão de prova não é ajuste de rede',
        !rotas.escolherRota({ objetivo: respostas, conversa: [] }) || '"Minhas respostas" não é consultar o PC',
        ['Quais as melhores táticas para vencer partidas de PUBG no PC?', 'qual o melhor fone para se jogar pubg de pc ?', 'O que caracteriza uma linguagem como decidível na teoria da computação?'].every(busca) || 'o entendimento manda pesquisar, mesmo com precisa_buscar false',
      ];
    },
  },
];
