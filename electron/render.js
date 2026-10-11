'use strict';

const { BrowserWindow } = require('electron');
const { protegerSessaoWeb } = require('./sessao-segura');

/**
 * Renderiza uma página num BrowserWindow invisível e devolve o HTML já montado.
 * É o que resolve site que só existe depois que o JavaScript roda — sem depender
 * de nenhum serviço externo, porque o Electron já traz o Chromium.
 */
function renderizar(url, { timeout = 25000, esperaExtra = 1200, obterConfig = () => ({}) } = {}) {
  return new Promise((resolve, reject) => {
    let janela = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        offscreen: true,
        javascript: true,
        images: false,
        webgl: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: `augpt-leitura-${Date.now()}`, // sessão descartável, sem cookies persistidos
      },
    });

    let encerrado = false;
    const encerrar = (erro, html) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(cronometro);
      try {
        if (janela && !janela.isDestroyed()) janela.destroy();
      } catch {
        /* já foi */
      }
      janela = null;
      if (erro) reject(erro);
      else resolve(html);
    };

    const cronometro = setTimeout(() => encerrar(new Error('tempo esgotado ao renderizar')), timeout);

    janela.webContents.setAudioMuted(true);
    // Fase 1 de segurança: mesma proteção do navegador do agente — sem
    // permissões e sem requisição pra rede local (ver electron/sessao-segura.js).
    protegerSessaoWeb(janela.webContents.session, { obterConfig });

    janela.webContents.on('did-finish-load', () => {
      // dá um respiro para conteúdo que chega por XHR depois do load
      setTimeout(async () => {
        try {
          const html = await janela.webContents.executeJavaScript(
            'document.documentElement.outerHTML',
            true
          );
          encerrar(null, html);
        } catch (err) {
          encerrar(err);
        }
      }, esperaExtra);
    });

    janela.webContents.on('did-fail-load', (_e, codigo, descricao) => {
      if (codigo === -3) return; // abortado por redirecionamento, ignora
      encerrar(new Error(`falha ao carregar (${codigo}: ${descricao})`));
    });

    janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    janela.loadURL(url, { userAgent: janela.webContents.getUserAgent() }).catch((err) => encerrar(err));
  });
}

module.exports = { renderizar };
