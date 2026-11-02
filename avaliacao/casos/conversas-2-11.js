'use strict';

/**
 * As conversas reais de 1 e 2/11 (RTX 5070 Ti e tela AMOLED): análise de preço virava cartões de compra, o ⚠
 * entrava num link e entre o número e a unidade, a resposta começava com citações soltas, a marcação
 * "[cartão de compras]" aparecia no texto, o preço que o próprio AuGPT mostrou era tirado, e o glossário explicava
 * um termo dentro de outro parêntese.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const { explicarTermos } = require('../../src/agent/glossario');

module.exports = [
  {
    nome: 'conversa de 2/11: histórico, evolução e previsão do preço de um produto são análise (sem cartões de compra); "qual o valor hoje" e "melhores até R$ 300" continuam pedido de produto',
    tipo: 'unidade',
    executar() {
      const ent = (p) => nucleo.lerEntendimento('{"precisa_buscar": true, "produto": true}', p).produto;
      const indice = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      return [
        ['faz uma analise do preço da rtx 5070 ti desde o lançamento ate o momento atual', 'com base nessa analise de historico de preço dela, voce estimaria que ela fique em qual faixa de preco na blacky friday ?', 'o preço da 5070 ti vai cair na black friday?'].every((p) => ent(p) === false) || 'análise de preço',
        ['qual o valor da rtx 5070 ti hoje ?', 'quais os melhores fones até R$ 300?', 'vale a pena comprar a rtx 5070 ti?'].every((p) => ent(p) === true) || 'pedido de produto',
        /Use só preços do modelo exato perguntado: versões vizinhas \(sem o "Ti", "Super", outra memória\) não valem/.test(indice) || 'a instrução da análise',
      ];
    },
  },
  {
    nome: 'conversa de 2/11: o ⚠ não entra em link nem em código de produto ("…-gb2031a"), fica depois da unidade ("63g ⚠"); citações soltas e "[cartão de compras]" saem; o preço da resposta anterior vale; o glossário não explica dentro de parêntese',
    tipo: 'unidade',
    executar() {
      const anos = nucleo.conferirAnos('O menor preço foi [(4)](https://achapromo.com.br/placa-ne7507t019t2-gb2031a). Lançada em 2025, deve cair em 2027.', { material: 'lançada em 2025', pergunta: '', hoje: '2026' });
      const fatos = nucleo.conferirFatos('Pesa cerca de 63g e tem 26000 dpi, 12 GB e 250W de TGP.', { material: '26000 dpi 250 W' });
      const r = nucleo.conferirResposta('A RTX 5070 Ti foi lançada por R$ 9.999 no Brasil. [11][22].\n\n#### 1. Palit\n\n**Pontos fracos:**\n* [cartão de compras]\n* ROPs faltando [22].\n\nHoje o menor preço é R$ 8.886 na KaBuM! [cartão de compras: RTX 5070 TI — menor preço R$ 8886.28 na KaBuM!]', { numeros: [11, 22], material: 'palit rtx 5070 ti ROPs [cartão de compras: RTX 5070 TI — menor preço R$ 8886.28 na KaBuM!]' });
      return [
        /gb2031a\)/.test(anos.texto) && /2027 ⚠/.test(anos.texto) && !/2031 ⚠/.test(anos.texto) || anos.texto,
        /63g ⚠/.test(fatos.texto) && /12 GB ⚠/.test(fatos.texto) && /250W de TGP/.test(fatos.texto) && !/\d ⚠[a-z]/i.test(fatos.texto) || fatos.texto,
        /^#### 1\. Palit/.test(r.texto) && !/\[cart[aã]o de/.test(r.texto) && !/\[11\]\[22\]/.test(r.texto) || r.texto,
        /R\$ 8\.886 na KaBuM/.test(r.texto) && JSON.stringify(r.precosSemFonte) === '["R$ 9.999"]' || JSON.stringify(r.precosSemFonte),
        explicarTermos('A estrutura inclui uma camada orgânica (OLED), e a tela OLED tem preto absoluto.') === 'A estrutura inclui uma camada orgânica (OLED), e a tela OLED (tela em que cada ponto acende sozinho: preto absoluto) tem preto absoluto.' || 'glossário',
      ];
    },
  },
];
