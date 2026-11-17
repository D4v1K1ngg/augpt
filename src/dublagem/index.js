'use strict';

/**
 * Dublagem de vídeo (16/11, fase 2 da "dublagem e legendas" do Davi): link ou arquivo → o vídeo com a fala no idioma
 * escolhido, na voz escolhida do Estúdio. Tudo local, com o que já existe:
 *   1. a legenda (src/legendas) baixa, transcreve com os tempos e traduz;
 *   2. o Estúdio de voz gera uma fala por trecho (EstudioDeVoz.falas, sem juntar);
 *   3. cada fala entra no tempo do trecho: se passa do espaço até o próximo, acelera (até 1,5×) — encaixar();
 *   4. o ffmpeg mistura a voz nova com o áudio original baixinho por baixo (a música e o ambiente continuam; separar a
 *      voz original da música pediria outro modelo) e grava o vídeo novo, sem refazer a imagem.
 * A voz é uma das do Estúdio (pronta, descrita ou clonada com autorização) — a voz de quem fala no vídeo não é clonada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { legendar, lerSrt, emMs } = require('../legendas');

// idioma da legenda → idioma do Estúdio (o resto: o modelo descobre pelo texto)
const IDIOMA_DO_ESTUDIO = { pt: 'portuguese', en: 'english', es: 'spanish', fr: 'french', de: 'german', it: 'italian', ja: 'japanese', ko: 'korean', zh: 'chinese', ru: 'russian' };
const ACELERAR_ATE = 1.5;
const FOLGA_MS = 120; // respiro entre uma fala e a próxima

/**
 * Onde e em que velocidade cada fala entra. segs: [{ inicio, fim }] em ms; duracoes: segundos de cada fala.
 * A fala pode passar do fim do trecho, até o começo do próximo (menos a folga); se nem assim couber, acelera até
 * ACELERAR_ATE; o que sobrar ainda passa um pouco (melhor que cortar a fala no meio).
 */
function encaixar(segs, duracoes, { acelerarAte = ACELERAR_ATE, folga = FOLGA_MS } = {}) {
  return segs.map((s, i) => {
    const dur = Math.max(0, Number(duracoes[i]) || 0) * 1000;
    const proximo = segs[i + 1]?.inicio;
    const espaco = Math.max(300, (proximo ?? s.fim + dur) - s.inicio - (proximo == null ? 0 : folga));
    const velocidade = dur > espaco ? Math.min(acelerarAte, dur / espaco) : 1;
    return { inicio: s.inicio, velocidade: Math.round(velocidade * 100) / 100, duracao: Math.round(dur / velocidade) };
  });
}

/** Soma as falas (PCM 16 bits mono) numa faixa do tamanho do vídeo, cada uma no seu início; satura em vez de estourar. */
function montarFaixa(falas, { taxa, totalMs }) {
  const fim = Math.max(totalMs || 0, ...falas.map((f) => f.inicio + (f.amostras.length / taxa) * 1000));
  const faixa = new Int16Array(Math.ceil((fim / 1000) * taxa) + taxa);
  for (const f of falas) {
    const o = Math.round((f.inicio / 1000) * taxa);
    for (let k = 0; k < f.amostras.length; k += 1) faixa[o + k] = Math.max(-32768, Math.min(32767, faixa[o + k] + f.amostras[k]));
  }
  return faixa;
}

function rodar(exe, args, { signal } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(exe, args, { windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => (erro = `${erro}${d}`.slice(-2000)));
    const parar = () => p.kill();
    signal?.addEventListener('abort', parar, { once: true });
    p.on('error', falha);
    p.on('close', (c) => {
      signal?.removeEventListener('abort', parar);
      if (signal?.aborted) return falha(new Error('interrompida'));
      return c === 0 ? ok() : falha(new Error(erro.trim().split('\n').slice(-2).join(' ').slice(0, 300) || `ffmpeg saiu com ${c}`));
    });
  });
}

