'use strict';

/**
 * Todo evento que o agente emite e que a tela trata (manipuladores em
 * renderer/app.js) precisa estar na lista EVENTOS de electron/main.js — senão
 * nunca chega na tela. Aconteceu duas vezes: "autoridade-descoberta" (23/09) e
 * "arquivo-criado" (17/10, o PDF da investigação não virava anexo).
 */

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

function arquivosJs(dir) {
  return fs.readdirSync(path.join(raiz, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivosJs(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

module.exports = [
  {
    nome: 'eventos: todo evento que o agente emite e a tela trata está na lista de repasse do processo principal',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const lista = main.slice(main.indexOf('const EVENTOS = ['), main.indexOf('];', main.indexOf('const EVENTOS = [')));
      const repassados = new Set([...lista.matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]));
      const app = require('../texto-da-tela')();
      const tratados = new Set([...app.matchAll(/^\s{2}'?([a-z][a-z-]*)'?\s*\(\{?[^)]*\)?\s*\{/gm)].map((m) => m[1]));
      const emitidos = new Set();
      for (const arq of arquivosJs('src/agent')) {
        for (const m of ler(arq).matchAll(/\bemit\(\s*'([a-z][a-z-]*)'/g)) emitidos.add(m[1]);
      }
      const faltam = [...emitidos].filter((e) => tratados.has(e) && !repassados.has(e));
      return [faltam.length === 0 || `emitidos e tratados, mas fora de EVENTOS: ${faltam.join(', ')}`, emitidos.has('arquivo-criado') || 'a busca de eventos achou o arquivo-criado'];
    },
  },
];
