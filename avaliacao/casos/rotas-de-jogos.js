'use strict';

/**
 * Rotas para jogos (18/10, item 3). ping, tracert e as APIs (AWS, Valve) são
 * dublês; as saídas são as do Windows em português, copiadas de uma medição real.
 */

const rotas = require('../../src/rede/rotas');
const { pedidoDeRota, responderRota, pedidoDeRede } = require('../../src/agent/rede-no-chat');
const { validarGrafico } = require('../../src/agent/nucleo/graficos');

const PING_PT = `Disparando 155.133.227.9 com 32 bytes de dados:
Resposta de 155.133.227.9: bytes=32 tempo=17ms TTL=55
Resposta de 155.133.227.9: bytes=32 tempo=18ms TTL=55
Esgotado o tempo limite do pedido.
Resposta de 155.133.227.9: bytes=32 tempo<1ms TTL=55`;

const TRACERT_PT = `Rastreando a rota para 35.71.106.130 com no máximo 25 saltos

  1    <1 ms    <1 ms     1 ms  192.168.0.1
  2     8 ms     2 ms     3 ms  100.64.15.254
  3     1 ms     1 ms     1 ms  177.184.48.9
  4     *        *        *     Esgotado o tempo limite do pedido.
  5     *        *        *     Esgotado o tempo limite do pedido.
  6    18 ms    17 ms    18 ms  35.71.106.130

Rastreamento concluído.`;

