'use strict';

/* Tela de boas-vindas (15/10, distribuição para os amigos do Davi).
 * Etapas: computador → Ollama → modelos → busca na web. Cada instalação só
 * começa no clique do botão (é a confirmação do usuário). Usa as globais de
 * app.js: api, $, config, carregarConfig, carregarModelos, FASES_SX_EMBUTIDO.
 * Aparece sozinha na primeira abertura (sem modelo configurado e sem a
 * boas-vindas concluída); depois, pelo botão em Ajustes. */

const bv = {
  estado: null, // resposta de boasVindas:verificar
  escolhido: null, // nome do modelo principal escolhido
  baixando: null, // nome do modelo sendo baixado
  ocupado: false,
};

const h = (tag, props = {}, ...filhos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'onclick') el.addEventListener('click', v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
};
const gb = (n) => `${String(Math.round(n * 10) / 10).replace('.', ',')} GB`;
const temModelo = (nome) => (bv.estado?.modelos || []).some((m) => m === nome || m === `${nome}:latest` || m.split(':')[0] === nome && !nome.includes(':'));

function etapa({ titulo, situacao, texto, corpo = [], acoes = [], progresso = null }) {
  return h(
    'li',
    { class: `bv-etapa ${situacao}` },
    h('i', { class: 'bv-marca', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'bv-conteudo' },
      h('b', {}, titulo),
      texto ? h('p', {}, texto) : null,
      ...corpo,
      progresso ? h('div', { class: 'bv-progresso' }, h('div', { class: 'bv-barra', style: `width:${progresso.porcento ?? 0}%` }), h('span', {}, progresso.texto || '')) : null,
      acoes.length ? h('div', { class: 'bv-acoes' }, ...acoes) : null
    )
  );
}

