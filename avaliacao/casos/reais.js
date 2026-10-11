'use strict';

/**
 * Tarefas para o modo real (--real). Não têm roteiro: o modelo decide sozinho.
 *
 * Cada uma declara `fatos` — dados que a resposta correta precisa conter. É a
 * única forma honesta de medir qualidade sem um juiz externo: a tarefa carrega
 * o gabarito, e a nota é a proporção de fatos que apareceram.
 *
 * Ignoradas no modo determinístico, porque dependem do modelo de verdade.
 */

const path = require('path');
const fixture = (n) => ({ copiarDe: path.join(__dirname, '..', 'fixtures', n) });

const BOLETO = `BANCO ITAU S.A. - Recibo do Pagador
Beneficiário: ESCOLA EXEMPLO LTDA - CNPJ: 00.000.000/0001-00
Valor do documento: R$ 410,49
Vencimento: 17/08/2026
Parcela: 2026 / 8
Multa após o vencimento: R$ 8,21
Após o vencimento, cobrar juros de R$ 0,14 por dia de atraso.
Pagto até o dia 13/08/2026: R$ 287,34`;

const VENDAS = `regiao;pedidos;faturamento
Sudeste;1204;482900,50
Nordeste;673;201450,00
Sul;389;121300,25`;

module.exports = [
  {
    nome: 'real: extrair dados de um boleto',
    somenteReal: true,
    pedido: 'Analise o boleto.txt e me diga o valor, o vencimento e o que acontece se eu atrasar.',
    arquivos: { 'boleto.txt': BOLETO },
    fatos: ['410,49', '17/08/2026', '8,21', '0,14'],
    maxIterations: 8,
  },

  {
    nome: 'real: ler planilha e somar',
    somenteReal: true,
    pedido: 'Some o faturamento das três regiões do vendas.csv e diga o total e qual região vendeu mais.',
    arquivos: { 'vendas.csv': VENDAS },
    fatos: ['805.650', 'Sudeste'],
    maxIterations: 10,
  },

  {
    nome: 'real: ler documento Word com tabela',
    somenteReal: true,
    pedido: 'O que diz o relatorio.docx? Cite os números da tabela.',
    arquivos: { 'relatorio.docx': fixture('relatorio.docx') },
    fatos: ['1.204', '482.900', 'Sudeste'],
    maxIterations: 8,
  },

  {
    nome: 'real: ler PDF e responder pergunta específica',
    somenteReal: true,
    pedido: 'Segundo o manual.pdf, de quanto em quanto tempo deve ser feita a revisão?',
    arquivos: { 'manual.pdf': fixture('manual.pdf') },
    fatos: ['10.000', '6 meses'],
    maxIterations: 8,
  },

  {
    nome: 'real: responder pergunta conceitual sem material',
    somenteReal: true,
    pedido: 'O Ollama consegue criar arquivos PDF e Word sozinho? Responda em até 10 linhas.',
    fatos: ['texto', 'programa'],
    maxIterations: 8,
  },

  {
    nome: 'real: cálculo exato',
    somenteReal: true,
    pedido: 'Quanto é (12783,23 * 0,17) + 823,42? Use a ferramenta de cálculo.',
    fatos: ['2996', '2.996'],
    maxIterations: 6,
  },

  {
    nome: 'real: criar arquivo com conteúdo pedido',
    somenteReal: true,
    pedido: 'Crie um arquivo resumo.md com um título e três itens sobre manutenção preventiva.',
    fatos: ['resumo.md'],
    arquivosEsperados: ['resumo.md'],
    maxIterations: 8,
  },

  {
    nome: 'real: seguir tamanho pedido',
    somenteReal: true,
    pedido: 'Faça um resumo de 20 linhas sobre o conteúdo de base.txt.',
    arquivos: {
      'base.txt':
        'A manutenção preventiva da frota deve ocorrer a cada 10.000 km ou 6 meses. ' +
        'Os itens verificados são óleo do motor, filtros, pastilhas de freio e calibragem dos pneus. ' +
        'O custo médio por revisão é de R$ 780,00 e o tempo de parada é de 4 horas.',
    },
    fatos: ['10.000', '780'],
    linhasMinimas: 14,
    maxIterations: 8,
  },

  {
    nome: 'real: não inventar quando o dado não existe',
    somenteReal: true,
    pedido: 'Qual é o CNPJ do fornecedor citado em nota.txt?',
    arquivos: { 'nota.txt': 'Nota de serviço emitida em 12/08/2026, valor de R$ 1.240,00, sem dados do fornecedor.' },
    naoDeveConter: ['00.000.000'],
    fatos: ['não'],
    maxIterations: 8,
  },
];
