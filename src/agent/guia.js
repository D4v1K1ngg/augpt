'use strict';

/**
 * Pesquisa de GUIA (revisão v3, Fase 1 — chats reais de 29/09).
 *
 * "As melhores táticas de PUBG competitivo" e "um tutorial de planejamento
 * tático e movimentação" não são escolha de produto: são técnica. No chat
 * real a bateria da comunidade ACHOU os tópicos certos (r/PUBATTLEGROUNDS
 * "good players, what tips…", r/PUBG "good working strategies/tactics",
 * r/CompetitivePUBG "detailed strategy training") — e a extração, que
 * procurava NOMES DE PRODUTO, jogou tudo fora.
 *
 * Aqui o caminho é o mesmo da recomendação (comunidade primeiro, o código
 * valida, o modelo só interpreta), mas o que se extrai é DICA:
 *   1. bateria de buscas montada pelo código (subreddit do jogo, guias,
 *      profissionais, português);
 *   2. por tópico, o 7B lista "dica | nº do comentário"; o código confere
 *      que o comentário existe e guarda o comentário como citação;
 *   3. páginas de guia contribuem com os fatos já destilados;
 *   4. o código agrupa dicas parecidas, conta FONTES independentes e votos,
 *      e encaixa cada uma numa etapa da partida;
 *   5. a resposta é montada pelo código (compositor.montarGuia).
 */

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// tema do pedido: palavra em português → termo de busca em inglês
const TEMAS = [
  { re: /\btatic\w*|\btatico\b/, pt: 'táticas', en: 'tactics' },
  { re: /\bestrateg\w*/, pt: 'estratégia', en: 'strategy' },
  { re: /\brotac\w*|\brotacionar\b/, pt: 'rotação', en: 'rotation' },
  { re: /\bposicionamento\b/, pt: 'posicionamento', en: 'positioning' },
  { re: /\bmoviment\w*/, pt: 'movimentação', en: 'movement' },
  { re: /\bplanejamento\b/, pt: 'planejamento', en: 'planning' },
  { re: /\b(mira|aim)\b/, pt: 'mira', en: 'aim' },
  { re: /\brecoil\b|\bspray\b/, pt: 'controle de recoil', en: 'recoil control' },
  { re: /\bcomunicac\w*|\bcallouts?\b/, pt: 'comunicação', en: 'communication callouts' },
  { re: /\btrein\w*/, pt: 'treino', en: 'training routine' },
  { re: /\b(subir (de )?(elo|rank|patente)|elo|rank(ed|eada)?)\b/, pt: 'subir de elo', en: 'climb rank' },
  { re: /\bdicas?\b|\bmacetes?\b|\btruques?\b/, pt: 'dicas', en: 'tips' },
];

const PALAVRAS_VAZIAS = new Set(
  ('a o e de da do das dos em no na nos nas um uma para pra por com sem que se mais muito bem quando sempre voce seu sua ' +
    'the and for with you your when to of in on is it be are can just more get dont do not this that')
    .split(' ')
);

/** Jogo, temas, competitivo — a partir do pedido. `jogos` vem do motor (lista JOGOS). */
// jogo fora da lista do motor (que tem subreddit): LoL, Minecraft, Dota…
// — vale o nome, sem subreddit (achado do revisor: "como subir de elo no lol"
// virou "como elo no lol passo a passo")
const { assuntoDe } = require('./assunto-da-conversa');
const minusculo = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const PALAVRAS_DE_PEDIDO = /^(realize|faca|faça|quero|queria|gostaria|me|de|dê|uma|um|pesquisa|profunda|para|pra|encontrar|as|os|melhores|melhor|dicas|dica|tutorial|guia|como|passo|a|o|sobre|poderia|ajudar|preciso|algumas|quais|qual|sao|são)$/;

