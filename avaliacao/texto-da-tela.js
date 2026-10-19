'use strict';

// O código da tela inteiro, na ordem do index.html (o renderer/app.js foi dividido em app*.js em 19/10).
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', 'renderer');

module.exports = () =>
  [...fs.readFileSync(path.join(PASTA, 'index.html'), 'utf8').matchAll(/<script src="(app[\w-]*\.js)"><\/script>/g)]
    .map((m) => fs.readFileSync(path.join(PASTA, m[1]), 'utf8'))
    .join('\n');
