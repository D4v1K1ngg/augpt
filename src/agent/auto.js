'use strict';

/**
 * Modo AUTO (pedido do Davi, 10/10/2026): cada pedido ganha um NÍVEL, e o
 * nível decide quais etapas rodam e com qual modelo.
 *
 * Origem: a pergunta "Me conte mais sobre o Black bird sr71" passou pelo
 * pipeline inteiro (ambiguidade, plano de 8 itens com "vídeos no YouTube",
 * crítico periódico, 22 destilações de 6 Wikipédias) — 192 s para uma
 * resposta pior que a do Ollama puro, que respondeu em segundos (mas com 7
 * números errados). A potência máxima em TODA pergunta atrapalhava.
 *
 *   0 · direto               saudação, agradecimento, texto criativo, conta:
 *                            só o modelo, sem busca (~5 s)
 *   1 · conversa c/ pesquisa "me fale sobre X", "o que é", "quem foi": 1 busca
 *                            + Wikipédia, ficha de fatos e escrita LIVRE
 *                            (resposta-rapida.js, ~20–40 s)
 *   2 · pesquisa padrão      o laço do agente, sem plano forçado nem crítico
 *                            periódico, profundidade no máximo "média"
 *   3 · pesquisa profunda    compra, comparação, guia, pedido com várias
 *                            partes: tudo o que está ligado em Ajustes
 *
 * Só regra de código: decide em milissegundos e é testável. O que está
 * marcado em Ajustes é o TETO — o AUTO só desliga etapas.
 */

const { normalizarPedido: normalizar } = require('./tipo-de-pedido');

const NOMES = Object.freeze(['direto', 'conversa com pesquisa', 'pesquisa padrão', 'pesquisa profunda']);

const PREFIXO_CORTES = /^(voce sabe|vc sabe|sabe me dizer|me diga|me diz|gostaria de saber|queria saber|quero saber|preciso saber|pode me dizer|poderia me dizer|tenho uma duvida|uma duvida|ei|oi|ola|claude|augpt)\s+/;

// pedido aberto: o usuário quer CONHECER um assunto
const ABERTO = /^(me |nos )?(conte|conta|contar|fale|fala|falar|explique|explica|explicar|descreva|descreve|resuma|resume|apresente)(\s+(mais|um pouco|tudo|algo|coisas))*(\s+(sobre|a respeito d\w+|acerca d\w+|do|da|dos|das|de|o|a|os|as))?\b|^(o que (e|sao|foi|foram|era|eram)|quem (e|foi|sao|foram|era|eram)|como (funciona|funcionam|funcionava|surgiu|surgiram|foi criad\w+|e feit\w+)|qual (e|foi) a (historia|origem)|historia d[oae]s?|origem d[oae]s?|curiosidades (sobre|d[oae]s?)|fatos (sobre|curiosos)|por que|porque|pq|o que (aconteceu|significa|causa|causou))\b/;

// precisa de dado de AGORA: uma busca rápida não basta
const ATUAL = /\b(hoje|agora|atual|atualmente|ultim[oa]s?|recentes?|recentemente|noticias?|novidades?|cotacao|precos?|quanto custa|custa quanto|clima|previsao|temperatura em|placar|resultado d[oe]|esta semana|essa semana|este mes|este ano|ontem|amanha|lancamento|lancou|vai lancar|patch|atualizacao|update|em 20[2-3]\d)\b/;

const SAUDACAO = /^(oi+|ola|opa|eae|e ai|eai|bom dia|boa tarde|boa noite|tudo bem|tudo bom|como vai|como voce esta|obrigad[oa]|muito obrigad[oa]|valeu|vlw|blz|beleza|show|perfeito|otimo|legal|massa|top|entendi|ok|okay|certo|tchau|ate mais|falou)( [a-z]+){0,4}$/;
const CRIATIVO = /^(escreva|escreve|crie|cria|faca|faz|componha|invente|inventa|gere|gera|me (de|da|conte|conta)) (um|uma|uns|umas)( [a-z]+){0,2}? (poema|poesia|piada|piadas|haicai|haiku|historinha|historia curta|conto curto|trava lingua|frase motivacional|frases motivacionais|mensagem de (aniversario|bom dia|boa noite|parabens)|rima|rimas|acrostico|slogan|slogans|trocadilho|trocadilhos)\b/;
const TRADUCAO = /^(traduza|traduz|traduzir|reescreva|reescreve|corrija a ortografia|corrija o portugues|revise o texto)\b/;
const CONTA = /^[\d\s+\-*/().,x^%=?]+$|^(quanto (e|da) )[\d\s+\-*/().,x^%]+\??$/;

