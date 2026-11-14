'use strict';

/** Tipo da página (14/11, search.tipoDaPagina + nucleo.comCredibilidade): lista de afiliado desce, teste e comunidade sobem — em qualquer assunto. */

const { tipoDaPagina } = require('../../src/tools/search');
const nucleo = require('../../src/agent/nucleo');

const tipo = (url, titulo, recomendacao = true) => tipoDaPagina({ url, titulo }, { recomendacao }).tipo;

module.exports = [
  {
    nome: 'tipo da página: listas de afiliado (fone, roteador, notebook, ar-condicionado) descem; review e teste sobem; comunidade sobe em produto; notícia de preço e guia não são lista; a ordem do núcleo põe o Reddit e o review na frente da lista',
    tipo: 'unidade',
    executar() {
      const fontes = [
        { url: 'https://dmaisdesign.com.br/analises/melhor-fone-intra-auricular-para-fps/', titulo: 'Melhor fone intra-auricular para FPS', nota: 0.62 },
        { url: 'https://motivosparacomprar.com.br/top-10-melhores-fone', titulo: 'Top 10 melhores fones intra auricular gamer', nota: 0.61 },
        { url: 'https://www.reddit.com/r/iems/comments/1hq/recommended_iems_for_pubg/', titulo: 'Recommended IEMs for PUBG', nota: 0.55 },
        { url: 'https://www.headphones.com/blogs/reviews/simgot-em6l', titulo: 'Simgot EM6L Review', nota: 0.5 },
      ];
      const ordem = nucleo.comCredibilidade(fontes, { recomendacao: true }).map((f) => new URL(f.url).hostname.replace(/^www\./, ''));
      const semProduto = nucleo.comCredibilidade(fontes, { recomendacao: false }).map((f) => new URL(f.url).hostname.replace(/^www\./, ''));
      return [
        ['Os 7 melhores roteadores para jogos em 2026', 'Top 10 notebooks para faculdade', 'Melhor ar-condicionado custo-benefício de 2026', '8 Best IEMs 2026'].every((t) => tipo('https://exemplo.com/x', t) === 'lista de afiliado') || 'títulos de lista',
        tipo('https://br.my-best.com/22041', 'Fones in-ear') === 'lista de afiliado' || 'site que só faz lista',
        tipo('https://www.mbreviews.com/tp-link-archer-ax73-review/', 'TP-Link Archer AX73 Review') === 'teste próprio' || 'review',
        tipo('https://www.reddit.com/r/iems/x', 'Recommended IEMs for PUBG') === 'comunidade' && tipo('https://www.reddit.com/r/iems/x', 'Recommended IEMs for PUBG', false) === '' || 'comunidade só em produto',
        tipo('https://www.tecmundo.com.br/x', 'RTX 5080: melhores preços da Black Friday 2026') === '' || 'notícia de preço não é lista',
        tipo('https://www.adrenaline.com.br/x', 'Como otimizar o Windows 11 para jogos') === '' || 'guia não é lista',
        ordem[0] === 'headphones.com' && ordem[1] === 'reddit.com' && ordem.slice(2).every((d) => /dmaisdesign|motivosparacomprar/.test(d)) || `ordem em produto: ${ordem}`,
        /dmaisdesign|motivosparacomprar/.test(semProduto.at(-1)) || `fora de produto, a lista ainda desce: ${semProduto}`,
      ];
    },
  },
];
