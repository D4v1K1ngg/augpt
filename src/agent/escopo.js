'use strict';

/**
 * Escopo da busca + classificador de página (Etapa D da revisão v2,
 * 2026-09-28). Ideia trazida pela análise do ChatGPT e montada aqui só com
 * regra de código — o 7B não decide o que é "fora do assunto".
 *
 * O que o 14º teste real mostrou:
 *   - "fone mais usado pelos profissionais no PUBG de PC" leu r/PUBGMobile,
 *     "PUBG Mobile Audio EQ Guide", torneios mobile;
 *   - leu página inicial do Clube do Hardware, índice de subfórum, canal do
 *     YouTube, Telegram, Instagram, tela de login do Threads, agenda de
 *     torneio — nada disso responde pergunta nenhuma, e cada uma custa
 *     leitura + destilação;
 *   - "RTX 5070 Ti ... ou superior" trouxe "o que é ensino superior" e a
 *     Wikipédia "Superior", que foram parar nas Fontes da resposta.
 *
 * Duas peças:
 *   1. `classificarPagina(url, titulo)` — tipo da página pela URL (e título):
 *      HOME, INDICE, TOPICO, SOCIAL, LOGIN, VIDEO, AGENDA, LOJA, BENCHMARK,
 *      FICHA, REVIEW, ARTIGO. HOME/INDICE/SOCIAL/LOGIN/AGENDA e canal de vídeo
 *      nem são lidos (`PULAR_SEMPRE`).
 *   2. `escopoDoPedido(objetivo)` + `foraDoEscopo(entrada, escopo)` — o
 *      escopo que o pedido fixa (plataforma, variante excluída, assunto) e a
 *      conferência de cada leitura antes de ela entrar no dossiê.
 */

const semAcento = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const normalizar = (t) => semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim();

const TIPOS = {
  HOME: 'home',
  INDICE: 'indice',
  TOPICO: 'topico',
  SOCIAL: 'social',
  LOGIN: 'login',
  VIDEO: 'video',
  CANAL: 'canal',
  AGENDA: 'agenda',
  LOJA: 'loja',
  BENCHMARK: 'benchmark',
  FICHA: 'ficha',
  REVIEW: 'review',
  ARTIGO: 'artigo',
};

// página que não responde pergunta nenhuma: nem é lida
const PULAR_SEMPRE = new Set([TIPOS.HOME, TIPOS.INDICE, TIPOS.SOCIAL, TIPOS.LOGIN, TIPOS.CANAL, TIPOS.AGENDA]);

const SOCIAIS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|tiktok\.com|threads\.(net|com)|t\.me|telegram\.(me|org)|linkedin\.com|pinterest\.[a-z.]+|kwai\.com|discord\.(gg|com))$/;
const LOJAS = /(^|\.)(mercadolivre|mercadolibre|amazon|magazineluiza|magalu|americanas|casasbahia|pontofrio|kabum|terabyteshop|pichau|shoptime|submarino|carrefour|fastshop|aliexpress|shopee|girafa|zoom|buscape|ebay|walmart|bestbuy|newegg|olx)\.[a-z.]+$/;
// segmento de idioma/país que não conta como "caminho" ("/pt-br/", "/en/")
const LOCALE = /^(pt|en|es|fr|de|it|br|us|uk|ru|ja|ko|zh|pt[-_]br|en[-_]us|en[-_]gb|es[-_]es|pt[-_]pt|intl|global|main|home|index(\.html?|\.php)?|inicio|default\.aspx)$/i;

/**
 * Tipo da página, pela URL (e pelo título quando ajuda). Sem rede, sem
 * modelo — roda antes de ler.
 */
