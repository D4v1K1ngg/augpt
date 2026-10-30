'use strict';

/**
 * ffmpeg (30/10, pedido do Davi: baixar vídeos e músicas pelo AuGPT): junta o vídeo e o áudio do YouTube em 1080p
 * e converte para MP3. Igual ao yt-dlp (src/ytdlp.js): instalar e atualizar só com o clique; baixa ao lado, confere
 * o SHA-256 contra o checksums.sha256 da mesma publicação, testa (`-version`) e só então troca; a versão de antes
 * fica guardada para "Voltar à versão anterior".
 *
 * A fonte é a do próprio projeto yt-dlp (github.com/yt-dlp/FFmpeg-Builds), feita para ele. A versão "shared"
 * (87 MB: o programa e as bibliotecas dele) no lugar da estática (192 MB). As publicações são diárias com a tag
 * "latest": a versão é a data da publicação.
 */

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELEASES = 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest';
const PACOTE = { win32: 'ffmpeg-master-latest-win64-gpl-shared.zip' };
const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

function rodar(arquivo, args, { timeoutMs = 60000, cwd } = {}) {
  return new Promise((ok, falha) =>
    execFile(arquivo, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8', cwd }, (err, stdout, stderr) =>
      err ? falha(new Error(String(stderr || err.message).trim().split('\n').pop().slice(0, 300))) : ok(stdout)
    )
  );
}

class Ffmpeg {
  constructor(dir, { plataforma = process.platform, buscar = (...a) => fetch(...a), executar = rodar } = {}) {
    this.dir = dir; // <componentes>/ffmpeg — a pasta com o ffmpeg.exe e as bibliotecas
    this.pacote = PACOTE[plataforma] || null;
    this.buscar = buscar;
    this.executar = executar;
  }

  get caminho() {
    return path.join(this.dir, EXE);
  }
  get anterior() {
    return `${this.dir}.anterior`;
  }
  get arquivoDaVersao() {
    return path.join(this.dir, 'versao.txt');
  }
  instalado() {
    return fs.existsSync(this.caminho);
  }

  /** O ffmpeg roda? ("ffmpeg version N-…" na 1ª linha) */
  async roda(arquivo = this.caminho) {
    if (!fs.existsSync(arquivo)) return false;
    try {
      return /^ffmpeg version/i.test(await this.executar(arquivo, ['-version'], { timeoutMs: 20000, cwd: path.dirname(arquivo) }));
    } catch {
      return false;
    }
  }

  versao() {
    try {
      return fs.readFileSync(this.arquivoDaVersao, 'utf8').trim() || null;
    } catch {
      return this.instalado() ? 'instalado' : null;
    }
  }

