'use strict';

/**
 * Áudio anexado (31/10, mensagem de voz do WhatsApp): a tela já transcreveu com o Whisper local (renderer/
 * audio-anexo.js) e mandou o texto no pedido. Aqui: a transcrição aparece na resposta e, se for longa ou vier com
 * uma pergunta ("o que ele pediu pra eu levar?"), o modelo resume ou responde — só pelo que foi dito, sem pesquisar.
 */

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const BLOCO = /\n*Transcrição do áudio "([^"\n]+)" \(([\d:]+)\):\n"""\n([\s\S]*?)\n"""/g;
const SO_O_AUDIO = /^(o que diz este audio\??|resuma este audio\.?|resume|resuma|transcreva|transcreve|o que (ele|ela) (disse|falou|diz)\??)$/;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** { audios: [{ nome, duracao, texto }], pergunta } ou null. Com outros anexos junto, quem responde é o agente. */
function pedidoDeAudio(objetivo) {
  const t = String(objetivo || '');
  if (/\n\nArquivos anexados, já copiados/.test(t)) return null;
  const audios = [...t.matchAll(BLOCO)].map((m) => ({ nome: m[1], duracao: m[2], texto: m[3].trim() }));
  if (!audios.length) return null;
  const pergunta = t.replace(BLOCO, '').trim();
  return { audios, pergunta: SO_O_AUDIO.test(semAcento(pergunta)) ? '' : pergunta };
}

const palavras = (t) => String(t).split(/\s+/).filter(Boolean).length;

async function responderAudio({ pedido, deps = {}, config = {} }) {
  const en = config.idiomaEfetivo === 'en';
  const semFala = pedido.audios.every((a) => !a.texto || a.texto === '(sem fala no áudio)');
  const transcricoes = pedido.audios
    .map((a) => `🎙️ **${a.nome}** (${a.duracao})\n\n> ${(a.texto || (en ? '(no speech)' : '(sem fala no áudio)')).replace(/\n+/g, '\n> ')}`)
    .join('\n\n');
  let topo = '';
  const longo = pedido.audios.reduce((n, a) => n + palavras(a.texto), 0) > 45;
  if (!semFala && (longo || pedido.pergunta) && deps.chamar) {
    const sistema = en
      ? 'You read transcripts of voice messages (Whisper may mishear a word). Answer in English, short and plain. Use ONLY what was said; if the answer is not in the audio, say so. Never invent names, dates or amounts.'
      : 'Você lê transcrições de mensagens de voz (o Whisper pode ter errado uma palavra). Responda em português do Brasil, curto e simples. Use SÓ o que foi dito; se a resposta não está no áudio, diga isso. Nunca invente nomes, datas ou valores.';
    const tarefa = pedido.pergunta
      ? `${en ? 'Question' : 'Pergunta'}: ${pedido.pergunta}`
      : en ? 'Summarize in 2 to 4 short sentences: who asks what, and any date, time, place or amount mentioned.' : 'Resuma em 2 a 4 frases curtas: quem pede o quê, e qualquer data, horário, lugar ou valor citado.';
    const audios = pedido.audios.map((a) => `[${a.nome}, ${a.duracao}]\n${a.texto}`).join('\n\n');
    try {
      const r = await deps.chamar([{ role: 'system', content: sistema }, { role: 'user', content: `${audios}\n\n${tarefa}` }], { numPredict: 400 });
      const resposta = String(r?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (resposta) topo = pedido.pergunta ? resposta : `**${en ? 'Summary' : 'Resumo'}:** ${resposta}`;
    } catch {
      // sem o modelo, fica só a transcrição
    }
  }
  const texto = semFala
    ? `${en ? "I couldn't hear any speech in this audio." : 'Não ouvi fala neste áudio.'}\n\n${transcricoes}`
    : topo ? `${topo}\n\n${transcricoes}` : transcricoes;
  deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
  return { ...SEM_PESQUISA, texto, modo: 'audio', noIdioma: en };
}

module.exports = { pedidoDeAudio, responderAudio };
