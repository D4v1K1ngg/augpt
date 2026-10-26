'use strict';

/**
 * "Ei Jarvis" parava ao reabrir o AuGPT e voltava depois de treinar (relato do Davi, 27/10). No PC dele,
 * o padrão do Windows é o "External Mic" da G6 (nada ligado) e o "Line In" da G6 tem um chiado: a procura
 * da abertura, em silêncio, podia cair num deles; no treino você está falando e o fifine ganhava — e a
 * escolha não era guardada. E "Correção tudo a hora pega" virou a variante "correcao".
 */

const fs = require('fs');
const path = require('path');
const ditado = require('../../src/ditado');

const raiz = path.join(__dirname, '../..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

module.exports = [
  {
    nome: 'escuta: o microfone que ouviu você (treino, ditado, chamada) fica lembrado e é o primeiro ao abrir; na procura, ganha o de sinal mais forte e "Line In"/SPDIF ficam por último',
    tipo: 'unidade',
    executar() {
      const d = ler('renderer/ditado.js');
      const escuta = ler('renderer/escuta.js');
      const ajustes = ler('renderer/app-ajustes.js');
      return [
        /ditadoMicrofoneQueOuviu: ''/.test(ler('src/config.js')) || 'padrão no config',
        /\[escolhido, achadoNoAutomatico, config\.ditadoMicrofoneQueOuviu\]/.test(d) || 'ordem: escolhido, desta sessão, o que ouviu',
        /NAO_MICROFONE = \/line in/.test(d) && /\.sort\(\(a, b\) => NAO_MICROFONE\.test\(a\.label\) - NAO_MICROFONE\.test\(b\.label\)\)/.test(d) || 'Line In por último',
        /pico > \(melhor\?\.pico \|\| 0\)/.test(d) || 'o mais forte, não o primeiro com sinal',
        !/sondar\(padrao\)\) > 0\) return/.test(d) || 'o padrão não ganha só por ter sinal',
        /lembrarMicrofone\(\); \/\/ ouviu você/.test(d) || 'ditado lembra',
        /lembrarMicrofone\?\.\(\); \/\/ a chamada deu certo/.test(escuta) || 'chamada lembra',
        /window\.ditadoPorVoz\?\.lembrarMicrofone\(\);\s*const s = await api\.ditado\.salvarTreino/.test(ajustes) || 'treino lembra',
        /if \(config\.ditadoMicrofone \|\| !ultimoAberto/.test(d) || 'o escolhido em Ajustes manda',
      ];
    },
  },
  {
    nome: 'escuta: aprender pela repetição só com frase curta que lembra o nome ("Correção tudo a hora pega, véi." não vira variante de "Ei Jarvis")',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      ditado.definirNome('Ei Jarvis');
      try {
        return [
          /r\.parecido && String\(r\.texto\)\.trim\(\)\.split\(\/\\s\+\/\)\.length <= 4\) tentativaPerdida/.test(main) || 'regra no processo principal',
          ditado.lembraONome('Correção tudo a hora pega, véi.') === false || '"Correção…" lembra o nome?',
          ditado.lembraONome('e javes') === true || '"e javes" devia lembrar',
        ];
      } finally {
        ditado.definirNome('GPT');
      }
    },
  },
];
