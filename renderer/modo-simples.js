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
  /*
   * A pesquisa andando na tela (30/10, item 3 da análise do novato): no modo simples, em vez de "passo 1 de 6" e dos
   * medidores (passos, tokens, contexto), uma frase do que ele está fazendo agora — a busca, o site que está lendo,
   * a escrita. Os detalhes técnicos continuam no modo avançado.
   */
  const simplesAgora = () => document.body.classList.contains('modo-simples');
  const situacaoOriginal = window.situacao;
  // "executando buscar_na_web" → "Pesquisando na internet…"
  const FERRAMENTAS = { buscar_na_web: 'Pesquisando na internet…', buscar_na_comunidade: 'Vendo o que a comunidade diz…', ler_pagina: 'Lendo uma página…', pesquisar_e_ler: 'Pesquisando e lendo…', abrir_pagina: 'Abrindo a página…', navegar: 'Abrindo o site…', clicar: 'Clicando na página…', preencher_campo: 'Preenchendo na página…', buscar_no_youtube: 'Procurando vídeos…', ver_video: 'Vendo o vídeo…', olhar_tela: 'Olhando a sua tela…', pronto: 'Juntando o que achei…' };
  if (typeof situacaoOriginal === 'function') {
    window.situacao = (texto) => {
      const t = String(texto || '').trim();
      if (!simplesAgora()) return situacaoOriginal(texto);
      if (/^(passo|step) \d+ (de|of) \d+$/i.test(t)) return undefined;
      const ferramenta = /^(?:executando|running) ([a-z_]+)/i.exec(t)?.[1];
      if (ferramenta) return situacaoOriginal(tr(FERRAMENTAS[ferramenta] || 'Trabalhando nisso…'));
      return situacaoOriginal(texto);
    };
  }
  const site = (url) => {
    try {
      const h = new URL(url).hostname.replace(/^(www|m|pt|br)\./, '');
      return h.split('.').filter((p) => !/^(com|org|net|gov|edu|br|co|io|info)$/.test(p)).pop() || h;
    } catch {
      return '';
    }
  };
  const embrulhar = (canal, antes) => {
    const original = manipuladores[canal];
    manipuladores[canal] = (d = {}) => {
      const r = original?.(d);
      try {
        if (simplesAgora() && agente?.rodando) antes(d);
      } catch {
        // a frase nunca atrapalha a tela
      }
      return r;
    };
  };
  embrulhar('nucleo-entendimento', (d) => d.precisaBuscar && situacaoOriginal?.(tr('Entendi. Vou pesquisar isso na internet…')));
  embrulhar('fonte', (d) => {
    if (d.tipo === 'busca' && d.consultas?.[0]) situacaoOriginal?.(tr('Pesquisando: {q}', { q: String(d.consultas[0]).slice(0, 70) }));
  });
  embrulhar('redigindo', (d) => situacaoOriginal?.(d.fontes ? tr('Escrevendo a resposta com o que achei em {n} fontes…', { n: d.fontes }) : tr('Escrevendo a resposta…')));
  embrulhar('achado', (d) => {
    const s = site(`https://${d.site || ''}`) || d.site;
    if (s) situacaoOriginal?.(d.titulo ? tr('Lendo {site}: {titulo}', { site: s, titulo: String(d.titulo).slice(0, 70) }) : tr('Lendo {site}…', { site: s }));
  });

  window.modoSimples = { aplicar };
})();
