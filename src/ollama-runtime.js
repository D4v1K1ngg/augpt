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
 * Quantos modelos o "2 IAs" (Copiloto nível 2, `copiloto2Modo === 'doisModelos'`,
 * ver src/config.js) precisa que o Ollama mantenha carregados ao mesmo tempo.
 * Investigação com o Davi (2026-09-18): por padrão o Ollama no Windows só
 * mantém 1 modelo carregado — confirmado ao vivo com `ollama ps` mostrando o
 * modelo principal virar "Stopping..." no instante em que o crítico dedicado
 * foi pedido. Isso não trava o pipeline (as chamadas são sequenciais), mas
 * inviabiliza rodar as duas IAs de verdade em paralelo — o Ollama ficaria
 * descarregando e recarregando um modelo de ~5GB a cada troca.
 *
 * Corrigido pra 3 (era 2) numa investigação SEGUINTE, no mesmo dia: com o
 * valor em 2, o Davi via os dois modelos (principal + crítico) coexistindo
 * na maior parte do tempo em `ollama ps` — mas de vez em quando um dos dois
 * sumia sozinho, sem nenhuma chamada nova pro OUTRO ter acontecido. Achado:
 * SEMPRE existiu um TERCEIRO modelo entrando na disputa pelo mesmo teto —
 * `embedModel` (`nomic-embed-text` por padrão, ver src/agent/embeddings.js,
 * src/agent/memory.js, src/skills/index.js — usado pra seleção de skill e
 * busca semântica em memória, com TTL bem mais curto que os outros dois).
 * Com o teto em 2 (só contando principal+crítico), carregar o modelo de
 * embeddings expulsava um dos dois (o Ollama derruba por LRU quando o limite
 * bate) — exatamente o "revezando" que o Davi via no indicador de status.
 * 3 dá espaço pros três coexistirem.
 */
const MIN_MODELOS_CARREGADOS_DOIS_MODELOS = 3;

/**
 * Lê o valor persistido (escopo do usuário, `HKCU\Environment`) de
 * `OLLAMA_MAX_LOADED_MODELS` no Windows — a mesma variável que o comando
 * `setx` grava. Não reflete necessariamente o que um Ollama JÁ RODANDO está
 * obedecendo agora (variável de ambiente só é lida quando um processo
 * nasce) — reflete o que um Ollama que (re)inicie a partir de agora vai
 * herdar, que é o dado relevante pra decidir se vale oferecer o ajuste.
 *
 * Só suportado no Windows: no Linux/Mac essa variável normalmente vem de um
 * arquivo de perfil do shell (`.bashrc`/`.zshrc`) ou de uma unit do systemd,
 * não de um registro central — não há um jeito confiável e genérico de ler
 * ou gravar por fora sem saber COMO o Ollama foi configurado especificamente
 * nesse sistema. `suportado:false` avisa o chamador (a UI) pra simplesmente
 * não oferecer o ajuste automático nesses sistemas.
 *
 * `plataforma`/`comandoReg` parametrizáveis só pra teste (fixture no lugar
 * de `reg.exe` real, e força `plataforma: 'win32'` mesmo rodando a bancada
 * em Linux/Mac) — em uso normal, ninguém passa isso.
 */
