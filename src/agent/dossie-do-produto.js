'use strict';

/**
 * Dossiê por produto (14/10). Medido na pesquisa "10 fones intra-auriculares"
 * (13/10): 521 mil caracteres lidos → 50 mil destilados (668 fatos) → o
 * redator de cada cartão recebia ~3 trechos de 150 caracteres. Com isso o 7B
 * só consegue escrever genérico ("graves envolventes e médios suaves" em 4 de
 * 5 opções). Aqui o material de cada produto é juntado de novo, de tudo que
 * foi lido: fatos destilados que citam o produto, a leitura inteira de ficha e
 * review feita para ele, e o que a comunidade disse dele.
 *
 * Cada item ganha um número de fonte [n] único na resposta inteira (a mesma
 * página citada em dois cartões tem o mesmo número), com a URL — o cartão cita
 * "[n](url)", que o renderer desenha como link.
 */

const { mencionaNome, normalizarTexto: normalizar } = require('./motor-pesquisa');

const MAXIMO_PADRAO = 3500;
// ordem de valor para a redação: ficha e review dizem o que o produto É;
// a comunidade diz como é USAR; o resto completa
const PESO_DO_TIPO = { ficha: 0, review: 1, comunidade: 2, outro: 3 };

/** As linhas de fato de uma leitura destilada ("- [2] O driver tem 10 mm."), sem o marcador de fonte do destilador. */
function fatosDaLeitura(texto) {
  return String(texto || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, '').replace(/^(\[\d+\]\s*)+/, '').trim())
    .filter((l) => l.length >= 12 && !/^nada\b/i.test(l));
}

/** Frases de um texto cru (tópico de comunidade) que citam o produto. */
function frasesQueCitam(texto, nome) {
  return String(texto || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.replace(/^\s*\[\d+ votos?\]\s*/i, '').trim())
    .filter((f) => f.length >= 25 && f.length <= 400 && mencionaNome(normalizar(f), nome));
}

function tipoDaLeitura(e) {
  if (e.tipoBusca === 'ficha' || e.tipoBusca === 'lacuna') return 'ficha';
  if (e.cru || e.tipoBusca === 'comunidade' || /reddit\.com|forum|clubedohardware|head-fi/i.test(e.url || '')) return 'comunidade';
  if (e.destilado) return 'review';
  return 'outro';
}

const fonteDe = (url, origem = '') => {
  try {
    const u = new URL(url);
    const r = /reddit\.com\/r\/([^/]+)/.exec(url);
    return r ? `r/${r[1]}` : u.hostname.replace(/^www\./, '');
  } catch {
    return String(origem || 'fonte').replace(/^pesquisar_e_ler\(|\)( \(parte.*)?$/g, '');
  }
};

/**
 * Junta o material de UM produto. Sem efeito colateral; a numeração das
 * fontes é feita depois, para todos os produtos juntos (`numerarFontes`).
 * @returns {{ nome, itens: Array<{ texto, url, fonte, tipo, votos }> }}
 */
function dossieDoProduto(nome, { entradas = [], citacoes = [], ficha = '', maximo = MAXIMO_PADRAO } = {}) {
  const candidatos = [];
  const add = (texto, { url = '', fonte = '', tipo = 'outro', votos = 0 } = {}) => {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (t.length >= 12) candidatos.push({ texto: t.slice(0, 420), url, fonte: fonte || fonteDe(url), tipo, votos: Number(votos) || 0 });
  };
  if (ficha) add(ficha, { tipo: 'ficha', fonte: 'ficha técnica' });
  for (const e of entradas) {
    if (!e || e.foraDoEscopo || e.pulado) continue;
    const tipo = tipoDaLeitura(e);
    const dele = e.opcao && normalizar(e.opcao) === normalizar(nome);
    let linhas;
    if (e.cru) linhas = frasesQueCitam(e.texto || e.bruto, nome);
    else {
      const fatos = fatosDaLeitura(e.texto);
      // leitura feita PARA este produto (ficha, review, lacuna): todos os fatos são dele
      linhas = dele ? fatos : fatos.filter((f) => mencionaNome(normalizar(f), nome));
    }
    for (const l of linhas) add(l, { url: e.url, fonte: fonteDe(e.url, e.origem), tipo });
  }
  for (const c of citacoes) add(c.texto, { url: c.url, fonte: c.fonte, tipo: 'comunidade', votos: c.votos });

  // sem repetição (o mesmo fato vem de duas leituras, a citação já estava no tópico)
  const vistos = new Set();
  const unicos = candidatos.filter((c) => {
    const chave = normalizar(c.texto).slice(0, 90);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  unicos.sort((a, b) => PESO_DO_TIPO[a.tipo] - PESO_DO_TIPO[b.tipo] || b.votos - a.votos);

  // teto, mas garantindo espaço para a comunidade: até 60% para ficha/review
  const itens = [];
  let usado = 0;
  const cabe = (c, teto) => usado + c.texto.length <= teto;
  for (const c of unicos.filter((x) => x.tipo !== 'comunidade')) if (cabe(c, maximo * 0.6)) { itens.push(c); usado += c.texto.length; }
  for (const c of unicos.filter((x) => x.tipo === 'comunidade')) if (cabe(c, maximo)) { itens.push(c); usado += c.texto.length; }
  for (const c of unicos.filter((x) => x.tipo !== 'comunidade' && !itens.includes(x))) if (cabe(c, maximo)) { itens.push(c); usado += c.texto.length; }
  itens.sort((a, b) => PESO_DO_TIPO[a.tipo] - PESO_DO_TIPO[b.tipo] || b.votos - a.votos);
  return { nome, itens };
}

/**
 * Numera as fontes de vários dossiês juntos: mesma URL, mesmo número.
 * Item sem URL (a ficha montada pelo código) não ganha número.
 * @returns {{ fontes: Array<{ n, url, fonte }> }} e escreve `n` em cada item
 */
function numerarFontes(dossies) {
  const porUrl = new Map();
  const fontes = [];
  for (const d of dossies)
    for (const it of d.itens) {
      if (!it.url) continue;
      if (!porUrl.has(it.url)) {
        porUrl.set(it.url, fontes.length + 1);
        fontes.push({ n: fontes.length + 1, url: it.url, fonte: it.fonte });
      }
      it.n = porUrl.get(it.url);
    }
  return { fontes };
}

/** O dossiê como texto para o prompt: "[n] (fonte, tipo) fato". */
function textoDoDossie(d) {
  const rotulo = { ficha: 'ficha', review: 'review', comunidade: 'quem usa', outro: 'outro' };
  return d.itens.map((it) => `${it.n ? `[${it.n}]` : '[ficha]'} (${it.fonte}, ${rotulo[it.tipo]}${it.votos ? `, ${it.votos} votos` : ''}) ${it.texto}`).join('\n');
}

module.exports = { dossieDoProduto, numerarFontes, textoDoDossie, fatosDaLeitura, frasesQueCitam, MAXIMO_PADRAO };
