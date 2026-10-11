'use strict';

const zlib = require('zlib');
const { spawnSync } = require('child_process');
const cripto = require('./pdf-cripto');

/**
 * Extração de texto de PDF sem dependências.
 *
 * PDF não guarda texto corrido: guarda instruções de desenho dentro de streams
 * comprimidos. Aqui a gente descomprime os streams e interpreta os operadores
 * de texto (Tj, TJ, ', "), reconstruindo linhas pela posição vertical.
 *
 * Limites honestos: PDF de digitalização (imagem) não tem texto nenhum para
 * extrair — precisa de OCR. Fonte com codificação Identity-H sem mapa ToUnicode
 * devolve caracteres embaralhados; isso é detectado e reportado.
 */

/* ------------------------------ filtros ------------------------------ */

/** ASCII85: cinco caracteres imprimíveis viram quatro bytes. */
function ascii85(entrada) {
  const limpo = entrada.replace(/^<~/, '').replace(/~>[\s\S]*$/, '').replace(/\s/g, '');
  const bytes = [];
  let grupo = [];

  for (const c of limpo) {
    if (c === 'z' && grupo.length === 0) {
      bytes.push(0, 0, 0, 0);
      continue;
    }
    const v = c.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    grupo.push(v);
    if (grupo.length === 5) {
      let n = 0;
      for (const g of grupo) n = n * 85 + g;
      bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      grupo = [];
    }
  }

  if (grupo.length > 1) {
    const faltam = 5 - grupo.length;
    let n = 0;
    for (const g of [...grupo, ...Array(faltam).fill(84)]) n = n * 85 + g;
    const completos = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    bytes.push(...completos.slice(0, grupo.length - 1));
  }
  return Buffer.from(bytes);
}

function asciiHex(entrada) {
  const hex = entrada.replace(/>[\s\S]*$/, '').replace(/[^0-9a-fA-F]/g, '');
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
}

function runLength(entrada) {
  const bytes = [];
  let i = 0;
  while (i < entrada.length) {
    const n = entrada[i];
    if (n === 128) break;
    if (n < 128) {
      for (let k = 0; k <= n; k += 1) bytes.push(entrada[i + 1 + k]);
      i += n + 2;
    } else {
      for (let k = 0; k < 257 - n; k += 1) bytes.push(entrada[i + 1]);
      i += 2;
    }
  }
  return Buffer.from(bytes);
}

/**
 * O /Filter pode ser um nome só ou uma CADEIA — reportlab usa
 * [ /ASCII85Decode /FlateDecode ], nessa ordem. Aplicar só o Flate falha.
 */
function aplicarFiltros(bruto, dicionario) {
  const declaracao = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dicionario)?.[1] || '';
  const filtros = [...declaracao.matchAll(/\/(\w+)/g)].map((m) => m[1]);
  if (!filtros.length) return bruto;

  let dados = bruto;
  for (const filtro of filtros) {
    switch (filtro) {
      case 'FlateDecode':
        try {
          dados = zlib.inflateSync(dados);
        } catch {
          dados = zlib.inflateRawSync(dados);
        }
        break;
      case 'ASCII85Decode':
        dados = ascii85(dados.toString('latin1'));
        break;
      case 'ASCIIHexDecode':
        dados = asciiHex(dados.toString('latin1'));
        break;
      case 'RunLengthDecode':
        dados = runLength(dados);
        break;
      case 'Crypt':
        break; // identidade na prática
      default:
        throw new Error(`filtro ${filtro} não suportado`);
    }
  }
  return dados;
}

/* ------------------------------ streams ------------------------------ */

