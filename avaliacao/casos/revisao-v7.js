'use strict';

/**
 * Revisão v7 (2026-10-12): o que a leitura das conversas reais de 11–12/10
 * mostrou. O risco maior deixou de ser a lentidão: era o agente entender
 * errado o pedido e entregar assim mesmo.
 *
 *   - "Compare 3 IEMs para FPS e gere uma planilha" respondeu sobre trabalhos
 *     de conclusão de curso (a busca achou uma faculdade de sigla FPS);
 *   - "O Bose QC 20 é usado por muitos pro players?" respondeu com a tabela
 *     dos mais usados, sem dizer nada do Bose QC 20;
 *   - no modo automático o agente parou duas vezes para perguntar (477 s);
 *   - a resposta rápida era gravada com o pedido em branco.
 */

const { executarCasoAgente } = require('../motor');
const compositor = require('../../src/agent/compositor');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');

// mais de 400 caracteres e nenhuma palavra do pedido dos casos abaixo
const SOBRE_TCC =
  'Aqui está a lista de trabalhos de conclusão de curso da universidade: o primeiro estuda a espessura muscular medida por ultrassom portátil; ' +
  'o segundo analisa a ansiedade de atletas antes de provas; o terceiro revisa métodos de avaliação nutricional em idosos; ' +
  'o quarto descreve a rotina de enfermeiros em unidades de terapia intensiva; o quinto investiga o sono de estudantes de medicina durante o internato ' +
  'e a relação com o rendimento nas avaliações semestrais da graduação.';
const PEDIDO = 'Quais as diferenças de palco sonoro entre os fones Alfa e Beta?';
const ARQUIVO_TCC = { 'tcc.txt': `${SOBRE_TCC} `.repeat(4) };
const ARQUIVO_FONES = { 'fones.txt': 'O fone Alfa tem palco sonoro amplo, com boa separação. O fone Beta tem palco sonoro mais fechado, porém graves mais fortes. '.repeat(14) };

