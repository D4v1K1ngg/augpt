'use strict';

/**
 * Série de preços: Evidência → Dados → Análise (2026-09-27).
 *
 * Origem: 10º teste real ("analise o histórico de preços da RTX 5070 Ti
 * desde o lançamento junto da RTX 5080 ... média de preço ... gráfico") e a
 * "autópsia" que o Davi pediu ao ChatGPT. O agente leu páginas com preço e
 * data, mas quem transformou isso em resposta foi o modelo de cabeça:
 * "Preço médio: R$ 8.499,99 a R$ 9.599,99" (um intervalo chamado de média),
 * "mais de $1.000 (R$ 1.000 a R$ 1.200)" (câmbio impossível), nenhuma data
 * por preço, nenhum gráfico.
 *
 * Aqui o CÓDIGO faz a parte numérica, sem chamada de modelo:
 *   1. evidência: frases das páginas lidas que têm produto do pedido + preço;
 *   2. dados: observação {produto, mês, preço, moeda, fonte, trecho} — a data
 *      vem da própria frase ou, sem ela, da data de publicação da página;
 *   3. análise: menor preço observado por mês (método A, dito na resposta),
 *      média aritmética das observações, N e período — por moeda, nunca
 *      misturando real com dólar;
 *   4. saída: bloco "DADOS CALCULADOS" pro redator (com a instrução de usar
 *      exatamente esses números) e o gráfico no formato ```chart de sempre.
 * Toda observação guarda o trecho e a URL — dá pra auditar cada ponto.
 */

const MESES = {
  jan: 1, janeiro: 1, january: 1, fev: 2, fevereiro: 2, feb: 2, february: 2, mar: 3, marco: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4, mai: 5, maio: 5, may: 5, jun: 6, junho: 6, june: 6,
  jul: 7, julho: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8, set: 9, setembro: 9, sep: 9, sept: 9, september: 9,
  out: 10, outubro: 10, oct: 10, october: 10, nov: 11, novembro: 11, november: 11, dez: 12, dezembro: 12, dec: 12, december: 12,
};

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Pedido de histórico/evolução/média de preço ao longo do tempo? */
function ehPedidoDeSerieDePrecos(objetivo) {
  const t = semAcento(objetivo).toLowerCase();
  return (
    /\b(historic\w*|evolucao|variacao|media)\b.{0,60}\bprecos?\b/.test(t) ||
    /\bprecos?\b.{0,60}\b(desde|ao longo|historic\w*|evolucao|variacao|media)\b/.test(t) ||
    /\bprice history\b/.test(t)
  );
}

// "RTX 5070 Ti", "RX 9070 XT", "iPhone 15 Pro", "Galaxy S24 Ultra"
const RE_PRODUTO = /\b([A-Za-z][A-Za-z]{1,12}\s?)?([A-Za-z]?\d{2,5}[A-Za-z]?)(\s?(?:ti|super|xt|xtx|pro|max|plus|ultra|mini))?\b/gi;
const NAO_PRODUTO = /^(19|20)\d\d$/;

/**
 * Produtos que o pedido nomeia, cada um com a regra de casamento: o número
 * do modelo + o sufixo ("5070 ti"). Modelo sem sufixo não casa com a versão
 * com sufixo ("5080" não pega "5080 super"; "5070" não pega "5070 ti").
 */
function produtosDoPedido(objetivo) {
  const vistos = new Map();
  // sem acento antes do padrão: o \b do JavaScript não entende "ú" ("últimos 12" virava "ltimos 12")
  for (const m of semAcento(objetivo).matchAll(RE_PRODUTO)) {
    const modelo = m[2];
    if (NAO_PRODUTO.test(modelo)) continue;
    // "5070 Ti ou 5080": conectivo de comparação não é nome de linha (virava "OU 5080")
    const prefixo = (m[1] || '').trim().replace(/^(ou|or|vs|versus|x)$/i, '');
    if (prefixo && /^(de|do|da|dos|das|em|at[eé]|no|na|e|a|o|os|as|ate|dia|dias|hoje|desde|entre|top|mes|meses|ano|anos|por|com|para|pra)$/i.test(prefixo)) continue;
    // número de 2 dígitos só com nome de linha na frente ("iPhone 15"), nunca solto
    if (/^\d{2}$/.test(modelo) && !/[A-Z]/.test(prefixo)) continue;
    const sufixo = (m[3] || '').trim().toLowerCase();
    const chave = `${modelo.toLowerCase()}${sufixo ? ` ${sufixo}` : ''}`;
    if (vistos.has(chave)) continue;
    const SUFIXO = { ti: 'Ti', xt: 'XT', xtx: 'XTX', super: 'Super', pro: 'Pro', max: 'Max', plus: 'Plus', ultra: 'Ultra', mini: 'mini' };
    const exibido = [prefixo.toUpperCase() === prefixo || prefixo.length <= 3 ? prefixo.toUpperCase() : prefixo, modelo, SUFIXO[sufixo] || '']
      .filter(Boolean)
      .join(' ');
    const re = new RegExp(`\\b${modelo.toLowerCase()}${sufixo ? `\\s?${sufixo}` : '(?!\\s?(?:ti|super|xtx?|pro|max|plus|ultra|mini)\\b)'}\\b`, 'i');
    vistos.set(chave, { nome: exibido, re });
  }
  return [...vistos.values()].slice(0, 4);
}

/** "8.499,99" / "1,000" / "749" / "1.299" → número (convenção pt-BR e en). */
function valorNumerico(texto, moeda) {
  const t = String(texto).trim();
  if (/,\d{2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/\.\d{2}$/.test(t) && moeda === 'USD') return Number(t.replace(/,/g, ''));
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  return Number(t.replace(',', '.'));
}

// preço: R$ 8.499,99 · US$ 749 · $1,000 · 749 dólares · 8499 reais
const RE_PRECO = /(\d+\s?x\s?(?:de\s)?)?(R\$|US\$|U\$|\$|USD|BRL)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)|(\d{1,3}(?:[.,]\d{3})+(?:,\d{2})?|\d{3,6})\s?(reais|d[oó]lares)/gi;
const FAIXA = { BRL: [150, 150000], USD: [30, 30000] };

