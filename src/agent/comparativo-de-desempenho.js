'use strict';

/**
 * Comparativo de desempenho: Evidência → Dados → Análise — Etapa F da revisão
 * v2 (2026-09-28, 14º teste real).
 *
 * Origem: "Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX
 * 5080?". O agente leu 10 páginas de benchmark (thepcenthusiast 1440p/4K,
 * technical.city, pcbench, bestgpusforgaming, newegg, checkfps...) e nenhum
 * código tirou delas o FPS por jogo nem o "X% mais rápida"; o qwen2.5:7b
 * concluiu "a diferença é mínima" sem um número de jogo. Regra do projeto:
 * o modelo interpreta e explica; o CÓDIGO extrai, conta, calcula e valida.
 *
 * Mesmo espírito de serie-de-precos.js:
 *   1. evidência: frase/linha com os DOIS produtos + número (ou linha de
 *      tabela cujo cabeçalho tem os dois produtos como colunas);
 *   2. dados: item {percentual, valorA, valorB, jogo, resolucao, rt,
 *      sintetico, url, trecho} — `percentual` é SEMPRE "quanto B é mais
 *      rápido que A" (positivo = B mais rápido), já convertido pelo código;
 *   3. análise: mediana (não média — resiste a número estranho) por
 *      resolução e geral, sintético separado, fora da curva descartado;
 *   4. saída: bloco "DESEMPENHO MEDIDO PELO CÓDIGO" pro redator.
 * Cada item guarda o trecho literal e a URL, e cabe no livro de evidências
 * (evidencias.js) via `paraEvidencia`.
 */

const { produtosDoPedido, ehPedidoDeSerieDePrecos } = require('./serie-de-precos');

// Sem acento e minúsculo SEM mudar o tamanho do texto: os índices das
// menções e dos números valem também pro texto original (trecho literal).
const plano = (t) =>
  String(t || '')
    .replace(/[^\x00-\x7f]/g, (c) => {
      const d = c.normalize('NFD')[0];
      return /[a-z]/i.test(d) ? d : c;
    })
    .toLowerCase();

const r1 = (x) => Math.round(x * 10) / 10;
const numero = (s) => {
  const t = String(s).trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, '')); // "24,500" é milhar
  return Number(t.replace(',', '.'));
};

// ---------------------------------------------------------------- condições

const RE_RES = /\b(1080p|full ?hd|fhd|1440p|w?qhd|2k|2160p|4k|uhd)\b/g;
const mapaRes = (r) => (/1080|hd$|fhd/.test(r) && !/qhd|uhd/.test(r) ? '1080p' : /1440|qhd|2k/.test(r) ? '1440p' : '4K');
const resolucoesDe = (p) => [...p.matchAll(RE_RES)].map((m) => ({ res: mapaRes(m[1]), ini: m.index }));
const resolucaoDe = (t) => resolucoesDe(plano(t))[0]?.res || null;

function rtDe(t) {
  const p = plano(t);
  if (/\b(raster\w*|sem rt|rt off|no rt|without rt|sem ray ?tracing)\b/.test(p)) return false;
  if (/\b(ray ?tracing|path ?tracing|rt on|com rt|rt)\b/.test(p)) return true;
  return null;
}

// teste sintético mede outra coisa: fica fora da conta de jogos
const RE_SINTETICO = /\b(3d ?mark|time ?spy|port royal|speed ?way|fire ?strike|steel nomad|passmark|g3d ?mark|geekbench|userbenchmark|opencl|vulkan score|blender|cinebench)\b/;
const ehSintetico = (t) => RE_SINTETICO.test(plano(t));

// linha de ficha técnica / preço numa tabela não é resultado de jogo
const RE_ROTULO_FICHA = /\b(cuda|cores?|nucleos|memory|memoria|vram|bus|barramento|tdp|tgp|power|consumo|clock|mhz|ghz|gb|bits?|price|preco|msrp|shaders?|rops|tmus|cache|bandwidth|transistors|die|launch|lancamento|release|watts?)\b/;
const RE_ROTULO_MEDIA = /^(average|avg|overall|geomean|geometric mean|media|media geral|total|relative performance|desempenho relativo|resultado|result)s?$/;

