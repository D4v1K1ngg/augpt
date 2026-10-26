'use strict';

const { buscar, ordenarPorQualidade, subconsultas, buscarVarias } = require('./search');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ler } = require('./extract');
const { validarUrl } = require('./http');
const { conferirDestino, hostClaramenteInterno } = require('./rede');
const { ehDaComunidade } = require('./comunidade');
const { pularSemLer } = require('../agent/escopo');

/**
 * Profundidade da pesquisa.
 *
 * Quantas fontes ler é PROCEDIMENTO, não julgamento — deixar isso com o modelo
 * é o que faz uma execução usar 2 fontes e a seguinte usar 8 para a mesma
 * pergunta. Aqui vira política, e o usuário escolhe o nível conforme o assunto.
 */
const PROFUNDIDADES = {
  normal: { minimo: 3, maximo: 6, porPagina: 3500, teto: 16000 },
  media: { minimo: 4, maximo: 8, porPagina: 3200, teto: 22000 },
  alta: { minimo: 6, maximo: 10, porPagina: 3000, teto: 30000 },
};

const politica = (config) => PROFUNDIDADES[config?.profundidadePesquisa] || PROFUNDIDADES.normal;

/** Quantas leituras simultâneas. Mais que isso irrita servidor e não acelera. */
const CONCORRENCIA = 3;

/**
 * Quantas páginas do MESMO domínio uma execução inteira pode ler.
 *
 * O filtro por domínio existia, mas era local a cada chamada: a segunda busca
 * recomeçava a contagem e relia o mesmo portal. Duas ou três buscas depois, a
 * "pesquisa em várias fontes" tinha lido o mesmo site cinco vezes.
 */
const PAGINAS_POR_DOMINIO = 2;

/**
 * Fonte da comunidade (Reddit, fórum) é outra conta (Fase A da pesquisa pela
 * comunidade, 2026-09-26): cada tópico é uma conversa diferente, com gente
 * diferente — ler 3 tópicos do Clube do Hardware NÃO é "uma fonte só" como 3
 * páginas do mesmo portal de notícia. Numa busca "site:reddit.com …" todos os
 * resultados são do mesmo domínio; com o limite de 1 por chamada, lia-se um
 * tópico só.
 */
const TOPICOS_POR_CHAMADA = 4;
// Etapa C (revisão v2, 2026-09-28): com a bateria de buscas na comunidade
// (até 11 consultas no nível extremo) + o Reddit de cada finalista, 16
// tópicos por execução esgotavam o Reddit no meio da descoberta.
const TOPICOS_POR_EXECUCAO = 40;

/**
 * Executa em lotes, preservando a ordem do resultado.
 * Com profundidade alta são 10 fontes; em sequência, a 3 segundos cada, são 30
 * segundos que viram 10.
 */
async function emLotes(itens, tamanho, tarefa) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    const lote = itens.slice(i, i + tamanho);
    saida.push(...(await Promise.all(lote.map((item, j) => tarefa(item, i + j)))));
  }
  return saida;
}

const PARADAS = new Set([
  'sobre', 'encontrou', 'alguma', 'coisa', 'algum', 'para', 'pra', 'com', 'sem', 'que',
  'qual', 'quais', 'quando', 'onde', 'como', 'por', 'e', 'ou', 'de', 'do', 'da', 'dos', 'das',
  'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'foi', 'ha', 'há', 'e', 'é', 'este', 'esta',
  'the', 'and', 'for', 'with', 'about', 'what', 'when', 'where', 'how', 'does', 'did',
]);

const semAcento = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function palavrasChave(consulta) {
  return semAcento(consulta)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !PARADAS.has(p));
}

/**
 * Corta o texto da página para caber no orçamento por página — mas cortar do
 * INÍCIO cegamente falha em página longa cujo assunto pedido fica no meio ou
 * no fim: um patch note real tem a seção "Introdução do DLSS/FSR" depois de
 * "Gameplay", "Ranked" e "Leaderboard" — a uns 75% do documento. Com o corte
 * simples, a resposta chega dizendo "a atualização não menciona DLSS/FSR"
 * quando a página inteira tinha uma seção inteira sobre isso, só que fora da
 * janela lida.
 *
 * Localiza a primeira ocorrência de algum termo da consulta; se cair fora do
 * que o corte simples já pegaria, reserva uma fatia do orçamento pro início
 * (introdução/contexto) e o resto pra uma janela ao redor desse trecho.
 */
