'use strict';

/**
 * Evidência → Dados → Análise (2026-09-27). Origem: 10º teste real ("histórico
 * de preços da RTX 5070 Ti e da RTX 5080 desde o lançamento ... média ...
 * gráfico") — o modelo fez a conta de cabeça, chamou faixa de "média",
 * converteu dólar em real a 1:1 e não fez gráfico. Aqui o código extrai
 * preço + data + produto das páginas, calcula e monta o gráfico; o
 * verificador pega moeda impossível e "média" que é faixa.
 */

const s = require('../../src/agent/serie-de-precos');
const verificador = require('../../src/agent/verificador');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

const PEDIDO =
  'Analise o historico de preços da RTX 5070 TI desde o seu lançamento junto da RTX 5080, vamos montar uma media de preço até hoje e construir um grafico relacionando a media com as datas';

const FONTES = [
  {
    url: 'https://www.tecmundo.com.br/a',
    data: '2025-02-20',
    textoCompleto:
      'A RTX 5070 Ti chegou ao Brasil por R$ 7.499,00 no lançamento. Já a RTX 5080 custava R$ 9.999,00 em fevereiro de 2025. Parcelado: 12x de R$ 700,00 na RTX 5080.',
  },
  {
    url: 'https://www.adrenaline.com.br/b',
    data: '2025-06-10',
    textoCompleto:
      'Em junho de 2025 a RTX 5070 Ti caiu para R$ 6.299,90, enquanto a RTX 5080 estava em R$ 8.899,00. A Nvidia anunciou a RTX 5070 Ti por US$ 749.',
  },
  { url: 'https://www.kabum.com.br/c', data: null, textoCompleto: 'Placa de vídeo RTX 5070 Ti Gigabyte R$ 5.999,99 à vista.' },
  { url: 'https://x.com/d', data: '2026-09-01', textoCompleto: 'Hoje a RTX 5080 sai por R$ 7.899,90 e a RTX 5070 Ti por R$ 5.899,90.' },
];

