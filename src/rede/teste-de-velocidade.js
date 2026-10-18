'use strict';

/**
 * Teste de rede (18/10): velocidade, latência, jitter, perda e bufferbloat,
 * como o speed.cloudflare.com e o teste de bufferbloat do Waveform fazem.
 * Servidor: o de teste da Cloudflare (o mais próximo pelo anycast):
 *   GET  /__down?bytes=N   baixa N bytes
 *   POST /__up             recebe o corpo
 *   GET  /cdn-cgi/trace    diz em que cidade (colo) caiu o teste
 * A latência é o tempo de um pedido de 0 bytes menos o tempo que o servidor
 * declara ter gasto (Server-Timing), igual ao teste da própria Cloudflare.
 * Conferido com o ping do Windows no mesmo servidor (18/10): 4-7 ms nos dois.
 * Dados: no máximo ~300 MB (220 baixando + 80 enviando); linha lenta usa menos.
 * Bufferbloat: quanto a latência SOBE enquanto a linha está cheia (baixando
 * ou enviando) — é o que dá lag em jogo com a internet "rápida". Nota do
 * Waveform: A+ < 5 ms, A < 30, B < 60, C < 200, D < 400, F acima.
 */

const BASE = 'https://speed.cloudflare.com';

const MODOS = {
  // só latência, ~5 s e quase nada de dados
  ping: { amostrasOciosas: 20 },
  completo: { amostrasOciosas: 20, downloadMs: 10000, uploadMs: 8000, limiteDownload: 220e6, limiteUpload: 80e6, fluxosDown: 6, fluxosUp: 4 },
};

const mediana = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
// jitter: a variação média entre amostras seguidas (RFC 3550, simplificado)
const jitter = (xs) => {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return null;
  let soma = 0;
  for (let i = 1; i < v.length; i += 1) soma += Math.abs(v[i] - v[i - 1]);
  return soma / (v.length - 1);
};
const arred = (x, casas = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** casas) / 10 ** casas : null);

function notaDeBufferbloat(aumentoMs) {
  if (!Number.isFinite(aumentoMs)) return null;
  if (aumentoMs < 5) return 'A+';
  if (aumentoMs < 30) return 'A';
  if (aumentoMs < 60) return 'B';
  if (aumentoMs < 200) return 'C';
  if (aumentoMs < 400) return 'D';
  return 'F';
}

/**
 * @param deps.fetch  fetch (a bancada passa um dublê)
 * @param deps.agora  relógio em ms (performance.now)
 * @param aoProgresso ({ fase, mbps, latencia, bytes }) — para a tela
 */
