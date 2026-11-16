'use strict';

/** Busca de produto mais estável e o modelo no rodapé (16/11, Davi: 11 rodadas da mesma pergunta, cada uma com outros fones). */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'busca estável: a consulta curta tira a cortesia ("poderia me recomendar…") e fica igual em toda rodada; a busca fixa entra nas primeiras de produto; a resposta guarda e mostra o modelo que respondeu',
    tipo: 'unidade',
    executar() {
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      const eventos = ler('renderer/app-eventos.js');
      const historico = ler('renderer/app-historico.js');
      return [
        nucleo.consultaCurta('Poderia me recomendar os melhores fones intra auriculares para se jogar pubg ?') === 'melhores fones intra auriculares jogar pubg' || nucleo.consultaCurta('Poderia me recomendar os melhores fones intra auriculares para se jogar pubg ?'),
        nucleo.consultaCurta('qual o melhor mouse para fps até 300 reais?') === 'melhor mouse fps até 300 reais' || 'mantém número e orçamento',
        /const fixa = produto && curta/.test(ler('src/agent/nucleo/index.js')) || 'a busca fixa nas primeiras de produto',
        /content: resumo, \.\.\.\(modelo \? \{ modelo \} : \{\}\)/.test(eventos) && /marcarModelo\(t\.resposta, modelo\)/.test(eventos) || 'a resposta guarda o modelo',
        /marcarModelo\(corpo, m\.modelo\)/.test(historico) && /msg-modelo/.test(historico) || 'a conversa reaberta mostra o modelo',
      ];
    },
  },
];
