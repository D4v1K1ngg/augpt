'use strict';

/**
 * Correções rápidas do motor de pesquisa (2026-09-24). O Davi trouxe uma
 * análise externa (ChatGPT) do caso "melhores fones intra-auriculares pra
 * PUBG"; conferindo no código, quatro causas concretas e baratas de corrigir:
 *
 *   1. o prompt de decisão dizia "Duas fontes lidas ... já bastam" — com cada
 *      pesquisar_e_ler lendo 3-6 páginas, isso autorizava parar depois de UMA
 *      busca, também em pedido de recomendação;
 *   2. a destilação dentro de investigar_subtarefa só via o pedido geral, não
 *      o objetivo da subtarefa;
 *   3. o redator só recebia as 8 ÚLTIMAS leituras do dossiê (`slice(-8)`);
 *   4. as consultas de investigar_subtarefa descontavam do mesmo teto das
 *      buscas soltas (4 no "leve") — uma subtarefa esgotava a pesquisa.
 */

const http = require('http');
const { selecionarParaRedacao } = require('../../src/agent/loop');
const { executarCasoAgente } = require('../motor');

const ENCHIMENTO = 'Contexto suficiente para o extrator aceitar este bloco como conteúdo. ';
// texto longo SEM repetição (o extrator descarta frase repetida, e a página
// ficaria abaixo do mínimo pra destilar)
const TEXTO_LONGO = Array.from(
  { length: 40 },
  (_, i) => `Observação ${i + 1} do teste de campo, registrada na rodada ${i + 11} com outro detalhe.`
).join(' ');

/**
 * Busca falsa: a consulta que contém "consulta-N" devolve `porConsulta`
 * páginas próprias, cada uma num servidor com endereço de loopback diferente
 * (127.0.0.2, 127.0.0.3, ...) — endereços diferentes contam como domínios
 * diferentes, então o limite de 2 páginas por domínio (tools/web.js) não
 * interfere. `paginaDe(q, k)` monta o HTML da k-ésima página da consulta q.
 *
 * Windows e Linux respondem em todo 127.0.0.0/8; o macOS, por padrão, só em
 * 127.0.0.1. Lá o `listen` falha com EADDRNOTAVAIL e a função devolve null —
 * os casos que dependem disso ficam de fora (avisando), em vez de falhar por
 * causa da máquina.
 */
async function buscaComPaginas(consultas, paginaDe, { porConsulta = 1 } = {}) {
  const quantas = consultas * porConsulta;
  const escutar = (servidor, host) =>
    new Promise((resolve, reject) => {
      servidor.once('error', reject);
      servidor.listen(0, host, () => resolve(servidor.address().port));
    });

  const paginas = [];
  for (let n = 1; n <= quantas; n += 1) {
    const host = `127.0.0.${n + 1}`;
    const q = Math.ceil(n / porConsulta);
    const k = n - (q - 1) * porConsulta;
    const s = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(paginaDe(q, k));
    });
    try {
      paginas.push({ host, servidor: s, porta: await escutar(s, host) });
    } catch (err) {
      if (err.code !== 'EADDRNOTAVAIL') throw err;
      await Promise.all(paginas.map((p) => new Promise((r) => p.servidor.close(r))));
      console.log(`      (pulado: este sistema não aceita o endereço ${host})`);
      return null;
    }
  }

  const busca = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('q') || '');
    const n = Number(/consulta-(\d+)/.exec(q)?.[1]);
    const daConsulta = n ? paginas.slice((n - 1) * porConsulta, n * porConsulta) : [];
    res.end(JSON.stringify({
      results: daConsulta.map((p, i) => ({ title: `Fonte ${n}.${i + 1}`, url: `http://${p.host}:${p.porta}/p`, content: '' })),
    }));
  });
  const porta = await escutar(busca, '127.0.0.1');

  return {
    porta,
    fechar: () =>
      Promise.all([busca, ...paginas.map((p) => p.servidor)].map((s) => new Promise((r) => s.close(r)))),
  };
}

const CONFIG_BASE = (porta, extra = {}) => ({
  searxngUrl: `http://127.0.0.1:${porta}`,
  permitirLeitorExterno: false,
  subconsultas: false,
  ...extra,
});

