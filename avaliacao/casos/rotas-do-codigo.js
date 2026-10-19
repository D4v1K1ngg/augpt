'use strict';

/**
 * As rotas que o código responde (19/10, revisão): a ordem da lista é a prioridade,
 * a mesma lista atende a ação do entendimento e o "sim", e a rota vai para o registro.
 */

const rotas = require('../../src/agent/rotas-do-codigo');
const { MARCA_DO_PLANO } = require('../../src/agent/rede-no-chat');
const { Registro } = require('../../src/registro');
const { EventEmitter } = require('events');

const id = (objetivo, conversa = []) => rotas.escolherRota({ objetivo, conversa, deps: {} })?.rota.id || 'pesquisa';

module.exports = [
  {
    nome: 'rotas do código: a ordem decide — utilitários, ajuste ("aplicar" depois do plano), ping do jogo antes do teste de rede, consulta fixa do PC antes da leitura livre; opinião e conselho ficam com a pesquisa',
    tipo: 'unidade',
    executar() {
      const plano = [{ role: 'user', content: 'otimize minha placa de rede' }, { role: 'assistant', content: `| Ajuste | Agora | Depois |\n${MARCA_DO_PLANO} dns_cloudflare` }];
      const casos = [
        ['o que você pode fazer?', 'utilitarios'],
        ['otimize minha placa de rede', 'ajustes_de_rede'],
        ['qual meu ping no pubg?', 'rota_de_jogo'],
        ['mede meu ping', 'teste_de_rede'],
        ['faça um raio-x da minha rede', 'diagnostico_da_rede'],
        ['o que está consumindo minha internet?', 'trafego_de_rede'],
        ['quanto espaço livre meu pc tem?', 'consultar_pc'],
        ['meu chipset da amd está atualizado?', 'leitura_livre'],
        ['veja as politicas de grupo do meu windows', 'leitura_livre'],
        ['qual a melhor placa de vídeo até R$ 3.000?', 'pesquisa'],
        ['como liberar espaço no meu pc?', 'pesquisa'],
      ];
      return [...casos.map(([t, esperado]) => id(t) === esperado || `${t} → ${id(t)} (esperava ${esperado})`), id('aplicar', plano) === 'ajustes_de_rede' || `"aplicar" depois do plano → ${id('aplicar', plano)}`, new Set(rotas.ROTAS.map((r) => r.id)).size === rotas.ROTAS.length || 'ids repetidos'];
    },
  },
  {
    nome: 'rotas do código: a ação pelo id passa direto (sem detecção), id desconhecido devolve null, rota que devolve null cai na pesquisa, e a resposta leva o nome da rota',
    tipo: 'unidade',
    async executar() {
      const emitidos = [];
      const deps = { emit: (e, d) => emitidos.push([e, d]) };
      const lista = await rotas.executar('utilitarios', { objetivo: 'qualquer coisa', conversa: [], deps });
      const nada = await rotas.executar('nao_existe', { objetivo: 'x', conversa: [], deps });
      const devolve = await rotas.responderPelaRota({}, { rota: { id: 'teste', responde: async () => null }, pedido: true });
      return [
        lista?.rota === 'utilitarios' && /aba \*\*Utilitários\*\*/.test(lista.texto) && emitidos.some(([e]) => e === 'resposta-token') || JSON.stringify(lista).slice(0, 200),
        nada === null || 'id desconhecido',
        devolve === null || 'devolveu para a pesquisa',
      ];
    },
  },
  {
    nome: 'rotas do código: o registro grava a rota que respondeu (antes, consulta do PC e teste de rede apareciam como caminho antigo)',
    tipo: 'unidade',
    executar() {
      const agente = new EventEmitter();
      const registro = new Registro({ origem: 'bancada', modelo: 'falso' });
      registro.acompanhar(agente);
      agente.emit('nucleo-fim', { modo: 'normal', rota: 'consultar_pc', ms: 10, fontes: 0 });
      const d = registro.dados;
      return [d.rota === 'consultar_pc' || `rota no registro: ${JSON.stringify(Object.keys(d)).slice(0, 200)}`];
    },
  },
];
