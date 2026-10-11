'use strict';

/**
 * Casos da análise de erros de execução real (log de 62 execuções): a Jina
 * sempre falhava 401 (sem autenticação nenhuma no código), a Marginalia
 * estourava o limite da chave pública compartilhada, e uma execução tentava
 * o MESMO provedor já falho de novo a cada nova busca — três buscas na
 * mesma execução eram três tentativas de Jina, três 401. Também cobre a
 * URL malformada que derrubava `navegar`/`abrir_pagina` com um erro técnico
 * do Electron (ERR_INVALID_URL) em vez de orientar o modelo a corrigir.
 */

const { validarUrl } = require('../../src/tools/http');

const searchPath = require.resolve('../../src/tools/search');
const webPath = require.resolve('../../src/tools/web');

/** Troca `buscar`/`buscarVarias` do módulo já carregado por um dublê, e devolve como desfazer. */
function comSearchFalso(impl) {
  const searchMod = require(searchPath);
  const originais = { buscar: searchMod.buscar, buscarVarias: searchMod.buscarVarias, jina: searchMod.jina };
  Object.assign(searchMod, impl);
  delete require.cache[webPath];
  const web = require(webPath);
  return {
    web,
    desfazer() {
      Object.assign(searchMod, originais);
      delete require.cache[webPath];
    },
  };
}

