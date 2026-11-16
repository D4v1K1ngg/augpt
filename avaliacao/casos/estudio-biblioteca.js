'use strict';

/**
 * Biblioteca do Estúdio de voz (16/11, Davi: "salvar os meus áudios clonados, assim não tenho que gerar eles todas as
 * vezes"): o mesmo pedido devolve o arquivo que já existe; listar, renomear, favoritar; renomear a voz clonada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EstudioDeVoz, chaveDoPedido, rotuloDaVoz } = require('../../src/estudio-de-voz');

module.exports = [
  {
    nome: 'estúdio: biblioteca — o mesmo pedido reaproveita o áudio (sem gerar), "novo" gera outro; renomear, favoritar e a voz clonada renomeada',
    tipo: 'unidade',
    async executar() {
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'));
      const e = new EstudioDeVoz(pasta, { ffmpeg: __filename });
      e.instalado = () => true;
      const pedido = { motor: 'omni', modo: 'descrita', texto: 'Olá, Davi. Tudo bem?', instrucao: 'male', formato: 'mp3', legenda: true };
      const chave = chaveDoPedido({ ...pedido });
      // uma narração já gerada, como o gerar() grava
      const dir = path.join(pasta, 'narracoes');
      fs.mkdirSync(dir, { recursive: true });
      const audio = path.join(dir, 'ola-davi-20261116120000.mp3');
      fs.writeFileSync(audio, 'x');
      fs.writeFileSync(audio.replace('.mp3', '.json'), JSON.stringify({ titulo: 'Olá, Davi.', texto: pedido.texto, motor: 'omni', modo: 'descrita', voz: 'male', chave, segundos: 2, criada: '2026-11-16T12:00:00Z' }));
      fs.writeFileSync(path.join(dir, 'antiga-sem-json-20261101100000.wav'), 'x');
      fs.utimesSync(path.join(dir, 'antiga-sem-json-20261101100000.wav'), new Date('2026-11-01T10:00:00Z'), new Date('2026-11-01T10:00:00Z'));
      const ja = await e.gerar({ ...pedido, legenda: false });
      let gerouDeNovo = false;
      e.liberarPlaca = async () => {
        gerouDeNovo = true;
        throw new Error('parou aqui');
      };
      await e.gerar({ ...pedido, novo: true }).catch(() => {});
      const lista = e.biblioteca();
      e.atualizarAudio(audio, { titulo: 'Saudação', favorito: true });
      const depois = e.biblioteca().find((a) => a.arquivo === audio);
      fs.mkdirSync(path.join(pasta, 'vozes', 'minha-voz-1'), { recursive: true });
      fs.writeFileSync(path.join(pasta, 'vozes', 'minha-voz-1', 'voz.json'), JSON.stringify({ nome: 'Minha voz', texto: 'oi' }));
      const vozes = e.renomearVoz('minha-voz-1', 'Voz do Davi');
      const fora = (() => {
        try {
          e.atualizarAudio(path.join(pasta, 'vozes', 'minha-voz-1', 'voz.json'), { titulo: 'x' });
          return false;
        } catch {
          return true;
        }
      })();
      fs.rmSync(pasta, { recursive: true, force: true });
      return [
        ja.reaproveitado === true && ja.arquivo === audio && ja.tempo === 0 || JSON.stringify(ja),
        gerouDeNovo || '"Gerar outra versão" (novo) não reaproveita',
        lista.length === 2 && lista[0].arquivo === audio && lista[1].titulo === 'antiga sem json' || JSON.stringify(lista.map((a) => a.titulo)),
        depois.titulo === 'Saudação' && depois.favorito === true || JSON.stringify(depois),
        vozes[0].nome === 'Voz do Davi' || JSON.stringify(vozes),
        fora || 'só mexe no que é da biblioteca',
        chaveDoPedido({ texto: 'a', motor: 'omni', legenda: true, daResposta: true }) === chaveDoPedido({ motor: 'omni', texto: 'a' }) || 'a chave ignora legenda e origem',
        rotuloDaVoz({ modo: 'pronta', voz: 'ryan' }) === 'Ryan' && rotuloDaVoz({ modo: 'clonar', vozSalva: 'v' }, [{ id: 'v', nome: 'Minha voz' }]) === 'Minha voz' || 'rótulo da voz',
      ];
    },
  },
];
