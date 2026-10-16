'use strict';

/**
 * Tesseract (Fase 4, 16/10): lê o texto de uma imagem (OCR) sem IA, offline —
 * print de tela, foto de documento, nota fiscal, etiqueta. Complementa a
 * visão do modelo: o modelo entende a imagem; o Tesseract transcreve o texto
 * letra a letra, sem inventar.
 *
 * Instalação só no clique do usuário: no Windows, o pacote oficial do winget
 * (UB-Mannheim.TesseractOCR — o winget confere o SHA-256 do instalador); os
 * idiomas português e inglês (tessdata_fast, do projeto tesseract-ocr) ficam
 * em <dados do app>/componentes/tessdata.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { versaoMaisNova } = require('./instalador-ollama');

const PACOTE = 'UB-Mannheim.TesseractOCR';
const RELEASES = 'https://api.github.com/repos/UB-Mannheim/tesseract/releases/latest';
const IDIOMAS = ['por', 'eng'];
const urlDoIdioma = (l) => `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${l}.traineddata`;
const IMAGEM = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

function rodar(arquivo, args, { timeoutMs = 60000 } = {}) {
  return new Promise((ok, falha) =>
    execFile(arquivo, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) =>
      err ? falha(Object.assign(new Error(String(stderr || err.message).trim().split('\n').pop().slice(0, 300)), { stdout, stderr, codigo: err.code })) : ok(`${stdout}\n${stderr}`)
    )
  );
}

class Tesseract {
  constructor(dir, { plataforma = process.platform, buscar = (...a) => fetch(...a), executar = rodar, existe = fs.existsSync } = {}) {
    this.dir = dir;
    this.tessdata = path.join(dir, 'tessdata');
    this.plataforma = plataforma;
    this.buscar = buscar;
    this.executar = executar;
    this.existe = existe;
  }

  /** Onde está o tesseract: instalação padrão do Windows ou o PATH. */
  localizar() {
    const candidatos =
      this.plataforma === 'win32'
        ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tesseract-OCR', 'tesseract.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tesseract-OCR', 'tesseract.exe')]
        : ['/usr/bin/tesseract', '/usr/local/bin/tesseract', '/opt/homebrew/bin/tesseract'];
    return candidatos.find((c) => c && this.existe(c)) || null;
  }

  idiomasProntos() {
    return IDIOMAS.every((l) => this.existe(path.join(this.tessdata, `${l}.traineddata`)));
  }

  instalado() {
    return !!this.localizar() && this.idiomasProntos();
  }

  async versao() {
    const bin = this.localizar();
    if (!bin) return null;
    try {
      return /tesseract v?([\d.]+)/i.exec(await this.executar(bin, ['--version'], { timeoutMs: 15000 }))?.[1] || null;
    } catch {
      return null;
    }
  }

  async ultima() {
    try {
      const r = await this.buscar(RELEASES, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'AuGPT' } });
      return r.ok ? String((await r.json()).tag_name || '').replace(/^v/, '') || null : null;
    } catch {
      return null;
    }
  }

  async estado() {
    const [instalada, disponivel] = await Promise.all([this.versao(), this.ultima()]);
    return {
      instalado: !!instalada && this.idiomasProntos(),
      instalada,
      disponivel,
      faltamIdiomas: !!instalada && !this.idiomasProntos(),
      atualizar: !!(instalada && disponivel && versaoMaisNova(disponivel, instalada)),
      manual: this.plataforma !== 'win32',
    };
  }

  async baixarIdiomas(emitir = () => {}) {
    fs.mkdirSync(this.tessdata, { recursive: true });
    for (const l of IDIOMAS) {
      const destino = path.join(this.tessdata, `${l}.traineddata`);
      if (this.existe(destino)) continue;
      emitir({ texto: `Baixando o idioma ${l === 'por' ? 'português' : 'inglês'}…` });
      const r = await this.buscar(urlDoIdioma(l), { signal: AbortSignal.timeout(3 * 60 * 1000), headers: { 'User-Agent': 'AuGPT' } });
      if (!r.ok) throw new Error(`não consegui baixar o idioma ${l} (HTTP ${r.status})`);
      const dados = Buffer.from(await r.arrayBuffer());
      if (dados.length < 100000) throw new Error(`o arquivo do idioma ${l} veio incompleto`);
      fs.writeFileSync(`${destino}.novo`, dados);
      fs.renameSync(`${destino}.novo`, destino);
    }
  }

  /** Instala (ou atualiza) pelo winget e baixa os idiomas. O Windows pode pedir permissão de administrador. */
  async instalar({ emitir = () => {} } = {}) {
    if (this.plataforma !== 'win32') {
      throw new Error(this.plataforma === 'darwin' ? 'No Mac, instale com: brew install tesseract' : 'No Linux, instale com: sudo apt install tesseract-ocr');
    }
    const jaTem = !!this.localizar();
    const versaoAntes = await this.versao();
    if (!jaTem || (await this.estado()).atualizar) {
      emitir({ texto: `${jaTem ? 'Atualizando' : 'Instalando'} o Tesseract pelo winget (o Windows pode pedir permissão)…` });
      try {
        await this.executar('winget', [jaTem ? 'upgrade' : 'install', '--id', PACOTE, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: 15 * 60 * 1000 });
      } catch (err) {
        const saida = `${err.stdout || ''} ${err.message}`;
        if (!/already installed|no available upgrade|nenhuma atualiza|já está instalado/i.test(saida)) throw new Error(`o winget não conseguiu instalar o Tesseract: ${err.message}`);
      }
      if (!this.localizar()) throw new Error('o Tesseract não apareceu depois da instalação — instale pelo site github.com/UB-Mannheim/tesseract e clique em "Verificar de novo"');
      if (jaTem && versaoAntes && (await this.versao()) === versaoAntes) emitir({ texto: 'O winget ainda não tem a versão nova; a atual continua.' });
    }
    await this.baixarIdiomas(emitir);
    emitir({ texto: 'Tesseract pronto.' });
    return this.estado();
  }

  /** O texto da imagem, em português e inglês. Vazio se não houver texto legível. */
  async lerTexto(arquivo) {
    const bin = this.localizar();
    if (!bin || !this.idiomasProntos()) throw new Error('o Tesseract não está instalado (Ajustes → Componentes)');
    if (!IMAGEM.test(arquivo)) throw new Error('o OCR lê só imagens (png, jpg, webp, bmp, gif, tiff)');
    const saida = await this.executar(bin, [arquivo, 'stdout', '-l', IDIOMAS.join('+'), '--tessdata-dir', this.tessdata, '--psm', '3'], { timeoutMs: 120000 });
    // o stderr do tesseract ("Estimating resolution…") vem junto: só o texto interessa
    return saida
      .split('\n')
      .filter((l) => !/^(Estimating resolution|Detected \d+ diacritics|Warning:|Tesseract Open Source|Page \d)/i.test(l.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

module.exports = { Tesseract, IMAGEM, PACOTE };
