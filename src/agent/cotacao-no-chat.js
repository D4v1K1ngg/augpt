'use strict';

/**
 * Cotação de moedas pelos dados, não por sites (2/11, plano "chegar perto do ChatGPT na pesquisa", item 2): "qual a
 * cotação do dólar hoje?", "quanto está o euro?", "100 dólares em reais", "dólar turismo", "bitcoin". O valor do
 * momento vem da AwesomeAPI (gratuita, sem chave; atualiza durante o dia) e a referência oficial, do Banco Central
 * (PTAX, o fechamento de cada dia útil). Só sai do PC o código da moeda. Previsão ("o dólar vai subir?") e
 * história ficam com a pesquisa.
 */

const { baixar } = require('../tools/http');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const MOEDAS = [
  { codigo: 'USD', nome: 'Dólar', nomeEn: 'US dollar', re: /\b(dolar(es)?|usd|us\$|dollars?)\b/ },
  { codigo: 'EUR', nome: 'Euro', nomeEn: 'Euro', re: /\b(euros?|eur)\b/ },
  { codigo: 'GBP', nome: 'Libra esterlina', nomeEn: 'British pound', re: /\b(libras?( esterlinas?)?|gbp)\b/ },
  { codigo: 'ARS', nome: 'Peso argentino', nomeEn: 'Argentine peso', re: /\b(pesos? argentinos?|ars)\b/ },
  { codigo: 'JPY', nome: 'Iene', nomeEn: 'Japanese yen', re: /\b(ienes?|yen|jpy)\b/ },
  { codigo: 'CNY', nome: 'Yuan', nomeEn: 'Chinese yuan', re: /\b(yuan|renminbi|cny)\b/ },
  { codigo: 'CAD', nome: 'Dólar canadense', nomeEn: 'Canadian dollar', re: /\b(dolar(es)? canadense|cad)\b/ },
  { codigo: 'BTC', nome: 'Bitcoin', nomeEn: 'Bitcoin', re: /\b(bitcoins?|btc)\b/ },
];

/** { moeda, turismo, quantia } ou null. */
function pedidoDeCotacao(texto) {
  const t = semAcento(texto).replace(/[?!.]+$/, '').trim();
  // previsão, história e "por que" são pesquisa
  if (/\b(vai (subir|cair|baixar|ficar)|deve (subir|cair)|previs|projec|tendencia|por que|porque|historia|historico|desde|em 20\d\d|ano passado|mes passado|grafico)\b/.test(t)) return null;
  const moedas = MOEDAS.filter((m) => m.re.test(t));
  // "dólar canadense" também casa com "dólar": fica o mais específico
  const moeda = moedas.find((m) => m.codigo !== 'USD') || moedas[0];
  if (!moeda) return null;
  const quantia = /(\d+(?:[.,]\d+)?)\s*(mil\s*)?(dolar|euro|libra|peso|iene|yen|yuan|bitcoin|btc|usd|eur|us\$)/.exec(t);
  const pedeValor = /\b(cotacao|cota|quanto (esta|ta|custa|vale|e|da|fica)|valor|preco|hoje|agora|cambio|em reais|para reais|pra reais|converte|converter|conversao)\b/.test(t) || Boolean(quantia);
  if (!pedeValor) return null;
  // "quanto está o euro" é cotação; "quanto custa um iPhone em dólares" não (tem outra coisa sendo pedida)
  if (!quantia && /\b(iphone|celular|placa|rtx|carro|notebook|playstation|ps5|xbox|passagem|curso|produto)\b/.test(t)) return null;
  return {
    moeda: moeda.codigo,
    turismo: moeda.codigo === 'USD' && /\bturismo\b/.test(t),
    quantia: quantia ? Number(quantia[1].replace(',', '.')) * (quantia[2] ? 1000 : 1) : null,
  };
}

async function pedirJson(url, deps) {
  const r = await (deps.baixar || baixar)(url, { timeout: 8000, headers: { Accept: 'application/json' } });
  if (!r?.ok) throw new Error(`HTTP ${r?.status || '?'}`);
  return JSON.parse(r.texto);
}

