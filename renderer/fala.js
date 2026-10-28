'use strict';

/**
 * A voz do AuGPT, do lado da tela (27/10; o motor é src/fala/voz.js no processo principal):
 * - toca o áudio frase por frase, à medida que chega (a 1ª fica pronta em ~0,7 s);
 * - fala a resposta quando ela termina: só quando você chamou pela voz (padrão), sempre ou nunca;
 * - para com "Ei Jarvis, para", com um pedido novo, com Esc ou com o botão "■ Parar a voz";
 * - Ajustes → Geral → Voz do AuGPT: baixar, escolher a voz e a velocidade, testar.
 */
(function () {
  let contexto = null;
  let fontes = [];
  let proximo = 0;
  let atual = null; // id da fala em andamento (o processo principal numera)
  let fimRecebido = false;

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'parar-voz';
  botao.hidden = true;
  botao.textContent = tr('■ Parar a voz');
  document.body.appendChild(botao);

  function mostrar(sim) {
    botao.hidden = !sim;
  }

  /*
   * Conversa estilo Jarvis (27/10): resposta curta enquanto pensa ("Um momento.") e, quando a resposta de um
   * pedido pela voz termina de ser falada, o aviso 'augpt-fala-terminou' — a escuta fica ouvindo a réplica.
   */
  let seguir = false; // esta fala respondeu a um pedido pela voz
  let fimDaConfirmacao = null;
  let soltarConfirmacao = () => {};

  function terminou() {
    atual = null;
    mostrar(false);
    soltarConfirmacao();
    if (seguir) {
      seguir = false;
      window.dispatchEvent(new Event('augpt-fala-terminou'));
    }
  }

  function tocar(pcm, taxa) {
    contexto ||= new AudioContext();
    const dados = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
    const buffer = contexto.createBuffer(1, dados.length, taxa);
    buffer.copyToChannel(dados, 0);
    const fonte = contexto.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(contexto.destination);
    // uma frase emendada na outra, sem buraco e sem sobrepor
    const inicio = Math.max(contexto.currentTime + 0.05, proximo);
    fonte.start(inicio);
    proximo = inicio + buffer.duration;
    fontes.push(fonte);
    fonte.onended = () => {
      fontes = fontes.filter((f) => f !== fonte);
      if (!fontes.length && fimRecebido) terminou();
    };
  }

  manipuladores['voz-audio'] = ({ id, pcm, taxa, fim, erro } = {}) => {
    if (id !== atual) return;
    if (pcm?.length) {
      tocar(pcm, taxa || 24000);
      mostrar(true);
    }
    if (fim) {
      fimRecebido = true;
      if (!fontes.length) terminou();
    }
    if (erro) console.warn('voz:', erro);
  };

  function parar() {
    if (atual !== null) api.voz.parar().catch(() => {});
    atual = null;
    seguir = false; // parou no meio: não fica ouvindo
    soltarConfirmacao();
    for (const f of fontes) {
      try {
        f.stop();
      } catch {
        // já tinha acabado
      }
    }
    fontes = [];
    proximo = 0;
    mostrar(false);
  }

  async function falar(texto, opcoes = {}) {
    // a resposta não corta o "Um momento." no meio: espera ele acabar (no máximo 3 s)
    if (fimDaConfirmacao) await Promise.race([fimDaConfirmacao, new Promise((ok) => setTimeout(ok, 3000))]);
    parar();
    const r = await api.voz.falar(texto, opcoes).catch((err) => ({ ok: false, error: err.message }));
    if (r?.ok) {
      atual = r.id;
      fimRecebido = false;
      proximo = 0;
    }
    return r;
  }

  botao.addEventListener('click', parar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && atual !== null) parar();
  });

  // quando falar: só quando você chamou pela voz (padrão), sempre ou nunca; a conversão é do português
  let vozInstalada = false;
  api.voz.estado().then((e) => (vozInstalada = e.instalada === true)).catch(() => {});
  const deveFalar = () => {
    const quando = config.vozFalar || 'voz';
    return vozInstalada && quando !== 'nunca' && (quando === 'sempre' || window.falaPorVoz.pedidoPorVoz) && window.i18n?.idioma !== 'en';
  };

  /*
   * A fala começa durante a escrita (27/10): com a 1ª frase pronta na tela (80+ letras), já fala; no fim,
   * só o que falta do resumo. Fica para o fim (como antes) a pergunta de preço, de produto ou que muda
   * com o tempo — a conferência ainda pode mexer num número —, e uma resposta que foi reescrita.
   */
  const turnoDaFala = { podeAntes: false, falouAntes: false, texto: '', inicio: 0, objetivo: '' };
  const comecoOriginal = manipuladores.inicio;
  manipuladores.inicio = (d) => {
    Object.assign(turnoDaFala, { podeAntes: true, falouAntes: false, texto: '', inicio: Date.now(), objetivo: String(d?.objetivo || '') });
    return comecoOriginal?.(d);
  };
  const entendimentoOriginal = manipuladores['nucleo-entendimento'];
  manipuladores['nucleo-entendimento'] = (d = {}) => {
    // produto espera o fim (o preço da loja ainda é conferido); "muda com o tempo" não serve de regra — o
    // modelo marcava até "quanto tempo vive uma calopsita" (27/10); preço e % no texto barram abaixo
    if (d.produto) turnoDaFala.podeAntes = false;
    return entendimentoOriginal?.(d);
  };
  const reiniciaOriginal = manipuladores['resposta-reinicia'];
  manipuladores['resposta-reinicia'] = (d) => {
    turnoDaFala.podeAntes = false;
    if (turnoDaFala.falouAntes) {
      turnoDaFala.falouAntes = false;
      parar();
    }
    return reiniciaOriginal?.(d);
  };
  const tokenOriginal = manipuladores['resposta-token'];
  manipuladores['resposta-token'] = (d = {}) => {
    const r = tokenOriginal?.(d);
    if (turnoDaFala.podeAntes && !turnoDaFala.falouAntes && deveFalar()) {
      turnoDaFala.texto += d.pedaco || '';
      // só o texto corrido: para antes de tabela, bloco de código ou da lista de fontes
      const corrido = turnoDaFala.texto.split(/```|\n\s*\||\n-{3,}/)[0];
      const fins = [...corrido.matchAll(/[.!?…](?=\s)/g)];
      // preço ou porcentagem no começo: a conferência pode tirar ou marcar — espera a resposta inteira
      if (/R\$|US\$|€|%/.test(corrido)) turnoDaFala.podeAntes = false;
      else if (fins.length >= 1 && corrido.length >= 80) {
        turnoDaFala.falouAntes = true;
        falar(corrido.slice(0, fins[fins.length - 1].index + 1), { parcial: true });
      }
    }
    return r;
  };

  // a resposta terminou: fala (ou continua a fala que começou durante a escrita)
  const concluidoOriginal = manipuladores.concluido;
  manipuladores.concluido = (d = {}) => {
    concluidoOriginal(d);
    const falar1 = deveFalar() && d.resumo;
    const porVoz = window.falaPorVoz.pedidoPorVoz && config.conversaContinua !== false;
    window.falaPorVoz.pedidoPorVoz = false;
    turnoDaFala.podeAntes = false;
    if (!falar1) return;
    if (turnoDaFala.falouAntes) {
      // você parou no meio (Esc, botão, "para"): não recomeça; senão, continua de onde parou
      if (atual !== null) {
        seguir = porVoz;
        api.voz.falar(d.resumo, { continuar: true }).catch(() => {});
      }
      return;
    }
    falar(d.resumo).then((r) => {
      if (r?.ok && atual === r.id) seguir = porVoz;
    });
  };
  for (const fim of ['erro', 'interrompido', 'limite']) {
    const original = manipuladores[fim];
    manipuladores[fim] = (d) => {
      window.falaPorVoz.pedidoPorVoz = false;
      turnoDaFala.podeAntes = false;
      if (turnoDaFala.falouAntes) parar(); // a resposta não terminou: o começo dito não vale
      return original?.(d);
    };
  }

  // o pedido pela voz foi enviado e a resposta demora: uma frase curta, como o Jarvis (só em português)
  const CONFIRMACOES = ['Um momento.', 'Certo, já vejo isso.', 'Deixa comigo.', 'Só um instante.'];
  async function confirmar() {
    if (!deveFalar() || atual !== null || !agente.rodando) return;
    const r = await falar(CONFIRMACOES[Math.floor(Math.random() * CONFIRMACOES.length)], { resumir: false });
    if (!r?.ok || atual !== r.id) return;
    fimDaConfirmacao = new Promise((ok) => {
      soltarConfirmacao = () => {
        soltarConfirmacao = () => {};
        fimDaConfirmacao = null;
        ok();
      };
    });
  }

  // aviso falado (lembrete, tarefa pronta, novidade): o processo principal já conferiu o silêncio e se o PC
  // está livre; aqui, só não fala por cima de outra fala nem de uma resposta em andamento
  manipuladores['aviso-falado'] = ({ texto } = {}) => {
    if (!texto || !vozInstalada || config.avisosFalados === false || atual !== null || agente.rodando) return;
    falar(texto);
  };

  /*
   * Etapa 2 do Jarvis (28/10): com o modelo principal ocupado, o pedido pela voz vai para o modelo leve na CPU
   * (src/fala/voz-paralela.js). Ele recebe o pedido em andamento e o que o painel de atividade mostra; o que ele
   * marca [FILA] (pesquisa, fato, ação) vai para o segundo plano, para o modelo principal fazer depois.
   */
  // a etapa atual (o último item do painel de atividade) e o resumo ("6 buscas · 3 páginas em 3 sites")
  function andamentoNaTela() {
    const paineis = document.querySelectorAll('#agenteMensagens .atividade');
    const p = paineis[paineis.length - 1];
    if (!p) return { etapa: '', resumo: '' };
    const etapas = p.querySelectorAll('.atividade-etapas li');
    return { etapa: etapas[etapas.length - 1]?.innerText.trim() || '', resumo: p.querySelector('.atividade-resumo')?.textContent.trim() || '' };
  }
  async function emParalelo(texto) {
    const r = await api.voz.paralela({ texto, objetivo: turnoDaFala.objetivo, ...andamentoNaTela(), segundos: turnoDaFala.inicio ? (Date.now() - turnoDaFala.inicio) / 1000 : 0 }).catch(() => null);
    if (!r?.ok || !r.resposta) return null;
    if (r.fila) await api.fundo.adicionar(texto).catch(() => null);
    if (vozInstalada && window.i18n?.idioma !== 'en') {
      const f = await falar(r.resposta, { resumir: false });
      // depois de falar, continua ouvindo (a réplica da etapa 1) — a conversa segue enquanto ele trabalha
      if (f?.ok && atual === f.id && config.conversaContinua !== false) seguir = true;
    }
    return { ...r, resposta: r.fila ? `${r.resposta} — ${tr('Coloquei na fila: {texto}', { texto: String(texto).slice(0, 60) })}` : r.resposta };
  }
  // o modelo leve carregado antes da primeira conversa (só com a escuta ligada: sem ela, não há conversa pela voz)
  if (typeof config !== 'undefined' && config?.modeloDaVoz && config?.ouvirChamada) setTimeout(() => api.voz.aquecer().catch(() => {}), 15000);

  window.falaPorVoz = { falar, parar, confirmar, emParalelo, falando: () => atual !== null, pedidoPorVoz: false };

  /* ---------------- Ajustes → Geral → Voz do AuGPT ---------------- */
  const $id = (x) => document.getElementById(x);
  async function pintarVoz() {
    const status = $id('vozStatus');
    if (!status) return;
    const e = await api.voz.estado().catch(() => ({}));
    const pronta = e.instalada === true;
    vozInstalada = pronta;
    for (const linha of document.querySelectorAll('.voz-opcao')) linha.hidden = !pronta;
    $id('btnVozInstalar').hidden = pronta;
    $id('btnVozTestar').hidden = !pronta;
    if (!e.instalando) status.textContent = pronta ? tr('Instalada ✓') : tr('Não instalada — baixa uma vez cerca de {mb} MB.', { mb: e.tamanhoMB || 410 });
    $id('btnVozInstalar').disabled = Boolean(e.instalando);
    const sel = $id('cfgVozNome');
    if (sel && e.vozes && !sel.options.length) {
      for (const [chave, v] of Object.entries(e.vozes)) sel.append(new Option(tr(v.nome), chave));
    }
    if (sel) sel.value = config.vozNome || 'pm_alex';
    $id('cfgVozFalar').value = config.vozFalar || 'voz';
    if ($id('cfgConversaContinua')) $id('cfgConversaContinua').checked = config.conversaContinua !== false;
    if ($id('cfgAvisosFalados')) $id('cfgAvisosFalados').checked = config.avisosFalados !== false;
    // os mesmos modelos do seletor do topo (já sem os de embedding e de decisão)
    const leve = $id('cfgModeloDaVoz');
    if (leve) {
      const nomes = [...(document.getElementById('modelo')?.options || [])].map((o) => o.value).filter(Boolean);
      if (config.modeloDaVoz && !nomes.includes(config.modeloDaVoz)) nomes.push(config.modeloDaVoz);
      leve.replaceChildren(new Option(tr('Nenhum (só o modelo principal)'), ''), ...nomes.map((n) => new Option(n, n)));
      leve.value = config.modeloDaVoz || '';
    }
    if ($id('cfgSilencioDe')) $id('cfgSilencioDe').value = config.silencioDe || '';
    if ($id('cfgSilencioAte')) $id('cfgSilencioAte').value = config.silencioAte || '';
    $id('cfgVozVelocidade').value = String(Number(config.vozVelocidade) || 1);
    $id('vozVelocidadeValor').textContent = `${(Number(config.vozVelocidade) || 1).toFixed(2).replace('.', ',')}×`;
  }
  window.vozNosAjustes = { pintar: pintarVoz };

  manipuladores['voz-progresso'] = ({ texto } = {}) => {
    if ($id('vozStatus')) $id('vozStatus').textContent = texto || '';
  };
  $id('btnVozInstalar')?.addEventListener('click', async () => {
    $id('btnVozInstalar').disabled = true;
    const r = await api.voz.instalar();
    if (!r.ok) $id('vozStatus').textContent = tr('A instalação falhou: {erro}', { erro: r.error });
    pintarVoz();
  });
  $id('btnVozTestar')?.addEventListener('click', () => {
    const nome = String(config.nomeDoUsuario || '').trim();
    // a frase do teste é em português de propósito: a voz fala português
    const assistente = window.escutaPorVoz?.nome?.().replace(/^Ei\s+/i, '') || 'AuGPT';
    falar(`Pois não${nome ? `, ${nome}` : ''}. Eu sou o ${assistente}, e agora também falo. A cotação do dólar hoje é R$ 5,44.`, { resumir: false });
  });
  const salvar = async (patch) => {
    config = await api.config.set(patch);
    pintarVoz();
  };
  $id('cfgVozNome')?.addEventListener('change', (e) => salvar({ vozNome: e.target.value }));
  $id('cfgVozFalar')?.addEventListener('change', (e) => salvar({ vozFalar: e.target.value }));
  $id('cfgConversaContinua')?.addEventListener('change', (e) => salvar({ conversaContinua: e.target.checked }));
  $id('cfgAvisosFalados')?.addEventListener('change', (e) => salvar({ avisosFalados: e.target.checked }));
  $id('cfgModeloDaVoz')?.addEventListener('change', async (e) => {
    await salvar({ modeloDaVoz: e.target.value });
    if (e.target.value) api.voz.aquecer().catch(() => {});
  });
  $id('cfgSilencioDe')?.addEventListener('change', (e) => salvar({ silencioDe: e.target.value }));
  $id('cfgSilencioAte')?.addEventListener('change', (e) => salvar({ silencioAte: e.target.value }));
  $id('cfgVozVelocidade')?.addEventListener('input', (e) => ($id('vozVelocidadeValor').textContent = `${Number(e.target.value).toFixed(2).replace('.', ',')}×`));
  $id('cfgVozVelocidade')?.addEventListener('change', (e) => salvar({ vozVelocidade: Number(e.target.value) }));
  document.querySelector('[data-painel="ajGeral"]')?.addEventListener('click', () => setTimeout(pintarVoz, 50));
  document.getElementById('navConfig')?.addEventListener('click', () => setTimeout(pintarVoz, 50));
})();
