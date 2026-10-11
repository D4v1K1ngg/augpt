'use strict';

/**
 * Nível 1 do modo AUTO — "liberdade com âncora" (10/10/2026).
 *
 * Duas lições da mesma pergunta ("Me conte mais sobre o Black bird sr71"):
 *  - o Ollama puro (qwen3.5:9b) escreveu uma resposta ótima de ler, em
 *    segundos — com 7 erros graves (69,7 m de comprimento, 3 tripulantes,
 *    "vendidos ao Japão", combustível de hidrogênio…);
 *  - o AuGPT acertou mais, mas engessado: fatos soltos de uma destilação
 *    ruim viravam frases com [1], sem síntese, em 192 s.
 *
 * Aqui o modelo escreve LIVRE (estrutura, tom e curiosidades dele), com uma
 * FICHA DE CONFERÊNCIA ao lado: introdução e ficha técnica da Wikipédia (pt
 * e en) e trechos de 1–2 páginas da busca. Nenhuma destilação — o material
 * vai cru e curto. Depois, uma conferência em CÓDIGO troca número que
 * contradiz a ficha (comprimento, peso, tripulação, ano…) sem mexer no
 * estilo. Fontes só no fim.
 *
 * Tudo que toca rede ou modelo é injetável (`deps`), para os testes.
 */

const { baixar } = require('../tools/http');
const { buscar } = require('../tools/search');
const { ler } = require('../tools/extract');
const { conferirDestino } = require('../tools/rede');
const ollama = require('../llm/ollama');
const { assuntoDoPedido } = require('./auto');
const calculadora = require('../../ferramentas/calculadora');
const imagens = require('../tools/imagens');

const TEMPO_DA_PAGINA_MS = 9000;

/* ------------------------------ Wikipédia ------------------------------ */

async function jsonDe(url, signal) {
  const r = await baixar(url, { timeout: 10000, headers: { Accept: 'application/json' }, signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.texto);
}

/** Valor de infobox em texto: tira ref, link, predefinição e marcação. */
function limparValor(v) {
  let s = String(v || '');
  s = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '; ').replace(/<[^>]+>/g, '');
  // {{convert|32.74|m|ft}} → 32.74 m ; {{start date|1964|12|22}} → 1964-12-22
  s = s.replace(/\{\{\s*(?:convert|cvt|converter)\s*\|\s*([\d.,]+)\s*\|\s*([^|}]+)[^}]*\}\}/gi, '$1 $2');
  s = s.replace(/\{\{\s*(?:start date(?: and age)?|data de início|data)\s*\|\s*(\d{4})(?:\s*\|\s*(\d{1,2}))?(?:\s*\|\s*(\d{1,2}))?[^}]*\}\}/gi, (_, a, m, d) => [a, m, d].filter(Boolean).join('-'));
  s = s.replace(/\{\{\s*(?:nowrap|nobr|small|abbr)\s*\|\s*([^|}]+)[^}]*\}\}/gi, '$1');
  for (let i = 0; i < 3; i += 1) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1');
  s = s.replace(/'{2,}/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(/^[;,\s]+|[;,\s]+$/g, '');
}

/**
 * Campos das caixas de informação (Infobox/Info/Ficha/Aircraft specs) do
 * wikitexto. Só campos com valor curto — a ficha é para conferir números.
 */
function camposDaInfobox(wikitexto, maximo = 40) {
  const linhas = String(wikitexto || '').split('\n');
  const campos = [];
  let dentro = 0;
  for (const linha of linhas) {
    if (/^\s*\{\{\s*(infobox|info\/|ficha|aircraft specs|especifica|caixa)/i.test(linha)) dentro += 1;
    if (!dentro) continue;
    const m = /^\s*\|\s*([^=|{}]{1,40}?)\s*=\s*(.*)$/.exec(linha);
    if (m) {
      const chave = m[1].trim().toLowerCase();
      const valor = limparValor(m[2]);
      if (valor && valor.length <= 90 && !/^(image|imagem|caption|legenda|alt|logo|mapa|map|signature|assinatura)/.test(chave)) {
        campos.push({ chave, valor });
      }
    }
    if (/^\s*\}\}\s*$/.test(linha)) dentro = Math.max(0, dentro - 1);
    if (campos.length >= maximo) break;
  }
  return campos;
}

