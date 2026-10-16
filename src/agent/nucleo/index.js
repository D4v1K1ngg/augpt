'use strict';

/**
 * Núcleo de pesquisa (15/10) — substitui o caminho de pesquisa antigo (regras
 * de rota, níveis do automático, motor de pesquisa, montador de resposta).
 * Desenho tirado dos projetos de referência lidos em 14–15/10:
 *   1. ENTENDER (Perplexica, Open WebUI): uma chamada diz se precisa buscar e
 *      reescreve a pergunta para fazer sentido sozinha ("e ele?" → "e o Tesla?").
 *      Na dúvida, busca.
 *   2. PESQUISAR (Perplexica, Local Deep Research): o MODELO conduz com
 *      ferramentas nativas do Ollama — buscar_na_web (até 3 buscas por vez),
 *      ler_pagina (com um foco) e pronto. O código só executa. Rodadas: 2
 *      (rápido), 6 (normal), 12 (profundo).
 *   3. SELECIONAR (GPT Researcher, Open WebUI): trechos escolhidos por palavra
 *      exata + semelhança de significado (ranking.js), sem chamar o modelo
 *      para cada página.
 *   4. ESCREVER (GPT Researcher, Perplexica): UMA chamada, com as fontes
 *      numeradas, livre na forma; nada de reescrita depois.
 * Tudo que fala com rede ou modelo vem por `deps` — a bancada usa dublês.
 */

const { pedacos, ordenar } = require('./ranking');
const { tituloCita } = require('../../tools/imagens');

/**
 * Profundidade da pesquisa (15/10, a partir do Perplexica — modo qualidade:
 * "nunca pare antes de 5–6 rodadas", ângulos definidos — e do Local Deep
 * Research — várias leituras por tema). `minBuscas`: o código não aceita
 * "pronto" antes disso; `leituras`: teto de páginas lidas; `comunidade`:
 * tópicos da comunidade lidos em pedido de produto. `minLeituras` (Fase 2,
 * 16/10): páginas lidas de verdade antes da escrita — o resumo do buscador
 * tem 2 linhas e a resposta saía apoiada nele; o que o modelo não ler, o
 * código lê.
 */
const MODOS = {
  rapido: { rodadas: 2, minBuscas: 0, leituras: 2, minLeituras: 0, comunidade: 1 },
  normal: { rodadas: 6, minBuscas: 2, leituras: 5, minLeituras: 3, comunidade: 2 },
  profundo: { rodadas: 12, minBuscas: 5, leituras: 10, minLeituras: 6, comunidade: 3 },
};
const RODADAS = Object.fromEntries(Object.entries(MODOS).map(([k, v]) => [k, v.rodadas]));
// os ângulos do modo profundo (Perplexica, research_strategy)
const ANGULOS = 'o que é e visão geral; especificações e dados técnicos; comparação com alternativas; novidades recentes; opinião de especialistas e reviews; experiência de quem usa; limitações e críticas; preço';
const dominio = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/* ------------------------------ 1. entender ------------------------------ */

