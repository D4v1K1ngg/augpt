'use strict';

/* Tema "Vidro líquido" (26/11, protótipo do Davi): a escolha em Ajustes → Aparência e o fundo animado em WebGL —
 * as luzes que flutuam, a lente que segue o cursor e a ondulação do clique no fundo.
 *
 * Os modelos rodam na mesma placa, então o fundo é leve: desenha em metade da resolução, a ~30 quadros por segundo,
 * sem texturas, e PARA com a janela fora de foco ou escondida, com o modelo trabalhando, com "reduzir animações" do
 * Windows (em "Seguir o Windows") e com a animação em "Parado" (aí o canvas some e fica o degradê do CSS, sem custo). */
(() => {
  const raiz = document.documentElement;
  const ESTILO = 'augpt:estilo';
  const ANIMACAO = 'augpt:vidro-animacao'; // "auto" (seguir o Windows), "animado" ou "parado"
  const ler = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const gravar = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };
  const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const ehVidro = () => raiz.getAttribute('data-estilo') === 'vidro';
  const modo = () => ler(ANIMACAO) || 'auto';
  const animar = () => ehVidro() && (modo() === 'animado' || (modo() === 'auto' && !reduzido?.matches));

  /* ------------------------------ Ajustes → Aparência ------------------------------ */
  const selEstilo = document.getElementById('cfgEstilo');
  const selAnimacao = document.getElementById('cfgVidroAnimacao');
  const pintarAjustes = () => {
    if (selEstilo) selEstilo.value = ehVidro() ? 'vidro' : 'padrao';
    if (selAnimacao) {
      selAnimacao.value = modo();
      selAnimacao.closest('.linha').hidden = !ehVidro();
    }
  };
  selEstilo?.addEventListener('change', () => {
    if (selEstilo.value === 'vidro') raiz.setAttribute('data-estilo', 'vidro');
    else raiz.removeAttribute('data-estilo');
    gravar(ESTILO, selEstilo.value);
    window.pintarBotoesDoWindows?.();
    window.dispatchEvent(new Event('resize')); // os gráficos releem as cores
    pintarAjustes();
    atualizar();
  });
  selAnimacao?.addEventListener('change', () => {
    gravar(ANIMACAO, selAnimacao.value);
    atualizar();
  });
  pintarAjustes();

  /* ------------------------------ o fundo em WebGL ------------------------------ */
  const cv = document.createElement('canvas');
  cv.id = 'vidroFundo';
  cv.setAttribute('aria-hidden', 'true');
  cv.hidden = true;
  document.body.prepend(cv);
  let gl = null;
  let U = {};

  const FS = `precision mediump float;
uniform vec2 uRes, uMouse;
uniform float uTime, uMix, uLens, uEscala;
uniform vec4 uR[8];
vec3 cena(vec2 px){
  float y = 1. - px.y / uRes.y;
  vec3 d = y < .55 ? mix(vec3(.925,.882,.824), vec3(.863,.780,.675), y/.55) : mix(vec3(.863,.780,.675), vec3(.776,.647,.518), (y-.55)/.45);
  vec3 n = y < .55 ? mix(vec3(.165,.133,.188), vec3(.231,.173,.165), y/.55) : mix(vec3(.231,.173,.165), vec3(.337,.224,.165), (y-.55)/.45);
  vec3 c = mix(d, n, uMix);
  vec2 g1 = uRes * vec2(.28 + .05*sin(uTime*.35), .56 + .06*cos(uTime*.27));
  vec2 g2 = uRes * vec2(.74 + .05*cos(uTime*.31), .70 + .05*sin(uTime*.22));
  float s = min(uRes.x, uRes.y);
  c += mix(vec3(1.,.86,.66)*.22, vec3(1.,.62,.3)*.2, uMix) * exp(-dot(px-g1,px-g1) / (s*s*.05));
  c += mix(vec3(.85,.58,.42)*.18, vec3(.5,.35,.85)*.22, uMix) * exp(-dot(px-g2,px-g2) / (s*s*.07));
  return c;
}
void main(){
  vec2 p = gl_FragCoord.xy;
  vec2 o = vec2(0.);
  float brilho = 0.;
  for (int i = 0; i < 8; i++) {
    vec4 r = uR[i];
    float idade = uTime - r.z;
    if (r.w <= 0. || idade < 0. || idade > 3.) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + .0001;
    float x = dist - idade * 380. * uEscala;
    float w = (40. + idade * 70.) * uEscala;
    float env = exp(-x*x / (w*w)) * exp(-idade * 1.5);
    o += d / dist * sin(x / (11. * uEscala)) * env * r.w;
    brilho += cos(x / (11. * uEscala)) * env * r.w / (14. * uEscala);
  }
  vec2 dm = p - uMouse;
  float R = 110. * uEscala;
  float dl = length(dm);
  float k = 1. - smoothstep(0., R, dl);
  o -= dm * k * k * .45 * uLens;
  vec3 col = cena(p + o) + clamp(brilho, -1., 1.) * .07;
  float aro = smoothstep(R - 10.*uEscala, R - 2.*uEscala, dl) * (1. - smoothstep(R - 2.*uEscala, R + 1.*uEscala, dl));
  float topo = max(0., dot(normalize(dm + .0001), vec2(-.5, .85)));
  col += uLens * (aro * (.18 + .5*topo) + k * .04);
  gl_FragColor = vec4(col, 1.);
}`;

  function iniciarGl() {
    if (gl) return true;
    gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return false;
    const sh = (tipo, src) => {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      U = Object.fromEntries(['uRes', 'uMouse', 'uTime', 'uMix', 'uLens', 'uEscala', 'uR'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    } catch (err) {
      console.warn('[vidro] WebGL indisponível:', err.message);
      gl = null;
      return false;
    }
    return true;
  }

  // ponytail: metade da resolução da janela — o fundo é só degradê e luz; a lente fica um pouco mais macia
  const ESCALA = 0.5;
  let W = 0;
  let H = 0;
  function medir() {
    W = Math.max(1, Math.round(window.innerWidth * ESCALA));
    H = Math.max(1, Math.round(window.innerHeight * ESCALA));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
      gl?.viewport(0, 0, W, H);
    }
  }

  const ondas = new Float32Array(8 * 4);
  let proxima = 0;
  const t0 = performance.now();
  const agora = () => (performance.now() - t0) / 1000;
  const gota = (x, y, forca, atraso = 0) => {
    ondas.set([x * ESCALA, H - y * ESCALA, agora() + atraso, forca * ESCALA], proxima * 4);
    proxima = (proxima + 1) % 8;
  };
  let mouse = { x: -9999, y: -9999 };
  let lente = 0;
  let lenteAlvo = 0;
  let mistura = raiz.getAttribute('data-theme') === 'light' ? 0 : 1;
  let ultimo = { x: 0, y: 0, t: 0 };

  window.addEventListener('pointermove', (e) => {
    if (!quadro) return;
    mouse = { x: e.clientX, y: e.clientY };
    lenteAlvo = 1;
    const dist = Math.hypot(e.clientX - ultimo.x, e.clientY - ultimo.y);
    const t = agora();
    if (dist > 18 && t - ultimo.t > 0.05) {
      gota(e.clientX, e.clientY, Math.min(3 + dist * 0.08, 9));
      ultimo = { x: e.clientX, y: e.clientY, t };
    }
  }, { passive: true });
  document.addEventListener('pointerleave', () => (lenteAlvo = 0));
  window.addEventListener('blur', () => (lenteAlvo = 0));
  // o clique no FUNDO (fora de botões, campos e textos da conversa) faz a ondulação
  window.addEventListener('pointerdown', (e) => {
    if (!quadro || e.target.closest?.('a,button,input,textarea,select,label,summary,dialog,[contenteditable],.msg,.composer-caixa,pre,table')) return;
    gota(e.clientX, e.clientY, 22);
    gota(e.clientX, e.clientY, 12, 0.18);
    gota(e.clientX, e.clientY, 6, 0.38);
  }, { passive: true });

  let quadro = 0;
  let antes = 0;
  // com o modelo trabalhando, a placa é dele: o fundo para (como as ondas da tela inicial)
  const pausado = () => document.hidden || !document.hasFocus() || (typeof agente !== 'undefined' && agente.rodando);

  function desenhar() {
    lente += (lenteAlvo - lente) * 0.15;
    mistura += ((raiz.getAttribute('data-theme') === 'light' ? 0 : 1) - mistura) * 0.1;
    gl.uniform2f(U.uRes, W, H);
    gl.uniform2f(U.uMouse, mouse.x * ESCALA, H - mouse.y * ESCALA);
    gl.uniform1f(U.uTime, agora());
    gl.uniform1f(U.uMix, mistura);
    gl.uniform1f(U.uLens, lente);
    gl.uniform1f(U.uEscala, ESCALA);
    gl.uniform4fv(U.uR, ondas);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function passo(t) {
    quadro = 0;
    if (!animar() || pausado()) return;
    if (t - antes >= 33) {
      antes = t;
      desenhar();
    }
    quadro = requestAnimationFrame(passo);
  }

  function atualizar() {
    const ligar = animar() && iniciarGl();
    cv.hidden = !ligar;
    if (!ligar) {
      cancelAnimationFrame(quadro);
      quadro = 0;
      return;
    }
    medir();
    if (pausado()) mistura = raiz.getAttribute('data-theme') === 'light' ? 0 : 1; // trocou Dia/Noite parado: sem transição
    desenhar(); // o quadro de agora (fica na tela enquanto pausa)
    if (!quadro && !pausado()) quadro = requestAnimationFrame(passo);
  }

  window.addEventListener('focus', atualizar);
  window.addEventListener('blur', atualizar);
  window.addEventListener('resize', atualizar);
  document.addEventListener('visibilitychange', atualizar);
  reduzido?.addEventListener?.('change', atualizar);
  new MutationObserver(atualizar).observe(raiz, { attributes: true, attributeFilter: ['data-theme', 'data-estilo'] });
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    gl = null;
    cancelAnimationFrame(quadro);
    quadro = 0;
    cv.hidden = true;
  });
  // o modelo começou ou terminou: o fundo para e volta
  if (typeof manipuladores !== 'undefined') {
    for (const canal of ['inicio', 'concluido', 'erro', 'interrompido', 'limite']) {
      const original = manipuladores[canal];
      manipuladores[canal] = (d) => {
        const r = original?.(d);
        setTimeout(atualizar, 0);
        return r;
      };
    }
  }
  atualizar();
  window.temaVidro = { atualizar, pintarAjustes };
})();