async function testarRede({ modo = 'completo', deps = {}, signal, aoProgresso = () => {}, ajustes = {} } = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const agora = deps.agora || (() => performance.now());
  const esperar = deps.esperar || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const cfg = { ...(MODOS[modo] || MODOS.completo), ...ajustes }; // ajustes: a bancada encurta o teste
  const inicio = agora();
  let bytesUsados = 0;
  const linhaDoTempo = []; // { t, fase, latencia }

  // onde caiu o teste (cidade do servidor) — sem guardar o IP do usuário
  let servidor = null;
  try {
    const trace = await (await fetchFn(`${BASE}/cdn-cgi/trace`, { signal })).text();
    servidor = /^colo=(\w+)/m.exec(trace)?.[1] || null;
  } catch {
    /* sem o trace o teste segue */
  }

  const medirLatencia = async () => {
    const t0 = agora();
    try {
      const r = await fetchFn(`${BASE}/__down?bytes=0&_=${Math.random().toString(36).slice(2)}`, { signal: AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(2500), ...(signal ? [signal] : [])]) : AbortSignal.timeout(2500), cache: 'no-store' });
      await r.arrayBuffer();
      // o servidor declara dois tempos (cfSpeedEdge e cfSpeedWorker): os dois saem (18/10: só o 1º
      // saía e a latência dava 38 ms com o ping em 5 ms)
      const servidorMs = [...String(r.headers.get('server-timing') || '').matchAll(/dur=([\d.]+)/g)].reduce((t, m) => t + Number(m[1]), 0);
      return Math.max(0.1, agora() - t0 - servidorMs);
    } catch (err) {
      if (signal?.aborted) throw err;
      return null; // perdida
    }
  };

  // latência com a linha parada
  const ociosas = [];
  for (let i = 0; i < cfg.amostrasOciosas && !signal?.aborted; i += 1) {
    const l = await medirLatencia();
    ociosas.push(l);
    linhaDoTempo.push({ t: agora() - inicio, fase: 'parado', latencia: l });
    aoProgresso({ fase: 'latência', latencia: l });
    await esperar(100);
  }
  const ocioso = {
    mediana: arred(mediana(ociosas)),
    jitter: arred(jitter(ociosas)),
    perdaPct: arred((ociosas.filter((l) => l === null).length / Math.max(1, ociosas.length)) * 100, 0),
  };
  if (modo === 'ping') return { modo, servidor, ocioso, linhaDoTempo, bytesUsados, duracaoS: arred((agora() - inicio) / 1000, 0) };

  /** Enche a linha por `ms` com `fluxos` em paralelo, medindo a latência ao mesmo tempo. */
  const carregar = async (fase, { ms, fluxos, limite, umFluxo }) => {
    const parar = new AbortController();
    const fimDaFase = () => parar.abort();
    signal?.addEventListener('abort', fimDaFase, { once: true });
    let bytes = 0;
    let falha = null;
    // servidor que recusa (18/10: HTTP 429 depois de ~4 testes seguidos, "tente em 1 h"): a fase
    // para e sai como "não medida", nunca como 0 Mbps
    const falhar = (r) => {
      if (falha) return;
      const minutos = Math.ceil((Number(r.headers?.get?.('retry-after')) || 0) / 60);
      falha = r.status === 429 ? `o servidor de teste limitou os pedidos deste endereço${minutos ? ` (tente de novo em ~${minutos} min)` : ''}` : `o servidor de teste respondeu HTTP ${r.status}`;
      parar.abort();
    };
    const t0 = agora();
    const amostras = []; // { t, bytes } para a velocidade sem o arranque
    const contar = (n) => {
      bytes += n;
      bytesUsados += n;
      if (bytes >= limite) parar.abort();
    };
    const relogio = setTimeout(() => parar.abort(), ms);
    const latencias = [];
    const sondas = (async () => {
      while (!parar.signal.aborted) {
        const l = await medirLatencia();
        if (parar.signal.aborted) break;
        latencias.push(l);
        linhaDoTempo.push({ t: agora() - inicio, fase, latencia: l });
        amostras.push({ t: agora() - t0, bytes });
        const decorrido = (agora() - t0) / 1000;
        aoProgresso({ fase, latencia: l, mbps: decorrido > 0 ? (bytes * 8) / decorrido / 1e6 : 0, bytes: bytesUsados });
        await esperar(200);
      }
    })();
    await Promise.all(Array.from({ length: fluxos }, () => umFluxo({ sinal: parar.signal, contar, falhar }).catch(() => {})));
    parar.abort();
    clearTimeout(relogio);
    signal?.removeEventListener('abort', fimDaFase);
    await sondas;
    const totalS = (agora() - t0) / 1000;
    // a velocidade sem o primeiro segundo (o TCP ainda acelerando)
    const base = amostras.find((a) => a.t >= 1000);
    const mbps = base && totalS * 1000 > base.t + 500 ? ((bytes - base.bytes) * 8) / (totalS - base.t / 1000) / 1e6 : (bytes * 8) / Math.max(0.001, totalS) / 1e6;
    if (falha || !bytes) return { mbps: null, erro: falha || 'nenhum dado chegou do servidor de teste', latencia: null, jitter: null, bytes, segundos: arred(totalS) };
    return { mbps: arred(mbps), latencia: arred(mediana(latencias)), jitter: arred(jitter(latencias)), bytes, segundos: arred(totalS) };
  };

  const download = await carregar('baixando', {
    ms: cfg.downloadMs,
    fluxos: cfg.fluxosDown,
    limite: cfg.limiteDownload,
    umFluxo: async ({ sinal, contar, falhar }) => {
      while (!sinal.aborted) {
        const r = await fetchFn(`${BASE}/__down?bytes=25000000`, { signal: sinal, cache: 'no-store' });
        if (r.ok === false) return falhar(r);
        const leitor = r.body.getReader();
        for (;;) {
          const { done, value } = await leitor.read();
          if (done) break;
          contar(value.length);
        }
      }
    },
  });
  if (signal?.aborted) throw new Error('teste interrompido');
  const corpo = new Uint8Array(2e6); // 2 MB por envio: dá para medir o progresso
  const upload = await carregar('enviando', {
    ms: cfg.uploadMs,
    fluxos: cfg.fluxosUp,
    limite: cfg.limiteUpload,
    umFluxo: async ({ sinal, contar, falhar }) => {
      while (!sinal.aborted) {
        const r = await fetchFn(`${BASE}/__up`, { method: 'POST', body: corpo, signal: sinal, headers: { 'Content-Type': 'application/octet-stream' } });
        if (r.ok === false) return falhar(r);
        contar(corpo.length);
      }
    },
  });
  const aumentoDown = Number.isFinite(download.latencia) && Number.isFinite(ocioso.mediana) ? download.latencia - ocioso.mediana : null;
  const aumentoUp = Number.isFinite(upload.latencia) && Number.isFinite(ocioso.mediana) ? upload.latencia - ocioso.mediana : null;
  const pior = Math.max(aumentoDown ?? -Infinity, aumentoUp ?? -Infinity);
  return {
    modo,
    servidor,
    ocioso,
    download,
    upload,
    bufferbloat: { nota: notaDeBufferbloat(Number.isFinite(pior) ? pior : null), aumentoDown: arred(aumentoDown), aumentoUp: arred(aumentoUp) },
    linhaDoTempo,
    bytesUsados,
    duracaoS: arred((agora() - inicio) / 1000, 0),
  };
}

