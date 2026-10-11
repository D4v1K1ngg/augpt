'use strict';

/**
 * Verificador de evidências.
 *
 * Confere se os números e datas da resposta aparecem no material coletado.
 * A parte difícil não é comparar — é NORMALIZAR: a fonte traz "410,49" e o
 * modelo escreve "R$ 410,49"; a fonte traz "17/08/2026" e ele escreve
 * "17 de agosto". Comparação literal marcaria resposta correta como inventada,
 * e um verificador que grita errado é pior que nenhum.
 *
 * O resultado é SUSPEITA, nunca veredicto. Nada é apagado da resposta:
 * remover uma frase do meio de um texto gerado deixa referência solta, e se o
 * verificador errou, apagou informação correta sem o usuário saber.
 */

const MESES = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, março: 3, marco: 3, mar: 3, abril: 4, abr: 4,
  maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
  setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

const normalizar = (t) =>
  String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* ------------------------------ números ------------------------------ */

/**
 * Converte a grafia para um número. Trata os dois padrões de separador:
 * 1.240,50 (pt-BR) e 1,240.50 (en). Devolve null quando não é número.
 */
function paraNumero(bruto) {
  // pontuação da frase costuma vir grudada ("410,49," no fim da oração) e
  // transformava o número em NaN — sumindo do universo de conferência
  let texto = String(bruto).replace(/[\s\u00a0]/g, '').replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (!texto) return null;
  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    // o último separador que aparece é o decimal
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (temVirgula) {
    // vírgula é decimal, a menos que separe grupos de três (1,240)
    texto = /,\d{3}(\D|$)/.test(texto) && !/,\d{1,2}$/.test(texto)
      ? texto.replace(/,/g, '')
      : texto.replace(',', '.');
  } else if (temPonto && /\.\d{3}(\D|$)/.test(texto) && !/\.\d{1,2}$/.test(texto)) {
    texto = texto.replace(/\./g, ''); // 1.240 é mil duzentos e quarenta
  }

  const valor = Number(texto);
  return Number.isFinite(valor) ? valor : null;
}

/** Números com peso informativo: valores, percentuais, medidas, quantidades. */
function extrairNumeros(texto) {
  const achados = [];
  const limpo = String(texto)
    .replace(/```[\s\S]*?```/g, ' ') // blocos de código não são afirmação
    .replace(/^\s*\|[\s:|-]+\|\s*$/gm, ' '); // separador de tabela

  const re = /(-?\d[\d.,]*)\s*(%|°c?|km\/h|km|kg|mm|cm|m²|mb|gb|tb|hz|w|r\$|us\$|reais|mil|milhões|milhoes|bilhões|bilhoes)?/gi;
  let m;
  while ((m = re.exec(limpo))) {
    const valor = paraNumero(m[1]);
    if (valor === null) continue;

    const unidade = (m[2] || '').toLowerCase();
    const anterior = limpo.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    const moedaAntes = /r\$|us\$|€|\$/.test(anterior);

    // Bug real de produção: `[\d.,]*` é guloso e engole um ponto/vírgula que
    // vem GRUDADO no número mas não é separador nenhum — o caso mais comum é
    // item de lista markdown ("1. Questão 1", "2. Questão 2"...), onde o "."
    // vem do próprio marcador de lista, não do número. Checar `.includes('.')`
    // no m[1] CRU (como era antes) contava esse ponto como se fosse separador
    // decimal, e a lista inteira de 1 a N virava N "afirmações numéricas sem
    // respaldo" — sobretudo agora que o redator é instruído a numerar cada
    // resposta de um pedido com várias perguntas (ver perguntasMultiplas).
    // Aparado das bordas primeiro: só um separador de fato NO MEIO do número
    // (ex.: "1.240", "410,49") deve contar — um ponto/vírgula solto na ponta
    // é pontuação de fora, não parte do número.
    const semBordas = String(m[1]).replace(/^[.,]+/, '').replace(/[.,]+$/, '');

    // descarta ruído: numeração de lista, contagem de passo, número isolado pequeno
    const relevante =
      unidade || moedaAntes || Math.abs(valor) >= 100 || semBordas.includes(',') || semBordas.includes('.');
    if (!relevante) continue;

    achados.push({
      texto: (moedaAntes ? 'R$ ' : '') + String(m[1]).replace(/[.,]+$/, '') + (unidade ? m[2] : ''),
      valor,
      unidade: unidade.replace('r$', '').replace('us$', ''),
    });
  }
  return achados;
}

/** Confere com tolerância a arredondamento e a formatação de milhar. */
function numeroPresente(alvo, universo) {
  for (const candidato of universo) {
    if (candidato === alvo) return true;
    const tolerancia = Math.max(Math.abs(alvo) * 0.005, 0.01); // 0,5%
    if (Math.abs(candidato - alvo) <= tolerancia) return true;
    // 1.240 escrito como 1240,00 e vice-versa
    if (Math.round(candidato) === Math.round(alvo)) return true;
  }
  return false;
}

/* ------------------------------ datas ------------------------------ */

function extrairDatas(texto) {
  const achadas = new Set();
  const limpo = normalizar(texto);

  for (const m of limpo.matchAll(/\b(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?\b/g)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia > 31 || mes > 12 || mes < 1) continue;
    achadas.add(`${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
  }

  for (const m of limpo.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    achadas.add(`${m[2]}-${m[3]}`);
  }

  const nomes = Object.keys(MESES).join('|');
  for (const m of limpo.matchAll(new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${nomes})\\b`, 'g'))) {
    achadas.add(`${String(MESES[m[2]]).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`);
  }

  return achadas;
}

/**
 * Há quantos dias é a data mais recente encontrada no texto — diferente de
 * extrairDatas (que descarta o ano de propósito, pra comparar dia-a-dia sem
 * ambiguidade de fabricação): aqui o ano importa, porque o objetivo é medir
 * IDADE, não cruzar contra a resposta.
 *
 * Caso real de produção (2026-09-14, cotação de dólar): o material coletado
 * só tinha uma cotação de "29/06/2026" — quase 2,5 meses antes de hoje
 * (14/09/2026) — e a resposta final apresentou esse valor como "a cotação
 * atual", sem nenhuma ressalva de que era velho. Nem número nem data
 * inventados (o dado É real, está no material) — o problema é apresentar
 * dado velho como se fosse de agora, algo que `verificar()` não detecta
 * porque não é fabricação.
 *
 * Datas no FUTURO em relação a `agora` são ignoradas — não servem pra medir
 * "quão velho" o material é (e mais provável ser ruído de outro tipo de
 * número do que uma data real de fonte).
 */
