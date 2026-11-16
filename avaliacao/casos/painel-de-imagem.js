'use strict';

/**
 * Painel "Criar imagem" (16/11, pedido do Davi): o atalho abre "O que você deseja criar?" com o carrossel de
 * exemplos (criados pelo FLUX, em renderer/exemplos-imagem) e os ajustes finos, que chegam ao gerador.
 */

const fs = require('fs');
const path = require('path');
const { comAjustesDeImagem } = require('../../src/agent/nucleo');

const raiz = path.join(__dirname, '../..');

module.exports = [
  {
    nome: 'painel de imagem: estilo, formato, qualidade e semente viram os parâmetros do gerador; edição mantém o tamanho da foto',
    tipo: 'unidade',
    executar() {
      const a = comAjustesDeImagem({ estilo: 'anime', formato: 'paisagem', qualidade: 'detalhada', semente: '42' });
      const livre = comAjustesDeImagem({});
      const edicao = comAjustesDeImagem({ formato: 'retrato' }, { editar: true });
      return [
        /anime/.test(a.estilo) && a.formato === 'paisagem' && a.passos === 8 && a.semente === 42 || JSON.stringify(a),
        livre.estilo === '' && livre.formato === null && livre.passos === 4 && livre.semente === null || JSON.stringify(livre),
        edicao.formato === null || 'edição não troca o formato',
        comAjustesDeImagem({ semente: 'abc', estilo: 'xyz' }).semente === null || 'semente inválida vira aleatória',
      ];
    },
  },
  {
    nome: 'painel de imagem: o atalho abre o painel e cada exemplo do carrossel tem a imagem no app',
    tipo: 'unidade',
    executar() {
      const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
      const imgs = [...html.matchAll(/<img src="(exemplos-imagem\/[^"]+)"/g)].map((m) => m[1]);
      return [
        /data-painel="imagem"/.test(html) && /id="inicioImagem"/.test(html) || 'o atalho e o painel',
        imgs.length >= 6 && imgs.every((f) => fs.existsSync(path.join(raiz, 'renderer', f))) || `exemplos: ${imgs.join(',')}`,
        ['iiEstilo', 'iiFormato', 'iiQualidade', 'iiSemente', 'iiRevisar'].every((id) => html.includes(`id="${id}"`)) || 'os ajustes finos',
      ];
    },
  },
];
