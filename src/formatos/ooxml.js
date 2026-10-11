'use strict';

const zip = require('./zip');

/* ------------------------------ utilidades de XML ------------------------------ */

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function desescapar(s = '') {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (e) => ENTIDADES[e]);
}

/** Conteúdo de todas as ocorrências de uma tag, na ordem do documento. */
function tags(xml, nome) {
  const achados = [];
  const re = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'g');
  let m;
  while ((m = re.exec(xml))) achados.push(m[1]);
  return achados;
}

const semTags = (xml) => desescapar(String(xml).replace(/<[^>]+>/g, '')).trim();

/**
 * Igual ao semTags, mas preserva os espaços das bordas.
 *
 * Cada trecho formatado é uma corrida separada no OOXML, e o espaço entre elas
 * vive na borda de uma delas. Aparar cada corrida colava as palavras:
 * "Texto com **negrito**" virava "Texto comnegrito".
 */
const textoDaCorrida = (xml) => desescapar(String(xml).replace(/<[^>]+>/g, ''));

/* ------------------------------ Word ------------------------------ */

function docx(buffer) {
  const { arquivos } = zip.abrir(buffer, (n) => /^word\/(document|footnotes|endnotes)\d*\.xml$/.test(n));
  const doc = arquivos.get('word/document.xml');
  if (!doc) throw new Error('estrutura de .docx inesperada: word/document.xml não encontrado');

  const xml = doc.toString('utf8');
  const partes = [];

  // Percorre parágrafos e tabelas na ordem em que aparecem no corpo
  const re = /<w:(p|tbl)(?:\s[^>]*)?>([\s\S]*?)<\/w:\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] === 'p') {
      const estilo = /<w:pStyle[^>]*w:val="([^"]*)"/.exec(m[2])?.[1] || '';
      const texto = tags(m[2], 'w:t').map(textoDaCorrida).join('').trim();
      const linha = texto.replace(/\s+/g, ' ').trim();
      if (!linha) continue;
      const nivel = /^Heading(\d)/i.exec(estilo)?.[1] || (/^Title$/i.test(estilo) ? '1' : null);
      partes.push(nivel ? `${'#'.repeat(Math.min(Number(nivel) + 1, 6))} ${linha}` : linha);
    } else {
      // Primeira linha da tabela vira cabeçalho: sem a linha separadora
      // (`| --- | --- |`), o renderizador de markdown do chat (renderer/md.js)
      // não reconhece a tabela e mostra cada linha como parágrafo solto com
      // barras verticais literais.
      let primeira = true;
      for (const linhaXml of tags(m[2], 'w:tr')) {
        const celulas = tags(linhaXml, 'w:tc').map((c) =>
          tags(c, 'w:t').map(textoDaCorrida).join('').replace(/\s+/g, ' ').trim()
        );
        if (!celulas.some(Boolean)) continue;
        partes.push(`| ${celulas.join(' | ')} |`);
        if (primeira) {
          partes.push(`| ${celulas.map(() => '---').join(' | ')} |`);
          primeira = false;
        }
      }
      partes.push('');
    }
  }

  const notas = ['word/footnotes.xml', 'word/endnotes.xml']
    .map((n) => arquivos.get(n))
    .filter(Boolean)
    .flatMap((b) => tags(b.toString('utf8'), 'w:p').map((p) => tags(p, 'w:t').map(textoDaCorrida).join('').trim()))
    .filter((t) => t.trim().length > 1);

  const texto = partes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    texto: notas.length ? `${texto}\n\n## Notas\n${notas.map((n) => `- ${n}`).join('\n')}` : texto,
    meta: { paragrafos: partes.length, notas: notas.length },
  };
}

/* ------------------------------ Excel ------------------------------ */

const COLUNAS = (ref) => ref.replace(/\d+/g, '');

