'use strict';

/**
 * Studio de vídeo (17/11, Davi: "uma aba Studio, como um editor de vídeo — Vegas, CapCut, Filmora — com a dublagem e a
 * legenda dentro"). Conferido no app (perfil de teste): abrir, legendar, separar, dublar e pular no vídeo.
 */

const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'Studio: a aba (prévia, linha do tempo, inspetor, ferramentas), os comandos do processo principal, a prévia só do que o Studio abriu e com pedido de trecho (pular no vídeo)',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const main = ler('electron/main.js');
      const js = ler('renderer/studio.js');
      const preload = ler('electron/preload.js');
      const comandos = ['abrir', 'projeto', 'legendar', 'lerSrt', 'salvarSrt', 'separar', 'dublar', 'exportarLegenda', 'componentes', 'instalar', 'parar', 'mostrar'];
      return [
        /id="navStudio"/.test(html) && /id="viewStudio"/.test(html) && /<script src="studio\.js"><\/script>/.test(html) || 'a aba no menu e a página',
        ['stVideo', 'stLegendaTela', 'stRegua', 'stTrilhaOrig', 'stTrilhaTrad', 'stTrilhaFundo', 'stCabeca', 'stZoom', 'stEditor', 'stTxtTrad', 'stSalvarFala', 'stComponentes'].every((id) => html.includes(`id="${id}"`)) || 'prévia, linha do tempo, inspetor e componentes',
        comandos.every((c) => main.includes(`ipcMain.handle('studio:${c}'`)) && comandos.every((c) => preload.includes(`${c}: (`)) || 'os comandos (processo principal e preload)',
        /media-src 'self' blob: augpt-video:;/.test(html) || 'a CSP deixa tocar a prévia',
        // segurança: a tela só toca e só edita o que o Studio abriu (token), nunca um caminho qualquer
        /videosDoStudio\.get\(new URL\(pedido\.url\)\.pathname/.test(main) && /const aoLadoDoStudio = /.test(main) && /if \(!naJanela\(e\) \|\| !aoLadoDoStudio\(arquivo, \/\\\.srt\$\/i\)/.test(main) || 'prévia por token; .srt só ao lado do vídeo aberto',
        /status: m \? 206 : 200/.test(main) && /'Content-Range': `bytes \$\{inicio\}-\$\{fim\}\/\$\{total\}`/.test(main) || 'pedido de trecho (206): sem ele o player não pula',
        /api\.studio\.salvarSrt\(st\.arquivoTrad, st\.trad\)/.test(js) && /api\.studio\.dublar\(\{ video: st\.projeto\.video, srt: st\.arquivoTrad/.test(js) || 'a legenda editada é salva e a dublagem usa ela',
        /legendas e dublagem se mudaram para o Studio/.test(ler('renderer/tradutor.js')) && /id="tradIrStudio"/.test(html) || 'o Tradutor aponta para o Studio',
        /srt && fs\.existsSync\(srt\) && fs\.existsSync\(entrada\) \? \{ video: entrada, srt/.test(ler('src/dublagem/index.js')) || 'dublagem com a legenda pronta não transcreve de novo',
        /async function gravarLegenda\(/.test(ler('src/legendas/index.js')) || 'exportar a legenda editada no vídeo',
      ];
    },
  },
];
