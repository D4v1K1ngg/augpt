'use strict';

/**
 * Instala o Ollama pela tela de boas-vindas (15/10) — só depois do clique do
 * usuário em "Instalar". No Windows:
 *   1. winget (vem no Windows 10/11): `winget install Ollama.Ollama`, pacote
 *      oficial, assinado, sem janela;
 *   2. sem winget (ou se ele falhar): baixa o instalador oficial
 *      (https://ollama.com/download/OllamaSetup.exe) com progresso e roda em
 *      modo silencioso.
 * Mac e Linux: não instala sozinho (pede senha de administrador) — devolve as
 * instruções. Depois de instalar, liga o Ollama e espera ele responder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const URL_INSTALADOR_WINDOWS = 'https://ollama.com/download/OllamaSetup.exe';

function executar(comando, args, { aoLer = () => {}, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let saida = '';
    let filho;
    try {
      filho = spawn(comando, args, { windowsHide: true });
    } catch (err) {
      resolve({ codigo: -1, saida: String(err.message) });
      return;
    }
    const relogio = setTimeout(() => filho.kill(), timeoutMs);
    const ler = (d) => {
      const t = String(d);
      saida += t;
      for (const linha of t.split(/\r?\n|\r/)) if (linha.trim()) aoLer(linha.trim());
    };
    filho.stdout?.on('data', ler);
    filho.stderr?.on('data', ler);
    filho.on('error', (err) => {
      clearTimeout(relogio);
      resolve({ codigo: -1, saida: `${saida}\n${err.message}` });
    });
    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      resolve({ codigo, saida });
    });
  });
}

/** Baixa um arquivo para `destino`, avisando o progresso (0–100). */
async function baixar(url, destino, aoProgredir = () => {}) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`download falhou (HTTP ${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  const arquivo = fs.createWriteStream(destino);
  let recebido = 0;
  const leitor = r.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    recebido += value.length;
    if (!arquivo.write(Buffer.from(value))) await new Promise((ok) => arquivo.once('drain', ok));
    aoProgredir(total ? Math.round((recebido / total) * 100) : null, recebido);
  }
  await new Promise((ok, falhar) => arquivo.end((err) => (err ? falhar(err) : ok())));
  return destino;
}

/**
 * @param {object} o
 * @param {(p: {fase, texto, porcento?}) => void} o.emitir  progresso para a tela
 * @param {() => Promise<{ok}>} o.ligar  liga o Ollama e espera responder (ollama-runtime.localizarEIniciar)
 */
async function instalarOllama({ plataforma = process.platform, emitir = () => {}, ligar, atualizar = false, deps = {} } = {}) {
  const rodar = deps.executar || executar;
  const descarregar = deps.baixar || baixar;
  if (plataforma !== 'win32') {
    return {
      ok: false,
      manual: true,
      texto:
        plataforma === 'darwin'
          ? 'No Mac, baixe o Ollama em https://ollama.com/download e arraste para Aplicativos. Depois volte aqui e clique em "Verificar de novo".'
          : 'No Linux, rode no terminal: curl -fsSL https://ollama.com/install.sh | sh — depois volte aqui e clique em "Verificar de novo".',
    };
  }
  // 1. winget
  emitir({ fase: 'winget', texto: `${atualizar ? 'Atualizando' : 'Instalando'} pelo winget (pacote oficial Ollama.Ollama)…` });
  const w = await rodar('winget', [atualizar ? 'upgrade' : 'install', '--id', 'Ollama.Ollama', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], {
    aoLer: (linha) => emitir({ fase: 'winget', texto: linha.slice(0, 160) }),
  });
  const jaTinha = /already installed|já está instalado|nenhuma atualização|no available upgrade/i.test(w.saida);
  let instalado = w.codigo === 0 || jaTinha;
  // 2. instalador oficial
  if (!instalado) {
    emitir({ fase: 'download', texto: 'winget indisponível ou falhou — baixando o instalador oficial do Ollama…', porcento: 0 });
    const destino = path.join(os.tmpdir(), `OllamaSetup-${Date.now()}.exe`);
    try {
      await descarregar(URL_INSTALADOR_WINDOWS, destino, (porcento, bytes) =>
        emitir({ fase: 'download', texto: `Baixando o instalador… ${porcento != null ? `${porcento}%` : `${Math.round(bytes / 1e6)} MB`}`, porcento })
      );
    } catch (err) {
      return { ok: false, texto: `Não consegui baixar o instalador: ${err.message}. Baixe em https://ollama.com/download e rode você mesmo.` };
    }
    emitir({ fase: 'instalando', texto: 'Rodando o instalador do Ollama (pode levar um minuto)…' });
    const i = await rodar(destino, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
    try {
      fs.unlinkSync(destino); // o instalador temporário que o próprio AuGPT baixou
    } catch {
      /* fica na pasta temporária */
    }
    instalado = i.codigo === 0;
    if (!instalado) return { ok: false, texto: `O instalador terminou com erro (código ${i.codigo}). Tente rodar https://ollama.com/download manualmente.` };
  }
  emitir({ fase: 'ligando', texto: 'Ollama instalado. Ligando…' });
  const l = ligar ? await ligar() : { ok: true };
  return l?.ok === false || l?.online === false
    ? { ok: false, texto: 'O Ollama foi instalado, mas não respondeu. Abra o Ollama pelo menu Iniciar e clique em "Verificar de novo".' }
    : { ok: true, texto: 'Ollama instalado e ligado.', via: jaTinha ? 'ja-instalado' : w.codigo === 0 ? 'winget' : 'instalador' };
}

// "0.40.1" < "0.40.5"? Compara número a número; "v" na frente é ignorado.
function versaoMaisNova(a, b) {
  const partes = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Versão instalada (do Ollama rodando) e a mais recente publicada no GitHub.
async function versoesDoOllama(host, { buscar = fetch } = {}) {
  const ler = async (url) => {
    try {
      const r = await buscar(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'AuGPT' } });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const [local, ultima] = await Promise.all([ler(`${host.replace(/\/$/, '')}/api/version`), ler('https://api.github.com/repos/ollama/ollama/releases/latest')]);
  const instalada = local?.version || null;
  const disponivel = ultima?.tag_name ? ultima.tag_name.replace(/^v/, '') : null;
  return { instalada, disponivel, atualizar: !!(instalada && disponivel && versaoMaisNova(disponivel, instalada)) };
}

module.exports = { instalarOllama, versoesDoOllama, versaoMaisNova, baixar, URL_INSTALADOR_WINDOWS };
