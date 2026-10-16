'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  host: 'http://127.0.0.1:11434',
  model: '',
  modelDecisao: '',
  modelRedacao: '',
  embedModel: 'nomic-embed-text',
  temperature: 0.4,
  numCtx: 16384,
  // Pedido do Davi 2026-09-20: as 3 IAs que podem rodar como modelos
  // DIFERENTES (decisão/principal, redação, copiloto dedicado — ver
  // `modelDecisao`/`modelRedacao`/`modelCopiloto2`) hoje compartilham a
  // mesma janela de contexto (`numCtx`). Cada um destes, quando preenchido
  // (não-vazio/não-nulo), passa a valer só pra aquela etapa — vazio
  // continua caindo em `numCtx`, exatamente como `modelDecisao`/
  // `modelRedacao` vazios caem em `model` (`Agent.modeloDe()`, loop.js).
  // Manual, sem detecção automática (decisão do Davi: complexidade de
  // consultar a janela real de cada modelo via /api/show do Ollama, cruzar
  // com RAM livre etc. fica pra depois, se fizer falta na prática).
  numCtxRedacao: null,
  numCtxCopiloto: null,
  manterModeloVivo: '30m',
  // Revisão v3 (03/10): `numPredict` era lido em lugar nenhum e
  // `numPredictDecisao` (320) também não — a decisão usava 1024 fixo de
  // ollama.js. Agora `numPredict` vale de verdade como teto da DECISÃO.
  // `numPredictDecisao` saiu: 320 cortaria decisões reais (até ~400 tokens
  // com plano; escrever_arquivo leva o conteúdo inteiro nos argumentos).
  numPredict: 1024,
  numPredictResposta: 3072,
  maxIterations: 25,
  autonomy: 'guiado', // manual | guiado | auto
  shellTimeoutMs: 60000,
  codeTimeoutMs: 60000,
  workspace: '',
  memoryTopK: 4,
  profundidadePesquisa: 'normal',
  // Pedido do Davi 2026-09-19: um único seletor de custo/profundidade em vez
  // de vários espalhados (profundidadePesquisa sozinho tinha seletor;
  // pipelineForcadoUniversal e a cadência de crítica "Complexo" não tinham
  // nenhum, só config manual). `derivarConfigDoNivel()` abaixo traduz este
  // valor pros campos que o resto do código já lê — profundidadePesquisa
  // continua existindo e sendo o que loop.js consulta de fato (ver
  // TETO_DE_BUSCAS), só passa a ser DERIVADO do nível em vez de setado
  // direto pela UI (ver migração em load() e o seletor #nivelRaciocinio,
  // renderer/index.html). 'leve' reproduz o comportamento de hoje (nenhuma
  // regressão pra quem não mexer no seletor).
  nivelRaciocinio: 'leve', // 'leve' | 'medio' | 'alto' | 'extremo'
  modoResposta: 'normal',
  subconsultas: true,
  // Motor de pesquisa (motor-pesquisa.js, 2026-09-24): pedido de
  // recomendação/comparação ganha plano de pesquisa (critérios + descoberta
  // de opções + busca por finalista + matriz opção × critério) antes do laço
  // de decisão. Ligado por padrão; desligar volta ao comportamento antigo.
  motorDePesquisa: true,
  // Etapa E (revisão v2, 2026-09-28): critérios curados de dados/perfis-de-uso.md
  // quando o pedido casa com um perfil (fone pra FPS, placa de vídeo pra jogos...)
  perfisDeUso: true,
  // Etapa H: resposta de pesquisa do motor montada pelo código (o modelo só escreve frases curtas)
  respostaMontada: true,
  // revisão v3 (Fase 1): pedido de explicação ("por que…", "o que é…") sem
  // plano forçado, checklist nem crítico periódico. false = comportamento antigo.
  modoExplicacao: true,
  // Roteador híbrido (roteador.js, 2026-10-10): um modelo de decisão do
  // Ollama (Tev1, /v1/systemone, Ollama ≥ 0.35) confere a rota que as regras
  // escolheram e troca quando tem confiança ≥ limiarDecisor. Desligado por
  // padrão. Nos 230 pedidos reais de 08/10: 80% (regras) → 94% (tev1 4B).
  // Sugestão: um "tev1-cpu" (Modelfile com PARAMETER num_gpu 0) pra não
  // disputar a placa de vídeo com o modelo principal.
  roteadorDecisor: false,
  modeloDecisor: 'tev1',
  // Cascata (11/10): modelo de decisão menor, consultado ANTES do de cima; o
  // de cima só entra quando este não tem confiança. Vazio = só o de cima.
  // Sugestão: "tev1-0.8b-cpu" (FROM tev1:0.8b + PARAMETER num_gpu 0).
  modeloDecisorRapido: '',
  // AUTO: quanto esperar pelo decisor antes de escolher o nível, quando a
  // regra não tem opinião ('livre'). O decisor roda em paralelo desde o início.
  autoEsperaDecisorMs: 1500,
  limiarDecisor: 0.6,
  tempoLimiteDecisorMs: 8000,
  // Controlador v2 (05/10): o "perguntar" do crítico só põe a tarefa em
  // "aguardando usuário" quando a verificação de ambiguidade confirmou que
  // falta um dado do usuário. false = comportamento antigo.
  criticoSoPerguntaComFaltaConfirmada: true,
  // Controlador v2: quantas vezes, no total, os portões podem barrar o
  // "responder" numa execução (checklist, crítico, material insuficiente).
  orcamentoVetosDeResposta: 2,
  // Controlador v2: 'frequencia' = crítica periódica a cada N passos (como
  // sempre); 'evento' = só quando algo dá errado (erro de ferramenta, ação
  // repetida, página que não muda, falha de protocolo).
  criticaPeriodicaModo: 'frequencia',
  // Fontes da comunidade (Fase A da pesquisa pela comunidade, 2026-09-26):
  // um domínio por item. Vazio = a lista padrão de dados/comunidades.json
  // (Reddit, Clube do Hardware, Fórum Adrenaline, Head-Fi).
  fontesComunidade: [],
  maxBuscas: 0,
  dominiosPersonalizados: [],
  catalogoSeletivo: true,
  usarEsquema: true,
  usarRotinas: true,
  memoriaOperacional: true,
  memoriaCentral: true,
  // Peça 3 do plano de nível de raciocínio ("memória curta" — dossiê da
  // conversa aberta, pedido do Davi 2026-09-19): cada fonte lida numa
  // execução entra em `Memory` escopada à conversa (ver `idConversa` em
  // `Agent.run()`/`Memory.add`/`Memory.buscar`), reaproveitável no resto da
  // execução e no próximo turno da mesma conversa, sem repetir busca. Trade-
  // off aceito ao escolher "extensão de Memory" em vez de módulo dedicado
  // (ver memory.js): item de dossiê entra no MESMO arquivo/teto de 500 itens
  // que as notas de longo prazo — `false` volta ao comportamento de sempre.
  memoriaCurta: true,
  // Retomada (retomada.js, 2026-10-10): páginas baixadas e destilações de uma
  // execução INTERROMPIDA são reaproveitadas pela seguinte na mesma conversa
  // (por até 12h). false = toda execução relê tudo, como antes.
  retomarLeituras: true,
  // Pré-busca (tools/web.js: adiantarBuscas, 2026-10-10): na pesquisa planejada,
  // as próximas buscas já correm (busca + download das páginas) enquanto o
  // modelo destila a atual. false = uma busca de cada vez, como antes.
  preBusca: true,
  // No modo automático o agente não para pra perguntar: segue com a suposição
  // mais provável e a declara na resposta (agir num site continua podendo perguntar).
  naoPerguntarNoAutomatico: true,
  // Página que não responde em N ms deixa de segurar a busca (as páginas de
  // uma busca são lidas em lote, e o lote esperava a mais lenta). 0 = sem limite.
  tempoMaximoPorPaginaMs: 15000,
  // Páginas lidas ficam guardadas por N dias e valem em qualquer conversa
  // (0 desliga). Pedido sobre preço, notícia, clima ou "hoje" não usa o guardado.
  cachePaginasDias: 3,
  // Páginas destiladas ao mesmo tempo (11/10). Só rende com o Ollama em 2+
  // vagas (variável de ambiente OLLAMA_NUM_PARALLEL=2): 1,39x na destilação,
  // +0,6 GB de memória de vídeo. Com 1 vaga não muda nada (os pedidos fazem fila).
  destilacaoParalela: 2,
  // Imagens nas respostas (src/tools/imagens.js, 11/10): foto de cada produto
  // nos cartões da recomendação e imagem de referência nas explicações.
  imagensNasRespostas: true,
  preBuscaConcorrencia: 2,
  // Modo AUTO (auto.js, 2026-10-10): cada pedido ganha um nível —
  // 0 direto (conversa), 1 conversa com pesquisa rápida, 2 pesquisa padrão,
  // 3 pesquisa profunda (tudo ligado). O que está marcado em Ajustes vira o
  // TETO: o AUTO só desliga etapas, nunca liga o que você desligou.
  // false = toda pergunta passa pelo pipeline completo, como antes.
  modoAuto: true,
  // núcleo de pesquisa (15/10, src/agent/nucleo): perguntas vão por ele —
  // o modelo pesquisa com ferramentas e escreve uma vez. false = caminho antigo.
  nucleoDePesquisa: true,
  // profundidade da pesquisa (seletor da tela inicial e do painel; regras em
  // src/agent/nucleo, MODOS): 'rapido' (2 rodadas), 'normal' (6, mín. 2 buscas),
  // 'profundo' (12, mín. 5 buscas, vários ângulos), 'automatico' (produto →
  // profundo, o resto → normal)
  modoDePesquisa: 'automatico',
  // botão "Resposta direta" da tela do agente (13/10): todo pedido que não
  // mexe em arquivo nem em site vai pelo nível 1 (busca rápida + resposta),
  // sem a pesquisa profunda. false = o AUTO escolhe o nível.
  respostaDireta: false,
  // modelos por nível (vazio = modelo principal). O rápido escreve os níveis
  // 0 e 1; o profundo, a redação do nível 3.
  autoModeloRapido: '',
  // Resposta imediata (11/10): no nível 1 o modelo escreve já, como na aba
  // Conversa, e a pesquisa (que corre em paralelo) serve para CONFERIR o
  // texto depois — ver resposta-rapida.js.
  autoRespostaImediata: false,
  // Resposta curta no nível 1 (11/10): mesma pesquisa, texto de até ~200
  // palavras. O que deixa o nível 1 mais lento que a aba Conversa é o tamanho
  // do texto (a pesquisa leva ~2 s), então encurtar é o jeito de ganhar tempo
  // sem abrir mão de escrever com as fontes na mão.
  // Medido em 12 perguntas de explicação: completa 8,6 em 12 s; curta 9,3 em
  // 5 s. Pedido que fala em "completa", "detalhes", "mais sobre", "história"
  // continua recebendo a resposta longa.
  autoRespostaCurta: true,
  autoModeloProfundo: '',
  // Raciocínio explícito ("think") dos modelos que pensam (qwen3.5, R1) nas
  // etapas internas. Desligado: o limite curto de crítica/plano/destilação
  // era gasto pensando e a resposta voltava vazia (SR-71, 10/10).
  pensarNasEtapas: false,
  reflexaoPosExecucao: true,
  segundaOpiniaoRiscoAlto: true,
  criticaPeriodica: true,
  // "Copiloto" nível 1 (mesmo modelo em uso) — de quantos em quantos passos
  // ele revê o plano, e quantas vezes no máximo por execução. Os valores
  // "Complexo" valem só pra pedido classificado como complexo (várias
  // perguntas/questões na mesma mensagem, ver verificador.classificarPedido)
  // — intervalo 1 = acompanha TODO passo, teto alto, a pedido do Davi (prova
  // de 10 questões com DeepSeek R1 8B): prefere gastar mais chamadas/latência
  // a deixar o plano derrapar sem ninguém questionando no meio do caminho.
  criticaPeriodicaIntervalo: 5,
  criticaPeriodicaMax: 2,
  criticaPeriodicaIntervaloComplexo: 1,
  criticaPeriodicaMaxComplexo: 6,
  // Copiloto NÍVEL 2 — nunca exige um segundo modelo pra existir (pedido
  // explícito do Davi): 'mesmoModelo' reaproveita o Copiloto nível 1 acima
  // (leve, roda em qualquer hardware); 'doisModelos' chama `modelCopiloto2`
  // separado (crítico dedicado, mais independente, precisa de RAM de sobra —
  // ver src/agent/hardware.js pra recomendação automática). A escolha é
  // sempre do usuário; 'desligado' tira o Copiloto inteiro (nível 1 + a
  // consulta sob demanda abaixo).
  copiloto2Modo: 'mesmoModelo', // 'desligado' | 'mesmoModelo' | 'doisModelos'
  // Só usado quando copiloto2Modo === 'doisModelos'. Recomendado: Llama 3.2
  // 3B (ou Llama 3.1 8B com RAM de sobra) — rodado com num_gpu:0 pra não
  // disputar VRAM com o modelo principal (ver Agent.consultarCritico).
  modelCopiloto2: '',
  // Teto de vezes que o PRÓPRIO agente pode pedir uma segunda opinião numa
  // execução (ferramenta `consultar_critico`) — contador separado do teto da
  // crítica periódica, mesmo espírito de ITENS_PENDENTES_MAX_VETOS: sem
  // isso, um agente inseguro poderia gastar a execução inteira só
  // perguntando.
  criticaSobDemandaMax: 3,
  // Pedido do Davi 2026-09-14 ("apertar as rédeas pra qualquer tipo de
  // pergunta"): sem este flag, o plano forçado (planejarInicial), o gate que
  // barra responder/concluir com checklist pendente, e a cadência mais
  // agressiva de crítica periódica (criticaPeriodica*Complexo acima) só
  // ligavam quando verificador.classificarPedido() já classificava o pedido
  // como complexo (3+ perguntas OU >800 caracteres) — a maioria do dia a dia
  // ficava de fora. true = os três valem sempre, mesmo pra "oi". Configurável
  // porque o próprio Davi topou o trade-off de latência sabendo que pode
  // reverter: false volta a ser exatamente como era antes desta rodada.
  pipelineForcadoUniversal: false,
  // Teto de consultas automáticas ao crítico nos 4 pontos fixos do pipeline
  // (entendimento, plano inicial, cada parte concluída, antes de redigir —
  // ver Agent.run()/finalizarComResposta) — contador PRÓPRIO, separado de
  // criticaSobDemandaMax (aquele é o agente pedindo por conta própria) e de
  // criticaPeriodicaMax(Complexo) (aquele é por intervalo de passos, durante
  // a execução). Esgotado, os 4 pontos passam a pular em silêncio em vez de
  // travar a execução — mesmo espírito de ITENS_PENDENTES_MAX_VETOS.
  criticaAutomaticaPorEtapaMax: 12,
  planejamentoInicial: true,
  verificarAmbiguidade: true,
  criacaoAutomaticaDeSkills: true,
  agendamentos: [],
  destilarFatos: true,
  destilarAcimaDe: 1500,
  lateralAberta: true,
  skillsDesativadas: [],
  ferramentasDesativadas: [],
  mcpServidores: [],
  searxngUrl: '',
  marginaliaKey: 'public',
  jinaKey: '',
  usarSearxngEmbutido: false,
  // tela de boas-vindas (15/10) concluída: não abre sozinha de novo (abre por Ajustes)
  boasVindasConcluida: false,
  // Fase 5: o modelo olha a imagem criada e corrige no máximo 2 vezes
  revisarImagensCriadas: true,
  // Início automático do Ollama sem perguntar — só fica true depois que o
  // usuário marcou "sempre iniciar automaticamente" na oferta ("Detectei que
  // o Ollama está desligado. Deseja que eu ative ele?"). Padrão false:
  // mesmo princípio já usado pro SearXNG embutido — nunca liga nada sozinho
  // sem o usuário ter pedido explicitamente uma vez.
  ollamaIniciarAutomaticamente: false,
  // Pedido de Davi 2026-09-18: depois de "Ajustar agora" (ver
  // ollama:definirMaxModelosCarregados, electron/main.js) gravar
  // OLLAMA_MAX_LOADED_MODELS no registro do Windows, o valor só passa a
  // valer de verdade depois que o Ollama for FECHADO e ABERTO de novo — mas
  // o aviso na tela de configurações (renderer/app.js,
  // atualizarAvisoMaxModelosCarregados) já sumia sozinho assim que o
  // registro batesse, mesmo que o Ollama que está rodando agora nunca tenha
  // sido reiniciado (caso real: aconteceu com ele). `true` enquanto o
  // reinício ainda não foi confirmado — mantém um lembrete visível em vez de
  // deixar o aviso desaparecer silenciosamente; vira `false` só quando o
  // próprio usuário confirma ("Já reiniciei o Ollama").
  ollamaMaxModelosReinicioPendente: false,
  // Fase 1 de segurança (2026-09-23): desligado por padrão. Ligado, o
  // endereço de cada página que não abre direto vai pro serviço r.jina.ai —
  // contradizia a promessa de privacidade sem o usuário ter escolhido isso.
  permitirLeitorExterno: false,
  // Fase 1 de segurança (2026-09-23): as ferramentas web recusam endereços da
  // rede local e do próprio computador (roteador, Ollama, servidores internos)
  // — ver src/tools/rede.js. Liga só quem quer que o agente leia, por
  // exemplo, um servidor de desenvolvimento em localhost.
  permitirRedeLocal: false,
  // Fase 2 (facilidade de uso): cartões técnicos da execução ("JSON inválido",
  // "fora do protocolo", "recuperado: …", "contexto compactado") só aparecem
  // com isto ligado (Ajustes → Avançado). Pra quem só usa, são ruído.
  mostrarDetalhesTecnicos: false,
  renderizarJs: true,
  navegacaoInterativa: true,
  navegadorVisivel: true,
  // Revisão v4: 'perguntar' = janela "Salvar como" (como sempre); 'pasta-de-trabalho' =
  // salva sozinho em <pasta de trabalho>/downloads e vira anexo na conversa
  downloadsDoNavegador: 'perguntar',
  chatSystem: 'Você é um assistente prestativo, direto e preciso. Responda em português do Brasil, em markdown quando ajudar a clareza. Se não souber algo, diga que não sabe.',
  alwaysAllow: [],
};