function excelSerialParaData(n) {
  // Excel conta dias desde 1899-12-30 (com o bug do ano bissexto de 1900)
  const ms = (Number(n) - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(n);
  return d.toISOString().slice(0, 10);
}

function xlsx(buffer, { maxLinhas = 400 } = {}) {
  const { arquivos } = zip.abrir(buffer, (n) =>
    /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/.+\.xml)$/.test(n) ||
    n === 'xl/_rels/workbook.xml.rels'
  );

  const compartilhadas = arquivos.get('xl/sharedStrings.xml')
    ? tags(arquivos.get('xl/sharedStrings.xml').toString('utf8'), 'si').map((si) =>
        tags(si, 't').map(semTags).join('')
      )
    : [];

  // nomes das abas na ordem do workbook
  const workbook = arquivos.get('xl/workbook.xml')?.toString('utf8') || '';
  const nomes = [...workbook.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => desescapar(m[1]));

  // Quais estilos representam data? Não basta a lista de IDs embutidos do Excel
  // (14–22, 45–47): openpyxl e o próprio Excel criam formatos customizados a
  // partir do id 164, então é preciso olhar o formatCode de cada um.
  const estilos = arquivos.get('xl/styles.xml')?.toString('utf8') || '';

  const customizadosDeData = new Set();
  for (const m of estilos.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const codigo = desescapar(m[2]).toLowerCase();
    // dd/mm/yyyy, yyyy-mm-dd, h:mm — sem confundir com formato monetário
    if (/(^|[^\\])[dmy]{2,}/.test(codigo.replace(/\[[^\]]*\]|"[^"]*"/g, ''))) {
      customizadosDeData.add(Number(m[1]));
    }
  }

  const ehFormatoDeData = (id) =>
    (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customizadosDeData.has(id);

  const formatosData = new Set();
  const cellXfs = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(estilos)?.[0] || '';
  [...cellXfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"[^>]*?\/?>/g)].forEach((m, i) => {
    if (ehFormatoDeData(Number(m[1]))) formatosData.add(i);
  });

  const planilhas = [...arquivos.keys()]
    .filter((n) => n.startsWith('xl/worksheets/') && n.endsWith('.xml'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const saida = [];
  let totalLinhas = 0;

  planilhas.forEach((caminho, indice) => {
    const xml = arquivos.get(caminho).toString('utf8');
    const nome = nomes[indice] || `Planilha ${indice + 1}`;
    const linhas = [];

    for (const linhaXml of tags(xml, 'row')) {
      const celulas = [];
      const re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let m;
      while ((m = re.exec(linhaXml))) {
        const atributos = m[1];
        const conteudo = m[2] || '';
        const ref = /r="([A-Z]+\d+)"/.exec(atributos)?.[1] || '';
        const tipo = /t="([^"]+)"/.exec(atributos)?.[1];
        const estilo = Number(/s="(\d+)"/.exec(atributos)?.[1] ?? -1);

        let valor;
        if (tipo === 's') {
          valor = compartilhadas[Number(semTags(tags(conteudo, 'v')[0] || '0'))] ?? '';
        } else if (tipo === 'inlineStr') {
          valor = tags(conteudo, 't').map(semTags).join('');
        } else {
          const bruto = semTags(tags(conteudo, 'v')[0] || '');
          valor = bruto && formatosData.has(estilo) && /^\d+(\.\d+)?$/.test(bruto)
            ? excelSerialParaData(bruto)
            : bruto;
        }
        celulas.push({ coluna: COLUNAS(ref), valor: String(valor ?? '').replace(/\s+/g, ' ').trim() });
      }
      // fórmula sem valor em cache deixa célula vazia sobrando no fim da linha
      while (celulas.length && !celulas[celulas.length - 1].valor) celulas.pop();
      if (celulas.some((c) => c.valor)) linhas.push(celulas);
    }

    if (!linhas.length) return;
    totalLinhas += linhas.length;

    saida.push(`## Aba: ${nome}  (${linhas.length} linhas)`);
    const mostrar = linhas.slice(0, maxLinhas);
    // A primeira linha é tratada como cabeçalho: a linha separadora abaixo dela
    // é o que faz o renderizador de markdown do chat (renderer/md.js) reconhecer
    // isto como tabela de verdade, em vez de parágrafos soltos com "|" literais.
    mostrar.forEach((l, i) => {
      saida.push(`| ${l.map((c) => c.valor).join(' | ')} |`);
      if (i === 0) saida.push(`| ${l.map(() => '---').join(' | ')} |`);
    });
    if (linhas.length > mostrar.length) {
      saida.push(`[…${linhas.length - mostrar.length} linhas restantes não exibidas]`);
    }
    saida.push('');
  });

  if (!saida.length) throw new Error('planilha sem dados legíveis');
  return { texto: saida.join('\n').trim(), meta: { abas: planilhas.length, linhas: totalLinhas } };
}