/** Título do artigo: link da Wikipédia que já veio na busca, senão a busca da própria Wikipédia. */
async function tituloNaWikipedia(assunto, idioma, resultados, signal) {
  const doResultado = (resultados || [])
    .map((r) => new RegExp(`^https?://${idioma}\\.(?:m\\.)?wikipedia\\.org/wiki/([^#?]+)`, 'i').exec(r.url || ''))
    .find(Boolean);
  if (doResultado) return decodeURIComponent(doResultado[1]).replace(/_/g, ' ');
  // Termo em português não serve de busca na Wikipédia em inglês ("gerador"
  // achava "CPF number", execução real de 11/10): a página em inglês vem do
  // link entre idiomas da página em português. Sem página em português
  // (nome próprio, "SR-71"), vale a busca de sempre.
  if (idioma === 'en') {
    const pt = await tituloNaWikipedia(assunto, 'pt', resultados, signal).catch(() => null);
    if (pt) {
      const l = await jsonDe(`https://pt.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=en&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(pt)}`, signal);
      return l?.query?.pages?.[0]?.langlinks?.[0]?.title || null;
    }
  }
  const d = await jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(assunto)}`, signal);
  return d?.query?.search?.[0]?.title || null;
}

async function wikipedia(assunto, idioma, resultados, signal) {
  const titulo = await tituloNaWikipedia(assunto, idioma, resultados, signal);
  if (!titulo) return null;
  const t = encodeURIComponent(titulo);
  const [intro, wiki] = await Promise.allSettled([
    jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&piprop=thumbnail&pithumbsize=640&exintro=1&explaintext=1&redirects=1&format=json&titles=${t}`, signal),
    jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&formatversion=2&page=${t}`, signal),
  ]);
  const pagina = intro.status === 'fulfilled' ? Object.values(intro.value?.query?.pages || {})[0] : null;
  const wikitexto = wiki.status === 'fulfilled' ? wiki.value?.parse?.wikitext || '' : '';
  let texto = String(pagina?.extract || '').trim();
  // introdução de uma frase ("Gerador elétrico": 140 caracteres) não explica
  // nada: pega o começo do artigo inteiro
  if (texto.length < 600) {
    const longo = await jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=3000&redirects=1&format=json&titles=${t}`, signal).catch(() => null);
    const maior = String(Object.values(longo?.query?.pages || {})[0]?.extract || '').trim();
    if (maior.length > texto.length) texto = maior;
  }
  if (!texto && !wikitexto) return null;
  return {
    idioma,
    titulo: pagina?.title || titulo,
    url: `https://${idioma}.wikipedia.org/wiki/${encodeURIComponent(String(pagina?.title || titulo).replace(/ /g, '_'))}`,
    introducao: texto,
    imagem: pagina?.thumbnail?.source || null, // imagem principal do artigo (vira a referência da resposta)
    campos: camposDaInfobox(wikitexto),
  };
}

/* ------------------------------ conferência ------------------------------ */

