'use strict';

/**
 * O Copiloto (crítico do plano) do Agent (loop.js). São métodos do próprio Agent — o `this`
 * é o agente — que moram aqui só pra loop.js ficar menor; loop.js copia
 * estes métodos pro protótipo dele. Saíram de lá em 2026-10-11 sem mudança
 * de comportamento.
 */

const ollama = require('../llm/ollama');
const prompts = require('./prompts');
const { ESTADOS: ESTADOS_TAREFA } = require('./tarefa');
const {
  MAX_REPLANEJAMENTOS,
  FASES_QUE_PODEM_REPLANEJAR,
  extrairRecomendacaoCritico,
  resumoDoDossie,
  textoCobreAlvo,
} = require('./loop-auxiliares');

class Critico {
  /**
   * Subagente crítico: questiona o PLANO geral, não uma ação específica (essa
   * é a segundaOpiniao acima). Chamada curta e separada, chamada de tempos em
   * tempos (ver CRITICA_PERIODICA_INTERVALO/MAX) — nunca bloqueia a decisão
   * atual, só entra no histórico como observação pra PRÓXIMA rodada considerar.
   */
  async criticaDoPlano({ objetivo, checklist, jaFeito, dossie }) {
    if (this.config.criticaPeriodica === false) return null;
    // Copiloto nível 2, modo "Desligado" (seletor de 3 modos na UI, ver
    // renderer/index.html #cfgCopiloto2Modo) desliga a crítica periódica
    // também — o seletor substitui o antigo toggle avulso
    // (#cfgCriticaPeriodica) como único controle visível na tela de
    // configurações. `criticaPeriodica` continua existindo por baixo (não
    // removida, só não é mais escrita pela UI) pra não quebrar quem já tem
    // um config.json salvo ou os testes da bancada que usam o campo direto.
    if (this.config.copiloto2Modo === 'desligado') return null;
    // Bug real encontrado montando o relatório de consultas do Copiloto
    // (Davi, 2026-09-18): esta era a ÚNICA das quatro chamadas ao crítico com
    // um `ollama.chat` PRÓPRIO, direto — nunca passava por
    // `_perguntarAoCritico`, então nunca usava o modelo dedicado de "2 IAs",
    // mesmo com `copiloto2Modo === 'doisModelos'` configurado. Como esta é a
    // crítica que mais dispara na prática (intervalo pode ser 1 passo, ver
    // `criticaPeriodicaIntervaloComplexo`), na prática a maior parte das
    // consultas ao "crítico" era só o modelo principal concordando consigo
    // mesmo — o mesmo problema que a correção em `segundaOpiniao` (acima)
    // já tinha resolvido pro caminho de aprovação. Reaproveitar
    // `_perguntarAoCritico` (com `periodica: true`) corrige os dois de uma
    // vez: usa o modelo certo, E passa a aparecer no relatório da execução
    // (evento `'copiloto-consulta'`, ver o comentário acima em
    // `_perguntarAoCritico`).
    const { texto, erro } = await this._perguntarAoCritico({ objetivo, checklist, jaFeito, dossie, periodica: true });
    if (erro || !texto) return null; // bônus, não requisito: falhar aqui não pode derrubar o loop
    const recomendacao = extrairRecomendacaoCritico(texto);
    this.ultimaRecomendacaoCritico = recomendacao;
    if (this.tarefa) this.tarefa.registrarRecomendacaoCritico({ texto, fase: 'plano', recomendacao });
    this.aplicarRecomendacaoCritico(recomendacao, 'plano');
    return texto.length > 4 && !/^(ok\b|nenhum|nenhuma|nada|sem problema|tudo certo|no problem)/i.test(texto)
      ? texto.slice(0, 300)
      : null;
  }

