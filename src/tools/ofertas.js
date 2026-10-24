'use strict';

/**
 * Ofertas de uma página de loja (17/10). O leitor de páginas procura texto
 * corrido de matéria, e a grade de produtos (nome curto, preço, botão) é
 * justamente o que ele descarta: na busca do KaBuM sobravam ~1.000 caracteres
 * sem preço nenhum, com 84 preços no HTML. As lojas publicam os produtos em
 * dados estruturados para buscadores (JSON-LD) e nos dados da própria página
 * (__NEXT_DATA__ e afins) — é isso que se lê aqui. Nada de contornar
 * proteção: só a página que a loja entregou.
 */

const NOME = /^(name|title|nome|productName|shortName|titulo)$/i;
const PRECO = /^(price|preco|preço|salePrice|bestPrice|lowPrice|minPrice|finalPrice|currentPrice|sellingPrice|priceMarketplace)$/i;
const A_VISTA = /^(priceWithDiscount|pixPrice|priceWithPix|cashPrice|precoAVista|priceCash)$/i;
const URL_CAMPO = /^(url|link|href|productUrl|seoUrl|permalink|canonicalUrl)$/i;
const LOJA = /^(sellerName|seller|storeName|loja|vendedor)$/i;
const LOJAS = /^(storeCount|stores|numberOfStores|offersCount)$/i;
// a foto do produto (24/10, cartão de compras)
const IMAGEM = /^(image|imagem|imageUrl|imageURL|thumbnail|thumbnailUrl|thumb|img|photo|foto)$/i;

const numero = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!t) return NaN;
  // "1.049,08" (pt-BR) ou "1049.08"
  return /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''));
};

function absoluta(u, base) {
  try {
    return new URL(String(u), base).toString();
  } catch {
    return null;
  }
}

/** Um objeto qualquer dos dados embutidos vira oferta se tiver nome e preço. */
function comoOferta(o, base) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const chaves = Object.keys(o);
  const kNome = chaves.find((k) => NOME.test(k) && typeof o[k] === 'string' && o[k].trim().length >= 6);
  // JSON-LD: o preço fica em offers (objeto ou lista)
  const ofertaLd = Array.isArray(o.offers) ? o.offers[0] : o.offers;
  const kPreco = chaves.find((k) => PRECO.test(k) && numero(o[k]) > 0);
  const preco = kPreco ? numero(o[kPreco]) : ofertaLd ? numero(ofertaLd.price ?? ofertaLd.lowPrice) : NaN;
  if (!kNome || !(preco > 0)) return null;
  const kAvista = chaves.find((k) => A_VISTA.test(k) && numero(o[k]) > 0);
  const kUrl = chaves.find((k) => URL_CAMPO.test(k) && typeof o[k] === 'string' && o[k].length > 1);
  // KaBuM: /produto/<código>/<nome amigável>
  const url = kUrl ? absoluta(o[kUrl], base) : o.friendlyName && o.code ? absoluta(`/produto/${o.code}/${o.friendlyName}`, base) : ofertaLd?.url ? absoluta(ofertaLd.url, base) : null;
  const kLoja = chaves.find((k) => LOJA.test(k) && typeof o[k] === 'string' && o[k].trim());
  const kLojas = chaves.find((k) => LOJAS.test(k) && numero(o[k]) > 1);
  const kImagem = chaves.find((k) => IMAGEM.test(k) && (typeof o[k] === 'string' || Array.isArray(o[k]) || (o[k] && typeof o[k] === 'object')));
  const imagemBruta = kImagem ? (Array.isArray(o[kImagem]) ? o[kImagem][0] : o[kImagem]) : null;
  const imagem = imagemBruta && absoluta(typeof imagemBruta === 'string' ? imagemBruta : imagemBruta.url || imagemBruta.contentUrl || '', base);
  const avista = kAvista ? numero(o[kAvista]) : NaN;
  return {
    nome: String(o[kNome]).replace(/\s+/g, ' ').trim().slice(0, 160),
    preco,
    avista: avista > 0 && avista < preco ? avista : null,
    moeda: ofertaLd?.priceCurrency || o.priceCurrency || o.currency || 'BRL',
    url,
    vendedor: kLoja ? String(o[kLoja]).trim().slice(0, 60) : null,
    lojas: kLojas ? numero(o[kLojas]) : null,
    imagem: imagem && /^https?:/.test(imagem) ? imagem : null,
  };
}

function percorrer(no, base, saida, profundidade = 0) {
  if (!no || typeof no !== 'object' || profundidade > 18 || saida.length >= 60) return;
  const oferta = comoOferta(no, base);
  if (oferta) {
    saida.push(oferta);
    return;
  }
  for (const v of Array.isArray(no) ? no : Object.values(no)) percorrer(v, base, saida, profundidade + 1);
}

/** Todas as ofertas da página, sem repetir (mesmo nome e preço). */
function ofertasDoHtml(html, base = undefined) {
  const blocos = [];
  for (const m of String(html || '').matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) blocos.push(m[1]);
  const next = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ''));
  if (next) blocos.push(next[1]);
  const achadas = [];
  for (const b of blocos) {
    try {
      percorrer(JSON.parse(b.trim()), base, achadas);
    } catch {
      /* bloco que não é JSON válido */
    }
  }
  const vistas = new Set();
  return achadas.filter((o) => {
    const chave = `${o.nome.toLowerCase()}|${o.preco}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

const reais = (v, moeda = 'BRL') =>
  moeda === 'BRL' ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${moeda} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** As ofertas como texto para o modelo ler. */
function textoDasOfertas(ofertas, maximo = 20) {
  return ofertas
    .slice(0, maximo)
    .map((o) => `- ${o.nome} — ${reais(o.preco, o.moeda)}${o.avista ? ` (à vista ${reais(o.avista, o.moeda)})` : ''}${o.lojas ? ` — a partir disso, em ${o.lojas} lojas` : ''}${o.vendedor ? ` — vendido por ${o.vendedor}` : ''}${o.url ? ` — ${o.url}` : ''}`)
    .join('\n');
}

module.exports = { ofertasDoHtml, textoDasOfertas, comoOferta, numero, reais };
