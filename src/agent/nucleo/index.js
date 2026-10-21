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
const { qualidadeDoDominio } = require('../../tools/search');

/*
 * Credibilidade no núcleo (19/10, revisão da pesquisa): a tabela de 742 domínios (portais de
 * notícia falsa do corpus Fake.br/USP, sátira, bloqueados) e o peso por tipo de site (órgão
 * oficial > universidade > imprensa > blog, rede social) só valiam no caminho antigo; o núcleo
 * escolhia o que ler só pela semelhança com a pergunta. Agora a relevância continua mandando, a
 * qualidade do site desempata e soma, notícia falsa e domínio bloqueado não entram, e um site só
 * ocupa 2 lugares da lista. Na busca da comunidade, fórum e rede social não perdem ponto: ali
 * eles são o que se procura.
 */
const RISCO_FORA = new Set(['alto', 'bloqueado']);
const PRAZO_DA_PAGINA_MS = 8000;
function comCredibilidade(ordenados, { comunidade = false, maximo = 8, porSite = 2, jaVistos = [] } = {}) {
  const contagem = new Map();
  for (const f of jaVistos) contagem.set(dominio(f.url), (contagem.get(dominio(f.url)) || 0) + 1);
  return ordenados
    .map((r) => {
      const q = qualidadeDoDominio(r.url);
      const peso = comunidade && /fórum|rede social|blog/.test(q.tipo) ? 3 : q.peso;
      return { ...r, qualidade: q.tipo, alerta: q.alerta || null, notaFinal: (r.nota || 0) + (peso - 3) * 0.03 };
    })
    .filter((r) => !RISCO_FORA.has(r.alerta?.risco))
    .sort((a, b) => b.notaFinal - a.notaFinal)
    .filter((r) => {
      const d = dominio(r.url);
      const n = contagem.get(d) || 0;
      if (n >= porSite) return false;
      contagem.set(d, n + 1);
      return true;
    })
    .slice(0, maximo);
}
const { tituloCita } = require('../../tools/imagens');
const { separarGraficos, recolocarGraficos, graficoDoTexto, pedeGrafico, INSTRUCAO_DE_GRAFICO, INSTRUCAO_DE_VISUAL } = require('./graficos');
const capacidades = require('../capacidades');

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
{"precisa_buscar": true ou false, "produto": true ou false, "criar_imagem": true ou false, "muda_com_o_tempo": true ou false, "sobre_o_usuario": true ou false, "imagem_ajuda": true ou false, "acao": "", "sugerir": "", "assuntos": ["..."], "pergunta": "a última mensagem reescrita para fazer sentido sozinha, sem depender da conversa"}

- O AuGPT roda no computador do usuário e EXECUTA estas ações:
${capacidades.listaParaEntender()}
- "acao": o nome de uma dessas ações quando o usuário pede que o AuGPT a faça agora, mesmo como pergunta ("você consegue ver como está a minha internet?", "mede meu ping no PUBG", "o que está usando minha rede?"). Senão, "".
- "sugerir": quando o usuário NÃO pediu a ação, mas ela ajudaria muito no que ele quer (ex.: "como melhorar minha internet para jogar?" → "teste_de_rede"), o nome dela. Senão, "".

- "muda_com_o_tempo" é true quando a resposta certa hoje pode ser diferente da de alguns meses atrás: notícia, resultado, placar, eleição, cotação, preço, previsão, lançamento, versão mais nova, quem ocupa um cargo, situação atual de algo. Fato histórico, definição, ciência e como algo funciona: false.
- "sobre_o_usuario" é true quando a resposta depende de algo do próprio usuário: o computador, o celular, o carro, a cidade, o curso, a rotina ou o que ele já tem ("meu PC", "no meu celular", "pra minha cidade").
- "imagem_ajuda" é true quando ver uma foto ajuda a entender a resposta (um produto, um lugar, um animal, um objeto, uma pessoa conhecida, uma obra). Notícia, política, conta, conceito, passo a passo e pedido sobre um site: false.

- "criar_imagem" é true quando o usuário pede para CRIAR, gerar, desenhar, ilustrar ou editar uma imagem (logo, desenho, foto artística, transformar a foto anexada). Pedir para MOSTRAR ou achar uma foto que já existe ("mostre uma foto da Torre Eiffel") é false.

- "assuntos": de 0 a 4 coisas concretas de que a pergunta trata e que têm uma imagem — pessoa, lugar, produto ou modelo, objeto, animal, obra, veículo — com o nome completo e já resolvido pela conversa (com o nome que o usuário usou). Ideia abstrata, conta ou assunto genérico ("inflação", "como funciona") não entra; país, cidade ou empresa citados só como contexto ("no Brasil", "da Nvidia") também não.

- "produto" é true quando o usuário quer escolher, comparar, avaliar ou conhecer produtos ou itens para comprar ou usar (fone, mouse, celular, geladeira, carro, um modelo específico…). Para explicação, notícia, pessoa, história ou como algo funciona, false.

