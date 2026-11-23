'use strict';

/**
 * Modelos pelo llama.cpp (22/11, src/llm/llamacpp.js): o modelo que o Ollama do Windows ainda não roda (Inkling 2 Mini)
 * vai pelo llama-server, no formato do Ollama — quem chama (src/llm/ollama.js) não muda.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const llamacpp = require('../../src/llm/llamacpp');
const ollama = require('../../src/llm/ollama');

function montar({ respostas = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-llama-'));
  const servidor = path.join(dir, 'llama-server.exe');
  const arquivo = path.join(dir, 'modelo.gguf');
  fs.writeFileSync(servidor, '');
  fs.writeFileSync(arquivo, 'x'.repeat(10));
  const iniciados = [];
  const pedidos = [];
  const descarregados = [];
  const fila = [...respostas];
  llamacpp._paraTestes({
    iniciar: (exe, args) => {
      const p = new EventEmitter();
      Object.assign(p, { stderr: new EventEmitter(), exitCode: null, kill: () => (p.morto = true) });
      iniciados.push({ exe, args, p });
      return p;
    },
    fetch: async (url, init = {}) => {
      if (url.endsWith('/health')) return { ok: true };
      if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:9b-q8_0', size_vram: 9063e6 }, { name: 'embeddinggemma:300m', size_vram: 650e6 }] }));
      if (url.endsWith('/api/generate')) return (descarregados.push(JSON.parse(init.body)), new Response('{}'));
      const corpo = JSON.parse(init.body || '{}');
      pedidos.push(corpo);
      const r = fila.shift() || { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
      if (r.status) return new Response(JSON.stringify(r.corpo), { status: r.status });
      if (corpo.stream) {
        const sse = r.pedacos.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: r.pedacos.length } })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200 });
      }
      return new Response(JSON.stringify(r), { status: 200 });
    },
  });
  llamacpp.definirModelos([{ nome: 'inkling-2-mini', servidor, arquivo, argumentos: '-ngl 99 --n-cpu-moe 6 -c 16384 --jinja --alias "meu modelo"' }]);
  return { iniciados, pedidos, dir, descarregados };
}

module.exports = [
  {
    nome: 'llama.cpp: o modelo dos Ajustes vai ao llama-server no formato do Ollama — liga uma vez (chamadas juntas esperam o mesmo servidor), folga de 1024 no limite (o Inkling pensa mesmo no mínimo), esforço baixo, ferramentas ida e volta; ":latest" vale; item sem programa ou arquivo fica de fora',
    tipo: 'unidade',
    async executar() {
      const { iniciados, pedidos, descarregados } = montar({
        respostas: [
          { choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } },
          { choices: [{ message: { content: '{"ok": true}' } }] },
          { choices: [{ message: { content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'buscar_na_web', arguments: '{"buscas":["mouse fps"]}' } }] } }] },
        ],
      });
      const [a] = await Promise.all([
        ollama.chat({ model: 'inkling-2-mini', messages: [{ role: 'user', content: 'oi' }], json: true, numPredict: 60 }),
        ollama.chat({ model: 'inkling-2-mini:latest', messages: [{ role: 'user', content: 'oi' }], json: true, numPredict: 60 }),
      ]);
      const comFerramenta = await ollama.chat({
        model: 'inkling-2-mini',
        messages: [
          { role: 'user', content: 'pesquise' },
          { role: 'assistant', content: '', tool_calls: [{ function: { name: 'buscar_na_web', arguments: { buscas: ['a'] } } }] },
          { role: 'tool', tool_name: 'buscar_na_web', content: 'resultado' },
        ],
        tools: [{ type: 'function', function: { name: 'buscar_na_web', parameters: {} } }],
      });
      const terceiro = pedidos[2];
      const fora = llamacpp.definirModelos([{ nome: 'sem-arquivo', servidor: 'x.exe' }, { nome: 'inkling-2-mini', ...llamacpp.estado()[0] }]);
      return [
        iniciados.length === 1 || `um servidor só para as chamadas juntas: ${iniciados.length}`,
        JSON.stringify(descarregados) === '[{"model":"qwen3.5:9b-q8_0","keep_alive":0}]' || `antes de ligar, só o modelo grande do Ollama sai da placa (o embedding fica): ${JSON.stringify(descarregados)}`,
        JSON.stringify(iniciados[0].args.slice(-9, -1)) === '["-ngl","99","--n-cpu-moe","6","-c","16384","--jinja","--alias"]' && iniciados[0].args.at(-1) === 'meu modelo' && iniciados[0].args.includes('--port') || JSON.stringify(iniciados[0].args),
        a.content === '{"ok": true}' && a.promptTokens === 9 || JSON.stringify(a),
        pedidos[0].max_tokens >= 60 + 1024 && pedidos[0].response_format?.type && pedidos[0].reasoning_effort === 'low' || JSON.stringify(pedidos[0]),
        comFerramenta.chamadas[0]?.function?.name === 'buscar_na_web' && comFerramenta.chamadas[0].function.arguments.buscas[0] === 'mouse fps' || JSON.stringify(comFerramenta.chamadas),
        terceiro.messages[1].tool_calls[0].id && terceiro.messages[2].tool_call_id === terceiro.messages[1].tool_calls[0].id && typeof terceiro.messages[1].tool_calls[0].function.arguments === 'string' || JSON.stringify(terceiro.messages),
        fora.length === 1 && fora[0].nome === 'inkling-2-mini' || 'item sem programa ou arquivo fica de fora',
        (!llamacpp.doLlamaCpp('qwen3.5:9b') && Boolean(llamacpp.doLlamaCpp('inkling-2-mini:latest'))) || 'só o modelo dos Ajustes',
      ];
    },
  },
  {
    nome: 'llama.cpp: o streaming vira NDJSON do Ollama (a redação "digita"), o contexto cheio volta como o erro de contexto do Ollama (reduz e tenta de novo), e as capacidades e o "descarregar" respondem sem ligar o servidor à toa',
    tipo: 'unidade',
    async executar() {
      const { iniciados, pedidos } = montar({
        respostas: [
          { pedacos: ['Olá', ', ', 'mundo'] },
          { status: 400, corpo: { error: { code: 400, message: 'the request exceeds the available context size, try increasing it', type: 'exceed_context_size_error', n_prompt_tokens: 20000, n_ctx: 16384 } } },
          { choices: [{ message: { content: 'reduzido' } }] },
        ],
      });
      const tokens = [];
      const s = await ollama.chatStream({ model: 'inkling-2-mini', messages: [{ role: 'user', content: 'oi' }], onToken: (t) => tokens.push(t) });
      const reduzido = await ollama.chat({ model: 'inkling-2-mini', messages: [{ role: 'system', content: 'regras' }, { role: 'user', content: `pergunta ${'x '.repeat(30000)}` }] });
      const caps = await ollama.capacidades('http://127.0.0.1:1', 'inkling-2-mini');
      await ollama.unloadModel('http://127.0.0.1:1', 'inkling-2-mini');
      return [
        s.content === 'Olá, mundo' && tokens.join('|') === 'Olá|, |mundo' && s.promptTokens === 7 || JSON.stringify({ s, tokens }),
        reduzido.content === 'reduzido' && reduzido.contextoReduzido && pedidos.length === 3 || JSON.stringify({ reduzido, n: pedidos.length }),
        caps.includes('tools') && caps.includes('completion') || JSON.stringify(caps),
        iniciados.at(-1).p.morto === true || 'descarregar desliga o servidor',
      ];
    },
  },
  {
    nome: 'llama.cpp no app: a lista só muda por "llamacpp:salvar" (confere os arquivos, só aceita o llama-server e confirma cada programa novo), fica fora do config:set, carrega ao abrir e desliga ao fechar; aparece nos Ajustes',
    tipo: 'unidade',
    executar() {
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      const main = ler('electron/main.js');
      return [
        /delete seguro\.modelosLlamaCpp;/.test(main) || 'fora do config:set',
        /ipcMain\.handle\('llamacpp:salvar'[\s\S]{0,900}existsSync[\s\S]{0,400}\^llama-server\(\\\.exe\)\?\$[\s\S]{0,300}filter\(confirmarLlamaCpp\)/.test(main) || 'salvar confere e confirma',
        /definirModelos\(config\.data\.modelosLlamaCpp\)/.test(main) && /require\('\.\.\/src\/llm\/llamacpp'\)\.pararTodos\(\)/.test(main) || 'carrega ao abrir, desliga ao fechar',
        /id="llamaLista"/.test(ler('renderer/index.html')) && /api\.llamacpp\.salvar/.test(ler('renderer/app-ajustes.js')) && /llamacpp: \{/.test(ler('electron/preload.js')) || 'tela',
      ];
    },
  },
];
