'use strict';

/* Parte da tela do AuGPT (renderer/app.js dividido em 19/10): os arquivos app*.js são scripts comuns,
 * carregados em ordem no index.html, e compartilham as mesmas variáveis do nível de cima. */

/* ============================ configurações ============================ */

/** Preferências que mudam o que aparece na tela (Fase 2, facilidade de uso). */
function aplicarPreferenciasDeTela() {
  document.body.classList.toggle('mostrar-tecnico', config.mostrarDetalhesTecnicos === true);
}

async function carregarConfig() {
  config = await api.config.get();
  aplicarPreferenciasDeTela();
  el.autonomia.value = config.autonomy;
  $('nivelRaciocinio').value = config.nivelRaciocinio || 'leve';
  $('modoResposta').value = config.modoResposta || 'normal';
  pintarModoDoAgente();
  el.max.textContent = config.maxIterations;
  el.caminho.textContent = config.workspace || '—';
  el.caminho.title = config.workspace || '';
  aplicarLateral(config.lateralAberta !== false);
  atualizarAvisoNivelExtremo();
}

function preencherConfig() {
  $('cfgHost').value = config.host;
  $('cfgEmbed').value = config.embedModel;
  $('cfgTopK').value = config.memoryTopK;
  $('cfgMax').value = config.maxIterations;
  $('cfgCopiloto2Modo').value = config.copiloto2Modo || 'mesmoModelo';
  $('cfgCriticaPeriodicaModo').value = config.criticaPeriodicaModo === 'evento' ? 'evento' : 'frequencia';
  atualizarVisibilidadeModeloCopiloto2();
  atualizarAvisoMaxModelosCarregados();
  $('cfgVerificarAmbiguidade').checked = config.verificarAmbiguidade !== false;
  $('cfgCriacaoAutomaticaDeSkills').checked = config.criacaoAutomaticaDeSkills !== false;
  $('cfgTemp').value = config.temperature;
  $('cfgCtx').value = config.numCtx;
  $('cfgCtxRedacao').value = config.numCtxRedacao || '';
  $('cfgCtxCopiloto').value = config.numCtxCopiloto || '';
  $('cfgShell').value = Math.round(config.shellTimeoutMs / 1000);
  pintarModelosDeEtapa();
  $('cfgSearx').value = config.searxngUrl || '';
  $('cfgMarginaliaKey').value = config.marginaliaKey && config.marginaliaKey !== 'public' ? config.marginaliaKey : '';
  $('cfgJinaKey').value = config.jinaKey || '';
  $('cfgUsarSxEmbutido').checked = config.usarSearxngEmbutido === true;
  $('cfgRenderJs').checked = config.renderizarJs !== false;
  // Padrão desligado desde a Fase 1 de segurança — só marcado com opt-in explícito.
  $('cfgLeitorExterno').checked = config.permitirLeitorExterno === true;
  $('cfgRedeLocal').checked = config.permitirRedeLocal === true;
  $('cfgDetalhesTecnicos').checked = config.mostrarDetalhesTecnicos === true;
  $('cfgNavegacao').checked = config.navegacaoInterativa !== false;
  $('cfgImagensNasRespostas').checked = config.imagensNasRespostas !== false;
  $('cfgRevisarImagens').checked = config.revisarImagensCriadas !== false;
  $('cfgAnimacaoDeAbertura').checked = config.animacaoDeAbertura !== false;
  $('cfgSomDaAbertura').checked = config.somDaAbertura !== false;
  $('cfgOndeComprar').checked = config.ondeComprar !== false;
  $('cfgFontesComunidade').value = (config.fontesComunidade || []).join('\n');
  $('cfgNavegadorVisivel').checked = config.navegadorVisivel !== false;
  $('cfgDownloadsDoNavegador').value = config.downloadsDoNavegador === 'pasta-de-trabalho' ? 'pasta-de-trabalho' : 'perguntar';
  el.caminho.textContent = config.workspace || '—';
  el.caminho.title = config.workspace || '';
  pintarPermitidas();
}

$('btnRestaurarPadroes').addEventListener('click', async () => {
  if (!confirm('Voltar todos os ajustes ao padrão? A pasta de trabalho, o modelo escolhido, suas rotinas, servidores MCP e domínios marcados continuam como estão.')) return;
  config = await api.config.restaurar();
  preencherConfig();
  aplicarPreferenciasDeTela();
  el.autonomia.value = config.autonomy;
  $('nivelRaciocinio').value = config.nivelRaciocinio;
  $('modoResposta').value = config.modoResposta;
  el.max.textContent = config.maxIterations;
});

// Fase 1 (16/10): sem botão "Salvar" — cada ajuste grava quando muda (o
// "change" de um campo cfg* em Ajustes chama salvarAjustes).
async function salvarAjustes() {
  const antes = config;
  const segundos = Number($('cfgShell').value) * 1000;
  config = await api.config.set({
    host: $('cfgHost').value.trim() || 'http://127.0.0.1:11434',
    embedModel: $('cfgEmbed').value.trim() || 'nomic-embed-text',
    memoryTopK: Number($('cfgTopK').value) || 4,
    maxIterations: Number($('cfgMax').value) || 25,
    copiloto2Modo: $('cfgCopiloto2Modo').value,
    criticaPeriodicaModo: $('cfgCriticaPeriodicaModo').value,
    modelCopiloto2: $('cfgModeloCopiloto2').value,
    verificarAmbiguidade: $('cfgVerificarAmbiguidade').checked,
    criacaoAutomaticaDeSkills: $('cfgCriacaoAutomaticaDeSkills').checked,
    // Campo vazio mantém o valor atual — antes, temperatura em branco virava 0
    // e janela de contexto em branco virava 8192 (diferente do padrão, 16384).
    temperature: $('cfgTemp').value === '' ? config.temperature : Number($('cfgTemp').value),
    numCtx: Number($('cfgCtx').value) || config.numCtx,
    numCtxRedacao: Number($('cfgCtxRedacao').value) || null,
    numCtxCopiloto: Number($('cfgCtxCopiloto').value) || null,
    shellTimeoutMs: segundos,
    codeTimeoutMs: segundos,
    modelDecisao: $('cfgModeloDecisao').value,
    modelRedacao: $('cfgModeloRedacao').value,
    searxngUrl: $('cfgSearx').value.trim(),
    marginaliaKey: $('cfgMarginaliaKey').value.trim() || 'public',
    jinaKey: $('cfgJinaKey').value.trim(),
    usarSearxngEmbutido: $('cfgUsarSxEmbutido').checked,
    renderizarJs: $('cfgRenderJs').checked,
    permitirLeitorExterno: $('cfgLeitorExterno').checked,
    permitirRedeLocal: $('cfgRedeLocal').checked,
    navegacaoInterativa: $('cfgNavegacao').checked,
    imagensNasRespostas: $('cfgImagensNasRespostas').checked,
    revisarImagensCriadas: $('cfgRevisarImagens').checked,
    animacaoDeAbertura: $('cfgAnimacaoDeAbertura').checked,
    somDaAbertura: $('cfgSomDaAbertura').checked,
    ondeComprar: $('cfgOndeComprar').checked,
    // um endereço por linha; vazio = lista padrão (dados/comunidades.json)
    fontesComunidade: $('cfgFontesComunidade')
      .value.split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean),
    navegadorVisivel: $('cfgNavegadorVisivel').checked,
    downloadsDoNavegador: $('cfgDownloadsDoNavegador').value,
    mostrarDetalhesTecnicos: $('cfgDetalhesTecnicos').checked,
  });
  aplicarPreferenciasDeTela();
  el.max.textContent = config.maxIterations;
  const aviso = $('ajustesSalvo');
  aviso.textContent = 'Salvo ✓';
  clearTimeout(salvarAjustes.t);
  salvarAjustes.t = setTimeout(() => (aviso.textContent = ''), 1600);
  if (antes.host !== config.host) verificarOllama();
  if (antes.usarSearxngEmbutido !== config.usarSearxngEmbutido) {
    if (config.usarSearxngEmbutido) await api.searxngRuntime.iniciar();
    else await api.searxngRuntime.parar();
    carregarEstadoSearxngRuntime();
  }
}
$('viewConfig').addEventListener('change', (e) => {
  if (/^cfg/.test(e.target.id || '')) salvarAjustes();
});

