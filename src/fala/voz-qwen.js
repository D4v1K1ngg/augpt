'use strict';

/**
 * A voz natural do AuGPT (1/11, pedido do Davi): o Qwen3-TTS 0.6B CustomVoice (Apache 2.0), na placa de vídeo, com
 * as 9 vozes prontas falando português. Medido numa RTX 3060 Ti: 1,4x o tempo real com a aceleração de
 * src/fala/qwen/servidor.py (antes, 0,55x) e pronto para falar ~9 s depois de iniciar.
 *
 * Componente opcional (Ajustes → Voz do AuGPT), só no clique e só no Windows com placa NVIDIA. Tudo dentro da
 * pasta do componente — nada no Python do sistema:
 *   - uv (o instalador de Python da Astral, um .exe; SHA-256 conferido) baixa um Python 3.11 próprio;
 *   - PyTorch 2.6 (CUDA 12.4) e qwen-tts 0.1.1, em versões fixas;
 *   - o modelo, numa revisão fixa do Hugging Face.
 *
 * Como ele divide a placa com o modelo principal (medido: os dois juntos, o 9b cai de 53 para 20 tokens/s): a
 * voz natural só gera quando o modelo principal não está escrevendo. Enquanto ele escreve, as confirmações
 * ("Deixa comigo") tocam de frases já gravadas; a narração falada fica só no chat. O processo da voz liga
 * quando é preciso e desliga depois de 15 minutos sem falar — a placa fica livre.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { baixarConferindo } = require('../gerador-de-imagens');

const UV = {
  versao: '0.13.0',
  url: 'https://github.com/astral-sh/uv/releases/download/0.13.0/uv-x86_64-pc-windows-msvc.zip',
  bytes: 15722003,
  sha256: '088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c',
};
const PYTHON = '3.11';
const TORCH = ['torch==2.6.0', 'torchaudio==2.6.0'];
const INDICE_TORCH = 'https://download.pytorch.org/whl/cu124';
const PACOTES = ['qwen-tts==0.1.1', 'transformers==4.57.3', 'accelerate==1.12.0', 'huggingface_hub==0.36.2', 'hf_xet==1.8.0', 'numpy<2.5'];
const MODELO = { repo: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice', revisao: '85e237c12c027371202489a0ec509ded67b5e4b5' };
const TAMANHO_GB = 7;
const OCIOSO_MS = 15 * 60 * 1000;

/** As 9 vozes prontas (nenhuma é brasileira de origem; todas falam português — conferido pelo Whisper em 1/11). */
const VOZES_NATURAIS = {
  'qwen:ryan': { nome: 'Ryan — masculina, natural (sotaque inglês)' },
  'qwen:aiden': { nome: 'Aiden — masculina, natural (sotaque americano)' },
  'qwen:eric': { nome: 'Eric — masculina, natural, um pouco rouca' },
  'qwen:dylan': { nome: 'Dylan — masculina, natural, jovem' },
  'qwen:uncle_fu': { nome: 'Uncle Fu — masculina, natural, grave e madura' },
  'qwen:serena': { nome: 'Serena — feminina, natural, calma' },
  'qwen:vivian': { nome: 'Vivian — feminina, natural, viva' },
  'qwen:sohee': { nome: 'Sohee — feminina, natural, expressiva' },
  'qwen:ono_anna': { nome: 'Ono Anna — feminina, natural, leve' },
};

/** As frases ditas enquanto o modelo principal escreve — gravadas uma vez por voz (as de renderer/fala.js, sem o nome). */
const FRASES_PRONTAS = [
  'Claro, já vejo isso pra você.', 'Deixa comigo.', 'Pode deixar, vou dar uma olhada.', 'Boa pergunta! Um instante.',
  'Certo, já estou nisso.', 'Só um momento, vou verificar.', 'Já vejo isso pra você.', 'Vou dar uma olhada.',
  'Bom dia!', 'Boa tarde!', 'Boa noite!',
];

const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const chave = (t) => semAcento(t).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * "Bom dia, Davi! Claro, Davi, já vejo isso pra você." → { saudacao: 'Bom dia!', resto: 'Claro, já vejo isso pra você.' }:
 * a saudação da hora e o nome saem, para casar com as frases gravadas.
 */
