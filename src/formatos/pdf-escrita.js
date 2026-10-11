'use strict';

const zlib = require('zlib');

/**
 * Gerador de PDF sem dependências.
 *
 * Usa as fontes base-14, que todo leitor de PDF já tem embutidas — não é
 * preciso incorporar arquivo de fonte, que é a parte cara de gerar PDF. Em
 * troca, o texto é codificado em WinAnsi, que cobre o português inteiro.
 *
 * O projeto já lia PDF; agora fecha o ciclo escrevendo também.
 */

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 56;
const LARGURA_UTIL = A4.largura - MARGEM * 2;

/** Larguras médias das glifos da Helvetica, em milésimos de em. */
const LARGURAS_HELVETICA = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

const larguraDoTexto = (texto, tamanho, negrito) => {
  let total = 0;
  for (const c of String(texto)) total += LARGURAS_HELVETICA[c] ?? 556;
  // a variante negrito é um pouco mais larga
  return (total / 1000) * tamanho * (negrito ? 1.05 : 1);
};

/** WinAnsi (cp1252) cobre o português; o resto vira aproximação legível. */
const WINANSI_EXTRA = {
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135,
  'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, '‘': 145, '’': 146,
  '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153, 'š': 154, 'œ': 156,
};

function paraWinAnsi(texto) {
  const bytes = [];
  for (const c of String(texto)) {
    const codigo = c.codePointAt(0);
    if (codigo < 256) bytes.push(codigo);
    else if (WINANSI_EXTRA[c]) bytes.push(WINANSI_EXTRA[c]);
    else bytes.push(63); // '?'
  }
  return Buffer.from(bytes);
}

const escaparPdf = (texto) =>
  paraWinAnsi(texto)
    .toString('latin1')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

