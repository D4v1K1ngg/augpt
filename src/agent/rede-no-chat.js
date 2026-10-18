'use strict';

/**
 * Teste de rede pelo chat (18/10): "teste minha internet", "mede meu ping",
 * "speed test". O código mede (src/rede/teste-de-velocidade.js), faz a tabela
 * e os gráficos com os números medidos; o modelo só explica o que eles
 * significam. O teste completo gasta até ~300 MB: na primeira vez pergunta.
 */

const { testarRede, tabelaDoResultado, graficosDoResultado } = require('../rede/teste-de-velocidade');

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const DIRETO = /\b(speed ?test|teste de (velocidade|rede|internet|conexao|ping|latencia)|teste (da|de|na) (minha )?(internet|conexao|rede)|bufferbloat test)\b/;
// "o que fazer?" é pedido de conselho: fazer não conta como ação de medir
const ACAO = /\b(test\w*|meca|medir|mede|verifi\w*|confer\w*|cheq\w*|chec\w*|analis\w*|rode|roda)\b/;
const ALVO = /\b(internet|conexao|rede|velocidade|ping|latencia|bufferbloat|wi-?fi|banda larga|download|upload)\b/;
const DO_USUARIO = /\b(minha|meu|nossa|nosso|daqui|aqui|esta|essa)\b/;
// "como funciona o teste de velocidade?" é explicação, não pedido de teste
const EXPLICACAO = /\b(como funciona|o que (e|significa|quer dizer)|por que|porque|para que serve|explique|explica)\b/;
const SO_PING = /\b(so|apenas|somente) (o )?(ping|latencia)\b|\b(meu|o) ping\b/;
const QUER_VELOCIDADE = /\b(velocidade|download|upload|banda|bufferbloat|mbps|completo)\b/;
const MARCA_DA_PERGUNTA = 'O teste completo baixa e envia até';
const SIM = /^\s*(sim|pode|ok|okay|blz|beleza|manda|vai|claro|confirmo|bora|pode sim|pode testar|pode fazer|faz|faca|isso|s)\b/;

/**
 * O pedido é de teste de rede? → null ou { modo: 'ping' | 'completo', confirmado }.
 * `conversa`: a última resposta do AuGPT pode ser a pergunta de confirmação.
 */
function pedidoDeRede(texto, conversa = []) {
  const t = norm(texto);
  const ultima = [...conversa].reverse().find((m) => m.role === 'assistant');
  const perguntouAntes = ultima && String(ultima.content || '').includes(MARCA_DA_PERGUNTA);
  if (perguntouAntes && (SIM.test(t) || SO_PING.test(t) || /\bso (a )?latencia\b/.test(t))) {
    return { modo: SO_PING.test(t) || /\bso (a )?latencia\b/.test(t) ? 'ping' : 'completo', confirmado: true };
  }
  const pede = (DIRETO.test(t) || (ACAO.test(t) && ALVO.test(t) && (DO_USUARIO.test(t) || /\binternet\b/.test(t)))) && !(EXPLICACAO.test(t) && !DO_USUARIO.test(t));
  if (!pede) return null;
  const modo = (SO_PING.test(t) || /\b(ping|latencia|jitter)\b/.test(t)) && !QUER_VELOCIDADE.test(t) ? 'ping' : 'completo';
  return { modo, confirmado: modo === 'ping' || /\b(pode (usar|gastar)|sem problema|confirmo|pode testar)\b/.test(t) };
}

const PERGUNTA_DE_CONFIRMACAO = `Posso medir a sua internet agora. ${MARCA_DA_PERGUNTA} **cerca de 300 MB** em uns 15 segundos, para medir download, upload e o bufferbloat (quanto o ping sobe quando a linha está cheia) — em internet com franquia, isso conta.

Responda **"pode testar"** para seguir, ou **"só o ping"** para medir só a latência, quase sem gastar dados.`;

