'use strict';

/**
 * Quadro de modelos (GPU/CPU) e linha do tempo das IAs auxiliares no
 * registro (pedido do Davi, 2026-10-10). Ver src/modelos-carregados.js.
 */

const ollama = require('../../src/llm/ollama');
const { montarQuadroDeModelos } = require('../../src/modelos-carregados');
const { executarCasoAgente } = require('../motor');

const GB = 1024 ** 3;
const CONFIG = {
  model: 'qwen2.5:7b',
  embedModel: 'nomic-embed-text',
  roteadorDecisor: true,
  modeloDecisor: 'tev1',
  copiloto2Modo: 'doisModelos',
  modelCopiloto2: 'llama3.2:3b',
};

module.exports = [
  {
    nome: 'modelos: principal e nomic na GPU = ok; tev1 ("tev1:latest") na CPU = ok; copiloto na GPU = atenção; modelo alheio = outro',
    tipo: 'unidade',
    executar() {
      const linhas = montarQuadroDeModelos({
        config: CONFIG,
        carregados: [
          { name: 'qwen2.5:7b', size: 5 * GB, sizeVram: 5 * GB },
          { name: 'nomic-embed-text:latest', size: 0.3 * GB, sizeVram: 0.3 * GB },
          { name: 'tev1:latest', size: 3 * GB, sizeVram: 0 },
          { name: 'llama3.2:3b', size: 2 * GB, sizeVram: 2 * GB },
          { name: 'deepseek-r1:8b', size: 6 * GB, sizeVram: 1 * GB },
        ],
      });
      const de = (papel) => linhas.find((l) => l.papel.startsWith(papel)) || {};
      return [
        de('principal').situacao === 'ok' && de('principal').onde === 'GPU' || `principal: ${JSON.stringify(de('principal'))}`,
        de('memória').situacao === 'ok' || `embedding: ${JSON.stringify(de('memória'))}`,
        de('roteador').situacao === 'ok' && de('roteador').onde === 'CPU' || `tev1: ${JSON.stringify(de('roteador'))}`,
        de('copiloto').situacao === 'atencao' || `copiloto na GPU deveria ser atenção: ${JSON.stringify(de('copiloto'))}`,
        /CPU/.test(de('copiloto').dica || '') || 'a dica do copiloto deveria dizer que ele deveria estar na CPU',
        de('outro').modelo === 'deepseek-r1:8b' && de('outro').onde === 'GPU+CPU' && de('outro').gpuPct === 17 || `modelo alheio: ${JSON.stringify(de('outro'))}`,
      ];
    },
  },
  {
    nome: 'modelos: principal dividido entre GPU e CPU é atenção; nada carregado = ocioso; roteador desligado não aparece',
    tipo: 'unidade',
    executar() {
      const dividido = montarQuadroDeModelos({ config: { model: 'qwen2.5:14b' }, carregados: [{ name: 'qwen2.5:14b', size: 10 * GB, sizeVram: 7 * GB }] });
      const vazio = montarQuadroDeModelos({ config: { ...CONFIG, roteadorDecisor: false }, carregados: [] });
      return [
        dividido[0].situacao === 'atencao' && dividido[0].gpuPct === 70 || `dividido: ${JSON.stringify(dividido[0])}`,
        vazio.every((l) => l.situacao === 'ocioso') || 'sem nada carregado, tudo ocioso',
        !vazio.some((l) => /roteador/.test(l.papel)) || 'roteador desligado não deveria aparecer',
      ];
    },
  },
  {
    nome: 'registro: Tev1 acionado entra na linha do tempo ("trocou a regra") e o quadro de modelos do fim da execução é gravado',
    tipo: 'unidade',
    async executar() {
      const original = ollama.decidir;
      ollama.decidir = async () => ({ rota: { choice: 'explicacao', confidence: 0.9 } });
      try {
        const obtido = await executarCasoAgente({
          nome: 'acionamentos: tev1',
          pedido: 'O que é o protocolo TCP three-way handshake? Qual a diferença entre um switch e um roteador?',
          config: { roteadorDecisor: true, modeloDecisor: 'tev1', limiarDecisor: 0.6, motorDePesquisa: true },
          modelosCarregados: [
            { name: 'falso', size: 4 * GB, size_vram: 4 * GB },
            { name: 'tev1:latest', size: 3 * GB, size_vram: 0 },
          ],
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'tcp' } }],
          redacao: 'Resposta de teste.',
        });
        const ac = obtido.registro?.acionamentos || [];
        const roteador = ac.find((a) => a.quem === 'roteador');
        const quadro = obtido.registro?.modelosNaExecucao || [];
        return [
          Boolean(roteador) || `o Tev1 deveria aparecer na linha do tempo: ${JSON.stringify(ac)}`,
          /trocou a regra/.test(roteador?.detalhe || '') || `detalhe: ${roteador?.detalhe}`,
          quadro.some((l) => /principal/.test(l.papel) && l.onde === 'GPU') || `quadro: ${JSON.stringify(quadro)}`,
          quadro.some((l) => /roteador/.test(l.papel) && l.onde === 'CPU' && l.situacao === 'ok') || `tev1 no quadro: ${JSON.stringify(quadro)}`,
        ];
      } finally {
        ollama.decidir = original;
      }
    },
  },
];
