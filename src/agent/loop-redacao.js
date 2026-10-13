'use strict';

/**
 * A redação e o encerramento com resposta do Agent (loop.js). São métodos do próprio Agent — o `this`
 * é o agente — que moram aqui só pra loop.js ficar menor; loop.js copia
 * estes métodos pro protótipo dele. Saíram de lá em 2026-10-11 sem mudança
 * de comportamento.
 */

const path = require('path');
const ollama = require('../llm/ollama');
const tools = require('../tools');
const imagens = require('../tools/imagens');
const { assuntoDoPedido } = require('./auto');
const prompts = require('./prompts');
const { Skills } = require('../skills');
const verificador = require('./verificador');
const serieDePrecos = require('./serie-de-precos');
const { fundir, materialOriginal } = require('./destilador');
const { ESTADOS: ESTADOS_TAREFA } = require('./tarefa');
const { produtosNomeados } = require('./tipo-de-pedido');
const confronto = require('./confronto');
const compositor = require('./compositor');
const afirmacoes = require('./afirmacoes');
const {
  MAX_PARTES_POR_REESCRITA,
  fontesDaResposta,
  listaSemOsComparados,
  normalizar,
  termosDoPedido,
  medirCobertura,
  selecionarParaRedacao,
} = require('./loop-auxiliares');

class Redacao {
  /**
   * Redige a resposta final numa chamada separada, SEM format:json.
   * O modelo escreve markdown livre a partir do dossiê coletado — é a
   * diferença entre pedir "preencha este campo JSON com 50 linhas" e
   * "escreva o texto". Modelos pequenos só conseguem a segunda coisa.
   */
  /**
   * Resposta montada pelo código (Etapa H da revisão v2): o esqueleto e os
   * dados saem do resultado do motor (compositor.js); o modelo escreve só
   * frases curtas numa chamada, cada uma conferida — a que não passa vira a
   * frase-padrão feita da evidência.
   */
  /** Onde as imagens das respostas ficam gravadas (src/tools/imagens.js). */
  dirImagens() {
    return this.userDataPath ? path.join(this.userDataPath, 'imagens') : null;
  }

  async comporResposta({ objetivo }) {
    const r = this.composicaoDaPesquisa;
    this.emit('redigindo', { fontes: (r.entradas || []).length, cobertura: 'montada pelo código' });
    // fotos dos produtos: buscadas pela rede enquanto o modelo escreve as
    // frases (não somam tempo); o que não chegar em 15 s fica sem foto
    const fotos = imagens.comLimite(
      imagens.imagensDosProdutos((r.finalistas || []).map((f) => f.nome), { config: this.config, dir: this.dirImagens() }),
      15000,
      new Map()
    );
    let frases = new Map();
    if (r.modo !== 'uso-profissional') {
      try {
        this.emit('chamada', { tipo: 'composicao' });
        const c = await ollama.chat({
          host: this.config.host,
          model: this.modeloDe('redacao'),
          messages: [{ role: 'user', content: compositor.pedidoDeFrases(r, objetivo) }],
          temperature: 0.3,
          numCtx: this.numCtxDe('redacao'),
          numPredict: 1300, // 13/10: 3–4 frases por produto (eram 1–2, com 700)
          manterVivo: this.config.manterModeloVivo,
          signal: this.controller.signal,
        });
        this.contabilizar({ promptTokens: c.promptTokens, completionTokens: c.completionTokens }, { tipo: 'composicao', duracaoMs: c.durationMs });
        frases = compositor.lerFrases(c.content, {
          produtos: (r.finalistas || []).map((f) => f.nome),
          numerosPermitidos: compositor.numerosDaComposicao(r),
          criterios: (r.plano?.criterios || []).map((k) => k.nome),
          semCritica: compositor.produtosSemCritica(r),
        });
      } catch (err) {
        if (!this.rodando) throw err;
        this.emit('aviso', { texto: `resposta montada: as frases do modelo falharam (${err.message}); usando as frases feitas da evidência` });
      }
    }
    r.imagens = await fotos;
    r.objetivo = objetivo;
    const texto = compositor.montar(r, frases);
    this.respostaComposta = true;
    this.emit('resposta-token', { pedaco: texto });
    return texto;
  }

