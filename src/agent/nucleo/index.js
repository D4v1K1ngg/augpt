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

const RODADAS = { rapido: 2, normal: 6, profundo: 12 };
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
{"precisa_buscar": true ou false, "produto": true ou false, "pergunta": "a última mensagem reescrita para fazer sentido sozinha, sem depender da conversa"}

- "produto" é true quando o usuário quer escolher, comparar, avaliar ou conhecer produtos ou itens para comprar ou usar (fone, mouse, celular, geladeira, carro, um modelo específico…). Para explicação, notícia, pessoa, história ou como algo funciona, false.

- "precisa_buscar" é true para qualquer pedido de informação: produto, preço, recomendação, comparação, notícia, pessoa, lugar, história, ciência, como algo funciona, dado ou número. Seu conhecimento pode estar desatualizado, então mesmo o que você sabe vale conferir.
- "precisa_buscar" é false SÓ para: saudação ou agradecimento, conta de matemática, tradução ou revisão de um texto que o usuário mandou, escrever um texto criativo, ou algo que a própria conversa já respondeu. Na dúvida, true.
- Em "pergunta", troque "ele", "isso", "o outro" pelo que eles são na conversa, e mantenha o resto como o usuário escreveu.`;
}

function lerEntendimento(texto, pergunta) {
  try {
    const j = JSON.parse(String(texto).slice(String(texto).indexOf('{'), String(texto).lastIndexOf('}') + 1));
    return { precisaBuscar: j.precisa_buscar !== false, produto: j.produto === true, pergunta: String(j.pergunta || '').trim() || pergunta };
  } catch {
    return { precisaBuscar: true, produto: false, pergunta }; // JSON quebrado: busca, com a pergunta como veio
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

function sistemaDoPesquisador({ hoje, rodada, total, produto = false }) {
  return `Você é o pesquisador do AuGPT. Hoje é ${hoje}. Seu trabalho é juntar, com as ferramentas, a informação para responder muito bem à pergunta do usuário. Você não escreve a resposta: quando tiver o suficiente, chame "pronto".

- Seu conhecimento pode estar desatualizado: pesquise mesmo o que parece básico.
- Mantenha nas buscas as condições que o pedido deu: plataforma (PC, celular, console), tipo de produto (intra-auricular, sem fio…), orçamento, país.
- Em buscar_na_web, mande até 3 buscas curtas por vez, de ângulos diferentes. Para tecnologia e produtos, inclua buscas em inglês, onde há mais material.
- Quando a pergunta pede opinião, experiência de uso ou recomendação, inclua buscas que tragam quem usa (por exemplo com "reddit" ou "fórum").
- Use ler_pagina nas páginas mais promissoras quando o resumo não basta, sempre com um foco.
- Comece amplo e aprofunde no que os resultados mostrarem. Se 2 ou 3 buscas não acham algo, provavelmente não existe: siga em frente.
${produto ? '- Este pedido é sobre produtos: use buscar_na_comunidade pelo menos uma vez e leia com ler_pagina pelo menos 2 tópicos da comunidade, para saber o que quem usa recomenda, elogia e critica. Busque também preço atual e especificações.\n' : ''}- Esta é a rodada ${rodada} de ${total}.`;
}

/** Os resultados como o pesquisador vê: "[n] título (domínio)\nresumo". */
const listaParaOModelo = (fontes) => fontes.map((f) => `[${f.n}] ${f.titulo || dominio(f.url)} (${dominio(f.url)}${f.comunidade ? ', comunidade' : ''})\n${String(f.resumo || '').slice(0, 300)}`).join('\n\n');

/**
 * O laço do pesquisador. Devolve as fontes juntadas (numeradas, com resumo e,
 * quando lidas, os trechos escolhidos da página).
 */
async function pesquisar({ pergunta, modo = 'normal', deps, hoje, produto = false }) {
  const { chamar, buscar, lerPagina, embed, emit = () => {}, signal, buscarNaComunidade } = deps;
  // comunidade (15/10, pedido do Davi): em pedido de produto, Reddit e fóruns entram sempre
  const comComunidade = produto && typeof buscarNaComunidade === 'function';
  const ferramentas = comComunidade ? [FERRAMENTA_DA_COMUNIDADE, ...FERRAMENTAS] : FERRAMENTAS;
  const total = RODADAS[modo] || RODADAS.normal;
  const fontes = [];
  // o que o pesquisador observou no caminho ("o G502 X custa R$ 799, acima do orçamento") — vai para a escrita
  fontes.notas = [];
  const porUrl = new Map();
  const historico = [{ role: 'user', content: `Pergunta do usuário: ${pergunta}` }];
  let buscou = false;

  const executarBusca = async (buscas, { comunidade = false } = {}) => {
    const lista = (Array.isArray(buscas) ? buscas : [buscas]).map(String).filter(Boolean).slice(0, 3);
    emit('ferramenta', { nome: comunidade ? 'buscar_na_comunidade' : 'buscar_na_web', argumentos: { consulta: lista.join(' · ') }, risco: 'leitura' });
    const achados = (await Promise.all(lista.map((q) => (comunidade ? buscarNaComunidade(q) : buscar(q)).catch(() => [])))).flat();
    for (const q of lista) emit('fonte', { tipo: 'busca', provedor: 'web', consultas: [q] });
    buscou = true;
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

  const executarLeitura = async ({ fonte, foco }) => {
    const f = fontes.find((x) => x.n === Number(fonte));
    if (!f) return `Não existe a fonte [${fonte}] nos resultados.`;
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

  for (let rodada = 1; rodada <= total; rodada += 1) {
    if (signal?.aborted) break;
    emit('iteracao', { n: rodada, de: total });
    const r = await chamar([{ role: 'system', content: sistemaDoPesquisador({ hoje, rodada, total, produto: comComunidade }) }, ...historico], { tools: ferramentas });
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
      break;
    }
    historico.push({ role: 'assistant', content: r.content || '', tool_calls: r.chamadas });
    for (const c of chamadas) {
      let saida;
      if (c.nome === 'buscar_na_web') saida = await executarBusca(c.args.buscas || c.args.consultas || c.args.query || []);
      else if (c.nome === 'buscar_na_comunidade' && comComunidade) saida = await executarBusca(c.args.buscas || c.args.consultas || c.args.query || [], { comunidade: true });
      else if (c.nome === 'ler_pagina') saida = await executarLeitura(c.args);
      else if (c.nome === 'pronto') saida = 'ok';
      else saida = `Ferramenta desconhecida: ${c.nome}`;
      historico.push({ role: 'tool', tool_name: c.nome, content: saida });
    }
    if (chamadas.some((c) => c.nome === 'pronto')) break;
  }
  // garantia: pedido de produto sem a comunidade lida — o código busca e lê 2 tópicos antes da escrita
  if (comComunidade && !signal?.aborted) {
    if (!fontes.some((f) => f.comunidade)) await executarBusca([pergunta], { comunidade: true });
    const lidos = fontes.filter((f) => f.comunidade && f.trechos.length).length;
    for (const f of fontes.filter((x) => x.comunidade && !x.trechos.length).slice(0, Math.max(0, 2 - lidos))) {
      await executarLeitura({ fonte: f.n, foco: 'o que quem usa recomenda, elogia e critica' });
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

function sistemaDoEscritor({ hoje, comFontes, produto = false }) {
  return `Você é o AuGPT, um assistente que pesquisa na web e escreve respostas completas, claras e bem explicadas, em português do Brasil. Hoje é ${hoje}.

