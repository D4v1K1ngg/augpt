'use strict';

/**
 * 18/11 (Davi: "um sistema de questionários igual ao que o ChatGPT usa", "se eu pedir para o AuGPT criar um formulário ou
 * questionário, ele faz um no chat"): o bloco ```questionario vira formulário clicável; o "Para acertar na escolha" vem com
 * as respostas entre parênteses; a pergunta do agente aparece na conversa com opções.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nucleo = require('../../src/agent/nucleo');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

function componente() {
  const janela = {};
  vm.runInNewContext(ler('renderer/questionario.js'), { window: janela, document: {} });
  return janela.questionario;
}

module.exports = [
  {
    nome: 'questionário: o bloco do modelo (```questionario ou ```json com "perguntas") é consertado; fora de quiz, sem "correta"; a instrução só quando o usuário pede',
    tipo: 'unidade',
    executar() {
      const bloco = '```json\n{"titulo": "x", "perguntas": [{"texto": "a?", "tipo": "unica", "opcoes": ["1", "2"], "correta": 1, "explicacao": "e"},]}\n```';
      const quiz = nucleo.questionarioNaResposta(bloco, 'crie um quiz para eu treinar');
      const form = nucleo.questionarioNaResposta(bloco, 'monte um formulário de preferência de fone');
      return [
        /```questionario\n\{"titulo":"x","perguntas":\[\{"texto":"a\?","tipo":"unica","opcoes":\["1","2"\],"correta":1,"explicacao":"e"\}\]\}\n```/.test(quiz) || quiz,
        /```questionario\n\{"titulo":"x","perguntas":\[\{"texto":"a\?","tipo":"unica","opcoes":\["1","2"\]\}\]\}\n```/.test(form) || form,
        nucleo.questionarioNaResposta('```js\nconst perguntas = 1\n```', 'quiz') === '```js\nconst perguntas = 1\n```' || 'código comum fica',
        nucleo.PEDE_QUESTIONARIO.test('crie um questionário sobre redes') && nucleo.PEDE_QUESTIONARIO.test('me faz um quiz de história') && !nucleo.PEDE_QUESTIONARIO.test('qual o melhor fone?') || 'quando entra a instrução',
        !nucleo.pedeVisual('crie um quiz de 5 perguntas') && nucleo.pedeVisual('crie uma calculadora de IMC') || 'quiz não é mais página HTML',
        /\$\{PEDE_QUESTIONARIO\.test\(pergunta\) \? INSTRUCAO_DE_QUESTIONARIO : ''\}/.test(ler('src/agent/nucleo/index.js')) && nucleo.INSTRUCAO_DE_QUESTIONARIO.includes('NÃO use o bloco ```visual') || 'a instrução vai para o escritor',
        /cada uma com 2 a 4 respostas prováveis entre parênteses separadas por " \| "/.test(ler('src/agent/nucleo/index.js')) || '"Para acertar na escolha" com opções',
      ];
    },
  },
  {
    nome: 'questionário na tela: normaliza os tipos, "correta" só em escolha única válida, "Outra resposta" fora de quiz; md.js desenha o bloco; a pergunta do agente vai para a conversa com opções',
    tipo: 'unidade',
    executar() {
      const q = componente();
      const n = q.normalizar(q.ler('{"perguntas": [{"texto": "a?", "opcoes": ["x", "y"], "correta": 5}, {"texto": "b?", "tipo": "unica"}, {"texto": "c?", "tipo": "escala", "max": 10}, {"texto": ""},]}'));
      const quiz = q.normalizar({ perguntas: [{ texto: 'a?', opcoes: ['x', 'y'], correta: 1 }] });
      const md = ler('renderer/md.js');
      const ev = ler('renderer/app-eventos.js');
      return [
        n.perguntas.length === 3 && n.perguntas[0].tipo === 'unica' && n.perguntas[0].correta === null && n.perguntas[0].outro === true || JSON.stringify(n.perguntas[0]),
        n.perguntas[1].tipo === 'texto' && n.perguntas[2].tipo === 'escala' && n.perguntas[2].max === 10 && n.quiz === false || 'tipos',
        quiz.quiz === true && quiz.perguntas[0].correta === 1 && quiz.perguntas[0].outro === false || 'quiz',
        /'arquivos', 'questionario'\]\.includes/.test(md) && /global\.questionario\?\.converterListas\(elemento\)/.test(md) || 'md.js desenha o bloco e converte as listas',
        /<script src="questionario\.js"><\/script>/.test(ler('renderer/index.html')) || 'o script na página',
        /pergunta\(\{ id, pergunta, opcoes = \[\] \}\)/.test(ev) && /window\.questionario\.criar\(/.test(ev) && /t\.ancora\.appendChild\(caixa\)/.test(ev) || 'a pergunta do agente na conversa',
        /ask: async \(pergunta, opcoes = \[\]\)/.test(ler('src/agent/loop.js')) && /ctx\.ask\(pergunta \|\| 'Pode dar mais detalhes\?', opcoes\)/.test(ler('src/tools/index.js')) || 'perguntar_usuario com opções',
      ];
    },
  },
];
