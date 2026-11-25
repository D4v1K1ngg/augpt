'use strict';

/**
 * Um Tev1 só, escolhido pela placa (24/11, Davi: "em pcs mais fracos como ficaria o uso de tantos modelos de IA?").
 *
 * O Ollama segura 3 modelos (OLLAMA_MAX_LOADED_MODELS, o padrão é 3). Com o tipo de fonte (src/agent/tipo-de-fonte.js)
 * eram 4 — o principal, o embedding, o Tev1 0.8B do roteador (na CPU) e o Tev1 4B novo —, e o Ollama recarregava um ou
 * outro a cada 5–30 s. Agora o roteador e o tipo de fonte usam o MESMO Tev1.
 *
 * 25/11 (Davi: "se eu rodar um modelo mais pesado na gpu o tev1 4B não vai caber… verificar quanto de vram ainda tem"):
 * a escolha olha a memória LIVRE da placa, não o total. Medido no PC do Davi com o 9B e o embedding carregados: 16 GB de
 * placa, 4,5 GB livres (o Windows e os programas abertos usam ~2 GB). A ordem:
 *
 *   placa ≥ 14 GB e cabe o 4B (4,2 GB + folga) → Tev1 4B na placa (tipo de fonte 84%, 0,15 s por página)
 *   cabe o 0.8B (0,8 GB + folga)              → Tev1 0.8B na placa (66%, 0,07 s)
 *   não cabe, sem placa ou o principal pelo llama.cpp (o Inkling ocupa a placa inteira)
 *                                             → Tev1 0.8B na CPU (1,2 s por página; não disputa a placa). Se só o
 *                                               tev1:0.8b estiver instalado, o AuGPT cria a cópia "tev1-0.8b-cpu"
 *                                               (o mesmo arquivo, com num_gpu 0: nada a baixar)
 *   nenhum Tev1 instalado                     → as regras (a pesquisa funciona, com fontes piores)
 *
 * O Tev1 que já está inteiro na placa continua. "Livre" = o que a placa tem livre agora + o que um Tev1 carregado ocupa −
 * o principal, se ele ainda não foi carregado (1ª pergunta). Sem nvidia-smi (AMD, Intel), a conta é pelo /api/ps: o total menos os modelos
 * carregados.
 *
 * Os Ajustes mandam: "modeloTipoDeFonte" com um nome fixa o modelo; "" desliga; "auto" (o padrão) é esta escolha. O
 * roteador só é trocado quando os Ajustes usam um Tev1 nele (quem escolheu outro decisor continua com o seu).
 */

const { detectarGpus, memoriaLivreDaPlaca } = require('../verificador-de-hardware');

const GRANDE = ['tev1:latest', 'tev1'];
const PEQUENO = ['tev1:0.8b', 'tev1-0.8b', 'tev1-0.8b:latest'];
const NA_CPU = ['tev1-0.8b-cpu', 'tev1-0.8b-cpu:latest'];
const PLACA_PARA_O_4B = 14;
// o que cada um ocupa na placa carregado (GiB) + a folga para o contexto e o que o Windows mexe
// (medido 25/11: com o 9B, o embedding e o 4B carregados, a placa de 16 GB ficou com 47 MB livres — o 4B coube, no limite)
const PRECISA_4B = 4.35 + 0.3;
const PRECISA_08B = 0.8 + 0.3;
const GIB = 2 ** 30;

let vramCache = null;
async function vramDaPlaca() {
  if (vramCache === null) vramCache = (await detectarGpus().catch(() => [])).reduce((m, g) => Math.max(m, Number(g.vramGB) || 0), 0);
  return vramCache;
}

const instalado = (instalados, nomes) => nomes.find((n) => instalados.some((i) => i === n || i === `${n}:latest` || `${i}:latest` === n)) || '';
const ehTev1 = (nome) => /^tev1/i.test(String(nome || ''));

/**
 * O Tev1 que cabe agora, entre os instalados. Puro, para a bancada. `livreGB` undefined = não medido (vale o total).
 * Devolve { nome, naCpu, criarCpu } — `criarCpu`: falta a cópia "tev1-0.8b-cpu" (feita do tev1:0.8b); nome '' = regras.
 */
function escolherTev1({ vramGB = 0, livreGB, instalados = [], principalNoLlamaCpp = false, naPlaca = '' } = {}) {
  const livre = livreGB === undefined || livreGB === null ? vramGB : livreGB;
  const grande = instalado(instalados, GRANDE);
  const pequeno = instalado(instalados, PEQUENO);
  if (!principalNoLlamaCpp && vramGB > 0) {
    // o que já está inteiro na placa fica (ele cabe; medir de novo trocaria de modelo a cada pergunta)
    if (naPlaca && [grande, pequeno].includes(naPlaca)) return { nome: naPlaca, naCpu: false, criarCpu: false };
    if (grande && vramGB >= PLACA_PARA_O_4B && livre >= PRECISA_4B) return { nome: grande, naCpu: false, criarCpu: false };
    if (pequeno && livre >= PRECISA_08B) return { nome: pequeno, naCpu: false, criarCpu: false };
  }
  const cpu = instalado(instalados, NA_CPU);
  if (cpu) return { nome: cpu, naCpu: true, criarCpu: false };
  if (pequeno) return { nome: NA_CPU[0], naCpu: true, criarCpu: true };
  return { nome: '', naCpu: false, criarCpu: false };
}