function temaDoGuia(objetivo, jogos = []) {
  const t = normalizar(objetivo);
  let jogo = jogos.find((j) => j.re.test(t)) || null;
  if (!jogo) {
    const nome = assuntoDe(objetivo).jogo;
    if (nome && nome !== 'PUBG Mobile') jogo = { en: nome, re: null };
  }
  const temas = TEMAS.filter((x) => x.re.test(t));
  const competitivo = /\b(competitiv\w*|e ?sports?|profission\w*|pros?|campeonato\w*|torneio\w*|ranked|rankeada)\b/.test(t);
  let assunto = null;
  if (!jogo) {
    // assunto COM acento, sem as palavras do próprio pedido ("dicas", "como", "para")
    const palavras = minusculo(objetivo).split(' ');
    let i = 0;
    while (i < palavras.length - 1 && PALAVRAS_DE_PEDIDO.test(palavras[i])) i += 1;
    assunto = palavras.slice(i).join(' ').slice(0, 60).trim() || minusculo(objetivo).slice(0, 60);
  }
  return { jogo, temas: temas.length ? temas : [TEMAS[TEMAS.length - 1]], competitivo, assunto };
}

/**
 * Bateria do guia, montada pelo código: subreddit do jogo, guia em inglês,
 * profissionais, português. Sem jogo, o assunto do pedido em português.
 */
function bateriaDoGuia({ objetivo, jogos = [], maximo = 6 }) {
  const { jogo, temas, competitivo, assunto } = temaDoGuia(objetivo, jogos);
  const en = temas.map((x) => x.en).slice(0, 2).join(' ');
  const pt = temas.map((x) => x.pt).slice(0, 2).join(' ');
  const comp = competitivo ? 'competitive ' : '';
  const ptBusca = /\bdicas\b/.test(pt) ? pt : `${pt} dicas`;
  const enDica = /\btips\b/.test(en) ? en : `${en} tips`;
  const lista = jogo
    ? [
        jogo.sub && { consulta: `site:reddit.com r/${jogo.sub} ${enDica}`, idioma: 'all', comunidade: true },
        { consulta: `${jogo.en} ${comp}${en} guide`, idioma: 'all' },
        { consulta: `site:reddit.com ${jogo.en} ${comp}${en} advice`, idioma: 'all', comunidade: true },
        { consulta: `${jogo.en} pro players ${en}`, idioma: 'all' },
        { consulta: `${jogo.en} ${ptBusca} guia`, idioma: 'pt-BR' },
        jogo.subCompetitivo && competitivo && { consulta: `site:reddit.com r/${jogo.subCompetitivo} ${en}`, idioma: 'all', comunidade: true },
      ].filter(Boolean)
    : [
        // sem jogo: o assunto está em português — só buscas em português
        { consulta: `${assunto} ${/\bdicas\b/.test(assunto) ? '' : 'dicas'} guia`, idioma: 'pt-BR' },
        { consulta: `${/^como\b/.test(assunto) ? assunto : `como ${assunto}`} passo a passo`, idioma: 'pt-BR' },
        { consulta: `${assunto} experiência dicas fórum`, idioma: 'pt-BR' },
      ];
  const vistas = new Set();
  return lista
    .map((q) => ({ ...q, consulta: q.consulta.replace(/\s+/g, ' ').trim() }))
    .filter((q) => (vistas.has(q.consulta) ? false : vistas.add(q.consulta)))
    .slice(0, maximo);
}

/* ------------------------------ extração ------------------------------ */

const ECO_DO_FORMATO = /<?\s*a dica em portugu|dica curta e pr[aá]tica|n[uú]mero do coment[aá]rio\s*>?/i;

/**
 * Lê "- dica | 3": o comentário 3 TEM de existir; dica com número que não
 * está no comentário é inventada; dica curta demais, longa demais ou eco
 * da linha de formato sai. O comentário vira a citação da dica.
 */
function lerDicasDoTopico(texto, comentarios = []) {
  const saida = [];
  if (/^\s*nenhuma?\b/i.test(String(texto || ''))) return saida;
  for (const linha of String(texto || '').split('\n')) {
    if (!/\|/.test(linha)) continue;
    const [bruto, ref = ''] = linha.split('|');
    const dica = bruto.replace(/^\s*[-*•\d.)]+\s*/, '').replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim();
    const palavras = dica.split(/\s+/).filter(Boolean);
    if (palavras.length < 3 || palavras.length > 32 || ECO_DO_FORMATO.test(dica)) continue;
    const n = Number((/\d+/.exec(ref) || [])[0]);
    const c = comentarios.find((x) => x.n === n);
    if (!c) continue;
    const numeros = dica.match(/\d+/g) || [];
    if (numeros.some((x) => !String(c.integral || c.texto).includes(x))) continue;
    // achado do revisor: só existir o comentário não basta ("Sempre jogue com
    // fones e volume alto | 2" saiu com a citação "lol nice") — a dica tem de
    // dividir ao menos uma ideia com o comentário (mesma raiz, ou o par
    // português/inglês do dicionário de jogo)
    if (!sustenta(dica, c.integral || c.texto)) continue;
    saida.push({ dica, comentario: c });
  }
  return saida;
}