function precosDaFrase(frase) {
  const achados = [];
  for (const m of frase.matchAll(RE_PRECO)) {
    if (m[1]) continue; // "12x de R$ 700" é parcela, não preço
    const simbolo = (m[2] || m[5] || '').toLowerCase();
    const moeda = /r\$|brl|reais/.test(simbolo) ? 'BRL' : 'USD';
    const valor = valorNumerico(m[3] || m[4], moeda);
    const [min, max] = FAIXA[moeda];
    if (!Number.isFinite(valor) || valor < min || valor > max) continue;
    achados.push({ valor, moeda, indice: m.index });
  }
  return achados;
}

/** Data da frase ("jan/2025", "janeiro de 2025", "15/03/2025", "2025-03") → "AAAA-MM". */
function mesDaFrase(frase) {
  const t = semAcento(frase).toLowerCase();
  let m = /\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[3]}-${m[2].padStart(2, '0')}`;
  m = /\b(20\d\d)-(\d{2})(?:-\d{2})?\b/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  m = /\b([a-z]{3,9})\.?(?:\s+de|\/|\s)\s*(20\d\d)\b/.exec(t);
  if (m && MESES[m[1]]) return `${m[2]}-${String(MESES[m[1]]).padStart(2, '0')}`;
  // "Oct 3, 2026" / "Jan 29, 2025" (páginas em inglês, revisão v5)
  m = /\b([a-z]{3,9})\.?\s+\d{1,2},?\s+(20\d\d)\b/.exec(t);
  if (m && MESES[m[1]]) return `${m[2]}-${String(MESES[m[1]]).padStart(2, '0')}`;
  return null;
}

/** Data de publicação da página (vários formatos) → "AAAA-MM". */
function mesDaPagina(data) {
  if (!data) return null;
  const s = String(data);
  const iso = /\b(20\d\d)-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return mesDaFrase(s);
}

function frasesDe(texto) {
  return String(texto || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter((f) => f.length >= 12 && f.length <= 600);
}

const dominioDe = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Observações de preço nas páginas lidas. Cada preço vai pro produto citado
 * mais perto ANTES dele na frase (ou o único citado). Frase sem data usa a
 * data de publicação da página; sem nenhuma das duas, o preço não entra na
 * série (conta em `semData`).
 */
/**
 * Loja ou agregador de preço (revisão v5, 08/10/2026): o preço que aparece
 * ali é o de HOJE. A data de publicação dessas páginas é a do cadastro do
 * produto — no teste da RTX 5080 um preço lido na loja entrou como
 * "dez/2024", dois meses antes do lançamento da placa.
 */
const LOJAS_E_AGREGADORES = /(^|\.)(kabum|pichau|terabyteshop|terabyte|amazon|mercadolivre|mercadolibre|magazineluiza|magalu|shopee|aliexpress|casasbahia|americanas|submarino|carrefour|fastshop|pontofrio|girafa|gkinfostore|ciapc|waz|guerradigital|patoloco|hardwarebarato|gpuprix|buscape|zoom|promobit|pelando|placasdevideo|siliconcomps|pcpartpicker|bestvaluegpu)\./i;

function ehLojaOuAgregador(fonte) {
  return Boolean(fonte?.listagem) || LOJAS_E_AGREGADORES.test(dominioDe(fonte?.url || '') + '.');
}

/**
 * O preço é uma ESTATÍSTICA de período ("mínimo em 12 meses", "mediana de 3
 * meses", "média dos últimos 30 dias")? Então não é o preço daquele mês e
 * não entra na série — vai para as estatísticas da página (revisão v5).
 */
function ehContextoDeEstatistica(ctxBaixo) {
  return /(median|\bmedia\b|average|\bavg\b|minimo|menor preco|lowest|\blow\b|maximo|maior preco|highest|tipico|typical)[^.]{0,40}\d{1,3}\s*-?\s*(dias|dia|days|day|meses|mes|months|month)\b|\d{1,3}\s*-?\s*(days?|months?)\s*(low|median|average|high)|\b(median|mediana)\b/.test(ctxBaixo);
}

function extrairObservacoes(fontes, produtos, { hoje = null } = {}) {
  const obs = [];
  let semData = 0;
  const vistos = new Set();
  const limite = hoje ? String(hoje).slice(0, 7) : null;
  for (const f of fontes || []) {
    const texto = f.textoCompleto || f.texto || '';
    // loja/agregador: preço sem data na frase é o de hoje (ou da "última atualização" que a página informa)
    const mesPagina = ehLojaOuAgregador(f) ? atualizadoEm(texto) || limite : mesDaPagina(f.data);
    for (const frase of frasesDe(texto)) {
      const precos = precosDaFrase(frase);
      if (!precos.length) continue;
      const mencoes = [];
      for (const p of produtos) {
        for (const m of frase.matchAll(new RegExp(p.re.source, 'gi'))) mencoes.push({ produto: p.nome, indice: m.index });
      }
      if (!mencoes.length) continue;
      const mes = mesDaFrase(frase) || mesPagina;
      const fraseBaixa = semAcento(frase).toLowerCase();
      const daFamilia = mencoesDeModelo(fraseBaixa, produtos);
      for (const preco of precos) {
        if (ehContextoDeEstatistica(fraseBaixa.slice(Math.max(0, preco.indice - 70), preco.indice))) continue;
        // "a RTX 5070 Ti custa R$ 5.999 e a RTX 5080, R$ 8.999": preço depois de
        // outro modelo (ou antes de qualquer menção, numa frase que cita outro) não é do produto
        const ultimaDaFamilia = daFamilia.filter((m) => m.indice < preco.indice).pop();
        if (ultimaDaFamilia ? !ultimaDaFamilia.produto : daFamilia.some((m) => !m.produto)) continue;
        const antes = mencoes.filter((m) => m.indice < preco.indice).sort((a, b) => b.indice - a.indice)[0];
        const produto = antes?.produto || (new Set(mencoes.map((m) => m.produto)).size === 1 ? mencoes[0].produto : null);
        if (!produto) continue;
        if (!mes || (limite && mes > limite)) {
          semData += 1;
          continue;
        }
        const chave = `${produto}|${mes}|${preco.moeda}|${preco.valor}|${dominioDe(f.url)}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        obs.push({
          produto, mes, preco: preco.valor, moeda: preco.moeda,
          url: f.url || '', dominio: dominioDe(f.url), trecho: frase.slice(0, 240),
          dataDaFrase: Boolean(mesDaFrase(frase)),
          loja: ehLojaOuAgregador(f) && !mesDaFrase(frase),
        });
      }
    }
  }
  // Vitrine de loja/agregador lista dezenas de versões ao preço de hoje (40
  // linhas numa página do Hardware Barato): sem isto a "média" virava a média
  // das vitrines. Por página e mês, fica só o MENOR preço da página.
  const menorDaVitrine = new Map();
  for (const o of obs.filter((x) => x.loja)) {
    const chave = `${o.url}|${o.produto}|${o.mes}|${o.moeda}`;
    if (!menorDaVitrine.has(chave) || o.preco < menorDaVitrine.get(chave).preco) menorDaVitrine.set(chave, o);
  }
  const vitrines = new Set(menorDaVitrine.values());
  return { observacoes: obs.filter((o) => !o.loja || vitrines.has(o)), semData };
}

