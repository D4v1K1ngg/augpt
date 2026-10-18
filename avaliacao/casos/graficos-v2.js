'use strict';

/**
 * Gráficos v2 (18/10): tipos novos, estimativas, faixa de incerteza, gráfico
 * pedido montado pelo código e as travas das conversas reais (histórico de
 * preço da RTX 5080 sem gráfico; calculadora de IMC que virou imagem do FLUX).
 * A interação (dica, legenda clicável) foi conferida no Electron à parte.
 */

const nucleo = require('../../src/agent/nucleo');
const { separarGraficos, graficoDoTexto, validarGrafico, pedeGrafico } = require('../../src/agent/nucleo/graficos');

function validarNaTela(spec) {
  const antes = global.window;
  global.window = {};
  delete require.cache[require.resolve('../../renderer/grafico.js')];
  require('../../renderer/grafico.js');
  const r = global.window.grafico.validar(spec);
  global.window = antes;
  return r;
}

const LISTA_RTX = `## Gráfico de Evolução dos Preços

- **Jan/2025 (Lançamento)**: ~R$ 1.699 (US$ 999 convertido) [(3)](https://gpuprix.com/x)
- **Set/2025 - Jan/2026**: Estimativa de R$ 4.500 [(2)](https://hardwarerk.com/x)
- **Out/2025 - Ago/2026**: ~R$ 10.800 (média entre R$ 9.128 e R$ 10.799)
- **Set/2026**: **R$ 9.128,90** (mínima observada em 10/09/2026)
- **Out/2026 (Atual)**: ~R$ 11.442 (preço médio atual)

## Recomendações
- **Inno3D X3**: R$ 8.699,99`;