function pedidoDeEntendimento({ pergunta, conversa = [], hoje }) {
  const historico = conversa
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${String(m.content || '').slice(0, 400)}`)
    .join('\n');
  return `Hoje é ${hoje}. Leia a conversa e a última mensagem do usuário.
${historico ? `\nCONVERSA ATÉ AGORA:\n${historico}\n` : ''}
ÚLTIMA MENSAGEM: ${String(pergunta).slice(0, 1500)}

Responda SÓ com um JSON:
{"precisa_buscar": true ou false, "produto": true ou false, "assuntos": ["..."], "pergunta": "a última mensagem reescrita para fazer sentido sozinha, sem depender da conversa"}

- "assuntos": de 0 a 4 coisas concretas de que a pergunta trata e que têm uma imagem — pessoa, lugar, produto ou modelo, objeto, animal, obra, veículo — com o nome completo e já resolvido pela conversa (ex.: "Dunu Titan S", "Nikola Tesla", "Torre Eiffel"). Ideia abstrata, conta ou assunto genérico ("inflação", "como funciona") não entra; país, cidade ou empresa citados só como contexto ("no Brasil", "da Nvidia") também não.

- "produto" é true quando o usuário quer escolher, comparar, avaliar ou conhecer produtos ou itens para comprar ou usar (fone, mouse, celular, geladeira, carro, um modelo específico…). Para explicação, notícia, pessoa, história ou como algo funciona, false.

- "precisa_buscar" é true para qualquer pedido de informação: produto, preço, recomendação, comparação, notícia, pessoa, lugar, história, ciência, como algo funciona, dado ou número. Seu conhecimento pode estar desatualizado, então mesmo o que você sabe vale conferir.
- "precisa_buscar" é false SÓ para: saudação ou agradecimento, conta de matemática, tradução ou revisão de um texto que o usuário mandou, escrever um texto criativo, ou algo que a própria conversa já respondeu. Na dúvida, true.
- Em "pergunta", troque "ele", "isso", "o outro" pelo que eles são na conversa e traga o que a conversa já disse: depois de "qual o carro mais em conta para comprar em 2026?", a mensagem "e quanto ao vectra 2.0?" vira "o Chevrolet Vectra 2.0 usado é uma boa compra em 2026, e quanto custa?". Mantenha o resto como o usuário escreveu.`;
}

// o que pode ficar sem pesquisa: saudação, agradecimento, conta, tradução/revisão de texto, texto criativo
const SEM_BUSCA = /^\s*(oi|ol[aá]|bom dia|boa (tarde|noite)|e a[ií]|obrigad[oa]|valeu|vlw|tchau|ok|beleza|blz|show|legal|perfeito)\b[\s!.?]*$|^[\d\s.,+\-*/x×÷^%()=?]+$|\b(traduz|traduza|tradu[cç][aã]o|revise|revisar|corrija|reescreva|resuma este|resuma o texto|escreva um (poema|texto|conto|e-?mail|mensagem)|crie uma (hist[oó]ria|poesia|piada))\b/i;
const podeFicarSemBusca = (pergunta) => SEM_BUSCA.test(String(pergunta || '').trim());

function lerEntendimento(texto, pergunta, { comImagem = false } = {}) {
  try {
    const j = JSON.parse(String(texto).slice(String(texto).indexOf('{'), String(texto).lastIndexOf('}') + 1));
    // produto sempre busca (15/10: "fone de ouvido dunu titan s" saiu sem busca e o modelo disse que ele "não existe")
    const assuntos = (Array.isArray(j.assuntos) ? j.assuntos : []).map((a) => String(a || '').trim()).filter((a) => a.length >= 2 && a.length <= 80).slice(0, 4);
    // o modelo só decide "sem busca" no que é claramente conversa; um nome solto ("Dragon Ball Super Beerus") pesquisa
    const precisaBuscar = j.precisa_buscar !== false || j.produto === true || (!comImagem && !podeFicarSemBusca(pergunta));
    return { precisaBuscar, produto: j.produto === true, assuntos, pergunta: String(j.pergunta || '').trim() || pergunta };
  } catch {
    return { precisaBuscar: true, produto: false, assuntos: [], pergunta }; // JSON quebrado: busca, com a pergunta como veio
  }
}

/* ------------------------------ 2. pesquisar ------------------------------ */

const FERRAMENTA_DA_COMUNIDADE = {
  type: 'function',
  function: {
    name: 'buscar_na_comunidade',
    description: 'Busca no Reddit e em fóruns (Clube do Hardware, Adrenaline) o que quem usa recomenda, elogia e critica. Até 3 buscas por vez, só o assunto (sem "reddit" nem "site:"); para o Reddit, de preferência em inglês.',
    parameters: {
      type: 'object',
      properties: { buscas: { type: 'array', items: { type: 'string' }, description: 'de 1 a 3 assuntos' } },
      required: ['buscas'],
    },
  },
};

// Fase 3 (16/10): YouTube pelo yt-dlp — legenda e comentários, sem baixar o vídeo
const FERRAMENTAS_DO_YOUTUBE = [
  {
    type: 'function',
    function: {
      name: 'buscar_no_youtube',
      description: 'Busca vídeos no YouTube (review, teste, tutorial, como fazer). Até 2 buscas por vez, em palavras-chave; para tecnologia e produtos, de preferência em inglês.',
      parameters: {
        type: 'object',
        properties: { buscas: { type: 'array', items: { type: 'string' }, description: 'de 1 a 2 buscas' } },
        required: ['buscas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_video',
      description: 'Lê um vídeo dos resultados: o que é falado (pela legenda) e os comentários mais curtidos. Diga o foco: o que você quer descobrir nele.',
      parameters: {
        type: 'object',
        properties: {
          fonte: { type: 'number', description: 'o número [n] do vídeo nos resultados' },
          foco: { type: 'string', description: 'o que procurar no vídeo' },
        },
        required: ['fonte', 'foco'],
      },
    },
  },
];

// Fase 4 (16/10): olhar imagens achadas na web quando a aparência importa
const FERRAMENTA_DE_IMAGENS = {
  type: 'function',
  function: {
    name: 'ver_imagens',
    description: 'Busca imagens e olha as primeiras, quando a aparência importa: como algo é, cor, design, onde fica uma peça ou botão, diferença visual entre versões.',
    parameters: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'o que buscar nas imagens, em palavras-chave' },
        pergunta: { type: 'string', description: 'o que você quer descobrir olhando as imagens' },
      },
      required: ['busca', 'pergunta'],
    },
  },
};

const FERRAMENTAS = [
  {
    type: 'function',
    function: {
      name: 'buscar_na_web',
      description: 'Busca na web. Até 3 buscas por vez, curtas, em palavras-chave (não frases), de ângulos diferentes.',
      parameters: {
        type: 'object',
        properties: { buscas: { type: 'array', items: { type: 'string' }, description: 'de 1 a 3 buscas' } },
        required: ['buscas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ler_pagina',
      description: 'Lê uma página dos resultados quando o resumo não basta. Diga o foco: o que você quer descobrir nela.',
      parameters: {
        type: 'object',
        properties: {
          fonte: { type: 'number', description: 'o número [n] da página nos resultados' },
          foco: { type: 'string', description: 'o que procurar na página' },
        },
        required: ['fonte', 'foco'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pronto',
      description: 'Chame quando já tiver informação suficiente para responder bem à pergunta.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function sistemaDoPesquisador({ hoje, rodada, total, produto = false, modo = 'normal', youtube = false, verImagens = false }) {
  const regras = MODOS[modo] || MODOS.normal;
  return `Você é o pesquisador do AuGPT. Hoje é ${hoje}. Seu trabalho é juntar, com as ferramentas, a informação para responder muito bem à pergunta do usuário. Você não escreve a resposta: quando tiver o suficiente, chame "pronto".

- Seu conhecimento pode estar desatualizado: pesquise mesmo o que parece básico.
- Mantenha nas buscas as condições que o pedido deu: plataforma, tipo, versão, ano, orçamento, país. Busque exatamente o que a pergunta e a conversa falam — não troque por outro produto nem por outra categoria.
- Em buscar_na_web, mande até 3 buscas curtas por vez, de ângulos diferentes. Para tecnologia e produtos, inclua buscas em inglês, onde há mais material.
- Quando a pergunta pede opinião, experiência de uso ou recomendação, inclua buscas que tragam quem usa (por exemplo com "reddit" ou "fórum").
- Use ler_pagina nas páginas mais promissoras quando o resumo não basta, sempre com um foco.
${youtube ? '- Vídeos ajudam em review de produto, teste, tutorial e "como fazer": use buscar_no_youtube e ver_video (traz o que é falado e os comentários). Vídeo sem legenda só tem a descrição e os comentários.\n' : ''}${verImagens ? '- Quando a aparência importa (como algo é, cor, design, onde fica uma peça, diferença visual entre versões), use ver_imagens.\n' : ''}- Comece amplo e aprofunde no que os resultados mostrarem. Se 2 ou 3 buscas não acham algo, provavelmente não existe: siga em frente.
${produto ? `- Este pedido é sobre produtos: use buscar_na_comunidade pelo menos uma vez e leia com ler_pagina pelo menos ${regras.comunidade} tópico(s) da comunidade, para saber o que quem usa recomenda, elogia e critica. Busque também preço atual e especificações.\n` : ''}${
    modo === 'profundo'
      ? `- Esta é uma PESQUISA PROFUNDA: cubra vários ângulos (${ANGULOS}), faça pelo menos ${regras.minBuscas} buscas e leia de ${regras.minLeituras} a ${regras.leituras} páginas, cruzando o que uma fonte diz com as outras. Não pare cedo.\n`
      : modo === 'rapido'
        ? '- Esta é uma pesquisa RÁPIDA: uma ou duas buscas certeiras e pronto.\n'
        : `- Faça pelo menos ${regras.minBuscas} buscas e leia de ${regras.minLeituras} a ${regras.leituras} páginas.\n`
  }- Esta é a rodada ${rodada} de ${total}.`;
}

/** Os resultados como o pesquisador vê: "[n] título (domínio)\nresumo". */
const listaParaOModelo = (fontes) => fontes.map((f) => `[${f.n}] ${f.titulo || dominio(f.url)} (${dominio(f.url)}${f.comunidade ? ', comunidade' : ''}${f.video ? ', vídeo' : ''})\n${String(f.resumo || '').slice(0, 300)}`).join('\n\n');

/**
 * O laço do pesquisador. Devolve as fontes juntadas (numeradas, com resumo e,
 * quando lidas, os trechos escolhidos da página).
 */
async function pesquisar({ pergunta, modo = 'normal', deps, hoje, produto = false, assuntos = [], conversa = [], imagemAnexada = '' }) {
  const { chamar, buscar, lerPagina, embed, emit = () => {}, signal, buscarNaComunidade } = deps;
  // comunidade (15/10, pedido do Davi): em pedido de produto, Reddit e fóruns entram sempre
  const comComunidade = produto && typeof buscarNaComunidade === 'function';
  const comYoutube = typeof deps.buscarNoYoutube === 'function' && typeof deps.verVideo === 'function' && modo !== 'rapido';
  const comImagens = typeof deps.buscarImagensParaVer === 'function' && modo !== 'rapido';
  const ferramentas = [...(comComunidade ? [FERRAMENTA_DA_COMUNIDADE] : []), ...FERRAMENTAS, ...(comYoutube ? FERRAMENTAS_DO_YOUTUBE : []), ...(comImagens ? [FERRAMENTA_DE_IMAGENS] : [])];
  const regras = MODOS[modo] || MODOS.normal;
  const total = regras.rodadas;
  let buscasFeitas = 0;
  let leiturasFeitas = 0;
  let pediuLeitura = false;
  const fontes = [];
  const lidas = () => fontes.filter((f) => f.trechos.length && !f.imagem).length;
  // o que o pesquisador observou no caminho ("o G502 X custa R$ 799, acima do orçamento") — vai para a escrita
  fontes.notas = [];
  const porUrl = new Map();
  const anteriores = conversa.filter((m) => m.role === 'user').slice(-3).map((m) => `- ${String(m.content || '').slice(0, 200)}`);
  const historico = [
    {
      role: 'user',
      content: `Pergunta do usuário: ${pergunta}${imagemAnexada ? `\nO usuário anexou uma imagem. O que se vê nela:\n${imagemAnexada.slice(0, 1500)}\nO nome de modelo que não está escrito na imagem é só provável: confirme pela aparência${typeof deps.buscarImagensParaVer === 'function' ? ' com ver_imagens, comparando os candidatos' : ' nas fontes'}.` : ''}${assuntos.length ? `\nDo que ela trata: ${assuntos.join(', ')}` : ''}${anteriores.length ? `\nO que o usuário perguntou antes nesta conversa (para entender a pergunta):\n${anteriores.join('\n')}` : ''}`,
    },
  ];
  let buscou = false;

  const executarBusca = async (buscas, { comunidade = false } = {}) => {
    const lista = (Array.isArray(buscas) ? buscas : [buscas]).map(String).filter(Boolean).slice(0, 3);
    emit('ferramenta', { nome: comunidade ? 'buscar_na_comunidade' : 'buscar_na_web', argumentos: { consulta: lista.join(' · ') }, risco: 'leitura' });
    const achados = (await Promise.all(lista.map((q) => (comunidade ? buscarNaComunidade(q) : buscar(q)).catch(() => [])))).flat();
    for (const q of lista) emit('fonte', { tipo: 'busca', provedor: 'web', consultas: [q], resultados: Math.round(achados.length / lista.length) });
    buscou = true;
    buscasFeitas += lista.length;
    // ordena pelo que a pergunta + as buscas pedem; o pesquisador vê os 8 melhores novos
    const novos = achados.filter((r) => r?.url && !porUrl.has(r.url)).map((r) => ({ ...r, texto: `${r.titulo || ''} ${r.resumo || ''}` }));
    const ordenados = await ordenar(`${pergunta} ${lista.join(' ')}`, novos, { embed, maximo: 8 });
    const mostrados = [];
    for (const r of ordenados) {
      if (porUrl.has(r.url)) continue;
      const f = { n: fontes.length + 1, url: r.url, titulo: r.titulo || '', resumo: r.resumo || '', trechos: [], comunidade };
      fontes.push(f);
      porUrl.set(r.url, f);
      mostrados.push(f);
    }
    return mostrados.length ? listaParaOModelo(mostrados) : 'Nenhum resultado novo para essas buscas.';
  };

  const executarBuscaNoYoutube = async (buscas) => {
    const lista = (Array.isArray(buscas) ? buscas : [buscas]).map(String).filter(Boolean).slice(0, 2);
    emit('ferramenta', { nome: 'buscar_no_youtube', argumentos: { consulta: lista.join(' · ') }, risco: 'leitura' });
    const achados = (await Promise.all(lista.map((q) => deps.buscarNoYoutube(q).catch(() => [])))).flat();
    for (const q of lista) emit('fonte', { tipo: 'busca', provedor: 'youtube', consultas: [q], resultados: Math.round(achados.length / lista.length) });
    buscou = true;
    buscasFeitas += lista.length;
    const mostrados = [];
    for (const v of achados) {
      if (porUrl.has(v.url) || mostrados.length >= 6) continue;
      const minutos = v.duracao ? `${Math.round(v.duracao / 60)} min` : '';
      const vistas = v.visualizacoes ? `${v.visualizacoes.toLocaleString('pt-BR')} visualizações` : '';
      const f = { n: fontes.length + 1, url: v.url, titulo: v.titulo, resumo: [`vídeo de ${v.canal || 'canal desconhecido'}`, minutos, vistas].filter(Boolean).join(' · '), trechos: [], video: true };
      fontes.push(f);
      porUrl.set(v.url, f);
      mostrados.push(f);
    }
    return mostrados.length ? listaParaOModelo(mostrados) : 'Nenhum vídeo novo para essas buscas.';
  };

  // o vídeo vira "página": os trechos da legenda ligados ao foco + os comentários mais curtidos
  const lerVideo = async (f, foco) => {
    let v;
    try {
      v = await deps.verVideo(f.url);
    } catch (err) {
      if (err.mudancaDoYouTube) emit('aviso', { texto: 'O YouTube pode ter mudado e o yt-dlp não conseguiu ler o vídeo: veja se há atualização em Ajustes → Componentes.' });
      return `Não consegui ver o vídeo [${f.n}]: ${String(err.message || err).slice(0, 120)}`;
    }
    emit('fonte', { tipo: 'leitura', provedor: 'youtube', url: f.url });
    if (v.titulo) f.titulo = v.titulo;
    const falado = v.legenda
      ? (await ordenar(`${foco || ''} ${pergunta}`, pedacos(v.legenda).map((texto) => ({ texto })), { embed, maximo: 4 })).filter((m, i) => i === 0 || m.nota >= 0.2).map((m) => `No vídeo (${v.canal}): ${m.texto}`)
      : [`(Vídeo sem legenda: não dá para saber o que é falado nele, só a descrição e os comentários.) Descrição: ${v.descricao.slice(0, 800)}`];
    const comentarios = v.comentarios.slice(0, 6).map((c) => `"${c.texto.slice(0, 300)}"`);
    const trechos = [...falado, ...(comentarios.length ? [`Comentários mais curtidos de quem assistiu: ${comentarios.join(' · ')}`] : [])];
    f.trechos.push(...trechos.filter((t) => !f.trechos.includes(t)));
    return `[${f.n}] ${f.titulo} (vídeo de ${v.canal}${v.legenda ? '' : ', sem legenda'})\n${trechos.join('\n…\n').slice(0, 3000)}`;
  };

  const executarVerImagens = async ({ busca, pergunta: oQue }) => {
    const consulta = String(busca || '').trim();
    if (!consulta) return 'Diga o que buscar nas imagens.';
    emit('ferramenta', { nome: 'ver_imagens', argumentos: { consulta, foco: String(oQue || '') }, risco: 'leitura' });
    let vistas = [];
    try {
      vistas = (await deps.buscarImagensParaVer(consulta)).slice(0, 3);
    } catch {
      vistas = [];
    }
    if (!vistas.length) return `Nenhuma imagem para "${consulta}".`;
    const r = await chamar(
      [{ role: 'user', content: `Estas ${vistas.length} imagens vieram da busca de imagens por "${consulta}" (títulos: ${vistas.map((v) => v.titulo).join(' | ').slice(0, 400)}). Pergunta: ${oQue || pergunta}\nDescreva em português o que as imagens mostram sobre isso. Diga se alguma não parece ser do item buscado. Não invente o que não dá para ver.`, images: vistas.map((v) => v.base64) }],
      { numPredict: 600 }
    );
    const texto = String(r.content || '').trim();
    if (!texto) return 'Não consegui descrever as imagens.';
    // 16/10: o título "EPOS H6PRO … Racing Green" vinha na busca, mas só a descrição voltava ao pesquisador
    const titulos = vistas.map((v, i) => `${i + 1}. ${v.titulo}`).join(' | ');
    const f = { n: fontes.length + 1, url: vistas[0].pagina || vistas[0].url, titulo: `Imagens: ${consulta}`, resumo: '', trechos: [`Imagens de "${consulta}" (títulos: ${titulos}). O que se vê nelas: ${texto}`], imagem: true };
    fontes.push(f);
    emit('fonte', { tipo: 'leitura', provedor: 'imagens', url: f.url });
    return `[${f.n}] ${f.titulo}\nTítulos das imagens: ${titulos}\n${texto.slice(0, 2500)}`;
  };

  const executarLeitura = async ({ fonte, foco }, { garantia = false } = {}) => {
    const f = fontes.find((x) => x.n === Number(fonte));
    if (!f) return `Não existe a fonte [${fonte}] nos resultados.`;
    if (leiturasFeitas >= regras.leituras && !garantia) return `Limite de ${regras.leituras} páginas lidas nesta pesquisa: use o que já tem ou chame pronto.`;
    leiturasFeitas += 1;
    if (f.video && comYoutube) {
      emit('ferramenta', { nome: 'ver_video', argumentos: { url: f.url, foco: String(foco || '') }, risco: 'leitura' });
      return lerVideo(f, foco);
    }
    emit('ferramenta', { nome: 'ler_pagina', argumentos: { url: f.url, foco: String(foco || '') }, risco: 'leitura' });
    let pagina;
    try {
      pagina = await lerPagina(f.url);
    } catch (err) {
      return `Não consegui ler [${f.n}]: ${String(err.message || err).slice(0, 120)}`;
    }
    if (!pagina?.texto) return `A página [${f.n}] não trouxe texto.`;
    emit('fonte', { tipo: 'leitura', provedor: pagina.via || 'web', url: f.url });
    if (pagina.titulo && !f.titulo) f.titulo = pagina.titulo;
    // até 4 trechos, e só os que têm alguma relação com o foco (rodapé e menu ficam de fora)
    const melhores = (await ordenar(`${foco || ''} ${pergunta}`, pedacos(pagina.texto).map((texto) => ({ texto })), { embed, maximo: 4 })).filter((m, i) => i === 0 || m.nota >= 0.2);
    f.trechos.push(...melhores.map((m) => m.texto).filter((t) => !f.trechos.includes(t)));
    return `[${f.n}] ${f.titulo}\n${melhores.map((m) => m.texto).join('\n…\n').slice(0, 3000)}`;
  };

  // o modelo quis parar: falta busca (pede sempre) ou falta leitura (pede uma vez; o resto o código lê no fim)
  const aindaECedo = (rodada) => {
    if (rodada >= total) return null;
    if (buscasFeitas < regras.minBuscas) return `Ainda é cedo para parar: foram ${buscasFeitas} busca(s), o mínimo desta pesquisa é ${regras.minBuscas}. Pesquise ângulos que ainda faltam (${ANGULOS}) e leia as páginas mais promissoras.`;
    if (lidas() < regras.minLeituras && !pediuLeitura) {
      pediuLeitura = true;
      const sugestoes = fontes.filter((f) => !f.trechos.length).slice(0, 6).map((f) => `[${f.n}]`).join(' ');
      return `Ainda é cedo para parar: você leu ${lidas()} página(s), o mínimo desta pesquisa é ${regras.minLeituras}. O resumo do buscador não basta — leia com ler_pagina as fontes mais promissoras${sugestoes ? ` (ex.: ${sugestoes})` : ''}, de sites diferentes.`;
    }
    return null;
  };

  for (let rodada = 1; rodada <= total; rodada += 1) {
    if (signal?.aborted) break;
    emit('iteracao', { n: rodada, de: total });
    const r = await chamar([{ role: 'system', content: sistemaDoPesquisador({ hoje, rodada, total, produto: comComunidade, modo, youtube: comYoutube, verImagens: comImagens }) }, ...historico], { tools: ferramentas });
    const chamadas = (r.chamadas || []).map((c) => ({ nome: c.function?.name, args: typeof c.function?.arguments === 'string' ? safeJson(c.function.arguments) : c.function?.arguments || {} }));
    if (r.content?.trim()) {
      emit('raciocinio', { n: rodada, pensamento: r.content.trim().slice(0, 400) });
      fontes.notas.push(r.content.trim().slice(0, 1200));
    }
    // sem ferramenta: o modelo respondeu em texto; se nem buscou ainda, busca a pergunta (Open WebUI)
    if (!chamadas.length || chamadas.every((c) => c.nome === 'pronto')) {
      if (!buscou) {
        historico.push({ role: 'user', content: `Resultados da busca pela própria pergunta:
${await executarBusca([pergunta])}

Continue a pesquisa com as ferramentas, ou chame pronto.` });
        continue;
      }
      // quis parar antes do mínimo do modo: o código pede mais ângulos (Perplexica, modo qualidade)
      const falta = aindaECedo(rodada);
      if (falta) {
        historico.push({ role: 'user', content: falta });
        continue;
      }
      break;
    }
    historico.push({ role: 'assistant', content: r.content || '', tool_calls: r.chamadas });
    for (const c of chamadas) {
      let saida;
      if (c.nome === 'buscar_na_web') saida = await executarBusca(c.args.buscas || c.args.consultas || c.args.query || []);
      else if (c.nome === 'buscar_na_comunidade' && comComunidade) saida = await executarBusca(c.args.buscas || c.args.consultas || c.args.query || [], { comunidade: true });
      else if (c.nome === 'ler_pagina' || c.nome === 'ver_video') saida = await executarLeitura(c.args);
      else if (c.nome === 'ver_imagens' && comImagens) saida = await executarVerImagens(c.args);
      else if (c.nome === 'buscar_no_youtube' && comYoutube) saida = await executarBuscaNoYoutube(c.args.buscas || c.args.consultas || c.args.query || []);
      else if (c.nome === 'pronto') saida = 'ok';
      else saida = `Ferramenta desconhecida: ${c.nome}`;
      historico.push({ role: 'tool', tool_name: c.nome, content: saida });
    }
    if (chamadas.some((c) => c.nome === 'pronto')) {
      const falta = aindaECedo(rodada);
      if (falta) {
        historico.push({ role: 'user', content: falta });
        continue;
      }
      break;
    }
  }
  // a fonte fala de algum assunto da pergunta? (16/10: o fórum devolveu "Adata é uma marca confiável?
  // Esse SSD vale a pena?" para o Dunu Titan S, a garantia leu, e a resposta comentou o tópico de SSD)
  const citaAssunto = (f) => !assuntos.length || assuntos.some((a) => tituloCita(`${f.titulo} ${f.resumo}`, a));
  // garantia: pedido de produto sem a comunidade lida — o código busca e lê 2 tópicos antes da escrita
  if (comComunidade && !signal?.aborted) {
    if (!fontes.some((f) => f.comunidade)) await executarBusca([pergunta], { comunidade: true });
    const lidos = fontes.filter((f) => f.comunidade && f.trechos.length).length;
    for (const f of fontes.filter((x) => x.comunidade && !x.trechos.length && citaAssunto(x)).slice(0, Math.max(0, regras.comunidade - lidos))) {
      await executarLeitura({ fonte: f.n, foco: 'o que quem usa recomenda, elogia e critica' }, { garantia: true });
    }
  }
  // garantia de leitura: o código lê as fontes mais ligadas à pergunta, um site por vez, até o mínimo
  // (página que não abre não conta; no máximo o dobro das que faltam, para não travar em site fora do ar)
  if (lidas() < regras.minLeituras && !signal?.aborted) {
    const faltam = regras.minLeituras - lidas();
    const naoLidas = fontes.filter((f) => !f.trechos.length).map((f) => ({ f, texto: `${f.titulo} ${f.resumo}` }));
    const ordenadas = (await ordenar(pergunta, naoLidas, { embed })).map((x) => x.f);
    const ordem = [...ordenadas.filter(citaAssunto), ...ordenadas.filter((f) => !citaAssunto(f))];
    const sites = new Set(fontes.filter((f) => f.trechos.length).map((f) => dominio(f.url)));
    const primeiroDeCadaSite = ordem.filter((f) => !sites.has(dominio(f.url)) && sites.add(dominio(f.url)));
    const candidatas = [...new Set([...primeiroDeCadaSite, ...ordem])].slice(0, faltam * 2);
    let i = 0;
    while (i < candidatas.length && lidas() < regras.minLeituras && !signal?.aborted) {
      const lote = candidatas.slice(i, i + regras.minLeituras - lidas());
      i += lote.length;
      await Promise.all(lote.map((f) => executarLeitura({ fonte: f.n, foco: pergunta }, { garantia: true })));
    }
  }
  return fontes;
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

/* ------------------------------ 3–4. selecionar e escrever ------------------------------ */

/** O material de cada fonte para a escrita: os trechos lidos, ou o resumo do buscador. Até ~`limite` caracteres no total, as mais relevantes primeiro. */
async function materialDaEscrita(pergunta, fontes, { embed, limite = 14000 } = {}) {
  const itens = fontes.map((f) => ({ f, texto: f.trechos.length ? f.trechos.join('\n…\n') : f.resumo })).filter((x) => String(x.texto || '').trim());
  const ordenados = await ordenar(pergunta, itens, { embed });
  const usados = [];
  let total = 0;
  for (const it of ordenados) {
    const texto = String(it.texto).slice(0, 3500);
    if (total + texto.length > limite && usados.length >= 4) break;
    usados.push({ ...it.f, conteudo: texto });
    total += texto.length;
  }
  return usados.sort((a, b) => a.n - b.n);
}

// ajuste "Resposta" da barra (15/10: antes ignorado pelo núcleo)
const TAMANHO_DA_RESPOSTA = {
  normal: '',
  detalhada: '\n- RESPOSTA DETALHADA: escreva uma resposta longa e completa, como um relatório (pelo menos 1.200 palavras), cobrindo todos os ângulos que as fontes trazem.',
  tecnica: '\n- RESPOSTA TÉCNICA: use a linguagem e os dados técnicos precisos (números, unidades, especificações), sem simplificar demais; só explique siglas.',
  curta: '\n- RESPOSTA CURTA: no máximo 3 parágrafos, só o essencial.',
};

function sistemaDoEscritor({ hoje, comFontes, produto = false, tamanho = 'normal' }) {
  return `Você é o AuGPT, um assistente que pesquisa na web e escreve respostas completas, claras e bem explicadas, em português do Brasil. Hoje é ${hoje}.${TAMANHO_DA_RESPOSTA[tamanho] || ''}

${
  comFontes
    ? `Responda à pergunta do usuário usando as fontes abaixo.
- Respeite exatamente as condições do pedido (plataforma, tipo de produto, orçamento, quantidade de opções). Fonte que trata de outra coisa (outra plataforma, outro tipo de produto) não serve de base para a recomendação.
- Comece respondendo diretamente à pergunta. Depois desenvolva, com seções (##) quando o assunto pedir.
- Explique os termos técnicos para quem não é especialista.
- Cite a fonte de cada informação com [n] no fim da frase. Não cite número que não está nas fontes.
- Cruze as fontes: quando várias falam do mesmo ponto, cite todas ([2][5]); não apoie a resposta inteira numa fonte só. Um vídeo é uma fonte como as outras — o que é dito nele é a opinião de quem fez o review.
- Use tabela quando comparar opções ou listar especificações.
- Quando a pergunta pede escolha, recomendação ou avaliação, diga com clareza o que você recomenda e por quê, com base nas fontes. Nada de conclusão genérica.
- Diga o que as fontes não responderam, em vez de inventar.
- Se a pergunta continua a conversa, responda só ao que foi pedido agora e traga o que é novo; não repita a resposta anterior (o usuário já leu).
- Preço: use o que as fontes trazem, na moeda delas. Não converta moeda nem estime preço em real que as fontes não dão.
- As anotações do pesquisador (se houver) mostram o que ele já conferiu, como preço atual. Quando uma anotação e uma fonte discordarem, prefira o dado mais recente e diga a diferença.${produto ? FORMATO_DE_PRODUTO : ''}`
    : '- Responda direto e bem explicado. Se não tiver certeza de algum dado, diga.'
}`;
}

// 15/10 (pedido do Davi): resposta de produto em cartões — o renderer desenha
// cada "#### N. Nome" como cartão, e o código põe a foto do produto nele
const FORMATO_DE_PRODUTO = `

FORMATO (pedido de produto):
- Comece com a resposta direta: qual você recomenda e por quê, em 2 ou 3 frases.
- Depois, um bloco por opção, cada um começando com um título exatamente assim: "#### 1. Marca Modelo" (um produto só também leva "#### 1."). Em cada bloco, nesta ordem:
  **Faixa de preço:** o preço que as fontes trazem (diga de onde, e se é em dólar).
  **Pontos fortes:** explicado com as suas palavras.
  **Pontos fracos:** o que as fontes e quem usa criticam (se ninguém criticou, diga isso).
  **Na comunidade:** o que quem usa no Reddit e nos fóruns relata, resumido com as suas palavras, citando a fonte. Não cole o comentário.
  **Para quem:** para quem essa opção faz mais sentido.
- Se forem 2 ou mais opções, termine com "### Comparação" (uma tabela) e "### Qual escolher".`;

const blocoDeFontes = (usadas) => usadas.map((f) => `<fonte n="${f.n}" titulo="${String(f.titulo || dominio(f.url)).replace(/"/g, "'")}" site="${dominio(f.url)}">\n${f.conteudo}\n</fonte>`).join('\n');

