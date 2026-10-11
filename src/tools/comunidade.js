'use strict';

/**
 * Fontes da comunidade e leitura de tópicos (Fase A da estratégia "pesquisa
 * pela comunidade", pedido do Davi 2026-09-26).
 *
 * O jeito que o Davi pesquisa "qual o melhor X": ver reviews no YouTube e ler
 * o que a comunidade discute — Reddit, Clube do Hardware, Fórum Adrenaline.
 * Nos nove testes reais do motor de pesquisa, o que veio de bom saiu daí (o
 * tópico do Reddit dizendo que o HyperX soa mal em jogos; o head-fi do KZ),
 * e o ruído veio de loja e de lista de afiliado.
 *
 * Duas peças aqui:
 *   1. a LISTA de fontes (dados/comunidades.json, trocável nos Ajustes) e as
 *      consultas "site:" pra cada uma;
 *   2. o LEITOR de tópico: um tópico de fórum ou do Reddit vira uma lista de
 *      comentários limpa, em vez da página inteira com menu, assinatura e
 *      rodapé — o que também corta destilação.
 */

const fs = require('fs');
const path = require('path');
const { texto: textoDoHtml, decodificar } = require('./extract');

const ARQUIVO = path.join(__dirname, '..', '..', 'dados', 'comunidades.json');

let padrao = null;
function fontesPadrao() {
  if (padrao) return padrao;
  try {
    padrao = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')).fontes || [];
  } catch {
    // sem o arquivo o app segue: a lista mínima fica embutida
    padrao = [
      { nome: 'Reddit', dominio: 'reddit.com', tipo: 'reddit', idioma: 'en', assuntos: [] },
      { nome: 'Clube do Hardware', dominio: 'clubedohardware.com.br', tipo: 'forum', idioma: 'pt-BR', assuntos: [] },
      { nome: 'Fórum Adrenaline', dominio: 'forum.adrenaline.com.br', tipo: 'forum', idioma: 'pt-BR', assuntos: [] },
    ];
  }
  return padrao;
}

