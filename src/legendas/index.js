'use strict';

/**
 * Legendas de vídeo (14/11, pedido do Davi — fase 1 da "dublagem e legendas"): um link ou um arquivo de vídeo vira
 * a legenda no idioma escolhido. Tudo local, com o que o AuGPT já tem: o yt-dlp baixa (src/midia), o ffmpeg tira o
 * áudio, o whisper.cpp do ditado transcreve com os tempos (.srt), o modelo do Ollama traduz em lotes numerados (os
 * tempos não se perdem) e o ffmpeg põe a legenda no vídeo — como faixa (liga e desliga no player, sem refazer o vídeo)
 * ou gravada na imagem (mais lento: refaz o vídeo).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { IDIOMAS } = require('../tradutor');

const NOME = Object.fromEntries(IDIOMAS.map(([id, , en]) => [id, en]));
// ISO 639-2 para a faixa de legenda (o player mostra o nome do idioma)
const ISO3 = { pt: 'por', en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', ja: 'jpn', ko: 'kor', zh: 'zho', ru: 'rus', ar: 'ara', hi: 'hin', nl: 'nld', pl: 'pol', tr: 'tur' };

/* ------------------------------ SRT ------------------------------ */

function lerSrt(texto) {
  return String(texto || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((bloco) => {
      const linhas = bloco.trim().split('\n');
      const i = linhas.findIndex((l) => /-->/.test(l));
      if (i < 0) return null;
      const [inicio, fim] = linhas[i].split('-->').map((t) => t.trim());
      const fala = linhas.slice(i + 1).join(' ').replace(/\s+/g, ' ').trim();
      return fala ? { inicio, fim, texto: fala } : null;
    })
    .filter(Boolean);
}

/** Legenda boa de ler: até 2 linhas, cortadas perto do meio, num espaço. */
function emDuasLinhas(t, maximo = 42) {
  const s = String(t || '').trim();
  if (s.length <= maximo) return s;
  const meio = Math.floor(s.length / 2);
  let corte = -1;
  for (let d = 0; d < meio; d += 1) {
    if (s[meio - d] === ' ') { corte = meio - d; break; }
    if (s[meio + d] === ' ') { corte = meio + d; break; }
  }
  return corte < 0 ? s : `${s.slice(0, corte)}\n${s.slice(corte + 1)}`;
}

const emMs = (t) => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(String(t || ''));
  return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0').slice(0, 3)) : 0;
};

/**
 * Junta os trechos que continuam a mesma frase (14/11, primeiro teste: "…really, really long" | "fronts, and that's
 * cool" — o modelo juntou as duas na tradução e as linhas seguintes desalinharam). Cada legenda vira uma frase
 * inteira, do começo do primeiro trecho ao fim do último, até ~7 s e ~90 letras (2 linhas legíveis).
 */