  async redigir({ objetivo, conversa, dossie, foco, rascunho, tamanho, cruzamento = '', fontes = [], semPlano = false }) {
    // Etapa B (contexto em três camadas): pedido que não se refere à conversa
    // não recebe a conversa anterior na redação — a resposta da 1ª pergunta
    // não vaza pra 2ª (14º teste real)
    if (conversa?.length && !prompts.referenciaConversa(objetivo, conversa)) conversa = [];
    const cobertura = medirCobertura(objetivo, dossie);
    this.emit('cobertura', cobertura);

    const skillsRedacao = this.skills
      ? await this.skills.selecionar(objetivo, {
          etapa: 'redacao',
          desativadas: this.config.skillsDesativadas || [],
          host: this.config.host,
          embedModel: this.config.embedModel,
          // Item 6: skill forçada por "/nome" também vale na redação, não só
          // na decisão — senão suas instruções (tom, formato) sumiriam bem
          // na hora que mais importam, o texto final.
          forcarId: this.skillForcada?.id || null,
        })
      : [];
    if (skillsRedacao.length) {
      this.emit('skills', { etapa: 'redacao', nomes: skillsRedacao.map((s) => s.nome) });
    }

    // Fatos iguais vindos de fontes diferentes viram uma linha só, com todas as
    // fontes marcadas — o redator vê a corroboração no próprio fato.
    // as leituras que deram evidência à matriz do motor de pesquisa entram sempre
    const recorte = selecionarParaRedacao(dossie, { prioritarias: this.entradasDaMatriz || [] });
    const { fundidos, soltos } = fundir(recorte);
    // A destilação comprime para caber no contexto, mas descarta nuance nesse
    // processo — o trecho original de cada fonte destilada entra também, ANTES
    // dos fatos já comprimidos: se o total estourar o orçamento, o corte (que
    // tira do início) come esse texto bruto primeiro, e os fatos essenciais
    // (mais compactos, e já a prova de corte no fim) sobrevivem.
    const original = materialOriginal(recorte, 12000);
    const material = [original, fundidos.length ? fundidos.join('\n') : '', ...soltos]
      .filter(Boolean)
      .join('\n\n')
      .slice(-22000);

    this.emit('redigindo', { fontes: dossie.length, cobertura: cobertura.nivel });

    // Esboço do dossiê por tópico (c1 do backlog do Copiloto — Estruturação):
    // calculado uma vez aqui, a partir do MESMO `perguntas` usado no prompt,
    // pra que os dois nunca divirjam (ver esbocoPorTopico em verificador.js).
    const perguntas = verificador.perguntasMultiplas(objetivo);
    const esboco = verificador.esbocoPorTopico(perguntas, dossie);

    // Pedido de Davi (2026-09-15, caso real: cotação de dólar de ~2,5 meses
    // atrás apresentada como "a cotação atual", sem ressalva nenhuma) — o
    // dado em si não é inventado (está no material), então `verificar()`
    // nunca pegaria isso; é sobre IDADE, não fabricação. Só avisa o redator
    // da idade do dado mais recente que existe no material — a decisão de
    // quando isso importa (cotação, sim; um fato histórico, não) fica com o
    // próprio modelo, com a informação em mãos em vez de ter que adivinhar.
    const diasDesdeUltimaData = verificador.diasDesdeDataMaisRecente(material);

    this.emit('chamada', { tipo: 'redacao' });
    const { content, promptTokens, completionTokens, durationMs, contextoReduzido } = await ollama.chatStream({
      host: this.config.host,
      model: this.modeloDe('redacao'),
      messages: [
        {
          role: 'system',
          content:
            prompts.redator(cobertura.nivel, this.config.modoResposta, { corroboracao: this.ultimoConfronto }) +
            Skills.formatar(skillsRedacao),
        },
        {
          role: 'user',
          content: prompts.pedidoDeResposta({
            objetivo,
            material,
            foco: [foco, rascunho, cruzamento].filter(Boolean).join('\n'),
            conversa,
            tamanho,
            cobertura: cobertura.nivel,
            fontes,
            perguntas,
            esboco,
            diasDesdeUltimaData,
            // complemento de UMA parte não recebe o plano inteiro (10º teste real:
            // cada complemento reescrevia a resposta toda, e ela saía 3 vezes)
            planoDeResposta: semPlano ? null : this.planoDeResposta,
          }),
        },
      ],
      temperature: Math.min(this.config.temperature + 0.2, 0.9),
      numCtx: this.numCtxDe('redacao'),
      numPredict: this.config.numPredictResposta || 3072,
      manterVivo: this.config.manterModeloVivo,
      // 10/10 (SR-71 com qwen3.5:9b): 1.600 tokens de raciocínio e nenhum de texto
      pensar: false,
      signal: this.controller.signal,
      onToken: (pedaco) => this.emit('resposta-token', { pedaco }),
    });
    if (contextoReduzido) this.avisarContextoReduzido('redação', contextoReduzido);

    // Redação e destilação também custam tokens. Sem contabilizá-las, a coluna
    // de custo subestimava o gasto real — e ficava em zero nas execuções que
    // rodam por rotina, que nem passam pelo laço de decisão. `durationMs`
    // (pedido de Davi 2026-09-23) só existe aqui porque `ollama.chatStream`
    // passou a calculá-lo — antes só a chamada não-streaming (`ollama.chat`)
    // tinha isso, e a redação (a única chamada que usa streaming) sempre
    // aparecia com custo de tempo zero no detalhamento por fase.
    this.contabilizar({ promptTokens, completionTokens }, { tipo: 'redacao', duracaoMs: durationMs });
    return content.trim();
  }

