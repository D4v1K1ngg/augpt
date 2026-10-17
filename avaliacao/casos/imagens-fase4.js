'use strict';

/**
 * Fase 4 (16/10): imagem anexada vai para a visão do modelo (com o OCR do
 * Tesseract junto, quando instalado), o pesquisador olha imagens da web,
 * várias imagens de referência num carrossel. Modelo, rede e Tesseract são dublês.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const { imagensAnexadas } = require('../../src/agent/loop');
const { Tesseract } = require('../../src/tesseract');
const imagens = require('../../src/tools/imagens');

const BLOCO = (linhas) => `\n\nArquivos anexados, já copiados para a pasta de trabalho:\n${linhas.map((l) => `- ${l}`).join('\n')}\nUse ler_arquivo para abri-los.`;

/** Modelo falso que guarda cada chamada; a de visão (com images) devolve `visao`. */
function modelo({ entendimento, visao = 'Um fone intra-auricular prateado; na caixa está escrito "DUNU TITAN S".', roteiro = [] }) {
  const chamadas = [];
  const escritas = [];
  let passo = 0;
  return {
    chamadas,
    escritas,
    chamar: async (messages, opcoes = {}) => {
      chamadas.push({ messages, opcoes });
      if (messages.some((m) => m.images) && !opcoes.tools) return { content: visao, chamadas: [] };
      if (opcoes.json) return { content: JSON.stringify(entendimento), chamadas: [] };
      const r = roteiro[passo++];
      return { content: '', chamadas: (r || [['pronto', {}]]).map(([name, args]) => ({ function: { name, arguments: args } })) };
    },
    escrever: async (messages, onToken) => (escritas.push(messages), onToken('ok'), 'ok'),
  };
}

