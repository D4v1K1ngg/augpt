'use strict';

/**
 * 19/11 (Davi: "implementa ver a tela do meu computador e clicar/interagir, e testa preenchendo um formulário ou
 * digitando no Bloco de Notas"): o ajudante da tela (src/pc/tela.js), as ferramentas (src/tools/tela.js), o tipo de
 * pedido "tela" e as travas. Conferido no app de verdade: o formulário de um site local preenchido e enviado (o servidor
 * recebeu nome, e-mail, cidade e a caixa marcada, 53 s) e a lista no Bloco de Notas, uma por linha.
 */

const fs = require('fs');
const path = require('path');
const tela = require('../../src/pc/tela');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'tela: teclas pelo nome viram códigos do Windows; o tipo "tela" pega "abre o bloco de notas e digita", "preenche o formulário aberto na tela" e não pega pergunta nem só abrir',
    tipo: 'unidade',
    executar() {
      let desconhecida = '';
      try {
        tela.codigosDaTecla('ctrl+banana');
      } catch (e) {
        desconhecida = e.message;
      }
      return [
        tela.codigosDaTecla('ctrl+s').join() === '17,83' && tela.codigosDaTecla('Enter').join() === '13' && tela.codigosDaTecla('alt+f4').join() === '18,115' || 'códigos',
        /tecla desconhecida/.test(desconhecida) || 'tecla desconhecida',
        tipoDoPedido('Abre o bloco de notas e escreve uma lista de compras').tipo === 'tela' || 'bloco de notas',
        tipoDoPedido('Preenche o formulário de cadastro que está aberto na tela com o nome Maria').tipo === 'tela' || 'formulário na tela',
        tipoDoPedido('como escrever uma carta no word?').tipo !== 'tela' && tipoDoPedido('abre o bloco de notas').tipo !== 'tela' || 'pergunta e só abrir',
        tipoDoPedido('acessa https://site.com e preenche o formulário').tipo === 'site' || 'com endereço é o navegador do AuGPT',
      ];
    },
  },
  {
    nome: 'tela: as ferramentas e as travas — o AuGPT não é alvo, gerenciador de senha e campo de senha não, apagar/salvar/fechar/colar pedem confirmação, mouse no canto para, Bloco de Notas em aba nova, Chromium lido de novo',
    tipo: 'unidade',
    executar() {
      const nomes = require('../../src/tools/tela').map((f) => f.name);
      const fonte = ler('src/tools/tela.js');
      const loop = ler('src/agent/loop.js');
      return [
        ['ver_tela', 'focar_janela', 'abrir_programa', 'clicar_na_tela', 'digitar_na_tela', 'tecla_na_tela', 'rolar_tela'].every((n) => nomes.includes(n)) || nomes.join(),
        /\.\.\.telaDoPc/.test(ler('src/tools/index.js')) || 'registradas',
        /const minhas = \(w\) => w\.pid === process\.pid;/.test(fonte) || 'o AuGPT pelo processo, não pelo nome',
        /keepass/.test(fonte) && /é um campo de SENHA: o AuGPT não digita senhas/.test(fonte) || 'senhas',
        /ctrl\\\+s\|ctrl\\\+w\|alt\\\+f4/.test(fonte) && /const COLAR = /.test(fonte) && /ctx\.ask\(`Posso apertar/.test(fonte) || 'confirmação',
        /c\.x <= 4 && c\.y <= 4/.test(fonte) && /PARADO pelo usuário/.test(fonte) || 'mouse no canto para',
        /if \(exe === 'notepad'\) \{\s*await tela\.teclas\('ctrl\+n'\)/.test(fonte) || 'Bloco de Notas em aba nova',
        /if \(elementos\.filter\(\(e\) => e\.tipo !== 'texto'\)\.length < 4\)/.test(fonte) || 'Chromium: lê de novo',
        /e\.tipo === 'documento'\) \{[\s\S]{0,300}tela\.teclas\('ctrl\+end'\)/.test(fonte) || 'documento: continua do fim',
        /gate: 'tela-primeiro'/.test(loop) && /gate: 'tela-sem-arquivo'/.test(loop) && /'local', 'site', 'tela'/.test(loop) || 'o caminho de tarefas',
        /agent\.on\('tela-controle'/.test(ler('electron/main.js')) && /AuGPT está controlando o computador/.test(ler('electron/main.js')) || 'a faixa de aviso',
        /if \(GetForegroundWindow\(\) == h\) return/.test(ler('src/pc/tela.js')) && !/Tecla\(new ushort\[\] \{ 0x12 \}, true\)/.test(ler('src/pc/tela.js')) || 'foco sem o Alt solto',
      ];
    },
  },
];