/** Quebra o texto na largura disponível, respeitando palavras. */
function quebrar(texto, largura, tamanho, negrito) {
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (larguraDoTexto(tentativa, tamanho, negrito) <= largura || !atual) {
      atual = tentativa;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

/* ------------------------------ montagem ------------------------------ */

class Documento {
  constructor({ titulo = '', rodape = true } = {}) {
    this.titulo = titulo;
    this.rodape = rodape;
    this.paginas = [];
    this.novaPagina();
  }

  novaPagina() {
    this.atual = { comandos: [], y: A4.altura - MARGEM };
    this.paginas.push(this.atual);
  }

  espaco(altura) {
    if (this.atual.y - altura < MARGEM + 24) this.novaPagina();
  }

  linha(texto, { tamanho = 10.5, negrito = false, cor = '0 0 0', recuo = 0, espacoDepois = 4 } = {}) {
    const largura = LARGURA_UTIL - recuo;
    for (const parte of quebrar(texto, largura, tamanho, negrito)) {
      this.espaco(tamanho * 1.45);
      this.atual.y -= tamanho * 1.35;
      this.atual.comandos.push(
        `BT /${negrito ? 'F2' : 'F1'} ${tamanho} Tf ${cor} rg 1 0 0 1 ${MARGEM + recuo} ${this.atual.y.toFixed(2)} Tm (${escaparPdf(parte)}) Tj ET`
      );
    }
    this.atual.y -= espacoDepois;
  }

  regua() {
    this.espaco(12);
    this.atual.y -= 6;
    this.atual.comandos.push(
      `0.8 0.8 0.8 RG 0.7 w ${MARGEM} ${this.atual.y.toFixed(2)} m ${A4.largura - MARGEM} ${this.atual.y.toFixed(2)} l S`
    );
    this.atual.y -= 8;
  }

  tabela(linhas) {
    if (!linhas.length) return;
    const colunas = Math.max(...linhas.map((l) => l.length));
    const tamanho = colunas > 5 ? 8 : 9.5;

    // largura proporcional ao conteúdo, com mínimo para não espremer
    const pesos = Array.from({ length: colunas }, (_, c) =>
      Math.max(4, ...linhas.map((l) => String(l[c] ?? '').length))
    );
    const soma = pesos.reduce((a, b) => a + b, 0);
    const larguras = pesos.map((p) => (p / soma) * LARGURA_UTIL);

    for (const [i, linha] of linhas.entries()) {
      const celulas = Array.from({ length: colunas }, (_, c) => String(linha[c] ?? ''));
      const quebradas = celulas.map((texto, c) => quebrar(texto, larguras[c] - 8, tamanho, i === 0));
      const alturaLinha = Math.max(...quebradas.map((q) => q.length)) * tamanho * 1.3 + 6;

      this.espaco(alturaLinha + 4);
      const topo = this.atual.y;

      if (i === 0) {
        this.atual.comandos.push(
          `0.93 0.93 0.95 rg ${MARGEM} ${(topo - alturaLinha).toFixed(2)} ${LARGURA_UTIL} ${alturaLinha.toFixed(2)} re f`
        );
      }

      let x = MARGEM;
      quebradas.forEach((partes, c) => {
        partes.forEach((parte, n) => {
          const y = topo - 4 - (n + 1) * tamanho * 1.15;
          this.atual.comandos.push(
            `BT /${i === 0 ? 'F2' : 'F1'} ${tamanho} Tf 0 0 0 rg 1 0 0 1 ${(x + 4).toFixed(2)} ${y.toFixed(2)} Tm (${escaparPdf(parte)}) Tj ET`
          );
        });
        x += larguras[c];
      });

      this.atual.y = topo - alturaLinha;
      this.atual.comandos.push(
        `0.85 0.85 0.85 RG 0.5 w ${MARGEM} ${this.atual.y.toFixed(2)} m ${A4.largura - MARGEM} ${this.atual.y.toFixed(2)} l S`
      );
    }
    this.atual.y -= 10;
  }
}

/** Markdown → comandos de desenho. */
function desenhar(doc, markdown) {
  const linhas = String(markdown || '').split(/\r?\n/);
  let i = 0;

  const semMarcacao = (t) =>
    String(t)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  while (i < linhas.length) {
    const linha = linhas[i];

    if (!linha.trim()) {
      doc.atual.y -= 4;
      i += 1;
      continue;
    }

    if (/^```/.test(linha)) {
      i += 1;
      while (i < linhas.length && !/^```/.test(linhas[i])) {
        doc.linha(linhas[i] || ' ', { tamanho: 9, cor: '0.25 0.25 0.25', recuo: 12, espacoDepois: 0 });
        i += 1;
      }
      i += 1;
      doc.atual.y -= 6;
      continue;
    }

    if (/^\s*\|/.test(linha) && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || '')) {
      const celulas = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => semMarcacao(c.trim()));
      const dados = [celulas(linha)];
      i += 2;
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
        dados.push(celulas(linhas[i]));
        i += 1;
      }
      doc.tabela(dados);
      continue;
    }

    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (titulo) {
      const nivel = titulo[1].length;
      const tamanhos = [19, 15, 12.5, 11];
      doc.atual.y -= nivel === 1 ? 6 : 10;
      doc.linha(semMarcacao(titulo[2]), { tamanho: tamanhos[nivel - 1], negrito: true, espacoDepois: 6 });
      if (nivel === 1) doc.regua();
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      doc.regua();
      i += 1;
      continue;
    }

    const citacao = /^>\s?(.*)$/.exec(linha);
    if (citacao) {
      doc.linha(semMarcacao(citacao[1]), { recuo: 16, cor: '0.35 0.35 0.35' });
      i += 1;
      continue;
    }

    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linha);
    if (item) {
      const nivel = Math.min(2, Math.floor(item[1].length / 2));
      const marcador = /\d/.test(item[2]) ? item[2] : '•';
      doc.linha(`${marcador} ${semMarcacao(item[3])}`, { recuo: 14 + nivel * 14, espacoDepois: 2 });
      i += 1;
      continue;
    }

    doc.linha(semMarcacao(linha.trim()));
    i += 1;
  }
}

