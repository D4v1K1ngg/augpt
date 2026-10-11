'use strict';

const api = window.augpt;
const $ = (id) => document.getElementById(id);

let config = {};

/* ============================ utilidades ============================ */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ms = (n) => (n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

function rolar(area, forcar = false) {
  const perto = area.scrollHeight - area.scrollTop - area.clientHeight < 180;
  if (forcar || perto) requestAnimationFrame(() => area.scrollTo({ top: area.scrollHeight }));
}

function autoAltura(campo) {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 190)}px`;
}

/** "há 5 min", "ontem", "12/08" — mais legível que timestamp na lista lateral. */
function quando(iso) {
  const data = new Date(iso);
  const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 1440) return `há ${Math.floor(minutos / 60)} h`;
  if (minutos < 2880) return 'ontem';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/* ============================ estado ============================ */

const agente = {
  conversa: [],
  rodando: false,
  turno: null,
  fontes: new Set(),
  inicio: 0,
  cronometro: null,
  idConversa: null,
  // Estado da lateral direita (fase 2 da reforma visual, pedido do Davi
  // 2026-09-18) — só dura a sessão atual, não é persistido em salvarConversa.
  // Ver pintarProgresso/pintarSaidas/adicionarSaida abaixo.
  checklist: [],
  saidas: [],
  // Card "Parágrafos" (pedido do Davi, 2026-09-19): uma entrada por pergunta
  // sua (por turno) nesta conversa, pra navegar em chats grandes. Ao
  // contrário de checklist/saidas, ESTE reconstrói ao reabrir uma conversa
  // salva (restaurarTurno recria as bolhas, então dá pra reancorar nelas —
  // ver abrirConversa). Ver registrarParagrafo/pintarParagrafos abaixo.
  paragrafos: [],
};

// Contador pro id de âncora de cada bolha "você" — usado por
// registrarParagrafo() pra rolar até o turno certo ao clicar no card
// Parágrafos. Não reinicia entre conversas (só precisa ser único no DOM).
let proximoIdParagrafo = 1;

const chat = { historico: [], ocupado: false, idAtual: null, alvo: null, buffer: '', idConversa: null };

/** Ferramentas que produzem um arquivo de verdade — mesmo espírito de
 * GERACOES_DE_ARQUIVO em src/agent/loop.js. Resultado delas vira cartão de
 * anexo no chat (ver manipuladores.ferramenta/resultado/concluido abaixo). */
const GERACOES_DE_ARQUIVO = ['gerar_docx', 'gerar_xlsx', 'gerar_pdf', 'gerar_html', 'escrever_arquivo', 'acrescentar_ao_arquivo'];

/** "Arquivo criado: relatorio.pdf (3.2 KB)" — mensagem que gravar() em
 * src/tools/gerar.js devolve. gerar_* pode ter ajustado o caminho (extensão
 * auto-completada), então o caminho REAL vem daqui, não de argumentos.caminho. */
function caminhoCriadoDaSaida(saida) {
  return /^Arquivo criado: (.+?) \(/.exec(String(saida))?.[1] || null;
}

/** Tamanho a partir da mensagem de retorno — evita mais uma chamada IPC só
 * pra mostrar o tamanho no cartão. "Arquivo criado: x (3.2 KB)" ou
 * "Gravado 1234 bytes em x" (escrever_arquivo/acrescentar_ao_arquivo). */
function tamanhoDaSaida(saida) {
  const kb = /\(([\d.]+) KB\)/.exec(String(saida));
  if (kb) return Math.round(parseFloat(kb[1]) * 1024);
  const bytes = /Gravados? (\d+) bytes/.exec(String(saida));
  return bytes ? Number(bytes[1]) : null;
}

const el = {
  status: $('statusOllama'),
  modelo: $('modelo'),
  autonomia: $('autonomia'),
  iteracao: $('mIteracao'),
  max: $('mMax'),
  tokens: $('mTokens'),
  tempo: $('mTempo'),
  contexto: $('mContexto'),
  arvore: $('arvore'),
  caminho: $('caminhoWorkspace'),
  memTotal: $('memTotal'),
  aRolagem: $('agenteRolagem'),
  aMensagens: $('agenteMensagens'),
  aAbertura: $('agenteAbertura'),
  aEntrada: $('entradaAgente'),
  aEnviar: $('btnEnviarAgente'),
  aRodape: $('rodapeAgente'),
  cRolagem: $('conversaRolagem'),
  cMensagens: $('conversaMensagens'),
  cAbertura: $('conversaAbertura'),
  cEntrada: $('entradaChat'),
  cEnviar: $('btnEnviar'),
  cModelo: $('chatModelo'),
  lista: $('listaConversas'),
};

let arquivosConhecidos = new Set();
let abaAtual = 'agente';
/* ============================ anexos ============================ */

const anexos = { agente: [], chat: [] };

const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function pintarAnexos(modo) {
  const alvo = $(modo === 'agente' ? 'anexosAgente' : 'anexosChat');
  const lista = anexos[modo];
  alvo.innerHTML = '';
  if (!lista.length) return;

  lista.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = `anexo${a.erro ? ' falha' : ''}`;
    chip.title = a.erro || (a.relativo ? `copiado para a pasta de trabalho: ${a.relativo}` : `${kb(a.tamanho)}`);
    chip.innerHTML = `<span class="anexo-nome"></span><span class="anexo-tam"></span><button aria-label="Remover">✕</button>`;
    chip.querySelector('.anexo-nome').textContent = a.nome;
    chip.querySelector('.anexo-tam').textContent = a.erro ? 'erro' : kb(a.tamanho);
    chip.querySelector('button').addEventListener('click', () => {
      anexos[modo].splice(i, 1);
      pintarAnexos(modo);
    });
    alvo.appendChild(chip);
  });
}

async function anexar(modo) {
  const botao = $(modo === 'agente' ? 'btnAnexoAgente' : 'btnAnexoChat');
  botao.disabled = true;
  try {
    const r = await api.files.attach(modo);
    if (!r.ok) return;
    for (const arquivo of r.arquivos) {
      if (modo === 'chat' && !arquivo.ehTexto) {
        arquivo.erro = 'a aba Conversa só lê arquivos de texto — use a aba Agente para este formato';
      }
      anexos[modo].push(arquivo);
    }
    pintarAnexos(modo);
  } finally {
    botao.disabled = false;
  }
}

/** Monta o texto que vai junto da mensagem e limpa a fila. */
function consumirAnexos(modo) {
  const lista = anexos[modo].filter((a) => !a.erro);
  anexos[modo] = [];
  pintarAnexos(modo);
  if (!lista.length) return { rotulo: '', contexto: '' };

  const rotulo = lista.map((a) => a.nome).join(', ');

  if (modo === 'agente') {
    const linhas = lista.map((a) => `- ${a.relativo}${a.tamanho ? ` (${kb(a.tamanho)})` : ''}`).join('\n');
    return {
      rotulo,
      contexto: `\n\nArquivos anexados, já copiados para a pasta de trabalho:\n${linhas}\nUse ler_arquivo para abri-los.`,
    };
  }

  const blocos = lista
    .filter((a) => a.texto)
    .map((a) => `--- ${a.nome} ---\n${a.texto}${a.truncado ? '\n[…arquivo truncado]' : ''}`)
    .join('\n\n');
  return { rotulo, contexto: blocos ? `\n\nConteúdo dos arquivos anexados:\n\n${blocos}` : '' };
}

$('btnAnexoAgente').addEventListener('click', () => anexar('agente'));
$('btnAnexoChat').addEventListener('click', () => anexar('chat'));

/* ============================ turno do agente ============================ */

function criarTurno(pedido) {
  el.aAbertura.hidden = true;

  // Painel "Progresso" mostra o plano DESTE pedido — um plano velho de um
  // pedido anterior na mesma conversa ia confundir mais do que ajudar.
  // "Arquivos" não reseta aqui: acumula pela conversa inteira (ver
  // adicionarSaida/pintarSaidas), só zera em novaConversa/abrirConversa.
  agente.checklist = [];
  pintarProgresso();

  const meu = document.createElement('div');
  meu.className = 'msg eu';
  meu.innerHTML = '<div class="msg-quem">você</div><div class="msg-corpo"></div>';
  meu.querySelector('.msg-corpo').textContent = pedido;
  el.aMensagens.appendChild(meu);
  // Card "Parágrafos" — cada pergunta sua vira uma entrada clicável (pedido
  // do Davi, 2026-09-19). "—" é o placeholder de erro (sem modelo Ollama,
  // logo acima) — não é uma pergunta de verdade, não entra na lista.
  if (pedido !== '—') {
    registrarParagrafo(meu, pedido);
    pintarParagrafos();
  }

  const dele = document.createElement('div');
  dele.className = 'msg ia turno';
  dele.innerHTML = `
    <div class="msg-quem">agente</div>
    <div class="andamento">
      <span class="digitando"><i></i><i></i><i></i></span>
      <span class="andamento-txt">preparando…</span>
      <button class="btn-linha parar">parar</button>
    </div>
    <details class="detalhe">
      <summary><span class="resumo-passos">raciocínio</span></summary>
      <div class="trilha"></div>
    </details>
    <div class="msg-corpo resposta" hidden></div>`;
  el.aMensagens.appendChild(dele);

  const turno = {
    caixa: dele,
    andamento: dele.querySelector('.andamento'),
    texto: dele.querySelector('.andamento-txt'),
    detalhe: dele.querySelector('.detalhe'),
    resumoPassos: dele.querySelector('.resumo-passos'),
    trilha: dele.querySelector('.trilha'),
    resposta: dele.querySelector('.resposta'),
    noAtual: null,
    passos: 0,
    // arquivos criados nesta execução (gerar_docx/xlsx/pdf/html, escrever_arquivo,
    // acrescentar_ao_arquivo) — viram cartões de anexo abaixo da resposta final, em vez de
    // só serem escritos na pasta de trabalho sem nenhum aviso no chat.
    chamadasDeArquivo: {},
    arquivosGerados: [],
  };
  dele.querySelector('.parar').addEventListener('click', () => api.agent.stop());
  agente.turno = turno;
  rolar(el.aRolagem, true);
  return turno;
}

function situacao(texto) {
  if (agente.turno) agente.turno.texto.textContent = texto;
  el.aRodape.textContent = texto;
}

/** Nó numerado dentro da trilha do turno atual. */
function no(n) {
  const t = agente.turno;
  if (!t) return document.createElement('div');
  const existente = t.trilha.querySelector(`.no[data-n="${n}"]`);
  if (existente) return existente;
  t.trilha.querySelectorAll('.no.ativo').forEach((x) => x.classList.remove('ativo'));
  const node = document.createElement('div');
  node.className = 'no ativo';
  node.dataset.n = n;
  node.innerHTML = `<div class="marcador">${n}</div>`;
  t.trilha.appendChild(node);
  t.noAtual = node;
  t.passos = Math.max(t.passos, n);
  t.resumoPassos.textContent = `raciocínio · ${t.passos} passo${t.passos > 1 ? 's' : ''}`;
  return node;
}

function noSolto() {
  const t = agente.turno;
  if (!t) return document.createElement('div');
  const node = document.createElement('div');
  node.className = 'no';
  node.innerHTML = '<div class="marcador">·</div>';
  t.trilha.appendChild(node);
  return node;
}

function cartao(pai, classe, rotulo, html, tempo = '') {
  const div = document.createElement('div');
  div.className = `cartao ${classe}`;
  div.innerHTML = `<div class="rotulo">${rotulo}${tempo ? `<span class="tempo">${tempo}</span>` : ''}</div>${html}`;
  pai.appendChild(div);
  rolar(el.aRolagem);
  return div;
}

/** Abre o detalhe quando algo exige atenção do usuário. */
function abrirDetalhe() {
  if (agente.turno) agente.turno.detalhe.open = true;
}

function encerrarTurno() {
  agente.rodando = false;
  clearInterval(agente.cronometro);
  agente.cronometro = null;
  el.aEnviar.textContent = '↑';
  el.aEnviar.classList.remove('parando');
  el.aEntrada.disabled = false;
  if (agente.turno) {
    agente.turno.andamento.remove();
    agente.turno.trilha.querySelectorAll('.no.ativo').forEach((x) => x.classList.remove('ativo'));
  }
  el.aRodape.textContent = 'pronto';
}

/* ============================ lateral direita: progresso e arquivos ============================ */
// Fase 2 da reforma visual (pedido do Davi, 2026-09-18): "progress" = lista
// de tarefas do agente (checklist já existente, só ganhou widget próprio em
// vez de virar só uma linha de situação); "arquivos" = documentos gerados
// pelo agente OU anexados por você, nesta conversa. Escopo assumido: dura a
// sessão atual (agente.checklist/agente.saidas não são gravados em
// salvarConversa) — reabrir uma conversa antiga do histórico não traz de
// volta o que apareceria aqui.

function pintarProgresso() {
  const lista = $('progressoLista');
  const vazio = $('progressoVazio');
  const itens = agente.checklist;
  if (!itens.length) {
    lista.innerHTML = '';
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;
  lista.innerHTML = itens
    .map(
      (i) =>
        `<li class="progresso-item ${i.status}"><span class="progresso-marca"></span><span class="progresso-texto">${esc(
          i.texto
        )}</span></li>`
    )
    .join('');
}

/** Preenche uma das duas listas do card Arquivos (entrada/saída). Extraído
 * de pintarSaidas() pra não duplicar a montagem do <li> — pedido do Davi
 * (2026-09-19): separar input (o que você anexou) e output (o que o AuGPT
 * gerou) dentro do mesmo card, em vez de uma lista só misturada. */
function pintarListaDeSaidas(lista, itens) {
  lista.innerHTML = '';
  itens.forEach(({ caminho, tamanho, tipo }) => {
    const nome = caminho.split(/[/\\]/).pop();
    const ext = (nome.split('.').pop() || '').toUpperCase().slice(0, 4);
    const li = document.createElement('li');
    li.className = 'saida-item';
    li.innerHTML = `
      <span class="saida-icone">${esc(ext || '?')}</span>
      <span class="saida-info">
        <span class="saida-nome" title="${esc(caminho)}">${esc(nome)}</span>
        <span class="saida-meta">${tipo === 'anexado' ? 'anexado' : 'gerado'}${
      tamanho != null ? ` · ${kb(tamanho)}` : ''
    }</span>
      </span>`;
    li.addEventListener('click', () => abrirPreviaArquivo(caminho, nome));
    lista.appendChild(li);
  });
}

function pintarSaidas() {
  const itens = agente.saidas;
  pintarListaDeSaidas($('saidasListaEntrada'), itens.filter((i) => i.tipo === 'anexado'));
  pintarListaDeSaidas($('saidasListaSaida'), itens.filter((i) => i.tipo !== 'anexado'));
  $('saidasVazio').hidden = itens.length > 0;
}

/** Acrescenta (ou atualiza, se já existir) um arquivo na lista de saídas da
 * conversa atual. `tipo`: 'gerado' (ferramenta do agente) ou 'anexado' (você
 * anexou). Deduplicado por caminho — reenviar o mesmo arquivo não duplica a
 * linha, só atualiza o tamanho/tipo mostrado. */
function adicionarSaida({ caminho, tamanho, tipo }) {
  if (!caminho) return;
  const existente = agente.saidas.find((s) => s.caminho === caminho);
  if (existente) {
    existente.tamanho = tamanho;
    existente.tipo = tipo;
  } else {
    agente.saidas.push({ caminho, tamanho, tipo });
  }
  pintarSaidas();
}

/** Registra uma bolha "você" (elemento .msg.eu) como uma entrada do card
 * Parágrafos, dando a ela um id de âncora pra rolagem. Chamado tanto num
 * turno ao vivo (criarTurno) quanto ao reabrir uma conversa salva
 * (abrirConversa/restaurarTurno) — nos dois casos o elemento já existe no
 * DOM quando isto roda. */
function registrarParagrafo(elementoUsuario, texto) {
  const id = `paragrafo-${proximoIdParagrafo++}`;
  elementoUsuario.id = id;
  agente.paragrafos.push({ id, texto });
}

function pintarParagrafos() {
  const lista = $('paragrafosLista');
  const vazio = $('paragrafosVazio');
  const itens = agente.paragrafos;
  if (!itens.length) {
    lista.innerHTML = '';
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;
  lista.innerHTML = itens
    .map((p, i) => {
      const resumo = p.texto.length > 70 ? `${p.texto.slice(0, 70)}…` : p.texto;
      return `<li class="paragrafo-item" data-alvo="${esc(p.id)}"><span class="paragrafo-numero">${
        i + 1
      }</span><span class="paragrafo-texto" title="${esc(p.texto)}">${esc(resumo)}</span></li>`;
    })
    .join('');
}

$('paragrafosLista').addEventListener('click', (e) => {
  const li = e.target.closest('.paragrafo-item');
  if (!li) return;
  const alvo = document.getElementById(li.dataset.alvo);
  if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ====================== cards laterais (arrastar/ocultar) ====================== */

// Ordem e estado oculto dos cards da lateral direita (Progresso/Arquivos/
// Parágrafos) persistem entre sessões via localStorage do renderer — é a
// janela real do Electron, com disco persistente por trás, nada a ver com a
// restrição de localStorage em Artifacts renderizados em conversa. Pedido do
// Davi (2026-09-19): arrastar-e-soltar (drag-and-drop nativo) pra reordenar;
// ocultar vira um botão pequeno em #cardsReduzidos em vez de sumir de vez —
// "assim se clicar em cima eles abrem novamente".
const CHAVE_ESTADO_CARDS = 'augpt.cardsLaterais.v1';
let cardArrastado = null;

function lerEstadoCards() {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE_ESTADO_CARDS) || '{}');
    return {
      ordem: Array.isArray(dados.ordem) ? dados.ordem : [],
      ocultos: Array.isArray(dados.ocultos) ? dados.ocultos : [],
    };
  } catch {
    return { ordem: [], ocultos: [] };
  }
}

function salvarEstadoCards() {
  try {
    const cartoes = [...$('cardsColuna').children];
    localStorage.setItem(
      CHAVE_ESTADO_CARDS,
      JSON.stringify({
        ordem: cartoes.map((c) => c.dataset.card),
        ocultos: cartoes.filter((c) => c.hidden).map((c) => c.dataset.card),
      })
    );
  } catch {
    /* localStorage indisponível (perfil corrompido, disco cheio) — reordenar
       e ocultar ainda funcionam nesta sessão, só não persistem pra próxima
       vez que o AuGPT abrir. */
  }
}

function ocultarCard(card) {
  card.hidden = true;
  const titulo = card.querySelector('.card-titulo').textContent;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-reduzido';
  btn.dataset.card = card.dataset.card;
  btn.textContent = titulo;
  btn.title = `Reabrir ${titulo}`;
  btn.addEventListener('click', () => reexibirCard(card.dataset.card));
  $('cardsReduzidos').appendChild(btn);
  salvarEstadoCards();
}

function reexibirCard(id) {
  const card = $('cardsColuna').querySelector(`[data-card="${id}"]`);
  if (card) card.hidden = false;
  $('cardsReduzidos')
    .querySelector(`[data-card="${id}"]`)
    ?.remove();
  salvarEstadoCards();
}

function aoIniciarArrastoCard(e) {
  // draggable="true" fica só no cabeçalho (.card-cabecalho), não no card
  // inteiro — senão arrastar um item de dentro da lista (ex.: clicar e
  // arrastar levemente pra selecionar texto de um arquivo) also dispara
  // drag-and-drop do card. O elemento movido continua sendo o card inteiro.
  cardArrastado = e.currentTarget.closest('.card-flutuante');
  cardArrastado.classList.add('arrastando');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', cardArrastado.dataset.card);
}

function aoArrastarSobreCard(e) {
  if (!cardArrastado || cardArrastado === e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.classList.add('alvo-de-drop');
}

function aoSairDoCard(e) {
  e.currentTarget.classList.remove('alvo-de-drop');
}

function aoSoltarCard(e) {
  e.preventDefault();
  const alvo = e.currentTarget;
  alvo.classList.remove('alvo-de-drop');
  if (!cardArrastado || cardArrastado === alvo) return;
  const retangulo = alvo.getBoundingClientRect();
  const depoisDoAlvo = e.clientY > retangulo.top + retangulo.height / 2;
  alvo.parentElement.insertBefore(cardArrastado, depoisDoAlvo ? alvo.nextSibling : alvo);
  salvarEstadoCards();
}

function aoTerminarArrastoCard() {
  cardArrastado?.classList.remove('arrastando');
  cardArrastado = null;
}

function inicializarCardsLaterais() {
  const coluna = $('cardsColuna');
  const estado = lerEstadoCards();

  // Reordena conforme o que foi salvo — um card com id desconhecido (versão
  // nova do app que ainda não tinha sido aberta antes) fica na ordem padrão
  // do HTML, no fim.
  if (estado.ordem.length) {
    const porId = new Map([...coluna.children].map((c) => [c.dataset.card, c]));
    for (const id of estado.ordem) {
      const c = porId.get(id);
      if (c) coluna.appendChild(c);
    }
  }

  for (const card of coluna.children) {
    card.querySelector('[data-acao="ocultar"]').addEventListener('click', () => ocultarCard(card));
    const cabecalho = card.querySelector('.card-cabecalho');
    cabecalho.addEventListener('dragstart', aoIniciarArrastoCard);
    cabecalho.addEventListener('dragend', aoTerminarArrastoCard);
    card.addEventListener('dragover', aoArrastarSobreCard);
    card.addEventListener('dragleave', aoSairDoCard);
    card.addEventListener('drop', aoSoltarCard);
    if (estado.ocultos.includes(card.dataset.card)) ocultarCard(card);
  }
}

inicializarCardsLaterais();

/* ============================ eventos do agente ============================ */

// Rótulo do cartão de crítica por `fase` (ver Agent.criticaAutomatica em
// loop.js) — sem `fase` (crítica periódica de sempre, criticaDoPlano) cai no
// padrão "crítica ao plano", comportamento inalterado.
const ROTULO_FASE_CRITICA = {
  entendimento: 'crítica ao entendimento',
  'plano-inicial': 'crítica ao plano',
  'direcao-pesquisa': 'crítica à direção da pesquisa',
  'parte-concluida': 'crítica da parte concluída',
  'pre-redacao': 'crítica antes de redigir',
};

const manipuladores = {
  inicio({ objetivo, modelo }) {
    // Execução iniciada fora do envio normal (rotina automática disparando
    // sozinha): a UI nunca criou o turno antes de chamar api.agent.start,
    // então cria aqui — mesmo estado que enviarPedido() prepara na mão.
    if (!agente.rodando) {
      agente.rodando = true;
      el.aEntrada.disabled = true;
      el.aEnviar.textContent = '■';
      el.aEnviar.classList.add('parando');
      agente.conversa.push({ role: 'user', content: objetivo });
      criarTurno(objetivo);
    }
    agente.fontes = new Set();
    agente.inicio = Date.now();
    el.tokens.textContent = '0';
    el.iteracao.textContent = '0';
    el.contexto.textContent = '—'; // 1º valor real só chega na 1ª decisão (evento 'janela-contexto')
    clearInterval(agente.cronometro);
    agente.cronometro = setInterval(() => {
      const s = Math.floor((Date.now() - agente.inicio) / 1000);
      el.tempo.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
    }, 1000);
    situacao(`pensando · ${modelo}`);
  },

  iteracao({ n, de }) {
    el.iteracao.textContent = n;
    el.max.textContent = de;
    no(n);
    situacao(`passo ${n} de ${de}`);
  },

  pensando({ n }) {
    const alvo = no(n);
    if (!alvo.querySelector('.cartao.pensamento')) {
      cartao(alvo, 'pensamento provisorio', 'raciocinando', '<div class="digitando"><i></i><i></i><i></i></div>');
    }
    situacao('raciocinando…');
  },

  raciocinio({ n, pensamento, raciocinio, plano, critica }) {
    const alvo = no(n);
    alvo.querySelector('.cartao.provisorio')?.remove();
    cartao(
      alvo,
      'pensamento',
      'raciocínio',
      [
        pensamento ? `<p>${esc(pensamento)}</p>` : '',
        raciocinio ? `<p class="secundario">${esc(raciocinio)}</p>` : '',
        critica ? `<div class="critica"><b>risco</b><br>${esc(critica)}</div>` : '',
      ].join('')
    );
    if (pensamento) situacao(pensamento.slice(0, 70));
    if (plano?.length) {
      const t = agente.turno;
      if (t) {
        let caixa = t.caixa.querySelector('.plano-turno');
        if (!caixa) {
          caixa = document.createElement('ol');
          caixa.className = 'plano-turno';
          t.detalhe.before(caixa);
        }
        caixa.innerHTML = plano.slice(0, 6).map((p) => `<li>${esc(p)}</li>`).join('');
      }
    }
  },

  ferramenta({ n, nome, argumentos, risco }) {
    const args = Object.entries(argumentos || {})
      .map(([k, v]) => {
        const texto = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        return `<div class="arg"><dt>${esc(k)}</dt><dd>${esc(String(texto).slice(0, 4000))}</dd></div>`;
      })
      .join('');
    cartao(
      no(n),
      'acao',
      `ação<span class="selo ${esc(risco)}">${esc(risco)}</span>`,
      `<div class="assinatura"><span class="fn">${esc(nome)}</span>()</div>${args ? `<dl class="args">${args}</dl>` : ''}`
    );
    if (GERACOES_DE_ARQUIVO.includes(nome) && agente.turno) {
      agente.turno.chamadasDeArquivo[n] = { nome, argumentos };
    }
    situacao(`executando ${nome}`);
  },

  aprovacao({ id, nome, argumentos, risco, descricao, critica, permiteSempre, motivo }) {
    abrirDetalhe();
    situacao('aguardando sua confirmação');
    // Fase 1 de segurança (2026-09-23): o cartão mostra EXATAMENTE o que vai
    // rodar (o comando, o código, o arquivo, a URL) — antes só aparecia o
    // nome da ferramenta, e o usuário aprovava "executar_comando" sem ver o
    // comando. E "Sempre permitir" some pras ações que não aceitam
    // autorização permanente (`permiteSempre: false`, ver src/config.js).
    const detalhes = Object.entries(argumentos || {})
      .map(([k, v]) => {
        const texto = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        return `<div class="arg"><dt>${esc(k)}</dt><dd>${esc(String(texto).slice(0, 4000))}</dd></div>`;
      })
      .join('');
    const card = cartao(
      agente.turno?.noAtual || noSolto(),
      'aprovacao',
      `precisa da sua confirmação<span class="selo ${esc(risco)}">${esc(risco)}</span>`,
      `<p>Executar <b>${esc(nome)}</b>?</p><p class="secundario">${esc(descricao)}</p>
       ${motivo ? `<p class="critica-segunda-opiniao">⚠ ${esc(motivo)}</p>` : ''}
       ${detalhes ? `<dl class="args">${detalhes}</dl>` : ''}
       ${critica ? `<p class="critica-segunda-opiniao">⚠ segunda opinião: ${esc(critica)}</p>` : ''}
       <div class="acoes">
         <button class="btn-primario" data-d="aprovar">Executar</button>
         <button class="btn-secundario" data-d="negar">Recusar</button>
         ${permiteSempre === false ? '' : '<button class="btn-secundario" data-d="sempre">Sempre permitir</button>'}
       </div>`
    );
    // Pedido de Davi 2026-09-18 (plano das "2 IAs em paralelo"): o cartão
    // agora aparece SEM esperar a segunda opinião terminar — ela chega
    // depois, se der tempo, pelo evento 'aprovacao-critica' (ver
    // manipuladores['aprovacao-critica'] abaixo). O `data-id` é como aquele
    // handler encontra ESTE cartão específico pra anexar o texto.
    card.dataset.id = id;
    card.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', async () => {
        await api.agent.respond(id, b.dataset.d);
        card.classList.add('resolvido');
        card.querySelector('.acoes').innerHTML = `<span class="secundario">${
          b.dataset.d === 'negar' ? 'recusado' : 'autorizado'
        } · ${esc(nome)}</span>`;
        if (b.dataset.d === 'sempre') carregarConfig();
      })
    );
    rolar(el.aRolagem, true);
  },

  // Chega depois do cartão de aprovação, só quando a segunda opinião
  // (segundaOpiniao, em paralelo com o cartão desde o início) responde ANTES
  // de o usuário decidir — se o cartão já foi resolvido ('.resolvido') ou
  // nem existe mais na tela, não há mais nada pra anexar, ignora.
  'aprovacao-critica'({ id, critica }) {
    const card = el.aRolagem.querySelector(`.cartao.aprovacao[data-id="${id}"]`);
    if (!card || card.classList.contains('resolvido') || card.querySelector('.critica-segunda-opiniao')) return;
    const p = document.createElement('p');
    p.className = 'critica-segunda-opiniao';
    p.textContent = `⚠ segunda opinião: ${critica}`;
    card.querySelector('.secundario').after(p);
  },

  pergunta({ id, pergunta }) {
    abrirDetalhe();
    situacao('o agente fez uma pergunta');
    const card = cartao(
      agente.turno?.noAtual || noSolto(),
      'pergunta',
      'o agente perguntou',
      `<p>${esc(pergunta)}</p>
       <div class="resposta-campo"><input type="text" placeholder="Sua resposta" /><button class="btn-primario">Responder</button></div>`
    );
    const input = card.querySelector('input');
    const enviar = async () => {
      const valor = input.value.trim();
      if (!valor) return;
      await api.agent.respond(id, valor);
      card.classList.add('resolvido');
      card.querySelector('.resposta-campo').innerHTML = `<span class="secundario">você: ${esc(valor)}</span>`;
    };
    card.querySelector('button').addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && enviar());
    input.focus();
    rolar(el.aRolagem, true);
  },

  resultado({ n, nome, saida, erro, duracao }) {
    const texto = erro || saida || '(sem saída)';
    const card = cartao(
      no(n),
      `saida${erro ? ' falha' : ''}`,
      erro ? `falhou · ${esc(nome)}` : `resultado · ${esc(nome)}`,
      `<pre>${esc(texto)}</pre>`,
      ms(duracao)
    );
    if (texto.length > 900) {
      const btn = document.createElement('button');
      btn.className = 'expandir';
      btn.textContent = 'mostrar tudo';
      btn.addEventListener('click', () => {
        card.classList.toggle('aberto');
        btn.textContent = card.classList.contains('aberto') ? 'recolher' : 'mostrar tudo';
      });
      card.appendChild(btn);
    }

    const pendente = agente.turno?.chamadasDeArquivo[n];
    if (pendente && !erro) {
      const caminho = caminhoCriadoDaSaida(saida) || pendente.argumentos?.caminho;
      if (caminho) agente.turno.arquivosGerados.push({ caminho, tamanho: tamanhoDaSaida(saida) });
    }

    carregarMemoria();
    // consultar_critico pode ter acabado de carregar o modelo dedicado do
    // Copiloto — atualiza o indicador na hora, sem esperar o polling de 20s.
    if (nome === 'consultar_critico') carregarStatusCopiloto();
  },

  skills({ etapa, nomes }) {
    const t = agente.turno;
    if (!t || !nomes.length) return;
    t.skillsVistas = t.skillsVistas || new Set();
    const novas = nomes.filter((n) => !t.skillsVistas.has(`${etapa}:${n}`));
    novas.forEach((n) => t.skillsVistas.add(`${etapa}:${n}`));
    if (!novas.length) return;

    let faixa = t.caixa.querySelector('.skills-ativas');
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.className = 'skills-ativas';
      faixa.innerHTML = '<span class="rotulo-skill">skills</span>';
      t.detalhe.before(faixa);
    }
    for (const nome of novas) {
      const selo = document.createElement('span');
      selo.className = 'selo-skill';
      selo.textContent = nome;
      selo.title = `Ativada na etapa de ${etapa}`;
      faixa.appendChild(selo);
    }
  },

  cobertura({ nivel, encontrados, total, ausentes }) {
    const t = agente.turno;
    if (!t || nivel === 'boa') return;
    const faixa = document.createElement('div');
    faixa.className = `cobertura ${nivel}`;
    faixa.innerHTML =
      nivel === 'ausente'
        ? '<b>a busca não trouxe material sobre isto</b> — respondendo com conhecimento próprio do modelo'
        : `<b>material cobre parte do pedido</b> (${encontrados} de ${total} termos)${
            ausentes?.length ? ` — sem cobertura: ${esc(ausentes.slice(0, 4).join(', '))}` : ''
          }`;
    t.resposta.before(faixa);
  },

  redigindo({ fontes }) {
    const t = agente.turno;
    if (!t) return;
    situacao(`redigindo a resposta a partir de ${fontes} fonte(s)…`);
    t.detalhe.open = false;
    t.resposta.hidden = false;
    t.buffer = '';
    t.resposta.innerHTML = '<span class="cursor"></span>';
    rolar(el.aRolagem, true);
  },

  'resposta-token'({ pedaco }) {
    const t = agente.turno;
    if (!t) return;
    t.buffer = (t.buffer || '') + pedaco;
    t.resposta.innerHTML = `${window.md.render(t.buffer)}<span class="cursor"></span>`;
    rolar(el.aRolagem);
  },

  // Caso real (Davi, 2026-09-18): o sistema de verificação pós-resposta
  // (verificador.verificar/reescrever, src/agent/loop.js) pode descartar e
  // reescrever a resposta uma ou mais vezes antes de aceitar o resultado
  // final — sempre existiu, mas o evento não vinha com NENHUMA explicação,
  // então pro usuário parecia um glitch ("para de escrever, apaga tudo e
  // começa de novo") em vez de um comportamento intencional. `motivo` (novo,
  // opcional) deixa isso visível: mantém o cursor piscando mas mostra POR QUE
  // está reescrevendo, na mesma barra de situação usada pelo resto do fluxo.
  'resposta-reinicia'({ motivo } = {}) {
    const t = agente.turno;
    if (!t) return;
    t.buffer = '';
    t.resposta.innerHTML = motivo
      ? `<p class="secundario resposta-revisao"><span class="cursor"></span> ${esc(motivo)}</p>`
      : '<span class="cursor"></span>';
    if (motivo) situacao(motivo);
  },

  fonte({ tipo, provedor, url, falhas }) {
    if (url) agente.fontes.add(url);
    const alvo = agente.turno?.noAtual;
    if (!alvo) return;
    let caixa = alvo.querySelector('.fontes');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'fontes';
      alvo.appendChild(caixa);
    }
    const span = document.createElement('span');
    span.className = 'fonte-selo';
    span.textContent = tipo === 'busca' ? `busca: ${provedor}` : `leitura: ${provedor}`;
    span.title = url || (falhas?.length ? `reservas acionadas — ${falhas.join(' | ')}` : '');
    caixa.appendChild(span);
  },

  negado({ n, nome }) {
    cartao(no(n), 'aviso', 'recusado', `<p class="secundario">${esc(nome)} não foi executado.</p>`);
  },

  'protocolo-invalido'({ estado, motivo, bruto }) {
    const rotulos = {
      'json-invalido': 'JSON inválido',
      'protocolo-invalido': 'fora do protocolo',
      'ferramenta-invalida': 'ferramenta inexistente',
      'argumentos-invalidos': 'argumentos incompletos',
    };
    cartao(
      agente.turno?.noAtual || noSolto(),
      'aviso tecnico', // escondido fora do modo "detalhes técnicos" (ver aplicarPreferenciasDeTela)
      rotulos[estado] || 'resposta fora do protocolo',
      `<p class="secundario">${esc(motivo || '')}</p>${
        bruto ? `<pre class="secundario">${esc(bruto.slice(0, 300))}</pre>` : ''
      }`
    );
  },

  'protocolo-recuperado'({ via, ferramenta }) {
    const alvo = agente.turno?.noAtual;
    if (!alvo) return;
    const selo = document.createElement('span');
    selo.className = 'fonte-selo tecnico';
    selo.textContent = `recuperado: ${via}`;
    selo.title = `A decisão veio mal formada e foi convertida em ${ferramenta} sem gastar uma rodada`;
    let caixa = alvo.querySelector('.fontes');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'fontes';
      alvo.appendChild(caixa);
    }
    caixa.appendChild(selo);
  },

  compactado({ n, mensagens }) {
    cartao(no(n), 'aviso tecnico', 'contexto compactado', `<p class="secundario">${mensagens} mensagens viraram resumo.</p>`);
  },

  aviso({ texto }) {
    // o mesmo aviso pode disparar a cada passo; mostrar uma vez por turno basta
    const t = agente.turno;
    if (!t) return;
    t.avisos = t.avisos || new Set();
    const chave = texto.slice(0, 60);
    if (t.avisos.has(chave)) return;
    t.avisos.add(chave);

    const dica = /nomic-embed-text/.test(texto)
      ? '<p class="secundario">Rode <code>ollama pull nomic-embed-text</code> para ativar a memória vetorial.</p>'
      : '';
    cartao(noSolto(), 'aviso', 'aviso', `<p class="secundario">${esc(texto)}</p>${dica}`);
  },

  // Controlador v2: avisos técnicos curtos (uma vez por turno, como aviso)
  'limite-atingido'({ iteracoes }) {
    manipuladores.aviso({ texto: `Chegou ao limite de ${iteracoes || ''} passos — a resposta vem com o que foi reunido até aqui.`.replace('de  passos', 'de passos') });
  },
  'contexto-saturado'() {
    manipuladores.aviso({ texto: 'O histórico encheu a janela de contexto do modelo; partes antigas foram cortadas. Se as respostas piorarem, aumente o contexto em Ajustes.' });
  },
  'contexto-ajustado'() {},
  // Revisão v4: download do navegador dentro da pasta de trabalho vira anexo
  // (mesmo cartão dos arquivos gerados); fora dela, só o aviso com o caminho
  'download-concluido'({ nome, caminho, relativo, bytes }) {
    const t = agente.turno;
    if (t && relativo) t.arquivosGerados.push({ caminho: relativo, tamanho: bytes || null });
    else manipuladores.aviso({ texto: `Arquivo baixado pelo navegador: ${nome}${caminho ? ` — salvo em ${caminho}` : ''}` });
  },
  'critica-por-evento'() {},

  uso({ prompt, completion }) {
    el.tokens.textContent = (prompt + completion).toLocaleString('pt-BR');
  },

  // Item 2 da análise comparativa (2026-09-21, "indicador de uso de
  // contexto"): percentual real do último passo, não acumulado (ver
  // comentário em src/agent/loop.js sobre a diferença com o evento 'uso').
  'janela-contexto'({ percentual }) {
    el.contexto.textContent = percentual == null ? '—' : `${percentual}%`;
  },

  concluido({ resumo, iteracoes }) {
    const t = agente.turno;
    encerrarTurno();
    agente.conversa.push({ role: 'assistant', content: resumo });
    salvarConversa('agente');
    if (!t) return;
    t.resposta.hidden = false;
    t.resposta.innerHTML = window.md.render(resumo); // troca o texto em streaming pelo definitivo
    window.md.montarGraficos(t.resposta);
    // Painel "Arquivos" da lateral direita (fase 2 da reforma visual) —
    // mesmos dados do cartão de anexo abaixo, só que acumulados pela
    // conversa inteira em vez de só este turno.
    t.arquivosGerados.forEach((a) => adicionarSaida({ caminho: a.caminho, tamanho: a.tamanho, tipo: 'gerado' }));
    if (t.arquivosGerados.length) renderizarAnexosGerados(t.resposta, t.arquivosGerados);
    if (agente.fontes.size) {
      const rodape = document.createElement('p');
      rodape.className = 'secundario meta-turno';
      rodape.textContent = `${iteracoes} passos · ${agente.fontes.size} fonte(s)`;
      t.resposta.appendChild(rodape);
    }
    carregarArvore(true);
    carregarMemoria();
    rolar(el.aRolagem, true);
  },

  limite({ iteracoes }) {
    const t = agente.turno;
    encerrarTurno();
    agente.conversa.push({ role: 'assistant', content: `_(parou em ${iteracoes} passos sem concluir)_` });
    salvarConversa('agente');
    if (!t) return;
    t.resposta.hidden = false;
    t.resposta.innerHTML = `<p>Parei em ${iteracoes} passos sem concluir.</p><p class="secundario">Aumente o limite em Ajustes ou peça algo mais específico.</p>`;
    t.arquivosGerados.forEach((a) => adicionarSaida({ caminho: a.caminho, tamanho: a.tamanho, tipo: 'gerado' }));
    if (t.arquivosGerados.length) renderizarAnexosGerados(t.resposta, t.arquivosGerados);
  },

  interrompido({ iteracoes }) {
    const t = agente.turno;
    encerrarTurno();
    if (!t) return;
    t.resposta.hidden = false;
    t.resposta.innerHTML = `<p class="secundario">Interrompido por você após ${iteracoes} passos.</p>`;
    t.arquivosGerados.forEach((a) => adicionarSaida({ caminho: a.caminho, tamanho: a.tamanho, tipo: 'gerado' }));
    if (t.arquivosGerados.length) renderizarAnexosGerados(t.resposta, t.arquivosGerados);
  },

  erro({ mensagem, amigavel }) {
    const t = agente.turno;
    encerrarTurno();
    if (!t) {
      criarTurno('—');
      encerrarTurno();
    }
    const alvo = agente.turno;
    alvo.resposta.hidden = false;
    alvo.caixa.classList.add('erro');
    // Fase 2 (facilidade de uso): quando o processo principal reconhece o
    // erro (src/primeiro-uso.js, mensagemAmigavel), mostra a frase que diz o
    // que fazer e deixa o texto técnico original logo abaixo, menor.
    alvo.resposta.textContent = amigavel || mensagem;
    if (amigavel && mensagem && amigavel !== mensagem) {
      const detalhe = document.createElement('div');
      detalhe.className = 'erro-detalhe';
      detalhe.textContent = `detalhe técnico: ${mensagem}`;
      alvo.resposta.appendChild(detalhe);
    }
    if (/Ollama|modelo/i.test(amigavel || mensagem || '')) atualizarPrimeiroUso();
    rolar(el.aRolagem, true);
  },

  lacunas({ nivel, encontrados, total, ausentes }) {
    const t = agente.turno;
    if (!t) return;
    situacao(
      nivel === 'boa'
        ? `material suficiente (${encontrados}/${total} termos cobertos)`
        : `faltam dados: ${(ausentes || []).slice(0, 3).join(', ')}`
    );
  },

  // Lista de tarefas com estado (ver reconciliarChecklist em loop.js). Além
  // do resumo compacto na linha de situação (já existia), agora também
  // alimenta o painel "Progresso" da lateral direita (fase 2 da reforma
  // visual) — pintarProgresso() lê agente.checklist.
  checklist(lista) {
    const t = agente.turno;
    if (!t || !Array.isArray(lista) || !lista.length) return;
    agente.checklist = lista;
    pintarProgresso();
    const feitos = lista.filter((i) => i.status === 'feito').length;
    const pendentes = lista.filter((i) => i.status === 'pendente').map((i) => i.texto);
    situacao(
      `plano: ${feitos}/${lista.length} concluído(s)` +
        (pendentes.length ? ` · a fazer: ${pendentes.slice(0, 2).join(', ')}` : '')
    );
  },

  // Entendimento (pedido de Davi 2026-09-14, "apertar as rédeas": mostrar
  // que o agente entendeu o pedido antes de agir) — só dispara quando
  // verificarAmbiguidade de fato reescreveu o objetivo resolvendo uma
  // referência à conversa anterior ("faz de novo aquilo", ver o comentário
  // em loop.js/run()); num pedido novo e autossuficiente não há nada pra
  // mostrar aqui, e o cartão não aparece — menos ruído, não mais.
  // Modo AUTO (10/10): qual nível o pedido ganhou, logo no começo
  'nivel-auto'({ nivel, nome, motivo }) {
    cartao(noSolto(), 'entendimento', `modo auto · nível ${nivel}`, `<p><b>${esc(nome || '')}</b> — ${esc(motivo || '')}</p>`);
  },
  'auto-correcao'({ fato, de, para }) {
    cartao(noSolto(), 'entendimento', 'número conferido', `<p>${esc(fato)}: ${esc(de)} → <b>${esc(para)}</b> (pela ficha da Wikipédia)</p>`);
  },

  'objetivo-reescrito'({ reescrito }) {
    cartao(noSolto(), 'entendimento', 'entendi que você quer', `<p>${esc(reescrito)}</p>`);
  },

  // Subagente crítico (crítica periódica do plano, ver criticaDoPlano em
  // loop.js) OU um dos 4 checkpoints automáticos do Copiloto (ver
  // criticaAutomatica — `fase` distingue qual: entendimento/plano-inicial,
  // antes de qualquer passo numerado, viram cartão avulso; parte-concluida/
  // pre-redacao, e a crítica periódica de sempre sem `fase` nenhuma, ficam
  // presas ao passo em que dispararam) — questiona o rumo geral, não uma
  // ação específica; some da situação e vira um cartão, pra ficar claro que
  // é uma observação de fora do que decidiu.
  'critica-plano'({ n, texto, fase }) {
    situacao(`revisão do plano: ${texto.slice(0, 90)}`);
    const rotulo = ROTULO_FASE_CRITICA[fase] || 'crítica ao plano';
    const pai = fase === 'entendimento' || fase === 'plano-inicial' ? noSolto() : no(n);
    cartao(pai, 'critica-plano', rotulo, `<p>${esc(texto)}</p>`);
    // `fase` só vem preenchida nos checkpoints automáticos (criticaAutomatica
    // em loop.js) — atualiza o contador do badge na hora, mesmo padrão já
    // usado pra 'consultar_critico' em manipuladores.resultado, acima.
    if (fase) carregarStatusCopiloto();
  },

  // Criação automática de skills (item 5) — dispara em segundo plano, pode
  // chegar bem depois do turno que a motivou já ter terminado. Um cartão
  // avulso (não preso a um passo numerado) avisa; a revisão de verdade
  // acontece na aba Skills → Sugestões, nunca sozinha.
  'skill-sugerida'(dados) {
    const passou = dados?.autoteste?.passou;
    cartao(
      noSolto(),
      'skill-sugerida',
      'skill sugerida',
      `<p>O agente notou um pedido repetido sem skill cobrindo e propôs <b>${esc(dados?.nome || dados?.rascunho?.nome || 'uma skill nova')}</b> — ${
        passou ? 'passou no autoteste que ele mesmo rodou' : 'NÃO passou no autoteste que ele mesmo rodou'
      }. Revise em Skills → Sugestões antes de qualquer coisa entrar em uso.</p>`
    );
    if (!$('painelSugestoes').hidden) carregarSugestoes();
  },

  // Progresso da instalação do SearXNG embutido (ver aba Ajustes) — atualiza
  // só o texto de status; não é um evento do agente, mas passa pelo mesmo
  // canal genérico já usado por todos os outros eventos.
  'runtime-searxng-progresso'({ fase }) {
    const alvo = $('sxStatus');
    if (alvo) alvo.textContent = FASES_SX_EMBUTIDO[fase] || fase;
  },

  // Oferta de início automático do Ollama — dispara quando uma checagem de
  // saúde (início ou o polling de 20s) detecta o Ollama desligado com o
  // binário instalado (ver ipcMain.handle('ollama:health', ...),
  // electron/main.js). Mesmo canal genérico de sempre, evento avulso, não
  // preso a nenhuma execução do agente.
  'ollama-oferecer-inicio'() {
    mostrarFaixaOllama();
  },

  // Progresso do download de um modelo (ollama.pullModel) — mesmo padrão do
  // progresso do SearXNG embutido acima, formato de linha diferente
  // ({status, total, completed}).
  'ollama-pull-progresso'(dados) {
    if (primeiroUso.baixando) pintarProgressoPrimeiroUso(dados);
    else pintarProgressoBaixarModelo(dados);
  },

  'fonte-marcada'({ url, risco, motivo }) {
    const alvo = agente.turno?.noAtual;
    if (!alvo) return;
    let caixa = alvo.querySelector('.fontes');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'fontes';
      alvo.appendChild(caixa);
    }
    const selo = document.createElement('span');
    selo.className = `fonte-selo alerta${risco === 'satira' ? ' satira' : ''}`;
    selo.textContent = risco === 'satira' ? 'sátira' : 'fonte de baixa credibilidade';
    selo.title = `${motivo} — ${url}`;
    caixa.appendChild(selo);
  },

  confianca({ nivel, motivos }) {
    const t = agente.turno;
    if (!t) return;
    const faixa = document.createElement('div');
    faixa.className = `confianca ${nivel === 'alta' ? 'alta' : nivel === 'média' ? 'media' : 'baixa'}`;
    faixa.innerHTML = `<b>confiança ${esc(nivel)}</b>${
      motivos.length ? ` — ${esc(motivos.join('; '))}` : ' — material cobre o pedido e há corroboração entre fontes'
    }`;
    t.resposta.appendChild(faixa);
  },

  confronto(c) {
    const t = agente.turno;
    if (!t || !c.suficiente) return;
    const faixa = document.createElement('div');
    faixa.className = `verificacao ${c.divergencias.length ? 'alerta' : 'ok'}`;
    const partes = [`<b>${c.dominios}</b> fontes cruzadas · ${c.confirmados.length} dado(s) confirmado(s) por mais de uma`];
    for (const d of c.divergencias.slice(0, 3)) {
      partes.push(
        `divergência em ${esc(d.unidade)}: <code>${esc(d.a.texto)}</code> em ${d.a.dominios.length} fontes, ` +
          `<code>${esc(d.b.texto)}</code> em ${esc(d.b.dominios[0])}`
      );
    }
    faixa.innerHTML = `${partes.join(' · ')}<span class="verif-nota">confronto entre fontes</span>`;
    t.resposta.appendChild(faixa);
  },

  verificacao(v) {
    const t = agente.turno;
    if (!t) return;
    t.caixa.querySelector('.verificacao')?.remove();
    if (v.aprovado || v.semMaterial) return;

    const faixa = document.createElement('div');
    faixa.className = `verificacao ${v.totalSuspeitas ? 'alerta' : 'ok'}`;
    const partes = [];
    if (!v.respondeAoPedido) partes.push('a resposta pode não tratar do que foi perguntado');
    if (v.totalSuspeitas) {
      partes.push(
        `<b>${v.totalSuspeitas} de ${v.totalAfirmacoes}</b> valores não foram encontrados nas fontes: ` +
          v.suspeitas.map((sp) => `<code>${esc(sp.valor)}</code>`).join(' ')
      );
    }
    faixa.innerHTML = `${partes.join(' · ')}<span class="verif-nota">verificação automática — confira antes de usar</span>`;
    t.resposta.appendChild(faixa);
  },

  registro({ id, resumo }) {
    const t = agente.turno;
    if (!t) return;
    const linha = document.createElement('div');
    linha.className = 'resumo-execucao';
    linha.innerHTML = `
      <span>${resumo.passos} passos · ${resumo.ferramentas} ferramentas · ${resumo.fontes} fontes · ${(
      resumo.duracaoMs / 1000
    ).toFixed(1)}s · ${resumo.tokens.toLocaleString('pt-BR')} tokens${
      resumo.erros ? ` · <b class="ruim">${resumo.erros} erros</b>` : ''
    }</span>
      <button class="btn-linha">relatório</button>`;
    linha.querySelector('button').addEventListener('click', () => {
      trocarAba('execucoes');
      abrirRelatorio(id);
    });
    t.resposta.appendChild(linha);
  },

  // Motor de pesquisa (src/agent/motor-pesquisa.js, 2026-09-24): em pedido
  // de recomendação/comparação, o plano de pesquisa, as opções encontradas e
  // a matriz opção × critério viram cartões na trilha — é o "porquê" da
  // comparação, visível antes da resposta chegar.
  // Cadeia do uso (2026-09-28): do pedido até o que decide, e os critérios com o porquê
  'pesquisa-cadeia'({ atividade = '', tipoDeUso = '', exige = [] }) {
    situacao('pesquisa planejada: pensando no uso antes de buscar');
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'raciocínio do uso',
      `<p class="pp-nota">${esc(atividade)} → ${esc(tipoDeUso)}</p>${
        exige.length ? `<ul class="pp-lista">${exige.map((x) => `<li>${esc(x.o)}${x.porque ? ` — ${esc(x.porque)}` : ''}</li>`).join('')}</ul>` : ''
      }`
    );
  },

  'pesquisa-criterios'({ tipoDeUso = '', criterios = [], fontes = [] }) {
    cartao(
      noSolto(),
      'pesquisa-planejada',
      `o que decide em ${tipoDeUso || 'este uso'}`,
      `<ul class="pp-lista">${criterios
        .map((k) => `<li><strong>${esc(k.nome)}</strong> (${esc(k.peso)})${k.porque ? ` — ${esc(k.porque)}` : ''}</li>`)
        .join('')}</ul>${fontes.length ? `<p class="pp-nota">de: ${esc(fontes.join(', '))}</p>` : ''}`
    );
  },

  // Fase B da pesquisa pela comunidade: o que o agente pensou antes de
  // pesquisar, e depois o que o material disse de cada hipótese
  'pesquisa-mapa'({ decide = [], elimina = [], alternativas = [], hipoteses = [] }) {
    situacao('pesquisa planejada: pensando no problema antes de buscar');
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'mapa do problema',
      `${decide.length ? `<p class="pp-nota">o que decide: ${esc(decide.map((d) => d.fator).join(', '))}</p>` : ''}${
        elimina.length ? `<p class="pp-nota">o uso não tolera: ${esc(elimina.map((d) => d.fator).join('; '))}</p>` : ''
      }${
        hipoteses.length ? `<p>hipóteses a conferir:</p><ul class="pp-lista">${hipoteses.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''
      }${alternativas.length ? `<p class="pp-nota">alternativas a considerar: ${esc(alternativas.map((a) => a.nome).join('; '))}</p>` : ''}`
    );
  },

  // Evidência → Dados → Análise (2026-09-27): o que o código extraiu e calculou
  'serie-de-precos'({ produtos = [], observacoes = 0, moeda = null, meses = [], medias = [], grafico = false }) {
    const moedaTxt = moeda === 'BRL' ? 'R$' : moeda === 'USD' ? 'US$' : '';
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'série de preços (calculada pelo código)',
      observacoes && meses.length
        ? `<p class="pp-nota">${esc(String(observacoes))} preço(s) com data em ${esc(String(meses.length))} mês(es) · ${esc(produtos.join(', '))}${grafico ? ' · gráfico montado' : ''}</p><ul class="pp-lista">${medias
            .map((m) => `<li>${esc(m.produto)}: ${m.n ? `média ${esc(moedaTxt)} ${esc(Number(m.media).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))} (${esc(String(m.n))} obs.)` : 'sem preço datado'}</li>`)
            .join('')}</ul>`
        : '<p class="pp-nota">nenhum preço com data encontrado nas páginas lidas</p>'
    );
  },

  'contrato-incompleto'({ itens = [] }) {
    cartao(noSolto(), 'pesquisa-planejada', 'o que ficou faltando', `<ul class="pp-lista">${itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  },

  'pesquisa-hipoteses'({ hipoteses = [] }) {
    const marca = { confirmada: '✓ confirmada', derrubada: '✗ derrubada', 'sem dados': '? sem dados' };
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'hipóteses conferidas',
      `<ul class="pp-lista">${hipoteses
        .map((h) => `<li>${esc(h.hipotese)} <span class="pp-peso">${esc(marca[h.veredito] || h.veredito)}</span></li>`)
        .join('')}</ul>`
    );
  },

  'pesquisa-plano'({ uso, criterios = [], opcoesCitadas = [] }) {
    situacao('pesquisa planejada: critérios definidos, buscando as opções');
    const lista = criterios
      .map((c) => `<li>${esc(c.nome)} <span class="pp-peso">${c.peso === 'alto' ? 'peso alto' : c.peso === 'baixo' ? 'peso baixo' : 'peso médio'}</span></li>`)
      .join('');
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'plano de pesquisa',
      `<p>${esc(uso)}</p><ul class="pp-lista">${lista}</ul>${
        opcoesCitadas.length ? `<p class="pp-nota">opções citadas por você: ${esc(opcoesCitadas.join(', '))}</p>` : ''
      }`
    );
  },

  'pesquisa-candidatos'({ finalistas = [], outros = [], descartados = 0 }) {
    // Fase C: quantas conversas da comunidade recomendam, e por quê
    const contagem = (f) =>
      `${f.topicos ? `${f.topicos} tópico${f.topicos === 1 ? '' : 's'} · ` : ''}${f.sites} site${f.sites === 1 ? '' : 's'}`;
    const html = finalistas.length
      ? `<ul class="pp-lista">${finalistas
          .map(
            (f) =>
              `<li>${esc(f.nome)} <span class="pp-peso">${contagem(f)}</span>${
                f.motivo ? `<br><span class="pp-nota">“${esc(f.motivo.slice(0, 140))}”</span>` : ''
              }</li>`
          )
          .join('')}</ul>${outros.length ? `<p class="pp-nota">também citadas: ${esc(outros.join(', '))}</p>` : ''}${
          descartados ? `<p class="pp-nota tecnico">${descartados} nome(s) sugerido(s) pelo modelo não estavam no material e foram descartados</p>` : ''
        }`
      : '<p>o material não apontou opções concretas o bastante para comparar</p>';
    cartao(noSolto(), 'pesquisa-planejada', 'opções encontradas', html);
  },

  'pesquisa-matriz'({ cobertura = 0, buscas = 0, lacunas = [], descartadas = [], resumos = [] }) {
    situacao(`pesquisa planejada: ${Math.round(cobertura * 100)}% da comparação com evidência`);
    const faltas = lacunas.slice(0, 4).map((l) => `${l.criterio} de ${l.candidato}`);
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'comparação montada',
      `<p><b>${Math.round(cobertura * 100)}%</b> das combinações opção × critério têm evidência · ${buscas} busca(s)</p>${
        faltas.length ? `<p class="pp-nota">sem evidência: ${esc(faltas.join('; '))}${lacunas.length > 4 ? '…' : ''}</p>` : ''
      }${
        // julgamento das células (motor-pesquisa.js): trecho que citava a opção mas não falava daquele critério
        descartadas.length ? `<p class="pp-nota tecnico">${descartadas.length} trecho(s) descartado(s) por não falar da opção naquele critério</p>` : ''
      }${
        // pesquisa por produto: de quais opções achou ficha técnica e opinião da comunidade
        resumos.length
          ? `<p class="pp-nota">${resumos
              .map((r) => `${esc(r.opcao)}: ficha ${r.ficha ? '✓' : '—'} · comunidade ${r.comunidade ? '✓' : '—'}`)
              .join('<br>')}</p>`
          : ''
      }`
    );
  },

  'workspace-changed'() {
    carregarArvore(true);
  },

  'config-alterada'() {
    carregarConfig();
  },

  'agendamento-pulado'({ texto }) {
    situacao(`rotina automática pulada (agente ocupado): ${texto.slice(0, 60)}`);
  },
};

api.onEvent(({ canal, dados }) => manipuladores[canal]?.(dados || {}));

/* ====================== encerramento (checklist de IAs) ====================== */
/**
 * Pedido de Davi 2026-09-14: ao clicar em fechar o AuGPT, antes de fechar de
 * verdade, um checklist visível mostra cada IA carregada (GPU/CPU) sendo
 * descarregada (ver encerrarModelosEFechar, electron/main.js). Overlay
 * simples, criado na hora — não precisa existir em index.html porque só
 * aparece nos poucos segundos entre clicar em fechar e a janela sumir.
 */
function mostrarEncerrando({ modelos }) {
  let overlay = $('encerrandoOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'encerrandoOverlay';
    overlay.className = 'encerrando-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="encerrando-caixa">
      <h2>Encerrando o AuGPT…</h2>
      <p class="secundario">Descarregando as IAs em memória antes de fechar, pra liberar os recursos do PC.</p>
      <ul class="encerrando-lista">
        ${modelos
          .map(
            (m) =>
              `<li data-modelo="${esc(m.nome)}"><span class="ponto"></span>${esc(m.nome)} <span class="secundario">(${
                m.gpu ? 'GPU' : 'CPU'
              })</span></li>`
          )
          .join('')}
      </ul>
    </div>`;
  overlay.classList.add('visivel');
}

function marcarModeloEncerrado({ nome, ok }) {
  const item = $('encerrandoOverlay')?.querySelector(`li[data-modelo="${CSS.escape(nome)}"]`);
  item?.classList.add(ok ? 'feito' : 'falhou');
}

api.sistema?.onEncerrando(({ fase, modelos, nome, ok }) => {
  if (fase === 'inicio') mostrarEncerrando({ modelos: modelos || [] });
  else if (fase === 'progresso') marcarModeloEncerrado({ nome, ok });
});

/* ============================ enviar pedido ao agente ============================ */

async function enviarPedido() {
  if (agente.rodando) {
    await api.agent.stop();
    return;
  }
  const pedido = el.aEntrada.value.trim();
  if (!pedido) return;
  if (!el.modelo.value) {
    // Fase 2: antes mandava rodar "ollama pull" num terminal — mesmo com o
    // Ollama nem instalado. Agora aponta pro guia de primeira execução, que
    // sabe exatamente qual passo falta e faz o download pelo próprio app.
    criarTurno(pedido);
    manipuladores.erro({
      mensagem: 'Ainda não há um modelo de IA pronto pra usar. Siga os passos de "Antes de começar" na tela inicial do Agente (botão Nova conversa) — o AuGPT mostra o que falta e baixa o modelo pra você.',
    });
    atualizarPrimeiroUso();
    return;
  }

  // Snapshot antes de consumirAnexos('agente') zerar a fila — precisamos dos
  // itens individuais (caminho na pasta de trabalho) pro painel "Arquivos" da
  // lateral direita, que consumirAnexos não devolve (só o rótulo/contexto
  // pro prompt).
  const anexosParaPainel = anexos.agente.filter((a) => !a.erro && a.relativo);
  const { rotulo, contexto } = consumirAnexos('agente');
  const pedidoCompleto = pedido + contexto;

  el.aEntrada.value = '';
  autoAltura(el.aEntrada);
  el.aEntrada.disabled = true;
  el.aEnviar.textContent = '■';
  el.aEnviar.classList.add('parando');
  agente.rodando = true;

  const turno = criarTurno(pedido);
  if (rotulo) {
    const marca = document.createElement('div');
    marca.className = 'anexos-enviados';
    marca.textContent = `anexos: ${rotulo}`;
    turno.caixa.previousElementSibling.querySelector('.msg-corpo').appendChild(marca);
  }
  anexosParaPainel.forEach((a) => adicionarSaida({ caminho: a.relativo, tamanho: a.tamanho, tipo: 'anexado' }));
  agente.conversa.push({ role: 'user', content: pedidoCompleto });

  const r = await api.agent.start(pedidoCompleto, agente.conversa.slice(0, -1), agente.idConversa);
  if (!r.ok) manipuladores.erro({ mensagem: r.error, amigavel: r.amigavel });
}

el.aEnviar.addEventListener('click', enviarPedido);
el.aEntrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarPedido();
  }
});
el.aEntrada.addEventListener('input', () => autoAltura(el.aEntrada));

