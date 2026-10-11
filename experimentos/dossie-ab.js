'use strict';

/**
 * Experimento A/B/C — mesmo dossiê, três respostas.
 *
 *   A = resposta MONTADA pelo código (compositor.js — o caminho padrão hoje)
 *   B = resposta REDIGIDA pelo modelo (redigir() — o mesmo dossiê e o mesmo
 *       plano da resposta que o motor de pesquisa produziu para A)
 *   C = Ollama direto, sem material nenhum (a "conversa direta" de referência)
 *
 * A pesquisa roda UMA vez. No momento em que o AuGPT vai montar a resposta,
 * o script gera também a versão B sobre o mesmo dossiê, confere as duas com o
 * verificador do próprio AuGPT e no fim pede a C ao modelo.
 *
 * Não altera nenhum arquivo do projeto: as trocas são feitas em memória, só
 * durante esta execução. Tudo é gravado em experimentos/resultados/<data>/.
 *
 * Uso (na pasta do AuGPT, com o Ollama ligado; feche o app antes):
 *   npx electron experimentos/dossie-ab.js
 *   npx electron experimentos/dossie-ab.js "sua pergunta aqui"
 *   npx electron experimentos/dossie-ab.js --nivel alto
 *   npx electron experimentos/dossie-ab.js --userdata "C:\Users\voce\AppData\Roaming\augpt"
 *
 * Rode pelo Electron, não pelo node: a leitura do Reddit e de outros sites que
 * precisam de JavaScript usa a janela invisível do Electron (electron/render.js).
 * Com `node`, essas leituras falham e o dossiê fica sem a comunidade.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const { Config } = require(path.join(RAIZ, 'src', 'config'));
const ollama = require(path.join(RAIZ, 'src', 'llm', 'ollama'));
const { Agent } = require(path.join(RAIZ, 'src', 'agent', 'loop'));
const { Skills } = require(path.join(RAIZ, 'src', 'skills'));
const tools = require(path.join(RAIZ, 'src', 'tools'));
const busca = require(path.join(RAIZ, 'src', 'tools', 'search'));
const { RuntimeSearXNG } = require(path.join(RAIZ, 'src', 'searxng-runtime'));
const { Registro } = require(path.join(RAIZ, 'src', 'registro'));
const verificador = require(path.join(RAIZ, 'src', 'agent', 'verificador'));
const afirmacoes = require(path.join(RAIZ, 'src', 'agent', 'afirmacoes'));

const PERGUNTA_PADRAO = 'Quais são os 5 melhores fones intra-auriculares (IEM) para jogar PUBG no PC? Explique os critérios do ranking, as vantagens e limitações de cada um e a recomendação final.';

/* ------------------------------ argumentos ------------------------------ */

function lerArgumentos() {
  const args = process.argv.slice(2);
  let userData = null;
  let nivel = null;
  const resto = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--userdata') userData = args[(i += 1)];
    else if (args[i] === '--nivel') nivel = args[(i += 1)];
    else if (!args[i].startsWith('--') && !/dossie-ab\.js$/.test(args[i]) && args[i] !== '.') resto.push(args[i]);
  }
  return { pergunta: resto.join(' ').trim() || PERGUNTA_PADRAO, userData, nivel };
}

function acharUserData(explicito) {
  if (explicito) return explicito;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidatos = [path.join(appData, 'augpt'), path.join(appData, 'AuGPT'), path.join(os.homedir(), '.config', 'augpt')];
  const achado = candidatos.find((c) => fs.existsSync(path.join(c, 'config.json')));
  if (!achado) {
    throw new Error(`Não achei o config.json do AuGPT em:\n  ${candidatos.join('\n  ')}\nUse --userdata "<pasta>" apontando para a pasta de dados do app.`);
  }
  return achado;
}

/* ------------------------------ util ------------------------------ */

