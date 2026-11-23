'use strict';

/**
 * Modelos pelo llama.cpp (22/11, Davi: "implemente uma opção dentro do augpt para usar"): o Inkling 2 Mini saiu em
 * 20/11 e o Ollama do Windows ainda não carrega a arquitetura dele ("unknown model architecture: 'inkling2_loop'"; o
 * Ollama 0.40.17 só roda no Mac). O llama.cpp do dia já roda. Aqui o AuGPT liga o llama-server que o usuário escolheu
 * nos Ajustes (Componentes → Modelos pelo llama.cpp), no primeiro uso do modelo, e responde no formato do Ollama: quem
 * chama (src/llm/ollama.js) não sabe a diferença. Um servidor por vez (a placa é uma só); desliga depois de 10 minutos
 * parado e ao fechar o app.
 *
 * Medido com o Inkling 2 Mini (RTX 5070 Ti 16 GB, UD-Q3_K_XL "Mainline" do Unsloth, `--n-cpu-moe 6 -c 16384`): 870
 * tok/s lendo o prompt, 53 tok/s escrevendo; nas perguntas de produto da régua, escolhas iguais às do Qwen 3.5 9B
 * (Simgot EM6L em 1º no fone) e 1,5 a 2× mais lento. Ele pensa mesmo com o esforço no mínimo: o limite de saída ganha
 * `folga` (1024 tokens) — sem ela, o JSON das decisões curtas (60–160 tokens) voltava vazio.
 *
 * RAM (23/11, Davi: "está vazando para a RAM"): com o arquivo mapeado (o padrão do llama.cpp, `mmap`), o Windows
 * deixava o modelo INTEIRO também na RAM — 14,4 GB em uso pelo processo, num PC de 32 GB, e 414/24 tok/s. Com
 * `--load-mode dio` (leitura direta do disco) ficam só as camadas dos especialistas na CPU: 4,3 GB, 881/49 tok/s.
 * `--load-mode none` também tira o mapa, mas leva mais de 2 minutos para carregar. Vai nos argumentos (o llama.cpp
 * antigo usa `--no-mmap`).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const OCIOSO_MS = 10 * 60 * 1000;
const LIGAR_MS = 240 * 1000; // modelo de 14 GB no SSD: ~16 s; folga para disco lento
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

let modelos = [];
const servidores = new Map(); // nome → { processo, url, relogio, assinatura, saida }
let iniciarProcesso = spawn;
let buscar = (...a) => fetch(...a);

const semLatest = (n) => String(n || '').replace(/:latest$/, '');
const assinatura = (m) => JSON.stringify([m.servidor, m.arquivo, m.mmproj || '', m.argumentos || '']);

/** Separa os argumentos como o terminal ("-c 16384 --jinja", com aspas para caminho com espaço). */
function separarArgumentos(texto) {
  return (String(texto || '').match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"(.*)"$/, '$1'));
}

/** A lista dos Ajustes (`modelosLlamaCpp`): só o que tem nome, programa e arquivo; o servidor de um item mudado desliga. */
function definirModelos(lista = []) {
  const validos = (Array.isArray(lista) ? lista : [])
    .map((m) => ({
      nome: semLatest(String(m?.nome || '').trim()),
      servidor: String(m?.servidor || '').trim(),
      arquivo: String(m?.arquivo || '').trim(),
      mmproj: String(m?.mmproj || '').trim(),
      argumentos: String(m?.argumentos || '').trim(),
      esforco: String(m?.esforco || 'low').trim() || 'low',
      folga: Number.isFinite(Number(m?.folga)) ? Math.max(0, Number(m.folga)) : 1024,
    }))
    .filter((m) => m.nome && m.servidor && m.arquivo);
  for (const [nome, s] of servidores) {
    const novo = validos.find((m) => m.nome === nome);
    if (!novo || assinatura(novo) !== s.assinatura) parar(nome);
  }
  modelos = validos;
  return modelos;
}

