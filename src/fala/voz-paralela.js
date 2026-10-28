'use strict';

/**
 * A voz em paralelo (28/10, etapa 2 do Jarvis, ideia do Davi): enquanto o modelo principal (qwen3.5:9b, na
 * placa) trabalha num pedido, um modelo leve NA CPU (qwen3.5:4b) conversa pela voz. Medido no PC do Davi: os
 * dois carregados juntos, o 9b inteiro na placa a 75 tokens/s e o 4b na CPU respondendo em ~1,5 s.
 * O modelo leve inventa fatos (no teste, "tudo sob controle"), então: o andamento vem da tela e ele só conta
 * o que está ali; pedido novo de pesquisa, fato ou ação não é respondido por ele — vai para a fila de
 * segundo plano, onde o modelo principal faz.
 */

function sistemaDaVozParalela({ nome = 'Jarvis', usuario = '', objetivo = '', andamento = '', segundos = 0 } = {}) {
  const tempo = segundos >= 60 ? `${Math.round(segundos / 60)} min` : `${Math.max(1, Math.round(segundos))} s`;
  return `Você é o ${nome}, a voz do AuGPT, conversando${usuario ? ` com ${usuario}` : ''} pela voz enquanto o modelo principal trabalha num pedido. Responda em português do Brasil, em 1 ou 2 frases curtas, como numa conversa falada: sem listas, sem títulos, sem emojis.

O modelo principal está trabalhando neste pedido há ${tempo}: "${String(objetivo).slice(0, 300)}"
Andamento (o que a tela mostra agora): ${String(andamento).slice(0, 500) || 'começando'}

- Se perguntarem do andamento ou se vai demorar, conte só o que está no andamento acima. Não invente etapas, números nem previsões.
- Conversa, papo, opinião ou como a pessoa se sente: responda você mesmo, agora, com naturalidade. Pediram uma piada, uma curiosidade leve ou um papo? Faça na hora, sem falar do pedido em andamento.
- Se pedirem algo NOVO que precise de pesquisa, de fatos, números, preços, notícias, arquivos ou de uma ação no computador, NÃO responda o conteúdo: comece com [FILA] e diga numa frase que vai fazer isso assim que puder.
- Nunca afirme fatos, datas ou números por conta própria.`;
}

