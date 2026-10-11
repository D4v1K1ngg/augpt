(function (global) {
  'use strict';

  /**
   * Gráficos no chat.
   *
   * O modelo emite um bloco ```chart com JSON, e este módulo VALIDA e desenha
   * em Canvas. Nada de executar JavaScript vindo do modelo: o que chega é dado,
   * e dado é conferido antes de virar pixel.
   *
   * Sem biblioteca externa — o projeto não tem dependências, e linha, barra e
   * pizza cobrem quase tudo que uma resposta precisa mostrar.
   */

  const TIPOS = ['line', 'area', 'bar', 'column', 'horizontalBar', 'pie', 'doughnut'];

  const CORES = [
    '#e9a13b', '#4aa3c7', '#8e7bea', '#5cb87a', '#e05a4e',
    '#d98cc0', '#7f8fa6', '#c9a227', '#4e9f8a', '#b06a3b',
  ];

  const LIMITES = { series: 6, pontos: 120, rotulo: 40, titulo: 90 };

  /**
   * Devolve { ok, spec } ou { ok: false, erro }.
   * Rejeitar cedo é melhor que desenhar lixo: gráfico errado engana mais que
   * texto errado, porque parece resultado de cálculo.
   */
  function validar(bruto) {
    let dados;
    try {
      dados = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    } catch (err) {
      return { ok: false, erro: 'o bloco não é um JSON válido' };
    }
    if (!dados || typeof dados !== 'object') return { ok: false, erro: 'o bloco não é um objeto' };

    const tipo = TIPOS.includes(dados.type) ? dados.type : 'bar';

    const rotulos = (Array.isArray(dados.labels) ? dados.labels : [])
      .slice(0, LIMITES.pontos)
      .map((r) => String(r).slice(0, LIMITES.rotulo));
    if (!rotulos.length) return { ok: false, erro: 'faltam os rótulos (labels)' };

    const brutos = Array.isArray(dados.datasets) ? dados.datasets : [];
    const series = [];

    for (const s of brutos.slice(0, LIMITES.series)) {
      const valores = (Array.isArray(s?.data) ? s.data : [])
        .slice(0, rotulos.length)
        .map((v) => {
          const n = typeof v === 'string' ? Number(String(v).replace(/\./g, '').replace(',', '.')) : Number(v);
          return Number.isFinite(n) ? n : null;
        });
      if (!valores.some((v) => v !== null)) continue;
      series.push({
        nome: String(s?.label || '').slice(0, LIMITES.rotulo),
        valores,
        cor: /^#[0-9a-f]{3,8}$/i.test(String(s?.color || '')) ? s.color : null,
      });
    }

    if (!series.length) return { ok: false, erro: 'nenhuma série com números válidos' };
    if ((tipo === 'pie' || tipo === 'doughnut') && series.length > 1) series.length = 1;

    return {
      ok: true,
      spec: {
        tipo,
        titulo: String(dados.title || '').slice(0, LIMITES.titulo),
        rotulos,
        series,
        eixoY: String(dados.yLabel || '').slice(0, LIMITES.rotulo),
      },
    };
  }

  /* ------------------------------ desenho ------------------------------ */

  const formatar = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}B`;
    if (abs >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
    if (abs >= 1e4) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  };

  /** Escala "bonita": passos de 1, 2 ou 5 vezes potência de dez. */
  function escala(min, max) {
    if (min === max) {
      const delta = Math.abs(min) || 1;
      return { min: min - delta * 0.5, max: max + delta * 0.5, passo: delta / 2 };
    }
    const bruto = (max - min) / 4;
    const potencia = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) || potencia * 10;
    return { min: Math.floor(min / passo) * passo, max: Math.ceil(max / passo) * passo, passo };
  }

  function desenhar(canvas, spec, tema) {
    const ctx = canvas.getContext('2d');
    const dpr = global.devicePixelRatio || 1;
    const largura = canvas.clientWidth || 640;
    const altura = Number(canvas.dataset.altura) || 280;

    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    canvas.style.height = `${altura}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, largura, altura);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const cor = (i, serie) => serie.cor || CORES[i % CORES.length];
    const circular = spec.tipo === 'pie' || spec.tipo === 'doughnut';

    if (circular) return desenharCircular(ctx, spec, { largura, altura, tema, cor });
    return desenharEixos(ctx, spec, { largura, altura, tema, cor });
  }

  function desenharEixos(ctx, spec, { largura, altura, tema, cor }) {
    const horizontal = spec.tipo === 'horizontalBar';
    const numeros = spec.series.flatMap((s) => s.valores.filter((v) => v !== null));
    const { min, max, passo } = escala(Math.min(0, ...numeros), Math.max(...numeros));

    const esquerda = horizontal ? Math.min(140, largura * 0.32) : 54;
    const baixo = 34;
    const topo = spec.titulo ? 34 : 14;
    const direita = 14;
    const areaL = largura - esquerda - direita;
    const areaA = altura - topo - baixo;

    if (spec.titulo) {
      ctx.fillStyle = tema.forte;
      ctx.font = '600 12.5px system-ui, sans-serif';
      ctx.fillText(spec.titulo, esquerda, topo - 18);
      ctx.font = '11px system-ui, sans-serif';
    }

    const posicao = (valor) => (valor - min) / (max - min || 1);

    // grade e eixo de valores
    ctx.strokeStyle = tema.grade;
    ctx.fillStyle = tema.fraco;
    ctx.lineWidth = 1;
    for (let v = min; v <= max + passo / 2; v += passo) {
      if (horizontal) {
        const x = esquerda + posicao(v) * areaL;
        ctx.beginPath();
        ctx.moveTo(x, topo);
        ctx.lineTo(x, topo + areaA);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(formatar(v), x, topo + areaA + 14);
      } else {
        const y = topo + areaA - posicao(v) * areaA;
        ctx.beginPath();
        ctx.moveTo(esquerda, y);
        ctx.lineTo(esquerda + areaL, y);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(formatar(v), esquerda - 8, y);
      }
    }

    const n = spec.rotulos.length;
    const faixa = (horizontal ? areaA : areaL) / n;

    // rótulos das categorias, pulando quando não couberem
    ctx.fillStyle = tema.fraco;
    const salto = horizontal ? 1 : Math.ceil((n * 52) / areaL);
    spec.rotulos.forEach((rotulo, i) => {
      if (i % salto) return;
      if (horizontal) {
        ctx.textAlign = 'right';
        ctx.fillText(rotulo.slice(0, 22), esquerda - 8, topo + faixa * (i + 0.5));
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(rotulo.slice(0, 14), esquerda + faixa * (i + 0.5), topo + areaA + 14);
      }
    });

    const barras = spec.tipo === 'bar' || spec.tipo === 'column' || horizontal;

    spec.series.forEach((serie, s) => {
      const c = cor(s, serie);
      ctx.strokeStyle = c;
      ctx.fillStyle = c;

      if (barras) {
        const grupo = faixa / spec.series.length;
        const espessura = Math.max(2, grupo * 0.72);
        serie.valores.forEach((valor, i) => {
          if (valor === null) return;
          if (horizontal) {
            const y = topo + faixa * i + grupo * s + (grupo - espessura) / 2;
            const x0 = esquerda + posicao(Math.min(0, valor)) * areaL;
            const comprimento = Math.abs(posicao(valor) - posicao(0)) * areaL;
            ctx.fillRect(x0, y, Math.max(1, comprimento), espessura);
          } else {
            const x = esquerda + faixa * i + grupo * s + (grupo - espessura) / 2;
            const y0 = topo + areaA - posicao(Math.max(0, valor)) * areaA;
            const comprimento = Math.abs(posicao(valor) - posicao(0)) * areaA;
            ctx.fillRect(x, y0, espessura, Math.max(1, comprimento));
          }
        });
        return;
      }

      // linha e área
      const ponto = (i, valor) => ({
        x: esquerda + (n === 1 ? areaL / 2 : (i / (n - 1)) * areaL),
        y: topo + areaA - posicao(valor) * areaA,
      });

      const pontos = serie.valores.map((v, i) => (v === null ? null : ponto(i, v))).filter(Boolean);
      if (!pontos.length) return;

      if (spec.tipo === 'area') {
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.moveTo(pontos[0].x, topo + areaA);
        pontos.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pontos[pontos.length - 1].x, topo + areaA);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.lineWidth = 2;
      ctx.beginPath();
      pontos.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();

      if (pontos.length <= 30) {
        pontos.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    legenda(ctx, spec, { largura, topo, cor });
  }

  function desenharCircular(ctx, spec, { largura, altura, tema, cor }) {
    const serie = spec.series[0];
    const valores = serie.valores.map((v) => Math.max(0, v || 0));
    const soma = valores.reduce((a, b) => a + b, 0) || 1;

    const cx = largura * 0.34;
    const cy = altura / 2 + (spec.titulo ? 8 : 0);
    const raio = Math.min(largura * 0.3, altura * 0.38);
    const interno = spec.tipo === 'doughnut' ? raio * 0.55 : 0;

    if (spec.titulo) {
      ctx.fillStyle = tema.forte;
      ctx.font = '600 12.5px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(spec.titulo, 12, 18);
      ctx.font = '11px system-ui, sans-serif';
    }

    let angulo = -Math.PI / 2;
    valores.forEach((valor, i) => {
      const fatia = (valor / soma) * Math.PI * 2;
      ctx.fillStyle = cor(i, serie);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, raio, angulo, angulo + fatia);
      ctx.closePath();
      ctx.fill();
      angulo += fatia;
    });

    if (interno) {
      ctx.fillStyle = tema.fundo;
      ctx.beginPath();
      ctx.arc(cx, cy, interno, 0, Math.PI * 2);
      ctx.fill();
    }

    // legenda com percentual, que é o que se lê numa pizza
    const x = largura * 0.66;
    ctx.textAlign = 'left';
    spec.rotulos.slice(0, 10).forEach((rotulo, i) => {
      const y = cy - (Math.min(10, spec.rotulos.length) * 18) / 2 + i * 18 + 9;
      ctx.fillStyle = cor(i, serie);
      ctx.fillRect(x, y - 4, 9, 9);
      ctx.fillStyle = tema.texto;
      const pct = ((valores[i] / soma) * 100).toFixed(1).replace('.', ',');
      ctx.fillText(`${rotulo.slice(0, 18)} — ${pct}%`, x + 15, y);
    });
  }

  function legenda(ctx, spec, { largura, topo, cor }) {
    if (spec.series.length < 2) return;
    let x = largura - 14;
    ctx.textAlign = 'right';
    [...spec.series].reverse().forEach((serie, i) => {
      const indice = spec.series.length - 1 - i;
      const nome = serie.nome || `série ${indice + 1}`;
      const largo = ctx.measureText(nome).width;
      ctx.fillStyle = '#8b8b94';
      ctx.fillText(nome, x, topo - 14);
      ctx.fillStyle = cor(indice, serie);
      ctx.fillRect(x - largo - 13, topo - 18, 9, 9);
      x -= largo + 26;
    });
    ctx.textAlign = 'left';
  }

  /** Cria o elemento a partir do bloco ```chart. */
  function criar(bruto) {
    const r = validar(bruto);
    const caixa = document.createElement('div');

    if (!r.ok) {
      caixa.className = 'grafico-erro';
      caixa.textContent = `não foi possível desenhar o gráfico: ${r.erro}`;
      return caixa;
    }

    caixa.className = 'grafico';
    const canvas = document.createElement('canvas');
    canvas.dataset.altura = r.spec.tipo === 'pie' || r.spec.tipo === 'doughnut' ? 240 : 280;
    caixa.appendChild(canvas);

    const pintar = () => {
      const estilo = getComputedStyle(document.body);
      desenhar(canvas, r.spec, {
        texto: estilo.getPropertyValue('--text') || '#ddd',
        forte: estilo.getPropertyValue('--text-forte') || '#fff',
        fraco: estilo.getPropertyValue('--fraco') || '#888',
        grade: estilo.getPropertyValue('--line') || '#2a2a2e',
        fundo: estilo.getPropertyValue('--panel') || '#1a1a1e',
      });
    };

    requestAnimationFrame(pintar);
    if (global.ResizeObserver) new ResizeObserver(pintar).observe(caixa);
    return caixa;
  }

  global.grafico = { validar, criar, TIPOS };
})(window);
