'use strict';

/**
 * O plano de 2/11 para a pesquisa chegar perto do ChatGPT e do Gemini (sem modelo na nuvem):
 *   1. âncora no tempo — o preço "atual" bem abaixo do de hoje nas lojas ganha aviso;
 *   2. dados estruturados — a cotação de moedas vem da AwesomeAPI e da PTAX do Banco Central, não de sites;
 *   3. continuação — o pronome ("ela") é do assunto da mensagem mais recente, não do começo da conversa;
 *   4. "o que falta?" — o entendimento lista as partes da resposta e o pesquisador confere antes de parar.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const { avisoDePrecoAntigo } = require('../../src/agent/onde-comprar');
const cotacao = require('../../src/agent/cotacao-no-chat');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'âncora no tempo: "faixa atual de R$ 5.299 a R$ 7.199" com as lojas a R$ 9.005 hoje ganha aviso; preço de hoje parecido, preço antigo dito como antigo e sem lojas, não',
    tipo: 'unidade',
    executar() {
      const lojas = [{ loja: 'Zoom', preco: 9005.83, comparador: true }, { loja: 'KaBuM!', preco: 9287.8 }];
      const aviso = avisoDePrecoAntigo('O menor valor foi R$ 4.999,00 em 04/05/2026. Dados de lojas apontam uma faixa de preços atual entre R$ 5.299,00 e R$ 7.199,99.', lojas);
      return [
        /até R\$ 7\.199,99\) vêm de páginas antigas — hoje, nas lojas, o menor é R\$ 9\.005,83 \(Zoom\)/.test(aviso) || aviso,
        avisoDePrecoAntigo('Hoje ela custa cerca de R$ 9.100 na KaBuM.', lojas) === '' || 'preço de hoje parecido',
        avisoDePrecoAntigo('Em 2025 custava R$ 5.299; o preço atual não foi encontrado.', lojas) === '' || 'antigo dito como antigo',
        avisoDePrecoAntigo('O preço atual é R$ 7.199.', []) === '' || 'sem lojas',
        /const precoAntigo = avisoDePrecoAntigo\(r\.texto, achadosDoAssunto\);/.test(ler('src/agent/loop-nucleo.js')) || 'ligado na resposta',
      ];
    },
  },
  {
    nome: 'cotação pelos dados: dólar, euro, turismo, bitcoin e conversão ("100 dólares em reais") vão para a rota; previsão, história e "iPhone em dólares" não; a resposta traz valor, hora, fonte e a PTAX',
    tipo: 'unidade',
    async executar() {
      const p = (t) => JSON.stringify(cotacao.pedidoDeCotacao(t));
      const rotas = require('../../src/agent/rotas-do-codigo');
      const baixar = async (url) => (url.includes('awesomeapi')
        ? { ok: true, texto: JSON.stringify({ USDBRL: { bid: '5.4369', ask: '5.4383', pctChange: '-0.051', create_date: '2026-11-02 10:55:45' } }) }
        : { ok: true, texto: JSON.stringify({ value: [{ cotacaoVenda: 5.4212, dataHoraCotacao: '2026-10-30 13:04:18.706' }] }) });
      const r = await cotacao.responderCotacao({ pedido: cotacao.pedidoDeCotacao('quanto é 100 dólares em reais'), deps: { baixar }, agora: new Date(2026, 10, 2, 14) });
      return [
        p('Qual a cotação do dolar hoje ?') === '{"moeda":"USD","turismo":false,"quantia":null}' && p('dólar turismo hoje') === '{"moeda":"USD","turismo":true,"quantia":null}' && p('converte 50 euros') === '{"moeda":"EUR","turismo":false,"quantia":50}' && JSON.parse(p('cotação do bitcoin')).moeda === 'BTC' || 'detecção',
        ['o dólar vai subir na black friday?', 'história do dólar no Brasil', 'quanto custa um iPhone em dólares?'].every((t) => cotacao.pedidoDeCotacao(t) === null) || 'o que não é cotação',
        rotas.escolherRota({ objetivo: 'quanto está o euro?', conversa: [] })?.rota?.id === 'cotacao' && rotas.escolherRota({ objetivo: 'quanto está a rtx 5080?', conversa: [] })?.rota?.id === 'compras' || 'antes das compras',
        /\*\*Dólar comercial: R\$ 5,44\*\*/.test(r.texto) && /hoje às 10:55/.test(r.texto) && /\*\*100 dólares ≈ R\$ 543,83\*\*/.test(r.texto) && /PTAX do Banco Central .* de 30\/10\/2026: \*\*R\$ 5,4212\*\*/.test(r.texto) || r.texto,
      ];
    },
  },
  {
    nome: 'continuação da conversa: com pronome ("ela"), o entendimento é avisado de que ele é do assunto da mensagem MAIS RECENTE (2/11: o "ela" virou o dólar do começo da conversa); sem pronome, sem o aviso',
    tipo: 'unidade',
    executar() {
      const conversa = [
        { role: 'user', content: 'Qual a cotação do dolar hoje ?' }, { role: 'assistant', content: 'R$ 5,44' },
        { role: 'user', content: 'qual o valor da rtx 5070 ti hoje ?' }, { role: 'assistant', content: 'R$ 8.886,28 na KaBuM!' },
      ];
      const com = nucleo.pedidoDeEntendimento({ pergunta: 'sera que ela vai ficar com qual valor na black friday desse mes ?', conversa, hoje: '02/11/2026' });
      const sem = nucleo.pedidoDeEntendimento({ pergunta: 'qual o preço do ps5 hoje?', conversa, hoje: '02/11/2026' });
      return [
        /ATENÇÃO: a última mensagem usa pronome[\s\S]*"qual o valor da rtx 5070 ti hoje \?"/.test(com) || 'o aviso do pronome',
        !/ATENÇÃO: a última mensagem usa pronome/.test(sem) || 'sem pronome, sem aviso',
      ];
    },
  },
  {
    nome: 'previsão de preço é pesquisa, não loja: "será que ela vai ficar com qual valor na black friday?" (virou o produto "na black friday desse mes") e "qual a previsão de preço da rtx 5080" não vão para as compras; "quanto está a rtx 5080?" vai',
    tipo: 'unidade',
    executar() {
      const compras = require('../../src/agent/compras-no-chat');
      return [
        ['sera que ela vai ficar com qual valor na black friday desse mes ?', 'qual a previsão de preço da rtx 5080?', 'quanto a rtx 5080 deve custar no natal?'].every((t) => !compras.pedidoDeCompras(t) && !compras.intencaoDeCompras(t)) || 'previsão',
        compras.pedidoDeCompras('quanto está a rtx 5080?')?.produto === 'rtx 5080' || JSON.stringify(compras.pedidoDeCompras('quanto está a rtx 5080?')),
      ];
    },
  },
  {
    nome: '"o que falta?": o entendimento pede as partes da resposta (até 4); o pesquisador confere antes de parar, uma vez, em pergunta de 2+ partes, e busca o que faltou',
    tipo: 'unidade',
    executar() {
      const ent = nucleo.lerEntendimento('{"precisa_buscar": true, "partes": ["preço de lançamento da RTX 5070 Ti", "preço de hoje", "estimativa na Black Friday", "x", "a", "b", "c"]}', 'faz uma analise');
      const indice = ler('src/agent/nucleo/index.js');
      return [
        JSON.stringify(ent.partes) === '["preço de lançamento da RTX 5070 Ti","preço de hoje","estimativa na Black Friday"]' || JSON.stringify(ent.partes),
        /"partes": \["\.\.\."\]/.test(nucleo.pedidoDeEntendimento({ pergunta: 'x', conversa: [], hoje: 'hoje' })) || 'o entendimento pede as partes',
        /if \(conferiuPartes \|\| partes\.length < 2 \|\| rodada >= total \|\| signal\?\.aborted\) return false;/.test(indice) || 'uma vez, só com 2+ partes e rodada sobrando',
        (indice.match(/if \(await antesDeParar\(rodada\)\) continue;/g) || []).length === 2 && /!lacunaAberta && \(leiturasFeitas/.test(indice) || 'nos pontos de parada',
        /partes: ent\.partes \|\| \[\]/.test(indice) || 'o entendimento passa as partes à pesquisa',
      ];
    },
  },
];
