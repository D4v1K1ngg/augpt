'use strict';

/** Conta (13/11, src/agent/conta-no-chat): expressão pura o código calcula; texto com palavras fica com o modelo. */

const c = require('../../src/agent/conta-no-chat');
const { escolherRota } = require('../../src/agent/rotas-do-codigo');

module.exports = [
  {
    nome: 'conta: "(12783,23 * 0,17) + 823,42" dá 2.996,57 pelo código; vírgula decimal, ponto de milhar, x e ^; pergunta com palavras não é conta',
    tipo: 'unidade',
    async executar() {
      const r = await c.responderConta({ pedido: c.pedidoDeConta('Quanto é (12783,23 * 0,17) + 823,42?') });
      return [
        /\*\*2\.996,57\*\*/.test(r.texto) || r.texto,
        escolherRota({ objetivo: 'Quanto é (12783,23 * 0,17) + 823,42?' })?.rota.id === 'conta' || 'a rota responde',
        c.pedidoDeConta('quanto é 1.000 x 3?')?.valor === 3000 && c.pedidoDeConta('2^10')?.valor === 1024 && c.pedidoDeConta('qual o resultado de 3 - (2 * 5)?')?.valor === -7 || 'milhar, x, ^ e parênteses',
        ['quanto é a rtx 5070', 'Quanto vira R$ 10.000 aplicados a 1% ao mês?', 'em 2026 quanto custa?', 'quanto é 5'].every((t) => c.pedidoDeConta(t) === null) || 'com palavras ou sem operador, não é conta',
      ];
    },
  },
];