module.exports = [
  {
    nome: 'série de preços: produtos do pedido, sem confundir "5070" com "5070 Ti" nem data com modelo',
    tipo: 'unidade',
    executar() {
      const nomes = (o) => s.produtosDoPedido(o).map((p) => p.nome);
      const [ti, x80] = s.produtosDoPedido(PEDIDO);
      return [
        JSON.stringify(nomes(PEDIDO)) === JSON.stringify(['RTX 5070 Ti', 'RTX 5080']) || `produtos: ${nomes(PEDIDO)}`,
        JSON.stringify(nomes('evolução do preço da RTX 5070 nos últimos 12 meses (até 26/09/2026)')) === JSON.stringify(['RTX 5070']) ||
          `"últimos 12"/data viraram produto: ${nomes('evolução do preço da RTX 5070 nos últimos 12 meses (até 26/09/2026)')}`,
        JSON.stringify(nomes('histórico de preço do iPhone 15 Pro e do Galaxy S24 Ultra')) === JSON.stringify(['iPhone 15 Pro', 'Galaxy S24 Ultra']) ||
          nomes('histórico de preço do iPhone 15 Pro e do Galaxy S24 Ultra').join(', '),
        ti.re.test('a rtx 5070 ti custa') && !ti.re.test('a rtx 5070 custa') || 'regra do 5070 Ti',
        x80.re.test('RTX 5080 por') && !x80.re.test('RTX 5080 Super por') || 'regra do 5080',
        s.ehPedidoDeSerieDePrecos(PEDIDO) && !s.ehPedidoDeSerieDePrecos('qual a diferença de desempenho entre a RTX 5070 Ti e a RTX 5080?') ||
          'detecção do pedido de série',
      ];
    },
  },

  {
    nome: 'série de preços: parcela e preço sem data ficam fora, real e dólar não se misturam, média e menor por mês calculados pelo código',
    tipo: 'unidade',
    executar() {
      const r = s.montarSerie({ objetivo: PEDIDO, fontes: FONTES, hoje: '2026-09-26' });
      const a = r?.analise;
      const ti = a?.resumo.find((x) => x.produto === 'RTX 5070 Ti');
      const x80 = a?.resumo.find((x) => x.produto === 'RTX 5080');
      return [
        a?.moeda === 'BRL' || `moeda: ${a?.moeda}`,
        JSON.stringify(a?.meses) === JSON.stringify(['2025-02', '2025-06', '2026-09']) || `meses: ${JSON.stringify(a?.meses)}`,
        // revisão v5: página de LOJA sem data na frase = preço de hoje (antes ficava fora como "sem data")
        ti?.n === 4 && ti?.media === 6424.7 || `5070 Ti: ${JSON.stringify(ti)}`,
        x80?.n === 3 && x80?.media === 8932.63 || `5080 (a parcela de R$ 700 não pode entrar): ${JSON.stringify(x80)}`,
        a?.outraMoeda === 1 || 'o US$ 749 fica fora da média em reais',
        a?.semData === 0 && a?.usadas.some((o) => o.dominio === 'kabum.com.br' && o.mes === '2026-09') || 'o preço da loja entra como preço de hoje (revisão v5)',
        /\| fev\/2025 \| R\$ 7\.499,00 \| R\$ 9\.999,00 \|/.test(r?.bloco || '') || `tabela: ${r?.bloco}`,
        /MÉTODO: .*MENOR preço observado/.test(r?.bloco || '') || 'o método tem que ir pro redator',
        /série é parcial/.test(r?.bloco || '') || 'poucos meses → avisar que a série é parcial',
        /```chart\n/.test(r?.grafico || '') && /"label": "RTX 5080"/.test(r?.grafico || '') || 'gráfico da série',
      ];
    },
  },

  {
    nome: 'verificador: dólar convertido em real numa razão impossível e "média" que é faixa viram inconsistência (10º teste real)',
    tipo: 'unidade',
    executar() {
      const ruim =
        'A Nvidia manteve as placas a mais de $1.000 (R$ 1.000 a R$ 1.200). Preço médio: R$ 8.499,99 a R$ 9.599,99.';
      const boa = 'A RTX 5070 Ti foi anunciada por US$ 749 (cerca de R$ 4.100). A média calculada foi R$ 6.566,27.';
      const i1 = verificador.inconsistenciasNumericas(ruim);
      const i2 = verificador.inconsistenciasNumericas(boa);
      const v = verificador.verificar({ resposta: ruim, dossie: [{ texto: ruim }], objetivo: 'preço da rtx 5070 ti' });
      return [
        i1.some((i) => i.tipo === 'moeda') || `conversão 1:1 não detectada: ${JSON.stringify(i1)}`,
        i1.some((i) => i.tipo === 'media-intervalo') || 'faixa chamada de média não detectada',
        !i2.length || `falso positivo: ${JSON.stringify(i2)}`,
        v.reescrever === true && v.aprovado === false || 'inconsistência deveria pedir reescrita',
        /não fecham entre si/.test(verificador.instrucaoDeCorrecao(v)) || 'instrução de correção sem a inconsistência',
      ];
    },
  },

  {
    nome: 'série de preços (ponta a ponta): o código calcula, o gráfico entra na resposta e cumpre o item "construir gráfico" do plano',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'preco',
          paginas: [
            pagina('A RTX 5070 Ti chegou ao Brasil por R$ 7.499,00 em fevereiro de 2025, e a RTX 5080 por R$ 9.999,00 em fevereiro de 2025.'),
            pagina('Em junho de 2025 a RTX 5070 Ti caiu para R$ 6.299,90, enquanto a RTX 5080 estava em R$ 8.899,00 em junho de 2025.'),
          ],
        },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'série ponta a ponta',
          pedido: PEDIDO,
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: false, pipelineForcadoUniversal: true, criticaPeriodica: false },
          planejamentoInicial: '- Pesquisar o histórico de preços das duas placas\n- Construir um gráfico relacionando a média com as datas',
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'historico preco rtx 5070 ti rtx 5080' }, plano: ['Construir um gráfico relacionando a média com as datas'] },
            { ferramenta: 'responder', argumentos: { foco: 'histórico de preços' }, plano: ['Construir um gráfico relacionando a média com as datas'] },
          ],
          redacao: 'A RTX 5070 Ti teve média de R$ 6.899,45 e a RTX 5080 de R$ 9.449,00 nos meses encontrados (fev/2025 e jun/2025).',
        });
        return [
          /DADOS CALCULADOS PELO CÓDIGO/.test(obtido.promptRedacao) || 'o bloco calculado não chegou ao redator',
          /R\$ 6\.899,45/.test(obtido.promptRedacao) || `média calculada errada: ${obtido.promptRedacao.slice(0, 300)}`,
          /```chart/.test(obtido.resposta) || `gráfico da série fora da resposta: ${obtido.resposta}`,
          !obtido.copiloto.some((c) => c.gate === 'checklist-pendente') || 'o gráfico da série cumpre o item — responder não deveria ser barrado',
          !/O que ficou faltando/.test(obtido.resposta) || 'item cumprido pela série não pode sair como faltando',
          obtido.suspeitasFinais === 0 || obtido.suspeitasFinais === undefined || `números calculados viraram suspeita: ${obtido.suspeitasFinais}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
];