/* ------------------------------ PowerPoint ------------------------------ */

function pptx(buffer) {
  const { arquivos } = zip.abrir(
    buffer,
    (n) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n) || /^ppt\/slides\/_rels\/.+\.rels$/.test(n)
  );
  const slides = [...arquivos.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)) // exclui os .rels
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!slides.length) throw new Error('nenhum slide encontrado');

  const partes = [];
  slides.forEach((caminho, i) => {
    const xml = arquivos.get(caminho).toString('utf8');
    const linhas = tags(xml, 'a:p')
      .map((p) => tags(p, 'a:t').map(semTags).join('').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    partes.push(`## Slide ${i + 1}`);
    partes.push(...(linhas.length ? linhas.map((l) => `- ${l}`) : ['(sem texto)']));

    // A numeração dos notesSlide NÃO acompanha a dos slides: o slide 2 pode
    // apontar para notesSlide1.xml. O vínculo correto está no .rels do slide.
    const rels = arquivos.get(caminho.replace(/^ppt\/slides\//, 'ppt/slides/_rels/') + '.rels');
    const alvo = rels && /Target="[^"]*?(notesSlide\d+\.xml)"/.exec(rels.toString('utf8'))?.[1];
    const notas = alvo ? arquivos.get(`ppt/notesSlides/${alvo}`) : null;
    if (notas) {
      const texto = tags(notas.toString('utf8'), 'a:t').map(semTags).join(' ').replace(/\s+/g, ' ').trim();
      if (texto && !/^\d+$/.test(texto)) partes.push(`> Notas: ${texto}`);
    }
    partes.push('');
  });

  return { texto: partes.join('\n').trim(), meta: { slides: slides.length } };
}

/* ------------------------------ OpenDocument e ePub ------------------------------ */

function odt(buffer) {
  const { arquivos } = zip.abrir(buffer, (n) => n === 'content.xml');
  const conteudo = arquivos.get('content.xml');
  if (!conteudo) throw new Error('content.xml não encontrado');
  const xml = conteudo.toString('utf8');

  const partes = [];
  const re = /<text:(h|p)(?:\s[^>]*)?>([\s\S]*?)<\/text:\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const linha = semTags(m[2]).replace(/\s+/g, ' ').trim();
    if (!linha) continue;
    partes.push(m[1] === 'h' ? `## ${linha}` : linha);
  }
  return { texto: partes.join('\n\n').trim(), meta: { blocos: partes.length } };
}

function epub(buffer, { limite = 200_000 } = {}) {
  const { arquivos } = zip.abrir(buffer, (n) => /\.(x?html|htm)$/i.test(n));
  const capitulos = [...arquivos.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!capitulos.length) throw new Error('nenhum capítulo encontrado no ePub');

  const partes = [];
  let total = 0;
  for (const nome of capitulos) {
    const html = arquivos.get(nome).toString('utf8');
    const texto = desescapar(
      html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (texto.length < 40) continue;
    partes.push(texto);
    total += texto.length;
    if (total > limite) {
      partes.push('[…restante do livro não exibido]');
      break;
    }
  }
  return { texto: partes.join('\n\n---\n\n'), meta: { capitulos: partes.length } };
}

module.exports = { docx, xlsx, pptx, odt, epub, tags, semTags, desescapar };
