'use strict';

/**
 * Extração e normalização de preço.
 *
 * A regra que organiza tudo aqui: **de onde o preço veio determina o quanto
 * ele vale**. Preço tirado do JSON-LD que a própria loja publica é uma coisa;
 * número achado no meio do texto é outra; número que apareceu num resumo de
 * busca é outra ainda. Misturar os três e chamar de "preço" é como se produz
 * comparação errada com cara de precisa.
 */

const CONFIANCA = {
  alta: 'dado estruturado publicado pela própria loja',
  media: 'preço lido do texto da página do produto',
  baixa: 'preço visto em resumo de busca, sem confirmação na página',
};

/** "R$ 3.899,90" → 3899.9. Devolve null quando não é preço. */
function paraNumero(bruto) {
  const texto = String(bruto ?? '').replace(/[\s\u00a0]/g, '');
  if (!/\d/.test(texto)) return null;

  const limpo = texto.replace(/[^\d.,-]/g, '');
  if (!limpo) return null;

  let normalizado;
  if (/,\d{1,2}$/.test(limpo)) normalizado = limpo.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpo)) normalizado = limpo.replace(/\./g, '');
  else if (/\.\d{1,2}$/.test(limpo) && !/,/.test(limpo)) normalizado = limpo.replace(/,/g, '');
  else normalizado = limpo.replace(/\./g, '').replace(',', '.');

  const n = Number(normalizado);
  if (!Number.isFinite(n) || n <= 0) return null;
  // preço de produto fora desta faixa quase sempre é ruído (código, CEP, ano)
  return n >= 1 && n < 10_000_000 ? Number(n.toFixed(2)) : null;
}

const formatar = (n) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ------------------------------ extração ------------------------------ */

const RE_PRECO = /R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/gi;

/**
 * Procura preços no texto de uma página já lida.
 *
 * O extrator de páginas já traz uma linha `[Produto: ... · preço BRL 3899.90]`
 * quando o site publica JSON-LD — esse é o caminho confiável, e é tentado
 * primeiro.
 */
function extrairPrecos(texto, { limite = 6 } = {}) {
  const achados = [];
  const conteudo = String(texto || '');

  for (const m of conteudo.matchAll(/\[Produto:\s*([^·\]]+)(?:·\s*preço\s*(?:BRL|R\$)?\s*([\d.,]+))?([^\]]*)\]/gi)) {
    const preco = paraNumero(m[2]);
    if (!preco) continue;
    achados.push({
      titulo: m[1].trim().slice(0, 120),
      preco,
      confianca: 'alta',
      motivo: CONFIANCA.alta,
      disponibilidade: /InStock/i.test(m[3]) ? 'disponível' : /OutOfStock/i.test(m[3]) ? 'indisponível' : null,
    });
  }
  if (achados.length) return achados.slice(0, limite);

  // sem dado estruturado: cai para o texto, com confiança menor
  const linhas = conteudo.split('\n');
  for (const [i, linha] of linhas.entries()) {
    for (const m of linha.matchAll(RE_PRECO)) {
      const preco = paraNumero(m[1]);
      if (!preco) continue;
      // o título costuma estar na mesma linha ou logo acima
      const contexto = `${linhas[i - 1] || ''} ${linha}`.replace(RE_PRECO, ' ').replace(/\s+/g, ' ').trim();
      achados.push({
        titulo: contexto.slice(0, 120) || 'produto',
        preco,
        confianca: 'media',
        motivo: CONFIANCA.media,
        disponibilidade: null,
      });
    }
    if (achados.length >= limite * 3) break;
  }

  // preços repetidos e valores absurdamente baixos costumam ser parcela ou frete
  const vistos = new Set();
  return achados
    .filter((a) => {
      if (vistos.has(a.preco)) return false;
      vistos.add(a.preco);
      return true;
    })
    .slice(0, limite);
}

/** Parcelamento não é preço: "12x de R$ 324,99" vira o total, se der. */
function detectarParcelamento(texto) {
  const m = /(\d{1,2})\s*x\s*(?:de\s*)?R\$\s*([\d.,]+)/i.exec(String(texto || ''));
  if (!m) return null;
  const parcela = paraNumero(m[2]);
  return parcela ? { vezes: Number(m[1]), parcela, total: Number((parcela * Number(m[1])).toFixed(2)) } : null;
}

/* ------------------------------ normalização ------------------------------ */

const RUIDO = /\b(frete gr[áa]tis|em at[ée]|[àa] vista|no pix|promo[çc][ãa]o|oferta|original|lacrado|envio r[áa]pido|garantia)\b/gi;

const semAcento = (t) =>
  String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Extrai o que dá para extrair do título. Não inventa: campo que não aparece
 * fica ausente, e ausência é informação — dois anúncios sem modelo declarado
 * não podem ser afirmados como o mesmo produto.
 */
function normalizarProduto(titulo) {
  const limpo = String(titulo || '').replace(RUIDO, ' ').replace(/\s+/g, ' ').trim();

  const capacidade = /(\d+)\s*(gb|tb|mb|ml|l|kg|g|un|w)\b/i.exec(limpo);
  const modelo = /\b([A-Z]{1,4}[- ]?\d{2,5}[A-Z]{0,3})\b/.exec(limpo);
  const polegadas = /(\d{2,3})["']|\b(\d{2,3})\s*polegadas?\b/i.exec(limpo);

  return {
    titulo: limpo.slice(0, 140),
    modelo: modelo ? modelo[1].toUpperCase().replace(/\s/g, '') : null,
    capacidade: capacidade ? `${capacidade[1]}${capacidade[2].toUpperCase()}` : null,
    polegadas: polegadas ? Number(polegadas[1] || polegadas[2]) : null,
    // chave de agrupamento: só as palavras que sobrevivem à limpeza
    chave: semAcento(limpo)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length > 2)
      .slice(0, 6)
      .sort()
      .join('-'),
  };
}

/** Dois anúncios são o mesmo produto? Só afirma quando há sinal forte. */
function mesmoProduto(a, b) {
  if (a.modelo && b.modelo && a.modelo === b.modelo) {
    if (a.capacidade && b.capacidade && a.capacidade !== b.capacidade) return false;
    return true;
  }
  const palavrasA = new Set(a.chave.split('-'));
  const palavrasB = new Set(b.chave.split('-'));
  const comuns = [...palavrasA].filter((p) => palavrasB.has(p)).length;
  const proporcao = comuns / Math.max(palavrasA.size, palavrasB.size, 1);
  return proporcao >= 0.75; // alto de propósito: agrupar errado é pior que não agrupar
}

/**
 * Preço efetivo = produto + frete − desconto.
 * Sem frete conhecido, o total continua sendo o preço, mas isso é DITO — frete
 * omitido é a forma mais comum de um comparativo mentir.
 */
function precoEfetivo({ preco, frete, desconto }) {
  const base = Number(preco) || 0;
  const entrega = Number(frete) || 0;
  const abatimento = Number(desconto) || 0;
  return {
    total: Number((base + entrega - abatimento).toFixed(2)),
    freteConhecido: frete !== null && frete !== undefined,
  };
}

module.exports = {
  paraNumero,
  formatar,
  extrairPrecos,
  detectarParcelamento,
  normalizarProduto,
  mesmoProduto,
  precoEfetivo,
  CONFIANCA,
};
