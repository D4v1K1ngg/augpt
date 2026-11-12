'use strict';

/**
 * Estúdio de voz (11/11): a tela de texto → áudio. Os controles saem da descrição dos motores que o processo
 * principal manda (src/estudio-de-voz/index.js, MOTORES/ACABAMENTO): o que o modelo aceita aparece aqui.
 * As últimas escolhas ficam no localStorage (só conveniência: sem elas, os padrões dos modelos).
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
  const motor = () => (est?.motores[escolhas.motor] ? escolhas.motor : 'omni');
  const M = () => est.motores[motor()];
  // as escolhas de cada motor ficam separadas (temperatura do Qwen ≠ do OmniVoice)
  const dele = () => (escolhas[motor()] ||= {});
  const valor = (chave, padrao) => (dele()[chave] ?? escolhas.geral?.[chave] ?? padrao);

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
    $('estudioMotores').innerHTML = Object.entries(est.motores).map(([id, m]) => `
      <div class="estudio-motor ${m.instalado ? 'ok' : ''}">
        <div><b>${esc(m.nome)}</b> ${m.instalado ? '<span class="estudio-selo">instalado</span>' : `<span class="dica">~${m.gb} GB</span>`}<br/><span class="dica">${esc(m.resumo)}</span></div>
        ${m.instalado ? '' : `<button class="btn-secundario" data-instalar="${id}">Instalar</button>`}
      </div>`).join('') + `
      <div class="estudio-pasta dica">Pasta: <code>${esc(est.pasta)}</code> <button class="btn-link" id="estudioPasta">Mudar…</button>${est.ffmpeg ? '' : ' · <b>falta o ffmpeg</b> (Ajustes → Componentes)'}</div>
      <div class="dica" id="estudioInstalacao" aria-live="polite"></div>`;
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
    const modo = m.modos.some(([id]) => id === dele().modo) ? dele().modo : m.modos[0][0];
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
      const d = campo(`<label for="estudioVoz">Voz</label><select id="estudioVoz">${m.vozes.map(([id, r]) => `<option value="${id}" ${id === valor('voz', 'ryan') ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`);
      d.querySelector('select').addEventListener('change', (e) => ((dele().voz = e.target.value), guardar()));
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
      const vozes = est.vozes || [];
      const d = campo(`<label for="estudioVozSalva">Voz clonada</label><div class="estudio-linha"><select id="estudioVozSalva">${vozes.length ? vozes.map((v) => `<option value="${esc(v.id)}" ${v.id === escolhas.vozSalva ? 'selected' : ''}>${esc(v.nome)}</option>`).join('') : '<option value="">nenhuma voz salva</option>'}</select><button class="btn-secundario" id="estudioNovaVoz">Nova voz…</button>${vozes.length ? '<button class="btn-link perigo" id="estudioApagarVoz">Apagar</button>' : ''}</div>`);
      d.querySelector('select').addEventListener('change', (e) => ((escolhas.vozSalva = e.target.value), guardar()));
      d.querySelector('#estudioNovaVoz').addEventListener('click', abrirNovaVoz);
      d.querySelector('#estudioApagarVoz')?.addEventListener('click', async () => {
        const id = $('estudioVozSalva').value;
        const v = vozes.find((x) => x.id === id);
        if (!v || !confirm(`Apagar a voz "${v.nome}"? O áudio de referência é apagado do computador.`)) return;
        await api.estudio.apagarVoz(id);
        await carregar();
      });
    }
    // sons no meio do texto (OmniVoice)
    $('estudioMarca').hidden = !m.marcas;
    if (m.marcas) $('estudioMarca').innerHTML = `<option value="">Inserir som…</option>${m.marcas.map(([t, r]) => `<option value="${esc(t)}">${esc(r)} ${esc(t)}</option>`).join('')}`;
  }

  function pintarAjustes() {
    $('estudioMotor').innerHTML = Object.entries(est.motores).map(([id, m]) => `<label><input type="radio" name="estudioMotor" value="${id}" ${id === motor() ? 'checked' : ''} ${m.instalado ? '' : 'disabled'}/> ${esc(m.nome)}</label>`).join('');
    $('estudioMotor').querySelectorAll('input').forEach((r) => r.addEventListener('change', () => ((escolhas.motor = r.value), guardar(), pintarAjustes())));
    pintarModo();
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
    if (o.modo === 'clonar') o.vozSalva = $('estudioVozSalva')?.value;
    if (motor() === 'omni' && !Number(o.duracao)) delete o.duracao;
    const s = $('estudioSemente').value;
    if (s !== '') o.semente = Number(s);
    return o;
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  async function resultado(r, o) {
    const bytes = await api.estudio.ler(r.arquivo);
    const tipo = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' }[o.formato] || 'audio/mpeg';
    const url = bytes ? URL.createObjectURL(new Blob([bytes], { type: tipo })) : '';
    const d = document.createElement('div');
    d.className = 'estudio-resultado';
    const resumo = `${est.motores[r.motor].nome} · ${o.modo}${o.voz && o.modo === 'pronta' ? ` (${o.voz})` : ''} · ${fmt(r.segundos)} de áudio em ${fmt(r.tempo)}`;
    d.innerHTML = `<div class="estudio-linha"><b>${esc(o.texto.trim().slice(0, 60))}${o.texto.trim().length > 60 ? '…' : ''}</b><span class="dica">${esc(resumo)}</span></div>
      ${url ? `<audio controls src="${url}"></audio>` : ''}
      <div class="estudio-linha"><button class="btn-secundario" data-a="salvar">Salvar como…</button><button class="btn-link" data-a="pasta">Mostrar na pasta</button>${r.legenda ? '<span class="dica">+ legenda .srt</span>' : ''}</div>`;
    d.querySelector('[data-a="salvar"]').addEventListener('click', () => api.estudio.salvarComo(r.arquivo));
    d.querySelector('[data-a="pasta"]').addEventListener('click', () => api.estudio.mostrar(r.arquivo));
    $('estudioResultados').prepend(d);
  }

  async function carregar() {
    est = await api.estudio.estado();
    pintarMotores();
    pintarAjustes();
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
  $('estudioModo').addEventListener('change', (e) => ((dele().modo = e.target.value), guardar(), pintarModo()));
  $('estudioIdioma').addEventListener('change', (e) => ((escolhas.idioma = e.target.value), guardar()));
  $('estudioFormato').addEventListener('change', (e) => ((escolhas.formato = e.target.value), guardar()));
  $('estudioSemente').addEventListener('input', (e) => ((escolhas.semente = e.target.value === '' ? undefined : Number(e.target.value)), guardar()));
  $('estudioLegenda').addEventListener('change', (e) => ((escolhas.legenda = e.target.checked), guardar()));
  $('estudioRestaurar').addEventListener('click', () => {
    escolhas = { texto: escolhas.texto, motor: escolhas.motor, vozSalva: escolhas.vozSalva };
    guardar();
    pintarAjustes();
  });
  $('estudioAbrirPasta').addEventListener('click', () => api.estudio.mostrar());
  $('estudioGerar').addEventListener('click', async () => {
    const o = opcoes();
    if (!o.texto.trim()) return ($('estudioProgresso').textContent = 'Escreva o texto primeiro.');
    if (o.modo === 'clonar' && !o.vozSalva) return ($('estudioProgresso').textContent = 'Salve uma voz para clonar (Nova voz…).');
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
    $('estudioProgresso').textContent = `Pronto ✓ ${r.partes} ${r.partes === 1 ? 'parte' : 'partes'}${aviso}`;
    await resultado(r, o);
  });
  $('estudioCancelar').addEventListener('click', () => api.estudio.cancelar());
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
    escolhas.vozSalva = r.voz.id;
    guardar();
    $('dlgEstudioVoz').close();
    await carregar();
  });

  /* ---------- 🔊 no fim da resposta (12/11): a resposta vira áudio com o motor e as escolhas do Estúdio ---------- */
  let botaoAtivo = null;
  function opcoesDoChat(m, markdown) {
    const p = escolhas[m] || {};
    const v = (k, d) => p[k] ?? escolhas.geral?.[k] ?? d;
    const modos = est.motores[m].modos.map(([id]) => id);
    let modo = modos.includes(p.modo) ? p.modo : modos[0];
    if (modo === 'clonar' && !est.vozes?.some((x) => x.id === escolhas.vozSalva)) modo = modos[0];
    const o = { motor: m, modo, idioma: escolhas.idioma || 'auto', texto: markdown, formato: 'mp3', legenda: false, daResposta: true };
    for (const par of est.motores[m].parametros) o[par.chave] = v(par.chave, par.padrao);
    for (const par of est.acabamento) o[par.chave] = escolhas.geral?.[par.chave] ?? par.padrao;
    if (m === 'qwen') Object.assign(o, { tamanho: v('tamanho', '1.7B'), voz: v('voz', 'ryan') });
    o.instrucao = v('instrucao', m === 'omni' ? 'male, middle-aged, moderate pitch' : '');
    if (modo === 'clonar') o.vozSalva = escolhas.vozSalva;
    delete o.duracao; // duração fixa é para um trecho do Estúdio, não para a resposta inteira
    if (Number.isFinite(escolhas.semente)) o.semente = escolhas.semente;
    return o;
  }
  window.botaoDeAudio = async (corpo, markdown) => {
    if (!corpo || !String(markdown || '').trim()) return;
    try {
      est ||= await api.estudio.estado();
    } catch {
      return;
    }
    // o OmniVoice primeiro (rápido e lê siglas); o Qwen só se for o único instalado
    const m = ['omni', 'qwen'].find((x) => est.motores[x]?.instalado);
    if (!m || !est.ffmpeg) return;
    const caixa = document.createElement('div');
    caixa.className = 'audio-resposta';
    caixa.innerHTML = '<button class="btn-link" type="button">🔊 Gerar áudio</button>';
    const b = caixa.querySelector('button');
    b.addEventListener('click', async () => {
      if (botaoAtivo) return (b.textContent = '🔊 Espere o outro áudio terminar');
      botaoAtivo = b;
      b.disabled = true;
      b.textContent = `🔊 Gerando com o ${est.motores[m].nome}…`;
      const o = opcoesDoChat(m, markdown);
      const r = await api.estudio.gerar(o).catch((err) => ({ ok: false, error: err.message }));
      botaoAtivo = null;
      b.disabled = false;
      if (!r.ok) return (b.textContent = `🔊 Não deu: ${r.error} — tentar de novo`);
      const bytes = await api.estudio.ler(r.arquivo);
      const url = bytes ? URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })) : '';
      caixa.innerHTML = `${url ? '<audio controls autoplay></audio>' : ''}<button class="btn-link" type="button" data-a="salvar">Salvar como…</button><span class="dica">${esc(`${fmt(r.segundos)} de áudio em ${fmt(r.tempo)}`)}</span>`;
      if (url) caixa.querySelector('audio').src = url;
      caixa.querySelector('[data-a="salvar"]').addEventListener('click', () => api.estudio.salvarComo(r.arquivo));
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
