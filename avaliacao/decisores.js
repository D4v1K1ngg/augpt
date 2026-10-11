#!/usr/bin/env node
'use strict';

/**
 * Comparação de "decisores" (2026-10-08, conversa sobre o Jev): os modelos de
 * decisão do Ollama (Tev1, Nimble…, endpoint /v1/systemone, Ollama ≥ 0.35)
 * contra as regras de código que o AuGPT usa hoje, nos SEUS pedidos reais.
 *
 *   node avaliacao/decisores.js                         regras + tev1:0.8b + tev1
 *   node avaliacao/decisores.js --modelos=tev1:0.8b     só um modelo
 *   node avaliacao/decisores.js --qwen=qwen2.5:7b       inclui o Qwen como classificador (JSON)
 *   node avaliacao/decisores.js --limite=40             só os primeiros 40 pedidos
 *   node avaliacao/decisores.js --host=http://127.0.0.1:11434
 *   node avaliacao/decisores.js --amostra=60                60 pedidos misturando todos os tipos
 *   node avaliacao/decisores.js --manter=qwen2.5:7b          mantém o Qwen carregado antes de cada
 *        decisão, como no AuGPT de verdade (mede o custo de trocar de modelo na placa)
 *
 * Mede quatro decisões por pedido:
 *   rota            produto · guia · explicacao · site · tarefa (o resto: preço, notícia, arquivo, questões…)
 *   precisa_web     precisa de informação atual/específica da internet?
 *   produto_nomeado o pedido cita um modelo de produto específico?
 *   continuacao     a mensagem só faz sentido junto da anterior ("e quanto ao…", "tente novamente")
 *
 * Os rótulos (avaliacao/decisores/pedidos-reais.json) foram marcados à mão a
 * partir dos registros de execução, com login/senha mascarados. Esse arquivo
 * e os resultados NÃO vão pro GitHub (avaliacao/decisores/.gitignore).
 *
 * Não muda nada no AuGPT: só mede. O resultado vai pra
 * avaliacao/decisores/resultado-<data>.json.
 */

const fs = require('fs');
const path = require('path');
const { tipoDoPedido, produtosNomeados } = require('../src/agent/tipo-de-pedido');
const { produtosDoPedido } = require('../src/agent/serie-de-precos');
const { referenciaGenerica } = require('../src/agent/assunto-da-conversa');
const { modoDaPesquisa } = require('../src/agent/motor-pesquisa');

const PASTA = path.join(__dirname, 'decisores');
const ROTAS = ['produto', 'guia', 'explicacao', 'site', 'tarefa'];

// Perguntas em inglês: a Together AI diz que só testou o Tev1 em inglês. O
// pedido (state) continua em português — é justamente isso que se mede.
const PERGUNTAS = {
  rota: {
    type: 'choice',
    instructions: 'The state is a message (in Portuguese) sent by a user to an AI assistant. Which kind of request is it?',
    criteria: {
      produto: 'Choose, compare, evaluate or get a recommendation about products to buy (best headphones for a game, A vs B, is product X good for Y, tell me about product X)',
      guia: 'How to get better at something: practical tips, tactics, strategy, training, step-by-step tutorial',
      explicacao: 'Explain a concept, how something works, why something happens, a story, history or biography',
      site: 'Act on a specific website: log in, click buttons, fill a form, download something from the page',
      tarefa: 'Anything else: prices or price history, news and game updates, weather, exam questions to solve, create or read files and documents, opinions, analysis, follow-up requests',
    },
  },
  precisa_web: {
    type: 'noul',
    instructions: 'Does answering this message require up-to-date or very specific information from the internet that a small offline language model would not reliably know?',
  },
  produto_nomeado: {
    type: 'noul',
    instructions: "Does the message name a specific product model (brand and/or model name, e.g. 'RTX 5080', 'Simgot EM6L', 'Bose QC 20')? A product category alone ('headphones') does not count.",
  },
  continuacao: {
    type: 'noul',
    instructions: "Does this message only make sense together with an earlier message in the conversation (it refers to 'that', 'this update', 'the questions above', 'try again', 'your answer' without saying what)?",
  },
};

