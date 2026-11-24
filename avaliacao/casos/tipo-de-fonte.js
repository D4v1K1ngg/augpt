'use strict';

/**
 * O tipo de cada fonte lida (24/11, fase 1 do sistema global): o Tev1 classifica (84% contra 48% das regras, medido em
 * 164 páginas reais), a lista de lojas é certeira, o site julgado afiliado 2 vezes fica marcado, e sem o Tev1 valem as regras.
 */

const tipos = require('../../src/agent/tipo-de-fonte');
const nucleo = require('../../src/agent/nucleo');

const pagina = (n, url, titulo) => ({ n, url, titulo, resumo: '', trechos: [`${titulo}. Texto da página.`] });

module.exports = [
  {
    nome: 'tipo da fonte: o Tev1 classifica as lidas (4 por vez), a loja vem da lista sem perguntar, o site julgado afiliado 2 vezes não pergunta de novo, resposta fora das classes ou 2 falhas viram as regras, e sem modelo nada é perguntado',
    tipo: 'unidade',
    async executar() {
      tipos._limparMemoria();
      const perguntas = [];
      const decidir = async ({ state }) => {
        perguntas.push(state);
        if (/portaltcm/.test(state)) return { tipo: { choice: 'afiliado', confidence: 0.8 } };
        if (/ign\.com/.test(state)) return { tipo: { choice: 'noticia', confidence: 0.95 } };
        if (/estranho/.test(state)) return { tipo: { choice: 'banana', confidence: 0.9 } };
        return { tipo: { choice: 'comunidade', confidence: 0.7 } };
      };
      const fontes = [
        pagina(1, 'https://www.mercadolivre.com.br/x', 'Fone'),
        pagina(2, 'https://portaltcm.com.br/a', 'Benchmark Técnico de 10 Modelos'),
        pagina(3, 'https://portaltcm.com.br/b', 'Melhor fone 2026'),
        pagina(4, 'https://br.ign.com/gta', 'GTA 6 vazou'),
        pagina(5, 'https://www.reddit.com/r/iems/x', 'IEM for FPS'),
        pagina(6, 'https://estranho.com/x', 'Página estranha'),
        { n: 7, url: 'https://naolida.com/x', titulo: 'sem texto', resumo: '', trechos: [] },
      ];
      const r1 = await tipos.classificarFontes(fontes, { decidir, modelo: 'tev1:latest' });
      const tercaPortal = pagina(8, 'https://portaltcm.com.br/c', 'Outro benchmark');
      const antes = perguntas.length;
      await tipos.classificarFontes([tercaPortal], { decidir, modelo: 'tev1:latest' });
      const semModelo = [pagina(9, 'https://www.reddit.com/r/x/y', 'tópico')];
      await tipos.classificarFontes(semModelo, { decidir, modelo: '' });
      let falhas = 0;
      const quebrado = [10, 11, 12].map((n) => pagina(n, `https://site${n}.com/x`, 'x'));
      await tipos.classificarFontes(quebrado, { decidir: async () => ((falhas += 1), Promise.reject(new Error('404'))), modelo: 'tev1:latest', paralelo: 1 });
      const t = (n) => [...fontes, tercaPortal].find((f) => f.n === n);
      return [
        t(1).tipoFonte === 'loja' && t(1).tipoPor === 'loja' && !perguntas.some((p) => /mercadolivre/.test(p)) || JSON.stringify(t(1)),
        t(2).tipoFonte === 'afiliado' && t(4).tipoFonte === 'noticia' && t(4).tipoPor === 'tev1' && t(5).tipoFonte === 'comunidade' || JSON.stringify([t(2), t(4), t(5)].map((f) => f.tipoFonte)),
        t(6).tipoPor === 'regra' || `resposta fora das classes vira regra: ${t(6).tipoPor}`,
        !t(7).tipoFonte || 'página sem texto não é classificada',
        perguntas.length === antes && t(8).tipoFonte === 'afiliado' && t(8).tipoPor === 'site' || `o site afiliado 2 vezes não pergunta de novo: ${t(8).tipoPor}`,
        semModelo[0].tipoPor === 'regra' && semModelo[0].tipoFonte === 'comunidade' || JSON.stringify(semModelo[0]),
        falhas === 2 && quebrado.every((f) => f.tipoPor === 'regra') || `depois de 2 falhas, só regras: ${falhas} chamadas`,
        r1.classificadas === 6 && r1.pelo === 4 || JSON.stringify(r1),
      ];
    },
  },
  {
    nome: 'tipo da fonte na pesquisa: classificadas no fim da pesquisa (com aviso e o tempo), e o que o Tev1 diz vale na ordem do material — afiliado sem cara de lista vai para o fim com lista="sim"; vazio por último',
    tipo: 'unidade',
    async executar() {
      tipos._limparMemoria();
      const avisos = [];
      const deps = {
        emit: (tipo, d) => (tipo === 'aviso' ? avisos.push(d.texto) : null),
        modeloTipoDeFonte: 'tev1:latest',
        decidir: async ({ state }) => ({ tipo: { choice: /seo-disfarcado/.test(state) ? 'afiliado' : 'comunidade', confidence: 0.9 } }),
        chamar: async (messages, opcoes = {}) => (opcoes.json ? { content: '{}' } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
        buscar: async (q) => [{ titulo: `Review técnico ${q}`, url: 'https://seo-disfarcado.com.br/review', resumo: 'texto' }, { titulo: `${q} — fórum`, url: 'https://forum.x.com.br/t/1', resumo: 'discussão' }, { titulo: `${q} — outro`, url: 'https://forum.y.com.br/t/2', resumo: 'discussão' }],
        lerPagina: async (url) => ({ texto: `Página ${url}: fone intra auricular para pubg. `.repeat(20) }),
      };
      const fontes = await nucleo.pesquisar({ pergunta: 'qual o melhor fone intra auricular para pubg?', modo: 'normal', deps, hoje: 'x', produto: true, buscasIniciais: ['melhor fone intra auricular pubg'] });
      const seo = fontes.find((f) => /seo-disfarcado/.test(f.url));
      const ordem = nucleo.listasSoParaComprar(fontes.filter((f) => f.trechos.length));
      return [
        seo?.tipoFonte === 'afiliado' && seo.tipoPor === 'tev1' || JSON.stringify(seo),
        avisos.some((a) => /^tipo das fontes \(Tev1 em \d+ de \d+, [\d.]+ s\): /.test(a)) || `aviso: ${avisos.join(' | ')}`,
        ordem.at(-1)?.url === seo.url && ordem.at(-1).lista === true || `o afiliado do Tev1 vai para o fim: ${ordem.map((f) => f.url)}`,
      ];
    },
  },
];
module.exports.push({
  nome: 'tipo da fonte (no app, 24/11): o fórum que o Tev1 errou 2 vezes não fica preso como afiliado (o Clube do Hardware); o site que mede e o agregador da tabela têm a palavra final (RTINGS, iemranking); confiança abaixo de 0,4 fica com a regra; resultado de busca não lido não é classificado',
  tipo: 'unidade',
  async executar() {
    tipos._limparMemoria();
    const afiliado = async () => ({ tipo: { choice: 'afiliado', confidence: 0.8 } });
    const p = (n, url, titulo) => ({ n, url, titulo, trechos: ['x'] });
    await tipos.classificarFontes([p(1, 'https://www.clubedohardware.com.br/forums/topic/1', 'a'), p(2, 'https://www.clubedohardware.com.br/forums/topic/2', 'b')], { decidir: afiliado, modelo: 'm' });
    const terceiro = p(3, 'https://www.clubedohardware.com.br/forums/topic/3', 'c');
    await tipos.classificarFontes([terceiro], { decidir: async () => ({ tipo: { choice: 'comunidade', confidence: 0.9 } }), modelo: 'm' });
    const outras = [p(4, 'https://www.rtings.com/mouse/reviews/best', 'Best mice'), p(5, 'https://iemranking.com/x', 'EM6L'), p(6, 'https://qualquer.com/y', 'z')];
    await tipos.classificarFontes(outras, { decidir: async () => ({ tipo: { choice: 'vazio', confidence: 0.22 } }), modelo: 'm' });
    const naoLida = { n: 7, url: 'https://naolida.com/x', titulo: 'x', resumo: 'resumo da busca', trechos: [] };
    await tipos.classificarFontes([naoLida], { decidir: afiliado, modelo: 'm' });
    return [
      terceiro.tipoFonte === 'comunidade' && terceiro.tipoPor === 'tev1' || JSON.stringify(terceiro),
      outras[0].tipoFonte === 'teste' && outras[0].tipoPor === 'tabela' && outras[1].tipoFonte === 'comunidade' && outras[1].tipoPor === 'tabela' || JSON.stringify(outras.slice(0, 2)),
      outras[2].tipoPor === 'regra' || 'confiança baixa fica com a regra',
      !naoLida.tipoFonte || 'resultado não lido não é classificado',
    ];
  },
});
