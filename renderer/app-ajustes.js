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
  aplicarPainelDireito(config.painelDireitoAberto === true);
  // idioma (22/10): o gravado no config manda; a tela abriu com o do localStorage (i18n.js)
  if (window.i18n && (config.idioma || '') !== window.i18n.escolha) window.i18n.definir(config.idioma || '');
  pintarSaudacao();
  // "Ei GPT" (25/10): liga a escuta ao abrir, se estiver marcada
  if (config.ouvirChamada === true) window.escutaPorVoz?.ligar();
}

/** "O que você precisa, Davi?" na tela inicial quando há nome (22/10). */
function pintarSaudacao() {
  const titulo = document.querySelector('#deckAbertura .deck-head h1');
  if (!titulo) return;
  const nome = String(config?.nomeDoUsuario || '').trim();
  titulo.textContent = nome ? tr('O que você precisa, {nome}?', { nome }) : tr('O que você precisa?');
}
window.addEventListener('idioma', pintarSaudacao);

$('ajIdioma').addEventListener('change', async (e) => {
  config = await api.config.set({ idioma: e.target.value });
  window.i18n?.definir(e.target.value);
});
$('ajNome').addEventListener('change', async (e) => {
  config = await api.config.set({ nomeDoUsuario: e.target.value.trim() });
  pintarSaudacao();
});

