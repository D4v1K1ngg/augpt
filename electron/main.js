'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const imagens = require('../src/tools/imagens');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const { Config } = require('../src/config');
const ollama = require('../src/llm/ollama');
const { montarQuadroDeModelos } = require('../src/modelos-carregados');
const { Agent } = require('../src/agent/loop');
const { Sandbox, podeAbrirComAppPadrao } = require('../src/tools/sandbox');
const { Memory } = require('../src/agent/memory');
const { renderizar } = require('./render');
const { SessaoNavegador } = require('./navegador');
const { negarPermissoes, soMicrofoneDe } = require('./sessao-segura');
const { Skills } = require('../src/skills');
const tools = require('../src/tools');
const { Conversas } = require('../src/conversas');
const { Registro, Registros } = require('../src/registro');
const { MemoriaOperacional } = require('../src/agent/memoria-operacional');
const { MemoriaCentral } = require('../src/agent/memoria-central');
const { GerenciadorMCP } = require('../src/mcp');
const ooxml = require('../src/formatos/ooxml');
const busca = require('../src/tools/search');
const agendador = require('../src/agent/agendador');
const { RuntimeSearXNG } = require('../src/searxng-runtime');
const ollamaRuntime = require('../src/ollama-runtime');
const hardware = require('../src/agent/hardware');
const primeiroUso = require('../src/primeiro-uso');
const ollamaRemoto = require('../src/ollama-remoto');
const calibracaoGpu = require('../src/calibracao-gpu');
const verificadorDeHardware = require('../src/verificador-de-hardware');
const instaladorOllama = require('../src/instalador-ollama');
const { YtDlp } = require('../src/ytdlp');
const ytdlp = () => new YtDlp(path.join(app.getPath('userData'), 'componentes'));
const { Tesseract } = require('../src/tesseract');
const tesseract = () => new Tesseract(path.join(app.getPath('userData'), 'componentes'));
const { GeradorDeImagens, recomendar: recomendarGerador, pastaPadrao: pastaDoGerador } = require('../src/gerador-de-imagens');
const gerador = () => new GeradorDeImagens(pastaDoGerador(app.getPath('userData')));

let win = null;

// Revisão de 25/10: uma instância só. Duas (o atalho e o "npm start", ou dois cliques) usavam a mesma
// pasta de dados e disputavam a configuração, a agenda e os avisos (o lembrete saía duas vezes).
// Abrir de novo traz a janela que já está aberta para a frente.
if (!app.requestSingleInstanceLock()) {
  console.log('O AuGPT já está aberto — a janela dele foi trazida para a frente.');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

// Revisão de 25/10: erro que ninguém tratou no processo principal fica registrado (antes: só no
// terminal, ou a caixa de erro do Electron). userData/diagnostico/erros.log, até 512 KB (+ um .1).
function registrarErro(tipo, erro) {
  console.error(tipo, erro);
  try {
    const dir = path.join(app.getPath('userData'), 'diagnostico');
    const arquivo = path.join(dir, 'erros.log');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(arquivo) && fs.statSync(arquivo).size > 512 * 1024) fs.renameSync(arquivo, `${arquivo}.1`);
    fs.appendFileSync(arquivo, `${new Date().toISOString()} ${tipo}: ${erro?.stack || erro}\n`);
  } catch {
    // sem disco: fica só no terminal
  }
}
process.on('unhandledRejection', (erro) => registrarErro('promessa sem tratamento', erro));
process.on('uncaughtException', (erro) => registrarErro('exceção sem tratamento', erro));

let janelaExecucoes = null; // pedido de Davi 2026-09-23: "Visualizar Execuções" ganhou janela própria
let config = null;
let agent = null;
let skills = null;
let pastasDeFerramentas = null;
let conversas = null;
let remoto = null; // acesso pelo celular (src/remoto.js), só com a opção ligada
let mcp = null;
let navegador = null;
let registros = null;
let registroAtual = null;
let conversaAbort = null;
let searxngRuntime = null;
// Evita perguntar de novo a cada checagem de saúde (20s) enquanto o Ollama
// continuar offline e o usuário já tiver visto a oferta uma vez nesta
// sessão. Volta a false assim que ficar online de novo, então um NOVO
// episódio offline mais tarde na sessão volta a oferecer — ver
// ipcMain.handle('ollama:health', ...) abaixo.
let ofertaOllamaJaMostrada = false;
// Contagem de falhas seguidas do polling de saúde (`ollama:health`, a cada
// 20s) — a decisão de quando isso já é "caiu de verdade" é pura e mora em
// `ollamaRuntime.avaliarSaudeComDebounce` (testável sem o módulo `electron`,
// ver avaliacao/casos/ollama-runtime.js e o comentário lá sobre o caso real
// do Davi, 2026-09-18, que motivou o debounce).
let falhasConsecutivasSaude = 0;
// Pedido de Davi 2026-09-14: fechar a janela primeiro descarrega as IAs
// carregadas (ver encerrarModelosEFechar, mais abaixo). `false` até a
// limpeza terminar — o handler de 'close' da janela olha esta flag pra
// saber se é a 1ª tentativa (precisa interceptar) ou a 2ª, disparada pela
// própria função de limpeza no final (deixa fechar de verdade).
let fechandoComLimpeza = false;
let limpezaDeModelosEmAndamento = false;

const EVENTOS = [
  'inicio', 'inicio-rapido', 'iteracao', 'pensando', 'raciocinio', 'ferramenta', 'resultado',
  'negado', 'concluido', 'interrompido', 'limite', 'erro', 'uso', 'aviso',
  'aprovacao', 'pergunta', 'protocolo-invalido', 'compactado', 'workspace-changed',
  'config-alterada', 'fonte', 'contrato-incompleto', 'serie-de-precos', 'redigindo', 'resposta-token', 'resposta-reinicia', 'skills', 'cobertura',
  'chamada', 'aprovacao-resolvida', 'aprovacao-critica', 'registro', 'verificacao', 'destilado', 'rotina-inicio', 'rotina-passo', 'rotina-fim', 'rotina-ignorada', 'protocolo-recuperado', 'cache-usado', 'confronto', 'lacunas', 'confianca', 'fonte-marcada', 'checklist', 'busca-reforco', 'busca-ajustada', 'critica-plano',
  'ambiguidade', 'skill-sugerida', 'objetivo-reescrito', 'interpretacao-escolhida', 'resumo-conversa',
  'tarefa-atualizada', 'janela-contexto', 'subtarefa', 'skill-forcada',
  // Pedido de Davi 2026-09-23: fechar o gap encontrado ao revisar o último
  // chat real — a descoberta de autoridade em duas fases (web.js) roda e
  // até promove domínios de verdade, mas sem estar nesta lista o evento
  // nunca chega no renderer (nem ao vivo, nem gravado no registro).
  'autoridade-descoberta',
  // a agenda mudou pelo chat (23/10): a tela da Agenda se atualiza
  'agenda-mudou',
  'tela-capturada',
  'conferencia',
  // Pedido de Davi 2026-09-23, mesma rodada: instrumentação por-chamada
  // (tipo/tokens/duração) pra alimentar o gráfico "qual parte do raciocínio
  // levou mais tempo/custou mais tokens" da nova janela "Visualizar
  // Execuções" — ver Agent.contabilizar(), loop.js.
  'uso-chamada',
  // Motor de pesquisa (motor-pesquisa.js, 2026-09-24): plano, opções
  // encontradas e matriz opção × critério aparecem como cartões na conversa.
  'pesquisa-cadeia', 'pesquisa-criterios', 'pesquisa-ordem', 'pesquisa-mapa', 'pesquisa-plano', 'pesquisa-candidatos', 'pesquisa-matriz', 'pesquisa-hipoteses', 'pesquisa-fim',
  // Controlador v2 (2026-10-05): limite com resposta parcial, prompt que não
  // coube na janela e crítica disparada por evento aparecem ao vivo.
  'limite-atingido', 'contexto-ajustado', 'contexto-saturado', 'critica-por-evento',
  // Revisão v4: arquivo baixado pelo navegador (vira anexo quando cai na pasta de trabalho)
  'download-concluido',
  // Modo AUTO (auto.js, 10/10): nível do pedido e o que a resposta rápida fez
  'nivel-auto', 'resposta-rapida', 'auto-correcao', 'auto-pesquisa', 'resposta-vazia',
  // núcleo, imagens e investigação (15–17/10): sem estar aqui, o evento não chega na tela
  // (17/10: o PDF da investigação não virava anexo na resposta)
  'nucleo-entendimento', 'nucleo-fim', 'imagem-vista', 'imagem-revisada', 'referencia-escolhida',
  'arquivo-criado', 'investigacao-plano', 'investigacao-progresso', 'investigacao-secao',
];

/**
 * Id da conversa da execução atual, pra persistência de `Tarefa` (ver
 * `criarAgente()`/evento `tarefa-atualizada` abaixo). Módulo já assume um
 * agente por vez (`agent?.rodando` barra uma 2ª execução simultânea — ver
 * `agent:start`), então uma variável só, sem mapa por id, é suficiente; fica
 * `null` fora de uma execução ou numa disparada por agendamento (sem
 * conversa salva).
 */
let idConversaEmExecucao = null;

function enviar(canal, dados) {
  if (win && !win.isDestroyed()) win.webContents.send('agent:event', { canal, dados });
  remoto?.transmitir(canal, dados); // acesso pelo celular (26/10): os mesmos eventos
}

let aberturaJaRodou = false;

// o ícone do app (25/10): instalado, o .exe já tem o build/icon.ico; isto vale no `npm start` e nos avisos
const ICONE = path.join(__dirname, '../renderer/icone.png');

function criarJanela() {
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0A0D12',
    title: 'AuGPT',
    icon: ICONE,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // abre maximizada (19/10, pedido do Davi) — ou como estava quando foi fechada da última vez
  const maximizada = config?.data?.janelaMaximizada !== false;
  // abertura (19/10): a caixa pequena que cresce até virar a janela; desligável em Ajustes → Geral.
  // Só na primeira janela do app (reabrir pelo Dock/atalho não repete a animação)
  if (config?.data?.animacaoDeAbertura !== false && !aberturaJaRodou && !process.argv.includes('--sem-abertura')) {
    aberturaJaRodou = true;
    require('./abertura').abrirComAbertura(win, { mudo: config.data.somDaAbertura === false, maximizada });
  } else win.once('ready-to-show', () => (maximizada ? win.maximize() : win.show()));
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  // A janela nunca navega para fora do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Pedido de Davi 2026-09-14: clicar em fechar não fecha na hora — primeiro
  // descarrega as IAs carregadas (ver encerrarModelosEFechar). Na 2ª vez que
  // este handler roda (fechandoComLimpeza já true, disparado pela própria
  // função de limpeza no final), deixa fechar de verdade.
  win.on('close', (event) => {
    // lembra se estava maximizada, para abrir do mesmo jeito da próxima vez
    try {
      if (!fechandoComLimpeza && config) config.save({ janelaMaximizada: win.isMaximized() });
    } catch {
      /* sem gravar: abre maximizada, que é o padrão */
    }
    if (fechandoComLimpeza) return;
    event.preventDefault();
    encerrarModelosEFechar();
  });
}

/**
 * Pedido de Davi 2026-09-23: a visualização de execuções deixou de ser uma
 * aba dentro da janela principal e ganhou janela própria (3 colunas +
 * buscador + gráfico de linhas — ver renderer/execucoes.html/js). Reusa o
 * MESMO preload.js — `api.runs.*` já é IPC puro (delegando pra `registros`,
 * a mesma instância de `Registros` usada pela janela principal), então não
 * precisou de nenhum canal novo só pra ler dados; só o comando de ABRIR a
 * janela (`execucoes:abrirJanela`, registrado mais abaixo) é novo.
 *
 * `parent: win` (não `modal`): fica agrupada com a janela principal no
 * gerenciador de janelas do SO, mas o usuário pode continuar usando o chat
 * com esta aberta ao lado — só fecha junto se a principal fechar de vez
 * (comportamento padrão do Electron pra janela com `parent`, aceitável aqui:
 * é uma janela de apoio, não faz sentido sobreviver sozinha sem o app).
 */
function abrirJanelaExecucoes() {
  if (janelaExecucoes && !janelaExecucoes.isDestroyed()) {
    janelaExecucoes.focus();
    return;
  }
  janelaExecucoes = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0B0B0D',
    icon: ICONE,
    title: 'AuGPT — Execuções',
    show: false,
    autoHideMenuBar: true,
    parent: win || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  janelaExecucoes.loadFile(path.join(__dirname, '..', 'renderer', 'execucoes.html'));
  janelaExecucoes.once('ready-to-show', () => janelaExecucoes.show());
  if (process.argv.includes('--dev')) janelaExecucoes.webContents.openDevTools({ mode: 'detach' });

  janelaExecucoes.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janelaExecucoes.webContents.on('will-navigate', (e) => e.preventDefault());

  janelaExecucoes.on('closed', () => {
    janelaExecucoes = null;
  });
}

/**
 * Manda o progresso do encerramento pro renderer — canal próprio
 * ('app:encerrando'), separado da lista fixa EVENTOS/'agent:event' porque
 * isto não é um evento do agente, é do ciclo de vida da janela.
 */
function enviarEncerramento(fase, dados) {
  if (win && !win.isDestroyed()) win.webContents.send('app:encerrando', { fase, ...dados });
}

/**
 * Pedido de Davi 2026-09-14 ("fazer um checklist das IAs rodando e fechar
 * elas antes de fechar [o AuGPT], pra liberar os recursos do PC"): antes de
 * fechar a janela de verdade, para o agente (evita que ele reabra um modelo
 * bem na hora em que este código está tentando descarregar todos), lista o
 * que está carregado agora (GET /api/ps, tanto GPU quanto CPU — o Copiloto
 * nível 2 em modo "doisModelos" roda dedicado na CPU, ver ollama.js) e manda
 * um POST de descarga (keep_alive:0) pra cada um, um de cada vez, com o
 * progresso indo pro renderer pra virar o checklist visível na tela. NÃO
 * mexe no processo do `ollama serve` em si — só nos modelos que o AuGPT
 * carregou (ver src/ollama-runtime.js: o Ollama é do usuário, continua de
 * pé pra outros usos depois que o AuGPT fecha).
 *
 * Teto de 10s no total (Promise.race): se o Ollama estiver lento ou preso,
 * o usuário não pode ficar impedido de fechar o próprio app — passado o
 * prazo, fecha assim mesmo (best-effort; não é garantia de ter liberado
 * memória, só a melhor tentativa dentro de um tempo razoável).
 */
