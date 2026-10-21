'use strict';

/**
 * Imagens nas respostas (2026-10-11): foto do produto nos cartões da
 * recomendação e imagem de referência nas explicações. Ver
 * src/tools/imagens.js. A rede é trocada por dublês — a bancada não baixa nada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const imagens = require('../../src/tools/imagens');
const compositor = require('../../src/agent/compositor');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-imagens-'));

/** `baixar` falso: a busca de imagens devolve `resultados`; cada endereço de imagem, o que estiver em `arquivos`. */
function redeFalsa({ resultados = [], arquivos = {} }) {
  const pedidos = [];
  const baixar = async (url) => {
    pedidos.push(url);
    if (/categories=images/.test(url)) return { ok: true, status: 200, tipo: 'application/json', texto: JSON.stringify({ results: resultados }) };
    const a = arquivos[url];
    if (!a) return { ok: false, status: 404, tipo: 'text/html', buffer: Buffer.from('nada') };
    return { ok: true, status: 200, tipo: a.tipo, buffer: a.buffer };
  };
  return { baixar, pedidos };
}

module.exports = [
  {
    nome: 'imagens: o título tem que citar o produto (todas as partes com número e a maioria das outras); "EM6L" não é "EM6"; nome colado ("RTX5080") vale',
    tipo: 'unidade',
    executar() {
      const sim = [
        ['Simgot EM6L Review: Is This Still the Best Gaming IEM', 'Simgot EM6L'],
        ['SIMGOT EM6L Hybrid Drivers 1 Dynamic + 4 Balanced', 'Simgot EM6L'],
        ['Placa de vídeo Gigabyte GeForce RTX5080 Gaming OC', 'RTX 5080'],
        ['Gerador Elétrico e Força Eletromotriz - Brasil Escola', 'gerador elétrico'],
      ];
      const nao = [
        ['Simgot EM6 Phoenix unboxing', 'Simgot EM6L'],
        ['Truthear Hexa vs Kiwi Ears Cadenza', 'Simgot EM6L'],
        ['GeForce RTX 5070 Ti', 'RTX 5080'],
        ['', 'Simgot EM6L'],
      ];
      return [
        ...sim.map(([t, n]) => imagens.tituloCita(t, n) || `deveria citar "${n}": ${t}`),
        ...nao.map(([t, n]) => !imagens.tituloCita(t, n) || `não cita "${n}": ${t}`),
      ];
    },
  },
  {
    nome: 'imagens: só JPEG, PNG e WebP conferidos pelos bytes entram; HTML com cabeçalho de imagem, tipo que não bate, arquivo grande demais e endereço que não é http ficam de fora; o nome gravado não tem dígito',
    tipo: 'unidade',
    async executar() {
      const dir = pasta();
      const { baixar } = redeFalsa({
        arquivos: {
          'https://a.com/foto.jpg': { tipo: 'image/jpeg', buffer: JPEG },
          'https://a.com/disfarce.jpg': { tipo: 'image/jpeg', buffer: Buffer.from('<html><script>alert(1)</script></html>') },
          'https://a.com/troca.jpg': { tipo: 'image/jpeg', buffer: PNG },
          'https://a.com/grande.jpg': { tipo: 'image/jpeg', buffer: Buffer.concat([JPEG, Buffer.alloc(imagens.MAX_BYTES + 1, 2)]) },
        },
      });
      const opcoes = { dir, deps: { baixar } };
      const boa = await imagens.guardarImagem('https://a.com/foto.jpg', opcoes);
      const nome = String(boa || '').replace('augpt-img://', '');
      const resultado = [
        /^augpt-img:\/\/[a-z]+\.jpg$/.test(String(boa)) || `imagem boa: ${boa}`,
        imagens.NOME_VALIDO.test(nome) || `nome fora do padrão que o app serve: ${nome}`,
        !/\d/.test(nome) || 'nome com dígito: o verificador leria como número da resposta',
        (nome && fs.existsSync(path.join(dir, nome))) || 'o arquivo deveria estar gravado',
        (await imagens.guardarImagem('https://a.com/disfarce.jpg', opcoes)) === null || 'HTML disfarçado de imagem entrou',
        (await imagens.guardarImagem('https://a.com/troca.jpg', opcoes)) === null || 'tipo declarado diferente dos bytes entrou',
        (await imagens.guardarImagem('https://a.com/grande.jpg', opcoes)) === null || 'imagem acima do limite entrou',
        (await imagens.guardarImagem('https://a.com/sumiu.jpg', opcoes)) === null || '404 não é imagem',
        (await imagens.guardarImagem('file:///C:/Windows/win.ini', opcoes)) === null || 'só http(s)',
        (await imagens.guardarImagem('https://a.com/foto.jpg', { deps: { baixar } })) === null || 'sem pasta de destino não grava',
      ];
      fs.rmSync(dir, { recursive: true, force: true });
      return resultado;
    },
  },
  {
    nome: 'imagens: cada produto recebe a 1ª imagem cujo título o cita (miniatura de vídeo e mural são pulados; a que não baixa cede a vez); sem SearXNG ou com o ajuste desligado, nenhuma busca',
    tipo: 'unidade',
    async executar() {
      const dir = pasta();
      const rede = redeFalsa({
        resultados: [
          { title: 'The Simgot EM6L Sucks - YouTube', img_src: 'https://i.ytimg.com/vi/x/maxres.jpg', url: 'https://youtube.com/watch?v=x' },
          { title: 'Truthear Hexa review', thumbnail_src: 'https://mini.com/hexa.jpg', img_src: 'https://site.com/hexa-grande.jpg', url: 'https://site.com/hexa' },
          { title: 'Simgot EM6L quebrada', thumbnail_src: 'https://mini.com/quebrada.jpg', url: 'https://loja.com/a' },
          { title: 'SIMGOT EM6L Hybrid Drivers', thumbnail_src: 'https://mini.com/em6l.jpg', img_src: 'https://loja.com/em6l-4000px.png', url: 'https://loja.com/em6l' },
        ],
        arquivos: {
          'https://mini.com/hexa.jpg': { tipo: 'image/jpeg', buffer: JPEG },
          'https://mini.com/em6l.jpg': { tipo: 'image/jpeg', buffer: Buffer.concat([JPEG, Buffer.from('em6l')]) },
        },
      });
      const config = { searxngUrl: 'http://127.0.0.1:1' };
      const fotos = await imagens.imagensDosProdutos(['Simgot EM6L', 'Truthear Hexa', 'Kefine Delci'], { config, dir, deps: { baixar: rede.baixar } });
      const baixadas = rede.pedidos.filter((u) => !/categories=images/.test(u));
      const antes = rede.pedidos.length;
      const semBusca = await imagens.imagensDosProdutos(['Simgot EM6L'], { config: {}, dir, deps: { baixar: rede.baixar } });
      const desligado = await imagens.imagensDosProdutos(['Simgot EM6L'], { config: { ...config, imagensNasRespostas: false }, dir, deps: { baixar: rede.baixar } });
      const resultado = [
        (fotos.size === 2 && fotos.has('Simgot EM6L') && fotos.has('Truthear Hexa')) || `fotos: ${[...fotos.keys()].join()}`,
        fotos.get('Simgot EM6L') !== fotos.get('Truthear Hexa') || 'cada produto com a sua foto',
        !baixadas.some((u) => /ytimg|4000px|hexa-grande/.test(u)) || `baixou o que não devia: ${baixadas.join()}`,
        baixadas.includes('https://mini.com/quebrada.jpg') || 'a 1ª candidata do EM6L (que falha) deveria ter sido tentada antes da 2ª',
        (semBusca.size === 0 && desligado.size === 0 && rede.pedidos.length === antes) || 'sem SearXNG ou desligado: nenhuma chamada',
      ];
      fs.rmSync(dir, { recursive: true, force: true });
      return resultado;
    },
  },
  {
    nome: 'imagens: a referência de uma explicação vem da Wikipédia quando há; senão, da busca de imagens',
    tipo: 'unidade',
    async executar() {
      const dir = pasta();
      const rede = redeFalsa({
        resultados: [{ title: 'Gerador elétrico de usina', thumbnail_src: 'https://mini.com/gerador.jpg', url: 'https://site.com/g' }],
        arquivos: {
          'https://upload.wikimedia.org/gerador.jpg': { tipo: 'image/jpeg', buffer: JPEG },
          'https://mini.com/gerador.jpg': { tipo: 'image/jpeg', buffer: Buffer.concat([JPEG, Buffer.from('busca')]) },
        },
      });
      const base = { config: { searxngUrl: 'http://127.0.0.1:1' }, dir, deps: { baixar: rede.baixar } };
      const daWiki = await imagens.imagemDeReferencia('gerador', { ...base, daWikipedia: [null, 'https://upload.wikimedia.org/gerador.jpg'] });
      const buscasAntes = rede.pedidos.filter((u) => /categories=images/.test(u)).length;
      const daBusca = await imagens.imagemDeReferencia('gerador elétrico', { ...base, daWikipedia: [] });
      const resultado = [
        (Boolean(daWiki) && buscasAntes === 0) || 'com imagem da Wikipédia não precisa buscar',
        (Boolean(daBusca) && daBusca !== daWiki) || `sem Wikipédia, vem da busca: ${daBusca}`,
        imagens.marcacao('Como [um] gerador\nfunciona', 'augpt-img://abc.jpg') === '![Como  um  gerador funciona](augpt-img://abc.jpg)' || 'o texto alternativo não pode quebrar a marcação',
      ];
      fs.rmSync(dir, { recursive: true, force: true });
      return resultado;
    },
  },
  {
    nome: 'imagens: a foto entra no cartão logo depois do nome e, na tela, vai para antes do título; a tela só desenha augpt-img:// (http, data: e nome fora do padrão ficam como texto)',
    tipo: 'unidade',
    executar() {
      const foto = `augpt-img://${'a'.repeat(40)}.jpg`;
      const r = {
        modo: 'recomendacao',
        plano: { criterios: [], uso: 'jogar' },
        finalistas: [{ nome: 'Simgot EM6L', status: {}, consenso: { topicos: 2, citacoes: [] } }, { nome: 'Truthear Hexa', status: {}, consenso: { topicos: 1, citacoes: [] } }],
        imagens: new Map([['Simgot EM6L', foto]]),
      };
      const texto = compositor.montar(r, new Map());

      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.md.render(texto);
      const solta = global.md.render(`![Gerador](${foto})\n\nUm gerador converte energia.`);
      const recusadas = global.md.render('![x](https://site.com/a.jpg)\n\n![y](data:image/png;base64,AAAA)\n\n![z](augpt-img://../../segredo.jpg)\n\n![w](augpt-img://abc123.jpg)');
      global.window = antes;
      return [
        texto.includes(`#### 1. Simgot EM6L\n![Simgot EM6L](${foto})\n`) || `a foto vem logo depois do nome: ${texto.slice(texto.indexOf('#### 1.'), texto.indexOf('#### 1.') + 160)}`,
        !/#### 2\. Truthear Hexa\n!\[/.test(texto) || 'produto sem foto não ganha marcação',
        html.includes(`<section class="cartao-produto">\n<figure class="md-figura md-destaque" style="--fundo: url('${foto}')"><img src="${foto}" alt="Simgot EM6L" loading="lazy" /></figure>\n<h5>1. Simgot EM6L</h5>`) || `no cartão a foto vai antes do título: ${html.slice(html.indexOf('<section'), html.indexOf('<section') + 260)}`,
        /^<figure class="md-figura"><img src="augpt-img:/.test(solta) || `fora de cartão a imagem fica onde está: ${solta.slice(0, 120)}`,
        !/<img/.test(recusadas) || `endereço que não é do app virou imagem: ${recusadas}`,
      ];
    },
  },
];
