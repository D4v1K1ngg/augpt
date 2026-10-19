'use strict';

/**
 * Credibilidade no núcleo de pesquisa (19/10): a tabela de domínios e o peso por tipo de site
 * só valiam no caminho antigo; o núcleo escolhia o que ler só pela semelhança com a pergunta.
 */

const { comCredibilidade, listaParaOModelo } = require('../../src/agent/nucleo');
const { qualidadeDoDominio } = require('../../src/tools/search');

const itens = (lista) => lista.map(([url, nota]) => ({ url, nota, titulo: url, resumo: '' }));

module.exports = [
  {
    nome: 'credibilidade no núcleo: portal de notícia falsa e domínio bloqueado não entram, mesmo sendo o mais parecido com a pergunta; órgão oficial e imprensa sobem; um site ocupa no máximo 2 lugares',
    tipo: 'unidade',
    executar() {
      const r = comCredibilidade(itens([
        ['https://ceticismopolitico.com/eleicao', 0.99],
        ['https://pcgamecheck.com/a', 0.9],
        ['https://pcgamecheck.com/b', 0.88],
        ['https://pcgamecheck.com/c', 0.86],
        ['https://www.gov.br/tse/resultado', 0.8],
        ['https://g1.globo.com/eleicao', 0.8],
        ['https://blog.qualquer.wordpress.com/x', 0.81],
      ]));
      const urls = r.map((x) => x.url);
      return [
        !urls.some((u) => /ceticismopolitico/.test(u)) || 'notícia falsa entrou',
        urls.filter((u) => /pcgamecheck/.test(u)).length === 2 || 'mais de 2 do mesmo site',
        urls.indexOf('https://www.gov.br/tse/resultado') < urls.indexOf('https://blog.qualquer.wordpress.com/x') || 'gov.br abaixo do blog',
        urls.indexOf('https://g1.globo.com/eleicao') < urls.indexOf('https://www.gov.br/tse/resultado') + 2 || urls.join(' '),
      ];
    },
  },
  {
    nome: 'credibilidade no núcleo: na busca da comunidade, fórum e rede social não perdem ponto; o tipo do site e o alerta de sátira vão na lista que o modelo vê; gov.br e universidade brasileira (usp.br, ufrj.br) são reconhecidos',
    tipo: 'unidade',
    executar() {
      const web = comCredibilidade(itens([['https://www.reddit.com/r/x', 0.8], ['https://exemplo.com.br/y', 0.78]]));
      const comunidade = comCredibilidade(itens([['https://www.reddit.com/r/x', 0.8], ['https://exemplo.com.br/y', 0.78]]), { comunidade: true });
      const lista = listaParaOModelo([
        { n: 1, url: 'https://www.gov.br/anatel', titulo: 'Anatel', resumo: '', qualidade: 'órgão oficial' },
        { n: 2, url: 'https://sensacionalista.com.br/x', titulo: 'Notícia', resumo: '', qualidade: 'sátira', alerta: { risco: 'satira' } },
      ]);
      return [
        web[0].url === 'https://exemplo.com.br/y' && comunidade[0].url === 'https://www.reddit.com/r/x' || JSON.stringify({ web: web.map((x) => x.url), comunidade: comunidade.map((x) => x.url) }),
        /\[1\] Anatel \(gov\.br, órgão oficial\)/.test(lista) && /\[2\].*⚠ site de sátira/.test(lista) || lista,
        qualidadeDoDominio('https://www.gov.br/x').tipo === 'órgão oficial' && qualidadeDoDominio('https://jornal.usp.br/x').tipo === 'universidade' && qualidadeDoDominio('https://ufrj.br').tipo === 'universidade' && qualidadeDoDominio('https://governo.com.br').tipo === 'site' || 'domínios brasileiros',
      ];
    },
  },
];