for (const alvo of [el.aMensagens, el.aAbertura]) {
  alvo.addEventListener('click', (e) => {
    const li = e.target.closest('.exemplos li');
    if (!li) return;
    el.aEntrada.value = li.textContent.trim();
    autoAltura(el.aEntrada);
    el.aEntrada.focus();
  });
}

/* ============================ abas ============================ */

// Nomes exibidos no rótulo da seção atual (#secaoAtual, barra superior) —
// mesmas chaves de ABAS abaixo.
const ROTULOS_ABAS = {
  agente: 'Agente',
  conversa: 'Conversa',
  skills: 'Skills',
  execucoes: 'Execuções',
  config: 'Ajustes',
};

// Navegação principal — pedido do Davi (2026-09-18): as abas que ficavam no
// topo se mudaram pra uma lista de ícones na lateral esquerda (#navPrincipal,
// renderer/index.html), junto da lista de conversas. `aba` aqui aponta pro
// item de navegação correspondente (mesmo papel que o antigo botão de aba).
const ABAS = {
  agente: { view: 'viewAgente', aba: 'navAgente' },
  conversa: { view: 'viewConversa', aba: 'navConversa' },
  skills: { view: 'viewSkills', aba: 'navSkills' },
  execucoes: { view: 'viewExecucoes', aba: 'navExecucoes' },
  config: { view: 'viewConfig', aba: 'navConfig' },
};