function juntarFrases(segs, { maxMs = 7000, maxLetras = 90 } = {}) {
  const saida = [];
  for (const s of segs) {
    const ultimo = saida[saida.length - 1];
    const continua = ultimo && !/[.!?…"”)\]]$/.test(ultimo.texto) && emMs(s.fim) - emMs(ultimo.inicio) <= maxMs && ultimo.texto.length + s.texto.length + 1 <= maxLetras && emMs(s.inicio) - emMs(ultimo.fim) < 1500;
    if (continua) saida[saida.length - 1] = { ...ultimo, fim: s.fim, texto: `${ultimo.texto} ${s.texto}` };
    else saida.push({ ...s });
  }
  return saida;
}

const escreverSrt = (segs) => segs.map((s, i) => `${i + 1}\n${s.inicio} --> ${s.fim}\n${emDuasLinhas(s.texto)}\n`).join('\n');

/* ------------------------------ tradução em lotes ------------------------------ */

function mensagensDoLote(linhas, { de, para }) {
  const origem = de && de !== 'auto' ? NOME[de] || de : 'the source language (detect it)';
  return [
    {
      role: 'system',
      content: `You are a professional subtitle translator. Translate subtitle lines from ${origem} to ${NOME[para]}.
Each input line is "N| text". Output the SAME numbers, one line per number, in the same order, as "N| translation".
Rules:
- Never merge, split, skip or add lines: line N of the output translates line N of the input (a sentence can continue on the next line — keep it split the same way).
- Output ONLY the numbered lines: no notes, no explanations.
- Natural, spoken ${NOME[para]}, short like a subtitle; keep names, brands, numbers and units.`,
    },
    { role: 'user', content: linhas.map((l) => `${l.n}| ${l.texto}`).join('\n') },
  ];
}

const lerLote = (saida) => {
  const mapa = new Map();
  for (const linha of String(saida || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n')) {
    const m = /^\s*(\d+)\s*[|:.)-]\s*(.*\S)\s*$/.exec(linha);
    if (m && !mapa.has(Number(m[1]))) mapa.set(Number(m[1]), m[2]);
  }
  return mapa;
};

/**
 * Traduz os segmentos em lotes de `tamanho` linhas numeradas; o que faltar num lote é pedido de novo (só ele) e, se
 * ainda faltar, fica no original. Devolve os segmentos com o texto traduzido e { faltaram }.
 */
async function traduzirSegmentos(segs, { de = 'auto', para, chatStream, host, model, numCtx = 8192, signal, tamanho = 30, aoProgresso = () => {} }) {
  const saida = segs.map((s) => ({ ...s }));
  let faltaram = 0;
  for (let i = 0; i < segs.length; i += tamanho) {
    if (signal?.aborted) throw new Error('interrompida');
    const lote = segs.slice(i, i + tamanho).map((s, k) => ({ n: i + k + 1, texto: s.texto }));
    const pedir = async (linhas) => {
      const r = await chatStream({ host, model, messages: mensagensDoLote(linhas, { de, para }), temperature: 0.2, numCtx: Math.max(numCtx, 8192), numPredict: Math.min(8192, linhas.reduce((t, l) => t + l.texto.length, 0) * 2 + 400), pensar: false, signal, onToken: () => {} });
      return lerLote(r.content);
    };
    let mapa = await pedir(lote);
    const faltam = lote.filter((l) => !mapa.get(l.n));
    if (faltam.length && !signal?.aborted) mapa = new Map([...mapa, ...(await pedir(faltam))]);
    for (const l of lote) {
      const t = mapa.get(l.n);
      if (t) saida[l.n - 1].texto = t;
      else faltaram += 1;
    }
    aoProgresso(Math.min(segs.length, i + tamanho), segs.length);
  }
  return { segmentos: saida, faltaram };
}

/* ------------------------------ processos ------------------------------ */

function rodar(exe, args, { cwd, signal, aoLinha = () => {} } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(exe, args, { cwd, windowsHide: true });
    let erro = '';
    const cancelar = () => p.kill();
    signal?.addEventListener('abort', cancelar, { once: true });
    const linhas = (d) => String(d).split(/\r?\n|\r/).forEach((l) => l.trim() && aoLinha(l.trim()));
    p.stdout.on('data', linhas);
    p.stderr.on('data', (d) => ((erro = (erro + d).slice(-4000)), linhas(d)));
    p.on('error', falha);
    p.on('close', (codigo) => {
      signal?.removeEventListener('abort', cancelar);
      if (signal?.aborted) return falha(new Error('interrompida'));
      return codigo === 0 ? ok(erro) : falha(new Error(erro.trim().split('\n').pop() || `saiu com código ${codigo}`));
    });
  });
}

/** O filtro "subtitles" do ffmpeg quer o caminho com as barras e os dois-pontos escapados. */
const caminhoNoFiltro = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/* ------------------------------ o fluxo ------------------------------ */

/**
 * entrada: link (https://…) ou caminho de um vídeo. para: idioma da legenda ('pt', 'en'…; o mesmo do vídeo = só
 * transcreve). de: idioma falado ou 'auto'. gravar: 'nao' (só os .srt), 'faixa' ou 'fixa'.
 * deps: { midia, ffmpeg (caminho do ffmpeg.exe), whisper: { exe, modelo }, chatStream, host, model, numCtx, pasta, signal, emitir }
 * Devolve { video, srt, srtOriginal, saida, idiomaFalado, segmentos, faltaram, segundos }.
 */