module.exports = [
  {
    nome: 'fase 4: anexo só de imagens vai pelo núcleo (o bloco de anexos sai do pedido); anexo que não é imagem, ou mais de 4, segue no caminho de tarefas; imagem sem texto vira "o que é isto?"',
    tipo: 'unidade',
    executar() {
      const fotos = imagensAnexadas(`que fone é esse?${BLOCO(['foto.jpg (120 KB)', 'Print-2.PNG (33 KB)'])}`);
      const sozinha = imagensAnexadas(BLOCO(['a.webp (1 KB)']).trim());
      return [
        fotos?.pedido === 'que fone é esse?' && fotos.arquivos.join() === 'foto.jpg,Print-2.PNG' || `imagens: ${JSON.stringify(fotos)}`,
        imagensAnexadas(`resuma${BLOCO(['doc.pdf (1 KB)'])}`) === null && imagensAnexadas(`x${BLOCO(['a.jpg', 'b.pdf'])}`) === null || 'PDF segue no caminho de tarefas',
        imagensAnexadas(`x${BLOCO(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'])}`) === null || 'mais de 4 imagens: caminho de tarefas',
        /^O que é isto\?/.test(sozinha?.pedido || '') || `sem texto: ${sozinha?.pedido}`,
        imagensAnexadas('qual o melhor fone?') === null || 'sem anexo: nada',
      ];
    },
  },
  {
    nome: 'fase 4: imagem anexada — o modelo olha (com o OCR junto), o que viu vai para o entendimento e para a escrita, que também recebe a imagem; com imagem, "o que está escrito aqui?" pode ficar sem busca',
    tipo: 'unidade',
    async executar() {
      const img = { nome: 'foto.jpg', base64: 'QUJD', texto: 'DUNU TITAN S  R$ 499' };
      const m = modelo({ entendimento: { precisa_buscar: true, produto: true, assuntos: ['Dunu Titan S'], pergunta: 'o Dunu Titan S é bom?' } });
      const eventos = [];
      await nucleo.responder({
        pergunta: 'esse fone é bom?',
        modo: 'rapido',
        imagens: [img],
        deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [{ titulo: 'Titan S review', url: 'https://a.com/x', resumo: 'review' }], lerPagina: async () => ({ texto: 'x '.repeat(50) }), emit: (e, d) => eventos.push([e, d]) },
      });
      const visao = m.chamadas.find((c) => c.messages.some((x) => x.images));
      const entendimento = m.chamadas.find((c) => c.opcoes.json);
      const sistema = m.escritas[0][0].content;
      const ultima = m.escritas[0][m.escritas[0].length - 1];
      const semBusca = modelo({ entendimento: { precisa_buscar: false, produto: false, assuntos: [], pergunta: 'o que está escrito aqui?' }, visao: 'Um print com o texto "Reunião às 15h".' });
      const r2 = await nucleo.responder({ pergunta: 'o que está escrito aqui?', imagens: [{ nome: 'p.png', base64: 'QUJD', texto: '' }], deps: { chamar: semBusca.chamar, escrever: semBusca.escrever, buscar: async () => { throw new Error('não devia buscar'); }, lerPagina: async () => ({}) } });
      return [
        visao && visao.messages[0].images[0] === 'QUJD' && /Texto lido por OCR[\s\S]*DUNU TITAN S {2}R\$ 499/.test(visao.messages[0].content) || 'a visão recebe a imagem e o OCR',
        /\[Imagem anexada pelo usuário — o que se vê nela: Um fone intra-auricular prateado/.test(entendimento.messages[0].content) || 'o entendimento sabe o que a imagem mostra',
        /<imagem_anexada>[\s\S]*DUNU TITAN S/.test(sistema) && ultima.images?.[0] === 'QUJD' || 'a escrita recebe o que foi visto e a própria imagem',
        eventos.some(([e, d]) => e === 'ferramenta' && d.nome === 'ver_imagem') && eventos.some(([e]) => e === 'imagem-vista') || 'painel de atividade mostra a visão',
        r2.buscou === false && /Reunião às 15h/.test(semBusca.escritas[0][0].content) || 'com imagem, pedido de leitura dela fica sem busca',
      ];
    },
  },
  {
    nome: 'fase 4: ver_imagens — o pesquisador olha imagens da web (vira fonte, mas não conta como página lida); sem a busca de imagens ou no modo rápido, a ferramenta não aparece',
    tipo: 'unidade',
    async executar() {
      const rodar = async ({ modo = 'normal', comImagens = true } = {}) => {
        const m = modelo({
          entendimento: { precisa_buscar: true, produto: false, assuntos: ['Chevrolet Vectra GT'], pergunta: 'como é a traseira do Vectra GT?' },
          visao: 'A traseira tem um aerofólio no alto da tampa.',
          roteiro: [[['buscar_na_web', { buscas: ['vectra gt'] }], ['ver_imagens', { busca: 'Vectra GT traseira', pergunta: 'tem aerofólio?' }]]],
        });
        const lidas = [];
        const deps = {
          chamar: m.chamar,
          escrever: m.escrever,
          buscar: async (q) => Array.from({ length: 5 }, (_, i) => ({ titulo: `${q} ${i}`, url: `https://s${i}.com/${q}`, resumo: 'texto' })),
          lerPagina: async (url) => (lidas.push(url), { texto: 'conteúdo da página '.repeat(30) }),
        };
        if (comImagens) deps.buscarImagensParaVer = async () => [{ url: 'https://img.com/1.jpg', pagina: 'https://site.com/vectra-gt', titulo: 'Vectra GT traseira', base64: 'SU1H' }];
        const fontes = await nucleo.pesquisar({ pergunta: 'como é a traseira do Vectra GT?', modo, deps, hoje: 'x', assuntos: ['Chevrolet Vectra GT'] });
        const ferramentas = m.chamadas.filter((c) => c.opcoes.tools).flatMap((c) => c.opcoes.tools.map((t) => t.function.name));
        return { fontes, ferramentas, lidas, m };
      };
      const ok = await rodar();
      const img = ok.fontes.find((f) => f.imagem);
      const sem = await rodar({ comImagens: false });
      const rapido = await rodar({ modo: 'rapido' });
      return [
        img?.url === 'https://site.com/vectra-gt' && /aerofólio no alto da tampa/.test(img.trechos[0]) || `fonte de imagem: ${JSON.stringify(img)}`,
        ok.m.chamadas.some((c) => c.messages[0]?.images?.[0] === 'SU1H') || 'o modelo recebe as imagens',
        ok.lidas.length === 3 || `a imagem não conta no mínimo de 3 páginas: ${ok.lidas.length} lidas`,
        !sem.ferramentas.includes('ver_imagens') && !rapido.ferramentas.includes('ver_imagens') && ok.ferramentas.includes('ver_imagens') || 'ferramenta só com busca de imagens e fora do rápido',
      ];
    },
  },
  {
    nome: 'fase 4: várias imagens de referência — as candidatas que citam o item são baixadas juntas, a que falha é pulada, até n; várias marcas numa linha viram um carrossel com setas',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-carrossel-'));
      const jpg = (i) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, i)]);
      const baixar = async (url) => {
        if (/\/search\?/.test(url)) {
          return { ok: true, texto: JSON.stringify({ results: Array.from({ length: 8 }, (_, i) => ({ img_src: `https://img${i}.com/a.jpg`, title: i === 7 ? 'Outra coisa' : `Nikola Tesla foto ${i}`, url: `https://p${i}.com` })) }) };
        }
        const i = Number(/img(\d)/.exec(url)[1]);
        return i === 1 ? { ok: false } : { ok: true, buffer: jpg(i), tipo: 'image/jpeg' };
      };
      const uris = await imagens.imagensDe('Nikola Tesla', { config: { searxngUrl: 'http://busca' }, dir, deps: { baixar }, n: 4 });
      fs.rmSync(dir, { recursive: true, force: true });
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      global.window = antes;
      const html = global.md.render('![Tesla](augpt-img://abcdefghijklmnopqrstuvwxyz.jpg) ![Tesla](augpt-img://bbcdefghijklmnopqrstuvwxyz.jpg)');
      return [
        uris.length === 4 && new Set(uris).size === 4 || `4 imagens distintas, pulando a que falhou: ${uris.length}`,
        /md-carrossel/.test(html) && (html.match(/md-figura/g) || []).length === 2 && /md-seta" data-dir="1"/.test(html) || `carrossel: ${html.slice(0, 200)}`,
      ];
    },
  },
  {
    nome: 'fase 4: Tesseract — instala pelo winget e baixa português e inglês; versão nova vira "atualizar"; o texto lido deixa de fora as mensagens do próprio Tesseract; fora do Windows, explica como instalar',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ocr-'));
      const instalados = new Set();
      const comandos = [];
      const bin = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tesseract-OCR', 'tesseract.exe');
      const existe = (c) => instalados.has(c) || fs.existsSync(c) && c.startsWith(dir);
      const executar = async (arquivo, args) => {
        comandos.push([path.basename(arquivo), args[0]]);
        if (arquivo === 'winget') return instalados.add(bin), 'ok';
        if (args[0] === '--version') return 'tesseract v5.4.0.20240606\n leptonica-1.84.1';
        return 'Estimating resolution as 300\nNOTA FISCAL Nº 123\nTotal: R$ 45,90\n';
      };
      const buscar = async (url) => (/api\.github/.test(url) ? { ok: true, json: async () => ({ tag_name: 'v5.5.0' }) } : { ok: true, arrayBuffer: async () => Buffer.alloc(200000, 1) });
      const t = new Tesseract(dir, { plataforma: 'win32', buscar, executar, existe });
      const antes = await t.estado();
      await t.instalar();
      const depois = await t.estado();
      const imagem = path.join(dir, 'nota.png');
      fs.writeFileSync(imagem, 'x');
      const texto = await t.lerTexto(imagem);
      const mac = await new Tesseract(dir, { plataforma: 'darwin', buscar, executar, existe }).instalar().then(() => '', (e) => e.message);
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        antes.instalado === false || 'antes: não instalado',
        comandos.some(([c, a]) => c === 'winget' && a === 'install') && depois.instalado === true || `instalou: ${JSON.stringify(depois)} ${JSON.stringify(comandos)}`,
        depois.atualizar === true && depois.disponivel === '5.5.0' || 'v5.5.0 publicada: oferece atualizar',
        texto === 'NOTA FISCAL Nº 123\nTotal: R$ 45,90' || `texto: ${JSON.stringify(texto)}`,
        /brew install tesseract/.test(mac) || `Mac: ${mac}`,
      ];
    },
  },
  {
    nome: 'fase 4: produto reconhecido por foto leva o aviso "pela aparência" (o modelo disse "certo" para o modelo errado); com o nome lido pelo OCR, não',
    tipo: 'unidade',
    async executar() {
      const rodar = async (textoOcr) => {
        const m = modelo({ entendimento: { precisa_buscar: true, produto: true, assuntos: ['EPOS H3 Pro'], pergunta: 'o EPOS H3 Pro é bom?' }, visao: 'Fone verde com detalhes em bronze.\nIdentificação: EPOS H3 Pro — certo.' });
        const r = await nucleo.responder({
          pergunta: 'que fone é esse?',
          modo: 'rapido',
          imagens: [{ nome: 'f.jpg', base64: 'QUJD', texto: textoOcr }],
          deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [{ titulo: 'H3 Pro', url: 'https://a.com/x', resumo: 'review' }], lerPagina: async () => ({ texto: 'x '.repeat(50) }) },
        });
        return r.texto;
      };
      const semOcr = await rodar('');
      const comOcr = await rodar('EPOS H3 PRO HYBRID');
      return [
        /^\*Pela foto, o modelo foi reconhecido pela aparência/.test(semOcr) || `sem OCR: ${semOcr.slice(0, 120)}`,
        !/Pela foto/.test(comOcr) || 'com o nome lido pelo OCR, sem aviso',
      ];
    },
  },
  {
    nome: 'fase 4 (17/10, Llama 3.2 3B): modelo que não enxerga não recebe imagem — com texto do OCR, responde a partir dele; sem OCR, explica como resolver (trocar para um Qwen 3.5 ou instalar o Tesseract) sem chamar o modelo com a imagem',
    tipo: 'unidade',
    async executar() {
      const rodar = async (texto) => {
        const m = modelo({ entendimento: { precisa_buscar: false, produto: false, assuntos: [], pergunta: 'o que diz esse print?' } });
        const r = await nucleo.responder({
          pergunta: 'o que diz esse print?',
          imagens: [{ nome: 'p.png', base64: 'QUJD', texto }],
          deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [], lerPagina: async () => ({}), semVisao: 'O modelo em uso não enxerga imagens… Qwen 3.5… Tesseract' },
        });
        return { r, m };
      };
      const comOcr = await rodar('Reunião às 15h na sala 2');
      const semOcr = await rodar('');
      const recebeuImagem = (m) => m.chamadas.some((c) => c.messages.some((x) => x.images)) || m.escritas.some((e) => e.some((x) => x.images));
      return [
        !recebeuImagem(comOcr.m) && /Reunião às 15h na sala 2/.test(comOcr.m.escritas[0][0].content) || 'com OCR: responde pelo texto lido, sem mandar a imagem',
        semOcr.m.escritas.length === 0 && !recebeuImagem(semOcr.m) && /Qwen 3\.5/.test(semOcr.r.texto) || `sem OCR: explica (${semOcr.r.texto})`,
      ];
    },
  },
];
