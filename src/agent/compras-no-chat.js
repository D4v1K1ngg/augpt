'use strict';

/**
 * Preços no chat (24/10, pedido do Davi, no estilo do Google Shopping): "quanto está a RTX 5080?",
 * "preço do PS5 Slim", "onde comprar o G Pro X Superlight 2". O código junta as ofertas de Zoom,
 * Buscapé, KaBuM! e Americanas (src/tools/compras.js) e põe um bloco ```compras na resposta, que a
 * tela desenha como um cartão com fotos, preços, lojas, filtros e o link de cada oferta.
 * Recomendação ("qual o melhor mouse até R$ 300?") continua na pesquisa, com os cartões de produto.
 */

const compras = require('../tools/precos');
const imagens = require('../tools/imagens');

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const L = '(?<!\\p{L})';
const R = '(?!\\p{L})';

const GATILHO = new RegExp(`${L}(?:quanto (?:est[áa]|ta|tá|custa|sai|fica|vale|anda|t[áa] custando|est[áa] custando)(?: (?:hoje|agora|atualmente))?|qual (?:[ée] )?(?:o )?(?:pre[çc]o|valor)(?: (?:atual|de hoje|hoje))?|pre[çc]os?(?: (?:atual|atuais|de hoje|hoje))?|onde (?:comprar|compro|encontro|acho)|menor pre[çc]o|mais barat[oa]s?|ofertas?|promo[çc](?:[ãa]o|[õo]es)|how much (?:is|are|does|do)|price(?:s)? (?:of|for)|where (?:to|can i) buy|cheapest)${R}`, 'iu');
// o que tem preço mas não é produto de loja
const FORA = /\b(dolar|euro|libra|bitcoin|btc|cripto\w*|acoes?|acao da|ibovespa|bolsa|gasolina|etanol|diesel|combustivel|aluguel|passagens?|voo|frete|cesta basica|salario|minimo|ingressos?|plano|mensalidade|imposto|ipva|iptu|cotacao|juros|selic|ouro|prata|cafe da manha|consulta|corrida|uber|energia|luz|agua|gas de cozinha|botijao)\b/;
// recomendação e comparação são da pesquisa (cartões com o que a comunidade diz)
// gráfico, evolução e histórico de preço são do gráfico (pesquisa), não da lista de ofertas de hoje
const RECOMENDACAO = /\b(grafico|evolucao|historico|desde o lancamento|ao longo|tabela|planilha|melhor(es)?|recomend\w*|vale a pena|compensa|qual (escolher|comprar|devo)|diferen[cç]a|compar\w*|vs|versus|ou o|ou a|review|at[ée] r\$|at[ée] \d|custo[- ]beneficio|bom e barato)\b/;

const limpar = (s) => String(s || '')
  .replace(/[?!.]+\s*$/g, '')
  .replace(new RegExp(`${L}(?:hoje|agora|atualmente|no brasil|aqui|em promo[çc][ãa]o|novo|nova|na internet|online|nas lojas|today|now)${R}`, 'giu'), ' ')
  .replace(/^\s*(?:(?:d[aoe]s?|um|uma|a|o|as|os|the|of|for|para|pra|pro|ta|tá|está|esta|t[áa] custando|custando)\s+)+/i, '')
  .replace(/\s+/g, ' ')
  .trim();

/** { produto } ou null. */
function pedidoDeCompras(pergunta) {
  const original = String(pergunta || '').replace(/\s+/g, ' ').trim();
  const t = semAcento(original);
  if (!original || original.length > 140 || FORA.test(t) || RECOMENDACAO.test(t)) return null;
  // "a RTX 5070 Ti está quanto?", "quanto que tá o PS5?"
  const invertido = /^(.+?)\s+(?:est[áa]|ta|tá|custa|sai)\s+(?:por\s+)?quanto\s*\??$/i.exec(original);
  if (invertido) {
    const produto = limpar(invertido[1]);
    return produto.length >= 2 && produto.split(/\s+/).length <= 9 ? { produto } : null;
  }
  const m = GATILHO.exec(original.replace(/\bquanto que\b/i, 'quanto'));
  if (!m) return null;
  let produto = limpar(original.slice(m.index + m[0].length));
  // "a RTX 5080 está quanto?" / "RTX 5080 preço": o produto antes do gatilho
  if (!produto || produto.length < 2) produto = limpar(original.slice(0, m.index).replace(/\s+(?:est[áa]|ta|tá|custa)\s*$/i, ''));
  if (!produto || produto.length < 2 || produto.split(/\s+/).length > 9) return null;
  return { produto };
}