module.exports = [
  {
    nome: 'jina: sem chave configurada, recusa antes de tentar a rede',
    tipo: 'unidade',
    async executar() {
      const search = require(searchPath);
      let mensagem = null;
      try {
        await search.jina('teste', {});
      } catch (err) {
        mensagem = err.message;
      }
      return [
        mensagem !== null || 'deveria recusar sem chave',
        /chave/i.test(mensagem || '') || `mensagem não menciona a chave: ${mensagem}`,
      ];
    },
  },

  {
    nome: 'jina: com chave, envia Authorization Bearer e parseia o resultado',
    tipo: 'unidade',
    async executar() {
      const httpMod = require('../../src/tools/http');
      const originalBaixar = httpMod.baixar;
      let headersRecebidos = null;
      httpMod.baixar = async (_url, opcoes) => {
        headersRecebidos = opcoes.headers;
        return { ok: true, status: 200, texto: '[1] Title: Exemplo\nhttps://exemplo.com/pagina\nDescription: um resumo' };
      };
      delete require.cache[searchPath];
      const search = require(searchPath);
      let resultado;
      try {
        resultado = await search.jina('teste', { jinaKey: 'minha-chave-123' });
      } finally {
        httpMod.baixar = originalBaixar;
        delete require.cache[searchPath];
      }
      return [
        (headersRecebidos && headersRecebidos.Authorization === 'Bearer minha-chave-123') ||
          'não enviou "Authorization: Bearer <chave>"',
        (resultado && resultado.length === 1) || 'não parseou o resultado devolvido pela Jina',
      ];
    },
  },

  {
    nome: 'buscarVarias: provedor que falhou de verdade numa subconsulta some das seguintes (rede de verdade mockada)',
    tipo: 'unidade',
    async executar() {
      const httpMod = require('../../src/tools/http');
      const originalBaixar = httpMod.baixar;
      const porHost = {};
      const contar = (url) => {
        const host = /duckduckgo/.test(url) ? (url.includes('lite.') ? 'duckduckgo-lite' : 'duckduckgo') : /marginalia/.test(url) ? 'marginalia' : /wikipedia/.test(url) ? 'wikipedia' : 'outro';
        porHost[host] = (porHost[host] || 0) + 1;
        return host;
      };
      httpMod.baixar = async (url) => {
        const host = contar(url);
        // duckduckgo (as duas variantes) e marginalia falham de verdade — erro
        // de transporte/limite, não "sem resultados"; wikipedia sempre acha.
        if (host === 'wikipedia') {
          return { ok: true, status: 200, texto: JSON.stringify({ query: { search: [{ title: 'X', snippet: 'y' }] } }) };
        }
        if (host === 'marginalia') return { ok: false, status: 429, texto: '' };
        return { ok: false, status: 500, texto: '' };
      };
      delete require.cache[searchPath];
      const search = require(searchPath);

      let saida;
      try {
        saida = await search.buscarVarias(['assunto a', 'assunto b'], {});
      } finally {
        httpMod.baixar = originalBaixar;
        delete require.cache[searchPath];
      }

      return [
        porHost['duckduckgo'] === 1 || `duckduckgo foi tentado ${porHost['duckduckgo'] || 0}x — deveria ser pulado na 2ª subconsulta`,
        porHost['duckduckgo-lite'] === 1 ||
          `duckduckgo-lite foi tentado ${porHost['duckduckgo-lite'] || 0}x — deveria ser pulado na 2ª subconsulta`,
        porHost['marginalia'] === 1 || `marginalia foi tentado ${porHost['marginalia'] || 0}x — deveria ser pulado na 2ª subconsulta`,
        porHost['wikipedia'] === 2 || 'wikipedia deveria ser tentado nas duas subconsultas (não é falha de provedor)',
        saida.resultados.length >= 1 || 'não trouxe nenhum resultado',
      ];
    },
  },

  {
    nome: 'buscar_web: falha de provedor numa busca poupa a próxima busca da mesma execução',
    tipo: 'unidade',
    async executar() {
      const chamadas = [];
      let vez = 0;
      const { web, desfazer } = comSearchFalso({
        buscar: async (consulta, opcoes) => {
          chamadas.push({ consulta, pular: [...(opcoes.pular || [])] });
          vez += 1;
          if (vez === 1) {
            return { resultados: [], provedor: null, falhas: ['jina: HTTP 401', 'marginalia: HTTP 429 (limite da chave pública)'] };
          }
          return { resultados: [{ url: 'https://exemplo.com/y', titulo: 'Y', resumo: 'z' }], provedor: 'duckduckgo', falhas: [] };
        },
      });

      const ferramenta = web.find((f) => f.name === 'buscar_web');
      const ctx = { estado: {}, config: {}, emit() {} };

      let primeiraFalhou = false;
      try {
        await ferramenta.run({ consulta: 'primeira' }, ctx);
      } catch {
        primeiraFalhou = true;
      }
      await ferramenta.run({ consulta: 'segunda' }, ctx);
      desfazer();

      return [
        primeiraFalhou || 'a primeira busca (sem resultado nenhum) deveria lançar erro',
        (ctx.estado.provedoresIndisponiveis && ctx.estado.provedoresIndisponiveis.has('jina')) ||
          'jina deveria ficar marcada como indisponível na execução',
        ctx.estado.provedoresIndisponiveis.has('marginalia') || 'marginalia deveria ficar marcada como indisponível',
        (chamadas[1] &&
          chamadas[1].pular.includes('jina') &&
          chamadas[1].pular.includes('marginalia')) ||
          'a segunda busca deveria pedir para pular jina e marginalia',
      ];
    },
  },

  {
    nome: 'pesquisar_e_ler: passa a chave da Jina e o "pular" acumulado da execução para buscarVarias',
    tipo: 'unidade',
    async executar() {
      let opcoesRecebidas = null;
      const { web, desfazer } = comSearchFalso({
        buscarVarias: async (consultas, opcoes) => {
          opcoesRecebidas = opcoes;
          return { resultados: [], provedor: null, falhas: [], consultas: [] };
        },
      });

      const ferramenta = web.find((f) => f.name === 'pesquisar_e_ler');
      const ctx = {
        estado: { provedoresIndisponiveis: new Set(['jina']) },
        config: { jinaKey: 'chave-x', subconsultas: false },
        emit() {},
      };

      let erro = null;
      try {
        await ferramenta.run({ consulta: 'teste' }, ctx);
      } catch (err) {
        erro = err;
      }
      desfazer();

      return [
        Boolean(erro) || 'sem resultado nenhum, deveria lançar erro',
        (opcoesRecebidas && opcoesRecebidas.jinaKey === 'chave-x') || 'não repassou jinaKey da config',
        (opcoesRecebidas && opcoesRecebidas.pular && opcoesRecebidas.pular.includes('jina')) ||
          'não repassou o "pular" já acumulado nesta execução',
      ];
    },
  },

  {
    nome: 'validarUrl: aceita uma URL bem formada e recusa URLs coladas ou sem esquema',
    tipo: 'unidade',
    executar() {
      const problemas = [];
      try {
        validarUrl('https://exemplo.com/pagina');
      } catch (err) {
        problemas.push(`recusou uma URL válida: ${err.message}`);
      }
      try {
        validarUrl('');
        problemas.push('deveria recusar URL vazia');
      } catch (err) {
        if (!/informe/i.test(err.message)) problemas.push(`mensagem estranha para vazio: ${err.message}`);
      }
      // o caso real do log: o modelo colou duas URLs numa só chamada
      try {
        validarUrl('https://kabum.com.br https://outrosite.com.br');
        problemas.push('deveria recusar duas URLs coladas numa só');
      } catch (err) {
        if (!/EXATAMENTE uma URL/.test(err.message) && !/URL inválida/.test(err.message)) {
          problemas.push(`mensagem não orienta a corrigir: ${err.message}`);
        }
      }
      try {
        validarUrl('ftp://exemplo.com/arquivo');
        problemas.push('deveria recusar esquema que não é http(s)');
      } catch (err) {
        if (!/http/i.test(err.message)) problemas.push(`mensagem não menciona http(s): ${err.message}`);
      }
      return problemas.length ? problemas : [true];
    },
  },

  {
    nome: 'navegar/abrir_pagina: URL malformada devolve instrução de correção, não erro técnico',
    tipo: 'unidade',
    async executar() {
      const web = require(webPath);
      const navegador = require('../../src/tools/navegador');
      const abrir = web.find((f) => f.name === 'abrir_pagina');
      const navegar = navegador.find((f) => f.name === 'navegar');
      const ctx = { estado: {}, config: {}, emit() {} };

      const mensagens = [];
      for (const [nome, ferramenta, args] of [
        ['abrir_pagina', abrir, { url: 'https://a.com https://b.com' }],
        ['navegar', navegar, { url: 'https://a.com https://b.com' }],
      ]) {
        try {
          await ferramenta.run(args, ctx);
          mensagens.push(`${nome} não recusou a URL malformada`);
        } catch (err) {
          if (/ERR_INVALID_URL|Invalid URL/.test(err.message)) {
            mensagens.push(`${nome} vazou o erro técnico do runtime: ${err.message}`);
          }
          if (!/EXATAMENTE uma URL/.test(err.message) && !/URL inválida/.test(err.message)) {
            mensagens.push(`${nome} não orienta o modelo a corrigir: ${err.message}`);
          }
        }
      }
      return mensagens.length ? mensagens : [true];
    },
  },
];
