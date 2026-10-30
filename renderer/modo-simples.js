'use strict';

/**
 * Modo simples (30/10, análise "o AuGPT pelos olhos de um novato": 84 opções em Ajustes, seis modos de pesquisa
 * mostrados duas vezes, "Agente" e "Conversa" no menu). Para quem está começando, só o essencial; em Ajustes →
 * Geral → "Mostrar todos os ajustes", aparece tudo de novo. Nada é desligado: só sai da vista.
 * Quem já usava o AuGPT começa com tudo à vista (src/config.js, modoAvancado).
 */
(function () {
  // o que fica em Ajustes → Geral: as linhas que contêm estes controles (o resto da aba sai da vista)
  const ESSENCIAIS = ['cfgModoAvancado', 'ajIdioma', 'ajNome', 'cfgOuvirChamada', 'cfgNomeDaChamada', 'btnTreinarVoz', 'treinoVoz', 'btnVozInstalar', 'cfgVozFalar', 'cfgVozNome', 'cfgVozVelocidade', 'gModelo', 'gModoResposta', 'cfgImagensNasRespostas', 'cfgAcessoCelular', 'celularAcesso', 'btnAbrirBoasVindas'];
  const ABAS_AVANCADAS = ['ajPesquisa', 'ajMemoria', 'ajTarefas', 'ajComponentes', 'ajAvancado'];
  const MENU_AVANCADO = ['navConversa', 'navSkills', 'navUtilitarios', 'navExecucoes'];
  const MODOS_SIMPLES = new Set(['automatico', 'conversa']);
  const FORA = 'fora-do-simples';
  const $ = (id) => document.getElementById(id);

  function marcarAjustes() {
    const geral = $('ajGeral');
    if (!geral) return;
    for (const grupo of geral.querySelectorAll('section.grupo')) {
      let algum = false;
      for (const filho of grupo.children) {
        if (filho.tagName === 'H2') continue;
        const essencial = ESSENCIAIS.some((id) => filho.id === id || filho.querySelector(`#${id}`));
        filho.classList.toggle(FORA, !essencial);
        if (essencial) algum = true;
      }
      grupo.classList.toggle(FORA, !algum);
    }
    for (const id of ABAS_AVANCADAS) document.querySelector(`.ajustes-aba[data-painel="${id}"]`)?.classList.add('aba-avancada');
  }

  function aplicar() {
    const simples = typeof config === 'undefined' || config?.modoAvancado !== true;
    document.body.classList.toggle('modo-simples', simples);
    for (const id of MENU_AVANCADO) $(id)?.classList.add('menu-avancado');
    // os modos de pesquisa: Automático e Conversar (o que estiver escolhido continua à vista)
    const atual = config?.respostaDireta === true ? 'rapido' : config?.modoDePesquisa || 'automatico';
    for (const sel of ['modoDePesquisa', 'modoNaCaixa', 'gModoDePesquisa']) {
      for (const op of $(sel)?.options || []) op.hidden = simples && !MODOS_SIMPLES.has(op.value) && op.value !== atual;
    }
    // aba avançada aberta quando o modo simples volta: abre a Geral
    if (simples && ABAS_AVANCADAS.some((id) => $(id) && !$(id).hidden)) document.querySelector('.ajustes-aba[data-painel="ajGeral"]')?.click();
    if ($('cfgModoAvancado')) $('cfgModoAvancado').checked = !simples;
  }

  marcarAjustes();
  aplicar();
  $('cfgModoAvancado')?.addEventListener('change', async (e) => {
    config = await api.config.set({ modoAvancado: e.target.checked });
    aplicar();
  });
  // a config pode mudar por outros caminhos (outra janela, boas-vindas): repinta
  const original = manipuladores['config-alterada'];
  manipuladores['config-alterada'] = (d) => {
    const r = original?.(d);
    setTimeout(aplicar, 0);
    return r;
  };
  window.modoSimples = { aplicar };
})();
