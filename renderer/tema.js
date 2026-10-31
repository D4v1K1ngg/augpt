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
  // no Windows, a barra do topo é a barra da janela (31/10): os botões de minimizar, maximizar e fechar
  // ficam sobre ela e pegam as cores do tema (o fundo da barra e a cor do texto)
  const barra = window.augpt?.barraDaJanela;
  if (barra?.windows) document.documentElement.classList.add('barra-do-windows');
  const pintarBotoesDoWindows = () => {
    if (!barra?.windows) return;
    const css = getComputedStyle(document.documentElement);
    barra.cores({ fundo: css.getPropertyValue('--void').trim(), simbolos: css.getPropertyValue('--text').trim() }).catch(() => {});
  };
  const aplicar = (tema) => {
    document.documentElement.setAttribute('data-theme', tema);
    if (document.readyState !== 'loading') pintarBotoesDoWindows();
  };
  aplicar(guardado === 'light' || guardado === 'dark' ? guardado : doSistema());

  window.addEventListener('DOMContentLoaded', () => {
    pintarBotoesDoWindows();
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
