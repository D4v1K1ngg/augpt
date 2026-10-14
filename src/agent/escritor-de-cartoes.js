'use strict';

/**
 * Escrita por cartão (14/10). Antes, UMA chamada escrevia 1–2 frases para
 * cada produto a partir de ~3 trechos curtos (compositor.pedidoDeFrases), e o
 * 7B devolvia a mesma fórmula para todos. Agora cada produto tem a sua
 * chamada, com o dossiê dele (dossie-do-produto.js), e o texto volta em campos
 * com rótulo — o código monta o cartão e confere campo por campo:
 *   - número que não está no material → a frase sai;
 *   - [n] que não é fonte deste produto → a marca sai;
 *   - trecho de 10+ palavras copiado de um comentário, frase igual à de
 *     outro cartão ou campo principal vazio → reescreve UMA vez, dizendo o
 *     que evitar; se continuar ruim, o cartão fica com o texto feito pelo
 *     código (a resposta nunca fica pior que a de antes).
 * As funções de prompt, leitura e conferência são puras — a bancada e o
 * script de reescrita (avaliacao/reescrever.js) usam sem rede.
 */

const { textoDoDossie } = require('./dossie-do-produto');

const CAMPOS = Object.freeze([
  { chave: 'oQueE', rotulo: 'O QUE É', titulo: 'O que é' },
  { chave: 'noUso', rotulo: 'NO USO', titulo: 'No uso' },
  { chave: 'fortes', rotulo: 'PONTOS FORTES', titulo: 'Pontos fortes' },
  { chave: 'fracos', rotulo: 'PONTOS FRACOS', titulo: 'Pontos fracos' },
  { chave: 'paraQuem', rotulo: 'PARA QUEM', titulo: 'Para quem' },
]);

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * @param {object} p
 * @param {string} p.objetivo  o pedido do usuário
 * @param {string} p.uso       para que é ("jogar PUBG"; vazio = conhecer o produto)
 * @param {Array<{nome, porque}>} p.criterios o que importa nesse uso
 * @param {{ nome, itens }} p.dossie
 * @param {string[]} p.evitar  frases a não repetir (de outros cartões, ou copiadas)
 */
function pedidoDoCartao({ objetivo, uso = '', categoria = '', criterios = [], dossie, evitar = [] }) {
  const nome = dossie.nome;
  const doUso = uso ? `para ${uso}` : 'no dia a dia';
  // 14/10 (2ª versão, combinada com o Davi): instrução curta + UM exemplo, no
  // lugar da lista de regras — o 7B imita um exemplo melhor do que obedece
  // proibições, e a 1ª versão (6 regras + formato rígido) teve 3 de 5 cartões
  // descartados. O exemplo é de outra categoria de propósito (não vaza dado).
  return `Escreva, em português, a parte da resposta sobre o ${nome}, com base no material abaixo.

Pedido do usuário: ${String(objetivo).slice(0, 300)}${uso ? `\nUso: ${uso}` : ''}${categoria ? `\nTipo de produto: ${categoria}` : ''}${criterios.length ? `\nO que importa nesse uso: ${criterios.slice(0, 6).map((k) => k.nome).join(', ')}` : ''}

Material sobre o ${nome} (o número no começo da linha é a fonte):
${textoDoDossie(dossie)}

Conte com as suas palavras o que o material diz: o que o produto é, como ele se sai ${doUso}, o que tem de bom e de ruim, e para quem serve. Ponha o número da fonte no fim da frase que traz um dado, assim: [3]. Quando usar um termo técnico que um leigo não conhece, explique entre parênteses. Escreva só o que o material sustenta e fale só do ${nome}.${evitar.length ? `\nNão repita estas frases, que já aparecem em outras partes da resposta: ${evitar.slice(0, 4).map((f) => `"${String(f).slice(0, 120)}"`).join('; ')}` : ''}

Exemplo do formato, com outro produto (só para mostrar o jeito de escrever):
O QUE É: O Logitech G305 é um mouse sem fio de 99 g [1], com sensor HERO (a peça que lê o movimento do mouse) de até 12.000 DPI (pontos por polegada: quanto mais, mais sensível) [2].
NO USO: Em jogos de tiro, quem usa elogia a pegada firme e diz não sentir atraso no sem fio [4]. A pilha AA deixa o mouse um pouco mais pesado na frente, o que alguns jogadores estranham no começo [5].
PONTOS FORTES: Leve e preciso pelo preço [2], com pilha que dura meses [3].
PONTOS FRACOS: Não tem bateria recarregável e o formato é pequeno para mão grande [5].
PARA QUEM: Para quem quer um mouse sem fio confiável gastando pouco.

Agora escreva o do ${nome}, nas mesmas 5 linhas:`;
}

