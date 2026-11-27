/* Visualizador de peças 3D no chat (27/11, Davi: "faz o visualizador 3d logo"): lê o STL que o app serve
 * (augpt-img://…stl), desenha em WebGL com luz e a mesa de impressão embaixo; arrastar gira, a roda aproxima,
 * clique duplo volta ao começo. Sem biblioteca: a peça é um STL simples, e o three.js seria 600 KB para isso.
 * Sem WebGL (ou o arquivo não abre), fica a foto que veio junto.
 *
 * Editar pela face (27/11, Davi: "selecionar um lado da peça, clicar com o botão direito e ter a opção 'editar'… pense no
 * que poderíamos fazer a mais"): o clique direito acha a face sob o mouse (o raio contra os triângulos), junta a face
 * inteira (plana: os triângulos vizinhos no mesmo plano; curva: os vizinhos que viram pouco — a lateral do cilindro) e
 * destaca. O menu: editar esta face (o pedido vai para o chat com o lugar exato, em mm), furo aqui, medir a face, medir a
 * distância entre dois pontos, olhar de frente para a face e salvar o STL. As coordenadas são as da peça (as do OpenSCAD),
 * então o modelo sabe exatamente onde mexer. */
(function (global) {
  'use strict';

  const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

  function lerStl(buf) {
    const dv = new DataView(buf);
    const pontos = [];
    if (/^solid/.test(new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512)))) && /facet/.test(new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096))))) {
      const t = new TextDecoder().decode(buf);
      const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
      let m;
      while ((m = re.exec(t))) pontos.push(+m[1], +m[2], +m[3]);
    } else {
      const n = dv.getUint32(80, true);
      for (let i = 0; i < n && 84 + i * 50 + 50 <= buf.byteLength; i += 1) for (let v = 0; v < 3; v += 1) {
        const o = 84 + i * 50 + 12 + v * 12;
        pontos.push(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
      }
    }
    const pos = new Float32Array(pontos);
    const nor = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k += 1) nor.set([nx, ny, nz], i + k * 3);
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
    return { pos, nor, min, max };
  }

  /* ---------- geometria: raio × triângulos e a face inteira ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const pto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const vert = (pos, t, k) => [pos[t * 9 + k * 3], pos[t * 9 + k * 3 + 1], pos[t * 9 + k * 3 + 2]];

  /** O triângulo mais perto que o raio acerta (Möller–Trumbore): { tri, ponto } ou null. */
  function acertar(peca, origem, dir) {
    let melhor = null;
    const n = peca.pos.length / 9;
    for (let t = 0; t < n; t += 1) {
      const a = vert(peca.pos, t, 0), e1 = sub(vert(peca.pos, t, 1), a), e2 = sub(vert(peca.pos, t, 2), a);
      const p = cruz(dir, e2), det = pto(e1, p);
      if (Math.abs(det) < 1e-9) continue;
      const s = sub(origem, a), u = pto(s, p) / det;
      if (u < 0 || u > 1) continue;
      const q = cruz(s, e1), v = pto(dir, q) / det;
      if (v < 0 || u + v > 1) continue;
      const d = pto(e2, q) / det;
      if (d > 1e-6 && (!melhor || d < melhor.d)) melhor = { tri: t, d };
    }
    return melhor ? { tri: melhor.tri, ponto: origem.map((o, k) => o + dir[k] * melhor.d) } : null;
  }

  /** A face inteira a partir de um triângulo: vizinhos (vértice em comum) que viram menos de 20° um do outro. */
  function faceDe(peca, inicio) {
    if (!peca.vizinhos) {
      const porVertice = new Map();
      const chave = (v) => v.map((x) => Math.round(x * 1000)).join(',');
      const n = peca.pos.length / 9;
      for (let t = 0; t < n; t += 1) for (let k = 0; k < 3; k += 1) {
        const c = chave(vert(peca.pos, t, k));
        if (!porVertice.has(c)) porVertice.set(c, []);
        porVertice.get(c).push(t);
      }
      peca.vizinhos = (t) => [...new Set([0, 1, 2].flatMap((k) => porVertice.get(chave(vert(peca.pos, t, k))) || []))];
    }
    const normal = (t) => [peca.nor[t * 9], peca.nor[t * 9 + 1], peca.nor[t * 9 + 2]];
    const limite = Math.cos((20 * Math.PI) / 180);
    const plana = Math.cos((1 * Math.PI) / 180);
    const semente = normal(inicio);
    const vistos = new Set([inicio]);
    const fila = [inicio];
    let todosPlanos = true;
    while (fila.length && vistos.size < 20000) {
      const t = fila.shift();
      for (const v of peca.vizinhos(t)) {
        if (vistos.has(v)) continue;
        if (pto(normal(v), normal(t)) < limite) continue;
        vistos.add(v);
        fila.push(v);
        if (pto(normal(v), semente) < plana) todosPlanos = false;
      }
    }
    const tris = [...vistos];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let area = 0;
    let media = [0, 0, 0];
    for (const t of tris) {
      const a = vert(peca.pos, t, 0), b = vert(peca.pos, t, 1), c = vert(peca.pos, t, 2);
      const ar = Math.hypot(...cruz(sub(b, a), sub(c, a))) / 2;
      area += ar;
      media = media.map((m, k) => m + normal(t)[k] * ar);
      for (const p of [a, b, c]) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
    return { tris, min, max, area, normal: norm(media), plana: todosPlanos };
  }

  // x = largura (esquerda → direita), y = profundidade (frente → trás), z = altura, como a peça fica na mesa
  function nomeDaFace(n) {
    const nomes = [['a face da direita', 'a face da esquerda'], ['a face de trás', 'a face da frente'], ['a face de cima', 'a face de baixo (a que fica na mesa)']];
    const k = [0, 1, 2].reduce((m, i) => (Math.abs(n[i]) > Math.abs(n[m]) ? i : m), 0);
    return Math.abs(n[k]) > 0.9 ? nomes[k][n[k] > 0 ? 0 : 1] : null;
  }

  function descreverFace(face, ponto) {
    const eixos = ['x', 'y', 'z'];
    const k = [0, 1, 2].reduce((m, i) => (Math.abs(face.normal[i]) > Math.abs(face.normal[m]) ? i : m), 0);
    const nome = nomeDaFace(face.normal) || (face.plana ? 'a face inclinada' : 'a superfície curva');
    const outros = [0, 1, 2].filter((i) => !(face.plana && i === k && Math.abs(face.normal[k]) > 0.99));
    const faixa = outros.map((i) => `${eixos[i]} de ${fmt(face.min[i])} a ${fmt(face.max[i])}`).join(', ');
    const plano = face.plana && Math.abs(face.normal[k]) > 0.99 ? `no plano ${eixos[k]} = ${fmt(ponto[k])} mm; ` : '';
    const direcao = `virada para ${face.normal.map((v) => fmt(v)).join(', ')} (x, y, z)`;
    return {
      nome,
      texto: `${nome} (${plano}a face ocupa ${faixa} mm; ${direcao}; ponto clicado: x ${fmt(ponto[0])}, y ${fmt(ponto[1])}, z ${fmt(ponto[2])} mm)`,
    };
  }

  /* ---------- matrizes 4×4 (coluna a coluna, como o WebGL espera) ---------- */
  const perspectiva = (fov, asp, perto, longe) => {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (perto - longe);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (longe + perto) * nf, -1, 0, 0, 2 * longe * perto * nf, 0];
  };
  function olhar(olho, alvo, cima) {
    const z = norm(sub(olho, alvo)), x = norm(cruz(cima, z)), y = cruz(z, x);
    const d = (a) => -pto(a, olho);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1];
  }
  const vezes = (a, b) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1) for (let l = 0; l < 4; l += 1) for (let k = 0; k < 4; k += 1) r[c * 4 + l] += a[k * 4 + l] * b[c * 4 + k];
    return r;
  };

  const VERT = 'attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ vn = n; gl_Position = m * vec4(p, 1.0); }';
  const FRAG = 'precision mediump float; varying vec3 vn; uniform vec3 cor; uniform float luz; void main(){ vec3 n = normalize(vn); float d = max(dot(n, normalize(vec3(0.4, -0.6, 0.8))), 0.0) * 0.65 + max(dot(n, normalize(vec3(-0.6, 0.5, 0.3))), 0.0) * 0.25; gl_FragColor = vec4(cor * (luz + d), 1.0); }';
  const FOV = 0.75;

  function montar(figura) {
    const url = figura.dataset.stl;
    if (!url || figura.dataset.montado) return;
    figura.dataset.montado = '1';
    const canvas = document.createElement('canvas');
    canvas.className = 'peca3d-tela';
    canvas.setAttribute('aria-label', 'Peça 3D: arraste para girar, role para aproximar, botão direito numa face para editar');
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return; // fica a foto
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        const peca = lerStl(buf);
        if (!peca.pos.length) return;
        const palco = Object.assign(document.createElement('div'), { className: 'peca3d-palco' });
        const info = Object.assign(document.createElement('div'), { className: 'peca3d-info', hidden: true });
        const dica = Object.assign(document.createElement('div'), { className: 'peca3d-dica', textContent: 'arraste para girar · role para aproximar · botão direito numa face: editar, furar, medir' });
        palco.append(canvas, info);
        const img = figura.querySelector('img');
        if (img) img.hidden = true;
        figura.prepend(palco, dica);
        desenhar(gl, canvas, peca, { figura, palco, info });
      })
      .catch(() => { /* fica a foto */ });
  }

  function desenhar(gl, canvas, peca, { figura, palco, info }) {
    const prog = gl.createProgram();
    for (const [tipo, fonte] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, fonte);
      gl.compileShader(s);
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buffer = (dados, nome) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, dados, gl.STATIC_DRAW);
      return { b, loc: gl.getAttribLocation(prog, nome) };
    };
    const centro = [0, 1, 2].map((k) => (peca.min[k] + peca.max[k]) / 2);
    const raio = Math.max(1, Math.hypot(...[0, 1, 2].map((k) => peca.max[k] - peca.min[k])) / 2);
    const folga = raio * 1.3, zm = peca.min[2] - 0.05;
    const mesa = new Float32Array([centro[0] - folga, centro[1] - folga, zm, centro[0] + folga, centro[1] - folga, zm, centro[0] + folga, centro[1] + folga, zm, centro[0] - folga, centro[1] - folga, zm, centro[0] + folga, centro[1] + folga, zm, centro[0] - folga, centro[1] + folga, zm]);
    const mesaN = new Float32Array(18).map((_, i) => (i % 3 === 2 ? 1 : 0));
    const vp = buffer(peca.pos, 'p'), vn = buffer(peca.nor, 'n'), mp = buffer(mesa, 'p'), mn = buffer(mesaN, 'n');
    let destaque = null; // { p, n, qtd } da face escolhida
    let marcas = null; // os pontos da medida de distância (pequenos quadrados)
    let pontosMarcados = [];
    const uM = gl.getUniformLocation(prog, 'm'), uCor = gl.getUniformLocation(prog, 'cor'), uLuz = gl.getUniformLocation(prog, 'luz');
    const corDaPeca = (() => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim();
      const m = /^#([0-9a-f]{6})$/i.exec(v);
      return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0.85, 0.62, 0.25];
    })();
    const inicial = { giro: -0.9, inclina: 0.55, dist: raio * 2.6 };
    const cam = { ...inicial };
    gl.enable(gl.DEPTH_TEST);
    const olhoAgora = () => [centro[0] + cam.dist * Math.cos(cam.inclina) * Math.cos(cam.giro), centro[1] + cam.dist * Math.cos(cam.inclina) * Math.sin(cam.giro), centro[2] + cam.dist * Math.sin(cam.inclina)];
    let pedido = 0;
    function quadro() {
      pedido = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const m = vezes(perspectiva(FOV, w / h, raio * 0.05, raio * 20), olhar(olhoAgora(), centro, [0, 0, 1]));
      gl.uniformMatrix4fv(uM, false, new Float32Array(m));
      const pintar = (p, n, cor, luz, qtd) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, p.b);
        gl.enableVertexAttribArray(p.loc);
        gl.vertexAttribPointer(p.loc, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, n.b);
        gl.enableVertexAttribArray(n.loc);
        gl.vertexAttribPointer(n.loc, 3, gl.FLOAT, false, 0, 0);
        gl.uniform3fv(uCor, cor);
        gl.uniform1f(uLuz, luz);
        gl.drawArrays(gl.TRIANGLES, 0, qtd);
      };
      pintar(mp, mn, [0.5, 0.5, 0.52], 0.35, 6);
      pintar(vp, vn, corDaPeca, 0.35, peca.pos.length / 3);
      // a face escolhida por cima, em azul claro (polygonOffset: sem brigar com a peça)
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -2);
      if (destaque) pintar(destaque.p, destaque.n, [0.35, 0.75, 1], 0.55, destaque.qtd);
      if (marcas) pintar(marcas.p, marcas.n, [1, 0.3, 0.3], 0.9, marcas.qtd);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    const redesenhar = () => { if (!pedido) pedido = requestAnimationFrame(quadro); };

    // o raio que sai da câmera pelo ponto do mouse (as mesmas contas da câmera de cima)
    function raioDo(e) {
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((e.clientY - r.top) / r.height) * 2;
      const olho = olhoAgora();
      const f = norm(sub(centro, olho)), dir = norm(cruz(f, [0, 0, 1])), cima = cruz(dir, f);
      const t = Math.tan(FOV / 2), asp = r.width / r.height;
      return { origem: olho, dir: norm([0, 1, 2].map((k) => f[k] + dir[k] * nx * t * asp + cima[k] * ny * t)) };
    }
    function destacar(face) {
      if (!face) { destaque = null; redesenhar(); return; }
      const p = new Float32Array(face.tris.length * 9), n = new Float32Array(face.tris.length * 9);
      face.tris.forEach((t, i) => { p.set(peca.pos.subarray(t * 9, t * 9 + 9), i * 9); n.set(peca.nor.subarray(t * 9, t * 9 + 9), i * 9); });
      destaque = { p: buffer(p, 'p'), n: buffer(n, 'n'), qtd: face.tris.length * 3 };
      redesenhar();
    }
    function marcar(pontos) {
      pontosMarcados = pontos;
      if (!pontos.length) { marcas = null; redesenhar(); return; }
      const s = raio * 0.025, p = [], n = [];
      for (const c of pontos) for (const [dx, dy] of [[-s, -s], [s, -s], [s, s], [-s, -s], [s, s], [-s, s]]) {
        // um quadradinho virado para a câmera, no ponto
        const olho = olhoAgora(), f = norm(sub(c, olho)), r = norm(cruz(f, [0, 0, 1])), u = cruz(r, f);
        p.push(...[0, 1, 2].map((k) => c[k] + r[k] * dx + u[k] * dy - f[k] * s));
        n.push(...f.map((x) => -x));
      }
      marcas = { p: buffer(new Float32Array(p), 'p'), n: buffer(new Float32Array(n), 'n'), qtd: p.length / 3 };
      redesenhar();
    }
    const mostrar = (html) => { info.innerHTML = html; info.hidden = !html; };

    /* ---------- o menu do botão direito ---------- */
    let menu = null;
    const fecharMenu = () => { menu?.remove(); menu = null; };
    function abrirMenu(e, alvo) {
      fecharMenu();
      const face = faceDe(peca, alvo.tri);
      destacar(face);
      const desc = descreverFace(face, alvo.ponto);
      menu = Object.assign(document.createElement('div'), { className: 'peca3d-menu' });
      menu.setAttribute('role', 'menu');
      const r = palco.getBoundingClientRect();
      menu.style.left = `${Math.min(e.clientX - r.left, r.width - 250)}px`;
      menu.style.top = `${Math.min(e.clientY - r.top, r.height - 40)}px`;
      const titulo = Object.assign(document.createElement('div'), { className: 'peca3d-menu-titulo', textContent: desc.nome.replace(/^a /, '').replace(/^./, (c) => c.toUpperCase()) });
      menu.append(titulo);
      const item = (rotulo, acao) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'peca3d-menu-item', textContent: rotulo });
        b.setAttribute('role', 'menuitem');
        b.addEventListener('click', (ev) => { ev.stopPropagation(); acao(); });
        menu.append(b);
      };
      // um campo curto dentro do menu; Enter (ou o botão) manda para o chat
      const perguntar = (rotulo, exemplo, montar) => {
        menu.querySelectorAll('.peca3d-menu-item').forEach((b) => b.remove());
        const campo = Object.assign(document.createElement('textarea'), { className: 'peca3d-menu-campo', placeholder: exemplo, rows: 2 });
        campo.setAttribute('aria-label', rotulo);
        const enviar = Object.assign(document.createElement('button'), { type: 'button', className: 'btn-primario peca3d-menu-enviar', textContent: 'Enviar' });
        const mandar = () => {
          const t = campo.value.trim();
          if (!t) return;
          fecharMenu();
          destacar(null);
          global.peca3dPedir?.(montar(t));
        };
        enviar.addEventListener('click', mandar);
        campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); mandar(); } if (ev.key === 'Escape') fecharMenu(); });
        menu.append(Object.assign(document.createElement('div'), { className: 'peca3d-menu-rotulo', textContent: rotulo }), campo, enviar);
        campo.focus();
      };
      if (typeof global.peca3dPedir === 'function') {
        item('Editar esta face…', () => perguntar('O que mudar nesta face?', 'ex.: adicione uma fresta de 2 mm no meio; arredonde os cantos; faça um rebaixo de 1 mm', (t) => `Na peça acima, em ${desc.texto}: ${t}`));
        item('Furo aqui…', () => perguntar('Diâmetro e profundidade do furo', 'ex.: 5 mm, atravessando a peça (ou: 3 mm, 10 mm de fundo)', (t) => `Na peça acima, faça um furo em ${desc.texto}, no ponto clicado, entrando na peça na direção contrária à da face: ${t}`));
      }
      item('Medir esta face', () => {
        fecharMenu();
        const dims = [0, 1, 2].map((k) => face.max[k] - face.min[k]).filter((d) => d > 0.05).map(fmt);
        mostrar(`<b>${desc.nome.replace(/^./, (c) => c.toUpperCase())}</b><br>${dims.join(' × ')} mm · área ${fmt(face.area)} mm²<br>ponto: x ${fmt(alvo.ponto[0])}, y ${fmt(alvo.ponto[1])}, z ${fmt(alvo.ponto[2])}`);
      });
      item('Medir distância (clique em 2 pontos)', () => {
        fecharMenu();
        destacar(null);
        medindo = [alvo.ponto];
        marcar(medindo);
        mostrar('Medindo: clique no 2º ponto da peça.');
      });
      item('Olhar de frente para esta face', () => {
        fecharMenu();
        const n = face.normal;
        cam.inclina = Math.max(-1.45, Math.min(1.45, Math.asin(n[2])));
        if (Math.abs(n[2]) < 0.99) cam.giro = Math.atan2(n[1], n[0]);
        redesenhar();
      });
      const nomeDoStl = /augpt-img:\/\/([a-z]+\.stl)/.exec(figura.dataset.stl || '')?.[1];
      if (nomeDoStl && global.augpt?.imagem?.salvar) {
        item('Salvar o STL…', () => {
          fecharMenu();
          global.augpt.imagem.salvar(nomeDoStl, figura.querySelector('figcaption')?.textContent || 'peca-3d');
        });
      }
      palco.append(menu);
    }

    let arrasto = null;
    let medindo = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      fecharMenu();
      arrasto = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!arrasto) return;
      cam.giro -= (e.clientX - arrasto.x) * 0.01;
      cam.inclina = Math.max(-1.45, Math.min(1.45, cam.inclina + (e.clientY - arrasto.y) * 0.01));
      arrasto.x = e.clientX;
      arrasto.y = e.clientY;
      if (marcas) marcar(pontosMarcados);
      redesenhar();
    });
    canvas.addEventListener('pointerup', (e) => {
      const clique = arrasto && Math.hypot(e.clientX - arrasto.x0, e.clientY - arrasto.y0) < 4;
      arrasto = null;
      if (!clique) return;
      // clique simples: o 2º ponto da medida, ou apaga o destaque
      if (medindo) {
        const { origem, dir } = raioDo(e);
        const alvo = acertar(peca, origem, dir);
        if (!alvo) return;
        const [a, b] = [medindo[0], alvo.ponto];
        const d = sub(b, a);
        marcar([a, b]);
        mostrar(`<b>Distância: ${fmt(Math.hypot(...d))} mm</b><br>Δx ${fmt(Math.abs(d[0]))} · Δy ${fmt(Math.abs(d[1]))} · Δz ${fmt(Math.abs(d[2]))} mm`);
        medindo = null;
      } else if (destaque) {
        destacar(null);
        mostrar('');
      }
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { origem, dir } = raioDo(e);
      const alvo = acertar(peca, origem, dir);
      if (alvo) abrirMenu(e, alvo);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = Math.max(raio * 0.8, Math.min(raio * 10, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      if (marcas) marcar(pontosMarcados);
      redesenhar();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => { Object.assign(cam, inicial); destacar(null); marcar([]); mostrar(''); medindo = null; redesenhar(); });
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) fecharMenu(); });
    new ResizeObserver(redesenhar).observe(canvas);
    redesenhar();
  }

  global.peca3d = { montar, lerStl, acertar, faceDe, descreverFace, nomeDaFace };
})(typeof window !== 'undefined' ? window : globalThis);
