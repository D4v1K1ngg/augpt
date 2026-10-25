'use strict';

/**
 * "Ei GPT" (25/10, pedido do Davi). Com a opção ligada (Ajustes → Geral), o microfone fica aberto e
 * cada frase curta passa pelo Whisper base (~0,2 s, no processador). Se ela começa com "Ei GPT":
 * bipe, a janela vem para frente e o pedido é gravado até você parar de falar; o turbo transcreve, o
 * modelo corrige a ortografia (se ligado) e o pedido vai sozinho para o Agente.
 *   "Ei GPT, vai chover amanhã?"  → numa frase só
 *   "Ei GPT" … (bipe) … "que horas são?" → em duas
 *   "Ei GPT, nova conversa" / "Ei GPT, para" → comandos diretos
 * Fala sem a chamada é descartada na hora: o áudio não fica guardado em lugar nenhum.
 */
(function () {
  const ANTES = 4; // pedaços de ~85 ms guardados antes da fala começar (o "Ei" não fica cortado)
  const FIM_DA_FRASE = 500; // ms de silêncio: a frase acabou, confere a chamada
  const FRASE_MAX = 2600; // confere no máximo os primeiros ~2,6 s (a chamada vem no começo)
  const FIM_DO_PEDIDO = 1600; // ms de silêncio depois do pedido
  const ESPERA_O_PEDIDO = 7000; // só "Ei GPT" e nada depois: desiste
  const PEDIDO_MAX = 60000;

  let e = null; // a escuta ligada

  function bipe() {
    try {
      const c = new AudioContext();
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.2);
      o.onended = () => c.close();
    } catch {
      // sem som: segue
    }
  }

  const alvo = () => window.ditadoPorVoz?.doAgente();
  function avisar(texto, ms = 0) {
    const a = alvo();
    if (!a) return;
    window.ditadoPorVoz.aviso(a.botao, texto);
    if (ms) setTimeout(() => window.ditadoPorVoz.aviso(a.botao, ''), ms);
  }

  // o botão do microfone mostra que a escuta está ligada
  function marcar(ligada) {
    for (const b of window.ditadoPorVoz?.botoes() || []) {
      b.classList.toggle('escutando', ligada);
      b.title = ligada ? tr('Ouvindo "Ei GPT" — ou clique para ditar (Ctrl+Shift+Espaço)') : tr('Falar em vez de digitar (Ctrl+Shift+Espaço)');
    }
  }

  let ligando = null; // dois pedidos ao mesmo tempo (abertura + Ajustes) abrem um microfone só
  function ligar() {
    if (e) return Promise.resolve(true);
    ligando ||= abrir().finally(() => (ligando = null));
    return ligando;
  }

  async function abrir() {
    const estado = await api.ditado.estado().catch(() => ({}));
    if (!estado.escuta) return false;
    let fluxo;
    try {
      fluxo = await window.ditadoPorVoz.abrirMicrofone();
    } catch (err) {
      avisar(tr('O "Ei GPT" não conseguiu abrir o microfone ({erro}).', { erro: err.name || err.message }), 9000);
      return false;
    }
    const contexto = new AudioContext();
    const processador = contexto.createScriptProcessor(4096, 1, 1);
    contexto.createMediaStreamSource(fluxo).connect(processador);
    processador.connect(contexto.destination);
    e = { fluxo, contexto, processador, taxa: contexto.sampleRate, estado: 'esperando', antes: [], trecho: [], ruido: 0.004, ultimaFala: 0, inicio: 0, surdoAte: 0 };
    processador.onaudioprocess = (ev) => e && passo(new Float32Array(ev.inputBuffer.getChannelData(0)));
    marcar(true);
    return true;
  }

  function desligar() {
    if (!e) return;
    const g = e;
    e = null;
    g.processador.disconnect();
    g.fluxo.getTracks().forEach((t) => t.stop()); // o microfone fecha aqui
    g.contexto.close();
    marcar(false);
  }

  function voltarAEsperar() {
    if (!e) return;
    e.estado = 'esperando';
    e.antes = [];
    e.trecho = [];
  }

  function passo(dados) {
    let soma = 0;
    for (let i = 0; i < dados.length; i += 1) soma += dados[i] * dados[i];
    const nivel = Math.sqrt(soma / dados.length);
    // o mesmo detector de fala do ditado: piso de ruído que acompanha o ambiente
    e.ruido = nivel < e.ruido ? nivel : e.ruido * 1.01;
    const t = Date.now();
    // o limite de fala vem do treino da voz (Ajustes → Geral); sem treino, 0,006 — o mesmo do ditado
    const limite = Number(config?.escutaSensibilidade) > 0 ? Number(config.escutaSensibilidade) : 0.006;
    const fala = t > e.surdoAte && nivel > Math.max(limite, e.ruido * 3);
    if (fala) e.ultimaFala = t;
    // o botão do microfone está gravando: ele manda
    if (window.ditadoPorVoz.gravando()) {
      if (e.estado !== 'esperando' && e.estado !== 'ocupado') voltarAEsperar();
      return;
    }
    switch (e.estado) {
      case 'esperando':
        e.antes.push(dados);
        if (e.antes.length > ANTES) e.antes.shift();
        if (fala) {
          e.trecho = [...e.antes, dados];
          e.inicio = t;
          e.estado = 'frase';
        }
        break;
      case 'frase':
        e.trecho.push(dados);
        if (t - e.ultimaFala > FIM_DA_FRASE || t - e.inicio > FRASE_MAX) conferir();
        break;
      case 'conferindo':
        e.trecho.push(dados);
        if (fala) e.falouDepois = true;
        break;
      case 'ignorando': // fala sem a chamada: espera ela acabar
        if (t - e.ultimaFala > 700) voltarAEsperar();
        break;
      case 'pedido': {
        e.trecho.push(dados);
        if (fala) e.falouDepois = true;
        const temPedido = e.falouDepois || e.restoNaChamada;
        const barras = Math.min(8, Math.round(nivel * 80));
        if (t - (e.ultimoAviso || 0) > 200) {
          e.ultimoAviso = t;
          avisar(`${tr('Pode falar…')}  ${'▮'.repeat(barras)}${'▯'.repeat(8 - barras)}`);
        }
        if (temPedido && t - e.ultimaFala > FIM_DO_PEDIDO) terminarPedido();
        else if (!temPedido && t - e.chamadaEm > ESPERA_O_PEDIDO) {
          avisar(tr('Ouvi o "Ei GPT", mas não o pedido. Tente: "Ei GPT, vai chover amanhã?"'), 6000);
          voltarAEsperar();
        } else if (t - e.inicio > PEDIDO_MAX) terminarPedido();
        break;
      }
      default: // 'ocupado': transcrevendo ou enviando
        break;
    }
  }

  async function conferir() {
    const g = e;
    g.estado = 'conferindo';
    g.falouDepois = false;
    let r = null;
    try {
      r = await api.ditado.chamada(await window.ditadoPorVoz.paraWav(g.trecho.slice(), g.taxa));
    } catch {
      r = null;
    }
    if (e !== g || g.estado !== 'conferindo') return; // desligada ou o botão do microfone assumiu
    if (!r?.ok || !r.chamou) {
      g.trecho = [];
      g.estado = 'ignorando';
      return;
    }
    g.estado = 'pedido';
    g.chamadaEm = Date.now();
    g.restoNaChamada = Boolean(r.resto);
    g.surdoAte = Date.now() + 350; // o próprio bipe não conta como fala
    bipe();
    api.ditado.trazerJanela().catch(() => {});
    trocarAba('agente');
    avisar(tr('Pode falar…'));
  }

  async function terminarPedido() {
    const g = e;
    g.estado = 'ocupado';
    const audio = g.trecho;
    g.trecho = [];
    const a = alvo();
    try {
      avisar(tr('Transcrevendo…'));
      const r = await api.ditado.pedidoDeVoz(await window.ditadoPorVoz.paraWav(audio, g.taxa));
      if (!r.ok) throw new Error(r.error);
      const ocupado = a.enviar.classList.contains('parando');
      if (r.comando === 'nova-conversa') {
        if (ocupado) a.enviar.click();
        novaConversa('agente');
        avisar(tr('Nova conversa ✓'), 3000);
      } else if (r.comando === 'parar') {
        if (ocupado) a.enviar.click();
        avisar(ocupado ? tr('Parei ✓') : tr('Nada para parar.'), 3000);
      } else if (!r.pedido) {
        avisar(tr('Ouvi o "Ei GPT", mas não o pedido. Tente: "Ei GPT, vai chover amanhã?"'), 6000);
      } else if (ocupado) {
        avisar(tr('O agente ainda está respondendo. Espere terminar ou diga "Ei GPT, para".'), 7000);
      } else {
        let texto = r.pedido;
        if (config.ditadoCorrigir !== false) {
          avisar(tr('Corrigindo o texto…'));
          texto = (await api.ditado.corrigir(texto).catch(() => null))?.texto || texto;
        }
        avisar('');
        trocarAba('agente');
        // o que você tinha digitado volta para a caixa depois do envio
        const rascunho = a.caixa.value;
        a.caixa.value = texto;
        a.caixa.dispatchEvent(new Event('input', { bubbles: true }));
        a.enviar.click();
        if (rascunho.trim()) setTimeout(() => {
          a.caixa.value = rascunho;
          a.caixa.dispatchEvent(new Event('input', { bubbles: true }));
        }, 0);
      }
    } catch (err) {
      avisar(tr('O "Ei GPT" falhou: {erro}', { erro: err.message }), 8000);
    } finally {
      if (e === g) voltarAEsperar();
    }
  }

  window.escutaPorVoz = { ligar, desligar, ligada: () => Boolean(e) };
  if (typeof config !== 'undefined' && config?.ouvirChamada === true) ligar();
})();
