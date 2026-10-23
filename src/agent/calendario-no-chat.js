'use strict';

/**
 * Calendário no chat (23/10, pedido do Davi): "que dia é hoje?", "quais feriados temos este mês?",
 * "quantos dias faltam pro Natal?", "que dia da semana cai 25/12/2027?", "mostre o calendário de
 * março". O código responde (sem modelo, sem internet) e põe um bloco ```calendario na resposta,
 * que a tela desenha como um calendário interativo (renderer/calendario.js).
 * Feriados: só os nacionais, calculados aqui (os móveis a partir da Páscoa).
 */

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (a, m, d) => new Date(a, m - 1, d, 12); // meio-dia: horário de verão não muda o dia
const somar = (d, n) => dia(d.getFullYear(), d.getMonth() + 1, d.getDate() + n);
const diasEntre = (a, b) => Math.round((dia(b.getFullYear(), b.getMonth() + 1, b.getDate()) - dia(a.getFullYear(), a.getMonth() + 1, a.getDate())) / 86400000);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return dia(ano, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
/** n-ésimo domingo do mês (Dia das Mães: 2º de maio; Dia dos Pais: 2º de agosto). */
const domingo = (ano, mes, n) => {
  const primeiro = dia(ano, mes, 1);
  return dia(ano, mes, 1 + ((7 - primeiro.getDay()) % 7) + 7 * (n - 1));
};

/**
 * As datas do ano: tipo 'feriado' (nacional), 'facultativo' (ponto facultativo) ou 'comemorativa'.
 * `chaves`: como a pessoa chama a data (sem acento), para "quantos dias faltam pro …".
 */
function datasDoAno(ano) {
  const p = pascoa(ano);
  const lista = [
    [dia(ano, 1, 1), 'Confraternização Universal', 'New Year\'s Day', 'feriado', 'ano novo|confraternizacao|reveillon|virada|new year'],
    [somar(p, -48), 'Carnaval', 'Carnival', 'facultativo', 'carnaval|carnival'],
    [somar(p, -47), 'Carnaval', 'Carnival', 'facultativo', ''],
    [somar(p, -2), 'Sexta-feira Santa', 'Good Friday', 'feriado', 'sexta(-| )?feira santa|paixao de cristo|good friday'],
    [p, 'Páscoa', 'Easter', 'comemorativa', 'pascoa|easter'],
    [dia(ano, 4, 21), 'Tiradentes', 'Tiradentes Day', 'feriado', 'tiradentes'],
    [dia(ano, 5, 1), 'Dia do Trabalho', 'Labour Day', 'feriado', 'dia do trabalho|dia do trabalhador|labou?r day'],
    [domingo(ano, 5, 2), 'Dia das Mães', 'Mother\'s Day', 'comemorativa', 'dia das maes|mother\'?s day'],
    [somar(p, 60), 'Corpus Christi', 'Corpus Christi', 'facultativo', 'corpus christi'],
    [dia(ano, 6, 12), 'Dia dos Namorados', 'Valentine\'s Day (Brazil)', 'comemorativa', 'dia dos namorados|valentine'],
    [domingo(ano, 8, 2), 'Dia dos Pais', 'Father\'s Day', 'comemorativa', 'dia dos pais|father\'?s day'],
    [dia(ano, 9, 7), 'Independência do Brasil', 'Independence Day', 'feriado', 'independencia|7 de setembro|independence day'],
    [dia(ano, 10, 12), 'Nossa Senhora Aparecida e Dia das Crianças', 'Our Lady of Aparecida / Children\'s Day', 'feriado', 'aparecida|dia das criancas|children\'?s day'],
    [dia(ano, 11, 2), 'Finados', 'All Souls\' Day', 'feriado', 'finados|all souls'],
    [dia(ano, 11, 15), 'Proclamação da República', 'Republic Day', 'feriado', 'proclamacao da republica|republic day'],
    // feriado nacional desde 2024 (Lei 14.759/2023)
    ...(ano >= 2024 ? [[dia(ano, 11, 20), 'Dia da Consciência Negra', 'Black Awareness Day', 'feriado', 'consciencia negra|zumbi|black awareness']] : []),
    [dia(ano, 12, 25), 'Natal', 'Christmas', 'feriado', 'natal|christmas'],
  ];
  return lista.map(([data, nome, en, tipo, chaves]) => ({ data, iso: iso(data), nome, en, tipo, chaves }));
}

/** Datas de vários anos, para o calendário navegar sem perder as marcações. */
function datasDosAnos(de, ate) {
  const mapa = {};
  for (let a = de; a <= ate; a += 1) {
    for (const d of datasDoAno(a)) (mapa[d.iso] ||= []).push([d.nome, d.tipo, d.en]);
  }
  return mapa;
}

/* ------------------------------ ler a data na pergunta ------------------------------ */

const NOME_DO_MES = new RegExp(`\\b(${MESES.join('|')}|${MESES_EN.join('|')})\\b`);
const mesDoNome = (nome) => (MESES.indexOf(nome) + 1) || (MESES_EN.indexOf(nome) + 1);

/** "25/12", "25/12/2027", "25 de dezembro (de 2027)", "december 25(, 2027)", "25 december" → Date ou null. */
function dataNaPergunta(t, hoje) {
  const ano = (a) => (a ? (a.length === 2 ? 2000 + Number(a) : Number(a)) : hoje.getFullYear());
  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/.exec(t);
  if (m) return valida(Number(m[1]), Number(m[2]), ano(m[3]));
  m = new RegExp(`\\b(\\d{1,2})(?:º|o)? (?:de )?${NOME_DO_MES.source}(?:,? (?:de )?(\\d{4}))?`).exec(t);
  if (m) return valida(Number(m[1]), mesDoNome(m[2]), ano(m[3]));
  m = new RegExp(`${NOME_DO_MES.source} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`).exec(t);
  if (m) return valida(Number(m[2]), mesDoNome(m[1]), ano(m[3]));
  return null;
}
function valida(d, m, a) {
  const x = dia(a, m, d);
  return m >= 1 && m <= 12 && x.getDate() === d ? x : null;
}

/** O mês pedido: nome do mês (com ano opcional), "próximo mês", senão o atual. */
function mesNaPergunta(t, hoje) {
  const m = new RegExp(`${NOME_DO_MES.source}(?: (?:de |of )?(\\d{4}))?`).exec(t);
  if (m) return { ano: m[2] ? Number(m[2]) : hoje.getFullYear(), mes: mesDoNome(m[1]) };
  if (/\b(proximo mes|mes que vem|next month)\b/.test(t)) {
    const d = dia(hoje.getFullYear(), hoje.getMonth() + 2, 1);
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  }
  return { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
}

/** A data comemorativa citada ("natal", "carnaval de 2027"), na próxima vez que ela acontece (ou no ano pedido). */
function dataCitada(t, hoje) {
  const anoPedido = /\b(20\d{2})\b/.exec(t)?.[1];
  const achar = (ano) => datasDoAno(ano).find((d) => d.chaves && new RegExp(`\\b(${d.chaves})\\b`).test(t));
  if (anoPedido) return achar(Number(anoPedido)) || null;
  const este = achar(hoje.getFullYear());
  if (!este) return null;
  return diasEntre(hoje, este.data) >= 0 ? este : achar(hoje.getFullYear() + 1);
}

/* ------------------------------ que pedido é ------------------------------ */

const HOJE = /\b((que|qual) (e )?(o )?(dia|data)( (da semana|do mes))? (e |eh |sera )?hoje|hoje e (que|qual) dia|data de hoje|dia de hoje|what day is (it )?today|what(?:'s| is) (the )?(date|day) today|what(?:'s| is) today'?s date|today'?s date)\b/;
const CONTAGEM = /\b(quantos dias (faltam|falta|ate|pra|para)|falta(m)? quantos dias|quando (e|eh|cai|vai ser|sera|vai cair)|em que dia (e|cai|vai cair|sera)|que dia (e|cai|vai cair|sera)|how many days (until|till|to|left)|when is)\b/;
const DIA_DA_SEMANA = /\b(dia da semana|cai (em )?que dia|caiu (em )?que dia|vai cair (em )?que dia|que dia (cai|caiu|vai cair|foi)|day of (the )?week|what day (is|was|will be))\b/;
const FERIADO = /\b(feriados?|holidays?)\b/;
const FERIADO_PERGUNTA = /\b(quais|qual|tem|temos|teremos|tera|terao|proximos?|lista|liste|quantos|quando|calendario|deste|desse|neste|nesse|este|esse|do mes|do ano|no mes|no ano|de (\w+)|em (\w+)|which|what|next|upcoming|any|this|list)\b/;
const FERIADO_FORA = /\b(por que|porque|origem|historia|significa|surgiu|motivo|estaduais?|municipa(l|is)|na cidade|no estado|why|history|origin)\b/;
const CALENDARIO = /^(me )?(mostre|mostra|abra|abre|exiba|exibe|ver|veja|quero ver|show( me)?|open)?\s*(o |um |the |a )?(calendario|calendar)( (do|deste|desse|of|for|this|de)( (mes|month|ano|year))?)?( (de |of )?(\w+))?( (de |of )?\d{4})?\s*[?.!]*$/;

/** O pedido de data: { tipo: 'hoje'|'feriados'|'contagem'|'semana'|'calendario', ... } ou null. */
function pedidoDeCalendario(pergunta, hoje = new Date()) {
  const t = semAcento(pergunta).replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 140) return null;
  if (HOJE.test(t)) return { tipo: 'hoje' };
  if (FERIADO.test(t) && FERIADO_PERGUNTA.test(t) && !FERIADO_FORA.test(t)) {
    if (/\b(proximo|next|upcoming)\b/.test(t) && !NOME_DO_MES.test(t) && !/\b(proximos|meses|holidays)\b/.test(t)) return { tipo: 'proximo' };
    if (/\b(do ano|deste ano|desse ano|neste ano|nesse ano|este ano|esse ano|no ano|this year|of the year|in \d{4}|em \d{4}|de \d{4})\b/.test(t) && !NOME_DO_MES.test(t)) {
      return { tipo: 'feriados_do_ano', ano: Number(/\b(20\d{2})\b/.exec(t)?.[1]) || hoje.getFullYear() };
    }
    return { tipo: 'feriados', ...mesNaPergunta(t, hoje) };
  }
  if (DIA_DA_SEMANA.test(t)) {
    const data = dataNaPergunta(t, hoje);
    if (data) return { tipo: 'semana', data };
  }
  if (CONTAGEM.test(t)) {
    const citada = dataCitada(t, hoje);
    if (citada) return { tipo: 'contagem', data: citada.data, nome: citada.nome, en: citada.en };
    const data = /\b(quantos dias|falta|how many days)\b/.test(t) && dataNaPergunta(t, hoje);
    if (data) return { tipo: 'contagem', data };
  }
  if (CALENDARIO.test(t)) return { tipo: 'calendario', ...mesNaPergunta(t, hoje) };
  return null;
}

/* ------------------------------ a resposta ------------------------------ */

function responderCalendario({ pergunta, deps = {}, config = {}, agora, pedido } = {}) {
  const hoje = agora ? new Date(agora) : new Date();
  const p = pedido || pedidoDeCalendario(pergunta, hoje);
  if (!p) return null;
  const en = config.idiomaEfetivo === 'en';
  const locale = en ? 'en-US' : 'pt-BR';
  // "1º de janeiro", como se escreve
  const primeiro = (s) => (en ? s : s.replace(/(^|\s)1 de /, '$11º de '));
  const longa = (d) => primeiro(d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const curta = (d) => primeiro(d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }));
  const nomeDoMes = (a, m) => dia(a, m, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const nome = (d) => (en ? d.en : d.nome);
  const tipoEscrito = (d) => (d.tipo === 'facultativo' ? (en ? ' (optional day off)' : ' (ponto facultativo)') : d.tipo === 'comemorativa' ? (en ? ' (not a holiday)' : ' (data comemorativa)') : '');
  const emDias = (n) => (n === 0 ? (en ? 'today' : 'hoje') : n === 1 ? (en ? 'tomorrow' : 'amanhã') : n === -1 ? (en ? 'yesterday' : 'ontem') : n > 0 ? (en ? `in ${n} days` : `daqui a ${n} dias`) : (en ? `${-n} days ago` : `há ${-n} dias`));
  const feriadosEntre = (de, ate) => [hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1, de.getFullYear(), ate.getFullYear()]
    .filter((a, i, l) => l.indexOf(a) === i).flatMap(datasDoAno)
    .filter((d) => d.tipo !== 'comemorativa' && d.data >= de && d.data <= ate)
    .sort((a, b) => a.data - b.data)
    .filter((d, i, l) => i === 0 || d.iso !== l[i - 1].iso);
  const proximo = () => feriadosEntre(somar(hoje, 1), dia(hoje.getFullYear() + 1, 12, 31))[0];
  // "para o Natal", "para a Páscoa", "para Nossa Senhora…"
  const artigo = (n) => (/^Nossa/.test(n) ? '' : /^(Páscoa|Sexta|Independência|Proclamação|Confraternização)/.test(n) ? 'a ' : 'o ');
  const linhaDe = (d) => `- **${curta(d.data)}** — ${nome(d)}${tipoEscrito(d)}`;
  const NOTA = en ? '*National holidays in Brazil only; state and city holidays are not included.*' : '*Só feriados nacionais; os estaduais e municipais não entram.*';

  let texto;
  let mes = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
  let marcar = null;
  if (p.tipo === 'hoje') {
    const prox = proximo();
    texto = en ? `Today is **${longa(hoje)}**.` : `Hoje é **${longa(hoje)}**.`;
    if (prox) texto += en ? ` Next holiday: **${nome(prox)}**, ${curta(prox.data)} (${emDias(diasEntre(hoje, prox.data))}).` : ` Próximo feriado: **${nome(prox)}**, ${curta(prox.data)} (${emDias(diasEntre(hoje, prox.data))}).`;
  } else if (p.tipo === 'proximo') {
    const prox = proximo();
    texto = en
      ? `The next holiday is **${nome(prox)}**${tipoEscrito(prox)}, on **${longa(prox.data)}** (${emDias(diasEntre(hoje, prox.data))}).`
      : `O próximo feriado é **${nome(prox)}**${tipoEscrito(prox)}, na **${longa(prox.data)}** (${emDias(diasEntre(hoje, prox.data))}).`;
    mes = { ano: prox.data.getFullYear(), mes: prox.data.getMonth() + 1 };
    marcar = prox.iso;
    texto += `\n\n${NOTA}`;
  } else if (p.tipo === 'feriados' || p.tipo === 'feriados_do_ano') {
    const doAno = p.tipo === 'feriados_do_ano';
    const de = doAno ? dia(p.ano, 1, 1) : dia(p.ano, p.mes, 1);
    const ate = doAno ? dia(p.ano, 12, 31) : dia(p.ano, p.mes + 1, 0);
    const lista = feriadosEntre(de, ate);
    const periodo = doAno ? String(p.ano) : nomeDoMes(p.ano, p.mes);
    if (lista.length) {
      texto = `${en ? `Holidays in ${periodo}:` : `Feriados de ${periodo}:`}\n\n${lista.map(linhaDe).join('\n')}`;
    } else {
      const depois = feriadosEntre(somar(ate, 1), dia(p.ano + 1, 12, 31))[0];
      texto = en ? `There are no national holidays in ${periodo}.` : `${periodo[0].toUpperCase()}${periodo.slice(1)} não tem feriado nacional.`;
      if (depois) texto += en ? ` The next one is **${nome(depois)}**, ${longa(depois.data)}.` : ` O próximo é **${nome(depois)}**, ${longa(depois.data)}.`;
    }
    texto += `\n\n${NOTA}`;
    mes = doAno ? { ano: p.ano, mes: p.ano === hoje.getFullYear() ? hoje.getMonth() + 1 : 1 } : { ano: p.ano, mes: p.mes };
  } else if (p.tipo === 'semana') {
    const n = diasEntre(hoje, p.data);
    const verbo = n < 0 ? (en ? 'was' : 'foi') : n === 0 ? (en ? 'is' : 'é') : (en ? 'will be' : 'cai');
    texto = en ? `${p.data.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })} ${verbo} a **${p.data.toLocaleDateString(locale, { weekday: 'long' })}** (${emDias(n)}).` : `${primeiro(p.data.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }))} ${verbo} numa **${p.data.toLocaleDateString(locale, { weekday: 'long' })}** (${emDias(n)}).`;
    if (!en && [0, 6].includes(p.data.getDay())) texto = texto.replace(' numa **', ' num **');
    if (!en && n === 0) texto = texto.replace(/ numa? \*\*/, ': **');
    const datas = datasDoAno(p.data.getFullYear()).filter((d) => d.iso === iso(p.data));
    if (datas.length) texto += en ? ` ${n < 0 ? 'It was' : 'It is'} ${datas.map((d) => nome(d) + tipoEscrito(d)).join(' and ')}.` : ` ${n < 0 ? 'Foi' : 'É'} ${datas.map((d) => nome(d) + tipoEscrito(d)).join(' e ')}.`;
    mes = { ano: p.data.getFullYear(), mes: p.data.getMonth() + 1 };
    marcar = iso(p.data);
  } else if (p.tipo === 'contagem') {
    const n = diasEntre(hoje, p.data);
    const alvo = p.nome ? `**${en ? p.en : p.nome}**` : `**${longa(p.data)}**`;
    if (n === 0) texto = en ? `${alvo} is **today**!` : `${alvo} é **hoje**!`;
    else if (n > 0) texto = en ? `${n === 1 ? '**1 day**' : `**${n} days**`} until ${alvo}${p.nome ? ` — ${longa(p.data)}` : ''}.` : `Falta${n === 1 ? '' : 'm'} **${n} dia${n === 1 ? '' : 's'}** para ${p.nome ? artigo(p.nome) : ''}${alvo}${p.nome ? ` — ${longa(p.data)}` : ''}.`;
    else texto = en ? `${alvo} was ${-n} days ago.` : `${alvo} foi há ${-n} dias.`;
    if (n > 7) {
      const semanas = Math.floor(n / 7);
      texto += en ? ` That's about ${semanas} week${semanas === 1 ? '' : 's'}.` : ` São cerca de ${semanas} semana${semanas === 1 ? '' : 's'}.`;
    }
    mes = { ano: p.data.getFullYear(), mes: p.data.getMonth() + 1 };
    marcar = iso(p.data);
  } else {
    texto = en ? `Calendar for ${nomeDoMes(p.ano, p.mes)}.` : `Calendário de ${nomeDoMes(p.ano, p.mes)}.`;
    mes = { ano: p.ano, mes: p.mes };
  }

  const bloco = { idioma: en ? 'en' : 'pt', ano: mes.ano, mes: mes.mes, hoje: iso(hoje), marcar, datas: datasDosAnos(Math.min(mes.ano, hoje.getFullYear()) - 1, Math.max(mes.ano, hoje.getFullYear()) + 1) };
  const completo = `${texto}\n\n\`\`\`calendario\n${JSON.stringify(bloco)}\n\`\`\``;
  deps.emit?.('resposta-token', { pedaco: completo, noIdioma: en });
  return { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, texto: completo, modo: 'calendario', noIdioma: en };
}

module.exports = { pascoa, datasDoAno, pedidoDeCalendario, responderCalendario, dataNaPergunta };
