'use strict';

/**
 * Memória central pelo chat (22/10, pedido do Davi): "lembre que eu prefiro respostas curtas",
 * "meu nome é Davi", "a partir de agora responda em tópicos", "esqueça que eu moro em SP",
 * "o que você sabe sobre mim?". Antes só a ferramenta do caminho antigo gravava aqui, e as
 * perguntas vão pelo núcleo — a memória ficou parada desde 11/09. O que é guardado entra em
 * toda resposta do núcleo (sistemaDoEscritor, <preferencias_do_usuario>).
 * Só o que o usuário escreve no chat grava aqui; nada vem de página lida.
 */

const { MemoriaCentral } = require('./memoria-central');

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const INICIO = /^(?:(?:por favor|ei|olha|ah|ok|beleza)[,!]?\s+)?(?:au(?:gpt)?[,!]?\s+)?/;
// "lembre-me de pagar a conta amanhã" é lembrete (agendamento), não memória
const LEMBRAR = /^(?:lembr[ae](?:-se)?|guard[ae]|anot[ae]|grav[ae]|memoriz[ae]|nao esquec[ae])\s+(?:de\s+)?(?:que|isso|disso)\b|^(?:a partir de agora|de agora em diante|daqui (?:pra|para) frente)\b|^(?:meu nome e|me chame de|pode me chamar de)\b/;
const ESQUECER = /^(?:esquec[ae]|apague|remova|tire)\b.*\b(?:memoria|sobre mim)\b|^esquec[ae] (?:que|o que eu (?:disse|falei)|meu|minha)\b/;
const LISTAR = /\bo que (?:voce|vc) (?:sabe|lembra|guardou|tem guardado|anotou) (?:sobre|de) mim\b|\b(?:mostre|liste|veja) (?:a )?(?:sua )?memoria\b/;

/** 'lembrar' | 'esquecer' | 'listar' | null */
function pedidoDeMemoria(texto) {
  const t = norm(texto).replace(INICIO, '');
  if (LISTAR.test(t)) return 'listar';
  if (ESQUECER.test(t)) return 'esquecer';
  if (LEMBRAR.test(t)) return 'lembrar';
  return null;
}

const lerJson = (t) => {
  try {
    return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)[0]);
  } catch {
    return null;
  }
};

// testado no qwen3.5 (22/10): com {"chave","valor"} e um exemplo só, o 9B respondia {"nome": "Davi"}
const pedidoDoFato = (frase, existentes) => `Tarefa: transformar o que o usuário disse num registro de memória sobre ele.
O usuário disse: "${frase}"

Responda só com JSON com exatamente dois campos, "assunto" e "fato":
- "assunto": uma palavra ou duas, com _ no lugar de espaço. Use um destes quando servir: nome, cidade, idioma, tamanho_das_respostas, estilo_das_respostas, computador, trabalho, interesses.${existentes ? ` Já guardados: ${existentes} — se for o mesmo assunto, repita o nome para atualizar.` : ''}
- "fato": uma frase curta sobre o usuário, em português, em terceira pessoa, com TUDO o que ele pediu (não deixe nenhuma parte de fora).

Exemplos:
"lembre que eu prefiro respostas curtas" → {"assunto": "tamanho_das_respostas", "fato": "Prefere respostas curtas."}
"meu nome é Ana" → {"assunto": "nome", "fato": "Chama-se Ana."}
"guarde que eu trabalho com design" → {"assunto": "trabalho", "fato": "Trabalha com design."}`;

// palavras do pedido que não dizem O QUE esquecer
const VAZIAS = new Set(['esqueca', 'esquece', 'apague', 'remova', 'tire', 'memoria', 'sobre', 'minha', 'meus', 'minhas', 'isso', 'voce', 'favor', 'agora', 'mais', 'tambem', 'aquilo', 'disse', 'falei', 'guardou', 'sabe']);
function itensCitados(pergunta, itens) {
  const palavras = norm(pergunta).split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !VAZIAS.has(p));
  const nota = (i) => palavras.filter((p) => norm(`${i.chave.replace(/_/g, ' ')} ${i.valor}`).split(/[^a-z0-9]+/).includes(p)).length;
  const melhor = Math.max(0, ...itens.map(nota));
  return melhor ? itens.filter((i) => nota(i) === melhor) : [];
}

