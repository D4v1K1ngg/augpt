'use strict';

const ollama = require('../llm/ollama');
const { ehPedidoAberto } = require('./auto');

/**
 * Destilação de fatos.
 *
 * Uma leitura devolve 9 mil caracteres de página com menu, rodapé e navegação.
 * Empilhar três dessas no dossiê enche a janela de contexto de ruído e empurra
 * o começo da conversa para fora. Aqui cada leitura vira uma lista curta de
 * fatos relevantes ao pedido.
 *
 * Regra que não pode ser quebrada: o texto BRUTO é preservado. A verificação de
 * evidências confere contra ele, senão um número descartado na destilação
 * viraria "inventado" na verificação.
 */

const MINIMO_PARA_DESTILAR = 1500;
const RESPOSTA_NEGATIVA = /^\W*(n[aã]o h[aá]|o material n[aã]o|n[aã]o (foi|foram) encontrad|n[aã]o encontrei|n[aã]o cont[eé]m|nenhum[a]? (fato|informa|dado))/i;
const MAXIMO_ENVIADO = 14000;
const RESPOSTA_DA_DESTILACAO = 800; // numPredict da chamada (tokens reservados pra resposta)

/**
 * Quantos caracteres DESTE material cabem numa destilação (08/10/2026): o
 * teto fixo de 14.000 caracteres supunha texto corrido (~3,5 caracteres por
 * token), mas página de preço/tabela tem dígito e pontuação em todo lugar
 * (~1,5–2 caracteres por token) — com o Ollama 0.40.1 isso deixou de ser
 * corte silencioso e virou erro 400 (destilação perdida). Mede a densidade
 * do próprio material com `estimarTokens` e devolve o tamanho que cabe na
 * janela, entre 2.000 e MAXIMO_ENVIADO.
 */
function maximoQueCabe({ numCtx = 8192, objetivo = '', foco = '', origem = '', texto = '' }) {
  const amostra = String(texto).slice(0, MAXIMO_ENVIADO);
  if (!amostra) return MAXIMO_ENVIADO;
  const fixo = ollama.estimarTokens(prompt(objetivo, origem, '', foco));
  const orcamento = numCtx - RESPOSTA_DA_DESTILACAO - 200 - fixo;
  const tokensPorCaractere = ollama.estimarTokens(amostra) / amostra.length;
  const cabe = Math.floor(orcamento / tokensPorCaractere);
  return Math.max(2000, Math.min(MAXIMO_ENVIADO, cabe));
}

/**
 * `foco` (correções rápidas do motor de pesquisa, 2026-09-24): a parte do
 * pedido que ESTA leitura precisa cobrir — hoje, o objetivo de uma chamada de
 * `investigar_subtarefa` ("levantar conforto e isolamento dos finalistas").
 * Antes a destilação só via o pedido geral ("melhores fones pra PUBG") e
 * guardava o que parecia relevante pra ele, podendo descartar justamente o
 * trecho sobre conforto que a subtarefa foi buscar. O pedido geral continua
 * no prompt: o foco prioriza, não substitui.
 */
