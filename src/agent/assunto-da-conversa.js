'use strict';

/**
 * Assunto da conversa (revisão v3, Fase 2 — chat real de 29/09).
 *
 * 1ª pergunta: "as melhores táticas de jogo para PUBG de PC, cenário
 * competitivo". 2ª: "um tutorial para planejamento tático e movimentação
 * eficiente DENTRO DO JOGO". A referência só era reconhecida por pronome
 * ("isso", "dele") ou pedido curto; "do jogo" passou, a busca foi "tutorial
 * planejamento tático … no jogo" e a resposta saiu sobre GTA Online.
 *
 * Aqui, por código e sem modelo:
 *   - o assunto (jogo, plataforma, categoria de produto, produtos com
 *     número) é tirado dos pedidos ANTERIORES do usuário — recalculado do
 *     histórico a cada turno, então vale pra conversa inteira e sobrevive a
 *     reiniciar o app;
 *   - "o jogo", "do fone", "essa placa", "o personagem" sem nome próprio
 *     depois = referência à conversa;
 *   - o que falta no pedido atual entra no objetivo, junto da expressão
 *     genérica: "dentro do jogo" → "dentro do jogo (PUBG de PC)". Daí pra
 *     frente tudo (tipo de pedido, escopo que exclui PUBG Mobile, buscas do
 *     motor) já enxerga o assunto.
 */

const semAcento = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const JOGOS = [
  { re: /\bpubg\b(?!\s*mobile)/, nome: 'PUBG' },
  { re: /\bpubg\s*mobile\b|\bbgmi\b/, nome: 'PUBG Mobile' },
  { re: /\b(cs ?2|counter ?strike|csgo|cs go)\b/, nome: 'CS2' },
  { re: /\bvalorant\b/, nome: 'Valorant' },
  { re: /\bwarzone\b/, nome: 'Warzone' },
  { re: /\bapex( legends)?\b/, nome: 'Apex Legends' },
  { re: /\bfortnite\b/, nome: 'Fortnite' },
  { re: /\b(league of legends|lol)\b/, nome: 'League of Legends' },
  { re: /\bdota ?2?\b/, nome: 'Dota 2' },
  { re: /\b(rainbow six|r6)\b/, nome: 'Rainbow Six Siege' },
  { re: /\boverwatch\b/, nome: 'Overwatch' },
  { re: /\bfree ?fire\b/, nome: 'Free Fire' },
  { re: /\bminecraft\b/, nome: 'Minecraft' },
  { re: /\b(gta|grand theft auto)\b/, nome: 'GTA' },
  { re: /\btarkov\b/, nome: 'Escape from Tarkov' },
  { re: /\brocket league\b/, nome: 'Rocket League' },
];
const PLATAFORMAS = [
  { re: /\b(de pc|no pc|para pc|pra pc|pc gamer|computador|steam|on pc|for pc)\b/, nome: 'PC' },
  { re: /\b(mobile|celular|android|iphone|ios)\b/, nome: 'celular' },
  { re: /\b(ps4|ps5|playstation|xbox|console|switch)\b/, nome: 'console' },
];
const CATEGORIAS = [
  { re: /\b(intra( ?auricular(es)?)?|in ?ear|iems?)\b/, nome: 'fone intra-auricular' },
  { re: /\b(fones?|headsets?|headphones?)\b/, nome: 'fone' },
  { re: /\b(placas? de video|gpus?)\b/, nome: 'placa de vídeo' },
  { re: /\bmonitor(es)?\b/, nome: 'monitor' },
  { re: /\bmouses?\b/, nome: 'mouse' },
  { re: /\bteclados?\b/, nome: 'teclado' },
  { re: /\b(notebooks?|laptops?)\b/, nome: 'notebook' },
  { re: /\bcadeiras?\b/, nome: 'cadeira' },
];

