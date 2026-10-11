'use strict';

/**
 * Erro temporário × definitivo (2026-10-10, tools/erros.js): leitura que
 * falha por motivo passageiro e rápido (429, 5xx, conexão derrubada) tenta de
 * novo uma vez; erro definitivo (404, 403, endereço bloqueado, arquivo que
 * não existe) volta ao modelo dizendo que repetir não adianta.
 */

const http = require('http');
const { classificarErro, comNovaTentativa, anotarErro, MARCA_DEFINITIVO } = require('../../src/tools/erros');
const { executarCasoAgente } = require('../motor');

/** Servidor que responde a sequência de status dada, um por pedido (o último se repete). */
async function servidorDeStatus(sequencia, corpo) {
  let n = 0;
  const s = http.createServer((req, res) => {
    const status = sequencia[Math.min(n, sequencia.length - 1)];
    n += 1;
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html');
    res.end(status === 200 ? corpo : `erro ${status}`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}/artigo`, pedidos: () => n, fechar: () => new Promise((r) => s.close(r)) };
}

const ARTIGO =
  '<html><body><article><p>O PUBG foi lançado em março de 2017 em acesso antecipado. ' +
  'Contexto suficiente para o extrator aceitar este bloco como conteúdo de verdade, com mais de cem caracteres.</p></article></body></html>';

module.exports = [
  {
    nome: 'erros: classificação — 404 e "não existe" são definitivos; 503 e "socket hang up" repetem; timeout e "nenhum provedor" são temporários mas não repetem',
    tipo: 'unidade',
    executar() {
      const c = (m) => classificarErro(new Error(m));
      return [
        c('Não consegui ler a página. Tentativas — html direto: HTTP 404 | render-js: timeout').tipo === 'definitivo' || '404 junto de timeout é definitivo',
        c('Bloqueado: 192.168.0.1 é endereço da rede local').tipo === 'definitivo' || 'endereço bloqueado é definitivo',
        c('Arquivo "relatorio.pdf" não existe na pasta de trabalho').tipo === 'definitivo' || 'arquivo inexistente é definitivo',
        c('HTTP 503').repetivel === true || '503 repete',
        c('socket hang up').repetivel === true || 'conexão derrubada repete',
        c('timeout').tipo === 'temporario' && c('timeout').repetivel === false || 'timeout é temporário mas não repete (custaria outro timeout)',
        c('Nenhum provedor de busca respondeu. Detalhes — searxng: HTTP 503').repetivel === false || 'a cadeia de provedores já tentou todos',
        c('algo estranho aconteceu').tipo === 'desconhecido' || 'texto sem sinal nenhum fica desconhecido',
        anotarErro('HTTP 404', c('HTTP 404')).includes(MARCA_DEFINITIVO) || 'definitivo ganha a marca para o modelo',
        anotarErro('timeout', c('timeout')) === 'timeout' || 'temporário sem nova tentativa não ganha marca',
      ];
    },
  },
  {
    nome: 'erros: comNovaTentativa — 503 passa na 2ª; 404 não repete; tentativa lenta não repete; interrupção para na hora',
    tipo: 'unidade',
    async executar() {
      let n1 = 0;
      const ok = await comNovaTentativa(
        async () => {
          n1 += 1;
          if (n1 === 1) throw new Error('HTTP 503');
          return 'conteúdo';
        },
        { esperaMs: 1 }
      );
      let n2 = 0;
      let def = null;
      try {
        await comNovaTentativa(async () => {
          n2 += 1;
          throw new Error('HTTP 404');
        }, { esperaMs: 1 });
      } catch (err) {
        def = err;
      }
      let n3 = 0;
      try {
        await comNovaTentativa(async () => {
          n3 += 1;
          await new Promise((r) => setTimeout(r, 30));
          throw new Error('HTTP 503');
        }, { esperaMs: 1, maxDuracaoMs: 10 });
      } catch {
        /* esperado */
      }
      const ctrl = new AbortController();
      let n4 = 0;
      try {
        await comNovaTentativa(async () => {
          n4 += 1;
          ctrl.abort(new Error('interrompido'));
          throw new Error('HTTP 503');
        }, { esperaMs: 1, signal: ctrl.signal });
      } catch {
        /* esperado */
      }
      return [
        ok === 'conteúdo' && n1 === 2 || `503: ${n1} tentativa(s)`,
        n2 === 1 || `404 foi repetido (${n2})`,
        def?.classificacao?.tipo === 'definitivo' || 'o erro sai com a classificação',
        n3 === 1 || `tentativa lenta foi repetida (${n3})`,
        n4 === 1 || `interrompido e mesmo assim repetiu (${n4})`,
      ];
    },
  },
  {
    nome: 'erros (ponta a ponta): abrir_pagina com 503 na 1ª vez lê na 2ª; com 404 o erro volta marcado como definitivo e não é repetido',
    tipo: 'unidade',
    async executar() {
      const instavel = await servidorDeStatus([503, 200], ARTIGO);
      const sumiu = await servidorDeStatus([404], 'x');
      try {
        const a = await executarCasoAgente({
          nome: 'erros: 503',
          pedido: 'Leia a página e me diga quando o PUBG foi lançado',
          roteiro: [
            { ferramenta: 'abrir_pagina', argumentos: { url: instavel.url } },
            { ferramenta: 'responder', argumentos: { foco: 'pubg' } },
          ],
          redacao: 'Em março de 2017.',
        });
        const b = await executarCasoAgente({
          nome: 'erros: 404',
          pedido: 'Leia a página e me diga quando o PUBG foi lançado',
          roteiro: [
            { ferramenta: 'abrir_pagina', argumentos: { url: sumiu.url } },
            { ferramenta: 'responder', argumentos: { foco: 'pubg' } },
          ],
          redacao: 'Não consegui ler a página.',
        });
        return [
          instavel.pedidos() >= 2 || `o 503 deveria ter sido tentado de novo (${instavel.pedidos()} pedido(s))`,
          !a.erros.some((e) => /abrir_pagina/.test(e)) || `a 2ª tentativa deveria ter lido: ${a.erros.join(' / ')}`,
          /2017/.test(a.promptRedacao) || 'o conteúdo lido na 2ª tentativa tem que chegar à redação',
          b.erros.some((e) => e.includes('erro definitivo')) || `o 404 deveria voltar marcado: ${b.erros.join(' / ')}`,
          sumiu.pedidos() <= 2 || `404 não deveria ser repetido pela ferramenta (${sumiu.pedidos()} pedidos)`,
        ];
      } finally {
        await instavel.fechar();
        await sumiu.fechar();
      }
    },
  },
];
