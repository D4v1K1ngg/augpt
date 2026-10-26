'use strict';

/**
 * Tarefas em segundo plano (27/10): a fila (src/segundo-plano.js) com um agente de mentira, e o celular
 * mandando "em segundo plano: …" enquanto o AuGPT responde outra coisa.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { FilaDeFundo, pedidoDeFundo, RESPOSTA_A_PERGUNTA } = require('../../src/segundo-plano');
const { AcessoRemoto } = require('../../src/remoto');

const raiz = path.join(__dirname, '../..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ate = async (cond, ms = 2000) => {
  for (let t = 0; t < ms && !cond(); t += 10) await esperar(10);
  return cond();
};

/** Agente de mentira: o roteiro decide o que acontece em run(). */
function agenteDeMentira(roteiro) {
  const a = new EventEmitter();
  a.pendentes = new Map();
  a.responder = (id, valor) => {
    const p = a.pendentes.get(id);
    if (!p) return false;
    a.pendentes.delete(id);
    p(valor);
    return true;
  };
  a.esperar = (tipo, dados) => new Promise((ok) => {
    const id = `${tipo}-1`;
    a.pendentes.set(id, ok);
    a.emit(tipo, { id, ...dados });
  });
  a.parar = () => {
    a.parado = true;
    for (const [, p] of a.pendentes) p('negar');
    a.pendentes.clear();
  };
  a.run = (objetivo) => roteiro(a, objetivo);
  return a;
}

