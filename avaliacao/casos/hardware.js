'use strict';

/**
 * Casos de unidade pra `src/agent/hardware.js` — detecção de RAM/CPU (sem
 * mock: contra os valores reais deste próprio ambiente) e a recomendação de
 * modo do Copiloto nível 2, testada contra hardware sintético pros dois
 * limiares (com/sem RAM de sobra).
 */

const { detectarHardware, recomendarModoCopiloto, RAM_LIVRE_MINIMA_DOIS_MODELOS_GB } =
  require('../../src/agent/hardware');

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
  {
    nome: 'recomendarModoCopiloto: RAM de sobra recomenda "2 IAs", com motivo em português',
    tipo: 'unidade',
    executar() {
      const r = recomendarModoCopiloto({ ramTotalGB: 32, ramLivreGB: RAM_LIVRE_MINIMA_DOIS_MODELOS_GB + 2, nucleosCpu: 16 });
      return [
        r.modo === 'doisModelos' || `esperava modo "doisModelos", veio "${r.modo}"`,
        (r.motivo && r.motivo.length > 10) || 'motivo vazio ou curto demais',
      ];
    },
  },
  {
    nome: 'recomendarModoCopiloto: RAM apertada recomenda "mesmo modelo", NÃO bloqueia — só avisa',
    tipo: 'unidade',
    executar() {
      const r = recomendarModoCopiloto({ ramTotalGB: 8, ramLivreGB: RAM_LIVRE_MINIMA_DOIS_MODELOS_GB - 2, nucleosCpu: 4 });
      return [
        r.modo === 'mesmoModelo' || `esperava modo "mesmoModelo", veio "${r.modo}"`,
        (r.motivo && r.motivo.length > 10) || 'motivo vazio ou curto demais',
        !/bloqueado|impedido|proibido/i.test(r.motivo) || 'motivo não pode soar como bloqueio — é só recomendação',
      ];
    },
  },
  {
    nome: 'recomendarModoCopiloto: limiar exato de RAM livre já conta como "de sobra" (>=, não >)',
    tipo: 'unidade',
    executar() {
      const r = recomendarModoCopiloto({ ramTotalGB: 16, ramLivreGB: RAM_LIVRE_MINIMA_DOIS_MODELOS_GB, nucleosCpu: 8 });
      return [r.modo === 'doisModelos' || `no limiar exato, esperava "doisModelos", veio "${r.modo}"`];
    },
  },
];
