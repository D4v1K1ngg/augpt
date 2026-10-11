#!/usr/bin/env node
'use strict';

/**
 * Medição de qualidade por fora do agente.
 *
 *   npm run qualidade                          todas as perguntas
 *   npm run qualidade -- --so=explicacao       só um tipo (explicacao, fato, produto, guia)
 *   npm run qualidade -- --id=gerador,lua      só estas
 *   npm run qualidade -- --n=5                 só as 5 primeiras
 *   npm run qualidade -- --juiz=qwen2.5:14b    modelo que dá a nota
 *   npm run qualidade -- --modelo=qwen2.5:7b   modelo do agente (padrão: o dos Ajustes)
 *   npm run qualidade -- --searxng=http://127.0.0.1:8888
 *
 * A bancada (`npm run avaliar`) testa o que está em volta do modelo, com
 * roteiro fixo. Esta aqui mede o que o usuário recebe: roda o agente DE
 * VERDADE (Ollama, internet e os seus Ajustes) num conjunto fixo de perguntas
 * e um modelo-juiz corrige cada resposta contra um gabarito
 * (qualidade/perguntas.js). Sai uma nota de 0 a 10 por pergunta, o tempo e a
 * saúde da busca, gravados em qualidade/resultados/ e comparados com a
 * rodada anterior — é o que diz se uma mudança melhorou ou piorou.
 *
 * Duas escolhas que sustentam a nota:
 *   - o juiz não avalia "de cabeça": ele só marca, item por item do
 *     gabarito, presente / ausente / contradito. Quem faz a conta é o código;
 *   - antes da rodada o juiz é CALIBRADO: recebe respostas erradas de
 *     propósito e o próprio gabarito. Se não der nota baixa às primeiras e
 *     alta ao segundo, a rodada para — nota de juiz que não distingue as duas
 *     não vale nada.
 *
 * Primeiro o agente responde tudo, depois o juiz corrige tudo: os dois
 * modelos não ficam se revezando na placa de vídeo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const ollama = require('../src/llm/ollama');
const { DEFAULTS } = require('../src/config');
const { RuntimeSearXNG } = require('../src/searxng-runtime');
const { executarCasoAgente, RAIZ } = require('./motor');
const PERGUNTAS = require('./qualidade/perguntas');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, valor] = a.replace(/^--/, '').split('=');
    return [chave, valor ?? true];
  })
);

const DIR_RESULTADOS = path.join(__dirname, 'qualidade', 'resultados');
const DADOS_DO_APP = path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming/AuGPT' : '.config/AuGPT');
const HOST = args.host || 'http://127.0.0.1:11434';
// nunca numa medição: o agente roda sem ninguém pra aprovar
const FERRAMENTAS_FORA = ['executar_comando', 'executar_codigo', 'apagar_arquivo'];

const COR = process.stdout.isTTY;
const c = (codigo, texto) => (COR ? `\u001b[${codigo}m${texto}\u001b[0m` : texto);
const verde = (t) => c(32, t);
const vermelho = (t) => c(31, t);
const amarelo = (t) => c(33, t);
const cinza = (t) => c(90, t);
const corDaNota = (n) => (n === null ? cinza('  — ') : (n >= 7 ? verde : n >= 4 ? amarelo : vermelho)(n.toFixed(1).padStart(4)));
const mediana = (l) => {
  const s = [...l].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const media = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);

/* ------------------------------ juiz ------------------------------ */

function notaDe(pergunta, veredito) {
  const itens = (pergunta.fatos || []).length + (pergunta.criterios || []).length;
  const presentes = veredito.fatos.filter((v) => v === 'presente').length;
  const contraditos = veredito.fatos.filter((v) => v === 'contradito').length;
  const cumpridos = veredito.criterios.filter(Boolean).length;
  // contradizer o gabarito pesa mais do que deixar de dizer
  const nota = (10 * (presentes + cumpridos)) / itens - 3 * contraditos;
  return Math.round(Math.max(0, Math.min(10, nota)) * 10) / 10;
}

