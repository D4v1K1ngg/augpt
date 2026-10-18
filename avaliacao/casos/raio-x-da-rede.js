'use strict';

/**
 * Raio-X da rede local e trava de promessa (18/10). PowerShell, netsh, ping,
 * a página do roteador e a varredura são dublês; os formatos vêm da medição
 * real no PC do Davi (cabo 1 Gbps, TP-Link Archer AX73 v2, 13 aparelhos).
 */

const raioX = require('../../src/rede/raio-x');
const capacidades = require('../../src/agent/capacidades');
const { pedidoDeDiagnostico, responderDiagnostico } = require('../../src/agent/rede-no-chat');

const INFO = {
  gateway: '192.168.0.1',
  placa: { nome: 'Ethernet', descricao: 'Realtek Gaming 2.5GbE Family Controller', velocidade: '1 Gbps', meio: '802.3', mac: 'AA-BB-CC-DD-EE-FF', driver: '10.1' },
  ip: '192.168.0.225',
  prefixo: 24,
  dhcp: 'Enabled',
  dns: '192.168.0.1', // o PowerShell devolve lista de 1 item como valor solto
  ipv6: true,
  outrasPlacas: 'Famatech Radmin VPN Ethernet Adapter',
  vizinhos: [
    { ip: '192.168.0.1', mac: '20-23-51-C9-F8-C4', estado: 'Reachable' },
    { ip: '192.168.0.48', mac: '08-3A-F2-11-22-33', estado: 'Stale' },
    { ip: '192.168.0.35', mac: '6A-11-22-33-44-55', estado: 'Stale' },
    { ip: '224.0.0.22', mac: '01-00-5E-00-00-16', estado: 'Permanent' },
  ],
};
const PING_PT = Array.from({ length: 20 }, () => 'Resposta de 192.168.0.1: bytes=32 tempo<1ms TTL=64').join('\n');
const PAGINA = '<html><head><meta name="version" content="AX73v2_1.10.2_2025-11-26T09:56:42.178Z" /><title>Opening...</title></head></html>';

const dubles = ({ wifi = '', ping = PING_PT } = {}) => ({
  executar: async (cmd, args) => {
    if (cmd === 'powershell') return /Get-NetIPConfiguration/.test(args.join(' ')) ? JSON.stringify(INFO) : JSON.stringify(INFO.vizinhos);
    if (cmd === 'netsh') return wifi;
    if (cmd === 'ping') return ping;
    return '';
  },
  fetch: async (url) => ({ text: async () => (/192\.168\.0\.1\/$/.test(url) ? '<meta http-equiv="refresh" content="0; URL=/webpages/index.html" />' : PAGINA) }),
  enviar: async () => {},
});

const WIFI_PT = `Há 1 interface no sistema:

    Nome                   : Wi-Fi
    Estado                 : conectado
    SSID                   : CasaDavi
    Tipo de rádio          : 802.11n
    Banda                  : 2,4 GHz
    Canal                  : 6
    Taxa de recepção (Mbps)  : 72
    Taxa de transmissão (Mbps) : 72
    Sinal                  : 41%`;

