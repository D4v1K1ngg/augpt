'use strict';

/**
 * Janela "Visualizar Execuções" (pedido de Davi 2026-09-23).
 *
 * Script isolado, próprio desta janela — sem módulo/bundler no projeto
 * (renderer/app.js também é um script global solto), então os pequenos
 * helpers de formatação (esc/ms/quando) são duplicados aqui em vez de
 * importados, mesmo padrão que o resto do renderer já usa.
 *
 * O "gráfico de linhas sombreado" em si NÃO é escrito do zero aqui — reusa
 * `window.grafico` (renderer/grafico.js), o módulo Canvas que o chat já usa
 * pros blocos ```chart. `type: 'area'` já é exatamente isso: linha + área
 * sombreada, com eixos/rótulos/legenda/tema escuro prontos.
 */

const api = window.augpt;
const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ms = (n) => (n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`);

function quando(iso) {
  const data = new Date(iso);
  const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 1440) return `há ${Math.floor(minutos / 60)}h`;
  return data.toLocaleDateString('pt-BR');
}

const RESULTADO_ROTULO = {
  concluido: { texto: 'concluído', classe: 'ok' },
  limite: { texto: 'bateu o limite', classe: 'alerta' },
  interrompido: { texto: 'interrompido', classe: 'alerta' },
  erro: { texto: 'erro', classe: 'falha' },
};

// Mesmos rótulos de `tipo` que Agent.contabilizar() passa em loop.js — ver
// comentário lá e em AuGPT-plano-de-implementacao.md (decisão de agrupar o
// custo do raciocínio por FASE, não por número de passo).
const ROTULO_FASE = {
  decisao: 'decisão',
  redacao: 'redação',
  destilacao: 'destilação',
  copiloto: 'crítica do copiloto',
  planejamento: 'planejamento',
  ambiguidade: 'verificação de ambiguidade',
  interpretacao: 'interpretação do pedido',
  reflexao: 'reflexão sobre domínio',
  'skill-cluster': 'proposta de skill',
  'autoteste-skill': 'autoteste de skill',
  rotina: 'rotina',
};

const estado = { origem: '', busca: '', itens: [], selecionadoId: null, metrica: 'tempo' };

/* ============================ gráfico ============================ */

/** Cria o elemento de gráfico (`window.grafico.criar`, mesmo módulo do chat)
 * e encaixa numa altura menor que o padrão do chat (280px) — aqui é uma
 * coluna estreita de detalhe, não a largura inteira da conversa. */
function montarGrafico(spec, altura) {
  const el = window.grafico ? window.grafico.criar(spec) : null;
  if (!el) return document.createTextNode('');
  const canvas = el.querySelector('canvas');
  if (canvas) canvas.dataset.altura = String(altura); // lido pelo pintar() de grafico.js, agendado via rAF logo após isto
  return el;
}

/** Substitui o filho de `slotEl` pelo gráfico de `spec`, ou por um aviso
 * quando não há pontos suficientes (grafico.validar já rejeitaria `labels`
 * vazio, mas o aviso em português fica melhor que o erro genérico dele). */
function encaixarGrafico(slotEl, spec, altura) {
  if (!spec.labels.length) {
    slotEl.innerHTML = '<p class="exec-grafico-vazio">Sem dados suficientes ainda.</p>';
    return;
  }
  slotEl.innerHTML = '';
  slotEl.appendChild(montarGrafico(spec, altura));
}

/* ============================ coluna 1: buscador + lista ============================ */

/** Filtro de texto local — a lista já veio inteira de `api.runs.list`, não
 * vale um IPC novo só pra filtrar por substring em memória. */
function filtrados() {
  const termo = estado.busca.trim().toLowerCase();
  if (!termo) return estado.itens;
  return estado.itens.filter((r) =>
    [r.pedido, r.modelo, r.caso].filter(Boolean).some((campo) => campo.toLowerCase().includes(termo))
  );
}

async function carregar() {
  const filtro = estado.origem ? { origem: estado.origem } : {};
  estado.itens = await api.runs.list(filtro);
  pintarLista();
  pintarTendencia();
}

function pintarLista() {
  const alvo = $('execLista');
  const lista = filtrados();
  if (!lista.length) {
    alvo.innerHTML = '<p class="exec-vazio-lista">Nenhuma execução encontrada.</p>';
    return;
  }
  alvo.innerHTML = lista
    .map((r) => {
      const rotulo = RESULTADO_ROTULO[r.resultado] || { texto: r.resultado || '—', classe: '' };
      return `
        <article class="exec-linha${r.id === estado.selecionadoId ? ' selecionada' : ''}" data-id="${esc(r.id)}">
          <div class="exec-linha-topo">
            <span class="exec-resultado ${rotulo.classe}">${rotulo.texto}</span>
            <span class="exec-modelo">${esc(r.modelo || '—')}</span>
            <span class="exec-quando">${quando(r.em)}</span>
          </div>
          <p class="exec-linha-pedido">${esc(r.pedido || '(sem pedido)')}</p>
          <div class="exec-linha-medidas">
            <span><b>${ms(r.duracaoMs)}</b></span>
            <span><b>${(r.tokens || 0).toLocaleString('pt-BR')}</b> tokens</span>
            <span><b>${r.passos}</b> passos</span>
          </div>
        </article>`;
    })
    .join('');

  alvo.querySelectorAll('.exec-linha').forEach((el) =>
    el.addEventListener('click', () => selecionar(el.dataset.id))
  );
}

function selecionar(id) {
  estado.selecionadoId = id;
  $('execLista')
    .querySelectorAll('.exec-linha')
    .forEach((el) => el.classList.toggle('selecionada', el.dataset.id === id));
  carregarDetalhe(id);
}

/* ============================ coluna 2: detalhe + custo por fase ============================ */

/** Agrupa custoPorChamada (uma linha por CHAMADA) em uma linha por FASE
 * (`tipo`) — é o dado que alimenta o gráfico "qual parte do raciocínio
 * levou mais tempo/custou mais tokens". Ordenado por duração total
 * decrescente: a fase mais cara sempre aparece primeiro no gráfico, resposta
 * direta à pergunta do Davi de bater o olho e já ver. */
function agruparPorFase(custoPorChamada) {
  const porTipo = new Map();
  for (const c of custoPorChamada || []) {
    const tipo = c.tipo || 'outro';
    if (!porTipo.has(tipo)) porTipo.set(tipo, { tipo, duracaoMs: 0, tokens: 0, chamadas: 0 });
    const acc = porTipo.get(tipo);
    acc.duracaoMs += c.duracaoMs || 0;
    acc.tokens += (c.prompt || 0) + (c.completion || 0);
    acc.chamadas += 1;
  }
  return [...porTipo.values()].sort((a, b) => b.duracaoMs - a.duracaoMs);
}

async function carregarDetalhe(id) {
  const r = await api.runs.read(id);
  const alvo = $('execDetalhe');
  if (!r) {
    alvo.innerHTML = '<p class="exec-dica">Não foi possível abrir esta execução.</p>';
    return;
  }

  const rotulo = RESULTADO_ROTULO[r.resultado] || { texto: r.resultado || '—', classe: '' };
  const fases = agruparPorFase(r.custoPorChamada);
  const rotulos = fases.map((f) => ROTULO_FASE[f.tipo] || f.tipo);

  alvo.innerHTML = `
    <div class="exec-detalhe-topo">
      <span class="exec-resultado ${rotulo.classe}">${rotulo.texto}</span>
      <span class="exec-modelo">${esc(r.modelo || '—')}</span>
      ${r.origem === 'bancada' ? `<span class="origem">bancada${r.caso ? `: ${esc(r.caso.slice(0, 34))}` : ''}</span>` : ''}
      <span class="exec-quando">${new Date(r.em).toLocaleString('pt-BR')}</span>
    </div>
    <p class="exec-detalhe-pedido"></p>
    <div class="exec-medidas">
      <span><b>${r.passos}</b> passos</span>
      <span><b>${r.ferramentas.length}</b> ferramentas</span>
      <span><b>${ms(r.duracaoMs)}</b></span>
      <span><b>${(r.tokens.total || 0).toLocaleString('pt-BR')}</b> tokens</span>
      ${r.incidentes?.errosDeFerramenta ? `<span class="ruim"><b>${r.incidentes.errosDeFerramenta}</b> erros</span>` : ''}
    </div>

    <div class="exec-secao">
      <h3>IAs auxiliares acionadas</h3>
      ${
        r.acionamentos?.length
          ? `<ul class="exec-lista">${r.acionamentos
              .map((a) => `<li class="${a.ok === false ? 'ruim' : ''}"><b>passo ${a.n} · ${esc(a.quem)}</b>${a.modelo ? ` (${esc(a.modelo)})` : ''}: ${esc(a.detalhe)}${typeof a.ms === 'number' ? ` · ${a.ms} ms` : ''}</li>`)
              .join('')}</ul>`
          : '<p class="exec-dica">Nenhuma nesta execução (roteador desligado e nenhuma consulta ao crítico), ou execução anterior a esta versão.</p>'
      }
    </div>

    <div class="exec-secao">
      <h3>Onde cada modelo estava no fim</h3>
      ${
        r.modelosNaExecucao?.length
          ? `<ul class="exec-lista">${r.modelosNaExecucao
              .map(
                (l) =>
                  `<li class="${l.situacao === 'atencao' ? 'ruim' : ''}"><b>${esc(l.papel)}</b>: ${esc(l.modelo)} — ${
                    l.carregado ? `${esc(l.onde)}${l.onde === 'GPU+CPU' ? ` (${l.gpuPct}% na GPU)` : ''}` : 'não carregado'
                  }${l.esperado ? ` <span class="exec-dica-inline">(esperado: ${esc(l.esperado)})</span>` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="exec-dica">Não registrado (execução sem conclusão normal, ou anterior a esta versão).</p>'
      }
    </div>

    <div class="exec-secao">
      <h3>Qual parte do raciocínio levou mais tempo</h3>
      ${fases.length ? `<div class="exec-grafico-resumo">fase mais cara: <b>${esc(rotulo1(fases))}</b> (${ms(fases[0].duracaoMs)} em ${fases[0].chamadas} chamada(s))</div>` : ''}
      <div class="exec-grafico-slot" id="execGraficoFaseTempo"></div>
    </div>

    <div class="exec-secao">
      <h3>Qual parte do raciocínio custou mais tokens</h3>
      ${fases.length ? `<div class="exec-grafico-resumo">fase mais cara: <b>${esc(rotulo1(fases))}</b> (${fases[0].tokens.toLocaleString('pt-BR')} tokens)</div>` : ''}
      <div class="exec-grafico-slot" id="execGraficoFaseTokens"></div>
    </div>
  `;
  alvo.querySelector('.exec-detalhe-pedido').textContent = r.pedido || '(sem pedido)';

  encaixarGrafico(
    $('execGraficoFaseTempo'),
    { type: 'area', title: '', labels: rotulos, datasets: [{ label: 'tempo (ms)', data: fases.map((f) => f.duracaoMs) }], yLabel: 'ms' },
    150
  );
  encaixarGrafico(
    $('execGraficoFaseTokens'),
    { type: 'area', title: '', labels: rotulos, datasets: [{ label: 'tokens', data: fases.map((f) => f.tokens) }], yLabel: 'tokens' },
    150
  );
}

function rotulo1(fases) {
  return ROTULO_FASE[fases[0].tipo] || fases[0].tipo;
}

/* ============================ coluna 3: tendência agregada ============================ */

/** Tempo máximo de execução / uso de tokens ao longo da lista filtrada —
 * ordem cronológica (mais antiga → mais recente, leitura padrão de
 * tendência). */
function pintarTendencia() {
  const alvo = $('execTendencia');
  const lista = [...filtrados()].reverse(); // listar() vem mais recente primeiro; tendência lê da esquerda pra direita no tempo
  if (!lista.length) {
    alvo.innerHTML = '<p class="exec-grafico-vazio">Nenhuma execução na lista atual.</p>';
    return;
  }

  const valores = lista.map((r) => (estado.metrica === 'tokens' ? r.tokens || 0 : r.duracaoMs || 0));
  const max = Math.max(...valores);
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  const formatar = (v) => (estado.metrica === 'tokens' ? `${Math.round(v).toLocaleString('pt-BR')} tokens` : ms(v));

  alvo.innerHTML = `
    <div class="exec-grafico-resumo">
      máx: <b>${formatar(max)}</b> · média: <b>${formatar(media)}</b> · ${lista.length} execuç${lista.length === 1 ? 'ão' : 'ões'}
    </div>
    <div class="exec-grafico-slot" id="execGraficoTendencia"></div>
  `;

  encaixarGrafico(
    $('execGraficoTendencia'),
    {
      type: 'area',
      title: '',
      labels: lista.map((r) => quando(r.em)),
      datasets: [{ label: estado.metrica === 'tokens' ? 'tokens' : 'tempo', data: valores }],
      yLabel: estado.metrica === 'tokens' ? 'tokens' : 'ms',
    },
    260
  );
}

/* ============================ eventos ============================ */

$('execBusca').addEventListener('input', (e) => {
  estado.busca = e.target.value;
  pintarLista();
  pintarTendencia();
});

$('execFiltroOrigem').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  estado.origem = chip.dataset.origem;
  $('execFiltroOrigem').querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativo', c === chip));
  carregar();
});

$('execToggleMetrica').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  estado.metrica = chip.dataset.metrica;
  $('execToggleMetrica').querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativo', c === chip));
  pintarTendencia();
});

// Fase 2 (facilidade de uso): execução nova aparece sem fechar e abrir a
// janela. Busca, filtro e a execução selecionada continuam como estavam.
api.runs.onAtualizadas?.(() => {
  carregar();
});

carregar();
