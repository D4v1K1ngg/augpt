'use strict';

/**
 * Teste de rede pelo chat (18/10): "teste minha internet", "mede meu ping",
 * "speed test". O código mede (src/rede/teste-de-velocidade.js), faz a tabela
 * e os gráficos com os números medidos; o modelo só explica o que eles
 * significam. O teste completo gasta até ~300 MB: na primeira vez pergunta.
 */

const { testarRede, tabelaDoResultado, graficosDoResultado } = require('../rede/teste-de-velocidade');
const rotas = require('../rede/rotas');
const trafego = require('../rede/trafego');
const raioX = require('../rede/raio-x');

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
async function responderRede({ pergunta, conversa = [], deps, signal, hoje = new Date().toLocaleDateString('pt-BR'), medir = testarRede, pedido: dado = null }) {
  // pedido vindo do entendimento ou do "sim" à oferta (capacidades.js); senão, pelas palavras
  const pedido = dado || pedidoDeRede(pergunta, conversa) || { modo: 'completo', confirmado: false };
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

/* ------------------------------ rotas para jogos (item 3) ------------------------------ */

// "lag" sozinho não pede medição (18/10: "meu pubg está com lag, o que fazer?" mediu direto — é pedido de
// conselho; o entendimento oferece a medição no fim, ver capacidades.js)
const PEDE_ROTA = /\b(rota|rotas|tracert|traceroute|ping|latencia|servidor|servidores|server)\b/;
const PEDE_CONSELHO = /\b(o que (eu )?(fa[cç]o|fazer|posso fazer)|como (resolv\w*|melhor\w*|diminu\w*|reduz\w*|arrum\w*|consert\w*|tir\w*|baix\w*)|dicas?)\b/;
const ROTA_SEM_JOGO = /\b(tracert|traceroute|rota (ate|para|pro|pra)|rotas? (do|dos|de) (jogo|servidor))\b/;

/** "qual meu ping nos servidores do PUBG?", "rota até o servidor do CS2", "tracert" → { jogo } ou null. */
function pedidoDeRota(texto) {
  const t = norm(texto);
  const jogo = rotas.jogoDoTexto(t);
  if (PEDE_CONSELHO.test(t) && !ACAO.test(t)) return null;
  if (jogo && PEDE_ROTA.test(t)) return { jogo };
  if (ROTA_SEM_JOGO.test(t) || (/\b(jogo|jogos|game|games)\b/.test(t) && /\b(ping|rota|latencia|lag)\b/.test(t) && !EXPLICACAO.test(t))) return { jogo: 'aws' };
  return null;
}

// a classificação e a recomendação são do código (18/10: o 2B leu "148 a 367 ms" como "latências
// extremamente baixas" e disse que Oregon, com 199 ms, era o menor ping)
const classe = (ms) => (ms <= 50 ? 'ótimo para jogar' : ms <= 100 ? 'bom' : ms <= 150 ? 'jogável, com atraso perceptível' : 'ruim para jogo competitivo');
const recomendacao = (r) => `**Recomendado: ${r.melhor.nome} (${r.melhor.ms} ms — ${classe(r.melhor.ms)}).**${r.destinos[1] ? ` O segundo melhor, ${r.destinos[1].nome}, tem ${r.destinos[1].ms} ms (+${r.destinos[1].ms - r.melhor.ms} ms).` : ''}`;

function pedidoDeExplicacaoDaRota(pergunta, r, hoje) {
  const salto = rotas.maiorSalto(r.rota);
  const top = r.destinos.slice(0, 8).map((d, i) => `${d.nome}: ${d.ms} ms, ${classe(d.ms)}${i ? ` (+${d.ms - r.melhor.ms} ms em relação ao melhor)` : ' (O MELHOR)'}${d.perdaPct ? `, ${d.perdaPct}% perda` : ''}`).join('; ');
  const caminho = r.rota.length
    ? `Caminho até ${r.melhor.nome}: ${r.rota.length} saltos; ${r.rota.filter((s) => !Number.isFinite(s.ms)).length} não responderam ao teste; roteador de casa ${Number.isFinite(r.rota[0]?.ms) ? `${r.rota[0].ms} ms` : 'sem resposta'}; ${salto ? `maior aumento: +${salto.aumento} ms entre os saltos ${salto.de} e ${salto.para} (${salto.onde})` : 'sem aumento grande'}.`
    : 'O caminho (tracert) não foi medido.';
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de medir, do computador do usuário, o ping até os servidores do ${r.jogo.nome}. Medido: ${top}. ${caminho}${r.jogo.nota ? ` Observação: ${r.jogo.nota}` : ''}${r.semResposta.length ? ` Não responderam: ${r.semResposta.join(', ')}.` : ''}

Explique para o jogador, em português do Brasil, em 2 a 4 parágrafos curtos (as tabelas já aparecem acima: não as repita).
- Recomende o servidor marcado como O MELHOR (é o de menor ping, medido) e use a classificação que vem junto de cada um — não reclassifique.
- Explique o que o ping significa no jogo (até uns 50 ms é ótimo; 50 a 100 joga bem; acima de 150 se sente bastante).
- Use SÓ os números medidos acima; não invente outros.
- Sobre o caminho: saltos que não respondem são normais (muitos roteadores ignoram o teste). Se a latência sobe muito já no roteador de casa ou na rede da operadora, diga o que isso indica (Wi-Fi, roteador sobrecarregado, operadora); se só sobe na distância até o servidor, é a distância física, não defeito.
- Se houver a observação acima sobre como a medida foi feita, diga isso numa frase.
- Responda também ao que o usuário perguntou, se ele perguntou algo além do ping.`,
    },
    { role: 'user', content: pergunta },
  ];
}

async function responderRota({ pergunta, deps, hoje = new Date().toLocaleDateString('pt-BR'), medir = rotas.medirJogo, jogo: dado = null }) {
  const jogo = dado || pedidoDeRota(pergunta)?.jogo || 'aws';
  const emit = deps.emit || (() => {});
  emit('ferramenta', { nome: 'rota_de_jogo', argumentos: { consulta: `servidores do ${rotas.JOGOS[jogo].nome}` }, risco: 'leitura' });
  const r = await medir(jogo, { aoProgresso: (p) => emit('ferramenta', { nome: 'rota_de_jogo', argumentos: { consulta: p }, risco: 'leitura' }) });
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'rede' };
  if (!r.destinos.length) {
    const texto = `Não consegui medir o ping até os servidores do ${r.jogo.nome}: nenhum respondeu (sem internet, ou um firewall bloqueando o ping).`;
    emit('resposta-token', { pedaco: texto });
    return { ...vazio, texto };
  }
  const t = rotas.tabelasDoJogo(r);
  const topo = `**Ping até os servidores do ${r.jogo.nome}**\n\n${recomendacao(r)}\n\n${t.regioes}${t.rota ? `\n\n**Caminho até ${r.melhor.nome}** (tracert)\n\n${t.rota}` : ''}${r.jogo.nota ? `\n\n*${r.jogo.nota}*` : ''}`;
  emit('resposta-token', { pedaco: `${topo}\n\n` });
  const explicacao = String((await deps.escrever(pedidoDeExplicacaoDaRota(pergunta, r, hoje), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  const graficos = rotas.graficosDoJogo(r);
  return { ...vazio, texto: `${topo}\n\n${explicacao}${graficos.length ? `\n\n${graficos.join('\n\n')}` : ''}`, rota: r };
}

/* ------------------------------ tráfego por programa (item 5) ------------------------------ */

// "o que está consumindo minha internet?", "quais programas estão usando a rede?", "analise o tráfego"
const PEDE_TRAFEGO = /\b(trafego|consumindo|consome|usando|gastando|puxando|conexoes|conectados?)\b[^.?!]{0,40}\b(internet|rede|banda|wi-?fi|dados)\b|\b(programas?|aplicativos?|apps?|processos?)\b[^.?!]{0,40}\b(internet|rede|banda|conect\w*)\b|\btrafego (de|da|na) (minha )?(rede|internet)\b/;
const COMO_FAZER = /\b(como (analis\w*|ver|vejo|monitor\w*|descobr\w*|saber)|o que e|o que significa)\b/;

function pedidoDeTrafego(texto) {
  const t = norm(texto);
  if (!PEDE_TRAFEGO.test(t)) return null;
  if (COMO_FAZER.test(t) && !DO_USUARIO.test(t)) return null; // "como analisar o tráfego de rede?" é pergunta
  return { segundos: 6 };
}

function pedidoDeExplicacaoDoTrafego(pergunta, r, hoje) {
  const programas = r.programas
    .slice(0, 10)
    .map((p) => `${p.nome}: ${p.tcp} conexões ativas, ${p.udp} portas UDP${p.servicos.length ? `, conectado a ${p.servicos.join(', ')}` : p.destinos.length ? `, ${p.destinos.length} servidores sem nome conhecido` : ''}`)
    .join('; ');
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de olhar a rede do computador do usuário por ${r.taxa.length} segundos. Placa de rede: recebendo ${r.media.downMbps} Mbps em média (pico ${r.pico.downMbps}), enviando ${r.media.upMbps} Mbps (pico ${r.pico.upMbps}). Programas com conexão: ${programas || 'nenhum'}.

Explique para quem não é técnico, em português do Brasil, em 2 a 4 parágrafos curtos (a tabela já aparece acima: não a repita).
- Diga se o tráfego de agora é alto ou baixo (um vídeo em HD usa uns 5 Mbps; um download grande usa o que a linha der).
- Diga quais programas parecem estar usando a internet e para quê, pelo serviço a que se conectam. Atenção: o Windows não informa a banda de cada programa sem administrador — não diga quanto cada um consome; fale de quem está conectado e a quê.
- Explique os nomes do sistema que costumam aparecer (svchost: serviços do Windows, como atualização; System: o próprio Windows) e que portas UDP são normais em jogos, chamadas e no próprio Windows.
- Se perguntarem como saber a banda de cada programa: o Monitor de Recursos do Windows (resmon, aba Rede) mostra, e abre sem instalar nada.
- Use SÓ os dados acima; não invente programa nem serviço.`,
    },
    { role: 'user', content: pergunta },
  ];
}

