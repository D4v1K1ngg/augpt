'use strict';

const {
  pedeConversaCompleta, pedidoDeAmbiguidade, pedidoDeResposta,
  pedidoDeCriticaDoPlano, pedidoDeConsultaCritico, pedidoDeCriticaAutomatica,
} = require('../../src/agent/prompts');

module.exports = [
  {
    nome: 'skill de documento ativa e traz suas ferramentas',
    pedido: 'Analise esse boleto anexado',
    arquivos: { 'boleto.txt': 'Vencimento 17/08/2026, valor R$ 410,49.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'valor e vencimento' } },
    ],
    espera: {
      skillsAtivadas: ['Analisar documento anexado'],
      promptDecisaoContem: ['ler_documento', 'inspecionar_arquivo'],
      promptRedacaoContem: ['Reproduza número exatamente'],
    },
  },

  {
    nome: 'prompt de decisão orienta a nunca terminar pedido de arquivo em "responder"',
    // Bug real: pedido de documento (pdf/docx/etc.) às vezes terminava em
    // "responder" com o texto de cobertura ausente, sem o arquivo ter sido
    // gerado — a busca falhava e o agente desistia em vez de criar o arquivo
    // com conhecimento próprio. Regra explícita no prompt pra cobrir isso.
    pedido: 'Gere um PDF explicando o que é hyperthreading',
    roteiro: [
      { ferramenta: 'gerar_pdf', argumentos: { caminho: 'hyperthreading.pdf', conteudo: '# Hyperthreading\n\nExplicação.' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'PDF gerado.' } },
    ],
    espera: {
      ok: true,
      promptDecisaoContem: [
        'PEDIDO DE ARQUIVO NUNCA TERMINA EM',
        'Falta de resultado de busca',
      ],
    },
  },

  {
    // Bug real: o usuário pediu "gere um pdf com esse texto (Sobre DLSS e
    // FSR...)" colando o conteúdo inteiro no próprio pedido, e o agente saiu
    // pesquisando na web em vez de simplesmente usar o texto já fornecido —
    // gastou 3 passos, duas buscas e dezenas de milhares de tokens, nunca
    // gerou o PDF e a resposta final acabou falando de um jogo completamente
    // diferente (Destiny 2). Regra explícita no prompt pra cobrir isso.
    nome: 'prompt de decisão orienta a não pesquisar quando o texto já veio no pedido',
    pedido: 'gere um pdf com esse texto (Sobre DLSS e FSR: tecnologias de upscaling por IA da NVIDIA e AMD.)',
    roteiro: [
      { ferramenta: 'gerar_pdf', argumentos: { caminho: 'dlss-fsr.pdf', conteudo: 'Sobre DLSS e FSR: tecnologias de upscaling por IA da NVIDIA e AMD.' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'PDF gerado.' } },
    ],
    espera: {
      ok: true,
      promptDecisaoContem: [
        'SE O TEXTO JÁ ESTÁ NO PEDIDO, NÃO PESQUISE',
      ],
    },
  },

  {
    nome: 'skill de clima ativa e a de código não',
    pedido: 'Qual a previsão do tempo para Vitória nesta semana?',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'previsão' } }],
    espera: {
      skillsAtivadas: ['Previsão do tempo'],
      skillsNaoAtivadas: ['Revisão de código'],
      promptDecisaoContem: ['churrasco'],
    },
  },

  {
    nome: 'skill desativada não entra no prompt',
    pedido: 'Qual a previsão do tempo?',
    skillsDesativadas: ['embutida:previsao-do-tempo'],
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'previsão' } }],
    espera: { promptDecisaoNaoContem: ['churrasco'], skillsNaoAtivadas: ['Previsão do tempo'] },
  },

  {
    nome: 'ferramenta desativada some do catálogo e é recusada',
    pedido: 'Calcule uma conta',
    ferramentasDesativadas: ['calcular'],
    roteiro: [
      { ferramenta: 'calcular', argumentos: { expressao: '2+2' } },
      { ferramenta: 'responder', argumentos: { foco: 'resultado' } },
    ],
    // a recusa agora acontece na camada de protocolo, antes de executar
    espera: {
      promptDecisaoNaoContem: ['- calcular:'],
      protocoloRecusou: 'ferramenta-invalida',
      instrucaoContem: ['"calcular" não existe'],
    },
  },

  {
    nome: 'ferramenta externa aparece no catálogo',
    pedido: 'Calcule 1250 vezes 1,18',
    roteiro: [
      { ferramenta: 'calcular', argumentos: { expressao: '1250 * 1.18' } },
      { ferramenta: 'responder', argumentos: { foco: 'o total' } },
    ],
    espera: { ok: true, promptDecisaoContem: ['calcular'], ferramentasChamadas: ['calcular'] },
  },

  {
    nome: 'skill de auto-conhecimento não rouba pedido de geração',
    pedido: 'Gere um pdf com o relatório de vendas',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o pdf' } }],
    espera: { skillsAtivadas: ['Gerar PDF, Word e Excel'], skillsNaoAtivadas: ['O próprio AuGPT'] },
  },

  {
    // Bug real (v0.5.7, achado ao vivo): pergunta sobre PUBG/UE5
    // gerou uma resposta longa (tabela + seção "Impacto no Desempenho" +
    // fontes). "gere um pdf com a nossa conversa" logo depois produziu um PDF
    // só com a tabela — o resto da resposta anterior tinha sido cortado em 800
    // caracteres antes de chegar no modelo. Este caso reproduz isso: a
    // resposta anterior tem um marcador bem depois dos 800 caracteres, e o
    // pedido pede a conversa — o marcador precisa sobreviver no prompt.
    nome: 'pedido pela "nossa conversa" recebe o histórico sem o corte de 800 caracteres',
    pedido: 'gere um pdf com a nossa conversa',
    conversa: [
      { role: 'user', content: 'Como será o PUBG no PC na Unreal Engine 5?' },
      {
        role: 'assistant',
        content: `${'x'.repeat(850)} MARCADOR-QUE-SUMIA-DEPOIS-DE-800-CARACTERES: seção de impacto no desempenho`,
      },
    ],
    roteiro: [
      { ferramenta: 'gerar_pdf', argumentos: { caminho: 'conversa.pdf', conteudo: 'resumo' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'PDF gerado.' } },
    ],
    espera: { promptDecisaoContem: ['MARCADOR-QUE-SUMIA-DEPOIS-DE-800-CARACTERES'] },
  },

  {
    // O inverso: quando a conversa é só CONTEXTO (pedido comum, não fala da
    // conversa em si), o corte de 800 caracteres continua valendo — não faz
    // sentido inflar todo prompt de decisão à toa.
    nome: 'pedido comum (não sobre a conversa) mantém o corte de 800 caracteres',
    pedido: 'e quanto ao preço?',
    conversa: [
      { role: 'user', content: 'Me fale sobre o produto X' },
      {
        role: 'assistant',
        content: `${'x'.repeat(850)} MARCADOR-QUE-DEVE-SUMIR-DEPOIS-DE-800-CARACTERES`,
      },
    ],
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o preço' } }],
    espera: { promptDecisaoNaoContem: ['MARCADOR-QUE-DEVE-SUMIR-DEPOIS-DE-800-CARACTERES'] },
  },

  {
    // Bug real (achado ao revisar o chat do Davi sobre PMBOK, 2026-09-19):
    // mesmo com o corte de 800 caracteres já resolvido (os dois casos acima),
    // "gere um pdf com a nossa conversa" ainda saiu com o conteúdo de OUTRO
    // PDF que já existia na pasta de trabalho com nome parecido
    // ("conversa_com_usuario.pdf", de um pedido anterior sobre um assunto
    // totalmente diferente — no caso real, uma conversa sobre PMBOK virou um
    // PDF sobre o Sol). O modelo seguiu a regra 2 ("antes de criar arquivos,
    // verifique o que já existe com listar_arquivos") longe demais: leu o
    // arquivo velho com ler_arquivo e tratou o conteúdo dele como se fosse
    // esta conversa, mesmo com "CONVERSA ATÉ AQUI" corretamente disponível no
    // prompt. Regra 6d nova instrui explicitamente a nunca usar um arquivo
    // pré-existente como fonte quando o pedido é sobre a própria conversa.
    nome: 'pedido pela "nossa conversa" recebe a regra 6d, avisando para não usar arquivo pré-existente como fonte',
    pedido: 'gere um pdf com a nossa conversa',
    conversa: [
      { role: 'user', content: 'Me explique o PMBOK' },
      { role: 'assistant', content: 'O PMBOK é um guia de gestão de projetos.' },
    ],
    roteiro: [
      { ferramenta: 'gerar_pdf', argumentos: { caminho: 'conversa.pdf', conteudo: 'resumo' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'PDF gerado.' } },
    ],
    espera: {
      promptDecisaoContem: [
        'ESTE PEDIDO É SOBRE A PRÓPRIA CONVERSA',
        'não leia nem reaproveite o conteúdo dele',
      ],
    },
  },

  {
    // Contraprova: pedido comum (não fala da conversa em si) não deveria
    // ganhar a regra 6d — ela só faz sentido, e só deveria aparecer, quando
    // pedeConversaCompleta() reconhece o pedido; inflar o prompt à toa em
    // todo pedido não ajuda em nada.
    nome: 'pedido comum (não sobre a conversa) NÃO recebe a regra 6d',
    pedido: 'qual a capital da frança',
    conversa: [{ role: 'user', content: 'oi' }],
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a capital' } }],
    espera: { promptDecisaoNaoContem: ['ESTE PEDIDO É SOBRE A PRÓPRIA CONVERSA'] },
  },

  {
    nome: 'pedeConversaCompleta: reconhece pedido sobre a conversa em si, não pedidos comuns',
    tipo: 'unidade',
    async executar() {
      return [
        pedeConversaCompleta('gere um pdf com a nossa conversa') || 'deveria reconhecer "nossa conversa"',
        pedeConversaCompleta('faça um resumo da conversa') || 'deveria reconhecer "resumo da conversa"',
        pedeConversaCompleta('salve esse chat inteiro num arquivo') || 'deveria reconhecer "chat inteiro"',
        !pedeConversaCompleta('Como será o PUBG no PC na Unreal Engine 5?') ||
          'pergunta comum não deveria contar como pedido sobre a conversa',
        !pedeConversaCompleta('e quanto ao preço?') || 'pergunta de acompanhamento comum não deveria contar',
      ];
    },
  },

  {
    // Bug real de produção (12/09, achado ao analisar o log de um chat ao
    // vivo): "Tente novamente" continuando uma conversa cuja mensagem
    // anterior era uma prova de 6 questões (~2000+ caracteres) — o teto de
    // 400 caracteres por mensagem em `historicoRecente` só deixava o
    // modelo ver até por volta da Questão 2 pra decidir o que "tente
    // novamente" queria dizer. A reescrita saiu incompleta (só sobre o
    // fragmento visível), `classificarPedido` nunca classificou como
    // complexo, e a resposta final divagou sobre um assunto isolado sem
    // nenhuma proteção do plano forçado. Mesmo padrão de teste do caso
    // acima ("nossa conversa" / corte de 800), só que no prompt de
    // ambiguidade em vez do de decisão.
    nome: 'pedidoDeAmbiguidade: histórico da conversa não corta mais em 400 caracteres (caso real: "Tente novamente" continuando uma prova de 6 questões)',
    tipo: 'unidade',
    async executar() {
      const mensagemLonga = `${'x'.repeat(1200)} MARCADOR-QUE-SUMIA-DEPOIS-DE-400-CARACTERES: questão 6, sobre o Algoritmo de Dijkstra`;
      const prompt = pedidoDeAmbiguidade({
        objetivo: 'Tente novamente',
        conversa: [{ role: 'user', content: mensagemLonga }],
      });
      return [
        prompt.includes('MARCADOR-QUE-SUMIA-DEPOIS-DE-400-CARACTERES') ||
          'o histórico recente (historicoRecente) ainda está cortando a mensagem anterior antes do marcador',
      ];
    },
  },

  {
    // Backlog do Copiloto, item c1 (Estruturação): o esboço por tópico
    // (esbocoPorTopico, verificador.js) só tem efeito de verdade se o
    // próprio prompt de redação avisar, pergunta por pergunta, onde falta
    // material — senão o cálculo existe mas o redator nunca vê o resultado.
    nome: 'pedidoDeResposta: avisa explicitamente qual pergunta ficou sem material no esboço do dossiê',
    tipo: 'unidade',
    async executar() {
      const perguntas = ['O que é NP-completo', 'O que é thrashing', 'Como funciona o Paxos'];
      const esboco = [
        { parte: perguntas[0], temMaterial: true },
        { parte: perguntas[1], temMaterial: true },
        { parte: perguntas[2], temMaterial: false },
      ];
      const prompt = pedidoDeResposta({ objetivo: 'prova de 3 perguntas', material: 'algo', perguntas, esboco });

      return [
        prompt.includes('1. O que é NP-completo\n') || 'pergunta 1 (com material) não deveria ter aviso de falta',
        prompt.includes('2. O que é thrashing\n') || 'pergunta 2 (com material) não deveria ter aviso de falta',
        prompt.includes('3. Como funciona o Paxos — SEM material coletado') ||
          'pergunta 3 (sem material no esboço) deveria vir marcada com o aviso de falta de material',
      ];
    },
  },

  /* -------------------------------------------------------------------
   * Caso real 2026-09-14 (Davi, bateria de projeção do dólar): o crítico
   * tratou repetidamente datas de HOJE e de fontes recentes como se fossem
   * do futuro ("o foco atual é em dados futuros específicos (2026)"), e a
   * resposta final fechou citando uma data inventada que não vinha de
   * nenhuma fonte. Nenhum prompt dizia ao modelo que dia era hoje. Os 4
   * testes abaixo confirmam que os três prompts do crítico (periódico, sob
   * demanda, checkpoint automático) e o de redação agora dão essa
   * informação de forma explícita.
   * ------------------------------------------------------------------- */
  {
    nome: 'pedidoDeCriticaDoPlano: informa a data de hoje, pra não tratar dado recente como futuro',
    tipo: 'unidade',
    async executar() {
      const prompt = pedidoDeCriticaDoPlano({ objetivo: 'x', checklist: [], jaFeito: [], material: '' });
      const hoje = new Date().toLocaleDateString('pt-BR');
      return [prompt.includes(`HOJE É ${hoje}`) || `prompt não contém "HOJE É ${hoje}": ${prompt.slice(0, 200)}`];
    },
  },
  {
    nome: 'pedidoDeConsultaCritico: informa a data de hoje, pra não tratar dado recente como futuro',
    tipo: 'unidade',
    async executar() {
      const prompt = pedidoDeConsultaCritico({ objetivo: 'x', checklist: [], jaFeito: [], material: '', motivo: 'dúvida qualquer' });
      const hoje = new Date().toLocaleDateString('pt-BR');
      return [prompt.includes(`HOJE É ${hoje}`) || `prompt não contém "HOJE É ${hoje}": ${prompt.slice(0, 200)}`];
    },
  },
  {
    nome: 'pedidoDeCriticaAutomatica: informa a data de hoje, pra não tratar dado recente como futuro',
    tipo: 'unidade',
    async executar() {
      const prompt = pedidoDeCriticaAutomatica({
        objetivo: 'x', checklist: [], jaFeito: [], material: '', motivo: 'revisar', fase: 'pre-redacao',
      });
      const hoje = new Date().toLocaleDateString('pt-BR');
      return [prompt.includes(`HOJE É ${hoje}`) || `prompt não contém "HOJE É ${hoje}": ${prompt.slice(0, 200)}`];
    },
  },
  {
    nome: 'pedidoDeResposta: informa a data de hoje, pra não inventar data de fechamento (caso real: "consultadas em 2026-10-31" sem fonte nenhuma)',
    tipo: 'unidade',
    async executar() {
      const prompt = pedidoDeResposta({ objetivo: 'x', material: 'algo' });
      const hoje = new Date().toLocaleDateString('pt-BR');
      return [prompt.includes(`HOJE É ${hoje}`) || `prompt não contém "HOJE É ${hoje}": ${prompt.slice(0, 200)}`];
    },
  },
  {
    // Pedido de Davi (2026-09-15): só a fase pre-redacao pode bloquear a
    // execução (ver gate "material-insuficiente" em loop.js) — as outras 3
    // continuam puramente consultivas. A marca "MATERIAL INSUFICIENTE" só
    // pode aparecer na instrução da fase pre-redacao; nas outras, pedir isso
    // seria instrução morta (nenhum código verifica a marca fora dali) e
    // confundiria o crítico sem motivo.
    nome: 'pedidoDeCriticaAutomatica: só a fase pre-redacao instrui a marca "MATERIAL INSUFICIENTE" (as outras continuam só consultivas)',
    tipo: 'unidade',
    async executar() {
      const base = { objetivo: 'x', checklist: [], jaFeito: [], material: '', motivo: 'revisar' };
      const preRedacao = pedidoDeCriticaAutomatica({ ...base, fase: 'pre-redacao' });
      const entendimento = pedidoDeCriticaAutomatica({ ...base, fase: 'entendimento' });
      const planoInicial = pedidoDeCriticaAutomatica({ ...base, fase: 'plano-inicial' });
      const direcaoPesquisa = pedidoDeCriticaAutomatica({ ...base, fase: 'direcao-pesquisa' });
      const parteConcluida = pedidoDeCriticaAutomatica({ ...base, fase: 'parte-concluida' });
      return [
        preRedacao.includes('MATERIAL INSUFICIENTE') || 'pre-redacao deveria instruir a marca de bloqueio',
        !entendimento.includes('MATERIAL INSUFICIENTE') || 'entendimento não deveria instruir a marca de bloqueio',
        !planoInicial.includes('MATERIAL INSUFICIENTE') || 'plano-inicial não deveria instruir a marca de bloqueio',
        !direcaoPesquisa.includes('MATERIAL INSUFICIENTE') || 'direcao-pesquisa não deveria instruir a marca de bloqueio',
        !parteConcluida.includes('MATERIAL INSUFICIENTE') || 'parte-concluida não deveria instruir a marca de bloqueio',
      ];
    },
  },
  {
    // Checkpoint novo (Davi 2026-09-15): "direção da pesquisa" precisa de um
    // rótulo PRÓPRIO — sem ele, cairia no genérico "o andamento da execução"
    // (fallback de RÓTULO_FASE em prompts.js) e o crítico não saberia que
    // deveria olhar especificamente pro material recém-trazido pela busca,
    // não pro plano ou pro entendimento geral do pedido.
    nome: 'pedidoDeCriticaAutomatica: fase direcao-pesquisa tem rótulo próprio, distinto de plano-inicial e do genérico',
    tipo: 'unidade',
    async executar() {
      const base = { objetivo: 'x', checklist: [], jaFeito: [], material: '', motivo: 'revisar' };
      const direcaoPesquisa = pedidoDeCriticaAutomatica({ ...base, fase: 'direcao-pesquisa' });
      const generico = pedidoDeCriticaAutomatica({ ...base, fase: 'fase-inexistente' });
      return [
        /mirando o assunto certo do pedido/.test(direcaoPesquisa) ||
          `direcao-pesquisa deveria ter rótulo próprio: ${direcaoPesquisa.slice(0, 200)}`,
        !generico.includes('mirando o assunto certo do pedido') ||
          'uma fase desconhecida não deveria cair no rótulo de direcao-pesquisa',
      ];
    },
  },
  {
    // Pedido de Davi (2026-09-15, caso real: cotação de dólar de ~2,5 meses
    // atrás apresentada como "a cotação atual"). Confere que o aviso só
    // aparece quando há uma idade calculada, e leva o número certo.
    nome: 'pedidoDeResposta: avisa quando o dado mais recente do material está velho, e não avisa quando não há idade calculada',
    tipo: 'unidade',
    async executar() {
      const comAviso = pedidoDeResposta({ objetivo: 'x', material: 'algo', diasDesdeUltimaData: 77 });
      const semAviso = pedidoDeResposta({ objetivo: 'x', material: 'algo' });
      return [
        (comAviso.includes('77 dia') && /ATUAL/.test(comAviso)) || `prompt não avisa a idade do dado: ${comAviso.slice(0, 300)}`,
        !semAviso.includes('ATENÇÃO: o dado mais recente') || 'não deveria haver aviso sem diasDesdeUltimaData',
      ];
    },
  },
];