/** "3.540" → 3540 · "32,74" → 32.74 · "3,540" (en) → 3540 · "32.74" (en) → 32.74 */
function numero(s, { ingles = false } = {}) {
  let t = String(s).trim();
  if (ingles) return Number(t.replace(/,/g, ''));
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/\.\d{3}(\D|$)/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}
const formatar = (n) => (Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

const POR_EXTENSO = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

/**
 * Fatos conferíveis: chave da infobox (en ou pt) → palavra do texto em
 * português + unidade. A unidade em que o fato é comparado é a métrica.
 */
const CONFERIVEIS = [
  { nome: 'comprimento', chave: /^(length m|comprimento)\b/, texto: /\bcomprimento\b/i, unidade: 'm' },
  { nome: 'envergadura', chave: /^(span m|envergadura)\b/, texto: /\benvergadura\b/i, unidade: 'm' },
  { nome: 'altura', chave: /^(height m|altura)$/, texto: /\baltura\b(?! de (voo|servi|cruzeiro))/i, unidade: 'm' },
  { nome: 'peso vazio', chave: /^(empty weight kg|peso vazio)\b/, texto: /\bpeso vazio\b/i, unidade: 'kg' },
  { nome: 'peso máximo', chave: /^(max takeoff weight kg|gross weight kg|peso m[aá]ximo)\b/, texto: /\bpeso m[aá]ximo\b/i, unidade: 'kg' },
  { nome: 'velocidade máxima', chave: /^(max speed kmh|velocidade m[aá]xima)\b/, texto: /\bvelocidade m[aá]xima\b/i, unidade: 'km/h' },
  { nome: 'teto de serviço', chave: /^(ceiling m|teto)\b/, texto: /\b(teto|altitude de servi[cç]o|altitude m[aá]xima)\b/i, unidade: 'm' },
  { nome: 'alcance', chave: /^(range km|alcance)\b/, texto: /\balcance\b/i, unidade: 'km' },
  { nome: 'tripulação', chave: /^(crew|tripula[cç][aã]o)$/, texto: /\btripula[cç][aã]o\b/i, unidade: 'contagem' },
  { nome: 'unidades construídas', chave: /^(number built|n[uú]mero constru[ií]do|unidades constru[ií]das|quantidade produzida|produ[cç][aã]o)\b/, texto: /\b(unidades|exemplares|aeronaves) (foram )?(constru[ií]d|produzid|fabricad)|\b(constru[ií]d|produzid|fabricad)\w* (apenas |somente )?\d+/i, unidade: 'contagem' },
  { nome: 'primeiro voo', chave: /^(first flight|primeiro voo|voo inaugural)\b/, texto: /\b(primeiro voo|voo inaugural|voou pela primeira vez)\b/i, unidade: 'ano' },
  { nome: 'entrada em serviço', chave: /^(introduction|introdu[cç][aã]o|entrada em servi[cç]o)\b/, texto: /\b(entrada em servi[cç]o|entrou em (servi[cç]o|opera[cç][aã]o)|introduzid)/i, unidade: 'ano' },
];

/** Os fatos conferíveis da ficha, com o valor já na unidade de comparação. */
function fatosDaFicha(fontes) {
  const fatos = [];
  for (const regra of CONFERIVEIS) {
    for (const f of fontes) {
      const campo = (f.campos || []).find((c) => regra.chave.test(c.chave));
      if (!campo) continue;
      const ingles = f.idioma === 'en';
      let valor = null;
      if (regra.unidade === 'ano') valor = Number((/\b(1[89]\d\d|20\d\d)\b/.exec(campo.valor) || [])[1]) || null;
      else if (regra.unidade === 'contagem') {
        const m = /^\D{0,20}?(\d{1,6}(?:[.,]\d{3})*)/.exec(campo.valor);
        valor = m ? numero(m[1], { ingles }) : null;
      } else {
        // "32.74" (chave já em metros) ou "32,74 m" / "32.74 m" no valor
        const m = /(\d[\d.,]*)\s*(m|kg|km\/h|km)?\b/.exec(campo.valor);
        if (m && (!m[2] || m[2] === regra.unidade)) valor = numero(m[1], { ingles });
      }
      if (valor && Number.isFinite(valor)) {
        fatos.push({ ...regra, valor, de: `${f.idioma}.wikipedia` });
        break;
      }
    }
  }
  return fatos;
}

const UNIDADE_NO_TEXTO = {
  m: /(\d[\d.,]*)\s*(?:m|metros?)\b(?![\w/])/gi,
  kg: /(\d[\d.,]*)\s*(?:kg|quilos?|quilogramas?)\b/gi,
  'km/h': /(\d[\d.,]*)\s*km\/h\b/gi,
  km: /(\d[\d.,]*)\s*(?:km|quil[oô]metros?)\b(?!\/)/gi,
};

/**
 * Troca, na linha/frase que fala do fato, o número que contradiz a ficha.
 * Só mexe quando há UM candidato na unidade certa (senão não sabe qual é) e
 * a diferença passa de 8% (arredondamento não conta). Devolve o texto e as
 * correções feitas.
 */
function conferirNumeros(texto, fatos) {
  const correcoes = [];
  const partes = String(texto).split(/(\n)/);
  for (let i = 0; i < partes.length; i += 1) {
    let linha = partes[i];
    if (linha === '\n' || !linha.trim()) continue;
    for (const fato of fatos) {
      if (!fato.texto.test(linha)) continue;
      if (fato.unidade === 'ano') {
        const anos = [...linha.matchAll(/\b(1[89]\d\d|20\d\d)\b/g)];
        if (anos.length === 1 && Number(anos[0][1]) !== fato.valor) {
          correcoes.push({ fato: fato.nome, de: anos[0][1], para: String(fato.valor) });
          linha = linha.replace(anos[0][1], String(fato.valor));
        }
      } else if (fato.unidade === 'contagem') {
        // número logo depois da palavra ("Tripulação: 3 pessoas", "tripulação de duas pessoas")
        const depois = linha.slice(linha.search(fato.texto));
        const m = /^[^\d\n]{0,40}?\b(\d{1,6}(?:\.\d{3})*|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\b/i.exec(depois);
        if (m) {
          const lido = POR_EXTENSO[m[1].toLowerCase()] ?? numero(m[1]);
          if (lido !== fato.valor) {
            const novo = /^\d/.test(m[1]) ? formatar(fato.valor) : String(fato.valor);
            const posicao = linha.search(fato.texto) + m.index + m[0].length - m[1].length;
            linha = linha.slice(0, posicao) + novo + linha.slice(posicao + m[1].length);
            correcoes.push({ fato: fato.nome, de: m[1], para: novo });
          }
        }
      } else {
        const re = UNIDADE_NO_TEXTO[fato.unidade];
        const achados = [...linha.matchAll(re)];
        if (achados.length === 1) {
          const lido = numero(achados[0][1]);
          if (lido > 0 && Math.abs(lido - fato.valor) / fato.valor > 0.08) {
            const novo = formatar(fato.valor);
            linha = linha.replace(achados[0][1], novo);
            correcoes.push({ fato: fato.nome, de: achados[0][1], para: novo });
          }
        }
      }
    }
    partes[i] = linha;
  }
  return { texto: partes.join(''), correcoes };
}

/* ------------------------------ prompt ------------------------------ */

function fichaParaPrompt({ wikis, paginas, fatos }) {
  const blocos = [];
  if (fatos.length) {
    blocos.push(`DADOS CONFERIDOS (valem mais que a sua memória):\n${fatos.map((f) => `- ${f.nome}: ${formatar(f.valor)}${['m', 'kg', 'km/h', 'km'].includes(f.unidade) ? ` ${f.unidade}` : ''}`).join('\n')}`);
  }
  for (const w of wikis) {
    const campos = w.campos.length ? `\nFicha técnica:\n${w.campos.slice(0, 30).map((c) => `- ${c.chave}: ${c.valor}`).join('\n')}` : '';
    blocos.push(`WIKIPÉDIA (${w.idioma}) — ${w.titulo}\n${w.introducao.slice(0, w.idioma === 'pt' ? 2800 : 2400)}${campos}`);
  }
  for (const p of paginas) blocos.push(`TRECHO DE ${p.dominio}:\n${p.texto.slice(0, 1800)}`);
  return blocos.join('\n\n');
}

/** Quem pede detalhe ("história completa", "mais sobre", "a fundo") recebe a resposta longa mesmo com a curta ligada. */
const pedeDetalhe = (objetivo) => /(complet[ao]s?|detalh|a fundo|aprofund|tudo sobre|mais sobre|hist[oó]ria)/i.test(String(objetivo || ''));
const respostaCurta = (config, objetivo) => config.autoRespostaCurta !== false && !pedeDetalhe(objetivo);

function sistemaLivre(config, comMaterial, curta = false) {
  const base = config.chatSystem || 'Você é um assistente prestativo, direto e preciso. Responda em português do Brasil, em markdown quando ajudar a clareza.';
  if (!comMaterial) return base;
  return `${base}

Responda com liberdade: escolha a estrutura, o tom e o que destacar, como faria normalmente — subtítulos, listas, tabela e curiosidades são bem-vindos quando ajudarem a ler. Comece pelo que torna o assunto marcante.

Junto com o pedido vem uma FICHA DE CONFERÊNCIA (Wikipédia e páginas da web). Use-a para acertar os fatos:
- números, datas, quantidades e nomes têm de bater com a ficha; se o que você lembra divergir, vale a ficha;
- número de que você não tem certeza e que não está na ficha: descreva sem o número;
- não escreva marcadores de fonte como [1] nem uma seção de fontes — elas entram no fim automaticamente.${
    curta
      ? '\n\nSEJA BREVE: responda em até 200 palavras, direto ao ponto, sem introdução nem conclusão. Só o essencial para responder bem.'
      : ''
  }`;
}

/* ------------------------------ execução ------------------------------ */

const dominioDe = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const PULAR_PAGINA = /(youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|pinterest\.|reddit\.com|wikipedia\.org|wikimedia\.org|amazon\.|mercadolivre|shopee|aliexpress)/i;

/**
 * Nível 0 (sem material) e nível 1 (com ficha). Devolve
 * { texto, fontes, correcoes, wikis, paginas } ou lança erro — quem chama
 * cai para o laço normal se falhar.
 */
async function responderRapido({ objetivo, conversa = [], config, nivel = 1, emit = () => {}, signal, deps = {}, dirImagens = null }) {
  const d = {
    imagem: (assunto, wikis) => imagens.imagemDeReferencia(assunto, { daWikipedia: wikis.map((w) => w.imagem), config, dir: dirImagens }),
    buscar: (consulta) => buscar(consulta, { searxngUrl: config.searxngUrl, marginaliaKey: config.marginaliaKey, jinaKey: config.jinaKey }),
    wikipedia: (assunto, idioma, resultados) => wikipedia(assunto, idioma, resultados, signal),
    ler: (url) => ler(url, { render: null, permitirExterno: false, conferir: (destino) => conferirDestino(destino, config) }),
    escrever: (opcoes) => ollama.chatStream(opcoes),
    // conferência da resposta imediata: chamada curta ao modelo PRINCIPAL
    conferir: ({ ficha, texto }) =>
      ollama.chat({
        host: config.host,
        model: config.model,
        messages: [
          { role: 'system', content: SISTEMA_DA_CONFERENCIA },
          { role: 'user', content: pedidoDaConferencia(ficha, texto) },
        ],
        temperature: 0,
        numCtx: config.numCtx || 8192,
        numPredict: 260,
        pensar: false,
        manterVivo: config.manterModeloVivo,
        signal,
      }),
    ...deps,
  };
  const comTempo = (promessa, ms) => Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);

  // Conta: quem calcula é o código. Na medição de qualidade de 11/10 o modelo
  // respondeu 2991,64 para "(12783,23 * 0,17) + 823,42", que dá 2996,57.
  // Expressão que o avaliador não entende segue para o modelo, como antes.
  if (nivel === 0) {
    const expressao = String(objetivo).replace(/^\s*quanto\s+(é|e|dá|da)\s+/i, '').replace(/[?=\s]+$/, '').replace(/x/gi, '*');
    const conta = /\d\s*[-+*/^%]\s*[\d(]/.test(expressao) ? await calculadora.run({ expressao }).catch(() => null) : null;
    if (conta) {
      emit('resposta-token', { pedaco: conta });
      return { texto: conta, fontes: [], correcoes: [], wikis: [], paginas: [], fatos: 0, uso: { promptTokens: 0, completionTokens: 0, duracaoMs: 0 } };
    }
  }

  let wikis = [];
  let paginas = [];
  let fatos = [];
  let figura = null;
  /** Busca + Wikipédia (pt e en) + até duas páginas: o material de conferência. */
  const pesquisar = async () => {
    const assunto = assuntoDoPedido(objetivo).split(/[,;]|\s+em (uma|poucas|duas|tr[eê]s) (frase|linha|palavra)/i)[0].trim();
    emit('auto-pesquisa', { assunto });
    const busca = await comTempo(d.buscar(assunto), 12000).catch((err) => ({ resultados: [], falhas: [err.message] }));
    const resultados = busca?.resultados || [];
    if (resultados.length) emit('fonte', { tipo: 'busca', provedor: busca.provedor, falhas: busca.falhas || [], consultas: [assunto] });
    const candidatas = resultados.filter((r) => r.url && !PULAR_PAGINA.test(r.url)).slice(0, 2);
    const [pt, en, ...lidas] = await Promise.allSettled([
      comTempo(d.wikipedia(assunto, 'pt', resultados), 12000),
      comTempo(d.wikipedia(assunto, 'en', resultados), 12000),
      ...candidatas.map((r) => comTempo(d.ler(r.url), TEMPO_DA_PAGINA_MS).then((p) => ({ ...p, url: r.url }))),
    ]);
    // página sem texto nem ficha não é material (e não conta para o guarda abaixo)
    wikis = [pt, en].filter((r) => r.status === 'fulfilled' && r.value && (r.value.introducao || r.value.campos?.length)).map((r) => r.value);
    paginas = lidas
      .filter((r) => r.status === 'fulfilled' && r.value?.texto && r.value.texto.length > 400)
      .map((r) => ({ url: r.value.url, dominio: dominioDe(r.value.url), texto: String(r.value.texto).replace(/\n{3,}/g, '\n\n') }));
    for (const w of wikis) emit('fonte', { tipo: 'leitura', provedor: 'api-wikipedia', url: w.url, falhas: 0 });
    for (const p of paginas) emit('fonte', { tipo: 'leitura', provedor: 'leitura-rapida', url: p.url, falhas: 0 });
    fatos = fatosDaFicha(wikis);
    // imagem de referência: baixada enquanto o modelo escreve (não soma tempo)
    if (dirImagens && config.imagensNasRespostas !== false && (wikis.length || paginas.length)) figura = imagens.comLimite(d.imagem(assunto, wikis), 10000);
  };
  const historico = (Array.isArray(conversa) ? conversa : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 3000) }));
  const escrever = (mensagens, numPredict) =>
    d.escrever({
      host: config.host,
      model: config.autoModeloRapido || config.model,
      messages: mensagens,
      temperature: Math.max(0.5, Number(config.temperature) || 0.6),
      numCtx: config.numCtxRedacao || config.numCtx || 8192,
      numPredict,
      manterVivo: config.manterModeloVivo,
      pensar: false,
      signal,
      onToken: (pedaco) => emit('resposta-token', { pedaco }),
    });
  const resultado = (texto, usos, extra = {}) => ({
    texto,
    fontes: [...wikis.map((w) => w.url), ...paginas.map((p) => p.url)],
    correcoes: [],
    wikis: wikis.map((w) => ({ idioma: w.idioma, titulo: w.titulo, campos: w.campos.length })),
    paginas: paginas.map((p) => p.url),
    fatos: fatos.length,
    uso: {
      promptTokens: usos.reduce((n, u) => n + (u?.promptTokens || 0), 0),
      completionTokens: usos.reduce((n, u) => n + (u?.completionTokens || 0), 0),
      duracaoMs: usos.reduce((n, u) => n + (u?.durationMs || 0), 0),
    },
    ...extra,
  });

  // Resposta imediata (11/10, ideia do Davi a partir da aba Conversa): o
  // modelo começa a escrever JÁ, como na Conversa, enquanto a pesquisa corre
  // em paralelo; quando o texto termina, ele é CONFERIDO contra o material
  // (números pelo código, o resto por uma chamada curta ao modelo principal)
  // e a resposta ganha a nota da conferência, as fontes e a imagem.
  if (nivel === 1 && config.autoRespostaImediata === true) {
    const pesquisa = pesquisar().catch(() => {});
    emit('redigindo', { fontes: 0, cobertura: 'resposta imediata (a conferência com as fontes vem em seguida)' });
    emit('chamada', { tipo: 'redacao' });
    const r = await escrever([{ role: 'system', content: sistemaLivre(config, false) }, ...historico, { role: 'user', content: objetivo }], Math.min(config.numPredictResposta || 1024, 1024));
    let texto = String(r?.content || '').trim();
    if (!texto) throw new Error('o modelo devolveu uma resposta vazia');
    await comTempo(pesquisa, 15000).catch(() => {});
    const ficha = fichaParaPrompt({ wikis, paginas, fatos });
    if (!ficha) {
      const nota = '*(Não consegui conferir esta resposta na internet: a pesquisa não trouxe material. O texto acima é conhecimento geral do modelo.)*';
      emit('resposta-token', { pedaco: `\n\n${nota}` });
      return resultado(`${texto}\n\n${nota}`, [r], { imagem: null, conferencia: { conferida: false, erros: [] } });
    }
    const conferida = conferirNumeros(texto, fatos);
    texto = conferida.texto;
    emit('chamada', { tipo: 'conferencia' });
    const c = await comTempo(d.conferir({ ficha, texto }), 20000).catch(() => null);
    const erros = c ? lerConferencia(c.content) : null;
    const fontes = wikis.length + paginas.length;
    const nota =
      erros === null
        ? `*(Li ${fontes} fonte(s), mas a conferência automática falhou — confira os dados importantes.)*`
        : erros.length
          ? `**Conferência com as fontes — atenção:**\n${erros.map((e) => `- A resposta diz "${e.resposta}". As fontes dizem: ${e.ficha}`).join('\n')}`
          : `*Conferido com ${fontes} fonte(s): nenhuma contradição encontrada.*`;
    emit('resposta-token', { pedaco: `\n\n${nota}` });
    return resultado(`${texto}\n\n${nota}`, [r, c], { correcoes: conferida.correcoes, imagem: figura ? await figura : null, conferencia: { conferida: erros !== null, erros: erros || [] } });
  }

  if (nivel >= 1) await pesquisar();

  const ficha = nivel >= 1 ? fichaParaPrompt({ wikis, paginas, fatos }) : '';
  // Nível 1 sem NENHUM material (busca e Wikipédia falharam): escrever assim
  // mesmo dava resposta inventada, sem aviso e sem conferência (execução real
  // de 11/10, "Como um gerador funciona ?": "girodutos", "motores
  // eletrostáticos"). O erro devolve o pedido ao laço do agente, que pesquisa
  // de novo e, se não achar, avisa que é conhecimento geral.
  if (nivel >= 1 && !ficha) throw new Error('a pesquisa rápida não trouxe material');
  const pedido = ficha ? `${objetivo}\n\n---\nFICHA DE CONFERÊNCIA (não copie, use para acertar os fatos):\n${ficha}` : objetivo;

  emit('redigindo', { fontes: wikis.length + paginas.length, cobertura: ficha ? 'boa' : 'sem pesquisa' });
  emit('chamada', { tipo: 'redacao' });
  const r = await escrever([{ role: 'system', content: sistemaLivre(config, Boolean(ficha), respostaCurta(config, objetivo)) }, ...historico, { role: 'user', content: pedido }], respostaCurta(config, objetivo) ? 700 : Math.min(config.numPredictResposta || 2048, 2048));
  let texto = String(r?.content || '').trim();
  if (!texto) throw new Error('o modelo devolveu uma resposta vazia');

  const conferida = conferirNumeros(texto, fatos);
  texto = conferida.texto;
  return resultado(texto, [r], { correcoes: conferida.correcoes, imagem: figura ? await figura : null });
}

