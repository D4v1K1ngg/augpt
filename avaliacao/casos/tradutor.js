'use strict';

/** Tradutor (12/11, src/tradutor): partes por parágrafo, limpeza do que o modelo acrescenta e a tela ligada. */

const t = require('../../src/tradutor');
const fs = require('fs');
const path = require('path');

module.exports = [
  {
    nome: 'tradutor: texto longo vai em partes de parágrafos (nenhum texto se perde); "Tradução:" e aspas em volta saem; cada parte numa chamada, a tela recebe o parcial; sem destino ou sem texto, erro claro; aba, IPC e 🔊 ligados',
    tipo: 'unidade',
    async executar() {
      const longo = Array.from({ length: 6 }, (_, i) => `Parágrafo ${i + 1}. ${'Frase de teste. '.repeat(40)}`).join('\n\n');
      const partes = t.partesDoTexto(longo, 2500);
      const enorme = t.partesDoTexto('Uma frase. '.repeat(600), 2500);
      const pedidos = [];
      const parciais = [];
      const chatStream = async ({ messages, onToken }) => {
        pedidos.push(messages);
        const saida = `Tradução: "EN ${pedidos.length}"`;
        for (const c of saida) onToken(c);
        return { content: saida };
      };
      const r = await t.traduzir({ texto: 'Primeiro.\n\nSegundo.', de: 'pt', para: 'en' }, { chatStream, model: 'x', aoPedaco: (p) => parciais.push(p) });
      const semDestino = await t.traduzir({ texto: 'oi', para: 'auto' }, { chatStream, model: 'x' }).catch((e) => e.message);
      const semTexto = await t.traduzir({ texto: '  ', para: 'en' }, { chatStream, model: 'x' }).catch((e) => e.message);
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      return [
        partes.length >= 2 && partes.every((p) => p.length <= 2500) && partes.join('').replace(/\s/g, '') === longo.replace(/\s/g, '') || `partes: ${partes.map((p) => p.length)}`,
        enorme.length >= 3 && enorme.every((p) => p.length <= 2500) || 'parágrafo enorme cortado nas frases',
        r.traducao === 'EN 1' && pedidos.length === 1 || `um texto curto é uma chamada: ${JSON.stringify(r)}`,
        /Brazilian Portuguese to English/.test(pedidos[0][0].content) && pedidos[0][1].content === 'Primeiro.\n\nSegundo.' || 'idiomas no pedido',
        parciais.at(-1) === 'EN 1' && parciais.some((p) => p.length < 4) || 'a tela recebe o parcial',
        t.limparTraducao('"Hello there"', 'Olá') === 'Hello there' && t.limparTraducao('"Hi" she said', '"Oi" ela disse') === '"Hi" she said' || 'aspas do original ficam',
        /destino/.test(semDestino) && /escreva/.test(semTexto) || `${semDestino} / ${semTexto}`,
        /tradutor:traduzir/.test(ler('electron/main.js')) && /tradutor:/.test(ler('electron/preload.js')) && /viewTradutor/.test(ler('renderer/index.html')) && /tradutor\.js/.test(ler('renderer/index.html')) || 'aba e IPC',
        /botaoDeAudio\?\.\(\$\('tradAudio'\)/.test(ler('renderer/tradutor.js')) || 'o 🔊 na tradução',
      ];
    },
  },
];
