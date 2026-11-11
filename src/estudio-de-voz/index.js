'use strict';

/**
 * Estúdio de voz (11/11, pedido do Davi): texto → arquivo de áudio, com o Qwen3-TTS e o OmniVoice, e todos os
 * ajustes que os modelos aceitam (voz pronta, voz descrita, clonagem, temperatura, passos…) mais os do
 * ffmpeg por cima (velocidade, tom, volume, pausa entre partes, formato) e a legenda .srt.
 *
 * Medido na RTX 5070 Ti (11/11, 3 textos em português, conferidos pelo Whisper): OmniVoice 6–18× o tempo real,
 * ~2 GB na placa, 5% de palavras erradas no texto técnico; Qwen3-TTS 1.7B ~0,5× (mais lento que a fala, sem o
 * flash-attn no Windows), ~4,5 GB, 11%. O Kokoro (a voz do chat) continua para ler as respostas.
 *
 * Cada motor tem o seu ambiente Python (as versões do transformers brigam: o qwen-tts pede 4.57, o omnivoice
 * 5.x), instalado pelo `uv` — que baixa o Python e o PyTorch com CUDA. Instalação só no clique; o `uv` é
 * conferido pelo SHA-256 publicado no GitHub. Os modelos vêm do Hugging Face na 1ª geração (pasta hf).
 *
 * Pasta: <pasta>/{uv, qwen, omni, hf, vozes, servidor.py}. Pode ficar em outro disco (Ajustes).
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { textoParaFalar } = require('../fala/voz');
const { porExtenso } = require('../fala/fonemas-pt-br');

// uv 0.13.5 (22/10/2026) — SHA-256 do próprio GitHub (campo digest do arquivo da versão)
const UV = {
  url: 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip',
  sha256: 'a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a',
  bytes: 15264056,
};

const IDIOMAS = [
  ['auto', 'Automático'], ['portuguese', 'Português'], ['english', 'Inglês'], ['spanish', 'Espanhol'], ['french', 'Francês'], ['german', 'Alemão'],
  ['italian', 'Italiano'], ['japanese', 'Japonês'], ['korean', 'Coreano'], ['chinese', 'Chinês'], ['russian', 'Russo'],
];

/** O que cada motor aceita: a tela monta os controles por esta lista (o servidor.py lê as mesmas chaves). */
const MOTORES = {
  omni: {
    nome: 'OmniVoice',
    resumo: 'Rápido (6–18× o tempo real), ~2 GB na placa, 600+ idiomas. Voz descrita por atributos ou clonada.',
    pacotes: ['omnivoice', 'soundfile'],
    gb: 9,
    modos: [['descrita', 'Voz descrita'], ['clonar', 'Clonar uma voz'], ['automatica', 'O modelo escolhe']],
    // os atributos que o OmniVoice entende (omnivoice/utils/voice_design.py), em grupos que se excluem
    descricao: {
      gênero: [['male', 'masculina'], ['female', 'feminina']],
      idade: [['child', 'criança'], ['teenager', 'adolescente'], ['young adult', 'jovem adulto'], ['middle-aged', 'meia-idade'], ['elderly', 'idoso']],
      tom: [['very low pitch', 'muito grave'], ['low pitch', 'grave'], ['moderate pitch', 'médio'], ['high pitch', 'agudo'], ['very high pitch', 'muito agudo']],
      estilo: [['whisper', 'sussurro']],
      sotaque: [['portuguese accent', 'português'], ['american accent', 'americano'], ['british accent', 'britânico'], ['australian accent', 'australiano'], ['canadian accent', 'canadense'], ['indian accent', 'indiano'], ['russian accent', 'russo'], ['japanese accent', 'japonês'], ['korean accent', 'coreano'], ['chinese accent', 'chinês']],
    },
    // sons no meio do texto: [laughter] etc. (omnivoice.py, _NONVERBAL_PATTERN)
    marcas: [['[laughter]', 'risada'], ['[sigh]', 'suspiro'], ['[surprise-oh]', 'surpresa "oh"'], ['[surprise-ah]', 'surpresa "ah"'], ['[question-ah]', 'dúvida "ah?"'], ['[dissatisfaction-hnn]', 'insatisfação "hum"'], ['[confirmation-en]', 'confirmação "uhum"']],
    parametros: [
      { chave: 'velocidadeDoModelo', rotulo: 'Ritmo da fala (do modelo)', min: 0.5, max: 2, passo: 0.05, padrao: 1, ajuda: 'O próprio modelo fala mais rápido ou mais devagar (soa mais natural que acelerar o áudio).' },
      { chave: 'duracao', rotulo: 'Duração fixa (s)', min: 0, max: 120, passo: 0.5, padrao: 0, ajuda: '0 = o modelo decide. Útil para encaixar a fala num trecho do vídeo (vale por parte).' },
      { chave: 'passos', rotulo: 'Passos de geração', min: 8, max: 64, passo: 1, padrao: 32, ajuda: 'Mais passos = mais qualidade e mais tempo.' },
      { chave: 'guia', rotulo: 'Força da voz pedida (guidance)', min: 0, max: 5, passo: 0.1, padrao: 2, ajuda: 'Quanto o modelo segue a descrição ou a voz clonada.' },
      { chave: 'temperatura', rotulo: 'Variação (temperatura)', min: 0, max: 2, passo: 0.05, padrao: 0, ajuda: '0 = sempre igual; mais alto = mais variação de entonação.' },
      { chave: 'temperaturaDePosicao', rotulo: 'Temperatura de posição', min: 0, max: 10, passo: 0.1, padrao: 5, avancado: true },
      { chave: 'deslocamento', rotulo: 'Deslocamento do tempo (t_shift)', min: 0.01, max: 1, passo: 0.01, padrao: 0.1, avancado: true },
      { chave: 'penalidadeDeCamada', rotulo: 'Penalidade de camada', min: 0, max: 10, passo: 0.1, padrao: 5, avancado: true },
      { chave: 'margem', rotulo: 'Silêncio nas pontas (s)', min: 0, max: 1, passo: 0.05, padrao: 0.1, avancado: true },
      { chave: 'suavizar', rotulo: 'Entrada/saída suave (s)', min: 0, max: 1, passo: 0.05, padrao: 0.1, avancado: true },
      { chave: 'limparRuido', rotulo: 'Limpar ruído', tipo: 'sim', padrao: true, avancado: true },
      { chave: 'posProcessar', rotulo: 'Cortar silêncio e suavizar', tipo: 'sim', padrao: true, avancado: true },
    ],
  },
  qwen: {
    nome: 'Qwen3-TTS',
    resumo: 'Mais lento (~0,5× o tempo real), ~4,5 GB. Vozes prontas com instrução de emoção, voz descrita em texto livre e clonagem.',
    pacotes: ['qwen-tts', 'soundfile'],
    gb: 15,
    modos: [['pronta', 'Voz pronta'], ['descrita', 'Voz descrita (texto livre)'], ['clonar', 'Clonar uma voz']],
    // as 9 vozes do CustomVoice (o idioma é o de origem de cada uma; todas falam os 10 idiomas, com sotaque)
    vozes: [
      ['ryan', 'Ryan — masculina, dinâmica (inglês)'], ['aiden', 'Aiden — masculina, solar, americana (inglês)'],
      ['uncle_fu', 'Uncle Fu — masculina, madura e grave (chinês)'], ['dylan', 'Dylan — masculina, jovem (chinês)'], ['eric', 'Eric — masculina, animada (chinês)'],
      ['vivian', 'Vivian — feminina, jovem e brilhante (chinês)'], ['serena', 'Serena — feminina, calorosa e suave (chinês)'],
      ['ono_anna', 'Ono Anna — feminina, brincalhona (japonês)'], ['sohee', 'Sohee — feminina, calorosa (coreano)'],
    ],
    tamanhos: [['1.7B', '1.7B (melhor, aceita instrução)'], ['0.6B', '0.6B (mais leve)']],
    parametros: [
      { chave: 'temperatura', rotulo: 'Variação (temperatura)', min: 0.1, max: 1.5, passo: 0.05, padrao: 0.9 },
      { chave: 'topP', rotulo: 'Top-p', min: 0.1, max: 1, passo: 0.01, padrao: 1 },
      { chave: 'topK', rotulo: 'Top-k', min: 1, max: 200, passo: 1, padrao: 50 },
      { chave: 'penalidadeDeRepeticao', rotulo: 'Penalidade de repetição', min: 1, max: 2, passo: 0.01, padrao: 1.05 },
      { chave: 'amostrar', rotulo: 'Amostragem (desligada = sempre igual)', tipo: 'sim', padrao: true },
      { chave: 'maxTokens', rotulo: 'Limite de tokens por parte', min: 256, max: 8192, passo: 64, padrao: 2048, avancado: true },
      { chave: 'temperaturaDoDetalhe', rotulo: 'Temperatura do detalhe (subtalker)', min: 0.1, max: 1.5, passo: 0.05, padrao: 0.9, avancado: true },
      { chave: 'topPDoDetalhe', rotulo: 'Top-p do detalhe', min: 0.1, max: 1, passo: 0.01, padrao: 1, avancado: true },
      { chave: 'topKDoDetalhe', rotulo: 'Top-k do detalhe', min: 1, max: 200, passo: 1, padrao: 50, avancado: true },
      { chave: 'soTimbre', rotulo: 'Clonar só o timbre (sem o texto do áudio)', tipo: 'sim', padrao: false, avancado: true },
    ],
  },
};