function trocarAba(qual) {
  abaAtual = qual;
  for (const [nome, ref] of Object.entries(ABAS)) {
    $(ref.view).hidden = nome !== qual;
    if (ref.aba) {
      $(ref.aba).classList.toggle('ativo', nome === qual);
      $(ref.aba).setAttribute('aria-selected', String(nome === qual));
    }
  }
  $('secaoAtual').textContent = ROTULOS_ABAS[qual] || '';

  // A lateral (navegação + lista de conversas) fica sempre visível agora,
  // em qualquer seção — antes só aparecia em Agente/Conversa (mesmo espírito
  // do Claude/Cowork: dá pra trocar de conversa mesmo estando em Skills ou
  // Ajustes, sem precisar voltar primeiro).
  const comLateral = qual === 'agente' || qual === 'conversa';
  $('campoAutonomia').hidden = qual !== 'agente';
  $('campoNivelRaciocinio').hidden = qual !== 'agente';

  // Lateral direita ("Progresso"/"Arquivos", fase 2 da reforma visual) só
  // faz sentido na aba Agente — checklist e arquivos gerados por ferramenta
  // não existem na aba Conversa (só pergunta/resposta direta ao modelo, sem
  // agente nem ferramentas).
  $('lateralDireita').hidden = qual !== 'agente';

  if (comLateral) {
    historico.filtro = '';
    $('buscaConversa').value = '';
    pintarConversas();
  }

  if (qual === 'conversa') {
    el.cModelo.textContent = config.model || 'nenhum modelo';
    el.cEntrada.focus();
  } else if (qual === 'skills') {
    if (!$('painelFerramentas').hidden) carregarFerramentas();
    else if (!$('painelSugestoes').hidden) carregarSugestoes();
    else carregarSkills();
  } else if (qual === 'execucoes') {
    carregarExecucoes();
  } else if (qual === 'config') {
    preencherConfig();
    carregarArvore();
    carregarMemoria();
    carregarDominios();
    carregarAgendamentos();
    carregarEstadoSearxngRuntime();
    carregarRecomendacaoHardware();
  } else {
    el.aEntrada.focus();
  }
}

