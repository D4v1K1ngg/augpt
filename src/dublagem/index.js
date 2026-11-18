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
// 18/11: até 1,15× a aceleração não se percebe; acima disso a fala é encurtada pelo Qwen (antes: até 1,5×, e soava
// corrida — no vídeo do FalleN, 1,25× ainda deixava 19 de 64 falas apressadas)
const ACELERAR_ATE = 1.15;
/**
 * O fim de cada fala (18/11, Davi: "um corte muito agressivo no fim do 'mim'", "o 'lá' com um corte"): o OmniVoice
 * para de soar em ~50 ms, seco. Um soltar de 120 ms e um pouco de sala (eco curto e baixo) dão a queda natural da voz.
 */
const ACABAMENTO = 'areverse,afade=t=in:d=0.12:curve=qsin,areverse,apad=pad_dur=0.25,aecho=0.85:0.55:40|75:0.12|0.06';
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
async function dublar({ entrada, para = 'pt', de = 'auto', voz = {}, fundo = 0.15, srt = null, fundoPronto = null, vozOriginalPronta = null }, deps) {
  const { ffmpeg, estudio, signal, emitir = () => {} } = deps;
  if (!estudio) throw new Error('a dublagem usa o Estúdio de voz: instale o motor de voz lá');
  const inicio = Date.now();
  // 1. legenda traduzida (os tempos de cada fala)
  // 17/11 (Studio): com a legenda pronta (a que o usuário editou), não transcreve nem traduz de novo
  const leg = srt && fs.existsSync(srt) && fs.existsSync(entrada) ? { video: entrada, srt, idiomaFalado: null, faltaram: 0 } : await legendar({ entrada, para, de, gravar: 'nao' }, deps);
  // as frases inteiras (18/11): os pedaços que o whisper cortou viram uma fala só
  const segs = diretor.remendarFrases(diretor.juntarEmFrases(lerSrt(fs.readFileSync(leg.srt, 'utf8')).map((s) => ({ inicio: emMs(s.inicio), fim: emMs(s.fim), texto: s.texto }))));
  if (!segs.length) throw new Error('não ouvi fala nesse vídeo');
  // 1b. a voz original sai: o fundo (música, ambiente) separado pelo Demucs, na placa
  const separado = fundo === 'separado';
  const pastaDoFundo = separado ? fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-fundo-')) : null;
  const soFundo = separado ? path.join(pastaDoFundo, 'fundo.wav') : null;
  let vozOriginal = separado ? path.join(pastaDoFundo, 'voz-original.wav') : null;
  if (separado && fundoPronto && fs.existsSync(fundoPronto)) {
    fs.copyFileSync(fundoPronto, soFundo); // o Studio já separou: reaproveita
    vozOriginal = vozOriginalPronta && fs.existsSync(vozOriginalPronta) ? vozOriginalPronta : null;
  } else if (separado) {
    if (!estudio.separadorInstalado?.()) throw new Error('o separador de voz não está instalado (Tradutor → Legendas e dublagem → Instalar o separador)');
    await estudio.separar(leg.video, { voz: vozOriginal, fundo: soFundo, signal, emitir: (p) => emitir({ etapa: 'separando', texto: p.texto }) });
  }
  // 1c. cada fala começa quando a voz original começa de verdade (18/11) — pela voz que o Demucs separou
  if (vozOriginal && fs.existsSync(vozOriginal)) {
    const raw = path.join(pastaDoFundo, 'voz16.raw');
    await rodar(ffmpeg, ['-y', '-i', vozOriginal, '-ac', '1', '-ar', '16000', '-f', 's16le', raw], { signal });
    const b = fs.readFileSync(raw);
    diretor.alinharAoOriginal(segs, diretor.energiaDaVoz(new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2))));
    fs.rmSync(raw, { force: true });
  }
  // 2. o diretor (18/11): o tempo disponível de cada frase; as longas demais o Qwen encurta antes de gerar
  let alvos = diretor.tempoDisponivel(segs);
  const comDuracao = (voz.motor || 'omni') === 'omni'; // o Qwen3-TTS não tem duração fixa: fica o encaixe por aceleração
  const llm = { chatStream: deps.chatStream, host: deps.host, model: deps.model, numCtx: deps.numCtx, signal, para };
  let textos = segs.map((s) => s.texto);
  let encurtadas = 0;
  // o roteiro revisado (18/11): o Qwen lê com o original ao lado e corrige o que soa traduzido ou ouvido errado
  let revisadas = 0;
  const srtOriginal = leg.srtOriginal || `${leg.video.replace(/\.[^.]+$/, '')}.original.srt`;
  if (fs.existsSync(srtOriginal)) {
    emitir({ etapa: 'diretor', texto: 'Diretor: revisando o roteiro…' });
    const originais = lerSrt(fs.readFileSync(srtOriginal, 'utf8')).map((s) => ({ inicio: emMs(s.inicio), texto: s.texto }));
    const r = await diretor.revisar(textos, diretor.originaisDasFalas(segs, originais), { ...llm, assunto: path.basename(leg.video).replace(/\.[^.]+$/, '') });
    textos = r.textos;
    revisadas = r.mudaram;
  }
  const longas = diretor.longasDemais(textos, alvos);
  if (longas.length) {
    emitir({ etapa: 'diretor', texto: `Diretor: encurtando ${longas.length} falas longas demais para o tempo do vídeo…` });
    const r = await diretor.reescrever(textos, longas, llm);
    textos = r.textos;
    encurtadas += r.mudaram;
  }
  // como a voz deve ler os nomes estrangeiros (só para a voz; a legenda e o roteiro ficam como estão)
  emitir({ etapa: 'diretor', texto: 'Diretor: conferindo a pronúncia dos nomes estrangeiros…' });
  const { mapa: pronuncias } = await diretor.pronuncia(textos, llm);
  // aspas, parênteses e travessões a voz lê como pausa ou ênfase fora de hora: saem do texto falado
  const paraFalar = (lista) => diretor.aplicarPronuncia(lista, pronuncias).map((t) => t.replace(/["“”«»()[\]]/g, '').replace(/\s+[—–]\s+/g, ', ').replace(/\s+/g, ' ').trim());
  let opcoesDaVoz = { ...voz, idioma: IDIOMA_DO_ESTUDIO[para] || 'auto', legenda: false, margem: 0.05, suavizar: 0.05, semente: Number.isFinite(Number(voz.semente)) ? Number(voz.semente) : 1234 };
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
  // 2a. no ritmo natural do modelo (18/11: a duração forçada em todas dava fala corrida e os ruídos do OmniVoice)
  emitir({ etapa: 'falando', texto: `Gerando as falas… 0/${segs.length}` });
  const f = await estudio.falas(opcoesDaVoz, paraFalar(textos), {
    emitir: (p) => emitir({ etapa: 'falando', texto: p.parte ? `Gerando as falas… ${p.parte}/${p.de || segs.length}` : `Gerando as falas… ${p.texto || ''}`.trim() }),
  });
  /** Troca as falas `idx` pelas geradas de novo (com `duracoes` só no último recurso). */
  const refazer = async (idx, { duracoes = null } = {}) => {
    const de2 = await estudio.falas(opcoesDaVoz, paraFalar(idx.map((i) => textos[i])), duracoes ? { duracoes } : {});
    idx.forEach((i, k) => {
      const novo = path.join(f.tmp, `refeita-${i}-${Date.now()}.wav`);
      fs.copyFileSync(de2.partes[k].arquivo, novo);
      f.partes[i] = { arquivo: novo, segundos: de2.partes[k].segundos };
    });
    fs.rmSync(de2.tmp, { recursive: true, force: true });
  };
  // 2b. a que não coube nem com 1,25×: o Qwen encurta na medida do que sobrou e ela é gerada de novo, no ritmo natural
  const apertadas = () => f.partes.map((p, i) => ({ i, razao: (p.segundos * 1000) / alvos[i] })).filter((x) => x.razao > ACELERAR_ATE);
  let lista = apertadas();
  // até 2 rodadas; a 2ª (e a das falas já encurtadas antes) com o pedido firme — 18/11: no vídeo do FalleN, a rodada
  // única não encurtava nenhuma das 9 que sobraram (o Qwen mantinha os detalhes de uma fala já encurtada)
  for (let rodada = 1; rodada <= 2 && lista.length; rodada += 1) {
    emitir({ etapa: 'diretor', texto: `Diretor: ${lista.length} falas não cabem no tempo — encurtando${rodada > 1 ? ' mais' : ''}…` });
    const alvo = lista.map(({ i, razao }) => ({ i, limite: Math.max(8, Math.floor((diretor.tamanho(textos[i]) * ACELERAR_ATE * (rodada > 1 ? 0.85 : 0.95)) / razao)) }));
    const r = await diretor.reescrever(textos, alvo, { ...llm, motivo: rodada > 1 || encurtadas ? 'apertar' : 'curta' });
    const idx = lista.map((x) => x.i).filter((i) => r.textos[i] !== textos[i]);
    if (!idx.length) continue;
    textos = r.textos;
    encurtadas += idx.length;
    await refazer(idx);
    lista = apertadas();
  }
  // 2b'. ainda não cabe: começa um pouco antes, até onde o whisper marcou (o alinhamento à voz original tinha passado o
  // começo para a frente), desde que a fala anterior continue cabendo — 18/11: alinhar sem isso deixou 9 falas forçadas
  if (lista.length) {
    for (const { i } of lista) {
      const s = segs[i];
      if (s.inicioWhisper == null || s.inicioWhisper >= s.inicio) continue;
      const falta = (f.partes[i].segundos * 1000) / ACELERAR_ATE - alvos[i];
      const novo = Math.max(s.inicioWhisper, Math.round(s.inicio - falta - 50));
      if (i > 0 && (f.partes[i - 1].segundos * 1000) / ACELERAR_ATE > novo - 120 - segs[i - 1].inicio) continue;
      s.inicio = novo;
    }
    alvos = diretor.tempoDisponivel(segs);
    lista = apertadas();
  }
  // 2c. último recurso: o modelo fala no tempo disponível (com a aceleração de 1,25× por cima, se ainda faltar)
  let forcadas = 0;
  if (lista.length && comDuracao) {
    emitir({ etapa: 'diretor', texto: `Diretor: ajustando o ritmo de ${lista.length} falas…` });
    await refazer(lista.map((x) => x.i), { duracoes: lista.map((x) => Math.round(alvos[x.i] * ACELERAR_ATE) / 1000) });
    forcadas = lista.length;
  }
  // 2d. o diretor ouve (o whisper na placa): fala que não se entende volta ao Qwen, mais simples, e é gerada de novo
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
            await refazer(idx);
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
    // o ritmo de verdade de cada fala (caracteres por segundo do áudio falado, já com a aceleração)
    const ritmos = f.partes.map((p, i) => diretor.tamanho(textos[i]) / Math.max(0.2, p.segundos / plano[i].velocidade)).sort((x, y) => x - y);
    const ritmo = { mediano: Math.round(ritmos[Math.floor(ritmos.length / 2)] * 10) / 10, p90: Math.round(ritmos[Math.floor(ritmos.length * 0.9)] * 10) / 10, corridas: ritmos.filter((x) => x > 22).length, maximo: Math.round(ritmos[ritmos.length - 1] * 10) / 10 };
    const falas = [];
    for (const [i, p] of f.partes.entries()) {
      const raw = path.join(f.tmp, `fala-${i}.raw`);
      const vel = plano[i].velocidade;
      await rodar(ffmpeg, ['-y', '-i', p.arquivo, '-af', `${vel > 1.01 ? `atempo=${vel},` : ''}${ACABAMENTO}`, '-ac', '1', '-ar', String(f.taxa), '-f', 's16le', raw], { signal });
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
      // 18/11: o fundo com o chiado limpo (afftdn) e abaixando ~12 dB enquanto alguém fala — a voz nova e a original (o que
      // sobra dela no fundo fica abafado; é o "ducking" das dublagens)
      ? ['-y', '-i', leg.video, ...voz, '-i', soFundo, ...(vozOriginal && fs.existsSync(vozOriginal) ? ['-i', vozOriginal] : []), '-filter_complex', vozOriginal && fs.existsSync(vozOriginal)
        ? '[2:a]aresample=48000,afftdn=nf=-30:tn=1[f0];[1:a]aresample=48000,asplit=2[v][vs];[3:a]aresample=48000,pan=mono|c0=0.5*c0+0.5*c1[vo];[vs][vo]amix=inputs=2:normalize=0[sc];[f0][sc]sidechaincompress=threshold=0.015:ratio=6:attack=15:release=450:level_sc=2[fd];[fd][v]amix=inputs=2:duration=first:normalize=0[a]'
        : '[2:a]aresample=48000,afftdn=nf=-30:tn=1[f0];[1:a]aresample=48000,asplit=2[v][vs];[f0][vs]sidechaincompress=threshold=0.015:ratio=6:attack=15:release=450[fd];[fd][v]amix=inputs=2:duration=first:normalize=0[a]', '-map', '0:v', '-map', '[a]']
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
      encurtadas, revisadas, refeitas, forcadas, nota, ritmo, pronuncias,
    };
  } finally {
    // DEPURAR_DUBLAGEM=1: as falas ficam (e o plano de cada uma), para analisar corte e pronúncia
    if (process.env.DEPURAR_DUBLAGEM) fs.writeFileSync(path.join(f.tmp, 'falas.json'), JSON.stringify(segs.map((s, i) => ({ i, inicio: s.inicio, texto: textos[i], arquivo: f.partes[i]?.arquivo, segundos: f.partes[i]?.segundos })), null, 1)), console.error('[dublagem] falas em', f.tmp);
    else fs.rmSync(f.tmp, { recursive: true, force: true });
    if (pastaDoFundo) fs.rmSync(pastaDoFundo, { recursive: true, force: true });
    if (ancora) fs.rmSync(ancora, { force: true });
  }
}

module.exports = { dublar, encaixar, montarFaixa, IDIOMA_DO_ESTUDIO };
