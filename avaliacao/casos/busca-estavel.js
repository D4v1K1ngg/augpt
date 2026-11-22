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
module.exports.push({
  nome: 'lista principal: os produtos citados em todos os tópicos de comunidade lidos (com as fontes; lista de afiliado não conta) viram a base das opções do redator, e os cartões deles vão para o topo, renumerados, com a comparação no fim',
  tipo: 'unidade',
  executar() {
    const fontes = [
      { n: 3, url: 'https://www.reddit.com/r/iems/a', titulo: 'IEM for FPS', comunidade: true, trechos: ['The Simgot EM6L is great for footsteps. Truthear Hexa too. Simgot EM6L again.'] },
      { n: 5, url: 'https://forum.adrenaline.com.br/x', titulo: 'Fones para FPS', comunidade: true, trechos: ['Tenho o Truthear Hexa e o Simgot EM6L, recomendo.'] },
      { n: 7, url: 'https://pandalargo.com.br/top-10', titulo: 'Top 10 fones', trechos: ['KZ EDX Pro é bom. KZ EDX Pro de novo.'] },
    ];
    const c = nucleo.citadosNaComunidade(fontes, 'melhor fone para pubg');
    const txt = 'Intro.\n\n#### 1. KZ EDX Pro\nLista.\n\n#### 2. Simgot EM6L\nComunidade.\n\n#### 3. Truthear Hexa\nComunidade.\n\n### ⚖️ Comparação\nfim\n';
    const r = nucleo.comunidadePrimeiro(txt, c.map((x) => x.nome));
    return [
      JSON.stringify(c) === '[{"nome":"Simgot EM6L","fontes":[3,5],"sites":2},{"nome":"Truthear Hexa","fontes":[3,5],"sites":2}]' || JSON.stringify(c),
      /monte as opções a partir desta lista[\s\S]*1\. Simgot EM6L \[3\]\[5\]/.test(nucleo.blocoDaComunidade(c)) || 'o redator recebe a lista com as fontes',
      /#### 1\. Simgot EM6L[\s\S]*#### 2\. Truthear Hexa[\s\S]*#### 3\. KZ EDX Pro[\s\S]*### ⚖️ Comparação\nfim/.test(r) || r,
      nucleo.comunidadePrimeiro(txt, []) === txt && nucleo.blocoDaComunidade([]) === '' || 'sem comunidade, nada muda',
    ];
  },
});
module.exports.push({
  nome: 'página de bloqueio não é leitura: o aviso do Reddit ("blocked by network security… log in", 403) vira leitura sem texto; texto normal que cita "access denied" não; a lista principal usa o resumo da busca do tópico bloqueado',
  tipo: 'unidade',
  executar() {
    const { paginaDeBloqueio } = require('../../src/tools/extract');
    const fontes = [
      { n: 2, url: 'https://www.reddit.com/r/iems/a', titulo: 'IEM for FPS', comunidade: true, trechos: [], resumo: 'Get the Simgot EM6L, the Simgot EM6L imaging is great; Truthear Hexa is fine too.' },
    ];
    return [
      paginaDeBloqueio("Title: URL Source: https://www.reddit.com/r/x Warning: Target URL returned error 403: Forbidden Markdown Content: You've been blocked by network security. To continue, log in to your Reddit account") === true || 'o aviso do Reddit',
      paginaDeBloqueio('Just a moment...') === true && paginaDeBloqueio('Um tópico sobre fones; o erro access denied apareceu no app e eu resolvi assim.') === false || 'genérico só em página curta',
      /bloqueada: true/.test(require('fs').readFileSync(require.resolve('../../src/tools/extract'), 'utf8')) || 'ler() devolve a página bloqueada sem texto',
      nucleo.citadosNaComunidade(fontes, 'melhor fone').some((c) => c.nome === 'Simgot EM6L' && c.fontes.includes(2)) || JSON.stringify(nucleo.citadosNaComunidade(fontes, 'melhor fone')),
    ];
  },
});