/** Ajustes do ffmpeg, iguais para os dois motores. */
const ACABAMENTO = [
  { chave: 'velocidade', rotulo: 'Velocidade do áudio', min: 0.5, max: 2, passo: 0.05, padrao: 1 },
  { chave: 'tom', rotulo: 'Tom (semitons)', min: -6, max: 6, passo: 0.5, padrao: 0 },
  { chave: 'volume', rotulo: 'Volume (dB)', min: -12, max: 12, passo: 0.5, padrao: 0 },
  { chave: 'pausa', rotulo: 'Pausa entre parágrafos (s)', min: 0, max: 3, passo: 0.1, padrao: 0.5 },
  { chave: 'normalizar', rotulo: 'Volume padrão de vídeo (−16 LUFS)', tipo: 'sim', padrao: true },
  { chave: 'porExtenso', rotulo: 'Números e siglas por extenso (português)', tipo: 'sim', padrao: true },
];
const FORMATOS = { mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'], wav: ['-c:a', 'pcm_s16le'], ogg: ['-c:a', 'libvorbis', '-q:a', '6'], flac: ['-c:a', 'flac'], m4a: ['-c:a', 'aac', '-b:a', '192k'] };

/** Parágrafos; o que passar de ~`maximo` caracteres quebra nas frases (o modelo desanda em texto muito longo). */
function dividirTexto(texto, maximo = 420) {
  const partes = [];
  for (const par of String(texto || '').replace(/\r/g, '').split(/\n\s*\n|\n(?=\s*[-•*]\s)/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (par.length <= maximo) {
      partes.push(par);
      continue;
    }
    let atual = '';
    for (const frase of par.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [par]) {
      if (atual && (atual + frase).length > maximo) {
        partes.push(atual.trim());
        atual = '';
      }
      atual += frase;
    }
    if (atual.trim()) partes.push(atual.trim());
  }
  return partes;
}

/** O texto como o motor deve ler: sem markdown e, em português, números e siglas por extenso (como o Kokoro). */
function prepararParte(parte, { porExtenso: extenso = true, idioma = 'auto' } = {}) {
  const limpo = textoParaFalar(parte, { semAviso: true, maximo: Infinity }) || parte;
  const pt = idioma === 'portuguese' || (idioma === 'auto' && /[ãõçáéíóúâêô]|\b(de|que|não|para|com|uma)\b/i.test(parte));
  // as marcas do OmniVoice ([laughter]) passam intactas
  return extenso && pt ? limpo.split(/(\[[a-z-]+\])/).map((p, i) => (i % 2 ? p : porExtenso(p))).join('') : limpo;
}

const tempoSrt = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, t = 2) => String(n).padStart(t, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/**
 * Legenda pelas durações reais de cada parte (sem precisar do Whisper): dentro da parte, as frases dividem o
 * tempo pelo tamanho. `velocidade` do acabamento encurta tudo na mesma proporção.
 */
function legenda(partes, { pausa = 0.5, velocidade = 1 } = {}) {
  const linhas = [];
  let t = 0;
  for (const { texto, segundos } of partes) {
    const frases = (texto.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [texto]).map((f) => f.trim()).filter(Boolean);
    const total = frases.reduce((s, f) => s + f.length, 0) || 1;
    const dur = segundos / velocidade;
    let ini = t;
    for (const f of frases) {
      const fim = ini + (dur * f.length) / total;
      linhas.push(`${linhas.length + 1}\n${tempoSrt(ini)} --> ${tempoSrt(fim)}\n${f}\n`);
      ini = fim;
    }
    t += dur + pausa / velocidade;
  }
  return linhas.join('\n');
}

/** Filtros do ffmpeg: tom (asetrate + atempo para manter a duração), velocidade, volume e o volume padrão. */
function filtros({ velocidade = 1, tom = 0, volume = 0, normalizar = true } = {}, taxa = 24000) {
  const f = [];
  const fator = 2 ** (Number(tom) / 12);
  if (Number(tom)) f.push(`asetrate=${Math.round(taxa * fator)}`, `aresample=${taxa}`);
  let tempo = Number(velocidade || 1) / (Number(tom) ? fator : 1);
  while (tempo > 2) (f.push('atempo=2'), (tempo /= 2));
  while (tempo < 0.5) (f.push('atempo=0.5'), (tempo /= 0.5));
  if (Math.abs(tempo - 1) > 0.001) f.push(`atempo=${tempo.toFixed(4)}`);
  if (Number(volume)) f.push(`volume=${Number(volume)}dB`);
  if (normalizar) f.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  return f.join(',');
}

const nomeDeArquivo = (t) => String(t || 'narracao').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'narracao';

class EstudioDeVoz {
  constructor(pasta, { ffmpeg, buscar = (...a) => fetch(...a), baixarConferindo, extrairZip, transcrever = null, liberarPlaca = async () => {} } = {}) {
    this.pasta = pasta;
    this.ffmpeg = ffmpeg; // caminho do ffmpeg.exe (componente do AuGPT)
    this.buscar = buscar;
    this.baixarConferindo = baixarConferindo || require('../gerador-de-imagens').baixarConferindo;
    this.extrairZip = extrairZip || ((buffer, destino) => require('../searxng-runtime').extrairZipPara(buffer, destino));
    this.transcrever = transcrever;
    this.liberarPlaca = liberarPlaca;
    this.processos = {};
    this.atual = null;
  }

  python(motor) {
    return path.join(this.pasta, motor, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  }

  instalado(motor) {
    const sp = path.join(this.pasta, motor, 'Lib', 'site-packages');
    const pacote = motor === 'qwen' ? 'qwen_tts' : 'omnivoice';
    return fs.existsSync(this.python(motor)) && fs.existsSync(path.join(sp, pacote));
  }

  estado() {
    return {
      pasta: this.pasta,
      ffmpeg: Boolean(this.ffmpeg && fs.existsSync(this.ffmpeg)),
      motores: Object.fromEntries(Object.entries(MOTORES).map(([id, m]) => [id, { ...m, instalado: this.instalado(id) }])),
      acabamento: ACABAMENTO,
      formatos: Object.keys(FORMATOS),
      idiomas: IDIOMAS,
      vozes: this.vozesSalvas(),
      gerando: this.atual ? { motor: this.atual.motor } : null,
    };
  }

  uv() {
    return path.join(this.pasta, 'uv', 'uv.exe');
  }

  rodar(exe, args, { emitir = () => {}, rotulo = '' } = {}) {
    return new Promise((ok, falha) => {
      const p = spawn(exe, args, { cwd: this.pasta, windowsHide: true, env: { ...process.env, UV_CACHE_DIR: path.join(this.pasta, 'uv', 'cache'), UV_PYTHON_INSTALL_DIR: path.join(this.pasta, 'uv', 'python'), UV_NO_PROGRESS: '1' } });
      let erro = '';
      const linha = (d) => String(d).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => {
        erro = `${erro}\n${l}`.slice(-2000);
        if (/^(Downloading|Downloaded|Prepared|Installed|Resolved|Using)/i.test(l)) emitir({ texto: `${rotulo}${l.slice(0, 120)}` });
      });
      p.stdout.on('data', linha);
      p.stderr.on('data', linha);
      p.on('error', falha);
      p.on('close', (c) => (c === 0 ? ok() : falha(new Error(`${rotulo}falhou: ${erro.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`))));
    });
  }

  /** Instala o motor (só no clique): o uv, um Python 3.11 só do estúdio, o PyTorch com CUDA e o pacote do motor. */
  async instalar(motor, { emitir = () => {} } = {}) {
    if (!MOTORES[motor]) throw new Error('motor desconhecido');
    if (process.platform !== 'win32') throw new Error('o estúdio de voz, por enquanto, é só no Windows');
    fs.mkdirSync(path.join(this.pasta, 'uv'), { recursive: true });
    if (!fs.existsSync(this.uv())) {
      const zip = path.join(this.pasta, 'uv', 'uv.zip');
      await this.baixarConferindo(UV.url, zip, { sha256: UV.sha256, buscar: this.buscar, emitir, rotulo: 'o instalador uv', total: UV.bytes });
      this.extrairZip(fs.readFileSync(zip), path.join(this.pasta, 'uv'));
      fs.rmSync(zip, { force: true });
      if (!fs.existsSync(this.uv())) throw new Error('o pacote do uv não tem o uv.exe');
    }
    const venv = path.join(this.pasta, motor);
    if (!fs.existsSync(this.python(motor))) {
      emitir({ texto: 'Preparando o Python do estúdio…' });
      await this.rodar(this.uv(), ['venv', '--python', '3.11', venv], { emitir, rotulo: 'Python: ' });
    }
    emitir({ texto: `Baixando o PyTorch com CUDA (~3 GB)…` });
    await this.rodar(this.uv(), ['pip', 'install', '--python', this.python(motor), 'torch', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cu128'], { emitir, rotulo: 'PyTorch: ' });
    emitir({ texto: `Instalando o ${MOTORES[motor].nome}…` });
    await this.rodar(this.uv(), ['pip', 'install', '--python', this.python(motor), ...MOTORES[motor].pacotes], { emitir, rotulo: `${MOTORES[motor].nome}: ` });
    if (!this.instalado(motor)) throw new Error('a instalação terminou, mas o pacote não apareceu');
    emitir({ texto: `${MOTORES[motor].nome} instalado ✓ (o modelo baixa na 1ª geração)`, porcento: 100 });
    return this.estado();
  }

  /** O processo do motor, aberto uma vez e reaproveitado; fecha sozinho depois de 10 min parado (libera a placa). */
  processo(motor) {
    const vivo = this.processos[motor];
    if (vivo && !vivo.morto) return vivo;
    fs.mkdirSync(path.join(this.pasta, 'hf'), { recursive: true });
    const script = path.join(this.pasta, 'servidor.py');
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'servidor.py')));
    const p = spawn(this.python(motor), ['-u', script, motor], {
      cwd: this.pasta,
      windowsHide: true,
      env: { ...process.env, HF_HOME: path.join(this.pasta, 'hf'), PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1', TRANSFORMERS_VERBOSITY: 'error' },
    });
    const estado = { p, morto: false, espera: new Map(), seq: 0, buffer: '', log: '' };
    estado.pronto = new Promise((ok, falha) => {
      estado.aoPronto = ok;
      estado.aoFalhar = falha;
    });
    p.stdout.on('data', (d) => {
      estado.buffer += d;
      let i;
      while ((i = estado.buffer.indexOf('\n')) >= 0) {
        const linha = estado.buffer.slice(0, i);
        estado.buffer = estado.buffer.slice(i + 1);
        let m;
        try {
          m = JSON.parse(linha);
        } catch {
          continue;
        }
        if (m.pronto) estado.aoPronto();
        const w = estado.espera.get(m.id);
        if (!w) continue;
        if (m.progresso) w.emitir(m);
        else (estado.espera.delete(m.id), m.ok ? w.ok(m) : w.falha(new Error(m.erro || 'falhou')));
      }
    });
    p.stderr.on('data', (d) => (estado.log = `${estado.log}${d}`.slice(-4000)));
    p.on('close', () => {
      estado.morto = true;
      const motivo = new Error(`o ${MOTORES[motor].nome} fechou: ${estado.log.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
      estado.aoFalhar(motivo);
      for (const w of estado.espera.values()) w.falha(motivo);
      estado.espera.clear();
    });
    this.processos[motor] = estado;
    return estado;
  }

  async pedir(motor, msg, emitir = () => {}) {
    const e = this.processo(motor);
    await e.pronto;
    clearTimeout(e.ocioso);
    const id = ++e.seq;
    const r = await new Promise((ok, falha) => {
      e.espera.set(id, { ok, falha, emitir });
      e.p.stdin.write(`${JSON.stringify({ ...msg, id })}\n`);
    });
    e.ocioso = setTimeout(() => this.fechar(motor), 10 * 60 * 1000);
    return r;
  }

  fechar(motor) {
    const e = this.processos[motor];
    if (e && !e.morto) e.p.kill();
    delete this.processos[motor];
  }

  /** Cancela a geração em andamento (o processo fecha; o próximo pedido abre outro). */
  cancelar() {
    if (this.atual) this.fechar(this.atual.motor);
    this.atual = null;
  }

  ff(args) {
    return new Promise((ok, falha) =>
      execFile(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, _o, stderr) => (err ? falha(new Error(String(stderr || err.message).trim().slice(0, 300))) : ok()))
    );
  }

  /**
   * Gera o arquivo. `o`: { texto, motor, modo, voz, idioma, instrucao, vozSalva, semente, formato, destino, ...parâmetros
   * do motor e do acabamento }. Devolve { arquivo, legenda, segundos, partes, tempo }.
   */
  async gerar(o = {}, { emitir = () => {} } = {}) {
    const motor = MOTORES[o.motor] ? o.motor : 'omni';
    if (!this.instalado(motor)) throw new Error(`o ${MOTORES[motor].nome} não está instalado`);
    if (!this.ffmpeg || !fs.existsSync(this.ffmpeg)) throw new Error('o estúdio precisa do ffmpeg (Ajustes → Componentes)');
    if (this.atual) throw new Error('já tem uma narração sendo gerada');
    const textos = dividirTexto(o.texto);
    if (!textos.length) throw new Error('escreva o texto da narração');
    this.atual = { motor };
    const tmp = fs.mkdtempSync(path.join(this.pasta, 'tmp-'));
    try {
      await this.liberarPlaca(motor);
      let referencia = null;
      if (o.modo === 'clonar') {
        const v = this.vozesSalvas().find((x) => x.id === o.vozSalva);
        if (!v) throw new Error('escolha uma voz salva para clonar');
        referencia = { audio: v.audio, texto: v.texto };
      }
      const partes = textos.map((t) => prepararParte(t, { porExtenso: o.porExtenso !== false, idioma: o.idioma }));
      const inicio = Date.now();
      const r = await this.pedir(motor, { tipo: 'gerar', ...o, motor: undefined, texto: undefined, partes, referencia, saida: path.join(tmp, 'parte') }, (m) => emitir({ texto: m.progresso, parte: m.parte, de: m.de }));
      emitir({ texto: 'Juntando as partes e aplicando o acabamento…' });
      // junta com a pausa entre as partes (um arquivo de silêncio na taxa do modelo)
      const silencio = path.join(tmp, 'silencio.wav');
      const pausa = Math.max(0, Number(o.pausa ?? 0.5));
      if (pausa > 0) await this.ff(['-f', 'lavfi', '-i', `anullsrc=r=${r.taxa}:cl=mono`, '-t', String(pausa), silencio]);
      const lista = path.join(tmp, 'lista.txt');
      fs.writeFileSync(lista, r.partes.flatMap((p, i) => [`file '${p.arquivo.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, ...(pausa > 0 && i < r.partes.length - 1 ? [`file '${silencio.replace(/\\/g, '/')}'`] : [])]).join('\n'));
      const formato = FORMATOS[o.formato] ? o.formato : 'mp3';
      const pastaDestino = o.destino || path.join(this.pasta, 'narracoes');
      fs.mkdirSync(pastaDestino, { recursive: true });
      const base = path.join(pastaDestino, `${nomeDeArquivo(textos[0])}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`);
      const arquivo = `${base}.${formato}`;
      const af = filtros(o, r.taxa);
      await this.ff(['-f', 'concat', '-safe', '0', '-i', lista, ...(af ? ['-af', af] : []), ...FORMATOS[formato], arquivo]);
      const velocidade = Number(o.velocidade || 1);
      const segundos = (r.partes.reduce((s, p) => s + p.segundos, 0) + pausa * (r.partes.length - 1)) / velocidade;
      let srt = null;
      if (o.legenda !== false) {
        srt = `${base}.srt`;
        fs.writeFileSync(srt, legenda(r.partes.map((p, i) => ({ texto: textos[i], segundos: p.segundos })), { pausa, velocidade }));
      }
      return { arquivo, legenda: srt, segundos, partes: r.partes.length, tempo: (Date.now() - inicio) / 1000, motor };
    } finally {
      this.atual = null;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /* ---------------- vozes salvas (para clonar) ---------------- */

  dirVozes() {
    return path.join(this.pasta, 'vozes');
  }

  vozesSalvas() {
    if (!fs.existsSync(this.dirVozes())) return [];
    return fs.readdirSync(this.dirVozes()).map((id) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.dirVozes(), id, 'voz.json'), 'utf8'));
        return { id, ...j, audio: path.join(this.dirVozes(), id, 'referencia.wav') };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Salva uma voz para clonar. Só com a confirmação de que a voz é da pessoa ou que ela tem autorização: clonar a voz
   * de alguém sem permissão serve para golpe. O áudio vira WAV 24 kHz mono, até 20 s; sem o texto, o Whisper transcreve.
   */
  async salvarVoz({ nome, origem, texto = '', autorizada = false } = {}) {
    if (!autorizada) throw new Error('confirme que a voz é sua ou que você tem autorização da pessoa');
    if (!origem || !fs.existsSync(origem)) throw new Error('escolha o áudio da voz');
    if (!this.ffmpeg || !fs.existsSync(this.ffmpeg)) throw new Error('o estúdio precisa do ffmpeg (Ajustes → Componentes)');
    const id = `${nomeDeArquivo(nome)}-${Date.now().toString(36)}`;
    const dir = path.join(this.dirVozes(), id);
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, 'referencia.wav');
    try {
      await this.ff(['-i', origem, '-t', '20', '-ac', '1', '-ar', '24000', wav]);
      let transcrito = String(texto || '').trim();
      if (!transcrito && this.transcrever) {
        const w16 = path.join(dir, 'ref16k.wav');
        await this.ff(['-i', wav, '-ac', '1', '-ar', '16000', w16]);
        transcrito = String((await this.transcrever(w16).catch(() => ({ texto: '' }))).texto || '').trim();
        fs.rmSync(w16, { force: true });
      }
      fs.writeFileSync(path.join(dir, 'voz.json'), JSON.stringify({ nome: String(nome || 'Minha voz').slice(0, 60), texto: transcrito, autorizada: true, criada: new Date().toISOString() }, null, 2));
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
    return this.vozesSalvas().find((v) => v.id === id);
  }

  apagarVoz(id) {
    const dir = path.join(this.dirVozes(), path.basename(String(id || '')));
    if (id && fs.existsSync(path.join(dir, 'voz.json'))) fs.rmSync(dir, { recursive: true, force: true });
    return this.vozesSalvas();
  }
}

module.exports = { EstudioDeVoz, MOTORES, ACABAMENTO, FORMATOS, IDIOMAS, UV, dividirTexto, prepararParte, legenda, filtros, tempoSrt, nomeDeArquivo };
