'use strict';

/**
 * Ollama de outro computador da rede (19/10, item 0 do Davi): um PC com placa de vídeo
 * melhor serve o modelo, e o AuGPT deste PC usa pela rede. O endereço já existia em
 * Ajustes → Avançado; faltava achar o servidor, testar, e o app parar de tentar ligar ou
 * instalar o Ollama DESTE PC quando o endereço é de outro.
 *
 * No outro PC, o Ollama precisa aceitar conexões da rede: a variável de ambiente
 * OLLAMA_HOST=0.0.0.0 e a porta 11434 liberada no firewall (só rede privada).
 */

const os = require('os');

const PORTA = 11434;

/** O endereço é deste computador? (localhost, 127.x, ::1 ou um IP desta máquina) */
function ehLocal(host) {
  let nome;
  try {
    nome = new URL(String(host || 'http://127.0.0.1:11434')).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (/^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i.test(nome)) return true;
  return ipsDestePC().includes(nome);
}

function ipsDestePC() {
  return Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address);
}

/** As redes privadas IPv4 deste PC, como prefixo /24 ("192.168.0."), sem as de VPN/virtuais conhecidas. */
function redesLocais(interfaces = os.networkInterfaces()) {
  return [...new Set(ipsDaRede(interfaces).map((ip) => ip.split('.').slice(0, 3).join('.') + '.'))];
}

/** Os IPv4 privados deste PC na rede da casa (sem loopback e sem VPN/virtuais conhecidas). */
function ipsDaRede(interfaces = os.networkInterfaces()) {
  const ips = [];
  for (const [nome, lista] of Object.entries(interfaces)) {
    if (/vpn|virtual|vmware|vbox|hyper-v|wsl|loopback|radmin|hamachi|zerotier|tailscale/i.test(nome)) continue;
    for (const i of lista || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) continue;
      ips.push(i.address);
    }
  }
  return ips;
}

/**
 * Revisão de 25/10: o Ollama DESTE PC atende pela rede da casa? (a opção "Expose Ollama to the
 * network" do app do Ollama, ou OLLAMA_HOST=0.0.0.0). Útil para servir outro PC; fora isso, qualquer
 * aparelho da rede usa o modelo e lê o que passa por ele. → { exposto, ip }
 */
async function expostoNaRede({ fetchImpl = fetch, prazoMs = 800, ips = ipsDaRede() } = {}) {
  for (const ip of ips) {
    try {
      const r = await fetchImpl(`http://${ip}:${PORTA}/api/version`, { signal: comPrazo(prazoMs) });
      if (r.ok && (await r.json())?.version) return { exposto: true, ip };
    } catch {}
  }
  return { exposto: false, ip: null };
}

const comPrazo = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

/** Testa um servidor → { ok, host, versao, modelos: [nomes], erro } */
async function testar(host, { fetchImpl = fetch, prazoMs = 4000 } = {}) {
  const base = String(host || '').replace(/\/+$/, '');
  try {
    const v = await (await fetchImpl(`${base}/api/version`, { signal: comPrazo(prazoMs) })).json();
    const tags = await (await fetchImpl(`${base}/api/tags`, { signal: comPrazo(prazoMs) })).json().catch(() => ({}));
    return { ok: true, host: base, versao: v?.version || null, modelos: (tags?.models || []).map((m) => m.name) };
  } catch (err) {
    return { ok: false, host: base, erro: /abort|timeout/i.test(String(err?.name || err?.message)) ? 'não respondeu' : String(err?.message || err) };
  }
}

/**
 * Procura servidores Ollama nas redes locais deste PC (porta 11434, /api/version).
 * Só a rede privada (/24 de cada placa), 64 de cada vez, ~0,7 s por endereço → poucos segundos.
 */
async function procurarNaRede({ fetchImpl = fetch, prazoMs = 700, prefixos = redesLocais(), simultaneos = 64 } = {}) {
  const meus = new Set(ipsDestePC());
  const alvos = prefixos.flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}${i + 1}`));
  const achados = [];
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < alvos.length) {
      const ip = alvos[proximo++];
      try {
        const r = await fetchImpl(`http://${ip}:${PORTA}/api/version`, { signal: comPrazo(prazoMs) });
        if (!r.ok) continue;
        const v = await r.json();
        if (v && v.version) achados.push({ ip, host: `http://${ip}:${PORTA}`, versao: v.version, estePC: meus.has(ip) });
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneos, alvos.length) }, trabalhador));
  // os modelos de cada um (para escolher o PC certo pela lista)
  for (const a of achados) a.modelos = (await testar(a.host, { fetchImpl, prazoMs: 3000 })).modelos || [];
  return { redes: prefixos.map((p) => `${p}0/24`), achados: achados.sort((a, b) => Number(a.estePC) - Number(b.estePC)) };
}

module.exports = { ehLocal, redesLocais, ipsDaRede, expostoNaRede, testar, procurarNaRede, PORTA };
