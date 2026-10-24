'use strict';

/**
 * Ditado por voz na caixa de mensagem (24/10): o botão de microfone (ou Ctrl+Shift+Espaço) grava,
 * para sozinho quando você para de falar (ou no clique), converte para WAV 16 kHz mono e manda para
 * o Whisper local (src/ditado.js). O texto entra na caixa para revisar — ou é enviado, se
 * "enviar sozinho" estiver ligado em Ajustes → Geral. O microfone só fica aberto enquanto grava.
 */
(function () {
  const TAXA = 16000;
  const SILENCIO_PARA_PARAR = 1600; // ms de silêncio depois de falar
  const SEM_FALA_DESISTE = 8000; // ms sem ouvir nada
  const MAXIMO = 120000; // 2 min por vez
  const ICONE = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>';

  let atual = null; // a gravação em andamento: { caixa, botao, ... }

  /** Float32 (qualquer taxa) → WAV PCM 16 bits, 16 kHz, mono. */
  async function paraWav(amostras, taxaOriginal) {
    const total = amostras.reduce((n, a) => n + a.length, 0);
    const junto = new Float32Array(total);
    let pos = 0;
    for (const a of amostras) {
      junto.set(a, pos);
      pos += a.length;
    }
    const contexto = new OfflineAudioContext(1, Math.max(1, Math.ceil((total * TAXA) / taxaOriginal)), TAXA);
    const buffer = contexto.createBuffer(1, total, taxaOriginal);
    buffer.copyToChannel(junto, 0);
    const fonte = contexto.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(contexto.destination);
    fonte.start();
    const pcm = (await contexto.startRendering()).getChannelData(0);
    const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const texto = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
    texto(0, 'RIFF');
    wav.setUint32(4, 36 + pcm.length * 2, true);
    texto(8, 'WAVE');
    texto(12, 'fmt ');
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, TAXA, true);
    wav.setUint32(28, TAXA * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    texto(36, 'data');
    wav.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i += 1) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return wav.buffer;
  }

  function aviso(botao, texto) {
    const el = botao.parentElement.querySelector('.ditado-aviso');
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  function colocarTexto(caixa, texto) {
    const antes = caixa.value;
    caixa.value = `${antes && !/\s$/.test(antes) ? `${antes} ` : antes}${texto}`;
    caixa.dispatchEvent(new Event('input', { bubbles: true }));
    caixa.focus();
    caixa.setSelectionRange(caixa.value.length, caixa.value.length);
  }

  async function comecar(caixa, botao, enviar) {
    const estado = await api.ditado.estado().catch(() => ({ instalado: false }));
    if (!estado.instalado) {
      if (confirm(tr('O ditado por voz ainda não está instalado. Abrir Ajustes → Componentes para instalar (cerca de {tamanho}, roda no seu computador)?', { tamanho: estado.tamanho || '600 MB' }))) {
        trocarAba('config');
        abrirAjuste?.('ajComponentes');
      }
      return;
    }
    let fluxo;
    try {
      fluxo = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      aviso(botao, tr('Não consegui abrir o microfone ({erro}). Confira se há um microfone ligado e se o Windows permite o acesso (Configurações → Privacidade → Microfone).', { erro: err.name || err.message }));
      setTimeout(() => aviso(botao, ''), 9000);
      return;
    }
    const contexto = new AudioContext();
    const entrada = contexto.createMediaStreamSource(fluxo);
    const processador = contexto.createScriptProcessor(4096, 1, 1);
    const amostras = [];
    const g = { caixa, botao, enviar, fluxo, contexto, processador, amostras, inicio: Date.now(), falou: false, ultimaFala: 0, ruido: 0.004, timer: null };
    atual = g;
    processador.onaudioprocess = (e) => {
      const dados = new Float32Array(e.inputBuffer.getChannelData(0));
      amostras.push(dados);
      let soma = 0;
      for (let i = 0; i < dados.length; i += 1) soma += dados[i] * dados[i];
      const nivel = Math.sqrt(soma / dados.length);
      // o piso de ruído segue o nível mais baixo do ambiente e sobe devagar; fala é bem acima dele
      // (medir só o começo falhava quando a pessoa já começa falando: a voz virava o "ruído")
      g.ruido = nivel < g.ruido ? nivel : g.ruido * 1.01;
      if (nivel > Math.max(0.012, g.ruido * 3)) {
        g.falou = true;
        g.ultimaFala = Date.now();
      }
      botao.style.setProperty('--nivel', String(Math.min(1, nivel * 8)));
    };
    entrada.connect(processador);
    processador.connect(contexto.destination);
    botao.classList.add('gravando');
    botao.setAttribute('aria-pressed', 'true');
    g.timer = setInterval(() => {
      const passou = Date.now() - g.inicio;
      const s = Math.floor(passou / 1000);
      aviso(botao, tr('Ouvindo… {tempo} — pare de falar ou clique para terminar', { tempo: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }));
      if ((g.falou && Date.now() - g.ultimaFala > SILENCIO_PARA_PARAR) || passou > MAXIMO) parar();
      else if (!g.falou && passou > SEM_FALA_DESISTE) parar({ descartar: tr('Não ouvi nada — tente de novo mais perto do microfone.') });
    }, 200);
  }

  async function parar({ descartar = null } = {}) {
    const g = atual;
    if (!g) return;
    atual = null;
    clearInterval(g.timer);
    g.processador.disconnect();
    g.fluxo.getTracks().forEach((t) => t.stop()); // o microfone fecha aqui
    const taxa = g.contexto.sampleRate;
    g.contexto.close();
    g.botao.classList.remove('gravando');
    g.botao.setAttribute('aria-pressed', 'false');
    if (descartar || !g.falou) {
      aviso(g.botao, descartar || tr('Não ouvi nada — tente de novo mais perto do microfone.'));
      setTimeout(() => aviso(g.botao, ''), 5000);
      return;
    }
    g.botao.classList.add('transcrevendo');
    g.botao.disabled = true;
    aviso(g.botao, tr('Transcrevendo…'));
    try {
      const r = await api.ditado.transcrever(await paraWav(g.amostras, taxa));
      if (!r.ok) throw new Error(r.error);
      if (!r.texto) {
        aviso(g.botao, tr('Não entendi — tente de novo.'));
        setTimeout(() => aviso(g.botao, ''), 5000);
        return;
      }
      aviso(g.botao, '');
      colocarTexto(g.caixa, r.texto);
      // "enviar sozinho" — nunca enquanto o agente responde (o botão vira "parar")
      if (config.ditadoEnviarSozinho === true && !g.enviar.classList.contains('parando')) g.enviar.click();
    } catch (err) {
      aviso(g.botao, tr('O ditado falhou: {erro}', { erro: err.message }));
      setTimeout(() => aviso(g.botao, ''), 8000);
    } finally {
      g.botao.classList.remove('transcrevendo');
      g.botao.disabled = false;
    }
  }

  function alternar(caixa, botao, enviar) {
    if (atual) parar();
    else comecar(caixa, botao, enviar);
  }

  // um botão em cada caixa de mensagem (Agente e Conversa), antes do enviar
  const caixas = [['entradaAgente', 'btnEnviarAgente'], ['entradaChat', 'btnEnviarChat']].map(([idCaixa, idEnviar]) => {
    const caixa = $(idCaixa);
    const enviar = $(idEnviar) || caixa?.parentElement.querySelector('.btn-enviar');
    if (!caixa || !enviar) return null;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn-microfone';
    botao.title = tr('Falar em vez de digitar (Ctrl+Shift+Espaço)');
    botao.setAttribute('aria-label', tr('Ditado por voz'));
    botao.setAttribute('aria-pressed', 'false');
    botao.innerHTML = ICONE;
    const avisoEl = document.createElement('span');
    avisoEl.className = 'ditado-aviso';
    avisoEl.hidden = true;
    avisoEl.setAttribute('aria-live', 'polite');
    enviar.before(botao);
    caixa.parentElement.append(avisoEl);
    botao.addEventListener('click', () => alternar(caixa, botao, enviar));
    return { caixa, botao, enviar };
  }).filter(Boolean);

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.code === 'Space')) return;
    const alvo = caixas.find((c) => c.caixa.offsetParent !== null); // a caixa da aba visível
    if (!alvo) return;
    e.preventDefault();
    alternar(alvo.caixa, alvo.botao, alvo.enviar);
  });

  window.ditadoPorVoz = { parar, paraWav };
})();