  /** A publicação mais nova: a data (que é a versão), o pacote e a lista de SHA-256. */
  async ultima() {
    if (!this.pacote) return null;
    try {
      const r = await this.buscar(RELEASES, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'AuGPT' } });
      if (!r.ok) return null;
      const j = await r.json();
      const url = (nome) => j.assets?.find((a) => a.name === nome);
      const pacote = url(this.pacote);
      const somas = url('checksums.sha256');
      // "Latest Auto-Build (2026-10-30 19:13)" → "2026-10-30 19:13"; sem isso, a data da publicação
      const versao = /\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)/.exec(j.name || '')?.[1] || String(j.published_at || '').slice(0, 16).replace('T', ' ');
      return pacote && somas && versao ? { versao, url: pacote.browser_download_url, urlSomas: somas.browser_download_url, megas: Math.round((pacote.size || 0) / 1048576) } : null;
    } catch {
      return null;
    }
  }

  async estado() {
    const [instalada, ultima] = [this.versao(), await this.ultima()];
    return {
      instalado: this.instalado(),
      instalada,
      disponivel: ultima?.versao || null,
      tamanhoMB: ultima?.megas || 87,
      // versões são datas ("2026-10-30 19:13"): comparar como texto basta
      atualizar: !!(this.instalado() && ultima?.versao && instalada && instalada !== 'instalado' && ultima.versao > instalada),
      temAnterior: fs.existsSync(this.anterior),
      suportado: Boolean(this.pacote),
    };
  }

  async baixar(url) {
    const r = await this.buscar(url, { signal: AbortSignal.timeout(10 * 60 * 1000), headers: { 'User-Agent': 'AuGPT' } });
    if (!r.ok) throw new Error(`download falhou (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** Instala ou atualiza: baixa o .zip, confere o SHA-256, extrai a pasta bin, testa e troca. */
  async instalar({ emitir = () => {} } = {}) {
    if (!this.pacote) throw new Error('o ffmpeg automático só está disponível no Windows por enquanto');
    emitir({ texto: 'Consultando a versão mais nova…' });
    const ultima = await this.ultima();
    if (!ultima) throw new Error('não consegui consultar as versões do ffmpeg no GitHub');
    emitir({ texto: `Baixando o ffmpeg ${ultima.versao} (${ultima.megas} MB)…` });
    const [zip, somas] = await Promise.all([this.baixar(ultima.url), this.baixar(ultima.urlSomas)]);
    const esperado = new RegExp(`^([a-f0-9]{64})\\s+\\*?${this.pacote.replace(/[.]/g, '\\.')}$`, 'm').exec(somas.toString('utf8'))?.[1];
    const obtido = crypto.createHash('sha256').update(zip).digest('hex');
    if (!esperado || esperado !== obtido) throw new Error('o SHA-256 do arquivo baixado não confere com o publicado — nada foi trocado');
    emitir({ texto: 'Extraindo…' });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ffmpeg-'));
    const novo = `${this.dir}.novo`;
    try {
      const arquivoZip = path.join(temp, this.pacote);
      fs.writeFileSync(arquivoZip, zip);
      // o tar do Windows 10+ abre .zip (sem dependência nova) — o de System32: o "tar" do Git, se vier antes no
      // PATH, lê "C:" como outro computador
      const tarDoWindows = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      await this.executar(fs.existsSync(tarDoWindows) ? tarDoWindows : 'tar', ['-xf', arquivoZip, '-C', temp], { timeoutMs: 5 * 60 * 1000 });
      const bin = acharBin(temp);
      if (!bin) throw new Error('o pacote baixado não tem o ffmpeg dentro');
      fs.rmSync(novo, { recursive: true, force: true });
      fs.mkdirSync(novo, { recursive: true });
      for (const f of fs.readdirSync(bin)) fs.copyFileSync(path.join(bin, f), path.join(novo, f));
      fs.writeFileSync(path.join(novo, 'versao.txt'), ultima.versao);
      emitir({ texto: 'Testando a versão nova…' });
      if (!(await this.roda(path.join(novo, EXE)))) throw new Error('a versão nova não rodou — a anterior continua');
      fs.rmSync(this.anterior, { recursive: true, force: true });
      if (fs.existsSync(this.dir)) fs.renameSync(this.dir, this.anterior);
      fs.renameSync(novo, this.dir);
    } catch (err) {
      fs.rmSync(novo, { recursive: true, force: true });
      throw err;
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    emitir({ texto: `ffmpeg ${ultima.versao} instalado.` });
    return this.estado();
  }

  /** Volta para a versão guardada antes da última atualização. */
  async voltar() {
    if (!fs.existsSync(this.anterior)) throw new Error('não há versão anterior guardada');
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.renameSync(this.anterior, this.dir);
    return this.estado();
  }
}

/** A pasta "bin" com o ffmpeg dentro do pacote extraído (ffmpeg-master-latest-…/bin). */
function acharBin(raiz, fundo = 0) {
  if (fundo > 3) return null;
  if (fs.existsSync(path.join(raiz, EXE))) return raiz;
  for (const nome of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!nome.isDirectory()) continue;
    const achou = acharBin(path.join(raiz, nome.name), fundo + 1);
    if (achou) return achou;
  }
  return null;
}

module.exports = { Ffmpeg, acharBin, PACOTE };
