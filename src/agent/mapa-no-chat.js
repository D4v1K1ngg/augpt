'use strict';

/**
 * Mapa e globo no chat (23/10, pedido do Davi, bloco 4): "onde fica a Torre Eiffel?", "mostre
 * Campinas no mapa", "quanto tempo levo de Campinas até São Paulo de carro?", "qual a distância
 * entre Curitiba e Florianópolis?". O código acha os lugares no Nominatim (OpenStreetMap) e as
 * rotas no OSRM do OpenStreetMap Alemanha (carro, a pé e bicicleta, sem trânsito), e põe um bloco
 * ```mapa na resposta, que a tela desenha como um globo/mapa interativo (renderer/mapa.js).
 * Só os nomes dos lugares e as coordenadas saem do PC.
 */

const { baixar } = require('../tools/http');
const { cidadeDaMemoria, ALIASES } = require('./clima-no-chat');

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const VERSAO = (() => {
  try {
    return require('../../package.json').version;
  } catch {
    return '0';
  }
})();
// a política do Nominatim e do OSRM pede um User-Agent que identifique o app
const AGENTE = `AuGPT/${VERSAO} (+https://github.com/D4v1K1ngg/augpt)`;

/* ------------------------------ que pedido é ------------------------------ */

const MODOS = [
  ['pe', /\b(a pe|andando|caminhando|caminhada|on foot|walking|walk)\b/],
  ['bike', /\b(de bicicleta|de bike|pedalando|bicicleta|by bike|cycling|bike)\b/],
  ['carro', /\b(de carro|dirigindo|de moto|by car|driving|drive)\b/],
];
const MODO_TEXTO = /(?<!\p{L})(de carro|dirigindo|de moto|a p[ée]|andando|caminhando|de bicicleta|de bike|pedalando|by car|driving|on foot|walking|by bike|cycling)(?!\p{L})/giu;
const ROTA = /\b(quanto tempo (eu )?(levo|leva|levaria|levarei|demora|demoro|demoraria|gasto|gasta|da|e)|qual (e )?a distancia|distancia (entre|de|daqui|ate|do|da)|quantos (km|quilometros)|rota (de|para|pra|ate|entre|do|da)|como (chego|chegar|ir|vou|faco para chegar) (a|ao|na|no|em|para|pra|ate|aa)|trajeto (de|para|ate)|how (long|far)|distance (from|between|to)|route (from|to)|directions (to|from))\b/;
const LUGAR = /\b(onde fica|onde e que fica|onde esta localizad[oa]|onde (e|eh) (a|o) (cidade|pais|estado)|mostre?( me)? .{1,60} no mapa|no mapa|^mapa (de|do|da)|mostre?( me)? o mapa (de|do|da)|localizacao (de|do|da)|where is|show .{1,60} on (the )?map|map of)\b/;
// o que não é lugar no mundo: PC, apps, jogos, corpo
const FORA = /\b(pasta|arquivo|configurac|opcao|botao|menu|ajuste|driver|bios|tecla|windows|aplicativo|app|site|pagina|celular|programa|jogo|game|pubg|erangel|miramar|sanhok|vikendi|minecraft|gta|fortnite|valorant|warzone|lol|cs2?|figado|rim|cerebro|coracao|pancreas|apendice|no corpo|na placa|no pc|no computador|no notebook|na tela|da terra|a lua|ao sol|marte|jupiter|saturno|planeta|galaxia|estrela|the moon|the sun|mars)\b/;
const GEO = /\b(cidade|pais|estado|rua|avenida|av|praia|ilha|monte|montanha|lago|rio|parque|museu|aeroporto|estadio|bairro|praca|ponte|torre|catedral|igreja|shopping|universidade|cachoeira|serra|vulcao|deserto|city|country|street|beach|island|mountain|lake|river|park|museum|airport|stadium|tower)\b/;

const limpar = (s) => String(s || '').replace(/[?!.]+\s*$/, '').replace(/^\s*(?:(?:a|o|as|os|the|ir|chegar|viajar|dirigir|andar|na|no|em|ao|à|at[ée]|para|pra|pro|to)\s+)+/i, '').replace(/\s+(hoje|agora|amanh[ãa]|today|now)\s*$/i, '').trim();
const apelido = (s) => ALIASES[semAcento(s)] || s;

