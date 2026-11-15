'use strict';

/** O modelo de decisão no núcleo (16/11, "Jev": tev1 pelo /v1/systemone) — opção desligada por padrão. */

const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'decisor do núcleo: confiante, decide produto e tira de conversa; "precisa de web" só muda com ≥ 0,8 ou ≤ 0,2 (e nunca tira a busca de produto); sem confiança ou com erro, nada muda; desligado, nem é chamado',
    tipo: 'unidade',
    async executar() {
      const ent = { produto: false, conversa: true, precisaBuscar: false, atual: false };
      const produto = nucleo.comDecisao(ent, { rota: 'produto', rotaConf: 0.9, web: 0.3 });
      const web = nucleo.comDecisao({ ...ent, conversa: false }, { rota: 'tarefa', rotaConf: 0.3, web: 0.95 });
      const semConfianca = nucleo.comDecisao(ent, { rota: 'produto', rotaConf: 0.4, web: 0.5 });
      const naoTiraBuscaDeProduto = nucleo.comDecisao({ produto: true, precisaBuscar: true }, { rota: 'produto', rotaConf: 0.9, web: 0.1 });
      let chamado = false;
      const desligado = await nucleo.decisaoDoDecisor('x', { decidir: async () => ((chamado = true), {}), modelo: '' });
      const comErro = await nucleo.decisaoDoDecisor('x', { decidir: async () => { throw new Error('sem /v1/systemone'); }, modelo: 'tev1' });
      return [
        produto.ent.produto === true && produto.ent.conversa === false && produto.mudou.join() === 'produto: sim,não é conversa' || JSON.stringify(produto),
        web.ent.precisaBuscar === true && web.mudou.join() === 'pesquisa' || JSON.stringify(web),
        semConfianca.mudou.length === 0 || JSON.stringify(semConfianca),
        naoTiraBuscaDeProduto.ent.precisaBuscar === true || 'produto continua pesquisando',
        desligado === null && !chamado && comErro === null || 'desligado não chama; erro não trava',
      ];
    },
  },
];