/** Preenche os seletores de modelo por etapa com os modelos disponíveis. */
function pintarModelosDeEtapa() {
  const opcoes = [...el.modelo.options].filter((o) => o.value).map((o) => ({ nome: o.value, pensa: o.dataset.pensa === '1' }));
  const opcaoHtml = (m) => `<option value="${esc(m.nome)}">${esc(rotuloDoModelo(m.nome, m.pensa))}</option>`;
  for (const [id, valor] of [
    ['cfgModeloDecisao', config.modelDecisao],
    ['cfgModeloRedacao', config.modelRedacao],
  ]) {
    $(id).innerHTML = '<option value="">o mesmo do topo</option>' + opcoes.map(opcaoHtml).join('');
    $(id).value = valor || '';
  }
  // Modelo dedicado do Copiloto nível 2 (modo "2 IAs") — sem valor default
  // "o mesmo do topo": em branco aqui significa que o modo "2 IAs" ainda cai
  // de volta pro modelo de decisão de sempre (ver Agent.consultarCritico,
  // usaModeloDedicado), não que existe um "modelo do topo" implícito pra
  // esse papel específico.
  // modelo que pensa como copiloto não serve: a crítica tem limite de 90–150
  // tokens e ele gastaria tudo raciocinando — fica fora desta lista
  $('cfgModeloCopiloto2').innerHTML =
    '<option value="">selecione…</option>' + opcoes.filter((m) => !m.pensa).map(opcaoHtml).join('');
  // valor salvo que não está mais na lista (tev1, R1) fica em branco = cai no modelo de decisão de sempre
  $('cfgModeloCopiloto2').value = opcoes.some((m) => !m.pensa && m.nome === config.modelCopiloto2) ? config.modelCopiloto2 : '';
}

/** Mostra o seletor de modelo dedicado (e a janela de contexto dele) só quando o modo "2 IAs" está ativo. */
function atualizarVisibilidadeModeloCopiloto2() {
  const doisModelos = $('cfgCopiloto2Modo').value === 'doisModelos';
  $('cfgCopiloto2ModeloLinha').hidden = !doisModelos;
  $('cfgCopiloto2CtxLinha').hidden = !doisModelos;
}
$('cfgCopiloto2Modo').addEventListener('change', () => {
  atualizarVisibilidadeModeloCopiloto2();
  atualizarAvisoMaxModelosCarregados();
});

function pintarPermitidas() {
  const alvo = $('cfgPermitidas');
  const lista = config.alwaysAllow || [];
  alvo.innerHTML = lista.length
    ? lista.map((n) => `<button type="button" data-n="${esc(n)}" title="Remover">${esc(n)} ✕</button>`).join('')
    : '<span class="nenhuma">nenhuma</span>';
  alvo.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', async () => {
      config = await api.config.set({ alwaysAllow: (config.alwaysAllow || []).filter((x) => x !== b.dataset.n) });
      pintarPermitidas();
    })
  );
}

/* ============================ domínios ============================ */

const RISCO_ROTULO = {
  confiavel: { texto: 'confiável', classe: 'ok' },
  medio: { texto: 'apuração fraca', classe: 'alerta' },
  alto: { texto: 'não confiável', classe: 'ruim' },
  satira: { texto: 'sátira', classe: 'alerta' },
};

let dominiosSeus = [];

async function carregarDominios() {
  const d = await api.domains.stats();
  dominiosSeus = d.seus || [];
  $('domTotal').textContent = (d.credibilidade + dominiosSeus.length).toLocaleString('pt-BR');

  $('domResumo').innerHTML = `
    <span><b>${d.credibilidade.toLocaleString('pt-BR')}</b> domínios classificados</span>
    <span><b>${(d.porRisco.alto || 0).toLocaleString('pt-BR')}</b> com conteúdo fabricado</span>
    <span><b>${(d.porRisco.satira || 0).toLocaleString('pt-BR')}</b> sátira</span>
    <span><b>${d.bloqueados.toLocaleString('pt-BR')}</b> com bloqueio judicial no Brasil</span>
    <span class="dom-origem">${esc((d.origens || []).join(' · '))}${
      d.atualizadoEm ? ` · atualizado em ${esc(d.atualizadoEm)}` : ''
    }</span>`;

  const alvo = $('domLista');
  alvo.innerHTML = dominiosSeus.length ? '' : '<p class="dica">Nenhuma marcação sua ainda.</p>';
  for (const [i, item] of dominiosSeus.entries()) {
    const rotulo = RISCO_ROTULO[item.risco] || { texto: item.risco, classe: '' };
    const div = document.createElement('div');
    div.className = 'dom-item';
    div.innerHTML = `
      <span class="dom-nome"></span>
      <span class="exec-resultado ${rotulo.classe}">${rotulo.texto}</span>
      <span class="dom-motivo"></span>
      <button class="btn-linha" title="Remover">✕</button>`;
    div.querySelector('.dom-nome').textContent = item.dominio;
    div.querySelector('.dom-motivo').textContent = item.motivo || '';
    div.querySelector('button').addEventListener('click', async () => {
      dominiosSeus.splice(i, 1);
      await api.domains.save(dominiosSeus);
      carregarDominios();
    });
    alvo.appendChild(div);
  }

  await carregarDominiosAprendidos();
}

async function carregarDominiosAprendidos() {
  const itens = (await api.memory.operacional()).filter((i) => i.tipo === 'credibilidade');
  $('domAprendidosTotal').textContent = itens.length.toLocaleString('pt-BR');
  const alvo = $('domAprendidosLista');
  alvo.innerHTML = itens.length ? '' : '<p class="dica">Nada aprendido ainda nesta pasta — aparece aqui depois que o agente cruzar a mesma fonte com outras algumas vezes.</p>';
  for (const item of itens) {
    const rotulo = item.confiavel
      ? item.saldo > 0
        ? { texto: 'confiável', classe: 'ok' }
        : { texto: 'apuração fraca', classe: 'alerta' }
      : { texto: 'em observação', classe: '' };
    const div = document.createElement('div');
    div.className = 'dom-item';
    div.innerHTML = `
      <span class="dom-nome"></span>
      <span class="exec-resultado ${rotulo.classe}">${rotulo.texto} (${item.acertos}✓ / ${item.erros}✗)</span>
      <span class="dom-motivo"></span>
      <button class="btn-secundario btn-mini" title="Tornar uma marcação sua, fixa">fixar</button>
      <button class="btn-linha" title="Esquecer">✕</button>`;
    div.querySelector('.dom-nome').textContent = item.chave;
    div.querySelector('.dom-motivo').textContent = item.motivo || '';
    div.querySelectorAll('button')[0].addEventListener('click', async () => {
      dominiosSeus = dominiosSeus.filter((d) => d.dominio !== item.chave);
      dominiosSeus.push({
        dominio: item.chave,
        risco: item.saldo > 0 ? 'confiavel' : 'medio',
        motivo: item.motivo || 'fixado a partir do aprendizado automático',
      });
      await api.domains.save(dominiosSeus);
      carregarDominios();
    });
    div.querySelectorAll('button')[1].addEventListener('click', async () => {
      await api.memory.esquecer(item.chave, 'credibilidade');
      carregarDominiosAprendidos();
    });
    alvo.appendChild(div);
  }
}

$('domConsulta').addEventListener('input', async (e) => {
  const valor = e.target.value.trim();
  const alvo = $('domResultado');
  if (valor.length < 4) {
    alvo.textContent = '';
    return;
  }
  const r = await api.domains.lookup(valor);
  if (!r.ok) {
    alvo.innerHTML = `<span class="ruim">${esc(r.erro)}</span>`;
    return;
  }
  alvo.innerHTML =
    `<b>peso ${r.peso}</b> — ${esc(r.tipo)}` +
    (r.bloqueado ? ' · <span class="ruim">bloqueio judicial no Brasil</span>' : '') +
    (r.alerta ? ` · <span class="ruim">${esc(r.alerta.motivo)}</span>` : '') +
    `<span class="verif-nota">peso maior é lido primeiro; negativo desce para o fim da fila</span>`;
});

$('btnAddDominio').addEventListener('click', async () => {
  const dominio = $('domNovo').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!dominio || !dominio.includes('.')) return;
  dominiosSeus = dominiosSeus.filter((d) => d.dominio !== dominio);
  dominiosSeus.push({ dominio, risco: $('domRisco').value, motivo: $('domMotivo').value.trim() });
  await api.domains.save(dominiosSeus);
  $('domNovo').value = '';
  $('domMotivo').value = '';
  carregarDominios();
});

/* ------------------------- rotina automática (agendamentos) ------------------------- */

const ROTULO_AGENDAMENTO = (a) =>
  a.tipo === 'horario' ? `todo dia às ${a.horario}` : `a cada ${a.minutos} min`;

async function carregarAgendamentos() {
  const lista = await api.agendamentos.list();
  $('agTotal').textContent = lista.length.toLocaleString('pt-BR');
  const alvo = $('agLista');
  alvo.innerHTML = lista.length ? '' : '<p class="dica">Nenhuma rotina automática configurada ainda.</p>';
  for (const item of lista) {
    const div = document.createElement('div');
    div.className = 'dom-item';
    div.innerHTML = `
      <label class="interruptor" title="${item.ativo ? 'Desativar' : 'Ativar'}">
        <input type="checkbox" ${item.ativo ? 'checked' : ''} />
        <i></i>
      </label>
      <span class="dom-nome"></span>
      <span class="exec-resultado">${esc(ROTULO_AGENDAMENTO(item))}</span>
      <button class="btn-linha" title="Remover">✕</button>`;
    div.querySelector('.dom-nome').textContent = item.texto;
    div.querySelector('.interruptor input').addEventListener('change', async (e) => {
      await api.agendamentos.toggle(item.id, e.target.checked);
      carregarAgendamentos();
    });
    div.querySelector('button').addEventListener('click', async () => {
      await api.agendamentos.remove(item.id);
      carregarAgendamentos();
    });
    alvo.appendChild(div);
  }
}