function lerVeredito(texto, pergunta) {
  const d = JSON.parse(texto);
  const nFatos = (pergunta.fatos || []).length;
  const nCriterios = (pergunta.criterios || []).length;
  const fatos = (d.fatos || []).map((f) => {
    const v = String(f?.veredito ?? f).toLowerCase();
    return /contrad/.test(v) ? 'contradito' : /presente/.test(v) ? 'presente' : 'ausente';
  });
  const criterios = (d.criterios || []).map((k) => {
    const v = k?.cumprido ?? k;
    return v === true || /^(sim|true|cumprido)$/i.test(String(v));
  });
  if (fatos.length !== nFatos || criterios.length !== nCriterios) {
    throw new Error(`o juiz devolveu ${fatos.length} fatos e ${criterios.length} critérios (esperado ${nFatos} e ${nCriterios})`);
  }
  return { fatos, criterios };
}

async function julgar({ juiz, pergunta, resposta }) {
  const fatos = pergunta.fatos || [];
  const criterios = pergunta.criterios || [];
  const sistema =
    'Você é um corretor rigoroso. Recebe uma PERGUNTA, um GABARITO e a RESPOSTA de um assistente. ' +
    'Julgue SOMENTE o que está escrito na RESPOSTA, comparando com o GABARITO. Não complete a resposta com o que você sabe ' +
    'e não dê crédito por texto vago. Responda só com JSON.';
  const usuario = [
    `PERGUNTA: ${pergunta.pedido}`,
    '',
    fatos.length ? `FATOS DO GABARITO:\n${fatos.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
    criterios.length ? `CRITÉRIOS:\n${criterios.map((k, i) => `${i + 1}. ${k}`).join('\n')}` : '',
    '',
    `RESPOSTA DO ASSISTENTE:\n"""\n${String(resposta || '(resposta vazia)').slice(0, 9000)}\n"""`,
    '',
    'Para CADA fato, dê um veredito:',
    '- "presente": a resposta afirma isso (com outras palavras serve; número aproximado serve);',
    '- "ausente": a resposta não diz isso;',
    '- "contradito": a resposta afirma algo que contradiz o fato (outra data, outro nome, o oposto).',
    'Para CADA critério, diga se a resposta cumpre (true) ou não (false).',
    '',
    `Formato exato: {"fatos":[${fatos.map((_, i) => `{"n":${i + 1},"veredito":"presente|ausente|contradito"}`).join(',')}],` +
      `"criterios":[${criterios.map((_, i) => `{"n":${i + 1},"cumprido":true}`).join(',')}]}`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      const r = await ollama.chat({
        host: HOST,
        model: juiz,
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario },
        ],
        json: true,
        temperature: 0,
        numCtx: 8192,
        numPredict: 800,
        pensar: false,
      });
      const veredito = lerVeredito(r.content, pergunta);
      return { ...veredito, nota: notaDe(pergunta, veredito) };
    } catch (err) {
      ultimoErro = err;
    }
  }
  return { fatos: [], criterios: [], nota: null, erro: ultimoErro?.message || 'juiz falhou' };
}

/**
 * O juiz presta? Resposta errada de propósito tem que tirar nota baixa; o
 * próprio gabarito, escrito como resposta, nota alta; "não sei", zero.
 */
async function calibrar(juiz) {
  const provas = [];
  for (const p of PERGUNTAS.filter((x) => x.errada && x.fatos?.length)) {
    provas.push({ p, tipo: 'errada', resposta: p.errada, ok: (n) => n !== null && n <= 3 });
    provas.push({ p, tipo: 'gabarito', resposta: `${p.fatos.join('. ')}.`, ok: (n) => n !== null && n >= 8 });
  }
  if (provas.length) provas.push({ p: provas[0].p, tipo: 'não sei', resposta: 'Não sei responder a essa pergunta.', ok: (n) => n !== null && n <= 1 });

  const falhas = [];
  for (const prova of provas) {
    const v = await julgar({ juiz, pergunta: prova.p, resposta: prova.resposta });
    const passou = prova.ok(v.nota);
    console.log(`    ${passou ? verde('✓') : vermelho('✗')} ${prova.p.id.padEnd(12)} ${prova.tipo.padEnd(9)} nota ${v.nota ?? `— (${v.erro})`}`);
    if (!passou) falhas.push(`${prova.p.id}/${prova.tipo}: nota ${v.nota}`);
  }
  return falhas;
}

/* ------------------------------ ambiente ------------------------------ */

function configDoApp() {
  let salvo = {};
  try {
    salvo = JSON.parse(fs.readFileSync(path.join(DADOS_DO_APP, 'config.json'), 'utf8'));
  } catch {
    console.log(amarelo('  sem config.json do app — usando os ajustes de fábrica'));
  }
  const cfg = { ...DEFAULTS, ...salvo };
  for (const chave of ['workspace', 'alwaysAllow', 'host', 'model']) delete cfg[chave]; // a pasta de trabalho é a da medição
  cfg.autonomy = 'auto';
  cfg.ferramentasDesativadas = [...new Set([...(cfg.ferramentasDesativadas || []), ...FERRAMENTAS_FORA])];
  return { cfg, modelo: args.modelo || salvo.model || DEFAULTS.model || 'llama3.1:8b' };
}

const responde = (url) =>
  fetch(url, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);

/** A mesma busca do app: o SearXNG embutido que já está rodando, ou um que sobe só pra medição. */
async function prepararBusca(cfg) {
  if (args.searxng) return { url: String(args.searxng), parar: async () => {} };
  if (!cfg.usarSearxngEmbutido) return { url: cfg.searxngUrl || '', parar: async () => {} };
  let porta = 8888;
  try {
    porta = JSON.parse(fs.readFileSync(path.join(DADOS_DO_APP, 'searxng-runtime', 'instancia', 'porta.json'), 'utf8')).porta;
  } catch {
    /* porta padrão */
  }
  const url = `http://127.0.0.1:${porta}`;
  if (await responde(`${url}/`)) return { url, parar: async () => {} };
  const runtime = new RuntimeSearXNG({ userDataPath: DADOS_DO_APP });
  if (!runtime.estaInstalado()) return { url: cfg.searxngUrl || '', parar: async () => {} };
  await runtime.iniciar();
  return { url: `http://127.0.0.1:${runtime.porta}`, parar: () => runtime.parar() };
}

function versaoDoCodigo() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/* ------------------------------ rodada ------------------------------ */

async function responder(pergunta, { cfg, modelo }) {
  const inicio = Date.now();
  try {
    const obtido = await executarCasoAgente(
      { nome: `qualidade-${pergunta.id}`, pedido: pergunta.pedido, config: cfg },
      { real: true, host: HOST, modelo, modeloRedacao: cfg.modelRedacao || '', gravarRegistro: null }
    );
    const r = obtido.registro || {};
    const buscas = (r.fontes || []).filter((f) => f.tipo === 'busca');
    const ferramentas = r.ferramentas || [];
    return {
      resposta: obtido.resposta || '',
      seg: Math.round((Date.now() - inicio) / 1000),
      passos: obtido.passos || 0,
      tokens: r.tokens?.total || 0,
      nivelAuto: r.auto?.nivel ?? null,
      busca: {
        provedores: [...new Set(buscas.map((b) => b.provedor))],
        ok: buscas.length,
        semProvedor: ferramentas.filter((f) => /Nenhum provedor de busca respondeu/.test(f.erro || '')).length,
        semLeitura: ferramentas.filter((f) => /não consegui ler nenhuma/.test(f.erro || '')).length,
      },
      fontes: (r.fontes || []).filter((f) => f.tipo === 'leitura').length,
    };
  } catch (err) {
    return { resposta: '', seg: Math.round((Date.now() - inicio) / 1000), passos: 0, tokens: 0, busca: { provedores: [], ok: 0, semProvedor: 0, semLeitura: 0 }, fontes: 0, erro: err.message };
  }
}

function rodadaAnterior() {
  try {
    const arquivos = fs.readdirSync(DIR_RESULTADOS).filter((f) => f.endsWith('.json')).sort();
    return arquivos.length ? JSON.parse(fs.readFileSync(path.join(DIR_RESULTADOS, arquivos.at(-1)), 'utf8')) : null;
  } catch {
    return null;
  }
}

async function principal() {
  let perguntas = PERGUNTAS;
  if (args.so) perguntas = perguntas.filter((p) => p.tipo === args.so);
  if (args.id) perguntas = perguntas.filter((p) => String(args.id).split(',').includes(p.id));
  if (args.n) perguntas = perguntas.slice(0, Number(args.n));
  if (!perguntas.length) {
    console.log('Nenhuma pergunta corresponde ao filtro.');
    process.exit(0);
  }

  const instalados = (await ollama.listModels(HOST).catch(() => [])).map((m) => m.name || m);
  if (!instalados.length) {
    console.log(vermelho('O Ollama não respondeu (ou não tem modelo). Ligue o Ollama e rode de novo.'));
    process.exit(1);
  }
  const { cfg, modelo } = configDoApp();
  const juiz = args.juiz || ['qwen2.5:14b', modelo].find((m) => instalados.includes(m)) || modelo;
  const busca = await prepararBusca(cfg);
  cfg.searxngUrl = busca.url;

  console.log(`\nQualidade AuGPT · ${perguntas.length} perguntas · agente ${modelo} · juiz ${juiz} · busca ${busca.url || 'provedores públicos'}\n`);
  if (juiz === modelo) console.log(amarelo('  o juiz é o mesmo modelo do agente: ele tende a concordar com os próprios erros. Prefira um modelo maior em --juiz.\n'));

  let encerrou = false;
  const encerrar = async (codigo) => {
    if (encerrou) return;
    encerrou = true;
    await busca.parar().catch(() => {});
    fs.rmSync(RAIZ, { recursive: true, force: true });
    process.exit(codigo);
  };

  if (!args['sem-calibrar']) {
    console.log(cinza('  calibrando o juiz'));
    const falhas = await calibrar(juiz);
    if (falhas.length) {
      console.log(vermelho(`\n  JUIZ REPROVADO na calibragem (${falhas.join('; ')}).`));
      console.log('  As notas dele não distinguem resposta certa de errada. Use outro modelo em --juiz (ou --sem-calibrar para rodar assim mesmo).\n');
      if (!args['mesmo-assim']) await encerrar(1);
    }
    console.log();
  }

  // 1ª fase: o agente responde tudo
  console.log(cinza('  respondendo'));
  const respostas = [];
  for (const p of perguntas) {
    const r = await responder(p, { cfg, modelo });
    respostas.push(r);
    console.log(`    ${p.id.padEnd(18)} ${String(r.seg).padStart(4)}s ${String(r.passos).padStart(2)}p ${r.erro ? vermelho(`erro: ${r.erro.slice(0, 80)}`) : cinza(`${r.resposta.length} caracteres`)}`);
  }
  await ollama.unloadModel?.(HOST, modelo).catch(() => {});

  // 2ª fase: o juiz corrige tudo
  console.log(cinza('\n  corrigindo\n'));
  const resultados = [];
  for (let i = 0; i < perguntas.length; i += 1) {
    const p = perguntas[i];
    const r = respostas[i];
    const v = r.erro || !r.resposta.trim() ? { fatos: [], criterios: [], nota: 0, erro: r.erro || 'resposta vazia' } : await julgar({ juiz, pergunta: p, resposta: r.resposta });
    resultados.push({ id: p.id, tipo: p.tipo, pedido: p.pedido, nota: v.nota, veredito: { fatos: v.fatos, criterios: v.criterios }, erroDoJuiz: v.erro || null, ...r });
    const faltou = [
      ...(p.fatos || []).filter((_, k) => v.fatos[k] === 'ausente'),
      ...(p.criterios || []).filter((_, k) => v.criterios[k] === false),
    ];
    const contradisse = (p.fatos || []).filter((_, k) => v.fatos[k] === 'contradito');
    console.log(
      `    ${corDaNota(v.nota)}  ${p.id.padEnd(18)} ${cinza(`${String(r.seg).padStart(4)}s ${String(r.passos).padStart(2)}p  busca: ${r.busca.provedores.join('+') || '—'}${r.busca.semProvedor ? vermelho(` (${r.busca.semProvedor} sem provedor)`) : ''}`)}`
    );
    if (v.erro) console.log(cinza(`          ${v.erro}`));
    for (const f of contradisse) console.log(vermelho(`          contradiz: ${f}`));
    for (const f of faltou.slice(0, 3)) console.log(cinza(`          faltou: ${f}`));
  }

  // resumo
  const comNota = resultados.filter((r) => r.nota !== null);
  const notas = comNota.map((r) => r.nota);
  const resumo = {
    notaMedia: Math.round(media(notas) * 100) / 100,
    abaixoDe5: comNota.filter((r) => r.nota < 5).length,
    segMediana: mediana(resultados.map((r) => r.seg)),
    segTotal: resultados.reduce((s, r) => s + r.seg, 0),
    buscasSemProvedor: resultados.reduce((s, r) => s + r.busca.semProvedor, 0),
    buscasOk: resultados.reduce((s, r) => s + r.busca.ok, 0),
    semJuiz: resultados.length - comNota.length,
  };
  console.log(`\n  nota média ${corDaNota(resumo.notaMedia)}  ·  ${resumo.abaixoDe5} de ${comNota.length} abaixo de 5  ·  tempo mediano ${resumo.segMediana}s (total ${Math.round(resumo.segTotal / 60)} min)`);
  for (const tipo of [...new Set(resultados.map((r) => r.tipo))]) {
    const g = comNota.filter((r) => r.tipo === tipo);
    console.log(cinza(`    ${tipo.padEnd(11)} nota ${media(g.map((r) => r.nota)).toFixed(1)}  ·  ${mediana(g.map((r) => r.seg))}s  ·  ${g.length} perguntas`));
  }
  console.log(cinza(`    busca: ${resumo.buscasOk} respondidas, ${resumo.buscasSemProvedor} sem nenhum provedor`));
  if (resumo.semJuiz) console.log(amarelo(`    ${resumo.semJuiz} pergunta(s) sem nota: o juiz não devolveu um veredito legível`));

  // comparação com a rodada anterior — só entre as mesmas perguntas
  const anterior = rodadaAnterior();
  if (anterior) {
    const antes = new Map(anterior.resultados.map((r) => [r.id, r]));
    const comuns = comNota.filter((r) => antes.get(r.id)?.nota != null);
    if (comuns.length) {
      const mAntes = media(comuns.map((r) => antes.get(r.id).nota));
      const mAgora = media(comuns.map((r) => r.nota));
      const tAntes = mediana(comuns.map((r) => antes.get(r.id).seg));
      const tAgora = mediana(comuns.map((r) => r.seg));
      const seta = (d) => (d > 0.05 ? verde(`+${d.toFixed(1)}`) : d < -0.05 ? vermelho(d.toFixed(1)) : cinza('='));
      console.log(`\n  contra a rodada de ${anterior.em.slice(0, 16).replace('T', ' ')} (${anterior.versao || 'sem versão'}), nas ${comuns.length} perguntas em comum:`);
      console.log(`    nota ${mAntes.toFixed(1)} → ${mAgora.toFixed(1)} (${seta(mAgora - mAntes)})  ·  tempo mediano ${tAntes}s → ${tAgora}s`);
      const cairam = comuns.filter((r) => r.nota <= antes.get(r.id).nota - 2);
      const subiram = comuns.filter((r) => r.nota >= antes.get(r.id).nota + 2);
      if (cairam.length) console.log(vermelho(`    caíram 2+ pontos: ${cairam.map((r) => `${r.id} (${antes.get(r.id).nota} → ${r.nota})`).join(', ')}`));
      if (subiram.length) console.log(verde(`    subiram 2+ pontos: ${subiram.map((r) => `${r.id} (${antes.get(r.id).nota} → ${r.nota})`).join(', ')}`));
    }
  }

  fs.mkdirSync(DIR_RESULTADOS, { recursive: true });
  const em = new Date().toISOString();
  const arquivo = path.join(DIR_RESULTADOS, `${em.slice(0, 16).replace(/:/g, '-')}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ em, versao: versaoDoCodigo(), modelo, juiz, busca: busca.url, resumo, resultados }, null, 2), 'utf8');
  console.log(cinza(`\n  gravado em ${path.relative(path.join(__dirname, '..'), arquivo)} (com as respostas inteiras)\n`));
  await encerrar(0);
}

if (require.main === module) {
  principal().catch((err) => {
    console.error(vermelho(`\nfalhou: ${err.message}`));
    process.exit(1);
  });
}

module.exports = { notaDe, lerVeredito };