$('navAgente').addEventListener('click', () => trocarAba('agente'));
$('navConversa').addEventListener('click', () => trocarAba('conversa'));
$('navSkills').addEventListener('click', () => trocarAba('skills'));
$('navExecucoes').addEventListener('click', () => trocarAba('execucoes'));
// Fase 2: clicar em Ajustes estando em Ajustes não pula mais pro Agente
// (parecia que o botão "fechava" a página sem motivo).
$('navConfig').addEventListener('click', () => trocarAba('config'));

/* ============================ conversa (chat puro) ============================ */

function bolha(quem, conteudo, classe = '') {
  el.cAbertura.hidden = true;
  const div = document.createElement('div');
  div.className = `msg ${quem === 'user' ? 'eu' : 'ia'} ${classe}`;
  div.innerHTML = `<div class="msg-quem">${quem === 'user' ? 'você' : 'assistente'}</div><div class="msg-corpo"></div>`;
  const corpo = div.querySelector('.msg-corpo');
  if (quem === 'user') corpo.textContent = conteudo;
  else {
    corpo.innerHTML = window.md.render(conteudo);
    window.md.montarGraficos(corpo);
  }
  el.cMensagens.appendChild(div);
  return corpo;
}

api.chat.onToken(({ id, pedaco }) => {
  if (id !== chat.idAtual || !chat.alvo) return;
  chat.buffer += pedaco;
  chat.alvo.innerHTML = `${window.md.render(chat.buffer)}<span class="cursor"></span>`;
  rolar(el.cRolagem);
});