/** Lê os 5 campos (tolerante a negrito, acento, campo em mais de uma linha). */
function lerCartao(texto) {
  const cartao = {};
  let atual = null;
  for (const bruta of String(texto || '').split('\n')) {
    const linha = bruta.replace(/\*\*/g, '').trim();
    if (!linha) continue;
    const m = /^[-*]?\s*(o que e|o que é|no uso|como se sai|pontos? fortes?|pontos? fracos?|para quem)\s*:\s*(.*)$/i.exec(linha);
    if (m) {
      const r = normalizar(m[1]);
      atual = r.startsWith('o que') ? 'oQueE' : r === 'no uso' || r === 'como se sai' ? 'noUso' : r.includes('fort') ? 'fortes' : r.includes('frac') ? 'fracos' : 'paraQuem';
      cartao[atual] = m[2].trim();
    } else if (atual && !/^(regras|material|produto)\b/i.test(linha)) {
      cartao[atual] = `${cartao[atual]} ${linha}`.trim();
    }
  }
  for (const k of Object.keys(cartao)) cartao[k] = cartao[k].replace(/^["“<]+|[">”]+$/g, '').replace(/\s+/g, ' ').trim();
  // sem os rótulos (o modelo escreveu em parágrafos, com títulos): o texto
  // inteiro vale como "no uso" — corrigir, não descartar
  if (!Object.keys(cartao).length) {
    const corrido = String(texto || '')
      .split('\n')
      .map((l) => l.replace(/\*\*/g, '').trim())
      .filter((l) => l && !/^#{1,6}\s|^(agora|exemplo)\b/i.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (frasesDe(corrido).length >= 2) cartao.noUso = corrido;
  }
  return cartao;
}

const frasesDe = (t) => String(t || '').split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9])/).map((f) => f.trim()).filter(Boolean);