function recortarRelevante(texto, consulta, tamanho) {
  if (texto.length <= tamanho) return texto;

  const termos = palavrasChave(consulta);
  const cabecaSimples = `${texto.slice(0, tamanho)}\n[…]`;
  if (!termos.length) return cabecaSimples;

  const corpoSemAcento = semAcento(texto);
  let indice = -1;
  for (const termo of termos) {
    const i = corpoSemAcento.indexOf(termo);
    if (i !== -1 && (indice === -1 || i < indice)) indice = i;
  }

  const orcamentoCabeca = Math.ceil(tamanho * 0.6);
  // termo não apareceu, ou já cai dentro do que o corte simples pegaria: nada a fazer
  if (indice === -1 || indice < orcamentoCabeca) return cabecaSimples;

  const orcamentoJanela = tamanho - orcamentoCabeca;
  const inicioJanela = Math.max(orcamentoCabeca, indice - Math.floor(orcamentoJanela * 0.25));
  const janela = texto.slice(inicioJanela, inicioJanela + orcamentoJanela);

  return (
    `${texto.slice(0, orcamentoCabeca)}\n[…]\n` +
    `[trecho mais adiante na página, relevante à busca "${consulta}"]\n${janela}\n[…]`
  );
}

const dominioDe = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};


/**
 * Provedor que já falhou de verdade nesta execução (erro de transporte, limite
 * de chave, sem chave) não vale tentar de novo — o erro não se resolve
 * sozinho entre uma busca e a próxima da mesma execução. "sem resultados" não
 * entra nessa lista: é sobre o assunto da consulta, não sobre o provedor.
 */
function provedoresParaPular(ctx) {
  return ctx.estado.provedoresIndisponiveis ? [...ctx.estado.provedoresIndisponiveis] : [];
}

function registrarFalhas(ctx, falhas) {
  if (!falhas || !falhas.length) return;
  ctx.estado.provedoresIndisponiveis = ctx.estado.provedoresIndisponiveis || new Set();
  for (const f of falhas) {
    if (f.endsWith(': sem resultados')) continue;
    ctx.estado.provedoresIndisponiveis.add(f.split(':')[0]);
  }
}

/** Opções de leitura de uma página — as mesmas na leitura normal e na pré-busca. */
function opcoesDeLeitura(url, ctx, { semRender = false } = {}) {
  return {
    render: semRender ? null : ctx.render,
    // Desde a Fase 1 de segurança (2026-09-23) o padrão é DESLIGADO: só
    // liga com `permitirLeitorExterno: true` explícito (Ajustes → Pesquisa na
    // web). Ligado, o endereço de cada página que falhar vai pra r.jina.ai.
    permitirExterno: ctx.config.permitirLeitorExterno === true,
    estrategia: ctx.operacional?.estrategiaDeSite(url) || null,
    conferir: (destino) => conferirDestino(destino, ctx.config),
  };
}

/* ------------------------------ cache em disco e limite de tempo ------------------------------ */

/**
 * Cache de páginas ENTRE conversas (11/10). Ficha técnica e tópico de fórum
 * mudam pouco: perguntar duas vezes sobre fones relia as mesmas 90 páginas
 * (113 s de rede numa pesquisa de 261 s). Vale por `cachePaginasDias` dias
 * (Ajustes; 0 desliga). Pedido que depende do momento — preço, oferta,
 * notícia, clima, "hoje", um ano — não LÊ do cache (a página pode ter
 * mudado), mas grava, para os próximos.
 */
const PEDIDO_DO_MOMENTO = /pre[cç]os?\b|oferta|promo[cç]|quanto custa|black friday|\bhoje\b|\bagora\b|\batual|not[ií]cia|novidade|cota[cç][aã]o|clima|previs[aã]o|\b20\d\d\b/i;
const arquivoDoCache = (ctx, chave) => path.join(ctx.dirCachePaginas, `${crypto.createHash('sha1').update(chave).digest('hex')}.json`);
const cacheLigado = (ctx) => Boolean(ctx.dirCachePaginas) && Number(ctx.config?.cachePaginasDias) > 0;

function lerDoDisco(chave, ctx) {
  if (!cacheLigado(ctx) || PEDIDO_DO_MOMENTO.test(String(ctx.objetivo || ''))) return null;
  try {
    const guardado = JSON.parse(fs.readFileSync(arquivoDoCache(ctx, chave), 'utf8'));
    const validade = Number(ctx.config.cachePaginasDias) * 86400000;
    return Date.now() - guardado.em <= validade && guardado.pagina?.texto ? guardado.pagina : null;
  } catch {
    return null;
  }
}