  /**
   * Encerramento com resposta: redige, verifica e emite a conclusão.
   * Extraído do laço porque as rotinas também terminam aqui — o caminho de
   * saída precisa ser exatamente o mesmo, com verificação e tudo.
   */
  async finalizarComResposta({
    objetivo, conversa, dossie, ctx, memory, saida, forcarRedacao,
    buscasFeitas = 0, tetoDeBuscas = Infinity, executarPasso = null, notaFinal = '',
  }) {
    if (ctx.tarefa) {
      try {
        ctx.tarefa.transicionar(ESTADOS_TAREFA.VERIFICANDO, 'início da verificação final');
      } catch {
        // O modelo de tarefa é observabilidade; nunca pode impedir a resposta.
      }
      this.emit('tarefa-atualizada', ctx.tarefa.serializar());
    }
    // "concluir" depois de pesquisar e sem ter escrito arquivo nenhum é,
    // na prática, uma pergunta não respondida. Redigimos assim mesmo.
    const devePensarEmTexto = forcarRedacao || (ctx.estado.pesquisou && !ctx.estado.escreveu);

    let final = String(saida);

    if (devePensarEmTexto) {
      const tamanho = tools.medirPedido?.(objetivo) || null;
      try {
        // Confronto entre as fontes lidas na execução inteira — antes existia
        // a função (confronto.js) e o campo que a leria (this.ultimoConfronto
        // em redigir()), mas nada no meio ligava um no outro: o confronto
        // nunca era calculado, e main.js/renderer/registro.js esperavam por
        // eventos ('confronto', 'confianca') que nunca chegavam a ser
        // emitidos. Aqui é onde isso passa a acontecer de verdade.
        let cruzamento = confronto.confrontar(ctx.estado.fontesLidas || []);
        this.ultimoConfronto = cruzamento;
        this.emit('confronto', cruzamento);

        // Busca de reforço: cobertura já está boa (o pedido tem material),
        // mas sobrou um fato de fonte única ou uma divergência entre fontes.
        // Em vez de só declarar confiança baixa na resposta, gasta UMA busca
        // extra e focada nesse dado específico antes de redigir — dentro do
        // mesmo teto de buscas da execução, e só uma vez (buscaDeReforcoFeita
        // evita qualquer chance de laço).
        if (executarPasso && buscasFeitas < tetoDeBuscas && !ctx.estado.buscaDeReforcoFeita) {
          const cobertura0 = medirCobertura(objetivo, dossie);

          // c2 do backlog do Copiloto (Síntese): checagem de cobertura POR
          // TÓPICO, antes de redigir — não só o nível geral (medirCobertura,
          // acima). Mesmo padrão de bug do gate de checklist e do esboço que
          // o prompt de redação recebe (esbocoPorTopico, usado dentro de
          // redigir() — ver c1): com várias perguntas na mesma mensagem, é
          // comum sobrar UMA sem nenhum material, mesmo com cobertura geral
          // "boa" pelas outras. Antes, essa lacuna só era descoberta DEPOIS
          // de escrever a resposta (verificador.verificar, reescrita) — ou
          // nem descoberta, só avisada em texto pro redator, sem ninguém agir
          // sobre ela. Aqui, havendo orçamento de busca, tenta preencher essa
          // lacuna especificamente ANTES de redigir, em vez de só avisar
          // depois. Prioridade sobre divergência/fonte única abaixo: pergunta
          // sem NENHUM material é lacuna maior que um dado de fonte única.
          const perguntasParaChecar = verificador.perguntasMultiplas(objetivo);
          const esbocoAntes = verificador.esbocoPorTopico(perguntasParaChecar, dossie);
          const topicoSemMaterial = esbocoAntes?.find((e) => !e.temMaterial);

          const divergencia = cruzamento.divergencias?.[0];
          // Cross-validation de opinião (Davi, 2026-09-23, priorizada antes da
          // descoberta de autoridade em duas fases): mesma prioridade que a
          // divergência numérica logo acima — uma fonte dizendo "recomendo" e
          // outra "não recomendo" sobre o mesmo item é tão digno de uma busca
          // extra quanto duas fontes discordando de um número. Entra DEPOIS da
          // divergência numérica (fato objetivo > veredito subjetivo) e ANTES
          // do "isolado" (fonte única sem contradição é a lacuna mais fraca
          // das três).
          const divergenciaOpiniao = !divergencia && cruzamento.divergenciasOpiniao?.[0];
          const isolado = !divergencia && !divergenciaOpiniao && cruzamento.isolados?.[0];
          const alvo = topicoSemMaterial
            ? topicoSemMaterial.parte
            : divergencia
            ? divergencia.b.texto
            : divergenciaOpiniao
            ? divergenciaOpiniao.entidade
            : isolado
            ? isolado.texto
            : null;

          if ((topicoSemMaterial || cobertura0.nivel !== 'ausente') && alvo) {
            ctx.estado.buscaDeReforcoFeita = true;
            try {
              // Bug real: cortar o objetivo cego em 60 caracteres podia
              // jogar fora justamente o assunto ("PUBG", "43.1") quando ele
              // vinha depois do corte, ou nem aparecer (num pedido de
              // acompanhamento tipo "e quanto ao FSR?", que não repete o
              // assunto — só a conversa dá esse contexto). A ÚLTIMA consulta
              // de busca já foi formulada com esse contexto pelo próprio
              // modelo — reaproveitá-la é bem mais confiável que reconstruir
              // do zero a partir do objetivo bruto. termosDoPedido() é o
              // segundo recurso (extrai as palavras que identificam o
              // assunto, não uma fatia cega), e o corte cru fica como
              // último recurso.
              const base =
                ctx.estado.ultimaConsultaBusca ||
                termosDoPedido(objetivo).slice(0, 6).join(' ') ||
                String(objetivo).slice(0, 60);
              const consulta = `${base} ${String(alvo).slice(0, 80)}`.trim();
              this.emit('busca-reforco', {
                motivo: topicoSemMaterial
                  ? 'pergunta-sem-material-no-dossie'
                  : divergencia
                  ? 'divergencia-entre-fontes'
                  : divergenciaOpiniao
                  ? 'divergencia-de-opiniao-entre-fontes'
                  : 'fonte-unica-sem-corroboracao',
                consulta,
              });
              await executarPasso({ nome: 'pesquisar_e_ler', argumentos: { consulta, paginas: 3 } });
              cruzamento = confronto.confrontar(ctx.estado.fontesLidas || []);
              this.ultimoConfronto = cruzamento;
              this.emit('confronto', cruzamento);
            } catch {
              // busca de reforço é bônus — falhar aqui não pode travar a resposta
            }
          }
        }

        // Backlog do Copiloto, item c3 (Análise): `confronto.paraPrompt()` já
        // existia pronta — formata os valores CONCRETOS que confirmam ou
        // divergem entre fontes (não só a contagem agregada que
        // `calcularConfianca`/`corroboracao` no modo técnico usam) — mas
        // nenhuma chamada a `redigir()` passava `cruzamento` de verdade: o
        // parâmetro sempre caía no padrão `''`. O confronto rodava, o evento
        // `confronto` era emitido, mas o REDATOR nunca via o resultado —
        // divergência real entre fontes não aparecia pro usuário fora do
        // registro interno salvo em disco. Aqui isso passa a chegar no
        // prompt de verdade, junto com foco/rascunho.
        const cruzamentoTexto = confronto.paraPrompt(cruzamento);

        // Checkpoint automático 5/5 do Copiloto: ANTES DE REDIGIR — o
        // critério da consulta muda em relação aos 3 anteriores: aqui o
        // ORQUESTRADOR já rodou o loop de decisão inteiro (não sobrou
        // histórico pra injetar uma observação DEPOIS), então em vez disso a
        // resposta do crítico entra direto no `foco` desta primeira chamada
        // a `redigir()`, como uma instrução a considerar. Caso real que
        // motivou este ponto especificamente (2026-09-14, bateria de 7
        // questões de matemática): o dossiê acabou só com tutoriais
        // genéricos de combinatória (a calculadora rejeitava fatorial — bug
        // já corrigido à parte), e a resposta final virou um mosaico dos
        // EXEMPLOS desses tutoriais, sem relação com as questões reais — o
        // verificador pós-hoc até detectou isso (`respondeAoPedido: false`),
        // mas só depois da resposta pronta. Este checkpoint dá ao crítico
        // uma chance de notar ANTES: "esse material não resolve o que foi
        // pedido", com o dossiê de verdade na mão, não só o plano declarado.
        // série de preços calculada pelo código: entra como material (o
        // verificador reconhece os números) e como instrução pro redator
        const serie = this.montarSerieDePrecos(objetivo, ctx);
        if (serie?.bloco && !ctx.estado.serieNoDossie) {
          ctx.estado.serieNoDossie = true;
          dossie.push({ origem: 'serie-de-precos(cálculo do código)', texto: serie.bloco, bruto: serie.bloco, destilado: true, fatos: serie.observacoes });
          ctx.estado.foco = [ctx.estado.foco, serie.bloco].filter(Boolean).join('\n\n');
        }
        let focoComCheckpoint = ctx.estado.foco;
        if (this.pipelineCompleto) {
          // O gate "material-insuficiente" (no laço de decisão, antes do
          // "responder" ser aceito) já roda esta MESMA consulta quando
          // aplicável, e guarda o resultado em ctx.estado — reaproveitar
          // evita perguntar ao crítico duas vezes pela mesma resposta
          // (rotina/desistência de protocolo não passam por aquele gate,
          // então caem no `await` de sempre aqui).
          const observacaoPreRedacao = ctx.estado.preRedacaoJaChecada
            ? ctx.estado.observacaoPreRedacao
            : await this.criticaAutomatica({
                fase: 'pre-redacao',
                objetivo,
                checklist: [],
                jaFeito: [],
                dossie,
                motivo: 'Revisar se o material coletado realmente resolve o pedido antes de redigir a resposta final.',
              });
          if (observacaoPreRedacao) {
            focoComCheckpoint =
              `${focoComCheckpoint || ''}\n\nOBSERVAÇÃO DE UM REVISOR antes de redigir (questione se faz sentido, mas não ` +
              `ignore sem motivo): ${observacaoPreRedacao.replace(/^material insuficiente[:\s-]*/i, '')}`;
          }
        }

        // Etapa H: pesquisa do motor → resposta montada pelo código
        const montada = Boolean(this.composicaoDaPesquisa) && this.config.respostaMontada !== false && !tamanho;
        let texto = montada
          ? await this.comporResposta({ objetivo })
          : await this.redigir({
              objetivo,
              conversa,
              dossie,
              foco: focoComCheckpoint,
              rascunho: ctx.estado.rascunho,
              tamanho,
              cruzamento: cruzamentoTexto,
            });

        // 10/10 (SR-71 com qwen3.5:9b): resposta VAZIA era entregue como
        // "concluída" — só a lista de fontes. Uma nova tentativa; se continuar
        // vazia, os fatos do material vão como resposta, com o aviso.
        if (!String(texto || '').trim()) {
          this.emit('aviso', { texto: 'A redação voltou vazia; tentando de novo.' });
          this.emit('resposta-reinicia', { motivo: 'a resposta veio vazia — tentando de novo' });
          texto = await this.redigir({ objetivo, conversa, dossie, foco: focoComCheckpoint, rascunho: ctx.estado.rascunho, cruzamento: cruzamentoTexto });
          if (!String(texto || '').trim()) {
            const { fundidos } = fundir(dossie);
            texto = fundidos.length
              ? `Não consegui redigir a resposta, mas estes são os fatos que encontrei nas fontes:\n\n${fundidos.slice(0, 25).join('\n')}`
              : String(ctx.estado.rascunho || '').trim() || 'Não consegui redigir a resposta desta vez. Tente de novo ou troque o modelo em Ajustes.';
            this.emit('resposta-vazia', { recuperada: fundidos.length > 0 });
          }
        }

        // uma única segunda tentativa quando veio curto demais
        if (!montada && tamanho && tools.medirEntrega?.(texto, tamanho.unidade) < tamanho.quantidade * 0.7) {
          this.emit('aviso', { texto: 'Resposta veio curta; pedindo a versão completa.' });
          this.emit('resposta-reinicia', { motivo: 'a resposta ficou curta demais — completando' });
          texto = await this.redigir({
            objetivo,
            conversa,
            dossie,
            foco: `${ctx.estado.foco || ''}\nA versão anterior ficou curta demais. Desenvolva cada ponto até ${tamanho.quantidade} ${tamanho.unidade}.`,
            rascunho: texto,
            tamanho,
            cruzamento: cruzamentoTexto,
          });
        }

        // Verificação de evidências: os números e datas da resposta
        // aparecem no material? Uma reescrita no máximo — insistir com
        // modelo pequeno costuma degradar em vez de corrigir.
        const dossieBruto = dossie.map((d) => ({ texto: d.bruto || d.texto }));
        const conferir = (resposta) => {
          const v = verificador.verificar({
            resposta, dossie: dossieBruto, objetivo, assunto: this.opcoesDaPesquisa || [],
            conhecimentoGeral: this.tipoDoPedido === 'livre' || this.tipoDoPedido === 'explicacao',
          });
          // o texto do redator contra a série que o código calculou
          const daSerie = serieDePrecos.contradicoesComASerie(resposta, ctx.estado.serieDePrecos?.resultado?.analise);
          return daSerie.length ? { ...v, inconsistencias: [...v.inconsistencias, ...daSerie], reescrever: true, aprovado: false } : v;
        };
        let verificacao = conferir(texto);
        // Etapa I: afirmação numérica → evidência do livro (produto, valor E
        // condição) — "113 FPS em 1440p" quando o 113 é de 4K é contexto errado
        {
          const extras = this.composicaoDaPesquisa?.desempenho ? afirmacoes.extrasDoDesempenho(this.composicaoDaPesquisa.desempenho) : [];
          const conferidas = afirmacoes.verificarAfirmacoes(texto, ctx.tarefa?.livro, extras);
          if (conferidas.length) {
            this.emit('afirmacoes', { itens: conferidas });
            const erradas = conferidas.filter((c) => c.status === 'contexto-errado');
            if (erradas.length) {
              verificacao = {
                ...verificacao,
                inconsistencias: [...(verificacao.inconsistencias || []), ...erradas.map((e) => ({ tipo: 'contexto', valor: e.afirmacao.slice(0, 120), detalhe: e.motivo }))],
                reescrever: true,
                aprovado: false,
              };
            }
          }
        }
        this.emit('verificacao', { ...verificacao, tentativa: 1 });

        // resposta montada: os dados vieram do código e as frases do modelo já
        // foram conferidas uma a uma — reescrever com o redator livre desfaria isso
        if (verificacao.reescrever && !this.respostaComposta) {
          // Caso real (Davi, 2026-09-18): este evento sempre existiu, mas
          // saía sem nenhuma explicação — pro usuário parecia um glitch
          // ("para de escrever, apaga tudo, começa de novo"), quando na
          // verdade é o verificador rejeitando a resposta e pedindo pra
          // reescrever. `motivo` deixa isso visível na UI (ver
          // renderer/app.js, manipuladores['resposta-reinicia']).
          const motivoReescrita = !verificacao.respondeAoPedido
            ? 'a resposta pode não tratar do que foi pedido — reescrevendo'
            : verificacao.totalSuspeitas
              ? `encontrei ${verificacao.totalSuspeitas} valor(es) sem respaldo nas fontes — reescrevendo`
              : 'revisando a resposta';
          this.emit('resposta-reinicia', { motivo: motivoReescrita });

          // Bug real de produção (prova de 10 questões, DeepSeek R1
          // 8B): a correção original pedia "responda tudo que faltou" numa
          // ÚNICA chamada, com `rascunho: ''` — ou seja, descartava o que já
          // tinha sido respondido certo e mandava o modelo reescrever o
          // PEDIDO INTEIRO de novo (todas as perguntas de novo, na mesma
          // leva que já tinha derrapado uma vez). Na prática isso costumava
          // voltar só com a primeira questão respondida — o mesmo padrão que
          // apareceu nas 3 conversas reais analisadas com o Davi.
          //
          // Correção: quando o motivo de reescrever é "faltaram partes"
          // (pedido tipo prova, várias perguntas — `partesNaoRespondidas`),
          // cada parte que faltou vira um pedaço de quebra-cabeça isolado —
          // uma chamada de redação por parte, focada SÓ naquele item,
          // ACUMULANDA em cima do que já foi respondido (nunca descarta o
          // que já estava certo). Ao final, junta tudo e confere de novo
          // contra o pedido original (mesma verificação de sempre), exatamente
          // a sequência que o Davi descreveu: dividir, resolver um por um,
          // juntar, comparar com o pedido.
          //
          // O outro motivo de reescrever — "não respondeu ao pedido como um
          // todo" (sem partes rastreáveis) ou fabricação farta de números/
          // datas/nomes — continua com a reescrita monolítica de sempre: ali
          // não há pedaços pra dividir, e o texto (`corrigida`) substitui o
          // rascunho inteiro, como sempre foi.
          //
          // `partes.length >= 3` é o MESMO piso de "pedido tipo prova" que
          // `verificador.perguntasMultiplas` já usa (MIN_PERGUNTAS_MULTIPLAS).
          // Sem este piso, um pedido de UMA pergunta só (ex.: "qual o preço
          // da RTX 5080?") também aparece com 1 "parte não respondida"
          // sempre que a resposta cobre poucos termos do pedido — e cairia
          // aqui como se fosse "quebra-cabeça de várias partes" quando na
          // verdade é o mesmo caso de sempre (fora do assunto/fabricação),
          // que precisa da instrução de correção completa
          // (`instrucaoDeCorrecao`, com o pedido pra remover a suspeita), não
          // de uma reescrita item-a-item de um item só.
          if (verificacao.partes.length >= 3 && verificacao.partesNaoRespondidas.length) {
            let acumulado = texto;
            const faltantes = verificacao.partesNaoRespondidas.slice(0, MAX_PARTES_POR_REESCRITA);
            for (const parte of faltantes) {
              this.emit('resposta-reinicia', { motivo: `completando a parte que faltou: "${parte.slice(0, 70)}"` });
              // eslint-disable-next-line no-await-in-loop -- item a item, de propósito: cada parte usa o texto já acumulado como contexto do que não repetir
              const complemento = await this.redigir({
                objetivo,
                conversa,
                dossie,
                foco:
                  `${ctx.estado.foco || ''}\n\nResponda SOMENTE esta parte específica do pedido original, que ficou ` +
                  `faltando na resposta anterior: "${parte}". Não repita nem resuma o que já foi respondido — ` +
                  'escreva só o complemento direto para esta parte, sem preâmbulo.',
                rascunho: '',
                tamanho: null,
                cruzamento: cruzamentoTexto,
                semPlano: true,
              });
              // complemento que só repete a resposta (mesmos títulos, mesmas
              // linhas) não é complemento — 10º teste real: a resposta saiu 3x
              if (complemento && complemento.trim() && !verificador.complementoRepete(acumulado, complemento)) {
                acumulado = `${acumulado}\n\n${complemento.trim()}`;
              }
            }

            const revisada = conferir(acumulado);
            this.emit('verificacao', { ...revisada, tentativa: 2 });

            const persistentes = revisada.suspeitas.filter((s) =>
              verificacao.suspeitas.some((s0) => s0.tipo === s.tipo && s0.valor === s.valor)
            );

            // Melhora = cobriu mais (ou pelo menos não menos) partes do que
            // antes, sem que o pedido como um todo tenha deixado de ser
            // atendido — mesmo espírito do critério já usado no ramo
            // monolítico abaixo (nunca aceita uma "correção" que regride
            // `respondeAoPedido` de true pra false).
            const regrediuRespondeAoPedido = verificacao.respondeAoPedido && !revisada.respondeAoPedido;
            // melhora ESTRITA: cobrir as mesmas partes com mais texto não é melhora
            // (10º teste real — o "<=" aceitava a resposta repetida)
            const revisadaMelhora =
              acumulado !== texto &&
              !regrediuRespondeAoPedido &&
              revisada.partesNaoRespondidas.length < verificacao.partesNaoRespondidas.length;
            if (revisadaMelhora) {
              texto = acumulado;
              verificacao = revisada;
            } else {
              this.emit('resposta-reinicia', { motivo: 'a complementação não ficou melhor — mantendo a versão original' });
              this.emit('resposta-token', { pedaco: texto });
            }
            verificacao = { ...verificacao, suspeitasPersistentes: persistentes };
          } else {
            const corrigida = await this.redigir({
              objetivo,
              conversa,
              dossie,
              foco: `${ctx.estado.foco || ''}\n\n${verificador.instrucaoDeCorrecao(verificacao)}`,
              rascunho: '',
              tamanho,
              cruzamento: cruzamentoTexto,
            });
            const revisada = conferir(corrigida);
            this.emit('verificacao', { ...revisada, tentativa: 2 });

            // Caso real de produção: a instrução de correção pediu pra
            // remover um preço sem respaldo (RTX 5080 a R$ 11,50) e o modelo,
            // em vez de remover, só colocou uma ressalva em volta do MESMO
            // valor — a contagem de suspeitas não piorou, então a versão
            // "corrigida" era aceita como se o problema tivesse sido de fato
            // resolvido. `suspeitasPersistentes` marca quando a mesma
            // afirmação (tipo+valor) sobrevive às duas tentativas — sinal de
            // que a correção não corrigiu nada daquele ponto específico, por
            // mais que o total geral não tenha aumentado. Não apagamos nada da
            // resposta (ver verificador.js) — só paramos de tratar isso como
            // "sem novidade" na confiança final (calcularConfianca).
            const persistentes = revisada.suspeitas.filter((s) =>
              verificacao.suspeitas.some((s0) => s0.tipo === s.tipo && s0.valor === s.valor)
            );

            // Escolhe entre as duas tentativas — não só por contagem de
            // afirmações sem respaldo. Gap real encontrado numa bateria de
            // testes com o Davi (Testes 2 e 3): quando a PRIMEIRA tentativa já
            // não respondia ao pedido (é o próprio motivo de ter disparado
            // reescrita, via `!semMaterial && !respondeAoPedido`), as duas
            // versões empatam em suspeitas (0 e 0) e a regra decide só por
            // isso — sem alternativa melhor, não tem o que consertar aqui (ver
            // o aviso ao usuário logo abaixo, que é a correção pra ESSE caso).
            // O gap que ESTE critério fecha é outro, adjacente: quando a
            // PRIMEIRA tentativa dispara reescrita por fabricação farta
            // (`totalAfirmacoes >= 3 && proporcao >= 0.4`) mas ainda assim
            // respondia ao pedido, a regra antiga aceitava cegamente a segunda
            // tentativa sempre que ela tivesse suspeitas iguais ou menores —
            // mesmo que a correção tenha "consertado" os números indo pesquisar
            // de novo e escrevendo sobre outra coisa, regredindo de
            // `respondeAoPedido: true` pra `false`. Nunca aceita essa troca:
            // uma resposta sem invenção mas que abandona o que foi perguntado
            // não é uma melhora. Fora esse caso (regressão de respondeAoPedido
            // de true pra false), o desempate continua só pela contagem de
            // suspeitas, como sempre foi.
            const regrediuRespondeAoPedido = verificacao.respondeAoPedido && !revisada.respondeAoPedido;
            const revisadaMelhora =
              // reescrita VAZIA tem zero suspeitas e "ganhava" da original: a
              // resposta saía em branco, só com o aviso (SR-71, 10/10)
              Boolean(String(corrigida || '').trim()) &&
              !regrediuRespondeAoPedido &&
              revisada.totalSuspeitas <= verificacao.totalSuspeitas &&
              // número que não fecha (moeda, "média" que é faixa) não pode piorar
              (revisada.inconsistencias?.length || 0) <= (verificacao.inconsistencias?.length || 0);
            if (revisadaMelhora) {
              texto = corrigida;
              verificacao = revisada;
            } else {
              this.emit('resposta-reinicia', { motivo: 'a correção não ficou melhor — mantendo a versão original' });
              this.emit('resposta-token', { pedaco: texto });
            }
            verificacao = { ...verificacao, suspeitasPersistentes: persistentes };
          }
        }

        // Resposta FORA DO ASSUNTO não é entregue (12/10: "Compare 3 IEMs para
        // FPS e gere uma planilha" saiu falando de trabalhos de conclusão de
        // curso — a busca trouxe o repositório de uma faculdade de sigla FPS).
        // O sinal é estreito de propósito: NENHUM termo do pedido aparece na
        // resposta. Em 282 execuções reais isso pegou 6, quase todas lixo; o
        // "não responde ao pedido" mais amplo pegaria 62, a maioria respostas
        // aceitáveis. Uma tentativa só com o material que trata do assunto;
        // se continuar fora, o agente diz que não achou.
        // Resposta curta e direta ("Foi em 1969.") não repete as palavras da
        // pergunta e não é fora do assunto: só vale para texto longo, com material lido.
        if (!this.respostaComposta && dossie.length > 0 && String(texto).length >= 400 && verificacao.termosDoPedido >= 3 && verificacao.termosNaResposta === 0) {
          const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const termos = verificador.termosPrincipais(objetivo).map((t) => semAcento(t).slice(0, 5));
          const doAssunto = dossie.filter((d) => { const texto = semAcento(d.bruto || d.texto); return termos.filter((t) => texto.includes(t)).length >= Math.min(2, termos.length); });
          this.emit('resposta-reinicia', { motivo: 'a resposta saiu sobre outro assunto — refazendo só com o material que trata do pedido' });
          let recuperou = false;
          if (doAssunto.length && doAssunto.length < dossie.length) {
            const nova = await this.redigir({ objetivo, conversa, dossie: doAssunto, foco: ctx.estado.foco, rascunho: '', tamanho, cruzamento: '' });
            const conferida = conferir(nova);
            if (String(nova || '').trim() && conferida.termosNaResposta > 0) {
              texto = nova;
              verificacao = conferida;
              recuperou = true;
            }
          }
          if (!recuperou) {
            const buscas = [...new Set(dossie.map((d) => d.consulta).filter(Boolean))].slice(0, 6);
            texto =
              `Não consegui montar uma resposta confiável para este pedido: o que as buscas trouxeram trata de outro assunto.\n\n` +
              (buscas.length ? `**O que pesquisei:**\n${buscas.map((b) => `- ${b}`).join('\n')}\n\n` : '') +
              'Tente dizer de outro jeito — por exemplo, escrevendo por extenso o que está em sigla, ou citando os nomes do que quer comparar.';
            verificacao = { ...verificacao, foraDoAssunto: true };
            this.emit('resposta-token', { pedaco: texto });
          }
          this.emit('fora-do-assunto', { recuperou });
        }

        this.verificacao = verificacao;

        // Confiança declarada: junta o que já foi medido (cobertura,
        // confronto entre fontes, verificação de evidências) num só nível.
        // A função já existia pronta em verificador.js — só faltava ser
        // chamada e o evento chegar até a interface.
        const coberturaFinal = medirCobertura(objetivo, dossie);
        const marcadas = (ctx.estado.fontesLidas || []).filter((f) => f.alerta).length;
        this.confianca = verificador.calcularConfianca({
          verificacao,
          cobertura: coberturaFinal,
          cruzamento,
          fontes: (ctx.estado.fontesLidas || []).length,
          marcadas,
        });
        ctx.tarefa.registrarVerificacao({
          verificacao,
          cobertura: coberturaFinal,
          confianca: this.confianca,
        });
        this.emit('tarefa-atualizada', ctx.tarefa.serializar());
        this.emit('confianca', this.confianca);

        // Etapa B: tabela com estrela/preço que não está no material sai
        // antes de entregar (14º teste real: tabela inteira inventada)
        {
          const limpa = verificador.semDadoInventadoEmTabela(texto, dossie.map((d) => d.bruto || d.texto || '').join('\n'));
          if (limpa.removidas.length) {
            texto = limpa.texto;
            for (const r of limpa.removidas) this.emit('descarte', { etapa: 'resposta', alvo: r, motivo: 'dado sem fonte na tabela' });
            this.emit('aviso', { texto: `resposta: ${limpa.removidas.length} dado(s) de tabela sem fonte removido(s)` });
          }
        }
        const fontes = fontesDaResposta({
          doModelo: ctx.estado.fontes || [],
          daPesquisa: this.fontesDaPesquisa || [],
          dossie,
          preco: Boolean(ctx.estado.serieDePrecos) || /\bpre[cç]os?\b/i.test(objetivo),
        });
        final = fontes.length
          ? `${texto}\n\n---\n**Fontes**\n${fontes.map((f) => `- ${f}`).join('\n')}`
          : texto;

        // Bifurcação de interpretação sem confiança alta (ver
        // `decidirInterpretacao`): a resposta segue a leitura escolhida, mas
        // avisa da outra no final — determinístico, sem chamada extra ao
        // modelo.
        if (this.notaDeInterpretacao) {
          final = `${final}\n\n*(Entendi seu pedido assim — se na verdade era sobre "${this.notaDeInterpretacao}", me avise que refaço.)*`;
        }

        // Bug real de produção (bateria de testes com o Davi, "Testes 2 e
        // 3"): a verificação interna detectava que a resposta não tratava do
        // pedido, ou tinha fabricação farta, tentava reescrever uma vez, e
        // mesmo quando essa reescrita TAMBÉM não corrigia o problema, a
        // resposta era entregue calada — sem terceira tentativa, sem
        // qualquer sinal pro usuário de que o próprio sistema sabia que o
        // resultado não estava bom. Determinístico, sem chamada extra ao
        // modelo: mesmo padrão da nota de interpretação acima.
        //
        // Bug real de produção (2ª rodada, achado pelo Davi rodando de novo
        // um dos testes acima já com este aviso implementado): usar
        // `!verificacao.aprovado` aqui era bom demais pra disparar — uma
        // ÚNICA entidade sinalizada (ex.: "Linkagem Dinâmica", um SUBTÍTULO
        // da própria resposta, não uma invenção) já derruba `aprovado` pra
        // false, mesmo numa resposta longa, correta e que responde bem a
        // todas as partes do pedido (o mesmo padrão que
        // `verificacao.reescrever` já sabia ignorar: ver "um único nome
        // próprio sem respaldo não basta pra disparar reescrita sozinho",
        // em avaliacao/casos/verificacao.js). O aviso passa a usar o MESMO
        // critério de "problema sério o bastante" que decide reescrever —
        // não responder ao pedido, ou fabricação farta (3+ afirmações, 40%+
        // sem respaldo) — em vez do padrão bem mais rígido de `aprovado`
        // (zero suspeitas, qualquer que seja o tamanho ou a gravidade).
        // resposta montada pelo código (Etapa H): contagens e números vêm do
        // livro de evidências e a própria resposta diz o que faltou — só
        // inconsistência numérica ainda justifica o aviso
        // Revisão v4 (Simgot): resposta montada que deixou de fora produto que
        // o USUÁRIO nomeou respondeu outra pergunta — aviso mesmo montada
        const nomeadosForaDaResposta = this.respostaComposta
          ? produtosNomeados(objetivo).filter((n) => !normalizar(final).includes(normalizar(n)))
          : [];
        if (nomeadosForaDaResposta.length) this.emit('resposta-incompleta', { faltam: nomeadosForaDaResposta });
        const respostaFinalPreocupante =
          nomeadosForaDaResposta.length > 0 ||
          this.verificacao &&
          ((!this.respostaComposta &&
            ((!this.verificacao.respondeAoPedido && this.tipoDoPedido !== 'site') || (this.verificacao.totalAfirmacoes >= 3 && this.verificacao.proporcao >= 0.4))) ||
            (this.verificacao.inconsistencias?.length || 0) > 0);
        if (respostaFinalPreocupante) {
          final = `${final}\n\n*(Aviso: não consegui confirmar com segurança que esta resposta cobre bem o que foi pedido — pode valer a pena conferir por conta própria ou pedir de novo com mais contexto.)*`;
        }
      } catch (err) {
        if (!this.rodando) throw err;
        this.emit('aviso', { texto: `Falha ao redigir a resposta: ${err.message}` });
        final = ctx.estado.rascunho || String(saida);
      }
    }

    // Anexado aqui (não depois de retornar) porque quem lê a resposta de
    // verdade é o evento 'concluido' abaixo — a UI ao vivo e o registro
    // salvo em disco (registro.js escuta este evento, não o retorno da
    // função) ficariam sem a nota se ela só fosse colada no valor
    // devolvido pela chamadora.
    if (notaFinal) final = `${final}\n\n${notaFinal}`;

    // Gráfico montado (gerar_grafico, buscar_produtos, série de preços) que o
    // redator não copiou: entra no fim. O comentário de grafico.js sempre
    // prometeu isso ("melhor um gráfico no fim da resposta que gráfico
    // nenhum"), mas nada lia `ctx.estado.graficos` — o gráfico se perdia.
    // lista "top N" montada pelo código (11º teste real: o redator repetia os
    // finalistas como "outras opções")
    if (this.listaDaPesquisa && !final.includes(this.listaDaPesquisa.split('\n')[0])) {
      // 10/10: na resposta montada pelo código as opções já estão cada uma no
      // seu bloco — a lista só acrescenta as que NÃO foram comparadas (pedido
      // de "top 10" com 5 comparadas); repetir as 5 era redundância
      const extra = this.respostaComposta ? listaSemOsComparados(this.listaDaPesquisa, final) : this.listaDaPesquisa;
      if (extra) final = `${final}\n\n${extra}`;
    }
    const graficos = ctx.estado.graficos || [];
    if (graficos.length && !/```chart/.test(final)) final = `${final}\n\n${graficos.join('\n\n')}`;

    // Imagem de referência nas explicações que passaram pelo laço (as do
    // caminho rápido do AUTO ganham a delas em resposta-rapida.js). Depois da
    // verificação de propósito: é enfeite, não afirmação.
    if (this.tipoDoPedido === 'explicacao' && !this.respostaComposta && !final.includes(`${imagens.ESQUEMA}://`)) {
      const assunto = assuntoDoPedido(objetivo);
      const figura = await imagens.comLimite(imagens.imagemDeReferencia(assunto, { config: this.config, dir: this.dirImagens() }), 8000);
      if (figura) final = `${imagens.marcacao(assunto, figura)}\n\n${final}`;
    }

    // Contrato de conclusão (2026-09-27): item do plano que só uma
    // ferramenta cumpre e que ficou sem ela — a resposta diz, com todas as
    // letras, o que NÃO foi feito, em vez de só um aviso genérico no fim.
    const naoFeitos = this.itensNaoCumpridos(ctx);
    if (naoFeitos.length) {
      final = `${final}\n\n**O que ficou faltando do pedido:**\n${naoFeitos.map((t) => `- ${t}`).join('\n')}`;
      this.emit('contrato-incompleto', { itens: naoFeitos });
    }

    if (ctx.tarefa) {
      try {
        if (ctx.tarefa.estado !== ESTADOS_TAREFA.VERIFICANDO) {
          ctx.tarefa.transicionar(ESTADOS_TAREFA.VERIFICANDO, 'verificação final');
        }
        ctx.tarefa.transicionar(ESTADOS_TAREFA.CONCLUIDA, 'resposta preparada');
      } catch {
        // O modelo de tarefa é auxiliar; a conclusão do agente continua válida.
      }
      this.emit('tarefa-atualizada', ctx.tarefa.serializar());
    }

    this.memorizar(memory, `Concluído: ${final.slice(0, 600)}`, 'conclusao');
    this.refletir({ objetivo, operacional: ctx.operacional });
    await Promise.allSettled(this.aprendizado);
    await this.fotografarModelos();
    this.emit('concluido', {
      resumo: final,
      resposta: true,
      iteracoes: this.iteracao,
      uso: this.uso,
      verificacao: this.verificacao || null,
      confianca: this.confianca || null,
    });
    this.rodando = false;
    return final;


  }
}

module.exports = Redacao;
