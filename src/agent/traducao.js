'use strict';

/**
 * O AuGPT em inglês, fase 2 (23/10): as rotas do código (teste de internet, consulta do PC, lista de
 * utilitários, memória, imagens…) reconhecem e escrevem português. Em vez de duplicar cada detector e
 * cada texto, com a tela em inglês:
 *  - paraPortugues: o pedido em inglês que nenhuma rota reconheceu vira português (chamada curta ao
 *    modelo) só para escolher a rota — "how much free space does my pc have?" → consulta do PC;
 *  - paraIngles: a resposta montada pelo código é traduzida pelo modelo, em streaming. Tabelas de
 *    código, imagens, gráficos, links e as ofertas ("Posso testar…") viram marcadores ⟦n⟧ que voltam
 *    no lugar; se um marcador se perder, fica o texto original (melhor em português que quebrado).
 */

const ROTULO = (n) => `⟦${n}⟧`;

/** Pedido que parece inglês (e não português): só esses passam pela tradução de entrada. */
function pareceIngles(texto) {
  const t = ` ${String(texto || '').toLowerCase()} `;
  const en = (t.match(/\b(the|my|what|how|is|are|do|does|can|could|you|me|show|test|search|find|remember|forget|which|where|why|please|i|it|of|to|and|for|with|images?|photos?|pictures?)\b/g) || []).length;
  const pt = (t.match(/\b(o|a|os|as|meu|minha|qual|como|que|voce|você|é|está|tem|de|do|da|para|pra|um|uma|não|nao|eu|me)\b/g) || []).length;
  // pedido curto ("measure my ping") com uma palavra em inglês e nenhuma em português também conta
  const palavras = t.trim().split(/\s+/).length;
  return en > pt && (en >= 2 || (pt === 0 && palavras <= 5));
}

/**
 * Troca o que não pode ser traduzido por ⟦n⟧. `fixos`: [[português, inglês]] — frases do código com
 * versão em inglês pronta (as ofertas), que voltam já traduzidas.
 */
/** Num bloco ```chart, só o título, os nomes das séries e as categorias são texto (`traduzir` = dicionário da tela). */
function graficoTraduzido(bloco, traduzir) {
  const m = /^```chart\n([\s\S]*?)\n```$/.exec(bloco);
  if (!m || !traduzir) return bloco;
  try {
    const g = JSON.parse(m[1]);
    if (g.title) g.title = traduzir(g.title);
    if (Array.isArray(g.labels)) g.labels = g.labels.map((l) => (typeof l === 'string' ? traduzir(l) : l));
    for (const d of g.datasets || []) if (d.label) d.label = traduzir(d.label);
    return `\`\`\`chart\n${JSON.stringify(g)}\n\`\`\``;
  } catch {
    return bloco;
  }
}

function proteger(texto, fixos = [], traduzirFixo = null) {
  const trechos = [];
  let s = String(texto || '');
  const guardar = (original, depois = original) => {
    trechos.push(depois);
    return ROTULO(trechos.length - 1);
  };
  for (const [pt, en] of fixos) if (pt && s.includes(pt)) s = s.split(pt).join(guardar(pt, en));
  s = s
    .replace(/```[\s\S]*?```/g, (m) => guardar(m, graficoTraduzido(m, traduzirFixo))) // blocos de código e ```chart (o gráfico volta com o título em inglês)
    .replace(/[⁢⁣][^⁢⁣]*[⁢⁣]/g, (m) => guardar(m)) // marcadores de gráfico do núcleo
    .replace(/!\[[^\]]*\]\([^)]+\)/g, (m) => guardar(m)) // imagens
    .replace(/\[(?:\(\d{1,3}\))\]\([^)]+\)/g, (m) => guardar(m)) // citações [(n)](url)
    .replace(/\]\((https?:\/\/[^)\s]+)\)/g, (m) => `](${guardar(m.slice(2, -1))})`) // o endereço dos links (o texto do link é traduzido)
    .replace(/`[^`\n]+`/g, (m) => guardar(m)) // código em linha
    .replace(/https?:\/\/[^\s)<>]+/g, (m) => guardar(m)); // endereços soltos
  return { texto: s, trechos };
}

function restaurar(texto, trechos) {
  return String(texto || '').replace(/⟦(\d+)⟧/g, (m, n) => (trechos[Number(n)] !== undefined ? trechos[Number(n)] : m));
}

/** Todos os marcadores voltaram, cada um uma vez? */
function marcadoresInteiros(traduzido, trechos) {
  for (let i = 0; i < trechos.length; i += 1) if (String(traduzido).split(ROTULO(i)).length !== 2) return false;
  return true;
}

/** O pedido em português, para escolher a rota. `chamar` = deps.chamar do núcleo. Falhou: null. */
async function paraPortugues(pedido, chamar) {
  try {
    const r = await chamar(
      [{ role: 'user', content: `Traduza este pedido para português do Brasil, do jeito que um brasileiro escreveria. Responda só com o pedido traduzido, sem aspas.\n\n${pedido}` }],
      { numPredict: 160 }
    );
    const t = String(r?.content || '').trim().replace(/^["'“]|["'”]$/g, '');
    return t && t.length < 600 ? t : null;
  } catch {
    return null;
  }
}

const INSTRUCAO = `Translate the user's text from Portuguese to English (en-US).
- Keep the markdown exactly: headings, lists, tables, bold, line breaks.
- Keep every marker like ⟦3⟧ exactly as it is, in the same place. Do not translate, remove or add markers.
- Keep numbers, units, names of programs, devices and sites as they are.
- Output only the translation, nothing before or after.`;

/**
 * A resposta em inglês, em streaming. `escrever(messages, onToken)` = deps.escrever do núcleo;
 * `onPedaco` recebe o texto já restaurado (sem ⟦n⟧ pela metade). Devolve o texto final; se a
 * tradução falhar ou perder marcador, devolve o original e avisa com `onFalha`.
 */
async function paraIngles(texto, { escrever, onPedaco = () => {}, fixos = [], onFalha = () => {}, traduzirFixo = null } = {}) {
  const { texto: protegido, trechos } = proteger(texto, fixos, traduzirFixo);
  let bruto = '';
  let emitido = '';
  const soltar = (fim = false) => {
    // segura um marcador ainda incompleto no fim ("⟦1")
    const pronto = fim ? bruto : bruto.replace(/⟦\d*$/, '');
    const restaurado = restaurar(pronto, trechos);
    if (restaurado.startsWith(emitido) && restaurado.length > emitido.length) {
      onPedaco(restaurado.slice(emitido.length));
      emitido = restaurado;
    }
  };
  let saida;
  try {
    saida = await escrever([{ role: 'system', content: INSTRUCAO }, { role: 'user', content: protegido }], (p) => {
      bruto += p;
      soltar();
    });
  } catch (err) {
    onFalha(`tradução falhou: ${err.message}`);
    return texto;
  }
  const final = String(saida || bruto).trim();
  if (!final || !marcadoresInteiros(final, trechos)) {
    onFalha(final ? 'a tradução perdeu um trecho protegido; ficou o original' : 'a tradução veio vazia');
    return texto;
  }
  return restaurar(final, trechos);
}

module.exports = { pareceIngles, graficoTraduzido, proteger, restaurar, marcadoresInteiros, paraPortugues, paraIngles };
