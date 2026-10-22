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
  entendimento: 'entender o pedido',
  decisao: 'decisão',
  redacao: 'escrever a resposta',
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
  $('execTotal').textContent = `${lista.length} de ${estado.itens.length}`;
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

/* ============================ coluna 2: a execução ============================ */

/** Uma linha por FASE (`tipo` de cada chamada ao modelo), a mais demorada primeiro. */
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

const site = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const numero = (n) => (n || 0).toLocaleString('pt-BR');
const cartao = (titulo, corpo, extra = '') => `<section class="exec-cartao${extra ? ` ${extra}` : ''}"><h3>${titulo}</h3>${corpo}</section>`;

function blocoDasFases(fases) {
  if (!fases.length) return cartao('Onde o tempo foi', '<p class="exec-nada">Sem chamadas ao modelo registradas.</p>');
  const maior = Math.max(...fases.map((f) => f.duracaoMs), 1);
  const linhas = fases
    .map(
      (f) => `<span class="fase">${esc(ROTULO_FASE[f.tipo] || f.tipo)}</span>
      <span class="barra-fase"><i style="width:${Math.max(2, Math.round((f.duracaoMs / maior) * 100))}%"></i></span>
      <span class="valor"><b>${ms(f.duracaoMs)}</b> · ${numero(f.tokens)} tokens · ${f.chamadas} chamada${f.chamadas === 1 ? '' : 's'}</span>`
    )
    .join('');
  return cartao('Onde o tempo foi <small>por etapa do raciocínio</small>', `<div class="exec-fases">${linhas}</div>`);
}

