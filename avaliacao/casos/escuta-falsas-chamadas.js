'use strict';

/**
 * Chamadas falsas do "Ei Jarvis" (27/10, registro do Davi conversando ao lado do microfone): "agora" tinha
 * virado variante ("Agora é certo" chamava); "para chegar até os 30…" passou pelo som da voz (27,0 com o
 * limite em 28,9); e a variante "chaves" chamava só pelo texto.
 */

const fs = require('fs');
const path = require('path');
const d = require('../../src/ditado');

module.exports = [
  {
    nome: 'escuta: variante de outro nome tem que lembrar o nome no fim ("agora" e "correcao" não; "chaves", "javes", "vocetaaijarvis", "ageofelvis" sim)',
    tipo: 'unidade',
    executar() {
      d.definirNome('Jarvis');
      try {
        const sim = ['chaves', 'javes', 'ojaves', 'vocetaaijarvis', 'daijervis', 'ageofelvis', 'jervis'];
        const nao = ['agora', 'correcao', 'mesmo', 'pesquisa'];
        return [
          ...sim.map((x) => d.varianteValida(x) || `devia valer: ${x}`),
          ...nao.map((x) => !d.varianteValida(x) || `não devia valer: ${x}`),
          JSON.stringify(d.variantesValidas(['chaves', 'agora', 'javes'])) === '["chaves","javes"]' || 'limpeza da lista na abertura',
        ];
      } finally {
        d.definirNome('GPT');
      }
    },
  },
  {
    nome: 'escuta: só pelo texto vale o som do nome; variante aprendida precisa da voz quando há gravações; o limite da voz é 1,25× a maior distância entre as gravações',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const voz = fs.readFileSync(path.join(__dirname, '../../renderer/voz.js'), 'utf8');
      d.definirNome('Jarvis');
      try {
        return [
          /if \(r\.ok && r\.chamou && !r\.pelaVoz && pelaVoz && pelaVoz\.chamou !== true && !require\('\.\.\/src\/ditado'\)\.ehChamada\(r\.texto, \[\]\)\)/.test(main) || 'variante precisa da voz',
          /semAVoz: true/.test(main) || 'o registro diz por quê',
          /finitos\[finitos\.length - 1\] \* 1\.25/.test(voz) || 'limite 1,25×',
          d.ehChamada('Jervis.', []) && !d.ehChamada('Chaves.', []) && d.ehChamada('Chaves.', ['chaves']) || 'nome sozinho × variante',
        ];
      } finally {
        d.definirNome('GPT');
      }
    },
  },
];
