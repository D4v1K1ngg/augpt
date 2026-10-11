'use strict';

const { baixar } = require('./http');
const { pdf: extrairPdf } = require('../formatos/pdf');

/* ------------------------------ limpeza básica ------------------------------ */

const ENTIDADES = {
  '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>',
  '&nbsp;': ' ', '&amp;': '&', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
  '&laquo;': '«', '&raquo;': '»', '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í',
  '&oacute;': 'ó', '&uacute;': 'ú', '&atilde;': 'ã', '&otilde;': 'õ', '&ccedil;': 'ç',
  '&acirc;': 'â', '&ecirc;': 'ê', '&ocirc;': 'ô', '&agrave;': 'à',
  // unidades e símbolos: sem estes, "32&deg;" chega ao modelo como lixo
  '&deg;': '°', '&times;': '×', '&divide;': '÷', '&plusmn;': '±', '&micro;': 'µ',
  '&sup2;': '²', '&sup3;': '³', '&frac12;': '½', '&frac14;': '¼', '&frac34;': '¾',
  '&bull;': '•', '&middot;': '·', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“',
  '&rdquo;': '”', '&euro;': '€', '&pound;': '£', '&yen;': '¥', '&cent;': '¢',
  '&copy;': '©', '&reg;': '®', '&trade;': '™', '&sect;': '§', '&para;': '¶',
  '&dagger;': '†', '&permil;': '‰', '&larr;': '←', '&rarr;': '→', '&harr;': '↔',
  '&ge;': '≥', '&le;': '≤', '&ne;': '≠', '&asymp;': '≈', '&infin;': '∞',
  '&ordf;': 'ª', '&ordm;': 'º', '&iexcl;': '¡', '&iquest;': '¿', '&shy;': '',
  '&ensp;': ' ', '&emsp;': ' ', '&thinsp;': ' ', '&zwj;': '', '&zwnj;': '',
};

function decodificar(str = '') {
  return String(str)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+\d*;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e);
}

/** Remove tudo que nunca é conteúdo antes de qualquer análise. */
function podar(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<(div|section|ul)\b[^>]*(class|id)=["'][^"']*(menu|sidebar|comment|coment|banner|publicidade|advert|cookie|newsletter|social|compartilh|relacionad|breadcrumb|paywall|rodape|footer)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
      ' '
    );
}