/* ------------------------------ conferência da resposta imediata ------------------------------ */

const SISTEMA_DA_CONFERENCIA =
  'Você confere uma RESPOSTA contra uma FICHA de fontes. Aponte SOMENTE o que a RESPOSTA afirma e a FICHA contradiz (outra data, outro número, outro nome, outro lugar, o oposto). ' +
  'O que a RESPOSTA diz e a FICHA não menciona NÃO é erro. Quando a FICHA diz a mesma coisa com mais detalhe, NÃO é erro. Não comente estilo.';

function pedidoDaConferencia(ficha, texto) {
  return `FICHA:\n${String(ficha).slice(0, 9000)}\n\nRESPOSTA:\n"""\n${String(texto).slice(0, 5000)}\n"""\n\nSe a FICHA contradiz algo da RESPOSTA, escreva uma linha por erro, no máximo 3, neste formato exato:\nERRO: <o que a resposta diz> | FICHA: <o que a ficha diz>\nSe não houver contradição, escreva só: OK`;
}

/**
 * Lê as linhas "ERRO: … | FICHA: …". Descarta alarme falso evidente: quando a
 * frase apontada tem números e TODOS aparecem no trecho da ficha, a ficha
 * está confirmando, não contradizendo (protótipo de 11/10: "nascido em 1912"
 * acusado contra "23 de junho de 1912").
 */