// pares português → inglês do vocabulário de jogo (a dica vem traduzida)
const PARES = [
  ['zona', 'zone circle gas'], ['circulo', 'circle zone'], ['cobertura', 'cover'], ['abrigo', 'cover'], ['veiculo', 'vehicle car'],
  ['carro', 'car vehicle'], ['rotac', 'rotat rotation'], ['mira', 'aim crosshair'], ['recoil', 'recoil spray'], ['granada', 'grenade nade'],
  ['fumaca', 'smoke'], ['comunic', 'comms call communicat'], ['call', 'call comms'], ['posic', 'position'], ['pous', 'drop land'],
  ['saque', 'loot'], ['loot', 'loot'], ['equipe', 'team squad'], ['time', 'team squad'], ['campo aberto', 'open field'], ['aberto', 'open'],
  ['borda', 'edge'], ['reviv', 'revive res'], ['trein', 'practice train'], ['pratic', 'practice'], ['sensibilidade', 'sens sensitivity'],
  ['mapa', 'map'], ['inimigo', 'enemy enemies'], ['distancia', 'distance range'], ['direcao', 'direction'], ['alto', 'high'],
  ['predio', 'building'], ['casa', 'house compound building'], ['janela', 'window'], ['arma', 'gun weapon'], ['municao', 'ammo'],
  ['cura', 'heal meds'], ['colete', 'vest armor'], ['capacete', 'helmet'], ['passos', 'footstep step'], ['ouvir', 'hear sound audio'],
  ['paciencia', 'patient patience'], ['paciente', 'patient'], ['agach', 'crouch'], ['deit', 'prone'], ['cedo', 'early'], ['tarde', 'late'],
  ['luta', 'fight'], ['briga', 'fight'], ['atir', 'shoot'], ['tiro', 'shot shoot'], ['silenc', 'quiet suppress'], ['escond', 'hide'],
  ['cerca', 'fence'], ['pedra', 'rock'], ['arvore', 'tree'], ['colina', 'hill ridge'], ['morro', 'hill ridge'], ['angulo', 'angle'],
];
const raizes = (t) => normalizar(t).split(' ').filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p));
function sustenta(dica, comentario) {
  const d = raizes(dica);
  const c = normalizar(comentario);
  const cr = new Set(raizes(comentario).map((p) => p.slice(0, 5)));
  if (d.some((p) => cr.has(p.slice(0, 5)))) return true;
  return PARES.some(([pt, en]) => d.some((p) => p.startsWith(pt)) && en.split(' ').some((e) => c.includes(e)));
}

/** Fatos destilados de uma página de guia (linhas "- fato"), os primeiros que parecem conselho. */
const VERBO_DE_CONSELHO =
  /\b(use|usar|evite|evitar|mantenha|manter|fique|ficar|procure|procurar|nunca|sempre|tente|priorize|prefira|lembre|aproveite|cuidado|comunique|treine|pratique|avance|recue|espere|posicione|mova|mover|rotacione|antecipe|planeje|keep|avoid|always|never|use|try|stay|move|rotate|don t|make sure)\b/;
function dicasDaPagina(entrada, maximo = 4, alvo = null) {
  // achado do revisor: página de GTA Online virou 3 dicas numa busca de PUBG —
  // a página tem de citar o jogo (ou o assunto) pra contribuir
  if (alvo && !alvo.test(normalizar(`${entrada.titulo || ''} ${entrada.texto || ''} ${entrada.bruto || ''}`).slice(0, 30000))) return [];
  const linhas = String(entrada.texto || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((l) => l.length >= 25 && l.length <= 260 && VERBO_DE_CONSELHO.test(normalizar(l)));
  return linhas.slice(0, maximo);
}

/* ------------------------------ agrupamento ------------------------------ */

const palavrasDe = (t) => new Set(normalizar(t).split(' ').filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p)));
function parecida(a, b) {
  const A = palavrasDe(a);
  const B = palavrasDe(b);
  if (!A.size || !B.size) return false;
  const comuns = [...A].filter((p) => B.has(p)).length;
  return comuns / Math.min(A.size, B.size) >= 0.6 || comuns / new Set([...A, ...B]).size >= 0.45;
}