function prompt(objetivo, origem, texto, foco = '', maximo = MAXIMO_ENVIADO) {
  const linhaFoco = foco
    ? `\nFOCO DESTA LEITURA (a parte do pedido que ela foi buscar — priorize fatos sobre isto, sem descartar o que também servir ao pedido):\n${foco}\n`
    : '';
  // 10/10 (SR-71): pedido ABERTO ("me conte mais sobre X") não diz o que
  // "serve" — o 7B respondia NADA em 5 de 7 pedaços da Wikipédia em inglês.
  // Aqui o critério vira "o que torna o assunto marcante".
  const aberto = !foco && ehPedidoAberto(objetivo);
  const tarefa = aberto
    ? `O usuário quer CONHECER o assunto do pedido. Extraia do material os fatos mais marcantes sobre ele: números (velocidade, tamanho, quantidades, custos), datas, recordes, quem criou ou participou, como funciona, episódios importantes e curiosidades. Deixe de fora detalhe administrativo e lista de nomes sem importância. Só escreva NADA se o material não for sobre esse assunto.`
    : foco
      ? // 11/10 (captura de uma pesquisa real de fones): com o critério "serve
        // ao pedido", a página OFICIAL do Simgot EM6L, lida para a ficha dele,
        // voltava "NADA" — ela não fala de PUBG. A leitura tem um foco: é ele
        // que decide o que serve. Nas 3 páginas de ficha testadas: 0 fatos
        // antes; 13, 18 e 26 depois. Lista de loja e página fora do assunto
        // continuaram dando NADA.
        'Extraia do material os fatos sobre o foco desta leitura (indicado acima). O material não precisa falar do resto do pedido: se ele traz dados do item do foco, registre-os.'
      : 'Extraia do material apenas o que serve para responder ao pedido.';
  return `PEDIDO DO USUÁRIO:
${objetivo}
${linhaFoco}
MATERIAL COLETADO (${origem}):
${texto.slice(0, maximo)}

${tarefa}

REGRAS:
- Um fato por linha, começando com "- ".
- Se o material tiver marcadores "--- FONTE n:", comece cada fato com [n] indicando de qual fonte ele veio. Fato que aparece em duas fontes leva as duas: [1][3].
- Copie números, datas, nomes e valores EXATAMENTE como estão. Não arredonde, não converta.
- Nada de menu, rodapé, publicidade, "leia também", banner de cookies ou navegação.
- Não interprete nem conclua: só registre o que o material afirma.
- Se o material não tiver nada relevante ao pedido${foco ? ' nem ao foco' : ''}, escreva apenas a palavra NADA, uma única vez, e pare.
- Escreva os fatos em português, mesmo que o material esteja em outra língua.
- No máximo 25 linhas.

Escreva só as linhas de fatos, sem introdução.`;
}

/** Descarta linhas que não são fato: introdução, comentário, marcador vazio. */
function limpar(bruto) {
  return String(bruto)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((l) => l.length > 8)
    .filter((l) => !/^(aqui está|segue|com base|o material|não há|resumo dos fatos)/i.test(l))
    // o modelo às vezes escreve "Fonte 2: ..." em vez de "[2] ..."
    .map((l) => l.replace(/^fonte\s*(\d+)\s*[:\-]\s*/i, '[$1] '))
    .slice(0, 25);
}

/**
 * Devolve { texto, fatos, bruto, destilado }.
 * Em qualquer falha, entrega o material original — perder conteúdo é pior que
 * gastar contexto.
 */