- "precisa_buscar" é true para qualquer pedido de informação: produto, preço, recomendação, comparação, notícia, pessoa, lugar, história, ciência, como algo funciona, dado ou número. Seu conhecimento pode estar desatualizado, então mesmo o que você sabe vale conferir.
- "precisa_buscar" é false SÓ para: saudação ou agradecimento, conta de matemática, tradução ou revisão de um texto que o usuário mandou, escrever um texto criativo, ou algo que a própria conversa já respondeu. Na dúvida, true.
- Em "pergunta", troque "ele", "isso", "o outro" pelo que eles são na conversa e traga o que a conversa já disse: por exemplo, depois de "qual o melhor <tipo de produto> para <uso>?", a mensagem "e quanto ao <modelo>?" vira "o <modelo> é bom como <tipo de produto> para <uso>, e quanto custa?" (use os nomes reais da conversa, nunca os deste exemplo). Mantenha o resto como o usuário escreveu.`;
}

// o que pode ficar sem pesquisa: saudação, agradecimento, conta, tradução/revisão de texto, texto criativo
const SEM_BUSCA = /^\s*(oi|ol[aá]|bom dia|boa (tarde|noite)|e a[ií]|obrigad[oa]|valeu|vlw|tchau|ok|beleza|blz|show|legal|perfeito)\b[\s!.?]*$|^[\d\s.,+\-*/x×÷^%()=?]+$|\b(traduz|traduza|tradu[cç][aã]o|revise|revisar|corrija|reescreva|resuma este|resuma o texto|escreva um (poema|texto|conto|e-?mail|mensagem)|crie uma (hist[oó]ria|poesia|piada))\b/i;
// questão de exatas com a conta inteira no enunciado (18/10: a prova de 10
// questões pesquisou "Questão 6 matemática vestibular" e listou como fonte um
// editor de PDF e um app de formulários): resolve, não pesquisa
const QUESTAO_DE_EXATAS = (t) => /\bquest[aã]o\s*\d/i.test(t) && /\\\(|\\\[|\\frac|\^|\b\d+\s*[=+*/x×]\s*\d|\b[a-z]\s*[=+]\s*\d|\bf\(x\)|\blog_?\d|\bmatriz\b/i.test(t);
const podeFicarSemBusca = (pergunta) => SEM_BUSCA.test(String(pergunta || '').trim()) || QUESTAO_DE_EXATAS(String(pergunta || ''));

// Travas do código para o modelo pequeno que erra os campos do entendimento (18/10): palavras que
// dizem "depende de quando" e "é sobre o usuário" valem em qualquer tema
const PISTA_DE_ATUAL = /\b(hoje|agora|atual|atualmente|atuais|recentes?|recentemente|[uú]ltim[oa]s? (not[ií]cias?|resultados?|vers[aã]o|semana|m[eê]s|dias)|mais (nov[oa]s?|recentes?)|vers[aã]o atual|esta semana|este (m[eê]s|ano)|neste momento|ainda (est[aá]|tem|existe|vale)|novidades?|cota[cç][aã]o|previs[aã]o|placar|resultado|vai (ganhar|vencer|sair|lan[cç]ar)|quem (ganhou|venceu|est[aá] na frente)|j[aá] (saiu|lan[cç]ou|foi lan[cç]ad))\b/i;
const PISTA_DO_USUARIO = /\b(meu|minha|meus|minhas|comigo|aqui em casa)\b/i;
// a ação que o modelo escolher precisa ter a ver com a pergunta (trava para o modelo pequeno)
const PISTA_DA_ACAO = {
  teste_de_rede: /internet|conex|wi-?fi|\brede\b|ping|lag|lat[eê]ncia|velocidade|download|upload|banda|roteador|operadora|provedor|fibra/i,
  rota_de_jogo: /\b(jogo|jogos|jogar|game|games|ping|lag|servidor|servidores|pubg|fortnite|cs ?2|counter|dota|valorant|lol|league)\b/i,
  trafego_de_rede: /internet|\brede\b|banda|consum|programa|aplicativo|conex|lent/i,
  consultar_pc: /computador|\bpc\b|notebook|disco|\bhd\b|ssd|espa[çc]o|configura[çc]|driver|windows|mouse|teclado|monitor|placa|som|[áa]udio|fotos|v[íi]deos|m[úu]sicas|programa|instalad|arquivos|mem[óo]ria|\bram\b|processador|cpu|bateria|inicializa/i,
  buscar_imagens: /fotos?|imagens?|ver como|aparencia|aparência/i,
  ajustes_de_rede: /\bdns\b|placa de rede|economia de energia|5 ?ghz|cache|ajust|otimiz|configur/i,
  diagnostico_da_rede: /roteador|modem|wi-?fi|\brede\b|cabo|aparelho|dispositivo|ipconfig|\bdns\b|gateway|sinal|conex|internet|lag|ping/i,
};
const acaoValida = (id, texto) => (capacidades.EXECUTAVEIS.includes(id) && PISTA_DA_ACAO[id]?.test(String(texto || '')) ? id : null);
// a mensagem pede que o AuGPT FAÇA algo (18/10, 4B: "você consegue ver como está a qualidade da minha
// conexão?" veio como "sugerir", não "acao" — e virou pesquisa): aí a capacidade apontada é a ação
// ("o que você pode me dizer sobre…" é pergunta: "pode/consegue" só vale seguido de um verbo de fazer)
const VERBO_DE_FAZER = '(ver|medir|testar|verificar|checar|analisar|olhar|mostrar|fazer|rodar|realizar|conferir|descobrir|avaliar|monitorar)';
const PEDE_QUE_FACA = new RegExp(`\\b(consegue|consegues|pode|poderia|podes|d[áa] (pra|para)|tem como|sabe)\\b(\\s+[\\wà-ú]+){0,2}\\s+${VERBO_DE_FAZER}\\b|^\\s*(fa[çc]a|faz|realiz\\w*|verifi\\w*|test\\w*|me[çc]a|mede|medir|mostr\\w*|veja|analis\\w*|confir\\w*|cheq\\w*)\\b`, 'i');

// criar imagem (Fase 5): a regra do código cobre o que o modelo deixar passar
const PEDE_IMAGEM = /\b(crie|cria|criar|gere|gera|gerar|fa[çc]a|desenhe|desenha|desenhar|ilustre|pinte|edite|transforme|transformar)\b[^.?!]{0,50}\b(imagem|imagens|foto|desenho|ilustra[çc][ãa]o|arte|logo|logotipo|wallpaper|papel de parede|pintura|figura|capa|banner|mascote|cartaz|ícone)\b/i;
const pedeImagem = (pergunta) => PEDE_IMAGEM.test(String(pergunta || ''));

// criar algo interativo (item 4, 18/10): a resposta é uma página no bloco ```visual, que roda no chat
const PEDE_VISUAL = /\b(crie|cria|criar|monte|monta|montar|fa[çc]a|faz|gere|gera|desenvolva|programe|construa)\b[^.?!]{0,60}\b(calculadora|simula[çc][ãa]o|simulador|anima[çc][ãa]o|jogo|joguinho|painel|dashboard|p[áa]gina|visualiza[çc][ãa]o|interativ\w*|linha do tempo|quiz|cron[ôo]metro|rel[óo]gio|conversor|planilha interativa)\b/i;
const pedeVisual = (pergunta) => PEDE_VISUAL.test(String(pergunta || '')) && !pedeGrafico(pergunta);
/** Página completa num ```html (18/10: o 2B escreveu a calculadora certa, mas como código): vira ```visual. */
const comoVisual = (texto) => (/```visual/.test(texto) ? texto : String(texto).replace(/```html\s*\n([\s\S]*?<(?:script|body|canvas|button)[\s\S]*?)```/i, '```visual\n$1```'));

function lerEntendimento(texto, pergunta, { comImagem = false } = {}) {
  try {
    const j = JSON.parse(String(texto).slice(String(texto).indexOf('{'), String(texto).lastIndexOf('}') + 1));
    // produto sempre busca (15/10: "fone de ouvido dunu titan s" saiu sem busca e o modelo disse que ele "não existe")
    const assuntos = (Array.isArray(j.assuntos) ? j.assuntos : []).map((a) => String(a || '').trim()).filter((a) => a.length >= 2 && a.length <= 80).slice(0, 4);
    // o modelo só decide "sem busca" no que é claramente conversa; um nome solto ("Dragon Ball Super Beerus") pesquisa
    const exatas = QUESTAO_DE_EXATAS(String(pergunta || ''));
    const precisaBuscar = !exatas && (j.precisa_buscar !== false || j.produto === true || (!comImagem && !podeFicarSemBusca(pergunta)));
    return {
      precisaBuscar,
      produto: j.produto === true,
      criarImagem: (j.criar_imagem === true && !pedeVisual(pergunta) && !pedeGrafico(pergunta)) || pedeImagem(pergunta),
      atual: precisaBuscar && (j.muda_com_o_tempo === true || PISTA_DE_ATUAL.test(pergunta)),
      sobreOUsuario: j.sobre_o_usuario === true || PISTA_DO_USUARIO.test(pergunta),
      imagemAjuda: !exatas && j.imagem_ajuda !== false,
      acao: acaoValida(j.acao, pergunta) || (PEDE_QUE_FACA.test(String(pergunta || '')) ? acaoValida(j.sugerir, pergunta) : null),
      sugerir: acaoValida(j.acao, pergunta) || PEDE_QUE_FACA.test(String(pergunta || '')) ? null : acaoValida(j.sugerir, pergunta),
      assuntos,
      pergunta: String(j.pergunta || '').trim() || pergunta,
    };
  } catch {
    // JSON quebrado: busca, com a pergunta como veio
    return { precisaBuscar: true, produto: false, criarImagem: pedeImagem(pergunta), atual: PISTA_DE_ATUAL.test(pergunta), sobreOUsuario: PISTA_DO_USUARIO.test(pergunta), imagemAjuda: false, assuntos: [], pergunta };
  }
}

/**
 * Trava do código no entendimento (17/10, Llama 3.2 3B): o modelo pequeno
 * copiou o exemplo das instruções e reescreveu "top 5 fones para PUBG" como
 * "Chevrolet Vectra 2.0". Pergunta reescrita ou assunto sem nenhuma palavra do
 * que o usuário escreveu (na mensagem ou na conversa) não vale.
 */
// pistas de pedido de produto (17/10: o 3B marcou "como o acidente de Chernobyl aconteceu?" como produto
// e a resposta virou um cartão com "faixa de preço"): intenção de escolha ou compra, categoria de
// produto, ou um nome de modelo com letras e números (QC20, G502, RTX 5080)
const PISTA_DE_PRODUTO = /\b(melhor(es)?|recomend\w*|indica\w*|sugest\w*|compr\w*|pre[çc]o|custa|vale a pena|review|an[áa]lise|compar\w*|versus|vs\.?|top \d+|qual (escolher|pegar)|custo[- ]benef[íi]cio|fones?|headsets?|iems?|earbuds?|mouses?|teclados?|monitor(es)?|celular(es)?|smartphones?|notebooks?|laptops?|tablets?|tvs?|televis\w+|placas? de v[íi]deo|gpus?|processador(es)?|ssds?|hds?|roteador(es)?|c[âa]meras?|caixas? de som|soundbars?|geladeiras?|fog[õo]es?|micro-?ondas|m[áa]quinas? de lavar|ar[- ]condicionado|carros?|motos?|bicicletas?|t[êe]nis|rel[óo]gios?|smartwatch\w*|consoles?|cadeiras?|perfumes?)\b|\b(?=[a-z]*\d)(?=\d*[a-z])[a-z\d-]{2,}\b/i;
// nome solto e curto ("dunu titan s") sem palavra de pergunta também vale: aí o modelo decide
const PALAVRA_DE_PERGUNTA = /(^|[^a-z])(como|por ?que|porque|quem|quando|onde|o que|qual a|quais)([^a-z]|$)/i;
const temPistaDeProduto = (t) => {
  const texto = String(t || '').trim();
  return PISTA_DE_PRODUTO.test(texto) || (texto.split(/\s+/).length <= 5 && !PALAVRA_DE_PERGUNTA.test(texto));
};

/**
 * Assunto que rende foto (18/10: "presidente", "Brasil" e "login no site" viraram 12 fotos no topo):
 * tem número ("RTX 5080", "SR-71") ou uma palavra escrita com maiúscula pelo usuário no meio da
 * frase (nome próprio). Vale para qualquer tema — é a forma do nome, não o assunto.
 */
function assuntoConcreto(assunto, textoDoUsuario) {
  if (/\d/.test(assunto)) return true;
  const proprios = new Set(
    [...String(textoDoUsuario || '').matchAll(/(?<=[\p{Ll}\d,;:)'"]\s+)(\p{Lu}[\p{L}\d-]{2,})/gu)].map((m) => palavrasDe(m[1])[0]).filter(Boolean)
  );
  return palavrasDe(assunto).some((w) => proprios.has(w));
}

function conferirEntendimento(ent, { pergunta, conversa = [] }) {
  const doUsuario = new Set(palavrasDe(`${pergunta} ${conversa.map((m) => m.content).join(' ')}`));
  const tem = (t) => palavrasDe(t).some((w) => doUsuario.has(w));
  const pedidosDoUsuario = `${pergunta} ${conversa.filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join(' ')}`;
  const assuntos = (ent.assuntos || []).filter(tem);
  const produto = ent.produto === true && temPistaDeProduto(pedidosDoUsuario);
  return {
    ...ent,
    produto,
    pergunta: tem(ent.pergunta) ? ent.pergunta : pergunta,
    assuntos,
    // as fotos do topo: no máximo 3 assuntos, só os concretos, e só quando ver ajuda
    // (18/10, 2B: "me fale da Torre Eiffel" veio com imagem_ajuda false); nome de uma palavra só
    // ("Brasil", "Lula") segue o que o modelo disse
    // pedido de gráfico não leva foto (18/10, no app: o carrossel da RTX 5080 em cima do gráfico pedido)
    fotos: (pedeGrafico(pergunta) ? [] : assuntos)
      .filter((a) => produto || assuntoConcreto(a, pedidosDoUsuario))
      .filter((a) => ent.imagemAjuda !== false || produto || /\d/.test(a) || palavrasDe(a).length >= 2)
      .slice(0, 3),
  };
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

/** Regras do modo, mais as de pergunta que muda com o tempo (lê pelo menos 2 páginas até no rápido). */
function regrasDoModo(modo, atual = false) {
  const base = MODOS[modo] || MODOS.normal;
  return atual ? { ...base, minLeituras: Math.max(2, base.minLeituras), leituras: Math.max(3, base.leituras), minBuscas: Math.max(1, base.minBuscas) } : base;
}

function sistemaDoPesquisador({ hoje, rodada, total, produto = false, modo = 'normal', youtube = false, verImagens = false, atual = false }) {
  const regras = regrasDoModo(modo, atual);
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
        ? `- Esta é uma pesquisa RÁPIDA: uma ou duas buscas certeiras${atual ? ` e leia ${regras.minLeituras} páginas` : ''} e pronto.\n`
        : `- Faça pelo menos ${regras.minBuscas} buscas e leia de ${regras.minLeituras} a ${regras.leituras} páginas.\n`
  }${atual ? `- A resposta desta pergunta MUDA COM O TEMPO: busque o que aconteceu até hoje (${hoje}) — se puser ano na busca, use ${String(hoje).slice(-4)}, nunca um ano que ainda não chegou. Prefira as notícias do último mês e as páginas com data recente (aparece junto de cada resultado) e desconfie de página antiga falando como se fosse hoje.\n` : ''}- Você tem até ${total} rodadas de ferramentas.`;
}

