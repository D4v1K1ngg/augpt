'use strict';

/**
 * Pauta da escrita (12/11): antes de escrever, uma chamada curta lista os pontos do material (com as fontes), e o
 * escritor recebe a lista junto da pergunta para cobrir todos. Medido na pergunta do Windows para jogos: 11 das 12
 * dicas estavam nos trechos e só 7 chegavam à resposta do 9B.
 */

const nucleo = require('../../src/agent/nucleo');

const usadas = [
  { n: 1, titulo: 'Guia A', url: 'https://a.exemplo/x', conteudo: 'Ative o Modo de Jogo em Configurações > Jogos. Atualize o driver da placa de vídeo.' },
  { n: 3, titulo: 'Guia B', url: 'https://b.exemplo/y', conteudo: 'Use o plano de energia de alto desempenho. O Modo de Jogo também ajuda.' },
];

module.exports = [
  {
    nome: 'pauta da escrita: os pontos voltam numerados com as fontes válidas (fonte que não existe sai); menos de 3 pontos, JSON quebrado ou uma fonte só não geram pauta',
    tipo: 'unidade',
    async executar() {
      const pedidos = [];
      const resposta = (conteudo) => async (m, o) => (pedidos.push({ m, o }), { content: conteudo });
      const boa = await nucleo.pautaDaEscrita('como otimizar o windows?', usadas, {
        chamar: resposta('{"pontos":[{"ponto":"ativar o Modo de Jogo em Configurações > Jogos","fontes":[1,3]},{"ponto":"atualizar o driver da placa de vídeo","fontes":[1,9]},{"ponto":"plano de energia de alto desempenho","fontes":[3]}]}'),
      });
      const poucos = await nucleo.pautaDaEscrita('x', usadas, { chamar: resposta('{"pontos":[{"ponto":"só um ponto aqui","fontes":[1]}]}') });
      const quebrado = await nucleo.pautaDaEscrita('x', usadas, { chamar: resposta('não é json') });
      const umaFonte = await nucleo.pautaDaEscrita('x', usadas.slice(0, 1), { chamar: resposta('{"pontos":[]}') });
      return [
        /^\(Pauta/.test(boa) && /1\. ativar o Modo de Jogo em Configurações > Jogos \[1\]\[3\]/.test(boa) || boa,
        /2\. atualizar o driver da placa de vídeo \[1\]\n/.test(boa) || 'a fonte [9] não existe e sai',
        /3\. plano de energia de alto desempenho \[3\]/.test(boa) || 'terceiro ponto',
        pedidos[0].o.json === true && /Modo de Jogo em Configurações/.test(pedidos[0].m[0].content) && /\[3\] Guia B/.test(pedidos[0].m[0].content) || 'o material vai no pedido, em JSON',
        poucos === '' && quebrado === '' && umaFonte === '' || `sem pauta: ${JSON.stringify([poucos, quebrado, umaFonte])}`,
        require('../../src/llm/ollama').limiteDeSaida('gpt-oss:20b', 300) === 1324 && require('../../src/llm/ollama').limiteDeSaida('qwen3.5:9b', 300) === 300 || 'folga de saída só no gpt-oss (o raciocínio dele não desliga)',
        ['Como controlar melhor o spray no pubg de pc ?', 'Realizar ajustes no registro do windows pode fazer eu ganhar mais desempenho em jogos ?', 'desativar as mitigações (Spectre e Meltdown) melhora o desempenho em jogos ?', 'o que eu posso fazer para melhorar a minha conexão de internet para jogar jogos online ?', "Eu devo usar a opção 'Modo de latência baixa' da NVIDIA no modo Ultra para jogar PUBG?"]
          .every((q) => nucleo.lerEntendimento('{"precisa_buscar":false,"conversa":true}', q).precisaBuscar === true) || 'pergunta de "como fazer" ou de desempenho pesquisa mesmo com o 9B marcando conversa',
        nucleo.lerEntendimento('{"precisa_buscar":false,"conversa":true}', 'Você acha que vale a pena aprender violão depois dos 30?').conversa === true || 'opinião continua conversa',
        /não acrescente assunto vizinho/.test(nucleo.pedidoDeEntendimento({ pergunta: 'x', hoje: '12/11/2026' })) || 'as partes ficam no que o usuário pediu',
      ];
    },
  },
  {
    nome: 'anotações por página: cada fonte ganha "Pontos desta página" no topo e um trecho mais curto; JSON quebrado deixa a fonte como estava',
    tipo: 'unidade',
    async executar() {
      let vez = 0;
      const chamar = async () => ({ content: vez++ === 0 ? '{"pontos":["ativar o Modo de Jogo","atualizar o driver"]}' : 'não é json' });
      const [a, b] = await nucleo.anotarPaginas('como otimizar?', usadas, { chamar });
      return [
        /^Pontos desta página:\n- ativar o Modo de Jogo\n- atualizar o driver\n\nTrecho da página:\nAtive o Modo/.test(a.conteudo) || a.conteudo,
        b.conteudo === usadas[1].conteudo || 'sem pontos, a fonte fica igual',
        a.n === 1 && a.url === usadas[0].url || 'número e endereço da fonte ficam',
      ];
    },
  },
];