function gravarNoDisco(chave, pagina, ctx) {
  if (!cacheLigado(ctx) || !pagina?.texto || pagina.parcial || pagina.texto.length > 400000) return;
  try {
    fs.mkdirSync(ctx.dirCachePaginas, { recursive: true });
    // sem o buffer cru (pode ser um PDF de megabytes): o texto extraído é o que se reaproveita
    const { buffer, ...leve } = pagina;
    fs.writeFileSync(arquivoDoCache(ctx, chave), JSON.stringify({ em: Date.now(), url: chave, pagina: leve }));
    // faxina de vez em quando: o que passou da validade sai
    if (Math.random() < 0.02) {
      const validade = Number(ctx.config.cachePaginasDias) * 86400000;
      for (const nome of fs.readdirSync(ctx.dirCachePaginas)) {
        const caminho = path.join(ctx.dirCachePaginas, nome);
        if (Date.now() - fs.statSync(caminho).mtimeMs > validade) fs.rmSync(caminho, { force: true });
      }
    }
  } catch {
    /* cache é bônus: disco cheio ou sem permissão não derruba a leitura */
  }
}

/**
 * Limite de tempo por página (11/10): as páginas de uma busca são lidas em
 * lote, e o lote só termina quando a MAIS LENTA termina — uma página que
 * não carrega segurava a busca inteira (29 s numa busca de ficha, contra 3 a
 * 10 s das outras). Passou do limite, a busca segue sem ela; se ela chegar
 * depois, fica guardada para a próxima vez.
 */
async function lerComLimite(url, ctx, chave) {
  const limite = Number(ctx.config?.tempoMaximoPorPaginaMs) || 0;
  const leitura = ler(String(url), opcoesDeLeitura(url, ctx));
  if (!limite) return leitura;
  let relogio;
  const estouro = new Promise((_, falhar) => {
    relogio = setTimeout(() => falhar(new Error(`página lenta demais (mais de ${Math.round(limite / 1000)} s) — a busca seguiu sem ela`)), limite);
  });
  try {
    return await Promise.race([leitura, estouro]);
  } catch (err) {
    // a leitura continua em segundo plano; o que vier fica no cache
    leitura.then((p) => { if (p?.texto) { ctx.estado.cachePaginas?.set(chave, p); gravarNoDisco(chave, p, ctx); } }).catch(() => {});
    throw err;
  } finally {
    clearTimeout(relogio);
  }
}

/** Mesma URL lida duas vezes na mesma execução: uma requisição só.
 * A chave descarta fragmento E query string — "…?utm_source=x" e "…?utm_source=y"
 * do mesmo artigo não podiam furar o cache por causa de um parâmetro de rastreio. */
/**
 * Chave do cache de páginas (na execução e em disco, entre conversas). Tira o
 * "#" e os parâmetros de rastreio, mas MANTÉM o resto do "?" (17/10: sem ele,
 * toda busca da Amazon "/s?k=…", todo "noticia.php?id=…" e toda busca do eBay
 * virava a mesma página — a primeira lida — por vários dias).
 */
function chaveDaPagina(url) {
  const texto = String(url || '');
  try {
    const u = new URL(texto);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|gad_source$|mc_|ref$|ref_$|tag$|spm$|srsltid$|_ga$)/i.test(p)) u.searchParams.delete(p);
    }
    u.searchParams.sort();
    return u.toString().replace(/\?$/, '');
  } catch {
    return texto.replace(/#.*$/, '');
  }
}

async function lerComCache(url, ctx) {
  ctx.estado.cachePaginas = ctx.estado.cachePaginas || new Map();
  const chave = chaveDaPagina(url);
  if (ctx.estado.cachePaginas.has(chave)) {
    const guardada = ctx.estado.cachePaginas.get(chave);
    ctx.emit('cache-usado', { url: chave });
    return guardada;
  }
  // retomada (src/agent/retomada.js): página já baixada pela execução
  // interrompida desta conversa não é baixada (nem renderizada) de novo
  const retomada = ctx.retomada?.pagina?.(chave);
  if (retomada) {
    ctx.emit('cache-usado', { url: chave, retomada: true });
    ctx.estado.cachePaginas.set(chave, retomada);
    return retomada;
  }
  // pré-busca (adiantarBuscas, abaixo): página já baixada em segundo plano
  // enquanto o modelo destilava a busca anterior. Só vale a leitura completa —
  // a pré-busca não renderiza JavaScript; página parcial é lida de novo aqui,
  // com o render, como sempre
  const adiantada = ctx.estado.prePaginas?.get(chave);
  if (adiantada) {
    ctx.estado.prePaginas.delete(chave);
    const pre = await adiantada;
    if (pre?.texto && !pre.parcial) {
      ctx.emit('cache-usado', { url: chave, preBusca: true });
      ctx.estado.cachePaginas.set(chave, pre);
      ctx.retomada?.guardarPagina?.(chave, pre);
      return pre;
    }
  }
  // cache em disco, entre conversas (ver lerDoDisco, acima)
  const doDisco = lerDoDisco(chave, ctx);
  if (doDisco) {
    ctx.emit('cache-usado', { url: chave, disco: true });
    ctx.estado.cachePaginas.set(chave, doDisco);
    return doDisco;
  }
  const pagina = await lerComLimite(url, ctx, chave);
  ctx.estado.cachePaginas.set(chave, pagina);
  gravarNoDisco(chave, pagina, ctx);
  // só página que de fato trouxe conteúdo vale ser retomada (parcial também:
  // as tentativas caras, render incluído, já foram feitas e dariam no mesmo)
  if (pagina?.texto) ctx.retomada?.guardarPagina?.(chave, pagina);
  return pagina;
}

