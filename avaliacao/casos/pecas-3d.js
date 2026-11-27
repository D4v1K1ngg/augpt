'use strict';

/**
 * 27/11 (Davi: "é possível implementar um sistema no augpt para criar objetos de impressão 3d?" — "a primeira opção
 * seria o ideal", "pode implementar e faz o visualizador 3d logo"): o pedido reconhecido pelo código, o ajuste da peça
 * anterior, o caminho escrever → gerar (erro volta ao modelo) → conferir pela foto, o especialista Gemma 4, o STL lido
 * pelo visualizador e a régua (avaliacao/pecas-3d/).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const peca = require('../../src/agent/nucleo/peca-3d');
const { caixaDoStl, OpenScad } = require('../../src/cad/openscad');
const { escolherEspecialista } = require('../../src/agent/especialistas');

const STL = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 20 10 3\nendloop\nendfacet\nendsolid t\n';

module.exports = [
  {
    nome: 'peças 3D: o código reconhece "cria uma peça 3D…", "faz … para imprimir", "em STL"; pergunta, imagem e impressora não; "deixa a parede com 3 mm" ajusta a peça que acabou de sair',
    tipo: 'unidade',
    executar() {
      const sim = ['cria uma peça 3d de um suporte de celular', 'faz um suporte de headset para eu imprimir na impressora', 'modela uma caixa 80x50x30 em STL', 'faz um gancho de parede para imprimir em 3D'];
      const nao = ['qual a melhor impressora 3d?', 'como faço uma peça 3d?', 'cria uma imagem de um gato', 'faz um resumo do texto'];
      const conversa = [{ role: 'user', content: 'cria uma caixa 3d' }, { role: 'assistant', content: '![Caixa](augpt-img://abcdefghijklmnopqrstuvwxyz.png){3d:abcdefghijklmnopqrstuvwxyz.stl}\n**Arquivos**: `pecas-3d/caixa-1/caixa.stl` · `pecas-3d/caixa-1/caixa.scad`' }];
      return [
        sim.every(peca.pedePeca3d) || sim.filter((t) => !peca.pedePeca3d(t)).join(' / '),
        !nao.some(peca.pedePeca3d) || nao.filter(peca.pedePeca3d).join(' / '),
        peca.ajusteDaPeca('deixa a parede com 3 mm', conversa) === 'pecas-3d/caixa-1/caixa.scad' && Boolean(peca.ajusteDaPeca('aumenta o furo para 5 mm', conversa)) || 'ajuste',
        !peca.ajusteDaPeca('obrigado!', conversa) && !peca.ajusteDaPeca('deixa a parede com 3 mm', [{ role: 'assistant', content: 'oi' }]) || 'sem peça antes, não é ajuste',
        peca.nomeDe('// Peça: Suporte de celular\ncube(1);') === 'Suporte de celular' && peca.nomeDe('cube(1);') === 'Peça 3D' || 'nome',
      ];
    },
  },
  {
    nome: 'peças 3D: erro do OpenSCAD volta para o modelo (até 2 vezes); a foto vai para o modelo conferir e a correção que nem gera fica de fora; a resposta traz o visualizador, as medidas e os arquivos; sem visão, não confere',
    tipo: 'unidade',
    async executar() {
      const falas = [];
      const respostas = ['```openscad\nx = cube(1);\n```', '```openscad\n// Peça: Arruela\ncube(1);\n```', 'O furo está fora do centro.\n```openscad\nquebrado(\n```'];
      let compilacoes = 0;
      const deps = {
        chamar: async (msgs) => {
          falas.push(msgs);
          return { content: respostas.shift() || 'OK' };
        },
        compilarPeca: async ({ codigo }) => {
          compilacoes += 1;
          if (/x = cube|quebrado/.test(codigo)) return { ok: false, erro: 'ERROR: Parser error' };
          return { ok: true, caixa: { tam: [20, 20, 3], min: [0, 0, 0] }, fotos: ['a.png', 'b.png'], fotosBase64: ['A', 'B'], stl: 's.stl', tresmf: 's.3mf' };
        },
        guardarPeca: async ({ nome }) => ({ nome, foto: 'augpt-img://abcdefghijklmnopqrstuvwxyz.png', stl: 'zyxwvutsrqponmlkjihgfedcba.stl', caminhos: { stl: 'pecas-3d/a/a.stl', tresmf: 'pecas-3d/a/a.3mf', scad: 'pecas-3d/a/a.scad' } }),
        modeloDaPeca: 'gemma4',
      };
      const r = await peca.criarPeca3d({ pergunta: 'faz uma arruela de 20 mm para imprimir em 3d', deps });
      const compilacoesDaPrimeira = compilacoes;
      const semVisao = await peca.criarPeca3d({ pergunta: 'faz um cubo para imprimir em 3d', deps: { ...deps, semVisao: 'não enxerga', chamar: async () => ({ content: '```openscad\ncube(1);\n```' }) } });
      return [
        /O OpenSCAD deu erro/.test(falas[1].slice(-1)[0].content) || 'o erro volta ao modelo',
        falas[2][1].images?.join() === 'A,B' && /20 × 20 × 3 mm/.test(falas[2][1].content) || 'a foto e as medidas vão para a conferência',
        /\]\(augpt-img:\/\/[a-z]+\.png\)\{3d:[a-z]+\.stl\}/.test(r.texto) && /20 × 20 × 3 mm/.test(r.texto) && /`pecas-3d\/a\/a\.scad`/.test(r.texto) && r.pecaCriada.correcoes === 0 && /cube\(1\)/.test(r.texto) || r.texto,
        compilacoesDaPrimeira === 3 || `compilações ${compilacoesDaPrimeira}`,
        semVisao.pecaCriada && !/conferida pela foto/.test(semVisao.texto) || 'sem visão',
      ];
    },
  },
  {
    nome: 'peças 3D: o Gemma 4 é o especialista quando instalado (sem aviso quando não está); o escolhido em Ajustes vale mais; o STL (ASCII) dá as medidas e o visualizador lê o mesmo arquivo; a linha {3d:…} vira o visualizador e só com .stl do app',
    tipo: 'unidade',
    async executar() {
      const comGemma = await escolherEspecialista({ objetivo: 'cria uma peça 3d de um gancho', config: {}, listar: async () => ['gemma4:26b-a4b-it-qat'] });
      const semGemma = await escolherEspecialista({ objetivo: 'cria uma peça 3d de um gancho', config: {}, listar: async () => ['qwen3.5:9b'] });
      const escolhido = await escolherEspecialista({ objetivo: 'cria uma peça 3d de um gancho', config: { especialistas: { peca3d: 'gpt-oss:20b' } }, listar: async () => ['gpt-oss:20b', 'gemma4:26b-a4b-it-qat'] });
      const arquivo = path.join(os.tmpdir(), `augpt-teste-${Date.now()}.stl`);
      fs.writeFileSync(arquivo, STL);
      const caixa = caixaDoStl(arquivo);
      fs.rmSync(arquivo, { force: true });
      delete require.cache[require.resolve('../../renderer/peca-3d.js')];
      require('../../renderer/peca-3d.js');
      const lido = global.peca3d.lerStl(new TextEncoder().encode(STL).buffer);
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.md.render('![Arruela](augpt-img://abcdefghijklmnopqrstuvwxyz.png){3d:zyxwvutsrqponmlkjihgfedcba.stl}');
      const ruim = global.md.render('![x](augpt-img://abcdefghijklmnopqrstuvwxyz.png){3d:https://mal.com/a.stl}');
      return [
        comGemma?.modelo === 'gemma4:26b-a4b-it-qat' && semGemma === null && escolhido?.modelo === 'gpt-oss:20b' || JSON.stringify({ comGemma, semGemma, escolhido }),
        caixa?.tam.join() === '20,10,3' || JSON.stringify(caixa),
        lido.pos.length === 9 && lido.max.join() === '20,10,3' || 'visualizador',
        /class="md-figura md-peca3d" data-stl="augpt-img:\/\/zyxwvutsrqponmlkjihgfedcba\.stl"/.test(html) || html,
        !/md-peca3d|src="https/.test(ruim) || ruim,
      ];
    },
  },
  {
    // 27/11 (Davi: "selecionar um lado da peça, botão direito, 'editar'… pense no que poderíamos fazer a mais")
    nome: 'peças 3D pela face: o clique acha o triângulo certo e junta a face inteira (a frente da caixa: 2 triângulos, normal -y); a descrição leva o plano, a faixa e o ponto em mm; o pedido "Na peça acima…" ajusta a peça; o Qwen3.8 27B vem antes do Gemma',
    tipo: 'unidade',
    async executar() {
      delete require.cache[require.resolve('../../renderer/peca-3d.js')];
      require('../../renderer/peca-3d.js');
      const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
      const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
      const stl = `solid c\n${f.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${v[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid c\n`;
      const p = global.peca3d.lerStl(new TextEncoder().encode(stl).buffer);
      const alvo = global.peca3d.acertar(p, [5, -20, 5], [0, 1, 0]);
      const face = global.peca3d.faceDe(p, alvo.tri);
      const desc = global.peca3d.descreverFace(face, alvo.ponto);
      const deCima = global.peca3d.acertar(p, [5, 5, 30], [0, 0, -1]);
      const conversa = [{ role: 'assistant', content: '![Caixa](augpt-img://abcdefghijklmnopqrstuvwxyz.png){3d:abcdefghijklmnopqrstuvwxyz.stl}\n`pecas-3d/caixa-1/caixa.scad`' }];
      const q = 'huggingface.co/mradermacher/Qwen3.8-27B-GGUF:Q3_K_M';
      const ambos = await escolherEspecialista({ objetivo: `Na peça acima, em ${desc.texto}: adicione uma fresta`, conversa, config: {}, listar: async () => [q, 'gemma4:26b-a4b-it-qat'] });
      return [
        alvo.ponto.join() === '5,0,5' && face.tris.length === 2 && face.normal.join() === '0,-1,0' && face.plana && face.area === 100 || JSON.stringify({ alvo, face }),
        desc.nome === 'a face da frente' && /no plano y = 0 mm/.test(desc.texto) && /x de 0 a 10, z de 0 a 10 mm/.test(desc.texto) && /ponto clicado: x 5, y 0, z 5 mm/.test(desc.texto) || desc.texto,
        global.peca3d.nomeDaFace(global.peca3d.faceDe(p, deCima.tri).normal) === 'a face de cima' || 'a de cima',
        peca.ajusteDaPeca(`Na peça acima, em ${desc.texto}: adicione uma fresta`, conversa) === 'pecas-3d/caixa-1/caixa.scad' || 'o pedido do visualizador é ajuste',
        ambos?.modelo === q && peca.rotuloDoModelo(q) === 'Qwen3.8-27B' || JSON.stringify(ambos),
        /window\.peca3dPedir = \(texto\) =>/.test(require('fs').readFileSync(require('path').join(__dirname, '../../renderer/app-abas.js'), 'utf8')) || 'o chat recebe o pedido do visualizador',
      ];
    },
  },
  {
    nome: 'peças 3D: o componente OpenSCAD — versão fixa com SHA-256; sem instalar, a compilação diz que falta; a biblioteca (gancho, suportes, engrenagem, caixa, tampa…) gera cada peça (só com o OpenSCAD instalado no PC)',
    tipo: 'unidade',
    async executar() {
      const { PACOTE } = require('../../src/cad/openscad');
      const vazio = await new OpenScad(path.join(os.tmpdir(), 'augpt-sem-openscad')).compilar({ codigo: 'cube(1);', pasta: os.tmpdir() });
      const checks = [
        /^[0-9a-f]{64}$/.test(PACOTE.sha256) && /openscad-2026\.11-RC0/.test(PACOTE.url) || 'versão fixa',
        vazio.ok === false && /não está instalado/.test(vazio.erro) || JSON.stringify(vazio),
      ];
      const dados = path.join(process.env.APPDATA || '', 'AuGPT', 'componentes', 'openscad');
      const o = new OpenScad(dados);
      if (!o.instalado()) return checks;
      const pasta = path.join(os.tmpdir(), `augpt-biblioteca-${Date.now()}`);
      const pecas = ['caixa(150, 100, 40, divisorias_x = 3)', 'tampa(80, 50)', 'placa_com_furos(100, 60, 3, 3.5)', 'tubo(70, 100, 2.5, 3)', 'cantoneira(40, 40, 20, 4, 5)', 'gancho_j()', 'suporte_inclinado()', 'suporte_parede()', 'engrenagem(20, 2, 5, 5)', 'knob()'];
      const falhas = [];
      for (const [i, p] of pecas.entries()) {
        const r = await o.compilar({ codigo: `include <augpt.scad>\n${p};`, pasta, nome: `p${i}`, fotos: false });
        if (!r.ok || r.caixa.min[2] !== 0) falhas.push(`${p}: ${r.erro || `z mínimo ${r.caixa?.min[2]}`}`);
      }
      fs.rmSync(pasta, { recursive: true, force: true });
      return [...checks, !falhas.length || falhas.join(' · ')];
    },
  },
];
