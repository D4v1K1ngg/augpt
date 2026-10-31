'use strict';

/**
 * "Bom dia, Jarvis" (31/10, pedido do Davi): o resumo da manhã num lugar só — a data e o próximo feriado, o tempo
 * da cidade da memória, a agenda de hoje (e o que o AuGPT acompanha) e as manchetes. Junta o que já existe
 * (clima-no-chat, agenda-no-chat, calendario-no-chat); só as manchetes são novas (o RSS público da Agência Brasil; em
 * inglês, da BBC). "Bom dia" sozinho só vira resumo no começo da conversa; "resumo do dia", "como está meu dia" valem sempre.
 */

const { baixar } = require('../tools/http');
const clima = require('./clima-no-chat');
const agenda = require('./agenda-no-chat');
const { datasDoAno } = require('./calendario-no-chat');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const SAUDACAO = /^(bom dia|boa tarde|boa noite|good morning)( (jarvis|augpt|gpt))?( tudo (bem|bom|certo))?$/;
const PEDIDO = /^(me (de|da|mostra|passa|fala) )?(o )?(meu )?(resumo|briefing) (do dia|da manha|de hoje|diario)$|^(como (esta|ta|vai ser|sera) (o )?meu dia( hoje)?|qual (e )?a boa de hoje|resumo do dia|resumo da manha|morning (briefing|summary)|how does my day look)$/;
// ("o que eu tenho pra hoje?" fica com a agenda)

/** true quando é o pedido do resumo. */
function pedidoDeResumo(texto, conversa = []) {
  const t = semAcento(texto).replace(/^(ei|ok|hey)\s+/, '').replace(/^(jarvis|augpt|gpt)[,!.]?\s+/, '').replace(/[,!.?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (PEDIDO.test(t)) return { acao: 'resumo' };
  return SAUDACAO.test(t) && !conversa.length ? { acao: 'resumo', saudacao: true } : null;
}

/** As primeiras manchetes de um RSS: [{ titulo, link }]. */
function manchetesDoRss(xml, n = 4) {
  const tirar = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const out = [];
  for (const m of String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const titulo = tirar(/<title>([\s\S]*?)<\/title>/.exec(m[0])?.[1]);
    const link = tirar(/<link>([\s\S]*?)<\/link>/.exec(m[0])?.[1]);
    if (titulo && /^https:\/\//.test(link) && !out.some((x) => x.titulo === titulo)) out.push({ titulo, link });
    if (out.length >= n) break;
  }
  return out;
}

// Agência Brasil (31/10): nacional e do dia — o RSS geral do g1 vinha cheio de crime de bairro
const FEEDS = { pt: { url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', nome: 'Agência Brasil' }, en: { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', nome: 'BBC' } };

async function manchetes(en, deps) {
  const feed = FEEDS[en ? 'en' : 'pt'];
  const r = await (deps.baixar || baixar)(feed.url, { timeout: 6000, headers: { Accept: 'application/rss+xml, application/xml' } });
  if (!r?.ok) throw new Error(`HTTP ${r?.status || '?'}`);
  return { fonte: feed.nome, itens: manchetesDoRss(r.texto) };
}

/** O feriado de hoje ou o próximo nos 15 dias. */
function feriadoPerto(agora, en) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const lista = [...datasDoAno(agora.getFullYear()), ...datasDoAno(agora.getFullYear() + 1)].filter((d) => d.tipo === 'feriado');
  for (const d of lista) {
    const [a, m, dia] = d.iso.split('-').map(Number);
    const dias = Math.round((new Date(a, m - 1, dia) - hoje) / 86400000);
    if (dias < 0 || dias > 15) continue;
    const nome = en ? d.en : d.nome;
    if (dias === 0) return en ? `Today is a holiday: **${nome}**.` : `Hoje é feriado: **${nome}**.`;
    const quando = new Date(a, m - 1, dia).toLocaleDateString(en ? 'en-US' : 'pt-BR', { weekday: 'long', day: 'numeric', month: 'numeric' });
    if (dias === 1) return en ? `Tomorrow is a holiday: **${nome}**.` : `Amanhã é feriado: **${nome}**.`;
    return en ? `Next holiday: **${nome}**, ${quando} (in ${dias} days).` : `Próximo feriado: **${nome}**, ${quando} (daqui a ${dias} dias).`;
  }
  return '';
}

async function responderResumo({ pedido = {}, deps = {}, config = {}, pasta, agora = new Date() }) {
  const en = config.idiomaEfetivo === 'en';
  // as partes não escrevem na tela sozinhas: o resumo sai inteiro, na ordem
  const calado = { ...deps, emit: (e, d) => (e === 'resposta-token' ? undefined : deps.emit?.(e, d)) };
  deps.emit?.('ferramenta', { nome: 'resumo_do_dia', argumentos: {}, risco: 'leitura' });
  const cidade = clima.cidadeDaMemoria(pasta);
  const [tempo, noticias] = await Promise.all([
    cidade ? clima.responderClima({ pergunta: 'clima hoje', pedido: { quando: 'hoje', chuva: false, cidade: null }, deps: calado, config, pasta, lugares: [] }).catch(() => null) : null,
    manchetes(en, deps).catch(() => null),
  ]);
  const hora = agora.getHours();
  const ola = pedido.saudacao ? (en ? 'Good morning!' : 'Bom dia!') : hora < 12 ? (en ? 'Good morning!' : 'Bom dia!') : hora < 18 ? (en ? 'Good afternoon!' : 'Boa tarde!') : (en ? 'Good evening!' : 'Boa noite!');
  const hoje = agora.toLocaleDateString(en ? 'en-US' : 'pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const partes = [`${ola} ${en ? `Today is ${hoje}.` : `Hoje é ${hoje}.`} ${feriadoPerto(agora, en)}`.trim()];

  let cartao = '';
  if (tempo?.texto) {
    const [texto, bloco] = tempo.texto.split(/\n\n(?=```clima)/);
    partes.push(`🌤️ ${texto.trim()}`);
    cartao = bloco || '';
  } else if (!cidade) {
    partes.push(en ? '🌤️ For the weather, tell me your city: **"remember that I live in Campinas"**.' : '🌤️ Para o tempo, me diga a sua cidade: **"lembre que moro em Campinas"**.');
  }

  const daAgenda = pasta ? agenda.responderAgenda({ pedido: { acao: 'listar', periodo: 'hoje' }, deps: calado, config, pasta, agora }) : null;
  if (daAgenda?.texto) partes.push(`📅 ${daAgenda.texto}`);

  if (noticias?.itens?.length) {
    partes.push(`📰 ${en ? `Headlines (${noticias.fonte}):` : `Manchetes (${noticias.fonte}):`}\n\n${noticias.itens.map((i) => `- [${i.titulo}](${i.link})`).join('\n')}`);
  }
  const texto = `${partes.join('\n\n')}${cartao ? `\n\n${cartao}` : ''}`;
  deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
  return { ...SEM_PESQUISA, texto, modo: 'resumo', noIdioma: en };
}

module.exports = { pedidoDeResumo, manchetesDoRss, feriadoPerto, responderResumo };
