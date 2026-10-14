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
  const doUso = uso ? `em ${uso}` : 'no dia a dia';
  return `Você escreve o cartão de UM produto numa resposta para o usuário. Use SÓ o material abaixo — é o que a pesquisa achou sobre o ${nome}.

PEDIDO DO USUÁRIO: ${String(objetivo).slice(0, 300)}
${uso ? `USO: ${uso}\n` : ''}${categoria ? `TIPO DE PRODUTO: ${categoria}\n` : ''}${criterios.length ? `O QUE IMPORTA NESSE USO:\n${criterios.slice(0, 6).map((k) => `- ${k.nome}${k.porque ? `: ${k.porque}` : ''}`).join('\n')}\n` : ''}
PRODUTO: ${nome}
MATERIAL SOBRE O ${nome.toUpperCase()} (o número no começo de cada linha é a fonte):
${textoDoDossie(dossie)}

REGRAS:
- Escreva com as SUAS palavras, em português claro e bem redigido. NÃO copie frases dos comentários e NÃO use aspas: diga o que quem usa relata.
- Dado concreto (número, medida, característica técnica) leva o número da fonte no fim da frase, assim: [3].
- Na primeira vez que usar um termo técnico (por exemplo palco sonoro, driver, impedância, DPI, sensor, taxa de atualização, painel IPS), explique entre parênteses, em poucas palavras, o que ele significa.
- Não invente: o que o material não diz, você não escreve. Sem ponto fraco no material, escreva exatamente: o material não trouxe pontos fracos.
- Fale só do ${nome}; não cite outros produtos.${evitar.length ? `\n- NÃO repita estas frases (já foram usadas ou foram copiadas):\n${evitar.slice(0, 6).map((f) => `  - ${String(f).slice(0, 160)}`).join('\n')}` : ''}

Responda EXATAMENTE nestas 5 linhas, sem título e sem mais nada:
O QUE É: <1 ou 2 frases: que tipo de produto é e o que ele tem de principal>
NO USO: <2 ou 3 frases: como ele se sai ${doUso}, ligando ao que importa${uso ? ' nesse uso' : ''}>
PONTOS FORTES: <2 frases>
PONTOS FRACOS: <1 ou 2 frases>
PARA QUEM: <1 frase: para quem ele faz mais sentido>`;
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

/**
 * Confere um cartão. Devolve o cartão limpo (frases com número inventado e
 * marcas de fonte inválidas saem) e os problemas que pedem reescrita.
 * @param {object} cartao   saída de lerCartao
 * @param {object} o
 * @param {{nome, itens}} o.dossie
 * @param {string[]} o.outros  frases dos cartões já escritos
 */
function conferirCartao(cartao, { dossie, outros = [] }) {
  const material = `${dossie.nome} ${dossie.itens.map((i) => i.texto).join(' ')}`;
  const permitidos = new Set((material.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')));
  const fontes = new Set(dossie.itens.map((i) => i.n).filter(Boolean));
  const comentarios = dossie.itens.filter((i) => i.tipo === 'comunidade').map((i) => i.texto);
  const problemas = [];
  const evitar = [];
  const limpo = {};
  for (const { chave } of CAMPOS) {
    const frases = [];
    for (let f of frasesDe(cartao[chave])) {
      // marca de fonte que não existe neste dossiê sai (o número da frase fica)
      f = f.replace(/\[(\d+)\]/g, (m, n) => (fontes.has(Number(n)) ? m : '')).replace(/\s+([.,;])/g, '$1').trim();
      const nums = (f.replace(/\[\d+\]/g, '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'));
      if (nums.some((n) => !permitidos.has(n) && !/^\d$/.test(n))) continue; // número que o material não tem
      const copiado = trechoCopiado(f, comentarios);
      if (copiado) {
        problemas.push('copiou um comentário');
        evitar.push(f);
        continue;
      }
      if (outros.some((o) => parecidas(f, o))) {
        problemas.push('frase igual à de outro cartão');
        evitar.push(f);
        continue;
      }
      frases.push(f);
    }
    if (frases.length) limpo[chave] = frases.join(' ');
  }
  if (!limpo.oQueE || !limpo.fortes) problemas.push('faltou o que é ou os pontos fortes');
  return { cartao: limpo, problemas: [...new Set(problemas)], evitar };
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
      if (!r.problemas.length) {
        prontos.set(dossie.nome, r.cartao);
        return;
      }
      if (tentativa === 1) aviso(`cartão do ${dossie.nome}: ${r.problemas.join(', ')} — reescrevendo`);
      if (tentativa === 2) {
        // ficou o que passou, se o essencial passou
        if (r.cartao.oQueE && r.cartao.fortes) prontos.set(dossie.nome, r.cartao);
        else aviso(`cartão do ${dossie.nome}: ${r.problemas.join(', ')} — fica o texto feito pelo código`);
        return;
      }
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
