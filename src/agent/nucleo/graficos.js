'use strict';

/**
 * Gráficos na resposta do núcleo (18/10). A escrita põe um bloco ```chart com
 * JSON (o mesmo formato que renderer/grafico.js desenha — dado, nunca código).
 * Aqui o código confere antes de chegar à tela:
 * - JSON válido, 2+ rótulos, séries do tamanho dos rótulos (ou pares x,y na dispersão);
 * - com fontes, cada número do gráfico é procurado no material lido: o que não
 *   está lá vira ESTIMATIVA (tracejado/hachurado na tela, "estimativa" na dica);
 *   se a maioria não está, o gráfico sai e a resposta diz por quê (18/10: o
 *   histórico de preço da RTX 5080 tinha 2 de 4 valores estimados e o gráfico
 *   sumia sem aviso — "abaixo, apresento um gráfico" e nada);
 * - pedido explícito de gráfico sem gráfico válido: o código monta um com a
 *   tabela ou a lista de valores da própria resposta;
 * - as etapas que mexem no texto (⚠, links, glossário) não tocam em nenhum
 *   bloco de código: ele sai e volta por um marcador.
 */

const TIPOS = ['line', 'area', 'bar', 'column', 'horizontalBar', 'stackedBar', 'combo', 'scatter', 'pie', 'doughnut'];
const BLOCO = /```chart\s*\n([\s\S]*?)```/g;
// qualquer bloco de código (18/10): as conferências punham ⚠ em ano e cortavam "[0]" de dentro do código
const QUALQUER_BLOCO = /```[\s\S]*?```/g;
const MARCADOR = /\u0000GRAFICO(\d+)\u0000/g;

const numero = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[^\d,.-]/g, '');
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const listaDe = (v, n) => (Array.isArray(v) ? Array.from({ length: n }, (_, i) => numero(v[i])) : undefined);

/** { ok, spec } ou { ok: false, erro } — o spec já limpo, pronto para o bloco. */
function validarGrafico(bruto) {
  let d;
  try {
    d = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  } catch {
    return { ok: false, erro: 'JSON inválido' };
  }
  if (!d || typeof d !== 'object') return { ok: false, erro: 'não é objeto' };
  const type = TIPOS.includes(d.type) ? d.type : 'bar';
  const comum = { type, title: String(d.title || '').slice(0, 90), ...(d.unit ? { unit: String(d.unit).slice(0, 16) } : {}), ...(d.yLabel ? { yLabel: String(d.yLabel).slice(0, 40) } : {}), ...(d.xLabel ? { xLabel: String(d.xLabel).slice(0, 40) } : {}), ...(d.stacked === true ? { stacked: true } : {}) };
  const brutos = (Array.isArray(d.datasets) ? d.datasets : []).slice(0, 8);
  if (type === 'scatter') {
    const datasets = brutos
      .map((s, i) => ({ label: String(s?.label || `série ${i + 1}`).slice(0, 40), data: (Array.isArray(s?.data) ? s.data : []).map((p) => (Array.isArray(p) ? [numero(p[0]), numero(p[1])] : [numero(p?.x), numero(p?.y)])).filter(([x, y]) => x !== null && y !== null).slice(0, 200) }))
      .filter((s) => s.data.length >= 2);
    return datasets.length ? { ok: true, spec: { ...comum, datasets } } : { ok: false, erro: 'dispersão sem 2 pares (x, y)' };
  }
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((r) => String(r).slice(0, 40)).slice(0, 200);
  if (labels.length < 2) return { ok: false, erro: 'menos de 2 rótulos' };
  const n = labels.length;
  const datasets = brutos
    .filter((s) => Array.isArray(s?.data) && s.data.length === n)
    .map((s, i) => {
      const data = s.data.map(numero);
      const est = s.estimated === true ? data.map(() => true) : Array.isArray(s.estimated) ? data.map((_, j) => s.estimated[j] === true) : null;
      return {
        label: String(s?.label || `série ${i + 1}`).slice(0, 40),
        data,
        ...(['bar', 'line', 'area'].includes(s.type) ? { type: s.type } : {}),
        ...(s.unit ? { unit: String(s.unit).slice(0, 16) } : {}),
        ...(est && est.some(Boolean) ? { estimated: est } : {}),
        ...(Array.isArray(s.low) && Array.isArray(s.high) ? { low: listaDe(s.low, n), high: listaDe(s.high, n) } : {}),
        ...(typeof s.points === 'boolean' ? { points: s.points } : {}),
      };
    })
    .filter((s) => s.data.filter((v) => v !== null).length >= 1 && s.data.some((v) => v !== null));
  if (!datasets.length) return { ok: false, erro: 'nenhuma série com um número por rótulo' };
  return { ok: true, spec: { ...comum, labels, datasets } };
}