const FONTE_DE_PRO = /\b(liquipedia|prosettings|esports?|pubgesports|hltv|vlr\.gg|pro ?player|profission\w*|pros?\b|torneio|tournament|scrims?|competitiv\w*)\b/i;

/**
 * Junta dicas parecidas. Cada dica: { texto, fontes:[{chave, rotulo, url,
 * votos, trecho, comunidade, pro}], nFontes, votos, comunidade, pro, nota }.
 */
function agruparDicas(itens = []) {
  const grupos = [];
  for (const it of itens) {
    const g = grupos.find((x) => parecida(x.texto, it.texto));
    if (g) {
      if (!g.fontes.some((f) => f.chave === it.fonte.chave)) g.fontes.push(it.fonte);
      else {
        const f = g.fontes.find((x) => x.chave === it.fonte.chave);
        f.votos = Math.max(f.votos || 0, it.fonte.votos || 0);
      }
    } else grupos.push({ texto: it.texto, fontes: [it.fonte] });
  }
  for (const g of grupos) {
    g.nFontes = g.fontes.length;
    g.votos = g.fontes.reduce((s, f) => s + (f.votos || 0), 0);
    g.comunidade = g.fontes.filter((f) => f.comunidade).length;
    g.pro = g.fontes.some((f) => f.pro);
    g.nota = Math.round((2 * g.comunidade + 1.5 * (g.nFontes - g.comunidade) + Math.log2(1 + g.votos) + (g.pro ? 1 : 0)) * 10) / 10;
  }
  return grupos.sort((a, b) => b.nota - a.nota);
}

/* ------------------------------ etapas da partida ------------------------------ */

const SECOES = [
  { titulo: 'Antes do combate: pouso, saque e preparação', re: /\b(pous\w*|salt\w*|aviao|drop|loot\w*|saque\w*|equip\w*|mochila|colete|capacete|kit|inventario|municao)\b/ },
  { titulo: 'Rotação e zona', re: /\b(zona|circulo\w*|rotac\w*|rotacion\w*|azul|safe|borda|bluezone|gas|tempo de|antecip\w*)\b/ },
  { titulo: 'Posicionamento e cobertura', re: /\b(posic\w*|cobertura\w*|abrigo\w*|predio\w*|casa\w*|compound\w*|terreno|colina\w*|morro\w*|janela\w*|parede\w*|pedra\w*|arvore\w*|elevad\w*|high ground|vantagem)\b/ },
  { titulo: 'Movimentação', re: /\b(mov\w*|veiculo\w*|carro\w*|correr|corra|andar|agach\w*|deit\w*|prone|peek\w*|lean|inclin\w*|jiggle|rota\b)\b/ },
  { titulo: 'Combate e mira', re: /\b(mira\w*|recoil|spray|sensibilidade|tiro\w*|atir\w*|arma\w*|granada\w*|smoke\w*|fumaca\w*|flash\w*|molotov|duelo\w*|troca\w*|headshot\w*|alcance)\b/ },
  { titulo: 'Comunicação e equipe', re: /\b(comunic\w*|call\w*|equipe\w*|time\b|squad\w*|dupla\w*|parceir\w*|companheir\w*|reviv\w*|derrubad\w*|aliad\w*)\b/ },
  { titulo: 'Treino e mentalidade', re: /\b(trein\w*|pratic\w*|assist\w*|vods?|replay\w*|stream\w*|calma|paciencia|paciente|tilt\w*|mental\w*|rotina|aprend\w*|revis\w*)\b/ },
];
const ERRO = /^(nao|nunca|evite|evitar|cuidado|pare de|jamais|don t|never|avoid)\b/;

function secaoDaDica(texto) {
  const n = normalizar(texto);
  if (ERRO.test(n)) return 'Erros comuns';
  return (SECOES.find((s) => s.re.test(n)) || { titulo: 'Outras dicas' }).titulo;
}