function descomprimirStreams(buffer, seguranca = null) {
  const conteudos = [];
  const marcador = Buffer.from('stream');
  let pos = 0;

  while ((pos = buffer.indexOf(marcador, pos)) !== -1) {
    // "stream" também aparece dentro de "endstream": ignora esses casos
    if (pos >= 3 && buffer.toString('latin1', pos - 3, pos) === 'end') {
      pos += marcador.length;
      continue;
    }

    const inicioDicionario = Math.max(0, pos - 900);
    const trecho = buffer.toString('latin1', inicioDicionario, pos);

    // O dicionário é só o que vem depois do "N G obj" mais recente. Sem esse
    // recorte, o lookback pega o objeto anterior e um stream de texto herda
    // o /Subtype/Image do vizinho — e some do resultado.
    const objs = [...trecho.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)];
    const ultimo = objs[objs.length - 1];
    const dicionario = ultimo ? trecho.slice(ultimo.index) : trecho;
    const numeroObjeto = ultimo ? Number(ultimo[1]) : 0;
    const geracao = ultimo ? Number(ultimo[2]) : 0;

    let dados = pos + marcador.length;
    if (buffer[dados] === 0x0d) dados += 1;
    if (buffer[dados] === 0x0a) dados += 1;

    const fim = buffer.indexOf(Buffer.from('endstream'), dados);
    if (fim === -1) break;

    let bruto = buffer.subarray(dados, fim);
    pos = fim + 9;

    // imagens e fontes embutidas não têm texto
    if (/\/Subtype\s*\/(Image|Type1C|TrueType|CIDFontType\dC)/.test(dicionario)) continue;
    if (/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)/.test(dicionario)) continue;

    if (seguranca) {
      try {
        bruto = cripto.decifrar(bruto, seguranca.chave, numeroObjeto, geracao, seguranca.metodo);
      } catch {
        continue; // objeto que não conseguimos decifrar
      }
    }

    try {
      conteudos.push(aplicarFiltros(bruto, dicionario).toString('latin1'));
    } catch {
      /* stream corrompido ou com filtro que não sabemos abrir: segue */
    }
  }
  return conteudos;
}

/* ------------------------------ strings do PDF ------------------------------ */

const OCTAL = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

function lerStringLiteral(texto, i) {
  // i aponta para o '(' de abertura
  let profundidade = 1;
  let saida = '';
  i += 1;
  while (i < texto.length && profundidade > 0) {
    const c = texto[i];
    if (c === '\\') {
      const seguinte = texto[i + 1];
      if (seguinte >= '0' && seguinte <= '7') {
        const oct = /^[0-7]{1,3}/.exec(texto.slice(i + 1))[0];
        saida += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
        continue;
      }
      if (seguinte === '\n') {
        i += 2;
        continue;
      }
      saida += OCTAL[seguinte] ?? seguinte;
      i += 2;
      continue;
    }
    if (c === '(') profundidade += 1;
    if (c === ')') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
    saida += c;
    i += 1;
  }
  return { texto: saida, fim: i + 1 };
}

function lerStringHex(texto, i) {
  const fim = texto.indexOf('>', i);
  if (fim === -1) return { texto: '', fim: texto.length };
  const hex = texto.slice(i + 1, fim).replace(/[^0-9a-fA-F]/g, '');
  let saida = '';
  // pares = byte simples; UTF-16BE aparece como sequência de 4 dígitos
  if (hex.length % 4 === 0 && /^(00|d[89ab])/i.test(hex)) {
    for (let k = 0; k < hex.length; k += 4) saida += String.fromCharCode(parseInt(hex.substr(k, 4), 16));
  } else {
    for (let k = 0; k < hex.length; k += 2) saida += String.fromCharCode(parseInt(hex.substr(k, 2), 16) || 32);
  }
  return { texto: saida, fim: fim + 1 };
}

/* ------------------------------ operadores de texto ------------------------------ */

function extrairDoConteudo(conteudo) {
  const linhas = [];
  let atual = '';
  let i = 0;

  const quebrar = () => {
    const limpa = atual.replace(/[ \t]+/g, ' ').trim();
    if (limpa) linhas.push(limpa);
    atual = '';
  };

  while (i < conteudo.length) {
    const c = conteudo[i];

    if (c === '(') {
      const { texto, fim } = lerStringLiteral(conteudo, i);
      atual += texto;
      i = fim;
      continue;
    }
    if (c === '<' && conteudo[i + 1] !== '<') {
      const { texto, fim } = lerStringHex(conteudo, i);
      atual += texto;
      i = fim;
      continue;
    }

    // operadores de posicionamento indicam nova linha
    if (c === 'T' && (conteudo[i + 1] === 'd' || conteudo[i + 1] === 'D' || conteudo[i + 1] === '*')) {
      quebrar();
      i += 2;
      continue;
    }
    if (c === 'E' && conteudo.substr(i, 2) === 'ET') {
      quebrar();
      i += 2;
      continue;
    }
    // TJ com deslocamento grande costuma ser espaço entre palavras
    if (c === 'T' && conteudo[i + 1] === 'J') {
      atual += ' ';
      i += 2;
      continue;
    }
    i += 1;
  }
  quebrar();
  return linhas;
}

/* ------------------------------ qualidade ------------------------------ */

