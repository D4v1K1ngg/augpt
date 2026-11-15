'use strict';

/** Escritor enxuto e a rota da conversa (15/11, revisão da estrutura). */

const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'escritor enxuto: poucas regras (cita [n], não inventa, organiza como achar melhor), cartão "#### N." só em produto, preferências mantidas; conversa continua com as regras dela; "qual é melhor X ou Y?" não é conversa, "você acha…" e "estou cansado" são',
    tipo: 'unidade',
    executar() {
      const enxuto = nucleo.sistemaDoEscritor({ hoje: '15/11/2026', comFontes: true, produto: true, enxuto: true, preferencias: 'respostas diretas' });
      const atual = nucleo.sistemaDoEscritor({ hoje: '15/11/2026', comFontes: true, produto: true });
      const conversa = nucleo.sistemaDoEscritor({ hoje: '15/11/2026', conversa: true, enxuto: true });
      const semFontes = nucleo.sistemaDoEscritor({ hoje: '15/11/2026', comFontes: false, enxuto: true });
      const j = '{"precisa_buscar":false,"conversa":true}';
      return [
        enxuto.length < 1200 && atual.length > 5000 || `tamanhos: ${enxuto.length} × ${atual.length}`,
        /escritorEnxuto === true && !ent.produto/.test(require('fs').readFileSync(require.resolve('../../src/agent/nucleo'), 'utf8')) || 'produto fica com o formato de recomendação',
        /\[n\]/.test(enxuto) && /Não invente/.test(enxuto) && /#### N\. Marca Modelo/.test(enxuto) && /respostas diretas/.test(enxuto) || enxuto,
        !/#### N\./.test(semFontes) && /vale confirmar/.test(semFontes) || semFontes,
        /CONVERSA/.test(conversa) || 'conversa mantém as regras dela',
        nucleo.lerEntendimento(j, 'Qual é melhor uma impressora 3d de filamento ou uma que usa resina ?').conversa === false || 'comparação não é conversa',
        nucleo.lerEntendimento(j, 'Você acha que vale a pena aprender violão depois dos 30?').conversa === true && nucleo.lerEntendimento(j, 'estou cansado hoje').conversa === true || 'opinião pessoal e desabafo continuam conversa',
      ];
    },
  },
];