function pedidoDeExplicacao(pergunta, r, hoje) {
  // fase que não foi medida vai com o motivo (18/10: o 429 virou "0 Mbps" e o modelo inventou um bloqueio)
  const fase = (nome, f, aumento) => (f.erro ? `${nome}: NÃO MEDIDO — ${f.erro} (não é defeito da internet do usuário)` : `${nome} ${f.mbps} Mbps, latência com a linha cheia ${f.latencia} ms (${aumento >= 0 ? '+' : ''}${aumento} ms)`);
  const dados = r.download
    ? `${fase('download', r.download, r.bufferbloat.aumentoDown)}; ${fase('upload', r.upload, r.bufferbloat.aumentoUp)}; latência parado ${r.ocioso.mediana} ms (jitter ${r.ocioso.jitter} ms); perda ${r.ocioso.perdaPct}%; nota de bufferbloat ${r.bufferbloat.nota ?? 'não calculada'}`
    : `latência ${r.ocioso.mediana} ms; jitter ${r.ocioso.jitter} ms; perda ${r.ocioso.perdaPct}% (só latência: velocidade não foi medida)`;
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de medir a internet do usuário, contra o servidor de teste da Cloudflare${r.servidor ? ` (${r.servidor})` : ''}. Resultado medido: ${dados}.

Explique o resultado para quem não é técnico, em português do Brasil, em 2 a 4 parágrafos curtos (a tabela com os números já aparece acima da sua explicação: não a repita).
- Use SÓ os números medidos acima; não invente outros.
- Velocidade: diga se dá conta do uso comum (vídeo 4K pede uns 25 Mbps por tela; vários aparelhos ao mesmo tempo pedem mais) e se o upload serve para chamada de vídeo e transmissão.
- Latência e jitter: o que significam para jogo online e chamada (até uns 30 ms e jitter baixo é ótimo; acima de 100 ms já se sente).
- Bufferbloat: o que a nota quer dizer. Se for C ou pior, diga como melhorar: ativar SQM ou QoS no roteador (Smart Queue, cake, fq_codel), limitar a banda um pouco abaixo da contratada, usar cabo em vez de Wi-Fi.
- Perda acima de 1%: aponte como problema (Wi-Fi fraco, cabo ou operadora).
- O que não foi medido: diga só o motivo dado acima e quando tentar de novo; não invente causa (bloqueio, provedor, roteador).
- Responda também ao que o usuário perguntou, se ele perguntou algo além de testar.`,
    },
    { role: 'user', content: pergunta },
  ];
}

/** Roda o teste e monta a resposta (mesma forma do núcleo: { texto, fontes, … }). */
async function responderRede({ pergunta, conversa = [], deps, signal, hoje = new Date().toLocaleDateString('pt-BR'), medir = testarRede }) {
  const pedido = pedidoDeRede(pergunta, conversa);
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'rede' };
  if (!pedido.confirmado) {
    deps.emit?.('resposta-token', { pedaco: PERGUNTA_DE_CONFIRMACAO });
    return { ...vazio, texto: PERGUNTA_DE_CONFIRMACAO };
  }
  const emit = deps.emit || (() => {});
  emit('ferramenta', { nome: 'teste_de_rede', argumentos: { consulta: pedido.modo === 'ping' ? 'latência, jitter e perda' : 'velocidade, latência e bufferbloat' }, risco: 'leitura' });
  let fase = '';
  const r = await medir({
    modo: pedido.modo,
    signal,
    aoProgresso: (p) => {
      if (p.fase !== fase) {
        fase = p.fase;
        emit('ferramenta', { nome: 'teste_de_rede', argumentos: { consulta: `medindo: ${fase}` }, risco: 'leitura' });
      }
    },
  });
  const tabela = tabelaDoResultado(r);
  emit('resposta-token', { pedaco: `${tabela}\n\n` });
  const explicacao = String((await deps.escrever(pedidoDeExplicacao(pergunta, r, hoje), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  const graficos = graficosDoResultado(r);
  const sugestao = pedido.modo === 'ping' ? '\n\n*Para medir velocidade e bufferbloat, peça "teste completo da minha internet".*' : '';
  return { ...vazio, texto: `${tabela}\n\n${explicacao}${graficos.length ? `\n\n${graficos.join('\n\n')}` : ''}${sugestao}`, rede: r };
}

module.exports = { pedidoDeRede, responderRede, PERGUNTA_DE_CONFIRMACAO };
