'use strict';

/**
 * Timers e alarmes pela voz (31/10, pedido do Davi): "timer de 10 minutos pro miojo", "me acorda em 20 minutos",
 * "alarme às 7h", "cancela o timer". O código lê a duração (em número ou por extenso) e responde com o cartão
 * ```timer: a contagem regressiva, o bipe e o aviso do Windows no fim moram na tela (renderer/timer.js).
 * "Me lembra daqui a 20 minutos de…" continua com a agenda (lembrete guardado na Agenda).
 */

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const UNIDADES = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 };
const NUMEROS = { ...UNIDADES, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90, cem: 100 };

/** "vinte e cinco minutos" → "25 minutos"; "meia hora" → "30 minutos". */
function emNumeros(t) {
  return t
    .replace(/\b(vinte|trinta|quarenta|cinquenta) e (um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)\b/g, (_, d, u) => String(NUMEROS[d] + UNIDADES[u]))
    .replace(new RegExp(`\\b(${Object.keys(NUMEROS).join('|')})\\b`, 'g'), (p) => String(NUMEROS[p]))
    .replace(/\bmeia hora\b/g, '30 minutos')
    .replace(/(\d+)\s*(horas?|h) e meia\b/g, (_, n) => `${n} horas 30 minutos`)
    .replace(/(\d+)\s*(minutos?|min) e meio\b/g, (_, n) => `${n} minutos 30 segundos`)
    .replace(/\b(\d{1,2}) e meia\b/g, '$1:30'); // "às 5 e meia"
}

const DURACAO = /(\d+(?:[.,]\d+)?)\s*(horas?|hrs?|h|minutos?|mins?|m|segundos?|segs?|s)(?![a-z])(?:\s*(\d{1,2})(?!\d|\s*(?:minutos?|mins?|segundos?|segs?|s|horas?|h)(?![a-z])))?/g;

/** A duração em segundos e onde ela termina no texto, ou null. "1h30" vale 90 min. */
function duracaoNoTexto(t) {
  let total = 0;
  let fim = -1;
  for (const m of t.matchAll(DURACAO)) {
    const n = Number(m[1].replace(',', '.'));
    const u = m[2][0];
    total += u === 'h' ? n * 3600 + (m[3] ? Number(m[3]) * 60 : 0) : u === 'm' ? n * 60 : n;
    fim = m.index + m[0].length;
  }
  return total > 0 ? { segundos: Math.round(total), fim } : null;
}

/** "às 7h", "as 6:30", "às 7 da noite", "meio-dia" → { hora, minuto, fim } ou null. */
function horarioNoTexto(t) {
  if (/\bmeio dia\b/.test(t)) return { hora: 12, minuto: 0, fim: t.indexOf('meio dia') + 8 };
  if (/\bmeia noite\b/.test(t)) return { hora: 0, minuto: 0, fim: t.indexOf('meia noite') + 10 };
  const m = /\b(?:as|a|pras|para as|pra)\s+(\d{1,2})(?:\s*(?:[:h]|horas? e)\s*(\d{2}))?(?:\s*(?:h|horas?)(?![a-z]))?(?:\s+(da manha|da tarde|da noite|de manha|de noite))?/.exec(t);
  if (!m) return null;
  let hora = Number(m[1]);
  const minuto = Number(m[2] || 0);
  if (/tarde|noite/.test(m[3] || '') && hora < 12) hora += 12;
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto, fim: m.index + m[0].length };
}

const PALAVRA = /\b(timer|timers|temporizador|cronometro|alarme|alarmes|despertador)\b/;
const AVISA_EM = /\b(?:me )?(?:avisa|avise|chama|chame|acorda|acorde|desperta|desperte)(?: me)? (?:em|daqui a|daqui|dentro de)\b/;
const ACORDA_AS = /\b(?:me )?(?:acorda|acorde|desperta|desperte)(?: me)? (?:as|a|pras|para as|pra)\b/;
const CANCELA = /\b(cancela|cancele|cancelar|para|pare|parar|desliga|desligue|apaga|apague|tira|tire|chega)\b.{0,12}\b(timer|timers|alarme|alarmes|temporizador|despertador)\b/;

