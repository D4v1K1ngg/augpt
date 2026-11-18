'use strict';

/**
 * O diretor da dublagem (17/11, Davi: "o dublador fica esperando, não fica sincronizado, faz muitas pausas — daria certo
 * usar o Qwen 3.5 9B como diretor, testando e vendo se está tudo certo?"). O Qwen não ouve áudio, então a direção é feita
 * em equipe:
 *  - o CÓDIGO dá a cada fala o tempo do trecho original (tempoAlvo) e mede: fala que não cabe nesse tempo sem correria;
 *  - o QWEN reescreve essas falas mais curtas, como um tradutor de dublagem (mesmo sentido, menos sílabas);
 *  - o OmniVoice fala no tempo pedido (duração fixa por fala — sem pausa sobrando nem aceleração artificial);
 *  - o WHISPER (na placa) ouve as falas geradas: a que não se entende (embolada, cortada) volta ao Qwen, mais simples,
 *    e é gerada de novo — uma rodada.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// fala natural: ~15 caracteres por segundo em português (medido no OmniVoice, ritmo 1); acima de ~19/s soa corrido
const CPS = 15;
const CPS_MAXIMO = 19;
const FOLGA_MS = 80;

/** O tempo de cada fala: o do trecho original, até o começo do próximo (menos uma folga), no mínimo 0,8 s. */
function tempoAlvo(segs) {
  return segs.map((s, i) => {
    const proximo = segs[i + 1]?.inicio;
    const proprio = Math.max(0, s.fim - s.inicio);
    const ate = proximo == null ? proprio : Math.max(0, proximo - s.inicio - FOLGA_MS);
    return Math.max(800, Math.min(proprio, ate) || proprio);
  });
}

/*
 * 18/11 (o vídeo do FalleN, 294 falas: 63 com menos de 1,2 s e 83 acima de 20 caracteres/s — "rápidas, mal pronunciadas,
 * com bugs do OmniVoice"): o whisper corta a fala em pedaços de frase, e dublar pedaço por pedaço, à força no tempo de
 * cada um, dava fala corrida e os ruídos do modelo (ele erra em duração muito curta). Como nos projetos de dublagem
 * abertos (pyVideoTrans: o "bloco" é o trecho mais o silêncio depois dele; aceleração de no máximo 1,5×), a fala agora é:
 *  - a FRASE inteira (os pedaços seguidos, sem pausa entre eles, viram uma fala só);
 *  - com o tempo DISPONÍVEL: do começo dela até o começo da próxima (o silêncio depois também serve);
 *  - gerada no RITMO NATURAL do modelo; só a que não cabe é encurtada pelo Qwen, e a duração forçada fica por último.
 */