/**
 * Nível de raciocínio unificado (pedido do Davi 2026-09-19) — traduz UM
 * seletor em vários campos que hoje o resto do código já lê. `profundidadePesquisa`
 * e `pipelineForcadoUniversal` continuam sendo os campos de verdade
 * (loop.js:TETO_DE_BUSCAS, loop.js:pipelineCompleto) — não precisaram mudar,
 * só passam a ser DERIVADOS em vez de setados direto pela UI (ver
 * `Config.aplicarNivelRaciocinio`). `reselecaoDeSkill` é lido em
 * `Agent.reselecionarSkillsPorSubtarefa()` (loop.js) — decide o que soma em
 * cima da reseleção determinística de skill por subtarefa (peça 2 do plano).
 *
 * A cadência de crítica "Complexo" (`criticaPeriodicaIntervalo/MaxComplexo`,
 * loop.js~2664) já é ligada pelo MESMO `pipelineCompleto` que
 * `pipelineForcadoUniversal` alimenta — por isso não tem campo próprio
 * aqui: a partir de 'medio' ela já vem de graça, não é um quarto eixo
 * independente.
 *
 * `criticaAutomaticaPorEtapaMax` (teto do checkpoint automático do Copiloto
 * nos pontos fixos do pipeline, `Agent.criticaAutomatica()`) era um controle
 * fixo (12, sempre) até esta rodada — nível mais alto paga por mais pontos
 * de checkpoint sem se esgotar no meio de uma execução longa (mesmo espírito
 * do salto 2→6 já usado em `criticaPeriodicaMaxComplexo`).
 */
