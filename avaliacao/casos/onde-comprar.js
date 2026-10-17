'use strict';

/**
 * Lojas (17/10): ofertas lidas dos dados que a própria loja publica (JSON-LD e
 * __NEXT_DATA__) e o "Onde comprar" dos cartões. Páginas e leitor são dublês.
 */

const { ofertasDoHtml } = require('../../src/tools/ofertas');
const { extrairDoHtml } = require('../../src/tools/extract');
const { chaveDaPagina } = require('../../src/tools/web');
const { ondeComprar, linhaOndeComprar, casa } = require('../../src/agent/onde-comprar');

const kabum = `<html><body><div>Mouse</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { data: { catalogServer: { data: [
    { code: 123, name: 'Mouse Gamer Logitech G Pro X Superlight 2, Sem Fio, Preto', friendlyName: 'mouse-logitech-superlight-2', price: 1049.08, priceWithDiscount: 899.9 },
    { code: 124, name: 'Mouse Gamer Logitech G Pro X Superlight 2c, Sem Fio', friendlyName: 'mouse-superlight-2c', price: 771.47 },
    { code: 125, name: 'Grip Antiderrapante para Mouse Logitech G Pro X Superlight 2', friendlyName: 'grip', price: 39.9 },
  ] } } } },
})}</script></body></html>`;

const zoomLd = `<html><body><script type="application/ld+json">${JSON.stringify({
  '@type': 'ItemList',
  itemListElement: [{ '@type': 'Product', name: 'Headset Gamer HyperX Cloud III', offers: { price: '499.90', priceCurrency: 'BRL', url: '/headset-hyperx-cloud-iii' } }],
})}</script></body></html>`;

module.exports = [
  {
    nome: 'ofertas: lidas do __NEXT_DATA__ (KaBuM, com link montado e preço à vista) e do JSON-LD (comparador); a página de busca vira lista de ofertas para o modelo',
    tipo: 'unidade',
    async executar() {
      const r = [];
      const k = ofertasDoHtml(kabum, 'https://www.kabum.com.br/busca/x');
      r.push(k.length === 3 || `KaBuM: ${k.length} ofertas`);
      r.push((k[0].url === 'https://www.kabum.com.br/produto/123/mouse-logitech-superlight-2' && k[0].avista === 899.9) || `KaBuM 1ª: ${JSON.stringify(k[0])}`);
      const z = ofertasDoHtml(zoomLd, 'https://www.zoom.com.br/search?q=x');
      r.push((z.length === 1 && z[0].preco === 499.9 && z[0].url === 'https://www.zoom.com.br/headset-hyperx-cloud-iii') || `JSON-LD: ${JSON.stringify(z)}`);
      const pagina = extrairDoHtml(kabum, 'https://www.kabum.com.br/busca/x');
      r.push((pagina.via === 'ofertas' && pagina.ofertas.length === 3 && /R\$ 1\.049,08/.test(pagina.texto)) || `extração: ${pagina.via}`);
      return r;
    },
  },
  {
    nome: 'onde comprar: só a oferta do produto (o "Superlight 2" não pega o "2c", acessório e peça de reposição ficam de fora, "K552" casa com "K-552"); Zoom e Buscapé repetidos viram um; a linha sai com preço e link',
    tipo: 'unidade',
    async executar() {
      const r = [];
      r.push(casa('Mouse Logitech G Pro X Superlight 2, Preto', 'Logitech G Pro X Superlight 2') || 'casa o produto');
      r.push(!casa('Mouse Logitech G Pro X Superlight 2c', 'Logitech G Pro X Superlight 2') || 'não pega o 2c');
      r.push(!casa('Grip Antiderrapante para Mouse Logitech G Pro X Superlight 2', 'Logitech G Pro X Superlight 2') || 'acessório');
      r.push(!casa('Fone de ouvido de substituição para HyperX Cloud III', 'HyperX Cloud III') || 'reposição');
      r.push(!casa('Película de Reposição HyperX Cloud III', 'HyperX Cloud III') || 'acento no acessório');
      r.push(casa('Teclado Redragon Kumara K-552 RGB', 'Redragon Kumara K552') || 'K552 colado');
      r.push(casa('Grip para mouse X', 'grip para mouse X') || 'pedido que é acessório');

      const paginas = {
        'https://www.kabum.com.br/busca/logitech-g-pro-x-superlight-2': { ofertas: ofertasDoHtml(kabum, 'https://www.kabum.com.br/') },
        zoom: { ofertas: [{ nome: 'Mouse Logitech G Pro X Superlight 2', preco: 669.9, lojas: 6, url: 'https://www.zoom.com.br/m' }] },
        buscape: { ofertas: [{ nome: 'Mouse Logitech G Pro X Superlight 2', preco: 669.9, lojas: 6, url: 'https://www.buscape.com.br/m' }] },
      };
      const ler = async (url) => paginas[url] || (/zoom/.test(url) ? paginas.zoom : /buscape/.test(url) ? paginas.buscape : null);
      const achados = await ondeComprar('Logitech G Pro X Superlight 2', { ler });
      r.push((achados.length === 2 && achados.find((a) => a.loja === 'KaBuM!')?.preco === 1049.08) || `achados: ${JSON.stringify(achados)}`);
      const linha = linhaOndeComprar(achados, '17/10/2026');
      r.push(linha === '**Onde comprar (preços de 17/10/2026):** [Zoom: a partir de R$ 669,90 em 6 lojas](https://www.zoom.com.br/m) · [KaBuM! R$ 1.049,08 (à vista R$ 899,90)](https://www.kabum.com.br/produto/123/mouse-logitech-superlight-2)' || `linha: ${linha}`);
      r.push(linhaOndeComprar([]) === '' || 'sem achados, sem linha');
      // loja que trava não segura o resto
      const lento = await ondeComprar('Logitech G Pro X Superlight 2', { ler: (url) => (/kabum/.test(url) ? new Promise(() => {}) : ler(url)), timeoutMs: 50 });
      r.push(lento.length === 1 || `loja lenta: ${lento.length}`);
      return r;
    },
  },
  {
    nome: 'cache de página: a busca da loja guarda a pergunta (?q=) e ignora rastreio (utm, gclid) e âncora',
    tipo: 'unidade',
    executar() {
      return [
        chaveDaPagina('https://www.zoom.com.br/search?q=mouse') !== chaveDaPagina('https://www.zoom.com.br/search?q=fone') || 'buscas diferentes',
        chaveDaPagina('https://x.com/p?q=a&utm_source=b&gclid=c#topo') === chaveDaPagina('https://x.com/p?q=a') || 'rastreio fora',
        chaveDaPagina('https://x.com/p?b=1&a=2') === chaveDaPagina('https://x.com/p?a=2&b=1') || 'ordem dos parâmetros',
      ];
    },
  },
];