// pedido que precisa das ferramentas do agente (arquivo, código, site)
const PRECISA_DE_FERRAMENTA = /\b(arquivo|arquivos|pasta|planilha|pdf|docx|csv|codigo|script|programa em|execute|rode|instale|baixe|site|pagina|link|url|login|https?)\b/;

/**
 * { nivel, nome, motivo }.
 * `tipo` vem do roteador/regra (tipo-de-pedido.js); `refereConversa` diz se
 * o pedido depende da conversa anterior ("e o outro?", "faz de novo");
 * `multiplas` é o número de perguntas na mesma mensagem.
 */
function decidirNivel({ objetivo, tipo = 'livre', refereConversa = false, multiplas = 1, precisaPlanejamento = false } = {}) {
  const original = String(objetivo || '').trim();
  let t = normalizar(original);
  for (let i = 0; i < 2; i += 1) t = t.replace(PREFIXO_CORTES, '');
  const resposta = (nivel, motivo) => ({ nivel, nome: NOMES[nivel], motivo });

  if (!t) return resposta(2, 'pedido vazio');

  // 3 · o motor de pesquisa (compra, comparação, guia) e pedido com várias partes
  if (tipo === 'produto' || tipo === 'guia') return resposta(3, tipo === 'produto' ? 'escolha, compra ou comparação de opções' : 'tática, guia ou tutorial');
  if (multiplas >= 3 || precisaPlanejamento) return resposta(3, 'pedido com várias partes');

  // ação no computador ou em site: o laço do agente com as ferramentas
  if (tipo === 'local' || tipo === 'site') return resposta(2, tipo === 'local' ? 'mexe em arquivo ou pasta' : 'age num site');

  // 0 · sem nada a pesquisar
  if (!refereConversa) {
    if (SAUDACAO.test(t) && original.length <= 60) return resposta(0, 'saudação ou conversa');
    if (CRIATIVO.test(t) && original.length <= 220) return resposta(0, 'texto criativo curto');
    if (TRADUCAO.test(t) && !PRECISA_DE_FERRAMENTA.test(t)) return resposta(0, 'tradução ou revisão de texto dado');
    if (CONTA.test(t)) return resposta(0, 'conta');
  } else if (SAUDACAO.test(t) && original.length <= 60) {
    return resposta(0, 'agradecimento ou reação à resposta anterior');
  }

  // 1 · conhecer um assunto estável, numa pergunta só
  const aberto = ABERTO.test(t) || tipo === 'explicacao';
  if (aberto && !ATUAL.test(t) && !PRECISA_DE_FERRAMENTA.test(t) && !refereConversa && multiplas <= 1 && original.length <= 220) {
    return resposta(1, 'pergunta sobre um assunto (sem dado do momento)');
  }
  if (aberto && ATUAL.test(t)) return resposta(2, 'precisa de informação atual');
  if (aberto && refereConversa) return resposta(2, 'continua a conversa anterior');
  if (multiplas === 2) return resposta(2, 'duas perguntas na mesma mensagem');
  return resposta(2, 'pedido geral');
}

/** O assunto de um pedido aberto: "Me conte mais sobre o Black bird sr71" → "Black bird sr71". */
function assuntoDoPedido(objetivo) {
  let s = String(objetivo || '').trim().replace(/[?!.]+$/, '');
  const semAcento = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const corte = /^(?:(?:você|voce|vc) sabe|sabe me dizer|me diga|me diz|gostaria de saber|queria saber|quero saber|pode me dizer|poderia me dizer)\s+/i;
  s = s.replace(corte, '');
  const m = /^(?:(?:me|nos)\s+)?(?:conte|conta|contar|fale|fala|falar|explique|explica|explicar|descreva|descreve|resuma|resume|apresente)(?:\s+(?:mais|um pouco|tudo|algo|coisas))*\s+(?:sobre|a respeito d\w+|acerca d\w+|d[oae]s?|de)?\s*/i.exec(semAcento(s));
  if (m) s = s.slice(m[0].length);
  else {
    const p = /^(?:o que (?:é|e|são|sao|foi|foram|era|eram)|quem (?:é|e|foi|são|sao|foram|era|eram)|como (?:funciona|funcionam|funcionava|surgiu|surgiram)|qual (?:é|e|foi) a (?:história|historia|origem) d[oae]s?|hist[óo]ria d[oae]s?|origem d[oae]s?|curiosidades (?:sobre|d[oae]s?)|fatos sobre)\s+/i.exec(s);
    if (p) s = s.slice(p[0].length);
    else {
      // sujeito no meio: "Como um gerador funciona" → "gerador"; "como que o
      // acidente de Chernobyl aconteceu" → "acidente de Chernobyl". Com a
      // frase inteira, a Wikipédia não achava a página e a ficha vinha vazia.
      const meio = /^como\s+(?:que\s+)?((?:\S+\s+){0,5}?\S+?)\s+(?:realmente\s+)?(?:funciona|funcionam|aconteceu|acontece|ocorreu|ocorre|surgiu|surgiram|se\s+forma|se\s+formam|se\s+formou|se\s+formaram|(?:é|e|são|sao|foi|foram)\s+(?:feit|criad|inventad|construid|fabricad|produzid|formad|montad)\w+)\s*$/i.exec(s);
      if (meio) s = meio[1];
    }
  }
  s = s.replace(/^(?:o|a|os|as|um|uma)\s+/i, '').trim();
  return s || String(objetivo || '').trim();
}

