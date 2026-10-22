'use strict';

/**
 * Casos das 4 melhorias implementadas numa mesma leva (ver conversa que
 * originou isto): lista de tarefas com estado, busca de acompanhamento
 * mirada na cobertura, confronto/confiança religados ao loop real (mais a
 * busca de reforço que eles habilitam) e credibilidade de domínio aprendida
 * por observação. Cada bloco testa a peça pura isoladamente primeiro (mais
 * barato, mais fácil de apontar o que quebrou) e depois, quando compensa,
 * uma integração de ponta a ponta.
 */

const http = require('http');
const {
  medirCobertura, ajusteDeBusca, reconciliarChecklist, itemChecklistRelevante, mensagemDeAcaoRepetida, Agent,
} = require('../../src/agent/loop');
const confronto = require('../../src/agent/confronto');
const search = require('../../src/tools/search');
const tools = require('../../src/tools');
const { Sandbox } = require('../../src/tools/sandbox');
const { MemoriaOperacional, observar } = require('../../src/agent/memoria-operacional');
const { servidorFalso, skills } = require('../motor');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ------------------------------ item 1: checklist ------------------------------ */

const casosChecklist = [
  {
    nome: 'checklist: item que some da lista após ação bem-sucedida vira feito',
    tipo: 'unidade',
    async executar() {
      const anterior = [{ texto: 'pesquisar preços', status: 'pendente' }, { texto: 'responder', status: 'pendente' }];
      const novo = reconciliarChecklist(anterior, ['responder'], true);
      const item = novo.find((i) => i.texto === 'pesquisar preços');
      return [
        (item && item.status === 'feito') || `esperava "feito", obteve ${JSON.stringify(item)}`,
      ];
    },
  },
  {
    nome: 'checklist: item que some da lista após ação negada/falha vira pulado',
    tipo: 'unidade',
    async executar() {
      const anterior = [{ texto: 'apagar arquivo antigo', status: 'pendente' }, { texto: 'responder', status: 'pendente' }];
      const novo = reconciliarChecklist(anterior, ['responder'], false);
      const item = novo.find((i) => i.texto === 'apagar arquivo antigo');
      return [(item && item.status === 'pulado') || `esperava "pulado", obteve ${JSON.stringify(item)}`];
    },
  },
  {
    nome: 'checklist: item que continua na lista nova permanece pendente',
    tipo: 'unidade',
    async executar() {
      const anterior = [{ texto: 'comparar ofertas', status: 'pendente' }];
      const novo = reconciliarChecklist(anterior, ['comparar ofertas', 'responder'], true);
      const item = novo.find((i) => i.texto === 'comparar ofertas');
      return [(item && item.status === 'pendente') || `esperava "pendente", obteve ${JSON.stringify(item)}`];
    },
  },
  {
    nome: 'checklist: item já feito nunca regride mesmo se o modelo redeclarar',
    tipo: 'unidade',
    async executar() {
      const meioCaminho = reconciliarChecklist(
        [{ texto: 'pesquisar preços', status: 'pendente' }],
        ['responder'],
        true
      );
      const final = reconciliarChecklist(meioCaminho, ['pesquisar preços', 'responder'], true);
      const item = final.find((i) => i.texto === 'pesquisar preços');
      return [(item && item.status === 'feito') || `item voltou a pendente: ${JSON.stringify(item)}`];
    },
  },
  {
    // Caso real 2026-09-14 (Davi, bateria de projeção do dólar): o modelo
    // reescreveu o `plano` inteiro numa única rodada (mesmas tarefas, texto
    // diferente), e os itens antigos que não bateram viraram "feito" todos de
    // uma vez — 6 no rastro real, aqui reproduzido com 3 pra manter o teste
    // enxuto — depois de UMA ação só ter sido executada. Isso disparava o
    // checkpoint "cada parte concluída" repetidas vezes no mesmo passo,
    // revisando conclusões que nunca aconteceram. Sumiço em massa (2+
    // candidatos na mesma reconciliação) não conta como conclusão — fica tudo
    // pendente.
    nome: 'checklist: sumiço em massa (modelo reescreveu o plano, não terminou nada) NÃO vira "feito" em cascata',
    tipo: 'unidade',
    async executar() {
      const anterior = [
        { texto: 'pesquisar cotação atual do dólar', status: 'pendente' },
        { texto: 'pesquisar histórico do dólar', status: 'pendente' },
        { texto: 'identificar fatores econômicos', status: 'pendente' },
      ];
      // Só uma ação de verdade rodou (uma busca), mas o modelo declarou um
      // `plano` novo totalmente reescrito, sem nenhum texto batendo com os
      // itens antigos.
      const novo = reconciliarChecklist(anterior, ['analisar tendências e criar projeções'], true);
      const aindaPendentes = anterior.every((antigo) => {
        const item = novo.find((i) => i.texto === antigo.texto);
        return item && item.status === 'pendente';
      });
      return [aindaPendentes || `sumiço em massa marcou item(ns) como concluído: ${JSON.stringify(novo)}`];
    },
  },
  {
    // Contraprova do caso acima: quando só UM item some (o caso normal, uma
    // ação real concluindo uma tarefa), o comportamento de sempre continua —
    // regressão zero pro caminho são.
    nome: 'checklist: sumiço de UM item só continua virando "feito" normalmente (contraprova do caso de sumiço em massa)',
    tipo: 'unidade',
    async executar() {
      const anterior = [
        { texto: 'pesquisar cotação atual do dólar', status: 'pendente' },
        { texto: 'pesquisar histórico do dólar', status: 'pendente' },
      ];
      const novo = reconciliarChecklist(
        anterior,
        ['pesquisar histórico do dólar', 'identificar fatores econômicos'],
        true
      );
      const item = novo.find((i) => i.texto === 'pesquisar cotação atual do dólar');
      return [(item && item.status === 'feito') || `esperava "feito", obteve ${JSON.stringify(item)}`];
    },
  },

  {
    // Caso real (Davi, chat "Como funciona as ondas de radio frequencia ?",
    // 2026-09-19): o modelo principal declarou, no meio da execução, um
    // `plano` com itens genéricos de "planejamento de projeto acadêmico"
    // sem relação nenhuma com o pedido — `reconciliarChecklist` aceitava
    // qualquer string, e o agente foi pesquisar "como definir objetivos de
    // pesquisa" pelo resto da execução em vez de continuar sobre ondas de
    // rádio. `itemChecklistRelevante` (usada aqui via `opcoes.objetivo`)
    // detecta e descarta itens sem nenhum termo em comum com o pedido nem
    // com o que já está no checklist.
    nome: 'checklist: item novo sem NENHUMA relação com o objetivo (nem com o checklist) é descartado quando objetivo é informado',
    tipo: 'unidade',
    executar() {
      const objetivo = 'Como funciona as ondas de radio frequencia ?';
      const anterior = [{ texto: 'Explicar como as ondas de rádio são geradas', status: 'feito' }];
      const novo = reconciliarChecklist(
        anterior,
        ['Explicar como as ondas de rádio são geradas', 'Defina metas específicas para cada área de pesquisa.', 'Crie um cronograma detalhado para cada tarefa.'],
        true,
        { objetivo }
      );
      return [
        !novo.some((i) => i.texto.includes('metas específicas')) ||
          'aceitou item de "planejamento de projeto" sem relação com ondas de rádio',
        !novo.some((i) => i.texto.includes('cronograma detalhado')) ||
          'aceitou item de "cronograma" sem relação com ondas de rádio',
      ];
    },
  },
  {
    nome: 'checklist: item novo que retoma termo do objetivo OU de um item já aceito continua sendo aceito normalmente',
    tipo: 'unidade',
    executar() {
      const objetivo = 'Como funciona as ondas de radio frequencia ?';
      const anterior = [{ texto: 'Explicar como as antenas geram ondas eletromagnéticas', status: 'feito' }];
      const novo = reconciliarChecklist(
        anterior,
        [
          'Explicar como as antenas geram ondas eletromagnéticas',
          'Pesquisar sobre a propagação de ondas de rádio no espaço', // repete termo do objetivo
          'Detalhar a ressonância das antenas', // repete termo de um item já aceito, não do objetivo
        ],
        true,
        { objetivo }
      );
      return [
        novo.some((i) => i.texto.includes('propagação de ondas de rádio')) ||
          'descartou item legítimo que repete termo do objetivo (falso positivo)',
        novo.some((i) => i.texto.includes('ressonância das antenas')) ||
          'descartou item legítimo que repete termo de um item já aceito (falso positivo)',
      ];
    },
  },
  {
    nome: 'checklist: sem objetivo informado, comportamento de aceitar qualquer item continua igual (retrocompatível)',
    tipo: 'unidade',
    executar() {
      const anterior = [{ texto: 'pesquisar cotação atual do dólar', status: 'pendente' }];
      const novo = reconciliarChecklist(
        anterior,
        ['pesquisar cotação atual do dólar', 'item completamente aleatório sem relação nenhuma'],
        true
        // sem opcoes.objetivo — guarda de relevância não deve entrar em ação
      );
      return [
        novo.some((i) => i.texto === 'item completamente aleatório sem relação nenhuma') ||
          'sem objetivo informado, o guarda de relevância não deveria filtrar nada (quebra retrocompatibilidade)',
      ];
    },
  },
  {
    nome: 'itemChecklistRelevante: objetivo curto/vago sem termo informativo falha aberto (aceita)',
    tipo: 'unidade',
    executar() {
      return [
        itemChecklistRelevante('Fazer mais pesquisa sobre isso', 'oi', []) === true ||
          'objetivo sem termo informativo deveria falhar aberto (aceitar), não bloquear',
      ];
    },
  },

  {
    nome: 'checklist: end-to-end via agente — item some após negar aparece pulado na SITUAÇÃO',
    pedido: 'Organize a pasta e depois apague o arquivo antigo.txt',
    // 'auto' (padrão da bancada) não pede aprovação pra nada — sem isso o
    // apagar_arquivo simplesmente roda e "aprovar: false" abaixo não tem
    // nenhuma aprovação pra negar.
    autonomia: 'manual',
    arquivos: { 'antigo.txt': 'conteúdo qualquer' },
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' }, plano: ['organizar a pasta', 'apagar antigo.txt', 'responder'] },
      { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'antigo.txt' }, plano: ['apagar antigo.txt', 'responder'] },
      { ferramenta: 'responder', argumentos: { foco: 'o que foi feito' }, plano: ['responder'] },
    ],
    aprovar: false, // nega o apagar_arquivo — o item deve virar "pulado", não sumir
    redacao: 'A pasta foi organizada; o arquivo antigo não foi apagado porque a exclusão foi negada.',
    espera: {
      ok: true,
      checklistItem: { texto: 'apagar antigo.txt', status: 'pulado' },
    },
  },
];