function separarFrasePronta(texto, nome = '') {
  let t = String(texto || '').trim();
  const s = /^(Bom dia|Boa tarde|Boa noite)(?:,\s*[^!.]{1,30})?!\s*/i.exec(t);
  t = s ? t.slice(s[0].length) : t;
  if (nome) t = t.replace(new RegExp(`,\\s*${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[,.!?])`, 'g'), '').replace(new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*`), '');
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  return { saudacao: s ? `${cap(s[1].toLowerCase())}!` : '', resto: cap(t.trim()) };
}

/**
 * Pedaços curtos para a voz natural (1/11, teste no app: a 1ª frase da resposta tinha 220 letras = 16 s de fala, e
 * gerar isso leva ~12 s antes de tocar qualquer coisa). Cada frase vira pedaços de até ~120 letras, cortados na
 * vírgula; e a primeira fala é curta (até a 1ª vírgula depois de ~25 letras) — começa a tocar em ~2 s e o resto é
 * gerado enquanto ela fala.
 */
function pedacosNaturais(texto, { primeiro = true, maximo = 120 } = {}) {
  const saida = [];
  // as frases pela pontuação seguida de espaço (o "R$ 6.999,90" não corta), sem o corte de 220 letras do Kokoro
  for (let f of String(texto || '').split(/(?<=[.!?;…])\s+/).map((x) => x.trim()).filter(Boolean)) {
    if (primeiro && !saida.length && f.length > 70) {
      const v = f.indexOf(', ', 25);
      if (v > 0 && v < 90) {
        saida.push(f.slice(0, v + 1).trim());
        f = f.slice(v + 1).trim();
      }
    }
    while (f.length > maximo) {
      const corte = Math.max(f.lastIndexOf(', ', maximo), f.lastIndexOf('; ', maximo));
      const ponto = corte > 40 ? corte + 1 : Math.max(f.lastIndexOf(' ', maximo - 10), 40);
      saida.push(f.slice(0, ponto).trim());
      f = f.slice(ponto).trim();
    }
    if (f) saida.push(f);
  }
  return saida;
}

class VozQwen {
  /** @param dir <dados>/componentes/voz-natural */
  constructor(dir, { buscar = (...a) => fetch(...a), servidorFonte = path.join(__dirname, 'qwen', 'servidor.py'), processo = spawn } = {}) {
    this.dir = dir;
    this.buscar = buscar;
    this.servidorFonte = servidorFonte;
    this.processo = processo;
    this.instalando = false;
    this.progresso = '';
    this.proc = null;
    this.pronto = null; // a promessa de "pronto"
    this.espera = new Map(); // id → { ok, falha }
    this.proximo = 1;
    this.relogio = null;
  }

  caminho(...partes) {
    return path.join(this.dir, ...partes);
  }
  get python() {
    return this.caminho('venv', 'Scripts', 'python.exe');
  }
  get pastaDoModelo() {
    return this.caminho('modelo');
  }

  suportado(gpus = []) {
    return process.platform === 'win32' && gpus.some((g) => /nvidia|geforce|rtx|gtx|quadro/i.test(String(g?.nome || g)));
  }

  instalada() {
    return fs.existsSync(this.caminho('pronto.json')) && fs.existsSync(this.python) && fs.existsSync(path.join(this.pastaDoModelo, 'model.safetensors'));
  }

  estado(gpus) {
    return { instalada: this.instalada(), instalando: this.instalando, progresso: this.progresso, suportado: gpus ? this.suportado(gpus) : process.platform === 'win32', tamanhoGB: TAMANHO_GB, ligada: Boolean(this.proc), vozes: VOZES_NATURAIS };
  }

  /** Um programa do componente, com tudo (Python, cache) dentro da pasta dele. */
  rodar(exe, args, { emitir, rotulo } = {}) {
    const env = {
      ...process.env,
      UV_PYTHON_INSTALL_DIR: this.caminho('python'),
      // sempre o Python do componente (1/11, no teste o uv pegou o 3.11 do sistema: desinstalá-lo quebraria a voz)
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_CACHE_DIR: this.caminho('cache'),
      UV_NO_CONFIG: '1',
      HF_HOME: this.caminho('cache', 'hf'),
      HF_HUB_DISABLE_TELEMETRY: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    return new Promise((ok, falha) => {
      const p = this.processo(exe, args, { env, windowsHide: true });
      let erro = '';
      const ler = (d) => {
        const linhas = String(d).split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean);
        for (const l of linhas) {
          // "Downloading torch (2.4GiB)", "Installed 42 packages", "Fetching 4 files: 50%…"
          const m = /Downloading ([\w.-]+) \(([\d.]+\s*[KMG]iB)\)|Installed \d+ packages?|Fetching \d+ files: +\d+%/.exec(l);
          if (m) emitir?.({ texto: `${rotulo}: ${m[1] ? `baixando ${m[1]} (${m[2]})` : l.replace(/\|.*$/, '').trim()}` });
          erro = `${erro}\n${l}`.slice(-1500);
        }
      };
      p.stdout?.on('data', ler);
      p.stderr?.on('data', ler);
      p.on('error', falha);
      p.on('exit', (codigo) => (codigo === 0 ? ok() : falha(new Error(`${rotulo} falhou (código ${codigo}): ${erro.split('\n').filter(Boolean).slice(-3).join(' · ')}`))));
    });
  }

  async instalar({ emitir = () => {}, gpus = [] } = {}) {
    if (this.instalando) throw new Error('a instalação já está em andamento');
    if (!this.suportado(gpus)) throw new Error('a voz natural precisa do Windows com uma placa de vídeo NVIDIA');
    this.instalando = true;
    const avisar = (p) => {
      this.progresso = p.texto;
      emitir(p);
    };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // 1. o uv (conferido pelo SHA-256)
      const zip = this.caminho('uv.zip');
      const uvExe = this.caminho('uv', 'uv.exe');
      if (!fs.existsSync(uvExe)) {
        await baixarConferindo(UV.url, zip, { sha256: UV.sha256, buscar: this.buscar, emitir: avisar, rotulo: 'o instalador do Python (uv)', total: UV.bytes });
        fs.mkdirSync(this.caminho('uv'), { recursive: true });
        const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        await new Promise((ok, falha) => execFile(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', this.caminho('uv')], { windowsHide: true }, (e) => (e ? falha(e) : ok())));
        fs.rmSync(zip, { force: true });
        if (!fs.existsSync(uvExe)) throw new Error('o uv não veio no pacote');
      }
      // 2. o Python e o ambiente (dentro da pasta)
      avisar({ texto: 'Preparando o Python…' });
      if (!fs.existsSync(this.python)) await this.rodar(uvExe, ['venv', '--python', PYTHON, this.caminho('venv')], { emitir: avisar, rotulo: 'Python' });
      // 3. PyTorch com CUDA e o qwen-tts (o maior pedaço: ~3 GB)
      avisar({ texto: 'Baixando o PyTorch (cerca de 3 GB)…' });
      await this.rodar(uvExe, ['pip', 'install', '--python', this.python, ...TORCH, '--index-url', INDICE_TORCH], { emitir: avisar, rotulo: 'PyTorch' });
      avisar({ texto: 'Baixando o Qwen3-TTS…' });
      await this.rodar(uvExe, ['pip', 'install', '--python', this.python, ...PACOTES], { emitir: avisar, rotulo: 'Qwen3-TTS' });
      // 4. o modelo (revisão fixa)
      avisar({ texto: 'Baixando o modelo de voz (cerca de 1,8 GB)…' });
      await this.rodar(this.python, ['-c', `from huggingface_hub import snapshot_download; snapshot_download(${JSON.stringify(MODELO.repo)}, revision=${JSON.stringify(MODELO.revisao)}, local_dir=${JSON.stringify(this.pastaDoModelo)})`], { emitir: avisar, rotulo: 'modelo' });
      // 5. o cache dos pacotes já não serve (uns 3 GB): sai
      await this.rodar(uvExe, ['cache', 'clean'], { rotulo: 'limpeza' }).catch(() => {});
      fs.rmSync(this.caminho('cache'), { recursive: true, force: true });
      // 6. o teste: liga e fala uma frase
      avisar({ texto: 'Testando a voz…' });
      const pcm = await this.gerar('Pronto. Agora eu falo com a voz natural.', 'ryan', { semMarca: true });
      if (!pcm.length) throw new Error('a voz não gerou áudio no teste');
      fs.writeFileSync(this.caminho('pronto.json'), JSON.stringify({ em: new Date().toISOString(), uv: UV.versao, modelo: MODELO, torch: TORCH, pacotes: PACOTES }, null, 2));
      avisar({ texto: 'Voz natural instalada ✓' });
      return this.estado(gpus);
    } finally {
      this.instalando = false;
    }
  }

  /** Apaga o componente (clique em "Remover", com confirmação na tela). */
  async remover() {
    this.parar();
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /* ------------------------------ o processo da voz ------------------------------ */

  iniciar() {
    if (this.pronto) return this.pronto;
    // o servidor vem do app (que pode estar dentro do .asar): uma cópia na pasta do componente, para o Python ler
    const servidor = this.caminho('servidor.py');
    const fonte = fs.readFileSync(this.servidorFonte);
    if (!fs.existsSync(servidor) || !fs.readFileSync(servidor).equals(fonte)) fs.writeFileSync(servidor, fonte);
    this.pronto = new Promise((ok, falha) => {
      const p = this.processo(this.python, ['-u', servidor, this.pastaDoModelo], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', HF_HOME: this.caminho('cache', 'hf') }, windowsHide: true });
      this.proc = p;
      let buffer = '';
      let erro = '';
      const limite = setTimeout(() => falha(new Error('a voz natural demorou demais para iniciar')), 180000);
      p.stdout.on('data', (d) => {
        buffer += d;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const linha = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          let j;
          try {
            j = JSON.parse(linha);
          } catch {
            continue;
          }
          if (j.pronto) {
            clearTimeout(limite);
            this.taxa = j.taxa;
            ok(j);
            continue;
          }
          const quem = this.espera.get(j.id);
          if (!quem) continue;
          this.espera.delete(j.id);
          if (j.erro) quem.falha(new Error(j.erro));
          else {
            const b = Buffer.from(j.pcm || '', 'base64');
            quem.ok(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
          }
        }
      });
      p.stderr.on('data', (d) => (erro = `${erro}${d}`.slice(-2000)));
      p.on('exit', (codigo) => {
        clearTimeout(limite);
        const motivo = new Error(`a voz natural parou (código ${codigo}): ${erro.split(/\r?\n/).filter(Boolean).slice(-2).join(' · ')}`);
        for (const quem of this.espera.values()) quem.falha(motivo);
        this.espera.clear();
        this.proc = null;
        this.pronto = null;
        falha(motivo);
      });
    });
    this.pronto.catch(() => {});
    return this.pronto;
  }

  parar() {
    clearTimeout(this.relogio);
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
    }
    this.proc = null;
    this.pronto = null;
  }

  /** Desliga depois de 15 min sem falar (a placa fica livre para o modelo principal). */
  marcarUso() {
    clearTimeout(this.relogio);
    this.relogio = setTimeout(() => this.parar(), OCIOSO_MS);
    this.relogio.unref?.();
  }

  /** O áudio de uma frase (Float32, 24 kHz). */
  async gerar(texto, voz = 'ryan', { semMarca = false } = {}) {
    await this.iniciar();
    if (!semMarca) this.marcarUso();
    const id = this.proximo++;
    return new Promise((ok, falha) => {
      this.espera.set(id, { ok, falha });
      this.proc.stdin.write(`${JSON.stringify({ id, texto: String(texto).slice(0, 600), voz })}\n`);
    });
  }

  /** Frase por frase, como o Kokoro: { frase, pcm } — em pedaços curtos (pedacosNaturais). */
  async *falar(texto, { voz = 'ryan', cancelado, primeiro = true } = {}) {
    for (const frase of pedacosNaturais(texto, { primeiro })) {
      if (cancelado?.()) return;
      const pcm = await this.gerar(frase, voz);
      if (pcm.length) yield { frase, pcm };
    }
  }

  /* ------------------------------ as frases já gravadas ------------------------------ */

  arquivoDaFrase(voz, texto) {
    return this.caminho('frases', voz, `${crypto.createHash('sha1').update(chave(texto)).digest('hex').slice(0, 16)}.f32`);
  }

  /** Grava as frases prontas da voz (uma vez; com o modelo principal parado). */
  async prepararFrases(voz, { ocupado = () => false } = {}) {
    for (const f of FRASES_PRONTAS) {
      const arq = this.arquivoDaFrase(voz, f);
      if (fs.existsSync(arq)) continue;
      if (ocupado()) return false;
      const pcm = await this.gerar(f, voz);
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    }
    return true;
  }

  /** O áudio gravado de uma frase pronta (com a saudação na frente, se houver), ou null. */
  frasePronta(texto, voz, nome = '') {
    const { saudacao, resto } = separarFrasePronta(texto, nome);
    const ler = (t) => {
      const alvo = chave(t);
      const f = FRASES_PRONTAS.find((x) => chave(x) === alvo);
      const arq = f && this.arquivoDaFrase(voz, f);
      if (!arq || !fs.existsSync(arq)) return null;
      const b = fs.readFileSync(arq);
      return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    };
    const corpo = resto ? ler(resto) : new Float32Array(0);
    if (!corpo) return null;
    const oi = saudacao ? ler(saudacao) : null;
    if (!oi) return corpo;
    const junto = new Float32Array(oi.length + 4800 + corpo.length); // 0,2 s entre as duas
    junto.set(oi, 0);
    junto.set(corpo, oi.length + 4800);
    return junto;
  }
}

module.exports = { VozQwen, VOZES_NATURAIS, FRASES_PRONTAS, separarFrasePronta, pedacosNaturais, UV, MODELO, TAMANHO_GB };