$('agNovoTipo').addEventListener('change', (e) => {
  const horario = e.target.value === 'horario';
  $('agCampoHorario').hidden = !horario;
  $('agCampoIntervalo').hidden = horario;
});

$('btnAddAgendamento').addEventListener('click', async () => {
  const texto = $('agNovoTexto').value.trim();
  if (!texto) return;
  const r = await api.agendamentos.add({
    texto,
    tipo: $('agNovoTipo').value,
    minutos: $('agNovoMinutos').value,
    horario: $('agNovoHorario').value.trim(),
  });
  if (!r.ok) return;
  $('agNovoTexto').value = '';
  carregarAgendamentos();
});

/* ------------------------- SearXNG embutido ------------------------- */

const FASES_SX_EMBUTIDO = {
  'baixando-python': 'baixando Python…',
  'baixando-searxng': 'baixando SearXNG…',
  'instalando-dependencias': 'instalando dependências…',
  configurando: 'configurando…',
  pronto: 'finalizando…',
};

async function carregarEstadoSearxngRuntime() {
  const estado = await api.searxngRuntime.estado();
  pintarEstadoSearxngRuntime(estado);
}

function pintarEstadoSearxngRuntime(estado) {
  const status = $('sxStatus');
  const btnInstalar = $('btnSxInstalar');
  const btnDesinstalar = $('btnSxDesinstalar');
  const toggle = $('cfgUsarSxEmbutido');

  if (estado.instalando) {
    // durante a instalação o texto já vem sendo atualizado fase a fase pelo
    // manipulador de 'runtime-searxng-progresso' — não sobrescreve aqui.
  } else if (estado.erro) {
    status.textContent = `erro: ${estado.erro}`;
  } else if (estado.rodando) {
    status.textContent = `rodando · porta ${estado.porta}`;
  } else if (estado.instalado) {
    status.textContent = 'instalado, parado';
  } else {
    status.textContent = 'não instalado';
  }

  btnInstalar.disabled = estado.instalando;
  btnInstalar.textContent = estado.instalado ? 'Reinstalar' : 'Instalar';
  btnDesinstalar.hidden = !estado.instalado || estado.instalando;
  toggle.disabled = !estado.instalado || estado.instalando;
}

$('btnSxInstalar').addEventListener('click', async () => {
  $('btnSxInstalar').disabled = true;
  $('btnSxDesinstalar').hidden = true;
  $('sxStatus').textContent = 'preparando…';
  const r = await api.searxngRuntime.instalar();
  if (!r.ok) $('sxStatus').textContent = `erro: ${r.error}`;
  await carregarEstadoSearxngRuntime();
});

$('btnSxDesinstalar').addEventListener('click', async () => {
  if (!confirm('Remover o SearXNG embutido? Isso apaga o Python e o SearXNG baixados — dá pra instalar de novo depois.')) return;
  config = await api.config.set({ usarSearxngEmbutido: false });
  await api.searxngRuntime.desinstalar();
  await carregarEstadoSearxngRuntime();
});

/* ============================ ollama, pasta e memória ============================ */

async function verificarOllama() {
  const saude = await api.ollama.health();
  el.status.className = `status ${saude.online ? 'online' : 'offline'}`;
  el.status.querySelector('span').textContent = saude.online ? `ollama ${saude.version}` : 'ollama offline';
  el.status.title = saude.online ? 'Servidor respondendo' : `Sem resposta em ${config.host}`;
  if (saude.online) {
    await carregarModelos();
    await carregarStatusCopiloto();
    await carregarBadgeModelos();
  }
  // Fase 2: o guia de primeira execução se atualiza sozinho quando o Ollama
  // liga ou desliga — sem rodar o diagnóstico a cada 20 s (ele procura o
  // binário do Ollama, o que no Windows abre um processo).
  if (saude.online !== primeiroUso.ultimoOnline) {
    primeiroUso.ultimoOnline = saude.online;
    await atualizarPrimeiroUso();
  }
  // Independente da saúde estar online ou não — é uma leitura de registro,
  // não depende do Ollama estar respondendo — e reaproveita o MESMO
  // polling de 20s de sempre pra faixa do topo não ficar desatualizada se
  // o usuário mexer no Ollama por fora do AuGPT.
  await atualizarFaixaMaxModelos();
}

/**
 * Indicador "2ª IA" na barra superior (#statusCopiloto) — caso real: Davi
 * configurou o modo "2 IAs" certinho, mas numa conversa simples o agente
 * nunca chamou `consultar_critico`, então não tinha como saber, só olhando
 * a conversa, se o modelo dedicado chegou a ser usado. Consultado junto com
 * a saúde do Ollama (início + polling de 20s) e também logo depois de um
 * `consultar_critico` responder (ver manipuladores.resultado abaixo) — pra
 * não esperar até 20s pra refletir o que acabou de acontecer.
 */
async function carregarStatusCopiloto() {
  const badge = $('statusCopiloto');
  if (!badge) return;
  const st = await api.ollama.copilotoStatus();
  if (!st.ativo) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.classList.remove('copiloto-cpu', 'copiloto-gpu');
  const rotulo = badge.querySelector('span');
  // Pedido de Davi 2026-09-14 ("apertar as rédeas"): com o Copiloto chamado
  // automaticamente em 4 pontos fixos do pipeline, além da consulta sob
  // demanda de sempre, o custo real por execução deixou de ser óbvio só
  // olhando a conversa — `st.consultas` soma os dois contadores da execução
  // mais recente (ver ollama:copilotoStatus em electron/main.js).
  const sufixoConsultas = Number.isFinite(st.consultas) && st.consultas > 0 ? ` · ${st.consultas} consulta${st.consultas > 1 ? 's' : ''}` : '';
  if (!st.carregado) {
    rotulo.textContent = `copiloto: ${st.modelo} (ocioso)${sufixoConsultas}`;
    badge.title = 'Modelo dedicado do Copiloto configurado, mas ainda não foi chamado nesta sessão do Ollama.';
  } else if (st.cpu) {
    badge.classList.add('copiloto-cpu');
    rotulo.textContent = `copiloto: ${st.modelo} · CPU${sufixoConsultas}`;
    badge.title = 'Rodando na CPU, como esperado — não disputa VRAM com o modelo principal.';
  } else {
    badge.classList.add('copiloto-gpu');
    rotulo.textContent = `copiloto: ${st.modelo} · GPU${st.parcial ? ' (parcial)' : ''}${sufixoConsultas}`;
    badge.title = 'Rodando na GPU, não na CPU como o esperado — pode disputar VRAM com o modelo principal.';
  }
  if (sufixoConsultas) {
    badge.title += ` Consultas ao crítico na execução mais recente: ${st.consultas} (sob demanda + checkpoints automáticos do pipeline).`;
  }
}

/**
 * Quadro "onde cada modelo está rodando" (pedido do Davi, 2026-10-10) —
 * botão #btnModelos na barra superior: verde quando todo modelo carregado
 * está onde deveria (principal/embedding na GPU, Tev1/copiloto na CPU),
 * âmbar quando algum está fora do lugar. Atualizado junto com a saúde do
 * Ollama (polling de 20 s) e ao abrir a janela.
 */
const SITUACAO_MODELO = { ok: 'onde deveria', atencao: 'fora do lugar', ocioso: 'não carregado', outro: 'fora da configuração' };

async function carregarBadgeModelos() {
  const botao = $('btnModelos');
  if (!botao) return null;
  let r;
  try {
    r = await api.ollama.modelosCarregados();
  } catch {
    return null;
  }
  const linhas = r?.linhas || [];
  const carregados = linhas.filter((l) => l.carregado);
  const atencao = linhas.filter((l) => l.situacao === 'atencao');
  botao.classList.remove('modelos-ok', 'modelos-atencao');
  if (atencao.length) botao.classList.add('modelos-atencao');
  else if (carregados.length) botao.classList.add('modelos-ok');
  botao.querySelector('span').textContent = carregados.length ? `modelos · ${carregados.length} carregado${carregados.length > 1 ? 's' : ''}` : 'modelos';
  botao.title = atencao.length
    ? `Atenção: ${atencao.map((l) => `${l.modelo} (${l.papel}) está na ${l.onde}`).join('; ')}. Clique para ver.`
    : 'Ver onde cada modelo está rodando (GPU ou CPU)';
  return r;
}