  /**
   * Consulta sob demanda ao crítico (Copiloto nível 2) — ferramenta
   * `consultar_critico` em src/tools/index.js. Diferente de criticaDoPlano
   * acima (o ORQUESTRADOR decide chamar, periodicamente): aqui foi o PRÓPRIO
   * agente que pediu, porque tinha uma dúvida específica — por isso o
   * resultado volta DIRETO como resultado da ferramenta (visível já no
   * próximo turno de decisão), não como aviso injetado de lado.
   *
   * Nunca exige um segundo modelo pra existir (pedido explícito do Davi):
   * com `copiloto2Modo === 'mesmoModelo'` (padrão) usa o mesmo modelo de
   * decisão de sempre — funciona em qualquer hardware. Só quando o usuário
   * escolheu `'doisModelos'` E configurou `modelCopiloto2` é que chama um
   * modelo dedicado separado, com `numGpu: 0` pra não disputar VRAM com o
   * modelo principal (ver src/agent/hardware.js pra recomendação de qual
   * modo cabe no hardware detectado — a escolha em si é sempre do usuário).
   *
   * Teto próprio (`criticaSobDemandaMax`, contador separado do teto da
   * crítica periódica) — mesmo espírito de `ITENS_PENDENTES_MAX_VETOS`: sem
   * isso, um agente inseguro poderia gastar a execução inteira só
   * perguntando.
   */
  async consultarCritico({ objetivo, checklist, jaFeito, dossie, motivo }) {
    if (this.config.copiloto2Modo === 'desligado') {
      return 'O Copiloto está desligado nas configurações — não há segunda opinião disponível agora.';
    }
    const teto = this.config.criticaSobDemandaMax ?? 3;
    if (this.consultasCriticoFeitas >= teto) {
      return `Limite de consultas ao crítico já atingido nesta execução (${teto}). Decida com o que já tem.`;
    }
    this.consultasCriticoFeitas += 1;
    const { texto, erro } = await this._perguntarAoCritico({ objetivo, checklist, jaFeito, dossie, motivo });
    const recomendacao = extrairRecomendacaoCritico(texto);
    this.ultimaRecomendacaoCritico = recomendacao;
    if (texto && this.tarefa) this.tarefa.registrarRecomendacaoCritico({ texto, fase: 'sob-demanda', recomendacao });
    this.aplicarRecomendacaoCritico(recomendacao, 'sob-demanda');
    if (erro) return `Não foi possível consultar o crítico agora: ${erro}`;
    return texto || 'O crítico não teve nada específico a apontar.';
  }

