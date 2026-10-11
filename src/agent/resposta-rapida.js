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
  const d = await jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(assunto)}`, signal);
  return d?.query?.search?.[0]?.title || null;
}

async function wikipedia(assunto, idioma, resultados, signal) {
  const titulo = await tituloNaWikipedia(assunto, idioma, resultados, signal);
  if (!titulo) return null;
  const t = encodeURIComponent(titulo);
  const [intro, wiki] = await Promise.allSettled([
    jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${t}`, signal),
    jsonDe(`https://${idioma}.wikipedia.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&formatversion=2&page=${t}`, signal),
  ]);
  const pagina = intro.status === 'fulfilled' ? Object.values(intro.value?.query?.pages || {})[0] : null;
  const wikitexto = wiki.status === 'fulfilled' ? wiki.value?.parse?.wikitext || '' : '';
  const texto = String(pagina?.extract || '').trim();
  if (!texto && !wikitexto) return null;
  return {
    idioma,
    titulo: pagina?.title || titulo,
    url: `https://${idioma}.wikipedia.org/wiki/${encodeURIComponent(String(pagina?.title || titulo).replace(/ /g, '_'))}`,
    introducao: texto,
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

function sistemaLivre(config, comMaterial) {
  const base = config.chatSystem || 'Você é um assistente prestativo, direto e preciso. Responda em português do Brasil, em markdown quando ajudar a clareza.';
  if (!comMaterial) return base;
  return `${base}

Responda com liberdade: escolha a estrutura, o tom e o que destacar, como faria normalmente — subtítulos, listas, tabela e curiosidades são bem-vindos quando ajudarem a ler. Comece pelo que torna o assunto marcante.

Junto com o pedido vem uma FICHA DE CONFERÊNCIA (Wikipédia e páginas da web). Use-a para acertar os fatos:
- números, datas, quantidades e nomes têm de bater com a ficha; se o que você lembra divergir, vale a ficha;
- número de que você não tem certeza e que não está na ficha: descreva sem o número;
- não escreva marcadores de fonte como [1] nem uma seção de fontes — elas entram no fim automaticamente.`;
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
async function responderRapido({ objetivo, conversa = [], config, nivel = 1, emit = () => {}, signal, deps = {} }) {
  const d = {
    buscar: (consulta) => buscar(consulta, { searxngUrl: config.searxngUrl, marginaliaKey: config.marginaliaKey, jinaKey: config.jinaKey }),
    wikipedia: (assunto, idioma, resultados) => wikipedia(assunto, idioma, resultados, signal),
    ler: (url) => ler(url, { render: null, permitirExterno: false, conferir: (destino) => conferirDestino(destino, config) }),
    escrever: (opcoes) => ollama.chatStream(opcoes),
    ...deps,
  };
  const comTempo = (promessa, ms) => Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);

  let wikis = [];
  let paginas = [];
  let fatos = [];
  if (nivel >= 1) {
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
    wikis = [pt, en].filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
    paginas = lidas
      .filter((r) => r.status === 'fulfilled' && r.value?.texto && r.value.texto.length > 400)
      .map((r) => ({ url: r.value.url, dominio: dominioDe(r.value.url), texto: String(r.value.texto).replace(/\n{3,}/g, '\n\n') }));
    for (const w of wikis) emit('fonte', { tipo: 'leitura', provedor: 'api-wikipedia', url: w.url, falhas: 0 });
    for (const p of paginas) emit('fonte', { tipo: 'leitura', provedor: 'leitura-rapida', url: p.url, falhas: 0 });
    fatos = fatosDaFicha(wikis);
  }

  const ficha = nivel >= 1 ? fichaParaPrompt({ wikis, paginas, fatos }) : '';
  // Nível 1 sem NENHUM material (busca e Wikipédia falharam): escrever assim
  // mesmo dava resposta inventada, sem aviso e sem conferência (execução real
  // de 11/10, "Como um gerador funciona ?": "girodutos", "motores
  // eletrostáticos"). O erro devolve o pedido ao laço do agente, que pesquisa
  // de novo e, se não achar, avisa que é conhecimento geral.
  if (nivel >= 1 && !ficha) throw new Error('a pesquisa rápida não trouxe material');
  const historico = (Array.isArray(conversa) ? conversa : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 3000) }));
  const pedido = ficha ? `${objetivo}\n\n---\nFICHA DE CONFERÊNCIA (não copie, use para acertar os fatos):\n${ficha}` : objetivo;

  emit('redigindo', { fontes: wikis.length + paginas.length, cobertura: ficha ? 'boa' : 'sem pesquisa' });
  emit('chamada', { tipo: 'redacao' });
  const r = await d.escrever({
    host: config.host,
    model: config.autoModeloRapido || config.model,
    messages: [{ role: 'system', content: sistemaLivre(config, Boolean(ficha)) }, ...historico, { role: 'user', content: pedido }],
    temperature: Math.max(0.5, Number(config.temperature) || 0.6),
    numCtx: config.numCtxRedacao || config.numCtx || 8192,
    numPredict: Math.min(config.numPredictResposta || 2048, 2048),
    manterVivo: config.manterModeloVivo,
    pensar: false,
    signal,
    onToken: (pedaco) => emit('resposta-token', { pedaco }),
  });
  let texto = String(r?.content || '').trim();
  if (!texto) throw new Error('o modelo devolveu uma resposta vazia');

  const conferida = conferirNumeros(texto, fatos);
  texto = conferida.texto;
  const fontes = [...wikis.map((w) => w.url), ...paginas.map((p) => p.url)];
  return {
    texto,
    fontes,
    correcoes: conferida.correcoes,
    wikis: wikis.map((w) => ({ idioma: w.idioma, titulo: w.titulo, campos: w.campos.length })),
    paginas: paginas.map((p) => p.url),
    fatos: fatos.length,
    uso: { promptTokens: r.promptTokens || 0, completionTokens: r.completionTokens || 0, duracaoMs: r.durationMs || 0 },
  };
}

module.exports = { responderRapido, conferirNumeros, fatosDaFicha, camposDaInfobox, limparValor, numero, fichaParaPrompt };
