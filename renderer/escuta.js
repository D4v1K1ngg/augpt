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
  const ANTES = 7; // pedaços de ~85 ms guardados antes da fala começar (o começo do nome não fica cortado)
  // fala de verdade (25/10): 3 pedaços com som de voz entre os 5 últimos (~250 ms) — clique de teclado e
  // estalo são curtos; e a energia concentrada na faixa da fala, até 4 kHz (renderer/voz.js, faixaDeVoz)
  const PEDACOS_DE_FALA = 3;
  const FAIXA_MINIMA = 0.65;
  const FIM_DA_FRASE = 500; // ms de silêncio: a frase acabou, confere a chamada
  const FRASE_MAX = 2600; // confere no máximo os primeiros ~2,6 s (a chamada vem no começo)
  const FIM_DO_PEDIDO = 1600; // ms de silêncio depois do pedido
  const ESPERA_O_PEDIDO = 7000; // só "Ei GPT" e nada depois: desiste
  const PEDIDO_MAX = 60000;

  let e = null; // a escuta ligada
  // o nome que chama (Ajustes → Geral / boas-vindas); "GPT" é o "Ei GPT" de sempre
  const nome = () => {
    const n = String((typeof config !== 'undefined' && config?.nomeDaChamada) || 'GPT').trim();
    return /^(gpt|augpt|ei gpt|chatgpt)$/i.test(n) ? 'Ei GPT' : n;
  };
  // as gravações do treino (a impressão do som) e o limite delas — comparadas com cada frase
  let voz = { modelos: [], limite: null };
  async function recarregarVoz() {
    const modelos = await api.ditado.vozDoUsuario().catch(() => []);
    voz = { modelos, limite: window.vozDoUsuario?.limiteDosModelos(modelos) ?? null };
    return voz;
  }

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
      b.title = ligada ? tr('Ouvindo "{nome}" — ou clique para ditar (Ctrl+Shift+Espaço)', { nome: nome() }) : tr('Falar em vez de digitar (Ctrl+Shift+Espaço)');
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
      avisar(tr('O "{nome}" não conseguiu abrir o microfone ({erro}).', { nome: nome(), erro: err.name || err.message }), 9000);
      return false;
    }
    await recarregarVoz();
    const contexto = new AudioContext();
    const processador = contexto.createScriptProcessor(4096, 1, 1);
    contexto.createMediaStreamSource(fluxo).connect(processador);
    processador.connect(contexto.destination);
    e = { fluxo, contexto, processador, taxa: contexto.sampleRate, estado: 'esperando', antes: [], trecho: [], ruido: 0.004, ultimaFala: 0, inicio: 0, surdoAte: 0, recentes: [] };
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
    e.recentes = [];
    e.corte = 0;
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
    // alto o bastante E com cara de voz (a faixa da fala); a conta da faixa só roda quando o som é alto
    const fala = t > e.surdoAte && nivel > Math.max(limite, e.ruido * 3) && (window.vozDoUsuario?.faixaDeVoz(dados, e.taxa) ?? 1) >= FAIXA_MINIMA;
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
        e.recentes.push(fala);
        if (e.recentes.length > 5) e.recentes.shift();
        // só começa com ~250 ms de voz (3 dos 5 últimos pedaços): um clique solto não abre frase
        if (e.recentes.filter(Boolean).length >= PEDACOS_DE_FALA) {
          e.trecho = [...e.antes]; // o pedaço atual já está no "antes"
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
          avisar(tr('Ouvi o "{nome}", mas não o pedido. Tente: "{nome}, vai chover amanhã?"', { nome: nome() }), 6000);
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
    let pelaVoz = null;
    try {
      const wav = await window.ditadoPorVoz.paraWav(g.trecho.slice(), g.taxa);
      // o som da sua voz comparado com as gravações do treino (~5 ms, aqui mesmo); quem decide é o
      // processo principal, junto com o texto do Whisper (renderer/voz.js, src/ditado.js lembraONome)
      if (voz.limite) pelaVoz = window.vozDoUsuario.reconhecer(window.vozDoUsuario.doWav(wav), voz.modelos, voz.limite);
      r = await api.ditado.chamada(wav, pelaVoz ? { chamou: pelaVoz.chamou, custo: pelaVoz.custo, limite: pelaVoz.limite } : null);
    } catch {
      r = null;
    }
    if (e !== g || g.estado !== 'conferindo') return; // desligada ou o botão do microfone assumiu
    if (!r?.ok || !r.chamou) {
      g.trecho = [];
      g.estado = 'ignorando';
      return;
    }
    window.ditadoPorVoz.lembrarMicrofone?.(); // a chamada deu certo: este microfone fica lembrado
    // o AuGPT falando e você chamou: ele se cala para ouvir (27/10)
    g.calouAFala = Boolean(window.falaPorVoz?.falando());
    window.falaPorVoz?.parar();
    g.estado = 'pedido';
    g.chamadaEm = Date.now();
    g.restoNaChamada = Boolean(r.resto);
    // pelo som, sabemos onde o nome acabou: o pedido é o áudio dali em diante
    g.corte = pelaVoz?.chamou ? pelaVoz.corteSegundos || 0 : 0;
    g.surdoAte = Date.now() + 350; // o próprio bipe não conta como fala
    bipe();
    api.ditado.trazerJanela().catch(() => {});
    trocarAba('agente');
    avisar(tr('Pode falar…'));
  }

  async function terminarPedido() {
    const g = e;
    g.estado = 'ocupado';
    let audio = g.trecho;
    g.trecho = [];
    if (g.corte > 0) {
      let pular = Math.round(g.corte * g.taxa);
      const depois = [];
      for (const p of audio) {
        if (pular >= p.length) {
          pular -= p.length;
          continue;
        }
        depois.push(pular ? p.subarray(pular) : p);
        pular = 0;
      }
      if (depois.length) audio = depois;
    }
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
        avisar(ocupado || g.calouAFala ? tr('Parei ✓') : tr('Nada para parar.'), 3000);
      } else if (!r.pedido) {
        avisar(tr('Ouvi o "{nome}", mas não o pedido. Tente: "{nome}, vai chover amanhã?"', { nome: nome() }), 6000);
      } else if (ocupado) {
        avisar(tr('O agente ainda está respondendo. Espere terminar ou diga "{nome}, para".', { nome: nome() }), 7000);
      } else {
        let texto = r.pedido;
        if (config.ditadoCorrigir !== false) {
          avisar(tr('Corrigindo o texto…'));
          texto = (await api.ditado.corrigir(texto).catch(() => null))?.texto || texto;
        }
        avisar('');
        // "Ei GPT, o que é isso na tela?": captura a tela inteira e manda junto (renderer/tela.js)
        // pedido pela voz: a resposta pode ser falada (renderer/fala.js, "Quando falar")
        if (window.falaPorVoz) window.falaPorVoz.pedidoPorVoz = true;
        if (window.telaPorVoz?.falaDaTela(texto)) {
          await window.telaPorVoz.capturarEPerguntar(texto);
          return;
        }
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
      avisar(tr('O "{nome}" falhou: {erro}', { nome: nome(), erro: err.message }), 8000);
    } finally {
      if (e === g) voltarAEsperar();
    }
  }

  window.escutaPorVoz = { ligar, desligar, ligada: () => Boolean(e), recarregarVoz, nome, microfone: () => e?.fluxo.getAudioTracks()[0]?.label || null };
  if (typeof config !== 'undefined' && config?.ouvirChamada === true) ligar();
})();
