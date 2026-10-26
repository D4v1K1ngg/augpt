'use strict';

/**
 * A página do AuGPT no celular (26/10, fase 1). O pedido vai para o PC (POST /api/enviar), que roda como se
 * você tivesse digitado lá; os eventos do agente chegam por /api/eventos (SSE). As respostas e os cartões
 * usam os mesmos scripts da tela do PC (md.js, grafico.js, clima.js, mapa.js, compras.js, calendario.js).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  // o mapa pede os pedaços a esta página (src/remoto.js → src/mapa-tiles.js)
  window.AUGPT_MAPA = `${location.origin}/mapa/`;

  const s = { idConversa: null, meu: false, rodandoNoPc: false, turno: null, aoVivo: '', en: false };
  // os textos desta página levam as duas línguas juntas (o idioma vem do PC, /api/estado)
  const fala = (pt, en) => (s.en ? en : pt);

  /* ---------------- conversa com o PC ---------------- */
  const post = (rota, corpo) =>
    fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AuGPT': '1' }, body: JSON.stringify(corpo || {}) })
      .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))
      .catch(() => ({ status: 0, ok: false, erro: fala('Sem conexão com o PC.', 'No connection to the PC.') }));
  const get = (rota) => fetch(rota).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  /* ---------------- os endereços internos do app viram os desta página ---------------- */
  const interno = (v) => String(v).replace(/^augpt-img:\/\//, '/img/').replace(/^augpt-caixa:\/\//, '/caixa/');
  function trocarEnderecos(raiz) {
    for (const el of raiz.querySelectorAll?.('[src^="augpt-"], [href^="augpt-"]') || []) {
      for (const a of ['src', 'href']) if (el.getAttribute(a)?.startsWith('augpt-')) el.setAttribute(a, interno(el.getAttribute(a)));
    }
  }
  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (m.type === 'attributes' && m.target.getAttribute(m.attributeName)?.startsWith('augpt-')) m.target.setAttribute(m.attributeName, interno(m.target.getAttribute(m.attributeName)));
      for (const n of m.addedNodes || []) if (n.nodeType === 1) {
        if (n.matches?.('[src^="augpt-"], [href^="augpt-"]')) trocarEnderecos(n.parentNode || n);
        trocarEnderecos(n);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
  // links das respostas abrem fora (o PC usa o navegador do Windows)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.getAttribute('href').startsWith('#')) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  });

  /* ---------------- a tela ---------------- */
  const lista = $('mMensagens');
  const rolar = () => requestAnimationFrame(() => (lista.scrollTop = lista.scrollHeight));
  const faixa = (texto, erro = false) => {
    $('mFaixa').hidden = !texto;
    $('mFaixa').textContent = texto || '';
    $('mFaixa').classList.toggle('erro', erro);
  };
  function ocupado(sim) {
    const b = $('mEnviar');
    b.classList.toggle('parando', sim);
    b.textContent = sim ? '■' : '↑';
    b.setAttribute('aria-label', sim ? fala('Parar', 'Stop') : fala('Enviar', 'Send'));
  }
  function limpar() {
    lista.replaceChildren($('mVazio'));
    $('mVazio').hidden = false;
  }
  function bolhaEu(texto) {
    $('mVazio').hidden = true;
    const d = document.createElement('div');
    d.className = 'm-eu';
    d.textContent = texto;
    lista.append(d);
    rolar();
  }
  function respostaPronta(md, onde = null) {
    const d = onde || document.createElement('div');
    d.className = 'm-ia';
    const corpo = document.createElement('div');
    corpo.className = 'msg-corpo';
    corpo.innerHTML = window.md.render(String(md || ''));
    d.replaceChildren(corpo);
    if (!onde) lista.append(d);
    trocarEnderecos(corpo);
    window.md.montarGraficos(corpo);
    return d;
  }
  function novoTurno() {
    const d = document.createElement('div');
    d.className = 'm-ia';
    const situacao = document.createElement('div');
    situacao.className = 'm-situacao';
    situacao.textContent = fala('pensando…', 'thinking…');
    const aoVivo = document.createElement('div');
    aoVivo.className = 'm-aovivo';
    d.append(situacao, aoVivo);
    lista.append(d);
    s.turno = { d, situacao, aoVivo };
    s.aoVivo = '';
    rolar();
  }
  const situacao = (texto) => s.turno && (s.turno.situacao.textContent = texto);

  /* ---------------- os eventos do agente ---------------- */
  const tratar = {
    inicio() {
      if (s.meu) return;
      // o PC começou a responder (pedido feito lá)
      s.rodandoNoPc = true;
      faixa(fala('O AuGPT está respondendo no computador…', 'AuGPT is answering on the computer…'));
      ocupado(true);
    },
    ferramenta({ nome, argumentos }) {
      if (!s.meu) return;
      const q = argumentos?.consulta || argumentos?.url || '';
      situacao(nome === 'ver_video' ? fala('vendo um vídeo…', 'watching a video…') : q ? `${fala('pesquisando', 'searching')}: ${String(q).slice(0, 80)}` : fala('trabalhando…', 'working…'));
    },
    redigindo() {
      if (s.meu) situacao(fala('escrevendo a resposta…', 'writing the answer…'));
    },
    'resposta-token'({ pedaco }) {
      if (!s.meu || !s.turno) return;
      s.aoVivo += pedaco || '';
      // o bloco do cartão (```clima, ```chart…) não aparece como texto enquanto chega
      s.turno.aoVivo.textContent = s.aoVivo.replace(/```[\s\S]*?(```|$)/g, '');
      situacao(fala('escrevendo…', 'writing…'));
      rolar();
    },
    'resposta-reinicia'() {
      if (!s.turno) return;
      s.aoVivo = '';
      s.turno.aoVivo.textContent = '';
    },
    concluido({ resumo }) {
      if (s.meu && s.turno) respostaPronta(resumo, s.turno.d);
      terminou();
      rolar();
    },
    erro({ mensagem, amigavel }) {
      if (s.meu && s.turno) {
        s.turno.situacao.remove();
        const e = document.createElement('div');
        e.className = 'm-erro';
        e.textContent = amigavel || mensagem || fala('Deu erro.', 'Something went wrong.');
        s.turno.d.append(e);
      }
      terminou();
    },
    interrompido() {
      if (s.meu && s.turno) situacao(fala('parado.', 'stopped.'));
      terminou();
    },
    aprovacao({ id, nome, descricao, risco, argumentos }) {
      if (!s.meu) return;
      const c = document.createElement('div');
      c.className = 'm-cartao';
      c.dataset.id = id;
      c.dataset.nome = nome;
      const args = Object.entries(argumentos || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n').slice(0, 2000);
      c.innerHTML = `<div><b></b> <small></small></div><p class="m-desc"></p>${args ? '<pre></pre>' : ''}<div class="m-acoes"><button type="button" class="m-sim">${fala('Executar', 'Run')}</button><button type="button" class="m-nao">${fala('Recusar', 'Decline')}</button></div>`;
      c.querySelector('b').textContent = fala(`Executar ${nome}?`, `Run ${nome}?`);
      c.querySelector('small').textContent = risco ? `· ${risco}` : '';
      c.querySelector('.m-desc').textContent = descricao || '';
      if (args) c.querySelector('pre').textContent = args;
      const decidir = async (valor) => {
        const r = await post('/api/responder', { id, valor });
        resolver(c, r.ok ? (valor === 'aprovar' ? fala('autorizado', 'approved') : fala('recusado', 'declined')) : fala('já foi respondido', 'already answered'));
      };
      c.querySelector('.m-sim').onclick = () => decidir('aprovar');
      c.querySelector('.m-nao').onclick = () => decidir('negar');
      (s.turno?.d || lista).append(c);
      situacao(fala('esperando a sua confirmação', 'waiting for your confirmation'));
      rolar();
    },
    pergunta({ id, pergunta }) {
      if (!s.meu) return;
      const c = document.createElement('div');
      c.className = 'm-cartao';
      c.dataset.id = id;
      c.innerHTML = `<div><b>${fala('O agente perguntou', 'The agent asked')}</b></div><p class="m-desc"></p><div class="m-campo"><input type="text" /><button type="button">${fala('Responder', 'Answer')}</button></div>`;
      c.querySelector('.m-desc').textContent = pergunta;
      const input = c.querySelector('input');
      const enviar = async () => {
        const valor = input.value.trim();
        if (!valor) return;
        const r = await post('/api/responder', { id, valor });
        resolver(c, r.ok ? `${fala('você', 'you')}: ${valor}` : fala('já foi respondido', 'already answered'));
      };
      c.querySelector('button').onclick = enviar;
      input.onkeydown = (e) => e.key === 'Enter' && enviar();
      (s.turno?.d || lista).append(c);
      rolar();
    },
    // respondido no PC (ou em outro celular): o cartão daqui fecha
    'aprovacao-resolvida'({ nome, decisao }) {
      for (const c of lista.querySelectorAll(`.m-cartao[data-nome]:not(.resolvido)`)) if (c.dataset.nome === nome) resolver(c, decisao === 'negar' ? fala('recusado', 'declined') : fala('autorizado', 'approved'));
    },
    'remoto-respondeu'({ id }) {
      const c = lista.querySelector(`.m-cartao[data-id="${CSS.escape(String(id))}"]:not(.resolvido)`);
      if (c) resolver(c, fala('respondido', 'answered'));
    },
    'conversa-salva'({ id, titulo }) {
      if (s.acabeiDeResponder) {
        // a resposta pedida daqui foi salva: a conversa nova ganha o id; a aberta, o título
        s.acabeiDeResponder = false;
        s.idConversa = id;
        $('mTitulo').textContent = titulo || 'AuGPT';
      } else if (id === s.idConversa) abrirConversa(id); // o PC continuou a conversa aberta aqui
    },
  };
  function resolver(c, texto) {
    c.classList.add('resolvido');
    const acoes = c.querySelector('.m-acoes, .m-campo');
    if (acoes) acoes.replaceWith(Object.assign(document.createElement('small'), { textContent: texto }));
  }
  function terminou() {
    if (s.meu) s.acabeiDeResponder = true;
    s.meu = false;
    s.turno = null;
    if (s.rodandoNoPc) faixa('');
    s.rodandoNoPc = false;
    ocupado(false);
  }

  let fonte = null;
  function conectar() {
    fonte?.close();
    fonte = new EventSource('/api/eventos');
    fonte.onopen = () => {
      if ($('mFaixa').classList.contains('erro')) faixa('');
    };
    fonte.onmessage = (e) => {
      try {
        const { canal, dados } = JSON.parse(e.data);
        tratar[canal]?.(dados || {});
      } catch {
        // evento ilegível: ignora
      }
    };
    fonte.onerror = () => faixa(fala('Sem conexão com o PC — tentando de novo… (o AuGPT está aberto e na mesma rede?)', 'No connection to the PC — retrying… (is AuGPT open and on the same network?)'), true);
  }

  /* ---------------- enviar, parar, conversas ---------------- */
  async function enviar() {
    const caixa = $('mEntrada');
    const texto = caixa.value.trim();
    if (!texto) return;
    s.meu = true;
    bolhaEu(texto);
    caixa.value = '';
    altura();
    novoTurno();
    ocupado(true);
    const r = await post('/api/enviar', { texto, idConversa: s.idConversa });
    if (r.ok === false || r.status >= 400) {
      tratar.erro({ mensagem: r.erro || fala('Não deu para enviar.', 'Could not send.') });
      if (r.status === 409) faixa(fala('O AuGPT ainda está respondendo — espere terminar.', 'AuGPT is still answering — wait for it to finish.'));
    }
  }
  $('mCaixa').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('mEnviar').classList.contains('parando')) post('/api/parar');
    else enviar();
  });
  const altura = () => {
    const c = $('mEntrada');
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight, window.innerHeight * 0.4)}px`;
  };
  $('mEntrada').addEventListener('input', altura);
  $('mEntrada').addEventListener('keydown', (e) => {
    // no celular o Enter quebra linha; com teclado físico, Ctrl/⌘+Enter envia
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('mCaixa').requestSubmit();
    }
  });

  function novaConversa() {
    s.idConversa = null;
    $('mTitulo').textContent = 'AuGPT';
    limpar();
  }
  async function abrirConversa(id) {
    const c = await get(`/api/conversa?id=${encodeURIComponent(id)}`);
    if (!c) return;
    s.idConversa = c.id;
    $('mTitulo').textContent = c.titulo || 'AuGPT';
    limpar();
    $('mVazio').hidden = c.mensagens.length > 0;
    for (const m of c.mensagens) (m.role === 'user' ? bolhaEu(m.content) : respostaPronta(m.content));
    rolar();
  }
  async function abrirLista() {
    const conversas = (await get('/api/conversas')) || [];
    const ul = $('mConversas');
    ul.replaceChildren();
    for (const c of conversas) {
      const li = document.createElement('li');
      li.textContent = c.titulo || fala('Conversa', 'Chat');
      if (c.id === s.idConversa) li.className = 'atual';
      if (c.em) li.append(Object.assign(document.createElement('small'), { textContent: new Date(c.em).toLocaleString(s.en ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }));
      li.onclick = () => {
        $('mLista').hidden = true;
        abrirConversa(c.id);
      };
      ul.append(li);
    }
    if (!conversas.length) ul.append(Object.assign(document.createElement('li'), { textContent: fala('Nenhuma conversa ainda.', 'No chats yet.') }));
    $('mLista').hidden = false;
  }
  $('mAbrirLista').onclick = abrirLista;
  $('mFecharLista').onclick = () => ($('mLista').hidden = true);
  $('mNova').onclick = () => !s.meu && novaConversa();

  /* ---------------- começo ---------------- */
  (async () => {
    const e = await get('/api/estado');
    if (e) {
      s.en = e.idioma === 'en';
      if (s.en) {
        $('mEntrada').placeholder = 'Ask AuGPT something…';
        $('mVazio').querySelector('h1').textContent = 'What do you need?';
        $('mVazio').querySelector('p').textContent = "It's the same AuGPT as on your computer — chats, research and cards. To talk, use your phone keyboard's microphone.";
      }
      if (e.rodando) tratar.inicio();
    }
    conectar();
  })();
})();
