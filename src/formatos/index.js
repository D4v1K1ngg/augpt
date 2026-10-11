'use strict';

const fs = require('fs');
const path = require('path');
const ooxml = require('./ooxml');
const { pdf } = require('./pdf');

/**
 * Descobre o formato e chama o extrator certo.
 * A extensão é só uma pista: a assinatura dos primeiros bytes manda mais,
 * porque arquivo renomeado é comum e `.txt` que na verdade é PDF acontece.
 */

const TEXTO = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yml', '.yaml', '.log',
  '.ini', '.cfg', '.conf', '.env', '.sql', '.html', '.htm', '.css', '.scss', '.svg',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.bat', '.ps1', '.lua', '.r',
  '.vue', '.svelte', '.toml', '.gitignore', '.dockerfile', '.makefile', '.srt', '.vtt',
]);

const BINARIOS = {
  '.docx': ooxml.docx,
  '.docm': ooxml.docx,
  '.xlsx': ooxml.xlsx,
  '.xlsm': ooxml.xlsx,
  '.pptx': ooxml.pptx,
  '.pptm': ooxml.pptx,
  '.odt': ooxml.odt,
  '.ods': ooxml.odt,
  '.odp': ooxml.odt,
  '.epub': ooxml.epub,
};

const NAO_SUPORTADOS = {
  '.doc': 'Word antigo (.doc, formato binário dos anos 90). Salve como .docx e tente de novo.',
  '.xls': 'Excel antigo (.xls). Salve como .xlsx e tente de novo.',
  '.ppt': 'PowerPoint antigo (.ppt). Salve como .pptx e tente de novo.',
  '.rar': 'Arquivo RAR. Extraia antes de anexar.',
  '.7z': 'Arquivo 7z. Extraia antes de anexar.',
  '.png': 'Imagem. Para descrever imagem é preciso um modelo com visão (ex.: llava, llama3.2-vision).',
  '.jpg': 'Imagem. Para descrever imagem é preciso um modelo com visão (ex.: llava, llama3.2-vision).',
  '.jpeg': 'Imagem. Para descrever imagem é preciso um modelo com visão.',
  '.gif': 'Imagem. Para descrever imagem é preciso um modelo com visão.',
  '.webp': 'Imagem. Para descrever imagem é preciso um modelo com visão.',
  '.mp3': 'Áudio. Transcrição exige um modelo de fala, que este app não embute.',
  '.mp4': 'Vídeo. Não há extração de conteúdo de vídeo aqui.',
  '.zip': 'Arquivo ZIP genérico. Extraia com executar_comando e leia os arquivos de dentro.',
};

/** Assinatura dos primeiros bytes — mais confiável que a extensão. */
function assinatura(buffer) {
  const inicio = buffer.subarray(0, 8);
  if (inicio.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (inicio[0] === 0x50 && inicio[1] === 0x4b) return 'zip'; // PK: docx, xlsx, pptx, odt, epub
  if (inicio.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') return 'ole'; // .doc/.xls antigos
  if (inicio.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  return null;
}

/** Dentro de um ZIP, qual formato de escritório é? */
function tipoDeZip(buffer) {
  try {
    const { entradas } = require('./zip').abrir(buffer, () => false);
    const nomes = entradas.map((e) => e.nome);
    if (nomes.includes('word/document.xml')) return ooxml.docx;
    if (nomes.some((n) => n.startsWith('xl/'))) return ooxml.xlsx;
    if (nomes.some((n) => n.startsWith('ppt/slides/'))) return ooxml.pptx;
    if (nomes.includes('content.xml')) return ooxml.odt;
    if (nomes.some((n) => n.toLowerCase().endsWith('.opf'))) return ooxml.epub;
  } catch {
    /* segue para o erro genérico */
  }
  return null;
}

function rtf(buffer) {
  const bruto = buffer.toString('latin1');
  const texto = bruto
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from(h, 'hex').toString('latin1'))
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\{\\\*[\s\S]*?\}/g, '')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { texto, meta: { formato: 'rtf' } };
}

function comoTexto(buffer, ext) {
  // Detecta UTF-16 e ISO-8859-1, senão trata como UTF-8
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le');
  const utf8 = buffer.toString('utf8');
  const invalidos = (utf8.match(/\uFFFD/g) || []).length;
  const texto = invalidos > utf8.length / 200 ? buffer.toString('latin1') : utf8;

  if (ext === '.json') {
    try {
      return JSON.stringify(JSON.parse(texto), null, 2);
    } catch {
      return texto;
    }
  }
  return texto;
}

/**
 * Extrai o texto de um arquivo, qualquer que seja o formato suportado.
 * Devolve sempre { texto, tipo, meta } — quem chama não precisa saber de nada.
 */
function extrair(caminho, { limite = 200_000 } = {}) {
  const ext = path.extname(caminho).toLowerCase();
  const stat = fs.statSync(caminho);

  if (stat.size > 80 * 1024 * 1024) {
    throw new Error(`arquivo grande demais (${Math.round(stat.size / 1048576)} MB). Limite: 80 MB.`);
  }

  const buffer = fs.readFileSync(caminho);
  const assinado = assinatura(buffer);

  if (assinado === 'pdf') {
    const r = pdf(buffer, { caminho, limite });
    return { texto: r.texto, tipo: 'pdf', meta: r.meta };
  }

  if (assinado === 'zip') {
    const extrator = BINARIOS[ext] || tipoDeZip(buffer);
    if (!extrator) {
      throw new Error(NAO_SUPORTADOS['.zip']);
    }
    const r = extrator(buffer);
    const texto = r.texto.length > limite
      ? `${r.texto.slice(0, limite)}\n\n[…${r.texto.length - limite} caracteres restantes não exibidos]`
      : r.texto;
    return { texto, tipo: ext.replace('.', '') || 'ooxml', meta: r.meta };
  }

  if (assinado === 'rtf') {
    const r = rtf(buffer);
    return { texto: r.texto.slice(0, limite), tipo: 'rtf', meta: r.meta };
  }

  if (assinado === 'ole') {
    throw new Error(NAO_SUPORTADOS[ext] || NAO_SUPORTADOS['.doc']);
  }

  if (NAO_SUPORTADOS[ext]) throw new Error(NAO_SUPORTADOS[ext]);

  // Sem assinatura conhecida: trata como texto, mas confere se é binário mesmo
  const amostra = buffer.subarray(0, 2000);
  const nulos = amostra.filter((b) => b === 0).length;
  if (nulos > 3 && !TEXTO.has(ext)) {
    throw new Error(`formato binário não reconhecido (${ext || 'sem extensão'}).`);
  }

  const texto = comoTexto(buffer, ext);
  return {
    texto: texto.length > limite ? `${texto.slice(0, limite)}\n\n[…truncado]` : texto,
    tipo: ext.replace('.', '') || 'texto',
    meta: { linhas: texto.split('\n').length, bytes: stat.size },
  };
}

module.exports = { extrair, assinatura, TEXTO, BINARIOS, NAO_SUPORTADOS };
