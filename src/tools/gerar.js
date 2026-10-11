'use strict';

const fs = require('fs');
const path = require('path');
const { gerarDocx } = require('../formatos/docx-escrita');
const { gerarXlsx, paraLinhas } = require('../formatos/xlsx-escrita');
const { gerarPdf } = require('../formatos/pdf-escrita');

/**
 * Geração de arquivos.
 *
 * Tudo nativo: docx e xlsx são ZIP com XML, PDF é formato próprio, e o Node já
 * traz o zlib. A versão anterior chamava Python (python-docx, openpyxl,
 * reportlab) e por isso aparecia indisponível para quem não tinha instalado —
 * que é a maioria de quem só quer usar o programa.
 *
 * Todas aceitam markdown, porque é o que o modelo escreve bem.
 */

function destino(ctx, caminho, extensao) {
  const nome = String(caminho || '').trim();
  if (!nome) throw new Error(`Informe "caminho", terminando em .${extensao}`);
  const comExtensao = nome.toLowerCase().endsWith(`.${extensao}`) ? nome : `${nome}.${extensao}`;
  return ctx.sandbox.resolve(comExtensao);
}

function gravar(ctx, alvo, buffer, extras = '') {
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, buffer);
  ctx.estado.escreveu = true;
  const relativo = path.relative(ctx.sandbox.root, alvo);
  const kb = (buffer.length / 1024).toFixed(1);
  return `Arquivo criado: ${relativo} (${kb} KB)${extras ? ` · ${extras}` : ''}`;
}

module.exports = [
  {
    name: 'gerar_docx',
    risk: 'medio',
    description:
      'Cria um documento Word (.docx) a partir de markdown. Converte títulos, listas, tabelas, negrito, itálico, código e citações. Não precisa de nada instalado.',
    args: {
      caminho: 'arquivo de destino, ex.: relatorio.docx',
      conteudo: 'o texto em markdown',
      titulo: 'título do documento, usado nas propriedades do arquivo',
    },
    obrigatorios: ['caminho', 'conteudo'],
    async run({ caminho, conteudo, titulo }, ctx) {
      if (!conteudo || !String(conteudo).trim()) throw new Error('Informe "conteudo" com o texto do documento.');
      const alvo = destino(ctx, caminho, 'docx');
      const buffer = gerarDocx({ conteudo: String(conteudo), titulo: titulo || path.basename(alvo, '.docx') });
      const paragrafos = String(conteudo).split(/\n\s*\n/).length;
      return gravar(ctx, alvo, buffer, `${paragrafos} bloco(s) de conteúdo`);
    },
  },

  {
    name: 'gerar_xlsx',
    risk: 'medio',
    description:
      'Cria uma planilha Excel (.xlsx). Aceita tabela em markdown, CSV ou várias abas. Número, moeda, percentual e data viram valores de verdade — a planilha soma e ordena.',
    args: {
      caminho: 'arquivo de destino, ex.: vendas.xlsx',
      dados: 'tabela em markdown ou CSV; a primeira linha é o cabeçalho',
      abas: 'opcional: objeto com uma tabela por aba, ex.: {"Vendas": "...", "Resumo": "..."}',
    },
    obrigatorios: ['caminho'],
    async run({ caminho, dados, abas }, ctx) {
      const alvo = destino(ctx, caminho, 'xlsx');

      let conteudo;
      if (abas && typeof abas === 'object' && !Array.isArray(abas)) {
        conteudo = Object.fromEntries(Object.entries(abas).map(([nome, valor]) => [nome, paraLinhas(valor)]));
      } else if (dados) {
        conteudo = { Dados: paraLinhas(dados) };
      } else {
        throw new Error('Informe "dados" com a tabela, ou "abas" com uma tabela por aba.');
      }

      const vazias = Object.entries(conteudo).filter(([, linhas]) => !linhas.length);
      if (vazias.length) throw new Error(`A aba "${vazias[0][0]}" ficou sem linhas. Verifique o formato da tabela.`);

      const buffer = gerarXlsx(conteudo);
      const resumo = Object.entries(conteudo)
        .map(([nome, linhas]) => `${nome}: ${linhas.length - 1} linha(s)`)
        .join(', ');
      return gravar(ctx, alvo, buffer, resumo);
    },
  },

  {
    name: 'gerar_pdf',
    risk: 'medio',
    description:
      'Cria um PDF a partir de markdown, com títulos, tabelas, listas e numeração de páginas. Não precisa de nada instalado.',
    args: {
      caminho: 'arquivo de destino, ex.: relatorio.pdf',
      conteudo: 'o texto em markdown',
      titulo: 'título impresso no topo da primeira página',
    },
    obrigatorios: ['caminho', 'conteudo'],
    async run({ caminho, conteudo, titulo }, ctx) {
      if (!conteudo || !String(conteudo).trim()) throw new Error('Informe "conteudo" com o texto do documento.');
      const alvo = destino(ctx, caminho, 'pdf');
      const buffer = gerarPdf({ conteudo: String(conteudo), titulo: titulo || '' });
      return gravar(ctx, alvo, buffer);
    },
  },

  {
    name: 'gerar_html',
    risk: 'medio',
    description:
      'Cria uma página HTML pronta para abrir no navegador, a partir de markdown. Sai com estilo legível, sem depender de internet.',
    args: {
      caminho: 'arquivo de destino, ex.: relatorio.html',
      conteudo: 'o texto em markdown',
      titulo: 'título da página',
    },
    obrigatorios: ['caminho', 'conteudo'],
    async run({ caminho, conteudo, titulo }, ctx) {
      if (!conteudo || !String(conteudo).trim()) throw new Error('Informe "conteudo" com o texto da página.');
      const alvo = destino(ctx, caminho, 'html');
      const nome = titulo || path.basename(alvo, '.html');
      const buffer = Buffer.from(paginaHtml(String(conteudo), nome), 'utf8');
      return gravar(ctx, alvo, buffer, 'abra com um duplo clique');
    },
  },
];