/* ------------------------------ item 2: busca mirada ------------------------------ */

const casosBuscaMirada = [
  {
    nome: 'ajusteDeBusca: acrescenta o termo ausente quando sobra 1',
    tipo: 'unidade',
    async executar() {
      const ajuste = ajusteDeBusca('inflação Brasil', { nivel: 'boa', ausentes: ['cambio'] });
      return [
        (ajuste && ajuste.ajustada.includes('cambio')) || `não acrescentou: ${JSON.stringify(ajuste)}`,
        (ajuste && ajuste.termos.length === 1) || 'termos deveria ter 1 item',
      ];
    },
  },
  {
    nome: 'ajusteDeBusca: não mexe se o termo já está na consulta',
    tipo: 'unidade',
    async executar() {
      const ajuste = ajusteDeBusca('inflação e câmbio do Brasil', { nivel: 'parcial', ausentes: ['cambio'] });
      return [ajuste === null || `deveria ser null (termo já presente), obteve ${JSON.stringify(ajuste)}`];
    },
  },
  {
    nome: 'ajusteDeBusca: não mexe quando sobram mais de 2 termos (parece outro assunto)',
    tipo: 'unidade',
    async executar() {
      const ajuste = ajusteDeBusca('algo', { nivel: 'ausente', ausentes: ['a', 'b', 'c'] });
      return [ajuste === null || `deveria ser null (mais de 2 ausentes), obteve ${JSON.stringify(ajuste)}`];
    },
  },
  {
    nome: 'ajusteDeBusca: sem lacunas não faz nada',
    tipo: 'unidade',
    async executar() {
      const ajuste = ajusteDeBusca('qualquer coisa', null);
      return [ajuste === null || 'deveria ser null sem lacunas'];
    },
  },

  {
    // Precisa de conteúdo de verdade (não só um roteiro de decisão): sem uma
    // primeira leitura que RODE de fato, "lacunas" nunca sai do estado
    // inicial e ajusteDeBusca não tem o que ajustar. Por isso este caso não
    // usa o formato roteiro/espera padrão — sobe um servidor de busca falso
    // igual ao de casosConfiancaConfronto (só um domínio, sem "cambio" no
    // texto) e confere o evento diretamente.
    nome: 'busca mirada: end-to-end via agente — segunda busca ganha o termo que faltou',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeConteudo({
        '127.0.0.1': 'A inflação do Brasil fechou em 4,5% neste trimestre, segundo o instituto.',
      });
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'inflação Brasil' } },
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'situação econômica brasileira' } },
          { ferramenta: 'responder', argumentos: { foco: 'inflação e câmbio' } },
        ],
        destilacao: '- A inflação do Brasil fechou em 4,5% neste trimestre [1]',
        redacao: 'A inflação do Brasil fechou em 4,5%.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-melhorias-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: 'nomic-embed-text',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
          subconsultas: false,
        },
        userDataPath: workspace,
        skills,
      });

      const ajustadas = [];
      agente.on('busca-ajustada', (d) => ajustadas.push(d));

      try {
        await agente.run('Pesquise a inflação e o câmbio do Brasil');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      return [
        ajustadas.some((a) => a.termos.includes('cambio')) ||
          `esperava o termo "cambio" numa busca ajustada, obteve ${JSON.stringify(ajustadas)}`,
      ];
    },
  },
];

/* ------------------------------ peça 2 (nivelRaciocinio): reseleção de skill por subtarefa ------------------------------ */

