'use strict';

/**
 * Tráfego de rede por programa (18/10, item 5). netstat, tasklist e o DNS
 * reverso são dublês; as saídas são as do Windows em português.
 */

const trafego = require('../../src/rede/trafego');
const { pedidoDeTrafego, responderTrafego, pedidoDeRede } = require('../../src/agent/rede-no-chat');
const { validarGrafico } = require('../../src/agent/nucleo/graficos');

const NETSTAT_E = (rec, env) => `Estatísticas de interface

                           Recebido         Enviado

Bytes                    ${rec}      ${env}
Pacotes unicast             4524427         4439448`;

const NETSTAT_ANO = `
Conexões ativas

  Proto  Endereço local         Endereço externo       Estado           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1740
  TCP    192.168.0.10:50001     3.84.255.43:443        ESTABLISHED     3068
  TCP    192.168.0.10:50002     142.250.79.14:443      ESTABLISHED     3068
  TCP    192.168.0.10:50003     142.250.79.14:443      TIME_WAIT       3068
  TCP    192.168.0.10:50004     192.168.0.1:80         ESTABLISHED     3068
  TCP    [2804::1]:50005        [2600:1419::17c4:e070]:443  ESTABLISHED  9000
  TCP    192.168.0.10:50006     155.133.227.9:27015    ESTABLISHED     9000
  UDP    0.0.0.0:5353           *:*                                    1400
  UDP    0.0.0.0:27015          *:*                                    9000`;

const TASKLIST = `"System","4","Services","0","148 K"
"svchost.exe","1400","Services","0","9.580 K"
"firefox.exe","3068","Console","1","412.000 K"
"steam.exe","9000","Console","1","180.000 K"`;

const NOMES = { '3.84.255.43': 'ec2-3-84-255-43.compute-1.amazonaws.com', '142.250.79.14': 'rr3---sn-x.googlevideo.com', '2600:1419::17c4:e070': 'g2600.deploy.static.akamaitechnologies.com', '155.133.227.9': 'gru.valve.net' };

function dubles() {
  let n = 0;
  let t = 0;
  // 2 Mbit por segundo baixando; o contador passa de 4 GB no meio (volta a zero)
  const leituras = [[2 ** 32 - 300000, 1000], [2 ** 32 - 50000, 26000], [200000, 51000], [450000, 76000]];
  return {
    executar: async (cmd, args) => {
      if (cmd === 'netstat' && args[0] === '-e') {
        const [rec, env] = leituras[Math.min(n, leituras.length - 1)];
        n += 1;
        return NETSTAT_E(rec, env);
      }
      if (cmd === 'netstat') return NETSTAT_ANO;
      if (cmd === 'tasklist') return TASKLIST;
      return '';
    },
    esperar: async () => {
      t += 1000;
    },
    agora: () => t,
    reverso: async (ip) => (NOMES[ip] ? [NOMES[ip]] : []),
  };
}

module.exports = [
  {
    nome: 'tráfego: lê netstat -e/-ano e tasklist do Windows em português; a taxa aguenta o contador de 32 bits voltando a zero; agrupa por programa (só conexão estabelecida, rede local fora) e dá nome ao serviço (YouTube, AWS, Akamai, Valve)',
    tipo: 'unidade',
    async executar() {
      const r = await trafego.medirTrafego({ segundos: 3, deps: dubles() });
      const firefox = r.programas.find((p) => p.nome === 'firefox');
      const steam = r.programas.find((p) => p.nome === 'steam');
      const tabela = trafego.tabelaDoTrafego(r);
      return [
        r.taxa.length === 3 && r.taxa.every((x) => x.downMbps === 2 && x.upMbps === 0.2) || JSON.stringify(r.taxa),
        firefox.tcp === 3 && firefox.destinos.length === 2 && firefox.servicos.join() === 'Amazon AWS (jogos, sites, apps),YouTube (vídeo)' || JSON.stringify(firefox),
        steam.tcp === 2 && steam.udp === 1 && steam.servicos.includes('Steam / Valve') && steam.servicos.some((s) => /Akamai/.test(s)) || JSON.stringify(steam),
        r.programas.find((p) => p.nome === 'svchost')?.udp === 1 || 'UDP do svchost',
        r.totalConexoes === 5 || r.totalConexoes, // conta a da rede local também; a lista de destinos é que a deixa de fora
        /recebendo 2 Mbps em média/.test(tabela) && /\| firefox \| 3 \| 0 \|/.test(tabela) && /sem permissão de administrador/.test(tabela) || tabela,
        trafego.graficosDoTrafego(r).every((g) => validarGrafico(g.replace(/^```chart\n|\n```$/g, '')).ok) || 'gráficos',
      ];
    },
  },
  {
    nome: 'tráfego: o chat reconhece "o que está consumindo minha internet?" e "quais programas estão usando a rede?" (antes do teste de velocidade), não "como analisar o tráfego de rede?"; a resposta tem a tabela medida, a explicação que não inventa banda por programa e os gráficos',
    tipo: 'unidade',
    async executar() {
      const escritas = [];
      const d = dubles();
      const r = await responderTrafego({
        pergunta: 'o que está consumindo minha internet?',
        deps: { escrever: async (m, onToken) => (escritas.push(m), onToken('O Firefox está vendo vídeo.'), 'O Firefox está vendo vídeo.'), emit: () => {} },
        medir: (o) => trafego.medirTrafego({ ...o, segundos: 3, deps: d }),
      });
      return [
        Boolean(pedidoDeTrafego('o que está consumindo minha internet?') && pedidoDeTrafego('quais programas estão usando a internet?') && pedidoDeTrafego('analise o tráfego da minha rede')) || 'pedidos',
        pedidoDeTrafego('como analisar o tráfego de rede?') === null && pedidoDeTrafego('teste minha internet') === null && pedidoDeTrafego('qual programa para baixar vídeos?') === null || 'não é pedido',
        pedidoDeRede('analise o tráfego da minha rede') !== null || 'o teste de rede também casaria: por isso o tráfego vem antes no loop',
        /\| firefox \| 3 \|/.test(r.texto) && /O Firefox está vendo vídeo\./.test(r.texto) && (r.texto.match(/```chart/g) || []).length === 2 || r.texto.slice(0, 300),
        /não diga quanto cada um consome/.test(escritas[0][0].content) && /firefox: 3 conexões ativas/.test(escritas[0][0].content) && /resmon/.test(escritas[0][0].content) || 'instruções da explicação',
      ];
    },
  },
];