/** O vídeo tem áudio? (sem áudio, a faixa nova vai sozinha) */
function temAudio(ffmpeg, video) {
  return new Promise((ok) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-i', video], { windowsHide: true });
    let saida = '';
    p.stderr.on('data', (d) => (saida += d));
    p.on('close', () => ok(/Stream #\S+.*Audio:/.test(saida)));
    p.on('error', () => ok(false));
  });
}

/**
 * dublar({ entrada, para, de, voz, fundo }, deps)
 *  voz: as opções do Estúdio (motor, modo, instrucao, vozSalva, voz…); fundo: volume do áudio original (0 = sem) ou
 *  'separado' (17/11: o Demucs tira a voz original — a dublagem vai sobre a música e o ambiente, sem a voz de antes).
 *  deps: os da legenda (midia, ffmpeg, whisper, chatStream, host, model, numCtx, signal, emitir) + estudio (EstudioDeVoz).
 */
async function dublar({ entrada, para = 'pt', de = 'auto', voz = {}, fundo = 0.15 }, deps) {
  const { ffmpeg, estudio, signal, emitir = () => {} } = deps;
  if (!estudio) throw new Error('a dublagem usa o Estúdio de voz: instale o motor de voz lá');
  const inicio = Date.now();
  // 1. legenda traduzida (os tempos de cada fala)
  const leg = await legendar({ entrada, para, de, gravar: 'nao' }, deps);
  const segs = lerSrt(fs.readFileSync(leg.srt, 'utf8')).map((s) => ({ inicio: emMs(s.inicio), fim: emMs(s.fim), texto: s.texto }));
  if (!segs.length) throw new Error('não ouvi fala nesse vídeo');
  // 1b. a voz original sai: o fundo (música, ambiente) separado pelo Demucs, na placa
  const separado = fundo === 'separado';
  const pastaDoFundo = separado ? fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-fundo-')) : null;
  const soFundo = separado ? path.join(pastaDoFundo, 'fundo.wav') : null;
  if (separado) {
    if (!estudio.separadorInstalado?.()) throw new Error('o separador de voz não está instalado (Tradutor → Legendas e dublagem → Instalar o separador)');
    await estudio.separar(leg.video, { voz: path.join(pastaDoFundo, 'voz-original.wav'), fundo: soFundo, signal, emitir: (p) => emitir({ etapa: 'separando', texto: p.texto }) });
  }
  // 2. uma fala por trecho
  emitir({ etapa: 'falando', texto: `Gerando as falas… 0/${segs.length}` });
  const f = await estudio.falas({ ...voz, idioma: IDIOMA_DO_ESTUDIO[para] || 'auto', legenda: false }, segs.map((s) => s.texto), {
    emitir: (p) => emitir({ etapa: 'falando', texto: p.parte ? `Gerando as falas… ${p.parte}/${p.de || segs.length}` : `Gerando as falas… ${p.texto || ''}`.trim() }),
  });
  try {
    // 3. cada fala no seu tempo (acelera o que não cabe) e a faixa inteira
    emitir({ etapa: 'encaixando', texto: 'Encaixando as falas no tempo do vídeo…' });
    const plano = encaixar(segs, f.partes.map((p) => p.segundos));
    const falas = [];
    for (const [i, p] of f.partes.entries()) {
      const raw = path.join(f.tmp, `fala-${i}.raw`);
      const vel = plano[i].velocidade;
      await rodar(ffmpeg, ['-y', '-i', p.arquivo, ...(vel > 1.01 ? ['-af', `atempo=${vel}`] : []), '-ac', '1', '-ar', String(f.taxa), '-f', 's16le', raw], { signal });
      const b = fs.readFileSync(raw);
      falas.push({ inicio: plano[i].inicio, amostras: new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)) });
    }
    const faixa = montarFaixa(falas, { taxa: f.taxa, totalMs: segs.at(-1).fim });
    const voz16 = path.join(f.tmp, 'voz.raw');
    fs.writeFileSync(voz16, Buffer.from(faixa.buffer));
    // 4. o vídeo novo: a imagem copiada, a voz nova e o original baixinho por baixo
    emitir({ etapa: 'gravando', texto: 'Gravando o vídeo dublado…' });
    const base = leg.video.replace(/\.[^.]+$/, '');
    const saida = `${base}.dublado.${para}.mp4`;
    const comFundo = !separado && Number(fundo) > 0 && (await temAudio(ffmpeg, leg.video));
    const voz = ['-f', 's16le', '-ar', String(f.taxa), '-ac', '1', '-i', voz16];
    const args = separado
      ? ['-y', '-i', leg.video, ...voz, '-i', soFundo, '-filter_complex', '[2:a]aresample=48000[f];[1:a]aresample=48000[v];[f][v]amix=inputs=2:duration=first:normalize=0[a]', '-map', '0:v', '-map', '[a]']
      : comFundo
      ? ['-y', '-i', leg.video, ...voz, '-filter_complex', `[0:a]volume=${Number(fundo)}[f];[1:a]aresample=48000[v];[f][v]amix=inputs=2:duration=first:normalize=0[a]`, '-map', '0:v', '-map', '[a]']
      // a faixa de voz acaba na última fala: o apad completa com silêncio até o fim do vídeo (sem ele, o -shortest cortava
      // o vídeo ali — a música do fim sumia)
      : ['-y', '-i', leg.video, ...voz, '-filter_complex', '[1:a]aresample=48000,apad[a]', '-map', '0:v', '-map', '[a]', '-shortest'];
    await rodar(ffmpeg, [...args, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', saida], { signal });
    emitir({ etapa: 'pronto', texto: 'Pronto ✓' });
    return {
      saida, video: leg.video, srt: leg.srt, idiomaFalado: leg.idiomaFalado, falas: segs.length, semVozOriginal: separado, faltaram: leg.faltaram || 0,
      aceleradas: plano.filter((p) => p.velocidade > 1.05).length, segundos: Math.round((Date.now() - inicio) / 1000),
    };
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    if (pastaDoFundo) fs.rmSync(pastaDoFundo, { recursive: true, force: true });
  }
}

module.exports = { dublar, encaixar, montarFaixa, IDIOMA_DO_ESTUDIO };
