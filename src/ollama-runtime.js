'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { montarComando } = require('./comando');
const ollama = require('./llm/ollama');

/**
 * Início automático do Ollama, com permissão do usuário — item do
 * planejamento do Copiloto nível 2 (ver AuGPT-plano-de-implementacao.md,
 * seção "Ollama: detectar desligado e oferecer ligar").
 *
 * Diferente do SearXNG embutido (`src/searxng-runtime.js`), aqui o AuGPT NÃO
 * instala nem gerencia o ciclo de vida inteiro: o Ollama já é um programa
 * que o usuário instalou por conta própria. Este módulo só localiza o
 * binário no PATH e, se o usuário topar, dá um "start" nele — como se
 * tivesse digitado `ollama serve` no terminal — e solta: o processo
 * continua rodando independente do AuGPT (`detached`), porque é assim que
 * o usuário normalmente quer um serviço de fundo, não algo atrelado ao app
 * (fechar o AuGPT não devia derrubar o Ollama que ele também usa por fora).
 *
 * `comando` é parametrizável (padrão `'ollama'`, resolvido pelo PATH do
 * sistema) só pra permitir testar com um fixture no lugar do binário real —
 * em uso normal, ninguém passa isso.
 */

const TIMEOUT_SAUDE_MS = 15000;
const INTERVALO_SAUDE_MS = 500;

/**
 * Onde o instalador oficial do Ollama costuma deixar o binário, por sistema.
 * Fase 2 (facilidade de uso, 2026-09-23): no Windows o instalador põe o
 * Ollama no PATH do USUÁRIO, mas um app já aberto (ou aberto por um terminal
 * antigo) não enxerga o PATH novo — o AuGPT dizia "Ollama não instalado" pra
 * quem tinha acabado de instalar. Olhar também os caminhos conhecidos resolve
 * sem precisar reiniciar nada.
 */
function caminhosConhecidosDoOllama({ plataforma = process.platform, env = process.env } = {}) {
  if (plataforma === 'win32') {
    return [
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Ollama', 'ollama.exe'),
    ].filter(Boolean);
  }
  if (plataforma === 'darwin') {
    return ['/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama'];
  }
  return ['/usr/local/bin/ollama', '/usr/bin/ollama', '/snap/bin/ollama'];
}

