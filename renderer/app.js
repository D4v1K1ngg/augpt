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

// guardado numa variável: quando a conversa é limpa, o bloco sai da tela junto
// com a resposta antiga, mas continua existindo para a próxima
const blocoDeMedidores = document.querySelector('.medidores');

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
    <div class="turno-topo">
      <div class="msg-quem">agente</div>
      <div class="turno-medidores"></div>
    </div>
    <div class="andamento">
      <span class="digitando"><i></i><i></i><i></i></span>
      <span class="andamento-txt">preparando…</span>
      <button class="btn-linha parar">parar</button>
    </div>
    <details class="atividade" open hidden>
      <summary>Atividade do agente <span class="atividade-resumo"></span></summary>
      <ol class="atividade-etapas"></ol>
      <div class="atividade-sites" hidden>
        <div class="atividade-rotulo">Sites consultados</div>
        <div class="atividade-lista"></div>
      </div>
      <!-- 19/10 (pedido do Davi): o raciocínio é um botão dentro do cartão, não uma bandeja solta -->
      <details class="detalhe">
        <summary><span class="resumo-passos">raciocínio</span></summary>
        <div class="trilha"></div>
      </details>
    </details>
    <div class="turno-ancora"></div>
    <div class="msg-corpo resposta" hidden></div>`;
  el.aMensagens.appendChild(dele);

  const turno = {
    caixa: dele,
    andamento: dele.querySelector('.andamento'),
    texto: dele.querySelector('.andamento-txt'),
    detalhe: dele.querySelector('.detalhe'),
    atividade: dele.querySelector('.atividade'),
    // plano, skills e afins entram aqui (fora do cartão: nunca escondidos num cartão fechado)
    ancora: dele.querySelector('.turno-ancora'),
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
  // passos, tokens, tempo e contexto acompanham a resposta em andamento (são
  // os mesmos elementos de sempre, só mudam de lugar a cada pedido)
  dele.querySelector('.turno-medidores').appendChild(blocoDeMedidores);
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
  // evento sem número de passo (as ferramentas do núcleo): vai para o passo atual
  // (16/10: Math.max(5, undefined) mostrava "raciocínio · NaN passo")
  if (!Number.isFinite(Number(n)) || n === null || n === '') {
    if (t.noAtual && Number(t.noAtual.dataset.n) === (t.passoAtual || Number(t.noAtual.dataset.n))) return t.noAtual;
    n = t.passoAtual || 1;
  }
  const existente = t.trilha.querySelector(`.no[data-n="${n}"]`);
  if (existente) return existente;
  t.trilha.querySelectorAll('.no.ativo').forEach((x) => x.classList.remove('ativo'));
  const node = document.createElement('div');
  node.className = 'no ativo';
  node.dataset.n = n;
  node.innerHTML = `<div class="marcador">${n}</div>`;
  t.trilha.appendChild(node);
  t.atividade.hidden = false; // o raciocínio mora no cartão: com passo, o cartão aparece
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
  if (agente.turno) {
    agente.turno.atividade.hidden = false;
    agente.turno.atividade.open = true;
    agente.turno.detalhe.open = true;
  }
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

