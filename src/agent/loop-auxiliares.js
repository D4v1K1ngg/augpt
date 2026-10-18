'use strict';

/**
 * Funções e constantes de apoio do laço do agente (loop.js): não usam `this`,
 * só recebem dados e devolvem dados. Saíram de loop.js em 2026-10-11 sem
 * mudança de comportamento.
 */

const tools = require('../tools');
const { tipoDeFonte } = require('../tools/comunidade');
const protocolo = require('./protocolo');
const { LOJAS_CONHECIDAS } = require('../tools/compras');

/** Texto extra do cartão de aprovação quando o motivo não é o risco da
 * ferramenta em si, e sim o conteúdo do pedido (Fase 1 de segurança). */
function motivoDeAprovacao(nome, argumentos, estado) {
  if (tools.urlPodeVazarDados(nome, argumentos, estado)) {
    return 'Este endereço não apareceu no seu pedido nem em nenhuma busca ou página lida nesta execução, ' +
      'e carrega dados no próprio link. Confira se ele não leva informação sua pra um site desconhecido.';
  }
  return null;
}

/** Ações cuja aprovação recebe uma segunda opinião focada nesta chamada específica. */
const CRITICA_OBRIGATORIA = new Set(['apagar_arquivo', 'executar_comando']);

// Subagente crítico (versão leve, "Copiloto" nível 1 — mesmo modelo em uso):
// diferente da segunda opinião acima — que só olha UMA ação de risco alto
// antes dela rodar — esta questiona o PLANO como um todo de tempos em tempos.
// A cada N passos, ou quando duas falhas seguidas sugerem que o caminho não
// está funcionando. Valores abaixo são só o PADRÃO — configuráveis via
// `criticaPeriodicaIntervalo`/`criticaPeriodicaMax` (ver uso mais abaixo),
// pra quem quiser ajustar sem mexer em código.
const CRITICA_PERIODICA_INTERVALO = 5;
const CRITICA_PERIODICA_MAX = 2;
// Pedidos classificados como complexos (verificador.classificarPedido) usam
// um teto mais generoso — combinado com o Davi: para um modelo local, tempo
// de resposta não é o problema, volatilidade é. Rever o plano com mais
// frequência custa mais chamadas, não mais risco de resposta pior (a
// crítica nunca bloqueia a rodada atual, só entra como observação pra
// próxima — ver criticaDoPlano abaixo).
//
// Caso real (prova de 10 questões, DeepSeek R1 8B): pediu explicitamente
// pra este "Copiloto" acompanhar quase todo passo em pedido complexo, mesmo
// custando mais latência — intervalo 1 (toda iteração) e teto bem mais alto
// que o anterior (2→6). Configurável via `criticaPeriodicaIntervaloComplexo`/
// `criticaPeriodicaMaxComplexo`.
const CRITICA_PERIODICA_INTERVALO_COMPLEXO = 1;
const CRITICA_PERIODICA_MAX_COMPLEXO = 6;
const STATUS_CRITICO = new Set(['continuar', 'replanejar', 'perguntar', 'concluir', 'bloquear']);

// Reescrita item-a-item (ver uso em `executar`, correção pós-verificação):
// teto de partes corrigidas numa única reescrita. `decomporPedido` já capa em
// 20 partes — este teto é só uma segunda trava, pra nunca encadear uma
// corrente enorme de chamadas extras num pedido patológico, mesmo com o Davi
// dizendo que não se importa com a latência.
const MAX_PARTES_POR_REESCRITA = 12;
const MAX_REPLANEJAMENTOS = 2;
// 'plano' aqui é o sinal da crítica periódica de N-em-N passos
// (`criticaDoPlano`, ver mais abaixo) — o rótulo "periódica" que aparece no
// relatório da execução (`registro.js`, campo de exibição) é só isso, um
// rótulo de exibição; o valor real passado a `aplicarRecomendacaoCritico`
// pra essa crítica sempre foi a string 'plano', então "replanejar" vindo
// dela já funcionava antes desta rodada. Ver comentário mais abaixo, no
// gate de "perguntar" — lá sim havia uma lacuna real.
const FASES_QUE_PODEM_REPLANEJAR = new Set([
  'plano',
  'direcao-pesquisa',
  'parte-concluida',
  'pre-redacao',
  'sob-demanda',
]);

function extrairRecomendacaoCritico(texto) {
  const objeto = protocolo.extrair(texto);
  if (!objeto || !STATUS_CRITICO.has(String(objeto.status || '').toLowerCase())) return null;
  return {
    status: String(objeto.status).toLowerCase(),
    problema: String(objeto.problema || '').trim().slice(0, 600),
    subtarefa: String(objeto.subtarefa || '').trim().slice(0, 240) || null,
    evidenciaFaltante: String(objeto.evidenciaFaltante || '').trim().slice(0, 500) || null,
    proximaEstrategia: String(objeto.proximaEstrategia || '').trim().slice(0, 600) || null,
  };
}

