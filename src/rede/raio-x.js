'use strict';

/**
 * Raio-X da rede local (18/10): o que fica entre o PC e a internet.
 * - a ligação: cabo ou Wi-Fi, velocidade, placa (Get-NetAdapter); no Wi-Fi,
 *   sinal, banda, canal e padrão (netsh wlan show interfaces);
 * - a configuração (o que o `ipconfig /all` mostra): IP, gateway, DNS, DHCP, IPv6;
 * - o ping até o roteador, repetido (perda, jitter, pior caso) — o trecho
 *   PC → roteador que o tracert mostra só como "salto 1";
 * - os aparelhos na rede (tabela ARP depois de um toque em cada endereço da
 *   faixa, que acorda os quietos), com o fabricante pela lista do IEEE que vem
 *   com o app (dados/oui.txt.gz) — nada sai do computador;
 * - o modelo do roteador: fabricante pelo MAC, modelo e firmware pela página
 *   de entrada dele (sem login: o TP-Link do Davi diz "AX73v2_1.10.2_2025-11-26"
 *   numa etiqueta) ou pelo UPnP.
 * Só leitura, sem administrador, só comandos fixos (execFile, sem shell).
 * A varredura só acontece em rede privada (192.168.x, 10.x, 172.16-31.x).
 */

const { execFile } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rodar(comando, args, { timeout = 20000 } = {}) {
  return new Promise((ok) => {
    execFile(comando, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, saida) => ok(String(saida || '')));
  });
}

const PRIVADA = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// o ConvertTo-Json do PowerShell devolve lista de 1 item como valor solto
const lista = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const mediana = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

/* ------------------------------ fabricante pelo MAC ------------------------------ */

let oui = null;
function fabricante(mac) {
  if (!oui) {
    oui = new Map();
    try {
      const txt = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', '..', 'dados', 'oui.txt.gz'))).toString('utf8');
      for (const l of txt.split('\n')) oui.set(l.slice(0, 6), l.slice(7));
    } catch {
      /* sem a lista: só o tipo de endereço */
    }
  }
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length < 6) return null;
  return oui.get(hex.slice(0, 6)) || null;
}
// o que o fabricante costuma ser numa casa (dica para a explicação; não é certeza)
const TIPO_POR_FABRICANTE = [
  [/espressif|tuya|shelly|sonoff|itead|broadlink|positivo tecnologia|ohsung/i, 'casa inteligente (lâmpada, tomada, sensor, controle)'],
  [/altobeam|amlogic|realtek semiconductor|roku|tcl|hisense/i, 'TV, TV box ou aparelho de vídeo'],
  [/apple/i, 'iPhone, iPad ou Mac'],
  [/samsung|xiaomi|motorola|huawei|oppo|vivo|realme|oneplus|honor|lg electronics/i, 'celular, TV ou aparelho da casa'],
  [/amazon/i, 'Alexa, Fire TV ou Kindle'],
  [/google/i, 'Chromecast, Nest ou celular Pixel'],
  [/sony|nintendo/i, 'console (PlayStation/Switch) ou TV'],
  [/microsoft/i, 'Xbox ou computador'],
  [/intel|liteon|azurewave|hon hai|foxconn|giga-?byte|asustek|micro-star|dell|hewlett|lenovo|acer/i, 'computador ou notebook'],
  [/hikvision|dahua|intelbras|ezviz|tp-link/i, 'câmera, roteador ou repetidor'],
];
const tipoProvavel = (fab) => (TIPO_POR_FABRICANTE.find(([re]) => re.test(String(fab || ''))) || [])[1] || null;
// nome comercial da linha (o TP-Link escreve só "AX73" na etiqueta)
const comLinha = (fab, modelo) => (modelo && /tp-?link/i.test(fab || '') && /^(AX|AXE|BE|C|A)\d/i.test(modelo) ? `Archer ${modelo}` : modelo);
// 2º dígito 2, 6, A ou E: endereço "local", sorteado — celulares e notebooks modernos fazem isso por privacidade
const macAleatorio = (mac) => /^.[26AE]/i.test(String(mac || '').replace(/[^0-9a-f]/gi, ''));

/* ------------------------------ leitura do Windows ------------------------------ */

