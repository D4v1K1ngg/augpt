'use strict';

/**
 * A agenda pelo chat (23/10, bloco 2): "me lembra sexta às 15h de ligar pro banco", "anote na agenda:
 * comprar ração", "me avise quando a RTX 60 for lançada", "o que eu tenho amanhã?", "cancele o
 * lembrete do banco". O pedido explícito ("me lembra", "anote", "agende") já é o "sim": entra direto.
 * Datas e horas em português e inglês, na hora local.
 */

const { Agenda, paraData, deData } = require('../agenda');

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const L = '(?<!\\p{L})';
const R = '(?!\\p{L})';
const re = (fonte, flags = 'iu') => new RegExp(fonte, flags);

/* ------------------------------ que pedido é ------------------------------ */

const CRIAR = re(`^(?:(?:por favor|ei|ok|au(?:gpt)?)[,!]?\\s+)?(?:me lembr(?:a|e|ar)|lembr[ae]-me|lembra-me|me avis(?:a|e)|avis[ae]-me|me notifiqu?e|(?:anot|coloc|adicion|salv|bot|ponh)[ae] (?:isso )?(?:na|a|em) (?:minha )?agenda|p[oõ]e na (?:minha )?agenda|marqu?e|agend[ae]|cri[ae] um lembrete|remind me|add (?:to|in) my (?:agenda|calendar)|schedule)${R}`);
const ACOMPANHAR = re(`${L}(?:me avis(?:a|e)|avis[ae]-me|me notifiqu?e|let me know|notify me|tell me)\\s+(?:quando|assim que|se|when|once|if)\\s+(.+)$|^(?:acompanh[ae]|fiqu?e de olho (?:em|n[ao]s?)|keep an eye on|track)\\s+(.+)$`);
const LISTAR = re(`${L}(?:o que (?:eu )?tenho|que (?:eu )?tenho (?:hoje|amanh[ãa])|(?:quais|mostre?|liste|ver|veja)(?: (?:são|sao|os|as|a|o))* (?:meus |minhas |minha )?(?:lembretes|compromissos|agenda|tarefas)|minha agenda|what do i have|my (?:agenda|reminders|schedule))${R}`);
const CANCELAR = re(`^(?:cancel[ae]|apagu?e|remov[ae]|tir[ae]|exclu[ai]|delet[ae]|desmarqu?e|cancel|delete|remove)${R}`);
const DA_AGENDA = re(`${L}(?:lembretes?|agenda|compromissos?|avisos?|acompanhamentos?|reminders?)${R}`);

/* ------------------------------ data e hora ------------------------------ */

const DIAS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12, january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const NOME_DO_MES = '(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|january|february|march|april|may|june|july|august|september|october|november|december)';
const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, meia: 0.5 };

/**
 * A data e a hora no texto → { data: Date, temDia, temHora, trechos: [pedaços do texto] } ou null.
 * Sem dia e com hora que já passou: amanhã. Sem hora: dia inteiro.
 */