/** A PTAX (Banco Central) do último dia útil até hoje: { venda, quando } ou null. */
async function ptax(deps, agora = new Date()) {
  const d = (x) => `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}-${x.getFullYear()}`;
  const ini = new Date(agora.getTime() - 7 * 86400000);
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${d(ini)}'&@dataFinalCotacao='${d(agora)}'&$format=json`;
  const v = (await pedirJson(url, deps)).value || [];
  const ultimo = v[v.length - 1];
  return ultimo ? { venda: ultimo.cotacaoVenda, quando: String(ultimo.dataHoraCotacao).slice(0, 10) } : null;
}

const reais = (v, casas = 2) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;

async function responderCotacao({ pedido, deps = {}, config = {}, agora = new Date() }) {
  const en = config.idiomaEfetivo === 'en';
  const m = MOEDAS.find((x) => x.codigo === pedido.moeda);
  const par = pedido.turismo ? 'USD-BRLT' : `${pedido.moeda}-BRL`;
  deps.emit?.('ferramenta', { nome: 'cotacao', argumentos: { moeda: par }, risco: 'leitura' });
  let j;
  try {
    j = (await pedirJson(`https://economia.awesomeapi.com.br/json/last/${par}`, deps))[par.replace('-', '')];
  } catch {
    return null; // sem a API: a pesquisa responde
  }
  if (!j?.bid) return null;
  const compra = Number(j.bid);
  const venda = Number(j.ask) || compra;
  const variacao = Number(j.pctChange);
  const quando = new Date(String(j.create_date).replace(' ', 'T'));
  const hora = quando.toLocaleTimeString(en ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = quando.toDateString() === agora.toDateString() ? (en ? 'today' : 'hoje') : quando.toLocaleDateString(en ? 'en-US' : 'pt-BR');
  const casas = compra < 0.1 ? 4 : 2;
  const nome = en ? m.nomeEn : `${m.nome}${pedido.turismo ? ' turismo' : m.codigo === 'USD' ? ' comercial' : ''}`;
  const sinal = Number.isFinite(variacao) ? `${variacao > 0 ? '+' : ''}${variacao.toFixed(2).replace('.', en ? '.' : ',')}%` : '';
  let texto = en
    ? `💵 **${nome}: ${reais(compra, casas)}** (buy ${reais(compra, compra < 10 ? 4 : 2)} · sell ${reais(venda, compra < 10 ? 4 : 2)})${sinal ? `, ${sinal} on the day` : ''} — ${dia} at ${hora} ([AwesomeAPI](https://economia.awesomeapi.com.br)).`
    : `💵 **${nome}: ${reais(compra, casas)}** (compra ${reais(compra, compra < 10 ? 4 : 2)} · venda ${reais(venda, compra < 10 ? 4 : 2)})${sinal ? `, ${sinal} no dia` : ''} — ${dia} às ${hora} ([AwesomeAPI](https://economia.awesomeapi.com.br)).`;
  if (pedido.quantia) {
    const total = pedido.quantia * venda;
    const qtd = pedido.quantia.toLocaleString(en ? 'en-US' : 'pt-BR');
    texto += en ? `\n\n**${qtd} ${m.codigo} ≈ ${reais(total)}** (at the selling rate; banks and cards add fees and IOF).` : `\n\n**${qtd} ${m.codigo === 'USD' ? (pedido.quantia === 1 ? 'dólar' : 'dólares') : m.codigo} ≈ ${reais(total)}** (pela cotação de venda; bancos e cartões cobram taxas e IOF por cima).`;
  }
  // a referência oficial do Banco Central, para o dólar comercial
  if (pedido.moeda === 'USD' && !pedido.turismo) {
    const p = await ptax(deps, agora).catch(() => null);
    if (p) {
      const dataP = new Date(`${p.quando}T12:00:00`).toLocaleDateString(en ? 'en-US' : 'pt-BR');
      texto += en ? `\n\nOfficial PTAX rate (Central Bank of Brazil), ${dataP}: **${reais(p.venda, 4)}** ([BCB](https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes)).` : `\n\nA PTAX do Banco Central (a cotação oficial do fechamento) de ${dataP}: **${reais(p.venda, 4)}** ([BCB](https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes)).`;
    }
  }
  deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
  return { ...SEM_PESQUISA, texto, modo: 'cotacao', noIdioma: en };
}

module.exports = { pedidoDeCotacao, responderCotacao, MOEDAS };