/**
 * A busca que `pesquisar_e_ler` faria para estes argumentos: as subconsultas e
 * as opções. A pré-busca usa a MESMA função — a chave casa só quando a busca
 * adiantada é exatamente a que a ferramenta faria.
 */
/**
 * Wikipédia na pesquisa (10/10, SR-71: o mesmo artigo lido em 6 línguas e
 * destilado 22 vezes): só português e inglês, cada uma uma vez por execução.
 * null = não é Wikipédia; { ler, motivo? } = a decisão.
 */
function decidirWikipedia(url, estado) {
  const m = /^https?:\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\//i.exec(String(url || ''));
  if (!m) return null;
  const lingua = m[1].toLowerCase();
  if (lingua !== 'pt' && lingua !== 'en') return { ler: false, motivo: 'Wikipédia em outra língua (só pt e en são lidas)' };
  estado.wikipediasLidas = estado.wikipediasLidas || new Set();
  if (estado.wikipediasLidas.has(lingua)) return { ler: false };
  estado.wikipediasLidas.add(lingua);
  return { ler: true };
}

function planoDaBusca({ consulta, idioma, categoria, comunidade }, ctx) {
  const regra = politica(ctx.config);
  // Uma pergunta com duas partes vira duas consultas focadas. É divisão por
  // regra, sem custo de modelo, e a consulta original sempre continua na
  // lista — dividir errado custa uma busca, não dividir custa a resposta.
  // busca na comunidade ("site:…") não se divide: a divisão perderia o site:
  const naComunidade = comunidade === true || /\bsite:/i.test(String(consulta));
  const consultas = ctx.config.subconsultas === false || naComunidade
    ? [String(consulta)]
    : subconsultas(String(consulta), { maximo: regra.minimo > 4 ? 3 : 2 });
  const lingua = idioma === 'all' ? 'all' : 'pt-BR';
  return {
    consultas,
    chave: JSON.stringify([consultas, lingua, categoria || '']),
    opcoes: (c) => ({
      searxngUrl: c.config.searxngUrl,
      marginaliaKey: c.config.marginaliaKey,
      jinaKey: c.config.jinaKey,
      ollamaKey: c.config.ollamaKey,
      pular: provedoresParaPular(c),
      idioma: lingua,
      categoria: categoria || '',
    }),
  };
}

/**
 * Pré-busca (2026-10-10, medido na pesquisa real dos 5 IEMs: 151 s de busca e
 * leitura de página + 116 s de destilação, uma coisa esperando a outra).
 * Enquanto o modelo destila o resultado de uma busca, as PRÓXIMAS buscas da
 * lista do motor já correm em segundo plano: a busca em si e o download das
 * páginas mais promissoras, num cache à parte (`prePaginas`) — não no
 * `cachePaginas`, que marca página como "já lida" e faria o `pesquisar_e_ler`
 * pular. O modelo continua em série (uma GPU); só a rede trabalha adiantado.
 *
 * Limites: no máximo `preBuscaConcorrencia` buscas adiantadas ao mesmo tempo
 * (padrão 2), até 8 por lista na fila, 5 páginas por busca, sem renderizar
 * JavaScript (página parcial é lida de novo na hora, com render). Falha da
 * pré-busca não aparece em lugar nenhum: a ferramenta faz a busca normal.
 */