async function encerrarModelosEFechar() {
  if (limpezaDeModelosEmAndamento) return;
  limpezaDeModelosEmAndamento = true;

  agent?.parar();
  conversaAbort?.abort(new Error('encerrando'));

  const host = config?.data?.host;
  const prazo = new Promise((resolve) => setTimeout(resolve, 10000));

  await Promise.race([
    (async () => {
      let carregados = [];
      try {
        carregados = host ? await ollama.psModels(host) : [];
      } catch {
        carregados = []; // Ollama offline ou inacessível — nada pra descarregar
      }
      if (!carregados.length) return;

      enviarEncerramento('inicio', {
        modelos: carregados.map((m) => ({ nome: m.name, gpu: m.sizeVram > 0 })),
      });
      for (const m of carregados) {
        let ok = true;
        try {
          await ollama.unloadModel(host, m.name);
        } catch {
          ok = false; // segue pro próximo mesmo assim — um modelo travado não deve travar os outros
        }
        enviarEncerramento('progresso', { nome: m.name, ok });
      }
      enviarEncerramento('fim', {});
    })(),
    prazo,
  ]);

  fechandoComLimpeza = true;
  if (win && !win.isDestroyed()) win.close();
  else app.quit();
}

function garantirWorkspacePadrao() {
  if (config.data.workspace) return;
  const padrao = path.join(app.getPath('documents'), 'AuGPT Workspace');
  config.save({ workspace: padrao });
}

/**
 * Sessão de navegação, criada só quando a primeira ferramenta pedir.
 * Cookies persistem entre execuções: quem faz login uma vez continua logado.
 */
function obterNavegador() {
  if (config.data.navegacaoInterativa === false) return null;
  if (!navegador) {
    navegador = new SessaoNavegador({ visivel: config.data.navegadorVisivel !== false, obterConfig: () => config.data });
  }
  return navegador;
}

ipcMain.handle('browser:close', () => {
  navegador?.fechar();
  return true;
});

ipcMain.handle('browser:state', () => ({
  aberta: Boolean(navegador?.aberta),
  url: navegador?.ultimaLeitura?.url || null,
}));

/**
 * A config que o agente recebe, com a URL do SearXNG embutido sobreposta
 * quando ele estiver ligado e rodando — sem tocar no campo `searxngUrl`
 * salvo, que continua sendo a URL externa que o usuário digitou (se
 * digitou). `search.js`/`web.js` não sabem que o runtime embutido existe:
 * só leem `ctx.config.searxngUrl` normalmente.
 */
/** O idioma em uso (22/10): o escolhido em Ajustes ou na boas-vindas; sem escolha, o do Windows. */
function idiomaEfetivo() {
  const escolhido = config.data.idioma;
  if (escolhido === 'pt' || escolhido === 'en') return escolhido;
  return String(app.getLocale() || '').toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** O nome que o usuário deu (boas-vindas ou Ajustes) vira um fato da memória central: o agente usa em toda resposta. */
function gravarNomeNaMemoria(nome) {
  const memoria = new MemoriaCentral(app.getPath('userData'));
  const limpo = String(nome || '').trim().slice(0, 60);
  if (limpo) memoria.definir({ chave: 'nome', valor: `Chama-se ${limpo}.` });
  else memoria.esquecer('nome');
}

function configParaAgente() {
  const base = { ...config.data, idiomaEfetivo: idiomaEfetivo() };
  if (config.data.usarSearxngEmbutido && searxngRuntime?.rodando) base.searxngUrl = `http://127.0.0.1:${searxngRuntime.porta}`;
  return base;
}

/* ------------------------------ calibração da placa (19/10) ------------------------------ */
// O Ollama deixava parte do qwen3.5:9b na RAM mesmo cabendo inteiro na placa (55 → 80 tokens/s
// com todas as camadas nela): depois de uma resposta, se o modelo transbordou, mede uma vez e guarda.
const calibrandoAgora = new Set();
function camadaFalhou(chave, motivo) {
  const todas = { ...(config.data.calibracaoGpu || {}) };
  todas[chave] = { ...(todas[chave] || {}), numGpu: null, falhou: motivo, em: new Date().toISOString() };
  config.save({ calibracaoGpu: todas });
}
function aplicarCalibracoes() {
  for (const [chave, c] of Object.entries(config.data.calibracaoGpu || {})) {
    const i = chave.indexOf('|');
    if (c?.numGpu) ollama.definirCamadasNaPlaca(chave.slice(0, i), chave.slice(i + 1), c.numGpu, { aoFalhar: camadaFalhou });
  }
}
async function calibrarSePreciso() {
  const { host, model } = config.data;
  const chave = calibracaoGpu.chave(host, model);
  if (!model || config.data.calibrarPlaca === false || calibrandoAgora.has(chave) || (config.data.calibracaoGpu || {})[chave]) return;
  calibrandoAgora.add(chave);
  try {
    const r = await calibracaoGpu.calibrar({ host, model, numCtx: 16384 });
    if (!r.precisa) return;
    config.save({ calibracaoGpu: { ...(config.data.calibracaoGpu || {}), [chave]: { ...r, em: new Date().toISOString() } } });
    if (r.numGpu) {
      ollama.definirCamadasNaPlaca(host, model, r.numGpu, { aoFalhar: camadaFalhou });
      enviar('aviso', { texto: `Placa de vídeo calibrada para o ${model}: agora ele cabe inteiro nela (${r.antes} → ${r.depois} tokens/s).` });
    }
  } catch {
    // Ollama fora do ar ou ocupado: tenta de novo depois da próxima resposta
  } finally {
    calibrandoAgora.delete(chave);
  }
}

function criarAgente(idConversa = null) {
  idConversaEmExecucao = idConversa || null;
  // HTML de página que o leitor de tópico não reconheceu (Reddit novo, 11º
  // teste real) vai pra userData/diagnostico — até 2 por sessão do app
  require('../src/tools/extract').definirPastaDeDiagnostico(path.join(app.getPath('userData'), 'diagnostico'));
  agent = new Agent({
    config: configParaAgente(),
    userDataPath: app.getPath('userData'),
    render: config.data.renderizarJs ? (url) => renderizar(url, { obterConfig: () => config.data }) : null,
    navegador: obterNavegador(),
    skills,
  });
  // depois de cada resposta (o usuário está lendo): calibra a placa, se o modelo transbordou
  agent.on('concluido', () => setTimeout(() => calibrarSePreciso(), 1500));
  for (const evento of EVENTOS) {
    agent.on(evento, (dados) => {
      if (evento === 'config-alterada') config.save(dados);
      // grava o resumo fundido (ver run() em loop.js) de volta no JSON da
      // conversa — mesmo princípio do config-alterada acima: o agente
      // calcula, o processo principal persiste.
      if (evento === 'resumo-conversa') conversas.atualizarResumo(dados.idConversa, dados.resumo, dados.turnos);
      // Item 1 da análise comparativa (2026-09-21): `dados` aqui já É o
      // `tarefa.serializar()` (sem `idConversa` embutido, diferente do
      // resumo-conversa acima) — o id vem do fechamento desta função, que é
      // sempre chamada de novo (com o id certo) no início de cada execução.
      if (evento === 'tarefa-atualizada') conversas.atualizarTarefa(idConversaEmExecucao, dados);
      // Fase 2 (facilidade de uso): erro técnico ("Ollama 404: {...}",
      // "fetch failed") ganha uma frase que diz o que fazer — a original vai
      // junto, pra quem quiser o detalhe (ver src/primeiro-uso.js).
      if (evento === 'erro') {
        enviar(evento, { ...dados, amigavel: primeiroUso.mensagemAmigavel(dados?.mensagem) });
        return;
      }
      enviar(evento, dados);
    });
  }

  // O registro observa os mesmos eventos e grava o relatório da execução
  registroAtual = new Registro({
    origem: 'app',
    modelo: config.data.model,
    host: config.data.host,
  }).acompanhar(agent);

  for (const fim of ['concluido', 'limite', 'interrompido', 'erro']) {
    agent.on(fim, () => {
      const dados = registros.salvar(registroAtual.dados);
      if (dados) enviar('registro', { id: dados.id, resumo: registroAtual.resumo });
      // Fase 2: a janela "Visualizar Execuções" (se aberta) recarrega sozinha
      // — antes só mostrava a execução nova se fosse fechada e aberta de novo.
      if (dados && janelaExecucoes && !janelaExecucoes.isDestroyed()) {
        janelaExecucoes.webContents.send('execucoes:atualizadas', { id: dados.id });
      }
    });
  }

  return agent;
}

// ---------------------------- IPC ----------------------------

ipcMain.handle('config:get', () => config.all);

/**
 * Fase 1 de segurança (2026-09-23): este canal aceitava QUALQUER campo vindo
 * da interface. Hoje a interface escapa bem o que mostra, mas se um dia um
 * script injetado rodasse nela (XSS), bastaria `config:set` pra mudar a pasta
 * de trabalho pra C:\ ou ligar o modo automático sem ninguém ver. As regras
 * aqui rodam no processo principal, fora do alcance de um script da página:
 *   - `workspace` só muda pelo diálogo de pasta (`workspace:choose`) — a
 *     interface nunca manda esse campo por aqui;
 *   - ligar `autonomy: 'auto'` exige confirmação num diálogo nativo;
 *   - `alwaysAllow` é saneado em Config.save (src/config.js).
 */
function filtrarPatchDeConfig(patch) {
  const seguro = { ...(patch && typeof patch === 'object' ? patch : {}) };
  delete seguro.workspace;
  delete seguro.mcpServidores; // só por `mcp:save`, que confirma cada programa novo
  delete seguro.dominiosPersonalizados; // só por `domains:save`
  delete seguro.acessoCelularCodigo; // só por `remoto:novoCodigo`
  if (seguro.autonomy === 'auto' && config.data.autonomy !== 'auto') {
    const escolha = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Ativar modo automático', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Modo automático',
      message: 'No modo automático o agente não pede confirmação pra nada.',
      detail:
        'Ele poderá rodar comandos, executar código, apagar arquivos e agir em sites sem perguntar. ' +
        'Páginas da web podem conter instruções escondidas pro agente. ' +
        'Use só com uma pasta de trabalho sem arquivos importantes.',
    });
    if (escolha !== 0) delete seguro.autonomy;
  }
  return seguro;
}

// Fase 2: "Restaurar padrões" em Ajustes. Os padrões leves de computador com
// pouca memória entram de novo, como numa instalação nova.
ipcMain.handle('config:restaurar', () => {
  const dados = config.restaurarPadroes(primeiroUso.padroesPorHardware(hardware.detectarHardware().ramTotalGB));
  if (agent) Object.assign(agent.config, configParaAgente());
  return dados;
});

ipcMain.handle('config:set', (_e, patch) => {
  const nomeAntesDoPatch = String(config.data.nomeDaChamada || '');
  const dados = config.save(filtrarPatchDeConfig(patch));
  if (patch && 'nomeDoUsuario' in patch) gravarNomeNaMemoria(patch.nomeDoUsuario);
  if (patch && 'atalhoDaTela' in patch) estadoDoAtalho = aplicarAtalhoDaTela();
  if (patch && 'acessoCelular' in patch) aplicarAcessoCelular().catch(() => {});
  if (patch && 'nomeDaChamada' in patch) aplicarNomeDaChamada({ zerar: String(patch.nomeDaChamada || '') !== nomeAntesDoPatch });
  if (agent) Object.assign(agent.config, configParaAgente());
  return dados;
});

/**
 * Reaproveita a MESMA checagem de saúde já usada no início e no polling de
 * 20s (renderer/app.js, verificarOllama) pra também carregar a oferta de
 * início automático — um único ponto de verdade em vez de duplicar a lógica
 * de detecção em app.whenReady(). Cobre tanto "offline desde o início" (a
 * primeira chamada, no carregamento da página) quanto "caiu no meio da
 * sessão" (uma chamada do polling), com o mesmo código.
 *
 * ofertaOllamaJaMostrada evita perguntar de novo a cada 20s enquanto
 * continuar offline (o usuário já viu e decidiu); volta a false quando fica
 * online, pra um episódio offline FUTURO ser oferecido de novo também.
 */
ipcMain.handle('ollama:health', async () => {
  const saude = await ollama.health(config.data.host);
  const debounce = ollamaRuntime.avaliarSaudeComDebounce(saude.online, falhasConsecutivasSaude);
  falhasConsecutivasSaude = debounce.falhasConsecutivas;
  if (saude.online) {
    ofertaOllamaJaMostrada = false;
    return saude;
  }
  // Ollama de outro PC (19/10): ligar o DESTE computador não resolve
  if (!ollamaRemoto.ehLocal(config.data.host)) return { ...saude, remoto: true };
  if (debounce.atingiuLimiar && !ofertaOllamaJaMostrada) {
    ofertaOllamaJaMostrada = true;
    if (config.data.ollamaIniciarAutomaticamente) {
      // usuário já marcou "sempre iniciar automaticamente" antes — nunca
      // pergunta de novo, só liga.
      ollamaRuntime.localizarEIniciar(config.data.host).catch(() => {});
    } else {
      const bin = ollamaRuntime.localizarBinario();
      // só oferece se o binário existir de verdade no PATH — sem isso não
      // há nada a "ativar", e o badge offline de sempre já cobre o caso.
      if (bin.encontrado) enviar('ollama-oferecer-inicio', {});
    }
  }
  return saude;
});

/**
 * Fase 2 (facilidade de uso, 2026-09-23): tudo que a tela de primeira
 * execução precisa, numa chamada só e SEM o debounce do polling de saúde —
 * quem acabou de abrir o app não pode esperar 20 s pra saber que falta o
 * Ollama. A decisão em si é pura (src/primeiro-uso.js, testada na bancada).
 */