const FIM_DE_FRASE = /[.!?…]["”')\]]*$/;

/** Junta os pedaços de frase seguidos (pausa de até `pausaMs`) numa fala só, até `maxMs` e `maxLetras`. */
function juntarEmFrases(segs, { pausaMs = 450, maxMs = 11000, maxMsInacabada = 15000, maxLetras = 220, maxLetrasInacabada = 300 } = {}) {
  const saida = [];
  for (const s of segs) {
    const atual = saida[saida.length - 1];
    // frase que não terminou junta mais (18/11: "pode ser um pouco… [3 s] …controverso" — o limite cortava a frase)
    const inacabada = atual && !FIM_DE_FRASE.test(atual.texto.trim());
    const cabe = atual && s.inicio - atual.fim <= pausaMs && s.fim - atual.inicio <= (inacabada ? maxMsInacabada : maxMs) && atual.texto.length + s.texto.length + 1 <= (inacabada ? maxLetrasInacabada : maxLetras);
    // continua a frase (o pedaço anterior não terminou) ou o anterior é curto demais para ser dublado sozinho
    if (cabe && (!FIM_DE_FRASE.test(atual.texto.trim()) || atual.fim - atual.inicio < 1500)) {
      atual.fim = s.fim;
      atual.texto = `${atual.texto} ${s.texto}`.replace(/\s+/g, ' ').trim();
    } else saida.push({ ...s });
  }
  return saida;
}

/**
 * Frase partida entre duas falas (o limite de tempo cortou): o pedaço curto depois da última pontuação passa para a
 * fala seguinte — 18/11: "…mas no" | "Brasil todos vieram…" soava como duas frases soltas.
 */
function remendarFrases(segs, { maxPalavras = 4 } = {}) {
  for (let i = 0; i < segs.length - 1; i += 1) {
    const t = segs[i].texto.trim();
    if (FIM_DE_FRASE.test(t) || segs[i + 1].inicio - segs[i].fim > 450) continue;
    const m = /^(.*[.,;:!?…])\s+([^.,;:!?…]+)$/.exec(t);
    if (!m || m[2].split(/\s+/).length > maxPalavras) continue;
    segs[i].texto = m[1];
    segs[i + 1].texto = `${m[2]} ${segs[i + 1].texto.trim()}`;
  }
  return segs;
}

/** O tempo disponível de cada fala: até o começo da próxima (menos um respiro), sem passar do trecho + 3 s; mínimo 0,8 s. */
function tempoDisponivel(segs, { respiro = 120, alemDoTrecho = 3000 } = {}) {
  return segs.map((s, i) => {
    const proximo = segs[i + 1]?.inicio;
    const ate = proximo == null ? s.fim + alemDoTrecho : proximo - respiro;
    return Math.max(800, Math.min(ate, s.fim + alemDoTrecho) - s.inicio);
  });
}

/*
 * Onde a voz original fala de verdade (18/11, o vídeo do FalleN: o whisper marcou a 1ª fala desde 0:00, mas o narrador
 * só começa em 0:02,5 — a dublagem começava cedo, acabava em 0:05 e deixava um buraco até 0:08 com o resto da voz
 * original no fundo). A voz que o Demucs separou diz: energia a cada 20 ms; a fala começa no 1º trecho de 100 ms com voz.
 */
function energiaDaVoz(amostras, taxa = 16000) {
  const passo = Math.round(taxa * 0.02);
  const db = new Float32Array(Math.floor(amostras.length / passo));
  for (let k = 0; k < db.length; k += 1) {
    let soma = 0;
    for (let j = k * passo; j < (k + 1) * passo; j += 1) soma += amostras[j] * amostras[j];
    db[k] = 10 * Math.log10(soma / passo / (32768 * 32768) + 1e-12);
  }
  return db;
}

/** Ajusta o começo de cada fala ao começo da voz original dentro do trecho (só para a frente) e anota onde ela acaba. */
function alinharAoOriginal(segs, db, { quadroMs = 20 } = {}) {
  if (!db?.length) return segs;
  const ordenado = Float32Array.from(db).sort();
  const piso = ordenado[Math.floor(ordenado.length * 0.2)];
  const limiar = Math.max(-50, piso + 15); // 15 dB acima do piso (o silêncio da voz separada)
  const voz = (k) => k >= 0 && k < db.length && db[k] > limiar;
  const seguido = (k, n = 5) => Array.from({ length: n }, (_, j) => voz(k + j)).every(Boolean);
  for (const s of segs) {
    const a = Math.floor(s.inicio / quadroMs);
    const b = Math.min(db.length - 1, Math.floor(s.fim / quadroMs));
    let ini = -1;
    let fim = -1;
    for (let k = a; k <= b; k += 1) if (seguido(k)) { ini = k; break; }
    for (let k = b; k >= a; k -= 1) if (voz(k)) { fim = k; break; }
    if (ini >= 0 && ini * quadroMs - 80 > s.inicio && ini * quadroMs < s.fim - 600) {
      s.inicioWhisper = s.inicio; // se a fala não couber, ela pode voltar até aqui
      s.inicio = ini * quadroMs - 80;
    }
    if (fim > ini && ini >= 0) s.falaAte = (fim + 1) * quadroMs;
  }
  return segs;
}

/** Caracteres falados (sem pontuação nem espaços repetidos). */
const tamanho = (t) => String(t || '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().length;

/** As falas que não cabem no tempo sem correria: [{ i, limite }] (limite = caracteres que cabem). */
function longasDemais(textos, alvos, { maximo = CPS_MAXIMO } = {}) {
  return textos
    .map((t, i) => ({ i, limite: Math.max(8, Math.floor((alvos[i] / 1000) * CPS)), cps: tamanho(t) / (alvos[i] / 1000) }))
    .filter((x) => x.cps > maximo)
    .map(({ i, limite }) => ({ i, limite }));
}

const NOMES = { pt: 'Brazilian Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian' };

function pedidoDoDiretor(linhas, { para = 'pt', motivo = 'curta' } = {}) {
  const idioma = NOMES[para] || para;
  return [
    {
      role: 'system',
      content: `You are a dubbing director. Each line must be SPOKEN in ${idioma} within the time of the original line, so it must be short.
Rewrite each line "N| [max K chars] text" in natural spoken ${idioma}, keeping the meaning, with AT MOST K characters.
${motivo === 'clara' ? 'These lines came out unclear when spoken: also use simpler, common words and avoid tongue-twisters, abbreviations and symbols.\n' : ''}${motivo === 'apertar' ? 'These lines were already shortened and STILL do not fit: each one MUST have at most K characters — drop secondary details and keep only the core idea; never make a line longer.\n' : ''}Cut filler words, repetitions and less important details first; keep names and numbers. Output ONLY "N| line", one per input line, same numbers.`,
    },
    { role: 'user', content: linhas.map((l) => `${l.n}| [max ${l.limite} chars] ${l.texto}`).join('\n') },
  ];
}

function lerDiretor(saida) {
  const mapa = new Map();
  for (const linha of String(saida || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n')) {
    const m = /^\s*(\d+)\s*[|:.)-]\s*(?:\[[^\]]*\]\s*)?(.*\S)\s*$/.exec(linha);
    if (m && !mapa.has(Number(m[1]))) mapa.set(Number(m[1]), m[2].replace(/^["“]|["”]$/g, '').trim());
  }
  return mapa;
}

/**
 * O Qwen reescreve as falas indicadas ([{ i, limite }]); só fica a reescrita que ficou mais curta (e não vazia).
 * Devolve os textos novos e quantas mudaram.
 */
async function reescrever(textos, alvo, { chatStream, host, model, numCtx = 8192, signal, para = 'pt', motivo = 'curta' }) {
  if (!alvo.length || typeof chatStream !== 'function') return { textos, mudaram: 0 };
  const novos = [...textos];
  let mudaram = 0;
  for (let k = 0; k < alvo.length; k += 25) {
    const lote = alvo.slice(k, k + 25).map((x) => ({ n: x.i + 1, limite: x.limite, texto: textos[x.i] }));
    let mapa = new Map();
    try {
      const r = await chatStream({ host, model, messages: pedidoDoDiretor(lote, { para, motivo }), temperature: 0.3, numCtx: Math.max(numCtx, 8192), numPredict: 3000, pensar: false, signal, onToken: () => {} });
      mapa = lerDiretor(r.content);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    for (const l of lote) {
      const t = mapa.get(l.n);
      if (t && tamanho(t) >= 2 && (tamanho(t) < tamanho(l.texto) || motivo === 'clara')) {
        novos[l.n - 1] = t;
        mudaram += 1;
      }
    }
  }
  return { textos: novos, mudaram };
}

/* ------------------------------ pronúncia (só para a voz) ------------------------------ */

/**
 * 18/11 (Davi: "Coldzera", "Counter-Strike", "cyber café" mal pronunciados): o modelo de voz lê nomes e termos
 * estrangeiros com as regras do idioma da dublagem. O Qwen lista esses termos com a grafia de como se fala
 * ("Counter-Strike => Cáunter Stráique"); a troca vale só para a voz — a legenda e o roteiro ficam como estão.
 */
function pedidoDePronuncia(linhas, { para = 'pt' } = {}) {
  const idioma = NOMES[para] || para;
  return [
    {
      role: 'system',
      content: `You prepare a script for a ${idioma} text-to-speech voice, which reads every word with ${idioma} spelling rules.
List the words or names in the lines that are NOT ${idioma} (English names, nicknames, game titles, brands) and would be mispronounced, each with a respelling in ${idioma} orthography that makes the voice say it the way a native ${idioma} speaker says it. Put ONE stress mark per word, on the stressed vowel, and write diphthongs as one syllable ("ai", "ei", "ou").
Examples for Brazilian Portuguese: "Counter-Strike => Cáunter Istráique", "Get Right => Guét Ráit", "gaming => guêimin", "Neo => Níou", "Taz => Tás".
If a term is an obvious mis-hearing of a common term, respell the intended term ("Cyber Coffee" => "Sáiber Café").
Never list ${idioma} words, ${idioma} names, numbers or acronyms (the voice reads those right). Output ONLY "term => respelling", one per line; output "none" if there are none.`,
    },
    { role: 'user', content: linhas.join('\n') },
  ];
}

const semAcento = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escaparRegex =(t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Troca os termos do mapa ({ termo: grafia }) nas falas, palavra inteira, sem diferenciar maiúsculas. */
function aplicarPronuncia(textos, mapa) {
  const termos = Object.keys(mapa).sort((a, b) => b.length - a.length);
  if (!termos.length) return textos;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${termos.map(escaparRegex).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const porMinuscula = Object.fromEntries(termos.map((t) => [t.toLowerCase(), mapa[t]]));
  return textos.map((t) => String(t).replace(re, (x) => porMinuscula[x.toLowerCase()] || x));
}

function lerPronuncia(saida, textos) {
  const todo = textos.join('\n').toLowerCase();
  const mapa = {};
  for (const linha of String(saida || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n')) {
    const m = /^\s*[-*•\d.)\s]*["“]?([^"”=]+?)["”]?\s*=>\s*["“]?([^"”]+?)["”]?\s*$/.exec(linha);
    if (!m) continue;
    const [termo, grafia] = [m[1].trim(), m[2].trim()];
    // só o que existe nas falas, mudou de verdade (não só o acento) e tem um tamanho parecido; siglas a voz já soletra
    if (termo.length < 2 || /^[\p{Lu}\d]{1,5}$/u.test(termo) || !todo.includes(termo.toLowerCase()) || semAcento(grafia) === semAcento(termo) || grafia.length > termo.length * 2.5 + 6) continue;
    mapa[termo] = grafia;
  }
  return mapa;
}

async function pronuncia(textos, { chatStream, host, model, numCtx = 8192, signal, para = 'pt' }) {
  if (typeof chatStream !== 'function' || !textos.length) return { textos, mapa: {} };
  const mapa = {};
  for (let k = 0; k < textos.length; k += 40) {
    try {
      const lote = textos.slice(k, k + 40);
      const r = await chatStream({ host, model, messages: pedidoDePronuncia(lote, { para }), temperature: 0.2, numCtx: Math.max(numCtx, 8192), numPredict: 1500, pensar: false, signal, onToken: () => {} });
      Object.assign(mapa, lerPronuncia(r.content, lote));
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  return { textos: aplicarPronuncia(textos, mapa), mapa };
}

/* ------------------------------ ouvir (o whisper confere as falas) ------------------------------ */

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((p) => p.length > 1);

/** Quanto do que devia ser dito foi ouvido (0 a 1), pelas palavras. */
function semelhanca(dito, ouvido) {
  const a = norm(dito);
  if (!a.length) return 1;
  const b = new Set(norm(ouvido));
  return a.filter((p) => b.has(p)).length / a.length;
}

function rodar(exe, args, { cwd, signal } = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(exe, args, { cwd, windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => (erro = `${erro}${d}`.slice(-1500)));
    p.stdout.on('data', () => {});
    const parar = () => p.kill();
    signal?.addEventListener('abort', parar, { once: true });
    p.on('error', falha);
    p.on('close', (c) => {
      signal?.removeEventListener('abort', parar);
      if (signal?.aborted) return falha(new Error('interrompida'));
      return c === 0 ? ok() : falha(new Error(erro.trim().split('\n').pop() || `saiu com ${c}`));
    });
  });
}

/**
 * Ouve as falas: junta todas num WAV só (1,2 s de silêncio entre elas), o whisper transcreve com os tempos, e cada trecho
 * ouvido volta para a fala onde caiu. Devolve, por fala, { ouvido, nota } (nota = semelhança com o texto).
 */
async function ouvir(arquivos, textos, { ffmpeg, whisper, para = 'pt', pasta, signal }) {
  const exe = whisper?.gpu && fs.existsSync(whisper.gpu) ? whisper.gpu : whisper?.exe;
  if (!exe || !whisper?.modelo || !arquivos.length) return null;
  const lista = path.join(pasta, 'ouvir.txt');
  const silencio = path.join(pasta, 'silencio16.wav');
  await rodar(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1.2', '-c:a', 'pcm_s16le', silencio], { signal });
  // cada fala em 16 kHz mono; as janelas de tempo de cada uma no arquivo junto
  const janelas = [];
  let t = 0;
  const partes = [];
  for (const [i, a] of arquivos.entries()) {
    const w = path.join(pasta, `ouvir-${i}.wav`);
    await rodar(ffmpeg, ['-y', '-i', a, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', w], { signal });
    const ms = Math.round(((fs.statSync(w).size - 44) / 32000) * 1000);
    janelas.push({ ini: t, fim: t + ms });
    t += ms + 1200;
    partes.push(`file '${w.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, `file '${silencio.replace(/\\/g, '/')}'`);
  }
  fs.writeFileSync(lista, partes.join('\n'));
  const junto = path.join(pasta, 'ouvir-junto.wav');
  await rodar(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c:a', 'pcm_s16le', junto], { signal });
  const base = path.join(pasta, 'ouvido');
  await rodar(exe, ['-m', whisper.modelo, '-f', junto, '-l', para, '-osrt', '-of', base, '-ml', '0', '-sow'], { cwd: path.dirname(exe), signal });
  const { lerSrt, emMs } = require('../legendas');
  const ouvidos = arquivos.map(() => []);
  for (const s of lerSrt(fs.readFileSync(`${base}.srt`, 'utf8'))) {
    const meio = (emMs(s.inicio) + emMs(s.fim)) / 2;
    const k = janelas.findIndex((j) => meio >= j.ini - 300 && meio <= j.fim + 600);
    if (k >= 0) ouvidos[k].push(s.texto);
  }
  return ouvidos.map((o, i) => ({ ouvido: o.join(' '), nota: semelhanca(textos[i], o.join(' ')) }));
}

module.exports = { energiaDaVoz, alinharAoOriginal, juntarEmFrases, remendarFrases, pronuncia, aplicarPronuncia, lerPronuncia, tempoDisponivel, tempoAlvo, longasDemais, reescrever, pedidoDoDiretor, lerDiretor, semelhanca, ouvir, tamanho, CPS, CPS_MAXIMO };
