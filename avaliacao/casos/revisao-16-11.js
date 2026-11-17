'use strict';

/**
 * Revisão de 16/11 (depois do "supermix 4 virou jogos"): os outros pontos do mesmo tipo e os bugs achados.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { identificarImagem } = require('../../src/agent/identificar-imagem');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'revisão 16/11: "o que é isso?" num print/documento não vai para a busca na web (a visão de sempre lê e explica); com OCR cheio de texto, nem olha',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
      let buscou = false;
      const deps = {
        emit: () => {},
        buscarImagens: async () => ((buscou = true), []),
        chamar: async () => ({ content: JSON.stringify({ o_que_e: 'uma janela de erro do Windows', print: true, palpites: [], busca: 'windows error dialog' }) }),
      };
      const r = await identificarImagem({ pergunta: 'o que é isso?', imagem: { arquivo: path.join(dir, 'x.png'), base64: 'eA==' }, deps, dir, config: { searxngUrl: 'http://x' } });
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        r === null && !buscou || 'print: devolve null (a visão de sempre responde) e não busca',
        /if \(olhado\.print === true && !parecidas\) return null;/.test(ler('src/agent/identificar-imagem.js')) || 'pedir parecidas de um print continua valendo',
        /const muitoTexto = String\(fotoAnexada\?\.texto \|\| ''\)/.test(ler('src/agent/loop-nucleo.js')) && /!muitoTexto && identificarImagem\.pedidoDeIdentificacao/.test(ler('src/agent/loop-nucleo.js')) || 'OCR com muito texto: nem olha',
      ];
    },
  },
  {
    nome: 'revisão 16/11: dublagem sem o som original vai até o fim do vídeo (apad); sugestões só em resposta com corpo; sobre um produto a busca curta é o assunto; "o que evitar" não copia o exemplo',
    tipo: 'unidade',
    executar() {
      const nucleo = ler('src/agent/nucleo/index.js');
      return [
        /'\[1:a\]aresample=48000,apad\[a\]', '-map', '0:v', '-map', '\[a\]', '-shortest'/.test(ler('src/dublagem/index.js')) || 'apad: o vídeo não é cortado na última fala',
        /String\(markdown \|\| ''\)\.trim\(\)\.length < 400/.test(ler('renderer/acoes-da-resposta.js')) || 'sugestões só com resposta de 400+ caracteres',
        /const curta = !recomendacao && assuntos\.length \? String\(assuntos\[0\]\)/.test(nucleo) || 'sobre um produto, a busca curta é o assunto (não "nome desse fone mandei…")',
        /recomendacao \? `\$\{curta\} recomendação` : `\$\{curta\} review`/.test(nucleo) || 'sobre um produto, a comunidade busca review, não recomendação',
        /!ocrConfirma && !ehPrint && \(ent\.produto/.test(nucleo) || 'o aviso "reconhecido pela aparência" não sai em print de tela',
        /só o que ele diz; se não diz, lista vazia/.test(nucleo) && !/\(ex\.: "graves potentes", "bass boost"\)/.test(nucleo) || '"o que evitar" não copia "graves potentes" (fone de música perdia opções)',
      ];
    },
  },
];
