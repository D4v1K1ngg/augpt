'use strict';

const zlib = require('zlib');

/**
 * Escritor de ZIP.
 *
 * docx e xlsx são pacotes ZIP com XML dentro. O projeto já tinha um LEITOR de
 * ZIP sem dependências; com o escritor, a geração desses formatos deixa de
 * exigir Python — que era a única razão para `gerar_docx` e `gerar_xlsx`
 * aparecerem indisponíveis na máquina de quem não instalou as bibliotecas.
 */

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) c = (c >>> 8) ^ TABELA_CRC[(c ^ buffer[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** Data no formato MS-DOS que o ZIP usa desde 1989. */
function dataDos(quando = new Date()) {
  const hora =
    (quando.getHours() << 11) | (quando.getMinutes() << 5) | (Math.floor(quando.getSeconds() / 2) & 0x1f);
  const data =
    ((Math.max(1980, quando.getFullYear()) - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate();
  return { hora, data };
}

/**
 * Monta o ZIP. `arquivos` é um objeto { 'caminho/no/zip': conteúdo }, onde o
 * conteúdo pode ser string ou Buffer.
 */
function zipar(arquivos, { quando = new Date() } = {}) {
  const { hora, data } = dataDos(quando);
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const bruto = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8');
    const comprimido = zlib.deflateRawSync(bruto, { level: 6 });
    // arquivo minúsculo às vezes cresce ao comprimir; nesse caso guarda cru
    const usarDeflate = comprimido.length < bruto.length;
    const dados = usarDeflate ? comprimido : bruto;
    const metodo = usarDeflate ? 8 : 0;
    const nomeBuf = Buffer.from(nome, 'utf8');
    const soma = crc32(bruto);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão mínima
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);

    locais.push(local, nomeBuf, dados);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(soma, 16);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(bruto.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(deslocamento, 42);

    centrais.push(central, nomeBuf);
    deslocamento += local.length + nomeBuf.length + dados.length;
  }

  const corpoCentral = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...locais, corpoCentral, fim]);
}

/** Escapa o que vai dentro de um nó XML. */
const xml = (texto) =>
  String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // caracteres de controle quebram o XML e alguns modelos os produzem
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

module.exports = { zipar, crc32, xml };
