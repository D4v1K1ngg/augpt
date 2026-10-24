'use strict';

/**
 * Ditado por voz (24/10, pedido do Davi): você fala, o AuGPT escreve. 100% local, com o whisper.cpp
 * (github.com/ggml-org/whisper.cpp) e o modelo Whisper large-v3-turbo quantizado — bom em português,
 * com pontuação, e reconhece sozinho se a fala é em português ou inglês.
 *
 * Roda no PROCESSADOR de propósito: a placa de vídeo fica com o modelo do Ollama (numa placa de 8 GB,
 * o Whisper na GPU empurrava o qwen para a RAM). Instala só no clique, em <dados>/componentes/ditado:
 * o binário e o modelo têm o SHA-256 conferido contra o publicado (fixo aqui, por versão).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { baixarConferindo } = require('./gerador-de-imagens');

// whisper.cpp 1.9.5 (build b5454, 06/10/2026) — binário para processador x64
const BINARIO = {
  versao: '1.9.5',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  bytes: 8928640,
};
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELOS = {
  turbo: { nome: 'Whisper large-v3-turbo', arquivo: 'ggml-large-v3-turbo-q5_0.bin', sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', bytes: 574041195 },
  // para processador fraco (até 4 núcleos): menos preciso, ~3x mais rápido
  pequeno: { nome: 'Whisper small', arquivo: 'ggml-small-q5_1.bin', sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', bytes: 190085487 },
};
const MB = (b) => `${Math.round(b / 1e6)} MB`;

/** O modelo para este PC: o turbo com 6 núcleos ou mais; senão, o pequeno. */
const modeloRecomendado = (nucleos = os.cpus().length) => (nucleos >= 6 ? 'turbo' : 'pequeno');
/** Quantos núcleos usar: deixa dois para o resto do PC. */
const nucleosParaUsar = (nucleos = os.cpus().length) => Math.max(2, Math.min(8, nucleos - 2));

/**
 * A janela de áudio do encoder (-ac): o Whisper sempre processa 30 s (1500); para fala curta, só o
 * tamanho dela mais 2 s de folga, em múltiplos de 64, entre 384 e 1500. Quanto menor, mais rápido.
 */
const janelaDeAudio = (segundos) => Math.min(1500, Math.max(384, Math.ceil((((Number(segundos) || 0) + 2) / 30) * 1500 / 64) * 64));

