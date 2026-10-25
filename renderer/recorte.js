'use strict';

/**
 * Escolher a área da tela (25/10): a tela congelada por cima de tudo; arraste para marcar a área.
 * Enter ou duplo clique = a tela inteira; Esc ou botão direito = cancelar.
 */
(async function () {
  const $ = (id) => document.getElementById(id);
  const dados = await window.recorte.imagem();
  if (!dados) return window.recorte.escolher(null);
  const en = dados.idioma === 'en';
  $('dica').textContent = en
    ? 'Drag to pick the area AuGPT should look at · Enter or double-click = whole screen · Esc = cancel'
    : 'Arraste para escolher o que o AuGPT vai olhar · Enter ou duplo clique = tela inteira · Esc = cancelar';
  $('foto').src = dados.imagem;

  let inicio = null;
  let area = null;
  const pintar = () => {
    const el = $('area');
    el.hidden = !area;
    $('veu').hidden = Boolean(area);
    if (!area) return;
    Object.assign(el.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` });
    $('medida').textContent = `${Math.round(area.width)} × ${Math.round(area.height)}`;
  };

  document.addEventListener('mousedown', (e) => {
    if (e.button === 2) return window.recorte.escolher(null);
    if (e.button !== 0) return;
    inicio = { x: e.clientX, y: e.clientY };
    area = null;
    pintar();
  });
  document.addEventListener('mousemove', (e) => {
    if (!inicio) return;
    area = { x: Math.min(inicio.x, e.clientX), y: Math.min(inicio.y, e.clientY), width: Math.abs(e.clientX - inicio.x), height: Math.abs(e.clientY - inicio.y) };
    pintar();
  });
  document.addEventListener('mouseup', () => {
    if (!inicio) return;
    inicio = null;
    // clique sem arrastar não vale como área (o duplo clique escolhe a tela inteira)
    if (area && area.width >= 8 && area.height >= 8) window.recorte.escolher(area);
    else {
      area = null;
      pintar();
    }
  });
  document.addEventListener('dblclick', () => window.recorte.escolher('tudo'));
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.recorte.escolher(null);
    else if (e.key === 'Enter') window.recorte.escolher('tudo');
  });
})();
