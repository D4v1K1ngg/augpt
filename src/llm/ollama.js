'use strict';

/**
 * Cliente mínimo para a API HTTP do Ollama.
 * Usa fetch nativo (Node 18+), sem dependências externas.
 */

const DEFAULT_HOST = 'http://127.0.0.1:11434';

/**
 * Prompt maior que a janela (08/10/2026, log do Ollama 0.40.1 no PC do Davi):
 * no motor novo (llama-server) o Ollama RECUSA o prompt com erro 400 —
 * "request (9950 tokens) exceeds the available context size (9216 tokens)"
 * — em vez de cortar o começo em silêncio como fazia. Aconteceu numa
 * destilação com o DeepSeek R1: página cheia de preço (dígito vira token
 * sozinho) estourou a janela e a chamada simplesmente se perdeu. O erro vira
 * um Error com `codigo: 'contexto'` e as duas contagens, e `chat`/`chatStream`
 * reduzem o maior texto e tentam de novo UMA vez (ver `reduzirParaCaber`).
 */
const RE_ERRO_DE_CONTEXTO = /exceeds the (?:available )?context (?:size|length|window)|context (?:size|length|window) (?:exceeded|too small)|prompt is too long|input (?:is )?too long for/i;

function erroDoOllama(status, texto, limite = 400) {
  const err = new Error(`Ollama ${status}: ${String(texto).slice(0, limite)}`);
  err.status = status;
  if (RE_ERRO_DE_CONTEXTO.test(texto)) {
    err.codigo = 'contexto';
    const m = /request \((\d+) tokens?\)[^(]*\((\d+) tokens?\)/i.exec(texto);
    if (m) {
      err.tokensPedido = Number(m[1]);
      err.tokensDisponiveis = Number(m[2]);
    }
  }
  return err;
}

/**
 * Estimativa CONSERVADORA de tokens (sem tokenizador). Qwen/DeepSeek/Llama
 * partem número em dígitos soltos, e pontuação quase sempre é um token:
 * "R$ 10.319,14" são ~11 tokens em 12 caracteres, enquanto texto corrido em
 * português fica perto de 3,5–4 caracteres por token. Usado pra conferir o
 * tamanho ANTES de enviar (destilador) e quando o erro não traz as contagens.
 */
function estimarTokens(texto) {
  const t = String(texto || '');
  if (!t) return 0;
  const digitos = (t.match(/\d/g) || []).length;
  const pontuacao = (t.match(/[^\p{L}\d\s]/gu) || []).length;
  const resto = t.length - digitos - pontuacao;
  return Math.ceil(digitos + pontuacao + resto / 3.2);
}

const MARCA_DE_CORTE = '\n\n[… trecho cortado pelo AuGPT para caber na janela de contexto do modelo …]\n\n';

/**
 * Corta o MEIO das mensagens mais longas até o total caber em `alvo`
 * tokens. O começo (pedido, cabeçalho) e o fim (instruções, que nos prompts
 * do AuGPT costumam vir depois do material) ficam. A razão
 * caracteres/token vem da contagem REAL que o Ollama devolveu no erro.
 */
function reduzirParaCaber(messages, { tokensPedido, alvo }) {
  const tamanhos = messages.map((m) => String(m.content || '').length);
  const totalChars = tamanhos.reduce((a, b) => a + b, 0);
  if (!totalChars || !tokensPedido || !(alvo > 0) || tokensPedido <= alvo) return null;
  const charsPorToken = totalChars / tokensPedido;
  // 8% de folga: a razão do prompt inteiro não é a do trecho cortado
  let sobra = Math.ceil((tokensPedido - alvo) * charsPorToken * 1.08);
  const copia = messages.map((m) => ({ ...m }));
  // material (resultados de ferramenta, páginas) é cortado antes; a mensagem
  // system só entra se não houver outro jeito — cortar o meio dela apagava o
  // catálogo de ferramentas e as regras da decisão (revisão independente v5)
  const ordem = tamanhos
    .map((n, i) => [n, i, messages[i].role === 'system' ? 1 : 0])
    .sort((a, b) => a[2] - b[2] || b[0] - a[0]);
  let cortados = 0;
  for (const [, i] of ordem) {
    if (sobra <= 0) break;
    const texto = String(copia[i].content || '');
    // preserva pelo menos 1.500 caracteres de cada mensagem (começo + fim)
    const removivel = Math.max(0, texto.length - 1500);
    if (!removivel) continue;
    const remover = Math.min(removivel, sobra + MARCA_DE_CORTE.length);
    const restante = texto.length - remover;
    const fim = Math.max(500, Math.floor(restante * 0.35));
    const inicio = restante - fim;
    copia[i].content = `${texto.slice(0, inicio)}${MARCA_DE_CORTE}${texto.slice(texto.length - fim)}`;
    sobra -= remover - MARCA_DE_CORTE.length;
    cortados += remover;
  }
  if (sobra > 0) return null; // nem cortando tudo que dá: melhor falhar claro
  return { messages: copia, cortados };
}

/** Alvo do reenvio: a janela menos o espaço da resposta (no máximo 1/4 dela) e 3% de margem. */
function alvoDoReenvio(err, numPredict) {
  const janela = err.tokensDisponiveis;
  if (!janela) return 0;
  return Math.floor(janela * 0.97) - Math.min(numPredict || 0, Math.floor(janela / 4));
}

/**
 * Executa `enviar(messages)`; se o Ollama recusar por contexto, reduz e
 * tenta mais uma vez. Devolve `{ resultado, reducao }` — `reducao` diz
 * quanto foi cortado (null quando não precisou).
 */
async function comReducaoDeContexto(messages, numPredict, signal, enviar) {
  try {
    return { resultado: await enviar(messages), reducao: null };
  } catch (err) {
    if (err?.codigo !== 'contexto' || signal?.aborted) throw err;
    const tokensPedido = err.tokensPedido || estimarTokens(messages.map((m) => m.content).join('\n'));
    const alvo = alvoDoReenvio(err, numPredict);
    const reduzido = reduzirParaCaber(messages, { tokensPedido, alvo });
    if (!reduzido) throw err;
    const resultado = await enviar(reduzido.messages);
    return {
      resultado,
      reducao: { tokensPedido, tokensDisponiveis: err.tokensDisponiveis, alvo, caracteresCortados: reduzido.cortados },
    };
  }
}

async function request(host, path, { method = 'POST', body, signal, timeout = 300000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  // Repassa o abort do `signal` externo (ex.: this.controller.signal do
  // Agent, vivo pela execução INTEIRA) pro controller interno desta chamada
  // isolada. Bug real batido pelo Davi (2026-09-20, "MaxListenersExceededWarning:
  // 11 abort listeners added to [AbortSignal]"): sem o removeEventListener no
  // `finally` abaixo, cada chat()/embed() feito durante um run() ficava PRA
  // SEMPRE registrado no signal externo — o `{ once: true }` só limpa
  // sozinho se o abort de fato disparar, e a maioria das chamadas termina
  // normalmente, sem abortar. Um run com várias chamadas de modelo (decisão,
  // redação, copiloto, embeddings) acumulava um listener por chamada.
  let aoAbortar;
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else {
      aoAbortar = () => controller.abort(signal.reason);
      signal.addEventListener('abort', aoAbortar, { once: true });
    }
  }

  try {
    const res = await fetch(`${host.replace(/\/$/, '')}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw erroDoOllama(res.status, text, 400);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
    if (aoAbortar) signal.removeEventListener('abort', aoAbortar);
  }
}

/** Verifica se o servidor Ollama está no ar e retorna a versão. */
async function health(host = DEFAULT_HOST) {
  try {
    const data = await request(host, '/api/version', { method: 'GET', timeout: 4000 });
    return { online: true, version: data.version || 'desconhecida' };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

/** Lista os modelos já baixados localmente. */
async function listModels(host = DEFAULT_HOST) {
  const data = await request(host, '/api/tags', { method: 'GET', timeout: 8000 });
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    family: m.details?.family || '',
    parameters: m.details?.parameter_size || '',
  }));
}

/**
 * Lista os modelos CARREGADOS agora (GET /api/ps) — diferente de listModels
 * (o que está baixado no disco): aqui é o que está de fato ocupando memória
 * neste momento, com `sizeVram` dizendo ONDE. Usado pra alimentar o
 * indicador "2ª IA" na tela do agente (Copiloto nível 2, modo "doisModelos")
 * — sem isso, não tinha como confirmar de fora que `numGpu:0` realmente
 * colocou o crítico dedicado na CPU (caso real: Davi testou o modo "2 IAs"
 * numa pergunta simples e não tinha como saber, só olhando a conversa, se o
 * segundo modelo chegou a ser usado).
 *
 * `sizeVram === 0` → 100% CPU. `sizeVram === size` → 100% GPU. Qualquer
 * valor entre os dois → dividido entre os dois (Ollama descarrega parte do
 * modelo pra RAM quando não cabe inteiro na VRAM).
 */
async function psModels(host = DEFAULT_HOST) {
  const data = await request(host, '/api/ps', { method: 'GET', timeout: 4000 });
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size ?? 0,
    sizeVram: m.size_vram ?? 0,
    expiraEm: m.expires_at || null,
  }));
}

/**
 * Capacidades do modelo (POST /api/show → `capabilities`, Ollama ≥ 0.6):
 * "completion", "tools", "thinking", "vision", "embedding" e, no 0.35+,
 * "decision" (tev1, Nimble — só escolhem entre opções, não conversam; ver
 * docs/ARQUITETURA.md, Decisores). Cache por host+modelo; falha → [] (quem
 * chama cai na regra por nome).
 */
const cacheDeCapacidades = new Map();

async function capacidades(host = DEFAULT_HOST, model, { timeout = 4000 } = {}) {
  if (!model) return [];
  const chave = `${host}|${model}`;
  if (cacheDeCapacidades.has(chave)) return cacheDeCapacidades.get(chave);
  try {
    const data = await request(host, '/api/show', { body: { model }, timeout });
    const lista = Array.isArray(data.capabilities) ? data.capabilities.map((c) => String(c).toLowerCase()) : [];
    cacheDeCapacidades.set(chave, lista);
    return lista;
  } catch {
    return []; // não guarda: o Ollama pode só estar subindo
  }
}

/** listModels + capacidades de cada um (em paralelo; falha individual = []). */
async function listModelsComCapacidades(host = DEFAULT_HOST) {
  const modelos = await listModels(host);
  return Promise.all(modelos.map(async (m) => ({ ...m, capacidades: await capacidades(host, m.name) })));
}

/**
 * Descarrega um modelo da memória (GPU e/ou CPU), sem parar o servidor
 * Ollama em si — mesmo endpoint de sempre (`/api/generate`), só que com
 * `keep_alive: 0` e sem `prompt`: o Ollama entende isso como "descarregar
 * agora", sem rodar nenhuma inferência de verdade.
 *
 * Pedido de Davi 2026-09-14 ("fazer um checklist das IAs rodando e fechar
 * elas antes de fechar [o AuGPT], pra liberar os recursos do PC"): usado no
 * encerramento da janela (`electron/main.js`), um POST por modelo que
 * `psModels` (acima) mostrar carregado. Belisca só os modelos que o AuGPT
 * carregou — o processo do `ollama serve` continua rodando depois (ver
 * `src/ollama-runtime.js`: o usuário pode estar usando o Ollama por fora do
 * AuGPT, fechar o app não deveria derrubar o serviço dele).
 *
 * Timeout bem mais curto que o padrão de `request` (300s) de propósito: isto
 * roda no caminho de FECHAR a janela — não pode deixar o usuário preso
 * tentando fechar o próprio app se o Ollama estiver lento ou travado.
 */
async function unloadModel(host, model, { timeout = 8000 } = {}) {
  await request(host, '/api/generate', { body: { model, keep_alive: 0 }, timeout });
}

/**
 * Ollama aceita um JSON Schema no campo `format` desde a v0.5 — não só a string
 * "json". Com schema, a forma da resposta é garantida pela gramática de
 * decodificação, e um enum de nomes torna ferramenta inexistente impossível.
 *
 * Nem toda instalação ou runner suporta. A primeira falha marca o par
 * host+modelo e as chamadas seguintes caem para "json" sem tentar de novo.
 */
const semSuporteAEsquema = new Set();

function suportaEsquema(host, model) {
  return !semSuporteAEsquema.has(`${host}|${model}`);
}

const ERRO_DE_ESQUEMA = /format|schema|grammar|invalid.*json|unsupported/i;

/**
 * Modelos "raciocinadores" (DeepSeek-R1 e afins) podem emitir um bloco de
 * pensamento antes da resposta de verdade. Quando o Ollama devolve isso já
 * separado (campo `message.thinking`, só acontece se a chamada passar
 * `think`), ele nunca chega a aparecer aqui dentro de `content` — mas nem
 * toda instalação, versão de Ollama ou template do modelo faz essa separação
 * (varia conforme como o modelo foi baixado), e aí o bloco pode vazar cru
 * dentro do próprio `content`, como texto `<think>...</think>`.
 *
 * Caso real de produção (testando DeepSeek R1 8B numa prova de 10
 * questões): a chamada de DECISÃO (JSON com esquema/gramática obrigatória)
 * falhou repetidamente em seguir o protocolo — plausível que o hábito do
 * modelo de "pensar antes" tenha entrado em conflito com a decodificação
 * restrita por gramática, que espera o JSON começar já na primeira posição.
 * Rede de segurança: se um bloco de pensamento aparecer aqui mesmo assim,
 * tira antes de devolver — quem lê `content` (extração de JSON, protocolo de
 * decisão) não deveria precisar lidar com isso. Não mexe em nada se não
 * houver bloco (regex não casa, texto sai como entrou) — inofensivo para
 * qualquer modelo que não faça isso.
 */
function semBlocoDePensamento(texto) {
  const m = /^[\s\S]*?<think>[\s\S]*?<\/think>\s*/i.exec(texto);
  return m ? texto.slice(m[0].length) : texto;
}

/**
 * Chamada de chat.
 * - `esquema`: objeto JSON Schema (caminho preferido)
 * - `json: true`: apenas garante JSON sintático (reserva)
 * - `pensar`: repassado como `think` pro Ollama (true/false) — só entra no
 *   corpo da requisição quando definido explicitamente; `undefined` (padrão)
 *   deixa o modelo/template decidir sozinho, sem mudar comportamento de
 *   quem nunca passou isto. Usado para desligar o raciocínio explícito nas
 *   chamadas de DECISÃO (formato rígido, sem espaço pra "pensar alto" antes
 *   do JSON) mantendo-o livre nas chamadas de texto solto (redação, crítica
 *   do plano), onde pensar mais tende a ajudar, não atrapalhar.
 * - `numGpu`: repassado como `options.num_gpu` — mesmo espírito de `pensar`,
 *   só entra quando definido explicitamente. Usado pelo Copiloto nível 2 em
 *   modo "doisModelos" (ver Agent.consultarCritico/criticaDoPlano em
 *   loop.js): `numGpu: 0` força o crítico dedicado a rodar na CPU, pra não
 *   disputar VRAM com o modelo principal, que continua na GPU normalmente.
 */
/**
 * Padrão de `think` para as chamadas que não passam `pensar` (10/10): o
 * agente desliga no início de cada execução (`pensarNasEtapas` em Ajustes,
 * padrão desligado). Modelo que pensa (qwen3.5, R1) gastava o limite curto
 * de crítica, plano e destilação raciocinando e devolvia texto vazio.
 * `null` = não manda o campo (comportamento antigo, usado fora do agente).
 */
let pensarPadrao = null;
function definirPensarPadrao(valor) {
  pensarPadrao = valor === true || valor === false ? valor : null;
}

async function chat({
  host = DEFAULT_HOST,
  model,
  messages,
  json = false,
  esquema = null,
  temperature = 0.4,
  numCtx = 8192,
  numPredict = 1024,
  manterVivo = '30m',
  pensar,
  numGpu,
  // ferramentas nativas do Ollama (15/10, núcleo de pesquisa): [{ type: 'function', function: { name, description, parameters } }]
  tools,
  signal,
}) {
  const usarEsquema = Boolean(esquema) && suportaEsquema(host, model);

  const corpo = (msgs, formato) => ({
    model,
    messages: msgs,
    stream: false,
    // Sem isto o Ollama descarrega o modelo depois de alguns minutos ociosos, e
    // o recarregamento entra no tempo de cada execução. Com modelo por função,
    // pior ainda: alternar entre dois modelos força troca a cada passo.
    keep_alive: manterVivo,
    ...(formato ? { format: formato } : {}),
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
    ...(pensar === undefined ? (pensarPadrao === null ? {} : { think: pensarPadrao }) : { think: pensar }),
    options: {
      temperature,
      num_ctx: numCtx,
      num_predict: numPredict,
      ...(numGpu === undefined ? {} : { num_gpu: numGpu }),
    },
  });

  const enviar = async (msgs) => {
    if (usarEsquema && suportaEsquema(host, model)) {
      try {
        return { data: await request(host, '/api/chat', { body: corpo(msgs, esquema), signal }), via: 'esquema' };
      } catch (err) {
        if (signal?.aborted || err.codigo === 'contexto' || !ERRO_DE_ESQUEMA.test(err.message)) throw err;
        semSuporteAEsquema.add(`${host}|${model}`); // não insiste nas próximas
      }
    }
    return {
      data: await request(host, '/api/chat', { body: corpo(msgs, json || esquema ? 'json' : null), signal }),
      via: json || esquema ? 'json' : 'texto',
    };
  };

  const { resultado, reducao } = await comReducaoDeContexto(messages, numPredict, signal, enviar);
  const { data, via } = resultado;

  return {
    content: semBlocoDePensamento(data.message?.content ?? ''),
    // Separado quando o Ollama já devolve assim (chamada com `pensar`
    // definido e modelo/template com suporte) — não usado por ninguém ainda,
    // só exposto pra quem quiser logar/depurar o raciocínio do modelo depois.
    pensamento: data.message?.thinking ?? null,
    // chamadas de ferramenta que o modelo fez (vazio sem `tools`)
    chamadas: Array.isArray(data.message?.tool_calls) ? data.message.tool_calls : [],
    via,
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
    durationMs: Math.round((data.total_duration ?? 0) / 1e6),
    // prompt recusado por contexto e reenviado reduzido (null quando não precisou)
    contextoReduzido: reducao,
  };
}

/**
 * Embeddings para a memória vetorial. Tenta o endpoint novo (/api/embed) e
 * cai para o antigo (/api/embeddings) em instalações mais velhas.
 */
async function embed({ host = DEFAULT_HOST, model = 'nomic-embed-text', input, signal }) {
  try {
    const data = await request(host, '/api/embed', { body: { model, input }, signal, timeout: 60000 });
    if (Array.isArray(data.embeddings)) return data.embeddings;
  } catch (err) {
    if (!/404/.test(err.message)) throw err;
  }
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  for (const prompt of list) {
    const data = await request(host, '/api/embeddings', { body: { model, prompt }, signal, timeout: 60000 });
    out.push(data.embedding);
  }
  return out;
}

/**
 * Chat com streaming: o Ollama devolve NDJSON, uma linha por token.
 * `onToken` é chamado a cada fragmento — é o que faz a conversa "digitar".
 */
async function chatStreamUmaVez({
  host = DEFAULT_HOST,
  model,
  messages,
  temperature = 0.6,
  numCtx = 8192,
  numPredict = 2048,
  manterVivo = '30m',
  pensar,
  signal,
  onToken,
}) {
  const res = await fetch(`${host.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: manterVivo,
      // 10/10 (SR-71 com qwen3.5:9b): sem `think: false` o modelo que pensa
      // gastava os 3.072 tokens da redação raciocinando e a resposta saía vazia
      ...(pensar === undefined ? (pensarPadrao === null ? {} : { think: pensarPadrao }) : { think: pensar }),
      options: { temperature, num_ctx: numCtx, num_predict: numPredict },
    }),
    signal,
  });

  if (!res.ok) {
    throw erroDoOllama(res.status, await res.text(), 300);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completo = '';
  let uso = { promptTokens: 0, completionTokens: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';

    for (const linha of linhas) {
      if (!linha.trim()) continue;
      let dado;
      try {
        dado = JSON.parse(linha);
      } catch {
        continue;
      }
      if (dado.error) throw new Error(dado.error);
      const pedaco = dado.message?.content;
      if (pedaco) {
        completo += pedaco;
        onToken?.(pedaco);
      }
      if (dado.done) {
        uso = {
          promptTokens: dado.prompt_eval_count ?? 0,
          completionTokens: dado.eval_count ?? 0,
          // Pedido de Davi 2026-09-23 (gráfico "qual parte do raciocínio levou
          // mais tempo/custou mais tokens"): faltava aqui — `chat()` (não
          // streaming) já devolvia `durationMs` desde sempre, mas `chatStream`
          // (usado por `redigir()`, a chamada de redação) descartava o mesmo
          // campo que o Ollama manda igual no chunk final (`total_duration`,
          // nanossegundos). Sem isso, a redação sempre aparecia com custo de
          // tempo zero no detalhamento por fase, mesmo custando de verdade.
          durationMs: Math.round((dado.total_duration ?? 0) / 1e6),
        };
      }
    }
  }

  // rede de segurança: modelo que pensa e escreve o <think> no próprio texto
  return { content: semBlocoDePensamento(completo), ...uso };
}

/** Streaming com a mesma proteção de contexto de `chat` (reduz e reenvia uma vez). */
async function chatStream(opcoes) {
  const { resultado, reducao } = await comReducaoDeContexto(opcoes.messages, opcoes.numPredict ?? 2048, opcoes.signal, (msgs) =>
    chatStreamUmaVez({ ...opcoes, messages: msgs })
  );
  return { ...resultado, contextoReduzido: reducao };
}

/**
 * Baixa/instala um modelo no Ollama — POST /api/pull, NDJSON de progresso
 * (mesmo mecanismo de leitura de `chatStream` acima, formato de linha
 * diferente: `{status, digest?, total?, completed?}` em vez de
 * `{message:{content}}`). `onProgress` é chamado a cada linha do stream —
 * usado pela UI pra montar uma barra de progresso (ver IPC `ollama:pull`,
 * electron/main.js). Item do Copiloto nível 2 / ciclo de vida do Ollama:
 * hoje o app só LISTA modelos já instalados (`listModels` acima); isto é o
 * que falta pra instalar um de dentro do próprio AuGPT.
 */
async function pullModel({ host = DEFAULT_HOST, name, signal, onProgress }) {
  const res = await fetch(`${host.replace(/\/$/, '')}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ultimoStatus = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';

    for (const linha of linhas) {
      if (!linha.trim()) continue;
      let dado;
      try {
        dado = JSON.parse(linha);
      } catch {
        continue;
      }
      if (dado.error) throw new Error(dado.error);
      ultimoStatus = dado.status || ultimoStatus;
      onProgress?.({
        status: dado.status || '',
        digest: dado.digest || null,
        total: dado.total ?? null,
        completed: dado.completed ?? null,
      });
    }
  }

  return { status: ultimoStatus };
}

/**
 * Modelo de decisão (Tev1, Nimble…): POST /v1/systemone, Ollama ≥ 0.35.
 * Não conversa — devolve, para cada pergunta, a escolha e a confiança
 * (`answers.<pergunta>.choice/confidence/probabilities`, ou `.noul` para
 * sim/não). Usado pelo roteador híbrido (src/agent/roteador.js). Timeout
 * curto de propósito: é uma decisão de roteamento, não pode segurar a
 * execução — quem chama cai na regra de código se der erro.
 */
async function decidir({ host = DEFAULT_HOST, model, state, questions, keepAlive = '10m', timeout = 8000, signal } = {}) {
  const data = await request(host, '/v1/systemone', { body: { model, state, questions, keep_alive: keepAlive }, timeout, signal });
  return data?.answers || {};
}

module.exports = {
  DEFAULT_HOST, health, listModels, psModels, unloadModel, chat, chatStream, embed, pullModel, suportaEsquema, semBlocoDePensamento, definirPensarPadrao,
  estimarTokens, reduzirParaCaber, erroDoOllama, MARCA_DE_CORTE, capacidades, listModelsComCapacidades, decidir,
};