/**
 * Conferência de anos (15/10, medição: Santos Dumont "1873–1933" com a fonte
 * dizendo 1932; SR-71 com o ano do 1º voo trocado). Ano que a resposta cita e
 * que não aparece em nenhuma fonte lida, nas anotações nem na pergunta ganha
 * um "⚠" e entra no aviso do fim — a resposta não é reescrita. Só anos: são o
 * número que o modelo mais troca, e o que menos varia de formato entre fontes.
 * ponytail: número com unidade (km/h, R$) fica de fora — muda de formato e
 * conversão entre fontes; entra quando a medição mostrar erro nele.
 */
function conferirAnos(texto, { material = '', pergunta = '', hoje = '' } = {}) {
  const permitidos = new Set(`${material} ${pergunta} ${hoje}`.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []);
  const faltam = new Set();
  // não é ano: resolução ("1440p", "2560x1440", "1080i") — 15/10, a RTX ganhava "1440 ⚠p"
  const marcado = String(texto || '').replace(/(^|[^\d/.\-x×])(1[0-9]{3}|20[0-9]{2})(?![\dpPi×x])/g, (m, antes, ano) => {
    if (permitidos.has(ano)) return m;
    faltam.add(ano);
    return `${antes}${ano} ⚠`;
  });
  if (!faltam.size) return { texto: marcado, faltam: [] };
  const lista = [...faltam].sort();
  return { texto: `${marcado}\n\n*⚠ ${lista.length === 1 ? 'Este ano não aparece' : 'Estes anos não aparecem'} nas fontes lidas: ${lista.join(', ')}. Vale conferir.*`, faltam: lista };
}

