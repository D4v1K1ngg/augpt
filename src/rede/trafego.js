'use strict';

/**
 * Tráfego de rede (18/10, item 5): quanto a placa de rede está recebendo e
 * enviando agora (amostras de `netstat -e` a cada segundo) e quais programas
 * têm conexões abertas, para onde (`netstat -ano` + `tasklist`, com o nome do
 * serviço pelo DNS reverso: googlevideo → YouTube, amazonaws → AWS…).
 * O que o Windows NÃO dá sem administrador: a banda de cada programa (o
 * Monitor de Recursos usa ETW, que exige elevação). A resposta diz isso, em
 * vez de inventar. Tudo fica no computador: nada vai para a memória do AuGPT.
 * Só comandos fixos, com execFile e sem shell.
 */

const { execFile } = require('child_process');
const dns = require('dns');

function rodar(comando, args, { timeout = 15000 } = {}) {
  return new Promise((ok) => {
    execFile(comando, args, { timeout, windowsHide: true, encoding: 'latin1', maxBuffer: 16 * 1024 * 1024 }, (err, saida) => ok(String(saida || '')));
  });
}

/** Bytes recebidos e enviados de `netstat -e` (a linha "Bytes", em qualquer idioma). */
function lerBytes(saida) {
  const m = /^\s*Bytes\s+(\d+)\s+(\d+)/m.exec(String(saida));
  return m ? { recebidos: Number(m[1]), enviados: Number(m[2]) } : null;
}

/** Conexões de `netstat -ano`: { proto, local, remoto, estado, pid }. */
function lerConexoes(saida) {
  const lista = [];
  for (const linha of String(saida).split(/\r?\n/)) {
    const tcp = /^\s*TCP\s+(\S+)\s+(\S+)\s+([A-Z_]+)\s+(\d+)\s*$/.exec(linha);
    if (tcp) {
      lista.push({ proto: 'TCP', local: tcp[1], remoto: tcp[2], estado: tcp[3], pid: Number(tcp[4]) });
      continue;
    }
    const udp = /^\s*UDP\s+(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(linha);
    if (udp) lista.push({ proto: 'UDP', local: udp[1], remoto: udp[2], estado: '', pid: Number(udp[3]) });
  }
  return lista;
}

/** Nomes dos processos de `tasklist /fo csv /nh`: Map pid → nome. */
function lerProcessos(saida) {
  const mapa = new Map();
  for (const linha of String(saida).split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(linha);
    if (m) mapa.set(Number(m[2]), m[1].replace(/\.exe$/i, ''));
  }
  return mapa;
}

const ipDe = (endereco) => {
  const s = String(endereco || '');
  const v6 = /^\[([^\]]+)\]:\d+$/.exec(s);
  return v6 ? v6[1] : s.replace(/:\d+$/, '');
};
const PRIVADO = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|0\.0\.0\.0|::1?$|fe80:|\*)/i;

// o nome do servidor diz o serviço
const SERVICOS = [
  [/googlevideo\.com$/, 'YouTube (vídeo)'],
  [/(1e100\.net|google\.com|googleusercontent\.com|gstatic\.com)$/, 'Google'],
  [/amazonaws\.com$/, 'Amazon AWS (jogos, sites, apps)'],
  [/cloudfront\.net$/, 'Amazon CloudFront (CDN)'],
  [/(akamai\w*\.net|akamaitechnologies\.com|akadns\.net)$/, 'Akamai (CDN: downloads, atualizações, streaming)'],
  [/(valve\.net|steamcontent\.com|steamserver\.net|steampowered\.com)$/, 'Steam / Valve'],
  [/(discord\.(gg|com|media)|discordapp\.(com|net))$/, 'Discord'],
  [/(microsoft\.com|msedge\.net|windowsupdate\.com|azure\w*\.(com|net)|live\.com|office\w*\.com|trafficmanager\.net)$/, 'Microsoft (Windows, Office, Azure)'],
  [/(cloudflare\.(com|net)|cloudflare-dns\.com)$/, 'Cloudflare'],
  [/(facebook\.com|fbcdn\.net|whatsapp\.(net|com)|instagram\.com)$/, 'Meta (WhatsApp, Instagram, Facebook)'],
  [/(riotgames\.com|riotcdn\.net|pvp\.net)$/, 'Riot Games'],
  [/(nflxvideo\.net|netflix\.com)$/, 'Netflix'],
  [/(epicgames\.com|unrealengine\.com)$/, 'Epic Games'],
  [/(spotify\.com|scdn\.co)$/, 'Spotify'],
  [/(twitch\.tv|ttvnw\.net)$/, 'Twitch'],
];
const servicoDe = (host) => (SERVICOS.find(([re]) => re.test(String(host || '').toLowerCase())) || [])[1] || null;

