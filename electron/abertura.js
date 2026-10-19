'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');

/**
 * Abertura do AuGPT (19/10, pedido do Davi: "iniciar igual o Opera GX — abrir
 * numa caixa pequena e depois se expandir").
 *
 * Uma janela própria, sem borda, transparente e EXATAMENTE do tamanho e na
 * posição da janela principal (renderer/intro.html): na tela aparece só a caixa
 * pequena no meio; na explosão ela cresce até preencher a área — que é onde a
 * janela principal vai estar. Enquanto isso a principal carrega escondida;
 * quando a animação avisa "revelar", ela aparece embaixo e a abertura some por
 * cima dela; no "fim", a abertura fecha. A página avisa pelo título da janela
 * (sem preload, sem IPC).
 *
 * Travas: clique ou Esc pulam (renderer/intro.js); se a página travar ou cair,
 * a principal aparece em 12 s de qualquer jeito.
 */
function abrirComAbertura(win, { mudo = false, maximizada = false } = {}) {
  // maximizada (19/10): a caixa cresce até a área da tela (sem a barra de tarefas), onde a janela vai abrir
  const { x, y, width, height } = maximizada ? screen.getDisplayMatching(win.getBounds()).workArea : win.getBounds();
  const abertura = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'AuGPT',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });

  let principalPronta = false;
  let revelar = false;
  let mostrada = false;
  const mostrarPrincipal = () => {
    if (mostrada || !principalPronta || !revelar || win.isDestroyed()) return;
    mostrada = true;
    if (maximizada) win.maximize(); // maximize() também mostra a janela
    else win.show();
    if (!abertura.isDestroyed()) abertura.moveTop(); // a abertura continua por cima enquanto some
  };
  const fechar = () => {
    revelar = true;
    mostrarPrincipal();
    if (!abertura.isDestroyed()) abertura.destroy();
    if (!win.isDestroyed() && mostrada) win.focus();
  };

  win.once('ready-to-show', () => {
    principalPronta = true;
    mostrarPrincipal();
  });
  abertura.on('page-title-updated', (evento, titulo) => {
    evento.preventDefault();
    if (titulo === 'augpt:intro-revelar') {
      revelar = true;
      mostrarPrincipal();
    } else if (titulo === 'augpt:intro-fim') {
      fechar();
    }
  });
  // página que não abre ou cai: o app aparece sem a animação
  abertura.webContents.on('did-fail-load', fechar);
  abertura.webContents.on('render-process-gone', fechar);
  const trava = setTimeout(() => {
    principalPronta = true; // mesmo sem o ready-to-show: melhor a janela vazia por um instante que nenhuma
    fechar();
  }, 12000);
  abertura.on('closed', () => clearTimeout(trava));

  abertura.once('ready-to-show', () => abertura.show());
  abertura.loadFile(path.join(__dirname, '..', 'renderer', 'intro.html'), { query: mudo ? { mudo: '1' } : {} });
  return abertura;
}

module.exports = { abrirComAbertura };