function pintar() {
  const e = bv.estado;
  const lista = $('bvEtapas');
  lista.replaceChildren();
  if (!e) {
    lista.append(h('li', { class: 'bv-carregando' }, 'Verificando o computador…'));
    return;
  }
  const c = e.computador;
  const rec = e.recomendacao;
  const gpu = c.gpus?.length ? c.gpus.map((g) => `${g.nome} · ${gb(g.vramGB)}`).join(', ') : 'nenhuma placa de vídeo com memória dedicada encontrada';

  // 1. computador
  lista.append(
    etapa({
      titulo: 'Seu computador',
      situacao: rec.avisos.length ? 'aviso' : 'ok',
      corpo: [
        h('ul', { class: 'bv-ficha' },
          h('li', {}, h('span', {}, 'Processador'), c.cpu || '—', ` (${c.nucleos} núcleos)`),
          h('li', {}, h('span', {}, 'Memória RAM'), gb(c.ramTotalGB)),
          h('li', {}, h('span', {}, 'Placa de vídeo'), gpu),
          h('li', {}, h('span', {}, 'Espaço livre'), c.discoLivreGB != null ? `${gb(c.discoLivreGB)} (disco dos modelos)` : '—')
        ),
        ...rec.avisos.map((a) => h('p', { class: 'bv-aviso' }, `⚠ ${a}`)),
      ],
    })
  );

  // 2. Ollama
  const ollamaOk = e.ollama.online;
  lista.append(
    etapa({
      titulo: 'Ollama (o programa que roda a IA)',
      situacao: ollamaOk ? 'ok' : 'falta',
      texto: ollamaOk
        ? 'Instalado e ligado.'
        : e.ollama.instalado
          ? 'Instalado, mas desligado.'
          : e.plataforma === 'win32'
            ? 'Não está instalado. O AuGPT instala pelo winget (pacote oficial) ou pelo instalador oficial do site ollama.com.'
            : 'Não está instalado. No Mac e no Linux a instalação pede senha de administrador; clique para ver como instalar.',
      progresso: bv.progressoOllama,
      acoes: ollamaOk
        ? []
        : e.ollama.instalado
          ? [h('button', { class: 'btn-primario', disabled: bv.ocupado, onclick: ligarOllama }, 'Ligar o Ollama')]
          : [h('button', { class: 'btn-primario', disabled: bv.ocupado, onclick: instalarOllama }, 'Instalar o Ollama')],
    })
  );

  // 3. modelos
  const principal = bv.escolhido || rec.principal.nome;
  const infoDe = (nome) => [rec.principal, ...rec.alternativas].find((m) => m.nome === nome) || rec.principal;
  const escolhido = infoDe(principal);
  const linhaModelo = (m, papel) =>
    h('li', { class: 'bv-modelo' },
      h('span', { class: 'bv-modelo-nome' }, m.rotulo, h('small', {}, ` ${m.nome} · ${gb(m.downloadGB)}`)),
      h('span', { class: 'bv-modelo-papel' }, papel),
      temModelo(m.nome)
        ? h('span', { class: 'bv-instalado' }, 'instalado ✓')
        : h('button', { class: 'btn-secundario', disabled: !ollamaOk || bv.ocupado, onclick: () => baixarModelos([m.nome]) }, bv.baixando === m.nome ? 'baixando…' : 'Baixar')
    );
  const faltam = [escolhido, rec.embedding].filter((m) => !temModelo(m.nome)).map((m) => m.nome);
  const seletor = h('select', { class: 'bv-seletor', 'aria-label': 'Outro modelo principal', disabled: bv.ocupado },
    ...[rec.principal, ...rec.alternativas].map((m) => {
      const op = h('option', { value: m.nome }, `${m.rotulo} · ${gb(m.downloadGB)}${m.nome === rec.principal.nome ? ' · recomendado' : m.cabe === false ? ' · pesado para este PC' : ''}`);
      if (m.nome === principal) op.selected = true;
      return op;
    })
  );
  seletor.addEventListener('change', () => {
    bv.escolhido = seletor.value;
    pintar();
  });
  lista.append(
    etapa({
      titulo: 'Modelos de IA',
      situacao: faltam.length ? 'falta' : 'ok',
      texto: `Recomendado para este PC: ${rec.principal.rotulo} — ${rec.principal.motivo}.`,
      corpo: [h('ul', { class: 'bv-modelos' }, linhaModelo(escolhido, 'responde e pesquisa'), linhaModelo(rec.embedding, 'escolhe os trechos das páginas')), h('label', { class: 'bv-outro' }, 'Modelo principal: ', seletor)],
      progresso: bv.progressoModelo,
      acoes: faltam.length ? [h('button', { class: 'btn-primario', disabled: !ollamaOk || bv.ocupado, onclick: () => baixarModelos(faltam) }, `Baixar ${faltam.length === 2 ? 'os dois' : 'o que falta'} (${gb([escolhido, rec.embedding].filter((m) => faltam.includes(m.nome)).reduce((s, m) => s + m.downloadGB, 0))})`)] : [],
    })
  );

  // 4. busca
  const busca = e.busca || {};
  lista.append(
    etapa({
      titulo: 'Busca na web (SearXNG embutido)',
      situacao: busca.instalado ? 'ok' : 'opcional',
      texto: busca.instalado
        ? 'Instalada — o AuGPT pesquisa em vários buscadores ao mesmo tempo.'
        : 'Recomendada: um buscador próprio que consulta vários sites de busca de uma vez (baixa Python e o SearXNG, cerca de 100 MB). Sem ela, o AuGPT usa buscadores de reserva, com resultados piores.',
      progresso: bv.progressoBusca,
      acoes: busca.instalado ? [] : [h('button', { class: 'btn-secundario', disabled: bv.ocupado, onclick: instalarBusca }, 'Instalar a busca')],
    })
  );

  $('bvConcluir').disabled = !(ollamaOk && temModelo(escolhido.nome) && temModelo(rec.embedding.nome)) || bv.ocupado;
}

async function verificar() {
  bv.estado = null;
  pintar();
  try {
    bv.estado = await api.boasVindas.verificar();
  } catch (err) {
    $('bvEtapas').replaceChildren(h('li', { class: 'bv-etapa falta' }, h('i', { class: 'bv-marca' }), h('div', { class: 'bv-conteudo' }, h('b', {}, 'Não consegui verificar o computador'), h('p', {}, String(err.message || err)))));
    return;
  }
  pintar();
}

