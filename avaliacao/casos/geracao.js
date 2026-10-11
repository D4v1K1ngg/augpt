'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../../src/tools');
const { Sandbox } = require('../../src/tools/sandbox');
const { extrair } = require('../../src/formatos');
const { listar, extrairEntrada } = require('../../src/formatos/zip');
const { zipar } = require('../../src/formatos/zip-escrita');
const { tipar } = require('../../src/formatos/xlsx-escrita');

const MARKDOWN = `# Relatório de Vendas

Texto com **negrito**, *itálico* e acentuação: ção, ê, ü.

## Resultados

| Região | Pedidos | Faturamento |
| --- | --- | --- |
| Sudeste | 1.204 | R$ 482.900,50 |
| Nordeste | 673 | R$ 201.450,00 |

- Primeiro item
- Segundo item

> Uma citação.
`;

function pasta() {
  const dir = path.join(os.tmpdir(), `augpt-geracao-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, ctx: { sandbox: new Sandbox(dir), emit() {}, estado: {}, config: {} } };
}

module.exports = [
  {
    nome: 'zip escrito é lido pelo leitor do projeto e comprime',
    tipo: 'unidade',
    executar() {
      const conteudo = `<x>${'dado '.repeat(200)}</x>`;
      const buf = zipar({ 'a.txt': 'acentuação: ção, ê, ü', 'pasta/b.xml': conteudo });
      const entradas = listar(buf);
      const a = extrairEntrada(buf, entradas[0]).toString('utf8');
      const b = extrairEntrada(buf, entradas[1]).toString('utf8');

      return [
        entradas.length === 2 || `escreveu ${entradas.length} entradas`,
        a === 'acentuação: ção, ê, ü' || `acentuação corrompida: ${a}`,
        b === conteudo || 'conteúdo comprimido não voltou íntegro',
        buf.length < conteudo.length || 'não comprimiu nada',
      ];
    },
  },

  {
    nome: 'gerar_docx: ida e volta com título, tabela e formatação',
    tipo: 'unidade',
    async executar() {
      const { dir, ctx } = pasta();
      const saida = await tools.get('gerar_docx').run({ caminho: 'relatorio', conteudo: MARKDOWN, titulo: 'Vendas' }, ctx);
      const arquivo = path.join(dir, 'relatorio.docx');
      const lido = extrair(arquivo);
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        /relatorio\.docx/.test(saida) || `mensagem inesperada: ${saida}`,
        lido.tipo === 'docx' || `o leitor identificou como ${lido.tipo}`,
        lido.texto.includes('## Relatório de Vendas') || 'o título não virou cabeçalho',
        lido.texto.includes('| Sudeste | 1.204 | R$ 482.900,50 |') || 'a tabela não sobreviveu',
        // o espaço entre corridas se perdia: "Texto com**negrito**" virava "comnegrito"
        lido.texto.includes('Texto com negrito, itálico') || 'perdeu o espaço entre trechos formatados',
        lido.texto.includes('ção, ê, ü') || 'acentuação corrompida',
        lido.texto.includes('• Primeiro item') || 'a lista não foi convertida',
      ];
    },
  },

  {
    nome: 'gerar_xlsx: número, moeda, percentual e data viram valores',
    tipo: 'unidade',
    async executar() {
      const { dir, ctx } = pasta();
      await tools.get('gerar_xlsx').run(
        {
          caminho: 'vendas.xlsx',
          abas: {
            Pedidos: '| Região | Pedidos | Faturamento | Data | Margem |\n|---|---|---|---|---|\n| Sudeste | 1.204 | R$ 482.900,50 | 17/08/2026 | 12,5% |',
            Resumo: '| Indicador | Valor |\n|---|---|\n| Total | 684350,5 |',
          },
        },
        ctx
      );
      const lido = extrair(path.join(dir, 'vendas.xlsx'));
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        lido.tipo === 'xlsx' || `identificado como ${lido.tipo}`,
        lido.texto.includes('## Aba: Pedidos') && lido.texto.includes('## Aba: Resumo') || 'faltou uma aba',
        lido.texto.includes('2026-08-17') || 'a data não virou data de verdade',
        // planilha onde tudo é texto não soma nem ordena
        tipar('R$ 482.900,50').tipo === 'numero' || 'moeda ficou como texto',
        tipar('12,5%').numero === 0.125 || 'percentual não virou fração',
        tipar('1.204').numero === 1204 || 'separador de milhar virou decimal',
        tipar('Sudeste').tipo === 'texto' || 'texto virou número',
      ];
    },
  },

  {
    nome: 'gerar_pdf: legível pelo próprio leitor, com acentuação',
    tipo: 'unidade',
    async executar() {
      const { dir, ctx } = pasta();
      const longo = `${MARKDOWN}\n\n${'Parágrafo longo para forçar a segunda página. '.repeat(80)}`;
      await tools.get('gerar_pdf').run({ caminho: 'relatorio.pdf', conteudo: longo, titulo: 'Vendas 2026' }, ctx);
      const lido = extrair(path.join(dir, 'relatorio.pdf'));
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        lido.tipo === 'pdf' || `identificado como ${lido.tipo}`,
        lido.meta.via === 'nativo' || `precisou de ferramenta externa (${lido.meta.via})`,
        lido.texto.includes('Vendas 2026') || 'o título não foi impresso',
        lido.texto.includes('ção, ê, ü') || 'acentuação perdida na codificação WinAnsi',
        lido.texto.includes('Sudeste') && lido.texto.includes('482.900,50') || 'a tabela não saiu',
        /\d+ de \d+/.test(lido.texto) || 'faltou a numeração de páginas',
      ];
    },
  },

  {
    nome: 'gerar_html: markdown vira página segura',
    tipo: 'unidade',
    async executar() {
      const { dir, ctx } = pasta();
      const perigoso = `${MARKDOWN}\n\n<script>alert(1)</script>\n\n[link](javascript:alert(2))`;
      await tools.get('gerar_html').run({ caminho: 'pagina', conteudo: perigoso, titulo: 'Teste' }, ctx);
      const html = fs.readFileSync(path.join(dir, 'pagina.html'), 'utf8');
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        html.includes('<table>') && html.includes('<td>Sudeste</td>') || 'a tabela não virou HTML',
        html.includes('<strong>negrito</strong>') || 'a formatação não foi aplicada',
        !/<script>alert/.test(html) || 'injetou script vindo do conteúdo',
        !/href="javascript:/.test(html) || 'aceitou link com javascript:',
        html.includes('prefers-color-scheme') || 'faltou o estilo embutido',
      ];
    },
  },

  {
    nome: 'geração não depende de Python nem de nada instalado',
    tipo: 'unidade',
    executar() {
      const problemas = [];
      for (const nome of ['gerar_docx', 'gerar_xlsx', 'gerar_pdf', 'gerar_html']) {
        const f = tools.get(nome);
        if (!f) problemas.push(`${nome} não existe`);
        else if (f.requer?.length) problemas.push(`${nome} ainda declara dependência: ${f.requer.join(', ')}`);
        else if (f.disponivel === false) problemas.push(`${nome} está indisponível`);
      }
      return problemas.length ? problemas : [true];
    },
  },
];
