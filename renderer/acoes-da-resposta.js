'use strict';

/**
 * Ações de cada resposta e sugestões de próxima pergunta (16/11, fases 3 e 4 do visual novo).
 *  - acoesDaResposta(corpo, markdown, { ultima }): uma linha discreta embaixo da resposta — Copiar, Refazer (só na
 *    última do Agente), o 🔊 do Estúdio (estudio.js põe o botão dentro desta linha) e o modelo que respondeu, à direita;
 *  - sugestoesDeContinuacao(corpo, pergunta, markdown): 3 perguntas curtas para continuar, só na última resposta;
 *    clicar envia. Somem quando sai uma resposta nova.
 * Usa as globais da tela (el, agente, api, enviarPedido, anexosDoPedido, criarTurno, manipuladores).
 */
(() => {
  const ICONES = {
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    refazer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  };

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      const t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    }
  }

  /** Refaz a última resposta do Agente: a pergunta e a resposta saem (da tela e da conversa) e a pergunta vai de novo. */
  async function refazerUltima() {
    if (agente.rodando) return;
    const c = agente.conversa;
    const msgs = [...el.aMensagens.querySelectorAll(':scope > .msg')];
    const [eu, ia] = msgs.slice(-2);
    if (c.length < 2 || c.at(-1).role !== 'assistant' || c.at(-2).role !== 'user' || !eu?.classList.contains('eu') || !ia?.classList.contains('ia')) return;
    const pedidoCompleto = c.at(-2).content;
    c.splice(-2, 2);
    eu.remove();
    ia.remove();
    const { texto } = anexosDoPedido(pedidoCompleto);
    el.aEntrada.disabled = true;
    el.aEnviar.textContent = '■';
    el.aEnviar.classList.add('parando');
    agente.rodando = true;
    criarTurno(texto);
    c.push({ role: 'user', content: pedidoCompleto });
    const r = await api.agent.start(pedidoCompleto, c.slice(0, -1), agente.idConversa, {});
    if (!r.ok) manipuladores.erro({ mensagem: r.error, amigavel: r.amigavel });
  }

  window.acoesDaResposta = (corpo, markdown, { ultima = false } = {}) => {
    if (!corpo || !String(markdown || '').trim()) return;
    const caixa = corpo.parentElement || corpo;
    caixa.querySelector(':scope > .resposta-acoes')?.remove();
    // só a última resposta pode ser refeita
    if (ultima) document.querySelectorAll('.resposta-acoes [data-a="refazer"]').forEach((b) => b.remove());
    const linha = document.createElement('div');
    linha.className = 'resposta-acoes';
    linha.innerHTML = `<button type="button" class="acao-resposta" data-a="copiar" title="${tr('Copiar a resposta')}" aria-label="${tr('Copiar a resposta')}">${ICONES.copiar}</button>${ultima ? `<button type="button" class="acao-resposta" data-a="refazer" title="${tr('Refazer a resposta')}" aria-label="${tr('Refazer a resposta')}">${ICONES.refazer}</button>` : ''}`;
    linha.querySelector('[data-a="copiar"]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (await copiar(markdown)) {
        b.innerHTML = ICONES.ok;
        b.classList.add('feito');
        setTimeout(() => ((b.innerHTML = ICONES.copiar), b.classList.remove('feito')), 1500);
      }
    });
    linha.querySelector('[data-a="refazer"]')?.addEventListener('click', refazerUltima);
    const modelo = caixa.querySelector(':scope > .msg-modelo');
    if (modelo) linha.appendChild(modelo);
    caixa.appendChild(linha);
  };

  window.sugestoesDeContinuacao = async (corpo, pergunta, markdown) => {
    document.querySelectorAll('.sugestoes-continuacao').forEach((s) => s.remove());
    // resposta curta (uma conta, um "bom dia", o clima): sem sugestões — gastava 1 a 2 s de placa à toa
    if (!corpo || !pergunta || String(markdown || '').trim().length < 400 || typeof api.sugestoes !== 'function') return;
    const caixa = corpo.parentElement || corpo;
    const lista = await api.sugestoes(String(pergunta).slice(0, 600), String(markdown)).catch(() => []);
    // chegou tarde: outra pergunta já começou, ou esta resposta saiu da tela
    if (!lista?.length || agente.rodando || !caixa.isConnected || caixa !== [...el.aMensagens.querySelectorAll(':scope > .msg.ia')].at(-1)) return;
    const d = document.createElement('div');
    d.className = 'sugestoes-continuacao';
    d.innerHTML = lista.map((s) => `<button type="button" class="sugestao">${s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}<span aria-hidden="true">→</span></button>`).join('');
    d.querySelectorAll('.sugestao').forEach((b, i) => b.addEventListener('click', () => {
      d.remove();
      el.aEntrada.value = lista[i];
      enviarPedido();
    }));
    caixa.appendChild(d);
    rolar?.(el.aRolagem, true);
  };
})();
