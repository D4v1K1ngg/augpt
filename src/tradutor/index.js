'use strict';

/**
 * Tradutor (12/11, pedido do Davi: "um sistema de google tradutor"). Texto → texto com o modelo do Ollama que o
 * usuário já usa (ou `modelTraducao`, se escolher outro). Texto longo vai em partes de parágrafos, cada uma numa
 * chamada, para o modelo pequeno não resumir nem pular trecho. A tela é renderer/tradutor.js.
 */

const IDIOMAS = [
  ['auto', 'Detectar idioma', 'Auto'],
  ['pt', 'Português', 'Brazilian Portuguese'],
  ['en', 'Inglês', 'English'],
  ['es', 'Espanhol', 'Spanish'],
  ['fr', 'Francês', 'French'],
  ['de', 'Alemão', 'German'],
  ['it', 'Italiano', 'Italian'],
  ['nl', 'Holandês', 'Dutch'],
  ['ru', 'Russo', 'Russian'],
  ['pl', 'Polonês', 'Polish'],
  ['tr', 'Turco', 'Turkish'],
  ['ar', 'Árabe', 'Arabic'],
  ['hi', 'Hindi', 'Hindi'],
  ['ja', 'Japonês', 'Japanese'],
  ['ko', 'Coreano', 'Korean'],
  ['zh', 'Chinês (simplificado)', 'Simplified Chinese'],
];
const NOME = Object.fromEntries(IDIOMAS.map(([id, , en]) => [id, en]));

const TONS = {
  natural: '',
  formal: ' Use a formal, polite register.',
  informal: ' Use a casual, everyday register, as people really talk.',
};

/** Parágrafos juntos até ~`maximo` caracteres; um parágrafo maior que isso é cortado nas frases. */
function partesDoTexto(texto, maximo = 2500) {
  const paragrafos = String(texto || '').replace(/\r/g, '').split(/(\n\s*\n)/);
  const partes = [];
  let atual = '';
  const fechar = () => {
    if (atual.trim()) partes.push(atual);
    atual = '';
  };
  for (const p of paragrafos) {
    if (atual.length + p.length <= maximo) {
      atual += p;
      continue;
    }
    fechar();
    if (p.length <= maximo) {
      atual = p;
      continue;
    }
    for (const frase of p.split(/(?<=[.!?。！？])\s+/)) {
      if (atual.length + frase.length + 1 > maximo) fechar();
      atual += (atual ? ' ' : '') + frase;
    }
  }
  fechar();
  return partes;
}

function mensagensDaTraducao(texto, { de = 'auto', para = 'en', tom = 'natural' } = {}) {
  const origem = de === 'auto' ? 'the source language (detect it)' : NOME[de];
  return [
    {
      role: 'system',
      content: `You are a professional translator. Translate the user's text from ${origem} to ${NOME[para]}.${TONS[tom] || ''}
Rules:
- Output ONLY the translation: no notes, no explanations, no quotes around it, no "Translation:" label.
- Translate everything, sentence by sentence: do not summarize, skip, or add anything.
- Keep the formatting exactly (line breaks, lists, markdown, emojis), and keep names, brands, numbers, units, URLs and code as they are.
- Translate idioms by meaning, not word for word, so it reads naturally to a native speaker.
- If the text is already in ${NOME[para]}, return it unchanged.`,
    },
    { role: 'user', content: texto },
  ];
}

/** Tira o que o modelo pequeno às vezes acrescenta (rótulo, aspas em volta, raciocínio). */
function limparTraducao(saida, original = '') {
  let t = String(saida || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  t = t.replace(/^(?:translation|tradução|traducción|traduction|übersetzung)\s*:\s*/i, '');
  const aspas = /^(["“«])([\s\S]*)(["”»])$/.exec(t);
  if (aspas && !/^["“«]/.test(String(original).trim())) t = aspas[2].trim();
  return t;
}

/**
 * Traduz `texto` com `chatStream` (src/llm/ollama.js). `aoPedaco(texto)` recebe a tradução acumulada a cada token,
 * para a tela mostrar enquanto escreve. Devolve { traducao, partes, segundos }.
 */
async function traduzir({ texto, de = 'auto', para = 'en', tom = 'natural' }, { chatStream, host, model, numCtx = 8192, signal, aoPedaco = () => {} }) {
  if (!String(texto || '').trim()) throw new Error('escreva o texto para traduzir');
  if (!NOME[para] || para === 'auto') throw new Error('escolha o idioma de destino');
  if (!model) throw new Error('nenhum modelo escolhido em Ajustes');
  const inicio = Date.now();
  const partes = partesDoTexto(texto);
  const feitas = [];
  for (const parte of partes) {
    if (signal?.aborted) break;
    // as partes se juntam com uma linha em branco (o corte é sempre entre parágrafos)
    const miolo = parte.trim();
    let parcial = '';
    const r = await chatStream({
      host,
      model,
      messages: mensagensDaTraducao(miolo, { de, para, tom }),
      temperature: 0.2,
      numCtx: Math.max(numCtx, 8192),
      numPredict: Math.min(8192, Math.ceil(miolo.length * 1.2) + 400),
      pensar: false,
      signal,
      onToken: (p) => {
        parcial += p;
        aoPedaco([...feitas, limparTraducao(parcial, miolo)].join('\n\n'));
      },
    });
    feitas.push(limparTraducao(r.content, miolo));
    aoPedaco(feitas.join('\n\n'));
  }
  return { traducao: feitas.join('\n\n').trim(), partes: partes.length, segundos: (Date.now() - inicio) / 1000 };
}

module.exports = { IDIOMAS, TONS, partesDoTexto, mensagensDaTraducao, limparTraducao, traduzir };
