'use strict';

/**
 * Onde os entusiastas conversam (22/11, item 4 da busca de produtos): dados/comunidades.json, porCategoria — o subreddit
 * da categoria, o site que mede e o agregador, para qualquer tipo de produto.
 */

const nucleo = require('../../src/agent/nucleo');
const { ondeOsEntusiastas } = require('../../src/tools/comunidade');
const { tipoDaPagina } = require('../../src/tools/search');

module.exports = [
  {
    nome: 'onde os entusiastas: a categoria sai do pedido (fone, mouse, placa de vídeo, air fryer; "como está o tempo" nenhuma); RTINGS com "best … 2026" é teste em recomendação (fora dela, como era); agregador e redditmedia são comunidade',
    tipo: 'unidade',
    executar() {
      const fone = ondeOsEntusiastas('qual o melhor fone intra auricular para pubg');
      const best = { url: 'https://www.rtings.com/mouse/reviews/best/by-usage/gaming', titulo: 'The 6 Best Gaming Mice of 2026' };
      return [
        fone.subreddits.includes('iems') && fone.testes.includes('rtings.com') && fone.agregadores.includes('crowdrecap.com') || JSON.stringify(fone),
        ondeOsEntusiastas('Qual o melhor mouse para jogos de tiro até R$ 300?').subreddits.join() === 'MouseReview' || 'mouse',
        ondeOsEntusiastas('melhor placa de vídeo até 3 mil').categorias.join() === 'pc' || 'placa de vídeo, com acento',
        ondeOsEntusiastas('qual a melhor air fryer para 4 pessoas').categorias.join() === 'air fryer' || 'air fryer',
        ondeOsEntusiastas('como está o tempo hoje?').categorias.length === 0 && ondeOsEntusiastas('o que é tvcultura').categorias.length === 0 || 'sem categoria (e "tv" só como palavra)',
        tipoDaPagina(best, { recomendacao: true }).tipo === 'teste próprio' && tipoDaPagina(best).tipo === 'lista de afiliado' || 'RTINGS',
        tipoDaPagina({ url: 'https://crowdrecap.com/iem/filters/best-for-competitive-fps-gaming/', titulo: 'Best IEMs for FPS' }, { recomendacao: true }).tipo === 'comunidade' || 'agregador',
        tipoDaPagina({ url: 'https://www.redditmedia.com/r/iems/comments/1ge0c32/which_of_these/', titulo: 'Which of these are better for FPS?' }, { recomendacao: true }).tipo === 'comunidade' || 'redditmedia',
      ];
    },
  },
  {
    nome: 'onde os entusiastas na pesquisa: o tópico do subreddit da categoria (r/MouseReview) é lido antes do de outro subreddit, e o site que mede ganha uma busca "site:" e uma página lida',
    tipo: 'unidade',
    async executar() {
      const naWeb = [];
      const lidas = [];
      const deps = {
        emit: (tipo, d) => (tipo === 'ferramenta' && d?.nome === 'ler_pagina' ? lidas.push(`${d.argumentos.foco} ${d.argumentos.url}`) : null),
        chamar: async (messages, opcoes = {}) => {
          const texto = messages.map((m) => m.content).join('\n');
          if (opcoes.json && /Escreva 2 buscas/.test(texto)) return { content: JSON.stringify({ buscas: ['what makes a mouse good for FPS', 'o que importa num mouse para jogos de tiro'], busca_produtos: 'best gaming mouse for FPS under 60 dollars' }) };
          if (opcoes.json) return { content: '{}' };
          return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
        },
        buscar: async (q) => {
          naWeb.push(q);
          if (/ reddit$/.test(q)) return ['gaming', 'pcmasterrace', 'MouseReview'].map((s, i) => ({ titulo: `Best mouse for FPS ${i}`, url: `https://www.reddit.com/r/${s}/comments/${i}/best_mouse/`, resumo: 'discussion' }));
          if (/^site:rtings\.com/.test(q)) return [{ titulo: 'The 6 Best Gaming Mice of 2026', url: 'https://www.rtings.com/mouse/reviews/best/by-usage/gaming', resumo: 'we tested' }];
          return [0, 1].map((i) => ({ titulo: `${q} ${i}`, url: `https://loja${i}.com/${encodeURIComponent(q)}`, resumo: 'texto' }));
        },
        buscarNaComunidade: async (q) => [0, 1].map((i) => ({ titulo: `${q} — tópico ${i}`, url: `https://forum${i}.com.br/${encodeURIComponent(q)}`, resumo: 'discussão' })),
        lerPagina: async () => ({ texto: 'Logitech G305 and Razer Viper Mini are great for FPS. '.repeat(10) }),
      };
      await nucleo.pesquisar({ pergunta: 'Qual o melhor mouse para jogos de tiro até R$ 300?', modo: 'normal', deps, hoje: 'x', produto: true, buscasIniciais: ['melhor mouse para FPS até 300'] });
      const daComunidade = lidas.filter((l) => /^o que quem usa recomenda.*reddit\.com/.test(l));
      return [
        naWeb.includes('site:rtings.com best gaming mouse for FPS under 60 dollars') || `busca no site que mede: ${naWeb.join(' | ')}`,
        daComunidade.some((l) => /\/r\/MouseReview\//.test(l)) && !daComunidade.some((l) => /\/r\/pcmasterrace\//.test(l)) || `o subreddit da categoria primeiro: ${daComunidade.join(' | ')}`,
        lidas.some((l) => /^os produtos que o teste recomenda.*rtings\.com/.test(l)) || `a página do teste lida: ${lidas.join(' | ')}`,
      ];
    },
  },
];
module.exports.push({
  nome: 'listas só para comprar (item 5): em recomendação, a lista de loja/afiliado vai para o fim do material (antes do corte do tamanho), no máximo 2, com lista="sim" e a regra do escritor; com menos de 2 fontes de outro tipo, nada muda',
  tipo: 'unidade',
  async executar() {
    const f = (n, url, titulo) => ({ n, url, titulo, resumo: '', trechos: [`${titulo}: Truthear Hexa e Simgot EM6L para FPS. `.repeat(60)] });
    const fontes = [
      f(1, 'https://reviup.com.br/melhor-fone', 'Os 10 melhores fones intra auriculares gamer de 2026'),
      f(2, 'https://portaltcm.com.br/top', 'Top 7 melhores fones gamer de 2026'),
      f(3, 'https://pandalargo.com.br/x', 'Os 5 melhores fones in-ear para FPS de 2026'),
      f(4, 'https://www.reddit.com/r/iems/comments/a/iem_for_fps/', 'IEM for FPS'),
      f(5, 'https://www.clubedohardware.com.br/forums/topic/1-fones-fps/', 'Fones para FPS'),
    ];
    const comLista = nucleo.listasSoParaComprar(fontes);
    const material = await nucleo.materialDaEscrita('melhor fone intra auricular para pubg', fontes, { limite: 9000, recomenda: true });
    const bloco = nucleo.blocoDeFontes(comLista.map((x) => ({ ...x, conteudo: 'x' })));
    const fonte = require('fs').readFileSync(require('path').join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
    return [
      JSON.stringify(comLista.map((x) => x.n)) === '[4,5,1,2]' && comLista.filter((x) => x.lista).length === 2 || JSON.stringify(comLista.map((x) => [x.n, x.lista])),
      /<fonte n="1"[^>]* lista="sim"/.test(bloco) && !/<fonte n="4"[^>]* lista="sim"/.test(bloco) || bloco.slice(0, 300),
      [4, 5].every((n) => material.some((x) => x.n === n)) && !material.some((x) => x.n === 3) || `o corte do tamanho tira a lista, não o tópico: ${material.map((x) => x.n)}`,
      JSON.stringify(nucleo.listasSoParaComprar(fontes.slice(0, 4)).map((x) => x.n)) === '[1,2,3,4]' || 'com 1 fonte de outro tipo, nada muda',
      /usadas\.some\(\(f\) => f\.lista\) \? REGRA_DE_LISTA/.test(fonte) && /if \(recomenda\) usadas = listasSoParaComprar\(usadas\)/.test(fonte) || 'a regra e a separação ligadas na escrita',
    ];
  },
});
module.exports.push({
  nome: 'material da recomendação: os tópicos que citam os produtos de "quem usa cita" entram primeiro (antes do corte do tamanho), depois comunidade e testes; sem recomendação, a ordem é a de sempre',
  tipo: 'unidade',
  async executar() {
    const f = (n, url, titulo, texto) => ({ n, url, titulo, resumo: '', trechos: [`${texto} `.repeat(70)] });
    const fontes = [
      f(1, 'https://agorasonora.com.br/a', 'Melhor fone intra auricular para PUBG', 'fone intra auricular pubg KZ ZSN Pro'),
      f(2, 'https://topcomparativos.com.br/b', 'Fone intra auricular PUBG guia', 'fone intra auricular pubg QKZ AK6'),
      f(3, 'https://blog.x.com.br/c', 'Fone para PUBG', 'fone intra auricular pubg WAAW'),
      f(4, 'https://outro.com.br/d', 'Fone gamer PUBG', 'fone intra auricular pubg JBL'),
      f(5, 'https://www.reddit.com/r/iems/comments/e/iem/', 'IEM for FPS', 'Simgot EM6L imaging footsteps'),
    ];
    fontes.citadosNaComunidade = [{ nome: 'Simgot EM6L', fontes: [5], sites: 1 }];
    const com = await nucleo.materialDaEscrita('melhor fone intra auricular para pubg', fontes, { limite: 9000, recomenda: true });
    const sem = await nucleo.materialDaEscrita('melhor fone intra auricular para pubg', fontes, { limite: 9000 });
    return [
      com.some((x) => x.n === 5) || `o tópico citado entra: ${com.map((x) => x.n)}`,
      !sem.some((x) => x.n === 5) || `sem recomendação, como sempre (o tópico em inglês fica para o fim): ${sem.map((x) => x.n)}`,
    ];
  },
});