function gerarPdf({ conteudo, titulo = '', autor = 'AuGPT' }) {
  const doc = new Documento({ titulo });
  if (titulo) {
    doc.linha(titulo, { tamanho: 22, negrito: true, espacoDepois: 2 });
    doc.linha(new Date().toLocaleDateString('pt-BR'), { tamanho: 9, cor: '0.45 0.45 0.45', espacoDepois: 8 });
    doc.regua();
  }
  desenhar(doc, conteudo);

  // rodapé com numeração, depois de saber quantas páginas existem
  if (doc.rodape && doc.paginas.length > 1) {
    doc.paginas.forEach((pagina, i) => {
      const texto = `${i + 1} de ${doc.paginas.length}`;
      const largura = larguraDoTexto(texto, 8.5);
      pagina.comandos.push(
        `BT /F1 8.5 Tf 0.5 0.5 0.5 rg 1 0 0 1 ${(A4.largura - MARGEM - largura).toFixed(2)} ${(MARGEM - 18).toFixed(2)} Tm (${escaparPdf(texto)}) Tj ET`
      );
    });
  }

  return montar(doc, { titulo, autor });
}

/** Escreve os objetos, a tabela xref e o trailer. */
function montar(doc, { titulo, autor }) {
  const objetos = [];
  const adicionar = (conteudo) => {
    objetos.push(conteudo);
    return objetos.length; // número do objeto (1-based)
  };

  const fonteNormal = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fonteNegrito = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const paginasId = objetos.length + 1 + doc.paginas.length * 2;
  const idsDePagina = [];

  for (const pagina of doc.paginas) {
    const fluxo = zlib.deflateSync(Buffer.from(pagina.comandos.join('\n'), 'latin1'));
    const conteudoId = adicionar({
      cabecalho: `<< /Length ${fluxo.length} /Filter /FlateDecode >>`,
      binario: fluxo,
    });
    idsDePagina.push(
      adicionar(
        `<< /Type /Page /Parent ${paginasId} 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] ` +
          `/Resources << /Font << /F1 ${fonteNormal} 0 R /F2 ${fonteNegrito} 0 R >> >> /Contents ${conteudoId} 0 R >>`
      )
    );
  }

  adicionar(`<< /Type /Pages /Kids [${idsDePagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsDePagina.length} >>`);
  const catalogoId = adicionar(`<< /Type /Catalog /Pages ${paginasId} 0 R >>`);
  const infoId = adicionar(
    `<< /Title (${escaparPdf(titulo || 'Documento')}) /Author (${escaparPdf(autor)}) /Producer (AuGPT) ` +
      `/CreationDate (D:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z) >>`
  );

  const partes = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const posicoes = [];
  let deslocamento = partes[0].length;

  objetos.forEach((objeto, i) => {
    posicoes.push(deslocamento);
    const numero = i + 1;
    let bloco;
    if (typeof objeto === 'string') {
      bloco = Buffer.from(`${numero} 0 obj\n${objeto}\nendobj\n`, 'latin1');
    } else {
      bloco = Buffer.concat([
        Buffer.from(`${numero} 0 obj\n${objeto.cabecalho}\nstream\n`, 'latin1'),
        objeto.binario,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);
    }
    partes.push(bloco);
    deslocamento += bloco.length;
  });

  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`];
  for (const p of posicoes) xref.push(`${String(p).padStart(10, '0')} 00000 n \n`);

  partes.push(
    Buffer.from(
      `${xref.join('')}trailer\n<< /Size ${objetos.length + 1} /Root ${catalogoId} 0 R /Info ${infoId} 0 R >>\n` +
        `startxref\n${deslocamento}\n%%EOF\n`,
      'latin1'
    )
  );

  return Buffer.concat(partes);
}

module.exports = { gerarPdf, quebrar, larguraDoTexto, paraWinAnsi };