/** O modelo do llama.cpp com esse nome (com ou sem ":latest"), ou null. */
function doLlamaCpp(nome) {
  const n = semLatest(nome);
  return n ? modelos.find((m) => m.nome === n) || null : null;
}

/** Para a lista de modelos (no formato de /api/tags). */
function naLista() {
  return modelos.map((m) => {
    let size = 0;
    try {
      size = fs.statSync(m.arquivo).size;
    } catch {
      // arquivo fora do lugar: aparece, e o erro vem ao ligar
    }
    return { name: m.nome, model: m.nome, size, details: { family: 'llama.cpp', parameter_size: '', quantization_level: path.basename(m.arquivo) } };
  });
}

/** Os que estão ligados (no formato de /api/ps). */
function ligados() {
  return [...servidores.entries()].filter(([, s]) => s.url).map(([nome]) => ({ name: nome, model: nome, size: 0, size_vram: 0 }));
}

function portaLivre() {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/*
 * A placa livre antes de ligar (23/11, Davi: "o inkling-2-mini está vazando para a RAM"): o Ollama mantém o modelo
 * usado por 30 minutos — com o Qwen 3.5 9B (9 GB) ainda na placa, o Inkling ligou com ~5 GB dela e pôs 6,3 GB na
 * memória compartilhada (lento). Os modelos grandes do Ollama saem da placa antes; o embedding (650 MB) fica.
 */
const GRANDE_NA_PLACA = 1500 * 1024 * 1024;
async function liberarPlaca(host) {
  if (!host) return [];
  const base = String(host).replace(/\/$/, '');
  try {
    const r = await buscar(`${base}/api/ps`, { signal: AbortSignal.timeout(3000) });
    const grandes = ((await r.json())?.models || []).filter((x) => (x.size_vram || 0) >= GRANDE_NA_PLACA).map((x) => x.name);
    await Promise.all(grandes.map((nome) => buscar(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: nome, keep_alive: 0 }), signal: AbortSignal.timeout(15000) }).catch(() => null)));
    return grandes;
  } catch {
    return []; // Ollama fora do ar: liga assim mesmo
  }
}

async function _ligar(m, host) {
  if (!fs.existsSync(m.servidor)) throw new Error(`não achei o llama-server em ${m.servidor}`);
  if (!fs.existsSync(m.arquivo)) throw new Error(`não achei o modelo em ${m.arquivo}`);
  // a placa é uma só: o outro modelo do llama.cpp desliga antes
  for (const nome of servidores.keys()) if (nome !== m.nome) parar(nome);
  await liberarPlaca(host);
  const porta = await portaLivre();
  const args = ['-m', m.arquivo, ...(m.mmproj ? ['--mmproj', m.mmproj] : []), '--host', '127.0.0.1', '--port', String(porta), ...separarArgumentos(m.argumentos)];
  const p = iniciarProcesso(m.servidor, args, { cwd: path.dirname(m.servidor), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const s = { processo: p, url: null, assinatura: assinatura(m), saida: '', relogio: null };
  servidores.set(m.nome, s);
  p.stderr?.on('data', (d) => (s.saida = (s.saida + d).slice(-3000)));
  p.on('exit', () => {
    if (servidores.get(m.nome)?.processo === p) servidores.delete(m.nome);
  });
  const url = `http://127.0.0.1:${porta}`;
  const fim = Date.now() + LIGAR_MS;
  while (Date.now() < fim) {
    await pausa(500);
    if (p.exitCode !== null) break;
    const ok = await buscar(`${url}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    if (ok) {
      s.url = url;
      return s;
    }
  }
  p.kill();
  servidores.delete(m.nome);
  const ultima = s.saida.trim().split('\n').filter((l) => / E |error|erro/i.test(l)).pop() || s.saida.trim().split('\n').pop() || 'sem resposta';
  throw new Error(`o llama-server não ligou: ${ultima.slice(0, 300)}`);
}

// as chamadas que chegam juntas no primeiro uso esperam o MESMO servidor ligar (o AuGPT faz várias em paralelo)
const ligando = new Map();
async function ligar(m, host) {
  const s = servidores.get(m.nome);
  if (s?.url && s.assinatura === assinatura(m)) return s;
  if (!ligando.has(m.nome)) ligando.set(m.nome, _ligar(m, host).finally(() => ligando.delete(m.nome)));
  return ligando.get(m.nome);
}

function adiarDesligamento(m) {
  const s = servidores.get(m.nome);
  if (!s) return;
  clearTimeout(s.relogio);
  s.relogio = setTimeout(() => parar(m.nome), OCIOSO_MS);
  s.relogio.unref?.();
}

function parar(nome) {
  const s = servidores.get(nome);
  if (!s) return;
  clearTimeout(s.relogio);
  s.processo?.kill();
  servidores.delete(nome);
}
const pararTodos = () => [...servidores.keys()].forEach(parar);
// o servidor nunca fica órfão: se o AuGPT sair sem passar pelo "ao fechar" (erro, bancada), ele cai junto
process.once('exit', pararTodos);

/* ------------------------------ formato do Ollama ⇄ OpenAI ------------------------------ */

/** Mensagens do Ollama → OpenAI: imagens em partes, tool_calls com id, e a resposta da ferramenta ligada ao id. */
function mensagensOpenAI(msgs = []) {
  const saida = [];
  let pendentes = [];
  let n = 0;
  for (const m of msgs) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map((c) => ({ id: `c${(n += 1)}`, type: 'function', function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments || {}) } }));
      pendentes = calls.map((c) => c.id);
      saida.push({ role: 'assistant', content: m.content || '', tool_calls: calls });
    } else if (m.role === 'tool') {
      saida.push({ role: 'tool', tool_call_id: pendentes.shift() || `c${(n += 1)}`, content: String(m.content ?? '') });
    } else if (Array.isArray(m.images) && m.images.length) {
      saida.push({ role: m.role, content: [{ type: 'text', text: m.content || '' }, ...m.images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b}` } }))] });
    } else {
      saida.push({ role: m.role, content: m.content ?? '' });
    }
  }
  return saida;
}

