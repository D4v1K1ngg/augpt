'use strict';

const { zipar, xml } = require('./zip-escrita');

/**
 * Gerador de .docx a partir de markdown.
 *
 * O formato é um ZIP com XML dentro (OOXML). Escrever o mínimo viável — que o
 * Word, o LibreOffice e o Google Docs abrem — dá em torno de 200 linhas e
 * elimina a dependência de Python que deixava `gerar_docx` indisponível.
 *
 * Aceita markdown porque é o que o modelo já produz bem: títulos, listas,
 * negrito, itálico, código e tabelas.
 */

const TIPOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const RELS_DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const estiloTitulo = (nivel, tamanho) => `<w:style w:type="paragraph" w:styleId="Heading${nivel}">
<w:name w:val="heading ${nivel}"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="${240 - nivel * 30}" w:after="120"/><w:outlineLvl w:val="${nivel - 1}"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="${tamanho}"/><w:szCs w:val="${tamanho}"/></w:rPr></w:style>`;

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>
<w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${estiloTitulo(1, 40)}${estiloTitulo(2, 32)}${estiloTitulo(3, 26)}${estiloTitulo(4, 24)}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="454"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>
<w:pPr><w:shd w:val="clear" w:fill="F4F4F4"/><w:spacing w:after="60"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
<w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="BBBBBB"/><w:left w:val="single" w:sz="4" w:color="BBBBBB"/>
<w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/><w:right w:val="single" w:sz="4" w:color="BBBBBB"/>
<w:insideH w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideV w:val="single" w:sz="4" w:color="BBBBBB"/>
</w:tblBorders></w:tblPr></w:style>
</w:styles>`;

/** Negrito, itálico, código e link viram trechos formatados dentro do parágrafo. */
function trechos(texto) {
  const partes = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|__(.+?)__|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let ultimo = 0;
  let m;

  const bruto = (t) => {
    if (t) partes.push({ texto: t });
  };

  while ((m = re.exec(texto))) {
    bruto(texto.slice(ultimo, m.index));
    if (m[2]) partes.push({ texto: m[2], negrito: true, italico: true });
    else if (m[3]) partes.push({ texto: m[3], negrito: true });
    else if (m[4]) partes.push({ texto: m[4], italico: true });
    else if (m[5]) partes.push({ texto: m[5], negrito: true });
    else if (m[6]) partes.push({ texto: m[6], italico: true });
    else if (m[7]) partes.push({ texto: m[7], codigo: true });
    else if (m[8]) partes.push({ texto: `${m[8]} (${m[9]})`, link: true });
    ultimo = m.index + m[0].length;
  }
  bruto(texto.slice(ultimo));
  return partes.length ? partes : [{ texto }];
}

function corrida(parte) {
  const props = [
    parte.negrito ? '<w:b/>' : '',
    parte.italico ? '<w:i/>' : '',
    parte.codigo ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F4F4F4"/>' : '',
    parte.link ? '<w:color w:val="1155CC"/><w:u w:val="single"/>' : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(parte.texto)}</w:t></w:r>`;
}

const paragrafo = (texto, { estilo, lista, nivel = 0 } = {}) => {
  const props = [
    estilo ? `<w:pStyle w:val="${estilo}"/>` : '',
    lista ? `<w:numPr><w:ilvl w:val="${nivel}"/><w:numId w:val="0"/></w:numPr><w:ind w:left="${360 + nivel * 360}" w:hanging="360"/>` : '',
  ].join('');
  const conteudo = trechos(lista ? `${lista === 'ordenada' ? '' : '• '}${texto}` : texto).map(corrida).join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${conteudo}</w:p>`;
};

function tabela(linhas) {
  const colunas = Math.max(...linhas.map((l) => l.length));
  const largura = Math.floor(9000 / colunas);

  const celula = (texto, cabecalho) =>
    `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${
      cabecalho ? '<w:shd w:val="clear" w:fill="EFEFEF"/>' : ''
    }</w:tcPr>${paragrafo(cabecalho ? `**${texto}**` : texto)}</w:tc>`;

  const corpo = linhas
    .map((linha, i) => {
      const celulas = [...linha];
      while (celulas.length < colunas) celulas.push('');
      return `<w:tr>${celulas.map((c) => celula(c, i === 0)).join('')}</w:tr>`;
    })
    .join('');

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${corpo}</w:tbl>`;
}

/** Markdown → blocos do documento. */
function converter(markdown) {
  const linhas = String(markdown || '').split(/\r?\n/);
  const blocos = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    if (!linha.trim()) {
      i += 1;
      continue;
    }

    // bloco de código
    if (/^```/.test(linha)) {
      i += 1;
      const codigo = [];
      while (i < linhas.length && !/^```/.test(linhas[i])) {
        codigo.push(linhas[i]);
        i += 1;
      }
      i += 1;
      for (const l of codigo) blocos.push(paragrafo(l || ' ', { estilo: 'Code' }));
      continue;
    }

    // tabela: precisa da linha separadora logo abaixo
    if (/^\s*\|/.test(linha) && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || '')) {
      const celulas = (l) =>
        l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const dados = [celulas(linha)];
      i += 2;
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
        dados.push(celulas(linhas[i]));
        i += 1;
      }
      blocos.push(tabela(dados));
      blocos.push('<w:p/>');
      continue;
    }

    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (titulo) {
      blocos.push(paragrafo(titulo[2], { estilo: `Heading${titulo[1].length}` }));
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      blocos.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>');
      i += 1;
      continue;
    }

    const citacao = /^>\s?(.*)$/.exec(linha);
    if (citacao) {
      blocos.push(paragrafo(citacao[1], { estilo: 'Quote' }));
      i += 1;
      continue;
    }

    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linha);
    if (item) {
      const nivel = Math.min(2, Math.floor(item[1].length / 2));
      const ordenada = /\d/.test(item[2]);
      blocos.push(
        paragrafo(ordenada ? `${item[2]} ${item[3]}` : item[3], {
          lista: ordenada ? 'ordenada' : 'marcador',
          nivel,
        })
      );
      i += 1;
      continue;
    }

    blocos.push(paragrafo(linha.trim()));
    i += 1;
  }

  return blocos;
}

/** Gera o buffer do .docx. */
function gerarDocx({ conteudo, titulo = 'Documento', autor = 'AuGPT' }) {
  const blocos = converter(conteudo);
  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${blocos.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709"/>
</w:sectPr></w:body></w:document>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(titulo)}</dc:title><dc:creator>${xml(autor)}</dc:creator>
<cp:lastModifiedBy>${xml(autor)}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified>
</cp:coreProperties>`;

  return zipar({
    '[Content_Types].xml': TIPOS,
    '_rels/.rels': RELS,
    'word/document.xml': documento,
    'word/_rels/document.xml.rels': RELS_DOC,
    'word/styles.xml': ESTILOS,
    'docProps/core.xml': core,
  });
}

module.exports = { gerarDocx, converter, trechos };
