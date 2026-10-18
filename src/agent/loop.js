'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const ollama = require('../llm/ollama');
const { ehModeloDeDecisao, ehModeloQuePensa } = require('../primeiro-uso');
const tools = require('../tools');
const prompts = require('./prompts');
const { Memory } = require('./memory');
const { Sandbox } = require('../tools/sandbox');
const { Skills } = require('../skills');
const verificador = require('./verificador');
const serieDePrecos = require('./serie-de-precos');
const { tipoDeFonte, consultasNaComunidade } = require('../tools/comunidade');
const { destilar, maximoQueCabe } = require('./destilador');
const rotinas = require('./rotinas');
const { MemoriaOperacional, observar } = require('./memoria-operacional');
const { MemoriaCentral } = require('./memoria-central');
const { Tarefa, ESTADOS: ESTADOS_TAREFA, normalizarSubtarefa, itemDaLeitura } = require('./tarefa');
const { tipoDoPedido, comEnderecoDaConversa } = require('./tipo-de-pedido');
const { decidirRota } = require('./roteador');
const { Retomada } = require('./retomada');
const { classificarErro, anotarErro, comNovaTentativa } = require('../tools/erros');
const { montarQuadroDeModelos } = require('../modelos-carregados');
const { adiantarBuscas } = require('../tools/web');
const imagens = require('../tools/imagens');
const auto = require('./auto');
const { responderRapido } = require('./resposta-rapida');
const { rotuloDoElemento, tipoDoElemento, ACOES_QUE_DEVEM_MUDAR } = require('../tools/navegador');
const { segredosDoTexto, mascarar, mascararProfundo } = require('./segredos');
const { resolverReferencia } = require('./assunto-da-conversa');
const protocolo = require('./protocolo');
const motorPesquisa = require('./motor-pesquisa');
const { escopoDoPedido, foraDoEscopo } = require('./escopo');
const search = require('../tools/search');
const { lerComCache } = require('../tools/web');
const nucleo = require('./nucleo');
const { investigar } = require('./nucleo/investigacao');
const { ondeComprar, linhaOndeComprar } = require('./onde-comprar');
const { protegerGraficos } = require('./nucleo/graficos');
const { gerarPdf } = require('../formatos/pdf-escrita');
const { YtDlp, pareceMudancaDoYouTube, idDoVideo } = require('../ytdlp');
const { Tesseract, IMAGEM } = require('../tesseract');
const { GeradorDeImagens, pastaPadrao } = require('../gerador-de-imagens');

// Fase 4 (16/10): o renderer anexa assim (app.js, consumirAnexos). Quando TODOS os anexos são
// imagens, a pergunta vai pelo núcleo, que olha a imagem; outro anexo segue no caminho de tarefas.
// (só a imagem, sem texto: o pedido chega aparado, sem as quebras de linha antes do bloco)
const BLOCO_DE_ANEXOS = /(?:^|\n\n)Arquivos anexados, já copiados para a pasta de trabalho:\n((?:- .+\n?)+)Use ler_arquivo para abri-los\./;
/**
 * Imagem no tamanho que o modelo lê bem (16/10, foto de 474 px de um EPOS H6PRO:
 * o 9B lia o "EPOS" miúdo como "EP05" e inventava o modelo; ampliada para 1024 px,
 * leu "EPOS" 4 de 4). Foto muito grande é reduzida (menos tempo na placa). Fora do
 * Electron (bancada), a imagem vai como veio.
 */
function imagemParaOModelo(arquivo) {
  const original = fs.readFileSync(arquivo);
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage?.createFromBuffer?.(original);
    const largura = img && !img.isEmpty() ? img.getSize().width : 0;
    if (!largura || (largura >= 900 && largura <= 1600)) return original.toString('base64');
    return img.resize({ width: largura < 900 ? 1024 : 1600, quality: 'best' }).toJPEG(90).toString('base64');
  } catch {
    return original.toString('base64');
  }
}

function imagensAnexadas(objetivo) {
  const m = BLOCO_DE_ANEXOS.exec(String(objetivo || ''));
  if (!m) return null;
  const arquivos = m[1].split('\n').map((l) => l.replace(/^- /, '').replace(/ \([^)]*\)\s*$/, '').trim()).filter(Boolean);
  if (!arquivos.length || arquivos.length > 4 || !arquivos.every((a) => IMAGEM.test(a))) return null;
  return { pedido: String(objetivo).replace(m[0], '').trim() || 'O que é isto? Descreva e explique o que a imagem mostra.', arquivos };
}
const { explicarTermos } = require('./glossario');
const { comLinks } = require('./escritor-de-cartoes');
const { vetorDe } = require('./embeddings');
const { ACOES_SEM_SEMPRE_PERMITIR } = require('../config');
const {
  motivoDeAprovacao,
  CRITICA_OBRIGATORIA,
  CRITICA_PERIODICA_INTERVALO,
  CRITICA_PERIODICA_MAX,
  CRITICA_PERIODICA_INTERVALO_COMPLEXO,
  CRITICA_PERIODICA_MAX_COMPLEXO,
  MAX_REPLANEJAMENTOS,
  extrairRecomendacaoCritico,
  extrairJSON,
  resumoDeArgumentos,
  fontesDaResposta,
  itemNaoExecutavel,
  chars,
  decisaoCompacta,
  paraEnvio,
  caberNaJanela,
  calibrarRazao,
  TETO_DE_BUSCAS,
  TETO_DE_CHUNKS,
  TETO_DE_CHUNKS_PESQUISA_PLANEJADA,
  emPedacos,
  LIMITE_DIAS_MEMORIA_CURTA,
  LIMITE_DIAS_MEMORIA_CURTA_CAUTELOSO,
  GERACOES_DE_ARQUIVO,
  REPETIVEIS,
  ANOTAR_ERRO,
  listaSemOsComparados,
  LEITURAS,
  normalizar,
  ACOES_DE_PAGINA,
  ehAcaoDeNavegador,
  chaveDeRepeticao,
  itemDaAcao,
  mesmaPergunta,
  alvoDaLeitura,
  medirCobertura,
  ajusteDeBusca,
  selecionarParaRedacao,
  resumoDoDossie,
  pedidoQuerArquivo,
  mensagemDeAcaoRepetida,
  ehItemDeEntregaFinal,
  ferramentaDoItem,
  itemDeFerramentaCumprido,
  itemChecklistRelevante,
  reconciliarChecklist,
} = require('./loop-auxiliares');

class Agent extends EventEmitter {
  /**
   * Todo evento sai com as credenciais mascaradas (07/10/2026): tela,
   * registro da execução, conversa salva e tarefa persistida escutam daqui.
   * O modelo continua recebendo o pedido inteiro — só o que SAI é mascarado.
   */
  emit(evento, dados, ...resto) {
    if (this.segredos?.length && dados !== undefined) dados = mascararProfundo(dados, this.segredos);
    return super.emit(evento, dados, ...resto);
  }

  constructor({ config, userDataPath, render, navegador, skills }) {
    super();
    this.config = config;
    this.userDataPath = userDataPath;
    this.render = render || null; // renderização de páginas com JS (injetada pelo main)
    this.navegador = navegador || null; // sessão de navegação interativa (idem)
    this.skills = skills || null;
    this.rodando = false;
    this.controller = null;
    this.pendentes = new Map();
    this.aprendizado = [];
    this.iteracao = 0;
    this.uso = { prompt: 0, completion: 0 };
    this.skillsDecisao = [];
    // Item 2 (rodada 2026-09-22, "reforço do objetivo geral" — ver
    // parâmetro `reforcarObjetivo` em Skills.selecionar): ids da seleção
    // feita sobre o OBJETIVO ORIGINAL, capturados uma vez em run() e nunca
    // reescritos pelas reseleções por subtarefa que vêm depois — ao
    // contrário de `skillsDecisao` acima, que É reescrita a cada reseleção.
    this.skillsObjetivoIds = [];
    // Autoteste de skill recém-rascunhada (item 5): quando true, risco alto
    // nunca roda de verdade (é simulado) e ferramentas interativas se
    // respondem sozinhas — ver bloco "--- execução ---" em run(). Só ligado
    // numa instância de Agent isolada, criada só para o autoteste; nunca no
    // agente real que atende a conversa.
    this.modoContido = false;
  }

  // ---------- interação com a interface ----------

  // `idPersonalizado` (pedido de Davi 2026-09-18, plano das "2 IAs em
  // paralelo"): normalmente o id é gerado aqui dentro e ninguém de fora
  // precisa dele. `pedirAprovacao` (abaixo) é a exceção — precisa saber o id
  // ANTES de esperar, pra poder checar depois (this.pendentes.has(id)) se a
  // decisão do usuário já saiu enquanto uma segunda opinião ainda corria em
  // paralelo.
  esperar(tipo, payload, { id: idPersonalizado } = {}) {
    const id = idPersonalizado || `${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
      // registra ANTES de emitir: um ouvinte que responde de forma síncrona
      // travaria o loop se o id ainda não estivesse no mapa.
      this.pendentes.set(id, { resolve, reject });
      this.emit(tipo, { id, ...payload });
    });
  }

  responder(id, valor) {
    const p = this.pendentes.get(id);
    if (!p) return false;
    this.pendentes.delete(id);
    p.resolve(valor);
    return true;
  }

  cancelarPendentes(motivo) {
    for (const [, p] of this.pendentes) p.reject(new Error(motivo));
    this.pendentes.clear();
  }

  parar() {
    this.rodando = false;
    this.controller?.abort(new Error('interrompido'));
    this.cancelarPendentes('Execução interrompida.');
  }

  // ---------- ciclo principal ----------

  /**
   * Modelo de cada etapa. Decidir é classificação curta; redigir é geração
   * longa. Um modelo pequeno e rápido decide bem e um maior escreve melhor —
   * e o passo caro acontece uma vez por execução, não uma vez por passo.
   */
  modeloDe(etapa) {
    const especifico = etapa === 'decisao' ? this.config.modelDecisao : this.config.modelRedacao;
    return especifico || this.config.model;
  }

  /**
   * Revisão v5 (08/10/2026): confere os modelos ANTES de começar, pelas
   * capacidades que o Ollama informa (/api/show) e pelo nome.
   * - Modelo de decisão (tev1, Nimble) como principal: para já, com a
   *   explicação — antes virava "Jinja Exception" na primeira chamada.
   * - Modelo de decisão ou que "pensa" como copiloto dedicado: é deixado de
   *   lado nesta execução (o crítico usa o modelo principal) — o tev1 como
   *   copiloto respondeu 11 consultas sem nenhuma crítica aproveitável, e um
   *   R1 gastaria os 90–150 tokens da crítica raciocinando.
   * - Modelo que "pensa" como principal: funciona, mas avisa.
   * Devolve os avisos (emitidos por quem chama, já com a execução marcada).
   */
  async conferirModelos() {
    const info = async (nome) => ({ name: nome, capacidades: await ollama.capacidades(this.config.host, nome, { timeout: 3000 }) });
    const avisos = [];
    const principais = [...new Set([this.modeloDe('decisao'), this.modeloDe('redacao')].filter(Boolean))];
    for (const nome of principais) {
      const m = await info(nome);
      if (ehModeloDeDecisao(m)) {
        throw new Error(
          `O modelo "${nome}" é um modelo de decisão (só escolhe entre opções) e não conversa. Em Ajustes, escolha um modelo de conversa, como o qwen2.5:7b.`
        );
      }
      // 15/10: com o raciocínio do modelo desligado ("pensar nas etapas"), o AuGPT manda
      // think:false e o qwen3.5 responde direto — o aviso saía em toda resposta. Fica para
      // quem pensa sempre (DeepSeek-R1, QwQ) ou quando o raciocínio está ligado
      if (ehModeloQuePensa(m) && (this.config.pensarNasEtapas === true || /\b(r1|qwq)\b/i.test(nome))) {
        avisos.push(`o modelo "${nome}" pensa antes de responder: cada etapa fica bem mais lenta e o raciocínio pode esgotar o limite de resposta. Para o AuGPT, prefira um modelo direto (ex.: qwen2.5:7b).`);
      }
    }
    this.copilotoDescartado = null;
    if (this.config.copiloto2Modo === 'doisModelos' && this.config.modelCopiloto2) {
      const m = await info(this.config.modelCopiloto2);
      const decisao = ehModeloDeDecisao(m);
      if (decisao || ehModeloQuePensa(m)) {
        this.copilotoDescartado = this.config.modelCopiloto2;
        avisos.push(
          `copiloto "${this.config.modelCopiloto2}" ignorado nesta execução: ${decisao ? 'é um modelo de decisão, não escreve críticas' : 'pensa antes de responder e não cabe no limite curto da crítica'}. O crítico usa o modelo principal; em Ajustes, escolha um copiloto de conversa (ex.: llama3.2:3b).`
        );
      }
    }
    return avisos;
  }

  /**
   * Janela de contexto de cada etapa (pedido do Davi 2026-09-20: as 3 IAs
   * — decisão, redação, copiloto dedicado — podem ter `numCtx` próprio;
   * vazio/nulo cai no valor geral, mesmo padrão de fallback de `modeloDe()`
   * acima). `etapa === 'copiloto'` só faz sentido quando o Copiloto está de
   * fato usando um modelo dedicado (`modelCopiloto2`) — chamado assim pelos
   * dois pontos que já sabem disso (`usaModeloDedicado`).
   */
  numCtxDe(etapa) {
    const especifico = etapa === 'redacao' ? this.config.numCtxRedacao : etapa === 'copiloto' ? this.config.numCtxCopiloto : null;
    return especifico || this.config.numCtx;
  }

  /**
   * Grava na memória sem segurar o loop. Escrever memória exige uma chamada de
   * embedding, que custa segundos — fazer isso de forma síncrona era o que
   * atrasava a resposta. Aqui a aprendizagem acontece em paralelo, e só
   * esperamos por ela no fim da execução.
   *
   * `idConversa`/`bruto` (opcionais, Peça 3 — "memória curta"): repassados
   * direto pra `Memory.add()`. Omitidos, o item entra exatamente como antes
   * desta peça (sem escopo de conversa, sem frescor calculado).
   */
  /** Valor de preencher_campo num campo de senha entra na lista de segredos (segredos.js). */
  registrarSegredoDaAcao(nome, argumentos, pagina) {
    if (nome !== 'preencher_campo' || !argumentos?.valor) return;
    if (!/senha|password/i.test(tipoDoElemento(pagina, argumentos.numero) || '')) return;
    const valor = String(argumentos.valor);
    if (valor.length >= 3 && !(this.segredos ||= []).includes(valor)) this.segredos.push(valor);
  }

  memorizar(memory, texto, tipo, { idConversa, bruto } = {}) {
    // credenciais nunca entram na memória permanente (ver segredos.js)
    texto = mascarar(texto, this.segredos);
    const tarefa = memory
      .add(texto, tipo, { idConversa, bruto })
      .catch((err) => this.emit('aviso', { texto: `Falha ao memorizar: ${err.message}` }));
    this.aprendizado.push(tarefa);
    return tarefa;
  }

  /**
   * Peça 3 do plano de nível de raciocínio ("memória curta", pedido do Davi
   * 2026-09-19): cada fonte destilada nesta execução vira um item de
   * `Memory` escopado a `idConversa` — reaproveitável (via `memory.buscar`,
   * mais abaixo em `run()`) tanto no RESTO desta mesma execução quanto num
   * PRÓXIMO turno da mesma conversa, sem repetir uma busca já feita. Sai
   * fora sem gravar nada (nem uma chamada de embedding) quando a conversa
   * não tem id (agendamento, chamada avulsa) ou `memoriaCurta` está
   * desligado — mesma degradação graciosa do resto do projeto.
   */
  salvarDossieNaMemoriaCurta(entradas, { memory, idConversa }) {
    if (!idConversa || this.config.memoriaCurta === false) return;
    for (const entrada of entradas) {
      if (!entrada.texto) continue;
      const origem = entrada.url ? `${entrada.origem} (${entrada.url})` : entrada.origem;
      this.memorizar(memory, `${origem}:\n${entrada.texto}`, 'dossie', { idConversa, bruto: entrada.bruto });
    }
  }

  /**
   * Backlog do Copiloto, item m1 (unificar os gates determinísticos).
   *
   * `pedidoQuerArquivo`, o teto de busca, o guarda de ação repetida e o gate
   * de checklist pendente são lógicas diferentes (cada um decide BARRAR por
   * um motivo próprio), mas todos terminam do mesmo jeito: emitem
   * `'resultado'` com o erro, devolvem a própria decisão do modelo pro
   * histórico (senão ele não sabe o que tentou) seguida da instrução do que
   * fazer em vez disso, e o chamador volta pro topo do loop com `continue`.
   * Cada gate tinha essa sequência copiada e colada na própria mão. Isto NÃO
   * muda o que nenhum gate decide ou diz (nenhum teste de comportamento
   * deveria quebrar) — só dá um nome e um lugar comuns pro padrão ("o
   * Copiloto": a camada de regras determinísticas que intervém sem chamar o
   * modelo), e conta, num total só, quantas vezes isso aconteceu na
   * execução — emitido em `'copiloto'`, pra quem acompanha (UI, registro)
   * não precisar somar através de vários tipos de evento diferentes pra
   * saber com que frequência o copiloto está intervindo.
   *
   * `continue` continua no chamador — um helper não consegue pular a
   * iteração de um laço que não é o dele.
   */
  vetoDoCopiloto({ gate, nome, plano, erro, instrucao, historico }) {
    this.intervencoesCopiloto += 1;
    this.emit('resultado', { n: this.iteracao, nome, argumentos: resumoDeArgumentos(plano?.ferramenta?.argumentos), saida: '', erro, duracao: 0 });
    this.emit('copiloto', { gate, nome, total: this.intervencoesCopiloto });
    historico.push({ role: 'assistant', content: decisaoCompacta(plano) });
    historico.push({ role: 'user', content: instrucao });
  }

  /**
   * Reflexão pós-execução (Reflexion leve).
   *
   * Uma chamada curta e assíncrona ao modelo de decisão, disparada ao final de
   * uma execução — pergunta o que faria diferente numa tarefa parecida, e
   * guarda a resposta na memória operacional sob o tipo "estrategia". Não
   * bloqueia a resposta ao usuário (entra em `this.aprendizado`, como a
   * gravação na memória vetorial) e uma falha aqui não pode derrubar a
   * execução — é bônus, não requisito.
   */
  refletir({ objetivo, operacional }) {
    if (this.config.memoriaOperacional === false || this.config.reflexaoPosExecucao === false) return;
    if (!operacional) return;

    const chave = this.skillsDecisao?.[0]?.nome || 'geral';
    const tarefa = ollama
      .chat({
        host: this.config.host,
        model: this.modeloDe('decisao'),
        messages: [
          { role: 'user', content: prompts.pedidoDeReflexao({ objetivo, passos: this.iteracao, verificacao: this.verificacao }) },
        ],
        temperature: 0.2,
        numCtx: this.numCtxDe('decisao'),
        numPredict: 120,
        manterVivo: this.config.manterModeloVivo,
      })
      .then(async (r) => {
        this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'reflexao', duracaoMs: r.durationMs });
        const licao = String(r.content || '').trim().replace(/^["“]|["”]$/g, '').slice(0, 240);
        if (licao && licao.length > 8 && !/^(nada|nenhuma?)\b/i.test(licao)) {
          operacional.refletir({ chave, licao });
        }

        // Criação automática de skills (item 5): 'geral' é o sinal — de
        // graça — de que nenhuma skill cobriu esta tarefa. Só vale agrupar
        // como "mesmo padrão" pedidos que também são parecidos entre si, daí
        // o embedding em vez de só olhar pra `chave`.
        if (chave === 'geral' && this.config.criacaoAutomaticaDeSkills !== false && this.skills) {
          const vec = await vetorDe(objetivo, { host: this.config.host, embedModel: this.config.embedModel });
          if (vec) {
            // 2ª revisão: o pedido vai pro arquivo de candidatas a skill — sem credenciais
            operacional.registrarTarefaSemSkill({ objetivo: mascarar(objetivo, this.segredos), licao, vec });
            const cluster = operacional.formarCluster();
            if (cluster) {
              // Dispara em segundo plano, DE PROPÓSITO fora de `this.aprendizado`:
              // rascunhar + autotestar é uma execução inteira extra (ver
              // `autotestarSkill`) — não pode atrasar a resposta que já está
              // pronta pro usuário, nem travar a execução se falhar.
              this.proporSkillFromCluster({ cluster }).catch((err) => {
                this.emit('aviso', { texto: `Falha ao propor skill automática: ${err.message}` });
              });
            }
          }
        }
      })
      .catch(() => {}); // reflexão é bônus: falhar aqui não pode afetar a execução

    this.aprendizado.push(tarefa);
  }

  /**
   * Forma um rascunho de SKILL.md a partir de um cluster de tarefas parecidas
   * sem skill nenhuma cobrindo, manda pro autoteste (`autotestarSkill`), e só
   * então grava como sugestão (`Skills.criar(..., { sugerida: true })`) —
   * nunca ativa sozinha numa conversa real (ver `Skills.selecionar()`).
   */
  async proporSkillFromCluster({ cluster }) {
    const objetivos = cluster.map((c) => c.objetivo);
    const r = await ollama.chat({
      host: this.config.host,
      model: this.modeloDe('decisao'),
      messages: [{ role: 'user', content: prompts.pedidoDeRascunhoDeSkill({ objetivos }) }],
      temperature: 0.3,
      numCtx: this.numCtxDe('decisao'),
      numPredict: 700,
      manterVivo: this.config.manterModeloVivo,
    });
    this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'skill-cluster', duracaoMs: r.durationMs });
    const rascunho = extrairJSON(r.content);
    if (!rascunho || !rascunho.nome || !rascunho.corpo) return null;

    const autoteste = await this.autotestarSkill({ rascunho, objetivoDeTeste: objetivos[objetivos.length - 1] });

    const criada = this.skills.criar(String(rascunho.nome).slice(0, 60), {
      descricao: rascunho.descricao,
      gatilhos: Array.isArray(rascunho.gatilhos) ? rascunho.gatilhos.slice(0, 8) : [],
      corpo: rascunho.corpo,
      sugerida: true,
      autotestada: autoteste.passou,
      autotesteResumo: autoteste.motivo,
    });

    this.emit('skill-sugerida', { ...criada, rascunho, autoteste });
    return { ...criada, rascunho, autoteste };
  }

  /**
   * Autoteste de uma skill recém-rascunhada (item 5): roda uma execução
   * ISOLADA do próprio Agent — nunca a conversa visível do usuário — com o
   * rascunho forçado a participar da seleção (ignora gatilho/embedding pra
   * essa rodada: é teste dirigido, não descoberta) sobre um objetivo real que
   * ajudou a formar o cluster. Roda em modo contido (`this.modoContido`):
   * risco alto nunca executa de verdade, e ferramentas interativas se
   * respondem sozinhas — não há humano esperando do outro lado.
   */
  async autotestarSkill({ rascunho, objetivoDeTeste }) {
    const skillForcada = {
      id: 'sugerida:autoteste-temporario',
      pasta: 'autoteste-temporario',
      caminho: '',
      origem: 'sua',
      nome: rascunho.nome,
      descricao: rascunho.descricao || '',
      importada: false,
      gatilhos: [],
      naoUsePara: [],
      ferramentas: [],
      etapa: 'ambas',
      prioridade: 1,
      sempre: true, // força a entrar na seleção desta execução isolada
      corpo: rascunho.corpo || '',
      tamanho: String(rascunho.corpo || '').length,
      temRotina: false,
    };

    // clona a instância real de Skills (mesmo protótipo/métodos) sem reler
    // disco e sem tocar na lista que a conversa de verdade está usando
    const skillsDeTeste = Object.create(Object.getPrototypeOf(this.skills));
    Object.assign(skillsDeTeste, this.skills, { lista: [...this.skills.lista, skillForcada] });

    const isolado = new Agent({
      config: this.config,
      userDataPath: this.userDataPath,
      render: null,
      navegador: null,
      skills: skillsDeTeste,
    });
    isolado.modoContido = true;
    // sem UI de verdade do outro lado: aprova tudo que ainda pedir aprovação
    // (raro em modo contido — risco alto já é simulado antes de chegar aqui)
    // e responde sozinho a qualquer pergunta, no espírito da bancada de avaliação
    isolado.on('aprovacao', (d) => isolado.responder(d.id, 'aprovar'));
    isolado.on('pergunta', (d) => isolado.responder(d.id, 'Prossiga com o que você já tem.'));

    const transcript = [];
    isolado.on('ferramenta', (d) => transcript.push(`→ ${d.nome}(${JSON.stringify(d.argumentos || {}).slice(0, 140)})`));
    isolado.on('resultado', (d) => {
      if (d.erro) {
        transcript.push(`  erro: ${String(d.erro).slice(0, 200)}`);
      } else {
        transcript.push(`  ok: ${String(d.saida || '').slice(0, 200)}`);
      }
    });

    let resultado;
    try {
      resultado = await isolado.run(objetivoDeTeste, []);
    } catch (err) {
      resultado = { ok: false, motivo: err.message };
    }

    const resumoExecucao = transcript.slice(0, 30).join('\n') || '(nenhuma ação registrada)';
    const concluiu = Boolean(resultado?.ok);

    let veredito = {
      passou: concluiu,
      motivo: concluiu ? 'concluiu a tarefa de teste' : `não concluiu (${resultado?.motivo || 'sem resumo'})`,
    };
    try {
      const r = await ollama.chat({
        host: this.config.host,
        model: this.modeloDe('decisao'),
        messages: [{
          role: 'user',
          content: prompts.pedidoDeAutoavaliacaoDeSkill({ objetivo: objetivoDeTeste, skill: rascunho, resumoExecucao, concluiu }),
        }],
        temperature: 0.2,
        numCtx: this.numCtxDe('decisao'),
        numPredict: 100,
        manterVivo: this.config.manterModeloVivo,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'autoteste-skill', duracaoMs: r.durationMs });
      const texto = String(r.content || '').trim();
      const passou = /^passou\b/i.test(texto);
      const motivo = texto.replace(/^(passou|n[aã]o passou)\s*[:.\-—]*\s*/i, '').trim();
      veredito = { passou, motivo: motivo ? motivo.slice(0, 240) : veredito.motivo };
    } catch {
      /* autoavaliação é bônus: sem ela, fica o veredito bruto de ok/erro acima */
    }

    return { passou: veredito.passou, motivo: veredito.motivo, resumo: resumoExecucao.slice(0, 2000), objetivoDeTeste };
  }

  /**
   * Segunda opinião antes de uma ação de risco alto e destrutiva
   * (apagar_arquivo, executar_comando). Não substitui o portão de aprovação —
   * só enriquece o que o usuário vê antes de decidir, com uma crítica focada
   * NESTA chamada específica, não no risco genérico da ferramenta.
   *
   * Roteada por `_perguntarAoCritico` (pedido de Davi 2026-09-18, plano das
   * "2 IAs em paralelo"): antes chamava `ollama.chat` direto, sempre com o
   * MESMO modelo da decisão principal — mesmo no modo "2 IAs"
   * (`copiloto2Modo === 'doisModelos'`), onde já existe um modelo dedicado
   * (CPU) só pra este tipo de crítica. Com isso corrigido, a segunda opinião
   * passa a vir de um modelo de verdade separado quando "2 IAs" está
   * configurado — deixa de ser "o modelo concordando consigo mesmo" — sem
   * competir por VRAM com a decisão principal (`numGpu: 0`, já tratado
   * dentro de `_perguntarAoCritico`). Só passou a ser seguro assumir isso sem
   * medir de novo porque já confirmamos ao vivo (2026-09-18, com o Davi) que
   * o Ollama dele roda GPU+CPU ao mesmo tempo sem perda de desempenho.
   */
  async segundaOpiniao({ nome, argumentos }) {
    if (this.config.segundaOpiniaoRiscoAlto === false) return null;
    if (!CRITICA_OBRIGATORIA.has(nome)) return null;
    const { texto, erro } = await this._perguntarAoCritico({ acao: { nome, argumentos } });
    if (erro || !texto) return null; // reforço, não requisito: não pode travar o portão de aprovação
    return texto.length > 4 && !/^(nenhum|nenhuma|nada|sem risco)/i.test(texto) ? texto.slice(0, 300) : null;
  }

  /**
   * Pede a aprovação do usuário para uma ferramenta de risco alto/médio — a
   * segunda opinião do crítico (segundaOpiniao acima) e o cartão de
   * aprovação corriam em SÉRIE (esperar a crítica terminar pra só então
   * mostrar o pedido pro usuário); pedido de Davi 2026-09-18 (plano das "2
   * IAs em paralelo"): agora rodam ao mesmo tempo. `nome`/`argumentos`/
   * `risco`/`descricao` não dependem em nada do que a crítica disser, então
   * não há razão pra fazer o usuário esperar a resposta do modelo antes de
   * sequer VER o que está sendo pedido — o cartão aparece na hora,
   * `segundaOpiniao` roda em paralelo, e se (e quando) ela responder ANTES
   * de o usuário decidir, um evento à parte (`aprovacao-critica`) entrega a
   * opinião pra UI anexar ao cartão que já está na tela. Se o usuário decidir
   * primeiro, `this.pendentes` já não tem mais o id (removido por
   * `responder()`) — a crítica chegou tarde demais pra importar, e não emite
   * evento nenhum (ninguém pra ouvir: o cartão já foi resolvido).
   *
   * Devolve só a decisão (`decisao`) — quem chama decide o que fazer com
   * "negar" (os dois call-sites hoje divergem nesse ponto: um é o helper de
   * busca de reforço, outro é o laço principal, que também empurra mensagens
   * pro histórico).
   */
  async pedirAprovacao({ nome, argumentos, ferramenta, motivo = null }) {
    const id = `aprovacao-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const promessaCritica = this.segundaOpiniao({ nome, argumentos }); // dispara já — não espera aqui
    promessaCritica.then((critica) => {
      if (critica && this.pendentes.has(id)) this.emit('aprovacao-critica', { id, critica });
    });
    const permiteSempre = !ACOES_SEM_SEMPRE_PERMITIR.has(nome);
    const resposta = await this.esperar('aprovacao', {
      nome,
      argumentos,
      risco: ferramenta.risk,
      descricao: ferramenta.description,
      permiteSempre, // a interface esconde "Sempre permitir" quando false (ver src/config.js)
      motivo, // por que ESTA chamada pede confirmação, quando não é só o risco da ferramenta
      critica: null, // chega depois, via 'aprovacao-critica', se der tempo antes da decisão
    }, { id });

    // Fase 1 de segurança (2026-09-23): a aprovação falha FECHADA. Antes, os
    // dois pontos de chamada só testavam `decisao === 'negar'` — qualquer
    // outro valor (vazio, digitado errado, vindo de um canal inesperado)
    // executava a ação. Agora só 'aprovar' e 'sempre' liberam; o resto vira
    // 'negar'. E 'sempre' numa ação que não aceita autorização permanente vale
    // só pra esta vez.
    let decisao = resposta === 'aprovar' || resposta === 'sempre' ? resposta : 'negar';
    if (decisao === 'sempre' && !permiteSempre) decisao = 'aprovar';

    this.emit('aprovacao-resolvida', { nome, decisao });
    if (decisao === 'sempre') {
      this.config.alwaysAllow = [...new Set([...(this.config.alwaysAllow || []), nome])];
      this.emit('config-alterada', { alwaysAllow: this.config.alwaysAllow });
    }
    return decisao;
  }