function texto(html = '') {
  return decodificar(html.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

/* ------------------------------ tabelas ------------------------------ */

/**
 * Tabela vira markdown, não texto corrido.
 *
 * O extrator antigo achatava "Item | Preço | Teclado | R$ 199,90" numa linha só,
 * e a relação entre coluna e valor se perdia — o modelo podia reconstruir a
 * associação errada. Em dado financeiro ou comparativo isso é grave.
 */
function tabelaParaMarkdown(html) {
  const linhas = [];
  const linhasHtml = (html.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).map((l) => l);
  for (const linhaXml of linhasHtml) {
    const celulas = [];
    const re = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(linhaXml))) {
      celulas.push(texto(m[2]).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
    }
    if (celulas.length) linhas.push(celulas);
  }

  // tabela de leiaute: uma coluna só, ou nenhum texto
  if (linhas.length < 2) return null;
  const colunas = Math.max(...linhas.map((l) => l.length));
  if (colunas < 2) return null;
  if (!linhas.some((l) => l.some((c) => c.length > 1))) return null;

  const normalizar = (l) => {
    const copia = [...l];
    while (copia.length < colunas) copia.push('');
    return `| ${copia.slice(0, colunas).join(' | ')} |`;
  };

  const [cabecalho, ...corpo] = linhas;
  return [normalizar(cabecalho), `|${' --- |'.repeat(colunas)}`, ...corpo.map(normalizar)].join('\n');
}

/* ------------------------------ metadados ------------------------------ */

const MESES_META = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

/** Data de publicação: dado sem data é dado sem valor em pesquisa recente. */
function dataDePublicacao(html) {
  const padroes = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate|date)["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|datePublished)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)/i,
  ];
  for (const re of padroes) {
    const bruto = re.exec(html)?.[1];
    if (!bruto) continue;
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
    if (iso) return iso[0];
    const br = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(bruto);
    if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }

  const porExtenso = new RegExp(`(\\d{1,2})\\s+de\\s+(${Object.keys(MESES_META).join('|')})\\s+de\\s+(\\d{4})`, 'i');
  const m = porExtenso.exec(decodificar(html.replace(/<[^>]+>/g, ' ')));
  if (m) return `${m[3]}-${MESES_META[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Dados estruturados do JSON-LD: preço, disponibilidade, autor.
 * Vem do próprio site em forma de campo, sem raspagem — mais confiável que
 * qualquer heurística sobre o texto.
 */
function dadosEstruturados(html) {
  const blocos = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const achados = [];

  for (const bloco of blocos) {
    let dados;
    try {
      dados = JSON.parse(bloco.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, ''));
    } catch {
      continue;
    }
    const fila = Array.isArray(dados) ? [...dados] : [dados];
    while (fila.length) {
      const item = fila.shift();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) fila.push(...item['@graph']);
      const tipo = String(item['@type'] || '').toLowerCase();

      if (tipo.includes('product') && item.name) {
        const oferta = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        achados.push(
          `Produto: ${item.name}` +
            (oferta?.price ? ` · preço ${oferta.priceCurrency || 'BRL'} ${oferta.price}` : '') +
            (oferta?.availability ? ` · ${String(oferta.availability).split('/').pop()}` : '')
        );
      }
      if ((tipo.includes('article') || tipo.includes('newsarticle')) && item.headline) {
        const autor = item.author?.name || (Array.isArray(item.author) ? item.author[0]?.name : null);
        achados.push(
          `Artigo: ${item.headline}` +
            (item.datePublished ? ` · publicado ${String(item.datePublished).slice(0, 10)}` : '') +
            (autor ? ` · por ${autor}` : '')
        );
      }
    }
  }
  return [...new Set(achados)].slice(0, 6);
}

/* ------------------------------ estratégias ------------------------------ */

/** 1. Dados estruturados: muitos portais publicam o corpo inteiro em JSON-LD. */
function porJsonLd(htmlBruto) {
  const blocos = htmlBruto.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const bloco of blocos) {
    const cru = bloco.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let dados;
    try {
      dados = JSON.parse(cru);
    } catch {
      continue;
    }
    const fila = Array.isArray(dados) ? [...dados] : [dados];
    while (fila.length) {
      const item = fila.shift();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) fila.push(...item['@graph']);
      const corpo = item.articleBody || item.text;
      if (typeof corpo === 'string' && corpo.length > 400) {
        return { texto: decodificar(corpo).trim(), via: 'json-ld' };
      }
    }
  }
  return null;
}

/** 2. Container semântico explícito. */
function porContainer(html) {
  const alvos = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:post-content|entry-content|article-body|conteudo|materia|texto-materia)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of alvos) {
    const achou = re.exec(html);
    if (achou) {
      const t = paragrafos(achou[1]);
      if (t.length > 300) return { texto: t, via: 'container' };
    }
  }
  return null;
}

/**
 * 3. Densidade de parágrafo: percorre p/h/li/blockquote na ordem do documento e
 * descarta blocos curtos ou dominados por links (menu disfarçado de lista).
 */
function paragrafos(html) {
  const partes = [];

  // as tabelas saem de cena antes da varredura de parágrafos e voltam como
  // markdown, preservando a relação entre coluna e valor
  const tabelas = [];
  const comMarcadores = html.replace(/<table\b[\s\S]*?<\/table>/gi, (bloco) => {
    const markdown = tabelaParaMarkdown(bloco);
    if (!markdown) return ' ';
    tabelas.push(markdown);
    return `<p>\u0000TABELA${tabelas.length - 1}\u0000</p>`;
  });
  html = comMarcadores;
  const re = /<(p|h[1-6]|li|blockquote|pre|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const bruto = m[2];
    const limpo = texto(bruto);
    if (!limpo) continue;

    const links = (bruto.match(/<a\b/gi) || []).length;
    const tamanhoDosLinks = (bruto.match(/<a\b[^>]*>([\s\S]*?)<\/a>/gi) || [])
      .reduce((n, a) => n + texto(a).length, 0);
    const densidade = limpo.length ? tamanhoDosLinks / limpo.length : 1;

    if (/^h[1-6]$/.test(tag)) {
      if (limpo.length > 2 && limpo.length < 200) partes.push(`\n## ${limpo}`);
      continue;
    }
    if (densidade > 0.6 && links > 1) continue; // navegação
    if (tag === 'li' && limpo.length < 45) continue;
    if (tag === 'td' && limpo.length < 60) continue;
    if (tag === 'p' && limpo.length < 30 && !/\u0000TABELA/.test(limpo)) continue;
    partes.push(tag === 'li' ? `• ${limpo}` : limpo);
  }
  // Muito portal serve a mesma frase duas vezes (versão desktop + mobile escondida
  // por CSS). Sem deduplicar, metade da janela de contexto vai embora em repetição.
  const vistos = new Set();
  const unicos = partes.filter((linha) => {
    const chave = linha.replace(/\s+/g, ' ').trim().toLowerCase();
    if (chave.length < 25) return true; // títulos curtos podem repetir legitimamente
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return unicos
    .join('\n\n')
    .replace(/\u0000TABELA(\d+)\u0000/g, (_, i) => `\n${tabelas[Number(i)]}\n`)
    .replace(/\n{4,}/g, '\n\n')
    .trim();
}

function titulo(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html)?.[1];
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return texto(og || h1 || t || '').slice(0, 200);
}

