'use strict';

/**
 * Erro temporário × definitivo nas ferramentas de leitura (2026-10-10).
 *
 * As ferramentas lançam `Error` com texto livre, e o loop devolvia esse texto
 * ao modelo do mesmo jeito em qualquer caso. Dois desperdícios saíam disso:
 *   - falha passageira (timeout, conexão derrubada, HTTP 429/5xx) virava erro
 *     definitivo da execução, quando uma segunda tentativa costuma passar;
 *   - erro que não muda com nova tentativa (404, 403 de bloqueio, arquivo que
 *     não existe) era repetido pelo modelo, gastando passos.
 * Aqui o texto vira uma classificação. Quem usa (loop.js) tenta de novo UMA
 * vez o temporário — só em ferramenta que apenas lê — e diz ao modelo, no
 * definitivo, que repetir a mesma chamada não adianta.
 */

// códigos que não mudam numa segunda tentativa logo em seguida
const DEFINITIVO = [
  /\bHTTP\s*(?:400|401|403|404|405|410|451)\b/i,
  /\b(?:400|401|403|404|410|451)\s*(?:bad request|unauthorized|forbidden|not found|gone)/i,
  /\bENOENT\b|\bEISDIR\b|\bENOTDIR\b|\bENOTFOUND\b/,
  /^\s*bloqueado:/i,
  /n[aã]o existe|fora da pasta|caminho.*fora|informe "|precisa come[cç]ar com http|endere[cç]o (?:interno|da rede local)|bloquead[oa] por|sem chave configurada|maior que o limite|redirecionamentos demais/i,
];

// sinais de falha passageira (rede, servidor sobrecarregado, limite de taxa)
const TEMPORARIO = [
  /\bHTTP\s*(?:408|425|429|500|502|503|504)\b/i,
  /\btime-?out\b|tempo esgotado|timed out|\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b/i,
  /\bECONNRESET\b|\bECONNREFUSED\b|\bEPIPE\b|\bEAI_AGAIN\b|\bENETUNREACH\b|\bEHOSTUNREACH\b/,
  /socket hang up|fetch failed|network (?:error|request failed)|conex[aã]o (?:recusada|encerrada|interrompida)|too many requests|service unavailable|bad gateway/i,
  /nenhum provedor de busca respondeu/i,
];

// Dos temporários, só os que costumam passar numa segunda tentativa LOGO EM
// SEGUIDA e falham rápido. Fora daqui de propósito (medido na bancada: a
// primeira versão repetia tudo e a rodada foi de 16 s para 293 s):
//   - timeout: repetir custa outro timeout inteiro;
//   - "nenhum provedor de busca respondeu": a cadeia de provedores já tentou
//     cada um; repetir a cadeia é esperar tudo de novo;
//   - conexão recusada / rede inalcançável: costuma ser o serviço fora do ar.
const REPETIVEL = [
  /\bHTTP\s*(?:429|500|502|503|504)\b/i,
  /\bECONNRESET\b|\bEPIPE\b|\bEAI_AGAIN\b/,
  /socket hang up|too many requests|service unavailable|bad gateway/i,
];

/**
 * `{ tipo: 'temporario' | 'definitivo' | 'desconhecido', motivo, repetivel }`.
 * Definitivo vence: "html direto: HTTP 404 | render-js: timeout" é página que
 * não existe, e tentar de novo só repetiria o timeout. Timeout junto de 503
 * também não é repetível: o timeout já diz que a segunda tentativa é cara.
 */
function classificarErro(erro) {
  const texto = String(erro?.message ?? erro ?? '');
  if (!texto) return { tipo: 'desconhecido', motivo: '', repetivel: false };
  const def = DEFINITIVO.find((re) => re.test(texto));
  if (def) return { tipo: 'definitivo', motivo: (texto.match(def) || [''])[0], repetivel: false };
  const tmp = TEMPORARIO.find((re) => re.test(texto));
  if (tmp) {
    const lento = TEMPORARIO[1].test(texto) || TEMPORARIO[4].test(texto);
    return { tipo: 'temporario', motivo: (texto.match(tmp) || [''])[0], repetivel: !lento && REPETIVEL.some((re) => re.test(texto)) };
  }
  return { tipo: 'desconhecido', motivo: '', repetivel: false };
}

/** Sufixo que vai no erro devolvido ao modelo (e que a Tarefa reconhece). */
const MARCA_DEFINITIVO = '[erro definitivo: repetir a mesma chamada não adianta — use outra fonte, outro endereço ou outro caminho]';
const MARCA_TEMPORARIO = '[falha temporária: já tentei de novo e não deu — tente outra fonte ou siga com o que já tem]';

function anotarErro(mensagem, classificacao, { tentouDeNovo = false } = {}) {
  const m = String(mensagem || '');
  if (classificacao?.tipo === 'definitivo' && !m.includes(MARCA_DEFINITIVO)) return `${m} ${MARCA_DEFINITIVO}`;
  if (classificacao?.tipo === 'temporario' && tentouDeNovo && !m.includes(MARCA_TEMPORARIO)) return `${m} ${MARCA_TEMPORARIO}`;
  return m;
}

const esperar = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('interrompido'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason || new Error('interrompido'));
      },
      { once: true }
    );
  });

/**
 * Roda `executar()`; se falhar com erro TEMPORÁRIO, espera um pouco e tenta
 * de novo (uma vez, por padrão). Quem chama decide se a ferramenta pode ser
 * repetida — só leitura: escrever arquivo, rodar comando ou clicar num site
 * duas vezes não é "tentar de novo", é fazer duas vezes.
 */
async function comNovaTentativa(executar, { tentativas = 1, esperaMs = 1500, maxDuracaoMs = 8000, signal, aoTentarDeNovo = () => {} } = {}) {
  let ultima;
  for (let i = 0; i <= tentativas; i += 1) {
    const inicio = Date.now();
    try {
      return await executar();
    } catch (err) {
      ultima = err;
      if (signal?.aborted) throw err;
      const c = classificarErro(err);
      // tentativa que já demorou não se repete: a segunda tende a demorar igual
      const demorou = Date.now() - inicio > maxDuracaoMs;
      if (!c.repetivel || demorou || i === tentativas) {
        err.classificacao = c;
        err.tentouDeNovo = i > 0;
        throw err;
      }
      aoTentarDeNovo({ tentativa: i + 1, motivo: c.motivo, erro: String(err.message || err).slice(0, 300) });
      await esperar(esperaMs * (i + 1), signal);
    }
  }
  throw ultima;
}

module.exports = { classificarErro, anotarErro, comNovaTentativa, MARCA_DEFINITIVO, MARCA_TEMPORARIO };
