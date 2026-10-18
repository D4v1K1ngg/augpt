'use strict';

/**
 * Gráficos na resposta do núcleo (18/10). A escrita põe um bloco ```chart com
 * JSON (o mesmo formato que renderer/grafico.js desenha em Canvas — dado, nunca
 * código). Aqui o código confere antes de chegar à tela:
 * - JSON válido, 2+ rótulos, séries com números do mesmo tamanho dos rótulos;
 * - com fontes, os números do gráfico têm de estar no material lido (gráfico
 *   com número inventado engana mais que texto, porque parece medição);
 * - as etapas que mexem no texto (⚠ da conferência, links das citações,
 *   glossário) não tocam no bloco: ele sai e volta por um marcador.
 */

const TIPOS = ['line', 'area', 'bar', 'column', 'horizontalBar', 'pie', 'doughnut'];
const BLOCO = /```chart\s*\n([\s\S]*?)```/g;
// qualquer bloco de código (18/10): as conferências punham ⚠ em ano e cortavam "[0]" de dentro do código
const QUALQUER_BLOCO = /```[\s\S]*?```/g;
const MARCADOR = /\u0000GRAFICO(\d+)\u0000/g;

const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')));

/** { ok, spec } ou { ok: false, erro } — o spec já limpo, pronto para o bloco. */
function validarGrafico(bruto) {
  let d;
  try {
    d = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  } catch {
    return { ok: false, erro: 'JSON inválido' };
  }
  if (!d || typeof d !== 'object') return { ok: false, erro: 'não é objeto' };
  const labels = (Array.isArray(d.labels) ? d.labels : []).map((r) => String(r).slice(0, 40)).slice(0, 120);
  if (labels.length < 2) return { ok: false, erro: 'menos de 2 rótulos' };
  const datasets = (Array.isArray(d.datasets) ? d.datasets : [])
    .slice(0, 6)
    .map((s, i) => ({ label: String(s?.label || `série ${i + 1}`).slice(0, 40), data: (Array.isArray(s?.data) ? s.data : []).map(numero) }))
    .filter((s) => s.data.length === labels.length && s.data.every(Number.isFinite));
  if (!datasets.length) return { ok: false, erro: 'nenhuma série com um número por rótulo' };
  return { ok: true, spec: { type: TIPOS.includes(d.type) ? d.type : 'bar', title: String(d.title || '').slice(0, 90), labels, datasets } };
}

const digitos = (n) => String(n).replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * Tira os gráficos do texto (ficam marcadores) e valida cada um.
 * `material`: com fontes, pelo menos 70% dos números de cada gráfico têm de aparecer nele.
 * @returns {{ texto, graficos: string[], descartados: string[] }}
 */
function separarGraficos(texto, { material = '' } = {}) {
  const doMaterial = material ? new Set((String(material).match(/\d[\d.,]*\d|\d/g) || []).flatMap((n) => [digitos(n), digitos(n.replace(/[.,]0+$/, ''))])) : null;
  const graficos = [];
  const descartados = [];
  const semGraficos = String(texto || '').replace(BLOCO, (_, json) => {
    const v = validarGrafico(json.trim());
    if (!v.ok) {
      descartados.push(v.erro);
      return '';
    }
    if (doMaterial) {
      const valores = v.spec.datasets.flatMap((s) => s.data);
      const achados = valores.filter((x) => doMaterial.has(digitos(x)) || doMaterial.has(digitos(Number(x).toFixed(2)))).length;
      if (achados / valores.length < 0.7) {
        descartados.push(`números fora das fontes (${valores.length - achados} de ${valores.length})`);
        return '';
      }
    }
    graficos.push(`\`\`\`chart\n${JSON.stringify(v.spec)}\n\`\`\``);
    return `\u0000GRAFICO${graficos.length - 1}\u0000`;
  });
  // os outros blocos de código (```visual, ```python…) saem também, sem mudança
  const semBlocos = semGraficos.replace(QUALQUER_BLOCO, (m) => {
    graficos.push(m);
    return `\u0000GRAFICO${graficos.length - 1}\u0000`;
  });
  return { texto: semBlocos.replace(/\n{3,}/g, '\n\n'), graficos, descartados };
}

const recolocarGraficos = (texto, graficos) => String(texto).replace(MARCADOR, (_, i) => graficos[Number(i)] || '');

/** Aplica `fn` ao texto com os gráficos protegidos (links, glossário e afins não entram no JSON). */
function protegerGraficos(texto, fn) {
  const graficos = [];
  const marcado = String(texto || '').replace(QUALQUER_BLOCO, (m) => {
    graficos.push(m);
    return `\u0000GRAFICO${graficos.length - 1}\u0000`;
  });
  return recolocarGraficos(fn(marcado), graficos);
}

// a instrução da escrita: quando um gráfico ajuda e o formato exato
const INSTRUCAO_DE_GRAFICO = `
- Gráfico: quando a resposta trouxer 3 ou mais números comparáveis (preços, medidas, notas, tempos, valores ao longo do tempo, partes de um total), ponha UM gráfico logo depois da tabela ou do parágrafo desses números, num bloco exatamente assim:
\`\`\`chart
{"type": "bar", "title": "título curto", "labels": ["A", "B", "C"], "datasets": [{"label": "o que é o número (e a unidade)", "data": [10, 20, 30]}]}
\`\`\`
  "type": "bar" para comparar itens, "line" para evolução no tempo, "pie" para partes de um total. Em "data", só números (sem unidade nem texto), na ordem dos "labels", e só números que estão nas fontes ou que o usuário deu. Sem números comparáveis, sem gráfico.`;

// item 4 (18/10): o visual interativo, só quando pedido
const INSTRUCAO_DE_VISUAL = `
- Visual interativo: SÓ quando o usuário pedir para criar algo interativo ou visual que um gráfico não resolve (uma calculadora, simulação, animação, mini jogo, painel, página, linha do tempo clicável), escreva a página inteira num bloco \`\`\`visual com HTML, CSS e JavaScript juntos. Ela roda numa caixa isolada, SEM internet: nada de link para CDN, biblioteca de fora, imagem de URL, fetch ou formulário — tudo no próprio código (desenho com canvas ou SVG). Fundo escuro (#131316) e texto claro combinam com o app. Depois do bloco, explique em 1 ou 2 frases o que ela faz e como usar.`;

module.exports = { validarGrafico, separarGraficos, recolocarGraficos, protegerGraficos, INSTRUCAO_DE_GRAFICO, INSTRUCAO_DE_VISUAL };