/** Extrai o primeiro objeto JSON de uma resposta, tolerando ruído do modelo. */
function extrairJSON(texto) {
  const limpo = String(texto)
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(limpo);
  } catch {
    /* tenta recortar */
  }
  const inicio = limpo.indexOf('{');
  if (inicio === -1) return null;
  let profundidade = 0;
  let dentroDeString = false;
  let escape = false;
  for (let i = inicio; i < limpo.length; i += 1) {
    const c = limpo[i];
    if (escape) {
      escape = false;
    } else if (c === '\\') {
      escape = true;
    } else if (c === '"') {
      dentroDeString = !dentroDeString;
    } else if (!dentroDeString) {
      if (c === '{') profundidade += 1;
      if (c === '}') {
        profundidade -= 1;
        if (profundidade === 0) {
          try {
            return JSON.parse(limpo.slice(inicio, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Argumentos de uma chamada de ferramenta, curtos, pro registro (Etapa A,
 * 2026-09-28): consulta, foco, URL, opção... Texto longo (conteúdo de
 * arquivo, código) vira só o tamanho.
 */
function resumoDeArgumentos(argumentos) {
  if (!argumentos || typeof argumentos !== 'object') return null;
  const saida = {};
  for (const [k, v] of Object.entries(argumentos).slice(0, 8)) {
    if (v == null) continue;
    if (typeof v === 'string') saida[k] = v.length > 300 ? `(${v.length} caracteres)` : v;
    else if (typeof v === 'number' || typeof v === 'boolean') saida[k] = v;
    else if (Array.isArray(v)) saida[k] = v.slice(0, 6).map((x) => (typeof x === 'string' ? x.slice(0, 160) : typeof x));
    else saida[k] = '(objeto)';
  }
  return Object.keys(saida).length ? saida : null;
}

/**
 * Fontes do rodapé da resposta (Etapa B, 14º teste real): antes era a lista
 * que o modelo passou em "responder" — saíram mercadolivre, jbl.com.br e
 * "como escolher um curso superior", e nenhum dos 20 tópicos usados. Agora:
 * o que a pesquisa planejada citou vem primeiro; do modelo, só URL que foi
 * LIDA de verdade (está no dossiê); loja só quando o assunto é preço.
 */
function fontesDaResposta({ doModelo = [], daPesquisa = [], dossie = [], preco = false, maximo = 10 }) {
  const lidas = new Set(dossie.map((d) => String(d.url || '').replace(/[#].*$/, '')).filter(Boolean));
  const semLoja = (u) => preco || tipoDeFonte(u) !== 'loja';
  const chave = (u) => String(u).replace(/[#?].*$/, '').replace(/\/$/, '');
  const vistos = new Set();
  const saida = [];
  const pegar = (u, exigeLida) => {
    const url = String(u || '').trim();
    if (!/^https?:\/\//.test(url) || !semLoja(url)) return;
    if (exigeLida && !lidas.has(url.replace(/[#].*$/, '')) && ![...lidas].some((l) => chave(l) === chave(url))) return;
    if (vistos.has(chave(url))) return;
    vistos.add(chave(url));
    saida.push(url);
  };
  daPesquisa.forEach((u) => pegar(u, false));
  (Array.isArray(doModelo) ? doModelo : [doModelo]).forEach((u) => pegar(u, true));
  return saida.slice(0, maximo);
}

/**
 * Item de plano que nenhuma ferramenta cumpre (Etapa B, 14º teste real):
 * ação no mundo (contatar, entrevistar, comprar, testar pessoalmente) ou
 * metodologia sem ação ("definir as plataformas", "planejar a abordagem").
 * Devolve o motivo, ou null quando o item é executável.
 */
// ancorado no COMEÇO do item: "Pesquisar onde comprar o KZ EDX Pro" é executável
const ACAO_IMPOSSIVEL =
  /^\s*(contatar|contactar|entrar em contato|entre em contato|entrevistar|ligar para|telefonar|enviar (um )?e-?mail|mandar (um )?e-?mail|perguntar (a|as|aos|para as|para os) (marcas|fabricantes|empresas|jogadores|profissionais|times|equipes)|visitar (a |uma )?(loja|feira|evento)|comprar (o|a|os|as|um|uma)|testar pessoalmente|experimentar pessoalmente|contact|interview|reach out)\b/i;
const ITEM_DE_METODO =
  /^(definir|identificar|determinar|escolher|selecionar|mapear|listar|estabelecer|levantar)\s+(as |os |quais |a |o )?(plataformas|fontes|sites|canais|ferramentas|metodos|métodos|metodologia|estrategia|estratégia|abordagem|palavras[- ]chave|termos de busca|criterios de busca|critérios de busca|locais de pesquisa|onde pesquisar)\b|^(planejar|organizar|revisar|reavaliar)\s+(a |o )?(pesquisa|plano|abordagem|estrategia|estratégia)\b/i;
function itemNaoExecutavel(texto, objetivo = '', tipo = '') {
  const t = String(texto || '').trim();
  if (ACAO_IMPOSSIVEL.test(t)) return 'ação que nenhuma ferramenta executa';
  if (ITEM_DE_METODO.test(t)) return 'metodologia, não ação — a busca em si é o passo';
  return itemForaDoPedido(t, objetivo, tipo);
}

/**
 * Revisão v4 (07/10): o prompt do plano listava "pesquisar, ler, calcular,
 * gerar um arquivo, responder" e o 7B copiava o cardápio — todo plano vinha
 * com "Calcular a diferença de preço entre lojas", "Calcular a
 * compatibilidade entre o fone e os jogos FPS", "Gerar um resumo
 * comparativo". O portão do checklist vetava o responder por causa deles e
 * o status saía "parcial". Item de calcular/gerar/preço só fica quando o
 * PEDIDO fala disso; "pesquise o site" num pedido de agir no site sai.
 */
function itemForaDoPedido(texto, objetivo = '', tipo = '') {
  if (!objetivo) return null;
  const t = normalizar(texto);
  const p = normalizar(objetivo);
  if (/^calcul\w*/.test(t) && !/\b(calcul\w*|quant[oa]s?|soma\w*|some|somar|resolv\w*|determin\w*|deriv\w*|integr\w*|multipliq\w*|divid\w*|subtrai\w*|convert\w*|equac\w*|probabilidade\w*|media|porcent\w*|precos?|valor\w*|custa\w*|diferenca\w*|conta\w*)\b/.test(p) && !/\d\s*[-+*/x×÷=^]\s*\d/.test(p)) {
    return 'cálculo que o pedido não pediu';
  }
  if (/^(gerar|gere|criar|crie|produzir|produza|elaborar|elabore|montar|monte)\b/.test(t) && /\b(relatorio|resumo|arquivo|documento|planilha|tabela|grafico|pdf|comparativo)\b/.test(t) &&
    !/\b(relatorio|arquivo|documento|planilha|tabela|grafico|pdf|docx|xlsx|html|salv\w*|resum\w*)\b/.test(p)) {
    return 'arquivo/resumo que o pedido não pediu — a resposta já é o resumo';
  }
  if (/\b(precos?|marketplaces?|lojas?)\b/.test(t) && !/\b(precos?|valor\w*|custa\w*|compr\w*|lojas?|barat\w*|caro|vale a pena|orcamento|reais|r\$)/.test(p)) {
    return 'preço/loja que o pedido não pediu';
  }
  if (tipo === 'site' && /^(pesquis\w*|busqu\w*|procur\w*)\b/.test(t)) return 'pedido de agir no site: o caminho é o navegador, não a busca';
  return null;
}

const chars = (msgs) => msgs.reduce((n, m) => n + m.content.length, 0);

/** Só o que a próxima decisão precisa saber: qual ferramenta, com quais argumentos. */
const decisaoCompacta = (plano) =>
  JSON.stringify({ ferramenta: { nome: plano.ferramenta.nome, argumentos: plano.ferramenta.argumentos } });

/**
 * Monta as mensagens que vão ao modelo a partir do histórico.
 *
 * Resultado de ferramenta antigo vira uma linha. O conteúdo bruto já foi para o
 * dossiê — que é a memória da RESPOSTA. O histórico só precisa do bastante para
 * a PRÓXIMA decisão, e reler 6.000 caracteres do passo 3 no passo 12 não ajuda
 * a decidir nada; só ocupa a janela para sempre.
 */
const RESULTADOS_INTEGRAIS = 2;

function paraEnvio(historico) {
  const indicesDeResultado = historico
    .map((m, i) => (m.curto ? i : -1))
    .filter((i) => i >= 0);
  const manterIntegral = new Set(indicesDeResultado.slice(-RESULTADOS_INTEGRAIS));

  return historico.map((m, i) => ({
    role: m.role,
    content: m.curto && !manterIntegral.has(i) ? m.curto : m.content,
  }));
}

/**
 * Controlador v2 (05/10): o prompt de decisão CABE na janela. Nas execuções
 * longas ele subia até 9.100–9.215 tokens com numCtx 9.216 e parava ali — o
 * teto de quem está sendo cortado: o Ollama descartava o começo do prompt
 * sem avisar e não sobrava espaço pra resposta. A compactação antiga só
 * olhava o histórico; aqui entram o bloco fixo, o histórico e o estado.
 * Cortes, nesta ordem, só até caber: memória de tarefas passadas →
 * mensagens antigas encurtadas → estado encurtado → mensagens antigas
 * removidas (ficam a 1ª e as 4 últimas) → últimas encurtadas.
 * `razao` = caracteres por token (calibrada pelo prompt_eval_count real).
 */
function caberNaJanela({ sistema, historico = [], volatil = [], numCtx = 8192, reserva = 600, razao = 2.8 }) {
  const orcamento = Math.max(2000, numCtx - reserva - 300) * razao;
  let vol = [...volatil];
  let hist = paraEnvio(historico);
  const total = () => sistema.length + hist.reduce((n, m) => n + String(m.content).length, 0) + vol.join('\n\n').length;
  const encurtar = (m, teto) => (String(m.content).length > teto ? { ...m, content: `${String(m.content).slice(0, teto)} […]` } : m);
  const cortes = [];
  if (total() > orcamento) {
    const i = vol.findIndex((v) => /^MEMÓRIA RELEVANTE/.test(v));
    if (i >= 0) {
      vol.splice(i, 1);
      cortes.push('memoria');
    }
  }
  if (total() > orcamento) {
    hist = hist.map((m, i) => (i > 0 && i < hist.length - 4 ? encurtar(m, 300) : m));
    cortes.push('historico-antigo-encurtado');
  }
  if (total() > orcamento) {
    vol = vol.map((v) => (v.length > 1500 ? `${v.slice(0, 1500)} […]` : v));
    cortes.push('estado-encurtado');
  }
  // Remoção em BLOCOS de pares (decisão + resultado), não mensagem a
  // mensagem: (1) não deixa um resultado de ferramenta órfão da decisão que
  // o pediu; (2) o começo do prompt muda de uma vez só a cada tanto, em vez
  // de a cada passo — o Ollama reaproveita o cache do prefixo enquanto ele
  // não muda. Ficam a 1ª mensagem (o pedido) e as 4 últimas.
  let removidas = 0;
  while (total() > orcamento && hist.length > 5) {
    const bloco = Math.min(4, hist.length - 5);
    hist.splice(1, bloco - (bloco % 2) || 1);
    removidas += bloco - (bloco % 2) || 1;
  }
  if (removidas) cortes.push(`historico-removido:${removidas}`);
  // Último recurso: encurtar do mais ANTIGO pro mais novo. As 2 últimas
  // mensagens (a página que acabou de abrir, o veto que acabou de chegar)
  // ficam com pelo menos 4000 caracteres e o pedido com pelo menos 1000.
  const piso = (i) => (i === 0 ? 1000 : i >= hist.length - 2 ? 4000 : 0);
  for (const teto of [2000, 1000, 500]) {
    if (total() <= orcamento) break;
    vol = vol.map((v) => (v.length > teto ? `${v.slice(0, teto)} […]` : v));
    for (let i = 0; i < hist.length && total() > orcamento; i++) hist[i] = encurtar(hist[i], Math.max(teto, piso(i)));
    cortes.push(`ultimas-encurtadas:${teto}`);
  }
  const estimativaTokens = Math.round(total() / razao);
  return {
    mensagens: [{ role: 'system', content: sistema }, ...hist, ...(vol.length ? [{ role: 'system', content: vol.join('\n\n') }] : [])],
    estimativaTokens,
    orcamentoTokens: Math.round(orcamento / razao),
    cortes,
    // não coube nem com tudo cortado: quem chama avisa (contexto-saturado)
    estourou: total() > orcamento,
  };
}

/**
 * Caracteres por token medidos pelo prompt_eval_count real. Só DESCE
 * (revisão do Controlador v2): um passo com muito JSON/ASCII mede razão alta
 * e, se ela subisse, o passo seguinte (texto acentuado) estouraria a janela.
 * Limites [2.2, 3.6] seguram medições absurdas. Prompt no teto da janela
 * (≥ 95%) = o Ollama cortou: baixa 15% e avisa.
 */
function calibrarRazao(atual, caracteres, promptTokens, numCtx) {
  const base = atual || 2.8;
  if (!promptTokens || !numCtx) return { razao: base, saturado: false };
  // teto: 95% da janela, mas nunca abaixo de numCtx − 600 — o orçamento de
  // caberNaJanela deixa ~900 tokens de folga, e em janelas grandes (20k+) um
  // prompt que coube passava de 95% e virava "saturado" falso (revisão)
  // nunca AUMENTA a razão: depois de um 400 de contexto ela pode estar abaixo
  // de 2,2 (página de preço) e o prompt reenviado, no teto, a desfazia
  if (promptTokens >= Math.max(numCtx * 0.95, numCtx - 600)) return { razao: Math.min(base, Math.max(2.2, base * 0.85)), saturado: true };
  const r = caracteres / promptTokens;
  if (!(r > 1.8 && r < 5)) return { razao: base, saturado: false };
  return { razao: Math.min(base, Math.max(2.2, Math.min(3.6, r))), saturado: false };
}

/**
 * Quantas buscas uma execução pode fazer, por nível de profundidade.
 *
 * `alta` só é alcançado pelos níveis de raciocínio 'alto'/'extremo' (ver
 * NIVEIS_RACIOCINIO em config.js — nenhum outro nível usa esta profundidade)
 * — Davi pediu explicitamente (2026-09-23, junto do item 2 "descoberta de
 * autoridade em duas fases", ver tools/web.js) um teto maior pra esses dois
 * níveis, aceitando o custo: "mesmo que dê um peso a mais no modelo e
 * aumente o teto de busca". De 9 pra 11 — a busca extra da fase 1
 * (descoberta de autoridade) não conta neste teto (ela não passa pelo gate
 * de decisão do modelo, roda dentro de `pesquisar_e_ler`), então a folga
 * extra é pra fase 2 aproveitar melhor o material que a fase 1 ajudou a
 * priorizar, não pra compensar a fase 1 em si.
 */
const TETO_DE_BUSCAS = { normal: 4, media: 6, alta: 11 };

/**
 * "Chunking" de documento grande (pedido do Davi 2026-09-21, mesma conversa
 * do resumo de conversa acima): quantos pedaços de até MAXIMO_ENVIADO
 * caracteres (destilador.js) uma única leitura pode gerar, por nível de
 * profundidade — mesmo eixo que já limita TETO_DE_BUSCAS, reaproveitado em
 * vez de um campo de config novo. Ver _destilarGrande() abaixo.
 */
const TETO_DE_CHUNKS = { normal: 3, media: 6, alta: 12 };
const TETO_DE_CHUNKS_PESQUISA_PLANEJADA = 2;

/**
 * Divide um texto grande em pedaços de até `tamanho` caracteres, tentando
 * cortar em quebra de parágrafo (`\n\n`) pra não partir um fato ou número no
 * meio da frase. Quando não há quebra de parágrafo nenhuma perto o bastante
 * do limite (texto sem estrutura, ou um parágrafo sozinho maior que o
 * tamanho do pedaço), corta no tamanho mesmo — melhor um corte no meio de
 * uma frase do que um pedaço gigante fora do orçamento da destilação.
 */
function emPedacos(texto, tamanho) {
  const t = String(texto || '');
  if (t.length <= tamanho) return t ? [t] : [];

  const pedacos = [];
  let resto = t;
  while (resto.length > tamanho) {
    let corte = resto.lastIndexOf('\n\n', tamanho);
    if (corte < tamanho * 0.5) corte = tamanho; // sem parágrafo útil dentro do limite
    pedacos.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n+/, '');
  }
  if (resto) pedacos.push(resto);
  return pedacos;
}

/**
 * Peça 3 do plano de nível de raciocínio ("memória curta" — dossiê da
 * conversa aberta reaproveitado via `Memory`/`idConversa`, pedido do Davi
 * 2026-09-19): há quantos dias no máximo um item da MESMA conversa ainda é
 * reaproveitado sem buscar de novo (ver `Memory.buscar`,
 * `Memory.diasVelhoAgora`) — "leve"/"médio" usam o limite normal; "alto"/
 * "extremo" usam um limite mais curto (o plano original pedia reconfirmar
 * via uma nova busca + `confronto.js` antes de reaproveitar; optei por este
 * limite mais rígido em vez disso — reconfirmar de verdade custaria
 * exatamente a busca que a memória curta existe pra evitar, e um limite mais
 * apertado já cobre o espírito: nível mais alto confia menos num dado velho
 * sem checar de novo). Não tem constante própria pro plano original porque
 * ele não chegou a existir de verdade — ver AuGPT-plano-de-implementacao.md,
 * rodada de 2026-09-20.
 */
const LIMITE_DIAS_MEMORIA_CURTA = 7;
const LIMITE_DIAS_MEMORIA_CURTA_CAUTELOSO = 2;

/**
 * Ferramentas que produzem um arquivo de verdade — usado tanto para saber se
 * "escreveu" (devePensarEmTexto em finalizarComResposta) quanto para saber se
 * o pedido de arquivo já foi ao menos TENTADO (ver pedidoQuerArquivo acima).
 * Antes só `escrever_arquivo`/`acrescentar_ao_arquivo` contavam aqui — os quatro
 * `gerar_*` nativos (docx/xlsx/pdf/html) ficavam de fora por descuido, então
 * gerar um docx com sucesso não impedia o agente de redigir texto solto por
 * cima, como se nada tivesse sido escrito.
 */
const GERACOES_DE_ARQUIVO = ['gerar_docx', 'gerar_xlsx', 'gerar_pdf', 'gerar_html', 'escrever_arquivo', 'acrescentar_ao_arquivo'];

/**
 * Ferramentas que só LEEM e podem ser repetidas sem efeito colateral: falha
 * rápida e passageira (HTTP 429/5xx, conexão derrubada) ganha uma segunda
 * tentativa automática; timeout não (custaria outro timeout inteiro). Ver
 * tools/erros.js. Escrever, executar ou agir num site nunca se repete.
 */
const REPETIVEIS = new Set(['buscar_web', 'abrir_pagina', 'pesquisar_e_ler']);
/** Leituras cujo erro definitivo é anotado para o modelo não repetir a chamada. */
const ANOTAR_ERRO = new Set([...REPETIVEIS, 'ler_arquivo', 'ler_documento', 'inspecionar_arquivo', 'buscar_no_projeto']);

/**
 * Lista "top N" sem as opções que a resposta montada já trouxe em bloco
 * próprio ("#### 1. Simgot EM6L"). Sobra só o cabeçalho → nada a acrescentar.
 */
function listaSemOsComparados(lista, final) {
  const comparados = new Set([...String(final).matchAll(/^####\s+\d+\.\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase()));
  const linhas = String(lista).split('\n');
  const itens = linhas.filter((l) => /^\d+\.\s/.test(l.trim()));
  const restantes = itens.filter((l) => {
    const nome = (/\*\*(.+?)\*\*/.exec(l) || [])[1];
    return !nome || !comparados.has(nome.trim().toLowerCase());
  });
  if (!restantes.length) return '';
  if (restantes.length === itens.length) return lista;
  const cabecalho = linhas.filter((l) => l.trim() && !/^\d+\.\s/.test(l.trim()));
  return [...cabecalho, ...restantes].join('\n');
}

/** Ferramentas cujo resultado alimenta o dossiê da redação. */
const LEITURAS = [
  'buscar_web', 'abrir_pagina', 'pesquisar_e_ler',
  'ler_arquivo', 'ler_documento', 'inspecionar_arquivo', 'buscar_no_projeto',
  // navegação também produz conteúdo: a resposta costuma estar justamente na
  // página que apareceu DEPOIS do clique
  'navegar', 'ver_pagina', 'clicar', 'preencher_campo', 'enviar_formulario', 'voltar_pagina', 'rolar_pagina',
];

// Palavras que aparecem no pedido mas não identificam o ASSUNTO dele.
const VAZIAS = new Set([
  // interrogativas e conectivos
  'para', 'como', 'qual', 'quais', 'quem', 'onde', 'quando', 'porque', 'sobre', 'esse', 'essa',
  'este', 'esta', 'isso', 'aquilo', 'nao', 'sim', 'com', 'sem', 'por', 'dos', 'das', 'nos', 'nas',
  'que', 'uma', 'uns', 'mais', 'menos', 'muito', 'pouco', 'todos', 'todas', 'algum', 'alguma',
  'outro', 'outra', 'meu', 'minha', 'seu', 'sua', 'dele', 'dela', 'entao', 'tambem', 'apenas',
  'ainda', 'seja', 'sendo', 'foram', 'estao', 'pelos', 'pelas',
  // verbos de pedido
  'pode', 'consegue', 'fazer', 'quero', 'preciso', 'conte', 'fale', 'diga', 'mostre', 'liste',
  'explique', 'realize', 'gere', 'crie', 'faca', 'traga', 'busque', 'pesquise', 'procure',
  'gostaria', 'poderia', 'detalhes', 'detalhado', 'informacoes', 'resposta', 'pergunta',
  // tempo e lugar genéricos
  'nesta', 'neste', 'nessa', 'nesse', 'semana', 'dias', 'hoje', 'amanha', 'agora', 'atualmente',
  'proximos', 'proxima', 'ultimo', 'ultima', 'ano', 'mes',
  // termos do próprio sistema
  'rodando', 'localmente', 'pesquisa', 'saber', 'arquivos', 'arquivo', 'material', 'fontes',
  // revisão v4 (Kinera): "veja pra min se…" — "veja" virou termo a cobrir e foi colado nas buscas
  'veja', 'vejam', 'olhe', 'confira', 'min', 'mim', 'pra', 'pro', 'realize', 'favor',
]);

const normalizar = (t) =>
  String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Controlador v2 (05/10): ações do navegador que dependem da PÁGINA em que
 * acontecem — "clicar [3]" na tela de login e "clicar [3]" na tela do
 * contracheque são ações diferentes.
 */
const ACOES_DE_PAGINA = new Set(['clicar', 'preencher_campo', 'enviar_formulario', 'ver_pagina', 'voltar_pagina', 'rolar_pagina']);
const ehAcaoDeNavegador = (nome) => ACOES_DE_PAGINA.has(nome) || nome === 'navegar';

/** Argumentos em forma estável (chaves ordenadas), sem campos que não mudam a ação. */
function argumentosCanonicos(argumentos = {}) {
  const IGNORAR = new Set(['paginas', 'limite', 'caracteres_por_pagina', 'idioma']);
  const chaves = Object.keys(argumentos || {}).filter((k) => !IGNORAR.has(k)).sort();
  // "3" e 3 são o mesmo elemento (o 7B manda número como texto às vezes)
  const valor = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);
  return JSON.stringify(chaves.map((k) => [k, valor(argumentos[k])])).toLowerCase().slice(0, 200);
}

/**
 * Chave do guarda de repetição. Antes era nome + (consulta|url|caminho|
 * motivo|objetivo): clicar e preencher_campo não têm nenhum desses, então
 * TODO clique da execução virava "a mesma ação" e o 3º era barrado — no
 * contracheque (05/10) o agente chegou na tela certa no passo 7 e foi
 * barrado 15 vezes dali em diante. Agora: os argumentos inteiros e, nas
 * ações de página, a impressão digital da página onde acontecem.
 */
function chaveDeRepeticao(nome, argumentos = {}, pagina = null, preenchidos = null) {
  const campo = argumentos.consulta || argumentos.url || argumentos.caminho || argumentos.motivo || argumentos.objetivo;
  if (campo && !ACOES_DE_PAGINA.has(nome)) return `${nome}|${String(campo).toLowerCase().slice(0, 60)}`;
  if (!ACOES_DE_PAGINA.has(nome)) return `${nome}|${argumentosCanonicos(argumentos)}`;
  // Valores digitados não aparecem na leitura (senha): "enviar" depois de
  // corrigir a senha tem a mesma impressão de página mas é OUTRA tentativa.
  const valores = preenchidos && Object.keys(preenchidos).length ? `#${hashCurto(JSON.stringify(Object.entries(preenchidos).sort()))}` : '';
  return `${nome}|${argumentosCanonicos(argumentos)}@${pagina?.impressao || ''}${valores}`;
}
function hashCurto(t) {
  let h = 0;
  for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Item do checklist que uma AÇÃO cumpriu (não só leitura): clicar no
 * elemento "Contracheque" cumpre "Clique em contracheque na página inicial";
 * navegar até o site cumpre "Acesse o site …". Casa pelo rótulo do elemento
 * (ou valor/URL) escrito no item.
 */
const VERBOS_DE_ACAO = /\b(acess\w*|abr(?:a|e|ir|indo)\b|entr(?:e|ar|em|ando)\b|cliqu\w*|clic\w*|preench\w*|digit\w*|envi[ae]\w*|selecion\w*|marqu\w*|baix[ae]\w*|emit\w*|fa[cç]a\s+login|logu?e\w*|naveg\w*|v[aá]\s+para|compar\w*|pesquis\w*|busqu\w*|anot\w*|resum\w*|escrev\w*|redij\w*|respond\w*|verifiqu\w*|confir\w*)/g;
// Que verbo cada ação pode cumprir (texto já sem acento). Clicar no link
// "Contracheque" cumpre "Clique/Acesse/Abra contracheque", nunca "Baixe o
// contracheque" — o download não aconteceu (2ª revisão).
const VERBO_QUE_A_ACAO_CUMPRE = {
  clicar: /^(cliqu|clic|acess|abr|entr|selecion|marqu|escolh|va\s+para|naveg)/,
  navegar: /^(acess|abr|entr|naveg|va\s+para)/,
  preencher_campo: /^(preench|digit)/,
  enviar_formulario: /^(envi|entr|confir|fa[cç]a\s+login|logu?e)/,
};
function itemDaAcao(checklist = [], { nome, rotulo = '', url = '' } = {}) {
  const n = (t) => normalizar(t).replace(/[^a-z0-9]+/g, ' ').trim();
  let host = '';
  if (nome === 'navegar' && url) {
    try {
      host = n(new URL(url).hostname.replace(/^www\./, ''));
    } catch {
      /* url inválida */
    }
  }
  const alvo = rotulo && n(rotulo).length >= 4 ? n(rotulo) : '';
  if (!alvo && !host) return null;
  return (
    checklist.find((i) => {
      if (i.status !== 'pendente') return false;
      const texto = ` ${n(i.texto)} `;
      // Item com mais de uma ação ("acesse o site e baixe o PDF") não é
      // cumprido por UMA ação só — revisão do Controlador v2. O rótulo do
      // elemento sai antes de contar ("Clique em Emitir": "Emitir" é o alvo,
      // não um segundo verbo).
      const semAlvo = alvo ? texto.split(` ${alvo} `).join(' ') : texto;
      const verbos = semAlvo.match(VERBOS_DE_ACAO) || [];
      if (verbos.length > 1) return false;
      if (verbos.length === 1 && !(VERBO_QUE_A_ACAO_CUMPRE[nome] || /^$/).test(verbos[0])) return false;
      // substantivo de entrega ("Entrega do contracheque em PDF", "download")
      // só se cumpre quando o próprio elemento é isso — sai junto com o rótulo
      if (/\b(entreg\w*|download\w*|pdf|envio|emissao|impress\w*|arquivo|salv\w*|export\w*)\b/.test(semAlvo)) return false;
      // "Preencher usuário e senha" não fica feito com só o usuário
      if (nome === 'preencher_campo' && / e /.test(semAlvo)) return false;
      // Item que cita outro site além deste não é cumprido navegando só neste.
      const hostsDoItem = (normalizar(i.texto).match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/g) || []).map((h) => n(h.replace(/^www\./, '')));
      if (host && hostsDoItem.some((h) => h !== host)) return false;
      if (host && texto.includes(` ${host} `)) return true;
      return !!alvo && texto.includes(` ${alvo} `);
    }) || null
  );
}

/**
 * Duas perguntas são a mesma? Jaccard das palavras de conteúdo (sem as
 * vazias de pergunta: "você", "pode", "informar"…). Pela revisão: o
 * critério antigo (comuns ÷ menor conjunto) casava "qual sua senha?" com
 * "qual sua senha do e-mail novo?" — perguntas diferentes.
 */
const VAZIAS_DE_PERGUNTA = new Set([
  'voce', 'favor', 'qual', 'quais', 'algum', 'alguma', 'esta', 'esse', 'essa', 'isso', 'certo', 'agora', 'mesmo', 'mesma',
  'de', 'da', 'do', 'das', 'dos', 'no', 'na', 'nos', 'nas', 'em', 'um', 'ao', 'aos', 'os', 'as', 'se', 'me', 'te', 'lhe',
  'ou', 'eu', 'vc', 'pra', 'pro', 'que', 'com', 'por', 'sem', 'mas', 'nao', 'sim', 'tem', 'ser', 'ter', 'sua', 'seu', 'meu',
  'minha', 'para', 'como', 'quem', 'onde', 'quando', 'porque', 'sobre', 'este', 'aquilo', 'uma', 'uns', 'mais', 'quero', 'consegue',
]);
// (não usa VAZIAS do pedido: lá "mês", "ano", "hoje" são ruído; numa pergunta
// ao usuário são justamente o que a diferencia)
// verbos de cortesia/conferência: "informe", "verifique", "está correta",
// "confirma" não mudam O QUE se pergunta
const MOLDURA_DE_PERGUNTA = /^(inform|verifi|confirm|corret|digit|pode|poderi|gostari|precis)/;
function mesmaPergunta(a, b) {
  const p = (t) =>
    new Set(
      normalizar(t)
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((x) => (x.length >= 2 || /\d/.test(x)) && !VAZIAS_DE_PERGUNTA.has(x) && !MOLDURA_DE_PERGUNTA.test(x))
    );
  const A = p(a);
  const B = p(b);
  if (!A.size || !B.size) return normalizar(a).trim() === normalizar(b).trim();
  // número que só uma das duas tem ("senha 1234?" × "senha 5678?") = outra pergunta
  if ([...A].some((x) => /\d/.test(x) && !B.has(x)) || [...B].some((x) => /\d/.test(x) && !A.has(x))) return false;
  const comuns = [...A].filter((x) => B.has(x)).length;
  return comuns / new Set([...A, ...B]).size >= 0.6;
}

/** O que uma leitura procurava (consulta, URL, caminho) — pra casar com o item do checklist. */
const alvoDaLeitura = (argumentos = {}) =>
  [argumentos.consulta, argumentos.url, argumentos.caminho, argumentos.objetivo, ...(Array.isArray(argumentos.consultas) ? argumentos.consultas : [])]
    .filter(Boolean)
    .join(' ');

/** Palavras que realmente identificam o assunto do pedido. */
function termosDoPedido(objetivo) {
  return [
    ...new Set(
      normalizar(objetivo)
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length > 3 && !VAZIAS.has(p))
    ),
  ];
}

/**
 * Remove o cabeçalho que as ferramentas de busca acrescentam.
 * Sem isto a medição é sempre positiva: a linha `Busca: "<consulta>"` repete
 * as palavras do pedido, então o material parece cobrir o que não cobre.
 */
function soConteudo(texto) {
  return String(texto)
    .split('\n')
    .filter(
      (linha) =>
        !/^\s*Busca:/i.test(linha) &&
        !/^\s*---\s*(FONTE|FALHOU)/i.test(linha) &&
        !/^\s*\[provedor:/i.test(linha) &&
        !/^\s*\(via /i.test(linha) &&
        !/^\s*https?:\/\//i.test(linha) &&
        !/^\s*\[extraído via/i.test(linha)
    )
    .join('\n');
}

/**
 * O material coletado responde ao que foi perguntado?
 * Sem isso o redator monta uma resposta plausível sobre o assunto vizinho —
 * benchmarks de modelos quando a pergunta era sobre gerar arquivos.
 */
function medirCobertura(objetivo, dossie) {
  if (!dossie.length) return { nivel: 'ausente', encontrados: 0, total: 0, ausentes: [] };
  const termos = termosDoPedido(objetivo);
  if (!termos.length) return { nivel: 'boa', encontrados: 0, total: 0, ausentes: [] };

  // sempre o material bruto: conferir contra o destilado marcaria como ausente
  // um termo que a destilação simplesmente não copiou
  const material = normalizar(dossie.map((d) => soConteudo(d.bruto || d.texto)).join(' '));

  // Compara pelo radical: "motores" precisa casar com "motor", "previsão" com
  // "previsões". Cinco caracteres é o suficiente para flexão em português.
  const casa = (termo) => material.includes(termo.length > 6 ? termo.slice(0, 5) : termo);

  const encontrados = termos.filter(casa).length;
  const razao = encontrados / termos.length;

  const nivel = razao >= 0.5 ? 'boa' : razao >= 0.2 ? 'parcial' : 'ausente';
  return { nivel, encontrados, total: termos.length, ausentes: termos.filter((t) => !casa(t)) };
}

/**
 * Busca de acompanhamento mirada no que falta: a cobertura (medida depois de
 * cada leitura) já aponta os termos do pedido que ainda não apareceram no
 * material. Antes, essa informação só virava aviso solto no prompt e a
 * próxima busca dependia do modelo reparar nela — o que nem sempre
 * acontecia (foi o caso das 27 consultas quase iguais do README). Regra
 * determinística, sem chamada nova ao modelo — mesmo espírito de
 * subconsultas() em tools/search.js, só que disparada pela cobertura em vez
 * da conjunção na frase. Só age quando sobra pouca coisa (1-2 termos): com
 * mais que isso, a consulta parece de outro assunto e forçar os termos só
 * atrapalharia.
 */
function ajusteDeBusca(consulta, lacunas) {
  if (!lacunas?.ausentes?.length || lacunas.ausentes.length > 2) return null;
  // os termos ausentes já vêm sem acento (ver termosDoPedido/normalizar acima);
  // comparar contra a consulta crua faria "câmbio" parecer ausente mesmo já
  // estando na consulta, só porque "cambio" (sem acento) não é substring dela.
  const consultaAtual = normalizar(consulta || '');
  const faltando = lacunas.ausentes.filter((t) => !consultaAtual.includes(normalizar(t)));
  if (!faltando.length) return null;
  const original = consulta || '';
  return { original, ajustada: `${original} ${faltando.join(' ')}`.trim(), termos: faltando };
}

/**
 * Quais entradas do dossiê vão pro redator (correções rápidas do motor de
 * pesquisa, 2026-09-24). Antes era `dossie.slice(-8)`: só as 8 ÚLTIMAS
 * leituras. Numa comparação com uma subtarefa de 4 consultas lendo 3-6
 * páginas cada, o material das primeiras consultas (o primeiro critério, a
 * primeira opção) sumia antes da redação — e a resposta saía sem ele, mesmo
 * tendo sido pesquisado. Causa concreta da "síntese fraca" que a análise
 * externa atribuiu à arquitetura inteira.
 *
 * Agora: 1) uma entrada por BUSCA garantida (a com mais fatos; `consulta`
 * vem de destilarLeitura; leitura sem consulta — arquivo, página aberta —
 * conta como grupo próprio pela origem), até `tetoGrupos`; 2) o resto das
 * vagas até `minimo` completado com as mais recentes, como antes. Leitura
 * que a destilação marcou como "(nada relevante ...)" só entra se não
 * sobrar mais nada. A ordem original do dossiê é mantida — o redator corta
 * o material pelo começo quando estoura o orçamento, então o mais recente
 * continua sendo o último a cair.
 */
function selecionarParaRedacao(dossie, { minimo = 8, tetoGrupos = 12, prioritarias = [], tetoPrioritarias = 10 } = {}) {
  const lista = Array.isArray(dossie) ? dossie : [];
  const vazia = (e) => /^\(nada relevante/.test(String(e?.texto || ''));
  const uteis = lista.map((e, i) => ({ e, i })).filter(({ e }) => !vazia(e));
  const base = uteis.length ? uteis : lista.map((e, i) => ({ e, i }));

  const grupos = new Map();
  for (const item of base) {
    const chave = item.e.consulta ? `c:${item.e.consulta}` : `o:${item.e.origem || item.e.url || item.i}`;
    const atual = grupos.get(chave);
    const fatos = (x) => Number(x.e.fatos) || 0;
    // melhor representante do grupo: mais fatos; empate → o mais recente
    if (!atual || fatos(item) > fatos(atual) || (fatos(item) === fatos(atual) && item.i > atual.i)) {
      grupos.set(chave, item);
    }
  }
  // grupos demais: ficam os representantes das buscas mais recentes
  const representantes = [...grupos.values()].sort((a, b) => a.i - b.i).slice(-tetoGrupos);
  const escolhidos = new Set(representantes.map((r) => r.i));
  // `prioritarias` (motor de pesquisa): as leituras que deram evidência à
  // matriz opção × critério entram sempre — são a base do plano da resposta.
  const alvo = new Set(prioritarias);
  lista.forEach((e, i) => {
    if (alvo.has(e) && [...escolhidos].filter((k) => alvo.has(lista[k])).length < tetoPrioritarias) escolhidos.add(i);
  });
  for (let k = base.length - 1; k >= 0 && escolhidos.size < minimo; k -= 1) escolhidos.add(base[k].i);
  return lista.filter((_, i) => escolhidos.has(i));
}

/**
 * Resumo compacto do que já foi coletado, para o crítico do plano checar as
 * próprias observações contra o material de verdade.
 *
 * Caso real (Davi, pedido "Como funciona o sol?"): a crítica do plano alegou
 * "não menciona como o sol afeta a vida na Terra" quando a busca JÁ tinha
 * trazido exatamente isso (inclusive a própria consulta de busca continha
 * "vida na terra") — porque o crítico só via o plano (texto que o outro
 * agente DECLAROU) e a lista `jaFeito` ("ferramenta(argumento)", sem
 * conteúdo nenhum), nunca o que foi de fato lido. Isto dá a ele uma amostra
 * do dossiê (mesmo texto já destilado usado na redação final, não a página
 * bruta) para poder confirmar ou descartar a própria suspeita antes de
 * declará-la.
 */
function resumoDoDossie(dossie, tetoChars = 1000) {
  if (!dossie?.length) return '';
  const linhas = [];
  let usado = 0;
  for (const item of dossie.slice(-6).reverse()) {
    const linha = `[${item.origem || 'fonte'}] ${String(item.texto || '').slice(0, 300)}`;
    if (usado + linha.length > tetoChars && linhas.length) break;
    linhas.unshift(linha);
    usado += linha.length;
  }
  return linhas.join('\n');
}

/**
 * O pedido claramente pede pra GERAR um arquivo num formato específico
 * (pdf/docx/xlsx/html)?
 *
 * Caso real (v0.5.7, teste ao vivo): "Crie um pdf com um resumo
 * curto sobre baterias de íon-lítio" — a busca não trouxe material específico
 * e o modelo, já na PRIMEIRA iteração, chamou `responder` direto — nunca
 * tentou `pesquisar_web` nem `gerar_pdf`. O prompt (regra 6b em prompts.js)
 * já dizia pra nunca terminar em "responder" quando o pedido é por arquivo,
 * mas é uma frase entre outras nove, e um modelo pequeno nem sempre repara
 * nela. Isto vira uma trava determinística (ver o uso de `pedidoQuerArquivo`
 * mais abaixo, no loop principal) em vez de só confiar na instrução.
 *
 * Duas armadilhas reais achadas pela própria bancada ao escrever isto — só
 * mencionar o nome do formato NÃO basta:
 * - "O Ollama consegue gerar arquivos docx e xlsx?" é uma PERGUNTA sobre
 *   capacidade, não um pedido — teto de exclusão explícito abaixo.
 * - "Analise o relatorio-inexistente.pdf" só cita a EXTENSÃO de um arquivo
 *   existente — por isso exige um verbo de criação (gerar/crie/exporte/...)
 *   perto do nome do formato, não só a palavra sozinha.
 */
function pedidoQuerArquivo(objetivo) {
  const t = normalizar(objetivo);

  // pergunta sobre capacidade não é pedido de arquivo nenhum.
  if (/\b(consegue|consegues|conseguem|e capaz|sabe fazer|tem como|e possivel|da pra|da para)\b/.test(t)) {
    return false;
  }

  const verbo =
    '(gera|gere|gerar|crie|criar|exporte|exportar|salve|salvar|monte|montar|' +
    'converta|converter|fa[cç]a|fazer|produza|produzir|escreva|escrever)';
  const formato = '(pdf|docx?|xlsx?|planilha|apresentacao|pptx|word|excel|html)';
  return (
    new RegExp(`\\b${verbo}\\b[^.?!]{0,30}\\b${formato}\\b`).test(t) ||
    new RegExp(`\\b${formato}\\b[^.?!]{0,30}\\b${verbo}\\b`).test(t)
  );
}

/**
 * Ferramentas que abrem uma URL pra ler — é nelas que a repetição vira
 * reabrir a MESMA página achando que vai mudar (não vai). `buscar_produtos`
 * fica de fora: repetir ELA, com uma restrição de loja diferente, é o
 * comportamento bom que a mensagem abaixo tenta induzir, não o problema.
 */
const FERRAMENTAS_DE_ABRIR_URL = new Set(['navegar', 'abrir_pagina']);

/**
 * Mensagem do guarda de repetição (3ª vez na mesma ação) para o caso de
 * comparação de preço: caso real de produção — o agente reabria a MESMA
 * página de loja três vezes sem preço novo, e a mensagem genérica ("pare de
 * pesquisar, responda agora") desperdiçava a chance de tentar uma loja que
 * ainda não tinha aparecido, gastando passos sem melhorar a resposta.
 *
 * Só entra em cena quando: (a) a ação repetida é abrir uma URL (não a busca
 * em si) e (b) estamos mesmo numa comparação de preço nesta execução — sinal
 * que quem chama decide passando `ofertas` (ver call site): um array (vazio
 * ou não) quando `buscar_produtos` rodou nesta execução, `null` quando não.
 * Importante: `buscar_produtos` rodar não é o mesmo que ela ACHAR preço — a
 * maioria das lojas grandes bloqueia leitura automática, e nesse caso ela
 * falha e `ctx.estado.ofertas` nunca é setado, mas ainda estamos numa
 * comparação de preço (o agente segue via `navegar` manual). Por isso quem
 * chama usa `ctx.estado.tentandoComprar` como sinal de reserva.
 */
function mensagemDeAcaoRepetida({ nome, ofertas }) {
  const padrao =
    'Você já executou essa mesma ação antes e o resultado foi o mesmo. Pare de pesquisar. ' +
    'Use responder agora, indicando em "foco" o que a resposta deve cobrir.';

  if (ACOES_DE_PAGINA.has(nome)) {
    return {
      erro: 'Ação repetida na mesma página: da primeira vez ela não mudou nada.',
      mensagem:
        'Você já fez exatamente esta ação NESTA MESMA página e ela não mudou nada. Não repita. ' +
        'Escolha outro elemento (procure pelo TEXTO do botão ou link na lista de elementos), volte (voltar_pagina), ' +
        'ou chame responder dizendo o que conseguiu e onde parou.',
    };
  }
  if (!FERRAMENTAS_DE_ABRIR_URL.has(nome) || !Array.isArray(ofertas)) {
    return { erro: 'Ação repetida pela terceira vez. O material já está coletado — chame responder agora.', mensagem: padrao };
  }

  const lojasVistas = new Set(ofertas.map((o) => o.loja));
  const lojasRestantes = Object.values(LOJAS_CONHECIDAS).filter((loja) => !lojasVistas.has(loja));

  if (lojasRestantes.length) {
    return {
      erro: 'Ação repetida pela terceira vez: mesma página, sem preço novo.',
      mensagem:
        `Reabrir essa página de novo não vai trazer preço diferente. Em vez disso, chame buscar_produtos outra vez, ` +
        `com "lojas": "${lojasRestantes.slice(0, 3).join(', ')}" — uma loja que ainda não apareceu no comparativo ` +
        `(até agora: ${lojasVistas.size} loja${lojasVistas.size === 1 ? '' : 's'}). ` +
        'Se essa tentativa também não trouxer preço legível, use responder agora com o que já tem, deixando claro que a comparação cobriu só essas lojas.',
    };
  }

  return {
    erro: 'Ação repetida pela terceira vez: as lojas conhecidas já foram tentadas.',
    mensagem:
      `As lojas conhecidas pra esse tipo de produto já foram tentadas (${lojasVistas.size} compararam preço). ` +
      'Use responder agora com o que já tem, deixando claro que a comparação cobriu só essas lojas.',
  };
}

const normalizarItemPlano = (texto) =>
  String(texto || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 60);

const TERMOS_GENERICOS_CRITICO = new Set([
  ...VAZIAS,
  'conteudo', 'material', 'materiais', 'fonte', 'fontes', 'evidencia', 'evidencias',
  'relevante', 'relevantes', 'informacao', 'informacoes', 'dados', 'dado', 'parte',
  'partes', 'pedido', 'objetivo', 'resposta', 'final',
]);

function chaveDeTexto(texto) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function termosInformativos(texto) {
  return chaveDeTexto(texto)
    .split(' ')
    .filter((termo) => termo.length > 3 && !TERMOS_GENERICOS_CRITICO.has(termo));
}

function textoCobreAlvo(texto, alvo) {
  const material = chaveDeTexto(texto);
  const alvoNormalizado = chaveDeTexto(alvo);
  if (!material || !alvoNormalizado) return false;
  if (alvoNormalizado.length >= 12 && material.includes(alvoNormalizado)) return true;

  const termos = termosInformativos(alvo);
  if (termos.length === 1) return termos[0].length >= 5 && material.includes(termos[0]);
  if (termos.length < 2) return false;
  return termos.every((termo) => material.includes(termo.length > 6 ? termo.slice(0, 5) : termo));
}

/**
 * Item do checklist cujo próprio TEXTO é sobre entregar a resposta final —
 * "escrever/redigir/consolidar a resposta", "responder ao usuário", "gerar
 * o arquivo final" — não sobre um passo de apuração (pesquisar, ler,
 * calcular) que alimenta essa resposta.
 *
 * Caso real (Davi, bateria de matemática de 7 questões, rastro de 24
 * passos): `planejarInicial` propôs um passo final do tipo "escrever a
 * resposta consolidada com todas as questões" — item legítimo, mas
 * NENHUMA ferramenta além de responder/concluir resolve "escrever a
 * resposta": não é algo que pesquisar_e_ler, ler_arquivo ou
 * executar_codigo resolvam. Sobrando só esse tipo de item, o gate
 * "checklist-pendente" (mais abaixo) barrava exatamente a ação que
 * resolveria o item — um impasse contra o próprio gate, que só se
 * desfazia gastando os `ITENS_PENDENTES_MAX_VETOS` vetos à toa (nenhuma
 * ferramenta chamada nesse meio-tempo tinha como marcar o item como
 * feito). Reconhecer esse padrão deixa o próprio ato de chamar
 * responder/concluir contar como a resolução do item, em vez de barrar a
 * única ação capaz de cumpri-lo.
 */
// "conclu", "entreg", "apresent", "formul", "fornec", "mont" entraram em
// 2026-09-24 (primeiro teste real do motor de pesquisa, "melhores fones pra
// PUBG"): o modelo declarou "Concluir a resposta com as informações
// restantes e recomendações" e o gate barrou responder 3 vezes seguidas —
// com a pesquisa já pronta —, empurrando o agente pra mais 2 buscas e 8
// decisões à toa.
const ehItemDeEntregaFinal = (texto) => {
  // texto inteiro, não o corte de 60 de normalizarItemPlano (9º teste real,
  // 2026-09-25): "Completar a tabela com os dados faltantes e redigir a
  // resposta final" virava "...e redigir a respo" — sem "resposta" — e o
  // gate barrou responder 3 vezes com a pesquisa pronta e o teto de buscas
  // já atingido (responder vetado → busca vetada → responder vetado...).
  const t = String(texto || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return (
    /\b(escrev|redigi|redigir|elabora|elaborar|consolida|consolidar|finaliza|finalizar|complet|produzi|produzir|conclu|entreg|apresent|formul|fornec|mont)\w*.{0,25}\bresposta\b/.test(
      t
    ) ||
    /\bresponder\s+(ao\s+)?usu[aá]rio\b/.test(t) ||
    // síntese do que já foi coletado é o que a redação faz ("Resumir a
    // informação sobre…", "Concluir que o modo Ultra é mais recomendado",
    // "Gerar um resumo comparativo…" — pendentes nos registros reais de 11/10)
    /^(resumir|sintetizar|sumarizar|destilar|concluir que|responder sobre|(gerar|fazer|escrever|montar) (um |o )?resumo)\b/.test(t) ||
    /\b(gera|gerar|escrev|escrever|produzi|produzir|complet)\w*.{0,25}\barquivo\s+final\b/.test(t)
  );
};

/**
 * Contrato de conclusão (2026-09-27, depois da análise dos 5 últimos chats e
 * da "autópsia" que o Davi pediu ao ChatGPT): item do checklist que SÓ uma
 * ferramenta cumpre. No 10º teste real ("histórico de preços ... construir
 * um gráfico"), o plano tinha "Criar um gráfico..." e o gate barrou
 * responder 3 vezes com "não é hora de encerrar" — sem dizer QUAL ferramenta
 * resolvia; o agente só sabia pesquisar de novo (11 buscas, 0 gráficos) e a
 * válvula de escape entregou sem gráfico e sem dizer que faltava.
 * Aqui: item → ferramenta que o cumpre. Esses itens são conferíveis de
 * verdade (a ferramenta rodou com sucesso ou não), diferente de "pesquisar
 * X", cujo "feito" depende do que o modelo declara.
 */
// verbo de CRIAR antes do objeto: "consultar a planilha do usuário" ou
// "ler o PDF" não pedem ferramenta de geração
const CRIAR = '(?:gera|gerar|cria|criar|monta|montar|constr[oó]i|construir|faz|fazer|plota|plotar|desenha|desenhar|produz|produzir|elabora|elaborar|exporta|exportar|salva|salvar)';
const ITEM_COM_FERRAMENTA = [
  { re: new RegExp(`\\b${CRIAR}\\b.{0,40}\\b(gr[aá]ficos?|chart|plot)\\b`, 'i'), ferramenta: 'gerar_grafico' },
  { re: new RegExp(`\\b${CRIAR}\\b.{0,40}\\b(planilha|xlsx|excel)\\b`, 'i'), ferramenta: 'gerar_xlsx' },
  { re: new RegExp(`\\b${CRIAR}\\b.{0,40}\\b(pdf)\\b`, 'i'), ferramenta: 'gerar_pdf' },
  { re: new RegExp(`\\b${CRIAR}\\b.{0,40}\\b(docx|documento do word|arquivo word)\\b`, 'i'), ferramenta: 'gerar_docx' },
];
const ferramentaDoItem = (texto) => ITEM_COM_FERRAMENTA.find((k) => k.re.test(String(texto || '')))?.ferramenta || null;
// item com ferramenta já cumprido: a ferramenta rodou com sucesso, ou (gráfico)
// um gráfico foi montado por outro caminho (buscar_produtos, série de preços)
const itemDeFerramentaCumprido = (texto, ctx) => {
  const f = ferramentaDoItem(texto);
  if (!f) return true;
  if (ctx.estado.ferramentasOk?.has(f)) return true;
  return f === 'gerar_grafico' && (ctx.estado.graficos || []).length > 0;
};

/**
 * Um item NOVO do checklist (nunca visto antes nesta execução) tem alguma
 * relação com o pedido original, ou com o que já está no checklist?
 *
 * Caso real (Davi, chat "Como funciona as ondas de radio frequencia ?",
 * 2026-09-19): o próprio modelo principal, numa decisão no meio da execução,
 * declarou um `plano` com itens genéricos de "planejamento de projeto
 * acadêmico" ("Defina metas específicas para cada área de pesquisa.", "Crie
 * um cronograma detalhado para cada tarefa.") sem relação nenhuma com ondas
 * de rádio — `reconciliarChecklist` aceitava qualquer string, então esses
 * itens viraram subtarefas de verdade e o agente foi pesquisar "como definir
 * objetivos de pesquisa" pelo resto da execução (é assim que dois PDFs
 * acadêmicos fora de assunto entraram na leitura, um deles com o bug de
 * `pareceLegivel` corrigido nesta mesma rodada).
 *
 * Não é um filtro de "cobertura completa" (`textoCobreAlvo`, mais estrito —
 * exige TODOS os termos do alvo) — aqui basta UM termo informativo em comum
 * com o objetivo OU com qualquer item já aceito no checklist, pra permitir
 * decomposição legítima ("pesquisar propagação de ondas de rádio" não repete
 * a palavra "frequência", mas compartilha "ondas"/"rádio"). Falha ABERTO
 * (aceita) sempre que não há termo informativo suficiente pra julgar — não é
 * pra travar planejamento em pedidos curtos ou vagos, só pegar o desvio
 * grosseiro (zero relação com nada do que já se sabe sobre o pedido).
 */
function itemChecklistRelevante(texto, objetivo, itensExistentes) {
  const termosAlvo = termosInformativos(objetivo);
  if (!termosAlvo.length) return true; // objetivo curto/genérico demais pra ter termo informativo — sem base pra julgar
  const termosItem = termosInformativos(texto);
  if (!termosItem.length) return true; // item sem termo informativo próprio (ex.: "revisar o plano") — não é o desvio que este guarda mede

  const compartilhaTermo = (base) => termosItem.some((t) => base.includes(t));
  if (compartilhaTermo(termosAlvo)) return true;

  // Decomposição de um item já presente (inclusive já concluído) também vale —
  // o vocabulário do checklist se expande naturalmente conforme a pesquisa avança.
  return itensExistentes.some((item) => compartilhaTermo(termosInformativos(item.texto)));
}

/**
 * Lista de tarefas com estado — antes o plano declarado era regravado por
 * inteiro a cada decisão (texto solto tipo "pesquisar → comparar →
 * responder"), e um item que sumia da lista nova simplesmente desaparecia:
 * nada registrava se foi concluído ou só esquecido pelo modelo (silent scope
 * drop). Aqui cada item carrega um status, e um item que sai da lista sem
 * estar marcado herda o resultado da ÚLTIMA ação executada — feito, se ela
 * deu certo; pulado, se falhou ou foi negada — em vez de só sumir sem deixar
 * rastro. Item já resolvido (feito/pulado) nunca regride, mesmo que o modelo
 * o redeclare depois.
 *
 * `opcoes.objetivo`, quando informado, liga o guarda de relevância tópica
 * (`itemChecklistRelevante`) sobre os itens NOVOS — retrocompatível: quem
 * não passar `objetivo` continua com o comportamento de sempre (aceita
 * qualquer string), é assim que os testes/chamadas mais antigos deste
 * arquivo continuam batendo sem mudança.
 */
function reconciliarChecklist(anterior, novoBruto, ultimaAcaoOk, opcoes = {}) {
  const novo = (novoBruto || []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 8);
  if (!anterior.length) return novo.map((texto) => ({ texto, status: 'pendente' }));

  const normalizadosNovos = novo.map(normalizarItemPlano);
  const aindaNoNovo = (texto) => {
    const n = normalizarItemPlano(texto);
    return normalizadosNovos.some((x) => x.includes(n) || n.includes(x));
  };

  // Caso real 2026-09-14 (Davi, bateria de projeção do dólar): o modelo
  // reescreveu/consolidou o `plano` inteiro de uma vez (mesmo conteúdo, texto
  // diferente, mas AINDA um plano não-vazio), e os 6 itens antigos que não
  // bateram com a lista nova viraram "feito" TODOS DE UMA VEZ — depois de uma
  // única ação real (uma busca) ter sido executada. Cada iteração do laço
  // executa exatamente UMA ação (ver run(), mais abaixo) antes de chamar esta
  // função, então não é plausível que mais de um item pendente tenha sido
  // genuinamente concluído na mesma reconciliação quando o modelo AINDA
  // declara passos pendentes — sumiço em massa nesse caso é reescrita de
  // texto, não trabalho feito. Isso também disparava o checkpoint automático
  // "cada parte concluída" (loop.js, Agent.criticaAutomatica) 6 vezes
  // seguidas no mesmo passo — caro e sem sentido, revisando "conclusões" que
  // nunca aconteceram.
  //
  // Já um `plano` novo GENUINAMENTE VAZIO (novo.length === 0, depois do
  // filtro de string em branco acima) é outra coisa: um sinal deliberado e
  // inequívoco de "não sobra mais nada a fazer" — nesse caso, sim, todo item
  // ainda pendente vira feito/pulado de uma vez, como sempre foi (é assim que
  // os testes já existentes sinalizam "o modelo encerrou o plano").
  const candidatosAConcluir = anterior.filter(
    (item) => item.status === 'pendente' && !aindaNoNovo(item.texto)
  );
  const abandonoEmMassaPermitido = Boolean(opcoes.abandonoEmMassaPermitido);
  const podeConcluir = novo.length === 0 || candidatosAConcluir.length <= 1;

  const atualizado = anterior.map((item) => {
    if (item.status !== 'pendente' || aindaNoNovo(item.texto)) return item;
    if (!podeConcluir) return abandonoEmMassaPermitido ? { ...item, status: 'pulado' } : item;
    return { ...item, status: ultimaAcaoOk === false ? 'pulado' : 'feito' };
  });

  const conhecidos = atualizado.map((i) => normalizarItemPlano(i.texto));
  const novosItens = novo
    .filter((texto) => {
      const n = normalizarItemPlano(texto);
      return !conhecidos.some((c) => c.includes(n) || n.includes(c));
    })
    .filter((texto) => !opcoes.objetivo || itemChecklistRelevante(texto, opcoes.objetivo, anterior))
    .map((texto) => ({ texto, status: 'pendente' }));

  return [...atualizado, ...novosItens].slice(-10);
}

module.exports = {
  motivoDeAprovacao,
  CRITICA_OBRIGATORIA,
  CRITICA_PERIODICA_INTERVALO,
  CRITICA_PERIODICA_MAX,
  CRITICA_PERIODICA_INTERVALO_COMPLEXO,
  CRITICA_PERIODICA_MAX_COMPLEXO,
  STATUS_CRITICO,
  MAX_PARTES_POR_REESCRITA,
  MAX_REPLANEJAMENTOS,
  FASES_QUE_PODEM_REPLANEJAR,
  extrairRecomendacaoCritico,
  extrairJSON,
  resumoDeArgumentos,
  fontesDaResposta,
  ACAO_IMPOSSIVEL,
  ITEM_DE_METODO,
  itemNaoExecutavel,
  itemForaDoPedido,
  chars,
  decisaoCompacta,
  RESULTADOS_INTEGRAIS,
  paraEnvio,
  caberNaJanela,
  calibrarRazao,
  TETO_DE_BUSCAS,
  TETO_DE_CHUNKS,
  TETO_DE_CHUNKS_PESQUISA_PLANEJADA,
  emPedacos,
  LIMITE_DIAS_MEMORIA_CURTA,
  LIMITE_DIAS_MEMORIA_CURTA_CAUTELOSO,
  GERACOES_DE_ARQUIVO,
  REPETIVEIS,
  ANOTAR_ERRO,
  listaSemOsComparados,
  LEITURAS,
  VAZIAS,
  normalizar,
  ACOES_DE_PAGINA,
  ehAcaoDeNavegador,
  argumentosCanonicos,
  chaveDeRepeticao,
  hashCurto,
  VERBOS_DE_ACAO,
  VERBO_QUE_A_ACAO_CUMPRE,
  itemDaAcao,
  VAZIAS_DE_PERGUNTA,
  MOLDURA_DE_PERGUNTA,
  mesmaPergunta,
  alvoDaLeitura,
  termosDoPedido,
  soConteudo,
  medirCobertura,
  ajusteDeBusca,
  selecionarParaRedacao,
  resumoDoDossie,
  pedidoQuerArquivo,
  FERRAMENTAS_DE_ABRIR_URL,
  mensagemDeAcaoRepetida,
  normalizarItemPlano,
  TERMOS_GENERICOS_CRITICO,
  chaveDeTexto,
  termosInformativos,
  textoCobreAlvo,
  ehItemDeEntregaFinal,
  CRIAR,
  ITEM_COM_FERRAMENTA,
  ferramentaDoItem,
  itemDeFerramentaCumprido,
  itemChecklistRelevante,
  reconciliarChecklist,
};