/**
 * As buscas que o modelo mandou, como lista (17/10, Llama 3.2 3B): modelo
 * pequeno manda a lista como TEXTO ("[\"a\", \"b\"]") ou separada por vírgula,
 * e o núcleo buscava o texto inteiro como uma busca só — vinham sites de filme.
 */
function listaDeBuscas(valor) {
  let v = valor;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try {
        v = JSON.parse(t);
      } catch {
        v = t.replace(/^\[|\]$/g, '').split(/"\s*,\s*"/);
      }
    } else v = /"\s*,\s*"/.test(t) ? t.split(/"\s*,\s*"/) : [t];
  }
  return (Array.isArray(v) ? v : [v])
    .flat()
    .map((q) => String(q ?? '').replace(/^[\s"'[\]]+|[\s"'[\]]+$/g, '').trim())
    .filter((q) => q.length >= 2);
}

const palavrasDe = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 || /\d/.test(w));

/** Os resultados como o pesquisador vê: "[n] título (domínio)\nresumo". */
const dataBr = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const quando = (f) => (f.data ? `publicado em ${dataBr(f.data)}` : f.recente ? 'notícia do último mês' : '');
// o tipo do site (órgão oficial, universidade, imprensa…) e o alerta (sátira, histórico de notícia
// falsa) vão junto: o modelo escolhe o que ler sabendo de onde vem
const tipoParaOModelo = (f) => (f.qualidade && !/^(site|desconhecido)$/.test(f.qualidade) ? `, ${f.qualidade}` : '');
const alertaParaOModelo = (f) => (f.alerta ? ` ⚠ ${f.alerta.risco === 'satira' ? 'site de sátira (humor, não é notícia)' : `cuidado: ${f.alerta.motivo || 'site com histórico de informação falsa'}`}` : '');
const listaParaOModelo = (fontes) => fontes.map((f) => `[${f.n}] ${f.titulo || dominio(f.url)} (${dominio(f.url)}${quando(f) ? `, ${quando(f)}` : ''}${f.comunidade ? ', comunidade' : ''}${f.video ? ', vídeo' : ''}${tipoParaOModelo(f)})${alertaParaOModelo(f)}\n${String(f.resumo || '').slice(0, 300)}`).join('\n\n');

/**
 * O laço do pesquisador. Devolve as fontes juntadas (numeradas, com resumo e,
 * quando lidas, os trechos escolhidos da página).
 */
async function pesquisar({ pergunta, modo = 'normal', deps, hoje, produto = false, assuntos = [], conversa = [], imagemAnexada = '', atual = false, sobreOUsuario = '' }) {
  const { chamar, buscar, lerPagina, embed, emit = () => {}, signal, buscarNaComunidade } = deps;
  // comunidade (15/10, pedido do Davi): em pedido de produto, Reddit e fóruns entram sempre
  const comComunidade = produto && typeof buscarNaComunidade === 'function';
  const comYoutube = typeof deps.buscarNoYoutube === 'function' && typeof deps.verVideo === 'function' && modo !== 'rapido';
  const comImagens = typeof deps.buscarImagensParaVer === 'function' && modo !== 'rapido';
  const ferramentas = [...(comComunidade ? [FERRAMENTA_DA_COMUNIDADE] : []), ...FERRAMENTAS, ...(comYoutube ? FERRAMENTAS_DO_YOUTUBE : []), ...(comImagens ? [FERRAMENTA_DE_IMAGENS] : [])];
  const regras = regrasDoModo(modo, atual);
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
      content: `Pergunta do usuário: ${pergunta}${sobreOUsuario ? `\nO que o AuGPT sabe sobre o usuário (a pergunta depende disso — use nas buscas o que for pertinente, como o modelo da placa de vídeo):\n${sobreOUsuario.slice(0, 1200)}` : ''}${imagemAnexada ? `\nO usuário anexou uma imagem. O que se vê nela:\n${imagemAnexada.slice(0, 1500)}\nO nome de modelo que não está escrito na imagem é só provável: confirme pela aparência${typeof deps.buscarImagensParaVer === 'function' ? ' com ver_imagens, comparando os candidatos' : ' nas fontes'}.` : ''}${assuntos.length ? `\nDo que ela trata: ${assuntos.join(', ')}` : ''}${anteriores.length ? `\nO que o usuário perguntou antes nesta conversa (para entender a pergunta):\n${anteriores.join('\n')}` : ''}`,
    },
  ];
  let buscou = false;

  // 17/10 (Llama 3.2 3B): busca sem o assunto ("especificações e dados técnicos", copiado das
  // instruções) ganha o assunto na frente; busca repetida não roda de novo
  const termosDoAssunto = new Set(palavrasDe(`${pergunta} ${assuntos.join(' ')}`));
  const assuntoCurto = (assuntos.length ? assuntos.slice(0, 2).join(' ') : pergunta).slice(0, 80);
  const feitas = new Set();
  const prepararBuscas = (buscas, maximo, onde = 'web') =>
    listaDeBuscas(buscas)
      .map((q) => (palavrasDe(q).some((w) => termosDoAssunto.has(w)) ? q : `${assuntoCurto} ${q}`))
      .filter((q) => {
        const chave = `${onde}:${palavrasDe(q).sort().join(' ')}`;
        if (feitas.has(chave)) return false;
        feitas.add(chave);
        return true;
      })
      .slice(0, maximo);

  const executarBusca = async (buscas, { comunidade = false } = {}) => {
    const lista = prepararBuscas(buscas, 3, comunidade ? 'comunidade' : 'web');
    if (!lista.length) return 'Essas buscas já foram feitas. Leia as fontes mais promissoras com ler_pagina, busque outro ângulo com o nome do assunto, ou chame pronto.';
    emit('ferramenta', { nome: comunidade ? 'buscar_na_comunidade' : 'buscar_na_web', argumentos: { consulta: lista.join(' · ') }, risco: 'leitura' });
    const achados = (await Promise.all(lista.map((q) => (comunidade ? buscarNaComunidade(q) : buscar(q, { recente: atual })).catch(() => [])))).flat();
    for (const q of lista) emit('fonte', { tipo: 'busca', provedor: 'web', consultas: [q], resultados: Math.round(achados.length / lista.length) });
    buscou = true;
    buscasFeitas += lista.length;
    // ordena pelo que a pergunta + as buscas pedem; o pesquisador vê os 8 melhores novos
    const novos = achados.filter((r) => r?.url && !porUrl.has(r.url)).map((r) => ({ ...r, texto: `${r.titulo || ''} ${r.resumo || ''}` }));
    const relevantes = await ordenar(`${pergunta} ${lista.join(' ')}`, novos, { embed, maximo: 16 });
    const ordenados = comCredibilidade(relevantes, { comunidade, maximo: 8, jaVistos: fontes });
    const mostrados = [];
    for (const r of ordenados) {
      if (porUrl.has(r.url)) continue;
      const f = { n: fontes.length + 1, url: r.url, titulo: r.titulo || '', resumo: r.resumo || '', trechos: [], comunidade, qualidade: r.qualidade || null, alerta: r.alerta || null, data: /^\d{4}-\d{2}-\d{2}/.test(String(r.data || '')) ? String(r.data).slice(0, 10) : null, recente: r.recente === true };
      fontes.push(f);
      porUrl.set(r.url, f);
      mostrados.push(f);
    }
    adiantar(mostrados);
    return mostrados.length ? listaParaOModelo(mostrados) : 'Nenhum resultado novo para essas buscas.';
  };
  // 19/10 (revisão da pesquisa): enquanto o modelo decide (1,5 a 4,6 s por rodada), as 2 primeiras
  // páginas novas de cada busca já vão sendo lidas; quando ele pede, a página está pronta. Vídeo
  // fica de fora (a legenda pesa), e o total adiantado tem teto, para não baixar o que ninguém lê.
  let adiantadas = 0;
  const adiantar = (lista) => {
    // só página que cita o assunto (a mesma regra da leitura obrigatória: tópico de SSD num pedido de fone não)
    const doAssunto = (x) => !assuntos.length || assuntos.some((a) => tituloCita(`${x.titulo} ${x.resumo}`, a));
    for (const f of lista.filter((x) => !x.video && !x.alerta && !/youtube\.com|youtu\.be/.test(x.url) && doAssunto(x)).slice(0, 2)) {
      if (adiantadas >= regras.leituras + 2 || f.adiantada || signal?.aborted) continue;
      adiantadas += 1;
      f.adiantada = Promise.resolve()
        .then(() => lerPagina(f.url))
        .catch((err) => ({ erro: err }));
    }
  };

  const executarBuscaNoYoutube = async (buscas) => {
    const lista = prepararBuscas(buscas, 2, 'youtube');
    if (!lista.length) return 'Essas buscas já foram feitas.';
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
    if (f.trechos.length) return `[${f.n}] já foi lida — o que ela traz:\n${f.trechos.join('\n…\n').slice(0, 1500)}\nLeia outra fonte ou chame pronto.`;
    if (leiturasFeitas >= regras.leituras && !garantia) return `Limite de ${regras.leituras} páginas lidas nesta pesquisa: use o que já tem ou chame pronto.`;
    leiturasFeitas += 1;
    if (f.video && comYoutube) {
      emit('ferramenta', { nome: 'ver_video', argumentos: { url: f.url, foco: String(foco || '') }, risco: 'leitura' });
      return lerVideo(f, foco);
    }
    emit('ferramenta', { nome: 'ler_pagina', argumentos: { url: f.url, foco: String(foco || '') }, risco: 'leitura' });
    let pagina;
    try {
      // 19/10: prazo de 8 s por página — um site lento (12,7 s, medido) segurava a rodada inteira; a
      // leitura segue em segundo plano (vai para o cache) e o modelo continua com as outras
      if (!f.adiantada) f.adiantada = Promise.resolve().then(() => lerPagina(f.url)).catch((err) => ({ erro: err }));
      let relogio;
      const pronta = await Promise.race([f.adiantada, new Promise((ok) => (relogio = setTimeout(() => ok({ demorou: true }), deps.prazoDaPaginaMs ?? PRAZO_DA_PAGINA_MS)))]);
      clearTimeout(relogio);
      if (pronta?.demorou) {
        leiturasFeitas -= 1;
        return `A página [${f.n}] está demorando para abrir: leia outra fonte.`;
      }
      if (pronta?.erro) throw pronta.erro;
      pagina = pronta;
    } catch (err) {
      return `Não consegui ler [${f.n}]: ${String(err.message || err).slice(0, 120)}`;
    }
    if (!pagina?.texto) return `A página [${f.n}] não trouxe texto.`;
    emit('fonte', { tipo: 'leitura', provedor: pagina.via || 'web', url: f.url });
    if (pagina.titulo && !f.titulo) f.titulo = pagina.titulo;
    if (pagina.data) f.data = String(pagina.data).slice(0, 10);
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
    // o começo da conversa fica IGUAL em toda rodada: o Ollama reaproveita o que já leu (17/10, RX 580:
    // com "rodada N de 6" nas instruções, cada rodada relia o histórico inteiro — 6.337 tokens, 87 s)
    const ultima = rodada === total ? [{ role: 'user', content: 'Esta é a última rodada: se já tem o suficiente, chame pronto.' }] : [];
    const r = await chamar([{ role: 'system', content: sistemaDoPesquisador({ hoje, rodada, total, produto: comComunidade, modo, youtube: comYoutube, verImagens: comImagens, atual }) }, ...historico, ...ultima], { tools: ferramentas });
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
    // 19/10: as ações da mesma rodada rodam ao mesmo tempo (antes, duas páginas pedidas juntas eram
    // lidas uma depois da outra); as respostas voltam ao histórico na ordem em que foram pedidas
    const executar = (c) => {
      if (c.nome === 'buscar_na_web') return executarBusca(c.args.buscas || c.args.consultas || c.args.query || []);
      if (c.nome === 'buscar_na_comunidade' && comComunidade) return executarBusca(c.args.buscas || c.args.consultas || c.args.query || [], { comunidade: true });
      if (c.nome === 'ler_pagina' || c.nome === 'ver_video') return executarLeitura(c.args);
      if (c.nome === 'ver_imagens' && comImagens) return executarVerImagens(c.args);
      if (c.nome === 'buscar_no_youtube' && comYoutube) return executarBuscaNoYoutube(c.args.buscas || c.args.consultas || c.args.query || []);
      if (c.nome === 'pronto') return 'ok';
      return `Ferramenta desconhecida: ${c.nome}`;
    };
    // primeiro as buscas (juntas), depois o resto (junto): a leitura pode ser de fonte que a busca da mesma rodada trouxe
    const rodar = (c) => Promise.resolve().then(() => executar(c)).catch((err) => `Falhou: ${String(err?.message || err).slice(0, 160)}`);
    const ehBusca = (c) => /^buscar_/.test(c.nome);
    const saidas = new Array(chamadas.length);
    await Promise.all(chamadas.map((c, i) => (ehBusca(c) ? rodar(c).then((x) => (saidas[i] = x)) : null)));
    await Promise.all(chamadas.map((c, i) => (ehBusca(c) ? null : rodar(c).then((x) => (saidas[i] = x)))));
    chamadas.forEach((c, i) => historico.push({ role: 'tool', tool_name: c.nome, content: saidas[i] }));
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
    const naoLidas = fontes.filter((f) => !f.trechos.length && !f.alerta).map((f) => ({ f, url: f.url, texto: `${f.titulo} ${f.resumo}` }));
    const ordenadas = comCredibilidade(await ordenar(pergunta, naoLidas, { embed }), { comunidade: false, maximo: Infinity, porSite: Infinity }).map((x) => x.f);
    // só página que cita o assunto: faltando, lê menos — completar a conta com página fora do assunto
    // (17/10, um tópico de SSD num pedido de fone) piora a resposta em vez de melhorar
    const ordem = ordenadas.filter(citaAssunto);
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

function sistemaDoEscritor({ hoje, comFontes, produto = false, tamanho = 'normal', atual = false, sobreOUsuario = '', capacidadesNaEscrita = '' }) {
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
- As anotações do pesquisador (se houver) mostram o que ele já conferiu, como preço atual. Quando uma anotação e uma fonte discordarem, prefira o dado mais recente e diga a diferença.
- Cada fonte pode trazer a data em que foi publicada (data="…"). Quando as fontes discordarem, diga que discordam e fique com a mais recente; não conte como situação de hoje o que uma fonte antiga dizia.
- Todo número, data e nome que você escrever tem de estar nas fontes. O que elas não trazem, você não afirma.${INSTRUCAO_DE_GRAFICO}${INSTRUCAO_DE_VISUAL}${
        atual ? `\n- Esta pergunta depende de QUANDO: diga a data dos fatos que citar ("em 5 de outubro de ${String(hoje).slice(-4)}…") e deixe claro o que já aconteceu e o que ainda não, olhando a data de hoje.` : ''
      }${produto ? FORMATO_DE_PRODUTO : ''}`
    : `- Responda direto e bem explicado. Se não tiver certeza de algum dado, diga.${INSTRUCAO_DE_GRAFICO}${INSTRUCAO_DE_VISUAL}`
}${capacidadesNaEscrita ? `\n\n${capacidadesNaEscrita}` : ''}${sobreOUsuario ? `\n\n<sobre_o_usuario>\n${sobreOUsuario.slice(0, 1500)}\n</sobre_o_usuario>\nA pergunta é sobre a situação do próprio usuário: responda para o caso dele, com estes dados (diga quais usou), e não recomende comprar o que ele já tem ou algo pior do que já tem.` : ''}`;
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

const blocoDeFontes = (usadas) => usadas.map((f) => `<fonte n="${f.n}" titulo="${String(f.titulo || dominio(f.url)).replace(/"/g, "'")}" site="${dominio(f.url)}"${f.data ? ` data="${dataBr(f.data)}"` : f.recente ? ' data="último mês"' : ''}>\n${f.conteudo}\n</fonte>`).join('\n');

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
 * Conferência da resposta pelo código (17/10, medido com o Llama 3.2 3B, que
 * citava [9] e [10] com 8 fontes, punha preço redondo que não estava em
 * lugar nenhum e recomendava headset que nenhuma fonte citava num pedido de
 * intra-auricular). Vale para qualquer modelo:
 * - citação de fonte que não existe sai;
 * - preço que não aparece no material ganha ⚠ (como os anos);
 * - cartão de produto cujo nome não aparece em nenhuma fonte sai, com aviso
 *   (se nenhum cartão sobraria, ficam todos e o aviso diz isso).
 */
const inteiroDoPreco = (t) => String(t).replace(/[.\s](?=\d{3}\b)/g, '').replace(/[,.]\d{1,2}$/, '').replace(/\D/g, '');

function conferirResposta(texto, { numeros = [], material = '', produto = false } = {}) {
  const validos = new Set(numeros);
  let t = String(texto || '').replace(/\[(\d+)\]/g, (m, n) => (validos.has(Number(n)) ? m : ''));
  t = t.replace(/\(\s*fontes?:?\s*\)/gi, '').replace(/[ \t]+([.,;])/g, '$1');

  const removidos = [];
  if (produto) {
    const partes = t.split(/(?=^#### \d+\.)/m);
    const cartoes = partes.filter((x) => /^#### \d+\./.test(x));
    // o cartão termina no próximo título que não é cartão (## ou ###) ou num ---
    const corpo = (x) => x.split(/^(?=#{2,3} (?!#)|---\s*$)/m)[0];
    const semFonte = cartoes.filter((x) => !tituloCita(material, /^#### \d+\.\s*(.+)$/m.exec(x)[1].replace(/[*_[\]]/g, '')));
    if (semFonte.length && semFonte.length < cartoes.length) {
      let n = 0;
      t = partes
        .map((x) => {
          if (!/^#### \d+\./.test(x)) return x;
          const nome = /^#### \d+\.\s*(.+)$/m.exec(x)[1].replace(/[*_[\]]/g, '').trim();
          if (semFonte.includes(x)) {
            removidos.push(nome);
            return x.slice(corpo(x).length); // tira o cartão, fica o que vem depois dele
          }
          n += 1;
          return x.replace(/^#### \d+\./, `#### ${n}.`);
        })
        .join('');
    } else if (semFonte.length) {
      removidos.push(...semFonte.map((x) => `${/^#### \d+\.\s*(.+)$/m.exec(x)[1].replace(/[*_[\]]/g, '').trim()} (mantido)`));
    }
  }
  const valoresDoMaterial = new Set((material.match(/\d[\d.,]*\d|\d/g) || []).map(inteiroDoPreco));
  // 19/10 (revisão da pesquisa): preço sem fonte SAI do texto (antes ganhava ⚠ e ficava): era o modelo
  // estimando de memória ("R$ 600, R$ 800" para SSDs que nenhuma fonte citava), e preço velho engana
  // quem vai comprar. Faixa ("R$ 600 a R$ 800") vira uma marcação só; o preço das fontes fica.
  const precosSemFonte = new Set();
  const TIRADO = '\u2062'; // invisível e só daqui (o \u0000 é o marcador dos gráficos)
  t = t.replace(/((?:R\$|US\$|U\$|€|£)\s?)(\d[\d.,]*\d|\d)(?![\d%])/g, (m, moeda, valor) => {
    if (valoresDoMaterial.has(inteiroDoPreco(valor))) return m;
    precosSemFonte.add(`${moeda.trim()} ${valor}`);
    return TIRADO;
  });
  t = t
    .replace(/\u2062(\s*(?:a|até|e|ou|-|–|—|\/)\s*\u2062)+/g, TIRADO)
    .replace(/(entre|de|por|custa|custam|sai por|saem por|cerca de|em torno de|a partir de|até)\s+\u2062/gi, '$1 \u2062')
    .replace(/\u2062/g, '*(preço não confirmado)*');

  const notas = [];
  if (removidos.length) {
    notas.push(removidos.every((r) => /\(mantido\)$/.test(r))
      ? `*⚠ Nenhuma das opções aparece com esse nome nas fontes lidas — confira antes de comprar.*`
      : `*Tirei ${removidos.length === 1 ? '1 opção que não aparece' : `${removidos.length} opções que não aparecem`} em nenhuma fonte lida: ${removidos.join(', ')}.*`);
  }
  if (precosSemFonte.size) notas.push(`*Tirei ${precosSemFonte.size === 1 ? '1 preço que não aparece' : `${precosSemFonte.size} preços que não aparecem`} nas fontes lidas (${[...precosSemFonte].join(', ')}): preço muda rápido, e um valor de memória engana. Para o preço de hoje, pergunte "onde comprar" ou "qual o preço de hoje".*`);
  return { texto: notas.length ? `${t.trim()}\n\n${notas.join('\n\n')}` : t, precosSemFonte: [...precosSemFonte], removidos };
}

/**
 * Conferência de fatos contra as fontes (18/10, conversas reais: a resposta
 * sobre a eleição trouxe um "AI n.º 16" e uma "vacância do cargo" que nenhuma
 * página lida dizia). Generaliza a dos anos e preços para QUALQUER resposta
 * com fontes: números (fora anos, preços, contagens até 10 e links) e nomes
 * próprios escritos no meio da frase precisam aparecer no material lido, na
 * pergunta ou na conversa. Número sem fonte ganha ⚠; os dois entram na conta
 * que decide se a resposta é reescrita.
 * ponytail: confere a presença da palavra ou dos dígitos, não o sentido —
 * "16" existe em quase toda página; pega o inventado, não o número trocado.
 */
const soDigitos = (t) => String(t).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const palavrasDoMaterial = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

function conferirFatos(texto, { material = '', extra = '', semNumeros = false } = {}) {
  const base = `${material} ${extra}`;
  // 19/10 (revisão): o número do material vale inteiro E por partes seguidas — o build "26200.6584"
  // cobre o "26200", o IP "192.168.0.1" cobre o "192.168"; antes, 12 de 14 avisos eram assim
  const numerosDoMaterial = new Set(
    (base.match(/\d[\d.,]*\d|\d/g) || []).flatMap((n) => {
      const partes = n.split(/[.,]/);
      const pedacos = [];
      for (let i = 0; i < partes.length && partes.length <= 6; i += 1) for (let j = i + 1; j <= partes.length; j += 1) pedacos.push(soDigitos(partes.slice(i, j).join('')));
      return [soDigitos(n), soDigitos(n.replace(/[.,]0+$/, '')), ...pedacos];
    })
  );
  const palavras = new Set(palavrasDoMaterial(base));
  const numeros = new Set();
  const nomes = new Set();
  let conferidos = 0;
  // links, endereços e citações ficam fora
  const partes = String(texto || '').split(/(```[\s\S]*?```|\]\([^)]*\)|https?:\/\/\S+|\[\d+\]|`[^`]*`)/);
  const marcado = partes
    .map((p, i) => {
      if (i % 2 === 1) return p;
      // versão e IP (8.08.12.551, 192.168.0.1) são conferidos inteiros, antes do resto
      let q = p.replace(/\b\d+(?:\.\d+){2,}\b/g, (m, offset, str) => {
        if (semNumeros || /^\s?⚠/.test(str.slice(offset + m.length, offset + m.length + 3))) return m;
        conferidos += 1;
        if (base.includes(m)) return `${m}\u2063`; // marca invisível: o passo seguinte não o repica
        numeros.add(m);
        return `${m} ⚠`;
      });
      q = q.replace(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(%?)/g, (m, valor, pct, offset, str) => {
        const antes = str.slice(Math.max(0, offset - 5), offset);
        const depois = str.slice(offset + m.length, offset + m.length + 3);
        if (semNumeros) return m; // prova de exatas: os números são as contas, não fatos com fonte
        if (/[\d\p{L}.\u2063]$/u.test(antes) || /^[\d.\u2063]/.test(depois) || /^\s?⚠/.test(depois)) return m; // pedaço de nome ("RTX5080"), de versão ou já marcado
        if (/(R\$|US\$|U\$|€|£)\s?$/.test(antes)) return m; // preço: conferirResposta cuida
        if (pct && /^(0|100)$/.test(valor)) return m;
        // número de modelo logo depois do nome ("Ryzen 5000", "RTX 4090", "Windows 11")
        if (!pct && /^\d{2,5}$/.test(valor) && /(^|[\s(])\p{Lu}[\p{L}\d-]*\s$/u.test(str.slice(Math.max(0, offset - 16), offset))) return m;
        const inteiro = !/[.,]/.test(valor) || /^\d{1,3}(\.\d{3})+$/.test(valor);
        const n = Number(soDigitos(valor));
        if (!pct && inteiro && (n <= 10 || (n >= 1000 && n <= 2099 && valor.length === 4))) return m; // contagem ou ano
        conferidos += 1;
        if (numerosDoMaterial.has(soDigitos(valor)) || numerosDoMaterial.has(soDigitos(valor.replace(/[.,]0+$/, '')))) return m;
        numeros.add(`${valor}${pct}`);
        return `${m} ⚠`;
      });
      q = q.replace(/\u2063/g, '');
      // nome próprio: palavra com maiúscula depois de minúscula, número, vírgula ou parêntese
      // (títulos e tabelas ficam fora: lá a maiúscula é de enfeite, "Cenário Eleitoral")
      const prosa = q.split('\n').filter((l) => !/^\s*(#|\||>)/.test(l)).join('\n');
      for (const mm of prosa.matchAll(/(?<=[\p{Ll}\d,;)]\s+)(\p{Lu}[\p{L}\d.º-]*\p{L}|\p{Lu}{2,})/gu)) {
        conferidos += 1;
        const chaves = palavrasDoMaterial(mm[1]);
        if (!chaves.length || chaves.every((w) => palavras.has(w))) continue;
        nomes.add(mm[1]);
      }
      return q;
    })
    .join('');
  return { texto: marcado, numeros: [...numeros], nomes: [...nomes], conferidos };
}

/** Muitos fatos sem fonte (3+ e pelo menos 1 em cada 4 conferidos): a resposta é reescrita sem eles. */
const precisaReescrever = (c) => c.numeros.length + c.nomes.length >= 3 && (c.numeros.length + c.nomes.length) / Math.max(1, c.conferidos) >= 0.25;

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

/* ------------------------------ criar imagem (Fase 5) ------------------------------ */

const FORMATOS = { quadrado: [1024, 1024], paisagem: [1216, 832], retrato: [832, 1216] };

function pedidoDePrompt({ pergunta, conversa = [], vista = '', editar = false }) {
  const antes = conversa.filter((m) => m.role === 'user').slice(-3).map((m) => `- ${String(m.content || '').slice(0, 200)}`).join('\n');
  return `Você escreve o prompt para o gerador de imagens FLUX.2 Klein. O usuário pediu: "${String(pergunta).slice(0, 1500)}"
${antes ? `\nO que ele pediu antes nesta conversa:\n${antes}\n` : ''}${vista ? `\nImagem anexada${editar ? ' (é para editar esta imagem)' : ''} — o que se vê nela:\n${vista.slice(0, 1200)}\n` : ''}
Responda SÓ com um JSON:
{"prompt": "...", "formato": "quadrado" | "paisagem" | "retrato"${editar ? ' | "igual"' : ''}, "legenda": "uma frase em português dizendo o que a imagem mostra"${editar ? '' : ', "referencia": "busca de foto real para o gerador copiar a aparência, ou vazio"'}}

Regras do prompt:
- em inglês, uma descrição rica e concreta: assunto, ação, cenário, estilo (foto, ilustração, 3D, aquarela, desenho animado…), luz, enquadramento e cores;
- texto que deve aparecer na imagem vai entre aspas duplas, exatamente como deve ser escrito, e curto (até umas 4 palavras) — o gerador erra texto longo;
- o gerador erra letra acentuada (16/10: "Pão" saiu "Pãno"): no texto entre aspas, escreva sem acento ("Pao Dourado");
- não peça rótulos, legendas nem muitos textos: infográfico com muitas palavras sai ilegível;
${editar ? '- é uma EDIÇÃO da imagem anexada: diga a mudança pedida e o que deve ser mantido (ex.: "turn this photo into a cartoon, keep the same pose, face and composition"); formato "igual" mantém o tamanho dela;\n' : ''}- formato: paisagem para cenários amplos e banners, retrato para pessoa de corpo inteiro e cartazes, quadrado no resto.${editar ? '' : `
- "referencia": quando a imagem precisa mostrar fiel um objeto, produto, veículo, prédio ou lugar REAL e específico que o gerador pode não conhecer (um modelo de carro, de fone, uma edição, um monumento), escreva a busca de foto dele (ex.: "Chevrolet Vectra GT 2008 hatch"). Vazio para coisa genérica (um gato, um farol, uma paisagem) e SEMPRE vazio para pessoas.`}`;
}

function lerPrompt(texto, pergunta) {
  try {
    const j = JSON.parse(String(texto).slice(String(texto).indexOf('{'), String(texto).lastIndexOf('}') + 1));
    const prompt = String(j.prompt || '').trim();
    if (prompt.length >= 10) return { prompt, formato: FORMATOS[j.formato] || j.formato === 'igual' ? j.formato : 'quadrado', legenda: String(j.legenda || '').trim(), referencia: String(j.referencia || '').trim().slice(0, 120) };
  } catch {
    /* sem JSON: usa o pedido como veio */
  }
  return { prompt: String(pergunta), formato: 'quadrado', legenda: '' };
}

/**
 * Escolha da foto de referência (17/10, medido: "Vectra GT vermelho na estrada"
 * sem referência saiu um hatch genérico; com a foto do GT, o carro certo). A
 * busca traz de tudo (sedã, oficina, miniatura), então o modelo olha e escolhe.
 */
function pedidoDeEscolha({ pergunta, prompt, busca, quantas }) {
  return `O usuário pediu: "${String(pergunta).slice(0, 800)}"
Prompt atual: "${String(prompt).slice(0, 1000)}"
Estas ${quantas} fotos vieram da busca "${busca}", numeradas de 1 a ${quantas} na ordem.

Escolha a foto que mostra EXATAMENTE o item pedido (o modelo, a versão), inteiro, nítido e sem nada cobrindo. Se nenhuma mostra o item certo, escolha 0.
Depois reescreva o prompt para usar a foto escolhida como referência: comece com "the <item> from the reference image" e diga só o que muda (cor, cenário, ação, estilo, luz), sem descrever de novo o formato do item.
Responda SÓ com um JSON:
{"foto": número de 0 a ${quantas}, "prompt": "o prompt reescrito (vazio se foto for 0)"}`;
}

function pedidoDeRevisao({ pergunta, prompt }) {
  return `Esta imagem foi gerada para o pedido do usuário: "${String(pergunta).slice(0, 800)}"
Prompt usado: "${String(prompt).slice(0, 1200)}"

Confira olhando a imagem: o assunto e os detalhes pedidos estão lá? O texto pedido (se houver) está escrito certo? Há defeito grave (rosto ou mão deformados, objeto pedido faltando, coisa sem sentido)?
Responda SÓ com um JSON:
{"ok": true ou false, "problemas": "o que está errado, ou vazio", "prompt": "se não está ok: o prompt em inglês corrigido para gerar de novo; se está ok: vazio"}
Seja exigente só com o que importa para o pedido: detalhe pequeno não é motivo para refazer.`;
}

function lerRevisao(texto) {
  try {
    const j = JSON.parse(String(texto).slice(String(texto).indexOf('{'), String(texto).lastIndexOf('}') + 1));
    return { ok: j.ok !== false, problemas: String(j.problemas || '').trim(), prompt: String(j.prompt || '').trim() };
  } catch {
    return { ok: true, problemas: '', prompt: '' }; // revisão ilegível: fica a imagem que já existe
  }
}

/**
 * O Qwen escreve o prompt, o FLUX gera (o app tira o Qwen da placa antes) e,
 * com a revisão ligada, o Qwen olha a imagem e corrige no máximo `revisoes`
 * vezes. A semente fica a mesma entre as tentativas: a correção muda só o prompt.
 */
async function criarImagem({ pergunta, conversa, imagens, vista, ent, deps }) {
  const { chamar, emit = () => {} } = deps;
  const editar = imagens.length > 0;
  let p = lerPrompt((await chamar([{ role: 'user', content: pedidoDePrompt({ pergunta, conversa, vista, editar }) }], { json: true, numPredict: 700 })).content, pergunta);
  // foto real de referência (17/10): para o item específico que o gerador não conhece
  let referencia = null;
  if (!editar && p.referencia && typeof deps.buscarReferencias === 'function') {
    emit('ferramenta', { nome: 'buscar_referencia', argumentos: { consulta: p.referencia }, risco: 'leitura' });
    const candidatas = (await deps.buscarReferencias(p.referencia).catch(() => [])).slice(0, 4);
    if (candidatas.length) {
      let escolha = { foto: 0, prompt: '' };
      try {
        const r = (await chamar([{ role: 'user', content: pedidoDeEscolha({ pergunta, prompt: p.prompt, busca: p.referencia, quantas: candidatas.length }), images: candidatas.map((c) => c.base64) }], { json: true, numPredict: 500 })).content;
        const j = JSON.parse(String(r).slice(String(r).indexOf('{'), String(r).lastIndexOf('}') + 1));
        escolha = { foto: Number(j.foto) || 0, prompt: String(j.prompt || '').trim() };
      } catch {
        /* escolha ilegível: gera sem referência */
      }
      const c = candidatas[escolha.foto - 1];
      if (c && escolha.prompt.length >= 10) {
        referencia = c;
        p = { ...p, prompt: escolha.prompt };
      }
      emit('referencia-escolhida', { busca: p.referencia, foto: escolha.foto, titulo: c?.titulo || null });
    }
  }
  const revisoes = Math.max(0, Math.min(2, Number(deps.revisoesDeImagem ?? 2)));
  const semente = Math.floor(Math.random() * 2147483647);
  const tentativas = [];
  let img = null;
  for (let rodada = 0; rodada <= revisoes; rodada += 1) {
    emit('ferramenta', { nome: 'gerar_imagem', argumentos: { consulta: p.prompt.slice(0, 200) }, risco: 'leitura' });
    const [largura, altura] = FORMATOS[p.formato] || [null, null];
    img = await deps.gerarImagem({ prompt: p.prompt, largura, altura, formato: p.formato, semente, referencias: referencia ? [referencia.arquivo] : imagens.map((i) => i.arquivo).filter(Boolean), legenda: p.legenda || pergunta });
    tentativas.push({ prompt: p.prompt, ms: img.ms });
    if (rodada === revisoes) break;
    const rev = lerRevisao((await chamar([{ role: 'user', content: pedidoDeRevisao({ pergunta, prompt: p.prompt }), images: [img.base64] }], { json: true, numPredict: 600 })).content);
    emit('imagem-revisada', { rodada: rodada + 1, ...rev });
    if (rev.ok || !rev.prompt) break;
    tentativas[tentativas.length - 1].problemas = rev.problemas;
    p = { ...p, prompt: rev.prompt };
  }
  const segundos = Math.round(tentativas.reduce((t, x) => t + x.ms, 0) / 1000);
  // texto da imagem que saiu sem o acento do pedido: a resposta avisa
  const semAcento = (t) => t.normalize('NFD').replace(/\p{M}/gu, '');
  const tirados = [...p.prompt.matchAll(/"([^"]{2,60})"/g)].map((m) => m[1]).filter((t) => t === semAcento(t) && semAcento(pergunta).toLowerCase().includes(t.toLowerCase()) && !pergunta.toLowerCase().includes(t.toLowerCase()));
  const refeitas = tentativas.filter((t) => t.problemas);
  const legenda = p.legenda || 'Imagem criada pelo AuGPT';
  const texto = [
    `![${legenda.replace(/[[\]\n]/g, ' ')}](${img.uri})`,
    '',
    legenda,
    '',
    `*Criada com o FLUX.2 Klein no seu computador em ${segundos} s${refeitas.length ? `; refeita ${refeitas.length === 1 ? '1 vez' : `${refeitas.length} vezes`} depois da revisão (${refeitas.map((t) => t.problemas).join('; ').slice(0, 300)})` : ''}.${img.caminho ? ` Salva em \`${img.caminho}\`.` : ''}*`,
    ...(referencia ? ['', `*Foto de referência: [${String(referencia.titulo || 'imagem da web').replace(/[[\]]/g, '').slice(0, 90)}](${referencia.pagina || referencia.url}) — o gerador copiou a aparência dela; logotipos e letras podem sair diferentes.*`] : []),
    ...(tirados.length ? ['', `*O gerador ainda erra letras acentuadas, então o texto foi escrito sem acento (${tirados.map((t) => `"${t}"`).join(', ')}).*`] : []),
    '',
    `**Prompt usado:** ${p.prompt}`,
  ].join('\n');
  return { vista, texto, fontes: [], entendimento: ent, buscou: false, produto: false, assuntos: [], modo: 'imagem', anosSemFonte: [], imagemCriada: { uri: img.uri, caminho: img.caminho, prompt: p.prompt, tentativas: tentativas.length, referencia: referencia ? referencia.pagina || referencia.url : null } };
}

async function responder({ pergunta, conversa = [], modo = 'automatico', tamanho = 'normal', deps, hoje = new Date().toLocaleDateString('pt-BR'), imagens = [] }) {
  const { chamar, escrever, embed, emit = () => {} } = deps;
  // imagem anexada (Fase 4): o modelo olha primeiro, e o que viu vai para o entendimento e a escrita
  let vista = '';
  // modelo que não enxerga (17/10, Llama 3.2 3B): usa o texto do OCR, se houver; senão diz como resolver
  if (imagens.length && deps.semVisao) {
    const lido = imagens.filter((i) => i.texto).map((i) => i.texto.slice(0, 4000)).join('\n\n');
    if (!lido && !pedeImagem(pergunta)) {
      return { vista: '', texto: deps.semVisao, fontes: [], entendimento: { precisaBuscar: false, produto: false, assuntos: [], pergunta }, buscou: false, produto: false, assuntos: [], modo: 'imagem', anosSemFonte: [] };
    }
    vista = lido ? `ESCRITO NA IMAGEM (lido por OCR; o modelo atual não vê a imagem): ${lido}` : '';
    imagens = imagens.map((i) => ({ ...i, base64: undefined }));
  } else if (imagens.length) {
    emit('ferramenta', { nome: 'ver_imagem', argumentos: { arquivos: imagens.map((i) => i.nome).join(', ') }, risco: 'leitura' });
    vista = String((await chamar([{ role: 'user', content: pedidoDeVisao({ pergunta, imagens }), images: imagens.map((i) => i.base64) }], { numPredict: 900 })).content || '').trim();
    emit('imagem-vista', { texto: vista });
  }
  const perguntaComImagem = vista ? `${pergunta}\n\n[Imagem anexada pelo usuário — o que se vê nela: ${vista.slice(0, 1500)}]` : pergunta;
  const ent = conferirEntendimento(lerEntendimento((await chamar([{ role: 'user', content: pedidoDeEntendimento({ pergunta: perguntaComImagem, conversa, hoje }) }], { json: true, numPredict: 300 })).content, pergunta, { comImagem: imagens.length > 0 }), { pergunta: perguntaComImagem, conversa });
  // criar imagem (Fase 5): com o gerador instalado, o pedido não pesquisa — o Qwen escreve o prompt e o FLUX gera
  if (ent.criarImagem && typeof deps.gerarImagem === 'function') {
    emit('nucleo-entendimento', { ...ent, modo: 'imagem' });
    return criarImagem({ pergunta, conversa, imagens, vista, ent, deps });
  }
  // pediu para criar imagem sem o gerador: diz como ter, em vez de pesquisar e parecer que criou
  if (ent.criarImagem && deps.semGerador) {
    emit('nucleo-entendimento', { ...ent, modo: 'imagem' });
    return { vista, texto: deps.semGerador, fontes: [], entendimento: ent, buscou: false, produto: false, assuntos: [], modo: 'imagem', anosSemFonte: [] };
  }
  // o usuário pediu uma ação que o AuGPT executa (18/10: "você consegue ver como está a minha conexão?"
  // virou pesquisa e a resposta disse "não consigo medir") — quem executa é o app (deps.executarAcao)
  if (ent.acao && !ent.criarImagem && typeof deps.executarAcao === 'function') {
    emit('nucleo-entendimento', { ...ent, modo: 'acao' });
    const feita = await deps.executarAcao(ent.acao, { pergunta, ent });
    if (feita) return feita;
  }
  // automático (15/10): produto vai para a pesquisa profunda, o resto para a normal
  const modoUsado = MODOS[modo] ? modo : ent.produto ? 'profundo' : 'normal';
  emit('nucleo-entendimento', { ...ent, modo: modoUsado });
  // a pergunta depende do usuário (18/10, "meu computador"): o que o AuGPT já sabe dele vai junto
  const sobreOUsuario = ent.sobreOUsuario && typeof deps.sobreOUsuario === 'function' ? String((await deps.sobreOUsuario().catch(() => '')) || '').trim() : '';
  const fontes = ent.precisaBuscar ? await pesquisar({ pergunta: ent.pergunta, modo: modoUsado, deps, hoje, produto: ent.produto, assuntos: ent.assuntos || [], conversa, imagemAnexada: vista, atual: ent.atual, sobreOUsuario }) : [];
  const notas = (fontes.notas || []).join('\n\n').slice(-4000);
  const usadas = fontes.length ? await materialDaEscrita(ent.pergunta, fontes, { embed }) : [];
  // 16/10: sem o yt-dlp, "pesquise vídeos no youtube" saiu como "realizei uma pesquisa no YouTube" — não houve
  const semVideos = /\b(youtube|v[ií]deos?)\b/i.test(pergunta) && !(typeof deps.buscarNoYoutube === 'function');
  emit('redigindo', { fontes: usadas.length });
  const mensagens = [
    { role: 'system', content: `${sistemaDoEscritor({ hoje, comFontes: usadas.length > 0, produto: ent.produto, tamanho, atual: ent.atual, sobreOUsuario, capacidadesNaEscrita: capacidades.blocoParaEscrever(deps) })}${semVideos ? '\n- O usuário pediu vídeos do YouTube, mas o AuGPT ainda não tem como ver vídeos (falta instalar o yt-dlp em Ajustes → Componentes). Diga isso numa frase no começo e NÃO diga que pesquisou, viu ou assistiu a vídeos: as fontes são páginas da web.' : ''}${usadas.length ? `\n\n<fontes>\n${blocoDeFontes(usadas)}\n</fontes>` : ''}${notas ? `\n\n<anotacoes_do_pesquisador>\n${notas}\n</anotacoes_do_pesquisador>` : ''}${vista ? `\n\n<imagem_anexada>\nO usuário anexou ${imagens.length === 1 ? 'uma imagem (está junto da pergunta)' : `${imagens.length} imagens (estão junto da pergunta)`}. O que foi visto nela${imagens.length === 1 ? '' : 's'}:\n${vista}${imagens.some((i) => i.texto) ? `\n\nTexto lido por OCR:\n${imagens.filter((i) => i.texto).map((i) => i.texto.slice(0, 4000)).join('\n\n')}` : ''}\n</imagem_anexada>\nResponda sobre a imagem que o usuário mandou. O que vem dela você diz "na imagem", sem citação. O modelo exato de um produto só é certo se estiver escrito na imagem (no texto do OCR) ou se as fontes confirmarem pela aparência; senão, diga que é provável e qual parece ser.` : ''}` },
    ...conversa.slice(-6).map((m) => ({ role: m.role, content: semImagens(m.content).slice(0, 2000) })),
    // o lembrete do formato vai junto da pergunta, que é o que o modelo lê por último
    // (15/10: com o formato só no fim do prompt longo, depois das fontes, o mouse saiu sem cartões)
    { role: 'user', ...(imagens.some((i) => i.base64) ? { images: imagens.map((i) => i.base64) } : {}), content: ent.produto && usadas.length ? `${pergunta}\n\n(Responda no formato de pedido de produto: um bloco "#### N. Marca Modelo" por opção, com **Faixa de preço:**, **Pontos fortes:**, **Pontos fracos:**, **Na comunidade:** citando a fonte, e **Para quem:**.)` : pedeGrafico(pergunta) ? `${pergunta}\n\n(Monte o gráfico pedido num bloco \`\`\`chart com os números que você coletou — "type" de acordo com o pedido; o que for estimativa sua, marque em "estimated".)` : pedeVisual(pergunta) ? `${pergunta}\n\n(Escreva a página inteira — HTML, CSS e JavaScript juntos, sem nada da internet — num bloco que começa com \`\`\`visual: ele roda aqui no chat.)` : pergunta },
  ];
  const limparEscrita = (t) =>
    semImagens(t)
      .replace(/\s*\[(imagem_anexada|imagem anexada)\]/gi, '')
      // título dentro de negrito (17/10, Llama 3.2 3B: "**#### 1. HyperX…**") não vira cartão nem título
      .replace(/^\s*\*\*\s*(#{2,4} [^*\n]+?)\s*\*\*\s*$/gm, '$1');
  let escrito = limparEscrita(await escrever(mensagens, (pedaco) => emit('resposta-token', { pedaco })));
  if (pedeVisual(pergunta)) escrito = comoVisual(escrito);
  // o que a conferência aceita: o que foi lido, a pergunta, a conversa e o que se sabe do usuário
  const material = fontes.length ? `${fontes.map((f) => `${f.titulo} ${f.resumo} ${f.trechos.join(' ')}`).join(' ')} ${notas} ${vista}` : '';
  const extraDaConferencia = `${pergunta} ${ent.pergunta} ${conversa.map((m) => m.content).join(' ')} ${hoje} ${sobreOUsuario}`;
  let reescrita = null;
  // reescreve só pergunta que muda com o tempo: ali o que o modelo "sabe" envelheceu e o inventado
  // engana (18/10, eleição). No resto (fotossíntese: "ATP", "ciclo de Calvin") o saber do modelo vale,
  // e o que faltar nas fontes só ganha ⚠ nos números
  if (fontes.length && ent.atual && !deps.signal?.aborted) {
    const antes = conferirFatos(escrito, { material, extra: extraDaConferencia });
    if (precisaReescrever(antes)) {
      const semFonte = [...antes.nomes, ...antes.numeros];
      emit('aviso', { texto: `conferência: ${semFonte.length} dado(s) da resposta não aparecem nas fontes (${semFonte.slice(0, 8).join(', ')}) — reescrevendo sem eles` });
      emit('resposta-reinicia', { motivo: `conferindo os fatos: ${semFonte.length} dados não aparecem nas fontes — reescrevendo sem eles` });
      const nova = limparEscrita(
        await escrever(
          [...mensagens, { role: 'assistant', content: escrito }, { role: 'user', content: `Conferi sua resposta com as fontes: estes dados não aparecem em nenhuma delas: ${semFonte.slice(0, 20).join(', ')}. Reescreva a resposta inteira sem afirmar o que as fontes não trazem (se um deles for essencial, diga que as fontes não confirmam). Mantenha o resto, o formato e as citações [n]. Escreva só a nova resposta.` }],
          (pedaco) => emit('resposta-token', { pedaco })
        )
      );
      const depois = conferirFatos(nova, { material, extra: extraDaConferencia });
      const melhorou = nova.trim().length >= escrito.trim().length * 0.4 && depois.numeros.length + depois.nomes.length < semFonte.length;
      reescrita = { antes: semFonte.length, ficou: melhorou ? 'nova' : 'original' };
      if (melhorou) escrito = nova;
      else emit('resposta-reinicia', { motivo: 'a reescrita não ficou melhor — mantendo a primeira versão' });
    }
  }
  // só ficam na lista as fontes que a resposta citou (ou todas as usadas, se ela não citou nenhuma)
  const citadas = new Set([...String(escrito).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const lista = usadas.filter((f) => !citadas.size || citadas.has(f.n)).map(({ n, url, titulo, video, trechos }) => ({ n, url, titulo, ...(video ? { video: true, lido: trechos.length > 0 } : {}) }));
  // gráficos (18/10): validados e, com fontes, só com números que estão nelas; saem do texto
  // enquanto as conferências mexem nele (o ⚠ e o corte das citações quebrariam o JSON)
  // com fontes, o que a conferência aceita no gráfico: o lido, a pergunta e a conversa (os "dados acima")
  const materialDoGrafico = fontes.length ? `${material} ${extraDaConferencia}` : '';
  const pedido = pedeGrafico(pergunta);
  let graf = separarGraficos(escrito, { material: materialDoGrafico, pedido });
  if (graf.descartados.length) emit('aviso', { texto: `gráfico descartado: ${graf.descartados.join('; ')}` });
  // pediu gráfico e não veio nenhum válido: o código monta com a tabela ou a lista da resposta — ou,
  // em "monte um gráfico com os dados acima", com a da resposta anterior
  let notaDoGrafico = '';
  if (pedido && !graf.validos) {
    const montado = graficoDoTexto(graf.texto);
    const anterior = !montado && [...conversa].reverse().find((m) => m.role === 'assistant' && graficoDoTexto(m.content));
    let comGrafico = null;
    if (montado) {
      const linhas = graf.texto.split('\n');
      linhas.splice(montado.depoisDaLinha + 1, 0, '', montado.bloco, '');
      comGrafico = linhas.join('\n');
    } else if (anterior) {
      comGrafico = `${graf.texto.trim()}\n\nGráfico com os dados da resposta anterior:\n\n${graficoDoTexto(anterior.content).bloco}`;
    }
    if (comGrafico) {
      const novo = separarGraficos(recolocarGraficos(comGrafico, graf.graficos), { material: materialDoGrafico, pedido });
      if (novo.validos) {
        graf = novo;
        emit('aviso', { texto: `gráfico montado pelo código com a tabela/lista da ${montado ? 'resposta' : 'resposta anterior'}` });
      }
    }
    if (!graf.validos) notaDoGrafico = '\n\n*O gráfico pedido não foi montado: a resposta não trouxe números para ele.*';
  }
  // pedido com muitos pontos estimados: o gráfico fica, e a resposta diz quanto é estimativa
  if (pedido && graf.estimativas && graf.estimativas >= graf.pontos / 3) {
    notaDoGrafico += `\n\n*No gráfico, ${graf.estimativas} de ${graf.pontos} valores são estimativas (não aparecem nas fontes lidas): estão tracejados, vazados ou hachurados — passe o mouse para ver.*`;
  }
  escrito = `${graf.texto}${notaDoGrafico}`;
  // com pesquisa, os anos citados são conferidos contra tudo que foi lido (trechos, resumos e anotações)
  const conferido = fontes.length ? conferirAnos(String(escrito || '').trim(), { material, pergunta, hoje }) : { texto: String(escrito || '').trim(), faltam: [] };
  if (conferido.faltam.length) emit('aviso', { texto: `conferência: ano(s) sem fonte na resposta: ${conferido.faltam.join(', ')}` });
  if (fontes.length) {
    const r = conferirResposta(conferido.texto, { numeros: usadas.map((f) => f.n), material, produto: ent.produto });
    conferido.texto = r.texto;
    if (r.removidos.length) emit('aviso', { texto: `conferência: opções sem fonte: ${r.removidos.join(', ')}` });
    if (r.precosSemFonte.length) emit('aviso', { texto: `conferência: preços sem fonte: ${r.precosSemFonte.join(', ')}` });
    // os outros números (os anos e preços já foram) — o que sobrou sem fonte ganha ⚠
    const fatos = conferirFatos(conferido.texto, { material, extra: extraDaConferencia, semNumeros: QUESTAO_DE_EXATAS(String(pergunta || '')) });
    conferido.texto = fatos.numeros.length ? `${fatos.texto}\n\n*⚠ ${fatos.numeros.length === 1 ? 'Este número não aparece' : 'Estes números não aparecem'} nas fontes lidas: ${fatos.numeros.join(', ')}. Vale conferir.*` : fatos.texto;
    conferido.fatosSemFonte = [...fatos.nomes, ...fatos.numeros];
    if (reescrita) conferido.reescrita = { ...reescrita, depois: conferido.fatosSemFonte.length };
  }
  if (semVideos) emit('aviso', { texto: 'Para o AuGPT ver vídeos do YouTube, instale o yt-dlp em Ajustes → Componentes.' });
  // identificação só pela aparência: a resposta avisa, pelo código (16/10: a foto de um EPOS H6PRO
  // virou "o fone na imagem é o EPOS H3 Pro Hybrid", um irmão quase igual, dito como certo)
  // A certeza que o modelo declara não vale (ele disse "certo" para o modelo errado): produto
  // reconhecido por foto leva o aviso, a menos que o OCR leia o nome dele na imagem.
  const identificacao = (/^.*identifica[çc][ãa]o:.*$/im.exec(vista) || [''])[0];
  const ocrConfirma = imagens.some((i) => i.texto && (ent.assuntos || []).some((a) => tituloCita(i.texto, a)));
  const pelaAparencia = imagens.length > 0 && !ocrConfirma && (ent.produto || /prov[áa]vel|provavelmente|n[ãa]o d[áa] para saber|n[ãa]o identificado/i.test(identificacao));
  // a oferta da ação que ajudaria (uma só; não repete a que a resposta anterior já fez)
  const oferta = ent.sugerir && capacidades.ofertaDe(ent.sugerir);
  const jaOfereceu = oferta && conversa.slice(-4).some((m) => m.role === 'assistant' && String(m.content || '').includes(oferta.slice(0, 40)));
  if (oferta && !jaOfereceu) conferido.texto = `${conferido.texto.trim()}\n\n${oferta}`;
  const comGraficos = recolocarGraficos(conferido.texto, graf.graficos);
  const texto = pelaAparencia ? `*Pela foto, o modelo foi reconhecido pela aparência — o nome dele não está escrito na imagem, então pode ser outro parecido da mesma linha.*\n\n${comGraficos}` : comGraficos;
  return { vista, texto, fontes: lista, entendimento: ent, buscou: fontes.length > 0, produto: ent.produto, assuntos: ent.assuntos || [], modo: modoUsado, anosSemFonte: conferido.faltam, fatosSemFonte: conferido.fatosSemFonte || [], reescrita: conferido.reescrita || null };
}

module.exports = { comCredibilidade, listaParaOModelo, pedeVisual, comoVisual, conferirFatos, precisaReescrever, assuntoConcreto, regrasDoModo, conferirEntendimento, semImagens, blocoDeFontes, temPistaDeProduto, conferirResposta, listaDeBuscas, MODOS, podeFicarSemBusca, pedeImagem, lerPrompt, lerRevisao, pedidoDeVisao, responder, pesquisar, materialDaEscrita, conferirAnos, pedidoDeEntendimento, lerEntendimento, sistemaDoPesquisador, sistemaDoEscritor, FERRAMENTAS, FERRAMENTAS_DO_YOUTUBE, RODADAS };
