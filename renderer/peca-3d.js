/* Visualizador de peças 3D no chat (27/11, Davi: "faz o visualizador 3d logo"): lê o STL que o app serve
 * (augpt-img://…stl), desenha em WebGL com luz e a mesa de impressão embaixo; arrastar gira, a roda aproxima,
 * clique duplo volta ao começo. Sem biblioteca: a peça é um STL simples, e o three.js seria 600 KB para isso.
 * Sem WebGL (ou o arquivo não abre), fica a foto que veio junto. */
(function (global) {
  'use strict';

  function lerStl(buf) {
    const dv = new DataView(buf);
    const texto = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512)));
    const pontos = [];
    if (/^solid/.test(texto) && /facet/.test(new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096))))) {
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

  // matrizes 4×4 (coluna a coluna, como o WebGL espera)
  const perspectiva = (fov, asp, perto, longe) => {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (perto - longe);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (longe + perto) * nf, -1, 0, 0, 2 * longe * perto * nf, 0];
  };
  function olhar(olho, alvo, cima) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const z = norm(sub(olho, alvo)), x = norm(cruz(cima, z)), y = cruz(z, x);
    const d = (a) => -(a[0] * olho[0] + a[1] * olho[1] + a[2] * olho[2]);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1];
  }
  const vezes = (a, b) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1) for (let l = 0; l < 4; l += 1) for (let k = 0; k < 4; k += 1) r[c * 4 + l] += a[k * 4 + l] * b[c * 4 + k];
    return r;
  };

  const VERT = 'attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ vn = n; gl_Position = m * vec4(p, 1.0); }';
  const FRAG = 'precision mediump float; varying vec3 vn; uniform vec3 cor; uniform float luz; void main(){ vec3 n = normalize(vn); float d = max(dot(n, normalize(vec3(0.4, -0.6, 0.8))), 0.0) * 0.65 + max(dot(n, normalize(vec3(-0.6, 0.5, 0.3))), 0.0) * 0.25; gl_FragColor = vec4(cor * (luz + d), 1.0); }';

  function montar(figura) {
    const url = figura.dataset.stl;
    if (!url || figura.dataset.montado) return;
    figura.dataset.montado = '1';
    const canvas = document.createElement('canvas');
    canvas.className = 'peca3d-tela';
    canvas.setAttribute('aria-label', 'Peça 3D: arraste para girar, role para aproximar');
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return; // fica a foto
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        const peca = lerStl(buf);
        if (!peca.pos.length) return;
        const dica = Object.assign(document.createElement('div'), { className: 'peca3d-dica', textContent: 'arraste para girar · role para aproximar · clique duplo volta' });
        const img = figura.querySelector('img');
        if (img) img.hidden = true;
        figura.prepend(canvas, dica);
        desenhar(gl, canvas, peca);
      })
      .catch(() => { /* fica a foto */ });
  }

  function desenhar(gl, canvas, peca) {
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
    // a mesa: um quadrado com folga, um pouco abaixo da peça, com a mesma normal para cima
    const folga = raio * 1.3, zm = peca.min[2] - 0.05;
    const mesa = new Float32Array([centro[0] - folga, centro[1] - folga, zm, centro[0] + folga, centro[1] - folga, zm, centro[0] + folga, centro[1] + folga, zm, centro[0] - folga, centro[1] - folga, zm, centro[0] + folga, centro[1] + folga, zm, centro[0] - folga, centro[1] + folga, zm]);
    const mesaN = new Float32Array(18).map((_, i) => (i % 3 === 2 ? 1 : 0));
    const vp = buffer(peca.pos, 'p'), vn = buffer(peca.nor, 'n'), mp = buffer(mesa, 'p'), mn = buffer(mesaN, 'n');
    const uM = gl.getUniformLocation(prog, 'm'), uCor = gl.getUniformLocation(prog, 'cor'), uLuz = gl.getUniformLocation(prog, 'luz');
    const corDaPeca = (() => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim();
      const m = /^#([0-9a-f]{6})$/i.exec(v);
      return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0.85, 0.62, 0.25];
    })();
    const inicial = { giro: -0.9, inclina: 0.55, dist: raio * 2.6 };
    const cam = { ...inicial };
    gl.enable(gl.DEPTH_TEST);
    let pedido = 0;
    function quadro() {
      pedido = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const olho = [centro[0] + cam.dist * Math.cos(cam.inclina) * Math.cos(cam.giro), centro[1] + cam.dist * Math.cos(cam.inclina) * Math.sin(cam.giro), centro[2] + cam.dist * Math.sin(cam.inclina)];
      const m = vezes(perspectiva(0.75, w / h, raio * 0.05, raio * 20), olhar(olho, centro, [0, 0, 1]));
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
    }
    const redesenhar = () => { if (!pedido) pedido = requestAnimationFrame(quadro); };
    let arrasto = null;
    canvas.addEventListener('pointerdown', (e) => { arrasto = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!arrasto) return;
      cam.giro -= (e.clientX - arrasto.x) * 0.01;
      cam.inclina = Math.max(-1.45, Math.min(1.45, cam.inclina + (e.clientY - arrasto.y) * 0.01));
      arrasto = { x: e.clientX, y: e.clientY };
      redesenhar();
    });
    canvas.addEventListener('pointerup', () => (arrasto = null));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = Math.max(raio * 0.8, Math.min(raio * 10, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      redesenhar();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => { Object.assign(cam, inicial); redesenhar(); });
    new ResizeObserver(redesenhar).observe(canvas);
    redesenhar();
  }

  global.peca3d = { montar, lerStl };
})(typeof window !== 'undefined' ? window : globalThis);
