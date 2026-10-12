'use strict';

/**
 * Tipo de pedido (revisão v3, Fase 1 — chats reais de 29/09).
 *
 * Antes havia uma pergunta só: "é recomendação de produto?", respondida por
 * palavra ("melhor", "top", "diferença entre"). "As melhores TÁTICAS de PUBG"
 * entrou no motor de produto e saiu recomendando um Core i7 10700F; "por que
 * o Gojo usa venda?" e "um tutorial de planejamento tático" caíram no laço
 * genérico com plano de 8 passos, crítico a cada passo e vetos.
 *
 * Aqui o OBJETO do pedido decide, só por regra de código (o 7B classifica
 * diferente a cada execução):
 *
 *   'local'      — arquivos, pastas, documentos, gerar arquivo: o laço de sempre
 *   'produto'    — o objeto é algo que se compra/escolhe (fone, placa, mouse,
 *                  modelo com número, "comprar", "preço") ou um item de
 *                  catálogo (jogos, filmes, livros…) num pedido de escolha:
 *                  motor de pesquisa (recomendação, desempenho, uso pro)
 *   'guia'       — táticas, estratégias, dicas, tutorial, como melhorar:
 *                  pesquisa de guia (comunidade + profissionais), sem produto
 *   'explicacao' — por que, como funciona, o que é, diferença entre conceitos:
 *                  poucas buscas, sem plano, sem checklist, sem crítico periódico
 *   'livre'      — o resto: o laço de sempre
 */

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// coisa que se compra / escolhe por especificação
const OBJETO_PRODUTO = new RegExp(
  '\\b(' +
    [
      'fones?', 'headsets?', 'headphones?', 'iems?', 'intra ?auricular(es)?', 'in ?ear', 'earbuds?', 'tws',
      'placas? de video', 'placas? graficas?', 'gpus?', 'rtx', 'gtx', 'radeon', 'geforce',
      'processador(es)?', 'cpus?', 'ryzen', 'core i[3579]', 'intel', 'placas? mae',
      'monitor(es)?', 'mouses?', 'mousepads?', 'teclados?', 'notebooks?', 'laptops?', 'cadeiras?',
      'celular(es)?', 'smartphones?', 'iphones?', 'galaxy', 'tablets?', 'ssds?', 'hds?', 'nvme', 'memorias? ram', 'pentes? de memoria',
      'fontes? de alimentacao', 'gabinetes?', 'coolers?', 'water ?cooler', 'microfones?', 'webcams?',
      'tvs?', 'televis\\w+', 'smart ?tv', 'controles?', 'joysticks?', 'consoles?', 'playstation', 'ps[45]', 'xbox', 'nintendo switch',
      'caixas? de som', 'soundbars?', 'roteador(es)?', 'impressoras?', 'smartwatch\\w*', 'relogios?',
      'cameras?', 'lentes?', 'drones?', 'carros?', 'motos?', 'bicicletas?', 'pneus?', 'tenis', 'colchao', 'colchoes',
      'geladeiras?', 'notebook gamer', 'pc gamer', 'setup', 'perifericos?', 'equipamentos?', 'gear', 'placas?', 'hd externo',
    ].join('|') +
    ')\\b'
);
// item de catálogo: escolha entre títulos/serviços, não entre especificações
const OBJETO_DE_CATALOGO =
  /\b(jogos?|games?|filmes?|series|animes?|mangas?|livros?|apps?|aplicativos?|programas?|softwares?|sites?|cursos?|faculdades?|linguagens? de programacao|frameworks?|bibliotecas?|planos? de (celular|internet|saude)|operadoras?|bancos?|cartoes? de credito|corretoras?|editores? de (video|texto|codigo)|ides?|navegador(es)?|distros?|distribuicoes linux|vpns?|hospedagens?)\b/;
