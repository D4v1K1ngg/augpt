'use strict';

/**
 * Conferência das ações (25/10): o código confere o que as ferramentas fizeram antes do "pronto".
 * Casos das execuções reais do Davi: "EnableLoudness.ps1 foi salvo localmente" (não foi), o PDF
 * "gerado com sucesso", o comando que o agente nem rodou, e o erro do cmd embaralhado ("n�o").
 */

const fs = require('fs');
const path = require('path');
const c = require('../../src/agent/conferencia');
const { decodificar } = require('../../src/tools/shell');

const pasta = { 'relatorio.pdf': 12000, 'notas.txt': 0 };
const tamanhoDe = (n) => (n in pasta ? pasta[n] : null);

module.exports = [
  {
    nome: 'conferência: arquivo existe e não está vazio, comando com código 0, site sem erro — o que a ferramenta DISSE não basta; arquivo reescrito vale a última vez',
    tipo: 'unidade',
    executar() {
      const itens = c.conferirAcoes(
        [
          { nome: 'gerar_pdf', argumentos: { arquivo: 'relatorio.pdf' }, resultado: 'Arquivo criado: relatorio.pdf (12 KB)' },
          { nome: 'escrever_arquivo', argumentos: { caminho: 'EnableLoudness.ps1' }, erro: 'Caracteres inválidos no caminho.' },
          { nome: 'escrever_arquivo', argumentos: { caminho: 'notas.txt' }, resultado: 'Gravado 0 bytes em notas.txt' },
          { nome: 'escrever_arquivo', argumentos: { caminho: 'sumiu.txt' }, resultado: 'Gravado 10 bytes em sumiu.txt' },
          { nome: 'executar_comando', argumentos: { comando: 'x --versao' }, resultado: "código de saída: 1\nstderr:\n'x' não é reconhecido como um comando interno\r\nou externo, um programa operável" },
          { nome: 'executar_codigo', argumentos: { linguagem: 'python' }, resultado: 'código de saída: 0\nstdout:\n42' },
          { nome: 'clicar', resultado: 'ok' },
          { nome: 'clicar', erro: 'elemento [7] não existe' },
          { nome: 'pesquisar_e_ler', resultado: 'x' },
        ],
        { tamanhoDe }
      );
      const t = itens.map((i) => `${i.ok ? '✓' : '✗'} ${i.texto}`);
      const reescrito = c.conferirAcoes([{ nome: 'escrever_arquivo', argumentos: { caminho: 'relatorio.pdf' }, erro: 'falhou' }, { nome: 'gerar_pdf', argumentos: { arquivo: 'relatorio.pdf' }, resultado: 'Arquivo criado: relatorio.pdf (12 KB)' }], { tamanhoDe });
      return [
        t[0] === '✓ relatorio.pdf (12 KB)' || t[0],
        /^✗ EnableLoudness\.ps1: não foi criado/.test(t[1]) || t[1],
        /^✗ notas\.txt: foi criado vazio/.test(t[2]) || t[2],
        /^✗ sumiu\.txt: a ferramenta disse que gravou, mas o arquivo não está/.test(t[3]) || t[3],
        /^✗ comando `x --versao`: terminou com erro \(código 1\): 'x' não é reconhecido como um comando interno$/.test(t[4]) || t[4],
        t[5] === '✓ script python: rodou sem erro' || t[5],
        /^✗ clicar no site: elemento \[7\]/.test(t[6]) && t[7] === '✓ 1 ação no site sem erro' || `${t[6]} / ${t[7]}`,
        t.length === 8 || `itens: ${t.length} (pesquisar_e_ler não é ação)`,
        reescrito.length === 1 && reescrito[0].ok || 'reescrito: a última vale',
      ];
    },
  },
  {
    nome: 'conferência: arquivo que a resposta diz ter criado e não está na pasta; o que o pedido mandou fazer e nenhuma ferramenta fez ("rode o comando", "crie o arquivo") — pergunta de "como fazer" não conta',
    tipo: 'unidade',
    executar() {
      const resposta = 'O arquivo EnableLoudness.ps1 foi salvo localmente e o relatorio.pdf foi gerado. Também criei o resumo.docx. Não consegui gerar o grafico.png.';
      const faltando = c.arquivosSoNaResposta(resposta, { tamanhoDe, criados: ['relatorio.pdf', 'EnableLoudness.ps1'] });
      const pedido = 'Crie o arquivo teste.txt com o texto "ola" e depois rode o comando `programa-que-nao-existe --versao` no terminal.';
      return [
        JSON.stringify(faltando) === '["resumo.docx"]' || JSON.stringify(faltando),
        JSON.stringify(c.pedidoSemAcao(pedido, [{ nome: 'escrever_arquivo' }])) === '["rodar o comando `programa-que-nao-existe --versao`"]' || JSON.stringify(c.pedidoSemAcao(pedido, [{ nome: 'escrever_arquivo' }])),
        c.pedidoSemAcao(pedido, [{ nome: 'escrever_arquivo' }, { nome: 'executar_comando' }]).length === 0 || 'tudo feito',
        JSON.stringify(c.pedidoSemAcao('Gere um PDF com o conteúdo acima', [])) === '["criar o arquivo pedido"]' || 'PDF não gerado',
        ['como criar um arquivo .bat?', 'Como rodar o comando npm start?', 'é possível gerar um PDF daqui?', 'quanto está a RTX 5080?', 'o que é um comando no terminal?'].every((p) => c.pedidoSemAcao(p, []).length === 0) || 'perguntas não contam',
      ];
    },
  },
  {
    nome: 'conferência: o aviso antes de concluir lista o que falhou e manda corrigir ou admitir; o bloco do fim diz "nem tudo deu certo"; sem ação, nada; a redação recebe o resultado real das ações e a instrução de tarefa (não "a busca não retornou")',
    tipo: 'unidade',
    executar() {
      const itens = c.conferirAcoes([{ nome: 'executar_comando', argumentos: { comando: 'x' }, resultado: 'código de saída: 1\nstderr:\nerro: x' }], { tamanhoDe });
      const aviso = c.avisoAntesDeConcluir(itens, [], ['rodar o comando `y`']);
      const bloco = c.blocoDaConferencia(itens, ['resumo.docx'], { naoFeitos: ['rodar o comando `y`'] });
      const material = c.materialDasAcoes([{ nome: 'executar_comando', argumentos: { comando: 'x' }, resultado: 'código de saída: 1\nstderr:\nerro: x' }], { tamanhoDe });
      const loop = fs.readFileSync(path.join(__dirname, '../../src/agent/loop.js'), 'utf8');
      const redacao = fs.readFileSync(path.join(__dirname, '../../src/agent/loop-redacao.js'), 'utf8');
      const prompts = require('../../src/agent/prompts');
      return [
        /✗ comando `x`/.test(aviso) && /não foi feito \(nenhuma ferramenta rodou\)/.test(aviso) && /não diga que foi feito/.test(aviso) || aviso,
        /nem tudo deu certo/.test(bloco) && /✗ resumo\.docx/.test(bloco) && /não foi feito: rodar o comando `y`/.test(bloco) || bloco,
        c.avisoAntesDeConcluir([], []) === null && c.blocoDaConferencia([], []) === '' || 'sem ação, nada',
        /O QUE FOI FEITO NESTA EXECUÇÃO/.test(material) && /Saída de `x`/.test(material) || material,
        /vetoDaConferenciaFeito = true;[\s\S]{0,200}gate: 'conferencia'/.test(loop) || 'veto antes de concluir',
        /acoesFeitas && coberturaDaPesquisa\.nivel === 'ausente' \? \{ \.\.\.coberturaDaPesquisa, nivel: 'acoes' \}/.test(redacao) && /\.\.\.soltos, acoesFeitas\]/.test(redacao) || 'redação com as ações',
        /NÃO diga que pesquisou/.test(prompts.redator('acoes')) || 'instrução de tarefa',
      ];
    },
  },
  {
    nome: 'comandos no Windows: a saída em CP850 (cmd sem console: "n�o é reconhecido") e em Windows-1252 vira texto legível; UTF-8 fica como está',
    tipo: 'unidade',
    executar() {
      const cp850 = Buffer.from([0x6e, 0xc6, 0x6f, 0x20, 0x82, 0x20, 0x6f, 0x70, 0x65, 0x72, 0xa0, 0x76, 0x65, 0x6c]);
      const win1252 = Buffer.from([0x6e, 0xe3, 0x6f, 0x20, 0xe9, 0x20, 0x61, 0xe7, 0xe3, 0x6f]);
      return [
        decodificar(cp850) === 'não é operável' || decodificar(cp850),
        decodificar(win1252) === 'não é ação' || decodificar(win1252),
        decodificar(Buffer.from('já está ok ✓', 'utf8')) === 'já está ok ✓' || 'utf-8',
        decodificar(Buffer.alloc(0)) === '' || 'vazio',
      ];
    },
  },
];
