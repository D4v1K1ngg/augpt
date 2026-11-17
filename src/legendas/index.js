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

/*
 * O idioma de uma fala pelas palavras dela (17/11, Davi: "ele dublou em inglês"): o whisper detecta o idioma só pelos
 * primeiros 30 s — num vídeo que começa com música ou com alguém falando português, o vídeo inteiro era "português" e
 * nada era traduzido. Agora cada fala é conferida: só a que já está no idioma pedido fica como está.
 */
const PALAVRAS = {
  pt: ['que', 'não', 'nao', 'uma', 'com', 'para', 'você', 'voce', 'isso', 'mais', 'muito', 'então', 'entao', 'está', 'esta', 'são', 'sao', 'também', 'tambem', 'aqui', 'eu', 'ele', 'ela', 'nós', 'nos', 'mas', 'como', 'do', 'da', 'dos', 'das', 'no', 'na', 'é', 'foi', 'tem', 'gente', 'cara', 'porque', 'quando', 'sempre', 'ainda', 'agora'],
  en: ['the', 'and', 'you', 'that', 'is', 'it', 'to', 'of', 'in', 'was', 'for', 'with', 'this', 'have', 'are', 'what', 'but', 'they', 'he', 'she', 'we', 'just', 'like', 'so', 'be', 'not', 'there', 'do', 'know', 'think', 'really', 'my', 'me', 'your', 'can', 'all', 'about', 'when', 'one', 'would', 'been', 'from'],
  es: ['que', 'el', 'los', 'las', 'una', 'con', 'para', 'pero', 'como', 'muy', 'está', 'es', 'yo', 'tú', 'usted', 'nosotros', 'del', 'lo', 'por', 'porque', 'también', 'aquí', 'ahora', 'eso', 'esto', 'hay', 'tiene', 'bueno'],
  fr: ['le', 'la', 'les', 'des', 'est', 'et', 'que', 'qui', 'pas', 'pour', 'une', 'avec', 'dans', 'je', 'tu', 'nous', 'vous', 'mais', 'très', 'c\'est', 'ce', 'du', 'au', 'sur'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'wir', 'sie', 'mit', 'auf', 'ein', 'eine', 'zu', 'den', 'dem', 'auch', 'aber', 'sehr', 'wie', 'was'],
  it: ['il', 'che', 'non', 'una', 'con', 'per', 'sono', 'è', 'della', 'del', 'gli', 'questo', 'anche', 'ma', 'molto', 'come', 'io', 'noi', 'voi', 'perché'],
};
const PALAVRAS_SET = Object.fromEntries(Object.entries(PALAVRAS).map(([k, v]) => [k, new Set(v)]));