/** { acao: 'criar', segundos | hora+minuto, rotulo } | { acao: 'cancelar' } | null */
function pedidoDeTimer(texto) {
  const t = emNumeros(semAcento(texto).replace(/[?!.]+$/, '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim());
  if (CANCELA.test(t)) return { acao: 'cancelar' };
  // "quanto tempo dura um timer", "o que é um alarme" — dúvida, não pedido
  if (/^(o que|como|qual|quais|por que|quanto tempo (dura|leva))\b/.test(t)) return null;
  const palavra = PALAVRA.test(t);
  const dur = duracaoNoTexto(t);
  const hora = horarioNoTexto(t);
  let pedido = null;
  // "alarme às 7h" é horário, não 7 horas de timer: sem "de/em/daqui a <número>", o "às" manda
  if (hora && (palavra || ACORDA_AS.test(t)) && !AVISA_EM.test(t) && !/\b(de|em|daqui a|por) \d/.test(t)) pedido = { acao: 'criar', hora: hora.hora, minuto: hora.minuto, fim: hora.fim };
  else if (dur &&(palavra || AVISA_EM.test(t) || /^(conta|marca|poe|coloca|bota|faz)\b/.test(t)) && dur.segundos <= 24 * 3600) pedido = { acao: 'criar', segundos: dur.segundos, fim: dur.fim };
  else if (hora && (palavra || ACORDA_AS.test(t))) pedido = { acao: 'criar', hora: hora.hora, minuto: hora.minuto, fim: hora.fim };
  if (!pedido) return null;
  // o que vem depois: "pro miojo", "para tirar o bolo", "pra ir na academia"
  const resto = t.slice(pedido.fim).trim();
  const r = /^(?:(?:pr[oa]s?|para|pra)(?: o| a| os| as)?|do|da|de)\s+(.{2,40})$/.exec(resto);
  const rotulo = r ? r[1].replace(/\b(por favor|pra mim|para mim|ai|agora)\b/g, '').trim() : '';
  delete pedido.fim;
  return { ...pedido, rotulo: rotulo || null };
}

const comoDuracao = (s, en) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const partes = [];
  if (h) partes.push(`${h} ${en ? (h > 1 ? 'hours' : 'hour') : h > 1 ? 'horas' : 'hora'}`);
  if (m) partes.push(`${m} ${en ? (m > 1 ? 'minutes' : 'minute') : m > 1 ? 'minutos' : 'minuto'}`);
  if (ss) partes.push(`${ss} ${en ? (ss > 1 ? 'seconds' : 'second') : ss > 1 ? 'segundos' : 'segundo'}`);
  return partes.join(en ? ' and ' : ' e ');
};

function responderTimer({ pedido, deps = {}, config = {}, agora = new Date() }) {
  const en = config.idiomaEfetivo === 'en';
  const responder = (texto) => {
    deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
    return { ...SEM_PESQUISA, texto, modo: 'timer', noIdioma: en };
  };
  if (pedido.acao === 'cancelar') {
    deps.emit?.('timer', { acao: 'cancelar' });
    // (a tela decide: com um tocando, só cala; senão, cancela os que estão contando)
    return responder(en ? 'Done ✓ — stopped.' : 'Pronto ✓ — parei.');
  }
  let fim;
  if (pedido.segundos) fim = agora.getTime() + pedido.segundos * 1000;
  else {
    const alvo = new Date(agora);
    alvo.setHours(pedido.hora, pedido.minuto, 0, 0);
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);
    fim = alvo.getTime();
  }
  const hora = new Date(fim).toLocaleTimeString(en ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
  const amanha = new Date(fim).getDate() !== agora.getDate();
  const bloco = { idioma: en ? 'en' : 'pt', id: `t${agora.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`, inicio: agora.getTime(), fim, rotulo: pedido.rotulo, alarme: !pedido.segundos };
  const para = pedido.rotulo ? (en ? ` for **${pedido.rotulo}**` : ` para **${pedido.rotulo}**`) : '';
  const texto = pedido.segundos
    ? (en ? `⏱️ Timer of **${comoDuracao(pedido.segundos, true)}**${para} — it rings at ${hora}.` : `⏱️ Timer de **${comoDuracao(pedido.segundos, false)}**${para} — toca às ${hora}.`)
    : (en ? `⏰ Alarm set for **${hora}**${amanha ? ' tomorrow' : ''}${para}. Keep AuGPT open.` : `⏰ Alarme para as **${hora}**${amanha ? ' de amanhã' : ''}${para}. Deixe o AuGPT aberto.`);
  return responder(`${texto}\n\n\`\`\`timer\n${JSON.stringify(bloco)}\n\`\`\``);
}

module.exports = { pedidoDeTimer, duracaoNoTexto, horarioNoTexto, emNumeros, responderTimer };
