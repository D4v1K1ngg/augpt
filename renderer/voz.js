'use strict';

/**
 * Reconhecer o nome do assistente pelo SOM da sua voz (25/10, pedido do Davi). Antes, só pelo texto do
 * Whisper — que escrevia a mesma chamada de dez jeitos ("jepeite", "Egypte", "e a CPT"…). Aqui, o
 * clássico do "Voice Match": as gravações do treino viram a "impressão do som" (MFCC: 12 números a
 * cada 10 ms — não o áudio) e cada fala nova é comparada com elas (DTW, que aceita falar mais rápido
 * ou mais devagar). O DTW também diz ONDE o nome acabou: o pedido é cortado ali.
 *
 * Também: `faixaDeVoz` — quanto da energia está na faixa da fala (até 4000 Hz). Clique de teclado e
 * estalo espalham energia em tudo; voz concentra ali.
 *
 * Roda na tela (window.vozDoUsuario) e no Node (a bancada testa).
 */
(function (raiz) {
  const TAXA = 16000;
  const QUADRO = 400; // 25 ms
  const PASSO = 160; // 10 ms
  const NFFT = 512;
  const FILTROS = 26;
  const COEFS = 12; // c1..c12 (sem o c0, que é só volume)

  /** FFT real (radix-2, in place) → potência das frequências 0..n/2. */
  function potencia(sinal, n) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re.set(sinal.subarray ? sinal.subarray(0, n) : sinal.slice(0, n));
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let tam = 2; tam <= n; tam <<= 1) {
      const ang = (-2 * Math.PI) / tam;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += tam) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < tam / 2; k += 1) {
          const a = i + k;
          const b = a + tam / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
    const p = new Float64Array(n / 2 + 1);
    for (let k = 0; k <= n / 2; k += 1) p[k] = re[k] * re[k] + im[k] * im[k];
    return p;
  }

  const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
  const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
  let BANCO = null;
  function bancoMel() {
    if (BANCO) return BANCO;
    const pontos = Array.from({ length: FILTROS + 2 }, (_, i) => mel2hz(hz2mel(80) + ((hz2mel(7600) - hz2mel(80)) * i) / (FILTROS + 1)));
    const bins = pontos.map((f) => Math.floor(((NFFT + 1) * f) / TAXA));
    BANCO = Array.from({ length: FILTROS }, (_, m) => {
      const w = new Float64Array(NFFT / 2 + 1);
      for (let k = bins[m]; k < bins[m + 1]; k += 1) w[k] = (k - bins[m]) / Math.max(1, bins[m + 1] - bins[m]);
      for (let k = bins[m + 1]; k < bins[m + 2]; k += 1) w[k] = (bins[m + 2] - k) / Math.max(1, bins[m + 2] - bins[m + 1]);
      return w;
    });
    return BANCO;
  }

  /**
   * A impressão do som de uma fala (Float32 a 16 kHz) → { quadros: [[12 números]…], inicio } com o
   * silêncio das pontas cortado (`inicio`: o quadro, em 10 ms, onde a fala começa no áudio original).
   */
  function impressao(amostras) {
    const s = amostras;
    const n = Math.floor((s.length - QUADRO) / PASSO) + 1;
    if (n < 5) return { quadros: [], inicio: 0 };
    const banco = bancoMel();
    const janela = Float64Array.from({ length: QUADRO }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (QUADRO - 1)));
    const quadro = new Float64Array(NFFT);
    const brutos = [];
    const energias = [];
    for (let q = 0; q < n; q += 1) {
      quadro.fill(0);
      let e = 0;
      for (let i = 0; i < QUADRO; i += 1) {
        const atual = s[q * PASSO + i];
        const anterior = q * PASSO + i > 0 ? s[q * PASSO + i - 1] : 0;
        const v = (atual - 0.97 * anterior) * janela[i];
        quadro[i] = v;
        e += atual * atual;
      }
      energias.push(e);
      const p = potencia(quadro, NFFT);
      const logMel = banco.map((w) => {
        let soma = 0;
        for (let k = 0; k < w.length; k += 1) soma += w[k] * p[k];
        return Math.log(soma + 1e-10);
      });
      const c = [];
      for (let k = 1; k <= COEFS; k += 1) {
        let soma = 0;
        for (let m = 0; m < FILTROS; m += 1) soma += logMel[m] * Math.cos((Math.PI * k * (m + 0.5)) / FILTROS);
        c.push(soma);
      }
      brutos.push(c);
    }
    // corta o silêncio das pontas: quadros com menos de 3% da energia do mais forte
    const maior = Math.max(...energias);
    let ini = energias.findIndex((e) => e > maior * 0.03);
    let fim = energias.length - 1 - [...energias].reverse().findIndex((e) => e > maior * 0.03);
    if (ini < 0) return { quadros: [], inicio: 0 };
    ini = Math.max(0, ini - 2);
    fim = Math.min(energias.length - 1, fim + 2);
    const util = brutos.slice(ini, fim + 1);
    // normaliza pela média (o microfone e a sala mudam a média, não a forma)
    const media = Array.from({ length: COEFS }, (_, k) => util.reduce((a, c) => a + c[k], 0) / util.length);
    return { quadros: util.map((c) => c.map((v, k) => Math.round((v - media[k]) * 100) / 100)), inicio: ini };
  }

  const dist = (a, b) => {
    let s = 0;
    for (let k = 0; k < a.length; k += 1) s += (a[k] - b[k]) ** 2;
    return Math.sqrt(s);
  };

  /**
   * O modelo (uma gravação do treino) aparece no COMEÇO da fala nova? DTW com começo preso e fim livre
   * (a fala pode continuar: "Jarvis, que horas são?"). → { custo, fim } — `custo` por passo do caminho;
   * `fim`: o quadro (na fala nova) onde o nome acaba.
   */
  function compararComeco(modelo, fala) {
    const n = modelo.length;
    const m = Math.min(fala.length, Math.ceil(n * 2.2)); // o nome não dura mais que 2,2× o do treino
    if (!n || m < Math.floor(n * 0.45)) return { custo: Infinity, fim: 0 };
    const INF = Infinity;
    let ant = new Float64Array(m + 1).fill(INF);
    let antLen = new Float64Array(m + 1).fill(0);
    ant[0] = 0;
    for (let i = 1; i <= n; i += 1) {
      const atu = new Float64Array(m + 1).fill(INF);
      const atuLen = new Float64Array(m + 1).fill(0);
      for (let j = 1; j <= m; j += 1) {
        const d = dist(modelo[i - 1], fala[j - 1]);
        // passos: diagonal, só no modelo, só na fala
        let melhor = ant[j - 1];
        let len = antLen[j - 1];
        if (ant[j] < melhor) {
          melhor = ant[j];
          len = antLen[j];
        }
        if (atu[j - 1] < melhor) {
          melhor = atu[j - 1];
          len = atuLen[j - 1];
        }
        if (melhor < INF) {
          atu[j] = melhor + d;
          atuLen[j] = len + 1;
        }
      }
      ant = atu;
      antLen = atuLen;
    }
    let custo = Infinity;
    let fim = 0;
    for (let j = Math.floor(n * 0.45); j <= m; j += 1) {
      if (ant[j] === INF) continue;
      const c = ant[j] / antLen[j];
      if (c < custo) {
        custo = c;
        fim = j;
      }
    }
    return { custo, fim };
  }

  /**
   * O limite a partir das próprias gravações: cada uma comparada com as outras (a mais parecida);
   * o limite é a pior dessas × 1,6. Medido com voz sintética variando velocidade e tom: as chamadas
   * ficaram em 10,5–11,3 (limite 11,6) e o impostor mais perto — "Hey Travis" — em 14,7. Sozinho o som
   * não decide o caso duvidoso: a escuta só aceita a chamada pelo som se o começo do texto do Whisper
   * também LEMBRA o nome (dois sinais fracos juntos; a TV falando outra coisa não passa). Com menos de
   * 4 gravações, não decide (só o texto do Whisper).
   */
  function limiteDosModelos(modelos) {
    if (modelos.length < 4) return null;
    const melhores = modelos.map((m, i) => Math.min(...modelos.filter((_, k) => k !== i).map((o) => compararComeco(o, m).custo)));
    const finitos = melhores.filter(Number.isFinite).sort((a, b) => a - b);
    if (finitos.length < 3) return null;
    // piso de 6: gravações quase iguais (mesmo tom, mesma velocidade) dariam limite perto de zero
    return Math.max(6, finitos[finitos.length - 1] * 1.6);
  }

  /** A fala nova (Float32 16 kHz) começa com o nome? → { chamou, custo, limite, corteSegundos } */
  function reconhecer(amostras, modelos, limite) {
    if (!limite || !modelos.length) return { chamou: false, custo: Infinity, limite };
    const f = impressao(amostras);
    if (f.quadros.length < 15) return { chamou: false, custo: Infinity, limite };
    let melhor = { custo: Infinity, fim: 0 };
    for (const m of modelos) {
      const r = compararComeco(m, f.quadros);
      if (r.custo < melhor.custo) melhor = r;
    }
    return { chamou: melhor.custo <= limite, custo: melhor.custo, limite, corteSegundos: ((f.inicio + melhor.fim) * PASSO + QUADRO) / TAXA };
  }

  /**
   * Quanto da energia de um pedaço (Float32, `taxa` Hz) entre 80 e 8000 Hz está na faixa da fala, até 4000 Hz
   * (0–1). Voz (inclusive a grave, com o fundamental abaixo de 250 Hz) passa de 0,9; clique e chiado de
   * espectro plano ficam perto de 0,5.
   */
  function faixaDeVoz(dados, taxa) {
    const n = 2 ** Math.floor(Math.log2(Math.min(dados.length, 4096)));
    if (n < 256) return 1;
    const p = potencia(dados, n);
    const hz = taxa / n;
    let voz = 0;
    let total = 0;
    for (let k = Math.floor(80 / hz); k < p.length && k * hz <= 8000; k += 1) {
      total += p[k];
      if (k * hz <= 4000) voz += p[k];
    }
    return total > 0 ? voz / total : 0;
  }

  /** WAV PCM 16 bits mono (ArrayBuffer, como o paraWav do ditado devolve) → Float32. */
  function doWav(buffer) {
    const v = new DataView(buffer);
    const n = (buffer.byteLength - 44) / 2;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i += 1) s[i] = v.getInt16(44 + i * 2, true) / 32768;
    return s;
  }

  // nomes fáceis de reconhecer (25/10, medidos contra 28 frases comuns: nenhum disparo). Curtos e comuns
  // ("Ava", "Zeus", "Lúcio") e palavras do dia a dia ("Computador", "Atlas" × "atrás") disparam à toa.
  const nomesSugeridos = ['Jarvis', 'Nexus', 'Sexta-feira', 'Aurora'];

  const api = { nomesSugeridos, impressao, compararComeco, limiteDosModelos, reconhecer, faixaDeVoz, doWav, TAXA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.vozDoUsuario = api;
})(typeof window !== 'undefined' ? window : globalThis);
