'use strict';

/**
 * Áudio anexado (31/10, mensagem de voz do WhatsApp): a tela decodifica (opus, mp3, m4a… o Chromium sabe todos),
 * junta os canais, divide em pedaços de 2 min (o processo principal aceita até 3) e manda cada um ao Whisper local
 * (o mesmo do ditado). Nada sai do PC. Devolve { texto, segundos }.
 */
(function () {
  const PEDACO = 120; // segundos por vez

  /** O trecho mais quieto (50 ms) nos 15 s antes de `alvo`: o corte entre pedaços não parte a frase (31/10, no teste partiu). */
  function corteNoSilencio(mono, alvo, taxa) {
    const janela = Math.round(taxa * 0.05);
    let melhor = alvo;
    let menor = Infinity;
    for (let p = alvo - 15 * taxa; p + janela <= alvo; p += janela) {
      let soma = 0;
      for (let i = p; i < p + janela; i += 1) soma += mono[i] * mono[i];
      if (soma < menor) [menor, melhor] = [soma, p + Math.round(janela / 2)];
    }
    return melhor;
  }

  async function transcreverAudio(bytes, { progresso = () => {} } = {}) {
    const dados = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ctx = new AudioContext();
    let buf;
    try {
      buf = await ctx.decodeAudioData(dados);
    } catch {
      throw new Error('formato de áudio que não consigo ler');
    } finally {
      ctx.close();
    }
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c += 1) {
      const canal = buf.getChannelData(c);
      for (let i = 0; i < n; i += 1) mono[i] += canal[i] / buf.numberOfChannels;
    }
    const passo = PEDACO * buf.sampleRate;
    const textos = [];
    for (let ini = 0, fim; ini < n; ini = fim) {
      fim = n - ini <= passo ? n : corteNoSilencio(mono, ini + passo, buf.sampleRate);
      if (fim - ini < buf.sampleRate / 2) break; // o resto com menos de meio segundo
      progresso(Math.round((ini / n) * 100));
      const r = await api.ditado.transcrever(await window.ditadoPorVoz.paraWav([mono.subarray(ini, fim)], buf.sampleRate));
      if (!r.ok) throw new Error(r.error);
      if (r.texto) textos.push(r.texto);
    }
    return { texto: textos.join(' ').trim(), segundos: Math.round(buf.duration) };
  }

  const duracao = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  window.audioAnexo = { transcreverAudio, duracao };
})();
