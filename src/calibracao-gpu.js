'use strict';

/**
 * Calibração da placa de vídeo (19/10, revisão item 7). Medido na RTX 3060 Ti (8 GB) do Davi:
 * o Ollama, por precaução, deixava 12–16% do qwen3.5:9b na RAM do sistema em QUALQUER janela
 * de contexto (8.192 a 16.384), e a resposta saía a 55 tokens/s. Com todas as camadas na
 * placa (num_gpu), o modelo coube inteiro até 32.768 de contexto (6,1 GB) e foi a 80 tokens/s.
 * O contexto nunca foi o limite: a margem que o Ollama reserva era.
 *
 * Quando o modelo carregado transbordou para a RAM, a calibração mede uma resposta curta do
 * jeito padrão e outra com todas as camadas na placa; fica com a segunda só se coube inteira
 * E ficou mais rápida (no Windows, o driver da NVIDIA pode "caber" usando a RAM compartilhada,
 * mais lenta — a velocidade pega isso). Uma vez por modelo; o resultado fica nos Ajustes.
 */

const TODAS = 99;
const PERGUNTA = 'Explique em três frases o que é fotossíntese.';

async function lerPs(host, model, fetchImpl) {
  const ps = await (await fetchImpl(`${host}/api/ps`)).json();
  return (ps.models || []).find((m) => m.name === model || m.model === model) || null;
}

async function medir(host, model, { numCtx, numGpu, fetchImpl }) {
  const corpo = { model, prompt: PERGUNTA, stream: false, think: false, keep_alive: '30m', options: { num_ctx: numCtx, num_predict: 80, ...(numGpu === undefined ? {} : { num_gpu: numGpu }) } };
  const r = await (await fetchImpl(`${host}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })).json();
  if (r.error) throw new Error(r.error);
  return r.eval_count && r.eval_duration ? r.eval_count / (r.eval_duration / 1e9) : 0;
}

const transbordou = (ps) => Boolean(ps && ps.size && ps.size_vram < ps.size * 0.99);

/**
 * → { precisa: false } (já cabe inteiro, ou não está carregado)
 *   ou { precisa: true, ok, numGpu, antes, depois, coube, erro }
 */
async function calibrar({ host, model, numCtx = 16384, fetchImpl = fetch }) {
  const base = String(host).replace(/\/+$/, '');
  const ps = await lerPs(base, model, fetchImpl);
  if (!transbordou(ps)) return { precisa: false, naPlaca: ps ? ps.size_vram / ps.size : null };
  try {
    const antes = await medir(base, model, { numCtx, fetchImpl });
    const depois = await medir(base, model, { numCtx, numGpu: TODAS, fetchImpl });
    const coube = !transbordou(await lerPs(base, model, fetchImpl));
    const ok = coube && depois > antes * 1.05;
    return { precisa: true, ok, numGpu: ok ? TODAS : null, antes: Math.round(antes * 10) / 10, depois: Math.round(depois * 10) / 10, coube };
  } catch (err) {
    // sem memória para todas as camadas: fica como estava (a próxima chamada recarrega no padrão)
    return { precisa: true, ok: false, numGpu: null, erro: String(err.message || err).slice(0, 200) };
  }
}

const chave = (host, model) => `${String(host).replace(/\/+$/, '')}|${model}`;

module.exports = { calibrar, transbordou, chave, TODAS };
