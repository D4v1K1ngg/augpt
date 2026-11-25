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
module.exports.push({
  nome: 'tipo da fonte para o escritor (fase 3): o <fonte> classificado leva tipo= ("teste", "quem usa", "oficial", "notícia", "loja", "afiliado"), o não classificado não leva, e a regra diz como atribuir cada um (promessa de loja ou afiliado não vira fato)',
  tipo: 'unidade',
  executar() {
    const f = (n, url, tipoFonte) => ({ n, url, titulo: `p${n}`, tipoFonte, conteudo: 'x' });
    const bloco = nucleo.blocoDeFontes([f(1, 'https://www.rtings.com/a', 'teste'), f(2, 'https://www.reddit.com/r/x', 'comunidade'), f(3, 'https://support.microsoft.com/a', 'referencia'), f(4, 'https://www.amazon.com.br/x', 'teste'), f(5, 'https://seo.com.br/a', 'afiliado'), { n: 6, url: 'https://x.com/y', titulo: 'p6', conteudo: 'x' }]);
    const tipo = (n) => new RegExp(`<fonte n="${n}" tipo="([^"]+)"`).exec(bloco)?.[1] || null;
    return [
      tipo(1) === 'teste' && tipo(2) === 'quem usa' && tipo(3) === 'oficial' && tipo(5) === 'afiliado' || bloco.slice(0, 400),
      tipo(4) === 'loja' || 'a loja da lista vale mais que o Tev1',
      tipo(6) === null || 'sem classificação, sem tipo',
      /"usuários relatam"/.test(nucleo.REGRA_DE_TIPO) && /promessa de venda, não fato/.test(nucleo.REGRA_DE_TIPO) && /Não repita o tipo em toda frase/.test(nucleo.REGRA_DE_TIPO) || 'a regra',
    ];
  },
});
module.exports.push({
  nome: 'régua da fase 4 (24/11): "táticas" é guia mesmo com "muda com o tempo"; "o que caracteriza… teoria" é estudo; as não lidas mais ligadas (o resumo vai para o escritor) também são classificadas',
  tipo: 'unidade',
  async executar() {
    const tipos = require('../../src/agent/tipo-de-fonte');
    tipos._limparMemoria();
    const lida = { n: 1, url: 'https://ign.com/a', titulo: 'GTA 6', trechos: ['texto'] };
    const naoLida = { n: 2, url: 'https://exame.com/b', titulo: 'IA', resumo: 'resumo da busca', trechos: [] };
    const longe = { n: 3, url: 'https://x.com/c', titulo: 'outra', resumo: 'resumo', trechos: [] };
    await tipos.classificarFontes([lida, naoLida, longe], { decidir: async () => ({ tipo: { choice: 'noticia', confidence: 0.9 } }), modelo: 'm', naoLidas: [naoLida] });
    return [
      nucleo.perfilDaPergunta('Quais as melhores táticas para vencer partidas de PUBG no PC?', { atual: true }) === 'guia' || 'táticas com "muda com o tempo"',
      nucleo.perfilDaPergunta('O que caracteriza uma linguagem como decidível na teoria da computação?', {}) === 'estudo' || 'o que caracteriza',
      nucleo.perfilDaPergunta('dicas sobre o vazamento do GTA 6', {}) === 'noticia' || 'dica sobre notícia continua notícia',
      lida.tipoFonte === 'noticia' && naoLida.tipoFonte === 'noticia' && !longe.tipoFonte || JSON.stringify([lida.tipoFonte, naoLida.tipoFonte, longe.tipoFonte]),
    ];
  },
});
module.exports.push({
  nome: 'notícia velha (25/11, "últimas notícias sobre IA" 6,7: "até setembro de 2026" e o Claude Sonnet 4 misturado com os de agora): no perfil notícia, a página com mais de 30 dias vai para trás das recentes (sem data fica); fora da notícia, a data não muda a ordem',
  tipo: 'unidade',
  async executar() {
    const hoje = Date.now();
    const dias = (d) => (d === null ? null : new Date(hoje - d * 864e5).toISOString().slice(0, 10));
    const p = (n, d) => ({ n, url: `https://site${n}.com/a`, titulo: `p${n}`, tipoFonte: 'noticia', data: dias(d), trechos: [`Notícia ${n} sobre inteligência artificial e modelos novos. `.repeat(60)] });
    const fontes = [p(1, 200), p(2, 90), p(3, 2), p(4, 5), p(5, null), p(6, 10)];
    const noticia = (await nucleo.materialDaEscrita('últimas notícias sobre IA', fontes, { limite: 9000, perfil: 'noticia' })).map((f) => f.n);
    const geral = (await nucleo.materialDaEscrita('últimas notícias sobre IA', fontes, { limite: 9000, perfil: 'geral' })).map((f) => f.n);
    return [
      JSON.stringify(noticia) === '[3,4,5,6]' || `notícia: ${noticia}`,
      geral.includes(1) && geral.includes(2) || `geral: ${geral}`,
    ];
  },
});
