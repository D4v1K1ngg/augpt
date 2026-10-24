'use strict';

/**
 * Busca de preços no estilo do Google Shopping (24/10, pedido do Davi): o mesmo princípio — juntar os
 * dados que as lojas publicam —, feito na hora da pergunta e só com fontes que deixam ler:
 * - Zoom e Buscapé (comparadores: Magazine Luiza, Amazon, KaBuM!, Terabyte, Pichau… quando listam);
 * - KaBuM! (os produtos nos dados estruturados da busca);
 * - Americanas (a busca pública da plataforma da loja, VTEX).
 * Google Shopping, Mercado Livre, Terabyte, Pichau, Casas Bahia e Carrefour bloqueiam leitura
 * automática (testado em 24/10) e ficam de fora — sem contornar.
 */

const { baixar } = require('./http');
const { ofertasDoHtml } = require('./ofertas');
const { casa } = require('../agent/onde-comprar');

const ACESSORIO = /\b(capas?|cases?|pel[ií]culas?|suportes?|cabos?|adaptador\w*|backplate|waterblock|water block|bracket|riser|ventoinhas?|fans?|kit de|pasta t[ée]rmica|protetor\w*|skins?|adesivos?)\b/i;
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
// um computador inteiro com a peça pedida não é a peça ("PC Gamer … RTX 5080" a R$ 57.600)
const SISTEMA = /\b(pc gamer|computador|notebook|desktop|kit upgrade|workstation|all in one|laptop)\b|\bssd\s*\d+\s*(gb|tb)\b[\s\S]*\b(ram|ddr\d)\b|\b(ram|ddr\d)\b[\s\S]*\bssd\s*\d+\s*(gb|tb)\b|\b(zephyrus|stealth|legion|predator|nitro v|katana|raider|omen|alienware|vivobook|ideapad|aspire)\b/i;
// o tipo do item é a primeira palavra do anúncio: "Tampa para Console PlayStation 5 Slim" é tampa
const COMECA_COM_ACESSORIO = /^(leitor|drive|analogicos?|gatilhos?|botoes|baterias?|carcacas?|pecas?|tampas?|capas?|cases?|pel[ií]culas?|suportes?|cabos?|adaptador(es)?|controles?|carregador(es)?|bases?|skins?|adesivos?|kit|bolsas?|estojos?|grips?|protetor(es)?|ventoinhas?|cooler|pasta|backplate|bracket|riser|jogo|game|mousepad)\b/i;
const tipoAcessorio = (nome, produto) => {
  const m = COMECA_COM_ACESSORIO.exec(semAcento(nome).trim());
  return Boolean(m) && !semAcento(produto).includes(m[1].replace(/s$/, ''));
};
// o tipo do produto: no pedido, em qualquer lugar; no anúncio, nas primeiras palavras. Tipos diferentes
// não são o mesmo produto ("controle DualSense" × "Console PS5 Pro com controle"); a palavra do tipo
// não é exigida no anúncio ("notebook Asus ROG Zephyrus" × "Asus Rog Zephyrus G16 · Intel…")
const TIPOS = {
  notebook: /\b(notebook|laptop)\b/, console: /\b(console|videogame|video game)\b/, controle: /\b(controle|gamepad|joystick)\b/,
  mouse: /\bmouse\b/, teclado: /\b(teclado|keyboard)\b/, fone: /\b(fone|headset|headphone|earbuds?|auriculares?)\b/, monitor: /\bmonitor\b/,
  placa: /\b(placa de video|gpu|placa grafica)\b/, tv: /\b(tv|televisao|smart tv)\b/, cadeira: /\bcadeira\b/, processador: /\bprocessador\b/,
  celular: /\b(celular|smartphone)\b/, tablet: /\btablet\b/,
};
const tipoDe = (texto, { inicio = false } = {}) => {
  const t = semAcento(texto).replace(/[^a-z0-9 ]+/g, ' ').trim();
  const alvo = inicio ? t.split(/\s+/).slice(0, 3).join(' ') : t;
  return Object.keys(TIPOS).find((k) => TIPOS[k].test(alvo)) || null;
};
const semTipo = (produto) => {
  const tipo = tipoDe(produto);
  return tipo ? semAcento(produto).replace(TIPOS[tipo], ' ').replace(/\s+/g, ' ').trim() || produto : produto;
};
/** "Leitor de Disco para PlayStation 5 Slim": o produto aparece depois de "para" — é peça dele. */
const ehPecaPara = (nome, produto) => {
  const n = semAcento(apelidos(nome));
  const primeiro = semAcento(apelidos(semTipo(produto))).split(/\s+/).find((t) => t.length >= 2);
  const i = primeiro ? n.indexOf(primeiro) : -1;
  return i > 0 && /\b(para|p\/|for|compativel com|compativel)\s*$/.test(n.slice(Math.max(0, i - 20), i).trim()) && !/\bpara\b/.test(semAcento(produto));
};
// usado, seminovo, recondicionado: entra, marcado (filtro Novo/Usado no cartão)
const USADO = /\b(usad[oa]s?|seminov[oa]s?|recondicionad[oa]s?|vitrine|open box|refurbished|used|mostru[áa]rio)\b/i;

