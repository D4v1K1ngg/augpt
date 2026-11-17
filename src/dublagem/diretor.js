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
${motivo === 'clara' ? 'These lines came out unclear when spoken: also use simpler, common words and avoid tongue-twisters, abbreviations and symbols.\n' : ''}Cut filler words, repetitions and less important details first; keep names and numbers. Output ONLY "N| line", one per input line, same numbers.`,
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

module.exports = { tempoAlvo, longasDemais, reescrever, pedidoDoDiretor, lerDiretor, semelhanca, ouvir, tamanho, CPS, CPS_MAXIMO };
