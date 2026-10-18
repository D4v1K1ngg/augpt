'use strict';

/**
 * Rotas para jogos (18/10): o ping até as regiões onde os servidores do jogo
 * ficam e o caminho (tracert) até a melhor delas.
 * - AWS (PUBG, Fortnite e muitos outros rodam lá): HTTPS no endpoint de saúde
 *   do DynamoDB de cada região — o mesmo truque dos sites de "cloud ping". As
 *   2 primeiras medidas têm o aperto de mão do TLS e saem; fica a mediana.
 * - Valve (CS2, Dota 2): a lista pública de relays (GetSDRConfig) e o ping do
 *   sistema até um relay de cada cidade.
 * - Riot (LoL, Valorant): não publica endereço de teste; o servidor BR fica em
 *   São Paulo, então a AWS São Paulo serve de referência (e a resposta diz isso).
 * Só comandos fixos (ping, tracert) com execFile, sem shell; destino só IP ou
 * endereço da lista abaixo.
 */

const { execFile } = require('child_process');

const REGIOES_AWS = {
  'sa-east-1': 'São Paulo',
  'us-east-1': 'EUA Leste (Virgínia)',
  'us-east-2': 'EUA Leste (Ohio)',
  'us-west-2': 'EUA Oeste (Oregon)',
  'eu-central-1': 'Europa (Frankfurt)',
  'eu-west-1': 'Europa (Irlanda)',
  'ap-northeast-2': 'Coreia (Seul)',
  'ap-northeast-1': 'Japão (Tóquio)',
  'ap-southeast-1': 'Sudeste Asiático (Singapura)',
  'ap-southeast-2': 'Austrália (Sydney)',
};

const JOGOS = {
  pubg: { nome: 'PUBG', provedor: 'aws', regioes: ['sa-east-1', 'us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-2', 'ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2'], nota: 'Os servidores do PUBG ficam na AWS; a medida vai até a região (o servidor da partida fica nela).' },
  fortnite: { nome: 'Fortnite', provedor: 'aws', regioes: ['sa-east-1', 'us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-northeast-1', 'ap-southeast-2'], nota: 'O Fortnite roda na AWS; a medida vai até a região do servidor.' },
  cs2: { nome: 'Counter-Strike 2', provedor: 'valve', appid: 730 },
  dota2: { nome: 'Dota 2', provedor: 'valve', appid: 570 },
  lol: { nome: 'League of Legends', provedor: 'riot', regioes: ['sa-east-1', 'us-east-1'], nota: 'A Riot não publica endereço de teste. O servidor BR do LoL fica em São Paulo: a latência até a AWS São Paulo é uma boa referência, não o ping exato do jogo.' },
  // pedido de rota sem jogo conhecido: as regiões da AWS, onde roda a maioria dos jogos online
  aws: { nome: 'jogos online (regiões da AWS)', provedor: 'aws', regioes: ['sa-east-1', 'us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'], nota: 'Muitos jogos online rodam na AWS; a medida vai até cada região. Para o ping exato de um jogo, diga qual.' },
  valorant: { nome: 'Valorant', provedor: 'riot', regioes: ['sa-east-1', 'us-east-1'], nota: 'A Riot não publica endereço de teste. O servidor de São Paulo do Valorant fica na mesma cidade da AWS São Paulo: a medida é uma referência, não o ping exato do jogo.' },
};

const APELIDOS = [
  [/\bpubg\b|battlegrounds/, 'pubg'],
  [/\bfortnite\b/, 'fortnite'],
  [/\bcs ?2\b|counter[- ]?strike|\bcs ?go\b|\bcsgo\b/, 'cs2'],
  [/\bdota\b/, 'dota2'],
  [/\blol\b|league of legends/, 'lol'],
  [/\bvalorant\b/, 'valorant'],
];

const mediana = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOST_PERMITIDO = /^dynamodb\.[a-z]{2}-[a-z]+-\d\.amazonaws\.com$/;
const destinoValido = (d) => IP.test(String(d)) || HOST_PERMITIDO.test(String(d));

function rodar(comando, args, { timeout = 30000 } = {}) {
  return new Promise((ok) => {
    execFile(comando, args, { timeout, windowsHide: true, encoding: 'latin1' }, (err, saida) => ok(String(saida || '')));
  });
}

