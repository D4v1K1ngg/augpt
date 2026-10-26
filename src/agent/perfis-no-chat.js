'use strict';

/**
 * Perfis e nomes (27/10, pedido do Davi): "procure o perfil de Fulano no Instagram", "ache o Instagram do
 * Fulano", "procure pelo nome Fulano de Tal e veja o que acha". O código busca dentro de cada rede
 * (site:instagram.com "Fulano"…) e na web, e monta a resposta: os perfis públicos achados (link, @ e o
 * que o resultado mostra) e as menções na web, sempre com o link.
 *
 * Limite combinado: achar perfil e contato PÚBLICO — nunca juntar endereço, telefone, família ou rotina
 * de alguém num dossiê. Por isso a resposta é a lista do buscador, sem o modelo resumir "quem é a pessoa".
 * Só links da própria rede: sites que copiam perfis alheios (picmany, viralist…) ficam de fora.
 */

const search = require('../tools/search');

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const REDES = {
  instagram: { nome: 'Instagram', dominio: 'instagram.com', fala: /\b(instagram|insta|ig)\b/, perfil: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|reels\/|explore\/|stories\/|accounts\/|tv\/)([A-Za-z0-9._]{1,30})\/?(\?.*)?$/ },
  facebook: { nome: 'Facebook', dominio: 'facebook.com', fala: /\b(facebook|face|fb)\b/, perfil: /^https?:\/\/(www\.|m\.|pt-br\.)?facebook\.com\/(?!groups\/|events\/|watch|share|photo|story|sharer|hashtag|marketplace)(people\/[^/?]+\/\d+|profile\.php\?id=\d+|[A-Za-z0-9.]{3,60})\/?(\?.*)?$/ },
  x: { nome: 'X (Twitter)', dominio: 'x.com', outros: ['twitter.com'], fala: /\b(twitter|tuiter|x)\b/, perfil: /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/(?!i\/|search|hashtag|home|explore|intent)([A-Za-z0-9_]{1,15})\/?(\?.*)?$/ },
  linkedin: { nome: 'LinkedIn', dominio: 'linkedin.com/in', fala: /\b(linkedin|linked in)\b/, perfil: /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/([^/?]+)\/?(\?.*)?$/ },
  tiktok: { nome: 'TikTok', dominio: 'tiktok.com', fala: /\b(tiktok|tik tok)\b/, perfil: /^https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,24})\/?(\?.*)?$/ },
  youtube: { nome: 'YouTube', dominio: 'youtube.com', fala: /\b(youtube|canal no youtube)\b/, perfil: /^https?:\/\/(www\.)?youtube\.com\/(@[A-Za-z0-9._-]{3,30}|c\/[^/?]+|channel\/[A-Za-z0-9_-]+)\/?(\?.*)?$/ },
};
const QUALQUER_REDE = /\b(instagram|insta|facebook|face|twitter|tuiter|linkedin|linked in|tiktok|tik tok|youtube|rede social|redes sociais)\b/;

// "perfil de Fulano no Instagram", "o Instagram do Fulano", "procure pelo nome Fulano de Tal"
const PEDIDO_PERFIL = /\b(procur\w*|pesquis\w*|busc\w*|busqu\w*|ach\w*|encontr\w*|localiz\w*|consult\w*|ve(ja|r)|mostr\w*)\b.*\b(perfil|perfis|conta|contas|instagram|insta|facebook|twitter|linkedin|tiktok)\b/;
const PEDIDO_NOME = /\b(procur\w*|pesquis\w*|busc\w*|busqu\w*|consult\w*|ach\w*)\s+(pelo|o|por|esse|este)?\s*nome\b/;

