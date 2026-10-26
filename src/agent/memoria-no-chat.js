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
const ESQUECER = /^(?:esquec[ae]|apague|remova|tire)\b.*\b(?:memoria|sobre mim|instruc(?:ao|oes))\b|^esquec[ae] (?:que|o que eu (?:disse|falei)|meu|minha)\b/;
// 26/10 (no app, com erro de digitação/fala): "o que voce saber sobre min" — "saber" e "min" também valem
const LISTAR = /\bo que (?:voce|vc) (?:sabe|saber|lembra|guardou|tem guardado|anotou) (?:sobre|de) mi[mn]\b|\b(?:mostre|liste|veja) (?:a )?(?:sua )?memoria\b/;

/*
 * Instrução por assunto (27/10, pedido do Davi): "quando eu falar de compras, sempre mostre o preço à vista",
 * "quando eu pedir código, use Python", "em pesquisas sobre celulares, compare a bateria". Fica na mesma
 * memória, como regra condicional ("Quando o assunto for compras: …"); o escritor e o agente seguem só
 * quando o pedido é sobre aquilo. O código separa assunto e instrução — o modelo não reescreve.
 */
const PREFIXO_INSTRUCAO = /^\s*(?:(?:por favor|ok|beleza|ei|olha)[,!]?\s+)?(?:au(?:gpt)?[,!]?\s+)?(?:(?:lembr[ae]|guard[ae]|anot[ae])(?:-se)?\s+(?:de\s+)?que\s+|a partir de agora,?\s+|de agora em diante,?\s+|daqui (?:pra|para) frente,?\s+)?/i;
const VERBO = '(?:falar|pedir|perguntar|pesquisar|buscar|procurar|quiser|mandar|tratar|for (?:falar|pedir|perguntar|pesquisar|buscar))';
const SEPARA = String.raw`\s*(?:[,:;]|\s-\s|(?=\s(?:sempre|nunca|use|usa|mostre|mostra|responda|responde|coloque|inclua|traga|fa[cç]a|n[aã]o|prefira|d[eê]|cite|evite|compare)\b))\s*`;
const QUANDO_ASSUNTO = new RegExp(String.raw`^(?:quando|sempre que|toda vez que|nas vezes que)\s+(?:eu\s+)?(?:te\s+)?` + VERBO + String.raw`\s+(?:(?:algo|alguma coisa|coisas?)\s+)?(?:(?:de|sobre|por|para|pra|do|da|dos|das|em|a respeito de)\s+)?(.{2,60}?)` + SEPARA + '(.{4,220})$', 'i');
const EM_ASSUNTO = /^(?:em|nas?|nos?)\s+(?:pesquisas?|perguntas?|pedidos?|respostas?|assuntos?|conversas?)\s+(?:de|sobre)\s+(.{2,60}?)\s*[,:;]\s*(.{4,220})$/i;

// a tela em inglês: "when I talk about shopping, always show the cash price"
const QUANDO_EN = /^(?:from now on,?\s+)?(?:when(?:ever)?|every time)\s+I\s+(?:talk|ask|search|request|want)\s+(?:about|for)\s+(.{2,60}?)\s*[,:;]\s*(.{4,220})$/i;

/** {assunto, instrucao} quando o pedido é uma instrução para um assunto; senão null. */
function instrucaoPorAssunto(texto) {
  const t = String(texto || '').trim().replace(PREFIXO_INSTRUCAO, '');
  const m = QUANDO_ASSUNTO.exec(t) || EM_ASSUNTO.exec(t) || QUANDO_EN.exec(t);
  if (!m) return null;
  const assunto = m[1].replace(/^(?:o|a|os|as|um|uma)\s+/i, '').replace(/[.,;:!]+$/, '').trim();
  let instrucao = m[2].trim().replace(/\s*[.!]+$/, '');
  // "quando eu pedir pizza, o que devo fazer?" é pergunta, não instrução
  if (!assunto || /\?$/.test(instrucao) || instrucao.length < 4) return null;
  instrucao = `${instrucao[0].toUpperCase()}${instrucao.slice(1)}.`;
  return { assunto, instrucao };
}

