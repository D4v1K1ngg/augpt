'use strict';

/* Tema claro ou escuro (20/10, identidade "Au"). Roda no <head>, antes de pintar:
 * a escolha guardada vale; sem escolha, segue o Windows. O botão da barra alterna. */
(() => {
  const CHAVE = 'augpt:tema';
  let guardado = null;
  try {
    guardado = localStorage.getItem(CHAVE);
  } catch {}
  const doSistema = () => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const aplicar = (tema) => document.documentElement.setAttribute('data-theme', tema);
  aplicar(guardado === 'light' || guardado === 'dark' ? guardado : doSistema());

  window.addEventListener('DOMContentLoaded', () => {
    const botao = document.getElementById('btnTema');
    if (!botao) return;
    botao.addEventListener('click', () => {
      const novo = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      aplicar(novo);
      try {
        localStorage.setItem(CHAVE, novo);
      } catch {}
      // os gráficos leem as cores do tema ao desenhar: redesenha os que estão na tela
      window.dispatchEvent(new Event('resize'));
    });
  });
})();
