'use strict';

/**
 * Comunidades especializadas (16/11, item 3 das melhorias: "recomendação de produtos mais estável"): o Reddit e o
 * Head-Fi bloqueiam leitores automáticos (verificação anti-robô); o Audio Science Review abre. A busca de critérios
 * em inglês vai ao fórum especializado que deixa ler, e a especializada vem antes das gerais.
 */

const { consultasNaComunidade, forumEmInglesDoAssunto, fontesPadrao } = require('../../src/tools/comunidade');
const { paginaDeBloqueio } = require('../../src/tools/extract');

module.exports = [
  {
    nome: 'comunidade especializada: fone → Audio Science Review na busca de critérios (o Head-Fi bloqueia a leitura); a especializada antes das gerais; a verificação do Head-Fi conta como bloqueio',
    tipo: 'unidade',
    executar() {
      const fone = consultasNaComunidade('melhor fone intra para pubg', { maximo: 4 }).map((q) => q.fonte);
      const placa = consultasNaComunidade('melhor placa de vídeo até 3000', { maximo: 4 }).map((q) => q.fonte);
      const emIngles = consultasNaComunidade('fone intra pubg', { maximo: 4, emIngles: 'best IEM for gaming' });
      return [
        forumEmInglesDoAssunto('qual o melhor fone intra auricular para jogar?') === 'audiosciencereview.com' || 'fone → ASR',
        forumEmInglesDoAssunto('melhor placa de vídeo para jogos') === null || 'sem fórum especializado → fica o Reddit',
        forumEmInglesDoAssunto('melhor fone', { fontesComunidade: ['head-fi.org', 'reddit.com'] }) === null || 'Head-Fi (bloqueado) nunca é escolhido',
        fone.slice(0, 2).join(',') === 'Head-Fi,Audio Science Review' && fone.includes('Reddit') || fone.join(','),
        !placa.includes('Head-Fi') && !placa.includes('Audio Science Review') && placa[0] === 'Reddit' || placa.join(','),
        emIngles.find((q) => q.fonte === 'Audio Science Review').consulta === 'site:audiosciencereview.com best IEM for gaming' && emIngles.find((q) => q.fonte === 'Clube do Hardware').consulta === 'site:clubedohardware.com.br fone intra pubg' || JSON.stringify(emIngles),
        paginaDeBloqueio("Help us keep Head-Fi secure. Checking you are a real Head-Fi'er! Looks like something went wrong.") === true || 'a verificação do Head-Fi é bloqueio',
        fontesPadrao().find((f) => f.dominio === 'head-fi.org').leitura === 'bloqueada' || 'Head-Fi marcado',
      ];
    },
  },
];
