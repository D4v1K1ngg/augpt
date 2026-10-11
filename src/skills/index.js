'use strict';

const fs = require('fs');
const path = require('path');
const { cosine, vetorDe } = require('../agent/embeddings');

/**
 * Skills são pastas com um SKILL.md dentro. O arquivo começa com um bloco de
 * metadados entre --- e o resto é instrução em markdown, injetada no prompt
 * quando a skill for relevante para o pedido.
 *
 *   ---
 *   nome: Previsão do tempo
 *   descricao: Como pesquisar e apresentar previsão meteorológica
 *   gatilhos: [previsão, tempo, clima, chuva, temperatura]
 *   etapa: ambas          # decisao | redacao | ambas
 *   prioridade: 2         # desempate quando várias casam
 *   ---
 *
 * Duas origens: as embutidas (pasta skills/ do app) e as suas
 * (pasta skills/ dentro dos dados do usuário). Mesmo formato, mesmo tratamento.
 */

const LIMITE_TOTAL = 7000; // caracteres de skill injetados por prompt
const MAX_SKILLS = 3;
// Cosseno mínimo para o fallback semântico escolher uma skill sem gatilho nenhum
// batendo. Caso real de produção (log de 09/11, pós-v0.5.5): "Previsão do
// tempo" (gatilho zerado, confirmado) ativou na redação de uma resposta sobre
// PUBG/Unreal Engine 5 — só pode ter vindo daqui. 0,55 era baixo demais pro
// papel de última linha que esse fallback deveria ter; subido pra 0,68.
// Continua sem calibração real (este sandbox não tem acesso ao modelo de
// embedding do Davi pra testar contra os pares de verdade) — se ainda
// disparar falso positivo no ambiente dele, sobe mais.
const LIMIAR_SEMANTICO = 0.68;
// Não basta um escore acima do limiar: se o segundo colocado está colado
// nele, o "melhor" provavelmente é ruído do embedding (muitas skills vagamente
// parecidas), não um sinal de verdade — mesmo caso real: nada garante que só
// "Previsão do tempo" tenha pontuado alto, ou que ela pontuou isolada.
const MARGEM_SEMANTICA_MINIMA = 0.05;

