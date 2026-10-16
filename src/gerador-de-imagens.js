'use strict';

/**
 * Criar imagens (Fase 5, 16/10): FLUX.2 Klein 4B pelo stable-diffusion.cpp —
 * um executável, sem Python nem ComfyUI. Medido na RTX 3060 Ti (8 GB):
 * 1024×1024 em ~7 s com a versão CUDA (contando o carregamento), 50 s com a
 * Vulkan; o pico na placa é de 7,1 GB, então o Qwen sai da placa antes (a
 * troca custa ~0,1 s para sair e ~3,4 s para voltar). A versão de 8 bits
 * não deu ganho visível sobre a de 4 bits (2,46 GB), que é a usada.
 *
 * Instalação só no clique: o programa vem da página de versões do projeto
 * (SHA-256 publicado pelo GitHub em cada arquivo) e os modelos do Hugging
 * Face (SHA-256 publicado pelo próprio site). Tudo é conferido antes de usar.
 * A versão anterior do programa fica guardada para "voltar".
 */

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RELEASES = 'https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest';
const HF = 'https://huggingface.co';
// licença Apache 2.0, sem login
const MODELOS = [
  { papel: 'difusão', nome: 'flux-2-klein-4b-Q4_0.gguf', repo: 'leejet/FLUX.2-klein-4B-GGUF', arquivo: 'flux-2-klein-4b-Q4_0.gguf', bytes: 2460378560, sha256: 'd1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4' },
  { papel: 'texto', nome: 'Qwen3-4B-Q4_K_M.gguf', repo: 'unsloth/Qwen3-4B-GGUF', arquivo: 'Qwen3-4B-Q4_K_M.gguf', bytes: 2497281312, sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a' },
  { papel: 'vae', nome: 'flux2-vae.safetensors', repo: 'Comfy-Org/vae-text-encorder-for-flux-klein-4b', arquivo: 'split_files/vae/flux2-vae.safetensors', bytes: 336211292, sha256: '868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3' },
];
const BYTES_DOS_MODELOS = MODELOS.reduce((s, m) => s + m.bytes, 0);
const GB = (b) => `${(b / 1e9).toFixed(1).replace('.', ',')} GB`;

function rodar(arquivo, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((ok, falha) =>
    execFile(arquivo, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) =>
      err ? falha(Object.assign(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400)), { saida: `${stdout}${stderr}` })) : ok(`${stdout}\n${stderr}`)
    )
  );
}

/**
 * Qual versão cabe neste computador. NVIDIA com 7,5 GB ou mais: CUDA, rápida.
 * Outra placa com 8 GB ou mais: Vulkan, que funciona mas é lenta (~50 s por
 * imagem). Sem placa assim, o recurso fica desligado e a tela diz por quê.
 */
function recomendar(computador = {}) {
  const gpus = computador.gpus || [];
  const nvidia = gpus.filter((g) => /nvidia|geforce|rtx|gtx|quadro/i.test(g.nome)).sort((a, b) => b.vramGB - a.vramGB)[0];
  const outra = gpus.filter((g) => !/nvidia|geforce|rtx|gtx|quadro/i.test(g.nome)).sort((a, b) => b.vramGB - a.vramGB)[0];
  if (computador.plataforma && computador.plataforma !== 'win32') return { pode: false, motivo: 'por enquanto o AuGPT instala o gerador de imagens só no Windows' };
  if (nvidia && nvidia.vramGB >= 7.5) return { pode: true, motor: 'cuda', motivo: `sua ${nvidia.nome} (${nvidia.vramGB} GB) gera uma imagem em cerca de 7 a 15 segundos`, downloadGB: (BYTES_DOS_MODELOS + 9e8) / 1e9 };
  if (outra && outra.vramGB >= 8) return { pode: true, motor: 'vulkan', motivo: `sua ${outra.nome} (${outra.vramGB} GB) roda pela versão Vulkan, que funciona mas é lenta: cerca de 1 minuto por imagem`, downloadGB: (BYTES_DOS_MODELOS + 3e7) / 1e9 };
  const melhor = nvidia || outra;
  return { pode: false, motivo: melhor ? `a placa ${melhor.nome} tem ${melhor.vramGB} GB; o gerador de imagens precisa de 8 GB` : 'não achei placa de vídeo com 8 GB ou mais; no processador, uma imagem levaria vários minutos' };
}