/**
 * A resposta inteira. `deps.escrever(messages, onToken) → texto` escreve em
 * streaming; os outros deps são os da pesquisa.
 * @returns {{ texto, fontes: Array<{n, url, titulo}>, entendimento, buscou }}
 */
/* ------------------------------ 0. ver a imagem anexada (Fase 4) ------------------------------ */

/**
 * O que o modelo vê na(s) imagem(ns) anexada(s), em função da pergunta. Vira
 * contexto do entendimento (o "que fone é esse?" passa a ter nome) e material
 * da escrita. O texto do OCR (Tesseract), quando há, entra como apoio.
 */
function pedidoDeVisao({ pergunta, imagens }) {
  const ocr = imagens.filter((i) => i.texto).map((i) => `--- ${i.nome} ---\n${i.texto.slice(0, 4000)}`).join('\n\n');
  return `O usuário anexou ${imagens.length === 1 ? 'uma imagem' : `${imagens.length} imagens`} e escreveu: "${String(pergunta).slice(0, 1500)}"

Descreva em português o que importa na imagem para responder, e copie os textos que dá para ler. Depois, numa linha começando com "Identificação:", diga marca e modelo (ou quem/o que é) e a certeza: certo, provável ou não dá para saber. Não invente nome que não está escrito.${ocr ? `\n\nTexto lido por OCR (pode ter erros de leitura; use para conferir o que você lê):\n${ocr}` : ''}`;
}

