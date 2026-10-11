'use strict';

const zlib = require('zlib');

/**
 * Leitor de ZIP mínimo. docx, xlsx, pptx, odt e epub são todos arquivos ZIP
 * com XML dentro — então um leitor de ZIP destrava cinco formatos de uma vez.
 * O Node já traz o inflate, então isto não custa nenhuma dependência.
 */

const FIM_DIRETORIO = 0x06054b50;
const ENTRADA_DIRETORIO = 0x02014b50;
const CABECALHO_LOCAL = 0x04034b50;

function acharFimDoDiretorio(buffer) {
  // O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele.
  const limite = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= limite; i -= 1) {
    if (buffer.readUInt32LE(i) === FIM_DIRETORIO) return i;
  }
  return -1;
}

/** Lê o diretório central e devolve a lista de arquivos contidos. */
function listar(buffer) {
  const fim = acharFimDoDiretorio(buffer);
  if (fim === -1) throw new Error('não é um arquivo ZIP válido (fim do diretório não encontrado)');

  const total = buffer.readUInt16LE(fim + 10);
  let offset = buffer.readUInt32LE(fim + 16);

  if (offset === 0xffffffff) {
    throw new Error('ZIP64 não suportado — o arquivo é grande demais para este leitor');
  }

  const entradas = [];
  for (let i = 0; i < total; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ENTRADA_DIRETORIO) break;

    const metodo = buffer.readUInt16LE(offset + 10);
    const tamanhoComprimido = buffer.readUInt32LE(offset + 20);
    const tamanhoOriginal = buffer.readUInt32LE(offset + 24);
    const tamanhoNome = buffer.readUInt16LE(offset + 28);
    const tamanhoExtra = buffer.readUInt16LE(offset + 30);
    const tamanhoComentario = buffer.readUInt16LE(offset + 32);
    const inicioLocal = buffer.readUInt32LE(offset + 42);
    const nome = buffer.toString('utf8', offset + 46, offset + 46 + tamanhoNome);

    entradas.push({ nome, metodo, tamanhoComprimido, tamanhoOriginal, inicioLocal });
    offset += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }
  return entradas;
}

/** Extrai o conteúdo de uma entrada, seguindo até o cabeçalho local. */
function extrairEntrada(buffer, entrada) {
  const inicio = entrada.inicioLocal;
  if (buffer.readUInt32LE(inicio) !== CABECALHO_LOCAL) {
    throw new Error(`cabeçalho local inválido em ${entrada.nome}`);
  }
  const tamanhoNome = buffer.readUInt16LE(inicio + 26);
  const tamanhoExtra = buffer.readUInt16LE(inicio + 28);
  const dados = inicio + 30 + tamanhoNome + tamanhoExtra;
  const bruto = buffer.subarray(dados, dados + entrada.tamanhoComprimido);

  if (entrada.metodo === 0) return Buffer.from(bruto); // armazenado sem compressão
  if (entrada.metodo === 8) return zlib.inflateRawSync(bruto); // deflate
  throw new Error(`método de compressão ${entrada.metodo} não suportado em ${entrada.nome}`);
}

/**
 * Abre o ZIP e devolve um mapa nome → conteúdo, só das entradas que interessam.
 * O filtro evita descomprimir imagens e mídias de um .docx de 40 MB à toa.
 */
function abrir(buffer, filtro) {
  const entradas = listar(buffer);
  const arquivos = new Map();
  for (const entrada of entradas) {
    if (entrada.nome.endsWith('/')) continue;
    if (filtro && !filtro(entrada.nome)) continue;
    try {
      arquivos.set(entrada.nome, extrairEntrada(buffer, entrada));
    } catch (err) {
      arquivos.set(entrada.nome, Buffer.from(`[falha ao extrair: ${err.message}]`));
    }
  }
  return { arquivos, entradas };
}

module.exports = { abrir, listar, extrairEntrada };
