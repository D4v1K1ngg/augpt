'use strict';

/**
 * Ferramenta de gráfico.
 *
 * Não desenha nada: produz um bloco ```chart validado, que o renderizador
 * transforma em Canvas. A separação importa — o modelo entrega DADO, e o
 * desenho acontece em código que não executa nada vindo dele.
 */

const TIPOS = ['line', 'area', 'bar', 'column', 'horizontalBar', 'pie', 'doughnut'];
const MAX_PONTOS = 120;
const MAX_SERIES = 6;

/** Aceita "1.240,50", "R$ 3.899,90", "12%" e número puro. */
function numero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor ?? '').replace(/[^\d,.\-]/g, '');
  if (!texto) return null;
  const normalizado = /,\d{1,2}$/.test(texto)
    ? texto.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(texto)
      ? texto.replace(/\./g, '')
      : texto.replace(/,/g, '');
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function comoLista(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (texto.startsWith('[')) {
      try {
        return JSON.parse(texto);
      } catch {
        /* segue para a divisão por vírgula */
      }
    }
    // Em pt-BR a vírgula é separador DECIMAL: dividir "482900,50; 201450,00"
    // por vírgula produzia seis valores para três rótulos. Ponto e vírgula tem
    // precedência, e a vírgula só separa quando não está entre dígitos.
    const separador = texto.includes(';') || /\n/.test(texto) ? /[;\n]/ : /,(?!\s*\d{1,3}(\D|$))|,(?=\s)/;
    const partes = texto.includes(';') || /\n/.test(texto)
      ? texto.split(separador)
      : texto.split(/,(?![\d\s]*\d\s*(?:,|$))/);
    return partes.map((p) => p.trim()).filter(Boolean);
  }
  return [];
}

module.exports = [
  {
    name: 'gerar_grafico',
    risk: 'baixo',
    description:
      'Monta um gráfico para aparecer na resposta (linha, barra, pizza e outros). Use quando houver série de números que fique mais clara vista do que lida — evolução no tempo, comparação entre itens, composição de um total. Não use para dado único nem para pergunta sem número.',
    args: {
      tipo: 'line, area, bar, column, horizontalBar, pie ou doughnut',
      titulo: 'título do gráfico',
      rotulos: 'lista de rótulos do eixo, ex.: ["jan","fev","mar"]',
      valores: 'lista de números na mesma ordem dos rótulos',
      serie: 'nome desta série de dados',
      series: 'opcional: várias séries, ex.: [{"nome":"2025","valores":[1,2]},{"nome":"2026","valores":[3,4]}]',
    },
    obrigatorios: ['rotulos'],
    async run({ tipo, titulo, rotulos, valores, serie, series }, ctx) {
      const eixo = comoLista(rotulos).map((r) => String(r).slice(0, 40));
      if (eixo.length < 2) throw new Error('Informe ao menos 2 rótulos em "rotulos" — um gráfico de um ponto só não diz nada.');

      let conjuntos = [];
      if (Array.isArray(series) && series.length) {
        conjuntos = series.slice(0, MAX_SERIES).map((s, i) => ({
          label: String(s?.nome || s?.label || `série ${i + 1}`).slice(0, 40),
          data: comoLista(s?.valores ?? s?.data).map(numero),
        }));
      } else {
        conjuntos = [{ label: String(serie || titulo || 'valores').slice(0, 40), data: comoLista(valores).map(numero) }];
      }

      conjuntos = conjuntos.filter((c) => c.data.some((v) => v !== null));
      if (!conjuntos.length) {
        throw new Error('Nenhum número válido em "valores". Envie números, não texto: [10, 20, 30].');
      }

      const desencontro = conjuntos.find((c) => c.data.length !== eixo.length);
      if (desencontro) {
        throw new Error(
          `A série "${desencontro.label}" tem ${desencontro.data.length} valores para ${eixo.length} rótulos. ` +
            'As duas listas precisam ter o mesmo tamanho.'
        );
      }

      const escolhido = TIPOS.includes(tipo) ? tipo : 'bar';
      const spec = {
        type: escolhido,
        title: String(titulo || '').slice(0, 90),
        labels: eixo.slice(0, MAX_PONTOS),
        datasets: conjuntos.map((c) => ({ label: c.label, data: c.data.slice(0, MAX_PONTOS) })),
      };

      const bloco = `\`\`\`chart\n${JSON.stringify(spec, null, 1)}\n\`\`\``;

      // guardado para o caso de o redator esquecer de copiar o bloco:
      // melhor um gráfico no fim da resposta que gráfico nenhum
      ctx.estado.graficos = ctx.estado.graficos || [];
      ctx.estado.graficos.push(bloco);

      return (
        `Gráfico pronto (${escolhido}, ${eixo.length} pontos, ${conjuntos.length} série(s)).\n` +
        'COPIE O BLOCO ABAIXO NA RESPOSTA, exatamente como está, no ponto em que ele faz sentido:\n\n' +
        bloco
      );
    },
  },
];