function lerMaxModelosCarregados({ plataforma = process.platform, comandoReg = 'reg' } = {}) {
  if (plataforma !== 'win32') return { suportado: false };
  const r = spawnSync(...montarComando(comandoReg, ['query', 'HKCU\\Environment', '/v', 'OLLAMA_MAX_LOADED_MODELS']), {
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return { suportado: true, valor: null }; // variável ainda não definida
  const m = /OLLAMA_MAX_LOADED_MODELS\s+REG_\w+\s+(\d+)/i.exec(String(r.stdout || ''));
  return { suportado: true, valor: m ? Number(m[1]) : null };
}

/**
 * Grava `OLLAMA_MAX_LOADED_MODELS` no escopo do usuário — automatiza
 * exatamente o `setx OLLAMA_MAX_LOADED_MODELS <valor>` que o Davi rodou manual
 * na investigação. NÃO reinicia nem derruba o Ollama: o AuGPT propositalmente
 * nunca mexe no processo do usuário por conta própria (mesmo princípio de
 * `iniciar()`/`localizarEIniciar()` acima, e do comentário em
 * `electron/main.js` sobre `encerrarModelosEFechar`) — o valor só passa a
 * valer de verdade depois que o usuário fechar e abrir o Ollama de novo, e é
 * isso que o chamador (IPC + UI) precisa deixar claro.
 */
function definirMaxModelosCarregados(valor, { plataforma = process.platform, comandoSetx = 'setx' } = {}) {
  if (plataforma !== 'win32') return { ok: false, suportado: false };
  const r = spawnSync(...montarComando(comandoSetx, ['OLLAMA_MAX_LOADED_MODELS', String(valor)]), { windowsHide: true });
  if (r.error || r.status !== 0) {
    return { ok: false, suportado: true, error: String(r.stderr || r.error?.message || 'setx falhou').trim() };
  }
  return { ok: true, suportado: true };
}

/**
 * Lista os processos `ollama.exe` rodando agora no Windows (`tasklist`
 * filtrado por nome de imagem). Caso real (Davi, 2026-09-18): depois de
 * gravar `OLLAMA_MAX_LOADED_MODELS=3` (ver `definirMaxModelosCarregados`
 * acima) e "fechar e abrir o Ollama de novo" pela bandeja do sistema, o
 * `ollama ps` continuou mostrando o comportamento antigo — nunca os 3
 * modelos coexistindo. Achado: sobrou um `ollama.exe` órfão rodando em
 * segundo plano (bem possivelmente um que o próprio `iniciar()` acima tenha
 * soltado numa sessão anterior — ele é `detached` DE PROPÓSITO pra
 * sobreviver ao fechamento do AuGPT, ver comentário lá). Um órfão desses
 * continua respondendo `ollama:health` normalmente ("está rodando"), só que
 * carregado com a variável de ambiente ANTIGA — não tem como a UI perceber
 * isso só pela saúde estar online, por isso o aviso "já reiniciei" some
 * cedo demais nesse cenário.
 */
function listarProcessosOllama({ plataforma = process.platform, comandoTasklist = 'tasklist' } = {}) {
  if (plataforma !== 'win32') return { suportado: false, pids: [] };
  const r = spawnSync(...montarComando(comandoTasklist, ['/FI', 'IMAGENAME eq ollama.exe', '/FO', 'CSV', '/NH']), {
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return { suportado: true, pids: [] };
  const pids = [...String(r.stdout || '').matchAll(/"ollama\.exe","(\d+)"/gi)].map((m) => Number(m[1]));
  return { suportado: true, pids };
}

/**
 * Mata à força TODOS os processos `ollama.exe` (Windows; `/T` também mata a
 * árvore de processos filhos, pra pegar um `ollama serve` que um
 * `ollama.exe` "pai" (o app da bandeja) tenha soltado). Só é chamado depois
 * de um clique explícito do usuário no botão "Reiniciar o Ollama pra mim" —
 * o AuGPT propositalmente nunca mexe no processo do usuário por conta
 * própria (mesmo princípio de `iniciar()`/`localizarEIniciar()` acima).
 *
 * `taskkill` sai com código != 0 tanto numa falha de verdade quanto quando
 * simplesmente não havia nenhum `ollama.exe` rodando pra matar — os dois
 * casos são "sucesso" do ponto de vista de quem chama (o objetivo é só
 * garantir que nada sobrou rodando antes do próximo passo religar). Só o
 * PRÓPRIO spawn falhando (`r.error`, ex.: comando `taskkill` inexistente) é
 * tratado como erro de verdade.
 */
function matarTodosProcessosOllama({ plataforma = process.platform, comandoTaskkill = 'taskkill' } = {}) {
  if (plataforma !== 'win32') return { ok: false, suportado: false };
  const r = spawnSync(...montarComando(comandoTaskkill, ['/IM', 'ollama.exe', '/F', '/T']), { windowsHide: true });
  if (r.error) return { ok: false, suportado: true, error: r.error.message };
  return { ok: true, suportado: true };
}

/**
 * Fluxo completo do botão "Reiniciar o Ollama pra mim" (pedido do Davi,
 * 2026-09-18, na sequência direta da descoberta acima em
 * `listarProcessosOllama`): mata TODOS os processos `ollama.exe` existentes
 * — garantindo que nenhum órfão sobreviva com a variável de ambiente antiga
 * — espera o SO liberar a porta, sobe um `ollama serve` nosso (que agora sim
 * herda o que `definirMaxModelosCarregados` gravou) e confirma que
 * respondeu antes de devolver sucesso. Só roda depois de um clique
 * explícito — nada aqui acontece sozinho.
 */
async function reiniciarOllama(host, {
  comando = 'ollama',
  plataforma = process.platform,
  comandoTaskkill = 'taskkill',
  esperaAposMatarMs = 1000,
} = {}) {
  if (plataforma !== 'win32') return { ok: false, suportado: false };
  const morte = matarTodosProcessosOllama({ plataforma, comandoTaskkill });
  if (!morte.ok) return { ok: false, suportado: true, error: morte.error };
  await new Promise((r) => setTimeout(r, esperaAposMatarMs));
  try {
    await iniciar(comando);
  } catch (err) {
    return { ok: false, suportado: true, error: err.message };
  }
  const saude = await esperarSaude(host);
  return { ok: saude.online, suportado: true, error: saude.online ? null : saude.error };
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
  lerMaxModelosCarregados,
  definirMaxModelosCarregados,
  MIN_MODELOS_CARREGADOS_DOIS_MODELOS,
  listarProcessosOllama,
  matarTodosProcessosOllama,
  reiniciarOllama,
  avaliarSaudeComDebounce,
  LIMIAR_FALHAS_SAUDE_PADRAO,
};
