'use strict';

/* Tela de boas-vindas (15/10; refeita em 22/10 em tela cheia e em 3 passos, pedido do Davi).
 *  1. Boas-vindas: o idioma (detectado do Windows, trocável aqui) e o nome (opcional).
 *  2. Seu computador: computador, Ollama e modelos (essencial) e os opcionais. Cada instalação
 *     só começa no clique do botão (é a confirmação do usuário).
 *  3. Tudo pronto: exemplos para começar.
 * Usa as globais de app*.js: api, $, config, carregarConfig, carregarModelos, FASES_SX_EMBUTIDO.
 * Aparece sozinha na primeira abertura; depois, pelo botão em Ajustes → Geral. */

const bv = {
  passo: 1,
  idioma: '', // '' = automático (o do Windows); 'pt' | 'en' quando o usuário escolhe aqui
  estado: null, // resposta de boasVindas:verificar
  escolhido: null, // nome do modelo principal escolhido
  baixando: null, // nome do modelo sendo baixado
  ocupado: false,
};
const t = (pt, vars) => (window.i18n ? window.i18n.tr(pt, vars) : pt);
// frases prontas do processo principal (motivo da recomendação, avisos): ver PADROES em i18n.js
const tt = (s) => (window.i18n ? window.i18n.trTexto(s) : String(s ?? ''));

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
const gb = (n) => {
  const x = Math.round(n * 10) / 10;
  return `${window.i18n?.idioma === 'en' ? x : String(x).replace('.', ',')} GB`;
};
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

/* ============================ passo 1: idioma e nome ============================ */

function pintarIdioma() {
  const ativo = window.i18n?.idioma || 'pt';
  $('bvIdiomas').querySelectorAll('button').forEach((b) => {
    const sim = b.dataset.idioma === ativo;
    b.classList.toggle('ativo', sim);
    b.setAttribute('aria-checked', String(sim));
  });
  $('bvIdiomaDetectado').textContent = t('Detectado no Windows: {idioma}', { idioma: window.i18n?.nomeDoIdioma(window.i18n.detectado()) || 'Português' });
}

$('bvIdiomas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-idioma]');
  if (!b) return;
  // o que bate com o Windows fica "automático" (segue o sistema se ele mudar); o outro é escolha
  bv.idioma = b.dataset.idioma === window.i18n?.detectado() ? '' : b.dataset.idioma;
  window.i18n?.definir(bv.idioma);
});

// trocar o idioma refaz o que é montado pelo código (o texto fixo o i18n troca sozinho)
window.addEventListener('idioma', () => {
  if ($('boasVindas').hidden) return;
  pintarIdioma();
  if (bv.passo === 2) pintar();
  if (bv.passo === 3) pintarPronto();
});

/* ============================ passo 2: o computador ============================ */

