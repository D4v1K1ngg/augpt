'use strict';

/** Legendas de vídeo (14/11, src/legendas): SRT, frases juntadas, tradução em lote sem desalinhar, a tela ligada. */

const fs = require('fs');
const path = require('path');
const L = require('../../src/legendas');

const SRT = `1
00:00:01,000 --> 00:00:05,000
Alright, so here we are, one of the elephants.

2
00:00:05,000 --> 00:00:09,000
The cool thing about these guys is that they have really long

3
00:00:09,000 --> 00:00:11,000
trunks, and that's cool.

4
00:00:17,000 --> 00:00:19,000
And that's pretty much all there is to say.
`;

module.exports = [
  {
    nome: 'legendas: SRT lido e escrito (2 linhas por legenda); trecho que continua a frase se junta ao anterior; a tradução em lote volta às mesmas linhas, o que faltar é pedido de novo e, se ainda faltar, fica no original; a tela e o IPC ligados',
    tipo: 'unidade',
    async executar() {
      const segs = L.lerSrt(SRT);
      const frases = L.juntarFrases(segs);
      const pedidos = [];
      // o "modelo" responde fora de ordem, com um rótulo, e esquece a linha 3 na 1ª vez
      const chatStream = async ({ messages }) => {
        const linhas = messages[1].content.split('\n');
        pedidos.push(linhas.length);
        const traduzir = (l) => l.replace(/^(\d+)\| /, '$1| PT ');
        const saida = linhas.length > 1 ? linhas.filter((l) => !/^3\|/.test(l)).reverse().map(traduzir) : linhas.map(traduzir);
        return { content: `Tradução:\n${saida.join('\n')}` };
      };
      const r = await L.traduzirSegmentos(frases, { para: 'pt', chatStream, model: 'x' });
      const ui = fs.readFileSync(path.join(__dirname, '../../renderer/index.html'), 'utf8');
      const js = fs.readFileSync(path.join(__dirname, '../../renderer/tradutor.js'), 'utf8');
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      return [
        segs.length === 4 && segs[1].inicio === '00:00:05,000' && segs[1].fim === '00:00:09,000' || JSON.stringify(segs),
        frases.length === 3 && frases[1].texto === 'The cool thing about these guys is that they have really long trunks, and that\'s cool.' && frases[1].fim === '00:00:11,000' || JSON.stringify(frases),
        L.escreverSrt([{ inicio: '00:00:01,000', fim: '00:00:02,000', texto: 'Uma frase bem comprida que não cabe numa linha só da legenda' }]) === '1\n00:00:01,000 --> 00:00:02,000\nUma frase bem comprida que não\ncabe numa linha só da legenda\n' || 'duas linhas, cortadas perto do meio',
        r.segmentos.map((s) => s.texto.slice(0, 3)).join() === 'PT ,PT ,PT ' && r.faltaram === 0 && pedidos.length === 2 || `tradução: ${JSON.stringify(r)} ${pedidos}`,
        r.segmentos[1].inicio === '00:00:05,000' && r.segmentos[1].fim === '00:00:11,000' || 'os tempos ficam',
        L.caminhoNoFiltro("C:\\Users\\a b\\x's.srt") === "C\\:/Users/a b/x\\'s.srt" || L.caminhoNoFiltro("C:\\Users\\a b\\x's.srt"),
        ['legEntrada', 'legEscolher', 'legGravar', 'legFazer', 'legParar', 'legStatus', 'legAbrir'].every((id) => ui.includes(`id="${id}"`)) || 'a seção na tela',
        /legendas-progresso/.test(js) && /api\.tradutor\.legendar/.test(js) || 'a tela chama e ouve',
        /ipcMain\.handle\('legendas:fazer'/.test(main) && /arquivosDaLegenda\.has/.test(main) || 'IPC, e só o que a legenda gerou aparece na pasta',
      ];
    },
  },
];