/**
 * Card de listagem real (ex: a própria home de notícias do PUBG) costuma
 * repetir o título dentro do próprio bloco — uma vez como texto do link,
 * outra como alt/aria-label da imagem do card — e isso quase dobra o
 * tamanho do bloco sem acrescentar informação nenhuma. Sem descontar isso,
 * "Aviso Semanal de Banimentos... Aviso Semanal de Banimentos... AVISO
 * 2026.09.09" parece um bloco de ~160 caracteres (não bate o limiar de
 * "manchete curta") quando o conteúdo de verdade tem uns 90.
 */
function tamanhoSemRepeticaoImediata(bloco) {
  const s = String(bloco).replace(/\s+/g, ' ').trim();
  // ache o menor trecho (15+ caracteres) que se repete logo em seguida, sem
  // nada no meio além de um espaço — é o padrão de card duplicado, não uma
  // frase que só por acaso reaparece bem mais adiante no bloco
  const m = /(.{15,}?) \1(?![a-zA-Z0-9])/.exec(s);
  return m ? s.length - m[1].length - 1 : s.length;
}

/**
 * A página é uma capa/índice (lista de manchetes de assuntos diferentes) em
 * vez de uma matéria específica?
 *
 * Bug real: destilar ou escrever a partir de uma home de portal de notícias
 * mistura pedaços de histórias sem nenhuma relação entre si — Irã, dólar,
 * lançamento de celular — como se fosse um texto corrido só, porque a
 * extração de "conteúdo denso" não distingue isso de um artigo de verdade.
 *
 * Sinal: muitos blocos curtos (cara de manchete) e nenhum bloco longo (cara
 * de parágrafo de matéria). Uma matéria de verdade, mesmo curta, quase
 * sempre tem ao menos um parágrafo de desenvolvimento — uma capa não.
 */