function diasDesdeDataMaisRecente(texto, agora = new Date()) {
  let maisRecente = null;
  const limpo = normalizar(texto);

  const considerar = (dia, mes, ano) => {
    if (dia > 31 || dia < 1 || mes > 12 || mes < 1) return;
    const data = new Date(ano, mes - 1, dia);
    if (Number.isNaN(data.getTime()) || data > agora) return;
    if (!maisRecente || data > maisRecente) maisRecente = data;
  };

  for (const m of limpo.matchAll(/\b(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})\b/g)) {
    considerar(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  for (const m of limpo.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    considerar(Number(m[3]), Number(m[2]), Number(m[1]));
  }
  const nomes = Object.keys(MESES).join('|');
  for (const m of limpo.matchAll(new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${nomes})\\s*(?:de\\s+)?(\\d{4})\\b`, 'g'))) {
    considerar(Number(m[1]), MESES[m[2]], Number(m[3]));
  }

  if (!maisRecente) return null;
  const dias = Math.round((agora - maisRecente) / 86400000);
  return dias > 0 ? dias : null; // hoje mesmo (0 dias) não é "desatualizado", nada a avisar
}

/* ------------------------------ o pedido foi respondido? ------------------------------ */

const VAZIAS = new Set([
  'para', 'como', 'qual', 'quais', 'quem', 'onde', 'quando', 'sobre', 'esse', 'essa', 'este',
  'esta', 'isso', 'pode', 'consegue', 'fazer', 'quero', 'preciso', 'conte', 'fale', 'diga',
  'mostre', 'liste', 'explique', 'analise', 'analisar', 'detalhes', 'informacoes', 'arquivo',
  'documento', 'anexo', 'anexado', 'nesta', 'neste', 'semana', 'dias', 'hoje', 'mais', 'menos',
]);

function termosPrincipais(texto) {
  return [
    ...new Set(
      normalizar(texto)
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length > 3 && !VAZIAS.has(p))
    ),
  ];
}

/* ------------------------------ entidades nomeadas ------------------------------ */

/**
 * Números e datas não cobrem o tipo de fabricação mais comum em texto livre:
 * um nome próprio inventado. Caso real de produção: pedida uma análise
 * política do Brasil 2000-2026, o material coletado cobriu só a eleição de
 * 2010 e uma página sobre Ciro Gomes — e a resposta afirmou "as eleições de
 * 2022 resultaram em uma vitória surpreendente para Jair Bolsonaro" (que na
 * verdade PERDEU aquela eleição). Nem número, nem data: passou batido com
 * "totalSuspeitas": 0, "aprovado": true.
 *
 * Mesma lógica dos números — não é sobre estar certo ou errado, é sobre
 * estar no material coletado ou não. E o mesmo cuidado: uma palavra
 * capitalizada sozinha é ruído demais (início de frase, título de seção) pra
 * valer como "nome próprio" — exige-se uma SEQUÊNCIA de 2+ palavras
 * capitalizadas (ou siglas), com no máximo uma preposição minúscula entre
 * elas ("Partido da República", "Fernando Henrique Cardoso"). "e" fica de
 * fora dos conectores de propósito: "Fernando Henrique Cardoso e Lula"
 * grudaria dois nomes DIFERENTES numa frase só, e aí nem um nem outro bate
 * no material mesmo que os dois, separados, batessem.
 */
const CAP = 'A-ZÀ-ÖØ-Þ';
const BAIXA = 'a-zà-öø-ÿ';
const PALAVRA_CAP = `[${CAP}][${BAIXA}]{2,}`; // palavra capitalizada, 3+ letras
// STF, PT, PIB — maiúscula sem minúscula colada. O "s?" antes do lookahead é
// o plural comum de sigla ("LMGs", "ONGs"): sem ele, "LMGs" batia só "LM"
// (backtrack por causa do 's' minúsculo logo depois de "LMG") — sigla real
// virando truncada e esquisita na suspeita.
const SIGLA = `[${CAP}]{2,6}s?(?![${BAIXA}])`;
const TOKEN_ENTIDADE = `(?:${PALAVRA_CAP}|${SIGLA})`;
const CONECTOR_ENTIDADE = '(?:de|da|do|dos|das|em|no|na|à|ao|aos)'; // sem "e": junta nomes diferentes, não partes de um nome

function extrairEntidades(texto) {
  const limpo = String(texto)
    .replace(/```[\s\S]*?```/g, ' ') // bloco de código não é afirmação
    .replace(/^#{1,6}\s.*$/gm, ' ') // título markdown é formatação, não fato
    .replace(/\*\*[^*\n]+:\*\*/g, ' '); // rótulo em negrito ("**Crise:**") é estrutura, não afirmação

  const re = new RegExp(`${TOKEN_ENTIDADE}(?:\\s+(?:${CONECTOR_ENTIDADE}\\s+)?${TOKEN_ENTIDADE})+`, 'g');
  const achadas = new Set();
  let m;
  while ((m = re.exec(limpo))) {
    const bruta = m[0].replace(/\s+/g, ' ').trim();
    // frase longa demais não é nome próprio, é ruído de maiúsculas em
    // sequência (ex.: título em Title Case que escapou da limpeza acima)
    if (bruta.split(' ').length > 6) continue;
    achadas.add(bruta);
  }
  return [...achadas];
}

/** Confere com tolerância a maiúscula/acento — não a ordem das palavras. */
function entidadePresente(entidade, materialNormalizado) {
  return materialNormalizado.includes(normalizar(entidade));
}

/* ------------------------------ bifurcação de interpretação ------------------------------ */

/**
 * Rede de segurança determinística para o crítico de interpretação
 * (`decidirInterpretacao`, `loop.js`): o modelo às vezes marca "bifurcação"
 * em pedidos que já eram específicos, só reformulando a mesma coisa em duas
 * frases parecidas — caso real: "procure os melhores preços da RTX 5080"
 * virou "(especificamente: buscar os melhores preços online)", quando não
 * havia leitura nenhuma pra escolher. Uma bifurcação de verdade (ex.:
 * desempenho técnico vs. habilidade de jogo do PUBG) tem pouca sobreposição
 * de vocabulário entre as duas opções — são buscas por coisas diferentes.
 * Duas reformulações da mesma coisa compartilham a maior parte das palavras.
 * Sem chamada a mais: é comparação de termos, mesma técnica de
 * `termosPrincipais` já usada pra cobertura.
 */
function pareceParafrase(a, b) {
  const ta = termosPrincipais(a);
  const tb = termosPrincipais(b);
  if (!ta.length || !tb.length) return false; // sem termo suficiente pra comparar, não arrisca descartar
  const conjB = new Set(tb);
  const compartilhados = ta.filter((t) => conjB.has(t)).length;
  const menor = Math.min(ta.length, tb.length);
  return compartilhados / menor >= 0.4;
}

/* ------------------------------ partes do pedido ------------------------------ */

/**
 * Um pedido costuma ter mais de uma pergunta dentro.
 *
 * "o valor, o vencimento e o que acontece se eu atrasar" são três coisas, e a
 * verificação antiga só media sobreposição de palavras no conjunto — uma
 * resposta que cobrisse duas de três passava. Aqui cada parte é conferida
 * sozinha, por regra, sem chamada ao modelo.
 */
// Cabeçalho de questão numerada ("Pergunta 1", "Questão 2") no início da
// linha — formato de prova exportado de plataforma de ensino (Moodle e
// afins), que sempre numera CADA questão antes do enunciado.
const CABECALHO_QUESTAO = /^\s*(?:pergunta|quest[aã]o)\s*\d+\b/gim;

function decomporPedido(objetivo) {
  const texto = String(objetivo || '')
    .split(/\n\nArquivos anexados/)[0]
    .trim();
  if (!texto) return [];

  // 0) prova com questão numerada + alternativas lettradas (a., b., c...).
  //
  // Caso real de produção (prova de 4 questões do guia PMBOK, formato
  // "Pergunta N" + alternativas a-e, cada bloco separado por uma linha
  // "0 pontos"): a estratégia 1) abaixo corta por "?", mas nem toda questão
  // termina em "?" ("...são chamadas de:" é enunciado válido sem
  // interrogação) — e mesmo quando termina, o corte cai DEPOIS do
  // enunciado e ANTES das alternativas da MESMA questão. O resultado: a
  // "parte" de uma questão trazia só o enunciado, sem nenhuma alternativa
  // pra conferir, e a parte seguinte misturava as alternativas de uma
  // questão com o enunciado da PRÓXIMA — nem a verificação por parte nem a
  // lista de perguntas no prompt de redação (`perguntas` em
  // `pedidoDeResposta`) conseguiam então associar as alternativas certas à
  // pergunta certa. Cortar pelo cabeçalho "Pergunta N"/"Questão N" (que
  // toda questão de prova tem, independente de terminar em "?" ou ":")
  // resolve isso na raiz: cada parte passa a ser o bloco inteiro — enunciado
  // MAIS as próprias alternativas — de uma única questão.
  const cabecalhos = [...texto.matchAll(CABECALHO_QUESTAO)];
  if (cabecalhos.length >= 2) {
    const porQuestao = cabecalhos
      .map((m, i) => texto.slice(m.index, cabecalhos[i + 1]?.index ?? texto.length).trim())
      .filter(Boolean);
    if (porQuestao.length > 1) return porQuestao.slice(0, 20);
  }

  // 1) várias perguntas explícitas
  const porInterrogacao = texto
    .split(/\?+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 8);
  // Teto era 5 — caso real de produção: pedido com 9-10 perguntas de prova
  // (uma por assunto de CC) só tinha as 5 primeiras rastreadas; a resposta
  // ignorou as outras e a verificação nem podia perceber, porque as partes
  // 6-10 nunca existiam pra ela conferir. 20 é folga generosa sem abrir mão
  // do propósito do corte (não deixar um texto patológico virar centenas
  // de "partes" de 1 caractere).
  if (porInterrogacao.length > 1) return porInterrogacao.slice(0, 20);

  // 2) enumeração: "o valor, o vencimento e o que acontece se atrasar"
  //
  // 10º teste real (2026-09-26): "pesquise em fóruns como 'reddit, clube do
  // hardware, forum do adrenaline' para encontrar..." virou TRÊS perguntas
  // ("clube do hardware" sozinho era uma "parte não respondida") e cada uma
  // ganhou um complemento — a resposta saiu três vezes. Vírgula dentro de
  // aspas é lista de nomes, não pergunta; e pedaço curto que começa com
  // conectivo ("após obter os dados") é ligação entre etapas, não parte.
  const aspas = [];
  const protegido = texto.replace(/(["'“‘])([^"'“”‘’]{2,200})(["'”’])/g, (m) => {
    aspas.push(m);
    return `\u0000${aspas.length - 1}\u0000`;
  });
  const restaurar = (p) => p.replace(/\u0000(\d+)\u0000/g, (_, i) => aspas[Number(i)]);
  const porLista = protegido
    .split(/,\s+|\s+e\s+(?=o\s|a\s|os\s|as\s|qual|quais|quanto|como|quando|onde|se\s)/i)
    .map((p) => restaurar(p).trim())
    .filter((p) => p.length > 6)
    .filter((p) => !(/^(ap[oó]s|depois|antes|dessa forma|desta forma|assim|ent[aã]o|em seguida|com isso)\b/i.test(p) && p.split(/\s+/).length <= 4));
  if (porLista.length > 1 && porLista.length <= 20) return porLista;

  return [texto];
}

/**
 * Pedido "tipo prova": muitas perguntas distintas na mesma mensagem.
 *
 * Caso real de produção que motivou isto: um pedido com 9-10 perguntas de
 * teoria (Cook-Levin/NP-completude, thrashing em SO, Paxos, parsers LL/LR,
 * hazard RAW, Dijkstra com peso negativo, 2PL, RSA, uma de aprendizado de
 * máquina) recebeu de volta um resumo da ESTRUTURA de uma única página web
 * (títulos tipo "Exercícios 1" a "Exercícios 7", frases vagas do tipo
 * "questões que provavelmente envolvem...") — nenhuma das perguntas de
 * verdade foi respondida. Levantar o teto de `decomporPedido` (acima) já
 * corrige a VERIFICAÇÃO (agora todas as partes são conferidas, não só 5),
 * mas o redator também precisa ser instruído de forma explícita a tratar
 * cada pergunta separadamente — sem isso ele tende a escrever um texto
 * corrido sobre o "tema geral", que nem sempre cobre parte alguma de
 * verdade. Duas perguntas juntas já tendem a sair bem sem ajuda extra; o
 * problema observado era especificamente MUITAS de uma vez.
 */
/**
 * O "complemento" de uma parte só repete a resposta que já existe? (10º teste
 * real: pedido pra completar uma parte, o redator reescreveu a resposta
 * inteira — mesmos títulos "### Resposta Direta", mesma tabela — e ela foi
 * colada no fim, duas vezes.) Repete quando metade ou mais das linhas
 * longas/títulos do complemento já está na resposta, ou quando 2+ títulos
 * se repetem.
 */
function complementoRepete(resposta, complemento) {
  const chave = (l) => normalizar(l.replace(/[#*|_>-]/g, ' ')).trim();
  const existentes = new Set(String(resposta || '').split('\n').map(chave).filter((l) => l.length >= 8));
  const linhas = String(complemento || '').split('\n');
  const titulos = linhas.filter((l) => /^\s*#{1,6}\s/.test(l)).map(chave).filter(Boolean);
  if (titulos.filter((t) => existentes.has(t)).length >= 2) return true;
  const longas = linhas.map(chave).filter((l) => l.length >= 20);
  if (!longas.length) return false;
  return longas.filter((l) => existentes.has(l)).length / longas.length >= 0.5;
}

const MIN_PERGUNTAS_MULTIPLAS = 3;
function perguntasMultiplas(objetivo) {
  const partes = decomporPedido(objetivo);
  return partes.length >= MIN_PERGUNTAS_MULTIPLAS ? partes : null;
}

/**
 * Classificação determinística de complexidade — SEM chamar o modelo.
 *
 * Motivo de existir: decidir se um pedido "precisa de plano explícito" é
 * exatamente o tipo de julgamento que um modelo local pequeno responde de
 * forma inconsistente de uma execução pra outra — às vezes declara um
 * `plano` já na primeira decisão, às vezes não, sem relação clara com o
 * quanto o pedido é composto de verdade (ver a discussão com o Davi sobre
 * volatilidade de modelo pequeno). Em vez de deixar isso a critério do
 * modelo, essa decisão vira regra de código: quem chama (loop.js,
 * `planejarInicial`) força a etapa de planejamento sempre que esta função
 * disser que precisa, sem exceção.
 *
 * Dois sinais, qualquer um basta:
 *   - perguntasMultiplas: já existe, mede partes bem definidas (>= 3, por
 *     "?" ou por lista/enumeração).
 *   - comprimento bruto acima de LIMIAR_COMPRIMENTO_COMPLEXO: pega o caso de
 *     pedido longo e composto mas sem pontuação limpa o bastante pra
 *     decomporPedido separar em partes (ex.: um parágrafo só, sem "?" nem
 *     lista, mas com várias exigências emaranhadas).
 */
const LIMIAR_COMPRIMENTO_COMPLEXO = 800;
function classificarPedido(objetivo) {
  const texto = String(objetivo || '');
  const perguntas = perguntasMultiplas(texto);
  const precisaPlanejamento = Boolean(perguntas) || texto.length > LIMIAR_COMPRIMENTO_COMPLEXO;
  return { precisaPlanejamento, perguntas };
}

/**
 * Marcadores técnicos específicos de uma parte do pedido: acrônimos (RSA,
 * ACID, 2PL, RISC, RAW, NP, LL, LR), termos compostos com hífen entre
 * palavras capitalizadas (Cook-Levin, Hindley-Milner, NP-Completo) e
 * sequências de nomes próprios já detectadas por `extrairEntidades`
 * (Algoritmo de Dijkstra, Two-Phase Locking).
 *
 * Caso real de produção (prova de 10 questões de ciência da
 * computação, cada uma citando um algoritmo/protocolo/teorema nomeado): a
 * cobertura por radical genérico (`termosPrincipais`, 40%) aprovava as 11
 * partes do pedido como "respondidas" numa resposta de 20 mil caracteres
 * que não mencionava UMA VEZ SEQUER "RSA", "Paxos", "Dijkstra",
 * "Hindley-Milner", "Cook-Levin", "NP-Completo", "RAW", "2PL" — a resposta
 * inteira era sobre um assunto genérico diferente (gerência de memória
 * virtual em geral), e só compartilhava vocabulário acadêmico comum o
 * bastante ("sistema", "processo", "memória", "algoritmo") pra bater o
 * limiar em toda pergunta, mesmo nas que não tinham nada a ver com memória.
 * Um acrônimo ou termo composto não aparece por acidente numa resposta
 * sobre outro assunto — quando a parte tem algum marcador, ele decide
 * SOZINHO se a parte foi respondida (basta UM presente, não todos — perguntas
 * em português têm sinônimos), substituindo a cobertura genérica por
 * radical: um sinal específico e confiável não deveria perder pra falta de
 * eco textual de palavras genéricas da pergunta ("RSA depende de fatorar
 * números primos" responde bem sem repetir "problema"/"fundamenta"/
 * "segurança"). A cobertura genérica (`termosPrincipais`, 40%) só decide
 * quando a parte não tem NENHUM marcador pra checar.
 *
 * O prefixo "Questão N (Categoria)" que `decomporPedido` deixa colado no
 * início de cada parte é removido antes de procurar marcadores — senão o
 * nome da CATEGORIA ("Sistemas Operacionais", "Bancos de Dados") vira um
 * "marcador" tão genérico quanto os radicais que este mecanismo tenta
 * substituir, e o furo volta pela porta dos fundos.
 */
const PREFIXO_CATEGORIA_QUESTAO = /Quest(?:ã|a)o\s*\d+\s*\([^)]*\)/gi;
const ACRONIMO_TECNICO = /\b\d?[A-Z]{2,6}\d?\b/g;
const COMPOSTO_HIFEN = /\b[A-ZÀ-Ö][A-Za-zÀ-ÿ]*-[A-ZÀ-Ö][A-Za-zÀ-ÿ]*\b/g;

/**
 * Caso real de produção (2ª rodada, Davi repetiu a mesma prova de 10
 * questões depois da correção acima): a resposta respondia Q6 (Dijkstra)
 * corretamente — "Dijkstra falha silenciosamente... use Bellman-Ford" — mas
 * `extrairEntidades` só tinha extraído a frase INTEIRA "Algoritmo de
 * Dijkstra" como marcador, e a resposta nunca repete esse trio de palavras
 * junto (só "Dijkstra" sozinho, ou "algoritmo Dijkstra" sem o "de"). Exigir
 * a frase completa é rígido demais — quem importa ali é o nome próprio
 * ("Dijkstra"), não a frase toda. Cada entidade multi-palavra também
 * contribui suas palavras individuais como marcadores adicionais, com DOIS
 * filtros (os dois precisam passar, senão o furo original volta por aqui):
 *
 * 1. Nunca a PRIMEIRA palavra da entidade — ela é maiúscula só por estar no
 *    início da frase ("Algoritmo de Dijkstra": "Algoritmo" não é nome
 *    próprio nenhum, só ganhou maiúscula por posição). Um teste real
 *    reproduziu exatamente esse furo: numa prova sintética com "Algoritmo
 *    de Dijkstra" como único marcador multi-palavra, uma resposta genérica
 *    repetindo "algoritmo" à toa (sem nunca citar "Dijkstra") passava como
 *    "respondida" — a palavra sobrevivia ao filtro de exclusividade (só
 *    aparecia numa parte do pedido) mas era genérica demais mesmo assim.
 * 2. EXCLUSIVA desta parte — não aparece em nenhuma outra parte do mesmo
 *    pedido (evita palavras comuns entre categorias parecidas, tipo
 *    "Redes" repetido entre "Redes de Computadores" e "Redes Neurais", se
 *    um pedido tivesse as duas).
 */
function palavrasDistintasDaEntidade(entidade, frequenciaEntrePartes) {
  return String(entidade)
    .trim()
    .split(/\s+/)
    .slice(1) // fora a primeira palavra — maiúscula só por posição, não por ser nome próprio
    .filter((tok) => /^[A-ZÀ-Ö]/.test(tok)) // só o que É capitalizado por si (sinal de nome próprio de verdade)
    .map((tok) => normalizar(tok).replace(/[^a-z0-9]/g, ''))
    .filter((p) => p.length > 3 && frequenciaEntrePartes.get(p) === 1);
}

function marcadoresEspecificos(parte, frequenciaEntrePartes) {
  const semCategoria = String(parte).replace(PREFIXO_CATEGORIA_QUESTAO, '');
  const acronimos = semCategoria.match(ACRONIMO_TECNICO) || [];
  const compostos = semCategoria.match(COMPOSTO_HIFEN) || [];
  const entidades = extrairEntidades(semCategoria);
  const palavrasDasEntidades = entidades.flatMap((e) => palavrasDistintasDaEntidade(e, frequenciaEntrePartes));
  return [...new Set([...acronimos, ...compostos, ...entidades, ...palavrasDasEntidades])];
}

/** Marcador presente como PALAVRA/termo inteiro — nunca radical parcial (ver
 * caso real: "ACID" batia dentro de "capACIDade" com um simples `includes`). */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function marcadorPresente(marcador, resposta) {
  return new RegExp(`\\b${escapeRegex(marcador)}\\b`, 'i').test(resposta);
}

/** Cada parte foi tratada na resposta? Mesma técnica da cobertura, por parte. */
function conferirPartes(objetivo, resposta) {
  const alvo = normalizar(resposta);
  const partes = decomporPedido(objetivo);

  // Frequência de cada termo entre as PARTES do pedido (não no material nem
  // na resposta) — usada só pra decidir quais palavras dentro de uma
  // entidade multi-palavra são distintivas o bastante pra virar marcador
  // sozinhas (ver `palavrasDistintasDaEntidade`).
  const frequenciaEntrePartes = new Map();
  for (const parte of partes) {
    for (const t of new Set(termosPrincipais(parte))) {
      frequenciaEntrePartes.set(t, (frequenciaEntrePartes.get(t) || 0) + 1);
    }
  }

  return partes
    .map((parte) => {
      const termos = termosPrincipais(parte);
      if (!termos.length) return null;
      // radical de 4 caracteres: "vencimento" precisa casar com "vence",
      // "atrasar" com "atraso". Cinco caracteres deixava passar como não
      // respondido o que estava respondido com outra flexão.
      const cobertos = termos.filter((t) => alvo.includes(t.length > 5 ? t.slice(0, 4) : t));
      const marcadores = marcadoresEspecificos(parte, frequenciaEntrePartes);
      // Quando a parte tem marcador técnico específico, ELE decide sozinho —
      // é um sinal mais forte e mais confiável que a cobertura genérica por
      // radical (uma resposta pode citar "RSA" sem repetir nenhuma das
      // palavras da pergunta, e ainda assim estar certíssima — não faz
      // sentido negar isso só por falta de eco textual). Cobertura genérica
      // só decide quando a parte NÃO tem nenhum marcador pra checar.
      const respondida = marcadores.length
        ? marcadores.some((m) => marcadorPresente(m, resposta))
        : cobertos.length / termos.length >= 0.4;
      return {
        parte: parte.slice(0, 90),
        termos: termos.length,
        cobertos: cobertos.length,
        marcadores,
        respondida,
      };
    })
    .filter(Boolean);
}

/**
 * Onde, dentro da resposta, o assunto do pedido de fato aparece — não só SE
 * aparece. Caso real de produção (2026-09-15, logs `mu2shec3-1pru` e
 * `mu2supwh-ld3h`): a mesma pergunta sobre a teoria da relatividade de
 * Einstein, feita duas vezes com reformulação mínima, saiu uma vez como
 * resposta de física correta e outra vez como um ENSAIO DE HISTÓRIA DA ARTE
 * (Van Eyck, Manet, Monet, Picasso), com "teoria"/"relatividade" citados só
 * de raspão na introdução e na conclusão. `respondeAoPedido` aprovou os dois
 * (`true`) porque `cobertos.length / termos.length >= 0.3` só pergunta SE um
 * termo aparece em algum lugar do texto inteiro — não importa se é a
 * moldura (2 de 9 parágrafos) ou o corpo inteiro (9 de 9). Isto é
 * exatamente o mesmo padrão do bug de `conferirPartes` (vocabulário
 * genérico repetido demais mascarando a ausência do assunto real), só que
 * aqui o pedido é uma pergunta ÚNICA — sem 2+ partes pra `conferirPartes`
 * entrar em ação (ver o gate `partes.length < 2` em `respondeAoPedido`).
 *
 * Em vez de exigir marcador exato (arriscado com pedido que tem erro de
 * digitação num nome próprio — ex.: "Albert Aisten" no pedido real acima —
 * uma resposta correta escreve "Einstein" e nunca bateria no marcador
 * literal do pedido), mede a mesma cobertura por radical já usada em
 * `respondeAoPedido`, mas parágrafo a parágrafo: se o assunto só aparece na
 * moldura (abertura/fechamento) e o corpo é sobre outra coisa, a fração de
 * parágrafos "no assunto" fica baixa mesmo com bastante texto.
 */
function coberturaPorParagrafo(termos, texto, assunto = []) {
  const paragrafos = String(texto)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#{1,6}\s.*$/gm, '').trim()) // título markdown sozinho não é parágrafo de conteúdo
    .filter((p) => p.length >= 40); // parágrafo curto demais (título, item solto) não é sinal confiável

  // texto curto ou pouco estruturado não dá sinal confiável de distribuição
  // — a cobertura por termo (já calculada em `respondeAoPedido`) continua
  // sendo o único critério nesses casos, sem risco extra de falso positivo.
  if (paragrafos.length < 4 || !termos.length) return null;

  // `assunto`: nomes que SÃO o assunto sem repetir palavra do pedido — as
  // opções que a pesquisa planejada comparou (7º teste real, 2026-09-25: a
  // resposta comparativa, com tabela e "destaques de cada opção", falava de
  // Galaxy Buds FE e KZ ZSN PRO parágrafo a parágrafo, sem repetir "fone" ou
  // "PUBG" — deu 0,33, reescrita à toa e o aviso de "pode não cobrir o pedido")
  const nomes = assunto.map((a) => normalizar(a)).filter((a) => a.length >= 3);
  const noAssunto = paragrafos.filter((p) => {
    const normalizado = normalizar(p);
    return termos.some((t) => normalizado.includes(t.slice(0, 5))) || nomes.some((a) => normalizado.includes(a));
  }).length;
  return noAssunto / paragrafos.length;
}

/**
 * Esboço mínimo do material por tópico, ANTES da redação — mesma técnica de
 * `conferirPartes` (radical de 4+ caracteres, >= 40% dos termos batendo), só
 * que aplicada ao DOSSIÊ já coletado em vez de à resposta já escrita.
 *
 * Motivado pelo mesmo padrão de bug que motivou `perguntasMultiplas`: com
 * várias perguntas na mesma mensagem, o redator recebe o material inteiro
 * como um bloco só de texto e tende a escrever sobre a 1ª pergunta (ou sobre
 * o "tema geral"), mesmo quando o dossiê já tem material de sobra pras
 * outras — porque nada no prompt aponta qual pedaço serve pra qual
 * pergunta (caso real: prova de 3 perguntas — NP-completo, thrashing,
 * Paxos — em que o gate de checklist barrou justamente essa resposta
 * parcial). Isto não filtra nem reorganiza o material em si — só torna
 * visível, pergunta por pergunta, se HÁ algo no dossiê que bate com ela,
 * pro redator decidir com essa informação em mãos (inclusive "aviso que
 * isto não veio de pesquisa") em vez de descobrir sozinho lendo o bloco
 * inteiro.
 */
function esbocoPorTopico(perguntas, dossie) {
  if (!perguntas?.length || !dossie?.length) return null;
  const materiais = dossie.map((d) => normalizar(String(d.texto || d.bruto || '')));
  return perguntas.map((parte) => {
    const termos = termosPrincipais(parte);
    if (!termos.length) return { parte, temMaterial: true }; // sem termo pra checar, não arrisca alarme falso
    const bateEm = (texto) => {
      const cobertos = termos.filter((t) => texto.includes(t.length > 5 ? t.slice(0, 4) : t));
      return cobertos.length / termos.length >= 0.4;
    };
    return { parte, temMaterial: materiais.some(bateEm) };
  });
}

/* ------------------------------ confiança ------------------------------ */

/**
 * Confiança declarada a partir do que já é medido: cobertura do pedido,
 * corroboração entre fontes e afirmações sem respaldo. Determinística de
 * propósito — dizer "alta confiança" com base em palpite seria pior que calar.
 */
function calcularConfianca({ verificacao, cobertura, cruzamento, fontes = 0, marcadas = 0 }) {
  const motivos = [];
  let pontos = 0;

  if (marcadas > 0) {
    pontos -= 2;
    motivos.push(`${marcadas} fonte(s) com histórico de baixa credibilidade`);
  }

  if (cobertura?.nivel === 'boa') pontos += 2;
  else if (cobertura?.nivel === 'parcial') { pontos += 1; motivos.push('parte do pedido sem material'); }
  else motivos.push('sem material sobre o pedido');

  if (cruzamento?.suficiente) {
    if (cruzamento.dominios >= 3) pontos += 2;
    else pontos += 1;
    if (cruzamento.confirmados?.length) pontos += 1;
    // fontes discordando de um número é motivo forte para não afirmar com
    // segurança — pesa mais que a corroboração das outras
    if (cruzamento.divergencias?.length) { pontos -= 2; motivos.push('fontes divergem em algum dado'); }
    // Cross-validation de opinião (Davi, 2026-09-23): mesmo raciocínio acima,
    // mas para veredito ("recomendo" × "não recomendo"), não número. Peso
    // menor (-1, não -2): opinião legitimamente varia mais entre fonte do que
    // fato objetivo, então a mesma discordância pesa menos contra a confiança.
    if (cruzamento.divergenciasOpiniao?.length) { pontos -= 1; motivos.push('fontes divergem na avaliação de algo'); }
  } else if (fontes <= 1) {
    motivos.push('fonte única, sem corroboração');
  }

  if (verificacao?.totalSuspeitas) {
    pontos -= 2;
    motivos.push(`${verificacao.totalSuspeitas} valor(es) sem respaldo nas fontes`);
  }
  // Caso real: uma reescrita de correção rodou e o mesmo valor sem respaldo
  // sobreviveu (ver `suspeitasPersistentes` em loop.js) — a correção foi
  // tentada e não resolveu aquele ponto específico, o que é um sinal mais
  // forte de fabricação do que uma suspeita ainda não revisada nenhuma vez.
  if (verificacao?.suspeitasPersistentes?.length) {
    pontos -= 2;
    motivos.push(
      `${verificacao.suspeitasPersistentes.length} valor(es) continuaram sem respaldo mesmo depois da correção (${verificacao.suspeitasPersistentes
        .map((s) => s.valor)
        .join(', ')})`
    );
  }
  if (verificacao && !verificacao.respondeAoPedido) {
    pontos -= 2;
    motivos.push('a resposta pode não tratar do que foi perguntado');
  }

  const nivel = pontos >= 4 ? 'alta' : pontos >= 2 ? 'média' : 'baixa';
  return { nivel, pontos, motivos };
}

/* ------------------------------ verificação ------------------------------ */

/**
 * Inconsistência interna de números (2026-09-27, 10º teste real + "autópsia"
 * do ChatGPT): o verificador só perguntava "esse número está no material?".
 * "mais de $1.000 (R$ 1.000 a R$ 1.200)" passava — os dois números estavam
 * nas fontes — mas a frase é impossível (dólar não vale um real). E
 * "Preço médio: R$ 8.499,99 a R$ 9.599,99" chama intervalo de média.
 * Checagem por regra, sem modelo:
 *   - moeda: valor em dólar com valor em real logo depois (entre parênteses,
 *     "ou", "cerca de") numa razão fora de 3,5–8 → conversão impossível;
 *   - media-intervalo: "média"/"preço médio" seguido de "R$ X a R$ Y".
 */
const RE_DOLAR = /(?<![R\w])(?:US\$|U\$|\$)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/g;
const RE_REAL = /R\$\s?(\d{1,3}(?:[.,]\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/g;
function valorMonetario(t) {
  const s = String(t);
  if (/,\d{2}$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/\.\d{2}$/.test(s) && !/\.\d{3}/.test(s)) return Number(s.replace(/,/g, ''));
  return Number(s.replace(/[.,]/g, ''));
}
function inconsistenciasNumericas(texto) {
  const achadas = [];
  const frases = String(texto || '').split(/(?<=[.!?])\s+|\n+/);
  for (const frase of frases) {
    for (const d of frase.matchAll(RE_DOLAR)) {
      const depois = frase.slice(d.index + d[0].length, d.index + d[0].length + 60);
      const r = /^\s*(?:\(|,)?\s*(?:ou|cerca de|aprox\w*|≈|~|equivalente a|aproximadamente)?\s*(?:de\s)?R\$\s?(\d{1,3}(?:[.,]\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/i.exec(depois);
      if (!r) continue;
      const usd = valorMonetario(d[1]);
      const brl = valorMonetario(r[1]);
      if (!usd || !brl) continue;
      const razao = brl / usd;
      if (razao < 3.5 || razao > 8) {
        achadas.push({ tipo: 'moeda', valor: `${d[0].trim()} ≠ R$ ${r[1]}`, detalhe: `a conversão implícita dá ${razao.toFixed(2)} reais por dólar` });
      }
    }
    const m = /\bm[eé]di[oa]\b[^.\n]{0,40}?R\$\s?[\d.,]+\s*(?:a|até|-|–|e)\s*R\$\s?[\d.,]+/i.exec(frase);
    if (m) achadas.push({ tipo: 'media-intervalo', valor: m[0].slice(0, 80), detalhe: 'um intervalo não é uma média' });
  }
  return achadas.slice(0, 6);
}

function verificar({ resposta, dossie = [], objetivo = '', assunto = [] }) {
  const texto = String(resposta || '');
  const material = dossie.map((d) => (typeof d === 'string' ? d : d.texto)).join('\n');

  const numerosDoMaterial = extrairNumeros(material).map((n) => n.valor);
  const datasDoMaterial = extrairDatas(material);
  const materialNormalizado = normalizar(material);
  // O próprio PEDIDO também é fonte legítima pra nome próprio — caso real de
  // produção: um pedido de várias perguntas trazia "Teoria da Complexidade",
  // "Sistemas Operacionais" etc. como título de cada questão; a resposta
  // ecoou esses títulos de volta (comportamento normal e esperado, não
  // invenção) e, sem material nenhum (pesquisa não achou nada), isso virava
  // "nome próprio sem respaldo" — o usuário deu esse texto, o modelo não
  // inventou nada. Não estende pra números/datas: não há evidência de que
  // esse mesmo eco aconteça com valor numérico, e number/data já tem seu
  // próprio filtro de ruído.
  const objetivoNormalizado = normalizar(objetivo);

  const suspeitas = [];
  const semMaterial = !material.trim();

  // números afirmados que não aparecem no material
  const vistos = new Set();
  for (const n of extrairNumeros(texto)) {
    if (vistos.has(n.texto)) continue;
    vistos.add(n.texto);
    if (!numeroPresente(n.valor, numerosDoMaterial)) {
      suspeitas.push({ tipo: 'numero', valor: n.texto });
    }
  }

  // datas afirmadas que não aparecem no material
  for (const data of extrairDatas(texto)) {
    if (!datasDoMaterial.has(data)) {
      const [mes, dia] = data.split('-');
      suspeitas.push({ tipo: 'data', valor: `${dia}/${mes}` });
    }
  }

  // nomes próprios afirmados que não aparecem no material — ver extrairEntidades
  const vistasEntidades = new Set();
  for (const entidade of extrairEntidades(texto)) {
    const chave = normalizar(entidade);
    if (vistasEntidades.has(chave)) continue;
    vistasEntidades.add(chave);
    if (!entidadePresente(entidade, materialNormalizado) && !entidadePresente(entidade, objetivoNormalizado)) {
      suspeitas.push({ tipo: 'entidade', valor: entidade });
    }
  }

  // a resposta trata de cada parte do que foi perguntado?
  const termos = termosPrincipais(objetivo);
  const respostaNormalizada = normalizar(texto);
  const cobertos = termos.filter((t) => respostaNormalizada.includes(t.slice(0, 5)));

  const partes = conferirPartes(objetivo, texto);
  const partesNaoRespondidas = partes.filter((p) => !p.respondida);
  // distribuição >= 0.34 (~1/3 dos parágrafos): generoso o bastante pra não
  // penalizar uma resposta legítima que tem 1 parágrafo de abertura/fechamento
  // sem repetir termo nenhum (comum em texto bem escrito), mas baixo o
  // bastante pra pegar o caso real (2 de 9 parágrafos ≈ 0.22).
  const distribuicao = coberturaPorParagrafo(termos, texto, assunto);
  const respondeAoPedido =
    (!termos.length || cobertos.length / termos.length >= 0.3) &&
    (partes.length < 2 || partesNaoRespondidas.length === 0) &&
    (distribuicao === null || distribuicao >= 0.34);

  const inconsistencias = inconsistenciasNumericas(texto);
  const totalAfirmacoes = vistos.size + extrairDatas(texto).size + vistasEntidades.size;
  const proporcao = totalAfirmacoes ? suspeitas.length / totalAfirmacoes : 0;

  return {
    suspeitas: suspeitas.slice(0, 12),
    totalSuspeitas: suspeitas.length,
    totalAfirmacoes,
    proporcao: Number(proporcao.toFixed(2)),
    respondeAoPedido,
    partes,
    partesNaoRespondidas: partesNaoRespondidas.map((p) => p.parte),
    termosDoPedido: termos.length,
    termosNaResposta: cobertos.length,
    semMaterial,
    // Duas razões pra reescrever, e elas NÃO precisam de material pra valer:
    //
    // 1. Vários valores/datas sem respaldo (3+ afirmações, 40%+ suspeitas) —
    //    isso é fabricação farta, e vale tanto com material insuficiente
    //    quanto SEM material nenhum. É justamente sem material que a
    //    fabricação é mais fácil de acontecer (nada ancorando o modelo) e
    //    mais importante de barrar — ex.: uma busca de preço que não achou
    //    nada, e o modelo inventa "R$ 11,50" mesmo assim. Um valor isolado
    //    (ex.: "2 elevado a 10 é 1.024", conhecimento geral correto) não
    //    passa do piso de 3 afirmações e continua não disparando reescrita.
    //
    // 2. "Não respondeu ao pedido" só conta quando HÁ material — sem
    //    material, a métrica de sobreposição de termos entre pedido e
    //    resposta é ruim demais (uma resposta correta e direta a uma conta
    //    matemática, por exemplo, não repete as palavras da pergunta) e
    //    dispararia reescrita à toa.
    inconsistencias,
    reescrever: (totalAfirmacoes >= 3 && proporcao >= 0.4) || (!semMaterial && !respondeAoPedido) || inconsistencias.length > 0,
    aprovado: suspeitas.length === 0 && respondeAoPedido && !inconsistencias.length,
  };
}

/** Texto que volta ao modelo pedindo a correção. */
function instrucaoDeCorrecao(v) {
  const partes = [];
  if (v.partesNaoRespondidas?.length) {
    partes.push(
      `A resposta anterior deixou de fora: ${v.partesNaoRespondidas
        .map((p) => `"${p}"`)
        .join(' e ')}. Responda TODAS as partes do pedido.`
    );
  } else if (!v.respondeAoPedido) {
    partes.push('A resposta anterior não trata do que foi perguntado. Responda a pergunta feita, diretamente.');
  }
  if (v.suspeitas.length) {
    if (v.semMaterial) {
      // sem material nenhum não tem "valor real nas fontes" pra substituir —
      // a única correção honesta é remover o que foi inventado e admitir
      // que a busca/consulta não trouxe nada confiável.
      partes.push(
        `Nenhum material foi coletado pra embasar estas afirmações (números, datas ou nomes): ${v.suspeitas
          .map((s) => s.valor)
          .join(', ')}. Não existe fonte nenhuma que as confirme — remova-as e diga com honestidade que ` +
          'não foi encontrado um resultado confiável, em vez de estimar ou inventar um dado.'
      );
    } else {
      partes.push(
        `Estas afirmações (números, datas ou nomes) NÃO aparecem no material coletado: ${v.suspeitas
          .map((s) => s.valor)
          .join(', ')}. Remova-as ou substitua pelo que realmente está nas fontes. ` +
          'Se um dado não existe no material, escreva que não foi encontrado em vez de estimar.'
      );
    }
  }
  const deContexto = (v.inconsistencias || []).filter((i) => i.tipo === 'contexto');
  const numericas = (v.inconsistencias || []).filter((i) => i.tipo !== 'contexto');
  if (numericas.length) {
    partes.push(
      `Estes números não fecham entre si: ${numericas
        .map((i) => `"${i.valor}" (${i.detalhe})`)
        .join('; ')}. Corrija: não converta moeda de cabeça (dê o valor em dólar e o valor em real como cada fonte disse, separados), ` +
        'e só chame de média um número calculado — faixa de preço é "de R$ X a R$ Y", não "média".'
    );
  }
  // Etapa I: número que existe no material, mas de outra condição/produto
  if (deContexto.length) {
    partes.push(
      `Estes números estão no CONTEXTO ERRADO (o valor existe no material, mas é de outra resolução, jogo ou produto): ${deContexto
        .map((i) => `"${i.valor}" (${i.detalhe})`)
        .join('; ')}. Use cada número só com a condição e o produto que a fonte deu.`
    );
  }
  return partes.join('\n');
}

/**
 * Tabela com dado inventado (Etapa B, 14º teste real): "fone mais usado
 * pelos profissionais" saiu com uma tabela de preços (R$ 1.200-1.400) e
 * notas em estrelas (⭐⭐⭐⭐⭐) que não estavam em NENHUMA leitura. Coluna de
 * estrelas sai inteira (nota em estrela não vem de fonte nenhuma que o
 * agente lê); célula com preço/valor monetário cujo número não está no
 * material vira "sem dado". Devolve { texto, removidas } — `removidas` é o
 * que saiu, pro registro.
 */
const SO_ESTRELAS = /^[\s⭐★☆✩✪✫✬✭✮✯✰/0-9.,]*[⭐★☆][\s⭐★☆/0-9.,]*$/;
function semDadoInventadoEmTabela(texto, material) {
  const universo = extrairNumeros(material || '').map((n) => Math.abs(n.valor));
  const removidas = [];
  const linhas = String(texto || '').split('\n');
  const saida = [];
  let i = 0;
  const celulas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const ehLinhaDeTabela = (l) => /^\s*\|.*\|\s*$/.test(l);
  while (i < linhas.length) {
    if (!ehLinhaDeTabela(linhas[i]) || !linhas[i + 1] || !/^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1])) {
      saida.push(linhas[i]);
      i += 1;
      continue;
    }
    const bloco = [];
    while (i < linhas.length && ehLinhaDeTabela(linhas[i])) bloco.push(celulas(linhas[i++]));
    const [cab, sep, ...corpo] = bloco;
    // colunas de estrelas
    const fora = new Set();
    cab.forEach((_, c) => {
      const cheias = corpo.filter((l) => (l[c] || '').replace(/\*/g, '').trim());
      if (cheias.length && cheias.filter((l) => SO_ESTRELAS.test(l[c].replace(/\*/g, ''))).length >= Math.ceil(cheias.length / 2)) {
        fora.add(c);
        removidas.push(`coluna "${cab[c]}" (notas em estrela sem fonte)`);
      }
    });
    // células de dinheiro sem número no material
    for (const l of corpo) {
      l.forEach((cel, c) => {
        if (fora.has(c)) return;
        const eDinheiro = /(r\$|us\$|€|\$|reais|preço|preco)/i.test(`${cab[c] || ''} ${cel}`) && /\d/.test(cel);
        if (!eDinheiro) return;
        const nums = extrairNumeros(/r\$|us\$|€|\$/i.test(cel) ? cel : `R$ ${cel}`).map((n) => Math.abs(n.valor));
        if (nums.length && !nums.every((n) => numeroPresente(n, universo))) {
          removidas.push(`"${cel}" em "${cab[c] || 'tabela'}" (valor que não está no material)`);
          l[c] = 'sem dado';
        }
      });
    }
    const manter = (l) => l.filter((_, c) => !fora.has(c));
    if (manter(cab).length < 2) continue; // sobrou tabela de uma coluna: some
    for (const l of [cab, sep, ...corpo]) saida.push(`| ${manter(l).join(' | ')} |`);
  }
  return { texto: saida.join('\n'), removidas };
}

module.exports = {
  semDadoInventadoEmTabela,
  inconsistenciasNumericas,
  complementoRepete,
  verificar,
  decomporPedido,
  perguntasMultiplas,
  classificarPedido,
  conferirPartes,
  coberturaPorParagrafo,
  esbocoPorTopico,
  calcularConfianca,
  instrucaoDeCorrecao,
  extrairNumeros,
  extrairDatas,
  diasDesdeDataMaisRecente,
  paraNumero,
  termosPrincipais,
  pareceParafrase,
  extrairEntidades,
  entidadePresente,
};
