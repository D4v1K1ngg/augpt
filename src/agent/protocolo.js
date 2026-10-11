'use strict';

/**
 * Protocolo entre o modelo e o agente.
 *
 * Camadas, em ordem de prioridade:
 *   1. saída estruturada por JSON Schema (o modelo não consegue errar a forma)
 *   2. JSON sintaticamente válido
 *   3. protocolo válido (campos obrigatórios)
 *   4. ferramenta existente
 *   5. argumentos compatíveis
 *   6. recuperação — só quando as anteriores falharem
 *
 * Cada camada produz um erro DIFERENTE, com instrução específica. "Sua resposta
 * não seguiu o protocolo" não diz ao modelo o que consertar; "faltou o campo
 * ferramenta.nome" diz.
 */

const ESTADOS = {
  OK: 'ok',
  JSON_INVALIDO: 'json-invalido',
  PROTOCOLO_INVALIDO: 'protocolo-invalido',
  FERRAMENTA_INVALIDA: 'ferramenta-invalida',
  ARGUMENTOS_INVALIDOS: 'argumentos-invalidos',
};

/* ------------------------------ 1. schema ------------------------------ */

/**
 * Schema da decisão. O enum dos nomes torna ferramenta inexistente impossível
 * por construção — em vez de detectável depois de gastar uma iteração.
 *
 * Deliberadamente raso: obrigatórios só `pensamento` e `ferramenta`. Cada campo
 * exigido a mais é uma chance de o modelo pequeno tropeçar, e nem `raciocinio`
 * nem `critica` mudam a decisão.
 */
function esquemaDeDecisao(ferramentas) {
  const nomes = ferramentas.map((f) => f.name);
  return {
    type: 'object',
    properties: {
      pensamento: { type: 'string' },
      plano: { type: 'array', items: { type: 'string' } },
      critica: { type: 'string' },
      ferramenta: {
        type: 'object',
        properties: {
          nome: { type: 'string', enum: nomes },
          argumentos: { type: 'object' },
        },
        required: ['nome'],
      },
    },
    required: ['pensamento', 'ferramenta'],
  };
}

/* ------------------------------ 2. leitura do JSON ------------------------------ */

/** Recorta o primeiro objeto balanceado, ignorando chaves dentro de strings. */
function recortarObjeto(texto) {
  const inicio = texto.indexOf('{');
  if (inicio === -1) return null;

  let profundidade = 0;
  let emString = false;
  let escape = false;

  for (let i = inicio; i < texto.length; i += 1) {
    const c = texto[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      emString = !emString;
      continue;
    }
    if (emString) continue;
    if (c === '{') profundidade += 1;
    if (c === '}') {
      profundidade -= 1;
      if (profundidade === 0) return texto.slice(inicio, i + 1);
    }
  }
  // objeto aberto e não fechado: acontece quando a geração é truncada
  return profundidade > 0 ? `${texto.slice(inicio)}${'}'.repeat(profundidade)}` : null;
}

