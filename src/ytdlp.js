'use strict';

/**
 * yt-dlp (Fase 3, 16/10): o AuGPT "assiste" a vídeos do YouTube lendo a
 * legenda (a manual ou a automática, no idioma original do vídeo) e os
 * comentários mais curtidos — o vídeo em si NUNCA é baixado.
 *
 * O executável oficial (github.com/yt-dlp/yt-dlp) fica em
 * <dados do app>/componentes. Instalar e atualizar só quando o usuário clica:
 * baixa ao lado, confere o SHA-256 contra o SHA2-256SUMS da mesma versão,
 * testa (`--version`) e só então troca; a versão de antes fica guardada para
 * "Voltar à versão anterior" se a nova der problema.
 *
 * Por que a legenda sai por fetch e não pelo `--write-subs`: as legendas
 * traduzidas automaticamente para português dão "HTTP 429" (teste de 16/10);
 * escolhendo a trilha original e buscando o json3 direto, não.
 */

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARQUIVO = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' };
const RELEASES = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

// erro que costuma ser "o YouTube mudou e o yt-dlp ainda não acompanhou" — a saída é atualizar
const MUDANCA_DO_YOUTUBE = /sign in to confirm|nsig|signature|unable to extract|failed to extract|player response|requested format is not available|HTTP Error 403/i;
const pareceMudancaDoYouTube = (erro) => MUDANCA_DO_YOUTUBE.test(String(erro || ''));

function rodar(arquivo, args, { timeoutMs = 60000 } = {}) {
  return new Promise((ok, falha) =>
    execFile(arquivo, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) =>
      err ? falha(Object.assign(new Error(String(stderr || err.message).trim().split('\n').pop().slice(0, 300)), { stderr })) : ok(stdout)
    )
  );
}

const idDoVideo = (url) => /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(String(url || ''))?.[1] || null;

/** A trilha de legenda para ler: manual (pt, en, idioma do vídeo) ou automática no idioma ORIGINAL (nunca a traduzida). */
function escolherLegenda(info) {
  const manuais = info.subtitles || {};
  const auto = info.automatic_captions || {};
  const lingua = String(info.language || '').split('-')[0];
  const json3 = (lista) => (lista || []).find((f) => f.ext === 'json3')?.url;
  for (const prefixo of ['pt', 'en', lingua].filter(Boolean)) {
    const chave = Object.keys(manuais).find((k) => k === prefixo || k.startsWith(`${prefixo}-`));
    if (chave && json3(manuais[chave])) return { url: json3(manuais[chave]), idioma: chave, automatica: false };
  }
  const original = Object.keys(auto).find((k) => k.endsWith('-orig')) || (lingua && auto[lingua] ? lingua : null);
  if (original && json3(auto[original])) return { url: json3(auto[original]), idioma: original.replace(/-orig$/, ''), automatica: true };
  return null;
}

