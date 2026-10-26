'use strict';

/**
 * "E aí" pesquisava na web (27/10, análise do Davi: 15 s e 2 páginas lidas). O \b do SEM_BUSCA não fecha
 * depois de letra acentuada; e o modelo podia pedir busca mesmo assim. Agora o código decide.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'cumprimento sem busca: "E aí", "Olá!", "e aí, tudo bem?", "Ei Jarvis, tudo bem?" não pesquisam; "e aí, quem ganhou o jogo?" e "bom dia, como vai o mercado hoje?" pesquisam',
    tipo: 'unidade',
    executar() {
      const sim = ['E aí', 'Olá!', 'e aí, tudo bem?', 'Bom dia, tudo bem?', 'oi AuGPT', 'valeu!', 'Ei Jarvis, tudo bem?', 'Boa noite'];
      const nao = ['e aí, qual o preço da rtx 5080?', 'e ai quem ganhou o jogo', 'oi, me ajuda com uma coisa', 'bom dia, como vai o mercado hoje?', 'Olá, qual a capital da Austrália?'];
      const ent = (p) => nucleo.lerEntendimento('{"precisa_buscar": true, "assuntos": []}', p);
      return [
        ...sim.map((t) => (nucleo.soCumprimento(t) && ent(t).precisaBuscar === false) || `devia ficar sem busca: ${t}`),
        ...nao.map((t) => (!nucleo.soCumprimento(t) && ent(t).precisaBuscar === true) || `devia buscar: ${t}`),
      ];
    },
  },
  {
    nome: 'atividade: a busca mostra os sites que achou ("achou: uol.com.br, infomoney.com.br")',
    tipo: 'unidade',
    executar() {
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      return [
        /emit\('fonte', \{ tipo: 'busca', provedor: 'web', consultas: \[q\], resultados: [^}]*, dominios \}\)/.test(ler('src/agent/nucleo/index.js')) || 'evento com os domínios',
        /tr\('achou: \{s\}'/.test(ler('renderer/app-eventos.js')) || 'tela',
      ];
    },
  },
];