/** Data com dia ("7 de out. de 2026", "Oct 3, 2026", "26/09/2026", "2026-10-07") → "AAAA-MM-DD" (só pra ordenar). */
function diaDaFrase(frase) {
  const t = semAcento(frase).toLowerCase();
  const dois = (n) => String(n).padStart(2, '0');
  let m = /\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/.exec(t);
  if (m) return `${m[3]}-${dois(m[2])}-${dois(m[1])}`;
  m = /\b(20\d\d)-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2}) de ([a-z]{3,9})\.? de (20\d\d)\b/.exec(t);
  if (m && MESES[m[2]]) return `${m[3]}-${dois(MESES[m[2]])}-${dois(m[1])}`;
  m = /\b([a-z]{3,9})\.? (\d{1,2}),? (20\d\d)\b/.exec(t);
  if (m && MESES[m[1]]) return `${m[3]}-${dois(MESES[m[1]])}-${dois(m[2])}`;
  return null;
}

const RE_ATUALIZADO = /\b(atualizad[oa]s?(?: pela ultima vez)?(?: em)?|last updated|updated|precos verificados em|verificad[oa]s? em)\b[: ]{0,3}(.{0,30})/i;

/** "Atualizado pela última vez em 7 de out. de 2026", "Last updated Oct 3, 2026", "Preços verificados em 26/09/2026" → "AAAA-MM". */
function atualizadoEm(texto) {
  const m = RE_ATUALIZADO.exec(semAcento(texto).replace(/\s+/g, ' '));
  return m ? mesDaFrase(m[2]) : null;
}

function diaAtualizado(texto) {
  const m = RE_ATUALIZADO.exec(semAcento(texto).replace(/\s+/g, ' '));
  return m ? diaDaFrase(m[2]) : null;
}

/** "Lançamento fev. de 2025", "Released Jan 30, 2025" → "AAAA-MM". */
function lancamentoDaPagina(texto) {
  // "Jan 30th, 2025" (TechPowerUp) → "Jan 30, 2025"
  const t = semAcento(texto).replace(/\s+/g, ' ').replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');
  // só rótulo de lançamento ("Lançamento: fev. de 2025", "Release Date Jan 30,
  // 2025", "lançada em"); "released" solto pegava "NVIDIA released driver
  // 581.15 on Sep 9, 2026" e apagava a série inteira (revisão independente v5)
  const m = /\b(data de lancamento|lancamento|lancad[oa] (?:em|no dia)|release date|launch date|released on|launched on)\b[: ]{0,3}(.{0,30})/i.exec(t);
  return m ? mesDaFrase(m[2]) : null;
}

const FAMILIAS_CONCORRENTES = ['rtx', 'gtx', 'rx', 'arc', 'iphone', 'galaxy', 'pixel', 'redmi', 'poco', 'moto', 'xperia', 'ryzen'];
const SUFIXOS_DE_MODELO = '(?:ti|super|xtx|xt|gre|pro|max|plus|ultra|mini)';

/**
 * Menções a modelos da mesma família dos produtos do pedido no texto (já
 * sem acento e minúsculo): mesmo prefixo ("rtx", "iphone") e número com a
 * mesma quantidade de dígitos ("rtx 50" de "série RTX 50" não conta). Cada
 * menção diz de qual produto do pedido é, ou `produto: null` (outro modelo).
 */
function mencoesDeModelo(baixo, produtos) {
  const familias = new Map();
  for (const p of produtos) {
    const partes = semAcento(p.nome).toLowerCase().split(/\s+/);
    const numero = partes.find((x) => /\d/.test(x));
    if (!numero) continue;
    // o próprio prefixo + as famílias concorrentes mais comuns: comparação
    // "RTX 5080 vs RX 9070 XT" ou "iPhone 15 vs Galaxy S24" cruza marcas
    const proprio = /^[a-z]+$/.test(partes[0]) && partes[0] !== numero ? [partes[0]] : [];
    const prefixos = [...new Set([...proprio, ...FAMILIAS_CONCORRENTES])];
    const digitos = (numero.match(/\d/g) || []).length;
    for (const prefixo of prefixos) familias.set(`${prefixo}|${digitos}`, { prefixo, digitos });
  }
  const mencoes = [];
  for (const { prefixo, digitos } of familias.values()) {
    const re = new RegExp(`\\b${prefixo}\\s?-?[a-z]?\\d{${digitos}}[a-z]?(?:\\s?${SUFIXOS_DE_MODELO})?\\b`, 'gi');
    for (const m of baixo.matchAll(re)) {
      const dono = produtos.find((p) => new RegExp(`^(?:${p.re.source})`, 'i').test(m[0].replace(new RegExp(`^${prefixo}\\s?-?`), '')));
      mencoes.push({ indice: m.index, produto: dono ? dono.nome : null });
    }
  }
  return mencoes.sort((a, b) => a.indice - b.indice);
}

const MARCAS_DE_PLACA = /\b(asus|gigabyte|aorus|msi|zotac|palit|galax|gainward|inno3d|pny|xfx|sapphire|powercolor|asrock|evga|colorful|pcyes|afox|manli|biostar|maxsun|yeston)\b/i;