/** A saída do whisper-cli sem marcações: junta as linhas, tira "[BLANK_AUDIO]", "(música)" e afins. */
function limparTranscricao(saida) {
  return String(saida || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\[[\d:.\s>-]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\[(?:BLANK_AUDIO|MUSIC|silence|música|musica|aplausos|risos)[^\]]*\]|\((?:música|musica|music|silêncio|silence|aplausos|risos)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class Ditado {
  constructor(dirComponentes, { buscar = (...a) => fetch(...a), extrairZip, executar } = {}) {
    this.dir = path.join(dirComponentes, 'ditado');
    this.buscar = buscar;
    this.extrairZip = extrairZip || ((buffer, destino) => require('./searxng-runtime').extrairZipPara(buffer, destino));
    this.executar = executar || ((arquivo, args, opcoes) => new Promise((ok, falha) =>
      execFile(arquivo, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8', ...opcoes }, (err, stdout, stderr) =>
        err ? falha(Object.assign(new Error(String(stderr || err.message).trim().split('\n').pop().slice(0, 300)), { stderr })) : ok(stdout)
      )
    ));
  }

  /** O whisper-cli.exe dentro da pasta (o zip traz uma subpasta "Release"). */
  exe() {
    const procurar = (dir) => {
      if (!fs.existsSync(dir)) return null;
      for (const nome of fs.readdirSync(dir)) {
        const caminho = path.join(dir, nome);
        if (/^whisper-cli(\.exe)?$/i.test(nome)) return caminho;
        if (fs.statSync(caminho).isDirectory()) {
          const achado = procurar(caminho);
          if (achado) return achado;
        }
      }
      return null;
    };
    return procurar(path.join(this.dir, 'bin'));
  }

  modeloInstalado() {
    return Object.keys(MODELOS).find((id) => fs.existsSync(path.join(this.dir, 'modelos', MODELOS[id].arquivo))) || null;
  }

  instalado() {
    return Boolean(this.exe() && this.modeloInstalado());
  }

  estado() {
    const modelo = this.modeloInstalado();
    const recomendado = modeloRecomendado();
    return {
      instalado: this.instalado(),
      modelo: modelo ? MODELOS[modelo].nome : null,
      versao: this.exe() ? BINARIO.versao : null,
      recomendado,
      tamanho: MB(BINARIO.bytes + MODELOS[recomendado].bytes),
      nucleos: os.cpus().length,
    };
  }

  /** Baixa e confere o binário e o modelo (só no clique). `emitir({ texto, porcento })`. */
  async instalar({ modelo = modeloRecomendado(), emitir = () => {} } = {}) {
    if (process.platform !== 'win32') throw new Error('o ditado por voz, por enquanto, é só no Windows');
    const m = MODELOS[modelo] || MODELOS.turbo;
    fs.mkdirSync(path.join(this.dir, 'modelos'), { recursive: true });
    if (!this.exe()) {
      const zip = path.join(this.dir, 'whisper-bin-x64.zip');
      await baixarConferindo(BINARIO.url, zip, { sha256: BINARIO.sha256, buscar: this.buscar, emitir, rotulo: 'o whisper.cpp', total: BINARIO.bytes });
      const destino = path.join(this.dir, 'bin');
      fs.rmSync(destino, { recursive: true, force: true });
      this.extrairZip(fs.readFileSync(zip), destino);
      fs.rmSync(zip, { force: true });
      if (!this.exe()) throw new Error('o pacote baixado não tem o whisper-cli');
    }
    const arquivo = path.join(this.dir, 'modelos', m.arquivo);
    if (!fs.existsSync(arquivo)) await baixarConferindo(`${HF}/${m.arquivo}`, arquivo, { sha256: m.sha256, buscar: this.buscar, emitir, rotulo: `o modelo ${m.nome}`, total: m.bytes });
    emitir({ texto: 'Ditado por voz instalado ✓', porcento: 100 });
    return this.estado();
  }

  /**
   * Áudio WAV 16 kHz mono → texto. `idioma`: 'pt' ou 'en' (o da tela do AuGPT). Devolve { texto, ms }.
   * Medido no PC do Davi (24/10, 8 s de fala, 16 núcleos): 11,4 s → ~2 s com o idioma fixo (o "auto"
   * roda o encoder duas vezes, uma só para descobrir o idioma), a janela de áudio do tamanho da fala
   * (janelaDeAudio) e a busca simples (-bs 1 -bo 1); a transcrição saiu igual.
   */
  async transcrever(wav, { idioma = 'pt' } = {}) {
    const exe = this.exe();
    const modelo = this.modeloInstalado();
    if (!exe || !modelo) throw new Error('o ditado por voz não está instalado (Ajustes → Componentes)');
    const inicio = Date.now();
    const segundos = Math.max(0, (fs.statSync(wav).size - 44) / 32000); // 16 kHz × 16 bits × mono
    const args = ['-m', path.join(this.dir, 'modelos', MODELOS[modelo].arquivo), '-f', wav, '-l', idioma === 'en' ? 'en' : 'pt', '-t', String(nucleosParaUsar()), '-nt', '-np', '-ng', '-bs', '1', '-bo', '1', '-ac', String(janelaDeAudio(segundos))];
    const saida = await this.executar(exe, args, { cwd: path.dirname(exe) });
    return { texto: limparTranscricao(saida), ms: Date.now() - inicio };
  }
}

module.exports = { Ditado, MODELOS, BINARIO, limparTranscricao, janelaDeAudio, modeloRecomendado, nucleosParaUsar };
