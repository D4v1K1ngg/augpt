'use strict';

/**
 * Modelos para placas de 16 GB (9/11, medidos na régua com uma RTX 5070 Ti, 32 perguntas): o qwen3.5:9b teve a
 * melhor nota (9,6) e continua o recomendado; o Gemma 4 26B e o gpt-oss 20B entram como alternativas para quem tem
 * 14 GB ou mais. O gpt-oss ignora think: false — "desligar o raciocínio" vira o nível "low".
 */
const { recomendarModelos } = require('../../src/verificador-de-hardware');
const { campoThink } = require('../../src/llm/ollama');

module.exports = [
  {
    nome: 'modelos de 16 GB: o 9B segue recomendado, Gemma 4 26B e gpt-oss 20B como alternativas só de 14 GB para cima; gpt-oss com think "low"',
    tipo: 'unidade',
    executar() {
      const placa = (v) => recomendarModelos({ vramGB: v, ramTotalGB: 32, gpus: [{ nome: 'NVIDIA GeForce RTX', vramGB: v }] });
      const r16 = placa(16);
      const r8 = placa(8);
      return [
        r16.principal.nome === 'qwen3.5:9b' && /Gemma 4 26B e o gpt-oss 20B/.test(r16.principal.motivo) || r16.principal.motivo,
        ['gemma4:26b-a4b-it-qat', 'gpt-oss:20b'].every((n) => r16.alternativas.some((a) => a.nome === n && a.cabe)) || 'alternativas em 16 GB',
        !r8.alternativas.some((a) => /gemma4|gpt-oss/.test(a.nome)) || 'em 8 GB não aparecem',
        JSON.stringify([campoThink('gpt-oss:20b', false), campoThink('qwen3.5:9b', false), campoThink('x', null)]) === '[{"think":"low"},{"think":false},{}]' || 'think do gpt-oss',
      ];
    },
  },
];
