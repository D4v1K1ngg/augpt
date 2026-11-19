'use strict';

/**
 * 19/11 (Davi, o contracheque no portal da empresa): "Emitir" manda um formulário (POST) para uma janela nova — aberta
 * pelo Electron ela ia sem o formulário e o portal (ASP.NET MVC) respondia 404; o PDF mostrado na tela não virava
 * arquivo; o download "Salvar como" ficava fora do alcance do agente; e a janela do navegador abria solta. Conferido num
 * portal falso local, no app de verdade: o POST chega com competencia=2026-10, o PDF cai em downloads/ e o agente lê os
 * valores certos.
 */

const fs = require('fs');
const path = require('path');
const midia = require('../../src/agent/midia-no-chat');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'navegador: janela aberta por formulário leva o formulário (POST), PDF na tela vira download, download fora da pasta de trabalho ganha cópia nela e o agente recebe o caminho para ler',
    tipo: 'unidade',
    executar() {
      const nav = ler('electron/navegador.js');
      const ferramenta = ler('src/tools/navegador.js');
      return [
        /if \(postBody\?\.data\?\.length\) \{[\s\S]{0,120}abrirFilhaComFormulario\(url, postBody, referrer\)/.test(nav) && /filha\.loadURL\(url, \{ postData: postBody\.data, extraHeaders: cabecalho/.test(nav) || 'o POST vai junto',
        /sessao\.webRequest\?\.onHeadersReceived\?\.\(/.test(nav) && /application\\\/pdf/.test(nav) && /replace\(\/\^\\s\*inline\/i, 'attachment'\)/.test(nav) || 'PDF na tela vira download',
        /path\.relative\(cfg\.workspace, caminho\)\.startsWith\('\.\.'\)/.test(nav) && /fs\.copyFileSync\(caminho, copia\)/.test(nav) || 'cópia na pasta de trabalho',
        /Para ler o conteúdo: ler_documento com caminho/.test(ferramenta) || 'o agente sabe como ler',
      ];
    },
  },
  {
    nome: 'navegador no canto do chat: vista dentro da janela do app (WebContentsView), a tela manda o retângulo e esconde fora do chat ou com diálogo aberto',
    tipo: 'unidade',
    executar() {
      const nav = ler('electron/navegador.js');
      const main = ler('electron/main.js');
      const tela = ler('renderer/painel-navegador.js');
      return [
        /new WebContentsView\(/.test(nav) && /host\.contentView\.addChildView\(vista\)/.test(nav) && /setArea\(area\)/.test(nav) || 'a vista no app',
        /anfitriao: \(\) => win,/.test(main) && /ipcMain\.on\('browser:area'/.test(main) && /canal: 'navegador-painel'/.test(main) || 'o main liga o painel',
        /area: \(retangulo\) => ipcRenderer\.send\('browser:area'/.test(ler('electron/preload.js')) || 'preload',
        /document\.querySelector\('dialog\[open\]'\)/.test(tela) && /chat\.offsetParent !== null/.test(tela) && /manipuladores\['navegador-painel'\]/.test(tela) || 'some fora do chat',
        /<script src="painel-navegador\.js"><\/script>/.test(ler('renderer/index.html')) && /\.painel-navegador \{/.test(ler('renderer/tema-lume.css')) || 'na tela',
      ];
    },
  },
  {
    nome: '"acessa esse site, faz login e baixa o contracheque" é agir num site (o imperativo do dia a dia), não baixar mídia',
    tipo: 'unidade',
    executar() {
      const pedido = 'Acessa esse site https://www.exemplo.com.br/Interno para min, faz login e baixa o meu contracheque mais recente e analisa ele';
      return [
        tipoDoPedido(pedido).tipo === 'site' || JSON.stringify(tipoDoPedido(pedido)),
        tipoDoPedido('Acessa esse site https://portal.exemplo.com/ para mim, emite e baixa o meu contracheque').tipo === 'site' || 'emite e baixa',
        tipoDoPedido('resuma https://g1.globo.com/noticia').tipo !== 'site' || 'ler não é agir',
        midia.pedidoDeMidia(pedido) === null || 'não é mídia',
        midia.pedidoDeMidia('baixa esse video https://www.youtube.com/watch?v=abc')?.url && midia.pedidoDeMidia('baixa o mp3 desse link https://exemplo.com/a.mp3')?.tipo === 'audio' || 'mídia continua',
      ];
    },
  },
];