const digitos = (n) => String(n).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const chavesDoNumero = (x) => [digitos(x), digitos(Number(x).toFixed(2)), digitos(Number(x).toFixed(1)), digitos(Math.round(x))];

/**
 * Tira os gráficos do texto (ficam marcadores), valida cada um e confere os números.
 * `material`: com fontes, ponto que não aparece nele vira estimativa; menos da metade aparece → sai,
 * A NÃO SER que o usuário tenha pedido o gráfico (`pedido`): aí fica, com os pontos estimados marcados
 * (18/10, app do Davi: "monte um gráfico de tendência com os dados acima" — o modelo interpolou os
 * meses que as fontes não têm, o gráfico saía e a resposta ficava só com "não foi montado").
 * @returns {{ texto, graficos: string[], validos, descartados: string[], estimativas, pontos }}
 */
function separarGraficos(texto, { material = '', pedido = false } = {}) {
  const doMaterial = material ? new Set((String(material).match(/\d[\d.,]*\d|\d/g) || []).flatMap((n) => [digitos(n), digitos(n.replace(/[.,]0+$/, ''))])) : null;
  const tem = (x) => chavesDoNumero(x).some((k) => doMaterial.has(k));
  const graficos = [];
  const descartados = [];
  let validos = 0;
  let estimativas = 0;
  let totalDePontos = 0;
  const semGraficos = String(texto || '').replace(BLOCO, (_, json) => {
    const v = validarGrafico(json.trim());
    if (!v.ok) {
      descartados.push(v.erro);
      return '';
    }
    // 25/10: gráfico que ninguém pediu com todos os valores iguais não mostra nada ("Lançamentos da Nvidia": [1, 1, 1])
    const valores = v.spec.datasets.flatMap((s) => s.data).filter((x) => x !== null && typeof x !== 'object');
    if (!pedido && valores.length > 1 && valores.every((x) => x === valores[0])) {
      descartados.push('todos os valores iguais');
      return '';
    }
    if (doMaterial && v.spec.type !== 'scatter') {
      const pontos = v.spec.datasets.flatMap((s, i) => s.data.map((x, j) => ({ i, j, x }))).filter((p) => p.x !== null);
      const achados = pontos.filter((p) => tem(p.x));
      totalDePontos += pontos.length;
      if (achados.length / pontos.length < 0.5 && !pedido) {
        descartados.push(`números fora das fontes (${pontos.length - achados.length} de ${pontos.length})`);
        return '';
      }
      // o que não está nas fontes é estimativa (além do que o modelo já marcou)
      for (const p of pontos) {
        if (tem(p.x)) continue;
        const s = v.spec.datasets[p.i];
        s.estimated = s.estimated || s.data.map(() => false);
        if (!s.estimated[p.j]) estimativas += 1;
        s.estimated[p.j] = true;
      }
    }
    validos += 1;
    graficos.push(`\`\`\`chart\n${JSON.stringify(v.spec)}\n\`\`\``);
    return `\u0000GRAFICO${graficos.length - 1}\u0000`;
  });
  // os outros blocos de código (```visual, ```python…) saem também, sem mudança
  const semBlocos = semGraficos.replace(QUALQUER_BLOCO, (m) => {
    graficos.push(m);
    return `\u0000GRAFICO${graficos.length - 1}\u0000`;
  });
  return { texto: semBlocos.replace(/\n{3,}/g, '\n\n'), graficos, validos, descartados, estimativas, pontos: totalDePontos };
}

const recolocarGraficos = (texto, graficos) => String(texto).replace(MARCADOR, (_, i) => graficos[Number(i)] || '');