/**
 * Quanto da placa está livre para o Tev1 (GiB) ou undefined (não deu para medir). `carregados` = /api/ps,
 * `principal` = { nome, tamanho (bytes no disco) } do modelo que vai responder.
 */
function livreParaOTev1({ vramGB, livreNaPlaca, carregados = [], principal = null }) {
  const tev1Carregado = carregados.filter((m) => ehTev1(m.name)).reduce((s, m) => s + (m.sizeVram || 0), 0) / GIB;
  const principalFalta = principal?.nome && !carregados.some((m) => m.name === principal.nome) ? ((principal.tamanho || 0) * 1.2) / GIB : 0;
  if (typeof livreNaPlaca === 'number') return livreNaPlaca + tev1Carregado - principalFalta;
  if (!vramGB || !carregados.length && !principalFalta) return undefined;
  const outros = carregados.filter((m) => !ehTev1(m.name)).reduce((s, m) => s + (m.sizeVram || 0), 0) / GIB;
  return vramGB - outros - principalFalta;
}

// a cópia na CPU é criada uma vez por sessão do app (o Ollama guarda; da próxima, ela já está na lista)
let criando = null;

/**
 * O modelo do tipo de fonte e o config do roteador para esta pergunta.
 * `listar` devolve os modelos instalados (nomes ou { name, size }); `carregados` devolve o /api/ps; `criarCpu(nome, de)`
 * cria a cópia na CPU; `principal` é o nome do modelo que vai responder.
 * Devolve { tipos: nome | '', roteador: { modeloDecisor, modeloDecisorRapido } | null (fica como está), naCpu }.
 */
async function tev1DaPlaca({ config = {}, listar, carregados, criarCpu, principal, principalNoLlamaCpp = false, vramGB, livreNaPlaca } = {}) {
  const pedido = config.modeloTipoDeFonte === undefined || config.modeloTipoDeFonte === null ? 'auto' : String(config.modeloTipoDeFonte).trim();
  if (pedido !== 'auto') return { tipos: principalNoLlamaCpp ? '' : pedido, roteador: null, naCpu: /cpu/i.test(pedido) };
  const lista = typeof listar === 'function' ? await listar().catch(() => []) : [];
  const instalados = lista.map((m) => (typeof m === 'string' ? m : m.name));
  const vram = vramGB ?? (await vramDaPlaca());
  const ps = typeof carregados === 'function' ? await carregados().catch(() => []) : [];
  const doPrincipal = lista.find((m) => typeof m === 'object' && m.name === principal);
  const livre = principalNoLlamaCpp ? undefined : livreParaOTev1({ vramGB: vram, livreNaPlaca: livreNaPlaca ?? (await memoriaLivreDaPlaca().catch(() => null)), carregados: ps, principal: doPrincipal ? { nome: doPrincipal.name, tamanho: doPrincipal.size } : null });
  const naPlaca = ps.find((m) => ehTev1(m.name) && m.sizeVram > 0 && m.sizeVram >= m.size * 0.95)?.name || '';
  const e = escolherTev1({ vramGB: vram, livreGB: livre, instalados, principalNoLlamaCpp, naPlaca: instalado(instalados, [naPlaca]) });
  if (e.criarCpu) {
    const ok = typeof criarCpu === 'function' && (await (criando ||= criarCpu(e.nome, instalado(instalados, PEQUENO)).then(() => true, () => ((criando = null), false))));
    if (!ok) return { tipos: '', roteador: null, naCpu: false };
  }
  const roteadorEhTev1 = ehTev1(config.modeloDecisor || 'tev1');
  return { tipos: e.nome, roteador: e.nome && roteadorEhTev1 ? { modeloDecisor: e.nome, modeloDecisorRapido: '' } : null, naCpu: e.naCpu };
}

/** As dependências do Ollama para `tev1DaPlaca` (as 3 chamadas do app). */
function doOllama(ollama, host) {
  return {
    listar: () => ollama.listModels(host),
    carregados: () => ollama.psModels(host),
    criarCpu: (nome, de) => ollama.criarVariante(host, nome, de, { num_gpu: 0 }),
  };
}

module.exports = { escolherTev1, tev1DaPlaca, livreParaOTev1, doOllama, PLACA_PARA_O_4B, PRECISA_4B, PRECISA_08B };
