'use strict';

/**
 * Modo "dado de uso" (Etapa G da revisão v2, 2026-09-28).
 *
 * 14º teste real, 2ª pergunta: "Qual o fone de ouvido mais usado pelos
 * profissionais 'e-sports' no PUBG de PC?". Não é "qual o melhor" — é uma
 * CONTAGEM (jogador → equipamento → quantos usam cada modelo). O pedido caiu
 * no laço genérico, buscou "melhores headsets para PUBG" (outra pergunta),
 * rodou 36 passos e respondeu com preço e estrelas inventados.
 *
 * Aqui: buscas nas bases de equipamento de profissionais (pro settings,
 * listas de gear, páginas de jogador), e o CÓDIGO extrai "jogador → produto"
 * de tabelas e frases, conta por jogador distinto e lê frases de porcentagem
 * ("27% of pros use the HyperX Cloud II"). Sem base com números, a resposta
 * diz isso — e não troca a pergunta por "o melhor".
 */

const semAcento = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const normalizar = (t) => semAcento(t).replace(/[^a-z0-9%]+/g, ' ').trim();

const PEDIDO_DE_USO =
  /\b(mais usad[oa]s?|mais utilizad[oa]s?|mais popular(es)?|mais comuns?|usad[oa]s? pel[oa]s? (pros?|profissionais|jogadores|players)|que (os )?(pros?|profissionais|jogadores) (usam|utilizam)|o que (os )?(pros?|profissionais|jogadores) (usam|utilizam)|quantos? (%|por cento|jogadores|pros?|profissionais)|maioria (dos|das) (jogadores|pros?|profissionais)|most used|most popular|what do pros use|pros use)\b/;

/** Pedido de dado de uso ("mais usado pelos profissionais", "quantos % usam")? */
function ehPedidoDeUsoProfissional(objetivo) {
  const t = semAcento(objetivo);
  const quem = /\b(pros?|profissionais|profissional|e-?sports?|jogadores|players|streamers?|competitiv\w*)\b/.test(t);
  // "qual mouse os pros de valorant usam?"
  const usam = /\b(pros?|profissionais|jogadores|players)\b(\s+\w+){0,3}\s+(usam|utilizam|use|usa)\b/.test(t);
  return quem && (PEDIDO_DE_USO.test(t) || usam);
}

// equipamento pedido → rótulo e regex da coluna na tabela de "pro settings"
const EQUIPAMENTOS = [
  { nome: 'Headset/fone', pedido: /\b(fones?|headsets?|headphones?|earphones?|iems?|intra\w*|audio|audio)\b/, coluna: /\b(headsets?|headphones?|fones?|earphones?|iems?|audio)\b/ },
  { nome: 'Mouse', pedido: /\b(mouses?|mice)\b/, coluna: /\b(mouses?|mice)\b/ },
  { nome: 'Teclado', pedido: /\b(teclados?|keyboards?)\b/, coluna: /\b(teclados?|keyboards?)\b/ },
  { nome: 'Monitor', pedido: /\bmonitor(es)?\b/, coluna: /\bmonitor(s|es)?\b/ },
  { nome: 'Mousepad', pedido: /\bmouse ?pads?\b/, coluna: /\bmouse ?pads?\b/ },
];
function equipamentoDoPedido(objetivo) {
  const t = semAcento(objetivo);
  return EQUIPAMENTOS.find((e) => e.pedido.test(t)) || { nome: 'Equipamento', pedido: /$^/, coluna: COLUNA_DO_EQUIPAMENTO };
}

// cabeçalho de coluna do equipamento, por categoria
const COLUNA_DO_EQUIPAMENTO = /\b(headsets?|headphones?|fones?|earphones?|iems?|audio|áudio|mouse|mice|teclado|keyboard|monitor|mousepad)\b/;
const COLUNA_DO_JOGADOR = /\b(player|jogador|name|nome|pro|nick)\b/;

// nome de produto: marca conhecida de periférico + até 5 palavras
const MARCAS =
  'hyperx|logitech|logi|razer|steelseries|sennheiser|epos|beyerdynamic|audio-technica|audio technica|astro|corsair|zowie|benq|asus|rog|hyperx|jbl|sony|samsung|shure|moondrop|truthear|kz|simgot|7hz|tin hifi|fnatic|turtle beach|cooler master|redragon|havit|philips|akg|audeze|drop|fiio|final|campfire|westone|kingston|superlight|wooting|pulsar|finalmouse|vaxee|lamzu|endgame gear|glorious|alienware|msi|gigabyte|aoc|viewsonic';
