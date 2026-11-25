'use strict';

/**
 * Os 5 defeitos da leitura das 17 respostas da régua (25/11, Davi: "vamos olhar as respostas e ver se estão saindo boas").
 */

const fs = require('fs');
const path = require('path');
const { explicarTermos } = require('../../src/agent/glossario');
const { semPrecoComLoja } = require('../../src/agent/onde-comprar');
const { semPalavrao } = require('../../src/agent/sem-palavrao');
const { semEnchimento } = require('../../src/agent/capacidades');

module.exports = [
  {
    nome: 'respostas de 25/11: o glossário não explica o verbo "inverter"; a cotação não leva a ficha do PC e o escritor só usa o dado do PC que muda a resposta; o "Preço: não especificado" sai do cartão com loja; palavrão de fórum sai; a data que sobra da abertura sai',
    tipo: 'unidade',
    executar() {
      const nucleo = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      const comLoja = '#### 1. Simgot EM6L\n\n**Onde comprar (preços de 25/11/2026):** [Zoom: a partir de R$ 946,03](x)\n\nServe bem.\n**Preço:** Não especificado nas fontes (bla).\n**Atenção:** nada.\n';
      return [
        !/inverter \(/.test(explicarTermos('Você precisa inverter isso nas configurações.')) || 'o verbo',
        /Inverter \(motor/.test(explicarTermos('O ar-condicionado Gree Inverter gasta menos.')) && /compressor inverter \(motor/.test(explicarTermos('Tem compressor inverter.')) || 'o aparelho',
        /'calendario', 'cotacao'\]\.includes\(ent\.acao\)/.test(nucleo) && /SO_O_QUE_MUDA = 'Use cada dado só onde ele muda a resposta/.test(nucleo) || 'o PC na cotação e a regra do escritor',
        !/não especificado/i.test(semPrecoComLoja(comLoja)) && /Atenção/.test(semPrecoComLoja(comLoja)) && !/não especifica/.test(semPrecoComLoja(comLoja.replace('Não especificado nas fontes', 'A fonte não especifica o valor'))) || 'preço com loja',
        /não especificado/i.test(semPrecoComLoja('#### 1. X\n**Preço:** Não especificado nas fontes.\n')) || 'sem loja, a linha fica',
        semPalavrao('uma opção de "puta de uma melhora" em relação') === 'uma opção de "baita melhora" em relação' && semPalavrao('essa merda trava') === 'essa m**** trava' || 'palavrão',
        semPalavrao('computador, disputa, reputação') === 'computador, disputa, reputação' && semPalavrao('o que é porra?', 'o que é porra?') === 'o que é porra?' || 'palavra comum e o palavrão do próprio usuário',
        semEnchimento('Com base nas fontes mais recentes de hoje, **25 de novembro de 2026**, aqui estão as notícias:').startsWith('Aqui estão') || 'a data que sobra',
        semEnchimento('25 de novembro de 2026: o dia em que algo aconteceu.').startsWith('25 de novembro') || 'a resposta que começa pela data fica',
      ];
    },
  },
];