function testarComando(comando) {
  const r = spawnSync(...montarComando(comando, ['--version']), { windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || r.stderr || '').trim();
}

/**
 * Confere se o binário existe, sem tentar ligar nada ainda. Primeiro pelo
 * PATH; se não achar e for o comando padrão, nos caminhos conhecidos do
 * instalador (`caminhos` só é passado nos testes). `comando` na resposta é o
 * que deve ser usado pra ligar.
 */
function localizarBinario(comando = 'ollama', { caminhos = null } = {}) {
  const versao = testarComando(comando);
  if (versao !== null) return { encontrado: true, versao, comando };
  if (comando !== 'ollama' && !caminhos) return { encontrado: false };
  for (const caminho of caminhos || caminhosConhecidosDoOllama()) {
    if (!fs.existsSync(caminho)) continue;
    const v = testarComando(caminho);
    if (v !== null) return { encontrado: true, versao: v, comando: caminho };
  }
  return { encontrado: false };
}

/**
 * Sobe `ollama serve` desacoplado do processo do AuGPT e solta — não espera
 * o processo "terminar" (ele não termina sozinho, é um servidor). Só
 * confirma que o spawn em si não falhou de cara (comando inexistente etc.)
 * antes de devolver; a confirmação de que subiu de verdade é
 * responsabilidade de `esperarSaude` (mesma separação que o RuntimeSearXNG
 * já usa entre `_iniciarInterno`/`_esperarSaude`).
 */
function iniciar(comando = 'ollama') {
  return new Promise((resolve, reject) => {
    let falhou = false;
    const p = spawn(...montarComando(comando, ['serve']), { detached: true, stdio: 'ignore', windowsHide: true });
    p.once('error', (err) => {
      falhou = true;
      reject(new Error(`falha ao iniciar o Ollama: ${err.message}`));
    });
    // `error` (ex.: ENOENT) chega de forma assíncrona — dar um tick antes de
    // resolver evita devolver sucesso pra um spawn que já ia falhar mesmo.
    setImmediate(() => {
      if (!falhou) resolve({ pid: p.pid });
    });
    p.unref();
  });
}

/** Espera `host` responder de verdade (mesmo endpoint que o resto do app já usa). */
async function esperarSaude(host, { timeoutMs = TIMEOUT_SAUDE_MS, intervaloMs = INTERVALO_SAUDE_MS } = {}) {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const saude = await ollama.health(host);
    if (saude.online) return saude;
    if (Date.now() >= limite) return { online: false, error: `Ollama não respondeu em ${Math.round(timeoutMs / 1000)}s` };
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}

/**
 * O fluxo completo usado quando o usuário aceita a oferta "Detectei que o
 * Ollama está desligado. Deseja que eu ative ele?" — localiza, liga, espera
 * responder. Devolve sempre um objeto (nunca lança), pra o chamador (IPC em
 * electron/main.js) não precisar de try/catch.
 */
async function localizarEIniciar(host, comando = 'ollama') {
  const bin = localizarBinario(comando);
  if (!bin.encontrado) {
    return { ok: false, encontrado: false, error: 'Não encontrei o Ollama instalado neste computador.' };
  }
  try {
    await iniciar(bin.comando || comando);
  } catch (err) {
    return { ok: false, encontrado: true, error: err.message };
  }
  const saude = await esperarSaude(host);
  return { ok: saude.online, encontrado: true, error: saude.online ? null : saude.error };
}

/**
 * Quantas checagens de saúde (`ollama:health`, a cada 20s — ver
 * electron/main.js) seguidas SEM resposta são necessárias antes de tratar o
 * Ollama como "caiu de verdade" e agir (oferecer religar / religar sozinho).
 * Caso real (Davi, 2026-09-18): com "2 IAs" + pipelineForcadoUniversal, o
 * crítico dedicado é chamado em praticamente todo passo — se o Ollama dele só
 * mantém 1 modelo carregado por vez (ver MIN_MODELOS_CARREGADOS_DOIS_MODELOS
 * acima), cada uma dessas trocas pode deixá-lo momentaneamente sem responder.
 * Sem um número mínimo de falhas SEGUIDAS antes de agir, esse soluço
 * passageiro já bastava pra tratar o Ollama como fora do ar a cada checagem
 * de 20s que calhasse de cair no meio de uma troca — no Windows dele, isso
 * disparava `localizarBinario`/`localizarEIniciar` (spawns), que pareciam
 * abrir uma janela de Prompt de Comando visível mesmo pedindo pra esconder
 * (`windowsHide: true`).
 */
const LIMIAR_FALHAS_SAUDE_PADRAO = 2;

/**
 * Pura — só a contagem, sem spawn nem IPC (por isso mora aqui, junto do resto
 * de ollama-runtime.js que já é testável sem o módulo `electron`, indisponível
 * fora do processo Electron). Recebe se a checagem ATUAL veio online e quantas
 * falhas seguidas já existiam antes; devolve a nova contagem e se já bateu o
 * limiar (hora de agir). Um único sucesso zera a contagem — o que importa é
 * "quantas seguidas agora", não uma média ao longo da sessão.
 */
function avaliarSaudeComDebounce(online, falhasConsecutivas, limiar = LIMIAR_FALHAS_SAUDE_PADRAO) {
  if (online) return { falhasConsecutivas: 0, atingiuLimiar: false };
  const falhas = falhasConsecutivas + 1;
  return { falhasConsecutivas: falhas, atingiuLimiar: falhas >= limiar };
}

module.exports = {
  localizarBinario,
  caminhosConhecidosDoOllama,
  iniciar,
  esperarSaude,
  localizarEIniciar,
  avaliarSaudeComDebounce,
  LIMIAR_FALHAS_SAUDE_PADRAO,
};
