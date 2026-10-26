'use strict';

/**
 * Instruções por assunto (27/10): "quando eu falar de compras, sempre mostre o preço à vista" vira regra
 * condicional na memória central e chega ao escritor do núcleo e ao agente das tarefas.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { instrucaoPorAssunto, pedidoDeMemoria, responderMemoria, preferenciasParaEscrever, preferenciasDaPergunta } = require('../../src/agent/memoria-no-chat');
const { MemoriaCentral } = require('../../src/agent/memoria-central');
const { escolherRota } = require('../../src/agent/rotas-do-codigo');

const raiz = path.join(__dirname, '../..');

module.exports = [
  {
    nome: 'instrução por assunto: o código separa assunto e instrução ("quando eu falar de…", "sempre que eu perguntar sobre…", "em pesquisas sobre…", "lembre que quando…", inglês); pergunta com "quando" e "me avise quando" não',
    tipo: 'unidade',
    executar() {
      const v = (t, a, i) => {
        const r = instrucaoPorAssunto(t);
        return (a === null ? r === null : r?.assunto === a && r?.instrucao === i) || `${t} → ${JSON.stringify(r)}`;
      };
      return [
        v('quando falar de compras, sempre mostre o preço à vista e o link', 'compras', 'Sempre mostre o preço à vista e o link.'),
        v('quando eu pedir código, use Python', 'código', 'Use Python.'),
        v('sempre que eu perguntar sobre futebol responda em tópicos', 'futebol', 'Responda em tópicos.'),
        v('lembre que quando eu pesquisar receitas, mostre o tempo de preparo', 'receitas', 'Mostre o tempo de preparo.'),
        v('em pesquisas sobre celulares, compare sempre a bateria', 'celulares', 'Compare sempre a bateria.'),
        v('a partir de agora, quando eu falar de viagens, mostre o clima do destino.', 'viagens', 'Mostre o clima do destino.'),
        v('when I talk about shopping, always show the cash price', 'shopping', 'Always show the cash price.'),
        v('quando é o próximo jogo do Flamengo?', null),
        v('quando eu pedir pizza, o que devo fazer?', null),
        v('me avise quando a RTX 6090 for lançada', null),
        v('lembre que eu prefiro respostas curtas', null),
        pedidoDeMemoria('lembre que eu prefiro respostas curtas') === 'lembrar' || 'fato comum continua "lembrar"',
        pedidoDeMemoria('esqueça a instrução de compras') === 'esquecer' || 'esquecer instrução',
        ['quando falar de compras, sempre mostre o preço à vista', 'quando eu perguntar sobre o clima, mostre também a umidade', 'quando eu pedir um mapa, use a vista de satélite'].every((t) => escolherRota({ objetivo: t })?.rota.id === 'memoria') || 'clima/mapa/compras não pegam a instrução',
      ];
    },
  },
  {
    nome: 'instrução por assunto: grava "Quando o assunto for X: …" (o mesmo assunto troca a instrução), lista separada dos fatos, "esqueça a instrução de X" tira só ela, e o escritor e o agente recebem a regra com o aviso de que vale só para X',
    tipo: 'unidade',
    async executar() {
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-instrucoes-'));
      try {
        const deps = { emit: () => {}, chamar: async () => ({ content: '{"assunto":"tamanho_das_respostas","fato":"Prefere respostas curtas."}' }) };
        const diga = async (pergunta) => (await responderMemoria({ pergunta, deps, pasta })).texto;
        const r = [];
        const anotado = await diga('quando eu falar de compras, sempre mostre o preço à vista');
        r.push(/Anotado ✓ — Quando o assunto for compras: Sempre mostre o preço à vista\./.test(anotado) || anotado);
        await diga('quando eu falar de compras, mostre 3 lojas');
        await diga('quando eu pedir código, use Python');
        await diga('lembre que eu prefiro respostas curtas');
        const m = new MemoriaCentral(pasta);
        const regras = m.listar().filter((i) => i.chave.startsWith('instrucao_'));
        r.push((regras.length === 2 && regras.some((i) => i.valor === 'Quando o assunto for compras: Mostre 3 lojas.')) || JSON.stringify(regras));
        const lista = await diga('o que você sabe sobre mim?');
        r.push((/Prefere respostas curtas/.test(lista) && /\*\*Instruções por assunto:\*\*\n\n- Quando o assunto for/.test(lista)) || lista);
        const pref = preferenciasParaEscrever(pasta);
        r.push((/Quando o assunto for código: Use Python\./.test(pref) && /Prefere respostas curtas/.test(pref)) || pref);
        r.push(/vale só se o pedido for sobre X/.test(new MemoriaCentral(pasta).paraPrompt()) || 'aviso no prompt das tarefas');
        // só as do assunto da pergunta chegam ao escritor (27/10: a de história vazava no motor elétrico)
        let pedido = '';
        const classifica = (nums) => async (msgs) => ((pedido = msgs[0].content), { content: JSON.stringify({ assuntos: nums }) });
        const soCodigo = await preferenciasDaPergunta(pasta, {}, { pergunta: 'faça um script que renomeia fotos', chamar: classifica([2]) });
        const numeros = [...pedido.matchAll(/(\d)\) (\S+)/g)].map((x) => `${x[1]}=${x[2]}`).join();
        const codigoEh2 = /2=código|2=codigo/.test(numeros);
        r.push((codigoEh2 ? /Use Python/.test(soCodigo) && !/compras/.test(soCodigo) : true) && /Prefere respostas curtas/.test(soCodigo) || `${numeros} | ${soCodigo}`);
        const nenhuma = await preferenciasDaPergunta(pasta, {}, { pergunta: 'como funciona um motor elétrico?', chamar: classifica([]) });
        r.push((!/Quando o assunto/.test(nenhuma) && /Prefere respostas curtas/.test(nenhuma)) || nenhuma);
        const semModelo = await preferenciasDaPergunta(pasta, {}, { pergunta: 'x', chamar: async () => { throw new Error('fora do ar'); } });
        r.push(!/Quando o assunto/.test(semModelo) || 'sem o modelo: nenhuma instrução');
        const tarefa = new MemoriaCentral(pasta).paraPrompt({ instrucoes: new Set(['instrucao_codigo']) });
        r.push((/Use Python/.test(tarefa) && !/compras: Mostre/.test(tarefa)) || tarefa);
        const esquecido = await diga('esqueça a instrução de compras');
        const depois = new MemoriaCentral(pasta).listar().map((i) => i.chave);
        r.push((/Esquecido/.test(esquecido) && !depois.includes('instrucao_compras') && depois.length === 2) || `${esquecido} | ${depois}`);
        await diga('esqueça todas as instruções');
        r.push(new MemoriaCentral(pasta).listar().every((i) => !i.chave.startsWith('instrucao_')) && new MemoriaCentral(pasta).listar().length === 1 || 'todas as instruções, o fato fica');
        return r;
      } finally {
        fs.rmSync(pasta, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'instrução por assunto no app: o escritor do núcleo sabe que "Quando o assunto for X" vale só para X; Ajustes → Memória tem o campo; o processo principal grava no mesmo formato',
    tipo: 'unidade',
    executar() {
      const nucleo = fs.readFileSync(path.join(raiz, 'src/agent/nucleo/index.js'), 'utf8');
      const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
      const main = fs.readFileSync(path.join(raiz, 'electron/main.js'), 'utf8');
      return [
        /Uma linha "Quando o assunto for X: …" é instrução só para pedidos sobre X/.test(nucleo) || 'escritor',
        (/id="instrucaoAssunto"/.test(html) && /id="btnInstrucaoAdicionar"/.test(html)) || 'campo nos Ajustes',
        /valor: `Quando o assunto for \$\{a\}: \$\{t\}`/.test(main) || 'mesmo formato',
      ];
    },
  },
];
