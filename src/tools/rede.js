'use strict';

/**
 * Proteção de rede das ferramentas web — Fase 1 de segurança (2026-09-23),
 * antes da primeira publicação no GitHub.
 *
 * O problema: `validarUrl` (http.js) só conferia o protocolo. O modelo podia
 * mandar `abrir_pagina` ou `navegar` para `http://192.168.0.1/...` (painel do
 * roteador), `http://127.0.0.1:11434/api/...` (o próprio Ollama) ou qualquer
 * serviço da rede local — e, como ler página não pede aprovação, uma instrução
 * escondida numa página da web bastava pra isso acontecer (SSRF via injeção de
 * prompt). Aqui fica a regra única de "isto é endereço interno?", usada pelas
 * ferramentas antes de cada leitura e, no navegador do app, a cada requisição.
 *
 * Liberar a rede local é uma escolha explícita (`permitirRedeLocal` em
 * Ajustes → Pesquisa na web), útil pra quem quer que o agente leia um servidor
 * de desenvolvimento em localhost. A variável de ambiente
 * `AUGPT_PERMITIR_REDE_LOCAL=1` existe só pra bancada de testes, cujos
 * servidores falsos rodam em 127.0.0.1 (ver avaliacao/executar.js).
 */

const dns = require('dns');
const net = require('net');

const NOMES_INTERNOS = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback)$|\.(localhost|local|internal|lan|home|intranet)$/i;

/** IPv4 em forma de número de 32 bits. */
function ipv4ParaNumero(ip) {
  return ip.split('.').reduce((acc, parte) => (acc << 8) + Number(parte), 0) >>> 0;
}

const FAIXAS_IPV4_INTERNAS = [
  ['0.0.0.0', 8], // "esta rede"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (inclui 169.254.169.254, metadados de nuvem)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // reservada IETF
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // testes de rede
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada / broadcast
].map(([base, bits]) => ({ base: ipv4ParaNumero(base), mascara: bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0 }));

function ipv4Interno(ip) {
  const n = ipv4ParaNumero(ip);
  return FAIXAS_IPV4_INTERNAS.some(({ base, mascara }) => ((n & mascara) >>> 0) === ((base & mascara) >>> 0));
}

function ipv6Interno(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::' || s === '::1') return true;
  // IPv4 embutido (::ffff:127.0.0.1 e afins) — confere a parte IPv4
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4 && (s.startsWith('::ffff:') || s.startsWith('::'))) return ipv4Interno(v4[1]);
  const primeiro = parseInt(s.split(':')[0] || '0', 16);
  if ((primeiro & 0xfe00) === 0xfc00) return true; // fc00::/7, local única
  if ((primeiro & 0xffc0) === 0xfe80) return true; // fe80::/10, link-local
  if ((primeiro & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** `true` se o IP (literal, v4 ou v6) aponta pra rede local, loopback ou faixa reservada. */
function ipInterno(ip) {
  const limpo = String(ip || '').replace(/^\[|\]$/g, '');
  const versao = net.isIP(limpo);
  if (versao === 4) return ipv4Interno(limpo);
  if (versao === 6) return ipv6Interno(limpo);
  return false;
}

/**
 * Checagem rápida, sem DNS: nome ou IP literal claramente interno. Usada onde
 * não dá pra esperar uma resolução de nome (cada requisição do navegador do app).
 */
function hostClaramenteInterno(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (NOMES_INTERNOS.test(h)) return true;
  return ipInterno(h);
}

function redeLocalLiberada(config) {
  return config?.permitirRedeLocal === true || process.env.AUGPT_PERMITIR_REDE_LOCAL === '1';
}

const MENSAGEM_BLOQUEIO =
  'endereço da rede local ou do próprio computador — o agente só lê páginas da internet. ' +
  'Se você quer mesmo que ele acesse esse endereço, ative "Permitir endereços da rede local" em Ajustes → Pesquisa na web.';

/**
 * Checagem completa, com DNS: rejeita a URL se o nome resolver pra qualquer
 * endereço interno (pega também domínios públicos apontados pra 127.0.0.1,
 * truque comum de SSRF). Falha de DNS não bloqueia — a própria leitura vai
 * falhar logo depois, com a mensagem de erro normal.
 */
async function conferirDestino(url, config) {
  if (redeLocalLiberada(config)) return;
  let alvo;
  try {
    alvo = new URL(String(url));
  } catch {
    return; // validarUrl já cuida de URL malformada, com mensagem melhor
  }
  const host = alvo.hostname;
  if (hostClaramenteInterno(host)) throw new Error(`Bloqueado: ${host} é ${MENSAGEM_BLOQUEIO}`);
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return;
  let enderecos = [];
  try {
    enderecos = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return;
  }
  const interno = enderecos.find((e) => ipInterno(e.address));
  if (interno) throw new Error(`Bloqueado: ${host} aponta pra ${interno.address}, ${MENSAGEM_BLOQUEIO}`);
}

module.exports = { ipInterno, hostClaramenteInterno, conferirDestino, redeLocalLiberada, MENSAGEM_BLOQUEIO };
