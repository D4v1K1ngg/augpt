'use strict';

/*
 * Esfera neural (20/10, fase 3 da identidade "Au", da referência do Davi: augpt-chat-esfera.html).
 * Enquanto o agente trabalha, uma esfera de nós em 3D (three.js r128, renderer/vendor/three-r128.js,
 * MIT) se monta do miolo para fora; cada etapa concluída dispara um pulso, cada site que o agente lê
 * de verdade vira um nó com anel e etiqueta, e a frase embaixo é o que ele está pensando. Modos: Alto
 * (WebGL com bloom e lente), Leve (Canvas 2D) e Desligado; a janela "Configurações do nó" ajusta
 * forma, luz, lente, cor e desempenho. O desenho é o da referência — aqui só mudam a ligação com o
 * cartão de atividade do AuGPT, as cores do tema e o padrão vindo da verificação do hardware.
 *
 * Uso (renderer/app*.js): const g = Esfera.criar(T, raiz, { act: cartao }); T = { steps: [{ id, t, d,
 * s: 'act'|'ok'|'err' }], sites: [], sa: [], sat: [], think: [], lastThought, total, t0, ended, kind,
 * ms }; depois de mudar T, g.kick(); no fim, g.end(). Esfera.abrirAjustes(botao), Esfera.modo(),
 * Esfera.definirModo(m), Esfera.padrao(m) (só vale enquanto o usuário não escolheu nada).
 */
(() => {
const $ = (sel, r = document) => r.querySelector(sel);
const $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const P = { x: '<path d="M6 6l12 12M18 6 6 18"/>' };
const ic = (n, c = '') => `<svg viewBox="0 0 24 24" class="ic ${c}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

/* ------------------------------ esfera neural: configurações + renderizador WebGL compartilhado ------------------------------ */
const hash01 = (s) => { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967295; };
const hexA = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const TAU = Math.PI * 2;
P.sliders = '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>';

const ORB_KEY = 'augpt.esfera';
const ORB_DEF = { mode: 'alto', rot: 0.22, breath: 1, detail: 2, lines: 0.62, dust: 1, size: 1, glow: 1.15, bloom: 0.95, shell: 1.4, dof: 0.7, ca: 0.35, grain: 0.3, glyphs: true, auto: true, pal: 'brasa', hue: 150, sat: 1, res: 1.5, fps: 45, seed: 7 };
const ORB_PAL = {
  brasa: { n: 'Brasa', hue: 150, sat: 1, g: 'linear-gradient(90deg,#ff7a3a,#ffcf4f)' },
  original: { n: 'Original', hue: 0, sat: 1, g: 'linear-gradient(90deg,#3f8fff,#a57cff)' },
  aurora: { n: 'Aurora', hue: -45, sat: 1.05, g: 'linear-gradient(90deg,#2fd6e0,#4f7dff)' },
  gelo: { n: 'Gelo', hue: 0, sat: 0.25, g: 'linear-gradient(90deg,#9fb0d8,#b3a8d8)' },
};
const OS = { ...ORB_DEF };
try { const sv = JSON.parse(localStorage.getItem(ORB_KEY) || '{}'); for (const k in ORB_DEF) if (typeof sv[k] === typeof ORB_DEF[k]) OS[k] = sv[k]; } catch { /* sem armazenamento */ }
if (!['alto', 'leve', 'off'].includes(OS.mode)) OS.mode = 'alto';
OS.detail = Math.max(1, Math.min(3, Math.round(OS.detail)));
const saveOS = () => { try { localStorage.setItem(ORB_KEY, JSON.stringify(OS)); } catch { /* idem */ } };
const LIVE = { set: new Set() };
const liveAll = (fn) => LIVE.set.forEach((g) => { if (!g.root.isConnected) LIVE.set.delete(g); else fn(g); });

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((a) => new THREE.Vector3(...a).normalize());
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = {}, nf = [];
    const mid = (a, b) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; if (cache[k] !== undefined) return cache[k]; v.push(v[a].clone().add(v[b]).normalize()); return (cache[k] = v.length - 1); };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}
const GLYPHS = ['36', '5Ð', 'Σ8', '0.47', 'λ', 'Δt', 'ψ12', 'π/4', 'x²', '0101', '∂f', '88', 'Ω', '7·3', 'ε', '√2', '17', 'θ', 'Ξ', '04'];
const DUSTN = 1600;

/* um único renderizador WebGL para todos os turnos: cada quadro vira um drawImage no canvas 2D do turno */
const Orb = {
  st: 0, gv: 0, key: '', cur: null, G: null, forced: false, deg: 1, stamp: -1, W: 0, H: 0, PR: 0, err: '',
  setup() {
    if (this.st) return this.st > 0;
    try {
      if (typeof THREE === 'undefined') throw new Error('Three.js não carregou');
      const cv = document.createElement('canvas');
      const r = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, powerPreference: 'default' });
      if (!r.getContext()) throw new Error('WebGL indisponível');
      r.setClearColor(0x000000, 1);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100), group = new THREE.Group(); scene.add(group);
      const colA = new THREE.Color('#3f8fff'), colB = new THREE.Color('#a57cff');
      const U = {
        uTime: { value: 0 }, uBreath: { value: 1 }, uPulseT: { value: new THREE.Vector3(100, 100, 100) }, uHover: { value: -5 }, uDof: { value: 0.7 },
        uColA: { value: colA }, uColB: { value: colB }, uScale: { value: 3 }, uPR: { value: 1 }, uGroupScale: { value: 1 }, uGlow: { value: 1.15 }, uLines: { value: 0.62 },
        uRev: { value: 0 }, uActG: { value: -1 }, uNS: { value: 5 }, uBase: { value: 1 },
      };
      const common = `
uniform float uTime, uBreath, uHover, uDof, uRev;
uniform vec3 uPulseT;
uniform vec3 uColA, uColB;
vec3 breathe(vec3 p){
  float w = sin(uTime*1.1 + p.x*3.1 + p.y*2.3 + p.z*1.7)*0.6 + sin(uTime*0.63 + p.y*4.0 - p.z*2.0)*0.4;
  return p * (1.0 + uBreath*0.035*w);
}
vec3 centerV(){ return (modelViewMatrix*vec4(0.,0.,0.,1.)).xyz; }
vec3 palette(vec3 v){ float k = smoothstep(-0.95, 0.95, v.x*0.85 + v.y*0.2); return mix(uColA, uColB, k); }
float frontness(vec3 v, float s){ return clamp(0.5 + 0.5*v.z/s, 0.0, 1.0); }
float wv(float d, float t){ float f = t*5.0 - d; return exp(-f*f*1.4) * exp(-t*0.35); }
float waves(vec3 d){ return wv(d.x,uPulseT.x) + wv(d.y,uPulseT.y) + wv(d.z,uPulseT.z); }
float birth(float ord){ return clamp((uRev - ord)/3.0, 0.0, 1.0); }`;
      const pointVS = `${common}
attribute float aSize, aBright, aIndex, aOrd, aGrp, aMark;
attribute vec3 aDist;
uniform float uScale, uPR, uGroupScale, uActG, uNS, uBase;
varying vec3 vCol; varying float vB, vSoft;
void main(){
  float bt = birth(aOrd);
  float ap = bt*bt*(3.0-2.0*bt);
  float fl = sin(3.14159*bt);
  vec3 p = breathe(position);
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  vec3 v = mv.xyz - centerV();
  float fr = frontness(v, uGroupScale);
  float depthMix = mix(1.0, mix(0.38, 1.0, fr), uDof);
  float w = waves(aDist);
  float hov = 1.0 - step(0.5, abs(aIndex - uHover));
  float tw = 0.82 + 0.18*sin(uTime*2.3 + aIndex*12.9898);
  float act = step(0.0, aGrp) * (1.0 - step(0.5, abs(mod(aGrp, uNS) - uActG))) * 0.32 * (0.6 + 0.4*sin(uTime*3.8 + aIndex));
  vB = (aBright*uBase*tw*depthMix + w*1.6 + hov*1.4 + act + aMark*0.4 + fl*0.9) * ap;
  vSoft = (1.0 - fr)*uDof;
  vCol = palette(v/uGroupScale);
  gl_PointSize = aSize*mix(1.0, mix(0.78,1.08,fr), uDof)*(1.0 + w*0.9 + hov*0.9 + aMark*0.5)*(0.45+0.55*ap)*(1.0+fl*0.6) * uPR * uScale / -mv.z;
  gl_Position = projectionMatrix*mv;
}`;
      const pointFS = `
uniform float uGlow;
varying vec3 vCol; varying float vB, vSoft;
void main(){
  float d = length(gl_PointCoord - 0.5)*2.0;
  if(d>1.0) discard;
  float coreR = mix(0.3, 0.5, vSoft);
  float core = smoothstep(coreR, coreR*0.15, d) * mix(1.0, 0.55, vSoft);
  float halo = exp(-d*d*5.5)*uGlow;
  vec3 col = mix(vCol*1.15, vec3(1.0), core*0.92);
  float a = (core*1.15 + halo*0.7) * vB;
  gl_FragColor = vec4(col*a, 1.0);
}`;
      const lineVS = `${common}
attribute vec2 aEnds; attribute float aW, aOrdY, aT; attribute vec3 aDist;
uniform float uLines, uGroupScale, uBase;
varying vec3 vCol; varying float vA;
void main(){
  float g = clamp((uRev - aOrdY)/3.0, 0.0, 1.0);
  float vis = clamp((g*1.25 - aT)*4.0, 0.0, 1.0);
  vec3 p = breathe(position);
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  vec3 v = mv.xyz - centerV();
  float fr = frontness(v, uGroupScale);
  float hov = (1.0 - step(0.5, abs(aEnds.x-uHover))) + (1.0 - step(0.5, abs(aEnds.y-uHover)));
  float w = waves(aDist);
  vA = (aW*uLines*uBase*mix(1.0, mix(0.35,1.0,fr), uDof) + w*1.3*aW + min(hov,1.0)*0.9) * vis;
  vCol = mix(palette(v/uGroupScale), vec3(1.0), 0.2 + w*0.4);
  gl_Position = projectionMatrix*mv;
}`;
      const lineFS = 'varying vec3 vCol; varying float vA; void main(){ gl_FragColor = vec4(vCol*vA, 1.0); }';
      const addMat = (vs, fs, extra = {}) => new THREE.ShaderMaterial(Object.assign({ vertexShader: vs, fragmentShader: fs, uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }, extra));
      const pointMat = addMat(pointVS, pointFS), lineMat = addMat(lineVS, lineFS);
      const shellU = { uShell: { value: 1 }, uColA: U.uColA, uColB: U.uColB };
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), addMat(`
uniform vec3 uColA, uColB; varying vec3 vN, vV, vC;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz);
  vec3 c = (modelViewMatrix*vec4(0.,0.,0.,1.)).xyz; vec3 v = mv.xyz - c;
  vC = mix(uColA, uColB, smoothstep(-0.95,0.95,v.x*0.85+v.y*0.2));
  gl_Position = projectionMatrix*mv;
}`, `
uniform float uShell; varying vec3 vN, vV, vC;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = (0.03 + pow(f, 3.0)*0.16) * uShell;
  gl_FragColor = vec4(vC*a, 1.0);
}`, { uniforms: shellU }));
      shell.renderOrder = 0; shell.frustumCulled = false; group.add(shell);
      // atlas de glifos (Canvas 2D): os números e símbolos miúdos dentro da esfera
      const ac = document.createElement('canvas'); ac.width = 512; ac.height = 320;
      const ag = ac.getContext('2d'); ag.fillStyle = '#d6deff'; ag.font = '500 30px ui-monospace, Menlo, Consolas, monospace'; ag.textAlign = 'center'; ag.textBaseline = 'middle';
      GLYPHS.forEach((s, i) => ag.fillText(s, (i % 4) * 128 + 64, Math.floor(i / 4) * 64 + 32));
      const atlas = new THREE.CanvasTexture(ac); atlas.minFilter = THREE.LinearFilter;
      // pós-processamento: bloom + lente (sem fundo: o preto vem do próprio clear)
      const composer = new THREE.EffectComposer(r);
      const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(512, 512), 0.95, 0.5, 0.42);
      const lensPass = new THREE.ShaderPass({
        uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uCA: { value: 0.35 }, uGrain: { value: 0.3 }, uRes: { value: new THREE.Vector2(1, 1) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: `
