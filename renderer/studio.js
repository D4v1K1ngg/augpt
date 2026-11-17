'use strict';

/**
 * Studio de vídeo (17/11, Davi: "uma aba Studio, como um editor de vídeo — Vegas, CapCut, Filmora — com a dublagem e a
 * legenda dentro"). O projeto é o vídeo e os arquivos ao lado dele (o processo principal, studio:*). Aqui:
 *  - a prévia (augpt-video://, só o que o Studio abriu), Original ou Dublado, com a legenda por cima;
 *  - a linha do tempo: régua, zoom, cabeça de reprodução e as trilhas (vídeo, fala original, tradução, fundo) — clicar
 *    numa fala pula para ela e abre no inspetor, onde a tradução e os tempos se editam (o .srt é salvo na hora);
 *  - as ferramentas, na ordem: transcrever e traduzir → separar voz e fundo → dublar (com a legenda editada) → exportar;
 *  - os componentes (whisper na placa, separador de voz, motor de voz) com o botão de instalar o que falta.
 */
(() => {
  const api = window.augpt;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CHAVE = 'augpt.studio.v1';
  let prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {};
  } catch {
    prefs = {};
  }
  const guardarPrefs = () => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(prefs));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  };

  const st = { projeto: null, orig: [], trad: [], arquivoTrad: null, sel: null, zoom: Number(prefs.zoom) || 40, fonte: 'original', ocupado: false, comp: null };
  const video = $('stVideo');

  /* ------------------------------ tempo ------------------------------ */
  const mmss = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
  };
  const comMs = (ms) => `${mmss(ms)}.${String(Math.round(ms % 1000)).padStart(3, '0')}`;
  /** "1:02.500", "62.5", "1:02" → ms (null se não der para ler). */
  function lerTempo(t) {
    const partes = String(t || '').trim().replace(',', '.').split(':').map(Number);
    if (!partes.length || partes.some((x) => !Number.isFinite(x))) return null;
    return Math.round(partes.reduce((tot, x) => tot * 60 + x, 0) * 1000);
  }

  /* ------------------------------ status e trava ------------------------------ */
  function status(texto, { ocupado } = {}) {
    $('stStatus').textContent = texto || '';
    if (ocupado !== undefined) {
      st.ocupado = ocupado;
      $('stParar').hidden = !ocupado;
      pintarFerramentas();
    }
  }
  async function tarefa(rotulo, fn) {
    if (st.ocupado) return null;
    status(rotulo, { ocupado: true });
    let r;
    try {
      r = await fn();
    } catch (err) {
      r = { ok: false, error: err.message };
    }
    status(r?.ok === false ? (r.interrompido ? 'Parado.' : r.cancelado ? '' : `Não deu: ${r.error}`) : $('stStatus').textContent, { ocupado: false });
    return r;
  }

  /* ------------------------------ projeto ------------------------------ */
  const idioma = () => $('stIdioma').value || 'pt';

  async function carregarProjeto(projeto) {
    const mesmoVideo = st.projeto?.video === projeto.video;
    st.projeto = projeto;
    $('stNome').textContent = projeto.nome;
    $('stNome').title = projeto.video;
    $('stVazio').hidden = true;
    $('stPlay').disabled = false;
    if (!mesmoVideo || st.fonte === 'original') trocarFonte(st.fonte === 'dublado' && dubladoAtual() ? 'dublado' : 'original', { manterTempo: mesmoVideo });
    st.orig = projeto.srtOriginal ? (await api.studio.lerSrt(projeto.srtOriginal)) || [] : [];
    const trad = projeto.traducoes.find((t) => t.idioma === idioma());
    st.arquivoTrad = trad?.arquivo || null;
    // vídeo falado no idioma pedido: a legenda "traduzida" é a própria original
    st.trad = trad ? (await api.studio.lerSrt(trad.arquivo)) || [] : [];
    if (!trad && projeto.srtOriginal && st.orig.length && projeto.idiomaFalado === idioma()) {
      st.arquivoTrad = projeto.srtOriginal;
      st.trad = st.orig.map((s) => ({ ...s }));
    }
    st.sel = null;
    $('stInfoLegenda').textContent = st.orig.length ? `${st.orig.length} falas${st.trad.length ? ` · tradução: ${st.trad.length}` : ' · sem tradução para este idioma'}` : '';
    pintarTudo();
  }

  async function recarregar() {
    if (!st.projeto) return;
    const r = await api.studio.projeto(st.projeto.video);
    if (r?.ok) await carregarProjeto(r.projeto);
  }

  const dubladoAtual = () => st.projeto?.dublados.find((d) => d.idioma === idioma()) || null;

  function trocarFonte(fonte, { manterTempo = true } = {}) {
    if (!st.projeto) return;
    const alvo = fonte === 'dublado' ? dubladoAtual() : null;
    st.fonte = alvo ? 'dublado' : 'original';
    const token = alvo ? alvo.token : st.projeto.token;
    const t = manterTempo ? video.currentTime : 0;
    const tocando = !video.paused;
    const src = `augpt-video://v/${token}`;
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(t, video.duration || t);
        if (tocando) video.play().catch(() => {});
      }, { once: true });
    }
    document.querySelectorAll('.st-fonte [data-fonte]').forEach((b) => b.classList.toggle('ativo', b.dataset.fonte === st.fonte));
  }

  /* ------------------------------ pintura ------------------------------ */
  function pintarFerramentas() {
    const p = st.projeto;
    const livre = !st.ocupado;
    const c = st.comp || {};
    $('stLegendar').disabled = !p || !livre || !c.ditado;
    $('stLegendar').textContent = st.orig.length ? 'Refazer a legenda' : 'Fazer a legenda';
    $('stSeparar').disabled = !p || !livre || !c.separador;
    $('stSeparar').textContent = p?.fundo ? 'Separar de novo' : 'Separar a voz';
    $('stDublar').disabled = !p || !livre || !st.trad.length || !c.motorVoz || !$('stVoz').value;
    $('stExpFaixa').disabled = !p || !livre || !st.arquivoTrad;
    $('stExpFixa').disabled = !p || !livre || !st.arquivoTrad;
    $('stMostrar').disabled = !p;
    document.querySelector('.st-fonte [data-fonte="dublado"]').disabled = !dubladoAtual();
    const opSep = $('stFundo').querySelector('option[value="separado"]');
    opSep.disabled = !c.separador;
    if (opSep.disabled && $('stFundo').value === 'separado') $('stFundo').value = '0.15';
  }

  function pintarComponentes() {
    const c = st.comp;
    if (!c) return;
    const itens = [
      !c.ffmpeg && { nome: 'ffmpeg', falta: 'Falta o ffmpeg: instale em Ajustes → Componentes.' },
      !c.ditado && { nome: 'Transcrição', falta: 'Falta o ditado por voz (whisper): instale em Ajustes → Voz e ditado.' },
      c.ditado && { nome: 'Transcrição', ok: c.whisperGpu ? 'na placa de vídeo' : 'no processador', instalar: !c.whisperGpu && c.nvidia ? { qual: 'whisperGpu', rotulo: 'Usar a placa de vídeo (baixa 685 MB, ~16× mais rápido)' } : null },
      { nome: 'Separador de voz', ok: c.separador ? 'instalado' : null, falta: !c.separador && !c.omni ? 'Precisa do motor de voz do Estúdio de voz (OmniVoice).' : null, instalar: !c.separador && c.omni ? { qual: 'separador', rotulo: 'Instalar (poucos MB + modelo de ~80 MB)' } : null },
      { nome: 'Motor de voz', ok: c.motorVoz ? 'instalado' : null, falta: c.motorVoz ? null : 'Instale no Estúdio de voz para dublar.' },
    ].filter(Boolean);
    $('stComponentes').innerHTML = `<h4>Componentes</h4>${itens.map((i) => `
      <div class="st-comp ${i.ok ? 'ok' : 'falta'}">
        <span class="st-comp-ponto" aria-hidden="true"></span>
        <div><b>${esc(i.nome)}</b> <span class="dica">${esc(i.ok || i.falta || '')}</span>
        ${i.instalar ? `<button class="btn-link" data-instalar="${esc(i.instalar.qual)}">${esc(i.instalar.rotulo)}</button>` : ''}</div>
      </div>`).join('')}`;
    $('stComponentes').querySelectorAll('[data-instalar]').forEach((b) => b.addEventListener('click', async () => {
      const r = await tarefa('Instalando…', () => api.studio.instalar(b.dataset.instalar));
      if (r?.ok) status('Instalado ✓');
      await carregarComponentes();
    }));
  }

  async function carregarComponentes() {
    st.comp = await api.studio.componentes().catch(() => null);
    pintarComponentes();
    pintarFerramentas();
  }

  async function carregarVozes() {
    const vozes = (await window.estudioVozes?.lista().catch(() => [])) || [];
    const atual = prefs.voz || window.estudioVozes?.atual();
    $('stVoz').innerHTML = vozes.length
      ? vozes.map((v) => `<option value="${esc(v.id)}" ${v.id === atual ? 'selected' : ''}>${esc(v.nome)}${v.grupo === 'clonada' ? ' (clonada)' : ''}</option>`).join('')
      : '<option value="">— instale o motor de voz —</option>';
  }

  const pxs = () => st.zoom / 1000; // pixels por milissegundo
  function pintarLinha() {
    const dur = st.projeto?.duracao || (video.duration ? video.duration * 1000 : 0);
    const largura = Math.max($('stRolagem').clientWidth, Math.ceil(dur * pxs()) + 40);
    $('stConteudo').style.width = `${largura}px`;
    // régua: um rótulo a cada intervalo que deixe ~90 px entre eles
    const passos = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const passo = (passos.find((s) => s * 1000 * pxs() >= 90) || 600) * 1000;
    let regua = '';
    for (let t = 0; t <= dur; t += passo) regua += `<span style="left:${t * pxs()}px">${mmss(t)}</span>`;
    $('stRegua').innerHTML = regua;
    $('stTrilhaVideo').innerHTML = st.projeto ? `<div class="st-bloco st-bloco-video" style="left:0;width:${dur * pxs()}px"><span>${esc(st.projeto.nome)}</span></div>` : '';
    const blocos = (lista, tipo) => lista.map((s, i) => `<button type="button" class="st-bloco st-bloco-${tipo} ${st.sel?.tipo === tipo && st.sel.i === i ? 'sel' : ''}" data-tipo="${tipo}" data-i="${i}" style="left:${s.inicio * pxs()}px;width:${Math.max(4, (s.fim - s.inicio) * pxs())}px" title="${esc(`${mmss(s.inicio)} · ${s.texto}`)}"><span>${esc(s.texto)}</span></button>`).join('');
    $('stTrilhaOrig').innerHTML = blocos(st.orig, 'orig');
    $('stTrilhaTrad').innerHTML = blocos(st.trad, 'trad');
    $('stTrilhaFundo').innerHTML = st.projeto?.fundo ? `<div class="st-bloco st-bloco-fundo" style="left:0;width:${dur * pxs()}px"><span>Fundo separado (música e ambiente, sem a voz)</span></div>` : '';
    document.querySelectorAll('#stConteudo .st-bloco[data-tipo]').forEach((b) => b.addEventListener('click', () => selecionar(b.dataset.tipo, Number(b.dataset.i))));
    moverCabeca();
  }

  function pintarInspetor() {
    const s = st.sel && (st.sel.tipo === 'orig' ? st.orig : st.trad)[st.sel.i];
    $('stEditor').hidden = !s;
    $('stSemSelecao').hidden = Boolean(s);
    if (!s) return;
    // a fala original e a tradução do mesmo trecho (pelo tempo)
    const par = (lista) => lista.find((x) => Math.abs(x.inicio - s.inicio) < 600) || lista.find((x) => x.inicio <= s.inicio && x.fim > s.inicio);
    const orig = st.sel.tipo === 'orig' ? s : par(st.orig);
    const trad = st.sel.tipo === 'trad' ? s : par(st.trad);
    $('stIni').value = comMs((trad || s).inicio);
    $('stFim').value = comMs((trad || s).fim);
    $('stTxtOrig').value = orig?.texto || '';
    $('stTxtTrad').value = trad?.texto || '';
    $('stTxtTrad').disabled = !trad;
    $('stSalvarFala').disabled = !trad;
    $('stApagarFala').disabled = !trad;
  }

  function pintarTudo() {
    pintarFerramentas();
    pintarLinha();
    pintarInspetor();
    legendaNaTela();
  }

  function selecionar(tipo, i) {
    st.sel = { tipo, i };
    const s = (tipo === 'orig' ? st.orig : st.trad)[i];
    if (s && Number.isFinite(video.duration)) video.currentTime = s.inicio / 1000;
    pintarLinha();
    pintarInspetor();
  }

  /* ------------------------------ prévia ------------------------------ */
  function legendaNaTela() {
    const qual = $('stLegendaVer').value;
    const lista = qual === 'original' ? st.orig : qual === 'traducao' ? st.trad : [];
    const t = video.currentTime * 1000;
    const s = lista.find((x) => t >= x.inicio && t <= x.fim);
    const el = $('stLegendaTela');
    const texto = s?.texto || '';
    if (el.textContent !== texto) el.textContent = texto;
    el.hidden = !texto;
  }

  function moverCabeca() {
    const t = video.currentTime * 1000;
    $('stCabeca').style.left = `${t * pxs()}px`;
    const dur = video.duration ? video.duration * 1000 : st.projeto?.duracao || 0;
    $('stTempo').textContent = `${mmss(t)} / ${mmss(dur)}`;
    // a linha do tempo acompanha quem toca
    if (!video.paused) {
      const r = $('stRolagem');
      const x = t * pxs();
      if (x < r.scrollLeft + 40 || x > r.scrollLeft + r.clientWidth - 60) r.scrollLeft = Math.max(0, x - 80);
    }
  }
  let quadro = 0;
  const animar = () => {
    moverCabeca();
    legendaNaTela();
    quadro = video.paused ? 0 : requestAnimationFrame(animar);
  };
  video.addEventListener('play', () => {
    $('stPlay').textContent = '❚❚';
    $('stPlay').setAttribute('aria-label', 'Pausar');
    if (!quadro) quadro = requestAnimationFrame(animar);
  });
  video.addEventListener('pause', () => {
    $('stPlay').textContent = '▶';
    $('stPlay').setAttribute('aria-label', 'Tocar');
  });
  video.addEventListener('seeked', () => (moverCabeca(), legendaNaTela()));
  video.addEventListener('loadedmetadata', () => pintarLinha());
  $('stPlay').addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));
  document.querySelectorAll('.st-fonte [data-fonte]').forEach((b) => b.addEventListener('click', () => trocarFonte(b.dataset.fonte)));
  $('stLegendaVer').addEventListener('change', legendaNaTela);

  // clicar na régua (ou num espaço vazio da linha do tempo) leva a cabeça para lá
  $('stConteudo').addEventListener('click', (e) => {
    if (e.target.closest('.st-bloco[data-tipo]') || !Number.isFinite(video.duration)) return;
    const x = e.clientX - $('stConteudo').getBoundingClientRect().left;
    video.currentTime = Math.max(0, Math.min(video.duration, x / pxs() / 1000));
  });
  $('stZoom').value = String(st.zoom);
  $('stZoom').addEventListener('input', (e) => {
    const r = $('stRolagem');
    const centro = (r.scrollLeft + r.clientWidth / 2) / pxs();
    st.zoom = Number(e.target.value);
    prefs.zoom = st.zoom;
    guardarPrefs();
    pintarLinha();
    r.scrollLeft = Math.max(0, centro * pxs() - r.clientWidth / 2);
  });
  // atalhos: espaço toca/pausa; ← → andam 2 s (fora dos campos de texto)
  document.addEventListener('keydown', (e) => {
    if ($('viewStudio').hidden || !st.projeto || e.target.closest('input, textarea, select')) return;
    if (e.code === 'Space') (e.preventDefault(), $('stPlay').click());
    if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 2);
    if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration || 0, video.currentTime + 2);
  });

  /* ------------------------------ inspetor ------------------------------ */
  async function salvarTraducao() {
    if (!st.arquivoTrad) return;
    const r = await api.studio.salvarSrt(st.arquivoTrad, st.trad);
    status(r?.ok ? 'Legenda salva ✓ (a próxima dublagem já usa)' : 'Não consegui salvar a legenda.');
  }
  $('stSalvarFala').addEventListener('click', async () => {
    const s = st.sel && (st.sel.tipo === 'trad' ? st.trad[st.sel.i] : st.trad.find((x) => Math.abs(x.inicio - (st.orig[st.sel.i]?.inicio ?? -9e9)) < 600));
    if (!s) return;
    const ini = lerTempo($('stIni').value);
    const fim = lerTempo($('stFim').value);
    if (ini === null || fim === null || fim <= ini) return status('Confira o início e o fim (ex.: 1:02.500).');
    Object.assign(s, { inicio: ini, fim, texto: $('stTxtTrad').value.replace(/\s+/g, ' ').trim() });
    st.trad.sort((a, b) => a.inicio - b.inicio);
    st.sel = { tipo: 'trad', i: st.trad.indexOf(s) };
    await salvarTraducao();
    pintarLinha();
    pintarInspetor();
  });
  $('stApagarFala').addEventListener('click', async () => {
    const i = st.sel?.tipo === 'trad' ? st.sel.i : st.trad.findIndex((x) => Math.abs(x.inicio - (st.orig[st.sel?.i]?.inicio ?? -9e9)) < 600);
    if (i < 0 || !confirm('Apagar esta fala da tradução? (a dublagem não vai falar este trecho)')) return;
    st.trad.splice(i, 1);
    st.sel = null;
    await salvarTraducao();
    pintarTudo();
  });

  /* ------------------------------ ferramentas ------------------------------ */
  async function abrir(link) {
    const r = await tarefa(link ? 'Baixando o vídeo…' : 'Abrindo…', () => api.studio.abrir(link));
    if (!r?.ok || r.cancelado || !r.projeto) return;
    status('');
    prefs.ultimo = r.projeto.video;
    guardarPrefs();
    await carregarProjeto(r.projeto);
  }
  $('stAbrir').addEventListener('click', () => abrir(null));
  $('stBaixar').addEventListener('click', () => {
    const link = $('stLink').value.trim();
    if (!/^https?:\/\//i.test(link)) return status('Cole o link do vídeo (começa com https://).');
    abrir(link);
  });
  $('stLink').addEventListener('keydown', (e) => e.key === 'Enter' && $('stBaixar').click());

  $('stIdioma').addEventListener('change', () => {
    prefs.idioma = idioma();
    guardarPrefs();
    if (st.projeto) carregarProjeto(st.projeto);
  });
  $('stVoz').addEventListener('change', () => ((prefs.voz = $('stVoz').value), guardarPrefs(), pintarFerramentas()));
  $('stFundo').addEventListener('change', () => ((prefs.fundo = $('stFundo').value), guardarPrefs()));

  $('stLegendar').addEventListener('click', async () => {
    const r = await tarefa('Transcrevendo…', () => api.studio.legendar(st.projeto.video, idioma()));
    if (!r?.ok) return;
    status(`Legenda pronta ✓ em ${r.segundos} s${r.faltaram ? ` · ⚠ ${r.faltaram} falas sem tradução` : ''}`);
    await carregarProjeto({ ...r.projeto, idiomaFalado: r.idiomaFalado });
  });
  $('stSeparar').addEventListener('click', async () => {
    const r = await tarefa('Separando a voz do fundo…', () => api.studio.separar(st.projeto.video));
    if (r?.ok) await carregarProjeto(r.projeto);
  });
  $('stDublar').addEventListener('click', async () => {
    const voz = window.estudioVozes?.opcoes($('stVoz').value);
    if (!voz) return status('Escolha a voz da dublagem.');
    const r = await tarefa('Dublando… (gera uma fala por trecho: leva alguns minutos)', () => api.studio.dublar({ video: st.projeto.video, srt: st.arquivoTrad, para: idioma(), voz, fundo: $('stFundo').value }));
    if (!r?.ok) return;
    status(`Dublagem pronta ✓ ${r.falas} falas em ${Math.max(1, Math.round(r.segundos / 60))} min${r.encurtadas ? ` · diretor: ${r.encurtadas} encurtadas para caber no tempo` : ''}${r.refeitas ? `, ${r.refeitas} refeitas por não ficarem claras` : ''}${r.nota != null ? ` · ${r.nota}% entendidas` : ''}${r.aceleradas ? ` · ${r.aceleradas} aceleradas` : ''}`);
    await carregarProjeto(r.projeto);
    trocarFonte('dublado', { manterTempo: false });
  });
  const exportar = (modo) => async () => {
    const r = await tarefa(modo === 'fixa' ? 'Gravando a legenda na imagem (refaz o vídeo)…' : 'Pondo a legenda no vídeo…', () => api.studio.exportarLegenda({ video: st.projeto.video, srt: st.arquivoTrad, para: idioma(), modo }));
    if (!r?.ok) return;
    status(`Pronto ✓ ${String(r.saida).split(/[\\/]/).pop()}`);
    await carregarProjeto(r.projeto);
  };
  $('stExpFaixa').addEventListener('click', exportar('faixa'));
  $('stExpFixa').addEventListener('click', exportar('fixa'));
  $('stMostrar').addEventListener('click', () => api.studio.mostrar(dubladoAtual()?.arquivo || st.projeto.legendados[0]?.arquivo || st.projeto.video));
  $('stParar').addEventListener('click', () => api.studio.parar());

  let iniciado = false;
  window.carregarStudio = async () => {
    if (!iniciado) {
      iniciado = true;
      const idiomas = await api.tradutor.idiomas().catch(() => [['pt', 'Português'], ['en', 'Inglês']]);
      const escolha = prefs.idioma || 'pt';
      $('stIdioma').innerHTML = idiomas.filter(([id]) => id !== 'auto').map(([id, nome]) => `<option value="${esc(id)}" ${id === escolha ? 'selected' : ''}>${esc(nome)}</option>`).join('');
      if (prefs.fundo) $('stFundo').value = prefs.fundo;
    }
    await Promise.all([carregarComponentes(), carregarVozes()]);
    pintarTudo();
  };
  window.studioEvento = (canal, dados) => {
    if (canal === 'studio-progresso' && dados.texto && st.ocupado) $('stStatus').textContent = dados.texto;
  };
  window.addEventListener('resize', () => !$('viewStudio').hidden && pintarLinha());
})();