const casosReselecaoDeSkill = [
  {
    // O gap que começou a conversa toda com o Davi: skillsDecisao era
    // calculado UMA VEZ no início de run() (loop.js, com o texto do pedido
    // geral) e reusado o turno inteiro — uma skill que só fazia sentido numa
    // subtarefa de número 2, 3 etc. nunca chegava a concorrer. Este teste
    // prova o gancho novo (loop.js, logo depois do checkpoint
    // "parte-concluida"): o pedido em si é genérico de propósito (não bate
    // gatilho de nenhuma skill de domínio), o checklist troca de foco duas
    // vezes ao longo da execução (clima → cálculo), e a skill ativada de
    // fato muda junto — não fica presa na seleção inicial.
    nome: 'reseleção de skill por subtarefa: end-to-end via agente — skill ativa muda quando o foco do checklist muda (nível leve/determinístico)',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [
          // 1ª decisão: plano com 2 subtarefas de domínios diferentes + responder.
          // O foco (1º item pendente) começa em "consultar a previsão do tempo..."
          // — diferente do texto genérico do pedido, então já dispara a 1ª
          // reseleção (Previsão do tempo tem gatilho exato "previsão do tempo").
          {
            ferramenta: 'listar_arquivos',
            argumentos: { caminho: '.' },
            plano: [
              'consultar a previsão do tempo para amanhã em São Paulo',
              'calcular 15% de desconto sobre um valor',
              'responder',
            ],
          },
          // 2ª decisão: item do clima sumiu do plano (ação anterior deu certo)
          // → vira "feito"; o novo foco passa a ser o item de cálculo, que
          // dispara a 2ª reseleção (Matemática e cálculo bate em "calcular"/
          // "desconto").
          {
            ferramenta: 'listar_arquivos',
            argumentos: { caminho: '.' },
            plano: ['calcular 15% de desconto sobre um valor', 'responder'],
          },
          // 3ª decisão: encerra o checklist e responde.
          { ferramenta: 'responder', argumentos: { foco: 'a previsão e o cálculo pedidos' }, plano: ['responder'] },
        ],
        redacao: 'A previsão do tempo indica sol e o desconto calculado foi informado.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-melhorias-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: 'nomic-embed-text',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          reselecaoDeSkill: 'deterministica', // nível "leve" — o mais barato, roda em todo nível
        },
        userDataPath: workspace,
        skills,
      });

      const eventosDeSkills = [];
      agente.on('skills', (d) => eventosDeSkills.push(d.nomes));

      try {
        // Pedido genérico de propósito: não deve bater gatilho de nenhuma
        // skill de domínio por si só, só a "Pesquisa na web" (sempre: true).
        await agente.run('Preciso de ajuda com duas coisas diferentes hoje.');
      } finally {
        await falso.fechar?.();
      }

      const indiceComPrevisao = eventosDeSkills.findIndex((nomes) => nomes.includes('Previsão do tempo'));
      const indiceComMatematica = eventosDeSkills.findIndex((nomes) => nomes.includes('Matemática e cálculo'));

      return [
        indiceComPrevisao !== -1 ||
          `esperava algum evento 'skills' com "Previsão do tempo", obteve ${JSON.stringify(eventosDeSkills)}`,
        indiceComMatematica !== -1 ||
          `esperava algum evento 'skills' com "Matemática e cálculo", obteve ${JSON.stringify(eventosDeSkills)}`,
        indiceComPrevisao === -1 ||
          !eventosDeSkills[indiceComPrevisao].includes('Matemática e cálculo') ||
          'o evento da 1ª subtarefa (clima) já vinha com "Matemática e cálculo" — não prova reseleção de verdade',
        indiceComMatematica === -1 ||
          indiceComPrevisao === -1 ||
          indiceComMatematica > indiceComPrevisao ||
          'a reseleção de "Matemática e cálculo" deveria acontecer DEPOIS da de "Previsão do tempo" (2ª subtarefa vem depois da 1ª)',
      ];
    },
  },

  // Os 4 testes abaixo chamam reselecionarSkillsPorSubtarefa/
  // deliberarSkillPorSubtarefa DIRETO (sem passar por run()) — mesmo truque
  // de agenteDeTeste() em avaliacao/casos/copiloto-paralelo.js
  // (agente.controller = new AbortController() manual, já que normalmente só
  // existe depois que run() começa). O teste end-to-end acima já prova o
  // gancho do loop inteiro no nível "leve"; estes isolam o que cada nível
  // ACIMA do leve soma, que o e2e não tem como distinguir sozinho.

  {
    nome: 'reselecionarSkillsPorSubtarefa: nível "alto" (criticoParteConcluida) usa a observação do crítico como parte do texto de busca',
    tipo: 'unidade',
    async executar() {
      // "processar isso agora" sozinho não bate gatilho de nenhuma skill de
      // domínio — só quando a observação entra na busca (nível
      // criticoParteConcluida concatena foco+observação, ver loop.js) é que
      // "previsão do tempo" aparece e a skill correspondente é escolhida.
      const agenteAlto = new Agent({
        config: { host: '', model: 'falso', reselecaoDeSkill: 'criticoParteConcluida', skillsDesativadas: [] },
        skills,
      });
      agenteAlto.controller = new AbortController();
      const comObservacao = await agenteAlto.reselecionarSkillsPorSubtarefa({
        foco: 'processar isso agora',
        observacao: 'considere verificar a previsão do tempo antes de prosseguir',
      });

      const agenteLeve = new Agent({
        config: { host: '', model: 'falso', reselecaoDeSkill: 'deterministica', skillsDesativadas: [] },
        skills,
      });
      agenteLeve.controller = new AbortController();
      const semObservacao = await agenteLeve.reselecionarSkillsPorSubtarefa({
        foco: 'processar isso agora',
        observacao: 'considere verificar a previsão do tempo antes de prosseguir',
      });

      const nomesAlto = comObservacao.map((s) => s.nome);
      const nomesLeve = semObservacao.map((s) => s.nome);
      return [
        nomesAlto.includes('Previsão do tempo') ||
          `nível "alto" deveria usar a observação e escolher "Previsão do tempo", obteve ${JSON.stringify(nomesAlto)}`,
        !nomesLeve.includes('Previsão do tempo') ||
          `nível "leve" (deterministica) NÃO deveria olhar a observação — mesmo foco/observação deveria dar resultado diferente, ambos deram ${JSON.stringify(nomesLeve)}`,
      ];
    },
  },

  {
    // Item 2 da rodada de 2026-09-22 (Davi, achado analisando a execução real
    // "melhor fone intra-auricular pra PUBG PC"): o pedido original batia
    // gatilho de "Pesquisa profunda" (o nome dela é literalmente parte do
    // pedido) e de "Comparativo" ("melhor" é um dos gatilhos dela) — mas a
    // subtarefa "verificar opiniões de usuários que utilizam os fones no
    // jogo PUBG PC" não repete nenhum dos dois, e na execução real essas
    // duas skills sumiram da seleção no meio do caminho, ficando só
    // "Pesquisa na web" (sempre: true). Testa que `reforcarObjetivo`
    // (`skillsObjetivoIds`, capturado em run() a partir da seleção sobre o
    // pedido original) resgata as duas de volta, preenchendo a vaga que
    // sobra no teto de 3 — e que roda até no nível "leve" (deterministica),
    // o mais barato, já que o reforço em si não chama modelo nenhum.
    nome: 'reselecionarSkillsPorSubtarefa: reforço do objetivo geral resgata skill que pontuou no pedido original mas não na subtarefa estreita (caso real: fone pra PUBG)',
    tipo: 'unidade',
    async executar() {
      const objetivoOriginal =
        'Realize uma pesquisa profunda para encontrar o melhor fone intra-auricular para eu usar no pubg de pc';
      const subtarefaEstreita = 'Verificar opiniões de usuários que utilizam os fones no jogo PUBG PC';

      const skillsObjetivo = await skills.selecionar(objetivoOriginal, { etapa: 'decisao', skillsDesativadas: [] });
      const nomesObjetivo = skillsObjetivo.map((s) => s.nome);
      const idsObjetivo = skillsObjetivo.map((s) => s.id);

      const agenteComReforco = new Agent({
        config: { host: '', model: 'falso', reselecaoDeSkill: 'deterministica', skillsDesativadas: [] },
        skills,
      });
      agenteComReforco.controller = new AbortController();
      agenteComReforco.skillsObjetivoIds = idsObjetivo; // mesmo passo que run() faz uma vez, no início

      const agenteSemReforco = new Agent({
        config: { host: '', model: 'falso', reselecaoDeSkill: 'deterministica', skillsDesativadas: [] },
        skills,
      });
      agenteSemReforco.controller = new AbortController();
      // skillsObjetivoIds fica [] (default do construtor) — simula uma execução
      // onde o reforço nunca foi ligado, pra provar que É o reforço que muda o resultado.

      const comReforco = await agenteComReforco.reselecionarSkillsPorSubtarefa({ foco: subtarefaEstreita });
      const semReforco = await agenteSemReforco.reselecionarSkillsPorSubtarefa({ foco: subtarefaEstreita });
      const nomesComReforco = comReforco.map((s) => s.nome);
      const nomesSemReforco = semReforco.map((s) => s.nome);

      return [
        (nomesObjetivo.includes('Pesquisa profunda') && nomesObjetivo.includes('Comparativo')) ||
          `pré-condição do teste falhou: o objetivo original deveria bater gatilho de "Pesquisa profunda" e "Comparativo", obteve ${JSON.stringify(nomesObjetivo)}`,
        nomesComReforco.includes('Pesquisa profunda') ||
          `reforço deveria resgatar "Pesquisa profunda", obteve ${JSON.stringify(nomesComReforco)}`,
        nomesComReforco.includes('Comparativo') ||
          `reforço deveria resgatar "Comparativo", obteve ${JSON.stringify(nomesComReforco)}`,
        nomesComReforco.length <= 3 || `reforço não pode passar do teto de 3 skills, obteve ${JSON.stringify(nomesComReforco)}`,
        !nomesSemReforco.includes('Pesquisa profunda') && !nomesSemReforco.includes('Comparativo') ||
          `sem skillsObjetivoIds (comportamento de antes) NÃO deveria resgatar nenhuma das duas — se resgatou, o teste não está isolando o reforço, obteve ${JSON.stringify(nomesSemReforco)}`,
      ];
    },
  },

  {
    // Contraprova do teste acima: o reforço do objetivo NUNCA desloca uma
    // skill que bateu gatilho na PRÓPRIA subtarefa — só preenche vaga
    // sobrando. Aqui a subtarefa já bate gatilho de "Comparativo" sozinha
    // ("compare" é gatilho dela); o reforço só pode somar "Pesquisa
    // profunda" (que só pontuou no objetivo), nunca tomar o lugar de
    // "Comparativo".
    nome: 'reselecionarSkillsPorSubtarefa: reforço do objetivo geral só preenche vaga sobrando, nunca desloca skill que já bateu gatilho na subtarefa atual',
    tipo: 'unidade',
    async executar() {
      const objetivoOriginal = 'Realize uma pesquisa profunda sobre fones intra-auriculares para jogos';
      const subtarefaComGatilhoProprio = 'Compare os fones finalistas entre si';

      const skillsObjetivo = await skills.selecionar(objetivoOriginal, { etapa: 'decisao', skillsDesativadas: [] });
      const idsObjetivo = skillsObjetivo.map((s) => s.id);

      const agente = new Agent({
        config: { host: '', model: 'falso', reselecaoDeSkill: 'deterministica', skillsDesativadas: [] },
        skills,
      });
      agente.controller = new AbortController();
      agente.skillsObjetivoIds = idsObjetivo;

      const resultado = await agente.reselecionarSkillsPorSubtarefa({ foco: subtarefaComGatilhoProprio });
      const nomes = resultado.map((s) => s.nome);

      return [
        nomes.includes('Comparativo') ||
          `a subtarefa bate gatilho de "Comparativo" sozinha — não deveria depender do reforço, obteve ${JSON.stringify(nomes)}`,
        nomes.includes('Pesquisa profunda') ||
          `o reforço deveria somar "Pesquisa profunda" na vaga que sobrou, obteve ${JSON.stringify(nomes)}`,
      ];
    },
  },

  {
    nome: 'deliberarSkillPorSubtarefa (nível "extremo"): resposta TROCAR troca a seleção pelo tema real apontado pelo crítico',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        // A chamada de deliberação não passa por nenhuma interceptação
        // dedicada em motor.js (é uma chamada nova, sem format/stream
        // próprios) — cai no balde de "destilação" só pelo texto não bater
        // com as outras interceptações; por isso o hook certo pra
        // diferenciar a pergunta é `destilacao` como função, olhando o texto
        // que só pedidoDeDeliberacaoDeSkill produz (prompts.js).
        destilacao: (prompt) =>
          /crítico revisando, no meio de uma execução, se as/.test(prompt)
            ? 'TROCAR: organizar meus arquivos antigos'
            : 'NADA',
      });
      try {
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`,
            model: 'falso',
            modelDecisao: '',
            numCtx: 4096,
            numPredict: 200,
            reselecaoDeSkill: 'deliberacaoDedicada',
            skillsDesativadas: [],
          },
          skills,
        });
        agente.controller = new AbortController();
        // "processar isso agora" não bate gatilho nenhum sozinho — só
        // "Pesquisa na web" (sempre: true) deveria vir na seleção original.
        const resultado = await agente.reselecionarSkillsPorSubtarefa({ foco: 'processar isso agora', observacao: '' });
        const nomes = resultado.map((s) => s.nome);
        return [
          nomes.includes('Organizar arquivos') ||
            `esperava "Organizar arquivos" depois do TROCAR, obteve ${JSON.stringify(nomes)}`,
        ];
      } finally {
        await falso.fechar?.();
      }
    },
  },

  {
    nome: 'deliberarSkillPorSubtarefa (nível "extremo"): resposta MANTER preserva a seleção original, sem chamar selecionar() de novo com outro tema',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        destilacao: (prompt) =>
          /crítico revisando, no meio de uma execução, se as/.test(prompt) ? 'MANTER' : 'NADA',
      });
      try {
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`,
            model: 'falso',
            modelDecisao: '',
            numCtx: 4096,
            numPredict: 200,
            reselecaoDeSkill: 'deliberacaoDedicada',
            skillsDesativadas: [],
          },
          skills,
        });
        agente.controller = new AbortController();
        const resultado = await agente.reselecionarSkillsPorSubtarefa({ foco: 'processar isso agora', observacao: '' });
        const nomes = resultado.map((s) => s.nome);
        return [
          !nomes.includes('Organizar arquivos') ||
            `MANTER não deveria trocar a skill original, obteve ${JSON.stringify(nomes)}`,
        ];
      } finally {
        await falso.fechar?.();
      }
    },
  },
];