/** Pedido aberto ("me fale sobre X"), usado também pela destilação. */
function ehPedidoAberto(objetivo) {
  let t = normalizar(objetivo);
  for (let i = 0; i < 2; i += 1) t = t.replace(PREFIXO_CORTES, '');
  return ABERTO.test(t);
}

const ORDEM_PROFUNDIDADE = ['normal', 'media', 'alta'];
const menor = (ordem, a, b) => (ordem.indexOf(a) < 0 ? b : ordem.indexOf(b) < 0 ? a : ordem[Math.min(ordem.indexOf(a), ordem.indexOf(b))]);

/**
 * Ajustes de configuração do nível — só DESLIGAM (o que está em Ajustes é o
 * teto). Nível 3 não muda nada além do modelo de redação, se escolhido.
 */
function ajustesDoNivel(nivel, config = {}, { temConversa = true } = {}) {
  const ajustes = {};
  // sem conversa anterior não há referência a resolver: a verificação de
  // ambiguidade (~5 s) só serviria para bifurcar o pedido
  if (nivel <= 2 && !temConversa) ajustes.verificarAmbiguidade = false;
  if (nivel <= 2) {
    // `nivelRaciocinio` fica como está: além da profundidade, ele decide a
    // cautela com memória velha (frescor) — isso não é potência, é segurança
    ajustes.profundidadePesquisa = menor(ORDEM_PROFUNDIDADE, config.profundidadePesquisa || 'normal', 'media');
    ajustes.pipelineForcadoUniversal = false;
    ajustes.planejamentoInicial = false;
    ajustes.criticaPeriodica = false;
    ajustes.criticaAutomaticaPorEtapaMax = Math.min(Number(config.criticaAutomaticaPorEtapaMax) || 12, 4);
    ajustes.reselecaoDeSkill = 'deterministica';
  }
  if (nivel === 3 && config.autoModeloProfundo) ajustes.modelRedacao = config.autoModeloProfundo;
  return ajustes;
}

/**
 * O assunto já está na memória da pasta de trabalho? Nota salva (qualquer
 * conversa) ou leitura desta MESMA conversa que cita as palavras do assunto
 * → o laço (nível 2), que consulta a memória; a resposta rápida não consulta.
 * "Me conte mais sobre o projeto fenix" é sobre o projeto do usuário, não
 * sobre a web. Leitura de outra conversa não conta: o SR-71 pesquisado
 * ontem não pode prender o SR-71 de hoje no laço.
 */
const PALAVRA_FRACA = new Set(['sobre', 'mais', 'como', 'qual', 'quais', 'para', 'pela', 'pelo', 'entre', 'esse', 'essa', 'isso', 'este', 'esta', 'meus', 'minha', 'minhas', 'nosso', 'nossa', 'historia', 'tudo']);
function assuntoNaMemoria(assunto, itens = [], { idConversa = null } = {}) {
  const palavras = normalizar(assunto).split(' ').filter((p) => p.length >= 4 && !PALAVRA_FRACA.has(p));
  if (!palavras.length) return false;
  return (Array.isArray(itens) ? itens : []).some((i) => {
    const valido = i?.tipo === 'nota' || (i?.tipo === 'dossie' && idConversa && i.idConversa === idConversa);
    if (!valido) return false;
    const t = normalizar(i.texto);
    return palavras.every((p) => t.includes(p));
  });
}

module.exports = { assuntoNaMemoria, decidirNivel, assuntoDoPedido, ehPedidoAberto, ajustesDoNivel, NOMES };