function pintarQuadroDeModelos(r) {
  const corpo = $('dlgModelosCorpo');
  const linhas = r?.linhas || [];
  if (!linhas.length) {
    corpo.innerHTML = `<p class="dica">${r?.ok === false ? `Não consegui consultar o Ollama: ${esc(r.erro || '')}` : 'Nenhum modelo configurado nem carregado.'}</p>`;
    return;
  }
  corpo.innerHTML = `
    ${r?.ok === false ? `<p class="dica">Não consegui consultar o Ollama (${esc(r.erro || '')}); mostrando só a configuração.</p>` : ''}
    <table class="tabela-modelos">
      <thead><tr><th>papel</th><th>modelo</th><th>onde está</th><th>esperado</th><th>situação</th></tr></thead>
      <tbody>
        ${linhas
          .map(
            (l) => `<tr>
              <td>${esc(l.papel)}</td>
              <td>${esc(l.modelo)}${l.tamanhoMB ? ` <span class="dica-linha">${(l.tamanhoMB / 1024).toFixed(1)} GB</span>` : ''}</td>
              <td>${l.carregado ? `${esc(l.onde)}${l.onde === 'GPU+CPU' ? ` (${l.gpuPct}% na GPU)` : ''}` : '—'}</td>
              <td>${esc(l.esperado || '—')}</td>
              <td class="situacao-${esc(l.situacao)}">${esc(SITUACAO_MODELO[l.situacao] || l.situacao)}${l.dica ? `<div class="dica-linha">${esc(l.dica)}</div>` : ''}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

$('btnModelos')?.addEventListener('click', async () => {
  $('dlgModelosCorpo').innerHTML = '<p class="dica">consultando o Ollama…</p>';
  $('dlgModelos').showModal();
  pintarQuadroDeModelos(await carregarBadgeModelos());
});
$('btnAtualizarModelos')?.addEventListener('click', async () => pintarQuadroDeModelos(await carregarBadgeModelos()));
$('btnFecharModelos')?.addEventListener('click', () => $('dlgModelos').close());

function rotuloDoModelo(nome, pensa) {
  return pensa ? `${nome} · pensa antes de responder (lento)` : nome;
}

async function carregarModelos() {
  const { ok, models } = await api.ollama.models();
  if (!ok) return;
  const anterior = config.model || el.modelo.value;
  // revisão v5: modelo que "pensa" (R1, QwQ) aparece marcado — funciona,
  // mas cada etapa fica bem mais lenta; os de decisão (tev1) nem vêm na lista
  el.modelo.innerHTML = models.length
    ? models.map((m) => `<option value="${esc(m.name)}"${m.pensa ? ' data-pensa="1"' : ''}>${esc(rotuloDoModelo(m.name, m.pensa))}</option>`).join('')
    : '<option value="">nenhum modelo baixado</option>';
  // sem modelo salvo, a preferência é a família medida (15/10: pegava o primeiro em ordem
  // alfabética — num PC com "hf.co/…Bonsai" instalado, ele virava o modelo principal)
  const PREFERIDOS = ['qwen3.5:9b', 'qwen3.5:27b', 'qwen3.5:4b', 'qwen3.5:2b', 'qwen2.5:7b', 'qwen3.5:0.8b'];
  const preferido = PREFERIDOS.map((n) => models.find((m) => m.name === n)).find(Boolean)?.name;
  const escolhido = models.find((m) => m.name === anterior)?.name || preferido || models[0]?.name || '';
  el.modelo.value = escolhido;
  // `escolhido` vazio com um modelo salvo = o salvo não existe mais, ou era um
  // de embedding (que agora não aparece como opção) — limpa pra aba Conversa
  // não tentar conversar com ele (Fase 2).
  if (escolhido !== config.model) config = await api.config.set({ model: escolhido });
  el.cModelo.textContent = config.model || 'nenhum modelo';
}

/* ------------------- Ollama: oferta de início automático ------------------- */
// "Detectei que o Ollama está desligado. Deseja que eu ative ele?" — faixa
// fina abaixo da barra superior (ver renderer/index.html #faixaOllama),
// disparada pelo manipulador 'ollama-oferecer-inicio' acima. Nunca liga
// nada sozinho sem o usuário clicar "Sim" aqui, a não ser que ele já tenha
// marcado "sempre iniciar automaticamente" numa vez anterior (nesse caso o
// PRÓPRIO main.js já pulou direto pro início, sem nem chegar a emitir este
// evento — ver ipcMain.handle('ollama:health', ...)).

function mostrarFaixaOllama() {
  const faixa = $('faixaOllama');
  if (!faixa || !faixa.hidden) return; // já visível — não reseta o texto de um erro anterior
  faixa.querySelector('.faixa-ollama-texto').textContent = 'Detectei que o Ollama está desligado. Deseja que eu ative ele?';
  faixa.hidden = false;
}

$('btnOfOllamaSim').addEventListener('click', async () => {
  const btn = $('btnOfOllamaSim');
  const lembrar = $('ofOllamaLembrar').checked;
  btn.disabled = true;
  btn.textContent = 'Ativando…';
  const r = await api.ollama.iniciar(lembrar);
  btn.disabled = false;
  btn.textContent = 'Sim, ativar';
  if (r.ok) {
    $('faixaOllama').hidden = true;
    await verificarOllama();
  } else {
    $('faixaOllama').querySelector('.faixa-ollama-texto').textContent =
      `Não consegui ativar o Ollama: ${r.error || 'motivo desconhecido'}`;
  }
});

$('btnOfOllamaNao').addEventListener('click', () => {
  $('faixaOllama').hidden = true;
});

/* ------------------- Fase 2: guia de primeira execução ------------------- */
// Pedido do Davi (2026-09-23, preparar a publicação no GitHub: "rever
// facilidade de uso e configurações para usuários"). Quem abria o AuGPT sem o
// Ollama pronto travava: nenhum aviso quando faltava instalar, o de
// "desligado" só depois de ~20 s, e todo erro mandava rodar "ollama pull"
// num terminal. Este painel fica na tela inicial do Agente enquanto faltar
// algo, mostra os 3 passos, marca o que já está feito e dá UM botão pro passo
// atual — inclusive o download do modelo certo pra memória do computador.
// A decisão (qual passo, qual modelo) é pura e testada: src/primeiro-uso.js.

const primeiroUso = { diagnostico: null, baixando: false, baixandoNome: '', ultimoOnline: null };
const emGB = (n) => `${String(Math.round(n * 10) / 10).replace('.', ',')} GB`;

async function atualizarPrimeiroUso() {
  if (primeiroUso.baixando) return;
  let d;
  try {
    d = await api.ollama.diagnostico();
  } catch {
    return;
  }
  primeiroUso.diagnostico = d;
  pintarPrimeiroUso(d);
}

function pintarPrimeiroUso(d) {
  const painel = $('primeiroUso');
  if (!painel) return;
  const pronto = d.etapa === 'pronto';
  painel.hidden = pronto;
  const exemplos = el.aAbertura.querySelector('.exemplos');
  if (exemplos) exemplos.hidden = !pronto;
  if (pronto) return;

  const passos = ['puInstalar', 'puLigar', 'puModelo'];
  const atual = ['sem-ollama', 'ollama-desligado', 'sem-modelo'].indexOf(d.etapa);
  passos.forEach((id, i) => {
    const li = $(id);
    li.classList.toggle('feito', i < atual);
    li.classList.toggle('atual', i === atual);
    li.querySelector('.pu-acoes').innerHTML = '';
  });

  const acoes = $(passos[atual]).querySelector('.pu-acoes');
  if (d.etapa === 'sem-ollama') {
    acoes.innerHTML = `
      <button class="btn-primario" data-pu="baixar-ollama">Baixar o Ollama</button>
      <button class="btn-secundario" data-pu="verificar">Já instalei, verificar de novo</button>
      <p class="pu-dica">Abre ollama.com/download no seu navegador. Instale, abra o Ollama e volte aqui.</p>`;
  } else if (d.etapa === 'ollama-desligado') {
    acoes.innerHTML = `
      <button class="btn-primario" data-pu="ligar">Ligar o Ollama</button>
      <button class="btn-secundario" data-pu="verificar">Verificar de novo</button>
      <p class="pu-dica">O Ollama está instalado, mas não está rodando. Você também pode abri-lo pelo menu Iniciar.</p>`;
  } else {
    const r = d.recomendado;
    const memoria = d.ramTotalGB ? ` (${emGB(Math.round(d.ramTotalGB))} de memória)` : '';
    acoes.innerHTML = `
      <p class="pu-recomendado">Recomendado pra este computador${memoria}: <b>${esc(r.rotulo)}</b>, cerca de ${emGB(r.downloadGB)} de download — ${esc(r.motivo)}.</p>
      ${
        d.temEmbedding
          ? ''
          : `<label class="pu-opcao"><input type="checkbox" id="puComEmbedding" class="caixa" checked />
             também baixar o modelo de memória (${esc(d.embedding.nome)}, ${emGB(d.embedding.downloadGB)}) — opcional, deixa a memória entre conversas mais precisa</label>`
      }
      <div class="pu-botoes">
        <button class="btn-primario" data-pu="baixar-modelo">Baixar e usar este modelo</button>
        <button class="btn-secundario" data-pu="outro-modelo">Prefiro escolher outro</button>
      </div>
      <div class="pu-progresso" hidden>
        <div class="bm-progresso"><i class="pu-barra" style="width:0%"></i></div>
        <span class="pu-status"></span>
      </div>`;
  }
  acoes.querySelectorAll('[data-pu]').forEach((b) => b.addEventListener('click', () => acaoPrimeiroUso(b.dataset.pu, b)));
}

function pintarProgressoPrimeiroUso({ status, total, completed }) {
  const painel = $('primeiroUso');
  const barra = painel?.querySelector('.pu-barra');
  const texto = painel?.querySelector('.pu-status');
  if (!barra || !texto) return;
  const pct = total && completed != null ? Math.min(100, Math.round((completed / total) * 100)) : null;
  if (pct != null) barra.style.width = `${pct}%`;
  texto.textContent = `${primeiroUso.baixandoNome}: ${pct != null ? `${pct}%` : status || 'preparando…'}`;
}

async function acaoPrimeiroUso(acao, botao) {
  if (acao === 'baixar-ollama') {
    window.open('https://ollama.com/download'); // abre no navegador padrão (setWindowOpenHandler, main.js)
    return;
  }
  if (acao === 'outro-modelo') {
    trocarAba('config');
    abrirAjuste('ajModelos');
    $('bmNome')?.focus();
    return;
  }
  if (acao === 'verificar' || acao === 'ligar') {
    botao.disabled = true;
    botao.textContent = acao === 'ligar' ? 'Ligando…' : 'Verificando…';
    if (acao === 'ligar') {
      const r = await api.ollama.iniciar(false);
      if (!r.ok) {
        botao.disabled = false;
        botao.textContent = 'Tentar de novo';
        const dica = botao.parentElement.querySelector('.pu-dica');
        if (dica) dica.textContent = `Não consegui ligar: ${r.error || 'motivo desconhecido'}. Abra o Ollama pelo menu Iniciar e clique em "Verificar de novo".`;
        return;
      }
    }
    await verificarOllama();
    await atualizarPrimeiroUso();
    return;
  }
  if (acao === 'baixar-modelo') {
    const d = primeiroUso.diagnostico;
    const caixa = botao.closest('.pu-acoes');
    const fila = [d.recomendado.nome, ...(caixa.querySelector('#puComEmbedding')?.checked ? [d.embedding.nome] : [])];
    caixa.querySelectorAll('button, input').forEach((b) => {
      b.disabled = true;
    });
    caixa.querySelector('.pu-progresso').hidden = false;
    primeiroUso.baixando = true;
    let erro = null;
    for (const nome of fila) {
      primeiroUso.baixandoNome = nome;
      pintarProgressoPrimeiroUso({ status: 'iniciando…' });
      caixa.querySelector('.pu-barra').style.width = '0%';
      const r = await api.ollama.pull(nome);
      if (!r.ok) {
        erro = r.error;
        break;
      }
    }
    primeiroUso.baixando = false;
    if (erro) {
      caixa.querySelector('.pu-status').textContent = `Não consegui baixar ${primeiroUso.baixandoNome}: ${erro}. Confira a internet e tente de novo.`;
      caixa.querySelectorAll('button, input').forEach((b) => {
        b.disabled = false;
      });
      return;
    }
    config = await api.config.set({ model: d.recomendado.nome });
    await verificarOllama();
    await atualizarPrimeiroUso();
    el.aEntrada.focus();
  }
}

/* ------------------- Ollama: recomendação de hardware + baixar modelo ------------------- */
// Copiloto nível 2 (ver src/agent/hardware.js): mesma detecção usada tanto
// pra recomendar o modo do Copiloto quanto pra anotar qual modelo sugerido
// cabe no computador do usuário — nunca bloqueia a escolha, só avisa.

let recomendacaoHardware = null;

async function carregarRecomendacaoHardware() {
  try {
    recomendacaoHardware = await api.hardware.recomendacao();
  } catch {
    recomendacaoHardware = null;
  }
  pintarRecomendacaoCopiloto();
}

function pintarRecomendacaoCopiloto() {
  const alvo = $('cfgCopilotoRecomendacao');
  if (!alvo) return;
  if (!recomendacaoHardware) {
    alvo.textContent = '';
    return;
  }
  const { modo, motivo } = recomendacaoHardware.recomendacao;
  const rotuloModo = modo === 'doisModelos' ? '"2 IAs"' : '"Modelo atual"';
  alvo.textContent = `Recomendado neste computador: ${rotuloModo} — ${motivo}`;
}

/* ------------------- Ollama: oferta de ajustar OLLAMA_MAX_LOADED_MODELS ------------------- */
// Investigação com o Davi (2026-09-18): "2 IAs" só faz sentido de verdade se
// o Ollama mantiver o modelo principal e o crítico dedicado carregados ao
// mesmo tempo — por padrão (Windows), ele mantém só 1, e o segundo pedido
// derruba o primeiro. Confere sempre que a tela de configurações abre ou que
// o modo do Copiloto muda — nunca ajusta nada sozinho, só oferece (mesmo
// princípio da faixa "Detectei que o Ollama está desligado").

/**
 * Estado compartilhado por trás de DOIS lugares que mostram o mesmo aviso:
 * o bloco na tela de Ajustes (só visível se o usuário abrir Ajustes) e a
 * faixa no topo (`#faixaMaxModelos`, visível em qualquer aba — pedido do
 * Davi 2026-09-18: "o aviso... poderia avisar direto na tela inicial do
 * chat", já que o normal é configurar uma vez e nunca mais abrir Ajustes).
 * Um único ponto de verdade evita as duas telas divergirem. `modo` vem de
 * fontes diferentes em cada chamador (ver os dois `atualizar*` abaixo).
 */
async function estadoMaxModelosCarregados(modo) {
  if (modo !== 'doisModelos') return { mostrar: false };
  let r;
  try {
    r = await api.ollama.maxModelosCarregados();
  } catch {
    return { mostrar: false };
  }
  if (!r.suportado) return { mostrar: false };
  // Caso real (Davi, 2026-09-18): o registro já batia, mas o Ollama que
  // estava rodando nunca tinha sido reiniciado pra valer o novo limite — e o
  // aviso sumia sozinho assim que `r.valor >= r.minimo`, dando a entender
  // (errado) que já estava tudo certo. Enquanto o próprio usuário não
  // confirmar o reinício (ollamaMaxModelosReinicioPendente, src/config.js),
  // este lembrete continua aparecendo, mesmo que o registro já bata.
  if (config.ollamaMaxModelosReinicioPendente) return { mostrar: true, fase: 'confirmarReinicio' };
  if (r.valor != null && r.valor >= r.minimo) return { mostrar: false };
  return { mostrar: true, fase: 'ajustar' };
}

const TEXTO_MAX_MODELOS_AJUSTAR =
  'Detectei que o Ollama deste computador mantém poucos modelos carregados por vez — com "2 IAs", ' +
  'o modelo principal, o crítico e o modelo de memória/busca ficam se descarregando um ao outro a ' +
  'cada troca. Quer que eu ajuste esse limite?';
// Caso real (Davi, 2026-09-18): fechar o Ollama manualmente pela bandeja
// pode deixar um processo órfão rodando com a variável de ambiente antiga
// (ver ollamaRuntime.listarProcessosOllama) — daí o botão extra oferecendo
// fazer o reinício de verdade em vez de só perguntar se já foi feito.
const TEXTO_MAX_MODELOS_CONFIRMAR =
  'Ajustei o limite, mas isso só vale de verdade depois que o Ollama for fechado (ícone da bandeja) ' +
  'e aberto de novo. Já fez isso? Se preferir, eu mesmo posso tentar fechar e abrir ele pra você.';

/** Pinta um dos dois blocos (Ajustes OU a faixa no topo) a partir do MESMO estado — mantém os dois em sincronia. */
function pintarBlocoMaxModelos(estado, { bloco, texto, btnAjustar, btnReiniciar, btnConfirmar }) {
  if (!estado.mostrar) {
    bloco.hidden = true;
    return;
  }
  if (estado.fase === 'confirmarReinicio') {
    texto.textContent = TEXTO_MAX_MODELOS_CONFIRMAR;
    btnAjustar.hidden = true;
    btnReiniciar.hidden = false;
    btnReiniciar.disabled = false;
    btnReiniciar.textContent = 'Reiniciar o Ollama pra mim';
    btnConfirmar.hidden = false;
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = 'Já reiniciei o Ollama';
  } else {
    texto.textContent = TEXTO_MAX_MODELOS_AJUSTAR;
    btnReiniciar.hidden = true;
    btnConfirmar.hidden = true;
    btnAjustar.hidden = false;
    btnAjustar.disabled = false;
    btnAjustar.textContent = 'Ajustar agora';
  }
  bloco.hidden = false;
}

async function atualizarAvisoMaxModelosCarregados() {
  const bloco = $('cfgMaxModelosAviso');
  if (!bloco) return;
  // Lê da SELECT ao vivo (não de config.copiloto2Modo) de propósito: dentro
  // da tela de Ajustes o aviso precisa reagir na hora o usuário troca o modo
  // no combo, mesmo antes de clicar "Salvar" (ver o listener 'change' logo
  // abaixo) — comportamento que já existia, preservado aqui.
  const estado = await estadoMaxModelosCarregados($('cfgCopiloto2Modo').value);
  pintarBlocoMaxModelos(estado, {
    bloco,
    texto: $('cfgMaxModelosTexto'),
    btnAjustar: $('btnAjustarMaxModelos'),
    btnReiniciar: $('btnReiniciarOllamaPraMim'),
    btnConfirmar: $('btnConfirmarReinicioMaxModelos'),
  });
}

/** Mesmo aviso que atualizarAvisoMaxModelosCarregados, mas na faixa do topo — visível fora da tela de Ajustes. */
async function atualizarFaixaMaxModelos() {
  const faixa = $('faixaMaxModelos');
  if (!faixa) return;
  const estado = await estadoMaxModelosCarregados(config.copiloto2Modo);
  pintarBlocoMaxModelos(estado, {
    bloco: faixa,
    texto: $('faixaMaxModelosTexto'),
    btnAjustar: $('btnFaixaAjustarMaxModelos'),
    btnReiniciar: $('btnFaixaReiniciarOllamaPraMim'),
    btnConfirmar: $('btnFaixaConfirmarReinicioMaxModelos'),
  });
}

/** Atualiza os dois blocos de uma vez — usado depois de qualquer ação que possa ter mudado o estado. */
async function atualizarAvisosMaxModelos() {
  await Promise.all([atualizarAvisoMaxModelosCarregados(), atualizarFaixaMaxModelos()]);
}

async function clicarAjustarMaxModelos(btn) {
  btn.disabled = true;
  btn.textContent = 'Ajustando…';
  // Padrão de segurança se a consulta abaixo falhar — mantido em sincronia
  // com ollamaRuntime.MIN_MODELOS_CARREGADOS_DOIS_MODELOS (src/ollama-runtime.js).
  let minimo = 3;
  try {
    minimo = (await api.ollama.maxModelosCarregados()).minimo ?? 3;
  } catch {
    /* usa o padrão acima */
  }
  const r = await api.ollama.definirMaxModelosCarregados(minimo);
  if (r.ok) {
    // O handler em electron/main.js já marcou ollamaMaxModelosReinicioPendente
    // na config salva em disco — espelha aqui pra atualizarAvisosMaxModelos
    // trocar pro aviso de "confirme o reinício" sem precisar recarregar a
    // config inteira do processo principal.
    config.ollamaMaxModelosReinicioPendente = true;
    await atualizarAvisosMaxModelos();
  } else {
    btn.disabled = false;
    btn.textContent = 'Ajustar agora';
    const alvoTexto = btn === $('btnFaixaAjustarMaxModelos') ? $('faixaMaxModelosTexto') : $('cfgMaxModelosTexto');
    alvoTexto.textContent = `Não consegui ajustar: ${r.error || 'motivo desconhecido'}`;
  }
}
$('btnAjustarMaxModelos')?.addEventListener('click', () => clicarAjustarMaxModelos($('btnAjustarMaxModelos')));
$('btnFaixaAjustarMaxModelos')?.addEventListener('click', () => clicarAjustarMaxModelos($('btnFaixaAjustarMaxModelos')));

async function clicarConfirmarReinicioMaxModelos(btn) {
  btn.disabled = true;
  btn.textContent = 'Confirmando…';
  await api.ollama.confirmarReinicioMaxModelos();
  config.ollamaMaxModelosReinicioPendente = false;
  await atualizarAvisosMaxModelos();
}
$('btnConfirmarReinicioMaxModelos')?.addEventListener('click', () => clicarConfirmarReinicioMaxModelos($('btnConfirmarReinicioMaxModelos')));
$('btnFaixaConfirmarReinicioMaxModelos')?.addEventListener('click', () => clicarConfirmarReinicioMaxModelos($('btnFaixaConfirmarReinicioMaxModelos')));

/**
 * Botão "Reiniciar o Ollama pra mim" — pedido do Davi (2026-09-18), depois
 * de descobrir no Gerenciador de Tarefas que fechar o Ollama manualmente
 * pela bandeja pode deixar um `ollama.exe` órfão rodando com a variável de
 * ambiente antiga (ver ollamaRuntime.reiniciarOllama). Sucesso aqui já É a
 * prova de que o reinício aconteceu de verdade — confirma sozinho
 * (equivalente a clicar "Já reiniciei o Ollama" logo depois) em vez de
 * exigir mais um clique manual do usuário.
 */
async function clicarReiniciarOllama(btn) {
  btn.disabled = true;
  btn.textContent = 'Reiniciando…';
  const r = await api.ollama.reiniciar();
  if (r.ok) {
    config.ollamaMaxModelosReinicioPendente = false;
    await api.ollama.confirmarReinicioMaxModelos();
    await atualizarAvisosMaxModelos();
    await verificarOllama(); // status "ollama online" na barra + modelos podem ter mudado
  } else {
    btn.disabled = false;
    btn.textContent = 'Reiniciar o Ollama pra mim';
    const alvoTexto = btn === $('btnFaixaReiniciarOllamaPraMim') ? $('faixaMaxModelosTexto') : $('cfgMaxModelosTexto');
    alvoTexto.textContent = `Não consegui reiniciar sozinho: ${r.error || 'motivo desconhecido'}. Tente fechar e abrir manualmente.`;
  }
}
$('btnReiniciarOllamaPraMim')?.addEventListener('click', () => clicarReiniciarOllama($('btnReiniciarOllamaPraMim')));
$('btnFaixaReiniciarOllamaPraMim')?.addEventListener('click', () => clicarReiniciarOllama($('btnFaixaReiniciarOllamaPraMim')));

/* ------------------- Ajustes → Modelos e Componentes (Fase 1, 16/10) ------------------- */
// Leem o mesmo verificador da tela de boas-vindas (hardware, modelos do
// Ollama, busca embutida) e as versões do Ollama (instalada × GitHub).
let verificacao = null;
let componentes = null;

async function carregarModelosEComponentes() {
  const [v, c] = await Promise.all([api.boasVindas.verificar().catch(() => null), api.componentes.estado().catch(() => null)]);
  verificacao = v;
  componentes = c;
  pintarSugestoesModelos();
  pintarModelosInstalados();
  pintarComponentes();
}

function pintarSugestoesModelos() {
  const alvo = $('bmSugestoes');
  const r = verificacao?.recomendacao;
  if (!r) {
    alvo.innerHTML = '';
    return;
  }
  const instalados = new Set(verificacao.modelos || []);
  const lista = [{ ...r.principal, recomendado: true }, ...r.alternativas, { ...r.embedding, cabe: true }];
  alvo.innerHTML = lista
    .map((m) => {
      const nota = instalados.has(m.nome) || instalados.has(`${m.nome}:latest`)
        ? 'instalado ✓'
        : `${m.recomendado ? 'recomendado' : m.cabe ? 'cabe' : 'pesado para este PC'} · ${String(m.downloadGB).replace('.', ',')} GB`;
      return `<button type="button" class="bm-sugestao${m.recomendado ? ' recomendado' : ''}" data-nome="${esc(m.nome)}" title="${esc(m.motivo || '')}">${esc(m.rotulo)}<small>${nota}</small></button>`;
    })
    .join('');
  alvo.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => ($('bmNome').value = b.dataset.nome)));
  $('bmTitulo').textContent = `Recomendado para este computador: ${r.principal.rotulo} — ${r.principal.motivo}`;
}