ipcMain.handle('ollama:diagnostico', async () => {
  const saude = await ollama.health(config.data.host);
  let modelos = [];
  if (saude.online) {
    try {
      modelos = await ollama.listModels(config.data.host);
    } catch {
      modelos = [];
    }
  }
  // Ollama de outro PC fora do ar: o passo é ligar AQUELE (não instalar nem ligar o deste)
  if (!saude.online && !ollamaRemoto.ehLocal(config.data.host)) {
    return { ...primeiroUso.diagnosticarPrimeiroUso({ online: false, binarioEncontrado: true, ramTotalGB: hardware.detectarHardware().ramTotalGB, embedModel: config.data.embedModel }), etapa: 'remoto-desligado', host: config.data.host };
  }
  const binarioEncontrado = saude.online ? true : ollamaRuntime.localizarBinario().encontrado;
  return primeiroUso.diagnosticarPrimeiroUso({
    online: saude.online,
    binarioEncontrado,
    modelos,
    ramTotalGB: hardware.detectarHardware().ramTotalGB,
    embedModel: config.data.embedModel,
  });
});

ipcMain.handle('ollama:models', async () => {
  try {
    // Fase 2: modelos de embedding (nomic-embed-text e afins) não conversam —
    // antes podiam ser escolhidos sozinhos como modelo principal e tudo falhava.
    // revisão v5: com as capacidades (/api/show), modelos de decisão (tev1,
    // Nimble) também saem da lista e os que "pensam" (R1) vêm marcados
    const { conversa, embedding, decisao } = primeiroUso.separarModelos(await ollama.listModelsComCapacidades(config.data.host));
    return { ok: true, models: conversa, embedding, decisao };
  } catch (err) {
    return { ok: false, error: err.message, models: [] };
  }
});

/**
 * Resposta do usuário à oferta "Detectei que o Ollama está desligado. Deseja
 * que eu ative ele?" — `lembrar` grava a preferência pra próxima vez pular
 * direto pro início, sem perguntar de novo (mesmo princípio já usado pro
 * SearXNG embutido: nunca decide sozinho sem o usuário ter pedido uma vez).
 */
ipcMain.handle('ollama:iniciar', async (_e, { lembrar } = {}) => {
  if (lembrar) config.save({ ollamaIniciarAutomaticamente: true });
  return ollamaRuntime.localizarEIniciar(config.data.host);
});

/**
 * Baixa/instala um modelo no Ollama de dentro do app — item do Copiloto
 * nível 2 (hoje o app só LISTA modelos já instalados). Progresso repassado
 * pro renderer pelo mesmo canal genérico de sempre, seguindo exatamente o
 * padrão já usado pro SearXNG embutido (`runtime-searxng-progresso`).
 */
ipcMain.handle('ollama:pull', async (_e, { nome } = {}) => {
  try {
    // com novas tentativas e, se preciso, pelo programa `ollama pull` (src/baixar-modelo.js)
    const r = await require('../src/baixar-modelo').baixarModelo(nome, {
      host: config.data.host,
      onProgress: (p) => enviar('ollama-pull-progresso', p.porcento != null ? { status: p.status, total: 100, completed: p.porcento } : p),
    });
    return { ok: true, status: r.status, via: r.via };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// procurar e testar um Ollama de outro computador da rede (Ajustes → Avançado → Conexão)
ipcMain.handle('ollama:procurarNaRede', () => ollamaRemoto.procurarNaRede());
ipcMain.handle('ollama:testarServidor', (_e, { host } = {}) => ollamaRemoto.testar(host));
// só faz sentido quando o AuGPT usa o Ollama deste PC (com o de outro PC, quem expõe é aquele)
ipcMain.handle('ollama:exposicao', () => (ollamaRemoto.ehLocal(config.data.host) ? ollamaRemoto.expostoNaRede() : { exposto: false, ip: null }));

/**
 * Quadro "onde está rodando cada modelo" (2026-10-10): GPU, CPU ou
 * dividido, por papel da configuração (principal, embedding, Tev1,
 * copiloto). Ver src/modelos-carregados.js.
 */
// quem respondeu e quem falhou na última busca do SearXNG (painel central da barra)
ipcMain.handle('busca:saude', () => busca.saudeDaBusca());

ipcMain.handle('ollama:modelosCarregados', async () => {
  try {
    const carregados = await ollama.psModels(config.data.host);
    return { ok: true, linhas: montarQuadroDeModelos({ config: config.data, carregados }) };
  } catch (err) {
    return { ok: false, erro: err.message, linhas: montarQuadroDeModelos({ config: config.data, carregados: [] }) };
  }
});

ipcMain.handle('workspace:choose', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher pasta de trabalho do agente',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: config.data.workspace || app.getPath('documents'),
  });
  if (r.canceled || !r.filePaths[0]) return config.all;
  return config.save({ workspace: r.filePaths[0] });
});

ipcMain.handle('workspace:tree', () => {
  try {
    return new Sandbox(config.data.workspace).tree();
  } catch {
    return [];
  }
});

