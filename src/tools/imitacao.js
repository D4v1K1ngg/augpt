'use strict';

/**
 * Sites que imitam outros (30/10, análise das pesquisas do Davi: "bosebrasilsiteoficial.com" e "bose-brazil.com"
 * foram lidos como fonte de um fone da Bose — a Bose é bose.com; "wukihow.com" imita o wikihow). Loja falsa com o
 * nome da marca é golpe clássico: vende e não entrega. Duas regras, só pelo endereço:
 * - nome de marca + palavra de loja/oficial no domínio que NÃO é o da marca → imitação;
 * - domínio a uma letra de um site muito conhecido → imitação.
 * A mesma tabela diz o site oficial: pergunta que cita a marca (ou o órgão) prefere ele.
 * ponytail: lista de marcas fixa; marca nova que aparecer no golpe entra aqui.
 */

// marca (como aparece no domínio) → domínios oficiais (o domínio e os subdomínios dele valem)
const OFICIAIS = {
  bose: ['bose.com', 'bose.com.br', 'bose.co.uk'],
  apple: ['apple.com'],
  samsung: ['samsung.com'],
  logitech: ['logitech.com', 'logitechg.com', 'logi.com'],
  xiaomi: ['mi.com', 'xiaomi.com'],
  nvidia: ['nvidia.com'],
  amd: ['amd.com'],
  intel: ['intel.com', 'intel.com.br'],
  sony: ['sony.com', 'sony.com.br', 'playstation.com'],
  jbl: ['jbl.com', 'jbl.com.br', 'harman.com'],
  motorola: ['motorola.com', 'motorola.com.br'],
  lenovo: ['lenovo.com'],
  dell: ['dell.com'],
  asus: ['asus.com', 'rog.asus.com'],
  acer: ['acer.com'],
  corsair: ['corsair.com'],
  razer: ['razer.com'],
  hyperx: ['hyperx.com'],
  philips: ['philips.com', 'philips.com.br'],
  microsoft: ['microsoft.com', 'xbox.com', 'live.com'],
  nike: ['nike.com', 'nike.com.br'],
  adidas: ['adidas.com', 'adidas.com.br'],
  mercadolivre: ['mercadolivre.com.br', 'mercadolibre.com'],
  kabum: ['kabum.com.br'],
  amazon: ['amazon.com', 'amazon.com.br'],
  magalu: ['magazineluiza.com.br', 'magalu.com'],
  americanas: ['americanas.com.br'],
  casasbahia: ['casasbahia.com.br'],
  shopee: ['shopee.com.br', 'shopee.com'],
  aliexpress: ['aliexpress.com'],
  netflix: ['netflix.com'],
  steam: ['steampowered.com', 'steamcommunity.com'],
  nubank: ['nubank.com.br'],
  // órgãos: quem pergunta deles quer o site do próprio órgão
  stf: ['stf.jus.br'],
  stj: ['stj.jus.br'],
  tse: ['tse.jus.br'],
  inss: ['gov.br'],
  receita: ['gov.br'],
};
// como a pessoa escreve a marca na pergunta, quando é diferente do domínio
const NA_PERGUNTA = { mercadolivre: /mercado ?livre/, magalu: /magalu|magazine ?luiza/, casasbahia: /casas ?bahia/, stf: /\bstf\b|supremo tribunal/, stj: /\bstj\b/, tse: /\btse\b/, receita: /receita federal/, inss: /\binss\b/ };
const PALAVRA_DE_GOLPE = /oficial|official|brasil|brazil|store|loja|shop|outlet|promo|desconto|ofertas|sale|black|online|site|original|br-|-br\b/;
// sites muito conhecidos (o nome antes do ".com") — a uma letra deles é imitação
const CONHECIDOS = ['wikihow', 'wikipedia', 'youtube', 'google', 'amazon', 'mercadolivre', 'kabum', 'reddit', 'instagram', 'facebook', 'whatsapp', 'netflix', 'magazineluiza', 'americanas', 'aliexpress', 'shopee', 'paypal', 'nubank', 'bradesco', 'santander', 'itau', 'microsoft', 'apple', 'samsung', 'steampowered', 'pichau', 'terabyteshop'];

const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** "loja.bose-brazil.com" → "bose-brazil"; "x.com.br" → "x" (o nome registrado, sem subdomínio nem final). */
function nomeRegistrado(dominio) {
  const partes = String(dominio || '').toLowerCase().replace(/^www\./, '').split('.');
  const finalDuplo = partes.length >= 3 && /^(com|org|net|gov|edu|jus|art|blog)$/.test(partes[partes.length - 2]) && partes[partes.length - 1].length === 2;
  return partes[partes.length - (finalDuplo ? 3 : 2)] || '';
}
const ehOficial = (dominio, lista) => lista.some((o) => dominio === o || dominio.endsWith(`.${o}`));

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** O domínio imita uma marca ou um site conhecido? → { motivo } ou null. */
function imitacao(dominioOuUrl) {
  let dominio = String(dominioOuUrl || '').toLowerCase();
  try {
    if (/^https?:/.test(dominio)) dominio = new URL(dominio).hostname;
  } catch {
    return null;
  }
  dominio = dominio.replace(/^www\./, '');
  const nome = nomeRegistrado(dominio);
  if (!nome) return null;
  for (const [marca, oficiais] of Object.entries(OFICIAIS)) {
    if (marca.length < 4 || !nome.includes(marca) || nome === marca || ehOficial(dominio, oficiais)) continue;
    if (PALAVRA_DE_GOLPE.test(nome.replace(marca, ''))) return { marca, motivo: `parece imitar ${marca} (o site oficial é ${oficiais[0]})` };
  }
  if (nome.length >= 6) {
    const parecido = CONHECIDOS.find((c) => c !== nome && distancia(nome, c) === 1);
    if (parecido) return { marca: parecido, motivo: `nome quase igual ao de ${parecido} — provável imitação` };
  }
  return null;
}

/** Os sites oficiais das marcas e órgãos que a pergunta cita (para preferir na busca). */
function oficiaisDaPergunta(pergunta) {
  const t = semAcento(pergunta);
  const saida = [];
  for (const [marca, oficiais] of Object.entries(OFICIAIS)) {
    const re = NA_PERGUNTA[marca] || new RegExp(`\\b${marca}\\b`);
    if (re.test(t)) saida.push(...oficiais.filter((o) => o !== 'gov.br' || /\binss\b|receita/.test(t)));
  }
  return [...new Set(saida)];
}
const doSiteOficial = (url, oficiais) => {
  try {
    return oficiais.length > 0 && ehOficial(new URL(url).hostname.replace(/^www\./, '').toLowerCase(), oficiais);
  } catch {
    return false;
  }
};

module.exports = { imitacao, oficiaisDaPergunta, doSiteOficial, nomeRegistrado, OFICIAIS };