/** O anúncio é do produto pedido? */
function ehOProduto(nome, produto) {
  const tipoPedido = tipoDe(produto);
  const tipoAnuncio = tipoDe(nome, { inicio: true });
  if (tipoPedido && tipoAnuncio && tipoPedido !== tipoAnuncio) return false;
  return casa(apelidos(nome), apelidos(semTipo(produto)))
    && (!ACESSORIO.test(nome) || ACESSORIO.test(produto))
    && (!SISTEMA.test(nome) || SISTEMA.test(produto) || tipoPedido === 'notebook')
    && !tipoAcessorio(nome, produto)
    && !ehPecaPara(nome, produto);
}
// o mesmo produto escrito de dois jeitos: "PS5" e "PlayStation 5"
const apelidos = (t) => String(t || '')
  .replace(/play\s?station\s?(\d)/gi, 'ps$1')
  .replace(/xbox\s+series\s+([xs])/gi, 'xbox series$1')
  .replace(/\bgeforce\s+rtx\b/gi, 'rtx');

/** O __NEXT_DATA__ de uma página do Zoom ou do Buscapé. */
function dadosNext(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  try {
    return m ? JSON.parse(m[1]) : null;
  } catch {
    return null;
  }
}

/** Zoom/Buscapé (mesma empresa e mesmo formato): ofertas da busca e, nos produtos, as lojas de cada um. */
async function doComparador(produto, { nome, base }, { pedir, paginas = 2, produtosAbertos = 3 }) {
  const ofertas = [];
  const produtos = [];
  const respostas = await Promise.all(Array.from({ length: paginas }, (_, i) => pedir(`${base}/search?q=${encodeURIComponent(produto)}${i ? `&page=${i + 1}` : ''}`).catch(() => null)));
  for (const r of respostas) {
    const hits = dadosNext(r?.texto)?.props?.initialReduxState?.hits?.hits || [];
    for (const h of hits) {
      if (h.type === 'offer' && h.price > 0) {
        ofertas.push({ nome: h.name, preco: h.price, loja: h.merchantName || h.bestOffer?.merchantName, link: `${base}${h.url}`, imagem: h.image, parcelas: h.installments?.amount_months > 1 ? { vezes: h.installments.amount_months, valor: h.installments.price } : null, fonte: nome });
      } else if (h.type === 'product' && h.url) produtos.push(h);
    }
  }
  // produto com várias lojas: a página dele lista cada oferta
  const paginasDosProdutos = await Promise.all(produtos.slice(0, produtosAbertos).map((p) => pedir(`${base}${p.url}`).then((r) => ({ p, r })).catch(() => null)));
  for (const item of paginasDosProdutos) {
    const lista = dadosNext(item?.r?.texto)?.props?.initialReduxState?.offers?.offerList || [];
    for (const o of lista) {
      if (o.price > 0) ofertas.push({ nome: o.name || item.p.name, preco: o.price, loja: o.sellerName, link: `${base}/lead?oid=${o.id}`, imagem: o.imageUrl || item.p.image, parcelas: o.numParcels > 1 ? { vezes: o.numParcels, valor: o.parcelValue } : null, fonte: nome });
    }
  }
  return ofertas;
}