module.exports = [
  {
    nome: 'rotas: lê o ping e o tracert do Windows em português ("tempo=17ms", "<1 ms", "Esgotado o tempo limite"); só IP ou endpoint da AWS como destino (nada de argumento livre no comando)',
    tipo: 'unidade',
    executar() {
      const saltos = rotas.lerTracert(TRACERT_PT);
      return [
        rotas.lerPing(PING_PT).join() === '17,18,1' || rotas.lerPing(PING_PT).join(),
        saltos.length === 6 && saltos[0].ip === '192.168.0.1' && saltos[0].ms === 1 && saltos[3].ms === null && saltos[5].ms === 18 || JSON.stringify(saltos),
        rotas.destinoValido('155.133.227.9') && rotas.destinoValido('dynamodb.sa-east-1.amazonaws.com') || 'destinos válidos',
        !rotas.destinoValido('1.1.1.1 & del C:\\') && !rotas.destinoValido('exemplo.com') && !rotas.destinoValido('-n 9999') || 'destino perigoso',
      ];
    },
  },
  {
    nome: 'rotas: mede as regiões da AWS (sem as 2 primeiras medidas, que têm o TLS), escolhe a melhor e traça o caminho até ela; Valve pinga um relay por cidade; tabela agrupa saltos sem resposta',
    tipo: 'unidade',
    async executar() {
      const vezes = {};
      const fetchAws = async (url) => {
        const reg = /dynamodb\.([a-z0-9-]+)\./.exec(url)[1];
        vezes[reg] = (vezes[reg] || 0) + 1;
        return { text: async () => 'healthy' };
      };
      const comandos = [];
      const executar = async (cmd, args) => (comandos.push([cmd, ...args].join(' ')), cmd === 'ping' ? PING_PT : TRACERT_PT);
      const r = await rotas.medirJogo('pubg', { deps: { fetch: fetchAws, executar } });
      const valve = await rotas.medirJogo('cs2', {
        deps: { fetch: async () => ({ json: async () => ({ pops: { gru: { desc: 'Sao Paulo (Brazil)', relays: [{ ipv4: '155.133.227.9' }] }, eze: { desc: 'Buenos Aires', relays: [{ ipv4: '155.133.255.98' }] }, x: { desc: 'sem relay' } } }) }), executar },
        comRota: false,
      });
      const tabela = rotas.tabelasDoJogo(r);
      return [
        r.destinos.length === 8 || `regiões: ${r.destinos.length}`,
        Object.values(vezes).every((v) => v === 5) || JSON.stringify(vezes),
        comandos.some((c) => /^tracert -d -w 700 -h 25 dynamodb\.[a-z]{2}-[a-z]+-\d\.amazonaws\.com$/.test(c)) || process.platform !== 'win32' || comandos.join(' | '),
        r.rota.length === 6 && r.rota[0].onde === 'seu roteador' && r.rota[1].onde === 'rede local ou da operadora' && r.rota[5].onde === 'destino' || JSON.stringify(r.rota),
        /\| 4–5 \| sem resposta \| — \| roteadores que não respondem ao teste \(normal\) \|/.test(tabela.rota) || tabela.rota,
        valve.destinos.length === 2 && valve.destinos.every((d) => d.ms === 17) && comandos.filter((c) => /^ping /.test(c)).length === 2 || JSON.stringify(valve.destinos),
        rotas.graficosDoJogo(r).every((g) => validarGrafico(g.replace(/^```chart\n|\n```$/g, '')).ok) || 'gráficos válidos',
      ];
    },
  },
  {
    nome: 'rotas: o chat reconhece pedido de ping/rota de jogo ("meu ping no PUBG", "rota até o servidor do Valorant", "tracert") e deixa pergunta sobre o jogo em paz; a resposta traz as tabelas medidas, a explicação com só esses números e os gráficos; Riot avisa que é referência',
    tipo: 'unidade',
    async executar() {
      const escritas = [];
      const medir = async (jogo) => ({
        jogo: { chave: jogo, nome: rotas.JOGOS[jogo].nome, provedor: rotas.JOGOS[jogo].provedor, nota: rotas.JOGOS[jogo].nota || null },
        destinos: [{ id: 'sa-east-1', nome: 'São Paulo', ms: 18, perdaPct: 0 }, { id: 'us-east-1', nome: 'EUA Leste (Virgínia)', ms: 149, perdaPct: 0 }],
        semResposta: [],
        melhor: { id: 'sa-east-1', nome: 'São Paulo', ms: 18 },
        rota: rotas.lerTracert(TRACERT_PT).map((s, i, a) => ({ ...s, onde: i === 0 ? 'seu roteador' : i === a.length - 1 ? 'destino' : 'internet' })),
      });
      const r = await responderRota({ pergunta: 'qual meu ping no valorant?', deps: { escrever: async (m, onToken) => (escritas.push(m), onToken('Jogue em São Paulo.'), 'Jogue em São Paulo.'), emit: () => {} }, medir });
      return [
        pedidoDeRota('qual meu ping nos servidores do PUBG?')?.jogo === 'pubg' || 'pubg',
        pedidoDeRota('mede meu ping no cs2')?.jogo === 'cs2' || 'cs2 (rota antes do teste de rede)',
        pedidoDeRota('rota até o servidor do valorant')?.jogo === 'valorant' || 'valorant',
        pedidoDeRota('faça um tracert')?.jogo === 'aws' || 'tracert sem jogo',
        pedidoDeRota('o pubg é bom?') === null && pedidoDeRota('qual a melhor arma do pubg?') === null && pedidoDeRota('o que é lag em jogos?') === null || 'pergunta sobre o jogo',
        pedidoDeRota('mede meu ping') === null && pedidoDeRede('mede meu ping')?.modo === 'ping' || 'ping sem jogo é o teste de rede',
        /\*\*São Paulo\*\* \(melhor\) \| 18 ms/.test(r.texto) && /Caminho até São Paulo/.test(r.texto) || r.texto.slice(0, 300),
        /Riot não publica/.test(r.texto) && /Riot não publica/.test(escritas[0][0].content) || 'referência da Riot',
        /São Paulo 18 ms/.test(escritas[0][0].content) && /SÓ os números medidos/.test(escritas[0][0].content) || 'o modelo recebe os números',
        (r.texto.match(/```chart/g) || []).length === 2 || 'gráficos',
      ];
    },
  },
];