/** "[FILA] Pode deixar…" → { fila: true, resposta: 'Pode deixar…' }; tira a marcação que a voz não lê. */
function lerRespostaParalela(texto) {
  const t = String(texto || '').trim();
  const fila = /^\s*\[\s*fila\s*\]/i.test(t);
  const resposta = t
    .replace(/^\s*\[\s*fila\s*\]\s*/i, '')
    .replace(/\[\s*fila\s*\]/gi, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { fila, resposta };
}

/*
 * Quem decide a fila é o código (28/10, teste no app: "depois vê pra mim quanto está o PS5 Slim" — o 4b disse
 * "vou te avisar" sem marcar [FILA], e nada foi para a fila). Preço, clima, mapa, lembrete, "pesquise" e
 * pergunta de fato vão para o modelo principal; perguntar do andamento e bater papo ficam com o leve.
 */
const ANDAMENTO = /(?<![a-zà-ú])(como (est[aá]|t[aá]|vai) (indo|a pesquisa|isso|o pedido|a coisa)|vai demorar|demora muito|falta muito|quanto (tempo )?falta|j[aá] (terminou|acabou|achou)|o que (voc[eê] )?(est[aá]|t[aá]) fazendo|em que p[eé] est[aá])/i;
const PERGUNTA_DE_FATO = /^\s*(e\s+)?(quem|qual|quais|quanto|quantos|quantas|quando|onde|o que (é|e|significa|aconteceu)|por ?que|como (funciona|fa[zç]|se faz|eu fa[cç]o))(?![a-zà-ú])/i;
const PEDE_PESQUISA = /(?<![a-zà-ú])(pesquis\w*|procur\w*|busqu\w*|busca\w*|v[eê] (pra|para) mim|descobre|descubra)(?![a-zà-ú])/i;

function precisaDoPrincipal(texto) {
  const t = String(texto || '').trim();
  if (!t || ANDAMENTO.test(t)) return false;
  const rotas = require('../agent/rotas-do-codigo');
  const { pedidoDeCompras } = require('../agent/compras-no-chat');
  const { pedidoDeAgenda } = require('../agent/agenda-no-chat');
  return Boolean(PEDE_PESQUISA.test(t) || PERGUNTA_DE_FATO.test(t) || pedidoDeCompras(t) || rotas.intencao(t) || pedidoDeAgenda(t, new Date()));
}

const perguntaDeAndamento = (texto) => ANDAMENTO.test(String(texto || ''));
const tempoFalado = (s) => (s >= 90 ? `${Math.round(s / 60)} minutos` : s >= 60 ? 'um minuto' : `${Math.max(1, Math.round(s))} segundos`);
/**
 * "Vai demorar?" (28/10, teste: o 4b respondeu "Não" — uma previsão que ele não tem): o andamento é dito pelo
 * código, com o que o painel de atividade mostra. Ex.: "Ainda estou nisso: pesquisando na internet. Até agora,
 * 6 buscas, 3 páginas em 3 sites. Já faz 39 segundos."
 */
function respostaDeAndamento({ etapa = '', resumo = '', segundos = 0 } = {}) {
  const e = String(etapa || '').split('\n')[0].trim().replace(/[.…]+$/, '');
  const r = String(resumo || '').replace(/^\s*·\s*/, '').split(/\s*·\s*/).filter((p) => p && !/resultados? vistos?/i.test(p)).join(', ');
  return `Ainda estou nisso${e ? `: ${e.charAt(0).toLowerCase()}${e.slice(1)}` : ''}.${r ? ` Até agora, ${r}.` : ''} Já faz ${tempoFalado(Number(segundos) || 0)}.`;
}

// o que a voz diz quando o código manda para a fila (o 4b pode ter respondido o conteúdo — e inventado)
const FRASE_DA_FILA = 'Pode deixar: coloquei na fila e faço assim que terminar o pedido atual.';

/*
 * Narrar a pesquisa (28/10, pedido do Davi: "ir falando: achei isso, achei esse outro, estou analisando ainda"):
 * a cada página lida, uma frase curta sobre o que ela trouxe. O modelo leve só reconta o trecho que a página
 * tem — sem concluir nem recomendar (a conclusão é do modelo principal, que leu tudo).
 */
const nomeDoSite = (site) => String(site || '').replace(/^www\./, '').replace(/\.(com|net|org|gov|edu)(\.[a-z]{2})?$|\.[a-z]{2,3}$/i, '');

function sistemaDaNarracao({ pedido = '', primeira = true, anterior = '' } = {}) {
  const comeco = String(anterior).split(/\s+/).slice(0, 2).join(' ');
  return `Você narra em voz alta, como o Jarvis, uma pesquisa que está em andamento sobre: "${String(pedido).slice(0, 200)}".
Diga em UMA frase curta (até 18 palavras), em português do Brasil, o que a página abaixo acabou de mostrar. ${primeira ? 'Comece com "Achei" ou "Encontrei".' : `Varie o começo: "Esse outro, do …", "Já o …", "Mais um: …", "O … diz que…".${comeco ? ` Não comece com "${comeco}" (a frase anterior começou assim).` : ''}`} Diga o nome do site sem o ".com.br".
- Use só o que está no trecho. Números e nomes só se estiverem nele.
- Não conclua, não recomende e não diga que terminou: a pesquisa continua.
- Sem listas, sem markdown, sem aspas.`;
}

/** Sem o modelo leve (ou ele falhou): a frase sai pelo código. */
function narracaoPadrao({ titulo = '', site = '' } = {}, primeira = true) {
  const s = nomeDoSite(site) || 'um site';
  const t = String(titulo || '').replace(/\s*[|–—-]\s*[^|–—-]{0,40}$/, '').trim().slice(0, 90);
  return primeira ? `Achei ${t ? `"${t}"` : 'uma página'}, no ${s}.` : `Encontrei mais um, no ${s}${t ? `: ${t}` : ''}.`;
}

module.exports = { sistemaDaNarracao, narracaoPadrao, nomeDoSite, sistemaDaVozParalela, lerRespostaParalela, precisaDoPrincipal, FRASE_DA_FILA, perguntaDeAndamento, respostaDeAndamento };
