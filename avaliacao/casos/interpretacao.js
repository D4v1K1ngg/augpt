'use strict';

const { pareceParafrase } = require('../../src/agent/verificador');

/**
 * Crítico de interpretação (v0.5.4) — extensão focada da mesma checagem de
 * ambiguidade (item 4): além de "falta um dado?" e "reescreva sem depender
 * da conversa", agora também detecta quando o pedido admite duas DIREÇÕES
 * de busca genuinamente diferentes (não "poderia ser mais específico" — duas
 * leituras que levam a pesquisar/responder coisas diferentes).
 *
 * Motivado por um caso real de produção: "como ficar melhor no jogo PUBG de
 * PC" foi entendido como desempenho técnico (FPS) quando a intenção era
 * habilidade de jogo (mira, posicionamento, estratégia) — o agente nunca
 * teve chance de considerar a outra leitura.
 *
 * Quando a bifurcação é detectada, uma SEGUNDA chamada condicional (o
 * "crítico") decide qual leitura é mais provável. Só quando não tem certeza
 * (confiança não é "alta") é que a alternativa aparece — como nota no fim da
 * resposta final — em vez de escolher e seguir calado.
 */

const BIFURCACAO =
  'BIFURCACAO: melhorar o desempenho técnico do jogo (FPS, configuração gráfica, hardware) || melhorar a habilidade de jogo (mira, posicionamento, decisões durante a partida)';

