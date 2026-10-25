'use strict';

/**
 * Endurecimento das sessões web do Electron — Fase 1 de segurança
 * (2026-09-23), antes da primeira publicação no GitHub.
 *
 * Duas lacunas fechadas aqui, nas janelas que carregam páginas de terceiros
 * (o navegador do agente e a renderização em segundo plano):
 *
 * 1. Permissões. O Electron CONCEDE por padrão todo pedido de permissão
 *    (câmera, microfone, notificações, localização...) quando o app não diz
 *    nada. Uma página aberta pelo agente podia pedir o microfone e ganhar.
 *    Aqui tudo é negado — o AuGPT não precisa de nenhuma dessas permissões.
 *
 * 2. Rede local dentro do navegador. As ferramentas conferem a URL antes de
 *    abrir (src/tools/rede.js), mas dentro do Chromium a página pode
 *    redirecionar, carregar um iframe ou fazer um fetch pra 192.168.0.1 ou
 *    127.0.0.1. Cada requisição passa por `hostClaramenteInterno` (sem DNS —
 *    precisa ser rápido, roda pra cada imagem e script) e é cancelada se for
 *    pra dentro da rede, a não ser que o usuário tenha liberado
 *    (`permitirRedeLocal`).
 */

const { hostClaramenteInterno, redeLocalLiberada } = require('../src/tools/rede');

const protegidas = new WeakSet();

/**
 * Nega tudo, menos o que `permitir(webContents, permissao, tiposDeMidia)` liberar (24/10: o
 * microfone da janela principal, para o ditado por voz — e só áudio, nunca câmera).
 */
function negarPermissoes(ses, { permitir = null } = {}) {
  const tipos = (d) => (Array.isArray(d?.mediaTypes) && d.mediaTypes.length ? d.mediaTypes : d?.mediaType ? [d.mediaType] : []);
  const liberado = (wc, permissao, detalhes) => Boolean(permitir && permitir(wc, permissao, tipos(detalhes)));
  ses.setPermissionRequestHandler((wc, permissao, responder, detalhes) => responder(liberado(wc, permissao, detalhes)));
  ses.setPermissionCheckHandler((wc, permissao, _origem, detalhes) => liberado(wc, permissao, detalhes));
}

/** Só o microfone (áudio, sem vídeo) de um webContents. */
const soMicrofoneDe = (obterAlvo, ligado = () => true) => (wc, permissao, tipos) =>
  permissao === 'media' && ligado() && !!wc && wc === obterAlvo() && tipos.length > 0 && tipos.every((t) => t === 'audio');

/**
 * Aplica as duas proteções numa sessão (uma vez só por sessão).
 * `obterConfig` devolve a config atual — lida a cada requisição, pra mudança
 * em Ajustes valer sem reiniciar o app.
 */
/**
 * Revisão de 25/10: na LEITURA em segundo plano (render.js), anúncio, rastreador, vídeo e fonte não
 * ajudam a ler o texto — só pesam e mandam dados para fora (o "tracookiepixel.xyz" no terminal).
 * O navegador do agente (onde o usuário faz login) não usa isto.
 */
const RASTREADOR = /(^|\.)(doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com|googleadservices\.com|adservice\.google\.\w+|facebook\.net|connect\.facebook\.net|hotjar\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|adnxs\.com|amazon-adsystem\.com|scorecardresearch\.com|quantserve\.com|pubmatic\.com|rubiconproject\.com|openx\.net|casalemedia\.com|moatads\.com|chartbeat\.(com|net)|clarity\.ms|bat\.bing\.com|analytics\.tiktok\.com|ads-twitter\.com|hs-analytics\.net|newrelic\.com|nr-data\.net|segment\.(io|com)|mixpanel\.com|branch\.io|onesignal\.com|pushnews\.com\.br|navdmp\.com|tail\.digital)$|(^|[.-])(ads?|adserver|pixel|tracking|tracker|analytics|metrics)[.-]|pixel\.\w+$|cookiepixel/i;
function bloqueavelNaLeitura(url, tipo) {
  if (tipo === 'media' || tipo === 'font' || tipo === 'image') return true;
  try {
    return RASTREADOR.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function protegerSessaoWeb(ses, { obterConfig = () => ({}), soLeitura = false } = {}) {
  if (!ses || protegidas.has(ses)) return ses;
  protegidas.add(ses);
  negarPermissoes(ses);
  ses.webRequest.onBeforeRequest((detalhes, responder) => {
    try {
      const alvo = new URL(detalhes.url);
      if (/^(https?|wss?):$/.test(alvo.protocol) && !redeLocalLiberada(obterConfig()) && hostClaramenteInterno(alvo.hostname)) {
        responder({ cancel: true });
        return;
      }
      if (soLeitura && detalhes.resourceType !== 'mainFrame' && bloqueavelNaLeitura(detalhes.url, detalhes.resourceType)) {
        responder({ cancel: true });
        return;
      }
    } catch {
      /* URL que o próprio Chromium não entende: deixa ele decidir */
    }
    responder({});
  });
  return ses;
}

module.exports = { protegerSessaoWeb, negarPermissoes, soMicrofoneDe, bloqueavelNaLeitura };
