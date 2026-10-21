'use strict';

/**
 * Cartões da recomendação (21/10, conversa dos "5 melhores setups gamers"): a foto busca o assunto
 * junto com o nome e não aceita imagem fora dele quando o nome é um conceito; a citação "(17)" vira
 * a etiqueta do site.
 */

const imagens = require('../../src/tools/imagens');

global.window = global.window || {};
require('../../renderer/md.js');
const md = global.window.md;

// um buscador de imagens falso: o nome sozinho traz um prédio; com o assunto, um setup
const buscador = (consultas) => async (q) => {
  consultas.push(q);
  if (/setup gamer/.test(q)) return [{ titulo: 'Clean minimalist white gaming setup', url: 'https://x.com/setup.jpg' }, { titulo: 'Clean white minimalist building facade', url: 'https://x.com/predio.jpg' }];
  return [{ titulo: 'Clean white minimalist building facade', url: 'https://x.com/predio.jpg' }];
};

module.exports = [
  {
    nome: 'cartões: a foto de um conceito busca com o assunto e só aceita imagem que cite o assunto ("Clean Minimalist White Build" não vira prédio); sem nada certo, fica sem foto; modelo com número ainda tenta o nome sozinho',
    tipo: 'unidade',
    async executar() {
      const baixadas = [];
      const deps = (consultas) => ({ buscarImagens: buscador(consultas), baixar: async (url) => (baixadas.push(url), { ok: true, tipo: 'image/jpeg', bytes: Buffer.alloc(20000) }) });
      const c1 = [];
      const uri = await imagens.imagemDoCartao('Clean Minimalist White Build', { contexto: 'setup gamer', dir: require('os').tmpdir(), deps: deps(c1) });
      const c2 = [];
      const nada = await imagens.imagemDoCartao('Purple Loft with Geometric Drama', { contexto: 'setup gamer', dir: require('os').tmpdir(), deps: { buscarImagens: async (q) => (c2.push(q), [{ titulo: 'Purple loft apartment interior', url: 'https://x.com/loft.jpg' }]) } });
      const c3 = [];
      await imagens.imagemDoCartao('KZ ZS10 Pro X', { contexto: 'fone intra-auricular', dir: require('os').tmpdir(), deps: { buscarImagens: async (q) => (c3.push(q), []) } });
      return [
        c1[0] === 'Clean Minimalist White Build setup gamer' || `consulta: ${c1}`,
        !baixadas.includes('https://x.com/predio.jpg') || 'baixou o prédio',
        nada === null && c2.length === 1 || `conceito sem imagem do assunto: ${nada} / ${c2}`,
        c3.length === 2 && c3[1] === 'KZ ZS10 Pro X' || `modelo tenta o nome sozinho: ${c3}`,
        imagens.citaOAssunto('Clean white gaming setup', 'setup gamer') && !imagens.citaOAssunto('White building facade', 'setup gamer') || 'cita o assunto',
      ];
    },
  },
  {
    nome: 'cartões: a citação "[(17)](url)" vira a etiqueta com o nome do site (sem o número no texto), com a fonte no título; link comum continua link',
    tipo: 'unidade',
    executar() {
      const html = md.render('Muito citado [(17)](https://www.techtudo.com.br/x)[(3)](https://www.reddit.com/r/a) e [aqui](https://g1.globo.com/y).');
      return [
        /<a class="cita" href="https:\/\/www\.techtudo\.com\.br\/x"[^>]*title="Fonte 17 · techtudo\.com\.br">techtudo<\/a>/.test(html) || html,
        /<a class="cita"[^>]*>reddit<\/a>/.test(html) || 'reddit',
        !/\(17\)|\(3\)/.test(html) || 'o número ficou no texto',
        /<a href="https:\/\/g1\.globo\.com\/y" data-externo="1">aqui<\/a>/.test(html) || 'link comum',
      ];
    },
  },
];
