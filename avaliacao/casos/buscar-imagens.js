'use strict';

/**
 * Buscar imagens (21/10): "busque uma imagem de um carro" virava pesquisa em texto. Agora é uma rota:
 * o modelo diz o que buscar, o código busca, baixa pelo app e monta uma galeria por item.
 */

const os = require('os');
const m = require('../../src/agent/imagens-no-chat');
const rotas = require('../../src/agent/rotas-do-codigo');

const rota = (t) => rotas.escolherRota({ objetivo: t, conversa: [], deps: {} })?.rota.id || 'pesquisa';

module.exports = [
  {
    nome: 'buscar imagens: "busque uma imagem de um carro", "mostre fotos da Torre Eiffel", "procure fotos do Fusca", "imagens desses setups" vão para a busca de imagens; criar imagem, câmera para fotos e as fotos do próprio PC não',
    tipo: 'unidade',
    executar() {
      const sim = ['busque uma imagem de um carro', 'mostre fotos da Torre Eiffel', 'procure fotos do Fusca 1975', 'busque imagens desses setus gamers pra min ver', 'me manda uns wallpapers de montanha', 'quero ver imagens de gatos'];
      const nao = [['crie uma imagem de um gato astronauta', null], ['qual a melhor câmera para fotos?', null], ['mostre quantas fotos eu tenho no meu pc', 'consultar_pc'], ['Busque por referencias dos 5 melhores setups gamers atuais', null]];
      return [
        ...sim.map((t) => rota(t) === 'buscar_imagens' || `${t} → ${rota(t)}`),
        ...nao.map(([t, esperado]) => (esperado ? rota(t) === esperado : rota(t) !== 'buscar_imagens') || `${t} → ${rota(t)}`),
        m.itensDaResposta('## Intro\n### #### 1. Setup Híbrido Console + PC\nx\n### 2. Cyberpunk Futurista: luzes\n#### 3. Minimalista Branco').join('|') === 'Setup Híbrido Console + PC|Cyberpunk Futurista|Minimalista Branco' || 'itens da resposta anterior',
      ];
    },
  },
  {
    nome: 'buscar imagens: "imagens desses" usa os itens da resposta anterior; uma galeria por item com a etiqueta do site de cada foto; sem a busca embutida, explica como ligar',
    tipo: 'unidade',
    async executar() {
      const consultas = [];
      const pedidos = [];
      const deps = {
        emit: () => {},
        chamar: async (msgs) => (pedidos.push(msgs[0].content), { content: JSON.stringify({ itens: [{ nome: 'Setup Cyberpunk', busca: 'cyberpunk gaming setup' }, { nome: 'Setup Branco', busca: 'white gaming setup' }] }) }),
        buscarImagens: async (q) => (consultas.push(q), [1, 2, 3, 4].map((i) => ({ url: `https://img.com/${encodeURIComponent(q)}-${i}.jpg`, titulo: `${q} ${i}`, pagina: `https://www.site${i}.com/p` }))),
        baixar: async () => ({ ok: true, tipo: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000)]) }),
      };
      const conversa = [{ role: 'user', content: 'os 5 setups mais bonitos' }, { role: 'assistant', content: '### 1. Setup Cyberpunk\ntexto\n### 2. Setup Branco\ntexto' }];
      const r = await m.responderImagens({ pergunta: 'busque imagens desses setups pra mim ver', conversa, deps, dir: os.tmpdir(), config: { searxngUrl: 'http://127.0.0.1:8899' } });
      const sem = await m.responderImagens({ pergunta: 'busque uma imagem de um carro', conversa: [], deps, dir: os.tmpdir(), config: {} });
      return [
        /Itens da última resposta do AuGPT: Setup Cyberpunk \| Setup Branco/.test(pedidos[0]) || 'os itens anteriores vão para o modelo',
        consultas.join('|') === 'cyberpunk gaming setup|white gaming setup' || consultas.join('|'),
        /\*\*Setup Cyberpunk\*\*\n!\[Setup Cyberpunk\]\(augpt-img:\/\//.test(r.texto) && /\*\*Setup Branco\*\*/.test(r.texto) || r.texto.slice(0, 300),
        /De: \[\(1\)\]\(https:\/\/www\.site1\.com\/p\)/.test(r.texto) || 'etiqueta do site',
        r.modo === 'imagens' || r.modo,
        /SearXNG/.test(sem.texto) || sem.texto,
      ];
    },
  },
];