/**
 * Estatísticas que os sites de histórico já calculam (revisão v5): "mínimo
 * em 12 meses R$7,241", "Mediana de 3 meses", "Menor preço à vista R$
 * 10.319,14", "Média dos últimos 30 dias". O texto chega achatado (rótulo
 * numa linha, valor na outra), então o rótulo é procurado nos ~70
 * caracteres ANTES de cada preço, depois do preço anterior. Só vale em
 * página que é SOBRE um produto do pedido (título, endereço ou começo); se
 * o título traz marca de fabricante ("Gigabyte RTX 5080 Windforce"), a
 * página é de uma versão específica e fica marcada (`variante`) — não entra
 * no preço de referência nem na estimativa.
 */
function estatisticasDaPagina(fonte, produtos, { hoje = null } = {}) {
  const texto = String(fonte?.textoCompleto || fonte?.texto || '');
  if (!texto) return [];
  const cabeca = `${fonte.titulo || ''} ${fonte.url || ''} ${texto.slice(0, 300)}`.replace(/[-_/]+/g, ' ');
  const produto = produtos.find((p) => p.re.test(fonte.titulo || '') || p.re.test(String(fonte.url || '').replace(/[-_/]+/g, ' '))) ||
    (produtos.filter((p) => p.re.test(cabeca)).length === 1 ? produtos.find((p) => p.re.test(cabeca)) : null);
  if (!produto) return [];
  const titulo = String(fonte.titulo || texto.split('\n')[0] || '');
  const variante = MARCAS_DE_PLACA.test(titulo) ? titulo.split(/[:|—–]/)[0].trim().slice(0, 80) : null;
  // quebras de linha ficam: no texto achatado o rótulo de um preço ("Parcelado
  // em Loja B") encosta no rótulo do seguinte ("Média dos últimos 30 dias") e
  // a janela de 70 caracteres misturava os dois (a média era descartada como
  // "parcelado"). O rótulo é a linha do preço — ou a anterior, quando o preço
  // está sozinho na linha — a partir da última frase.
  const plano = texto.replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\s]*/g, '\n');
  const baixo = semAcento(plano).toLowerCase();
  const rotuloAntes = (inicio, fim) => {
    const linhas = baixo.slice(inicio, fim).split('\n');
    let rotulo = linhas.pop();
    if (!/[a-z]{3}/.test(rotulo) && linhas.length) rotulo = `${linhas.pop()} ${rotulo}`;
    return rotulo.split(/[.;!?]\s+(?=\S)/).pop();
  };
  // data da estatística: "atualizado em" da página; senão hoje (loja/agregador) ou a publicação (artigo)
  const mesHoje = hoje ? String(hoje).slice(0, 7) : null;
  const mes = atualizadoEm(texto) || (ehLojaOuAgregador(fonte) ? mesHoje : mesDaPagina(fonte.data) || mesHoje);
  // Produto de CADA preço: a última menção de modelo da mesma família antes
  // dele ("RTX 5070 Ti … R$ 5.999 … RTX 5080 … R$ 8.999"). Menção de outro
  // modelo (que não é do pedido) → o preço não é do produto e fica fora.
  // Sem menção antes, vale o produto da página (título/endereço).
  const mencoes = mencoesDeModelo(baixo, produtos);
  const achados = [];
  let fimDoAnterior = 0;
  for (const preco of precosDaFrase(plano)) {
    const ultima = mencoes.filter((m) => m.indice < preco.indice).pop();
    if (ultima && !ultima.produto) continue;
    const produtoDoPreco = ultima ? produtos.find((p) => p.nome === ultima.produto) : produto;
    const inicio = Math.max(fimDoAnterior, preco.indice - 70);
    const ctx = rotuloAntes(inicio, preco.indice);
    fimDoAnterior = preco.indice + 4;
    if (/parcelad|a partir de|\bx de\b|frete|cashback|msrp|preco sugerido/.test(ctx)) continue;
    const per = /(\d{1,3})\s*-?\s*(dias|dia|days|day|meses|mes|months|month)\b/.exec(ctx);
    const periodoDias = per ? Number(per[1]) * (/^m/.test(per[2]) ? 30 : 1) : null;
    let tipo = null;
    if (/median/.test(ctx)) tipo = 'mediana';
    else if (/\bmedia\b|average|\bavg\b/.test(ctx)) tipo = 'media';
    else if (/(menor preco|minimo|lowest|\blow\b)/.test(ctx)) tipo = periodoDias ? 'minimo' : /(atual|a vista|hoje|current|now|agora)/.test(ctx) ? 'atual' : null;
    else if (/(maior preco|maximo|highest|\bhigh\b)/.test(ctx) && periodoDias) tipo = 'maximo';
    else if (/(preco (de )?hoje|preco atual|current price)/.test(ctx)) tipo = 'atual';
    if (!tipo || ((tipo === 'mediana' || tipo === 'media') && !periodoDias && !/(atual|hoje)/.test(ctx))) continue;
    achados.push({
      produto: produtoDoPreco.nome, tipo, periodoDias, valor: preco.valor, moeda: preco.moeda, mes, dia: diaAtualizado(texto),
      url: fonte.url || '', dominio: dominioDe(fonte.url), variante,
      trecho: plano.slice(Math.max(0, preco.indice - 70), preco.indice + 20).replace(/\s+/g, ' ').trim(),
    });
  }
  // a mesma estatística repetida na página (resumo + tabela) conta uma vez
  const vistos = new Set();
  return achados.filter((a) => {
    const chave = `${a.tipo}|${a.periodoDias}|${a.valor}|${a.moeda}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

const mediana = (valores) => {
  const v = [...valores].sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
};

/**
 * Valores fora da faixa plausível do próprio produto: abaixo de 50% ou
 * acima de 250% da mediana de tudo que foi visto dele na mesma moeda (a
 * mesma regra que o GPUPrix aplica). Caso real: "Menor preço nos últimos
 * 90 dias: R$ 1.924,00" na página da RTX 5080 — é a mediana do eBay em
 * DÓLAR de outro site, colada como real.
 */
function separarForaDaFaixa(itens, valorDe = (i) => i.valor ?? i.preco, chaveDe = (i) => `${i.produto}|${i.moeda}`) {
  const grupos = new Map();
  for (const i of itens) {
    const chave = chaveDe(i);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(valorDe(i));
  }
  const ok = [];
  const fora = [];
  for (const i of itens) {
    const valores = grupos.get(chaveDe(i));
    const m = valores.length >= 3 ? mediana(valores) : null;
    const v = valorDe(i);
    if (m && (v < m * 0.5 || v > m * 2.5)) fora.push(i);
    else ok.push(i);
  }
  return { ok, fora };
}

/** Pedido de estimativa/previsão de preço (Black Friday, "quanto vai chegar")? */
function ehPedidoDeEstimativa(objetivo) {
  const t = semAcento(objetivo).toLowerCase();
  // a palavra de estimativa tem que falar de PREÇO ("estimativa de tempo de
  // entrega", "tendência de consumo", "data prevista de lançamento" não contam)
  if (/black ?friday|cyber ?monday|valor aproximado|preco aproximado/.test(t)) return true;
  if (/quanto\b.{0,40}\b(vai|pode|deve|iria|deveria|vao|podem|devem)\s(custar|chegar|cair|ficar|baixar)/.test(t)) return true;
  if (/\b(precos?|valor)\b\s(?:\S+\s){0,4}?(vai|pode|deve|tende a|tendem a|deveria) (cair|baixar|subir|chegar)/.test(t)) return true;
  const ESTIMATIVA = /\b(estimativ\w*|estim[ae]r?|estime|previs\w*|prevista|previsto|projec\w*|prever|tendencia)\b/;
  if (!ESTIMATIVA.test(t)) return false;
  // estimativa colada a outro assunto: só vale se, ainda assim, falar de preço logo depois
  const outroAssunto = /\b(entrega|frete|prazo|consumo|consome|energia|conta de luz|tempo de|chegada|lancamento|bateria|desempenho|fps)\b/.test(t);
  if (outroAssunto) return /\b(estimativ|previs|projec|prever|tendencia|estim)\w*\s(?:\S+\s){0,6}?(?:de |do |da |para o |pro )?(precos?|valor|custo)\b/.test(t) && !/\b(precos?|valor|custo)\b\s(?:do |da |de )?(frete|entrega|energia|consumo)/.test(t);
  return /\b(precos?|valor|custo|custar|custa|baixar|cair)\b/.test(t);
}

/**
 * Estimativa feita pelo CÓDIGO (revisão v5). No teste real o modelo
 * aplicou "20–30% de desconto típico" de cabeça em cima de uma média de
 * dois pontos. Aqui:
 *   - referência = menor preço ATUAL informado por página de histórico (da
 *     linha do produto, não de uma versão), senão o último mês da série;
 *   - com Black Friday anterior na série (nov com set/out do mesmo ano): a
 *     queda observada naquele ano, aplicada à referência (±3%);
 *   - senão: faixa entre a referência e o quanto o preço já caiu em 12
 *     meses (mediana → mínimo de 12 meses), limitada a 15% e nunca abaixo
 *     do mínimo de 12 meses — é hipótese, e o bloco diz isso.
 */
function estimar({ objetivo, analise, estatisticas, hoje }) {
  if (!ehPedidoDeEstimativa(objetivo)) return null;
  const blackFriday = /black ?friday|cyber ?monday/i.test(semAcento(objetivo));
  const resultados = [];
  const produtos = new Set([...(analise?.resumo || []).filter((r) => r.n).map((r) => r.produto), ...estatisticas.map((e) => e.produto)]);
  for (const produto of produtos) {
    const daLinha = estatisticas.filter((e) => e.produto === produto && !e.variante && e.moeda === 'BRL');
    const mesHoje = hoje ? String(hoje).slice(0, 7) : null;
    // "preço atual" de uma página antiga não é o de hoje: só vale do mês passado pra cá
    const atuais = daLinha.filter((e) => e.tipo === 'atual' && (!mesHoje || !e.mes || e.mes >= anterior(mesHoje)));
    const r = analise?.moeda === 'BRL' ? analise.resumo.find((x) => x.produto === produto && x.n) : null;
    let referencia = null;
    if (atuais.length) {
      const menor = atuais.reduce((a, b) => (b.valor < a.valor ? b : a));
      referencia = { valor: menor.valor, origem: `${menor.dominio} (menor preço atual)` };
    } else if (r) {
      const ultimo = r.ate;
      if (!mesHoje || ultimo >= anterior(mesHoje)) referencia = { valor: r.porMes[ultimo], origem: `série (${rotuloDoMes(ultimo)})` };
    }
    if (!referencia) {
      resultados.push({ produto, faixa: null, motivo: 'sem preço atual no material' });
      continue;
    }
    const longos = (tipo) => daLinha.filter((e) => e.tipo === tipo && (e.periodoDias || 0) >= 180);
    const min12 = longos('minimo').map((e) => e.valor).sort((a, b) => a - b)[0] ?? null;
    const med12 = longos('mediana').map((e) => e.valor)[0] ?? null;
    // Black Friday anterior na série: nov/AAAA contra a média de set e out do mesmo ano
    let quedaBF = null;
    if (blackFriday && r) {
      // novembro do ano corrente só conta depois que ele acabou (antes disso é
      // o preço de hoje, não a Black Friday)
      const anos = Object.keys(r.porMes)
        .filter((m) => m.endsWith('-11') && (!mesHoje || m < mesHoje))
        .map((m) => m.slice(0, 4))
        .sort()
        .reverse();
      for (const ano of anos) {
        const antes = [`${ano}-09`, `${ano}-10`].map((m) => r.porMes[m]).filter((v) => v != null);
        if (antes.length) {
          quedaBF = { ano, queda: r.porMes[`${ano}-11`] / (antes.reduce((a, b) => a + b, 0) / antes.length) - 1 };
          break;
        }
      }
    }
    const arred = (v) => Math.round(v / 10) * 10;
    if (quedaBF && quedaBF.queda < 0) {
      const centro = referencia.valor * (1 + quedaBF.queda);
      resultados.push({
        produto, referencia, quedaBF, faixa: [arred(centro * 0.97), arred(centro * 1.03)], centro: arred(centro),
        metodo: `queda observada na Black Friday de ${quedaBF.ano} (${(quedaBF.queda * 100).toFixed(1)}% em nov/${quedaBF.ano} contra set–out) aplicada ao preço de referência`,
      });
      continue;
    }
    const base = med12 || referencia.valor;
    const queda = min12 ? Math.min(0.15, Math.max(0, (base - min12) / base)) : 0;
    if (!queda) {
      resultados.push({ produto, referencia, faixa: null, motivo: 'sem mínimo de 12 meses nem Black Friday anterior no material — não há base para estimar a queda' });
      continue;
    }
    // referência já abaixo do mínimo de 12 meses (outro site, outro dia): o
    // piso não pode passar dela — a faixa saía invertida ("de 7.240 a 7.000")
    const piso = Math.min(referencia.valor, Math.max(min12, referencia.valor * (1 - queda)));
    if (arred(piso) >= arred(referencia.valor)) {
      resultados.push({ produto, referencia, faixa: null, motivo: `o preço de referência (${reais(referencia.valor, 'BRL')}) já está no mínimo de 12 meses ou abaixo dele — não há queda histórica para projetar` });
      continue;
    }
    resultados.push({
      produto, referencia, min12, med12, queda,
      faixa: [arred(piso), arred(referencia.valor)], centro: arred((piso + referencia.valor) / 2),
      metodo: `HIPÓTESE: o preço cai do valor de referência até, no máximo, o quanto já caiu em 12 meses (${med12 ? 'mediana' : 'referência'} → mínimo de 12 meses = ${(queda * 100).toFixed(0)}%${queda === 0.15 ? ', limitado a 15%' : ''}), sem passar do mínimo de 12 meses`,
    });
  }
  return { blackFriday, resultados };
}

function anterior(mes) {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

const reais = (v, moeda) =>
  moeda === 'BRL'
    ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `US$ ${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const rotuloDoMes = (mes) => {
  const [a, m] = mes.split('-');
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a}`;
};

/**
 * Análise: moeda principal (real, se houver 2+ observações em real; senão
 * dólar), menor preço por mês por produto, média de todas as observações
 * na moeda, N e período. Menos de 2 observações datadas → null (não há série).
 */
function analisar({ observacoes, semData }, produtos) {
  const porMoeda = (moeda) => observacoes.filter((o) => o.moeda === moeda);
  const moeda = porMoeda('BRL').length >= 2 ? 'BRL' : porMoeda('USD').length >= 2 ? 'USD' : null;
  if (!moeda) return null;
  const usadas = porMoeda(moeda);
  const outraMoeda = observacoes.length - usadas.length;
  const meses = [...new Set(usadas.map((o) => o.mes))].sort();
  const resumo = produtos
    .map((p) => {
      const dele = usadas.filter((o) => o.produto === p.nome);
      if (!dele.length) return { produto: p.nome, n: 0 };
      const porMes = {};
      for (const o of dele) porMes[o.mes] = Math.min(porMes[o.mes] ?? Infinity, o.preco);
      const media = dele.reduce((s, o) => s + o.preco, 0) / dele.length;
      const ms = Object.keys(porMes).sort();
      return {
        produto: p.nome, n: dele.length, media: Math.round(media * 100) / 100,
        minimo: Math.min(...dele.map((o) => o.preco)), maximo: Math.max(...dele.map((o) => o.preco)),
        de: ms[0], ate: ms[ms.length - 1], porMes,
      };
    });
  if (resumo.every((r) => !r.n)) return null;
  return { moeda, meses, resumo, usadas, outraMoeda, semData };
}

/** Bloco ```chart (mesmo formato de gerar_grafico): menor preço por mês de cada produto. */
function graficoDaSerie(analise) {
  const { meses, resumo, moeda } = analise;
  const spec = {
    type: 'line',
    title: `Menor preço observado por mês (${moeda === 'BRL' ? 'R$' : 'US$'})`,
    labels: meses.map(rotuloDoMes),
    datasets: resumo
      .filter((r) => r.n)
      .map((r) => ({ label: r.produto, data: meses.map((m) => (r.porMes[m] ?? null)) })),
  };
  return `\`\`\`chart\n${JSON.stringify(spec, null, 1)}\n\`\`\``;
}

/**
 * Texto do redator × série calculada (11/10, "RTX 5080 na Black Friday"): a
 * resposta dizia "janeiro de 2025: R$ 23.000" e o gráfico do código, logo
 * abaixo, 6.108. Linha que cita um mês da série com preço na moeda dela, sem
 * que nenhum bata (±2%) com um preço observado naquele mês, é contradição.
 */
function contradicoesComASerie(texto, analise) {
  if (!analise) return [];
  const achadas = [];
  for (const linha of String(texto || '').replace(/```[\s\S]*?```/g, '').split('\n')) {
    const mes = mesDaFrase(linha);
    if (!mes) continue;
    const observados = analise.usadas.filter((o) => o.mes === mes).map((o) => o.preco);
    const ditos = precosDaFrase(linha).filter((p) => p.moeda === analise.moeda).map((p) => p.valor);
    if (!observados.length || !ditos.length) continue;
    if (!ditos.some((d) => observados.some((o) => Math.abs(d - o) / o <= 0.02))) {
      achadas.push({
        tipo: 'serie',
        valor: linha.trim().slice(0, 100),
        detalhe: `nos dados calculados, ${rotuloDoMes(mes)} tem ${[...new Set(observados)].slice(0, 4).join(' / ')}`,
      });
    }
  }
  return achadas.slice(0, 4);
}

/** Texto pro redator: metodologia, tabela, médias e observações com fonte. */
function blocoParaRedator(analise) {
  const { moeda, meses, resumo, usadas, outraMoeda, semData } = analise;
  const nomes = resumo.filter((r) => r.n).map((r) => r.produto);
  const linhasTabela = meses.map(
    (m) => `| ${rotuloDoMes(m)} | ${resumo.filter((r) => r.n).map((r) => (r.porMes[m] != null ? reais(r.porMes[m], moeda) : '—')).join(' | ')} |`
  );
  const medias = resumo.map((r) =>
    r.n
      ? `- ${r.produto}: média ${reais(r.media, moeda)} (média aritmética de ${r.n} observação(ões), de ${rotuloDoMes(r.de)} a ${rotuloDoMes(r.ate)}; menor ${reais(r.minimo, moeda)}, maior ${reais(r.maximo, moeda)})`
      : `- ${r.produto}: nenhuma observação de preço com data no material — diga isso`
  );
  const fontes = usadas
    .slice(0, 24)
    .map((o) => `- ${rotuloDoMes(o.mes)} · ${o.produto} · ${reais(o.preco, moeda)} · ${o.dominio}${o.dataDaFrase ? '' : o.loja ? ' (preço do dia — loja/site de preço)' : ' (data da publicação)'}: "${o.trecho}"`);
  return [
    'DADOS CALCULADOS PELO CÓDIGO A PARTIR DAS PÁGINAS LIDAS (use EXATAMENTE estes números; não recalcule, não arredonde diferente, não invente mês que não está aqui):',
    `MÉTODO: cada preço citado junto do nome do produto, com a data da frase (ou, sem ela, a data de publicação da página; em loja ou site de preço, o dia em que a página foi lida — preço de hoje). Por mês, vale o MENOR preço observado. A média é a média aritmética de todas as observações em ${moeda === 'BRL' ? 'reais' : 'dólares'}. Diga esse método na resposta.`,
    `PERÍODO COM DADOS: ${rotuloDoMes(meses[0])} a ${rotuloDoMes(meses[meses.length - 1])} (${meses.length} mês(es), ${usadas.length} observação(ões)).`,
    meses.length < 6
      ? 'ATENÇÃO: poucos meses com dado — diga claramente que a série é parcial (não é um histórico completo desde o lançamento) e que a média vale só para os pontos encontrados.'
      : '',
    `TABELA (menor preço por mês):\n| Mês | ${nomes.join(' | ')} |\n|---|${nomes.map(() => '---').join('|')}|\n${linhasTabela.join('\n')}`,
    `MÉDIAS:\n${medias.join('\n')}`,
    outraMoeda ? `(${outraMoeda} preço(s) em outra moeda ficaram FORA da média — real e dólar não se misturam; se citar, cite separado e sem converter.)` : '',
    semData ? `(${semData} preço(s) sem data foram ignorados na série.)` : '',
    'O GRÁFICO desta série já foi montado e entra na resposta automaticamente — não descreva um gráfico que não existe nem crie outro com números diferentes.',
    `OBSERVAÇÕES (fonte de cada ponto):\n${fontes.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * O mesmo site em duas páginas (GPUPrix em português e em inglês, de dias
 * diferentes): por site + produto + versão + tipo + período fica a
 * estatística mais RECENTE. Estatística de versão específica só aparece
 * quando não há nenhuma da linha do produto (senão é ruído no bloco).
 */
function consolidarEstatisticas(lista) {
  const porChave = new Map();
  for (const e of lista) {
    const chave = `${e.dominio}|${e.produto}|${e.variante || ''}|${e.tipo}|${e.periodoDias || ''}|${e.moeda}`;
    const atual = porChave.get(chave);
    if (!atual || (e.dia || '') > (atual.dia || '')) porChave.set(chave, e);
  }
  const unicas = [...porChave.values()];
  const comLinha = new Set(unicas.filter((e) => !e.variante).map((e) => e.produto));
  return unicas.filter((e) => !e.variante || !comLinha.has(e.produto));
}

/** Bloco das estatísticas de página, descartes, lançamento e estimativa (revisão v5). */
function blocoDeHistorico({ estatisticas, descartados, lancamentos, estimativa, antesDoLancamento }) {
  const rotuloTipo = (e) => ({
    atual: 'menor preço atual',
    minimo: `mínimo ${e.periodoDias >= 360 ? 'de 12 meses' : e.periodoDias >= 28 && e.periodoDias % 30 === 0 ? `de ${e.periodoDias / 30} mes(es)` : `de ${e.periodoDias} dias`}`,
    mediana: `mediana ${e.periodoDias >= 360 ? 'de 12 meses' : e.periodoDias % 30 === 0 ? `de ${e.periodoDias / 30} mes(es)` : `de ${e.periodoDias} dias`}`,
    media: `média ${e.periodoDias ? (e.periodoDias % 30 === 0 && e.periodoDias >= 60 ? `de ${e.periodoDias / 30} meses` : `de ${e.periodoDias} dias`) : 'atual'}`,
    maximo: `máximo de ${e.periodoDias} dias`,
  })[e.tipo];
  const partes = [];
  if (estatisticas.length) {
    partes.push(
      `ESTATÍSTICAS DOS SITES DE HISTÓRICO (calculadas pelos próprios sites; cite o site):\n${estatisticas
        .slice(0, 20)
        .map((e) => `- ${e.produto}${e.variante ? ` — versão ${e.variante}` : ''} · ${rotuloTipo(e)}: ${reais(e.valor, e.moeda)} · ${e.dominio}${e.mes ? ` (dados de ${rotuloDoMes(e.mes)})` : ''}`)
        .join('\n')}`
    );
  }
  if (descartados.length) {
    partes.push(
      `DESCARTADOS por estarem fora da faixa plausível do produto (abaixo de 50% ou acima de 250% da mediana do que foi visto — quase sempre erro de coleta ou outra moeda; NÃO use):\n${descartados
        .slice(0, 8)
        .map((d) => `- ${reais(d.valor ?? d.preco, d.moeda)} · ${d.dominio}: "${String(d.trecho).slice(0, 120)}"`)
        .join('\n')}`
    );
  }
  for (const [produto, mes] of lancamentos) partes.push(`LANÇAMENTO de ${produto}: ${rotuloDoMes(mes)} — não existe preço de antes disso.`);
  if (antesDoLancamento) partes.push(`(${antesDoLancamento} preço(s) datado(s) antes do lançamento foram descartados da série.)`);
  if (estimativa) {
    const linhas = estimativa.resultados.map((r) =>
      r.faixa
        ? `- ${r.produto}: de ${reais(r.faixa[0], 'BRL')} a ${reais(r.faixa[1], 'BRL')} (centro ${reais(r.centro, 'BRL')}). Referência: ${reais(r.referencia.valor, 'BRL')} — ${r.referencia.origem}. Método: ${r.metodo}.`
        : `- ${r.produto}: sem estimativa — ${r.motivo}. Diga isso e mostre só o que existe (preço atual, mínimos).`
    );
    partes.push(
      `ESTIMATIVA ${estimativa.blackFriday ? 'PARA A BLACK FRIDAY ' : ''}CALCULADA PELO CÓDIGO (use estes números; não aplique desconto "típico" de cabeça, como 20–30%):\n${linhas.join('\n')}\n` +
        'Apresente como estimativa, não como garantia: diga o método em uma frase e que promoção pontual (cupom, loja específica) pode ficar fora da faixa.'
    );
  }
  return partes.join('\n\n');
}

/** Série de preços OU estimativa de preço ("quanto vai chegar na Black Friday"). */
function ehPedidoDeHistoricoOuEstimativa(objetivo) {
  return ehPedidoDeSerieDePrecos(objetivo) || (ehPedidoDeEstimativa(objetivo) && /\bprecos?\b|\bvalor\b|\bcust/.test(semAcento(objetivo).toLowerCase()));
}

/**
 * Tudo de uma vez: null quando não é pedido de série. Com a revisão v5 a
 * série pode não ter 2 meses e ainda assim haver o que entregar: as
 * estatísticas das páginas de histórico e a estimativa.
 */
function montarSerie({ objetivo, fontes, hoje = null }) {
  if (!ehPedidoDeHistoricoOuEstimativa(objetivo)) return null;
  const produtos = produtosDoPedido(objetivo);
  if (!produtos.length) return null;

  // lançamento informado pelas páginas (o mais antigo citado por produto)
  const lancamentos = new Map();
  for (const f of fontes || []) {
    const mes = lancamentoDaPagina(f.textoCompleto || f.texto || '');
    if (!mes) continue;
    const doTitulo = produtos.find((p) => p.re.test(`${f.titulo || ''} ${String(f.url || '').replace(/[-_/]+/g, ' ')}`));
    if (doTitulo && (!lancamentos.has(doTitulo.nome) || mes < lancamentos.get(doTitulo.nome))) lancamentos.set(doTitulo.nome, mes);
  }

  const extraido = extrairObservacoes(fontes, produtos, { hoje });
  // "lançamento" que apagaria metade ou mais da série é leitura errada (data de
  // outra coisa), não lançamento: fica de fora
  for (const [nome, mes] of [...lancamentos]) {
    const doProduto = extraido.observacoes.filter((o) => o.produto === nome);
    const apagaria = doProduto.filter((o) => o.mes < mes).length;
    if (apagaria >= 2 && apagaria * 2 >= doProduto.length) lancamentos.delete(nome);
  }
  const antes = extraido.observacoes.filter((o) => lancamentos.has(o.produto) && o.mes < lancamentos.get(o.produto));
  const datadas = extraido.observacoes.filter((o) => !antes.includes(o));
  const estatBrutas = consolidarEstatisticas((fontes || []).flatMap((f) => estatisticasDaPagina(f, produtos, { hoje })));

  // faixa plausível medida sobre TUDO (série + estatísticas), por produto e moeda
  const todos = [...datadas.map((o) => ({ ...o, valor: o.preco, origem: 'obs', ref: o })), ...estatBrutas.map((e) => ({ ...e, origem: 'est', ref: e }))];
  // Estatísticas: contra tudo do produto (o "R$ 1.924" do Hardware Barato).
  // Observações da série: só contra o MESMO mês — queda real ao longo dos anos
  // (R$ 12.999 em 2021 → R$ 3.999 em 2024) não é erro (revisão independente v5).
  const foraEst = separarForaDaFaixa(todos).fora.filter((i) => i.origem === 'est');
  const foraObs = separarForaDaFaixa(todos, undefined, (i) => `${i.produto}|${i.moeda}|${i.mes}`).fora.filter((i) => i.origem === 'obs');
  const fora = [...foraEst, ...foraObs];
  const foraRefs = new Set(fora.map((f) => f.ref));
  const observacoes = datadas.filter((o) => !foraRefs.has(o));
  const estatisticas = estatBrutas.filter((e) => !foraRefs.has(e));

  const analise = analisar({ observacoes, semData: extraido.semData }, produtos);
  const estimativa = estimar({ objetivo, analise, estatisticas, hoje });
  const historico = blocoDeHistorico({ estatisticas, descartados: fora, lancamentos: [...lancamentos], estimativa, antesDoLancamento: antes.length });
  if (!analise && !estatisticas.length) {
    return { produtos, observacoes: observacoes.length, analise: null, estatisticas, estimativa: null, descartados: fora.length, bloco: null };
  }
  const blocoSerie = analise ? blocoParaRedator(analise) : 'DADOS CALCULADOS PELO CÓDIGO A PARTIR DAS PÁGINAS LIDAS (use EXATAMENTE estes números):\nSÉRIE MENSAL: menos de 2 observações de preço com data — não há série mês a mês; use as estatísticas abaixo e diga que o histórico mês a mês não foi encontrado.';
  return {
    produtos,
    observacoes: analise ? analise.usadas.length : 0,
    analise,
    estatisticas,
    estimativa,
    descartados: fora.length,
    grafico: analise && analise.meses.length >= 2 ? graficoDaSerie(analise) : null,
    bloco: [blocoSerie, historico].filter(Boolean).join('\n\n'),
  };
}

/** Já há página de histórico (com estatísticas) lida para todos os produtos do pedido? */
function temPaginaDeHistorico(objetivo, fontes, hoje = null) {
  const produtos = produtosDoPedido(objetivo);
  if (!produtos.length) return true;
  const comEstat = new Set((fontes || []).flatMap((f) => estatisticasDaPagina(f, produtos, { hoje })).map((e) => e.produto));
  return produtos.every((p) => comEstat.has(p.nome));
}

module.exports = {
  ehPedidoDeSerieDePrecos,
  produtosDoPedido,
  precosDaFrase,
  mesDaFrase,
  extrairObservacoes,
  analisar,
  graficoDaSerie,
  contradicoesComASerie,
  blocoParaRedator,
  montarSerie,
  estatisticasDaPagina,
  consolidarEstatisticas,
  diaDaFrase,
  separarForaDaFaixa,
  ehPedidoDeEstimativa,
  ehPedidoDeHistoricoOuEstimativa,
  estimar,
  temPaginaDeHistorico,
  lancamentoDaPagina,
  atualizadoEm,
  ehLojaOuAgregador,
};
