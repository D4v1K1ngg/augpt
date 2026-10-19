'use strict';

/**
 * Teste de fumaça da TELA (19/10, revisão do projeto): a bancada não toca no renderer, e
 * o "raciocínio" e os "Sites consultados" ficaram quebrados dias sem ninguém ver. Este
 * script abre uma cópia isolada do app (dados numa pasta temporária: suas conversas e
 * ajustes não são tocados), faz perguntas que cobrem as rotas principais e confere a tela.
 * Falha se houver erro de JavaScript na página.
 *
 * Uso:  node avaliacao/tela/fumaca.js [--pesquisa]
 *   --pesquisa  também faz uma pergunta que pesquisa na web (precisa do SearXNG/busca)
 * Precisa: o Electron instalado (npm install) e o Ollama com o modelo dos seus Ajustes.
 * Rodar antes de gerar cada instalador.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const comPesquisa = process.argv.includes('--pesquisa');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-fumaca-'));

// a cópia usa o modelo e a busca dos seus Ajustes, sem chaves e sem a tela de boas-vindas
const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
const seu = path.join(appData, 'AuGPT', 'config.json');
const cfg = fs.existsSync(seu) ? JSON.parse(fs.readFileSync(seu, 'utf8')) : {};
Object.assign(cfg, { jinaKey: '', boasVindasConcluida: true, workspace: path.join(dados, 'pasta') });
fs.mkdirSync(cfg.workspace, { recursive: true });
fs.writeFileSync(path.join(dados, 'config.json'), JSON.stringify(cfg, null, 2));

const PERGUNTAS = [
  { pedido: 'o que você pode fazer?', rota: 'utilitarios', confere: (t) => /Utilitários/.test(t) },
  { pedido: 'quanto espaço livre meu pc tem?', rota: 'consultar_pc', confere: (t) => /Espaço nas unidades/.test(t) },
  ...(comPesquisa ? [{ pedido: 'qual a população atual de Vitória-ES?', rota: 'pesquisa', confere: (t) => /habitantes/i.test(t), raciocinio: true }] : []),
];

let encerrar = () => {};
process.on('SIGINT', () => (encerrar(), process.exit(130)));
process.on('SIGTERM', () => (encerrar(), process.exit(143)));
const falhas = [];
const conferir = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) falhas.push(msg);
};

(async () => {
  const electron = require(path.join(RAIZ, 'node_modules', 'electron'));
  // porta escolhida pelo Electron (0) e lida do DevToolsActivePort: uma cópia esquecida aberta
  // não captura o teste seguinte
  const app = spawn(electron, [RAIZ, `--user-data-dir=${dados}`, '--remote-debugging-port=0', '--sem-abertura'], { stdio: 'ignore' });
  encerrar = () => {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      else app.kill('SIGKILL');
    } catch {}
  };
  let alvo;
  for (let i = 0; i < 60 && !alvo; i += 1) {
    await esperar(500);
    try {
      const porta = fs.readFileSync(path.join(dados, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find((t) => t.type === 'page' && /index\.html/.test(t.url));
    } catch {}
  }
  if (!alvo) throw new Error('o app não abriu');
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  let id = 0;
  const pend = new Map();
  const errosDaPagina = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) (pend.get(m.id)(m), pend.delete(m.id));
    if (m.method === 'Runtime.exceptionThrown') errosDaPagina.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errosDaPagina.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });
  // cada comando com prazo: página travada vira falha, não espera eterna
  const cdp = (method, params = {}) => new Promise((ok, falhou) => {
    id += 1;
    const meu = id;
    const prazo = setTimeout(() => (pend.delete(meu), falhou(new Error(`a página não respondeu a ${method}`))), 30000);
    pend.set(meu, (m) => (clearTimeout(prazo), ok(m)));
    ws.send(JSON.stringify({ id: meu, method, params }));
  });
  const js = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await cdp('Runtime.enable');
  // recarrega com a escuta já ligada: erro no carregamento dos scripts da tela também conta
  await cdp('Page.enable');
  await cdp('Page.reload', { ignoreCache: true });
  await esperar(3000);
  // pronto = o seletor de modelo preenchido (antes disso o app recusa o pedido)
  for (let i = 0; i < 120 && !(await js("!!document.getElementById('modelo').value")); i += 1) await esperar(500);
  if (!(await js("!!document.getElementById('modelo').value"))) throw new Error('nenhum modelo do Ollama apareceu no seletor (o Ollama está aberto?)');
  await js("document.getElementById('boasVindas').hidden = true; trocarAba('agente'); true");
  const ultimo = "[...document.querySelectorAll('#viewAgente .msg.turno')].pop()";

  console.log('Aba Utilitários');
  await js("document.getElementById('navUtilitarios').click(); true");
  await esperar(1500);
  conferir((await js("document.querySelectorAll('.util-card').length")) >= 20, 'os cartões aparecem');
  // cada aba carrega o seu código ao abrir (Ajustes lê o Ollama, Execuções lê o histórico…)
  for (const [aba, nome] of [['navConfig', 'Ajustes'], ['navExecucoes', 'Execuções'], ['navSkills', 'Skills'], ['navConversa', 'Conversa']]) {
    const antes = errosDaPagina.length;
    await js(`document.getElementById('${aba}').click(); true`);
    await esperar(2500);
    conferir(errosDaPagina.length === antes, `a aba ${nome} abre sem erro`);
  }
  await js("trocarAba('agente'); true");

  for (const p of PERGUNTAS) {
    console.log(`Pergunta: ${p.pedido}`);
    await js(`(() => { const e = document.getElementById('entradaAgente'); e.value = ${JSON.stringify(p.pedido)}; e.dispatchEvent(new Event('input')); document.getElementById('btnEnviarAgente').click(); return true; })()`);
    const t0 = Date.now();
    await esperar(2000);
    while (Date.now() - t0 < 5 * 60 * 1000 && (await js("document.getElementById('btnEnviarAgente').classList.contains('parando')"))) await esperar(1500);
    const texto = await js(`${ultimo}.querySelector('.resposta').innerText`);
    if (process.env.FUMACA_DEBUG) console.log('   [debug]', await js("document.querySelectorAll('#viewAgente .msg.turno').length"), JSON.stringify(String(texto).slice(0, 200)), await js("document.getElementById('agenteMensagens').innerText.slice(0, 300)"));
    conferir(p.confere(texto || ''), `a resposta saiu (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (p.raciocinio) {
      conferir((await js(`${ultimo}.querySelectorAll('.atividade-etapas li').length`)) >= 2, 'o cartão "Atividade do agente" mostra as etapas');
      conferir((await js(`${ultimo}.querySelectorAll('.trilha .no').length`)) === (await js(`[...${ultimo}.querySelectorAll('.trilha .no')].filter((n) => n.querySelector('.cartao')).length`)), 'a trilha do raciocínio não tem passo vazio');
    }
    await esperar(1500);
  }

  console.log('Caixa de mensagem');
  await js("(() => { const s = document.getElementById('modoNaCaixa'); s.value = 'rapido'; s.dispatchEvent(new Event('change')); return true; })()");
  await esperar(800);
  conferir((await js('config.modoDePesquisa')) === 'rapido', 'o raciocínio troca pela caixa no meio da conversa');

  // o registro de cada execução diz qual rota respondeu
  const registros = fs.existsSync(path.join(dados, 'execucoes')) ? fs.readdirSync(path.join(dados, 'execucoes')).map((f) => JSON.parse(fs.readFileSync(path.join(dados, 'execucoes', f), 'utf8'))) : [];
  for (const p of PERGUNTAS) {
    const r = registros.find((x) => x.pedido === p.pedido);
    conferir(r?.rota === p.rota, `registro: "${p.pedido}" pela rota ${p.rota} (gravou ${r?.rota})`);
  }
  conferir(!errosDaPagina.length, `sem erro de JavaScript na página${errosDaPagina.length ? `: ${errosDaPagina.slice(0, 3).join(' | ')}` : ''}`);

  ws.close();
  encerrar();
  await esperar(800);
  fs.rmSync(dados, { recursive: true, force: true });
  console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\ntudo certo');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => {
  console.error('ERRO', e.message);
  encerrar();
  process.exit(1);
});