/** Conserta os defeitos comuns de modelo pequeno, sem inventar conteúdo. */
function repararJSON(bruto) {
  return (
    bruto
      // vírgula sobrando antes de fechar
      .replace(/,(\s*[}\]])/g, '$1')
      // chave sem aspas: { ferramenta: ... }
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
      // aspas simples em chave ou valor curto
      .replace(/'([^'\n]{0,120})'/g, (m, dentro) => `"${dentro.replace(/"/g, '\\"')}"`)
      // marcador de espaço reservado que o catálogo antigo induzia
      .replace(/:\s*<([^>\n]*)>/g, ': ""')
      // valor sem aspas: { "ferramenta": responder } — comum em modelo pequeno.
      // Preserva true, false, null e números, que são JSON legítimo.
      .replace(
        /:\s*([A-Za-zÀ-ÿ_][\w-]*)\s*([,}\]])/g,
        (inteiro, valor, fim) =>
          /^(true|false|null)$/i.test(valor) ? inteiro : `: "${valor}"${fim}`
      )
  );
}

function extrair(bruto) {
  const texto = String(bruto ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  if (!texto) return null;

  for (const candidato of [texto, recortarObjeto(texto)]) {
    if (!candidato) continue;
    for (const tentativa of [candidato, repararJSON(candidato)]) {
      try {
        const objeto = JSON.parse(tentativa);
        if (objeto && typeof objeto === 'object' && !Array.isArray(objeto)) return objeto;
      } catch {
        /* tenta a próxima estratégia */
      }
    }
  }
  return null;
}

/* ------------------------------ 3. protocolo ------------------------------ */

const CHAVES_DE_FERRAMENTA = ['ferramenta', 'tool', 'acao', 'ação', 'action', 'function'];
const CHAVES_DE_NOME = ['nome', 'name', 'ferramenta', 'tool'];
const CHAVES_DE_ARGUMENTOS = ['argumentos', 'arguments', 'args', 'parametros', 'parâmetros', 'input'];

function primeiroValor(objeto, chaves) {
  for (const chave of chaves) {
    if (objeto?.[chave] !== undefined && objeto[chave] !== null) return objeto[chave];
  }
  return undefined;
}

/**
 * Normaliza as variações que o modelo produz sem quebrar o sentido:
 * `tool`/`action` no lugar de `ferramenta`, `{"ferramenta": "nome"}` como
 * string, argumentos no nível de cima. Não é adivinhação — é sinonímia.
 */
function normalizarDecisao(objeto) {
  if (!objeto || typeof objeto !== 'object') return null;

  let bloco = primeiroValor(objeto, CHAVES_DE_FERRAMENTA);
  let nome;
  let argumentos;

  if (typeof bloco === 'string') {
    nome = bloco;
    argumentos = primeiroValor(objeto, CHAVES_DE_ARGUMENTOS);
  } else if (bloco && typeof bloco === 'object') {
    nome = primeiroValor(bloco, CHAVES_DE_NOME);
    argumentos = primeiroValor(bloco, CHAVES_DE_ARGUMENTOS) ?? primeiroValor(objeto, CHAVES_DE_ARGUMENTOS);
    if (typeof nome !== 'string' && Object.keys(bloco).length === 1) {
      // { "ferramenta": { "ler_arquivo": { "caminho": "x" } } }
      const [unica] = Object.keys(bloco);
      nome = unica;
      argumentos = bloco[unica];
    }
  }

  if (typeof nome !== 'string' || !nome.trim()) return null;

  if (typeof argumentos === 'string') {
    const interno = extrair(argumentos);
    argumentos = interno || {};
  }
  if (!argumentos || typeof argumentos !== 'object' || Array.isArray(argumentos)) argumentos = {};

  return {
    pensamento: typeof objeto.pensamento === 'string' ? objeto.pensamento : objeto.thought || '',
    raciocinio: typeof objeto.raciocinio === 'string' ? objeto.raciocinio : '',
    plano: Array.isArray(objeto.plano) ? objeto.plano.filter((p) => typeof p === 'string') : [],
    critica: typeof objeto.critica === 'string' ? objeto.critica : '',
    ferramenta: { nome: nome.trim(), argumentos },
  };
}

/* ------------------------------ 4. recuperação ------------------------------ */

/**
 * JSON válido que não é decisão pode ainda assim ser intenção clara.
 * `{"resposta": "Python é..."}` não é ruído: é o modelo respondendo direto.
 * Converter custa zero chamadas; pedir de novo custa uma iteração inteira e
 * pode falhar igual.
 */
function recuperar(objeto, catalogo) {
  if (!objeto || typeof objeto !== 'object') return null;
  const chaves = Object.keys(objeto);

  // respondeu direto, sem embrulhar em decisão
  const respostaDireta = objeto.resposta ?? objeto.answer ?? objeto.texto ?? objeto.conteudo;
  if (typeof respostaDireta === 'string' && respostaDireta.trim().length > 15) {
    return {
      decisao: {
        pensamento: 'Resposta entregue diretamente.',
        raciocinio: '',
        plano: [],
        critica: '',
        ferramenta: {
          nome: 'responder',
          argumentos: { foco: respostaDireta.slice(0, 600), fontes: objeto.fontes || [] },
        },
      },
      via: 'resposta-direta',
    };
  }

  // usou o nome da ferramenta como chave de primeiro nível
  const nomes = new Set(catalogo.map((f) => f.name));
  const candidata = chaves.find((k) => nomes.has(k));
  if (candidata) {
    const valor = objeto[candidata];
    return {
      decisao: {
        pensamento: typeof objeto.pensamento === 'string' ? objeto.pensamento : '',
        raciocinio: '',
        plano: [],
        critica: '',
        ferramenta: {
          nome: candidata,
          argumentos: valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {},
        },
      },
      via: 'ferramenta-como-chave',
    };
  }

  return null;
}

/** Distância de edição real, limitada — só interessa saber se é perto. */
function distancia(a, b, teto = 3) {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let melhorDaLinha = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      melhorDaLinha = Math.min(melhorDaLinha, atual[j]);
    }
    if (melhorDaLinha > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Nome parecido com o de uma ferramenta real.
 *
 * A primeira versão só media distância quando um nome continha o outro, e por
 * isso deixava passar o caso mais comum: "busca_no_projeto" no lugar de
 * "buscar_no_projeto" — uma letra. Agora é distância de edição de verdade.
 */
function ferramentaParecida(nome, catalogo) {
  const alvo = String(nome).toLowerCase().replace(/[^a-z]/g, '');
  if (!alvo) return null;

  let melhor = null;
  let menor = Infinity;

  for (const f of catalogo) {
    const candidato = f.name.toLowerCase().replace(/[^a-z]/g, '');
    if (candidato === alvo) return f.name;
    const d = distancia(candidato, alvo);
    if (d < menor) {
      menor = d;
      melhor = f.name;
    }
  }

  // proporcional ao tamanho: nome curto tolera menos erro que nome longo
  const limite = Math.max(1, Math.min(3, Math.floor(alvo.length / 6)));
  return menor <= limite ? melhor : null;
}

/* ------------------------------ 5. argumentos ------------------------------ */

/**
 * Coage o que dá e reprova o que falta. A coerção evita retry por diferença de
 * tipo — modelo pequeno manda número como string o tempo todo.
 */
function validarArgumentos(ferramenta, argumentos) {
  const declarados = Object.keys(ferramenta.args || {});
  const obrigatorios = Array.isArray(ferramenta.obrigatorios)
    ? ferramenta.obrigatorios
    : declarados.slice(0, 1); // por convenção, o primeiro argumento é o essencial

  const limpos = { ...argumentos };
  for (const [chave, valor] of Object.entries(limpos)) {
    if (typeof valor !== 'string') continue;
    const podado = valor.trim();
    // resquício de espaço reservado: <descrição>, {valor}, "string"
    // "string — descrição" é o valor de exemplo do catálogo; copiado ao pé da
    // letra, não é argumento de verdade
    if (
      /^<.*>$/.test(podado) ||
      /^\{\{?\w+\}?\}$/.test(podado) ||
      podado === 'string' ||
      /^(string|número|number|array|lista)\s*[—-]/i.test(podado)
    ) {
      delete limpos[chave];
      continue;
    }
    if (/^\s*[[{]/.test(podado)) {
      try {
        limpos[chave] = JSON.parse(podado);
      } catch {
        /* mantém como string */
      }
    }
  }

  const faltando = obrigatorios.filter((a) => {
    const v = limpos[a];
    return v === undefined || v === null || (typeof v === 'string' && !v.trim());
  });

  const desconhecidos = Object.keys(limpos).filter((a) => declarados.length && !declarados.includes(a));

  return { argumentos: limpos, faltando, desconhecidos, valido: faltando.length === 0 };
}

/**
 * Argumento preenchido mas SEM SENTIDO (revisão v3, chats de 29/09): o 7B,
 * vetado e sem saída, buscou "listar_arquivos", "ler_arquivo -225" (nome de
 * ferramenta como assunto) e URLs que ele mesmo inventou
 * ("youtube.com/watch?v=tutorial_planejamento_tatico…") — 40 páginas lidas
 * sobre como listar arquivos em Python. Devolve {motivo, instrucao} ou null.
 */
function chaveDeUrlSimples(bruta) {
  try {
    const u = new URL(String(bruta).trim().replace(/[.,;:!?]+$/, ''));
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}
function argumentoSemSentido(ferramenta, argumentos = {}, { catalogo = [], urlsVistas = null } = {}) {
  const nomes = new Set((catalogo || []).map((f) => f.name).filter(Boolean));
  // Revisão v4 (Kinera): o 7B embrulhou a consulta na chamada —
  // "pesquisar_e_ler(comentários uso fones jogos fps)". O assunto está ali
  // dentro: desembrulha em vez de gastar um passo recusando.
  // (só nome de ferramenta do catálogo ou com prefixo de ação: "read_csv(delimiter)" é busca de verdade)
  const embrulho = (c) => {
    const m = /^\s*([a-z]+(?:_[a-z]+)+)\(\s*["']?(.+?)["']?\s*\)\s*$/i.exec(String(c || ''));
    return m && (nomes.has(m[1].toLowerCase()) || /^(listar|ler|escrever|buscar|gerar|executar|abrir|pesquisar|investigar|consultar|salvar|inspecionar)_/i.test(m[1])) ? m : null;
  };
  if (argumentos && typeof argumentos.consulta === 'string' && embrulho(argumentos.consulta)) argumentos.consulta = embrulho(argumentos.consulta)[2];
  if (argumentos && Array.isArray(argumentos.consultas)) argumentos.consultas = argumentos.consultas.map((c) => (typeof c === 'string' && embrulho(c) ? embrulho(c)[2] : c));
  const consultas = [
    ...(typeof argumentos.consulta === 'string' ? [argumentos.consulta] : []),
    ...(Array.isArray(argumentos.consultas) ? argumentos.consultas.filter((c) => typeof c === 'string') : []),
  ];
  for (const consulta of consultas) {
    const c = consulta.trim();
    // "pesquisar_e_ler(comentários…)": o parêntese colado escondia o nome (revisão v4, Kinera)
    const primeira = c.split(/[\s(]+/)[0].toLowerCase();
    // achado do revisor: "os_walk python", "read_csv", "node_modules" são buscas
    // legítimas de programação — só conta nome de ferramenta DO CATÁLOGO ou
    // com prefixo de ação de ferramenta (listar_, ler_, gerar_…)
    if (/^[a-z]+(_[a-z]+)+$/.test(primeira) && (nomes.has(primeira) || /^(listar|ler|escrever|buscar|gerar|executar|apagar|acrescentar|abrir|pesquisar|investigar|consultar|salvar|inspecionar|restaurar)_/.test(primeira))) {
      return {
        motivo: `"${c}" é nome de ferramenta, não assunto de busca (${ferramenta.name})`,
        instrucao:
          `"${primeira}" é o NOME de uma ferramenta, não um assunto para pesquisar. ` +
          (nomes.has(primeira) ? `Para usá-la, chame {"ferramenta": {"nome": "${primeira}", ...}}. ` : '') +
          'Para pesquisar, escreva na consulta o ASSUNTO do pedido do usuário. Se o material já basta, chame "responder".',
      };
    }
    if (/^https?:\/\//i.test(c) && urlsVistas && !urlsVistas.has(chaveDeUrlSimples(c.split(/\s+/)[0]))) {
      return {
        motivo: `URL que não apareceu em nenhum resultado usada como consulta (${ferramenta.name})`,
        instrucao:
          'Essa URL não apareceu em nenhum resultado desta execução — não invente endereço. ' +
          'Pesquise pelo ASSUNTO (palavras, não URL), ou use uma URL que veio de um resultado de busca.',
      };
    }
  }
  return null;
}

/* ------------------------------ orquestração ------------------------------ */

/**
 * Analisa a resposta bruta e devolve sempre um veredicto explícito:
 * { estado, decisao?, ferramenta?, motivo, instrucao, recuperado? }
 */
function analisar(bruto, { catalogo, obterFerramenta, urlsVistas = null }) {
  const objeto = extrair(bruto);
  if (!objeto) {
    return {
      estado: ESTADOS.JSON_INVALIDO,
      motivo: 'não foi possível ler um objeto JSON na resposta',
      instrucao: instrucao(ESTADOS.JSON_INVALIDO),
    };
  }

  let decisao = normalizarDecisao(objeto);
  let recuperado = null;

  if (!decisao) {
    const salvamento = recuperar(objeto, catalogo);
    if (!salvamento) {
      const presentes = Object.keys(objeto).slice(0, 6).join(', ') || '(vazio)';
      return {
        estado: ESTADOS.PROTOCOLO_INVALIDO,
        motivo: `JSON válido, mas sem "ferramenta.nome" (campos recebidos: ${presentes})`,
        instrucao: instrucao(ESTADOS.PROTOCOLO_INVALIDO),
      };
    }
    decisao = salvamento.decisao;
    recuperado = salvamento.via;
  }

  const nome = decisao.ferramenta.nome;
  let ferramenta = obterFerramenta(nome);

  if (!ferramenta) {
    const parecida = ferramentaParecida(nome, catalogo);
    if (parecida) {
      ferramenta = obterFerramenta(parecida);
      decisao.ferramenta.nome = parecida;
      recuperado = recuperado || 'nome-aproximado';
    }
  }

  if (!ferramenta) {
    return {
      estado: ESTADOS.FERRAMENTA_INVALIDA,
      decisao,
      motivo: `a ferramenta "${nome}" não existe ou está desativada`,
      instrucao: instrucao(ESTADOS.FERRAMENTA_INVALIDA, { nome, catalogo }),
    };
  }

  const argumentos = validarArgumentos(ferramenta, decisao.ferramenta.argumentos);
  decisao.ferramenta.argumentos = argumentos.argumentos;

  if (!argumentos.valido) {
    return {
      estado: ESTADOS.ARGUMENTOS_INVALIDOS,
      decisao,
      ferramenta,
      motivo: `faltou ${argumentos.faltando.map((a) => `"${a}"`).join(' e ')} em ${ferramenta.name}`,
      instrucao: instrucao(ESTADOS.ARGUMENTOS_INVALIDOS, { ferramenta, faltando: argumentos.faltando }),
    };
  }

  const semSentido = argumentoSemSentido(ferramenta, decisao.ferramenta.argumentos, { catalogo, urlsVistas });
  if (semSentido) {
    return { estado: ESTADOS.ARGUMENTOS_INVALIDOS, decisao, ferramenta, motivo: semSentido.motivo, instrucao: semSentido.instrucao };
  }

  return { estado: ESTADOS.OK, decisao, ferramenta, recuperado };
}

/** Mensagem de correção específica para cada camada que falhou. */
function instrucao(estado, dados = {}) {
  switch (estado) {
    case ESTADOS.JSON_INVALIDO:
      return [
        'Sua resposta não foi um objeto JSON.',
        'Escreva apenas o objeto, começando com { e terminando com }.',
        'Sem markdown, sem crase, sem texto antes ou depois.',
      ].join(' ');

    case ESTADOS.PROTOCOLO_INVALIDO:
      return [
        'O JSON é válido mas está fora do protocolo: falta "ferramenta" com o campo "nome".',
        'Formato exato: {"pensamento": "...", "ferramenta": {"nome": "...", "argumentos": {}}}',
      ].join(' ');

    case ESTADOS.FERRAMENTA_INVALIDA:
      return [
        `A ferramenta "${dados.nome}" não existe.`,
        `Escolha uma destas: ${(dados.catalogo || []).map((f) => f.name).join(', ')}.`,
        'Copie o nome exatamente como está na lista.',
      ].join(' ');

    case ESTADOS.ARGUMENTOS_INVALIDOS: {
      const modelo = Object.fromEntries(
        Object.keys(dados.ferramenta?.args || {}).map((a) => [a, dados.faltando?.includes(a) ? 'PREENCHA' : ''])
      );
      return [
        `Faltou ${dados.faltando.map((a) => `"${a}"`).join(' e ')} nos argumentos de ${dados.ferramenta.name}.`,
        `Repita a mesma decisão preenchendo: ${JSON.stringify(modelo)}`,
      ].join(' ');
    }

    default:
      return '';
  }
}

module.exports = {
  ESTADOS,
  esquemaDeDecisao,
  extrair,
  normalizarDecisao,
  recuperar,
  validarArgumentos,
  argumentoSemSentido,
  ferramentaParecida,
  analisar,
  instrucao,
  recortarObjeto,
  repararJSON,
};
