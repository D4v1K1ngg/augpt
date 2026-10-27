'use strict';

/**
 * A voz do AuGPT (27/10, pedido do Davi: "estilo Jarvis"): o Kokoro-82M (Apache 2.0) no processador.
 * Medido no Ryzen 7 7800X3D: o modelo completo (fp32) fala 8,4× mais rápido que o tempo real — uma
 * frase de 6 s fica pronta em 0,75 s; o compacto (q8) só 1,9× (o motor faz int8 devagar no processador).
 *
 * Nada vem no instalador: em Ajustes → Geral → Voz do AuGPT, um clique baixa (com SHA-256 conferido)
 *   - o motor ONNX (onnxruntime-node, MIT, do npm) — só o binário do seu sistema fica (~34 MB);
 *   - o modelo (Hugging Face, revisão fixa) e as vozes.
 * O texto vira fonemas por src/fala/fonemas-pt-br.js (o kokoro-js só faz inglês); o tokenizador do Kokoro
 * é uma tabela símbolo → número, lida do tokenizer.json — sem o transformers.js.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { baixarConferindo } = require('../gerador-de-imagens');
const { textoEmFonemas } = require('./fonemas-pt-br');

const REV = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const HF = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${REV}`;
const ARQUIVOS = [
  { nome: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { nome: 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { nome: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  { nome: 'onnx/model.onnx', bytes: 325532232, sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb' },
  { nome: 'voices/pm_alex.bin', bytes: 522240, sha256: '0175c753f59c54e7fd5a995bedef0c5ff2fb67e0043dd3dcb2ae74ec2acbeb2a' },
  { nome: 'voices/pf_dora.bin', bytes: 522240, sha256: '3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee' },
  { nome: 'voices/pm_santa.bin', bytes: 522240, sha256: '8b012db3185778afe2e45a62cbad69db73021774fe68dda634bcc748a982eede' },
  { nome: 'voices/bm_george.bin', bytes: 522240, sha256: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc' },
];
// do npm (o sha512 do registro conferido em 27/10; aqui, o SHA-256 dos mesmos arquivos)
const MOTOR = [
  { pacote: 'onnxruntime-common', url: 'https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.21.0.tgz', bytes: 64246, sha256: '9c6126102b312514e64703c0922772974ee5c83e89eb345161226bcfeb67a22c' },
  { pacote: 'onnxruntime-node', url: 'https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.21.0.tgz', bytes: 80019455, sha256: 'c711a4048a8b460a70de25a5008b1628e3773878ef9deec1dd4a4ccab46de01a' },
];
const TAMANHO_MB = Math.round((ARQUIVOS.reduce((s, a) => s + a.bytes, 0) + MOTOR.reduce((s, m) => s + m.bytes, 0)) / 1e6);

const VOZES = {
  pm_alex: { nome: 'Alex — masculina, brasileira' },
  pf_dora: { nome: 'Dora — feminina, brasileira' },
  pm_santa: { nome: 'Santa — masculina, brasileira (mais grave)' },
  bm_george: { nome: 'George — sotaque britânico ("Jarvis")' },
};
const TAXA = 24000;

/* ------------------------------ o pacote do npm (.tgz) ------------------------------ */
/**
 * Extrai do .tgz só o que `quer(caminho)` aceita, sem carregar tudo na memória (o do onnxruntime-node tem
 * 218 MB descompactado, com os binários de todos os sistemas). Formato ustar/pax, o que o npm gera.
 */