const mb = (b) => `${Math.round(b / 1e6)} MB`;

const velocidade = (nome, f) => (f.erro ? `| ${nome} | não medido: ${f.erro} |` : `| ${nome} | **${f.mbps} Mbps** |`);
const sinal = (x) => (x >= 0 ? `+${x}` : `${x}`);
const cheia = (nome, f, aumento) => (f.erro ? null : `| Latência ${nome} | ${f.latencia ?? '—'} ms (${Number.isFinite(aumento) ? sinal(aumento) : '—'} ms) |`);

/** O resultado como tabela (feita pelo código: os números são exatamente os medidos). */
function tabelaDoResultado(r) {
  const linhas = [
    '| Medida | Resultado |',
    '| --- | --- |',
    ...(r.download ? [velocidade('Download', r.download), velocidade('Upload', r.upload)] : []),
    `| Latência parado | ${r.ocioso.mediana ?? '—'} ms (jitter ${r.ocioso.jitter ?? '—'} ms) |`,
    ...(r.download ? [cheia('baixando', r.download, r.bufferbloat.aumentoDown), cheia('enviando', r.upload, r.bufferbloat.aumentoUp)].filter(Boolean) : []),
    `| Perda de pacotes | ${r.ocioso.perdaPct}% |`,
    ...(r.bufferbloat ? [`| Bufferbloat | **nota ${r.bufferbloat.nota ?? '—'}** |`] : []),
  ];
  const rodape = `*Servidor de teste da Cloudflare${r.servidor ? ` (${r.servidor})` : ''} · ${r.duracaoS} s${r.bytesUsados ? ` · ${mb(r.bytesUsados)} de dados` : ''}.*`;
  return `${linhas.join('\n')}\n\n${rodape}`;
}

/** Gráficos do resultado (blocos ```chart, desenhados pelo renderer/grafico.js). */
function graficosDoResultado(r) {
  const bloco = (spec) => `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``;
  const pontos = r.linhaDoTempo.filter((p) => Number.isFinite(p.latencia));
  const saida = [];
  if (pontos.length >= 4) {
    // uma amostra a cada ~N para caber nos 120 pontos do gráfico
    const passo = Math.max(1, Math.ceil(pontos.length / 100));
    const amostra = pontos.filter((_, i) => i % passo === 0);
    const fases = [...new Set(amostra.map((p) => p.fase))];
    saida.push(
      bloco({
        type: 'line',
        title: 'Latência durante o teste (ms)',
        labels: amostra.map((p) => `${Math.round(p.t / 1000)}s`),
        datasets: fases.map((f) => ({ label: f, data: amostra.map((p) => (p.fase === f ? Math.round(p.latencia * 10) / 10 : null)) })),
      })
    );
  }
  if (r.download) {
    const barras = [['parado', r.ocioso.mediana], ['baixando', r.download.latencia], ['enviando', r.upload.latencia]].filter(([, v]) => Number.isFinite(v));
    if (barras.length >= 2) saida.push(bloco({ type: 'bar', title: 'Latência média: parado x linha cheia (ms)', labels: barras.map(([n]) => n), datasets: [{ label: 'ms', data: barras.map(([, v]) => v) }] }));
  }
  return saida;
}

module.exports = { testarRede, tabelaDoResultado, graficosDoResultado, notaDeBufferbloat, mediana, jitter, MODOS, BASE };
