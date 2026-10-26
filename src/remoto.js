'use strict';

/**
 * Acesso pelo celular (26/10, pedido do Davi, fase 1): o AuGPT abre uma página na rede da casa e o celular
 * usa pelo navegador. É o MESMO AuGPT — o pedido do celular vai para a tela do PC, que roda como se você
 * tivesse digitado lá (mesmas conversas, cartões, aprovações); os eventos do agente voltam para o celular.
 *
 * Segurança:
 * - desligado por padrão; só responde a endereços da rede local (10.x, 192.168.x, 172.16–31.x, link-local);
 * - código secreto (no QR code): na 1ª visita vira um cookie HttpOnly/SameSite=Lax e sai da URL (Strict não: o celular abre o link vindo da câmera, e aí o Chrome não manda o cookie no redirecionamento);
 *   sem ele, nada além de uma página "escaneie o QR code"; 20 tentativas erradas bloqueiam o IP por 10 min;
 * - POST só com o cabeçalho X-AuGPT (outro site não consegue mandar sem CORS, que não existe aqui);
 * - arquivos só de uma lista fechada; CSP só com a própria página; corpo até 64 KB.
 */

const { pedidoDeFundo } = require('./segundo-plano');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORTA_PADRAO = 8731;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
// os arquivos da tela que o celular pode pedir (nada fora daqui)
const ARQUIVOS = new Set([
  'movel.html', 'movel.js', 'movel.css', 'movel.webmanifest',
  'styles.css', 'tema.css', 'tema.js', 'i18n.js', 'md.js', 'grafico.js', 'calendario.js', 'clima.js', 'mapa.js', 'compras.js', 'icone.png',
  'vendor/maplibre-gl-5.24.0/maplibre-gl.css', 'vendor/maplibre-gl-5.24.0/maplibre-gl-csp.js', 'vendor/maplibre-gl-5.24.0/maplibre-gl-csp-worker.js',
]);
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'";
// os eventos do agente que interessam ao celular
const EVENTOS_DO_CELULAR = new Set(['inicio', 'ferramenta', 'fonte', 'redigindo', 'resposta-token', 'resposta-reinicia', 'concluido', 'erro', 'interrompido', 'limite', 'limite-atingido', 'aprovacao', 'aprovacao-resolvida', 'pergunta', 'nucleo-entendimento', 'conversa-salva', 'remoto-respondeu', 'fundo-mudou', 'fundo-aviso']);

/** O endereço é da rede local (ou deste PC)? */
function ehRedeLocal(endereco) {
  const ip = String(endereco || '').replace(/^::ffff:/, '');
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip) || ip === '::1' || /^(fc|fd|fe80)/i.test(ip);
}

/** Os IPv4 da rede da casa deste PC (sem loopback e sem VPN/virtuais conhecidas). */
function ipsDaRede(interfaces = os.networkInterfaces()) {
  const ips = [];
  for (const [nome, lista] of Object.entries(interfaces)) {
    if (/vpn|virtual|vmware|vbox|hyper-v|wsl|loopback|radmin|hamachi|zerotier|tailscale/i.test(nome)) continue;
    for (const i of lista || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) ips.push(i.address);
    }
  }
  return ips;
}

const novoCodigo = () => crypto.randomBytes(24).toString('base64url');
const iguais = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const lerCookie = (cabecalho, nome) => (String(cabecalho || '').split(/;\s*/).find((c) => c.startsWith(`${nome}=`)) || '').slice(nome.length + 1);

class AcessoRemoto {
  /**
   * `dirTela`: a pasta renderer/; `dirImagens`: as fotos das respostas; `codigo`: o segredo do QR.
   * Do app: `pedir({ texto, idConversa })`, `responder(id, valor)`, `parar()`, `estado()`,
   * `listarConversas()`, `lerConversa(id)`, `servirMapa(url)` e `servirCaixa(url)` (Response).
   */
  constructor(opcoes = {}) {
    this.o = { porta: PORTA_PADRAO, ...opcoes };
    this.servidor = null;
    this.ouvintes = new Set();
    this.erros = new Map(); // ip → { n, ate }
  }

  ligado() {
    return Boolean(this.servidor?.listening);
  }

  enderecos() {
    return ipsDaRede().map((ip) => `http://${ip}:${this.o.porta}/?c=${encodeURIComponent(this.o.codigo)}`);
  }

  ligar() {
    if (this.servidor) return Promise.resolve(true);
    return new Promise((ok, falha) => {
      const s = http.createServer((req, res) => this.atender(req, res).catch(() => this.texto(res, 500, 'erro')));
      s.on('error', (err) => {
        this.servidor = null;
        falha(err);
      });
      s.listen(this.o.porta, '0.0.0.0', () => ok(true));
      this.servidor = s;
    });
  }