function extrairTgz(arquivo, destino, quer) {
  return new Promise((ok, falha) => {
    let resto = Buffer.alloc(0);
    let estado = 'cabecalho'; // cabecalho → dados → enchimento → cabecalho…
    let faltam = 0;
    let enchimento = 0;
    let fd = null;
    let pax = null; // o conteúdo do cabeçalho pax (nome longo)
    let nomePax = null;
    const consumir = () => {
      for (;;) {
        if (estado === 'dados') {
          const n = Math.min(faltam, resto.length);
          if (n) {
            if (fd !== null) fs.writeSync(fd, resto, 0, n);
            if (pax) pax.push(Buffer.from(resto.subarray(0, n)));
            resto = resto.subarray(n);
            faltam -= n;
          }
          if (faltam > 0) return;
          if (fd !== null) fs.closeSync(fd);
          fd = null;
          if (pax) nomePax = (/\d+ path=([^\n]+)\n/.exec(Buffer.concat(pax).toString('utf8')) || [])[1] || null;
          pax = null;
          estado = 'enchimento';
          faltam = enchimento;
          continue;
        }
        if (estado === 'enchimento') {
          const n = Math.min(faltam, resto.length);
          resto = resto.subarray(n);
          faltam -= n;
          if (faltam > 0) return;
          estado = 'cabecalho';
          continue;
        }
        if (resto.length < 512) return;
        const cab = resto.subarray(0, 512);
        resto = resto.subarray(512);
        if (cab.every((b) => b === 0)) continue;
        const campo = (i, n) => cab.subarray(i, i + n).toString('utf8').replace(/\0[\s\S]*$/, '');
        const tamanho = parseInt(campo(124, 12).trim() || '0', 8);
        const tipo = String.fromCharCode(cab[156] || 48);
        const prefixo = campo(345, 155);
        const nome = (nomePax || (prefixo ? `${prefixo}/${campo(0, 100)}` : campo(0, 100))).replace(/^package\//, '');
        if (tipo !== 'x') nomePax = null;
        if (tipo === 'x') pax = [];
        else if ((tipo === '0' || tipo === '\0') && !nome.split('/').includes('..') && quer(nome)) {
          const alvo = path.join(destino, nome);
          fs.mkdirSync(path.dirname(alvo), { recursive: true });
          fd = fs.openSync(alvo, 'w');
        }
        estado = 'dados';
        faltam = tamanho;
        enchimento = (512 - (tamanho % 512)) % 512;
      }
    };
    fs.createReadStream(arquivo)
      .pipe(zlib.createGunzip())
      .on('data', (d) => {
        try {
          resto = resto.length ? Buffer.concat([resto, d]) : d;
          consumir();
        } catch (err) {
          falha(err);
        }
      })
      .on('end', () => {
        if (fd !== null) fs.closeSync(fd);
        ok();
      })
      .on('error', falha);
  });
}

/* ------------------------------ o que falar ------------------------------ */
/**
 * A resposta (markdown) vira o que se fala: sem código, tabela, link, imagem, citação e a lista de fontes;
 * resposta longa fica nas primeiras frases (~450 caracteres) e avisa que o resto está na tela.
 */
function textoParaFalar(markdown, { maximo = 450 } = {}) {
  let t = String(markdown || '')
    .split(/\n-{3,}\s*\n/)[0] // "---\n**Fontes**"
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\(?\d+\)?\]\([^)]*\)/g, '') // [(8)](url): citação
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\{yt:[^}]*\}/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // tabela
    .replace(/\[\d+\]/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~>]/g, '')
    .replace(/⚠/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/:\./g, ':')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
  if (t.length <= maximo) return t;
  const frases = t.split(/(?<=[.!?…])\s+/).map((f) => `${f} `);
  let dito = '';
  for (const f of frases) {
    if ((dito + f).length > maximo && dito) break;
    dito += f;
  }
  return `${dito.trim()} Os detalhes estão na tela.`;
}

/** Frases de até ~220 caracteres (o Kokoro aceita até 510 fonemas por vez; frase curta começa a falar antes). */
function frasesParaFalar(texto) {
  // só pontuação seguida de espaço encerra a frase (27/10: "R$ 6.999,90" e "teclado.txt" eram cortados no ponto)
  const frases = String(texto || '').split(/(?<=[.!?;…])\s+/);
  const saida = [];
  for (let f of frases.map((x) => x.trim()).filter(Boolean)) {
    while (f.length > 220) {
      const corte = Math.max(f.lastIndexOf(', ', 220), f.lastIndexOf(' ', 200));
      saida.push(f.slice(0, corte > 60 ? corte + 1 : 220).trim());
      f = f.slice(corte > 60 ? corte + 1 : 220).trim();
    }
    if (f) saida.push(f);
  }
  return saida;
}

/* ------------------------------ a voz ------------------------------ */
class Voz {
  /** @param dir pasta do componente (userData/componentes/voz) */
  constructor(dir, { buscar = (...a) => fetch(...a) } = {}) {
    this.dir = dir;
    this.modelo = path.join(dir, 'kokoro');
    this.motor = path.join(dir, 'node_modules');
    this.buscar = buscar;
    this.instalando = false;
    this.sessao = null;
    this.vocab = null;
    this.estilos = new Map();
  }

  binario() {
    return path.join(this.motor, 'onnxruntime-node', 'bin', 'napi-v3', process.platform, process.arch, 'onnxruntime_binding.node');
  }

  instalada() {
    return ARQUIVOS.every((a) => fs.existsSync(path.join(this.modelo, a.nome))) && fs.existsSync(this.binario()) && fs.existsSync(path.join(this.motor, 'onnxruntime-common', 'package.json'));
  }

  estado() {
    return { instalada: this.instalada(), instalando: this.instalando, tamanhoMB: TAMANHO_MB, carregada: Boolean(this.sessao), vozes: VOZES };
  }