function pareceListagem(texto) {
  const blocos = String(texto)
    .split(/\n{2,}/)
    .map((b) => b.replace(/^#+\s*/, '').replace(/^•\s*/, '').trim())
    .filter(Boolean);
  if (blocos.length < 6) return false; // matéria curta legítima também tem poucos blocos
  const tamanhos = blocos.map(tamanhoSemRepeticaoImediata);
  const longos = tamanhos.filter((n) => n >= 220).length;
  const curtos = tamanhos.filter((n) => n < 90).length;
  return longos === 0 && curtos >= blocos.length * 0.6;
}

/**
 * O texto veio malcodificado ("mojibake")?
 *
 * Caso real (v0.5.7, teste ao vivo): uma página devolveu texto
 * que tecnicamente decodificou sem erro (`http.js` não lançou exceção
 * nenhuma) mas virou ruído sem sentido — sequência longa de símbolos e
 * caracteres sem glifo, tipo bytes de um charset diferente do assumido
 * interpretados um a um como se fossem Latin-1/UTF-8. Isso foi parar como
 * "material coletado" no prompt, e o modelo pequeno, em vez de ignorar,
 * tentou "reproduzir fielmente o texto original" — respondeu só com o lixo.
 * `http.js` já lida com o caso de content-type mentiroso (PDF/binário virando
 * texto) checando a assinatura de bytes; isto cobre o caso de charset ERRADO
 * mesmo para conteúdo que É texto de verdade, só que no idioma/codificação
 * errada — não dá pra saber qual charset certo seria, então a estratégia é
 * só reconhecer o sintoma (proporção alta de caractere fora do alfabeto
 * latino comum + pontuação usual) e tratar como extração que falhou, não
 * como conteúdo válido.
 */
function pareceMalcodificado(txt) {
  const amostra = String(txt).slice(0, 4000);
  if (amostra.length < 200) return false; // amostra curta demais pra ter certeza
  const comuns = amostra.match(/[a-zA-Z0-9À-ÖØ-öø-ÿ\s.,;:!?()"'“”‘’«»\-–—%°/\\@#&*+=[\]{}]/g)?.length || 0;
  return 1 - comuns / amostra.length > 0.22;
}

/** Orquestra as estratégias e devolve a melhor extração do HTML. */
function extrairDoHtml(htmlBruto) {
  const html = podar(htmlBruto);
  const estruturados = dadosEstruturados(htmlBruto);
  const data = dataDePublicacao(htmlBruto);
  const candidatos = [porJsonLd(htmlBruto), porContainer(html)].filter(Boolean);
  const denso = paragrafos(html);
  // limiar baixo de propósito: página curta e legítima (nota, verbete, release)
  // não pode ser descartada só por ser curta — quem decide se basta é `ler`.
  if (denso.length > 100) candidatos.push({ texto: denso, via: 'densidade' });
  if (!candidatos.length) {
    const cru = texto(html);
    if (cru.length > 60) candidatos.push({ texto: cru, via: 'texto-cru' });
  }
  const melhor = candidatos.sort((a, b) => b.texto.length - a.texto.length)[0];
  if (!melhor) return null;

  const cabecalho = [
    data ? `[publicado em ${data}]` : '',
    ...estruturados.map((e) => `[${e}]`),
  ].filter(Boolean).join('\n');

  return {
    ...melhor,
    titulo: titulo(htmlBruto),
    data,
    estruturados,
    listagem: pareceListagem(melhor.texto),
    texto: cabecalho ? `${cabecalho}\n\n${melhor.texto}` : melhor.texto,
  };
}

/* ------------------------------ camadas de leitura ------------------------------ */

/** Wikipédia tem API própria: melhor texto, sem raspagem. */
async function viaWikipedia(url) {
  const m = /^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/i.exec(url);
  if (!m) return null;
  const [, idioma, artigo] = m;
  const api = `https://${idioma}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${artigo}`;
  const r = await baixar(api, { timeout: 15000 });
  if (!r.ok) return null;
  try {
    const paginas = JSON.parse(r.texto)?.query?.pages || {};
    const pagina = Object.values(paginas)[0];
    if (pagina?.extract?.length > 200) {
      return { texto: pagina.extract, titulo: pagina.title, via: 'api-wikipedia' };
    }
  } catch {
    /* cai para a próxima camada */
  }
  return null;
}

/** Último recurso: leitor externo que renderiza JS e devolve markdown limpo. */
async function viaLeitorExterno(url) {
  const r = await baixar(`https://r.jina.ai/${url}`, { timeout: 40000 });
  if (!r.ok || r.texto.length < 200) return null;
  return { texto: r.texto.trim(), titulo: '', via: 'leitor-externo' };
}

/**
 * Tópico do Reddit (10º e 11º testes reais). O Reddit recusa o JSON pedido
 * por fora do navegador (HTTP 403 em 100% dos tópicos no 11º teste), e no
 * PC do Davi o JSON aberto no navegador e o old.reddit também não trouxeram
 * nada — só a página nova, renderizada, abriu. Ordem agora:
 *   1. JSON direto (rápido; se o Reddit liberar, é o melhor formato);
 *   2. página renderizada + leitor do Reddit novo (topicoDoRedditNovo);
 *   3. old.reddit direto; 4. JSON no navegador.
 * Estratégia que falhou 3 vezes nesta sessão do app sem nunca funcionar é
 * pulada (cada render custa segundos; 22 tópicos × 4 tentativas pesou no
 * tempo do 11º teste). Se a página renderizada não tiver comentário
 * reconhecível, o HTML vai pra pasta de diagnóstico (até 2 por sessão) —
 * é o que permite ajustar o leitor à estrutura real sem adivinhar.
 */
const placarReddit = { json: { ok: 0, falhas: 0 }, novo: { ok: 0, falhas: 0 }, antigo: { ok: 0, falhas: 0 }, jsonNavegador: { ok: 0, falhas: 0 } };
const vale = (k) => placarReddit[k].ok > 0 || placarReddit[k].falhas < 3;
const marcar = (k, ok) => {
  placarReddit[k][ok ? 'ok' : 'falhas'] += 1;
};
let pastaDiagnostico = null;
let diagnosticosSalvos = 0;
/** Bancada: cada caso começa com o placar zerado. */
function reiniciarPlacarReddit() {
  for (const k of Object.keys(placarReddit)) placarReddit[k] = { ok: 0, falhas: 0 };
  diagnosticosSalvos = 0;
}
/** electron/main.js informa a pasta de dados do app; sem ela, nada é salvo. */
function definirPastaDeDiagnostico(pasta) {
  pastaDiagnostico = pasta || null;
}
function salvarDiagnostico(nome, conteudo) {
  if (!pastaDiagnostico || diagnosticosSalvos >= 2 || !conteudo) return;
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(pastaDiagnostico, { recursive: true });
    fs.writeFileSync(path.join(pastaDiagnostico, nome), String(conteudo).slice(0, 3_000_000));
    diagnosticosSalvos += 1;
  } catch {
    /* diagnóstico nunca atrapalha a leitura */
  }
}

async function lerTopicoDoReddit(url, jsonReddit, { render, conferir, tentativas, comunidade }) {
  if (vale('json')) {
    try {
      const r = await baixar(jsonReddit, { timeout: 20000, conferir, headers: { Accept: 'application/json' } });
      let dados = null;
      if (r.ok) {
        try {
          dados = JSON.parse(r.texto);
        } catch {
          dados = null;
        }
      }
      const topico = dados ? comunidade.topicoDoReddit(dados) : null;
      marcar('json', Boolean(topico));
      if (topico) return topico;
      tentativas.push(`reddit json: ${r.ok ? 'formato inesperado' : `HTTP ${r.status}`}`);
    } catch (err) {
      marcar('json', false);
      tentativas.push(`reddit json: ${err.message}`);
    }
  }
  if (render && vale('novo')) {
    try {
      const html = await render(url);
      const topico = comunidade.topicoDoRedditNovo(html);
      marcar('novo', Boolean(topico));
      if (topico) return { ...topico, via: 'topico-reddit-novo+render-js' };
      tentativas.push(`reddit novo no navegador: sem comentário reconhecível (${String(html || '').length} caracteres)`);
      const id = /\/comments\/([a-z0-9]+)/i.exec(url)?.[1] || 'x';
      salvarDiagnostico(`reddit-${id}.html`, html);
    } catch (err) {
      marcar('novo', false);
      tentativas.push(`reddit novo no navegador: ${err.message}`);
    }
  }
  const antiga = comunidade.urlAntigaDoReddit(url);
  if (antiga && vale('antigo')) {
    try {
      const r = await baixar(antiga, { timeout: 20000, conferir });
      const topico = r.ok ? comunidade.topicoDoRedditAntigo(r.texto) : null;
      marcar('antigo', Boolean(topico?.comentarios));
      if (topico?.comentarios) return topico;
      tentativas.push(`old.reddit: ${r.ok ? 'sem comentários no HTML' : `HTTP ${r.status}`}`);
    } catch (err) {
      marcar('antigo', false);
      tentativas.push(`old.reddit: ${err.message}`);
    }
  }
  if (render && vale('jsonNavegador')) {
    try {
      const dados = comunidade.jsonDoHtmlRenderizado(await render(jsonReddit));
      const topico = dados ? comunidade.topicoDoReddit(dados) : null;
      marcar('jsonNavegador', Boolean(topico));
      if (topico) return { ...topico, via: 'topico-reddit+render-js' };
      tentativas.push('reddit json no navegador: sem JSON');
    } catch (err) {
      marcar('jsonNavegador', false);
      tentativas.push(`reddit json no navegador: ${err.message}`);
    }
  }
  return null;
}

/**
 * Lê uma URL passando por camadas até conseguir texto utilizável:
 * API dedicada → HTML direto → renderização com JS → leitor externo.
 * `render` é injetado pelo processo principal do Electron (janela offscreen).
 */
async function ler(url, opcoes = {}) {
  // `tentativas` volta junto com a página (10º teste real: sem isso, não dava
  // pra saber por que o Reddit caiu no render — só o "via" final aparecia)
  const tentativas = [];
  const pagina = await lerEmCamadas(url, opcoes, tentativas);
  return tentativas.length && !pagina.tentativas ? { ...pagina, tentativas: [...tentativas] } : pagina;
}

async function lerEmCamadas(url, { render, permitirExterno = true, minimo = 250, estrategia = null, conferir = null } = {}, tentativas = []) {

  // Fase 1 de segurança (2026-09-23): `conferir` (rede.conferirDestino, vindo
  // das ferramentas) barra endereço da rede local ANTES de qualquer camada —
  // inclusive do leitor externo, que mandaria o endereço interno pra fora.
  // Os redirecionamentos da leitura direta são conferidos em `baixar()`; os
  // do navegador offscreen, pela sessão dele (electron/render.js).
  if (conferir) await conferir(url);

  // Tópico de comunidade (Fase A da pesquisa pela comunidade, 2026-09-26):
  // Reddit tem versão JSON pública do tópico — comentários com votos, sem
  // menu nem script; fórum (XenForo/Invision) é reconhecido no HTML, logo
  // abaixo. Require tardio: comunidade.js usa `texto` deste arquivo.
  const comunidade = require('./comunidade');
  const jsonReddit = comunidade.urlJsonDoReddit(url);
  if (jsonReddit) {
    const topico = await lerTopicoDoReddit(url, jsonReddit, { render, conferir, tentativas, comunidade });
    if (topico) return { ...topico, url };
  }

  // Já se sabe que este site só monta o conteúdo com JavaScript? Então pular a
  // tentativa direta economiza uma requisição e alguns segundos.
  if (estrategia === 'render-js' && render) {
    try {
      const html = await render(url);
      // tópico de fórum ANTES da extração genérica (10º teste real: o Clube
      // do Hardware ficou marcado como "render-js" na memória operacional e
      // os tópicos saíam pela extração genérica, que poda os comentários)
      const topico = html ? comunidade.topicoDeForum(html) : null;
      if (topico && topico.texto.length >= 120) return { ...topico, via: `${topico.via}+render-js`, url };
      const pronto = html ? extrairDoHtml(html) : null;
      if (pronto && pronto.texto.length >= minimo && !pareceMalcodificado(pronto.texto)) {
        return { ...pronto, via: 'render-js', url };
      }
    } catch {
      /* segue pelo caminho normal */
    }
  }

  const wiki = await viaWikipedia(url).catch(() => null);
  if (wiki) return { ...wiki, url };

  let direto = null;
  try {
    const r = await baixar(url, { timeout: 22000, conferir });
    if (r.ok) {
      // `baixar()` decodifica QUALQUER resposta como texto — para um PDF isso
      // produz bytes de stream comprimido interpretados como caracteres (visto
      // num log real: um link pra um PDF da Nvidia virou "%PDF-1.4 ... JFIF..."
      // dentro do material coletado, sem nenhuma informação útil, só ruído e
      // gasto de tokens). O content-type às vezes mente ou vem vazio, então a
      // checagem principal é a assinatura dos bytes — mesma técnica de
      // src/formatos/index.js.
      const ehPdf =
        /application\/pdf/i.test(r.tipo) || r.buffer?.subarray(0, 5).toString('latin1') === '%PDF-';
      if (ehPdf) {
        try {
          const extraido = extrairPdf(r.buffer, { limite: 60000 });
          // Caso real (chat "Pergunta 1" sobre o guia PMBOK, 2026-09-18): três PDFs
          // foram lidos, um deles (fonte sem ToUnicode/Identity-H, o mesmo cenário
          // que `pareceLegivel` em src/formatos/pdf.js já detecta e sinaliza via
          // `meta.aviso`) extraiu texto tecnicamente não-vazio, só que embaralhado.
          // Como aqui só se checava o COMPRIMENTO (>=40 caracteres), o aviso da
          // própria extração era descartado e o lixo virava "material coletado"
          // válido — o mesmo bug que `pareceMalcodificado` já existe pra evitar no
          // caminho HTML, mas nunca tinha sido ligado ao caminho PDF. O modelo, ao
          // receber esse ruído no dossiê, tentou "decifrá-lo" em vez de ignorá-lo.
          if (extraido.texto && extraido.texto.trim().length >= 40 && !extraido.meta?.aviso) {
            return { texto: extraido.texto, titulo: '', via: 'pdf', url: r.url };
          }
          tentativas.push(`pdf: ${extraido.meta?.aviso || 'sem texto extraível'}`);
        } catch (err) {
          tentativas.push(`pdf: ${err.message}`);
        }
        // não cai para extrairDoHtml/texto-cru com os bytes brutos do PDF —
        // segue para as próximas camadas (render/leitor externo) abaixo.
      } else if (/application\/json/i.test(r.tipo)) {
        return { texto: r.texto.slice(0, 60000), titulo: '', via: 'json', url: r.url };
      } else if (/text\/plain|text\/markdown/i.test(r.tipo)) {
        return { texto: r.texto.trim(), titulo: '', via: 'texto', url: r.url };
      } else {
        // tópico de fórum: posts em ordem, sem citação repetida nem assinatura
        const topico = comunidade.topicoDeForum(r.texto);
        if (topico && topico.texto.length >= 120) return { ...topico, url: r.url };
        direto = extrairDoHtml(r.texto);
        if (direto && direto.texto.length >= minimo) {
          if (!pareceMalcodificado(direto.texto)) return { ...direto, url: r.url };
          tentativas.push('html direto: texto malcodificado (charset errado), descartado');
          direto = null; // não serve nem como último recurso — ver comentário de `pareceMalcodificado`
        } else {
          tentativas.push(`html direto: ${direto ? `${direto.texto.length} caracteres` : 'nada extraído'}`);
        }
      }
    } else {
      tentativas.push(`html direto: HTTP ${r.status}`);
    }
  } catch (err) {
    tentativas.push(`html direto: ${err.message}`);
  }

  // página que só monta o conteúdo via JavaScript
  if (render) {
    try {
      const html = await render(url);
      const topico = html ? comunidade.topicoDeForum(html) : null;
      if (topico && topico.texto.length >= 120) return { ...topico, via: `${topico.via}+render-js`, url };
      const rendered = html ? extrairDoHtml(html) : null;
      if (rendered && rendered.texto.length >= minimo && !pareceMalcodificado(rendered.texto)) {
        return { ...rendered, via: 'render-js', url };
      }
      tentativas.push('render js: conteúdo insuficiente ou malcodificado');
    } catch (err) {
      tentativas.push(`render js: ${err.message}`);
    }
  }

  if (permitirExterno) {
    try {
      const externo = await viaLeitorExterno(url);
      if (externo) return { ...externo, url };
      tentativas.push('leitor externo: sem retorno');
    } catch (err) {
      tentativas.push(`leitor externo: ${err.message}`);
    }
  }

  if (direto?.texto) return { ...direto, url, parcial: true };
  throw new Error(`Não consegui ler a página. Tentativas — ${tentativas.join(' | ')}`);
}

module.exports = {
  definirPastaDeDiagnostico,
  reiniciarPlacarReddit,
  ler, extrairDoHtml, paragrafos, texto, decodificar, podar,
  tabelaParaMarkdown, dataDePublicacao, dadosEstruturados, pareceListagem, pareceMalcodificado,
};