  desligar() {
    for (const r of this.ouvintes) r.end();
    this.ouvintes.clear();
    const s = this.servidor;
    this.servidor = null;
    return new Promise((ok) => (s ? s.close(() => ok()) : ok()));
  }

  /** Código novo: o antigo para de valer e quem estava conectado sai. */
  trocarCodigo(codigo = novoCodigo()) {
    this.o.codigo = codigo;
    for (const r of this.ouvintes) r.end();
    this.ouvintes.clear();
    return codigo;
  }

  /** Um evento do agente para todo celular conectado. */
  transmitir(canal, dados) {
    if (!EVENTOS_DO_CELULAR.has(canal) || !this.ouvintes.size) return;
    const linha = `data: ${JSON.stringify({ canal, dados })}\n\n`;
    for (const r of this.ouvintes) r.write(linha);
  }

  /* ------------------------------------------------------------------ */

  cabecalhos(extra = {}) {
    return { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', ...extra };
  }

  texto(res, status, corpo, tipo = 'text/plain; charset=utf-8') {
    if (res.headersSent) return res.end();
    res.writeHead(status, this.cabecalhos({ 'Content-Type': tipo }));
    res.end(corpo);
  }

  json(res, status, obj) {
    this.texto(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
  }

  async lerCorpo(req) {
    let tamanho = 0;
    const partes = [];
    for await (const p of req) {
      tamanho += p.length;
      if (tamanho > 64 * 1024) throw Object.assign(new Error('grande demais'), { status: 413 });
      partes.push(p);
    }
    try {
      return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('JSON inválido'), { status: 400 });
    }
  }

  async enviarResposta(res, resposta) {
    const cab = {};
    resposta.headers.forEach((v, k) => (cab[k] = v));
    res.writeHead(resposta.status, this.cabecalhos(cab));
    res.end(Buffer.from(await resposta.arrayBuffer()));
  }

  async atender(req, res) {
    const ip = req.socket.remoteAddress;
    if (!ehRedeLocal(ip)) return this.texto(res, 403, 'só na rede local');
    const bloqueio = this.erros.get(ip);
    if (bloqueio && bloqueio.ate > Date.now()) return this.texto(res, 429, 'muitas tentativas — espere alguns minutos');
    const url = new URL(req.url, 'http://augpt.local');

    // 1ª visita pelo QR: o código vira cookie e sai da URL
    const doQr = url.searchParams.get('c');
    if (doQr !== null) {
      if (!iguais(doQr, this.o.codigo)) return this.recusar(res, ip);
      res.writeHead(302, this.cabecalhos({ Location: '/', 'Set-Cookie': `augpt=${this.o.codigo}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` }));
      return res.end();
    }
    if (!iguais(lerCookie(req.headers.cookie, 'augpt'), this.o.codigo)) return this.recusar(res, ip);
    this.erros.delete(ip);

    const rota = url.pathname;
    if (req.method === 'POST') {
      if (req.headers['x-augpt'] !== '1') return this.texto(res, 403, 'sem o cabeçalho do AuGPT');
      let corpo;
      try {
        corpo = await this.lerCorpo(req);
      } catch (err) {
        return this.texto(res, err.status || 400, err.message);
      }
      if (rota === '/api/enviar') {
        const texto = String(corpo.texto || '').trim().slice(0, 8000);
        if (!texto) return this.json(res, 400, { ok: false, erro: 'pedido vazio' });
        // "em segundo plano: …" vai para a fila, mesmo com o AuGPT respondendo outra coisa
        const deFundo = this.o.fundo && pedidoDeFundo(texto);
        if (deFundo) return this.json(res, 200, { ok: true, fundo: this.o.fundo.adicionar(deFundo) });
        if (this.o.estado().rodando) return this.json(res, 409, { ok: false, erro: 'O AuGPT ainda está respondendo — espere terminar.' });
        const r = await this.o.pedir({ texto, idConversa: typeof corpo.idConversa === 'string' ? corpo.idConversa.slice(0, 80) : null });
        return this.json(res, r?.ok === false ? 503 : 200, r || { ok: true });
      }
      if (rota === '/api/responder') {
        const valor = String(corpo.valor || '').slice(0, 2000);
        // "Sempre permitir" fica só no PC
        if (!corpo.id || !valor || valor === 'sempre') return this.json(res, 400, { ok: false });
        return this.json(res, 200, { ok: Boolean(await this.o.responder(String(corpo.id), valor)) });
      }
      if (rota === '/api/fundo/responder' && this.o.fundo) {
        if (!['aprovar', 'negar'].includes(corpo.valor)) return this.json(res, 400, { ok: false });
        return this.json(res, 200, { ok: this.o.fundo.responder(String(corpo.id || ''), corpo.valor) });
      }
      if (rota === '/api/fundo/remover' && this.o.fundo) return this.json(res, 200, { ok: this.o.fundo.remover(String(corpo.id || '')) });
      if (rota === '/api/parar') {
        await this.o.parar();
        return this.json(res, 200, { ok: true });
      }
      return this.texto(res, 404, 'não existe');
    }
    if (req.method !== 'GET') return this.texto(res, 405, 'método');

    if (rota === '/api/eventos') {
      res.writeHead(200, this.cabecalhos({ 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' }));
      res.write(': conectado\n\n');
      this.ouvintes.add(res);
      const vivo = setInterval(() => res.write(': vivo\n\n'), 20000);
      req.on('close', () => {
        clearInterval(vivo);
        this.ouvintes.delete(res);
      });
      return undefined;
    }
    if (rota === '/api/estado') return this.json(res, 200, this.o.estado());
    if (rota === '/api/fundo') return this.json(res, 200, this.o.fundo ? this.o.fundo.listar() : []);
    if (rota === '/api/conversas') {
      const lista = (await this.o.listarConversas()) || [];
      return this.json(res, 200, lista.filter((c) => c.modo !== "conversa").slice(0, 60).map(({ id, titulo, atualizadoEm, criadoEm }) => ({ id, titulo, em: atualizadoEm || criadoEm || null })));
    }
    if (rota === '/api/conversa') {
      const c = await this.o.lerConversa(String(url.searchParams.get('id') || '').slice(0, 80));
      if (!c) return this.json(res, 404, { ok: false });
      return this.json(res, 200, { id: c.id, titulo: c.titulo, mensagens: (c.mensagens || []).map(({ role, content }) => ({ role, content })) });
    }
    let m = /^\/img\/([a-z]{20,64}\.(?:jpg|png|webp))$/.exec(rota);
    if (m) {
      const arquivo = path.join(this.o.dirImagens, m[1]);
      if (!fs.existsSync(arquivo)) return this.texto(res, 404, 'sem a foto');
      res.writeHead(200, this.cabecalhos({ 'Content-Type': `image/${m[1].endsWith('.png') ? 'png' : m[1].endsWith('.webp') ? 'webp' : 'jpeg'}`, 'Cache-Control': 'private, max-age=86400' }));
      return fs.createReadStream(arquivo).pipe(res);
    }
    m = /^\/mapa\/(osm|sat)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/.exec(rota);
    if (m) return this.enviarResposta(res, await this.o.servirMapa(`augpt-mapa://${m[1]}/${m[2]}/${m[3]}/${m[4]}`));
    m = /^\/caixa\/(v\/[A-Za-z0-9_-]{1,200000})$/.exec(rota);
    if (m) return this.enviarResposta(res, await this.o.servirCaixa(`augpt-caixa://${m[1]}`));

    // os arquivos da tela (lista fechada)
    const rel = rota === '/' ? 'movel.html' : rota.slice(1);
    if (!ARQUIVOS.has(rel)) return this.texto(res, 404, 'não existe');
    const tipo = TIPOS[path.extname(rel)] || 'application/octet-stream';
    const extra = rel === 'movel.html' ? { 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' } : {};
    res.writeHead(200, this.cabecalhos({ 'Content-Type': tipo, ...extra }));
    return fs.createReadStream(path.join(this.o.dirTela, rel)).pipe(res);
  }

  /** Sem o código: só a página que manda escanear o QR (e conta a tentativa errada). */
  recusar(res, ip) {
    const e = this.erros.get(ip) || { n: 0, ate: 0 };
    e.n += 1;
    if (e.n >= 20) {
      e.ate = Date.now() + 10 * 60000;
      e.n = 0;
    }
    this.erros.set(ip, e);
    return this.texto(
      res,
      401,
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AuGPT</title><body style="font:16px system-ui;background:#111;color:#eee;padding:32px;text-align:center"><h2>AuGPT</h2><p>Para entrar, abra o AuGPT no computador, vá em <b>Ajustes → Geral → Acesso pelo celular</b> e escaneie o QR code com a câmera do celular.</p></body>',
      'text/html; charset=utf-8'
    );
  }
}

module.exports = { AcessoRemoto, ehRedeLocal, ipsDaRede, novoCodigo, PORTA_PADRAO, ARQUIVOS, EVENTOS_DO_CELULAR };