/* ------------------------------ item 3: confronto/confiança ------------------------------ */

const corpo = (texto) =>
  `<html><body><article><p>${texto} ${'Texto complementar suficiente para o extrator aceitar o bloco. '.repeat(4)}</p></article></body></html>`;

/** Mesmo truque de pesquisa.js: domínios distintos via 127.0.0.{1,2,3}, um servidor só. */
function servidorDeConteudo(paginasPorDominio) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/search')) {
        const resultados = Object.entries(paginasPorDominio).map(([host], i) => ({
          title: `Fonte ${i}`,
          url: `http://${host}:${s.address().port}/p`,
          content: '',
        }));
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ results: resultados }));
      }
      const host = req.headers.host.split(':')[0];
      res.setHeader('Content-Type', 'text/html');
      res.end(corpo(paginasPorDominio[host] || 'vazio'));
    });
    s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
  });
}

const casosConfiancaConfronto = [
  {
    nome: 'confronto: fontes lidas por domínio (formato de tools/web.js) produzem divergência detectável',
    tipo: 'unidade',
    async executar() {
      // exatamente o formato que ctx.estado.fontesLidas carrega de verdade
      const fontesLidas = [
        { dominio: 'a.com', texto: 'A máxima prevista é de 32°C na sexta.' },
        { dominio: 'b.com', texto: 'Segundo o boletim, 32°C é a máxima esperada.' },
        { dominio: 'c.com', texto: 'O órgão local prevê 28°C como máxima.' },
      ];
      const r = confronto.confrontar(fontesLidas);
      return [
        r.suficiente || 'deveria ter fontes suficientes para confrontar',
        r.divergencias.length === 1 || `esperava 1 divergência, obteve ${r.divergencias.length}`,
        r.divergencias[0]?.b?.dominios?.[0] === 'c.com' || 'domínio divergente deveria ser c.com',
      ];
    },
  },

  {
    nome: 'confronto/confiança: end-to-end via agente — evento confianca dispara e busca de reforço é acionada por divergência',
    tipo: 'unidade',
    async executar() {
      // precisa citar "temperatura" (o único termo do objetivo que sobra
      // depois de tirar palavras vazias — ver termosDoPedido): sem ele a
      // cobertura fica "ausente" e a busca de reforço nem chega a ser
      // avaliada, mesmo com a divergência entre os 32°C e o 28°C.
      const paginas = {
        '127.0.0.1': 'A temperatura máxima prevista é de 32°C nesta sexta-feira.',
        '127.0.0.2': 'O boletim indica que a temperatura chega a 32°C como máxima do dia.',
        '127.0.0.3': 'A previsão local aponta temperatura de 28°C de máxima.',
      };
      const conteudo = await servidorDeConteudo(paginas);
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'temperatura amanhã' } },
          { ferramenta: 'responder', argumentos: { foco: 'temperatura' } },
        ],
        redacao: 'A temperatura máxima prevista é de 32°C.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-melhorias-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: 'nomic-embed-text',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
          subconsultas: false,
        },
        userDataPath: workspace,
        skills,
      });

      const eventos = { confianca: null, buscaReforco: [] };
      agente.on('confianca', (d) => { eventos.confianca = d; });
      agente.on('busca-reforco', (d) => eventos.buscaReforco.push(d));

      let retorno;
      try {
        retorno = await agente.run('Qual a temperatura amanhã?');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      // Backlog do Copiloto, item c3 (Análise): `confronto.paraPrompt()` já
      // existia pronta (formata a divergência real — 32°C confirmado em 2
      // domínios vs. 28°C isolado — em vez de só a contagem agregada), mas
      // nenhuma chamada a `redigir()` passava isso pro redator: o parâmetro
      // `cruzamento` sempre ficava no padrão vazio. O evento `confronto`
      // disparava, `calcularConfianca` usava os números, mas o texto que o
      // MODELO DE REDAÇÃO recebe nunca citava a divergência de verdade —
      // só o registro interno (salvo em disco) sabia dela. Confere que o
      // prompt de redação final agora traz o bloco inteiro.
      const promptFinal = falso.registro.redacao[falso.registro.redacao.length - 1] || '';

      return [
        Boolean(retorno?.ok) || `execução não terminou ok: ${JSON.stringify(retorno)}`,
        Boolean(eventos.confianca) || 'evento "confianca" nunca disparou — a religação quebrou de novo',
        (eventos.confianca?.motivos || []).some((m) => /divergem/.test(m)) ||
          `motivos deveriam citar divergência: ${JSON.stringify(eventos.confianca?.motivos)}`,
        eventos.buscaReforco.length > 0 || 'busca de reforço deveria ter disparado por divergência entre fontes',
        /CONFRONTO ENTRE AS \d+ FONTES LIDAS/.test(promptFinal) ||
          'o prompt de redação deveria trazer o bloco de confronto entre fontes (confronto.paraPrompt)',
        /DIVERGÊNCIA em °C: 32°C/.test(promptFinal) ||
          `o prompt de redação deveria citar a divergência real (32°C × 28°C), veio: ${promptFinal.slice(0, 400)}`,
      ];
    },
  },

  {
    // Item 1 do pedido do Davi (2026-09-23): cross-validation de opinião —
    // mesmo teste "end-to-end via agente" acima, mas pra divergência de
    // VEREDITO ("confiável"/"recomendo" × "não confiável") em vez de número.
    // Confere a cadeia inteira: confronto acha a divergência de opinião →
    // busca de reforço dispara com o motivo certo → confiança final cita a
    // divergência → o prompt de redação recebe o bloco formatado.
    nome: 'confronto/confiança: divergência de OPINIÃO (não só número) também aciona busca de reforço e aparece na confiança e no prompt de redação',
    tipo: 'unidade',
    async executar() {
      const paginas = {
        '127.0.0.1': 'O Fone Omega é confiável e eu recomendo bastante para quem joga bastante.',
        '127.0.0.2': 'Uso o Fone Omega há um ano, é confiável e recomendo sem dúvida nenhuma.',
        '127.0.0.3': 'Cuidado: o Fone Omega não é confiável, teve muitos defeitos no meu uso diário.',
      };
      const conteudo = await servidorDeConteudo(paginas);
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'Fone Omega confiável' } },
          { ferramenta: 'responder', argumentos: { foco: 'confiabilidade do Fone Omega' } },
        ],
        redacao: 'O Fone Omega é confiável, segundo a maioria das fontes.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-melhorias-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: 'nomic-embed-text',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
          subconsultas: false,
        },
        userDataPath: workspace,
        skills,
      });

      const eventos = { confianca: null, buscaReforco: [] };
      agente.on('confianca', (d) => { eventos.confianca = d; });
      agente.on('busca-reforco', (d) => eventos.buscaReforco.push(d));

      let retorno;
      try {
        retorno = await agente.run('O Fone Omega é confiável?');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      const promptFinal = falso.registro.redacao[falso.registro.redacao.length - 1] || '';

      return [
        Boolean(retorno?.ok) || `execução não terminou ok: ${JSON.stringify(retorno)}`,
        (eventos.confianca?.motivos || []).some((m) => /divergem na avalia/.test(m)) ||
          `motivos deveriam citar divergência de opinião: ${JSON.stringify(eventos.confianca?.motivos)}`,
        eventos.buscaReforco.some((r) => r.motivo === 'divergencia-de-opiniao-entre-fontes') ||
          `busca de reforço deveria ter disparado com motivo de opinião: ${JSON.stringify(eventos.buscaReforco)}`,
        // promptFinal é o JSON.stringify() das mensagens (ver motor.js,
        // conteudoDoPrompt) — as aspas literais de `paraPrompt()` em volta da
        // entidade chegam ESCAPADAS (\") neste texto, não como aspas soltas.
        /DIVERGÊNCIA DE OPINIÃO sobre \\"Fone Omega\\"/.test(promptFinal) ||
          `o prompt de redação deveria citar a divergência de opinião real, veio: ${promptFinal.slice(0, 500)}`,
      ];
    },
  },

  {
    nome: 'busca de reforço: pergunta de acompanhamento curta não perde o assunto na consulta extra',
    tipo: 'unidade',
    async executar() {
      // Bug real (relatado pelo Davi): numa pergunta de acompanhamento tipo
      // "e quanto ao FSR?" — que não repete "PUBG" nem "43.1", só a conversa
      // dá esse contexto — a busca de reforço montava a consulta cortando o
      // OBJETIVO cru em 60 caracteres. Com um objetivo curto e sem o assunto,
      // a consulta extra saía sem nenhum termo que identificasse do que se
      // tratava, e a busca ia parar em resultados completamente aleatórios
      // (uma vez foi literalmente um artigo sobre a Guerra Civil no Sudão,
      // porque "FSR" sozinho também é a sigla de "Forças de Suporte Rápido").
      const paginas = {
        '127.0.0.1': 'O FSR trouxe um ganho de 25% de desempenho no PUBG.',
        '127.0.0.2': 'Testes independentes mostraram 25% a mais de quadros por segundo com o FSR no PUBG.',
        '127.0.0.3': 'Um jogador relatou apenas 18% de ganho com o FSR no PUBG.',
      };
      const conteudo = await servidorDeConteudo(paginas);
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'PUBG atualização FSR desempenho' } },
          { ferramenta: 'responder', argumentos: { foco: 'o ganho de desempenho' } },
        ],
        redacao: 'O FSR trouxe cerca de 25% de ganho de desempenho no PUBG.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-melhorias-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: 'nomic-embed-text',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
          subconsultas: false,
        },
        userDataPath: workspace,
        skills,
      });

      const buscaReforco = [];
      agente.on('busca-reforco', (d) => buscaReforco.push(d));

      let retorno;
      try {
        // objetivo deliberadamente sem NENHUM termo do assunto — só palavras
        // vazias/curtas (ver termosDoPedido): o pior caso real, uma pergunta
        // de acompanhamento tipo "E isso?"
        retorno = await agente.run('E isso?');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      return [
        Boolean(retorno?.ok) || `execução não terminou ok: ${JSON.stringify(retorno)}`,
        buscaReforco.length > 0 || 'busca de reforço deveria ter disparado (há divergência de 25% × 18%)',
        /pubg/i.test(buscaReforco[0]?.consulta || '') ||
          `consulta de reforço perdeu o assunto: ${JSON.stringify(buscaReforco[0]?.consulta)}`,
      ];
    },
  },

  {
    // Backlog do Copiloto, item c2 (Síntese): checagem de cobertura POR
    // TÓPICO antes de redigir, não só o nível geral. Simula o mesmo padrão
    // de bug do c1 (prova de 3 perguntas) — a busca inicial só traz material
    // de 2 das 3 — mas aqui checando que o sistema AGE antes de escrever
    // (busca de reforço mirada na pergunta sem material), em vez de só
    // avisar o redator depois de já ter chegado na hora de escrever.
    //
    // O servidor de busca falso responde domínios DIFERENTES conforme a
    // consulta menciona "Paxos" ou não — assim a busca inicial (genérica,
    // sobre a prova toda) só acha as 2 primeiras fontes, e só uma consulta
    // que já cite "Paxos" (a que a busca de reforço monta a partir da
    // pergunta sem material) acha a 3ª.
    nome: 'busca de reforço: pergunta sem NENHUM material no dossiê aciona reforço mirado nela, antes da redação (c2)',
    tipo: 'unidade',
    async executar() {
      const paginas = {
        '127.0.0.1': 'NP-completo é uma classe de problemas de complexidade computacional muito estudada.',
        '127.0.0.2': 'Thrashing acontece quando o sistema operacional troca páginas de memória demais e trava.',
        '127.0.0.3': 'Paxos é um protocolo de consenso distribuído tolerante a falhas.',
      };
      const conteudo = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          if (req.url.startsWith('/search')) {
            const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
            const dominios = /paxos/i.test(q) ? ['127.0.0.3'] : ['127.0.0.1', '127.0.0.2'];
            const resultados = dominios.map((host, i) => ({
              title: `Fonte ${i}`,
              url: `http://${host}:${s.address().port}/p`,
              content: '',
            }));
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ results: resultados }));
          }
          const host = req.headers.host.split(':')[0];
          res.setHeader('Content-Type', 'text/html');
          res.end(corpo(paginas[host] || 'vazio'));
        });
        s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
      });

      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'prova de teoria da computação', paginas: 2 } },
          { ferramenta: 'responder', argumentos: { foco: 'as 3 perguntas' } },
        ],
        redacao: 'Resposta às três perguntas: NP-completo, thrashing e Paxos.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-melhorias-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: 'nomic-embed-text',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
          subconsultas: false,
        },
        userDataPath: workspace,
        skills,
      });

      const buscaReforco = [];
      agente.on('busca-reforco', (d) => buscaReforco.push(d));

      let retorno;
      try {
        retorno = await agente.run('O que é NP-completo? O que é thrashing? Como funciona o Paxos?');
      } finally {
        await conteudo.fechar();
        await falso.fechar?.();
      }

      const promptFinal = falso.registro.redacao[falso.registro.redacao.length - 1] || '';

      return [
        Boolean(retorno?.ok) || `execução não terminou ok: ${JSON.stringify(retorno)}`,
        buscaReforco.length === 1 ||
          `esperava 1 busca de reforço, obteve ${buscaReforco.length}: ${JSON.stringify(buscaReforco)}`,
        buscaReforco[0]?.motivo === 'pergunta-sem-material-no-dossie' ||
          `motivo errado: ${JSON.stringify(buscaReforco[0]?.motivo)}`,
        /paxos/i.test(buscaReforco[0]?.consulta || '') ||
          `consulta de reforço deveria mirar em Paxos: ${JSON.stringify(buscaReforco[0]?.consulta)}`,
        !/SEM material coletado/.test(promptFinal) ||
          'reforço preencheu a lacuna — o prompt de redação final não deveria mais avisar falta de material',
      ];
    },
  },
];