const NIVEIS_RACIOCINIO = {
  leve: {
    profundidadePesquisa: 'normal', pipelineForcadoUniversal: false,
    reselecaoDeSkill: 'deterministica', criticaAutomaticaPorEtapaMax: 12,
  },
  medio: {
    profundidadePesquisa: 'media', pipelineForcadoUniversal: true,
    reselecaoDeSkill: 'reforcoNomic', criticaAutomaticaPorEtapaMax: 12,
  },
  alto: {
    profundidadePesquisa: 'alta', pipelineForcadoUniversal: true,
    reselecaoDeSkill: 'criticoParteConcluida', criticaAutomaticaPorEtapaMax: 18,
  },
  extremo: {
    profundidadePesquisa: 'alta', pipelineForcadoUniversal: true,
    reselecaoDeSkill: 'deliberacaoDedicada', criticaAutomaticaPorEtapaMax: 24,
  },
};

function derivarConfigDoNivel(nivel) {
  return NIVEIS_RACIOCINIO[nivel] || NIVEIS_RACIOCINIO.leve;
}

/**
 * Fase 1 de segurança (2026-09-23, antes de publicar no GitHub): ações cujo
 * efeito vai muito além do pedido atual não aceitam "Sempre permitir". Antes,
 * um clique gravava `executar_comando` em `alwaysAllow` pra sempre — e dali em
 * diante qualquer comando rodava calado, inclusive um sugerido por uma página
 * lida na web (injeção de prompt). Estas continuam podendo ser aprovadas uma
 * a uma; só a autorização permanente deixa de existir. Mora aqui (e não em
 * src/tools) porque `Config.load()` também usa, pra limpar autorizações
 * antigas já gravadas no config.json de quem atualizar.
 */