module.exports = [
  {
    nome: 'gráficos v2: a tela entende os tipos novos (colunas empilhadas, combinado, dispersão, área) e os campos estimated, low/high, unit e type por série; o formato antigo continua valendo',
    tipo: 'unidade',
    executar() {
      const empilhado = validarNaTela({ type: 'stackedBar', labels: ['T1', 'T2'], datasets: [{ label: 'a', data: [1, 2] }, { label: 'b', data: [3, 4] }] });
      const combo = validarNaTela({ type: 'combo', labels: ['a', 'b'], datasets: [{ label: 'vendas', data: [1, 2] }, { label: 'preço', data: [5, 6], type: 'line' }] });
      const projecao = validarNaTela({ type: 'line', unit: 'R$', labels: ['out', 'nov', 'dez'], datasets: [{ label: 'preço', data: [11442, 10900, null], estimated: [false, true, true], low: [null, 10200, 9400], high: [null, 11600, 11400] }] });
      const dispersao = validarNaTela({ type: 'scatter', datasets: [{ label: 'placas', data: [[3.5, 90], { x: 5, y: 110 }] }] });
      const antigo = validarNaTela({ type: 'bar', labels: ['a', 'b'], datasets: [{ label: 'x', data: ['1,5', 2] }] });
      return [
        empilhado.ok && empilhado.spec.empilhado && empilhado.spec.series.every((s) => s.tipo === 'bar') || JSON.stringify(empilhado),
        combo.ok && combo.spec.series.map((s) => s.tipo).join() === 'bar,line' || JSON.stringify(combo.spec?.series),
        projecao.ok && projecao.spec.unidade === 'R$' && projecao.spec.series[0].estimados.join() === 'false,true,true' && projecao.spec.series[0].alto[1] === 11600 && projecao.spec.series[0].valores[2] === null || JSON.stringify(projecao.spec),
        dispersao.ok && dispersao.spec.series[0].pares.length === 2 || JSON.stringify(dispersao),
        antigo.ok && antigo.spec.series[0].valores[0] === 1.5 && antigo.spec.tipo === 'bar' || JSON.stringify(antigo),
        !validarNaTela({ type: 'line', labels: [], datasets: [] }).ok || 'vazio',
      ];
    },
  },
  {
    nome: 'gráficos v2: com fontes, o ponto que não está nelas vira estimativa (não derruba o gráfico); só sai se a maioria não está — e o núcleo valida os campos novos',
    tipo: 'unidade',
    executar() {
      const material = 'US$ 999 · mínima de R$ 9.128,90 · média R$ 11.442 · R$ 10.799,93';
      const bloco = (data) => `\`\`\`chart\n${JSON.stringify({ type: 'line', unit: 'R$', labels: ['jan/25', 'set/25', 'set/26', 'out/26'], datasets: [{ label: 'preço', data }] })}\n\`\`\``;
      const metade = separarGraficos(bloco([1699, 4500, 9128.9, 11442]), { material });
      const pouco = separarGraficos(bloco([1699, 4500, 7777, 11442]), { material });
      const spec = JSON.parse(metade.graficos[0].replace(/^```chart\n|\n```$/g, ''));
      return [
        metade.validos === 1 && metade.estimativas === 2 && spec.datasets[0].estimated.join() === 'true,true,false,false' || JSON.stringify(metade),
        pouco.validos === 0 && /fora das fontes \(3 de 4\)/.test(pouco.descartados[0]) || JSON.stringify(pouco),
        validarGrafico({ type: 'stackedBar', unit: '%', labels: ['a', 'b'], datasets: [{ label: 'x', data: [1, null], low: [0, 0], high: [2, 2] }] }).spec?.datasets[0].low?.length === 2 || 'campos novos no núcleo',
      ];
    },
  },
  {
    nome: 'gráficos v2: pediu gráfico e o modelo não fez (conversa real da RTX 5080) — o código monta com a lista ou a tabela da resposta, logo depois dela, e confere os números; sem números, a resposta diz que não montou',
    tipo: 'unidade',
    async executar() {
      const montado = graficoDoTexto(LISTA_RTX);
      const spec = JSON.parse(montado.bloco.replace(/^```chart\n|\n```$/g, ''));
      const tabela = graficoDoTexto('| Placa | Preço | FPS |\n| --- | --- | --- |\n| RTX 5070 Ti | R$ 8.882 | 150 |\n| RTX 5080 | R$ 11.441,90 | 175 |');
      const responder = (texto, pergunta) =>
        nucleo.responder({
          pergunta,
          modo: 'rapido',
          hoje: '18/10/2026',
          deps: {
            chamar: async (m, o = {}) => (o.json ? { content: '{"precisa_buscar": true}' } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
            escrever: async (messages, onToken) => (onToken(texto), texto),
            buscar: async () => [{ titulo: 'RTX 5080 histórico', url: 'https://radargpu.exemplo/rtx', resumo: 'mínima R$ 9.128,90 em 10/09/2026; média R$ 11.442; lançamento US$ 999; R$ 10.800' }],
            lerPagina: async () => ({ texto: 'Histórico: mínima R$ 9.128,90; preço médio R$ 11.442; R$ 10.800 em agosto; lançada por US$ 999.', titulo: 'RTX 5080' }),
            emit: () => {},
          },
        });
      const r = await responder(LISTA_RTX, 'Analise o histórico de preço da rtx 5080 e monte um gráfico com os dados');
      const r2 = await responder('Não achei números para isso.', 'monte um gráfico da felicidade no Brasil');
      return [
        spec.type === 'line' && spec.unit === 'R$' && spec.labels.join('|') === 'Jan/2025 Lançamento|Set/2025|Out/2025|Set/2026|Out/2026 Atual' && spec.datasets[0].data.join() === '1699,4500,10800,9128.9,11442' || montado.bloco,
        JSON.parse(tabela.bloco.replace(/^```chart\n|\n```$/g, '')).datasets.length === 1 || 'só a coluna da mesma unidade',
        /Out\/2026 \(Atual\)\*\*: ~R\$ 11\.442 \(preço médio atual\)\n\n```chart\n/.test(r.texto) && r.texto.indexOf('```chart') < r.texto.indexOf('## Recomendações') || r.texto.slice(0, 600),
        /"estimated":\[true,true,false,false,false\]/.test(r.texto) || 'R$ 1.699 e R$ 4.500 não estão nas fontes: estimativas',
        /O gráfico pedido não foi montado: a resposta não trouxe números/.test(r2.texto) || r2.texto,
      ];
    },
  },
  {
    nome: 'gráficos v2: pedido de gráfico leva o lembrete do bloco; "gráfico interativo" é gráfico (não página HTML); "crie uma calculadora de IMC interativa" não vira imagem do FLUX mesmo com o modelo marcando criar_imagem',
    tipo: 'unidade',
    async executar() {
      const ent = nucleo.lerEntendimento('{"precisa_buscar": false, "criar_imagem": true}', 'crie uma calculadora de IMC interativa');
      const ent2 = nucleo.lerEntendimento('{"criar_imagem": true}', 'crie uma imagem de um gato astronauta');
      const escritas = [];
      await nucleo.responder({
        pergunta: 'monte um gráfico de colunas com a população das 5 maiores cidades do Brasil',
        modo: 'rapido',
        deps: {
          chamar: async (m, o = {}) => (o.json ? { content: '{"precisa_buscar": false}' } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
          escrever: async (messages, onToken) => (escritas.push(messages), onToken('ok'), 'ok'),
          buscar: async () => [{ titulo: 'Cidades', url: 'https://ibge.exemplo/x', resumo: 'São Paulo 11,9 milhões' }],
          lerPagina: async () => ({ texto: 'São Paulo tem 11,9 milhões de habitantes.', titulo: 'IBGE' }),
          emit: () => {},
        },
      });
      return [
        ent.criarImagem === false || 'calculadora não é imagem',
        ent2.criarImagem === true || 'imagem de verdade continua imagem',
        pedeGrafico('monte um gráfico com os dados') && pedeGrafico('faça os gráficos de vendas') && !pedeGrafico('qual a melhor placa de vídeo?') || 'pedido de gráfico',
        !nucleo.pedeVisual('crie um gráfico interativo de vendas') && nucleo.pedeVisual('crie uma calculadora interativa') || 'gráfico interativo é gráfico',
        /Monte o gráfico pedido num bloco ```chart/.test(escritas[0].at(-1).content) || 'lembrete',
        /"stackedBar"/.test(escritas[0][0].content) && /"estimated"/.test(escritas[0][0].content) && /"low" e "high"/.test(escritas[0][0].content) || 'instrução com os tipos novos',
      ];
    },
  },
];