  /**
   * Peça 2 do nível de raciocínio unificado (pedido do Davi 2026-09-19): a
   * seleção de skill original (início de run()) usa só o objetivo geral e
   * fica CONGELADA o turno inteiro — uma skill que só faz sentido numa
   * subtarefa mais adiante nunca chega a concorrer. Chamado do laço
   * principal sempre que o FOCO (primeiro item pendente do checklist) muda
   * de texto — recalcula com a MESMA `skills.selecionar()` de sempre, sem
   * alterar a lógica dela, só trocando o texto de entrada pro da subtarefa
   * atual.
   *
   * `this.config.reselecaoDeSkill` (derivado de `nivelRaciocinio`, ver
   * `derivarConfigDoNivel` em src/config.js) decide o que soma em cima da
   * reseleção determinística, que roda sempre, em todo nível:
   *   - 'deterministica' (leve): só isso — zero custo extra (a função já é
   *     100% código).
   *   - 'reforcoNomic' (médio): liga `reforcoSemantico` — o embedding roda
   *     como reforço mesmo com gatilho batendo, ainda sem chamar modelo.
   *   - 'criticoParteConcluida' (alto): a observação que o checkpoint
   *     automático de "parte concluída" já produz NESTE MESMO PONTO do loop
   *     (reaproveitamento, não chamada nova) entra como contexto extra no
   *     texto da reseleção.
   *   - 'deliberacaoDedicada' (extremo): depois da reseleção acima, uma
   *     chamada de modelo dedicada e curta pergunta se a skill escolhida
   *     ainda serve — a única peça deste plano que soma uma chamada NOVA,
   *     coerente com o usuário já saber que está pagando por isso.
   *
   * Item 2 (rodada 2026-09-22): em cima de tudo isso, `reforcarObjetivo`
   * (ver `opcoesBase` abaixo) preenche vaga sobrando no teto com skill que
   * já pontuou no objetivo geral — roda em TODO nível, mesma regra da
   * reseleção determinística em si (zero custo extra, é código, não modelo).
   * Corrige o caso em que a reseleção "esquecia" uma skill que continuava
   * relevante pro pedido inteiro só porque o texto de uma subtarefa mais
   * estreita não repetia o gatilho dela.
   */
  async reselecionarSkillsPorSubtarefa({ foco, observacao }) {
    if (!this.skills) return [];
    const nivel = this.config.reselecaoDeSkill || 'deterministica';
    const opcoesBase = {
      etapa: 'decisao',
      desativadas: this.config.skillsDesativadas || [],
      host: this.config.host,
      embedModel: this.config.embedModel,
      // Item 6: a skill que o usuário forçou por "/nome" (ver run() acima)
      // continua valendo nas reseleções por subtarefa da MESMA execução —
      // ele pediu ela pra este pedido inteiro, não só pro primeiro passo.
      forcarId: this.skillForcada?.id || null,
      // Item 2 (rodada 2026-09-22, achado no caso real do fone pra PUBG): a
      // seleção feita sobre o objetivo geral, capturada uma vez no início de
      // run() — preenche vaga que sobrar no teto desta subtarefa com skill
      // que já provou relevância pro pedido inteiro, sem nunca deslocar uma
      // skill que bateu gatilho na subtarefa atual (essa sempre vence, ver
      // Skills.selecionar). Roda em TODO nível, igual a reseleção
      // determinística em si — é reforço, não chamada nova, não muda o
      // custo do nível "leve".
      reforcarObjetivo: this.skillsObjetivoIds,
    };
    const textoAlvo = nivel === 'criticoParteConcluida' && observacao ? `${foco}\n${observacao}` : foco;
    const skillsAtuais = await this.skills.selecionar(textoAlvo, {
      ...opcoesBase,
      reforcoSemantico: nivel === 'reforcoNomic' || nivel === 'deliberacaoDedicada',
    });
    if (nivel !== 'deliberacaoDedicada') return skillsAtuais;
    return this.deliberarSkillPorSubtarefa({ foco, skillsAtuais, opcoesBase });
  }

  /**
   * A chamada nova do nível "extremo" (ver `reselecionarSkillsPorSubtarefa`
   * acima). Pergunta curta ao crítico (mesmo modelo/dedicado de
   * `consultarCritico`, mesmo teto `criticaSobDemandaMax` — não abre um
   * orçamento próprio, soma no mesmo contador de "segunda opinião" que já
   * existe) — resposta num formato fixo fácil de parsear (MANTER / TROCAR:
   * ..., ver prompts.pedidoDeDeliberacaoDeSkill), sem JSON novo. Indisponível
   * ou teto esgotado: mantém a seleção que já tinha, nunca trava a execução
   * por causa de uma pergunta consultiva.
   */
  async deliberarSkillPorSubtarefa({ foco, skillsAtuais, opcoesBase }) {
    const teto = this.config.criticaSobDemandaMax ?? 3;
    if (this.consultasCriticoFeitas >= teto) return skillsAtuais;

    const usaModeloDedicado = this.config.copiloto2Modo === 'doisModelos' && Boolean(this.config.modelCopiloto2) && this.copilotoDescartado !== this.config.modelCopiloto2;
    const model = usaModeloDedicado ? this.config.modelCopiloto2 : this.modeloDe('decisao');
    const conteudo = prompts.pedidoDeDeliberacaoDeSkill({
      foco,
      nomesAtuais: skillsAtuais.map((s) => s.nome).join(', '),
    });

    this.consultasCriticoFeitas += 1;
    try {
      const r = await ollama.chat({
        host: this.config.host,
        model,
        messages: [{ role: 'user', content: conteudo }],
        temperature: 0.2,
        numCtx: usaModeloDedicado ? this.numCtxDe('copiloto') : this.numCtxDe('decisao'),
        numPredict: 40,
        manterVivo: this.config.manterModeloVivo,
        numGpu: usaModeloDedicado ? 0 : undefined,
        signal: this.controller.signal,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'copiloto', duracaoMs: r.durationMs });
      this.emit('copiloto-consulta', { origem: 'reselecao-skill', modelo: model, dedicado: usaModeloDedicado, ok: true });

      const resposta = String(r.content || '').trim();
      const troca = /TROCAR:\s*(.+)/i.exec(resposta);
      if (troca) {
        const temaReal = troca[1].trim().slice(0, 200);
        return this.skills.selecionar(`${foco} ${temaReal}`, { ...opcoesBase, reforcoSemantico: true });
      }
      return skillsAtuais; // MANTER, ou resposta fora do formato esperado — não penaliza uma seleção que já era válida
    } catch (err) {
      this.emit('copiloto-consulta', { origem: 'reselecao-skill', modelo: model, dedicado: usaModeloDedicado, ok: false, erro: err.message });
      return skillsAtuais;
    }
  }

  /**
   * Planejamento inicial forçado — só chamado quando classificarPedido()
   * (verificador.js, determinístico, SEM chamar o modelo) já decidiu que
   * este pedido precisa de plano explícito (prova de várias questões,
   * pedido longo e composto). Ao contrário de criticaDoPlano acima (que só
   * comenta um plano que o próprio modelo decidiu declarar ou não na
   * primeira decisão), esta chamada roda sempre que classificado — o
   * resultado vira checklist ANTES da primeira iteração, então já aparece
   * como "SEU PLANO:" desde o passo 1 (ver `situacao` em run()), em vez de
   * depender do modelo lembrar de propor um `plano` sozinho.
   *
   * O que é determinístico aqui é SÓ a decisão de que esta etapa acontece —
   * o conteúdo do plano continua sendo julgamento do modelo (como tem que
   * ser: decidir OS PASSOS exige entender o pedido). Falhar aqui não pode
   * travar a execução — devolve lista vazia, e o mecanismo antigo (o
   * modelo propor `plano` por conta própria, reconciliado a cada iteração)
   * continua funcionando exatamente como antes.
   */
  /** Teto de passos da execução: o configurado + as buscas do motor de pesquisa. */
  limiteDePassos() {
    return this.config.maxIterations + (this.passosExtras || 0);
  }