  /** Um clique em Ajustes: baixa e confere tudo; o que já está certo não baixa de novo. */
  async instalar({ emitir = () => {} } = {}) {
    if (this.instalando) throw new Error('a instalação já está em andamento');
    this.instalando = true;
    try {
      fs.mkdirSync(this.modelo, { recursive: true });
      for (const a of ARQUIVOS) {
        const alvo = path.join(this.modelo, a.nome);
        if (fs.existsSync(alvo) && fs.statSync(alvo).size === a.bytes) continue;
        fs.mkdirSync(path.dirname(alvo), { recursive: true });
        await baixarConferindo(`${HF}/${a.nome}`, alvo, { sha256: a.sha256, buscar: this.buscar, emitir, rotulo: a.nome === 'onnx/model.onnx' ? 'o modelo de voz (Kokoro)' : a.nome, total: a.bytes });
      }
      const plataforma = `bin/napi-v3/${process.platform}/${process.arch}/`;
      for (const m of MOTOR) {
        const pronto = m.pacote === 'onnxruntime-node' ? fs.existsSync(this.binario()) : fs.existsSync(path.join(this.motor, m.pacote, 'package.json'));
        if (pronto) continue;
        const tgz = path.join(this.dir, `${m.pacote}.tgz`);
        await baixarConferindo(m.url, tgz, { sha256: m.sha256, buscar: this.buscar, emitir, rotulo: `o motor da voz (${m.pacote})`, total: m.bytes });
        emitir({ texto: `Extraindo ${m.pacote}…`, porcento: null });
        // só o que roda aqui: o JavaScript e o binário deste sistema
        await extrairTgz(tgz, path.join(this.motor, m.pacote), (nome) => nome === 'package.json' || nome.startsWith('dist/') || nome.startsWith(plataforma));
        fs.rmSync(tgz, { force: true });
      }
      if (!this.instalada()) throw new Error(`o motor não tem binário para ${process.platform}/${process.arch}`);
      emitir({ texto: 'Voz pronta ✓', porcento: 100 });
      return this.estado();
    } finally {
      this.instalando = false;
    }
  }

  /** Carrega o modelo uma vez (~0,5 s com ele no disco). */
  async carregar() {
    if (this.sessao) return;
    if (!this.instalada()) throw new Error('a voz não está instalada (Ajustes → Geral → Voz do AuGPT)');
    const ort = require(path.join(this.motor, 'onnxruntime-node'));
    this.ort = ort;
    this.sessao = await ort.InferenceSession.create(path.join(this.modelo, 'onnx', 'model.onnx'), { executionProviders: ['cpu'] });
    this.vocab = JSON.parse(fs.readFileSync(path.join(this.modelo, 'tokenizer.json'), 'utf8')).model.vocab;
  }

  estilo(voz) {
    const nome = VOZES[voz] ? voz : 'pm_alex';
    if (!this.estilos.has(nome)) {
      const b = fs.readFileSync(path.join(this.modelo, 'voices', `${nome}.bin`));
      this.estilos.set(nome, new Float32Array(b.buffer, b.byteOffset, b.length / 4));
    }
    return this.estilos.get(nome);
  }

  /** Fonemas → números (o tokenizador do Kokoro: um símbolo por vez, "$" no começo e no fim). */
  ids(fonemas) {
    const lista = [...String(fonemas)].map((c) => this.vocab[c]).filter((n) => n !== undefined).slice(0, 508);
    return [0, ...lista, 0];
  }

  /** Uma frase → áudio (Float32Array, 24 kHz). */
  async sintetizar(frase, { voz = 'pm_alex', velocidade = 1 } = {}) {
    await this.carregar();
    const ids = this.ids(textoEmFonemas(frase));
    if (ids.length <= 2) return new Float32Array(0);
    const estilo = this.estilo(voz);
    const deslocamento = 256 * Math.min(Math.max(ids.length - 2, 0), 509);
    const { Tensor } = this.ort;
    const saida = await this.sessao.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      style: new Tensor('float32', estilo.slice(deslocamento, deslocamento + 256), [1, 256]),
      speed: new Tensor('float32', Float32Array.of(Math.min(1.5, Math.max(0.7, Number(velocidade) || 1))), [1]),
    });
    return saida.waveform.data;
  }

  /** Frase por frase: a 1ª fica pronta em menos de 1 s e já pode tocar enquanto as outras são geradas. */
  async *falar(texto, opcoes = {}) {
    for (const frase of frasesParaFalar(texto)) {
      if (opcoes.cancelado?.()) return;
      const pcm = await this.sintetizar(frase, opcoes);
      if (pcm.length) yield { frase, pcm };
    }
  }
}

module.exports = { Voz, VOZES, TAXA, textoParaFalar, frasesParaFalar, extrairTgz, ARQUIVOS, MOTOR };
