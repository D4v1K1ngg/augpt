'use strict';

const crypto = require('crypto');

/**
 * Manipulador de segurança padrão do PDF.
 *
 * Boleto de banco, fatura e extrato quase sempre vêm com criptografia de senha
 * VAZIA: não pedem nada para abrir, mas os streams estão cifrados. Sem tratar
 * isso, a descompressão falha e o arquivo parece ser uma imagem digitalizada.
 *
 * Cobre o caso comum: RC4 (V1/V2, R2–R4) e AES-128 (V4/AESV2).
 * AES-256 (V5/R6) é detectado e reportado, sem tentativa de adivinhação.
 */

const PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...partes) => {
  const h = crypto.createHash('md5');
  for (const p of partes) h.update(p);
  return h.digest();
};

/** RC4 em ~15 linhas. O Node removeu o RC4 do OpenSSL, então vai na mão. */
function rc4(chave, dados) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + chave[i % chave.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }

  const saida = Buffer.allocUnsafe(dados.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < dados.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    saida[k] = dados[k] ^ s[(s[i] + s[j]) & 255];
  }
  return saida;
}

/* ------------------------------ leitura do dicionário ------------------------------ */

/** Strings do PDF vêm como (literal com escapes) ou <hex>. */
function lerString(texto, indice) {
  const c = texto[indice];
  if (c === '<') {
    const fim = texto.indexOf('>', indice);
    const hex = texto.slice(indice + 1, fim).replace(/[^0-9a-fA-F]/g, '');
    return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  }
  if (c !== '(') return null;

  const bytes = [];
  let profundidade = 1;
  let i = indice + 1;
  while (i < texto.length && profundidade > 0) {
    const ch = texto[i];
    if (ch === '\\') {
      const seguinte = texto[i + 1];
      const oct = /^[0-7]{1,3}/.exec(texto.slice(i + 1));
      if (oct) {
        bytes.push(parseInt(oct[0], 8) & 255);
        i += 1 + oct[0].length;
        continue;
      }
      const mapa = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      bytes.push(mapa[seguinte] ?? seguinte.charCodeAt(0));
      i += 2;
      continue;
    }
    if (ch === '(') profundidade += 1;
    if (ch === ')') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
    bytes.push(ch.charCodeAt(0) & 255);
    i += 1;
  }
  return Buffer.from(bytes);
}

function valorString(dicionario, chave) {
  const i = dicionario.indexOf(chave);
  if (i === -1) return null;
  let j = i + chave.length;
  while (j < dicionario.length && /\s/.test(dicionario[j])) j += 1;
  return lerString(dicionario, j);
}

const valorNumero = (dicionario, chave) => {
  const m = new RegExp(`${chave}\\s*(-?\\d+)`).exec(dicionario);
  return m ? Number(m[1]) : null;
};

/** Localiza o dicionário de criptografia e o primeiro elemento do /ID. */
function detectar(buffer) {
  const texto = buffer.toString('latin1');
  const i = texto.indexOf('/Filter/Standard') >= 0
    ? texto.indexOf('/Filter/Standard')
    : texto.indexOf('/Filter /Standard');
  if (i === -1) return null;

  // recorta o objeto que contém o dicionário
  const inicio = texto.lastIndexOf('obj', i);
  const fim = texto.indexOf('endobj', i);
  const dicionario = texto.slice(inicio, fim === -1 ? i + 600 : fim);

  const v = valorNumero(dicionario, '/V') ?? 1;
  const r = valorNumero(dicionario, '/R') ?? 2;
  const bits = valorNumero(dicionario, '/Length') ?? 40;
  const p = valorNumero(dicionario, '/P') ?? -1;
  const o = valorString(dicionario, '/O');
  const u = valorString(dicionario, '/U');

  let metodo = 'rc4';
  if (v >= 5) metodo = 'aes256';
  else if (/\/AESV2/.test(dicionario)) metodo = 'aes128';
  else if (/\/CF\s*<<[\s\S]*?\/V2/.test(dicionario) || v <= 2) metodo = 'rc4';

  // primeiro elemento do /ID, necessário na derivação da chave
  const idMatch = /\/ID\s*\[\s*(<[^>]*>|\([^)]*\))/.exec(texto);
  const id = idMatch ? lerString(idMatch[1], 0) : Buffer.alloc(0);

  return { v, r, bits, p, o, u, id, metodo, dicionario };
}

/**
 * Algoritmo 2 da especificação: deriva a chave do arquivo a partir da senha.
 * Aqui a senha é sempre a vazia — que é o caso de 99% dos boletos.
 */
function derivarChave(info) {
  const { r, bits, p, o, id } = info;
  const tamanho = r === 2 ? 5 : Math.max(5, Math.min(16, Math.floor(bits / 8)));

  const pBuffer = Buffer.alloc(4);
  pBuffer.writeInt32LE(p | 0, 0);

  const partes = [PADDING, o || Buffer.alloc(32), pBuffer, id || Buffer.alloc(0)];
  if (r >= 4 && /\/EncryptMetadata\s+false/.test(info.dicionario)) {
    partes.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  }

  let chave = md5(...partes).subarray(0, tamanho);
  if (r >= 3) {
    for (let i = 0; i < 50; i += 1) chave = md5(chave.subarray(0, tamanho)).subarray(0, tamanho);
  }
  return chave;
}

/** Chave específica de cada objeto (algoritmo 1). */
function chaveDoObjeto(chaveArquivo, numero, geracao, metodo) {
  const extra = Buffer.from([
    numero & 255, (numero >> 8) & 255, (numero >> 16) & 255,
    geracao & 255, (geracao >> 8) & 255,
  ]);
  const partes = [chaveArquivo, extra];
  if (metodo === 'aes128') partes.push(Buffer.from([0x73, 0x41, 0x6c, 0x54])); // "sAlT"
  return md5(...partes).subarray(0, Math.min(chaveArquivo.length + 5, 16));
}

function decifrar(dados, chaveArquivo, numero, geracao, metodo) {
  if (metodo === 'aes256') throw new Error('AES-256 (PDF 2.0) não suportado');

  const chave = chaveDoObjeto(chaveArquivo, numero, geracao, metodo);

  if (metodo === 'aes128') {
    if (dados.length <= 16) return Buffer.alloc(0);
    const iv = dados.subarray(0, 16);
    const corpo = dados.subarray(16, dados.length - (dados.length % 16));
    const d = crypto.createDecipheriv('aes-128-cbc', chave, iv);
    d.setAutoPadding(false);
    const saida = Buffer.concat([d.update(corpo), d.final()]);
    const preenchimento = saida[saida.length - 1];
    return preenchimento >= 1 && preenchimento <= 16 ? saida.subarray(0, saida.length - preenchimento) : saida;
  }

  return rc4(chave, dados);
}

module.exports = { detectar, derivarChave, decifrar, rc4, lerString };