/** json3 do YouTube → texto corrido. */
const textoDaLegenda = (json3) =>
  (json3?.events || [])
    .filter((e) => e.segs)
    .map((e) => e.segs.map((s) => s.utf8 || '').join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

class YtDlp {
  constructor(dir, { plataforma = process.platform, buscar = (...a) => fetch(...a), executar = rodar } = {}) {
    this.dir = dir;
    this.nome = ARQUIVO[plataforma] || ARQUIVO.linux;
    this.buscar = buscar;
    this.executar = executar;
  }

  get caminho() {
    return path.join(this.dir, this.nome);
  }
  get anterior() {
    return `${this.caminho}.anterior`;
  }
  instalado() {
    return fs.existsSync(this.caminho);
  }

  async versao(arquivo = this.caminho) {
    if (!fs.existsSync(arquivo)) return null;
    try {
      return (await this.executar(arquivo, ['--version'], { timeoutMs: 20000 })).trim() || null;
    } catch {
      return null;
    }
  }

  /** A versão publicada mais nova, com os endereços do executável e da lista de SHA-256. */
  async ultima() {
    try {
      const r = await this.buscar(RELEASES, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'AuGPT' } });
      if (!r.ok) return null;
      const j = await r.json();
      const url = (nome) => j.assets?.find((a) => a.name === nome)?.browser_download_url;
      return url(this.nome) && url('SHA2-256SUMS') ? { versao: j.tag_name, url: url(this.nome), urlSomas: url('SHA2-256SUMS') } : null;
    } catch {
      return null;
    }
  }

  async estado() {
    const [instalada, ultima] = await Promise.all([this.versao(), this.ultima()]);
    return {
      instalado: !!instalada,
      instalada,
      disponivel: ultima?.versao || null,
      // as versões são datas (2026.08.19): comparar como texto basta
      atualizar: !!(instalada && ultima?.versao && ultima.versao > instalada),
      temAnterior: fs.existsSync(this.anterior),
    };
  }

  async baixar(url) {
    const r = await this.buscar(url, { signal: AbortSignal.timeout(5 * 60 * 1000), headers: { 'User-Agent': 'AuGPT' } });
    if (!r.ok) throw new Error(`download falhou (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** Instala ou atualiza: baixa, confere o SHA-256, testa e troca (a de antes vira .anterior). */
  async instalar({ emitir = () => {} } = {}) {
    emitir({ texto: 'Consultando a versão mais nova…' });
    const ultima = await this.ultima();
    if (!ultima) throw new Error('não consegui consultar as versões do yt-dlp no GitHub');
    emitir({ texto: `Baixando o yt-dlp ${ultima.versao}…` });
    const [binario, somas] = await Promise.all([this.baixar(ultima.url), this.baixar(ultima.urlSomas)]);
    const esperado = new RegExp(`^([a-f0-9]{64})\\s+\\*?${this.nome.replace('.', '\\.')}$`, 'm').exec(somas.toString('utf8'))?.[1];
    const obtido = crypto.createHash('sha256').update(binario).digest('hex');
    if (!esperado || esperado !== obtido) throw new Error('o SHA-256 do arquivo baixado não confere com o publicado — nada foi trocado');
    fs.mkdirSync(this.dir, { recursive: true });
    const novo = `${this.caminho}.novo`;
    fs.writeFileSync(novo, binario, { mode: 0o755 });
    emitir({ texto: 'Testando a versão nova…' });
    if (!(await this.versao(novo))) {
      fs.rmSync(novo, { force: true });
      throw new Error('a versão nova não rodou — a anterior continua');
    }
    if (this.instalado()) fs.renameSync(this.caminho, this.anterior);
    fs.renameSync(novo, this.caminho);
    emitir({ texto: `yt-dlp ${ultima.versao} instalado.` });
    return this.estado();
  }

  /** Volta para a versão guardada antes da última atualização. */
  async voltar() {
    if (!fs.existsSync(this.anterior)) throw new Error('não há versão anterior guardada');
    fs.rmSync(this.caminho, { force: true });
    fs.renameSync(this.anterior, this.caminho);
    return this.estado();
  }

  /** Busca no YouTube: os N primeiros vídeos, sem abrir nenhum. */
  async buscarVideos(consulta, n = 5) {
    const saida = await this.executar(this.caminho, [`ytsearch${n}:${consulta}`, '--flat-playlist', '-J', '--no-warnings'], { timeoutMs: 30000 });
    return (JSON.parse(saida).entries || [])
      .filter((e) => e.id)
      .map((e) => ({
        id: e.id,
        url: `https://www.youtube.com/watch?v=${e.id}`,
        titulo: e.title || '',
        canal: e.channel || e.uploader || '',
        duracao: e.duration || null,
        visualizacoes: e.view_count || null,
      }));
  }

  /** "Assiste" ao vídeo: dados, legenda e comentários mais curtidos — sem baixar o vídeo. */
  async verVideo(url, { comentarios = 30 } = {}) {
    const id = idDoVideo(url);
    if (!id) throw new Error('endereço de vídeo do YouTube inválido');
    const args = [`https://www.youtube.com/watch?v=${id}`, '--skip-download', '-J', '--no-warnings', '--write-comments', '--extractor-args', `youtube:max_comments=${comentarios},all,0,0;comment_sort=top`];
    const info = JSON.parse(await this.executar(this.caminho, args, { timeoutMs: 90000 }));
    const trilha = escolherLegenda(info);
    let legenda = '';
    if (trilha) {
      try {
        const r = await this.buscar(trilha.url, { signal: AbortSignal.timeout(20000) });
        if (r.ok) legenda = textoDaLegenda(await r.json()).slice(0, 80000);
      } catch {
        legenda = '';
      }
    }
    return {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      titulo: info.title || '',
      canal: info.channel || info.uploader || '',
      data: info.upload_date || null,
      duracao: info.duration || null,
      descricao: String(info.description || '').slice(0, 3000),
      legenda,
      idiomaDaLegenda: legenda ? trilha.idioma : null,
      legendaAutomatica: legenda ? trilha.automatica : null,
      comentarios: (info.comments || [])
        .filter((c) => c.text && !c.author_is_uploader)
        .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
        .slice(0, comentarios)
        .map((c) => ({ texto: String(c.text).replace(/\s+/g, ' ').slice(0, 500), curtidas: c.like_count || 0 })),
    };
  }
}

module.exports = { YtDlp, escolherLegenda, textoDaLegenda, idDoVideo, pareceMudancaDoYouTube, ARQUIVO };