async function enviarMensagem() {
  if (chat.ocupado) {
    await api.chat.stop();
    return;
  }
  const texto = el.cEntrada.value.trim();
  if (!texto) return;
  if (!config.model) {
    bolha('assistant', 'Ainda não há um modelo de IA pronto. Abra a aba Agente: a tela inicial mostra o que falta e baixa o modelo pra você.', 'erro');
    return;
  }

  const { rotulo, contexto } = consumirAnexos('chat');

  el.cEntrada.value = '';
  autoAltura(el.cEntrada);
  const corpoUsuario = bolha('user', texto);
  if (rotulo) {
    const marca = document.createElement('div');
    marca.className = 'anexos-enviados';
    marca.textContent = `anexos: ${rotulo}`;
    corpoUsuario.appendChild(marca);
  }
  chat.historico.push({ role: 'user', content: texto + contexto });

  chat.ocupado = true;
  chat.buffer = '';
  chat.idAtual = `c${Date.now()}`;
  chat.alvo = bolha('assistant', '');
  chat.alvo.innerHTML = '<span class="cursor"></span>';
  el.cEnviar.textContent = '■';
  el.cEnviar.classList.add('parando');
  rolar(el.cRolagem, true);

  const r = await api.chat.send(chat.idAtual, chat.historico);

  if (r.ok) {
    chat.alvo.innerHTML = window.md.render(r.conteudo);
    window.md.montarGraficos(chat.alvo);
    chat.historico.push({ role: 'assistant', content: r.conteudo });
  } else if (r.interrompido) {
    chat.alvo.innerHTML = window.md.render(chat.buffer || '_(interrompido)_');
    window.md.montarGraficos(chat.alvo);
    if (chat.buffer) chat.historico.push({ role: 'assistant', content: chat.buffer });
  } else {
    chat.alvo.closest('.msg').classList.add('erro');
    // Fase 2: frase que diz o que fazer, com o texto técnico junto (ver manipuladores.erro)
    chat.alvo.textContent = r.amigavel ? `${r.amigavel}\n\ndetalhe técnico: ${r.error}` : r.error;
    chat.historico.pop();
  }

  chat.ocupado = false;
  chat.alvo = null;
  el.cEnviar.textContent = '↑';
  el.cEnviar.classList.remove('parando');
  rolar(el.cRolagem);
  salvarConversa('conversa');
}

el.cEnviar.addEventListener('click', enviarMensagem);
el.cEntrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarMensagem();
  }
});
el.cEntrada.addEventListener('input', () => autoAltura(el.cEntrada));

document.addEventListener('click', (e) => {
  if (e.target.closest('a[data-externo]')) e.preventDefault();
});

/* ============================ painel lateral ============================ */

function aplicarLateral(aberta) {
  document.body.classList.toggle('sem-lateral', !aberta);
  const btn = $('btnLateral');
  btn.classList.toggle('fechado', !aberta);
  btn.title = aberta ? 'Ocultar painel (Ctrl+B)' : 'Mostrar painel (Ctrl+B)';
  btn.setAttribute('aria-expanded', String(aberta));
}

async function alternarLateral() {
  const aberta = document.body.classList.contains('sem-lateral');
  aplicarLateral(aberta);
  config = await api.config.set({ lateralAberta: aberta });
}

$('btnLateral').addEventListener('click', alternarLateral);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    alternarLateral();
  }
  if (e.key === 'Escape') {
    fecharMenu();
    if (historico.modoSelecao) sairDaSelecao();
  }
});

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
  $('cfgMotorPesquisa').checked = config.motorDePesquisa !== false;
  $('cfgRoteadorDecisor').checked = config.roteadorDecisor === true;
  $('cfgModoAuto').checked = config.modoAuto !== false;
  $('cfgAutoModeloRapido').value = config.autoModeloRapido || '';
  $('cfgAutoModeloProfundo').value = config.autoModeloProfundo || '';
  $('cfgModeloDecisor').value = config.modeloDecisor || 'tev1';
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

$('btnSalvarConfig').addEventListener('click', async (e) => {
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
    motorDePesquisa: $('cfgMotorPesquisa').checked,
    roteadorDecisor: $('cfgRoteadorDecisor').checked,
    modoAuto: $('cfgModoAuto').checked,
    autoModeloRapido: $('cfgAutoModeloRapido').value.trim(),
    autoModeloProfundo: $('cfgAutoModeloProfundo').value.trim(),
    modeloDecisor: $('cfgModeloDecisor').value.trim() || 'tev1',
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
  const botao = e.currentTarget;
  botao.textContent = 'Salvo ✓';
  setTimeout(() => (botao.textContent = 'Salvar'), 1600);
  verificarOllama();
  if (config.usarSearxngEmbutido) await api.searxngRuntime.iniciar();
  else await api.searxngRuntime.parar();
  carregarEstadoSearxngRuntime();
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
  const escolhido = models.find((m) => m.name === anterior)?.name || models[0]?.name || '';
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
    $('bmNome')?.scrollIntoView({ block: 'center' });
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

// Mesma tabela do guia de primeira execução (src/primeiro-uso.js,
// MODELOS_POR_MEMORIA), agora pela memória TOTAL do computador — antes era a
// livre, que sub-reporta (cache conta como usado) e fazia o 8B aparecer como
// "não cabe" em máquina de 16 GB. Fase 2, 2026-09-23.
const MODELOS_SUGERIDOS = [
  { nome: 'llama3.2:3b', rotulo: 'Llama 3.2 3B', memoriaGB: 8 },
  { nome: 'llama3.1:8b', rotulo: 'Llama 3.1 8B', memoriaGB: 16 },
  { nome: 'qwen2.5:14b', rotulo: 'Qwen 2.5 14B', memoriaGB: 32 },
];

let recomendacaoHardware = null;

async function carregarRecomendacaoHardware() {
  try {
    recomendacaoHardware = await api.hardware.recomendacao();
  } catch {
    recomendacaoHardware = null;
  }
  pintarRecomendacaoCopiloto();
  pintarSugestoesModelos();
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

function pintarSugestoesModelos() {
  const alvo = $('bmSugestoes');
  if (!alvo) return;
  const ramTotal = recomendacaoHardware?.hardware?.ramTotalGB ?? null;
  const sugerido = primeiroUso.diagnostico?.recomendado?.nome || null;
  alvo.innerHTML = MODELOS_SUGERIDOS.map((m) => {
    // ~5% de folga: 16 GB físicos aparecem como 15,6 GB pro sistema
    const cabe = ramTotal == null || ramTotal >= m.memoriaGB * 0.95;
    const destaque = sugerido ? m.nome === sugerido : cabe;
    const nota = !cabe ? `pede ${m.memoriaGB} GB de memória` : destaque ? 'recomendado' : 'cabe neste computador';
    return `<button type="button" class="bm-sugestao${destaque ? ' recomendado' : ''}" data-nome="${esc(m.nome)}">${esc(
      m.rotulo
    )}<small>${nota}</small></button>`;
  }).join('');
  alvo.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      $('bmNome').value = b.dataset.nome;
    })
  );
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
  const btn = $('btnBmBaixar');
  btn.disabled = true;
  $('bmStatus').textContent = 'iniciando…';
  $('bmProgresso').hidden = false;
  $('bmProgressoBarra').style.width = '0%';
  const r = await api.ollama.pull(nome);
  btn.disabled = false;
  $('bmProgresso').hidden = true;
  if (r.ok) {
    $('bmStatus').textContent = `"${nome}" instalado.`;
    $('bmNome').value = '';
    await carregarModelos();
    pintarModelosDeEtapa(); // atualiza também o seletor do modelo dedicado do Copiloto
  } else {
    $('bmStatus').textContent = `erro: ${r.error}`;
  }
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

/* ============================ início ============================ */

(async function iniciar() {
  await carregarConfig();
  await verificarOllama();
  await carregarConversas();
  await carregarMemoria();
  autoAltura(el.aEntrada);
  autoAltura(el.cEntrada);
  el.aEntrada.focus();
  setInterval(verificarOllama, 20000);
})();

/* ============================ conversas salvas ============================ */

const historico = { itens: [], selecao: new Set(), modoSelecao: false, filtro: '' };

function modoDaAba() {
  return abaAtual === 'conversa' ? 'conversa' : 'agente';
}

async function carregarConversas() {
  historico.itens = await api.chats.list();
  pintarConversas();
}

function pintarConversas() {
  const modo = modoDaAba();
  const filtro = historico.filtro.toLowerCase();
  const visiveis = historico.itens
    .filter((c) => c.modo === modo)
    .filter((c) => !filtro || c.titulo.toLowerCase().includes(filtro));

  el.lista.innerHTML = '';
  if (!visiveis.length) {
    el.lista.innerHTML = `<li class="vazio-lista">${
      historico.filtro ? 'Nada encontrado.' : 'Nenhuma conversa ainda.'
    }</li>`;
    return;
  }

  const idAtivo = modo === 'agente' ? agente.idConversa : chat.idConversa;

  for (const c of visiveis) {
    const li = document.createElement('li');
    li.className = `item-conversa${c.id === idAtivo ? ' ativa' : ''}${
      historico.selecao.has(c.id) ? ' marcada' : ''
    }`;
    li.dataset.id = c.id;
    li.innerHTML = `
      ${historico.modoSelecao ? `<input type="checkbox" class="marcador" ${historico.selecao.has(c.id) ? 'checked' : ''} />` : ''}
      <div class="item-texto">
        <span class="item-titulo"></span>
        <span class="item-meta">${quando(c.atualizadoEm)} · ${c.trocas} ${c.trocas === 1 ? 'troca' : 'trocas'}</span>
      </div>
      <button class="tres-pontos" title="Opções" aria-label="Opções">⋯</button>`;
    li.querySelector('.item-titulo').textContent = c.titulo;

    li.querySelector('.tres-pontos').addEventListener('click', (e) => {
      e.stopPropagation();
      abrirMenu(c, e.currentTarget);
    });

    li.querySelector('.marcador')?.addEventListener('click', (e) => {
      e.stopPropagation();
      alternarSelecao(c.id);
    });

    li.addEventListener('click', () => {
      if (historico.modoSelecao) alternarSelecao(c.id);
      else abrirConversa(c.id);
    });

    el.lista.appendChild(li);
  }
}

function alternarSelecao(id) {
  if (historico.selecao.has(id)) historico.selecao.delete(id);
  else historico.selecao.add(id);
  $('contagemSelecao').textContent = `${historico.selecao.size} selecionada${historico.selecao.size === 1 ? '' : 's'}`;
  pintarConversas();
}

function entrarEmSelecao(idInicial) {
  historico.modoSelecao = true;
  historico.selecao.clear();
  if (idInicial) historico.selecao.add(idInicial);
  $('barraSelecao').hidden = false;
  $('contagemSelecao').textContent = `${historico.selecao.size} selecionada${historico.selecao.size === 1 ? '' : 's'}`;
  pintarConversas();
}

function sairDaSelecao() {
  historico.modoSelecao = false;
  historico.selecao.clear();
  $('barraSelecao').hidden = true;
  pintarConversas();
}

/* menu de três pontos */

let menuAlvo = null;

function abrirMenu(conversa, botao) {
  const menu = $('menuConversa');
  menuAlvo = conversa;
  menu.hidden = false;
  const r = botao.getBoundingClientRect();
  const altura = menu.offsetHeight || 190;
  menu.style.left = `${Math.min(r.left, window.innerWidth - 210)}px`;
  menu.style.top = `${r.bottom + altura > window.innerHeight ? r.top - altura - 4 : r.bottom + 4}px`;
}

function fecharMenu() {
  $('menuConversa').hidden = true;
  menuAlvo = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#menuConversa') && !e.target.closest('.tres-pontos')) fecharMenu();
});