/** O pedido: { tipo: 'rota', origem, destino, modo } | { tipo: 'lugar', lugar } | null. */
function pedidoDeMapa(pergunta) {
  const original = String(pergunta || '').replace(/\s+/g, ' ').trim();
  const t = semAcento(original);
  if (!t || t.length > 180 || FORA.test(t)) return null;
  const modo = (MODOS.find(([, re]) => re.test(t)) || ['carro'])[0];
  if (ROTA.test(t)) {
    // sem o modo ("de carro" atrapalha o "de X até Y") e sem o pedaço antes da pergunta
    const resto = original.replace(MODO_TEXTO, ' ').replace(/\s+/g, ' ');
    const m = new RegExp(ROTA.source, 'i').exec(semAcento(resto));
    // a preposição do fim da pergunta-chave ("distância de", "como chego na") volta para o resto
    const chave = m[0].replace(/\s(?:entre|de|do|da|daqui|ate|para|pra|a|ao|na|no|em|aa|to|from|between)$/, '');
    const depois = resto.slice(m.index + chave.length).trim();
    let origem = null;
    let destino = null;
    let x;
    if ((x = /^(?:.*?\s)?(?:entre|between)\s+(.+?)\s+(?:e|and)\s+(.+)$/i.exec(depois))) [origem, destino] = [x[1], x[2]];
    else if ((x = /^(?:.*?\s)?(?:de|do|da|desde|from)\s+(.+?)\s+(?:at[ée]|para|pra|pro|ao|à|a|to)\s+(.+)$/i.exec(depois))) [origem, destino] = [x[1], x[2]];
    else if ((x = /^(.+?)\s+(?:saindo de|partindo de|from)\s+(.+)$/i.exec(depois))) [destino, origem] = [x[1], x[2]];
    else if ((x = /^(?:.*?\s)?(?:at[ée]|para|pra|pro|ao|à|a|em|no|na|to)\s+(.+)$/i.exec(depois))) destino = x[1];
    origem = limpar(origem || '');
    if (/^(daqui|aqui|minha casa|casa|here|home)$/i.test(origem)) origem = '';
    destino = limpar(destino);
    if (!destino || destino.length < 2) return null;
    // só o destino, sem nome próprio nem geografia, não é lugar ("quanto tempo leva pra ferver um ovo")
    if (!origem && !/[A-ZÀ-Ú]/.test(destino) && !GEO.test(semAcento(destino))) return null;
    return { tipo: 'rota', origem: origem ? apelido(origem) : null, destino: apelido(destino), modo };
  }
  if (LUGAR.test(t)) {
    const x = /(?:onde (?:e que )?fica|onde est[áa] localizad[oa]|onde (?:é|e|eh) (?:a|o)|localiza[çc][ãa]o (?:de|do|da)|mapa (?:de|do|da)|mostre?(?: me)?|where is|show(?: me)?|map of)\s+(.+?)(?:\s+no mapa|\s+on (?:the )?map)?\s*[?!.]*$/i.exec(original);
    const lugar = limpar(x?.[1] || '');
    if (!lugar || lugar.length < 2) return null;
    // "onde fica …" sem nome próprio nem palavra de geografia não é lugar ("onde fica o fígado")
    const explicito = /\b(no mapa|mapa|on (the )?map|map of|localizacao)\b/.test(t);
    if (!explicito && !/[A-ZÀ-Ú]/.test(lugar) && !GEO.test(semAcento(lugar))) return null;
    return { tipo: 'lugar', lugar: apelido(lugar.replace(/^(a|o|as|os|the)\s+/i, '')) };
  }
  return null;
}

/* ------------------------------ Nominatim e OSRM ------------------------------ */

let ultimoNominatim = 0;
/** No máximo 1 pedido por segundo ao Nominatim (a política dele). */
async function esperarVez() {
  const falta = ultimoNominatim + 1100 - Date.now();
  ultimoNominatim = Math.max(Date.now(), ultimoNominatim + 1100);
  if (falta > 0) await new Promise((ok) => setTimeout(ok, falta));
}