uniform sampler2D tDiffuse; uniform float uTime, uCA, uGrain; uniform vec2 uRes; varying vec2 vUv;
void main(){
  vec2 c = vUv - .5; float r = dot(c,c);
  vec2 off = c*r*uCA*0.06;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv+off).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv-off).b;
  col *= 1.0 - 0.42*smoothstep(0.12, 0.62, r*1.5);
  col = col/(1.0+col*0.12)*1.06;
  float n = fract(sin(dot(vUv*uRes + fract(uTime)*97., vec2(12.9898,78.233)))*43758.5453);
  float lum = dot(col, vec3(.299,.587,.114));
  col += (n-.5)*uGrain*0.07*smoothstep(0.0, 0.3, lum);
  gl_FragColor = vec4(col, 1.);
}` });
      composer.addPass(new THREE.RenderPass(scene, camera)); composer.addPass(bloomPass); composer.addPass(lensPass);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.st = -1; this.err = 'O navegador interrompeu o WebGL'; liveAll((g) => g.refresh()); });
      Object.assign(this, { cv, r, scene, camera, group, U, shellU, pointMat, lineMat, atlas, composer, bloomPass, lensPass, colA, colB, tmpA: new THREE.Color(), tmpB: new THREE.Color(), tanH: Math.tan(THREE.MathUtils.degToRad(22.5)) });
      this.st = 1;
    } catch (e) { this.st = -1; this.err = String(e && e.message || e); }
    return this.st > 0;
  },
  ensure() { // reconstrói o grafo quando a densidade ou a semente mudam
    const k = `${OS.detail}|${OS.seed}`; if (this.key !== k || !this.G) this.build(k);
  },
  build(key) {
    const { group } = this, old = this.G;
    if (old) [old.pts, old.lines, old.dust, ...old.glyphs].forEach((o) => { group.remove(o); o.geometry && o.geometry.dispose(); if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); } });
    const rand = mulberry32(OS.seed), { v, f } = icosphere(OS.detail), V3 = THREE.Vector3;
    const nodes = v.map((p, i) => {
      const q = p.clone().multiplyScalar(1 + (rand() - 0.5) * 0.07);
      q.add(new V3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.025));
      const lvl = i < 12 ? 0 : i < 42 ? 1 : 2;
      const size = lvl === 0 ? 16 + rand() * 3 : lvl === 1 ? 12 + rand() * 3 : (OS.detail >= 3 ? 3.4 : 4.6) + rand() * 2.2;
      return { p: q, size, bright: lvl === 0 ? 1.15 : lvl === 1 ? 1 : 0.72, outer: true, g: Math.floor(rand() * 64), ord: -1 };
    });
    const eset = new Set(), edges = [];
    const addE = (a, b, w) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; if (eset.has(k)) return; eset.add(k); edges.push([a, b, w]); };
    for (const [a, b, c] of f) { addE(a, b, 1); addE(b, c, 1); addE(c, a, 1); }
    const nOuter = nodes.length, nInner = Math.round(nOuter * 0.4);
    for (let i = 0; i < nInner; i++) {
      const dir = new V3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      nodes.push({ p: dir.multiplyScalar(0.28 + Math.pow(rand(), 0.6) * 0.6), size: 2.6 + rand() * 2.4, bright: 0.5, outer: false, g: Math.floor(rand() * 64), ord: -1 });
    }
    for (let i = nOuter; i < nodes.length; i++) {
      const ds = nodes.map((n, j) => [j, j === i ? 1e9 : n.p.distanceToSquared(nodes[i].p)]).sort((a, b) => a[1] - b[1]);
      addE(i, ds[0][0], 0.35); addE(i, ds[1][0], 0.35); if (rand() < 0.4) addE(i, ds[2][0], 0.28);
    }
    const N = nodes.length, E = edges.length, adj = nodes.map(() => []);
    edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
    // ordem de crescimento: nasce no miolo e se espalha pela malha (fronteira aleatória que prefere os mais próximos)
    let core = nOuter, best = 9; for (let i = nOuter; i < N; i++) { const m = nodes[i].p.length(); if (m < best) { best = m; core = i; } }
    const dist = new Array(N).fill(1e9); dist[core] = 0; const q = [core];
    for (let h = 0; h < q.length; h++) { const u = q[h]; adj[u].forEach((w) => { if (dist[w] > dist[u] + 1) { dist[w] = dist[u] + 1; q.push(w); } }); }
    let ord = 0; nodes[core].ord = ord++;
    const front = new Set(); const addF = (u) => adj[u].forEach((w) => { if (nodes[w].ord < 0) front.add(w); }); addF(core);
    while (front.size) { let pick = -1, bs = 1e9; front.forEach((w) => { const s = dist[w] + rand() * 1.7; if (s < bs) { bs = s; pick = w; } }); front.delete(pick); nodes[pick].ord = ord++; addF(pick); }
    nodes.forEach((n) => { if (n.ord < 0) n.ord = ord++; });
    const f32 = (n, fill) => { const a = new Float32Array(n); if (fill !== undefined) a.fill(fill); return a; };
    const A = (g, name, arr, k = 1) => g.setAttribute(name, new THREE.BufferAttribute(arr, k));
    // nós
    const pos = f32(N * 3), sz = f32(N), br = f32(N), ix = f32(N), od = f32(N), gp = f32(N);
    nodes.forEach((n, i) => { n.i = i; pos.set([n.p.x, n.p.y, n.p.z], i * 3); sz[i] = n.size; br[i] = n.bright; ix[i] = i; od[i] = n.ord; gp[i] = n.g; });
    const g = new THREE.BufferGeometry();
    A(g, 'position', pos, 3); A(g, 'aSize', sz); A(g, 'aBright', br); A(g, 'aIndex', ix); A(g, 'aOrd', od); A(g, 'aGrp', gp); A(g, 'aMark', f32(N)); A(g, 'aDist', f32(N * 3, 999), 3);
    const pts = new THREE.Points(g, this.pointMat); pts.renderOrder = 3; pts.frustumCulled = false; group.add(pts);
    // conexões: nascem do nó mais antigo para o mais novo
    const lp = f32(E * 6), le = f32(E * 4), lw = f32(E * 2), lo = f32(E * 2), lt = f32(E * 2);
    edges.forEach(([a0, b0, w], i) => {
      let a = a0, b = b0; if (nodes[a].ord > nodes[b].ord) [a, b] = [b, a];
      const PA = nodes[a].p, PB = nodes[b].p; edges[i] = [a, b, w];
      lp.set([PA.x, PA.y, PA.z, PB.x, PB.y, PB.z], i * 6); le.set([a, b, a, b], i * 4); lw[i * 2] = lw[i * 2 + 1] = w; lo[i * 2] = lo[i * 2 + 1] = nodes[b].ord; lt[i * 2] = 0; lt[i * 2 + 1] = 1;
    });
    const lg = new THREE.BufferGeometry();
    A(lg, 'position', lp, 3); A(lg, 'aEnds', le, 2); A(lg, 'aW', lw); A(lg, 'aOrdY', lo); A(lg, 'aT', lt); A(lg, 'aDist', f32(E * 6, 999), 3);
    const lines = new THREE.LineSegments(lg, this.lineMat); lines.renderOrder = 1; lines.frustumCulled = false; group.add(lines);
    // poeira de luz
    const dp = f32(DUSTN * 3), ds = f32(DUSTN), db = f32(DUSTN), dord = f32(DUSTN);
    for (let i = 0; i < DUSTN; i++) {
      const dir = new V3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(Math.cbrt(rand()) * 0.97);
      dp.set([dir.x, dir.y, dir.z], i * 3); ds[i] = 0.9 + rand() * 1.6; db[i] = 0.22 + rand() * 0.33; dord[i] = rand() * N * 0.95;
    }
    const dg = new THREE.BufferGeometry();
    A(dg, 'position', dp, 3); A(dg, 'aSize', ds); A(dg, 'aBright', db); A(dg, 'aIndex', f32(DUSTN, -10)); A(dg, 'aOrd', dord); A(dg, 'aGrp', f32(DUSTN, -9)); A(dg, 'aMark', f32(DUSTN)); A(dg, 'aDist', f32(DUSTN * 3, 999), 3);
    const dust = new THREE.Points(dg, this.pointMat); dust.renderOrder = 2; dust.frustumCulled = false; group.add(dust);
    // glifos
    const glyphs = [];
    for (let i = 0; i < 18; i++) {
      const gi = Math.floor(rand() * GLYPHS.length), tex = this.atlas.clone(); tex.needsUpdate = true;
      tex.repeat.set(1 / 4, 1 / 5); tex.offset.set((gi % 4) / 4, 1 - (Math.floor(gi / 4) + 1) / 5);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, color: 0xc8d2ff }));
      s.scale.set(0.1, 0.05, 1); s.position.copy(new V3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(0.3 + rand() * 0.58));
      s.userData.phase = rand() * 6.28; s.frustumCulled = false; group.add(s); glyphs.push(s);
    }
    this.G = { nodes, edges, adj, N, E, core, pts, lines, dust, glyphs, rev: N + 3 };
    this.key = key; this.gv++; this.cur = null;
  },
  size(W, H, pr) {
    if (W === this.W && H === this.H && pr === this.PR) return;
    this.W = W; this.H = H; this.PR = pr;
    this.r.setPixelRatio(pr); this.r.setSize(W, H, false); this.composer.setPixelRatio(pr); this.composer.setSize(W, H);
    this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); this.lensPass.uniforms.uRes.value.set(W * pr, H * pr);
  },
  palette() {
    const sat = OS.sat, hue = OS.hue; this.tmpA.set('#3f8fff').offsetHSL(hue / 360, 0, 0); this.tmpB.set('#a57cff').offsetHSL(hue / 360, 0, 0);
    for (const [t, d] of [[this.tmpA, this.colA], [this.tmpB, this.colB]]) { const g = (t.r + t.g + t.b) / 3; d.setRGB(g + (t.r - g) * sat, g + (t.g - g) * sat, g + (t.b - g) * sat); }
  },
  /* desenha o estado S (de um turno) no canvas compartilhado */
  render(S, o) {
    const { G, U, camera, group } = this, pr = Math.max(0.5, Math.min(2, OS.res, devicePixelRatio || 1) * this.deg), rf = Math.min(1, S.rev / G.rev);
    this.size(o.W, o.H, pr); this.palette();
    U.uBreath.value = reduced ? 0 : OS.breath; U.uGlow.value = OS.glow; U.uLines.value = OS.lines; U.uDof.value = OS.dof;
    this.shellU.uShell.value = OS.shell * rf; this.bloomPass.strength = OS.bloom * (1 + 0.8 * o.fin);
    this.lensPass.uniforms.uCA.value = OS.ca; this.lensPass.uniforms.uGrain.value = OS.grain; this.lensPass.uniforms.uTime.value = S.clk;
    G.dust.geometry.setDrawRange(0, Math.round(DUSTN * OS.dust));
    if (this.cur !== S || S.dirty) {
      const ga = G.pts.geometry.attributes, la = G.lines.geometry.attributes;
      ga.aDist.array.set(S.nd); ga.aDist.needsUpdate = true; ga.aMark.array.set(S.mark); ga.aMark.needsUpdate = true; la.aDist.array.set(S.ld); la.aDist.needsUpdate = true;
      this.cur = S; S.dirty = false;
    }
    U.uRev.value = S.rev; U.uTime.value = S.clk; U.uPulseT.value.set(S.clk - S.w0[0], S.clk - S.w0[1], S.clk - S.w0[2]);
    U.uHover.value = S.hover >= 0 ? S.hover : -5; U.uActG.value = o.ai; U.uNS.value = o.n; U.uBase.value = o.base; U.uPR.value = pr;
    group.rotation.set(S.pitch + (OS.rot > 0 && !reduced ? Math.sin(S.clk * 0.15) * 0.12 : 0), S.yaw, 0); group.scale.setScalar(S.scale); U.uGroupScale.value = S.scale;
    const frac = (o.R * OS.size) / o.H; camera.position.set(0, 0, 1 / (2 * frac * this.tanH)); U.uScale.value = (o.R * OS.size) / 32.77;
    G.glyphs.forEach((s) => { s.visible = OS.glyphs; s.material.opacity = (0.26 + 0.2 * Math.sin(S.clk * 1.3 + s.userData.phase)) * Math.max(0, Math.min(1, (rf - 0.25) / 0.5)); });
    this.composer.render();
  },
  degrade() {
    if (this.deg > 0.55) this.deg = Math.max(0.5, this.deg - 0.25); else this.forced = true;
    liveAll((g) => g.refresh());
  },
};
const useGL = () => OS.mode === 'alto' && !Orb.forced && Orb.setup();

/* ------------------------------ aba de configurações do nó ------------------------------ */
const ORB_TABS = [
  ['forma', 'Forma', [
    ['range', 'rot', 'Rotação', 0, 1.5, 0.01], ['range', 'breath', 'Respiração', 0, 3, 0.01], ['range', 'detail', 'Densidade', 1, 3, 1],
    ['range', 'lines', 'Linhas', 0, 1.5, 0.01], ['range', 'dust', 'Poeira de luz', 0, 1, 0.01], ['range', 'size', 'Tamanho', 0.6, 1.4, 0.01],
    ['check', 'glyphs', 'Números e símbolos dentro da esfera'], ['check', 'auto', 'Pulsos espontâneos durante o raciocínio']]],
  ['luz', 'Luz', [
    ['range', 'glow', 'Brilho dos nós', 0, 2.5, 0.01], ['range', 'bloom', 'Bloom', 0, 2, 0.01], ['range', 'shell', 'Volume interno', 0, 2.5, 0.01], ['range', 'dof', 'Profundidade', 0, 1, 0.01]]],
  ['lente', 'Lente', [['range', 'ca', 'Aberração cromática', 0, 1.5, 0.01], ['range', 'grain', 'Granulado', 0, 1, 0.01]]],
  ['cor', 'Cor', 'cor'],
  ['perf', 'Desempenho', 'perf'],
];
const ORB_MODES = [['alto', 'Alto', 'WebGL com bloom e lente. O mais bonito; usa a GPU enquanto o agente trabalha.'], ['leve', 'Leve', 'Esfera em Canvas 2D. Bem mais barata para a GPU.'], ['off', 'Desligado', 'Sem animação: só o texto do que o agente está fazendo.']];
let orbDlg = null, orbPrev = null;
function orbRange(k, lab, mn, mx, st) {
  const v = OS[k], fx = st >= 1 ? 0 : 2;
  return `<label class="oc-r"><span>${lab}</span><output data-o="${k}">${(+v).toFixed(fx)}</output><input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${v}"></label>`;
}
function orbPanel(id) {
  const t = ORB_TABS.find((x) => x[0] === id);
  if (t[2] === 'cor') {
    return `<div class="oc-sw" role="radiogroup" aria-label="Paleta">${Object.entries(ORB_PAL).map(([k, p]) => `<button type="button" role="radio" class="oc-swb" data-pal="${k}" aria-checked="${OS.pal === k}" title="${p.n}"><i style="background:${p.g}"></i>${p.n}</button>`).join('')}</div>
      ${orbRange('hue', 'Matiz', -180, 180, 1)}${orbRange('sat', 'Saturação', 0, 1.5, 0.01)}
      <p class="oc-note">As paletas são pontos de partida: mexer no matiz ou na saturação cria uma cor própria.</p>`;
  }
  if (t[2] === 'perf') {
    const gl = Orb.st > 0 ? 'WebGL ativo' : Orb.st < 0 ? `WebGL indisponível${Orb.err ? ` (${esc(Orb.err)})` : ''}` : 'WebGL ainda não iniciado';
    return `<div class="oc-modes" role="radiogroup" aria-label="Qualidade">${ORB_MODES.map(([k, n, d]) => `<button type="button" role="radio" data-mode="${k}" aria-checked="${OS.mode === k}"><b>${n}</b><span>${d}</span></button>`).join('')}</div>
      ${orbRange('res', 'Resolução (Alto)', 0.5, 2, 0.05)}
      <label class="oc-r oc-sel"><span>Limite de quadros</span><select data-k="fps">${[20, 30, 45, 60].map((f) => `<option value="${f}"${OS.fps === f ? ' selected' : ''}>${f} fps</option>`).join('')}</select></label>
      <p class="oc-note">${gl}${Orb.forced ? ' · mudei para o modo Leve sozinho porque a tela estava travando' : ''}${Orb.G ? ` · ${Orb.G.N} nós, ${Orb.G.E} conexões` : ''}. A esfera só anima enquanto o agente trabalha e pausa quando o cartão está fechado ou a aba fica em segundo plano.</p>`;
  }
  return t[2].map(([ty, k, lab, mn, mx, st]) => (ty === 'check'
    ? `<label class="oc-c"><input type="checkbox" data-k="${k}"${OS[k] ? ' checked' : ''}><span>${lab}</span></label>` : orbRange(k, lab, mn, mx, st))).join('');
}
function orbCfgOpen(from) {
  if (!orbDlg) {
    orbDlg = document.createElement('dialog'); orbDlg.className = 'orbcfg'; orbDlg.setAttribute('aria-labelledby', 'orbT');
    orbDlg.innerHTML = `
      <div class="oc-head"><h2 id="orbT">Configurações do nó</h2><button type="button" class="ibtn oc-x" aria-label="Fechar">${ic('x')}</button></div>
      <div class="oc-body">
        <div class="oc-prev"><div class="live"><canvas aria-hidden="true"></canvas><p class="live-cap"></p></div>
          <div class="oc-acts"><button type="button" data-a="pulse">Disparar pulso</button><button type="button" data-a="seed">Novo desenho</button><button type="button" data-a="reset">Restaurar padrão</button></div></div>
        <div class="oc-form"><div class="oc-tabs" role="tablist" aria-label="Seções">${ORB_TABS.map(([id, n], i) => `<button type="button" role="tab" id="oct-${id}" data-t="${id}" aria-selected="${i === 0}" aria-controls="ocp">${n}</button>`).join('')}</div><div class="oc-panel" id="ocp" role="tabpanel" tabindex="0"></div></div>
      </div>`;
    document.body.appendChild(orbDlg);
    const panel = $('#ocp', orbDlg); let tab = 'forma';
    const paint = () => { panel.innerHTML = orbPanel(tab); panel.setAttribute('aria-labelledby', `oct-${tab}`); $$('.oc-tabs [role=tab]', orbDlg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === tab))); };
    orbDlg._paint = paint; orbDlg._tab = (t) => { tab = t; paint(); };
    paint();
    const upd = (k) => { saveOS(); liveAll((g) => g.refresh(k)); window.dispatchEvent(new CustomEvent('esfera-ajustada', { detail: { k } })); };
    panel.addEventListener('input', (e) => {
      const i = e.target.closest('[data-k]'); if (!i) return; const k = i.dataset.k;
      OS[k] = i.type === 'checkbox' ? i.checked : i.tagName === 'SELECT' ? +i.value : +i.value;
      const o = $(`[data-o="${k}"]`, panel); if (o) o.textContent = (+OS[k]).toFixed(i.step >= 1 ? 0 : 2);
      if (k === 'hue' || k === 'sat') { OS.pal = Object.entries(ORB_PAL).find(([, p]) => p.hue === OS.hue && Math.abs(p.sat - OS.sat) < 0.005)?.[0] || 'custom'; $$('[data-pal]', panel).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pal === OS.pal))); }
      upd(k);
    });
    panel.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pal]'), m = e.target.closest('[data-mode]');
      if (p) { const pal = ORB_PAL[p.dataset.pal]; Object.assign(OS, { pal: p.dataset.pal, hue: pal.hue, sat: pal.sat }); upd('pal'); paint(); }
      if (m) { OS.mode = m.dataset.mode; Orb.forced = false; Orb.deg = 1; upd('mode'); paint(); }
    });
    $('.oc-tabs', orbDlg).addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) orbDlg._tab(b.dataset.t); });
    $('.oc-tabs', orbDlg).addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!k) return; e.preventDefault();
      const ids = ORB_TABS.map((x) => x[0]), nx = ids[(ids.indexOf(tab) + k + ids.length) % ids.length]; orbDlg._tab(nx); $(`#oct-${nx}`, orbDlg).focus();
    });
    $('.oc-acts', orbDlg).addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'pulse' && orbPrev) orbPrev.pulse();
      if (a === 'seed') { OS.seed = Math.floor(Math.random() * 1e9); upd('seed'); }
      if (a === 'reset') { Object.assign(OS, ORB_DEF); Orb.forced = false; Orb.deg = 1; upd('seed'); paint(); }
    });
    $('.oc-x', orbDlg).addEventListener('click', () => orbDlg.close());
    orbDlg.addEventListener('click', (e) => { if (e.target === orbDlg) orbDlg.close(); });
    orbDlg.addEventListener('close', () => { if (orbPrev) { orbPrev.destroy(); orbPrev = null; } liveAll((g) => g.kick()); if (orbDlg._from && orbDlg._from.isConnected) orbDlg._from.focus(); });
  }
  orbDlg._from = from; orbDlg._paint(); orbDlg.showModal();
  const PT = { steps: [], sites: [], sa: [], sat: [], think: [], lastThought: '', total: 6, t0: Date.now(), ended: true, kind: 'ok', ms: 1, m: {} };
  orbPrev = liveGraph(PT, $('.oc-prev', orbDlg), { preview: true });
  orbPrev.pulse();
}