/** Assunto de UM texto: { jogo, plataforma, categoria, produtos } (null/[] quando não tem). */
function assuntoDe(texto) {
  const t = semAcento(texto);
  const produtos = [
    ...new Set(
      (String(texto || '').match(/\b(?:RTX|GTX|RX|Ryzen \d|Core i\d|[A-Z][A-Za-z]+)\s?[A-Z]?\d{2,5}[A-Za-z]{0,3}(?:\s?(?:Ti|Super|XT|XTX|Pro))?\b/g) || []).map((p) => p.trim())
    ),
  ];
  return {
    jogo: JOGOS.find((j) => j.re.test(t))?.nome || null,
    plataforma: PLATAFORMAS.find((p) => p.re.test(t))?.nome || null,
    categoria: CATEGORIAS.find((c) => c.re.test(t))?.nome || null,
    produtos,
  };
}

/** Assunto da conversa: o mais recente de cada campo, nos pedidos do USUÁRIO (a resposta do agente pode ter errado o assunto). */
function assuntoDaConversa(conversa = []) {
  const saida = { jogo: null, plataforma: null, categoria: null, produtos: [] };
  const doUsuario = conversa.filter((m) => m?.role === 'user').map((m) => String(m.content || ''));
  for (let i = doUsuario.length - 1; i >= 0; i -= 1) {
    const a = assuntoDe(doUsuario[i]);
    for (const campo of ['jogo', 'plataforma', 'categoria']) if (!saida[campo] && a[campo]) saida[campo] = a[campo];
    if (!saida.produtos.length && a.produtos.length) saida.produtos = a.produtos;
  }
  return saida;
}

// "o jogo", "do fone", "essa placa", "o personagem" — substantivo genérico com
// artigo/demonstrativo e SEM nome próprio logo depois ("o personagem Satoru
// Gojo" não é referência; "o personagem" sozinho é)
const GENERICOS = [
  { re: /\b(o|do|no|ao|pelo|nesse|neste|desse|deste|esse|este|nele|dentro do|fora do)\s+(jogo|game)\b/i, campo: 'jogo' },
  { re: /\b(o|do|no|ao|pelo|nesse|neste|desse|deste|esse|este)\s+(fone|headset|iem)\b/i, campo: 'categoria' },
  { re: /\b(a|da|na|pela|nessa|nesta|dessa|desta|essa|esta)\s+(placa|gpu)\b/i, campo: 'produtos' },
  { re: /\b(o|do|no|esse|este|desse|deste|nesse)\s+(modelo|produto|aparelho)\b/i, campo: 'produtos' },
  // "nesse mapa", "dessa partida" — do jogo da conversa
  { re: /\b(nesse|neste|desse|deste|esse|este|no|do)\s+(mapa)\b/i, campo: 'jogo' },
  { re: /\b(nessa|nesta|dessa|desta|essa|esta|na|da)\s+(partida)\b/i, campo: 'jogo' },
  // (sem "o livro", "o anime", "o personagem": achado do revisor — "resuma o
  // livro que anexei" ganhava "(PUBG de PC)")
];

/** Primeira expressão genérica do pedido (sem nome próprio depois), ou null. */
function referenciaGenerica(objetivo) {
  const texto = String(objetivo || '');
  for (const g of GENERICOS) {
    const m = g.re.exec(texto);
    if (!m) continue;
    const depois = texto.slice(m.index + m[0].length);
    const antes = texto.slice(0, m.index);
    // "o personagem Satoru Gojo", "o jogo PUBG": nome logo depois = não é referência
    if (/^\s+(?:[A-Z][\wÀ-ÿ-]*|\d)/.test(depois)) continue;
    // "qual o fone de ouvido mais usado…", "o jogo de tiro": pergunta nova com o
    // substantivo ESPECIFICADO, não referência ao que veio antes ("fone de
    // ouvido" é só o nome completo do fone, não especificação)
    if (/\b(qual|quais|que|um|uma|algum|alguma)\s*$/i.test(antes)) continue;
    if (/^\s+(de|da|do|para|pra|com|mais|menos)\s+[a-zà-ÿ]/i.test(depois) && !/^\s+de ouvido\b/i.test(depois)) continue;
    // "o jogo.html", "jogo_v2", "jogo/": nome de arquivo ou caminho (achado do revisor)
    if (/^[./_\\-]\w/.test(depois)) continue;
    const deOuvido = /^\s+de ouvido\b/i.exec(depois)?.[0] || '';
    return { campo: g.campo, trecho: m[0] + deOuvido, fim: m.index + m[0].length + deOuvido.length };
  }
  return null;
}