function blocoDasFontes(fontes) {
  const consultas = [...new Set((fontes || []).filter((f) => f.tipo === 'busca').flatMap((f) => f.consultas || []))];
  const lidas = (fontes || []).filter((f) => f.tipo === 'leitura' && f.url);
  if (!consultas.length && !lidas.length) return '';
  const buscas = consultas.length ? `<p class="exec-sub">${consultas.length} busca${consultas.length === 1 ? '' : 's'}</p><div class="exec-buscas">${consultas.slice(0, 24).map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : '';
  const paginas = lidas.length
    ? `<p class="exec-sub">${lidas.length} página${lidas.length === 1 ? '' : 's'} lida${lidas.length === 1 ? '' : 's'}</p><ul class="exec-paginas">${lidas
        .map((f) => `<li><span class="site">${esc(site(f.url))}</span><a href="${esc(f.url)}" title="${esc(f.url)}">${esc(f.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></li>`)
        .join('')}</ul>`
    : '';
  return cartao('O que buscou e leu', buscas + paginas);
}

function blocoDoRaciocinio(passos) {
  const comTexto = (passos || []).filter((p) => p.pensamento);
  if (!comTexto.length) return '';
  return cartao(
    `Raciocínio <small>${comTexto.length} passo${comTexto.length === 1 ? '' : 's'}</small>`,
    `<ol class="exec-passos">${comTexto.map((p) => `<li><b>passo ${p.n}</b>${esc(String(p.pensamento).slice(0, 700))}${String(p.pensamento).length > 700 ? '…' : ''}</li>`).join('')}</ol>`
  );
}

function blocoDosModelos(r) {
  const extras = [];
  if (r.acionamentos?.length) {
    extras.push(
      cartao(
        'IAs auxiliares',
        `<ul class="exec-lista">${r.acionamentos
          .map((a) => `<li class="${a.ok === false ? 'ruim' : ''}"><b>passo ${a.n} · ${esc(a.quem)}</b>${a.modelo ? ` (${esc(a.modelo)})` : ''}: ${esc(a.detalhe)}${typeof a.ms === 'number' ? ` · ${a.ms} ms` : ''}</li>`)
          .join('')}</ul>`
      )
    );
  }
  if (r.modelosNaExecucao?.length) {
    extras.push(
      cartao(
        'Onde cada modelo estava no fim',
        `<ul class="exec-lista">${r.modelosNaExecucao
          .map(
            (l) =>
              `<li class="${l.situacao === 'atencao' ? 'ruim' : ''}"><b>${esc(l.papel)}</b>: ${esc(l.modelo)} — ${
                l.carregado ? `${esc(l.onde)}${l.onde === 'GPU+CPU' ? ` (${l.gpuPct}% na GPU)` : ''}` : 'não carregado'
              }${l.esperado ? ` <span class="exec-dica-inline">(esperado: ${esc(l.esperado)})</span>` : ''}</li>`
          )
          .join('')}</ul>`
      )
    );
  }
  return extras.join('');
}

async function carregarDetalhe(id) {
  const r = await api.runs.read(id);
  const alvo = $('execDetalhe');
  if (!r) {
    alvo.innerHTML = '<p class="exec-nada">Não foi possível abrir esta execução.</p>';
    return;
  }
  const rotulo = RESULTADO_ROTULO[r.resultado] || { texto: r.resultado || '—', classe: '' };
  const buscas = (r.fontes || []).filter((f) => f.tipo === 'busca').reduce((t, f) => t + Math.max(1, f.consultas?.length || 0), 0);
  const lidas = (r.fontes || []).filter((f) => f.tipo === 'leitura').length;
  const etapas = (r.custoPorChamada || []).length;
  const pilulas = [r.rota && r.rota !== 'pesquisa' ? r.rota.replace(/_/g, ' ') : null, r.nucleo?.modo ? `pesquisa ${r.nucleo.modo}` : null, r.nucleo?.produto ? 'produto' : null, r.origem === 'bancada' ? `bancada${r.caso ? `: ${r.caso.slice(0, 30)}` : ''}` : null].filter(Boolean);

  alvo.innerHTML = `
    <div class="exec-cabeca">
      <span class="exec-resultado ${rotulo.classe}">${rotulo.texto}</span>
      <span class="exec-modelo">${esc(r.modelo || '—')}</span>
      ${pilulas.map((p) => `<span class="exec-pill">${esc(p)}</span>`).join('')}
      <span class="exec-quando">${new Date(r.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
    </div>
    <h1 class="exec-detalhe-pedido"></h1>
    <div class="exec-tiles">
      <div><b>${ms(r.duracaoMs)}</b><span>tempo total</span></div>
      <div><b>${numero(r.tokens?.total)}</b><span>tokens</span></div>
      <div><b>${buscas}</b><span>buscas</span></div>
      <div><b>${lidas}</b><span>páginas lidas</span></div>
      <div><b>${etapas}</b><span>chamadas ao modelo</span></div>
    </div>
    ${r.erro ? cartao('Erro', `<p>${esc(r.erro)}</p>`, 'erro') : ''}
    ${blocoDasFases(agruparPorFase(r.custoPorChamada))}
    ${r.resposta ? cartao('Resposta', `<div class="exec-resposta" id="execResposta">${window.md ? md.render(r.resposta) : esc(r.resposta)}</div><button class="btn-secundario exec-ver-tudo" id="execVerTudo" type="button">Ver a resposta inteira</button>`) : ''}
    ${blocoDasFontes(r.fontes)}
    ${blocoDoRaciocinio(r.passosDetalhados)}
    ${blocoDosModelos(r)}
  `;
  alvo.querySelector('.exec-detalhe-pedido').textContent = r.pedido || '(sem pedido)';
  alvo.closest('.exec-col-rolagem').scrollTop = 0;
  const resposta = $('execResposta');
  if (resposta) {
    // resposta curta: nada para abrir
    if (resposta.scrollHeight <= 380) {
      resposta.classList.add('aberta');
      $('execVerTudo').hidden = true;
    }
    $('execVerTudo').addEventListener('click', (e) => {
      const aberta = resposta.classList.toggle('aberta');
      e.currentTarget.textContent = aberta ? 'Recolher' : 'Ver a resposta inteira';
    });
  }
}

/* ============================ coluna 3: tendência ============================ */

function pintarTendencia() {
  const alvo = $('execTendencia');
  const lista = [...filtrados()].reverse(); // a lista vem da mais nova; a tendência lê da esquerda para a direita no tempo
  if (!lista.length) {
    alvo.innerHTML = '<p class="exec-grafico-vazio">Nenhuma execução na lista atual.</p>';
    return;
  }
  const tokens = estado.metrica === 'tokens';
  const valores = lista.map((r) => (tokens ? r.tokens || 0 : r.duracaoMs || 0));
  const ordenados = [...valores].sort((a, b) => a - b);
  const formatar = (v) => (tokens ? numero(Math.round(v)) : ms(v));
  const mais = [...lista].sort((a, b) => (tokens ? (b.tokens || 0) - (a.tokens || 0) : b.duracaoMs - a.duracaoMs)).slice(0, 6);

  alvo.innerHTML = `
    <div class="exec-tend-tiles">
      <div><b>${formatar(ordenados[Math.floor(ordenados.length / 2)])}</b><span>mediana</span></div>
      <div><b>${formatar(valores.reduce((a, b) => a + b, 0) / valores.length)}</b><span>média</span></div>
      <div><b>${formatar(ordenados[ordenados.length - 1])}</b><span>máximo</span></div>
    </div>
    <div class="exec-grafico-slot" id="execGraficoTendencia"></div>
    <p class="exec-sub">${tokens ? 'as que mais gastaram' : 'as mais demoradas'}</p>
    <ul class="exec-lentas">${mais.map((r) => `<li data-id="${esc(r.id)}"><b>${formatar(tokens ? r.tokens || 0 : r.duracaoMs)}</b><span>${esc(r.pedido || '(sem pedido)')}</span></li>`).join('')}</ul>
  `;
  alvo.querySelectorAll('.exec-lentas li').forEach((li) => li.addEventListener('click', () => selecionar(li.dataset.id)));
  encaixarGrafico(
    $('execGraficoTendencia'),
    {
      type: 'area',
      title: '',
      labels: lista.map((r) => new Date(r.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
      // tempo em segundos no gráfico (em ms o eixo mostrava "1 mi")
      datasets: [{ label: tokens ? 'tokens' : 'tempo (s)', data: tokens ? valores : valores.map((v) => Math.round(v / 100) / 10) }],
      yLabel: tokens ? 'tokens' : 's',
    },
    220
  );
}

// links da resposta e das páginas lidas abrem no navegador (a janela nunca navega)
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (!a) return;
  e.preventDefault();
  window.open(a.href);
});

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