const COMPRA = /\b(escolher|comprar|compra|preco|precos|custa|custo ?beneficio|vale a pena|onde comprar|loja|lojas|ate r ?\d|r \d|orcamento de|modelo|modelos|marca|marcas|ficha tecnica|especificac\w+|benchmark|fps em|desempenho d[aoe])\b/;
// modelo com número COLADO ("em6l", "g502", "x-15", "5070 ti"). Achado do
// revisor: "[a-z]+ ?\d+" pegava "top 10", "em 2026", "windows 11" e jogava
// "top 10 táticas de CS2" no motor de produto. Ano (19xx/20xx) não é modelo.
const NOME_DE_MODELO = /\b(?!(?:top|em|de|no|na|os|as|ate)\d)[a-z]{1,4}-?(?!(?:19|20)\d\d\b)\d{2,5}[a-z]{0,3}\b|\b\d{3,5}\s?(ti|super|xt|xtx)\b/;
const GATILHO_DE_ESCOLHA = /\b(melhor(?:es)?(?! (?:forma|formas|maneira|maneiras|jeito|jeitos|modo|hora|momento|epoca|horario|caminho)\b)|top \d+|qual (comprar|escolher|pegar)|recomend\w*|indica\w*|compar\w*|versus|vs|opcoes|alternativas|diferenca\w* (de desempenho )?entre|mais usad\w*)\b/;

// táticas, estratégias, dicas, tutorial — sempre guia
const GUIA_FORTE = new RegExp(
  '\\b(' +
    [
      'taticas?', 'tatico', 'estrategias?', 'estrategico', 'dicas?', 'tutorial', 'tutoriais', 'guia', 'guias', 'passo a passo',
      'macetes?', 'truques?', 'rotacao', 'rotacoes', 'rotacionar', 'movimentacao', 'planejamento tatico',
      'gamesense', 'game sense', 'controle de recoil', 'controlar o recoil', 'cenario competitivo',
      'o que (os|as) (pros?|profissionais|jogadores profissionais) fazem', 'extrair dos profissionais', 'aprender com (os )?profissionais',
    ].join('|') +
    ')\\b'
);
// "como melhorar", "aprender a", "melhor forma de" — guia só com contexto de
// jogo ("como melhorar no PUBG"); "como melhorar meu código" fica no laço
const GUIA_FRACO = new RegExp(
  '\\b(' +
    [
      'como melhorar', 'melhorar (meu|minha|no|na|em|o|a)', 'como jogar', 'como ganhar', 'como vencer', 'como evoluir', 'como treinar',
      'como ficar (bom|melhor)', 'como subir', 'como aprender', 'aprender a', 'treinar', 'treino', 'rotina de treino', 'mecanicas?',
      'posicionamento', 'jogar melhor', 'melhor(es)? (forma|formas|maneira|maneiras|jeito|jeitos|modo) de',
    ].join('|') +
    ')\\b'
);
const CONTEXTO_DE_JOGO =
  /\b(jogo|jogos|game|games|partida|partidas|ranked|rankeada|competitivo|e ?sports?|pubg|cs ?2|counter ?strike|valorant|warzone|apex|fortnite|league of legends|lol|dota|overwatch|free ?fire|minecraft|gta|rainbow six|r6|tarkov|rocket league|fps|battle ?royale|moba|mmo|rpg)\b/;

