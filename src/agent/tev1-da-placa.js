'use strict';

/**
 * Um Tev1 só, escolhido pela placa (24/11, Davi: "em pcs mais fracos como ficaria o uso de tantos modelos de IA?").
 *
 * O Ollama do Davi segura 3 modelos (OLLAMA_MAX_LOADED_MODELS=3). Com o tipo de fonte (src/agent/tipo-de-fonte.js) eram
 * 4 — o principal, o embedding, o Tev1 0.8B do roteador (na CPU) e o Tev1 4B novo —, e o Ollama recarregava um ou outro a
 * cada 5–30 s (no server.log, 30 cargas em 12 minutos): 4 a 6 s a mais por pergunta, e uma ficou "pelas regras" porque o
 * Tev1 estava recarregando. Agora o roteador e o tipo de fonte usam o MESMO Tev1, e ele depende da placa:
 *
 *   placa ≥ 14 GB  → Tev1 4B na placa (tipo de fonte 84%, 0,15 s por página; 9B + 4B + embedding ≈ 14,2 GB)
 *   placa ≥ 7,5 GB → Tev1 0.8B na placa (66%, 0,07 s; 0,8 GB)
 *   menos ou sem placa, ou o principal pelo llama.cpp (o Inkling ocupa a placa inteira) → o roteador fica como estava
 *     (o 0.8B na CPU, que não disputa a placa) e o tipo de fonte vai pelas regras: nenhum modelo a mais.
 *
 * Os Ajustes mandam: "modeloTipoDeFonte" com um nome fixa o modelo; "" desliga; "auto" (o padrão) é esta escolha. O
 * roteador só é trocado quando os Ajustes usam um Tev1 nele (quem escolheu outro decisor continua com o seu).
 */

const { detectarGpus } = require('../verificador-de-hardware');

const GRANDE = ['tev1:latest', 'tev1'];
const PEQUENO = ['tev1:0.8b', 'tev1-0.8b', 'tev1-0.8b:latest'];
const PLACA_PARA_O_4B = 14;
const PLACA_PARA_O_08B = 7.5;

let vramCache = null;
async function vramDaPlaca() {
  if (vramCache === null) vramCache = (await detectarGpus().catch(() => [])).reduce((m, g) => Math.max(m, Number(g.vramGB) || 0), 0);
  return vramCache;
}

const instalado = (instalados, nomes) => nomes.find((n) => instalados.some((i) => i === n || i === `${n}:latest` || `${i}:latest` === n)) || '';

/** O Tev1 da faixa da placa entre os instalados ('' = nenhum: regras). Puro, para a bancada. */
function escolherTev1({ vramGB = 0, instalados = [], principalNoLlamaCpp = false } = {}) {
  if (principalNoLlamaCpp) return '';
  if (vramGB >= PLACA_PARA_O_4B) return instalado(instalados, GRANDE) || instalado(instalados, PEQUENO);
  if (vramGB >= PLACA_PARA_O_08B) return instalado(instalados, PEQUENO);
  return '';
}

/**
 * O modelo do tipo de fonte e o config do roteador para esta pergunta. `listar` devolve os nomes instalados no Ollama.
 * Devolve { tipos: nome | '', roteador: { modeloDecisor, modeloDecisorRapido } | null (fica como está) }.
 */
async function tev1DaPlaca({ config = {}, listar, principalNoLlamaCpp = false, vramGB } = {}) {
  const pedido = config.modeloTipoDeFonte === undefined || config.modeloTipoDeFonte === null ? 'auto' : String(config.modeloTipoDeFonte).trim();
  if (pedido !== 'auto') return { tipos: principalNoLlamaCpp ? '' : pedido, roteador: null };
  const instalados = typeof listar === 'function' ? await listar().catch(() => []) : [];
  const escolhido = escolherTev1({ vramGB: vramGB ?? (await vramDaPlaca()), instalados, principalNoLlamaCpp });
  const roteadorEhTev1 = /^tev1/i.test(String(config.modeloDecisor || 'tev1'));
  return { tipos: escolhido, roteador: escolhido && roteadorEhTev1 ? { modeloDecisor: escolhido, modeloDecisorRapido: '' } : null };
}

module.exports = { escolherTev1, tev1DaPlaca, PLACA_PARA_O_4B, PLACA_PARA_O_08B };
