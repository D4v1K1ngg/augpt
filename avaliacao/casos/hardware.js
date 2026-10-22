'use strict';

/**
 * Casos de unidade pra `src/agent/hardware.js` — detecção de RAM/CPU (sem
 * mock: contra os valores reais deste próprio ambiente).
 */

const { detectarHardware } = require('../../src/agent/hardware');

module.exports = [
  {
    nome: 'detectarHardware: formato e valores plausíveis (contra o ambiente real)',
    tipo: 'unidade',
    executar() {
      const h = detectarHardware();
      return [
        typeof h.ramTotalGB === 'number' || 'ramTotalGB não é número',
        typeof h.ramLivreGB === 'number' || 'ramLivreGB não é número',
        typeof h.nucleosCpu === 'number' || 'nucleosCpu não é número',
        h.ramTotalGB > 0 || 'ramTotalGB deveria ser positivo',
        h.nucleosCpu >= 1 || 'nucleosCpu deveria ser pelo menos 1',
        h.ramLivreGB <= h.ramTotalGB + 0.1 || 'RAM livre não pode passar da RAM total',
      ];
    },
  },
];