async function pedirJson(url, deps) {
  const r = await (deps.baixar || baixar)(url, { timeout: 12000, headers: { 'User-Agent': AGENTE, Accept: 'application/json' } });
  if (!r?.ok) throw new Error(`HTTP ${r?.status || '?'}`);
  return JSON.parse(r.texto);
}

/** "Torre Eiffel", "Campinas", "Av. Paulista, 1000" → { nome, onde, lat, lon, bbox } ou null. */
async function acharLugar(nome, { idioma = 'pt', deps = {} } = {}) {
  if (!deps.baixar) await esperarVez();
  const lista = await pedirJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(nome)}&format=jsonv2&limit=5&addressdetails=1&accept-language=${idioma === 'en' ? 'en' : 'pt-BR'}`, deps);
  if (!Array.isArray(lista) || !lista.length) return null;
  // sem país na pergunta: o resultado do Brasil, se for um dos mais relevantes
  const br = lista.slice(0, 3).find((x) => x.address?.country_code === 'br' && Number(x.importance || 0) >= Number(lista[0].importance || 0) * 0.9);
  const x = br || lista[0];
  const a = x.address || {};
  const cidade = a.city || a.town || a.village || a.municipality || a.county;
  const nomeCurto = x.name || String(x.display_name).split(',')[0];
  const partes = [cidade, a.state, a.country].filter((p, i, l) => p && p !== nomeCurto && l.indexOf(p) === i);
  const bb = (x.boundingbox || []).map(Number); // [sul, norte, oeste, leste]
  return { nome: nomeCurto, onde: partes.join(', '), lat: Number(x.lat), lon: Number(x.lon), bbox: bb.length === 4 ? [bb[2], bb[0], bb[3], bb[1]] : null, tipo: x.addresstype || x.type };
}

const PERFIS = { carro: 'routed-car', pe: 'routed-foot', bike: 'routed-bike' };
/** Rota pelo OSRM do OpenStreetMap Alemanha → { km, min, linha: [[lon, lat]…] } ou null (sem estrada). */
async function rota(origem, destino, modo, deps = {}) {
  const j = await pedirJson(`https://routing.openstreetmap.de/${PERFIS[modo]}/route/v1/driving/${origem.lon},${origem.lat};${destino.lon},${destino.lat}?overview=full&geometries=geojson`, deps);
  const r = j.code === 'Ok' && j.routes?.[0];
  if (!r) return null;
  const pontos = r.geometry?.coordinates || [];
  // até ~600 pontos: o desenho fica igual e o bloco não pesa na conversa
  const passo = Math.max(1, Math.ceil(pontos.length / 600));
  const linha = pontos.filter((_, i) => i % passo === 0 || i === pontos.length - 1).map(([lo, la]) => [Math.round(lo * 1e5) / 1e5, Math.round(la * 1e5) / 1e5]);
  return { km: Math.round(r.distance / 100) / 10, min: Math.round(r.duration / 60), linha };
}

/** Distância em linha reta (km). */
function emLinhaReta(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

/* ------------------------------ a resposta ------------------------------ */

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const duracao = (min, en) => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 48) return en ? `${Math.round(min / 60)} h (about ${Math.round(min / 1440)} days without stops)` : `${Math.round(min / 60)} h (cerca de ${Math.round(min / 1440)} dias sem paradas)`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
};
const km = (v, en) => `${v < 10 ? v.toLocaleString(en ? 'en-US' : 'pt-BR', { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString(en ? 'en-US' : 'pt-BR')} km`;

