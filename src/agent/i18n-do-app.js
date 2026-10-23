'use strict';

/**
 * O dicionário de inglês da tela (renderer/i18n.js) também para o agente (23/10): textos fixos do
 * catálogo (a lista do "o que você pode fazer?") saem em inglês na hora, sem passar pelo modelo.
 * Um lugar só para as traduções: o arquivo da tela, carregado aqui num navegador de mentira.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let i18n = null;
function carregar() {
  if (i18n) return i18n;
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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'i18n.js'), 'utf8'), contexto);
  i18n = contexto.window.i18n;
  return i18n;
}

/** A frase em inglês (dicionário e padrões da tela); sem tradução, a própria frase. */
const emIngles = (texto) => carregar().trTexto(texto);

module.exports = { emIngles };