// imagem em markdown (![…](augpt-img://…)) é o app que põe; a escrita não copia nem inventa
// (16/10: a resposta de seguimento copiou a foto da anterior e o cartão saiu com duas)
const semImagens = (texto) => String(texto || '').replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*(\r?\n|$)/gm, '');

async function responder({ pergunta, conversa = [], modo = 'automatico', tamanho = 'normal', deps, hoje = new Date().toLocaleDateString('pt-BR'), imagens = [] }) {
  const { chamar, escrever, embed, emit = () => {} } = deps;
  // imagem anexada (Fase 4): o modelo olha primeiro, e o que viu vai para o entendimento e a escrita
  let vista = '';
  if (imagens.length) {
    emit('ferramenta', { nome: 'ver_imagem', argumentos: { arquivos: imagens.map((i) => i.nome).join(', ') }, risco: 'leitura' });
    vista = String((await chamar([{ role: 'user', content: pedidoDeVisao({ pergunta, imagens }), images: imagens.map((i) => i.base64) }], { numPredict: 900 })).content || '').trim();
    emit('imagem-vista', { texto: vista });
  }
  const perguntaComImagem = vista ? `${pergunta}\n\n[Imagem anexada pelo usuário — o que se vê nela: ${vista.slice(0, 1500)}]` : pergunta;
  const ent = lerEntendimento((await chamar([{ role: 'user', content: pedidoDeEntendimento({ pergunta: perguntaComImagem, conversa, hoje }) }], { json: true, numPredict: 300 })).content, pergunta, { comImagem: imagens.length > 0 });
  // automático (15/10): produto vai para a pesquisa profunda, o resto para a normal
  const modoUsado = MODOS[modo] ? modo : ent.produto ? 'profundo' : 'normal';
  emit('nucleo-entendimento', { ...ent, modo: modoUsado });
  const fontes = ent.precisaBuscar ? await pesquisar({ pergunta: ent.pergunta, modo: modoUsado, deps, hoje, produto: ent.produto, assuntos: ent.assuntos || [], conversa, imagemAnexada: vista }) : [];
  const notas = (fontes.notas || []).join('\n\n').slice(-4000);
  const usadas = fontes.length ? await materialDaEscrita(ent.pergunta, fontes, { embed }) : [];
  // 16/10: sem o yt-dlp, "pesquise vídeos no youtube" saiu como "realizei uma pesquisa no YouTube" — não houve
  const semVideos = /\b(youtube|v[ií]deos?)\b/i.test(pergunta) && !(typeof deps.buscarNoYoutube === 'function');
  emit('redigindo', { fontes: usadas.length });
  const mensagens = [
    { role: 'system', content: `${sistemaDoEscritor({ hoje, comFontes: usadas.length > 0, produto: ent.produto, tamanho })}${semVideos ? '\n- O usuário pediu vídeos do YouTube, mas o AuGPT ainda não tem como ver vídeos (falta instalar o yt-dlp em Ajustes → Componentes). Diga isso numa frase no começo e NÃO diga que pesquisou, viu ou assistiu a vídeos: as fontes são páginas da web.' : ''}${usadas.length ? `\n\n<fontes>\n${blocoDeFontes(usadas)}\n</fontes>` : ''}${notas ? `\n\n<anotacoes_do_pesquisador>\n${notas}\n</anotacoes_do_pesquisador>` : ''}${vista ? `\n\n<imagem_anexada>\nO usuário anexou ${imagens.length === 1 ? 'uma imagem (está junto da pergunta)' : `${imagens.length} imagens (estão junto da pergunta)`}. O que foi visto nela${imagens.length === 1 ? '' : 's'}:\n${vista}${imagens.some((i) => i.texto) ? `\n\nTexto lido por OCR:\n${imagens.filter((i) => i.texto).map((i) => i.texto.slice(0, 4000)).join('\n\n')}` : ''}\n</imagem_anexada>\nResponda sobre a imagem que o usuário mandou. O que vem dela você diz "na imagem", sem citação. O modelo exato de um produto só é certo se estiver escrito na imagem (no texto do OCR) ou se as fontes confirmarem pela aparência; senão, diga que é provável e qual parece ser.` : ''}` },
    ...conversa.slice(-6).map((m) => ({ role: m.role, content: semImagens(m.content).slice(0, 2000) })),
    // o lembrete do formato vai junto da pergunta, que é o que o modelo lê por último
    // (15/10: com o formato só no fim do prompt longo, depois das fontes, o mouse saiu sem cartões)
    { role: 'user', ...(imagens.length ? { images: imagens.map((i) => i.base64) } : {}), content: ent.produto && usadas.length ? `${pergunta}\n\n(Responda no formato de pedido de produto: um bloco "#### N. Marca Modelo" por opção, com **Faixa de preço:**, **Pontos fortes:**, **Pontos fracos:**, **Na comunidade:** citando a fonte, e **Para quem:**.)` : pergunta },
  ];
  const escrito = semImagens(await escrever(mensagens, (pedaco) => emit('resposta-token', { pedaco }))).replace(/\s*\[(imagem_anexada|imagem anexada)\]/gi, '');
  // só ficam na lista as fontes que a resposta citou (ou todas as usadas, se ela não citou nenhuma)
  const citadas = new Set([...String(escrito).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const lista = usadas.filter((f) => !citadas.size || citadas.has(f.n)).map(({ n, url, titulo, video, trechos }) => ({ n, url, titulo, ...(video ? { video: true, lido: trechos.length > 0 } : {}) }));
  // com pesquisa, os anos citados são conferidos contra tudo que foi lido (trechos, resumos e anotações)
  const material = fontes.length ? `${fontes.map((f) => `${f.titulo} ${f.resumo} ${f.trechos.join(' ')}`).join(' ')} ${notas} ${vista}` : '';
  const conferido = fontes.length ? conferirAnos(String(escrito || '').trim(), { material, pergunta, hoje }) : { texto: String(escrito || '').trim(), faltam: [] };
  if (conferido.faltam.length) emit('aviso', { texto: `conferência: ano(s) sem fonte na resposta: ${conferido.faltam.join(', ')}` });
  if (semVideos) emit('aviso', { texto: 'Para o AuGPT ver vídeos do YouTube, instale o yt-dlp em Ajustes → Componentes.' });
  // identificação só pela aparência: a resposta avisa, pelo código (16/10: a foto de um EPOS H6PRO
  // virou "o fone na imagem é o EPOS H3 Pro Hybrid", um irmão quase igual, dito como certo)
  // A certeza que o modelo declara não vale (ele disse "certo" para o modelo errado): produto
  // reconhecido por foto leva o aviso, a menos que o OCR leia o nome dele na imagem.
  const identificacao = (/^.*identifica[çc][ãa]o:.*$/im.exec(vista) || [''])[0];
  const ocrConfirma = imagens.some((i) => i.texto && (ent.assuntos || []).some((a) => tituloCita(i.texto, a)));
  const pelaAparencia = imagens.length > 0 && !ocrConfirma && (ent.produto || /prov[áa]vel|provavelmente|n[ãa]o d[áa] para saber|n[ãa]o identificado/i.test(identificacao));
  const texto = pelaAparencia ? `*Pela foto, o modelo foi reconhecido pela aparência — o nome dele não está escrito na imagem, então pode ser outro parecido da mesma linha.*\n\n${conferido.texto}` : conferido.texto;
  return { vista, texto, fontes: lista, entendimento: ent, buscou: fontes.length > 0, produto: ent.produto, assuntos: ent.assuntos || [], modo: modoUsado, anosSemFonte: conferido.faltam };
}

module.exports = { MODOS, podeFicarSemBusca, pedidoDeVisao, responder, pesquisar, materialDaEscrita, conferirAnos, pedidoDeEntendimento, lerEntendimento, sistemaDoPesquisador, sistemaDoEscritor, FERRAMENTAS, FERRAMENTAS_DO_YOUTUBE, RODADAS };
