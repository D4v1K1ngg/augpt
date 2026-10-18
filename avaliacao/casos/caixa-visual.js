'use strict';

/**
 * Caixa isolada para HTML/CSS/JS do modelo (18/10, item 4). O iframe e o
 * protocolo foram testados no Electron à parte (o script roda; ler o app,
 * chamar o api, navegar a janela e acessar a rede são bloqueados). Aqui: o
 * conteúdo servido, o markdown e o núcleo.
 */

const caixa = require('../../src/caixa');
const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'caixa: a página servida leva a CSP sem rede (no cabeçalho e no <head>) e o aviso de altura; o HTML viaja na URL em base64url, com acento; conteúdo inválido dá 400',
    tipo: 'unidade',
    async executar() {
      const html = '<!doctype html><html><head><title>t</title></head><body><p>Olá, ação!</p><script>1</script></body></html>';
      const url = `augpt-caixa://v/${Buffer.from(html, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      const r = caixa.responderCaixa(url);
      const corpo = await r.text();
      const pedaco = caixa.paginaDaCaixa('<p>sem head</p>');
      return [
        caixa.htmlDaUrl(url) === html || 'ida e volta da URL',
        r.headers.get('content-security-policy') === caixa.CSP && /connect-src 'none'/.test(caixa.CSP) && /default-src 'none'/.test(caixa.CSP) && !/unsafe-eval/.test(caixa.CSP) || r.headers.get('content-security-policy'),
        /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/.test(corpo) && /augptCaixa/.test(corpo) && /Olá, ação!/.test(corpo) || corpo.slice(0, 300),
        /^<!doctype html><meta charset="utf-8">/.test(pedaco) && /<p>sem head<\/p><script>/.test(pedaco) || pedaco.slice(0, 200),
        caixa.responderCaixa('augpt-caixa://v/%%%').status === 400 || caixa.responderCaixa('augpt-caixa://v/!!').status === 200 || 'inválido',
      ];
    },
  },
  {
    nome: 'caixa: no chat, ```visual vira o lugar da caixa (o HTML não entra na página do app); ```html continua sendo código para ler',
    tipo: 'unidade',
    executar() {
      const antes = global.window;
      global.window = {};
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.window.md.render('Veja:\n\n```visual\n<script>alert(1)</script><p>oi</p>\n```\n\nE:\n\n```html\n<b>x</b>\n```');
      global.window = antes;
      return [
        /<div class="caixa-lugar" data-caixa="0"><\/div>/.test(html) || html,
        !/<script>alert/.test(html) && !/<p>oi<\/p>/.test(html) || 'HTML do modelo dentro da página do app',
        /<pre class="bloco-codigo" data-lang="html"><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/.test(html) || 'html comum é código',
      ];
    },
  },
  {
    nome: 'caixa: no núcleo, pedido de criar algo interativo leva o lembrete do bloco ```visual; página completa em ```html vira ```visual; código das respostas sai intacto das conferências (ano e "[0]")',
    tipo: 'unidade',
    async executar() {
      const pagina = '```html\n<!doctype html><body><button>ok</button><script>let a=[1,2];a[0]=2019;</script></body>\n```\n\nPronto.';
      const escritas = [];
      const r = await nucleo.responder({
        pergunta: 'crie uma calculadora de IMC interativa',
        modo: 'rapido',
        hoje: '18/10/2026',
        deps: {
          chamar: async (m, o = {}) => (o.json ? { content: '{"precisa_buscar": true}' } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
          escrever: async (messages, onToken) => (escritas.push(messages), onToken(pagina), pagina),
          buscar: async () => [{ titulo: 'IMC', url: 'https://saude.exemplo/imc', resumo: 'IMC é o peso dividido pela altura ao quadrado.' }],
          lerPagina: async () => ({ texto: 'IMC é o peso dividido pela altura ao quadrado.', titulo: 'IMC' }),
          emit: () => {},
        },
      });
      return [
        /bloco que começa com ```visual/.test(escritas[0].at(-1).content) || 'lembrete na pergunta',
        /```visual\n<!doctype html><body><button>ok<\/button><script>let a=\[1,2\];a\[0\]=2019;<\/script><\/body>\n```/.test(r.texto) || r.texto,
        nucleo.pedeVisual('faça uma animação de um sistema solar') && nucleo.pedeVisual('monte um painel interativo') && !nucleo.pedeVisual('o que é IMC?') && !nucleo.pedeVisual('crie uma imagem de um gato') || 'pedido de visual',
        nucleo.comoVisual('```html\n<b>só um trecho</b>\n```') === '```html\n<b>só um trecho</b>\n```' || 'trecho de HTML continua código',
      ];
    },
  },
];