function pedidoOpenAI(m, b) {
  const o = b.options || {};
  const formato = b.format === 'json' ? { response_format: { type: 'json_object' } } : b.format && typeof b.format === 'object' ? { response_format: { type: 'json_schema', json_schema: { name: 'saida', schema: b.format } } } : {};
  return {
    messages: mensagensOpenAI(b.messages),
    stream: Boolean(b.stream),
    ...(b.stream ? { stream_options: { include_usage: true } } : {}),
    temperature: o.temperature ?? 0.6,
    // o modelo que pensa mesmo com o esforço no mínimo: folga no limite (como o AuGPT faz com o gpt-oss)
    ...(o.num_predict > 0 ? { max_tokens: o.num_predict + m.folga } : {}),
    ...(Array.isArray(b.tools) && b.tools.length ? { tools: b.tools } : {}),
    ...formato,
    reasoning_effort: m.esforco,
    chat_template_kwargs: { reasoning_effort: m.esforco },
  };
}

const chamadasOllama = (calls) =>
  (calls || []).map((c) => {
    let args = c.function?.arguments;
    try {
      args = typeof args === 'string' ? JSON.parse(args || '{}') : args || {};
    } catch {
      args = {};
    }
    return { function: { name: c.function?.name, arguments: args } };
  });

