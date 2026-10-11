'use strict';

const tools = require('../../src/tools');
const { Skills } = require('../../src/skills');
const path = require('path');
const os = require('os');

module.exports = [
  {
    nome: 'catálogo seletivo encolhe sem esconder o necessário',
    tipo: 'unidade',
    async executar() {
      const skills = new Skills({
        dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
        dirUsuario: path.join(os.tmpdir(), 'augpt-skills-desempenho'),
      });
      const completo = tools.catalogo();
      const problemas = [];

      const cenarios = [
        ['Analise o boleto.pdf anexado', ['ler_documento']],
        ['Gere uma planilha xlsx com o comparativo', ['gerar_xlsx']],
        ['Revise a função de login em auth.js', ['buscar_no_projeto']],
        ['Qual a previsão do tempo para Vitória?', ['pesquisar_e_ler']],
      ];

      for (const [pedido, esperadas] of cenarios) {
        const garantir = [...new Set((await skills.selecionar(pedido, { etapa: 'decisao' })).flatMap((k) => k.ferramentas || []))];
        const seletivo = tools.catalogo([], garantir, { pedido, seletivo: true });

        for (const nome of [...esperadas, ...tools.NUCLEO]) {
          if (!new RegExp(`^- ${nome}:`, 'm').test(seletivo)) problemas.push(`"${pedido.slice(0, 24)}" escondeu ${nome}`);
        }
        if (seletivo.length >= completo.length) problemas.push(`"${pedido.slice(0, 24)}" não encolheu`);
        // o que sai da lista completa ainda precisa ser mencionado por nome
        if (!seletivo.includes('Também disponíveis')) problemas.push(`"${pedido.slice(0, 24)}" omitiu as demais`);
      }

      return problemas.length ? problemas.slice(0, 4) : [true];
    },
  },

  {
    // Caso real de produção (Davi): configurou o Copiloto nível 2 no modo
    // "2 IAs" certinho, mas em três conversas seguidas — incluindo uma com
    // 7 falhas de protocolo em sequência, o cenário onde mais fazia sentido
    // pedir uma segunda opinião — o modelo dedicado ficou ocioso o tempo
    // inteiro. Causa raiz: `consultar_critico` não estava no NUCLEO, então
    // o catálogo seletivo (`relevancia()`, compara nome/descrição da
    // ferramenta com o TEXTO DO PEDIDO) quase sempre pontuava ela em 0 —
    // pedidos normais não têm as palavras "consultar" ou "crítico" — e ela
    // caía na lista "também disponíveis" (só o nome, sem dizer PRA QUE
    // serve). O agente nunca tinha como saber que a ferramenta existia pra
    // pedir ajuda quando estava inseguro. Este teste usa de propósito um
    // pedido que não compartilha nenhuma palavra com o nome/descrição da
    // ferramenta, exatamente o cenário que expunha o bug.
    nome: 'consultar_critico aparece com descrição completa no catálogo seletivo mesmo sem nenhuma relação com o pedido',
    tipo: 'unidade',
    executar() {
      // Pedido escolhido de propósito por não compartilhar NENHUMA palavra
      // com o nome ou a descrição de consultar_critico (relevancia() = 0
      // pra ela aqui) — é exatamente esse tipo de pedido comum que expunha
      // o bug antes dela entrar pro NUCLEO.
      const pedido = 'Baixe a cotação do dólar de hoje';
      return [
        tools.relevancia(tools.get('consultar_critico'), pedido) === 0 ||
          'pré-condição do teste furou: este pedido deveria pontuar 0 pra consultar_critico',
        tools.NUCLEO.includes('consultar_critico') || 'consultar_critico precisa estar no NUCLEO',
        /^- consultar_critico:/m.test(tools.catalogo([], [], { pedido, seletivo: true })) ||
          'consultar_critico deveria vir com descrição completa (está no NUCLEO), não só o nome',
      ];
    },
  },

  {
    nome: 'prompt não repete blocos voláteis antes do histórico',
    pedido: 'Liste os arquivos',
    arquivos: { 'a.txt': 'x' },
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'os arquivos' } },
    ],
    redacao: 'A pasta contém a.txt.',
    espera: {
      ok: true,
      // o prefixo estável (instruções + catálogo) tem de vir antes do histórico
      prefixoEstavel: true,
    },
  },

  {
    nome: 'histórico enxuga resultados antigos e mantém os recentes',
    pedido: 'Leia os três arquivos e resuma',
    arquivos: {
      'a.txt': `Arquivo A: ${'conteúdo extenso que não precisa ser relido a cada decisão. '.repeat(40)}`,
      'b.txt': `Arquivo B: ${'outro bloco longo de texto para ocupar o histórico. '.repeat(40)}`,
      'c.txt': 'Arquivo C: dado final relevante.',
    },
    config: { destilarFatos: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'a.txt' } },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'b.txt' } },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'c.txt' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'os três arquivos' } },
    ],
    redacao: 'Os três arquivos foram lidos.',
    espera: {
      ok: true,
      historicoEnxuto: {
        // na última decisão, o conteúdo do primeiro arquivo já virou uma linha
        semNaUltima: ['conteúdo extenso que não precisa'],
        comNaUltima: ['RESULTADO DE ler_arquivo: ok'],
      },
      // e a decisão guardada não repete pensamento/plano/crítica
      promptDecisaoNaoContem: ['"critica":'],
    },
  },

  {
    nome: 'memória vetorial não é consultada a cada passo',
    pedido: 'Liste e responda',
    arquivos: { 'a.txt': 'x' },
    embeddings: true,
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'a.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'x' } },
    ],
    redacao: 'Pronto.',
    espera: { ok: true, buscasNaMemoria: { max: 2 } },
  },

  {
    nome: 'teto de buscas encerra o encadeamento de consultas',
    pedido: 'Pesquise a fundo sobre a economia brasileira',
    config: { profundidadePesquisa: 'normal', destilarFatos: false },
    // cada consulta é diferente, então o guarda de repetição não pega
    roteiro: [
      { ferramenta: 'buscar_web', argumentos: { consulta: 'economia brasil pib' } },
      { ferramenta: 'buscar_web', argumentos: { consulta: 'economia brasil inflação' } },
      { ferramenta: 'buscar_web', argumentos: { consulta: 'economia brasil câmbio' } },
      { ferramenta: 'buscar_web', argumentos: { consulta: 'economia brasil juros' } },
      { ferramenta: 'buscar_web', argumentos: { consulta: 'economia brasil emprego' } },
      { ferramenta: 'buscar_web', argumentos: { consulta: 'economia brasil dívida' } },
      { ferramenta: 'responder', argumentos: { foco: 'panorama' } },
    ],
    redacao: 'Panorama econômico com o material coletado.',
    espera: {
      ok: true,
      erroContem: ['Limite de 4 buscas'],
      passos: { max: 8 },
      // Backlog do Copiloto, item m1: este gate também passa pelo helper
      // comum agora — confere o nome certo.
      copilotoGates: ['teto-de-buscas', 'teto-de-buscas'],
    },
  },

  {
    nome: 'tokens de redação e destilação entram na conta',
    pedido: 'O que diz o arquivo?',
    arquivos: {
      'base.txt': Array.from(
        { length: 25 },
        (_, i) => `Linha ${i + 1}: dado relevante com o valor de R$ 1.${240 + i},00 registrado no período.`
      ).join('\n'),
    },
    config: { destilarFatos: true, destilarAcimaDe: 500 },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o conteúdo' } },
    ],
    redacao: 'O arquivo registra o valor de 1.240.',
    espera: {
      ok: true,
      destilou: true,
      // antes, só as decisões contavam: execução por rotina ficava com zero
      tokensMin: 500,
    },
  },

  {
    nome: 'citação numerada bate com o rodapé de fontes',
    tipo: 'unidade',
    executar() {
      const prompts = require('../../src/agent/prompts');
      const pedido = prompts.pedidoDeResposta({
        objetivo: 'previsão do tempo',
        material: '- [1] máxima de 32°C na sexta\n- [2] 30% de chance de chuva',
        fontes: [
          { numero: 1, titulo: 'Climatempo', dominio: 'climatempo.com.br', url: 'https://climatempo.com.br/x', data: '2026-08-12' },
          { numero: 2, titulo: 'Tempo.com', dominio: 'tempo.com', url: 'https://tempo.com/y' },
        ],
      });
      const sistema = prompts.redator('boa');
      return [
        pedido.includes('FONTES NUMERADAS') || 'não listou as fontes numeradas',
        pedido.includes('[1] Climatempo') || 'numeração não bate com o material',
        pedido.includes('2026-08-12') || 'perdeu a data da fonte',
        /CITAÇÃO/.test(sistema) || 'o redator não foi instruído a citar',
        /não cite fonte que não existe/.test(sistema) || 'faltou a trava contra fonte inventada',
      ];
    },
  },
];
