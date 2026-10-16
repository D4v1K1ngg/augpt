'use strict';

const path = require('path');
const { extrair, NAO_SUPORTADOS } = require('../formatos');

module.exports = [
  {
    // Fase 4 (16/10): OCR sem IA, offline (Tesseract em Ajustes → Componentes)
    name: 'ler_texto_da_imagem',
    risk: 'baixo',
    description:
      'Lê o texto de uma imagem da pasta de trabalho (print, foto de documento, nota fiscal, etiqueta) com OCR, letra a letra, em português e inglês. Use quando precisar do texto exato da imagem.',
    args: { caminho: 'imagem relativa à pasta de trabalho (png, jpg, webp, bmp, gif, tiff)' },
    async run({ caminho }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const { Tesseract } = require('../tesseract');
      const ocr = new Tesseract(path.join(ctx.userDataPath || '', 'componentes'));
      if (!ctx.userDataPath || !ocr.instalado()) throw new Error('O OCR (Tesseract) não está instalado: instale em Ajustes → Componentes.');
      const { caminho: arquivo } = ctx.sandbox.encontrar(caminho);
      const texto = await ocr.lerTexto(arquivo);
      ctx.emit('fonte', { tipo: 'leitura', provedor: 'ocr', url: caminho });
      return `[${path.basename(arquivo)} · OCR]

${texto || '(nenhum texto legível na imagem)'}`;
    },
  },
  {
    name: 'ler_documento',
    risk: 'baixo',
    description:
      'Lê o conteúdo de PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument, ePub, RTF, CSV, JSON e arquivos de texto. Use para qualquer arquivo que não seja texto puro.',
    args: {
      caminho: 'arquivo relativo à pasta de trabalho',
      limite: 'máximo de caracteres devolvidos (padrão 40000)',
    },
    async run({ caminho, limite = 40000 }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const { caminho: arquivo, corrigido } = ctx.sandbox.encontrar(caminho);
      const max = Math.min(Number(limite) || 40000, 120000);

      const r = extrair(arquivo, { limite: max });
      ctx.emit('fonte', { tipo: 'leitura', provedor: `documento:${r.tipo}`, url: caminho });

      const detalhes = Object.entries(r.meta || {})
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');

      const nota = corrigido ? `[nome corrigido: "${caminho}" → "${corrigido}"]\n` : '';
      const cabecalho = `[${path.basename(arquivo)} · ${r.tipo}${detalhes ? ` · ${detalhes}` : ''}]`;
      return `${nota}${cabecalho}\n\n${r.texto || '(documento sem texto extraível)'}`;
    },
  },

  {
    name: 'inspecionar_arquivo',
    risk: 'baixo',
    description:
      'Diz o formato de um arquivo e se ele pode ser lido, sem carregar o conteúdo. Use antes de ler arquivo grande ou de formato incerto.',
    args: { caminho: 'arquivo relativo à pasta de trabalho' },
    async run({ caminho }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const { caminho: arquivo, corrigido } = ctx.sandbox.encontrar(caminho);
      const { statSync } = require('fs');
      const stat = statSync(arquivo);
      const nome = corrigido || caminho;
      const ext = path.extname(nome).toLowerCase();

      const tamanho =
        stat.size < 1024
          ? `${stat.size} B`
          : stat.size < 1048576
            ? `${Math.round(stat.size / 1024)} KB`
            : `${(stat.size / 1048576).toFixed(1)} MB`;

      if (NAO_SUPORTADOS[ext]) {
        return `${nome} · ${tamanho}\nNão legível: ${NAO_SUPORTADOS[ext]}`;
      }

      try {
        const r = extrair(arquivo, { limite: 600 });
        const previa = r.texto.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n');
        return `${nome} · ${tamanho} · formato ${r.tipo}\nLegível com ler_documento.\nPrimeiras linhas:\n${
          previa || '(sem prévia)'
        }`;
      } catch (err) {
        return `${nome} · ${tamanho}\nNão legível: ${err.message}`;
      }
    },
  },
];
