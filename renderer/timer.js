'use strict';

/**
 * Timers e alarmes (31/10): o bloco ```timer (src/agent/timer-no-chat.js) vira um cartão com a contagem
 * regressiva. No fim: bipe (até 1 min ou até "Parar"), aviso do Windows e o cartão em destaque. Os ativos ficam
 * guardados (localStorage) e voltam se o app for reaberto; perdido há mais de 10 min, não toca mais.
 * "cancela o timer" chega pelo evento 'timer'.
 */
(function (global) {
  const T = {
    pt: { timer: 'Timer', alarme: 'Alarme', cancelar: 'Cancelar', parar: 'Parar', acabou: 'Acabou!', cancelado: 'Cancelado', tocou: 'Tocou às', toca: 'toca às', aviso: 'Acabou o tempo' },
    en: { timer: 'Timer', alarme: 'Alarm', cancelar: 'Cancel', parar: 'Stop', acabou: "Time's up!", cancelado: 'Cancelled', tocou: 'Rang at', toca: 'rings at', aviso: "Time's up" },
  };
  const CHAVE = 'augpt-timers';
  const ativos = new Map(); // id → { spec, espera }
  const cartoes = new Map(); // id → Set de funções que repintam
  const estado = new Map(); // id → 'tocando' | 'acabou' | 'cancelado'
  let som = null;

  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || '[]'); } catch { return []; } };
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify([...ativos.values()].map((a) => a.spec))); } catch {} };
  const repintar = (id) => cartoes.get(id)?.forEach((f) => f());
  const hora = (ms, en) => new Date(ms).toLocaleTimeString(en ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
  const relogio = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
  };

  function bipar() {
    if (som) return;
    try {
      const ctx = new AudioContext();
      const inicio = Date.now();
      const tocar = () => {
        if (Date.now() - inicio > 60000 || ![...estado.values()].includes('tocando')) return pararSom();
        for (const atraso of [0, 0.18, 0.36]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + atraso);
          g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + atraso + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + atraso + 0.14);
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + atraso);
          o.stop(ctx.currentTime + atraso + 0.15);
        }
      };
      tocar();
      som = { ctx, laco: setInterval(tocar, 1200) };
    } catch {}
  }
  function pararSom() {
    if (!som) return;
    clearInterval(som.laco);
    som.ctx.close().catch(() => {});
    som = null;
    for (const [id, e] of estado) if (e === 'tocando') { estado.set(id, 'acabou'); repintar(id); }
  }

  function tocar(spec) {
    ativos.delete(spec.id);
    gravar();
    estado.set(spec.id, 'tocando');
    repintar(spec.id);
    bipar();
    const L = T[spec.idioma === 'en' ? 'en' : 'pt'];
    // pelo processo principal: a janela não tem permissão de notificação (31/10, o aviso não aparecia)
    api.timer?.avisar({ titulo: `⏰ ${spec.rotulo || L.aviso}`, corpo: `${spec.alarme ? L.alarme : L.timer} — ${hora(spec.fim, spec.idioma === 'en')}` }).catch(() => {});
  }

  function agendar(spec) {
    if (ativos.has(spec.id) || estado.has(spec.id)) return;
    const falta = spec.fim - Date.now();
    if (falta < -10 * 60000) return; // perdido há muito tempo (o app estava fechado)
    // setTimeout aceita até ~24,8 dias; o timer vai até 24 h
    ativos.set(spec.id, { spec, espera: setTimeout(() => tocar(spec), Math.max(0, falta)) });
    gravar();
  }

  function cancelar(id) {
    const a = ativos.get(id);
    if (a) clearTimeout(a.espera);
    ativos.delete(id);
    gravar();
    if (estado.get(id) !== 'acabou') estado.set(id, 'cancelado');
    if (![...estado.values()].includes('tocando')) pararSom();
    repintar(id);
  }

  function criar(dado) {
    const spec = typeof dado === 'string' ? JSON.parse(dado) : dado;
    const en = spec.idioma === 'en';
    const L = T[en ? 'en' : 'pt'];
    agendar(spec);
    const raiz = document.createElement('div');
    raiz.className = 'timer';
    raiz.dataset.semTraducao = '';
    raiz.innerHTML = '<div class="timer-titulo"></div><div class="timer-relogio"></div><div class="timer-barra"><span></span></div><div class="timer-acoes"><button class="btn-secundario"></button></div>';
    raiz.querySelector('.timer-titulo').textContent = `${spec.alarme ? '⏰' : '⏱️'} ${spec.alarme ? L.alarme : L.timer}${spec.rotulo ? ` — ${spec.rotulo}` : ''}`;
    const relogioEl = raiz.querySelector('.timer-relogio');
    const barra = raiz.querySelector('.timer-barra span');
    const botao = raiz.querySelector('button');
    let laco = null;
    const pintar = () => {
      if (!raiz.isConnected && laco) {
        clearInterval(laco);
        laco = null;
        cartoes.get(spec.id)?.delete(pintar);
        return;
      }
      const e = estado.get(spec.id) || (ativos.has(spec.id) ? 'contando' : Date.now() >= spec.fim ? 'acabou' : 'cancelado');
      raiz.classList.toggle('tocando', e === 'tocando');
      raiz.classList.toggle('parado', e === 'acabou' || e === 'cancelado');
      if (e === 'contando') {
        const resta = Math.max(0, Math.ceil((spec.fim - Date.now()) / 1000));
        relogioEl.textContent = relogio(resta);
        relogioEl.title = `${L.toca} ${hora(spec.fim, en)}`;
        barra.style.width = `${Math.min(100, ((Date.now() - spec.inicio) / Math.max(1, spec.fim - spec.inicio)) * 100)}%`;
        botao.textContent = L.cancelar;
        botao.hidden = false;
      } else {
        relogioEl.textContent = e === 'tocando' ? L.acabou : e === 'cancelado' ? L.cancelado : `${L.tocou} ${hora(spec.fim, en)}`;
        barra.style.width = e === 'cancelado' ? '0%' : '100%';
        botao.textContent = L.parar;
        botao.hidden = e !== 'tocando';
      }
    };
    botao.addEventListener('click', () => (estado.get(spec.id) === 'tocando' ? pararSom() : cancelar(spec.id)));
    if (!cartoes.has(spec.id)) cartoes.set(spec.id, new Set());
    cartoes.get(spec.id).add(pintar);
    pintar();
    laco = setInterval(pintar, 1000);
    return raiz;
  }

  // os que estavam contando quando o app fechou
  for (const spec of ler()) agendar(spec);

  if (typeof manipuladores !== 'undefined') {
    Object.assign(manipuladores, {
      timer({ acao } = {}) {
        if (acao === 'parar-som') return pararSom(); // clicou no aviso do Windows
        if (acao !== 'cancelar') return;
        // "para o alarme" com um tocando: só cala; os outros seguem contando
        if ([...estado.values()].includes('tocando')) return pararSom();
        for (const id of [...ativos.keys()]) cancelar(id);
      },
    });
  }

  global.timer = { criar, ativos: () => [...ativos.values()].map((a) => a.spec), pararSom };
})(window);