/** 'instrucao' | 'lembrar' | 'esquecer' | 'listar' | null */
function pedidoDeMemoria(texto) {
  if (instrucaoPorAssunto(texto)) return 'instrucao';
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
    const regras = itens.filter((i) => i.chave.startsWith('instrucao_'));
    const fatos = itens.filter((i) => !i.chave.startsWith('instrucao_'));
    const partes = [
      fatos.length ? `Isto é o que eu guardei sobre você:\n\n${fatos.map((i) => `- ${i.valor}`).join('\n')}` : '',
      regras.length ? `**Instruções por assunto:**\n\n${regras.map((i) => `- ${i.valor}`).join('\n')}` : '',
    ].filter(Boolean);
    return fim(partes.length ? `${partes.join('\n\n')}${RODAPE}` : 'Ainda não guardei nada sobre você. Para guardar, diga por exemplo "lembre que eu prefiro respostas curtas" ou "quando eu falar de compras, sempre mostre o preço à vista".');
  }

  if (acao === 'instrucao') {
    const r = instrucaoPorAssunto(pergunta);
    if (r) {
      const salvo = memoria.definir({ chave: `instrucao_${r.assunto}`, valor: `Quando o assunto for ${r.assunto}: ${r.instrucao}` });
      if (salvo) return fim(`Anotado ✓ — ${salvo.valor}\n\n*Vale só quando o pedido for sobre ${r.assunto}, em todas as conversas. Para trocar, diga de novo com a instrução nova; para tirar, "esqueça a instrução de ${r.assunto}" ou em **Ajustes → Memória**.*`);
    }
    acao = 'lembrar';
  }

  if (acao === 'esquecer') {
    if (!itens.length) return fim('Não há nada guardado sobre você.');
    // o código decide, não o modelo (22/10: "esqueça meu nome" com o modelo apagou tudo): sai o
    // que cita as palavras do pedido; tudo, só com "tudo"
    const regras = itens.filter((i) => i.chave.startsWith('instrucao_'));
    // "esqueça todas as instruções": só as instruções por assunto, não o resto da memória
    const apagar = /\binstruc(?:ao|oes)\b/.test(norm(pergunta)) && /\b(?:tud[oa]|todas)\b/.test(norm(pergunta)) ? regras
      : /\btud[oa]\b/.test(norm(pergunta)) ? itens : itensCitados(pergunta, itens);
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
    .slice(0, 1500);
}

/**
 * As instruções por assunto que valem para esta pergunta. 27/10, no app: com todas no prompt e o aviso
 * "só para X", o qwen3.5 pôs a "Curiosidade:" de história na resposta sobre motor elétrico — então o
 * modelo só classifica (chamada curta, JSON) e o escritor recebe só as que valem. Sem o modelo: nenhuma.
 */
async function instrucoesQueValem(pergunta, regras, chamar) {
  if (!regras.length || typeof chamar !== 'function') return [];
  const assuntos = regras.map((r, i) => `${i + 1}) ${r.chave.slice('instrucao_'.length).replace(/_/g, ' ')}`).join('\n');
  const prompt = `Pergunta do usuário: "${String(pergunta || '').slice(0, 600)}"

Assuntos:
${assuntos}

A pergunta é sobre algum destes assuntos? Conta só se o tema principal da pergunta for o assunto (ou algo dentro dele); palavra parecida ou assunto vizinho não conta.
Responda só com JSON: {"assuntos": [números dos assuntos da pergunta]} — ou {"assuntos": []} se nenhum.`;
  const r = await chamar([{ role: 'user', content: prompt }], { json: true, numPredict: 300 }).catch(() => null);
  const nums = lerJson(r?.content)?.assuntos;
  return Array.isArray(nums) ? regras.filter((_, i) => nums.map(Number).includes(i + 1)) : [];
}

/** O bloco do escritor para esta pergunta: os fatos sempre; as instruções por assunto, só as que valem. */
async function preferenciasDaPergunta(pasta, config = {}, { pergunta = '', chamar } = {}) {
  if (config.memoriaCentral === false || !pasta) return '';
  const itens = new MemoriaCentral(pasta).listar();
  const regras = itens.filter((i) => i.chave.startsWith('instrucao_'));
  const valem = await instrucoesQueValem(pergunta, regras, chamar);
  return [...itens.filter((i) => !i.chave.startsWith('instrucao_')), ...valem]
    .map((i) => `- ${i.valor}`)
    .join('\n')
    .slice(0, 1500);
}

module.exports = { pedidoDeMemoria, responderMemoria, preferenciasParaEscrever, preferenciasDaPergunta, instrucoesQueValem, instrucaoPorAssunto };