/** Tempos de um `ping` do sistema (pt-BR "tempo=17ms", inglês "time=17ms", "<1ms"). */
function lerPing(saida) {
  return [...String(saida).matchAll(/(?:tempo|time)[=<]\s?(\d+(?:[.,]\d+)?)\s?ms/gi)].map((m) => Number(m[1].replace(',', '.')));
}

async function pingSistema(ip, { vezes = 4, executar = rodar } = {}) {
  if (!IP.test(ip)) throw new Error('destino inválido');
  const args = process.platform === 'win32' ? ['-n', String(vezes), '-w', '1000', ip] : ['-c', String(vezes), '-W', '1', ip];
  const tempos = lerPing(await executar('ping', args, { timeout: vezes * 1500 + 3000 }));
  return { ms: mediana(tempos), perdaPct: Math.round(((vezes - tempos.length) / vezes) * 100) };
}

async function pingAws(regiao, { fetchFn = globalThis.fetch, agora = () => performance.now(), vezes = 5 } = {}) {
  const url = `https://dynamodb.${regiao}.amazonaws.com/ping`;
  const tempos = [];
  for (let i = 0; i < vezes; i += 1) {
    const t0 = agora();
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(4000) });
      await r.text();
      if (i >= 2) tempos.push(agora() - t0); // as 2 primeiras têm o aperto de mão do TLS
    } catch {
      /* perdida */
    }
  }
  return { ms: tempos.length ? Math.round(mediana(tempos)) : null, perdaPct: Math.round(((vezes - 2 - tempos.length) / (vezes - 2)) * 100) };
}

