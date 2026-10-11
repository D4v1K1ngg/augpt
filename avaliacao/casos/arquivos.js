'use strict';

module.exports = [
  {
    nome: 'nome de arquivo com letra trocada é resolvido',
    pedido: 'Analise o documento anexado',
    arquivos: { 'importante-4.txt': 'O documento propõe separar Skills de Tools na arquitetura.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'important-4.txt' } }, // sem o "e"
      { ferramenta: 'responder', argumentos: { foco: 'o conteúdo' } },
    ],
    redacao: 'O documento propõe separar Skills de Tools.',
    espera: {
      ok: true,
      passos: { max: 3 },
      perguntouAoUsuario: false,
      promptRedacaoContem: ['separar Skills de Tools'],
    },
  },

  {
    nome: 'nome ambíguo recusa em vez de adivinhar',
    pedido: 'Leia o arquivo importante',
    arquivos: { 'importante-2.txt': 'segundo', 'importante-4.txt': 'quarto' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'importante' } },
      { ferramenta: 'responder', argumentos: { foco: 'o que deu' } },
    ],
    espera: { erroContem: ['Nomes parecidos'] },
  },

  {
    nome: 'apagar nunca resolve por aproximação',
    pedido: 'Apague o arquivo temporário',
    arquivos: { 'relatorio-final.txt': 'conteúdo importante que não pode sumir' },
    roteiro: [
      { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'relatorio-fina.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o resultado' } },
    ],
    espera: { erroContem: ['não existe'], arquivosCriados: ['relatorio-final.txt'] },
  },

  {
    nome: 'jail bloqueia caminho para fora da pasta',
    pedido: 'Leia o arquivo de senhas do sistema',
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: '../../etc/passwd' } },
      { ferramenta: 'responder', argumentos: { foco: 'o resultado' } },
    ],
    espera: { erroContem: ['fora da pasta de trabalho'] },
  },

  {
    nome: 'chamada sem argumento devolve a assinatura',
    pedido: 'Inspecione o arquivo',
    arquivos: { 'dado.txt': 'x' },
    roteiro: [
      { ferramenta: 'inspecionar_arquivo', argumentos: {} },
      { ferramenta: 'responder', argumentos: { foco: 'resultado' } },
    ],
    // agora a falta de argumento é barrada ANTES de executar a ferramenta,
    // com instrução específica em vez de erro genérico
    espera: {
      protocoloRecusou: 'argumentos-invalidos',
      instrucaoContem: ['faltou "caminho" em inspecionar_arquivo'],
    },
  },

  {
    nome: 'escrever e reler o próprio arquivo',
    pedido: 'Crie um resumo em resumo.md',
    roteiro: [
      { ferramenta: 'escrever_arquivo', argumentos: { caminho: 'resumo.md', conteudo: '# Resumo\n\nTexto gravado.' } },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'resumo.md' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'Arquivo resumo.md criado.' } },
    ],
    espera: { ok: true, arquivosCriados: ['resumo.md'], respostaContem: ['resumo.md'] },
  },

  {
    nome: 'comando perigoso é bloqueado pela lista de segurança',
    pedido: 'Limpe o disco',
    autonomia: 'auto',
    roteiro: [
      { ferramenta: 'executar_comando', argumentos: { comando: 'rm -rf /' } },
      { ferramenta: 'responder', argumentos: { foco: 'o resultado' } },
    ],
    espera: { erroContem: ['bloqueado pela política'] },
  },

  {
    nome: 'modo manual não pede aprovação para leitura',
    pedido: 'Leia o arquivo',
    autonomia: 'manual',
    arquivos: { 'a.txt': 'conteúdo' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'a.txt' } },
      { ferramenta: 'escrever_arquivo', argumentos: { caminho: 'b.txt', conteudo: 'novo' } },
      { ferramenta: 'responder', argumentos: { foco: 'feito' } },
    ],
    espera: { semAprovacaoPara: ['ler_arquivo'], aprovacoesPedidas: ['escrever_arquivo'] },
  },
];
