'use strict';

/**
 * Baixar vídeos e músicas (30/10, pedido do Davi): o yt-dlp (src/ytdlp.js) baixa, o ffmpeg (src/ffmpeg.js) junta o
 * vídeo e o áudio em até 1080p e converte para MP3. Sem o ffmpeg ainda dá: vídeo num arquivo só (qualidade menor)
 * e áudio em M4A. Um link por vez (playlist fica de fora: --no-playlist). Conteúdo com proteção (DRM) não é baixado —
 * o yt-dlp não contorna, e o AuGPT também não tenta.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { idDoVideo } = require('./ytdlp');

/** Os formatos do yt-dlp: vídeo e áudio, com e sem o ffmpeg. */
function argumentosDoFormato(tipo, comFfmpeg) {
  if (tipo === 'audio') return comFfmpeg ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0'] : ['-f', 'ba[ext=m4a]/ba'];
  return comFfmpeg
    ? ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4']
    : ['-f', 'b[ext=mp4][height<=1080]/b[height<=1080]/b'];
}

/** Uma linha de progresso do yt-dlp ("[download]  45.3% of ~ 12.34MiB at …") → 45.3, ou null. */
function porcentoDaLinha(linha) {
  const m = /^\[download\]\s+([\d.]+)%/.exec(String(linha || '').trim());
  return m ? Math.min(100, Number(m[1])) : null;
}

/** O que a linha diz que está acontecendo, para mostrar ("juntando vídeo e áudio", "convertendo para MP3"). */
function etapaDaLinha(linha) {
  const t = String(linha || '');
  if (/^\[Merger\]/.test(t)) return 'juntando vídeo e áudio';
  if (/^\[ExtractAudio\]/.test(t)) return 'convertendo para MP3';
  if (/^\[download\] Destination:/.test(t)) return 'baixando';
  if (/has already been downloaded/.test(t)) return 'já estava baixado';
  return null;
}

/** Só endereço da web (http/https) — nada de arquivo local, comando ou rede da casa. */
function enderecoValido(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/^https?:$/.test(u.protocol)) return false;
    return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i.test(u.hostname);
  } catch {
    return false;
  }
}

class Midia {
  /** ytdlp: caminho do yt-dlp; ffmpegDir: a pasta do ffmpeg (ou null); pasta: onde salvar (Downloads\AuGPT). */
  constructor({ ytdlp, ffmpegDir = null, pasta, gerar = spawn } = {}) {
    this.ytdlp = ytdlp;
    this.ffmpegDir = ffmpegDir && fs.existsSync(path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')) ? ffmpegDir : null;
    this.pasta = pasta;
    this.gerar = gerar;
  }

  /** Os dados do vídeo (título, canal, duração, miniatura), sem baixar. */
  info(url) {
    if (!enderecoValido(url)) return Promise.reject(new Error('endereço inválido — mande o link do vídeo (https://…)'));
    return new Promise((ok, falha) => {
      const p = this.gerar(this.ytdlp, [url, '-J', '--no-playlist', '--no-warnings', '--skip-download'], { windowsHide: true });
      let saida = '';
      let erro = '';
      const relogio = setTimeout(() => p.kill(), 60000);
      p.stdout.on('data', (d) => (saida += d));
      p.stderr.on('data', (d) => (erro += d));
      p.on('error', falha);
      p.on('close', (codigo) => {
        clearTimeout(relogio);
        if (codigo !== 0) return falha(new Error(String(erro).trim().split('\n').pop() || 'o yt-dlp não conseguiu ler esse link'));
        try {
          const j = JSON.parse(saida);
          const id = idDoVideo(url);
          ok({
            url: j.webpage_url || url,
            titulo: j.title || '',
            canal: j.channel || j.uploader || '',
            duracao: j.duration || null,
            miniatura: j.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null),
            site: j.extractor_key || '',
          });
        } catch {
          falha(new Error('resposta do yt-dlp ilegível'));
        }
      });
    });
  }

  /**
   * Baixa: tipo 'video' ou 'audio'. emitir({ porcento, texto }) a cada linha; signal cancela.
   * @returns {Promise<{ arquivo: string, bytes: number }>}
   */
  baixar(url, { tipo = 'video', emitir = () => {}, signal } = {}) {
    if (!enderecoValido(url)) return Promise.reject(new Error('endereço inválido'));
    fs.mkdirSync(this.pasta, { recursive: true });
    const args = [
      url, '--no-playlist', '--newline', '--no-warnings', '--windows-filenames',
      '-P', this.pasta, '-o', '%(title).150B [%(id)s].%(ext)s',
      ...(this.ffmpegDir ? ['--ffmpeg-location', this.ffmpegDir] : []),
      ...argumentosDoFormato(tipo, Boolean(this.ffmpegDir)),
      // o caminho final (depois de juntar ou converter) sai numa linha marcada
      '--print', 'after_move:AUGPT_ARQUIVO=%(filepath)s',
    ];
    return new Promise((ok, falha) => {
      const p = this.gerar(this.ytdlp, args, { windowsHide: true });
      let arquivo = null;
      let ultimoErro = '';
      let resto = '';
      const aoCancelar = () => p.kill();
      signal?.addEventListener('abort', aoCancelar, { once: true });
      const linha = (l) => {
        const t = l.trim();
        if (!t) return;
        if (t.startsWith('AUGPT_ARQUIVO=')) {
          arquivo = t.slice('AUGPT_ARQUIVO='.length);
          return;
        }
        const porcento = porcentoDaLinha(t);
        const etapa = etapaDaLinha(t);
        if (porcento !== null || etapa) emitir({ porcento, texto: etapa });
      };
      p.stdout.on('data', (d) => {
        resto += d;
        const linhas = resto.split(/\r?\n/);
        resto = linhas.pop();
        linhas.forEach(linha);
      });
      p.stderr.on('data', (d) => {
        const t = String(d).trim();
        if (/ERROR/.test(t)) ultimoErro = t.split('\n').pop();
      });
      p.on('error', falha);
      p.on('close', (codigo) => {
        signal?.removeEventListener('abort', aoCancelar);
        if (resto) linha(resto);
        if (signal?.aborted) return falha(new Error('cancelado'));
        if (codigo !== 0 || !arquivo) return falha(new Error(ultimoErro.replace(/^ERROR:\s*/, '') || 'o download não terminou'));
        let bytes = 0;
        try {
          bytes = fs.statSync(arquivo).size;
        } catch {
          // o arquivo pode ter sido movido: o caminho continua
        }
        ok({ arquivo, bytes });
      });
    });
  }
}

module.exports = { Midia, argumentosDoFormato, porcentoDaLinha, etapaDaLinha, enderecoValido };
