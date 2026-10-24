'use strict';

/**
 * Mapa e globo no chat (23/10): o que é pedido de lugar ou de rota, as respostas e o bloco ```mapa,
 * e os pedaços do mapa (src/mapa-tiles.js). Nominatim, OSRM e os servidores de mapa são dublês.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../../src/agent/mapa-no-chat');
const tiles = require('../../src/mapa-tiles');
const rotas = require('../../src/agent/rotas-do-codigo');
const { MemoriaCentral } = require('../../src/agent/memoria-central');

const LUGARES = {
  'torre eiffel': [{ name: 'Torre Eiffel', lat: '48.8582', lon: '2.2945', importance: 0.8, boundingbox: ['48.8574', '48.8590', '2.2933', '2.2956'], address: { city: 'Paris', state: 'Ilha de França', country: 'França', country_code: 'fr' } }],
  campinas: [{ name: 'Campinas', lat: '-22.90', lon: '-47.06', importance: 0.7, boundingbox: ['-23.2', '-22.6', '-47.3', '-46.8'], address: { city: 'Campinas', state: 'São Paulo', country: 'Brasil', country_code: 'br' } }],
  'são paulo': [{ name: 'São Paulo', lat: '-23.55', lon: '-46.63', importance: 0.9, boundingbox: ['-24.0', '-23.3', '-46.8', '-46.3'], address: { city: 'São Paulo', state: 'São Paulo', country: 'Brasil', country_code: 'br' } }],
  lisboa: [
    { name: 'Lisboa', lat: '38.72', lon: '-9.14', importance: 0.85, address: { city: 'Lisboa', country: 'Portugal', country_code: 'pt' } },
    { name: 'Lisboa', lat: '-5.0', lon: '-40.0', importance: 0.3, address: { village: 'Lisboa', state: 'Ceará', country: 'Brasil', country_code: 'br' } },
  ],
  'ilha da madeira': [{ name: 'Madeira', lat: '32.75', lon: '-16.95', importance: 0.7, address: { state: 'Madeira', country: 'Portugal', country_code: 'pt' } }],
};

function servicos(pedidos = []) {
  return async (url) => {
    pedidos.push(url);
    if (url.includes('nominatim')) {
      const q = decodeURIComponent(/q=([^&]+)/.exec(url)[1]).toLowerCase();
      return { ok: true, status: 200, texto: JSON.stringify(LUGARES[q] || []) };
    }
    const perfil = /routed-(car|foot|bike)/.exec(url)[1];
    if (url.includes('-16.95')) return { ok: true, status: 200, texto: JSON.stringify({ code: 'NoRoute' }) };
    const dados = { car: [99000, 4560], foot: [104000, 83640], bike: [100000, 24480] }[perfil];
    const linha = Array.from({ length: 2000 }, (_, i) => [-47.06 + i * 0.0002, -22.9 - i * 0.0003]);
    return { ok: true, status: 200, texto: JSON.stringify({ code: 'Ok', routes: [{ distance: dados[0], duration: dados[1], geometry: { coordinates: linha } }] }) };
  };
}

module.exports = [
  {
    nome: 'mapa: reconhece "onde fica", "no mapa", rotas e distâncias (origem, destino, modo; pt e en); fígado, pasta do PC, mapa de jogo, ovo e a Lua ficam fora',
    tipo: 'unidade',
    executar() {
      const p = (q) => m.pedidoDeMapa(q);
      const igual = (q, esperado) => JSON.stringify(p(q)) === JSON.stringify(esperado) || `${q} → ${JSON.stringify(p(q))}`;
      const fora = ['onde fica o fígado?', 'onde fica a pasta downloads?', 'mapa de erangel no pubg', 'quanto tempo leva pra ferver um ovo?', 'quanto tempo demora pra instalar o windows?', 'qual a distância da terra até a lua?', 'como está o tempo em Campinas?', 'que dia é hoje?'];
      return [
        igual('onde fica a Torre Eiffel?', { tipo: 'lugar', lugar: 'Torre Eiffel' }),
        igual('mostre Campinas no mapa', { tipo: 'lugar', lugar: 'Campinas' }),
        igual('where is the Eiffel Tower?', { tipo: 'lugar', lugar: 'Eiffel Tower' }),
        igual('quanto tempo levo de Campinas até São Paulo de carro?', { tipo: 'rota', origem: 'Campinas', destino: 'São Paulo', modo: 'carro' }),
        igual('quanto tempo eu levo para ir de Rio de Janeiro até Niterói a pé?', { tipo: 'rota', origem: 'Rio de Janeiro', destino: 'Niterói', modo: 'pe' }),
        igual('qual a distância entre Curitiba e Florianópolis?', { tipo: 'rota', origem: 'Curitiba', destino: 'Florianópolis', modo: 'carro' }),
        igual('quanto tempo leva até Campinas?', { tipo: 'rota', origem: null, destino: 'Campinas', modo: 'carro' }),
        igual('como chego na Avenida Paulista saindo de Campinas?', { tipo: 'rota', origem: 'Campinas', destino: 'Avenida Paulista', modo: 'carro' }),
        igual('distância de SP pro RJ', { tipo: 'rota', origem: 'São Paulo', destino: 'Rio de Janeiro', modo: 'carro' }),
        igual('rota de Campinas para Santos de bicicleta', { tipo: 'rota', origem: 'Campinas', destino: 'Santos', modo: 'bike' }),
        igual('how long from London to Paris by car?', { tipo: 'rota', origem: 'London', destino: 'Paris', modo: 'carro' }),
        ...fora.map((q) => p(q) === null || `fora: ${q} → ${JSON.stringify(p(q))}`),
        rotas.escolherRota({ objetivo: 'onde fica a Torre Eiffel?', conversa: [] })?.rota.id === 'mapa' || 'a rota do mapa',
        rotas.escolherRota({ objetivo: 'como está o tempo em Campinas?', conversa: [] })?.rota.id === 'clima' || 'o clima continua antes',
      ];
    },
  },
  {
    nome: 'mapa: as respostas (lugar, rota com os 3 modos, sem estrada em linha reta, origem da memória, sem origem pergunta), o Brasil só ganha quando é tão relevante quanto, a linha enxuta e o bloco',
    tipo: 'unidade',
    async executar() {
      const pedidos = [];
      const deps = { baixar: servicos(pedidos) };
      const r = (pergunta, extra = {}) => m.responderMapa({ pergunta, deps, config: {}, ...extra });
      const lugar = await r('onde fica a Torre Eiffel?');
      const rota = await r('quanto tempo levo de Campinas até São Paulo de carro?');
      const ape = await r('quanto tempo levo de Campinas até São Paulo a pé?');
      const lisboa = await m.acharLugar('Lisboa', { deps });
      const ilha = await r('qual a distância de Campinas até Ilha da Madeira?');
      const semOrigem = await r('quanto tempo leva até São Paulo?');
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-mapa-'));
      new MemoriaCentral(pasta).definir({ chave: 'cidade', valor: 'Moro em Campinas' });
      const daMemoria = await r('quanto tempo leva até São Paulo?', { pasta });
      fs.rmSync(pasta, { recursive: true, force: true });
      const ingles = await m.responderMapa({ pergunta: 'where is the Eiffel Tower?', deps: { baixar: async (u) => (u.includes('Eiffel%20Tower') ? { ok: true, status: 200, texto: JSON.stringify(LUGARES['torre eiffel']) } : servicos()(u)) }, config: { idiomaEfetivo: 'en' } });
      const bloco = JSON.parse(/```mapa\n([\s\S]*?)```/.exec(rota.texto)[1]);
      const fora = await m.responderMapa({ pergunta: 'onde fica a Torre Eiffel?', deps: { baixar: async () => ({ ok: false, status: 503 }) }, config: {} });
      return [
        /^\*\*Torre Eiffel\*\* fica em Paris, Ilha de França, França\./.test(lugar.texto) && /"tipo":"lugar"/.test(lugar.texto) || lugar.texto.slice(0, 160),
        /^De \*\*Campinas\*\* até \*\*São Paulo\*\* de carro: \*\*1 h 16 min\*\* \(99 km\), sem contar o trânsito\. Outras formas: a pé 23 h 14 min, de bicicleta 6 h 48 min\./.test(rota.texto) || rota.texto.slice(0, 200),
        /a pé: \*\*23 h 14 min\*\* \(104 km\)\. Outras formas: de carro 1 h 16 min/.test(ape.texto) || ape.texto.slice(0, 200),
        lisboa.onde === 'Portugal' || `Lisboa: ${lisboa.onde}`,
        /Não há rota por estrada entre \*\*Campinas\*\* e \*\*Madeira\*\*\. Em linha reta, são \*\*[\d.]+ km\*\*/.test(ilha.texto) || ilha.texto.slice(0, 160),
        /^Saindo de onde\?/.test(semOrigem.texto) || semOrigem.texto.slice(0, 100),
        /^De \*\*Campinas\*\* até \*\*São Paulo\*\*/.test(daMemoria.texto) || daMemoria.texto.slice(0, 100),
        /^\*\*Torre Eiffel\*\* is in Paris/.test(ingles.texto) && ingles.noIdioma === true || ingles.texto.slice(0, 100),
        bloco.tipo === 'rota' && bloco.modo === 'carro' && bloco.rotas.carro.linha.length <= 601 && bloco.rotas.pe.min === 1394 && bloco.reta > 60 || JSON.stringify(bloco).slice(0, 200),
        pedidos.filter((u) => u.includes('nominatim')).every((u) => /accept-language=/.test(u)) || 'idioma do Nominatim',
        fora === null || 'serviço fora: a pesquisa responde',
      ];
    },
  },
  {
    nome: 'mapa: os pedaços do mapa — só osm/sat dentro do mundo; baixa uma vez com User-Agent do AuGPT e depois vem do cache; sem internet, serve o que tem; a tela troca o bloco pelo cartão sem virar HTML',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-tiles-'));
      const pedidos = [];
      const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      const buscar = async (url, o) => (pedidos.push([url, o.headers['User-Agent']]), { ok: true, status: 200, arrayBuffer: async () => PNG });
      const a = await tiles.servir('augpt-mapa://osm/3/4/5', { dir, agente: 'AuGPT/teste', buscar });
      const b = await tiles.servir('augpt-mapa://osm/3/4/5', { dir, agente: 'AuGPT/teste', buscar });
      const sat = await tiles.servir('augpt-mapa://sat/2/1/3', { dir, agente: 'AuGPT/teste', buscar });
      const semRede = await tiles.servir('augpt-mapa://osm/3/4/5', { dir, agente: 'x', buscar: async () => { throw new Error('offline'); } });
      const inexistente = await tiles.servir('augpt-mapa://osm/4/1/1', { dir, agente: 'x', buscar: async () => { throw new Error('offline'); } });
      fs.rmSync(dir, { recursive: true, force: true });
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.md.render('```mapa\n{"tipo":"lugar","lugar":{"nome":"<img src=x onerror=alert(1)>"}}\n```');
      global.window = antes;
      return [
        tiles.lerPedido('augpt-mapa://osm/2/3/1')?.z === 2 || 'pedido válido',
        tiles.lerPedido('augpt-mapa://osm/2/4/1') === null && tiles.lerPedido('augpt-mapa://osm/20/1/1') === null && tiles.lerPedido('augpt-mapa://sat/15/1/1') === null && tiles.lerPedido('augpt-mapa://x/1/1/1') === null && tiles.lerPedido('augpt-mapa://osm/../../1') === null || 'fora do mundo / fonte desconhecida',
        a.status === 200 && b.status === 200 && pedidos.filter(([u]) => u.includes('tile.openstreetmap.org/3/4/5.png')).length === 1 || `cache: ${pedidos.length}`,
        pedidos.every(([, ua]) => ua === 'AuGPT/teste') || 'User-Agent',
        sat.status === 200 && pedidos.some(([u]) => u.includes('s2cloudless_3857/default/g/2/3/1.jpg')) || 'satélite (y antes de x)',
        semRede.status === 200 && inexistente.status === 404 || 'sem rede',
        /<div class="cartao-lugar" data-tipo="mapa" data-cal="\{&quot;tipo&quot;/.test(html) && !/<img/.test(html) || html,
      ];
    },
  },
];