/** O nome da pessoa no pedido, ou null. */
function nomeDoPedido(texto) {
  let t = String(texto || '').replace(/[“”"'‘’]/g, ' ');
  const corte = [
    /^.*?\b(?:pelo|o|por|esse|este)?\s*nome\s+(?:d[aoe]\s+)?/i,
    /^.*?\b(?:perfil|perfis|conta|contas)\s+(?:d[aoe]s?\s+|chamad[oa]\s+)?(?:(?:instagram|insta|facebook|face|twitter|x|linkedin|tiktok|youtube)\s+(?:d[aoe]\s+)?)?/i,
    /^.*?\b(?:instagram|insta|facebook|face|twitter|linkedin|tiktok|youtube)\s+d[aoe]\s+/i,
  ].find((r) => r.test(t));
  if (!corte) return null;
  t = t.replace(corte, '');
  t = t.split(/\s+(?:no|na|nas|nos|em|pelo|pela)\s+(?:instagram|insta|facebook|face|twitter|x|linkedin|tiktok|youtube|internet|web|google|redes?\s+socia\w*)\b|\s+e\s+(?:veja|me\s+diga|diga|mostre|me\s+mostre|traga)\b|[?!.,;:]|\s+-\s+/i)[0];
  t = t.replace(/^(?:o|a|os|as|um|uma|do|da|de|dos|das|seu|sua)\s+/i, '').replace(/\s+/g, ' ').trim();
  const palavras = t.split(' ');
  if (palavras.length < 1 || palavras.length > 6 || t.length < 3 || t.length > 70) return null;
  if (!/^[\p{L}@][\p{L}\d.'_ -]*$/u.test(t)) return null;
  return t;
}

/** { nome, redes: [chaves] } quando é um pedido de perfil ou de nome; senão null. */
function pedidoDePerfil(texto) {
  const n = norm(texto);
  if (!PEDIDO_PERFIL.test(n) && !PEDIDO_NOME.test(n)) return null;
  // "perfil de consumo", "conta de luz": precisa de rede ou da palavra "nome"/"perfil" com um nome próprio
  const nome = nomeDoPedido(texto);
  if (!nome) return null;
  const temMaiuscula = /\p{Lu}/u.test(nome) || /^@/.test(nome);
  if (!QUALQUER_REDE.test(n) && !PEDIDO_NOME.test(n) && !temMaiuscula) return null;
  const citadas = Object.entries(REDES).filter(([, r]) => r.fala.test(n.replace(/\bx\b(?! \(|\.com)/g, (m, i) => (/(no|na|do|da) $/.test(n.slice(Math.max(0, i - 3), i)) ? m : '')))).map(([k]) => k);
  return { nome, redes: citadas.length ? citadas : Object.keys(REDES), geral: !citadas.length };
}

const usuarioDe = (chave, url) => {
  const m = REDES[chave].perfil.exec(url);
  if (!m) return null;
  const parte = m.slice(2).find((x) => x && !/^(www\.|m\.)/.test(x) && x !== 'x' && x !== 'twitter' && !x.startsWith('?')) || '';
  return parte.replace(/^@/, '').replace(/\/$/, '');
};

/**
 * Busca e monta a resposta. `buscar(q)` → { resultados }. Só links da própria rede; um por usuário.
 */
async function procurarPerfis({ nome, redes, geral }, { buscar }) {
  const pular = ['ollama', 'wikipedia', 'marginalia']; // o Ollama ignora "site:" e traz sites-espelho
  const termo = nome.replace(/^@/, '');
  const consultas = redes.map((k) => ({ k, q: `site:${REDES[k].dominio} "${termo}"` }));
  const tarefas = consultas.map(({ k, q }) => buscar(q, { pular }).then((r) => ({ k, r })).catch(() => ({ k, r: { resultados: [] } })));
  if (geral) tarefas.push(buscar(`"${termo}"`, {}).then((r) => ({ k: 'web', r })).catch(() => ({ k: 'web', r: { resultados: [] } })));
  const respostas = await Promise.all(tarefas);
  // o resultado tem que citar a pessoa (27/10: "Fernanda Ezabella" veio numa busca por "Casimiro Miguel"):
  // a maioria das palavras do nome no título, no resumo ou no endereço
  const palavras = norm(termo).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const citaONome = (x) => {
    const onde = norm(`${x.titulo} ${x.resumo} ${x.url}`).replace(/[^a-z0-9]+/g, ' ');
    const achadas = palavras.filter((w) => onde.includes(w)).length;
    return palavras.length ? achadas >= Math.ceil(palavras.length / 2) : true;
  };
  const perfis = [];
  const vistos = new Set();
  let web = [];
  for (const { k, r } of respostas) {
    for (const x of r.resultados || []) {
      if (k === 'web') continue;
      const user = usuarioDe(k, x.url);
      if (!user || vistos.has(`${k}:${user.toLowerCase()}`) || !citaONome(x)) continue;
      vistos.add(`${k}:${user.toLowerCase()}`);
      perfis.push({ rede: k, user, url: x.url.replace(/\?.*$/, ''), titulo: x.titulo || '', resumo: x.resumo || '' });
    }
    if (k === 'web') web = (r.resultados || []).filter((x) => citaONome(x) && !Object.values(REDES).some((rd) => x.url.includes(rd.dominio.split('/')[0])));
  }
  return { perfis, web: web.slice(0, 6) };
}

// "no Instagram e no TikTok"
const noAsRedes = (redes) => { const n = redes.map((k) => `no ${REDES[k].nome}`); return n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}` : n[0]; };
const limpo = (t, max) => String(t || '').replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim().slice(0, max);

function montarResposta({ nome, redes, geral }, { perfis, web }) {
  const linhas = [];
  const porRede = (k) => perfis.filter((p) => p.rede === k).slice(0, 5);
  const achadas = redes.filter((k) => porRede(k).length);
  if (!perfis.length && !web.length) {
    return `Não achei perfis públicos de **${nome}** ${geral ? 'nas redes nem na web' : noAsRedes(redes)}. Pode ser um perfil privado, um nome escrito de outro jeito, ou o buscador ainda não ter registrado a página. Tente com o @ (se souber) ou com uma pista junto (cidade, profissão, empresa).`;
  }
  const mostrados = achadas.reduce((s, k) => s + porRede(k).length, 0);
  linhas.push(`Procurei **${nome}** ${geral ? 'nas redes sociais e na web' : noAsRedes(redes)}. ${mostrados ? `${mostrados === 1 ? 'Achei 1 perfil público que pode ser essa pessoa' : `Achei ${mostrados} perfis públicos que podem ser essa pessoa`} — confira pela foto e pela descrição:` : 'Não achei perfil nas redes procuradas.'}`);
  for (const k of achadas) {
    linhas.push(`\n**${REDES[k].nome}**`);
    for (const p of porRede(k)) {
      const desc = limpo(p.resumo || p.titulo, 160);
      linhas.push(`- [${k === 'linkedin' || k === 'facebook' ? limpo(p.titulo, 60) || p.user : `@${p.user}`}](${p.url})${desc ? ` — ${desc}` : ''}`);
    }
  }
  const semNada = redes.filter((k) => !porRede(k).length);
  if (achadas.length && semNada.length && !geral) linhas.push(`\nNada encontrado em: ${semNada.map((k) => REDES[k].nome).join(', ')}.`);
  if (web.length) {
    linhas.push('\n**Na web**');
    for (const w of web) linhas.push(`- [${limpo(w.titulo, 80) || w.url}](${w.url})${w.resumo ? ` — ${limpo(w.resumo, 140)}` : ''}`);
  }
  linhas.push('\n*Só aparece o que é público e o buscador já registrou: perfil privado não aparece. Nome comum pode ser de outra pessoa — uma pista (cidade, profissão, empresa) ajuda.*');
  return linhas.join('\n');
}

async function responderPerfis({ pergunta, config = {}, deps = {}, pedido = pedidoDePerfil(pergunta) }) {
  const emit = deps.emit || (() => {});
  if (!pedido) return null;
  const opcoes = { searxngUrl: config.searxngUrl, marginaliaKey: config.marginaliaKey, jinaKey: config.jinaKey, ollamaKey: config.ollamaKey, idioma: 'all' };
  emit('ferramenta', { nome: 'buscar_perfis', argumentos: { nome: pedido.nome, redes: pedido.redes.map((k) => REDES[k].nome).join(', ') }, risco: 'leitura' });
  const buscar = deps.buscarPerfis || ((q, extra) => search.buscar(q, { ...opcoes, ...extra, minimo: 1 }));
  const achados = await procurarPerfis(pedido, { buscar });
  for (const p of achados.perfis) emit('fonte', { tipo: 'leitura', provedor: 'busca', url: p.url });
  const texto = montarResposta(pedido, achados);
  emit('resposta-token', { pedaco: texto });
  return { fontes: [], produto: false, assuntos: [], buscou: true, entendimento: { precisaBuscar: true, assuntos: [], pergunta }, modo: 'perfis', texto };
}

module.exports = { pedidoDePerfil, nomeDoPedido, procurarPerfis, montarResposta, responderPerfis, REDES };
