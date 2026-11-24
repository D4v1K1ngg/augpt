'use strict';

/**
 * Um Tev1 só, escolhido pela placa (24/11, Davi: "em pcs mais fracos como ficaria o uso de tantos modelos de IA?"): o
 * roteador e o tipo de fonte usam o mesmo, para o Ollama não passar de 3 modelos (com 4, recarregava um a cada poucos s).
 */

const fs = require('fs');
const path = require('path');
const { escolherTev1, tev1DaPlaca } = require('../../src/agent/tev1-da-placa');
const { montarQuadroDeModelos } = require('../../src/modelos-carregados');

const instalados = ['qwen3.5:9b-q8_0', 'tev1:latest', 'tev1:0.8b', 'tev1-0.8b-cpu:latest', 'embeddinggemma:300m'];

module.exports = [
  {
    nome: 'Tev1 da placa: 14 GB ou mais → o 4B; de 7,5 a 14 GB → o 0.8B na placa; menos, sem placa ou o principal pelo llama.cpp → nenhum (regras); sem o 4B instalado, o 0.8B; sem nenhum, nenhum',
    tipo: 'unidade',
    executar() {
      const e = (vramGB, extra = {}) => escolherTev1({ vramGB, instalados, ...extra });
      return [
        e(16) === 'tev1:latest' && e(14) === 'tev1:latest' || `14–16 GB: ${e(16)} ${e(14)}`,
        e(12) === 'tev1:0.8b' && e(8) === 'tev1:0.8b' || `8–12 GB: ${e(12)} ${e(8)}`,
        e(6) === '' && e(4) === '' && e(0) === '' || 'placa fraca ou sem placa: regras',
        e(16, { principalNoLlamaCpp: true }) === '' || 'com o Inkling pelo llama.cpp: regras',
        escolherTev1({ vramGB: 16, instalados: ['tev1:0.8b'] }) === 'tev1:0.8b' && escolherTev1({ vramGB: 16, instalados: ['qwen3.5:9b'] }) === '' || 'pelo que está instalado',
      ];
    },
  },
  {
    nome: 'Tev1 da placa nos Ajustes e no roteador: "auto" escolhe e troca o roteador Tev1 (sem o 0.8B na CPU); um nome fixa e não mexe no roteador; "" são as regras; quem usa outro decisor fica com o seu; o quadro de modelos mostra o Tev1 da placa',
    tipo: 'unidade',
    async executar() {
      const listar = async () => instalados;
      const auto = await tev1DaPlaca({ config: { modeloDecisor: 'tev1-0.8b', modeloDecisorRapido: 'tev1-0.8b-cpu' }, listar, vramGB: 16 });
      const fixo = await tev1DaPlaca({ config: { modeloTipoDeFonte: 'tev1:0.8b', modeloDecisor: 'tev1-0.8b' }, listar, vramGB: 16 });
      const desligado = await tev1DaPlaca({ config: { modeloTipoDeFonte: '' }, listar, vramGB: 16 });
      const outroDecisor = await tev1DaPlaca({ config: { modeloDecisor: 'nimble' }, listar, vramGB: 16 });
      const fraca = await tev1DaPlaca({ config: { modeloDecisor: 'tev1-0.8b', modeloDecisorRapido: 'tev1-0.8b-cpu' }, listar, vramGB: 4 });
      const quadro = montarQuadroDeModelos({ config: { model: 'qwen3.5:9b-q8_0', roteadorDecisor: true, modeloDecisor: 'tev1-0.8b', modeloDecisorRapido: 'tev1-0.8b-cpu', tev1DaPlaca: 'tev1:latest' }, carregados: [{ name: 'tev1:latest', size: 4.5e9, sizeVram: 4.5e9 }] });
      const loop = fs.readFileSync(path.join(__dirname, '../../src/agent/loop.js'), 'utf8');
      return [
        auto.tipos === 'tev1:latest' && JSON.stringify(auto.roteador) === '{"modeloDecisor":"tev1:latest","modeloDecisorRapido":""}' || JSON.stringify(auto),
        fixo.tipos === 'tev1:0.8b' && fixo.roteador === null || JSON.stringify(fixo),
        desligado.tipos === '' || 'desligado: regras',
        outroDecisor.tipos === 'tev1:latest' && outroDecisor.roteador === null || 'outro decisor continua',
        fraca.tipos === '' && fraca.roteador === null || 'placa fraca: o roteador fica na CPU e os tipos nas regras',
        quadro.some((l) => /roteador \+ tipo de fonte/.test(l.papel) && l.situacao === 'ok') && !quadro.some((l) => /roteador rápido/.test(l.papel)) || JSON.stringify(quadro),
        /config: t\.roteador \? \{ \.\.\.this\.config, \.\.\.t\.roteador \} : this\.config/.test(loop) || 'o roteador recebe o Tev1 da placa',
      ];
    },
  },
];
