'use strict';

/**
 * Reranker (22/11, Ajustes → Componentes, opcional): o bge-reranker-v2-m3 lê a pergunta e cada trecho juntos e reordena
 * os primeiros que o embedding escolheu. Medido (src/agent/embed-paginas.js): com o embeddinggemma, o trecho certo entre
 * os 5 primeiros foi de 29 para 31 de 31 e em 1º lugar de 20 para 25; 0,16 s para 20 trechos na placa.
 *
 * O Ollama não roda reranker: vai o llama-server do llama.cpp (versão FIXA, conferida pelo SHA-256 publicado pelo
 * GitHub — como o SearXNG, a mesma que foi medida) com o modelo do Hugging Face (SHA-256 do próprio site).
 * O servidor liga no primeiro uso, desliga depois de 5 minutos parado e nunca segura a pesquisa: fora do ar, lento ou
 * com erro, `reordenar` devolve null e fica a ordem do embedding.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { baixarConferindo } = require('./gerador-de-imagens');

const VERSAO = 'b12340';
const PROGRAMA = { nome: `llama-${VERSAO}-bin-win-vulkan-x64.zip`, url: `https://github.com/ggml-org/llama.cpp/releases/download/${VERSAO}/llama-${VERSAO}-bin-win-vulkan-x64.zip`, bytes: 38101437, sha256: 'a2c7a2bfaaf57b5357f84cf584603d088143a5be08c68cb623e6d9bb7db664e8' };
const MODELO = { nome: 'bge-reranker-v2-m3-Q8_0.gguf', url: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q8_0.gguf', bytes: 635676416, sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3' };
const OCIOSO_MS = 5 * 60 * 1000;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLivre() {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

class Reranker {
  constructor(dir, { buscar = (...a) => fetch(...a), plataforma = process.platform, extrairZip, iniciarProcesso = spawn } = {}) {
    this.dir = dir;
    this.bin = path.join(dir, 'bin');
    this.buscar = buscar;
    this.plataforma = plataforma;
    this.extrairZip = extrairZip || ((buffer, destino) => require('./searxng-runtime').extrairZipPara(buffer, destino));
    this.iniciarProcesso = iniciarProcesso;
    this.processo = null;
    this.url = null;
    this.ligando = null;
    this.relogio = null;
    this.ultimoErro = '';
  }

  get exe() {
    return path.join(this.bin, 'llama-server.exe');
  }
  get modelo() {
    return path.join(this.dir, MODELO.nome);
  }

  instalado() {
    try {
      return fs.existsSync(this.exe) && fs.statSync(this.modelo).size === MODELO.bytes;
    } catch {
      return false;
    }
  }

  estado() {
    return {
      instalado: this.instalado(),
      suportado: this.plataforma === 'win32',
      versao: VERSAO,
      tamanhoMB: Math.round((PROGRAMA.bytes + MODELO.bytes) / 1e6),
      rodando: !!this.processo,
      ultimoErro: this.ultimoErro,
      pasta: this.dir,
    };
  }

  /** Baixa o programa e o modelo (cada um conferido pelo SHA-256 antes de usar). */
  async instalar({ emitir = () => {} } = {}) {
    if (this.plataforma !== 'win32') throw new Error('por enquanto o reranker é instalado só no Windows');
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.exe)) {
      const zip = path.join(this.dir, PROGRAMA.nome);
      await baixarConferindo(PROGRAMA.url, zip, { sha256: PROGRAMA.sha256, buscar: this.buscar, emitir, rotulo: 'o programa (llama.cpp)', total: PROGRAMA.bytes });
      emitir({ texto: 'Extraindo…' });
      const novo = `${this.bin}.novo`;
      fs.rmSync(novo, { recursive: true, force: true });
      this.extrairZip(fs.readFileSync(zip), novo);
      fs.rmSync(zip, { force: true });
      if (!fs.existsSync(path.join(novo, 'llama-server.exe'))) throw new Error('o pacote baixado não tem o llama-server');
      fs.rmSync(this.bin, { recursive: true, force: true });
      fs.renameSync(novo, this.bin);
    }
    if (!this.instalado()) {
      await baixarConferindo(MODELO.url, this.modelo, { sha256: MODELO.sha256, buscar: this.buscar, emitir, rotulo: 'o modelo (bge-reranker-v2-m3)', total: MODELO.bytes });
    }
    emitir({ texto: 'Testando…' });
    const r = await this.reordenar('qual é a capital da França?', ['Paris é a capital da França.', 'O Brasil fica na América do Sul.'], { timeoutMs: 60000 });
    if (!r || !(r[0] > r[1])) throw new Error(`o reranker não respondeu no teste${this.ultimoErro ? `: ${this.ultimoErro}` : ''}`);
    emitir({ texto: 'Pronto.' });
    return this.estado();
  }

  remover() {
    this.parar();
    fs.rmSync(this.dir, { recursive: true, force: true });
    return this.estado();
  }

  async _ligar(placa = true) {
    const porta = await portaLivre();
    const args = ['-m', this.modelo, '--rerank', '--host', '127.0.0.1', '--port', String(porta), '-c', '8192', '-b', '8192', '-ub', '8192', '--parallel', '1', '-ngl', placa ? '99' : '0'];
    const p = this.iniciarProcesso(this.exe, args, { cwd: this.bin, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let saida = '';
    p.stderr?.on('data', (d) => (saida = (saida + d).slice(-2000)));
    p.on('exit', () => {
      if (this.processo === p) [this.processo, this.url] = [null, null];
    });
    const url = `http://127.0.0.1:${porta}`;
    for (let i = 0; i < 60; i += 1) {
      await pausa(250);
      if (p.exitCode !== null) break;
      const ok = await this.buscar(`${url}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);
      if (ok) {
        [this.processo, this.url] = [p, url];
        return;
      }
    }
    p.kill();
    throw new Error(`o servidor não ligou (${saida.trim().split('\n').pop() || 'sem resposta'})`);
  }

  async ligar() {
    if (this.url) return;
    // a placa cheia (o modelo principal ocupa quase tudo) não pode impedir: tenta no processador
    this.ligando ||= this._ligar(true).catch(() => this._ligar(false)).finally(() => (this.ligando = null));
    await this.ligando;
  }

  parar() {
    clearTimeout(this.relogio);
    this.processo?.kill();
    [this.processo, this.url] = [null, null];
  }

  /** Notas de relevância de cada texto para a consulta (maior = melhor), ou null se não deu. */
  async reordenar(consulta, textos, { timeoutMs = 8000 } = {}) {
    if (!this.instalado() || !textos.length) return null;
    try {
      await this.ligar();
      clearTimeout(this.relogio);
      this.relogio = setTimeout(() => this.parar(), OCIOSO_MS);
      this.relogio.unref?.();
      const r = await this.buscar(`${this.url}/v1/rerank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: String(consulta), documents: textos.map(String) }), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const notas = new Array(textos.length).fill(null);
      for (const x of j.results || []) notas[x.index] = x.relevance_score;
      if (notas.some((n) => typeof n !== 'number')) throw new Error('resposta incompleta');
      this.ultimoErro = '';
      return notas;
    } catch (err) {
      this.ultimoErro = err.message;
      return null;
    }
  }
}

// um servidor só para o app inteiro (o agente de cada conversa usa o mesmo)
const instancias = new Map();
function rerankerDe(userDataPath) {
  if (!userDataPath) return null;
  const dir = path.join(userDataPath, 'componentes', 'reranker');
  if (!instancias.has(dir)) instancias.set(dir, new Reranker(dir));
  return instancias.get(dir);
}
const pararTodos = () => instancias.forEach((r) => r.parar());

module.exports = { Reranker, rerankerDe, pararTodos, PROGRAMA, MODELO, VERSAO };
