'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow } = require('electron');
const { protegerSessaoWeb } = require('./sessao-segura');
const { pdf: extrairPdf } = require('../src/formatos/pdf');

const LIMITE_DO_PDF = 40e6;
const escapar = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

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

    // link que vira download (19/10, print do Davi: "Estatistica-Notas-de-Aula.pdf/at_download/file"
    // abria a janela "Salvar como" do Windows no meio da pesquisa). PDF: baixa calado numa pasta
    // temporária, extrai o texto e APAGA o arquivo; o texto volta como página. Outro tipo: cancela.
    let baixando = false;
    janela.webContents.session.on('will-download', (_evento, item) => {
      baixando = true;
      const nome = `${item.getFilename()} ${item.getURL()}`;
      const ehPdf = /pdf/i.test(item.getMimeType()) || /\.pdf\b/i.test(nome);
      if (!ehPdf || item.getTotalBytes() > LIMITE_DO_PDF) {
        item.cancel();
        encerrar(new Error(ehPdf ? 'PDF grande demais para ler' : `a página é um download (${item.getMimeType() || 'arquivo'}), não um texto`));
        return;
      }
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-leitura-'));
      const arquivo = path.join(pasta, 'documento.pdf');
      item.setSavePath(arquivo); // com o caminho definido, o Electron não abre a janela "Salvar como"
      item.on('updated', () => {
        if (item.getReceivedBytes() > LIMITE_DO_PDF) item.cancel();
      });
      item.once('done', (_e, estado) => {
        try {
          if (estado !== 'completed') throw new Error('o download do PDF não terminou');
          const extraido = extrairPdf(fs.readFileSync(arquivo), { limite: 60000 });
          if (!extraido.texto || extraido.texto.trim().length < 40 || extraido.meta?.aviso) throw new Error(`pdf: ${extraido.meta?.aviso || 'sem texto extraível'}`);
          encerrar(null, `<html><head><title>${escapar(item.getFilename())}</title></head><body><pre>${escapar(extraido.texto)}</pre></body></html>`);
        } catch (err) {
          encerrar(err);
        } finally {
          fs.rmSync(pasta, { recursive: true, force: true });
        }
      });
    });

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

    // a navegação que vira download "falha" (ERR_ABORTED): aí quem encerra é o fim do download
    // ... e o loadURL rejeita ANTES do aviso de download (medido: 69 ms x 71 ms): espera um instante
    janela.loadURL(url, { userAgent: janela.webContents.getUserAgent() }).catch((err) => {
      setTimeout(() => {
        if (!baixando) encerrar(err);
      }, 1500);
    });
  });
}

module.exports = { renderizar };