module.exports = [
  {
    nome: 'crítico de interpretação: bifurcação detectada + crítico confiante escolhe e NÃO deixa nota',
    pedido: 'Como ficar melhor no jogo PUBG de PC?',
    ambiguidade: `suficiente\nComo ficar melhor no jogo PUBG de PC?\n${BIFURCACAO}`,
    criticaDeInterpretacao:
      'ESCOLHA: B\nCONFIANCA: alta\nMOTIVO: a pergunta é sobre desempenho no jogo, não configuração de hardware.',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'como jogar melhor' } }],
    redacao: 'Dicas de mira, posicionamento e leitura de partida.',
    espera: {
      ok: true,
      interpretacaoEscolhida: 'melhorar a habilidade de jogo (mira, posicionamento, decisões durante a partida)',
      promptDecisaoContem: ['(especificamente: melhorar a habilidade de jogo'],
      respostaNaoContem: ['se na verdade era sobre'],
    },
  },

  {
    nome: 'crítico de interpretação: bifurcação detectada + crítico sem confiança deixa nota da alternativa na resposta final',
    pedido: 'Como ficar melhor no jogo PUBG de PC?',
    ambiguidade: `suficiente\nComo ficar melhor no jogo PUBG de PC?\n${BIFURCACAO}`,
    criticaDeInterpretacao: 'ESCOLHA: A\nCONFIANCA: baixa\nMOTIVO: pode ser qualquer um dos dois.',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'como jogar melhor' } }],
    redacao: 'Configurações gráficas recomendadas pra mais FPS.',
    espera: {
      ok: true,
      interpretacaoEscolhida: 'melhorar o desempenho técnico do jogo (FPS, configuração gráfica, hardware)',
      respostaContem: ['se na verdade era sobre "melhorar a habilidade de jogo'],
    },
  },

  {
    nome: 'crítico de interpretação: sem bifurcação (caso comum), nada muda — nem chamada extra, nem nota',
    pedido: 'Liste a pasta e responda.',
    // sem `ambiguidade` explícito: usa o padrão do servidor falso, 'suficiente'
    // (sem linha BIFURCACAO) — o mesmo default que o resto da bancada usa.
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'a pasta' } },
    ],
    redacao: 'Pasta listada.',
    espera: { ok: true, interpretacaoNaoBifurcada: true, respostaNaoContem: ['se na verdade era sobre'] },
  },

  /* ------------------- rede de segurança: descartar bifurcação falsa ------------------- */

  {
    // Caso real de produção (log de hoje): "procure pelos melhores preços da
    // RTX 5080" bifurcou em "(especificamente: buscar os melhores preços
    // online)" — não era uma segunda leitura, era a MESMA coisa reformulada.
    // Reproduzido aqui com as duas opções parecidas que o modelo teria
    // proposto: `pareceParafrase` deve descartar antes de chamar o crítico.
    nome: 'crítico de interpretação: bifurcação com opções parecidas demais (paráfrase) é descartada, sem chamar o crítico',
    pedido: 'Procure pelos melhores preços da RTX 5080 no Brasil.',
    ambiguidade:
      'suficiente\nProcure pelos melhores preços da RTX 5080 no Brasil.\n' +
      'BIFURCACAO: buscar os melhores preços da RTX 5080 online || comparar os preços da RTX 5080 em lojas diferentes',
    // se a bifurcação NÃO fosse descartada, o crítico escolheria B — dá pra
    // provar que ele nunca foi chamado porque o objetivo final não ganha o
    // sufixo "(especificamente: ...)" nem o evento interpretacao-escolhida dispara
    criticaDeInterpretacao: 'ESCOLHA: B\nCONFIANCA: alta\nMOTIVO: teste — não deveria nem ser chamado.',
    roteiro: [
      { ferramenta: 'buscar_produtos', argumentos: { consulta: 'RTX 5080' } },
      { ferramenta: 'responder', argumentos: { foco: 'preços' } },
    ],
    redacao: 'Preços encontrados.',
    espera: { ok: true, interpretacaoNaoBifurcada: true },
  },

  {
    // Contraste: quando o pedido já enumera ele mesmo os pontos que quer
    // (padrão do caso real da análise política/econômica/social do Brasil),
    // as duas "opções" que o modelo proporia tendem a compartilhar quase
    // todo o vocabulário do próprio pedido — também deve ser descartado.
    nome: 'crítico de interpretação: pedido que já enumera os próprios pontos não bifurca de verdade',
    pedido: 'Analise as questões políticas, econômicas e sociais do Brasil entre 2000 e 2026.',
    ambiguidade:
      'suficiente\nAnalise as questões políticas, econômicas e sociais do Brasil entre 2000 e 2026.\n' +
      'BIFURCACAO: análise focada em políticas internas e econômico-sociais || análise das questões políticas, econômicas e sociais do país',
    criticaDeInterpretacao: 'ESCOLHA: A\nCONFIANCA: alta\nMOTIVO: teste — não deveria nem ser chamado.',
    roteiro: [{ ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'Brasil 2000 2026' } }, { ferramenta: 'responder', argumentos: { foco: 'análise' } }],
    redacao: 'Análise completa do período.',
    espera: { ok: true, interpretacaoNaoBifurcada: true },
  },

  /* ------------------- rede de segurança: não bifurcar em cima de reescrita ------------------- */

  {
    // Bug real de produção (bateria de testes com o Davi, "Teste 4"): pedido
    // original "O que é machine learning, em uma frase?", seguido de "faz de
    // novo, mas em duas frases". A reescrita de ambiguidade (que VÊ a
    // conversa) resolveu certo pra "Fale sobre machine learning em duas
    // frases" — mas a MESMA chamada também propôs uma bifurcação, e
    // `decidirInterpretacao` (chamado a seguir SEM ver a conversa) escolheu
    // "aplicações práticas" — um assunto nunca mencionado, produzindo uma
    // resposta sem nenhuma busca sobre um tema inventado. Reproduzido aqui:
    // conversa presente + ambiguidade devolve reescrita E bifurcação juntas
    // — a bifurcação deve ser descartada porque o objetivo já foi reescrito
    // usando a conversa, não porque as opções são parecidas (não são).
    nome: 'crítico de interpretação: pedido reescrito a partir da conversa NÃO bifurca, mesmo quando a verificação propõe bifurcação (evita interpretação inventada sem contexto)',
    pedido: 'faz de novo, mas em duas frases',
    conversa: [
      { role: 'user', content: 'O que é machine learning, em uma frase?' },
      { role: 'assistant', content: 'Machine learning é um subcampo da IA que aprende padrões a partir de dados.' },
    ],
    // As duas opções abaixo são propositalmente pouco parecidas entre si
    // (bem menos sobreposição de vocabulário que "explicar o conceito" vs.
    // "descrever aplicações práticas") — precisam SOBREVIVER ao
    // `pareceParafrase` pra que este teste prove o mecanismo certo (skip por
    // reescrita) e não, sem querer, prove só a rede de segurança de
    // paráfrase que já existia antes.
    ambiguidade:
      'suficiente\nFale sobre machine learning em duas frases.\n' +
      'BIFURCACAO: o que machine learning significa como conceito de inteligência artificial || onde machine learning é aplicado na prática, como recomendação e diagnóstico médico',
    // se a bifurcação NÃO fosse descartada, o crítico escolheria B — dá pra
    // provar que ele nunca foi chamado porque o objetivo final não ganha o
    // sufixo "(especificamente: ...)" nem o evento interpretacao-escolhida dispara
    criticaDeInterpretacao: 'ESCOLHA: B\nCONFIANCA: alta\nMOTIVO: teste — não deveria nem ser chamado.',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'machine learning' } }],
    redacao: 'Machine learning é uma área da IA. Ela aprende padrões a partir de dados.',
    espera: {
      ok: true,
      objetivoReescritoPara: 'Fale sobre machine learning em duas frases.',
      interpretacaoNaoBifurcada: true,
      promptDecisaoNaoContem: ['especificamente: onde machine learning é aplicado'],
    },
  },

  {
    nome: 'pareceParafrase: opções de verdade diferentes (PUBG desempenho vs. habilidade) não são descartadas',
    tipo: 'unidade',
    executar() {
      return [
        !pareceParafrase(
          'melhorar o desempenho técnico do jogo (FPS, configuração gráfica, hardware)',
          'melhorar a habilidade de jogo (mira, posicionamento, decisões durante a partida)'
        ) || 'opções genuinamente diferentes foram marcadas como paráfrase',
      ];
    },
  },

  {
    nome: 'pareceParafrase: opções que são a mesma coisa reformulada são descartadas',
    tipo: 'unidade',
    executar() {
      return [
        pareceParafrase(
          'buscar os melhores preços da RTX 5080 online',
          'comparar os preços da RTX 5080 em lojas diferentes'
        ) || 'opções que são basicamente a mesma coisa não foram descartadas',
        pareceParafrase(
          'análise focada em políticas internas e econômico-sociais',
          'análise das questões políticas, econômicas e sociais do país'
        ) || 'reformulação quase idêntica não foi descartada',
      ];
    },
  },

  {
    nome: 'pareceParafrase: frase sem termo suficiente pra comparar não é descartada (evita falso positivo por falta de dado)',
    tipo: 'unidade',
    executar() {
      return [!pareceParafrase('sim', 'não') || 'frases curtas demais foram descartadas sem base suficiente'];
    },
  },
];