/** "rtx 5080" → "RTX 5080"; "logitech g pro x superlight 2" → "Logitech G PRO X Superlight 2": sigla e modelo em maiúscula. */
const comoSeEscreve = (t) => String(t || '').split(/\s+/).map((w) => (/\d/.test(w) || w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
/** O nome do anúncio cabe numa frase: até ~70 letras, cortado no fim de uma palavra. */
const curto = (t) => (String(t).length <= 72 ? String(t) : `${String(t).slice(0, 70).replace(/\s+\S*$/, '')}…`);
const reais = (v, en) => (en ? `R$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };

async function responderCompras({ pergunta, deps = {}, config = {}, dirImagens, pedido } = {}) {
  const p = pedido || pedidoDeCompras(pergunta);
  if (!p) return null;
  const en = config.idiomaEfetivo === 'en';
  let r;
  try {
    r = await compras.buscarOfertas(p.produto, { deps });
  } catch (err) {
    deps.emit?.('aviso', { texto: `compras: ${err.message}` });
    return null;
  }
  const exatos = r.ofertas.filter((o) => o.exato);
  if (!exatos.length) return null; // nada do produto exato: a pesquisa responde
  const novo = compras.menorConfiavel(r.ofertas);
  const usado = compras.menorConfiavel(r.ofertas, { usado: true });
  const lojas = [...new Set(exatos.map((o) => o.loja))];
  const suspeitos = exatos.filter((o) => o.suspeito);
  const produto = comoSeEscreve(p.produto);
  const nome = `**${produto}**`;
  const faixa = exatos.filter((o) => !o.suspeito).map((o) => o.preco);
  let texto;
  const melhor = novo || usado;
  if (en) {
    texto = `${nome}: the lowest price right now is **${reais(melhor.preco, true)}** at **${melhor.loja}**${novo ? '' : ' (used)'} — ${curto(melhor.nome)}. I found ${exatos.length} offers in ${lojas.length} stores, from ${reais(Math.min(...faixa), true)} to ${reais(Math.max(...faixa), true)}.`;
    if (novo && usado && usado.preco < novo.preco) texto += ` Used: from ${reais(usado.preco, true)} (${usado.loja}).`;
    if (suspeitos.length) texto += `\n\n⚠ ${suspeitos.length} offer(s) far below the others — could be a scam; check the store before buying.`;
    texto += `\n\nTo be notified when it drops, say: **"let me know when ${p.produto} goes below R$ ${Math.floor((melhor.preco * 0.9) / 100) * 100}"**.`;
  } else {
    texto = `${nome}: o menor preço agora é **${reais(melhor.preco)}** na **${melhor.loja}**${novo ? '' : ' (usado)'} — ${curto(melhor.nome)}. Encontrei ${exatos.length} ofertas em ${lojas.length} lojas, de ${reais(Math.min(...faixa))} a ${reais(Math.max(...faixa))}.`;
    if (novo && usado && usado.preco < novo.preco) texto += ` Usado: a partir de ${reais(usado.preco)} (${usado.loja}).`;
    if (suspeitos.length) texto += `\n\n⚠ ${suspeitos.length === 1 ? '1 oferta muito abaixo das outras' : `${suspeitos.length} ofertas muito abaixo das outras`} — pode ser golpe; confira a loja antes de comprar.`;
    texto += `\n\nPara ser avisado quando baixar, diga: **"me avise quando ${p.produto} ficar abaixo de R$ ${(Math.floor((melhor.preco * 0.9) / 100) * 100).toLocaleString('pt-BR')}"**.`;
  }
  // as fotos (a tela não carrega imagem da internet): as primeiras ofertas, ao mesmo tempo, com limite de tempo
  const lista = [...exatos, ...r.ofertas.filter((o) => !o.exato)].slice(0, 40);
  const comFoto = lista.slice(0, 24);
  const fotos = dirImagens
    ? await imagens.comLimite(Promise.all(comFoto.map((o) => (o.imagem ? imagens.guardarImagem(o.imagem, { dir: dirImagens, pagina: o.link, config }).catch(() => null) : null))), 10000, [])
    : [];
  const bloco = {
    idioma: en ? 'en' : 'pt',
    produto,
    quando: new Date().toISOString(),
    fontes: r.fontes.filter((f) => f.ok).map((f) => f.nome),
    ofertas: lista.map((o, i) => ({ nome: o.nome, preco: o.preco, loja: o.loja, link: o.link, img: fotos[i] || null, parcelas: o.parcelas, exato: o.exato, usado: o.usado, suspeito: o.suspeito })),
  };
  const completo = `${texto}\n\n\`\`\`compras\n${JSON.stringify(bloco)}\n\`\`\``;
  deps.emit?.('resposta-token', { pedaco: completo, noIdioma: en });
  return { ...SEM_PESQUISA, texto: completo, modo: 'compras', noIdioma: en };
}

module.exports = { pedidoDeCompras, responderCompras, intencaoDeCompras: (p) => Boolean(pedidoDeCompras(p)) };