// Jogos comuns em review de placa (chave normalizada → nome exibido).
const JOGOS = [
  'Cyberpunk 2077', 'Alan Wake 2', 'Black Myth: Wukong', 'Hogwarts Legacy', 'Red Dead Redemption 2', 'Starfield',
  "Baldur's Gate 3", 'Counter-Strike 2', 'CS2', 'Fortnite', 'Forza Horizon 5', 'F1 24', 'F1 25', 'Horizon Forbidden West',
  'The Last of Us Part I', 'Microsoft Flight Simulator', 'Indiana Jones and the Great Circle', 'Stalker 2',
  'Space Marine 2', "Dragon's Dogma 2", 'Avatar: Frontiers of Pandora', 'Spider-Man 2', 'God of War Ragnarok',
  'Ghost of Tsushima', 'Doom: The Dark Ages', 'Monster Hunter Wilds', 'Kingdom Come: Deliverance II', 'Valorant',
  'Apex Legends', 'Elden Ring', 'Resident Evil 4', 'Star Wars Outlaws', 'Marvel Rivals', 'Battlefield 6',
  'Battlefield 2042', 'Dying Light 2', 'Far Cry 6', 'Metro Exodus', 'Shadow of the Tomb Raider', 'A Plague Tale: Requiem',
  'Rainbow Six Siege', "Assassin's Creed Shadows", "Assassin's Creed Mirage", 'Call of Duty: Black Ops 6', 'Warzone',
  'PUBG', 'Dota 2', 'League of Legends', 'Minecraft', 'GTA V', 'Final Fantasy XVI', 'Silent Hill 2', 'Hellblade 2',
].map((nome) => ({ nome, chave: ` ${plano(nome).replace(/[^a-z0-9]+/g, ' ').trim()} ` }));