/* ------------------------------ HTML ------------------------------ */

const escapar = (t) =>
  String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Markdown → HTML. Escapa antes de aplicar marcação, para não injetar tag. */
function markdownParaHtml(markdown) {
  const linhas = String(markdown).split(/\r?\n/);
  const saida = [];
  let i = 0;
  let lista = null;

  const embutido = (t) =>
    escapar(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');

  const fecharLista = () => {
    if (lista) {
      saida.push(`</${lista}>`);
      lista = null;
    }
  };

  while (i < linhas.length) {
    const linha = linhas[i];

    if (!linha.trim()) {
      fecharLista();
      i += 1;
      continue;
    }

    if (/^```/.test(linha)) {
      fecharLista();
      i += 1;
      const codigo = [];
      while (i < linhas.length && !/^```/.test(linhas[i])) {
        codigo.push(escapar(linhas[i]));
        i += 1;
      }
      i += 1;
      saida.push(`<pre><code>${codigo.join('\n')}</code></pre>`);
      continue;
    }

    if (/^\s*\|/.test(linha) && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || '')) {
      fecharLista();
      const celulas = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const cabecalho = celulas(linha);
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
        corpo.push(celulas(linhas[i]));
        i += 1;
      }
      saida.push(
        `<table><thead><tr>${cabecalho.map((c) => `<th>${embutido(c)}</th>`).join('')}</tr></thead><tbody>` +
          corpo.map((l) => `<tr>${l.map((c) => `<td>${embutido(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>'
      );
      continue;
    }

    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (titulo) {
      fecharLista();
      saida.push(`<h${titulo[1].length}>${embutido(titulo[2])}</h${titulo[1].length}>`);
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      fecharLista();
      saida.push('<hr>');
      i += 1;
      continue;
    }

    const citacao = /^>\s?(.*)$/.exec(linha);
    if (citacao) {
      fecharLista();
      saida.push(`<blockquote>${embutido(citacao[1])}</blockquote>`);
      i += 1;
      continue;
    }

    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(linha);
    if (item) {
      const tipo = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (lista !== tipo) {
        fecharLista();
        saida.push(`<${tipo}>`);
        lista = tipo;
      }
      saida.push(`<li>${embutido(item[2])}</li>`);
      i += 1;
      continue;
    }

    fecharLista();
    saida.push(`<p>${embutido(linha.trim())}</p>`);
    i += 1;
  }

  fecharLista();
  return saida.join('\n');
}

function paginaHtml(markdown, titulo) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; color: #1c1c1e; background: #fff; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 2rem 0 .6rem; }
  h1 { font-size: 2rem; letter-spacing: -.02em; border-bottom: 1px solid #e5e5e7; padding-bottom: .4rem; }
  h2 { font-size: 1.4rem; } h3 { font-size: 1.15rem; }
  p, li { margin: .6rem 0; }
  code { background: #f2f2f4; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  pre { background: #f6f6f8; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1rem 0; padding: .2rem 0 .2rem 1rem; border-left: 3px solid #d4d4d8; color: #52525b; }
  table { border-collapse: collapse; width: 100%; margin: 1.2rem 0; font-size: .94em; }
  th, td { border: 1px solid #e0e0e4; padding: .5rem .7rem; text-align: left; }
  th { background: #f6f6f8; font-weight: 600; }
  hr { border: 0; border-top: 1px solid #e5e5e7; margin: 2rem 0; }
  a { color: #0b57d0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8ea; background: #16161a; }
    h1 { border-color: #2c2c31; }
    code, pre, th { background: #202024; }
    th, td { border-color: #2c2c31; }
    blockquote { border-color: #3a3a40; color: #a1a1aa; }
    hr { border-color: #2c2c31; }
    a { color: #7cacf8; }
  }
</style>
</head>
<body>
${markdownParaHtml(markdown)}
</body>
</html>`;
}

module.exports.markdownParaHtml = markdownParaHtml;
module.exports.paginaHtml = paginaHtml;
