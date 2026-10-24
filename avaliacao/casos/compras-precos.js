'use strict';

/**
 * Preços nas lojas (24/10, no estilo do Google Shopping): o agregador (Zoom, Buscapé, KaBuM!,
 * Americanas), o que é o produto pedido, usado, suspeito, sem repetição; a pergunta no chat; e o
 * alerta de preço da Agenda. As lojas são dublês — a bancada não sai para a rede.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const precos = require('../../src/tools/precos');
const chat = require('../../src/agent/compras-no-chat');
const agendaNoChat = require('../../src/agent/agenda-no-chat');
const rotas = require('../../src/agent/rotas-do-codigo');
const { Agenda } = require('../../src/agenda');

const next = (dados) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(dados)}</script></html>`;
const hit = (id, name, price, loja, extra = {}) => ({ type: 'offer', objectId: `offer${id}`, name, price, merchantName: loja, url: `/lead?oid=${id}`, image: `https://i.zst.com.br/${id}.jpg`, installments: { amount_months: 10, price: price / 10 }, ...extra });

function lojas() {
  const busca = { props: { initialReduxState: { hits: { hits: [
    hit(1, 'Placa de Vídeo MSI RTX 5080 Shadow 3X OC 16GB', 11799, 'Magazine Luiza'),
    hit(2, 'Placa de Vídeo Gigabyte RTX 5080 Windforce 16GB', 3964.71, 'Loja Desconhecida'),
    hit(3, 'Placa de Vídeo Zotac RTX 5070 Ti Solid 16GB', 8899.99, 'Terabyte'),
    hit(4, 'Asus ROG Zephyrus G16 Ultra 9 RTX 5080 SSD 2TB RAM 32GB', 45400, 'KaBuM!'),
    hit(5, 'Usado: Placa de Vídeo ASUS RTX 5080 TUF 16GB', 9500, 'Trocafy'),
    hit(6, 'Backplate para RTX 5080', 199, 'Pichau'),
    { type: 'product', name: 'Placa de Vídeo Palit RTX 5080 GamingPro 16GB', price: 12999, storeCount: 2, url: '/placa-de-video/palit-rtx-5080', image: 'https://i.zst.com.br/p.jpg' },
  ] } } } };
  const produto = { props: { initialReduxState: { offers: { offerList: [
    { id: 70, name: 'Placa de Vídeo Palit RTX 5080 GamingPro 16GB', price: 12999, sellerName: 'Amazon', imageUrl: 'https://image.zst.com.br/70.jpg', numParcels: 10, parcelValue: 1299.9 },
    { id: 71, name: 'Placa de Vídeo Palit RTX 5080 GamingPro 16GB', price: 13499, sellerName: 'KaBuM!', imageUrl: 'https://image.zst.com.br/71.jpg', numParcels: 1, parcelValue: 13499 },
  ] } } } };
  const kabum = `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [{ '@type': 'Product', name: 'Placa de Vídeo Inno3D RTX 5080 X3 16GB', image: 'https://images.kabum.com.br/1.jpg', offers: { price: '12467.84', priceCurrency: 'BRL', url: 'https://www.kabum.com.br/produto/1/inno3d' } }, { '@type': 'Product', name: 'Placa de Vídeo MSI RTX 5080 Shadow 3X OC 16GB', image: 'https://images.kabum.com.br/2.jpg', offers: { price: '13100', priceCurrency: 'BRL', url: 'https://www.kabum.com.br/produto/2/msi' } }] })}</script></html>`;
  const americanas = JSON.stringify([{ productName: 'Placa de Vídeo Zotac RTX 5080 Solid OC 16GB', link: 'https://www.americanas.com.br/produto/9', items: [{ images: [{ imageUrl: 'https://americanas.vteximg.com.br/9.jpg' }], sellers: [{ commertialOffer: { Price: 12850, AvailableQuantity: 3 } }] }] }]);
  const pedidos = [];
  const baixar = async (url) => {
    pedidos.push(url);
    if (/zoom\.com\.br\/search|buscape\.com\.br\/search/.test(url)) return { ok: true, status: 200, texto: /page=2/.test(url) ? next({ props: { initialReduxState: { hits: { hits: [] } } } }) : next(busca), url };
    if (/zoom\.com\.br\/placa|buscape\.com\.br\/placa/.test(url)) return { ok: true, status: 200, texto: next(produto), url };
    if (/kabum\.com\.br\/busca/.test(url)) return { ok: true, status: 200, texto: kabum, url };
    if (/americanas\.com\.br\/api/.test(url)) return { ok: true, status: 200, texto: americanas, url };
    return { ok: false, status: 404, texto: '' };
  };
  return { baixar, pedidos };
}

module.exports = [
  {
    nome: 'preços: junta Zoom, Buscapé, KaBuM! e Americanas sem repetir; separa o produto pedido de modelo vizinho, notebook e acessório; marca usado e preço suspeito; o menor confiável é o novo',
    tipo: 'unidade',
    async executar() {
      const { baixar, pedidos } = lojas();
      const r = await precos.buscarOfertas('rtx 5080', { deps: { baixar } });
      const por = (trecho) => r.ofertas.find((o) => o.nome.includes(trecho));
      const menor = precos.menorConfiavel(r.ofertas);
      const usado = precos.menorConfiavel(r.ofertas, { usado: true });
      return [
        r.fontes.every((f) => f.ok) || JSON.stringify(r.fontes),
        r.ofertas.filter((o) => o.nome.includes('Shadow 3X OC') && o.loja === 'Magazine Luiza').length === 1 || 'Zoom e Buscapé repetidos contam uma vez',
        por('5070 Ti')?.exato === false && por('Zephyrus')?.exato === false && por('Backplate')?.exato === false || 'vizinho, notebook e acessório não são o produto',
        por('Usado:')?.usado === true || 'usado marcado',
        por('Windforce')?.suspeito === true && por('Shadow 3X OC')?.suspeito === false || 'R$ 3.964 suspeito; R$ 11.799 não',
        por('GamingPro') && r.ofertas.filter((o) => o.nome.includes('GamingPro')).map((o) => o.loja).sort().join(',') === 'Amazon,KaBuM!' || 'as lojas da página do produto',
        menor?.preco === 11799 && menor.loja === 'Magazine Luiza' || JSON.stringify(menor),
        usado?.preco === 9500 || 'menor usado',
        r.ofertas.every((o, i, l) => i === 0 || !l[i - 1].exato || !o.exato || l[i - 1].preco <= o.preco) || 'exatos do menor para o maior',
        pedidos.some((u) => u.includes('americanas.com.br/api/catalog_system/pub/products/search?ft=rtx%205080')) || 'Americanas pela busca pública',
      ];
    },
  },
  {
    nome: 'preços: reconhece "quanto está", "preço do", "onde comprar", "está quanto?" (pt e en); dólar, aluguel, recomendação, comparação e gráfico de preço ficam fora',
    tipo: 'unidade',
    executar() {
      const p = (q) => chat.pedidoDeCompras(q)?.produto || null;
      const dentro = { 'quanto está a rtx 5080?': 'rtx 5080', 'preço do ps5 slim': 'ps5 slim', 'onde comprar o logitech g pro x superlight 2': 'logitech g pro x superlight 2', 'a rtx 5070 ti está quanto?': 'rtx 5070 ti', 'RTX 5080 preço': 'RTX 5080', 'how much is the rtx 5080?': 'rtx 5080', 'menor preço da rtx 4060': 'rtx 4060' };
      const fora = ['quanto está o dólar hoje?', 'qual o preço do aluguel em SP?', 'qual o melhor mouse até 300 reais?', 'vale a pena comprar a rtx 5080?', 'qual a diferença de preço entre a 5080 e a 5070 ti?', 'monte um gráfico com o preço da RTX 5080 desde o lançamento', 'quanto custa uma consulta no dentista?'];
      return [
        ...Object.entries(dentro).map(([q, esperado]) => p(q) === esperado || `${q} → ${p(q)}`),
        ...fora.map((q) => p(q) === null || `fora: ${q} → ${p(q)}`),
        rotas.escolherRota({ objetivo: 'quanto está a rtx 5080?', conversa: [] })?.rota.id === 'compras' || 'a rota',
      ];
    },
  },
  {
    nome: 'preços: a resposta no chat (menor preço, faixa, usado à parte, aviso de golpe, como criar o alerta) e o cartão; sem o produto exato, a pesquisa responde',
    tipo: 'unidade',
    async executar() {
      const { baixar } = lojas();
      const r = await chat.responderCompras({ pergunta: 'quanto está a rtx 5080?', deps: { baixar }, config: {} });
      const bloco = JSON.parse(/```compras\n([\s\S]*?)```/.exec(r.texto)[1]);
      const nada = await chat.responderCompras({ pergunta: 'quanto está a rtx 9999?', deps: { baixar: async () => ({ ok: true, status: 200, texto: next({ props: { initialReduxState: { hits: { hits: [] } } } }) }) }, config: {} });
      return [
        /^\*\*RTX 5080\*\*: o menor preço agora é \*\*R\$ 11\.799,00\*\* na \*\*Magazine Luiza\*\*/.test(r.texto) || r.texto.slice(0, 160),
        /Usado: a partir de R\$ 9\.500,00 \(Trocafy\)/.test(r.texto) || 'usado à parte',
        /⚠ 1 oferta muito abaixo das outras — pode ser golpe/.test(r.texto) || 'aviso de golpe',
        /me avise quando rtx 5080 ficar abaixo de R\$ 10\.600/.test(r.texto) || 'sugestão de alerta',
        bloco.produto === 'RTX 5080' && bloco.ofertas.length >= 8 && bloco.ofertas.some((o) => o.suspeito) && bloco.fontes.length === 4 || JSON.stringify(bloco).slice(0, 200),
        nada === null || 'sem o produto: a pesquisa',
      ];
    },
  },
  {
    nome: 'preços: alerta pela Agenda — "me avise quando a RTX 5080 ficar abaixo de R$ 10.000" (e "4 mil", "9k", "3.500"), conferido a cada 6 h sem modelo',
    tipo: 'unidade',
    executar() {
      const p = (q) => JSON.stringify(agendaNoChat.pedidoDeAgenda(q));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-alerta-'));
      const ag = new Agenda(dir);
      const item = ag.adicionar({ tipo: 'acompanhar', titulo: 'RTX 5080 abaixo de R$ 10.000', assunto: 'RTX 5080', limite: 10000 });
      ag.atualizar(item.id, { acompanhar: { ultimaVerificacao: Date.now() } });
      const resultado = [
        p('me avise quando a RTX 5080 ficar abaixo de R$ 10.000') === JSON.stringify({ acao: 'acompanhar', assunto: 'RTX 5080', limite: 10000 }) || p('me avise quando a RTX 5080 ficar abaixo de R$ 10.000'),
        /"limite":4000/.test(p('me avise quando o iphone 16 ficar abaixo de 4 mil')) && /"limite":9000/.test(p('let me know when the rtx 5080 drops below 9k')) && /"limite":3500/.test(p('me avisa quando o ps5 slim baixar para 3.500')) || 'valores',
        p('me avise quando a RTX 60 for lançada') === JSON.stringify({ acao: 'acompanhar', assunto: 'RTX 60' }) || 'lançamento continua sem limite',
        item.acompanhar.limite === 10000 || 'o limite fica no item',
        ag.paraConferir(Date.now() + 5 * 3600000).length === 0 && ag.paraConferir(Date.now() + 6.5 * 3600000).length === 1 || 'a cada 6 h',
      ];
      fs.rmSync(dir, { recursive: true, force: true });
      return resultado;
    },
  },
];