// pelo resolvedor do sistema (getnameinfo): o dns.reverse do Node (c-ares) dava ENOTFOUND para tudo
// no PC de teste (18/10), e o do Windows respondia "ec2-…amazonaws.com"
const reversoDoSistema = async (ip) => {
  const { hostname } = await dns.promises.lookupService(ip, 443);
  return hostname && hostname !== ip ? [hostname] : [];
};

async function nomeReverso(ip, { reverso = reversoDoSistema } = {}) {
  try {
    const nomes = await Promise.race([reverso(ip), new Promise((_, nao) => setTimeout(() => nao(new Error('tempo')), 2000))]);
    return nomes?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * @param deps.executar (comando, args) → saída de texto; deps.reverso (ip) → [nomes]; deps.esperar
 * @returns { taxa: [{ t, downMbps, upMbps }], media, pico, programas: [...], totalConexoes }
 */
async function medirTrafego({ segundos = 6, deps = {}, aoProgresso = () => {} } = {}) {
  const executar = deps.executar || rodar;
  const esperar = deps.esperar || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const agora = deps.agora || (() => Date.now());
  aoProgresso(`medindo a placa de rede por ${segundos} s`);
  const amostras = [];
  for (let i = 0; i <= segundos; i += 1) {
    const b = lerBytes(await executar('netstat', ['-e']));
    if (b) amostras.push({ t: agora(), ...b });
    if (i < segundos) await esperar(1000);
  }
  // o contador do Windows é de 32 bits: quando passa de 4 GB, volta a zero
  const delta = (a, b) => (b >= a ? b - a : b + 2 ** 32 - a);
  const taxa = [];
  for (let i = 1; i < amostras.length; i += 1) {
    const s = Math.max(0.2, (amostras[i].t - amostras[i - 1].t) / 1000);
    taxa.push({
      t: Math.round((amostras[i].t - amostras[0].t) / 1000),
      downMbps: Math.round(((delta(amostras[i - 1].recebidos, amostras[i].recebidos) * 8) / s / 1e6) * 100) / 100,
      upMbps: Math.round(((delta(amostras[i - 1].enviados, amostras[i].enviados) * 8) / s / 1e6) * 100) / 100,
    });
  }
  const media = (k) => (taxa.length ? Math.round((taxa.reduce((t, x) => t + x[k], 0) / taxa.length) * 100) / 100 : null);
  const pico = (k) => (taxa.length ? Math.max(...taxa.map((x) => x[k])) : null);

  aoProgresso('quais programas estão conectados');
  const [saidaNetstat, saidaTasklist] = await Promise.all([executar('netstat', ['-ano']), executar('tasklist', ['/fo', 'csv', '/nh'])]);
  const conexoes = lerConexoes(saidaNetstat);
  const nomes = lerProcessos(saidaTasklist);
  const porPrograma = new Map();
  for (const c of conexoes) {
    const ativo = c.proto === 'TCP' ? c.estado === 'ESTABLISHED' : true;
    if (!ativo || c.pid === 0) continue;
    const nome = nomes.get(c.pid) || (c.pid === 4 ? 'System' : `processo ${c.pid}`);
    const p = porPrograma.get(nome) || { nome, pids: new Set(), tcp: 0, udp: 0, remotos: new Set() };
    p.pids.add(c.pid);
    if (c.proto === 'TCP') {
      p.tcp += 1;
      const ip = ipDe(c.remoto);
      if (!PRIVADO.test(ip)) p.remotos.add(ip);
    } else p.udp += 1;
    porPrograma.set(nome, p);
  }
  // nome dos servidores mais citados (até 40, em paralelo, 1,5 s cada)
  const todosOsIps = [...new Set([...porPrograma.values()].flatMap((p) => [...p.remotos]))].slice(0, 40);
  if (todosOsIps.length) aoProgresso(`identificando ${todosOsIps.length} servidores`);
  const hosts = new Map(await Promise.all(todosOsIps.map(async (ip) => [ip, await nomeReverso(ip, deps.reverso ? { reverso: deps.reverso } : {})])));
  const programas = [...porPrograma.values()]
    .map((p) => {
      const destinos = [...p.remotos].map((ip) => ({ ip, host: hosts.get(ip) || null, servico: servicoDe(hosts.get(ip)) }));
      const servicos = [...new Set(destinos.map((d) => d.servico).filter(Boolean))];
      return { nome: p.nome, pids: [...p.pids], tcp: p.tcp, udp: p.udp, destinos, servicos };
    })
    .sort((a, b) => b.tcp - a.tcp || b.udp - a.udp);
  return {
    taxa,
    media: { downMbps: media('downMbps'), upMbps: media('upMbps') },
    pico: { downMbps: pico('downMbps'), upMbps: pico('upMbps') },
    programas,
    totalConexoes: conexoes.filter((c) => c.proto === 'TCP' && c.estado === 'ESTABLISHED').length,
  };
}

function tabelaDoTrafego(r, maximo = 10) {
  const topo = `**Agora na placa de rede:** recebendo ${r.media.downMbps} Mbps em média (pico ${r.pico.downMbps}) e enviando ${r.media.upMbps} Mbps (pico ${r.pico.upMbps}), medidos por ${r.taxa.length} s.`;
  const linhas = ['| Programa | Conexões ativas | Portas UDP | Conectado a |', '| --- | --- | --- | --- |'];
  for (const p of r.programas.slice(0, maximo)) {
    const destino = p.servicos.length ? p.servicos.join(', ') : p.destinos.length ? `${p.destinos.length} servidor(es) sem nome conhecido` : '—';
    linhas.push(`| ${p.nome} | ${p.tcp} | ${p.udp} | ${destino} |`);
  }
  const nota = '*O Windows não informa a banda de cada programa sem permissão de administrador: a velocidade acima é o total da placa; a tabela mostra quem está conectado e a quê. Nada disso sai do seu computador.*';
  return `${topo}\n\n${linhas.join('\n')}\n\n${nota}`;
}

function graficosDoTrafego(r) {
  const bloco = (spec) => `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``;
  const saida = [];
  if (r.taxa.length >= 2) saida.push(bloco({ type: 'line', title: 'Tráfego da placa de rede (Mbps)', labels: r.taxa.map((x) => `${x.t}s`), datasets: [{ label: 'recebendo', data: r.taxa.map((x) => x.downMbps) }, { label: 'enviando', data: r.taxa.map((x) => x.upMbps) }] }));
  const top = r.programas.filter((p) => p.tcp > 0).slice(0, 8);
  if (top.length >= 2) saida.push(bloco({ type: 'horizontalBar', title: 'Conexões ativas por programa', labels: top.map((p) => p.nome.slice(0, 40)), datasets: [{ label: 'conexões', data: top.map((p) => p.tcp) }] }));
  return saida;
}

module.exports = { medirTrafego, tabelaDoTrafego, graficosDoTrafego, lerBytes, lerConexoes, lerProcessos, servicoDe };