/** Dicas por etapa, na ordem de uma partida; "Erros comuns" e "Outras" no fim. */
function organizarPorEtapa(dicas = [], { jogo = true } = {}) {
  // fora de jogo, as etapas de partida não fazem sentido: "Dicas" + "Erros comuns"
  if (!jogo) {
    const erros = dicas.filter((d) => secaoDaDica(d.texto) === 'Erros comuns');
    const resto = dicas.filter((d) => !erros.includes(d));
    return [resto.length && { titulo: 'Dicas', dicas: resto }, erros.length && { titulo: 'Erros comuns', dicas: erros }].filter(Boolean);
  }
  const ordem = [...SECOES.map((s) => s.titulo), 'Outras dicas', 'Erros comuns'];
  const mapa = new Map(ordem.map((o) => [o, []]));
  for (const d of dicas) mapa.get(secaoDaDica(d.texto)).push(d);
  return ordem.filter((o) => mapa.get(o).length).map((titulo) => ({ titulo, dicas: mapa.get(titulo) }));
}

/* ------------------------------ pipeline ------------------------------ */

const BUSCAS_DO_GUIA = { leve: 3, medio: 4, alto: 5, extremo: 6 };
const TOPICOS_DO_GUIA = { leve: 4, medio: 6, alto: 8, extremo: 10 };
const DICAS_DO_GUIA = { leve: 8, medio: 10, alto: 12, extremo: 15 };

/**
 * Roda o guia. Ajudantes do motor injetados em `h` (evita import circular):
 * { JOGOS, ehTopico, comentariosNumerados, perguntaDoTopico, dominioDe, chaveDeFonte }.
 */