const semAcento = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** "https://www.forum.adrenaline.com.br/x" / "forum.adrenaline.com.br" → "forum.adrenaline.com.br" */
function limparDominio(entrada) {
  const t = String(entrada || '').trim().toLowerCase();
  if (!t) return '';
  try {
    return new URL(/^https?:\/\//.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Fontes em uso: as do usuário (config.fontesComunidade, um domínio por item)
 * ou as padrão. Domínio conhecido herda nome/tipo/idioma do arquivo; domínio
 * novo vira fórum em português (reddit/youtube reconhecidos pelo nome).
 */
function fontesDaComunidade(config = {}) {
  const base = fontesPadrao();
  const doUsuario = Array.isArray(config.fontesComunidade) ? config.fontesComunidade.map(limparDominio).filter(Boolean) : [];
  if (!doUsuario.length) return base;
  return [...new Set(doUsuario)].map((dominio) => {
    const conhecida = base.find((f) => f.dominio === dominio);
    if (conhecida) return conhecida;
    const tipo = /(^|\.)reddit\.com$/.test(dominio) ? 'reddit' : /(^|\.)youtube\.com$/.test(dominio) ? 'video' : 'forum';
    return { nome: dominio, dominio, tipo, idioma: tipo === 'forum' ? 'pt-BR' : 'all', assuntos: [] };
  });
}

/** A URL é de uma fonte da comunidade (fórum/Reddit/vídeo da lista)? */
function ehDaComunidade(url, config = {}) {
  const host = limparDominio(url);
  if (!host) return false;
  if (/(^|\.)redditmedia\.com$/.test(host)) return true;
  return fontesDaComunidade(config).some((f) => host === f.dominio || host.endsWith(`.${f.dominio}`));
}

// Loja (Fase C): menção em vitrine não é recomendação de ninguém — conta 0
// no consenso. Lista das lojas grandes + nome de domínio com cara de loja
// ("kzmusicstore", "lojaksmusic"), que apareceram nos testes reais.
const LOJAS = /(^|\.)(mercadolivre|mercadolibre|amazon|magazineluiza|magalu|americanas|casasbahia|pontofrio|extra|kabum|terabyteshop|pichau|shoptime|submarino|carrefour|fastshop|aliexpress|shopee|girafa|zoom|buscape|bondfaro|ebay|walmart|bestbuy|newegg)\.[a-z.]+$/;
const CARA_DE_LOJA = /(^|[.-])(loja|lojas|shop|store|comprar|compra)|(shop|store)\./;

/** 'comunidade' (fórum/Reddit da lista), 'loja' ou 'editorial' (review, guia, notícia). */
function tipoDeFonte(url, config = {}) {
  if (ehDaComunidade(url, config)) return 'comunidade';
  const host = limparDominio(url);
  if (!host) return 'editorial';
  if (LOJAS.test(host) || CARA_DE_LOJA.test(host)) return 'loja';
  return 'editorial';
}

/**
 * Consultas "site:" para um assunto: uma por fonte de TEXTO (fórum/Reddit;
 * vídeo fica pra Fase E), respeitando os `assuntos` de cada fonte. O idioma
 * vai junto: Reddit e Head-Fi são em inglês — buscar com `language=pt-BR`
 * (como toda busca fazia até aqui) escondia justamente esses tópicos.
 */
function consultasNaComunidade(assunto, { config = {}, maximo = 6, emIngles = '' } = {}) {
  // nome de fonte não é assunto (11º teste real: "site:clubedohardware.com.br
  // fones ... recomendação Reddit" — a palavra "Reddit" dentro da busca no fórum)
  const tema = String(assunto || '')
    .replace(/\b(reddit|r\/\w+|f[oó]runs?|comunidade|clube do hardware|adrenaline|head-?fi|youtube)\b/gi, ' ')
    .replace(/\b(no|na|do|da|em)\s+(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!tema) return [];
  // fonte em inglês (Reddit, Head-Fi) busca com o assunto em inglês quando o
  // plano deu um (Fase C): "site:reddit.com fone intra pubg" acha pouco
  const ingles = String(emIngles || '').replace(/\b(reddit|forums?|head-?fi)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const normal = semAcento(tema);
  return fontesDaComunidade(config)
    .filter((f) => f.tipo !== 'video')
    .filter((f) => !f.assuntos?.length || f.assuntos.some((a) => new RegExp(`\\b${semAcento(a)}\\b`).test(normal)))
    .slice(0, maximo)
    .map((f) => ({
      consulta: `site:${f.dominio} ${f.idioma === 'en' && ingles ? ingles : tema}`,
      idioma: f.idioma === 'pt-BR' ? 'pt-BR' : 'all',
      fonte: f.nome,
    }));
}

/* ------------------------------ Reddit ------------------------------ */

/** Tópico do Reddit (inclusive o espelho redditmedia.com) → endereço da versão JSON pública. */
function urlJsonDoReddit(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)reddit(media)?\.com$/.test(u.hostname) || !/\/comments\/[a-z0-9]+/i.test(u.pathname)) return null;
  return `https://www.reddit.com${u.pathname.replace(/\/$/, '')}.json?limit=200&sort=top&raw_json=1`;
}

const limparComentario = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/**
 * JSON de um tópico do Reddit → texto: título, post e os comentários mais
 * votados (até 2 níveis de resposta). Removido/apagado fica de fora.
 */
function topicoDoReddit(dados, { maximo = 40 } = {}) {
  const post = dados?.[0]?.data?.children?.[0]?.data;
  if (!post?.title) return null;
  const comentarios = [];
  const percorrer = (filhos, nivel) => {
    for (const c of filhos || []) {
      if (c?.kind !== 't1' || !c.data) continue;
      const corpo = limparComentario(c.data.body);
      if (corpo && !/^\[(removed|deleted|removido|excluído)\]$/i.test(corpo)) {
        comentarios.push({ texto: corpo.slice(0, 700), votos: Number(c.data.score) || 0, nivel });
      }
      if (nivel < 2) percorrer(c.data.replies?.data?.children, nivel + 1);
    }
  };
  percorrer(dados?.[1]?.data?.children, 0);
  comentarios.sort((a, b) => b.votos - a.votos);
  const escolhidos = comentarios.slice(0, maximo);
  const corpoDoPost = limparComentario(post.selftext).slice(0, 2500);
  return {
    titulo: String(post.title).slice(0, 200),
    via: 'topico-reddit',
    comentarios: escolhidos.length,
    texto: [
      `TÓPICO DO REDDIT (r/${post.subreddit || '?'}): ${post.title}`,
      corpoDoPost ? `POST: ${corpoDoPost}` : '',
      escolhidos.length ? `COMENTÁRIOS (${escolhidos.length}, mais votados primeiro):` : 'Sem comentários.',
      ...escolhidos.map((c) => `- [${c.votos} votos] ${c.texto}`),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * O Reddit costuma recusar a versão JSON pedida por fora do navegador (HTTP
 * 403/429 — os 16 tópicos do 10º teste real, 2026-09-26, caíram todos no
 * render da página nova, que traz o post e quase nenhum comentário). Duas
 * saídas, nesta ordem, em `extract.ler`: o MESMO JSON aberto no navegador
 * embutido (o Chromium mostra o JSON dentro de <pre>) e o old.reddit.com,
 * que ainda vem montado no servidor, com os comentários no HTML.
 */
function jsonDoHtmlRenderizado(html) {
  const bruto = String(html || '');
  const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(bruto)?.[1];
  const corpo = pre ?? bruto.replace(/<[^>]+>/g, '');
  const texto = decodificar(corpo).trim();
  if (!/^[[{]/.test(texto)) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** Tópico do Reddit → mesmo tópico no old.reddit.com (HTML montado no servidor). */
function urlAntigaDoReddit(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)reddit(media)?\.com$/.test(u.hostname) || !/\/comments\/[a-z0-9]+/i.test(u.pathname)) return null;
  return `https://old.reddit.com${u.pathname.replace(/\/$/, '')}/?sort=top&limit=200`;
}

// old.reddit: todo texto de post/comentário fica em <div class="md">
const ABERTURA_MD = /<div[^>]*class=["']md["'][^>]*>/;

/** HTML do old.reddit.com → mesmo formato de `topicoDoReddit` (sem votos: a ordem já é "top"). */
function topicoDoRedditAntigo(html, { maximo = 40 } = {}) {
  const bruto = String(html || '');
  const iComentarios = bruto.search(/class=["'][^"']*\bcommentarea\b/);
  if (iComentarios < 0) return null;
  const iPost = bruto.search(/id=["']siteTable["']/);
  const areaPost = iPost >= 0 && iPost < iComentarios ? bruto.slice(iPost, iComentarios) : '';
  const post = blocosDiv(areaPost, ABERTURA_MD).map(textoDoPost).join(' ').slice(0, 2500);
  const comentarios = blocosDiv(bruto.slice(iComentarios), ABERTURA_MD)
    .map(textoDoPost)
    .filter((c) => c && !/^\[(removed|deleted|removido|excluído)\]$/i.test(c))
    .slice(0, maximo);
  const titulo =
    limparComentario(decodificar(textoDoHtml(/<a[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(bruto)?.[1] || ''))) ||
    tituloDoTopico(bruto);
  if (!titulo && !comentarios.length) return null;
  const sub = /\/r\/([^/"'\s]+)\/comments\//i.exec(bruto)?.[1] || '?';
  return {
    titulo: titulo.slice(0, 200),
    via: 'topico-reddit-antigo',
    comentarios: comentarios.length,
    texto: [
      `TÓPICO DO REDDIT (r/${sub}): ${titulo}`,
      post ? `POST: ${post}` : '',
      comentarios.length ? `COMENTÁRIOS (${comentarios.length}, mais votados primeiro):` : 'Sem comentários.',
      ...comentarios.map((c) => `- ${c.slice(0, 700)}`),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * Reddit "novo" (shreddit), a página que o navegador embutido de fato
 * consegue abrir (11º teste real, 2026-09-27: nos 22 tópicos, o JSON voltou
 * 403, o JSON no navegador não veio e o old.reddit veio sem comentário — só
 * a página nova renderizou). A extração genérica perdia os comentários: a
 * poda tira todo bloco com "comment" na classe. Aqui eles são lidos direto:
 *   - comentário: <div id="t1_xxx-comment-rtjson-content"> (ou -post-rtjson-),
 *     com o voto do <shreddit-comment thingid="t1_xxx" score="N">;
 *   - post: <div id="t3_xxx-post-rtjson-content">; título do atributo
 *     post-title do <shreddit-post> (ou do <h1>/og:title).
 */
function atributo(tag, nome) {
  const m = new RegExp(`\\b${nome}=["']([^"']*)["']`, 'i').exec(tag);
  return m ? decodificar(m[1]) : '';
}

function topicoDoRedditNovo(html, { maximo = 40 } = {}) {
  const bruto = String(html || '');
  const tagPost = /<shreddit-post\b[^>]*>/i.exec(bruto)?.[0] || '';
  const titulo = limparComentario(atributo(tagPost, 'post-title')) || tituloDoTopico(bruto);
  const sub = atributo(tagPost, 'subreddit-prefixed-name').replace(/^r\//, '') || /\/r\/([^/"'\s]+)\/comments\//i.exec(bruto)?.[1] || '?';
  const votos = new Map();
  for (const m of bruto.matchAll(/<shreddit-comment\b[^>]*>/gi)) {
    const id = atributo(m[0], 'thingid');
    if (id) votos.set(id, Number(atributo(m[0], 'score')) || 0);
  }
  const post = blocosDiv(bruto, /<div[^>]*\bid=["']t3_[a-z0-9]+-post-rtjson-content["'][^>]*>/).map(textoDoPost).join(' ').slice(0, 2500);
  const comentarios = [];
  const reComentario = /<div[^>]*\bid=["'](t1_[a-z0-9]+)-(?:comment|post)-rtjson-content["'][^>]*>/gi;
  const vistos = new Set();
  let m;
  while ((m = reComentario.exec(bruto)) && comentarios.length < 200) {
    const id = m[1];
    if (vistos.has(id)) continue;
    vistos.add(id);
    const [bloco] = blocosDiv(bruto.slice(m.index), new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const texto = textoDoPost(bloco || '');
    if (texto && !/^\[(removed|deleted|removido|excluído)\]$/i.test(texto)) comentarios.push({ texto: texto.slice(0, 700), votos: votos.get(id) ?? 0 });
  }
  if (!comentarios.length) return null;
  comentarios.sort((a, b) => b.votos - a.votos);
  const escolhidos = comentarios.slice(0, maximo);
  return {
    titulo: titulo.slice(0, 200),
    via: 'topico-reddit-novo',
    comentarios: escolhidos.length,
    texto: [
      `TÓPICO DO REDDIT (r/${sub}): ${titulo}`,
      post ? `POST: ${post}` : '',
      `COMENTÁRIOS (${escolhidos.length}, mais votados primeiro):`,
      ...escolhidos.map((c) => `- [${c.votos} votos] ${c.texto}`),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/* ------------------------------ fóruns ------------------------------ */

/**
 * Blocos `<div ...>` cuja tag de abertura casa com `reAbertura`, com o
 * interior inteiro (divs aninhadas contadas). Regex sozinha pararia no
 * primeiro `</div>` de dentro de uma citação.
 */
function blocosDiv(html, reAbertura) {
  const blocos = [];
  const re = new RegExp(reAbertura.source, 'gi');
  let m;
  while ((m = re.exec(html)) && blocos.length < 200) {
    const inicio = m.index + m[0].length;
    const tag = /<\/?div\b[^>]*>/gi;
    tag.lastIndex = inicio;
    let nivel = 1;
    let t;
    while (nivel > 0 && (t = tag.exec(html))) nivel += t[0][1] === '/' ? -1 : 1;
    if (nivel !== 0) break;
    blocos.push(html.slice(inicio, t.index));
    re.lastIndex = tag.lastIndex;
  }
  return blocos;
}

/** Post de fórum → texto sem citação (a citação repete outro post) e sem assinatura. */
function textoDoPost(html) {
  return limparComentario(
    textoDoHtml(
      html
        .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, ' ')
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
    )
  );
}

// XenForo (Fórum Adrenaline, Head-Fi): cada post fica em <div class="bbWrapper">
const ABERTURA_XENFORO = /<div[^>]*class=["'][^"']*\bbbWrapper\b[^"']*["'][^>]*>/;
// Invision Community (Clube do Hardware): <div ... data-role="commentContent" ...>
const ABERTURA_INVISION = /<div[^>]*data-role=["']commentContent["'][^>]*>/;

function tituloDoTopico(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html)?.[1];
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return limparComentario(decodificar(textoDoHtml(og || h1 || t || ''))).slice(0, 200);
}

/**
 * HTML de tópico de fórum (XenForo ou Invision) → título + posts na ordem.
 * O primeiro post é a pergunta; os outros, as respostas. Devolve null se a
 * página não tem cara de tópico (aí o leitor normal segue).
 */
function topicoDeForum(html, { maximo = 40 } = {}) {
  const bruto = String(html || '');
  let via = null;
  let blocos = blocosDiv(bruto, ABERTURA_INVISION);
  if (blocos.length) via = 'topico-invision';
  else {
    blocos = blocosDiv(bruto, ABERTURA_XENFORO);
    if (blocos.length) via = 'topico-xenforo';
  }
  if (!via) return null;
  const posts = blocos.map(textoDoPost).filter((p) => p.length >= 3);
  if (!posts.length) return null;
  const [pergunta, ...respostas] = posts;
  const escolhidas = respostas.slice(0, maximo);
  const titulo = tituloDoTopico(bruto);
  return {
    titulo,
    via,
    comentarios: escolhidas.length,
    texto: [
      `TÓPICO DE FÓRUM: ${titulo}`,
      `PERGUNTA: ${pergunta.slice(0, 2500)}`,
      escolhidas.length ? `RESPOSTAS (${escolhidas.length}, na ordem do tópico):` : 'Sem respostas.',
      ...escolhidas.map((r) => `- ${r.slice(0, 700)}`),
    ].join('\n'),
  };
}

module.exports = {
  fontesPadrao,
  fontesDaComunidade,
  ehDaComunidade,
  tipoDeFonte,
  consultasNaComunidade,
  limparDominio,
  urlJsonDoReddit,
  topicoDoReddit,
  jsonDoHtmlRenderizado,
  urlAntigaDoReddit,
  topicoDoRedditAntigo,
  topicoDoRedditNovo,
  topicoDeForum,
  blocosDiv,
};
