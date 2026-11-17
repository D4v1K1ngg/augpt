'use strict';

/**
 * Produto ≠ pedido de recomendação (16/11, conversa do Davi: "o nome desse fone que eu mandei é o simgot supermix 4"
 * respondeu "o que importa para jogos competitivos", com "quem usa cita" relógio, mouse e processador). Só o pedido de
 * escolha, comparação ou "serve para um uso" liga a busca de critérios, a lista da comunidade e o formato de opções.
 */

const fs = require('fs');
const path = require('path');
const { pedeRecomendacao } = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'produto ou recomendação: escolher, comparar e "é bom para…" recomendam; o nome, specs e preço de UM produto, não; continuação curta de uma recomendação continua',
    tipo: 'unidade',
    executar() {
      const recomenda = [
        'Poderia me recomendar os melhores fones intra auriculares para se jogar pubg ?',
        'Me recomende um top 5 melhores fones',
        'O Simgot EM6L é bom para jogar FPS?',
        'Qual a diferença de desempenho entre a RTX 5070 Ti e a RTX 5080?',
        'Qual é o melhor sansung s26 ultra ou iphone 18 pro max ?',
        'qual air fryer comprar?',
        'vale a pena o truthear nova?',
      ];
      const sobreUm = [
        'o nome desse fone que eu mandei é o simgot supermix 4',
        'fone de ouvido dunu titan s',
        'qual o preço hoje da fonte corsair rm1000x',
        'especificações do simgot supermix 4',
      ];
      const errados = [...recomenda.filter((p) => !pedeRecomendacao(p)), ...sobreUm.filter((p) => pedeRecomendacao(p))];
      const fonte = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      return [
        !errados.length || `errou: ${errados.join(' | ')}`,
        pedeRecomendacao('e para música?', [{ role: 'assistant', content: '### 🎯 O que importa para este uso\n…' }]) || 'continuação de recomendação',
        !pedeRecomendacao('e o peso dele?', [{ role: 'assistant', content: 'O SuperMix 4 tem…' }]) || 'continuação de informação',
        /if \(!produto \|\| !recomendacao \|\| deps\.criteriosAntes === false/.test(fonte) || 'a busca de critérios só em recomendação',
        /if \(produto && recomendacao && !signal\?\.aborted\) \{/.test(fonte) || '"quem usa cita" só em recomendação',
        /produto: recomenda, tamanho:/.test(fonte) && /content: recomenda && usadas\.length \?/.test(fonte) || 'o formato de opções só em recomendação',
        /nunca invente um uso/.test(fonte) || 'a busca de critérios não inventa o uso (o exemplo de CS era copiado)',
      ];
    },
  },
];