function semAcento(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Item 6 da an\u00e1lise comparativa (2026-09-21/22, "ativa\u00e7\u00e3o manual de skill
// por /nome", inspirado no /nome-da-skill do deer-flow): slug compar\u00e1vel
// entre o que o usu\u00e1rio digita depois da barra e tanto `pasta` (j\u00e1 em
// kebab-case) quanto `nome` (com espa\u00e7o/mai\u00fascula/acento) de uma skill \u2014
// "/previsao-do-tempo" e "/Previs\u00e3o do Tempo" caem no mesmo slug.
function slugify(texto) {
  return semAcento(texto)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Skill no formato padrão não traz gatilhos — a ativação lá é o modelo lendo a
 * descrição. Aqui a seleção é determinística, então extraímos candidatos da
 * própria descrição: termos entre aspas e o que vem depois de "triggers include".
 */
function derivarGatilhos(meta) {
  const descricao = String(meta.descricao || meta.description || '');
  if (!descricao) return [];

  const achados = [];
  for (const m of descricao.matchAll(/['"]([^'"]{3,30})['"]/g)) achados.push(m[1]);

  const listados = /(?:triggers include|gatilhos?:|use (?:this skill )?when(?:ever)?)([^.]{0,200})/i.exec(descricao);
  if (listados) {
    for (const parte of listados[1].split(/,| or | ou /)) {
      const limpo = parte.replace(/[^\wÀ-ÿ\s.-]/g, '').trim();
      if (limpo.length > 3 && limpo.split(/\s+/).length <= 4) achados.push(limpo);
    }
  }

  return [...new Set(achados.map((a) => a.toLowerCase().trim()))].slice(0, 12);
}

/** Analisador do bloco de metadados. Subconjunto de YAML, sem dependências. */
function lerMetadados(bruto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(bruto.trim());
  if (!m) return { meta: {}, corpo: bruto.trim() };

  const meta = {};
  const linhas = m[1].split(/\r?\n/);
  let chaveAtual = null;

  for (const linha of linhas) {
    if (!linha.trim() || linha.trim().startsWith('#')) continue;

    const item = /^\s*-\s+(.*)$/.exec(linha);
    if (item && chaveAtual) {
      if (!Array.isArray(meta[chaveAtual])) meta[chaveAtual] = [];
      meta[chaveAtual].push(item[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    const par = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(linha);
    if (!par) continue;
    const [, chave, valorBruto] = par;
    const valor = valorBruto.trim();
    chaveAtual = chave;

    if (!valor) {
      meta[chave] = [];
    } else if (valor.startsWith('[')) {
      meta[chave] = valor
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else if (/^(true|false)$/i.test(valor)) {
      meta[chave] = valor.toLowerCase() === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(valor)) {
      meta[chave] = Number(valor);
    } else {
      meta[chave] = valor.replace(/^["']|["']$/g, '');
    }
  }

  return { meta, corpo: m[2].trim() };
}

function carregarPasta(dir, origem) {
  const skills = [];
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entrada of entradas) {
    if (!entrada.isDirectory() || entrada.name.startsWith('.')) continue;
    const arquivo = path.join(dir, entrada.name, 'SKILL.md');
    let bruto;
    try {
      // CRLF vira LF: arquivo salvo no Windows (ou baixado pelo Git com
      // autocrlf) contava um caractere a mais por linha no `tamanho`, e a
      // skill estourava o limite total e ficava de fora da seleção.
      bruto = fs.readFileSync(arquivo, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      continue; // pasta sem SKILL.md é ignorada em silêncio
    }

    const { meta, corpo } = lerMetadados(bruto);
    if (!corpo) continue;

    skills.push({
      id: `${origem}:${entrada.name}`,
      pasta: entrada.name,
      caminho: arquivo,
      origem, // 'embutida' | 'sua'
      // aceita também o formato padrão (name/description), para que skill baixada
      // de uma coleção da comunidade funcione ao ser solta na pasta
      nome: meta.nome || meta.name || entrada.name,
      descricao: meta.descricao || meta.description || '',
      importada: !meta.nome && Boolean(meta.name),
      gatilhos: Array.isArray(meta.gatilhos) ? meta.gatilhos : derivarGatilhos(meta),
      // "Do NOT use for" do padrão Agent Skills: com o catálogo crescendo, saber
      // de onde uma skill deve ficar LONGE vale tanto quanto saber quando usá-la
      naoUsePara: Array.isArray(meta.nao_use_para)
        ? meta.nao_use_para
        : Array.isArray(meta.naoUsePara)
          ? meta.naoUsePara
          : [],
      // ferramentas que esta skill considera indispensáveis para a tarefa
      ferramentas: Array.isArray(meta.ferramentas) ? meta.ferramentas : [],
      // Item 3 da análise comparativa (2026-09-21, "allowed-tools por
      // skill", inspirado no campo `allowed-tools` do formato de skill do
      // deer-flow/Claude): lista RESTRITIVA — quando presente (não vazia),
      // esta skill só permite ao modelo acionar as ferramentas listadas
      // aqui (ver Agent.ferramentasDesativadasParaSkills(), loop.js).
      // Vazia/ausente (o padrão de toda skill já existente) não restringe
      // nada — mesmo catálogo de sempre. Aceita os dois nomes de campo
      // (`ferramentas_permitidas`, o nosso; `allowed-tools`, pra uma skill
      // baixada de uma coleção da comunidade no formato padrão funcionar
      // sem precisar editar).
      ferramentasPermitidas: Array.isArray(meta.ferramentas_permitidas)
        ? meta.ferramentas_permitidas
        : Array.isArray(meta['allowed-tools'])
          ? meta['allowed-tools']
          : [],
      etapa: ['decisao', 'redacao', 'ambas'].includes(meta.etapa) ? meta.etapa : 'ambas',
      prioridade: Number(meta.prioridade) || 1,
      sempre: meta.sempre === true,
      // criação automática de skills (item 5): rascunho proposto pelo próprio
      // agente, nunca ativo numa conversa real (ver `selecionar()`) até você
      // aprovar — `autotestada` registra se a rodada de teste que o agente
      // fez sozinho, numa execução isolada, achou que a skill ajudou ou não.
      sugerida: meta.sugerida === true,
      autotestada: meta.autotestada === true,
      autotesteResumo: meta.autoteste_resumo || '',
      corpo,
      tamanho: corpo.length,
      temRotina: require('fs').existsSync(require('path').join(dir, entrada.name, 'workflow.json')),
    });
  }
  return skills;
}

class Skills {
  constructor({ dirEmbutidas, dirUsuario }) {
    this.dirEmbutidas = dirEmbutidas;
    this.dirUsuario = dirUsuario;
    this.lista = [];
    this.recarregar();
  }

  recarregar() {
    try {
      fs.mkdirSync(this.dirUsuario, { recursive: true });
    } catch {
      /* segue sem a pasta do usuário */
    }
    this.lista = [
      ...carregarPasta(this.dirEmbutidas, 'embutida'),
      ...carregarPasta(this.dirUsuario, 'sua'),
    ];
    return this.lista;
  }

  todas(desativadas = []) {
    return this.lista.map((s) => ({ ...s, ativa: !desativadas.includes(s.id) }));
  }

  /**
   * Quanto esta skill combina com o pedido. 0 = não usar.
   *
   * Gatilho de duas palavras aceita até duas palavras no meio: "como funciona"
   * precisa casar com "como ela funciona", que é a forma como as pessoas
   * escrevem de verdade. Sem isso, a skill mais útil para dúvida geral ficava
   * praticamente muda.
   */
  /** Mesmo casamento de termo (com tolerância de até duas palavras no meio) usado por `pontuar` e pelo antigatilho. */
  static casaTermo(termo, alvo) {
    const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const palavras = semAcento(termo).trim().split(/\s+/).filter(Boolean).map(escapar);
    if (!palavras.length) return false;
    const padrao =
      palavras.length === 1
        ? `[^a-z0-9]${palavras[0]}[^a-z0-9]`
        : `[^a-z0-9]${palavras.join('(?:[^a-z0-9]+[a-z0-9]+){0,2}[^a-z0-9]+')}[^a-z0-9]`;
    return new RegExp(padrao).test(alvo);
  }

  /**
   * Se algum `nao_use_para` da skill casa com o pedido. Extraído de `pontuar`
   * para que `selecionarPorEmbedding` também respeite o antigatilho — antes
   * dele existir, o fallback semântico podia escolher uma skill mesmo com o
   * pedido batendo num assunto que ela mesma declara não cobrir (caso real:
   * "Previsão do tempo" ativando em pergunta sobre trocar notebook/RAM — o
   * antigatilho zera o escore de gatilho, mas isso nunca impedia o fallback
   * de pontuar a mesma skill por embedding e escolhê-la do mesmo jeito).
   */
  temAntigatilho(skill, texto) {
    const alvo = ` ${semAcento(texto)} `;
    return (skill.naoUsePara || []).some((termo) => Skills.casaTermo(termo, alvo));
  }

  pontuar(skill, texto) {
    const alvo = ` ${semAcento(texto)} `;
    const casa = (termo) => Skills.casaTermo(termo, alvo);

    // antigatilho vence tudo: se o pedido é de outro assunto, a skill sai de cena
    if (this.temAntigatilho(skill, texto)) return 0;

    if (skill.sempre) return 100 + skill.prioridade;

    let pontos = 0;
    for (const gatilho of skill.gatilhos) {
      const g = semAcento(gatilho).trim();
      if (!g) continue;
      if (casa(g)) pontos += 3;
      else if (alvo.includes(g)) pontos += 1;
    }
    return pontos ? pontos + skill.prioridade : 0;
  }

  /**
   * Seleciona as skills relevantes para um pedido, numa etapa do pipeline.
   * `async` porque, quando NENHUM gatilho bate, tenta um fallback semântico
   * (comparação de embeddings) antes de desistir — ver `selecionarPorEmbedding`.
   */
  /**
   * `reforcoSemantico` (Peça 2 do nível de raciocínio unificado, pedido do
   * Davi 2026-09-19: nível "médio" e acima): mesmo com gatilho batendo,
   * também roda o fallback semântico como REFORÇO — pode revelar uma skill
   * que o pedido toca mas nenhum gatilho textual capturou (sinônimo,
   * paráfrase), sem chamar modelo nenhum (só embedding, já local e barato
   * como o resto de `selecionarPorEmbedding`). Nunca desloca uma skill já
   * escolhida por gatilho — só ocupa vaga se ainda sobrar espaço no teto.
   * Falso por padrão: comportamento idêntico a antes pra quem não passar.
   */
  // `forcarId` — item 6 da análise comparativa (2026-09-21/22, "ativação
  // manual de skill por /nome"): id de uma skill que o usuário pediu
  // explicitamente (ver `porNome()`/`Agent.run()`, loop.js). Quando
  // elegível nesta etapa, entra garantida na 1ª posição, ignorando
  // pontuação de gatilho — decisão explícita do usuário vence seleção
  // automática, mesmo espírito do comentário em tools/index.js sobre
  // ferramenta desativada manualmente no painel. `null` (padrão) mantém o
  // comportamento de sempre, sem regressão pra quem não usa `/nome`.
  // `reforcarObjetivo` — Item 2 da rodada de 2026-09-22 (Davi, achado
  // analisando execução real "melhor fone intra-auricular pra PUBG PC"): a
  // reseleção por subtarefa (`reselecionarSkillsPorSubtarefa`, loop.js)
  // recalcula do zero a cada subtarefa, usando só o texto dela — sem isto,
  // uma skill que pontuou bem no OBJETIVO GERAL (aqui o pedido tinha
  // "pesquisa profunda" verbatim) podia sumir no meio da execução só porque
  // o texto de uma subtarefa mais estreita ("verificar opiniões de
  // usuários...") não repetia o gatilho, mesmo a skill continuando
  // relevante pro pedido inteiro. IDs (ordenados por relevância) da seleção
  // feita sobre o objetivo original — nunca desloca uma skill que já bateu
  // gatilho na subtarefa atual (essa sempre vence, é o comportamento que já
  // existia), só ocupa vaga que sobrar no teto, e respeita o antigatilho da
  // própria skill contra o texto ATUAL (uma skill vetada pra esta subtarefa
  // continua vetada, mesmo tendo pontuado no objetivo geral). `[]` por
  // padrão: comportamento idêntico a antes pra quem não passar.
  async selecionar(
    texto,
    { etapa = 'decisao', desativadas = [], host, embedModel, reforcoSemantico = false, forcarId = null, reforcarObjetivo = [] } = {}
  ) {
    const elegiveis = this.lista
      .filter((s) => !desativadas.includes(s.id))
      // sugestão do agente (item 5), testada ou não: nunca compete numa
      // conversa real enquanto você não aprovar (ver skills:aprovarSugestao)
      .filter((s) => !s.sugerida)
      .filter((s) => s.etapa === 'ambas' || s.etapa === etapa);

    const forcada = forcarId ? elegiveis.find((s) => s.id === forcarId) : null;
    // A forçada não compete por pontuação — sai da lista que `pontuar()`
    // examina, senão entraria pontuada (ou não) E garantida ao mesmo tempo.
    const paraPontuar = forcada ? elegiveis.filter((s) => s.id !== forcarId) : elegiveis;

    const candidatas = paraPontuar
      .map((s) => ({ skill: s, pontos: this.pontuar(s, texto) }))
      .filter((c) => c.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos);

    if (!candidatas.length && !forcada) {
      const semantica = embedModel
        ? await this.selecionarPorEmbedding(texto, elegiveis, { host, embedModel })
        : null;
      return semantica ? [semantica] : [];
    }

    const escolhidas = forcada ? [forcada] : [];
    let total = forcada ? forcada.tamanho : 0;
    for (const { skill } of candidatas) {
      if (escolhidas.length >= MAX_SKILLS) break;
      // A mais relevante entra sempre. Sem esta exceção, uma skill menor e menos
      // relevante toma a vaga da maior só por caber no teto. Com `forcada` já
      // ocupando a posição 0, "a mais relevante" aqui é a 1ª automática —
      // mesma regra, só desloca um índice.
      const primeira = escolhidas.length === 0;
      if (!primeira && total + skill.tamanho > LIMITE_TOTAL) continue;
      escolhidas.push(skill);
      total += skill.tamanho;
    }

    // Reforço do objetivo geral (ver comentário do parâmetro acima) — roda
    // ANTES do reforço semântico abaixo: uma skill que já pontuou de verdade
    // no pedido inteiro é sinal mais forte que um fallback por cosseno.
    // Preenche só vaga sobrando, na ordem de relevância que já veio da
    // seleção original, sem nunca duplicar nem repescar uma skill vetada
    // pelo antigatilho contra o texto ATUAL (a subtarefa pode ter mudado de
    // assunto o bastante pra isso importar).
    if (reforcarObjetivo.length && escolhidas.length < MAX_SKILLS) {
      const jaEscolhidas = new Set(escolhidas.map((s) => s.id));
      for (const id of reforcarObjetivo) {
        if (escolhidas.length >= MAX_SKILLS) break;
        if (jaEscolhidas.has(id)) continue;
        const skill = elegiveis.find((s) => s.id === id);
        if (!skill || this.temAntigatilho(skill, texto)) continue;
        if (total + skill.tamanho > LIMITE_TOTAL) continue;
        escolhidas.push(skill);
        jaEscolhidas.add(id);
        total += skill.tamanho;
      }
    }

    if (reforcoSemantico && embedModel && escolhidas.length < MAX_SKILLS) {
      const jaEscolhidas = new Set(escolhidas.map((s) => s.id));
      const restantes = elegiveis.filter((s) => !jaEscolhidas.has(s.id));
      const reforco = restantes.length
        ? await this.selecionarPorEmbedding(texto, restantes, { host, embedModel })
        : null;
      if (reforco && total + reforco.tamanho <= LIMITE_TOTAL) escolhidas.push(reforco);
    }

    return escolhidas;
  }

  /**
   * Item 6 da análise comparativa (2026-09-21/22, "ativação manual de skill
   * por /nome", inspirado no /nome-da-skill do deer-flow): acha a skill que
   * o usuário nomeou explicitamente, pra `Agent.run()` (loop.js) forçar sua
   * seleção via `forcarId` acima, em vez de confiar só em gatilho/embedding.
   * Casamento exato por slug primeiro (pasta OU nome, sem acento/maiúscula —
   * ver `slugify()`); se nada bater exato, aceita PREFIXO só quando UMA
   * única skill elegível começa com o texto — abreviação ("/previsao" achar
   * "previsao-do-tempo") sem risco de escolher a skill errada entre duas
   * parecidas (nesse caso, devolve null e a seleção automática decide,
   * mesma degradação seguindo o resto do arquivo: na dúvida, não força).
   * Desativada e sugerida (ainda não aprovada) nunca são candidatas — mesmo
   * filtro de `selecionar()`.
   */
  porNome(candidato, { desativadas = [] } = {}) {
    const alvo = slugify(String(candidato || ''));
    if (!alvo) return null;

    const elegiveis = this.lista.filter((s) => !desativadas.includes(s.id) && !s.sugerida);
    const exata = elegiveis.find((s) => slugify(s.pasta) === alvo || slugify(s.nome) === alvo);
    if (exata) return exata;

    const prefixadas = elegiveis.filter(
      (s) => slugify(s.pasta).startsWith(alvo) || slugify(s.nome).startsWith(alvo)
    );
    return prefixadas.length === 1 ? prefixadas[0] : null;
  }

  /**
   * Fallback de última hora: nenhum gatilho casou, mas talvez a descrição de
   * alguma skill combine com o pedido em outras palavras. Nunca escolhe mais
   * de 1 skill por aqui — não deve competir em ambiguidade com o sistema de
   * gatilho, só cobrir o caso em que ele fica mudo. Sem `embedModel` (usuário
   * sem modelo de embedding baixado) simplesmente não roda — mesma degradação
   * graciosa que a memória vetorial já tem.
   *
   * Duas travas antes de aceitar um "melhor": o escore em si (LIMIAR_SEMANTICO)
   * E uma margem clara sobre o segundo colocado (MARGEM_SEMANTICA_MINIMA) —
   * ver os dois comentários acima. Um vencedor "por pouco" entre várias
   * skills embolotadas por volta do limiar é ruído, não confiança.
   */
  async selecionarPorEmbedding(texto, elegiveis, { host, embedModel }) {
    // antigatilho vence tudo aqui também — ver `temAntigatilho`.
    const candidatas = elegiveis.filter((skill) => !this.temAntigatilho(skill, texto));
    if (!candidatas.length) return null;
    const vetorPedido = await vetorDe(texto, { host, embedModel });
    if (!vetorPedido) return null;

    const pontuados = [];
    for (const skill of candidatas) {
      const vec = await this.vetorDaSkill(skill, { host, embedModel });
      if (!vec) continue;
      pontuados.push({ skill, score: cosine(vetorPedido, vec) });
    }
    pontuados.sort((a, b) => b.score - a.score);

    const [primeiro, segundo] = pontuados;
    if (!primeiro || primeiro.score <= LIMIAR_SEMANTICO) return null;
    const margem = primeiro.score - (segundo ? segundo.score : -Infinity);
    if (margem < MARGEM_SEMANTICA_MINIMA) return null;
    return primeiro.skill;
  }

  /** Vetor de embedding da descrição de uma skill, cacheado por modelo de embedding. */
  async vetorDaSkill(skill, { host, embedModel }) {
    if (skill._vecModel === embedModel && Array.isArray(skill._vec)) return skill._vec;
    const vec = await vetorDe(skill.descricao || skill.nome, { host, embedModel });
    skill._vec = vec;
    skill._vecModel = embedModel;
    return vec;
  }

  /**
   * Bloco pronto para colar no prompt. `skills` já chega ordenada por relevância
   * (`selecionar()` ordena por pontuação antes de escolher) — a mais relevante é
   * sempre a primeira.
   *
   * Etapa mínima de Estratégia (Backlog do Copiloto, item m2): antes, quando mais
   * de uma skill relevante batia no mesmo pedido, o prompt só empilhava as
   * instruções de todas lado a lado, sem decidir nada — se duas skills de
   * abordagens diferentes batessem juntas (ex.: "compare o preço de dois X e
   * diga qual é mais barato" ativa "Comparar preços e produtos" — gatilhos
   * "preço"+"mais barato" — junto com "Comparativo" — gatilho "compare" —
   * sem que uma tenha antigatilho contra a outra), o modelo recebia as duas em
   * pé de igualdade e tinha que adivinhar sozinho qual seguir se elas se
   * contradissessem. Agora o prompt nomeia explicitamente qual delas é a
   * PRINCIPAL e instrui a resolver conflito a favor dela — uma decisão de
   * verdade, não mais uma combinação silenciosa.
   *
   * A principal nunca é uma skill `sempre: true` (hoje, só "Pesquisa na web"):
   * ela entra em quase toda combinação da etapa de decisão só por estar
   * sempre ativa, com pontuação artificialmente alta (100+prioridade) pra
   * nunca ser cortada pelo teto de skills — tratá-la como "principal"
   * esconderia a skill de domínio específico que é o motivo real da
   * combinação. A principal é a mais pontuada entre as que NÃO são `sempre`;
   * só cai pra primeira da lista se todas forem `sempre` (não acontece hoje,
   * já que só existe uma).
   */
  static formatar(skills) {
    if (!skills.length) return '';
    if (skills.length === 1) {
      return `\nINSTRUÇÕES ESPECÍFICAS PARA ESTE TIPO DE TAREFA:\n### ${skills[0].nome}\n${skills[0].corpo}\n`;
    }
    const principal = skills.find((s) => !s.sempre) || skills[0];
    const nomesDemais = skills
      .filter((s) => s !== principal)
      .map((s) => `"${s.nome}"`)
      .join(', ');
    return `\nINSTRUÇÕES ESPECÍFICAS PARA ESTE TIPO DE TAREFA — ${skills.length} skills combinadas, "${principal.nome}" é a PRINCIPAL (se alguma instrução abaixo conflitar com as de ${nomesDemais}, siga a principal):\n${skills
      .map((s) => `### ${s.nome}${s === principal ? ' (principal)' : ''}\n${s.corpo}`)
      .join('\n\n')}\n`;
  }

  ler(id) {
    const skill = this.lista.find((s) => s.id === id);
    if (!skill) return null;
    return { ...skill, bruto: fs.readFileSync(skill.caminho, 'utf8') };
  }

  /**
   * Cria uma skill nova na pasta do usuário. Sem `opcoes`, é o esqueleto vazio
   * de sempre (pra edição manual). Com `opcoes`, é o rascunho completo que a
   * criação automática de skills (item 5) propõe — `sugerida: true` marca
   * que é uma sugestão do próprio agente, nunca ativa até você aprovar (ver
   * `selecionar()` e o IPC `skills:aprovarSugestao`), e `autotestada`/
   * `autotesteResumo` registram o resultado da rodada de teste que o agente
   * já fez sozinho antes de chegar até você.
   */
  criar(nome, opcoes = {}) {
    const slug = semAcento(nome)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || `skill-${Date.now()}`;
    const dir = path.join(this.dirUsuario, slug);
    fs.mkdirSync(dir, { recursive: true });
    const arquivo = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(arquivo)) {
      const descricao = String(opcoes.descricao || 'Descreva em uma linha quando esta skill deve ser usada').replace(/[\r\n]+/g, ' ');
      const gatilhos = Array.isArray(opcoes.gatilhos) && opcoes.gatilhos.length ? opcoes.gatilhos : ['palavra1', 'palavra2'];
      const corpo =
        opcoes.corpo ||
        `Escreva aqui o método que o agente deve seguir.

- Seja específico: quais fontes preferir, o que ignorar, como organizar a saída.
- Instrução curta e direta funciona melhor que texto longo.
- Isto entra no prompt quando um dos gatilhos aparecer no pedido do usuário.
`;
      const linhasSugestao = opcoes.sugerida
        ? [
            'sugerida: true',
            `autotestada: ${opcoes.autotestada ? 'true' : 'false'}`,
            opcoes.autotesteResumo
              ? `autoteste_resumo: ${String(opcoes.autotesteResumo).replace(/[\r\n]+/g, ' ').slice(0, 400)}`
              : null,
          ].filter(Boolean)
        : [];

      fs.writeFileSync(
        arquivo,
        `---
nome: ${nome}
descricao: ${descricao}
gatilhos: [${gatilhos.join(', ')}]
ferramentas: []
etapa: ambas
prioridade: 1
${linhasSugestao.map((l) => `${l}\n`).join('')}---

${corpo}
`,
        'utf8'
      );
    }
    this.recarregar();
    return { id: `sua:${slug}`, caminho: arquivo };
  }

  /** Remove `sugerida: true` do frontmatter — aprova uma sugestão pra competir normalmente. */
  aprovarSugestao(id) {
    const skill = this.lista.find((s) => s.id === id);
    if (!skill || !skill.sugerida) return false;
    const bruto = fs.readFileSync(skill.caminho, 'utf8');
    const semSugerida = bruto
      .replace(/^sugerida:\s*true\r?\n/m, '')
      .replace(/^autotestada:\s*(true|false)\r?\n/m, '')
      .replace(/^autoteste_resumo:.*\r?\n/m, '');
    fs.writeFileSync(skill.caminho, semSugerida, 'utf8');
    this.recarregar();
    return true;
  }

  /** Descarta uma sugestão: apaga a pasta inteira. */
  descartarSugestao(id) {
    const skill = this.lista.find((s) => s.id === id);
    if (!skill || !skill.sugerida) return false;
    fs.rmSync(path.dirname(skill.caminho), { recursive: true, force: true });
    this.recarregar();
    return true;
  }
}

module.exports = { Skills, lerMetadados, semAcento };