const RODAPE ='\n\n*Vale para todas as conversas. Em **Ajustes → Memória** você vê e apaga o que está guardado.*';

async function responderMemoria({ pergunta, deps, pasta, config = {}, acao = pedidoDeMemoria(pergunta) }) {
  const emit = deps.emit || (() => {});
  const fim = (texto) => (emit('resposta-token', { pedaco: texto }), { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'memoria', texto });
  if (config.memoriaCentral === false) return fim('A memória está desligada em **Ajustes → Memória**. Ligue lá para eu guardar o que você me conta.');
  const memoria = deps.memoriaCentral || (pasta ? new MemoriaCentral(pasta) : null);
  if (!memoria) return fim('Não consegui abrir a memória agora.');
  const itens = memoria.listar();

  if (acao === 'listar') {
    return fim(itens.length ? `Isto é o que eu guardei sobre você:\n\n${itens.map((i) => `- ${i.valor}`).join('\n')}${RODAPE}` : 'Ainda não guardei nada sobre você. Para guardar, diga por exemplo "lembre que eu prefiro respostas curtas".');
  }

  if (acao === 'esquecer') {
    if (!itens.length) return fim('Não há nada guardado sobre você.');
    // o código decide, não o modelo (22/10: "esqueça meu nome" com o modelo apagou tudo): sai o
    // que cita as palavras do pedido; tudo, só com "tudo"
    const apagar = /\btud[oa]\b/.test(norm(pergunta)) ? itens : itensCitados(pergunta, itens);
    if (!apagar.length) return fim(`Não achei isso no que está guardado. Hoje eu sei:\n\n${itens.map((i) => `- ${i.valor}`).join('\n')}\n\nDiga, por exemplo, "esqueça ${itens[0].chave.replace(/_/g, ' ')}".`);
    apagar.forEach((i) => memoria.esquecer(i.chave));
    return fim(`Esquecido ✓\n\n${apagar.map((i) => `- ~~${i.valor}~~`).join('\n')}`);
  }

  // lembrar: o modelo escreve o fato curto e o assunto (o mesmo assunto atualiza em vez de somar)
  const existentes = itens.map((i) => i.chave).join(', ');
  const j = lerJson((await deps.chamar([{ role: 'user', content: pedidoDoFato(pergunta, existentes) }], { json: true, numPredict: 200 }).catch(() => ({})))?.content);
  // sem o modelo (ou JSON fora do formato): o que ele disse, como ele disse
  const resto = String(pergunta).replace(/^.*?\b(?:que|isso|disso|chame de|chamar de|nome [eé])\s+/i, '').trim();
  const fato = j?.fato && j?.assunto ? { chave: j.assunto, valor: j.fato } : /\bnome\b|chamar de|chame de/i.test(pergunta) ? { chave: 'nome', valor: `Chama-se ${resto}.` } : { chave: resto.split(/\s+/).slice(0, 3).join('_'), valor: `Disse: "${resto}".` };
  const salvo = memoria.definir(fato);
  if (!salvo) return fim('Não entendi o que guardar. Tente, por exemplo: "lembre que eu prefiro respostas curtas".');
  return fim(`Anotado ✓ — ${salvo.valor}${RODAPE}`);
}

/** O bloco para o escritor do núcleo: o que o usuário pediu para guardar. */
function preferenciasParaEscrever(pasta, config = {}) {
  if (config.memoriaCentral === false || !pasta) return '';
  return new MemoriaCentral(pasta)
    .listar()
    .map((i) => `- ${i.valor}`)
    .join('\n')
    .slice(0, 900);
}

module.exports = { pedidoDeMemoria, responderMemoria, preferenciasParaEscrever };
