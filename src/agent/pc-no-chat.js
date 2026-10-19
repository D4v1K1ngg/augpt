'use strict';

/**
 * Consultas ao PC pelo chat (19/10): "quanto espaço livre meu pc tem?",
 * "qual a marca do meu mouse?", "meu windows está atualizado?", "quantas fotos
 * eu tenho e onde estão?". O código lê (src/pc/inspetor.js, só leitura), faz as
 * tabelas e o resumo do que chamou atenção; o modelo explica em linguagem simples.
 */

const inspetor = require('../pc/inspetor');
const catalogo = require('./capacidades');

/** A pergunta é sobre este PC? → { ids } ou null. */
function pedidoDeConsultaPC(texto) {
  const ids = inspetor.consultasDoPedido(texto);
  return ids.length ? { ids } : null;
}

function pedidoDeExplicacao(pergunta, blocos, avisos, hoje) {
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de CONSULTAR o computador do usuário (só leitura: não mudou nada). O que ele leu:

${blocos.join('\n\n')}

O que chamou atenção: ${avisos.length ? avisos.join('; ') : 'nada fora do normal'}.

Responda ao que o usuário perguntou, em português do Brasil, em 1 a 3 parágrafos curtos, para quem não é técnico (as tabelas já aparecem acima: não as repita inteiras).
- Comece pela resposta direta, com os números lidos.
- Explique o que for termo técnico (SSD, NVMe, driver, build) numa frase.
- Se algo chamou atenção, diga o que fazer, de forma prática — quem faz é o usuário (o AuGPT só consulta).
- Use SÓ o que foi lido acima; não invente marca, modelo ou número.`,
    },
    { role: 'user', content: pergunta },
  ];
}

async function responderConsultaPC({ pergunta, deps, ids: dados = null, hoje = new Date().toLocaleDateString('pt-BR'), modulo = inspetor }) {
  const emit = deps.emit || (() => {});
  // pelo entendimento sem palavras que apontem a consulta: a ficha básica do PC
  const ids = dados || modulo.consultasDoPedido(pergunta);
  const escolhidas = ids.length ? ids : ['sistema', 'discos'];
  emit('ferramenta', { nome: 'consultar_pc', argumentos: { consulta: `lendo ${escolhidas.join(', ')} (só leitura)` }, risco: 'leitura' });
  const r = await modulo.consultar(escolhidas, { texto: pergunta, aoProgresso: (p) => emit('ferramenta', { nome: 'consultar_pc', argumentos: { consulta: p }, risco: 'leitura' }) });
  const { blocos, avisos, ofertas } = modulo.blocosDaResposta(escolhidas, r);
  // "tenho o Discord instalado?": a resposta direta pela lista de programas
  if (r.programas) {
    const achados = modulo.programasDaPergunta(pergunta, r.programas);
    if (achados && achados.length) blocos.push(`**Instalado:** ${achados.slice(0, 8).map((p) => `${p.nome}${p.versao ? ` ${p.versao}` : ''}`).join('; ')}.`);
    else if (achados) blocos.push('**Não encontrei esse programa** na lista do que está instalado.');
  }
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'pc' };
  if (r.erro && !blocos.length) {
    const texto = `Não consegui consultar o computador: ${r.erro}.`;
    emit('resposta-token', { pedaco: texto });
    return { ...vazio, texto };
  }
  const resumo = avisos.length ? `**O que chamou atenção:**\n${avisos.map((a) => `- ${a}`).join('\n')}` : '';
  const topo = `${blocos.join('\n\n')}${resumo ? `\n\n${resumo}` : ''}`;
  emit('resposta-token', { pedaco: `${topo}\n\n` });
  const explicacao = String((await deps.escrever(pedidoDeExplicacao(pergunta, blocos, avisos, hoje), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  const oferta = ofertas.length ? `\n\n${catalogo.ofertaDePesquisa(ofertas[0])}` : '';
  return { ...vazio, texto: `${topo}\n\n${explicacao}\n\n*Só consultei: nada foi mudado no seu computador, e nada saiu dele.*${oferta}`, pc: r };
}

module.exports = { pedidoDeConsultaPC, responderConsultaPC };
