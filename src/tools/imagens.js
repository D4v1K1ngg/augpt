'use strict';

/**
 * Imagens nas respostas (2026-10-11, pedido do Davi): foto do produto ao lado
 * de cada cartão da recomendação e uma imagem de referência nas explicações.
 *
 * Como funciona:
 *   - a imagem é ACHADA pela busca de imagens do SearXNG (ou vem da Wikipédia,
 *     no caso da referência) e BAIXADA aqui, no processo principal, com as
 *     mesmas travas das páginas (rede local bloqueada, tamanho máximo);
 *   - fica gravada em `<dados do app>/imagens/` e entra na resposta como
 *     `![nome](augpt-img://arquivo.jpg)`. A tela nunca carrega imagem direto
 *     da internet: quem serve `augpt-img://` é o próprio app (electron/main.js),
 *     e o renderizador só aceita esse endereço (renderer/md.js);
 *   - só JPEG, PNG e WebP, conferidos pelos primeiros bytes. SVG fica de fora.
 *
 * Tudo aqui é "melhor esforço": sem SearXNG, sem resultado que cite o produto
 * ou com qualquer erro, a resposta sai sem imagem — nunca falha por isso.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { baixar } = require('./http');
const { conferirDestino } = require('./rede');

const ESQUEMA = 'augpt-img';
const MAX_BYTES = 1_500_000;
const TIPOS = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** Nome de arquivo aceito — o mesmo teste vale em quem serve e em quem desenha. */
const NOME_VALIDO = /^[a-z]{20,64}\.(jpg|png|webp)$/;
// miniatura de vídeo e mural de imagens não são foto do produto
const FONTES_FORA = /(ytimg\.com|youtube\.com|pinimg\.com|pinterest\.|facebook\.|fbcdn\.|instagram\.|tiktok\.)/i;

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Confere o formato pelos primeiros bytes (o cabeçalho HTTP pode mentir). */
function extensaoPelosBytes(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Nome do arquivo: hash do endereço, só com LETRAS. Sem dígito de propósito —
 * o endereço vai dentro do texto da resposta, e o verificador trataria cada
 * número do hash como "valor sem respaldo nas fontes".
 */
function nomeDoArquivo(url, ext) {
  const hex = crypto.createHash('sha1').update(String(url)).digest('hex');
  return `${hex.replace(/\d/g, (d) => 'ghijklmnop'[d])}.${ext}`;
}

/** Baixa e grava a imagem. Devolve `augpt-img://arquivo.ext` ou null. */
async function guardarImagem(url, { dir, config = {}, deps = {} } = {}) {
  if (!dir || !/^https?:\/\//i.test(String(url || ''))) return null;
  try {
    const r = await (deps.baixar || baixar)(url, {
      timeout: 8000,
      maxBytes: MAX_BYTES + 1, // 1 byte a mais: imagem cortada no limite é imagem quebrada, então recusa
      headers: { Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8' },
      conferir: (destino) => conferirDestino(destino, config),
    });
    if (!r?.ok || !r.buffer?.length || r.buffer.length > MAX_BYTES) return null;
    const ext = extensaoPelosBytes(r.buffer);
    const declarado = TIPOS[String(r.tipo || '').split(';')[0].trim().toLowerCase()];
    if (!ext || (declarado && declarado !== ext)) return null;
    const nome = nomeDoArquivo(url, ext);
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, nome);
    if (!fs.existsSync(destino)) fs.writeFileSync(destino, r.buffer);
    return `${ESQUEMA}://${nome}`;
  } catch {
    return null;
  }
}

/** Busca de imagens no SearXNG. Devolve `[{ url, titulo }]` (miniatura quando há: é leve e basta). */
async function buscarImagens(consulta, { config = {}, deps = {}, maximo = 12, grande = false } = {}) {
  const base = String(config.searxngUrl || '').replace(/\/$/, '');
  if (!base || !String(consulta || '').trim()) return [];
  try {
    const r = await (deps.baixar || baixar)(`${base}/search?q=${encodeURIComponent(consulta)}&categories=images&format=json&safesearch=1`, {
      timeout: 12000,
      headers: { Accept: 'application/json' },
    });
    if (!r?.ok) return [];
    return (JSON.parse(r.texto).results || [])
      .filter((x) => x && (x.thumbnail_src || x.img_src) && !FONTES_FORA.test(`${x.img_src || ''} ${x.url || ''}`))
      .map((x) => ({ url: String((grande ? x.img_src || x.thumbnail_src : x.thumbnail_src || x.img_src)).replace(/^\/\//, 'https://'), titulo: String(x.title || ''), pagina: /^https?:\/\//.test(String(x.url || '')) ? String(x.url) : null }))
      .slice(0, maximo);
  } catch {
    return [];
  }
}

/**
 * Palavras que identificam o item no título de uma imagem: as que têm dígito
 * ("em6l", "5080") e as demais com 3+ letras. "Simgot EM6L" → simgot, em6l.
 */
function termosDoNome(nome) {
  return semAcento(nome).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 || /\d/.test(t));
}
/** O título da imagem cita o item? Todas as palavras com dígito e a maioria das outras. */
function tituloCita(titulo, nome) {
  const t = ` ${semAcento(titulo).replace(/[^a-z0-9]+/g, ' ')} `;
  const termos = termosDoNome(nome);
  if (!termos.length) return false;
  const colado = t.replace(/ /g, '');
  if (colado.includes(termos.join(''))) return true; // o nome inteiro, com ou sem espaço ("RTX5080")
  const tem = (x) => t.includes(` ${x} `) || (/\d/.test(x) && colado.includes(x));
  const comDigito = termos.filter((x) => /\d/.test(x));
  if (!comDigito.every(tem)) return false;
  const outras = termos.filter((x) => !/\d/.test(x));
  return !outras.length || outras.filter(tem).length >= Math.ceil(outras.length / 2);
}

/** Primeira imagem da busca cujo título cita o item e que baixa direito. */
async function imagemDe(nome, { consulta = nome, config = {}, dir, deps = {}, tentativas = 3 } = {}) {
  if (config.imagensNasRespostas === false || !dir) return null;
  const candidatas = (await buscarImagens(consulta, { config, deps })).filter((c) => tituloCita(c.titulo, nome)).slice(0, tentativas);
  for (const c of candidatas) {
    const uri = await guardarImagem(c.url, { dir, config, deps });
    if (uri) return uri;
  }
  return null;
}

/** Foto de cada produto, todas ao mesmo tempo. Devolve `Map nome → augpt-img://…` (só as que achou). */
async function imagensDosProdutos(nomes, { config = {}, dir, deps = {} } = {}) {
  const achadas = new Map();
  if (config.imagensNasRespostas === false || !dir) return achadas;
  const resultados = await Promise.allSettled((nomes || []).slice(0, 8).map((nome) => imagemDe(nome, { config, dir, deps })));
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) achadas.set(nomes[i], r.value);
  });
  return achadas;
}

/**
 * Imagem de referência de um assunto: a da página da Wikipédia quando a
 * pesquisa já passou por lá (`daWikipedia`), senão a busca de imagens.
 */
async function imagemDeReferencia(assunto, { daWikipedia = [], config = {}, dir, deps = {} } = {}) {
  if (config.imagensNasRespostas === false || !dir) return null;
  for (const url of daWikipedia.filter(Boolean)) {
    const uri = await guardarImagem(url, { dir, config, deps });
    if (uri) return uri;
  }
  return imagemDe(assunto, { config, dir, deps });
}

/**
 * Várias imagens do item (Fase 4, carrossel): as candidatas cujo título cita o
 * item são baixadas ao mesmo tempo; a que falha é pulada (antes: 3 tentativas
 * e a primeira que baixasse).
 */
async function imagensDe(nome, { consulta = nome, config = {}, dir, deps = {}, n = 5, tentativas = 10 } = {}) {
  if (config.imagensNasRespostas === false || !dir) return [];
  const candidatas = (await buscarImagens(consulta, { config, deps, maximo: 30 })).filter((c) => tituloCita(c.titulo, nome)).slice(0, tentativas);
  const baixadas = await Promise.all(candidatas.map((c) => guardarImagem(c.url, { dir, config, deps }).catch(() => null)));
  return [...new Set(baixadas.filter(Boolean))].slice(0, n);
}

/** Até `n` imagens de referência do assunto: a da Wikipédia primeiro (se a pesquisa passou por lá), depois a busca. */
async function imagensDeReferencia(assunto, { daWikipedia = [], config = {}, dir, deps = {}, n = 5 } = {}) {
  if (config.imagensNasRespostas === false || !dir) return [];
  const daWiki = (await Promise.all(daWikipedia.filter(Boolean).slice(0, 2).map((url) => guardarImagem(url, { dir, config, deps }).catch(() => null)))).filter(Boolean);
  const daBusca = await imagensDe(assunto, { config, dir, deps, n });
  return [...new Set([...daWiki, ...daBusca])].slice(0, n);
}

/** `![texto](augpt-img://…)` — o texto alternativo não pode fechar o colchete nem quebrar linha. */
const marcacao = (texto, uri) => `![${String(texto || '').replace(/[[\]\n\r]/g, ' ').trim()}](${uri})`;

/** Limite de tempo: imagem é enfeite, nunca segura a resposta. */
const comLimite = (promessa, ms, padrao = null) =>
  Promise.race([Promise.resolve(promessa).catch(() => padrao), new Promise((ok) => setTimeout(ok, ms, padrao))]);

module.exports = {
  ESQUEMA, NOME_VALIDO, MAX_BYTES,
  guardarImagem, buscarImagens, imagemDe, imagensDe, imagensDosProdutos, imagemDeReferencia, imagensDeReferencia,
  tituloCita, extensaoPelosBytes, nomeDoArquivo, marcacao, comLimite,
};
