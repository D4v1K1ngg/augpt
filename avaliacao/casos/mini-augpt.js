'use strict';

/**
 * Mini AuGPT (5/11, "igual ao picture in picture do Firefox"): a mesma janela vira um cartão de chat pequeno,
 * sempre por cima, no canto da tela; volta ao tamanho e ao lugar de antes. Testado no app em 5/11 (380×600 no
 * canto inferior direito, cartões de loja cabendo, sem erro de JS) — aqui ficam as peças que não podem sumir.
 */
const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'mini AuGPT: janela:mini liga sempre por cima no canto, guarda o lugar e volta como estava; botão e Ctrl+Shift+M; só o chat na tela',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const preload = ler('electron/preload.js');
      const tela = ler('renderer/index.html');
      const mini = ler('renderer/mini.js');
      const css = ler('renderer/tema.css');
      return [
        /ipcMain\.handle\('janela:mini'/.test(main) && /win\.setAlwaysOnTop\(true, 'floating'\)/.test(main) && /win\.setAlwaysOnTop\(false\)/.test(main) || 'liga e desliga o sempre por cima',
        /win\.setBounds\(antes\.bounds\)/.test(main) && /if \(antes\.maximizada\) win\.maximize\(\)/.test(main) || 'volta ao tamanho e ao lugar de antes',
        /janelaMini: win\.getBounds\(\)/.test(main) && /config\?\.data\?\.janelaMini/.test(main) || 'guarda e reusa o lugar do mini',
        /antesDoMini \? \{ janelaMaximizada: antesDoMini\.maximizada/.test(main) || 'fechar no mini não esquece que era maximizada',
        /mini: \(ligar\) => ipcRenderer\.invoke\('janela:mini'/.test(preload) || 'preload',
        /id="btnMini"/.test(tela) && /id="btnSairMini"/.test(tela) && /<script src="mini\.js"><\/script>/.test(tela) || 'os botões e o script',
        /e\.shiftKey && e\.key\.toLowerCase\(\) === 'm'/.test(mini) && /trocarAba\('agente'\)/.test(mini) || 'atalho e aba do Agente',
        /\.modo-mini \.barra > :not\(\.secao-atual\):not\(\.btn-sair-mini\)/.test(css) && /\.modo-mini \.lateral,/.test(css) && /\.modo-mini \.medidores/.test(css) || 'só o chat na tela',
      ];
    },
  },
];
