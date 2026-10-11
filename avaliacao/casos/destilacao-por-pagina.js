'use strict';

/**
 * Pedido do Davi: em vez de decidir na hora da leitura o que sobrevive ao
 * corte por página (mesmo com o recorte por palavra-chave adicionado antes),
 * cada página lida por `pesquisar_e_ler`/`abrir_pagina` agora é destilada
 * INDIVIDUALMENTE a partir do texto COMPLETO que já ficava em cache — não do
 * resultado combinado (e cortado por página) que a ferramenta devolve pro
 * modelo de decisão ver. Isso troca uma heurística de posição de
 * palavra-chave por análise de verdade (a própria destilação) sobre a
 * página inteira. O preço é mais chamadas ao modelo — uma por página lida,
 * em vez de uma por chamada de ferramenta.
 */

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Agent } = require('../../src/agent/loop');
const { servidorFalso, skills } = require('../motor');

/** Domínios distintos via 127.0.0.{1,2,3}, um servidor HTTP só (mesmo truque de pesquisa.js/melhorias.js). */
function servidorDeConteudo(paginasPorDominio) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/search')) {
        const resultados = Object.keys(paginasPorDominio).map((host, i) => ({
          title: `Fonte ${i}`,
          url: `http://${host}:${s.address().port}/p`,
          content: '',
        }));
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ results: resultados }));
      }
      const host = (req.headers.host || '').split(':')[0];
      res.setHeader('Content-Type', 'text/html');
      res.end(paginasPorDominio[host] || '<html><body><p>vazio</p></body></html>');
    });
    s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
  });
}

const corpo = (texto) =>
  `<html><body><article><p>${texto} ${'Contexto suficiente para o extrator aceitar este bloco como conteúdo. '.repeat(4)}</p></article></body></html>`;

function agenteDeTeste({ falso, searxngUrl, configExtra = {} }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-destilacao-pagina-'));
  return new Agent({
    config: {
      host: `http://127.0.0.1:${falso.porta}`,
      model: 'falso',
      modelDecisao: '',
      modelRedacao: '',
      embedModel: 'nomic-embed-text',
      temperature: 0.3,
      numCtx: 8192,
      numPredict: 1024,
      numPredictResposta: 2048,
      maxIterations: 8,
      autonomy: 'auto',
      shellTimeoutMs: 8000,
      codeTimeoutMs: 8000,
      workspace,
      memoryTopK: 2,
      alwaysAllow: [],
      usarRotinas: false,
      skillsDesativadas: [],
      ferramentasDesativadas: [],
      permitirLeitorExterno: false,
      renderizarJs: false,
      searxngUrl,
      subconsultas: false,
      ...configExtra,
    },
    userDataPath: workspace,
    skills,
  });
}

module.exports = [
  {
    nome: 'destilação por página: pesquisar_e_ler destila cada página lida individualmente, não o resultado combinado',
    tipo: 'unidade',
    async executar() {
      const paginas = {
        '127.0.0.1': corpo('Página um fala sobre o assunto A com um valor de R$ 100,00.'),
        '127.0.0.2': corpo('Página dois fala sobre o assunto B com um valor de R$ 200,00.'),
        '127.0.0.3': corpo('Página três fala sobre o assunto C com um valor de R$ 300,00.'),
      };
      const conteudo = await servidorDeConteudo(paginas);
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'teste', paginas: 3 } },
          { ferramenta: 'responder', argumentos: { foco: 'resultado' } },
        ],
        redacao: 'Resposta com base nas três páginas.',
      });
      const agente = agenteDeTeste({
        falso,
        searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
        configExtra: { destilarFatos: true, destilarAcimaDe: 100 },
      });

      try {
        await agente.run('Pesquise o assunto');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      // Uma execução real também gera OUTRAS chamadas sem streaming/format
      // (reflexão pós-execução, uma eventual busca de reforço) que o servidor
      // falso não distingue de destilação — por isso filtramos pelo marcador
      // de origem específico de cada domínio, em vez de contar tudo.
      const porDominio = ['127.0.0.1', '127.0.0.2', '127.0.0.3'].map(
        (host) => falso.registro.destilacao.filter((p) => p.includes(`pesquisar_e_ler(${host})`)).length
      );

      return [
        porDominio.every((n) => n === 1) ||
          `esperava exatamente 1 chamada de destilação por domínio, obteve ${JSON.stringify(porDominio)}`,
      ];
    },
  },

  {
    nome: 'destilação por página: conteúdo além do corte por página, sem termo da busca, ainda chega à destilação',
    tipo: 'unidade',
    async executar() {
      // Filler que não compartilha NENHUMA palavra com a consulta abaixo, e um
      // fato-alvo também sem sobreposição de vocabulário com a consulta — se
      // isto chegar à destilação, é porque veio do texto COMPLETO em cache,
      // não de um recorte por palavra-chave (que aqui não teria achado nada
      // pra recortar) nem do corte simples por tamanho (o fato fica bem
      // depois do orçamento de 3500 caracteres por página, na profundidade
      // "normal").
      const filler = 'Texto de preenchimento sem relação nenhuma com a consulta feita. '.repeat(90);
      const fatoAlvo = 'Consumidores relataram superaquecimento do aparelho após poucas horas de uso.';
      const pagina = { '127.0.0.1': corpo(`${filler}\n\n${fatoAlvo}`) };

      const conteudo = await servidorDeConteudo(pagina);
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'problemas recentes no produto', paginas: 1 } },
          { ferramenta: 'responder', argumentos: { foco: 'resultado' } },
        ],
        redacao: 'Resposta com base na página lida.',
      });
      const agente = agenteDeTeste({
        falso,
        searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
        configExtra: { destilarFatos: true, destilarAcimaDe: 100, subconsultas: false },
      });

      try {
        await agente.run('Pesquise problemas recentes no produto');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      const chegouADestilacao = falso.registro.destilacao.some((p) => p.includes('superaquecimento do aparelho'));

      return [
        filler.length > 3500 || 'o teste não representa o bug: o filler nem passa do orçamento de página',
        chegouADestilacao || 'o fato além do corte por página, sem termo da busca, não chegou à destilação',
      ];
    },
  },
];
