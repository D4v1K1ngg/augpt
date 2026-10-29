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
      // 29/10: por padrão a citação sai do texto (as fontes ficam no fim); a etiqueta só com a opção ligada
      const texto = 'Muito citado [(17)](https://www.techtudo.com.br/x)[(3)](https://www.reddit.com/r/a) e [aqui](https://g1.globo.com/y).';
      const limpo = md.render(texto);
      const antes = global.config;
      global.config = { citacoesNoTexto: true };
      let html;
      try {
        html = md.render(texto);
      } finally {
        global.config = antes;
      }
      return [
        limpo === '<p>Muito citado e <a href="https://g1.globo.com/y" data-externo="1">aqui</a>.</p>' || limpo,
        /<a class="cita" href="https:\/\/www\.techtudo\.com\.br\/x"[^>]*title="Fonte 17 · techtudo\.com\.br">techtudo<\/a>/.test(html) || html,
        /<a class="cita"[^>]*>reddit<\/a>/.test(html) || 'reddit',
        !/\(17\)|\(3\)/.test(html) || 'o número ficou no texto',
        /<a href="https:\/\/g1\.globo\.com\/y" data-externo="1">aqui<\/a>/.test(html) || 'link comum',
      ];
    },
  },
  {
    nome: 'fontes no fim (29/10): "---" + "Fontes" + lista viram o bloco recolhido "Fontes · N sites" com o nome de cada site; a coluna da tabela que só tinha citações sai',
    tipo: 'unidade',
    executar() {
      const html = md.render('Texto [(1)](https://www.infoescola.com/x).\n\n---\n**Fontes**\n1. [Motor a vapor - InfoEscola](https://www.infoescola.com/x)\n2. [Um blog](https://meublog.wordpress.com/y)');
      const tabela = md.render('| Característica | Descrição | Fonte |\n|---|---|---|\n| Tipo | Externa | [(1)](https://a.com/x) |');
      return [
        /<details class="fontes-da-resposta"><summary>Fontes · 2 sites<\/summary>/.test(html) || html,
        /<li value="1"><a href="https:\/\/www\.infoescola\.com\/x" data-externo="1"><span class="fonte-site">infoescola<\/span><span class="fonte-nome">Motor a vapor - InfoEscola<\/span><\/a><\/li>/.test(html) || 'item com o site',
        /<span class="fonte-site">meublog<\/span>/.test(html) || 'blog hospedado: o nome do blog',
        !/<hr \/>/.test(html) && /^<p>Texto\.<\/p>/.test(html) || 'sem a linha e sem a citação no texto',
        !/Fonte<\/th>/.test(tabela) && /<th>Descrição<\/th>/.test(tabela) || tabela,
      ];
    },
  },
];