function lerConferencia(conteudo) {
  const numeros = (t) => String(t).match(/\d[\d.,]*\d|\d/g) || [];
  const erros = [];
  for (const linha of String(conteudo || '').split('\n')) {
    const m = /^\s*[-*]?\s*ERRO:\s*(.+?)\s*\|\s*FICHA:\s*(.+?)\s*$/i.exec(linha);
    if (!m) continue;
    const [, resposta, ficha] = m;
    const daResposta = numeros(resposta);
    if (daResposta.length && daResposta.every((n) => numeros(ficha).includes(n))) continue;
    // "a ficha não menciona isso" não é contradição (medição de 11/10: "As fontes dizem: Não menciona nenhuma forma…")
    if (/\bn[aã]o\s+(menciona|cita|fala|diz|informa|consta|aborda|trata)\b/i.test(ficha)) continue;
    erros.push({ resposta: resposta.replace(/^["“]|["”.]+$/g, '').slice(0, 220), ficha: ficha.replace(/["“”]/g, '').slice(0, 260) });
  }
  return erros.slice(0, 3);
}

module.exports = { responderRapido, conferirNumeros, fatosDaFicha, camposDaInfobox, limparValor, numero, fichaParaPrompt, lerConferencia, pedidoDaConferencia, SISTEMA_DA_CONFERENCIA };