module.exports = [
  {
    nome: 'v7: resposta longa sem NENHUM termo do pedido não é entregue — sem material do assunto, o agente diz que não achou (caso real: "Compare 3 IEMs para FPS" respondido com trabalhos de conclusão de curso)',
    pedido: PEDIDO,
    arquivos: ARQUIVO_TCC,
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'tcc.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'diferenças de palco sonoro' } },
    ],
    redacao: SOBRE_TCC,
    espera: {
      ok: true,
      respostaContem: ['Não consegui montar uma resposta confiável'],
      respostaNaoContem: ['trabalhos de conclusão de curso'],
    },
  },
  {
    nome: 'v7: fora do assunto, mas HÁ material que trata do pedido — refaz só com ele e entrega a resposta certa',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v7 fora do assunto recuperado',
        pedido: PEDIDO,
        arquivos: { ...ARQUIVO_TCC, ...ARQUIVO_FONES },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'tcc.txt' } },
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fones.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'diferenças de palco sonoro' } },
        ],
        // as duas primeiras redações saem sobre o outro assunto; a terceira recebe só o material dos fones
        redacao: (prompt, n) => (n <= 2 ? SOBRE_TCC : 'O fone Alfa tem palco sonoro amplo; o fone Beta, um palco sonoro mais fechado. Essa é a principal diferença entre os dois.'),
      });
      const ultima = obtido.promptRedacao.split('MATERIAL').pop();
      return [
        /palco sonoro amplo/.test(obtido.resposta) || `deveria entregar a resposta sobre os fones: ${obtido.resposta.slice(0, 120)}`,
        !/Não consegui montar/.test(obtido.resposta) || 'com material do assunto não é caso de desistir',
        obtido.chamadasRedacao === 3 || `esperava 3 redações (a original, a reescrita e a refeita com o material certo), houve ${obtido.chamadasRedacao}`,
        !/ultrassom/.test(ultima) || 'a redação refeita não pode receber o material do outro assunto',
      ];
    },
  },
  {
    nome: 'v7: resposta curta e direta, sem repetir as palavras da pergunta, NÃO é "fora do assunto"',
    pedido: PEDIDO,
    arquivos: ARQUIVO_FONES,
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fones.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'diferenças' } },
    ],
    redacao: 'O primeiro é mais aberto; o segundo, mais fechado.',
    espera: { ok: true, respostaContem: ['mais aberto'], respostaNaoContem: ['Não consegui montar'] },
  },
  {
    nome: 'v7: comparação de produtos com arquivo de SAÍDA é pedido de produto (vai para a pesquisa planejada); arquivo de ENTRADA e pedido só de arquivo continuam "local"',
    tipo: 'unidade',
    executar() {
      const tipo = (p) => tipoDoPedido(p).tipo;
      return [
        tipo('Compare 3 IEMs para FPS e gere uma planilha com o comparativo') === 'produto' || 'comparar produtos + planilha de saída é produto',
        /arquivo de saída/.test(tipoDoPedido('Compare 3 IEMs para FPS e gere uma planilha com o comparativo').motivo) || 'o motivo registra que há arquivo de saída',
        tipo('Qual o melhor mouse para fps? Coloque numa planilha') === 'produto' || 'escolha de produto + planilha',
        tipo('Crie uma planilha com os gastos do extrato.csv') === 'local' || 'arquivo de entrada (extrato.csv) é local',
        tipo('Leia o contrato.pdf e me diga as multas') === 'local' || 'ler documento é local',
        tipo('Gere um pdf com um resumo da reunião') === 'local' || 'pedido que é só gerar arquivo continua local',
        tipo('Analise o boleto que anexei e gere um pdf') === 'local' || 'anexo + arquivo de saída é local',
      ];
    },
  },
  {
    nome: 'v7: pergunta sobre UM produto nas listas dos profissionais responde sobre ele — está na lista (quantos, em que lugar) ou não aparece; sem produto nomeado, nada muda',
    tipo: 'unidade',
    executar() {
      const uso = {
        total: 48,
        ranking: [
          { produto: 'HyperX Cloud II', jogadores: 16, parcela: 33.3, exemplos: ['Space', 'Verbo'] },
          { produto: 'Logitech G Pro', jogadores: 7, parcela: 14.6, exemplos: ['Kalios'] },
          { produto: 'Bose QC20', jogadores: 2, parcela: 4.2, exemplos: ['Stoop'] },
        ],
      };
      const montar = (objetivo, u = uso) => compositor.montar({ modo: 'uso-profissional', objetivo, uso: u }, new Map());
      const naLista = montar('O Bose QC 20 é usado por muitos pro players?');
      const fora = montar('O Bose QC 20 é usado por muitos pro players?', { ...uso, ranking: uso.ranking.slice(0, 2) });
      const geral = montar('Qual o fone mais usado pelos profissionais de PUBG?');
      return [
        /### Resposta direta\nO \*\*Bose QC 20\*\* aparece com 2 de 48 jogadores listados \(4,2%\), em 3º lugar/.test(naLista) || `produto que está na lista: ${naLista.slice(0, 200)}`,
        /O \*\*Bose QC 20\*\* não aparece entre os 48 profissionais listados/.test(fora) || `produto fora da lista: ${fora.slice(0, 200)}`,
        /o mais usado é o \*\*HyperX Cloud II\*\*/.test(naLista) || 'a tabela dos mais usados continua vindo depois',
        /^### Resposta direta\nEntre os profissionais listados/.test(geral) || `sem produto nomeado, a resposta de sempre: ${geral.slice(0, 120)}`,
      ];
    },
  },
  {
    nome: 'v7: no modo automático o agente não para pra perguntar — recebe a instrução de seguir com a suposição e declará-la (caso real: 477 de 957 s esperando resposta)',
    pedido: 'Qual das duas placas de vídeo eu devo comprar?',
    arquivos: { 'nota.txt': 'RTX 5070 Ti e RTX 5080.' },
    config: { naoPerguntarNoAutomatico: true },
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: {} },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
      { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'Qual é o seu orçamento para a placa de vídeo?' } },
      { ferramenta: 'responder', argumentos: { foco: 'qual comprar, supondo orçamento médio' } },
    ],
    redacao: 'Supondo um orçamento médio, a RTX 5070 Ti é a escolha mais equilibrada das duas placas de vídeo.',
    espera: { ok: true, perguntouAoUsuario: false, erroContem: ['Modo automático: o usuário pediu para não ser interrompido'], respostaContem: ['Supondo um orçamento médio'] },
  },
  {
    nome: 'v7: a resposta rápida do AUTO grava o pedido no registro (antes ficava em branco)',
    tipo: 'unidade',
    async executar() {
      const pedido = 'Quem foi Galileu Galilei?';
      const obtido = await executarCasoAgente({
        nome: 'v7 registro da resposta rapida',
        pedido,
        config: { modoAuto: true },
        depsRespostaRapida: {
          buscar: async () => ({ resultados: [] }),
          wikipedia: async (_a, idioma) => (idioma === 'pt' ? { idioma, titulo: 'Galileu Galilei', url: 'https://pt.wikipedia.org/wiki/Galileu_Galilei', introducao: 'Galileu Galilei foi um astrônomo e físico italiano.', campos: [] } : null),
          escrever: async () => ({ content: 'Galileu Galilei foi um astrônomo e físico italiano.' }),
        },
      });
      return [
        obtido.passos === 0 || `deveria responder pelo caminho rápido, sem o laço (passos: ${obtido.passos})`,
        obtido.registro?.pedido === pedido || `pedido no registro: ${JSON.stringify(obtido.registro?.pedido)}`,
      ];
    },
  },
  {
    nome: 'v7 (uso real de 12/10): UM produto citado pelo plano e escrito no pedido é avaliação daquele produto ("fone bose qc 20") — categoria, nome fora do pedido e pedido de alternativas continuam na descoberta',
    tipo: 'unidade',
    executar() {
      const unico = require('../../src/agent/motor-pesquisa').produtoUnicoDoPedido;
      return [
        unico('fone bose qc 20', ['Bose QC 20']) === true || 'nome com modelo, escrito no pedido em minúsculas',
        unico('O fone de ouvido bose qc 20 e bom para jogar pubg ?', ['Bose QC 20']) === true || 'pergunta sobre um produto',
        unico('O Audeze Maxwell vale a pena?', ['Audeze Maxwell']) === true || 'nome sem dígito, com duas palavras',
        unico('Qual o melhor fone gamer para pubg?', ['fone gamer']) === false || 'categoria não é produto',
        unico('Qual o melhor fone para pubg?', ['HyperX Cloud II']) === false || 'nome que o modelo lembrou e não está no pedido',
        unico('Alternativas ao Bose QC 20', ['Bose QC 20']) === false || 'pedir alternativas é descoberta',
        unico('Qual o melhor mouse da Razer?', ['Razer']) === false || 'marca sozinha não é um produto',
        unico('Bose QC 20 ou Sony WF-1000XM5?', ['Bose QC 20', 'Sony WF-1000XM5']) === false || 'duas opções já têm o caminho da comparação',
      ];
    },
  },
];
