'use strict';

/* Efeitos de escrita no chat (26/11, a partir da demonstração do Davi "laboratório de efeitos de escrita"): a resposta
 * que chega do Ollama ganha um efeito — máquina de escrever, névoa, tinta dourada, cometa… — escolhido em Ajustes →
 * Aparência. "Nenhum" é o de sempre.
 *
 * O texto NUNCA espera o efeito: a resposta é desenhada de novo a cada pedaço que chega (md.render), e aqui só se anima
 * o que acabou de chegar. Cada letra guarda a hora em que chegou; a cada desenho, o trecho ainda animando é quebrado em
 * pedaços com animation-delay (negativo para o que já começou), então a animação continua de onde estava em vez de
 * recomeçar. O atraso entre um pedaço e o seguinte nunca passa de ATRASO_MAX: com o modelo rápido, o efeito acelera.
 * Código, links, citações [n], tabelas, fotos, gráficos e cartões (clima, mapa, produtos) nunca são quebrados. */
(() => {
  // unidade: letra, token (2 a 4 letras), palavra ou bloco; base: ms por unidade em 1×; dur: ms da animação (o CSS)
  const PREDEFINICOES = [
    { id: 'maquina', nome: 'Máquina de escrever', unidade: 'letra', base: 24, cursor: 'bar', anim: 'surge', dur: 1, pausas: true },
    { id: 'stream', nome: 'Streaming', unidade: 'token', base: 30, cursor: 'block', anim: 'fade', dur: 140 },
    { id: 'palavra', nome: 'Surgir por palavra', unidade: 'palavra', base: 55, anim: 'up', dur: 500 },
    { id: 'nevoa', nome: 'Névoa', unidade: 'palavra', base: 48, anim: 'blur', dur: 750 },
    { id: 'decodificar', nome: 'Decodificação', unidade: 'letra', base: 11, anim: 'fade', dur: 140, embaralha: true },
    { id: 'ouro', nome: 'Tinta dourada', unidade: 'letra', base: 16, anim: 'gold', dur: 1200 },
    { id: 'cometa', nome: 'Cometa', unidade: 'letra', base: 20, cursor: 'orb', anim: 'gold-soft', dur: 800, faiscas: true },
    { id: 'onda', nome: 'Onda', unidade: 'letra', base: 14, anim: 'wave', dur: 600 },
    { id: 'pulso', nome: 'Pulso', unidade: 'palavra', base: 58, anim: 'pulse', dur: 900 },
    { id: 'linhas', nome: 'Linha por linha', unidade: 'bloco', base: 250, anim: 'mask', dur: 700 },
    { id: 'pincel', nome: 'Pincel', unidade: 'bloco', base: 330, anim: 'brush', dur: 1000 },
    { id: 'queda', nome: 'Gravidade', unidade: 'palavra', base: 60, anim: 'drop', dur: 650 },
    { id: 'pop', nome: 'Pop elástico', unidade: 'palavra', base: 50, anim: 'pop', dur: 500 },
    { id: 'glitch', nome: 'Glitch', unidade: 'palavra', base: 52, anim: 'glitch', dur: 450 },
  ];
  const LETRAS_POR_UNIDADE = { letra: 1, token: 3, palavra: 6, bloco: 80 };
  const ATRASO_MAX = 400; // ms: o máximo que o fim do texto já chegado fica esperando o efeito
  const NAO_QUEBRAR = 'pre, code, a, sup, button, svg, canvas, table, figure, img, video, iframe, .cita, .cursor, .fontes-da-resposta, .caixa-lugar, .grafico-lugar, .cartao-lugar, .cartao-produto, .md-carrossel, .md-galeria, .md-figura, .md-video, .tabela-resposta, [class*="cartao"], [class*="grafico"], [class*="mapa"], [class*="clima"]';
  const BLOCOS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';
  const SIMBOLOS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\{}[]~';

  /**
   * A hora em que cada letra nova aparece (ms, no relógio de performance.now): uma depois da outra no ritmo do efeito,
   * mas a última NUNCA passa de agora + ATRASO_MAX — o efeito acelera para acompanhar o modelo, e não segura o texto.
   */
  function agendar(chegada, texto, agora, p, vel = 1) {
    const novos = Array.from(texto).length;
    if (!novos) return chegada;
    let passo = p.base / vel / LETRAS_POR_UNIDADE[p.unidade];
    let t = Math.max(agora, chegada[chegada.length - 1] ?? 0);
    if (t + novos * passo > agora + ATRASO_MAX) passo = Math.max(0, (agora + ATRASO_MAX - t) / novos);
    const teto = agora + ATRASO_MAX;
    for (const ch of texto) {
      // o índice é por unidade de código (como nodeValue.length): letra fora do plano básico ocupa 2
      for (let k = 0; k < ch.length; k++) chegada.push(Math.min(t, teto));
      t += passo;
      // pausas na pontuação (máquina de escrever); o teto vale do mesmo jeito
      if (p.pausas && /[.!?…,;:]/.test(ch)) t += passo * (/[,;:]/.test(ch) ? 4 : 9);
    }
    return chegada;
  }
  // na bancada (Node, sem tela): só as predefinições e o agendamento
  if (typeof document === 'undefined') {
    module.exports = { PREDEFINICOES, agendar, ATRASO_MAX };
    return;
  }

  const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const estados = new WeakMap(); // elemento da resposta → { chegada: [ms por letra] }

  const cfg = () => (typeof config !== 'undefined' && config) || {};
  function escolha(sobrepor) {
    const c = { ...cfg(), ...sobrepor };
    const p = PREDEFINICOES.find((x) => x.id === c.efeitoEscrita);
    if (!p) return null;
    if (reduzido?.matches && !c.escritaComAnimacaoDesligada) return null;
    return { p, vel: Math.min(3, Math.max(0.25, Number(c.velocidadeEscrita) || 1)) };
  }

  /** Os textos que podem ser animados, em ordem (fora de código, links, cartões…). */
  function textos(el) {
    const lista = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(NAO_QUEBRAR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (w.nextNode()) lista.push(w.currentNode);
    return lista;
  }

  const span = (classe, texto) => {
    const s = document.createElement('span');
    s.className = classe;
    s.textContent = texto;
    return s;
  };
  const pedacos = (palavra, unidade) => {
    if (unidade === 'letra') return Array.from(palavra);
    const out = [];
    for (let i = 0; i < palavra.length; i += 3) out.push(palavra.slice(i, i + 3));
    return out;
  };

  /* embaralhar (Decodificação): as letras novas mostram símbolos por ~250 ms antes da letra certa */
  let embaralhando = [];
  let quadroEmb = 0;
  function rodarEmbaralho() {
    quadroEmb = 0;
    const agora = performance.now();
    embaralhando = embaralhando.filter((e) => {
      if (!e.s.isConnected) return false;
      if (agora >= e.ate) {
        e.s.textContent = e.real;
        e.s.classList.remove('esc-emb');
        return false;
      }
      e.s.textContent = SIMBOLOS[(Math.random() * SIMBOLOS.length) | 0];
      return true;
    });
    if (embaralhando.length) quadroEmb = setTimeout(rodarEmbaralho, 45);
  }

  let ultimaFaisca = 0;
  function faiscas(cursor) {
    const agora = performance.now();
    if (agora - ultimaFaisca < 70) return;
    ultimaFaisca = agora;
    const c = cursor.getBoundingClientRect();
    if (!c.width && !c.height) return;
    // no body, não na resposta: ela é redesenhada a cada pedaço e levaria as faíscas junto
    for (let i = 0; i < 2; i++) {
      const s = span('esc-faisca', '');
      s.style.left = `${c.left + c.width / 2 - 2}px`;
      s.style.top = `${c.top + c.height / 2 - 2}px`;
      s.style.setProperty('--dx', `${-20 + Math.random() * 34}px`);
      s.style.setProperty('--dy', `${-26 + Math.random() * 34}px`);
      s.addEventListener('animationend', () => s.remove());
      document.body.append(s);
    }
  }

  /**
   * Chamar logo depois de cada `el.innerHTML = md.render(...)` da resposta (e no texto final, com fim: true).
   * Sem efeito escolhido (ou com "reduzir animações" do Windows), não faz nada: o chat fica como sempre foi.
   */
  function animar(el, { fim = false, sobrepor } = {}) {
    const e = el && escolha(sobrepor);
    if (!e) {
      if (el) delete el.dataset.escrita;
      return;
    }
    const { p, vel } = e;
    el.dataset.escrita = p.anim;
    if (p.cursor) el.dataset.escritaCursor = p.cursor;
    else delete el.dataset.escritaCursor;

    const nos = textos(el);
    const total = nos.reduce((s, n) => s + n.nodeValue.length, 0);
    let st = estados.get(el);
    // o texto encolheu muito: a resposta recomeçou (reescrita pelo verificador) — tudo é novo de novo
    if (!st || total < st.chegada.length - 20) estados.set(el, (st = { chegada: [] }));
    const agora = performance.now();
    const novos = total - st.chegada.length;
    if (novos > 0) agendar(st.chegada, nos.map((n) => n.nodeValue).join('').slice(st.chegada.length), agora, p, vel);
    else if (novos < 0) st.chegada.length = total;
    const chegada = st.chegada;
    const vivo = (i) => agora - chegada[i] < p.dur + 30;

    if (p.unidade === 'bloco') {
      // cada bloco anima pela hora da sua primeira letra
      let i = 0;
      const inicioDe = new Map();
      for (const n of nos) {
        let b = n.parentElement.closest(BLOCOS);
        while (b && b.parentElement !== el && b.parentElement?.closest(BLOCOS) && el.contains(b.parentElement.closest(BLOCOS))) b = b.parentElement.closest(BLOCOS); // o bloco de fora (li > p)
        if (b && !inicioDe.has(b) && n.nodeValue.trim()) inicioDe.set(b, i);
        i += n.nodeValue.length;
      }
      for (const [b, ini] of inicioDe) {
        if (!vivo(ini)) continue;
        b.classList.add('esc-b');
        b.style.setProperty('animation-delay', `${Math.round(chegada[ini] - agora)}ms`, 'important');
      }
    } else {
      // só o fim ainda animando é quebrado em pedaços; o resto fica texto puro (leve)
      let primeiroVivo = total;
      while (primeiroVivo > 0 && vivo(primeiroVivo - 1)) primeiroVivo--;
      let ini = 0;
      for (const n of nos) {
        const txt = n.nodeValue;
        const fimNo = ini + txt.length;
        if (fimNo > primeiroVivo) {
          const corte = Math.max(0, primeiroVivo - ini);
          const frag = document.createDocumentFragment();
          if (corte) frag.append(txt.slice(0, corte));
          let pos = ini + corte;
          for (const parte of txt.slice(corte).split(/(\s+)/)) {
            if (!parte) continue;
            if (/^\s+$/.test(parte)) {
              frag.append(parte);
              pos += parte.length;
              continue;
            }
            const unidades = p.unidade === 'palavra' ? [parte] : pedacos(parte, p.unidade);
            const caixa = p.unidade === 'palavra' ? frag : frag.appendChild(span('esc-w', ''));
            for (const u of unidades) {
              const s = span('esc-u', u);
              s.style.setProperty('animation-delay', `${Math.round(chegada[pos] - agora)}ms`, 'important');
              caixa.append(s);
              if (p.embaralha && agora - chegada[pos] < 250) {
                embaralhando.push({ s, real: u, ate: chegada[pos] + 250 });
                s.classList.add('esc-emb');
                s.textContent = SIMBOLOS[(Math.random() * SIMBOLOS.length) | 0];
              }
              pos += u.length;
            }
          }
          n.replaceWith(frag);
        }
        ini = fimNo;
      }
      if (embaralhando.length && !quadroEmb) rodarEmbaralho();
    }

    // o cursor do efeito vai para o fim do último parágrafo (no chat ele fica numa linha sozinho)
    const cursor = el.querySelector(':scope > .cursor');
    if (cursor && !fim && p.cursor) {
      const blocos = [...el.querySelectorAll(BLOCOS)].filter((b) => !b.closest(NAO_QUEBRAR) && b.textContent.trim());
      blocos.at(-1)?.append(cursor);
      if (p.faiscas) faiscas(cursor);
    }
  }

  /* ------------------------------ Ajustes → Aparência ------------------------------ */
  const $ = (id) => document.getElementById(id);
  const sel = $('cfgEfeitoEscrita');
  const vel = $('cfgVelocidadeEscrita');
  const velRotulo = $('cfgVelocidadeEscritaValor');
  const sempre = $('cfgEscritaSempre');
  const previa = $('escritaPrevia');
  const aviso = $('escritaAviso');
  if (sel && !sel.options.length) {
    sel.append(new Option('Nenhum (o texto aparece como chega)', 'nenhum'));
    for (const p of PREDEFINICOES) sel.append(new Option(`${p.nome} · ${p.unidade}`, p.id));
  }
  const AMOSTRA = 'Achei **3 opções** que cabem no seu orçamento. A mais equilibrada é o *Simgot EM6L*: som neutro e bom acabamento.\n\n- Graves controlados, sem embolar.\n- Cabo destacável.\n\nQuer que eu compare com outro modelo?';
  let previaTimer = 0;
  function tocarPrevia() {
    if (!previa) return;
    clearTimeout(previaTimer);
    const sobrepor = { efeitoEscrita: sel.value, velocidadeEscrita: Number(vel.value), escritaComAnimacaoDesligada: sempre.checked };
    estados.delete(previa);
    let i = 0;
    // a prévia imita o modelo: pedaços de 2 a 6 letras a cada ~40 ms, desenhados como no chat
    const passo = () => {
      i = Math.min(AMOSTRA.length, i + 2 + Math.floor(Math.random() * 5));
      const acabou = i >= AMOSTRA.length;
      previa.innerHTML = `${window.md?.render ? window.md.render(AMOSTRA.slice(0, i)) : AMOSTRA.slice(0, i)}${acabou ? '' : '<span class="cursor"></span>'}`;
      animar(previa, { fim: acabou, sobrepor });
      if (!acabou) previaTimer = setTimeout(passo, 40);
    };
    passo();
  }
  function pintar() {
    if (!sel) return;
    const c = cfg();
    sel.value = PREDEFINICOES.some((p) => p.id === c.efeitoEscrita) ? c.efeitoEscrita : 'nenhum';
    vel.value = String(Number(c.velocidadeEscrita) || 1);
    velRotulo.textContent = `${Number(vel.value).toLocaleString('pt-BR')}×`;
    sempre.checked = c.escritaComAnimacaoDesligada === true;
    const desligado = sel.value === 'nenhum';
    vel.closest('.linha').hidden = desligado;
    sempre.closest('.linha').hidden = desligado || !reduzido?.matches;
    aviso.hidden = desligado || !reduzido?.matches || sempre.checked;
  }
  async function salvar(mudanca) {
    if (typeof api !== 'undefined') config = await api.config.set(mudanca);
    pintar();
    tocarPrevia();
  }
  sel?.addEventListener('change', () => salvar({ efeitoEscrita: sel.value }));
  vel?.addEventListener('input', () => (velRotulo.textContent = `${Number(vel.value).toLocaleString('pt-BR')}×`));
  vel?.addEventListener('change', () => salvar({ velocidadeEscrita: Number(vel.value) }));
  sempre?.addEventListener('change', () => salvar({ escritaComAnimacaoDesligada: sempre.checked }));
  $('btnEscritaPrevia')?.addEventListener('click', tocarPrevia);
  // a aba Aparência aberta: pinta com o config já carregado e mostra a prévia
  document.querySelector('.ajustes-aba[data-painel="ajAparencia"]')?.addEventListener('click', () => {
    pintar();
    tocarPrevia();
  });

  window.efeitosDeEscrita = { animar, pintar, PREDEFINICOES };
})();