async function legendar({ entrada, para = 'pt', de = 'auto', gravar = 'faixa' }, deps) {
  const { midia, ffmpeg, whisper, signal, emitir = () => {} } = deps;
  const inicio = Date.now();
  if (!whisper?.exe || !whisper?.modelo) throw new Error('as legendas usam o ditado por voz: instale em Ajustes → Voz e ditado');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error('as legendas precisam do ffmpeg (Ajustes → Componentes)');
  if (!NOME[para] || para === 'auto') throw new Error('escolha o idioma da legenda');
  const texto = String(entrada || '').trim();
  if (!texto) throw new Error('cole o link do vídeo ou escolha um arquivo');

  // 1. o vídeo
  let video = texto.replace(/^"|"$/g, '');
  if (/^https?:\/\//i.test(texto)) {
    emitir({ etapa: 'baixando', texto: 'Baixando o vídeo…' });
    video = (await midia.baixar(texto, { tipo: 'video', signal, emitir: (p) => emitir({ etapa: 'baixando', texto: `Baixando o vídeo… ${p.porcento != null ? `${Math.round(p.porcento)}%` : ''}`.trim() }) })).arquivo;
  }
  if (!fs.existsSync(video)) throw new Error('não achei o arquivo do vídeo');
  const pasta = path.dirname(video);
  const base = path.join(pasta, path.basename(video, path.extname(video)));

  // 2. o áudio (16 kHz mono, o que o whisper quer)
  emitir({ etapa: 'audio', texto: 'Separando o áudio…' });
  const wav = path.join(os.tmpdir(), `augpt-legenda-${process.pid}-${Date.now()}.wav`);
  await rodar(ffmpeg, ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { signal });

  try {
    // 3. a transcrição, com os tempos (o .srt sai ao lado do vídeo)
    emitir({ etapa: 'transcrevendo', texto: 'Transcrevendo a fala… 0%' });
    let idiomaFalado = de !== 'auto' ? de : null;
    const nucleos = Math.max(1, Math.min(8, os.cpus().length - 2));
    const log = await rodar(whisper.exe, ['-m', whisper.modelo, '-f', wav, '-l', de === 'auto' ? 'auto' : de, '-t', String(nucleos), '-osrt', '-of', wav.replace(/\.wav$/, ''), '-ml', '84', '-sow', '-pp'], {
      cwd: path.dirname(whisper.exe),
      signal,
      aoLinha: (l) => {
        const pct = /progress\s*=\s*(\d+)%/.exec(l);
        if (pct) emitir({ etapa: 'transcrevendo', texto: `Transcrevendo a fala… ${pct[1]}%` });
        const lang = /auto-detected language:\s*([a-z]{2})/i.exec(l);
        if (lang) idiomaFalado = lang[1].toLowerCase();
      },
    });
    if (!idiomaFalado) idiomaFalado = /auto-detected language:\s*([a-z]{2})/i.exec(log)?.[1]?.toLowerCase() || null;
    // 16/11 (vídeo do Davi: "Obrigado, Gabriel “FalleN” Toledo ｜ …"): o whisper.cpp no Windows não grava em caminho com
    // caractere especial — saía "1 input file(s) failed". Ele grava ao lado do .wav temporário e o Node move.
    const srtOriginal = `${base}.original.srt`;
    const doWhisper = wav.replace(/\.wav$/, '.srt');
    if (!fs.existsSync(doWhisper)) throw new Error('a transcrição não gerou a legenda (o vídeo tem fala?)');
    fs.copyFileSync(doWhisper, srtOriginal);
    fs.rmSync(doWhisper, { force: true });
    const originais = juntarFrases(lerSrt(fs.readFileSync(srtOriginal, 'utf8')));
    if (!originais.length) throw new Error('não ouvi fala nesse vídeo');
    fs.writeFileSync(srtOriginal, escreverSrt(originais));

    // 4. a tradução (o mesmo idioma: só a transcrição)
    let segmentos = originais;
    let faltaram = 0;
    if (idiomaFalado !== para) {
      emitir({ etapa: 'traduzindo', texto: `Traduzindo para ${IDIOMAS.find(([id]) => id === para)?.[1] || para}… 0/${originais.length}` });
      ({ segmentos, faltaram } = await traduzirSegmentos(originais, {
        de: idiomaFalado || 'auto', para, chatStream: deps.chatStream, host: deps.host, model: deps.model, numCtx: deps.numCtx, signal,
        aoProgresso: (feitos, total) => emitir({ etapa: 'traduzindo', texto: `Traduzindo… ${feitos}/${total} falas` }),
      }));
    }
    const srt = idiomaFalado === para ? srtOriginal : `${base}.${para}.srt`;
    fs.writeFileSync(srt, escreverSrt(segmentos));

    // 5. a legenda no vídeo
    let saida = null;
    if (gravar === 'faixa' || gravar === 'fixa') {
      emitir({ etapa: 'gravando', texto: gravar === 'fixa' ? 'Gravando a legenda na imagem (refaz o vídeo, demora)…' : 'Pondo a legenda no vídeo…' });
      const mp4 = /\.mp4$/i.test(video);
      saida = `${base}.legendado${gravar === 'fixa' ? '-na-imagem' : ''}.${para}.${gravar === 'faixa' && !mp4 ? 'mkv' : 'mp4'}`;
      const args = gravar === 'fixa'
        ? ['-y', '-i', video, '-vf', `subtitles='${caminhoNoFiltro(srt)}'`, '-c:a', 'copy', saida]
        : ['-y', '-i', video, '-i', srt, '-map', '0:v', '-map', '0:a?', '-map', '1', '-c', 'copy', '-c:s', mp4 ? 'mov_text' : 'srt', '-metadata:s:s:0', `language=${ISO3[para] || 'und'}`, '-disposition:s:0', 'default', saida];
      await rodar(ffmpeg, args, { signal });
    }
    emitir({ etapa: 'pronto', texto: 'Pronto ✓' });
    return { video, srt, srtOriginal, saida, idiomaFalado, segmentos: segmentos.length, faltaram, segundos: Math.round((Date.now() - inicio) / 1000) };
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

module.exports = { legendar, juntarFrases, emMs, lerSrt, escreverSrt, emDuasLinhas, traduzirSegmentos, lerLote, mensagensDoLote, caminhoNoFiltro };
