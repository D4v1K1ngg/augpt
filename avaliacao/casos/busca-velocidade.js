'use strict';

/**
 * Busca mais rápida e mais limpa (27/10, análise do Davi):
 * - o contexto de um modelo carregado não encolhe (o Ollama recarregava o modelo: 3–4 s por troca);
 * - "ver imagens" só quando a aparência importa (o gato teve 9,2 s de modelo de visão);
 * - na pesquisa normal, mínimos cumpridos com 2+ sites lidos encerram (a rodada a mais era só "pronto");
 * - sem ano em pergunta que não muda com o tempo, sem assunto em português grudado na busca em inglês;
 * - página lenta: 8 s (era 15 s, e a rodada esperava a mais lenta); dicionário com peso baixo.
 */

const fs = require('fs');
const path = require('path');
const ollama = require('../../src/llm/ollama');
const search = require('../../src/tools/search');

const raiz = path.join(__dirname, '../..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

module.exports = [
  {
    nome: 'busca: o contexto do modelo nunca encolhe (4096 depois de 16384 usa 16384; só crescer recarrega), por servidor e modelo',
    tipo: 'unidade',
    executar() {
      const h = 'http://teste-contexto:1';
      return [
        ollama.contextoSemRecarga(h, 'm1', 16384) === 16384 || 'primeiro',
        ollama.contextoSemRecarga(h, 'm1', 4096) === 16384 || 'menor usa o maior',
        ollama.contextoSemRecarga(h, 'm1', 32768) === 32768 || 'maior cresce',
        ollama.contextoSemRecarga(h, 'm2', 4096) === 4096 || 'outro modelo é outro',
        ollama.contextoSemRecarga(`${h}/`, 'm1', 1024) === 32768 || 'barra no fim é o mesmo servidor',
      ];
    },
  },
  {
    nome: 'busca: ver imagens só com aparência ou imagem anexada; encerra a pesquisa normal com 2+ sites lidos; tira o ano e não gruda o assunto em busca em inglês',
    tipo: 'unidade',
    executar() {
      const n = ler('src/agent/nucleo/index.js');
      const m = /const PEDE_APARENCIA = (\/.+\/i);/.exec(n);
      // eslint-disable-next-line no-eval
      const aparencia = m ? eval(m[1]) : null;
      return [
        Boolean(aparencia) || 'regra de aparência',
        ...(aparencia ? [
          aparencia.test('como é a traseira do Vectra GT?') && aparencia.test('qual a cor do iPhone 17?') && aparencia.test('me mostra fotos do setup') || 'aparência',
          !aparencia.test('quanto tempo um gato consegue viver?') && !aparencia.test('qual a cotação do dólar?') || 'sem aparência',
        ] : []),
        /&& \(Boolean\(imagemAnexada\) \|\| PEDE_APARENCIA\.test/.test(n) || 'ferramenta condicionada',
        /const bastaNaNormal = modo !== 'profundo' && sitesLidos >= 2;/.test(n) || 'encerra na normal',
        /anoNaPergunta \|\| PISTA_DE_ATUAL\.test\(String\(pergunta \|\| ''\)\) \? q : q\.replace/.test(n) || 'tira o ano',
        /\|\| emIngles\(q\) \? q : `\$\{assuntoCurto\} \$\{q\}`/.test(n) || 'não gruda em inglês',
      ];
    },
  },
  {
    nome: 'busca: página lenta desiste em 8 s (o 15 s antigo gravado migra); dicionário tem peso baixo',
    tipo: 'unidade',
    executar() {
      const cfg = ler('src/config.js');
      return [
        /tempoMaximoPorPaginaMs: 8000,/.test(cfg) || 'padrão 8 s',
        /if \(salvo\.tempoMaximoPorPaginaMs === 15000\) this\.data\.tempoMaximoPorPaginaMs = DEFAULTS\.tempoMaximoPorPaginaMs;/.test(cfg) || 'migração',
        search.qualidadeDoDominio('https://dicionario.priberam.org/calopsita').tipo === 'dicionário' || 'priberam',
        search.qualidadeDoDominio('https://www.dicio.com.br/x').peso < search.qualidadeDoDominio('https://www.petz.com.br/x').peso || 'peso',
      ];
    },
  },
];
