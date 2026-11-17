'use strict';

/**
 * Dublagem de vídeo (16/11, fase 2 da "dublagem e legendas"): a legenda traduzida, uma fala por trecho no Estúdio e
 * o vídeo com a voz nova por cima do som original baixinho.
 */

const fs = require('fs');
const path = require('path');
const { encaixar, montarFaixa, IDIOMA_DO_ESTUDIO } = require('../../src/dublagem');
const { EstudioDeVoz } = require('../../src/estudio-de-voz');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'dublagem: cada fala no seu tempo — cabe até o próximo trecho sem acelerar, acelera até 1,5× o que não cabe; as falas somam na faixa sem estourar',
    tipo: 'unidade',
    executar() {
      const plano = encaixar([{ inicio: 0, fim: 2000 }, { inicio: 2500, fim: 4000 }, { inicio: 4200, fim: 5000 }, { inicio: 9000, fim: 9500 }], [2.3, 3.5, 1.0, 4]);
      const faixa = montarFaixa([{ inicio: 0, amostras: Int16Array.from([30000, 30000]) }, { inicio: 0, amostras: Int16Array.from([30000]) }, { inicio: 2, amostras: Int16Array.from([-5]) }], { taxa: 1000, totalMs: 5 });
      return [
        plano[0].velocidade === 1 || `a fala que passa do fim mas cabe até o próximo não acelera: ${JSON.stringify(plano[0])}`,
        plano[1].velocidade === 1.5 || `o que não cabe acelera até 1,5×: ${JSON.stringify(plano[1])}`,
        plano[2].velocidade === 1 || JSON.stringify(plano[2]),
        plano[3].velocidade === 1 || 'a última fala não tem próximo: não acelera',
        faixa[0] === 32767 && faixa[1] === 30000 && faixa[2] === -5 || `soma e satura: ${faixa.slice(0, 3)}`,
        faixa.length >= 1005 || 'a faixa tem o tamanho do vídeo (e um pouco de folga)',
        IDIOMA_DO_ESTUDIO.pt === 'portuguese' && IDIOMA_DO_ESTUDIO.en === 'english' || 'idioma do Estúdio',
        typeof EstudioDeVoz.prototype.falas === 'function' || 'o Estúdio gera uma fala por trecho (falas)',
      ];
    },
  },
  {
    nome: 'dublagem no Studio: a voz do Estúdio, o som original (só o fundo, baixinho ou sem) e a legenda editada; o mesmo "Parar" da legenda',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const trad = ler('renderer/tradutor.js');
      const main = ler('electron/main.js');
      return [
        /id="stVoz"/.test(html) && /id="stFundo"/.test(html) && /<option value="separado">/.test(html) && /id="stDublar"/.test(html) || 'os campos no Studio',
        /api\.studio\.dublar\(\{ video: st\.projeto\.video, srt: st\.arquivoTrad, para: idioma\(\), voz, fundo/.test(ler('renderer/studio.js')) && /window\.estudioVozes\?\.opcoes/.test(ler('renderer/studio.js')) && trad.length > 0 || 'o Studio manda a voz do Estúdio e a legenda editada',
        /window\.estudioVozes = \{/.test(ler('renderer/estudio.js')) || 'o Estúdio expõe as vozes',
        /ipcMain\.handle\('dublagem:fazer'/.test(main) && /if \(legendaAbort\) return \{ ok: false, error: 'já tem uma legenda ou dublagem sendo feita' \}/.test(main) && /estudio: estudioDeVoz\(\)/.test(main) || 'o processo principal',
        /dublar: \(pedido\) => ipcRenderer\.invoke\('dublagem:fazer', pedido\)/.test(ler('electron/preload.js')) || 'o preload',
      ];
    },
  },
];