/* ------------------------------ item 4: credibilidade aprendida ------------------------------ */

const casosCredibilidadeAprendida = [

];

/* ------------------------------ peça 4: agrupamento de domínio por clustering ------------------------------ */

/**
 * Mesmo padrão de `skills-embedding.js` (servidor HTTP fake com vetor exato
 * por texto, pra controlar o cosseno resultante) — repetido aqui em vez de
 * importado porque aquele arquivo não exporta o helper, só a lista de casos.
 */
function subirServidorEmbeddingControlado(mapaTextoParaVetor) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo || '{}');
        } catch {
          /* ignora corpo inválido */
        }
        const texto = String(pedido.input || '');
        const vetor = mapaTextoParaVetor[texto];
        if (!vetor) throw new Error(`vetor não mapeado pro texto de teste: ${JSON.stringify(texto)}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ embeddings: [vetor] }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve(servidor));
  });
}

/** Igual acima, com um contador de chamadas por texto — só o teste de cache precisa disso. */
function subirServidorEmbeddingContandoChamadas(mapaTextoParaVetor, contador) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo || '{}');
        } catch {
          /* ignora corpo inválido */
        }
        const texto = String(pedido.input || '');
        contador[texto] = (contador[texto] || 0) + 1;
        const vetor = mapaTextoParaVetor[texto];
        if (!vetor) throw new Error(`vetor não mapeado pro texto de teste: ${JSON.stringify(texto)}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ embeddings: [vetor] }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve(servidor));
  });
}