ipcMain.handle('workspace:read', async (_e, relativo) => {
  try {
    const sandbox = new Sandbox(config.data.workspace);
    const conteudo = await fsp.readFile(sandbox.resolve(relativo), 'utf8');
    return { ok: true, conteudo: conteudo.slice(0, 200000) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('workspace:open', () => shell.openPath(config.data.workspace));

ipcMain.handle('workspace:reveal', (_e, relativo) => {
  try {
    shell.showItemInFolder(new Sandbox(config.data.workspace).resolve(relativo));
    return true;
  } catch {
    return false;
  }
});

/*
 * Pedido real do Davi (v0.5.7): arquivo gerado pelo agente (pdf/docx/xlsx/
 * html/txt) não devia só ser escrito direto na pasta de trabalho sem
 * nenhum aviso — precisava aparecer ANEXADO no chat, com opção de
 * visualizar dentro do próprio AuGPT e um botão "Salvar como…" que abre o
 * diálogo nativo do Windows (mesmo padrão já usado em chats:export/
 * runs:export logo abaixo). O arquivo CONTINUA sendo escrito na pasta de
 * trabalho de verdade (decisão do Davi) — só o fluxo de exibição mudou.
 *
 * docx/xlsx reaproveitam o leitor OOXML que já existe (src/formatos/
 * ooxml.js, usado por ler_documento) — vira o mesmo texto em markdown que
 * o agente lê, exibido com o mesmo renderizador de markdown do chat
 * (window.md.render, no lado do renderer). Zero dependência nova, no
 * mesmo espírito de zero pacotes externos do resto do projeto.
 */
const EXTENSOES_TEXTO_PREVIA = new Set(['.txt', '.csv', '.json', '.log']);
const EXTENSOES_IMAGEM_PREVIA = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};
const TETO_PREVIA_BYTES = 20 * 1024 * 1024; // acima disso, só "abrir com o app padrão"

ipcMain.handle('arquivos:previa', async (_e, relativo) => {
  try {
    const sandbox = new Sandbox(config.data.workspace);
    const caminho = sandbox.resolve(relativo);
    const stat = await fsp.stat(caminho);
    const ext = path.extname(caminho).toLowerCase();

    if (stat.size > TETO_PREVIA_BYTES) {
      return { ok: true, tipo: 'indisponivel', motivo: 'arquivo grande demais pra pré-visualizar aqui' };
    }
    if (ext === '.pdf') {
      const b64 = (await fsp.readFile(caminho)).toString('base64');
      return { ok: true, tipo: 'pdf', dataUrl: `data:application/pdf;base64,${b64}` };
    }
    if (ext === '.html' || ext === '.htm') {
      return { ok: true, tipo: 'html', conteudo: await fsp.readFile(caminho, 'utf8') };
    }
    if (ext === '.docx') {
      const r = ooxml.docx(await fsp.readFile(caminho));
      return { ok: true, tipo: 'markdown', conteudo: r.texto };
    }
    if (ext === '.xlsx') {
      const r = ooxml.xlsx(await fsp.readFile(caminho));
      return { ok: true, tipo: 'markdown', conteudo: r.texto };
    }
    if (EXTENSOES_IMAGEM_PREVIA[ext]) {
      const b64 = (await fsp.readFile(caminho)).toString('base64');
      return { ok: true, tipo: 'imagem', dataUrl: `data:${EXTENSOES_IMAGEM_PREVIA[ext]};base64,${b64}` };
    }
    if (ext === '.md') {
      return { ok: true, tipo: 'markdown', conteudo: (await fsp.readFile(caminho, 'utf8')).slice(0, 200000) };
    }
    if (EXTENSOES_TEXTO_PREVIA.has(ext)) {
      return { ok: true, tipo: 'texto', conteudo: (await fsp.readFile(caminho, 'utf8')).slice(0, 200000) };
    }
    return { ok: true, tipo: 'indisponivel', motivo: 'formato sem pré-visualização própria' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('arquivos:salvarComo', async (_e, relativo) => {
  try {
    const sandbox = new Sandbox(config.data.workspace);
    const origem = sandbox.resolve(relativo);
    const nome = path.basename(origem);
    const r = await dialog.showSaveDialog(win, {
      title: 'Salvar arquivo',
      defaultPath: path.join(app.getPath('documents'), nome),
    });
    if (r.canceled || !r.filePath) return { ok: false };
    await fsp.copyFile(origem, r.filePath);
    shell.showItemInFolder(r.filePath);
    return { ok: true, caminho: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('arquivos:abrirExterno', async (_e, relativo) => {
  try {
    const sandbox = new Sandbox(config.data.workspace);
    const alvo = sandbox.resolve(relativo);
    // Fase 1 de segurança: executável/script não abre direto — ver
    // podeAbrirComAppPadrao em src/tools/sandbox.js.
    if (!podeAbrirComAppPadrao(alvo)) {
      shell.showItemInFolder(alvo);
      return {
        ok: false,
        error: 'Por segurança, este tipo de arquivo não é aberto direto pelo AuGPT. Ele foi mostrado na pasta — abra por lá se tiver certeza.',
      };
    }
    const erro = await shell.openPath(alvo);
    return erro ? { ok: false, error: erro } : { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('memory:stats', () => {
  try {
    const sandbox = new Sandbox(config.data.workspace);
    const mem = new Memory({ dir: path.join(sandbox.root, '.augpt'), config: config.data });
    return { total: mem.tamanho };
  } catch {
    return { total: 0 };
  }
});

ipcMain.handle('memory:operacional', () => {
  try {
    return new MemoriaOperacional(path.join(new Sandbox(config.data.workspace).root, '.augpt')).listar();
  } catch {
    return [];
  }
});

ipcMain.handle('memory:operacionalEsquecer', (_e, { chave, tipo }) => {
  try {
    const m = new MemoriaOperacional(path.join(new Sandbox(config.data.workspace).root, '.augpt'));
    return chave ? m.esquecer(chave, tipo) : m.limpar();
  } catch {
    return 0;
  }
});

// Diferente da operacional, fica em userData — vale para qualquer pasta.
ipcMain.handle('memory:central', () => new MemoriaCentral(app.getPath('userData')).listar());

ipcMain.handle('memory:centralEsquecer', (_e, chave) => new MemoriaCentral(app.getPath('userData')).esquecer(chave));

ipcMain.handle('memory:centralLimpar', () => new MemoriaCentral(app.getPath('userData')).limpar());

// instrução por assunto pelos Ajustes (27/10): o mesmo formato do chat (src/agent/memoria-no-chat.js)
ipcMain.handle('memory:centralInstrucao', (_e, { assunto, instrucao } = {}) => {
  const a = String(assunto || '').trim().slice(0, 60);
  let t = String(instrucao || '').trim().replace(/\s*[.!]+$/, '').slice(0, 200);
  if (!a || t.length < 4) return null;
  t = `${t[0].toUpperCase()}${t.slice(1)}.`;
  return new MemoriaCentral(app.getPath('userData')).definir({ chave: `instrucao_${a}`, valor: `Quando o assunto for ${a}: ${t}` });
});

ipcMain.handle('memory:clear', () => {
  try {
    const sandbox = new Sandbox(config.data.workspace);
    const mem = new Memory({ dir: path.join(sandbox.root, '.augpt'), config: config.data });
    mem.limpar();
    return true;
  } catch {
    return false;
  }
});

// ----------------------------- skills -----------------------------

ipcMain.handle('skills:list', () => ({
  skills: skills.todas(config.data.skillsDesativadas || []).map(({ corpo, ...resto }) => ({
    ...resto,
    previa: corpo.slice(0, 260),
  })),
  indisponiveis: tools.EXTERNAS.filter((f) => !f.disponivel).map((f) => f.name),
  pastaUsuario: skills.dirUsuario,
}));

ipcMain.handle('skills:read', (_e, id) => {
  const skill = skills.ler(id);
  return skill ? { ok: true, bruto: skill.bruto, caminho: skill.caminho, nome: skill.nome } : { ok: false };
});

ipcMain.handle('skills:toggle', (_e, { id, ativa }) => {
  const atuais = new Set(config.data.skillsDesativadas || []);
  if (ativa) atuais.delete(id);
  else atuais.add(id);
  const dados = config.save({ skillsDesativadas: [...atuais] });
  if (agent) Object.assign(agent.config, dados);
  return dados;
});

ipcMain.handle('skills:reload', () => ({ total: skills.recarregar().length }));

ipcMain.handle('skills:create', (_e, nome) => {
  try {
    const criada = skills.criar(String(nome || 'Nova skill').trim());
    shell.showItemInFolder(criada.caminho);
    return { ok: true, ...criada };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('skills:openFolder', () => shell.openPath(skills.dirUsuario));

ipcMain.handle('skills:openFile', (_e, id) => {
  const skill = skills.ler(id);
  if (!skill) return false;
  shell.showItemInFolder(skill.caminho);
  return true;
});

// Criação automática de skills (item 5): sugestões que o próprio agente
// propôs (nunca ativas numa conversa real até aprovadas — ver
// Skills.selecionar()) aparecem aqui pra revisão.
ipcMain.handle('skills:sugeridas', () =>
  skills
    .todas(config.data.skillsDesativadas || [])
    .filter((s) => s.sugerida)
    .map(({ corpo, ...resto }) => ({ ...resto, previa: corpo.slice(0, 600) }))
);

ipcMain.handle('skills:aprovarSugestao', (_e, id) => skills.aprovarSugestao(id));

ipcMain.handle('skills:descartarSugestao', (_e, id) => skills.descartarSugestao(id));

ipcMain.handle('skills:preview', async (_e, texto) => {
  const opcoes = {
    desativadas: config.data.skillsDesativadas || [],
    host: config.data.host,
    embedModel: config.data.embedModel,
  };
  const escolhidas = await skills.selecionar(String(texto || ''), { ...opcoes, etapa: 'decisao' });
  const naRedacao = await skills.selecionar(String(texto || ''), { ...opcoes, etapa: 'redacao' });
  return {
    decisao: escolhidas.map((s) => s.nome),
    redacao: naRedacao.map((s) => s.nome),
  };
});

ipcMain.handle('agent:start', async (_e, { objetivo, conversa, idConversa } = {}) => {
  if (agent?.rodando) return { ok: false, error: 'Já existe uma execução em andamento.' };
  pararConferencia(); // a checagem da agenda em segundo plano não disputa o modelo com você
  criarAgente(idConversa);
  // Peça "resumo de conversa" 2026-09-21: o resumo acumulado (se esta
  // conversa já tiver um, de uma fusão anterior) mora no próprio JSON da
  // conversa — lido aqui, síncrono, antes de disparar run(), e devolvido de
  // volta via o evento 'resumo-conversa' (ver criarAgente() e Conversas
  // .atualizarResumo). Conversa nova ou sem resumo ainda: segue vazio, sem
  // custo extra nenhum.
  const conversaSalva = idConversa ? conversas.ler(idConversa) : null;
  // Item 1 da análise comparativa (2026-09-21): só repassa a `Tarefa` da
  // execução anterior desta conversa quando ela ficou incompleta (app
  // fechado, `parar()`, limite de rodadas) — `estado !== 'concluida'`. Uma
  // tarefa que terminou não deve "vazar" checklist velho pra um pedido novo
  // na mesma conversa; `tarefa.retomarDe()` (loop.js/tarefa.js) ainda filtra
  // de novo por subtarefa `pendente`, então isto aqui é só o primeiro filtro,
  // barato, pra não nem serializar/repassar objeto à toa no caso comum.
  const tarefaAnterior = conversaSalva?.tarefa?.estado && conversaSalva.tarefa.estado !== 'concluida'
    ? conversaSalva.tarefa
    : null;
  agent
    .run(String(objetivo || '').trim(), Array.isArray(conversa) ? conversa : [], idConversa || null, {
      resumoConversa: conversaSalva?.resumoConversa || '',
      resumoConversaTurnos: conversaSalva?.resumoConversaTurnos || 0,
      tarefaAnterior,
    })
    .catch((err) => enviar('erro', { mensagem: err.message, amigavel: primeiroUso.mensagemAmigavel(err.message) }));
  return { ok: true };
});

ipcMain.handle('agent:stop', () => {
  agent?.parar();
  return { ok: true };
});

ipcMain.handle('agent:respond', (_e, { id, valor }) => ({ ok: Boolean(agent?.responder(id, valor)) }));

// ----------------------------- rotina automática (agendamentos) -----------------------------
//
// Roda enquanto o app estiver aberto: a cada minuto confere se algum
// agendamento deveria disparar e, se sim, chama agent.run() do mesmo jeito
// que um pedido digitado pelo usuário — reaproveita 100% do loop, das
// rotinas (skill + workflow.json) e da UI que já existem. Não há ícone de
// bandeja nem início automático com o sistema: com a janela fechada, nada
// dispara.

let verificadorDeAgendamentos = null;
let disparandoAgendamento = false;

function marcarUltimaExecucao(id, quando) {
  const lista = (config.data.agendamentos || []).map((a) => (a.id === id ? { ...a, ultimaExecucao: quando } : a));
  config.save({ agendamentos: lista });
  return lista;
}

function dispararAgendamento(item) {
  if (agent?.rodando || disparandoAgendamento) {
    enviar('agendamento-pulado', { id: item.id, texto: item.texto, motivo: 'agente ocupado' });
    return;
  }
  disparandoAgendamento = true;
  marcarUltimaExecucao(item.id, Date.now());
  enviar('agendamento-disparado', { id: item.id, texto: item.texto });
  criarAgente();
  agent
    .run(item.texto, [])
    .catch((err) => enviar('erro', { mensagem: err.message }))
    .finally(() => {
      disparandoAgendamento = false;
    });
}

function verificarAgendamentos() {
  const lista = config.data.agendamentos || [];
  // só um por checagem: o agente só roda uma execução por vez mesmo, e
  // disparar o segundo já cairia no "agente ocupado" acima
  const [primeiro] = agendador.agendamentosParaDisparar(lista, Date.now());
  if (primeiro) dispararAgendamento(primeiro);
}

function iniciarAgendador() {
  if (verificadorDeAgendamentos) clearInterval(verificadorDeAgendamentos);
  verificadorDeAgendamentos = setInterval(() => {
    verificarAgendamentos();
    verificarAgenda();
  }, 60000);
  setTimeout(verificarAgenda, 5000); // o que venceu com o app fechado (até 12 h) avisa logo ao abrir
}

/* ------------------------------ ditado por voz (24/10) ------------------------------ */
// O Whisper roda no processador (src/ditado.js); a tela grava, converte para WAV 16 kHz e manda os
// bytes; o arquivo temporário é apagado logo depois. Instala só no clique (Ajustes → Componentes).
const { Ditado } = require('../src/ditado');
let ditado = null;
ipcMain.handle('ditado:estado', () => (ditado ? { ...ditado.estado(), escutaEmUso: ditado.modeloDaEscuta(config.data.escutaModelo) } : { instalado: false }));
ipcMain.handle('ditado:instalar', async () => {
  try {
    return { ok: true, estado: await ditado.instalar({ emitir: (p) => enviar('ditado-progresso', p) }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// "Ei GPT" (25/10): o modelo pequeno da escuta, a checagem de cada frase curta e a correção do texto
ipcMain.handle('ditado:instalarEscuta', async (_e, { modelo } = {}) => {
  try {
    return { ok: true, estado: await ditado.instalarEscuta({ modelo: modelo === 'base' ? 'base' : 'small', emitir: (p) => enviar('ditado-progresso', p) }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
const ehWav = (audio, maxSegundos) => audio.length >= 1000 && audio.length <= 44 + 32000 * maxSegundos && audio.toString('latin1', 0, 4) === 'RIFF' && audio.toString('latin1', 8, 12) === 'WAVE';
// as últimas frases que a escuta ouviu (só na memória, até fechar o app): quando o "Ei GPT" não
// reage, Ajustes mostra o que o Whisper escreveu no lugar
// 25/10 (relato do Davi: "não está salvando minhas amostras"): o registro ficava só na memória e sumia
// ao fechar o app; agora fica em <dados>/escuta-registro.json (só o texto que o Whisper escreveu, nunca o
// áudio), e as frases do treino entram também
const registroDaEscuta = [];
const arquivoDoRegistro = () => path.join(app.getPath('userData'), 'escuta-registro.json');
function carregarRegistroDaEscuta() {
  try {
    const lista = JSON.parse(fs.readFileSync(arquivoDoRegistro(), 'utf8'));
    if (Array.isArray(lista)) registroDaEscuta.push(...lista.filter((x) => x && typeof x.texto === 'string').slice(0, 60));
  } catch {
    // ainda não existe
  }
}
let gravacaoDoRegistro = null;
function anotarNaEscuta(item) {
  registroDaEscuta.unshift({ em: Date.now(), ...item, texto: String(item.texto || '').slice(0, 200) });
  registroDaEscuta.length = Math.min(registroDaEscuta.length, 60);
  clearTimeout(gravacaoDoRegistro);
  gravacaoDoRegistro = setTimeout(() => {
    try {
      fs.writeFileSync(arquivoDoRegistro(), JSON.stringify(registroDaEscuta));
    } catch {
      // disco cheio ou sem permissão: fica só na memória desta vez
    }
  }, 1500);
}
// só as variantes que soam como "GPT" (25/10: "somdebarulho" — o teclado — tinha entrado pelo treino)
const variantesDaEscuta = () => require('../src/ditado').variantesValidas(config.data.escutaVariantes);
// aprender com o uso (25/10, "quanto mais eu treinar, melhor"): a chamada que virou pedido de verdade
// ensina como o Whisper escreve a sua pronúncia; e o "Era eu" no registro ensina a que ele não pegou
let ultimaChamada = null;
let tentativaPerdida = null;
function aprenderChamada(junto) {
  const { varianteValida, juntarVariantes, ehChamada } = require('../src/ditado');
  if (!junto || !varianteValida(junto) || ehChamada(junto) || variantesDaEscuta().includes(junto)) return false;
  config.save({ escutaVariantes: juntarVariantes([junto], config.data.escutaVariantes) });
  return true;
}
async function ouvirFrase(bytes, { variantes = variantesDaEscuta() } = {}) {
  const audio = Buffer.from(bytes || []);
  if (!ehWav(audio, 8)) return { ok: false, error: 'áudio inválido' };
  const arquivo = path.join(app.getPath('temp'), `augpt-chamada-${Date.now()}.wav`);
  try {
    fs.writeFileSync(arquivo, audio);
    return { ok: true, ...(await ditado.ouvirChamada(arquivo, { idioma: idiomaEfetivo(), modelo: config.data.escutaModelo, variantes })) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
}
ipcMain.handle('ditado:chamada', async (_e, bytes, pelaVoz = null) => {
  if (!config.data.ouvirChamada || !ditado?.escutaInstalada()) return { ok: false, error: 'escuta desligada' };
  const r = await ouvirFrase(bytes);
  // a decisão com dois sinais (25/10): pelo texto, como antes; OU pelo som da voz (as gravações do treino,
  // renderer/voz.js) quando o começo do texto ao menos lembra o nome — a TV falando outra coisa não passa
  if (r.ok && !r.chamou && pelaVoz?.chamou === true && r.parecido) {
    r.chamou = true;
    r.pelaVoz = true;
  }
  if (r.ok && r.chamou) ultimaChamada = { junto: require('../src/ditado').chamadaEscrita(r.texto, variantesDaEscuta()), em: Date.now() };
  // aprender com a repetição (25/10): você falou, a escuta não pegou, você repetiu e pegou — a 1ª era você
  // chamando ("e jepeite" ✗ e logo depois "E aí, jepeta!" ✓, no registro real)
  // 27/10 (registro do Davi): "Correção tudo a hora pega, véi." virou a variante "correcao" de "Ei Jarvis" —
  // só conta frase curta que ao menos lembra o nome
  if (r.ok && !r.chamou && r.texto && r.parecido && String(r.texto).trim().split(/\s+/).length <= 4) tentativaPerdida = { junto: require('../src/ditado').chamadaEscrita(r.texto), em: Date.now() };
  else if (r.ok && !r.chamou && r.texto) tentativaPerdida = null;
  else if (r.ok && r.chamou && tentativaPerdida?.junto && Date.now() - tentativaPerdida.em < 15000) {
    aprenderChamada(tentativaPerdida.junto);
    tentativaPerdida = null;
  }
  if (r.ok && r.texto) {
    anotarNaEscuta({ texto: r.texto, chamou: r.chamou, pelaVoz: Boolean(r.pelaVoz), custo: Number.isFinite(pelaVoz?.custo) ? Math.round(pelaVoz.custo * 10) / 10 : undefined, ms: r.ms, modelo: r.modelo });
  }
  return r;
});
ipcMain.handle('ditado:registroDaEscuta', () => registroDaEscuta);
// "Era eu chamando" numa frase que a escuta não pegou: as primeiras palavras que soam como "GPT" viram variante
ipcMain.handle('ditado:aprenderChamada', (_e, texto) => {
  const junto = require('../src/ditado').chamadaEscrita(String(texto || '').slice(0, 200));
  if (!junto) return { ok: false, error: 'não parece um "Ei GPT" (precisa soar como "gê-pê-tê")' };
  return { ok: true, aprendeu: aprenderChamada(junto), junto, config: config.data };
});
ipcMain.handle('ditado:limparRegistroDaEscuta', () => {
  registroDaEscuta.length = 0;
  fs.rmSync(arquivoDoRegistro(), { force: true });
  return true;
});
// a impressão do som das gravações do treino (renderer/voz.js): números, nunca o áudio; até 12, as mais novas
const arquivoDaVoz = () => path.join(app.getPath('userData'), 'escuta-voz.json');
function lerVoz() {
  try {
    const v = JSON.parse(fs.readFileSync(arquivoDaVoz(), 'utf8'));
    return v && Array.isArray(v.modelos) ? v : { modelos: [] };
  } catch {
    return { modelos: [] };
  }
}
const quadrosValidos = (q) => Array.isArray(q) && q.length >= 15 && q.length <= 400 && q.every((f) => Array.isArray(f) && f.length === 12 && f.every(Number.isFinite));
ipcMain.handle('ditado:vozDoUsuario', () => lerVoz().modelos);
// trocar o nome do assistente (25/10): as gravações e as grafias aprendidas eram de OUTRA palavra — zeram
function aplicarNomeDaChamada({ zerar = false } = {}) {
  require('../src/ditado').definirNome(config.data.nomeDaChamada || 'GPT');
  if (zerar) {
    config.save({ escutaVariantes: [] });
    fs.rmSync(arquivoDaVoz(), { force: true });
  }
}
// o que o treino aprendeu, e tirar um jeito que não devia estar lá (Ajustes → Geral)
ipcMain.handle('ditado:esquecerVariante', (_e, variante) => {
  config.save({ escutaVariantes: (config.data.escutaVariantes || []).filter((v) => v !== String(variante || '')) });
  return config.data;
});
// o treino da voz (Ajustes → Geral): cada "Ei GPT" gravado passa pelo modelo da escuta SEM as variantes
// já aprendidas (o resultado mostra se o modelo sozinho reconheceu); no fim, guarda as variantes e a sensibilidade
ipcMain.handle('ditado:treinarFrase', async (_e, bytes) => {
  if (!ditado?.escutaInstalada()) return { ok: false, error: 'escuta não instalada' };
  const r = await ouvirFrase(bytes, { variantes: [] });
  if (r.ok) anotarNaEscuta({ texto: r.texto || '(nada)', chamou: r.chamou, ms: r.ms, modelo: r.modelo, treino: true });
  if (r.ok) r.ouviu = Boolean(String(r.texto || '').trim()); // vazio: ruído ou nada — o treino pede de novo
  return r;
});
// o treino SOMA (25/10): as variantes novas entram junto das que já havia (até 24) e a sensibilidade sai
// do volume de todos os treinos (os últimos 30 "Ei GPT")
ipcMain.handle('ditado:salvarTreino', (_e, { textos = [], niveis = [], amostras = [] } = {}) => {
  const novas = (Array.isArray(amostras) ? amostras : []).filter(quadrosValidos).slice(0, 12);
  if (novas.length) {
    try {
      fs.writeFileSync(arquivoDaVoz(), JSON.stringify({ nome: config.data.nomeDaChamada || 'GPT', modelos: [...novas, ...lerVoz().modelos].slice(0, 12) }));
    } catch {
      // sem gravar: a escuta segue só pelo texto
    }
  }
  const { variantesDoTreino, sensibilidadeDoTreino, juntarVariantes } = require('../src/ditado');
  const { variantes, recusadas } = variantesDoTreino((Array.isArray(textos) ? textos : []).map((t) => String(t || '').slice(0, 200)).slice(0, 12));
  const antes = variantesDaEscuta().length;
  const todas = juntarVariantes(variantes, config.data.escutaVariantes);
  const todosOsNiveis = [...(Array.isArray(niveis) ? niveis : []).map(Number).filter((n) => n > 0).slice(0, 12), ...(config.data.escutaNiveis || [])].slice(0, 30);
  const sensibilidade = sensibilidadeDoTreino(todosOsNiveis);
  config.save({ escutaVariantes: todas, escutaNiveis: todosOsNiveis, ...(sensibilidade ? { escutaSensibilidade: sensibilidade } : {}) });
  return { ok: true, variantes, novas: todas.length - antes, total: todas.length, treinos: todosOsNiveis.length, recusadas, sensibilidade, gravacoes: lerVoz().modelos.length, config: config.data };
});
ipcMain.handle('ditado:apagarTreino', () => {
  config.save({ escutaVariantes: [], escutaSensibilidade: null, escutaNiveis: [] });
  fs.rmSync(arquivoDaVoz(), { force: true });
  return config.data;
});
// o pedido depois do "Ei GPT": o turbo transcreve tudo, a chamada sai do começo e os comandos diretos
// ("nova conversa", "para") são reconhecidos aqui
ipcMain.handle('ditado:pedidoDeVoz', async (_e, bytes) => {
  if (!ditado?.instalado()) return { ok: false, error: 'nao-instalado' };
  const audio = Buffer.from(bytes || []);
  if (!ehWav(audio, 90)) return { ok: false, error: 'áudio inválido' };
  const arquivo = path.join(app.getPath('temp'), `augpt-pedido-${Date.now()}.wav`);
  try {
    fs.writeFileSync(arquivo, audio);
    const { semChamada, comandoDeVoz } = require('../src/ditado');
    const r = await ditado.transcrever(arquivo, { idioma: idiomaEfetivo() });
    const pedido = require('../src/ditado').limparPedidoFalado(semChamada(r.texto, variantesDaEscuta()), variantesDaEscuta());
    // a chamada virou pedido (ou comando): é a sua voz — o jeito que o Whisper escreveu fica aprendido
    if (ultimaChamada && Date.now() - ultimaChamada.em < 120000 && (pedido || comandoDeVoz(pedido))) aprenderChamada(ultimaChamada.junto);
    ultimaChamada = null;
    return { ok: true, texto: r.texto, pedido, comando: comandoDeVoz(pedido), ms: r.ms };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
});
// a correção pelo modelo (Ajustes → Geral): só ortografia e palavras ouvidas errado; na dúvida, fica o original
ipcMain.handle('ditado:corrigir', async (_e, texto) => {
  const original = String(texto || '').slice(0, 2000).trim();
  if (!original || config.data.ditadoCorrigir === false) return { ok: true, texto: original, corrigiu: false };
  const { pedidoDeCorrecao, correcaoAceitavel } = require('../src/ditado');
  try {
    const cfg = configParaAgente();
    const r = await ollama.chat({ host: cfg.host, model: cfg.model, messages: [{ role: 'user', content: pedidoDeCorrecao(original, idiomaEfetivo()) }], pensar: false, temperature: 0.1, numPredict: 400, numCtx: 4096, signal: AbortSignal.timeout(20000) });
    const corrigido = correcaoAceitavel(original, r.content);
    return { ok: true, texto: corrigido || original, corrigiu: Boolean(corrigido && corrigido !== original) };
  } catch (err) {
    return { ok: true, texto: original, corrigiu: false, aviso: err.message };
  }
});
/* ------------------------------ "o que tem na minha tela?" (25/10) ------------------------------ */
// Ctrl+Alt+A (de qualquer lugar do Windows), o botão da caixa do Agente ou "Ei GPT, o que é isso na
// tela?": o AuGPT sai da frente, fotografa a tela onde está o mouse e você escolhe a área (Enter = a tela
// inteira; Esc cancela). A imagem vai para a pasta de trabalho como anexo — o mesmo caminho do "+",
// que o agente já sabe olhar. Nada sai do computador.
const ATALHO_DA_TELA = 'Control+Alt+A';
let capturando = false;
const esperarMs = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** A foto da tela onde está o mouse, com o AuGPT fora da frente. → { imagem, display, voltar } */
async function fotografarTela() {
  const { desktopCapturer, screen } = require('electron');
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const estavaNaFrente = Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
  if (estavaNaFrente) {
    win.hide();
    await esperarMs(280); // a janela some de verdade antes da foto
  }
  const escala = display.scaleFactor || 1;
  const fontes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * escala), height: Math.round(display.size.height * escala) } });
  const fonte = fontes.find((f) => String(f.display_id) === String(display.id)) || fontes[0];
  if (!fonte || fonte.thumbnail.isEmpty()) throw new Error('o Windows não deixou fotografar a tela');
  return { imagem: fonte.thumbnail, display, voltar: () => estavaNaFrente && win && !win.isDestroyed() && (win.show(), win.focus()) };
}

/** A tela congelada por cima de tudo; você arrasta a área. → { x, y, width, height } (em pontos da tela), 'tudo' ou null */
function escolherArea(imagem, display) {
  return new Promise((ok) => {
    const janela = new BrowserWindow({
      ...display.bounds,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'recorte-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    janela.setAlwaysOnTop(true, 'screen-saver');
    janela.setBounds(display.bounds);
    let terminou = false;
    const terminar = (r) => {
      if (terminou) return;
      terminou = true;
      ipcMain.removeHandler('recorte:imagem');
      ipcMain.removeAllListeners('recorte:escolha');
      if (!janela.isDestroyed()) janela.close();
      ok(r);
    };
    ipcMain.handle('recorte:imagem', (e) => (e.sender === janela.webContents ? { imagem: imagem.toDataURL(), idioma: idiomaEfetivo() } : null));
    ipcMain.on('recorte:escolha', (e, r) => {
      if (e.sender !== janela.webContents) return;
      const ok2 = r === 'tudo' || (r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 8 && r.height >= 8);
      terminar(ok2 ? r : null);
    });
    janela.on('closed', () => terminar(null));
    janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    janela.webContents.on('will-navigate', (e) => e.preventDefault());
    janela.loadFile(path.join(__dirname, '../renderer/recorte.html'));
    janela.once('ready-to-show', () => {
      janela.show();
      janela.focus();
    });
  });
}

/** Captura e anexa: com `inteira`, sem escolher área (pela voz). Avisa a tela com 'tela-capturada'. */
async function capturarParaOChat({ inteira = false, pergunta = '' } = {}) {
  if (capturando) return { ok: false, error: 'já há uma captura em andamento' };
  capturando = true;
  let voltar = () => {};
  try {
    const foto = await fotografarTela();
    voltar = foto.voltar;
    let imagem = foto.imagem;
    if (!inteira) {
      const area = await escolherArea(imagem, foto.display);
      if (!area) {
        if (win && !win.isDestroyed()) (win.show(), win.focus());
        return { ok: false, cancelado: true };
      }
      if (area !== 'tudo') {
        const s = imagem.getSize().width / foto.display.bounds.width;
        imagem = imagem.crop({ x: Math.round(area.x * s), y: Math.round(area.y * s), width: Math.round(area.width * s), height: Math.round(area.height * s) });
      }
    }
    const sandbox = new Sandbox(config.data.workspace);
    const agora = new Date();
    const dois = (n) => String(n).padStart(2, '0');
    const nome = `captura-${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}.png`;
    const destino = sandbox.resolve(nome);
    const png = imagem.toPNG();
    fs.writeFileSync(destino, png);
    const anexo = { nome, relativo: sandbox.relative(destino), tamanho: png.length, ehTexto: false, texto: null, captura: true };
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    enviar('tela-capturada', { anexo, pergunta: String(pergunta || '').slice(0, 2000) });
    return { ok: true, anexo };
  } catch (err) {
    voltar();
    return { ok: false, error: err.message };
  } finally {
    capturando = false;
  }
}
ipcMain.handle('tela:capturar', (_e, opcoes = {}) => capturarParaOChat({ inteira: opcoes.inteira === true, pergunta: opcoes.pergunta }));

/** O atalho Ctrl+Alt+A, ligado em Ajustes → Geral (padrão: ligado). → true, false, ou 'ocupado' (outro programa já usa) */
function aplicarAtalhoDaTela() {
  const { globalShortcut } = require('electron');
  if (globalShortcut.isRegistered(ATALHO_DA_TELA)) globalShortcut.unregister(ATALHO_DA_TELA);
  if (config.data.atalhoDaTela === false) return false;
  return globalShortcut.register(ATALHO_DA_TELA, () => capturarParaOChat()) ? true : 'ocupado';
}
let estadoDoAtalho = false;
ipcMain.handle('tela:atalho', () => ({ atalho: 'Ctrl+Alt+A', estado: estadoDoAtalho }));

ipcMain.handle('janela:trazer', () => {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
});
ipcMain.handle('ditado:transcrever', async (_e, bytes) => {
  if (!ditado?.instalado()) return { ok: false, error: 'nao-instalado' };
  const audio = Buffer.from(bytes || []);
  // só WAV, até 3 minutos (16 kHz × 16 bits × mono)
  if (audio.length < 1000 || audio.length > 44 + 32000 * 180 || audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') return { ok: false, error: 'áudio inválido' };
  const arquivo = path.join(app.getPath('temp'), `augpt-ditado-${Date.now()}.wav`);
  try {
    fs.writeFileSync(arquivo, audio);
    return { ok: true, ...(await ditado.transcrever(arquivo, { idioma: idiomaEfetivo() })) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
});

/* ------------------------------ agenda (23/10, bloco 2) ------------------------------ */
// Lembretes avisam pelo Windows na hora (com o AuGPT aberto); assuntos acompanhados são conferidos
// uma vez por dia, em segundo plano, por um agente separado que não aparece no chat — só com o
// agente parado, e para assim que você manda uma mensagem.
const { Agenda, conferirAssunto } = require('../src/agenda');
const calendarioNoChat = require('../src/agent/calendario-no-chat');
let agenda = null;
let conferindo = null; // o agente da checagem em andamento
const inicioDoApp = Date.now();

function avisar(titulo, corpo, item, aoClicar = () => enviar('agenda-abrir', { id: item?.id })) {
  try {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: titulo, body: corpo, silent: false, icon: ICONE });
    n.on('click', () => {
      const janela = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
      if (janela) {
        if (janela.isMinimized()) janela.restore();
        janela.show();
        janela.focus();
      }
      aoClicar();
    });
    n.show();
  } catch (err) {
    console.warn('aviso da agenda:', err.message);
  }
}

function verificarAgenda() {
  if (!agenda) return;
  const en = idiomaEfetivo() === 'en';
  for (const item of agenda.paraAvisar(new Date())) {
    agenda.atualizar(item.id, { avisado: true });
    const quando = item.diaInteiro ? (en ? 'today' : 'hoje') : String(item.quando).slice(11, 16);
    avisar(en ? `AuGPT reminder · ${quando}` : `Lembrete do AuGPT · ${quando}`, item.titulo, item);
    enviar('agenda-mudou', { avisado: item.id });
  }
  // um assunto por vez, com o agente parado e o app aberto há 3 min (não disputa a abertura)
  if (conferindo || agent?.rodando || fundo?.ocupada || disparandoAgendamento || Date.now() - inicioDoApp < 3 * 60000) return;
  const [proximo] = agenda.paraConferir(Date.now());
  if (proximo) conferirAcompanhamento(proximo).catch((err) => console.warn('acompanhamento:', err.message));
}

/** Alerta de preço (24/10): só as lojas (src/tools/precos.js), sem modelo; avisa abaixo do valor. */
async function conferirPreco(item) {
  const assunto = item.acompanhar.assunto;
  const marcador = { parar() {} };
  conferindo = marcador;
  enviar('agenda-conferindo', { id: item.id, conferindo: true });
  const en = idiomaEfetivo() === 'en';
  const reais = (v) => `R$ ${Number(v).toLocaleString(en ? 'en-US' : 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  try {
    const precos = require('../src/tools/precos');
    const r = await precos.buscarOfertas(assunto).catch((err) => ({ erro: err.message, ofertas: [] }));
    const menor = precos.menorConfiavel(r.ofertas || []);
    const aconteceu = Boolean(menor && menor.preco <= item.acompanhar.limite);
    agenda.atualizar(item.id, {
      acompanhar: {
        ultimaVerificacao: Date.now(),
        erro: r.erro || (menor ? null : en ? 'no offer for this exact product' : 'nenhuma oferta do produto exato'),
        menor: menor?.preco ?? null,
        link: menor?.link ?? null,
        resumo: menor ? (en ? `lowest today: ${reais(menor.preco)} at ${menor.loja}` : `menor hoje: ${reais(menor.preco)} na ${menor.loja}`) : '',
        ...(aconteceu ? { status: 'aconteceu' } : {}),
      },
    });
    if (aconteceu) avisar(en ? `Price drop: ${assunto}` : `Baixou: ${assunto}`, `${reais(menor.preco)} — ${menor.loja}`, item);
  } finally {
    if (conferindo === marcador) conferindo = null;
    enviar('agenda-conferindo', { id: item.id, conferindo: false });
    enviar('agenda-mudou', {});
  }
}

async function conferirAcompanhamento(item) {
  if (item.acompanhar?.limite) return conferirPreco(item);
  const assunto = item.acompanhar?.assunto || item.titulo;
  const cfg = { ...configParaAgente(), modoDePesquisa: 'normal', imagensNasRespostas: false, ondeComprar: false };
  const silencioso = new Agent({ config: cfg, userDataPath: app.getPath('userData'), render: null, navegador: null, skills });
  conferindo = silencioso;
  enviar('agenda-conferindo', { id: item.id, conferindo: true });
  let texto = '';
  let falha = '';
  silencioso.on('concluido', (d) => (texto = d?.resumo || ''));
  silencioso.on('erro', (d) => (falha = d?.mensagem || 'erro'));
  silencioso.on('interrompido', () => (falha ||= 'interrompida'));
  try {
    const r = await conferirAssunto(assunto, {
      pesquisar: async (pergunta) => {
        await silencioso.run(pergunta, []);
        if (!texto && falha) throw new Error(falha);
        return texto;
      },
      // pensar: false — fora da execução do agente, o qwen3.5 gastava os 300 tokens pensando e não respondia
      julgar: async (prompt) => (await ollama.chat({ host: cfg.host, model: cfg.model, messages: [{ role: 'user', content: prompt }], json: true, pensar: false, temperature: 0.1, numPredict: 300, numCtx: 8192 })).content,
      hoje: new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
    }).catch((err) => ({ erro: err.message }));
    if (conferindo !== silencioso) return; // interrompida: tenta de novo na próxima
    const mudancas = { acompanhar: { ultimaVerificacao: Date.now(), erro: r.erro || null, ...(r.erro ? {} : { resumo: r.resumo, data: r.data }) } };
    if (r?.aconteceu) mudancas.acompanhar.status = 'aconteceu';
    const antes = item.acompanhar || {};
    agenda.atualizar(item.id, mudancas);
    const en = idiomaEfetivo() === 'en';
    if (r?.aconteceu) avisar(en ? `News: ${assunto}` : `Novidade: ${assunto}`, r.resumo || (en ? 'It happened.' : 'Aconteceu.'), item);
    else if (r?.data && r.data !== antes.data) avisar(en ? `Date confirmed: ${assunto}` : `Data confirmada: ${assunto}`, `${r.data.split('-').reverse().join('/')} — ${r.resumo}`, item);
  } finally {
    if (conferindo === silencioso) conferindo = null;
    enviar('agenda-conferindo', { id: item.id, conferindo: false });
    enviar('agenda-mudou', {});
  }
}
/** Mensagem nova do usuário: a checagem em segundo plano sai da frente (volta na próxima vez). */
function pararConferencia() {
  if (!conferindo) return;
  const a = conferindo;
  conferindo = null;
  try {
    a.parar();
  } catch {
    /* já parou */
  }
}

ipcMain.handle('agenda:listar', () => {
  const ano = new Date().getFullYear();
  const feriados = {};
  for (let a = ano - 1; a <= ano + 1; a += 1) for (const d of calendarioNoChat.datasDoAno(a)) (feriados[d.iso] ||= []).push([d.nome, d.tipo, d.en]);
  return { itens: agenda ? agenda.listar() : [], feriados, conferindo: conferindo ? true : false };
});
ipcMain.handle('agenda:adicionar', (_e, dados) => {
  const item = agenda?.adicionar(dados || {});
  return item ? { ok: true, item } : { ok: false, error: 'Escreva o que anotar.' };
});
ipcMain.handle('agenda:atualizar', (_e, { id, mudancas } = {}) => {
  // só os campos que a tela muda
  const permitido = {};
  for (const k of ['titulo', 'quando', 'diaInteiro', 'avisarAntes', 'feito']) if (mudancas && k in mudancas) permitido[k] = mudancas[k];
  if (mudancas?.status && ['ativo', 'pausado'].includes(mudancas.status)) permitido.acompanhar = { status: mudancas.status };
  return { ok: Boolean(agenda?.atualizar(id, permitido)) };
});
ipcMain.handle('agenda:remover', (_e, id) => ({ ok: Boolean(agenda?.remover(id)) }));
ipcMain.handle('agenda:conferirAgora', async (_e, id) => {
  const item = agenda?.listar().find((i) => i.id === id && i.tipo === 'acompanhar');
  if (!item) return { ok: false, error: 'item não encontrado' };
  if (conferindo || agent?.rodando) return { ok: false, error: idiomaEfetivo() === 'en' ? 'busy — try again in a moment' : 'ocupado — tente daqui a pouco' };
  conferirAcompanhamento(item).catch(() => {});
  return { ok: true };
});

ipcMain.handle('agendamentos:list', () => config.data.agendamentos || []);

ipcMain.handle('agendamentos:add', (_e, dados) => {
  const item = agendador.criarAgendamento(dados);
  if (!item.texto) return { ok: false, error: 'Informe o pedido que a rotina deve enviar.' };
  const lista = [...(config.data.agendamentos || []), item];
  config.save({ agendamentos: lista });
  return { ok: true, agendamentos: lista };
});

ipcMain.handle('agendamentos:toggle', (_e, { id, ativo }) => {
  const lista = (config.data.agendamentos || []).map((a) => (a.id === id ? { ...a, ativo: Boolean(ativo) } : a));
  config.save({ agendamentos: lista });
  return lista;
});

ipcMain.handle('agendamentos:remove', (_e, id) => {
  const lista = (config.data.agendamentos || []).filter((a) => a.id !== id);
  config.save({ agendamentos: lista });
  return lista;
});

// ----------------------------- execuções -----------------------------

// Pedido de Davi 2026-09-23: abre a janela dedicada "Visualizar Execuções".
ipcMain.handle('execucoes:abrirJanela', () => {
  abrirJanelaExecucoes();
  return true;
});

ipcMain.handle('runs:list', (_e, filtro) => registros.listar(filtro || {}));
ipcMain.handle('runs:read', (_e, id) => registros.ler(id));
ipcMain.handle('runs:stats', (_e, filtro) => registros.estatisticas(filtro || {}));
ipcMain.handle('runs:rate', (_e, { id, nota }) => registros.avaliar(id, nota));
ipcMain.handle('runs:delete', (_e, id) => registros.excluir(id));
ipcMain.handle('runs:clear', (_e, origem) => registros.limpar(origem || null));

ipcMain.handle('runs:export', async (_e, ids) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportar execuções',
    defaultPath: path.join(app.getPath('documents'), `augpt-execucoes-${Date.now()}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  // com ids, só as execuções filtradas na tela (Fase 1, 16/10)
  const escolhidas = Array.isArray(ids) ? new Set(ids) : null;
  fs.writeFileSync(r.filePath, JSON.stringify(registros.todas().filter((x) => !escolhidas || escolhidas.has(x.id)), null, 2), 'utf8');
  shell.showItemInFolder(r.filePath);
  return { ok: true };
});

// ----------------------------- conversas -----------------------------

ipcMain.handle('chats:list', () => conversas.listar());
ipcMain.handle('chats:read', (_e, id) => conversas.ler(id));
ipcMain.handle('chats:save', (_e, conversa) => {
  const gravada = conversas.salvar(conversa);
  if (gravada?.id) remoto?.transmitir('conversa-salva', { id: gravada.id, titulo: gravada.titulo });
  return gravada;
});

/* ------------------------------ tarefas em segundo plano (27/10) ------------------------------ */
// Uma fila num agente separado (src/segundo-plano.js): você continua usando o AuGPT; no fim, a resposta
// vira conversa salva e sai o aviso no Windows e no celular. Sem o navegador interativo (é da conversa
// aberta), e a checagem da agenda espera a fila.
const { FilaDeFundo, pedidoDeFundo } = require('../src/segundo-plano');
const fundo = new FilaDeFundo({
  criarAgente: () => {
    const a = new Agent({ config: configParaAgente(), userDataPath: app.getPath('userData'), render: config.data.renderizarJs ? (url) => renderizar(url, { obterConfig: () => config.data }) : null, navegador: null, skills });
    const reg = new Registro({ origem: 'segundo-plano', modelo: config.data.model, host: config.data.host }).acompanhar(a);
    for (const fim of ['concluido', 'limite', 'interrompido', 'erro']) a.on(fim, () => registros.salvar(reg.dados));
    a.on('arquivo-criado', () => enviar('arvore-mudou', {}));
    return a;
  },
  salvar: (item, resposta) => {
    const g = conversas.salvar({ id: null, modo: 'agente', mensagens: [{ role: 'user', content: item.objetivo }, { role: 'assistant', content: resposta }] });
    enviar('conversas-mudaram', {});
    if (g?.id) remoto?.transmitir('conversa-salva', { id: g.id, titulo: g.titulo });
    return g;
  },
  avisar: (item) => {
    const en = idiomaEfetivo() === 'en';
    const titulo = item.titulo || item.objetivo.slice(0, 60);
    const [cab, corpo] = item.estado === 'pronta' ? [en ? 'Task done' : 'Tarefa pronta', titulo]
      : item.estado === 'esperando' ? [en ? 'A task needs your approval' : 'Uma tarefa precisa da sua aprovação', `${titulo} — ${item.aprovacao?.nome || ''}`]
        : [en ? 'Task failed' : 'A tarefa não terminou', `${titulo} — ${item.erro || ''}`];
    avisar(`AuGPT · ${cab}`, corpo, item, () => enviar('fundo-abrir', { id: item.id, idConversa: item.idConversa || null }));
    remoto?.transmitir('fundo-aviso', { id: item.id, estado: item.estado, titulo, idConversa: item.idConversa || null });
  },
  mudou: (lista) => {
    enviar('fundo-mudou', { lista });
    remoto?.transmitir('fundo-mudou', { lista });
  },
});
ipcMain.handle('fundo:listar', () => fundo.listar());
ipcMain.handle('fundo:detectar', (_e, texto) => pedidoDeFundo(texto));
ipcMain.handle('fundo:adicionar', (_e, objetivo) => ({ id: fundo.adicionar(objetivo) }));
ipcMain.handle('fundo:responder', (_e, { id, valor } = {}) => ({ ok: fundo.responder(id, valor) }));
ipcMain.handle('fundo:remover', (_e, id) => ({ ok: fundo.remover(id) }));

/* ------------------------------ acesso pelo celular (26/10, fase 1) ------------------------------ */
// O celular usa o AuGPT pela rede da casa (src/remoto.js): o pedido vai para a tela do PC, que roda como
// se você tivesse digitado lá; os eventos do agente voltam pelo enviar(). Desligado por padrão.
let erroDoRemoto = null;
async function aplicarAcessoCelular() {
  const { AcessoRemoto, novoCodigo } = require('../src/remoto');
  if (!config.data.acessoCelular) {
    if (remoto) await remoto.desligar();
    remoto = null;
    erroDoRemoto = null;
    return;
  }
  if (!config.data.acessoCelularCodigo) config.save({ acessoCelularCodigo: novoCodigo() });
  if (remoto?.ligado()) return;
  remoto = new AcessoRemoto({
    codigo: config.data.acessoCelularCodigo,
    porta: Number(config.data.acessoCelularPorta) || undefined,
    dirTela: path.join(__dirname, '../renderer'),
    dirImagens: path.join(app.getPath('userData'), 'imagens'),
    estado: () => ({ rodando: Boolean(agent?.rodando), idConversa: idConversaEmExecucao, versao: app.getVersion(), nome: config.data.nomeDaChamada || 'GPT', idioma: idiomaEfetivo() }),
    pedir: ({ texto, idConversa }) => {
      if (!win || win.isDestroyed()) return { ok: false, erro: 'Abra o AuGPT no computador.' };
      enviar('remoto-pedido', { texto, idConversa });
      return { ok: true };
    },
    // respondido pelo celular: o cartão do PC (e de outro celular) fecha
    responder: (id, valor) => {
      const ok = Boolean(agent?.responder(id, valor));
      if (ok) enviar('remoto-respondeu', { id, valor: valor === 'aprovar' || valor === 'negar' ? valor : 'texto' });
      return ok;
    },
    parar: () => agent?.parar(),
    fundo,
    listarConversas: () => conversas.listar(),
    lerConversa: (id) => conversas.ler(id),
    servirMapa: (url) => mapaTiles.servir(url, { dir: path.join(app.getPath('userData'), 'mapa'), agente: `AuGPT/${app.getVersion()} (+https://github.com/D4v1K1ngg/augpt)` }),
    servirCaixa: (url) => caixa.responderCaixa(url),
  });
  try {
    await remoto.ligar();
    erroDoRemoto = null;
  } catch (err) {
    erroDoRemoto = err.code === 'EADDRINUSE' ? `a porta ${remoto.o.porta} já está em uso por outro programa` : err.message;
    remoto = null;
  }
}
const estadoDoRemoto = () => ({ ligado: Boolean(remoto?.ligado()), enderecos: remoto?.ligado() ? remoto.enderecos() : [], erro: erroDoRemoto });
ipcMain.handle('remoto:estado', () => estadoDoRemoto());
ipcMain.handle('remoto:novoCodigo', () => {
  const { novoCodigo } = require('../src/remoto');
  const codigo = novoCodigo();
  config.save({ acessoCelularCodigo: codigo });
  remoto?.trocarCodigo(codigo);
  return estadoDoRemoto();
});
ipcMain.handle('chats:rename', (_e, { id, titulo }) => conversas.renomear(id, titulo));
ipcMain.handle('chats:delete', (_e, ids) =>
  Array.isArray(ids) ? conversas.excluirVarias(ids) : conversas.excluir(ids)
);

/**
 * Item 2 da análise comparativa (2026-09-21, "comando manual de
 * compactação", inspirado no /compact do deer-flow): compacta a conversa
 * AGORA, sem esperar a próxima execução — útil antes de mandar uma pergunta
 * longa numa conversa já cheia. Reaproveita `fundirResumoConversa()` (mesma
 * lógica que já roda sozinha no início de `run()` — ver `Agent.run()`,
 * `loop.js`) e o MESMO listener `'resumo-conversa'` que `criarAgente()` já
 * liga a `conversas.atualizarResumo()` — nenhuma gravação duplicada aqui.
 * `criarAgente(idConversa)` cria um `Agent` novo só pra ter acesso a
 * `fundirResumoConversa()`/config/ollama; `.run()` nunca é chamado, então
 * `agent.rodando` nunca vira `true` — a próxima execução de verdade
 * (`agent:start`) segue funcionando normalmente depois.
 */
ipcMain.handle('chats:compact', async (_e, { idConversa } = {}) => {
  if (agent?.rodando) return { ok: false, error: 'Já existe uma execução em andamento.' };
  if (!idConversa) return { ok: false, error: 'Conversa ainda não foi salva.' };
  const conversaSalva = conversas.ler(idConversa);
  if (!conversaSalva) return { ok: false, error: 'Conversa não encontrada.' };
  criarAgente(idConversa);
  try {
    const antes = conversaSalva.resumoConversaTurnos || 0;
    const resultado = await agent.fundirResumoConversa(conversaSalva.mensagens || [], idConversa, {
      resumoConversa: conversaSalva.resumoConversa || '',
      resumoConversaTurnos: antes,
    });
    return { ok: true, compactou: resultado.resumoConversaTurnos > antes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('chats:export', async (_e, id) => {
  const conteudo = conversas.exportar(id);
  if (!conteudo) return { ok: false };
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportar conversa',
    defaultPath: path.join(app.getPath('documents'), conteudo.nome),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, conteudo.texto, 'utf8');
  shell.showItemInFolder(r.filePath);
  return { ok: true, caminho: r.filePath };
});

// ----------------------------- domínios -----------------------------

ipcMain.handle('domains:stats', () => ({
  ...busca.estatisticasDeDominios(),
  seus: config.data.dominiosPersonalizados || [],
}));

ipcMain.handle('domains:save', (_e, lista) => {
  config.save({ dominiosPersonalizados: Array.isArray(lista) ? lista : [] });
  busca.definirPersonalizados(config.data.dominiosPersonalizados);
  if (agent) Object.assign(agent.config, config.data);
  return config.data.dominiosPersonalizados;
});

ipcMain.handle('domains:lookup', (_e, dominio) => {
  const url = /^https?:\/\//i.test(dominio) ? dominio : `https://${String(dominio).trim()}`;
  try {
    const q = busca.qualidadeDoDominio(url);
    return { ok: true, ...q, bloqueado: busca.estaBloqueado(new URL(url).hostname) };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
});

// ----------------------------- MCP -----------------------------

/**
 * Conecta os servidores configurados e registra as ferramentas deles.
 * Falha de servidor não impede o app de abrir — vira problema listado no painel.
 */
async function conectarMCP() {
  try {
    const ferramentas = await mcp.conectar(config.data.mcpServidores || []);
    tools.registrarRemotas(ferramentas);
    if (mcp.problemas.length) console.warn('Servidores MCP com problema:', mcp.problemas);
    return { ferramentas: ferramentas.length, problemas: mcp.problemas, estado: mcp.estado() };
  } catch (err) {
    console.warn('MCP:', err.message);
    return { ferramentas: 0, problemas: [err.message], estado: [] };
  }
}

ipcMain.handle('mcp:list', () => ({
  servidores: config.data.mcpServidores || [],
  estado: mcp.estado(),
  problemas: mcp.problemas,
}));

/**
 * Fase 1 de segurança (2026-09-23): um servidor MCP é um PROGRAMA que o app
 * inicia com as permissões do usuário. Antes, `mcp:test`/`mcp:save` iniciavam
 * qualquer comando que a interface mandasse — se um script injetado rodasse na
 * interface, era execução direta. Agora todo comando novo ou alterado passa
 * por um diálogo nativo do processo principal (fora do alcance da página)
 * mostrando exatamente o que vai rodar. Aprovado uma vez, não pergunta de novo
 * nesta sessão; servidores já salvos não pedem de novo.
 */
const assinaturaMCP = (s) => JSON.stringify({ comando: s?.comando || '', argumentos: s?.argumentos || [], env: s?.env || {} });
const mcpAprovadosNestaSessao = new Set();

function confirmarServidorMCP(servidor) {
  const assinatura = assinaturaMCP(servidor);
  const jaSalvo = (config.data.mcpServidores || []).some((s) => assinaturaMCP(s) === assinatura);
  if (jaSalvo || mcpAprovadosNestaSessao.has(assinatura)) return true;
  const linha = [servidor?.comando, ...(servidor?.argumentos || [])].filter(Boolean).join(' ');
  const escolha = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Iniciar este programa', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Servidor MCP',
    message: `Iniciar o servidor MCP "${servidor?.nome || 'sem nome'}"?`,
    detail: `Comando:\n${linha}\n\nEle vai rodar com as mesmas permissões que você tem neste computador. Só continue se você confia nele.`,
  });
  if (escolha !== 0) return false;
  mcpAprovadosNestaSessao.add(assinatura);
  return true;
}

ipcMain.handle('mcp:save', async (_e, servidores) => {
  const lista = (Array.isArray(servidores) ? servidores : []).map((s) =>
    s?.ativo !== false && !confirmarServidorMCP(s) ? { ...s, ativo: false } : s
  );
  config.save({ mcpServidores: lista });
  if (agent) Object.assign(agent.config, config.data);
  return conectarMCP();
});

ipcMain.handle('mcp:test', (_e, servidor) => {
  if (!confirmarServidorMCP(servidor)) return { ok: false, erro: 'Cancelado: o programa não foi iniciado.' };
  return mcp.testar(servidor);
});
ipcMain.handle('mcp:reconnect', () => conectarMCP());

// ----------------------------- SearXNG embutido -----------------------------
//
// Alternativa ao Docker/instalação manual: baixa um Python (Windows) ou usa o
// do sistema (Linux/Mac) + o código do SearXNG, e sobe como um processo local
// gerenciado pelo app. É a única parte do AuGPT que fala com a internet fora
// do Ollama — só quando o usuário pede a instalação, nunca sozinho.

/* ------------------------------ boas-vindas (15/10) ------------------------------ */
// Tela de boas-vindas: verifica o computador, o Ollama, os modelos e a busca
// embutida; instala o que faltar SÓ quando o usuário clica (cada botão é a
// confirmação). Ver src/verificador-de-hardware.js e src/instalador-ollama.js.

ipcMain.handle('boasVindas:verificar', async () => {
  const computador = await verificadorDeHardware.verificarComputador();
  const saude = await ollama.health(config.data.host);
  let modelos = [];
  if (saude.online) {
    try {
      modelos = (await ollama.listModels(config.data.host)).map((m) => m.name);
    } catch {
      modelos = [];
    }
  }
  return {
    computador,
    recomendacao: verificadorDeHardware.recomendarModelos(computador),
    ollama: { online: saude.online, instalado: saude.online || ollamaRuntime.localizarBinario().encontrado },
    modelos,
    busca: searxngRuntime.estado(),
    youtube: { instalado: ytdlp().instalado() },
    ocr: { instalado: tesseract().instalado(), manual: process.platform !== 'win32' },
    imagem: { ...recomendarGerador(computador), instalado: gerador().instalado() },
    concluida: config.data.boasVindasConcluida === true,
    plataforma: process.platform,
  };
});

ipcMain.handle('boasVindas:instalarOllama', async () =>
  instaladorOllama.instalarOllama({
    emitir: (p) => enviar('ollama-instalacao-progresso', p),
    ligar: () => ollamaRuntime.localizarEIniciar(config.data.host),
  })
);

ipcMain.handle('boasVindas:ligarOllama', () => ollamaRuntime.localizarEIniciar(config.data.host));

// fim: grava o modelo escolhido e liga a busca embutida, se ela foi instalada
ipcMain.handle('boasVindas:concluir', async (_e, { modelo, nome, idioma } = {}) => {
  const usarBusca = searxngRuntime.estaInstalado();
  if (typeof nome === 'string') gravarNomeNaMemoria(nome);
  config.save({
    ...(modelo ? { model: modelo } : {}),
    ...(typeof nome === 'string' ? { nomeDoUsuario: nome.trim().slice(0, 60) } : {}),
    ...(idioma === 'pt' || idioma === 'en' || idioma === '' ? { idioma } : {}),
    embedModel: 'nomic-embed-text',
    modoDePesquisa: config.data.modoDePesquisa || 'automatico',
    boasVindasConcluida: true,
    ...(usarBusca ? { usarSearxngEmbutido: true } : {}),
  });
  if (usarBusca && !searxngRuntime.rodando) {
    try {
      await searxngRuntime.iniciar();
    } catch {
      /* a busca liga na próxima abertura; o agente usa as reservas enquanto isso */
    }
  }
  if (agent) Object.assign(agent.config, configParaAgente());
  return config.data;
});

/* ------------------------------ atualizar o AuGPT (21/10) ------------------------------ */
// Confere as Releases do GitHub; baixar e instalar só no clique (src/atualizador.js).
const atualizador = require('../src/atualizador');
ipcMain.handle('atualizacao:verificar', async () => {
  try {
    return { ok: true, empacotado: app.isPackaged, ...(await atualizador.verificar({ atual: app.getVersion() })) };
  } catch (err) {
    return { ok: false, error: err.message, atual: app.getVersion() };
  }
});
ipcMain.handle('atualizacao:instalar', async () => {
  // rodando do código (npm start): quem atualiza é o git pull
  if (!app.isPackaged) return { ok: false, error: 'o AuGPT está rodando do código-fonte — atualize com "git pull" na pasta do projeto' };
  try {
    const info = await atualizador.verificar({ atual: app.getVersion() });
    if (!info.disponivel) return { ok: false, error: 'você já está na versão mais nova' };
    const exe = await atualizador.baixar(info, { dir: path.join(app.getPath('temp'), 'augpt-atualizacao'), emitir: (p) => enviar('atualizacao-progresso', p) });
    // o instalador (NSIS) troca os arquivos com o app fechado e abre a versão nova no fim
    require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* Novidades (23/10, pedido do Davi): na primeira abertura de uma versão nova, a janela "Novidades"
   abre sozinha com o que mudou (dados/novidades.json). Instalação nova não: lá abre a de boas-vindas. */
let novidadesPendentes = null;
function conferirVersaoNova() {
  const atual = app.getVersion();
  const anterior = config.data.ultimaVersaoVista || '';
  if (anterior === atual) return;
  config.save({ ultimaVersaoVista: atual });
  // sem `anterior`: veio de uma versão sem esta janela (mostra só a atual) ou é instalação nova
  if (!config.novo && (anterior || config.data.boasVindasConcluida)) novidadesPendentes = { de: anterior || null };
}
function lerNovidades() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dados', 'novidades.json'), 'utf8'));
  } catch {
    return [];
  }
}
ipcMain.handle('novidades:pendentes', () => {
  const p = novidadesPendentes;
  novidadesPendentes = null;
  return p && { atual: app.getVersion(), notas: atualizador.novidadesEntre(lerNovidades(), p.de, app.getVersion()) };
});
// sem versão: o histórico da instalada; com a versão nova da faixa: as notas dela, lidas da tag no GitHub
ipcMain.handle('novidades:ler', async (_e, { versao } = {}) => {
  const atual = app.getVersion();
  if (!versao || versao === atual) return { ok: true, atual, notas: atualizador.novidadesEntre(lerNovidades(), '0', atual) };
  try {
    return { ok: true, atual, versao, notas: atualizador.novidadesEntre(await atualizador.novidadesRemotas(versao), atual, versao) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
/* Imagens das respostas (23/10, pedido do Davi): baixar uma cópia e abrir a fonte original. */
const dirImagens = () => path.join(app.getPath('userData'), 'imagens');
const salvasPeloApp = new Set(); // os arquivos que o "Salvar como" gravou nesta sessão
ipcMain.handle('imagem:origem', (_e, { nome } = {}) => imagens.origemDe(dirImagens(), nome));
ipcMain.handle('imagem:salvar', async (e, { nome, sugestao } = {}) => {
  if (!imagens.NOME_VALIDO.test(String(nome))) return { ok: false, error: 'imagem inválida' };
  const ext = path.extname(nome);
  const base = String(sugestao || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'imagem-augpt';
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: path.join(app.getPath('downloads'), `${base}${ext}`),
    filters: [{ name: 'Imagem', extensions: [ext.slice(1)] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
  try {
    await fsp.copyFile(path.join(dirImagens(), nome), r.filePath);
    salvasPeloApp.add(r.filePath);
    return { ok: true, caminho: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// revisão de 25/10: só mostra o arquivo que o próprio "Salvar como" acabou de gravar (antes, qualquer caminho)
ipcMain.handle('imagem:mostrarNaPasta', (_e, { caminho } = {}) => (caminho && salvasPeloApp.has(caminho) ? (shell.showItemInFolder(caminho), true) : false));
function procurarAtualizacaoAoAbrir() {
  if (!app.isPackaged || config.data.procurarAtualizacoes === false) return;
  setTimeout(async () => {
    try {
      const info = await atualizador.verificar({ atual: app.getVersion() });
      if (info.disponivel && info.versao !== config.data.atualizacaoIgnorada) enviar('atualizacao-disponivel', info);
    } catch {
      // sem internet ou GitHub fora: tenta de novo na próxima abertura
    }
  }, 15000);
}

/* ------------------------------ componentes (Ajustes, 16/10) ------------------------------ */
// Versões do que o AuGPT usa por fora; atualizar só quando o usuário clica.
// aba Utilitários (19/10): os cartões vêm do catálogo do agente, com o que está instalado
ipcMain.handle('utilitarios:listar', () => require('../src/agent/capacidades').utilitarios({ instalados: { imagem: gerador().instalado(), youtube: ytdlp().instalado() } }));

ipcMain.handle('componentes:estado', async () => {
  const computador = await verificadorDeHardware.verificarComputador();
  const [o, y, t, g] = await Promise.all([instaladorOllama.versoesDoOllama(config.data.host), ytdlp().estado(), tesseract().estado(), gerador().estado(computador)]);
  return { ollama: o, ytdlp: y, tesseract: t, imagem: g, busca: searxngRuntime.estado() };
});

// yt-dlp (Fase 3): instala/atualiza conferindo o SHA-256; a versão de antes fica guardada
ipcMain.handle('componentes:instalarYtdlp', async () => {
  try {
    return { ok: true, estado: await ytdlp().instalar({ emitir: (p) => enviar('ytdlp-progresso', p) }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// Tesseract (Fase 4): winget (o Windows pode pedir permissão) + idiomas português e inglês
ipcMain.handle('componentes:instalarTesseract', async () => {
  try {
    return { ok: true, estado: await tesseract().instalar({ emitir: (p) => enviar('tesseract-progresso', p) }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// Gerador de imagens (Fase 5): programa (CUDA ou Vulkan, pela placa) + modelos, tudo com SHA-256
ipcMain.handle('componentes:instalarImagem', async () => {
  try {
    const rec = recomendarGerador(await verificadorDeHardware.verificarComputador());
    if (!rec.pode) return { ok: false, error: rec.motivo };
    await gerador().instalar({ motor: rec.motor, emitir: (p) => enviar('imagem-progresso', p) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('componentes:voltarImagem', () => {
  try {
    return { ok: true, info: gerador().voltar() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// teste da placa (17/10): onde o modelo roda e a que velocidade
ipcMain.handle('componentes:testarPlaca', async () => {
  try {
    const { gpus } = await verificadorDeHardware.verificarComputador();
    return { ok: true, ...(await verificadorDeHardware.testarAceleracao({ host: config.data.host, modelo: config.data.model, gpus })) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('componentes:voltarYtdlp', async () => {
  try {
    return { ok: true, estado: await ytdlp().voltar() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('componentes:atualizarOllama', async () => {
  // o Ollama precisa estar fechado para o instalador trocar os arquivos
  const r = await instaladorOllama.instalarOllama({
    atualizar: true,
    emitir: (p) => enviar('ollama-instalacao-progresso', p),
    ligar: () => ollamaRuntime.localizarEIniciar(config.data.host),
  });
  return { ...r, versoes: await instaladorOllama.versoesDoOllama(config.data.host) };
});

ipcMain.handle('searxngRuntime:estado', () => searxngRuntime.estado());

ipcMain.handle('searxngRuntime:instalar', async () => {
  try {
    const estado = await searxngRuntime.instalar((fase) => enviar('runtime-searxng-progresso', { fase }));
    return { ok: true, estado };
  } catch (err) {
    return { ok: false, error: err.message, estado: searxngRuntime.estado() };
  }
});

ipcMain.handle('searxngRuntime:iniciar', async () => {
  try {
    const estado = await searxngRuntime.iniciar();
    if (agent) Object.assign(agent.config, configParaAgente());
    return { ok: true, estado };
  } catch (err) {
    return { ok: false, error: err.message, estado: searxngRuntime.estado() };
  }
});

ipcMain.handle('searxngRuntime:parar', async () => {
  await searxngRuntime.parar();
  if (agent) Object.assign(agent.config, configParaAgente());
  return searxngRuntime.estado();
});

ipcMain.handle('searxngRuntime:desinstalar', async () => {
  await searxngRuntime.desinstalar();
  if (config.data.usarSearxngEmbutido) config.save({ usarSearxngEmbutido: false });
  return searxngRuntime.estado();
});

ipcMain.handle('tools:list', () => ({
  ferramentas: tools.inventario(config.data.ferramentasDesativadas || []),
  pastaUsuario: pastasDeFerramentas.dirUsuario,
  problemas: tools.recarregar.ultimosProblemas || [],
}));

ipcMain.handle('tools:toggle', (_e, { name, ativa }) => {
  if (tools.ESSENCIAIS.has(name)) return config.all;
  const atuais = new Set(config.data.ferramentasDesativadas || []);
  if (ativa) atuais.delete(name);
  else atuais.add(name);
  const dados = config.save({ ferramentasDesativadas: [...atuais] });
  if (agent) Object.assign(agent.config, dados);
  return dados;
});

ipcMain.handle('tools:reload', () => {
  const r = tools.recarregar(pastasDeFerramentas);
  tools.recarregar.ultimosProblemas = r.problemas;
  r.indisponiveis = tools.revalidarDependencias();
  return r;
});

ipcMain.handle('tools:openFolder', () => shell.openPath(pastasDeFerramentas.dirUsuario));

ipcMain.handle('tools:openFile', (_e, name) => {
  const ferramenta = tools.get(name);
  if (!ferramenta?.arquivo) return false;
  shell.showItemInFolder(ferramenta.arquivo);
  return true;
});

// ----------------------------- anexos -----------------------------

const EXTENSOES_TEXTO = new Set([
  '.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.yml', '.yaml', '.log', '.ini', '.env',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp',
  '.cs', '.php', '.sh', '.sql', '.html', '.htm', '.css', '.scss', '.svg', '.vue', '.toml',
]);

/**
 * Anexar tem dois destinos diferentes:
 * - agente: o arquivo é COPIADO para a pasta de trabalho, onde as ferramentas
 *   conseguem abrir, ler e editar. Serve para qualquer formato.
 * - conversa: não há ferramenta nenhuma, então só faz sentido para texto —
 *   o conteúdo vai direto na mensagem.
 */
ipcMain.handle('files:attach', async (_e, { modo } = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Anexar arquivos',
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: true, arquivos: [] };

  const sandbox = new Sandbox(config.data.workspace);
  const arquivos = [];

  for (const origem of r.filePaths) {
    try {
      const nome = path.basename(origem);
      const stat = fs.statSync(origem);
      const ext = path.extname(nome).toLowerCase();
      const ehTexto = EXTENSOES_TEXTO.has(ext);

      let texto = null;
      if (ehTexto && stat.size <= 600_000) {
        texto = fs.readFileSync(origem, 'utf8').slice(0, 120_000);
      }

      let relativo = null;
      if (modo === 'agente') {
        // nome sem espaço nem acento facilita a vida das ferramentas
        let destinoNome = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
        let destino = sandbox.resolve(destinoNome);
        let n = 1;
        while (fs.existsSync(destino)) {
          const base = path.basename(destinoNome, ext);
          destino = sandbox.resolve(`${base}-${n}${ext}`);
          n += 1;
        }
        fs.copyFileSync(origem, destino);
        relativo = sandbox.relative(destino);
      }

      arquivos.push({ nome, relativo, tamanho: stat.size, ehTexto, texto, truncado: Boolean(texto) && stat.size > 120_000 });
    } catch (err) {
      arquivos.push({ nome: path.basename(origem), erro: err.message });
    }
  }

  if (modo === 'agente') enviar('workspace-changed', {});
  return { ok: true, arquivos };
});

// ----------------------------- conversa -----------------------------

ipcMain.handle('chat:send', async (_e, { id, mensagens }) => {
  conversaAbort?.abort(new Error('substituída'));
  conversaAbort = new AbortController();

  const historico = [
    { role: 'system', content: config.data.chatSystem },
    ...mensagens.slice(-30),
  ];

  try {
    const r = await ollama.chatStream({
      host: config.data.host,
      model: config.data.model,
      messages: historico,
      temperature: Math.min(config.data.temperature + 0.3, 1),
      numCtx: config.data.numCtx,
      signal: conversaAbort.signal,
      onToken: (pedaco) => {
        if (win && !win.isDestroyed()) win.webContents.send('chat:token', { id, pedaco });
      },
    });
    return { ok: true, conteudo: r.content, tokens: r.promptTokens + r.completionTokens };
  } catch (err) {
    const interrompido = /abort|interromp|substitu/i.test(err.message);
    return { ok: false, interrompido, error: err.message, amigavel: interrompido ? null : primeiroUso.mensagemAmigavel(err.message) };
  } finally {
    conversaAbort = null;
  }
});

ipcMain.handle('chat:stop', () => {
  conversaAbort?.abort(new Error('interrompida'));
  return { ok: true };
});

// --------------------------- ciclo de vida ---------------------------

// Imagens das respostas (src/tools/imagens.js): a tela pede `augpt-img://arquivo`
// e quem entrega é este processo, lendo SÓ da pasta de imagens do app. Assim a
// janela continua sem carregar nada direto da internet (ver a CSP do index.html).
// Caixa isolada (18/10, item 4): o HTML/JS que o modelo escreve num bloco ```visual roda num
// iframe com sandbox servido por augpt-caixa://, com CSP própria (sem rede) — ver src/caixa.js
const caixa = require('../src/caixa');
// Mapa do chat (23/10): os pedaços do mapa vêm por augpt-mapa://, servidos por src/mapa-tiles.js
const mapaTiles = require('../src/mapa-tiles');
protocol.registerSchemesAsPrivileged([
  { scheme: imagens.ESQUEMA, privileges: { standard: true, secure: true } },
  { scheme: caixa.ESQUEMA, privileges: { standard: true, secure: true } },
  { scheme: mapaTiles.ESQUEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

app.whenReady().then(() => {
  protocol.handle(caixa.ESQUEMA, (pedido) => caixa.responderCaixa(pedido.url));
  protocol.handle(imagens.ESQUEMA, (pedido) => {
    const nome = new URL(pedido.url).hostname;
    if (!imagens.NOME_VALIDO.test(nome)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(path.join(app.getPath('userData'), 'imagens', nome)).toString());
  });
  protocol.handle(mapaTiles.ESQUEMA, (pedido) => mapaTiles.servir(pedido.url, { dir: path.join(app.getPath('userData'), 'mapa'), agente: `AuGPT/${app.getVersion()} (+https://github.com/D4v1K1ngg/augpt)` }));
  // Fase 1 de segurança (2026-09-23): a sessão padrão (janela principal e a
  // de Execuções) não precisa de câmera, microfone, notificação nem nada do
  // tipo — o Electron concede tudo por padrão se ninguém disser o contrário.
  // 24/10: a exceção é o microfone da janela principal (só áudio), para o ditado por voz
  negarPermissoes(session.defaultSession, { permitir: soMicrofoneDe(() => win?.webContents, () => ditado?.instalado()) });
  // Fase 3 (16/10): o player do youtube-nocookie.com (só no clique na miniatura) exige Referer —
  // sem ele, "Erro 153". Vale só para esse endereço.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (detalhes, responder) => {
    responder({ requestHeaders: { ...detalhes.requestHeaders, Referer: detalhes.requestHeaders.Referer || 'https://augpt.app/' } });
  });
  config = new Config(app.getPath('userData'));
  conferirVersaoNova();
  aplicarCalibracoes(); // a placa calibrada (19/10): o num_gpu medido vale desde a primeira chamada
  // Fase 2: instalação nova (config.json ainda não existia) em computador com
  // pouca memória já começa com padrões mais leves — nunca mexe em quem já
  // usa o app (ver padroesPorHardware, src/primeiro-uso.js).
  if (config.novo) {
    const leves = primeiroUso.padroesPorHardware(hardware.detectarHardware().ramTotalGB);
    if (Object.keys(leves).length) config.save(leves);
  }
  garantirWorkspacePadrao();
  skills = new Skills({
    dirEmbutidas: path.join(__dirname, '..', 'skills'),
    dirUsuario: path.join(app.getPath('userData'), 'skills'),
  });
  pastasDeFerramentas = {
    dirEmbutidas: path.join(__dirname, '..', 'ferramentas'),
    dirUsuario: path.join(app.getPath('userData'), 'ferramentas'),
  };
  conversas = new Conversas(path.join(app.getPath('userData'), 'conversas'));
  agenda = new Agenda(app.getPath('userData'));
  // revisão de 25/10: a faxina dos caches (mapa e fotos sem uso), 2 min depois de abrir, em segundo plano
  setTimeout(() => {
    require('../src/faxina')
      .faxina({ userData: app.getPath('userData') })
      .then((r) => r.mapa + r.imagens && console.log(`faxina: ${r.mapa} pedaços de mapa e ${r.imagens} fotos sem uso, ${Math.round(r.bytes / 1e6)} MB`))
      .catch((err) => registrarErro('faxina', err));
  }, 2 * 60000);
  ditado = new Ditado(path.join(app.getPath('userData'), 'componentes'));
  carregarRegistroDaEscuta();
  aplicarNomeDaChamada();
  // 25/10: sai do treino o que não soa como "GPT" ("somdebarulho" — o teclado — chamava o AuGPT)
  const variantesLimpas = require('../src/ditado').variantesValidas(config.data.escutaVariantes);
  if (variantesLimpas.length !== (config.data.escutaVariantes || []).length) config.save({ escutaVariantes: variantesLimpas });
  estadoDoAtalho = aplicarAtalhoDaTela();
  aplicarAcessoCelular().catch(() => {});
  // os avisos do Windows saem com o nome do AuGPT (sem isto, no Windows não aparecem fora do instalador)
  if (process.platform === 'win32') app.setAppUserModelId('com.davi.augpt');
  registros = new Registros(path.join(app.getPath('userData'), 'execucoes'));
  const carga = tools.recarregar(pastasDeFerramentas);
  if (carga.problemas.length) console.warn('Ferramentas com problema:', carga.problemas);

  busca.definirPersonalizados(config.data.dominiosPersonalizados || []);
  mcp = new GerenciadorMCP();
  conectarMCP();
  searxngRuntime = new RuntimeSearXNG({ userDataPath: app.getPath('userData') });
  if (config.data.usarSearxngEmbutido && searxngRuntime.estaInstalado()) {
    searxngRuntime.iniciar().catch((err) => console.warn('SearXNG embutido:', err.message));
  }
  criarJanela();
  iniciarAgendador();
  procurarAtualizacaoAoAbrir();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  agent?.parar();
  searxngRuntime?.parar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => require('electron').globalShortcut.unregisterAll());

app.on('before-quit', () => {
  remoto?.desligar();
  fundo.pararTudo();
  agent?.parar();
  mcp?.desconectar();
  searxngRuntime?.parar();
  navegador?.fechar();
  conversaAbort?.abort(new Error('encerrando'));
  if (verificadorDeAgendamentos) clearInterval(verificadorDeAgendamentos);
});
