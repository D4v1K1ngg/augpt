'use strict';

/**
 * Memória central pelo chat (22/10): "lembre que…", "esqueça que…", "o que você sabe sobre mim?"
 * gravam e apagam na memória central, e o que está guardado vai para o escritor em toda resposta.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../../src/agent/memoria-no-chat');
const rotas = require('../../src/agent/rotas-do-codigo');
const { MemoriaCentral } = require('../../src/agent/memoria-central');
const { sistemaDoEscritor } = require('../../src/agent/nucleo');

const rota = (t) => rotas.escolherRota({ objetivo: t, conversa: [], deps: {} })?.rota.id || 'pesquisa';

module.exports = [
  {
    nome: 'memória pelo chat: "lembre que", "meu nome é", "a partir de agora", "esqueça que" e "o que você sabe sobre mim" vão para a memória; lembrete ("lembre-me de"), conselho e conversa não',
    tipo: 'unidade',
    executar() {
      const sim = [['lembre que eu prefiro respostas curtas', 'lembrar'], ['meu nome é Davi', 'lembrar'], ['a partir de agora responda em tópicos', 'lembrar'], ['Por favor, guarde que eu moro em Curitiba', 'lembrar'], ['esqueça que eu moro em Curitiba', 'esquecer'], ['o que você sabe sobre mim?', 'listar']];
      const nao = ['lembre-me de pagar a conta amanhã', 'me lembre de ligar pro João', 'como lembrar de tomar água?', 'esquece, deixa pra lá', 'qual o nome do meu pc?'];
      return [
        ...sim.map(([t, acao]) => (m.pedidoDeMemoria(t) === acao && rota(t) === 'memoria') || `${t} → ${m.pedidoDeMemoria(t)} / ${rota(t)}`),
        ...nao.map((t) => (!m.pedidoDeMemoria(t) && rota(t) !== 'memoria') || `${t} → ${rota(t)}`),
      ];
    },
  },
  {
    nome: 'memória pelo chat: grava o fato que o modelo reescreveu, atualiza pela mesma chave, lista, apaga o que foi pedido e o escritor recebe as preferências',
    tipo: 'unidade',
    async executar() {
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-mem-'));
      const respostas = [
        '{"assunto":"estilo_das_respostas","fato":"Prefere respostas curtas e diretas."}',
        '{"assunto":"cidade","fato":"Mora em Curitiba."}',
        '{"assunto":"estilo_das_respostas","fato":"Prefere respostas em tópicos."}',
        '{"nome":"Davi"}', // fora do formato (o 9B fez isso): vale o que ele disse
      ];
      const deps = { emit: () => {}, chamar: async () => ({ content: respostas.shift() }) };
      const r1 = await m.responderMemoria({ pergunta: 'lembre que eu prefiro respostas curtas', deps, pasta });
      await m.responderMemoria({ pergunta: 'guarde que eu moro em Curitiba', deps, pasta });
      await m.responderMemoria({ pergunta: 'a partir de agora responda em tópicos', deps, pasta });
      const nome = await m.responderMemoria({ pergunta: 'meu nome é Davi', deps, pasta });
      const lista = await m.responderMemoria({ pergunta: 'o que você sabe sobre mim?', deps, pasta });
      // 22/10: com o modelo escolhendo, "esqueça meu nome" apagou tudo
      const soNome = await m.responderMemoria({ pergunta: 'esqueça meu nome da memória', deps, pasta });
      const apagou = await m.responderMemoria({ pergunta: 'esqueça que eu moro em Curitiba', deps, pasta });
      const nada = await m.responderMemoria({ pergunta: 'esqueça que eu tenho um gato', deps, pasta });
      const itens = new MemoriaCentral(pasta).listar();
      const prefs = m.preferenciasParaEscrever(pasta);
      const desligada = await m.responderMemoria({ pergunta: 'lembre que x', deps, pasta, config: { memoriaCentral: false } });
      const escritor = sistemaDoEscritor({ hoje: '22/10/2026', comFontes: false, preferencias: prefs });
      fs.rmSync(pasta, { recursive: true, force: true });
      return [
        /Anotado ✓ — Prefere respostas curtas e diretas\./.test(r1.texto) && r1.modo === 'memoria' || r1.texto,
        itens.length === 1 && itens[0].valor === 'Prefere respostas em tópicos.' || JSON.stringify(itens),
        /Mora em Curitiba/.test(lista.texto) && /em tópicos/.test(lista.texto) && /Chama-se Davi\./.test(lista.texto) || lista.texto,
        /Esquecido ✓\n\n- ~~Chama-se Davi\.~~$/.test(soNome.texto) || soNome.texto,
        /Esquecido ✓\n\n- ~~Mora em Curitiba\.~~$/.test(apagou.texto) || apagou.texto,
        /Não achei/.test(nada.texto) || nada.texto,
        /^Anotado ✓ — Chama-se Davi\./.test(nome.texto) || nome.texto,
        prefs === '- Prefere respostas em tópicos.' || prefs,
        /<preferencias_do_usuario>\n- Prefere respostas em tópicos\.\n<\/preferencias_do_usuario>/.test(escritor) || 'preferências no escritor',
        !/preferencias_do_usuario/.test(sistemaDoEscritor({ hoje: '22/10/2026', comFontes: false })) || 'sem preferências, sem bloco',
        /desligada/.test(desligada.texto) || desligada.texto,
      ];
    },
  },
];
