'use strict';

/**
 * Teste de rede pelo chat (18/10). A rede é um dublê do servidor de teste da
 * Cloudflare: latência fixa, mais um atraso quando a linha está cheia
 * (bufferbloat de mentira), e o tempo que o servidor declara gastar.
 */

const { testarRede, notaDeBufferbloat, tabelaDoResultado, graficosDoResultado } = require('../../src/rede/teste-de-velocidade');
const { pedidoDeRede, responderRede, PERGUNTA_DE_CONFIRMACAO } = require('../../src/agent/rede-no-chat');
const { validarGrafico } = require('../../src/agent/nucleo/graficos');

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Servidor falso: RTT de 8 ms; com a linha cheia, +`bloat` ms; o servidor "gasta" 30 ms e declara. */
function servidorFalso({ bloat = 0 } = {}) {
  let cheia = 0;
  const pedidos = { latencia: 0, down: 0, up: 0 };
  const fetch = async (url, opcoes = {}) => {
    if (/cdn-cgi\/trace/.test(url)) return { text: async () => 'fl=1\ncolo=GRU\nip=1.2.3.4\n' };
    if (/__down\?bytes=0/.test(url)) {
      pedidos.latencia += 1;
      await esperar(8 + 30 + (cheia ? bloat : 0));
      return { headers: { get: () => 'cfSpeedEdge;dur=5, cfSpeedWorker;dur=25' }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (/__down/.test(url)) {
      pedidos.down += 1;
      cheia += 1;
      let enviados = 0;
      return {
        body: {
          getReader: () => ({
            read: async () => {
              if (opcoes.signal?.aborted || enviados >= 20) {
                cheia -= enviados >= 0 ? 1 : 0;
                enviados = -1;
                return { done: true };
              }
              await esperar(10);
              enviados += 1;
              return { done: false, value: new Uint8Array(125000) }; // 1 Mbit a cada 10 ms
            },
          }),
        },
      };
    }
    if (/__up/.test(url)) {
      pedidos.up += 1;
      cheia += 1;
      await esperar(40);
      cheia -= 1;
      return { ok: true };
    }
    throw new Error(`url inesperada: ${url}`);
  };
  return { fetch, pedidos };
}

const curto = { amostrasOciosas: 5, downloadMs: 1500, uploadMs: 1200, fluxosDown: 2, fluxosUp: 2, limiteDownload: 1e9, limiteUpload: 1e9 };

module.exports = [
  {
    nome: 'teste de rede: a latência desconta os DOIS tempos do servidor (Server-Timing) — 8 ms, não 38; bufferbloat é quanto ela sobe com a linha cheia, com a nota do Waveform; a resposta não guarda o IP',
    tipo: 'unidade',
    async executar() {
      const s = servidorFalso({ bloat: 80 });
      const r = await testarRede({ modo: 'completo', deps: { fetch: s.fetch, esperar: () => esperar(5) }, ajustes: curto });
      const tabela = tabelaDoResultado(r);
      return [
        r.ocioso.mediana >= 7 && r.ocioso.mediana < 20 || `latência parado: ${r.ocioso.mediana}`,
        r.download.latencia - r.ocioso.mediana > 50 || `bufferbloat baixando: ${JSON.stringify(r.bufferbloat)}`,
        r.bufferbloat.nota === 'C' || `nota: ${r.bufferbloat.nota}`,
        r.download.mbps > 0 && r.upload.mbps > 0 || `velocidade: ${r.download.mbps} / ${r.upload.mbps}`,
        r.servidor === 'GRU' || r.servidor,
        !/1\.2\.3\.4/.test(JSON.stringify(r)) || 'IP do usuário no resultado',
        /\| Download \| \*\*[\d.]+ Mbps\*\* \|/.test(tabela) && /nota C/.test(tabela) && /\(GRU\)/.test(tabela) || tabela,
        ['A+', 'A', 'B', 'C', 'D', 'F'].join() === [3, 20, 45, 150, 300, 500].map(notaDeBufferbloat).join() || 'faixas da nota',
      ];
    },
  },
  {
    nome: 'teste de rede: servidor que recusa (HTTP 429, "tente em 10 min") deixa a fase como "não medido" com o motivo, nunca 0 Mbps; a nota usa a fase medida; o modelo é avisado para não inventar causa',
    tipo: 'unidade',
    async executar() {
      const s = servidorFalso({ bloat: 10 });
      const fetch = async (url, o) => (/__down\?bytes=25/.test(url) ? { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '600' : null) } } : s.fetch(url, o));
      const r = await testarRede({ modo: 'completo', deps: { fetch, esperar: () => esperar(5) }, ajustes: curto });
      const tabela = tabelaDoResultado(r);
      const escritas = [];
      await responderRede({ pergunta: 'pode testar', conversa: [{ role: 'assistant', content: PERGUNTA_DE_CONFIRMACAO }], deps: { escrever: async (m) => (escritas.push(m), 'ok'), emit: () => {} }, medir: async () => r });
      return [
        r.download.mbps === null && /limitou/.test(r.download.erro) && /10 min/.test(r.download.erro) || JSON.stringify(r.download),
        /\| Download \| não medido: o servidor de teste limitou/.test(tabela) && !/0 Mbps/.test(tabela) || tabela,
        r.upload.mbps > 0 && r.bufferbloat.nota !== null || `upload e nota: ${JSON.stringify(r.bufferbloat)}`,
        !/Latência baixando/.test(tabela) || 'latência da fase não medida não aparece',
        /download: NÃO MEDIDO/.test(escritas[0][0].content) && /não invente causa/.test(escritas[0][0].content) || 'o modelo é avisado',
      ];
    },
  },
  {
    nome: 'teste de rede: só o ping não baixa nem envia nada; os gráficos (linha da latência por fase e barras parado x cheia) são válidos para o chat',
    tipo: 'unidade',
    async executar() {
      const s = servidorFalso();
      const p = await testarRede({ modo: 'ping', deps: { fetch: s.fetch, esperar: () => esperar(1) }, ajustes: { amostrasOciosas: 6 } });
      const s2 = servidorFalso({ bloat: 20 });
      const c = await testarRede({ modo: 'completo', deps: { fetch: s2.fetch, esperar: () => esperar(5) }, ajustes: curto });
      const graficos = graficosDoResultado(c).map((g) => g.replace(/^```chart\n|\n```$/g, ''));
      return [
        s.pedidos.down === 0 && s.pedidos.up === 0 && p.bytesUsados === 0 || `ping gastou dados: ${JSON.stringify(s.pedidos)}`,
        !p.download && /Latência parado/.test(tabelaDoResultado(p)) || 'tabela do ping',
        graficos.length === 2 || `gráficos: ${graficos.length}`,
        JSON.parse(graficos[0]).datasets.map((d) => d.label).join() === 'parado,baixando,enviando' || graficos[0].slice(0, 200),
        validarGrafico(graficos[1]).ok || 'barras válidas',
      ];
    },
  },
  {
    nome: 'teste de rede: o chat reconhece o pedido ("teste minha internet", "speed test", "mede meu ping") e não a pergunta ("como funciona o teste de velocidade?", "minha internet está lenta, o que fazer?"); o completo pergunta antes de gastar ~300 MB',
    tipo: 'unidade',
    executar() {
      const depois = [{ role: 'assistant', content: PERGUNTA_DE_CONFIRMACAO }];
      return [
        pedidoDeRede('teste minha internet')?.confirmado === false || 'teste minha internet pergunta antes',
        pedidoDeRede('faça um speed test')?.modo === 'completo' || 'speed test',
        pedidoDeRede('mede meu ping')?.modo === 'ping' && pedidoDeRede('mede meu ping').confirmado || 'ping direto',
        pedidoDeRede('verifique a latência da minha rede')?.modo === 'ping' || 'latência é ping',
        pedidoDeRede('como funciona o teste de velocidade?') === null || 'explicação',
        pedidoDeRede('o que é bufferbloat?') === null || 'o que é',
        pedidoDeRede('minha internet está lenta, o que fazer?') === null || 'conselho',
        pedidoDeRede('qual a melhor internet de fibra?') === null || 'produto',
        pedidoDeRede('pode testar', depois)?.modo === 'completo' && pedidoDeRede('pode testar', depois).confirmado || 'confirmação',
        pedidoDeRede('só o ping', depois)?.modo === 'ping' || 'só o ping depois da pergunta',
        pedidoDeRede('pode testar') === null || 'pode testar sem pergunta antes',
      ];
    },
  },
  {
    nome: 'teste de rede: no chat, a resposta é a tabela medida + a explicação do modelo (que recebe só os números medidos) + os gráficos; sem confirmação, só a pergunta',
    tipo: 'unidade',
    async executar() {
      const escritas = [];
      const deps = { escrever: async (m, onToken) => (escritas.push(m), onToken('Sua internet está ótima.'), 'Sua internet está ótima.'), emit: () => {} };
      const medir = async ({ modo }) => ({
        modo,
        servidor: 'VIX',
        ocioso: { mediana: 7.6, jitter: 0.5, perdaPct: 0 },
        download: { mbps: 557.3, latencia: 7.7 },
        upload: { mbps: 135.5, latencia: 8 },
        bufferbloat: { nota: 'A+', aumentoDown: 0.1, aumentoUp: 0.4 },
        linhaDoTempo: [0, 1, 2, 3, 4, 5].map((i) => ({ t: i * 1000, fase: i < 2 ? 'parado' : i < 4 ? 'baixando' : 'enviando', latencia: 7 + i / 10 })),
        bytesUsados: 300e6,
        duracaoS: 11,
      });
      const pergunta = await responderRede({ pergunta: 'teste minha internet', deps, medir });
      const escritasAntes = escritas.length;
      const r = await responderRede({ pergunta: 'pode testar', conversa: [{ role: 'assistant', content: PERGUNTA_DE_CONFIRMACAO }], deps, medir });
      return [
        pergunta.texto === PERGUNTA_DE_CONFIRMACAO && escritasAntes === 0 || 'sem confirmação não mede',
        /\| Download \| \*\*557\.3 Mbps\*\* \|/.test(r.texto) && /300 MB de dados/.test(r.texto) || r.texto.slice(0, 300),
        /Sua internet está ótima\./.test(r.texto) || 'explicação',
        (r.texto.match(/```chart/g) || []).length === 2 || 'gráficos',
        /download 557\.3 Mbps/.test(escritas[0][0].content) && /nota de bufferbloat A\+/.test(escritas[0][0].content) && /SÓ os números medidos/.test(escritas[0][0].content) || 'o modelo recebe os números',
      ];
    },
  },
];