// Achado do revisor: "como melhorar o fps do meu jogo godot", "tutorial de
// react", "estratégias de cache em redis", "escreva um tutorial de git" viravam
// guia (pesquisa de dicas de JOGADOR no Reddit). Pedido de desenvolvimento,
// de código ou que manda CRIAR algo não é guia nem explicação: é o laço.
const DESENVOLVIMENTO =
  /\b(meu jogo|minha jogo|meu game|o jogo que (eu )?estou (fazendo|desenvolvendo|criando)|codigo|programar|programacao|programa em|script|funcao|bug|erro de|compilar|unity|godot|unreal|pygame|python|javascript|typescript|js|html|css|react|vue|angular|node|nodejs|api|apis|rest|git|github|sql|banco de dados|java|c\+\+|c#|rust|golang|django|flask|docker|kubernetes|redis|linux|bash|powershell|markdown|regex|algoritmo|framework)\b/;
const VERBO_DE_CRIAR = /\b(crie|criar|escreva|escrever|implemente|implementar|corrija|corrigir|faca um|faca uma|desenvolva|desenvolver|gere|gerar|monte um|monte uma|programe|refatore|adicione)\b/;
const DINHEIRO = /\b(dinheiro|investimento\w*|investir|renda|lucro|ganhar grana)\b/;

// por que / como funciona / o que é / diferença entre conceitos
const PREFIXO_CORTES = /^(voce sabe|vc sabe|sabe me dizer|me diga|me diz|me explica|me explique|gostaria de saber|queria saber|quero saber|preciso saber|pode me dizer|poderia me dizer|tenho uma duvida|uma duvida)\s+/;
const EXPLICACAO_NO_INICIO =
  /^(por que|porque|pq|por qual motivo|qual (o|a|e o|e a) (motivo|razao|origem|historia|significado)|como funciona|como funcionam|o que (e|sao)(?! (o |a )?melhor)|o que (significa|foi|aconteceu|acontece|causa)|quem (e|foi|sao|eram)|explique|explica|qual a diferenca entre|diferenca entre|quando (foi|e|surgiu|comecou)|de onde vem|para que serve|pra que serve)\b/;
const EXPLICACAO_EM_QUALQUER_LUGAR = /\b(por que|por qual motivo|como funciona|o que (e|sao)(?! (o |a )?melhor)|o que significa|qual a diferenca entre|para que serve|pra que serve)\b/;
// 300 execuções reais (11/10): "Como um gerador funciona ?" (sujeito no meio),
// "como que o acidente de Chernobyl aconteceu?", "Me conte mais sobre o SR-71"
// e "se um avião perder os motores, o que acontece?" caíam em 'livre' e
// gastavam o laço inteiro (204 s, 14 passos) numa pergunta de enciclopédia.
const EXPLICACAO_COM_SUJEITO =
  /^como (que )?(\S+ ){1,7}?(funciona|funcionam|aconteceu|acontece|ocorreu|ocorre|surgiu|surgiram|se forma|se formam|se formou|se formaram|(e|sao|foi|foram) (feit|criad|inventad|construid|fabricad|produzid|formad|montad)[oa]s?)\b|^(me )?(conte|conta|fale|fala|explique|explica)( me)?( um pouco)?( mais)? (sobre|como|o que|por que)\b|\bo que (acontece|aconteceria)\b/;

// arquivos, pastas, documentos, gerar arquivo. Achado do revisor: "salve!
// qual o melhor mouse", "notebook pra trabalhar com planilha", "ssd pra
// guardar arquivos" viravam 'local' e saíam do motor. Agora precisa do
// arquivo COMO OBJETO da ação (ou extensão, anexo, pasta de trabalho).
const LOCAL =
  /\b(minha pasta|pasta de trabalho|workspace|anexei|em anexo|no anexo|o anexo|enviei|que te mandei|(leia|resuma|abra|analise|edite|corrija|revise|traduza|converta|compare) (o|a|os|as|este|esta|esse|essa|meu|minha|meus|minhas) (arquivo|arquivos|documento|documentos|pdf|planilha|planilhas|relatorio|pasta|texto anexado)|(crie|gere|gerar|salve|salvar|exporte|exportar|escreva|monte) (um|uma|o|a|em|no|na|como)\s+(arquivo|planilha|pdf|docx|documento|relatorio|tabela em excel|apresentacao|csv)|\w+\.(pdf|docx?|xlsx?|csv|txt|md|json|pptx?|html|js|py))\b/;

// "…e gere uma planilha com o comparativo", "salve em um pdf": o arquivo como saída do pedido
const SAIDA_EM_ARQUIVO =
  /(?:\b(?:e|depois|entao|,)\s+)?\b(?:crie|gere|gerar|salve|salvar|exporte|exportar|escreva|monte|faca|coloque|ponha|me de|me entregue)\b(?: (?:isso|tudo|o resultado|a resposta|o comparativo))?(?: (?:um|uma|o|a|em|no|na|como|numa|num))+\s+(?:arquivo|planilha|pdf|docx|documento|relatorio|tabela em excel|apresentacao|csv)\b(?: (?:com|de|do|da|em|para|sobre) [^,.;?!]*)?/;

/**
 * { tipo, motivo } — só regra de código. `objetivo` já deve vir com o
 * assunto da conversa resolvido (Fase 2: "dentro do jogo" → "(PUBG, PC)").
 */
// "diferença entre o KZ EDX Pro e o Truthear Hexa": nomes próprios depois
// do "entre" (no texto ORIGINAL, com maiúsculas) = comparação de opções;
// "diferença entre vírus e bactéria" = conceito
function nomesDepoisDoEntre(original) {
  const depois = /\bentre\b([\s\S]{0,120})/i.exec(String(original || ''))?.[1] || '';
  // grupos de palavras seguidas com maiúscula ou número: "KZ EDX Pro", "Truthear Hexa"
  const grupos = depois.match(/(?:\b(?:[A-Z][A-Za-z0-9-]*|\d+[A-Za-z0-9-]*)\b\s*){1,4}/g) || [];
  // sigla solta ("TCP e UDP") é conceito; nome de produto tem 2+ palavras ou número
  const deProduto = grupos.filter((g) => g.trim().split(/\s+/).length >= 2 || /\d/.test(g));
  return grupos.length >= 2 && deProduto.length >= 1 ? grupos.length : 0;
}

/**
 * Revisão v4 (07/10, Simgot EM6L × SuperMix 4): o usuário escreve o nome do
 * produto entre parênteses ou aspas — "(Simgot EM6L e Simgot SuperMix 4)",
 * "'bose qc 20'", "(Kinera Celest Sol Headphone 1DD+1BC)". O extrator antigo
 * só pegava modelo no padrão "RTX 5070 Ti" (número de 2+ dígitos) e perdia
 * os dois Simgot: o motor foi descobrir "melhores fones pra PUBG" e
 * recomendou headsets que ninguém perguntou.
 */
// preço, unidade, porta, observação: "(até R$ 300)", "(128 GB)", "(Obs: precisa ter 16GB)"
const NAO_E_PRODUTO =
  /^(ate|até|obs|ex|exemplo|tipo|ou seja|por exemplo|mais ou menos|cerca de|uns|umas|max|min)\b|(r\$|us\$|\$|€|\breais\b|\bdolares\b|\b\d+\s?(gb|tb|mb|hz|khz|mhz|ghz|ohms?|ω|mm|cm|m|pol|polegadas?|w|mah|v|fps|ms|db|k)\b)/i;
const NAO_E_NOME = /\b(eu|voce|vc|jogo|jogar|tenho|uso|usar|meu|minha|que|para|pra|com|quando|porque|como|nao|sim|esse|essa|isso|fontes?)\b/i;
function produtosNomeados(objetivo) {
  const texto = String(objetivo || '');
  const credenciais = /\b(login|senha|password|usuario|usuário|matr[ií]cula|cpf|token|pin)\b/i;
  const nomes = new Map();
  for (const m of texto.matchAll(/\(([^()]{3,140})\)|["“'‘]([^"“”'‘’]{3,90})["”'’]/g)) {
    const trecho = (m[1] || m[2] || '').trim();
    const antes = texto.slice(Math.max(0, m.index - 25), m.index);
    if (/https?:|www\./i.test(trecho) || credenciais.test(antes)) continue;
    // (avaliação dos decisores, 08/10) a reescrita do pedido acrescenta
    // "(especificamente: …)" — isso não é nome de produto; nem "Questão 1
    // (Teoria da Complexidade)", que é o assunto de uma questão de prova
    if (/^\s*[\wÀ-ÿ ]{0,20}:/.test(trecho) || /\b(quest[aã]o|pergunta)\s*\d+\s*$/i.test(antes)) continue;
    // sem dígito no nome, só vale logo depois de um substantivo de produto
    // ("esse fone (Bose Noise Cancelling Wired Earbuds)")
    const depoisDeProduto = OBJETO_PRODUTO.test(normalizar(texto.slice(Math.max(0, m.index - 40), m.index)));
    for (let parte of trecho.split(/\s*(?:,|;|\/|\be\b|\bou\b|\bvs\.?|\bversus\b)\s*/i)) {
      parte = parte.trim().replace(/^(o|a|os|as|do|da|de|um|uma)\s+/i, '').replace(/[.?!]+$/, '');
      if (parte.length < 3 || parte.length > 60 || parte.split(/\s+/).length > 8) continue;
      if (/^\d+$/.test(parte) || NAO_E_NOME.test(normalizar(parte)) || NAO_E_PRODUTO.test(normalizar(parte))) continue;
      // nome próprio (maiúscula) ou modelo (dígito): "contracheque", "download pdf" não
      if (!/[A-Z]/.test(parte) && !/\d/.test(parte)) continue;
      // 2ª revisão: uma palavra só sem dígito ("Bluetooth", "USB-C") é característica, não modelo
      const palavras = parte.split(/\s+/);
      if (palavras.length === 1 && !/\d/.test(parte)) continue;
      if (!/\d/.test(parte) && !depoisDeProduto) continue;
      // jogo/plataforma entre parênteses ("PUBG Mobile", "PC") é contexto, não produto
      if (CONTEXTO_DE_JOGO.test(normalizar(parte)) || /\b(pc|mobile|xbox|ps[45]|playstation|android|ios|windows|linux|mac)\b/i.test(parte)) continue;
      const chave = normalizar(parte);
      if (!nomes.has(chave)) nomes.set(chave, parte);
    }
  }
  return [...nomes.values()].slice(0, 4);
}
// pergunta que AVALIA ou COMPARA o(s) produto(s) nomeado(s)
const AVALIA_NOMEADO =
  /\b(e bo[am]|sao bo[an]s|serve|servem|presta|vale a pena|compensa|se saira|se sai|se sairia|recomend\w*|indic\w*|melhor|dentre|entre esses|entre essas|qual (desses|dessas|deles|delas))\b/;

const ENDERECO = /\bhttps?:\/\/[^\s)'"]+|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
// 2ª revisão: só IMPERATIVO dirigido ao agente — "Resuma … notas fiscais
// emitidas", "o que … diz sobre login com OAuth", "o preço baixa quando?" são leitura
const ACAO_NO_SITE =
  /\b(entre com|entra com|fa[cç]a (o )?login|realize o login|logue|loga|cliqu[ei]|preencha|baixe|fa[cç]a (o )?download|emita|selecione|cadastre|envie o formulario)\b|\b(login|senha) (e|eh|:)/;
// ("acesse o site e resuma" é leitura: só "acesse" não basta)

function tipoDoPedido(objetivo) {
  let t = normalizar(objetivo);
  if (!t) return { tipo: 'livre', motivo: 'pedido vazio' };
  t = t.replace(PREFIXO_CORTES, '');

  if (LOCAL.test(t)) {
    // 12/10: "Compare 3 IEMs para FPS e gere uma planilha com o comparativo"
    // virava 'local' por causa da planilha, ia para o laço comum e a busca
    // solta por "IEMs FPS" trouxe uma faculdade. Quando o arquivo é só a
    // SAÍDA e o resto é escolha ou comparação de produto (ou guia), o pedido
    // é do motor de pesquisa; o arquivo é gerado no fim.
    const semSaida = t.replace(SAIDA_EM_ARQUIVO, ' ').replace(/\s+/g, ' ').trim();
    if (semSaida && semSaida !== t && !LOCAL.test(semSaida)) {
      const resto = tipoDoPedido(semSaida);
      if (resto.tipo === 'produto' || resto.tipo === 'guia') return { ...resto, motivo: `${resto.motivo} (com arquivo de saída)` };
    }
    return { tipo: 'local', motivo: 'fala de arquivo, pasta ou documento' };
  }
  // Revisão v4 (contracheque real): endereço + ação na página = agir no site
  // pelo navegador (antes caía em 'livre' e o 7B começava "pesquisando o site")
  if (ENDERECO.test(String(objetivo)) && ACAO_NO_SITE.test(t)) return { tipo: 'site', motivo: 'agir num site (login, clique, formulário, download)' };

  // questão de prova ("Questão 1 (…)", "Pergunta 1 … a. … b. …") é tarefa:
  // a avaliação dos decisores mostrou 12 delas caindo em "produto"
  if (/^\s*(?:resolva\s+\S+\s+\S+\s*:?\s*)?(?:quest[aã]o|pergunta)\s*\d/.test(t) || /\bquest[aã]o\s*1\b.*\bquest[aã]o\s*2\b/.test(t) || /(^|\s)a[.)]\s.+\sb[.)]\s.+\sc[.)]\s/.test(t)) {
    return { tipo: 'livre', motivo: 'questões de prova' };
  }
  const produto = OBJETO_PRODUTO.test(t) || NOME_DE_MODELO.test(t);
  // revisão v4: produto nomeado (parênteses/aspas) + pergunta que avalia/compara
  if (produto && AVALIA_NOMEADO.test(t) && produtosNomeados(objetivo).length) {
    return { tipo: 'produto', motivo: 'avaliar ou comparar produto nomeado' };
  }
  const catalogo = OBJETO_DE_CATALOGO.test(t);
  const escolha = GATILHO_DE_ESCOLHA.test(t);
  const compra = COMPRA.test(t);
  const dev = DESENVOLVIMENTO.test(t) || VERBO_DE_CRIAR.test(t);
  const guia = !dev && !DINHEIRO.test(t) && (GUIA_FORTE.test(t) || (GUIA_FRACO.test(t) && CONTEXTO_DE_JOGO.test(t)));
  // explicação: a pergunta no começo, ou no meio só sem pedido de criar/código
  // ("crie um programa que mostre como funciona o bubble sort" é tarefa)
  const explicacao = EXPLICACAO_NO_INICIO.test(t) || EXPLICACAO_COM_SUJEITO.test(t) || (!dev && EXPLICACAO_EM_QUALQUER_LUGAR.test(t));

  // guia vence quando o objeto é a técnica, não o equipamento: "melhores
  // táticas de PUBG" (nenhum produto) é guia; "melhor mouse pra controlar
  // o recoil" (produto + escolha) é produto
  if (produto && (escolha || compra)) return { tipo: 'produto', motivo: 'escolha/compra de produto' };
  if (guia) return { tipo: 'guia', motivo: 'tática, estratégia, dica ou tutorial' };
  // "compare o KZ EDX Pro e o Truthear Hexa": comparação de itens nomeados (sem número no nome)
  if (/\b(compar\w*|versus|vs)\b/.test(t) && !explicacao) return { tipo: 'produto', motivo: 'comparação de opções' };
  if (catalogo && escolha) return { tipo: 'produto', motivo: 'escolha entre itens de catálogo' };
  if (explicacao && /\bdiferenca\w* entre\b/.test(t) && nomesDepoisDoEntre(objetivo) >= 2) return { tipo: 'produto', motivo: 'diferença entre opções nomeadas' };
  // explicação que também pede escrever/criar ("o que é buffer overflow? escreva
  // um relatório em pdf") é tarefa: laço normal, com plano
  if (explicacao && !dev) return { tipo: 'explicacao', motivo: 'por que / como funciona / o que é' };
  // escolha sem objeto reconhecido ("o que é melhor: X ou Y?", "top 5 de…"): fica
  // com o motor, como antes — só técnica (guia) e conceito (explicação) saem dele
  if (escolha) return { tipo: 'produto', motivo: 'escolha entre opções' };
  if (produto && /\b(qual|quais)\b/.test(t)) return { tipo: 'produto', motivo: 'pergunta sobre produto' };
  return { tipo: 'livre', motivo: 'nenhuma regra específica' };
}

/** O motor de pesquisa planejada atende este tipo? */
const tipoDoMotor = (tipo) => tipo === 'produto' || tipo === 'guia';

module.exports = { tipoDoPedido, tipoDoMotor, produtosNomeados, normalizarPedido: normalizar, OBJETO_PRODUTO, OBJETO_DE_CATALOGO };