/** Relays da Valve: uma cidade por linha, com o 1º relay dela. */
async function relaysDaValve(appid, { fetchFn = globalThis.fetch } = {}) {
  const r = await fetchFn(`https://api.steampowered.com/ISteamApps/GetSDRConfig/v1/?appid=${Number(appid)}`, { signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  return Object.entries(j.pops || {})
    .filter(([, p]) => p.relays?.length && IP.test(p.relays[0].ipv4))
    .map(([id, p]) => ({ id, nome: String(p.desc || id), ip: p.relays[0].ipv4 }));
}

/** Saltos de um `tracert`/`traceroute`: { salto, ms (mediana das 3), ip }. */
function lerTracert(saida) {
  const saltos = [];
  for (const linha of String(saida).split(/\r?\n/)) {
    const m = /^\s*(\d{1,2})\s+((?:(?:<?\d+\s*ms|\*)\s+){3})(.*)$/.exec(linha);
    if (!m) continue;
    const tempos = [...m[2].matchAll(/<?(\d+)\s*ms/g)].map((x) => Number(x[1]));
    const ip = (/(\d{1,3}(?:\.\d{1,3}){3})/.exec(m[3]) || [])[1] || null;
    saltos.push({ salto: Number(m[1]), ms: tempos.length ? mediana(tempos) : null, ip });
  }
  return saltos;
}

async function tracert(destino, { executar = rodar } = {}) {
  if (!destinoValido(destino)) throw new Error('destino inválido');
  const win = process.platform === 'win32';
  const saida = await executar(win ? 'tracert' : 'traceroute', win ? ['-d', '-w', '700', '-h', '25', destino] : ['-n', '-w', '1', '-m', '25', destino], { timeout: 90000 });
  return lerTracert(saida);
}

// rede de casa, da operadora (CGNAT) ou privada: os primeiros saltos
const PRIVADO = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.)/;
function ondeFica(s, i, total) {
  if (i === 0) return 'seu roteador';
  if (s.ip && PRIVADO.test(s.ip)) return 'rede local ou da operadora';
  if (i === total - 1) return 'destino';
  return 'internet (operadora e caminho até o servidor)';
}

/**
 * Mede o jogo: as regiões (ou cidades da Valve) e o caminho até a melhor.
 * `deps`: { fetch, executar } — a bancada passa dublês.
 */
async function medirJogo(chave, { deps = {}, comRota = true, aoProgresso = () => {} } = {}) {
  const jogo = JOGOS[chave];
  if (!jogo) throw new Error(`jogo desconhecido: ${chave}`);
  const fetchFn = deps.fetch || globalThis.fetch;
  const executar = deps.executar || rodar;
  let destinos;
  if (jogo.provedor === 'valve') {
    aoProgresso('lista de servidores da Valve');
    const relays = await relaysDaValve(jogo.appid, { fetchFn });
    // ping de ~50 cidades, 10 por vez
    destinos = [];
    for (let i = 0; i < relays.length; i += 10) {
      const lote = relays.slice(i, i + 10);
      aoProgresso(`ping até ${lote.map((r) => r.id).join(', ')}`);
      destinos.push(...(await Promise.all(lote.map(async (r) => ({ ...r, ...(await pingSistema(r.ip, { vezes: 3, executar })) })))));
    }
  } else {
    aoProgresso(`ping até ${jogo.regioes.length} regiões da AWS`);
    destinos = await Promise.all(jogo.regioes.map(async (id) => ({ id, nome: REGIOES_AWS[id], host: `dynamodb.${id}.amazonaws.com`, ...(await pingAws(id, { fetchFn })) })));
  }
  const medidos = destinos.filter((d) => Number.isFinite(d.ms)).sort((a, b) => a.ms - b.ms);
  const melhor = medidos[0] || null;
  let rota = [];
  if (comRota && melhor) {
    aoProgresso(`caminho até ${melhor.nome} (tracert)`);
    rota = (await tracert(melhor.ip || melhor.host, { executar }).catch(() => [])).map((s, i, todos) => ({ ...s, onde: ondeFica(s, i, todos.length) }));
  }
  return { jogo: { chave, nome: jogo.nome, provedor: jogo.provedor, nota: jogo.nota || null }, destinos: medidos, semResposta: destinos.filter((d) => !Number.isFinite(d.ms)).map((d) => d.nome), melhor, rota };
}

/** Onde a latência mais sobe entre dois saltos com resposta. */
function maiorSalto(rota) {
  let maior = null;
  let anterior = null;
  for (const s of rota) {
    if (!Number.isFinite(s.ms)) continue;
    if (anterior && (!maior || s.ms - anterior.ms > maior.aumento)) maior = { de: anterior.salto, para: s.salto, aumento: s.ms - anterior.ms, onde: s.onde };
    anterior = s;
  }
  return maior;
}

// saltos seguidos sem resposta numa linha só (roteador que não responde ao teste é normal)
function linhasDaRota(rota) {
  const linhas = [];
  for (let i = 0; i < rota.length; i += 1) {
    const s = rota[i];
    if (Number.isFinite(s.ms)) {
      linhas.push(`| ${s.salto} | ${s.ms} ms | ${s.ip || '—'} | ${s.onde} |`);
      continue;
    }
    let j = i;
    while (j + 1 < rota.length && !Number.isFinite(rota[j + 1].ms)) j += 1;
    linhas.push(`| ${j > i ? `${s.salto}–${rota[j].salto}` : s.salto} | sem resposta | — | roteadores que não respondem ao teste (normal) |`);
    i = j;
  }
  return linhas;
}

function tabelasDoJogo(r) {
  const top = r.destinos.slice(0, 12);
  const regioes = ['| Servidor | Ping |', '| --- | --- |', ...top.map((d, i) => `| ${i === 0 ? '**' : ''}${d.nome}${i === 0 ? '** (melhor)' : ''} | ${d.ms} ms${d.perdaPct ? ` (${d.perdaPct}% perda)` : ''} |`)].join('\n');
  const rota = r.rota.length
    ? ['| Salto | Ping | Endereço | Onde |', '| --- | --- | --- | --- |', ...linhasDaRota(r.rota)].join('\n')
    : '';
  return { regioes, rota };
}

function graficosDoJogo(r) {
  const bloco = (spec) => `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``;
  const saida = [];
  const top = r.destinos.slice(0, 12);
  if (top.length >= 2) saida.push(bloco({ type: 'horizontalBar', title: `Ping até os servidores do ${r.jogo.nome} (ms)`, labels: top.map((d) => d.nome.slice(0, 40)), datasets: [{ label: 'ms', data: top.map((d) => d.ms) }] }));
  const comTempo = r.rota.filter((s) => Number.isFinite(s.ms));
  if (comTempo.length >= 3) saida.push(bloco({ type: 'line', title: `Latência a cada salto até ${r.melhor.nome} (ms)`, labels: comTempo.map((s) => `salto ${s.salto}`), datasets: [{ label: 'ms', data: comTempo.map((s) => s.ms) }] }));
  return saida;
}

/** O jogo citado no texto (normalizado, sem acento). */
const jogoDoTexto = (t) => (APELIDOS.find(([re]) => re.test(t)) || [])[1] || null;

module.exports = { medirJogo, tabelasDoJogo, graficosDoJogo, maiorSalto, lerPing, lerTracert, jogoDoTexto, JOGOS, REGIOES_AWS, destinoValido };
