'use strict';

/**
 * Calibração da placa (19/10): medido na RTX 3060 Ti do Davi, o qwen3.5:9b ficava 12–16% na
 * RAM em qualquer contexto (55 tokens/s); com todas as camadas na placa, inteiro e a 79 tokens/s.
 */

const cal = require('../../src/calibracao-gpu');
const ollama = require('../../src/llm/ollama');

// um Ollama falso: /api/ps diz se transbordou; /api/generate devolve a velocidade de cada jeito
const ollamaFalso = ({ transbordaAntes = true, cabeDepois = true, tpsPadrao = 55, tpsTodas = 79, semMemoria = false } = {}) => {
  let forcado = false;
  return async (url, opcoes = {}) => {
    if (url.endsWith('/api/ps')) {
      const size = 6.2e9;
      const naPlaca = forcado ? (cabeDepois ? size : size * 0.85) : transbordaAntes ? size * 0.84 : size;
      return { json: async () => ({ models: [{ name: 'qwen3.5:9b', size, size_vram: naPlaca }] }) };
    }
    const corpo = JSON.parse(opcoes.body);
    forcado = corpo.options.num_gpu === 99;
    if (forcado && semMemoria) return { json: async () => ({ error: 'cudaMalloc failed: out of memory' }) };
    const tps = forcado ? tpsTodas : tpsPadrao;
    return { json: async () => ({ eval_count: 80, eval_duration: (80 / tps) * 1e9 }) };
  };
};

module.exports = [
  {
    nome: 'calibração da placa: modelo que transbordou para a RAM e cabe inteiro com todas as camadas, mais rápido → fica com num_gpu; já inteiro → nem mede; coube mas não ficou mais rápido (RAM compartilhada do driver) ou faltou memória → fica como estava',
    tipo: 'unidade',
    async executar() {
      const h = 'http://127.0.0.1:11434';
      const bom = await cal.calibrar({ host: h, model: 'qwen3.5:9b', fetchImpl: ollamaFalso() });
      const inteiro = await cal.calibrar({ host: h, model: 'qwen3.5:9b', fetchImpl: ollamaFalso({ transbordaAntes: false }) });
      const lento = await cal.calibrar({ host: h, model: 'qwen3.5:9b', fetchImpl: ollamaFalso({ tpsTodas: 50 }) });
      const naoCabe = await cal.calibrar({ host: h, model: 'qwen3.5:9b', fetchImpl: ollamaFalso({ cabeDepois: false }) });
      const semMemoria = await cal.calibrar({ host: h, model: 'qwen3.5:9b', fetchImpl: ollamaFalso({ semMemoria: true }) });
      return [
        bom.precisa && bom.ok && bom.numGpu === 99 && bom.antes === 55 && bom.depois === 79 || JSON.stringify(bom),
        inteiro.precisa === false || JSON.stringify(inteiro),
        lento.ok === false && lento.numGpu === null || JSON.stringify(lento),
        naoCabe.ok === false && naoCabe.coube === false || JSON.stringify(naoCabe),
        semMemoria.ok === false && /out of memory/.test(semMemoria.erro) || JSON.stringify(semMemoria),
      ];
    },
  },
  {
    nome: 'calibração da placa: toda chamada ao modelo calibrado leva o mesmo num_gpu (outro valor recarregaria o modelo); se a placa ficar sem memória, o ajuste sai, quem calibrou é avisado e a chamada se repete do jeito padrão',
    tipo: 'unidade',
    async executar() {
      const original = global.fetch;
      const enviados = [];
      let semMemoria = false;
      global.fetch = async (url, opcoes = {}) => {
        const corpo = JSON.parse(opcoes.body || '{}');
        enviados.push(corpo.options?.num_gpu);
        if (semMemoria && corpo.options?.num_gpu === 99) return { ok: false, status: 500, text: async () => '{"error":"cudaMalloc failed: out of memory"}', json: async () => ({ error: 'cudaMalloc failed: out of memory' }) };
        return { ok: true, status: 200, json: async () => ({ message: { content: 'ok' }, eval_count: 1 }), text: async () => '{"message":{"content":"ok"}}' };
      };
      const avisos = [];
      try {
        ollama.definirCamadasNaPlaca('http://teste:11434', 'qwen3.5:9b', 99, { aoFalhar: (k, m) => avisos.push([k, m]) });
        await ollama.chat({ host: 'http://teste:11434', model: 'qwen3.5:9b', messages: [{ role: 'user', content: 'oi' }] });
        await ollama.chat({ host: 'http://teste:11434', model: 'outro:1b', messages: [{ role: 'user', content: 'oi' }] });
        semMemoria = true;
        const r = await ollama.chat({ host: 'http://teste:11434', model: 'qwen3.5:9b', messages: [{ role: 'user', content: 'oi' }] });
        await ollama.chat({ host: 'http://teste:11434', model: 'qwen3.5:9b', messages: [{ role: 'user', content: 'oi' }] });
        return [
          enviados[0] === 99 && enviados[1] === undefined || `num_gpu enviados: ${JSON.stringify(enviados)}`,
          r.content === 'ok' && avisos.length === 1 && avisos[0][0] === 'http://teste:11434|qwen3.5:9b' && /out of memory/.test(avisos[0][1]) || JSON.stringify({ r, avisos }),
          enviados[enviados.length - 1] === undefined || 'depois da falha, o padrão',
        ];
      } finally {
        global.fetch = original;
        ollama.definirCamadasNaPlaca('http://teste:11434', 'qwen3.5:9b', null);
      }
    },
  },
];
