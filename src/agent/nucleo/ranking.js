'use strict';

/**
 * Seleção de trechos do núcleo de pesquisa (15/10). Junta duas notas, como a
 * busca híbrida do Open WebUI:
 *   - palavra exata (BM25): acha "Dunu Titan S", "QC 20", "27GS75Q", que a
 *     semelhança de significado acha mal;
 *   - semelhança de significado (embeddings do nomic-embed-text, como o
 *     GPT Researcher e o Perplexica): acha o trecho que fala do assunto com
 *     outras palavras.
 * Cada nota é normalizada para 0–1 e as duas valem metade. Sem embeddings
 * (modelo ausente, Ollama ocupado), fica só a palavra exata — nunca trava.
 */

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const VAZIAS = new Set('a o as os um uma de do da dos das e em no na nos nas para pra por com sem que qual quais como the of and to in for is on with what which how best'.split(' '));
const termos = (t) => normalizar(t).split(' ').filter((p) => p && !VAZIAS.has(p));

/** Corta o texto em pedaços de ~`tamanho` caracteres, com `sobra` de sobreposição, preferindo quebrar em parágrafo/frase. */
function pedacos(texto, { tamanho = 1000, sobra = 100 } = {}) {
  const t = String(texto || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const saida = [];
  let i = 0;
  while (i < t.length) {
    let fim = Math.min(t.length, i + tamanho);
    if (fim < t.length) {
      const corte = Math.max(t.lastIndexOf('\n', fim), t.lastIndexOf('. ', fim));
      if (corte > i + tamanho * 0.5) fim = corte + 1;
    }
    const p = t.slice(i, fim).trim();
    if (p.length >= 40) saida.push(p);
    if (fim >= t.length) break;
    i = Math.max(fim - sobra, i + 1);
  }
  return saida;
}

/** Nota BM25 de cada documento para a consulta. */
function bm25(consulta, documentos, { k1 = 1.5, b = 0.75 } = {}) {
  const q = [...new Set(termos(consulta))];
  const docs = documentos.map(termos);
  const media = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  return docs.map((d) => {
    const freq = new Map();
    for (const t of d) freq.set(t, (freq.get(t) || 0) + 1);
    let nota = 0;
    for (const t of q) {
      const f = freq.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      nota += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / (media || 1)));
    }
    return nota;
  });
}

function cosseno(a, b) {
  let p = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    p += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
}

const paraUm = (notas) => {
  const max = Math.max(...notas, 0);
  const min = Math.min(...notas, 0);
  return notas.map((n) => (max > min ? (n - min) / (max - min) : 0));
};

/**
 * Ordena `itens` (cada um com `.texto`) pela consulta. `embed(textos) →
 * vetores` é opcional. Devolve os itens com `.nota`, do melhor para o pior,
 * sem os quase iguais (mesmo começo de texto).
 */
async function ordenar(consulta, itens, { embed = null, peso = 0.5, maximo = Infinity } = {}) {
  if (!itens.length) return [];
  const textos = itens.map((i) => String(i.texto || ''));
  const brutas = bm25(consulta, textos);
  const palavra = paraUm(brutas);
  let sentido = null;
  let cossenos = null;
  if (embed) {
    try {
      const vetores = await embed([consulta, ...textos.map((t) => t.slice(0, 2000))]);
      if (vetores?.length === textos.length + 1) {
        cossenos = textos.map((_, i) => cosseno(vetores[0], vetores[i + 1]));
        sentido = paraUm(cossenos);
      }
    } catch {
      sentido = null; // sem embeddings: só a palavra exata
    }
  }
  // `nota` é relativa (o melhor vale 1); `semelhanca` e `palavras` são as brutas — o filtro de assunto
  // da escrita (25/10) precisa saber o quanto cada um está longe do melhor, não só a ordem
  const notas = itens.map((it, i) => ({ ...it, nota: sentido ? peso * palavra[i] + (1 - peso) * sentido[i] : palavra[i], palavras: brutas[i], semelhanca: cossenos ? cossenos[i] : null }));
  notas.sort((a, b) => b.nota - a.nota);
  const vistos = new Set();
  return notas
    .filter((it) => {
      const chave = normalizar(it.texto).slice(0, 80);
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .slice(0, maximo);
}

module.exports = { pedacos, bm25, cosseno, ordenar, termos, normalizar };
