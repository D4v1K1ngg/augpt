'use strict';

/**
 * Conversas reais de 3 e 4/11: a fonte Corsair RM1000x ficou sem preço três vezes, o currículo virou
 * tabela de campos, "crie uma imagem dessa placa de som" desenhou outra placa e "Hoje (31/10)" no dia 3/11.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const precos = require('../../src/tools/precos');
const { casa } = require('../../src/agent/onde-comprar');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'fora do assunto: "rm1000x" (o nome vira "RM 1000x") casa com a página que escreve "RM1000x" — antes as páginas certas saíam todas; a RM850x continua fora',
    tipo: 'unidade',
    executar() {
      const itens = ['Corsair RM1000x 1000W: Preço Hoje e Histórico | Hardware Barato', 'Fonte Corsair RM1000x, 1000W, 80 Plus Gold', 'Corsair RM850x review']
        .map((t, i) => ({ f: { titulo: t, n: i + 1 }, texto: `texto sobre a ${t}`, semelhanca: 0.8 - i * 0.01, palavras: true }));
      const ficou = nucleo.semFontesForaDoAssunto('qual o preço hoje da fonte fonte corsair rm1000x', itens).map((x) => x.f.titulo);
      const rtx = nucleo.padraoDoProduto('RTX 5070');
      return [
        JSON.stringify(ficou) === JSON.stringify(itens.slice(0, 2).map((x) => x.f.titulo)) || JSON.stringify(ficou),
        rtx.test('placa rtx5070 nova') && rtx.test('rtx 5070') && rtx.test('a 5070 da nvidia') || String(rtx),
      ];
    },
  },
  {
    nome: 'lojas: "Fonte Corsair RM1000x … Com Cabo" é a fonte, não um cabo; "Cabo de força para fonte" e "Capa para iPhone" continuam acessório',
    tipo: 'unidade',
    executar() {
      const fonte = 'Fonte Corsair RM1000x SHIFT, 1000W, 80 Plus Gold, Totalmente Modular, PFC Ativo, Com Cabo, Preto';
      return [
        precos.ehOProduto(fonte, 'fonte corsair rm1000x') && casa(fonte, 'corsair rm1000x') || 'a fonte com cabo',
        !precos.ehOProduto('Cabo de força para Fonte Corsair RM1000x', 'fonte corsair rm1000x') && !casa('Cabo de força para Fonte Corsair RM1000x', 'corsair rm1000x') || 'cabo avulso',
        !casa('Capa para iPhone 15', 'iphone 15') || 'capa',
      ];
    },
  },
  {
    nome: 'documento anexado: "o que você acha desse currículo?" pede avaliação (pontos fortes, o que melhorar, o que falta), não a tabela de campos',
    tipo: 'unidade',
    executar() {
      const s = ler('skills/analisar-documento/SKILL.md');
      return [
        /Pedido de opinião ou de melhoria[\s\S]*sem tabela de campos/.test(s) || 'a regra da opinião',
        /Opinião sobre a escrita de um documento/.test(s) || 'opinião pode ser dada',
      ];
    },
  },
  {
    nome: 'imagem: "dessa placa de som" leva a última resposta ao prompt; "--v 5" e "--ar 16:9" saem do prompt; logo ilegível não refaz a imagem',
    tipo: 'unidade',
    executar() {
      const indice = ler('src/agent/nucleo/index.js');
      const p = nucleo.lerPrompt('{"prompt": "close-up of a black USB sound card, studio lighting --v 5 --ar 16:9"}', 'x').prompt;
      return [
        p === 'close-up of a black USB sound card, studio lighting' || p,
        /Sua última resposta \(quando o pedido diz "dessa"/.test(indice) || 'a última resposta no prompt',
        /Logo, marca ou letreiro ilegível NÃO é motivo para refazer/.test(indice) || 'a revisão',
      ];
    },
  },
  {
    nome: 'data: "Hoje (31/10/2026)" no dia 3/11 vira "Em 31/10/2026"; com a data de hoje, fica',
    tipo: 'unidade',
    executar() {
      const hoje = new Date(2026, 10, 3, 14);
      const t1 = nucleo.conferirResposta('Hoje (31/10/2026), o menor preço é R$ 8.359,02 na KaBuM!.', { material: 'R$ 8.359,02', hoje }).texto;
      const t2 = nucleo.conferirResposta('Hoje (03/11/2026), o menor preço é R$ 8.359,02.', { material: 'R$ 8.359,02', hoje }).texto;
      return [
        /^Em 31\/10\/2026, o menor preço/.test(t1) || t1,
        /^Hoje \(03\/11\/2026\)/.test(t2) || t2,
      ];
    },
  },
];
