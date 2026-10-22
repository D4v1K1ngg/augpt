'use strict';

const { baixar } = require('./http');
const { texto, decodificar } = require('./extract');

/**
 * Cadeia de provedores de busca, todos gratuitos e sem chave obrigatória.
 * O primeiro que devolver resultados vence; os demais ficam de reserva para
 * quando um endpoint mudar, cair ou aplicar bloqueio por volume.
 */

function normalizar(lista, fonte) {
  const vistos = new Set();
  return lista
    .filter((r) => r.url && /^https?:\/\//i.test(r.url))
    .filter((r) => {
      const chave = r.url.replace(/[#?].*$/, '');
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((r) => ({
      titulo: (r.titulo || '').slice(0, 200),
      url: r.url,
      resumo: (r.resumo || '').slice(0, 400),
      fonte,
      ...(r.data ? { data: String(r.data).slice(0, 10) } : {}),
    }));
}

/** Desembrulha o redirecionamento do DuckDuckGo (…/l/?uddg=…). */
function limparLink(href) {
  let url = decodificar(href);
  const uddg = /[?&]uddg=([^&]+)/.exec(url);
  if (uddg) url = decodeURIComponent(uddg[1]);
  if (url.startsWith('//')) url = `https:${url}`;
  return url.split('&rut=')[0];
}

/* ------------------------------ provedores ------------------------------ */

/** SearXNG local — o melhor caminho: agrega Google, DDG, Brave e outros. */
/**
 * Saúde dos buscadores por trás do SearXNG (11/10). Em 11/10 três dos cinco
 * estavam suspensos ("too many requests") e o SearXNG devolvia zero
 * resultados sem ninguém ficar sabendo. Cada resposta diz quem respondeu e
 * quem falhou; guardamos a última para a tela mostrar (painel central).
 */
const saude = { em: null, respondendo: [], semResposta: [] };
function registrarSaude(dados) {
  const respondendo = new Set();
  for (const x of dados.results || []) for (const e of x.engines || [x.engine]) if (e) respondendo.add(e);
  const falhas = (dados.unresponsive_engines || []).map((u) => ({ nome: String(u[0]), motivo: String(u[1] || '').replace(/^Suspended: /, '') }));
  // buscador que falhou nesta consulta pode ter respondido na anterior: vale a mais recente
  saude.em = Date.now();
  saude.respondendo = [...respondendo];
  saude.semResposta = falhas.filter((f) => !respondendo.has(f.nome));
}
/** `{ em, respondendo: [nomes], semResposta: [{ nome, motivo }] }` da última busca geral no SearXNG. */
const saudeDaBusca = () => ({ ...saude });

async function searxng(consulta, { searxngUrl, idioma = 'pt-BR', categoria = '', periodo = '' }) {
  if (!searxngUrl) return [];
  const base = searxngUrl.replace(/\/$/, '');
  // idioma por busca (Fase A da pesquisa pela comunidade, 2026-09-26): com
  // pt-BR fixo, tópico do Reddit e do Head-Fi (em inglês) quase não aparecia.
  // 'all' = sem filtro de idioma. `categoria` 'videos' prepara a Fase E.
  // periodo (18/10): 'day' | 'week' | 'month' | 'year' — o SearXNG filtra por data nos buscadores que sabem
  const extras = `&language=${encodeURIComponent(idioma || 'all')}${categoria ? `&categories=${encodeURIComponent(categoria)}` : ''}${periodo ? `&time_range=${encodeURIComponent(periodo)}` : ''}`;
  const r = await baixar(`${base}/search?q=${encodeURIComponent(consulta)}&format=json${extras}`, {
    timeout: 15000,
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`SearXNG HTTP ${r.status} (a instância precisa liberar o formato JSON)`);
  const dados = JSON.parse(r.texto);
  if (!categoria) registrarSaude(dados);
  return normalizar(
    (dados.results || []).map((x) => ({ titulo: x.title, url: x.url, resumo: x.content, data: x.publishedDate || null })),
    'searxng'
  );
}

async function duckduckgoHtml(consulta, { idioma = 'pt-BR' } = {}) {
  const r = await baixar('https://html.duckduckgo.com/html/', {
    metodo: 'POST',
    timeout: 18000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://duckduckgo.com/' },
    corpo: `q=${encodeURIComponent(consulta)}&kl=${idioma === 'pt-BR' ? 'br-pt' : 'wt-wt'}`,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const itens = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(r.texto)) && itens.length < 25) {
    itens.push({ url: limparLink(m[1]), titulo: texto(m[2]), resumo: '' });
  }
  const resumos = [];
  const reS = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = reS.exec(r.texto))) resumos.push(texto(m[1]));
  itens.forEach((it, i) => {
    it.resumo = resumos[i] || '';
  });
  return normalizar(itens, 'duckduckgo');
}

/** Versão enxuta do DDG: HTML mais simples, sobrevive a mudanças de layout. */
async function duckduckgoLite(consulta, { idioma = 'pt-BR' } = {}) {
  const r = await baixar('https://lite.duckduckgo.com/lite/', {
    metodo: 'POST',
    timeout: 18000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    corpo: `q=${encodeURIComponent(consulta)}&kl=${idioma === 'pt-BR' ? 'br-pt' : 'wt-wt'}`,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const itens = [];
  const re = /<a[^>]+href="(http[^"]+|\/l\/\?[^"]+)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(r.texto)) && itens.length < 25) {
    itens.push({ url: limparLink(m[1]), titulo: texto(m[2]), resumo: '' });
  }
  if (!itens.length) {
    // layout alternativo: âncoras soltas na tabela de resultados
    const reAlt = /<a\b[^>]+href="([^"]+)"[^>]*>([^<]{15,})<\/a>/gi;
    while ((m = reAlt.exec(r.texto)) && itens.length < 25) {
      const url = limparLink(m[1]);
      if (/duckduckgo\.com/.test(url)) continue;
      itens.push({ url, titulo: texto(m[2]), resumo: '' });
    }
  }
  const resumos = [];
  const reS = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  while ((m = reS.exec(r.texto))) resumos.push(texto(m[1]));
  itens.forEach((it, i) => {
    it.resumo = resumos[i] || '';
  });
  return normalizar(itens, 'duckduckgo-lite');
}

/** Índice independente, JSON de verdade. Chave "public" tem limite compartilhado. */
async function marginalia(consulta, { marginaliaKey = 'public' } = {}) {
  const r = await baixar(
    `https://api2.marginalia-search.com/search?query=${encodeURIComponent(consulta)}&count=10`,
    { timeout: 15000, headers: { 'API-Key': marginaliaKey, Accept: 'application/json' } }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 503 ? ' (limite da chave pública)' : ''}`);
  const dados = JSON.parse(r.texto);
  return normalizar(
    (dados.results || []).map((x) => ({ titulo: x.title, url: x.url, resumo: x.description })),
    'marginalia'
  );
}

/** Cobre bem pergunta enciclopédica quando o resto falha. */
async function wikipedia(consulta) {
  const url = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srlimit=8&format=json&srsearch=${encodeURIComponent(
    consulta
  )}`;
  const r = await baixar(url, { timeout: 12000, headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const achados = JSON.parse(r.texto)?.query?.search || [];
  return normalizar(
    achados.map((x) => ({
      titulo: x.title,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`,
      resumo: texto(x.snippet),
    })),
    'wikipedia'
  );
}

/**
 * Leitor externo em modo SERP — devolve texto corrido, então extraímos os
 * links. Exige chave própria: sem ela a Jina responde 401 sempre, e tentar
 * mesmo assim só queima tempo (e uma vaga na cadeia) numa execução que já
 * está atrás de resultado. Falhar aqui, antes da rede, é rápido e some da
 * trilha como "sem chave" em vez de um HTTP 401 igual a toda outra tentativa.
 */
async function jina(consulta, { jinaKey } = {}) {
  if (!jinaKey) throw new Error('sem chave configurada (Ajustes → Pesquisa na web)');
  const r = await baixar(`https://s.jina.ai/?q=${encodeURIComponent(consulta)}`, {
    timeout: 40000,
    headers: { 'X-Respond-With': 'no-content', Accept: 'text/plain', Authorization: `Bearer ${jinaKey}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const itens = [];
  const blocos = r.texto.split(/\n(?=\[\d+\]|\d+\.\s)/);
  for (const bloco of blocos) {
    const url = /(https?:\/\/[^\s)\]]+)/.exec(bloco)?.[1];
    if (!url) continue;
    const titulo = /Title:\s*(.+)/i.exec(bloco)?.[1] || bloco.split('\n')[0];
    const resumo = /Description:\s*(.+)/i.exec(bloco)?.[1] || '';
    itens.push({ url, titulo: texto(titulo), resumo: texto(resumo) });
  }
  return normalizar(itens, 'jina');
}

/* ------------------------------ qualidade da fonte ------------------------------ */

/**
 * Ordena os resultados por tipo de domínio antes da leitura.
 *
 * A skill de pesquisa PEDE fonte primária, mas nada garantia: a ordem era a do
 * buscador. Aqui é determinístico — órgão oficial e universidade primeiro,
 * imprensa depois, agregador por último. Isso importa mais agora que o limite
 * de fontes é rígido: as primeiras da fila são as que serão lidas.
 */
const PESOS = [
  // As regras específicas vêm primeiro: "forum.manjaro.org" casava com a regra
  // genérica de .org e era tratado como organização séria.
  [/(blogspot|wordpress|medium|substack)\./, 1, 'blog'],
  // Fórum e rede social aparecem muito em busca técnica e quase nunca sustentam
  [/(^|\.)(forum|forums|reddit|stackexchange)\.|\.forum\.|discourse\./, 1, 'fórum'],
  [/(pinterest|quora|answers|slideshare|scribd|tudogostoso)\./, 0, 'agregador'],
  [/(facebook|instagram|twitter|x\.com|tiktok|youtube)\./, 0, 'rede social'],
  // Skill "Pesquisa acadêmica" (2026-09-22): repositório/periódico acadêmico
  // pontuava igual a site comum (.org genérico, peso 5) ou — pior, no caso de
  // scholar.google.com — caía na regra de "buscador" (peso -5) só por ter
  // "google." no domínio, mesmo sendo um índice acadêmico, não um buscador
  // genérico. Por isso esta regra vem ANTES da de "buscador" logo abaixo.
  [/arxiv\.org$|semanticscholar\.org$|doi\.org$|dl\.acm\.org$|ieeexplore\.ieee\.org$|link\.springer\.com$|sciencedirect\.com$|researchgate\.net$|doaj\.org$|jstor\.org$|scholar\.google\./, 7, 'periódico/repositório acadêmico'],
  // o buscador não é fonte: se ele mesmo aparece nos resultados, é ruído
  [/(duckduckgo|google|bing|yahoo)\./, -5, 'buscador'],
  // (19/10: "gov.br" sozinho — o portal do governo, depois de tirar o "www." — não casava)
  [/(^|\.)gov(\.[a-z]{2})?$|(^|\.)gov\./, 10, 'órgão oficial'],
  [/(^|\.)(edu|ac)(\.[a-z]{2})?$|(^|\.)edu\./, 9, 'universidade'],
  // universidade brasileira não usa .edu: as estaduais e federais (uf*, if*) e as conhecidas
  [/(^|\.)(usp|unicamp|unesp|unifesp|unb|fgv|ita|uf[a-z]{1,5}|unir|unirio|utfpr|cefet[a-z]{0,4}|if[a-z]{1,5}|puc[a-z]{0,6})\.br$/, 9, 'universidade'],
  [/\.(int|mil)$/, 8, 'organismo oficial'],
  [/wikipedia\.org$|\.who\.int$|nature\.com$|science\.org$|scielo\./, 7, 'referência'],
  [/\.org(\.[a-z]{2})?$/, 5, 'organização'],
  [/(globo|uol|folha|estadao|bbc|reuters|nytimes|cnn|g1|agenciabrasil)\./, 4, 'imprensa'],
];

/**
 * Tabela de credibilidade, carregada uma vez. Marca domínios com histórico de
 * fabricação, sátira e apuração fraca.
 *
 * O que ela NÃO faz: bloquear em silêncio. Fonte marcada continua podendo ser
 * lida — desce na fila e a marcação vai junto para o material, para o modelo e
 * para o usuário. Sumir com uma fonte sem dizer é pior que mostrá-la com
 * ressalva.
 */
let tabela = null;
let bloqueados = null;
let personalizados = {}; // entradas do usuário, definidas em Configurações

/**
 * O julgamento do usuário vence a base pública: ele conhece os sites do
 * assunto dele melhor que uma lista americana de 2017.
 */
function definirPersonalizados(lista = []) {
  personalizados = {};
  for (const item of lista) {
    if (!item?.dominio) continue;
    const chave = String(item.dominio).toLowerCase().replace(/^www\./, '').trim();
    if (!chave) continue;
    personalizados[chave] = {
      risco: item.risco || 'medio',
      motivo: item.motivo || 'marcado por você',
      reforco: item.risco === 'confiavel' ? item.motivo || 'fonte confiável marcada por você' : undefined,
      seu: true,
    };
  }
  return Object.keys(personalizados).length;
}

/**
 * Lista de bloqueio judicial brasileira.
 *
 * NÃO é julgamento de credibilidade — são ordens de aposta, pirataria e IPTV.
 * O repositório de origem não endossa nem contesta as ordens, e nós também não.
 * O uso aqui é prático: domínio bloqueado provavelmente não abre a partir do
 * Brasil, e gastar uma das poucas leituras nele é desperdício.
 *
 * Carregada por demanda: são 50 mil linhas, e a maioria das pesquisas nunca
 * esbarra em nenhuma.
 */
function estaBloqueado(dominio) {
  if (bloqueados === null) {
    try {
      const bruto = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'dados', 'bloqueados-br.txt'),
        'utf8'
      );
      const SUFIXOS = new Set(['com.br', 'net.br', 'org.br', 'com', 'net', 'org', 'br', 'bet', 'online', 'shop']);
      bloqueados = new Set(
        bruto
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && l.includes('.') && !SUFIXOS.has(l))
      );
    } catch {
      bloqueados = new Set();
    }
  }
  if (!bloqueados.size) return false;
  const partes = String(dominio).toLowerCase().replace(/^www\./, '').split('.');
  // confere o domínio e o apex: a lista guarda www.host e host separadamente
  for (let i = 0; i < Math.min(2, partes.length - 1); i += 1) {
    if (bloqueados.has(partes.slice(i).join('.'))) return true;
  }
  return false;
}

function credibilidade(dominio) {
  if (tabela === null) {
    try {
      // eslint-disable-next-line global-require
      tabela = require('../../dados/dominios.json').dominios || {};
    } catch {
      tabela = {}; // sem a tabela, só as regras de domínio valem
    }
  }
  const chave = String(dominio).toLowerCase().replace(/^www\./, '');
  const apex = chave.split('.').slice(-3).join('.');
  return (
    personalizados[chave] ||
    personalizados[apex] ||
    tabela[chave] ||
    tabela[apex] ||
    null
  );
}

const PENALIDADE = { alto: -14, satira: -10, medio: -5, confiavel: 0 };

function qualidadeDoDominio(url) {
  let dominio;
  try {
    dominio = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return { peso: 2, tipo: 'desconhecido' };
  }
  const marca = credibilidade(dominio);

  let base = { peso: 3, tipo: 'site', dominio };
  for (const [padrao, peso, tipo] of PESOS) {
    if (padrao.test(dominio)) {
      base = { peso, tipo, dominio };
      break;
    }
  }

  // a credibilidade vem primeiro: saber que um portal publica notícia falsa é
  // mais informativo que saber que ele está bloqueado
  if (!marca && estaBloqueado(dominio)) {
    return {
      ...base,
      peso: base.peso - 12,
      tipo: `${base.tipo} · bloqueado por ordem judicial no Brasil`,
      alerta: {
        risco: 'bloqueado',
        motivo: 'domínio com ordem de bloqueio no Brasil — provavelmente inacessível daqui',
      },
    };
  }

  if (!marca) return base;

  // reforço positivo: veículo verificado em corpus acadêmico ou marcado por você
  if (marca.risco === 'nenhum' || marca.risco === 'confiavel') {
    return { ...base, peso: base.peso + (marca.seu ? 6 : 3), tipo: `${base.tipo} · ${marca.reforco || marca.motivo}` };
  }

  return {
    ...base,
    peso: base.peso + (PENALIDADE[marca.risco] ?? 0),
    tipo: marca.risco === 'satira' ? 'sátira' : `${base.tipo} · ${marca.motivo}`,
    alerta: marca,
  };
}

/** Ano no caminho da URL é pista de recência antes mesmo de abrir a página. */
function pistaDeAno(url) {
  const ano = /\/(20[0-9]{2})\//.exec(String(url))?.[1];
  if (!ano) return 0;
  const idade = new Date().getFullYear() - Number(ano);
  if (idade <= 0) return 2;
  if (idade === 1) return 1;
  return idade > 4 ? -2 : 0;
}

function ordenarPorQualidade(resultados, { preferirRecente = false } = {}) {
  return resultados
    .map((r, posicao) => {
      const q = qualidadeDoDominio(r.url);
      // a posição original ainda conta: o buscador sabe algo sobre relevância
      const nota = q.peso * 2 + (preferirRecente ? pistaDeAno(r.url) * 2 : 0) - posicao * 0.3;
      return { ...r, qualidade: q.tipo, alerta: q.alerta || null, nota };
    })
    .sort((a, b) => b.nota - a.nota);
}

/* ------------------------------ subconsultas ------------------------------ */

const LIGACOES = /\s+(?:e|vs\.?|versus|ou|comparad[oa]\s+com|em\s+rela[çc][ãa]o\s+a)\s+/i;

const ENFEITES =
  /^(me\s+)?(diga|fale|conte|explique|mostre|liste|pesquise|busque|procure|compare|comparar|analise|analisar|avalie|qual\s+[ée]?|quais\s+s[ãa]o|quanto\s+[ée]|sobre)\s+/i;

/**
 * Decompõe o pedido em consultas focadas, sem chamar o modelo.
 *
 * "inflação e câmbio do Brasil em 2025" buscado como frase única devolve página
 * genérica sobre economia. Duas consultas focadas devolvem as duas coisas.
 *
 * As regras são conservadoras de propósito: só divide quando a estrutura é
 * clara, e a consulta original SEMPRE fica na lista. Divisão errada custaria
 * uma busca; não dividir custa a resposta.
 */
function subconsultas(consulta, { maximo = 3 } = {}) {
  const original = String(consulta).trim();
  const limpa = original.replace(ENFEITES, '').trim();
  if (limpa.split(/\s+/).length > 14) return [original]; // frase longa: dividir vira ruído

  // contexto comum ("do Brasil em 2025") fica no fim e é herdado pelas partes
  const partes = limpa.split(LIGACOES).map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2 || partes.length > 4) return [original];
  if (partes.some((p) => p.split(/\s+/).length > 6 || p.length < 3)) return [original];

  const ultima = partes[partes.length - 1].split(/\s+/);
  // sufixo com preposição é contexto compartilhado: "câmbio do Brasil em 2025"
  const corte = ultima.findIndex((palavra) => /^(d[aeo]s?|n[aeo]s?|em|para|entre|até|desde)$/i.test(palavra));
  const contexto = corte > 0 ? ultima.slice(corte).join(' ') : '';

  const geradas = partes.map((parte, i) => {
    const base = i === partes.length - 1 || !contexto ? parte : `${parte} ${contexto}`;
    return base.trim();
  });

  return [original, ...geradas.filter((g) => g.toLowerCase() !== original.toLowerCase())].slice(0, maximo + 1);
}

/**
 * Roda várias consultas e junta os resultados, sem repetir URL.
 *
 * Um provedor que falhou de verdade (erro, limite, sem chave) na primeira
 * subconsulta some das seguintes também — sem isso, "inflação e câmbio" virava
 * duas tentativas de Jina sem chave, duas de Marginalia estourada, etc.
 * "sem resultados" não conta como falha real aqui: é sobre o ASSUNTO da
 * consulta, pode mudar na próxima subconsulta.
 */
async function buscarVarias(consultas, opcoes = {}) {
  const vistos = new Set();
  const resultados = [];
  const usadas = [];
  const falhas = [];
  let provedor = null;
  const pular = new Set(opcoes.pular || []);

  for (const consulta of consultas) {
    const r = await buscar(consulta, { ...opcoes, pular: [...pular] });
    falhas.push(...r.falhas);
    for (const f of r.falhas) {
      if (!f.endsWith(': sem resultados')) pular.add(f.split(':')[0]);
    }
    provedor = provedor || r.provedor;
    if (!r.resultados.length) continue;
    usadas.push(consulta);

    for (const item of r.resultados) {
      const chave = item.url.replace(/[#?].*$/, '');
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      resultados.push({ ...item, consulta });
    }
  }

  return { resultados, provedor, falhas, consultas: usadas };
}

/* ------------------------------ orquestração ------------------------------ */

const CADEIA = [
  { nome: 'searxng', fn: searxng },
  { nome: 'duckduckgo', fn: duckduckgoHtml },
  { nome: 'duckduckgo-lite', fn: duckduckgoLite },
  { nome: 'marginalia', fn: marginalia },
  { nome: 'wikipedia', fn: wikipedia },
  { nome: 'jina', fn: jina },
];

/**
 * Percorre a cadeia até obter resultados suficientes.
 * Devolve também o diagnóstico de quem falhou, para aparecer na trilha.
 */
async function buscar(consulta, opcoes = {}) {
  const minimo = opcoes.minimo || 3;
  const falhas = [];
  for (const provedor of CADEIA) {
    if (opcoes.pular?.includes(provedor.nome)) continue;
    try {
      const resultados = await provedor.fn(consulta, opcoes);
      if (resultados.length >= minimo || (resultados.length && provedor.nome === 'searxng')) {
        return { resultados, provedor: provedor.nome, falhas };
      }
      if (resultados.length) return { resultados, provedor: provedor.nome, falhas };
      falhas.push(`${provedor.nome}: sem resultados`);
    } catch (err) {
      falhas.push(`${provedor.nome}: ${err.message}`);
    }
  }
  return { resultados: [], provedor: null, falhas };
}

module.exports = {
  buscar, CADEIA, searxng, saudeDaBusca, registrarSaude, duckduckgoHtml, duckduckgoLite, marginalia, wikipedia, jina,
  ordenarPorQualidade, qualidadeDoDominio, subconsultas, buscarVarias, estaBloqueado,
  definirPersonalizados,
  estatisticasDeDominios: () => {
    if (tabela === null) credibilidade('x.com');
    if (bloqueados === null) estaBloqueado('x.com');
    const contagem = {};
    for (const v of Object.values(tabela)) contagem[v.risco] = (contagem[v.risco] || 0) + 1;
    let meta = {};
    try {
      // eslint-disable-next-line global-require
      meta = require('../../dados/dominios.json');
    } catch {
      /* sem arquivo */
    }
    return {
      credibilidade: Object.keys(tabela).length,
      bloqueados: bloqueados.size,
      porRisco: contagem,
      atualizadoEm: meta.atualizadoEm || null,
      origens: meta.origens || [],
    };
  },
};
