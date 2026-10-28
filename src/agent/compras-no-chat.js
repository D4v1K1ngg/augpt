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
const serieDePrecos = require('./serie-de-precos');

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
  // a categoria na frente do nome (26/10: "Placa DE Vídeo Asus ROG Astral RTX 5080") — só quando vem um nome depois
  .replace(/^(?:placa de v[íi]deo|placa-m[ãa]e|placa m[ãa]e|processador|fone de ouvido|fone|mouse|teclado|monitor|notebook|celular|smartphone|console|headset|ssd|mem[óo]ria ram|mem[óo]ria)\s+(?=\S+\s+\S)/i, '')
  .replace(/\s+/g, ' ')
  .trim();

/** { produto } ou null. */
/** O produto como escrito no pedido de preço (inclusive a referência: "dessa placa"), ou null. */
function produtoDoPedido(pergunta) {
  const p = produtoDoTexto(pergunta);
  if (!p) return null;
  // "quanto está essa placa usada?" (26/10): "usado" é o que se quer ver, não parte do nome
  const usado = /\b(usad[oa]s?|seminov[oa]s?|second[- ]hand|used)\b/i.test(p.produto);
  const produto = usado ? p.produto.replace(/\s*\b(usad[oa]s?|seminov[oa]s?|second[- ]hand|used)\b\s*/gi, ' ').replace(/\s+/g, ' ').trim() : p.produto;
  return produto.length >= 2 ? { produto, ...(usado ? { usado: true } : {}) } : null;
}

function produtoDoTexto(pergunta) {
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
  // 28/10, no app: "…só estou esperando uma promoção boa." buscou o produto "boa" — o gatilho no meio de uma
  // frase que conta algo (sem "?") não é pedido de preço; e o que vem depois dele tem de ser um nome
  if (m.index > 30 && !/\?\s*$/.test(original)) return null;
  let produto = limpar(original.slice(m.index + m[0].length));
  if (/^(boas?|bons?|bom|otim[oa]s?|legal|legais|interessantes?|melhor(es)?|aqui|ai|isso|isto|dessas?|desses?|que|de verdade|real|top)$/.test(semAcento(produto))) return null;
  // "a RTX 5080 está quanto?" / "RTX 5080 preço": o produto antes do gatilho
  if (!produto || produto.length < 2) produto = limpar(original.slice(0, m.index).replace(/\s+(?:est[áa]|ta|tá|custa)\s*$/i, ''));
  if (!produto || produto.length < 2 || produto.split(/\s+/).length > 9) return null;
  return { produto };
}

/**
 * "o preço DESSA placa de vídeo", "quanto está ELA?" (26/10, no app: buscou "dessa placa de vídeo" e caiu na
 * pesquisa): o produto vem da conversa — o padrão não monta o pedido, mas a INTENÇÃO de preço vale; o
 * entendimento resolve o nome e a ação de preços roda com ele.
 */
function pedidoDeCompras(pergunta) {
  const p = produtoDoPedido(pergunta);
  return p && !REFERENCIA.test(semAcento(p.produto)) ? p : null;
}
const REFERENCIA = /^(d?ess[ea]s?|d?est[ea]s?|d?aquel[ea]s?|d?el[ea]s?|isso|isto|o mesmo|a mesma|it|this|that|these|those|the same)\b/;

/** "rtx 5080" → "RTX 5080"; "logitech g pro x superlight 2" → "Logitech G PRO X Superlight 2": sigla e modelo em maiúscula. */
const comoSeEscreve = (t) => String(t || '').split(/\s+/).map((w) => (/^(de|da|do|das|dos|e|com|para)$/i.test(w) ? w.toLowerCase() : /\d/.test(w) || w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
/** O nome do anúncio cabe numa frase: até ~70 letras, cortado no fim de uma palavra. */
const curto = (t) => (String(t).length <= 72 ? String(t) : `${String(t).slice(0, 70).replace(/\s+\S*$/, '')}…`);
const reais = (v, en) => (en ? `R$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };

async function responderCompras({ pergunta, deps = {}, config = {}, dirImagens, pedido, nota = '' } = {}) {
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
  if (!exatos.length) {
    // 26/10 (no app): "Asus ROG Astral RTX 5080" não estava nas lojas que dá para ler — a pesquisa respondia
    // e o modelo inventou que a placa "ainda não foi lançada". Sem o modelo exato, vale o modelo-base (RTX
    // 5080), dizendo com todas as letras que é ele
    const base = serieDePrecos.produtosDoPedido(p.produto)[0]?.nome;
    if (!nota && base && semAcento(base) !== semAcento(p.produto)) {
      const aviso = en
        ? `I didn't find the **${comoSeEscreve(p.produto)}** in the stores I can read right now. Here is the **${base}** in general (other brands and versions):`
        : `Não achei a **${comoSeEscreve(p.produto)}** nas lojas que consigo ler agora. Aqui está a **${base}** em geral (outras marcas e versões):`;
      return responderCompras({ pergunta, deps, config, dirImagens, pedido: { produto: base, ...(p.usado ? { usado: true } : {}) }, nota: aviso });
    }
    return null; // nada do produto: a pesquisa responde
  }
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
  // pediu o USADO (26/10): ele vem primeiro; sem oferta de usado, diz — e o novo segue embaixo
  if (p.usado) {
    const linha = usado
      ? en ? `**Used**: from **${reais(usado.preco, true)}** at **${usado.loja}** — ${curto(usado.nome)}.` : `**Usado**: a partir de **${reais(usado.preco)}** na **${usado.loja}** — ${curto(usado.nome)}.`
      : en ? `I didn't find used offers in the stores I can read right now (Mercado Livre and OLX don't allow automatic reading). New:` : `Não achei ofertas de usado nas lojas que consigo ler agora (Mercado Livre e OLX não deixam ler automaticamente). Novo:`;
    texto = `${linha}\n\n${texto}`;
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
  const completo = `${nota ? `${nota}\n\n` : ''}${texto}\n\n\`\`\`compras\n${JSON.stringify(bloco)}\n\`\`\``;
  deps.emit?.('resposta-token', { pedaco: completo, noIdioma: en });
  return { ...SEM_PESQUISA, texto: completo, modo: 'compras', noIdioma: en };
}

module.exports = { pedidoDeCompras, responderCompras, intencaoDeCompras: (p) => Boolean(produtoDoPedido(p)) };
