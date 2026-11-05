'use strict';

/**
 * Mini AuGPT (5/11, pedido do Davi: "igual ao picture in picture do Firefox"). A janela vira um cartão de chat
 * pequeno, sempre por cima das outras (electron/main.js, janela:mini); aqui a tela fica só com o chat do Agente:
 * sem painel lateral, sem coluna da direita, sem as ondas, com uma barra compacta. Ctrl+Shift+M liga e desliga.
 */
(() => {
  const api = window.augpt?.barraDaJanela;
  const botao = document.getElementById('btnMini');
  const sair = document.getElementById('btnSairMini');
  if (!api?.mini || !botao || !sair) return;
  let ligado = false;

  async function alternar(ligar = !ligado) {
    if (ligar === ligado) return;
    // a tela muda antes da janela encolher: o conteúdo já cabe no cartão quando ele aparece
    document.body.classList.toggle('modo-mini', ligar);
    if (ligar && typeof trocarAba === 'function') trocarAba('agente');
    ligado = Boolean(await api.mini(ligar).catch(() => false));
    document.body.classList.toggle('modo-mini', ligado);
    const rotulo = document.getElementById('secaoAtual');
    if (rotulo && ligado) rotulo.textContent = 'AuGPT';
    else if (!ligado && typeof trocarAba === 'function') trocarAba('agente');
    // o texto de exemplo da caixa quebrava em 2 linhas na largura do mini (e aparecia a barra de rolagem)
    const caixa = document.getElementById('entradaAgente');
    if (caixa) {
      if (ligado) {
        caixa.dataset.placeholderInteiro ??= caixa.placeholder;
        caixa.placeholder = document.documentElement.lang === 'en' ? 'Ask AuGPT…' : 'Pergunte ao AuGPT…';
      } else if (caixa.dataset.placeholderInteiro) caixa.placeholder = caixa.dataset.placeholderInteiro;
    }
    // a resposta que estava na tela continua à vista no tamanho novo
    const rolagem = document.getElementById('agenteRolagem');
    if (rolagem) rolagem.scrollTop = rolagem.scrollHeight;
    document.getElementById('entradaAgente')?.focus();
  }

  botao.addEventListener('click', () => alternar(true));
  sair.addEventListener('click', () => alternar(false));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      alternar();
    }
  });
  window.miniAuGPT = { alternar, ligado: () => ligado };
})();