// uma chamada só ao PowerShell: placas, rota padrão, IP/DNS e vizinhos (ARP), em JSON
const SCRIPT = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
$rota = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
$cfg = if ($rota) { Get-NetIPConfiguration -InterfaceIndex $rota.InterfaceIndex -Detailed -ErrorAction SilentlyContinue } else { $null }
$placa = if ($rota) { Get-NetAdapter -InterfaceIndex $rota.InterfaceIndex -ErrorAction SilentlyContinue } else { $null }
$ip4 = if ($cfg) { $cfg.IPv4Address | Select-Object -First 1 } else { $null }
[pscustomobject]@{
  gateway = if ($rota) { $rota.NextHop } else { $null }
  placa = if ($placa) { [pscustomobject]@{ nome = $placa.Name; descricao = $placa.InterfaceDescription; velocidade = $placa.LinkSpeed; meio = $placa.PhysicalMediaType; mac = $placa.MacAddress; driver = $placa.DriverVersion } } else { $null }
  ip = if ($ip4) { $ip4.IPAddress } else { $null }
  prefixo = if ($ip4) { $ip4.PrefixLength } else { $null }
  dhcp = if ($cfg) { [string]$cfg.NetIPv4Interface.Dhcp } else { $null }
  dns = if ($cfg) { @($cfg.DNSServer | Where-Object AddressFamily -eq 2 | ForEach-Object { $_.ServerAddresses }) } else { @() }
  ipv6 = if ($cfg) { [bool]($cfg.IPv6Address | Where-Object { $_.PrefixOrigin -ne 'WellKnown' }) } else { $false }
  outrasPlacas = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and (-not $placa -or $_.ifIndex -ne $placa.ifIndex) } | ForEach-Object { $_.InterfaceDescription })
  vizinhos = @(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.State -in 'Reachable','Stale','Delay','Probe','Permanent' -and $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(FF-FF|01-00-5E|00-00-00)' } | ForEach-Object { [pscustomobject]@{ ip = $_.IPAddress; mac = $_.LinkLayerAddress; estado = [string]$_.State } })
} | ConvertTo-Json -Depth 4 -Compress`;

/** `netsh wlan show interfaces` em qualquer idioma: sinal, banda, canal, padrão, taxas. */
function lerWifi(saida) {
  const campos = {};
  for (const l of String(saida).split(/\r?\n/)) {
    const m = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/.exec(l);
    if (m) campos[m[1].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()] = m[2];
  }
  const v = (...ks) => {
    for (const k of ks) for (const [c, x] of Object.entries(campos)) if (c === k || c.startsWith(k)) return x;
    return null;
  };
  const estado = v('estado', 'state');
  if (!estado || !/conectad|connected/i.test(estado) || /desconect|disconnected/i.test(estado)) return null;
  const sinal = Number(String(v('sinal', 'signal') || '').replace(/\D/g, '')) || null;
  const radio = v('tipo de radio', 'radio type');
  const padrao = /802\.11be/i.test(radio) ? 'Wi-Fi 7' : /802\.11ax/i.test(radio) ? 'Wi-Fi 6' : /802\.11ac/i.test(radio) ? 'Wi-Fi 5' : /802\.11n/i.test(radio) ? 'Wi-Fi 4' : radio;
  return { ssid: v('ssid'), sinal, radio, padrao, banda: v('banda', 'band'), canal: v('canal', 'channel'), recebe: v('taxa de recepcao', 'receive rate'), envia: v('taxa de transmissao', 'transmit rate') };
}

const { lerPing } = require('./rotas');

/** Ping repetido até o roteador: mediana, jitter, pior, perda — e as amostras (para o gráfico). */
async function pingAoRoteador(ip, { vezes = 20, executar = rodar } = {}) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip)) || !PRIVADA.test(ip)) return null;
  const args = process.platform === 'win32' ? ['-n', String(vezes), '-w', '1000', ip] : ['-c', String(vezes), '-W', '1', '-i', '0.2', ip];
  const tempos = lerPing(await executar('ping', args, { timeout: vezes * 1200 + 5000 }));
  let soma = 0;
  for (let i = 1; i < tempos.length; i += 1) soma += Math.abs(tempos[i] - tempos[i - 1]);
  return { amostras: tempos, mediana: mediana(tempos), pior: tempos.length ? Math.max(...tempos) : null, jitter: tempos.length > 1 ? Math.round((soma / (tempos.length - 1)) * 10) / 10 : null, perdaPct: Math.round(((vezes - tempos.length) / vezes) * 100) };
}

/** Toque em cada endereço da faixa (UDP, porta 9): o Windows pergunta quem é (ARP) e a tabela se enche. */
async function acordarAFaixa(ip, prefixo, { enviar } = {}) {
  if (!PRIVADA.test(String(ip)) || !(prefixo >= 22 && prefixo <= 30)) return 0;
  const partes = ip.split('.').map(Number);
  const numero = ((partes[0] << 24) >>> 0) + (partes[1] << 16) + (partes[2] << 8) + partes[3];
  const mascara = (0xffffffff << (32 - prefixo)) >>> 0;
  const rede = (numero & mascara) >>> 0;
  const total = 2 ** (32 - prefixo) - 2;
  const endereco = (n) => [24, 16, 8, 0].map((d) => (n >>> d) & 255).join('.');
  const alvos = Array.from({ length: total }, (_, i) => endereco(rede + i + 1)).filter((a) => a !== ip);
  if (enviar) {
    await Promise.all(alvos.map((a) => enviar(a)));
    return alvos.length;
  }
  const s = dgram.createSocket('udp4');
  await new Promise((ok) => s.bind(ok));
  for (const a of alvos) s.send(Buffer.from([0]), 9, a, () => {});
  await new Promise((ok) => setTimeout(ok, 1800));
  s.close();
  return alvos.length;
}

/** Modelo e firmware pela página de entrada do roteador (sem login, sem senha) ou pelo UPnP. */
async function modeloDoRoteador(ip, { fetchFn = globalThis.fetch } = {}) {
  if (!PRIVADA.test(String(ip))) return null;
  const vistos = [];
  let url = `http://${ip}/`;
  for (let i = 0; i < 3 && url; i += 1) {
    let html = '';
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(4000), redirect: 'follow' });
      html = (await r.text()).slice(0, 200000);
    } catch {
      break;
    }
    vistos.push(html);
    // segue o redirecionamento da página (meta refresh ou location.href), só dentro do roteador
    const prox = /http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i.exec(html)?.[1] || /(?:window\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
    url = prox && !/^https?:/i.test(prox) ? new URL(prox, url).toString() : null;
  }
  const tudo = vistos.join('\n');
  // etiqueta de versão (TP-Link: <meta name="version" content="AX73v2_1.10.2_2025-11-26…">)
  const versao = /<meta[^>]+name=["'](?:version|model|product)["'][^>]+content=["']([^"']+)["']/i.exec(tudo)?.[1] || '';
  const titulo = (/<title>([^<]{2,80})<\/title>/i.exec(tudo)?.[1] || '').trim();
  const MODELO = /\b(Archer\s?[A-Z]{0,3}\d{2,4}[A-Z]?|Deco\s?[A-Z]{0,2}\d{1,3}|[A-Z]{1,4}-?[A-Z]?\d{2,5}[A-Z]{0,3})(?:\s?v(\d+))?/;
  const m = MODELO.exec(versao) || MODELO.exec(titulo);
  const firmware = /_(\d+\.\d+(?:\.\d+)*)_(\d{4}-\d{2}-\d{2})/.exec(versao);
  return {
    modelo: m ? `${m[1]}${m[2] ? ` v${m[2]}` : ''}` : null,
    firmware: firmware ? { versao: firmware[1], data: firmware[2] } : null,
    titulo: titulo && !/^(opening|loading|login|carregando)/i.test(titulo) ? titulo : null,
  };
}

/**
 * O raio-X inteiro. deps: { executar, fetch, enviar } (a bancada passa dublês).
 * @returns { ligacao, wifi, config, roteador, ping, aparelhos, avisos }
 */
async function raioX({ deps = {}, aoProgresso = () => {}, varrer = true } = {}) {
  const executar = deps.executar || rodar;
  if (process.platform !== 'win32' && !deps.executar) throw new Error('o raio-X da rede, por enquanto, é só para Windows');
  aoProgresso('lendo a placa de rede e a configuração (ipconfig)');
  let info = {};
  try {
    info = JSON.parse(await executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { timeout: 30000 }));
  } catch {
    info = {};
  }
  const wifi = lerWifi(await executar('netsh', ['wlan', 'show', 'interfaces']));
  const gateway = info.gateway || null;
  // o ping (1 por segundo no Windows) e a página do roteador correm junto com a busca de aparelhos
  aoProgresso('ping até o roteador (20 vezes)');
  const paralelo = Promise.all([gateway ? pingAoRoteador(gateway, { executar }) : null, gateway ? modeloDoRoteador(gateway, { fetchFn: deps.fetch }) : null]);
  // aparelhos: toca a faixa e relê a tabela
  let vizinhos = lista(info.vizinhos);
  if (varrer && info.ip && info.prefixo) {
    aoProgresso('procurando aparelhos na rede');
    const tocados = await acordarAFaixa(info.ip, info.prefixo, { enviar: deps.enviar });
    if (tocados) {
      try {
        vizinhos = JSON.parse(await executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', `${SCRIPT.split('\n')[0]}\n@(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.State -in 'Reachable','Stale','Delay','Probe','Permanent' -and $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(FF-FF|01-00-5E|00-00-00)' } | ForEach-Object { [pscustomobject]@{ ip = $_.IPAddress; mac = $_.LinkLayerAddress; estado = [string]$_.State } }) | ConvertTo-Json -Compress`], { timeout: 20000 }));
        vizinhos = lista(vizinhos);
      } catch {
        /* fica a lista de antes */
      }
    }
  }
  const mesmaRede = (ip) => info.ip && info.prefixo >= 16 && String(ip).split('.').slice(0, info.prefixo >= 24 ? 3 : 2).join('.') === String(info.ip).split('.').slice(0, info.prefixo >= 24 ? 3 : 2).join('.');
  const aparelhos = vizinhos
    .filter((v) => mesmaRede(v.ip) && !/^(22[4-9]|23\d|255)\./.test(v.ip) && !v.ip.endsWith('.255'))
    .map((v) => ({ ip: v.ip, fabricante: fabricante(v.mac), tipo: tipoProvavel(fabricante(v.mac)), aleatorio: macAleatorio(v.mac), roteador: v.ip === gateway, estado: v.estado }))
    .sort((a, b) => Number(b.roteador) - Number(a.roteador) || a.ip.localeCompare(b.ip, 'en', { numeric: true }));
  const macDoRoteador = vizinhos.find((v) => v.ip === gateway)?.mac;
  const [ping, pagina] = await paralelo;
  const placa = info.placa || null;
  return {
    ligacao: placa ? { tipo: wifi || /802\.11|wireless|wi-?fi/i.test(`${placa.meio} ${placa.descricao}`) ? 'Wi-Fi' : 'cabo', placa: placa.descricao, velocidade: placa.velocidade, driver: placa.driver } : null,
    wifi,
    config: { ip: info.ip || null, prefixo: info.prefixo || null, gateway, dns: lista(info.dns), dhcp: info.dhcp || null, ipv6: Boolean(info.ipv6), outrasPlacas: lista(info.outrasPlacas) },
    roteador: gateway ? { ip: gateway, fabricante: fabricante(macDoRoteador), ...(pagina || {}), modelo: comLinha(fabricante(macDoRoteador), pagina?.modelo) } : null,
    ping,
    aparelhos,
  };
}

/* ------------------------------ resposta ------------------------------ */

const PROBLEMA = { pingAlto: 5, jitterAlto: 3, sinalFraco: 50 };

/** Avaliação pelo código: o que está bom e o que não está, com o número. */
function avaliar(r) {
  const achados = [];
  if (r.ping) {
    if (r.ping.perdaPct > 0) achados.push({ grave: r.ping.perdaPct >= 2, texto: `${r.ping.perdaPct}% dos pings até o roteador se perderam (o normal é 0%)` });
    if (r.ping.mediana > PROBLEMA.pingAlto) achados.push({ grave: r.ping.mediana > 15, texto: `o ping até o roteador está em ${r.ping.mediana} ms (o normal no cabo é 1 ms; no Wi-Fi, até uns 5 ms)` });
    if (r.ping.jitter > PROBLEMA.jitterAlto || r.ping.pior > 30) achados.push({ grave: r.ping.pior > 50, texto: `o ping até o roteador oscila (jitter ${r.ping.jitter} ms, pior ${r.ping.pior} ms)` });
  }
  if (r.wifi) {
    if (r.wifi.sinal && r.wifi.sinal < PROBLEMA.sinalFraco) achados.push({ grave: r.wifi.sinal < 35, texto: `o sinal do Wi-Fi está em ${r.wifi.sinal}% (abaixo de 50% já perde estabilidade)` });
    if (/2[.,]4/.test(String(r.wifi.banda))) achados.push({ grave: false, texto: 'o Wi-Fi está na banda de 2,4 GHz, mais lenta e mais disputada que a de 5 GHz' });
    if (r.wifi.padrao === 'Wi-Fi 4') achados.push({ grave: false, texto: 'a ligação Wi-Fi é do padrão antigo (Wi-Fi 4 / 802.11n)' });
  }
  if (r.ligacao && /^(10|100) ?Mbps/i.test(String(r.ligacao.velocidade))) achados.push({ grave: true, texto: `a placa está ligada a só ${r.ligacao.velocidade} (cabo ruim ou porta de 100 Mbps limitam a internet)` });
  if (r.roteador?.firmware?.data && Date.now() - Date.parse(r.roteador.firmware.data) > 2 * 365 * 864e5) achados.push({ grave: false, texto: `o firmware do roteador é de ${r.roteador.firmware.data.split('-').reverse().join('/')} (mais de 2 anos)` });
  const vpn = (r.config.outrasPlacas || []).filter((d) => /vpn|virtual|tap|tun|wireguard|zerotier|hamachi|radmin/i.test(d));
  if (vpn.length) achados.push({ grave: false, texto: `há placa de VPN/virtual ligada (${vpn.join(', ')}): se o jogo passar por ela, o ping sobe` });
  return achados;
}

function tabelaDoRaioX(r) {
  const linha = (a, b) => `| ${a} | ${b} |`;
  const ap = r.aparelhos.filter((a) => !a.roteador);
  const linhas = ['| Item | Resultado |', '| --- | --- |'];
  if (r.ligacao) linhas.push(linha('Ligação do PC', `**${r.ligacao.tipo}**, ${r.ligacao.velocidade} (${r.ligacao.placa})`));
  if (r.wifi) linhas.push(linha('Wi-Fi', `sinal **${r.wifi.sinal ?? '—'}%**, ${r.wifi.banda || '—'}, canal ${r.wifi.canal || '—'}, ${r.wifi.padrao || '—'}${r.wifi.recebe ? `, ${r.wifi.recebe} Mbps de taxa` : ''}`));
  if (r.ping) linhas.push(linha('Ping até o roteador', `**${r.ping.mediana ?? '—'} ms** (jitter ${r.ping.jitter ?? '—'} ms, pior ${r.ping.pior ?? '—'} ms, perda ${r.ping.perdaPct}%) em ${r.ping.amostras.length + Math.round((r.ping.perdaPct / 100) * r.ping.amostras.length)} tentativas`));
  if (r.roteador) linhas.push(linha('Roteador', `${[r.roteador.fabricante, r.roteador.modelo].filter(Boolean).join(' ') || 'não identificado'}${r.roteador.firmware ? ` — firmware ${r.roteador.firmware.versao} de ${r.roteador.firmware.data.split('-').reverse().join('/')}` : ''} (${r.roteador.ip})`));
  linhas.push(linha('Aparelhos na rede', `**${ap.length}** além do roteador${ap.filter((a) => a.aleatorio).length ? ` (${ap.filter((a) => a.aleatorio).length} com endereço privado, quase sempre celular ou notebook)` : ''}`));
  linhas.push(linha('Configuração', `IP ${r.config.ip || '—'}/${r.config.prefixo || '—'}, DNS ${r.config.dns.join(', ') || '—'}${r.config.dns.includes(r.config.gateway) ? ' (o do roteador)' : ''}, DHCP ${/enabled/i.test(String(r.config.dhcp)) ? 'ligado' : r.config.dhcp || '—'}, IPv6 ${r.config.ipv6 ? 'sim' : 'não'}`));
  const lista = ap.length
    ? `\n\n**Aparelhos encontrados (${ap.length})**\n\n| Endereço | Fabricante | Costuma ser |\n| --- | --- | --- |\n${ap.map((a) => `| ${a.ip} | ${a.aleatorio ? 'endereço privado' : a.fabricante || 'desconhecido'} | ${a.aleatorio ? 'celular ou notebook' : a.tipo || '—'} |`).join('\n')}`
    : '';
  return `${linhas.join('\n')}${lista}\n\n*Só leitura, sem mudar nada. A lista de aparelhos mostra quem respondeu agora; aparelho dormindo pode não aparecer. Nada disso sai do seu computador.*`;
}

function graficosDoRaioX(r) {
  if (!r.ping || r.ping.amostras.length < 5) return [];
  return [`\`\`\`chart\n${JSON.stringify({ type: 'line', title: 'Ping até o roteador (ms)', unit: 'ms', labels: r.ping.amostras.map((_, i) => `${i + 1}`), datasets: [{ label: 'ms', data: r.ping.amostras }] })}\n\`\`\``];
}

module.exports = { tipoProvavel, raioX, avaliar, tabelaDoRaioX, graficosDoRaioX, lerWifi, fabricante, macAleatorio, modeloDoRoteador, pingAoRoteador, acordarAFaixa };