${
  comFontes
    ? `Responda à pergunta do usuário usando as fontes abaixo.
- Respeite exatamente as condições do pedido (plataforma, tipo de produto, orçamento, quantidade de opções). Fonte que trata de outra coisa (outra plataforma, outro tipo de produto) não serve de base para a recomendação.
- Comece respondendo diretamente à pergunta. Depois desenvolva, com seções (##) quando o assunto pedir.
- Explique os termos técnicos para quem não é especialista.
- Cite a fonte de cada informação com [n] no fim da frase. Não cite número que não está nas fontes.
- Use tabela quando comparar opções ou listar especificações.
- Quando a pergunta pede escolha, recomendação ou avaliação, diga com clareza o que você recomenda e por quê, com base nas fontes. Nada de conclusão genérica.
- Diga o que as fontes não responderam, em vez de inventar.
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
  const marcado = String(texto || '').replace(/(^|[^\d/.\-])(1[0-9]{3}|20[0-9]{2})(?![\d])/g, (m, antes, ano) => {
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
async function responder({ pergunta, conversa = [], modo = 'normal', deps, hoje = new Date().toLocaleDateString('pt-BR') }) {
  const { chamar, escrever, embed, emit = () => {} } = deps;
  const ent = lerEntendimento((await chamar([{ role: 'user', content: pedidoDeEntendimento({ pergunta, conversa, hoje }) }], { json: true, numPredict: 300 })).content, pergunta);
  emit('nucleo-entendimento', ent);
  const fontes = ent.precisaBuscar ? await pesquisar({ pergunta: ent.pergunta, modo, deps, hoje, produto: ent.produto }) : [];
  const notas = (fontes.notas || []).join('\n\n').slice(-4000);
  const usadas = fontes.length ? await materialDaEscrita(ent.pergunta, fontes, { embed }) : [];
  emit('redigindo', { fontes: usadas.length });
  const mensagens = [
    { role: 'system', content: `${sistemaDoEscritor({ hoje, comFontes: usadas.length > 0, produto: ent.produto })}${usadas.length ? `\n\n<fontes>\n${blocoDeFontes(usadas)}\n</fontes>` : ''}${notas ? `\n\n<anotacoes_do_pesquisador>\n${notas}\n</anotacoes_do_pesquisador>` : ''}` },
    ...conversa.slice(-6).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 2000) })),
    { role: 'user', content: pergunta },
  ];
  const escrito = await escrever(mensagens, (pedaco) => emit('resposta-token', { pedaco }));
  // só ficam na lista as fontes que a resposta citou (ou todas as usadas, se ela não citou nenhuma)
  const citadas = new Set([...String(escrito).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const lista = usadas.filter((f) => !citadas.size || citadas.has(f.n)).map(({ n, url, titulo }) => ({ n, url, titulo }));
  // com pesquisa, os anos citados são conferidos contra tudo que foi lido (trechos, resumos e anotações)
  const material = fontes.length ? `${fontes.map((f) => `${f.titulo} ${f.resumo} ${f.trechos.join(' ')}`).join(' ')} ${notas}` : '';
  const conferido = fontes.length ? conferirAnos(String(escrito || '').trim(), { material, pergunta, hoje }) : { texto: String(escrito || '').trim(), faltam: [] };
  if (conferido.faltam.length) emit('aviso', { texto: `conferência: ano(s) sem fonte na resposta: ${conferido.faltam.join(', ')}` });
  return { texto: conferido.texto, fontes: lista, entendimento: ent, buscou: fontes.length > 0, produto: ent.produto, anosSemFonte: conferido.faltam };
}

module.exports = { responder, pesquisar, materialDaEscrita, conferirAnos, pedidoDeEntendimento, lerEntendimento, sistemaDoPesquisador, sistemaDoEscritor, FERRAMENTAS, RODADAS };