/** Aplica `fn` ao texto com os blocos de código protegidos (links, glossário e afins não entram neles). */
function protegerGraficos(texto, fn) {
  const graficos = [];
  const marcado = String(texto || '').replace(QUALQUER_BLOCO, (m) => {
    graficos.push(m);
    return `\u0000GRAFICO${graficos.length - 1}\u0000`;
  });
  return recolocarGraficos(fn(marcado), graficos);
}

/* ------------------------------ gráfico pedido, montado pelo código ------------------------------ */

const PEDE_GRAFICO = /\b(gr[áa]ficos?|plot\w*|chart|diagrama de (barras|colunas|linhas|pizza)|visualiza[çc][ãa]o dos dados)\b/i;
const pedeGrafico = (pergunta) => PEDE_GRAFICO.test(String(pergunta || ''));
const PARECE_TEMPO = /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|seg|ter|qua|qui|sex|s[áa]b|dom|t\d|q\d|s\d|\d{1,2}[/-]\d{2,4}|\d{4}|(19|20)\d{2}|\d+\s?(h|min|s|dias?|semanas?|meses|anos?))\b/i;
const limparRotulo = (t) => String(t).replace(/[*_`[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
// o número que é o VALOR do item: o 1º com moeda ou %, senão o 1º solto ("~R$ 1.699 (US$ 999)" → 1699;
// "Estimativa de R$ 4.500" → 4500, não o "2026" do rótulo; "47,03%" → 47,03)
const NUMERO = /(R\$|US\$|U\$|€|£)?\s?(?<![\w/.,-])(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?)(?![\w/])\s?(%|mil\b|mi\b|bi\b)?/g;
const primeiroNumero = (t) => {
  const achados = [...String(t).replace(/\[\d+\]|\(\d+\)/g, '').matchAll(NUMERO)].map((m) => {
    let v = numero(m[2]);
    if (m[3] === 'mil') v *= 1e3;
    else if (m[3] === 'mi') v *= 1e6;
    else if (m[3] === 'bi') v *= 1e9;
    return { v, unidade: m[1] || (m[3] === '%' ? '%' : '') };
  }).filter((x) => x.v !== null);
  return achados.find((x) => x.unidade) || achados[0] || null;
};

/**
 * Gráfico a partir da própria resposta, quando o usuário pediu um e o modelo
 * não fez (ou fez inválido): a 1ª tabela markdown com rótulo + coluna(s) de
 * número, ou uma lista "- rótulo: valor" com 3+ itens.
 * @returns { bloco, depoisDaLinha } | null — o bloco ```chart e a linha depois da qual ele entra
 */
function graficoDoTexto(texto, { titulo = '' } = {}) {
  const linhas = String(texto || '').split('\n');
  // tabela
  for (let i = 0; i < linhas.length - 2; i += 1) {
    if (!/^\s*\|.*\|\s*$/.test(linhas[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1])) continue;
    const celulas = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const cabeca = celulas(linhas[i]);
    const corpo = [];
    for (let k = i + 2; k < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[k]); k += 1) corpo.push(celulas(linhas[k]));
    if (corpo.length < 2) continue;
    const numericas = cabeca.map((nome, c) => ({ nome, c, valores: corpo.map((r) => primeiroNumero(r[c] || '')) })).slice(1).filter((col) => col.valores.filter(Boolean).length >= Math.max(2, corpo.length * 0.6));
    if (!numericas.length) continue;
    // só as colunas da mesma unidade da primeira (preço e FPS no mesmo eixo não dizem nada)
    const unidadeDe = (col) => col.valores.find((x) => x?.unidade)?.unidade || '';
    const colunas = numericas.filter((col) => unidadeDe(col) === unidadeDe(numericas[0]));
    const labels = corpo.map((r) => limparRotulo(r[0]));
    const tempo = labels.filter((l) => PARECE_TEMPO.test(l)).length >= labels.length * 0.6;
    const unidade = colunas[0].valores.find((x) => x?.unidade)?.unidade || '';
    const depoisDaLinha = i + 1 + corpo.length;
    return { depoisDaLinha, bloco: `\`\`\`chart\n${JSON.stringify({ type: tempo ? 'line' : 'bar', title: titulo || limparRotulo(colunas.slice(0, 4).map((col) => col.nome).join(' e ')), ...(unidade ? { unit: unidade } : {}), labels, datasets: colunas.slice(0, 4).map((col) => ({ label: limparRotulo(col.nome), data: col.valores.map((x) => (x ? x.v : null)) })) })}\n\`\`\`` };
  }
  // lista "- rótulo: valor": a maior sequência contínua de itens com valor (não todas as listas da resposta)
  const item = (l) => {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+\**([^*:\n]{1,50}?)\**\s*[:—–-]\s+(.+)$/.exec(l);
    const n = m && primeiroNumero(m[2]);
    return m && n && limparRotulo(m[1]) ? { rotulo: limparRotulo(m[1]), n } : null;
  };
  let itens = [];
  let atual = [];
  let numeroDaLinha = -1;
  for (const l of [...linhas, '']) {
    const x = item(l);
    numeroDaLinha += 1;
    if (x) atual.push({ ...x, linha: numeroDaLinha });
    else if (l.trim() || !atual.length) {
      if (atual.length > itens.length) itens = atual;
      atual = [];
    }
  }
  if (atual.length > itens.length) itens = atual; // a lista que vai até o fim da resposta
  if (itens.length >= 3) {
    const tempo = itens.filter((x) => PARECE_TEMPO.test(x.rotulo)).length >= itens.length * 0.6;
    const unidade = itens.find((x) => x.n.unidade)?.n.unidade || '';
    return { depoisDaLinha: itens[itens.length - 1].linha, bloco: `\`\`\`chart\n${JSON.stringify({ type: tempo ? 'line' : 'bar', title: titulo, ...(unidade ? { unit: unidade } : {}), labels: itens.map((x) => x.rotulo), datasets: [{ label: unidade || 'valor', data: itens.map((x) => x.n.v) }] })}\n\`\`\`` };
  }
  return null;
}

// a instrução da escrita: quando um gráfico ajuda e o formato exato
const INSTRUCAO_DE_GRAFICO = `
- Gráfico: quando a resposta trouxer 3 ou mais números comparáveis (preços, medidas, notas, tempos, valores ao longo do tempo, partes de um total) — e SEMPRE que o usuário pedir um gráfico —, ponha o gráfico logo depois da tabela ou do parágrafo desses números, num bloco exatamente assim:
\`\`\`chart
{"type": "bar", "title": "título curto", "unit": "R$", "labels": ["A", "B", "C"], "datasets": [{"label": "o que é o número", "data": [10, 20, 30]}]}
\`\`\`
  "type": "bar" (colunas, para comparar), "horizontalBar" (nomes longos), "stackedBar" (colunas empilhadas: partes de cada total), "line" (evolução no tempo), "area" (linha sombreada), "combo" (colunas + linha: na série da linha ponha "type": "line"), "pie" ou "doughnut" (partes de um total), "scatter" (relação entre dois números: "data": [[x, y], …]).
  "unit": "R$", "US$", "%", "ms", "GB"… (vai na dica e no eixo; em "data", só números, sem unidade, na ordem dos "labels"; use null onde não há valor).
  Valor que você estimou ou calculou (não está nas fontes): marque com "estimated": [false, true, …] na série. Projeção com margem: "low" e "high" na série, com os limites de cada ponto.
  Não misture unidades ou moedas no mesmo gráfico (R$ com US$, watts com preço): faça um gráfico para cada uma. Use os números das fontes ou do usuário; sem números comparáveis, sem gráfico.`;

// item 4 (18/10): o visual interativo, só quando pedido
const INSTRUCAO_DE_VISUAL = `
- Visual interativo: SÓ quando o usuário pedir para criar algo interativo ou visual que um gráfico não resolve (uma calculadora, simulação, animação, mini jogo, painel, página, linha do tempo clicável), escreva a página inteira num bloco \`\`\`visual com HTML, CSS e JavaScript juntos. Ela roda numa caixa isolada, SEM internet: nada de link para CDN, biblioteca de fora, imagem de URL, fetch ou formulário — tudo no próprio código (desenho com canvas ou SVG). Fundo escuro (#131316) e texto claro combinam com o app. Depois do bloco, explique em 1 ou 2 frases o que ela faz e como usar.`;

module.exports = { validarGrafico, separarGraficos, recolocarGraficos, protegerGraficos, graficoDoTexto, pedeGrafico, INSTRUCAO_DE_GRAFICO, INSTRUCAO_DE_VISUAL };