module.exports = [
  {
    nome: 'pesquisa: o prompt de decisão não manda mais parar com "duas fontes" e exige critérios + opções em recomendação',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'prompt de parada',
        pedido: 'Quais os melhores fones intra-auriculares para jogar PUBG no PC?',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
        redacao: 'Resposta de teste.',
      });
      const p = obtido.promptDecisao;
      return [
        !/Duas fontes lidas sobre o assunto já bastam/.test(p) || 'a regra antiga "duas fontes bastam" continua no prompt',
        !/Consulte no mínimo duas fontes/.test(p) || 'a regra 7 antiga ("no mínimo duas fontes") continua no prompt',
        /RECOMENDAÇÃO OU COMPARAÇÃO/.test(p) || 'faltou a regra de parada pra recomendação/comparação',
        /pelo menos três opções concretas/.test(p) || 'a regra de recomendação não exige opções concretas',
      ];
    },
  },

  {
    nome: 'pesquisa: a destilação dentro de investigar_subtarefa recebe o objetivo da subtarefa como foco (busca solta não)',
    tipo: 'unidade',
    async executar() {
      // página longa (> 1500 caracteres, o mínimo pra destilar) com número,
      // pro destilador falso da bancada ter o que extrair
      const srv = await buscaComPaginas(2, (n) =>
        `<html><body><article><p>Página ${n}: conforto medido em 7 de 10 pelos testadores. ${TEXTO_LONGO}</p></article></body></html>`
      );
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'foco da subtarefa na destilação',
          pedido: 'Quais os melhores fones intra-auriculares para jogar PUBG no PC?',
          // a bancada deixa a destilação desligada por padrão
          config: CONFIG_BASE(srv.porta, { destilarFatos: true, destilarComModelo: true }),
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'fones pubg consulta-1' } },
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: { objetivo: 'levantar conforto dos finalistas ORCA-FOCO', consultas: ['conforto consulta-2'] },
            },
            { ferramenta: 'responder', argumentos: { foco: 'fones' } },
          ],
          redacao: 'Resposta de teste.',
        });
        const focos = (obtido.promptDestilacao.match(/FOCO DESTA LEITURA/g) || []).length;
        return [
          obtido.chamadasDestilacao >= 2 || `esperava 2 destilações (uma por busca), houve ${obtido.chamadasDestilacao}`,
          /levantar conforto dos finalistas ORCA-FOCO/.test(obtido.promptDestilacao) ||
            'o objetivo da subtarefa não chegou ao prompt da destilação',
          focos === 1 || `esperava FOCO só na leitura da subtarefa (1), apareceu ${focos}x`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'pesquisa: selecionarParaRedacao garante uma leitura de cada busca (antes: só as 8 últimas)',
    tipo: 'unidade',
    executar() {
      const dossie = [];
      for (let q = 1; q <= 4; q += 1) {
        for (let p = 1; p <= 4; p += 1) {
          dossie.push({ consulta: `busca ${q}`, origem: `site-${q}-${p}`, texto: '- fato', fatos: p === 2 ? 9 : 1 });
        }
      }
      dossie.push({ consulta: 'busca 5', origem: 'vazia', texto: '(nada relevante ao pedido em vazia)', fatos: 0 });
      const r = selecionarParaRedacao(dossie);
      const consultas = new Set(r.map((e) => e.consulta));
      const curto = [{ origem: 'a', texto: 'x' }, { origem: 'b', texto: 'y' }];
      return [
        r.length === 8 || `esperava 8 leituras, vieram ${r.length}`,
        ['busca 1', 'busca 2', 'busca 3', 'busca 4'].every((c) => consultas.has(c)) ||
          `faltou busca no recorte: ${[...consultas].join(', ')}`,
        r.some((e) => e.origem === 'site-1-2') || 'o representante da busca 1 deveria ser a leitura com mais fatos',
        !r.some((e) => e.origem === 'vazia') || 'leitura "(nada relevante)" ocupou vaga com material útil sobrando',
        r.map((e) => dossie.indexOf(e)).every((v, i, a) => i === 0 || a[i - 1] < v) || 'a ordem do dossiê não foi mantida',
        selecionarParaRedacao(curto).length === 2 || 'dossiê pequeno deveria ir inteiro',
      ];
    },
  },

  {
    // 4 consultas × 4 páginas = 16 leituras, o caso típico de uma subtarefa
    // de comparação. Com o `slice(-8)` antigo sobravam só as consultas 3 e 4;
    // sem a marcação de `consulta` em cada entrada, o agrupamento cairia na
    // origem (16 grupos, ficam os 12 mais recentes) e a consulta 1 sumiria do
    // mesmo jeito — este caso pega os dois.
    nome: 'pesquisa: o redator vê o material da PRIMEIRA busca mesmo depois de 16 leituras (ponta a ponta)',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaComPaginas(
        4,
        (q, k) => `<html><body><article><p>MARCADOR-BUSCA-${q}-P${k} registrou ${q}${k} pontos no teste. ${ENCHIMENTO.repeat(3)}</p></article></body></html>`,
        { porConsulta: 4 }
      );
      const consultas = Array.from({ length: 4 }, (_, i) => `aspecto consulta-${i + 1}`);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'redator vê a primeira busca',
          pedido: 'Compare vários aspectos de um tema amplo',
          config: CONFIG_BASE(srv.porta),
          // cada busca interna conta como uma iteração do agente
          maxIterations: 30,
          roteiro: [
            { ferramenta: 'investigar_subtarefa', argumentos: { objetivo: 'os quatro aspectos', consultas } },
            { ferramenta: 'responder', argumentos: { foco: 'a comparação' } },
          ],
          redacao: 'Resposta de teste.',
        });
        const lidas = (obtido.promptDecisao.match(/\[pesquisar_e_ler\(127\.0\.0\.\d+\)\]/g) || []).length;
        return [
          lidas === 16 || `esperava 16 leituras no resultado da subtarefa, houve ${lidas}`,
          [1, 2, 3, 4].every((q) => new RegExp(`MARCADOR-BUSCA-${q}-P`).test(obtido.promptRedacao)) ||
            `faltou busca no material do redator: ${[1, 2, 3, 4].filter((q) => !new RegExp(`MARCADOR-BUSCA-${q}-P`).test(obtido.promptRedacao)).join(', ')}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'pesquisa: investigar_subtarefa tem orçamento próprio — ainda roda depois que as buscas soltas esgotaram o teto',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaComPaginas(3, (n) =>
        `<html><body><article><p>Página ${n} com o número 12${n}. ${ENCHIMENTO.repeat(3)}</p></article></body></html>`
      );
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'orçamento próprio da subtarefa',
          pedido: 'Qual o melhor fone para jogar PUBG?',
          config: CONFIG_BASE(srv.porta, { maxBuscas: 1 }),
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'fone pubg consulta-1' } },
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: { objetivo: 'critérios de escolha', consultas: ['posicionamento consulta-2', 'conforto consulta-3'] },
            },
            { ferramenta: 'responder', argumentos: { foco: 'fones' } },
          ],
          redacao: 'Resposta de teste.',
        });
        const lidas = obtido.ferramentasChamadas.filter((f) => f === 'pesquisar_e_ler').length;
        return [
          obtido.ok || `execução falhou: ${JSON.stringify(obtido.erros)}`,
          // 1 solta + 1 da subtarefa (o orçamento dela é do tamanho do teto: 1)
          lidas === 2 || `esperava 2 buscas (1 solta + 1 da subtarefa), houve ${lidas}`,
          /limite de buscas em sub-tarefas/.test(obtido.promptDecisao) ||
            'a consulta cortada pelo orçamento da subtarefa não foi avisada ao modelo',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'busca com "site:" (execução real de 11/10): resultado fora do site pedido não é lido — "site:reddit.com Simgot EM6L" trazia tim.com.br e a linguagem R; subdomínio vale, sem "site:" tudo vale',
    tipo: 'unidade',
    executar() {
      const { doSitePedido } = require('../../src/tools/web');
      const q = 'site:reddit.com Simgot EM6L';
      return [
        doSitePedido(q, 'https://www.reddit.com/r/iems/comments/15moc19/simgot_em6l_review/') || 'reddit.com é do site',
        doSitePedido(q, 'https://old.reddit.com/r/iems/') || 'subdomínio é do site',
        !doSitePedido(q, 'https://www.tim.com.br/ajuda/conta') || 'tim.com.br não é reddit',
        !doSitePedido(q, 'https://cran.r-project.org/bin/windows/base/') || 'r-project.org não é reddit',
        !doSitePedido(q, 'https://notreddit.com/x') || 'domínio que só termina igual não vale',
        !doSitePedido('site:clubedohardware.com.br fone', 'https://forum.adrenaline.com.br/t/1') || 'outro fórum não vale',
        doSitePedido('Simgot EM6L especificações', 'https://www.tim.com.br/') || 'sem "site:" não filtra nada',
        !doSitePedido(q, 'isto não é url') || 'endereço ilegível fica de fora',
      ];
    },
  },
  {
    nome: 'leitura de página (11/10): página guardada em disco vale em outra conversa por N dias, menos para pedido do momento (preço, hoje); página lenta demais deixa de segurar a busca e fica guardada quando chega',
    tipo: 'unidade',
    async executar() {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const http = require('http');
      const { lerComCache } = require('../../src/tools/web');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-cache-paginas-'));
      let leituras = 0;
      const srv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          leituras += 1;
          const atraso = req.url.startsWith('/lenta') ? 900 : 0;
          setTimeout(() => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(`<html><head><title>Ficha</title></head><body><main><p>${'O Simgot EM6L tem um driver dinâmico e quatro armaduras balanceadas. '.repeat(30)}</p></main></body></html>`);
          }, atraso);
        });
        s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, fechar: () => new Promise((r) => s.close(r)) }));
      });
      const conversa = (objetivo, config = {}) => ({
        objetivo,
        estado: {},
        emit() {},
        dirCachePaginas: dir,
        config: { cachePaginasDias: 3, tempoMaximoPorPaginaMs: 0, permitirLeitorExterno: false, renderizarJs: false, ...config },
      });
      const primeira = await lerComCache(`${srv.url}/ficha`, conversa('Simgot EM6L é bom para jogar?'));
      const aposPrimeira = leituras;
      const segunda = await lerComCache(`${srv.url}/ficha`, conversa('Me fale do Simgot EM6L'));
      const aposSegunda = leituras;
      await lerComCache(`${srv.url}/ficha`, conversa('Qual o preço do Simgot EM6L hoje?'));
      const aposPreco = leituras;
      await lerComCache(`${srv.url}/ficha`, conversa('Me fale do Simgot EM6L', { cachePaginasDias: 0 }));
      const aposDesligado = leituras;

      const comLimite = conversa('Simgot EM6L é bom?', { tempoMaximoPorPaginaMs: 150 });
      const inicio = Date.now();
      const erro = await lerComCache(`${srv.url}/lenta`, comLimite).then(() => null, (e) => e.message);
      const esperou = Date.now() - inicio;
      await new Promise((ok) => setTimeout(ok, 1100)); // a leitura lenta termina em segundo plano
      const depois = leituras;
      const reaproveitada = await lerComCache(`${srv.url}/lenta`, conversa('Me fale do Simgot EM6L')).catch(() => null);
      await srv.fechar();
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        (/Simgot EM6L/.test(primeira.texto) && aposPrimeira >= 1) || 'a primeira leitura vai à rede',
        (aposSegunda === aposPrimeira && /Simgot EM6L/.test(segunda.texto)) || `outra conversa deveria ler do disco (leituras ${aposPrimeira} → ${aposSegunda})`,
        aposPreco > aposSegunda || 'pedido de preço "hoje" não pode usar página guardada',
        aposDesligado > aposPreco || 'com 0 dias o cache fica desligado',
        (/página lenta demais/.test(String(erro)) && esperou < 700) || `página lenta deveria ser abandonada no limite (erro: ${erro}, esperou ${esperou} ms)`,
        (Boolean(reaproveitada?.texto) && leituras === depois) || 'a página lenta, quando chega, fica guardada para a próxima',
      ];
    },
  },
];
