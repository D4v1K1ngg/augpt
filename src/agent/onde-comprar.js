'use strict';

/**
 * "Onde comprar" (17/10): nos pedidos de produto, o código procura cada
 * produto dos cartões nas buscas das lojas e põe no cartão o menor preço de
 * cada uma, com link — o preço vem da página da loja (dados estruturados,
 * src/tools/ofertas.js), não da escrita do modelo.
 *
 * Lojas escolhidas pelo teste de 17/10 (busca de um mouse e de um fone):
 * KaBuM entrega a lista de produtos; Zoom e Buscapé são
 * comparadores e cobrem as lojas que bloqueiam leitura direta (Magalu, Amazon,
 * Terabyte). Terabyte, Magalu e eBay responderam com verificação anti-robô
 * (HTTP 403) e ficam de fora — sem tentar contornar. Mercado Livre e Amazon
 * devolvem página de robô para leitura direta. A Pichau só mostra os preços
 * desenhados na tela (sem dados estruturados) e fica de fora também.
 */

const slug = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const enc = encodeURIComponent;

const LOJAS = [
  { nome: 'KaBuM!', url: (q) => `https://www.kabum.com.br/busca/${slug(q)}` },
  { nome: 'Zoom', comparador: true, url: (q) => `https://www.zoom.com.br/search?q=${enc(q)}` },
  { nome: 'Buscapé', comparador: true, url: (q) => `https://www.buscape.com.br/search?q=${enc(q)}` },
];

// acessório que cita o produto no nome ("Fita adesiva para mouse Logitech G Pro X Superlight 2")
// testado no nome já normalizado (sem acento, minúsculo)
const ACESSORIO = / (capas?|cases?|peliculas?|grips?|fitas?|adesiv\w*|skates?|feet|pes de|cabos?|adaptador\w*|suportes?|almofadas?|ear ?tips?|eartips?|ponteiras?|espumas?|protetor\w*|bolsas?|estojos?|reposicao|substitui\w*|replacement|para (o |a )?(mouse|fone|teclado|headset|controle)) /;
const normalizar = (t) => ` ${String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * A oferta é desse produto? TODAS as palavras do nome do produto (as de 2+
 * letras e as com número) aparecem na oferta — o "G PRO 2" não passa pelo
 * "G Pro X Superlight 2" — e não é acessório (a não ser que o pedido seja um).
 */
function casa(nomeDaOferta, produto) {
  const oferta = normalizar(nomeDaOferta);
  const termos = normalizar(produto).trim().split(' ').filter((t) => t.length >= 2 || /\d/.test(t));
  if (!termos.length) return false;
  const colada = oferta.replace(/ /g, '');
  // colado só para termo de 3+ caracteres ("k552" em "Kumara K-552"); "2" sozinho
  // precisa ser palavra inteira, senão o "Superlight 2" casa com o "Superlight 2c"
  const tem = (t) => oferta.includes(` ${t} `) || (/\d/.test(t) && t.length >= 3 && colada.includes(t));
  if (!termos.every(tem)) return false;
  return !ACESSORIO.test(oferta) || ACESSORIO.test(normalizar(produto));
}

const comLimite = (promessa, ms) => Promise.race([promessa, new Promise((ok) => setTimeout(() => ok(null), ms))]);

/**
 * @param ler (url) → página do leitor do AuGPT, com `ofertas` (src/tools/web.js, lerComCache)
 * @returns [{ loja, comparador, nome, preco, avista, url, lojas }] — a mais barata de cada loja
 */
async function ondeComprar(produto, { ler, lojas = LOJAS, timeoutMs = 25000 } = {}) {
  const achados = await Promise.all(
    lojas.map(async (loja) => {
      try {
        const pagina = await comLimite(ler(loja.url(produto)), timeoutMs);
        const ofertas = (pagina?.ofertas || []).filter((o) => casa(o.nome, produto));
        if (!ofertas.length) return null;
        const melhor = ofertas.sort((a, b) => (a.avista || a.preco) - (b.avista || b.preco))[0];
        return { loja: loja.nome, comparador: !!loja.comparador, ...melhor };
      } catch {
        return null;
      }
    })
  );
  // Zoom e Buscapé são do mesmo grupo e devolvem a mesma oferta: fica uma
  const vistos = new Set();
  return achados.filter(Boolean).filter((a) => {
    const chave = a.comparador && `${normalizar(a.nome)}|${a.preco}`;
    if (!chave) return true;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "**Onde comprar (hoje):** [KaBuM! R$ 1.049,08](…) · [Zoom: a partir de R$ 669,90 em 6 lojas](…)" */
function linhaOndeComprar(achados, hoje = new Date().toLocaleDateString('pt-BR')) {
  if (!achados.length) return '';
  const itens = achados
    .sort((a, b) => (a.avista || a.preco) - (b.avista || b.preco))
    .map((a) => {
      const preco = a.comparador ? `a partir de ${reais(a.preco)}${a.lojas ? ` em ${a.lojas} lojas` : ''}` : `${reais(a.preco)}${a.avista ? ` (à vista ${reais(a.avista)})` : ''}`;
      const texto = `${a.loja}${a.comparador ? ':' : ''} ${preco}`;
      return a.url ? `[${texto}](${a.url})` : texto;
    });
  return `**Onde comprar (preços de ${hoje}):** ${itens.join(' · ')}`;
}

module.exports = { ondeComprar, linhaOndeComprar, casa, LOJAS };