function pintarModelosInstalados() {
  const nomes = verificacao?.modelos || [];
  $('modelosTotal').textContent = nomes.length;
  const embed = config.embedModel || 'nomic-embed-text';
  $('modelosInstalados').innerHTML = nomes.length
    ? nomes
        .map((n) => {
          const papel = n === config.model ? 'principal' : n === embed || n === `${embed}:latest` ? 'embedding' : '';
          return `<div class="dom-item"><span class="dom-nome"><b>${esc(n)}</b>${papel ? ` <small>· ${papel}</small>` : ''}</span><button class="btn-linha" data-atualizar="${esc(n)}">Atualizar</button></div>`;
        })
        .join('')
    : `<p class="dica">${verificacao?.ollama?.online === false ? 'O Ollama está desligado — ligue-o para ver os modelos.' : 'Nenhum modelo instalado.'}</p>`;
}

function pintarComponentes() {
  const o = componentes?.ollama || {};
  const online = verificacao?.ollama?.online;
  $('compOllamaInstalada').textContent = o.instalada || (verificacao?.ollama?.instalado ? 'instalado, desligado' : 'não instalado');
  $('compOllamaDisponivel').textContent = o.disponivel ? (o.atualizar ? `${o.disponivel} — atualização disponível` : `${o.disponivel} · em dia ✓`) : 'não consegui consultar';
  $('btnCompAtualizarOllama').hidden = !o.atualizar;
  const y = componentes?.ytdlp || {};
  $('compYtInstalada').textContent = y.instalada || 'não instalado';
  $('compYtDisponivel').textContent = y.disponivel ? (y.atualizar ? `${y.disponivel} — atualização disponível` : `${y.disponivel}${y.instalada ? ' · em dia ✓' : ''}`) : 'não consegui consultar';
  $('btnCompYtInstalar').hidden = y.instalado && !y.atualizar;
  $('btnCompYtInstalar').textContent = y.instalado ? 'Atualizar o yt-dlp' : 'Instalar o yt-dlp (18 MB)';
  $('btnCompYtVoltar').hidden = !y.temAnterior;
  $('sitYoutube').textContent = y.instalado ? (y.atualizar ? `atualização ${y.disponivel} disponível` : 'instalado') : 'não instalado';
  const t = componentes?.tesseract || {};
  $('compOcrInstalada').textContent = t.instalada ? `${t.instalada}${t.faltamIdiomas ? ' — faltam os idiomas' : ''}` : 'não instalado';
  $('compOcrDisponivel').textContent = t.disponivel ? (t.atualizar ? `${t.disponivel} — atualização disponível` : `${t.disponivel}${t.instalada ? ' · em dia ✓' : ''}`) : 'não consegui consultar';
  $('btnCompOcrInstalar').hidden = t.instalado && !t.atualizar;
  $('btnCompOcrInstalar').textContent = t.manual ? 'Como instalar' : t.faltamIdiomas ? 'Baixar os idiomas' : t.instalado ? 'Atualizar o Tesseract' : 'Instalar o Tesseract (cerca de 50 MB)';
  $('sitOcr').textContent = t.instalado ? (t.atualizar ? `atualização ${t.disponivel} disponível` : 'instalado') : 'não instalado';
  const g = componentes?.imagem || {};
  $('compImgRec').textContent = g.pode ? `comporta — ${g.motivo}` : g.motivo ? `não comporta — ${g.motivo}` : '—';
  $('compImgInstalada').textContent = g.instalado ? `${g.instalada || 'sim'} (${g.motor === 'cuda' ? 'CUDA' : 'Vulkan'})` : g.faltamModelos ? 'programa instalado, faltam os modelos' : 'não instalado';
  $('compImgDisponivel').textContent = g.disponivel ? (g.atualizar ? `${g.disponivel} — atualização disponível` : `${g.disponivel}${g.instalado ? ' · em dia ✓' : ''}`) : '—';
  $('btnCompImgInstalar').hidden = !g.pode || (g.instalado && !g.atualizar);
  $('btnCompImgInstalar').textContent = g.instalado ? 'Atualizar o programa' : `Instalar (cerca de ${String(g.downloadGB?.toFixed?.(1) || '6').replace('.', ',')} GB, em ${g.pasta || 'pasta dos modelos'})`;
  $('btnCompImgVoltar').hidden = !g.temAnterior;
  $('sitImagem').textContent = g.instalado ? (g.atualizar ? 'atualização disponível' : 'instalado') : g.pode ? 'não instalado' : 'a placa não comporta';
  const atualizacoes = [o.atualizar, y.atualizar, t.atualizar, g.atualizar].filter(Boolean).length;
  $('compAviso').textContent = atualizacoes ? `${atualizacoes} atualizaç${atualizacoes === 1 ? 'ão' : 'ões'}` : '';
  $('sitOllama').textContent = online ? `ligado · ${o.instalada || ''}` : verificacao?.ollama?.instalado ? 'desligado' : 'não instalado';
  const busca = componentes?.busca || verificacao?.busca;
  $('sitBusca').textContent = !busca?.instalado ? 'não instalada (usa as reservas)' : busca.rodando ? 'ligada' : 'instalada, parada';
  $('sitComponentes').textContent = atualizacoes ? `${atualizacoes} atualizaç${atualizacoes === 1 ? 'ão disponível' : 'ões disponíveis'}` : o.disponivel ? 'em dia ✓' : '—';
  const instalados = verificacao?.modelos || [];
  const tem = (n) => n && instalados.some((i) => i === n || i === `${n}:latest`);
  $('compModelos').innerHTML = [
    ['Responder e pesquisar', config.model],
    ['Escolher os trechos das páginas', config.embedModel || 'nomic-embed-text'],
  ]
    .map(
      ([papel, nome]) =>
        `<div class="dom-item"><span class="dom-nome">${papel}<small> · ${esc(nome || 'nenhum')} ${tem(nome) ? '· instalado ✓' : '· não instalado'}</small></span>${
          nome ? `<button class="btn-linha" data-atualizar="${esc(nome)}">${tem(nome) ? 'Atualizar' : 'Instalar'}</button>` : ''
        }</div>`
    )
    .join('');
}