async function pesquisaDeGuia({ objetivo, nivel = 'leve', rodar, emitir = () => {}, chamarModelo, livro, entradas, consultas, buscas, h, prompts, adiantar = () => {} }) {
  const tema = temaDoGuia(objetivo, h.JOGOS);
  const rotuloTema = `${tema.temas.map((x) => x.pt).join(' e ')}${tema.jogo ? ` no ${tema.jogo.en}` : tema.assunto ? ` (${tema.assunto})` : ''}`;
  const plano = {
    uso: rotuloTema,
    tipoDeUso: tema.competitivo ? 'guia — cenário competitivo' : 'guia',
    modo: 'guia',
    criterios: [],
    opcoesCitadas: [],
    descoberta: [],
    buscaIngles: '',
  };
  emitir('pesquisa-plano', { uso: plano.uso, criterios: [], opcoesCitadas: [], descoberta: [], modo: 'guia' });
  const foco = `dicas e táticas práticas sobre ${rotuloTema}: o que fazer, quando, e por quê (o que jogadores experientes e profissionais recomendam)`;
  const bateria = bateriaDoGuia({ objetivo, jogos: h.JOGOS, maximo: BUSCAS_DO_GUIA[nivel] || 3 });
  adiantar(bateria.map((b) => ({ consulta: b.consulta, idioma: b.idioma, comunidade: Boolean(b.comunidade) })));
  for (const b of bateria) {
    await rodar(b.consulta, foco, '', 'guia', { idioma: b.idioma, ...(b.comunidade ? { comunidade: true } : {}) });
  }

  // 2. dicas por tópico da comunidade
  const itens = [];
  const usadas = [];
  const topicos = [];
  const vistos = new Set();
  const lista = entradas.filter((e) => h.ehTopico(e)).filter((e) => {
    const chave = String(e.url || '').replace(/[#?].*$/, '');
    return chave && !vistos.has(chave) && vistos.add(chave);
  });
  for (const e of lista.slice(0, TOPICOS_DO_GUIA[nivel] || 4)) {
    const comentarios = h.comentariosNumerados(e, 25);
    if (!comentarios.length) continue;
    const resposta = await chamarModelo(prompts.pedidoDeDicasDoTopico({ tema: rotuloTema, pergunta: h.perguntaDoTopico(e), comentarios }), { tipo: 'dicas-do-topico', numPredict: 450 });
    const dicas = lerDicasDoTopico(resposta, comentarios);
    topicos.push({ url: e.url, titulo: String(e.titulo || h.perguntaDoTopico(e)).slice(0, 120), dicas: dicas.length });
    if (!dicas.length) continue;
    usadas.push(e);
    const chave = h.chaveDeFonte(e.url || h.dominioDe(e));
    const rotulo = comentarios[0]?.fonte || h.dominioDe(e);
    for (const { dica, comentario } of dicas) {
      const fonte = {
        chave,
        rotulo,
        url: e.url || '',
        votos: comentario.votos || 0,
        trecho: comentario.integral || comentario.texto,
        comunidade: true,
        pro: FONTE_DE_PRO.test(`${comentario.integral || ''} ${e.titulo || ''}`),
      };
      itens.push({ texto: dica, fonte });
      livro?.adicionar({ tipo: 'dica', produto: null, criterio: rotuloTema, valor: dica, url: e.url, fonte: rotulo, trecho: fonte.trecho, votos: fonte.votos, origem: 'comunidade' });
    }
  }

  // 3. páginas de guia (não tópico): os fatos destilados que parecem conselho
  const alvoDaPagina = tema.jogo
    ? new RegExp(`\\b${normalizar(tema.jogo.en).replace(/ /g, '\\s*')}\\b`)
    : (() => {
        const palavras = normalizar(tema.assunto || '').split(' ').filter((p) => p.length >= 5);
        return palavras.length ? new RegExp(`\\b(${palavras.join('|')})`) : null;
      })();
  for (const e of entradas.filter((x) => !h.ehTopico(x))) {
    const dicas = dicasDaPagina(e, 4, alvoDaPagina);
    if (!dicas.length) continue;
    usadas.push(e);
    const dominio = h.dominioDe(e);
    for (const dica of dicas) {
      const fonte = { chave: h.chaveDeFonte(e.url || dominio), rotulo: dominio, url: e.url || '', votos: 0, trecho: dica, comunidade: false, pro: FONTE_DE_PRO.test(`${dominio} ${e.url || ''} ${e.titulo || ''}`) };
      itens.push({ texto: dica, fonte });
      livro?.adicionar({ tipo: 'dica', produto: null, criterio: rotuloTema, valor: dica, url: e.url, fonte: dominio, trecho: dica, origem: 'guia' });
    }
  }

  // 4. agrupar, contar fontes, encaixar nas etapas
  const dicas = agruparDicas(itens).slice(0, DICAS_DO_GUIA[nivel] || 8);
  const secoes = organizarPorEtapa(dicas, { jogo: Boolean(tema.jogo) });
  emitir('pesquisa-guia', { tema: rotuloTema, topicos, dicas: dicas.map((d) => ({ texto: d.texto, fontes: d.nFontes, votos: d.votos, pro: d.pro })) });
  emitir('pesquisa-evidencias', { total: livro?.tamanho || 0, itens: livro?.serializar?.(300) || [] });
  const ok = dicas.length >= 3;
  const matriz = { celula: () => null, cobertura: ok ? 1 : 0, lacunas: [], entradasUsadas: usadas, resumos: new Map() };
  const tutorial = /\btutorial|passo a passo|guia\b/.test(normalizar(objetivo));
  const linhas = [
    'PLANO DA RESPOSTA (guia montado pela pesquisa — as dicas abaixo vieram do material, com a fonte de cada uma; não invente outras):',
    `TEMA: ${rotuloTema}.`,
    ...secoes.flatMap((s) => [`${s.titulo}:`, ...s.dicas.map((d) => `  - ${d.texto} (${d.nFontes} fonte(s))`)]),
  ];
  return {
    ok,
    motivo: ok ? null : `poucas dicas com fonte (${dicas.length})`,
    modo: 'guia',
    livro,
    plano,
    tema: rotuloTema,
    jogo: tema.jogo?.en || null,
    tutorial,
    finalistas: [],
    outros: [],
    matriz,
    dicas,
    secoes,
    topicos,
    buscas: buscas(),
    consultas,
    entradas,
    planoDeResposta: linhas.join('\n'),
    listaNumerada: '',
    resumo: `PESQUISA DE GUIA CONCLUÍDA (etapa automática, não é o usuário): ${buscas()} busca(s), ${dicas.length} dica(s) com fonte sobre ${rotuloTema}. O plano da resposta já está pronto: chame responder agora.`,
  };
}

module.exports = {
  sustenta,
  temaDoGuia,
  bateriaDoGuia,
  lerDicasDoTopico,
  dicasDaPagina,
  agruparDicas,
  parecida,
  secaoDaDica,
  organizarPorEtapa,
  pesquisaDeGuia,
};
