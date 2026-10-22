'use strict';

/**
 * Idiomas (22/10): português e inglês. O texto de origem é o português; renderer/i18n.js guarda o
 * inglês com a frase em português como chave. Aqui: toda frase passada a tr()/t() no código tem
 * tradução (pega erro de digitação, que deixaria o texto em português na tela em inglês), as
 * frases com número do processo principal viram inglês, e o escritor do núcleo responde em inglês.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { sistemaDoEscritor } = require('../../src/agent/nucleo');

const RENDERER = path.join(__dirname, '..', '..', 'renderer');

/** Carrega o i18n.js num contexto falso de navegador, já em inglês. */
function i18nEmIngles() {
  const contexto = {
    navigator: { language: 'en-US', languages: ['en-US'] },
    localStorage: { getItem: () => 'en', setItem() {} },
    document: { documentElement: {}, body: null },
    addEventListener() {},
    dispatchEvent() {},
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class {},
    NodeFilter: {},
  };
  contexto.window = contexto;
  vm.runInNewContext(fs.readFileSync(path.join(RENDERER, 'i18n.js'), 'utf8'), contexto);
  return contexto.window.i18n;
}

module.exports = [
  {
    nome: 'idiomas: toda frase passada a tr()/t() no código da tela tem tradução para o inglês',
    tipo: 'unidade',
    executar() {
      const i18n = i18nEmIngles();
      const faltam = [];
      for (const arquivo of fs.readdirSync(RENDERER).filter((f) => f.endsWith('.js') && f !== 'i18n.js')) {
        const codigo = fs.readFileSync(path.join(RENDERER, arquivo), 'utf8');
        for (const m of codigo.matchAll(/\b(?:tr|t)\(\s*'((?:[^'\\]|\\.)+)'/g)) {
          const frase = m[1].replace(/\\'/g, "'");
          if (i18n.tr(frase) === frase && !/^[\s·:,.!?…-]*$/.test(frase)) faltam.push(`${arquivo}: ${frase}`);
        }
      }
      return [faltam.length === 0 || `sem tradução: ${faltam.join(' | ')}`];
    },
  },
  {
    nome: 'idiomas: variáveis, frases com número do processo principal e o escritor do núcleo em inglês',
    tipo: 'unidade',
    executar() {
      const i18n = i18nEmIngles();
      const escritorEn = sistemaDoEscritor({ hoje: '22/10/2026', comFontes: true, idioma: 'en' });
      const escritorPt = sistemaDoEscritor({ hoje: '22/10/2026', comFontes: true });
      return [
        i18n.tr('O que você precisa, {nome}?', { nome: 'Ana' }) === 'What do you need, Ana?' || i18n.tr('O que você precisa, {nome}?', { nome: 'Ana' }),
        i18n.tr('frase que não está no dicionário') === 'frase que não está no dicionário' || 'sem tradução, fica o original',
        i18n.trTexto('sua placa tem 8 GB: o 9B cabe inteiro nela — é o que o AuGPT foi ajustado e medido') === 'your card has 8 GB: the 9B fits entirely, and it is the model AuGPT was tuned and measured with' || 'motivo do 9B',
        i18n.trTexto('pouco espaço no disco dos modelos: 5.2 GB livres, precisa de uns 9 GB') === 'low space on the models drive: 5.2 GB free, about 9 GB needed' || 'aviso de disco',
        /INGLÊS \(en-US\)/.test(escritorEn) && !/INGLÊS/.test(escritorPt) && /português do Brasil/.test(escritorPt) || 'escritor no idioma',
      ];
    },
  },
];