// "Atualizar" um modelo = baixar de novo (o Ollama só transfere o que mudou)
$('viewConfig').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-atualizar]');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'baixando…';
  const r = await baixarModelo(btn.dataset.atualizar);
  btn.textContent = r.ok ? 'atualizado ✓' : 'erro';
  btn.title = r.ok ? '' : r.error || '';
  btn.disabled = false;
});

$('btnCompVerificar').addEventListener('click', async () => {
  $('compOllamaStatus').textContent = 'verificando…';
  await carregarModelosEComponentes();
  $('compOllamaStatus').textContent = '';
});

$('btnCompTestarPlaca').addEventListener('click', async () => {
  const btn = $('btnCompTestarPlaca');
  btn.disabled = true;
  $('compOllamaStatus').textContent = `testando ${config.model}… (carregar o modelo pode levar alguns segundos)`;
  const r = await api.componentes.testarPlaca();
  btn.disabled = false;
  $('compOllamaStatus').textContent = r.ok ? `${r.modelo}: ${r.veredito}` : `erro: ${r.error}`;
});

$('btnCompAtualizarOllama').addEventListener('click', async () => {
  if (!confirm(`Atualizar o Ollama para ${componentes?.ollama?.disponivel}? Ele fecha durante a atualização — não use o agente até terminar.`)) return;
  const btn = $('btnCompAtualizarOllama');
  btn.disabled = true;
  $('compOllamaStatus').textContent = 'atualizando…';
  const r = await api.componentes.atualizarOllama();
  btn.disabled = false;
  $('compOllamaStatus').textContent = r.texto || '';
  await carregarModelosEComponentes();
  verificarOllama();
});