const PRE_PAGINAS_POR_BUSCA = 5;
// a etapa dos finalistas tem até 10 buscas (ficha + comunidade de 5); a
// concorrência (2) é que limita quantas rodam juntas, não este teto
const PRE_BUSCAS_POR_LISTA = 8;
function adiantarBuscas(lista, ctx) {
  if (!ctx?.estado || ctx.config?.preBusca === false) return 0;
  ctx.estado.preBuscas = ctx.estado.preBuscas || new Map();
  ctx.estado.prePaginas = ctx.estado.prePaginas || new Map();
  const fila = (ctx.estado.preFila = ctx.estado.preFila || { rodando: 0, espera: [] });
  const limite = Math.max(1, Number(ctx.config?.preBuscaConcorrencia) || 2);
  const proxima = () => {
    while (fila.rodando < limite && fila.espera.length) {
      const tarefa = fila.espera.shift();
      fila.rodando += 1;
      tarefa().finally(() => {
        fila.rodando -= 1;
        proxima();
      });
    }
  };
  let agendadas = 0;
  for (const item of (lista || []).slice(0, PRE_BUSCAS_POR_LISTA)) {
    if (!item?.consulta) continue;
    const plano = planoDaBusca(item, ctx);
    if (ctx.estado.preBuscas.has(plano.chave)) continue;
    let liberar;
    let falhar;
    const entrada = { iniciada: false, cancelada: false };
    entrada.promessa = new Promise((resolve, reject) => {
      liberar = resolve;
      falhar = reject;
    });
    entrada.promessa.catch(() => {}); // ninguém esperando: sem "unhandled rejection"
    ctx.estado.preBuscas.set(plano.chave, entrada);
    fila.espera.push(async () => {
      if (entrada.cancelada) return;
      entrada.iniciada = true;
      try {
        const r = await buscarVarias(plano.consultas, plano.opcoes(ctx));
        liberar(r);
        const vistos = new Set();
        const alvos = ordenarPorQualidade(r.resultados || [], {})
          .filter((x) => {
            const chave = String(x.url).replace(/[#?].*$/, '');
            const dominio = dominioDe(x.url);
            if (ctx.estado.cachePaginas?.has(chave) || ctx.estado.prePaginas.has(chave) || pularSemLer(x.url, x.titulo) || vistos.has(dominio)) return false;
            // site que só entrega o conteúdo renderizado (Reddit; os que a memória
            // operacional aprendeu) não vale a pré-busca sem render: seria uma
            // requisição a mais no site, e a leitura de verdade faria tudo de novo
            if (/(^|\.)reddit\.com$/.test(dominio) || ctx.operacional?.estrategiaDeSite?.(x.url) === 'render-js') return false;
            vistos.add(dominio);
            return true;
          })
          .slice(0, PRE_PAGINAS_POR_BUSCA);
        await Promise.all(
          alvos.map((x) => {
            const chave = String(x.url).replace(/[#?].*$/, '');
            const p = ler(String(x.url), opcoesDeLeitura(x.url, ctx, { semRender: true })).catch(() => null);
            ctx.estado.prePaginas.set(chave, p);
            return p;
          })
        );
      } catch (err) {
        falhar(err);
      }
    });
    agendadas += 1;
  }
  // a busca ATUAL sai primeiro: a pré-busca começa um instante depois, pra
  // não disputar a conexão (nem a ordem dos pedidos) com quem já está esperando
  const atraso = Number.isFinite(ctx.config?.preBuscaAtrasoMs) ? ctx.config.preBuscaAtrasoMs : 300;
  if (agendadas) setTimeout(proxima, atraso);
  return agendadas;
}

/** A URL é do site pedido com "site:dominio" na consulta? Sem "site:" na consulta, qualquer URL serve. */
function doSitePedido(consulta, url) {
  const sites = [...String(consulta || '').matchAll(/\bsite:([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, ''));
  if (!sites.length) return true;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // endereço local não é resultado de buscador de verdade (e é onde moram os
  // servidores falsos da bancada, que fazem as vezes do reddit.com)
  if (hostClaramenteInterno(host)) return true;
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

module.exports = [
  {
    name: 'buscar_web',
    risk: 'baixo',
    description: 'Busca na web e devolve título, link e resumo dos resultados.',
    args: { consulta: 'termos de busca', limite: 'quantidade de resultados (padrão 6)' },
    async run({ consulta, limite = 6 }, ctx) {
      if (!consulta) throw new Error('Informe "consulta".');
      // guardado pro laço reaproveitar num eventual ajuste/busca de reforço —
      // é uma consulta que o próprio modelo já formulou com contexto (conversa,
      // pedido original), bem melhor que reconstruir uma do zero a partir só
      // do objetivo bruto
      ctx.estado.ultimaConsultaBusca = String(consulta);
      const { resultados, provedor, falhas } = await buscar(String(consulta), {
        searxngUrl: ctx.config.searxngUrl,
        marginaliaKey: ctx.config.marginaliaKey,
        jinaKey: ctx.config.jinaKey,
        ollamaKey: ctx.config.ollamaKey,
        pular: provedoresParaPular(ctx),
      });
      registrarFalhas(ctx, falhas);

      if (!resultados.length) {
        throw new Error(
          `Nenhum provedor de busca respondeu. Detalhes — ${falhas.join(' | ')}. ` +
            'Verifique a conexão ou configure uma instância SearXNG nos ajustes.'
        );
      }

      ctx.emit('fonte', { tipo: 'busca', provedor, falhas, consultas: [String(consulta)] });
      const lista = resultados.slice(0, Math.min(Number(limite) || 6, 12));
      const aviso = falhas.length ? `[provedor: ${provedor} · reservas usadas após ${falhas.length} falha(s)]\n\n` : '';
      return (
        aviso +
        lista.map((r, i) => `${i + 1}. ${r.titulo}\n   ${r.url}\n   ${r.resumo || '(sem resumo)'}`).join('\n\n')
      );
    },
  },

  {
    name: 'abrir_pagina',
    risk: 'baixo',
    description: 'Abre uma URL e devolve o texto do conteúdo, sem menus nem anúncios.',
    args: { url: 'endereço completo com https://', limite: 'máximo de caracteres (padrão 9000)' },
    async run({ url, limite = 9000 }, ctx) {
      validarUrl(url);

      const pagina = await lerComCache(String(url), ctx);
      ctx.emit('fonte', { tipo: 'leitura', provedor: pagina.via, url: pagina.url || url, tentativas: pagina.tentativas });

      const max = Math.min(Number(limite) || 9000, 24000);
      const cabecalho = [
        pagina.titulo ? `# ${pagina.titulo}` : '',
        `[extraído via ${pagina.via}${pagina.parcial ? ' · parcial' : ''}]`,
        pagina.listagem
          ? '⚠ Isto parece ser uma página de índice/capa (lista de manchetes de assuntos ' +
            'diferentes), não uma matéria única — trate cada linha como uma notícia separada, ' +
            'não como um texto corrido sobre um assunto só.'
          : '',
        '',
      ]
        .filter(Boolean)
        .join('\n');

      const corpo =
        pagina.texto.length > max
          ? `${pagina.texto.slice(0, max)}\n\n[...truncado: ${pagina.texto.length - max} caracteres restantes]`
          : pagina.texto;

      // registrada como fonte lida: é isso que permite ao laço destilar esta
      // leitura a partir do texto COMPLETO (pagina.texto, sem o corte de
      // `max` acima), não do que foi devolvido aqui pro modelo de decisão ver
      ctx.estado.fontesLidas = ctx.estado.fontesLidas || [];
      ctx.estado.fontesLidas.push({
        numero: ctx.estado.fontesLidas.length + 1,
        url: pagina.url || url,
        dominio: dominioDe(pagina.url || url),
        titulo: pagina.titulo || '',
        data: pagina.data || null,
        texto: corpo,
        textoCompleto: pagina.texto,
        listagem: !!pagina.listagem,
      });

      return `${cabecalho}\n${corpo}`;
    },
  },

  {
    name: 'pesquisar_e_ler',
    risk: 'baixo',
    description:
      'Busca na web e já lê as páginas mais promissoras de uma vez. Use quando precisar de conteúdo, não só de links.',
    args: {
      consulta: 'termos de busca',
      paginas: 'quantidade de fontes; o limite real vem da profundidade configurada',
      caracteres_por_pagina: 'tamanho de cada trecho',
      idioma: 'opcional: "pt-BR" (padrão) ou "all" para incluir resultados em outros idiomas',
    },
    async run({ consulta, paginas, caracteres_por_pagina, idioma, categoria, comunidade }, ctx) {
      if (!consulta) throw new Error('Informe "consulta".');
      // mesmo motivo do buscar_web: fica disponível pro laço reaproveitar
      // numa busca de reforço, em vez de reconstruir do zero a partir do
      // objetivo (que pode não ter o assunto — ex: "e quanto ao FSR?" não
      // menciona PUBG, mas esta consulta, formulada com o histórico, tem)
      ctx.estado.ultimaConsultaBusca = String(consulta);

      // A política manda; o argumento do modelo só pode reduzir dentro dela.
      const regra = politica(ctx.config);
      const quantas = Math.max(regra.minimo, Math.min(Number(paginas) || regra.maximo, regra.maximo));
      const corte = Math.min(Number(caracteres_por_pagina) || regra.porPagina, 4000);

      const plano = planoDaBusca({ consulta, idioma, categoria, comunidade }, ctx);
      // pré-busca: esta mesma busca já pode ter sido feita em segundo plano
      let busca = null;
      const adiantada = ctx.estado.preBuscas?.get(plano.chave);
      if (adiantada) {
        ctx.estado.preBuscas.delete(plano.chave);
        // ainda na fila (não começou): não espera — cancela e busca agora
        if (!adiantada.iniciada) adiantada.cancelada = true;
        else {
          busca = await adiantada.promessa.catch(() => null);
          if (busca?.resultados?.length) ctx.emit('prebusca-usada', { consulta: String(consulta) });
          else busca = null;
        }
      }
      const { resultados, provedor, falhas, consultas: usadas } = busca || (await buscarVarias(plano.consultas, plano.opcoes(ctx)));
      registrarFalhas(ctx, falhas);
      if (!resultados.length) {
        throw new Error(`Nenhum provedor de busca respondeu. Detalhes — ${falhas.join(' | ')}`);
      }
      ctx.emit('fonte', { tipo: 'busca', provedor, falhas, consultas: usadas });

      // Oito páginas do mesmo portal são UMA fonte. Diversidade de domínio vale
      // mais que quantidade de links.
      // pedido que fala em "atual", "hoje" ou cita um ano prefere página recente
      const preferirRecente = /\b(atual|atualizad|hoje|agora|recente|últim|ultim|20\d\d)\b/i.test(consulta);
      const ordenados = ordenarPorQualidade(resultados, { preferirRecente });

      // a contagem vive na execução, não na chamada
      ctx.estado.dominiosLidos = ctx.estado.dominiosLidos || new Map();
      const jaLidos = ctx.estado.dominiosLidos;
      const paginasCache = ctx.estado.cachePaginas;
      const nestaChamada = new Map();

      const candidatos = ordenados.filter((r) => {
        // uma busca parecida com a anterior traz os mesmos resultados no topo —
        // se essa URL exata já foi lida nesta execução, gastar um dos 2 slots do
        // domínio nela de novo é desperdício: não traz informação nova nenhuma.
        const chaveUrl = r.url.replace(/[#?].*$/, '');
        if (paginasCache?.has(chaveUrl)) return false;
        // Etapa D (14º teste real): resultado de busca que é página inicial,
        // índice de fórum/subreddit, rede social, login, canal ou agenda nem é
        // lido — não responde pergunta nenhuma e custa leitura + destilação
        // "site:reddit.com …": buscador que ignora o operador devolve qualquer
        // coisa. Execução real de 11/10 (SearXNG com bing/yahoo): "site:reddit.com
        // Simgot EM6L" trouxe tim.com.br, e "site:reddit.com r/PUBATTLEGROUNDS
        // best IEM", páginas da linguagem R — todas lidas e destiladas à toa.
        if (!doSitePedido(consulta, r.url)) {
          ctx.emit('descarte', { etapa: 'pagina', alvo: r.url, motivo: 'fora do site pedido na busca' });
          return false;
        }
        const inutil = pularSemLer(r.url, r.titulo);
        if (inutil) {
          ctx.emit('descarte', { etapa: 'pagina', alvo: r.url, motivo: `página do tipo "${inutil}" não é lida` });
          return false;
        }

        // 10/10 (SR-71): a mesma busca leu a Wikipédia em 6 línguas (en, pt,
        // es, fr, ru, simple) — 22 destilações do mesmo artigo. Só português e
        // inglês, e cada uma uma vez por execução.
        const wiki = decidirWikipedia(r.url, ctx.estado);
        if (wiki) {
          if (wiki.motivo) ctx.emit('descarte', { etapa: 'pagina', alvo: r.url, motivo: wiki.motivo });
          return wiki.ler;
        }

        const dominio = dominioDe(r.url);
        const topico = ehDaComunidade(r.url, ctx.config);
        const porChamada = topico ? TOPICOS_POR_CHAMADA : 1;
        const porExecucao = topico ? TOPICOS_POR_EXECUCAO : PAGINAS_POR_DOMINIO;
        if ((nestaChamada.get(dominio) || 0) >= porChamada) return false;
        if ((jaLidos.get(dominio) || 0) >= porExecucao) return false;
        nestaChamada.set(dominio, (nestaChamada.get(dominio) || 0) + 1);
        return true;
      });

      // domínio nunca lido vem primeiro: diversidade é o objetivo da busca
      candidatos.sort((a, b) => (jaLidos.get(dominioDe(a.url)) || 0) - (jaLidos.get(dominioDe(b.url)) || 0));

      // lê algumas a mais: parte falha, e é melhor descobrir isso em paralelo
      // Nenhum candidato novo significa que os domínios já foram lidos — e isso
      // não é falha de leitura. Devolver erro aqui mandava o modelo tentar de
      // novo, quando o certo é dizer que a fonte se esgotou.
      if (!candidatos.length) {
        return (
          `Busca: "${consulta}" · nenhum domínio NOVO nos resultados.\n\n` +
          `Já foram lidas ${[...jaLidos.keys()].length} fonte(s) nesta execução: ${[...jaLidos.keys()]
            .slice(0, 10)
            .join(', ')}.\n` +
          'Os resultados desta busca repetem domínios já consultados. Ou responda com o material que já tem, ' +
          'ou busque por um ângulo diferente do assunto — repetir a mesma consulta trará os mesmos sites.'
        );
      }

      const alvos = candidatos.slice(0, Math.min(quantas + 3, candidatos.length));

      const lidasEmParalelo = await emLotes(alvos, CONCORRENCIA, async (resultado) => {
        try {
          const pagina = await lerComCache(resultado.url, ctx);
          return { resultado, pagina };
        } catch (err) {
          return { resultado, erro: err.message };
        }
      });

      const partes = [
        `Busca: ${usadas.map((c) => `"${c}"`).join(' + ')} · provedor: ${provedor} · profundidade: ${
          ctx.config.profundidadePesquisa || 'normal'
        } (${regra.minimo}–${regra.maximo} fontes)\n`,
      ];
      const lidasComSucesso = [];
      let lidas = 0;

      for (const item of lidasEmParalelo) {
        if (lidas >= quantas) break;
        if (item.erro) {
          partes.push(`--- FALHOU: ${item.resultado.url}\n${item.erro}`);
          continue;
        }

        const { pagina, resultado } = item;
        lidas += 1;
        ctx.emit('fonte', { tipo: 'leitura', provedor: pagina.via, url: resultado.url, tentativas: pagina.tentativas });

        const trecho = recortarRelevante(pagina.texto, resultado.consulta || consulta, corte);
        const dominioAtual = dominioDe(resultado.url);
        jaLidos.set(dominioAtual, (jaLidos.get(dominioAtual) || 0) + 1);

        const marca = resultado.alerta || null;
        if (marca) ctx.emit('fonte-marcada', { url: resultado.url, risco: marca.risco, motivo: marca.motivo });

        lidasComSucesso.push({
          alerta: marca,
          listagem: !!pagina.listagem,
          numero: (ctx.estado.fontesLidas || []).length + lidas,
          url: resultado.url,
          dominio: dominioDe(resultado.url),
          titulo: pagina.titulo || resultado.titulo,
          data: pagina.data || null,
          texto: trecho,
          // texto COMPLETO da página, sem o corte por página (`corte`/`regra.porPagina`)
          // — é o que o laço usa pra destilar esta fonte individualmente, sem perder
          // o que ficou fora do recorte montado pro modelo de decisão ver
          textoCompleto: pagina.texto,
        });

        const numero = lidasComSucesso[lidasComSucesso.length - 1].numero;
        partes.push(
          `--- FONTE ${numero}: ${pagina.titulo || resultado.titulo}\n${resultado.url}\n` +
            `(domínio ${dominioDe(resultado.url)}${resultado.qualidade ? ` · ${resultado.qualidade}` : ''} · via ${pagina.via}${
              pagina.data ? ` · publicado ${pagina.data}` : ''
            })${
              marca ? `\n⚠ ATENÇÃO: ${marca.motivo}. Trate esta fonte com reserva e não a use como única base.` : ''
            }${
              pagina.listagem
                ? '\n⚠ PÁGINA DE ÍNDICE/CAPA: isto é uma lista de manchetes de assuntos diferentes, ' +
                  'NÃO uma matéria única. Trate cada linha como uma notícia separada — não junte ' +
                  'pedaços dela num só fato como se fossem sobre o mesmo assunto.'
                : ''
            }\n\n${trecho}`
        );
        if (partes.join('').length > regra.teto) break;
      }

      if (lidas < regra.minimo && lidas > 0) {
        partes.push(
          `\n[apenas ${lidas} de ${regra.minimo} fontes mínimas foram lidas — os domínios restantes falharam, ` +
            `repetiram, ou já haviam sido lidos nesta execução (${[...jaLidos.keys()].slice(0, 8).join(', ')})]`
        );
      }
      ctx.estado.fontesLidas = [...(ctx.estado.fontesLidas || []), ...lidasComSucesso];

      if (!lidas) throw new Error('Encontrei resultados mas não consegui ler nenhuma das páginas.');
      return partes.join('\n\n');
    },
  },
];

module.exports.PROFUNDIDADES = PROFUNDIDADES;
module.exports.adiantarBuscas = adiantarBuscas;
module.exports.doSitePedido = doSitePedido;
module.exports.lerComCache = lerComCache;
module.exports.planoDaBusca = planoDaBusca;
module.exports.decidirWikipedia = decidirWikipedia;
module.exports.recortarRelevante = recortarRelevante;
module.exports.chaveDaPagina = chaveDaPagina;
