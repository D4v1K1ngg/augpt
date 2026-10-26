'use strict';

/**
 * Acesso pelo celular (26/10, fase 1): o servidor (src/remoto.js) num porto de verdade, com o app de mentira.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { AcessoRemoto, ehRedeLocal, ARQUIVOS } = require('../../src/remoto');

const raiz = path.join(__dirname, '../..');
function pedir(porta, rota, { metodo = 'GET', cookie = '', corpo = null, cabecalhos = {} } = {}) {
  return new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: metodo, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos } }, (res) => {
      let texto = '';
      res.on('data', (d) => (texto += d));
      res.on('end', () => ok({ status: res.statusCode, cab: res.headers, texto }));
    });
    req.on('error', falha);
    if (corpo) req.write(JSON.stringify(corpo));
    req.end();
  });
}
const portaLivre = () => new Promise((ok) => {
  const s = http.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});

module.exports = [
  {
    nome: 'celular: rede local só (10.x, 192.168.x, 172.16–31.x, link-local, o próprio PC); IP da internet não',
    tipo: 'unidade',
    executar() {
      return [
        ['192.168.0.10', '10.1.2.3', '172.20.0.5', '127.0.0.1', '::1', '::ffff:192.168.1.7', '169.254.3.4', 'fe80::1', 'fd00::5'].every(ehRedeLocal) || 'locais',
        !['8.8.8.8', '172.32.0.1', '100.64.0.1', '::ffff:200.1.2.3', '2804:14c::1'].some(ehRedeLocal) || 'internet',
        [...ARQUIVOS].every((a) => fs.existsSync(path.join(raiz, 'renderer', a))) || `arquivo da lista não existe: ${[...ARQUIVOS].filter((a) => !fs.existsSync(path.join(raiz, 'renderer', a)))}`,
      ];
    },
  },
  {
    nome: 'celular: sem o código não entra; o código do QR vira cookie e sai da URL; POST só com o cabeçalho do AuGPT; um pedido por vez; arquivo fora da lista e "../" não; eventos chegam; código novo derruba; 20 erros bloqueiam',
    tipo: 'unidade',
    async executar() {
      const porta = await portaLivre();
      const pedidos = [];
      let rodando = false;
      const r = new AcessoRemoto({
        porta,
        codigo: 'codigo-secreto-de-teste-123',
        dirTela: path.join(raiz, 'renderer'),
        dirImagens: path.join(raiz, 'avaliacao'),
        estado: () => ({ rodando, idConversa: null, versao: 'teste' }),
        pedir: (p) => (pedidos.push(p), { ok: true }),
        responder: (id, valor) => id === 'a1' && valor === 'aprovar',
        parar: () => {},
        listarConversas: () => [{ id: 'c1', modo: 'agente', titulo: 'Clima', atualizadoEm: '2026-10-26T10:00:00Z' }, { id: 'c2', modo: 'conversa', titulo: 'Só chat' }],
        lerConversa: (id) => (id === 'c1' ? { id: 'c1', titulo: 'Clima', mensagens: [{ role: 'user', content: 'oi', extra: 'x' }] } : null),
        servirMapa: async () => new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } }),
        servirCaixa: async () => new Response('<p>ok</p>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      });
      await r.ligar();
      const res = [];
      try {
        const semCodigo = await pedir(porta, '/');
        res.push(semCodigo.status === 401 && /escaneie o QR code/.test(semCodigo.texto) || `sem código: ${semCodigo.status}`);
        res.push((await pedir(porta, '/?c=errado')).status === 401 || 'código errado');
        const qr = await pedir(porta, '/?c=codigo-secreto-de-teste-123');
        const cookie = String(qr.cab['set-cookie'] || '').split(';')[0];
        res.push(qr.status === 302 && qr.cab.location === '/' && /HttpOnly/.test(qr.cab['set-cookie']) && /SameSite=Strict/.test(qr.cab['set-cookie']) || `QR: ${qr.status} ${qr.cab['set-cookie']}`);
        const pagina = await pedir(porta, '/', { cookie });
        res.push(pagina.status === 200 && /movel\.js/.test(pagina.texto) && /script-src 'self'/.test(pagina.cab['content-security-policy']) || `página: ${pagina.status}`);
        res.push((await pedir(porta, '/package.json', { cookie })).status === 404 && (await pedir(porta, '/../package.json', { cookie })).status === 404 && (await pedir(porta, '/app.js', { cookie })).status === 404 || 'fora da lista');
        const conversas = JSON.parse((await pedir(porta, '/api/conversas', { cookie })).texto);
        res.push(conversas.length === 1 && conversas[0].id === 'c1' && conversas[0].em === '2026-10-26T10:00:00Z' || JSON.stringify(conversas));
        res.push(!/extra/.test((await pedir(porta, '/api/conversa?id=c1', { cookie })).texto) || 'conversa só com papel e texto');
        res.push((await pedir(porta, '/api/enviar', { metodo: 'POST', cookie, corpo: { texto: 'oi' } })).status === 403 && pedidos.length === 0 || 'POST sem o cabeçalho');
        const ok = await pedir(porta, '/api/enviar', { metodo: 'POST', cookie, corpo: { texto: 'vai chover?', idConversa: 'c1' }, cabecalhos: { 'X-AuGPT': '1' } });
        res.push(ok.status === 200 && pedidos[0]?.texto === 'vai chover?' && pedidos[0]?.idConversa === 'c1' || `enviar: ${ok.status}`);
        rodando = true;
        res.push((await pedir(porta, '/api/enviar', { metodo: 'POST', cookie, corpo: { texto: 'outro' }, cabecalhos: { 'X-AuGPT': '1' } })).status === 409 && pedidos.length === 1 || 'um por vez');
        rodando = false;
        res.push((await pedir(porta, '/api/responder', { metodo: 'POST', cookie, corpo: { id: 'a1', valor: 'sempre' }, cabecalhos: { 'X-AuGPT': '1' } })).status === 400 || '"Sempre permitir" só no PC');
        res.push(JSON.parse((await pedir(porta, '/api/responder', { metodo: 'POST', cookie, corpo: { id: 'a1', valor: 'aprovar' }, cabecalhos: { 'X-AuGPT': '1' } })).texto).ok === true || 'aprovar');
        res.push((await pedir(porta, '/mapa/osm/5/10/12', { cookie })).status === 200 && (await pedir(porta, '/mapa/xyz/5/10/12', { cookie })).status === 404 || 'mapa');
        res.push((await pedir(porta, '/img/naoexiste.jpg', { cookie })).status === 404 || 'foto');
        // eventos: o que interessa chega; o resto não
        const chegou = await new Promise((fim) => {
          const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/eventos', headers: { Cookie: cookie } }, (resposta) => {
            let texto = '';
            resposta.on('data', (d) => {
              texto += d;
              if (/resposta-token/.test(texto)) {
                req.destroy();
                fim(texto);
              }
            });
          });
          req.end();
          setTimeout(() => {
            r.transmitir('uso-chamada', { segredo: 1 });
            r.transmitir('resposta-token', { pedaco: 'Olá' });
          }, 150);
          setTimeout(() => fim('nada'), 3000);
        });
        res.push(/"pedaco":"Olá"/.test(chegou) && !/uso-chamada/.test(chegou) || `eventos: ${chegou.slice(0, 120)}`);
        // código novo: o cookie antigo para de valer
        r.trocarCodigo('outro-codigo-novo-456');
        res.push((await pedir(porta, '/api/estado', { cookie })).status === 401 || 'código novo derruba');
        // 20 tentativas erradas: bloqueio
        for (let i = 0; i < 20; i += 1) await pedir(porta, '/?c=chute');
        res.push((await pedir(porta, '/?c=outro-codigo-novo-456')).status === 429 || 'bloqueio por tentativas');
      } finally {
        await r.desligar();
      }
      return res;
    },
  },
  {
    nome: 'celular no app: desligado por padrão; o código só muda pelo botão (não por config:set); o pedido vai para a tela do PC; os eventos e a conversa salva chegam ao celular; o mapa usa a base da página',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(raiz, 'electron/main.js'), 'utf8');
      const cfg = fs.readFileSync(path.join(raiz, 'src/config.js'), 'utf8');
      const mapa = fs.readFileSync(path.join(raiz, 'renderer/mapa.js'), 'utf8');
      const celular = fs.readFileSync(path.join(raiz, 'renderer/celular.js'), 'utf8');
      return [
        /acessoCelular: false/.test(cfg) || 'desligado por padrão',
        /delete seguro\.acessoCelularCodigo/.test(main) || 'código protegido',
        /remoto\?\.transmitir\(canal, dados\)/.test(main) && /transmitir\('conversa-salva'/.test(main) || 'eventos e conversa salva',
        /enviar\('remoto-pedido', \{ texto, idConversa \}\)/.test(main) && /manipuladores\['remoto-pedido'\]/.test(celular) || 'o pedido passa pela tela do PC',
        /global\.AUGPT_MAPA \|\| 'augpt-mapa:\/\/'/.test(mapa) || 'base do mapa',
        /remoto\?\.desligar\(\)/.test(main) || 'desliga ao fechar',
      ];
    },
  },
];