function liveGraph(T, root, opts = {}) {
  const act = opts.preview ? { open: true, addEventListener() {} } : (opts.act || $('.act', root)), cv = $('.live canvas', root), cap = $('.live-cap', root), sw = $('.live-sw', root), mainCtx = cv.getContext('2d');
  let c = mainCtx;
  let W = 0, H = 0, dpr = 1, raf = 0, hov = null, hit = [], col = null, nf = 0, endAt = 0, endStart = 0, capTxt = null, tm = 0, pg = 0, heat = 0, lastNow = 0;
  const parts = [], born = new Map(), flash = new Map(), prevS = [], emitAt = new Map();
  const ANG = [-90, -52, -128, -20, -160, -72, -108, -36, -144, -90];
  const ease = (x) => 1 - (1 - x) ** 3;
  const grow = (key, now, d = 450) => { if (!born.has(key)) born.set(key, now); return ease(Math.min(1, (now - born.get(key)) / d)); };
  const N = () => Math.max(T.total, T.steps.length, 2);
  const short = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
  const elapsed = () => (T.ended ? (T.ms || 0) : Date.now() - T.t0);
  const progress = () => {
    if (T.ended) return T.kind === 'ok' || !T.kind ? 1 : pg;
    const n = Math.max(T.total, T.steps.length, 1), ok = T.steps.filter((s) => s.s === 'ok').length;
    return Math.min(1, (ok + (T.steps.some((s) => s.s === 'act') ? 0.5 : 0)) / n);
  };
  const actIdx = () => T.steps.findIndex((s) => s.s === 'act');
  const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const font = (w, px) => { c.font = `${w} ${px}px ${SANS}`; };
  const pill = (txt, x, y, align = 'left', color) => { // texto com fundo, para ler por cima do desenho
    font(500, 11); const w = c.measureText(txt).width + 10, x0 = align === 'left' ? x - 5 : align === 'center' ? x - w / 2 : x - w + 5;
    c.fillStyle = hexA(col.panel, 0.82); c.beginPath(); c.roundRect(x0, y - 10, w, 15, 6); c.fill();
    c.fillStyle = color || col.strong; c.textAlign = align; c.fillText(txt, x, y + 1);
  };
  const dot = (x, y, r, fill, stroke, lw = 1.5) => { c.beginPath(); c.arc(x, y, r, 0, TAU); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); } };
  const check = (x, y, k = 1, stroke) => { c.beginPath(); c.moveTo(x - 4 * k, y + 0.4 * k); c.lineTo(x - 1.1 * k, y + 3.4 * k); c.lineTo(x + 4.4 * k, y - 3 * k); c.strokeStyle = stroke || col.bg; c.lineWidth = 2 * k; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); };
  const stColor = (s) => (s === 'ok' ? col.green : s === 'err' ? col.red : s === 'act' ? col.gold : col.line);
  const running = () => !T.ended;

  /* ---------- Rede neural: esfera de nós em 3D; etapas acendem grupos, sites viram novos nós ---------- */
  const TXT = ['36', '79', 'Au', '0x3F', 'SC', 'R$', 'Δ', '12', 'IA', '7B', 'Σ', '0.82', 'FPS', '1.4k'];
  const tint = () => { const h0 = (212 + OS.hue + 360) % 360; return { gain: h0 < 90 || h0 > 330 ? 0.7 : 1, h0, span: 52 }; };
  const NET = { ready: false, vyaw: 0, vpitch: 0, drag: false, sn: [] };
  let lastDt = 0.016; const sprites = {};
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  function buildNet() {
    const r = rng(79), F = 3, X = 0.5257311, Z = 0.8506508;
    const ico = [[-X, 0, Z], [X, 0, Z], [-X, 0, -Z], [X, 0, -Z], [0, Z, X], [0, Z, -X], [0, -Z, X], [0, -Z, -X], [Z, X, 0], [-Z, X, 0], [Z, -X, 0], [-Z, -X, 0]];
    const faces = [[0, 4, 1], [0, 9, 4], [9, 5, 4], [4, 5, 8], [4, 8, 1], [8, 10, 1], [8, 3, 10], [5, 3, 8], [5, 2, 3], [2, 7, 3], [7, 10, 3], [7, 6, 10], [7, 11, 6], [11, 0, 6], [0, 1, 6], [6, 1, 10], [9, 0, 11], [9, 11, 2], [9, 2, 5], [7, 2, 11]];
    const nodes = [], key = new Map(), E = [], seen = new Set();
    const vtx = (v) => { const l = Math.hypot(v[0], v[1], v[2]), q = v.map((t) => t / l), k = q.map((t) => Math.round(t * 1e4)).join(','); if (key.has(k)) return key.get(k); const i = nodes.length; nodes.push({ x: q[0], y: q[1], z: q[2], in: false, hub: false }); key.set(k, i); return i; };
    const edge = (a, b) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!seen.has(k)) { seen.add(k); E.push([a, b]); } };
    ico.forEach((v) => vtx(v)); for (let i = 0; i < 12; i++) nodes[i].hub = true;
    faces.forEach(([a, b, cc]) => {
      const A = ico[a], B = ico[b], C = ico[cc], id = [];
      for (let i = 0; i <= F; i++) { id[i] = []; for (let j = 0; j <= F - i; j++) id[i][j] = vtx([0, 1, 2].map((k) => A[k] + ((B[k] - A[k]) * i) / F + ((C[k] - A[k]) * j) / F)); }
      for (let i = 0; i < F; i++) for (let j = 0; j < F - i; j++) { edge(id[i][j], id[i + 1][j]); edge(id[i][j], id[i][j + 1]); edge(id[i + 1][j], id[i][j + 1]); }
    });
    nodes.forEach((nd) => { const jx = nd.x + (r() - 0.5) * 0.12, jy = nd.y + (r() - 0.5) * 0.12, jz = nd.z + (r() - 0.5) * 0.12, l = Math.hypot(jx, jy, jz), k = 0.95 + r() * 0.08; nd.x = (jx / l) * k; nd.y = (jy / l) * k; nd.z = (jz / l) * k; });
    const nSurf = nodes.length;
    for (let i = 0; i < 26; i++) { const u = r() * 2 - 1, th = r() * TAU, rr = Math.sqrt(1 - u * u), k = 0.12 + r() * 0.6; nodes.push({ x: Math.cos(th) * rr * k, y: u * k, z: Math.sin(th) * rr * k, in: true, hub: false }); }
    for (let i = nSurf; i < nodes.length; i++) {
      const a = nodes[i], d = nodes.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]);
      for (let m = 0; m < 3; m++) edge(i, d[m][0]);
    }
    nodes.forEach((nd, i) => { nd.i = i; nd.g = Math.floor(r() * 64); nd.ph = r() * TAU; nd.site = -1; nd.bornAt = null; nd.ord = -1; nd.txt = r() < 0.28 ? TXT[Math.floor(r() * TXT.length)] : ''; });
    const adj = nodes.map(() => []); E.forEach(([a, b], ei) => { adj[a].push(ei); adj[b].push(ei); });
    // ordem de crescimento: nasce no miolo e se espalha pela malha
    let start = nSurf, best = 9; for (let i = nSurf; i < nodes.length; i++) { const m = Math.hypot(nodes[i].x, nodes[i].y, nodes[i].z); if (m < best) { best = m; start = i; } }
    const dist = new Array(nodes.length).fill(1e9); dist[start] = 0; const q = [start];
    for (let h0 = 0; h0 < q.length; h0++) { const u = q[h0]; adj[u].forEach((e) => { const v = E[e][0] === u ? E[e][1] : E[e][0]; if (dist[v] > dist[u] + 1) { dist[v] = dist[u] + 1; q.push(v); } }); }
    const parent = new Array(nodes.length).fill(-1), pe = new Array(nodes.length).fill(-1); let ord = 0; nodes[start].ord = ord++;
    const front = new Set(); const addF = (u) => adj[u].forEach((e) => { const v = E[e][0] === u ? E[e][1] : E[e][0]; if (nodes[v].ord < 0) front.add(v); });
    addF(start);
    while (front.size) {
      let pick = -1, bs = 1e9; front.forEach((v) => { const s = dist[v] + r() * 1.7; if (s < bs) { bs = s; pick = v; } });
      front.delete(pick); nodes[pick].ord = ord++;
      for (const e of adj[pick]) { const v = E[e][0] === pick ? E[e][1] : E[e][0]; if (nodes[v].ord >= 0 && nodes[v].ord < nodes[pick].ord) { parent[pick] = v; pe[pick] = e; break; } }
      addF(pick);
    }
    nodes.forEach((nd) => { if (nd.ord < 0) nd.ord = ord++; });
    const dust = Array.from({ length: 170 }, () => { const u = r() * 2 - 1, th = r() * TAU, rr = Math.sqrt(1 - u * u), k = Math.cbrt(r()) * 0.92; return { x: Math.cos(th) * rr * k, y: u * k, z: Math.sin(th) * rr * k, ph: r() * TAU, sp: 0.4 + r() * 1.2 }; });
    Object.assign(NET, { ready: true, nodes, E, adj, dust, parent, pe, M: nodes.length, rev: 0, sawRun: false, yaw: 0.6, pitch: 0.28, lit: new Float32Array(nodes.length), P: null, born: {} });
  }
  function sprite(h) {
    const key = `${OS.hue}|${OS.sat}|${Math.round(h / 6)}`; if (sprites[key]) return sprites[key];
    const sa = Math.round(95 * Math.min(1, OS.sat)), s = document.createElement('canvas'); s.width = s.height = 96; const g = s.getContext('2d'), gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.1, 'rgba(255,255,255,.95)'); gr.addColorStop(0.28, `hsla(${h},${sa}%,72%,.6)`); gr.addColorStop(0.6, `hsla(${h},${Math.max(0, sa - 5)}%,55%,.18)`); gr.addColorStop(1, `hsla(${h},${Math.max(0, sa - 5)}%,50%,0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96); return (sprites[key] = s);
  }
  const spawn = (e, from, now, gen = 0) => parts.push({ e, from, t0: now, d: 420 + Math.random() * 360, gen });
  const visN = (i) => NET.nodes[i].bornAt != null;
  const visE = (e) => visN(NET.E[e][0]) && visN(NET.E[e][1]);
  const burstAt = (i, now) => { if (reduced || !NET.ready) return; NET.adj[i].filter(visE).forEach((e) => spawn(e, i, now, 0)); NET.lit[i] = 1; };
  function drawRede(now) {
    if (!NET.ready) buildNet();
    const tn = tint(), ns = T.steps.length, n = N(), ai = actIdx(), run = running(), nodes = NET.nodes, M = NET.M;
    const iw = Math.round(W * dpr), ih = Math.round(H * dpr);
    if (!NET.L || NET.L.width !== iw || NET.L.height !== ih) {
      NET.L = document.createElement('canvas'); NET.L.width = iw; NET.L.height = ih; NET.LC = NET.L.getContext('2d');
      NET.B1 = document.createElement('canvas'); NET.B1.width = Math.max(8, Math.round(W / 5)); NET.B1.height = Math.max(8, Math.round(H / 5));
      NET.B2 = document.createElement('canvas'); NET.B2.width = Math.max(6, Math.round(W / 14)); NET.B2.height = Math.max(6, Math.round(H / 14));
    }
    const cx = W / 2, cy = H / 2 - 4, R = Math.min(H * 0.32, W * 0.28);
    // ---- quanto da rede já foi construída
    if (run) NET.sawRun = true;
    const okEnd = T.ended && (T.kind === 'ok' || !T.kind), instant = reduced || (T.ended && !NET.sawRun);
    const score = okEnd ? 1 : Math.min(1, pg * 0.72 + Math.min(0.28, T.sites.length * 0.035 + T.think.length * 0.03));
    const tgt = M * Math.min(1, 0.045 + 0.955 * score);
    if (instant) NET.rev = okEnd ? M : tgt; else if (NET.rev < tgt) NET.rev = Math.min(tgt, NET.rev + Math.max((tgt - NET.rev) * lastDt * 1.4, lastDt * (T.ended ? 28 : 1.8)));
    const rv = Math.floor(NET.rev), revF = Math.min(1, NET.rev / M);
    for (const nd of nodes) if (nd.bornAt == null && nd.ord < rv) {
      nd.bornAt = instant ? now - 1e4 : now;
      if (!instant && run && !reduced) { const pe = NET.pe[nd.i]; if (pe >= 0) spawn(pe, NET.parent[nd.i], now, 1); NET.lit[nd.i] = 1; }
    }
    if (!reduced && !NET.drag) { NET.yaw += lastDt * (run ? 0.22 : 0.1) + NET.vyaw; NET.pitch = Math.max(-1.1, Math.min(1.1, NET.pitch + NET.vpitch)); NET.vyaw *= 0.94; NET.vpitch *= 0.94; }
    const cyw = Math.cos(NET.yaw), syw = Math.sin(NET.yaw), cp = Math.cos(NET.pitch), sp = Math.sin(NET.pitch);
    const proj = (o) => { const x = o.x * cyw + o.z * syw; let z = -o.x * syw + o.z * cyw; const y = o.y * cp - z * sp; z = o.y * sp + z * cp; const f = 3.4 / (3.4 - z); return [cx + x * R * f, cy + y * R * f, z, f, x]; };
    const P = nodes.map(proj); NET.P = P;
    // ---- eventos: etapa concluída, site novo
    for (let i = 0; i < ns; i++) { const s = T.steps[i].s; if (prevS[i] && prevS[i] !== s && s === 'ok' && run) nodes.filter((nd) => visN(nd.i) && nd.g % n === i).slice(0, 5).forEach((nd) => burstAt(nd.i, now)); prevS[i] = s; }
    for (let j = 0; j < T.sites.length; j++) if (NET.sn[j] == null) {
      const surf = nodes.filter((nd) => !nd.in && nd.site < 0 && visN(nd.i)), front = surf.filter((nd) => P[nd.i][2] > 0.15), pool = front.length ? front : surf;
      if (pool.length) { const nd = pool[Math.floor(hash01(`${T.sites[j]}${j}`) * pool.length)]; nd.site = j; NET.sn[j] = nd.i; NET.born[j] = run ? now : now - 1e4; if (run) burstAt(nd.i, now); }
    }
    // ---- brilho de cada nó
    const base = 0.5 + 0.5 * pg, bloom = endStart && okEnd ? Math.max(0, 1 - (now - endStart) / 1400) : 0;
    for (let i = 0; i < NET.lit.length; i++) NET.lit[i] = Math.max(0, NET.lit[i] - lastDt * 1.5);
    const AP = nodes.map((nd) => (nd.bornAt == null ? 0 : ease(Math.min(1, (now - nd.bornAt) / 650))));
    const B = nodes.map((nd) => { const st = T.steps[nd.g % n]; let b = base; if (st) { if (st.s === 'ok') b += 0.12; else if (st.s === 'act') b += 0.3 * (0.6 + 0.4 * Math.sin(tm / 260 + nd.ph)); } return Math.min(1.25, b + NET.lit[nd.i] * 0.8 + bloom * 0.6 + (nd.site >= 0 ? 0.25 : 0)) * AP[nd.i] * (tn.gain || 1); });
    const hueOf = (x) => tn.h0 + ((x + 1) / 2) * tn.span, hMid = tn.h0 + tn.span / 2;
    // ---- brilho de fundo da esfera (cresce com a montagem)
    const halo = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.75); halo.addColorStop(0, `hsla(${hMid},90%,60%,${0.1 * revF})`); halo.addColorStop(0.55, `hsla(${hMid},90%,55%,${0.1 * revF})`); halo.addColorStop(1, `hsla(${hMid},90%,50%,0)`);
    c.fillStyle = halo; c.fillRect(0, 0, W, H);
    // ---- sinais espontâneos
    if (run && !reduced) {
      const last = emitAt.get('r') || 0, gap = ai >= 0 ? 85 : 200;
      if (now - last > gap && rv > 1) {
        emitAt.set('r', now); let from = -1;
        if (ai >= 0) { const grp = nodes.filter((nd) => visN(nd.i) && nd.g % n === ai); if (grp.length) from = grp[Math.floor(Math.random() * grp.length)].i; }
        if (from < 0) { const vis = nodes.filter((nd) => visN(nd.i)); from = vis[Math.floor(Math.random() * vis.length)].i; }
        const opts = NET.adj[from].filter(visE); if (opts.length) spawn(opts[Math.floor(Math.random() * opts.length)], from, now, 0);
      }
    }
    if (bloom > 0.95 && !reduced) for (let k = 0; k < 30; k++) { const e = Math.floor(Math.random() * NET.E.length); if (visE(e)) spawn(e, NET.E[e][0], now, 2); }
    // ================= camada da esfera (recebe o brilho) =================
    const main = c; c = NET.LC; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    try {
      c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      // conexões: nascem do nó mais antigo para o mais novo
      for (let ei = 0; ei < NET.E.length; ei++) {
        let [a, b] = NET.E[ei]; if (!visE(ei)) continue;
        if (nodes[a].ord > nodes[b].ord) [a, b] = [b, a];
        const g = ease(Math.min(1, (now - Math.max(nodes[a].bornAt, nodes[b].bornAt)) / 800)), pa = P[a], pb = P[b], d = ((pa[2] + pb[2]) / 2 + 1) / 2, al = (0.1 + 0.52 * d) * ((B[a] + B[b]) / 2);
        if (al < 0.02) continue;
        const ex = pa[0] + (pb[0] - pa[0]) * g, ey = pa[1] + (pb[1] - pa[1]) * g, hue = hueOf((pa[4] + pb[4]) / 2), lw = 0.6 + d * 1.0, inner = nodes[a].in || nodes[b].in;
        c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(ex, ey);
        c.strokeStyle = `hsla(${hue},85%,${60 + d * 16}%,${Math.min(0.9, al) * (inner ? 0.7 : 1)})`; c.lineWidth = lw; c.stroke();
      }
      // poeira de luz dentro da esfera
      const dn = Math.floor(NET.dust.length * revF);
      for (let i = 0; i < dn; i++) {
        const o = NET.dust[i], t = tm / 1000, q = { x: o.x + Math.sin(t * o.sp + o.ph) * 0.03, y: o.y + Math.cos(t * o.sp * 0.8 + o.ph) * 0.03, z: o.z }, p = proj(q), d = (p[2] + 1) / 2, tw = 0.5 + 0.5 * Math.sin(t * 2.2 * o.sp + o.ph * 3);
        c.fillStyle = `hsla(${hueOf(p[4])},90%,82%,${(0.12 + 0.55 * d) * tw * (0.4 + 0.6 * base)})`; const s = 0.7 + d * 0.9 + (i % 9 === 0 ? 0.8 : 0); c.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
      }
      // pulsos
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i], t = (now - p.t0) / p.d, [a, b] = NET.E[p.e], to = p.from === a ? b : a;
        if (t >= 1) { NET.lit[to] = Math.max(NET.lit[to], 0.9); if (p.gen < 3 && Math.random() < 0.7) { const opts = NET.adj[to].filter((e) => e !== p.e && visE(e)); if (opts.length) spawn(opts[Math.floor(Math.random() * opts.length)], to, now, p.gen + 1); } parts.splice(i, 1); continue; }
        if (!visE(p.e)) { parts.splice(i, 1); continue; }
        const A = P[p.from], Bp = P[to], x = A[0] + (Bp[0] - A[0]) * t, y = A[1] + (Bp[1] - A[1]) * t, d = ((A[2] + Bp[2]) / 2 + 1) / 2, s = 12 * ((A[3] + Bp[3]) / 2) * (R / 130);
        c.globalAlpha = 0.4 + 0.6 * d; c.drawImage(sprite(hueOf((A[4] + Bp[4]) / 2)), x - s, y - s, s * 2, s * 2);
      }
      c.globalAlpha = 1;
      // nós, do fundo para a frente
      c.font = '8px ui-monospace, Menlo, Consolas, monospace'; c.textAlign = 'left';
      const order = nodes.map((_, i) => i).filter((i) => AP[i] > 0).sort((a, b) => P[a][2] - P[b][2]);
      for (const i of order) {
        const nd = nodes[i], p = P[i], d = (p[2] + 1) / 2, k = R / 130, ap = AP[i];
        const size = (nd.in ? 4.6 : 6.3) * p[3] * k * (nd.hub ? 2.1 : 1) * (nd.site >= 0 ? 1.5 : 1) * (1 + NET.lit[i] * 0.6) * (0.4 + 0.6 * ap) * (1 + (1 - ap) * 0.5), sp2 = sprite(hueOf(p[4]));
        c.globalAlpha = Math.min(1, (0.3 + 0.7 * d) * B[i]); c.drawImage(sp2, p[0] - size * 2, p[1] - size * 2, size * 4, size * 4);
        c.globalAlpha = Math.min(1, (0.25 + 0.75 * d) * B[i]); c.drawImage(sp2, p[0] - size * 1.1, p[1] - size * 1.1, size * 2.2, size * 2.2);
        if (nd.hub || nd.site >= 0) { c.globalAlpha = Math.min(1, (0.2 + 0.8 * d) * B[i]); c.drawImage(sp2, p[0] - size * 0.7, p[1] - size * 0.7, size * 1.4, size * 1.4); }
        if (nd.txt && (nd.in || nd.hub) && nd.site < 0) { c.globalAlpha = 0.6 * d * B[i]; c.fillStyle = `hsl(${hueOf(p[4])},90%,86%)`; c.fillText(nd.txt, p[0] + size * 1.5, p[1] - size * 0.6); }
      }
      c.globalAlpha = 1;
      // sites: anéis
      for (let j = 0; j < T.sites.length; j++) {
        const ni = NET.sn[j]; if (ni == null) continue; const nd = nodes[ni], p = P[ni], d = (p[2] + 1) / 2, k = R / 130, size = 5.2 * p[3] * k * 1.5 * (nd.hub ? 1.9 : 1), age = (now - (NET.born[j] || now)) / 1000;
        if (d < 0.3) continue;
        const hue = hueOf(p[4]); c.lineWidth = 1.3;
        c.beginPath(); c.arc(p[0], p[1], size * 1.7, 0, TAU); c.strokeStyle = `hsla(${hue},95%,80%,${0.5 * d})`; c.stroke();
        if (age < 1.2) { c.beginPath(); c.arc(p[0], p[1], size * (1.7 + age * 4), 0, TAU); c.strokeStyle = `hsla(${hue},95%,85%,${(1 - age / 1.2) * 0.75})`; c.stroke(); }
      }
    } finally { c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c = main; }
    // ---- brilho (bloom) + camada nítida
    const b1 = NET.B1.getContext('2d'), b2 = NET.B2.getContext('2d'); b1.imageSmoothingQuality = b2.imageSmoothingQuality = 'high';
    b1.clearRect(0, 0, NET.B1.width, NET.B1.height); b1.drawImage(NET.L, 0, 0, NET.B1.width, NET.B1.height);
    b2.clearRect(0, 0, NET.B2.width, NET.B2.height); b2.drawImage(NET.B1, 0, 0, NET.B2.width, NET.B2.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.95; c.drawImage(NET.B1, 0, 0, W, H); c.globalAlpha = 0.8; c.drawImage(NET.B2, 0, 0, W, H); c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over'; c.drawImage(NET.L, 0, 0, W, H);
    // ---- rótulos (fora do brilho, nítidos)
    const tag = (txt, x, y) => { font(500, 11); const w = c.measureText(txt).width + 12, x0 = Math.max(4, Math.min(W - w - 4, x - w / 2)); y = Math.max(14, y); c.fillStyle = 'rgba(6,8,26,.72)'; c.beginPath(); c.roundRect(x0, y - 11, w, 17, 8); c.fill(); c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 1; c.stroke(); c.fillStyle = '#f2f4ff'; c.textAlign = 'center'; c.fillText(txt, x0 + w / 2, y + 1.5); };
    for (let j = 0; j < T.sites.length; j++) {
      const ni = NET.sn[j]; if (ni == null) continue; const nd = nodes[ni], p = P[ni], d = (p[2] + 1) / 2, k = R / 130, size = 5.2 * p[3] * k * 1.5 * (nd.hub ? 1.9 : 1), age = (now - (NET.born[j] || now)) / 1000;
      if (d < 0.3) continue;
      if ((hov && hov.k === `s${j}`) || (age < 1.8 && j >= T.sites.length - 2)) tag(short(T.sites[j], 26), p[0], p[1] - size * 2.2 - 6);
      hit.push({ k: `s${j}`, x: p[0], y: p[1], R: size * 2.6 + 4, txt: `Site consultado: ${T.sites[j]}` });
    }
    const lab = ai >= 0 ? T.steps[ai].t : T.ended ? (okEnd ? 'Resposta pronta' : '') : '';
    if (lab) tag(short(lab, 30), W / 2, H - 34);
    const gap = 15, x0 = W / 2 - ((n - 1) * gap) / 2, yy = H - 14;
    for (let i = 0; i < n; i++) {
      const r = T.steps[i], x = x0 + i * gap, hu = hueOf(0.2 + (i / n) * 0.6);
      if (!r) { dot(x, yy, 2.4, 'rgba(255,255,255,.22)'); continue; }
      if (r.s === 'act' && !reduced) dot(x, yy, 5.5 + (Math.sin(tm / 300) + 1) * 1.6, null, `hsla(${hu},95%,80%,.45)`, 1.5);
      dot(x, yy, r.s === 'act' ? 3.6 : 3, r.s === 'err' ? col.red : `hsl(${hu},95%,${r.s === 'ok' ? 72 : 85}%)`);
      hit.push({ k: `n${i}`, x, y: yy, R: 8, txt: r.d ? `${r.t}: ${r.d}` : r.t });
    }
  }

  /* ---------- Esfera WebGL (Three.js): mesmo enredo, desenhada pelo renderizador compartilhado ---------- */
  const GS = { ready: false, gv: -1, rev: 0, yaw: 0.6, pitch: 0.22, vyaw: 0, vpitch: 0, drag: false, scale: 1, scaleV: 0, kick: 0, clk: 0, w0: [-100, -100, -100], slot: 0, nd: null, ld: null, mark: null, dirty: true, sn: [], sawRun: false, fin: false, lastAuto: 0, hover: -1, scr: null, later: [], endGlow: 0, born: {} };
  const sphR = () => Math.min(H * 0.35, W * 0.3);
  const Vtmp = () => (Vtmp.v || (Vtmp.v = new THREE.Vector3()));
  function initGS() {
    const G = Orb.G;
    GS.nd = new Float32Array(G.N * 3).fill(999); GS.ld = new Float32Array(G.E * 6).fill(999); GS.mark = new Float32Array(G.N);
    GS.w0 = [-100, -100, -100]; GS.sn = []; GS.born = {}; GS.later = []; GS.hover = -1; GS.scr = new Float32Array(G.N * 3); GS.gv = Orb.gv; GS.ready = true; GS.dirty = true;
  }
  const glFront = () => { // nós revelados do lado de quem olha
    const G = Orb.G, lim = GS.rev - 3, a = [], b = [];
    for (const nd of G.nodes) if (nd.outer && nd.ord < lim) { b.push(nd.i); if (GS.scr[nd.i * 3 + 2] > 0.25) a.push(nd.i); }
    const pool = a.length ? a : b; return pool.length ? pool[Math.floor(Math.random() * pool.length)] : G.core;
  };
  function pulseAt(origin, kick = 0.9) {
    const G = Orb.G, N = G.N, d = new Float32Array(N).fill(999); d[origin] = 0; const q = [origin];
    for (let h = 0; h < q.length; h++) { const a = q[h]; for (const b of G.adj[a]) if (d[b] === 999) { d[b] = d[a] + 1; q.push(b); } }
    const s = (GS.slot = (GS.slot + 1) % 3);
    for (let i = 0; i < N; i++) GS.nd[i * 3 + s] = d[i];
    G.edges.forEach(([a, b], i) => { GS.ld[i * 6 + s] = d[a]; GS.ld[i * 6 + 3 + s] = d[b]; });
    GS.w0[s] = GS.clk; GS.kick += kick; GS.dirty = true;
  }
  function drawGL(now) {
    Orb.ensure(); const G = Orb.G; if (!G) return;
    if (GS.gv !== Orb.gv) initGS();
    const n = N(), ai = actIdx(), run = running(), REV = G.rev, nodes = G.nodes;
    if (run) GS.sawRun = true;
    const okEnd = T.ended && (T.kind === 'ok' || !T.kind), instant = reduced || opts.preview || (T.ended && !GS.sawRun);
    const score = okEnd ? 1 : Math.min(1, pg * 0.72 + Math.min(0.28, T.sites.length * 0.035 + T.think.length * 0.03)), tgt = REV * Math.min(1, 0.045 + 0.955 * score);
    if (instant) GS.rev = opts.preview || okEnd ? REV : tgt;
    else if (GS.rev < tgt) GS.rev = Math.min(tgt, GS.rev + Math.max((tgt - GS.rev) * lastDt * 1.4, lastDt * (T.ended ? 28 : 1.8)));
    GS.clk += lastDt;
    // ---- eventos do agente viram pulsos
    for (let i = 0; i < T.steps.length; i++) {
      const s = T.steps[i].s;
      if (prevS[i] && prevS[i] !== s && s === 'ok' && run) {
        const grp = nodes.filter((nd) => nd.outer && nd.ord < GS.rev - 3 && nd.g % n === i); pulseAt(grp.length ? grp[Math.floor(Math.random() * grp.length)].i : glFront(), 0.8);
      }
      prevS[i] = s;
    }
    for (let j = 0; j < T.sites.length; j++) if (GS.sn[j] == null) {
      const used = new Set(GS.sn), ok = nodes.filter((nd) => nd.outer && nd.ord < GS.rev - 3 && !used.has(nd.i)), fr = ok.filter((nd) => GS.scr[nd.i * 3 + 2] > 0.2), pool = fr.length ? fr : ok;
      if (pool.length) { const nd = pool[Math.floor(hash01(`${T.sites[j]}${j}`) * pool.length)]; GS.sn[j] = nd.i; GS.mark[nd.i] = 1; GS.born[j] = run ? GS.clk : -10; GS.dirty = true; if (run) pulseAt(nd.i, 1.1); }
    }
    if (OS.auto && run && !reduced && GS.rev > 6 && GS.clk - GS.lastAuto > (ai >= 0 ? 1.25 : 2.1)) { GS.lastAuto = GS.clk; pulseAt(glFront(), 0.35); }
    if (opts.preview && !reduced && GS.clk - GS.lastAuto > 2.6) { GS.lastAuto = GS.clk; pulseAt(glFront(), 0.5); }
    if (okEnd && endStart && GS.sawRun && !GS.fin) { GS.fin = true; GS.endGlow = 1; pulseAt(G.core, 1.1); GS.later.push([GS.clk + 0.55, () => pulseAt(glFront(), 0.6)]); }
    for (let i = GS.later.length - 1; i >= 0; i--) if (GS.clk >= GS.later[i][0]) { GS.later[i][1](); GS.later.splice(i, 1); }
    GS.endGlow = Math.max(0, GS.endGlow - lastDt / 1.4);
    // ---- movimento: giro, inércia e a mola do "chute" dos pulsos
    if (!reduced && !GS.drag) { GS.yaw += lastDt * OS.rot * 0.6 + GS.vyaw; GS.pitch = Math.max(-1.1, Math.min(1.1, GS.pitch + GS.vpitch)); GS.vyaw *= 0.94; GS.vpitch *= 0.94; }
    GS.scaleV += GS.kick * 0.12; GS.kick = 0; GS.scaleV += (1 - GS.scale) * 28 * lastDt; GS.scaleV *= Math.pow(0.02, lastDt); GS.scale += GS.scaleV * lastDt;
    const R = sphR(), base = 0.72 + 0.28 * pg, hv = hov && hov.node != null ? hov.node : -1;
    GS.hover = hv;
    Orb.render(GS, { W, H, R, ai, n, base, fin: GS.endGlow });
    Orb.stamp = now;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(Orb.cv, 0, 0, W, H);
    // ---- posição de cada nó na tela (para sites, passar o mouse e clicar)
    const v = Vtmp(), cam = Orb.camera, tt = GS.clk, br = reduced ? 0 : OS.breath;
    Orb.group.updateMatrixWorld(true);
    for (let i = 0; i < G.N; i++) {
      const p = nodes[i].p, w = Math.sin(tt * 1.1 + p.x * 3.1 + p.y * 2.3 + p.z * 1.7) * 0.6 + Math.sin(tt * 0.63 + p.y * 4 - p.z * 2) * 0.4, k = 1 + br * 0.035 * w;
      v.set(p.x * k, p.y * k, p.z * k).applyMatrix4(Orb.group.matrixWorld); const zr = v.z / Math.max(0.01, GS.scale); v.project(cam);
      GS.scr[i * 3] = (v.x * 0.5 + 0.5) * W; GS.scr[i * 3 + 1] = (-v.y * 0.5 + 0.5) * H; GS.scr[i * 3 + 2] = zr;
    }
    const kPx = R * OS.size / 105;
    // ---- sites: anel e etiqueta
    const tagGL = (txt, x, y) => { font(500, 11); const w = c.measureText(txt).width + 12, x0 = Math.max(4, Math.min(W - w - 4, x - w / 2)); y = Math.max(14, y); c.fillStyle = 'rgba(6,8,14,.78)'; c.beginPath(); c.roundRect(x0, y - 11, w, 17, 8); c.fill(); c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 1; c.stroke(); c.fillStyle = '#f2f4ff'; c.textAlign = 'center'; c.fillText(txt, x0 + w / 2, y + 1.5); };
    c.globalCompositeOperation = 'lighter';
    for (let j = 0; j < T.sites.length; j++) {
      const ni = GS.sn[j]; if (ni == null) continue; const x = GS.scr[ni * 3], y = GS.scr[ni * 3 + 1], z = GS.scr[ni * 3 + 2], d = (z + 1) / 2, age = GS.clk - GS.born[j], rr = (nodes[ni].size > 11 ? 15 : 9.5) * kPx;
      if (d < 0.3) continue;
      c.lineWidth = 1.3; c.beginPath(); c.arc(x, y, rr, 0, TAU); c.strokeStyle = `rgba(255,240,215,${0.55 * d})`; c.stroke();
      if (age >= 0 && age < 1.2) { c.beginPath(); c.arc(x, y, rr * (1 + age * 2.4), 0, TAU); c.strokeStyle = `rgba(255,240,215,${(1 - age / 1.2) * 0.8})`; c.stroke(); }
    }
    c.globalCompositeOperation = 'source-over';
    for (let j = 0; j < T.sites.length; j++) {
      const ni = GS.sn[j]; if (ni == null) continue; const x = GS.scr[ni * 3], y = GS.scr[ni * 3 + 1], d = (GS.scr[ni * 3 + 2] + 1) / 2, age = GS.clk - GS.born[j], rr = (nodes[ni].size > 11 ? 15 : 9.5) * kPx;
      if (d < 0.3) continue;
      if ((hov && hov.k === `s${j}`) || (age >= 0 && age < 1.8 && j >= T.sites.length - 2)) tagGL(short(T.sites[j], 26), x, y - rr - 8);
      hit.push({ k: `s${j}`, x, y, R: rr + 5, txt: `Site consultado: ${T.sites[j]}` });
    }
    if (opts.preview) return;
    const lab = ai >= 0 ? T.steps[ai].t : T.ended ? (okEnd ? 'Resposta pronta' : '') : '';
    if (lab) tagGL(short(lab, 30), W / 2, H - 34);
    const gap = 15, x0 = W / 2 - ((n - 1) * gap) / 2, yy = H - 14, hu = (i) => (212 + OS.hue + (i / n) * 50 + 360) % 360;
    for (let i = 0; i < n; i++) {
      const r = T.steps[i], x = x0 + i * gap;
      if (!r) { dot(x, yy, 2.4, 'rgba(255,255,255,.22)'); continue; }
      if (r.s === 'act' && !reduced) dot(x, yy, 5.5 + (Math.sin(GS.clk * 3.3) + 1) * 1.6, null, `hsla(${hu(i)},95%,80%,.45)`, 1.5);
      dot(x, yy, r.s === 'act' ? 3.6 : 3, r.s === 'err' ? col.red : `hsl(${hu(i)},95%,${r.s === 'ok' ? 72 : 85}%)`);
      hit.push({ k: `n${i}`, x, y: yy, R: 8, txt: r.d ? `${r.t}: ${r.d}` : r.t });
    }
  }
  function pickNode(x, y) { // nó mais próximo do ponteiro (desempata pelo que está mais à frente)
    const G = Orb.G; if (!G || !GS.scr || GS.gv !== Orb.gv) return -1;
    let best = -1, bs = 1e9; const lim = GS.rev - 3;
    for (let i = 0; i < G.N; i++) {
      if (G.nodes[i].ord > lim) continue;
      const dx = GS.scr[i * 3] - x, dy = GS.scr[i * 3 + 1] - y, d = Math.hypot(dx, dy), rad = 6 + G.nodes[i].size * 0.5 * (sphR() / 105);
      if (d > rad) continue; const s = d - GS.scr[i * 3 + 2] * 5; if (s < bs) { bs = s; best = i; }
    }
    return best;
  }

  function draw(now) {
    if (!W || !H) return;
    if (!col || nf++ % 90 === 0) {
      const s = getComputedStyle(document.documentElement), g = (n) => s.getPropertyValue(n).trim();
      col = { gold: g('--gold'), green: g('--green'), red: g('--red'), line: g('--line-forte'), muted: g('--muted'), strong: g('--text-forte'), panel: g('--panel'), bg: g('--void') };
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); hit = []; c.textAlign = 'center'; c.lineCap = 'butt';
    if (OS.mode === 'off') return;
    if (useGL()) drawGL(now); else drawRede(now);
  }
  function capUpdate() {
    const want = hov ? hov.txt : opts.preview ? 'Arraste para girar. Clique em um nó para disparar um pulso.' : T.ended ? (T.kind === 'ok' || !T.kind ? `Concluído: ${T.steps.length} etapas e ${T.sites.length} sites. Passe o mouse sobre um ponto para ver os detalhes.` : 'Execução encerrada.') : (T.lastThought || 'Começando…');
    if (want !== capTxt) { capTxt = want; cap.textContent = want; }
  }
  let lastDraw = 0, slowN = 0;
  function frame(now) {
    raf = 0;
    if (document.hidden || !act.open) return;
    if (OS.mode === 'off') { capUpdate(); return; }
    if (!opts.preview && orbDlg && orbDlg.open) return;
    const gl = useGL(), minGap = 1000 / Math.min(OS.fps || 60, gl ? 60 : 30);
    if (lastDraw && now - lastDraw < minGap - 3) { raf = requestAnimationFrame(frame); return; }
    if (gl && Orb.stamp === now) { raf = requestAnimationFrame(frame); return; } // um quadro WebGL por vez
    const raw = lastNow ? (now - lastNow) / 1000 : 0.016, dt = Math.min(0.1, raw); lastNow = now; lastDraw = now; lastDt = dt;
    if (gl && !opts.preview && running() && !navigator.webdriver) { slowN = raw > (1 / Math.min(OS.fps, 60)) * 2.4 ? slowN + 1 : Math.max(0, slowN - 1); if (slowN > 40) { slowN = 0; Orb.degrade(); } }
    tm = T.ended && endStart ? Math.min(now, endStart + 1400) : now;
    if (T.ended && !GS.sawRun && !NET.sawRun) pg = progress(); else pg += (progress() - pg) * Math.min(1, dt * 4);
    heat = Math.max(0, heat - dt * 0.6);
    draw(now); capUpdate();
    const alive = !T.ended || now < endAt || parts.length || (gl ? Math.abs(GS.vyaw) > 0.0005 || GS.clk - Math.max(...GS.w0) < 3.5 || GS.later.length > 0 || Math.abs(GS.scale - 1) > 0.002 || Math.abs(GS.scaleV) > 0.01 : NET.ready && Math.abs(NET.vyaw) > 0.0005);
    if (!reduced && alive) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  if (sw) {
    sw.innerHTML = `<span class="live-t">Esfera neural</span><span class="live-sp"></span><button type="button" class="live-cfg" aria-haspopup="dialog" title="Configurações do nó">${ic('sliders')}Ajustar</button>`;
    sw.addEventListener('click', (e) => { const b = e.target.closest('.live-cfg'); if (b) orbCfgOpen(b); });
  }
  const paintMode = () => { cv.style.display = OS.mode === 'off' ? 'none' : ''; hov = null; capTxt = null; kick(); };
  const ro = new ResizeObserver(() => { dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); kick(); }); ro.observe(cv);
  act.addEventListener('toggle', kick); document.addEventListener('visibilitychange', kick);
  const ST = () => (useGL() ? GS : NET), ready = () => (useGL() ? GS.ready : NET.ready);
  let dx0 = 0, dy0 = 0, mv = 0;
  cv.addEventListener('pointerdown', (e) => { const S = ST(); S.drag = true; dx0 = e.clientX; dy0 = e.clientY; mv = 0; S.vyaw = 0; S.vpitch = 0; cv.setPointerCapture(e.pointerId); });
  const drop = (e) => {
    NET.drag = GS.drag = false;
    if (e.type !== 'pointerup' || mv >= 6 || reduced) return;
    if (useGL() && GS.ready) { const b = cv.getBoundingClientRect(), i = pickNode(e.clientX - b.left, e.clientY - b.top); pulseAt(i >= 0 ? i : glFront(), 0.9); kick(); }
    else if (NET.ready) { const vis = NET.nodes.filter((nd) => nd.bornAt != null); if (vis.length) { burstAt(vis[Math.floor(Math.random() * vis.length)].i, performance.now()); kick(); } }
  };
  cv.addEventListener('pointerup', drop); cv.addEventListener('pointercancel', drop);
  cv.addEventListener('pointermove', (e) => {
    const S = ST();
    if (S.drag && ready()) { const ddx = e.clientX - dx0, ddy = e.clientY - dy0; mv += Math.abs(ddx) + Math.abs(ddy); dx0 = e.clientX; dy0 = e.clientY; S.yaw += ddx * 0.008; S.pitch = Math.max(-1.1, Math.min(1.1, S.pitch + ddy * 0.006)); S.vyaw = ddx * 0.0009; S.vpitch = 0; kick(); return; }
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    let best = null, bd = 1e9;
    for (const h of hit) { if (h.w) continue; const d = Math.hypot(h.x - x, h.y - y); if (d < h.R && d < bd) { bd = d; best = h; } }
    if (!best) for (const h of hit) if (h.w && x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) { best = h; break; }
    if (!best && useGL() && GS.ready) { const i = pickNode(x, y); if (i >= 0) { const nd = Orb.G.nodes[i]; best = { k: `g${i}`, node: i, txt: `nó ${String(i).padStart(3, '0')} · ${Orb.G.adj[i].length} conexões${nd.outer ? '' : ' · núcleo'}` }; } }
    if ((best && best.k) !== (hov && hov.k)) { hov = best; kick(); }
  });
  cv.addEventListener('pointerleave', () => { hov = null; kick(); });
  if (opts.preview) endAt = Infinity;
  const api = {
    root, preview: !!opts.preview, kick,
    refresh() { paintMode(); },
    pulse() { if (useGL()) { Orb.ensure(); if (GS.gv !== Orb.gv) initGS(); pulseAt(glFront(), 0.9); } kick(); },
    end() { endStart = performance.now(); endAt = endStart + 1400; kick(); },
    destroy() { LIVE.set.delete(api); cancelAnimationFrame(raf); raf = 0; ro.disconnect(); },
  };
  LIVE.set.add(api); paintMode();
  return api;
}

let escolhido = false;
try { escolhido = localStorage.getItem(ORB_KEY) !== null; } catch { /* sem armazenamento */ }
window.addEventListener('esfera-ajustada', () => { escolhido = true; });
window.Esfera = {
  criar: (T, raiz, opcoes = {}) => liveGraph(T, raiz, opcoes),
  abrirAjustes: (botao) => orbCfgOpen(botao),
  modo: () => OS.mode,
  definirModo(m) {
    if (!['alto', 'leve', 'off'].includes(m)) return;
    OS.mode = m; Orb.forced = false; Orb.deg = 1; escolhido = true; saveOS(); liveAll((g) => g.refresh('mode'));
  },
  // o padrão do hardware (fraco: desligada) só vale enquanto o usuário não mexeu em nada
  padrao(m) {
    if (escolhido || !['alto', 'leve', 'off'].includes(m)) return;
    OS.mode = m; liveAll((g) => g.refresh('mode'));
  },
  get webgl() { return Orb.st > 0 ? 'ativo' : Orb.st < 0 ? 'indisponível' : 'não iniciado'; },
};
})();