function pintar() {
  const e = bv.estado;
  const lista = $('bvEtapas');
  const opcionais = $('bvOpcionais');
  lista.replaceChildren();
  opcionais.replaceChildren();
  if (!e) {
    lista.append(h('li', { class: 'bv-carregando' }, t('Verificando o computador…')));
    $('bvIr3').disabled = true;
    return;
  }
  const c = e.computador;
  const rec = e.recomendacao;
  const gpu = c.gpus?.length ? c.gpus.map((g) => `${g.nome} · ${gb(g.vramGB)}`).join(', ') : t('nenhuma placa de vídeo com memória dedicada encontrada');

  // 1. computador
  lista.append(
    etapa({
      titulo: t('Seu computador'),
      situacao: rec.avisos.length ? 'aviso' : 'ok',
      corpo: [
        h('ul', { class: 'bv-ficha' },
          h('li', {}, h('span', {}, t('Processador')), c.cpu || '—', ` (${t('{n} núcleos', { n: c.nucleos })})`),
          h('li', {}, h('span', {}, t('Memória RAM')), gb(c.ramTotalGB)),
          h('li', {}, h('span', {}, t('Placa de vídeo')), gpu),
          h('li', {}, h('span', {}, t('Espaço livre')), c.discoLivreGB != null ? t('{gb} (disco dos modelos)', { gb: gb(c.discoLivreGB) }) : '—')
        ),
        ...rec.avisos.map((a) => h('p', { class: 'bv-aviso' }, `⚠ ${tt(a)}`)),
      ],
    })
  );

  // 2. Ollama
  const ollamaOk = e.ollama.online;
  lista.append(
    etapa({
      titulo: t('Ollama (o programa que roda a IA)'),
      situacao: ollamaOk ? 'ok' : 'falta',
      texto: ollamaOk
        ? t('Instalado e ligado.')
        : e.ollama.instalado
          ? t('Instalado, mas desligado.')
          : e.plataforma === 'win32'
            ? t('Não está instalado. O AuGPT instala pelo winget (pacote oficial) ou pelo instalador oficial do site ollama.com.')
            : t('Não está instalado. No Mac e no Linux a instalação pede senha de administrador; clique para ver como instalar.'),
      progresso: bv.progressoOllama,
      acoes: ollamaOk
        ? []
        : e.ollama.instalado
          ? [h('button', { class: 'btn-primario', disabled: bv.ocupado, onclick: ligarOllama }, t('Ligar o Ollama'))]
          : [h('button', { class: 'btn-primario', disabled: bv.ocupado, onclick: instalarOllama }, t('Instalar o Ollama'))],
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
        ? h('span', { class: 'bv-instalado' }, t('instalado ✓'))
        : h('button', { class: 'btn-secundario', disabled: !ollamaOk || bv.ocupado, onclick: () => baixarModelos([m.nome]) }, bv.baixando === m.nome ? t('baixando…') : t('Baixar'))
    );
  const faltam = [escolhido, rec.embedding].filter((m) => !temModelo(m.nome)).map((m) => m.nome);
  const seletor = h('select', { class: 'bv-seletor', 'aria-label': t('Outro modelo principal'), disabled: bv.ocupado },
    ...[rec.principal, ...rec.alternativas].map((m) => {
      const op = h('option', { value: m.nome }, `${m.rotulo} · ${gb(m.downloadGB)}${m.nome === rec.principal.nome ? t(' · recomendado') : m.cabe === false ? t(' · pesado para este PC') : ''}`);
      if (m.nome === principal) op.selected = true;
      return op;
    })
  );
  seletor.addEventListener('change', () => {
    bv.escolhido = seletor.value;
    pintar();
  });
  const tamanhoQueFalta = gb([escolhido, rec.embedding].filter((m) => faltam.includes(m.nome)).reduce((s, m) => s + m.downloadGB, 0));
  lista.append(
    etapa({
      titulo: t('Modelos de IA'),
      situacao: faltam.length ? 'falta' : 'ok',
      texto: t('Recomendado para este PC: {rotulo} — {motivo}.', { rotulo: rec.principal.rotulo, motivo: tt(rec.principal.motivo) }),
      corpo: [h('ul', { class: 'bv-modelos' }, linhaModelo(escolhido, t('responde e pesquisa')), linhaModelo(rec.embedding, t('escolhe os trechos das páginas'))), h('label', { class: 'bv-outro' }, t('Modelo principal: '), seletor)],
      progresso: bv.progressoModelo,
      acoes: faltam.length ? [h('button', { class: 'btn-primario', disabled: !ollamaOk || bv.ocupado, onclick: () => baixarModelos(faltam) }, faltam.length === 2 ? t('Baixar os dois ({gb})', { gb: tamanhoQueFalta }) : t('Baixar o que falta ({gb})', { gb: tamanhoQueFalta }))] : [],
    })
  );

  // opcionais: busca, YouTube, texto de imagens, criar imagens
  const busca = e.busca || {};
  opcionais.append(
    etapa({
      titulo: t('Busca na web (SearXNG embutido)'),
      situacao: busca.instalado ? 'ok' : 'opcional',
      texto: busca.instalado
        ? t('Instalada — o AuGPT pesquisa em vários buscadores ao mesmo tempo.')
        : t('Recomendada: um buscador próprio que consulta vários sites de busca de uma vez (baixa Python e o SearXNG, cerca de 130 MB). Sem ela, o AuGPT usa buscadores de reserva, com resultados piores.'),
      progresso: bv.progressoBusca,
      acoes: busca.instalado ? [] : [h('button', { class: 'btn-secundario', disabled: bv.ocupado, onclick: instalarBusca }, t('Instalar a busca'))],
    })
  );
  const youtube = e.youtube || {};
  opcionais.append(
    etapa({
      titulo: t('Vídeos do YouTube (yt-dlp)'),
      situacao: youtube.instalado ? 'ok' : 'opcional',
      texto: youtube.instalado
        ? t('Instalado — o agente lê a legenda e os comentários de vídeos, sem baixá-los.')
        : t('Opcional: deixa o agente "assistir" a reviews e tutoriais lendo a legenda e os comentários (o vídeo não é baixado). Baixa o yt-dlp oficial, 18 MB, com o SHA-256 conferido.'),
      progresso: bv.progressoYoutube,
      acoes: youtube.instalado ? [] : [h('button', { class: 'btn-secundario', disabled: bv.ocupado, onclick: instalarYoutube }, t('Instalar o yt-dlp'))],
    })
  );
  const ocr = e.ocr || {};
  opcionais.append(
    etapa({
      titulo: t('Texto de imagens (Tesseract)'),
      situacao: ocr.instalado ? 'ok' : 'opcional',
      texto: ocr.instalado
        ? t('Instalado — o texto das imagens anexadas é lido letra a letra, sem internet.')
        : t('Opcional: lê o texto de prints, documentos e notas fiscais que você anexar, sem IA e sem internet (cerca de 50 MB, pelo winget; o Windows pode pedir permissão).'),
      progresso: bv.progressoOcr,
      acoes: ocr.instalado || ocr.manual ? [] : [h('button', { class: 'btn-secundario', disabled: bv.ocupado, onclick: instalarOcr }, t('Instalar o Tesseract'))],
    })
  );
  const img = e.imagem || {};
  opcionais.append(
    etapa({
      titulo: t('Criar imagens (FLUX.2 Klein)'),
      situacao: img.instalado ? 'ok' : 'opcional',
      texto: img.instalado
        ? t('Instalado — peça "crie uma imagem de…" e ela é feita no seu computador.')
        : img.pode
          ? t('Opcional: cria imagens no seu computador, sem internet. {motivo}. Cerca de {gb} de download.', { motivo: `${tt(img.motivo).charAt(0).toUpperCase()}${tt(img.motivo).slice(1)}`, gb: gb(img.downloadGB || 6) })
          : t('Não disponível neste computador: {motivo}.', { motivo: tt(img.motivo) }),
      progresso: bv.progressoImagem,
      acoes: img.instalado || !img.pode ? [] : [h('button', { class: 'btn-secundario', disabled: bv.ocupado, onclick: instalarImagem }, t('Instalar o gerador de imagens'))],
    })
  );

  const pronto = ollamaOk && temModelo(escolhido.nome) && temModelo(rec.embedding.nome);
  $('bvIr3').disabled = !pronto || bv.ocupado;
  $('bvFalta').textContent = pronto ? '' : t('Falta o essencial: o Ollama ligado e os dois modelos. Dá para pular e preparar depois em Ajustes.');
}

async function verificar() {
  bv.estado = null;
  pintar();
  try {
    bv.estado = await api.boasVindas.verificar();
  } catch (err) {
    $('bvEtapas').replaceChildren(h('li', { class: 'bv-etapa falta' }, h('i', { class: 'bv-marca' }), h('div', { class: 'bv-conteudo' }, h('b', {}, t('Não consegui verificar o computador')), h('p', {}, String(err.message || err)))));
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
    bv.progressoOllama = { texto: t('Começando…'), porcento: 5 };
    pintar();
    const r = await api.boasVindas.instalarOllama();
    bv.progressoOllama = { texto: r.texto, porcento: r.ok ? 100 : 0 };
  });

const ligarOllama = () =>
  ocupar(async () => {
    bv.progressoOllama = { texto: t('Ligando o Ollama…'), porcento: 50 };
    pintar();
    const r = await api.boasVindas.ligarOllama();
    bv.progressoOllama = r.ok ? null : { texto: r.error || t('O Ollama não respondeu.'), porcento: 0 };
  });

const baixarModelos = (nomes) =>
  ocupar(async () => {
    for (const nome of nomes) {
      bv.baixando = nome;
      bv.progressoModelo = { texto: t('{nome}: preparando…', { nome }), porcento: 0 };
      pintar();
      const r = await api.ollama.pull(nome);
      if (!r.ok) {
        bv.progressoModelo = { texto: `${nome}: ${r.error || 'falhou'}`, porcento: 0 };
        break;
      }
      bv.progressoModelo = { texto: t('{nome}: pronto', { nome }), porcento: 100 };
    }
    bv.baixando = null;
  });

const instalacao = (chave, chamar, feito) =>
  ocupar(async () => {
    bv[chave] = { texto: t('Começando…'), porcento: 5 };
    pintar();
    const r = await chamar();
    bv[chave] = r.ok ? { texto: t(feito), porcento: 100 } : { texto: r.error || t('A instalação falhou.'), porcento: 0 };
  });
const instalarBusca = () => instalacao('progressoBusca', () => api.searxngRuntime.instalar(), 'Busca instalada.');
const instalarYoutube = () => instalacao('progressoYoutube', () => api.componentes.instalarYtdlp(), 'yt-dlp instalado.');
const instalarOcr = () => instalacao('progressoOcr', () => api.componentes.instalarTesseract(), 'Tesseract instalado.');
const instalarImagem = () => instalacao('progressoImagem', () => api.componentes.instalarImagem(), 'Gerador de imagens instalado.');

// progresso que chega do processo principal (canal genérico, ver app-eventos.js api.onEvent)
window.boasVindasEvento = (canal, dados = {}) => {
  if ($('boasVindas').hidden) return;
  if (canal === 'ollama-instalacao-progresso') bv.progressoOllama = { texto: dados.texto, porcento: dados.porcento ?? bv.progressoOllama?.porcento ?? 30 };
  else if (canal === 'ollama-pull-progresso' && bv.baixando) {
    const pct = dados.total && dados.completed != null ? Math.min(100, Math.round((dados.completed / dados.total) * 100)) : null;
    bv.progressoModelo = { texto: `${bv.baixando}: ${pct != null ? `${pct}%` : dados.status || '…'}`, porcento: pct ?? bv.progressoModelo?.porcento ?? 0 };
  } else if (canal === 'imagem-progresso') bv.progressoImagem = { texto: dados.texto, porcento: dados.porcento ?? bv.progressoImagem?.porcento ?? 10 };
  else if (canal === 'tesseract-progresso') bv.progressoOcr = { texto: dados.texto, porcento: 50 };
  else if (canal === 'ytdlp-progresso') bv.progressoYoutube = { texto: dados.texto, porcento: 50 };
  else if (canal === 'runtime-searxng-progresso') bv.progressoBusca = { texto: (typeof FASES_SX_EMBUTIDO !== 'undefined' && FASES_SX_EMBUTIDO[dados.fase]) || dados.fase, porcento: 50 };
  else return;
  pintar();
};

/* ============================ passo 3: tudo pronto ============================ */

const EXEMPLOS = ['teste minha internet', 'qual a configuração do meu pc?', 'Quais os melhores fones intra-auriculares para PUBG até R$ 300?'];

function pintarPronto() {
  const nome = $('bvNome').value.trim();
  $('bvProntoTitulo').textContent = nome ? t('Tudo pronto, {nome}!', { nome }) : t('Tudo pronto!');
  $('bvExemplos').replaceChildren(
    ...EXEMPLOS.map((ex) =>
      h('button', { type: 'button', class: 'bv-exemplo', onclick: () => concluir(t(ex)) }, h('span', { class: 'bv-exemplo-seta', 'aria-hidden': 'true' }, '↑'), t(ex))
    )
  );
}

/* ============================ navegação ============================ */

function irPara(passo) {
  bv.passo = passo;
  for (const n of [1, 2, 3]) $(`bvTela${n}`).hidden = n !== passo;
  $('bvPassos').querySelectorAll('li').forEach((li) => {
    const n = Number(li.dataset.passo);
    li.classList.toggle('feito', n < passo);
    li.classList.toggle('atual', n === passo);
  });
  $('boasVindas').scrollTop = 0;
  if (passo === 2) {
    if (bv.estado) pintar(); // refeito no idioma de agora
    else verificar();
  }
  if (passo === 3) pintarPronto();
}

async function abrirBoasVindas() {
  try {
    const cfg = await api.config.get();
    bv.idioma = cfg.idioma || '';
    $('bvNome').value = cfg.nomeDoUsuario || '';
    $('bvNomeAssistente').value = cfg.nomeDaChamada && !/^gpt$/i.test(cfg.nomeDaChamada) ? cfg.nomeDaChamada : '';
  } catch {
    /* começa em branco */
  }
  pintarNomesSugeridos();
  $('boasVindas').hidden = false;
  document.body.classList.add('com-boas-vindas');
  pintarIdioma();
  irPara(1);
  verificar(); // já confere o computador enquanto a pessoa lê o passo 1
}

/** As sugestões de nome do assistente (renderer/voz.js): um clique preenche o campo. */
function pintarNomesSugeridos() {
  const lista = $('bvNomesSugeridos');
  lista.textContent = '';
  for (const nome of window.vozDoUsuario?.nomesSugeridos || ['Jarvis', 'Nexus', 'Sexta-feira', 'Aurora']) {
    const b = h('button', { type: 'button', class: 'chip-nome' }, nome);
    b.addEventListener('click', () => {
      $('bvNomeAssistente').value = nome;
      lista.querySelectorAll('.chip-nome').forEach((x) => x.classList.toggle('ativo', x === b));
    });
    lista.append(b);
  }
}

function fecharBoasVindas() {
  $('boasVindas').hidden = true;
  document.body.classList.remove('com-boas-vindas');
}

/** Fecha a boas-vindas gravando o nome e o idioma; com `pedido`, já o põe na caixa de mensagem. */
async function concluir(pedido) {
  const modelo = bv.escolhido || bv.estado?.recomendacao?.principal?.nome;
  const pronto = bv.passo === 3;
  const nome = $('bvNome').value.trim();
  const nomeAssistente = $('bvNomeAssistente').value.trim().slice(0, 30);
  try {
    if (pronto) await api.boasVindas.concluir({ modelo, nome, idioma: bv.idioma });
    else await api.config.set({ boasVindasConcluida: true, nomeDoUsuario: nome, idioma: bv.idioma });
    // o nome que chama pela voz: vazio deixa como está
    if (nomeAssistente) await api.config.set({ nomeDaChamada: /^(ei )?gpt$/i.test(nomeAssistente) ? 'GPT' : nomeAssistente });
  } catch {
    /* abre de novo na próxima vez */
  }
  fecharBoasVindas();
  if (typeof carregarConfig === 'function') await carregarConfig();
  if (typeof carregarModelos === 'function') await carregarModelos();
  if (pedido && typeof el !== 'undefined' && el.aEntrada) {
    el.aEntrada.value = pedido;
    el.aEntrada.dispatchEvent(new Event('input'));
    el.aEntrada.focus();
  }
}

$('bvIr2').addEventListener('click', () => irPara(2));
$('bvIr3').addEventListener('click', () => irPara(3));
$('bvVoltar1').addEventListener('click', () => irPara(1));
$('bvVoltar2').addEventListener('click', () => irPara(2));
$('bvVerificar').addEventListener('click', verificar);
$('bvNome').addEventListener('keydown', (e) => e.key === 'Enter' && irPara(2));
// pular também conta como visto: não abre de novo sozinha (continua em Ajustes); guarda o nome e o idioma
$('bvPular').addEventListener('click', () => concluir());
$('bvConcluir').addEventListener('click', () => concluir());
$('btnAbrirBoasVindas')?.addEventListener('click', abrirBoasVindas);

// primeira abertura: abre enquanto a boas-vindas não foi concluída nem pulada.
// 15/10: antes dependia de "sem modelo", mas o app escolhe um modelo sozinho ao
// abrir — num PC que já tinha o Ollama, a tela nunca aparecia
(async () => {
  try {
    const cfg = await api.config.get();
    if (cfg.boasVindasConcluida !== true) abrirBoasVindas();
  } catch {
    /* sem config legível: a tela inicial de sempre */
  }
})();