function quandoNoTexto(texto, agora = new Date()) {
  const t = String(texto || '').toLowerCase();
  const trechos = [];
  const pegar = (regex) => {
    const m = regex.exec(t);
    if (m) trechos.push(m[0]);
    return m;
  };
  let dia = null;
  let hora = null;
  let minuto = 0;

  // daqui a 2 horas / em 30 minutos / in 2 hours
  const rel = pegar(re(`${L}(?:daqui a|daqui|em|dentro de|in)\\s+(\\d+|um|uma|dois|duas|tr[eê]s|meia)\\s+(minutos?|min|horas?|h|dias?|semanas?|minutes?|hours?|days?|weeks?)${R}`));
  if (rel) {
    const n = NUMEROS[rel[1]] ?? Number(rel[1]);
    const u = semAcento(rel[2]);
    const ms = /^(min)/.test(u) ? 60000 : /^(h|hora|hour)/.test(u) ? 3600000 : /^(dia|day)/.test(u) ? 86400000 : 7 * 86400000;
    const d = new Date(agora.getTime() + n * ms);
    return { data: d, temDia: ms >= 86400000, temHora: ms < 86400000, trechos };
  }

  const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  let x;
  if ((x = pegar(re(`${L}depois de amanh[ãa]${R}`)))) dia = new Date(base.getTime() + 2 * 86400000);
  else if ((x = pegar(re(`${L}(?:amanh[ãa]|tomorrow)${R}`)))) dia = new Date(base.getTime() + 86400000);
  else if ((x = pegar(re(`${L}(?:hoje|today)${R}`)))) dia = base;
  if (!dia && (x = pegar(re(`${L}(?:(?:na|no|nesta|neste|nessa|nesse|esta|este|essa|esse|pr[óo]xim[ao]|on|next|this)\\s+)?(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:-feira| feira)?${R}`)))) {
    const alvo = DIAS[semAcento(x[1])];
    let falta = (alvo - base.getDay() + 7) % 7;
    if (falta === 0) falta = 7; // "na sexta" dito na sexta: a próxima
    dia = new Date(base.getTime() + falta * 86400000);
  }
  if (!dia && (x = pegar(/(?<![\d/])(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/))) {
    const ano = x[3] ? (x[3].length === 2 ? 2000 + Number(x[3]) : Number(x[3])) : base.getFullYear();
    dia = new Date(ano, Number(x[2]) - 1, Number(x[1]));
    if (!x[3] && dia < base) dia.setFullYear(dia.getFullYear() + 1);
  }
  if (!dia && (x = pegar(re(`${L}(?:dia\\s+)?(\\d{1,2})(?:º|o)?\\s+(?:de\\s+)?${NOME_DO_MES}(?:\\s+(?:de\\s+)?(\\d{4}))?${R}`)))) {
    dia = new Date(x[3] ? Number(x[3]) : base.getFullYear(), MESES[semAcento(x[2])] - 1, Number(x[1]));
    if (!x[3] && dia < base) dia.setFullYear(dia.getFullYear() + 1);
  }
  if (!dia && (x = pegar(re(`${L}${NOME_DO_MES}\\s+(\\d{1,2})(?:st|nd|rd|th)?${R}`)))) {
    dia = new Date(base.getFullYear(), MESES[semAcento(x[1])] - 1, Number(x[2]));
    if (dia < base) dia.setFullYear(dia.getFullYear() + 1);
  }
  if (!dia && (x = pegar(re(`${L}(?:no\\s+)?dia\\s+(\\d{1,2})${R}`)))) {
    dia = new Date(base.getFullYear(), base.getMonth(), Number(x[1]));
    if (dia < base) dia.setMonth(dia.getMonth() + 1);
  }

  // hora: "às 15h", "15h30", "15:30", "3pm", "às 3 da tarde"; período: "de manhã" (9h), "à tarde" (15h), "à noite" (20h)
  if ((x = pegar(re(`${L}(?:às|as|at|pelas|lá pelas)\\s+(\\d{1,2})(?:[:h](\\d{2}))?\\s*(?:h|hs|horas?)?(?:\\s+(?:da|de)\\s+(manh[ãa]|tarde|noite))?(?:\\s*(am|pm))?${R}`)))
    || (x = pegar(/(?<![\p{L}\d/])(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?:\s*(am|pm))?(?![\p{L}\d])/iu))
    || (x = pegar(/(?<![\p{L}\d/])(\d{1,2})\s*(am|pm)(?!\p{L})/iu))) {
    const partes = x.slice(1).filter((v) => v !== undefined);
    hora = Number(partes[0]);
    minuto = Number(partes.find((v, i) => i > 0 && /^\d{2}$/.test(v)) || 0);
    const periodo = partes.find((v) => /^(tarde|noite|pm)$/i.test(semAcento(v)));
    if (periodo && hora < 12) hora += 12;
    if (partes.some((v) => /^am$/i.test(v)) && hora === 12) hora = 0;
  } else if ((x = pegar(re(`${L}(de manh[ãa]|pela manh[ãa]|cedo|à tarde|a tarde|de tarde|à noite|a noite|de noite|hoje à noite|meio[- ]dia|meia[- ]noite|in the morning|in the afternoon|in the evening|tonight|noon|midnight)${R}`)))) {
    const p = semAcento(x[1]);
    hora = /manha|cedo|morning/.test(p) ? 9 : /tarde|afternoon/.test(p) ? 15 : /noite|evening|tonight/.test(p) && !/meia/.test(p) ? 20 : /meio|noon/.test(p) ? 12 : 0;
    if (/tonight|hoje a noite/.test(p) && !dia) dia = base;
  }
  if (hora !== null && (hora > 23 || minuto > 59)) hora = null;
  if (!dia && hora === null) return null;

  const temDia = Boolean(dia);
  let d = new Date(dia || base);
  if (hora !== null) d.setHours(hora, minuto, 0, 0);
  if (!temDia && hora !== null && d <= agora) d = new Date(d.getTime() + 86400000); // "às 8h" dito às 21h: amanhã
  return { data: d, temDia, temHora: hora !== null, trechos };
}

/** O título: o texto sem o pedido, sem a data e a hora e sem os conectivos das pontas. */
function tituloDe(texto, gatilho, trechos = []) {
  let s = String(texto || '');
  if (gatilho) s = s.slice(s.toLowerCase().indexOf(gatilho.toLowerCase()) + gatilho.length);
  for (const tr of trechos) {
    const i = s.toLowerCase().indexOf(tr.toLowerCase());
    if (i >= 0) s = `${s.slice(0, i)} ${s.slice(i + tr.length)}`;
  }
  s = s.replace(/\s+/g, ' ').replace(/[?!.;]+\s*$/, '').trim();
  for (let i = 0; i < 3; i += 1) {
    s = s.replace(re(`^(?:[:,\\-–]\\s*|(?:de|que|para|pra|pro|do|da|sobre|isso|na agenda|to|about|that|me)${R}\\s*)`), '').trim();
    s = s.replace(re(`\\s+(?:de|às|as|no|na|em|para|pra|e|at|on|in|o|a|dia)$`), '').trim();
  }
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** "a RTX 60 for lançada" → "RTX 60"; "o lançamento do GTA 6" → "GTA 6"; "sair a 3ª temporada de Vinland Saga" → "3ª temporada de Vinland Saga". */
function assuntoDe(texto) {
  let s = tituloDe(texto, null, []);
  s = s.replace(re(`^(?:sair|sairem|lan[çc]arem|lan[çc]ar|estrear|chegar|anunciarem)\\s+`), '');
  s = s.replace(re(`\\s+(?:for|forem|seja|sejam|estiver|tiver|tiverem|sair|sa[íi]rem|lan[çc]ar|lan[çc]arem|estrear|chegar|is|are|gets?|comes?|will)(?:\\s+.*)?$`), '');
  s = s.replace(re(`^(?:o|a|os|as|the)\\s+(?:lan[çc]amento|estreia|chegada|an[úu]ncio|release|launch)\\s+(?:d[oa]s?|of)\\s+`), '');
  s = s.replace(re(`^(?:o|a|os|as|the)\\s+`), '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const ALERTA_DE_PRECO = re(`${L}(?:me avis(?:a|e)|avis[ae]-me|me notifiqu?e|let me know|notify me|tell me)\\s+(?:quando|se|assim que|when|if|once)\\s+(.+?)\\s+(?:ficar|estiver|baixar|cair|chegar|custar|for|sair|goes|drops|falls|is|gets)\\s+(?:(?:para|pra|a|por|to)\\s+)?(?:abaixo de|menos de|por menos de|at[ée]|em|a|below|under|less than)?\\s*(?:r\\$\\s*)?(\\d[\\d.,]*)\\s*(mil|k)?${R}`);
/** "10.000", "9.999,90", "10 mil", "10k", "10000" → número. */
function valorEmReais(texto, mil) {
  const t = String(texto || '');
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? (mil ? n * 1000 : n) : 0;
}

/** O pedido de agenda: { acao: 'criar'|'acompanhar'|'listar'|'cancelar', ... } ou null. */
function pedidoDeAgenda(pergunta, agora = new Date()) {
  const original = String(pergunta || '').replace(/\s+/g, ' ').trim();
  if (!original || original.length > 220) return null;
  const t = original.toLowerCase();
  // alerta de preço (24/10): "me avise quando a RTX 5080 ficar abaixo de R$ 10.000"
  const alerta = ALERTA_DE_PRECO.exec(original);
  if (alerta) {
    const limite = valorEmReais(alerta[2], alerta[3]);
    const produto = assuntoDe(alerta[1]);
    if (limite > 0 && produto.length >= 2) return { acao: 'acompanhar', assunto: produto, limite };
  }
  const acomp = ACOMPANHAR.exec(t);
  if (acomp) {
    const q = quandoNoTexto(original, agora);
    // "me avise quando for 15h" é lembrete; "me avise quando a RTX 60 for lançada" é acompanhar
    if (!q || !q.temHora) {
      const assunto = assuntoDe(original.slice(t.indexOf(acomp[1] || acomp[2])));
      return assunto.length >= 2 ? { acao: 'acompanhar', assunto } : null;
    }
  }
  const criar = CRIAR.exec(t);
  if (criar) {
    const q = quandoNoTexto(original, agora);
    // "marque"/"agende" sem data não é agenda ("marque como lido")
    if (!q && /^(?:marqu?e|agend[ae]|schedule)$/i.test(criar[0].replace(/^(?:por favor|ei|ok|au(?:gpt)?)[,!]?\s+/i, '').trim().split(/\s+/)[0])) return null;
    const titulo = tituloDe(original, criar[0], q?.trechos || []).replace(re(`^(?:quando|when)(?:\\s+(?:for|der|it'?s))?${R}\\s*`), '') || (q ? (/^(?:remind|schedule|add)/i.test(criar[0]) ? 'Reminder' : 'Lembrete') : '');
    if (!titulo) return null;
    return q ? { acao: 'criar', tipo: 'lembrete', titulo, quando: q.temHora ? deData(q.data) : deData(q.data).slice(0, 10), diaInteiro: !q.temHora, temDia: q.temDia } : { acao: 'criar', tipo: 'ideia', titulo };
  }
  if (LISTAR.test(t)) {
    const n = semAcento(t);
    const periodo = /\b(amanha|tomorrow)\b/.test(n) ? 'amanha' : /\b(semana|week)\b/.test(n) ? 'semana' : /\b(hoje|today)\b/.test(n) ? 'hoje' : 'tudo';
    return { acao: 'listar', periodo };
  }
  if (CANCELAR.test(t) && DA_AGENDA.test(t)) {
    const resto = original.replace(CANCELAR, '').replace(re(`${L}(?:o|a|os|as|meu|minha|the|my)?\\s*(?:lembretes?|compromissos?|avisos?|acompanhamentos?|reminders?)${R}`), ' ').replace(re(`${L}(?:da|na|from|in)\\s+(?:minha\\s+)?(?:agenda|calendar)${R}`), ' ');
    return { acao: 'cancelar', busca: tituloDe(resto, null, []) };
  }
  return null;
}

/* ------------------------------ a resposta ------------------------------ */

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };

function comoDizer(item, en) {
  const d = paraData(item.quando);
  if (!d) return '';
  const locale = en ? 'en-US' : 'pt-BR';
  const dia = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return item.diaInteiro ? dia : `${dia}, ${en ? 'at' : 'às'} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

/** As palavras que importam do título (para achar o item de "cancele o lembrete do banco"). */
const palavras = (s) => semAcento(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !['que', 'para', 'pro', 'pra', 'com', 'dos', 'das', 'the', 'and'].includes(p));

function responderAgenda({ pergunta, deps = {}, config = {}, pasta, agora = new Date(), pedido } = {}) {
  const p = pedido || pedidoDeAgenda(pergunta, agora);
  if (!p || !pasta) return null;
  const en = config.idiomaEfetivo === 'en';
  const agenda = new Agenda(pasta);
  const fim = (texto) => {
    deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
    deps.emit?.('agenda-mudou', {});
    return { ...SEM_PESQUISA, texto, modo: 'agenda', noIdioma: en };
  };
  const ONDE = en ? 'You can see it in **Agenda**, on the left bar.' : 'Está em **Agenda**, na barra da esquerda.';

  if (p.acao === 'acompanhar' && p.limite) {
    const reais = (v) => `R$ ${v.toLocaleString(en ? 'en-US' : 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const titulo = en ? `${p.assunto} below ${reais(p.limite)}` : `${p.assunto} abaixo de ${reais(p.limite)}`;
    agenda.adicionar({ tipo: 'acompanhar', titulo, assunto: p.assunto, limite: p.limite });
    return fim(en
      ? `Done ✓ I'll check the price of **${p.assunto}** in the stores every 6 hours (while AuGPT is open) and let you know when it's below **${reais(p.limite)}**. ${ONDE}`
      : `Combinado ✓ Vou conferir o preço de **${p.assunto}** nas lojas a cada 6 horas (com o AuGPT aberto) e te aviso quando ficar abaixo de **${reais(p.limite)}**. ${ONDE}`);
  }
  if (p.acao === 'acompanhar') {
    const item = agenda.adicionar({ tipo: 'acompanhar', titulo: p.assunto, assunto: p.assunto });
    return fim(en
      ? `Done ✓ I'll keep an eye on **${item.titulo}**: I check once a day (while AuGPT is open) and let you know when there's news. ${ONDE}`
      : `Combinado ✓ Vou acompanhar **${item.titulo}**: confiro uma vez por dia (com o AuGPT aberto) e te aviso quando houver novidade. ${ONDE}`);
  }
  if (p.acao === 'criar') {
    if (p.tipo === 'lembrete' && p.temDia && !p.diaInteiro && paraData(p.quando) <= agora) {
      return fim(en ? `That time has already passed (${comoDizer(p, true)}). Tell me another day or time.` : `Esse horário já passou (${comoDizer(p, false)}). Me diga outro dia ou hora.`);
    }
    const item = agenda.adicionar(p);
    if (!item) return null;
    if (item.tipo === 'ideia') return fim(en ? `Saved in **Ideas and plans** ✓ — ${item.titulo}. ${ONDE}` : `Anotado em **Ideias e planos** ✓ — ${item.titulo}. ${ONDE}`);
    const aviso = item.diaInteiro ? (en ? ' (I remind you at 9 AM)' : ' (aviso às 9h)') : '';
    return fim(en
      ? `Added to your agenda ✓ **${item.titulo}** — ${comoDizer(item, true)}${aviso}. I'll notify you on time, while AuGPT is open. ${ONDE}`
      : `Anotado na agenda ✓ **${item.titulo}** — ${comoDizer(item, false)}${aviso}. Eu aviso na hora, com o AuGPT aberto. ${ONDE}`);
  }
  if (p.acao === 'listar') {
    const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const ate = { hoje: 1, amanha: 2, semana: 7, tudo: 3650 }[p.periodo];
    const de = p.periodo === 'amanha' ? new Date(base.getTime() + 86400000) : base;
    const fimDoPeriodo = new Date(base.getTime() + ate * 86400000);
    const itens = agenda.listar();
    const lembretes = itens.filter((i) => i.tipo === 'lembrete' && !i.feito && paraData(i.quando) >= de && paraData(i.quando) < fimDoPeriodo).sort((a, b) => paraData(a.quando) - paraData(b.quando));
    const acompanhando = itens.filter((i) => i.tipo === 'acompanhar' && i.acompanhar?.status === 'ativo');
    const ideias = itens.filter((i) => i.tipo === 'ideia' && !i.feito);
    const nomeDoPeriodo = en ? { hoje: 'today', amanha: 'tomorrow', semana: 'in the next 7 days', tudo: 'coming up' }[p.periodo] : { hoje: 'para hoje', amanha: 'para amanhã', semana: 'nos próximos 7 dias', tudo: 'pela frente' }[p.periodo];
    let texto = lembretes.length
      ? `${en ? `Your agenda ${nomeDoPeriodo}:` : `Na sua agenda ${nomeDoPeriodo}:`}\n\n${lembretes.map((i) => `- **${comoDizer(i, en)}** — ${i.titulo}`).join('\n')}`
      : en ? `Nothing on your agenda ${nomeDoPeriodo}.` : `Nada na agenda ${nomeDoPeriodo}.`;
    if (p.periodo === 'tudo' && ideias.length) texto += `\n\n${en ? 'Ideas and plans' : 'Ideias e planos'}: ${ideias.map((i) => i.titulo).join(' · ')}`;
    if (acompanhando.length) texto += `\n\n${en ? 'Keeping an eye on' : 'Acompanhando'}: ${acompanhando.map((i) => i.titulo).join(' · ')}`;
    return fim(texto);
  }
  if (p.acao === 'cancelar') {
    const busca = palavras(p.busca);
    const candidatos = agenda.listar().filter((i) => !i.feito && busca.length && busca.every((w) => palavras(i.titulo).some((x) => x.startsWith(w) || w.startsWith(x))));
    if (candidatos.length === 1) {
      agenda.remover(candidatos[0].id);
      return fim(en ? `Removed from your agenda: **${candidatos[0].titulo}**.` : `Removido da agenda: **${candidatos[0].titulo}**.`);
    }
    if (candidatos.length > 1) return fim(`${en ? 'I found more than one — which one?' : 'Achei mais de um — qual deles?'}\n\n${candidatos.map((i) => `- ${i.titulo}${i.quando ? ` (${comoDizer(i, en)})` : ''}`).join('\n')}`);
    return fim(en ? 'I could not find that in your agenda.' : 'Não achei isso na agenda.');
  }
  return null;
}

/* ------------------------------ a oferta no fim da pesquisa ------------------------------ */

// "quando sai…", "data de lançamento", "já foi lançado?": a pesquisa termina oferecendo acompanhar
const EVENTO_FUTURO = /\b(quando\b.{0,60}?\b(?:sai|sair|vai sair|sera lancad\w*|vai ser lancad\w*|lanca|lancara|chega|chegara|estreia|estreara|vai estrear|sera anunciad\w*|comeca|vai comecar)|data de (?:lancamento|estreia|chegada)|previsao de (?:lancamento|chegada|estreia)|ja (?:saiu|foi lancad\w*|lancou|estreou)|release date|when (?:does|will) .{2,40} (?:come out|release|launch|be released))\b/;

function ofertaDeAcompanhar(assunto, idioma = 'pt') {
  return idioma === 'en'
    ? `Want me to keep an eye on **${assunto}** and let you know when there's news (release or confirmed date)? Just reply **"yes"**.`
    : `Quer que eu acompanhe **${assunto}** e te avise quando houver novidade (lançamento ou data confirmada)? É só responder **"sim"**.`;
}
const pedeAcompanhar = (pergunta) => EVENTO_FUTURO.test(semAcento(pergunta));

module.exports = { pedidoDeAgenda, quandoNoTexto, tituloDe, responderAgenda, ofertaDeAcompanhar, pedeAcompanhar };