const jogoConhecido = (t) => {
  const p = ` ${plano(t).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return JOGOS.find((j) => p.includes(j.chave))?.nome || null;
};

// ---------------------------------------------------------------- menções

// Qualquer placa citada (RTX/GTX/RX/Arc + número, ou número com sufixo).
// Serve pra perceber quando o número é de uma TERCEIRA placa ("RTX 5070").
const RE_GPU = /\b(?:(?:geforce\s)?(?:rtx|gtx)|(?:radeon\s)?rx|arc)\s?[a-z]?\d{3,5}(?:[\s-]?(?:ti|super|xtx|xt|gre))?\b|\b\d{4}[\s-]?(?:ti|super|xtx|xt|gre)\b/g;
const RE_GPU_1 = new RegExp(RE_GPU.source); // sem /g: .test() sem estado

/** Regras de um produto: o `re` dado + reserva pelo número do modelo ("5070 ti" / "5080", nunca "5070" sozinho). */
function regrasDoProduto(p) {
  const regras = [];
  if (p?.re instanceof RegExp) regras.push(new RegExp(p.re.source, 'gi'));
  const m = /(\d{3,5})\s?(ti|super|xtx|xt|gre)?\b/i.exec(p?.nome || '');
  if (m) {
    const suf = (m[2] || '').toLowerCase();
    regras.push(new RegExp(`\\b${m[1]}${suf ? `[\\s-]?${suf}\\b` : '(?![\\s-]?(?:ti|super|xtx?|gre)\\b)\\b'}`, 'gi'));
  }
  return regras;
}

/** Menções em ordem: lado 0 = A, 1 = B, -1 = outra placa. Texto já `plano`. */
function mencoes(p, regras) {
  const achadas = [];
  regras.forEach((rs, lado) => {
    for (const re of rs) {
      for (const m of p.matchAll(re)) {
        const fim = m.index + m[0].length;
        // "5070 Ti Super" não é "5070 Ti": sufixo a mais depois da menção
        if (/^[\s-]?(super|xtx|xt)\b/.test(p.slice(fim))) continue;
        achadas.push({ lado, ini: m.index, fim });
      }
    }
  });
  for (const m of p.matchAll(RE_GPU)) {
    const ini = m.index;
    const fim = ini + m[0].length;
    if (!achadas.some((a) => a.ini < fim && ini < a.fim)) achadas.push({ lado: -1, ini, fim });
  }
  achadas.sort((a, b) => a.ini - b.ini || b.fim - a.fim);
  return achadas.filter((a, i, v) => !v.slice(0, i).some((b) => a.ini < b.fim));
}

// ---------------------------------------------------------------- frases

const MAIS = 'faster|quicker|better|higher|ahead|leads?|lead of|advantage|outperforms?|beats?|more (?:fps|frames|performance|perf)|mais rapid[ao]s?|mais veloz(?:es)?|superior|a frente|melhor|mais desempenho|mais fps|vantagem|supera';
const MENOS = 'slower|lower|behind|worse|trails?|lags?|less (?:fps|frames|performance)|mais lent[ao]s?|atras|inferior|pior|menos desempenho|menos fps|perde';
const DIR = `\\b(?:(${MAIS})|(${MENOS}))\\b`;
const RE_DIR_DEPOIS = new RegExp(`^\\s*(?:(?:on average|em media|na media|overall|no geral)\\s*,?\\s*)?${DIR}`);
const RE_DIR_ANTES = new RegExp(`${DIR}[^%]{0,40}?\\b(?:by|of|em|por|de)\\s*(?:around|about|roughly|approximately|cerca de|aproximadamente|quase|~)?\\s*$`);
const RE_PCT = /\b(?:(\d{1,3}(?:[.,]\d)?)\s?(?:-|–|to|a)\s?)?(\d{1,3}(?:[.,]\d{1,2})?)\s?(?:%|percent\b|por cento\b)/g;
const RE_NAO_DESEMPENHO = /\b(price|priced|cost\w*|preco|custa\w*|caro|cara|expensive|power|consum\w*|energia|watts?|tdp|clocks?|cores|nucleos|vram|memor\w*|bandwidth|banda|cuda)\b/;
// menção precedida disso é o OBJETO da comparação ("mais rápida que a 5070 Ti")
const RE_CONECTOR = /\b(?:than|que|over|vs\.?|versus|against|contra|ante|compared (?:to|with)|comparad[ao]s? (?:a|com|ao)|em relacao (?:a|ao)|frente (?:a|ao))\s+(?:(?:the|a|o|as|os)\s+)?(?:(?:nvidia|geforce|rtx|gtx|radeon|rx)\s+)*$/;

/** "x%" dito do sujeito → quanto B é mais rápido que A (%). */
function converter(x, sujeito, maisRapido) {
  const f = x / 100;
  if (sujeito === 1) return maisRapido ? x : -x;
  return maisRapido ? (1 / (1 + f) - 1) * 100 : (1 / (1 - f) - 1) * 100;
}

function frasesDaLinha(linha) {
  return linha
    .split(/(?<![Vv][Ss]\.)(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“(])/)
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter((f) => f.length >= 8);
}

/** Linha "de título" nas 6 anteriores (curta, sem ponto final, não é linha de tabela). */
function titulosAntes(linhas, i, limite = 6) {
  const out = [];
  for (let j = i - 1, vistas = 0; j >= 0 && vistas < limite; j--) {
    const l = linhas[j].trim();
    if (!l) continue;
    vistas += 1;
    // linha com 2+ números (fora placa e resolução) é dado, não título; "Cyberpunk 2077" é título
    const numeros = plano(l).replace(RE_GPU, ' ').replace(RE_RES, ' ').match(/\b\d[\d.,]*\b/g) || [];
    if (l.length <= 80 && !/\.$/.test(l) && !/[|\t]/.test(l) && numeros.length < 2) out.push(l);
  }
  return out;
}

const doContexto = (titulos, fn, titulo) => {
  for (const t of titulos) {
    const v = fn(t);
    if (v != null) return v;
  }
  return titulo ? fn(titulo) : null;
};

/** Jogo da frase: lista conhecida, ou "Nome do Jogo at 1440p:" / "Nome do Jogo:" no começo. */
function jogoDaFrase(frase, titulos) {
  const conhecido = jogoConhecido(frase);
  if (conhecido) return conhecido;
  const m =
    /^(?:(?:in|no|na|em)\s+)?([A-Z][\w'’\- ]{2,40}?)\s(?:at|em|@)\s(?:1080p|1440p|2160p|4K|QHD|UHD|Full HD)\b/.exec(frase) ||
    /^([A-Z][\w'’\- ]{2,40}?)\s?(?:\((?:1080p|1440p|2160p|4K)\))?:/.exec(frase);
  const rotulo = m?.[1]?.trim();
  const valido = rotulo && !RE_GPU_1.test(plano(rotulo)) && !/\b\d{4}\b/.test(rotulo) && !ehSintetico(rotulo) &&
    !/^(result|resultado|conclus|verdict|veredito|performance|desempenho|benchmark|summary|resumo|average|media)/.test(plano(rotulo));
  return valido ? rotulo : titulos.slice(0, 3).map(jogoConhecido).find(Boolean) || null;
}

const resMaisPerto = (p, pos) =>
  resolucoesDe(p).sort((a, b) => Math.abs(a.ini - pos) - Math.abs(b.ini - pos))[0]?.res || null;

/** Pares de FPS na mesma frase: "RTX 5070 Ti 98 FPS vs RTX 5080 113 FPS". */
function paresDaFrase(frase, p, ms, sintetico, temFps) {
  const RE_NUM = /\b(\d{1,3}(?:[.,]\d{3})+|\d{1,5}(?:[.,]\d{1,2})?)\s?(fps|frames?|quadros|points|pontos|pts|score)?\b/g;
  const nums = [];
  for (const m of p.matchAll(RE_NUM)) {
    const ini = m.index;
    if (ms.some((x) => ini >= x.ini && ini < x.fim)) continue; // número do modelo
    const unidade = m[2] ? (/^(fps|frame|quadros)/.test(m[2]) ? 'fps' : 'pontos') : null;
    const depois = p.slice(ini + m[0].length);
    if (/^\s?(gb|mb|bits?|w\b|watts?|mhz|ghz|%|cuda|tflops|x\b|mm)/.test(depois) || /(?:\$|r\$)\s?$/.test(p.slice(0, ini))) continue;
    // número sem unidade só vale colado na menção ("RTX 5070 Ti: 98 | RTX 5080: 113")
    const colado = ms.find((x) => x.fim <= ini && /^[\s:=–(-]{0,3}$/.test(p.slice(x.fim, ini)));
    if (!unidade && !(colado && (temFps || sintetico))) continue;
    if (unidade === 'pontos' && !sintetico) continue;
    nums.push({ valor: numero(m[1]), ini, unidade: unidade || (sintetico ? 'pontos' : 'fps'), colado });
  }
  if (nums.length < 2) return [];
  const antesDeTudo = nums[0].ini < ms[0].ini; // "98 FPS for the RTX 5070 Ti" → dono vem depois
  const lados = [[], []];
  for (const n of nums) {
    const dono = n.colado || (antesDeTudo ? ms.find((x) => x.ini > n.ini) : [...ms].reverse().find((x) => x.fim <= n.ini));
    if (dono && dono.lado >= 0) lados[dono.lado].push(n);
  }
  if (!lados[0].length || lados[0].length !== lados[1].length) return [];
  return lados[0].map((a, k) => [a, lados[1][k]]);
}

function itensDaFrase(frase, titulos, base, regras, titulo) {
  const p = plano(frase);
  const ms = mencoes(p, regras);
  if (!ms.some((m) => m.lado === 0) || !ms.some((m) => m.lado === 1)) return []; // só um produto: não compara
  const sintetico = ehSintetico(frase) || (titulos[0] ? ehSintetico(titulos[0]) : false);
  const rt = rtDe(frase) ?? doContexto(titulos.slice(0, 1), rtDe);
  const temFps = /\b(fps|frames?|quadros)\b/.test(p) || titulos.some((t) => /\b(fps|frames?)\b/i.test(t));
  const jogo = sintetico ? null : jogoDaFrase(frase, titulos);
  const comum = (pos) => ({
    ...base, jogo, resolucao: resMaisPerto(p, pos) || doContexto(titulos, resolucaoDe, titulo), rt, sintetico, trecho: frase.slice(0, 240),
  });
  const itens = [];

  for (const [a, b] of paresDaFrase(frase, p, ms, sintetico, temFps)) {
    const faixa = sintetico ? [1, 1e6] : [5, 1000];
    if ([a.valor, b.valor].some((v) => !(v >= faixa[0] && v <= faixa[1]))) continue;
    if (a.valor === b.valor && !(a.unidade === 'fps' && b.unidade === 'fps' && !a.colado)) continue;
    const percentual = r1((b.valor / a.valor - 1) * 100);
    if (Math.abs(percentual) > 150) continue;
    itens.push({ tipo: 'par', ...comum(Math.min(a.ini, b.ini)), valorA: a.valor, valorB: b.valor, unidade: a.unidade, percentual });
  }
  if (itens.length) return itens; // o "(15% faster)" da mesma frase seria o mesmo dado contado duas vezes

  let fimAnterior = 0;
  for (const m of p.matchAll(RE_PCT)) {
    const ini = m.index;
    const fim = ini + m[0].length;
    const antes = p.slice(Math.max(fimAnterior, ini - 60), ini);
    const prox = p.slice(fim).search(/\d{1,3}(?:[.,]\d+)?\s?%/);
    const depois = p.slice(fim, prox >= 0 ? fim + prox : fim + 50);
    fimAnterior = fim;
    const x = m[1] ? (numero(m[1]) + numero(m[2])) / 2 : numero(m[2]);
    if (!(x >= 0.5 && x <= 150)) continue;
    if (/\b(up to|as much as|ate|chega a|chegando a)\s*$/.test(antes)) continue; // pico, não média
    if (RE_NAO_DESEMPENHO.test(antes.slice(-25))) continue; // "o consumo ... é 20% superior"
    let dir = RE_DIR_DEPOIS.exec(depois);
    let posDir = dir ? fim + dir.index : -1;
    if (dir && RE_NAO_DESEMPENHO.test(depois.slice(dir.index + dir[0].length).match(/^\s*(?:\w+\s+)?\w+/)?.[0] || '')) continue;
    if (!dir) {
      dir = RE_DIR_ANTES.exec(antes);
      posDir = dir ? ini - antes.length + dir.index : -1;
    }
    if (!dir) continue;
    // sujeito: menção mais perto ANTES da palavra de direção que não seja objeto de outra comparação
    const sujeito = ms
      .filter((s) => s.fim <= posDir)
      .reverse()
      .find((s) => !RE_CONECTOR.test(p.slice(Math.max(0, s.ini - 40), s.ini)));
    if (!sujeito || sujeito.lado < 0) continue;
    const objeto = ms.find((s) => s.ini > posDir);
    if (objeto && objeto.lado !== 1 - sujeito.lado) continue; // "45% faster than the RTX 5070": outra placa
    const percentual = r1(converter(x, sujeito.lado, Boolean(dir[1])));
    itens.push({ tipo: 'percentual', ...comum(ini), percentual, unidade: '%' });
  }
  return itens;
}

// ---------------------------------------------------------------- tabelas

const dividir = (linha, modo) => {
  const cel = linha.split(modo === 'pipe' ? '|' : '\t').map((c) => c.trim());
  if (modo === 'pipe') {
    if (cel[0] === '') cel.shift();
    if (cel[cel.length - 1] === '') cel.pop();
  }
  return cel;
};
const RE_CELULA = /^(\d{1,3}(?:[.,]\d{3})+|\d{1,5}(?:[.,]\d{1,2})?)\s*(fps|pts|points|pontos)?$/i;

/** Cabeçalho com os dois produtos como colunas e nenhum outro número. */
function cabecalhoDeTabela(linha, regras) {
  if (linha.length > 240 || /%/.test(linha)) return null;
  const p = plano(linha);
  const ms = mencoes(p, regras);
  if (!ms.some((m) => m.lado === 0) || !ms.some((m) => m.lado === 1)) return null;
  let resto = p;
  for (const m of ms) resto = resto.slice(0, m.ini) + ' '.repeat(m.fim - m.ini) + resto.slice(m.fim);
  resto = resto.replace(RE_RES, ' ').replace(/\b(rtx|gtx|rx|geforce|radeon|nvidia|fps)\b/g, ' ');
  if (/\d/.test(resto)) return null;
  const modo = linha.includes('|') ? 'pipe' : linha.includes('\t') ? 'tab' : 'espaco';
  if (modo === 'espaco') {
    // frase tipo "RTX 5070 Ti vs RTX 5080: qual comprar?" não é cabeçalho
    if (/[?:]|\b(vs|versus|or|ou|and|e|which|qual)\b/.test(resto) || resto.trim().split(/\s+/).filter(Boolean).length > 4) return null;
    return { modo, linha, colunas: ms.map((m) => m.lado) };
  }
  const celulas = dividir(linha, modo);
  const lados = celulas.map((c) => {
    const mm = mencoes(plano(c), regras);
    return mm.length === 1 ? mm[0].lado : null;
  });
  if (!lados.includes(0) || !lados.includes(1)) return null;
  return { modo, linha, nCelulas: celulas.length, iA: lados.indexOf(0), iB: lados.indexOf(1), colunas: lados.filter((l) => l !== null) };
}

/** Linha da tabela → { rotulo, a, b } ou null. */
function lerLinha(linha, cab) {
  if (cab.modo !== 'espaco' && (linha.includes('|') || linha.includes('\t'))) {
    const cel = dividir(linha, linha.includes('|') ? 'pipe' : 'tab');
    const rotulo = cel.find((c) => c && !RE_CELULA.test(c)) || '';
    if (cel.length === cab.nCelulas && RE_CELULA.test(cel[cab.iA]) && RE_CELULA.test(cel[cab.iB])) {
      return { rotulo, a: numero(RE_CELULA.exec(cel[cab.iA])[1]), b: numero(RE_CELULA.exec(cel[cab.iB])[1]) };
    }
    const nums = cel.filter((c) => RE_CELULA.test(c)).map((c) => numero(RE_CELULA.exec(c)[1]));
    if (nums.length !== cab.colunas.length) return null;
    return { rotulo, a: nums[cab.colunas.indexOf(0)], b: nums[cab.colunas.indexOf(1)] };
  }
  // separado por espaço: os últimos N números são as colunas; o resto é o rótulo
  const tokens = linha.trim().split(/\s+/);
  const nums = [];
  let k = tokens.length - 1;
  for (; k >= 0; k--) {
    if (/^(fps|pts|points|pontos)$/i.test(tokens[k])) continue;
    const m = RE_CELULA.exec(tokens[k]);
    if (!m) break;
    nums.unshift({ v: numero(m[1]), t: tokens[k] });
  }
  const n = cab.colunas.length;
  if (nums.length < n) return null;
  const sobra = nums.slice(0, nums.length - n);
  const rotulo = tokens.slice(0, k + 1).concat(sobra.map((s) => s.t)).join(' ');
  // número a mais só se for parte do nome ("Cyberpunk 2077", "Alan Wake 2"), não uma coluna a mais
  if (sobra.length && !(jogoConhecido(rotulo) || sobra.every((s) => s.v < 5 || s.v > 1000))) return null;
  const cols = nums.slice(-n).map((s) => s.v);
  return { rotulo, a: cols[cab.colunas.indexOf(0)], b: cols[cab.colunas.indexOf(1)] };
}

function lerTabela(linhas, i, cab, base, titulo) {
  const titulos = titulosAntes(linhas, i);
  const itens = [];
  let j = i + 1;
  for (; j < linhas.length && j <= i + 80; j++) {
    const l = linhas[j];
    if (/^[\s|:\-–]+$/.test(l) && l.includes('-')) continue; // |---|---:|
    if (!l.trim() || !/\d/.test(l)) break;
    if (RE_GPU_1.test(plano(l)) || l.length > 150) break; // voltou a ser texto corrido
    const r = lerLinha(l, cab);
    if (!r) continue;
    const rot = plano(r.rotulo).replace(/\(.*?\)|\bfps\b/g, ' ').trim();
    if (RE_ROTULO_FICHA.test(rot)) continue;
    const sintetico = ehSintetico(r.rotulo) || ehSintetico(cab.linha) || (titulos[0] ? ehSintetico(titulos[0]) : false);
    const faixa = sintetico ? [1, 1e6] : [5, 1000];
    if (![r.a, r.b].every((v) => v >= faixa[0] && v <= faixa[1])) continue;
    const temFps = /\bfps|frames\b/i.test(`${cab.linha} ${titulos.join(' ')}`);
    if (r.a === r.b && !temFps) continue;
    const percentual = r1((r.b / r.a - 1) * 100);
    if (Math.abs(percentual) > 150) continue;
    const soResolucao = rot.replace(RE_RES, '').trim() === '';
    const jogo = sintetico || RE_ROTULO_MEDIA.test(rot)
      ? null
      : soResolucao
        ? titulos.slice(0, 3).map(jogoConhecido).find(Boolean) || null
        : jogoConhecido(r.rotulo) || r.rotulo.replace(/\s*\((?:1080p|1440p|2160p|4k)\)\s*/i, '').trim().slice(0, 60) || null;
    itens.push({
      tipo: 'par', ...base, jogo,
      resolucao: resolucaoDe(r.rotulo) || resolucaoDe(cab.linha) || doContexto(titulos, resolucaoDe, titulo),
      rt: rtDe(r.rotulo) ?? rtDe(cab.linha) ?? doContexto(titulos.slice(0, 1), rtDe),
      sintetico, valorA: r.a, valorB: r.b, unidade: sintetico ? 'pontos' : 'fps', percentual,
      trecho: `${l.trim()} [tabela: ${cab.linha.trim()}]`.slice(0, 240),
    });
  }
  return { itens, fim: j - 1 };
}

// ---------------------------------------------------------------- API

/**
 * Resultados de desempenho A × B numa página. `produtos` = [A, B] na ordem
 * do pedido ({nome, re}); `percentual` de cada item = quanto B é mais rápido
 * que A, em %. Frase que cita só um dos dois nunca vira item.
 */
function extrairBenchmarks({ texto, url = '', titulo = '', produtos } = {}) {
  if (!texto || !Array.isArray(produtos) || produtos.length < 2) return [];
  const [pA, pB] = produtos;
  const regras = [regrasDoProduto(pA), regrasDoProduto(pB)];
  const base = { produtoA: pA.nome, produtoB: pB.nome, url };
  const linhas = String(texto).split(/\r?\n/);
  const itens = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    const cab = cabecalhoDeTabela(linha, regras);
    if (cab) {
      const t = lerTabela(linhas, i, cab, base, titulo);
      itens.push(...t.itens);
      i = t.fim;
      continue;
    }
    if (!/\d/.test(linha)) continue;
    const titulos = titulosAntes(linhas, i);
    for (const frase of frasesDaLinha(linha)) itens.push(...itensDaFrase(frase, titulos, base, regras, titulo));
  }
  return itens;
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

function resumo(itens) {
  if (!itens.length) return null;
  const ps = itens.map((i) => i.percentual);
  return { mediana: r1(mediana(ps)), min: r1(Math.min(...ps)), max: r1(Math.max(...ps)), n: itens.length, fontes: new Set(itens.map((i) => i.url || '')).size };
}

/**
 * Agrega os itens (de várias páginas). Mediana, não média. Fora da curva:
 * com 5+ resultados de jogo, sai quem se afasta da mediana mais de 3× o
 * desvio absoluto mediano (MAD; piso de 2 pontos percentuais — com
 * resultados muito parecidos o MAD fica perto de zero e um resultado com
 * RT, legítimo e 3 pontos acima, cairia junto com o número absurdo).
 */
const unicos = (lista, chave) => [...new Map(lista.map((i) => [chave(i), i])).values()];

function agregarBenchmarks(itens, { produtoA, produtoB } = {}) {
  // a mesma página repetindo o mesmo número (introdução e conclusão) conta uma vez
  const validos = unicos(
    (itens || []).filter((i) => i && Number.isFinite(i.percentual)),
    (i) => [i.tipo, i.url, i.jogo, i.resolucao, i.rt, i.sintetico, i.percentual, i.valorA, i.valorB].join('|')
  );
  let jogos = validos.filter((i) => !i.sintetico);
  let descartados = 0;
  if (jogos.length >= 5) {
    const m = mediana(jogos.map((i) => i.percentual));
    const mad = Math.max(mediana(jogos.map((i) => Math.abs(i.percentual - m))), 2);
    const antes = jogos.length;
    jogos = jogos.filter((i) => Math.abs(i.percentual - m) <= 3 * mad);
    descartados = antes - jogos.length;
  }
  const porRes = (r) => resumo(jogos.filter((i) => i.resolucao === r));
  const listaJogos = unicos(jogos.filter((i) => i.tipo === 'par'), (i) => `${i.jogo}|${i.resolucao}|${i.url}`)
    .slice(0, 20)
    .map(({ jogo, resolucao, rt, valorA, valorB, percentual, url }) => ({ jogo, resolucao, rt, valorA, valorB, percentual, url }));
  return {
    produtoA: produtoA || validos[0]?.produtoA || 'A',
    produtoB: produtoB || validos[0]?.produtoB || 'B',
    porResolucao: { '1080p': porRes('1080p'), '1440p': porRes('1440p'), '4K': porRes('4K'), geral: resumo(jogos) },
    sinteticos: resumo(validos.filter((i) => i.sintetico)),
    jogos: listaJogos,
    fontes: new Set(jogos.map((i) => i.url || '')).size,
    itens: jogos.length,
    descartados,
  };
}

const num = (x) => String(r1(x)).replace('.', ',');
const sinal = (x) => `${x > 0 ? '+' : ''}${num(x)}%`;
const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Texto pro redator; '' quando não há nenhum resultado de jogo. */
function blocoDoComparativo(ag) {
  const g = ag?.porResolucao?.geral;
  if (!g) return '';
  const { produtoA: A, produtoB: B } = ag;
  const faixa = g.min === g.max ? '' : g.min < 0 ? `; faixa ${sinal(g.min)} a ${sinal(g.max)}` : `; faixa ${num(g.min)}% a ${num(g.max)}%`;
  const base = `mediana de ${qtd(g.n, 'resultado', 'resultados')} de ${qtd(g.fontes, 'fonte', 'fontes')}${faixa}`;
  const linhas = ['DESEMPENHO MEDIDO PELO CÓDIGO (não recalcule; use estes números):'];
  linhas.push(
    Math.abs(g.mediana) < 1
      ? `- Em jogos, a ${B} e a ${A} ficam praticamente empatadas (diferença mediana de ${sinal(g.mediana)}; ${base}).`
      : `- Em jogos, a ${B} é em média ${num(Math.abs(g.mediana))}% ${g.mediana > 0 ? 'mais rápida' : 'mais lenta'} que a ${A} (${base}).`
  );
  const res = ['1080p', '1440p', '4K']
    .filter((r) => ag.porResolucao[r])
    .map((r) => {
      const x = ag.porResolucao[r];
      return `${r}: ${sinal(x.mediana)} (${qtd(x.n, 'resultado', 'resultados')}, ${qtd(x.fontes, 'fonte', 'fontes')})`;
    });
  if (res.length) linhas.push(`- ${res.join(' · ')}`);
  if (ag.sinteticos) linhas.push(`- Testes sintéticos (3DMark etc.) — só como complemento: ${sinal(ag.sinteticos.mediana)}.`);
  if (g.n < 3) linhas.push('- Poucos resultados medidos: trate como indicação, não como média confiável.');
  if (ag.descartados) linhas.push(`- ${qtd(ag.descartados, 'resultado fora da curva ficou fora', 'resultados fora da curva ficaram fora')} da conta (longe da mediana mais de 3× o desvio típico).`);
  if (ag.jogos?.length) {
    linhas.push('JOGOS MEDIDOS:', `| Jogo | Resolução | ${A} | ${B} | Diferença |`, '|---|---|---:|---:|---:|');
    for (const j of ag.jogos) {
      linhas.push(`| ${j.jogo || '—'} | ${(j.resolucao || '—') + (j.rt ? ' · RT' : '')} | ${num(j.valorA)} | ${num(j.valorB)} | ${sinal(j.percentual)} |`);
    }
  }
  linhas.push(`MÉTODO: diferença = FPS da ${B} ÷ FPS da ${A} − 1; mediana dos resultados de jogos; teste sintético não entra na conta.`);
  return linhas.join('\n');
}

/** Item → formato do livro de evidências (evidencias.js). */
const paraEvidencia = (i) => ({
  tipo: 'benchmark', produtoA: i.produtoA, produtoB: i.produtoB,
  valor: i.tipo === 'par' ? i.valorA : i.percentual, valorB: i.tipo === 'par' ? i.valorB : null, unidade: i.unidade,
  condicoes: { jogo: i.jogo, resolucao: i.resolucao, rt: i.rt, sintetico: i.sintetico, percentual: i.percentual },
  url: i.url, trecho: i.trecho, origem: 'comparativo-de-desempenho',
});

// ---------------------------------------------------------------- ficha técnica

const FICHA = {
  cuda: [/\b(\d{1,2}[.,]?\d{3})\s*(?:nvidia\s+)?(?:cuda(?:\s*(?:cores?|nucleos))?|nucleos\s+cuda)/, /(?:cuda\s*(?:cores?)?|nucleos\s+cuda)\s*[:\-]?\s*(\d{1,2}[.,]?\d{3})/],
  vram: [/(\d{1,2})\s?gb\s*(?:(?:de|of)\s+)?(?:memoria\s+)?(?:gddr\dx?|hbm\d?e?)/, /(?:memory size|vram|memoria(?: de video)?)\s*[:\-]?\s*(?:de\s+)?(\d{1,2})\s?gb\b/],
  tipoMemoria: [/\b(gddr\dx?|hbm\d?e?)\b/],
  barramento: [/(?:memory bus(?: width)?|bus width|barramento(?: de memoria)?)\s*[:\-]?\s*(?:de\s+)?(\d{2,4})[\s-]?bits?\b/, /\b(\d{2,4})[\s-]?bits?\b/],
  tdp: [/(?:tdp|tgp|tbp|total graphics power|total board power|board power|power consumption|power draw|consumo(?: maximo)?)\s*[:\-]?\s*(?:(?:de|of)\s+)?(?:ate\s+)?(\d{2,4})\s?w(?:atts?)?\b/, /\b(\d{2,4})\s?w(?:atts?)?\s*(?:de\s+)?(?:tdp|tgp|tbp)\b/],
  boostMhz: [/boost(?:\s+clock)?\s*[:\-]?\s*(?:(?:de|of)\s+)?(?:ate\s+)?(\d{3,4})\s?mhz/, /\b(\d{3,4})\s?mhz\s*\(?\s*boost/, /boost(?:\s+clock)?\s*[:\-]?\s*(?:(?:de|of)\s+)?(?:ate\s+)?(\d[.,]\d{1,3})\s?ghz/, /\b(\d[.,]\d{1,3})\s?ghz\s*(?:de\s+)?\(?\s*boost/],
};
const LIMITES = { cuda: [256, 30000], vram: [1, 128], barramento: [32, 8192], tdp: [30, 1500], boostMhz: [500, 4000] };

function valorDaFicha(campo, bruto) {
  if (campo === 'tipoMemoria') return bruto.toUpperCase();
  let v = /[.,]\d{3}$/.test(bruto) ? Number(bruto.replace(/[.,]/g, '')) : Number(bruto.replace(',', '.'));
  if (campo === 'boostMhz' && v < 10) v = Math.round(v * 1000); // GHz → MHz
  const [min, max] = LIMITES[campo];
  return v >= min && v <= max ? v : null;
}

/**
 * Ficha técnica de um produto: prefere o valor até ~220 caracteres depois
 * de uma menção dele (cortando na próxima placa citada); sem isso, a
 * primeira ocorrência da página. {} quando não acha nada.
 */
function extrairFicha({ texto, produto } = {}) {
  const p = plano(texto);
  if (!p.trim()) return {};
  const prod = typeof produto === 'string' ? produtosDoPedido(produto)[0] || { nome: produto } : produto || {};
  const regras = [regrasDoProduto(prod), []];
  const ms = mencoes(p, regras);
  const janelas = ms
    .filter((m) => m.lado === 0)
    .map((m) => {
      const outra = ms.find((o) => o.ini >= m.fim && o.lado !== 0);
      return p.slice(m.fim, Math.min(m.fim + 220, outra ? outra.ini : Infinity));
    });
  const ficha = {};
  for (const [campo, res] of Object.entries(FICHA)) {
    for (const trecho of [...janelas, p]) {
      const achado = res.map((re) => re.exec(trecho)).find(Boolean);
      const v = achado ? valorDaFicha(campo, achado[1]) : null;
      if (v != null) {
        ficha[campo] = v;
        break;
      }
    }
  }
  return ficha;
}

/** Pedido de comparação de desempenho entre 2+ produtos nomeados? */
function ehPedidoDeDesempenho(objetivo) {
  const t = plano(objetivo);
  if (!t.trim() || ehPedidoDeSerieDePrecos(objetivo) || produtosDoPedido(objetivo).length < 2) return false;
  // revisão (achado do revisor): "iPhone 15 vs Galaxy S24" caía aqui e ganhava
  // busca de FPS 1440p/4K e ficha CUDA — o modo é de placa de vídeo/processador
  const hardware =
    produtosDoPedido(objetivo).every((p) => RE_GPU_1.test(plano(p.nome)) || /^\d{4}\b/.test(plano(p.nome))) ||
    /\b(placas? de video|gpus?|processador(es)?|cpus?|ryzen|core i\d|radeon|geforce)\b/.test(t);
  if (!hardware) return false;
  const desempenho = /\b(desempenho|performance|benchmarks?|fps|mais rapid\w*|mais forte|mais potente|faster|slower|roda melhor|compar\w*|vs|versus|vale a pena trocar|upgrade|diferenca)\b/;
  if (/\b(prec\w*|price|custa\w*|custo|barat\w*|caro|cara)\b/.test(t) && !/\b(desempenho|performance|fps|benchmarks?|mais rapid\w*|custo[- ]beneficio)\b/.test(t)) return false;
  return desempenho.test(t) || /\bquanto\b.{0,60}\bmais\b/.test(t) || /\bqual\b.{0,40}\b(melhor|mais rapid\w*)\b/.test(t) || /\bou\b.{0,60}\bqual\b/.test(t);
}

module.exports = {
  extrairBenchmarks,
  agregarBenchmarks,
  blocoDoComparativo,
  extrairFicha,
  ehPedidoDeDesempenho,
  paraEvidencia,
};