$('btnCompYtInstalar').addEventListener('click', async () => {
  const btn = $('btnCompYtInstalar');
  btn.disabled = true;
  $('compYtStatus').textContent = 'começando…';
  const r = await api.componentes.instalarYtdlp();
  btn.disabled = false;
  $('compYtStatus').textContent = r.ok ? 'pronto ✓ — o agente já pode ver vídeos do YouTube' : `erro: ${r.error}`;
  await carregarModelosEComponentes();
});

$('btnCompOcrInstalar').addEventListener('click', async () => {
  const btn = $('btnCompOcrInstalar');
  btn.disabled = true;
  $('compOcrStatus').textContent = 'começando…';
  const r = await api.componentes.instalarTesseract();
  btn.disabled = false;
  $('compOcrStatus').textContent = r.ok ? 'pronto ✓ — o texto das imagens anexadas passa a ser lido' : `erro: ${r.error}`;
  await carregarModelosEComponentes();
});

$('btnCompImgInstalar').addEventListener('click', async () => {
  const btn = $('btnCompImgInstalar');
  if (!confirm(`${btn.textContent}? O download continua mesmo se você usar o agente, mas não feche o AuGPT até terminar.`)) return;
  btn.disabled = true;
  $('compImgStatus').textContent = 'começando…';
  const r = await api.componentes.instalarImagem();
  btn.disabled = false;
  $('compImgStatus').textContent = r.ok ? 'pronto ✓ — peça, por exemplo, "crie uma imagem de um farol numa tempestade"' : `erro: ${r.error}`;
  await carregarModelosEComponentes();
});

$('btnCompImgVoltar').addEventListener('click', async () => {
  if (!confirm('Voltar o gerador de imagens para a versão anterior do programa?')) return;
  const r = await api.componentes.voltarImagem();
  $('compImgStatus').textContent = r.ok ? `voltou para ${r.info?.versao || 'a anterior'}` : `erro: ${r.error}`;
  await carregarModelosEComponentes();
});

$('btnCompYtVoltar').addEventListener('click', async () => {
  if (!confirm('Voltar o yt-dlp para a versão anterior?')) return;
  const r = await api.componentes.voltarYtdlp();
  $('compYtStatus').textContent = r.ok ? `voltou para ${r.estado.instalada}` : `erro: ${r.error}`;
  await carregarModelosEComponentes();
});