$('menuConversa').addEventListener('click', async (e) => {
  const acao = e.target.closest('button')?.dataset.acao;
  if (!acao || !menuAlvo) return;
  const alvo = menuAlvo;
  fecharMenu();

  if (acao === 'abrir') return abrirConversa(alvo.id);
  if (acao === 'selecionar') return entrarEmSelecao(alvo.id);
  if (acao === 'exportar') return void api.chats.export(alvo.id);

  // Item 2 da análise comparativa (2026-09-21, "comando manual de
  // compactação"): funde agora os turnos fora da janela dos últimos 6, sem
  // esperar a próxima execução — mesmo mecanismo automático de sempre (ver
  // 'janela-contexto' e IPC chats:compact), só que sob demanda.
  if (acao === 'compactar') {
    const r = await api.chats.compact(alvo.id);
    if (!r.ok) return alert(`Não foi possível compactar: ${r.error}`);
    return alert(r.compactou ? 'Conversa compactada.' : 'Nada novo pra compactar — já está tudo dentro da janela recente.');
  }

  if (acao === 'renomear') {
    const novo = prompt('Novo título:', alvo.titulo);
    if (novo?.trim()) {
      await api.chats.rename(alvo.id, novo.trim());
      await carregarConversas();
    }
    return;
  }

  if (acao === 'excluir') {
    if (!confirm(`Excluir "${alvo.titulo}"? Isso não pode ser desfeito.`)) return;
    await api.chats.remove(alvo.id);
    if (agente.idConversa === alvo.id) novaConversa('agente');
    if (chat.idConversa === alvo.id) novaConversa('conversa');
    await carregarConversas();
  }
});

$('btnExcluirSelecionadas').addEventListener('click', async () => {
  const ids = [...historico.selecao];
  if (!ids.length) return;
  if (!confirm(`Excluir ${ids.length} conversa(s)? Isso não pode ser desfeito.`)) return;
  await api.chats.remove(ids);
  if (ids.includes(agente.idConversa)) novaConversa('agente');
  if (ids.includes(chat.idConversa)) novaConversa('conversa');
  sairDaSelecao();
  await carregarConversas();
});

$('btnCancelarSelecao').addEventListener('click', sairDaSelecao);
$('btnSelecionar').addEventListener('click', () => (historico.modoSelecao ? sairDaSelecao() : entrarEmSelecao()));

$('buscaConversa').addEventListener('input', (e) => {
  historico.filtro = e.target.value.trim();
  pintarConversas();
});

/* abrir e criar */

async function abrirConversa(id) {
  const conversa = await api.chats.read(id);
  if (!conversa) return;

  if (conversa.modo === 'conversa') {
    trocarAba('conversa');
    chat.idConversa = conversa.id;
    chat.historico = conversa.mensagens.map(({ role, content }) => ({ role, content }));
    el.cMensagens.innerHTML = '';
    el.cAbertura.hidden = true;
    for (const m of conversa.mensagens) bolha(m.role === 'user' ? 'user' : 'assistant', m.content);
    $('tituloConversaChat').textContent = conversa.titulo;
    rolar(el.cRolagem, true);
  } else {
    trocarAba('agente');
    if (agente.rodando) await api.agent.stop();
    agente.idConversa = conversa.id;
    agente.conversa = conversa.mensagens.map(({ role, content }) => ({ role, content }));
    el.aMensagens.innerHTML = '';
    el.aAbertura.hidden = true;
    // Progresso/arquivos da lateral direita não são persistidos (ver
    // pintarProgresso/pintarSaidas acima) — reabrir uma conversa antiga
    // sempre volta com os dois painéis vazios, não é o histórico de quando
    // ela rodou. "Parágrafos" é diferente: o texto de cada turno JÁ está
    // sendo reconstruído aqui embaixo (restaurarTurno), então dá pra
    // reancorar nele — zera e deixa restaurarTurno repopular.
    agente.checklist = [];
    agente.saidas = [];
    agente.paragrafos = [];
    for (const m of conversa.mensagens) restaurarTurno(m);
    $('tituloConversaAgente').textContent = conversa.titulo;
    pintarProgresso();
    pintarSaidas();
    pintarParagrafos();
    rolar(el.aRolagem, true);
  }
  pintarConversas();
}