function classificarPagina(url, titulo = '') {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return TIPOS.ARTIGO;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const caminho = u.pathname.toLowerCase().replace(/\/+$/, '');
  const partes = caminho.split('/').filter(Boolean);
  const t = normalizar(titulo);

  if (SOCIAIS.test(host)) return TIPOS.SOCIAL;
  if (/(^|\/)(login|signin|sign-in|entrar|auth|account\/login|conta\/entrar|register|cadastro)(\/|$)/.test(caminho) || /^(log in|sign in|entrar|fazer login)\b/.test(t)) return TIPOS.LOGIN;
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) {
    if (/^\/(watch|shorts|live|embed)/.test(u.pathname) || host === 'youtu.be') return TIPOS.VIDEO;
    return TIPOS.CANAL;
  }
  if (/(^|\.)(music\.youtube\.com|twitch\.tv|kick\.com)$/.test(host)) return TIPOS.CANAL;

  // tópico de fórum/Reddit (antes de índice: /r/x/comments/... é tópico)
  if (/\/comments\/[a-z0-9]+/.test(caminho) || /\/(topic|topico|threads?|t)\/[^/]*\d/.test(caminho) || /\/showthread|viewtopic/.test(caminho)) return TIPOS.TOPICO;
  // fórum sem URL amigável: /index.php?threads/…, ?topic=123.0, ?showtopic=, ?t=
  if (/(^|[?&])(threads\/|topic=|showtopic=|t=\d)/i.test(u.search.replace(/^\?/, '?'))) return TIPOS.TOPICO;
  // índice: subreddit, lista de fóruns, subfórum, categoria de fórum
  if (/(^|\.)reddit\.com$/.test(host) && (partes.length === 0 || (partes[0] === 'r' && partes.length <= 2) || partes[0] === 't' || partes[0] === 'subreddits')) return TIPOS.INDICE;
  // categoria só é índice quando é o FIM do caminho (/category/x/review-do-y é artigo)
  if (/\/forums?(\/forum\/[^/]+)?$/.test(caminho) || /\/forums?\/forum\//.test(caminho) || /\/(categor(y|ia)|categories|categorias)(\/[^/]+)?$/.test(caminho) || /forumdisplay/.test(caminho)) return TIPOS.INDICE;

  // página inicial: sem caminho, ou só idioma/"main"
  if (!partes.length || partes.every((p) => LOCALE.test(p))) return TIPOS.HOME;

  if (/\/(schedules?|calend[aá]rio|calendar|agenda|tournaments?|torneios?|eventos?|events?)(\/|$)/.test(caminho) && !/\/(news|noticias?)\//.test(caminho)) return TIPOS.AGENDA;

  // comparação vem antes de loja: o "versus" de uma loja (terabyteshop) é comparativo
  if (/(^|[-_/])(vs|versus|compare|comparison|comparar|comparacao|benchmarks?)([-_/]|$)/.test(caminho) || (/\bvs\b/.test(t) && /\b(benchmark|fps|performance|desempenho)\b/.test(t))) return TIPOS.BENCHMARK;
  if (LOJAS.test(host) || /\/(dp|gp\/product|produto|product|p)\/[^/]+/.test(caminho) || /\/(lista|busca|search|s)\?/.test(`${caminho}?`) && LOJAS.test(host)) return TIPOS.LOJA;
  if (/(^|[-_/])(specs?|specifications?|especificacoes|ficha-tecnica|techspec|gpu-specs|datasheet)([-_/.]|$)/.test(caminho)) return TIPOS.FICHA;
  if (/(^|[-_/])(review|reviews|analise|teste|hands-on)([-_/]|$)/.test(caminho) || /\b(review|analise)\b/.test(t)) return TIPOS.REVIEW;
  return TIPOS.ARTIGO;
}

/** Não vale nem ler: home, índice, rede social, login, canal, agenda. */
function pularSemLer(url, titulo = '') {
  const tipo = classificarPagina(url, titulo);
  return PULAR_SEMPRE.has(tipo) ? tipo : null;
}

/* ------------------------------ escopo do pedido ------------------------------ */

// variantes do mesmo assunto que o pedido pode excluir ao fixar a plataforma
const PLATAFORMAS = [
  { nome: 'pc', pedido: /\b(de pc|no pc|para pc|pra pc|pc gamer|computador|desktop|steam|on pc|for pc)\b/, variantes: [] },
  { nome: 'mobile', pedido: /\b(mobile|celular|android|iphone|ios|smartphone)\b/, variantes: [] },
  { nome: 'console', pedido: /\b(ps4|ps5|playstation|xbox|console|switch)\b/, variantes: [] },
];

const JOGOS_COM_VARIANTE = [
  // jogo que tem versão mobile com o MESMO nome: "PUBG" × "PUBG Mobile"
  { jogo: /\bpubg\b/, variante: /\bpubg\s*(mobile|m\b|new state|lite)|\bbgmi\b/ },
  { jogo: /\bcall of duty|\bcod\b|\bwarzone\b/, variante: /\b(cod|call of duty|warzone)\s*mobile\b/ },
  { jogo: /\bfree ?fire\b/, variante: /$^/ },
];

/**
 * O escopo que o PEDIDO fixa (sem modelo): plataforma, variante excluída do
 * jogo ("PUBG de PC" exclui "PUBG Mobile") e as entidades do pedido (RTX
 * 5070 Ti) que uma leitura precisa citar pra ser do assunto.
 */
function escopoDoPedido(objetivo, { entidades = [] } = {}) {
  const t = semAcento(objetivo);
  const plataforma = PLATAFORMAS.find((p) => p.pedido.test(t))?.nome || null;
  const excluir = [];
  const jogosRe = [];
  if (plataforma === 'pc') {
    for (const j of JOGOS_COM_VARIANTE) {
      if (j.jogo.test(t) && !j.variante.test(t)) {
        excluir.push(j.variante);
        jogosRe.push(j.jogo);
      }
    }
  }
  // entidade só é NOME DE PRODUTO (linha com letras + modelo com número):
  // "até R$ 300", "1.500 reais", "60g", "27 polegadas" não são (achado do revisor)
  const validas = entidades.filter((e) => {
    const nome = semAcento(typeof e === 'string' ? e : e?.nome || '');
    const comNumero = nome.split(/\s+/).filter((p) => /\d/.test(p));
    const soMedida = comNumero.length > 0 && comNumero.every((p) => /^\d+([.,]\d+)?(g|gb|tb|hz|mhz|ghz|w|mm|cm|kg|mah|ms|p|k)$/.test(p));
    return /[a-z]{2,}/.test(nome.replace(/\b(polegadas|reais|gb|tb|hz|mhz|ghz|mah|mm|cm|kg|w|g)\b/g, '')) && comNumero.length > 0 && !soMedida && !/\b(polegadas|reais|r\$)\b/.test(nome);
  });
  return {
    plataforma,
    excluir, // regex de variante que não é o que o pedido quer
    jogosRe,
    entidades: validas.map((e) => (typeof e === 'string' ? e : e.nome)).filter(Boolean),
    entidadesRe: validas.map((e) => (e && e.re ? e.re : null)).filter(Boolean),
  };
}

/**
 * A leitura está fora do escopo? Devolve o motivo ou null.
 *   - variante excluída DOMINA a página (título ou 3+ menções, e o pedido
 *     não cita a variante): "PUBG Mobile" num pedido de PUBG de PC;
 *   - o pedido nomeia produtos (RTX 5070 Ti) e a página não cita nenhum nem
 *     a linha deles ("curso superior", Wikipédia "Superior").
 */
function foraDoEscopo(entrada, escopo) {
  if (!escopo) return null;
  const titulo = semAcento(entrada.titulo || '');
  const corpo = semAcento(`${entrada.bruto || entrada.texto || ''}`).slice(0, 20000);
  const url = semAcento(entrada.url || '');
  for (const [i, re] of (escopo.excluir || []).entries()) {
    const g = new RegExp(re.source, 'g');
    const noCorpo = (corpo.match(g) || []).length;
    // a variante DOMINA: no título/URL, ou metade (ou mais) das menções ao
    // jogo são da variante — menu com "PUBG Mobile" numa página de PC não basta
    const doJogo = escopo.jogosRe?.[i] ? (corpo.match(new RegExp(escopo.jogosRe[i].source, 'g')) || []).length : noCorpo * 2;
    if (re.test(titulo) || re.test(url) || (noCorpo >= 3 && noCorpo * 2 >= doJogo)) return 'variante que o pedido excluiu (ex.: PUBG Mobile num pedido de PC)';
  }
  if (escopo.entidadesRe?.length) {
    const cita = escopo.entidadesRe.some((re) => re.test(corpo) || re.test(titulo));
    // a linha do produto ("5070", "5080") também vale — a página pode escrever diferente
    const linha = escopo.entidades.some((n) => normalizar(n).split(' ').filter((p) => /\d/.test(p)).some((p) => corpo.includes(p)));
    if (!cita && !linha) return `não cita ${escopo.entidades.join(' nem ')}`;
  }
  return null;
}

module.exports = { TIPOS, PULAR_SEMPRE, classificarPagina, pularSemLer, escopoDoPedido, foraDoEscopo };