async function baixarModelo(nome) {
  $('bmStatus').textContent = `${nome}: iniciando…`;
  $('bmProgresso').hidden = false;
  $('bmProgressoBarra').style.width = '0%';
  const r = await api.ollama.pull(nome);
  $('bmProgresso').hidden = true;
  $('bmStatus').textContent = r.ok ? `"${nome}" instalado.` : `erro: ${r.error}`;
  if (r.ok) {
    await carregarModelos();
    pintarModelosDeEtapa(); // atualiza também o seletor do modelo dedicado do Copiloto
    carregarModelosEComponentes();
  }
  return r;
}

function pintarProgressoBaixarModelo({ status, total, completed }) {
  const statusEl = $('bmStatus');
  if (statusEl) statusEl.textContent = status || '';
  if (total && completed != null) {
    const pct = Math.min(100, Math.round((completed / total) * 100));
    const barra = $('bmProgressoBarra');
    if (barra) barra.style.width = `${pct}%`;
  }
}

$('btnBmBaixar').addEventListener('click', async () => {
  const nome = $('bmNome').value.trim();
  if (!nome) return;
  $('btnBmBaixar').disabled = true;
  if ((await baixarModelo(nome)).ok) $('bmNome').value = '';
  $('btnBmBaixar').disabled = false;
});

async function carregarArvore(destacarNovos = false) {
  const itens = await api.workspace.tree();
  if (!itens.length) {
    el.arvore.innerHTML = '<li class="vazio">Nenhum arquivo ainda.</li>';
    arquivosConhecidos = new Set();
    return;
  }
  const atuais = new Set(itens.map((i) => i.path));
  el.arvore.innerHTML = itens
    .map((i) => {
      const novo = destacarNovos && !arquivosConhecidos.has(i.path) ? ' novo' : '';
      const classe = i.dir ? 'pasta' : 'arquivo';
      return `<li class="${classe}${novo}" style="padding-left:${6 + i.depth * 12}px" data-p="${esc(
        i.path
      )}" title="${esc(i.path)}">${i.dir ? '▸ ' : ''}${esc(i.name)}</li>`;
    })
    .join('');
  arquivosConhecidos = atuais;
}

async function carregarMemoria() {
  const { total } = await api.memory.stats();
  el.memTotal.textContent = total;
  carregarOperacional();
  carregarCentral();
}

async function carregarCentral() {
  const itens = await api.memory.central();
  $('centralTotal').textContent = itens.length;
  const alvo = $('listaCentral');
  alvo.innerHTML = '';
  if (!itens.length) {
    alvo.innerHTML = '<li class="vazio">Nada guardado ainda. O agente grava aqui o que você contar sobre si.</li>';
    return;
  }
  for (const i of itens) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="op-texto">
        <span class="op-chave"></span>
        <span class="op-licao"></span>
      </div>
      <button class="btn-linha" title="Esquecer">✕</button>`;
    li.querySelector('.op-chave').textContent = i.chave;
    li.querySelector('.op-licao').textContent = i.valor;
    li.querySelector('button').addEventListener('click', async () => {
      await api.memory.centralEsquecer(i.chave);
      carregarCentral();
    });
    alvo.appendChild(li);
  }
}

$('btnLimparCentral').addEventListener('click', async () => {
  if (!confirm('Esquecer tudo que o agente sabe sobre você?')) return;
  await api.memory.centralLimpar();
  carregarCentral();
});

async function carregarOperacional() {
  const itens = await api.memory.operacional();
  $('opTotal').textContent = itens.length;
  const alvo = $('listaOperacional');
  alvo.innerHTML = '';
  if (!itens.length) {
    alvo.innerHTML = '<li class="vazio">Nada aprendido ainda. As lições aparecem com o uso.</li>';
    return;
  }
  for (const i of itens) {
    const li = document.createElement('li');
    li.className = i.confiavel ? '' : 'incerto';
    li.innerHTML = `
      <div class="op-texto">
        <span class="op-chave"></span>
        <span class="op-licao"></span>
      </div>
      <span class="op-vezes" title="quantas vezes foi observado">${i.vezes}×</span>
      <button class="btn-linha" title="Esquecer">✕</button>`;
    li.querySelector('.op-chave').textContent = `${i.rotulo} · ${i.chave}`;
    li.querySelector('.op-licao').textContent = i.licao;
    li.querySelector('button').addEventListener('click', async () => {
      await api.memory.esquecer(i.chave, i.tipo);
      carregarOperacional();
    });
    alvo.appendChild(li);
  }
}

$('btnLimparOperacional').addEventListener('click', async () => {
  if (!confirm('Esquecer tudo que o agente aprendeu sobre como as coisas funcionam?')) return;
  await api.memory.esquecer(null, null);
  carregarOperacional();
});

el.modelo.addEventListener('change', async () => {
  config = await api.config.set({ model: el.modelo.value });
  el.cModelo.textContent = config.model;
});

el.autonomia.addEventListener('change', async () => {
  config = await api.config.set({ autonomy: el.autonomia.value });
  // O processo principal pede confirmação antes de aceitar 'auto' (Fase 1
  // de segurança) — se o usuário cancelar lá, o valor salvo continua o
  // anterior e o seletor precisa voltar pra ele.
  el.autonomia.value = config.autonomy;
});

// Profundidade da pesquisa (15/10): seletor da tela inicial e do painel da barra, os dois
// gravam o mesmo ajuste. O "Resposta direta" antigo vira "Rápido".
const modoAtual = () => (config.respostaDireta === true ? 'rapido' : config.modoDePesquisa || 'automatico');
function pintarModoDoAgente() {
  for (const b of $('modoDoAgente').querySelectorAll('button')) b.classList.toggle('ativo', b.dataset.modo === modoAtual());
  $('modoDePesquisa').value = modoAtual();
  $('modoNaCaixa').value = modoAtual();
  // investigação: o tempo aparece ao lado dos modos
  $('tempoInvestigacao').hidden = modoAtual() !== 'investigacao';
  $('minutosInvestigacao').value = config.minutosDeInvestigacao || 10;
}
async function escolherModo(modo) {
  config = await api.config.set({ modoDePesquisa: modo, respostaDireta: false });
  pintarModoDoAgente();
}
$('modoDoAgente').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) escolherModo(b.dataset.modo);
});
$('modoDePesquisa').addEventListener('change', (e) => escolherModo(e.target.value));
$('modoNaCaixa').addEventListener('change', (e) => escolherModo(e.target.value));
$('minutosInvestigacao').addEventListener('change', async (e) => {
  const minutos = Math.max(2, Math.min(180, Math.round(Number(e.target.value) || 10)));
  e.target.value = minutos;
  config = await api.config.set({ minutosDeInvestigacao: minutos });
});

$('modoResposta').addEventListener('change', async (e) => {
  config = await api.config.set({ modoResposta: e.target.value });
});

$('nivelRaciocinio').addEventListener('change', async (e) => {
  config = await api.config.set({ nivelRaciocinio: e.target.value });
  atualizarAvisoNivelExtremo();
});

/**
 * Aviso não-bloqueante quando "extremo" está selecionado e o hardware não é
 * confortável pra manter dois modelos ao mesmo tempo (a mesma recomendação
 * que já existe pro Copiloto nível 2 — api.hardware.recomendacao(), ver
 * hardware.recomendarModoCopiloto em src/agent/hardware.js). Mesmo padrão
 * das faixas de Ollama/max-modelos: nunca impede a escolha, só avisa.
 */
async function atualizarAvisoNivelExtremo() {
  const bloco = $('faixaNivelExtremo');
  const texto = $('faixaNivelExtremoTexto');
  if ($('nivelRaciocinio').value !== 'extremo') {
    bloco.hidden = true;
    return;
  }
  try {
    const { recomendacao } = await api.hardware.recomendacao();
    if (recomendacao.modo === 'doisModelos') {
      bloco.hidden = true;
      return;
    }
    texto.textContent = `Nível "extremo" funciona melhor com o Copiloto em "2 IAs". ${recomendacao.motivo}`;
    bloco.hidden = false;
  } catch {
    bloco.hidden = true;
  }
}

$('btnEscolherPasta').addEventListener('click', async () => {
  config = await api.workspace.choose();
  el.caminho.textContent = config.workspace;
  el.caminho.title = config.workspace;
  carregarArvore();
  carregarMemoria();
});

$('btnAbrirPasta').addEventListener('click', () => api.workspace.open());

$('btnLimparMemoria').addEventListener('click', async () => {
  if (!confirm('Esquecer tudo que foi aprendido nesta pasta de trabalho?')) return;
  await api.memory.clear();
  carregarMemoria();
});

el.arvore.addEventListener('click', async (e) => {
  const li = e.target.closest('li.arquivo');
  if (!li) return;
  const r = await api.workspace.read(li.dataset.p);
  if (!r.ok) return;
  $('dlgSkillNome').textContent = li.dataset.p;
  $('dlgSkillCorpo').textContent = r.conteudo.slice(0, 40000);
  $('dlgSkill').dataset.id = '';
  $('dlgSkill').showModal();
});

