(function (global) {
  'use strict';

  /**
   * Gráficos no chat.
   *
   * O modelo emite um bloco ```chart com JSON, e este módulo VALIDA e desenha
   * em Canvas. Nada de executar JavaScript vindo do modelo: o que chega é dado,
   * e dado é conferido antes de virar pixel. Sem biblioteca externa.
   *
   * 18/10 (versão 2): tipos novos — colunas empilhadas, combinado (colunas +
   * linha), dispersão, linha e área com pontos —, estimativas (ponto que não
   * está nas fontes sai tracejado/hachurado e a dica diz "estimativa"), faixa
   * de incerteza (low/high, para projeção) e interação: dica com os valores ao
   * passar o mouse (ou tocar), linha-guia, e legenda clicável que esconde ou
   * mostra cada série. O formato antigo continua valendo.
   *
   * {
   *   "type": "bar" | "column" | "horizontalBar" | "stackedBar" | "line" | "area" | "combo" | "scatter" | "pie" | "doughnut",
   *   "title": "…", "labels": ["…"], "unit": "R$" | "%" | "ms" | …, "yLabel": "…", "stacked": false,
   *   "datasets": [{ "label": "…", "data": [1, 2, null], "type": "bar" | "line" | "area",
   *                  "estimated": [false, true] | true, "low": [..], "high": [..], "points": true, "color": "#hex" }]
   * }
   * Dispersão: "data": [[x, y], …] ou [{ "x": 1, "y": 2 }, …].
   */

  const TIPOS = ['line', 'area', 'bar', 'column', 'horizontalBar', 'stackedBar', 'combo', 'scatter', 'pie', 'doughnut'];

  const CORES = ['#e9a13b', '#4aa3c7', '#8e7bea', '#5cb87a', '#e05a4e', '#d98cc0', '#7f8fa6', '#c9a227', '#4e9f8a', '#b06a3b'];

  const LIMITES = { series: 8, pontos: 200, rotulo: 40, titulo: 90 };
  // cor do modelo em #rrggbb (o degradê da área soma a transparência no fim: "#abc" + "55" quebraria)
  const corValida = (c) => {
    const t = String(c || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(t)) return t;
    if (/^#[0-9a-f]{8}$/i.test(t)) return t.slice(0, 7);
    if (/^#[0-9a-f]{3,4}$/i.test(t)) return `#${t.slice(1, 4).split('').map((x) => x + x).join('')}`;
    return null;
  };

  const numero = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v).replace(/[^\d,.-]/g, '');
    const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const listaDe = (v, n) => (Array.isArray(v) ? v.slice(0, n).map(numero) : null);

  /** { ok, spec } ou { ok: false, erro }. */
  function validar(bruto) {
    let dados;
    try {
      dados = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    } catch (err) {
      return { ok: false, erro: 'o bloco não é um JSON válido' };
    }
    if (!dados || typeof dados !== 'object') return { ok: false, erro: 'o bloco não é um objeto' };

    let tipo = TIPOS.includes(dados.type) ? dados.type : 'bar';
    if (tipo === 'column') tipo = 'bar';
    const empilhado = tipo === 'stackedBar' || dados.stacked === true;
    const brutos = (Array.isArray(dados.datasets) ? dados.datasets : []).slice(0, LIMITES.series);

    // dispersão: pares (x, y), sem rótulos
    if (tipo === 'scatter') {
      const series = brutos
        .map((s, i) => ({
          nome: String(s?.label || `série ${i + 1}`).slice(0, LIMITES.rotulo),
          cor: corValida(s?.color),
          pares: (Array.isArray(s?.data) ? s.data : [])
            .slice(0, LIMITES.pontos)
            .map((p) => (Array.isArray(p) ? [numero(p[0]), numero(p[1])] : [numero(p?.x), numero(p?.y)]))
            .filter(([x, y]) => x !== null && y !== null),
        }))
        .filter((s) => s.pares.length);
      if (!series.length) return { ok: false, erro: 'dispersão sem pares (x, y) válidos' };
      return { ok: true, spec: { tipo, titulo: String(dados.title || '').slice(0, LIMITES.titulo), rotulos: [], series, unidade: String(dados.unit || '').slice(0, 16), eixoX: String(dados.xLabel || '').slice(0, LIMITES.rotulo), eixoY: String(dados.yLabel || '').slice(0, LIMITES.rotulo) } };
    }

    const rotulos = (Array.isArray(dados.labels) ? dados.labels : []).slice(0, LIMITES.pontos).map((r) => String(r).slice(0, LIMITES.rotulo));
    if (!rotulos.length) return { ok: false, erro: 'faltam os rótulos (labels)' };
    const n = rotulos.length;

    const series = [];
    brutos.forEach((s, i) => {
      const valores = (listaDe(s?.data, n) || []).concat(Array(Math.max(0, n - (s?.data?.length || 0))).fill(null)).slice(0, n);
      if (!valores.some((v) => v !== null)) return;
      const estimadosBrutos = s?.estimated;
      const estimados = estimadosBrutos === true ? valores.map(() => true) : Array.isArray(estimadosBrutos) ? valores.map((_, j) => estimadosBrutos[j] === true) : valores.map(() => false);
      const porPadrao = tipo === 'combo' ? (i === 0 ? 'bar' : 'line') : tipo === 'line' || tipo === 'area' ? tipo : 'bar';
      const tipoSerie = ['bar', 'line', 'area'].includes(s?.type) && !['pie', 'doughnut', 'horizontalBar'].includes(tipo) ? s.type : porPadrao;
      // unidade da série: a dela, ou a que o nome traz entre parênteses ("EUA (US$)") — 18/10: R$ e US$
      // no mesmo gráfico e a dica dizia "EUA: R$ 1.249"
      const daLegenda = /\((R\$|US\$|U\$|€|£|%|ms|W|GB|MB|Mbps|fps|km\/h|kg)\)\s*$/i.exec(String(s?.label || ''))?.[1] || '';
      series.push({
        nome: String(s?.label || '').slice(0, LIMITES.rotulo),
        unidade: String(s?.unit || daLegenda).slice(0, 16),
        valores,
        estimados,
        baixo: listaDe(s?.low, n),
        alto: listaDe(s?.high, n),
        tipo: tipoSerie,
        pontos: s?.points === false ? false : s?.points === true || n <= 40,
        cor: corValida(s?.color),
      });
    });

    if (!series.length) return { ok: false, erro: 'nenhuma série com números válidos' };
    if ((tipo === 'pie' || tipo === 'doughnut') && series.length > 1) series.length = 1;

    return {
      ok: true,
      spec: {
        tipo,
        titulo: String(dados.title || '').slice(0, LIMITES.titulo),
        rotulos,
        series,
        empilhado,
        unidade: String(dados.unit || '').slice(0, 16),
        eixoY: String(dados.yLabel || '').slice(0, LIMITES.rotulo),
      },
    };
  }

  /* ------------------------------ números e escala ------------------------------ */

  const MOEDA = /^(R\$|US\$|U\$|\$|€|£)$/;
  const compacto = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
    if (abs >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (abs >= 1e4) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  };
  const comUnidade = (texto, unidade) => (!unidade ? texto : MOEDA.test(unidade) ? `${unidade} ${texto}` : unidade === '%' ? `${texto}%` : `${texto} ${unidade}`);
  const noEixo = (n, unidade) => comUnidade(compacto(n), MOEDA.test(unidade) || unidade === '%' ? unidade : '');
  const exato = (n, unidade) => comUnidade(n.toLocaleString('pt-BR', MOEDA.test(unidade) ? { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }), unidade);

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

  // hachura das barras estimadas
  const hachuras = new Map();
  function hachura(ctx, cor) {
    if (hachuras.has(cor)) return hachuras.get(cor);
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const x = c.getContext('2d');
    x.globalAlpha = 0.35;
    x.fillStyle = cor;
    x.fillRect(0, 0, 8, 8);
    x.globalAlpha = 1;
    x.strokeStyle = cor;
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(-2, 10);
    x.lineTo(10, -2);
    x.stroke();
    const p = ctx.createPattern(c, 'repeat');
    hachuras.set(cor, p);
    return p;
  }

  /* ------------------------------ desenho ------------------------------ */

  /**
   * Desenha e devolve a geometria (para a interação): qual categoria, ponto ou
   * fatia está sob o mouse.
   */
  function desenhar(canvas, spec, tema, estado) {
    const ctx = canvas.getContext('2d');
    const dpr = global.devicePixelRatio || 1;
    const largura = canvas.clientWidth || 640;
    const altura = Number(canvas.dataset.altura) || 300;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    canvas.style.height = `${altura}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, largura, altura);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const cor = (i, serie) => serie.cor || CORES[i % CORES.length];
    if (spec.tipo === 'pie' || spec.tipo === 'doughnut') return desenharCircular(ctx, spec, { largura, altura, tema, cor, estado });
    if (spec.tipo === 'scatter') return desenharDispersao(ctx, spec, { largura, altura, tema, cor, estado });
    return desenharEixos(ctx, spec, { largura, altura, tema, cor, estado });
  }

  function titulo(ctx, spec, tema, x) {
    if (!spec.titulo) return;
    ctx.fillStyle = tema.forte;
    ctx.font = '600 12.5px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(spec.titulo, x, 14);
    ctx.font = '11px system-ui, sans-serif';
  }

  function desenharEixos(ctx, spec, { largura, altura, tema, cor, estado }) {
    const horizontal = spec.tipo === 'horizontalBar';
    const visiveis = spec.series.map((s, i) => ({ s, i })).filter(({ i }) => !estado.ocultas.has(i));
    const n = spec.rotulos.length;
    const barrasVis = visiveis.filter(({ s }) => s.tipo === 'bar');
    const temBarra = spec.series.some((s) => s.tipo === 'bar');

    // a escala: com empilhamento, a soma das barras de cada categoria; faixas de incerteza entram
    let numeros = visiveis.flatMap(({ s }) => [...s.valores, ...(s.baixo || []), ...(s.alto || [])]).filter((v) => v !== null);
    if (spec.empilhado && barrasVis.length) {
      for (let j = 0; j < n; j += 1) {
        numeros.push(barrasVis.reduce((t, { s }) => t + Math.max(0, s.valores[j] || 0), 0));
        numeros.push(barrasVis.reduce((t, { s }) => t + Math.min(0, s.valores[j] || 0), 0));
      }
    }
    if (!numeros.length) numeros = [0, 1];
    let menor = Math.min(...numeros);
    const maior = Math.max(...numeros);
    // barra começa no zero; linha só inclui o zero se ele estiver perto (preço de 9 a 11 mil não achata)
    if (temBarra || menor < 0 || menor <= maior * 0.25) menor = Math.min(0, menor);
    const { min, max, passo } = escala(menor, maior);

    ctx.font = '11px system-ui, sans-serif';
    const larguraDoEixo = Math.max(...[min, max].map((v) => ctx.measureText(noEixo(v, spec.unidade)).width)) + 14;
    const esquerda = horizontal ? Math.min(150, largura * 0.34) : Math.max(44, larguraDoEixo);
    const topo = spec.titulo ? 30 : 12;
    const baixo = 30;
    const direita = 14;
    const areaL = Math.max(10, largura - esquerda - direita);
    const areaA = Math.max(10, altura - topo - baixo);
    titulo(ctx, spec, tema, horizontal ? 12 : esquerda);
    const posicao = (v) => (v - min) / (max - min || 1);
    const yDe = (v) => topo + areaA - posicao(v) * areaA;
    const xDeValor = (v) => esquerda + posicao(v) * areaL;

    // grade e eixo de valores
    ctx.strokeStyle = tema.grade;
    ctx.fillStyle = tema.fraco;
    ctx.lineWidth = 1;
    for (let v = min; v <= max + passo / 2; v += passo) {
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(xDeValor(v), topo);
        ctx.lineTo(xDeValor(v), topo + areaA);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(noEixo(v, spec.unidade), xDeValor(v), topo + areaA + 14);
      } else {
        ctx.moveTo(esquerda, yDe(v));
        ctx.lineTo(esquerda + areaL, yDe(v));
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(noEixo(v, spec.unidade), esquerda - 8, yDe(v));
      }
    }

    const faixa = (horizontal ? areaA : areaL) / n;
    // com barra no gráfico, as categorias ficam no meio das faixas; só com linha, de borda a borda
    const xDaCategoria = (j) => (temBarra ? esquerda + faixa * (j + 0.5) : esquerda + (n === 1 ? areaL / 2 : (j / (n - 1)) * areaL));
    const yDaCategoria = (j) => topo + faixa * (j + 0.5);

    // destaque da categoria em foco (atrás de tudo)
    if (estado.foco !== null && estado.foco < n) {
      ctx.fillStyle = tema.destaque;
      if (horizontal) ctx.fillRect(esquerda, topo + faixa * estado.foco, areaL, faixa);
      else if (temBarra) ctx.fillRect(esquerda + faixa * estado.foco, topo, faixa, areaA);
    }

    // rótulos das categorias, pulando quando não couberem
    ctx.fillStyle = tema.fraco;
    const salto = horizontal ? Math.ceil((n * 14) / areaA) : Math.ceil((n * 56) / areaL);
    spec.rotulos.forEach((rotulo, j) => {
      if (j % salto) return;
      if (horizontal) {
        ctx.textAlign = 'right';
        ctx.fillText(rotulo.slice(0, 24), esquerda - 8, yDaCategoria(j));
      } else {
        // o rótulo não sai da caixa (18/10, no app: "Ago 20…" cortado na borda direita)
        const texto = rotulo.slice(0, 14);
        const meia = ctx.measureText(texto).width / 2;
        ctx.textAlign = 'center';
        ctx.fillText(texto, Math.max(meia + 2, Math.min(largura - meia - 2, xDaCategoria(j))), topo + areaA + 14);
      }
    });

    // barras: lado a lado, ou empilhadas
    const grupos = spec.empilhado ? 1 : Math.max(1, barrasVis.length);
    const base = Array(n).fill(0);
    const baseNeg = Array(n).fill(0);
    barrasVis.forEach(({ s, i }, k) => {
      const c = cor(i, s);
      const grupo = faixa / grupos;
      const espessura = Math.max(2, grupo * (spec.empilhado ? 0.62 : 0.74));
      s.valores.forEach((v, j) => {
        if (v === null) return;
        const desde = spec.empilhado ? (v >= 0 ? base[j] : baseNeg[j]) : 0;
        const ate = desde + v;
        if (spec.empilhado) {
          if (v >= 0) base[j] = ate;
          else baseNeg[j] = ate;
        }
        const desfocada = estado.foco !== null && estado.foco !== j;
        ctx.globalAlpha = desfocada ? 0.55 : 1;
        ctx.fillStyle = s.estimados[j] ? hachura(ctx, c) : c;
        const desloc = spec.empilhado ? (faixa - espessura) / 2 : grupo * k + (grupo - espessura) / 2;
        if (horizontal) {
          const x0 = xDeValor(Math.min(desde, ate));
          ctx.fillRect(x0, topo + faixa * j + desloc, Math.max(1, Math.abs(xDeValor(ate) - xDeValor(desde))), espessura);
        } else {
          const y0 = yDe(Math.max(desde, ate));
          ctx.fillRect(esquerda + faixa * j + desloc, y0, espessura, Math.max(1, Math.abs(yDe(desde) - yDe(ate))));
        }
        if (s.estimados[j]) {
          ctx.strokeStyle = c;
          ctx.setLineDash([3, 2]);
          ctx.lineWidth = 1;
          if (horizontal) ctx.strokeRect(xDeValor(Math.min(desde, ate)), topo + faixa * j + desloc, Math.abs(xDeValor(ate) - xDeValor(desde)), espessura);
          else ctx.strokeRect(esquerda + faixa * j + desloc, yDe(Math.max(desde, ate)), espessura, Math.abs(yDe(desde) - yDe(ate)));
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
      });
    });

    // linhas e áreas (por cima das barras)
    if (!horizontal) {
      visiveis.filter(({ s }) => s.tipo !== 'bar').forEach(({ s, i }) => {
        const c = cor(i, s);
        const pontos = s.valores.map((v, j) => (v === null ? null : { x: xDaCategoria(j), y: yDe(v), j, estimado: s.estimados[j] }));
        const validos = pontos.filter(Boolean);
        if (!validos.length) return;
        // faixa de incerteza (projeção): sombra entre low e high
        if (s.baixo && s.alto) {
          const faixaPts = s.valores.map((_, j) => (s.baixo[j] !== null && s.alto[j] !== null ? j : null)).filter((j) => j !== null);
          if (faixaPts.length >= 2) {
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = c;
            ctx.beginPath();
            faixaPts.forEach((j, k) => (k ? ctx.lineTo(xDaCategoria(j), yDe(s.alto[j])) : ctx.moveTo(xDaCategoria(j), yDe(s.alto[j]))));
            [...faixaPts].reverse().forEach((j) => ctx.lineTo(xDaCategoria(j), yDe(s.baixo[j])));
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        // área: sombra em degradê até a base
        if (s.tipo === 'area') {
          const degrade = ctx.createLinearGradient(0, topo, 0, topo + areaA);
          degrade.addColorStop(0, `${c}55`);
          degrade.addColorStop(1, `${c}05`);
          ctx.fillStyle = degrade;
          ctx.beginPath();
          ctx.moveTo(validos[0].x, yDe(Math.max(min, 0)));
          validos.forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.lineTo(validos[validos.length - 1].x, yDe(Math.max(min, 0)));
          ctx.closePath();
          ctx.fill();
        }
        // a linha, trecho a trecho: tracejada quando um dos pontos é estimado
        ctx.strokeStyle = c;
        ctx.lineWidth = 2.2;
        for (let k = 1; k < validos.length; k += 1) {
          const a = validos[k - 1];
          const b = validos[k];
          ctx.setLineDash(a.estimado || b.estimado ? [6, 4] : []);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // pontos: cheios; estimados, vazados; o da categoria em foco, maior
        validos.forEach((p) => {
          const emFoco = estado.foco === p.j;
          if (!s.pontos && !emFoco) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, emFoco ? 5 : 3.2, 0, Math.PI * 2);
          if (p.estimado) {
            ctx.fillStyle = tema.fundo;
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.stroke();
          } else {
            ctx.fillStyle = c;
            ctx.fill();
          }
        });
      });
      // linha-guia da categoria em foco, só com linhas
      if (estado.foco !== null && !temBarra) {
        ctx.strokeStyle = tema.fraco;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xDaCategoria(estado.foco), topo);
        ctx.lineTo(xDaCategoria(estado.foco), topo + areaA);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    return {
      categoria: (x, y) => {
        if (x < esquerda - 4 || x > esquerda + areaL + 4 || y < topo - 4 || y > topo + areaA + 20) return null;
        if (horizontal) return Math.max(0, Math.min(n - 1, Math.floor((y - topo) / faixa)));
        if (temBarra) return Math.max(0, Math.min(n - 1, Math.floor((x - esquerda) / faixa)));
        return Math.max(0, Math.min(n - 1, Math.round(((x - esquerda) / areaL) * (n - 1))));
      },
      ancora: (j) => (horizontal ? { x: esquerda + areaL * 0.6, y: yDaCategoria(j) } : { x: xDaCategoria(j), y: topo + 10 }),
    };
  }

  function desenharDispersao(ctx, spec, { largura, altura, tema, cor, estado }) {
    const visiveis = spec.series.map((s, i) => ({ s, i })).filter(({ i }) => !estado.ocultas.has(i));
    const xs = visiveis.flatMap(({ s }) => s.pares.map((p) => p[0]));
    const ys = visiveis.flatMap(({ s }) => s.pares.map((p) => p[1]));
    const ex = escala(Math.min(...(xs.length ? xs : [0])), Math.max(...(xs.length ? xs : [1])));
    const ey = escala(Math.min(...(ys.length ? ys : [0])), Math.max(...(ys.length ? ys : [1])));
    const esquerda = 54;
    const topo = spec.titulo ? 30 : 12;
    const baixo = spec.eixoX ? 42 : 30;
    const areaL = largura - esquerda - 14;
    const areaA = altura - topo - baixo;
    titulo(ctx, spec, tema, esquerda);
    const X = (v) => esquerda + ((v - ex.min) / (ex.max - ex.min || 1)) * areaL;
    const Y = (v) => topo + areaA - ((v - ey.min) / (ey.max - ey.min || 1)) * areaA;
    ctx.strokeStyle = tema.grade;
    ctx.fillStyle = tema.fraco;
    for (let v = ey.min; v <= ey.max + ey.passo / 2; v += ey.passo) {
      ctx.beginPath();
      ctx.moveTo(esquerda, Y(v));
      ctx.lineTo(esquerda + areaL, Y(v));
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(noEixo(v, spec.unidade), esquerda - 8, Y(v));
    }
    for (let v = ex.min; v <= ex.max + ex.passo / 2; v += ex.passo) {
      ctx.textAlign = 'center';
      ctx.fillText(compacto(v), X(v), topo + areaA + 14);
    }
    if (spec.eixoX) ctx.fillText(spec.eixoX, esquerda + areaL / 2, topo + areaA + 30);
    const todos = [];
    visiveis.forEach(({ s, i }) => {
      const c = cor(i, s);
      s.pares.forEach(([x, y], k) => {
        const emFoco = estado.ponto && estado.ponto.serie === i && estado.ponto.k === k;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(X(x), Y(y), emFoco ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        todos.push({ px: X(x), py: Y(y), serie: i, k, x, y });
      });
    });
    return {
      ponto: (mx, my) => {
        let melhor = null;
        for (const p of todos) {
          const d = Math.hypot(p.px - mx, p.py - my);
          if (d < 14 && (!melhor || d < melhor.d)) melhor = { ...p, d };
        }
        return melhor;
      },
    };
  }

  function desenharCircular(ctx, spec, { largura, altura, tema, cor, estado }) {
    const serie = spec.series[0];
    const valores = serie.valores.map((v, i) => (estado.ocultas.has(i) ? 0 : Math.max(0, v || 0)));
    const soma = valores.reduce((a, b) => a + b, 0) || 1;
    const cx = largura / 2;
    const cy = altura / 2 + (spec.titulo ? 10 : 0);
    const raio = Math.min(largura * 0.42, altura * 0.4);
    const interno = spec.tipo === 'doughnut' ? raio * 0.56 : 0;
    titulo(ctx, spec, tema, 12);
    let angulo = -Math.PI / 2;
    const fatias = [];
    valores.forEach((valor, i) => {
      const fatia = (valor / soma) * Math.PI * 2;
      if (!fatia) return;
      const emFoco = estado.foco === i;
      const meio = angulo + fatia / 2;
      const dx = emFoco ? Math.cos(meio) * 6 : 0;
      const dy = emFoco ? Math.sin(meio) * 6 : 0;
      ctx.fillStyle = serie.estimados[i] ? hachura(ctx, cor(i, { cor: null })) : CORES[i % CORES.length];
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy + dy);
      ctx.arc(cx + dx, cy + dy, raio, angulo, angulo + fatia);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = tema.fundo;
      ctx.lineWidth = 2;
      ctx.stroke();
      fatias.push({ i, de: angulo, ate: angulo + fatia });
      angulo += fatia;
    });
    if (interno) {
      ctx.fillStyle = tema.fundo;
      ctx.beginPath();
      ctx.arc(cx, cy, interno, 0, Math.PI * 2);
      ctx.fill();
      // o total no meio da rosca
      ctx.fillStyle = tema.forte;
      ctx.textAlign = 'center';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(compacto(soma), cx, cy);
      ctx.font = '11px system-ui, sans-serif';
    }
    return {
      fatia: (x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        if (d > raio + 8 || d < interno) return null;
        let a = Math.atan2(y - cy, x - cx);
        if (a < -Math.PI / 2) a += Math.PI * 2;
        const f = fatias.find((q) => a >= q.de && a < q.ate);
        return f ? f.i : null;
      },
      soma,
    };
  }

  /* ------------------------------ elemento e interação ------------------------------ */

  function dicaDe(spec, estado, geo) {
    const linhas = [];
    if (spec.tipo === 'scatter') {
      const p = estado.ponto;
      if (!p) return null;
      return `<b>${escapar(spec.series[p.serie].nome)}</b><br>${escapar(spec.eixoX || 'x')}: ${escapar(exato(p.x, ''))}<br>${escapar(spec.eixoY || 'y')}: ${escapar(exato(p.y, spec.unidade))}`;
    }
    const j = estado.foco;
    if (j === null || j === undefined) return null;
    if (spec.tipo === 'pie' || spec.tipo === 'doughnut') {
      const s = spec.series[0];
      const v = s.valores[j] || 0;
      // unidade já em % (40% Chrome): a parte do total repetiria o número ("35% — 35%")
      const parte = String(spec.unidade || '').trim() === '%' ? '' : ` — ${((v / (geo.soma || 1)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
      return `<b>${escapar(spec.rotulos[j])}</b><br>${escapar(exato(v, spec.unidade))}${parte}${s.estimados[j] ? '<br><i>estimativa</i>' : ''}`;
    }
    linhas.push(`<b>${escapar(spec.rotulos[j])}</b>`);
    spec.series.forEach((s, i) => {
      if (estado.ocultas.has(i) || s.valores[j] === null) return;
      const cor = s.cor || CORES[i % CORES.length];
      const faixa = s.baixo && s.alto && s.baixo[j] !== null && s.alto[j] !== null ? ` <span class="fraco">(${escapar(exato(s.baixo[j], s.unidade || spec.unidade))} a ${escapar(exato(s.alto[j], s.unidade || spec.unidade))})</span>` : '';
      linhas.push(`<span class="marca" style="background:${cor}"></span>${escapar(s.nome || 'valor')}: <b>${escapar(exato(s.valores[j], s.unidade || spec.unidade))}</b>${faixa}${s.estimados[j] ? ' <i>estimativa</i>' : ''}`);
    });
    if (spec.empilhado && spec.series.filter((s, i) => s.tipo === 'bar' && !estado.ocultas.has(i)).length > 1) {
      const total = spec.series.reduce((t, s, i) => t + (s.tipo === 'bar' && !estado.ocultas.has(i) ? s.valores[j] || 0 : 0), 0);
      linhas.push(`total: <b>${escapar(exato(total, spec.unidade))}</b>`);
    }
    return linhas.join('<br>');
  }

  const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** Cria o elemento a partir do bloco ```chart. */
  function criar(bruto) {
    const r = validar(bruto);
    const caixa = document.createElement('div');
    if (!r.ok) {
      caixa.className = 'grafico-erro';
      caixa.textContent = `não foi possível desenhar o gráfico: ${r.erro}`;
      return caixa;
    }
    const spec = r.spec;
    const circular = spec.tipo === 'pie' || spec.tipo === 'doughnut';
    caixa.className = 'grafico';
    const estado = { ocultas: new Set(), foco: null, ponto: null };
    // o título é texto da página (acima da legenda), não pixel do canvas
    if (spec.titulo) {
      const t = document.createElement('div');
      t.className = 'grafico-titulo';
      t.textContent = spec.titulo;
      caixa.appendChild(t);
    }
    const desenho = { ...spec, titulo: '' };

    // legenda clicável: série (ou fatia, na pizza) some e volta
    const itens = circular ? spec.rotulos.map((nome, i) => ({ nome, cor: CORES[i % CORES.length] })) : spec.series.map((s, i) => ({ nome: s.nome || `série ${i + 1}`, cor: s.cor || CORES[i % CORES.length] }));
    const temEstimativa = spec.series.some((s) => s.estimados && s.estimados.some(Boolean));
    if (itens.length >= 2 || circular) {
      const legenda = document.createElement('div');
      legenda.className = 'grafico-legenda';
      itens.forEach((item, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<span class="marca" style="background:${item.cor}"></span>${escapar(item.nome)}`;
        b.title = 'clique para esconder ou mostrar';
        b.addEventListener('click', () => {
          if (estado.ocultas.has(i)) estado.ocultas.delete(i);
          else if (estado.ocultas.size < itens.length - 1) estado.ocultas.add(i); // sempre sobra uma
          b.classList.toggle('apagado', estado.ocultas.has(i));
          pintar();
        });
        legenda.appendChild(b);
      });
      caixa.appendChild(legenda);
    }
    const canvas = document.createElement('canvas');
    canvas.dataset.altura = circular ? 260 : 300;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', spec.titulo || 'gráfico');
    caixa.appendChild(canvas);
    const dica = document.createElement('div');
    dica.className = 'grafico-dica';
    dica.hidden = true;
    caixa.appendChild(dica);
    if (temEstimativa) {
      const nota = document.createElement('div');
      nota.className = 'grafico-nota';
      nota.textContent = 'tracejado, vazado ou hachurado = estimativa (não está nas fontes)';
      caixa.appendChild(nota);
    }

    let geo = null;
    const tema = () => {
      const e = getComputedStyle(document.body);
      return {
        texto: e.getPropertyValue('--text') || '#ddd',
        forte: e.getPropertyValue('--text-forte') || '#fff',
        fraco: e.getPropertyValue('--fraco') || '#888',
        grade: e.getPropertyValue('--line') || '#2a2a2e',
        fundo: e.getPropertyValue('--panel') || '#1a1a1e',
        destaque: 'rgba(255,255,255,0.05)',
      };
    };
    const pintar = () => {
      geo = desenhar(canvas, desenho, tema(), estado);
    };

    const mover = (ev) => {
      if (!geo) return;
      const ret = canvas.getBoundingClientRect();
      const x = ev.clientX - ret.left;
      const y = ev.clientY - ret.top;
      let mudou = false;
      if (spec.tipo === 'scatter') {
        const p = geo.ponto(x, y);
        mudou = JSON.stringify(p && [p.serie, p.k]) !== JSON.stringify(estado.ponto && [estado.ponto.serie, estado.ponto.k]);
        estado.ponto = p;
      } else {
        const j = circular ? geo.fatia(x, y) : geo.categoria(x, y);
        mudou = j !== estado.foco;
        estado.foco = j;
      }
      if (mudou) pintar();
      const html = dicaDe(spec, estado, geo);
      if (!html) {
        dica.hidden = true;
        return;
      }
      dica.innerHTML = html;
      dica.hidden = false;
      // a dica acompanha o mouse, sem sair da caixa
      const caixaRet = caixa.getBoundingClientRect();
      const larg = dica.offsetWidth;
      let left = ev.clientX - caixaRet.left + 14;
      if (left + larg > caixaRet.width - 6) left = ev.clientX - caixaRet.left - larg - 14;
      dica.style.left = `${Math.max(4, left)}px`;
      dica.style.top = `${Math.max(4, ev.clientY - caixaRet.top - dica.offsetHeight - 10)}px`;
    };
    const sair = () => {
      estado.foco = null;
      estado.ponto = null;
      dica.hidden = true;
      pintar();
    };
    canvas.addEventListener('pointermove', mover);
    canvas.addEventListener('pointerdown', mover); // toque
    canvas.addEventListener('pointerleave', sair);

    requestAnimationFrame(pintar);
    if (global.ResizeObserver) new ResizeObserver(() => pintar()).observe(caixa);
    return caixa;
  }

  global.grafico = { validar, criar, TIPOS, formatar: exato };
})(window);