  /**
   * Núcleo compartilhado da chamada ao crítico (Copiloto nível 2) — só faz a
   * pergunta ao modelo (mesmo/dedicado, conforme copiloto2Modo) e devolve o
   * texto cru. Quem chama decide teto, contador e o que fazer com o
   * resultado — hoje são quatro: consultarCritico (sob demanda, o PRÓPRIO
   * agente pede, teto `criticaSobDemandaMax`), criticaDoPlano (abaixo;
   * crítica periódica por intervalo de passos, sem teto próprio — o teto
   * mora no chamador, ver CRITICA_PERIODICA_MAX/Complexo), criticaAutomatica
   * (abaixo; o ORQUESTRADOR pede, em pontos fixos do pipeline, teto
   * `criticaAutomaticaPorEtapaMax`) e segundaOpiniao (acima; crítica focada
   * numa AÇÃO específica antes do portão de aprovação, sem teto próprio —
   * já limitada a `apagar_arquivo`/`executar_comando`) — orçamentos
   * deliberadamente separados, pra um não roubar chamadas do outro.
   *
   * Caso real (Davi, 2026-09-18): pediu uma forma de confirmar com 100% de
   * certeza que "2 IAs" está de fato consultando o modelo dedicado — até
   * aqui só dava pra inferir pelo indicador ao vivo (#statusCopiloto,
   * `ollama:copilotoStatus`), que não fica registrado em lugar nenhum depois
   * que a execução termina. Como este é o ÚNICO ponto por onde toda consulta
   * ao crítico passa, o evento `'copiloto-consulta'` emitido aqui embaixo —
   * sempre, com o modelo REAL usado (`usaModeloDedicado`, não o que está
   * configurado) — é o que `src/registro.js` grava por execução e o
   * relatório (`renderer/app.js`, `abrirRelatorio`) mostra depois, sem
   * depender de estar olhando a tela no momento exato da consulta.
   */
  async _perguntarAoCritico({ objetivo, checklist, jaFeito, dossie, motivo, fase, acao, periodica }) {
    const usaModeloDedicado = this.config.copiloto2Modo === 'doisModelos' && Boolean(this.config.modelCopiloto2) && this.copilotoDescartado !== this.config.modelCopiloto2;
    const model = usaModeloDedicado ? this.config.modelCopiloto2 : this.modeloDe('decisao');
    const origem = acao ? 'aprovacao' : periodica ? 'periodica' : fase ? `checkpoint:${fase}` : 'sob-demanda';

    try {
      // `acao` (segundaOpiniao) é o prompt mais curto e mais específico —
      // não usa objetivo/checklist/dossiê, só a ferramenta e seus argumentos.
      // `periodica` (criticaDoPlano) e `fase` (criticaAutomatica) usam,
      // cada um, seu próprio prompt de checkpoint. Sem os três, é
      // consultarCritico (sob demanda), o prompt original.
      let conteudo;
      if (acao) {
        conteudo = prompts.pedidoDeCritica(acao);
      } else {
        const material = resumoDoDossie(dossie);
        const tarefa = this.tarefa?.serializar();
        conteudo = periodica
          ? prompts.pedidoDeCriticaDoPlano({ objetivo, checklist, jaFeito, material, tarefa })
          : fase
            ? prompts.pedidoDeCriticaAutomatica({ objetivo, checklist, jaFeito, material, motivo, fase, tarefa })
            : prompts.pedidoDeConsultaCritico({ objetivo, checklist, jaFeito, material, motivo, tarefa });
      }
      const r = await ollama.chat({
        host: this.config.host,
        model,
        messages: [{
          role: 'user',
          content: conteudo,
        }],
        temperature: 0.2,
        numCtx: usaModeloDedicado ? this.numCtxDe('copiloto') : this.numCtxDe('decisao'),
        // `acao`/`periodica` são críticas curtas e pontuais (numPredict que
        // já valia pra segundaOpiniao e pro antigo criticaDoPlano avulso) —
        // as outras duas pedem uma avaliação mais longa.
        numPredict: acao || periodica ? 90 : 150,
        manterVivo: this.config.manterModeloVivo,
        numGpu: usaModeloDedicado ? 0 : undefined,
        signal: this.controller.signal,
      });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'copiloto', duracaoMs: r.durationMs });
      this.emit('copiloto-consulta', { origem, modelo: model, dedicado: usaModeloDedicado, ok: true });
      return { texto: String(r.content || '').trim(), erro: null };
    } catch (err) {
      this.emit('copiloto-consulta', { origem, modelo: model, dedicado: usaModeloDedicado, ok: false, erro: err.message });
      return { texto: '', erro: err.message };
    }
  }

  /**
   * Checkpoint automático do Copiloto nível 2 nos 5 pontos fixos do pipeline
   * — entendimento, plano inicial, direção da pesquisa (logo depois da
   * primeira busca trazer material — pedido do Davi 2026-09-15, depois do
   * caso em que a pesquisa foi bem-feita mas sobre o assunto errado),
   * cada parte concluída do checklist, e antes de redigir a resposta final
   * (pedido do Davi 2026-09-14: "usar o copiloto em todos os passos", não só
   * ocasionalmente). Diferente de
   * consultarCritico (o PRÓPRIO agente decide pedir, via ferramenta) e de
   * criticaDoPlano (dispara por intervalo de N passos durante a execução):
   * aqui é o ORQUESTRADOR (run()/finalizarComResposta) que chama, direto,
   * num ponto fixo do fluxo — só quando `pipelineCompleto` está valendo pra
   * este pedido.
   *
   * Teto próprio (`criticaAutomaticaPorEtapaMax`), contador separado dos
   * outros dois — esgotado, pula em silêncio (devolve null, sem custar
   * chamada) em vez de travar a execução. O mesmo vale se o Copiloto
   * estiver desligado, ou se a chamada falhar ou vier vazia: diferente da
   * consulta sob demanda (que PRECISA devolver uma string, é resultado de
   * ferramenta visível ao modelo), aqui silêncio é a resposta certa — não
   * tem sentido empurrar "não consegui consultar o crítico agora" pro
   * histórico de um checkpoint que o próprio agente nem pediu.
   */
  async criticaAutomatica({ fase, objetivo, checklist, jaFeito, dossie, motivo }) {
    // revisão v3: sem consulta nesta fase, não há recomendação desta fase —
    // o portão pré-redação lia a recomendação de um checkpoint ANTERIOR (um
    // "perguntar" de 10 passos atrás ainda vetava a resposta)
    this.ultimaRecomendacaoCritico = null;
    if (this.config.copiloto2Modo === 'desligado') return null;
    const teto = this.config.criticaAutomaticaPorEtapaMax ?? 12;
    if (this.criticasAutomaticasFeitas >= teto) return null;
    this.criticasAutomaticasFeitas += 1;
    const { texto, erro } = await this._perguntarAoCritico({ objetivo, checklist, jaFeito, dossie, motivo, fase });
    const recomendacao = extrairRecomendacaoCritico(texto);
    this.ultimaRecomendacaoCritico = recomendacao;
    if (texto && this.tarefa) this.tarefa.registrarRecomendacaoCritico({ texto, fase, recomendacao });
    this.aplicarRecomendacaoCritico(recomendacao, fase);
    // Mesmo filtro de "sem novidade" que criticaDoPlano já usa (ver acima) —
    // "ok"/"tudo certo" não vira observação nem evento, só ruído.
    if (
      erro ||
      !texto ||
      texto.length <= 4 ||
      /^(ok\b|nenhum|nenhuma|nada|sem problema|tudo certo|no problem)/i.test(texto)
    ) {
      return null;
    }
    this.emit('critica-plano', { n: this.iteracao, texto, fase });
    return texto;
  }

  aplicarRecomendacaoCritico(recomendacao, fase) {
    if (!recomendacao || !this.tarefa) return;
    const motivo = recomendacao.problema || `recomendação estruturada na fase ${fase || 'execução'}`;
    const chave = `${recomendacao.status}|${motivo}|${recomendacao.proximaEstrategia || ''}`.toLowerCase().slice(0, 1200);
    if (recomendacao.status === 'replanejar' && this.recomendacaoCriticoJaCoberta(recomendacao)) {
      this.emit('recomendacao-critico', { fase, ignorada: 'ja-coberta', ...recomendacao });
      return;
    }
    // 8º teste real (2026-09-25, 836 s): a pesquisa planejada terminou, o
    // modelo chamou responder no passo 9 e a crítica periódica (Copiloto 3B)
    // disse "perguntar — material limitado". Veio pergunta ao usuário e mais
    // 13 buscas soltas em 8 minutos — que nem entram na comparação (o plano
    // da resposta já estava montado) e a resposta final saiu igual. Com a
    // pesquisa planejada pronta, o que falta já vai dito na resposta ("o que
    // não foi possível confirmar"); "perguntar" da crítica periódica ou da
    // pré-redação não trava mais. 'sob-demanda' (o modelo pediu) continua valendo.
    if (recomendacao.status === 'perguntar' && this.planoDeResposta && ['plano', 'pre-redacao'].includes(fase)) {
      this.emit('recomendacao-critico', { fase, ignorada: 'pesquisa-planejada', ...recomendacao });
      return;
    }
    // Controlador v2 (05/10): o crítico 3B devolvia "perguntar" quando queria
    // dizer "material insuficiente" ou "plano pendente" — e isso punha a
    // tarefa em AGUARDANDO_USUARIO, vetava a resposta e mandava perguntar
    // ("a senha está correta?" 4 vezes). Agora "perguntar" só vale quando a
    // verificação de ambiguidade do início confirmou que falta um dado do
    // usuário, ou quando o próprio agente pediu a opinião (sob demanda).
    if (
      recomendacao.status === 'perguntar' &&
      this.config?.criticoSoPerguntaComFaltaConfirmada !== false &&
      fase !== 'sob-demanda' &&
      !this.ambiguidadeInsuficiente
    ) {
      this.emit('recomendacao-critico', { fase, ignorada: 'sem-falta-confirmada', ...recomendacao });
      return;
    }
    try {
      if (
        recomendacao.status === 'replanejar' &&
        FASES_QUE_PODEM_REPLANEJAR.has(fase) &&
        this.iteracao >= this.replanejamentoCooldownAte &&
        !this.replanejamentoChaves.has(chave) &&
        this.replanejamentosFeitos + (this.replanejamentoPendente ? 1 : 0) < MAX_REPLANEJAMENTOS &&
        [ESTADOS_TAREFA.PLANEJANDO, ESTADOS_TAREFA.EXECUTANDO].includes(this.tarefa.estado)
      ) {
        this.replanejamentoChaves.add(chave);
        this.tarefa.marcarPlanoAnterior('insuficiente', motivo);
        this.tarefa.transicionar(ESTADOS_TAREFA.REPLANEJANDO, motivo);
        this.replanejamentoPendente = { fase, motivo, estrategia: recomendacao.proximaEstrategia };
      } else if (
        recomendacao.status === 'perguntar' &&
        // 'plano' entrou aqui (pedido do Davi 2026-09-22, achado analisando
        // execução real "melhor fone intra-auricular pra PUBG PC"): a
        // crítica periódica (`criticaDoPlano`, fase 'plano' — é a que mais
        // roda na prática, intervalo pode ser 1 passo) já podia sinalizar
        // "replanejar" (fase 'plano' sempre esteve em
        // FASES_QUE_PODEM_REPLANEJAR, acima), mas "perguntar" vindo dela
        // caía no vácuo — só pre-redacao/sob-demanda estavam aqui. Na
        // execução real, o crítico identificou 5 vezes, em texto claro, que
        // faltava comparar características técnicas e verificar opinião de
        // usuário sobre o fone NO JOGO — cinco "perguntar" que nunca viraram
        // nada, porque só a crítica periódica rodou (11 das 17 consultas ao
        // copiloto) e sua fase não estava nesta lista. A transição pra
        // AGUARDANDO_USUARIO não trava a execução: só passa a vetar
        // `responder`/`concluir` (no máximo 2 vezes, ver
        // TAREFA_ESTADO_MAX_VETOS em executar()) até o modelo usar
        // perguntar_usuario ou o veto se esgotar — mesma rede de segurança
        // que já protegia pre-redacao/sob-demanda, agora valendo também pra
        // crítica periódica.
        ['plano', 'pre-redacao', 'sob-demanda'].includes(fase) &&
        [ESTADOS_TAREFA.PLANEJANDO, ESTADOS_TAREFA.EXECUTANDO].includes(this.tarefa.estado)
      ) {
        this.tarefa.transicionar(ESTADOS_TAREFA.AGUARDANDO_USUARIO, motivo);
      } else if (
        recomendacao.status === 'bloquear' &&
        ['pre-redacao', 'sob-demanda'].includes(fase) &&
        ![ESTADOS_TAREFA.CONCLUIDA, ESTADOS_TAREFA.BLOQUEADA].includes(this.tarefa.estado)
      ) {
        this.tarefa.transicionar(ESTADOS_TAREFA.BLOQUEADA, motivo);
      }
    } catch {
      // A recomendação é consultiva; uma transição incompatível não interrompe o loop.
    }
    this.emit('recomendacao-critico', { fase, ...recomendacao });
    this.emit('tarefa-atualizada', this.tarefa.serializar());
  }

  recomendacaoCriticoJaCoberta(recomendacao) {
    if (!this.tarefa) return false;

    const subtarefa = recomendacao.subtarefa || '';
    if (subtarefa) {
      const alvo = this.tarefa.subtarefas.find((item) => {
        if (!item?.texto) return false;
        return textoCobreAlvo(item.texto, subtarefa) || textoCobreAlvo(subtarefa, item.texto);
      });
      if (alvo && alvo.status === 'feito') return true;
    }

    const evidencias = (this.tarefa.evidencias || [])
      .map((e) => `${e.texto || ''} ${e.origem || ''} ${e.url || ''}`)
      .join('\n');
    if (!evidencias.trim()) return false;

    return [recomendacao.evidenciaFaltante, recomendacao.subtarefa]
      .filter(Boolean)
      .some((alvo) => textoCobreAlvo(evidencias, alvo));
  }
}

module.exports = Critico;
