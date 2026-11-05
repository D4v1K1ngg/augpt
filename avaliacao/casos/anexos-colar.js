'use strict';

/**
 * Anexos (5/11, pedido do Davi): Ctrl+V com arquivos copiados no Explorador, com um print ou imagem copiada, e
 * arrastar arquivos para a conversa; imagem vira miniatura e arquivo vira cartão com o tipo, na caixa e na
 * mensagem; ao reabrir, o bloco "Arquivos anexados…" vira cartões de novo. Testado no app em 5/11 (3 arquivos
 * do Explorador + 1 print colados, texto comum continua texto, cartões na mensagem e na conversa reaberta).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'anexos: colar (arquivos do Explorador, print), arrastar, miniatura de imagem; o caminho vem do File (webUtils), não de texto da tela',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const preload = ler('electron/preload.js');
      const app = ler('renderer/app.js');
      return [
        /ipcMain\.handle\('files:colar'/.test(main) && /Get-Clipboard -Format FileDropList/.test(main) && /readBuffer\('FileNameW'\)/.test(main) || 'colar arquivos do Explorador',
        /ipcMain\.handle\('files:colarImagem'/.test(main) && /ipcMain\.handle\('files:anexarCaminhos'/.test(main) && /e\.sender !== win\.webContents/.test(main) || 'print e caminhos, só desta janela',
        /function anexarCaminhos\(caminhos, modo\)/.test(main) && /miniaturaDe\(origem\)/.test(main) && /ipcMain\.handle\('arquivos:miniatura'/.test(main) || 'cópia única com miniatura',
        /webUtils\.getPathForFile\(f\)/.test(preload) && /colar: \(modo\) => ipcRenderer\.invoke\('files:colar'/.test(preload) || 'preload',
        /addEventListener\('paste', \(e\) => colarAnexos\(e, 'agente'\)\)/.test(app) && /soltarAnexos\(\$\('viewAgente'\), 'agente'\)/.test(app) || 'colar e arrastar ligados',
        /if \(!\(dados\?\.getData\('text\/plain'\) \|\| ''\)\.length\)/.test(app) || 'texto colado continua texto',
      ];
    },
  },
  {
    nome: 'anexos: o pedido salvo com "Arquivos anexados…" volta como cartões (o texto sem o bloco); tipos com cor (PDF, planilha, imagem, áudio)',
    tipo: 'unidade',
    executar() {
      // as funções puras do renderer, num contexto isolado
      const app = ler('renderer/app.js');
      const trecho = app.slice(app.indexOf('const TIPOS_DE_ANEXO'), app.indexOf('/** Um cartão de anexo'))
        + app.slice(app.indexOf('/** O bloco "Arquivos anexados'), app.indexOf('/** Põe na fila'));
      const ctx = { tr: (t) => t };
      vm.runInNewContext(`${trecho}\nthis.anexosDoPedido = anexosDoPedido; this.tipoDoAnexo = tipoDoAnexo;`, ctx);
      const salvo = 'o que tem nesses arquivos?\n\nArquivos anexados, já copiados para a pasta de trabalho:\n- foto-do-produto.png (4 KB)\n- contrato.pdf (45 B)\nUse ler_arquivo para abri-los.';
      const r = ctx.anexosDoPedido(salvo);
      return [
        r.texto === 'o que tem nesses arquivos?' || JSON.stringify(r.texto),
        JSON.stringify(r.anexos) === JSON.stringify([{ nome: 'foto-do-produto.png', relativo: 'foto-do-produto.png' }, { nome: 'contrato.pdf', relativo: 'contrato.pdf' }]) || JSON.stringify(r.anexos),
        ctx.anexosDoPedido('pergunta sem anexo').anexos.length === 0 || 'sem anexo',
        ['foto.PNG', 'a.pdf', 'b.xlsx', 'audio.opus'].map((n) => ctx.tipoDoAnexo(n).cor).join(',') === 'img,pdf,xls,audio' || 'tipos',
      ];
    },
  },
];
