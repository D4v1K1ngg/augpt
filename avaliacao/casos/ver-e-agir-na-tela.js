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
        // 20/11 (Davi: "abrir as configurações do Windows e desativar o modo de jogo"): ligar/desligar um ajuste do Windows
        ['Abre as configurações do Windows e desativa o modo de jogo', 'desativa o modo de jogo do windows', 'liga o modo escuro'].every((p) => tipoDoPedido(p).tipo === 'tela') || 'ligar/desligar no Windows',
        tipoDoPedido('como ativar o modo de jogo?').tipo !== 'tela' && tipoDoPedido('desativa a economia de energia da placa de rede').tipo !== 'tela' && tipoDoPedido('desliga o pc às 23h').tipo !== 'tela' || 'pergunta, placa de rede e desligar o PC ficam onde estavam',
        // 21/11 (Davi: "testa com jogos mais simples, paciência, xadrez"): jogar no que está aberto é agir na tela
        ['Joga uma partida de jogo da velha na janela que está aberta na tela', 'jogue o xadrez aberto na janela'].every((p) => tipoDoPedido(p).tipo === 'tela') && tipoDoPedido('como jogar xadrez?').tipo !== 'tela' && tipoDoPedido('joga xadrez comigo').tipo !== 'tela' || 'jogar na tela',
        ler('src/tools/tela.js').includes("'gaming-gamemode': /modo de jogo") && ler('src/tools/tela.js').includes('ms-settings:${pagina}') || 'as Configurações abrem na página',
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
  {
    // 21/11 (Davi: "faça os pontos 1 e 2"): no teste dos jogos, o xadrez parou no 7º lance (cada lance gastava 2 a 3 dos
    // 40 passos) e o 9B jogava mal (na paciência só virava o monte)
    nome: 'tela/jogos: mover_na_tela faz o lance num passo (de "e2" para "e4", pelo nome ou número); num jogo, a leitura traz a regra do jogo e o lance que muda a janela dá um passo a mais',
    tipo: 'unidade',
    async executar() {
      const ferramentas = require('../../src/tools/tela');
      const mover = ferramentas.find((f) => f.name === 'mover_na_tela');
      const original = { ...tela };
      const cliques = [];
      let depois = false;
      const casa = (nome, x) => ({ tipo: 'botão', nome, x, y: 100, w: 50, h: 50 });
      Object.assign(tela, {
        janelas: async () => ({ frente: 7, janelas: [{ hwnd: 7, pid: -1, titulo: 'Xadrez', processo: 'electron', x: 0, y: 0, w: 900, h: 700 }] }),
        elementos: async () => ({ elementos: [casa(`e2: ${depois ? 'vazia' : 'peão branco'}`, 100), casa(`e4: ${depois ? 'peão branco' : 'vazia'}`, 200), casa('e5: vazia', 300)] }),
        cursor: async () => ({ x: 500, y: 500 }),
        focar: async () => {},
        clicar: async (x) => { cliques.push(x); if (cliques.length === 2) depois = true; },
      });
      try {
        let extras = 0;
        const ctx = { objetivo: 'Joga uma partida de xadrez na janela aberta na tela', estado: {}, estenderPassos: (n) => (extras += n) };
        const r = await mover.run({ de: 'e2', para: 'e4' }, ctx);
        const ctxPergunta = { objetivo: 'preenche o formulário aberto na tela', estado: {} };
        const semJogo = await ferramentas.find((f) => f.name === 'ver_tela').run({}, ctxPergunta);
        let erro = '';
        await mover.run({ de: 'h9', para: 'e4' }, ctx).catch((e) => (erro = e.message));
        return [
          cliques.join() === '125,225' || `cliques ${cliques}`,
          extras === 1 || `passos extras ${extras}`,
          /REGRA DO JOGO — .*xeque/.test(r) && !/REGRA DO JOGO/.test(semJogo) || 'regra só no jogo',
          /não achei "h9"/.test(erro) || erro,
          ler('src/agent/loop.js').includes("'clicar_na_tela', 'mover_na_tela'].includes(nome)") && /Math\.min\(200/.test(ler('src/agent/loop.js')) && ler('src/agent/loop.js').includes('`@tela:${ctx.estado.tela.assinatura}`') || 'loop',
          // a mesma ação numa janela que mudou não é repetição: a assinatura muda com a leitura
          (await mover.run({ de: 'e4', para: 'e5' }, ctx).then(() => ctx.estado.tela.assinatura)) !== undefined && /^[0-9a-z]+$/.test(ctx.estado.tela.assinatura) || 'assinatura curta',
        ];
      } finally {
        Object.assign(tela, original);
      }
    },
  },
];
