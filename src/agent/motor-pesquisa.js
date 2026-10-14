'use strict';

/**
 * Motor de pesquisa para recomendação e comparação (2026-09-24).
 *
 * Por que existe: o Davi trouxe uma análise externa (ChatGPT) do caso real
 * "quais os melhores fones intra-auriculares pra jogar PUBG no PC". Conferido
 * no código, o diagnóstico central estava certo: o agente EXECUTAVA buscas,
 * mas não montava uma investigação. O modelo decidia uma busca de cada vez,
 * reformulava a mesma pergunta, os critérios que decidem "melhor" (posição do
 * som, separação, conforto, preço) ficavam implícitos, e ninguém descobria
 * quais eram as opções antes de compará-las. O redator recebia um monte de
 * trechos e tinha que organizar a comparação sozinho.
 *
 * O que muda, só pra pedido de recomendação/comparação:
 *
 *   1. PLANO — uma chamada ao modelo, em texto: o uso que decide o que é
 *      "melhor", 3-6 critérios com peso e termos de busca, opções que o
 *      próprio usuário citou, e buscas de descoberta por ângulos diferentes.
 *   2. DESCOBERTA — o CÓDIGO roda as buscas de descoberta (não o modelo,
 *      rodada a rodada) e uma segunda chamada lista as opções citadas no
 *      material. O código confere cada nome no material e conta em quantos
 *      sites diferentes ele aparece: nome inventado cai fora, nome citado
 *      por mais sites sobe.
 *   3. INVESTIGAÇÃO — uma busca por finalista, mirada nos critérios de peso
 *      alto.
 *   4. MATRIZ — finalista × critério, montada pelo código a partir das
 *      frases do material que citam a opção E um termo do critério. A
 *      cobertura é medida por célula, não por palavra do pedido.
 *   5. LACUNAS — se a cobertura ponderada ficar baixa, uma busca por
 *      finalista com os critérios que faltaram, dentro do orçamento.
 *   6. PLANO DA RESPOSTA — critérios, opções, a evidência de cada célula
 *      (ou "sem evidência"), as lacunas e o formato, entregues prontos ao
 *      redator. Ele escreve; não precisa mais descobrir a estrutura.
 *
 * O que NÃO muda (decisões conscientes): nada de reescrever loop.js — isto é
 * uma camada que roda ANTES do laço de decisão, usando as mesmas ferramentas
 * (pesquisar_e_ler, destilação com foco, confronto, verificador); nada de
 * grafo de evidências — a matriz candidato × critério é a estrutura que a
 * resposta precisa (é a tabela que a skill Comparativo já pede), e grafo
 * semântico já tinha sido descartado com o Davi; e o mínimo de chamadas de
 * modelo novas (duas: plano e candidatos), porque cada chamada num Ollama
 * local custa dezenas de segundos.
 *
 * Tudo aqui é testável sem Ollama: as funções puras recebem texto e dossiê,
 * e o orquestrador `executarPesquisaPlanejada` recebe `chamarModelo` e
 * `buscar` injetados (loop.js passa os de verdade; a bancada, os falsos).
 */

const prompts = require('./prompts');
const { consultasNaComunidade, tipoDeFonte, fontesDaComunidade } = require('../tools/comunidade');
const { Evidencias, STATUS, chaveDeFonte } = require('./evidencias');
const { perfilDoPedido } = require('./perfis');
const { produtosDoPedido, precosDaFrase } = require('./serie-de-precos');
const desempenho = require('./comparativo-de-desempenho');
const usoPro = require('./uso-profissional');
const { tipoDoPedido, produtosNomeados, OBJETO_PRODUTO, OBJETO_DE_CATALOGO } = require('./tipo-de-pedido');
const guia = require('./guia');

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/* ------------------------------ quando entra ------------------------------ */

/**
 * Pedido de recomendação ou comparação? Regra de código, sem modelo — o
 * mesmo motivo de `classificarPedido` (verificador.js): um modelo pequeno
 * decide isso de um jeito diferente a cada execução. "melhor forma de",
 * "melhorar" e afins ficam de fora: são pedidos de como fazer, não de qual
 * escolher. "vale a pena" também (é decisão sobre UMA opção, a skill
 * Comparativo já exclui pelo mesmo motivo).
 */
const GATILHOS_RECOMENDACAO = [
  /\bmelhor(?:es)?\b(?!\s+(?:forma|maneira|jeito|modo|hora|momento|epoca|horario|caminho)\b)/,
  /\bqual\s+(?:\w+\s+){0,3}(?:escolher|comprar|pegar|assinar|contratar)\b/,
  /\b(?:me\s+)?(?:recomend\w*|indica\w*)\b/,
  /\b(?:compar\w+|versus|vs)\b/,
  /\btop\s+\d+\b/,
  // 13º teste real: "qual é a diferença de desempenho entre A e B?"
  /\bdiferen\w*\b[^.?]{0,80}\bentre\b/,
  /\b(?:opcoes|alternativas)\s+(?:de|para|pra|ao|a)\b/,
];
// "melhor preço da RTX 5080" é busca de preço de UM produto (skill de
// compras, buscar_produtos), não escolha entre opções.
const EXCLUSOES_RECOMENDACAO =
  /\b(?:melhorar|melhoria|melhora|vale\s+a\s+pena|melhor(?:es)?\s+(?:preco|precos|oferta|ofertas|desconto|descontos))\b/;

/**
 * Roteador de modos do motor (revisão v2 — "Task Router", só regra de
 * código: com o 7B a classificação mudava a cada execução). Um modo só existe
 * quando tem caminho próprio:
 *   'desempenho'        — diferença de desempenho entre produtos nomeados (Etapa F)
 *   'uso-profissional'  — "mais usado pelos profissionais" (Etapa G)
 *   'recomendacao'      — "quais os melhores", "top 10", comparação de opções
 * null = não é pesquisa do motor (o laço de sempre cuida).
 */
function modoDaPesquisa(objetivo, { rota = null } = {}) {
  const texto = normalizar(objetivo);
  if (!texto || texto.length > 600) return null;
  // Roteador híbrido (roteador.js, 2026-10-10): quando o modelo de decisão
  // trocou a rota da regra, o tipo dele vale aqui também — senão o loop
  // diria "explicação" e o motor, relendo só a regra, abriria a pesquisa de
  // produto. Sem `rota` (ou rota da própria regra) nada muda.
  if (rota && rota.fonte === 'decisor') {
    if (rota.tipo === 'guia') return 'guia';
    if (rota.tipo === 'explicacao' || rota.tipo === 'local' || rota.tipo === 'livre') return null;
    if (desempenho.ehPedidoDeDesempenho(objetivo)) return 'desempenho';
    if (usoPro.ehPedidoDeUsoProfissional(objetivo)) return 'uso-profissional';
    if (rota.tipo === 'produto') return 'recomendacao';
  }
  // Revisão v3 (Fase 1): o OBJETO do pedido decide antes da palavra.
  // "melhores táticas de PUBG" (técnica) vai pro guia; "por que…",
  // "diferença entre vírus e bactéria" (conceito) e pedidos de arquivo
  // não entram no motor.
  // Achado do revisor: "quantos fps a mais a 5080 faz que a 5070 ti" e "o que os
  // pros de valorant usam de mouse" não são 'produto' pelo objeto, mas têm
  // caminho próprio — só explicação e arquivo saem do motor; o resto segue a
  // cadeia de sempre (desempenho → uso profissional → recomendação).
  const regra = tipoDoPedido(objetivo);
  const tipo = regra.tipo;
  if (tipo === 'guia') return 'guia';
  if (tipo === 'explicacao' || tipo === 'local') return null;
  if (desempenho.ehPedidoDeDesempenho(objetivo)) return 'desempenho';
  if (usoPro.ehPedidoDeUsoProfissional(objetivo)) return 'uso-profissional';
  // revisão v4: avaliar/comparar produto que o usuário nomeou (Kinera, Bose × QC 20)
  if (tipo === 'produto' && produtosNomeados(objetivo).length) return 'recomendacao';
  // 14/10: "fone de ouvido dunu titan s" — tipo + marca/modelo, sem palavra de
  // escolha: entra no motor (o entendimento do pedido decide o caminho lá dentro)
  if (tipo === 'produto' && regra.motivo === 'tipo de produto + marca/modelo') return 'recomendacao';
  return ehPedidoDeRecomendacaoSimples(texto) ? 'recomendacao' : null;
}

function ehPedidoDeRecomendacao(objetivo, opcoes = {}) {
  return modoDaPesquisa(objetivo, opcoes) !== null;
}

function ehPedidoDeRecomendacaoSimples(textoNormalizado) {
  const texto = textoNormalizado;
  if (EXCLUSOES_RECOMENDACAO.test(texto)) return false;
  return GATILHOS_RECOMENDACAO.some((re) => re.test(texto));
}

/**
 * Quantas buscas o motor faz, por nível de raciocínio. O "leve" continua
 * perto do teto antigo (4 buscas) — 5 no máximo —, os outros níveis compram
 * mais finalistas e mais rodadas de lacuna. As buscas do motor contam no
 * teto de buscas soltas da execução (ver loop.js): depois dele, o modelo só
 * busca mais o que sobrar.
 */
const ORCAMENTO_POR_NIVEL = {
  // comunidade = quantas fontes da comunidade (Reddit, fóruns) entram na descoberta
  // lista = tamanho da lista larga (Fase C); minimo = abaixo disso, mais uma rodada na comunidade
  // Etapa C: bateria = buscas na comunidade na 1ª leva (a 2ª rodada usa as
  // que sobrarem); topicos = quantos tópicos passam pela extração por tópico
  leve: { descoberta: 1, comunidade: 2, finalistas: 3, lacunas: 1, lista: 8, minimo: 5, conhecimento: 1, bateria: 2, topicos: 4 },
  medio: { descoberta: 2, comunidade: 3, finalistas: 4, lacunas: 2, lista: 10, minimo: 6, conhecimento: 2, bateria: 4, topicos: 8 },
  alto: { descoberta: 2, comunidade: 4, finalistas: 5, lacunas: 3, lista: 12, minimo: 8, conhecimento: 2, bateria: 6, topicos: 12 },
  extremo: { descoberta: 3, comunidade: 4, finalistas: 5, lacunas: 4, lista: 15, minimo: 8, conhecimento: 2, bateria: 8, topicos: 16 },
};

/** Cobertura ponderada a partir da qual as buscas de lacuna não rodam. */
const COBERTURA_SUFICIENTE = 0.7;

const PESOS = { alto: 2, medio: 1, baixo: 0.5 };

/* ------------------------------ 1. plano ------------------------------ */

