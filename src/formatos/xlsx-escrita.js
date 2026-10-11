'use strict';

const { zipar, xml } = require('./zip-escrita');

/**
 * Gerador de .xlsx sem dependências.
 *
 * O trabalho de verdade não é o XML — é decidir o TIPO de cada célula. Planilha
 * onde todo número virou texto não soma, não ordena e não vira gráfico; é uma
 * tabela disfarçada. Aqui número, percentual, moeda e data são detectados e
 * gravados como valor, com o formato de exibição correspondente.
 */

const TIPOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
SHEETS</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

/**
 * Formatos: 0 padrão, 1 cabeçalho, 2 número com milhar, 3 moeda, 4 percentual,
 * 5 data. Os numFmtId acima de 163 são personalizados, como manda o formato.
 */
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="#,##0.00"/>
<numFmt numFmtId="165" formatCode="&quot;R$&quot;\\ #,##0.00"/>
<numFmt numFmtId="166" formatCode="dd/mm/yyyy"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF44546A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const COLUNA = (n) => {
  let nome = '';
  let i = n;
  while (i >= 0) {
    nome = String.fromCharCode(65 + (i % 26)) + nome;
    i = Math.floor(i / 26) - 1;
  }
  return nome;
};

/** Serial de data do Excel: dias desde 1899-12-30. */
const serialDeData = (ano, mes, dia) =>
  Math.round((Date.UTC(ano, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86400000);

/**
 * Descobre o que a célula é. A ordem importa: "R$ 1.240,50" é moeda antes de
 * ser número, e "17/08/2026" é data antes de ser texto com barras.
 */
function tipar(valor) {
  if (valor === null || valor === undefined || valor === '') return { tipo: 'vazio' };
  if (typeof valor === 'number') return { tipo: 'numero', numero: valor, estilo: 2 };
  if (valor instanceof Date) {
    return { tipo: 'data', numero: serialDeData(valor.getFullYear(), valor.getMonth() + 1, valor.getDate()), estilo: 5 };
  }

  const texto = String(valor).trim();

  const data = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto) || /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (data) {
    const [a, b, c] = data.slice(1).map(Number);
    const serial = texto.includes('-') ? serialDeData(a, b, c) : serialDeData(c, b, a);
    if (serial > 0) return { tipo: 'data', numero: serial, estilo: 5 };
  }

  const numero = (t) => {
    const limpo = t.replace(/[\s\u00a0]/g, '');
    if (!/\d/.test(limpo)) return null;
    // pt-BR: ponto é milhar, vírgula é decimal. "1.204" é mil duzentos e quatro,
    // não um vírgula dois — e tratar errado transformaria faturamento em fração.
    let normalizado;
    if (/,\d{1,2}$/.test(limpo)) normalizado = limpo.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpo)) normalizado = limpo.replace(/\./g, '');
    else normalizado = limpo.replace(/,/g, '');
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : null;
  };

  const moeda = /^(R\$|US\$|\$|€)\s*(-?[\d.,]+)$/.exec(texto);
  if (moeda) {
    const n = numero(moeda[2]);
    if (n !== null) return { tipo: 'numero', numero: n, estilo: 3 };
  }

  const percentual = /^(-?[\d.,]+)\s*%$/.exec(texto);
  if (percentual) {
    const n = numero(percentual[1]);
    if (n !== null) return { tipo: 'numero', numero: n / 100, estilo: 4 };
  }

  if (/^-?[\d.,]+$/.test(texto)) {
    const n = numero(texto);
    // "1.204" pode ser mil duzentos e quatro; só vira número se não perder sentido
    if (n !== null) return { tipo: 'numero', numero: n, estilo: Number.isInteger(n) ? 0 : 2 };
  }

  return { tipo: 'texto', texto };
}

function celula(valor, linha, coluna, cabecalho) {
  const ref = `${COLUNA(coluna)}${linha}`;
  if (cabecalho) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${xml(valor)}</t></is></c>`;

  const t = tipar(valor);
  if (t.tipo === 'vazio') return '';
  if (t.tipo === 'texto') return `<c r="${ref}" s="0" t="inlineStr"><is><t>${xml(t.texto)}</t></is></c>`;
  return `<c r="${ref}" s="${t.estilo}"><v>${t.numero}</v></c>`;
}

/** Largura da coluna a partir do conteúdo mais longo, com teto sensato. */
function larguras(linhas) {
  const colunas = Math.max(...linhas.map((l) => l.length));
  return Array.from({ length: colunas }, (_, c) => {
    const maior = linhas.reduce((n, l) => Math.max(n, String(l[c] ?? '').length), 0);
    return Math.min(52, Math.max(10, maior + 3));
  });
}

function planilha(linhas, { congelarCabecalho = true } = {}) {
  const larg = larguras(linhas);
  const colunasXml = larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

  const corpo = linhas
    .map((linha, i) => {
      const celulas = linha.map((v, c) => celula(v, i + 1, c, i === 0)).join('');
      return `<row r="${i + 1}"${i === 0 ? ' ht="20" customHeight="1"' : ''}>${celulas}</row>`;
    })
    .join('');

  const ultima = `${COLUNA(Math.max(0, larg.length - 1))}${linhas.length}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${ultima}"/>
<sheetViews><sheetView workbookViewId="0">${
    congelarCabecalho && linhas.length > 1
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
      : ''
  }</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${colunasXml}</cols>
<sheetData>${corpo}</sheetData>
${linhas.length > 1 ? `<autoFilter ref="A1:${ultima}"/>` : ''}
</worksheet>`;
}

/**
 * `abas` é um objeto { 'Nome da aba': [[linha], [linha]] }.
 * A primeira linha de cada aba é tratada como cabeçalho.
 */
function gerarXlsx(abas) {
  const nomes = Object.keys(abas).slice(0, 20);
  if (!nomes.length) throw new Error('nenhuma aba para gerar');

  const arquivos = {
    '_rels/.rels': RELS,
    'xl/styles.xml': ESTILOS,
  };

  const overrides = [];
  const relacoes = [];
  const abasXml = [];

  nomes.forEach((nome, i) => {
    const caminho = `xl/worksheets/sheet${i + 1}.xml`;
    arquivos[caminho] = planilha(abas[nome].map((l) => (Array.isArray(l) ? l : [l])));
    overrides.push(
      `<Override PartName="/${caminho}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
    relacoes.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    );
    // o Excel recusa aba com esses caracteres no nome
    const limpo = nome.replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || `Planilha${i + 1}`;
    abasXml.push(`<sheet name="${xml(limpo)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
  });

  arquivos['[Content_Types].xml'] = TIPOS.replace('SHEETS', overrides.join(''));
  arquivos['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${abasXml.join('')}</sheets></workbook>`;
  arquivos['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relacoes.join('')}
<Relationship Id="rId${nomes.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return zipar(arquivos);
}

/** Aceita markdown, CSV ou matriz e devolve linhas. */
function paraLinhas(entrada) {
  if (Array.isArray(entrada)) return entrada.map((l) => (Array.isArray(l) ? l : [l]));

  const texto = String(entrada || '').trim();
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());

  if (linhas.some((l) => /^\s*\|/.test(l))) {
    return linhas
      .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
      .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  }

  const separador = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ';' : ',';
  return linhas.map((l) => l.split(separador).map((c) => c.trim().replace(/^"|"$/g, '')));
}

module.exports = { gerarXlsx, paraLinhas, tipar, COLUNA, serialDeData };