module.exports = [
  {
    nome: 'segundo plano: "em segundo plano: …", "… em segundo plano", "in the background" viram fila; "o que é segundo plano?" e "plano de fundo" não',
    tipo: 'unidade',
    executar() {
      const v = (t, esperado) => pedidoDeFundo(t) === esperado || `${t} → ${pedidoDeFundo(t)}`;
      return [
        v('em segundo plano: compare 5 notebooks até R$ 5 mil', 'compare 5 notebooks até R$ 5 mil'),
        v('Pesquise os melhores roteadores Wi-Fi 7 em segundo plano.', 'Pesquise os melhores roteadores Wi-Fi 7'),
        v('faça em segundo plano, organize a pasta Downloads', 'organize a pasta Downloads'),
        v('in the background: compare 3 phones', 'compare 3 phones'),
        v('o que é segundo plano em fotografia?', null),
        v('troque o plano de fundo da área de trabalho', null),
        v('em segundo plano', null),
      ];
    },
  },
  {
    nome: 'segundo plano: uma por vez; a resposta vira conversa salva e avisa; aprovação espera você (só "aprovar" libera); pergunta segue sozinha; cancelar para; erro avisa',
    tipo: 'unidade',
    async executar() {
      const salvas = [];
      const avisos = [];
      let juntas = 0;
      let maxJuntas = 0;
      const roteiros = {
        simples: async (a, objetivo) => {
          juntas += 1;
          maxJuntas = Math.max(maxJuntas, juntas);
          a.emit('iteracao', { n: 1 });
          await esperar(30);
          const resp = await a.esperar('pergunta', { pergunta: 'qual faixa de preço?' });
          a.emit('concluido', { resumo: `feito: ${objetivo} (${resp === RESPOSTA_A_PERGUNTA ? 'seguiu sozinho' : 'esperou'})` });
          juntas -= 1;
        },
        aprova: async (a) => {
          const d = await a.esperar('aprovacao', { nome: 'escrever_arquivo', argumentos: { caminho: 'x.txt' }, risco: 'medio' });
          a.emit('concluido', { resumo: `decisão: ${d}` });
        },
        longa: async (a) => {
          while (!a.parado) await esperar(10);
          a.emit('interrompido', { iteracoes: 1 });
        },
        quebra: async () => {
          throw new Error('Ollama fora do ar');
        },
      };
      const fila = new FilaDeFundo({
        criarAgente: () => agenteDeMentira(roteiros[fila.itens.find((i) => i.estado === 'fila').objetivo.split(' ')[0]]),
        salvar: (item, resposta) => (salvas.push(resposta), { id: `c${salvas.length}`, titulo: item.objetivo }),
        avisar: (item) => avisos.push(`${item.estado}:${item.objetivo}`),
      });
      const r = [];
      fila.adicionar('simples um');
      fila.adicionar('simples dois');
      r.push(await ate(() => salvas.length === 2) || `salvas: ${salvas}`);
      r.push(maxJuntas === 1 || `juntas: ${maxJuntas}`);
      r.push(salvas[0] === 'feito: simples um (seguiu sozinho)' || salvas[0]);
      r.push(fila.listar().every((i) => i.estado === 'pronta' && i.idConversa) || JSON.stringify(fila.listar()));
      r.push(avisos.join() === 'pronta:simples um,pronta:simples dois' || avisos.join());

      const idA = fila.adicionar('aprova isto');
      r.push(await ate(() => fila.listar().find((i) => i.id === idA)?.estado === 'esperando') || 'esperando');
      r.push(avisos.at(-1) === 'esperando:aprova isto' || avisos.at(-1));
      r.push(fila.responder('outro-id', 'aprovar') === false || 'id errado');
      fila.responder(idA, 'sempre'); // "sempre" não vale aqui: vira negar
      r.push(await ate(() => salvas.at(-1) === 'decisão: negar') || salvas.at(-1));

      const idL = fila.adicionar('longa demais');
      fila.adicionar('simples três');
      await ate(() => fila.listar().find((i) => i.id === idL)?.estado === 'rodando');
      fila.remover(idL);
      r.push(await ate(() => salvas.at(-1) === 'feito: simples três (seguiu sozinho)') || `depois de cancelar: ${salvas.at(-1)}`);
      r.push(!avisos.some((a) => a.includes('longa')) || 'cancelada não avisa');

      fila.adicionar('quebra tudo');
      r.push(await ate(() => avisos.at(-1) === 'erro:quebra tudo') || avisos.at(-1));
      r.push(/Ollama fora do ar/.test(fila.listar().at(-1).erro) || fila.listar().at(-1).erro);
      r.push(fila.ocupada === false || 'livre no fim');
      return r;
    },
  },
  {
    nome: 'segundo plano pelo celular: "em segundo plano: …" entra na fila mesmo com o AuGPT respondendo; a lista e a aprovação passam pelo celular ("sempre" não)',
    tipo: 'unidade',
    async executar() {
      const porta = await new Promise((ok) => {
        const srv = http.createServer().listen(0, '127.0.0.1', () => {
          const p = srv.address().port;
          srv.close(() => ok(p));
        });
      });
      const adicionados = [];
      const respondidos = [];
      const fundo = {
        adicionar: (t) => (adicionados.push(t), 'fundo-1'),
        listar: () => [{ id: 'fundo-1', estado: 'esperando' }],
        responder: (id, v) => (respondidos.push(`${id}:${v}`), true),
        remover: () => true,
      };
      const remoto = new AcessoRemoto({
        porta,
        codigo: 'codigo-de-teste-fundo-123',
        dirTela: path.join(raiz, 'renderer'),
        dirImagens: __dirname,
        estado: () => ({ rodando: true }),
        pedir: () => ({ ok: true }),
        responder: () => true,
        parar: () => {},
        fundo,
        listarConversas: () => [],
        lerConversa: () => null,
        servirMapa: async () => null,
        servirCaixa: async () => null,
      });
      await remoto.ligar();
      const pedir = (rota, corpo) => new Promise((ok) => {
        const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: corpo ? 'POST' : 'GET', headers: { Cookie: 'augpt=codigo-de-teste-fundo-123', 'X-AuGPT': '1', 'Content-Type': 'application/json' } }, (res) => {
          let t = '';
          res.on('data', (d) => (t += d));
          res.on('end', () => {
            let c = null;
            try { c = JSON.parse(t); } catch {}
            ok({ status: res.statusCode, corpo: c });
          });
        });
        if (corpo) req.write(JSON.stringify(corpo));
        req.end();
      });
      try {
        const normal = await pedir('/api/enviar', { texto: 'vai chover?' });
        const fila = await pedir('/api/enviar', { texto: 'em segundo plano: compare 3 notebooks' });
        const lista = await pedir('/api/fundo');
        const sempre = await pedir('/api/fundo/responder', { id: 'fundo-1', valor: 'sempre' });
        const aprova = await pedir('/api/fundo/responder', { id: 'fundo-1', valor: 'aprovar' });
        return [
          normal.status === 409 || `normal: ${normal.status}`,
          (fila.status === 200 && fila.corpo?.fundo === 'fundo-1' && adicionados[0] === 'compare 3 notebooks') || JSON.stringify(fila),
          lista.corpo?.[0]?.estado === 'esperando' || JSON.stringify(lista),
          sempre.status === 400 || '"sempre" pelo celular',
          (aprova.corpo?.ok === true && respondidos.join() === 'fundo-1:aprovar') || respondidos.join(),
        ];
      } finally {
        await remoto.desligar();
      }
    },
  },
  {
    nome: 'segundo plano no app: o botão e o painel existem; a frase passa pela fila antes de rodar na tela; a checagem da agenda espera a fila; fechar o app para a fila',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(raiz, 'electron/main.js'), 'utf8');
      const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
      const abas = fs.readFileSync(path.join(raiz, 'renderer/app-abas.js'), 'utf8');
      return [
        (/id="btnFundoAgente"/.test(html) && /id="fundoPainel"/.test(html) && /segundo-plano\.js/.test(html)) || 'botão e painel',
        /api\.fundo\.detectar\(pedido\)/.test(abas) || 'frase no envio',
        /fundo\?\.ocupada/.test(main) || 'agenda espera',
        /fundo\.pararTudo\(\)/.test(main) || 'fecha junto',
        /navegador: null, skills \}\);\s*const reg = new Registro\(\{ origem: 'segundo-plano'/.test(main) || 'sem o navegador da conversa, com registro',
      ];
    },
  },
];