/**
 * Texto embaralhado (fonte sem ToUnicode) tem pouca vogal e muito símbolo.
 *
 * Caso real (chat "Como funciona as ondas de radio frequencia", 2026-09-19):
 * um PDF acadêmico tinha capa/resumo numa fonte normal (legível) seguida de
 * um corpo grande embutido numa fonte sem mapa de codificação (embaralhado)
 * — 82% do texto extraído era lixo. A amostra antiga olhava só os primeiros
 * 4000 caracteres, então aprovava o documento inteiro pela capa e o corpo
 * embaralhado ia direto pro material coletado sem aviso nenhum (a
 * verificação de `meta.aviso` em `src/tools/extract.js`, que já existia pra
 * outro incidente parecido — PMBOK, 2026-09-18 — nunca disparava). Agora a
 * amostra espalha o mesmo orçamento de caracteres (5 janelas de 800) por
 * 0%/20%/40%/60%/80% do texto inteiro, em vez de só o início — pega
 * embaralhamento em qualquer trecho do documento, não só se ele abrir a
 * capa com lixo.
 */
function pareceLegivel(texto) {
  const JANELAS = 5;
  const TAMANHO_JANELA = 800;
  const amostra =
    texto.length <= JANELAS * TAMANHO_JANELA
      ? texto
      : Array.from({ length: JANELAS }, (_, k) => {
          const inicio = Math.floor((k / JANELAS) * texto.length);
          return texto.slice(inicio, inicio + TAMANHO_JANELA);
        }).join('');
  if (amostra.replace(/\s/g, '').length < 40) return false;
  const letras = (amostra.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  const total = amostra.replace(/\s/g, '').length || 1;
  const vogais = (amostra.match(/[aeiouAEIOUáéíóúâêôãõà]/g) || []).length;
  return letras / total > 0.55 && vogais / (letras || 1) > 0.22;
}

/** Última tentativa: se houver Python com biblioteca de PDF, usa. */
function tentarPython(caminho) {
  const script = `
import sys
try:
    import pdfplumber
    with pdfplumber.open(sys.argv[1]) as pdf:
        print("\\n\\n".join((p.extract_text() or "") for p in pdf.pages))
    sys.exit(0)
except ImportError:
    pass
try:
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        sys.exit(3)
r = PdfReader(sys.argv[1])
print("\\n\\n".join((p.extract_text() or "") for p in r.pages))
`;
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['-c', script, caminho], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (r.status === 0 && r.stdout?.trim().length > 40) {
      return r.stdout.trim();
    }
  }
  return null;
}

/* ------------------------------ entrada ------------------------------ */

function pdf(buffer, { caminho, limite = 200_000 } = {}) {
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('não é um arquivo PDF (assinatura %PDF- ausente)');
  }

  const paginas = (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null;

  // Boleto, fatura e extrato costumam vir cifrados com senha vazia: abrem em
  // qualquer leitor, mas os streams estão embaralhados.
  let seguranca = null;
  let criptografia = null;
  const info = cripto.detectar(buffer);
  if (info) {
    criptografia = `${info.metodo} (V${info.v}/R${info.r})`;
    if (info.metodo === 'aes256') {
      throw new Error(
        'PDF protegido com AES-256, que este leitor não abre. ' +
          'Instale o suporte com `pip install pypdf` e tente de novo, ou salve o arquivo sem senha.'
      );
    }
    seguranca = { chave: cripto.derivarChave(info), metodo: info.metodo };
  }

  const conteudos = descomprimirStreams(buffer, seguranca);
  const linhas = conteudos.flatMap(extrairDoConteudo);
  let texto = linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let via = 'nativo';
  let aviso = null;

  if (!pareceLegivel(texto)) {
    const doPython = caminho ? tentarPython(caminho) : null;
    if (doPython && pareceLegivel(doPython)) {
      texto = doPython;
      via = 'python';
    } else if (!texto) {
      const temImagem = /\/Subtype\s*\/Image/.test(buffer.toString('latin1'));
      aviso = temImagem
        ? 'Nenhum texto extraível: o PDF é digitalizado (só imagem). Precisaria de OCR — ' +
          '`pip install pytesseract pdf2image` e depois executar_codigo.'
        : 'Nenhum texto extraível deste PDF, e ele não parece ser digitalizado. ' +
          'Pode ter estrutura incomum; `pip install pdfplumber` costuma resolver.';
    } else {
      aviso =
        'A extração pode estar incompleta ou com caracteres trocados (fonte sem mapa de codificação). ' +
        'Para melhor resultado: `pip install pdfplumber` e tente de novo.';
    }
  }

  if (texto.length > limite) {
    texto = `${texto.slice(0, limite)}\n\n[…${texto.length - limite} caracteres restantes não exibidos]`;
  }

  return { texto, meta: { paginas, streams: conteudos.length, via, criptografia, aviso } };
}

module.exports = { pdf, descomprimirStreams, extrairDoConteudo, pareceLegivel, aplicarFiltros, ascii85 };