function trincas(frase) {
  const p = normalizar(frase).split(' ');
  const s = new Set();
  for (let i = 0; i + 2 < p.length; i += 1) s.add(`${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  return s;
}
function parecidas(a, b) {
  const ta = trincas(a);
  const tb = trincas(b);
  if (ta.size < 4 || tb.size < 4) return false;
  let comum = 0;
  for (const t of ta) if (tb.has(t)) comum += 1;
  return comum / Math.min(ta.size, tb.size) >= 0.6;
}

/** Primeira sequência de 10 palavras do texto que aparece igual num comentário. */
function trechoCopiado(texto, comentarios) {
  const p = normalizar(texto).split(' ');
  const alvos = comentarios.map((c) => ` ${normalizar(c)} `).filter((c) => c.length > 40);
  for (let i = 0; i + 10 <= p.length; i += 1) {
    const janela = ` ${p.slice(i, i + 10).join(' ')} `;
    if (alvos.some((c) => c.includes(janela))) return p.slice(i, i + 10).join(' ');
  }
  return null;
}

// "12.000", "12,000" e "12000" são o mesmo número; "3,5" e "3.5" também
const numerosDe = (t) =>
  (String(t || '').match(/\d{1,3}(?:[.,]\d{3})+(?![\d])|\d+(?:[.,]\d+)?/g) || []).map((n) => (/^\d{1,3}([.,]\d{3})+$/.test(n) ? n.replace(/[.,]/g, '') : n.replace(',', '.')));

/**
 * Confere um cartão CORRIGINDO, não rejeitando (14/10, 2ª versão): frase com
 * número que o material não tem, cópia de comentário ou frase igual à de
 * outro cartão sai; marca de fonte inválida sai; o resto do texto do modelo
 * fica. Só pede reescrita quando não sobra texto (menos de 2 frases).
 * @param {object} cartao   saída de lerCartao
 * @param {object} o
 * @param {{nome, itens}} o.dossie
 * @param {string[]} o.outros  frases dos cartões já escritos
 * @returns {{ cartao, problemas: string[], removidas: Array<{frase, motivo}>, evitar: string[] }}
 */
function conferirCartao(cartao, { dossie, outros = [] }) {
  const material = `${dossie.nome} ${dossie.itens.map((i) => i.texto).join(' ')}`;
  const permitidos = new Set(numerosDe(material));
  const fontes = new Set(dossie.itens.map((i) => i.n).filter(Boolean));
  const comentarios = dossie.itens.filter((i) => i.tipo === 'comunidade').map((i) => i.texto);
  const removidas = [];
  const limpo = {};
  let total = 0;
  for (const { chave } of CAMPOS) {
    const frases = [];
    for (let f of frasesDe(cartao[chave])) {
      // marca de fonte que não existe neste dossiê sai (o número da frase fica)
      f = f.replace(/\[(\d+)\]/g, (m, n) => (fontes.has(Number(n)) ? m : '')).replace(/\s+([.,;])/g, '$1').trim();
      const nums = numerosDe(f.replace(/\[\d+\]/g, ''));
      let motivo = null;
      if (nums.some((n) => !permitidos.has(n) && !/^\d$/.test(n))) motivo = 'número que o material não tem';
      else if (trechoCopiado(f, comentarios)) motivo = 'copiou um comentário';
      else if (outros.some((o) => parecidas(f, o))) motivo = 'frase igual à de outro cartão';
      if (motivo) {
        removidas.push({ frase: f, motivo });
        continue;
      }
      frases.push(f);
    }
    if (frases.length) {
      limpo[chave] = frases.join(' ');
      total += frases.length;
    }
  }
  const problemas = total < 2 ? ['sobrou texto de menos'] : [];
  return { cartao: limpo, problemas, removidas, evitar: removidas.filter((r) => r.motivo !== 'número que o material não tem').map((r) => r.frase) };
}

/** "[3]" → "[(3)](url)", o link para a fonte (renderer/md.js desenha o link). */
function comLinks(texto, fontes) {
  const url = new Map(fontes.map((f) => [f.n, f.url]));
  return String(texto || '').replace(/\[(\d+)\]/g, (m, n) => (url.has(Number(n)) ? `[(${n})](${url.get(Number(n))})` : ''));
}

/**
 * Escreve os cartões de vários produtos, até `paralelo` ao mesmo tempo.
 * `chamar(prompt) → Promise<string>` é o modelo (injetado).
 * @returns {Promise<Map<nome, cartao>>} só os cartões que passaram na conferência
 */
async function escreverCartoes({ dossies, contexto, chamar, paralelo = 2, aviso = () => {} }) {
  const prontos = new Map();
  const frasesProntas = () => [...prontos.values()].flatMap((c) => Object.values(c).flatMap(frasesDe));
  const escreverUm = async (dossie) => {
    let evitar = [];
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      let texto;
      try {
        texto = await chamar(pedidoDoCartao({ ...contexto, dossie, evitar }));
      } catch (err) {
        aviso(`cartão do ${dossie.nome}: a chamada falhou (${err.message})`);
        return;
      }
      const r = conferirCartao(lerCartao(texto), { dossie, outros: frasesProntas() });
      if (r.removidas.length) aviso(`cartão do ${dossie.nome}: ${r.removidas.length} frase(s) tirada(s) (${[...new Set(r.removidas.map((x) => x.motivo))].join(', ')})`);
      if (!r.problemas.length) {
        prontos.set(dossie.nome, r.cartao);
        return;
      }
      if (tentativa === 2) {
        aviso(`cartão do ${dossie.nome}: ${r.problemas.join(', ')} — fica o texto feito pelo código`);
        return;
      }
      aviso(`cartão do ${dossie.nome}: ${r.problemas.join(', ')} — reescrevendo`);
      evitar = r.evitar;
    }
  };
  const fila = dossies.filter((d) => d.itens.length >= 2);
  const trabalhadores = Array.from({ length: Math.max(1, Math.min(paralelo, fila.length)) }, async () => {
    while (fila.length) await escreverUm(fila.shift());
  });
  await Promise.all(trabalhadores);
  return prontos;
}

module.exports = { pedidoDoCartao, lerCartao, conferirCartao, escreverCartoes, comLinks, trechoCopiado, CAMPOS };