async function destilar({ config, objetivo, foco = '', origem, texto, modelo, signal, aviso }) {
  const original = String(texto || '');
  const semDestilacao = { texto: original, bruto: original, fatos: 0, destilado: false, uso: null };

  if (!config.destilarFatos || original.length < (config.destilarAcimaDe || MINIMO_PARA_DESTILAR)) {
    return semDestilacao;
  }

  try {
    const maximo = maximoQueCabe({ numCtx: config.numCtx, objetivo, foco, origem, texto: original });
    // só avisa quando o corte vem da DENSIDADE (texto corrido fica perto de
    // 0,32 token/caractere; tabela de preço passa de 0,5) — janela pequena
    // com texto comum já cortava antes, sem aviso
    const amostra = original.slice(0, MAXIMO_ENVIADO);
    if (original.length > maximo && maximo < MAXIMO_ENVIADO && ollama.estimarTokens(amostra) / amostra.length > 0.45) {
      aviso?.(`${origem}: material denso (muitos números/símbolos) — só os primeiros ${maximo} caracteres cabem numa destilação com a janela de ${config.numCtx} tokens.`);
    }
    const r = await ollama.chat({
      host: config.host,
      model: modelo || config.model,
      messages: [{ role: 'user', content: prompt(objetivo, origem, original, foco, maximo) }],
      temperature: 0.1,
      numCtx: config.numCtx,
      numPredict: RESPOSTA_DA_DESTILACAO,
      // 10/10: modelo que pensa (qwen3.5) gastava os 800 tokens raciocinando
      // e toda destilação voltava vazia — extrair fatos não precisa disso
      pensar: false,
      manterVivo: config.manterModeloVivo,
      signal,
    });

    // duracaoMs incluído aqui (pedido de Davi 2026-09-23, detalhamento de
    // custo por fase do raciocínio) pra `loop.js` conseguir repassar a
    // duração real desta chamada pra `contabilizar()` como meta, sem
    // precisar duplicar a chamada a `ollama.chat` só pra medir tempo.
    const uso = { promptTokens: r.promptTokens, completionTokens: r.completionTokens, duracaoMs: r.durationMs };
    if (r.contextoReduzido) {
      aviso?.(`destilação de ${origem}: o Ollama recusou o prompt (${r.contextoReduzido.tokensPedido} tokens numa janela de ${r.contextoReduzido.tokensDisponiveis}); reenviado sem ${r.contextoReduzido.caracteresCortados} caracteres do meio do material.`);
    }
    const conteudo = String(r.content || '').trim();
    // "[NADA]" e "- NADA" também (5º teste real, 2026-09-24: 20 leituras
    // marcadas "fracas" eram só isso — e voltavam como página crua inteira)
    if (/^[\s\-*•[(]*nada\b/i.test(conteudo)) {
      return { texto: `(nada relevante ao pedido em ${origem})`, bruto: original, fatos: 0, destilado: true, uso };
    }

    const fatos = limpar(conteudo);
    // destilação que devolve quase nada provavelmente falhou: fica com o bruto.
    // COM foco, resposta curta é o esperado (2º teste real do motor de
    // pesquisa, 2026-09-24): "quais opções são recomendadas" numa página de
    // 13 mil caracteres rende 2-3 nomes, abaixo dos 2% — e cair no bruto
    // jogava de volta menu, rodapé e vitrine no material da descoberta, que
    // foi exatamente o que a chamada de candidatos recebeu (e respondeu
    // "nenhuma opção"). Com foco, basta 1 fato.
    const fraca = foco ? fatos.length < 1 : fatos.length < 2 || fatos.join('').length < original.length * 0.02;
    // "Não há informação sobre X" é o NADA dito de outro jeito (limpar()
    // descarta essas frases): vira "nada relevante" em vez de devolver a
    // página crua inteira pro material. Hipótese do 4º teste real
    // (2026-09-24, metade das leituras "fracas" mesmo com foco) — o trecho
    // da resposta vai no aviso pra confirmar na próxima revisão.
    if (!fatos.length && RESPOSTA_NEGATIVA.test(conteudo)) {
      return { texto: `(nada relevante ao pedido em ${origem})`, bruto: original, fatos: 0, destilado: true, uso };
    }
    if (fraca) {
      aviso?.(`destilação de ${origem} veio fraca; mantendo o material original (resposta: "${conteudo.replace(/\s+/g, ' ').slice(0, 80)}")`);
      return { ...semDestilacao, uso };
    }

    return {
      texto: fatos.map((f) => `- ${f}`).join('\n'),
      bruto: original,
      fatos: fatos.length,
      destilado: true,
      uso,
      economia: original.length - fatos.join('\n').length,
    };
  } catch (err) {
    aviso?.(`não foi possível destilar ${origem}: ${err.message}`);
    return semDestilacao;
  }
}

/**
 * Funde fatos repetidos entre fontes.
 *
 * Se três fontes dizem "máxima de 32°C", o dossiê carregava a linha três vezes.
 * Fundir economiza contexto E deixa a corroboração visível para o redator —
 * antes só o confronto enxergava isso, num bloco separado.
 */
function chaveDoFato(linha) {
  return String(linha)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\[[\d\]\[]+\]\s*/, '') // marcadores de fonte
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fundir(dossie) {
  const fatos = new Map();
  const soltos = [];

  for (const [indice, entrada] of dossie.entries()) {
    const linhas = String(entrada.texto || '').split('\n');
    if (!entrada.destilado) {
      soltos.push(`[${indice + 1}] ${entrada.origem}\n${entrada.texto}`);
      continue;
    }

    for (const linha of linhas) {
      const limpa = linha.replace(/^\s*-\s*/, '').trim();
      if (!limpa) continue;

      // marcadores que o destilador colocou, ou o índice da entrada
      const marcados = [...limpa.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      const fontes = marcados.length ? marcados : [indice + 1];
      const texto = limpa.replace(/\[\d+\]/g, '').trim();
      const chave = chaveDoFato(texto);
      if (chave.length < 8) continue;

      if (!fatos.has(chave)) fatos.set(chave, { texto, fontes: new Set() });
      fontes.forEach((f) => fatos.get(chave).fontes.add(f));
    }
  }

  const fundidos = [...fatos.values()]
    .sort((a, b) => b.fontes.size - a.fontes.size)
    .map((f) => `- ${f.texto} ${[...f.fontes].sort((a, b) => a - b).map((n) => `[${n}]`).join('')}`);

  return { fundidos, soltos, total: fatos.size };
}

/**
 * Texto original (não destilado) das entradas que passaram pela destilação,
 * para o redator enxergar além dos fatos já comprimidos.
 *
 * A destilação existe para caber no contexto, mas ela sempre descarta nuance
 * no processo: um número secundário, uma ressalva, uma frase que não virou
 * "fato" isolado mas que ajudaria a escrever uma resposta mais completa.
 * `bruto` já era preservado em cada entrada do dossiê para a verificação de
 * evidências — aqui ele também alimenta a síntese final, num bloco à parte,
 * SOMADO aos fatos já comprimidos (que continuam sendo o material principal:
 * o bloco de fatos vem por último em `redigir()` para sobreviver ao corte se
 * o total estourar o orçamento de caracteres).
 *
 * Isto NÃO substitui a filtragem de relevância que a destilação já faz (essa
 * continua sendo o material principal) — é só um extra. Por isso passa por
 * uma limpeza leve das mesmas categorias de ruído que o próprio prompt de
 * destilação já pede para descartar (menu, rodapé, banner, "leia também",
 * newsletter, cookies, política de privacidade): sem isso, o texto bruto de
 * uma página mal extraída reintroduziria exatamente o lixo que a destilação
 * existe para remover.
 */
const RUIDO_DE_PORTAL =
  /\b(menu principal|assine já|newsletter|cookies?|leia também|leia mais|publicidade|compartilhe nas redes|banner de|assinatura com oferta|rodap[ée]|pol[ií]tica de privacidade|termos de uso|todos os direitos reservados)\b/i;

function limparRuido(bruto) {
  const linhas = String(bruto).split('\n');
  const vistas = new Set();
  const limpas = linhas.filter((linha) => {
    const l = linha.trim();
    if (!l) return true; // preserva a separação entre parágrafos
    if (RUIDO_DE_PORTAL.test(l)) return false;
    if (l.length > 20) {
      const chave = l.toLowerCase();
      if (vistas.has(chave)) return false; // banner repetido na mesma página
      vistas.add(chave);
    }
    return true;
  });
  return limpas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function materialOriginal(dossie, orcamentoTotal = 12000) {
  const destiladas = dossie.filter((e) => e.destilado && e.bruto && e.bruto.length > 0);
  if (!destiladas.length) return '';

  const porFonte = Math.max(800, Math.floor(orcamentoTotal / destiladas.length));
  const blocos = destiladas
    .map((e) => {
      const limpo = limparRuido(e.bruto);
      if (!limpo) return null;
      const bruto = limpo.length > porFonte ? `${limpo.slice(0, porFonte)}\n[…]` : limpo;
      return `[trecho original de ${e.origem}]\n${bruto}`;
    })
    .filter(Boolean);
  return blocos.join('\n\n');
}

module.exports = {
  prompt,
  destilar, limpar, fundir, chaveDoFato, materialOriginal, limparRuido, MINIMO_PARA_DESTILAR,
  // Exportado pro "chunking" de documento grande (loop.js, _destilarGrande):
  // cada pedaço enviado pra destilar() precisa ficar dentro deste mesmo teto,
  // senão prompt() aqui truncaria o pedaço de novo por dentro, silenciosamente.
  MAXIMO_ENVIADO,
  maximoQueCabe,
  __promptParaTeste: prompt,
};
