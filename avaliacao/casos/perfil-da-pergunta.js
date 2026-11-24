'use strict';

/**
 * A fonte certa para cada tipo de pergunta (24/11, fase 2 do sistema global): o perfil da pergunta escolhe quais tipos de
 * fonte (os da fase 1) vão na frente do material, antes do corte do tamanho.
 */

const nucleo = require('../../src/agent/nucleo');

const pagina = (n, url, tipoFonte, extra = {}) => ({ n, url, titulo: `página ${n}`, resumo: '', tipoFonte, trechos: [`Página ${n} (${tipoFonte}): vazamento GTA 6, wifi, Windows, Santos Dumont. `.repeat(60)], ...extra });

module.exports = [
  {
    nome: 'perfil da pergunta: notícia ("últimas notícias", "hoje", "situação do vazamento"), guia (otimizar, táticas), estudo (o que é, como funciona, por que, quem foi), produto (recomendação) e geral (o resto)',
    tipo: 'unidade',
    executar() {
      const p = (q, recomenda = false) => nucleo.perfilDaPergunta(q, {}, recomenda);
      return [
        p('Quais as últimas notícias sobre inteligência artificial?') === 'noticia' && p('Quais as principais notícias do Brasil hoje?') === 'noticia' && p('Como esta a situação do vazamento do executavel do gta 6') === 'noticia' || 'notícia (também com a letra acentuada no começo)',
        p('Como otimizar o windows 11 para aumentar o desempenho em jogos ?') === 'guia' && p('Quais as melhores táticas para vencer partidas de PUBG no PC?') === 'guia' || 'guia',
        ['O que é thrashing em sistemas operacionais?', 'Como funciona o wifi ?', 'Por que o céu é azul?', 'Quem foi Santos Dumont?'].every((q) => p(q) === 'estudo') || 'estudo',
        p('Qual o melhor fone para pubg?', true) === 'produto' || 'produto',
        p('Eu estou pensando em comprar um ar condicionado gree, 24 ou 27 mil btus') === 'geral' || 'geral',
        nucleo.perfilDaPergunta('qualquer coisa', { atual: true }) === 'noticia' || 'o entendimento marcou "muda com o tempo"',
      ];
    },
  },
  {
    nome: 'ordem do material por perfil (antes do corte do tamanho): na notícia, a notícia e a fonte oficial na frente e a lista de afiliado e a loja fora; no estudo, a referência; no geral, loja/afiliado/vazia no fim; sem perfil (bancada antiga), a ordem da relevância',
    tipo: 'unidade',
    async executar() {
      const fontes = [
        pagina(1, 'https://seo.com.br/a', 'afiliado'),
        pagina(2, 'https://binance.com/x', 'outro'),
        pagina(3, 'https://www.mercadolivre.com.br/x', 'loja'),
        pagina(4, 'https://cnn.com.br/', 'vazio'),
        pagina(5, 'https://ign.com/gta', 'noticia'),
        pagina(6, 'https://rockstargames.com/news', 'referencia'),
        pagina(7, 'https://pt.wikipedia.org/x', 'referencia'),
        pagina(8, 'https://reddit.com/r/gta/x', 'comunidade'),
      ];
      const ordem = async (perfil) => (await nucleo.materialDaEscrita('vazamento GTA 6', fontes, { limite: 9000, perfil })).map((f) => f.n);
      const noticia = await ordem('noticia');
      const estudo = await ordem('estudo');
      const geral = await ordem('geral');
      const sem = await ordem(null);
      return [
        [5, 6, 7].every((n) => noticia.includes(n)) && ![1, 3, 4].some((n) => noticia.includes(n)) || `notícia: ${noticia}`,
        [6, 7].every((n) => estudo.includes(n)) && ![1, 3, 4].some((n) => estudo.includes(n)) || `estudo: ${estudo}`,
        ![1, 3, 4].some((n) => geral.includes(n)) || `geral: ${geral}`,
        sem.includes(1) && sem.includes(2) || `sem perfil, a relevância decide (as primeiras entram): ${sem}`,
        nucleo.classeDaFonte({ url: 'https://www.amazon.com.br/x', tipoFonte: 'teste' }) === 'loja' && nucleo.classeDaFonte({ url: 'https://x.com/y', comunidade: true }) === 'comunidade' && nucleo.classeDaFonte({ url: 'https://www.reddit.com/r/x' }) === 'comunidade' || 'classe da fonte: a loja pela lista, o tópico da busca, a regra sem o Tev1',
      ];
    },
  },
];