async function ocupar(tarefa) {
  bv.ocupado = true;
  pintar();
  try {
    await tarefa();
  } finally {
    bv.ocupado = false;
    await verificar();
  }
}

const instalarOllama = () =>
  ocupar(async () => {
    bv.progressoOllama = { texto: 'Começando…', porcento: 5 };
    pintar();
    const r = await api.boasVindas.instalarOllama();
    bv.progressoOllama = { texto: r.texto, porcento: r.ok ? 100 : 0 };
  });

const ligarOllama = () =>
  ocupar(async () => {
    bv.progressoOllama = { texto: 'Ligando o Ollama…', porcento: 50 };
    pintar();
    const r = await api.boasVindas.ligarOllama();
    bv.progressoOllama = r.ok ? null : { texto: r.error || 'O Ollama não respondeu.', porcento: 0 };
  });

const baixarModelos = (nomes) =>
  ocupar(async () => {
    for (const nome of nomes) {
      bv.baixando = nome;
      bv.progressoModelo = { texto: `${nome}: preparando…`, porcento: 0 };
      pintar();
      const r = await api.ollama.pull(nome);
      if (!r.ok) {
        bv.progressoModelo = { texto: `${nome}: ${r.error || 'falhou'}`, porcento: 0 };
        break;
      }
      bv.progressoModelo = { texto: `${nome}: pronto`, porcento: 100 };
    }
    bv.baixando = null;
  });

const instalarBusca = () =>
  ocupar(async () => {
    bv.progressoBusca = { texto: 'Começando…', porcento: 5 };
    pintar();
    const r = await api.searxngRuntime.instalar();
    bv.progressoBusca = r.ok ? { texto: 'Busca instalada.', porcento: 100 } : { texto: r.error || 'A instalação falhou.', porcento: 0 };
  });

// progresso que chega do processo principal (canal genérico, ver app.js api.onEvent)
window.boasVindasEvento = (canal, dados = {}) => {
  if ($('boasVindas').hidden) return;
  if (canal === 'ollama-instalacao-progresso') bv.progressoOllama = { texto: dados.texto, porcento: dados.porcento ?? bv.progressoOllama?.porcento ?? 30 };
  else if (canal === 'ollama-pull-progresso' && bv.baixando) {
    const pct = dados.total && dados.completed != null ? Math.min(100, Math.round((dados.completed / dados.total) * 100)) : null;
    bv.progressoModelo = { texto: `${bv.baixando}: ${pct != null ? `${pct}%` : dados.status || '…'}`, porcento: pct ?? bv.progressoModelo?.porcento ?? 0 };
  } else if (canal === 'runtime-searxng-progresso') bv.progressoBusca = { texto: (typeof FASES_SX_EMBUTIDO !== 'undefined' && FASES_SX_EMBUTIDO[dados.fase]) || dados.fase, porcento: 50 };
  else return;
  pintar();
};

function abrirBoasVindas() {
  $('boasVindas').hidden = false;
  verificar();
}

function fecharBoasVindas() {
  $('boasVindas').hidden = true;
}

$('bvVerificar').addEventListener('click', verificar);
$('bvPular').addEventListener('click', fecharBoasVindas);
$('bvConcluir').addEventListener('click', async () => {
  const modelo = bv.escolhido || bv.estado?.recomendacao?.principal?.nome;
  await api.boasVindas.concluir({ modelo });
  fecharBoasVindas();
  if (typeof carregarConfig === 'function') await carregarConfig();
  if (typeof carregarModelos === 'function') await carregarModelos();
});
$('btnAbrirBoasVindas')?.addEventListener('click', abrirBoasVindas);

// primeira abertura: sem a boas-vindas concluída e sem modelo configurado
(async () => {
  try {
    const cfg = await api.config.get();
    if (cfg.boasVindasConcluida !== true && !cfg.model) abrirBoasVindas();
  } catch {
    /* sem config legível: a tela inicial de sempre */
  }
})();
