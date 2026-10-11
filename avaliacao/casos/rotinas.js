'use strict';

module.exports = [
  {
    nome: 'rotina resolve a tarefa em um passo, sem decisão do modelo',
    pedido: 'Analise o boleto.txt e me diga o valor',
    arquivos: { 'boleto.txt': 'Valor do documento R$ 410,49 · Vencimento 17/08/2026' },
    parametros: { arquivo: 'boleto.txt' }, // ligar `parametros` habilita rotinas
    roteiro: [], // vazio de propósito: se a rotina falhar, não há decisão de reserva
    redacao: 'O boleto tem valor de R$ 410,49 com vencimento em 17/08/2026.',
    espera: {
      ok: true,
      rotinaUsada: 'Analisar documento anexado',
      rotinaConcluida: true,
      ferramentasChamadas: ['ler_documento'],
      passos: { max: 1 },
      respostaContem: ['410,49'],
      promptRedacaoContem: ['Tabela de campo e valor'], // o foco da rotina
    },
  },

  {
    nome: 'parâmetro ausente devolve o controle ao agente',
    pedido: 'Analise o documento',
    arquivos: { 'nota.txt': 'Valor de R$ 90,00' },
    parametros: { arquivo: null }, // o modelo não achou o nome no pedido
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'A nota registra R$ 90,00.',
    espera: {
      ok: true,
      rotinaUsada: false,
      ferramentasChamadas: ['listar_arquivos', 'ler_arquivo'],
      respostaContem: ['90,00'],
    },
  },

  {
    nome: 'passo que falha entrega o controle sem perder o coletado',
    pedido: 'Analise o relatorio-inexistente.pdf',
    arquivos: { 'outro.txt': 'conteúdo qualquer' },
    parametros: { arquivo: 'relatorio-inexistente.pdf' },
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o que existe na pasta' } },
    ],
    redacao: 'O arquivo pedido não existe; a pasta contém outro.txt.',
    espera: {
      ok: true,
      rotinaUsada: true,
      rotinaConcluida: false,
      ferramentasChamadas: ['ler_documento', 'listar_arquivos'],
      respostaContem: ['outro.txt'],
    },
  },

  {
    nome: 'rotina desligada na configuração não roda',
    pedido: 'Analise o boleto.txt',
    arquivos: { 'boleto.txt': 'Valor R$ 410,49' },
    parametros: { arquivo: 'boleto.txt' },
    config: { usarRotinas: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'Valor de R$ 410,49.',
    espera: { ok: true, rotinaUsada: false, ferramentasChamadas: ['ler_arquivo'] },
  },
];
