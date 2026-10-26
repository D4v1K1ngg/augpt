'use strict';

/**
 * Olhar a tela por qualquer caminho (27/10, relato do Davi: "o que é isso na minha tela?" digitado
 * pesquisou na web as peças do PC e respondeu "não consigo ver sua tela"; só o "Ei Jarvis", o botão e o
 * atalho capturavam, e com frases fixas). O entendimento marca "sobre_a_tela"; sem imagem, o app fotografa
 * a tela e o núcleo refaz com ela.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');

const raiz = path.join(__dirname, '../..');
const ent = (json, pergunta, comImagem = false) => nucleo.lerEntendimento(JSON.stringify(json), pergunta, { comImagem });

module.exports = [
  {
    nome: 'olhar a tela: o código reconhece "o que é isso na minha tela?", "dá uma olhada aqui", "o que estou vendo?"; "tela azul", "melhor tela para jogos" e "tela do meu celular" não',
    tipo: 'unidade',
    executar() {
      const sim = ['O que é isso na minha tela?', 'o que temos na minha tela?', 'dá uma olhada aqui', 'o que estou vendo?', 'consegue ver o que está aberto?', 'olha isso', "what's on my screen?"];
      const nao = ['o que é a tela azul?', 'qual a melhor tela para jogos?', 'troca a tela do celular', 'o que tem na tela do meu celular?', 'me fala sobre monitores'];
      return [...sim.map((t) => nucleo.pedeATela(t) || `devia: ${t}`), ...nao.map((t) => !nucleo.pedeATela(t) || `não devia: ${t}`)];
    },
  },
  {
    nome: 'olhar a tela: o modelo decide pelo sentido ("sobre_a_tela"), a tela em geral nunca conta, e com a imagem já anexada não pede de novo; só olhar não pesquisa, "que erro é esse?" pesquisa',
    tipo: 'unidade',
    executar() {
      return [
        ent({ sobre_a_tela: true }, 'me ajuda com isso que está aberto').sobreATela === true || 'pelo modelo',
        ent({ sobre_a_tela: true }, 'o que é a tela azul?').sobreATela === false || 'tela azul, mesmo com o modelo dizendo sim',
        ent({ sobre_a_tela: false }, 'dá uma olhada aqui').sobreATela === true || 'pela reserva do código',
        ent({ sobre_a_tela: true }, 'o que é isso na minha tela?', true).sobreATela === false || 'com imagem não fotografa de novo',
        ent({ precisa_buscar: true }, 'dá uma olhada aqui, o que você acha?', true).precisaBuscar === false || 'só olhar não pesquisa',
        ent({ precisa_buscar: true }, 'que erro é esse na minha tela?', true).precisaBuscar === true || 'erro pesquisa',
      ];
    },
  },
  {
    nome: 'olhar a tela no app: o núcleo fotografa e refaz com a imagem; só o agente da conversa aberta fotografa; a captura aparece no pedido',
    tipo: 'unidade',
    async executar() {
      const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
      // o núcleo com um modelo de mentira: 1º entendimento diz "sobre a tela", a foto chega, e a 2ª volta tem a imagem
      const vistos = [];
      let fotografou = 0;
      const deps = {
        emit: (e, d) => vistos.push([e, d?.nome]),
        chamar: async (msgs) => {
          const conteudo = msgs[0].content;
          if (msgs[0].images) return { content: 'Uma janela de editor de código.' };
          return { content: JSON.stringify({ precisa_buscar: false, sobre_a_tela: !/Imagem anexada/.test(conteudo), assuntos: [], pergunta: 'o que é isso na minha tela?' }) };
        },
        escrever: async () => 'Na imagem, um editor de código.',
        capturarTela: async () => ((fotografou += 1), { nome: 'captura.png', base64: 'AAAA', texto: '' }),
        embed: async () => [],
      };
      const r = await nucleo.responder({ pergunta: 'o que é isso na minha tela?', deps });
      return [
        fotografou === 1 || `fotografou ${fotografou}×`,
        vistos.some(([e, n]) => e === 'ferramenta' && n === 'olhar_tela') && vistos.some(([e, n]) => e === 'ferramenta' && n === 'ver_imagem') || JSON.stringify(vistos),
        /editor de código/.test(r.texto) || r.texto,
        /agent\.capturarTela = capturarTelaParaOAgente/.test(ler('electron/main.js')) && !/fundo[^\n]*capturarTela/.test(ler('electron/main.js')) || 'só o agente da conversa',
        /manipuladores\['tela-olhada'\]/.test(ler('renderer/tela.js')) || 'marca no pedido',
      ];
    },
  },
];
