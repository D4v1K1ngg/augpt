'use strict';

/**
 * Pré-busca (2026-10-10, tools/web.js: adiantarBuscas): enquanto o modelo
 * destila uma busca, a próxima já busca e baixa as páginas em segundo plano.
 * Páginas lentas (400 ms) simulam a web de verdade.
 */

const http = require('http');
const web = require('../../src/tools/web');

const pesquisarELer = web.find((t) => t.name === 'pesquisar_e_ler');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function cenarioLento(atrasoMs = 400) {
  const servidores = [];
  const ouvir = (s, host) => new Promise((r) => s.listen(0, host, () => r(s.address().port)));
  const leituras = { n: 0 };
  const urls = {};
  let host = 2;
  for (const termo of ['alfa', 'beta']) {
    urls[termo] = [];
    for (let i = 0; i < 2; i += 1) {
      const h = `127.0.0.${host++}`;
      const s = http.createServer((req, res) => {
        leituras.n += 1;
        setTimeout(() => {
          res.setHeader('Content-Type', 'text/html');
          res.end(`<html><body><article>${Array.from({ length: 8 }, (_, k) => `<p>O fone ${termo} ${i} tem ótimo posicionamento para jogos de tiro, segundo quem usa no dia a dia (parágrafo ${k}): os passos ficam claros e a direção dos tiros é fácil de perceber mesmo com explosões por perto.</p>`).join('')}</article></body></html>`);
        }, atrasoMs);
      });
      servidores.push(s);
      urls[termo].push(`http://${h}:${await ouvir(s, h)}/p`);
    }
  }
  const buscas = [];
  const busca = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    buscas.push(q);
    const termo = /beta/.test(q) ? 'beta' : 'alfa';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ results: urls[termo].map((url, i) => ({ title: `Fonte ${i}`, url, content: '' })) }));
  });
  servidores.push(busca);
  const porta = await ouvir(busca, '127.0.0.1');
  return { porta, leituras, buscas, fechar: () => Promise.all(servidores.map((s) => new Promise((r) => s.close(r)))) };
}

const novoCtx = (porta, extra = {}) => {
  const eventos = [];
  return {
    eventos,
    ctx: {
      estado: {},
      config: { searxngUrl: `http://127.0.0.1:${porta}`, permitirLeitorExterno: false, subconsultas: false, preBuscaAtrasoMs: 0, ...extra },
      emit: (nome, dados) => eventos.push({ nome, dados }),
      render: null,
    },
  };
};

module.exports = [
  {
    nome: 'pré-busca: a busca adiantada durante a "destilação" faz a próxima pesquisar_e_ler sair quase na hora (páginas de 400 ms); sem ela, espera o download',
    tipo: 'unidade',
    async executar() {
      const srv = await cenarioLento(400);
      try {
        // sem pré-busca: o download das páginas entra no tempo da ferramenta
        const a = novoCtx(srv.porta);
        let t0 = Date.now();
        await pesquisarELer.run({ consulta: 'fone alfa para fps' }, a.ctx);
        const semPre = Date.now() - t0;

        // com pré-busca: a busca "beta" é adiantada, o modelo "destila" 600 ms, depois a ferramenta roda
        const b = novoCtx(srv.porta);
        const agendadas = web.adiantarBuscas([{ consulta: 'fone beta para fps' }], b.ctx);
        await esperar(600);
        const leiturasAntes = srv.leituras.n;
        t0 = Date.now();
        const saida = await pesquisarELer.run({ consulta: 'fone beta para fps' }, b.ctx);
        const comPre = Date.now() - t0;
        const usouPaginas = b.eventos.filter((e) => e.nome === 'cache-usado' && e.dados?.preBusca).length;
        return [
          agendadas === 1 || `deveria agendar 1 busca (${agendadas})`,
          semPre >= 380 || `cenário: sem pré-busca deveria esperar o download (${semPre} ms)`,
          comPre < 200 || `com pré-busca deveria ser quase imediato (${comPre} ms; sem: ${semPre} ms)`,
          b.eventos.some((e) => e.nome === 'prebusca-usada') || 'a busca adiantada deveria ser usada',
          usouPaginas === 2 || `as 2 páginas adiantadas deveriam ser usadas (${usouPaginas})`,
          srv.leituras.n === leiturasAntes || 'nenhuma página deveria ser baixada de novo',
          /beta 0/.test(saida) && /beta 1/.test(saida) || 'o conteúdo adiantado tem que chegar à saída da ferramenta',
          srv.buscas.filter((q) => /beta/.test(q)).length === 1 || `a busca beta deveria ir ao provedor 1 vez (${srv.buscas.filter((q) => /beta/.test(q)).length})`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'pré-busca: busca ainda na fila não é esperada (a ferramenta busca na hora); desligada nos ajustes não agenda nada; página adiantada parcial é lida de novo',
    tipo: 'unidade',
    async executar() {
      const srv = await cenarioLento(50);
      try {
        // atraso grande: quando a ferramenta roda, a pré-busca ainda não começou
        const a = novoCtx(srv.porta, { preBuscaAtrasoMs: 5000 });
        web.adiantarBuscas([{ consulta: 'fone beta para fps' }], a.ctx);
        const t0 = Date.now();
        await pesquisarELer.run({ consulta: 'fone beta para fps' }, a.ctx);
        const tempo = Date.now() - t0;
        const desligada = novoCtx(srv.porta, { preBusca: false });
        const n = web.adiantarBuscas([{ consulta: 'fone beta para fps' }], desligada.ctx);
        // página parcial adiantada
        const c = novoCtx(srv.porta);
        c.ctx.estado.prePaginas = new Map([['http://127.0.0.9:1/p', Promise.resolve({ texto: 'curto', parcial: true })]]);
        c.ctx.estado.cachePaginas = new Map();
        let leuDeNovo = false;
        try {
          await pesquisarELer.run({ consulta: 'fone alfa para fps' }, c.ctx);
        } catch {
          /* o endereço inventado não importa aqui */
        }
        leuDeNovo = !c.eventos.some((e) => e.nome === 'cache-usado' && e.dados?.preBusca);
        return [
          tempo < 1000 || `não deveria esperar a pré-busca que ainda não começou (${tempo} ms)`,
          !a.eventos.some((e) => e.nome === 'prebusca-usada') || 'busca que não começou não conta como adiantada',
          n === 0 || 'desligada não agenda',
          leuDeNovo || 'página parcial adiantada não pode substituir a leitura completa',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
];
