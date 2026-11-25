'use strict';

/**
 * Um Tev1 só, escolhido pela placa (24/11, Davi: "em pcs mais fracos como ficaria o uso de tantos modelos de IA?"): o
 * roteador e o tipo de fonte usam o mesmo, para o Ollama não passar de 3 modelos (com 4, recarregava um a cada poucos s).
 * 25/11 (Davi: "verificar quanto de vram ainda tem na placa e ver qual modelo do tev1 caberia… se não couber, o 0.8B na
 * CPU"): pela memória LIVRE.
 */

const fs = require('fs');
const path = require('path');
const { escolherTev1, tev1DaPlaca, livreParaOTev1 } = require('../../src/agent/tev1-da-placa');
const { montarQuadroDeModelos } = require('../../src/modelos-carregados');

const instalados = ['qwen3.5:9b-q8_0', 'tev1:latest', 'tev1:0.8b', 'tev1-0.8b-cpu:latest', 'embeddinggemma:300m'];

module.exports = [
  {
    nome: 'Tev1 pela memória livre: cabe o 4B (placa ≥ 14 GB) → 4B; cabe o 0.8B → 0.8B na placa; não cabe, sem placa ou o principal pelo llama.cpp → 0.8B na CPU (a cópia é criada se só houver o tev1:0.8b); o que já está inteiro na placa fica; sem Tev1, as regras',
    tipo: 'unidade',
    executar() {
      const e = (vramGB, livreGB, extra = {}) => escolherTev1({ vramGB, livreGB, instalados, ...extra }).nome;
      const soPequeno = escolherTev1({ vramGB: 4, livreGB: 0.5, instalados: ['tev1:0.8b'] });
      return [
        e(16, 6) === 'tev1:latest' && e(16) === 'tev1:latest' || `16 GB com folga: ${e(16, 6)}`,
        e(16, 4.4) === 'tev1:0.8b' && e(12, 10) === 'tev1:0.8b' || `o 4B não cabe / placa de 12 GB: ${e(16, 4.4)} ${e(12, 10)}`,
        e(16, 0.5) === 'tev1-0.8b-cpu' && e(0) === 'tev1-0.8b-cpu' && e(16, 9, { principalNoLlamaCpp: true }) === 'tev1-0.8b-cpu' || 'não cabe, sem placa, llama.cpp: na CPU',
        e(16, 0.05, { naPlaca: 'tev1:latest' }) === 'tev1:latest' || 'o 4B já carregado fica',
        soPequeno.nome === 'tev1-0.8b-cpu' && soPequeno.criarCpu && soPequeno.naCpu || JSON.stringify(soPequeno),
        escolherTev1({ vramGB: 16, instalados: ['qwen3.5:9b'] }).nome === '' || 'sem Tev1: regras',
        livreParaOTev1({ vramGB: 16, livreNaPlaca: 0.05, carregados: [{ name: 'tev1:latest', sizeVram: 4.35 * 2 ** 30 }] }) > 4.3 || 'o Tev1 carregado conta como livre para ele',
        livreParaOTev1({ vramGB: 16, livreNaPlaca: 11, carregados: [], principal: { nome: 'qwen3.5:27b', tamanho: 17e9 } }) < 0 || 'o principal que ainda vai carregar ocupa',
        Math.round(livreParaOTev1({ vramGB: 16, carregados: [{ name: 'qwen3.5:9b-q8_0', sizeVram: 9 * 2 ** 30 }, { name: 'tev1:latest', sizeVram: 4 * 2 ** 30 }] })) === 7 || 'sem nvidia-smi: o total menos os outros carregados',
      ];
    },
  },
  {
    nome: 'Tev1 da placa nos Ajustes e no roteador: "auto" escolhe e troca o roteador Tev1; um nome fixa e não mexe no roteador; "" são as regras; quem usa outro decisor fica com o seu; a cópia na CPU é criada uma vez; o quadro de modelos mostra onde o Tev1 deve estar',
    tipo: 'unidade',
    async executar() {
      const listar = async () => instalados;
      const base = { listar, vramGB: 16, livreNaPlaca: 8, carregados: async () => [] };
      const auto = await tev1DaPlaca({ ...base, config: { modeloDecisor: 'tev1-0.8b', modeloDecisorRapido: 'tev1-0.8b-cpu' } });
      const fixo = await tev1DaPlaca({ ...base, config: { modeloTipoDeFonte: 'tev1:0.8b', modeloDecisor: 'tev1-0.8b' } });
      const desligado = await tev1DaPlaca({ ...base, config: { modeloTipoDeFonte: '' } });
      const outroDecisor = await tev1DaPlaca({ ...base, config: { modeloDecisor: 'nimble' } });
      const cheia = await tev1DaPlaca({ ...base, livreNaPlaca: 0.2, config: { modeloDecisor: 'tev1-0.8b' } });
      const criadas = [];
      const criar = async (nome, de) => criadas.push(`${nome}<-${de}`);
      const semCpu = { listar: async () => ['tev1:0.8b'], vramGB: 0, carregados: async () => [], criarCpu: criar, config: {} };
      const c1 = await tev1DaPlaca(semCpu);
      await tev1DaPlaca(semCpu);
      const quadro = montarQuadroDeModelos({ config: { model: 'qwen3.5:9b-q8_0', roteadorDecisor: true, modeloDecisor: 'tev1-0.8b', modeloDecisorRapido: 'tev1-0.8b-cpu', tev1DaPlaca: 'tev1:latest' }, carregados: [{ name: 'tev1:latest', size: 4.5e9, sizeVram: 4.5e9 }] });
      const quadroCpu = montarQuadroDeModelos({ config: { model: 'qwen3.5:9b-q8_0', roteadorDecisor: true, tev1DaPlaca: 'tev1-0.8b-cpu', tev1NaCpu: true }, carregados: [{ name: 'tev1-0.8b-cpu', size: 0.9e9, sizeVram: 0 }] });
      const loop = fs.readFileSync(path.join(__dirname, '../../src/agent/loop.js'), 'utf8');
      return [
        auto.tipos === 'tev1:latest' && JSON.stringify(auto.roteador) === '{"modeloDecisor":"tev1:latest","modeloDecisorRapido":""}' || JSON.stringify(auto),
        fixo.tipos === 'tev1:0.8b' && fixo.roteador === null || JSON.stringify(fixo),
        desligado.tipos === '' || 'desligado: regras',
        outroDecisor.tipos === 'tev1:latest' && outroDecisor.roteador === null || 'outro decisor continua',
        cheia.tipos === 'tev1-0.8b-cpu' && cheia.naCpu && cheia.roteador?.modeloDecisor === 'tev1-0.8b-cpu' || JSON.stringify(cheia),
        c1.tipos === 'tev1-0.8b-cpu' && JSON.stringify(criadas) === '["tev1-0.8b-cpu<-tev1:0.8b"]' || `cópia na CPU: ${JSON.stringify([c1, criadas])}`,
        quadro.some((l) => /roteador \+ tipo de fonte/.test(l.papel) && l.situacao === 'ok') && !quadro.some((l) => /roteador rápido/.test(l.papel)) || JSON.stringify(quadro),
        quadroCpu.some((l) => /roteador \+ tipo de fonte/.test(l.papel) && l.situacao === 'ok') || `na CPU: ${JSON.stringify(quadroCpu)}`,
        /config: t\.roteador \? \{ \.\.\.this\.config, \.\.\.t\.roteador \} : this\.config/.test(loop) || 'o roteador recebe o Tev1 da placa',
      ];
    },
  },
];
