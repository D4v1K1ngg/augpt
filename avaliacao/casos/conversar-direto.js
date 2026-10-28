'use strict';

/**
 * Conversar direto com o modelo (28/10, pedido do Davi: "o AuGPT já parte para a pesquisa"): opinião,
 * desabafo, conselho e ideias respondem sem pesquisa, no tom de conversa; produto, notícia e o pedido
 * explícito de pesquisa continuam pesquisando. O modo "Conversar" e os comandos de voz.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const { comandoDeVoz } = require('../../src/ditado');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const ent = (p, j = '{"precisa_buscar": true}') => nucleo.lerEntendimento(j, p);
const conversa = (p, j) => {
  const e = ent(p, j);
  return e.conversa === true && e.precisaBuscar === false;
};

module.exports = [
  {
    nome: 'conversar: opinião, sentimento, conselho e ideias sem pesquisa (mesmo com o modelo pedindo busca); produto, notícia, ciência e "pesquise" pesquisam; o escritor fala como numa conversa',
    tipo: 'unidade',
    executar() {
      const escritor = nucleo.sistemaDoEscritor({ hoje: 'x', comFontes: false, conversa: true });
      return [
        conversa('Você acha que vale a pena aprender violão depois dos 30?') || 'opinião',
        conversa('Estou meio cansado hoje') || 'sentimento (com "hoje")',
        conversa('Me ajuda a decidir se mudo de emprego') || 'decidir',
        conversa('Quero ideias de nome pro meu cachorro', '{"precisa_buscar": false, "conversa": true}') || 'o modelo diz conversa',
        conversa('E aí, tudo bem?') || 'cumprimento no tom de conversa',
        !conversa('Você acha que a RTX 5070 vale a pena?', '{"precisa_buscar": true, "produto": true}') || 'produto pesquisa',
        !conversa('O que você acha das notícias de hoje?') || 'notícia pesquisa',
        ent('Como funciona a fotossíntese?').precisaBuscar === true || 'ciência pesquisa',
        !conversa('Pesquise o que você acha de Python', '{"conversa": true}') || '"pesquise" pesquisa',
        /Agora é uma CONVERSA/.test(escritor) && /Sem títulos, sem listas/.test(escritor) || 'tom de conversa',
        !/Agora é uma CONVERSA/.test(nucleo.sistemaDoEscritor({ hoje: 'x', comFontes: true })) || 'pesquisa normal sem o tom',
      ];
    },
  },
  {
    nome: 'conversar: o modo "Conversar" nos três seletores tira a pesquisa (menos com "pesquise"); "Ei Jarvis, vamos só conversar" e "pode pesquisar de novo" trocam o modo',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const fonte = ler('src/agent/nucleo/index.js');
      return [
        (html.match(/value="conversa"/g) || []).length === 2 && /data-modo="conversa"/.test(html) || 'os três seletores',
        /if \(modo === 'conversa' && !PEDE_PESQUISA\.test\(String\(pergunta \|\| ''\)\)\) Object\.assign\(ent, \{ precisaBuscar: false, atual: false, conversa: true \}\);/.test(fonte) || 'modo conversa',
        comandoDeVoz('Vamos só conversar.') === 'so-conversar' && comandoDeVoz('Modo conversa') === 'so-conversar' || 'só conversar',
        comandoDeVoz('Pode pesquisar de novo.') === 'pesquisar' && comandoDeVoz('Sair do modo conversa') === 'pesquisar' || 'pesquisar de novo',
        comandoDeVoz('Conversar sobre o quê?') === null && comandoDeVoz('Pesquise o preço do arroz') === null && comandoDeVoz('Nova conversa') === 'nova-conversa' || 'frases comuns',
        /r\.comando === 'so-conversar' \|\| r\.comando === 'pesquisar'[\s\S]{0,300}window\.escolherModo\?\.\(conversa \? 'conversa' : 'automatico'\)/.test(ler('renderer/escuta.js')) || 'escuta troca o modo',
      ];
    },
  },
];
