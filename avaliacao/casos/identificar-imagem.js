'use strict';

/**
 * Identificar a imagem anexada e o painel "Buscar imagens" (16/11, Davi: "buscar na web com exatidão a imagem e me
 * dizer o que ela é" e "um sistema parecido com o de criar imagem, para buscar imagens com a ajuda da IA").
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pedidoDeIdentificacao, identificarImagem, ordenar } = require('../../src/agent/identificar-imagem');
const { ajustesDaBusca, passaNoFiltro } = require('../../src/agent/imagens-no-chat');
const { distanciaDoHash } = require('../../src/tools/imagens');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

module.exports = [
  {
    nome: 'identificar imagem: com a foto anexada, "o que é isso?", "identifique", "busque esta imagem" e "parecidas" vão para a busca na web; print e texto continuam com a visão',
    tipo: 'unidade',
    executar() {
      const casos = [
        ['o que é isso?', true, false],
        ['identifique esta imagem', true, false],
        ['busque essa imagem na internet', true, false],
        ['que planta é essa?', true, false],
        ['de onde é essa foto?', true, false],
        ['encontre imagens parecidas com esta', true, true],
        ['o que está escrito nesse print?', false],
        ['traduz o texto dessa imagem', false],
        ['resuma este documento', false],
      ];
      const erros = casos.filter(([t, vai, par]) => {
        const r = pedidoDeIdentificacao(t, true);
        return vai ? !r || r.parecidas !== par : r;
      });
      return [!erros.length || `errou: ${erros.map((c) => c[0]).join(' | ')}`, pedidoDeIdentificacao('o que é isso?', false) === null || 'sem foto anexada não é identificação'];
    },
  },
  {
    nome: 'identificar imagem: a mesma foto (dHash perto) vem primeiro e vira "Onde esta imagem aparece"; nome confirmado e certeza na resposta; pessoa não é identificada',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ident-'));
      const fotos = {
        'https://a.com/igual.png': { titulo: 'HyperX Cloud II - Gaming Headset', pagina: 'https://hyperx.com/cloud-ii', hash: 0b1111n },
        'https://b.com/outra.png': { titulo: 'Fone qualquer', pagina: 'https://b.com/p', hash: 0xffffffffn },
        'https://c.com/parecida.png': { titulo: 'HyperX Cloud II review', pagina: 'https://c.com/r', hash: 0xff00ff00n },
      };
      const hashes = new Map();
      const deps = {
        emit: () => {},
        buscarImagens: async () => Object.entries(fotos).map(([url, f]) => ({ url, titulo: f.titulo, pagina: f.pagina })),
        baixar: async (url) => ({ ok: true, buffer: Buffer.concat([PNG, Buffer.from(url)]), tipo: 'image/png' }),
        tamanhoDaImagem: () => ({ largura: 800, altura: 600 }),
        hashDaImagem: (arquivo) => hashes.get(path.basename(arquivo)) ?? 0b1110n,
        chamar: async (m) => ({ content: /Olhe a imagem/.test(m[0].content)
          ? JSON.stringify({ o_que_e: 'um headset gamer vermelho e preto', pessoa: false, palpites: ['HyperX Cloud II', 'criação artística'], busca: 'HyperX Cloud II headset', texto: '' })
          : /primeira imagem é a do usuário/.test(m[0].content) ? JSON.stringify({ iguais: [1, 2], identificacao: 'É o headset HyperX Cloud II.', certeza: 'alta' }) : JSON.stringify({ boas: [1, 2] }) }),
      };
      const imagens = require('../../src/tools/imagens');
      // os hashes de cada foto baixada, pelo nome do arquivo que o app dá
      for (const [url, f] of Object.entries(fotos)) hashes.set(imagens.nomeDoArquivo(url, 'png'), f.hash);
      const r = await identificarImagem({ pergunta: 'o que é isso?', imagem: { arquivo: path.join(dir, 'minha.png'), base64: 'eA==' }, deps, dir, config: { searxngUrl: 'http://x' } });
      const pessoa = await identificarImagem({ pergunta: 'o que é isso?', imagem: { arquivo: path.join(dir, 'minha.png'), base64: 'eA==' }, deps: { ...deps, chamar: async (m) => ({ content: /Olhe a imagem/.test(m[0].content) ? JSON.stringify({ o_que_e: 'uma pessoa sorrindo num parque', pessoa: true, palpites: ['Fulano de Tal'], busca: 'person smiling park' }) : JSON.stringify({ boas: [1] }) }) }, dir, config: { searxngUrl: 'http://x' } });
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        /### O que é\n\nÉ o headset HyperX Cloud II\./.test(r?.texto || '') || r?.texto,
        /Certeza alta — achei a mesma foto em 1 página/.test(r.texto) || 'a certeza e o porquê',
        /### Onde esta imagem aparece\n\n- \[HyperX Cloud II - Gaming Headset\]\(https:\/\/hyperx\.com\/cloud-ii\)/.test(r.texto) || 'a página com a mesma foto',
        r.fontes.length === 1 && r.fontes[0].url === 'https://hyperx.com/cloud-ii' || JSON.stringify(r.fontes),
        !/criação artística/.test(r.texto) || 'palpite genérico não vira busca',
        !/Onde esta imagem aparece|Fulano/.test(pessoa?.texto || '') && /não identifico pessoas pelo rosto/.test(pessoa?.texto || '') || pessoa?.texto,
        distanciaDoHash(0b1111n, 0b1110n) === 1 && distanciaDoHash(null, 1n) === 64 || 'distância do hash',
        ordenar([{ mesma: false, distancia: 3, titulo: 'x' }, { mesma: true, distancia: 9, titulo: 'y' }])[0].mesma === true || 'a mesma foto primeiro',
      ];
    },
  },
  {
    nome: 'buscar imagens: quantidade, tipo, orientação e tamanho do painel; sem medidas (fora do app) a foto passa',
    tipo: 'unidade',
    executar() {
      const aj = ajustesDaBusca({ buscaImagensQuantidade: '12', buscaImagensTipo: 'wallpaper', buscaImagensOrientacao: 'vertical', buscaImagensTamanho: 'grande', buscaImagensConferir: false });
      return [
        aj.quantidade === 12 && aj.tipo === 'wallpaper 4k' && aj.orientacao === 'vertical' && aj.ladoMinimo === 1200 && aj.conferir === false || JSON.stringify(aj),
        ajustesDaBusca({}).quantidade === 6 && ajustesDaBusca({}).conferir === true || 'padrões',
        passaNoFiltro({ largura: 1080, altura: 1920 }, aj) && !passaNoFiltro({ largura: 1920, altura: 1080 }, aj) && !passaNoFiltro({ largura: 600, altura: 900 }, aj) || 'orientação e tamanho',
        passaNoFiltro(null, aj) || 'sem medidas passa',
      ];
    },
  },
];