/**
 * Resolve a referência genérica contra a conversa. Devolve { objetivo,
 * assunto, mudou, motivo }. Só mexe quando há expressão genérica E a
 * conversa tem o dado que falta — nunca troca o que o pedido já diz.
 */
// Achado do revisor: "adicione um placar ao jogo", "o game que estou
// desenvolvendo precisa de colisão" ganhavam "(PUBG)". Pedido de criar/
// programar fala do jogo DA PESSOA, não do da conversa.
const DESENVOLVIMENTO = /\b(adicion\w+|implement\w+|cri[ae]r?|corrij\w*|program\w*|codigo|código|desenvolv\w+|estou fazendo|meu jogo|meu game|html|javascript|python|godot|unity|unreal|script|função|funcao|bug)\b/i;

function resolverReferencia(objetivo, conversa = []) {
  const original = String(objetivo || '');
  const semMudanca = { objetivo: original, assunto: null, mudou: false, motivo: null };
  if (!conversa.length) return semMudanca;
  if (DESENVOLVIMENTO.test(original)) return semMudanca;
  const ref = referenciaGenerica(original);
  if (!ref) return semMudanca;
  // nome próprio NOVO no pedido ("o jogo que eu jogava ontem, o Hollow Knight"):
  // o assunto é outro — não encaixa o da conversa
  const nomesNovos = (original.match(/(?<=[\s,(])[A-Z][A-Za-zÀ-ÿ0-9]+(?:\s+[A-Z][A-Za-zÀ-ÿ0-9]+)*/g) || []).filter(
    (n) => !JOGOS.some((j) => j.re.test(semAcento(n))) && !/^(PC|Eu|Ok|Oi)$/.test(n)
  );
  if (nomesNovos.length) return semMudanca;
  const anterior = assuntoDaConversa(conversa);
  const atual = assuntoDe(original);
  const partes = [];
  if (ref.campo === 'jogo') {
    if (!atual.jogo && anterior.jogo) partes.push(anterior.jogo);
    if (!atual.plataforma && anterior.plataforma && (anterior.jogo || atual.jogo)) partes.push(`de ${anterior.plataforma}`);
  } else if (ref.campo === 'categoria') {
    // produto da conversa só se for da MESMA categoria ("esse fone" depois de
    // "RTX 4060 vs RX 7600" não vira "esse fone (RTX 4060, RX 7600)")
    const mesmaCategoria = anterior.categoria && /fone/.test(anterior.categoria);
    if (mesmaCategoria && anterior.produtos.length && !atual.produtos.length) partes.push(anterior.produtos.slice(0, 3).join(', '));
    else if (!atual.categoria || atual.categoria === 'fone') {
      if (anterior.categoria && anterior.categoria !== atual.categoria) partes.push(atual.categoria === 'fone' ? anterior.categoria.replace(/^fone /, '') : anterior.categoria);
    }
    if (!atual.jogo && anterior.jogo) partes.push(`para ${anterior.jogo}${anterior.plataforma ? ` de ${anterior.plataforma}` : ''}`);
  } else if (ref.campo === 'produtos') {
    if (!atual.produtos.length && anterior.produtos.length) partes.push(anterior.produtos.slice(0, 3).join(', '));
  }
  if (!partes.length) return { ...semMudanca, assunto: anterior };
  const complemento = ` (${partes.join(' ')})`;
  return {
    objetivo: `${original.slice(0, ref.fim)}${complemento}${original.slice(ref.fim)}`,
    assunto: anterior,
    mudou: true,
    motivo: `"${ref.trecho.trim()}" refere-se ao assunto da conversa: ${partes.join(' ')}`,
  };
}

module.exports = { assuntoDe, assuntoDaConversa, referenciaGenerica, resolverReferencia };
