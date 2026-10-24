'use strict';

/**
 * Nomes de lugares, do jeito que as pessoas escrevem, para o jeito que os serviços de mapa e clima
 * acham (23/10, revisão de como os recursos são chamados: "onde fica a cidade de Iconha-ES" buscou
 * "cidade de Iconha-ES" e não achou nada). Vale para o mapa, o clima e o que vier.
 */

const UFS = new Set(['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to']);
// a palavra que descreve o lugar só sai em minúscula: "a cidade de Iconha" → "Iconha", mas "Cidade do México" fica
const DESCRITOR = /^(?:(?:a|o|the)\s+)?(?:cidade|munic[íi]pio|estado|pa[íi]s|bairro|regi[ãa]o|vila|distrito|povoado|localidade|praia|city|town|state|country|village|neighbou?rhood)\s+(?:de|do|da|dos|das|of)\s+/;

// lugar dito por uma relação ("a capital da Bahia", "a maior cidade do Brasil", "onde o Pelé nasceu"):
// pede conhecimento — quem resolve é o entendimento (o modelo), não a busca pelo nome
const POR_RELACAO = /(?<!\p{L})(capital|maior|menor|mais (?:alt[oa]|populos[oa]|antig[oa]|frio|quente|perto|pr[óo]xim[oa])|sede|natal|nasceu|onde (?:mora|vive)|biggest|largest|smallest|capital of|hometown|born)(?!\p{L})/iu;
const porRelacao = (s) => POR_RELACAO.test(String(s || ''));
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
/**
 * O modelo não resolveu a relação (23/10: "a maior cidade do Brasil" → ["Brasil"]): a pergunta é por
 * relação e todo lugar que ele devolveu já está escrito nela. Aí a pesquisa responde, não o mapa errado.
 */
const naoResolveu = (pergunta, lugares = []) => porRelacao(pergunta) && (Array.isArray(lugares) ? lugares : []).every((l) => semAcento(pergunta).includes(semAcento(String(l).split(',')[0]).trim()));

/** "a cidade de Iconha-ES" → "Iconha, ES"; "Iconha/ES", "Iconha (ES)", "Iconha - ES" → "Iconha, ES". */
function normalizarLugar(texto) {
  let s = String(texto || '').replace(/\s+/g, ' ').replace(/[?!.;:]+\s*$/, '').trim();
  s = s.replace(/^(?:(?:a|o|as|os|the)\s+)(?=[A-ZÀ-Ú])/, ''); // "a Torre Eiffel" → "Torre Eiffel"
  for (let i = 0; i < 2 && DESCRITOR.test(s); i += 1) s = s.replace(DESCRITOR, '');
  s = s.replace(/\s*(?:-|–|\/|\()\s*([A-Za-z]{2})\)?$/, (m, uf) => (UFS.has(uf.toLowerCase()) ? `, ${uf.toUpperCase()}` : m));
  return s.trim();
}

/** O que tentar, em ordem: o nome limpo, sem o complemento depois da vírgula e os nomes de reserva (do entendimento). */
function tentativas(nome, reservas = []) {
  const lista = [nome, ...(Array.isArray(reservas) ? reservas : [])].map(normalizarLugar).filter((n) => n && n.length >= 2);
  const comSemComplemento = lista.flatMap((n) => [n, n.split(',')[0].trim()]);
  return [...new Set(comSemComplemento)].slice(0, 4);
}

/* ------------------------------ "lá", "ali", "nessa cidade" ------------------------------ */

// referência ao que a conversa já disse — nunca é nome de lugar ("até lá" virou Los Angeles, 23/10)
const DEITICO = /^(?:l[áa]|ali|a[íi]|aqui|l[áa] mesmo|(?:n|d)?(?:ess|est)[ea] (?:lugar|cidade|local|regi[ãa]o|pa[íi]s)|there|here|that (?:place|city)|this (?:place|city))$/i;
const ehDeitico = (s) => DEITICO.test(String(s || '').trim());
const MENCIONA_DEITICO = /(?<!\p{L})(l[áa]|ali|nesse lugar|nessa cidade|desse lugar|dessa cidade|nesse local|there|that city|that place)(?!\p{L})/iu;

/** O último lugar que um cartão mostrou na conversa (o rastro "[cartão de mapa: …]"); na rota, o destino. */
function lugarDaConversa(conversa = []) {
  for (const m of [...(Array.isArray(conversa) ? conversa : [])].reverse()) {
    const achados = [...String(m?.content || '').matchAll(/\[cartão de (?:mapa|clima): ([^\]]+)\]/g)];
    if (!achados.length) continue;
    const ultimo = achados[achados.length - 1][1];
    return (ultimo.split(' → ').pop() || '').trim() || null;
  }
  return null;
}

/**
 * Qual lugar usar: o do texto (se não for "lá"), o que o entendimento leu, o da conversa (quando a
 * pergunta aponta para ela ou não há outro) e, por último, o da memória ("moro em …").
 */
function escolherLugar({ doTexto = null, reservas = [], conversa = [], pergunta = '', memoria = null } = {}) {
  const valido = (x) => x && !ehDeitico(x);
  if (valido(doTexto)) return doTexto;
  const reserva = (Array.isArray(reservas) ? reservas : []).find(valido);
  if (reserva) return reserva;
  const daConversa = lugarDaConversa(conversa);
  if (daConversa && (ehDeitico(doTexto) || MENCIONA_DEITICO.test(String(pergunta || '')) || !memoria)) return daConversa;
  return memoria || null;
}

/** O rastro que um cartão deixa no histórico, no lugar do JSON (o modelo e as rotas leem a conversa). */
function rastroDoCartao(tipo, json) {
  try {
    const j = JSON.parse(json);
    const curto = (l) => [l?.nome, String(l?.onde || '').split(',')[0].trim()].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
    if (tipo === 'mapa') return j.tipo === 'rota' ? `[cartão de mapa: ${curto(j.origem)} → ${curto(j.destino)}]` : `[cartão de mapa: ${curto(j.lugar)}]`;
    if (tipo === 'clima') return `[cartão de clima: ${j.local}]`;
    if (tipo === 'calendario') return `[cartão de calendário: ${j.mes}/${j.ano}]`;
    if (tipo === 'compras') {
      const menor = (j.ofertas || []).filter((o) => o.exato && !o.suspeito).sort((x, y) => x.preco - y.preco)[0];
      return `[cartão de compras: ${j.produto}${menor ? ` — menor preço R$ ${menor.preco} na ${menor.loja}` : ''}]`;
    }
  } catch {
    // JSON quebrado: sem rastro
  }
  return '';
}

module.exports = { normalizarLugar, porRelacao, naoResolveu, tentativas, ehDeitico, lugarDaConversa, escolherLugar, rastroDoCartao, UFS };