/** Baixa para disco calculando o SHA-256 no caminho; só fica com o arquivo se conferir. */
async function baixarConferindo(url, destino, { sha256, buscar, emitir = () => {}, rotulo, total }) {
  const parcial = `${destino}.parcial`;
  const r = await buscar(url, { headers: { 'User-Agent': 'AuGPT' }, signal: AbortSignal.timeout(2 * 60 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error(`download de ${rotulo} falhou (HTTP ${r.status})`);
  const hash = crypto.createHash('sha256');
  const saida = fs.createWriteStream(parcial);
  const tamanho = Number(r.headers?.get?.('content-length')) || total || 0;
  let recebidos = 0;
  let ultimo = -1;
  try {
    for await (const pedaco of r.body) {
      hash.update(pedaco);
      recebidos += pedaco.length;
      if (!saida.write(pedaco)) await new Promise((ok) => saida.once('drain', ok));
      const pct = tamanho ? Math.floor((recebidos / tamanho) * 100) : null;
      if (pct !== null && pct !== ultimo) {
        ultimo = pct;
        emitir({ texto: `Baixando ${rotulo}… ${pct}% de ${GB(tamanho)}`, porcento: pct });
      }
    }
    await new Promise((ok, falha) => saida.end((err) => (err ? falha(err) : ok())));
  } catch (err) {
    saida.destroy();
    fs.rmSync(parcial, { force: true });
    throw err;
  }
  const obtido = hash.digest('hex');
  if (sha256 && obtido !== sha256) {
    fs.rmSync(parcial, { force: true });
    throw new Error(`o SHA-256 de ${rotulo} não confere com o publicado — o arquivo foi descartado`);
  }
  fs.renameSync(parcial, destino);
}

/** SHA-256 de um arquivo já baixado (para não baixar de novo o que já está certo). */
function shaDoArquivo(arquivo) {
  return new Promise((ok, falha) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(arquivo).on('data', (d) => hash.update(d)).on('end', () => ok(hash.digest('hex'))).on('error', falha);
  });
}

class GeradorDeImagens {
  /** @param dir pasta base (ao lado dos modelos do Ollama; ver electron/main.js) */
  constructor(dir, { buscar = (...a) => fetch(...a), executar = rodar, extrairZip, plataforma = process.platform } = {}) {
    this.dir = dir;
    this.bin = path.join(dir, 'bin');
    this.modelos = path.join(dir, 'modelos');
    this.buscar = buscar;
    this.executar = executar;
    this.extrairZip = extrairZip || ((buffer, destino) => require('./searxng-runtime').extrairZipPara(buffer, destino));
    this.plataforma = plataforma;
  }

  get exe() {
    return path.join(this.bin, this.plataforma === 'win32' ? 'sd-cli.exe' : 'sd-cli');
  }
  get anterior() {
    return `${this.bin}.anterior`;
  }

  info() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.bin, 'versao.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  modelosProntos() {
    return MODELOS.every((m) => {
      try {
        return fs.statSync(path.join(this.modelos, m.nome)).size === m.bytes;
      } catch {
        return false;
      }
    });
  }

  instalado() {
    return fs.existsSync(this.exe) && this.modelosProntos();
  }

  async ultima(motor) {
    try {
      const r = await this.buscar(RELEASES, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'AuGPT' } });
      if (!r.ok) return null;
      const j = await r.json();
      const procurar = (re) => j.assets?.find((a) => re.test(a.name));
      const arquivos = motor === 'cuda' ? [procurar(/bin-win-cuda12-x64\.zip$/), procurar(/^cudart-.*win-cu12-x64\.zip$/)] : [procurar(/bin-win-vulkan-x64\.zip$/)];
      if (arquivos.some((a) => !a || !/^sha256:/.test(a.digest || ''))) return null;
      return { versao: j.tag_name, arquivos: arquivos.map((a) => ({ nome: a.name, url: a.browser_download_url, bytes: a.size, sha256: a.digest.slice(7) })) };
    } catch {
      return null;
    }
  }

  async estado(computador) {
    const rec = recomendar(computador);
    const info = this.info();
    const motor = info?.motor || rec.motor;
    const ultima = motor ? await this.ultima(motor) : null;
    // versões do tipo "master-969-8c442fb": o número do meio cresce a cada build
    const numero = (v) => Number(/-(\d+)-/.exec(String(v || ''))?.[1] || 0);
    return {
      ...rec,
      instalado: this.instalado(),
      motor,
      instalada: info?.versao || null,
      disponivel: ultima?.versao || null,
      atualizar: !!(info?.versao && ultima && numero(ultima.versao) > numero(info.versao)),
      temAnterior: fs.existsSync(this.anterior),
      faltamModelos: fs.existsSync(this.exe) && !this.modelosProntos(),
      tamanhoDosModelos: GB(BYTES_DOS_MODELOS),
      pasta: this.dir,
    };
  }

  /** Instala ou atualiza o programa e baixa os modelos que faltam (cada um conferido pelo SHA-256). */
  async instalar({ motor, emitir = () => {} } = {}) {
    if (this.plataforma !== 'win32') throw new Error('por enquanto o gerador de imagens é instalado só no Windows');
    if (!motor) throw new Error('este computador não tem placa de vídeo para gerar imagens');
    const ultima = await this.ultima(motor);
    if (!ultima) throw new Error('não consegui consultar a versão do stable-diffusion.cpp no GitHub');
    const info = this.info();
    if (!fs.existsSync(this.exe) || info?.versao !== ultima.versao || info?.motor !== motor) {
      const novo = `${this.bin}.novo`;
      fs.rmSync(novo, { recursive: true, force: true });
      fs.mkdirSync(novo, { recursive: true });
      for (const a of ultima.arquivos) {
        const zip = path.join(this.dir, a.nome);
        fs.mkdirSync(this.dir, { recursive: true });
        await baixarConferindo(a.url, zip, { sha256: a.sha256, buscar: this.buscar, emitir, rotulo: a.nome.startsWith('cudart') ? 'as bibliotecas da NVIDIA' : 'o programa', total: a.bytes });
        emitir({ texto: 'Extraindo…' });
        this.extrairZip(fs.readFileSync(zip), novo);
        fs.rmSync(zip, { force: true });
      }
      fs.writeFileSync(path.join(novo, 'versao.json'), JSON.stringify({ versao: ultima.versao, motor }));
      if (!fs.existsSync(path.join(novo, path.basename(this.exe)))) throw new Error('o pacote baixado não tem o sd-cli');
      fs.rmSync(this.anterior, { recursive: true, force: true });
      if (fs.existsSync(this.bin)) fs.renameSync(this.bin, this.anterior);
      fs.renameSync(novo, this.bin);
    }
    fs.mkdirSync(this.modelos, { recursive: true });
    for (const m of MODELOS) {
      const destino = path.join(this.modelos, m.nome);
      if (fs.existsSync(destino) && fs.statSync(destino).size === m.bytes) {
        emitir({ texto: `Conferindo ${m.nome}…` });
        if ((await shaDoArquivo(destino)) === m.sha256) continue;
        fs.rmSync(destino, { force: true });
      }
      await baixarConferindo(`${HF}/${m.repo}/resolve/main/${m.arquivo}`, destino, { sha256: m.sha256, buscar: this.buscar, emitir, rotulo: `o modelo (${m.papel})`, total: m.bytes });
    }
    emitir({ texto: 'Pronto para criar imagens.' });
    return this.info();
  }

  voltar() {
    if (!fs.existsSync(this.anterior)) throw new Error('não há versão anterior guardada');
    const troca = `${this.bin}.troca`;
    fs.renameSync(this.bin, troca);
    fs.renameSync(this.anterior, this.bin);
    fs.renameSync(troca, this.anterior);
    return this.info();
  }

  /**
   * Gera uma imagem PNG em `saida`. `referencias`: imagens para editar ou
   * seguir (o Klein edita a partir delas). Sem memória na placa para tudo,
   * tenta de novo com o codificador de texto no processador.
   */
  async gerar({ prompt, saida, largura = 1024, altura = 1024, passos = 4, semente = -1, referencias = [] }) {
    if (!this.instalado()) throw new Error('o gerador de imagens não está instalado (Ajustes → Componentes)');
    const gpu = (this.info()?.motor || 'cuda') === 'cuda' ? 'CUDA0' : 'Vulkan0';
    const base = [
      '--diffusion-model', path.join(this.modelos, MODELOS[0].nome),
      '--llm', path.join(this.modelos, MODELOS[1].nome),
      '--vae', path.join(this.modelos, MODELOS[2].nome),
      '-p', String(prompt).slice(0, 2000),
      '--cfg-scale', '1.0', '--steps', String(passos),
      '-W', String(largura), '-H', String(altura),
      '-s', String(semente),
      ...referencias.flatMap((r) => ['-r', r]),
      '-o', saida,
    ];
    const inicio = Date.now();
    try {
      await this.executar(this.exe, [...base, '--params-backend', `te=${gpu},vae=${gpu}`]);
    } catch (err) {
      if (!/out of memory|alloc|memory/i.test(`${err.message} ${err.saida || ''}`)) throw err;
      await this.executar(this.exe, [...base, '--params-backend', `te=cpu,vae=${gpu}`]);
    }
    if (!fs.existsSync(saida)) throw new Error('o gerador terminou sem salvar a imagem');
    return { arquivo: saida, ms: Date.now() - inicio };
  }
}

/**
 * Onde ficam o programa e os modelos (~5,3 GB): ao lado dos modelos do Ollama
 * quando o usuário os mudou de disco (OLLAMA_MODELS, ex.: F:\ollama\models →
 * F:\ollama\augpt-imagem); senão, na pasta de dados do app.
 */
function pastaPadrao(userDataPath, env = process.env) {
  return env.OLLAMA_MODELS ? path.join(path.dirname(env.OLLAMA_MODELS), 'augpt-imagem') : path.join(userDataPath, 'componentes', 'imagem');
}

module.exports = { pastaPadrao, GeradorDeImagens, recomendar, MODELOS, BYTES_DOS_MODELOS, baixarConferindo };