/* ------------------------------ as regras de hoje ------------------------------ */

/**
 * A rota que o AuGPT SEGUE hoje (não só o rótulo do tipo): "produto" sem modo
 * de pesquisa (preço, por exemplo) cai no laço normal, igual a "tarefa".
 */
function rotaDaRegra(pedido) {
  const t = tipoDoPedido(pedido).tipo;
  if (t === 'site' || t === 'explicacao') return t;
  const modo = modoDaPesquisa(pedido);
  if (modo === 'guia') return 'guia';
  if (modo) return 'produto'; // recomendação, desempenho, uso profissional
  return 'tarefa';
}

function decidirPorRegras(pedido) {
  return {
    rota: { valor: rotaDaRegra(pedido) },
    // o AuGPT pesquisa sempre: a regra de hoje equivale a "sim" pra tudo
    precisa_web: { valor: true },
    produto_nomeado: { valor: produtosNomeados(pedido).length > 0 || produtosDoPedido(pedido).length > 0 },
    continuacao: { valor: referenciaGenerica(pedido) !== null },
  };
}

/* ------------------------------ Ollama ------------------------------ */

function compararVersao(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function http(url, corpo, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: corpo ? 'POST' : 'GET',
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
    const texto = await r.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* corpo não-JSON */
    }
    if (!r.ok) throw new Error(`${r.status}: ${json?.error || texto.slice(0, 200)}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const estado = (pedido) => `Mensagem do usuário para um assistente de IA:\n"${String(pedido).slice(0, 1500)}"`;

/** Uma chamada ao /v1/systemone com as quatro perguntas. */
async function decidirPorModeloDeDecisao(host, modelo, pedido) {
  const r = await http(`${host}/v1/systemone`, { model: modelo, state: estado(pedido), questions: PERGUNTAS, keep_alive: '10m' });
  const a = r?.answers || {};
  const noul = (x) => {
    const p = typeof x?.noul === 'number' ? x.noul : null;
    return p === null ? { valor: null } : { valor: p >= 0.5, prob: p, confianca: Math.abs(p - 0.5) * 2 };
  };
  return {
    rota: { valor: a.rota?.choice ?? null, prob: a.rota?.probabilities?.[a.rota?.choice] ?? null, confianca: a.rota?.confidence ?? null, probabilidades: a.rota?.probabilities || null },
    precisa_web: noul(a.precisa_web),
    produto_nomeado: noul(a.produto_nomeado),
    continuacao: noul(a.continuacao),
  };
}

/** O Qwen como classificador (o que o AuGPT faria sem modelo de decisão): JSON com enum. */
async function decidirPorQwen(host, modelo, pedido) {
  const esquema = {
    type: 'object',
    properties: {
      rota: { type: 'string', enum: ROTAS },
      precisa_web: { type: 'boolean' },
      produto_nomeado: { type: 'boolean' },
      continuacao: { type: 'boolean' },
    },
    required: ['rota', 'precisa_web', 'produto_nomeado', 'continuacao'],
  };
  const descricao = Object.entries(PERGUNTAS.rota.criteria).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const prompt = `${estado(pedido)}\n\nClassifique a mensagem:\nrota (uma de):\n${descricao}\nprecisa_web: ${PERGUNTAS.precisa_web.instructions}\nproduto_nomeado: ${PERGUNTAS.produto_nomeado.instructions}\ncontinuacao: ${PERGUNTAS.continuacao.instructions}\nResponda só o JSON.`;
  const r = await http(`${host}/api/chat`, {
    model: modelo,
    messages: [{ role: 'user', content: prompt }],
    format: esquema,
    stream: false,
    options: { temperature: 0, num_predict: 80, num_ctx: 4096 },
    keep_alive: '10m',
  });
  let j = {};
  try {
    j = JSON.parse(r?.message?.content || '{}');
  } catch {
    /* resposta quebrada conta como erro */
  }
  return {
    rota: { valor: ROTAS.includes(j.rota) ? j.rota : null },
    precisa_web: { valor: typeof j.precisa_web === 'boolean' ? j.precisa_web : null },
    produto_nomeado: { valor: typeof j.produto_nomeado === 'boolean' ? j.produto_nomeado : null },
    continuacao: { valor: typeof j.continuacao === 'boolean' ? j.continuacao : null },
  };
}

/* ------------------------------ métricas ------------------------------ */

const DECISOES = ['rota', 'precisa_web', 'produto_nomeado', 'continuacao'];

/**
 * Acerto por decisão, matriz da rota, latência e "acerto quando confiante"
 * (confiança ≥ limiar: quanto dos pedidos o decisor cobre e quanto acerta
 * nesses — o jeito de usar um decisor fraco só onde ele é bom).
 */
function avaliar(linhas, { limiar = 0.6 } = {}) {
  const r = { total: linhas.length, decisoes: {}, matrizRota: {}, latencia: null, erros: linhas.filter((l) => l.erro).length };
  for (const d of DECISOES) {
    const validas = linhas.filter((l) => !l.erro && l.decisao?.[d]);
    const acertos = validas.filter((l) => l.decisao[d].valor === l.esperado[d]).length;
    const comConfianca = validas.filter((l) => typeof l.decisao[d].confianca === 'number');
    const confiantes = comConfianca.filter((l) => l.decisao[d].confianca >= limiar);
    r.decisoes[d] = {
      acerto: validas.length ? acertos / validas.length : null,
      n: validas.length,
      ...(comConfianca.length
        ? {
            cobertura: confiantes.length / comConfianca.length,
            acertoConfiante: confiantes.length ? confiantes.filter((l) => l.decisao[d].valor === l.esperado[d]).length / confiantes.length : null,
          }
        : {}),
    };
  }
  for (const l of linhas) {
    if (l.erro || !l.decisao?.rota) continue;
    const e = l.esperado.rota;
    const o = l.decisao.rota.valor ?? 'nulo';
    ((r.matrizRota[e] ||= {})[o] = (r.matrizRota[e][o] || 0) + 1);
  }
  const ms = linhas.filter((l) => typeof l.ms === 'number' && !l.aquecimento).map((l) => l.ms).sort((a, b) => a - b);
  if (ms.length) r.latencia = { mediana: ms[Math.floor(ms.length / 2)], p95: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] };
  return r;
}

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);

function tabela(resultados) {
  const nomes = Object.keys(resultados);
  const linhas = [];
  const larg = Math.max(14, ...nomes.map((n) => n.length));
  linhas.push(`${'decisor'.padEnd(larg)}  ${DECISOES.map((d) => d.padStart(16)).join('')}  ${'mediana'.padStart(9)}  ${'p95'.padStart(7)}`);
  for (const n of nomes) {
    const m = resultados[n];
    linhas.push(
      `${n.padEnd(larg)}  ${DECISOES.map((d) => pct(m.decisoes[d]?.acerto).padStart(16)).join('')}  ${(m.latencia ? `${m.latencia.mediana} ms` : '—').padStart(9)}  ${(m.latencia ? `${m.latencia.p95}` : '—').padStart(7)}`
    );
    const conf = DECISOES.filter((d) => m.decisoes[d]?.cobertura !== undefined)
      .map((d) => `${d}: cobre ${pct(m.decisoes[d].cobertura)}, acerta ${pct(m.decisoes[d].acertoConfiante)}`)
      .join(' · ');
    if (conf) linhas.push(`${' '.repeat(larg)}  confiança ≥ 0,6 → ${conf}`);
    if (m.erros) linhas.push(`${' '.repeat(larg)}  ${m.erros} pedido(s) com erro`);
  }
  return linhas.join('\n');
}

/* ------------------------------ execução ------------------------------ */

function carregarPedidos(arquivos) {
  const lista = [];
  for (const a of arquivos) if (fs.existsSync(a)) lista.push(...JSON.parse(fs.readFileSync(a, 'utf8')));
  return lista;
}

/** N pedidos espalhados entre os tipos (os primeiros da lista são todos do patch 43.1). */
function amostrar(lista, n) {
  const porRota = {};
  for (const p of lista) (porRota[p.esperado?.rota] ||= []).push(p);
  // de cada tipo, itens espaçados ao longo da lista (não só os primeiros)
  const filas = Object.values(porRota).map((g) => {
    const passo = Math.max(1, Math.floor(g.length / Math.ceil(n / Object.keys(porRota).length)));
    const ordem = [];
    for (let k = 0; k < passo; k++) for (let i = k; i < g.length; i += passo) ordem.push(g[i]);
    return ordem;
  });
  const saida = [];
  for (let i = 0; saida.length < Math.min(n, lista.length); i++) for (const f of filas) if (i < f.length && saida.length < n) saida.push(f[i]);
  return saida;
}

/** Decisor confiante decide a rota; abaixo do limiar, vale a regra (o que o AuGPT faria). */
function combinarComRegras(linhasModelo, linhasRegras, limiar = 0.6) {
  const regra = new Map(linhasRegras.map((l) => [String(l.id), l]));
  return linhasModelo.map((l) => {
    const r = regra.get(String(l.id));
    if (l.erro || !r) return { ...l };
    const usaModelo = typeof l.decisao.rota.confianca === 'number' && l.decisao.rota.confianca >= limiar;
    return { ...l, decisao: { ...r.decisao, rota: { valor: usaModelo ? l.decisao.rota.valor : r.decisao.rota.valor, origem: usaModelo ? 'modelo' : 'regra' } } };
  });
}

async function executar({ host = 'http://127.0.0.1:11434', modelos = ['tev1:0.8b', 'tev1'], qwen = null, limite = null, amostra = null, manter = null, pedidos = null, log = console.log, limiar = 0.6 } = {}) {
  host = String(host).replace(/\/+$/, '');
  let lista = pedidos || carregarPedidos([path.join(PASTA, 'pedidos-reais.json'), path.join(PASTA, 'pedidos-extras.json')]);
  if (amostra) lista = amostrar(lista, Number(amostra));
  if (limite) lista = lista.slice(0, Number(limite));
  if (!lista.length) throw new Error('nenhum pedido rotulado em avaliacao/decisores/');

  const resultados = {};
  const detalhes = {};
  // 1) regras (instantâneo)
  detalhes.regras = lista.map((p) => ({ id: p.id, esperado: p.esperado, decisao: decidirPorRegras(p.pedido), ms: 0 }));
  resultados.regras = avaliar(detalhes.regras, { limiar });

  // 2) modelos de decisão
  if (modelos.length) {
    let versao = null;
    try {
      versao = (await http(`${host}/api/version`, null, 5000))?.version;
    } catch (err) {
      throw new Error(`não consegui falar com o Ollama em ${host} (${err.message})`);
    }
    if (compararVersao(versao, '0.35.0') < 0) {
      log(`Ollama ${versao}: o /v1/systemone precisa da 0.35 ou mais nova. Atualize o Ollama e rode de novo (os modelos de decisão foram pulados).`);
      modelos = [];
    }
  }
  const rodar = async (nome, decidir) => {
    const linhas = [];
    log(`\n${nome}: ${lista.length} pedidos…`);
    for (let i = 0; i < lista.length; i++) {
      const p = lista[i];
      // como no AuGPT: o modelo principal acabou de ser usado (fora do tempo medido)
      if (manter) {
        try {
          await http(`${host}/api/generate`, { model: manter, prompt: '', keep_alive: '30m' }, 120000);
        } catch (err) {
          if (i === 0) log(`  não consegui carregar ${manter}: ${err.message}`);
        }
      }
      const t0 = Date.now();
      try {
        const decisao = await decidir(p.pedido);
        linhas.push({ id: p.id, esperado: p.esperado, decisao, ms: Date.now() - t0, aquecimento: i === 0 });
      } catch (err) {
        linhas.push({ id: p.id, esperado: p.esperado, erro: err.message, ms: Date.now() - t0, aquecimento: i === 0 });
        if (i === 0) {
          log(`  ${nome}: ${err.message} — pulando este decisor (baixou com "ollama pull ${nome}"?)`);
          return null;
        }
      }
      if ((i + 1) % 25 === 0) log(`  ${i + 1}/${lista.length}`);
    }
    detalhes[nome] = linhas;
    resultados[nome] = avaliar(linhas, { limiar });
    // onde o modelo ficou carregado (GPU, CPU ou dividido)
    try {
      const ps = await http(`${host}/api/ps`, null, 5000);
      const carregados = (ps?.models || []).map((x) => `${x.name}: ${(x.size / 2 ** 30).toFixed(1)} GB, ${x.size ? Math.round((100 * (x.size_vram || 0)) / x.size) : 0}% na GPU`);
      if (carregados.length) {
        log(`  carregados agora → ${carregados.join(' · ')}`);
        resultados[nome].carregados = carregados;
      }
    } catch {
      /* /api/ps é só informativo */
    }
    return resultados[nome];
  };
  for (const m of modelos) {
    const r = await rodar(m, (p) => decidirPorModeloDeDecisao(host, m, p));
    if (r) {
      // a combinação que entraria no AuGPT: modelo confiante decide a rota, senão a regra
      detalhes[`${m}+regras`] = combinarComRegras(detalhes[m], detalhes.regras, limiar);
      resultados[`${m}+regras`] = avaliar(detalhes[`${m}+regras`], { limiar });
      resultados[`${m}+regras`].latencia = resultados[m].latencia;
    }
  }
  if (qwen) await rodar(`${qwen} (JSON)`, (p) => decidirPorQwen(host, qwen, p));

  return { resultados, detalhes, pedidos: lista.length };
}

async function principal() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const host = args.host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const modelos = args.modelos === undefined ? ['tev1:0.8b', 'tev1'] : String(args.modelos).split(',').map((m) => m.trim()).filter(Boolean);
  const { resultados, detalhes, pedidos } = await executar({
    host: /^https?:/.test(host) ? host : `http://${host}`,
    modelos,
    qwen: args.qwen === true ? 'qwen2.5:7b' : args.qwen || null,
    limite: args.limite || null,
    amostra: args.amostra || null,
    manter: args.manter === true ? 'qwen2.5:7b' : args.manter || null,
  });
  console.log(`\nDecisores · ${pedidos} pedidos rotulados\n`);
  console.log(tabela(resultados));
  const rotulo = (d) => `${d}`.padEnd(11);
  for (const [nome, m] of Object.entries(resultados)) {
    console.log(`\nrota — ${nome} (linha = esperado, coluna = escolhido)`);
    const cols = [...ROTAS, 'nulo'];
    console.log(`${rotulo('')} ${cols.map((c) => c.slice(0, 8).padStart(9)).join('')}`);
    for (const e of ROTAS) console.log(`${rotulo(e)} ${cols.map((c) => String(m.matrizRota[e]?.[c] || 0).padStart(9)).join('')}`);
  }
  const saida = path.join(PASTA, `resultado-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(saida, JSON.stringify({ em: new Date().toISOString(), resultados, detalhes }, null, 1));
  console.log(`\nDetalhe por pedido: ${path.relative(process.cwd(), saida)}`);
}

if (require.main === module) {
  principal().catch((err) => {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { PERGUNTAS, ROTAS, decidirPorRegras, decidirPorModeloDeDecisao, decidirPorQwen, avaliar, amostrar, combinarComRegras, compararVersao, executar, tabela };