module.exports = [
  {
    nome: 'raio-X: lê placa, ipconfig (DNS que vem solto do PowerShell), ping até o roteador, modelo e firmware pela etiqueta da página (seguindo o redirecionamento), aparelhos com fabricante e endereço privado; multicast fora',
    tipo: 'unidade',
    async executar() {
      const r = await raioX.raioX({ deps: dubles() });
      const tabela = raioX.tabelaDoRaioX(r);
      const achados = raioX.avaliar(r);
      return [
        r.ligacao.tipo === 'cabo' && r.ligacao.velocidade === '1 Gbps' || JSON.stringify(r.ligacao),
        r.config.dns.join() === '192.168.0.1' || JSON.stringify(r.config.dns),
        r.ping.mediana === 1 && r.ping.perdaPct === 0 && r.ping.amostras.length === 20 || JSON.stringify(r.ping),
        r.roteador.fabricante === 'TP-Link' && r.roteador.modelo === 'Archer AX73 v2' && r.roteador.firmware.data === '2025-11-26' || JSON.stringify(r.roteador),
        r.aparelhos.length === 3 && r.aparelhos.find((a) => a.ip === '192.168.0.48')?.fabricante === 'Espressif' && r.aparelhos.find((a) => a.ip === '192.168.0.35')?.aleatorio || JSON.stringify(r.aparelhos),
        /\*\*2\*\* além do roteador \(1 com endereço privado/.test(tabela) && /casa inteligente/.test(tabela) && /DNS 192\.168\.0\.1 \(o do roteador\)/.test(tabela) || tabela,
        achados.length === 1 && /Radmin VPN/.test(achados[0].texto) || JSON.stringify(achados),
      ];
    },
  },
  {
    nome: 'raio-X: Wi-Fi em português (sinal 41%, 2,4 GHz, 802.11n) e ping ruim até o roteador viram avisos com o número; varredura só em rede privada',
    tipo: 'unidade',
    async executar() {
      const ping = ['Resposta de 192.168.0.1: bytes=32 tempo=3ms TTL=64', 'Resposta de 192.168.0.1: bytes=32 tempo=48ms TTL=64', 'Esgotado o tempo limite do pedido.', ...Array(17).fill('Resposta de 192.168.0.1: bytes=32 tempo=9ms TTL=64')].join('\n');
      const r = await raioX.raioX({ deps: dubles({ wifi: WIFI_PT, ping }) });
      const textos = raioX.avaliar(r).map((a) => a.texto).join(' | ');
      return [
        r.wifi.sinal === 41 && r.wifi.padrao === 'Wi-Fi 4' && r.wifi.banda === '2,4 GHz' && r.ligacao.tipo === 'Wi-Fi' || JSON.stringify(r.wifi),
        /sinal do Wi-Fi está em 41%/.test(textos) && /2,4 GHz/.test(textos) && /padrão antigo/.test(textos) || textos,
        /5% dos pings até o roteador se perderam/.test(textos) && /ping até o roteador está em 9 ms/.test(textos) && /pior 48 ms/.test(textos) || textos,
        (await raioX.acordarAFaixa('8.8.8.8', 24, { enviar: async () => {} })) === 0 && (await raioX.acordarAFaixa('192.168.0.10', 24, { enviar: async () => {} })) === 253 || 'varredura só em rede privada',
      ];
    },
  },
  {
    nome: 'raio-X no chat: "quantos aparelhos estão na minha rede?" e "qual o modelo do meu roteador?" pedem o raio-X; a explicação recebe os números, a nota do teste anterior e a ordem de não mandar medir de novo',
    tipo: 'unidade',
    async executar() {
      const escritas = [];
      const r = await responderDiagnostico({
        pergunta: 'e se o problema for do meu pc até o roteador?',
        conversa: [{ role: 'assistant', content: '| Bufferbloat | **nota A+** |' }],
        deps: { escrever: async (m, onToken) => (escritas.push(m), onToken('Está tudo bem.'), 'Está tudo bem.'), emit: () => {} },
        medir: (o) => raioX.raioX({ ...o, deps: dubles() }),
      });
      const sistema = escritas[0][0].content;
      return [
        Boolean(pedidoDeDiagnostico('quantos dispositivos estão conectados na minha rede?')) && Boolean(pedidoDeDiagnostico('qual o modelo do meu roteador?')) && Boolean(pedidoDeDiagnostico('mostre o ipconfig')) || 'pedidos',
        pedidoDeDiagnostico('como ver quantos aparelhos estão na rede?') === null || 'pergunta de como fazer',
        /\*\*O que chamou atenção:\*\*/.test(r.texto) && /Está tudo bem\./.test(r.texto) && /```chart/.test(r.texto) || r.texto.slice(0, 300),
        /bufferbloat nota A\+/.test(sistema) && /JÁ FOI MEDIDO/.test(sistema) && /ping até o roteador: 1 ms/.test(sistema) || 'a explicação recebe os números',
        capacidades.EXECUTAVEIS.includes('diagnostico_da_rede') || 'no catálogo',
      ];
    },
  },
  {
    nome: 'roteador (item 3): só sugere trocar com sinal medido (bufferbloat C ou pior, Wi-Fi antigo, firmware velho); AX73 com A+ "não precisa trocar"; com bufferbloat ruim, oferece a pesquisa com o perfil medido, e o "sim" vira a pergunta de produto',
    tipo: 'unidade',
    async executar() {
      const r = await raioX.raioX({ deps: dubles() });
      const bom = raioX.avaliarRoteador(r, { nota: 'A+', mbps: 557 });
      const ruim = raioX.avaliarRoteador(r, { nota: 'D', mbps: 557 });
      const semTeste = raioX.avaliarRoteador(r, {});
      const resposta = (nota) =>
        responderDiagnostico({
          pergunta: 'meu roteador é bom?',
          conversa: [{ role: 'assistant', content: `| Download | **557.4 Mbps** |\n| Bufferbloat | **nota ${nota}** |` }],
          deps: { escrever: async () => 'ok', emit: () => {} },
          medir: (o) => raioX.raioX({ ...o, deps: dubles() }),
        });
      const comA = await resposta('A+');
      const comD = await resposta('D');
      const oferta = /Quer que eu pesquise \*\*(.+?)\*\*\?/.exec(comD.texto)?.[1] || '';
      const aceita = capacidades.aceitouOferta('sim', [{ role: 'assistant', content: comD.texto }]);
      return [
        !bom.trocar && ruim.trocar && !semTeste.trocar || JSON.stringify({ bom, ruim, semTeste }),
        /bufferbloat nota D/.test(ruim.motivos[0]) || JSON.stringify(ruim.motivos),
        /não precisa trocar/.test(comA.texto) && /TP-Link Archer AX73 v2 está dando conta/.test(comA.texto) && !/Quer que eu pesquise/.test(comA.texto) || comA.texto.slice(-400),
        /vale considerar trocar/.test(comD.texto) && /Wi-Fi 6 com QoS ou SQM/.test(oferta) && /internet de 600 Mbps/.test(oferta) || oferta || comD.texto.slice(-400),
        aceita?.id === 'pesquisa' && aceita.pergunta === `pesquise ${oferta}` || JSON.stringify(aceita),
      ];
    },
  },
  {
    nome: 'trava de promessa: frase em que o AuGPT promete o que não faz sai ("posso abrir o Gerenciador de Tarefas", "o AuGPT pode rodar um teste de transferência local" — conversa real); as que ele cumpre e as que não prometem ação ficam',
    tipo: 'unidade',
    executar() {
      const texto = [
        '*   **Como fazer:** O AuGPT pode rodar um teste de transferência de dados local simulando o tráfego que o PUBG gera.',
        '*   **Ação do AuGPT:** Posso abrir o **Gerenciador de Tarefas** e mostrar quais processos estão usando mais CPU/RAM agora, além de verificar o uso da porta Wi-Fi.',
        'Também posso abrir o Painel de Controle para você. Posso explicar o QoS em detalhes.',
        'O AuGPT pode acessar o site da operadora. Posso medir o seu ping até os servidores do jogo.',
        capacidades.CAPACIDADES[0].oferta,
        '```\nposso abrir o regedit\n```',
      ].join('\n');
      const r = capacidades.conferirPromessas(texto);
      return [
        r.tiradas.length === 3 || JSON.stringify(r.tiradas),
        !/Gerenciador de Tarefas|transferência de dados local|Painel de Controle/.test(r.texto.replace(/```[\s\S]*```/, '')) || r.texto,
        /Posso explicar o QoS/.test(r.texto) && /acessar o site da operadora/.test(r.texto) && /medir o seu ping/.test(r.texto) && r.texto.includes(capacidades.CAPACIDADES[0].oferta) || r.texto,
        /posso abrir o regedit/.test(r.texto) || 'bloco de código fica',
        !/^\s*\*\s+\*\*Como fazer:\*\*\s*$/m.test(r.texto) || 'item que ficou vazio sai',
      ];
    },
  },
];