const json = (dados, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Responde a um pedido da API do Ollama (`/api/chat`, `/api/show`, `/api/generate`) com o llama-server: devolve um
 * Response como o do Ollama (JSON ou NDJSON no streaming). Erro do servidor volta com o texto dele (o de contexto
 * cheio é reconhecido por src/llm/ollama.js, que reduz o pedido e tenta de novo).
 */
async function responderComoOllama(m, caminho, corpo = {}, { signal, host } = {}) {
  if (caminho.startsWith('/api/show')) return json({ capabilities: ['completion', 'tools', ...(m.mmproj ? ['vision'] : [])], details: { family: 'llama.cpp' } });
  if (caminho.startsWith('/api/generate')) {
    if (corpo.keep_alive === 0 || corpo.keep_alive === '0') parar(m.nome);
    return json({ done: true });
  }
  if (!caminho.startsWith('/api/chat')) return json({ error: `${caminho} não existe para modelo do llama.cpp` }, 404);
  let s;
  try {
    s = await ligar(m, host);
  } catch (err) {
    return json({ error: err.message }, 503);
  }
  adiarDesligamento(m);
  const t0 = Date.now();
  const r = await buscar(`${s.url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedidoOpenAI(m, corpo)), signal });
  if (!r.ok) {
    const texto = await r.text();
    // contexto cheio: no texto do Ollama, com as contagens — src/llm/ollama.js reduz o pedido e tenta de novo
    let e = null;
    try {
      e = JSON.parse(texto)?.error;
    } catch {
      e = null;
    }
    const cheio = e?.n_prompt_tokens && e?.n_ctx ? `request (${e.n_prompt_tokens} tokens) exceeds the available context size (${e.n_ctx} tokens)` : '';
    return json({ error: cheio || (e?.message ? String(e.message) : texto).slice(0, 2000) }, r.status);
  }
  if (!corpo.stream) {
    const j = await r.json();
    const msg = j.choices?.[0]?.message || {};
    adiarDesligamento(m);
    return json({
      model: m.nome,
      done: true,
      done_reason: j.choices?.[0]?.finish_reason || 'stop',
      message: { role: 'assistant', content: msg.content || '', ...(msg.reasoning_content ? { thinking: msg.reasoning_content } : {}), ...(msg.tool_calls?.length ? { tool_calls: chamadasOllama(msg.tool_calls) } : {}) },
      prompt_eval_count: j.usage?.prompt_tokens || 0,
      eval_count: j.usage?.completion_tokens || 0,
      total_duration: (Date.now() - t0) * 1e6,
    });
  }
  // streaming: SSE do llama-server → NDJSON do Ollama (uma linha por pedaço, a última com done e as contagens)
  const enc = new TextEncoder();
  const linha = (o) => enc.encode(`${JSON.stringify(o)}\n`);
  const corpoNdjson = new ReadableStream({
    async start(ctrl) {
      let resto = '';
      let uso = {};
      try {
        for await (const pedaco of r.body) {
          resto += Buffer.from(pedaco).toString('utf8');
          const linhas = resto.split('\n');
          resto = linhas.pop();
          for (const l of linhas) {
            const d = l.replace(/^data:\s*/, '').trim();
            if (!d || d === '[DONE]') continue;
            let j;
            try {
              j = JSON.parse(d);
            } catch {
              continue;
            }
            if (j.usage) uso = j.usage;
            const conteudo = j.choices?.[0]?.delta?.content;
            if (conteudo) ctrl.enqueue(linha({ model: m.nome, done: false, message: { role: 'assistant', content: conteudo } }));
          }
        }
        ctrl.enqueue(linha({ model: m.nome, done: true, done_reason: 'stop', message: { role: 'assistant', content: '' }, prompt_eval_count: uso.prompt_tokens || 0, eval_count: uso.completion_tokens || 0, total_duration: (Date.now() - t0) * 1e6 }));
        ctrl.close();
      } catch (err) {
        ctrl.error(err);
      } finally {
        adiarDesligamento(m);
      }
    },
  });
  return new Response(corpoNdjson, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

/** Para a bancada: troca o processo e o fetch, e devolve o estado interno. */
function _paraTestes({ iniciar, fetch: f } = {}) {
  if (iniciar) iniciarProcesso = iniciar;
  if (f) buscar = f;
  return { servidores };
}

/** Para os Ajustes: o que está configurado e o que está ligado agora. */
function estado() {
  return modelos.map((m) => ({ ...m, ligado: Boolean(servidores.get(m.nome)?.url) }));
}

module.exports = { liberarPlaca, definirModelos, doLlamaCpp, naLista, ligados, responderComoOllama, parar, pararTodos, estado, separarArgumentos, mensagensOpenAI, pedidoOpenAI, _paraTestes };