const ACOES_SEM_SEMPRE_PERMITIR = new Set(['executar_comando', 'executar_codigo', 'apagar_arquivo']);

function sanearSemprePermitidas(lista) {
  return (Array.isArray(lista) ? lista : []).filter((nome) => !ACOES_SEM_SEMPRE_PERMITIR.has(nome));
}

/** Ver Config.restaurarPadroes — o que é dado do usuário, não ajuste. */
const CAMPOS_QUE_NAO_SAO_AJUSTES = new Set([
  'workspace', 'model', 'mcpServidores', 'dominiosPersonalizados', 'agendamentos',
  'skillsDesativadas', 'ferramentasDesativadas', 'lateralAberta',
  'ollamaIniciarAutomaticamente', 'ollamaMaxModelosReinicioPendente', 'boasVindasConcluida',
]);

class Config {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'config.json');
    this.data = { ...DEFAULTS };
    this.load();
  }

  /**
   * Reaplica os campos derivados de `nivelRaciocinio` sobre `this.data` —
   * chamado sempre no fim de `load()`/`save()`, pra `profundidadePesquisa`/
   * `pipelineForcadoUniversal`/`reselecaoDeSkill` nunca ficarem fora de
   * sincronia com o nível escolhido, não importa o caminho que os trouxe.
   */
  aplicarNivelRaciocinio() {
    Object.assign(this.data, derivarConfigDoNivel(this.data.nivelRaciocinio));
    // Mesmo gancho (roda no fim de load() e de save()): nenhum caminho —
    // config.json antigo, patch vindo da interface — consegue deixar uma
    // ação de ACOES_SEM_SEMPRE_PERMITIR autorizada pra sempre.
    this.data.alwaysAllow = sanearSemprePermitidas(this.data.alwaysAllow);
  }

  load() {
    // `novo` (Fase 2, 2026-09-23): true só quando não havia config.json —
    // instalação nova. electron/main.js usa isso pra aplicar padrões mais
    // leves em computador com pouca memória sem nunca mexer em quem já usa.
    this.novo = !fs.existsSync(this.file);
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const salvo = JSON.parse(raw);
      this.data = { ...DEFAULTS, ...salvo };
      // Migração (pedido do Davi 2026-09-19): config salvo de antes deste
      // campo existir só tinha `profundidadePesquisa` (3 valores, seletor
      // próprio no topo). Deriva o nível equivalente UMA VEZ, só quando o
      // arquivo salvo não menciona `nivelRaciocinio` — nunca migra sozinho
      // pra 'extremo', esse é opt-in explícito do usuário.
      if (!('nivelRaciocinio' in salvo)) {
        const inverso = { normal: 'leve', media: 'medio', alta: 'alto' };
        this.data.nivelRaciocinio = inverso[this.data.profundidadePesquisa] || 'leve';
      }
    } catch {
      /* primeira execução: mantém os padrões */
    }
    this.aplicarNivelRaciocinio();
    return this.data;
  }

  save(patch = {}) {
    this.data = { ...this.data, ...patch };
    this.aplicarNivelRaciocinio();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    return this.data;
  }

  /**
   * "Restaurar padrões" (Fase 2, facilidade de uso, 2026-09-23). Volta todo
   * AJUSTE ao valor de fábrica, mas nunca apaga o que é DADO do usuário: a
   * pasta de trabalho, o modelo escolhido, servidores MCP, domínios marcados,
   * rotinas agendadas, skills e ferramentas desligadas, preferências de
   * interface. `extras` entra por cima (main.js passa os padrões leves de
   * computador com pouca memória, os mesmos de uma instalação nova).
   */
  restaurarPadroes(extras = {}) {
    const restaurado = { ...this.data };
    for (const [chave, valor] of Object.entries(DEFAULTS)) {
      if (CAMPOS_QUE_NAO_SAO_AJUSTES.has(chave)) continue;
      restaurado[chave] = Array.isArray(valor) ? [...valor] : valor;
    }
    this.data = { ...restaurado, ...extras };
    return this.save({});
  }

  get all() {
    return { ...this.data };
  }
}

module.exports = {
  Config, DEFAULTS, NIVEIS_RACIOCINIO, derivarConfigDoNivel,
  ACOES_SEM_SEMPRE_PERMITIR, sanearSemprePermitidas, CAMPOS_QUE_NAO_SAO_AJUSTES,
};
