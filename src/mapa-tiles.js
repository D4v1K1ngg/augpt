'use strict';

/**
 * Os pedaços (tiles) do mapa do chat (23/10, bloco 4): a tela pede `augpt-mapa://osm/z/x/y` e este
 * processo busca no OpenStreetMap (ou o satélite Sentinel-2 cloudless da EOX), guarda no disco e
 * entrega. A janela continua sem acessar a internet direto (ver a CSP do index.html).
 * Política de uso do tile.openstreetmap.org: User-Agent que identifica o app, cache local e poucos
 * pedidos ao mesmo tempo — sem baixar regiões inteiras.
 * ponytail: o cache não tem limite de tamanho; com uso normal fica em dezenas de MB. Se crescer,
 * apagar os arquivos mais velhos que 30 dias ao abrir o app.
 */

const fs = require('fs');
const path = require('path');

const ESQUEMA = 'augpt-mapa';
const FONTES = {
  osm: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, ext: 'png', tipo: 'image/png', maxZoom: 19, limite: 2 },
  // Sentinel-2 cloudless 2016 (EOX, CC BY 4.0): cidades e regiões, não casas
  sat: { url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`, ext: 'jpg', tipo: 'image/jpeg', maxZoom: 14, limite: 4 },
};
const VALIDADE_MS = 30 * 24 * 3600 * 1000;

/** `augpt-mapa://osm/5/10/12` → { fonte, z, x, y } ou null (fora do padrão ou do mundo). */
function lerPedido(url) {
  const m = /^augpt-mapa:\/\/(osm|sat)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(?:\.(?:png|jpg))?\/?$/.exec(String(url));
  if (!m) return null;
  const [z, x, y] = [m[2], m[3], m[4]].map(Number);
  const fonte = FONTES[m[1]];
  if (z > fonte.maxZoom || x >= 2 ** z || y >= 2 ** z) return null;
  return { fonte: m[1], z, x, y };
}

// poucos pedidos ao mesmo tempo por servidor
const filas = {};
async function naVez(fonte, fn) {
  const f = (filas[fonte] ||= { ativos: 0, espera: [] });
  if (f.ativos >= FONTES[fonte].limite) await new Promise((ok) => f.espera.push(ok));
  f.ativos += 1;
  try {
    return await fn();
  } finally {
    f.ativos -= 1;
    f.espera.shift()?.();
  }
}

/** Responde o pedido da tela: do cache, ou baixa, guarda e responde. */
async function servir(url, { dir, agente, buscar = (...a) => fetch(...a) } = {}) {
  const p = lerPedido(url);
  if (!p) return new Response('', { status: 404 });
  const fonte = FONTES[p.fonte];
  const arquivo = path.join(dir, p.fonte, String(p.z), String(p.x), `${p.y}.${fonte.ext}`);
  const responder = (corpo) => new Response(corpo, { headers: { 'Content-Type': fonte.tipo, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' } });
  let guardado = null;
  try {
    const info = fs.statSync(arquivo);
    guardado = fs.readFileSync(arquivo);
    if (Date.now() - info.mtimeMs < VALIDADE_MS) return responder(guardado);
  } catch {
    // não está no cache
  }
  try {
    const r = await naVez(p.fonte, () => buscar(fonte.url(p.z, p.x, p.y), { headers: { 'User-Agent': agente }, signal: AbortSignal.timeout(15000) }));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, bytes);
    return responder(bytes);
  } catch {
    // sem internet: o pedaço velho do cache serve
    return guardado ? responder(guardado) : new Response('', { status: 404 });
  }
}

module.exports = { ESQUEMA, FONTES, lerPedido, servir };
