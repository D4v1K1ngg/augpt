'use strict';

/**
 * Gráficos na resposta do núcleo (18/10): a escrita põe um bloco ```chart; o
 * código valida, confere os números contra as fontes e protege o JSON das
 * etapas que mexem no texto. E o chat volta a desenhar o bloco (o marcador
 * dele nunca era trocado — nenhum gráfico aparecia).
 */

const nucleo = require('../../src/agent/nucleo');
const { separarGraficos, protegerGraficos, validarGrafico } = require('../../src/agent/nucleo/graficos');

const bloco = (spec) => `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``;
const PRECOS = { type: 'bar', title: 'Preço em 2026', labels: ['KaBuM 2025', 'Zoom', 'Amazon'], datasets: [{ label: 'R$', data: [11441.9, 11999.99, 12713.22] }] };

module.exports = [
  {
    nome: 'gráficos: o chat desenha o bloco ```chart (o marcador agora é trocado pelo lugar do gráfico); bloco de código comum continua código',
    tipo: 'unidade',
    executar() {
      const antes = global.window;
      global.window = {};
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.window.md.render(`Antes\n\n${bloco(PRECOS)}\n\nDepois\n\n\`\`\`js\nx = 1\n\`\`\``);
      const specs = global.window.md.graficos;
      global.window = antes;
      return [
        /<div class="grafico-lugar" data-grafico="0"><\/div>/.test(html) || html,
        !/\u0000/.test(html) || 'marcador cru na tela',
        /"labels":\["KaBuM 2025"/.test(specs[0]) || 'spec guardado',
        /<pre class="bloco-codigo" data-lang="js">/.test(html) || 'código comum',
      ];
    },
  },
  {
    nome: 'gráficos: validação (rótulos, séries do mesmo tamanho, números); com fontes, gráfico com números que não estão nelas é descartado; sem fontes, fica',
    tipo: 'unidade',
    executar() {
      const material = 'KaBuM R$ 11.441,90 à vista; Zoom a partir de R$ 11.999,99; Amazon R$ 12.713,22.';
      const ok = separarGraficos(`Preços:\n\n${bloco(PRECOS)}\n\nFim.`, { material });
      const inventado = separarGraficos(`x\n\n${bloco({ ...PRECOS, datasets: [{ label: 'R$', data: [9999, 8888, 7777] }] })}`, { material });
      const semFontes = separarGraficos(`x\n\n${bloco({ ...PRECOS, datasets: [{ label: 'R$', data: [9999, 8888, 7777] }] })}`);
      return [
        ok.graficos.length === 1 && /\u0000GRAFICO0\u0000/.test(ok.texto) || `válido: ${JSON.stringify(ok)}`,
        inventado.graficos.length === 0 && /fora das fontes/.test(inventado.descartados[0]) || `inventado: ${JSON.stringify(inventado.descartados)}`,
        semFontes.graficos.length === 1 || 'sem fontes fica',
        !validarGrafico('{"labels":["a"],"datasets":[{"data":[1]}]}').ok || '1 rótulo',
        !validarGrafico('{"labels":["a","b"],"datasets":[{"data":[1]}]}').ok || 'tamanhos diferentes',
        !validarGrafico('não é json').ok || 'json inválido',
        validarGrafico('{"type":"radar","labels":["a","b"],"datasets":[{"data":["1,5","2"]}]}').spec?.type === 'bar' || 'tipo desconhecido vira barra',
        protegerGraficos(`[1] e ${bloco({ ...PRECOS, datasets: [{ label: 'R$', data: [5, 6, 7] }] })}`, (t) => t.replace(/\[\d+\]/g, 'LINK').replace(/R\$/g, 'R$ (reais)')).includes('"label":"R$","data":[5,6,7]') || 'JSON protegido',
      ];
    },
  },
  {
    nome: 'gráficos: no núcleo, a escrita é orientada a pôr o gráfico; o bloco sai intacto das conferências (ano no rótulo sem ⚠, número sem virar citação) e volta no lugar',
    tipo: 'unidade',
    async executar() {
      const texto = `O mais barato é o KaBuM [1].\n\n${bloco({ type: 'bar', title: 'Preço 2026', labels: ['KaBuM 2019', 'Zoom'], datasets: [{ label: 'R$', data: [11441.9, 11999.99] }] })}\n\nVeja acima.`;
      const escritas = [];
      const r = await nucleo.responder({
        pergunta: 'qual o preço da rtx 5080?',
        modo: 'rapido',
        hoje: '18/10/2026',
        deps: {
          chamar: async (m, o = {}) => (o.json ? { content: '{"precisa_buscar": true}' } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
          escrever: async (messages, onToken) => (escritas.push(messages), onToken(texto), texto),
          buscar: async () => [{ titulo: 'RTX 5080 preço', url: 'https://loja.exemplo/rtx', resumo: 'RTX 5080 por R$ 11.441,90 à vista; no Zoom R$ 11.999,99.' }],
          lerPagina: async () => ({ texto: 'A RTX 5080 custa R$ 11.441,90 à vista no KaBuM e R$ 11.999,99 no Zoom.', titulo: 'RTX 5080' }),
          emit: () => {},
        },
      });
      return [
        /"type": "bar"/.test(escritas[0][0].content) && /bloco exatamente assim/.test(escritas[0][0].content) || 'instrução do gráfico na escrita',
        /```chart\n\{"type":"bar","title":"Preço 2026","labels":\["KaBuM 2019","Zoom"\],"datasets":\[\{"label":"R\$","data":\[11441\.9,11999\.99\]\}\]\}\n```/.test(r.texto) || r.texto,
        /\n\nVeja acima\./.test(r.texto) || 'texto depois do gráfico',
      ];
    },
  },
];
