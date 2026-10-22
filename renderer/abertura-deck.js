'use strict';

/* Tela inicial com o carrossel dos recursos (20/10, fase 2 da identidade "Au", a partir da
 * referência do Davi). Cada slide tem uma demonstração curta (CSS, reinicia ao aparecer) e um
 * "experimente" que põe um pedido na caixa de mensagem — os de rede e do PC são os exemplos do
 * catálogo de utilitários, que acionam o recurso de verdade. Gira sozinho a cada 7 s; para com o
 * mouse em cima, com o foco na caixa de mensagem ou fora da tela inicial.
 * Usa as globais da tela ($, el, autoAltura) — carregado depois dos app*.js. */
(() => {
  const deck = document.getElementById('deckAbertura');
  if (!deck) return;
  const DUR = 7000;
  const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const chk = svg('<path d="m5 12 4.5 4.5L19 7"/>');
  const enviar = svg('<path d="M12 19V5m-6 6 6-6 6 6"/>');
  const chips = (lista, de = 0) => `<div class="wrap">${lista.map((s, i) => `<span class="chipx a" style="--i:${i + de}"><i></i>${esc(s)}</span>`).join('')}</div>`;
  const passos = (lista) => `<div class="v-trail">${lista.map(([t, d], i) => `<div class="st a${i === lista.length - 1 ? ' now' : ''}" style="--i:${i}"><span class="sdot">${chk}</span><div>${esc(t)}<small>${esc(d)}</small></div></div>`).join('')}</div>`;
  const linhas = (lista) => `<div class="v-pc">${lista.map(([k, v], i) => `<div class="pc-l a" style="--i:${i}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;

  const DECK = [
    {
      id: 'pesquisa', t: 'Pesquisa que você regula',
      d: 'Do rápido à investigação com relatório em PDF. O agente cruza fontes, confere os números e prefere os sites confiáveis.',
      try: 'Quais os melhores fones intra-auriculares para PUBG até R$ 300?',
      v: `<div class="v-res"><div class="depth">${[0, 1, 2, 3, 4].map((i) => `<b style="--i:${i}"></b>`).join('')}</div><div class="depth-l"><span>Rápido</span><span>Investigação</span></div>${chips(['reddit.com', 'techpowerup.com', 'youtube.com', 'clubedohardware.com.br', 'gov.br'], 2)}</div>`,
    },
    {
      id: 'rastro', t: 'Você vê o que o agente decidiu',
      d: 'Etapas, sites consultados e raciocínio ficam na conversa. Dá para conferir como a resposta foi montada.',
      try: 'Qual a previsão do tempo para Vitória-ES nesta semana?',
      v: passos([['Entendeu o pedido', 'previsão, Vitória-ES, 7 dias'], ['Buscou em 3 fontes', 'inmet.gov.br, climatempo, open-meteo'], ['Comparou as previsões', 'chuva só na quinta, nas três'], ['Escrevendo a resposta', 'com as fontes no final']]),
    },
    {
      id: 'pc', t: 'Conhece o seu computador',
      d: 'Espaço, configuração, drivers, periféricos e o que mais você perguntar. Só lê: nada é mudado e nada sai do PC.',
      try: 'meu driver do chipset está atualizado?',
      v: linhas([['Unidade C:', '94 GB livres de 476 GB'], ['Placa de vídeo', 'driver de setembro, em dia'], ['Chipset AMD', '8.08.12.551, o mais novo'], ['Mouse e teclado', 'pelo nome de fábrica']]),
    },
    {
      id: 'rede', t: 'Mede a sua internet de verdade',
      d: 'Velocidade, ping e bufferbloat, a rota até o servidor do seu jogo e quem está usando a rede da casa.',
      try: 'teste minha internet',
      v: `<div class="v-tools"><div class="nums a" style="--i:0"><div><b>557</b><span>Mbps de download</span></div><div><b>7 ms</b><span>de ping</span></div><div><b>A+</b><span>bufferbloat</span></div></div>${chips(['PUBG São Paulo · 18 ms', 'raio-X do roteador', '13 aparelhos na rede'], 1)}</div>`,
    },
    {
      id: 'arquivos', t: 'Lê o que você anexa, entrega o que você precisa',
      d: 'Anexe PDF, planilha ou imagem. O agente analisa e devolve Word, Excel, PDF ou página HTML prontos.',
      try: 'Analise o boleto que anexei e diga o que muda se eu atrasar',
      v: `<div class="v-files"><div class="doc src a" style="--i:0"><b>PDF</b>boleto</div>${svg('<path d="M5 12h14m-5-5 5 5-5 5"/>', 'class="arrow a ic" style="--i:1;width:26px;height:26px"')}<div class="doc docx a" style="--i:2"><b>DOCX</b>resumo</div><div class="doc xlsx a" style="--i:3"><b>XLSX</b>planilha</div><div class="doc pdf a" style="--i:4"><b>PDF</b>relatório</div></div>`,
    },
    {
      id: 'visuais', t: 'Resposta que vira gráfico',
      d: 'Números viram gráficos interativos na própria conversa, e ideias viram páginas interativas numa área isolada.',
      try: 'monte um gráfico com o preço da RTX 5080 desde o lançamento',
      v: `<div class="v-chart"><div class="bars">${[48, 62, 40, 78, 70, 100].map((h, i) => `<div style="--h:${h}%;--i:${i}"></div>`).join('')}</div><div class="bars-l">${['mai', 'jun', 'jul', 'ago', 'set', 'out'].map((m) => `<span>${m}</span>`).join('')}</div></div>`,
    },
    {
      id: 'ferramentas', t: 'Um agente com ferramentas de verdade',
      d: 'Utilitários para a rede e o PC, skills e ferramentas embutidas, e servidores MCP para ligar o AuGPT aos seus programas.',
      try: 'o que você pode fazer?',
      v: `<div class="v-tools"><div class="nums a" style="--i:0"><div><b data-conta="utilitarios">27</b><span>utilitários</span></div><div><b data-conta="skills">23</b><span>skills</span></div><div><b>MCP</b><span>servidores seus</span></div></div>${chips(['Buscar na web', 'Ler PDF', 'Planilhas', 'Criar Word', 'Gráficos', 'Ler o PC', 'Servidor MCP'], 1)}</div>`,
    },
    {
      id: 'local', t: 'Modelo local, sem enviar sua conversa',
      d: 'O AuGPT usa o Ollama no seu PC, ou no de outro computador da sua casa. Só as buscas na web saem da máquina.',
      try: 'qual a configuração do meu pc?',
      v: `<div class="v-local"><div class="node me a" style="--i:0"><b>Seu computador</b>AuGPT + Ollama</div><span class="link a" style="--i:1"></span><div class="node cloud a" style="--i:2"><b>Nuvem de IA</b>não usada</div></div>`,
    },
  ];

  const slides = document.getElementById('deckSlides');
  const tabs = document.getElementById('deckTabs');
  const play = document.getElementById('deckPlay');
  slides.innerHTML = DECK.map((s, i) => `<article class="slide" role="tabpanel" aria-roledescription="slide" aria-label="${i + 1} de ${DECK.length}"><div class="vis" aria-hidden="true">${s.v}</div><div class="cap"><h2>${esc(s.t)}</h2><p>${esc(s.d)}</p><button type="button" class="try" data-i="${i}">${enviar}<span>${esc(s.try)}</span></button></div></article>`).join('');
  tabs.innerHTML = DECK.map((s, i) => `<button type="button" class="tab" role="tab" data-i="${i}" title="${esc(s.t)}" aria-label="${esc(s.t)}"></button>`).join('');

  // os números de verdade: utilitários do catálogo e skills instaladas
  window.augpt?.utilitarios?.listar().then((l) => { const b = slides.querySelector('[data-conta="utilitarios"]'); if (b && l?.length) b.textContent = l.length; }).catch(() => {});
  window.augpt?.skills?.list?.().then((l) => { const b = slides.querySelector('[data-conta="skills"]'); const n = Array.isArray(l) ? l.length : l?.skills?.length; if (b && n) b.textContent = n; }).catch(() => {});

  let atual = 0;
  let girando = !reduzido;
  let segurando = 0;
  let relogio = null;
  let inicio = 0;
  let resta = DUR;
  const visivel = () => !el.aAbertura.hidden && !document.getElementById('viewAgente').hidden && !document.hidden;
  const rodando = () => girando && !segurando && visivel();
  const pintarPlay = () => {
    play.innerHTML = girando
      ? '<svg viewBox="0 0 24 24" class="ic" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" class="ic" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
    play.setAttribute('aria-label', girando ? 'Pausar a rotação' : 'Retomar a rotação');
  };
  function relogioDoSlide() {
    clearTimeout(relogio);
    deck.classList.toggle('playing', rodando());
    if (!rodando()) return;
    inicio = performance.now();
    deck.style.setProperty('--dur', `${resta}ms`);
    relogio = setTimeout(() => ir(atual + 1), resta);
  }
  function congelar() {
    if (relogio) resta = Math.max(400, resta - (performance.now() - inicio));
    clearTimeout(relogio);
    relogio = null;
    deck.classList.remove('playing');
  }
  function ir(n) {
    n = (n + DECK.length) % DECK.length;
    slides.querySelectorAll('.slide').forEach((s, i) => {
      s.classList.toggle('out', i < n);
      s.classList.toggle('on', i === n);
      s.inert = i !== n;
    });
    tabs.querySelectorAll('.tab').forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === n));
      b.tabIndex = i === n ? 0 : -1;
    });
    atual = n;
    resta = DUR;
    deck.classList.remove('playing');
    void deck.offsetWidth; // reinicia a barrinha de progresso
    relogioDoSlide();
  }
  const segurar = (sim) => {
    const antes = segurando;
    segurando = Math.max(0, segurando + (sim ? 1 : -1));
    if (!antes && segurando) congelar();
    else if (antes && !segurando) relogioDoSlide();
  };
  deck.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && segurar(true));
  deck.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && segurar(false));
  el.aEntrada.addEventListener('focus', () => segurar(true));
  el.aEntrada.addEventListener('blur', () => segurar(false));
  document.addEventListener('visibilitychange', () => (document.hidden ? congelar() : relogioDoSlide()));
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) ir(Number(b.dataset.i));
  });
  tabs.addEventListener('keydown', (e) => {
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!k) return;
    e.preventDefault();
    ir(atual + k);
    tabs.querySelectorAll('.tab')[atual].focus();
  });
  document.getElementById('deckAnterior').addEventListener('click', () => ir(atual - 1));
  document.getElementById('deckProximo').addEventListener('click', () => ir(atual + 1));
  play.addEventListener('click', () => {
    girando = !girando;
    pintarPlay();
    if (girando) {
      resta = DUR;
      relogioDoSlide();
    } else congelar();
  });
  // "experimente": o pedido vai para a caixa de mensagem (quem envia é o usuário)
  slides.addEventListener('click', (e) => {
    const b = e.target.closest('.try');
    if (!b) return;
    el.aEntrada.value = window.tr ? tr(DECK[Number(b.dataset.i)].try) : DECK[Number(b.dataset.i)].try; // no idioma da tela (22/10)
    autoAltura(el.aEntrada);
    el.aEntrada.focus();
    el.aEntrada.setSelectionRange(el.aEntrada.value.length, el.aEntrada.value.length);
  });
  // arrastar para o lado troca o slide
  let x0 = null;
  document.getElementById('deckPalco').addEventListener('pointerdown', (e) => {
    if (!e.target.closest('button')) x0 = e.clientX;
  });
  window.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) ir(atual + (dx < 0 ? 1 : -1));
  });
  // fora da tela inicial (conversa aberta, outra aba), para; ao voltar, recomeça o slide
  const observar = new MutationObserver(() => (visivel() ? ir(atual) : congelar()));
  observar.observe(el.aAbertura, { attributes: true, attributeFilter: ['hidden'] });
  observar.observe(document.getElementById('viewAgente'), { attributes: true, attributeFilter: ['hidden'] });
  pintarPlay();
  ir(0);
})();