async function doKabum(produto, { pedir }) {
  const slug = semAcento(produto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const r = await pedir(`https://www.kabum.com.br/busca/${slug}`);
  return ofertasDoHtml(r?.texto, r?.url || 'https://www.kabum.com.br/').map((o) => ({ nome: o.nome, preco: o.avista || o.preco, loja: 'KaBuM!', link: o.url, imagem: o.imagem, parcelas: null, fonte: 'KaBuM!' }));
}

async function daAmericanas(produto, { pedir }) {
  const r = await pedir(`https://www.americanas.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(produto)}&_from=0&_to=19`);
  const lista = JSON.parse(r?.texto || '[]');
  return (Array.isArray(lista) ? lista : []).flatMap((p) => {
    const item = p.items?.[0];
    const oferta = item?.sellers?.find((s) => s.commertialOffer?.AvailableQuantity > 0)?.commertialOffer;
    if (!oferta?.Price) return [];
    return [{ nome: p.productName, preco: oferta.Price, loja: 'Americanas', link: p.link, imagem: item.images?.[0]?.imageUrl, parcelas: null, fonte: 'Americanas' }];
  });
}

const FONTES = [
  { nome: 'Zoom', buscar: (q, o) => doComparador(q, { nome: 'Zoom', base: 'https://www.zoom.com.br' }, o) },
  { nome: 'Buscapé', buscar: (q, o) => doComparador(q, { nome: 'Buscapé', base: 'https://www.buscape.com.br' }, o) },
  { nome: 'KaBuM!', buscar: doKabum },
  { nome: 'Americanas', buscar: daAmericanas },
];

/** A mediana (para o "preço muito abaixo do normal"). */
const mediana = (v) => {
  const o = [...v].sort((a, b) => a - b);
  return o.length ? (o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2) : 0;
};

/**
 * As ofertas do produto em todas as fontes, juntas: { ofertas: [{ nome, preco, loja, link, imagem,
 * parcelas, fonte, exato, suspeito }], fontes: [{ nome, ok, n }] }. `exato`: o nome traz todas as
 * palavras do produto e não é acessório; `suspeito`: produto exato por menos de 60% da mediana.
 */
async function buscarOfertas(produto, { deps = {}, timeoutMs = 15000 } = {}) {
  const pedir = (url) => (deps.baixar || baixar)(url, { timeout: timeoutMs, maxBytes: 4_000_000 });
  const resultados = await Promise.all(FONTES.map((f) => f.buscar(produto, { pedir }).then((o) => ({ f, o }), () => ({ f, o: null }))));
  const vistas = new Set();
  const ofertas = [];
  for (const { o } of resultados) {
    for (const x of o || []) {
      const nome = String(x.nome || '').replace(/\s+/g, ' ').trim();
      if (!nome || !(x.preco > 0) || !/^https?:/.test(String(x.link || ''))) continue;
      // Zoom e Buscapé repetem as mesmas ofertas: a mesma loja, o mesmo preço e o mesmo nome contam uma vez
      const chave = `${semAcento(x.loja)}|${Math.round(x.preco)}|${semAcento(nome).slice(0, 40)}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const exato = ehOProduto(nome, produto);
      ofertas.push({ nome: nome.slice(0, 160), preco: Math.round(x.preco * 100) / 100, loja: x.loja || x.fonte, link: x.link, imagem: /^https?:/.test(String(x.imagem || '')) ? x.imagem : null, parcelas: x.parcelas, fonte: x.fonte, exato, usado: USADO.test(nome), suspeito: false });
    }
  }
  // suspeito: menos de 60% do primeiro quartil (os 25% mais baratos) — a mediana subia com os modelos
  // caros da mesma linha e marcava preço normal (RTX 5080 a R$ 11.799 com mediana de R$ 20 mil)
  const exatos = ofertas.filter((o) => o.exato && !o.usado);
  const precos = exatos.map((o) => o.preco).sort((a, b) => a - b);
  const quartil = precos.length ? precos[Math.floor((precos.length - 1) * 0.25)] : 0;
  const meio = mediana(precos);
  if (exatos.length >= 4) for (const o of exatos) o.suspeito = o.preco < quartil * 0.6;
  ofertas.sort((a, b) => Number(b.exato) - Number(a.exato) || a.preco - b.preco);
  return { ofertas, mediana: meio, fontes: resultados.map(({ f, o }) => ({ nome: f.nome, ok: Array.isArray(o), n: (o || []).length })) };
}

/** O menor preço confiável (produto exato, sem suspeita; novo, a não ser que `usado`). */
const menorConfiavel = (ofertas, { usado = false } = {}) => ofertas.filter((o) => o.exato && !o.suspeito && o.usado === usado).sort((a, b) => a.preco - b.preco)[0] || null;

module.exports = { buscarOfertas, menorConfiavel, ehOProduto, dadosNext, mediana, FONTES };
