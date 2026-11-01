'use strict';

/*
 * A tela inicial (1/11, a partir da maquete do Davi, com as cores e os temas do AuGPT): o orbe "Au", o título, os
 * 4 atalhos e o fundo de ondas douradas. Antes, o carrossel dos recursos (abertura-deck.js).
 *  - Atalho: põe um pedido de exemplo na caixa de mensagem (não envia) — o que o AuGPT faz de melhor.
 *  - Ondas: um <canvas> atrás da tela inicial. Só desenha com ela à vista, o app em primeiro plano e o modelo
 *    parado (a placa fica para ele); com "reduzir animações" do Windows, um quadro parado. A cor vem do tema.
 * Usa as globais da tela ($, el, autoAltura) — carregado depois dos app*.js.
 */
(() => {
  const inicio = document.getElementById('inicioAgente');
  const cv = document.getElementById('ondasInicio');
  if (!inicio || !cv) return;

  /* ------------------------------ os atalhos ------------------------------ */
  for (const b of inicio.querySelectorAll('.inicio-atalho')) {
    b.addEventListener('click', () => {
      const caixa = el.aEntrada;
      caixa.value = tr(b.dataset.pedido);
      autoAltura?.(caixa);
      caixa.focus();
      caixa.setSelectionRange(caixa.value.length, caixa.value.length);
    });
  }

  /* ------------------------------ as ondas ------------------------------ */
  const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const g = cv.getContext('2d');
  let largura = 0;
  let altura = 0;
  let quadro = 0;
  let tempo = 0;
  let antes = 0;
  let cor = '224,176,79';
  let escuro = true;

  /** "#e0b04f" ou "rgb(…)" → "224,176,79" (a cor --gold do tema). */
  function lerCor() {
    const css = getComputedStyle(document.documentElement);
    const v = css.getPropertyValue('--gold').trim();
    escuro = document.documentElement.getAttribute('data-theme') !== 'light';
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) cor = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).join(',');
    else if (/^rgb/.test(v)) cor = v.replace(/[^\d,]/g, '').split(',').slice(0, 3).join(',');
  }

  function medir() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // ponytail: 1,5 basta para ondas suaves e poupa a placa
    largura = r.width;
    altura = r.height;
    cv.width = Math.max(1, Math.round(largura * dpr));
    cv.height = Math.max(1, Math.round(altura * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Dunas: camadas de ondas preenchidas com um degradê dourado que some para baixo, e a linha de cada crista. */
  function desenhar(t) {
    g.clearRect(0, 0, largura, altura);
    const forca = escuro ? 1 : 0.8;
    for (let k = 0; k < 7; k++) {
      const base = altura * (0.5 + k * 0.065);
      const amp = 18 + k * 6;
      g.beginPath();
      g.moveTo(-10, altura + 10);
      const pontos = [];
      for (let x = -10; x <= largura + 10; x += 14) {
        const y = base + Math.sin(x * (0.0042 + k * 0.0004) + t * (0.22 + k * 0.04) + k * 1.7) * amp + Math.sin(x * 0.011 - t * 0.4 + k) * amp * 0.26;
        pontos.push([x, y]);
        g.lineTo(x, y);
      }
      g.lineTo(largura + 10, altura + 10);
      g.closePath();
      const gr = g.createLinearGradient(0, base - amp, 0, altura);
      gr.addColorStop(0, `rgba(${cor},${(0.035 + k * 0.016) * forca})`);
      gr.addColorStop(1, `rgba(${cor},0)`);
      g.fillStyle = gr;
      g.fill();
      g.beginPath();
      pontos.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = `rgba(${cor},${(0.08 + k * 0.03) * forca})`;
      g.lineWidth = 1;
      g.stroke();
    }
  }

  const visivel = () => !el.aAbertura.hidden && !document.getElementById('viewAgente').hidden && !document.hidden;
  // Ajustes → Geral → Fundo da tela inicial: "seguir o Windows" (padrão; com "Efeitos de animação" desligado no
  // Windows, fica parado), "animado" ou "parado"
  const semAnimacao = () => {
    const modo = (typeof config !== 'undefined' && config?.ondasInicio) || 'auto';
    return modo === 'parado' || (modo === 'auto' && Boolean(reduzido?.matches));
  };
  const parado = () => semAnimacao() || (typeof agente !== 'undefined' && agente.rodando);

  function passo(agora) {
    quadro = 0;
    if (!visivel()) return;
    // ~30 quadros por segundo bastam para ondas lentas
    if (agora - antes >= 33) {
      tempo += Math.min(agora - antes, 100) / 1000;
      antes = agora;
      desenhar(tempo);
    }
    if (!parado()) quadro = requestAnimationFrame(passo);
  }

  function atualizar() {
    const mostrar = !el.aAbertura.hidden;
    cv.hidden = !mostrar;
    if (!mostrar) {
      cancelAnimationFrame(quadro);
      quadro = 0;
      return;
    }
    medir();
    lerCor();
    desenhar(tempo); // um quadro na hora (o parado, com "reduzir animações")
    // as órbitas do orbe também param quando não há o que animar
    const orbitas = inicio.querySelector('.inicio-orbitas');
    if (parado() || !visivel()) orbitas?.pauseAnimations?.();
    else orbitas?.unpauseAnimations?.();
    if (!quadro && !parado() && visivel()) {
      antes = performance.now();
      quadro = requestAnimationFrame(passo);
    }
  }

  new MutationObserver(atualizar).observe(el.aAbertura, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => setTimeout(atualizar, 50)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', atualizar);
  window.addEventListener('resize', atualizar);
  reduzido?.addEventListener?.('change', atualizar);
  // o modelo começou ou terminou: as ondas param e voltam
  for (const canal of ['inicio', 'concluido', 'erro', 'interrompido', 'limite']) {
    const original = manipuladores[canal];
    manipuladores[canal] = (d) => {
      const r = original?.(d);
      setTimeout(atualizar, 0);
      return r;
    };
  }
  const escolha = document.getElementById('cfgOndasInicio');
  escolha?.addEventListener('change', async (e) => {
    config = await api.config.set({ ondasInicio: e.target.value });
    atualizar();
  });
  atualizar();
  // a caixa de Ajustes é pintada com as outras (app-ajustes.js)
  window.ondasDoInicio = { atualizar, pintar: () => escolha && (escolha.value = config?.ondasInicio || 'auto') };
})();