function preencherConfig() {
  $('ajIdioma').value = config.idioma || '';
  $('ajNome').value = config.nomeDoUsuario || '';
  $('cfgHost').value = config.host;
  $('cfgEmbed').value = config.embedModel;
  $('cfgTopK').value = config.memoryTopK;
  $('cfgMax').value = config.maxIterations;
  $('cfgVerificarAmbiguidade').checked = config.verificarAmbiguidade !== false;
  $('cfgCriacaoAutomaticaDeSkills').checked = config.criacaoAutomaticaDeSkills !== false;
  $('cfgTemp').value = config.temperature;
  $('cfgCtx').value = config.numCtx;
  $('cfgCtxRedacao').value = config.numCtxRedacao || '';
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
    verificarAmbiguidade: $('cfgVerificarAmbiguidade').checked,
    criacaoAutomaticaDeSkills: $('cfgCriacaoAutomaticaDeSkills').checked,
    // Campo vazio mantém o valor atual — antes, temperatura em branco virava 0
    // e janela de contexto em branco virava 8192 (diferente do padrão, 16384).
    temperature: $('cfgTemp').value === '' ? config.temperature : Number($('cfgTemp').value),
    numCtx: Number($('cfgCtx').value) || config.numCtx,
    numCtxRedacao: Number($('cfgCtxRedacao').value) || null,
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
}


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
    await carregarBadgeModelos();
  }
  // Fase 2: o guia de primeira execução se atualiza sozinho quando o Ollama
  // liga ou desliga — sem rodar o diagnóstico a cada 20 s (ele procura o
  // binário do Ollama, o que no Windows abre um processo).
  if (saude.online !== primeiroUso.ultimoOnline) {
    primeiroUso.ultimoOnline = saude.online;
    await atualizarPrimeiroUso();
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
  const exemplos = el.aAbertura.querySelector('.deck-corpo');
  if (exemplos) exemplos.hidden = !pronto;
  if (pronto) return;

  const passos = ['puInstalar', 'puLigar', 'puModelo'];
  const atual = ['sem-ollama', d.etapa === 'remoto-desligado' ? 'remoto-desligado' : 'ollama-desligado', 'sem-modelo'].indexOf(d.etapa);
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
  } else if (d.etapa === 'remoto-desligado') {
    acoes.innerHTML = `
      <button class="btn-secundario" data-pu="verificar">Verificar de novo</button>
      <button class="btn-secundario" data-pu="usar-local">Usar o Ollama deste PC</button>
      <p class="pu-dica"></p>`;
    acoes.querySelector('.pu-dica').textContent = `O AuGPT está usando o Ollama de outro computador (${d.host}), e ele não respondeu. Confira se aquele PC está ligado, com o Ollama aberto e aceitando a rede (veja Ajustes → Avançado → Conexão).`;
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
  if (acao === 'usar-local') {
    config = await api.config.set({ host: 'http://127.0.0.1:11434' });
    $('cfgHost').value = config.host;
    await verificarOllama();
    await atualizarPrimeiroUso();
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

/* ------------------- Ajustes → Modelos e Componentes (Fase 1, 16/10) ------------------- */
// Leem o mesmo verificador da tela de boas-vindas (hardware, modelos do
// Ollama, busca embutida) e as versões do Ollama (instalada × GitHub).
let verificacao = null;
let componentes = null;

/* ---------- atualizar o AuGPT (21/10): faixa no topo + seção em Componentes; instala só no clique ---------- */
let atualizacao = null;

function pintarAtualizacao() {
  const a = atualizacao || {};
  $('compAuInstalada').textContent = a.atual || '—';
  $('compAuDisponivel').textContent = !a.ok ? (a.error ? `não consegui consultar (${a.error})` : '—') : !a.versao ? a.motivo || '—' : a.disponivel ? `${a.versao} — atualização disponível` : `${a.versao} · em dia ✓`;
  $('btnCompAuAtualizar').hidden = !a.disponivel;
  $('btnCompAuAtualizar').textContent = `Atualizar para a ${a.versao || ''}`;
  $('btnCompAuNovidades').hidden = !a.disponivel;
  $('cfgProcurarAtualizacoes').checked = config.procurarAtualizacoes !== false;
}

function mostrarFaixaAtualizacao(info) {
  atualizacao = { ok: true, ...info };
  $('faixaAtualizacaoTexto').textContent = tr('AuGPT {versao} disponível (você está na {atual}).', { versao: info.versao, atual: info.atual });
  $('faixaAtualizacao').hidden = false;
}

async function instalarAtualizacao(botao, status) {
  if (!confirm(`Baixar e instalar o AuGPT ${atualizacao?.versao || ''}? O AuGPT fecha, o instalador troca os arquivos e abre a versão nova. Suas conversas e ajustes continuam.`)) return;
  botao.disabled = true;
  status.textContent = 'começando…';
  const r = await api.atualizacao.instalar();
  botao.disabled = false;
  status.textContent = r.ok ? 'abrindo o instalador…' : `erro: ${r.error}`;
}

/* ---------- Novidades (23/10, pedido do Davi): o que mudou, numa janela do próprio AuGPT ---------- */
const ingles = () => window.i18n?.idioma === 'en';

function pintarNovidades(notas, { titulo, sub, vazio = 'Esta versão não trouxe notas.' }) {
  const data = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(window.i18n?.locale?.() || 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const negrito = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  $('dlgNovidadesTitulo').textContent = titulo;
  $('dlgNovidadesSub').textContent = sub;
  $('dlgNovidadesCorpo').innerHTML = notas.length
    ? notas.map((n) => {
      const t = (ingles() && n.en) || n.pt || {};
      return `<section class="novidades-versao"><h3><span class="versao">${esc(n.versao)}</span>${esc(t.titulo || '')}<span class="data">${esc(data(n.data))}</span></h3>
        <ul>${(t.itens || []).map((i) => `<li>${negrito(i)}</li>`).join('')}</ul></section>`;
    }).join('')
    : `<p class="novidades-vazio">${esc(tr(vazio))}</p>`;
  if (!$('dlgNovidades').open) $('dlgNovidades').showModal();
  $('dlgNovidadesCorpo').scrollTop = 0;
}

// sem versão: o que mudou na instalada (e antes); com a versão nova da faixa: as notas dela, antes de atualizar
async function abrirNovidades(versao) {
  const nova = versao && versao !== atualizacao?.atual;
  $('btnNovidadesAtualizar').hidden = !nova;
  $('btnNovidadesGithub').hidden = true;
  const r = await api.novidades.ler(nova ? versao : undefined);
  if (!r.ok) {
    // GitHub fora ou versão publicada sem o arquivo: o link da Release continua
    pintarNovidades([], { titulo: tr('Novidades do AuGPT {versao}', { versao }), sub: tr('Não consegui ler as novidades desta versão ({erro}).', { erro: r.error }), vazio: 'As notas desta versão estão na página dela no GitHub.' });
    $('btnNovidadesGithub').hidden = !atualizacao?.pagina;
    return;
  }
  pintarNovidades(r.notas, nova
    ? { titulo: tr('Novidades do AuGPT {versao}', { versao }), sub: tr('Você está na {atual}. Isto chega quando você atualizar.', { atual: r.atual }) }
    : { titulo: tr('Novidades do AuGPT'), sub: tr('Você está na versão {atual}.', { atual: r.atual }) });
}

// primeira abertura de uma versão nova: a janela abre sozinha
async function mostrarNovidadesPendentes() {
  const p = await api.novidades.pendentes().catch(() => null);
  if (!p?.notas?.length) return;
  pintarNovidades(p.notas, { titulo: tr('O AuGPT foi atualizado'), sub: tr('Bem-vindo à versão {atual}. Veja o que mudou:', { atual: p.atual }) });
}

$('btnFaixaNovidades').addEventListener('click', () => abrirNovidades(atualizacao?.versao));
$('btnCompAuNovidades').addEventListener('click', () => abrirNovidades(atualizacao?.versao));
$('btnCompAuHistorico').addEventListener('click', () => abrirNovidades());
$('btnFecharNovidades').addEventListener('click', () => $('dlgNovidades').close());
$('btnNovidadesGithub').addEventListener('click', () => window.open(atualizacao?.pagina, '_blank'));
$('btnNovidadesAtualizar').addEventListener('click', () => {
  $('dlgNovidades').close();
  instalarAtualizacao($('btnFaixaAtualizar'), $('faixaAtualizacao').hidden ? $('compAuStatus') : $('faixaAtualizacaoTexto'));
});
setTimeout(mostrarNovidadesPendentes, 1200);

$('btnCompAuAtualizar').addEventListener('click', () => instalarAtualizacao($('btnCompAuAtualizar'), $('compAuStatus')));
$('btnFaixaAtualizar').addEventListener('click', () => instalarAtualizacao($('btnFaixaAtualizar'), $('faixaAtualizacaoTexto')));
$('btnFaixaAtualizarDepois').addEventListener('click', () => ($('faixaAtualizacao').hidden = true));
$('btnFaixaPularVersao').addEventListener('click', async () => {
  $('faixaAtualizacao').hidden = true;
  config = await api.config.set({ atualizacaoIgnorada: atualizacao?.versao || '' });
});
$('cfgProcurarAtualizacoes').addEventListener('change', async (e) => {
  config = await api.config.set({ procurarAtualizacoes: e.target.checked });
});

/* ---------- ditado por voz (24/10): o componente e o "enviar sozinho" ---------- */
async function pintarDitado() {
  const d = await api.ditado.estado().catch(() => ({ instalado: false }));
  $('compDitadoInstalado').textContent = d.instalado ? `${d.modelo} · whisper.cpp ${d.versao}` : tr('não instalado ({tamanho} para baixar)', { tamanho: d.tamanho || '~600 MB' });
  $('btnCompDitadoInstalar').hidden = Boolean(d.instalado);
  $('cfgDitadoEnviar').checked = config.ditadoEnviarSozinho === true;
  $('cfgDitadoCorrigir').checked = config.ditadoCorrigir !== false;
  // durante o download do modelo da escuta, quem manda no botão é o clique (este estado é de antes)
  if (!$('ouvirChamadaStatus').dataset.ocupado) {
    $('cfgOuvirChamada').checked = config.ouvirChamada === true && Boolean(d.escuta);
    $('ouvirChamadaStatus').textContent = $('cfgOuvirChamada').checked ? tr('Ouvindo — diga "Ei GPT" e o seu pedido.') : '';
  }
  pintarEscuta(d);
  // a escolha do microfone só com o ditado instalado (antes disso o AuGPT não abre o microfone)
  $('linhaMicrofone').hidden = !d.instalado;
  if (d.instalado && window.ditadoPorVoz) {
    const { padrao, microfones } = await window.ditadoPorVoz.listarMicrofones();
    const sel = $('ajMicrofone');
    sel.textContent = '';
    sel.append(new Option(padrao ? tr('Automático (agora: {nome})', { nome: padrao }) : tr('Automático'), ''));
    for (const m of microfones) sel.append(new Option(m.virtual ? `${m.nome} (virtual)` : m.nome, m.id));
    sel.value = microfones.some((m) => m.id === config.ditadoMicrofone) ? config.ditadoMicrofone : '';
  }
}
$('ajMicrofone').addEventListener('change', async (e) => {
  config = await api.config.set({ ditadoMicrofone: e.target.value });
});
$('btnTestarMicrofone').addEventListener('click', async () => {
  const botao = $('btnTestarMicrofone');
  botao.disabled = true;
  $('microfoneTeste').hidden = false;
  $('microfoneResultado').textContent = tr('Fale alguma coisa…');
  try {
    const r = await window.ditadoPorVoz.testarMicrofone($('ajMicrofone').value, (nivel, nome) => {
      $('microfoneNivel').style.width = `${Math.round(nivel * 100)}%`;
      $('microfoneResultado').textContent = tr('Fale alguma coisa… ({nome})', { nome });
    });
    $('microfoneResultado').textContent = r.ouviu ? tr('Captando som ✓ — {nome}', { nome: r.nome }) : tr('Nenhum som em {nome}. Escolha outro microfone na lista e teste de novo.', { nome: r.nome });
  } catch (err) {
    $('microfoneResultado').textContent = tr('Não consegui abrir o microfone ({erro}).', { erro: err.name || err.message });
  } finally {
    $('microfoneNivel').style.width = '0';
    botao.disabled = false;
  }
});
$('btnCompDitadoInstalar').addEventListener('click', async () => {
  $('btnCompDitadoInstalar').disabled = true;
  $('compDitadoStatus').textContent = tr('começando…');
  const r = await api.ditado.instalar();
  $('btnCompDitadoInstalar').disabled = false;
  $('compDitadoStatus').textContent = r.ok ? tr('Instalado ✓ — use o microfone da caixa de mensagem.') : tr('erro: {erro}', { erro: r.error });
  pintarDitado();
});
$('cfgDitadoEnviar').addEventListener('change', async (e) => {
  config = await api.config.set({ ditadoEnviarSozinho: e.target.checked });
});
// "Ei GPT" (25/10): precisa do ditado instalado; na primeira vez baixa o modelo pequeno da escuta
$('cfgOuvirChamada').addEventListener('change', async (e) => {
  const caixa = e.target;
  const status = $('ouvirChamadaStatus');
  const ligar = caixa.checked;
  if (ligar) {
    const d = await api.ditado.estado().catch(() => ({}));
    if (!d.instalado) {
      caixa.checked = false;
      status.textContent = tr('Instale antes o ditado por voz em Ajustes → Componentes.');
      return;
    }
    if (!d.escuta) {
      caixa.disabled = true;
      status.dataset.ocupado = '1';
      const modelo = config.escutaModelo === 'base' ? 'base' : 'small';
      status.textContent = tr('baixando o modelo da escuta ({tamanho})…', { tamanho: d.tamanhosDaEscuta?.[modelo] || d.tamanhoDaEscuta || '190 MB' });
      const r = await api.ditado.instalarEscuta(modelo);
      caixa.disabled = false;
      delete status.dataset.ocupado;
      if (!r.ok) {
        caixa.checked = false;
        status.textContent = tr('erro: {erro}', { erro: r.error });
        return;
      }
    }
  }
  config = await api.config.set({ ouvirChamada: ligar });
  caixa.checked = ligar;
  if (ligar) {
    const ok = await window.escutaPorVoz?.ligar();
    status.textContent = ok ? tr('Ouvindo — diga "Ei GPT" e o seu pedido.') : tr('Não consegui abrir o microfone — confira o microfone do ditado aqui embaixo.');
  } else {
    window.escutaPorVoz?.desligar();
    status.textContent = '';
  }
});
$('cfgDitadoCorrigir').addEventListener('change', async (e) => {
  config = await api.config.set({ ditadoCorrigir: e.target.checked });
});

/* ---------- o modelo da escuta, o treino da voz e o que a escuta ouviu (25/10) ---------- */
const NOME_DO_MODELO = { small: 'Whisper small', base: 'Whisper base' };
function pintarEscuta(d) {
  const escolhido = config.escutaModelo === 'base' ? 'base' : 'small';
  $('cfgEscutaModelo').value = escolhido;
  const status = $('escutaModeloStatus');
  if (status.dataset.ocupado) return;
  status.textContent = '';
  // o escolhido ainda não foi baixado: a escuta usa o outro até você baixar
  if (d.instalado && !d.escutaModelos?.[escolhido]) {
    status.append(d.escutaEmUso ? tr('O {modelo} ainda não foi baixado — a escuta está usando o {outro}. ', { modelo: NOME_DO_MODELO[escolhido], outro: NOME_DO_MODELO[d.escutaEmUso] }) : tr('O {modelo} ainda não foi baixado. ', { modelo: NOME_DO_MODELO[escolhido] }));
    const baixar = document.createElement('button');
    baixar.type = 'button';
    baixar.className = 'btn-link';
    baixar.textContent = tr('Baixar ({tamanho})', { tamanho: d.tamanhosDaEscuta?.[escolhido] || '' });
    baixar.addEventListener('click', () => baixarModeloDaEscuta(escolhido));
    status.append(baixar);
  }
  const variantes = config.escutaVariantes || [];
  $('treinoResumo').textContent = variantes.length || config.escutaSensibilidade
    ? tr('Treinado: {n} jeito(s) da sua pronúncia{sens}.', { n: variantes.length, sens: config.escutaSensibilidade ? tr(' · sensibilidade ajustada ao seu microfone') : '' })
    : '';
  $('btnApagarTreino').hidden = !(variantes.length || config.escutaSensibilidade);
}

async function baixarModeloDaEscuta(modelo) {
  const status = $('escutaModeloStatus');
  status.dataset.ocupado = '1';
  status.textContent = tr('baixando o modelo da escuta ({tamanho})…', { tamanho: '' });
  $('cfgEscutaModelo').disabled = true;
  const r = await api.ditado.instalarEscuta(modelo);
  $('cfgEscutaModelo').disabled = false;
  delete status.dataset.ocupado;
  status.textContent = r.ok ? tr('{modelo} pronto ✓ — a escuta já usa ele.', { modelo: NOME_DO_MODELO[modelo] }) : tr('erro: {erro}', { erro: r.error });
  return r.ok;
}

$('cfgEscutaModelo').addEventListener('change', async (e) => {
  const modelo = e.target.value === 'base' ? 'base' : 'small';
  config = await api.config.set({ escutaModelo: modelo });
  const d = await api.ditado.estado().catch(() => ({}));
  // trocar para um modelo ainda não baixado, com o ditado instalado: baixa já
  if (d.instalado && !d.escutaModelos?.[modelo]) await baixarModeloDaEscuta(modelo);
  else pintarEscuta(d);
});

// o treino: "Ei GPT" 6 vezes, de jeitos diferentes; cada uma passa pelo modelo da escuta SEM o treino anterior
const JEITOS = ['do seu jeito normal', 'um pouco mais baixo', 'mais rápido', 'mais devagar', 'um pouco mais longe do microfone', 'como se estivesse do outro lado da mesa'];
let treinoParado = false;
$('btnTreinoParar').addEventListener('click', () => {
  treinoParado = true;
  $('btnTreinoParar').disabled = true;
});
$('btnTreinarVoz').addEventListener('click', async () => {
  const botao = $('btnTreinarVoz');
  const d = await api.ditado.estado().catch(() => ({}));
  if (!d.instalado) {
    $('treinoResumo').textContent = tr('Instale antes o ditado por voz em Ajustes → Componentes.');
    return;
  }
  const modelo = config.escutaModelo === 'base' ? 'base' : 'small';
  if (!d.escutaModelos?.[modelo] && !(await baixarModeloDaEscuta(modelo))) return;
  botao.disabled = true;
  treinoParado = false;
  $('btnTreinoParar').onclick = null; // o "Fechar" do treino anterior
  $('btnTreinoParar').disabled = false;
  $('btnTreinoParar').textContent = tr('Parar');
  // a escuta fica desligada durante o treino (senão ela mesma ouviria os "Ei GPT")
  const escutava = window.escutaPorVoz?.ligada();
  window.escutaPorVoz?.desligar();
  const lista = $('treinoLista');
  lista.textContent = '';
  $('treinoFim').hidden = true;
  $('treinoVoz').hidden = false;
  const textos = [];
  const niveis = [];
  let sozinho = 0;
  try {
    for (let i = 0, tentativas = 0; i < JEITOS.length && tentativas < 10 && !treinoParado; tentativas += 1) {
      $('treinoInstrucao').textContent = tr('{n} de {total} — diga "Ei GPT" {jeito}', { n: i + 1, total: JEITOS.length, jeito: tr(JEITOS[i]) });
      const frase = await window.ditadoPorVoz.gravarFrase({ aoNivel: (n) => ($('treinoNivel').style.width = `${Math.round(n * 100)}%`) });
      if (treinoParado) break;
      if (!frase) {
        $('treinoInstrucao').textContent = tr('Não ouvi nada — fale um pouco mais alto.');
        await new Promise((ok) => setTimeout(ok, 1200));
        continue;
      }
      $('treinoInstrucao').textContent = tr('Conferindo…');
      const r = await api.ditado.treinarFrase(frase.wav);
      const li = document.createElement('li');
      if (!r.ok) {
        li.className = 'nao';
        li.textContent = tr('erro: {erro}', { erro: r.error });
      } else {
        textos.push(r.texto);
        niveis.push(frase.nivel);
        if (r.chamou) sozinho += 1;
        li.className = r.chamou ? 'ok' : 'nao';
        li.textContent = r.chamou ? tr('✓ reconheceu: "{texto}"', { texto: r.texto }) : tr('✗ escreveu: "{texto}"', { texto: r.texto || '(nada)' });
      }
      lista.append(li);
      i += 1;
    }
    $('treinoInstrucao').textContent = '';
    if (textos.length) {
      const s = await api.ditado.salvarTreino({ textos, niveis });
      config = s.config;
      const partes = [tr('O modelo reconheceu {n} de {total} sozinho.', { n: sozinho, total: textos.length })];
      if (s.variantes.length) partes.push(tr('Aprendi {n} jeito(s) novo(s) da sua pronúncia: agora eles também chamam o AuGPT.', { n: s.variantes.length }));
      if (s.recusadas.length) partes.push(tr('Estas não viraram chamada, porque parecem começo de frase comum ou frase longa: {lista}.', { lista: s.recusadas.map((t) => `"${t}"`).join(', ') }));
      if (s.sensibilidade) partes.push(tr('Sensibilidade do microfone ajustada à sua voz.'));
      if (modelo === 'base' && sozinho <= textos.length / 2) partes.push(tr('Dica: o Whisper small entende melhor o português — troque em "Modelo da escuta" e treine de novo.'));
      $('treinoFim').textContent = partes.join(' ');
      $('treinoFim').hidden = false;
    } else {
      $('treinoVoz').hidden = true;
    }
  } catch (err) {
    $('treinoInstrucao').textContent = tr('O treino falhou: {erro}', { erro: err.name || err.message });
  } finally {
    $('treinoNivel').style.width = '0';
    $('btnTreinoParar').textContent = tr('Fechar');
    $('btnTreinoParar').disabled = false;
    $('btnTreinoParar').onclick = () => {
      $('treinoVoz').hidden = true;
      $('btnTreinoParar').onclick = null;
    };
    botao.disabled = false;
    if (escutava || config.ouvirChamada === true) window.escutaPorVoz?.ligar();
    pintarEscuta(await api.ditado.estado().catch(() => ({})));
  }
});
$('btnApagarTreino').addEventListener('click', async () => {
  config = await api.ditado.apagarTreino();
  pintarEscuta(await api.ditado.estado().catch(() => ({})));
});

// o que a escuta ouviu: as últimas frases e como o Whisper escreveu cada uma
async function pintarRegistroDaEscuta() {
  const lista = $('registroEscuta');
  const itens = await api.ditado.registroDaEscuta().catch(() => []);
  lista.textContent = '';
  if (!itens.length) {
    const li = document.createElement('li');
    li.textContent = config.ouvirChamada ? tr('Nada ainda — fale perto do microfone e clique em "Mostrar" de novo.') : tr('Nada ainda — ligue "Chamar com "Ei GPT"" acima.');
    lista.append(li);
  }
  for (const it of itens) {
    const li = document.createElement('li');
    li.className = it.chamou ? 'ok' : 'nao';
    const hora = new Date(it.em).toLocaleTimeString(window.i18n?.idioma === 'en' ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.textContent = `${hora} · ${it.chamou ? '✓' : '✗'} "${it.texto}" · ${it.modelo || ''} · ${it.ms} ms`;
    lista.append(li);
  }
  lista.hidden = false;
  $('btnLimparRegistroEscuta').hidden = false;
  $('btnRegistroEscuta').textContent = tr('Atualizar');
}
$('btnRegistroEscuta').addEventListener('click', pintarRegistroDaEscuta);
$('btnLimparRegistroEscuta').addEventListener('click', async () => {
  await api.ditado.limparRegistroDaEscuta();
  pintarRegistroDaEscuta();
});
manipuladores['ditado-progresso'] = ({ texto }) => {
  if (!texto) return;
  $('compDitadoStatus').textContent = texto;
  if ($('ouvirChamadaStatus').dataset.ocupado) $('ouvirChamadaStatus').textContent = texto;
};

async function carregarModelosEComponentes() {
  api.atualizacao.verificar().then((r) => ((atualizacao = r), pintarAtualizacao()));
  const [v, c] = await Promise.all([api.boasVindas.verificar().catch(() => null), api.componentes.estado().catch(() => null)]);
  verificacao = v;
  componentes = c;
  pintarSugestoesModelos();
  pintarModelosInstalados();
  pintarComponentes();
  pintarDitado();
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
    alvo.innerHTML = '<li class="vazio">Nada guardado ainda. Diga no chat, por exemplo, "lembre que eu prefiro respostas curtas".</li>';
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
});

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



/* ------------------- Ollama de outro computador da rede (19/10) ------------------- */

async function usarServidorOllama(host) {
  $('cfgHost').value = host;
  config = await api.config.set({ host });
  await verificarOllama();
  await atualizarPrimeiroUso();
  carregarModelosEComponentes?.();
}

function mostrarRedeOllama(html) {
  const caixa = $('ollamaRedeResultado');
  caixa.hidden = false;
  caixa.innerHTML = html;
}

$('btnProcurarOllama').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  mostrarRedeOllama('Procurando na rede da casa… (alguns segundos)');
  try {
    const r = await api.ollama.procurarNaRede();
    const outros = r.achados.filter((a) => !a.estePC);
    if (!outros.length) {
      mostrarRedeOllama(`Nenhum Ollama de outro computador respondeu em ${esc(r.redes.join(', ') || 'nenhuma rede local')}. No outro PC, confira a variável <code>OLLAMA_HOST=0.0.0.0</code>, se o Ollama foi reiniciado e se o firewall permite.`);
      return;
    }
    mostrarRedeOllama(
      outros
        .map((a) => `<div class="ollama-achado"><b>${esc(a.ip)}</b> · Ollama ${esc(a.versao)} · ${a.modelos.length} modelo${a.modelos.length === 1 ? '' : 's'}${a.modelos.length ? ` (${esc(a.modelos.slice(0, 4).join(', '))}${a.modelos.length > 4 ? '…' : ''})` : ''} <button type="button" class="btn-secundario" data-host="${esc(a.host)}">Usar este</button></div>`)
        .join('')
    );
    $('ollamaRedeResultado').querySelectorAll('[data-host]').forEach((x) =>
      x.addEventListener('click', async () => {
        await usarServidorOllama(x.dataset.host);
        mostrarRedeOllama(`Pronto: o AuGPT agora usa o Ollama de <b>${esc(x.dataset.host)}</b>. Escolha o modelo no seletor do topo.`);
      })
    );
  } catch (err) {
    mostrarRedeOllama(`Não consegui procurar: ${esc(err.message || err)}`);
  } finally {
    b.disabled = false;
  }
});

$('btnTestarOllama').addEventListener('click', async () => {
  const host = $('cfgHost').value.trim() || 'http://127.0.0.1:11434';
  mostrarRedeOllama('Testando…');
  const r = await api.ollama.testarServidor(host);
  if (!r.ok) return mostrarRedeOllama(`${esc(host)} não respondeu (${esc(r.erro)}).`);
  await usarServidorOllama(r.host);
  mostrarRedeOllama(`${esc(r.host)} respondeu: Ollama ${esc(r.versao || '?')}, ${r.modelos.length} modelo${r.modelos.length === 1 ? '' : 's'}. Já está em uso.`);
});

/** Revisão de 25/10: avisa quando o Ollama deste PC atende pela rede da casa. */
async function conferirExposicaoDoOllama() {
  const caixa = $('ollamaExposto');
  const r = await api.ollama.exposicao().catch(() => null);
  caixa.hidden = !r?.exposto;
  if (!r?.exposto) return;
  caixa.innerHTML = `<b>O Ollama deste PC está aberto para a rede da casa</b> (responde em <code>${esc(r.ip)}:11434</code>). Qualquer aparelho conectado ao seu Wi-Fi pode usar o modelo. Se você não serve outro computador com ele, desligue: no Ollama, <b>Settings → Expose Ollama to the network</b> (desmarque) e reinicie o Ollama. Se você criou a variável <code>OLLAMA_HOST=0.0.0.0</code>, apague-a.`;
}
conferirExposicaoDoOllama();

$('btnOllamaLocal').addEventListener('click', async () => {
  await usarServidorOllama('http://127.0.0.1:11434');
  mostrarRedeOllama('O AuGPT voltou a usar o Ollama deste computador.');
});