async function responderTrafego({ pergunta, deps, hoje = new Date().toLocaleDateString('pt-BR'), medir = trafego.medirTrafego }) {
  const emit = deps.emit || (() => {});
  emit('ferramenta', { nome: 'trafego_de_rede', argumentos: { consulta: 'programas e tráfego da placa de rede' }, risco: 'leitura' });
  const r = await medir({ segundos: pedidoDeTrafego(pergunta)?.segundos || 6, aoProgresso: (p) => emit('ferramenta', { nome: 'trafego_de_rede', argumentos: { consulta: p }, risco: 'leitura' }) });
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'rede' };
  const tabela = trafego.tabelaDoTrafego(r);
  emit('resposta-token', { pedaco: `${tabela}\n\n` });
  const explicacao = String((await deps.escrever(pedidoDeExplicacaoDoTrafego(pergunta, r, hoje), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  const graficos = trafego.graficosDoTrafego(r);
  return { ...vazio, texto: `${tabela}\n\n${explicacao}${graficos.length ? `\n\n${graficos.join('\n\n')}` : ''}` };
}

/* ------------------------------ raio-X da rede local (18/10) ------------------------------ */

// reserva das palavras (o caminho principal é o entendimento, ver capacidades.js)
const PEDE_RAIO_X = /\b(raio-?x da (minha )?rede|ipconfig|quantos (aparelhos|dispositivos)|quais (aparelhos|dispositivos)|(aparelhos|dispositivos) (conectados|na (minha )?rede|ligados)|qual (e |eh )?o (modelo do |)(meu )?roteador|modelo do (meu )?roteador|meu roteador e qual)\b/;

function pedidoDeDiagnostico(texto) {
  const t = norm(texto);
  if (!PEDE_RAIO_X.test(t)) return null;
  if (COMO_FAZER.test(t) && !DO_USUARIO.test(t)) return null; // "como ver quantos aparelhos…" de outra rede é pergunta
  return {};
}

function pedidoDeExplicacaoDoRaioX(pergunta, r, achados, conversa, hoje) {
  const ap = r.aparelhos.filter((a) => !a.roteador);
  const porTipo = {};
  for (const a of ap) {
    const k = a.aleatorio ? 'celular ou notebook (endereço privado)' : a.tipo || 'não identificado';
    porTipo[k] = (porTipo[k] || 0) + 1;
  }
  // um teste de internet anterior nesta conversa diz se a linha cheia faz o ping subir (bufferbloat)
  const nota = /Bufferbloat \| \*\*nota ([A-F]\+?)\*\*/.exec(conversa.map((m) => m.content).join('\n'))?.[1] || null;
  const dados = [
    r.ligacao ? `ligação do PC: ${r.ligacao.tipo}, ${r.ligacao.velocidade}` : null,
    r.wifi ? `Wi-Fi: sinal ${r.wifi.sinal}%, ${r.wifi.banda}, canal ${r.wifi.canal}, ${r.wifi.padrao}` : null,
    r.ping ? `ping até o roteador: ${r.ping.mediana} ms, jitter ${r.ping.jitter} ms, pior ${r.ping.pior} ms, perda ${r.ping.perdaPct}%` : null,
    r.roteador ? `roteador: ${[r.roteador.fabricante, r.roteador.modelo].filter(Boolean).join(' ') || 'não identificado'}${r.roteador.firmware ? `, firmware de ${r.roteador.firmware.data}` : ''}` : null,
    `aparelhos na rede além do roteador: ${ap.length} (${Object.entries(porTipo).map(([k, n]) => `${n} ${k}`).join('; ')})`,
    `DNS: ${r.config.dns.join(', ') || '—'}`,
    nota ? `teste de internet feito antes nesta conversa: bufferbloat nota ${nota}` : null,
  ].filter(Boolean).join('\n');
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de fazer o raio-X da rede local do usuário (só leitura). Medido:
${dados}
Avaliação do código (o que está fora do normal): ${achados.length ? achados.map((a) => `${a.grave ? '[importante] ' : ''}${a.texto}`).join('; ') : 'nada fora do normal'}.

Explique para o usuário, em português do Brasil, em 2 a 4 parágrafos curtos (a tabela já aparece acima: não a repita).
- Comece respondendo o que ele perguntou, com esses números.
- O trecho PC → roteador: ping de 1 a 2 ms no cabo (até uns 5 ms no Wi-Fi), sem perda, é ótimo; aí o problema não está na casa.
- Aparelhos: a quantidade em si não causa lag — o que causa é algum deles usando muita internet ao mesmo tempo (download, vídeo, atualização). ${nota ? `O teste anterior deu bufferbloat ${nota}: ${/^A/.test(nota) ? 'mesmo com a linha cheia o ping não sobe, então os aparelhos não estão atrapalhando' : 'com a linha cheia o ping sobe; aí aparelhos baixando coisas atrapalham, e o QoS/SQM do roteador ajuda'}.` : 'Para saber se eles atrapalham, o teste de internet com bufferbloat mede isso.'}
- Diga o que cada ponto da avaliação significa e o que fazer, de forma prática.
- Tudo acima JÁ FOI MEDIDO agora pelo AuGPT (inclusive o ping até o roteador): não mande o usuário rodar ping, ipconfig ou outro teste que repita isso.
- Use SÓ os dados acima; não invente.`,
    },
    { role: 'user', content: pergunta },
  ];
}

async function responderDiagnostico({ pergunta, conversa = [], deps, hoje = new Date().toLocaleDateString('pt-BR'), medir = raioX.raioX }) {
  const emit = deps.emit || (() => {});
  emit('ferramenta', { nome: 'raio_x_da_rede', argumentos: { consulta: 'placa, Wi-Fi, ping até o roteador, aparelhos e roteador' }, risco: 'leitura' });
  const r = await medir({ aoProgresso: (p) => emit('ferramenta', { nome: 'raio_x_da_rede', argumentos: { consulta: p }, risco: 'leitura' }) });
  const achados = raioX.avaliar(r);
  const tabela = raioX.tabelaDoRaioX(r);
  const resumo = achados.length ? `**O que chamou atenção:**\n${achados.map((a) => `- ${a.grave ? '⚠ ' : ''}${a.texto}`).join('\n')}` : '**Nada fora do normal na rede local.**';
  emit('resposta-token', { pedaco: `${tabela}\n\n${resumo}\n\n` });
  const explicacao = String((await deps.escrever(pedidoDeExplicacaoDoRaioX(pergunta, r, achados, conversa, hoje), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  const graficos = raioX.graficosDoRaioX(r);
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'rede' };
  return { ...vazio, texto: `${tabela}\n\n${resumo}\n\n${explicacao}${graficos.length ? `\n\n${graficos.join('\n\n')}` : ''}`, raioX: r, achados };
}

module.exports = { pedidoDeRede, responderRede, PERGUNTA_DE_CONFIRMACAO, pedidoDeRota, responderRota, pedidoDeTrafego, responderTrafego, pedidoDeDiagnostico, responderDiagnostico };