const agora = () => Date.now();
const seg = (ms) => `${(ms / 1000).toFixed(1)} s`;
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const embaralhar = (lista) => {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function resumoDaVerificacao(v) {
  if (!v) return null;
  return {
    aprovado: v.aprovado,
    reescreveria: v.reescrever,
    respondeAoPedido: v.respondeAoPedido,
    valoresSemRespaldo: v.totalSuspeitas || 0,
    inconsistencias: (v.inconsistencias || []).slice(0, 15),
    suspeitas: (v.suspeitas || []).slice(0, 15),
  };
}

function conferir(texto, dossie, objetivo, agente) {
  const dossieBruto = dossie.map((d) => ({ texto: d.bruto || d.texto }));
  let verificacao = null;
  try {
    verificacao = verificador.verificar({ resposta: texto, dossie: dossieBruto, objetivo, assunto: agente.opcoesDaPesquisa || [] });
  } catch (err) {
    verificacao = { erro: err.message };
  }
  let afirm = [];
  try {
    const comp = agente.composicaoDaPesquisa;
    const extras = comp?.desempenho ? afirmacoes.extrasDoDesempenho(comp.desempenho) : [];
    afirm = afirmacoes.verificarAfirmacoes(texto, agente.tarefa?.livro, extras) || [];
  } catch {
    /* opcional */
  }
  const porStatus = {};
  for (const a of afirm) porStatus[a.status] = (porStatus[a.status] || 0) + 1;
  return {
    verificador: verificacao?.erro ? verificacao : resumoDaVerificacao(verificacao),
    afirmacoesNumericas: { total: afirm.length, porStatus },
    tamanho: { caracteres: texto.length, palavras: texto.split(/\s+/).filter(Boolean).length },
  };
}

/* ------------------------------ registro das chamadas ao modelo ------------------------------ */

// Toda chamada ao Ollama passa por aqui: modelo, janela de contexto pedida,
// tokens do prompt e se o AuGPT teve que cortar o contexto para caber.
const chamadas = [];
let etapaAtual = 'execução';
for (const nome of ['chat', 'chatStream']) {
  const original = ollama[nome];
  ollama[nome] = async function registrado(opcoes) {
    const t0 = agora();
    const r = await original.call(this, opcoes);
    chamadas.push({
      etapa: etapaAtual,
      funcao: nome,
      modelo: opcoes.model,
      numCtx: opcoes.numCtx,
      numPredict: opcoes.numPredict,
      promptTokens: r?.promptTokens ?? null,
      completionTokens: r?.completionTokens ?? null,
      usoDaJanela: r?.promptTokens && opcoes.numCtx ? Number((r.promptTokens / opcoes.numCtx).toFixed(2)) : null,
      contextoReduzido: r?.contextoReduzido || null,
      duracaoMs: agora() - t0,
    });
    return r;
  };
}

/* ------------------------------ captura do dossiê + versão B ------------------------------ */

const captura = { dossie: null, A: null, B: null };

const pesquisarOriginal = Agent.prototype.pesquisarComPlano;
Agent.prototype.pesquisarComPlano = async function (args) {
  captura.dossie = args.dossie; // a MESMA lista que a redação usa depois
  etapaAtual = 'pesquisa (motor)';
  try {
    return await pesquisarOriginal.call(this, args);
  } finally {
    etapaAtual = 'execução';
  }
};

const comporOriginal = Agent.prototype.comporResposta;
Agent.prototype.comporResposta = async function ({ objetivo }) {
  const dossie = captura.dossie || [];

  // A — montada pelo código (exatamente o que o AuGPT faz hoje)
  console.log('\n[A] montando a resposta pelo código...');
  etapaAtual = 'A: montada';
  let uso0 = { ...this.uso };
  let t0 = agora();
  const textoA = await comporOriginal.call(this, { objetivo });
  captura.A = {
    texto: textoA,
    duracaoMs: agora() - t0,
    tokens: { prompt: this.uso.prompt - uso0.prompt, completion: this.uso.completion - uso0.completion },
    conferencia: conferir(textoA, dossie, objetivo, this),
  };
  console.log(`[A] pronta em ${seg(captura.A.duracaoMs)}`);

  // B — redigida pelo modelo sobre o MESMO dossiê e o MESMO plano da resposta
  console.log('[B] redigindo a resposta com o modelo (mesmo dossiê)...');
  etapaAtual = 'B: redigida';
  uso0 = { ...this.uso };
  t0 = agora();
  try {
    const textoB = await this.redigir({ objetivo, conversa: [], dossie, foco: null });
    captura.B = {
      texto: textoB,
      duracaoMs: agora() - t0,
      tokens: { prompt: this.uso.prompt - uso0.prompt, completion: this.uso.completion - uso0.completion },
      conferencia: conferir(textoB, dossie, objetivo, this),
    };
    console.log(`[B] pronta em ${seg(captura.B.duracaoMs)}`);
  } catch (err) {
    captura.B = { erro: err.message };
    console.log(`[B] falhou: ${err.message}`);
  }
  etapaAtual = 'execução (pós-resposta)';

  // o resto da execução segue como sempre, com a resposta A
  this.respostaComposta = true;
  return textoA;
};

/* ------------------------------ material para conferência manual ------------------------------ */

function dossieEmTexto(agente) {
  const linhas = ['# Dossiê usado por A e B', ''];
  const r = agente.composicaoDaPesquisa;
  if (r) {
    linhas.push(`Modo do motor: **${r.modo || 'recomendação'}**`);
    linhas.push(`Finalistas (na ordem do motor): ${(r.finalistas || []).map((f) => f.nome).join(' · ') || '—'}`);
    linhas.push(`Critérios: ${(r.plano?.criterios || []).map((k) => k.nome).join(' · ') || '—'}`, '');
    linhas.push('## Plano da resposta entregue ao redator (B)', '', '```', String(agente.planoDeResposta || '').slice(0, 12000), '```', '');
  }
  linhas.push('## Entradas do dossiê', '');
  (captura.dossie || []).forEach((d, i) => {
    linhas.push(`### ${i + 1}. ${d.origem || 'sem origem'}`);
    if (d.url) linhas.push(d.url);
    linhas.push('', String(d.texto || d.bruto || '').slice(0, 2500), '');
  });
  return linhas.join('\n');
}

const RUBRICA = `## Como avaliar (antes de abrir o gabarito)

Leia as três respostas em cego/ e dê uma nota de 1 a 5 em cada critério:

| Critério | O que olhar |
|---|---|
| Correção factual | Os produtos existem? Specs, preços e afirmações batem com o dossie.md? |
| Fundamentação | As afirmações importantes vêm do material (fontes, comentários) ou parecem "de cabeça"? |
| Fidelidade ao pedido | Responde o que foi pedido: 5 opções, critérios, prós/contras, recomendação final? |
| Raciocínio | Explica POR QUE cada opção entrou e por que nessa ordem, ligando ao uso (FPS, passos, posicionamento)? |
| Naturalidade | Lê como um especialista explicando, ou como um formulário preenchido? |
| Utilidade | Depois de ler, você saberia o que comprar? |

Só depois de anotar as notas, abra gabarito.json para ver qual resposta era A, B e C.
`;

/* ------------------------------ execução ------------------------------ */

async function principal() {
  const { pergunta, userData, nivel } = lerArgumentos();
  const pastaDados = acharUserData(userData);
  const cfg = new Config(pastaDados);
  if (nivel) {
    // só nesta execução: não grava no config.json
    cfg.data.nivelRaciocinio = nivel;
    cfg.aplicarNivelRaciocinio();
  }
  const config = cfg.data;

  // leitura com JavaScript (Reddit, sites montados no navegador): só existe dentro do Electron
  let render = null;
  if (process.versions.electron) {
    const { app } = require('electron');
    app.on('window-all-closed', () => {}); // as janelas invisíveis não podem encerrar o experimento
    await app.whenReady();
    if (config.renderizarJs) {
      const { renderizar } = require(path.join(RAIZ, 'electron', 'render'));
      render = (url) => renderizar(url, { obterConfig: () => config });
    }
  } else {
    console.warn('AVISO: rodando pelo node, sem leitura com JavaScript — o Reddit não vai abrir. Use: npx electron experimentos/dossie-ab.js');
  }
  if (!config.model) throw new Error('Nenhum modelo escolhido no AuGPT (Ajustes > modelo).');
  if (!config.workspace) throw new Error('Nenhuma pasta de trabalho escolhida no AuGPT.');

  // o experimento só faz sentido com o motor de pesquisa e a resposta montada ligados
  config.motorDePesquisa = true;
  config.respostaMontada = true;

  console.log(`Pasta de dados: ${pastaDados}`);
  console.log(`Modelo: ${config.model}${config.modelRedacao ? ` (redação: ${config.modelRedacao})` : ''} · numCtx ${config.numCtx}${config.numCtxRedacao ? ` (redação: ${config.numCtxRedacao})` : ''} · nível ${config.nivelRaciocinio}`);
  console.log(`Leitura com JavaScript: ${render ? 'ligada' : 'DESLIGADA'}`);
  console.log(`Pergunta: ${pergunta}\n`);

  // mesmo preparo do electron/main.js
  tools.recarregar({ dirEmbutidas: path.join(RAIZ, 'ferramentas'), dirUsuario: path.join(pastaDados, 'ferramentas') });
  busca.definirPersonalizados(config.dominiosPersonalizados || []);
  let searx = null;
  if (config.usarSearxngEmbutido) {
    searx = new RuntimeSearXNG({ userDataPath: pastaDados });
    if (!searx.estaInstalado()) throw new Error('O AuGPT está configurado para o SearXNG embutido, mas ele não está instalado.');
    console.log('Ligando o SearXNG embutido...');
    await searx.iniciar();
    config.searxngUrl = `http://127.0.0.1:${searx.porta}`;
  }
  const skills = new Skills({ dirEmbutidas: path.join(RAIZ, 'skills'), dirUsuario: path.join(pastaDados, 'skills') });

  const agente = new Agent({ config, userDataPath: pastaDados, render, navegador: null, skills });
  const registro = new Registro({ origem: 'experimento', modelo: config.model, host: config.host }).acompanhar(agente);

  // sem interface: ação de risco baixo é aprovada; qualquer outra é negada
  const negadas = [];
  agente.on('aprovacao', (d) => {
    const ok = d.risco === 'baixo';
    if (!ok) negadas.push(d.nome);
    agente.responder(d.id, ok ? 'aprovar' : 'negar');
  });
  agente.on('pergunta', (d) => agente.responder(d.id, 'Prossiga com o que você já tem.'));
  agente.on('ferramenta', (d) => console.log(`  → ${d.nome} ${JSON.stringify(d.argumentos || {}).slice(0, 110)}`));
  agente.on('aviso', (d) => console.log(`  ! ${d.texto}`));

  const inicio = agora();
  let resultado;
  try {
    resultado = await agente.run(pergunta, []);
  } catch (err) {
    resultado = { ok: false, motivo: err.message };
  }
  const duracaoTotal = agora() - inicio;
  const duracaoAteResposta = duracaoTotal - (captura.A?.duracaoMs || 0) - (captura.B?.duracaoMs || 0);

  // C — Ollama direto, mesmo modelo de redação, sem material
  let C = null;
  console.log('\n[C] perguntando direto ao Ollama (sem pesquisa)...');
  etapaAtual = 'C: direta';
  try {
    const t0 = agora();
    const modelo = config.modelRedacao || config.model;
    const r = await ollama.chat({
      host: config.host,
      model: modelo,
      messages: [{ role: 'user', content: pergunta }],
      temperature: Math.min((config.temperature ?? 0.4) + 0.2, 0.9),
      numCtx: config.numCtxRedacao || config.numCtx,
      numPredict: config.numPredictResposta || 3072,
      manterVivo: config.manterModeloVivo,
    });
    const texto = String(r.content || '').trim();
    C = {
      texto,
      duracaoMs: agora() - t0,
      tokens: { prompt: r.promptTokens || 0, completion: r.completionTokens || 0 },
      conferencia: conferir(texto, captura.dossie || [], pergunta, agente),
    };
    console.log(`[C] pronta em ${seg(C.duracaoMs)}`);
  } catch (err) {
    C = { erro: err.message };
    console.log(`[C] falhou: ${err.message}`);
  }
  if (searx) await searx.parar().catch(() => {});

  /* ---------- gravação ---------- */
  const pasta = path.join(__dirname, 'resultados', carimbo());
  fs.mkdirSync(path.join(pasta, 'cego'), { recursive: true });
  const escrever = (nome, conteudo) => fs.writeFileSync(path.join(pasta, nome), conteudo, 'utf8');

  const motorAcionado = Boolean(captura.A);
  const versoes = { A: captura.A, B: captura.B, C };
  for (const [letra, v] of Object.entries(versoes)) {
    escrever(`${letra}-${{ A: 'montada', B: 'redigida', C: 'direta' }[letra]}.md`, v?.texto || `(sem resposta: ${v?.erro || 'não gerada'})`);
  }
  // versão cega: as três com rótulos embaralhados
  const ordem = embaralhar(['A', 'B', 'C'].filter((l) => versoes[l]?.texto));
  const gabarito = {};
  ordem.forEach((letra, i) => {
    fs.writeFileSync(path.join(pasta, 'cego', `resposta-${i + 1}.md`), versoes[letra].texto, 'utf8');
    gabarito[`resposta-${i + 1}`] = { A: 'A — montada pelo código', B: 'B — redigida pelo modelo (mesmo dossiê)', C: 'C — Ollama direto, sem pesquisa' }[letra];
  });
  escrever('gabarito.json', JSON.stringify(gabarito, null, 2));
  escrever('dossie.md', dossieEmTexto(agente));
  try {
    escrever('registro-da-execucao.json', JSON.stringify(registro.dados, null, 2));
  } catch {
    /* opcional */
  }

  const dominios = [...new Set((captura.dossie || []).map((d) => { try { return new URL(d.url).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean))];
  const comunidade = dominios.filter((d) => /reddit|clubedohardware|adrenaline|head-fi/.test(d));
  const descartesDeOpcao = (registro.dados?.descartes || []).filter((d) => ['categoria', 'ficha', 'evidencia'].includes(d.etapa) && !/^https?:/.test(d.alvo || ''));
  const janela = chamadas.filter((c) => c.usoDaJanela !== null);
  const maiorUso = janela.reduce((m, c) => (c.usoDaJanela > (m?.usoDaJanela || 0) ? c : m), null);
  const metricas = {
    pergunta,
    modelo: config.model,
    modeloRedacao: config.modelRedacao || config.model,
    numCtx: config.numCtx,
    numCtxRedacao: config.numCtxRedacao || config.numCtx,
    nivelRaciocinio: config.nivelRaciocinio,
    leituraComJavaScript: Boolean(render),
    motorAcionado,
    modoDoMotor: agente.composicaoDaPesquisa?.modo || null,
    resultadoDaExecucao: resultado?.ok === false ? resultado.motivo : 'ok',
    tempoDaPesquisaAteAResposta: seg(duracaoAteResposta),
    tempoTotal: seg(duracaoTotal),
    acoesNegadas: negadas,
    dominiosLidos: dominios,
    dominiosDaComunidade: comunidade,
    versoes: Object.fromEntries(
      Object.entries(versoes).map(([l, v]) => [l, v?.erro ? { erro: v.erro } : v ? { duracao: seg(v.duracaoMs), tokens: v.tokens, ...v.conferencia } : null])
    ),
    janelaDeContexto: {
      chamadas: chamadas.length,
      chamadasComCorte: chamadas.filter((c) => c.contextoReduzido).length,
      chamadasAcimaDe90PorCento: janela.filter((c) => c.usoDaJanela >= 0.9).length,
      maiorUso: maiorUso ? { etapa: maiorUso.etapa, promptTokens: maiorUso.promptTokens, numCtx: maiorUso.numCtx, uso: maiorUso.usoDaJanela } : null,
    },
    chamadas,
  };
  escrever('metricas.json', JSON.stringify(metricas, null, 2));

  const linha = (l) => {
    const m = metricas.versoes[l];
    if (!m) return `| ${l} | — | — | — | — | — |`;
    if (m.erro) return `| ${l} | erro: ${m.erro} | | | | |`;
    const v = m.verificador || {};
    return `| ${l} | ${m.duracao} | ${m.tokens.prompt} / ${m.tokens.completion} | ${m.tamanho.palavras} | ${v.valoresSemRespaldo ?? '—'} | ${v.aprovado === undefined ? '—' : v.aprovado ? 'sim' : 'não'} |`;
  };
  escrever(
    'RESUMO.md',
    [
      '# Experimento A/B/C — mesmo dossiê',
      '',
      `**Pergunta:** ${pergunta}`,
      `**Modelo:** ${metricas.modeloRedacao} · contexto ${metricas.numCtxRedacao} · nível ${metricas.nivelRaciocinio} · leitura com JavaScript ${metricas.leituraComJavaScript ? 'ligada' : 'DESLIGADA'}`,
      `**Motor de pesquisa acionado:** ${motorAcionado ? `sim (modo ${metricas.modoDoMotor || 'recomendação'})` : 'NÃO — a pergunta não passou pelo motor, então A e B não foram geradas; tente uma pergunta de recomendação/comparação'}`,
      `**Pesquisa até a resposta:** ${metricas.tempoDaPesquisaAteAResposta} · total ${metricas.tempoTotal}`,
      `**Fontes da comunidade no dossiê:** ${comunidade.length ? comunidade.join(', ') : 'nenhuma'} (de ${dominios.length} domínios lidos)`,
      `**Finalistas:** ${(agente.composicaoDaPesquisa?.finalistas || []).map((f) => f.nome).join(' · ') || '—'}`,
      `**Descartados no caminho:** ${descartesDeOpcao.length ? descartesDeOpcao.map((d) => `${d.alvo} (${d.etapa})`).join(', ') : 'nenhum'}`,
      '',
      '- **A** = montada pelo código (padrão atual)',
      '- **B** = redigida pelo modelo sobre o mesmo dossiê e o mesmo plano',
      '- **C** = Ollama direto, sem pesquisa (referência)',
      '',
      '| Versão | Tempo da redação | Tokens (prompt / saída) | Palavras | Valores sem respaldo no dossiê | Verificador aprovaria |',
      '|---|---|---|---|---|---|',
      linha('A'),
      linha('B'),
      linha('C'),
      '',
      'Em C, "valores sem respaldo" mede o que o modelo afirmou que NÃO aparece no material que a pesquisa encontrou — é um indicador de invenção, não uma prova.',
      '',
      '## Janela de contexto',
      `- ${metricas.janelaDeContexto.chamadas} chamadas ao modelo; ${metricas.janelaDeContexto.chamadasComCorte} precisaram de corte de contexto; ${metricas.janelaDeContexto.chamadasAcimaDe90PorCento} usaram 90% ou mais da janela.`,
      maiorUso ? `- Maior uso: ${Math.round(maiorUso.usoDaJanela * 100)}% (${maiorUso.promptTokens} de ${maiorUso.numCtx} tokens) na etapa "${maiorUso.etapa}".` : '',
      '',
      `Observação: B recebeu o dossiê e o plano da resposta, mas não a observação do crítico pré-redação que o caminho "redigido" normal receberia. Ações negadas pelo modo sem interface: ${negadas.length ? negadas.join(', ') : 'nenhuma'}.`,
      '',
      RUBRICA,
    ].join('\n')
  );

  console.log(`\nPronto. Resultados em:\n  ${pasta}`);
  console.log('Comece por RESUMO.md e leia as respostas em cego/ antes de abrir gabarito.json.');
}

const sair = (codigo) => (process.versions.electron ? require('electron').app.exit(codigo) : process.exit(codigo));
principal()
  .then(() => sair(0))
  .catch((err) => {
    console.error(`\nFalhou: ${err.message}`);
    sair(1);
  });
