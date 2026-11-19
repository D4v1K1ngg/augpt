'use strict';

/**
 * O navegador do AuGPT no canto do chat (19/11, Davi: "quando eu pedir para acessar um site e navegar dentro dele, a
 * janela do navegador deveria abrir pequena no canto direito da tela do chat e ficar fixa"). A página é uma vista do
 * Electron (electron/navegador.js, abrirNoChat) desenhada por cima da tela: aqui fica a moldura (título, ampliar,
 * minimizar, fechar) e o retângulo onde a vista entra é mandado ao processo principal sempre que muda. A vista some
 * quando o chat não está à vista (outra aba, Ajustes, uma janela de diálogo aberta) — senão ficaria por cima delas.
 * Usa as globais da tela (api, manipuladores, tr) — carregado depois dos app*.js.
 */
(() => {
  const chat = document.getElementById('viewAgente');
  if (!chat || !api.browser?.area) return;
  const painel = document.createElement('div');
  painel.className = 'painel-navegador';
  painel.hidden = true;
  painel.innerHTML = `<div class="pn-topo"><span class="pn-ponto" aria-hidden="true"></span><span class="pn-titulo">${tr('Navegador do AuGPT')}</span>
    <button type="button" data-a="ampliar" title="${tr('Ampliar')}" aria-label="${tr('Ampliar')}">⤢</button>
    <button type="button" data-a="minimizar" title="${tr('Minimizar')}" aria-label="${tr('Minimizar')}">–</button>
    <button type="button" data-a="fechar" title="${tr('Fechar o navegador')}" aria-label="${tr('Fechar o navegador')}">×</button></div>
    <div class="pn-corpo"></div>`;
  chat.appendChild(painel);
  const corpo = painel.querySelector('.pn-corpo');
  let ultimo = '';
  let vigia = null;

  // a vista do Electron fica por cima de tudo: só aparece com o chat à vista e sem diálogo aberto
  const visivel = () =>
    !painel.hidden && !painel.classList.contains('minimizado') && chat.offsetParent !== null && !document.querySelector('dialog[open]') && document.visibilityState !== 'hidden';
  function informar() {
    let area = null;
    if (visivel()) {
      const r = corpo.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) area = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    const chave = JSON.stringify(area);
    if (chave === ultimo) return;
    ultimo = chave;
    api.browser.area(area);
  }

  manipuladores['navegador-painel'] = ({ aberto, url, titulo } = {}) => {
    painel.hidden = !aberto;
    if (aberto) {
      let site = '';
      try {
        site = url ? new URL(url).hostname.replace(/^www\./, '') : '';
      } catch {
        /* sem endereço ainda */
      }
      painel.querySelector('.pn-titulo').textContent = titulo || site || tr('Navegador do AuGPT');
      painel.title = url || '';
      if (!vigia) vigia = setInterval(informar, 400); // aba, diálogo, tamanho da janela: o que mudar, a vista acompanha
    } else {
      clearInterval(vigia);
      vigia = null;
      painel.classList.remove('ampliado', 'minimizado');
    }
    ultimo = '';
    requestAnimationFrame(informar);
  };

  painel.querySelector('.pn-topo').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'fechar') api.browser.close();
    else if (a === 'ampliar') painel.classList.toggle('ampliado');
    else if (a === 'minimizar' || (!a && painel.classList.contains('minimizado'))) painel.classList.toggle('minimizado');
    ultimo = '';
    requestAnimationFrame(informar);
  });
  window.addEventListener('resize', () => requestAnimationFrame(informar));
})();
