'use strict';

/**
 * Roteador híbrido (2026-10-10): regras de código + modelo de decisão (Tev1).
 *
 * Origem: a avaliação dos decisores (avaliacao/decisores.js, 08/10, 230
 * pedidos reais rotulados à mão). As regras de `tipo-de-pedido.js` acertam
 * 80% da rota e erram sobretudo explicação ("Me conte quem foi…", "como uma
 * estrela se forma" caíam no laço comum: 17 de 48). O Tev1 (4B) acerta 87%
 * sozinho; a combinação "Tev1 quando a confiança dele for ≥ 0,6, senão a
 * regra" chegou a 94% nos mesmos dados (o limite foi escolhido olhando esses
 * dados, então o número real deve ser um pouco menor).
 *
 * O que o modelo NÃO decide (a regra de código é exata nesses casos):
 *   - 'local' (arquivo, pasta, documento da pasta de trabalho);
 *   - 'site' (endereço + ação na página): o Tev1 dizer "site" sem endereço
 *     não dá ao agente onde agir, e ele dizer outra coisa com endereço +
 *     "faça login" seria desmontar uma regra que acertou 6 de 6.
 *
 * O roteador só sugere: quem age continua sendo o loop. Sem modelo
 * configurado, com o Ollama antigo (sem /v1/systemone), com erro ou demora,
 * a regra decide sozinha — nunca trava a execução.
 */

const { tipoDoPedido } = require('./tipo-de-pedido');

const LIMITE_PADRAO = 0.6;
const TEMPO_LIMITE_PADRAO_MS = 8000;

/** Rótulo do modelo → tipo interno de `tipo-de-pedido.js`. */
const ROTA_PARA_TIPO = Object.freeze({
  produto: 'produto',
  guia: 'guia',
  explicacao: 'explicacao',
  site: 'site',
  tarefa: 'livre',
});

/**
 * A mesma pergunta da avaliação de 08/10 (em inglês: a Together AI só
 * testou o Tev1 em inglês; o pedido continua em português). Mudar o texto
 * invalida a medição — rode `node avaliacao/decisores.js` de novo.
 */
const PERGUNTA_ROTA = Object.freeze({
  type: 'choice',
  instructions: 'The state is a message (in Portuguese) sent by a user to an AI assistant. Which kind of request is it?',
  criteria: {
    produto: 'Choose, compare, evaluate or get a recommendation about products to buy (best headphones for a game, A vs B, is product X good for Y, tell me about product X)',
    guia: 'How to get better at something: practical tips, tactics, strategy, training, step-by-step tutorial',
    explicacao: 'Explain a concept, how something works, why something happens, a story, history or biography',
    site: 'Act on a specific website: log in, click buttons, fill a form, download something from the page',
    tarefa: 'Anything else: prices or price history, news and game updates, weather, exam questions to solve, create or read files and documents, opinions, analysis, follow-up requests',
  },
});

const estado = (pedido) => `Mensagem do usuário para um assistente de IA:\n"${String(pedido).slice(0, 1500)}"`;

/** Lê a resposta do /v1/systemone para a pergunta "rota". */
function lerRota(respostas) {
  const r = respostas?.rota;
  if (!r || typeof r.choice !== 'string') return null;
  const confianca = typeof r.confidence === 'number' ? r.confidence : null;
  return { valor: r.choice, confianca, probabilidades: r.probabilities || null };
}

/**
 * Combina a regra com a decisão do modelo. Função pura (sem rede) — é o que
 * a bancada testa e o que avaliacao/decisores.js usa para simular a política.
 */
function combinar(regra, decisao, { limite = LIMITE_PADRAO, modelo = 'modelo de decisão' } = {}) {
  const base = { ...regra, fonte: 'regra', tipoDaRegra: regra.tipo };
  if (!decisao || !decisao.valor || !(decisao.valor in ROTA_PARA_TIPO)) return base;
  const comDecisao = { ...base, decisor: { modelo, valor: decisao.valor, confianca: decisao.confianca } };
  if (regra.tipo === 'local' || regra.tipo === 'site') return comDecisao;
  if (decisao.valor === 'site') return comDecisao;
  if (typeof decisao.confianca !== 'number' || decisao.confianca < limite) return comDecisao;
  const tipo = ROTA_PARA_TIPO[decisao.valor];
  if (tipo === regra.tipo) return { ...comDecisao, fonte: 'regra+decisor' };
  return {
    ...comDecisao,
    tipo,
    fonte: 'decisor',
    motivo: `${modelo} (confiança ${decisao.confianca.toFixed(2)}); a regra dizia "${regra.tipo}"`,
  };
}

/**
 * Decide a rota do pedido. `decidir` é a chamada ao Ollama (injetada para a
 * bancada poder usar um decisor falso): `({ model, state, questions, timeout, signal }) → answers`.
 */
async function decidirRota(objetivo, { config = {}, decidir, signal } = {}) {
  const regra = tipoDoPedido(objetivo);
  const modelo = String(config.modeloDecisor || '').trim();
  if (!config.roteadorDecisor || !modelo || typeof decidir !== 'function') return { ...regra, fonte: 'regra', tipoDaRegra: regra.tipo };
  // regra exata: nem vale gastar a chamada
  if (regra.tipo === 'local' || regra.tipo === 'site') return { ...regra, fonte: 'regra', tipoDaRegra: regra.tipo };
  const inicio = Date.now();
  try {
    const respostas = await decidir({
      model: modelo,
      state: estado(objetivo),
      questions: { rota: PERGUNTA_ROTA },
      timeout: Number(config.tempoLimiteDecisorMs) || TEMPO_LIMITE_PADRAO_MS,
      signal,
    });
    const limite = typeof config.limiarDecisor === 'number' ? config.limiarDecisor : LIMITE_PADRAO;
    const decisao = lerRota(respostas);
    // 200 sem a decisão (modelo que não é de decisão, endpoint de outro
    // servidor): mesma coisa que erro — a regra decide e o motivo fica
    if (!decisao) return { ...regra, fonte: 'regra', tipoDaRegra: regra.tipo, falhaDoDecisor: 'resposta sem a decisão de rota', ms: Date.now() - inicio };
    return { ...combinar(regra, decisao, { limite, modelo }), ms: Date.now() - inicio };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { ...regra, fonte: 'regra', tipoDaRegra: regra.tipo, falhaDoDecisor: String(err?.message || err).slice(0, 200), ms: Date.now() - inicio };
  }
}

module.exports = { decidirRota, combinar, lerRota, ROTA_PARA_TIPO, PERGUNTA_ROTA, LIMITE_PADRAO };