async function responderMapa({ pergunta, deps = {}, config = {}, pasta, pedido } = {}) {
  const p = pedido || pedidoDeMapa(pergunta);
  if (!p) return null;
  const en = config.idiomaEfetivo === 'en';
  const fim = (texto, bloco) => {
    const completo = bloco ? `${texto}\n\n\`\`\`mapa\n${JSON.stringify({ idioma: en ? 'en' : 'pt', ...bloco })}\n\`\`\`` : texto;
    deps.emit?.('resposta-token', { pedaco: completo, noIdioma: en });
    return { ...SEM_PESQUISA, texto: completo, modo: 'mapa', noIdioma: en };
  };
  try {
    if (p.tipo === 'lugar') {
      const l = await acharLugar(p.lugar, { idioma: en ? 'en' : 'pt', deps });
      if (!l) return null; // o mapa não conhece: a pesquisa responde
      const texto = l.onde
        ? en ? `**${l.nome}** is in ${l.onde}.` : `**${l.nome}** fica em ${l.onde}.`
        : `**${l.nome}**.`;
      return fim(texto, { tipo: 'lugar', lugar: l });
    }

    const nomeDaOrigem = p.origem || cidadeDaMemoria(pasta);
    if (!nomeDaOrigem) {
      return fim(en
        ? `From where? Ask, for example, **"how long from Campinas to ${p.destino}"**, or say **"remember that I live in Campinas"** and I'll use it as the starting point.`
        : `Saindo de onde? Pergunte, por exemplo, **"quanto tempo de Campinas até ${p.destino}"**, ou diga **"lembre que moro em Campinas"** e eu uso como ponto de partida.`);
    }
    const origem = await acharLugar(nomeDaOrigem, { idioma: en ? 'en' : 'pt', deps });
    const destino = origem && (await acharLugar(p.destino, { idioma: en ? 'en' : 'pt', deps }));
    if (!origem || !destino) {
      const faltou = !origem ? nomeDaOrigem : p.destino;
      return fim(en ? `I couldn't find **"${faltou}"** on the map. Try a fuller name, like "Campinas, SP".` : `Não achei **"${faltou}"** no mapa. Tente um nome mais completo, como "Campinas, SP".`);
    }
    const modos = ['carro', 'pe', 'bike'];
    const rotas = Object.fromEntries((await Promise.all(modos.map((m) => rota(origem, destino, m, deps).catch(() => null)))).map((r, i) => [modos[i], r]));
    const reta = emLinhaReta(origem, destino);
    const escolhida = rotas[p.modo] || rotas.carro;
    const modoUsado = rotas[p.modo] ? p.modo : 'carro';
    const nomes = en ? { carro: 'by car', pe: 'on foot', bike: 'by bike' } : { carro: 'de carro', pe: 'a pé', bike: 'de bicicleta' };
    const de = `**${origem.nome}**`;
    const ate = `**${destino.nome}**`;
    let texto;
    if (!escolhida) {
      texto = en ? `There is no road route between ${de} and ${ate}. In a straight line, it is **${km(reta, true)}**.` : `Não há rota por estrada entre ${de} e ${ate}. Em linha reta, são **${km(reta, false)}**.`;
    } else {
      texto = en
        ? `From ${de} to ${ate} ${nomes[modoUsado]}: **${duracao(escolhida.min, true)}** (${km(escolhida.km, true)})${modoUsado === 'carro' ? ', not counting traffic' : ''}.`
        : `De ${de} até ${ate} ${nomes[modoUsado]}: **${duracao(escolhida.min, false)}** (${km(escolhida.km, false)})${modoUsado === 'carro' ? ', sem contar o trânsito' : ''}.`;
      const outros = modos.filter((m) => m !== modoUsado && rotas[m] && rotas[m].min <= 24 * 60).map((m) => `${nomes[m]} ${duracao(rotas[m].min, en)}`);
      if (outros.length) texto += en ? ` Other ways: ${outros.join(', ')}.` : ` Outras formas: ${outros.join(', ')}.`;
      if (p.modo !== modoUsado) texto += en ? ' (No route for the mode you asked; showing by car.)' : ' (Não achei rota no modo que você pediu; mostro de carro.)';
    }
    return fim(texto, { tipo: 'rota', origem: { nome: origem.nome, onde: origem.onde, lat: origem.lat, lon: origem.lon }, destino: { nome: destino.nome, onde: destino.onde, lat: destino.lat, lon: destino.lon }, modo: modoUsado, rotas, reta });
  } catch (err) {
    deps.emit?.('aviso', { texto: `mapa: ${err.message}` });
    return null; // Nominatim ou OSRM fora: a pesquisa responde
  }
}

module.exports = { pedidoDeMapa, acharLugar, responderMapa, emLinhaReta };
