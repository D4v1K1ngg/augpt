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
const { legendar, lerSrt, emMs, escreverSrt } = require('../legendas');
const diretor = require('./diretor');

// idioma da legenda → idioma do Estúdio (o resto: o modelo descobre pelo texto)
const IDIOMA_DO_ESTUDIO = { pt: 'portuguese', en: 'english', es: 'spanish', fr: 'french', de: 'german', it: 'italian', ja: 'japanese', ko: 'korean', zh: 'chinese', ru: 'russian' };
const ACELERAR_ATE = 1.5;
/*
 * A voz âncora (17/11, Davi: "o Narrador fica trocando de timbre durante o vídeo"): a voz descrita cria uma voz nova a cada
 * geração — em dezenas de falas curtas, o timbre muda. Antes das falas, a voz descrita lê UMA frase; todas as falas do
 * vídeo clonam essa frase (a mesma pessoa do começo ao fim). A voz clonada do usuário já é fixa e fica como está.
 */
const FRASE_DA_ANCORA = {
  pt: 'Olá! Eu sou o narrador deste vídeo. Vou contar tudo com calma, clareza e boa entonação, do começo ao fim.',
  en: 'Hello! I am the narrator of this video. I will tell you everything calmly, clearly and with good intonation, from start to finish.',
  es: '¡Hola! Soy el narrador de este video. Voy a contarlo todo con calma, claridad y buena entonación, de principio a fin.',
  fr: 'Bonjour ! Je suis le narrateur de cette vidéo. Je vais tout raconter avec calme, clarté et une bonne intonation, du début à la fin.',
  de: 'Hallo! Ich bin der Sprecher dieses Videos. Ich erzähle alles ruhig, klar und mit guter Betonung, vom Anfang bis zum Ende.',
  it: 'Ciao! Sono il narratore di questo video. Racconterò tutto con calma, chiarezza e una buona intonazione, dall\'inizio alla fine.',
};
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
async function dublar({ entrada, para = 'pt', de = 'auto', voz = {}, fundo = 0.15, srt = null, fundoPronto = null }, deps) {
  const { ffmpeg, estudio, signal, emitir = () => {} } = deps;
  if (!estudio) throw new Error('a dublagem usa o Estúdio de voz: instale o motor de voz lá');
  const inicio = Date.now();
  // 1. legenda traduzida (os tempos de cada fala)
  // 17/11 (Studio): com a legenda pronta (a que o usuário editou), não transcreve nem traduz de novo
  const leg = srt && fs.existsSync(srt) && fs.existsSync(entrada) ? { video: entrada, srt, idiomaFalado: null, faltaram: 0 } : await legendar({ entrada, para, de, gravar: 'nao' }, deps);
  const segs = lerSrt(fs.readFileSync(leg.srt, 'utf8')).map((s) => ({ inicio: emMs(s.inicio), fim: emMs(s.fim), texto: s.texto }));
  if (!segs.length) throw new Error('não ouvi fala nesse vídeo');
  // 1b. a voz original sai: o fundo (música, ambiente) separado pelo Demucs, na placa
  const separado = fundo === 'separado';
  const pastaDoFundo = separado ? fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-fundo-')) : null;
  const soFundo = separado ? path.join(pastaDoFundo, 'fundo.wav') : null;
  if (separado && fundoPronto && fs.existsSync(fundoPronto)) {
    fs.copyFileSync(fundoPronto, soFundo); // o Studio já separou: reaproveita
  } else if (separado) {
    if (!estudio.separadorInstalado?.()) throw new Error('o separador de voz não está instalado (Tradutor → Legendas e dublagem → Instalar o separador)');
    await estudio.separar(leg.video, { voz: path.join(pastaDoFundo, 'voz-original.wav'), fundo: soFundo, signal, emitir: (p) => emitir({ etapa: 'separando', texto: p.texto }) });
  }
  // 2. o diretor (17/11): cada fala no tempo do trecho original; as longas demais o Qwen encurta antes de gerar
  const alvos = diretor.tempoAlvo(segs);
  const comDuracao = (voz.motor || 'omni') === 'omni'; // o Qwen3-TTS não tem duração fixa: fica o encaixe por aceleração
  const llm = { chatStream: deps.chatStream, host: deps.host, model: deps.model, numCtx: deps.numCtx, signal, para };
  let textos = segs.map((s) => s.texto);
  const longas = diretor.longasDemais(textos, alvos);
  let encurtadas = 0;
  if (longas.length) {
    emitir({ etapa: 'diretor', texto: `Diretor: encurtando ${longas.length} falas longas demais para o tempo do vídeo…` });
    ({ textos, mudaram: encurtadas } = await diretor.reescrever(textos, longas, llm));
  }
  let opcoesDaVoz = { ...voz, idioma: IDIOMA_DO_ESTUDIO[para] || 'auto', legenda: false, margem: 0.03, suavizar: 0.03, semente: Number.isFinite(Number(voz.semente)) ? Number(voz.semente) : 1234 };
  // a voz âncora: uma frase com a voz descrita (ou automática), e as falas clonam essa frase — o timbre não muda
  let ancora = null;
  if (comDuracao && voz.modo !== 'clonar') {
    emitir({ etapa: 'falando', texto: 'Fixando a voz do narrador…' });
    const frase = FRASE_DA_ANCORA[para] || FRASE_DA_ANCORA.en;
    const r = await estudio.falas(opcoesDaVoz, [frase]);
    ancora = path.join(os.tmpdir(), `augpt-ancora-${process.pid}-${Date.now()}.wav`);
    fs.copyFileSync(r.partes[0].arquivo, ancora);
    fs.rmSync(r.tmp, { recursive: true, force: true });
    opcoesDaVoz = { ...opcoesDaVoz, modo: 'clonar', referenciaFixa: { audio: ancora, texto: frase }, instrucao: undefined };
  }
  const duracoesDe = (idx) => (comDuracao ? idx.map((i) => Math.round(alvos[i]) / 1000) : null);
  emitir({ etapa: 'falando', texto: `Gerando as falas… 0/${segs.length}` });
  const f = await estudio.falas(opcoesDaVoz, textos, {
    duracoes: duracoesDe(textos.map((_, i) => i)),
    emitir: (p) => emitir({ etapa: 'falando', texto: p.parte ? `Gerando as falas… ${p.parte}/${p.de || segs.length}` : `Gerando as falas… ${p.texto || ''}`.trim() }),
  });
  // 2b. o diretor ouve (o whisper na placa): fala que não se entende volta ao Qwen, mais simples, e é gerada de novo
  let refeitas = 0;
  let nota = null;
  if (deps.whisper?.modelo) {
    try {
      emitir({ etapa: 'diretor', texto: 'Diretor: ouvindo as falas geradas…' });
      const ouvidas = await diretor.ouvir(f.partes.map((p) => p.arquivo), textos, { ffmpeg, whisper: deps.whisper, para, pasta: f.tmp, signal });
      if (ouvidas) {
        const ruins = ouvidas.map((o, i) => ({ i, nota: o.nota })).filter((o) => o.nota < 0.55 && diretor.tamanho(textos[o.i]) >= 6);
        if (ruins.length) {
          emitir({ etapa: 'diretor', texto: `Diretor: refazendo ${ruins.length} falas que não ficaram claras…` });
          const alvo = ruins.map(({ i }) => ({ i, limite: Math.max(8, Math.floor((alvos[i] / 1000) * diretor.CPS * 0.85)) }));
          const r = await diretor.reescrever(textos, alvo, { ...llm, motivo: 'clara' });
          const idx = ruins.map((x) => x.i).filter((i) => r.textos[i] !== textos[i]);
          if (idx.length) {
            textos = r.textos;
            const de2 = await estudio.falas(opcoesDaVoz, idx.map((i) => textos[i]), { duracoes: duracoesDe(idx) });
            idx.forEach((i, k) => {
              const novo = path.join(f.tmp, `refeita-${i}.wav`);
              fs.copyFileSync(de2.partes[k].arquivo, novo);
              f.partes[i] = { arquivo: novo, segundos: de2.partes[k].segundos };
            });
            fs.rmSync(de2.tmp, { recursive: true, force: true });
            refeitas = idx.length;
          }
        }
        nota = Math.round((ouvidas.reduce((t, o) => t + o.nota, 0) / ouvidas.length) * 100);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      emitir({ etapa: 'diretor', texto: `Diretor: não consegui ouvir as falas (${err.message}) — segue sem a conferência` });
    }
  }
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
    // o que a dublagem falou (com os cortes do diretor), ao lado do vídeo
    try {
      const ms = (x) => new Date(Math.max(0, Math.round(x))).toISOString().slice(11, 23).replace('.', ',');
      fs.writeFileSync(`${leg.video.replace(/\.[^.]+$/, '')}.roteiro-da-dublagem.${para}.srt`, escreverSrt(segs.map((s, i) => ({ inicio: ms(s.inicio), fim: ms(s.inicio + alvos[i]), texto: textos[i] }))));
    } catch {
      /* só um registro */
    }
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
      encurtadas, refeitas, nota,
    };
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    if (pastaDoFundo) fs.rmSync(pastaDoFundo, { recursive: true, force: true });
    if (ancora) fs.rmSync(ancora, { force: true });
  }
}

module.exports = { dublar, encaixar, montarFaixa, IDIOMA_DO_ESTUDIO };