/* ------------------------------ peça 3: memória curta (dossiê da conversa) ------------------------------ */

/**
 * Peça 3 do plano de nível de raciocínio ("memória curta", pedido do Davi
 * 2026-09-19, decisão de arquitetura em 2026-09-20: extensão de `Memory`
 * em vez de módulo dedicado — ver memory.js). A lógica fina de escopo/
 * frescor já tem cobertura direta em `avaliacao/casos/memoria-hibrida.js`
 * (função pura, sem precisar rodar o agente inteiro); este bloco cobre só a
 * ponta a ponta — `Agent.run(objetivo, conversa, idConversa)` de verdade
 * grava o dossiê com o id certo, e a ausência de id não grava nada.
 */
const casosMemoriaCurta = [
  {
    nome: 'memória curta: end-to-end via agente — dossiê lido na execução é gravado em Memory com o idConversa passado a run()',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' }, plano: ['responder'] },
          { ferramenta: 'responder', argumentos: { foco: 'o conteúdo do relatório' }, plano: [''] },
        ],
        redacao: 'O relatório fala sobre o assunto X.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-curta-e2e-'));
      fs.writeFileSync(path.join(workspace, 'relatorio.txt'), 'Conteúdo curto sobre o assunto X.', 'utf8');

      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: '', // sem embedding: força o caminho léxico, sem depender do servidor falso ter /api/embed
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          destilarFatos: false, // conteúdo curto de propósito; sem isso a destilação chamaria o modelo de decisão à toa
        },
        userDataPath: workspace,
        skills,
      });

      try {
        await agente.run('resuma o relatorio.txt', [], 'conversa-teste-e2e-123');
      } finally {
        await falso.fechar?.();
      }

      const memoriaGravada = JSON.parse(fs.readFileSync(path.join(workspace, '.augpt', 'memory.json'), 'utf8'));
      const itemDossie = memoriaGravada.find((i) => i.tipo === 'dossie');

      return [
        !!itemDossie || `esperava pelo menos 1 item tipo "dossie" gravado, obteve ${JSON.stringify(memoriaGravada.map((i) => i.tipo))}`,
        (itemDossie && itemDossie.idConversa === 'conversa-teste-e2e-123') ||
          `esperava idConversa "conversa-teste-e2e-123", obteve ${JSON.stringify(itemDossie?.idConversa)}`,
        (itemDossie && /assunto X/.test(itemDossie.texto)) ||
          `esperava o texto lido do relatório no item, obteve ${JSON.stringify(itemDossie?.texto)}`,
      ];
    },
  },

  {
    // Contraprova: sem idConversa (agendamento, chamada avulsa, ou o
    // primeiro turno de uma conversa ainda não salva — ver
    // renderer/app.js:salvarConversa), nada de dossiê é gravado — só o
    // comportamento de sempre (memorizar() ainda grava o objetivo/conclusão,
    // sem escopo, como já acontecia antes desta peça).
    nome: 'memória curta: end-to-end via agente — SEM idConversa, nenhum item de dossiê é gravado',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' }, plano: ['responder'] },
          { ferramenta: 'responder', argumentos: { foco: 'o conteúdo do relatório' }, plano: [''] },
        ],
        redacao: 'O relatório fala sobre o assunto Y.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-curta-sem-id-'));
      fs.writeFileSync(path.join(workspace, 'relatorio.txt'), 'Conteúdo curto sobre o assunto Y.', 'utf8');

      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: '',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          destilarFatos: false,
        },
        userDataPath: workspace,
        skills,
      });

      try {
        await agente.run('resuma o relatorio.txt', []); // sem 3º argumento
      } finally {
        await falso.fechar?.();
      }

      const memoriaGravada = JSON.parse(fs.readFileSync(path.join(workspace, '.augpt', 'memory.json'), 'utf8'));
      const itemDossie = memoriaGravada.find((i) => i.tipo === 'dossie');

      return [!itemDossie || `sem idConversa, não deveria haver item "dossie" gravado — obteve ${JSON.stringify(itemDossie)}`];
    },
  },

  {
    nome: 'memória curta: config memoriaCurta: false desliga a gravação de dossiê mesmo com idConversa',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' }, plano: ['responder'] },
          { ferramenta: 'responder', argumentos: { foco: 'o conteúdo do relatório' }, plano: [''] },
        ],
        redacao: 'O relatório fala sobre o assunto Z.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-curta-desligada-'));
      fs.writeFileSync(path.join(workspace, 'relatorio.txt'), 'Conteúdo curto sobre o assunto Z.', 'utf8');

      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${falso.porta}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: '',
          temperature: 0.3,
          numCtx: 8192,
          numPredict: 1024,
          numPredictResposta: 2048,
          maxIterations: 8,
          autonomy: 'auto',
          shellTimeoutMs: 8000,
          codeTimeoutMs: 8000,
          workspace,
          memoryTopK: 2,
          alwaysAllow: [],
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          permitirLeitorExterno: false,
          renderizarJs: false,
          destilarFatos: false,
          memoriaCurta: false,
        },
        userDataPath: workspace,
        skills,
      });

      try {
        await agente.run('resuma o relatorio.txt', [], 'conversa-teste-desligada-456');
      } finally {
        await falso.fechar?.();
      }

      const memoriaGravada = JSON.parse(fs.readFileSync(path.join(workspace, '.augpt', 'memory.json'), 'utf8'));
      const itemDossie = memoriaGravada.find((i) => i.tipo === 'dossie');

      return [!itemDossie || `memoriaCurta: false deveria impedir a gravação — obteve ${JSON.stringify(itemDossie)}`];
    },
  },

  {
    // Achado no revert-and-confirm desta peça: os 3 testes acima só cobrem a
    // GRAVAÇÃO do dossiê (salvarDossieNaMemoriaCurta) — nenhum deles prova
    // que a LEITURA em run() (a chamada a `memory.buscar` perto de
    // LIMITE_DIAS_MEMORIA_CURTA*) de fato passa `idConversa`/
    // `frescorMaximoDias` adiante. Quebrei essa chamada de propósito (voltei
    // pra `memory.buscar(consulta, topK)`, sem o 3º argumento) e a bancada
    // inteira continuou 446/446 — nenhum teste existente notava a diferença.
    // Este teste fecha o buraco: um item de memória pré-gravado com
    // `diasVelhoQuandoSalvo: 5` deve aparecer em MEMÓRIA RELEVANTE no nível
    // "leve" (limite 7 dias) e DEVE SUMIR no nível "alto" (limite cauteloso
    // de 2 dias) — só possível se o nível de raciocínio realmente influencia
    // o `frescorMaximoDias` passado a `memory.buscar` na leitura.
    nome: 'memória curta: leitura via agente — item com 5 dias de idade some da memória relevante no nível "alto" (frescor cauteloso) mas aparece no "leve"',
    tipo: 'unidade',
    async executar() {
      const trechoUnico = 'atrasado por causa do orcamento restrito do projeto fenix';
      const semearMemoria = (workspace) => {
        fs.mkdirSync(path.join(workspace, '.augpt'), { recursive: true });
        fs.writeFileSync(
          path.join(workspace, '.augpt', 'memory.json'),
          JSON.stringify([
            {
              id: 'seed-frescor-1',
              texto: `Você perguntou sobre o projeto fenix e descobriu que ele está ${trechoUnico}.`,
              tipo: 'dossie',
              em: new Date().toISOString(),
              vec: null,
              idConversa: 'conv-frescor-teste',
              diasVelhoQuandoSalvo: 5, // > cauteloso (2, nível alto/extremo), <= padrão (7, nível leve/médio)
            },
          ]),
          'utf8'
        );
      };

      async function rodar(nivelRaciocinio) {
        const falso = await servidorFalso({
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o projeto fenix' }, plano: [''] }],
          redacao: 'O projeto fenix segue como descrito.',
        });
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-curta-frescor-'));
        semearMemoria(workspace);
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`,
            model: 'falso',
            modelDecisao: '',
            modelRedacao: '',
            embedModel: '', // força o caminho léxico (Jaccard), sem depender de /api/embed no falso
            temperature: 0.3,
            numCtx: 8192,
            numPredict: 1024,
            numPredictResposta: 2048,
            maxIterations: 4,
            autonomy: 'auto',
            shellTimeoutMs: 8000,
            codeTimeoutMs: 8000,
            workspace,
            memoryTopK: 4,
            alwaysAllow: [],
            usarRotinas: false,
            skillsDesativadas: [],
            ferramentasDesativadas: [],
            permitirLeitorExterno: false,
            renderizarJs: false,
            destilarFatos: false,
            nivelRaciocinio,
          },
          userDataPath: workspace,
          skills,
        });
        try {
          await agente.run('Me conte mais sobre o projeto fenix e o orçamento', [], 'conv-frescor-teste');
        } finally {
          await falso.fechar?.();
        }
        return falso.registro.decisao.join('\n');
      }

      const promptLeve = await rodar('leve');
      const promptAlto = await rodar('alto');

      return [
        promptLeve.includes(trechoUnico) ||
          `nível "leve" (limite 7 dias) deveria trazer o item de 5 dias na memória relevante, prompt não continha o trecho`,
        !promptAlto.includes(trechoUnico) ||
          `nível "alto" (limite cauteloso 2 dias) deveria descartar o item de 5 dias como velho demais, mas o trecho apareceu no prompt`,
      ];
    },
  },
];

/* ------------------------------ guarda de repetição: nudge de comparação de preço ------------------------------ */

/**
 * Caso real de produção: o agente reabria a MESMA página de loja três vezes
 * seguidas sem preço novo (comparação de RTX 5080), e a mensagem genérica do
 * guarda de repetição ("pare de pesquisar, responda agora") desperdiçava a
 * chance de tentar uma loja diferente. `mensagemDeAcaoRepetida` (extraída de
 * loop.js pra ser testável sem rodar o agente inteiro) decide entre a
 * mensagem genérica e a mensagem consciente de preço, conforme a ferramenta
 * repetida e se `buscar_produtos` já rodou nesta execução.
 */
const casosRepeticaoDePreco = [
  {
    nome: 'mensagemDeAcaoRepetida: fora de comparação de preço (ofertas null), mensagem genérica de sempre',
    tipo: 'unidade',
    async executar() {
      const r = mensagemDeAcaoRepetida({ nome: 'abrir_pagina', ofertas: null });
      return [
        /pare de pesquisar/i.test(r.mensagem) || `esperava a mensagem genérica, veio: ${r.mensagem}`,
        !/buscar_produtos/i.test(r.mensagem) || 'mensagem genérica não deveria mencionar buscar_produtos',
      ];
    },
  },
  {
    nome: 'mensagemDeAcaoRepetida: repetição em buscar_produtos (não é reabrir URL) fica com a mensagem genérica',
    tipo: 'unidade',
    async executar() {
      const r = mensagemDeAcaoRepetida({
        nome: 'buscar_produtos',
        ofertas: [{ loja: 'KaBuM!' }, { loja: 'Pichau' }],
      });
      return [/pare de pesquisar/i.test(r.mensagem) || `esperava a mensagem genérica, veio: ${r.mensagem}`];
    },
  },
  {
    nome: 'mensagemDeAcaoRepetida: reabrir URL em comparação de preço com lojas restantes sugere uma loja nova',
    tipo: 'unidade',
    async executar() {
      const r = mensagemDeAcaoRepetida({
        nome: 'abrir_pagina',
        ofertas: [{ loja: 'KaBuM!' }, { loja: 'Pichau' }],
      });
      return [
        /buscar_produtos/i.test(r.mensagem) || `esperava sugestão de buscar_produtos, veio: ${r.mensagem}`,
        /"lojas"/.test(r.mensagem) || 'esperava a restrição "lojas" na sugestão',
        !/kabum|pichau/i.test(r.mensagem) || 'não deveria sugerir de novo uma loja já vista',
      ];
    },
  },
  {
    nome: 'mensagemDeAcaoRepetida: reabrir URL com todas as lojas conhecidas já vistas cai no fallback honesto',
    tipo: 'unidade',
    async executar() {
      const { LOJAS_CONHECIDAS } = require('../../src/tools/compras');
      const ofertas = Object.values(LOJAS_CONHECIDAS).map((loja) => ({ loja }));
      const r = mensagemDeAcaoRepetida({ nome: 'navegar', ofertas });
      return [
        !/buscar_produtos/i.test(r.mensagem) || 'não deveria sugerir buscar_produtos sem loja nova pra tentar',
        /responder agora/i.test(r.mensagem) || `esperava o fallback honesto, veio: ${r.mensagem}`,
        /só essas lojas|cobriu só/i.test(r.mensagem) || 'esperava avisar da cobertura limitada',
      ];
    },
  },

  /* -------- fase 3: sinal de comparação de preço mesmo quando buscar_produtos acha zero -------- */

  {
    // Caso real de produção: buscar_produtos rodou, não achou preço legível
    // em nenhuma página (comum contra loja grande, que bloqueia leitura
    // automática) e retornou vazio SEM setar ctx.estado.ofertas — o agente
    // seguiu comparando via navegar manual, mas o aviso de repetição caiu no
    // genérico porque não tinha como saber que era comparação de preço.
    // Array VAZIO (não null) é o sinal de "comparação de preço em andamento,
    // zero loja confirmada ainda" — sugere qualquer loja conhecida.
    nome: 'mensagemDeAcaoRepetida: ofertas vazio (busca rodou mas não achou nada) ainda sugere tentar loja conhecida',
    tipo: 'unidade',
    async executar() {
      const r = mensagemDeAcaoRepetida({ nome: 'navegar', ofertas: [] });
      return [
        /buscar_produtos/i.test(r.mensagem) || `esperava sugestão de buscar_produtos mesmo com ofertas vazio, veio: ${r.mensagem}`,
        /"lojas"/.test(r.mensagem) || 'esperava a restrição "lojas" na sugestão',
      ];
    },
  },

  {
    // O outro lado do sinal: buscar_produtos()'s run() precisa marcar
    // ctx.estado.tentandoComprar ANTES do return antecipado de "nenhum preço
    // confirmado" — senão o teste acima nunca teria ofertas:[] pra trabalhar
    // em produção, só null (comportamento de antes). Servidor fake que nunca
    // devolve preço legível — força o caminho de retorno antecipado.
    nome: 'buscar_produtos: marca ctx.estado.tentandoComprar mesmo quando não acha preço nenhum',
    tipo: 'unidade',
    async executar() {
      const http = require('http');
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tools = require('../../src/tools');
      const { Sandbox } = require('../../src/tools/sandbox');

      const srv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          if (req.url.startsWith('/search')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(
              JSON.stringify({ results: [{ title: 'Loja', url: `http://127.0.0.1:${s.address().port}/produto`, content: '' }] })
            );
          }
          res.setHeader('Content-Type', 'text/html');
          res.end('<html><body><p>Página sem preço nenhum, só texto solto.</p></body></html>');
        });
        s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
      });

      const dir = path.join(os.tmpdir(), `augpt-tentandocomprar-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const ctx = {
        sandbox: new Sandbox(dir),
        emit() {},
        estado: {},
        config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false },
      };

      const saida = await tools.get('buscar_produtos').run({ consulta: 'produto inexistente' }, ctx);
      await srv.fechar();
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        ctx.estado.tentandoComprar === 'produto inexistente' ||
          `esperava ctx.estado.tentandoComprar setado, veio ${JSON.stringify(ctx.estado.tentandoComprar)}`,
        ctx.estado.ofertas === undefined || 'ctx.estado.ofertas não deveria existir quando nada foi achado',
        /Nenhum preço confirmado/.test(saida) || 'esperava a mensagem de nenhum preço confirmado',
      ];
    },
  },

  {
    // Fecha o laço fim-a-fim: os dois testes acima provam as duas PONTAS
    // (a flag é setada; a mensagem sabe usá-la) mas nenhum deles exercita a
    // linha de verdade em loop.js que LIGA as duas — o `ctx.estado.ofertas ||
    // (ctx.estado.tentandoComprar ? [] : null)` no ponto de chamada do guarda
    // de repetição. Aqui buscar_produtos roda de verdade (sem provedor de
    // busca configurado na bancada, então falha e nunca seta `ofertas`), e a
    // mesma URL é reaberta 3 vezes — a 3ª deve vir com a mensagem de preço
    // (menciona buscar_produtos de novo com uma loja alternativa), não a
    // genérica "pare de pesquisar" de antes do fix.
    nome: 'guarda de repetição: end-to-end via agente — buscar_produtos falho ainda avisa preço na 3ª reabertura de URL',
    pedido: 'Compare os preços da RTX 5080 em algumas lojas.',
    roteiro: [
      { ferramenta: 'buscar_produtos', argumentos: { consulta: 'RTX 5080' } },
      { ferramenta: 'abrir_pagina', argumentos: { url: 'https://kabum.com.br/produto/rtx-5080' } },
      { ferramenta: 'abrir_pagina', argumentos: { url: 'https://kabum.com.br/produto/rtx-5080' } },
      { ferramenta: 'abrir_pagina', argumentos: { url: 'https://kabum.com.br/produto/rtx-5080' } },
      { ferramenta: 'responder', argumentos: { foco: 'os preços encontrados' } },
    ],
    redacao: 'Não foi possível confirmar preços nas lojas tentadas.',
    espera: { ok: true, erroContem: ['mesma página, sem preço novo'] },
  },
];

module.exports = [
  ...casosChecklist,
  ...casosBuscaMirada,
  ...casosReselecaoDeSkill,
  ...casosConfiancaConfronto,
  ...casosCredibilidadeAprendida,
  ...casosMemoriaCurta,
  ...casosRepeticaoDePreco,
];