/** Reconstrói a bolha de uma conversa salva. O raciocínio não é guardado. */
function restaurarTurno(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'eu' : 'ia'}`;
  div.innerHTML = `<div class="msg-quem">${m.role === 'user' ? 'você' : 'agente'}</div><div class="msg-corpo"></div>`;
  const corpo = div.querySelector('.msg-corpo');
  if (m.role === 'user') {
    corpo.textContent = m.content;
    registrarParagrafo(div, m.content);
  } else {
    corpo.innerHTML = window.md.render(m.content);
    window.md.montarGraficos(corpo);
  }
  el.aMensagens.appendChild(div);
}

function novaConversa(modo = modoDaAba()) {
  if (modo === 'conversa') {
    chat.idConversa = null;
    chat.historico = [];
    el.cMensagens.innerHTML = '';
    el.cAbertura.hidden = false;
    $('tituloConversaChat').textContent = '';
    el.cEntrada.focus();
  } else {
    agente.idConversa = null;
    agente.conversa = [];
    el.aMensagens.innerHTML = '';
    el.aAbertura.hidden = false;
    $('tituloConversaAgente').textContent = '';
    agente.checklist = [];
    agente.saidas = [];
    agente.paragrafos = [];
    pintarProgresso();
    pintarSaidas();
    pintarParagrafos();
    el.aEntrada.focus();
  }
  pintarConversas();
}

$('btnNovaConversa').addEventListener('click', async () => {
  if (modoDaAba() === 'agente' && agente.rodando) await api.agent.stop();
  if (modoDaAba() === 'conversa' && chat.ocupado) await api.chat.stop();
  novaConversa();
});

/** Grava o estado atual. Chamado ao fim de cada turno. */
async function salvarConversa(modo) {
  const mensagens = modo === 'conversa' ? chat.historico : agente.conversa;
  if (!mensagens.length) return;
  const gravada = await api.chats.save({
    id: modo === 'conversa' ? chat.idConversa : agente.idConversa,
    modo,
    mensagens,
  });
  if (modo === 'conversa') {
    chat.idConversa = gravada.id;
    $('tituloConversaChat').textContent = gravada.titulo;
  } else {
    agente.idConversa = gravada.id;
    $('tituloConversaAgente').textContent = gravada.titulo;
  }
  await carregarConversas();
}
const RISCOS = { baixo: 'lê apenas', medio: 'modifica arquivos', alto: 'executa ou apaga' };

function cartaoFerramenta(f) {
  const div = document.createElement('article');
  div.className = `skill ${f.ativa ? '' : 'inativa'}`;
  const args = Object.entries(f.args || {});
  div.innerHTML = `
    <div class="skill-topo">
      <div class="skill-titulo">
        <h3><code>${esc(f.name)}</code></h3>
        <span class="selo ${esc(f.risk)}">${esc(f.risk)}</span>
        ${
          f.origem === 'nucleo'
            ? ''
            : `<span class="origem ${f.origem === 'sua' ? 'sua' : ''}${f.origem === 'mcp' ? ' mcp' : ''}">${
                f.origem === 'mcp' ? `MCP · ${esc(f.servidor)}` : esc(f.origem)
              }</span>`
        }
        ${f.essencial ? '<span class="origem sempre">essencial</span>' : ''}
        ${f.disponivel ? '' : '<span class="origem falta">dependência faltando</span>'}
      </div>
      <label class="interruptor" title="${f.essencial ? 'não pode ser desativada' : f.ativa ? 'Desativar' : 'Ativar'}">
        <input type="checkbox" ${f.ativa ? 'checked' : ''} ${f.essencial ? 'disabled' : ''} />
        <i></i>
      </label>
    </div>
    <p class="skill-desc">${esc(f.description)}</p>
    ${
      f.disponivel
        ? f.requer?.length
          ? `<div class="deps ok">requer ${f.requer.map((d) => `<code>${esc(d)}</code>`).join(' ')} — tudo presente</div>`
          : ''
        : `<div class="deps falta">Falta: ${f.faltando
            .map((d) => `<code>${esc(d.nome)}</code>`)
            .join(' ')}<br>Instale com <code>${esc(f.faltando[0]?.instalar || '')}</code> e clique em Recarregar.</div>`
    }
    ${
      args.length
        ? `<dl class="args-ferramenta">${args
            .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
            .join('')}</dl>`
        : ''
    }
    <div class="skill-rodape">
      <span class="skill-meta">${esc(RISCOS[f.risk] || '')}${f.arquivo ? ' · arquivo externo' : ''}</span>
      ${f.arquivo ? '<button class="btn-linha ver">mostrar arquivo</button>' : ''}
    </div>`;

  if (!f.disponivel) div.classList.add('indisponivel');
  const caixa = div.querySelector('input');
  if (!f.essencial) {
    caixa.addEventListener('change', async (e) => {
      config = await api.tools.toggle(f.name, e.target.checked);
      div.classList.toggle('inativa', !e.target.checked);
    });
  }
  div.querySelector('.ver')?.addEventListener('click', () => api.tools.openFile(f.name));
  return div;
}

const mcpEstado = { servidores: [] };

async function carregarMcp() {
  const { servidores, estado, problemas } = await api.mcp.list();
  mcpEstado.servidores = servidores;
  $('mcpTotal').textContent = servidores.length;

  const alvo = $('mcpLista');
  alvo.innerHTML = '';
  if (!servidores.length) {
    alvo.innerHTML = '<p class="dica">Nenhum servidor configurado.</p>';
  }

  for (const [i, s] of servidores.entries()) {
    const vivo = estado.find((e) => e.nome === s.nome);
    const problema = problemas.find((p) => p.startsWith(`${s.nome}:`));
    const div = document.createElement('div');
    div.className = `mcp-item${vivo?.conectado ? ' conectado' : problema ? ' falho' : ''}`;
    div.innerHTML = `
      <div class="mcp-info">
        <span class="mcp-nome"></span>
        <span class="mcp-cmd"></span>
        <span class="mcp-status">${
          vivo?.conectado
            ? `conectado · ${vivo.ferramentas} ferramenta(s) · ${esc(vivo.servidor || '')}`
            : problema
              ? esc(problema.replace(`${s.nome}: `, '').slice(0, 90))
              : 'desligado'
        }</span>
      </div>
      <label class="interruptor" title="${s.ativo === false ? 'Ativar' : 'Desativar'}">
        <input type="checkbox" ${s.ativo === false ? '' : 'checked'} /><i></i>
      </label>
      <button class="btn-linha" title="Remover">✕</button>`;
    div.querySelector('.mcp-nome').textContent = s.nome;
    div.querySelector('.mcp-cmd').textContent = `${s.comando} ${(s.argumentos || []).join(' ')}`.trim();

    div.querySelector('input').addEventListener('change', async (e) => {
      mcpEstado.servidores[i].ativo = e.target.checked;
      await api.mcp.save(mcpEstado.servidores);
      carregarMcp();
      carregarFerramentas();
    });
    div.querySelector('.btn-linha').addEventListener('click', async () => {
      if (!confirm(`Remover o servidor "${s.nome}"?`)) return;
      mcpEstado.servidores.splice(i, 1);
      await api.mcp.save(mcpEstado.servidores);
      carregarMcp();
      carregarFerramentas();
    });
    alvo.appendChild(div);
  }
}

function lerFormularioMcp() {
  const nome = $('mcpNome').value.trim();
  const comando = $('mcpComando').value.trim();
  if (!nome || !comando) return null;
  return {
    nome,
    comando,
    argumentos: $('mcpArgs').value.trim().split(/\s+/).filter(Boolean),
    ativo: true,
  };
}

$('btnTestarMcp').addEventListener('click', async () => {
  const servidor = lerFormularioMcp();
  const alvo = $('mcpResultado');
  if (!servidor) {
    alvo.innerHTML = '<span class="ruim">informe ao menos nome e comando</span>';
    return;
  }
  alvo.textContent = 'testando…';
  const r = await api.mcp.test(servidor);
  alvo.innerHTML = r.ok
    ? `<b>conectou</b> — ${esc(r.servidor || servidor.nome)} · ${r.ferramentas} ferramenta(s): ${r.nomes
        .map((n) => `<code>${esc(n)}</code>`)
        .join(' ')}`
    : `<span class="ruim">falhou — ${esc(r.erro)}</span>`;
});

$('btnAddMcp').addEventListener('click', async () => {
  const servidor = lerFormularioMcp();
  if (!servidor) return;
  mcpEstado.servidores.push(servidor);
  await api.mcp.save(mcpEstado.servidores);
  $('mcpNome').value = '';
  $('mcpComando').value = '';
  $('mcpArgs').value = '';
  $('mcpResultado').textContent = '';
  carregarMcp();
  carregarFerramentas();
});

$('btnReconectarMcp').addEventListener('click', async () => {
  $('mcpResultado').textContent = 'reconectando…';
  const r = await api.mcp.reconnect();
  $('mcpResultado').innerHTML = `${r.ferramentas} ferramenta(s) registrada(s)${
    r.problemas.length ? ` · <span class="ruim">${esc(r.problemas.join(' | '))}</span>` : ''
  }`;
  carregarMcp();
  carregarFerramentas();
});

async function carregarFerramentas() {
  const { ferramentas, problemas } = await api.tools.list();
  const lista = $('ferramentasLista');
  lista.innerHTML = '';

  const alerta = $('problemasFerramentas');
  alerta.innerHTML = problemas?.length
    ? `<b>${problemas.length} arquivo(s) com problema</b><br>${problemas.map((p) => esc(p)).join('<br>')}`
    : '';
  alerta.hidden = !problemas?.length;

  carregarMcp();
  const ordem = { nucleo: 0, embutida: 1, sua: 2, mcp: 3 };
  ferramentas
    .sort((a, b) => (ordem[a.origem] ?? 9) - (ordem[b.origem] ?? 9) || a.name.localeCompare(b.name))
    .forEach((f) => lista.appendChild(cartaoFerramenta(f)));
}

function trocarSubAba(qual) {
  $('painelSkills').hidden = qual !== 'skills';
  $('painelSugestoes').hidden = qual !== 'sugestoes';
  $('painelFerramentas').hidden = qual !== 'ferramentas';
  $('subSkills').classList.toggle('ativa', qual === 'skills');
  $('subSugestoes').classList.toggle('ativa', qual === 'sugestoes');
  $('subFerramentas').classList.toggle('ativa', qual === 'ferramentas');
  if (qual === 'ferramentas') carregarFerramentas();
  else if (qual === 'sugestoes') carregarSugestoes();
  else carregarSkills();
}

$('subSkills').addEventListener('click', () => trocarSubAba('skills'));
$('subSugestoes').addEventListener('click', () => trocarSubAba('sugestoes'));
$('subFerramentas').addEventListener('click', () => trocarSubAba('ferramentas'));
$('btnAbrirFerramentas').addEventListener('click', () => api.tools.openFolder());
$('btnRecarregarFerramentas').addEventListener('click', async () => {
  const r = await api.tools.reload();
  await carregarFerramentas();
  if (r.problemas?.length) $('problemasFerramentas').hidden = false;
});

/**
 * Cartão de uma skill. A função tinha se perdido na reescrita do renderer, e
 * `carregarSkills` chamava algo que não existia — por isso a aba abria vazia.
 */
function cartaoSkill(skill) {
  const div = document.createElement('article');
  div.className = `skill ${skill.ativa ? '' : 'inativa'}`;
  div.innerHTML = `
    <div class="skill-topo">
      <div class="skill-titulo">
        <h3></h3>
        <span class="origem ${skill.origem === 'sua' ? 'sua' : ''}">${skill.origem === 'sua' ? 'sua' : 'embutida'}</span>
        ${skill.sempre ? '<span class="origem sempre">sempre ativa</span>' : ''}
        ${skill.temRotina ? '<span class="origem">com rotina</span>' : ''}
        ${skill.importada ? '<span class="origem">formato padrão</span>' : ''}
      </div>
      <label class="interruptor" title="${skill.ativa ? 'Desativar' : 'Ativar'}">
        <input type="checkbox" ${skill.ativa ? 'checked' : ''} />
        <i></i>
      </label>
    </div>
    <p class="skill-desc"></p>
    ${
      skill.ferramentas?.length
        ? `<div class="deps ok">usa ${skill.ferramentas.map((f) => `<code>${esc(f)}</code>`).join(' ')}</div>`
        : ''
    }
    ${
      skill.naoUsePara?.length
        ? `<div class="gatilhos negativos">não usar para: ${skill.naoUsePara
            .map((g) => `<span class="gatilho">${esc(g)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="gatilhos">${
      skill.gatilhos.length
        ? skill.gatilhos.map((g) => `<span class="gatilho">${esc(g)}</span>`).join('')
        : '<span class="gatilho vazio">sem gatilhos</span>'
    }</div>
    <div class="skill-rodape">
      <span class="skill-meta">${esc(skill.etapa)} · prioridade ${skill.prioridade} · ${skill.tamanho} caracteres</span>
      <button class="btn-linha ver">ver instruções</button>
    </div>`;

  div.querySelector('h3').textContent = skill.nome;
  div.querySelector('.skill-desc').textContent = skill.descricao || 'sem descrição';

  div.querySelector('input').addEventListener('change', async (e) => {
    config = await api.skills.toggle(skill.id, e.target.checked);
    div.classList.toggle('inativa', !e.target.checked);
    testarSkills();
  });

  div.querySelector('.ver').addEventListener('click', async () => {
    const r = await api.skills.read(skill.id);
    if (!r.ok) return;
    $('dlgSkillNome').textContent = r.nome;
    $('dlgSkillCorpo').textContent = r.bruto;
    $('dlgSkill').dataset.id = skill.id;
    $('dlgSkill').showModal();
  });

  return div;
}

/**
 * Cartão de uma sugestão de skill (item 5: criação automática). Mostra o
 * veredito do autoteste que o próprio agente já rodou sozinho — mesmo uma
 * reprovação aparece aqui, claramente marcada, em vez de escondida: você
 * decide se ajusta ou descarta, o autoteste só dá mais evidência.
 */
function cartaoSugestao(sugestao) {
  const div = document.createElement('article');
  div.className = 'skill sugestao';
  const badge = sugestao.autotestada
    ? '<span class="origem ok">passou no autoteste</span>'
    : '<span class="origem ruim">não passou no autoteste</span>';
  div.innerHTML = `
    <div class="skill-topo">
      <div class="skill-titulo">
        <h3></h3>
        <span class="origem sua">sugerida pelo agente</span>
        ${badge}
      </div>
    </div>
    <p class="skill-desc"></p>
    <p class="autoteste-resumo"></p>
    <div class="gatilhos">${
      sugestao.gatilhos?.length
        ? sugestao.gatilhos.map((g) => `<span class="gatilho">${esc(g)}</span>`).join('')
        : '<span class="gatilho vazio">sem gatilhos</span>'
    }</div>
    <div class="skill-rodape">
      <span class="skill-meta">${sugestao.previa ? esc(sugestao.previa.slice(0, 120)) + '…' : ''}</span>
      <div class="linha-botoes">
        <button class="btn-secundario aprovar">Aprovar</button>
        <button class="btn-secundario descartar">Descartar</button>
      </div>
    </div>`;

  div.querySelector('h3').textContent = sugestao.nome;
  div.querySelector('.skill-desc').textContent = sugestao.descricao || 'sem descrição';
  div.querySelector('.autoteste-resumo').textContent = sugestao.autotesteResumo || '';

  div.querySelector('.aprovar').addEventListener('click', async () => {
    await api.skills.aprovarSugestao(sugestao.id);
    carregarSugestoes();
  });
  div.querySelector('.descartar').addEventListener('click', async () => {
    if (!confirm(`Descartar a sugestão "${sugestao.nome}"?`)) return;
    await api.skills.descartarSugestao(sugestao.id);
    carregarSugestoes();
  });

  return div;
}

async function carregarSugestoes() {
  const sugestoes = await api.skills.sugeridas();
  $('sugTotal').textContent = sugestoes.length;
  const lista = $('sugestoesLista');
  lista.innerHTML = '';
  if (!sugestoes.length) {
    lista.innerHTML = '<p class="dica">Nenhuma sugestão no momento. Quando o mesmo tipo de pedido se repetir sem nenhuma skill cobrindo, uma proposta testada aparece aqui.</p>';
    return;
  }
  sugestoes.forEach((s) => lista.appendChild(cartaoSugestao(s)));
}

async function carregarSkills() {
  const { skills } = await api.skills.list();
  const lista = $('skillsLista');
  lista.innerHTML = '';
  if (!skills.length) {
    lista.innerHTML = '<p class="dica">Nenhuma skill encontrada. Clique em "Nova skill" para criar a primeira.</p>';
    return;
  }
  skills
    .sort((a, b) => a.origem.localeCompare(b.origem) || a.nome.localeCompare(b.nome))
    .forEach((s) => lista.appendChild(cartaoSkill(s)));
  testarSkills();
}

let temporizadorTeste = null;
async function testarSkills() {
  const texto = $('testeSkill').value.trim();
  const alvo = $('testeResultado');
  if (!texto) {
    alvo.innerHTML = '';
    return;
  }
  const r = await api.skills.preview(texto);
  const linha = (rotulo, nomes) =>
    `<div class="teste-linha"><span>${rotulo}</span>${
      nomes.length ? nomes.map((n) => `<span class="selo-skill">${esc(n)}</span>`).join('') : '<em>nenhuma</em>'
    }</div>`;
  alvo.innerHTML = linha('decisão', r.decisao) + linha('redação', r.redacao);
}

$('testeSkill').addEventListener('input', () => {
  clearTimeout(temporizadorTeste);
  temporizadorTeste = setTimeout(testarSkills, 220);
});

$('btnRecarregarSkills').addEventListener('click', async () => {
  await api.skills.reload();
  carregarSkills();
});

$('btnAbrirSkills').addEventListener('click', () => api.skills.openFolder());

$('btnNovaSkill').addEventListener('click', async () => {
  const nome = prompt('Nome da nova skill:');
  if (!nome?.trim()) return;
  const r = await api.skills.create(nome.trim());
  if (r.ok) carregarSkills();
});

$('btnFecharSkill').addEventListener('click', () => $('dlgSkill').close());
$('btnRevelarSkill').addEventListener('click', () => api.skills.openFile($('dlgSkill').dataset.id));


/* ============================ arquivos gerados (anexo no chat) ============================ */

/** Pedido real do Davi: arquivo que o agente gera não deve só cair na pasta
 * de trabalho sem aviso — vira um cartão anexado à resposta, com "Visualizar"
 * (pré-via dentro do próprio AuGPT) e "Salvar como…" (diálogo nativo do
 * Windows). O arquivo continua sendo escrito de verdade na pasta de trabalho
 * (decisão do Davi) — isto só muda como ele é apresentado no chat. */
function renderizarAnexosGerados(container, lista) {
  const caixa = document.createElement('div');
  caixa.className = 'arquivos-gerados';
  lista.forEach(({ caminho, tamanho }) => {
    const nome = caminho.split(/[/\\]/).pop();
    const ext = (nome.split('.').pop() || '').toUpperCase().slice(0, 4);
    const item = document.createElement('div');
    item.className = 'arquivo-anexo';
    item.innerHTML = `
      <div class="arquivo-icone">${esc(ext || '?')}</div>
      <div class="arquivo-info">
        <div class="arquivo-nome" title="${esc(caminho)}">${esc(nome)}</div>
        <div class="arquivo-tam">${tamanho != null ? kb(tamanho) : ''}</div>
      </div>
      <div class="arquivo-acoes">
        <button class="btn-secundario btn-ver">Visualizar</button>
        <button class="btn-secundario btn-baixar">Salvar como…</button>
      </div>`;
    item.querySelector('.btn-ver').addEventListener('click', () => abrirPreviaArquivo(caminho, nome));
    item.querySelector('.btn-baixar').addEventListener('click', () => api.arquivos.salvarComo(caminho));
    caixa.appendChild(item);
  });
  container.appendChild(caixa);
}

async function abrirPreviaArquivo(caminho, nome) {
  $('dlgArquivoNome').textContent = nome;
  const corpo = $('dlgArquivoCorpo');
  corpo.className = 'previa-arquivo';
  corpo.innerHTML = '<p class="secundario">carregando…</p>';
  $('dlgArquivo').dataset.caminho = caminho;
  $('dlgArquivo').showModal();

  const r = await api.arquivos.previa(caminho);
  if (!r.ok) {
    corpo.innerHTML = `<p class="indisponivel">Não foi possível abrir: ${esc(r.error || 'erro desconhecido')}</p>`;
    return;
  }
  if (r.tipo === 'pdf') {
    corpo.innerHTML = `<iframe src="${r.dataUrl}"></iframe>`;
  } else if (r.tipo === 'imagem') {
    corpo.innerHTML = `<img src="${r.dataUrl}" alt="${esc(nome)}" />`;
  } else if (r.tipo === 'html') {
    // Fase 1 de segurança (2026-09-23): `sandbox` vazio = sem script, sem
    // formulário e com origem opaca. Sem ele, o HTML da prévia (arquivo
    // anexado ou escrito pelo agente) ficava na MESMA origem desta janela, com
    // acesso a `window.augpt` — inclusive a canais que iniciam processos.
    // Só a prévia fica estática; "Abrir com o app padrão" continua abrindo no
    // navegador com tudo funcionando.
    corpo.innerHTML = '<iframe sandbox=""></iframe>';
    corpo.querySelector('iframe').srcdoc = r.conteudo;
  } else if (r.tipo === 'markdown') {
    corpo.className = 'previa-arquivo msg-corpo';
    corpo.innerHTML = window.md.render(r.conteudo);
  } else if (r.tipo === 'texto') {
    corpo.innerHTML = `<pre>${esc(r.conteudo)}</pre>`;
  } else {
    corpo.innerHTML = `<p class="indisponivel">${esc(
      r.motivo || 'sem pré-visualização pra este formato'
    )} — use "Abrir com o app padrão".</p>`;
  }
}

$('btnFecharArquivo').addEventListener('click', () => $('dlgArquivo').close());
$('btnBaixarArquivo').addEventListener('click', () => {
  const caminho = $('dlgArquivo').dataset.caminho;
  if (caminho) api.arquivos.salvarComo(caminho);
});
$('btnAbrirExternoArquivo').addEventListener('click', async () => {
  const caminho = $('dlgArquivo').dataset.caminho;
  if (!caminho) return;
  const r = await api.arquivos.abrirExterno(caminho);
  // executável/script é só mostrado na pasta (Fase 1 de segurança) — avisa o porquê
  if (r && !r.ok && r.error) alert(r.error);
});


/* ============================ execuções ============================ */

const execucoes = { origem: '', itens: [] };

const RESULTADO_ROTULO = {
  concluido: { texto: 'concluído', classe: 'ok' },
  limite: { texto: 'bateu o limite', classe: 'alerta' },
  interrompido: { texto: 'interrompido', classe: 'alerta' },
  erro: { texto: 'erro', classe: 'falha' },
};

const seg = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function carregarExecucoes() {
  const filtro = execucoes.origem ? { origem: execucoes.origem } : {};
  const [lista, stats] = await Promise.all([api.runs.list(filtro), api.runs.stats(filtro)]);
  execucoes.itens = lista;
  pintarEstatisticas(stats);
  pintarExecucoes(lista);
}

function pintarEstatisticas(stats) {
  const tabela = $('statsModelos');
  if (!stats.length) {
    tabela.innerHTML = '<tr><td class="vazio">Nenhuma execução registrada ainda.</td></tr>';
    return;
  }
  const colunas = [
    ['modelo', 'modelo'],
    ['execuções', 'execucoes'],
    ['conclusão', 'conclusao', (v) => `${v}%`],
    ['passos', 'passosMedios'],
    ['tempo', 'segundosMedios', (v) => `${v}s`],
    ['tokens', 'tokensMedios', (v) => v.toLocaleString('pt-BR')],
    ['erros', 'errosPorExecucao'],
    ['incidentes', 'incidentesPorExecucao'],
    ['nota', 'nota', (v, l) => (v ? `${v} (${l.avaliadas})` : '—')],
  ];
  tabela.innerHTML =
    `<thead><tr>${colunas.map(([r]) => `<th>${r}</th>`).join('')}</tr></thead>` +
    `<tbody>${stats
      .map(
        (l) =>
          `<tr>${colunas
            .map(([, chave, fmt]) => `<td>${esc(fmt ? fmt(l[chave], l) : l[chave])}</td>`)
            .join('')}</tr>`
      )
      .join('')}</tbody>`;
}

function pintarExecucoes(lista) {
  const alvo = $('listaExecucoes');
  alvo.innerHTML = '';
  if (!lista.length) {
    alvo.innerHTML = '<p class="dica">Nenhuma execução ainda. Peça algo ao agente e ela aparece aqui.</p>';
    return;
  }

  for (const r of lista.slice(0, 60)) {
    const rotulo = RESULTADO_ROTULO[r.resultado] || { texto: r.resultado || '—', classe: '' };
    const div = document.createElement('article');
    div.className = 'execucao';
    div.innerHTML = `
      <div class="exec-topo">
        <span class="exec-resultado ${rotulo.classe}">${rotulo.texto}</span>
        <span class="exec-modelo">${esc(r.modelo || '—')}</span>
        ${r.origem === 'bancada' ? `<span class="origem">bancada${r.caso ? `: ${esc(r.caso.slice(0, 34))}` : ''}</span>` : ''}
        <span class="exec-quando">${quando(r.em)}</span>
      </div>
      <p class="exec-pedido"></p>
      <div class="exec-medidas">
        <span><b>${r.passos}</b> passos</span>
        <span><b>${r.ferramentas}</b> ferramentas</span>
        <span><b>${r.fontes}</b> fontes</span>
        <span><b>${seg(r.duracaoMs)}</b></span>
        <span><b>${(r.tokens || 0).toLocaleString('pt-BR')}</b> tokens</span>
        ${r.erros ? `<span class="ruim"><b>${r.erros}</b> erros</span>` : ''}
        ${r.cobertura && r.cobertura !== 'boa' ? `<span class="ruim">cobertura ${r.cobertura}</span>` : ''}
        ${
          // Caso real (Davi, 2026-09-18): pediu como saber com certeza que
          // "2 IAs" consultou o modelo dedicado — este selo confirma isso
          // sem precisar abrir o relatório inteiro (ver 'ver relatório').
          r.copilotoDedicado
            ? `<span title="consultas que caíram no modelo dedicado (CPU), não no principal"><b>${r.copilotoDedicado}</b> no crítico dedicado</span>`
            : ''
        }
      </div>
      <div class="exec-rodape">
        <div class="notas" data-id="${esc(r.id)}">
          ${[1, 2, 3, 4, 5]
            .map((n) => `<button class="estrela${r.nota >= n ? ' cheia' : ''}" data-nota="${n}" title="${n} de 5">★</button>`)
            .join('')}
          <span class="nota-dica">${r.nota ? `sua nota: ${r.nota}` : 'avalie a qualidade'}</span>
        </div>
        <button class="btn-linha ver-relatorio">ver relatório</button>
      </div>`;
    div.querySelector('.exec-pedido').textContent = r.pedido || '(sem pedido)';

    div.querySelectorAll('.estrela').forEach((b) =>
      b.addEventListener('click', async () => {
        await api.runs.rate(r.id, Number(b.dataset.nota));
        carregarExecucoes();
      })
    );
    div.querySelector('.ver-relatorio').addEventListener('click', () => abrirRelatorio(r.id));
    alvo.appendChild(div);
  }
}

const ROTULO_FONTE_ROTA = { regra: 'regras', decisor: 'modelo de decisão (trocou a regra)', 'regra+decisor': 'regras, confirmadas pelo modelo de decisão' };

/** Mesmo texto de src/modelos-carregados.js (resumoDoQuadro) — o renderer não faz require. */
function resumoDosModelos(linhas = []) {
  return linhas.map((l) => {
    const onde = l.carregado ? `${l.onde}${l.onde === 'GPU+CPU' ? ` (${l.gpuPct}% na GPU)` : ''}` : 'não carregado';
    const marca = l.situacao === 'ok' ? '✓' : l.situacao === 'atencao' ? '⚠' : '·';
    return `${marca} ${l.papel}: ${l.modelo} — ${onde}${l.esperado ? ` (esperado: ${l.esperado})` : ''}`;
  });
}

/** Relatório detalhado de uma execução, no formato de laudo. */
async function abrirRelatorio(id) {
  const r = await api.runs.read(id);
  if (!r) return;

  const linhas = [
    `EXECUÇÃO ${r.id}`,
    '',
    `Modelo:      ${r.modelo || '—'}`,
    `Origem:      ${r.origem}${r.caso ? ` · ${r.caso}` : ''}`,
    `Quando:      ${new Date(r.em).toLocaleString('pt-BR')}`,
    `Tempo:       ${seg(r.duracaoMs)}`,
    `Passos:      ${r.passos} de ${r.maxPassos}`,
    `Chamadas:    ${r.chamadas.decisao} decisão · ${r.chamadas.redacao} redação`,
    `Tokens:      ${r.tokens.total.toLocaleString('pt-BR')} (${r.tokens.prompt} entrada · ${r.tokens.completion} saída)`,
    // Caso real (Davi, 2026-09-18): "implemente uma função no relatório pra
    // vermos quando as AIs estão sendo usadas, 100% de certeza que está
    // funcionando" — linha de resumo aqui em cima (visão rápida), seção
    // completa mais abaixo (visão detalhada, por origem da consulta).
    r.copiloto?.consultas
      ? `Copiloto:    ${r.copiloto.consultas} consulta(s) · ${r.copiloto.dedicado} no modelo dedicado${
          r.copiloto.modeloDedicado ? ` (${r.copiloto.modeloDedicado})` : ''
        } · ${r.copiloto.principal} no principal${r.copiloto.falhas ? ` · ${r.copiloto.falhas} falharam` : ''}`
      : 'Copiloto:    nenhuma consulta ao crítico nesta execução',
    '',
    'PEDIDO',
    r.pedido || '—',
    '',
    ...(r.entendimento
      ? [
          'ENTENDIMENTO (pedido reescrito pela verificação de ambiguidade)',
          `  original:  ${r.entendimento.original}`,
          `  entendido: ${r.entendimento.reescrito}`,
          '',
        ]
      : []),
    'SKILLS ATIVADAS',
    ...(r.skills.length ? r.skills.map((s) => `  ${s.etapa}: ${s.nomes.join(', ')}`) : ['  nenhuma']),
    '',
    'FERRAMENTAS',
    ...(r.ferramentas.length
      ? r.ferramentas.map(
          (f) =>
            `  ${f.erro ? '✗' : '✓'} ${f.nome.padEnd(20)} ${String(f.duracaoMs).padStart(6)}ms${f.erro ? `  ${f.erro.slice(0, 90)}` : ''}` +
            // Etapa A: o que foi pedido à ferramenta (consulta, URL, foco)
            (f.argumentos ? `\n      ${Object.entries(f.argumentos).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' | ') : v}`).join(' · ').slice(0, 220)}` : '')
        )
      : ['  nenhuma']),
    ...(r.statusDaTarefa ? ['', `STATUS DA TAREFA: ${r.statusDaTarefa.status}${r.statusDaTarefa.motivos?.length ? ` — ${r.statusDaTarefa.motivos.join('; ')}` : ''}`] : []),
    ...(r.tipoDePedido
      ? ['', `TIPO DE PEDIDO: ${r.tipoDePedido.tipo} (${r.tipoDePedido.motivo || ''})${r.tipoDePedido.fonte ? ` · decidido por: ${ROTULO_FONTE_ROTA[r.tipoDePedido.fonte] || r.tipoDePedido.fonte}` : ''}`]
      : []),
    ...(r.assuntoDaConversa ? [`ASSUNTO DA CONVERSA: ${r.assuntoDaConversa.motivo || ''}`] : []),
    ...(r.planoInicial?.length ? ['', 'PLANO INICIAL', ...r.planoInicial.map((p) => `  - ${p}`)] : []),
    ...(r.checklist?.length ? ['', 'CHECKLIST (estado final)', ...r.checklist.map((i) => `  [${i.status === 'feito' ? 'x' : ' '}] ${i.texto}`)] : []),
    ...(r.descartes?.length ? ['', `DESCARTES (${r.descartes.length})`, ...r.descartes.slice(0, 40).map((x) => `  ${x.etapa}: ${x.alvo} — ${x.motivo}`)] : []),
    ...(r.dialogos?.length ? ['', `PERGUNTAS AO USUÁRIO (${r.dialogos.length})`, ...r.dialogos.map((x) => `  P: ${x.pergunta}\n  R: ${x.resposta}`)] : []),
    '',
    'FONTES',
    ...(r.fontes.length
      ? r.fontes.map((f) => `  ${f.id ? `${f.id} ` : ''}${f.tipo === 'busca' ? '⌕' : '✓'} ${f.provedor}${f.consultas?.length ? ` — "${f.consultas.join('" / "').slice(0, 120)}"` : ''}${f.url ? ` — ${f.url.slice(0, 70)}` : ''}`)
      : ['  nenhuma']),
    '',
    'COBERTURA DO MATERIAL',
    r.cobertura
      ? `  ${r.cobertura.nivel} (${r.cobertura.encontrados} de ${r.cobertura.total} termos no material)`
      : '  não medida',
    '',
    'INCIDENTES',
    ...(Object.entries(r.incidentes).filter(([, v]) => v).length
      ? Object.entries(r.incidentes)
          .filter(([, v]) => v)
          .map(([k, v]) => `  ⚠ ${k}: ${v}`)
      : ['  nenhum']),
    '',
    `RESULTADO: ${(r.resultado || '—').toUpperCase()}${r.erro ? ` — ${r.erro}` : ''}`,
    r.nota ? `NOTA DO USUÁRIO: ${r.nota} de 5` : '',
    '',
    'RESPOSTA',
    r.resposta || '(sem resposta)',
    '',
    // Seção completa da consulta ao Copiloto ("2 IAs") — caso real (Davi,
    // 2026-09-18): ele pediu uma forma de confirmar com certeza que o modelo
    // DEDICADO está sendo usado, não só o principal se auto-avaliando. Cada
    // linha de origem vem do evento 'copiloto-consulta' (ver
    // Agent._perguntarAoCritico, loop.js) — é a contagem real de chamadas,
    // não uma estimativa.
    // Pedido do Davi (2026-10-10): ver QUANDO o Tev1 e o crítico entraram,
    // e onde cada modelo estava rodando (GPU/CPU) no fim da execução.
    // Modo AUTO (10/10): o nível que o pedido ganhou e o que ele desligou
    'MODO AUTO',
    ...(r.auto
      ? [
          `  nível ${r.auto.nivel} · ${r.auto.nome}${r.auto.nivelInicial !== undefined ? ` (começou no nível ${r.auto.nivelInicial})` : ''} — ${r.auto.motivo || ''}`,
          ...(Object.keys(r.auto.ajustes || {}).length
            ? [`  ajustes desta execução: ${Object.entries(r.auto.ajustes).map(([k, v]) => `${k}=${v}`).join(', ')}`]
            : []),
          ...(r.auto.rapida
            ? [
                `  resposta rápida em ${Math.round((r.auto.rapida.ms || 0) / 100) / 10} s · Wikipédia: ${r.auto.rapida.wikis.map((w) => `${w.idioma} "${w.titulo}" (${w.campos} campos)`).join(', ') || 'nenhuma'} · páginas: ${r.auto.rapida.paginas.length}`,
                `  conferência: ${r.auto.rapida.fatosConferiveis} dado(s) conferível(is); ${r.auto.rapida.correcoes.length ? `corrigido: ${r.auto.rapida.correcoes.map((c) => `${c.fato} ${c.de} → ${c.para}`).join('; ')}` : 'nada a corrigir'}`,
              ]
            : []),
        ]
      : ['  desligado (ou execução anterior a esta versão)']),
    '',
    'IAS AUXILIARES ACIONADAS (em ordem)',
    ...(r.acionamentos?.length
      ? r.acionamentos.map(
          (a) => `  ${a.ok === false ? '✗' : '•'} passo ${a.n} · ${a.quem}${a.modelo ? ` (${a.modelo})` : ''}: ${a.detalhe}${typeof a.ms === 'number' ? ` · ${a.ms} ms` : ''}`
        )
      : ['  nenhuma (roteador desligado e nenhuma consulta ao crítico), ou execução anterior a esta versão']),
    '',
    'ONDE CADA MODELO ESTAVA NO FIM DA EXECUÇÃO',
    ...(r.modelosNaExecucao?.length ? resumoDosModelos(r.modelosNaExecucao).map((l) => `  ${l}`) : ['  não registrado (execução sem conclusão normal, ou anterior a esta versão)']),
    '',
    'COPILOTO ("2 IAs") — CONSULTAS AO CRÍTICO',
    ...(r.copiloto?.consultas
      ? [
          `  ${r.copiloto.consultas} consulta(s) no total`,
          `  ${r.copiloto.dedicado} no modelo DEDICADO${r.copiloto.modeloDedicado ? ` (${r.copiloto.modeloDedicado}, CPU)` : ''}`,
          `  ${r.copiloto.principal} no modelo principal${r.copiloto.dedicado ? ' (fallback ou "modelo atual")' : ''}`,
          ...(r.copiloto.falhas ? [`  ⚠ ${r.copiloto.falhas} falharam (erro de rede/timeout)`] : []),
          '  por origem:',
          ...Object.entries(r.copiloto.porOrigem || {}).map(([origem, n]) => `    ${origem}: ${n}`),
        ]
      : ['  nenhuma consulta ao crítico nesta execução (ou execução anterior a esta versão)']),
    '',
    'CRÍTICAS DO COPILOTO',
    ...(r.criticasAutomaticas?.length
      ? r.criticasAutomaticas.map(
          (c) => `  [passo ${c.n} · ${ROTULO_FASE_CRITICA[c.fase] || c.fase}] ${c.texto}`
        )
      : ['  nenhuma']),
    '',
    'RACIOCÍNIO PASSO A PASSO',
    ...(r.passosDetalhados?.length
      ? r.passosDetalhados.flatMap((p) => [
          `  passo ${p.n}:`,
          p.pensamento ? `    pensamento: ${p.pensamento}` : null,
          p.raciocinio ? `    raciocínio: ${p.raciocinio}` : null,
          p.critica ? `    risco:      ${p.critica}` : null,
          p.plano?.length ? `    plano:      ${p.plano.join(' · ')}` : null,
          '',
        ].filter((l) => l !== null))
      : ['  não disponível para execuções anteriores a esta versão']),
  ];

  $('dlgSkillNome').textContent = `Execução · ${r.modelo || '—'}`;
  $('dlgSkillCorpo').textContent = linhas.join('\n');
  $('dlgSkill').dataset.id = '';
  $('dlgSkill').showModal();
}

$('filtroOrigem').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  execucoes.origem = chip.dataset.origem;
  $('filtroOrigem').querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativo', c === chip));
  carregarExecucoes();
});

// Pedido de Davi 2026-09-23: "Visualizar Execuções" em janela própria
// (3 colunas + buscador + gráfico de linhas) — ver renderer/execucoes.html/js.
$('btnAbrirJanelaExec').addEventListener('click', () => api.runs.abrirJanela());

$('btnExportarExec').addEventListener('click', () => api.runs.export());

$('btnLimparExec').addEventListener('click', async () => {
  const alvo = execucoes.origem || null;
  if (!confirm(`Apagar ${alvo ? `as execuções de "${alvo}"` : 'todas as execuções'}?`)) return;
  await api.runs.clear(alvo);
  carregarExecucoes();
});