function limparItem(linha) {
  return String(linha)
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^["'<]+|["'>]+$/g, '')
    .trim();
}

// Condição que muda o TIPO de produto (8º teste real, 2026-09-25): o pedido
// era "fones intra auriculares para jogar PUBG de PC" e o plano do 7B pôs no
// uso "usando fones intra-auriculares sem fio" (copiou do exemplo do prompt).
// A descoberta buscou "sem fio", os finalistas viraram TWS Bluetooth e os
// critérios, "autonomia de bateria" e "compatibilidade". Condição dessas só
// fica se o pedido disse.
const CONDICOES = [
  { pedido: /\b(sem fio|wireless|bluetooth|tws)\b/, texto: /\s*\b(?:sem fio|wireless|bluetooth|TWS)\b/gi },
  { pedido: /\b(com fio|cabeado|cabo|wired)\b/, texto: /\s*\b(?:com fio|cabeados?|wired)\b/gi },
  { pedido: /\b(barat\w*|economic\w*|ate r|orcamento|custo baixo|cheap|budget)\b/, texto: /\s*\b(?:barat[oa]s?|econ[oô]mic[oa]s?|cheap|budget)\b/gi },
];

function semCondicaoInventada(texto, objetivo, { soPalavras = false } = {}) {
  const pedido = normalizar(objetivo);
  let saida = String(texto || '');
  for (const c of CONDICOES) {
    if (c.pedido.test(pedido) || !c.pedido.test(normalizar(saida))) continue;
    if (!soPalavras) {
      // "..., usando fones intra-auriculares sem fio" → tira a oração inteira
      const partes = saida.split(/,\s*/);
      const ficam = partes.filter((p) => !c.pedido.test(normalizar(p)));
      if (ficam.length && ficam.length < partes.length) {
        saida = ficam.join(', ');
        continue;
      }
    }
    saida = saida.replace(c.texto, '');
  }
  return saida.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/**
 * Critério pendurado na busca (10º teste real, 2026-09-26): o plano
 * escreveu USO "jogar PUBG de PC com isolamento acústico, qualidade sonora
 * precisa e conforto..." e BUSCA EM INGLÊS "best in-ear headphones for PC
 * gaming with noise cancellation" — a descoberta inteira foi pra fones
 * Bluetooth com ANC, o pior tipo pra jogo competitivo. Oração final "com
 * .../with ..." cujas palavras o pedido não disse sai.
 */
function semRecursoPendurado(texto, objetivo) {
  const saida = String(texto || '');
  const m = /\s+(?:com|with|que tenha|que tenham|having)\s+(.+)$/i.exec(saida);
  if (!m) return saida;
  const pedido = new Set(normalizar(objetivo).split(' '));
  const palavras = normalizar(m[1]).split(' ').filter((p) => p.length >= 4);
  if (!palavras.length) return saida;
  const novas = palavras.filter((p) => !pedido.has(p) && ![...pedido].some((q) => q.length >= 5 && (q.startsWith(p.slice(0, 5)) || p.startsWith(q.slice(0, 5)))));
  if (novas.length / palavras.length < 0.5) return saida;
  const curto = saida.slice(0, m.index).trim();
  return curto.split(' ').length >= 2 ? curto : saida;
}

// Critério que vale pra qualquer produto e não decide nada (8º teste real:
// "compatibilidade", peso alto). Sai, a não ser que o pedido fale disso.
// 12º teste real: "design compacto" com peso alto
const CRITERIO_VAGO = /^(compatibilidade|design|estilo|aparencia|marca|qualidade|desempenho)(?:\s+(?:geral|leve|bonito|bonita|compacto|compacta|moderno|moderna|elegante|bom|boa|com .*))?$/;
// Critério sobre a PESQUISA, não sobre o produto (12º teste real: o perfil
// "comunidade gamer | feedback da comunidade" virou critério e linha da
// tabela, toda "sem dados"). A opinião da comunidade já tem lugar próprio.
const CRITERIO_META = /\b(feedback|comunidade|avaliac\w*|opiniao|opinioes|review\w*|reputac\w*|recomendac\w*|popularidade|disponibilidade)\b/;

// Mesmo critério com outro nome (8º teste real: "atraso do áudio" do plano e
// "Baixa latência" do material viraram dois critérios de peso alto).
const SINONIMOS = [
  ['atraso', 'latencia', 'delay', 'lag', 'sincronia'],
  ['bateria', 'autonomia'],
  ['preco', 'custo', 'valor'],
  ['conforto', 'ergonomia', 'encaixe'],
  ['microfone', 'mic'],
  ['posicionamento', 'imaging', 'direcional', 'espacializacao', 'palco', 'soundstage', 'imagem', 'passos', 'localizacao'],
  ['isolamento', 'vedacao'],
];
function grupoDoCriterio(nome) {
  const tokens = normalizar(nome).split(' ');
  return SINONIMOS.findIndex((g) => g.some((s) => tokens.includes(s)));
}
function mesmoCriterio(a, b) {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (na.includes(nb) || nb.includes(na)) return true;
  const ga = grupoDoCriterio(a);
  return ga >= 0 && ga === grupoDoCriterio(b);
}

function limparCriterios(criterios, objetivo) {
  const pedido = normalizar(objetivo);
  const semVago = criterios.filter((k) => {
    const m = CRITERIO_VAGO.exec(normalizar(k.nome));
    if (CRITERIO_META.test(normalizar(k.nome))) return false;
    return !m || pedido.includes(m[1]);
  });
  const base = semVago.length >= 2 ? semVago : criterios;
  const unicos = [];
  for (const k of base) if (!unicos.some((u) => mesmoCriterio(u.nome, k.nome))) unicos.push(k);
  return unicos;
}

/**
 * O que o mapa disse que importa pra cada perfil e o plano não virou
 * critério (11º teste real: o mapa escreveu "jogador profissional de PUBG |
 * qualidade do som e baixa latência", mas o "o que decide" e o plano ficaram
 * em isolamento, conforto e qualidade — latência sumiu de novo). Cada pedaço
 * curto de "importa" que nenhum critério cobre entra com peso médio, até 6.
 */
function completarComPerfis(criterios, mapa, objetivo = '') {
  const saida = [...criterios];
  for (const p of mapa?.perfis || []) {
    for (const pedaco of String(p.importa || '').split(/,|;|\s+e\s+/)) {
      const nome = pedaco.replace(/[."']/g, '').trim();
      const n = normalizar(nome);
      if (n.length < 4 || n.split(' ').length > 4) continue;
      if ((CRITERIO_VAGO.test(n) && !normalizar(objetivo).includes(n)) || CRITERIO_META.test(n)) continue;
      if (saida.some((k) => mesmoCriterio(k.nome, nome))) continue;
      if (saida.length >= 6) return saida;
      saida.push({ nome, peso: 'medio', termos: [nome], doMapa: true });
    }
  }
  return saida;
}

/**
 * Critério que a COMUNIDADE usa pra decidir (12º teste real: nos 18 tópicos
 * do Reddit sobre intra pra PUBG, o assunto era ouvir de onde vêm os passos
 * — "footsteps", "imaging", "soundstage" —, e o plano comparou isolamento,
 * conforto e "qualidade de áudio"). Tabela pequena de ideias (português e
 * inglês); ideia citada em 2+ tópicos da comunidade que nenhum critério
 * cobre entra — peso alto com 3+ tópicos. Critério do plano vindo só do
 * perfil do mapa (`doMapa`) cede a vaga se a lista estiver cheia.
 */
const IDEIAS_DA_COMUNIDADE = [
  { nome: 'posicionamento dos sons', termos: ['posicionamento', 'passos', 'footsteps', 'imaging', 'soundstage', 'palco sonoro', 'direcional'], re: /\b(footsteps?|imaging|soundstage|positional|passos|palco sonoro|posicionamento|direcionalidade|de onde vem)\b/ },
  { nome: 'latência e conexão', termos: ['latência', 'atraso', 'com fio', 'latency', 'wired'], re: /\b(latency|latencia|delay|atraso|wired|com fio|input lag)\b/ },
  { nome: 'microfone', termos: ['microfone', 'mic', 'microphone'], re: /\b(mic|microfone|microphone)\b/ },
  { nome: 'isolamento', termos: ['isolamento', 'vedação', 'isolation'], re: /\b(isolation|isolamento|vedacao|seal)\b/ },
  { nome: 'conforto', termos: ['conforto', 'encaixe', 'comfort', 'fit'], re: /\b(comfort\w*|conforto|confortavel|encaixe)\b/ },
];
function completarComComunidade(criterios, entradas) {
  const topicos = entradas.filter((e) => tipoDeFonte(e.url || '') === 'comunidade' && /^t[oó]pico (do reddit|de f[oó]rum)/i.test(String(e.bruto || '')));
  if (!topicos.length) return criterios;
  const saida = [...criterios];
  for (const ideia of IDEIAS_DA_COMUNIDADE) {
    const urls = new Set(topicos.filter((e) => ideia.re.test(normalizar(e.bruto || ''))).map((e) => e.url));
    if (urls.size < 2 || saida.some((k) => mesmoCriterio(k.nome, ideia.nome) || ideia.termos.some((t) => mesmoCriterio(k.nome, t) || (k.termos || []).some((x) => mesmoCriterio(x, t))))) continue;
    const novo = { nome: ideia.nome, peso: urls.size >= 3 ? 'alto' : 'medio', termos: ideia.termos, daComunidade: urls.size };
    if (saida.length < 6) saida.push(novo);
    else {
      const i = saida.findIndex((k) => k.doMapa);
      if (i >= 0) saida[i] = novo;
    }
  }
  return saida;
}

/* ------------------------------ cadeia do uso (2026-09-28) ------------------------------ */

/**
 * Lê a cadeia do uso (formato de `pedidoDeCadeiaDoUso`): produto, atividade,
 * tipo de uso, o que o uso exige, características técnicas e as buscas de
 * conhecimento. Sem tipo de uso ou com menos de 2 características = null (o
 * motor segue como antes, só com mapa e plano).
 */
function lerCadeiaDoUso(texto) {
  const cadeia = { produto: '', atividade: '', tipoDeUso: '', exige: [], caracteristicas: [], buscas: [] };
  let secao = null;
  for (const bruta of String(texto || '').split('\n')) {
    const linha = bruta.trim().replace(/\*\*/g, '');
    if (!linha) continue;
    const ehItem = /^\s*(?:[-*•]|\d+[.)])\s/.test(linha);
    const campo = !ehItem && /^(produto|atividade|tipo de uso)\s*:\s*(.+)$/i.exec(linha);
    if (campo) {
      const chave = { produto: 'produto', atividade: 'atividade', 'tipo de uso': 'tipoDeUso' }[normalizar(campo[1])];
      if (chave) cadeia[chave] = campo[2].trim().slice(0, 120);
      secao = null;
      continue;
    }
    const cab = normalizar(linha);
    if (!ehItem && linha.length < 45) {
      if (/^o uso exige/.test(cab)) { secao = 'exige'; continue; }
      if (/^caracteristicas tecnicas/.test(cab)) { secao = 'caracteristicas'; continue; }
      if (/^buscas? de conhecimento/.test(cab)) { secao = 'buscas'; continue; }
    }
    if (!secao || !ehItem) continue;
    const [a, b, c] = limparItem(linha).split('|').map((t) => (t || '').trim());
    if (!a || a.length < 3) continue;
    if (secao === 'exige') cadeia.exige.push({ o: a.slice(0, 120), porque: (b || '').slice(0, 160) });
    else if (secao === 'caracteristicas') {
      cadeia.caracteristicas.push({
        nome: a.slice(0, 60),
        atende: (b || '').slice(0, 160),
        termosEn: String(c || '').split(',').map((t) => t.trim()).filter((t) => t.length >= 3).slice(0, 5),
      });
    } else if (secao === 'buscas' && cadeia.buscas.length < 2) cadeia.buscas.push(a.replace(/\b(19|20)\d\d\b/g, '').trim().slice(0, 140));
  }
  cadeia.exige = cadeia.exige.slice(0, 4);
  cadeia.caracteristicas = cadeia.caracteristicas
    .filter((k) => !CRITERIO_VAGO.test(normalizar(k.nome)) && !CRITERIO_META.test(normalizar(k.nome)))
    .slice(0, 6);
  if (!cadeia.tipoDeUso || cadeia.caracteristicas.length < 2) return null;
  if (!cadeia.produto) cadeia.produto = 'produto';
  return cadeia;
}

/** Buscas de conhecimento: as da cadeia (a em inglês sem filtro de idioma), ou montadas. */
function consultasDeConhecimento(cadeia, maximo = 2) {
  // 13º teste real: a busca do modelo saiu genérica ("fones com melhor
  // qualidade sonora e clareza para jogos online") e voltou só loja. A em
  // português agora é sempre a pergunta do raciocínio; a em inglês é a dele.
  const tipoCurto = String(cadeia.tipoDeUso).replace(/\s*\(.*?\)\s*/g, ' ').split(/\s+/).slice(0, 6).join(' ');
  const pt = `o que torna um ${cadeia.produto} bom para ${tipoCurto}`;
  // Etapa E (14º teste real): a busca em inglês do 7B saiu "what makes a good
  // HEADSET for FPS" num pedido de intra — com a categoria no dicionário, o
  // código monta com o termo certo ("IEM")
  const assunto = assuntoDaComunidade(`${cadeia.produto} ${cadeia.tipoDeUso}`, cadeia);
  const usoEn = assunto.fps ? 'competitive FPS' : assunto.jogo ? assunto.jogo.en : assunto.jogando ? 'gaming' : '';
  const en = assunto.categoria && usoEn
    ? `what makes a good ${assunto.categoria.en[0]} for ${usoEn}`
    : cadeia.buscas.find((q) => /\b(what|best|good|for|makes|how)\b/i.test(q) && !/\b(para|como|bom|que)\b/i.test(q));
  const buscas = [pt, en].filter(Boolean);
  const ingles = (q) => /\b(what|best|good|for|makes|the|how)\b/i.test(q) && !/\b(para|como|bom|que)\b/i.test(q);
  return buscas.slice(0, maximo).map((q) => ({ consulta: q, idioma: ingles(q) ? 'all' : 'pt-BR' }));
}

/** Material das páginas de conhecimento pro modelo tirar os critérios (destilado primeiro). */
function materialDeConhecimento(entradas, teto = 7000) {
  // loja não explica o que importa (13º teste real: kabum, mercadolivre e
  // pichau viraram a "fonte" dos critérios)
  const uteis = entradas.filter((e) => !/^\(nada relevante/.test(String(e.texto || '')) && tipoDeFonte(e.url || '') !== 'loja');
  const fatia = Math.max(800, Math.floor(teto / Math.max(1, uteis.length)));
  return uteis
    .map((e) => `[${dominioDe(e)}] ${String(e.destilado && !e.cru ? e.texto : e.bruto || e.texto || '').slice(0, fatia)}`)
    .join('\n\n')
    .slice(0, teto);
}

/** "- palco sonoro | alto | por que importa | termos" → critérios com o porquê. */
function lerCriteriosDoConhecimento(texto) {
  const saida = [];
  for (const bruta of String(texto || '').split('\n')) {
    if (!/^\s*(?:[-*•]|\d+[.)])\s/.test(bruta)) continue;
    const [nome, peso, porque, termos] = limparItem(bruta.replace(/\*\*/g, '')).split('|').map((t) => (t || '').trim());
    const n = normalizar(nome);
    if (!n || n.length < 3 || n.split(' ').length > 6 || CRITERIO_VAGO.test(n) || CRITERIO_META.test(n)) continue;
    if (saida.some((k) => mesmoCriterio(k.nome, nome))) continue;
    const pn = normalizar(peso);
    saida.push({
      nome: nome.slice(0, 50),
      peso: /^alt/.test(pn) ? 'alto' : /^baix/.test(pn) ? 'baixo' : 'medio',
      porque: String(porque || '').slice(0, 200),
      termos: [...new Set([nome, ...String(termos || '').split(',').map((t) => t.trim()).filter((t) => normalizar(t).length >= 3)])].slice(0, 6),
      doConhecimento: true,
    });
  }
  return saida.slice(0, 6);
}

/** Características da cadeia como critérios (quando a busca de conhecimento não rendeu). */
function criteriosDaCadeia(cadeia) {
  return (cadeia?.caracteristicas || []).map((c, i) => ({
    nome: c.nome,
    peso: i < 3 ? 'alto' : 'medio',
    porque: c.atende,
    termos: [...new Set([c.nome, ...c.termosEn])].slice(0, 6),
    daCadeia: true,
  }));
}

/**
 * Critérios finais: os que vieram do raciocínio + conhecimento lido vêm
 * primeiro (até 5); do plano do modelo só entra preço/custo que faltar.
 * 12º teste real: sem isso, o plano pôs "design compacto" com peso alto.
 * Com menos de 3 da base, fica o plano de sempre (nada piora).
 */
function combinarCriterios(base, doPlano) {
  if ((base || []).length < 3) return doPlano;
  const saida = [];
  // perfil curado (Etapa E): os critérios já foram pensados separados
  // ("passos e posicionamento" e "palco sonoro" caíam no mesmo grupo de
  // sinônimo e o palco sumia) — entram os 6 primeiros, sem dedupe por sinônimo
  const doPerfil = base.every((k) => k.doPerfil);
  const teto = doPerfil ? 6 : 5;
  for (const k of base) if ((doPerfil ? !saida.some((x) => x.nome === k.nome) : !saida.some((x) => mesmoCriterio(x.nome, k.nome))) && saida.length < teto) saida.push(k);
  const preco = doPlano.find((k) => grupoDoCriterio(k.nome) === SINONIMOS.findIndex((g) => g.includes('preco')));
  if (preco && !saida.some((x) => mesmoCriterio(x.nome, preco.nome))) saida.push(preco);
  return saida.slice(0, teto + 1);
}

/**
 * Critério que o PEDIDO não sustenta (Etapa E, 14º teste real): "Cabo
 * over-ear firmes" num pedido de intra; "Microfone integrado com
 * cancelamento de ruído" e "Baixa latência" num pedido de IEM com fio pra
 * PUBG, que não falou de microfone nem de sem fio. Critério de perfil curado
 * fica sempre (o perfil já foi pensado pro uso). Devolve { criterios, fora }.
 */
const CRITERIO_DE_OUTRA_CATEGORIA = /\b(over ?ear|headset|circumaural|almofada\w*|headband|arco|concha|open back|supra ?auricular)\b/;
const PEDIDO_FALA_DE_MICROFONE = /\b(microfone|mic|comunica\w*|call|calls|voz|chat|discord|stream\w*|live)\b/;
const PEDIDO_FALA_DE_SEM_FIO = /\b(sem fio|bluetooth|wireless|tws|latencia|atraso|delay|2 4 ?ghz|dongle)\b/;
function filtrarCriteriosDoPedido(criterios, objetivo, { perfil = null } = {}) {
  const pedido = normalizar(objetivo);
  const categoria = categoriaDoPedido(objetivo);
  const intra = Boolean(categoria?.exclui);
  const fora = [];
  const saida = criterios.filter((k) => {
    if (k.doPerfil || grupoDoCriterio(k.nome) === SINONIMOS.findIndex((g) => g.includes('preco'))) return true;
    const n = normalizar(`${k.nome} ${(k.termos || []).slice(0, 3).join(' ')}`);
    let motivo = '';
    if (intra && CRITERIO_DE_OUTRA_CATEGORIA.test(normalizar(k.nome))) motivo = 'é de outro tipo de fone (headset/over-ear)';
    else if (/\b(microfone|mic|microphone)\b/.test(n) && !PEDIDO_FALA_DE_MICROFONE.test(pedido)) motivo = 'o pedido não fala de microfone';
    // latência: só quando um perfil curado cobre o pedido (ele já sabe se
    // atraso importa); sem perfil, a dedução "com fio = sem atraso" continua
    else if (perfil && /\b(latencia|atraso|delay|latency)\b/.test(n) && !PEDIDO_FALA_DE_SEM_FIO.test(pedido) && !/\b(earbuds?|tws)\b/.test(pedido)) motivo = 'o pedido não fala de sem fio (fone com fio não tem atraso de transmissão)';
    if (motivo) fora.push({ nome: k.nome, motivo });
    return !motivo;
  });
  // nunca deixa a pesquisa sem critério
  return saida.length >= 2 ? { criterios: saida, fora } : { criterios, fora: [] };
}

/**
 * Peso de cada critério conferido na COMUNIDADE (13º teste real: o plano
 * pôs "microfone claro" com peso alto; nos tópicos de intra pra FPS o assunto
 * era ouvir os passos). Critério discutido em 3+ tópicos sobe pra alto;
 * critério de peso alto que nenhum tópico discute (com 4+ tópicos lidos)
 * desce pra médio — preço nunca desce. Ordem: peso, depois tópicos.
 */
function pesarCriteriosPelaComunidade(criterios, entradas) {
  const topicos = entradas.filter((e) => tipoDeFonte(e.url || '') === 'comunidade' && /^t[oó]pico (do reddit|de f[oó]rum)/i.test(String(e.bruto || '')));
  if (!topicos.length) return criterios;
  const precoIdx = SINONIMOS.findIndex((g) => g.includes('preco'));
  const saida = criterios.map((k, ordem) => {
    const alvo = { termos: (k.termos && k.termos.length ? k.termos : [k.nome]) };
    const n = topicos.filter((e) => citaCriterio(normalizar(e.bruto || ''), alvo)).length;
    let peso = k.peso;
    if (n >= 3) peso = 'alto';
    else if (n === 0 && topicos.length >= 4 && peso === 'alto' && grupoDoCriterio(k.nome) !== precoIdx) peso = 'medio';
    return { ...k, peso, discutidoEm: n, ordem };
  });
  return saida.sort((a, b) => PESOS[b.peso] - PESOS[a.peso] || b.discutidoEm - a.discutidoEm || a.ordem - b.ordem);
}

// veredito do juiz que diz que a opção vai MAL no critério
// ("sem atraso", "sem chiado" são elogio — "sem" sozinho não conta)
const VEREDITO_NEGATIVO = /\b(ruim|fraco|fraca|pessim\w*|cansativ\w*|exagerad\w*|limitad\w*|mediocre|abafad\w*|nao tem|nao possui|ausencia|poor|bad|weak|lacks?)\b/;

/**
 * Ordem final pela EVIDÊNCIA, não pela contagem (Davi, 2026-09-28): cada
 * critério com veredito positivo soma o peso dele (alto 2, médio 1, baixo
 * 0,5), negativo tira metade; soma-se o consenso (comunidade que recomenda
 * pro uso). A primeira desta ordem é a que o redator recomenda.
 */
/**
 * Status de cada célula opção × critério (Etapa E, revisão v2 — sugestão da
 * análise do ChatGPT): corroborado (2+ fontes independentes a favor), fonte
 * única, contraditório (veredito negativo ou a favor e contra), indireto
 * (deduzido, ex.: fone com fio → sem atraso) ou sem dados. Substitui o "4 de
 * 4 critérios a favor" que tratava uma fonte igual a cinco (14º teste real).
 */
function statusDaCelula(c) {
  if (!c || !c.dominios?.size) return STATUS.SEM_DADOS;
  if (c.deduzido) return STATUS.INDIRETO;
  const negativo = VEREDITO_NEGATIVO.test(normalizar(c.veredito || ''));
  const fontes = c.fontes?.size ? [...c.fontes] : [...c.dominios];
  return Evidencias.status(negativo ? { contra: fontes } : { aFavor: fontes });
}

const VALOR_DO_STATUS = { [STATUS.CORROBORADO]: 1, [STATUS.FONTE_UNICA]: 0.6, [STATUS.INDIRETO]: 0.5, [STATUS.CONTRADITORIO]: -0.5, [STATUS.SEM_DADOS]: 0, [STATUS.NAO_SE_APLICA]: 0 };

function ordenarPorEvidencia(finalistas, matriz, criterios) {
  return finalistas
    .map((f, i) => {
      let evidencia = 0;
      let positivosAltos = 0;
      const status = {};
      for (const k of criterios) {
        const c = matriz.celula(f.nome, k.nome);
        const st = statusDaCelula(c);
        status[k.nome] = st;
        if (c) c.status = st;
        evidencia += (VALOR_DO_STATUS[st] || 0) * PESOS[k.peso];
        if (k.peso === 'alto' && VALOR_DO_STATUS[st] > 0) positivosAltos += 1;
      }
      const nota = Math.round(((f.consenso?.pontos || 0) + evidencia) * 10) / 10;
      return { ...f, notaFinal: nota, evidencia: Math.round(evidencia * 10) / 10, positivosAltos, status, ordemAntes: i };
    })
    .sort((a, b) => b.notaFinal - a.notaFinal || a.ordemAntes - b.ordemAntes);
}

/**
 * Comparação de produtos NOMEADOS ("qual a diferença de desempenho entre a
 * RTX 5070 Ti e a RTX 5080?", "A ou B?", "A vs B"). 13º teste real: esse
 * pedido não entrava no motor e o caminho genérico só achou PassMark.
 */
function produtosDaComparacao(objetivo) {
  const t = normalizar(objetivo);
  if (!/\b(diferen\w*|versus|vs|compar\w*|ou|melhor)\b/.test(t)) return [];
  const nomes = produtosDoPedido(objetivo).map((p) => p.nome);
  return nomes.length >= 2 ? nomes.slice(0, 4) : [];
}

/**
 * Lê o texto do plano (formato de `pedidoDePlanoDePesquisa`). Tolera
 * cabeçalho sem acento, em minúscula, com ou sem dois-pontos, e item com
 * "-", "*" ou número. Devolve null quando não há o mínimo pra pesquisar com
 * método (2 critérios) — aí o agente segue o caminho de sempre.
 */
/**
 * Preposição que sobrou no fim da busca depois de tirar o ano (14º teste
 * real: "10 melhores fones para jogar PUBG no PC em").
 */
function semPreposicaoPendurada(texto) {
  return String(texto || '').replace(/(\s+\b(em|no|na|de|do|da|para|pra|com|in|of|for|on|the|e|ou|and|or)\b)+[\s.,;:-]*$/i, '').trim();
}

function lerPlanoDePesquisa(texto, objetivo = '') {
  const plano = { uso: '', criterios: [], opcoesCitadas: [], descoberta: [], buscaIngles: '', comunidade: [] };
  let secao = null;
  for (const bruta of String(texto || '').split('\n')) {
    const linha = bruta.trim();
    if (!linha) continue;
    const cab = normalizar(linha);
    // cabeçalho só vale em linha que não é item ("- buscas de fones..." é item)
    const ehItem = /^\s*(?:[-*•]|\d+[.)])\s/.test(linha);
    const uso = !ehItem && /^uso\s*:\s*(.+)$/i.exec(linha);
    if (uso) {
      plano.uso = uso[1].trim();
      secao = null;
      continue;
    }
    if (!ehItem && /^criterios?\b/.test(cab) && linha.length < 40) { secao = 'criterios'; continue; }
    if (!ehItem && /^opcoes?\s+citadas?/.test(cab)) { secao = 'opcoes'; continue; }
    // antes do "buscas" genérico: "BUSCA EM INGLÊS" e "BUSCAS NA COMUNIDADE" também começam com "busca"
    if (!ehItem && /^buscas?\s+em\s+ingles\b/.test(cab) && linha.length < 40) { secao = 'ingles'; continue; }
    if (!ehItem && /^buscas?\s+na\s+comunidade\b/.test(cab) && linha.length < 40) { secao = 'comunidade'; continue; }
    if (!ehItem && /^buscas?\b/.test(cab) && linha.length < 40) { secao = 'descoberta'; continue; }
    if (!secao) continue;

    const item = limparItem(linha);
    if (!item) continue;
    if (secao === 'criterios') {
      const [nome, peso, termos] = item.split('|').map((p) => (p || '').trim());
      if (!nome) continue;
      const pesoNorm = normalizar(peso);
      const pesoFinal = /^alt/.test(pesoNorm) ? 'alto' : /^baix/.test(pesoNorm) ? 'baixo' : 'medio';
      const lista = [nome, ...String(termos || '').split(',')]
        .map((t) => t.trim())
        .filter((t) => normalizar(t).length >= 3);
      const unicos = [...new Map(lista.map((t) => [normalizar(t), t])).values()].slice(0, 6);
      plano.criterios.push({ nome, peso: pesoFinal, termos: unicos });
    } else if (secao === 'opcoes') {
      if (/^(nenhum|nenhuma|nao|n\/a|-)/.test(normalizar(item)) || normalizar(item) === 'nenhuma') continue;
      // revisão v4: o 7B escreveu "Simgot EM6L, Simgot SuperMix 4" numa linha só
      // e o código contou UMA opção — cada nome com maiúscula/dígito vira uma
      const limpo = item.replace(/\s*[—–(:].*$/, '').trim();
      const partes = limpo.split(/\s*,\s*|\s+e\s+|\s+ou\s+|\s+vs\.?\s+/i).map((x) => x.trim()).filter(Boolean);
      if (partes.length >= 2 && partes.every((x) => /[A-Z0-9]/.test(x) && x.length >= 3)) plano.opcoesCitadas.push(...partes);
      else plano.opcoesCitadas.push(limpo);
    } else if (secao === 'descoberta') {
      // 7º teste real (2026-09-25): o 7B escreveu "melhor fone de ouvido para
      // PUBG PC 2023" — o ano que ele acha que é, não o de hoje. Ano na busca
      // só fica se veio do próprio pedido; sem ano, o buscador já prioriza o recente.
      const item2 = semPreposicaoPendurada(item.replace(/\b(19|20)\d\d\b/g, (ano) => (String(objetivo).includes(ano) ? ano : '')).replace(/\s+/g, ' ').trim());
      if (item2) plano.descoberta.push(item2);
    } else if (secao === 'comunidade') {
      // 14/10: buscas da comunidade escritas pelo modelo (antes: só moldes do
      // código, como "best IEM for recommendation"); sem ano, sem "reddit"/"site:"
      const q = semPreposicaoPendurada(item.replace(/\bsite:\S+/gi, '').replace(/\b(reddit|f[óo]rum)\b/gi, '').replace(/\b(19|20)\d\d\b/g, (ano) => (String(objetivo).includes(ano) ? ano : '')).replace(/["“”]/g, '').replace(/\s+/g, ' ').trim());
      if (q.length >= 8 && q.length <= 90) plano.comunidade.push(q);
    } else if (secao === 'ingles' && !plano.buscaIngles) {
      // Fase C: assunto em inglês pro Reddit/Head-Fi — sem ano e sem o "reddit" (o site: já diz onde)
      plano.buscaIngles = semPreposicaoPendurada(item.replace(/\b(19|20)\d\d\b/g, '').replace(/\breddit\b/gi, '').replace(/\s+/g, ' ').trim().slice(0, 120));
    }
  }

  plano.criterios = limparCriterios(plano.criterios, objetivo).slice(0, 6);
  plano.uso = semRecursoPendurado(semCondicaoInventada(plano.uso, objetivo), objetivo);
  plano.descoberta = plano.descoberta.map((d) => semRecursoPendurado(semCondicaoInventada(d, objetivo, { soPalavras: true }), objetivo)).filter(Boolean);
  plano.buscaIngles = semRecursoPendurado(semCondicaoInventada(plano.buscaIngles, objetivo, { soPalavras: true }), objetivo);
  plano.opcoesCitadas = [...new Set(plano.opcoesCitadas.filter(Boolean))].slice(0, 6);
  plano.descoberta = [...new Map(plano.descoberta.map((d) => [normalizar(d), d])).values()].slice(0, 3);
  plano.comunidade = [...new Map(plano.comunidade.map((d) => [normalizar(d), d])).values()].slice(0, 4);
  if (plano.criterios.length < 2) return null;
  if (!plano.uso) plano.uso = String(objetivo).slice(0, 200);
  // sem busca de descoberta legível: o próprio pedido serve de primeira busca
  if (!plano.descoberta.length && plano.opcoesCitadas.length < 2) plano.descoberta = [String(objetivo).slice(0, 200)];
  return plano;
}

/* ------------------------------ 0. mapa do problema ------------------------------ */

/**
 * Lê o mapa do problema (formato de `pedidoDeMapaDoProblema`, Fase B da
 * pesquisa pela comunidade, 2026-09-26). Mesma tolerância do plano:
 * cabeçalho sem acento/maiúscula, item com "-", "*" ou número, "|" opcional.
 * Devolve null quando não há o mínimo pra servir (2 fatores ou 2 hipóteses):
 * aí o motor segue como antes, só com o plano.
 */
function lerMapaDoProblema(texto) {
  const mapa = { perfis: [], decide: [], elimina: [], alternativas: [], armadilhas: [], hipoteses: [] };
  const SECOES = [
    [/^perfis?\b/, 'perfis'],
    [/^o que decide\b|^fatores?\b/, 'decide'],
    [/^elimina\b|^eliminatori/, 'elimina'],
    [/^alternativas?\b/, 'alternativas'],
    [/^armadilhas?\b/, 'armadilhas'],
    [/^hipoteses?\b/, 'hipoteses'],
  ];
  let secao = null;
  for (const bruta of String(texto || '').split('\n')) {
    const linha = bruta.trim();
    if (!linha) continue;
    const ehItem = /^\s*(?:[-*•]|\d+[.)])\s/.test(linha);
    const cab = normalizar(linha);
    const achada = !ehItem && linha.length < 40 ? SECOES.find(([re]) => re.test(cab)) : null;
    if (achada) {
      secao = achada[1];
      continue;
    }
    if (!secao || !ehItem) continue;
    const item = limparItem(linha).replace(/\*\*/g, '');
    const [a, b] = item.split('|').map((t) => (t || '').trim());
    if (!a || a.length < 3) continue;
    if (secao === 'perfis') mapa.perfis.push({ perfil: a, importa: b || '' });
    else if (secao === 'decide') mapa.decide.push({ fator: a, porque: b || '' });
    else if (secao === 'elimina') mapa.elimina.push({ fator: a, porque: b || '' });
    else if (secao === 'alternativas') mapa.alternativas.push({ nome: a, quando: b || '' });
    else mapa[secao].push(a.slice(0, 200));
  }
  mapa.perfis = mapa.perfis.slice(0, 3);
  mapa.decide = mapa.decide.slice(0, 5);
  mapa.elimina = mapa.elimina.slice(0, 2);
  mapa.alternativas = mapa.alternativas.slice(0, 3);
  mapa.armadilhas = mapa.armadilhas.slice(0, 4);
  mapa.hipoteses = [...new Map(mapa.hipoteses.map((h) => [normalizar(h), h])).values()].slice(0, 5);
  if (mapa.decide.length < 2 && mapa.hipoteses.length < 2) return null;
  return mapa;
}

// palavras que não ajudam a achar trecho sobre uma hipótese
const PALAVRA_VAZIA = new Set(normalizar(
  'para como mais menos que com sem uma umas uns dos das pelo pela pelos pelas quem sobre entre muito muita pouco pouca ' +
  'melhor melhores pior piores geral tipo tipos modelo modelos produto produtos opcao opcoes qualquer maioria serve servem ' +
  'costuma costumam pode podem ter tem sao esta estao isso esse essa este esta quando onde mesmo mesma tambem ainda'
).split(' '));

/**
 * Trechos do material que falam de uma hipótese: frases com 2+ palavras
 * dela (radical, pra pegar plural e gênero), da comunidade primeiro. Sem
 * trecho, a hipótese fica "sem dados" sem gastar chamada.
 */
function trechosParaHipotese(hipotese, entradas, maximo = 3) {
  const termos = [...new Set(normalizar(hipotese).split(' ').filter((t) => t.length >= 4 && !PALAVRA_VAZIA.has(t)))];
  if (termos.length < 2) return [];
  const radical = (t) => (t.length > 5 ? t.slice(0, t.length - 2) : t);
  const achados = [];
  const vistos = new Set();
  for (const e of entradas) {
    for (const fr of frases(e.bruto || e.texto)) {
      const n = normalizar(fr);
      if (vistos.has(n) || FRASE_DE_LOJA.test(n) || fr.length > 400) continue;
      const pontos = termos.filter((t) => n.includes(radical(t))).length;
      if (pontos < 2) continue;
      vistos.add(n);
      achados.push({ texto: fr.slice(0, 240), dominio: dominioDe(e), pontos, comunidade: e.tipoBusca === 'comunidade' });
    }
  }
  return achados
    .sort((a, b) => b.pontos - a.pontos || Number(b.comunidade) - Number(a.comunidade))
    .slice(0, maximo)
    .map(({ texto, dominio }) => ({ texto, dominio }));
}

/** "H2: derrubada — Bluetooth dos testes tinha 150 ms (3)" → veredito por hipótese (índice 0-based). */
/**
 * Veredito que contradiz o próprio motivo (11º teste real): "fones com baixa
 * latência são cruciais para jogos competitivos" saiu DERRUBADA com o motivo
 * "conexões de baixa latência são cruciais" — o trecho repete a hipótese, sem
 * negar nada. Regra: motivo que divide 3+ palavras de conteúdo com a
 * hipótese e tem a MESMA polaridade (os dois afirmam ou os dois negam)
 * confirma; com polaridade oposta, derruba.
 */
const NEGACAO = /\b(nao|nem|nunca|jamais|pouco|pouca|menos|mito|falso|exagero|not|no|never|isn t|doesn t|don t|aren t|myth|overrated)\b/;
// motivo que diz que o material NÃO trata do assunto (14º teste real:
// "derrubada — materiais sugerem preferência por ANC mas não afirmam maioria")
const MOTIVO_SEM_DADOS =
  /\b(nao (afirma\w*|mostra\w*|confirma\w*|menciona\w*|cita\w*|trata\w*|fala\w*|comprova\w*|diz\w*|traz\w*|ha dados|tem dados)|nenhum (dado|trecho)|sem (informac\w*|evidenc\w*|dados)|insuficiente\w*|does not (say|mention|show|state)|no (data|evidence))\b/;
function coerenteComMotivo(hipotese, tipo, motivo) {
  if (tipo === 'sem dados' || !motivo) return tipo;
  if (MOTIVO_SEM_DADOS.test(normalizar(motivo))) return 'sem dados';
  const h = normalizar(hipotese);
  const mv = normalizar(motivo);
  const conteudo = (t) => new Set(t.split(' ').filter((p) => p.length >= 4 && !PALAVRA_VAZIA.has(p)));
  const ph = conteudo(h);
  const pm = conteudo(mv);
  const comuns = [...ph].filter((p) => pm.has(p) || [...pm].some((q) => q.length >= 5 && p.length >= 5 && q.slice(0, 5) === p.slice(0, 5)));
  if (comuns.length < 3) return tipo;
  const mesmaPolaridade = NEGACAO.test(h) === NEGACAO.test(mv);
  return mesmaPolaridade ? 'confirmada' : 'derrubada';
}

function lerAvaliacaoDeHipoteses(texto, total, numeracao) {
  const saida = new Map();
  for (const bruta of String(texto || '').split('\n')) {
    const linha = limparItem(bruta.replace(/\*+/g, ''));
    const m = /^h\s*(\d+)\s*[:.)-]\s*(confirmad\w*|derrubad\w*|refutad\w*|sem dados|n[aã]o (?:h[aá]|tem) dados)\s*[—–:-]*\s*(.*)$/i.exec(linha);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (i < 0 || i >= total || saida.has(i)) continue;
    const tipo = /^confirm/i.test(m[2]) ? 'confirmada' : /^(derrub|refut)/i.test(m[2]) ? 'derrubada' : 'sem dados';
    let motivo = m[3].trim();
    const refs = [...motivo.matchAll(/\((\d+)(?:\s*,\s*(\d+))*\)/g)].flatMap((r) => r.slice(1).filter(Boolean).map(Number));
    // número de trecho de OUTRA hipótese: o modelo misturou — vale como sem dados
    if (tipo !== 'sem dados' && refs.some((r) => numeracao.get(r) !== i)) {
      saida.set(i, { tipo: 'sem dados', motivo: '' });
      continue;
    }
    motivo = motivo.replace(/\s*\((\d+\s*,?\s*)+\)\s*/g, ' ').trim().slice(0, 160);
    if (tipo !== 'sem dados' && (vereditoSemSentido(motivo) || !motivo)) {
      saida.set(i, { tipo: 'sem dados', motivo: '' });
      continue;
    }
    saida.set(i, { tipo, motivo: tipo === 'sem dados' ? '' : motivo, refs });
  }
  return saida;
}

/**
 * Confere as hipóteses do mapa no material coletado: uma chamada só, com os
 * trechos escolhidos pelo código. Hipótese sem trecho nem vai pro modelo.
 */
async function avaliarHipoteses({ mapa, uso, entradas, chamarModelo }) {
  const lista = (mapa?.hipoteses || []).map((texto) => ({ texto, trechos: trechosParaHipotese(texto, entradas) }));
  if (!lista.length) return [];
  const resultado = lista.map((h) => ({ hipotese: h.texto, veredito: 'sem dados', motivo: '', fontes: [] }));
  if (!lista.some((h) => h.trechos.length)) return resultado;
  const numeracao = new Map();
  let n = 0;
  lista.forEach((h, i) => h.trechos.forEach(() => numeracao.set((n += 1), i)));
  const resposta = await chamarModelo(prompts.pedidoDeHipoteses({ uso, hipoteses: lista }), { tipo: 'hipoteses', numPredict: 300 });
  const lidas = lerAvaliacaoDeHipoteses(resposta, lista.length, numeracao);
  for (const [i, v] of lidas) {
    v.tipo = coerenteComMotivo(lista[i].texto, v.tipo, v.motivo);
    if (v.tipo === 'sem dados' || !lista[i].trechos.length) continue;
    const doTrecho = [...numeracao.entries()].filter(([, dono]) => dono === i).map(([num]) => num);
    const usados = v.refs?.length ? v.refs : doTrecho;
    const primeiro = Math.min(...doTrecho);
    resultado[i] = {
      hipotese: lista[i].texto,
      veredito: v.tipo,
      motivo: v.motivo,
      fontes: [...new Set(usados.map((r) => lista[i].trechos[r - primeiro]?.dominio).filter(Boolean))],
    };
  }
  return resultado;
}

/* ------------------------------ 2. candidatos ------------------------------ */

function lerCandidatos(texto, maximo = 8) {
  if (/^\s*nenhum/i.test(String(texto || ''))) return [];
  const nomes = [];
  for (const linha of String(texto || '').split('\n')) {
    if (/^\W*importa\s*:/i.test(linha)) continue; // linha de critérios, não de opção
    let nome = limparItem(linha)
      .replace(/\*\*/g, '')
      .replace(/\s+[—–-]\s+.*$/, '')
      .replace(/\s*[:(].*$/, '')
      // "Thrutear Zero Red + DAC Fosi K5" (13º teste real): o acessório não é o produto
      .replace(/\s+(?:\+|com|with|&)\s+.*$/i, '')
      .trim();
    if (nome.length < 2 || nome.length > 60) continue;
    if (/^(nenhum|nenhuma)$/i.test(nome)) continue;
    nomes.push(nome);
  }
  return [...new Map(nomes.map((n) => [normalizar(n), n])).values()].slice(0, maximo);
}

const NUMERO_POR_EXTENSO = { quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

// "N <coisa>" que NÃO é lista de opções: "jogo há 10 anos", "orçamento de 5
// mil", "8 GB", "6 horas por dia"
const UNIDADE_NAO_LISTA =
  /^(anos?|mes(es)?|dias?|horas?|h|minutos?|min|segundos?|semanas?|mil|reais|real|r|dolares|euros|vezes|pessoas|jogadores|amigos|gb|tb|mb|ghz|mhz|hz|fps|w|watts|polegadas|pol|metros|m|cm|mm|kg|g|anos de|nucleos|cores|threads|bits?|partidas|kills|horas de)$/;

/**
 * "top 10", "os 10 melhores", "dez melhores" (8º teste real): o usuário quer
 * uma LISTA de N. Devolve N (4 a 10) ou 0. A comparação a fundo continua nos
 * finalistas do orçamento; o resto da lista sai dos nomes que o material
 * cita, sem inventar nome pra completar.
 *
 * Revisão v3 (chats de 29/09): "os 10 **melhor** fones" (singular, erro de
 * digitação comum) devolvia 0 e a lista de 10 nunca era montada — vieram 5.
 * Agora vale "melhor" no singular e "N <substantivo>" ("10 fones", "dez
 * placas"), menos quando o substantivo é unidade ("10 anos", "8 GB").
 */
function quantidadePedida(objetivo) {
  const t = normalizar(objetivo);
  const N = '(\\d{1,2}|quatro|cinco|seis|sete|oito|nove|dez)';
  let m =
    new RegExp(`\\btop\\s*${N}\\b`).exec(t) ||
    new RegExp(`\\b${N}\\s+(?:melhor|melhores|opcoes|opcao|modelos|produtos|sugestoes|indicacoes|alternativas)\\b`).exec(t);
  if (!m) {
    // "N <coisa>": só quando a coisa é produto ou item de catálogo (achado do
    // revisor: "os 5 sentidos", "os 7 pecados capitais" viravam lista de N)
    const x = new RegExp(`\\b${N}\\s+([a-z]+(?:\\s+[a-z]+)?)`).exec(t);
    if (x && !/\bque\b/.test(x[2]) && !UNIDADE_NAO_LISTA.test(x[2].split(" ")[0]) && (OBJETO_PRODUTO.test(x[2]) || OBJETO_DE_CATALOGO.test(x[2]))) m = x;
  }
  if (!m) return 0;
  const n = NUMERO_POR_EXTENSO[m[1]] || Number(m[1]);
  return n >= 4 ? Math.min(n, 10) : 0;
}

/**
 * Descoberta na comunidade (Fase A da pesquisa pela comunidade, 2026-09-26):
 * uma busca "site:" por fonte (Reddit, Clube do Hardware, Fórum Adrenaline,
 * Head-Fi quando o assunto é áudio…), com o assunto da 1ª busca do plano
 * sem o "top N". Antes era uma busca só, "<assunto> reddit", em pt-BR.
 */
function consultasDeDescobertaNaComunidade(plano, { config = {}, maximo = 2 } = {}) {
  const base = (plano.descoberta[0] || plano.uso).replace(/\btop\s*\d+\s*/i, '').trim();
  // Reddit/Head-Fi com o assunto em inglês que o plano deu (Fase C)
  return consultasNaComunidade(base, { config, maximo, emIngles: plano.buscaIngles });
}

/** Tokens que identificam o nome (curtos demais, tipo "x", não ajudam). */
function tokensDoNome(nome) {
  return normalizar(nome).split(' ').filter((t) => t.length >= 2 || /\d/.test(t));
}

/**
 * O trecho cita esta opção? Nome inteiro (sem acento/pontuação) ou, quando o
 * site escreve diferente ("Chu 2" / "CHU-2"), todos os tokens do nome no
 * mesmo trecho.
 */
function mencionaNome(trechoNormalizado, nome) {
  const alvo = normalizar(nome);
  if (!alvo) return false;
  if (` ${trechoNormalizado} `.includes(` ${alvo} `)) return true;
  const tokens = tokensDoNome(nome);
  if (tokens.length < 2) return false;
  const palavras = new Set(trechoNormalizado.split(' '));
  if (tokens.every((t) => palavras.has(t))) return true;
  // 13/10: modelo escrito colado ou separado ("QC20" / "QC 20", "Z1Ultra")
  const colado = alvo.replace(/ /g, '');
  return /\d/.test(colado) && colado.length >= 6 && trechoNormalizado.replace(/ /g, '').includes(colado);
}

const PEDE_OUTRAS_OPCOES = /\b(alternativ|parecid|similar|substitu|concorrent|melhor(es)? (do )?que|em vez d|no lugar d)/;
/**
 * O plano do modelo citou UMA opção e ela é um produto escrito no pedido? Então
 * o pedido é sobre aquele produto (avaliar, descrever), não sobre a categoria.
 * ponytail: nome sem dígito precisa de 2+ palavras e nenhuma de categoria
 * ("fone gamer" não passa; marca sozinha, "Razer", também não).
 */
function produtoUnicoDoPedido(objetivo, opcoes) {
  if (!Array.isArray(opcoes) || opcoes.length !== 1) return false;
  const pedido = normalizar(objetivo);
  const nome = normalizar(opcoes[0]);
  if (PEDE_OUTRAS_OPCOES.test(pedido) || !mencionaNome(pedido, opcoes[0])) return false;
  return /\d/.test(nome) ? nome.length >= 3 : nome.split(' ').length >= 2 && !OBJETO_PRODUTO.test(nome);
}

function dominioDe(entrada) {
  try {
    return new URL(entrada.url).hostname.replace(/^www\./, '');
  } catch {
    return String(entrada.origem || 'fonte');
  }
}

const textoDaEntrada = (e) => `${e.texto || ''}\n${e.bruto || ''}`;

/**
 * Confere os nomes que o modelo listou contra o material de verdade: nome
 * que não aparece em nenhuma leitura é descartado (o modelo inventou ou
 * lembrou de fora); o resto é ordenado por quantos sites diferentes o citam.
 * Nome que é só palavra do próprio pedido ("PUBG", "fone") não é opção.
 */
function validarCandidatos(nomes, entradas, { objetivo = '' } = {}) {
  const pedido = ` ${normalizar(objetivo)} `;
  // Etapa B (14º teste real): tópico de comunidade conta por TÓPICO, não por
  // domínio — 4 tópicos do Reddit são 4 conversas, não "1 site"
  const chaveDeFonte = (e) => (tipoDeFonte(e.url || '') === 'comunidade' || e.tipoBusca === 'comunidade' ? String(e.url || dominioDe(e)).replace(/[#?].*$/, '') : dominioDe(e));
  const normalizadas = entradas.map((e) => ({ e, texto: normalizar(textoDaEntrada(e)), dominio: dominioDe(e), fonte: chaveDeFonte(e) }));
  const validos = [];
  for (const nome of nomes) {
    const alvo = normalizar(nome);
    if (!alvo || pedido.includes(` ${alvo} `)) continue;
    const dominios = new Set();
    const fontes = new Set();
    let mencoes = 0;
    for (const { texto, dominio, fonte } of normalizadas) {
      if (mencionaNome(texto, nome)) {
        dominios.add(dominio);
        fontes.add(fonte);
        mencoes += 1;
      }
    }
    if (dominios.size) validos.push({ nome, dominios: [...dominios], fontes: fontes.size, mencoes });
  }
  return validos.sort((a, b) => b.fontes - a.fontes || b.dominios.length - a.dominios.length || b.mencoes - a.mencoes);
}

/**
 * Mesmo produto com dois nomes (9º teste real, 2026-09-25): "JBL Quantum 50"
 * e "JBL Quantum 50 4" viraram DOIS finalistas; "ENERGY 10EWG" e "JBL
 * Quantum 50 Intra-auricular" foram pra lista do top 10 ao lado de "WAAW
 * Energy 10EWG" e "JBL Quantum 50". Quando os tokens de um nome estão todos
 * no outro, é o mesmo produto — a não ser que a diferença seja só número
 * ("KZ ZSN Pro" × "KZ ZSN Pro 2" são modelos diferentes). Fica o curto
 * quando a sobra é palavra de categoria ou número solto, ou o longo quando
 * a sobra é marca ("WAAW").
 */
function juntarVariantes(validos) {
  // palavra de categoria não conta na comparação (12º teste real: "EDX Pro
  // Intra-auricular" e "KZ EDX Pro" ficaram separados por causa do "intra")
  const toks = (c) => {
    const t = tokensDoNome(c.nome);
    const semGenerico = t.filter((x) => !GENERICO.has(x));
    return semGenerico.length ? semGenerico : t;
  };
  const contido = (a, b) => a.every((t) => b.includes(t));
  const saida = [];
  for (const c of validos) {
    const tc = toks(c);
    const i = saida.findIndex((o) => {
      const to = toks(o);
      if (!contido(tc, to) && !contido(to, tc)) return false;
      const [curto, longo] = tc.length <= to.length ? [tc, to] : [to, tc];
      const sobra = longo.filter((t) => !curto.includes(t));
      // sobra só de número = outro modelo ("Pro" × "Pro 2"), a não ser que o
      // nome curto já termine no número do modelo ("Quantum 50" × "Quantum 50 4")
      return !sobra.length || !sobra.every((t) => /^\d+$/.test(t)) || /\d/.test(curto[curto.length - 1] || '');
    });
    if (i < 0) {
      saida.push(c);
      continue;
    }
    const o = saida[i];
    // quem fica decide pelos tokens completos (com as palavras de categoria)
    const brutos = (x) => tokensDoNome(x.nome);
    const [curto, longo] = brutos(c).length <= brutos(o).length ? [c, o] : [o, c];
    const sobra = brutos(longo).filter((t) => !brutos(curto).includes(t));
    // sobra de categoria ou número solto ("Intra-auricular", "4") → o curto; sobra de marca ("WAAW") → o longo
    const fica = sobra.every((t) => GENERICO.has(t) || /^\d+$/.test(t)) ? curto : longo;
    saida[i] = {
      ...fica,
      dominios: [...new Set([...o.dominios, ...c.dominios])],
      mencoes: Math.max(o.mencoes || 0, c.mencoes || 0),
    };
  }
  return saida;
}

/* ---------------- consenso (Fase C da pesquisa pela comunidade) ---------------- */

// elogio/crítica numa frase que cita o produto (português e inglês — o Reddit mistura)
const ELOGIO =
  /\b(recomendo|recomendamos|recomendad[oa]s?|otim[oa]s?|excelentes?|muito bo[am]|vale a pena|custo beneficio|adoro|gostei|curti|love|great|excellent|recommend(ed)?|best|amazing|solid|fantastic)\b/;
const CRITICA =
  /\b(nao recomendo|evite|evitem|ruim|pessim[oa]|quebrou|quebra facil|decepcion\w*|horrivel|nao vale|defeito|chiado|avoid|terrible|bad|broke|awful|disappoint\w*|trash|garbage)\b/;

// "vai de", "pega o", "go for" — indicação direta, mesmo sem adjetivo
const RECOMENDA =
  /\b(vai de|va de|pega o|pegue o|compra o|compre o|go for|get the|grab the|my pick|minha escolha|daily driver|endgame|upgrade(?:d)? to|troquei (?:pelo|para o)|thank me later|can t go wrong|you won t regret|nao vai se arrepender|super recomendo|recomendo demais)\b/;
// uso próprio ("uso o", "i use") — só vale como recomendação junto do uso pedido
const USO_PROPRIO = /\b(uso o|uso um|uso a|estou usando|to usando|i use|i ve been using|using the|i play with|jogo com)\b/;
// comentário técnico: dado de som/ficha, o que o Davi quer extrair da comunidade
const TECNICO =
  /\b(\d\s?dd|\d\s?ba|driver\w*|planar|hibrido|hybrid|palco|soundstage|imaging|imagem|separac\w*|separation|graves|bass|agudos|treble|medios|mids|neutr\w*|v shape\w*|harman|sibilan\w*|resposta de frequencia|frequency|isolamento|isolation|latenc\w*|latency)\b/;

// uso de jogo: vale pra qualquer pedido de jogo (o termo do próprio pedido entra junto)
const USO_JOGO = /\b(jog\w*|game\w*|gaming|fps|pubg|cs2?|valorant|warzone|apex|fortnite|competitiv\w*|tiro|shooter\w*)\b/;
const TERMOS_JOGO = ['footsteps', 'footstep', 'passos', 'fps', 'pubg', 'gaming', 'games', 'game', 'jogo', 'jogos', 'jogar', 'competitive', 'competitivo', 'imaging', 'soundstage', 'positional', 'posicionamento', 'palco', 'enemies', 'inimigos'];
const VAZIAS_DO_USO = new Set(normalizar(
  'realize realise pesquisa profunda busque busca para pra min mim top melhores melhor quais qual forum foruns comunidade como reddit clube hardware adrenaline adrenalise encontrar intra auriculares auricular fones fone ouvido ouvidos para se de do da com sem uma uns umas entre sobre'
).split(' '));

/**
 * Palavras do USO pedido: as do próprio pedido (ex.: "pubg") + as da cadeia
 * do uso (tipo de uso e termos das características) + as de jogo quando o
 * pedido é de jogo. É o que diz se um comentário fala do uso ou de outra coisa
 * ("tenho os Bose QC20 há 6 anos" não fala de jogo nenhum).
 */
function termosDoUso(objetivo, cadeia = null) {
  const t = new Set();
  for (const p of normalizar(objetivo).split(' ')) if (p.length >= 3 && !VAZIAS_DO_USO.has(p) && !/^\d+$/.test(p)) t.add(p);
  if (cadeia) {
    for (const p of normalizar(`${cadeia.tipoDeUso} ${cadeia.atividade}`).split(' ')) if (p.length >= 3 && !VAZIAS_DO_USO.has(p)) t.add(p);
    for (const c of cadeia.caracteristicas || []) for (const termo of c.termosEn || []) t.add(normalizar(termo));
  }
  if (USO_JOGO.test(normalizar(objetivo)) || (cadeia && USO_JOGO.test(normalizar(cadeia.tipoDeUso)))) TERMOS_JOGO.forEach((x) => t.add(x));
  return [...t].filter(Boolean);
}

function falaDoUso(n, termos) {
  return termos.some((t) => (t.includes(' ') ? n.includes(t) : ` ${n} `.includes(` ${t} `)));
}

/**
 * Comentários de um tópico lido pelo leitor de tópico ("- [12 votos] texto"
 * ou "- texto"); página que não é tópico vira frases com 0 voto.
 */
function comentariosDe(entrada) {
  // revisão v6: resposta de bot ("I'm the Vetted AI Bot") não é comentário de usuário
  const bruto = semComentariosDeBot(entrada.bruto || entrada.texto || '');
  const primeira = bruto.split('\n')[0];
  const fonte = /^T[ÓO]PICO DO REDDIT \(r\/([^)]+)\)/i.exec(primeira)?.[1] ? `r/${/^T[ÓO]PICO DO REDDIT \(r\/([^)]+)\)/i.exec(primeira)[1]}` : dominioDe(entrada);
  if (/^T[ÓO]PICO (DO REDDIT|DE F[ÓO]RUM)/i.test(primeira)) {
    const saida = [];
    for (const linha of bruto.split('\n').slice(1)) {
      const m = /^-\s+(?:\[(\d+) votos?\]\s+)?(.+)$/.exec(linha.trim());
      if (m) saida.push({ texto: m[2].trim(), votos: Number(m[1] || 0), fonte });
      else if (/^(POST|PERGUNTA):/.test(linha)) saida.push({ texto: linha.replace(/^(POST|PERGUNTA):\s*/, ''), votos: 0, fonte, pergunta: true });
    }
    return saida;
  }
  return frases(bruto).map((f) => ({ texto: f, votos: 0, fonte }));
}

// lista de recomendação ("Simgot EM6L 120€; Truthear Zero 60€; ...")
const pareceListaDeRecomendacao = (texto) =>
  (String(texto).match(/[;\n]|\s-\s|\d+\s?(?:€|\$|usd|reais|r\$)/gi) || []).length >= 2 && (String(texto).match(/\b[A-Z][A-Za-z0-9-]+\s+[A-Z0-9][A-Za-z0-9-]*/g) || []).length >= 2;

// Pedido de indicação DENTRO do comentário (14º teste real: "o Samson já me
// havia sido recomendado... poderia me recomendar algum?" contava como
// recomendação do KZ EDX Pro por causa da palavra "recomendado")
const PEDIDO_DE_INDICACAO =
  /\b(poderia(m)? me (recomendar|indicar)|pode(m)? me (recomendar|indicar)|alguem (recomenda|indica|sabe)|voces (recomendam|indicam)|qual (voces|vc|vcs) (recomendam|indicam|acham)|o que (voces|vcs) (recomendam|acham)|me (ajudem|ajuda) a escolher|what (would|do) you (recommend|suggest)|which (one|should|would)|any (recommendations?|suggestions?)|should i (get|buy)|help me (choose|pick))\b/;

// Tópico que PEDE indicação (título/post): num tópico assim, responder só
// com o nome do produto já é recomendar
const TOPICO_PEDE_INDICACAO =
  /\b(qual|quais|recomend\w*|indica\w*|sugest\w*|sugira|melhor(es)?|which|best|recommend\w*|suggest\w*|looking for|help me|vs|versus|ou o|or the)\b/;

// Conectivo/preço que pode acompanhar um nome numa resposta direta ("Hexa ($80)")
const CONECTIVO_DE_RESPOSTA = new Set(normalizar(
  'ou or e and the o a os as um uma de do da by com with por for pra para $ r usd reais eur dolares dollars bucks ~ + / aprox around ' +
  // qualificador de resposta curta ("chu 2 for budget", "hexa here too", "eu iria de")
  'budget cheap cheaper cheapest barato baratinho custo beneficio pick option opcao also too tambem here aqui imo honestly personally definitely maybe talvez eu iria de i d id go get'
).split(' '));

/**
 * Frases do comentário que citam o nome (as outras não dizem nada DESTE
 * produto): "Qual dos dois eu recomendo entre KZ EDX e SR850? O Samson" —
 * a frase do KZ é pergunta, a recomendação é do Samson.
 */
function frasesDoNome(texto, nome) {
  const partes = String(texto).split(/(?<=[.!?;])\s+|\n+/).map((f) => f.trim()).filter(Boolean);
  const saida = [];
  partes.forEach((f, i) => {
    if (!mencionaNome(normalizar(f), nome)) return;
    saida.push(f);
    // a frase seguinte completa a do nome ("Simgot EM6L. Thank me later"),
    // a não ser que já fale de outro produto (nome com número de modelo)
    const prox = partes[i + 1];
    if (prox && !/\?\s*$/.test(f) && !mencionaNome(normalizar(prox), nome) && !pareceNomeDeProduto(prox)) saida.push(prox);
  });
  return saida;
}

/**
 * Resposta direta num tópico que pediu indicação: o comentário é só o nome
 * (e conectivo/preço). "Truthear Hexa", "Simgot EM6L ($110)".
 */
function respostaDireta(texto, nome) {
  const tokensNome = new Set(tokensDoNome(nome));
  const resto = normalizar(texto).split(' ').filter((t) => t && !tokensNome.has(t) && !/^\d+$/.test(t) && !CONECTIVO_DE_RESPOSTA.has(t));
  return resto.length === 0;
}

// revisão v6 (experimento A/B/C, 09/10/2026) — comentário que só encomendou,
// comparação em que o nome perde, escolha que é de outro produto
// 10/10: "Also just order the Kefine… I'll update you on the weekend" (sem o -ed) passava
const ENCOMENDA = /\b(ordered|just ordered|just order|pre ?ordered|i ll update you|will update you|update you on|vou te atualizar|vou atualizar voce|waiting for (my|the|it)|on the way|arriving|just bought|encomendei|pedi o|pedi um|acabei de comprar|comprei agora|esperando (o|meu|chegar)|ta chegando|vai chegar)\b/;
const COMPARATIVO = /\b(than|better than|over the|instead of|do que|melhor que|melhor do que|em vez d[oe]|ao inves d[oe]|prefiro|i prefer|prefer)\b/;
const USADOS_ANTES = /\b(out of all|of all the|among (all|the)|dentre (todos|os)|entre (todos|os) (que|os que)|que (ja )?usei|i ve (used|tried|owned)|i have (used|tried|owned))\b/;
const ESCOLHA = /\b(my pick|my choice|my favou?rite|my go to|my daily driver|minha escolha|meu favorito|minha preferencia|o que eu escolho)\b/;
// verbo/artigo/pronome: "this one is my pick" não diz QUAL — sem sujeito, não decide nada
const VERBO_DE_LIGACAO = new Set('is are e sao foi was were the os as o a for pra para this that it these those they them one ones esse este essa esta esses estes ele ela eles elas isso isto still definitely honestly personally imo'.split(' '));

/**
 * A escolha do comentário é OUTRO produto? Olha as palavras logo antes de
 * "my pick / minha escolha" ("the Astrals are my pick") ou logo depois de
 * "prefiro / i prefer". Se nenhuma é do nome, a escolha é de outro.
 */
function escolhaDeOutro(texto, nome) {
  const n = normalizar(texto);
  const proprios = new Set(tokensDoNome(nome));
  const palavras = n.split(' ');
  const sujeitoDe = (inicio, fim) => palavras.slice(Math.max(0, inicio), fim).filter((p) => p && !VERBO_DE_LIGACAO.has(p));
  const m = ESCOLHA.exec(n);
  if (m) {
    const antes = n.slice(0, m.index).trim().split(' ').length;
    const sujeito = sujeitoDe(antes - 4, antes);
    if (sujeito.length && !sujeito.some((p) => proprios.has(p))) return sujeito.join(' ');
  }
  const p = /\b(prefiro|i prefer|i d go with|eu iria de)\b/.exec(n);
  if (p) {
    const depois = n.slice(0, p.index + p[0].length).trim().split(' ').length;
    const objeto = sujeitoDe(depois, depois + 3);
    if (objeto.length && !objeto.some((x) => proprios.has(x))) return objeto.join(' ');
  }
  return null;
}

/**
 * Como um comentário fala do nome: 'recomenda' (elogio, indicação, lista de
 * recomendação, uso próprio junto do uso pedido, ou — num tópico que pede
 * indicação — resposta que é só o nome), 'critica', 'pergunta' (pede
 * indicação / pergunta sobre o nome) ou 'mencao'.
 *
 * Com `nome`, só as frases que citam o nome contam (Etapa B, 14º teste real).
 * `contexto.pedeIndicacao`: o tópico pede indicação; `contexto.doUso`: o
 * título/post já é do uso pedido.
 */
function tomDoComentario(texto, termos, nome = '', contexto = {}) {
  const alvo = nome ? frasesDoNome(texto, nome) : [];
  const trecho = alvo.length ? alvo.join(' ') : String(texto);
  const n = normalizar(trecho);
  if (CRITICA.test(n)) return 'critica';
  // revisão v6: a escolha do comentário é OUTRO produto ("dos que usei — Arete,
  // Tea Pro, Astrals —, os Astrals são minha escolha… mais fácil de localizar
  // que aqueles") → o nome perde na comparação; sem comparação, é só menção
  if (nome && alvo.length) {
    const outro = escolhaDeOutro(String(texto), nome);
    if (outro) return COMPARATIVO.test(normalizar(texto)) || USADOS_ANTES.test(normalizar(texto)) ? 'critica' : 'mencao';
    // comprou/encomendou e ainda não usou: não é experiência ("também encomendei o Kefine")
    if (ENCOMENDA.test(n) && !USO_PROPRIO.test(n)) return 'mencao';
  }
  if (nome && alvo.length) {
    const doNome = alvo.filter((f) => mencionaNome(normalizar(f), nome));
    const soPergunta = doNome.every((f) => /\?\s*$/.test(f) || PEDIDO_DE_INDICACAO.test(normalizar(f)));
    if (soPergunta) return 'pergunta';
  } else if (PEDIDO_DE_INDICACAO.test(n)) {
    return 'pergunta';
  }
  const doUso = falaDoUso(n, termos) || Boolean(contexto.doUso);
  if (ELOGIO.test(n) || RECOMENDA.test(n) || pareceListaDeRecomendacao(trecho) || (USO_PROPRIO.test(n) && doUso)) return 'recomenda';
  if (nome && contexto.pedeIndicacao && respostaDireta(texto, nome)) return 'recomenda';
  return 'mencao';
}

/** O tópico (título + post) pede indicação? E já fala do uso pedido? */
function contextoDoTopico(entrada, termos) {
  const bruto = String(entrada.bruto || entrada.texto || '');
  const linhas = bruto.split('\n');
  const cabeca = normalizar([entrada.titulo || '', linhas[0] || '', ...linhas.filter((l) => /^(POST|PERGUNTA):/.test(l)).slice(0, 1)].join(' ')).slice(0, 1500);
  return { pedeIndicacao: TOPICO_PEDE_INDICACAO.test(cabeca) || /\?/.test(linhas.find((l) => /^(POST|PERGUNTA):/.test(l)) || ''), doUso: falaDoUso(cabeca, termos) };
}

/**
 * Quanto a comunidade RECOMENDA um nome (Fase C, 2026-09-26; peso por
 * recomendação em 2026-09-28). Conta CONVERSAS, não sites. 12º teste real:
 * "eu tenho os Bose QC20 há 6 anos" (menção solta, sem jogo) valia o mesmo
 * que "I use the Truthear Hexa for footsteps" — o QC20 foi o 2º da lista.
 * Agora, por tópico, vale o melhor comentário que cita o nome:
 *   recomenda → 2, +1 se fala do uso pedido, +1 com 5+ votos, +1 com 20+;
 *   só menção → 0,5; crítica → 0 (e conta em `criticas`).
 * `topicos` = tópicos que RECOMENDAM; `mencoes` = os que só citam.
 * Site de review/guia conta 1 por domínio; LOJA NÃO CONTA. O motivo é a frase
 * que melhor diz POR QUE recomendam: da comunidade, com elogio, do uso.
 * `citacoes`: até 3 comentários pra citar na resposta (Davi: "mostrar os
 * comentários dos usuários").
 */
function consensoDe(nome, entradas, config = {}, { termos = TERMOS_JOGO } = {}) {
  const topicos = new Set();
  const mencoes = new Set();
  const editoriais = new Set();
  const editoriaisDoUso = new Set();
  const lojas = new Set();
  let elogios = 0;
  let criticas = 0;
  let pontosComunidade = 0;
  let motivo = null;
  let notaDoMotivo = -1;
  const candidatasACitacao = [];
  for (const e of entradas) {
    if (!mencionaNome(normalizar(textoDaEntrada(e)), nome)) continue;
    let tipo = tipoDeFonte(e.url || '', config);
    // busca "site:" na comunidade que devolveu página fora da lista: ainda é
    // resultado de busca na comunidade (a bancada simula a comunidade assim)
    if (tipo === 'editorial' && e.tipoBusca === 'comunidade') tipo = 'comunidade';
    if (tipo === 'loja') {
      lojas.add(dominioDe(e));
      continue;
    }
    const chave = String(e.url || dominioDe(e)).replace(/[#?].*$/, '');
    if (tipo === 'comunidade') {
      let melhor = -1;
      // Etapa B (14º teste real): o tópico dá contexto — resposta com o nome
      // num tópico que pede indicação é recomendação, e o uso do título vale
      // pro comentário que não repete "FPS/PUBG"
      const contexto = contextoDoTopico(e, termos);
      for (const c of comentariosDe(e)) {
        const n = normalizar(c.texto);
        if (!mencionaNome(n, nome)) continue;
        if (c.pergunta) continue; // o post de quem pergunta não recomenda nada
        const tom = tomDoComentario(c.texto, termos, nome, contexto);
        const doUso = falaDoUso(n, termos) || contexto.doUso;
        if (tom === 'critica') criticas += 1;
        if (tom === 'recomenda') elogios += 1;
        const valor = tom === 'recomenda' ? 2 + (doUso ? 1 : 0) + (c.votos >= 5 ? 1 : 0) + (c.votos >= 20 ? 1 : 0) : tom === 'mencao' ? 0.5 : 0;
        melhor = Math.max(melhor, valor);
        if (tom !== 'pergunta' && c.texto.length >= 25) {
          const tecnico = TECNICO.test(n);
          // 10/10: comentário-lista ("minhas escolhas: Vivace 35€, EM6L 120€, Zero Blue
          // 60€, QKZ…") cita 3+ produtos e não diz nada de nenhum — aparecia como
          // depoimento em 3 produtos diferentes. Continua contando no consenso; só
          // perde a vez como citação para um comentário sobre ESTE produto.
          const lista = new Set(nomesNaFrase(c.texto).map(normalizar)).size >= 3;
          const nota = c.votos + (doUso ? 6 : 0) + (tom === 'recomenda' ? 4 : tom === 'critica' ? 2 : 0) + (tecnico ? 3 : 0) - (c.texto.length > 320 ? 3 : 0) - (lista ? 8 : 0);
          // citação: "fala do uso" é do COMENTÁRIO (o título do tópico não
          // transforma "tenho os QC20 há 6 anos" em depoimento do uso)
          candidatasACitacao.push({ texto: c.texto.slice(0, 260), votos: c.votos, fonte: c.fonte, url: e.url || '', tom, tecnico, doUso: falaDoUso(n, termos), nota, lista });
        }
        const vitrine = /\||★|ver pre[cç]o|a partir de|\bR\$\s?\d/i.test(c.texto);
        const notaMotivo = 2 + (tom === 'recomenda' ? 1 : 0) + (doUso ? 1 : 0);
        if (tom !== 'critica' && tom !== 'pergunta' && c.texto.length <= 300 && !vitrine && notaMotivo > notaDoMotivo && n.split(' ').length - normalizar(nome).split(' ').length >= 5) {
          motivo = { texto: c.texto.slice(0, 200), dominio: dominioDe(e), tipo };
          notaDoMotivo = notaMotivo;
        }
      }
      if (melhor >= 2) topicos.add(chave);
      else if (melhor >= 0) mencoes.add(chave);
      pontosComunidade += Math.max(0, melhor);
      continue;
    }
    editoriais.add(dominioDe(e));
    // site editorial só conta como RECOMENDAÇÃO DO USO quando a página é do
    // uso (título ou frase do nome com termo do uso) ou elogia o nome
    // (13º teste real: "HyperX Cloud 3" em 18 sites de headset em geral
    // ficou em 1º de uma lista de intra pra PUBG)
    const tituloDoUso = falaDoUso(normalizar(`${e.titulo || ''} ${String(e.bruto || '').split('\n')[0]}`), termos);
    let editorialDoUso = tituloDoUso;
    for (const fr of frases(e.bruto || e.texto)) {
      const n = normalizar(fr);
      if (!mencionaNome(n, nome)) continue;
      const critica = CRITICA.test(n);
      const elogio = !critica && ELOGIO.test(n);
      if (critica) criticas += 1;
      if (elogio) elogios += 1;
      if (elogio || falaDoUso(n, termos)) editorialDoUso = true;
      const nota = 1 + (elogio ? 1 : 0);
      // linha de tabela/vitrine não é motivo (11º teste real: "JBL Quantum 50 –
      // A partir de R$ 109" e "| Redragon Zeus Pro | Melhor custo-benefício |")
      const vitrine = /\||★|ver pre[cç]o|a partir de|\bR\$\s?\d/i.test(fr);
      const palavras = n.split(' ').length - normalizar(nome).split(' ').length;
      if (fr.length <= 300 && !vitrine && palavras >= 5 && nota > notaDoMotivo) {
        motivo = { texto: fr.slice(0, 200), dominio: dominioDe(e), tipo };
        notaDoMotivo = nota;
      }
    }
    if (editorialDoUso) editoriaisDoUso.add(dominioDe(e));
  }
  // citações: as de maior nota, sem repetir texto; no máximo 1 crítica
  const citacoes = [];
  for (const c of candidatasACitacao.sort((a, b) => b.nota - a.nota)) {
    if (citacoes.length >= 3) break;
    if (citacoes.some((x) => normalizar(x.texto) === normalizar(c.texto))) continue;
    if (c.tom === 'critica' && citacoes.some((x) => x.tom === 'critica')) continue;
    if (c.tom === 'mencao' && !c.doUso && !c.tecnico) continue;
    citacoes.push({ texto: c.texto, votos: c.votos, fonte: c.fonte, url: c.url, tom: c.tom, tecnico: c.tecnico, lista: Boolean(c.lista) });
  }
  // 10/10: com críticas contadas e nenhuma citada (o Tripowin Vivace tinha 2 e
  // a resposta dizia "o material não trouxe críticas"), a melhor crítica que
  // não é lista entra como 4ª citação — vai para "Limitações" na resposta
  if (criticas && !citacoes.some((x) => x.tom === 'critica')) {
    const c = candidatasACitacao.filter((x) => x.tom === 'critica' && !x.lista).sort((a, b) => b.nota - a.nota)[0];
    if (c) citacoes.push({ texto: c.texto, votos: c.votos, fonte: c.fonte, url: c.url, tom: c.tom, tecnico: c.tecnico, lista: false });
  }
  // Ranking revisto (Davi, 2026-09-28: "classifica pela quantidade de
  // citações... devemos rever isso"): quantidade de sites NÃO manda. Site
  // editorial só conta quando fala do uso, e no máximo 3 (1 site = 1; 2-3 =
  // 2; 4+ = 3); a comunidade que recomenda para o uso é o que pesa.
  const nEd = editoriaisDoUso.size;
  const pontosEditorial = nEd >= 4 ? 3 : nEd >= 2 ? 2 : nEd;
  const pontos = Math.round((pontosComunidade + pontosEditorial + Math.min(elogios, 3) - Math.min(criticas, 3)) * 10) / 10;
  return { topicos: topicos.size, mencoes: mencoes.size, editoriais: editoriais.size, editoriaisDoUso: nEd, lojas: lojas.size, elogios, criticas, pontos, motivo, citacoes };
}

/**
 * Lista larga por consenso: cada nome ganha o consenso e +1 se o modelo o
 * nomeou lendo o material (ele leu as frases; o padrão de texto não). Ordem
 * estável: empate fica na ordem em que chegaram.
 */
function rankearPorConsenso(validos, entradas, { config = {}, doModelo = new Set(), termos = TERMOS_JOGO } = {}) {
  return validos
    .map((c, i) => {
      const consenso = consensoDe(c.nome, entradas, config, { termos });
      return { ...c, consenso, pontos: consenso.pontos + (doModelo.has(normalizar(c.nome)) ? 1 : 0), ordem: i };
    })
    // desempate por fonte que NÃO é loja (comunidade e sites de conteúdo) —
    // o número bruto de domínios favorecia nome de vitrine
    .sort((a, b) => b.pontos - a.pontos || fontesDeConteudo(b) - fontesDeConteudo(a) || a.ordem - b.ordem);
}
const fontesDeConteudo = (c) => (c.consenso?.topicos || 0) + (c.consenso?.mencoes || 0) + (c.consenso?.editoriais || 0);

/**
 * Nome de linha/série que o material quase sempre escreve com o número do
 * modelo depois (12º teste real: "JBL Quantum" e "JBL Quantum 50" viraram
 * dois finalistas e duas colunas da tabela). Se o nome curto aparece
 * sozinho (sem número logo depois) em no máximo 1/4 das menções, é a série
 * do longo: some e os sites dele passam pro longo. "KZ ZSN Pro" × "KZ ZSN
 * Pro 2" continuam separados — o "ZSN Pro" sozinho é citado toda hora.
 */
function absorverSeries(lista, entradas) {
  const textos = entradas.map((e) => ` ${normalizar(textoDaEntrada(e))} `);
  const saida = [...lista];
  for (const curto of lista) {
    const n = normalizar(curto.nome);
    if (/\d/.test(n)) continue;
    const longos = saida.filter((o) => o !== curto && normalizar(o.nome).startsWith(`${n} `) && /^\d/.test(normalizar(o.nome).slice(n.length + 1)));
    if (!longos.length) continue;
    let sozinho = 0;
    let total = 0;
    const re = new RegExp(` ${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\S+)?`, 'g');
    for (const t of textos) {
      for (const m of t.matchAll(re)) {
        total += 1;
        if (!/^\d/.test(m[1] || '')) sozinho += 1;
      }
    }
    if (total && sozinho / total > 0.25) continue;
    const alvo = longos.sort((a, b) => b.dominios.length - a.dominios.length)[0];
    const i = saida.indexOf(alvo);
    saida[i] = { ...alvo, dominios: [...new Set([...alvo.dominios, ...curto.dominios])], mencoes: Math.max(alvo.mencoes || 0, curto.mencoes || 0) };
    saida.splice(saida.indexOf(curto), 1);
  }
  return saida;
}

/**
 * Categoria do produto pedido (10º teste real, 2026-09-26): um iPhone ("15
 * 15 Pro 15 Pro") e um slogan ("Seu ANC") viraram finalistas de "melhores
 * fones intra-auriculares" — nada conferia se o nome era do TIPO pedido.
 * Tabela pequena das categorias que aparecem nos testes, com os nomes em
 * inglês (o Reddit fala "IEM", "earbuds", "GPU"). Pedido fora da tabela →
 * null e a checagem não se aplica (nunca tira nome por não saber).
 */
const CATEGORIAS = [
  // intra-auricular antes de "fone" em geral (11º teste real: o headset
  // Redragon Zeus Pro passou como "fone" num pedido de intra-auricular).
  // `exclui`: nome que só aparece junto de outro tipo (headset, over-ear) e
  // nunca junto de um termo `especifico` do pedido é de outro tipo — sai.
  {
    pedido: /\b(intra ?auricular(es)?|in ?ear|iems?|earbuds?|earphones?)\b/,
    termos: 'fone fones intra auricular auriculares inear iem iems earbud earbuds earphone earphones tws ouvido',
    especificos: 'intra auricular auriculares inear iem iems earbud earbuds earphone earphones tws',
    exclui: 'headset headsets headphone headphones circumaural concha supra auricular',
    rotulo: 'fone intra-auricular IEM',
  },
  { pedido: /\b(fones?|headsets?|headphones?|earbuds?|earphones?|iems?|intra ?auricular(es)?)\b/, termos: 'fone fones headset headsets headphone headphones earbud earbuds earphone earphones iem iems intra auricular auriculares in-ear inear ouvido tws' },
  { pedido: /\bmonitor(es)?\b/, termos: 'monitor monitores tela telas display displays screen hz', rotulo: 'monitor' },
  { pedido: /\b(placas? de video|gpus?|placas? graficas?)\b/, termos: 'placa placas gpu gpus rtx gtx radeon geforce video graphics card' },
  { pedido: /\bteclados?\b/, termos: 'teclado teclados keyboard keyboards switch switches', rotulo: 'teclado' },
  { pedido: /\bmouses?\b/, termos: 'mouse mouses mice sensor dpi', rotulo: 'mouse' },
  { pedido: /\bcadeiras?\b/, termos: 'cadeira cadeiras chair chairs', rotulo: 'cadeira' },
  { pedido: /\b(celular(es)?|smartphones?)\b/, termos: 'celular celulares smartphone smartphones phone phones' },
  { pedido: /\b(notebooks?|laptops?)\b/, termos: 'notebook notebooks laptop laptops', rotulo: 'notebook' },
];

/**
 * A palavra da categoria que vai junto do nome nas buscas de UM produto
 * (11/10). Nome curto ou ambíguo sozinho traz qualquer coisa: "Zero Red
 * especificações técnicas" trouxe página sobre o número zero e letra de
 * música; "Kiwi Ears Orchestra Lite", a fruta; "Xenn" (marca de IEM), um
 * jogador profissional. Vazio quando o pedido não é de uma categoria
 * conhecida ou o nome já traz a palavra.
 */
function rotuloDaCategoria(objetivo, nome = '') {
  const c = CATEGORIAS.find((k) => k.pedido.test(normalizar(objetivo)));
  if (!c?.rotulo) return '';
  const noNome = new Set(normalizar(nome).split(' '));
  return normalizar(c.rotulo).split(' ').some((p) => noNome.has(p)) ? '' : c.rotulo;
}

function categoriaDoPedido(objetivo) {
  const t = normalizar(objetivo);
  const c = CATEGORIAS.find((k) => k.pedido.test(t));
  if (!c) return null;
  const termos = new Set(c.termos.split(' '));
  if (c.exclui) {
    termos.especificos = new Set(c.especificos.split(' '));
    // "supra auricular" é bigrama: "auricular" sozinho é do pedido
    termos.exclui = new Set(c.exclui.split(' ').filter((t) => t !== 'auricular' && t !== 'supra'));
    termos.excluiBigrama = /\bsupra auricular(es)?\b|\bover ear\b/;
  }
  return termos;
}

// palavras que podem ficar entre "headset" e o nome sem mudar de quem se fala
const LIGACAO_ANTES_DO_NOME = new Set(['is', 'are', 'was', 'now', 'the', 'a', 'an', 'called', 'named', 'currently', 'right', 'e', 'o', 'os', 'as', 'um', 'uma', 'sao', 'chamado', 'chamada', 'atualmente', 'hoje', 'agora']);

/** Só aparece junto de OUTRO tipo (headset, over-ear) e nunca junto de um termo específico do pedido. */
function deOutroTipo(nome, entradas, termos) {
  if (!termos?.exclui) return false;
  let outro = 0;
  let doTipo = 0;
  for (const e of entradas) {
    const norm = normalizar(textoDaEntrada(e));
    if (!mencionaNome(norm, nome)) continue;
    // nome INTEIRO e contíguo (12º teste real: "HyperX Cloud II" casava com
    // "HyperX Cloud Earbuds II" pelos tokens soltos — o "earbuds" de outro
    // produto salvava o headset)
    const alvo = ` ${normalizar(nome)} `;
    const exato = (t) => ` ${t} `.includes(alvo);
    const trechos = [...frases(String(e.bruto || e.texto || '')).map(normalizar).filter(exato)];
    if (e.titulo && exato(normalizar(e.titulo))) trechos.push(normalizar(e.titulo));
    for (const t of trechos) {
      // revisão v6: o tipo escrito LOGO DEPOIS do nome é o tipo do produto
      // ("HyperX Cloud II Gaming Headset") — vale por duas frases soltas. O
      // Cloud II virou finalista de "intra pra PUBG" porque a frase que o
      // dizia era uma só, e a ficha veio da Wikipédia errada
      const depois = ` ${t} `.split(alvo)[1]?.trim().split(' ').slice(0, 3) || [];
      if (depois.some((p) => termos.exclui.has(p)) || termos.excluiBigrama.test(depois.join(' '))) {
        outro += 2;
        continue;
      }
      // 11/10 (Audeze Maxwell num "top 5 intra-auriculares"): o tipo dito
      // logo ANTES do nome, ligado só por verbo de ligação e artigo, também é
      // o tipo do produto — "the new best gaming headset now is the Audeze
      // Maxwell". Com outra palavra no meio ("troquei meu headset pelo EM6L")
      // não vale: aí o headset é outro aparelho.
      const antes = ` ${t} `.split(alvo)[0].trim().split(' ').slice(-6);
      const iTipo = antes.map((p) => termos.exclui.has(p)).lastIndexOf(true);
      if (iTipo >= 0 && antes.slice(iTipo + 1).every((p) => LIGACAO_ANTES_DO_NOME.has(p))) {
        outro += 2;
        continue;
      }
      const ps = t.replace(alvo.trim(), ' ').split(' ');
      if (ps.some((p) => termos.especificos.has(p)) && !termos.excluiBigrama.test(t)) doTipo += 1;
      else if (ps.some((p) => termos.exclui.has(p)) || termos.excluiBigrama.test(t)) outro += 1;
    }
  }
  // maioria (13º teste real: "HyperX Cloud 3", headset em 18 sites, passou
  // porque UMA frase trazia "earbuds" junto): de outro tipo quando as frases
  // de headset/over-ear são 2+ e pelo menos o dobro das de intra/IEM
  return outro >= 2 && outro >= 2 * doTipo;
}

/**
 * A ficha técnica lida diz que o produto é de OUTRO tipo? (Etapa E) Conta
 * "headset / over-ear / circumaural" contra "in-ear / intra / IEM / earbuds"
 * nas páginas de ficha da opção (o título pesa dobrado). Sem ficha → não
 * decide nada.
 */
function fichaDeOutroTipo(nome, fichas, termos) {
  if (!termos?.exclui || !fichas.length) return false;
  let outro = 0;
  let doTipo = 0;
  const conta = (texto, peso) => {
    const n = normalizar(texto);
    for (const p of n.split(' ')) {
      if (termos.especificos.has(p)) doTipo += peso;
      else if (termos.exclui.has(p)) outro += peso;
    }
    // "In Ear Monitor Headphones" (vitrine de IEM) é do tipo pedido
    doTipo += ((n.match(/\bin ear\b/g) || []).length) * peso;
    outro += (n.match(termos.excluiBigrama) ? 1 : 0) * peso;
  };
  // vitrine: "quem viu também comprou" fala de OUTROS produtos
  const semVitrine = (t) => String(t).split(/\b(customers (also|who)|frequently bought|you may also like|tamb[eé]m (viram|compraram)|quem (viu|comprou)|compre junto|produtos relacionados|related products)\b/i)[0];
  for (const e of fichas) {
    conta(e.titulo || '', 2);
    conta(semVitrine(String(e.bruto || e.texto || '')).slice(0, 6000), 1);
  }
  return outro >= 3 && outro >= 3 * Math.max(1, doTipo);
}

/**
 * O nome aparece como algo da categoria pedida? Basta UMA frase que cite o
 * nome e um termo da categoria, ou um tópico/página cujo título já é da
 * categoria ("TÓPICO DO REDDIT: best IEMs for PUBG" — ali todo nome citado
 * é fone). Página de celular que cita "15 Pro" não passa.
 */
function citadoNaCategoria(nome, entradas, termos) {
  const temTermo = (trechoNormalizado) => trechoNormalizado.split(' ').some((p) => termos.has(p));
  for (const e of entradas) {
    const bruto = String(e.bruto || e.texto || '');
    const norm = normalizar(textoDaEntrada(e));
    if (!mencionaNome(norm, nome)) continue;
    const primeira = normalizar(bruto.split('\n')[0].slice(0, 200));
    if (/^(topico do reddit|topico de forum)/.test(primeira) && temTermo(primeira)) return true;
    // título da página ("Os 10 melhores fones para jogos") vale pra lista inteira dela
    if (e.titulo && temTermo(normalizar(e.titulo))) return true;
    // a frase do nome ou a anterior ("Os melhores fones de 2026: KZ EDX Pro...")
    const fs = frases(bruto).map(normalizar);
    for (let i = 0; i < fs.length; i += 1) {
      if (mencionaNome(fs[i], nome) && (temTermo(fs[i]) || (i > 0 && temTermo(fs[i - 1])))) return true;
    }
  }
  return false;
}

/**
 * Tira da lista o que não é da categoria pedida — sem esvaziá-la: se sobrar
 * menos de 3, os de fora vão pro fim em vez de sumir (evidência fraca, mas o
 * motor segue; a ficha técnica da Fase D confere depois).
 */
function filtrarPorCategoria(ranqueados, entradas, objetivo) {
  const termos = categoriaDoPedido(objetivo);
  if (!termos) return { lista: ranqueados, fora: [] };
  // Etapa C (14º teste real): o que é claramente de OUTRO tipo (headset num
  // pedido de intra) sai sempre — antes voltava pro fim da lista quando
  // sobravam menos de 3, e o Arctis 1 virou finalista de "intra pra PUBG"
  const outroTipo = new Set(ranqueados.filter((c) => deOutroTipo(c.nome, entradas, termos)));
  const dentro = ranqueados.filter((c) => !outroTipo.has(c) && citadoNaCategoria(c.nome, entradas, termos));
  const semCategoria = ranqueados.filter((c) => !outroTipo.has(c) && !dentro.includes(c));
  const foraSempre = [...outroTipo].map((c) => c.nome);
  if (dentro.length >= 3 || !semCategoria.length) return { lista: dentro, fora: [...foraSempre, ...semCategoria.map((c) => c.nome)] };
  return { lista: [...dentro, ...semCategoria], fora: foraSempre };
}

/** Finalistas da lista por consenso: os de 2+ pontos (até o orçamento); abaixo de 3, completa com os seguintes. */
function escolherPorConsenso(ranqueados, maximo) {
  const fortes = ranqueados.filter((c) => c.pontos >= 2).slice(0, maximo);
  if (fortes.length >= 3) return fortes;
  // completar só com quem tem alguma fonte de conteúdo (nome só de loja nunca)
  const resto = ranqueados.filter((c) => !fortes.includes(c) && (!c.consenso || fontesDeConteudo(c) > 0));
  return [...fortes, ...resto].slice(0, Math.min(maximo, 3));
}

/**
 * Finalistas: primeiro os citados por 2+ sites (recomendação que se repete),
 * até `maximo`; se isso der menos de 2, completa com os citados por um site
 * só — melhor comparar com evidência fraca (e dizer isso) do que não
 * comparar.
 */
function escolherFinalistas(validos, maximo) {
  const fortes = validos.filter((c) => c.dominios.length >= 2).slice(0, maximo);
  if (fortes.length >= 3) return fortes;
  // 7º teste real: 2 fortes (Galaxy Buds FE, KZ ZSN PRO) e o JBL Wave Buds 2,
  // nomeado pelo modelo e presente no material, foi pra "outros" — pedido
  // de "melhores" saiu comparando 2. Abaixo de 3, completa com os de 1 site
  // (na ordem em que vieram), sem passar do orçamento.
  const fracos = validos.filter((c) => !fortes.includes(c));
  return [...fortes, ...fracos].slice(0, Math.min(maximo, 3));
}

/**
 * Material da chamada de candidatos (2º teste real, 2026-09-24): antes era o
 * texto de cada leitura, na ordem, cortado em 9000 caracteres — e as
 * primeiras leituras eram uma vitrine da Amazon "(nada relevante)" e páginas
 * cruas (destilação fraca) cheias de menu. O modelo recebeu isso e respondeu
 * que não havia opção nenhuma, mesmo com um fórum listando fones mais abaixo.
 * Agora: leitura "(nada relevante)" fica fora, as destiladas vêm primeiro,
 * cada leitura tem uma fatia do orçamento, e das cruas só entram as linhas
 * com cara de nome de produto (ver `pareceNomeDeProduto`).
 */
function materialParaCandidatos(entradas, teto = 9000) {
  // Tópico da comunidade entra SEMPRE, primeiro, pelo texto cru (as frases
  // com nome de produto): 11º teste real, o tópico do Clube do Hardware
  // "fones intra-auriculares para FPS de PC (PUBG etc)" foi lido inteiro e a
  // destilação devolveu "nada relevante" — os nomes que a comunidade
  // recomendava nunca chegaram à lista.
  const daComunidade = (e) => tipoDeFonte(e.url || '') === 'comunidade';
  const uteis = entradas.filter((e) => daComunidade(e) || !/^\(nada relevante/.test(String(e.texto || '')));
  const ordem = (e) => (daComunidade(e) ? 2 : e.destilado ? 1 : 0);
  const ordenadas = [...uteis].sort((a, b) => ordem(b) - ordem(a));
  const fatia = Math.max(600, Math.floor(teto / Math.max(1, ordenadas.length)));
  const blocos = ordenadas.map((e) => {
    // comentário de fórum é escrito em minúscula ("vai de kz edx pro") — o
    // filtro de "cara de nome de produto" jogaria fora; vai o tópico cru
    if (daComunidade(e)) return `[${dominioDe(e)}] ${String(e.bruto || e.texto || '').slice(0, fatia * 2)}`;
    const texto = e.destilado ? String(e.texto || '') : frases(e.bruto || e.texto).filter(pareceNomeDeProduto).join('\n');
    return texto ? `[${dominioDe(e)}] ${texto.slice(0, fatia)}` : '';
  });
  return blocos.filter(Boolean).join('\n\n').slice(0, teto);
}

// termos que parecem modelo mas não são opção de compra num pedido de recomendação
const NAO_PRODUTO = new Set(normalizar(
  'usb rgb pc ps4 ps5 xbox rtx gtx rx ryzen intel amd windows android ios bluetooth wifi hd fhd uhd 4k 8k ' +
  'black friday mercado livre amazon reddit youtube tiktok instagram r$ fps pubg cs go cs2 lol faq pdf ' +
  // 10º teste real: "JBL Brasil" (nome do site da marca) virou candidato
  'brasil brazil store shop site blog canal global br oficial'
).split(' '));

const INICIO_DE_FRASE = new Set(normalizar(
  'o a os as e um uma no na nos nas do da dos das de em para pra com sem se eu meu minha por ao aos o top melhor melhores ' +
  // verbo de recomendação no começo da frase ("Recomendo KZ ZSN PRO 2")
  'recomendo recomendamos indico indicamos sugiro compre comprei veja conheca confira escolha uso usei tenho ' +
  // 10º teste real: "Seu ANC avançado é alimentado..." virou o candidato "Seu ANC"
  'seu sua seus suas nosso nossa este esta esse essa isso aquele aquela ele ela eles elas como quando onde tambem mas ja so ou'
).split(' '));

// Palavras de CATEGORIA, não de marca/modelo (6º teste real, 2026-09-25): a
// segunda chance por padrão promoveu a finalista títulos de vitrine em
// maiúsculas — "FONE DE OUVIDO INTRA AURICULAR", "CABO 1", "JBL Fone",
// "JBL Som" — e o HyperX Cloud Earbuds II, nome de verdade, ficou de fora.
// Token daqui não conta como parte "de nome" do candidato.
const GENERICO = new Set(normalizar(
  'fone fones ouvido ouvidos intra auricular auriculares cabo cabos gamer gamers fio bluetooth microfone mic ' +
  'headset headsets headphone headphones earphone earphones earbud earbuds som audio áudio preto preta branco branca ' +
  'azul vermelho vermelha rosa cinza kit jogo jogos game games novo nova original oficial modelo marca produto ' +
  'oferta ofertas promocao frete gratis preco loja compra comprar review analise teste guia completo lista ' +
  'tws ear in intra-auricular estereo stereo surround driver drivers case estojo adaptador conector p2 p3 ' +
  // 9º teste real: "4-8 Horas", "Wireless Quantum 2"
  'hora horas h min minutos wireless sem-fio'
).split(' '));

/** Trecho com um token de modelo: letra+número ("ZSN", "Chu 2", "SR225X", "7Hz") ou sigla em maiúsculas. */
function pareceNomeDeProduto(trecho) {
  return /\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9-]{2,}\b|\b[A-Z]{2,5}\b/.test(String(trecho || ''));
}

/* ------------- outro produto na frase (revisão v6, 09/10/2026) ------------- */
// Experimento A/B/C (mesmo dossiê, 3 respostas): a matriz punha na célula do
// QKZ AK6 frases sobre o JBL C50HI e o JBL Quantum 50 (lista "top 10" lida
// pra preencher lacuna do QKZ), na do Kefine Delci AE um comentário sobre o
// Simgot EG280, na do HyperX Cloud II uma frase do HyperX Cloud Earbuds. A
// regra "página lida PRA a opção vale pra opção" só olhava as outras
// FINALISTAS — qualquer outro produto passava. Agora: nome conhecido da
// lista larga, marca de outro produto conhecido, ou nome com cara de modelo
// ("JBL C50HI", "Z1 Pro") que não é da opção tira a frase da célula dela.

// comentário de bot ("I'm the Vetted AI Bot", AutoModerator): não é opinião de usuário
const COMENTARIO_DE_BOT = /\b(i(?:'|’)?m (a|the) [a-z ]{0,24}bot|i am (a|the) [a-z ]{0,24}bot|vetted ai|this action was performed automatically|automoderator|beep boop|sou o [a-z ]{0,24}bot)\b/i;
function semComentariosDeBot(texto) {
  return String(texto || '')
    .split('\n')
    .filter((l) => !COMENTARIO_DE_BOT.test(l))
    .join('\n');
}

// token de ficha técnica que o padrão de nome confundia com modelo ("4BA Hybrid Configuration", "IPX6 Rating", "DSP Chip")
const TECNICO_DE_FICHA = new Set(normalizar(
  'hybrid hibrido hibrida configuration configuracao dynamic dinamico balanced armature planar diaphragm diafragma driver drivers dd ba ' +
  'mm hz khz ohm ohms db dlc pu ofc pin pins cable cabo type tipo dac amp ipx rating sensitivity sensibilidade impedance impedancia ' +
  'frequency response iem iems tws anc enc dsp eq lcd led oled spl thd'
).split(' '));
// começo de frase em inglês (o Reddit mistura): "The Zero", "My EM6L"
const INICIO_EN = new Set('the a an my i i m im this that it its for with and but so if also just currently right now'.split(' '));
// token que é modelo/linha em vários fabricantes — sozinho não identifica marca
const COMUM_EM_MODELO = new Set('zero pro max mini air one plus ultra lite neo new nova star free buds open mk mark se ii iii iv edition gamer gaming'.split(' '));

/** Nomes com cara de produto na frase crua ("JBL C50HI", "Z1 Pro", "Simgot EG280"). */
function nomesNaFrase(frase) {
  const re = /\b[A-Z0-9][A-Za-z0-9-]*(?:\s+[A-Z0-9][A-Za-z0-9-]*){1,3}\b/g;
  const saida = [];
  for (const m of String(frase || '').matchAll(re)) {
    const partes = m[0].trim().split(/\s+/);
    while (partes.length && (partes[0].length < 2 || INICIO_DE_FRASE.has(normalizar(partes[0])) || INICIO_EN.has(normalizar(partes[0])))) partes.shift();
    if (partes.length < 2) continue;
    const tokens = partes.map(normalizar);
    const primeiro = tokens[0];
    if (NAO_PRODUTO.has(primeiro) || GENERICO.has(primeiro) || TECNICO_DE_FICHA.has(primeiro) || /^\d+$/.test(primeiro)) continue;
    if (/^\d+(dd|ba|mm|hz|khz|db|w|v|h|g|ms)$/.test(primeiro)) continue; // "10mm Dynamic", "1DD 4BA"
    // título em maiúsculas ("IMAGING AND LAYERING", "ESPECIFICAÇÕES TÉCNICAS") não é nome
    if (partes.every((p) => p === p.toUpperCase()) && !partes.some((p) => /\d/.test(p))) continue;
    const deNome = tokens.filter((t) => t.length >= 2 && !GENERICO.has(t) && !NAO_PRODUTO.has(t) && !TECNICO_DE_FICHA.has(t) && !INICIO_EN.has(t) && !/^\d+$/.test(t));
    if (deNome.length < 2) continue;
    const temModelo =
      tokens.some((t) => /\d/.test(t) && !/^(19|20)\d\d$/.test(t) && !/^\d+(dd|ba|mm|hz|khz|db|ms)$/.test(t)) ||
      partes.some((p) => /^[A-Z]{2,5}$/.test(p) && !TECNICO_DE_FICHA.has(normalizar(p)) && !NAO_PRODUTO.has(normalizar(p)));
    if (temModelo) saida.push(partes.join(' '));
  }
  return saida;
}

/** O nome achado na frase é a própria opção? ("Delci AE" e "Kefine Delci AE Edition" são o Kefine Delci AE) */
// palavra de tipo que, NO NOME, separa um produto do outro da mesma linha
// ("HyperX Cloud Earbuds II" × "HyperX Cloud II")
const TIPO_NO_NOME = new Set('earbuds earbud buds headset headsets headphone headphones earphone earphones tws'.split(' '));
// "Chu II" é o "Chu 2"
const ROMANO = { ii: '2', iii: '3', iv: '4', v: '5' };
const semRomano = (t) => ROMANO[t] || t;
function ehDaOpcao(achado, nome) {
  const proprios = new Set(tokensDoNome(nome).map(semRomano));
  const tokens = tokensDoNome(achado).map(semRomano).filter((t) => (TIPO_NO_NOME.has(t) || !GENERICO.has(t)) && !TECNICO_DE_FICHA.has(t));
  if (!tokens.length) return true;
  return tokens.every((t) => proprios.has(t)) || citaNaFrase(normalizar(achado), nome);
}

/** Os outros produtos conhecidos na pesquisa (lista larga) e as marcas deles, sem os da própria opção. */
function outrosProdutos(nome, conhecidos = []) {
  const proprio = normalizar(nome);
  const tokensProprios = new Set(tokensDoNome(nome));
  const nomes = [...new Set((conhecidos || []).map((n) => String(n || '').trim()).filter(Boolean))].filter((n) => {
    const o = normalizar(n);
    return o && o !== proprio && !mencionaNome(o, nome) && !mencionaNome(proprio, n);
  });
  const marcas = new Set();
  for (const n of nomes) {
    const t = tokensDoNome(n)[0];
    if (!t || tokensProprios.has(t) || COMUM_EM_MODELO.has(t) || GENERICO.has(t) || NAO_PRODUTO.has(t)) continue;
    if (t.length >= 3 || /\d/.test(t)) marcas.add(t);
  }
  return { nomes, marcas };
}

/**
 * Tokens que identificam o MODELO da opção (sem a marca): "em6l" do Simgot
 * EM6L, "delci" do Kefine Delci AE, "chu" do Moondrop Chu 2 DSP. Frase da
 * página da opção que traz um deles fala da opção, mesmo citando outro
 * produto ("O EM6L é o sucessor do Simgot EM5…").
 */
function tokensDoModelo(nome) {
  const t = tokensDoNome(nome);
  return t.slice(1).filter((x) => !COMUM_EM_MODELO.has(x) && !GENERICO.has(x) && !TECNICO_DE_FICHA.has(x) && (x.length >= 3 || /\d/.test(x)) && !/^\d+$/.test(x));
}

/** A frase fala de OUTRO produto que não a opção? */
function falaDeOutroProduto(frase, nome, outros = { nomes: [], marcas: new Set() }) {
  const n = normalizar(frase);
  if (outros.nomes.some((o) => mencionaNome(n, o))) return true;
  if (n.split(' ').some((t) => outros.marcas.has(t))) return true;
  return nomesNaFrase(frase).some((achado) => !ehDaOpcao(achado, nome));
}

/**
 * Segunda chance quando o modelo não devolve nenhum nome: sequências de 2 a
 * 4 palavras começando com maiúscula ou número, com pelo menos um token de
 * modelo (letra+número ou sigla). Só entra o que aparecer em 2+ sites
 * diferentes — o critério é mais rígido que o da lista do modelo porque aqui
 * é padrão de texto, não leitura.
 */
function candidatosPorPadrao(entradas, { objetivo = '', maximo = 8 } = {}) {
  const re = /\b[A-Z0-9][A-Za-z0-9-]*(?:\s+[A-Z0-9][A-Za-z0-9-]*){1,4}\b/g;
  const achados = new Map();
  for (const e of entradas) {
    for (const m of String(e.bruto || e.texto || '').matchAll(re)) {
      // início de frase ("O Moondrop Chu 2") não faz parte do nome
      const partes = m[0].trim().split(/\s+/);
      while (partes.length && (partes[0].length < 2 || INICIO_DE_FRASE.has(normalizar(partes[0])))) partes.shift();
      // número solto depois de um token que já é o modelo ("JBL Quantum 50 4",
      // do "4,5 estrelas" ou "4 horas" da vitrine — 9º teste real) não é parte do nome
      while (partes.length > 2 && /^\d+$/.test(partes[partes.length - 1]) && /\d/.test(partes[partes.length - 2])) partes.pop();
      const nome = partes.join(' ');
      const tokens = normalizar(nome).split(' ').filter(Boolean);
      if (tokens.length < 2 || nome.length > 40 || NAO_PRODUTO.has(tokens[0])) continue;
      // nome não começa com número puro nem repete palavra (10º teste real:
      // "15 15 Pro 15 Pro", pedaço de "iPhone 15 | 15 Pro | 15 Pro Max"
      // — o "iPhone" minúsculo ficou de fora do padrão)
      if (/^\d+$/.test(tokens[0]) || new Set(tokens).size < tokens.length) continue;
      if (tokens.every((t) => NAO_PRODUTO.has(t) || /^\d+$/.test(t))) continue;
      // letra solta NO MEIO ou artigo/preposição depois do 1º token ("JBL O
      // Fone", "FONE DE OUVIDO", "KZ ZSN PRO 2 E QKZ") é frase de título,
      // não nome de modelo — letra de versão no FIM ("KZ ZSN Pro X") fica
      const meio = partes.slice(1, -1);
      if (meio.some((p) => /^[A-Za-z]$/.test(p)) || partes.slice(1).some((p) => INICIO_DE_FRASE.has(normalizar(p)))) continue;
      // pelo menos 2 tokens "de nome" (marca + linha/modelo): nem categoria,
      // nem número puro, nem termo técnico — "CABO 1" e "JBL Fone" têm 0 e 1
      // nome começa pela marca, não pela categoria ("GAMER CABO 1 JBL O",
      // pedaço do mesmo título de vitrine cortado pelo padrão)
      if (GENERICO.has(tokens[0])) continue;
      const deNome = partes.filter((p) => {
        const t = normalizar(p);
        return t.length >= 2 && !GENERICO.has(t) && !NAO_PRODUTO.has(t) && !/^[\d\s]+$/.test(t);
      });
      if (deNome.length < 2) continue;
      // token de modelo: número que não é ano ("Chu 2", "SR225X", "7Hz") ou
      // sigla ("ZSN") — a sigla só conta se for token de nome, senão todo
      // título em maiúsculas ("FONE", "CABO") passava como sigla
      const temModelo = tokens.some((t) => /\d/.test(t) && !/^(19|20)\d\d$/.test(t)) || deNome.some((p) => /^[A-Z]{2,5}$/.test(p));
      if (!temModelo) continue;
      achados.set(normalizar(nome), nome);
    }
  }
  return validarCandidatos([...achados.values()], entradas, { objetivo })
    .filter((c) => c.fontes >= 2)
    .slice(0, maximo)
    .map((c) => c.nome);
}

/**
 * "IMPORTA: latência, palco sonoro" — o que o material de descoberta diz que
 * decide a escolha e o plano não tinha (5º teste real: o plano do modelo 7B
 * ficou em "cancelamento de ruído" e "design portátil" enquanto o material
 * dizia "a latência é crucial em jogos competitivos"). Até 2, sem repetir
 * critério que já existe.
 */
function lerCriteriosDoMaterial(texto, criteriosAtuais = [], objetivo = '') {
  const linha = String(texto || '').split('\n').find((l) => /^\W*importa\s*:/i.test(l));
  if (!linha) return [];
  const pedido = normalizar(objetivo);
  const vistos = criteriosAtuais.map((k) => k.nome);
  return linha
    .replace(/^\W*importa\s*:/i, '')
    .split(/[,;]| e /)
    .map((t) => t.replace(/[."']/g, '').trim())
    .filter((t) => normalizar(t).length >= 4 && normalizar(t).split(' ').length <= 5)
    .filter((t) => {
      // sinônimo de critério que já existe ("Baixa latência" × "atraso do áudio") não entra
      if (vistos.some((e) => mesmoCriterio(e, t))) return false;
      // 9º teste real: "compatibilidade com PC" veio pelo IMPORTA — vago também aqui
      const vago = CRITERIO_VAGO.exec(normalizar(t));
      if (vago && !pedido.includes(vago[1])) return false;
      if (CRITERIO_META.test(normalizar(t))) return false;
      vistos.push(t);
      return true;
    })
    .slice(0, 2)
    // peso médio (9º teste real): com "alto", "Conectividade tri-modo" (recurso
    // de UM fone) passou na frente do "atraso" do plano na hora de escolher
    // as buscas de lacuna
    .map((nome) => ({ nome, peso: 'medio', termos: [nome], doMaterial: true }));
}

/* -------------- 2c. comunidade: bateria de buscas + extração POR TÓPICO (Etapa C) -------------- */

/**
 * Produto e uso em inglês, subreddits e termo em português, por categoria
 * (Etapa C da revisão v2). No 14º teste real a descoberta na comunidade era
 * UMA busca por fórum, e a busca de conhecimento em inglês saiu "what makes
 * a good HEADSET for FPS" (o 7B trocou o produto). O termo certo vem daqui,
 * pelo código.
 */
const CATEGORIA_EN = [
  { pedido: /\b(intra ?auricular(es)?|in ?ear|iems?)\b/, en: ['IEM', 'in-ear'], pt: ['fone intra auricular', 'fone in ear'], subs: ['iems', 'inearfidelity', 'headphones'], subsPt: ['audiofiliabrasil'], audio: true },
  { pedido: /\b(earbuds?|tws)\b/, en: ['earbuds', 'TWS earbuds'], pt: ['fone tws', 'fone bluetooth'], subs: ['headphones', 'earbuds'], subsPt: ['audiofiliabrasil'], audio: true },
  { pedido: /\b(fones?|headsets?|headphones?)\b/, en: ['headset', 'headphones'], pt: ['headset', 'fone de ouvido'], subs: ['headphones', 'HeadphoneAdvice'], subsPt: ['audiofiliabrasil'], audio: true },
  { pedido: /\b(placas? de video|gpus?|placas? graficas?)\b/, en: ['GPU', 'graphics card'], pt: ['placa de video', 'gpu'], subs: ['buildapc', 'nvidia', 'hardware'], subsPt: ['hardwarebrasil'] },
  { pedido: /\bmonitor(es)?\b/, en: ['monitor', 'gaming monitor'], pt: ['monitor', 'monitor gamer'], subs: ['Monitors', 'buildapc'], subsPt: ['hardwarebrasil'] },
  { pedido: /\bmouses?\b/, en: ['mouse', 'gaming mouse'], pt: ['mouse', 'mouse gamer'], subs: ['MouseReview'], subsPt: ['hardwarebrasil'] },
  { pedido: /\bteclados?\b/, en: ['keyboard', 'mechanical keyboard'], pt: ['teclado', 'teclado mecanico'], subs: ['MechanicalKeyboards'], subsPt: ['hardwarebrasil'] },
  { pedido: /\b(notebooks?|laptops?)\b/, en: ['laptop', 'gaming laptop'], pt: ['notebook', 'notebook gamer'], subs: ['SuggestALaptop', 'GamingLaptops'], subsPt: ['hardwarebrasil'] },
  { pedido: /\bcadeiras?\b/, en: ['chair', 'gaming chair'], pt: ['cadeira', 'cadeira gamer'], subs: ['OfficeChairs'], subsPt: [] },
  { pedido: /\b(celular(es)?|smartphones?)\b/, en: ['phone', 'smartphone'], pt: ['celular', 'smartphone'], subs: ['PickAnAndroidForMe', 'smartphones'], subsPt: [] },
];

const JOGOS = [
  { re: /\bpubg\b/, en: 'PUBG', sub: 'PUBATTLEGROUNDS', subCompetitivo: 'CompetitivePUBG', fps: true },
  { re: /\b(cs ?2|counter ?strike|csgo)\b/, en: 'CS2', sub: 'GlobalOffensive', fps: true },
  { re: /\bvalorant\b/, en: 'Valorant', sub: 'VALORANT', fps: true },
  { re: /\bwarzone\b/, en: 'Warzone', sub: 'CODWarzone', fps: true },
  { re: /\bapex\b/, en: 'Apex Legends', sub: 'apexlegends', fps: true },
  { re: /\bfortnite\b/, en: 'Fortnite', sub: 'FortNiteBR', fps: true },
];

/** Categoria, jogo e se é FPS, a partir do pedido (e do produto da cadeia). */
function assuntoDaComunidade(objetivo, cadeia = null) {
  const t = normalizar(`${objetivo} ${cadeia?.produto || ''}`);
  const categoria = CATEGORIA_EN.find((c) => c.pedido.test(t)) || null;
  const jogo = JOGOS.find((j) => j.re.test(t)) || null;
  const fps = Boolean(jogo?.fps) || /\b(fps|tiro|shooter\w*)\b/.test(t) || /\b(fps|tiro|shooter)\b/.test(normalizar(cadeia?.tipoDeUso || ''));
  const jogando = Boolean(jogo) || fps || USO_JOGO.test(t);
  return { categoria, jogo, fps, jogando };
}

/**
 * Bateria de buscas na comunidade montada pelo código (Etapa C): várias
 * consultas por fonte, de ângulos diferentes — "best IEM for PUBG",
 * "IEM FPS footsteps imaging", o subreddit do jogo e o da categoria, Clube
 * do Hardware e Adrenaline em português com variações. Categoria fora do
 * dicionário → lista vazia (o chamador usa a descoberta antiga).
 */
function bateriaDaComunidade({ objetivo, cadeia = null, config = {}, maximo = 8, doModelo = [] }) {
  const { categoria, jogo, fps, jogando } = assuntoDaComunidade(objetivo, cadeia);
  const ativas = new Set(fontesDaComunidade(config).map((f) => f.dominio));
  const tem = (d) => ativas.has(d);
  // 14/10: as buscas que o MODELO escreveu no plano vêm primeiro; os moldes
  // abaixo só completam. O código só confere que a busca é do assunto (tem
  // palavra do pedido ou da categoria) e escolhe o fórum pela língua.
  const doPedido = new Set(normalizar(`${objetivo} ${categoria ? [...categoria.en, ...categoria.pt].join(' ') : ''} ${cadeia?.produto || ''}`).split(' ').filter((p) => p.length >= 3));
  const ingles = (q) => /\b(the|best|for|with|under|which|good|recommend\w*|budget)\b/i.test(q) && !/[ãõçáéíóúâêà]/i.test(q);
  const forunsPt = ['clubedohardware.com.br', 'forum.adrenaline.com.br'].filter((d) => categoria && tem(d));
  let vez = 0;
  const domModelo = doModelo
    .filter((q) => normalizar(q).split(' ').some((p) => doPedido.has(p)))
    .map((q) => {
      if (ingles(q) || !forunsPt.length) return tem('reddit.com') ? { consulta: `site:reddit.com ${q}`, idioma: 'all', dominio: 'reddit.com', doModelo: true } : null;
      const dominio = forunsPt[vez++ % forunsPt.length];
      return { consulta: `site:${dominio} ${q}`, idioma: 'pt-BR', dominio, doModelo: true };
    })
    .filter(Boolean);
  if (!categoria) return domModelo.slice(0, maximo);
  const [en, en2] = categoria.en;
  const [pt, pt2] = categoria.pt;
  const usoEn = jogo ? jogo.en : fps ? 'FPS' : jogando ? 'gaming' : '';
  // no subreddit da CATEGORIA (r/iems) quase ninguém escreve "PUBG": o ângulo é "FPS gaming"
  const usoSub = fps ? 'FPS gaming' : usoEn;
  const usoPt = jogo ? `${jogo.en.toLowerCase()}${fps ? ' fps' : ''}` : fps ? 'jogos fps' : jogando ? 'jogos' : '';
  const tec = categoria.audio && fps ? 'footsteps imaging soundstage' : categoria.audio ? 'sound' : '';
  const r = (q) => ({ consulta: `site:reddit.com ${q}`.replace(/\s+/g, ' ').trim(), idioma: 'all', dominio: 'reddit.com' });
  const f = (dominio, q) => ({ consulta: `site:${dominio} ${q}`.replace(/\s+/g, ' ').trim(), idioma: 'pt-BR', dominio });
  const candidatas = [
    ...domModelo,
    // uma de cada fonte primeiro (diversidade já na 1ª leva), depois os outros ângulos
    // "best IEM for recommendation" (sem uso) só quando o modelo não escreveu as buscas dele
    tem('reddit.com') && (usoEn || !domModelo.length) && r(`best ${en} for ${usoEn || 'recommendation'}`),
    tem('clubedohardware.com.br') && f('clubedohardware.com.br', `${pt} ${usoPt}`),
    tem('forum.adrenaline.com.br') && f('forum.adrenaline.com.br', `${pt} ${usoPt}`),
    tem('reddit.com') && fps && r(`${en} for FPS ${tec}`),
    tem('reddit.com') && jogo && r(`r/${jogo.sub} best ${en}`),
    tem('reddit.com') && r(`r/${categoria.subs[0]} ${en} ${usoSub}`),
    tem('reddit.com') && categoria.subsPt[0] && r(`r/${categoria.subsPt[0]} ${pt} ${usoPt || ''}`),
    tem('clubedohardware.com.br') && f('clubedohardware.com.br', `${pt2} ${jogo ? jogo.en : usoPt}`),
    tem('reddit.com') && categoria.subs[1] && r(`r/${categoria.subs[1]} ${en2} ${usoSub}`),
    // 14/10: era "IEM gaming" até num pedido de música
    tem('head-fi.org') && categoria.audio && f('head-fi.org', `${en} ${jogando || fps ? `gaming ${fps ? 'FPS' : ''}` : 'recommendation'}`),
    tem('reddit.com') && categoria.subs[2] && r(`r/${categoria.subs[2]} ${en} ${usoSub}`),
  ].filter(Boolean);
  const vistas = new Set();
  return candidatas
    .map((q) => ({ ...q, consulta: semPreposicaoPendurada(q.consulta), idioma: q.dominio === 'head-fi.org' ? 'all' : q.idioma }))
    .filter((q) => (vistas.has(normalizar(q.consulta)) ? false : vistas.add(normalizar(q.consulta))))
    .slice(0, maximo);
}

const ehTopico = (e) => /^T[ÓO]PICO (DO REDDIT|DE F[ÓO]RUM)/i.test(String(e.bruto || e.texto || '').split('\n')[0]);

/**
 * Tópicos da comunidade que valem a extração, do mais relevante pro menos:
 * título/post da categoria pedida e do uso, e que pedem indicação. Tópico de
 * "fone estilo AirPod" ou "bluetooth sem delay" fica no fim (14º teste real).
 */
function selecionarTopicos(entradas, { objetivo = '', termos = TERMOS_JOGO, maximo = 8, jaLidos = new Set() } = {}) {
  const cat = categoriaDoPedido(objetivo);
  const vistos = new Set();
  const lista = [];
  for (const e of entradas) {
    if (!ehTopico(e)) continue;
    const chave = String(e.url || '').replace(/[#?].*$/, '');
    if (!chave || vistos.has(chave) || jaLidos.has(chave)) continue;
    vistos.add(chave);
    const ctx = contextoDoTopico(e, termos);
    const cabeca = normalizar(`${e.titulo || ''} ${String(e.bruto || '').split('\n').slice(0, 3).join(' ')}`);
    const daCategoria = cat ? cabeca.split(' ').some((p) => cat.has(p)) : true;
    const comentarios = comentariosDe(e).filter((c) => !c.pergunta).length;
    if (!comentarios) continue;
    const nota = (daCategoria ? 2 : 0) + (ctx.doUso ? 2 : 0) + (ctx.pedeIndicacao ? 1 : 0) + Math.min(comentarios, 20) / 20;
    lista.push({ e, chave, nota, ctx });
  }
  return lista.sort((a, b) => b.nota - a.nota).slice(0, maximo);
}

/** Comentários numerados pra extração (os mais votados primeiro, como o leitor já entrega). */
function comentariosNumerados(e, maximo = 30) {
  return comentariosDe(e)
    .filter((c) => !c.pergunta && c.texto.length >= 2)
    .slice(0, maximo)
    .map((c, i) => ({ n: i + 1, texto: c.texto.slice(0, 280), votos: c.votos, fonte: c.fonte, integral: c.texto }));
}

function perguntaDoTopico(e) {
  const linhas = String(e.bruto || '').split('\n');
  const titulo = (e.titulo || linhas[0] || '').replace(/^T[ÓO]PICO (DO REDDIT|DE F[ÓO]RUM)\s*(\([^)]*\))?\s*:?\s*/i, '');
  const post = (linhas.find((l) => /^(POST|PERGUNTA):/.test(l)) || '').replace(/^(POST|PERGUNTA):\s*/, '');
  return `${titulo}${post ? ` — ${post}` : ''}`.slice(0, 400);
}

/**
 * Lê "- Truthear Hexa | 3" e confere no comentário: o nome TEM de estar
 * escrito no comentário apontado (ou, se o número veio errado, em algum
 * comentário do tópico). Nome que não está em nenhum → inventado, sai.
 */
function lerProdutosDoTopico(texto, comentarios) {
  const saida = [];
  if (/^\s*nenhum/i.test(String(texto || ''))) return saida;
  for (const linha of String(texto || '').split('\n')) {
    if (!/\|/.test(linha) && !/^\s*[-*•]/.test(linha)) continue;
    const [bruto, ref = ''] = linha.split('|');
    const nome = limparItem(bruto)
      .replace(/\*\*/g, '')
      .replace(/\s*[(:].*$/, '')
      .replace(/\s+(?:\+|com|with|&)\s+.*$/i, '')
      .trim();
    if (nome.length < 2 || nome.length > 50 || /^(nenhum|nenhuma|none)$/i.test(nome)) continue;
    const nums = [...String(ref).matchAll(/\d+/g)].map((m) => Number(m[0]));
    let achados = nums.map((n) => comentarios.find((c) => c.n === n)).filter((c) => c && mencionaNome(normalizar(c.integral), nome));
    if (!achados.length) achados = comentarios.filter((c) => mencionaNome(normalizar(c.integral), nome)).slice(0, 2);
    for (const c of achados) saida.push({ nome, comentario: c });
  }
  return saida;
}

// Prefixo de loja no nome ("Linsoul Simgot EM6L" no 13º teste real)
const PREFIXO_DE_LOJA = /^(linsoul|hifigo|hifi go|amazon|aliexpress|shopee|mercado livre|audio46|drop|apos audio|shenzhen audio|kinboofi)\s+/i;

function distancia(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

/**
 * Nome canônico (Etapa C): tira prefixo de loja e corrige a grafia da marca
 * pela forma mais comum no material ("Thrutear" → "Truthear", 13º teste).
 * Devolve Map(original → canônico).
 */
function canonizarNomes(nomes, material = '') {
  const texto = ` ${normalizar(material)} `;
  const marcas = new Map();
  const semLoja = nomes.map((n) => String(n).replace(PREFIXO_DE_LOJA, '').trim());
  for (const n of semLoja) {
    const m = normalizar(n).split(' ')[0];
    if (m) marcas.set(m, (marcas.get(m) || 0) + 1 + (texto.split(` ${m} `).length - 1));
  }
  const mapa = new Map();
  nomes.forEach((original, i) => {
    let nome = semLoja[i];
    const partes = nome.split(/\s+/);
    const m = normalizar(partes[0]);
    if (m.length >= 5) {
      const melhor = [...marcas.entries()]
        .filter(([b, c]) => b !== m && c > (marcas.get(m) || 0) && distancia(b, m) <= 2 && b.length >= 5)
        .sort((a, b) => b[1] - a[1])[0];
      if (melhor) {
        // mantém a caixa que o material usa pra marca certa
        const re = new RegExp(`\\b${melhor[0]}\\b`, 'i');
        const grafia = (String(material).match(re) || [melhor[0]])[0];
        partes[0] = /^[a-z]/.test(grafia) ? grafia[0].toUpperCase() + grafia.slice(1) : grafia;
        nome = partes.join(' ');
      }
    }
    mapa.set(original, nome);
  });
  return mapa;
}

/**
 * Extração por tópico (Etapa C): uma chamada curta por tópico relevante; o
 * código confere o nome no comentário, decide o tom (recomenda / critica /
 * pergunta / menção) e grava no livro de evidências. Devolve os nomes que
 * alguém RECOMENDOU e o resumo por tópico (pro registro).
 */
async function extrairDaComunidade({ topicos, chamarModelo, livro, termos, produto = 'produtos' }) {
  const recomendados = [];
  const porTopico = [];
  for (const { e, ctx } of topicos) {
    const comentarios = comentariosNumerados(e);
    if (!comentarios.length) continue;
    const resposta = await chamarModelo(prompts.pedidoDeProdutosDoTopico({ produto, pergunta: perguntaDoTopico(e), comentarios }), { tipo: 'produtos-do-topico', numPredict: 220 });
    const achados = lerProdutosDoTopico(resposta, comentarios);
    const nomesDoTopico = [];
    for (const { nome, comentario } of achados) {
      const tom = tomDoComentario(comentario.integral, termos, nome, ctx);
      if (tom === 'pergunta') continue;
      const n = normalizar(comentario.integral);
      const tipo = tom === 'recomenda' ? 'recomendacao' : tom === 'critica' ? 'critica' : 'mencao';
      livro.adicionar({
        tipo,
        produto: nome,
        url: e.url || '',
        fonte: comentario.fonte,
        trecho: comentario.integral,
        votos: comentario.votos,
        tom,
        doUso: falaDoUso(n, termos) || ctx.doUso,
        tecnico: TECNICO.test(n),
        origem: 'comunidade',
      });
      nomesDoTopico.push(`${nome} (${tipo}${comentario.votos ? `, ${comentario.votos} votos` : ''})`);
      if (tipo === 'recomendacao') recomendados.push(nome);
    }
    porTopico.push({ url: e.url || '', titulo: perguntaDoTopico(e).slice(0, 120), nomes: nomesDoTopico });
  }
  return { recomendados, porTopico };
}

/* ------------------------------ 3. consultas ------------------------------ */

const criteriosPorPeso = (criterios) =>
  [...criterios].sort((a, b) => (PESOS[b.peso] || 1) - (PESOS[a.peso] || 1));

/**
 * Pesquisa POR PRODUTO (8º teste real, 2026-09-25, pedido do Davi): a busca
 * única "nome + 2 critérios + review" (ex.: "KZ EDX PRO Gamer cancelamento
 * de som ambiente compatibilidade review") devolvia loja e anúncio, e a
 * matriz dependia dos critérios que o 7B inventou antes de ler qualquer
 * coisa. O caminho que uma pessoa faz: achou o nome → lê a FICHA TÉCNICA →
 * lê o que a COMUNIDADE diz (Reddit, com muita conversa sobre fone pra jogo,
 * PUBG inclusive). Duas buscas por finalista, uma de cada.
 */
function consultaDeFicha(nome, rotulo = '') {
  return `${nome} ${rotulo} especificações técnicas`.replace(/\s+/g, ' ').trim();
}

/** Opinião de quem usou: tópicos do Reddit sobre o produto, sem filtro de idioma (muito do que importa é em inglês). */
function consultaDeComunidade(nome) {
  return `site:reddit.com ${nome}`;
}

/** Busca antiga (nome + dois critérios de maior peso) — hoje só nas lacunas e nos testes. */
function consultaDeFinalista(nome, criterios) {
  const termos = criteriosPorPeso(criterios)
    .slice(0, 2)
    .map((c) => c.termos[0] || c.nome);
  return `${nome} ${termos.join(' ')} review`.replace(/\s+/g, ' ').trim();
}

/* ------------------------------ 4. matriz ------------------------------ */

function frases(texto) {
  return String(texto || '')
    // revisão v6: comentários de tópico colados na mesma linha ("- [1 votos] a … - [3 votos] b") viram frases separadas
    .split(/(?<=[.!?])\s+|\n+|\s+(?=-\s\[\d+ votos?\]\s)/)
    .map((f) => f.trim())
    .filter((f) => f.length > 15);
}

/** O trecho fala deste critério? Termo inteiro, ou o radical nos termos longos. */
// revisão v6: o radical de "imaging" (imagin) pegava "use your imagination" e
// "imaginei que teria mais graves" como posicionamento
const FALSO_RADICAL = /\b(imagination|imagine|imagined|imagina\w*|imagine\w*|imagino)\b/g;
function citaCriterio(trechoNormalizado, criterio) {
  trechoNormalizado = trechoNormalizado.replace(FALSO_RADICAL, ' ');
  return criterio.termos.some((termo) => {
    const t = normalizar(termo);
    if (!t) return false;
    if (t.includes(' ')) return trechoNormalizado.includes(t);
    const radical = t.length > 6 ? t.slice(0, 6) : t;
    return ` ${trechoNormalizado}`.includes(` ${radical}`);
  });
}

/**
 * Matriz finalista × critério. Evidência de uma célula = frase do material
 * que cita a opção e um termo do critério — ou a frase seguinte à que cita a
 * opção (o site costuma nomear o produto numa frase e avaliar na próxima:
 * "O Chu 2 custa R$ 150. O palco sonoro é estreito, mas o posicionamento…").
 * Continua sendo comparação de texto, mas agora POR CÉLULA: "fone" e "PUBG"
 * aparecerem no material não cobrem mais "conforto do finalista B".
 */
// Frase sobre a COMPRA, não sobre o produto (6º e 7º testes reais): "chegou
// com um pequeno atraso na entrega" virou evidência de "atraso do som" do
// KZ ZSN PRO — duas vezes — e o redator escreveu "atraso baixo". Pedir ao
// juiz pra separar os sentidos não bastou (o 7B aceitou "tem um pequeno
// atraso"). Só vale pra critério que não é, ele mesmo, sobre entrega/loja.
// revisão v6: política de devolução em inglês ("For Factory Sealed Products", "can only be returned") virou "isolamento" do Simgot e do Moondrop
const FRASE_DE_LOJA = /\b(entrega|entregue|entregou|frete|envio|enviado|enviou|correios|rastreio|rastreamento|vendedor|vendedora|chegou|chegaram|embalagem|reembolso|devolucao|devolvi|returned|return policy|returns policy|refunds?|factory sealed|sealed products?|shipping|warranty claim)\b/;

/**
 * Cita a opção NA FRASE, com o rigor da matriz (revisão v6): o nome inteiro,
 * ou os tokens em ordem e quase juntos — sem palavra de categoria no meio.
 * "HyperX Cloud Earbuds II" tem todos os tokens do "HyperX Cloud II", mas é
 * outro produto (o earbud da marca); em `mencionaNome` ele passava.
 */
function citaNaFrase(trechoNormalizado, nome) {
  const alvo = normalizar(nome);
  if (!alvo) return false;
  if (` ${trechoNormalizado} `.includes(` ${alvo} `)) return true;
  if (!mencionaNome(trechoNormalizado, nome)) return false;
  const tokens = tokensDoNome(nome);
  const palavras = trechoNormalizado.split(' ');
  for (let ini = 0; ini < palavras.length; ini += 1) {
    if (palavras[ini] !== tokens[0]) continue;
    let pos = ini;
    let ok = true;
    for (const t of tokens.slice(1)) {
      const prox = palavras.indexOf(t, pos + 1);
      if (prox < 0 || prox - pos > 2 || palavras.slice(pos + 1, prox).some((p) => GENERICO.has(p))) {
        ok = false;
        break;
      }
      pos = prox;
    }
    if (ok) return true;
  }
  return false;
}

function montarMatriz({ finalistas, criterios, entradas, conhecidos = [] }) {
  const celulas = new Map();
  const usadas = new Set();
  const chave = (c, k) => `${c}\u0000${k}`;
  for (const f of finalistas) for (const k of criterios) celulas.set(chave(f.nome, k.nome), { dominios: new Set(), fontes: new Set(), trechos: [] });

  // revisão v6: outros produtos conhecidos (lista larga + finalistas) de cada opção
  const todos = [...new Set([...(conhecidos || []), ...finalistas.map((f) => f.nome)])];
  const outrosDe = new Map(finalistas.map((f) => [f.nome, outrosProdutos(f.nome, todos)]));
  for (const entrada of entradas) {
    const dominio = dominioDe(entrada);
    const lista = frases(semComentariosDeBot(entrada.bruto || entrada.texto));
    const normalizadas = lista.map(normalizar);
    // página lida PRA uma opção (ficha, reddit, lacuna): quem comenta num
    // tópico "KZ EDX Pro para jogos" escreve "o palco é ótimo", sem repetir
    // o nome — a frase vale para a opção, desde que não cite outra finalista
    const donaDaPagina = entrada.opcao ? finalistas.find((f) => f.nome === entrada.opcao) : null;
    for (let i = 0; i < lista.length; i += 1) {
      for (const f of finalistas) {
        const cita = citaNaFrase(normalizadas[i], f.nome);
        // revisão v6: frase da página da opção que fala de OUTRO produto (não só
        // de outra finalista) não é dela — "O JBL C50HI se posiciona..." numa
        // lista lida pra lacuna do QKZ AK6 virou "posicionamento" do QKZ
        const outros = outrosDe.get(f.nome);
        // frase com o token do modelo da opção ("O EM6L é o sucessor do Simgot EM5") fala dela —
        // a não ser que o token esteja dentro do nome de OUTRO produto ("HyperX Cloud Earbuds II" × Cloud II)
        const modelo = tokensDoModelo(f.nome);
        const doModelo =
          modelo.some((t) => ` ${normalizadas[i]} `.includes(` ${t} `)) &&
          !nomesNaFrase(lista[i]).some((a) => !ehDaOpcao(a, f.nome) && tokensDoNome(a).some((t) => modelo.includes(t)));
        // frase sem nome logo depois de uma sobre OUTRO produto continua falando dele
        // ("…o HyperX Cloud Earbuds II permite… Sua qualidade de som é excepcional")
        const herdaOutro =
          i > 0 && !doModelo && !citaNaFrase(normalizadas[i - 1], f.nome) &&
          (finalistas.some((o) => o !== f && mencionaNome(normalizadas[i - 1], o.nome)) || falaDeOutroProduto(lista[i - 1], f.nome, outros));
        const daPagina =
          !cita && donaDaPagina === f && !herdaOutro && !finalistas.some((o) => o !== f && mencionaNome(normalizadas[i], o.nome)) && (doModelo || !falaDeOutroProduto(lista[i], f.nome, outros));
        if (!cita && !daPagina) continue;
        const janela = daPagina ? [i] : [i, i + 1].filter((j) => j < lista.length);
        for (const k of criterios) {
          // frase seguinte que é sobre OUTRA finalista não vale (9º teste real:
          // "O JBL Quantum 50 ... falta um case. O KZ ZSN PRO 2 se destaca pelo
          // isolamento" virou o isolamento do JBL) — desde a revisão v6, nem
          // sobre outro produto qualquer
          const deOutra = (x) => x !== i && (finalistas.some((o) => o !== f && mencionaNome(normalizadas[x], o.nome)) || falaDeOutroProduto(lista[x], f.nome, outros));
          // pergunta não é evidência ("É realmente tão bom assim?")
          const pergunta = (x) => /\?\s*$/.test(lista[x]);
          const j = janela.find(
            (x) => citaCriterio(normalizadas[x], k) && !deOutra(x) && !pergunta(x) && !(FRASE_DE_LOJA.test(normalizadas[x]) && !FRASE_DE_LOJA.test(normalizar(k.nome)))
          );
          if (j === undefined) continue;
          const celula = celulas.get(chave(f.nome, k.nome));
          celula.dominios.add(dominio);
          // Etapa E: fonte INDEPENDENTE (tópico conta por tópico) pro status da célula
          celula.fontes.add(chaveDeFonte(entrada.url || dominio));
          usadas.add(entrada);
          if (celula.trechos.length < 2 && !celula.trechos.some((t) => t.dominio === dominio)) {
            const texto = (j === i ? lista[i] : `${lista[i]} ${lista[j]}`).slice(0, 240);
            celula.trechos.push({ texto, dominio, url: entrada.url || '' });
          }
        }
      }
    }
  }

  let pesoTotal = 0;
  let pesoCoberto = 0;
  const lacunas = [];
  for (const f of finalistas) {
    for (const k of criterios) {
      const peso = PESOS[k.peso] || 1;
      pesoTotal += peso;
      if (celulas.get(chave(f.nome, k.nome)).dominios.size) pesoCoberto += peso;
      else lacunas.push({ candidato: f.nome, criterio: k.nome, peso });
    }
  }
  return {
    celula: (c, k) => celulas.get(chave(c, k)),
    cobertura: pesoTotal ? pesoCoberto / pesoTotal : 0,
    lacunas,
    entradasUsadas: [...usadas],
  };
}

/**
 * Buscas de lacuna: uma por finalista que ainda tem célula vazia, com os
 * termos dos (até dois) critérios mais pesados que faltaram — cobre várias
 * células numa busca só. Finalistas na ordem de ranking.
 */
/**
 * Termo de critério limpo pra ir numa busca (Etapa B, 14º teste real): "memória
 * GDDR6X ou superior" virou busca e trouxe "o que é ensino superior" e a
 * Wikipédia "Superior". Sai parêntese, "ou superior/ou mais/ou melhor", e
 * conectivo solto; fica no máximo 3 palavras.
 */
// Revisão v3 (29/09): o `\b` do JavaScript trata "ã", "ç", "é" como fim de
// palavra, então `\b(o|a|e)\b` apagava o "o" final de "visão", "gestão",
// "separação" — as buscas saíram "visã mapa gestã respiraçã". Agora o termo
// é quebrado em PALAVRAS (separador = espaço/pontuação) e a palavra inteira
// é comparada com a lista; acento nunca é fronteira.
const PALAVRAS_VAZIAS_DE_BUSCA = new Set(['ou', 'or', 'e', 'and', 'de', 'do', 'da', 'dos', 'das', 'com', 'with', 'para', 'pra', 'for', 'the', 'o', 'a', 'os', 'as', 'em', 'no', 'na', 'of', 'in']);
const COMPARATIVO_SOLTO = new Set(['superior', 'mais', 'melhor', 'maior', 'acima', 'better', 'higher', 'more']);
function limparTermoDeBusca(termo) {
  const palavras = String(termo || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,;:/]+/)
    .filter(Boolean);
  const saida = [];
  for (let i = 0; i < palavras.length; i += 1) {
    const p = palavras[i].toLowerCase();
    // "ou superior", "or better": o par inteiro sai
    if ((p === 'ou' || p === 'or') && COMPARATIVO_SOLTO.has(String(palavras[i + 1] || '').toLowerCase())) {
      i += 1;
      continue;
    }
    if (PALAVRAS_VAZIAS_DE_BUSCA.has(p)) continue;
    saida.push(palavras[i]);
  }
  return saida.slice(0, 3).join(' ');
}

function consultasDeLacuna({ matriz, finalistas, criterios, maximo, objetivo = '' }) {
  const consultas = [];
  for (const f of finalistas) {
    if (consultas.length >= maximo) break;
    const faltam = criteriosPorPeso(criterios).filter((k) => matriz.lacunas.some((l) => l.candidato === f.nome && l.criterio === k.nome));
    if (!faltam.length) continue;
    const termos = faltam.slice(0, 2).map((k) => limparTermoDeBusca(k.termos[0] || k.nome)).filter(Boolean);
    consultas.push(`${f.nome} ${rotuloDaCategoria(objetivo, f.nome)} ${termos.join(' ')}`.replace(/\s+/g, ' ').trim());
  }
  return consultas;
}

/* ------------------------------ 5b. julgamento das células ------------------------------ */

/**
 * Lê a resposta de `pedidoDeJulgamento`: uma linha por critério,
 * "critério: veredito (n)" ou "critério: sem dados". Critério casa pelo
 * nome (sem acento, prefixo ou contido). Número de trecho que não pertence
 * àquele critério invalida a linha — o modelo estaria citando trecho de
 * outra célula.
 */
/**
 * Veredito que não é frase sobre a opção (6º teste real, 2026-09-25): o
 * modelo 7B devolveu "28913839", "727", ",", "- Bose QuietComfort Ultra 2"
 * e "kabum.com.br - TH50" como veredito — e isso entrou na tabela como fato.
 * Número solto, pontuação, item de lista (nome de outro produto) ou
 * endereço de site não é veredito: a linha é ignorada e a célula fica como
 * se o modelo nem tivesse julgado (trechos crus, comportamento antigo).
 */
function vereditoSemSentido(veredito) {
  const v = String(veredito || '').trim();
  if (!v) return false; // vazio já vira null (sem dados) em lerJulgamento
  if (/^[-–—*•]/.test(v)) return true;
  if (/\b[\w-]+\.(com|br|net|org|io)\b/i.test(v)) return true;
  // 8º teste real: "Trecho 2, Trecho 3" — o número do trecho no lugar do que ele diz
  if (/^(?:\(?\s*trechos?\s*\d+\s*\)?\s*(?:,|e|\/)?\s*)+$/i.test(v)) return true;
  return !/[A-Za-zÀ-ÿ]{4,}/.test(v);
}

function lerJulgamento(texto, criterios, numeracao) {
  const vereditos = new Map();
  for (const bruta of String(texto || '').split('\n')) {
    const linha = limparItem(bruta).replace(/\*\*/g, '');
    const m = /^([^:]{2,80}):\s*(.+)$/.exec(linha);
    if (!m) continue;
    const alvo = normalizar(m[1]);
    const k = criterios.find((c) => {
      const n = normalizar(c.nome);
      return alvo === n || alvo.startsWith(n) || n.startsWith(alvo);
    });
    if (!k || vereditos.has(k.nome)) continue;
    let veredito = m[2].trim();
    if (/^sem\s+dados/i.test(veredito)) {
      vereditos.set(k.nome, null);
      continue;
    }
    const refs = [...veredito.matchAll(/\((\d+)(?:\s*,\s*(\d+))*\)/g)].flatMap((r) => r.slice(1).filter(Boolean).map(Number));
    if (refs.some((r) => numeracao.get(r) !== k.nome)) {
      vereditos.set(k.nome, null);
      continue;
    }
    veredito = veredito.replace(/\s*\((\d+\s*,?\s*)+\)\s*/g, ' ').trim();
    // 11º teste real: "Trechos 1-2 (sem dados)", "Trechos 7-10 (Conexão sem
    // fio, ...)" — tira o "Trechos N" do começo e o parêntese em volta; o que
    // sobra "sem dados" é sem dados (contava como célula com evidência)
    veredito = veredito.replace(/^\(?\s*trechos?\s*[\d\s,e–-]+\)?\s*[:–-]?\s*/i, '').trim();
    const entre = /^\((.*)\)\.?$/.exec(veredito);
    if (entre) veredito = entre[1].trim();
    // 14º teste real: "(X-Ray Hearing permite ouvir sons…) sem dados" — o
    // "sem dados" no FIM (ou no meio) também é sem dados; contava como
    // evidência e o Arctis 1 ficou com "4 de 4 critérios de peso alto"
    if (/^sem\s+dados\b/i.test(veredito) || /\bsem\s+dados\b/i.test(veredito)) {
      vereditos.set(k.nome, null);
      continue;
    }
    veredito = veredito.slice(0, 160);
    if (vereditoSemSentido(veredito)) continue;
    // eco da linha de formato ("o que os trechos dizem DESTA opção…")
    if (ecoDaInstrucao(veredito, ['o que os trechos dizem DESTA opção nesse critério, em até 12 palavras (número do trecho)'])) continue;
    vereditos.set(k.nome, veredito || null);
  }
  return vereditos;
}

/**
 * Uma chamada por finalista: o modelo diz o que os trechos de cada célula
 * afirmam DESTA opção. Célula julgada "sem dados" deixa de contar como
 * coberta (os trechos continuam no material do redator, mas não viram fato
 * na tabela). Critério que o modelo nem mencionou mantém o trecho cru — é
 * o comportamento antigo, sem piorar nada.
 */
// frase de ficha técnica: número com unidade ou termo de especificação
const FRASE_TECNICA = new RegExp(
  '\\d\\s?(mm|hz|khz|ohm|ohms|db|mah|ms|gb|tb|ghz|mhz|w|g|kg|h|horas|polegadas|pol)\\b|' +
    '\\b(driver|drivers|impedancia|sensibilidade|frequencia|resposta de|conector|cabo|bluetooth|codec|microfone|' +
    'processador|memoria|tela|bateria|peso|dimensoes|material|conexao)\\b'
);
// frase de opinião de quem usou (em português ou inglês — o Reddit mistura)
const FRASE_DE_OPINIAO =
  /\b(eu|meu|minha|comprei|uso|usei|tenho|achei|gostei|recomendo|prefiro|troquei|joguei|jogo|i|my|me|bought|use|used|own|love|recommend|prefer|played|imo|honestly)\b/;

/**
 * Até `maximo` frases das páginas lidas PARA esta opção num tipo de busca
 * ('ficha' ou 'comunidade'), Reddit/fórum primeiro. É o que o juiz resume
 * em "ficha técnica:" e "comunidade:".
 */
function trechosDoTipo(entradas, nome, tipo, maximo = 6) {
  const alvo = (e) => e.opcao === nome && e.tipoBusca === tipo;
  const forum = (e) => /reddit|forum|forun|clube|comunidade/.test(dominioDe(e));
  const lista = entradas.filter(alvo).sort((a, b) => Number(forum(b)) - Number(forum(a)));
  const saida = [];
  const vistos = new Set();
  for (const e of lista) {
    for (const fr of frases(e.bruto || e.texto)) {
      const n = normalizar(fr);
      if (vistos.has(n) || FRASE_DE_LOJA.test(n) || fr.length > 400) continue;
      if (tipo === 'ficha' ? !FRASE_TECNICA.test(n) : fr.length < 25 || !FRASE_DE_OPINIAO.test(n)) continue;
      vistos.add(n);
      saida.push({ texto: fr.slice(0, 220), dominio: dominioDe(e) });
      if (saida.length >= maximo) return saida;
    }
  }
  return saida;
}

/**
 * Resto do formato pedido no prompt que o 7B copiou pro resumo (14º teste
 * real: "a 15 (Conexão com fio: Sim; Microfone: Sim) em 20 palavras",
 * "16 GB GDDR7 VRAM (números dos trechos)"). Sem conteúdo que sobre → null.
 */
// Revisão v3 (29/09): a "Ficha" do Kefine e do QKZ saiu "só dados técnicos
// dos trechos de FICHA TÉCNICA (tipo de conexão, números com unidade)," — o
// 7B devolveu a própria linha de formato do prompt. Texto cujas palavras são
// quase todas da instrução é eco, não resumo.
const INSTRUCOES_DO_RESUMO = [
  'só dados técnicos dos trechos de FICHA TÉCNICA (tipo de conexão, números com unidade), em até 20 palavras (números dos trechos)',
  'o que quem usou relata nos trechos de COMUNIDADE (prós e contras), em até 20 palavras (números dos trechos)',
];
function ecoDaInstrucao(texto, instrucoes = INSTRUCOES_DO_RESUMO) {
  const palavras = normalizar(texto).split(' ').filter((p) => p.length > 2);
  if (palavras.length < 3) return false;
  return instrucoes.some((ins) => {
    const conjunto = new Set(normalizar(ins).split(' '));
    return palavras.filter((p) => conjunto.has(p)).length / palavras.length >= 0.6;
  });
}

function semRestoDoPrompt(texto) {
  if (!texto) return null;
  if (ecoDaInstrucao(texto)) return null;
  let t = String(texto)
    .replace(/\(?\s*n[uú]meros? dos trechos\s*\)?/gi, ' ')
    .replace(/\bem (at[eé] )?\d+ palavras\b/gi, ' ')
    .replace(/^\s*(?:a|at[eé])\s+\d+\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const entre = /^\((.*)\)\.?$/.exec(t);
  if (entre) t = entre[1].trim();
  return /[A-Za-zÀ-ÿ]{3,}/.test(t) ? t : null;
}

const RESUMO_FICHA = 'ficha técnica';
const RESUMO_COMUNIDADE = 'comunidade';

async function julgarCelulas({ matriz, finalistas, criterios, uso, chamarModelo, entradas = [] }) {
  const resumos = new Map();
  for (const f of finalistas) {
    const trechosPorCriterio = criterios.map((k) => ({ criterio: k.nome, trechos: matriz.celula(f.nome, k.nome)?.trechos || [] }));
    const ficha = trechosDoTipo(entradas, f.nome, 'ficha');
    const comunidade = trechosDoTipo(entradas, f.nome, 'comunidade');
    if (!trechosPorCriterio.some((c) => c.trechos.length) && !ficha.length && !comunidade.length) continue;
    const numeracao = new Map();
    let n = 0;
    for (const c of trechosPorCriterio) for (const _ of c.trechos) numeracao.set((n += 1), c.criterio); // eslint-disable-line no-unused-vars
    for (const _ of ficha) numeracao.set((n += 1), RESUMO_FICHA); // eslint-disable-line no-unused-vars
    for (const _ of comunidade) numeracao.set((n += 1), RESUMO_COMUNIDADE); // eslint-disable-line no-unused-vars
    const resposta = await chamarModelo(prompts.pedidoDeJulgamento({ opcao: f.nome, uso, trechosPorCriterio, ficha, comunidade }), {
      tipo: 'julgamento',
      numPredict: 400,
    });
    const extras = [];
    if (ficha.length) extras.push({ nome: RESUMO_FICHA });
    if (comunidade.length) extras.push({ nome: RESUMO_COMUNIDADE });
    const vereditos = lerJulgamento(resposta, [...criterios, ...extras], numeracao);
    const resumo = {};
    for (const [chave, trechos] of [[RESUMO_FICHA, ficha], [RESUMO_COMUNIDADE, comunidade]]) {
      const v = semRestoDoPrompt(vereditos.get(chave));
      vereditos.delete(chave);
      if (v) resumo[chave === RESUMO_FICHA ? 'ficha' : 'comunidade'] = { texto: v, dominios: [...new Set(trechos.map((t) => t.dominio))] };
    }
    if (resumo.ficha || resumo.comunidade) resumos.set(f.nome, resumo);
    for (const [criterio, veredito] of vereditos) {
      const celula = matriz.celula(f.nome, criterio);
      if (!celula) continue;
      if (veredito) celula.veredito = veredito;
      else if (celula.dominios.size) {
        celula.descartada = true;
        celula.dominios = new Set();
        celula.fontes = new Set();
      }
    }
  }
  deduzirAtrasoDaConexao({ matriz, finalistas, criterios, entradas });
  return { ...recalcularCobertura(matriz, finalistas, criterios), resumos };
}

/**
 * Atraso de fone COM FIO (9º teste real, 2026-09-25): o critério que decide
 * fone de jogo competitivo é o atraso, e ele saiu "sem dados" em 4 de 5
 * opções — mas a ficha técnica de três delas dizia "P2 (3,5 mm)" / "conector
 * P3". Fone com fio analógico não tem atraso de transmissão: dá pra deduzir
 * da ficha, sem o modelo. Só preenche célula VAZIA, só com ficha que fala de
 * conector/cabo e NÃO fala de Bluetooth/sem fio (fone híbrido fica de fora),
 * e o texto diz que é dedução.
 */
const CONEXAO_COM_FIO = /\b(p2|p3|3 5 ?mm|35mm|conector|plugue|cabo|com fio|wired)\b/;
const CONEXAO_SEM_FIO = /\b(bluetooth|sem fio|wireless|tws|2 4 ?ghz|dongle)\b/;
function deduzirAtrasoDaConexao({ matriz, finalistas, criterios, entradas }) {
  const k = criterios.find((c) => grupoDoCriterio(c.nome) === 0); // grupo atraso/latência
  if (!k) return;
  for (const f of finalistas) {
    const celula = matriz.celula(f.nome, k.nome);
    if (!celula || celula.dominios.size) continue;
    const fichas = entradas.filter((e) => e.opcao === f.nome && e.tipoBusca === 'ficha');
    const texto = fichas.map((e) => normalizar(textoDaEntrada(e))).join(' ');
    if (!CONEXAO_COM_FIO.test(texto) || CONEXAO_SEM_FIO.test(texto)) continue;
    celula.dominios = new Set(fichas.filter((e) => CONEXAO_COM_FIO.test(normalizar(textoDaEntrada(e)))).map(dominioDe));
    celula.veredito = 'com fio (conector na ficha técnica): sem atraso de transmissão — deduzido da conexão, não medido';
    celula.deduzido = true;
    celula.descartada = false;
  }
}

function recalcularCobertura(matriz, finalistas, criterios) {
  let pesoTotal = 0;
  let pesoCoberto = 0;
  const lacunas = [];
  for (const f of finalistas) {
    for (const k of criterios) {
      const peso = PESOS[k.peso] || 1;
      pesoTotal += peso;
      if (matriz.celula(f.nome, k.nome)?.dominios.size) pesoCoberto += peso;
      else lacunas.push({ candidato: f.nome, criterio: k.nome, peso });
    }
  }
  return { ...matriz, cobertura: pesoTotal ? pesoCoberto / pesoTotal : 0, lacunas };
}

/* ------------------------------ 6. plano da resposta ------------------------------ */

const ROTULO_PESO = { alto: 'peso alto', medio: 'peso médio', baixo: 'peso baixo' };

/**
 * O respaldo de uma opção, em palavras honestas (Etapa B, 14º teste real:
 * "citada como recomendação em 19 sites" era 11 sites editoriais, quase todos
 * vitrine, e 0 tópicos). Tópico que recomenda, crítica e site de review SOBRE
 * O USO — loja não conta, e o que é só menção não vira "recomendação".
 */
function respaldoDe(c) {
  const k = c.consenso || {};
  const partes = [];
  if (k.topicos) partes.push(`recomendada em ${k.topicos} tópico${k.topicos === 1 ? '' : 's'} da comunidade`);
  if (k.criticas) partes.push(`${k.criticas} crítica${k.criticas === 1 ? '' : 's'}`);
  if (k.editoriaisDoUso) partes.push(`citada em ${k.editoriaisDoUso} site${k.editoriaisDoUso === 1 ? '' : 's'} de review sobre o uso`);
  else if (k.editoriais) partes.push(`citada em ${k.editoriais} site${k.editoriais === 1 ? '' : 's'} (fora do uso pedido)`);
  else if (k.editoriais === undefined && c.dominios?.length) partes.push(`citada em ${c.dominios.length} site${c.dominios.length === 1 ? '' : 's'}`);
  if (!partes.length && k.mencoes) partes.push(`só mencionada em ${k.mencoes} tópico${k.mencoes === 1 ? '' : 's'}, sem recomendação`);
  if (!partes.length) partes.push(c.citadaPeloUsuario ? 'citada no seu pedido' : 'sem recomendação encontrada');
  return partes.join(', ');
}

/**
 * O texto que vai pro redator. Traz a estrutura pronta — critérios em ordem
 * de peso, opções, a evidência de cada célula com o site, o que faltou — e o
 * formato esperado. O redator continua livre pra escrever, mas não precisa
 * mais descobrir sozinho o que comparar com o quê.
 */
function planoDeResposta({ plano, finalistas, outros = [], matriz, quantidade = 0, mapa = null, hipoteses = [], comparacao = false }) {
  const criterios = criteriosPorPeso(plano.criterios);
  const linhas = [
    'PLANO DA RESPOSTA (montado pela pesquisa planejada — siga esta estrutura; os trechos vêm do material coletado):',
    `USO QUE DECIDE O "MELHOR": ${plano.uso}`,
    `CRITÉRIOS, EM ORDEM DE PESO: ${criterios.map((k, i) => `${i + 1}. ${k.nome} (${ROTULO_PESO[k.peso]})`).join(' · ')}`,
    // 2026-09-28: o porquê de cada critério (cadeia do uso + conhecimento lido)
    ...(criterios.some((k) => k.porque)
      ? [
          `COMO ESCOLHER${plano.tipoDeUso ? ` PARA ${String(plano.tipoDeUso).toUpperCase()}` : ''} (explique isto ao usuário numa seção curta "Como escolhi", um critério por linha):`,
          ...criterios.filter((k) => k.porque).map((k) => `  - ${k.nome}: ${k.porque}`),
        ]
      : []),
    `OPÇÕES COMPARADAS: ${finalistas
      .map((f) => `${f.nome} (${respaldoDe(f)})`)
      .join(' · ')}`,
    '',
    'EVIDÊNCIA POR OPÇÃO E CRITÉRIO:',
  ];
  for (const f of finalistas) {
    linhas.push(`${f.nome}:`);
    const motivo = f.consenso?.motivo;
    if (motivo) linhas.push(`  - POR QUE É RECOMENDADA (${motivo.dominio}${motivo.tipo === 'comunidade' ? ', comunidade' : ''}): "${motivo.texto}"`);
    for (const k of criterios) {
      const c = matriz.celula(f.nome, k.nome);
      if (!c || !c.dominios.size) {
        linhas.push(`  - ${k.nome}: SEM EVIDÊNCIA no material — escreva "sem dados" na tabela, não suponha`);
        continue;
      }
      const sites = [...c.dominios].slice(0, 3).join(', ');
      const st = c.status || statusDaCelula(c);
      const nFontes = c.fontes?.size || c.dominios.size;
      // com julgamento, vai o que os trechos afirmam DESTA opção (não o trecho cru)
      linhas.push(`  - ${k.nome} [${st}${st === STATUS.CORROBORADO ? `, ${nFontes} fontes` : ''}] (${sites}): ${c.veredito || c.trechos.map((t) => `"${t.texto}"`).join(' / ')}`);
    }
    // o que a ficha técnica e a comunidade dizem desta opção (resumo do juiz)
    const r = matriz.resumos?.get(f.nome) || {};
    linhas.push(
      r.ficha
        ? `  - FICHA TÉCNICA (${r.ficha.dominios.slice(0, 3).join(', ')}): ${r.ficha.texto}`
        : '  - FICHA TÉCNICA: não encontrada no material — não invente especificação'
    );
    linhas.push(
      r.comunidade
        ? `  - O QUE A COMUNIDADE DIZ (${r.comunidade.dominios.slice(0, 3).join(', ')}): ${r.comunidade.texto}`
        : '  - O QUE A COMUNIDADE DIZ: nada encontrado — não invente opinião de usuário'
    );
    // comentários de verdade, pra citar (Davi, 2026-09-28: "não mostra comentários dos usuários")
    const cits = f.consenso?.citacoes || [];
    if (cits.length) {
      linhas.push('  - O QUE OS USUÁRIOS DIZEM (cite 1 ou 2 destes EXATAMENTE como estão, entre aspas, com a fonte; traduza para o português se estiver em inglês e diga que é tradução):');
      for (const c of cits) linhas.push(`      "${c.texto}" (${c.fonte}${c.votos ? `, ${c.votos} votos` : ''}${c.tom === 'critica' ? ', crítica' : ''})`);
    }
  }
  const sitesDe = (o) => {
    const t = o.consenso?.topicos || 0;
    return `${o.dominios.length} site${o.dominios.length === 1 ? '' : 's'}${t ? `, ${t} tópico${t === 1 ? '' : 's'}` : ''}`;
  };
  const motivoCurto = (o) => (o.consenso?.motivo ? ` — "${o.consenso.motivo.texto.slice(0, 100)}"` : '');
  if (outros.length) {
    linhas.push(
      '',
      quantidade
        ? `OUTRAS OPÇÕES CITADAS NO MATERIAL (não pesquisadas a fundo), em ordem de consenso: ${outros
            .map((o) => `${o.nome} (${sitesDe(o)})${motivoCurto(o)}`)
            .join(', ')}`
        : `OUTRAS OPÇÕES CITADAS (menos fontes; mencione só de passagem): ${outros.map((o) => o.nome).join(', ')}`
    );
  }
  // 7º teste real: o redator escolheu como "melhor no geral" o Galaxy Buds FE,
  // SEM EVIDÊNCIA em nenhum critério de peso alto (atraso do som incluído —
  // e é um fone Bluetooth, pra jogo competitivo). A conta fica pronta aqui.
  const altos = criterios.filter((k) => k.peso === 'alto');
  if (altos.length && finalistas.length >= 2) {
    // Etapa E: o status de cada critério de peso alto, não "N de M" (uma
    // fonte não vale o mesmo que cinco)
    const placar = finalistas.map((f) => {
      const st = altos.map((k) => ({ k: k.nome, st: matriz.celula(f.nome, k.nome)?.status || statusDaCelula(matriz.celula(f.nome, k.nome)) }));
      return { nome: f.nome, n: st.filter((x) => VALOR_DO_STATUS[x.st] > 0).length, st };
    });
    linhas.push(
      '',
      'EVIDÊNCIA NOS CRITÉRIOS DE PESO ALTO (corroborado = 2+ fontes independentes; fonte única = 1; contraditório = fontes discordam):',
      ...placar.map((p) => `  ${p.nome}: ${p.st.map((x) => `${x.k} ${x.st}`).join(' · ')}`),
      placar.some((p) => p.n > 0)
        ? 'Na resposta direta, não aponte como "melhor" uma opção com 0 aqui; se escolher, diga em quais critérios de peso alto ela tem evidência.'
        : 'Nenhuma opção tem evidência nos critérios de peso alto: diga na resposta direta que a pesquisa não permite apontar a melhor com segurança, e o que decide a escolha.'
    );
  }
  linhas.push('', `COBERTURA DA PESQUISA: ${Math.round(matriz.cobertura * 100)}% das combinações opção × critério têm evidência.`);
  // ordem pela evidência (não pela quantidade de sites)
  if (finalistas.some((f) => f.notaFinal !== undefined)) {
    linhas.push(
      '',
      'ORDEM PELA EVIDÊNCIA (critérios com evidência a favor, pesados, + recomendação da comunidade para o uso; NÃO é número de sites):',
      ...finalistas.map(
        (f, i) =>
          `${i + 1}. ${f.nome} — ${f.positivosAltos || 0} critério(s) de peso alto com evidência a favor${
            f.status ? ` (${Object.values(f.status).filter((x) => x === STATUS.CORROBORADO).length} corroborado(s))` : ''
          }${f.consenso?.topicos ? `, recomendada em ${f.consenso.topicos} tópico(s) da comunidade` : ''}`
      ),
      `Na resposta direta, recomende ${finalistas[0].nome} (a 1ª desta ordem) e diga POR QUÊ com a evidência dos critérios e o que os usuários dizem — a não ser que o material mostre um problema sério nela; então explique.`
    );
  }
  if (comparacao) {
    linhas.push(
      '',
      'COMPARAÇÃO DE PRODUTOS NOMEADOS: priorize medições no uso real (ex.: FPS em jogos por resolução, testes práticos) sobre testes sintéticos (PassMark, G3D Mark, 3DMark, Geekbench); se citar um sintético, escreva "(teste sintético)". Dê a diferença em % quando houver os dois números.'
    );
  }
  // Fase B: o que o mapa do problema pensou ANTES de pesquisar, e o que o material disse disso
  if (hipoteses.length) {
    const rotulo = { confirmada: 'CONFIRMADA pelo material', derrubada: 'DERRUBADA pelo material', 'sem dados': 'SEM DADOS no material' };
    linhas.push(
      '',
      'HIPÓTESES PENSADAS ANTES DA PESQUISA (diga o que se confirmou; "sem dados" não é verdade nem mentira):',
      ...hipoteses.map(
        (h) => `- "${h.hipotese}": ${rotulo[h.veredito]}${h.fontes.length ? ` (${h.fontes.slice(0, 3).join(', ')})` : ''}${h.motivo ? ` — ${h.motivo}` : ''}`
      )
    );
  }
  if (mapa?.alternativas?.length) {
    linhas.push(
      '',
      `ALTERNATIVAS QUE O PEDIDO NÃO CITOU (uma linha cada, sem inventar modelo): ${mapa.alternativas
        .map((a) => (a.quando ? `${a.nome} — ${a.quando}` : a.nome))
        .join('; ')}`
    );
  }
  if (mapa?.armadilhas?.length) linhas.push('', `ARMADILHAS A AVISAR (se couber): ${mapa.armadilhas.join('; ')}`);
  const temMapa = hipoteses.length || mapa?.alternativas?.length || mapa?.armadilhas?.length;
  linhas.push(
    '',
    'FORMATO:',
    comparacao
      ? '1. Resposta direta em duas ou três linhas: qual você escolheria para o uso descrito, a diferença entre elas em números (%) e por quê — com um ponto de vista claro.'
      : '1. Resposta direta em duas ou três linhas: qual você escolheria para o uso descrito, e por quê.',
    // 9º teste real: as células saíram com a frase inteira do site copiada
    '2. Tabela com UMA LINHA POR CRITÉRIO e UMA COLUNA POR OPÇÃO; cada célula com no máximo 8 palavras, resumindo a evidência (nunca a frase do site copiada); célula sem evidência = "sem dados".',
    '3. Destaques de cada opção: o essencial da ficha técnica, o que a comunidade (Reddit, fóruns) diz, ponto forte e limitação — citando a fonte.',
    comparacao
      ? '4. Em que cenário cada uma vence (ex.: resolução, orçamento, uso), com o custo de cada ganho.'
      : '4. Qual escolher por cenário (ex.: melhor no geral, melhor custo-benefício, melhor para sessões longas).',
    '5. O que não foi possível confirmar na pesquisa.'
  );
  let item = 6;
  if (temMapa) {
    linhas.push(
      `${item}. Hipóteses e alternativas: o que a pesquisa confirmou ou derrubou (uma linha cada, com a fonte); alternativas e armadilhas em poucas linhas.`
    );
    item += 1;
  }
  if (quantidade) {
    const total = finalistas.length + outros.length;
    linhas.push(
      // 11º teste real: o redator repetiu os 5 finalistas como "outras opções"
      // em vez dos 5 seguintes — a lista numerada agora é montada pelo código
      // (listaNumerada) e anexada ao fim da resposta
      `${item}. O usuário pediu uma lista de ${quantidade}: NÃO escreva a lista numerada — o sistema anexa no fim da resposta a lista completa, na ordem de consenso, com as contagens de sites e tópicos. Não repita as opções da tabela como "outras opções".` +
        (total < quantidade ? ` O material só tem ${total} com respaldo: diga isso numa frase — não invente nome para completar.` : '')
    );
  }
  return linhas.join('\n');
}

/**
 * Lista "top N" montada pelo código (11º teste real): primeiro as opções
 * comparadas, depois as outras citadas, na ordem de consenso, com sites,
 * tópicos da comunidade e o motivo. Menos que N com respaldo → diz quantas.
 */
function listaNumerada({ finalistas = [], outros = [], quantidade = 0 }) {
  if (!quantidade || quantidade < 3) return '';
  const linha = (c, i, comparada) => {
    const onde = respaldoDe(c);
    // 14/10: a fonte de quem recomenda, sem colar o comentário (o Davi pediu
    // explicação, não comentário jogado na tela); a fonte vira link
    const cit = (c.consenso?.citacoes || []).find((x) => x.tom === 'recomenda');
    const fonte = (nome, url) => (url ? `[${nome}](${url})` : nome);
    const motivo = cit
      ? ` — indicado por quem usa em ${fonte(cit.fonte, cit.url)}${cit.votos ? ` (${cit.votos} votos)` : ''}`
      : c.consenso?.motivo?.dominio
        ? ` — citado em ${c.consenso.motivo.dominio}`
        : '';
    return `${i}. **${c.nome}** — ${onde}${comparada ? '; comparada na tabela acima' : '; não pesquisada a fundo'}${motivo}`;
  };
  const todos = [...finalistas.map((c) => [c, true]), ...outros.map((c) => [c, false])].slice(0, quantidade);
  if (!todos.length) return '';
  const linhas = todos.map(([c, comparada], i) => linha(c, i + 1, comparada));
  const falta = todos.length < quantidade
    ? `\n\nAchei ${todos.length} opções com respaldo no material, não ${quantidade} — não completei a lista com nome sem fonte.`
    : '';
  return `### Lista das ${Math.min(quantidade, todos.length)} opções (ordem de consenso das fontes)\n${linhas.join('\n')}${falta}`;
}

/**
 * Resumo curto que entra no histórico da decisão depois do motor: o modelo
 * de decisão sabe que a pesquisa já foi feita (e não refaz a mesma busca) e
 * o que ainda falta, se faltar.
 */
function resumoParaDecisao({ plano, finalistas, matriz, buscas }) {
  const faltas = matriz.lacunas
    .filter((l) => l.peso >= PESOS.alto)
    .slice(0, 4)
    .map((l) => `${l.criterio} de ${l.candidato}`);
  return (
    `PESQUISA PLANEJADA CONCLUÍDA (etapa automática, não é o usuário): ${buscas} busca(s) feitas por critério e por opção. ` +
    `Critérios: ${plano.criterios.map((k) => k.nome).join(', ')}. Opções comparadas: ${finalistas.map((f) => f.nome).join(', ')}. ` +
    `Cobertura: ${Math.round(matriz.cobertura * 100)}%. O material e a tabela já estão prontos para a redação.` +
    (faltas.length ? ` Ainda sem evidência: ${faltas.join('; ')}.` : '') +
    ' Se o pedido é uma resposta no chat, chame responder agora. Se pediu arquivo, gere-o com a tabela critério × opção. ' +
    'Só pesquise de novo algo específico que ainda falte — nunca refaça as mesmas buscas.'
  );
}

/* ---------------- Etapa F: comparação de desempenho A × B ---------------- */

const BUSCAS_DE_DESEMPENHO = { leve: 3, medio: 5, alto: 7, extremo: 8 };

/** Mediana simples (preço observado). */
function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const reais = (v) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
const porcento = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')}%`;

/**
 * Preço observado de cada produto nas páginas lidas (BRL), pela frase que
 * cita o produto e SÓ ele — "a 5080 sai por R$ 7.899 e a 5070 Ti por
 * R$ 5.899" não mistura. Mediana, com quantos preços entraram.
 */
function precosObservados(entradas, produtos) {
  const saida = {};
  for (const p of produtos) saida[p.nome] = [];
  for (const e of entradas) {
    for (const fr of frases(e.bruto || e.texto)) {
      const donos = produtos.filter((p) => p.re.test(fr));
      if (donos.length !== 1) continue;
      for (const pr of precosDaFrase(fr)) if (pr.moeda === 'BRL' && pr.valor >= 1000 && pr.valor <= 60000) saida[donos[0].nome].push(pr.valor);
    }
  }
  const r = {};
  for (const [nome, vs] of Object.entries(saida)) if (vs.length) r[nome] = { mediana: mediana(vs), n: vs.length };
  return r;
}

/**
 * Preço observado de cada opção da recomendação (2026-10-10, diagnóstico da
 * qualidade: a resposta dos 5 IEMs não trazia preço nenhum). Mesma regra de
 * `precosObservados`: a frase tem que citar a opção e nenhuma outra, e
 * parcela não conta (`precosDaFrase`). Real tem preferência; sem nenhum
 * preço em real, vale o em dólar (Reddit, reviews em inglês). Mediana, faixa
 * e quantos preços entraram — o código mostra, o modelo não inventa.
 */
function precosDasOpcoes(entradas, finalistas) {
  const nomes = finalistas.map((f) => f.nome);
  const porOpcao = {};
  for (const nome of nomes) porOpcao[nome] = { BRL: [], USD: [] };
  for (const e of entradas || []) {
    if (e.foraDoEscopo) continue;
    for (const fr of frases(e.bruto || e.texto)) {
      const n = normalizar(fr);
      const donos = nomes.filter((nome) => citaNaFrase(n, nome));
      if (donos.length !== 1) continue;
      const nome = donos[0];
      if (falaDeOutroProduto(fr, nome, { nomes: nomes.filter((x) => x !== nome), marcas: new Set() })) continue;
      for (const pr of precosDaFrase(fr)) porOpcao[nome][pr.moeda].push(pr.valor);
    }
  }
  const saida = {};
  for (const [nome, moedas] of Object.entries(porOpcao)) {
    const moeda = moedas.BRL.length ? 'BRL' : moedas.USD.length ? 'USD' : null;
    if (!moeda) continue;
    const vs = moedas[moeda];
    saida[nome] = { moeda, mediana: mediana(vs), min: Math.min(...vs), max: Math.max(...vs), n: vs.length };
  }
  return saida;
}

async function comparativoDeDesempenho({ objetivo, nivel, rodar, emitir, config, livro, entradas, consultas, buscas }) {
  const produtos = produtosDoPedido(objetivo).slice(0, 2);
  const [A, B] = produtos.map((p) => p.nome);
  const perfil = config.perfisDeUso === false ? null : perfilDoPedido(objetivo);
  const plano = {
    uso: `diferença de desempenho entre ${A} e ${B}`,
    tipoDeUso: 'desempenho em jogos',
    modo: 'desempenho',
    criterios: (perfil?.criterios || [{ nome: 'FPS em jogos por resolução', peso: 'alto', termos: ['benchmark', 'FPS'] }]).map((k) => ({ ...k })),
    opcoesCitadas: [A, B],
    descoberta: [],
    buscaIngles: '',
  };
  emitir('pesquisa-plano', { uso: plano.uso, criterios: plano.criterios.map(({ nome, peso }) => ({ nome, peso })), opcoesCitadas: plano.opcoesCitadas, descoberta: [], modo: 'desempenho' });

  const foco = `${A} × ${B}: FPS medido em jogos por resolução (1080p, 1440p, 4K), diferença em %, ray tracing`;
  const lista = [
    { q: `${A} vs ${B} benchmark 1440p 4K`, idioma: 'all', tipo: 'comparativo' },
    { q: `${A} vs ${B} teste em jogos fps`, tipo: 'comparativo' },
    { q: `site:reddit.com ${A} vs ${B}`, idioma: 'all', tipo: 'comunidade', comunidade: true, foco: `${A} × ${B}: o que quem usou diz, qual escolheriam e por quê` },
    { q: `${A} vs ${B} relative performance`, idioma: 'all', tipo: 'comparativo' },
    { q: `${A} ${B} preço`, tipo: 'preco', foco: `preço atual de ${A} e ${B} no Brasil` },
    { q: `${B} review benchmarks`, idioma: 'all', tipo: 'comparativo' },
    { q: `site:reddit.com r/hardwarebrasil ${A} ${B}`, idioma: 'all', tipo: 'comunidade', comunidade: true, foco: `${A} × ${B}: o que quem usou diz` },
    { q: `${A} review benchmarks`, idioma: 'all', tipo: 'comparativo' },
  ].slice(0, BUSCAS_DE_DESEMPENHO[nivel] || 3);
  for (const b of lista) {
    await rodar(b.q, b.foco || foco, '', b.tipo, { ...(b.idioma ? { idioma: b.idioma } : {}), ...(b.comunidade ? { comunidade: true } : {}) });
  }
  for (const p of produtos) {
    await rodar(consultaDeFicha(p.nome), `${p.nome}: especificações técnicas (núcleos CUDA, VRAM, barramento, TDP, clock)`, p.nome, 'ficha');
  }

  // números: extraídos e calculados pelo CÓDIGO, gravados no livro com ID
  const itens = [];
  const usadas = [];
  const vistas = new Set();
  for (const e of entradas) {
    const chave = String(e.url || '') + (e.bruto || e.texto || '').length;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const achados = desempenho.extrairBenchmarks({ texto: e.bruto || e.texto || '', url: e.url || '', titulo: e.titulo || '', produtos });
    if (achados.length) usadas.push(e);
    for (const it of achados) {
      itens.push(it);
      livro.adicionar(desempenho.paraEvidencia(it));
    }
  }
  const agregado = desempenho.agregarBenchmarks(itens, { produtoA: A, produtoB: B });
  const blocoDesempenho = desempenho.blocoDoComparativo(agregado);

  // ficha pelo código (sem juiz)
  const fichas = {};
  for (const p of produtos) {
    const f = {};
    for (const e of entradas.filter((x) => x.opcao === p.nome && x.tipoBusca === 'ficha')) {
      const achado = desempenho.extrairFicha({ texto: e.bruto || e.texto || '', produto: p });
      for (const [k, v] of Object.entries(achado)) {
        if (f[k] == null && v != null) {
          f[k] = v;
          livro.adicionar({ tipo: 'especificacao', produto: p.nome, criterio: k, valor: v, url: e.url || '', trecho: String(v), origem: 'ficha' });
        }
      }
      if (Object.keys(achado).length) usadas.push(e);
    }
    fichas[p.nome] = f;
  }
  const precos = precosObservados(entradas, produtos);
  for (const [nome, pr] of Object.entries(precos)) livro.adicionar({ tipo: 'preco', produto: nome, valor: Math.round(pr.mediana), unidade: 'BRL', trecho: `mediana de ${pr.n} preço(s) nas páginas lidas`, origem: 'paginas' });

  // comunidade: o que dizem do confronto (citações com voto e fórum)
  const termos = termosDoUso(objetivo);
  const finalistas = produtos.map((p) => ({ nome: p.nome, dominios: [], mencoes: 0, citadaPeloUsuario: true, consenso: consensoDe(p.nome, entradas, config, { termos }) }));

  const g = agregado.porResolucao?.geral;
  emitir('pesquisa-desempenho', {
    produtos: [A, B],
    geral: g || null,
    porResolucao: agregado.porResolucao,
    jogos: agregado.jogos.length,
    fontes: agregado.fontes,
    sinteticos: agregado.sinteticos || null,
    fichas,
    precos,
  });
  emitir('pesquisa-evidencias', { total: livro.tamanho, itens: livro.serializar(300) });

  const rotulosFicha = { cuda: 'núcleos CUDA', vram: 'VRAM (GB)', tipoMemoria: 'memória', barramento: 'barramento (bits)', tdp: 'consumo/TDP (W)', boostMhz: 'boost (MHz)' };
  const camposFicha = Object.keys(rotulosFicha).filter((k) => produtos.some((p) => fichas[p.nome][k] != null));
  const blocoFicha = camposFicha.length
    ? ['FICHA TÉCNICA (extraída pelo código das páginas de especificação):', `| Item | ${A} | ${B} |`, '|---|---:|---:|', ...camposFicha.map((k) => `| ${rotulosFicha[k]} | ${fichas[A][k] ?? 'sem dado'} | ${fichas[B][k] ?? 'sem dado'} |`)].join('\n')
    : 'FICHA TÉCNICA: não encontrada nas páginas lidas — não invente especificação.';
  let blocoPreco = 'PREÇO: nenhum preço em reais encontrado nas páginas lidas — não invente preço.';
  if (precos[A] && precos[B]) {
    const difPreco = (precos[B].mediana / precos[A].mediana - 1) * 100;
    blocoPreco = `PREÇO OBSERVADO (mediana dos preços em reais nas páginas lidas): ${A} ${reais(precos[A].mediana)} (${precos[A].n} preço(s)) · ${B} ${reais(precos[B].mediana)} (${precos[B].n} preço(s)). A ${B} custa ${porcento(difPreco)} em relação à ${A}.`;
    if (g) blocoPreco += ` Para ${porcento(g.mediana)} de desempenho em jogos — use isso no veredito (custo por quadro).`;
  } else if (precos[A] || precos[B]) {
    const [nome, pr] = Object.entries(precos)[0];
    blocoPreco = `PREÇO OBSERVADO: só da ${nome}: ${reais(pr.mediana)} (${pr.n} preço(s)). Sem o preço da outra, não calcule custo por quadro.`;
  }
  const citacoes = finalistas.flatMap((f) => (f.consenso.citacoes || []).map((c) => `  "${c.texto}" (${c.fonte}${c.votos ? `, ${c.votos} votos` : ''}) — sobre ${f.nome}`));
  const linhas = [
    'PLANO DA RESPOSTA (comparação de desempenho montada pela pesquisa planejada — os números abaixo foram EXTRAÍDOS E CALCULADOS PELO CÓDIGO; não recalcule nem invente outros):',
    `PERGUNTA: ${plano.uso}.`,
    '',
    blocoDesempenho || `DESEMPENHO EM JOGOS: nenhuma medição de FPS em jogos com as duas placas foi encontrada nas páginas lidas. Diga isso na resposta direta; não estime uma porcentagem.${agregado.sinteticos ? ` Só há teste sintético (${porcento(agregado.sinteticos.mediana)}) — cite como "(teste sintético)", nunca como desempenho em jogos.` : ''}`,
    '',
    blocoFicha,
    '',
    blocoPreco,
    ...(citacoes.length ? ['', 'O QUE A COMUNIDADE DIZ (cite 1 ou 2 EXATAMENTE como estão, com a fonte; traduza se estiver em inglês e diga que é tradução):', ...citacoes.slice(0, 5)] : []),
    '',
    'FORMATO:',
    `1. Resposta direta: a diferença em % em jogos${g ? ` (${porcento(g.mediana)})` : ''} e o que isso significa na prática (ex.: num jogo que roda a 60 FPS numa, quanto roda na outra).`,
    '2. Tabela dos jogos medidos (a do bloco acima) e a diferença por resolução.',
    '3. Ficha técnica curta (só o que está no bloco).',
    '4. Preço e custo por quadro, se houver os dois preços.',
    '5. O que a comunidade diz (citações).',
    `6. Veredito com ponto de vista: para quem vale a ${A}, para quem vale a ${B} (resolução, orçamento, ray tracing) — com base nos números acima.`,
    '7. O que não foi possível medir.',
    'Teste sintético (3DMark, PassMark, Geekbench) nunca é "desempenho em jogos": se citar, escreva "(teste sintético)".',
  ];
  const planoDeResposta = linhas.join('\n');
  emitir('pesquisa-candidatos', { origem: 'pedido', resposta: '', propostos: 2, descartados: 0, finalistas: finalistas.map((f) => ({ nome: f.nome, citacoes: f.consenso.citacoes || [] })), outros: [], lista: [], segundaRodada: 0, foraDaCategoria: [], criteriosDoMaterial: [] });
  const matriz = { celula: () => null, cobertura: g ? 1 : 0, lacunas: [], entradasUsadas: [...new Set(usadas)], resumos: new Map() };
  return {
    ok: true,
    modo: 'desempenho',
    livro,
    plano,
    finalistas,
    outros: [],
    matriz,
    desempenho: agregado,
    fichas,
    precos,
    blocoDesempenho,
    buscas: buscas(),
    consultas,
    entradas,
    planoDeResposta,
    listaNumerada: '',
    resumo:
      `PESQUISA PLANEJADA CONCLUÍDA (etapa automática, não é o usuário): comparação de desempenho ${A} × ${B} com ${buscas()} busca(s); ` +
      `${agregado.itens || 0} resultado(s) de jogos extraídos pelo código de ${agregado.fontes || 0} fonte(s). O material e o plano da resposta já estão prontos: chame responder agora.`,
  };
}

/* ---------------- Etapa G: dado de uso entre profissionais ---------------- */

const BUSCAS_DE_USO = { leve: 3, medio: 4, alto: 5, extremo: 6 };
const EQUIPAMENTO_EN = { 'Headset/fone': 'headset', Mouse: 'mouse', Teclado: 'keyboard', Monitor: 'monitor', Mousepad: 'mousepad', Equipamento: 'gear' };

async function usoProfissional({ objetivo, nivel, rodar, emitir, livro, entradas, consultas, buscas }) {
  const eq = usoPro.equipamentoDoPedido(objetivo);
  const eqEn = EQUIPAMENTO_EN[eq.nome] || 'gear';
  const { jogo } = assuntoDaComunidade(objetivo);
  const jogoEn = jogo?.en || 'esports';
  const plano = {
    uso: `${eq.nome.toLowerCase()} mais usado pelos profissionais${jogo ? ` de ${jogo.en}` : ''}`,
    tipoDeUso: 'dado de uso entre profissionais',
    modo: 'uso-profissional',
    criterios: [{ nome: 'jogadores que usam', peso: 'alto', termos: ['pro settings', 'gear'] }],
    opcoesCitadas: [],
    descoberta: [],
    buscaIngles: '',
  };
  emitir('pesquisa-plano', { uso: plano.uso, criterios: [], opcoesCitadas: [], descoberta: [], modo: 'uso-profissional' });
  const foco = `lista de equipamento dos jogadores profissionais${jogo ? ` de ${jogo.en}` : ''}: qual ${eqEn} cada jogador usa, e quantos usam cada modelo`;
  const lista = [
    { q: `${jogoEn} pro settings ${eqEn}`, idioma: 'all' },
    { q: `${jogoEn} pro players ${eqEn} list`, idioma: 'all' },
    { q: `prosettings ${jogoEn} ${eqEn}`, idioma: 'all' },
    { q: `site:liquipedia.net ${jogoEn} player ${eqEn}`, idioma: 'all' },
    jogo?.sub ? { q: `site:reddit.com r/${jogo.sub} what ${eqEn} do pros use`, idioma: 'all', comunidade: true, tipo: 'comunidade' } : null,
    { q: `${eq.nome.split('/').pop().toLowerCase()} usado pelos profissionais ${jogoEn}` },
  ].filter(Boolean).slice(0, BUSCAS_DE_USO[nivel] || 3);
  for (const b of lista) {
    await rodar(b.q, foco, '', b.tipo || 'uso-profissional', { ...(b.idioma ? { idioma: b.idioma } : {}), ...(b.comunidade ? { comunidade: true } : {}) });
  }
  // contagem pelo CÓDIGO: jogador → equipamento, por jogador distinto
  const extraidos = [];
  const usadas = [];
  for (const e of entradas) {
    const r = usoPro.extrairUsoProfissional({ texto: e.bruto || e.texto || '', url: e.url || '', titulo: e.titulo || '', coluna: eq.coluna });
    if (!r.pares.length && !r.percentuais.length) continue;
    extraidos.push(r);
    usadas.push(e);
    for (const p of r.pares) livro.adicionar({ tipo: 'uso-profissional', produto: p.produto, condicoes: { jogador: p.jogador }, url: p.url, trecho: p.trecho, origem: 'tabela' });
    for (const p of r.percentuais) livro.adicionar({ tipo: 'uso-profissional', produto: p.produto, valor: p.valor, unidade: p.unidade, url: p.url, trecho: p.trecho, origem: 'frase' });
  }
  const agregado = usoPro.agregarUso(extraidos);
  const bloco = usoPro.blocoDoUso(agregado, { equipamento: eq.nome, jogo: jogo?.en || '' });
  emitir('pesquisa-uso', { equipamento: eq.nome, jogo: jogo?.en || null, total: agregado.total, fontes: agregado.fontes, ranking: agregado.ranking.slice(0, 10), declarados: agregado.declarados.length });
  emitir('pesquisa-evidencias', { total: livro.tamanho, itens: livro.serializar(300) });
  const topo = agregado.ranking[0];
  const linhas = [
    'PLANO DA RESPOSTA (dado de uso entre profissionais — os números abaixo foram CONTADOS PELO CÓDIGO nas listas de equipamento lidas; não invente outros):',
    `PERGUNTA: ${plano.uso}.`,
    '',
    bloco ||
      `NÃO FOI ENCONTRADA nas páginas lidas uma lista de equipamento dos profissionais${jogo ? ` de ${jogo.en}` : ''} com o ${eq.nome.toLowerCase()} de cada jogador. Diga isso na resposta direta; NÃO troque a pergunta por "qual o melhor", não monte tabela de preço nem nota, e sugira onde conferir (páginas de "pro settings"/equipamento de cada jogador).`,
    '',
    'FORMATO:',
    topo && agregado.total >= 3
      ? `1. Resposta direta: o mais usado entre os listados é o ${topo.produto} (${topo.jogadores} de ${agregado.total} jogadores, ${String(topo.parcela).replace('.', ',')}%), dizendo de qual base veio.`
      : '1. Resposta direta: o que as fontes dizem (porcentagens declaradas, com a fonte) — ou que não há dado de uso confiável.',
    '2. A lista dos modelos mais usados (a tabela acima), sem preço nem nota.',
    '3. As ressalvas acima.',
    'Nada de "conhecimento geral" com número, preço ou estrela: só o que está no bloco acima.',
  ];
  const matriz = { celula: () => null, cobertura: agregado.total ? 1 : 0, lacunas: [], entradasUsadas: usadas, resumos: new Map() };
  return {
    ok: true,
    modo: 'uso-profissional',
    livro,
    plano,
    finalistas: [],
    outros: [],
    matriz,
    uso: agregado,
    buscas: buscas(),
    consultas,
    entradas,
    planoDeResposta: linhas.join('\n'),
    listaNumerada: '',
    resumo: `PESQUISA PLANEJADA CONCLUÍDA (etapa automática, não é o usuário): dado de uso entre profissionais com ${buscas()} busca(s); ${agregado.total} jogador(es) com equipamento listado. O plano da resposta já está pronto: chame responder agora.`,
  };
}

/**
 * Lê "nome: sim | não | não sei" e devolve os nomes (como estão na lista)
 * marcados "não". Linha que não casa com nenhum nome é ignorada — o modelo
 * não tira o que não foi perguntado.
 */
function lerForaDaCategoria(texto, nomes) {
  const fora = new Set();
  for (const bruta of String(texto || '').split('\n')) {
    const m = /^\s*[-*\d.)\s]*\**(.+?)\**\s*:\s*\**\s*(sim|n[aã]o sei|n[aã]o)\b/i.exec(bruta);
    if (!m || /sei/i.test(m[2]) || /^sim$/i.test(m[2])) continue;
    const dito = normalizar(m[1]);
    const nome = nomes.find((n) => normalizar(n) === dito) || nomes.find((n) => dito.length >= 4 && (normalizar(n).startsWith(dito) || dito.startsWith(normalizar(n))));
    if (nome) fora.add(nome);
  }
  return fora;
}

/* ------------------------------ entendimento do pedido (13/10) ------------------------------ */

const NAO_DITO = /^(nenhum|nenhuma|nao informado|nao|n\/a|-|—)?$/;
/**
 * Lê o entendimento do modelo e CONFERE contra o pedido: o produto tem que
 * estar escrito nele; o uso também (uso que o pedido não diz é invenção e
 * vira "não informado"). Devolve null quando o pedido não é sobre UM produto.
 */
function lerEntendimento(texto, objetivo) {
  const campo = (nome) => (new RegExp(`^\\s*\\**${nome}\\**\\s*:\\s*(.+)$`, 'im').exec(String(texto || ''))?.[1] || '').replace(/["“”*]/g, '').trim();
  const pedido = normalizar(objetivo);
  const categoria = NAO_DITO.test(normalizar(campo('CATEGORIA'))) ? '' : campo('CATEGORIA').slice(0, 60);
  let produto = campo('PRODUTO').replace(/\s*[(—–].*$/, '').trim();
  // o modelo às vezes repete o tipo na frente ("fone de ouvido Dunu Titan S")
  if (categoria && normalizar(produto).startsWith(`${normalizar(categoria)} `)) produto = produto.split(/\s+/).slice(categoria.split(/\s+/).length).join(' ');
  const nome = normalizar(produto);
  if (NAO_DITO.test(nome) || /recomend|compar/.test(normalizar(campo('INTENCAO'))) || PEDE_OUTRAS_OPCOES.test(pedido)) return null;
  const noPedido = new Set(pedido.split(' '));
  const tokens = nome.split(' ');
  // o nome está no pedido: igual, colado/separado diferente ("qc20" / "qc 20")
  // ou com UMA palavra corrigida pelo modelo ("sansung s26 ultra" → "samsung s26 ultra")
  const citado =
    mencionaNome(pedido, produto) ||
    pedido.replace(/ /g, '').includes(nome.replace(/ /g, '')) ||
    (tokens.length >= 3 && tokens.filter((t) => noPedido.has(t)).length >= tokens.length - 1);
  if (!citado || OBJETO_PRODUTO.test(nome) || !(/\d/.test(nome) || tokens.length >= 2)) return null;
  const usoDito = campo('USO');
  const uso = NAO_DITO.test(normalizar(usoDito)) || !normalizar(usoDito).split(' ').some((t) => t.length >= 3 && noPedido.has(t) && !normalizar(`${produto} ${categoria}`).split(' ').includes(t)) ? '' : usoDito.slice(0, 120);
  return { produto, categoria, uso };
}

/**
 * "fone de ouvido dunu titan s": o usuário quer CONHECER aquele produto — o
 * que é, ficha, pontos fortes e fracos, preço, o que quem usa diz. Não há uso
 * para pesar critérios nem opções para comparar: só buscas sobre ele (página
 * que não cita o produto é descartada pelo `rodar`), e a redação escreve do material.
 */
async function conhecerProduto({ objetivo, produto, categoria, rodar, emitir, entradas, consultas, buscas, adiantar }) {
  const rotulo = categoria || rotuloDaCategoria(objetivo, produto);
  const plano = { uso: `conhecer o ${produto}`, modo: 'produto', criterios: [], opcoesCitadas: [produto], descoberta: [] };
  emitir('pesquisa-plano', { uso: plano.uso, criterios: [], opcoesCitadas: [produto], descoberta: [], modo: 'produto' });
  const foco = `${produto}: o que é, ficha técnica, pontos fortes, pontos fracos, preço e o que quem usa diz`;
  const lista = [
    { q: `${produto} ${rotulo} review`.replace(/\s+/g, ' ') },
    { q: consultaDeFicha(produto, rotulo) },
    { q: consultaDeComunidade(produto), extras: { idioma: 'all', comunidade: true } },
    { q: `${produto} review`, extras: { idioma: 'all' } },
    { q: `${produto} preço` },
  ];
  adiantar(lista.map((b) => ({ consulta: b.q, idioma: b.extras?.idioma, comunidade: b.extras?.comunidade })));
  const lidas = [];
  for (const b of lista) lidas.push(...(await rodar(b.q, foco, produto, 'ficha', b.extras || {})));
  if (!lidas.length) return { ok: false, modo: 'produto', produto, motivo: `nenhuma página lida cita o ${produto}`, plano, buscas: buscas(), consultas, entradas };
  const planoDeResposta = [
    `PLANO DA RESPOSTA (o pedido é sobre UM produto: ${produto}). Escreva só com o material coletado sobre ele, em texto corrido e bem explicado:`,
    `1. Abertura: o que é o ${produto} (tipo de produto, proposta, para quem foi feito).`,
    '2. Ficha técnica: os dados que o material traz (lista curta).',
    '3. Pontos fortes e pontos fracos, cada um explicado com as suas palavras a partir dos reviews e dos comentários de quem usa (sem colar os comentários).',
    '4. Preço observado, se o material trouxer.',
    '5. Para quem vale a pena e para quem não vale.',
    `NÃO recomende nem liste outros produtos no lugar dele. O que o material não disser sobre o ${produto}, diga que não foi encontrado.`,
  ].join('\n');
  return {
    ok: true,
    modo: 'produto',
    categoria: categoria || '',
    produto,
    plano,
    finalistas: [{ nome: produto, consenso: { citacoes: [] } }],
    outros: [],
    matriz: { celula: () => null, cobertura: 1, lacunas: [], entradasUsadas: lidas, resumos: new Map() },
    buscas: buscas(),
    consultas,
    entradas,
    planoDeResposta,
    listaNumerada: '',
    resumo: `PESQUISA PLANEJADA CONCLUÍDA (etapa automática, não é o usuário): ${buscas()} busca(s) sobre o ${produto}, ${lidas.length} leitura(s) que citam o produto guardadas para a redação. Agora chame "responder" — a resposta é sobre o ${produto}, não uma lista de outros produtos.`,
  };
}

/* ------------------------------ orquestração ------------------------------ */

/**
 * Roda o motor inteiro. Dependências injetadas:
 *   chamarModelo(prompt, { tipo, numPredict }) → texto
 *   buscar(consulta, foco) → entradas novas do dossiê (as desta busca)
 *   emitir(evento, dados)
 * Devolve { ok, motivo, ... }. `ok: false` nunca é erro: o agente segue o
 * caminho normal de sempre com o que já foi coletado (se algo foi).
 */
async function executarPesquisaPlanejada({ objetivo, nivel = 'leve', chamarModelo, buscar, emitir = () => {}, config = {}, livro = new Evidencias(), rota = null, preBuscar = null }) {
  // pré-busca (tools/web.js: adiantarBuscas): antes de uma lista de buscas
  // independentes, as seguintes à primeira já começam em segundo plano
  // enquanto o modelo destila a atual. Itens: { consulta, idioma, comunidade }.
  const adiantar = (lista) => {
    if (typeof preBuscar !== 'function') return;
    const proximas = (lista || []).slice(1).filter((x) => x?.consulta);
    if (proximas.length) {
      try {
        preBuscar(proximas);
      } catch {
        /* pré-busca é bônus */
      }
    }
  };
  const orcamento = ORCAMENTO_POR_NIVEL[nivel] || ORCAMENTO_POR_NIVEL.leve;
  const entradas = [];
  const consultas = [];
  let buscas = 0;
  const rodar = async (consulta, foco, opcao = '', tipo = '', extras = {}) => {
    buscas += 1;
    consultas.push(consulta);
    // ficha e lacuna são sobre UMA opção: página que não a cita nem vai pra destilação (5º argumento)
    const lidas = (await buscar(consulta, foco, opcao, extras, tipo === 'ficha' || tipo === 'lacuna')) || [];
    // marca de onde veio cada leitura: a matriz e o resumo por opção usam isso
    for (const e of lidas) {
      if (opcao) e.opcao = opcao;
      if (tipo) e.tipoBusca = tipo;
    }
    // Etapa B (14º teste real): leitura de FICHA ou LACUNA de uma opção que
    // não cita a opção não é material dela ("RTX 5070 Ti ... ou superior"
    // trouxe mec.gov.br e "curso superior", que foram parar nas Fontes)
    const novas = [];
    for (const e of lidas) {
      if (opcao && (tipo === 'ficha' || tipo === 'lacuna') && !mencionaNome(normalizar(textoDaEntrada(e)), opcao)) {
        e.foraDoEscopo = `não cita ${opcao}`;
        emitir('descarte', { etapa: tipo, alvo: e.url || dominioDe(e), motivo: e.foraDoEscopo });
        continue;
      }
      novas.push(e);
    }
    entradas.push(...novas);
    return novas;
  };
  const quantidade = quantidadePedida(objetivo);
  emitir('pesquisa-modo', { modo: modoDaPesquisa(objetivo, { rota }) || 'recomendacao' });

  // Etapa F (revisão v2, 14º teste real): "diferença de desempenho entre A e
  // B" é outra pergunta — não "qual o melhor". Tem caminho próprio: buscas de
  // benchmark em jogos, números extraídos e calculados pelo código, ficha
  // pelo código, preço observado e o que a comunidade diz do confronto.
  if (config.modoDesempenho !== false && desempenho.ehPedidoDeDesempenho(objetivo)) {
    return comparativoDeDesempenho({ objetivo, nivel, orcamento, rodar, emitir, config, livro, entradas, consultas, buscas: () => buscas });
  }
  // Revisão v3 (Fase 1): técnica (táticas, dicas, tutorial) tem caminho
  // próprio — a extração é de DICA, não de produto
  if (modoDaPesquisa(objetivo, { rota }) === 'guia') {
    return guia.pesquisaDeGuia({
      objetivo, nivel, rodar, emitir, chamarModelo, livro, entradas, consultas, buscas: () => buscas, prompts, adiantar,
      h: { JOGOS, ehTopico, comentariosNumerados, perguntaDoTopico, dominioDe, chaveDeFonte },
    });
  }
  // Etapa G (14º teste real, 2ª pergunta): "mais usado pelos profissionais"
  // é CONTAGEM (jogador → equipamento), não "qual o melhor"
  if (config.modoUsoProfissional !== false && usoPro.ehPedidoDeUsoProfissional(objetivo)) {
    return usoProfissional({ objetivo, nivel, rodar, emitir, livro, entradas, consultas, buscas: () => buscas });
  }

  // 13/10: antes de montar a estratégia, o MODELO diz o que o pedido quer
  // (produto citado, uso, intenção) e o código confere. Um produto sem uso
  // declarado tem caminho próprio; com uso, vira avaliação daquele produto.
  const entendido = config.entendimentoDoPedido === false || produtosNomeados(objetivo).length ? null : lerEntendimento(await chamarModelo(prompts.pedidoDeEntendimento({ objetivo }), { tipo: 'entendimento', numPredict: 120 }), objetivo);
  if (entendido) {
    emitir('pesquisa-entendimento', entendido);
    if (!entendido.uso) return conhecerProduto({ objetivo, ...entendido, rodar, emitir, entradas, consultas, buscas: () => buscas, adiantar });
  }

  // 0a. cadeia do uso (2026-09-28): do pedido até as características técnicas
  // ("PUBG → FPS competitivo → ouvir passos e de onde vêm → palco/imagem,
  // separação, isolamento..."), e busca de CONHECIMENTO ("o que torna um fone
  // bom para FPS") antes de procurar produto. Os critérios saem daí, com o
  // porquê de cada um — é o que a resposta explica ao usuário.
  const cadeia = lerCadeiaDoUso(await chamarModelo(prompts.pedidoDeCadeiaDoUso({ objetivo }), { tipo: 'cadeia-uso', numPredict: 550 }));
  let criteriosBase = [];
  const lidasDeConhecimento = [];
  // Etapa E (14º teste real): pedido que casa com um perfil curado
  // (dados/perfis-de-uso.md) usa os critérios de lá, com o porquê — a cadeia
  // do 7B virou "sons de explosões", "microfone", "cabo over-ear".
  const perfil = config.perfisDeUso === false ? null : perfilDoPedido(objetivo);
  if (perfil) {
    if (cadeia) emitir('pesquisa-cadeia', cadeia);
    criteriosBase = perfil.criterios.map((k) => ({ ...k }));
    emitir('pesquisa-criterios', {
      tipoDeUso: cadeia?.tipoDeUso || perfil.nome,
      perfil: perfil.nome,
      criterios: criteriosBase.map(({ nome, peso, porque }) => ({ nome, peso, porque, origem: 'perfil' })),
      fontes: ['dados/perfis-de-uso.md'],
    });
  } else if (cadeia) {
    emitir('pesquisa-cadeia', cadeia);
    const focoConhecimento = `o que torna um(a) ${cadeia.produto} bom(boa) para ${cadeia.tipoDeUso}: quais características técnicas importam e por quê`;
    const deConhecimento = consultasDeConhecimento(cadeia, orcamento.conhecimento || 1);
    adiantar(deConhecimento.map((q) => ({ consulta: q.consulta, idioma: q.idioma === 'all' ? 'all' : undefined })));
    for (const q of deConhecimento) {
      lidasDeConhecimento.push(...(await rodar(q.consulta, focoConhecimento, '', 'conhecimento', q.idioma === 'all' ? { idioma: 'all' } : {})));
    }
    if (lidasDeConhecimento.length) {
      criteriosBase = lerCriteriosDoConhecimento(
        await chamarModelo(
          prompts.pedidoDeCriteriosDoConhecimento({
            produto: cadeia.produto,
            tipoDeUso: cadeia.tipoDeUso,
            material: materialDeConhecimento(lidasDeConhecimento),
            sugeridos: cadeia.caracteristicas.map((c) => c.nome),
          }),
          { tipo: 'criterios-conhecimento', numPredict: 500 }
        )
      );
    }
    // o que o conhecimento não trouxe, a cadeia completa (ela já tem o porquê)
    for (const k of criteriosDaCadeia(cadeia)) {
      if (criteriosBase.length >= 5) break;
      if (!criteriosBase.some((x) => mesmoCriterio(x.nome, k.nome))) criteriosBase.push(k);
    }
    emitir('pesquisa-criterios', {
      tipoDeUso: cadeia.tipoDeUso,
      criterios: criteriosBase.map(({ nome, peso, porque, doConhecimento }) => ({ nome, peso, porque, origem: doConhecimento ? 'conhecimento' : 'raciocinio' })),
      fontes: [...new Set(lidasDeConhecimento.map(dominioDe))].slice(0, 6),
    });
  }
  const termosDeUso = termosDoUso(objetivo, cadeia);

  // 0. mapa do problema (Fase B): pensar no problema antes de pesquisar
  const mapa = lerMapaDoProblema(await chamarModelo(prompts.pedidoDeMapaDoProblema({ objetivo }), { tipo: 'mapa-problema', numPredict: 600 }));
  if (mapa) emitir('pesquisa-mapa', mapa);

  // 1. plano (com o mapa como base dos critérios)
  const plano = lerPlanoDePesquisa(
    await chamarModelo(prompts.pedidoDePlanoDePesquisa({ objetivo, mapa }), { tipo: 'plano-pesquisa', numPredict: 450 }),
    objetivo
  );
  if (!plano) return { ok: false, motivo: 'plano ilegível', buscas, consultas, entradas };
  if (criteriosBase.length >= 3) plano.criterios = combinarCriterios(criteriosBase, plano.criterios);
  else if (mapa) plano.criterios = completarComPerfis(plano.criterios, mapa, objetivo);
  if (cadeia) plano.tipoDeUso = cadeia.tipoDeUso;
  else if (perfil) plano.tipoDeUso = perfil.nome;
  if (perfil) plano.perfil = perfil.nome;
  // comparação de produtos nomeados: as opções são as do pedido, mesmo se o
  // plano do modelo não as listou
  const doPedido = produtosDaComparacao(objetivo);
  if (doPedido.length >= 2 && plano.opcoesCitadas.length < 2) plano.opcoesCitadas = doPedido;
  // revisão v4: nomes que o USUÁRIO escreveu (parênteses/aspas) mandam — o plano
  // do modelo não troca nem completa a lista. Um nome só = avaliar aquele produto.
  const nomeados = produtosNomeados(objetivo);
  if (nomeados.length) plano.opcoesCitadas = nomeados;
  else if (entendido) plano.opcoesCitadas = [entendido.produto]; // o produto que o modelo leu no pedido (conferido)
  // uso real de 12/10 ("fone bose qc 20", "Bose qc 20", "O bose qc 20 é bom para
  // pubg?"): o plano do modelo listava o produto do pedido e o código jogava fora
  // por ser um só — a pesquisa ia descobrir "melhores fones" e recomendava outro.
  // Quem entende o pedido é o modelo; o código só confere que o nome está no pedido.
  const avaliacao = nomeados.length === 1 || Boolean(entendido) || produtoUnicoDoPedido(objetivo, plano.opcoesCitadas);
  emitir('pesquisa-plano', {
    uso: plano.uso,
    criterios: plano.criterios.map(({ nome, peso }) => ({ nome, peso })),
    opcoesCitadas: plano.opcoesCitadas,
    descoberta: plano.descoberta.slice(0, orcamento.descoberta),
  });

  // 2. descoberta + candidatos (pulada quando o próprio usuário nomeou as opções)
  let finalistas;
  let outros = [];
  // revisão v6: todos os nomes que a pesquisa conhece (lista larga) — a matriz
  // usa pra saber quando uma frase fala de OUTRO produto
  let conhecidos = [];
  if (plano.opcoesCitadas.length >= 2 || avaliacao) {
    finalistas = plano.opcoesCitadas.slice(0, orcamento.finalistas).map((nome) => ({ nome, dominios: [], mencoes: 0, citadaPeloUsuario: true }));
  } else {
    const focoDescoberta = `descobrir quais opções concretas (nome e modelo) são recomendadas para: ${plano.uso}${plano.tipoDeUso ? ` (${plano.tipoDeUso})` : ''}`;
    // guia de "o que torna um X bom para Y" costuma listar produtos também
    const achadas = [...lidasDeConhecimento];
    const deDescoberta = plano.descoberta.slice(0, orcamento.descoberta);
    adiantar(deDescoberta.map((consulta) => ({ consulta })));
    for (const consulta of deDescoberta) achadas.push(...(await rodar(consulta, focoDescoberta, '', 'descoberta')));
    // sempre descoberta na comunidade (8º teste real + Fase A): tópicos do
    // Reddit e de fórum listam o que quem usa recomenda, e por quê.
    // Etapa C (14º teste real): a bateria montada pelo código — várias buscas
    // por fonte, de ângulos diferentes — no lugar de uma por fórum
    const bateria = bateriaDaComunidade({ objetivo, cadeia, config, maximo: 12, doModelo: plano.comunidade || [] });
    const primeiraLeva = bateria.length
      ? bateria.slice(0, orcamento.bateria || 2)
      : consultasDeDescobertaNaComunidade(plano, { config, maximo: orcamento.comunidade || 2 });
    adiantar(primeiraLeva.map((q) => ({ consulta: q.consulta, idioma: q.idioma, comunidade: true })));
    for (const q of primeiraLeva) {
      achadas.push(...(await rodar(q.consulta, focoDescoberta, '', 'comunidade', { idioma: q.idioma, comunidade: true })));
    }
    if (!achadas.length) return { ok: false, motivo: 'descoberta sem resultado', plano, buscas, consultas, entradas };
    plano.criterios = pesarCriteriosPelaComunidade(completarComComunidade(plano.criterios, achadas), achadas);
    // Fase C: lista LARGA, ordenada por consenso da comunidade
    const listaMax = Math.max(orcamento.lista || 8, quantidade);

    // Etapa C: extração POR TÓPICO — o 7B lê um tópico por vez e aponta
    // produto + comentário; o código confere, decide o tom e grava no livro
    const { categoria: categoriaEn } = assuntoDaComunidade(objetivo, cadeia);
    const produtoDoTopico = categoriaEn ? `${categoriaEn.pt[0]} (${categoriaEn.en[0]})` : cadeia?.produto || 'produtos';
    const topicosLidos = new Set();
    const extrair = async (lidas) => {
      const escolhidos = selecionarTopicos(lidas, { objetivo, termos: termosDeUso, maximo: Math.max(0, (orcamento.topicos || 4) - topicosLidos.size), jaLidos: topicosLidos });
      escolhidos.forEach((t) => topicosLidos.add(t.chave));
      if (!escolhidos.length) return { recomendados: [], porTopico: [] };
      return extrairDaComunidade({ topicos: escolhidos, chamarModelo, livro, termos: termosDeUso, produto: produtoDoTopico });
    };
    const daComunidade = await extrair(achadas);
    const porTopico = [...daComunidade.porTopico];

    // a chamada grande de nomes continua, mas sobre os SITES (review/guia) —
    // os tópicos já foram lidos um a um acima
    const pedirNomes = (lidas) =>
      chamarModelo(
        prompts.pedidoDeCandidatos({ uso: plano.uso, material: materialParaCandidatos(lidas), criterios: plano.criterios.map((k) => k.nome), maximo: listaMax }),
        { tipo: 'candidatos', numPredict: listaMax > 8 ? 320 : 240 }
      );
    const editoriais = achadas.filter((e) => !(topicosLidos.has(String(e.url || '').replace(/[#?].*$/, ''))));
    const resposta = await pedirNomes(editoriais.length ? editoriais : achadas);
    const doMaterial = lerCriteriosDoMaterial(resposta, plano.criterios, objetivo);
    if (doMaterial.length) plano.criterios = [...plano.criterios, ...doMaterial].slice(0, 7);
    // nomes da comunidade primeiro (recomendação de quem usa), depois os dos sites
    const brutos = [...new Map([...daComunidade.recomendados, ...lerCandidatos(resposta, listaMax)].map((n) => [normalizar(n), n])).values()];
    const canonico = canonizarNomes(brutos, achadas.map(textoDaEntrada).join('\n').slice(0, 200000));
    for (const ev of livro.itens) if (ev.produto && canonico.has(ev.produto)) ev.produto = canonico.get(ev.produto);
    const nomes = [...new Map(brutos.map((n) => canonico.get(n) || n).map((n) => [normalizar(n), n])).values()].slice(0, Math.max(listaMax, 20));
    const nomesDoModelo = new Set([...plano.opcoesCitadas, ...nomes].map(normalizar));
    let extrasDoPadrao = [];
    let foraDaCategoria = [];
    // Poucos nomes (4º teste real): o padrão de texto (rígido: marca + modelo,
    // 2+ sites) completa. Na Fase C o alvo sobe pro mínimo da lista larga.
    const montar = () => {
      const doModelo = validarCandidatos([...plano.opcoesCitadas, ...nomes], achadas, { objetivo });
      extrasDoPadrao = [];
      if (doModelo.length < Math.max(3, quantidade, orcamento.minimo || 5)) {
        extrasDoPadrao = candidatosPorPadrao(achadas, { objetivo, maximo: listaMax }).filter((n) => !nomesDoModelo.has(normalizar(n)));
      }
      const doPadrao = validarCandidatos(extrasDoPadrao, achadas, { objetivo });
      const ranq = rankearPorConsenso(absorverSeries(juntarVariantes([...doModelo, ...doPadrao]), achadas), achadas, { config, doModelo: nomesDoModelo, termos: termosDeUso });
      const { lista, fora } = filtrarPorCategoria(ranq, achadas, objetivo);
      foraDaCategoria = fora;
      return lista;
    };
    let ranqueados = montar();
    // "Não se contentar com poucos nomes" (Davi, 2026-09-26): abaixo do mínimo,
    // mais uma rodada em fontes da comunidade ainda não usadas (ou na 2ª
    // busca de descoberta do plano) e mais uma leitura de nomes, só do novo.
    let segundaRodada = 0;
    let motivoSegundaRodada = '';
    if (ranqueados.length < Math.max(orcamento.minimo || 5, quantidade)) {
      const feitas = new Set(consultas.map(normalizar));
      // Etapa C: o resto da bateria (antes gerava as MESMAS consultas, filtrava
      // as repetidas e ficava sem nenhuma — segundaRodada 0 em 5 execuções)
      let mais = bateria.filter((q) => !feitas.has(normalizar(q.consulta))).slice(0, 3);
      if (!mais.length && !bateria.length) {
        const base = (plano.descoberta[0] || plano.uso).replace(/\btop\s*\d+\s*/i, '').trim();
        mais = consultasNaComunidade(base, { config, maximo: 8, emIngles: plano.buscaIngles }).filter((q) => !feitas.has(normalizar(q.consulta))).slice(0, 2);
      }
      const proxDescoberta = plano.descoberta[orcamento.descoberta];
      if (!mais.length && proxDescoberta && !feitas.has(normalizar(proxDescoberta))) mais.push({ consulta: proxDescoberta, idioma: 'pt-BR', geral: true });
      if (!mais.length) motivoSegundaRodada = 'sem consulta nova: todas as da bateria e da descoberta já tinham rodado';
      const novas = [];
      for (const q of mais) {
        novas.push(...(await rodar(q.consulta, focoDescoberta, '', q.geral ? 'descoberta' : 'comunidade', q.geral ? {} : { idioma: q.idioma, comunidade: true })));
      }
      segundaRodada = mais.length;
      if (mais.length && !novas.length) motivoSegundaRodada = 'as buscas novas não trouxeram leitura';
      if (novas.length) {
        achadas.push(...novas);
        const mais2 = await extrair(novas);
        porTopico.push(...mais2.porTopico);
        const novosNomes = [...mais2.recomendados, ...lerCandidatos(await pedirNomes(novas.filter((e) => !ehTopico(e)).length ? novas.filter((e) => !ehTopico(e)) : novas), listaMax)];
        const canon2 = canonizarNomes([...nomes, ...novosNomes], achadas.map(textoDaEntrada).join('\n').slice(0, 200000));
        for (const ev of livro.itens) if (ev.produto && canon2.has(ev.produto)) ev.produto = canon2.get(ev.produto);
        for (const bruto of novosNomes) {
          const n = canon2.get(bruto) || bruto;
          if (!nomesDoModelo.has(normalizar(n))) {
            nomes.push(n);
            nomesDoModelo.add(normalizar(n));
          }
        }
        ranqueados = montar();
      }
    } else {
      motivoSegundaRodada = `não precisou: ${ranqueados.length} opções na lista`;
    }
    const origemNomes = extrasDoPadrao.length ? (nomes.length ? 'modelo+padrao' : 'padrao') : 'modelo';
    // 14/10: o MODELO confere se cada opção é do tipo pedido (HD650 e HyperX
    // Cloud III numa lista de intra-auriculares; "IEMs planares" como opção)
    const tipoPedido = rotuloDaCategoria(objetivo) || cadeia?.produto || '';
    if (tipoPedido && config.conferirCategoria !== false && ranqueados.length) {
      const fora = lerForaDaCategoria(
        await chamarModelo(prompts.pedidoDeCategoria({ tipo: tipoPedido, nomes: ranqueados.slice(0, 15).map((c) => c.nome) }), { tipo: 'categoria', numPredict: 350 }),
        ranqueados.slice(0, 15).map((c) => c.nome)
      );
      for (const nome of fora) emitir('descarte', { etapa: 'categoria', alvo: nome, motivo: `não é ${tipoPedido} (conferido pelo modelo)` });
      if (fora.size) ranqueados = ranqueados.filter((c) => !fora.has(c.nome));
    }
    finalistas = escolherPorConsenso(ranqueados, orcamento.finalistas);
    outros = ranqueados.filter((v) => !finalistas.includes(v)).slice(0, Math.max(5, listaMax - finalistas.length, quantidade - finalistas.length));
    conhecidos = [...new Set([...nomes, ...extrasDoPadrao, ...ranqueados.map((c) => c.nome), ...foraDaCategoria])];
    const propostos = nomes.length + extrasDoPadrao.length;
    const resumoDe = (c) => ({
      nome: c.nome,
      sites: c.dominios.length,
      topicos: c.consenso.topicos,
      editoriais: c.consenso.editoriais,
      elogios: c.consenso.elogios,
      criticas: c.consenso.criticas,
      pontos: c.pontos,
      mencoes: c.consenso.mencoes || 0,
      citacoes: (c.consenso.citacoes || []).map((x) => ({ texto: x.texto.slice(0, 160), fonte: x.fonte, votos: x.votos, tom: x.tom })),
      motivo: c.consenso.motivo?.texto || '',
    });
    emitir('pesquisa-candidatos', {
      origem: origemNomes,
      // o que o modelo respondeu de fato — pra revisar execução real
      resposta: String(resposta || '').slice(0, 500),
      propostos,
      descartados: Math.max(0, propostos - ranqueados.length),
      finalistas: finalistas.map(resumoDe),
      outros: outros.map((o) => o.nome),
      lista: ranqueados.slice(0, listaMax).map(resumoDe),
      segundaRodada,
      motivoSegundaRodada,
      foraDaCategoria,
      criteriosDoMaterial: doMaterial.map((k) => k.nome),
      // Etapa C: o que a extração por tópico achou em cada tópico
      topicos: porTopico,
    });
    for (const nome of foraDaCategoria) emitir('descarte', { etapa: 'categoria', alvo: nome, motivo: 'não é da categoria pedida (headset/over-ear num pedido de intra, por exemplo)' });
    if (!finalistas.length) return { ok: false, motivo: 'nenhuma opção concreta no material', plano, buscas, consultas, entradas };
  }

  // Etapa E: critério que o pedido não sustenta sai antes da matriz
  {
    const { criterios, fora } = filtrarCriteriosDoPedido(plano.criterios, objetivo, { perfil });
    plano.criterios = criterios;
    for (const k of fora) emitir('descarte', { etapa: 'criterio', alvo: k.nome, motivo: k.motivo });
  }

  // 2b. comparação de produtos nomeados: o confronto direto (benchmark no
  // uso real e o que a comunidade diz de "A vs B") antes da ficha de cada um
  const comparacao = finalistas.length >= 2 && finalistas.every((f) => f.citadaPeloUsuario);
  if (comparacao) {
    const [a, b] = finalistas.map((f) => f.nome);
    const usoCurto = plano.tipoDeUso || plano.uso;
    await rodar(`${a} vs ${b} ${/jog|game|fps/i.test(`${usoCurto} ${objetivo}`) ? 'benchmark jogos fps 1440p 4k' : 'comparativo teste'}`, `${a} × ${b}: diferença medida no uso real (${usoCurto}), números e testes práticos`, '', 'comparativo');
    await rodar(`site:reddit.com ${a} vs ${b}`, `${a} × ${b}: o que quem usou diz, qual escolheriam e por quê`, '', 'comunidade', { idioma: 'all', comunidade: true });
  }

  // 3. investigação: uma busca por finalista
  const investigar = async (f) => {
    await rodar(consultaDeFicha(f.nome, rotuloDaCategoria(objetivo, f.nome)), `${f.nome}: especificações técnicas (números e características do fabricante ou da loja)`, f.nome, 'ficha');
    await rodar(consultaDeComunidade(f.nome), `${f.nome}: o que quem usou diz na prática (prós, contras, experiência para ${plano.uso})`, f.nome, 'comunidade', {
      idioma: 'all',
      comunidade: true,
    });
  };
  // as 2 buscas de cada finalista (ficha + comunidade) são independentes entre si
  adiantar(finalistas.flatMap((f) => [{ consulta: consultaDeFicha(f.nome, rotuloDaCategoria(objetivo, f.nome)) }, { consulta: consultaDeComunidade(f.nome), idioma: 'all', comunidade: true }]));
  for (const f of finalistas) await investigar(f);

  // Etapa E (14º teste real): a FICHA confere a categoria — o SteelSeries
  // Arctis 1 passou como "intra" e a ficha lida dizia "Headset" com todas as
  // letras. Finalista de outro tipo sai e o próximo da lista entra.
  const categoriaPedida = categoriaDoPedido(objetivo);
  if (categoriaPedida?.exclui && !finalistas.every((f) => f.citadaPeloUsuario)) {
    const reservas = [...outros];
    // no máximo 2 trocas na execução inteira (cada troca custa 2 buscas); sem
    // reserva, o finalista FICA (com o descarte registrado) — nunca some
    let trocas = 0;
    for (let i = 0; i < finalistas.length; i += 1) {
      let f = finalistas[i];
      while (trocas < 2 && reservas.length && fichaDeOutroTipo(f.nome, entradas.filter((e) => e.opcao === f.nome && e.tipoBusca === 'ficha'), categoriaPedida)) {
        emitir('descarte', { etapa: 'ficha', alvo: f.nome, motivo: 'a ficha técnica diz que é de outro tipo (headset/over-ear)' });
        trocas += 1;
        f = reservas.shift();
        await investigar(f);
      }
      finalistas[i] = f;
    }
    outros = reservas;
  }

  // 4-5. matriz e lacunas
  // Julgamento ANTES das lacunas (9º teste real, 2026-09-25): a busca de
  // lacuna era escolhida pela matriz textual, onde "atraso" já parecia
  // coberto (frases genéricas com a palavra) — o juiz depois descartou o
  // atraso de 4 das 5 opções, mas as 3 buscas de lacuna já tinham ido pra
  // "Conectividade tri-modo compatibilidade com PC". Agora: matriz → juiz →
  // lacuna do que o juiz deixou vazio → matriz de novo → juiz de novo.
  const julgar = (m) => julgarCelulas({ matriz: m, finalistas, criterios: plano.criterios, uso: plano.uso, chamarModelo, entradas });
  const novaMatriz = () => montarMatriz({ finalistas, criterios: plano.criterios, entradas, conhecidos });
  let matriz = novaMatriz();
  let coberturaTextual = matriz.cobertura;
  matriz = await julgar(matriz);

  // revisão v6 — evidência mínima: finalista que, depois da ficha e da
  // comunidade, não tem evidência em NENHUM critério E tem respaldo fraco
  // (no máximo 1 tópico que recomenda) sai, e o próximo da lista que tem
  // alguma recomendação entra. O "HyperX Clouds" — nome tirado de um
  // comentário que criticava sites pagos — ficou em 5º com "sem dados" em
  // tudo. Recomendado em 2+ tópicos fica mesmo sem critério (a comunidade
  // já é evidência). No máximo 2 trocas; sem reserva, fica.
  if (!finalistas.every((f) => f.citadaPeloUsuario)) {
    let trocas = 0;
    const semEvidencia = (f) => (f.consenso?.topicos || 0) <= 1 && plano.criterios.every((k) => !matriz.celula(f.nome, k.nome)?.dominios?.size);
    const reservas = outros.filter((o) => (o.consenso?.topicos || 0) + (o.consenso?.editoriaisDoUso || 0) >= 1);
    for (let i = 0; i < finalistas.length && trocas < 2; i += 1) {
      if (!semEvidencia(finalistas[i]) || !reservas.length) continue;
      emitir('descarte', { etapa: 'evidencia', alvo: finalistas[i].nome, motivo: 'nenhum critério com evidência depois da ficha e da comunidade' });
      const proximo = reservas.shift();
      finalistas[i] = proximo;
      trocas += 1;
      await investigar(proximo);
      matriz = await julgar(novaMatriz());
      i -= 1; // confere o que entrou
    }
    if (trocas) {
      outros = outros.filter((o) => !finalistas.includes(o));
      coberturaTextual = matriz.cobertura;
    }
  }
  if (matriz.cobertura < COBERTURA_SUFICIENTE && orcamento.lacunas) {
    const consultas = consultasDeLacuna({ matriz, finalistas, criterios: plano.criterios, maximo: orcamento.lacunas, objetivo });
    adiantar(consultas.map((consulta) => ({ consulta })));
    for (const consulta of consultas) {
      const nome = finalistas.find((f) => consulta.startsWith(f.nome))?.nome || '';
      await rodar(consulta, `${nome}: o que o material diz sobre ${consulta.slice(nome.length).trim()}`, nome, 'lacuna');
    }
    if (consultas.length) {
      const nova = novaMatriz();
      coberturaTextual = nova.cobertura;
      matriz = await julgar(nova);
    }
  }
  emitir('pesquisa-matriz', {
    coberturaTextual,
    descartadas: finalistas.flatMap((f) => plano.criterios.filter((k) => matriz.celula(f.nome, k.nome)?.descartada).map((k) => ({ candidato: f.nome, criterio: k.nome }))),
    cobertura: matriz.cobertura,
    buscas,
    lacunas: matriz.lacunas.map(({ candidato, criterio }) => ({ candidato, criterio })),
    opcoes: finalistas.map((f) => f.nome),
    criterios: plano.criterios.map((k) => k.nome),
    resumos: finalistas.map((f) => ({ opcao: f.nome, ...(matriz.resumos?.get(f.nome) || {}) })),
  });

  // 5c. hipóteses do mapa conferidas no material
  const hipoteses = mapa ? await avaliarHipoteses({ mapa, uso: plano.uso, entradas, chamarModelo }) : [];
  if (hipoteses.length) emitir('pesquisa-hipoteses', { hipoteses });

  // 5d. ordem final pela evidência (critérios com veredito + recomendação da comunidade);
  // opção citada pelo usuário ganha o consenso aqui (citações da comunidade)
  finalistas = finalistas.map((f) => (f.consenso ? f : { ...f, consenso: consensoDe(f.nome, entradas, config, { termos: termosDeUso }) }));
  finalistas = ordenarPorEvidencia(finalistas, matriz, plano.criterios);
  emitir('pesquisa-ordem', { ordem: finalistas.map((f) => ({ nome: f.nome, nota: f.notaFinal, evidencia: f.evidencia, altos: f.positivosAltos, status: f.status })) });
  // Etapa E: o que cada célula afirma vai pro livro de evidências (com o status)
  for (const f of finalistas) {
    for (const k of plano.criterios) {
      const c = matriz.celula(f.nome, k.nome);
      if (!c?.dominios?.size) continue;
      const t = c.trechos[0] || {};
      livro.adicionar({ tipo: 'avaliacao', produto: f.nome, criterio: k.nome, valor: c.status || null, trecho: c.veredito || t.texto || '', url: t.url || '', fonte: [...c.dominios].slice(0, 3).join(', '), origem: c.deduzido ? 'deducao' : 'matriz' });
    }
  }

  // Etapa C: o livro de evidências vai pro registro (IDs, trecho literal, fonte)
  emitir('pesquisa-evidencias', { total: livro.tamanho, itens: livro.serializar(300) });

  // 6. plano da resposta
  return {
    ok: true,
    modo: 'recomendacao',
    avaliacao,
    quantidade,
    livro,
    mapa,
    hipoteses,
    plano,
    finalistas,
    outros,
    matriz,
    buscas,
    consultas,
    entradas,
    precos: precosDasOpcoes(entradas, finalistas),
    planoDeResposta: planoDeResposta({ plano, finalistas, outros, matriz, quantidade, mapa, hipoteses, comparacao }),
    listaNumerada: listaNumerada({ finalistas, outros, quantidade }),
    resumo: resumoParaDecisao({ plano, finalistas, matriz, buscas }),
  };
}

module.exports = {
  // 2026-10-10: preço observado por opção da recomendação
  precosDasOpcoes,
  // revisão v6
  nomesNaFrase,
  falaDeOutroProduto,
  outrosProdutos,
  citaNaFrase,
  tokensDoModelo,
  escolhaDeOutro,
  semComentariosDeBot,
  deOutroTipo,
  consensoDe,
  rankearPorConsenso,
  escolherPorConsenso,
  categoriaDoPedido,
  semRecursoPendurado,
  citadoNaCategoria,
  filtrarPorCategoria,
  fichaDeOutroTipo,
  lerMapaDoProblema,
  trechosParaHipotese,
  lerAvaliacaoDeHipoteses,
  coerenteComMotivo,
  completarComPerfis,
  completarComComunidade,
  lerCadeiaDoUso,
  lerCriteriosDoConhecimento,
  combinarCriterios,
  filtrarCriteriosDoPedido,
  pesarCriteriosPelaComunidade,
  ordenarPorEvidencia,
  statusDaCelula,
  produtosDaComparacao,
  consultasDeConhecimento,
  termosDoUso,
  comentariosDe,
  tomDoComentario,
  bateriaDaComunidade,
  assuntoDaComunidade,
  selecionarTopicos,
  comentariosNumerados,
  lerProdutosDoTopico,
  canonizarNomes,
  extrairDaComunidade,
  contextoDoTopico,
  respostaDireta,
  absorverSeries,
  listaNumerada,
  respaldoDe,
  avaliarHipoteses,
  ehPedidoDeRecomendacao,
  modoDaPesquisa,
  lerPlanoDePesquisa,
  semPreposicaoPendurada,
  lerCandidatos,
  validarCandidatos,
  materialParaCandidatos,
  candidatosPorPadrao,
  pareceNomeDeProduto,
  escolherFinalistas,
  mencionaNome,
  produtoUnicoDoPedido,
  lerEntendimento,
  lerForaDaCategoria,
  rotuloDaCategoria,
  normalizarTexto: normalizar,
  consultaDeFinalista,
  consultaDeFicha,
  consultaDeComunidade,
  quantidadePedida,
  juntarVariantes,
  semCondicaoInventada,
  limparCriterios,
  trechosDoTipo,
  montarMatriz,
  consultasDeLacuna,
  limparTermoDeBusca,
  lerCriteriosDoMaterial,
  lerJulgamento,
  semRestoDoPrompt,
  ecoDaInstrucao,
  julgarCelulas,
  planoDeResposta,
  resumoParaDecisao,
  executarPesquisaPlanejada,
  comparativoDeDesempenho,
  usoProfissional,
  precosObservados,
  ORCAMENTO_POR_NIVEL,
  COBERTURA_SUFICIENTE,
};
