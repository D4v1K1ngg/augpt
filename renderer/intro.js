// Abertura do AuGPT — ver o comentário de renderer/intro.html.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const intro = $('intro'), stage = $('stage'), box = $('box'), glc = $('gl'), logo = $('logo'),
        frame = $('frame'), frameRect = $('frameRect'),
        hint = $('hint'), flash = $('flash'), fx = $('fx'), fctx = fx.getContext('2d'),
        sheenG = $('gSheen'), tag = $('tag');
  const pHex = $('pHex'), pA = $('pA'), pBar = $('pBar'), nApex = $('nApex'), n1 = $('n1'), n2 = $('n2');
  const letters = [...document.querySelectorAll('#word span')];
  const word = $('word');

  const QS = new URLSearchParams(location.search);
  const MUDO = QS.has('mudo');
  const VOL = QS.has('vol') && isFinite(parseFloat(QS.get('vol'))) ? Math.min(1.5, Math.max(0, parseFloat(QS.get('vol')))) : 1;
  const IMPACT = 3.1, DUR = 6.3, S = 240, R0 = 30;

  /* brilho que varre a logo depois de desenhada */
  const sheenEls = [pHex, pA, pBar].map(p => {
    const c = p.cloneNode(true);
    c.removeAttribute('id');
    c.style.stroke = 'url(#gSheen)'; c.style.strokeDasharray = 'none'; c.style.strokeDashoffset = '0'; c.style.opacity = '0';
    p.parentNode.appendChild(c);
    return c;
  });

  /* ---------- aviso para o app (electron/abertura.js lê o título da janela) ---------- */
  const avisados = new Set();
  const sinalizar = (nome) => { if (avisados.has(nome)) return; avisados.add(nome); document.title = 'augpt:intro-' + nome; };

  /* ---------- utilitários ---------- */
  const clamp = x => Math.min(1, Math.max(0, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const E = {
    out3: x => 1 - Math.pow(1 - x, 3),
    io3: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
    outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    ioExpo: x => x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2
  };

  /* ---------- WebGL: nebulosa quente, brasas, raios, onda de choque, grão ---------- */
  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `
  precision highp float;
  uniform vec2 uView,uBox; uniform float uDpr,uTime,uP,uGlow,uLogo;
  float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
  float embers(vec2 uv,float t){
    float s=0.;
    for(int i=0;i<3;i++){
      float fi=float(i);
      vec2 g=uv*(5.+fi*3.5);
      g.y-=t*(.35+.12*fi);
      vec2 id=floor(g),f=fract(g)-.5;
      float r=h(id+fi*13.7);
      vec2 o=vec2(r-.5,fract(r*7.)-.5)*.6;
      o.x+=sin(t*1.4+r*30.)*.12;
      float d=length(f-o);
      float tw=.5+.5*sin(t*4.+r*50.);
      s+=step(.8,r)*smoothstep(.09,.0,d)*tw;
    }
    return s;
  }
  float ringf(float r,float rr,float w){float x=(r-rr)*w;return exp(-x*x);}
  void main(){
    vec2 P=gl_FragCoord.xy/uDpr-.5*uView;
    float sc=mix(240.,max(uView.x,uView.y)*.8,uP);
    vec2 p=P/sc;
    float r=length(p);
    vec3 ember=vec3(.91,.42,.25),amber=vec3(.96,.70,.42),rust=vec3(.45,.17,.09);
    vec3 col=vec3(.035,.025,.02);
    vec2 q=p*3.;
    float a=fbm(q+vec2(uTime*.12,-uTime*.1));
    float b=fbm(q*1.5-vec2(uTime*.1,uTime*.16)+a*1.6);
    float en=.55+uLogo*.5+uGlow*1.3+uP*.5;
    col+=mix(rust,ember,b)*(a*a)*en*1.5;
    col+=mix(ember,amber,.5)*exp(-r*r*(14.-uGlow*8.))*(.2*uLogo+uGlow*1.1);
    float ang=atan(p.y,p.x);
    float rs=.5+.5*sin(ang*13.+uTime*.5+a*3.);
    float rays=rs*rs*rs*rs*rs*exp(-r*1.5);
    col+=amber*rays*(uGlow*.9+uP*(1.-uP)*1.6);
    col+=amber*embers(p,uTime)*(.5+uLogo*.5)*(1.-uP*.4)*1.1;
    vec2 bh=uBox*.5/sc;
    float d=max(abs(p.x)-bh.x,abs(p.y)-bh.y);
    col+=ember*exp(d*22.)*(.10+uP*(1.-uP)*3.);
    float rr=length(bh)*(.2+.9*uP);
    float wv=uP*(1.-uP)*3.;
    col+=vec3(ringf(r,rr*1.04,12.),ringf(r,rr,12.),ringf(r,rr*.96,12.))*amber*wv;
    col*=(1.-smoothstep(.2,1.6,r))*.9+.1;
    col=1.-exp(-col*1.3);
    col+=(h(gl_FragCoord.xy+fract(uTime)*91.7)-.5)*.045;
    gl_FragColor=vec4(col,1.);
  }`;

  let gl = null, U = {}, dpr = 1;
  function initGL() {
    try {
      gl = glc.getContext('webgl', { antialias: false, alpha: false }) || glc.getContext('experimental-webgl');
      if (!gl) throw 0;
      const mk = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); throw 0; }
        return s;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw 0;
      gl.useProgram(pr);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['uView', 'uBox', 'uDpr', 'uTime', 'uP', 'uGlow', 'uLogo'].forEach(k => U[k] = gl.getUniformLocation(pr, k));
      resize();
    } catch (e) {
      gl = null;
      box.style.background = 'radial-gradient(circle at 50% 50%,#4a2414 0%,#150f0b 70%)';
    }
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    glc.width = Math.round(innerWidth * dpr);
    glc.height = Math.round(innerHeight * dpr);
    if (gl) gl.viewport(0, 0, glc.width, glc.height);
    const d2 = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = Math.round(innerWidth * d2);
    fx.height = Math.round(innerHeight * d2);
    fctx.setTransform(d2, 0, 0, d2, 0, 0);
  }
  addEventListener('resize', resize);

  /* ---------- Partículas 2D (brasas flutuando + faíscas no impacto) ---------- */
  let parts = [], lastT = 0, burst = false;
  const COLS = [[255, 190, 110], [240, 120, 70], [255, 235, 210]];
  function addPart(o) { if (parts.length < 900) parts.push(o); }
  function drawFx(t, w, h) {
    const dt = Math.min(.05, Math.max(0, t - lastT)); lastT = t;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    fctx.clearRect(0, 0, innerWidth, innerHeight);

    if (t > .4 && t < 5.2) {
      const rate = t < IMPACT ? 45 : (t < 4.2 ? 22 : 12);
      const k = Math.floor(rate * dt + Math.random());
      for (let i = 0; i < k; i++) {
        addPart({ x: cx + (Math.random() - .5) * w * 1.05, y: cy + (Math.random() - .5) * h * 1.05,
          vx: rnd(-10, 10), vy: -rnd(25, 85), age: 0, life: rnd(1.4, 3.2), size: rnd(.8, 2.2),
          drag: 0, grav: 0, kind: 1, c: COLS[(Math.random() * 3) | 0] });
      }
    }
    if (t >= IMPACT && !burst) {
      burst = true;
      for (let i = 0; i < 220; i++) {
        const a = Math.random() * Math.PI * 2, sp = rnd(250, 1700);
        addPart({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: rnd(.6, 1.9),
          size: rnd(1.2, 3.2), drag: 1.7, grav: 260, kind: 0, c: COLS[(Math.random() * 3) | 0] });
      }
    }
    fctx.globalCompositeOperation = 'lighter';
    fctx.lineCap = 'round';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      const f = Math.max(0, 1 - p.drag * dt);
      p.vx *= f; p.vy = p.vy * f + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.age / p.life;
      const al = p.kind ? Math.sin(Math.PI * k) * .9 : Math.pow(1 - k, 1.5);
      fctx.strokeStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${al})`;
      fctx.lineWidth = p.size;
      fctx.beginPath();
      fctx.moveTo(p.x, p.y);
      fctx.lineTo(p.x - p.vx * .022, p.y - p.vy * .022);
      fctx.stroke();
    }
    fctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- Áudio (100% sintetizado) — mais grave e quente ---------- */
  let ctx = null, audio = null;

  function impulse(c, sec, decay) {
    const n = (c.sampleRate * sec) | 0, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }
  function noiseBuf(c) {
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function buildSound(c, t0) {
    const out = c.createGain(); out.gain.value = .9 * VOL;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    out.connect(comp); comp.connect(c.destination);
    const rev = c.createConvolver(); rev.buffer = impulse(c, 3.2, 2.2);
    const rg = c.createGain(); rg.gain.value = .6; rev.connect(rg); rg.connect(out);
    const wet = c.createGain(); wet.connect(rev);
    const bed = c.createGain(); bed.connect(out);   // "cama" sonora: é abafada logo antes do impacto
    const nb = noiseBuf(c);

    const route = (gn, dst, pan, send) => {
      let node = gn;
      if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; gn.connect(p); node = p; }
      node.connect(dst);
      if (send) { const sg = c.createGain(); sg.gain.value = send; gn.connect(sg); sg.connect(wet); }
    };
    const tone = o => {
      const { type = 'sine', f1, f2 = f1, at = 0, dur = .5, g = .1, atk = .01, send = 0, dst = out, pan = 0 } = o;
      const s = t0 + at, osc = c.createOscillator(), gn = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, s);
      if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(f2, s + dur);
      gn.gain.setValueAtTime(.0001, s);
      gn.gain.exponentialRampToValueAtTime(g, s + atk);
      gn.gain.exponentialRampToValueAtTime(.0001, s + dur);
      osc.connect(gn); route(gn, dst, pan, send);
      osc.start(s); osc.stop(s + dur + .05);
    };
    const noise = o => {
      const { at = 0, dur = .5, g = .1, ft = 'bandpass', f1 = 1000, f2 = f1, q = 1, atk = .01, send = 0, dst = out, pan = 0 } = o;
      const s = t0 + at, src = c.createBufferSource(), fl = c.createBiquadFilter(), gn = c.createGain();
      src.buffer = nb; src.loop = true;
      fl.type = ft; fl.Q.value = q;
      fl.frequency.setValueAtTime(f1, s);
      fl.frequency.exponentialRampToValueAtTime(f2, s + dur);
      gn.gain.setValueAtTime(.0001, s);
      gn.gain.exponentialRampToValueAtTime(g, s + atk);
      gn.gain.exponentialRampToValueAtTime(.0001, s + dur);
      src.connect(fl); fl.connect(gn); route(gn, dst, pan, send);
      src.start(s); src.stop(s + dur + .05);
    };
    /* sino FM suave */
    const bell = (f, at, dur, g, send, pan) => {
      const s = t0 + at, car = c.createOscillator(), mod = c.createOscillator(),
            mg = c.createGain(), gn = c.createGain();
      car.frequency.value = f; mod.frequency.value = f * 3.5;
      mg.gain.setValueAtTime(f * 1.6, s);
      mg.gain.exponentialRampToValueAtTime(f * .02, s + dur * .8);
      mod.connect(mg); mg.connect(car.frequency);
      gn.gain.setValueAtTime(.0001, s);
      gn.gain.exponentialRampToValueAtTime(g, s + .004);
      gn.gain.exponentialRampToValueAtTime(.0001, s + dur);
      car.connect(gn); route(gn, out, pan || 0, send);
      car.start(s); mod.start(s); car.stop(s + dur + .05); mod.stop(s + dur + .05);
    };

    /* ===== 0.0 – 1.2 : quadrado nasce e o contorno é traçado ===== */
    noise({ at: 0, dur: 1.3, g: .05, f1: 200, f2: 1800, q: 1.2, atk: 1.0, dst: bed });
    tone({ f1: 110, at: 0, dur: IMPACT, g: .10, atk: 2.2, send: .3, dst: bed });
    tone({ f1: 110.5, at: 0, dur: IMPACT, g: .06, atk: 2.2, dst: bed });
    tone({ type: 'triangle', f1: 164.8, at: .3, dur: IMPACT - .3, g: .05, atk: 2.2, send: .4, dst: bed });
    tone({ f1: 261.6, at: .6, dur: IMPACT - .6, g: .035, atk: 2.2, send: .6, dst: bed });
    noise({ at: .15, dur: 1.05, g: .05, f1: 600, f2: 3800, q: 3, atk: .9, dst: bed });   // chiado do traço
    // "clique" em cada canto do quadrado (sincronizado com a curva do traçado)
    const inv = y => y < .5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2;
    [[.25, 1500, -.5], [.5, 1300, .5], [.75, 1150, .5], [1, 1750, -.5]].forEach(([k, f, pan]) => {
      const at = .15 + inv(k) * 1.05;
      tone({ f1: f, f2: f * .5, at, dur: .07, g: .09, atk: .002, pan });
      noise({ at, dur: .03, g: .05, ft: 'highpass', f1: 3500, f2: 2500, q: .7, atk: .002, pan });
    });
    bell(1318.5, 1.2, 1.2, .04, .8, 0);   // contorno fechou

    /* ===== 0.9 – 2.6 : logo sendo desenhada ===== */
    noise({ at: .9, dur: 1.0, g: .035, f1: 900, f2: 2800, q: 5, atk: .85, dst: bed, pan: -.3 });   // hexágono
    noise({ at: 1.5, dur: .8, g: .035, f1: 1100, f2: 3400, q: 5, atk: .7, dst: bed, pan: 0 });     // "A"
    noise({ at: 2.0, dur: .5, g: .035, f1: 1500, f2: 3800, q: 5, atk: .45, dst: bed, pan: .3 });   // barra
    bell(659.3, 1.5, 2.0, .09, .9);
    bell(880.0, 2.0, 2.0, .09, .9);
    bell(1046.5, 2.3, 2.2, .08, .9);
    // "pop" de cada nó
    tone({ f1: 420, f2: 980, at: 2.1, dur: .09, g: .09, atk: .003, send: .4, pan: .6 });
    tone({ f1: 420, f2: 980, at: 2.2, dur: .09, g: .09, atk: .003, send: .4, pan: -.6 });
    tone({ f1: 520, f2: 1250, at: 2.3, dur: .10, g: .12, atk: .003, send: .5 });
    // estalos de brasa espalhados no estéreo
    for (let i = 0; i < 20; i++) {
      const at = rnd(.25, 3.0), f = rnd(2500, 5500);
      noise({ at, dur: .04, g: rnd(.025, .07), ft: 'highpass', f1: f, f2: f * .8, q: .7, atk: .002, dst: bed, pan: rnd(-.8, .8) });
    }

    /* ===== 2.4 – 3.1 : tensão antes do impacto ===== */
    noise({ at: 2.55, dur: .55, g: .04, f1: 2200, f2: 9000, q: 2, atk: .3, dst: bed });   // swish do brilho
    // "TU": primeira batida, curta e grave (estilo "ta-dum" de abertura)
    const TU = IMPACT - .5;
    tone({ f1: 105, f2: 58, at: TU, dur: .45, g: .7, atk: .012 });
    tone({ f1: 52, f2: 40, at: TU, dur: .5, g: .55, atk: .015 });
    noise({ at: TU, dur: .2, g: .22, ft: 'lowpass', f1: 900, f2: 120, q: .7, atk: .006, send: .35 });
    tone({ type: 'triangle', f1: 233, f2: 220, at: TU, dur: .9, g: .04, atk: .02, send: .7 });   // ressonância curta
    // silêncio entre as duas batidas: a cama sonora some e volta devagar depois do DUM
    bed.gain.setValueAtTime(1, t0 + TU - .02);
    bed.gain.linearRampToValueAtTime(.08, t0 + TU + .08);
    bed.gain.setValueAtTime(.08, t0 + IMPACT);
    bed.gain.linearRampToValueAtTime(1, t0 + IMPACT + 1.8);

    /* ===== 3.1 : impacto e expansão ===== */
    // "DUM": batida grave, redonda e longa
    tone({ f1: 78, f2: 44, at: IMPACT, dur: 2.4, g: .95, atk: .012 });
    tone({ f1: 150, f2: 70, at: IMPACT, dur: .9, g: .6, atk: .01 });
    tone({ f1: 39, f2: 33, at: IMPACT, dur: 2.8, g: .6, atk: .02 });
    noise({ at: IMPACT, dur: .35, g: .4, ft: 'lowpass', f1: 1200, f2: 100, q: .7, atk: .006, send: .3 });   // corpo da batida
    noise({ at: IMPACT, dur: 2.4, g: .5, ft: 'lowpass', f1: 220, f2: 55, q: .7, atk: .03, send: .3 });      // ribombo
    noise({ at: IMPACT, dur: 1.1, g: .18, f1: 300, f2: 5000, q: 1, atk: .06, send: .5 });                   // whoosh da expansão
    // ressonância "viva" que cresce e sobe levemente depois da batida
    [[220, .07], [330, .055], [440, .045], [660, .03], [880, .02]].forEach(([f, g], i) =>
      tone({ f1: f, f2: f * 1.03, at: IMPACT + .05 + i * .03, dur: 3.8, g, atk: .9, send: 1 }));
    [110, 220, 329.6, 440, 523.3, 659.3].forEach((f, i) =>
      tone({ type: 'triangle', f1: f, at: IMPACT + i * .025, dur: 3.8, g: .04, atk: .7, send: .8 }));
    // faíscas voando, espalhadas pelo estéreo, e brilhos caindo
    for (let i = 0; i < 24; i++) {
      const at = IMPACT + .08 + Math.random() * 1.7, f = rnd(3000, 6500);
      noise({ at, dur: .035, g: rnd(.02, .06), ft: 'highpass', f1: f, f2: f * .8, q: .7, atk: .002, send: .2, pan: rnd(-1, 1) });
    }
    for (let i = 0; i < 16; i++) {
      const at = IMPACT + .35 + Math.random() * 1.8, f = rnd(3800, 8000);
      tone({ f1: f, f2: f * .85, at, dur: .06, g: .015, atk: .002, send: .7, pan: rnd(-1, 1) });
    }

    /* ===== 3.9 – 6.0 : nome, tagline e "pronto" ===== */
    noise({ at: 3.9, dur: .9, g: .04, f1: 1800, f2: 500, q: 1, atk: .3, send: .4 });
    [523.3, 587.3, 659.3, 784, 880].forEach((f, i) => bell(f, 3.95 + i * .1, 1.5, .05, 1, -.5 + i * .25));
    bell(1318.5, 4.95, 1.8, .035, 1, 0);
    tone({ f1: 220, at: 5.0, dur: 2.2, g: .05, atk: .5, send: .6 });
    tone({ f1: 330, at: 5.0, dur: 2.2, g: .035, atk: .5, send: .6 });
    bell(784, 5.65, 1.4, .05, 1, -.2);   // pequeno chime de "pronto"
    bell(1174.7, 5.8, 1.6, .05, 1, .2);

    return {
      fade() {
        const n = c.currentTime;
        out.gain.cancelScheduledValues(n);
        out.gain.setValueAtTime(out.gain.value, n);
        out.gain.linearRampToValueAtTime(0, n + .25);
      }
    };
  }

  /* ---------- Linha do tempo ---------- */
  let running = false, t0ms = 0, raf = 0, skipping = false;

  function render(t) {
    const sc = lerp(.7, 1, E.outBack(seg(t, 0, .7)));
    const bo = seg(t, 0, .35);

    // expansão
    const e = E.ioExpo(seg(t, IMPACT, IMPACT + 1.0));
    const w = lerp(S, innerWidth, e), h = lerp(S, innerHeight, e), rad = lerp(R0, 0, e);
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    box.style.borderRadius = rad + 'px';
    box.style.opacity = bo;
    box.style.transform = `translate(-50%,-50%) scale(${e > 0 ? 1 : sc})`;

    // tremor de tela no impacto
    const sh = Math.pow(1 - seg(t, IMPACT, IMPACT + .65), 2) * (t >= IMPACT ? 1 : 0);
    stage.style.transform = `translate(${Math.sin(t * 97) * 11 * sh}px,${Math.cos(t * 83) * 9 * sh}px) rotate(${Math.sin(t * 61) * .5 * sh}deg)`;

    // flash
    const fl = t < IMPACT ? 0 : (t < IMPACT + .08 ? seg(t, IMPACT, IMPACT + .08) : 1 - seg(t, IMPACT + .08, IMPACT + .55));
    flash.style.opacity = fl * .85;

    // contorno
    frame.style.opacity = bo * (1 - seg(t, IMPACT - .05, IMPACT + .25));
    frame.style.transform = `scale(${sc})`;
    frameRect.style.strokeDashoffset = 1 - E.io3(seg(t, .15, 1.2));

    // logo
    const glow = Math.pow(seg(t, 2.4, IMPACT), 2) * (1 - seg(t, IMPACT, IMPACT + .9));
    const lp = seg(t, .9, 2.5);
    const drawPath = (p, a, b) => {
      const k = seg(t, a, b);
      p.style.opacity = k > 0 ? 1 : 0;
      p.style.strokeDashoffset = 1 - E.io3(k);
    };
    drawPath(pHex, .9, 1.9);
    drawPath(pA, 1.5, 2.3);
    drawPath(pBar, 2.0, 2.5);
    nApex.style.transform = `scale(${E.outBack(seg(t, 2.3, 2.6))})`;
    n1.style.transform = `scale(${E.outBack(seg(t, 2.1, 2.4))})`;
    n2.style.transform = `scale(${E.outBack(seg(t, 2.2, 2.5))})`;
    // brilho varrendo
    const sk = seg(t, 2.55, IMPACT), sx = lerp(-60, 125, sk), so = (sk > 0 && sk < 1) ? 1 : 0;
    sheenG.setAttribute('x1', sx); sheenG.setAttribute('x2', sx + 50);
    sheenEls.forEach(c => c.style.opacity = so);

    const ls = (1 + glow * .06) * (1 + e * 5);
    logo.style.transform = `scale(${ls})`;
    logo.style.opacity = 1 - E.out3(seg(t, IMPACT + .3, IMPACT + 1.0));
    logo.style.filter = `drop-shadow(0 0 ${4 + lp * 6 + glow * 28}px rgba(255,140,70,${.35 + glow * .6}))`;

    // nome "AuGPT"
    const wk = E.out3(seg(t, 3.95, 5.4));
    word.style.letterSpacing = lerp(.32, .06, wk) + 'em';
    letters.forEach((el, i) => {
      const k = E.out3(seg(t, 3.95 + i * .1, 4.8 + i * .1));
      el.style.opacity = k;
      el.style.transform = `translateY(${(1 - k) * 42}px) scale(${.9 + .1 * k})`;
      el.style.filter = `blur(${(1 - k) * 14}px)`;
    });
    tag.style.opacity = E.out3(seg(t, 4.9, 5.5)) * .85;
    tag.style.transform = `translateY(${(1 - E.out3(seg(t, 4.9, 5.5))) * 10}px)`;

    // WebGL + partículas
    if (gl) {
      gl.uniform2f(U.uView, innerWidth, innerHeight);
      gl.uniform2f(U.uBox, w, h);
      gl.uniform1f(U.uDpr, dpr);
      gl.uniform1f(U.uTime, t);
      gl.uniform1f(U.uP, e);
      gl.uniform1f(U.uGlow, glow);
      gl.uniform1f(U.uLogo, lp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    drawFx(t, w, h);

    // saída: a janela principal aparece embaixo e a abertura some por cima dela
    if (t > 5.3) sinalizar('revelar');
    intro.style.opacity = 1 - E.out3(seg(t, 5.5, DUR));
  }

  function loop(now) {
    if (!running) return;
    const t = Math.max(0, (now - t0ms) / 1000);
    render(Math.min(t, DUR));
    if (t >= DUR) return finish();
    raf = requestAnimationFrame(loop);
  }

  function finish() {
    running = false;
    cancelAnimationFrame(raf);
    intro.style.display = 'none';
    stage.style.visibility = 'hidden';
    hint.style.opacity = 0;
    sinalizar('revelar');
    sinalizar('fim');
  }

  function skip() {
    if (!running || skipping) return;
    skipping = true;
    if (audio) audio.fade();
    sinalizar('revelar');
    intro.style.transition = 'opacity .35s';
    intro.style.opacity = 0;
    setTimeout(() => { skipping = false; finish(); }, 360);
  }

  function begin() {
    const lead = .06;
    if (ctx && ctx.state === 'running' && !MUDO) audio = buildSound(ctx, ctx.currentTime + lead);
    parts = []; lastT = 0; burst = false;
    stage.style.visibility = 'visible';
    t0ms = performance.now() + lead * 1000;
    running = true;
    hint.style.opacity = 1;
    raf = requestAnimationFrame(loop);
  }

  /* ---------- Início ---------- */
  async function play() {
    running = false; skipping = false; cancelAnimationFrame(raf);
    intro.style.transition = 'none';
    intro.style.opacity = 1;
    intro.style.display = 'block';
    stage.style.visibility = 'hidden';
    if (!gl) initGL();
    resize();

    if (!MUDO) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !ctx) ctx = new AC();
        if (ctx && ctx.state !== 'running') {
          await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 250))]);
        }
      } catch (e) { ctx = null; }
    }

    begin();
  }

  addEventListener('keydown', e => { if (running && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) skip(); });
  intro.addEventListener('pointerdown', () => { if (running) skip(); });
  play();
})();