  /**
   * Motor de pesquisa (motor-pesquisa.js, 2026-09-24): pedido de
   * recomendação/comparação ganha plano de pesquisa, descoberta de opções,
   * busca por finalista, matriz opção × critério e plano da resposta ANTES do
   * laço de decisão. Aqui só a ligação com o agente: as duas chamadas de
   * modelo (contabilizadas como qualquer outra) e as buscas, que passam por
   * `executarPasso` — mesma ferramenta, mesma destilação (com foco), mesmos
   * eventos na tela e o mesmo dossiê do resto da execução.
   */
  async pesquisarComPlano({ objetivo, executarPasso, dossie, ctx = null }) {
    const chamarModelo = async (conteudo, { tipo, numPredict }) => {
      try {
        this.emit('chamada', { tipo });
        const r = await ollama.chat({
          host: this.config.host,
          model: this.modeloDe('decisao'),
          messages: [{ role: 'user', content: conteudo }],
          temperature: 0.2,
          numCtx: this.numCtxDe('decisao'),
          numPredict,
          manterVivo: this.config.manterModeloVivo,
          signal: this.controller.signal,
        });
        this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo, duracaoMs: r.durationMs });
        return String(r.content || '');
      } catch (err) {
        if (!this.rodando) throw err;
        this.emit('aviso', { texto: `pesquisa planejada: a chamada "${tipo}" falhou (${err.message}); seguindo sem ela` });
        return '';
      }
    };
    const buscar = async (consulta, foco, opcao = '', extras = {}, deveCitar = false) => {
      const antes = dossie.length;
      this.passosExtras += 1;
      // extras: idioma ('all' pra Reddit/Head-Fi) e comunidade (vários tópicos do mesmo fórum)
      await executarPasso({ nome: 'pesquisar_e_ler', argumentos: { consulta, ...extras }, foco, opcao, deveCitar });
      return dossie.slice(antes);
    };
    const r = await motorPesquisa.executarPesquisaPlanejada({
      objetivo,
      nivel: this.config.nivelRaciocinio || 'leve',
      chamarModelo,
      buscar,
      emitir: (evento, dados) => this.emit(evento, dados),
      config: this.config,
      // Etapa C: o motor grava a evidência estruturada no livro da Tarefa
      ...(this.tarefa?.livro ? { livro: this.tarefa.livro } : {}),
      rota: this.rota || null,
      // pré-busca: as próximas buscas da lista do motor correm em segundo plano
      ...(ctx ? { preBuscar: (lista) => adiantarBuscas(lista, ctx) } : {}),
    });
    // Etapa B: o que o motor marcou como fora do escopo sai do dossiê (não
    // vai pra redação nem pras fontes)
    for (let i = dossie.length - 1; i >= 0; i -= 1) if (dossie[i]?.foraDoEscopo) dossie.splice(i, 1);
    if (r.ok) {
      // Etapa F: os números calculados pelo código (diferença %, tabela de
      // jogos, ficha, preço) entram no dossiê como material — a redação e o
      // verificador os reconhecem como respaldados (como a série de preços)
      if (r.modo === 'desempenho' || r.modo === 'uso-profissional') {
        const bloco = String(r.planoDeResposta).split('\nFORMATO:')[0];
        dossie.push({ origem: 'comparativo de desempenho (calculado pelo código)', texto: bloco, bruto: bloco, url: '', calculado: true });
      }
      this.planoDeResposta = r.planoDeResposta;
      // Etapa H: o resultado inteiro do motor fica pra resposta montada pelo código
      // "conhecer um produto": 13/10 ia para a redação livre (a resposta do Dunu
      // parou na ficha); 14/10 é montada como os outros, com o cartão escrito
      // do dossiê do produto. Sem os cartões ligados, volta à redação livre.
      this.composicaoDaPesquisa = r.modo === 'produto' && this.config.cartoesPorProduto === false ? null : r;
      this.produtoPesquisado = r.modo === 'produto' ? r.produto : null;
      this.listaDaPesquisa = r.listaNumerada || '';
      this.entradasDaMatriz = r.matriz.entradasUsadas;
      // opções comparadas contam como "assunto do pedido" na verificação (ver coberturaPorParagrafo)
      this.opcoesDaPesquisa = r.finalistas.map((f) => f.nome);
      // Etapa B: as fontes da resposta são as que o motor CITOU (tópicos das
      // citações + páginas que viraram evidência na matriz), não as que o
      // modelo listou em "responder" (14º teste: mercadolivre, "curso superior")
      this.fontesDaPesquisa = [
        ...r.finalistas.flatMap((f) => (f.consenso?.citacoes || []).map((c) => c.url)),
        ...(r.matriz.entradasUsadas || []).map((e) => e.url),
      ].filter(Boolean);
    }
    // plano e consultas vão junto pro registro da execução (registro.js): sem
    // isso, revisar uma execução real não mostrava quais opções o motor achou
    // nem o que o redator recebeu (foi o que faltou no 1º teste real).
    this.emit('pesquisa-fim', {
      ok: r.ok,
      motivo: r.motivo || null,
      buscas: r.buscas,
      consultas: r.consultas || [],
      planoDeResposta: r.ok ? String(r.planoDeResposta).slice(0, 8000) : null,
    });
    return r;
  }

  async planejarInicial({ objetivo, perguntas, tipo = this.tipoDoPedido }) {
    if (this.config.planejamentoInicial === false) return [];
    try {
      const r = await ollama.chat({
        host: this.config.host,
        model: this.modeloDe('decisao'),
        messages: [{ role: 'user', content: prompts.pedidoDePlanejamentoInicial({ objetivo, perguntas, tipo }) }],
        temperature: 0.2,
        numCtx: this.numCtxDe('decisao'),
        numPredict: 300,
        manterVivo: this.config.manterModeloVivo,
        signal: this.controller.signal,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'planejamento', duracaoMs: r.durationMs });
      const texto = String(r.content || '').trim();
      if (!texto) return [];
      const passos = texto
        .split('\n')
        .map((l) => l.replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 8);
      // Etapa B (14º teste real): item que nenhuma ferramenta executa sai do
      // plano — "contatar marcas de equipamento", "definir as plataformas de
      // pesquisa relevantes". O gate de checklist obrigava a cumpri-los e o
      // agente rodou 36 passos buscando o NOME das plataformas.
      const executaveis = passos.filter((p) => {
        const motivo = itemNaoExecutavel(p, objetivo, tipo);
        if (motivo) this.emit('descarte', { etapa: 'plano', alvo: p, motivo });
        return !motivo;
      });
      return executaveis;
    } catch {
      return []; // bônus, não requisito: falhar aqui não pode travar a execução
    }
  }

  async planejarNovamente({ objetivo, checklist, motivo, acoes }) {
    if ((this.replanejamentosFeitos || 0) >= MAX_REPLANEJAMENTOS) return [];
    this.replanejamentosFeitos = (this.replanejamentosFeitos || 0) + 1;
    try {
      const r = await ollama.chat({
        host: this.config.host,
        model: this.modeloDe('decisao'),
        messages: [{
          role: 'user',
          content: prompts.pedidoDeReplanejamento({ objetivo, checklist, motivo, acoes }),
        }],
        temperature: 0.2,
        numCtx: this.numCtxDe('decisao'),
        numPredict: 300,
        manterVivo: this.config.manterModeloVivo,
        signal: this.controller.signal,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'planejamento', duracaoMs: r.durationMs });
      return String(r.content || '')
        .split('\n')
        .map((linha) => linha.replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .filter((p) => !itemNaoExecutavel(p, objetivo, this.tipoDoPedido));
    } catch {
      return [];
    }
  }

  /**
   * Verifica, ANTES de qualquer outra coisa usar o objetivo, se o pedido já
   * tem informação suficiente para agir (pesquisar, ler, usar conhecimento
   * geral) ou se falta algo que só o usuário sabe (uma senha, qual de dois
   * arquivos parecidos, uma preferência pessoal). Substitui a regra cega
   * antiga de "nunca pergunte nas duas primeiras rodadas" por uma checagem
   * de verdade — a regra cega continua existindo (`loop.js`, guarda de
   * `perguntar_usuario`), só ganha uma exceção legítima quando ESTA
   * verificação apontou a falta.
   *
   * Na mesma chamada, também reescreve o pedido como instrução
   * autossuficiente usando a conversa recente (ver `pedidoDeAmbiguidade`) —
   * `objetivo` no retorno é essa versão (ou o original, se não mudou nada,
   * ou se o modelo não devolveu reescrita nenhuma). Quem chama roda isso
   * bem no início de `run()`, antes de `textoDoPedido`/seleção de
   * skill/prompt de sistema serem montados, justamente pra esses se
   * beneficiarem da versão reescrita.
   */
  async verificarAmbiguidade({ objetivo, conversa = [] }) {
    if (this.config.verificarAmbiguidade === false) return { suficiente: true, objetivo };
    try {
      const r = await ollama.chat({
        host: this.config.host,
        model: this.modeloDe('decisao'),
        messages: [{ role: 'user', content: prompts.pedidoDeAmbiguidade({ objetivo, conversa }) }],
        temperature: 0,
        numCtx: this.numCtxDe('decisao'),
        // Era 160 — baixo demais pra "repetir exatamente" um pedido longo
        // sem cortar (ver o comentário no teto de pedidoDeAmbiguidade, em
        // prompts.js, e a trava em run() abaixo).
        numPredict: 400,
        manterVivo: this.config.manterModeloVivo,
        signal: this.controller.signal,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'ambiguidade', duracaoMs: r.durationMs });
      const texto = String(r.content || '').trim();
      if (!texto) return { suficiente: true, objetivo };
      const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
      if (/^suficiente\b/i.test(linhas[0] || '')) {
        const resto = linhas.slice(1);
        let bifurcacao = null;
        const idxBifurcacao = resto.findIndex((l) => /^bifurca[cç][aã]o\s*:/i.test(l));
        let linhasReescrito = resto;
        if (idxBifurcacao !== -1) {
          linhasReescrito = resto.slice(0, idxBifurcacao).concat(resto.slice(idxBifurcacao + 1));
          const valor = resto[idxBifurcacao].replace(/^bifurca[cç][aã]o\s*:/i, '').trim();
          const partes = valor.split('||').map((p) => p.trim()).filter(Boolean);
          // Rede de segurança: se as duas opções são parecidas demais (mesma
          // leitura escrita de dois jeitos, não duas leituras de verdade),
          // descarta a bifurcação — ver pareceParafrase em verificador.js.
          if (partes.length === 2 && !verificador.pareceParafrase(partes[0], partes[1])) {
            bifurcacao = { a: partes[0], b: partes[1] };
          }
        }
        const reescrito = linhasReescrito.join(' ').trim();
        return { suficiente: true, objetivo: reescrito || objetivo, bifurcacao };
      }
      return { suficiente: false, objetivo, pergunta: texto.replace(/^["“]|["”]$/g, '').slice(0, 240) };
    } catch {
      return { suficiente: true, objetivo }; // bônus, não requisito: falhar aqui não pode travar a execução
    }
  }

  /**
   * Crítico de interpretação — segunda olhada, só chamada quando
   * `verificarAmbiguidade` detectou uma bifurcação real (ver
   * `pedidoDeCriticaDeInterpretacao`). Decide qual das duas leituras é mais
   * provável; quando não tem certeza (confiança não é "alta"), devolve
   * `notaAlternativa` pra quem chama poder avisar da outra leitura no fim
   * da resposta, em vez de escolher e seguir calado.
   */
  async decidirInterpretacao({ objetivo, bifurcacao }) {
    try {
      const r = await ollama.chat({
        host: this.config.host,
        model: this.modeloDe('decisao'),
        messages: [{ role: 'user', content: prompts.pedidoDeCriticaDeInterpretacao({ objetivo, bifurcacao }) }],
        temperature: 0,
        numCtx: this.numCtxDe('decisao'),
        numPredict: 120,
        manterVivo: this.config.manterModeloVivo,
        signal: this.controller.signal,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'interpretacao', duracaoMs: r.durationMs });
      const texto = String(r.content || '');
      const mEscolha = /escolha\s*:\s*([ab])\b/i.exec(texto);
      if (!mEscolha) return { escolhida: null, notaAlternativa: null };
      const letra = mEscolha[1].toLowerCase();
      const mConfianca = /confian[cç]a\s*:\s*(alta|baixa)/i.exec(texto);
      const confianca = (mConfianca?.[1] || 'baixa').toLowerCase();
      const escolhida = letra === 'b' ? bifurcacao.b : bifurcacao.a;
      const alternativa = letra === 'b' ? bifurcacao.a : bifurcacao.b;
      return { escolhida, notaAlternativa: confianca === 'alta' ? null : alternativa };
    } catch {
      return { escolhida: null, notaAlternativa: null }; // bônus: falhar aqui não pode travar a execução
    }
  }

  contabilizar(uso, meta = {}) {
    // chamada sem uso é comum: leitura curta não passa pela destilação
    const { promptTokens = 0, completionTokens = 0 } = uso || {};
    if (!promptTokens && !completionTokens) return;
    this.uso.prompt += promptTokens;
    this.uso.completion += completionTokens;
    this.emit('uso', { ...this.uso });

    // Pedido de Davi 2026-09-23 (nova janela "Visualizar Execuções": gráfico
    // de "qual parte do raciocínio levou mais tempo e custou mais tokens").
    // Até aqui só existia o acumulado (`this.uso`/evento 'uso', sempre
    // crescente) — nenhum registro POR CHAMADA de quanto cada TIPO de
    // chamada (decisão, redação, crítica, planejamento, destilação...)
    // custou individualmente, e nenhuma duração além de uma exceção isolada
    // (a chamada de decisão do laço principal, que emitia `ultimaDuracaoMs`
    // à parte — descartado por `registro.js` mesmo assim). `meta.tipo` é
    // opcional pra não quebrar as chamadas antigas de `contabilizar(uso)`
    // sem segundo argumento (uso ainda contabiliza no acumulado normalmente,
    // só não gera uma linha no detalhamento por fase — best-effort, não é
    // erro deixar de passar `tipo`).
    if (meta.tipo) {
      this.emit('uso-chamada', {
        tipo: meta.tipo,
        promptTokens,
        completionTokens,
        duracaoMs: meta.duracaoMs ?? null,
      });
    }
  }

  /** Uma chamada de destilar(), contabilizada e emitida — o miolo repetido
   * pelos dois ramos de destilarLeitura(). */
  async _destilarUm({ objetivo, foco = '', origem, texto }) {
    const destilado = await destilar({
      config: this.config,
      objetivo,
      foco,
      origem,
      texto: String(texto).slice(0, 20000),
      modelo: this.modeloDe('decisao'),
      signal: this.controller.signal,
      aviso: (aviso) => this.emit('aviso', { texto: aviso }),
    });
    this.contabilizar(destilado.uso, { tipo: 'destilacao', duracaoMs: destilado.uso?.duracaoMs });
    if (destilado.destilado) {
      this.emit('destilado', {
        n: this.iteracao, origem, fatos: destilado.fatos,
        de: destilado.bruto.length, para: destilado.texto.length,
      });
      this.emit('chamada', { tipo: 'destilacao' });
    }
    return destilado;
  }

  /**
   * Como _destilarUm, mas para textos que passam do teto de UMA destilação só
   * (MAXIMO_ENVIADO, destilador.js — hoje 14000 caracteres). Bug real
   * encontrado 2026-09-21 (Davi trouxe a preocupação de mandar "vários PDFs
   * gigantes" pro AuGPT analisar): antes deste método, _destilarUm cortava o
   * texto em 20000 caracteres e destilar() cortava DE NOVO por dentro em
   * MAXIMO_ENVIADO — um documento de 100 páginas via ler_documento só tinha
   * as primeiras ~10-15 realmente analisadas, o resto descartado em
   * silêncio, sem nenhum aviso. Páginas web já escapavam disso (cada fonte
   * em ctx.estado.fontesLidas já destila separada — ver destilarLeitura
   * abaixo), mas um documento único, grande, sempre caiu no corte cego.
   *
   * Aqui o texto é dividido em pedaços de até MAXIMO_ENVIADO (emPedacos,
   * cortando em quebra de parágrafo quando dá), cada pedaço destilado
   * separadamente — várias entradas no dossiê em vez de uma só truncada.
   * `TETO_DE_CHUNKS` (mesmo eixo de profundidadePesquisa que já limita
   * TETO_DE_BUSCAS) evita que um documento absurdamente grande vire dezenas
   * de chamadas ao modelo; quando o teto é atingido e ainda sobra texto,
   * emite 'aviso' — antes o corte era mudo, agora pelo menos avisa.
   */
  async _destilarGrande({ objetivo, foco = '', opcao = '', origem, texto, url }) {
    const bruto = String(texto || '');
    // `opcao` (motor de pesquisa, 5º teste real, 2026-09-24): leitura feita
    // pra investigar UMA opção ("KZ ZSN PRO 2 ... review"). Pedaço de página
    // que nem cita a opção não tem o que dizer dela — era destilado mesmo
    // assim e voltava "[NADA]" (20 vezes numa execução, boa parte dos 145 s
    // de destilação). Agora nem vai pro modelo: entra como "nada relevante",
    // com o bruto guardado (a matriz e a verificação continuam vendo).
    const naoCitaOpcao = (t) => opcao && !motorPesquisa.mencionaNome(
      String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' '),
      opcao
    );
    const pular = (o, t) => ({ origem: o, url, texto: `(nada relevante ao pedido em ${o})`, bruto: t, fatos: 0, destilado: true, pulado: true });
    // Tópico da comunidade na pesquisa planejada não passa pelo destilador
    // (11º teste real: o tópico do Clube do Hardware sobre intra pra PUBG
    // voltou "nada relevante" — e custou a chamada). O leitor de tópico já
    // entrega pergunta + respostas limpas; vai cru, com teto de tamanho.
    if (foco && url && tipoDeFonte(url, this.config) === 'comunidade' && /^T[ÓO]PICO (DO REDDIT|DE F[ÓO]RUM)/.test(bruto)) {
      return [{ origem, url, texto: bruto.slice(0, 6000), bruto, fatos: 0, destilado: false, cru: true }];
    }
    // pedaço do tamanho que CABE na janela para este material (página de
    // preço/tabela é densa em tokens — ver maximoQueCabe em destilador.js)
    const limite = maximoQueCabe({ numCtx: this.config.numCtx, objetivo, foco, origem, texto: bruto });
    if (bruto.length <= limite) {
      if (naoCitaOpcao(bruto)) return [pular(origem, bruto)];
      const destilado = await this._destilarUm({ objetivo, foco, origem, texto: bruto });
      return [{ origem, url, ...destilado }];
    }

    // Pesquisa planejada (sempre passa `foco`): no máximo 2 pedaços por
    // página. 10º teste real: uma vitrine do AliExpress (21 pedaços) e uma
    // página do huggingface.co (18) gastaram 12 destilações CADA no nível
    // extremo — a página de produto/tópico útil cabe em 1-2 pedaços.
    const tetoDoNivel = TETO_DE_CHUNKS[this.config.profundidadePesquisa] || TETO_DE_CHUNKS.normal;
    const teto = foco ? Math.min(tetoDoNivel, TETO_DE_CHUNKS_PESQUISA_PLANEJADA) : tetoDoNivel;
    const pedacos = emPedacos(bruto, limite);
    const usados = pedacos.slice(0, teto);

    const entradas = [];
    for (const [i, pedaco] of usados.entries()) {
      const origemParte = pedacos.length > 1 ? `${origem} (parte ${i + 1}/${pedacos.length})` : origem;
      if (naoCitaOpcao(pedaco)) {
        entradas.push(pular(origemParte, pedaco));
        continue;
      }
      const destilado = await this._destilarUm({ objetivo, foco, origem: origemParte, texto: pedaco });
      entradas.push({ origem: origemParte, url, ...destilado });
    }

    if (pedacos.length > usados.length) {
      this.emit('aviso', {
        texto: `${origem}: material grande demais (${pedacos.length} pedaços de até ${limite} caracteres) — só os primeiros ${usados.length} foram analisados, o restante foi descartado.`,
      });
    }

    return entradas;
  }

  /**
   * Onde cada modelo estava no fim da execução (GPU, CPU ou dividido) — vai
   * pro registro e aparece no relatório (pedido do Davi, 2026-10-10: ver se
   * o principal e o nomic estão na GPU e o Tev1/copiloto na CPU). Uma
   * chamada ao /api/ps, com tempo curto; falha não atrapalha nada.
   */
  async fotografarModelos() {
    try {
      const carregados = await ollama.psModels(this.config.host);
      this.emit('modelos-na-execucao', { linhas: montarQuadroDeModelos({ config: this.config, carregados }) });
    } catch {
      /* Ollama ocupado ou versão sem /api/ps: o relatório só não mostra o quadro */
    }
  }

  /**
   * Roda a ferramenta; leitura que falhou por motivo passageiro tenta de novo
   * uma vez (tools/erros.js). O erro que sobra sai anotado — definitivo diz
   * ao modelo que repetir não adianta.
   */
  async rodarFerramenta(nome, ferramenta, argumentos, ctx) {
    if (!REPETIVEIS.has(nome)) {
      try {
        return await ferramenta.run(argumentos, ctx);
      } catch (err) {
        if (ANOTAR_ERRO.has(nome) && this.rodando) err.message = anotarErro(err.message, classificarErro(err));
        throw err;
      }
    }
    try {
      return await comNovaTentativa(() => ferramenta.run(argumentos, ctx), {
        signal: this.controller?.signal,
        esperaMs: this.esperaNovaTentativaMs ?? 1500,
        aoTentarDeNovo: (d) => this.emit('nova-tentativa', { nome, ...d }),
      });
    } catch (err) {
      if (this.rodando) err.message = anotarErro(err.message, err.classificacao || classificarErro(err), { tentouDeNovo: err.tentouDeNovo });
      throw err;
    }
  }

  /**
   * Depois de uma ferramenta de leitura: decide COMO destilar o resultado.
   *
   * `pesquisar_e_ler` e `abrir_pagina` registram cada página em
   * `ctx.estado.fontesLidas` com o texto COMPLETO (`textoCompleto`), sem o
   * corte por página que existe só pra caber no prompt de decisão. Quando
   * esta chamada acrescentou fontes novas (comparando com `fontesAntes`,
   * medido ANTES de `ferramenta.run()`), cada uma é destilada
   * individualmente a partir desse texto completo — não do resultado
   * combinado e já cortado que a ferramenta devolveu. Antes, destilar o
   * resultado combinado UMA vez significava que qualquer coisa fora do
   * recorte de cada página nunca chegava nem perto da destilação; agora
   * quem decide o que é relevante é o próprio modelo, olhando a página
   * inteira (até o teto de 20 mil caracteres por fonte), não uma heurística
   * de posição de palavra-chave.
   *
   * Ferramentas de leitura sem fontesLidas (ler_arquivo, navegar,
   * buscar_no_projeto...) continuam pelo caminho de sempre: destilar a
   * saída da ferramenta como um bloco só.
   */
  async destilarLeitura({ nome, argumentos, saida, ctx, objetivo, fontesAntes, foco = '', opcao = '', deveCitar = false }) {
    ctx.estado.pesquisou = true;
    const novas = (ctx.estado.fontesLidas || []).slice(fontesAntes);
    // `consulta` marca de qual busca cada entrada do dossiê veio (correções
    // rápidas do motor de pesquisa, 2026-09-24) — é o que deixa
    // `selecionarParaRedacao` garantir ao redator pelo menos uma fonte de
    // cada busca, em vez de só as 8 últimas.
    const consulta = String(argumentos?.consulta || '').trim() || null;

    if (novas.length) {
      const umaFonte = async (fonte) => {
        const origem = `${nome}(${fonte.dominio || fonte.titulo || fonte.url || ''})`;
        // título da página vai junto (10º teste real): a checagem de
        // categoria dos candidatos usa ("Os 10 melhores fones..." × "iPhone 15")
        const titulo = String(fonte.titulo || '').slice(0, 200);
        // Etapa D: leitura fora do escopo do pedido (PUBG Mobile num pedido de
        // PC; página que não cita o produto pedido) não entra no dossiê — e
        // nem gasta destilação
        const fora = foraDoEscopo({ titulo, url: fonte.url, bruto: fonte.textoCompleto || fonte.texto || '' }, ctx.escopo);
        if (fora) {
          this.emit('descarte', { etapa: 'escopo', alvo: fonte.url || titulo, motivo: fora });
          return [];
        }
        // Página lida para investigar UMA opção ("Kiwi Ears Orchestra Lite
        // especificações") que nem cita a opção: o motor já a descartava, mas
        // só DEPOIS da destilação. Execução real de 11/10: páginas sobre a
        // fruta kiwi e a operadora TIM destiladas à toa (48 de 66 destilações
        // sem nenhum fato). A checagem é a mesma do motor, feita antes.
        if (opcao && deveCitar && !motorPesquisa.mencionaNome(motorPesquisa.normalizarTexto(`${titulo}\n${fonte.textoCompleto || fonte.texto || ''}`), opcao)) {
          this.emit('descarte', { etapa: 'antes-da-destilacao', alvo: fonte.url || titulo, motivo: `não cita ${opcao}` });
          return [];
        }
        const pedidoDeDestilacao = { objetivo, foco, opcao, origem, texto: fonte.textoCompleto || fonte.texto || '', url: fonte.url };
        // retomada: só leitura da web pública (página logada do navegador do
        // app e arquivo do usuário não vão pro disco por este caminho)
        const retomavel = ctx.retomada && (nome === 'pesquisar_e_ler' || nome === 'abrir_pagina');
        const chaveRetomada = retomavel ? Retomada.chaveDestilacao(pedidoDeDestilacao) : null;
        let destiladas = chaveRetomada ? ctx.retomada.destilacao(chaveRetomada) : null;
        if (destiladas) this.emit('destilacao-retomada', { url: fonte.url || null });
        else {
          destiladas = await this._destilarGrande(pedidoDeDestilacao);
          if (chaveRetomada) ctx.retomada.guardarDestilacao(chaveRetomada, destiladas);
        }
        return destiladas.map((e) => (titulo ? { ...e, titulo } : e));
      };
      // Até `destilacaoParalela` páginas ao mesmo tempo (11/10). Com o Ollama
      // em 2 vagas (OLLAMA_NUM_PARALLEL=2) a placa destila 1,39x mais rápido
      // — medido: 3,0 s → 2,2 s por página, +0,6 GB de memória de vídeo; com 1
      // vaga os pedidos só fazem fila, como antes. A ordem das páginas é mantida.
      const vagas = Math.max(1, Math.min(Number(this.config.destilacaoParalela) || 1, novas.length));
      const porFonte = new Array(novas.length);
      let proxima = 0;
      await Promise.all(
        Array.from({ length: vagas }, async () => {
          while (proxima < novas.length) {
            const i = proxima;
            proxima += 1;
            porFonte[i] = await umaFonte(novas[i]);
          }
        })
      );
      return porFonte.flat().map((e) => ({ ...e, consulta }));
    }

    const origem = `${nome}(${String(
      argumentos.consulta || argumentos.url || argumentos.caminho || ''
    ).slice(0, 90)})`;
    return (await this._destilarGrande({ objetivo, foco, opcao, origem, texto: saida })).map((e) => ({ ...e, consulta }));
  }

  /**
   * Itens do plano com ferramenta própria (gráfico, planilha, PDF...) que
   * chegaram ao fim sem a ferramenta ter rodado com sucesso. Gráfico feito
   * por outro caminho (buscar_produtos, série de preços) também conta.
   */
  itensNaoCumpridos(ctx) {
    return (ctx.estado.itensDeFerramenta || []).filter((texto) => ferramentaDoItem(texto) && !itemDeFerramentaCumprido(texto, ctx));
  }

  /**
   * Revisão v5: pedido de histórico/estimativa de preço sem nenhuma página de
   * histórico lida ainda (no teste da RTX 5080 o agente leu a CATEGORIA do
   * Hardware Barato, não a página da placa). A dica vale só enquanto há
   * busca sobrando — depois o redator trabalha com o que tem.
   */
  faltaPaginaDeHistorico(objetivo, ctx) {
    if (!serieDePrecos.ehPedidoDeHistoricoOuEstimativa(objetivo)) return false;
    if (!serieDePrecos.produtosDoPedido(objetivo).length) return false;
    if ((ctx.estado.buscasFeitasDica || 0) >= 2) return false;
    const fontes = ctx.estado.fontesLidas || [];
    if (ctx.estado.historicoConferido === fontes.length) return ctx.estado.historicoFalta;
    ctx.estado.historicoConferido = fontes.length;
    ctx.estado.historicoFalta = !serieDePrecos.temPaginaDeHistorico(objetivo, fontes, new Date().toISOString().slice(0, 10));
    return ctx.estado.historicoFalta;
  }

  /**
   * O Ollama 0.40.1 recusou um prompt por passar da janela e o cliente
   * reenviou com o meio do maior texto cortado (ver ollama.js,
   * comReducaoDeContexto). Vira aviso + incidente de contexto no registro.
   */
  avisarContextoReduzido(etapa, r) {
    this.emit('aviso', {
      texto: `${etapa}: o Ollama recusou o prompt (${r.tokensPedido} tokens numa janela de ${r.tokensDisponiveis || '?'}); reenviado sem ${r.caracteresCortados} caracteres do meio do maior texto.`,
    });
    this.emit('contexto-saturado', { n: this.iteracao, promptTokens: r.tokensPedido, numCtx: r.tokensDisponiveis, reenviado: true, etapa });
  }

  /**
   * Série de preços (Evidência → Dados → Análise, 2026-09-27): pedido de
   * histórico/média de preço → o código extrai preço+data+produto das
   * páginas lidas, calcula e monta o gráfico (ver serie-de-precos.js).
   * Idempotente: só recalcula quando entrou página nova. O gráfico vai pra
   * `ctx.estado.graficos` (cumpre o item "criar gráfico" do plano) e o
   * bloco de dados vira material do dossiê — o redator usa os números
   * calculados e o verificador os reconhece como respaldados.
   */
  montarSerieDePrecos(objetivo, ctx) {
    const fontes = ctx.estado.fontesLidas || [];
    if (!fontes.length || !serieDePrecos.ehPedidoDeHistoricoOuEstimativa(objetivo)) return null;
    if (ctx.estado.serieDePrecos && ctx.estado.serieDePrecos.fontes === fontes.length) return ctx.estado.serieDePrecos.resultado;
    const hoje = new Date().toISOString().slice(0, 10);
    const resultado = serieDePrecos.montarSerie({ objetivo, fontes, hoje });
    const anterior = ctx.estado.serieDePrecos?.resultado?.grafico;
    if (anterior) ctx.estado.graficos = (ctx.estado.graficos || []).filter((g) => g !== anterior);
    if (resultado?.grafico) ctx.estado.graficos = [...(ctx.estado.graficos || []), resultado.grafico];
    ctx.estado.serieDePrecos = { fontes: fontes.length, resultado };
    if (resultado) {
      this.emit('serie-de-precos', {
        produtos: resultado.produtos.map((p) => p.nome),
        observacoes: resultado.observacoes,
        moeda: resultado.analise?.moeda || null,
        meses: resultado.analise?.meses || [],
        medias: (resultado.analise?.resumo || []).map((r) => ({ produto: r.produto, n: r.n, media: r.media ?? null })),
        grafico: Boolean(resultado.grafico),
        // revisão v5: estatísticas dos sites de histórico, descartes e estimativa
        estatisticas: (resultado.estatisticas || []).length,
        descartados: resultado.descartados || 0,
        estimativa: (resultado.estimativa?.resultados || []).map((r) => ({ produto: r.produto, faixa: r.faixa || null, motivo: r.motivo || null })),
      });
    }
    return resultado;
  }

  /**
   * Funde os turnos da CONVERSA (não confundir com a compactação DENTRO de
   * uma execução, mais abaixo em `run()` — evento `'compactado'`) que já
   * saíram da janela dos últimos 6 (ver `prompts.sistema()`) num resumo
   * único, reaproveitando o que já existir — nunca concatena por fora do
   * modelo, sempre pede fusão (mesmo padrão do Item 1,
   * `pedidoDeResumo`/`prompts.pedidoDeResumoDeConversa`).
   *
   * Extraído de dentro de `run()` (item 2 da análise comparativa dos 5
   * projetos de referência, 2026-09-21 — "comando manual de compactação",
   * inspirado no `/compact` do deer-flow) pra poder ser chamado tanto
   * automaticamente no início de toda execução (abaixo) quanto SOB DEMANDA,
   * fora de qualquer execução — ver `electron/main.js`, IPC `chats:compact`,
   * acionado pelo item "Compactar" no menu da conversa.
   *
   * Idempotente e barato quando não há nada novo: se a conversa não cresceu
   * além do que já foi fundido (`resumoConversaTurnos` já cobre tudo além da
   * janela de 6), devolve os mesmos valores recebidos sem gastar nenhuma
   * chamada de modelo. `this.controller` pode não existir quando chamado
   * fora de `run()` (não há execução em andamento pra abortar) — `?.signal`
   * cobre os dois casos.
   */
  async fundirResumoConversa(conversa = [], idConversa = null, { resumoConversa = '', resumoConversaTurnos = 0 } = {}) {
    let resumoConversaAtual = resumoConversa;
    let resumoConversaTurnosAtual = resumoConversaTurnos;
    const tetoJanelaConversa = conversa.length - 6;
    if (idConversa && tetoJanelaConversa > resumoConversaTurnosAtual) {
      const turnosNovos = conversa.slice(resumoConversaTurnosAtual, tetoJanelaConversa);
      const textoTurnosNovos = turnosNovos
        .map((t) => `${t.role === 'user' ? 'Usuário' : 'Você'}: ${t.content}`)
        .join('\n')
        .slice(0, 20000);
      if (textoTurnosNovos.trim()) {
        try {
          const r = await ollama.chat({
            host: this.config.host,
            model: this.modeloDe('decisao'),
            messages: [
              {
                role: 'user',
                content: prompts.pedidoDeResumoDeConversa(textoTurnosNovos, resumoConversaAtual || undefined),
              },
            ],
            temperature: 0.2,
            numCtx: this.numCtxDe('decisao'),
            signal: this.controller?.signal,
          });
          resumoConversaAtual = r.content.trim().slice(0, 4000);
          resumoConversaTurnosAtual = tetoJanelaConversa;
          this.emit('resumo-conversa', { idConversa, resumo: resumoConversaAtual, turnos: resumoConversaTurnosAtual });
        } catch {
          /* mantém o resumo anterior (ou vazio); a janela dos últimos 6 turnos segue cobrindo o essencial */
        }
      }
    }
    return { resumoConversa: resumoConversaAtual, resumoConversaTurnos: resumoConversaTurnosAtual };
  }

  /**
   * Item 3 da análise comparativa (2026-09-21, "allowed-tools por skill",
   * inspirado no campo `allowed-tools` do formato de skill do deer-flow/
   * Claude): lista efetiva de ferramentas desativadas pra ESTA seleção de
   * skills de decisão — a lista manual do usuário (`config.ferramentasDesativadas`)
   * mais o que as skills ativas NÃO permitem, quando (e só quando) TODAS as
   * skills ativas que não são `sempre: true` declaram uma
   * `ferramentasPermitidas` não vazia.
   *
   * "Todas, unânime": se qualquer skill ativa não declarou restrição
   * nenhuma (a esmagadora maioria das skills existentes — o campo é opt-in),
   * a combinação fica sem restrição — aberta, igual hoje. Sem isto, uma
   * skill de tarefa específica combinada com uma skill geral sem restrição
   * acabaria restringindo a geral também, sem ela nunca ter pedido isso.
   * `sempre: true` (hoje só "Pesquisa na web") fica de fora da exigência de
   * unanimidade — ela entra em quase toda seleção só por estar sempre ativa
   * (ver `Skills.pontuar`), e é uma skill de propósito geral, não a skill
   * que define a tarefa; exigir que ELA também declarasse restrição
   * inviabilizaria o recurso inteiro na prática.
   *
   * `ESSENCIAIS` (`responder`/`concluir`, ver `src/tools/index.js`) NUNCA
   * entra na lista de bloqueadas por isto, mesmo que nenhuma skill as
   * liste — sem elas o laço não fecha (mesma invariante que já protege
   * `tools.get()` da lista manual; replicada aqui porque `tools.ativas()`,
   * usada pro catálogo/schema da decisão, não tem essa proteção embutida).
   */
  ferramentasDesativadasParaSkills(skillsAtivas = []) {
    const base = this.config.ferramentasDesativadas || [];
    const paraExigirRestricao = skillsAtivas.filter((s) => !s.sempre);
    if (!paraExigirRestricao.length) return base;
    const listas = paraExigirRestricao.map((s) => (Array.isArray(s.ferramentasPermitidas) ? s.ferramentasPermitidas : []));
    if (listas.some((lista) => !lista.length)) return base; // pelo menos 1 skill ativa não optou por restringir
    const permitidas = new Set(listas.flat());
    const universo = tools.ativas(base).map((t) => t.name);
    const bloqueadasPelaSkill = universo.filter((nome) => !permitidas.has(nome) && !tools.ESSENCIAIS.has(nome));
    return bloqueadasPelaSkill.length ? [...new Set([...base, ...bloqueadasPelaSkill])] : base;
  }

  /**
   * `idConversa` (opcional, pedido do Davi 2026-09-19, Peça 3 — "memória
   * curta"): o id da conversa salva de onde este pedido veio (ver
   * `renderer/app.js`, `agente.idConversa`/`chat.idConversa`), plumbing por
   * `electron/main.js` (`agent:start`). Sem ele (agendamentos, testes
   * antigos, conversa ainda não salva), o material lido nesta execução
   * simplesmente não é escopável — some no fallback de sempre. Nunca é
   * obrigatório: tudo que já funcionava sem isto continua funcionando igual.
   */
  /**
   * Modo AUTO (auto.js, 10/10): o nível do pedido pode trocar `this.config`
   * por uma cópia com etapas desligadas DURANTE a execução — aqui a
   * configuração de Ajustes volta no fim, aconteça o que acontecer. Se
   * alguém (Ajustes salvos no meio) trocou a config enquanto rodava, a nova
   * fica.
   */
  async run(objetivo, conversa = [], idConversa = null, opcoes = {}) {
    if (this.rodando) throw new Error('Já existe uma execução em andamento.');
    const original = this.config;
    this._configAntesDoAuto = original;
    this._configDoAuto = null;
    ollama.definirPensarPadrao(original?.pensarNasEtapas === true);
    try {
      return await this._run(objetivo, conversa, idConversa, opcoes);
    } finally {
      if (this._configDoAuto && this.config === this._configDoAuto) this.config = original;
      this._configDoAuto = null;
      // fora da execução (comparar modelos, compactar conversa) volta o padrão antigo
      ollama.definirPensarPadrao(null);
    }
  }

  /** Aplica os ajustes de um nível do AUTO sobre a config de Ajustes. */
  aplicarNivelAuto(nivel, { temConversa = true } = {}) {
    const base = this._configAntesDoAuto || this.config;
    const ajustes = auto.ajustesDoNivel(nivel.nivel, base, { temConversa });
    this.nivelAuto = nivel;
    this.config = { ...base, ...ajustes };
    this._configDoAuto = this.config;
    this.emit('nivel-auto', { ...nivel, ajustes });
  }

  /**
   * Níveis 0 e 1 do AUTO: resposta direta (0) ou com ficha de conferência
   * (1), sem o laço do agente. Devolve a resposta final, ou null quando
   * falhou — aí quem chama segue pelo laço normal (nível 2).
   */
  async respostaRapidaAuto({ objetivo, conversa, nivel }) {
    const inicio = Date.now();
    let recebeuTexto = false;
    try {
      const r = await responderRapido({
        objetivo,
        conversa,
        config: this.config,
        nivel: nivel.nivel,
        signal: this.controller.signal,
        // os testes trocam a rede (busca, Wikipédia, leitura) por dublês
        deps: this.depsRespostaRapida || {},
        dirImagens: this.dirImagens(),
        emit: (evento, dados) => {
          if (evento === 'resposta-token') recebeuTexto = true;
          this.emit(evento, dados);
        },
      });
      this.contabilizar(r.uso, { tipo: 'redacao', duracaoMs: r.uso?.duracaoMs });
      for (const c of r.correcoes) this.emit('auto-correcao', c);
      if (r.correcoes.length) this.emit('aviso', { texto: `conferência: ${r.correcoes.map((c) => `${c.fato} ${c.de} → ${c.para}`).join('; ')}` });
      this.emit('resposta-rapida', {
        nivel: nivel.nivel, wikis: r.wikis, paginas: r.paginas, fatosConferiveis: r.fatos,
        correcoes: r.correcoes, ms: Date.now() - inicio,
      });
      // imagem de referência (src/tools/imagens.js) no topo, quando a pesquisa achou uma
      const corpo = r.imagem ? `${imagens.marcacao(auto.assuntoDoPedido(objetivo), r.imagem)}\n\n${r.texto}` : r.texto;
      const final = r.fontes.length ? `${corpo}\n\n---\n**Fontes**\n${r.fontes.map((f) => `- ${f}`).join('\n')}` : corpo;
      await this.fotografarModelos();
      this.emit('concluido', { resumo: final, resposta: true, iteracoes: 0, uso: this.uso, verificacao: null, confianca: null });
      this.rodando = false;
      return { ok: true, resumo: final };
    } catch (err) {
      if (this.controller.signal.aborted) {
        this.rodando = false;
        this.emit('interrompido', { iteracoes: 0, uso: this.uso });
        return { ok: false, motivo: 'interrompido' };
      }
      if (recebeuTexto) this.emit('resposta-reinicia', { motivo: 'a resposta rápida falhou — seguindo pela pesquisa' });
      this.emit('aviso', { texto: `Resposta rápida (nível ${nivel.nivel}) falhou: ${err.message}. Seguindo pela pesquisa padrão.` });
      return null;
    }
  }

  /**
   * Núcleo de pesquisa (15/10, src/agent/nucleo): entender → o modelo pesquisa
   * com ferramentas nativas → uma escrita com fontes numeradas. Devolve a
   * resposta final, ou null quando falhou (quem chama segue pelo caminho antigo).
   */
  async responderPeloNucleo({ objetivo, conversa, imagens: anexadas = [] }) {
    // prova com várias questões (18/10): ~700 tokens por questão resolvida; o
    // padrão de 3.072 cortava a resposta na 4ª de 10
    const questoes = new Set((String(objetivo).match(/\bquest(?:ão|ao)\s*(\d+)/gi) || []).map((q) => q.replace(/\D/g, ''))).size;
    const limiteDaEscrita = Math.max(Number(this.config.numPredictResposta) || 3072, Math.min(12000, questoes * 700));
    const inicio = Date.now();
    const cfg = this.config;
    // imagens anexadas: lidas da pasta de trabalho; com o Tesseract instalado, o texto delas vai junto (OCR)
    const ocr = this.userDataPath ? new Tesseract(path.join(this.userDataPath, 'componentes')) : null;
    const imagensDoPedido = [];
    for (const rel of anexadas) {
      try {
        const arquivo = new Sandbox(cfg.workspace).resolve(rel);
        if (fs.statSync(arquivo).size > 20 * 1024 * 1024) continue;
        const texto = ocr?.instalado() ? await ocr.lerTexto(arquivo).catch(() => '') : '';
        imagensDoPedido.push({ nome: path.basename(rel), arquivo, base64: imagemParaOModelo(arquivo), texto });
      } catch {
        /* imagem que não abre: segue sem ela */
      }
    }
    const modelo = cfg.model;
    const signal = this.controller.signal;
    const ctxWeb = {
      estado: {},
      config: cfg,
      emit: (e, d) => this.emit(e, d || {}),
      render: this.render,
      retomada: this.retomada,
      dirCachePaginas: this.userDataPath ? path.join(this.userDataPath, 'cache-paginas') : null,
    };
    const ingles = (q) => /\b(the|best|for|with|vs|review|reddit|how|what|which)\b/i.test(q) && !/[ãõçáéíóúâêà]/i.test(q);
    let escreveu = false;
    const deps = {
      signal,
      emit: (evento, dados) => this.emit(evento, dados),
      chamar: async (messages, { tools, json, numPredict } = {}) => {
        const r = await ollama.chat({ host: cfg.host, model: modelo, messages, tools, json, temperature: 0.3, numCtx: 16384, numPredict: numPredict || 800, manterVivo: cfg.manterModeloVivo, signal });
        this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: tools ? 'decisao' : 'entendimento', duracaoMs: r.durationMs });
        return r;
      },
      escrever: async (messages, onToken) => {
        const r = await ollama.chatStream({ host: cfg.host, model: modelo, messages, temperature: 0.4, numCtx: 16384, numPredict: limiteDaEscrita, manterVivo: cfg.manterModeloVivo, signal, onToken: (p) => { escreveu = true; onToken(p); } });
        this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'redacao', duracaoMs: r.durationMs });
        return r.content;
      },
      // pergunta que muda com o tempo (18/10): notícias e web do último mês (as notícias na frente,
      // marcadas como recentes); com menos de 3 resultados, a busca de sempre
      buscar: async (q, { recente = false } = {}) => {
        const opcoes = { searxngUrl: cfg.searxngUrl, marginaliaKey: cfg.marginaliaKey, jinaKey: cfg.jinaKey, idioma: ingles(q) ? 'all' : 'pt-BR' };
        if (recente) {
          const soSearxng = { ...opcoes, periodo: 'month', pular: search.CADEIA.map((p) => p.nome).filter((n) => n !== 'searxng') };
          const [noticias, web] = await Promise.all([
            search.buscar(q, { ...soSearxng, categoria: 'news' }).then((x) => x.resultados.map((r) => ({ ...r, recente: true }))).catch(() => []),
            search.buscar(q, opcoes).then((x) => x.resultados).catch(() => []),
          ]);
          const vistos = new Set();
          const juntos = [...noticias.slice(0, 6), ...web].filter((r) => !vistos.has(r.url) && vistos.add(r.url));
          if (juntos.length >= 3) return juntos;
        }
        return (await search.buscar(q, opcoes)).resultados;
      },
      // "meu computador" (18/10): o que o AuGPT já sabe do usuário — a máquina e a memória central
      sobreOUsuario: async () => {
        const partes = [];
        const pc = await (this._computador ||= require('../verificador-de-hardware').verificarComputador().catch(() => null));
        // a memória de vídeo escrita por extenso (18/10: "RTX 3060 Ti (8 GB)" virou "8 GB de RAM" na resposta)
        if (pc) partes.push(`Computador do usuário: ${pc.gpus?.length ? `placa de vídeo ${pc.gpus.map((g) => `${g.nome}${g.vramGB ? ` com ${g.vramGB} GB de memória de vídeo (VRAM)` : ''}`).join(' + ')}; ` : ''}processador ${pc.cpu} (${pc.nucleos} núcleos); memória RAM do sistema: ${pc.ramTotalGB} GB; ${pc.sistema}.`);
        if (cfg.memoriaCentral !== false && this.userDataPath) {
          const memoria = new MemoriaCentral(this.userDataPath).paraPrompt().trim();
          if (memoria) partes.push(memoria);
        }
        return partes.join('\n');
      },
      lerPagina: (url) => lerComCache(url, ctxWeb),
      embed: (textos) => ollama.embed({ host: cfg.host, model: cfg.embedModel || 'nomic-embed-text', input: textos, signal }),
      // Reddit e fóruns cadastrados (dados/fontes-da-comunidade.json): "site:reddit.com …", "site:clubedohardware.com.br …"
      buscarNaComunidade: async (q) => {
        const lista = consultasNaComunidade(q, { config: cfg, maximo: 3 });
        const achados = await Promise.all(lista.map((c) => search.buscar(c.consulta, { searxngUrl: cfg.searxngUrl, marginaliaKey: cfg.marginaliaKey, jinaKey: cfg.jinaKey, idioma: c.idioma }).then((x) => x.resultados).catch(() => [])));
        return achados.flat();
      },
    };
    // modelo sem visão (17/10, Llama 3.2 3B): nada de mandar imagem para ele
    const capacidades = await ollama.capacidades(cfg.host, modelo).catch(() => []);
    const enxerga = !capacidades.length || capacidades.includes('vision'); // sem a lista (Ollama antigo): tenta
    if (!enxerga) {
      deps.semVisao = `O modelo em uso (**${modelo}**) não enxerga imagens. Para perguntar sobre fotos, escolha um **Qwen 3.5** no seletor de modelo do topo — até o de 2B enxerga. Para ler o texto de prints e documentos, instale o **Tesseract** em Ajustes → Componentes.`;
    }
    // Fase 5: criar imagens com o FLUX.2 Klein (Ajustes → Componentes)
    const gerador = this.userDataPath ? new GeradorDeImagens(pastaPadrao(this.userDataPath)) : null;
    if (gerador?.instalado()) {
      // revisar e escolher a foto de referência pedem visão
      deps.revisoesDeImagem = cfg.revisarImagensCriadas === false || !enxerga ? 0 : 2;
      deps.gerarImagem = async ({ prompt, largura, altura, semente, referencias = [], legenda }) => {
        // o FLUX usa ~7 GB da placa: os modelos do Ollama saem antes (voltam sozinhos no próximo pedido)
        for (const m of await ollama.psModels(cfg.host).catch(() => [])) await ollama.unloadModel(cfg.host, m.name).catch(() => {});
        for (let i = 0; i < 20 && (await ollama.psModels(cfg.host).catch(() => [])).length; i += 1) await new Promise((ok) => setTimeout(ok, 250));
        // edição sem tamanho escolhido: o da imagem anexada, até 1024 no lado maior, múltiplo de 16
        if ((!largura || !altura) && referencias[0]) {
          try {
            const { width, height } = require('electron').nativeImage.createFromPath(referencias[0]).getSize();
            const escala = Math.min(1, 1024 / Math.max(width, height));
            [largura, altura] = [width, height].map((x) => Math.max(256, Math.round((x * escala) / 16) * 16));
          } catch {
            [largura, altura] = [1024, 1024];
          }
        }
        const nome = `${Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')}.png`;
        const saida = path.join(this.dirImagens(), nome);
        fs.mkdirSync(this.dirImagens(), { recursive: true });
        const r = await gerador.gerar({ prompt, saida, largura: largura || 1024, altura: altura || 1024, semente, referencias });
        // uma cópia na pasta de trabalho, para o usuário achar e usar
        let caminho = null;
        try {
          const pasta = path.join(cfg.workspace, 'imagens-criadas');
          fs.mkdirSync(pasta, { recursive: true });
          const base = String(legenda || 'imagem').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'imagem';
          caminho = path.join('imagens-criadas', `${base}-${Date.now()}.png`);
          fs.copyFileSync(saida, path.join(cfg.workspace, caminho));
        } catch {
          caminho = null;
        }
        return { uri: `augpt-img://${nome}`, base64: fs.readFileSync(saida).toString('base64'), ms: r.ms, caminho };
      };
      // fotos reais de referência: versão grande da busca de imagens; miniatura (menos de 300 px) fica de fora
      if (cfg.searxngUrl && enxerga) {
        deps.buscarReferencias = async (q) => {
          const candidatas = (await imagens.buscarImagens(q, { config: cfg, maximo: 12, grande: true })).slice(0, 8);
          const uris = await Promise.all(candidatas.map((c) => imagens.guardarImagem(c.url, { dir: this.dirImagens(), config: cfg }).catch(() => null)));
          const prontas = [];
          for (const [i, uri] of uris.entries()) {
            if (!uri || prontas.length >= 4) continue;
            const arquivo = path.join(this.dirImagens(), uri.replace(/^augpt-img:\/\//, ''));
            try {
              const { width, height } = require('electron').nativeImage.createFromPath(arquivo).getSize();
              if (Math.min(width, height) < 300) continue;
            } catch {
              if (fs.statSync(arquivo).size < 20000) continue; // fora do Electron: pelo tamanho do arquivo
            }
            prontas.push({ ...candidatas[i], arquivo, base64: imagemParaOModelo(arquivo) });
          }
          return prontas;
        };
      }
    } else if (gerador) {
      deps.semGerador = 'Para criar imagens, o AuGPT usa o FLUX.2 Klein, que roda no seu computador. Ele ainda não está instalado: em **Ajustes → Componentes → Criar imagens** dá para ver se a sua placa de vídeo comporta e instalar com um clique (cerca de 6 GB).';
    }
    // Fase 4: o pesquisador olha imagens da web (a busca de imagens é a do SearXNG)
    if (cfg.searxngUrl && cfg.imagensNasRespostas !== false && enxerga) {
      deps.buscarImagensParaVer = async (q) => {
        const candidatas = (await imagens.buscarImagens(q, { config: cfg, maximo: 8 })).slice(0, 6);
        const uris = await Promise.all(candidatas.map((c) => imagens.guardarImagem(c.url, { dir: this.dirImagens(), config: cfg }).catch(() => null)));
        return candidatas
          .map((c, i) => (uris[i] ? { ...c, base64: fs.readFileSync(path.join(this.dirImagens(), uris[i].replace(/^augpt-img:\/\//, ''))).toString('base64') } : null))
          .filter(Boolean)
          .slice(0, 3);
      };
    }
    // YouTube (Fase 3): só com o yt-dlp instalado em Ajustes → Componentes (ou na boas-vindas)
    const yt = this.userDataPath ? new YtDlp(path.join(this.userDataPath, 'componentes')) : null;
    if (yt?.instalado()) {
      deps.buscarNoYoutube = (q) => yt.buscarVideos(q, 5);
      deps.verVideo = (url) =>
        yt.verVideo(url).catch((err) => {
          throw Object.assign(err, { mudancaDoYouTube: pareceMudancaDoYouTube(err.stderr || err.message) });
        });
    }
    try {
      this.emit('inicio-rapido', { objetivo });
      // profundidade: seletor da tela inicial / painel ("Resposta direta" antigo = rápido)
      const modo = cfg.respostaDireta === true ? 'rapido' : cfg.modoDePesquisa || 'automatico';
      // imagens de referência dos ASSUNTOS que o modelo apontou no entendimento (pessoa, lugar,
      // produto, objeto…), buscadas em paralelo com a pesquisa — 15/10: antes era o texto da
      // pergunta, e "Esse fone é bom para jogar pubg?" buscava imagem de "Esse fone é bom…"
      let figuras = Promise.resolve([]);
      const emitirOriginal = deps.emit;
      deps.emit = (evento, dados) => {
        // 18/10: só os assuntos concretos que o entendimento escolheu (antes, sem assunto, a busca de
        // imagem ia pelo texto da pergunta e vinham fotos de "presidente" e "login no site"); até 3 no total
        if (evento === 'nucleo-entendimento' && dados?.precisaBuscar && dados.fotos?.length) {
          const lista = dados.fotos;
          const n = Math.max(1, Math.floor(3 / lista.length));
          figuras = imagens.comLimite(Promise.all(lista.map((a) => imagens.imagensDeReferencia(a, { config: cfg, dir: this.dirImagens(), n }).then((imgs) => (imgs.length ? { nome: a, imgs } : null)).catch(() => null))), 25000, []);
        }
        emitirOriginal(evento, dados);
      };
      // investigação com tempo (17/10): o usuário dá os minutos; o código pesquisa por partes até o tempo acabar
      const investigando = modo === 'investigacao' && !imagensDoPedido.length;
      const r = investigando
        ? await investigar({ pergunta: objetivo, conversa, minutos: Number(cfg.minutosDeInvestigacao) || 10, tamanho: cfg.modoResposta || 'normal', deps })
        : await nucleo.responder({ pergunta: objetivo, conversa, modo, tamanho: cfg.modoResposta || 'normal', deps, imagens: imagensDoPedido });
      // o relatório completo vira PDF na pasta de trabalho, anexado à resposta
      let relatorioPdf = null;
      if (r.relatorio) {
        try {
          const data = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
          const base = String(r.relatorio.titulo || 'investigacao').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'investigacao';
          relatorioPdf = path.join('investigacoes', `${base}-${data}.pdf`);
          // o gerador de PDF já põe o título no topo: o "# título" do relatório sai
          const buffer = gerarPdf({ conteudo: r.relatorio.markdown.replace(/^# .*\n+/, ''), titulo: r.relatorio.titulo });
          const alvo = new Sandbox(cfg.workspace).resolve(relatorioPdf);
          fs.mkdirSync(path.dirname(alvo), { recursive: true });
          fs.writeFileSync(alvo, buffer);
          this.emit('arquivo-criado', { nome: path.basename(alvo), relativo: relatorioPdf, bytes: buffer.length });
        } catch (err) {
          relatorioPdf = null;
          this.emit('aviso', { texto: `Não consegui gravar o relatório em PDF: ${err.message}` });
        }
      }
      if (!r.texto) throw new Error('a escrita veio vazia');
      // produto: uma foto em cada cartão "#### N. Nome"; o resto: a imagem de cada assunto no topo
      const limparNome = (t) => String(t).replace(/[*_[\]]/g, '').trim();
      const nomes = r.produto ? [...r.texto.matchAll(/^#### \d+\. (.+)$/gm)].map((m) => limparNome(m[1])) : [];
      // fotos e "onde comprar" (17/10) ao mesmo tempo: o preço de hoje vem da página de cada loja
      const lojasDosProdutos = nomes.length && cfg.ondeComprar !== false
        ? imagens.comLimite(Promise.all(nomes.slice(0, 6).map((n) => ondeComprar(n, { ler: (url) => lerComCache(url, ctxWeb) }).catch(() => []))), 35000, [])
        : Promise.resolve([]);
      const fotos = nomes.length ? await imagens.comLimite(imagens.imagensDosProdutos(nomes, { config: cfg, dir: this.dirImagens() }), 20000, new Map()) : new Map();
      const precosNasLojas = new Map((await lojasDosProdutos).map((achados, i) => [nomes[i], achados]));
      // pergunta de preço de UM produto, sem cartões (18/10: "melhor preço para a rtx 5080" saiu com
      // preços inventados e sem link): o preço de hoje nas lojas vai no topo, pelo assunto entendido
      const pedePreco = /\b(pre[çc]os?|quanto custa|onde comprar|link de compra|mais barat\w*|comprar)\b/i.test(objetivo);
      const linhaDoAssunto = !nomes.length && pedePreco && cfg.ondeComprar !== false && r.assuntos?.length
        ? linhaOndeComprar((await imagens.comLimite(Promise.all(r.assuntos.slice(0, 2).map((a) => ondeComprar(a, { ler: (url) => lerComCache(url, ctxWeb) }).catch(() => []))), 30000, [])).find((x) => x.length) || [])
        : '';
      const doTopo = r.buscou && !nomes.length ? (await figuras).filter(Boolean) : [];
      const comCartoes = nomes.length
        ? r.texto.replace(/^#### \d+\. (.+)$/gm, (linha, nome) => {
            const img = fotos.get(limparNome(nome));
            const lojas = linhaOndeComprar(precosNasLojas.get(limparNome(nome)) || []);
            return `${linha}${img ? `\n${imagens.marcacao(limparNome(nome), img)}\n` : ''}${lojas ? `\n${lojas}\n` : ''}`;
          })
        : r.texto;
      // gráfico protegido: o link das citações e o glossário não entram no JSON dele
      const corpo = protegerGraficos(linhaDoAssunto ? `${linhaDoAssunto}\n\n${comCartoes}` : comCartoes, (t) => explicarTermos(comLinks(t, r.fontes)));
      // as imagens de todos os assuntos numa linha só: o renderer monta o carrossel (md.js)
      const marcas = doTopo.flatMap((x) => x.imgs.map((img) => imagens.marcacao(x.nome, img)));
      const comFoto = marcas.length ? `${marcas.join(' ')}\n\n${corpo}` : corpo;
      // vídeos que a pesquisa assistiu: miniatura que vira o player no clique (md.js, "{yt:ID}")
      const assistidos = r.fontes.filter((f) => f.video && f.lido).slice(0, 3);
      const miniaturas = await imagens.comLimite(
        Promise.all(assistidos.map((f) => imagens.guardarImagem(`https://i.ytimg.com/vi/${idDoVideo(f.url)}/hqdefault.jpg`, { dir: this.dirImagens(), config: cfg }).catch(() => null))),
        15000,
        []
      );
      const videos = assistidos.length
        ? `\n\n**Vídeos**\n${assistidos
            .map((f, i) => (miniaturas[i] ? `${imagens.marcacao(`▶ ${f.titulo}`, miniaturas[i])}{yt:${idDoVideo(f.url)}}` : `- [▶ ${String(f.titulo).replace(/[[\]]/g, '')}](${f.url})`))
            .join('\n')}`
        : '';
      const comVideos = `${comFoto}${videos}`;
      const comRelatorio = r.relatorio
        ? `${comVideos}\n\n${relatorioPdf ? `**Relatório completo em PDF:** \`${relatorioPdf}\` — ${r.secoes.length} partes, ${r.fontes.length} fontes, ${Math.max(1, Math.round(r.gastoS / 60))} min de pesquisa${r.interrompida ? ' (interrompida antes do fim)' : ''}.` : ''}`
        : comVideos;
      const final = r.fontes.length ? `${comRelatorio}\n\n---\n**Fontes**\n${r.fontes.map((f) => `${f.n}. [${String(f.titulo || f.url).replace(/[[\]]/g, '')}](${f.url})`).join('\n')}` : comRelatorio;
      this.emit('nucleo-fim', { modo, ms: Date.now() - inicio, fontes: r.fontes.length, entendimento: r.entendimento });
      await this.fotografarModelos();
      this.emit('concluido', { resumo: final, resposta: true, iteracoes: 0, uso: this.uso, verificacao: null, confianca: null });
      this.rodando = false;
      return { ok: true, resumo: final };
    } catch (err) {
      if (signal.aborted) {
        this.rodando = false;
        this.emit('interrompido', { iteracoes: 0, uso: this.uso });
        return { ok: false, motivo: 'interrompido' };
      }
      if (escreveu) this.emit('resposta-reinicia', { motivo: 'o núcleo de pesquisa falhou — seguindo pelo caminho antigo' });
      this.emit('aviso', { texto: `Núcleo de pesquisa falhou: ${err.message}. Seguindo pelo caminho antigo.` });
      return null;
    }
  }

  async _run(objetivo, conversa = [], idConversa = null, {
    resumoConversa = '', resumoConversaTurnos = 0, tarefaAnterior = null,
  } = {}) {
    if (this.rodando) throw new Error('Já existe uma execução em andamento.');
    if (!this.config.model) throw new Error('Escolha um modelo do Ollama antes de iniciar.');
    if (!this.config.workspace) throw new Error('Escolha uma pasta de trabalho antes de iniciar.');
    // marcada ANTES de conferir os modelos (/api/show leva até 3 s por
    // modelo): sem isso um segundo início passava pela trava e o parar() se
    // perdia sem controller (revisão independente v5)
    this.rodando = true;
    this.controller = new AbortController();
    let avisosDeModelo;
    try {
      avisosDeModelo = await this.conferirModelos();
    } catch (err) {
      this.rodando = false;
      throw err;
    }
    if (this.controller.signal.aborted) {
      this.rodando = false;
      this.emit('interrompido', { iteracoes: 0, uso: { prompt: 0, completion: 0 } });
      return { ok: false, motivo: 'interrompido' };
    }
    for (const texto of avisosDeModelo) this.emit('aviso', { texto });
    this.aprendizado = [];
    this.iteracao = 0;
    this.uso = { prompt: 0, completion: 0 };
    // login/senha escritos pelo usuário (no pedido ou em mensagens anteriores
    // desta conversa) — ver emit() e segredos.js
    this.segredos = segredosDoTexto(
      [objetivo, ...(Array.isArray(conversa) ? conversa : []).filter((m) => m?.role === 'user').map((m) => String(m.content || ''))].join('\n')
    );
    this.notaDeInterpretacao = null;
    this.intervencoesCopiloto = 0; // backlog do Copiloto, item m1 — ver vetoDoCopiloto()
    this.consultasCriticoFeitas = 0; // teto da consulta sob demanda — ver consultarCritico()
    this.criticasAutomaticasFeitas = 0; // teto dos 5 checkpoints fixos — ver criticaAutomatica()
    this.replanejamentosFeitos = 0;
    this.replanejamentoPendente = null;
    this.replanejamentoChaves = new Set();
    this.replanejamentoCooldownAte = 0;
    // Motor de pesquisa (ver pesquisarComPlano): buscas do motor contam como
    // passos (aparecem numeradas na tela), mas não comem o orçamento de
    // DECISÕES do modelo — `passosExtras` soma no limite de passos.
    this.passosExtras = 0;
    this.planoDeResposta = null;
    this.listaDaPesquisa = '';
    this.entradasDaMatriz = [];
    this.opcoesDaPesquisa = [];
    this.fontesDaPesquisa = [];
    this.composicaoDaPesquisa = null;
    this.produtoPesquisado = null;
    this.respostaComposta = false;

    // Item 6 da análise comparativa (2026-09-21/22, "ativação manual de
    // skill por /nome", inspirado no /nome-da-skill do deer-flow): "/skill
    // resto do pedido", só quando a barra é o PRIMEIRO caractere da
    // mensagem (nunca no meio — não é um comando de chat geral, é uma
    // abreviação de digitação pra quando o usuário já sabe qual skill quer
    // e não confia na seleção automática por gatilho/embedding). Roda antes
    // de QUALQUER OUTRA COISA usar `objetivo` — mesmo motivo do comentário
    // logo abaixo sobre a reescrita de ambiguidade: se o "/nome" continuasse
    // no texto, contaminaria o prompt de ambiguidade, a classificação de
    // complexidade, a busca de rotina etc. `this.skillForcada` (não uma
    // variável local) porque `redigir()` e `reselecionarSkillsPorSubtarefa()`
    // — chamadas em pontos bem distantes desta função — também precisam
    // saber, pra a skill continuar valendo na redação e nas subtarefas
    // seguintes desta MESMA execução, não só na 1ª seleção.
    this.skillForcada = null;
    const pedidoComBarra = /^\/(\S+)\s*([\s\S]*)$/.exec(String(objetivo || '').trim());
    if (pedidoComBarra && this.skills) {
      const skill = this.skills.porNome(pedidoComBarra[1], { desativadas: this.config.skillsDesativadas || [] });
      if (skill) {
        this.skillForcada = skill;
        // "/nome" sozinho, sem mais nada depois: cai pro nome+descrição da
        // própria skill, pra nunca sobrar um objetivo vazio ou (pior) o
        // "/nome" literal boiando como se fosse o pedido do usuário.
        objetivo = pedidoComBarra[2].trim() || `${skill.nome}: ${skill.descricao}`.trim();
        this.emit('skill-forcada', { nome: skill.nome, id: skill.id });
      }
      // "/algo" que não bate com skill nenhuma: não mexe em `objetivo` — pode
      // ser o próprio pedido do usuário começando com uma barra por acaso;
      // segue pro resto do pipeline intacto, só sem forçar nada.
    }

    // Modo AUTO (auto.js, 10/10): o nível sai só de regra de código, ANTES
    // da verificação de ambiguidade (5 s) e do Tev1 (4–7 s). Níveis 0 e 1
    // respondem aqui mesmo; 2 e 3 seguem com as etapas do nível.
    //
    // Roteador (Tev1) disparado JÁ (11/10): ele roda na CPU e não disputa a
    // placa de vídeo (medido: o modelo principal segue a ~92 tokens/s com o
    // decisor rodando), então a decisão dele fica pronta enquanto a
    // verificação de ambiguidade usa a GPU — antes eram 4,5 s (mediana) de
    // espera em fila, depois dela. Quem precisa do resultado espera a
    // promessa mais abaixo; o caminho rápido do AUTO simplesmente a abandona.
    const pedirRota = (texto) => {
      const promessa = decidirRota(texto, {
        config: this.config,
        decidir: (args) => ollama.decidir({ host: this.config.host, ...args }),
        signal: this.controller?.signal,
      });
      promessa.catch(() => {}); // abandonada ou interrompida: sem "unhandled rejection"
      return { objetivo: texto, promessa };
    };
    // "realize login nesse site": o endereço está na mensagem anterior (18/10)
    objetivo = comEnderecoDaConversa(objetivo, conversa);
    let rotaAndando = pedirRota(objetivo);

    this.nivelAuto = null;
    // 15/10: pergunta (não tarefa com arquivo, pasta, site ou arquivo de saída)
    // vai pelo núcleo de pesquisa novo; o caminho antigo fica de reserva
    const anexadas = imagensAnexadas(objetivo);
    const regraDoPedido = tipoDoPedido(anexadas ? anexadas.pedido : objetivo);
    if (this.config.nucleoDePesquisa === true && !this.skillForcada && !tarefaAnterior && !['local', 'site'].includes(regraDoPedido.tipo) && !regraDoPedido.arquivoDeSaida) {
      const pronta = await this.responderPeloNucleo({ objetivo: anexadas ? anexadas.pedido : objetivo, conversa, imagens: anexadas?.arquivos || [] });
      if (pronta !== null) return pronta;
    }
    if (this.config.modoAuto !== false && !this.skillForcada && !tarefaAnterior) {
      const classificacao = verificador.classificarPedido(objetivo);
      // 'livre' é a regra sem opinião (quase metade dos pedidos reais): aí
      // vale esperar um instante pelo decisor antes de escolher o nível — com
      // o modelo rápido (0,9 s) ele chega; com o de 4B não chega e nada muda
      let tipoParaONivel = tipoDoPedido(objetivo).tipo;
      let rotaDoAuto = null; // a decisão do modelo, quando foi ela que definiu o nível
      if (tipoParaONivel === 'livre' && this.config.roteadorDecisor) {
        const espera = Number(this.config.autoEsperaDecisorMs ?? 1500);
        const r = await Promise.race([rotaAndando.promessa.catch(() => null), new Promise((ok) => setTimeout(ok, espera, null))]);
        if (r?.fonte === 'decisor') {
          tipoParaONivel = r.tipo;
          rotaDoAuto = r;
        }
      }
      let nivel = auto.decidirNivel({
        objetivo,
        tipo: tipoParaONivel,
        refereConversa: conversa.length > 0 && Boolean(prompts.referenciaConversa(objetivo, conversa)),
        multiplas: (verificador.perguntasMultiplas(objetivo) || []).length || 1,
        precisaPlanejamento: classificacao.precisaPlanejamento,
      });
      // o usuário escolheu "Resposta direta": nível 1 para tudo que não precisa
      // das ferramentas do laço (arquivo, pasta, site)
      const direta = this.config.respostaDireta === true && nivel.nivel >= 2 && !['local', 'site'].includes(tipoDoPedido(objetivo).tipo);
      if (direta) nivel = { nivel: 1, nome: auto.NOMES[1], motivo: 'resposta direta escolhida por você' };
      if (nivel.nivel === 1 && !direta) {
        let itens = [];
        try {
          itens = new Memory({ dir: path.join(new Sandbox(this.config.workspace).root, '.augpt'), config: this.config }).items;
        } catch {
          /* sem memória legível: segue a regra */
        }
        if (auto.assuntoNaMemoria(auto.assuntoDoPedido(objetivo), itens, { idConversa })) {
          nivel = { nivel: 2, nome: auto.NOMES[2], motivo: 'o assunto está na memória da pasta de trabalho' };
        }
      }
      if (nivel.nivel <= 1) {
        this.aplicarNivelAuto(nivel);
        this.emit('tipo-de-pedido', rotaDoAuto || { ...tipoDoPedido(objetivo), fonte: 'regra' });
        // o 'inicio' de verdade só sai mais abaixo, no laço — sem isto o registro da
        // resposta rápida ficava com o pedido em branco
        this.emit('inicio-rapido', { objetivo });
        const pronta = await this.respostaRapidaAuto({ objetivo, conversa, nivel });
        if (pronta !== null) return pronta;
        if (this.controller.signal.aborted) return { ok: false, motivo: 'interrompido' };
        nivel = { ...nivel, nivel: 2, nome: auto.NOMES[2], motivo: `${nivel.motivo}; a resposta rápida falhou` };
      }
      this.aplicarNivelAuto(nivel, { temConversa: conversa.length > 0 });
    }

    const tarefa = new Tarefa(objetivo);
    // `tarefaAnterior` (opcional, pedido do Davi 2026-09-21, análise
    // comparativa item 1 — "persistir Tarefa por conversa"): o `.serializar()`
    // da última execução desta MESMA conversa, se ela foi interrompida (app
    // fechado, `parar()`, limite de rodadas) antes de chegar a `concluida` —
    // ver `electron/main.js` (`Conversas.atualizarTarefa`/`agent:start`).
    // `retomarDe()` só tem efeito quando sobrou subtarefa `pendente` de
    // verdade; a maioria dos turnos nunca chega a usar checklist e isto vira
    // no-op. Não repassa hipótese/evidência/ação antiga de propósito — podem
    // não valer mais pro objetivo deste turno; só o checklist continua sendo
    // "trabalho que falta fazer" de forma confiável entre execuções.
    if (tarefaAnterior) tarefa.retomarDe(tarefaAnterior);
    this.tarefa = tarefa;

    // Uma vez por execução, antes de QUALQUER OUTRA COISA usar o objetivo —
    // de propósito bem cedo: se reescrever (resolvendo "faz de novo aquilo"
    // contra a conversa), a seleção de skill, o prompt de sistema e a busca
    // de rotina logo abaixo já usam a versão boa, não o pedido cru.
    const ambiguidade = await this.verificarAmbiguidade({ objetivo, conversa });
    // Controlador v2: só a verificação de ambiguidade (código + modelo, no
    // início) confirma que falta um dado do usuário — ver aplicarRecomendacaoCritico
    this.ambiguidadeInsuficiente = ambiguidade.suficiente === false;
    // A reescrita só existe pra resolver referência a uma conversa ANTERIOR
    // ("aquilo", "o mesmo", "de novo" — ver o comentário na função acima).
    // Sem conversa, não há NADA que precise ser resolvido — o pedido já é
    // autossuficiente por definição, então nunca deveria ser substituído.
    //
    // Caso real de produção (duas vezes, semanas de intervalo): um pedido
    // de 9-10 perguntas de prova (~3600 caracteres), numa conversa NOVA,
    // era cortado em ~500 caracteres pelo teto do prompt de ambiguidade
    // (ver pedidoDeAmbiguidade em prompts.js) — o modelo, instruído a
    // "repetir exatamente" quando não bifurca, só conseguia ecoar de volta
    // o que viu (o trecho truncado, terminando no meio da Questão 2), e
    // essa versão truncada SUBSTITUÍA `objetivo` aqui embaixo pro resto da
    // execução inteira: a busca só pesquisava sobre a Questão 1, a
    // decomposição de perguntas (decomporPedido/perguntasMultiplas, em
    // verificador.js) só via 1-2 partes em vez de 10, e a resposta final
    // nunca chegava perto de tratar as questões 3-10 — tudo isso rio abaixo
    // de um bug que não tinha nada a ver com decomposição ou redação: o
    // pedido original já tinha sido perdido bem antes de qualquer um deles
    // rodar. Deixar de aplicar a reescrita quando `conversa` está vazia
    // elimina esse cenário por completo, sem depender do modelo obedecer a
    // instrução de "repetir exatamente" corretamente.
    let houveReescritaDeConversa = false;
    if (conversa.length > 0 && ambiguidade.objetivo && ambiguidade.objetivo !== objetivo) {
      this.emit('objetivo-reescrito', { original: objetivo, reescrito: ambiguidade.objetivo });
      objetivo = ambiguidade.objetivo;
      houveReescritaDeConversa = true;
    }

    // Revisão v3 (Fase 2, chat real de 29/09): "um tutorial … dentro do jogo"
    // logo depois de "táticas de PUBG de PC" virou GTA Online — a referência
    // só era reconhecida por pronome. Aqui o CÓDIGO tira o assunto dos
    // pedidos anteriores (jogo, plataforma, categoria, produtos) e encaixa o
    // que falta junto da expressão genérica: "dentro do jogo (PUBG de PC)".
    // Não depende do 7B: se a reescrita acima já resolveu, nada muda.
    if (conversa.length > 0) {
      const resolvido = resolverReferencia(objetivo, conversa);
      if (resolvido.mudou) {
        this.emit('objetivo-reescrito', { original: objetivo, reescrito: resolvido.objetivo, via: 'assunto da conversa' });
        this.emit('assunto-da-conversa', { assunto: resolvido.assunto, motivo: resolvido.motivo, objetivo: resolvido.objetivo });
        objetivo = resolvido.objetivo;
        houveReescritaDeConversa = true;
      }
    }

    tarefa.interpretar({
      ativa: objetivo,
      alternativas: ambiguidade.bifurcacao ? [ambiguidade.bifurcacao.a, ambiguidade.bifurcacao.b] : [],
    });
    if (ambiguidade.bifurcacao) {
      tarefa.adicionarHipotese(ambiguidade.bifurcacao.a, { confirmada: false });
      tarefa.adicionarHipotese(ambiguidade.bifurcacao.b, { confirmada: false });
    }
    if (!ambiguidade.suficiente) {
      tarefa.adicionarHipotese('Falta uma informação que somente o usuário pode fornecer.', { confirmada: true });
    }

    // Bifurcação de interpretação (ex.: "como ficar melhor no PUBG" — FPS ou
    // habilidade de jogo?) — segunda chamada, só roda quando o passo 3 do
    // prompt acima realmente detectou duas leituras diferentes. Na maioria
    // dos pedidos não bifurca, então isso não custa nada além do de sempre.
    //
    // Bug real de produção (bateria de testes com o Davi, "Teste 4"): pedido
    // original "O que é machine learning, em uma frase?", seguido de "faz de
    // novo, mas em duas frases". A reescrita acima (que VÊ a conversa)
    // resolveu certo pra "Fale sobre machine learning em duas frases" — mas
    // essa MESMA chamada também propôs uma bifurcação ("explicação geral" vs.
    // "aplicações práticas"), e `decidirInterpretacao`, chamado a seguir,
    // decide entre as duas leituras SEM ver a conversa (só recebe `objetivo` e
    // `bifurcacao` — ver a função abaixo). Sem esse contexto, ele "escolheu"
    // aplicações práticas — um assunto que não tinha nada a ver com o que
    // estava sendo continuado — e colou "(especificamente: Aplicações
    // práticas)" no objetivo, produzindo uma resposta sobre um tema inventado,
    // sem nenhuma busca. A reescrita já resolveu a referência à conversa
    // usando o contexto completo; bifurcar de novo em cima do resultado, às
    // cegas, é reabrir uma ambiguidade que a etapa anterior, com mais
    // informação, já tinha fechado. Por isso: pedido reescrito nesta execução
    // não bifurca — a bifurcação só roda para pedidos que chegaram como
    // vieram (sem depender da conversa pra fazer sentido), onde não há
    // contexto nenhum sendo ignorado.
    // Pedido de recomendação/comparação não bifurca (13º teste real): a
    // "interpretação escolhida" estreitou "10 melhores intra pra PUBG" pra
    // "qualidade sonora e clareza de áudio" e "diferença entre 5070 Ti e 5080"
    // pra "desempenho técnico" (foi o que levou ao PassMark). O motor de
    // pesquisa já interpreta o uso (cadeia do uso).
    // Roteador híbrido (roteador.js, 2026-10-10): regra de código + modelo de
    // decisão (Tev1) quando ligado em Ajustes. Decidido UMA vez, aqui, e
    // repassado a todo lugar que pergunta "é pedido do motor?" / "que tipo
    // é?" — senão o loop e o motor discordariam sobre o mesmo pedido.
    // Desligado, sem modelo ou com erro: a regra decide, como sempre.
    // já vem rodando desde o início (pedirRota, acima); só pergunta de novo
    // se o objetivo foi reescrito no caminho
    if (rotaAndando.objetivo !== objetivo) rotaAndando = pedirRota(objetivo);
    const rota = await rotaAndando.promessa;
    this.rota = { ...rota, objetivo };
    if (rota.falhaDoDecisor) this.emit('aviso', { texto: `Modelo de decisão indisponível (${rota.falhaDoDecisor}); a rota ficou com as regras.` });
    const pedidoDoMotor = this.config.motorDePesquisa !== false && motorPesquisa.ehPedidoDeRecomendacao(objetivo, { rota: this.rota });
    // AUTO: o Tev1 viu compra/guia onde a regra não via — sobe para o nível 3
    // (motor com tudo o que está ligado em Ajustes)
    if (this.nivelAuto && this.nivelAuto.nivel < 3 && pedidoDoMotor) {
      this.aplicarNivelAuto({ nivel: 3, nome: auto.NOMES[3], motivo: `o roteador viu pedido de ${this.rota.tipo || 'pesquisa'} (antes: ${this.nivelAuto.motivo})` });
    }
    if (!houveReescritaDeConversa && ambiguidade.suficiente && ambiguidade.bifurcacao && !pedidoDoMotor) {
      const decisao = await this.decidirInterpretacao({ objetivo, bifurcacao: ambiguidade.bifurcacao });
      if (decisao.escolhida) {
        this.emit('interpretacao-escolhida', {
          bifurcacao: ambiguidade.bifurcacao,
          escolhida: decisao.escolhida,
          notaAlternativa: decisao.notaAlternativa,
        });
        objetivo = `${objetivo} (especificamente: ${decisao.escolhida})`;
        tarefa.interpretar({ ativa: objetivo, confianca: decisao.notaAlternativa ? 'baixa' : 'alta' });
        if (decisao.notaAlternativa) this.notaDeInterpretacao = decisao.notaAlternativa;
      }
    }

    // Classificação determinística de complexidade (ver verificador.js) —
    // decide, SEM chamar o modelo, se este pedido precisa de plano explícito
    // forçado (planejarInicial, mais abaixo) e de crítica periódica mais
    // frequente. Guardado na instância pra quem inspecionar a execução (e os
    // testes) conseguir ver a classificação sem repetir a lógica.
    const classificacaoPedido = verificador.classificarPedido(objetivo);
    this.classificacaoPedido = classificacaoPedido;
    // Revisão v3 (Fase 1): tipo de pedido pelo OBJETO, só regra de código
    // (tipo-de-pedido.js). 'explicacao' não ganha plano forçado, checklist
    // nem crítico periódico (o Gojo levou 6 min por causa disso); 'guia' e
    // 'produto' vão pro motor; 'local'/'livre' seguem o laço de sempre.
    // a interpretação escolhida acima pode ter mudado o objetivo: aí a rota
    // decidida antes não vale mais e a regra decide sobre o texto novo
    const tipoPedido = this.rota.objetivo === objetivo ? this.rota : { ...tipoDoPedido(objetivo), fonte: 'regra' };
    if (tipoPedido !== this.rota) this.rota = { ...tipoPedido, tipoDaRegra: tipoPedido.tipo, objetivo };
    this.tipoDoPedido = tipoPedido.tipo;
    this.emit('tipo-de-pedido', tipoPedido);
    tarefa.definirCriterios([
      'Cobrir o objetivo original e todas as partes relevantes do pedido',
      'Concluir somente após verificar o resultado final',
    ]);
    try {
      tarefa.transicionar(ESTADOS_TAREFA.PLANEJANDO, 'interpretação concluída');
    } catch {
      /* observabilidade não pode interromper a execução */
    }
    this.emit('tarefa-atualizada', tarefa.serializar());

    // Pedido do Davi 2026-09-14 ("apertar as rédeas pra qualquer tipo de
    // pergunta"): com `pipelineForcadoUniversal` (default true), o pipeline
    // completo (plano forçado, gate de checklist, crítica periódica na
    // cadência "Complexo") vale pra QUALQUER pedido, não só pros que
    // `classificarPedido` já detectava como complexos — esses continuam
    // contando (OR), então nada regride se o flag for desligado depois.
    // revisão v3: explicação ("por que…", "o que é…") não ganha o pipeline
    // forçado — só se a classificação disser que o pedido tem várias partes
    const pipelineCompleto =
      ((this.config.pipelineForcadoUniversal ?? false) && !(tipoPedido.tipo === 'explicacao' && this.config.modoExplicacao !== false)) ||
      classificacaoPedido.precisaPlanejamento;
    this.pipelineCompleto = pipelineCompleto;

    const sandbox = new Sandbox(this.config.workspace);
    // Retomada (retomada.js, 2026-10-10): páginas baixadas e destilações da
    // execução INTERROMPIDA desta conversa são reaproveitadas; se a anterior
    // terminou (ou não houve), o que sobrou é apagado antes de começar.
    this.retomada = new Retomada({
      dir: this.config.retomarLeituras === false ? null : path.join(sandbox.root, '.augpt'),
      idConversa,
    });
    if (tarefaAnterior) this.retomada.carregar();
    else this.retomada.limpar();
    if (!this.retomada.vazia) {
      this.emit('retomada', { paginas: this.retomada.paginas.size, destilacoes: this.retomada.destilacoes.size });
      this.emit('aviso', {
        texto: `Retomando a execução interrompida: ${this.retomada.paginas.size} página(s) e ${this.retomada.destilacoes.size} destilação(ões) já feitas serão reaproveitadas.`,
      });
    }
    const memory = new Memory({
      dir: path.join(sandbox.root, '.augpt'),
      config: this.config,
      log: (m) => this.emit('aviso', { texto: m }),
    });

    const operacional = new MemoriaOperacional(path.join(sandbox.root, '.augpt'));
    if (this.config.memoriaOperacional !== false) {
      // aprende observando os próprios eventos, sem custo de chamada ao modelo
      for (const evento of ['fonte', 'resultado', 'confronto']) {
        this.on(evento, (dados) => observar(operacional, evento, dados));
      }
      // credibilidade aprendida NESTA pasta de trabalho entra na ordenação de
      // busca desta execução — search.js guarda isso num mapa global separado
      // do que o usuário marcou manualmente (definirPersonalizados), então um
      // nunca sobrescreve o outro.
      search.definirAprendidos(operacional.credibilidadeAprendida());
    }

    // Diferente da operacional e da vetorial, vive em userData — não na pasta
    // de trabalho. Fatos sobre QUEM é o usuário valem em qualquer projeto.
    const memoriaCentral = new MemoriaCentral(this.userDataPath);

    const ctx = {
      objetivo,
      tarefa,
      // Etapa D (revisão v2): o escopo que o PEDIDO fixa — plataforma,
      // variante excluída ("PUBG de PC" exclui "PUBG Mobile"), produtos
      // nomeados que uma leitura precisa citar. Montado pelo código.
      escopo: escopoDoPedido(objetivo, { entidades: serieDePrecos.produtosDoPedido(objetivo) }),
      estado: {}, // rascunho compartilhado entre ferramentas dentro da execução
      // páginas já lidas em outras conversas (src/tools/web.js, lerDoDisco)
      dirCachePaginas: this.userDataPath ? path.join(this.userDataPath, 'cache-paginas') : null,
      userDataPath: this.userDataPath,
      retomada: this.retomada,
      sandbox,
      memory,
      operacional,
      memoriaCentral,
      config: this.config,
      emit: (evento, dados) => this.emit(evento, dados || {}),
      // revisão v3: a resposta do usuário vai pro registro (antes só "43 caracteres")
      ask: async (pergunta) => {
        const resposta = await this.esperar('pergunta', { pergunta });
        // senha dada na resposta ("a senha é 4821") também é segredo
        for (const v of segredosDoTexto(String(resposta ?? ''))) if (!(this.segredos ||= []).includes(v)) this.segredos.push(v);
        this.emit('pergunta-respondida', { pergunta, resposta });
        (this.perguntasRespondidas ||= []).push({ pergunta: String(pergunta || ''), resposta: String(resposta ?? '') });
        return resposta;
      },
      render: this.render,
      navegador: this.navegador,
      // `dossie`/`jaFeito`/`checklist` só são declarados mais abaixo nesta
      // mesma função (`run`) — a referência aqui é só o closure, resolvida
      // de fato na hora em que a ferramenta `consultar_critico` chamar isto,
      // já dentro do laço principal, quando as três já existem.
      consultarCritico: (motivo) => this.consultarCritico({ objetivo, checklist, jaFeito, dossie, motivo }),
      // Item 5 (2026-09-21/22, "sub-tarefa despachada com contexto
      // descartável"): mesmo truque de closure do `consultarCritico` acima —
      // `despacharSubtarefa` só é declarada mais abaixo (perto de
      // `executarPasso`, de quem ela depende), esta referência só resolve de
      // fato quando a ferramenta `investigar_subtarefa` chamar isto.
      despacharSubtarefa: (args) => despacharSubtarefa(args),
    };
    // Fase 1 de segurança: URLs que o próprio usuário escreveu (pedido ou
    // conversa) contam como "vistas" — abrir elas nunca pede confirmação
    // extra (ver tools.urlPodeVazarDados).
    tools.registrarUrlsVistas(ctx.estado, [objetivo, ...(conversa || []).map((m) => m?.content || '')].join('\n'));

    // Só o objetivo (que desde a reescrita — ver verificarAmbiguidade — já é
    // autossuficiente) mais o que o PRÓPRIO USUÁRIO disse antes, nunca o que
    // O AGENTE respondeu. A resposta anterior costuma ser um texto longo e
    // gerado — qualquer palavra solta nela (ex.: "tempo" numa frase sem nada
    // a ver com previsão do tempo) casa com gatilho de skill por acidente. O
    // que o usuário escreveu é um sinal de continuidade muito mais limpo, e
    // é reduzido, não removido: casos como "E amanhã?" seguindo uma pergunta
    // sobre previsão continuam funcionando.
    const textoDoPedido = [
      objetivo,
      // Etapa B: só quando o pedido se refere à conversa ("e amanhã?")
      ...(prompts.referenciaConversa(objetivo, conversa) ? conversa.filter((t) => t.role === 'user').slice(-2).map((t) => t.content) : []),
    ].join(' ');
    let skillsDecisao = this.skills
      ? await this.skills.selecionar(textoDoPedido, {
          etapa: 'decisao',
          desativadas: this.config.skillsDesativadas || [],
          host: this.config.host,
          embedModel: this.config.embedModel,
          // Item 6: "/nome" (ver início de run()) garante esta skill aqui.
          forcarId: this.skillForcada?.id || null,
        })
      : [];
    // guardado para a reflexão pós-execução indexar a lição pelo tipo de tarefa
    this.skillsDecisao = skillsDecisao;
    // Item 2 (ver comentário no construtor acima): captura os ids AQUI,
    // antes de qualquer reseleção por subtarefa reescrever `skillsDecisao` —
    // esta lista (ordenada por relevância) é o que `reselecionarSkillsPorSubtarefa`
    // passa como `reforcarObjetivo` daqui pra frente, o turno inteiro.
    this.skillsObjetivoIds = skillsDecisao.map((s) => s.id);
    // Item 3 da análise comparativa (2026-09-21, "allowed-tools por skill"):
    // recalculada aqui e de novo em toda reseleção por subtarefa mais abaixo
    // (ver Peça 2 do nivelRaciocinio) — ver ferramentasDesativadasParaSkills().
    let ferramentasDesativadasAtual = this.ferramentasDesativadasParaSkills(skillsDecisao);

    if (skillsDecisao.length) {
      this.emit('skills', { etapa: 'decisao', nomes: skillsDecisao.map((s) => s.nome) });
    }

    // Peça 2 (nivelRaciocinio, ver reselecionarSkillsPorSubtarefa mais acima):
    // `textoDoPedido` é o FOCO usado nesta seleção — muda pro texto da
    // subtarefa atual assim que o checklist tiver mais de um item, no laço
    // principal mais abaixo. `montarSistema` fica como função porque o
    // prompt de sistema precisa ser reconstruído toda vez que a seleção mudar
    // (é ele, não `skillsDecisao` sozinho, que o modelo de fato vê).
    // Peça "resumo de conversa" (pedido do Davi 2026-09-21, mesma conversa do
    // Item 1) — lógica extraída pro método fundirResumoConversa() logo
    // abaixo (item 2 da análise comparativa, 2026-09-21: "comando manual de
    // compactação", inspirado no /compact do deer-flow) pra poder ser
    // chamada tanto aqui, automaticamente, quanto sob demanda, fora de
    // qualquer execução — ver electron/main.js, IPC 'chats:compact'.
    const { resumoConversa: resumoConversaAtual, resumoConversaTurnos: resumoConversaTurnosAtual } =
      await this.fundirResumoConversa(conversa, idConversa, { resumoConversa, resumoConversaTurnos });

    let focoSkillAtual = textoDoPedido;
    const montarSistema = (skillsAtuais) =>
      prompts.sistema({
        objetivo,
        workspace: sandbox.root,
        so: `${process.platform} (${process.arch})`,
        conversa,
        resumoConversa: resumoConversaAtual,
        skills: Skills.formatar(skillsAtuais),
        aprendizado: this.config.memoriaOperacional === false ? '' : operacional.paraPrompt(textoDoPedido),
        memoriaCentral: this.config.memoriaCentral === false ? '' : memoriaCentral.paraPrompt(),
        ferramentasDesativadas: ferramentasDesativadasAtual,
        // a skill diz de quais ferramentas a tarefa depende; elas entram no
        // catálogo mesmo que estivessem fora da seleção padrão
        ferramentasGarantidas: [...new Set(skillsAtuais.flatMap((s) => s.ferramentas || []))],
        catalogoSeletivo: this.config.catalogoSeletivo !== false,
      });
    let sistema = montarSistema(skillsDecisao);

    /**
     * Executa uma ferramenta com tudo que o laço faz: aprovação, eventos,
     * destilação e dossiê. As rotinas usam este mesmo caminho — elas pulam as
     * decisões, não as salvaguardas.
     */
    const executarPasso = async ({ nome, argumentos, foco = '', opcao = '', deveCitar = false }) => {
      const ferramenta = tools.get(nome, ferramentasDesativadasAtual);
      if (!ferramenta) return { erro: `ferramenta "${nome}" indisponível` };

      this.iteracao += 1;
      this.emit('iteracao', { n: this.iteracao, de: this.limiteDePassos() });
      this.emit('ferramenta', { n: this.iteracao, nome, argumentos, risco: ferramenta.risk });

      if (tools.precisaAprovacao(nome, this.config, { argumentos, estado: ctx.estado })) {
        const decisao = await this.pedirAprovacao({ nome, argumentos, ferramenta, motivo: motivoDeAprovacao(nome, argumentos, ctx.estado) });
        if (decisao === 'negar') {
          tarefa.registrarAcao({ nome, argumentos, erro: 'recusado pelo usuário', aprovada: false });
          this.emit('negado', { n: this.iteracao, nome });
          return { erro: 'recusado pelo usuário' };
        }
      }

      const t0 = Date.now();
      let saida = '';
      let erro = null;
      const fontesAntes = (ctx.estado.fontesLidas || []).length;
      if (GERACOES_DE_ARQUIVO.includes(nome)) ctx.estado.tentouGerarArquivo = true;
      try {
        saida = await this.rodarFerramenta(nome, ferramenta, argumentos, ctx);
      } catch (err) {
        if (!this.rodando) throw err;
        erro = err.message;
      }
      tools.registrarUrlsVistas(ctx.estado, saida);
      if (!erro) registrarFerramentaOk(nome);

      this.emit('resultado', {
        n: this.iteracao,
        nome,
        // Etapa A (2026-09-28): os argumentos (consulta, foco, URL) vão pro
        // registro — sem isso o 14º teste real teve de ser diagnosticado pelas
        // URLs lidas
        argumentos: resumoDeArgumentos(argumentos),
        saida: String(saida).slice(0, 6000),
        erro,
        duracao: Date.now() - t0,
      });

      if (!erro && LEITURAS.includes(nome)) {
        const entradas = await this.destilarLeitura({ nome, argumentos, saida, ctx, objetivo, fontesAntes, foco, opcao, deveCitar });
        dossie.push(...entradas);
        this.salvarDossieNaMemoriaCurta(entradas, { memory, idConversa });
        for (const entrada of entradas) {
          tarefa.registrarEvidencia({
            origem: entrada.origem,
            texto: entrada.texto || entrada.bruto,
            url: entrada.url,
          });
          if (checklist.length) {
            // revisão v3: marca o item que ESTA leitura atende, não o primeiro pendente
            const atendido = itemDaLeitura(checklist, `${alvoDaLeitura(argumentos)} ${entrada.url || ''}`);
            if (atendido) tarefa.marcarSubtarefaComEvidencia(atendido.texto);
            checklist = checklist.map((item) => {
              const subtarefa = tarefa.subtarefas.find((sub) => sub.chave === normalizarSubtarefa(item.texto));
              return subtarefa?.status === 'feito' ? { ...item, status: 'feito' } : item;
            });
          }
        }
      }
      if (!erro && GERACOES_DE_ARQUIVO.includes(nome)) ctx.estado.escreveu = true;

      tarefa.registrarAcao({
        nome,
        argumentos,
        resultado: saida,
        erro,
        duracao: Date.now() - t0,
        aprovada: true,
      });
      try {
        if ([ESTADOS_TAREFA.PLANEJANDO, ESTADOS_TAREFA.REPLANEJANDO, ESTADOS_TAREFA.AGUARDANDO_USUARIO].includes(tarefa.estado)) {
          tarefa.transicionar(ESTADOS_TAREFA.EXECUTANDO, 'ação executada');
        }
      } catch {
        /* estado auxiliar não pode derrubar uma ferramenta concluída */
      }
      this.emit('tarefa-atualizada', tarefa.serializar());

      return { erro, saida: String(saida) };
    };

    let historico = [{ role: 'user', content: prompts.primeiraMensagem() }];
    let resumo = '';
    let falhasSeguidas = 0;
    const dossie = []; // tudo que foi lido, para a redação final
    let lembrancas = [];
    let lacunas = null; // o que do pedido ainda não apareceu no material
    const jaFeito = []; // ações concluídas, para o modelo não repetir
    let buscasFeitas = 0;
    // calculado uma vez e reaproveitado — tanto no teto inline do loop quanto
    // na busca de reforço de finalizarComResposta, para os dois nunca divergirem
    const tetoDeBuscas = this.config.maxBuscas || TETO_DE_BUSCAS[this.config.profundidadePesquisa] || 5;
    let checklist = []; // lista de tarefas com estado (ver reconciliarChecklist)
    // contrato de conclusão (2026-09-27): ferramenta que rodou com sucesso
    // cumpre o item do plano que só ela cumpre (ver ferramentaDoItem) —
    // chamado pelos dois caminhos de execução (executarPasso e o laço)
    const registrarFerramentaOk = (nome) => {
      ctx.estado.ferramentasOk = ctx.estado.ferramentasOk || new Set();
      ctx.estado.ferramentasOk.add(nome);
      if (!checklist.some((i) => i.status === 'pendente' && ferramentaDoItem(i.texto) === nome)) return;
      checklist = checklist.map((i) => (i.status === 'pendente' && ferramentaDoItem(i.texto) === nome ? { ...i, status: 'feito' } : i));
      tarefa.atualizarSubtarefas(checklist);
      this.emit('checklist', checklist);
    };
    let ultimaAcaoOk = null; // null = nenhuma ação ainda; true/false alimenta a reconciliação acima
    let criticasDoPlanoFeitas = 0; // teto de chamadas do subagente crítico nesta execução
    let vetosChecklistFeitos = 0; // teto de vezes que barramos responder/concluir com checklist pendente
    let abandonoChecklistPermitido = false; // após veto explícito, plano novo pode pular itens antigos
    let vetosPreRedacaoFeitos = 0; // teto de vezes que barramos "responder" com material insuficiente (ver gate abaixo)
    let vetosTarefaEstadoFeitos = 0; // teto de vezes que barramos responder/concluir com a tarefa aguardando/bloqueada (ver gate abaixo)
    const assinaturas = new Map(); // detecta a mesma ação repetida
    const resultadoPorChave = new Map(); // ação de página → a última tentativa idêntica mudou a página?
    let vetosDePerguntaRepetida = 0;
    let vetosDePerguntaNoAutomatico = 0;
    let vetosDeSite = 0;
    let vetouPerguntaCardapio = false;
    // Controlador v2 (05/10): o que aconteceu desde a última crítica — no
    // modo de crítica por evento, o crítico só roda quando isto tem algo
    let eventoParaCritico = null;
    // Controlador v2: orçamento ÚNICO de vetos ao "responder" por execução,
    // somando todos os portões (checklist, crítico, material insuficiente).
    // Antes cada portão tinha o próprio teto e, somados, davam 6–8 vetos.
    let vetosDeResposta = 0;
    const ORCAMENTO_VETOS_DE_RESPOSTA = this.config.orcamentoVetosDeResposta ?? 2;
    this.perguntasRespondidas = [];

    // Item 5 da análise comparativa (2026-09-21/22, "sub-tarefa despachada
    // com contexto descartável, devolvendo só o resultado destilado" —
    // inspirado no isolamento de contexto do deer-flow/hermes-agent, mas
    // SEQUENCIAL, nunca em paralelo: um Ollama local compete por VRAM/RAM
    // consigo mesmo, o mesmo motivo que já vale pro resto do agente, ver
    // hardware.js). Reaproveita 100% a ferramenta pesquisar_e_ler e a
    // destilação que ela já dispara via `executarPasso` (LEITURAS, mais
    // acima) — a novidade aqui é só o LAÇO: até TETO_CONSULTAS_SUBTAREFA
    // buscas relacionadas rodam uma atrás da outra dentro de UMA chamada de
    // ferramenta, e só o resultado consolidado (já destilado por cada busca
    // individual, sem chamada de modelo nova pra consolidar) volta pro
    // modelo de decisão principal.
    //
    // A isolação de contexto que o item pede sai de graça da própria forma
    // como o laço principal já é estruturado: `executarPasso` nunca escreve
    // em `historico` (só em `dossie`/`ctx.estado`/eventos) — quem empurra
    // pra `historico` é o corpo do laço principal, UMA vez por iteração, com
    // o resultado da ferramenta que o modelo escolheu naquela iteração. Como
    // as N chamadas internas de pesquisar_e_ler aqui dentro não passam pelo
    // corpo do laço (só por executarPasso direto), elas não geram N entradas
    // de historico — só a ÚNICA entrada de `investigar_subtarefa`, exatamente
    // como qualquer outra ferramenta. Resultado: o modelo principal gasta 1
    // chamada de decisão (a mais cara) pra toda a sub-investigação, não 1
    // por busca — sem gastar NENHUMA chamada de modelo a mais que o
    // equivalente feito manualmente busca por busca (pesquisar_e_ler
    // continua sendo só busca+leitura+destilação determinística/modelo
    // pequeno, nunca o modelo de decisão).
    //
    // Orçamento das buscas internas (correções rápidas do motor de pesquisa,
    // 2026-09-24). Antes elas descontavam do MESMO `buscasFeitas`/
    // `tetoDeBuscas` das buscas soltas — e no raciocínio "leve" esse teto é
    // 4: UMA subtarefa com 4 consultas (critério A, critério B, opção X,
    // opção Y) esgotava a pesquisa inteira, e o agente não tinha como buscar
    // mais nada. O teto de buscas existe pra conter o modelo reformulando a
    // mesma pergunta uma busca de cada vez (as 27 consultas quase iguais do
    // README); consulta planejada numa subtarefa é justamente o remédio pra
    // isso, então ganha orçamento próprio, do mesmo tamanho do teto da
    // execução (`buscasEmSubtarefas`/`tetoDeBuscas`). Continua havendo teto —
    // a ferramenta ainda não é um jeito de buscar sem limite —, só não
    // disputa mais com as buscas soltas. O gate do laço principal (mais
    // abaixo, `BUSCAS.includes(nome)`) nunca vê estas buscas internas (o
    // `nome` da iteração é «investigar_subtarefa»), por isso o controle é
    // manual aqui.
    const TETO_CONSULTAS_SUBTAREFA = 4;
    let buscasEmSubtarefas = 0;
    const despacharSubtarefa = async ({ objetivo: objetivoSubtarefa, consultas }) => {
      const lista = (Array.isArray(consultas) ? consultas : [consultas])
        .map((c) => String(c || '').trim())
        .filter(Boolean)
        .slice(0, TETO_CONSULTAS_SUBTAREFA);
      if (!lista.length) return 'Nenhuma consulta válida foi informada — nada foi investigado.';

      const antes = dossie.length;
      let pulou = false;
      for (const consulta of lista) {
        if (buscasEmSubtarefas >= tetoDeBuscas) {
          pulou = true;
          break;
        }
        buscasEmSubtarefas += 1;
        // o objetivo da subtarefa vai como `foco` da destilação de cada
        // página lida (ver `prompt` em destilador.js)
        await executarPasso({
          nome: 'pesquisar_e_ler',
          argumentos: { consulta },
          foco: String(objetivoSubtarefa || '').trim(),
        });
      }

      const novasFontes = dossie.slice(antes);
      this.emit('subtarefa', {
        objetivo: String(objetivoSubtarefa || ''),
        consultas: lista,
        fontes: novasFontes.length,
        pulouPorTeto: pulou,
      });

      if (!novasFontes.length) {
        return `Sub-tarefa "${objetivoSubtarefa || lista.join('; ')}": nenhuma fonte nova encontrada.`;
      }
      const corpo = novasFontes
        .map((f) => `- [${f.origem || f.url || 'fonte'}] ${f.texto || f.bruto || ''}`)
        .join('\n');
      const aviso = pulou
        ? '\n(algumas consultas não rodaram — limite de buscas em sub-tarefas desta execução atingido)'
        : '';
      return (
        `Resultado da sub-tarefa "${objetivoSubtarefa || lista.join('; ')}" ` +
        `(${novasFontes.length} fonte(s), já destiladas):\n${corpo}${aviso}`
      );
    };

    // ---------- rotina, quando existe caminho previsível ----------
    const tentarRotina = async () => {
      if (this.config.usarRotinas === false) return null;
      const rotina = skillsDecisao.map((k) => rotinas.carregar(k)).find(Boolean);
      if (!rotina) return null;

      const parametros = await rotinas.preencher({
        contabilizar: (uso) => this.contabilizar(uso, { tipo: 'rotina' }),
        rotina, objetivo, config: this.config, modelo: this.modeloDe('decisao'),
        signal: this.controller.signal,
      });

      if (!rotinas.completa(rotina, parametros)) {
        this.emit('rotina-ignorada', { rotina: rotina.nome, motivo: 'faltou parâmetro no pedido' });
        return null;
      }

      this.emit('rotina-inicio', { rotina: rotina.nome, passos: rotina.passos.length, parametros });
      const r = await rotinas.executar({
        rotina, parametros, executarPasso,
        emitir: (evento, dados) => this.emit(evento, dados),
      });
      this.emit('rotina-fim', { rotina: rotina.nome, ...r });

      if (!r.concluida) return null; // devolve o controle ao agente
      ctx.estado.foco = r.foco;
      return r;
    };

    this.emit('inicio', {
      objetivo,
      workspace: sandbox.root,
      modelo: this.modeloDe('decisao'),
      modeloRedacao: this.modeloDe('redacao'),
    });

    try {
      const rotina = await tentarRotina();
      if (rotina) {
        const final = await this.finalizarComResposta({
          objetivo, conversa, dossie, ctx, memory,
          saida: 'Rotina concluída.',
          forcarRedacao: true,
          buscasFeitas, tetoDeBuscas, executarPasso,
        });
        return { ok: true, resumo: final };
      }

      // A verificação já rodou no início de run() (antes de skill/sistema
      // serem montados) — aqui só usamos o resultado guardado, no ponto em
      // que `historico` já existe, pra forçar a pergunta como primeira ação.
      if (!ambiguidade.suficiente) {
        try {
          tarefa.transicionar(ESTADOS_TAREFA.AGUARDANDO_USUARIO, 'informação insuficiente para agir com segurança');
        } catch {
          /* estado auxiliar não pode impedir a pergunta ao usuário */
        }
        this.emit('tarefa-atualizada', tarefa.serializar());
        this.emit('ambiguidade', { pergunta: ambiguidade.pergunta });
        historico.push({
          role: 'user',
          content:
            `VERIFICAÇÃO PRÉVIA (não é o usuário — uma checagem automática antes de você começar): falta uma informação que ` +
            `só o usuário sabe para prosseguir com segurança. Sua PRIMEIRA ação deve ser perguntar_usuario, com esta pergunta ` +
            `exata: "${ambiguidade.pergunta}"`,
        });
      }

      // Checkpoint automático 1/5 do Copiloto: ENTENDIMENTO (ver
      // criticaAutomatica acima). Só depois que verificarAmbiguidade já
      // confirmou que dá pra prosseguir — pedir uma segunda opinião sobre um
      // pedido que ainda vai gerar pergunta ao usuário não faz sentido.
      if (ambiguidade.suficiente && pipelineCompleto) {
        const observacaoEntendimento = await this.criticaAutomatica({
          fase: 'entendimento',
          objetivo,
          checklist: [],
          jaFeito: [],
          dossie: [],
          motivo: 'Confirmar se o pedido foi entendido corretamente antes de agir.',
        });
        if (observacaoEntendimento) {
          historico.push({
            role: 'user',
            content: `OBSERVAÇÃO DE UM REVISOR (não é o usuário — questione se faz sentido, mas não ignore sem motivo): ${observacaoEntendimento}`,
          });
        }
      }

      // Motor de pesquisa (motor-pesquisa.js): recomendação/comparação
      // ("qual o melhor X", "compare A e B") vira pesquisa planejada ANTES da
      // primeira decisão — o código roda as buscas por critério e por opção,
      // em vez de o modelo decidir uma busca de cada vez. As buscas feitas
      // contam no teto de buscas soltas (`buscasFeitas`): o modelo continua
      // podendo buscar algo específico que falte, só não refaz a pesquisa
      // inteira. Quando o motor completa, o checklist operacional de
      // `planejarInicial` (logo abaixo) não roda: o plano de pesquisa JÁ é o
      // plano, e um checklist genérico ("pesquisar", "comparar") só geraria
      // vetos de "item pendente" sobre trabalho já feito. Motor que não
      // completa (plano ilegível, nada encontrado) devolve o controle ao
      // caminho de sempre, com o que já tiver coletado.
      let pesquisaPlanejada = null;
      if (
        ambiguidade.suficiente &&
        this.config.motorDePesquisa !== false &&
        tools.get('pesquisar_e_ler', ferramentasDesativadasAtual) &&
        motorPesquisa.ehPedidoDeRecomendacao(objetivo, { rota: this.rota })
      ) {
        pesquisaPlanejada = await this.pesquisarComPlano({ objetivo, executarPasso, dossie, ctx });
        buscasFeitas += pesquisaPlanejada.buscas || 0;
        if (pesquisaPlanejada.ok) {
          historico.push({ role: 'user', content: pesquisaPlanejada.resumo });
        } else if (pesquisaPlanejada.modo === 'produto') {
          historico.push({
            role: 'user',
            content:
              `PESQUISA INICIAL (etapa automática, não é o usuário): ${pesquisaPlanejada.buscas} busca(s) sobre o ${pesquisaPlanejada.produto} não trouxeram página que cite o produto. ` +
              'Faça UMA ou DUAS buscas com outra grafia do nome (ou em inglês) e responda sobre ESSE produto; se não achar, diga que não encontrou. Não recomende outros produtos no lugar.',
          });
        } else if (pesquisaPlanejada.buscas && pesquisaPlanejada.modo === 'guia') {
          // revisão v3: guia sem dicas suficientes — nada de "descobrir nomes de modelo"
          historico.push({
            role: 'user',
            content:
              `PESQUISA INICIAL (etapa automática, não é o usuário): ${pesquisaPlanejada.buscas} busca(s) sobre ` +
              `${pesquisaPlanejada.tema || 'o tema'} já foram feitas e o material está guardado, mas trouxe poucas dicas com fonte. ` +
              'Se precisar, faça UMA ou DUAS buscas mais específicas sobre o tema (guias, tópicos de jogadores experientes) e responda com o que o material diz. ' +
              'Não pesquise produto nem equipamento.',
          });
        } else if (pesquisaPlanejada.buscas) {
          // 2º teste real (2026-09-24): sem os critérios aqui, o modelo seguiu
          // do zero — com o checklist genérico de 8 itens por cima — e
          // terminou lendo requisitos de hardware do PUBG e um site de
          // opções binárias, recomendando fone de cabeça num pedido de
          // intra-auricular.
          const p = pesquisaPlanejada.plano;
          historico.push({
            role: 'user',
            content:
              `PESQUISA INICIAL (etapa automática, não é o usuário): ${pesquisaPlanejada.buscas} busca(s) de descoberta já ` +
              `foram feitas e o material está guardado para a redação, mas não apontou opções concretas (nomes de modelo) o ` +
              `bastante para comparar. Uso: ${p?.uso || objetivo}. Critérios: ${(p?.criterios || []).map((k) => k.nome).join(', ')}. ` +
              `Próximo passo: descobrir NOMES DE MODELO recomendados para esse uso (listas de especialistas, fóruns), e depois ` +
              `pesquisá-los pelos critérios — com investigar_subtarefa. Não repita as buscas já feitas.`,
          });
        }
      }

      // Revisão v3 (Fase 1): pedido de explicação — método curto, dito ao
      // modelo uma vez, em vez de plano de 8 passos ("ler os mangás",
      // "entrevistas com o autor") e vetos
      if (ambiguidade.suficiente && tipoPedido.tipo === 'explicacao' && this.config.modoExplicacao !== false && !pipelineCompleto) {
        historico.push({
          role: 'user',
          content:
            'PEDIDO DE EXPLICAÇÃO (etapa automática, não é o usuário): faça de 1 a 3 buscas sobre o assunto, leia o que vier ' +
            'e chame "responder" assim que o material explicar o porquê/como. Não precisa de plano nem de ler a obra inteira.',
        });
      }

      // Planejamento inicial forçado (ver planejarInicial acima e
      // classificarPedido em verificador.js): só quando já sabemos que o
      // pedido tem informação suficiente (perguntar primeiro não faz
      // sentido junto com planejar) e o pipeline completo está valendo pra
      // este pedido (`pipelineCompleto` — universal por padrão, ou porque a
      // classificação determinística disse que este pedido precisa). O
      // resultado vira checklist ANTES da primeira iteração, então já
      // aparece como "SEU PLANO:" desde o passo 1 — não fica esperando o
      // modelo lembrar de propor um plano sozinho.
      // Com plano de pesquisa (mesmo sem opções encontradas), o checklist
      // genérico não roda: no 2º teste real ele gerou 8 itens e 3 vetos a
      // responder.
      if (ambiguidade.suficiente && pipelineCompleto && !pesquisaPlanejada?.plano) {
        const passosIniciais = await this.planejarInicial({
          objetivo,
          perguntas: classificacaoPedido.perguntas,
        });
        if (passosIniciais.length) {
          checklist = reconciliarChecklist(checklist, passosIniciais, null, { objetivo });
          tarefa.registrarPlano(passosIniciais, { status: 'ativo' });
          tarefa.atualizarSubtarefas(checklist);
          this.emit('checklist', checklist);
          this.emit('tarefa-atualizada', tarefa.serializar());
          this.emit('planejamento-inicial', { passos: passosIniciais });

          // Checkpoint automático 2/5 do Copiloto: PLANO INICIAL — revisa o
          // plano recém-gerado antes da primeira iteração de verdade rodar.
          const observacaoPlano = await this.criticaAutomatica({
            fase: 'plano-inicial',
            objetivo,
            checklist: passosIniciais.map((texto) => ({ texto, status: 'pendente' })),
            jaFeito: [],
            dossie: [],
            motivo: 'Revisar o plano antes de começar a executar.',
          });
          if (observacaoPlano) {
            historico.push({
              role: 'user',
              content: `OBSERVAÇÃO DE UM REVISOR (não é o usuário — questione se faz sentido, mas não ignore sem motivo): ${observacaoPlano}`,
            });
          }
        }
      }

      try {
        if (tarefa.estado === ESTADOS_TAREFA.PLANEJANDO) tarefa.transicionar(ESTADOS_TAREFA.EXECUTANDO, 'início do ciclo de ferramentas');
      } catch {
        /* estado auxiliar não pode interromper o agente */
      }

      while (this.rodando && this.iteracao < this.limiteDePassos()) {
        this.iteracao += 1;
        this.emit('iteracao', { n: this.iteracao, de: this.limiteDePassos() });
        this.emit('pensando', { n: this.iteracao });

        if (this.replanejamentoPendente && this.replanejamentosFeitos < MAX_REPLANEJAMENTOS) {
          const pendente = this.replanejamentoPendente;
          this.replanejamentoPendente = null;
          const novoPlano = await this.planejarNovamente({
            objetivo,
            checklist,
            motivo: pendente.motivo,
            estrategia: pendente.estrategia,
            acoes: tarefa.acoes,
          });
          if (novoPlano.length) {
            checklist = reconciliarChecklist([], novoPlano, null, { objetivo });
            tarefa.registrarPlano(novoPlano, { status: 'ativo', motivo: pendente.motivo });
            tarefa.atualizarSubtarefas(checklist);
            try {
              tarefa.transicionar(ESTADOS_TAREFA.PLANEJANDO, 'novo plano após falha da estratégia anterior');
              tarefa.transicionar(ESTADOS_TAREFA.EXECUTANDO, 'novo plano aceito');
            } catch {
              /* o loop continua mesmo se o estado auxiliar não puder avançar */
            }
            this.emit('replanejamento', { motivo: pendente.motivo, plano: novoPlano, numero: this.replanejamentosFeitos });
            this.emit('checklist', checklist);
            this.emit('tarefa-atualizada', tarefa.serializar());
          }
          this.replanejamentoCooldownAte = this.iteracao + 2;
        }

        // Consultar a memória exige uma chamada de embedding. Fazer isso a cada
        // passo custava 19 chamadas numa execução de 19 passos, sendo que o
        // pedido não muda entre elas.
        if (this.iteracao === 1 || this.iteracao % 4 === 0) {
          // Peça 3 ("memória curta"): escopa primeiro ao que já foi lido
          // NESTA conversa (idConversa) — só cai pro resto da pasta (de
          // sempre) se não achar nada aí. "alto"/"extremo" confiam menos num
          // item velho sem confirmar de novo (ver LIMITE_DIAS_MEMORIA_CURTA*).
          const cauteloso = this.config.nivelRaciocinio === 'alto' || this.config.nivelRaciocinio === 'extremo';
          // instrução injetada pelo próprio agente ("etapa automática") não é
          // assunto: na consulta, ela diluía a semelhança e a lembrança sumia
          const ultima = historico.at(-1)?.content || '';
          lembrancas = await memory.buscar(
            `${objetivo}\n${/etapa automática/.test(ultima) ? '' : ultima.slice(0, 800)}`,
            this.config.memoryTopK,
            {
              idConversa,
              frescorMaximoDias: cauteloso ? LIMITE_DIAS_MEMORIA_CURTA_CAUTELOSO : LIMITE_DIAS_MEMORIA_CURTA,
            }
          );
        }

        if (this.iteracao === 1) {
          // Grava o objetivo DEPOIS de já ter consultado a memória acima —
          // senão o próprio pedido atual, escrito aqui, contaminaria a busca
          // de relevância (a barreira de busca interna, logo abaixo,
          // dispararia sempre: acharia o pedido de agora "relevante" só
          // porque acabou de ser escrito nesta mesma execução).
          this.memorizar(memory, `Objetivo: ${objetivo}`, 'objetivo');
        }

        // Ordem importa para o cache de prefixo do Ollama: o que NÃO muda vem
        // primeiro. Memória e resumo mudam a cada iteração — colocá-los antes
        // do histórico invalidava tudo que vinha depois, a cada passo.
        const contexto = [{ role: 'system', content: sistema }, ...paraEnvio(historico)];

        // Estado do trabalho em forma de lista. O plano declarado era texto
        // solto: o modelo relia "pesquisar, comparar, responder" no passo 9 sem
        // saber em qual estava. Aqui ele vê o que já fez e o que falta — e cada
        // item carrega [x]/[~]/[ ], então um item marcado feito/pulado não
        // volta a aparecer como se nada tivesse acontecido.
        const situacao = [
          // Barreira de busca interna: só na 1ª iteração, e só quando a
          // memória desta pasta já tem algo relevante (mesmo piso de
          // relevância de sempre — ver `Memory.buscar()`). Não bloqueia
          // pesquisar_web, só pede pra considerar o que já existe primeiro —
          // reaproveita o que já foi calculado, zero chamada a mais.
          this.iteracao === 1 && lembrancas.length
            ? 'BARREIRA DE MEMÓRIA: antes de pesquisar na web, confira o que já está em MEMÓRIA RELEVANTE abaixo — já foi registrado num pedido anterior nesta pasta e pode responder o suficiente. Só pesquise se isso não bastar ou estiver desatualizado.'
            : '',
          jaFeito.length ? `JÁ FEITO: ${jaFeito.slice(-8).join(' · ')}` : '',
          checklist.length
            ? `SEU PLANO:\n${checklist
                .slice(-8)
                .map((i) => `${i.status === 'feito' ? '[x]' : i.status === 'pulado' ? '[~]' : '[ ]'} ${i.texto}`)
                .join('\n')}`
            : '',
          lacunas && lacunas.nivel !== 'boa' && lacunas.ausentes?.length
            ? `AINDA SEM COBERTURA NO MATERIAL: ${lacunas.ausentes.slice(0, 6).join(', ')}` +
              ' — busque especificamente por isto ou diga na resposta que não foi encontrado.'
            : '',
          lacunas && lacunas.nivel === 'boa' && ctx.estado.pesquisou && !this.faltaPaginaDeHistorico(objetivo, ctx)
            ? 'MATERIAL SUFICIENTE: os termos do pedido já aparecem no que foi lido. Chame responder.'
            : '',
          this.faltaPaginaDeHistorico(objetivo, ctx)
            ? `HISTÓRICO DE PREÇO: ainda não foi lida nenhuma página de histórico de ${serieDePrecos.produtosDoPedido(objetivo).map((p) => p.nome).join(' e ')}. Sites de acompanhamento de preço (ex.: hardwarebarato.com, gpuprix.com) trazem preço atual, mínimo e mediana de 12 meses — busque "${serieDePrecos.produtosDoPedido(objetivo)[0]?.nome || ''} histórico de preço".`
            : '',
        ].filter(Boolean);

        // Caso real (log de 06/09, achado ao vivo): o item
        // guardado é o texto CRU de um passo antigo — no formato
        // "Passo N — ferramenta(...) → resultado", o MESMO formato de um
        // passo ATUAL — e sem data nem aviso nenhum de que é história. Um
        // modelo pequeno lendo isso sob um título genérico não distingue
        // "isto já aconteceu, é só referência" de "continue daqui": ele
        // pegou uma consulta de frete de verdade (preço + CEP numa loja
        // online) de uma tarefa de dias atrás e retomou como se estivesse no
        // meio dela agora, numa pergunta completamente sem relação — chegou
        // a chamar `navegar` pra a mesma URL de novo. Cada item agora carrega
        // a data, e o título deixa explícito que é passado, não o passo atual.
        const volatil = [
          situacao.length ? `SITUAÇÃO:\n${situacao.join('\n')}` : '',
          lembrancas.length
            ? `MEMÓRIA RELEVANTE (de tarefas PASSADAS nesta pasta — não é o passo atual; use só como referência, não retome nem repita as ações citadas):\n${lembrancas
                .map((l) => `- [${new Date(l.em).toLocaleDateString('pt-BR')}] ${l.texto}`)
                .join('\n')}`
            : '',
          resumo ? `RESUMO DO QUE JÁ ACONTECEU:\n${resumo}` : '',
          `MODELO EXPLÍCITO DA TAREFA (estado atual; o objetivo original fica preservado apenas para auditoria):\n${tarefa.resumo(
            3600,
            { incluirObjetivoOriginal: false }
          )}`,
        ].filter(Boolean);

        if (volatil.length) contexto.push({ role: 'system', content: volatil.join('\n\n') });
        // Controlador v2: o prompt inteiro cabe na janela (ver caberNaJanela)
        const ajuste = caberNaJanela({
          sistema,
          historico,
          volatil,
          numCtx: this.numCtxDe('decisao'),
          reserva: Math.min(this.config.numPredict || 1024, 600),
          razao: this.razaoCharsPorToken || 2.8,
        });
        contexto.length = 0;
        contexto.push(...ajuste.mensagens);
        if (ajuste.cortes.length) this.emit('contexto-ajustado', { n: this.iteracao, cortes: ajuste.cortes, estimativaTokens: ajuste.estimativaTokens, orcamentoTokens: ajuste.orcamentoTokens });
        if (ajuste.estourou) this.emit('contexto-saturado', { n: this.iteracao, estimativaTokens: ajuste.estimativaTokens, numCtx: this.numCtxDe('decisao'), antesDeEnviar: true });

        this.emit('chamada', { tipo: 'decisao' });
        const ativas = tools.ativas(ferramentasDesativadasAtual);
        const resposta = await ollama.chat({
          host: this.config.host,
          model: this.modeloDe('decisao'),
          messages: contexto,
          json: true,
          esquema: this.config.usarEsquema === false ? null : protocolo.esquemaDeDecisao(ativas),
          temperature: this.config.temperature,
          numCtx: this.numCtxDe('decisao'),
          // revisão v3: o campo de config agora vale (antes 1024 fixo do ollama.js)
          numPredict: this.config.numPredict || 1024,
          // Caso real (DeepSeek R1 8B numa prova de 10 questões):
          // "dificuldade em seguir o protocolo" repetida — plausível que o
          // hábito do modelo de raciocinar antes de responder entre em
          // conflito com a decodificação restrita por gramática (esquema),
          // que espera o JSON já na primeira posição. Decisão é sempre
          // formato rígido — não há "pensar alto" útil aqui que valha o
          // risco de quebrar o protocolo; a rede de segurança em
          // `ollama.semBlocoDePensamento` cobre o resto caso ainda vaze.
          pensar: false,
          signal: this.controller.signal,
        });

        if (resposta.contextoReduzido) {
          this.avisarContextoReduzido('decisão', resposta.contextoReduzido);
          // a contagem REAL do prompt recusado recalibra caracteres/token, para
          // o caberNaJanela da próxima iteração já montar um prompt que cabe
          // (sem isto o 400 e o corte se repetiam a cada passo)
          const tokensPedido = resposta.contextoReduzido.tokensPedido;
          const caracteresOriginais = contexto.reduce((n, m) => n + String(m.content).length, 0);
          if (tokensPedido > 0 && caracteresOriginais > 0) {
            this.razaoCharsPorToken = Math.min(this.razaoCharsPorToken || 2.8, Math.max(1.6, (caracteresOriginais / tokensPedido) * 0.95));
          }
        }
        this.uso.prompt += resposta.promptTokens;
        this.uso.completion += resposta.completionTokens;
        this.emit('uso', { ...this.uso, ultimaDuracaoMs: resposta.durationMs });
        // Pedido de Davi 2026-09-23 (detalhamento por fase pra nova janela
        // "Visualizar Execuções"): esta chamada de decisão já atualiza
        // `this.uso`/emite 'uso' na mão (não passa por `contabilizar()`,
        // porque precisa do `ultimaDuracaoMs` acima, que `contabilizar()` não
        // carrega) — então só o evento granular novo é emitido aqui direto,
        // mesmo formato que `contabilizar()` usa nos outros ~10 pontos de
        // chamada, sem duplicar a contagem cumulativa.
        if (resposta.promptTokens || resposta.completionTokens) {
          this.emit('uso-chamada', {
            tipo: 'decisao',
            promptTokens: resposta.promptTokens,
            completionTokens: resposta.completionTokens,
            duracaoMs: resposta.durationMs ?? null,
          });
        }
        // Item 2 da análise comparativa (2026-09-21, "indicador de uso de
        // contexto", inspirado no medidor de % do deer-flow): `this.uso` é
        // CUMULATIVO (soma de toda chamada da execução — decisão, crítica,
        // destilação — cada uma com sua própria janela), não serve pra medir
        // "quão cheio está o contexto agora". `resposta.promptTokens` desta
        // chamada específica é o dado exato (prompt_eval_count do Ollama, a
        // avaliação real do prompt que acabou de ser montado) contra a
        // janela configurada pra decisão — sinal exato, sem custo extra
        // (não é estimativa por caractere, diferente do `chars()/3.5` usado
        // como heurística interna de compactação mais abaixo).
        const numCtxDecisao = this.numCtxDe('decisao');
        // Controlador v2: calibra caracteres/token com a contagem real; prompt
        // no teto da janela = o Ollama cortou (vira incidente no registro)
        if (resposta.promptTokens && numCtxDecisao) {
          const caracteres = contexto.reduce((n, m) => n + String(m.content).length, 0);
          const cal = calibrarRazao(this.razaoCharsPorToken, caracteres, resposta.promptTokens, numCtxDecisao);
          this.razaoCharsPorToken = cal.razao;
          if (cal.saturado) this.emit('contexto-saturado', { n: this.iteracao, promptTokens: resposta.promptTokens, numCtx: numCtxDecisao });
        }
        this.emit('janela-contexto', {
          promptTokens: resposta.promptTokens,
          numCtx: numCtxDecisao,
          percentual: numCtxDecisao ? Math.min(100, Math.round((resposta.promptTokens / numCtxDecisao) * 100)) : null,
        });

        const veredicto = protocolo.analisar(resposta.content, {
          catalogo: ativas,
          obterFerramenta: (n) => tools.get(n, ferramentasDesativadasAtual),
          urlsVistas: ctx.estado.urlsVistas || new Set(),
        });

        if (veredicto.estado !== protocolo.ESTADOS.OK) {
          eventoParaCritico = eventoParaCritico || 'protocolo-invalido';
          this.emit('protocolo-invalido', {
            estado: veredicto.estado,
            motivo: veredicto.motivo,
            bruto: String(resposta.content).slice(0, 600),
          });

          // A resposta defeituosa NÃO volta ao histórico: relê-la no próximo
          // turno ensina o modelo a repetir o erro. Só a correção entra.
          historico.push({ role: 'user', content: veredicto.instrucao });

          falhasSeguidas += 1;
          if (falhasSeguidas >= 4) {
            // Caso real de produção (prova de 6 questões, 12/09): o gate de
            // checklist (acima) barrou um "responder" prematuro corretamente
            // — o modelo, tentando obedecer, passou a chamar pesquisar_e_ler
            // sem o argumento "consulta" 4 vezes seguidas, e isto aqui
            // simplesmente desistia: erro fatal, resposta vazia, nada do que
            // já tinha sido pesquisado chegava ao usuário. Pior do que
            // responder incompleto. Em vez de jogar tudo fora, encerramos
            // como qualquer outra desistência "de boa fé" no resto do
            // arquivo (limite de iterações, teto de busca): redige com o
            // dossiê que já existe (mesmo vazio) e deixa claro na própria
            // resposta que o modelo não seguiu o protocolo — quem lê ainda
            // fica sabendo que vale trocar de modelo, só que com uma
            // resposta na mão em vez de nenhuma.
            this.emit('aviso', {
              texto: `O modelo não conseguiu seguir o protocolo (${veredicto.motivo}) — encerrando com o material já reunido.`,
            });
            // Achado pelo Davi na UI (2026-09-20): depois dessa desistência,
            // o painel "Progresso" ficava com os itens do checklist travados
            // pra sempre no círculo vazio de "pendente" — nem risco de
            // "pulado" nem marca de "feito". Motivo: só o gate normal de
            // responder/concluir (mais abaixo, perto de
            // `vetosChecklistFeitos`) resolve os itens pendentes antes de
            // chamar `finalizarComResposta`; esta saída de emergência
            // pulava esse gate inteiro e ia direto pra redação. 'pulado' (e
            // não 'feito') porque a execução está desistindo por FALHA do
            // modelo, não entregando o item de verdade — mesmo status que
            // `reconciliarChecklist` já usa pra "ação negada/falhou".
            if (checklist.some((i) => i.status === 'pendente')) {
              checklist = checklist.map((i) => (i.status === 'pendente' ? { ...i, status: 'pulado' } : i));
              tarefa.atualizarSubtarefas(checklist);
              this.emit('checklist', checklist);
              this.emit('tarefa-atualizada', tarefa.serializar());
            }
            const final = await this.finalizarComResposta({
              objetivo, conversa, dossie, ctx, memory,
              saida: '',
              forcarRedacao: true,
              buscasFeitas, tetoDeBuscas, executarPasso,
              notaFinal:
                '*(Aviso: o modelo teve dificuldade em seguir o protocolo de ferramentas durante esta execução — ' +
                'se isso se repetir, considere um modelo maior, como qwen2.5:7b ou llama3.1:8b.)*',
            });
            return { ok: true, resumo: final };
          }
          continue;
        }

        const plano = veredicto.decisao;
        if (veredicto.recuperado) {
          this.emit('protocolo-recuperado', { via: veredicto.recuperado, ferramenta: plano.ferramenta.nome });
        }

        const nome = plano.ferramenta.nome;
        const argumentos = plano.ferramenta.argumentos || {};

        if (Array.isArray(plano.plano) && plano.plano.length) {
          const checklistAntes = checklist;
          const abandonoEmMassaPermitido = abandonoChecklistPermitido;
          abandonoChecklistPermitido = false;
          checklist = reconciliarChecklist(checklist, plano.plano, ultimaAcaoOk, { abandonoEmMassaPermitido, objetivo });
          if (!tarefa.planos.length) tarefa.registrarPlano(plano.plano, { status: 'ativo' });
          tarefa.atualizarSubtarefas(checklist);
          this.emit('checklist', checklist);
          this.emit('tarefa-atualizada', tarefa.serializar());

          // Checkpoint automático 4/5 do Copiloto: CADA PARTE CONCLUÍDA.
          // reconciliarChecklist não tem sintaxe explícita de "concluir" — um
          // item vira "feito" (ou "pulado") só quando o modelo PARA de
          // redeclará-lo numa próxima decisão (ver a função, mais acima). Por
          // isso o jeito de detectar "uma parte acabou de ser concluída" é
          // comparar por texto: pendente ANTES desta reconciliação e feito
          // DEPOIS dela. "pulado" fica de fora de propósito — não é
          // conclusão, é desistência, revisar isso não ajuda o agente a
          // seguir em frente.
          let observacaoParteMaisRecente = '';
          if (pipelineCompleto) {
            const pendentesAntes = new Set(checklistAntes.filter((i) => i.status === 'pendente').map((i) => i.texto));
            const concluidosAgora = checklist.filter((i) => i.status === 'feito' && pendentesAntes.has(i.texto));
            const jaFeito = checklist.filter((i) => i.status === 'feito').map((i) => i.texto);
            for (const item of concluidosAgora) {
              // eslint-disable-next-line no-await-in-loop -- item a item, de propósito: cada checkpoint usa o checklist/dossiê já atualizado pelo anterior
              const observacaoParte = await this.criticaAutomatica({
                fase: 'parte-concluida',
                objetivo,
                checklist,
                jaFeito,
                dossie,
                motivo: `Confirmar se esta parte do pedido foi resolvida corretamente: "${item.texto}"`,
              });
              if (observacaoParte) {
                historico.push({
                  role: 'user',
                  content: `OBSERVAÇÃO DE UM REVISOR (não é o usuário — questione se faz sentido, mas não ignore sem motivo): ${observacaoParte}`,
                });
                observacaoParteMaisRecente = observacaoParte;
              }
            }
          }

          // Peça 2 (nivelRaciocinio): reseleciona skill quando o FOCO (primeiro
          // item pendente) muda de texto — roda em TODO nível, inclusive "leve"
          // (só a reseleção determinística, zero custo extra); ver
          // reselecionarSkillsPorSubtarefa mais acima pro que cada nível soma.
          // Checklist totalmente concluído (nenhum pendente) não reseleciona —
          // a execução está indo pra redação, não faz sentido trocar skill agora.
          const novoFoco = checklist.find((i) => i.status === 'pendente')?.texto;
          if (novoFoco && novoFoco !== focoSkillAtual) {
            focoSkillAtual = novoFoco;
            skillsDecisao = await this.reselecionarSkillsPorSubtarefa({
              foco: novoFoco,
              observacao: observacaoParteMaisRecente,
            });
            this.skillsDecisao = skillsDecisao;
            // Item 3: a combinação de skills mudou, então a lista efetiva de
            // ferramentas bloqueadas por elas pode ter mudado junto — mesma
            // regra de unanimidade, recalculada do zero pra este novo foco.
            ferramentasDesativadasAtual = this.ferramentasDesativadasParaSkills(skillsDecisao);
            sistema = montarSistema(skillsDecisao);
            if (skillsDecisao.length) {
              this.emit('skills', { etapa: 'decisao', nomes: skillsDecisao.map((s) => s.nome) });
            }
          }
        }

        // Subagente crítico (crítica periódica do plano): a cada N passos, ou
        // quando duas falhas seguidas sugerem que o caminho não está
        // funcionando — nunca mais que CRITICA_PERIODICA_MAX vezes por
        // execução. Não bloqueia esta rodada: a observação (se houver) só
        // entra no histórico para a PRÓXIMA decisão considerar.
        //
        // `this.iteracao === 2` adianta a PRIMEIRA crítica pro logo depois da
        // primeira ação (em vez de só na 5ª) — sem gastar chamada a mais no
        // total (mesmo teto CRITICA_PERIODICA_MAX): um plano errado desde o
        // início, mas sem nenhuma ferramenta "falhando" de verdade, antes
        // rodava solto por 4 rodadas até a crítica de N em N passos pegar.
        // Pipeline completo valendo pra este pedido (`pipelineCompleto` —
        // universal por padrão, ou pedido classificado como complexo, ver
        // classificacaoPedido acima): teto e intervalo mais generosos —
        // combinado com o Davi, custo/tempo não é o que se está otimizando
        // aqui, volatilidade é.
        // revisão v3 (Fase 1): explicação simples não tem crítico periódico
        const maxCritica = this.tipoDoPedido === 'explicacao' && this.config.modoExplicacao !== false && !pipelineCompleto
          ? 0
          : pipelineCompleto
          ? this.config.criticaPeriodicaMaxComplexo ?? CRITICA_PERIODICA_MAX_COMPLEXO
          : this.config.criticaPeriodicaMax ?? CRITICA_PERIODICA_MAX;
        const intervaloCritica = pipelineCompleto
          ? this.config.criticaPeriodicaIntervaloComplexo ?? CRITICA_PERIODICA_INTERVALO_COMPLEXO
          : this.config.criticaPeriodicaIntervalo ?? CRITICA_PERIODICA_INTERVALO;
        // Controlador v2 (05/10): no modo 'evento', a crítica periódica só roda
        // quando algo deu errado desde a última (erro de ferramenta, ação
        // repetida barrada, página que não muda, falha de protocolo) — em vez
        // de a cada passo (17–23 chamadas ao 3B por execução, ~3–4 min)
        const porEvento = this.config.criticaPeriodicaModo === 'evento';
        if (
          !this.replanejamentoPendente &&
          this.iteracao >= this.replanejamentoCooldownAte &&
          criticasDoPlanoFeitas < maxCritica &&
          (porEvento
            ? Boolean(eventoParaCritico)
            : (criticasDoPlanoFeitas === 0 && this.iteracao >= 2) || this.iteracao % intervaloCritica === 0 || falhasSeguidas >= 2)
        ) {
          if (porEvento) this.emit('critica-por-evento', { n: this.iteracao, evento: eventoParaCritico });
          eventoParaCritico = null;
          criticasDoPlanoFeitas += 1;
          const observacao = await this.criticaDoPlano({ objetivo, checklist, jaFeito, dossie });
          if (observacao) {
            this.emit('critica-plano', { n: this.iteracao, texto: observacao });
            historico.push({
              role: 'user',
              content: `OBSERVAÇÃO DE UM REVISOR (não é o usuário — questione se faz sentido, mas não ignore sem motivo): ${observacao}`,
            });
          }
        }

        // 2ª revisão: valor que vai pra um campo de senha vira segredo ANTES
        // do evento 'raciocinio' (o pensamento do modelo pode citá-lo)
        this.registrarSegredoDaAcao(plano?.ferramenta?.nome, plano?.ferramenta?.argumentos, ctx.estado.pagina);
        this.emit('raciocinio', {
          n: this.iteracao,
          pensamento: plano.pensamento || '',
          raciocinio: plano.raciocinio || '',
          plano: Array.isArray(plano.plano) ? plano.plano : [],
          critica: plano.critica || '',
        });

        const ferramenta = veredicto.ferramenta;

        // Perguntar antes de pesquisar é o erro mais caro do modelo pequeno:
        // custa uma rodada inteira e devolve ao usuário o trabalho que era do agente.
        // Exceção estreita: a verificação de ambiguidade RODOU antes da primeira
        // decisão e já concluiu que falta algo que só o usuário sabe — nesse caso
        // (e só nesse: iteração 1, só quando a verificação apontou a falta) a
        // pergunta é legítima, não preguiça. O modelo decidindo perguntar por
        // conta própria, sem essa validação prévia, continua barrado como antes.
        const perguntaPreValidada = !ambiguidade.suficiente && this.iteracao === 1;
        // Backlog do Copiloto, item m3 (generalizar o padrão "crítico que
        // bloqueia"): este gate é anterior aos 4 unificados no item m1
        // (vetoDoCopiloto()) — mesmo sintoma conhecido (bloquear um erro
        // determinístico do modelo pequeno e reorientar), mas ainda era um
        // bloco solto a mais no loop, sem passar pelo helper comum nem contar
        // pro total de intervenções do copiloto. Migrado sem mudar nem a
        // mensagem de erro nem a instrução — só a estrutura.
        if (nome === 'perguntar_usuario' && this.iteracao <= 2 && !ctx.estado.pesquisou && !perguntaPreValidada) {
          this.vetoDoCopiloto({
            gate: 'pergunta-prematura',
            nome,
            plano,
            erro: 'Pergunta prematura: pesquise primeiro e só pergunte se algo continuar impossível de descobrir sozinho.',
            instrucao:
              'Não pergunte ao usuário antes de tentar. O pedido já é claro o suficiente para começar. ' +
              'Escolha agora uma ferramenta de pesquisa ou de leitura e faça o trabalho.',
            historico,
          });
          continue;
        }

        // Revisão v4 (Bose, 06/10): "Você gostaria de saber sobre as
        // especificações, os preços, as avaliações…?" — pergunta-cardápio
        // depois de uma busca, com o pedido já claro. Davi levou 7 min pra
        // responder (quase metade da execução). Uma vez: cubra os pontos.
        if (
          nome === 'perguntar_usuario' && ambiguidade.suficiente !== false && !vetouPerguntaCardapio &&
          /\b(gostaria de saber|quer saber|deseja saber|prefere|tem interesse|interessad[oa])\b/i.test(String(argumentos.pergunta || '')) &&
          /,|\bou\b/.test(String(argumentos.pergunta || ''))
        ) {
          vetouPerguntaCardapio = true;
          this.vetoDoCopiloto({
            gate: 'pergunta-cardapio',
            nome,
            plano,
            erro: 'Pergunta-cardápio: o pedido já é claro; não pergunte o que o usuário quer saber.',
            instrucao:
              'O pedido já basta. Em vez de perguntar qual aspecto interessa, cubra os principais na resposta ' +
              '(os que você listou na pergunta). Continue pesquisando ou chame responder.',
            historico,
          });
          continue;
        }

        // Caso real de produção (v0.5.7, teste ao vivo): "Crie um
        // pdf com um resumo sobre baterias de íon-lítio" — a busca não achou
        // material específico e o modelo, já na primeira iteração, chamou
        // `responder` direto, sem NUNCA tentar gerar_pdf. O prompt (regra 6b em
        // prompts.js) já avisa pra nunca terminar em "responder" quando o pedido
        // é por arquivo, mas é uma frase entre outras nove — um modelo pequeno
        // nem sempre repara. Trava determinística: só deixa `responder` passar
        // se o pedido não pedia arquivo, ou se algum gerar_*/escrever_arquivo já
        // foi ao menos TENTADO (mesmo com erro — não trava pra sempre se a
        // geração falhar de verdade e o modelo precisar explicar isso ao usuário).
        if (
          nome === 'responder' &&
          !ctx.estado.escreveu &&
          !ctx.estado.tentouGerarArquivo &&
          pedidoQuerArquivo(objetivo)
        ) {
          this.vetoDoCopiloto({
            gate: 'pedido-de-arquivo',
            nome,
            plano,
            erro: 'O pedido pede um arquivo (pdf/docx/xlsx/html) — "responder" só no chat não cumpre isso.',
            instrucao:
              'O pedido pede um arquivo. Chame agora a ferramenta gerar_pdf/gerar_docx/gerar_xlsx/gerar_html ' +
              'correspondente, com o conteúdo que você já sabe ou já coletou — a pesquisa é só apoio opcional, ' +
              'falta dela não é motivo pra pular a geração do arquivo. Só depois disso "responder" ou "concluir" fazem sentido.',
            historico,
          });
          continue;
        }

        // Caso real de produção (bateria de testes com o Davi, pedido de 6
        // questões de teoria de CC): o plano forçado (`planejarInicial`)
        // cria o checklist certinho, mas nada impedia o modelo de chamar
        // responder/concluir com a maior parte dos itens ainda pendentes —
        // pesquisou só a primeira questão (2 buscas), decidiu que já estava
        // pronto, e a resposta final girou inteira em torno do mesmo
        // assunto, nunca tocando nas outras 5. A verificação pega isso
        // DEPOIS (`respondeAoPedido: false`), mas por essa altura só resta
        // reescrever com o material que já existe — não há como voltar a
        // pesquisar o que faltou a essa altura. Mais barato barrar ANTES:
        // só pra pedidos com o pipeline completo valendo (`pipelineCompleto`
        // — universal por padrão, ou pedido classificado como complexo, onde
        // existe checklist forçado — ver classificacaoPedido/planejarInicial
        // acima), se ainda há item "pendente" quando o modelo tenta
        // encerrar, devolve ao loop com um aviso do que falta. Um item some
        // do checklist sozinho (vira "feito"/"pulado") assim que o modelo
        // parar de redeclará-lo em `plano` numa próxima decisão — não
        // precisa de sintaxe especial pra "pular", só seguir em frente.
        // Teto (`ITENS_PENDENTES_MAX_VETOS`) pra não travar se o modelo
        // insistir errado ou algum item for genuinamente impossível —
        // depois disso deixa passar mesmo incompleto, mesmo padrão de
        // "falha após N tentativas" já usado no resto do arquivo.
        // 3 → 1 (300 execuções reais, 11/10): das 98 com este veto, 72 gastaram
        // os 3; um terço dos itens seguia pendente no fim e a verificação não
        // saía melhor que nas execuções sem veto — só mais lenta (~85 s de
        // ferramenta depois do 1º veto). Um lembrete basta; o que faltar vai
        // dito na resposta.
        const ITENS_PENDENTES_MAX_VETOS = 1;
        //
        // Teto próprio (`TAREFA_ESTADO_MAX_VETOS`) pro gate logo abaixo —
        // achado revisando o sistema de Tarefa (2026-09-17): diferente de
        // TODOS os outros gates deste arquivo, este não tinha teto nenhum, e
        // `TRANSICOES[BLOQUEADA]` (tarefa.js) é um conjunto vazio — nenhuma
        // ação sai desse estado sozinha. Resultado: se o crítico algum dia
        // sinalizar "bloquear" (protocolo estruturado, ver
        // aplicarRecomendacaoCritico), TODO `responder`/`concluir` seguinte
        // era vetado pra sempre, mesmo a instrução dizendo pro modelo
        // "informe o bloqueio ao usuário" — contraditório, já que informar o
        // usuário É via responder, a própria ferramenta bloqueada. A
        // execução só parava ao esgotar o teto de iterações da execução
        // inteira (`maxIterations`), sem nunca entregar nada. Mesmo padrão
        // dos outros tetos: dá 2 chances pro modelo tentar
        // perguntar_usuario/outra estratégia, depois deixa passar — melhor
        // uma resposta imperfeita (ou reconhecendo o bloqueio) do que
        // nenhuma resposta.
        const TAREFA_ESTADO_MAX_VETOS = 2;
        if (
          (nome === 'responder' || nome === 'concluir') &&
          [ESTADOS_TAREFA.AGUARDANDO_USUARIO, ESTADOS_TAREFA.BLOQUEADA].includes(tarefa.estado) &&
          vetosTarefaEstadoFeitos < TAREFA_ESTADO_MAX_VETOS &&
          vetosDeResposta < ORCAMENTO_VETOS_DE_RESPOSTA
        ) {
          vetosTarefaEstadoFeitos += 1;
          vetosDeResposta += 1;
          const motivo = tarefa.estado === ESTADOS_TAREFA.AGUARDANDO_USUARIO
            ? 'O crítico indicou que falta uma informação do usuário antes de concluir.'
            : 'O crítico bloqueou a conclusão por inconsistência ou risco.';
          this.vetoDoCopiloto({
            gate: `tarefa-${tarefa.estado}`,
            nome,
            plano,
            erro: motivo,
            instrucao: tarefa.estado === ESTADOS_TAREFA.AGUARDANDO_USUARIO
              ? 'Use perguntar_usuario para solicitar a informação faltante antes de concluir.'
              : 'Não conclua ainda: tente uma alternativa mais segura primeiro. Se não houver uma, na próxima chamada de responder explique claramente ao usuário por que o pedido não pôde ser concluído.',
            historico,
          });
          continue;
        }
        // Item com ferramenta própria (gráfico, planilha...) não precisa de
        // mais busca: continua valendo mesmo com o teto de buscas atingido ou
        // com a pesquisa planejada pronta (contrato de conclusão, 2026-09-27).
        if (nome === 'responder' || nome === 'concluir') this.montarSerieDePrecos(objetivo, ctx);
        const itensDeFerramenta = checklist.filter(
          (i) => i.status === 'pendente' && ferramentaDoItem(i.texto) && !itemDeFerramentaCumprido(i.texto, ctx)
        );
        const gateCompleto = buscasFeitas < tetoDeBuscas && !this.planoDeResposta;
        if (nome === 'responder' || nome === 'concluir') {
          // o que a resposta final vai conferir (itensNaoCumpridos)
          ctx.estado.itensDeFerramenta = [
            ...new Set([...(ctx.estado.itensDeFerramenta || []), ...checklist.filter((i) => ferramentaDoItem(i.texto)).map((i) => i.texto)]),
          ];
        }
        if (
          (nome === 'responder' || nome === 'concluir') &&
          pipelineCompleto &&
          vetosChecklistFeitos < ITENS_PENDENTES_MAX_VETOS &&
          vetosDeResposta < ORCAMENTO_VETOS_DE_RESPOSTA &&
          // item pendente não pode exigir trabalho que não dá mais pra fazer:
          // com o teto de buscas atingido, vetar responder só gira em falso
          // (9º teste real: 3 vetos + 3 buscas barradas, nada mudou na resposta)
          // — a não ser item que uma ferramenta resolve sem buscar (acima).
          // Com a pesquisa planejada pronta, o plano da resposta já diz o que
          // falta; item que o modelo declarou depois dela não trava a entrega.
          (gateCompleto || itensDeFerramenta.length)
        ) {
          const pendentes = checklist.filter((i) => i.status === 'pendente');
          // Item sobre ENTREGAR a resposta (ver ehItemDeEntregaFinal acima)
          // não bloqueia: é exatamente o que esta chamada de
          // responder/concluir está prestes a fazer. Separado ANTES de
          // decidir vetar, pra não contar como "pendente real" nem entrar na
          // mensagem de aviso pro modelo.
          // item de ferramenta já cumprido (gráfico da série de preços, p.ex.)
          // não bloqueia — e fica marcado como feito
          if (pendentes.some((i) => ferramentaDoItem(i.texto) && itemDeFerramentaCumprido(i.texto, ctx))) {
            checklist = checklist.map((i) =>
              i.status === 'pendente' && ferramentaDoItem(i.texto) && itemDeFerramentaCumprido(i.texto, ctx) ? { ...i, status: 'feito' } : i
            );
            tarefa.atualizarSubtarefas(checklist);
            this.emit('checklist', checklist);
          }
          const bloqueantes = gateCompleto
            ? pendentes.filter((i) => !ehItemDeEntregaFinal(i.texto) && !(ferramentaDoItem(i.texto) && itemDeFerramentaCumprido(i.texto, ctx)))
            : itensDeFerramenta;
          if (bloqueantes.length) {
            vetosChecklistFeitos += 1;
            vetosDeResposta += 1;
            // o aviso diz QUAL ferramenta cumpre cada item que tem uma
            const comoResolver = bloqueantes
              .filter((i) => ferramentaDoItem(i.texto))
              .map((i) => `para "${i.texto}", chame ${ferramentaDoItem(i.texto)} com os números que você já coletou (não pesquise de novo)`);
            this.vetoDoCopiloto({
              gate: 'checklist-pendente',
              nome,
              plano,
              erro: `Seu plano ainda tem ${bloqueantes.length} item(ns) pendente(s) — não é hora de encerrar.`,
              instrucao:
                `Seu plano ainda tem itens pendentes: ${bloqueantes
                  .map((i) => `"${i.texto}"`)
                  .join(', ')}. ${comoResolver.length ? `${comoResolver.join('; ')}. ` : ''}Resolva-os (pesquise, leia, o que for preciso) antes de chamar ` +
                'responder/concluir — não encerre com o pedido só parcialmente coberto.',
              historico,
            });
            abandonoChecklistPermitido = true;
            continue;
          }
          // Só sobraram itens de entrega final (ou nenhum pendente): a
          // própria chamada de responder/concluir, liberada agora, é quem os
          // resolve — marca antes de seguir, pra não deixar "pendente"
          // pendurado no checklist depois da execução terminar.
          if (pendentes.length) {
            checklist = checklist.map((i) =>
              i.status === 'pendente' ? { ...i, status: 'feito' } : i
            );
            tarefa.atualizarSubtarefas(checklist);
            this.emit('checklist', checklist);
            this.emit('tarefa-atualizada', tarefa.serializar());
          }
        }

        // Design gap registrado na rodada de 09/14/15 (bateria de 7 questões
        // de matemática): o checkpoint 4/4 do Copiloto ("antes de redigir",
        // dentro de finalizarComResposta) já existia, mas era só consultivo
        // — a observação entrava como sugestão no `foco` da redação, e o
        // modelo de redação (local, pequeno) podia ignorar, como aconteceu
        // naquele caso (dossiê só com tutoriais genéricos, resposta virou um
        // mosaico deles). Pedido de Davi (2026-09-15): tornar bloqueante,
        // mesmo padrão do gate de checklist acima.
        //
        // Roda a MESMA consulta que finalizarComResposta faria depois — mas
        // aqui, ANTES do "responder" ser aceito, ainda dá pra vetar e mandar
        // pesquisar mais (finalizarComResposta não tem mais como fazer isso:
        // o histórico de decisão já acabou). O resultado fica guardado em
        // `ctx.estado` pra finalizarComResposta REAPROVEITAR em vez de
        // consultar o crítico de novo pela mesma resposta (dobraria o custo
        // do caso comum, em que o material já está bom).
        //
        // O crítico bloqueia com o sinal EXPLÍCITO ("MATERIAL INSUFICIENTE"
        // — instrução própria no prompt desta fase, ver pedidoDeCriticaAutomatica
        // em prompts.js) OU com a recomendação ESTRUTURADA (status "bloquear"/
        // "perguntar" — mesmo protocolo JSON que aplicarRecomendacaoCritico já
        // usa, ver extrairRecomendacaoCritico/this.ultimaRecomendacaoCritico
        // acima) OU com uma conclusão negativa equivalente em texto livre.
        //
        // Caso real de produção (Davi, "Qual o papel da IA no enfrentamento de
        // desafios globais...", 2026-09-15, conversa mu31qm60-bud6l/execução
        // mu31k022-5r15): o crítico (qwen2.5:7b) concluiu corretamente que o
        // material "não resolve completamente o pedido original" e "não é
        // diretamente relevante para o objetivo original" — SEM usar a marca
        // literal "MATERIAL INSUFICIENTE" e sem seguir o formato JSON — e o
        // gate (só regex ^material insuficiente) deixou passar. A resposta
        // final saiu uma alucinação completa (diálogo fictício "Você:/
        // Sistema:"), só pega depois pelo verificador pós-hoc, tarde demais.
        // INDICA_MATERIAL_INSUFICIENTE complementa a marca literal com essas
        // conclusões equivalentes mais comuns num modelo pequeno.
        const PRE_REDACAO_MAX_VETOS = 2;
        const MARCA_MATERIAL_INSUFICIENTE = /^material insuficiente[:\s-]*/i;
        const INDICA_MATERIAL_INSUFICIENTE =
          /n[aã]o\s+(resolve|responde(\s+bem)?|cobre)\s+(completamente\s+)?o\s+pedido|n[aã]o\s+(é|parece\s+ser)\s+(diretamente\s+)?relevante\s+(para|ao)\s+o\s+objetivo|material\s+(coletado\s+)?(insuficiente|inadequado)|faltam?\s+(detalhes|informaç(ão|ões))\s+(específic\w+|relevantes)\s+(sobre|para)/i;
        if (
          nome === 'responder' &&
          pipelineCompleto &&
          !checklist.some((i) => i.status === 'pendente') &&
          !ctx.estado.preRedacaoJaChecada &&
          vetosPreRedacaoFeitos < PRE_REDACAO_MAX_VETOS &&
          vetosDeResposta < ORCAMENTO_VETOS_DE_RESPOSTA
        ) {
          const observacaoPreRedacao = await this.criticaAutomatica({
            fase: 'pre-redacao',
            objetivo,
            checklist: [],
            jaFeito,
            dossie,
            motivo: 'Revisar se o material coletado realmente resolve o pedido antes de redigir a resposta final.',
          });
          // this.ultimaRecomendacaoCritico foi setado (se houver) DENTRO da
          // chamada a criticaAutomatica logo acima — reflete exatamente esta
          // consulta, sem risco de misturar com outra fase (execução síncrona,
          // sem chamadas concorrentes ao crítico).
          const recomendacao = this.ultimaRecomendacaoCritico;
          const sinalizadoPorStatus =
            recomendacao && ['bloquear', 'perguntar'].includes(recomendacao.status);
          const sinalizadoPorTexto =
            observacaoPreRedacao &&
            (MARCA_MATERIAL_INSUFICIENTE.test(observacaoPreRedacao) ||
              INDICA_MATERIAL_INSUFICIENTE.test(observacaoPreRedacao));
          // com a pesquisa planejada pronta, o veto só mandaria buscar solto
          // (ver o comentário do 8º teste real em aplicarRecomendacaoCritico)
          if ((sinalizadoPorStatus || sinalizadoPorTexto) && !this.planoDeResposta) {
            vetosPreRedacaoFeitos += 1;
            vetosDeResposta += 1;
            const explicacao =
              (sinalizadoPorStatus && recomendacao.problema) ||
              (observacaoPreRedacao || '').replace(MARCA_MATERIAL_INSUFICIENTE, '').trim() ||
              'o material coletado não cobre o que foi pedido.';
            this.vetoDoCopiloto({
              gate: 'material-insuficiente',
              nome,
              plano,
              erro: 'O Copiloto avaliou que o material coletado ainda não resolve o pedido.',
              instrucao:
                `O material que você coletou ainda não resolve o pedido: ${explicacao}. ` +
                'Pesquise ou leia mais antes de chamar "responder" de novo.',
              historico,
            });
            continue;
          }
          // Passou (ou não teve nada a apontar): guarda o resultado pra
          // finalizarComResposta reaproveitar sem perguntar de novo.
          ctx.estado.preRedacaoJaChecada = true;
          ctx.estado.observacaoPreRedacao = observacaoPreRedacao;
        }

        // A política de profundidade limita quantas FONTES entram, não quantas
        // buscas acontecem. Sem teto, o modelo encadeia consultas ligeiramente
        // diferentes — 27 delas numa execução observada, 18 minutos no total —
        // e o guarda de repetição não pega, porque cada consulta é única.
        const BUSCAS = ['pesquisar_e_ler', 'buscar_web'];
        if (BUSCAS.includes(nome)) {
          if (buscasFeitas >= tetoDeBuscas) {
            this.vetoDoCopiloto({
              gate: 'teto-de-buscas',
              nome,
              plano,
              erro: `Limite de ${tetoDeBuscas} buscas por execução atingido. Responda com o material já coletado.`,
              instrucao:
                `Você já fez ${buscasFeitas} buscas, que é o limite desta execução. ` +
                'Não busque mais nada: chame responder agora, indicando em "foco" o que a resposta deve cobrir. ' +
                'Se algum dado não foi encontrado, a resposta deve dizer isso.',
              historico,
            });
            continue;
          }
          buscasFeitas += 1;
          // revisão v5: a dica de página de histórico vale por no máximo 2 buscas
          if (ctx.estado.historicoFalta) ctx.estado.buscasFeitasDica = (ctx.estado.buscasFeitasDica || 0) + 1;

          // Busca de acompanhamento mirada no que falta (ver ajusteDeBusca
          // acima) — regra determinística, sem chamada nova ao modelo.
          const ajuste = ajusteDeBusca(argumentos.consulta, lacunas);
          if (ajuste) {
            argumentos.consulta = ajuste.ajustada;
            this.emit('busca-ajustada', ajuste);
          }
        }

        // Repetir a mesma busca com parâmetros um pouco maiores é o laço
        // clássico do modelo pequeno: gasta passos e não muda o resultado.
        // `argumentos.motivo` (consultar_critico) entra na mesma cadeia de
        // fallback: sem isso, três consultas ao crítico por MOTIVOS
        // diferentes caíam todas na mesma chave vazia (nenhuma tem consulta/
        // url/caminho) e o guard genérico barrava na 3ª como se fosse a
        // MESMA pergunta repetida — mascarando o teto próprio da ferramenta
        // (criticaSobDemandaMax, ver consultarCritico) com uma mensagem que
        // não bate com o que de fato aconteceu.
        //
        // `argumentos.objetivo` (investigar_subtarefa) entrou pelo mesmo
        // motivo, achado revisando uma execução real (Davi, 2026-09-22,
        // "melhor fone pra PUBG" — segunda rodada, já com o Item 3 da
        // rodada anterior em produção): essa ferramenta usa `objetivo` +
        // `consultas`, não `consulta`/`url`/`caminho`/`motivo` — nenhum dos
        // quatro campos originais. Sem isso, TODA chamada dela cai na mesma
        // chave vazia "investigar_subtarefa|", e a 3ª chamada é barrada como
        // repetição mesmo investigando um sub-tema totalmente diferente da
        // 1ª e da 2ª. Na execução real, 2 chamadas legítimas passaram e as 3
        // seguintes (investigando outra coisa) foram bloqueadas por isso.
        const chave = chaveDeRepeticao(nome, argumentos, ctx.estado.pagina, ctx.estado.preenchidos);
        const vezes = (assinaturas.get(chave) || 0) + 1;
        assinaturas.set(chave, vezes);
        const tentativaAnteriorMudou = resultadoPorChave.get(chave);
        if (tarefa.acaoBloqueada(nome, argumentos)) {
          const erro = 'Ação bloqueada: esta combinação de ferramenta e argumentos já pertence a uma estratégia marcada como insuficiente.';
          tarefa.registrarRepeticao({ nome, argumentos, numero: vezes, motivo: erro });
          this.vetoDoCopiloto({
            gate: 'estrategia-replanejada',
            nome,
            plano,
            erro,
            instrucao: 'A estratégia anterior falhou. Use uma ferramenta, consulta ou argumento diferente conforme o novo plano.',
            historico,
          });
          this.emit('replanejamento-bloqueio', { nome, argumentos, motivo: erro });
          this.emit('tarefa-atualizada', tarefa.serializar());
          continue;
        }
        // Ação de página repetida na MESMA página: barra já na 2ª só quando a
        // tentativa anterior idêntica NÃO mudou nada (revisão: "próximo" →
        // "voltar" → "próximo" volta à mesma impressão e é legítimo). Se a
        // anterior mudou a página, vale o teto geral, um pouco mais folgado.
        const acaoDePagina = ACOES_DE_PAGINA.has(nome) && nome !== 'ver_pagina';
        const repetidaSemEfeito = acaoDePagina && vezes > 1 && tentativaAnteriorMudou === false;
        if ((repetidaSemEfeito || vezes > (acaoDePagina ? 3 : 2)) && !ferramenta.terminal) {
          // ctx.estado.ofertas só existe quando buscar_produtos ACHOU preço
          // sozinha; ctx.estado.tentandoComprar é setado antes disso, mesmo
          // quando ela falha (caso comum contra loja grande) — ainda assim
          // estamos numa comparação de preço, só sem nenhuma loja confirmada
          // ainda (array vazio, não null).
          const ofertas = ctx.estado.ofertas || (ctx.estado.tentandoComprar ? [] : null);
          const { erro, mensagem } = mensagemDeAcaoRepetida({ nome, ofertas });
          tarefa.registrarRepeticao({
            nome,
            argumentos,
            numero: vezes,
            motivo: erro,
          });
          try {
            if (tarefa.estado === ESTADOS_TAREFA.EXECUTANDO) {
              // Achado na mesma execução real do comentário de `chave` acima:
              // diferente do replanejamento normal (que sempre agenda
              // `this.replanejamentoPendente`, devolvido a EXECUTANDO no
              // início da próxima iteração, loop.js ~3013-3038), este gate
              // nunca agendava nada — a tarefa ficava PRESA em REPLANEJANDO
              // pelo resto da execução inteira, porque nada mais no laço
              // principal tira a tarefa desse estado sem passar por
              // `replanejamentoPendente`. E os dois ramos de
              // `aplicarRecomendacaoCritico` que decidem "perguntar" ou
              // "replanejar" (a crítica periódica passa por ali) só agem
              // quando `tarefa.estado` está em PLANEJANDO/EXECUTANDO —
              // travada em REPLANEJANDO, toda recomendação seguinte do
              // crítico virava letra morta, em silêncio. Na execução real,
              // isso engoliu 9+ "perguntar" da crítica periódica depois do
              // gate disparar. A instrução deste próprio veto ("use uma
              // ferramenta/consulta diferente") já redireciona o modelo sem
              // precisar de um replanejamento de verdade — então volta pra
              // EXECUTANDO na mesma rodada, só deixando o registro de
              // transição (auditoria de `tarefa.transicoes`) de que a
              // estratégia foi marcada insuficiente.
              tarefa.transicionar(ESTADOS_TAREFA.REPLANEJANDO, 'ação repetida bloqueada');
              tarefa.transicionar(ESTADOS_TAREFA.EXECUTANDO, 'veto de ação repetida já redirecionou o modelo');
            }
          } catch {
            /* o registro da execução não pode bloquear o gate existente */
          }
          this.emit('tarefa-atualizada', tarefa.serializar());
          this.vetoDoCopiloto({ gate: 'acao-repetida', nome, plano, erro, instrucao: mensagem, historico });
          eventoParaCritico = eventoParaCritico || 'acao-repetida';
          continue;
        }

        // Controlador v2 (05/10): progresso observável. Três ações seguidas no
        // navegador sem a página mudar = parar de tentar às cegas.
        // Revisão v4 (contracheque real): pedido de AGIR num site começa pelo
        // navegador. O 7B abriu a página 3× com abrir_pagina (não faz login),
        // buscou a URL na web e perguntou se a senha estava certa ANTES de
        // tentar usá-la — 3,5 min perdidos. Até 2 vetos; depois, deixa passar.
        if (this.tipoDoPedido === 'site' && ctx.navegador && !ctx.estado.navegando && vetosDeSite < 2 &&
          ['abrir_pagina', 'pesquisar_e_ler', 'buscar_web', 'investigar_subtarefa', 'perguntar_usuario'].includes(nome)) {
          vetosDeSite += 1;
          const url = (/\bhttps?:\/\/[^\s)'"]+/i.exec(objetivo) || [''])[0];
          this.vetoDoCopiloto({
            gate: 'site-pelo-navegador',
            nome,
            plano,
            erro: 'Pedido de agir num site: comece pelo navegador.',
            instrucao:
              `O usuário pediu para AGIR no site (login, cliques, download). ${nome} não faz isso. ` +
              `Comece com {"ferramenta": {"nome": "navegar", "argumentos": {"url": "${url || 'endereço do pedido'}"}}} e depois use preencher_campo, clicar e enviar_formulario na página. ` +
              'Os dados de login estão no próprio pedido — use-os; só pergunte ao usuário se o site recusar.',
            historico,
          });
          continue;
        }
        // voltar_pagina fica de fora: é a saída natural de um beco sem saída
        if (ACOES_QUE_DEVEM_MUDAR.has(nome) && nome !== 'navegar' && nome !== 'voltar_pagina' && (ctx.estado.navSemProgresso || 0) >= 3) {
          this.vetoDoCopiloto({
            gate: 'sem-progresso',
            nome,
            plano,
            erro: 'Três ações seguidas no navegador sem mudar a página.',
            instrucao:
              'As últimas três ações no navegador não mudaram a página. Pare de tentar: chame responder dizendo até onde chegou ' +
              '(qual página está aberta e o que falta), ou pergunte ao usuário o que falta, se for algo que só ele sabe.',
            historico,
          });
          eventoParaCritico = eventoParaCritico || 'sem-progresso';
          continue;
        }
        // Controlador v2: pergunta já respondida não se repete (05/10: "a senha
        // está correta?" foi feita 4 vezes depois de respondida)
        if (nome === 'perguntar_usuario') {
          const ja = (this.perguntasRespondidas || []).find((p) => mesmaPergunta(p.pergunta, argumentos.pergunta || ''));
          // teto de 2 vetos: se o modelo insiste, deixa o usuário decidir em
          // vez de travar a execução (a resposta anterior pode ter sido errada)
          if (ja && vetosDePerguntaRepetida < 2) {
            vetosDePerguntaRepetida += 1;
            this.vetoDoCopiloto({
              gate: 'pergunta-repetida',
              nome,
              plano,
              erro: 'Pergunta já feita e respondida nesta execução.',
              instrucao: `Você já perguntou isso e o usuário respondeu: "${String(ja.resposta).slice(0, 300)}". Use essa resposta e siga; não pergunte de novo.`,
              historico,
            });
            continue;
          }
        }
        // Modo automático não interrompe (12/10: "RTX 5070 Ti ou 5080, qual
        // comprar?" passou 477 dos 957 s parado em duas perguntas). O modelo
        // segue com a suposição mais provável e a declara na resposta. Agir num
        // site é exceção: senha e código, só o usuário tem. Teto de 2 recusas:
        // se o modelo insiste, a pergunta passa.
        if (
          nome === 'perguntar_usuario' && this.config.autonomy === 'auto' && this.config.naoPerguntarNoAutomatico !== false &&
          this.tipoDoPedido !== 'site' && vetosDePerguntaNoAutomatico < 2
        ) {
          vetosDePerguntaNoAutomatico += 1;
          this.vetoDoCopiloto({
            gate: 'pergunta-no-automatico',
            nome,
            plano,
            erro: 'Modo automático: o usuário pediu para não ser interrompido.',
            instrucao: 'Não pergunte. Escolha a interpretação mais provável, siga com ela e diga na resposta final, em uma linha, qual suposição você fez.',
            historico,
          });
          continue;
        }
        const paginaAntes = ctx.estado.pagina || null;
        let avisoDeProgresso = '';
        // valor digitado em campo de senha vira segredo ANTES do evento
        // 'ferramenta' (que vai pra tela e pro registro)
        this.registrarSegredoDaAcao(nome, argumentos, paginaAntes);

        this.emit('ferramenta', { n: this.iteracao, nome, argumentos, risco: ferramenta.risk });

        // --- portão de aprovação ---
        // Modo contido (autoteste de skill, item 5): não há humano de verdade
        // esperando do outro lado. Risco alto é simulado logo abaixo, sem nunca
        // rodar de verdade; risco baixo/medio não precisa de aprovação mesmo
        // fora do modo contido — então simplesmente não há aprovação a pedir aqui.
        if (!this.modoContido && tools.precisaAprovacao(nome, this.config, { argumentos, estado: ctx.estado })) {
          const decisao = await this.pedirAprovacao({ nome, argumentos, ferramenta, motivo: motivoDeAprovacao(nome, argumentos, ctx.estado) });
          if (decisao === 'negar') {
            ultimaAcaoOk = false;
            this.emit('negado', { n: this.iteracao, nome });
            historico.push({ role: 'assistant', content: decisaoCompacta(plano) });
            historico.push({
              role: 'user',
              content: `O usuário NEGOU a execução de ${nome}. Não repita essa ação. Proponha um caminho diferente para avançar no objetivo.`,
            });
            continue;
          }
        }

        // --- execução ---
        let saida = '';
        let erro = null;
        const t0 = Date.now();
        const fontesAntes = (ctx.estado.fontesLidas || []).length;
        if (GERACOES_DE_ARQUIVO.includes(nome)) ctx.estado.tentouGerarArquivo = true;
        try {
          if (this.modoContido && ferramenta.risk === 'alto') {
            // Autoteste de skill (item 5): risco alto nunca roda de verdade —
            // só interessa saber que o agente TENTARIA isto, não sofrer o efeito.
            saida = `[autoteste — não executado de verdade, risco alto] ${nome}(${JSON.stringify(argumentos).slice(0, 200)})`;
          } else if (this.modoContido && ferramenta.interactive) {
            // perguntar_usuario, e qualquer outra ferramenta interativa: não há
            // humano esperando neste autoteste isolado — responde sozinho, no
            // mesmo espírito da bancada de avaliação (avaliacao/motor.js).
            saida = 'Prossiga com o que você já tem — não há usuário real disponível neste autoteste.';
          } else {
            saida = await this.rodarFerramenta(nome, ferramenta, argumentos, ctx);
          }
          tools.registrarUrlsVistas(ctx.estado, saida); // ver tools.urlPodeVazarDados
          registrarFerramentaOk(nome);
          if (LEITURAS.includes(nome)) {
            const entradas = await this.destilarLeitura({ nome, argumentos, saida, ctx, objetivo, fontesAntes });
            dossie.push(...entradas);
            this.salvarDossieNaMemoriaCurta(entradas, { memory, idConversa });
            for (const entrada of entradas) {
              // revisão v3: o item que ESTA leitura atende (casado pela consulta/URL), não o primeiro pendente
              const atendido = itemDaLeitura(checklist, `${alvoDaLeitura(argumentos)} ${entrada.url || ''}`);
              tarefa.registrarEvidencia({
                origem: entrada.origem,
                texto: entrada.texto || entrada.bruto,
                subtarefa: atendido?.texto || null,
                url: entrada.url,
              });
              if (atendido) tarefa.marcarSubtarefaComEvidencia(atendido.texto);
            }
            checklist = checklist.map((item) => {
              const subtarefa = tarefa.subtarefas.find((sub) => sub.chave === normalizarSubtarefa(item.texto));
              return subtarefa?.status === 'feito' ? { ...item, status: 'feito' } : item;
            });

            // Medir a cobertura AGORA, e não só na redação, é o que permite
            // reagir: sabendo quais termos do pedido ainda não apareceram, a
            // próxima consulta pode ir atrás justamente deles.
            lacunas = medirCobertura(objetivo, dossie);
            tarefa.definirLacunas(lacunas.ausentes || []);
            this.emit('lacunas', lacunas);
            this.emit('tarefa-atualizada', tarefa.serializar());
          }
          if (GERACOES_DE_ARQUIVO.includes(nome)) ctx.estado.escreveu = true;
          // Controlador v2: ação do navegador cumpre o item do plano que ela
          // executou (05/10: "Clique em contracheque" ficou pendente depois do
          // clique, e o portão do checklist vetou a resposta)
          if (ehAcaoDeNavegador(nome) && checklist.length) {
            const feito = itemDaAcao(checklist, { nome, rotulo: argumentos.numero != null ? rotuloDoElemento(paginaAntes, argumentos.numero) : '', url: argumentos.url || '' });
            if (feito && (ctx.estado.ultimaAcaoNavegador?.mudou || nome === 'preencher_campo')) {
              checklist = checklist.map((i) => (i === feito ? { ...i, status: 'feito' } : i));
              tarefa.atualizarSubtarefas(checklist);
              this.emit('checklist', checklist);
            }
          }
          // Revisão v4: download concluído cumpre os itens de baixar/salvar; janela
          // nova cumpre "aguarde a nova janela" (contracheque real, 07/10)
          if (ehAcaoDeNavegador(nome) && checklist.length) {
            const efeitos = ctx.estado.ultimaAcaoNavegador || {};
            const cumpre = (texto) => {
              const t = normalizar(texto);
              return (efeitos.downloads?.length && /\b(baix\w*|download\w*|salv\w*)\b/.test(t)) || (efeitos.janelaNova && /\bnova (janela|aba)\b/.test(t));
            };
            if (checklist.some((i) => i.status === 'pendente' && cumpre(i.texto))) {
              checklist = checklist.map((i) => (i.status === 'pendente' && cumpre(i.texto) ? { ...i, status: 'feito' } : i));
              tarefa.atualizarSubtarefas(checklist);
              this.emit('checklist', checklist);
            }
          }
          if (ACOES_DE_PAGINA.has(nome)) resultadoPorChave.set(chave, ctx.estado.ultimaAcaoNavegador?.mudou !== false);
          if (ACOES_QUE_DEVEM_MUDAR.has(nome) && (ctx.estado.navSemProgresso || 0) >= 2) {
            eventoParaCritico = eventoParaCritico || 'sem-progresso';
            // vai junto do RESULTADO desta ação (mais abaixo), não antes da
            // decisão — senão o aviso aparece antes da ação que ele descreve
            avisoDeProgresso =
              'PROGRESSO (aviso do sistema): as duas últimas ações no navegador não mudaram a página. ' +
              'Mude de estratégia: outro elemento (pelo texto), voltar_pagina, ou responda com o que conseguiu.';
          }
          falhasSeguidas = 0;
          ultimaAcaoOk = true;
        } catch (err) {
          if (!this.rodando) throw err;
          erro = err.message;

          // Erro de argumento faltando não ensina nada sozinho: o modelo repete
          // a mesma chamada. Devolvemos a assinatura junto.
          if (/^Informe "/.test(erro) && ferramenta.args) {
            const assinatura = Object.entries(ferramenta.args)
              .map(([k, v]) => `"${k}": <${v}>`)
              .join(', ');
            erro += ` Formato correto: ${nome}({ ${assinatura} })`;
          }
          falhasSeguidas += 1;
          ultimaAcaoOk = false;
          eventoParaCritico = eventoParaCritico || 'erro-de-ferramenta';
        }
        const duracao = Date.now() - t0;

        this.emit('resultado', {
          n: this.iteracao,
          nome,
          argumentos: resumoDeArgumentos(argumentos),
          saida: String(saida).slice(0, 6000),
          erro,
          duracao,
        });

        tarefa.registrarAcao({
          nome,
          argumentos,
          resultado: saida,
          erro,
          duracao,
          aprovada: true,
        });
        this.emit('tarefa-atualizada', tarefa.serializar());

        if (!erro && nome === 'perguntar_usuario' && tarefa.estado === ESTADOS_TAREFA.AGUARDANDO_USUARIO) {
          try {
            tarefa.transicionar(ESTADOS_TAREFA.EXECUTANDO, 'informação do usuário recebida');
          } catch {
            /* o estado auxiliar não pode impedir a continuação */
          }
          this.emit('tarefa-atualizada', tarefa.serializar());
        }

        if (ferramenta.terminal && !erro) {
          // Itens de ENTREGA ("redigir a resposta final") são cumpridos pelo
          // próprio responder — fecham aqui. E o checklist ATUAL vai pro
          // registro: as leituras marcam itens sem emitir 'checklist', então o
          // registro guardava o do planejamento e o status da tarefa saía
          // "parcial" com itens que já estavam feitos.
          if (checklist.length) {
            checklist = checklist.map((i) => (i.status === 'pendente' && ehItemDeEntregaFinal(i.texto) ? { ...i, status: 'feito' } : i));
            try {
              tarefa.atualizarSubtarefas(checklist);
            } catch {
              /* registro auxiliar */
            }
            this.emit('checklist', checklist);
          }
          const final = await this.finalizarComResposta({
            objetivo, conversa, dossie, ctx, memory,
            saida: String(saida),
            forcarRedacao: ferramenta.resposta === true,
            buscasFeitas, tetoDeBuscas, executarPasso,
          });
          return { ok: true, resumo: final };
        }

        // preencher_campo não vira memória: o valor digitado (login, senha)
        // não serve pra tarefa futura nenhuma — revisão v4
        if (nome !== 'preencher_campo') {
          this.memorizar(
            memory,
            `Passo ${this.iteracao} — ${nome}(${JSON.stringify(argumentos).slice(0, 200)}) → ${
              erro ? `erro: ${erro}` : String(saida).slice(0, 400)
            }`,
            'passo'
          );
        }

        historico.push({ role: 'assistant', content: decisaoCompacta(plano) });

        if (!erro) {
          // mesma cadeia de fallback da chave de repetição acima — sem
          // `motivo`, todo JÁ FEITO de consultar_critico aparecia como
          // "consultar_critico()", indistinguível entre consultas diferentes.
          const alvo = String(
            argumentos.consulta || argumentos.url || argumentos.caminho || argumentos.motivo || ''
          ).slice(0, 40);
          jaFeito.push(`${nome}(${alvo})`);
        }

        const linhasDaSaida = String(saida).split('\n').filter((l) => l.trim()).length;
        historico.push({
          role: 'user',
          content: prompts.resultado({ ferramenta: nome, saida: String(saida).slice(0, 6000), erro }),
          // versão de uma linha, usada assim que este resultado deixa de ser recente
          curto: erro
            ? `RESULTADO DE ${nome}: falhou — ${String(erro).slice(0, 120)}`
            : `RESULTADO DE ${nome}: ok, ${linhasDaSaida} linha(s) de conteúdo já registradas no dossiê.`,
        });
        if (avisoDeProgresso) historico.at(-1).content += `\n\n${avisoDeProgresso}`;

        if (falhasSeguidas >= 3) {
          historico.push({
            role: 'user',
            content:
              'Três falhas seguidas. Pare de insistir nessa abordagem: reavalie o objetivo e proponha uma estratégia claramente diferente.',
          });
          falhasSeguidas = 0;
        }

        // Checkpoint automático 3/5 do Copiloto: DIREÇÃO DA PESQUISA — pedido
        // do Davi 2026-09-15, depois do caso em que `respondeAoPedido`
        // aprovou uma resposta sobre história da arte pra um pedido de
        // física: a pesquisa em si tinha ido bem (sites confiáveis, bastante
        // material), só que atrás do ASSUNTO ERRADO. Nem "entendimento" nem
        // "plano-inicial" pegam isso — os dois revisam a LEITURA do pedido e
        // o PLANO de passos, nenhum olha pro que a busca de fato trouxe, e a
        // consulta real (escrita pelo modelo, sem revisão prévia) pode sair
        // atrás do termo errado mesmo com pedido bem entendido e plano bem
        // desenhado. Por isso dispara só UMA vez por execução
        // (`ctx.estado.direcaoPesquisaChecada`), logo depois da PRIMEIRA
        // busca (`pesquisar_e_ler`/`buscar_web`) trazer material pro
        // dossiê — cedo o bastante pra intervir antes de gastar mais passos
        // no rumo errado, tarde o bastante pra já existir algo concreto pra
        // avaliar (não dá pra julgar "está no assunto certo" sem ver o que
        // voltou). Puramente consultivo, como entendimento/plano-inicial/
        // parte-concluída — só "pre-redacao" bloqueia (ver material-
        // insuficiente acima): barrar a esta altura, com só uma busca feita,
        // arriscaria travar um caminho que só precisava de um ajuste fino.
        if (
          pipelineCompleto &&
          !erro &&
          BUSCAS.includes(nome) &&
          !ctx.estado.direcaoPesquisaChecada &&
          dossie.length
        ) {
          ctx.estado.direcaoPesquisaChecada = true;
          const observacaoDirecao = await this.criticaAutomatica({
            fase: 'direcao-pesquisa',
            objetivo,
            checklist,
            jaFeito,
            dossie,
            motivo:
              'Confirmar se a busca já feita está trazendo material sobre o assunto certo do pedido, antes de continuar pesquisando nessa direção.',
          });
          if (observacaoDirecao) {
            historico.push({
              role: 'user',
              content: `OBSERVAÇÃO DE UM REVISOR (não é o usuário — questione se faz sentido, mas não ignore sem motivo): ${observacaoDirecao}`,
            });
          }
        }

        // --- compactação de contexto ---
        // O limiar antigo era numCtx × 3 caracteres — herança de quando a janela
        // tinha 8.192 tokens. Com 16.384 ele só disparava quando o histórico
        // sozinho já ocupava 85% do contexto. Agora é fração do que SOBRA
        // depois do bloco fixo.
        const tokensDoFixo = Math.round(sistema.length / 3.5);
        // Janela de quem vai LER esse histórico compactado: o resumo entra
        // de volta no laço de decisão (mais abaixo), então é numCtxDe('decisao')
        // que importa aqui — não o valor geral (ver numCtxDe(), Peça janela-
        // de-contexto-por-modelo, 2026-09-20).
        const limite = Math.max(4000, Math.round((this.numCtxDe('decisao') - tokensDoFixo) * 0.45 * 3.5));
        if (chars(paraEnvio(historico)) > limite && historico.length > 6) {
          const antigos = historico.slice(0, historico.length - 4);
          const recentes = historico.slice(-4);
          try {
            const r = await ollama.chat({
              host: this.config.host,
              model: this.modeloDe('decisao'),
              messages: [
                {
                  role: 'user',
                  // Bug real (documento trazido pelo Davi, 2026-09-21):
                  // antes, o resumo anterior era colado ao novo POR FORA do
                  // modelo (`resumo + '\n' + novo`) e só então cortado pelo
                  // tamanho com `.slice(-6000)` — corte cego pela frente, sem
                  // ninguém (nem o modelo) ver o que já existia. Numa
                  // execução com várias compactações isso apagava fato
                  // antigo em silêncio. Agora o resumo anterior (se houver)
                  // entra como entrada do PRÓPRIO pedido de resumo, pedindo
                  // fusão — `resumo` abaixo vira o resultado dessa fusão,
                  // nunca mais uma concatenação feita por este código.
                  content: prompts.pedidoDeResumo(
                    antigos.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 20000),
                    resumo || undefined
                  ),
                },
              ],
              temperature: 0.2,
              numCtx: this.numCtxDe('decisao'),
              signal: this.controller.signal,
            });
            // Corte por tamanho continua existindo só como rede de segurança
            // (modelo pequeno pode ignorar o "no máximo 12 linhas") — pela
            // FRENTE agora (`slice(0, ...)`), porque o texto é uma fusão
            // única e coerente pedida em ordem, não mais um acúmulo de
            // pedaços onde o mais recente ficava sempre no fim.
            resumo = r.content.trim().slice(0, 6000);
            historico = recentes;
            this.emit('compactado', { n: this.iteracao, mensagens: antigos.length });
          } catch {
            historico = historico.slice(-6);
          }
        }
      }

      if (this.rodando) {
        // revisão v3 (03/10): antes devolvia {ok:false} e jogava fora TODO o
        // material lido — a saída por falha de protocolo (acima) já
        // entregava. Com material no dossiê, entrega o que dá, com aviso.
        // ('limite' encerra o registro; com resposta, o aviso é
        // 'limite-atingido' e quem encerra é o 'concluido' da resposta)
        if (!dossie.length) this.emit('limite', { iteracoes: this.iteracao, uso: this.uso });
        else this.emit('limite-atingido', { iteracoes: this.iteracao, uso: this.uso });
        if (dossie.length) {
          if (checklist.some((i) => i.status === 'pendente')) {
            checklist = checklist.map((i) => (i.status === 'pendente' ? { ...i, status: 'pulado' } : i));
            tarefa.atualizarSubtarefas(checklist);
            this.emit('checklist', checklist);
          }
          const final = await this.finalizarComResposta({
            objetivo, conversa, dossie, ctx, memory,
            saida: '',
            forcarRedacao: true,
            buscasFeitas, tetoDeBuscas, executarPasso,
            notaFinal: `*(Aviso: a execução chegou ao limite de ${this.iteracao} passos antes de terminar — esta resposta usa só o material lido até ali.)*`,
          });
          this.rodando = false;
          return { ok: true, resumo: final, limite: true };
        }
        this.rodando = false;
        return { ok: false, motivo: 'limite de iterações' };
      }
      this.emit('interrompido', { iteracoes: this.iteracao, uso: this.uso });
      return { ok: false, motivo: 'interrompido' };
    } catch (err) {
      this.rodando = false;
      const interrompido = /interrompid|abort/i.test(err.message);
      this.emit(interrompido ? 'interrompido' : 'erro', {
        mensagem: err.message,
        iteracoes: this.iteracao,
        uso: this.uso,
      });
      return { ok: false, motivo: err.message };
    } finally {
      this.rodando = false;
      this.cancelarPendentes('Execução encerrada.');
    }
  }
}

// Parte dos métodos do Agent mora em arquivos próprios (2026-10-11): mesmos
// métodos, mesmo `this` — só saíram daqui pra este arquivo ficar menor.
for (const parte of [require('./loop-critico'), require('./loop-redacao')]) {
  const { constructor: _, ...metodos } = Object.getOwnPropertyDescriptors(parte.prototype);
  Object.defineProperties(Agent.prototype, metodos);
}

module.exports = { imagensAnexadas,
  Agent,
  listaSemOsComparados,
  caberNaJanela,
  chaveDeRepeticao,
  itemDaAcao,
  mesmaPergunta,
  resumoDeArgumentos,
  itemNaoExecutavel,
  fontesDaResposta,
  extrairJSON,
  medirCobertura,
  ajusteDeBusca,
  pedidoQuerArquivo,
  extrairRecomendacaoCritico,
  resumoDoDossie,
  selecionarParaRedacao,
  ehItemDeEntregaFinal,
  calibrarRazao,
  reconciliarChecklist,
  itemChecklistRelevante,
  mensagemDeAcaoRepetida,
  CRITICA_PERIODICA_INTERVALO,
  CRITICA_PERIODICA_MAX,
};