const RE_PRODUTO = new RegExp(`\\b((?:${MARCAS})(?:[\\s-]+[A-Za-z0-9][\\w+.-]*){0,5})`, 'i');

function limparProduto(bruto) {
  let t = String(bruto || '')
    .replace(/\s*[|(\[].*$/, '')
    .replace(/\s+(is|are|é|são|was|with|com|by|por|and|e|ou|or|at|em|no|na|for|para|in|the|headset|headphones)\b.*$/i, '')
    .replace(/[.,;:!]+$/, '')
    .trim();
  const partes = t.split(/\s+/).slice(0, 6);
  t = partes.join(' ');
  return t.length >= 3 ? t : '';
}

/** Chave de produto pra contar: "HyperX Cloud II" = "hyperx cloud ii" = "HyperX Cloud 2". */
function chaveDoProduto(nome) {
  return normalizar(nome).replace(/\bii\b/g, '2').replace(/\biii\b/g, '3').replace(/\blogi\b/, 'logitech');
}

function celulas(linha) {
  if (/\|/.test(linha)) return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  if (/\t/.test(linha)) return linha.split('\t').map((c) => c.trim());
  return null;
}

/**
 * Extrai de uma página: pares jogador → produto (tabela com coluna de
 * jogador e de equipamento; página de UM jogador com "Headset: X") e frases
 * de porcentagem/contagem ("27% of pros use X", "X — 14 players").
 */
function extrairUsoProfissional({ texto, url = '', titulo = '', coluna = COLUNA_DO_EQUIPAMENTO }) {
  const pares = [];
  const percentuais = [];
  const linhas = String(texto || '').split('\n');

  // 1. tabelas (pipe ou tab) com coluna de jogador e de equipamento
  for (let i = 0; i < linhas.length; i += 1) {
    const cab = celulas(linhas[i]);
    if (!cab || cab.length < 2) continue;
    // cabeçalho não tem nome de produto (achado do revisor: a linha "| Kickstart
    // | Oxygen | Logitech G Pro … | Audio-Technica … |" virava cabeçalho)
    if (cab.some((c) => RE_PRODUTO.test(c))) continue;
    const iJog = cab.findIndex((c) => COLUNA_DO_JOGADOR.test(semAcento(c)));
    const iEq = cab.findIndex((c) => coluna.test(semAcento(c)));
    if (iJog < 0 || iEq < 0 || iJog === iEq) continue;
    for (let j = i + 1; j < linhas.length; j += 1) {
      const row = celulas(linhas[j]);
      if (!row) break;
      if (row.every((c) => /^[\s:-]*$/.test(c))) continue; // separador
      const jogador = (row[iJog] || '').replace(/\*/g, '').trim();
      const produto = limparProduto(row[iEq]);
      if (jogador && produto && !/^(-|n\/a|unknown|desconhecido)$/i.test(produto)) {
        pares.push({ jogador, produto, url, trecho: linhas[j].trim().slice(0, 200) });
      }
      i = j; // a tabela foi consumida: as linhas dela não viram cabeçalho de novo
    }
  }

  // 2. página de um jogador: "Headset: HyperX Cloud II" + título com o nome
  const doTitulo = /^([\w.-]{2,20})\b.*\b(settings|setup|gear|config|equipamento|periféricos|perifericos)\b/i.exec(String(titulo));
  if (doTitulo) {
    for (const l of linhas) {
      const m = /^\s*([A-Za-zÀ-ÿ ]{3,20})\s*[:\-–]\s*(.+)$/i.exec(l);
      if (m && coluna.test(semAcento(m[1]))) {
        const produto = limparProduto(m[2]);
        if (produto) pares.push({ jogador: doTitulo[1], produto, url, trecho: l.trim().slice(0, 200) });
      }
    }
  }

  // 3. frases de porcentagem / contagem
  const frases = String(texto || '').split(/(?<=[.!?])\s+|\n+/);
  for (const f of frases) {
    const n = semAcento(f);
    if (!/\b(pros?|players|jogadores|profissionais|professional)\b/.test(n) && !/\b(most used|mais usad|popular)\b/.test(n)) continue;
    // a frase tem de ser do equipamento pedido (headset, não "38% usam o G Pro X Superlight" mouse)
    if (!coluna.test(n)) continue;
    const prod = RE_PRODUTO.exec(f);
    if (!prod) continue;
    const produto = limparProduto(prod[1]);
    if (!produto) continue;
    const pct = /(\d{1,3}(?:[.,]\d)?)\s?%/.exec(f);
    const qtd = /\b(\d{1,3})\s+(?:of the\s+)?(?:pros|players|jogadores|profissionais)\b/i.exec(f);
    if (pct) percentuais.push({ produto, valor: Number(pct[1].replace(',', '.')), unidade: '%', url, trecho: f.trim().slice(0, 240) });
    else if (qtd) percentuais.push({ produto, valor: Number(qtd[1]), unidade: 'jogadores', url, trecho: f.trim().slice(0, 240) });
  }
  return { pares, percentuais };
}

/**
 * Conta por jogador DISTINTO (o mesmo jogador em duas bases conta uma vez) e
 * junta as porcentagens por produto (a maior base primeiro).
 */
function agregarUso(extraidos) {
  const jogadores = new Map(); // jogador → produto (o primeiro visto)
  const fontes = new Set();
  for (const { pares } of extraidos) {
    for (const p of pares) {
      const j = normalizar(p.jogador);
      if (!j || jogadores.has(j)) continue;
      jogadores.set(j, p);
      if (p.url) fontes.add(p.url);
    }
  }
  const porProduto = new Map();
  for (const p of jogadores.values()) {
    const k = chaveDoProduto(p.produto);
    const atual = porProduto.get(k) || { produto: p.produto, jogadores: 0, fontes: new Set(), exemplos: [] };
    atual.jogadores += 1;
    if (p.url) atual.fontes.add(p.url);
    if (atual.exemplos.length < 3) atual.exemplos.push(p.jogador);
    porProduto.set(k, atual);
  }
  const total = jogadores.size;
  const ranking = [...porProduto.values()]
    .map((r) => ({ produto: r.produto, jogadores: r.jogadores, parcela: total ? Math.round((r.jogadores / total) * 1000) / 10 : 0, fontes: r.fontes.size, exemplos: r.exemplos }))
    .sort((a, b) => b.jogadores - a.jogadores);
  const declarados = new Map();
  for (const { percentuais } of extraidos) {
    for (const p of percentuais) {
      const k = chaveDoProduto(p.produto);
      const atual = declarados.get(k) || { produto: p.produto, valores: [] };
      atual.valores.push({ valor: p.valor, unidade: p.unidade, url: p.url, trecho: p.trecho });
      declarados.set(k, atual);
    }
  }
  return { total, fontes: fontes.size, ranking, declarados: [...declarados.values()] };
}

const pct = (v) => `${String(v).replace('.', ',')}%`;

/** Bloco pro redator — números contados pelo código. '' quando não achou nada. */
function blocoDoUso(agregado, { equipamento = 'fone', jogo = '' } = {}) {
  const linhas = [];
  if (agregado.total >= 3) {
    linhas.push(`USO ENTRE PROFISSIONAIS${jogo ? ` DE ${jogo.toUpperCase()}` : ''} (contado pelo código; ${agregado.total} jogadores distintos listados em ${agregado.fontes} fonte(s)):`);
    linhas.push(`| ${equipamento} | Jogadores | Parcela dos listados | Exemplos |`, '|---|---:|---:|---|');
    for (const r of agregado.ranking.slice(0, 10)) linhas.push(`| ${r.produto} | ${r.jogadores} | ${pct(r.parcela)} | ${r.exemplos.join(', ')} |`);
  }
  if (agregado.declarados.length) {
    linhas.push('', 'PORCENTAGENS/CONTAGENS DECLARADAS NAS FONTES (citar com a fonte; não somar entre fontes):');
    for (const d of agregado.declarados.slice(0, 8)) {
      for (const v of d.valores.slice(0, 2)) linhas.push(`- ${d.produto}: ${v.unidade === '%' ? pct(v.valor) : `${v.valor} jogadores`} — "${v.trecho}" (${v.url})`);
    }
  }
  if (!linhas.length) return '';
  linhas.push(
    '',
    'RESSALVAS (diga na resposta): a contagem vale para os jogadores LISTADOS nessas bases, não para todos os profissionais; patrocínio do time influencia o equipamento; em campeonato presencial a organização costuma padronizar o equipamento de áudio.'
  );
  return linhas.join('\n');
}

module.exports = { equipamentoDoPedido, ehPedidoDeUsoProfissional, extrairUsoProfissional, agregarUso, blocoDoUso, chaveDoProduto, limparProduto };
