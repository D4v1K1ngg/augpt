'use strict';

/**
 * Caixa isolada para HTML/CSS/JS escrito pelo modelo (18/10, item 4): o bloco
 * ```visual da resposta vira um iframe. O conteúdo vem deste processo pelo
 * protocolo augpt-caixa:// com uma CSP só dele — script e estilo embutidos
 * rodam; rede, formulário, pop-up e navegação não. O iframe tem sandbox sem
 * allow-same-origin (origem opaca): não alcança a janela do app nem o `api`.
 * Por que não srcdoc ou data:: herdam a CSP do chat (script-src 'self') e o
 * script do modelo não rodaria (testado 18/10).
 */

const ESQUEMA = 'augpt-caixa';
const LIMITE = 1500000; // 1,5 MB de HTML

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
].join('; ');

// a caixa diz a altura do conteúdo para o chat (postMessage atravessa a origem opaca)
const AVISO_DE_ALTURA = `<script>(function(){var u=0;function a(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==u){u=h;parent.postMessage({augptCaixa:h},'*');}}addEventListener('load',a);if(window.ResizeObserver)new ResizeObserver(a).observe(document.documentElement);setTimeout(a,300);})();</script>`;

const BASE = `<style>html{color-scheme:dark light}body{margin:0;padding:12px;font:14px system-ui,sans-serif;background:#131316;color:#ddd}</style>`;

/** O HTML do modelo, pronto para servir: com a CSP e o aviso de altura. */
function paginaDaCaixa(html) {
  const corpo = String(html || '').slice(0, LIMITE);
  const meta = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const comCabeca = /<head[^>]*>/i.test(corpo)
    ? corpo.replace(/<head[^>]*>/i, (m) => `${m}${meta}${BASE}`)
    : `${meta}${BASE}${corpo}`;
  const comAltura = /<\/body>/i.test(comCabeca) ? comCabeca.replace(/<\/body>/i, `${AVISO_DE_ALTURA}</body>`) : `${comCabeca}${AVISO_DE_ALTURA}`;
  return /^\s*<!doctype/i.test(comAltura) ? comAltura : `<!doctype html>${comAltura}`;
}

/** augpt-caixa://v/<base64url> → o HTML (o conteúdo viaja na URL; nada fica guardado). */
function htmlDaUrl(url) {
  const u = new URL(url);
  const b64 = u.pathname.replace(/^\//, '').replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length > LIMITE * 1.4) throw new Error('conteúdo grande demais');
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** A resposta do protocolo, para o protocol.handle do Electron. */
function responderCaixa(url) {
  try {
    return new Response(paginaDaCaixa(htmlDaUrl(url)), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response('', { status: 400 });
  }
}

module.exports = { ESQUEMA, CSP, paginaDaCaixa, htmlDaUrl, responderCaixa };