/** O idioma provável de um texto (pt, en, es, fr, de, it) pelas palavras comuns; null quando não dá para dizer. */
function idiomaDoTexto(texto) {
  const palavras = String(texto || '').toLowerCase().match(/[\p{L}']+/gu) || [];
  if (palavras.length < 2) return null;
  const pontos = Object.entries(PALAVRAS_SET).map(([id, set]) => [id, palavras.filter((p) => set.has(p)).length]).sort((a, b) => b[1] - a[1]);
  const [primeiro, segundo] = pontos;
  // empate (pt × es dividem muitas palavras) ou nenhum sinal: não dá para dizer
  if (!primeiro[1] || primeiro[1] === segundo[1]) return null;
  // acento e "ã/õ/ç" desempatam português de espanhol
  if ((primeiro[0] === 'es' || primeiro[0] === 'pt') && /[ãõç]/i.test(texto)) return 'pt';
  return primeiro[0];
}

/** A fala precisa de tradução para \`para\`? Só não precisa quando dá para ver que ela já está nesse idioma. */
const precisaTraduzir = (texto, para) => idiomaDoTexto(texto) !== para;

/**
 * Traduz os segmentos em lotes de \`tamanho\` linhas numeradas; o que faltar num lote é pedido de novo (só ele) e, se
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
    // "traduzida" igual ao original e ainda em outro idioma = o modelo devolveu sem traduzir (17/11): pede de novo
    const valida = (l, t) => {
      if (!t) return false;
      const origem = idiomaDoTexto(l.texto);
      // igual ao original só vale para nome, número ou fala que já estava no idioma pedido ("FalleN", "2012")
      if (t.trim().toLowerCase() === l.texto.trim().toLowerCase()) return origem === null || origem === para;
      const saiu = idiomaDoTexto(t);
      return saiu === null || saiu === para || saiu !== origem;
    };
    let mapa = await pedir(lote);
    for (const l of lote) if (!valida(l, mapa.get(l.n))) mapa.delete(l.n);
    const faltam = lote.filter((l) => !mapa.get(l.n));
    if (faltam.length && !signal?.aborted) {
      const de2 = await pedir(faltam);
      for (const l of faltam) if (valida(l, de2.get(l.n))) mapa.set(l.n, de2.get(l.n));
    }
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
  if (!(whisper?.exe || whisper?.gpu) || !whisper?.modelo) throw new Error('as legendas usam o ditado por voz: instale em Ajustes → Voz e ditado');
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
    // 17/11: na placa de vídeo quando o whisper com CUDA está instalado (4,5 min de fala: 83 s no processador, 5 s na
    // RTX 5070 Ti); se ele falhar (sem memória na placa, driver), refaz no processador
    const naPlaca = Boolean(whisper.gpu && fs.existsSync(whisper.gpu));
    emitir({ etapa: 'transcrevendo', texto: `Transcrevendo a fala${naPlaca ? ' na placa de vídeo' : ''}… 0%` });
    let idiomaFalado = de !== 'auto' ? de : null;
    const nucleos = Math.max(1, Math.min(8, os.cpus().length - 2));
    const transcrever = (exe, ondeTexto) => rodar(exe, ['-m', whisper.modelo, '-f', wav, '-l', de === 'auto' ? 'auto' : de, '-t', String(nucleos), '-osrt', '-of', wav.replace(/\.wav$/, ''), '-ml', '84', '-sow', '-pp'], {
      cwd: path.dirname(exe),
      signal,
      aoLinha: (l) => {
        const pct = /progress\s*=\s*(\d+)%/.exec(l);
        if (pct) emitir({ etapa: 'transcrevendo', texto: `Transcrevendo a fala${ondeTexto}… ${pct[1]}%` });
        const lang = /auto-detected language:\s*([a-z]{2})/i.exec(l);
        if (lang) idiomaFalado = lang[1].toLowerCase();
      },
    });
    let log;
    try {
      log = await transcrever(naPlaca ? whisper.gpu : whisper.exe, naPlaca ? ' na placa de vídeo' : '');
    } catch (err) {
      if (!naPlaca || signal?.aborted || !whisper.exe) throw err;
      emitir({ etapa: 'transcrevendo', texto: 'A placa de vídeo não deu conta: transcrevendo no processador… 0%' });
      log = await transcrever(whisper.exe, ' no processador');
    }
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
    // cada fala pelo idioma dela (17/11): o whisper detecta só pelos primeiros 30 s
    const indices = originais.map((s, i) => (precisaTraduzir(s.texto, para) ? i : -1)).filter((i) => i >= 0);
    if (indices.length) {
      emitir({ etapa: 'traduzindo', texto: `Traduzindo para ${IDIOMAS.find(([id]) => id === para)?.[1] || para}… 0/${indices.length}` });
      const r = await traduzirSegmentos(indices.map((i) => originais[i]), {
        de: 'auto', para, chatStream: deps.chatStream, host: deps.host, model: deps.model, numCtx: deps.numCtx, signal,
        aoProgresso: (feitos, total) => emitir({ etapa: 'traduzindo', texto: `Traduzindo… ${feitos}/${total} falas` }),
      });
      segmentos = originais.map((s) => ({ ...s }));
      indices.forEach((i, k) => (segmentos[i] = r.segmentos[k]));
      faltaram = r.faltaram;
    }
    const srt = !indices.length ? srtOriginal : `${base}.${para}.srt`;
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

module.exports = { idiomaDoTexto, precisaTraduzir, legendar, juntarFrases, emMs, lerSrt, escreverSrt, emDuasLinhas, traduzirSegmentos, lerLote, mensagensDoLote, caminhoNoFiltro };
