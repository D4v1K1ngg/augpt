'use strict';

/**
 * Estúdio de voz (11/11): a tela de texto → áudio. Os controles saem da descrição dos motores que o processo
 * principal manda (src/estudio-de-voz/index.js, MOTORES/ACABAMENTO): o que o modelo aceita aparece aqui.
 * As últimas escolhas ficam no localStorage (só conveniência: sem elas, os padrões dos modelos).
 *
 * 16/11 (Davi: "mais fácil de usar", "uma biblioteca para os áudios clonados", "escolher a voz do chat"):
 *  - a voz se escolhe em cartões (as clonadas primeiro, com ▶ para ouvir a amostra); motor e modo ficam em
 *    "Detalhes da voz", fechado;
 *  - Biblioteca: cada áudio gerado, para ouvir, renomear, favoritar, salvar ou apagar (vai para a lixeira). O mesmo
 *    pedido de novo devolve o arquivo da biblioteca sem gerar (o processo principal compara a chave do pedido);
 *  - "Voz das respostas do chat": a voz do 🔊 no fim das respostas (também escolhida ali, ao lado do botão).
 */
(() => {
  const api = window.augpt;
  const $ = (id) => document.getElementById(id);
  const CHAVE = 'augpt.estudio.v1';
  let est = null; // estado do processo principal
  let escolhas = {};
  try {
    escolhas = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {};
  } catch {
    escolhas = {};
  }
  const guardar = () => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(escolhas));
    } catch {
      // sem armazenamento: as escolhas valem só nesta sessão
    }
  };
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const motor = () => (est?.motores[escolhas.motor] ? escolhas.motor : 'omni');
  const M = () => est.motores[motor()];
  // as escolhas de cada motor ficam separadas (temperatura do Qwen ≠ do OmniVoice)
  const dele = () => (escolhas[motor()] ||= {});
  const valor = (chave, padrao) => (dele()[chave] ?? escolhas.geral?.[chave] ?? padrao);
  const modoAtual = () => {
    const m = M();
    return m.modos.some(([id]) => id === dele().modo) ? dele().modo : m.modos[0][0];
  };
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const TIPOS = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' };
  const tipoDe = (arquivo) => TIPOS[String(arquivo).split('.').pop().toLowerCase()] || 'audio/mpeg';
  async function urlDoAudio(arquivo) {
    const bytes = await api.estudio.ler(arquivo);
    return bytes ? URL.createObjectURL(new Blob([bytes], { type: tipoDe(arquivo) })) : '';
  }

  /* ------------------------------ as vozes (cartões e o seletor do chat) ------------------------------ */

  /** Todas as vozes que dá para usar agora: as clonadas, as do OmniVoice e as do Qwen (só dos motores instalados). */
  function vozesDisponiveis() {
    if (!est) return [];
    const omni = est.motores.omni?.instalado;
    const qwen = est.motores.qwen?.instalado;
    const clonador = omni ? 'omni' : qwen ? 'qwen' : null;
    const lista = [];
    if (clonador) for (const v of est.vozes || []) lista.push({ id: `clone:${v.id}`, nome: v.nome, tipo: v.texto ? `“${String(v.texto).slice(0, 48)}…”` : 'Voz clonada', grupo: 'clonada', motor: clonador, modo: 'clonar', vozSalva: v.id, amostra: v.audio });
    if (omni) {
      lista.push({ id: 'omni:descrita', nome: 'Voz descrita', tipo: 'Gênero, idade e tom que você escolhe', grupo: 'OmniVoice', motor: 'omni', modo: 'descrita' });
      lista.push({ id: 'omni:automatica', nome: 'Automática', tipo: 'O modelo escolhe a voz', grupo: 'OmniVoice', motor: 'omni', modo: 'automatica' });
    }
    if (qwen) {
      for (const [id, r] of est.motores.qwen.vozes) {
        const [nome, desc = ''] = r.split(' — ');
        lista.push({ id: `qwen:${id}`, nome, tipo: desc, grupo: 'Qwen3-TTS', motor: 'qwen', modo: 'pronta', voz: id });
      }
      lista.push({ id: 'qwen:descrita', nome: 'Descrita em texto', tipo: 'Descreva a voz com as suas palavras', grupo: 'Qwen3-TTS', motor: 'qwen', modo: 'descrita' });
    }
    return lista;
  }

  /** A voz que está escolhida no Estúdio (o id do cartão). */
  function vozAtual() {
    const m = motor();
    const modo = modoAtual();
    if (modo === 'clonar') return `clone:${escolhas.vozSalva}`;
    if (m === 'qwen' && modo === 'pronta') return `qwen:${valor('voz', 'ryan')}`;
    return `${m}:${modo}`;
  }

  function escolherVoz(v) {
    escolhas.motor = v.motor;
    (escolhas[v.motor] ||= {}).modo = v.modo;
    if (v.vozSalva) escolhas.vozSalva = v.vozSalva;
    if (v.voz) escolhas[v.motor].voz = v.voz;
    guardar();
    pintarAjustes();
  }

  let amostraTocando = null;
  async function tocarAmostra(v, botao) {
    if (amostraTocando) {
      amostraTocando.pause();
      const era = amostraTocando.dataset.voz;
      amostraTocando = null;
      document.querySelectorAll('.estudio-voz-ouvir').forEach((b) => (b.textContent = '▶'));
      if (era === v.id) return;
    }
    const url = await urlDoAudio(v.amostra);
    if (!url) return;
    const a = new Audio(url);
    a.dataset.voz = v.id;
    amostraTocando = a;
    botao.textContent = '■';
    a.addEventListener('ended', () => ((botao.textContent = '▶'), (amostraTocando = null)));
    a.play().catch(() => {});
  }

  function pintarVozes() {
    const alvo = $('estudioVozes');
    const lista = vozesDisponiveis();
    const atual = vozAtual();
    if (!lista.length) {
      alvo.innerHTML = '<p class="dica">Instale um dos motores acima para escolher a voz.</p>';
      return;
    }
    const grupos = [['clonada', 'Suas vozes clonadas'], ['OmniVoice', 'OmniVoice'], ['Qwen3-TTS', 'Qwen3-TTS · vozes prontas']];
    alvo.innerHTML = grupos
      .map(([g, rotulo]) => {
        const itens = lista.filter((v) => v.grupo === g);
        if (!itens.length && g !== 'clonada') return '';
        const cartoes = itens.map((v) => `
          <div class="estudio-voz ${v.id === atual ? 'ativo' : ''}" role="radio" tabindex="0" aria-checked="${v.id === atual}" data-voz="${esc(v.id)}">
            ${v.amostra ? '<button type="button" class="estudio-voz-ouvir" title="Ouvir a amostra" aria-label="Ouvir a amostra">▶</button>' : `<span class="estudio-voz-icone" aria-hidden="true">${v.grupo === 'Qwen3-TTS' ? '◆' : '◎'}</span>`}
            <span class="estudio-voz-texto"><b>${esc(v.nome)}</b><span>${esc(v.tipo)}</span></span>
            ${v.amostra ? '<span class="estudio-voz-mais"><button type="button" class="estudio-voz-renomear" title="Renomear" aria-label="Renomear esta voz">✎</button><button type="button" class="estudio-voz-apagar" title="Apagar esta voz" aria-label="Apagar esta voz">×</button></span>' : ''}
          </div>`).join('');
        const nova = g === 'clonada' && (est.motores.omni?.instalado || est.motores.qwen?.instalado)
          ? '<button type="button" class="estudio-voz estudio-voz-nova" id="estudioNovaVoz"><span class="estudio-voz-icone" aria-hidden="true">＋</span><span class="estudio-voz-texto"><b>Clonar uma voz</b><span>10 a 20 s de fala limpa</span></span></button>'
          : '';
        return `<div class="estudio-vozes-grupo"><div class="estudio-vozes-rotulo">${esc(rotulo)}</div><div class="estudio-vozes-grade">${cartoes}${nova}</div></div>`;
      })
      .join('');
    for (const c of alvo.querySelectorAll('[data-voz]')) {
      const v = lista.find((x) => x.id === c.dataset.voz);
      c.addEventListener('click', (e) => {
        if (e.target.closest('.estudio-voz-ouvir, .estudio-voz-mais') || e.target.isContentEditable) return;
        escolherVoz(v);
      });
      c.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), escolherVoz(v)));
      c.querySelector('.estudio-voz-ouvir')?.addEventListener('click', (e) => tocarAmostra(v, e.currentTarget));
      c.querySelector('.estudio-voz-renomear')?.addEventListener('click', () => {
        const t = c.querySelector('.estudio-voz-texto b');
        t.contentEditable = 'true';
        t.focus();
        document.getSelection()?.selectAllChildren(t);
        t.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.preventDefault(), t.blur());
          if (e.key === 'Escape') ((t.textContent = v.nome), t.blur());
        });
        t.addEventListener('blur', async () => {
          t.contentEditable = 'false';
          const novo = t.textContent.trim();
          if (novo && novo !== v.nome) await api.estudio.renomearVoz(v.vozSalva, novo);
          await carregar();
        }, { once: true });
      });
      c.querySelector('.estudio-voz-apagar')?.addEventListener('click', async () => {
        if (!confirm(`Apagar a voz "${v.nome}"? O áudio de referência é apagado do computador (os áudios já gerados com ela continuam na biblioteca).`)) return;
        await api.estudio.apagarVoz(v.vozSalva);
        await carregar();
      });
    }
    $('estudioNovaVoz')?.addEventListener('click', abrirNovaVoz);
  }

  /** O seletor "Voz das respostas do chat" (no Estúdio e ao lado do 🔊). */
  function opcoesDoSeletorDoChat() {
    const lista = vozesDisponiveis();
    const atual = escolhas.vozDoChat || '';
    return `<option value="" ${atual ? '' : 'selected'}>A mesma escolhida no Estúdio</option>${lista.map((v) => `<option value="${esc(v.id)}" ${v.id === atual ? 'selected' : ''}>${esc(v.nome)}${v.grupo === 'clonada' ? ' (clonada)' : ` · ${esc(v.grupo)}`}</option>`).join('')}`;
  }
  function pintarSeletoresDoChat() {
    $('estudioVozDoChat').innerHTML = opcoesDoSeletorDoChat();
    document.querySelectorAll('.audio-voz').forEach((s) => (s.innerHTML = opcoesDoSeletorDoChat()));
  }
  function mudarVozDoChat(id) {
    escolhas.vozDoChat = id || undefined;
    guardar();
    pintarSeletoresDoChat();
  }

  /* ------------------------------ os ajustes ------------------------------ */

  function controle(p, alvo, geral = false) {
    const id = `estudio-${geral ? 'g' : motor()}-${p.chave}`;
    const v = geral ? escolhas.geral?.[p.chave] ?? p.padrao : valor(p.chave, p.padrao);
    const guardarValor = (x) => {
      if (geral) (escolhas.geral ||= {})[p.chave] = x;
      else dele()[p.chave] = x;
      guardar();
    };
    const div = document.createElement('div');
    if (p.tipo === 'sim') {
      div.className = 'estudio-sim';
      div.innerHTML = `<label><input type="checkbox" id="${id}" ${v ? 'checked' : ''}/> ${esc(p.rotulo)}</label>`;
      div.querySelector('input').addEventListener('change', (e) => guardarValor(e.target.checked));
    } else {
      div.className = 'estudio-campo estudio-faixa';
      div.innerHTML = `<label for="${id}">${esc(p.rotulo)} <output>${v}</output></label><input type="range" id="${id}" min="${p.min}" max="${p.max}" step="${p.passo}" value="${v}"/>${p.ajuda ? `<span class="dica">${esc(p.ajuda)}</span>` : ''}`;
      const out = div.querySelector('output');
      div.querySelector('input').addEventListener('input', (e) => {
        out.textContent = e.target.value;
        guardarValor(Number(e.target.value));
      });
    }
    alvo.appendChild(div);
  }

  function pintarMotores() {
    const todos = Object.values(est.motores).every((m) => m.instalado) && est.ffmpeg;
    const cartoes = Object.entries(est.motores).map(([id, m]) => `
      <div class="estudio-motor ${m.instalado ? 'ok' : ''}">
        <div><b>${esc(m.nome)}</b> ${m.instalado ? '<span class="estudio-selo">instalado</span>' : `<span class="dica">~${m.gb} GB</span>`}<br/><span class="dica">${esc(m.resumo)}</span></div>
        ${m.instalado ? '' : `<button class="btn-secundario" data-instalar="${id}">Instalar</button>`}
      </div>`).join('') + `
      <div class="estudio-pasta dica">Pasta: <code>${esc(est.pasta)}</code> <button class="btn-link" id="estudioPasta">Mudar…</button>${est.ffmpeg ? '' : ' · <b>falta o ffmpeg</b> (Ajustes → Componentes)'}</div>
      <div class="dica" id="estudioInstalacao" aria-live="polite"></div>`;
    // tudo instalado: os motores saem do caminho, numa linha que abre os detalhes
    $('estudioMotores').classList.toggle('compacto', Boolean(todos));
    $('estudioMotores').innerHTML = todos
      ? `<details class="estudio-motores-ok"><summary>✓ ${Object.values(est.motores).map((m) => esc(m.nome)).join(' e ')} instalados · pasta e motores</summary><div class="estudio-motores-cartoes">${cartoes}</div></details>`
      : cartoes;
    $('estudioMotores').querySelectorAll('[data-instalar]').forEach((b) => b.addEventListener('click', async () => {
      const m = est.motores[b.dataset.instalar];
      if (!confirm(`Instalar o ${m.nome}? Baixa ~${m.gb} GB (Python, PyTorch com CUDA e o modelo na 1ª geração) para:\n${est.pasta}`)) return;
      b.disabled = true;
      const r = await api.estudio.instalar(b.dataset.instalar);
      if (!r.ok) $('estudioInstalacao').textContent = `Não deu: ${r.error}`;
      await carregar();
    }));
    $('estudioPasta').addEventListener('click', async () => {
      const r = await api.estudio.escolherPasta();
      if (r.ok) await carregar();
    });
  }

  function pintarModo() {
    const m = M();
    const modo = modoAtual();
    $('estudioModo').innerHTML = m.modos.map(([id, r]) => `<option value="${id}" ${id === modo ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const c = $('estudioModoCampos');
    c.innerHTML = '';
    const campo = (html) => {
      const d = document.createElement('div');
      d.className = 'estudio-campo';
      d.innerHTML = html;
      c.appendChild(d);
      return d;
    };
    if (motor() === 'qwen' && modo !== 'descrita') {
      const d = campo(`<label for="estudioTamanho">Tamanho do modelo</label><select id="estudioTamanho">${m.tamanhos.map(([id, r]) => `<option value="${id}" ${id === valor('tamanho', '1.7B') ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`);
      d.querySelector('select').addEventListener('change', (e) => ((dele().tamanho = e.target.value), guardar(), pintarModo()));
    }
    if (modo === 'pronta') {
      if (valor('tamanho', '1.7B') === '1.7B') {
        const i = campo(`<label for="estudioInstrucao">Como falar <span class="dica">(emoção, ritmo, estilo — em qualquer idioma)</span></label><textarea id="estudioInstrucao" rows="2" placeholder="Ex.: animado, como um youtuber; ou: sério e pausado, como um documentário">${esc(valor('instrucao', ''))}</textarea>`);
        i.querySelector('textarea').addEventListener('input', (e) => ((dele().instrucao = e.target.value), guardar()));
      }
    } else if (modo === 'descrita' && motor() === 'qwen') {
      const i = campo(`<label for="estudioInstrucao">Descreva a voz <span class="dica">(gênero, idade, timbre, emoção, sotaque, ritmo)</span></label><textarea id="estudioInstrucao" rows="3" placeholder="Ex.: voz masculina adulta, brasileira, de narrador de vídeo: clara, animada, ritmo médio">${esc(valor('instrucao', ''))}</textarea>`);
      i.querySelector('textarea').addEventListener('input', (e) => ((dele().instrucao = e.target.value), guardar()));
    } else if (modo === 'descrita') {
      // OmniVoice: só os atributos que ele conhece, um por grupo
      const atuais = String(valor('instrucao', 'male, middle-aged, moderate pitch')).split(/\s*,\s*/);
      for (const [grupo, itens] of Object.entries(m.descricao)) {
        const d = campo(`<label>${esc(grupo[0].toUpperCase() + grupo.slice(1))}</label><select data-grupo="${esc(grupo)}"><option value="">—</option>${itens.map(([id, r]) => `<option value="${esc(id)}" ${atuais.includes(id) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`);
        d.querySelector('select').addEventListener('change', () => {
          dele().instrucao = [...c.querySelectorAll('select[data-grupo]')].map((s) => s.value).filter(Boolean).join(', ');
          guardar();
        });
      }
    } else if (modo === 'clonar') {
      const v = (est.vozes || []).find((x) => x.id === escolhas.vozSalva);
      campo(`<p class="dica">${v ? `Clonando <b>${esc(v.nome)}</b>.` : 'Nenhuma voz clonada escolhida.'} Troque nos cartões de voz acima.</p>`);
    }
    // a voz descrita/pronta tem detalhes para mexer: o grupo abre sozinho; nos outros fica fechado
    $('estudioDetalhesVoz').open = modo === 'descrita' || (modo === 'pronta' && valor('tamanho', '1.7B') === '1.7B' && Boolean(valor('instrucao', '')));
    // sons no meio do texto (OmniVoice)
    $('estudioMarca').hidden = !m.marcas;
    if (m.marcas) $('estudioMarca').innerHTML = `<option value="">Inserir som…</option>${m.marcas.map(([t, r]) => `<option value="${esc(t)}">${esc(r)} ${esc(t)}</option>`).join('')}`;
  }

  function pintarAjustes() {
    $('estudioMotor').innerHTML = Object.entries(est.motores).map(([id, m]) => `<label><input type="radio" name="estudioMotor" value="${id}" ${id === motor() ? 'checked' : ''} ${m.instalado ? '' : 'disabled'}/> ${esc(m.nome)}</label>`).join('');
    $('estudioMotor').querySelectorAll('input').forEach((r) => r.addEventListener('change', () => ((escolhas.motor = r.value), guardar(), pintarAjustes())));
    pintarModo();
    pintarVozes();
    pintarSeletoresDoChat();
    $('estudioIdioma').innerHTML = est.idiomas.map(([id, r]) => `<option value="${id}" ${id === (escolhas.idioma || 'portuguese') ? 'selected' : ''}>${esc(r)}</option>`).join('');
    $('estudioParametros').innerHTML = '';
    $('estudioAvancados').innerHTML = '';
    for (const p of M().parametros) controle(p, p.avancado ? $('estudioAvancados') : $('estudioParametros'));
    $('estudioAcabamento').innerHTML = '';
    for (const p of est.acabamento) controle(p, $('estudioAcabamento'), true);
    $('estudioFormato').innerHTML = est.formatos.map((f) => `<option value="${f}" ${f === (escolhas.formato || 'mp3') ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('');
    $('estudioSemente').value = escolhas.semente ?? '';
    $('estudioLegenda').checked = escolhas.legenda !== false;
    const algum = Object.values(est.motores).some((m) => m.instalado);
    $('estudioGerar').disabled = !algum || !est.ffmpeg || Boolean(est.gerando);
  }

  function abrirNovaVoz() {
    $('estudioVozNome').value = '';
    $('estudioVozTexto').value = '';
    $('estudioVozAutorizada').checked = false;
    $('estudioVozArquivoNome').textContent = '';
    $('estudioVozErro').textContent = '';
    $('dlgEstudioVoz').showModal();
  }

  function opcoes() {
    const m = M();
    const o = { motor: motor(), modo: $('estudioModo').value, idioma: $('estudioIdioma').value, texto: $('estudioTexto').value, formato: $('estudioFormato').value, legenda: $('estudioLegenda').checked };
    for (const p of m.parametros) o[p.chave] = valor(p.chave, p.padrao);
    for (const p of est.acabamento) o[p.chave] = escolhas.geral?.[p.chave] ?? p.padrao;
    if (motor() === 'qwen') Object.assign(o, { tamanho: valor('tamanho', '1.7B'), voz: valor('voz', 'ryan') });
    o.instrucao = valor('instrucao', motor() === 'omni' ? 'male, middle-aged, moderate pitch' : '');
    if (o.modo === 'clonar') o.vozSalva = escolhas.vozSalva;
    if (motor() === 'omni' && !Number(o.duracao)) delete o.duracao;
    const s = $('estudioSemente').value;
    if (s !== '') o.semente = Number(s);
    return o;
  }

  /* ------------------------------ gerar ------------------------------ */

  async function resultado(r, o) {
    const url = await urlDoAudio(r.arquivo);
    const d = document.createElement('div');
    d.className = 'estudio-resultado';
    const resumo = r.reaproveitado
      ? `já estava na biblioteca · ${fmt(r.segundos)} de áudio, sem gerar de novo`
      : `${est.motores[r.motor].nome} · ${fmt(r.segundos)} de áudio em ${fmt(r.tempo)}`;
    d.innerHTML = `<div class="estudio-linha"><b>${esc(r.titulo || o.texto.trim().slice(0, 60))}</b><span class="dica">${esc(resumo)}</span></div>
      ${url ? `<audio controls src="${url}"></audio>` : ''}
      <div class="estudio-linha"><span><button class="btn-secundario" data-a="salvar">Salvar como…</button> <button class="btn-link" data-a="pasta">Mostrar na pasta</button>${r.legenda ? ' <span class="dica">+ legenda .srt</span>' : ''}</span>${r.reaproveitado ? '<button class="btn-link" data-a="outra">Gerar outra versão</button>' : ''}</div>`;
    d.querySelector('[data-a="salvar"]').addEventListener('click', () => api.estudio.salvarComo(r.arquivo));
    d.querySelector('[data-a="pasta"]').addEventListener('click', () => api.estudio.mostrar(r.arquivo));
    d.querySelector('[data-a="outra"]')?.addEventListener('click', () => (d.remove(), gerar({ novo: true })));
    $('estudioResultados').prepend(d);
  }

  async function gerar(extra = {}) {
    const o = { ...opcoes(), ...extra };
    if (!o.texto.trim()) return ($('estudioProgresso').textContent = 'Escreva o texto primeiro.');
    if (o.modo === 'clonar' && !(est.vozes || []).some((v) => v.id === o.vozSalva)) return ($('estudioProgresso').textContent = 'Escolha uma voz clonada nos cartões (ou clone uma nova).');
    $('estudioGerar').disabled = true;
    $('estudioCancelar').hidden = false;
    $('estudioProgresso').textContent = 'Começando…';
    // 12/11: o Qwen embola siglas e números com qualquer voz — avisa, sem impedir (mesma regra de cheioDeSiglas, src/estudio-de-voz)
    const siglas = (o.texto.match(/\b[A-Z]{2,}[A-Z0-9]*\b|\b\d+(?:[.,]\d+)?\s?[a-zA-Z%]{0,3}\b/g) || []).length >= 3;
    const aviso = o.motor === 'qwen' && siglas && est.motores.omni.instalado ? ' · Dica: este texto tem siglas e números, que o Qwen costuma embolar. O OmniVoice lê melhor.' : '';
    if (aviso) $('estudioProgresso').textContent = `Começando…${aviso}`;
    const r = await api.estudio.gerar(o);
    $('estudioGerar').disabled = false;
    $('estudioCancelar').hidden = true;
    if (!r.ok) {
      $('estudioProgresso').textContent = /fechou/.test(r.error || '') ? 'Cancelado.' : `Não deu: ${r.error}`;
      return;
    }
    $('estudioProgresso').textContent = r.reaproveitado ? 'Este áudio já estava na biblioteca ✓' : `Pronto ✓ ${r.partes} ${r.partes === 1 ? 'parte' : 'partes'}${aviso}`;
    await resultado(r, o);
    carregarBiblioteca();
  }

  /* ------------------------------ biblioteca ------------------------------ */

  let biblioteca = [];
  let filtro = 'todos';
  const quando = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  async function carregarBiblioteca() {
    biblioteca = await api.estudio.biblioteca().catch(() => []);
    $('estudioBibliotecaConta').textContent = biblioteca.length ? String(biblioteca.length) : '';
    if (!$('estudioBiblioteca').hidden) pintarBiblioteca();
  }

  function pintarBiblioteca() {
    const q = norm($('estudioBibBusca').value);
    const lista = biblioteca.filter((a) => (filtro === 'todos' || (filtro === 'clonadas' && a.modo === 'clonar') || (filtro === 'chat' && a.doChat) || (filtro === 'favoritos' && a.favorito)) && (!q || norm(`${a.titulo} ${a.texto} ${a.voz}`).includes(q)));
    const alvo = $('estudioBibLista');
    if (!lista.length) {
      alvo.innerHTML = `<p class="estudio-bib-vazia">${biblioteca.length ? 'Nada com esse filtro.' : 'Os áudios que você gerar aparecem aqui — para ouvir de novo, sem gerar.'}</p>`;
      return;
    }
    alvo.innerHTML = lista.map((a, i) => `
      <article class="estudio-bib-item" data-i="${i}">
        <button type="button" class="estudio-bib-tocar" title="Ouvir" aria-label="Ouvir">▶</button>
        <div class="estudio-bib-info">
          <b class="estudio-bib-titulo">${esc(a.titulo)}</b>
          <span class="dica">${[a.voz && `${a.modo === 'clonar' ? '🎙 ' : ''}${esc(a.voz)}`, a.segundos ? fmt(a.segundos) : '', quando(a.criada), a.doChat ? 'do chat' : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div class="estudio-bib-acoes">
          <button type="button" class="estudio-bib-fav ${a.favorito ? 'ativo' : ''}" data-a="fav" title="${a.favorito ? 'Tirar dos favoritos' : 'Favoritar'}" aria-label="Favoritar" aria-pressed="${a.favorito}">${a.favorito ? '★' : '☆'}</button>
          <button type="button" class="btn-link" data-a="renomear">Renomear</button>
          ${a.texto ? '<button type="button" class="btn-link" data-a="usar" title="Põe este texto (e a voz, se ainda existir) no Criar áudio">Usar o texto</button>' : ''}
          <button type="button" class="btn-link" data-a="salvar">Salvar como…</button>
          <button type="button" class="btn-link perigo" data-a="apagar">Apagar</button>
        </div>
      </article>`).join('');
    for (const item of alvo.querySelectorAll('.estudio-bib-item')) {
      const a = lista[Number(item.dataset.i)];
      item.querySelector('.estudio-bib-tocar').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        let player = item.querySelector('audio');
        if (player) return player.paused ? player.play() : player.pause();
        const url = await urlDoAudio(a.arquivo);
        if (!url) return (b.textContent = '!');
        player = document.createElement('audio');
        player.controls = true;
        player.src = url;
        player.addEventListener('play', () => (b.textContent = '❚❚'));
        player.addEventListener('pause', () => (b.textContent = '▶'));
        item.appendChild(player);
        player.play().catch(() => {});
      });
      item.querySelector('[data-a="fav"]').addEventListener('click', async () => {
        await api.estudio.atualizarAudio(a.arquivo, { favorito: !a.favorito });
        await carregarBiblioteca();
      });
      item.querySelector('[data-a="renomear"]').addEventListener('click', () => {
        const t = item.querySelector('.estudio-bib-titulo');
        t.contentEditable = 'true';
        t.focus();
        document.getSelection()?.selectAllChildren(t);
        const salvar = async () => {
          t.contentEditable = 'false';
          const novo = t.textContent.trim();
          if (novo && novo !== a.titulo) await api.estudio.atualizarAudio(a.arquivo, { titulo: novo });
          await carregarBiblioteca();
        };
        t.addEventListener('blur', salvar, { once: true });
        t.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') (e.preventDefault(), t.blur());
          if (e.key === 'Escape') ((t.textContent = a.titulo), t.blur());
        });
      });
      item.querySelector('[data-a="usar"]')?.addEventListener('click', () => {
        $('estudioTexto').value = a.texto;
        $('estudioTexto').dispatchEvent(new Event('input'));
        const voz = vozesDisponiveis().find((v) => (a.modo === 'clonar' ? v.modo === 'clonar' && v.nome === a.voz : false));
        if (voz) escolherVoz(voz);
        abrirAba('criar');
        $('estudioTexto').focus();
      });
      item.querySelector('[data-a="salvar"]').addEventListener('click', () => api.estudio.salvarComo(a.arquivo));
      item.querySelector('[data-a="apagar"]').addEventListener('click', async () => {
        if (!confirm(`Apagar "${a.titulo}"? O áudio (e a legenda) vão para a Lixeira.`)) return;
        await api.estudio.apagarAudio(a.arquivo);
        await carregarBiblioteca();
      });
    }
  }

  function abrirAba(qual) {
    for (const b of document.querySelectorAll('[data-aba-estudio]')) {
      const sim = b.dataset.abaEstudio === qual;
      b.classList.toggle('ativo', sim);
      b.setAttribute('aria-selected', String(sim));
    }
    $('estudioCriar').hidden = qual !== 'criar';
    $('estudioBiblioteca').hidden = qual !== 'biblioteca';
    if (qual === 'biblioteca') carregarBiblioteca().then(pintarBiblioteca);
  }

  async function carregar() {
    est = await api.estudio.estado();
    pintarMotores();
    pintarAjustes();
    carregarBiblioteca();
  }

  // ---------- eventos fixos ----------
  $('estudioTexto').value = escolhas.texto || '';
  const contar = () => {
    const t = $('estudioTexto').value;
    const partes = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
    $('estudioContagem').textContent = `${t.length} caracteres · ${partes} ${partes === 1 ? 'parte' : 'partes'}`;
  };
  contar();
  $('estudioTexto').addEventListener('input', () => ((escolhas.texto = $('estudioTexto').value.slice(0, 20000)), guardar(), contar()));
  $('estudioMarca').addEventListener('change', (e) => {
    const t = $('estudioTexto');
    if (!e.target.value) return;
    const i = t.selectionStart ?? t.value.length;
    t.value = `${t.value.slice(0, i)} ${e.target.value} ${t.value.slice(i)}`;
    e.target.value = '';
    t.dispatchEvent(new Event('input'));
    t.focus();
  });
  $('estudioModo').addEventListener('change', (e) => ((dele().modo = e.target.value), guardar(), pintarModo(), pintarVozes()));
  $('estudioIdioma').addEventListener('change', (e) => ((escolhas.idioma = e.target.value), guardar()));
  $('estudioFormato').addEventListener('change', (e) => ((escolhas.formato = e.target.value), guardar()));
  $('estudioSemente').addEventListener('input', (e) => ((escolhas.semente = e.target.value === '' ? undefined : Number(e.target.value)), guardar()));
  $('estudioLegenda').addEventListener('change', (e) => ((escolhas.legenda = e.target.checked), guardar()));
  $('estudioVozDoChat').addEventListener('change', (e) => mudarVozDoChat(e.target.value));
  $('estudioRestaurar').addEventListener('click', () => {
    escolhas = { texto: escolhas.texto, motor: escolhas.motor, vozSalva: escolhas.vozSalva, vozDoChat: escolhas.vozDoChat };
    guardar();
    pintarAjustes();
  });
  $('estudioAbrirPasta').addEventListener('click', () => api.estudio.mostrar());
  $('estudioGerar').addEventListener('click', () => gerar());
  $('estudioCancelar').addEventListener('click', () => api.estudio.cancelar());
  for (const b of document.querySelectorAll('[data-aba-estudio]')) b.addEventListener('click', () => abrirAba(b.dataset.abaEstudio));
  $('estudioBibBusca').addEventListener('input', pintarBiblioteca);
  for (const b of $('estudioBibFiltros').querySelectorAll('[data-filtro]')) {
    b.addEventListener('click', () => {
      filtro = b.dataset.filtro;
      $('estudioBibFiltros').querySelectorAll('[data-filtro]').forEach((x) => x.classList.toggle('ativo', x === b));
      pintarBiblioteca();
    });
  }
  // nova voz
  $('estudioVozArquivo').addEventListener('click', async () => {
    const r = await api.estudio.escolherAudio();
    if (r.ok) $('estudioVozArquivoNome').textContent = r.nome;
  });
  $('estudioVozCancelar').addEventListener('click', () => $('dlgEstudioVoz').close());
  $('estudioVozSalvar').addEventListener('click', async () => {
    $('estudioVozErro').textContent = '';
    if (!$('estudioVozArquivoNome').textContent) return ($('estudioVozErro').textContent = 'Escolha o áudio da voz.');
    if (!$('estudioVozAutorizada').checked) return ($('estudioVozErro').textContent = 'Confirme que a voz é sua ou que você tem autorização.');
    $('estudioVozSalvar').disabled = true;
    $('estudioVozErro').textContent = 'Preparando o áudio…';
    const r = await api.estudio.salvarVoz({ nome: $('estudioVozNome').value || 'Minha voz', texto: $('estudioVozTexto').value, autorizada: true });
    $('estudioVozSalvar').disabled = false;
    if (!r.ok) return ($('estudioVozErro').textContent = `Não deu: ${r.error}`);
    $('dlgEstudioVoz').close();
    est = await api.estudio.estado();
    // a voz nova já fica escolhida
    const nova = vozesDisponiveis().find((v) => v.vozSalva === r.voz.id);
    if (nova) escolherVoz(nova);
    else await carregar();
  });

  /* ---------- 🔊 no fim da resposta (12/11): a resposta vira áudio com a voz escolhida para o chat ---------- */
  let botaoAtivo = null;
  function opcoesDoChat(markdown) {
    const disponiveis = vozesDisponiveis();
    // a voz escolhida para o chat; sem ela (ou se sumiu), a do Estúdio; o OmniVoice primeiro (rápido e lê siglas)
    let voz = disponiveis.find((v) => v.id === escolhas.vozDoChat) || disponiveis.find((v) => v.id === vozAtual());
    if (!voz) voz = disponiveis.find((v) => v.motor === 'omni' && v.modo !== 'clonar') || disponiveis.find((v) => v.modo !== 'clonar');
    if (!voz) return null;
    const m = voz.motor;
    const p = escolhas[m] || {};
    const v = (k, d) => p[k] ?? escolhas.geral?.[k] ?? d;
    const o = { motor: m, modo: voz.modo, idioma: escolhas.idioma || 'auto', texto: markdown, formato: 'mp3', legenda: false, daResposta: true };
    for (const par of est.motores[m].parametros) o[par.chave] = v(par.chave, par.padrao);
    for (const par of est.acabamento) o[par.chave] = escolhas.geral?.[par.chave] ?? par.padrao;
    if (m === 'qwen') Object.assign(o, { tamanho: v('tamanho', '1.7B'), voz: voz.voz || v('voz', 'ryan') });
    o.instrucao = v('instrucao', m === 'omni' ? 'male, middle-aged, moderate pitch' : '');
    if (voz.modo === 'clonar') o.vozSalva = voz.vozSalva;
    delete o.duracao; // duração fixa é para um trecho do Estúdio, não para a resposta inteira
    if (Number.isFinite(escolhas.semente)) o.semente = escolhas.semente;
    return { o, voz };
  }
  window.botaoDeAudio = async (corpo, markdown) => {
    if (!corpo || !String(markdown || '').trim()) return;
    try {
      est ||= await api.estudio.estado();
    } catch {
      return;
    }
    if (!est.ffmpeg || !vozesDisponiveis().length) return;
    const caixa = document.createElement('div');
    caixa.className = 'audio-resposta';
    caixa.innerHTML = `<button class="btn-link" type="button">🔊 Gerar áudio</button><select class="audio-voz" aria-label="Voz do áudio">${opcoesDoSeletorDoChat()}</select>`;
    const b = caixa.querySelector('button');
    caixa.querySelector('.audio-voz').addEventListener('change', (e) => mudarVozDoChat(e.target.value));
    b.addEventListener('click', async () => {
      if (botaoAtivo) return (b.textContent = '🔊 Espere o outro áudio terminar');
      const pedido = opcoesDoChat(markdown);
      if (!pedido) return;
      botaoAtivo = b;
      b.disabled = true;
      b.textContent = `🔊 Gerando com ${pedido.voz.nome}…`;
      const r = await api.estudio.gerar(pedido.o).catch((err) => ({ ok: false, error: err.message }));
      botaoAtivo = null;
      b.disabled = false;
      if (!r.ok) return (b.textContent = `🔊 Não deu: ${r.error} — tentar de novo`);
      const url = await urlDoAudio(r.arquivo);
      caixa.innerHTML = `${url ? '<audio controls autoplay></audio>' : ''}<button class="btn-link" type="button" data-a="salvar">Salvar como…</button><span class="dica">${esc(r.reaproveitado ? `${pedido.voz.nome} · da biblioteca, sem gerar de novo` : `${pedido.voz.nome} · ${fmt(r.segundos)} de áudio em ${fmt(r.tempo)}`)}</span>`;
      if (url) caixa.querySelector('audio').src = url;
      caixa.querySelector('[data-a="salvar"]').addEventListener('click', () => api.estudio.salvarComo(r.arquivo));
      carregarBiblioteca();
    });
    corpo.appendChild(caixa);
  };

  window.carregarEstudio = () => carregar().catch((err) => ($('estudioMotores').textContent = `Erro: ${err.message}`));
  window.estudioEvento = (canal, dados) => {
    if (canal !== 'estudio-progresso' || !dados.texto) return;
    if (botaoAtivo && !dados.motor) botaoAtivo.textContent = `🔊 ${dados.texto}`;
    if (dados.motor) {
      const alvo = $('estudioInstalacao');
      if (alvo) alvo.textContent = dados.texto;
    } else $('estudioProgresso').textContent = dados.texto;
  };
})();
