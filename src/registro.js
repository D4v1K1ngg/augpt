'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Registro de execução.
 *
 * Fica no agente, e não na interface, para que o app e a bancada gravem
 * exatamente o mesmo formato. Sem isso, medição sintética e uso real viram
 * dois placares que não conversam.
 */

class Registro {
  constructor({ origem = 'app', modelo, host, caso = null } = {}) {
    this.dados = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      em: new Date().toISOString(),
      origem, // 'app' | 'bancada'
      caso, // nome do caso, quando vem da bancada
      modelo,
      modeloRedacao: null,
      host,
      pedido: '',
      resposta: '',
      resultado: null, // concluido | limite | interrompido | erro
      erro: null,
      duracaoMs: 0,
      passos: 0,
      maxPassos: 0,
      tokens: { prompt: 0, completion: 0, total: 0 },
      chamadas: { decisao: 0, redacao: 0, destilacao: 0 },
      // Pedido de Davi 2026-09-23 (nova janela "Visualizar Execuções",
      // gráfico "qual parte do raciocínio levou mais tempo e custou mais
      // tokens"): `tokens`/`chamadas` acima só guardam o total acumulado e
      // uma contagem — nunca POR CHAMADA. Cada item vem do evento
      // 'uso-chamada' (ver Agent.contabilizar(), loop.js), que agora carrega
      // tipo + tokens + duração de cada chamada individual ao modelo.
      // Capado em 400 (bem acima do normal — uma execução típica faz umas
      // dezenas de chamadas de modelo — só como teto de segurança contra uma
      // execução anômala inflar o JSON salvo).
      custoPorChamada: [], // { tipo, prompt, completion, duracaoMs } por chamada
      ferramentas: [],
      fontes: [],
      skills: [],
      aprovacoes: [],
      perguntas: 0,
      cobertura: null,
      verificacao: null,
      destilacoes: [],
      confronto: null,
      // Pedido de Davi 2026-09-23: ao revisar o último chat real (busca de
      // fones de ouvido), descobrimos que os dois mecanismos novos daquela
      // rodada — cross-validation de opinião (confronto.js) e descoberta de
      // autoridade em duas fases (web.js) — funcionam de verdade (a segunda
      // até bateu no novo teto de 11 buscas naquela execução), mas nenhum dos
      // dois fica visível no registro salvo nem na tela ao vivo. `autoridade`
      // é array porque o evento poderia em tese disparar mais de uma vez por
      // execução (mesmo o gate atual limitando a uma vez).
      autoridade: [], // { consulta, dominios } por ocorrência do evento 'autoridade-descoberta'
      // Motor de pesquisa (motor-pesquisa.js, 2026-09-24): plano, opções,
      // matriz, consultas feitas e o plano da resposta entregue ao redator.
      // Sem isto, o 1º teste real do motor não mostrava no registro quais
      // opções foram escolhidas nem o que o redator recebeu.
      pesquisaPlanejada: null,
      confianca: null,
      protocolo: [],
      avisos: [],
      // Pedido de Davi 2026-09-15: "anexar todo o raciocinio que podemos ver
      // na tela do chat junto do relatorio na aba execuções" — até aqui o
      // registro só guardava agregados (contagens, durações), nunca o TEXTO
      // do raciocínio/crítica que já aparece ao vivo na UI. Sem isso, revisar
      // uma execução passada pra diagnosticar um problema (ex.: o caso de
      // 2026-09-15 em que a mesma pergunta sobre relatividade saiu como um
      // ensaio de história da arte) dependia de reconstituir tudo na mão.
      entendimento: null, // { original, reescrito } — quando verificarAmbiguidade reescreve o objetivo
      passosDetalhados: [], // raciocínio de cada iteração: { n, pensamento, raciocinio, critica, plano }
      criticasAutomaticas: [], // crítica do Copiloto em cada checkpoint: { n, fase, texto }
      // Pedido de Davi 2026-09-18: "implemente uma nova função no relatório
      // pra vermos quando as AIs estão sendo usadas... 100% de certeza que
      // está funcionando" — até aqui só dava pra inferir "2 IAs" pelo
      // indicador ao vivo (#statusCopiloto), que não fica registrado em
      // lugar nenhum depois que a execução termina. Alimentado pelo evento
      // `'copiloto-consulta'` (ver Agent._perguntarAoCritico, loop.js) —
      // emitido em TODA consulta ao crítico, com o modelo REALMENTE usado,
      // não o configurado (dedicado só conta quando de fato caiu no modelo
      // separado). `porOrigem` distingue de onde cada consulta veio:
      // 'periodica' (crítica por intervalo de passos), 'sob-demanda' (o
      // próprio agente pediu), 'checkpoint:<fase>' (os 4 pontos fixos do
      // pipeline) ou 'aprovacao' (segunda opinião antes de um risco alto).
      copiloto: { consultas: 0, dedicado: 0, principal: 0, falhas: 0, modeloDedicado: null, porOrigem: {} },
      incidentes: {
        afirmacaoSemRespaldo: 0,
        divergenciaEntreFontes: 0,
        respostaReescrita: 0,
        protocoloInvalido: 0,
        protocoloRecuperado: 0,
        argumentosInvalidos: 0,
        ferramentaInvalida: 0,
        acaoRepetida: 0,
        perguntaPrematura: 0,
        respostaCurta: 0,
        nomeCorrigido: 0,
        ferramentaInexistente: 0,
        compactacoes: 0,
        errosDeFerramenta: 0,
      },
      // Etapa A (2026-09-28, revisão v2 do plano): o 14º teste real teve de
      // ser diagnosticado pelas URLs lidas — o registro não guardava as
      // consultas, os argumentos das ferramentas nem o plano. Agora guarda,
      // com IDs (B = busca, F = fonte lida, E = evidência do motor) pra
      // seguir "afirmação → evidência → fonte → busca".
      planoInicial: [], // passos do planejamento inicial, como o modelo escreveu
      checklist: [], // estado final do checklist: { texto, status }
      descartes: [], // o que o motor/escopo tirou do material e por quê: { etapa, alvo, motivo }
      dialogos: [], // revisão v3: perguntas ao usuário e o que ele respondeu: { pergunta, resposta }
      tipoDePedido: null, // revisão v3: { tipo: produto|guia|explicacao|local|livre, motivo }
      assuntoDaConversa: null, // revisão v3: referência genérica resolvida contra a conversa
      nota: null, // 1 a 5, dada pelo usuário depois
    };
    this.contadores = { busca: 0, fonte: 0, ferramenta: 0 };
    this.inicio = Date.now();
  }

  /** Assina os eventos do agente. Só lê — nunca interfere na execução. */
  acompanhar(agente) {
    const d = this.dados;

    // caminho rápido do AUTO: responde antes do 'inicio' do laço
    agente.on('inicio-rapido', (e) => {
      if (!d.pedido) d.pedido = String(e.objetivo || '').slice(0, 2000);
    });
    agente.on('inicio', (e) => {
      d.pedido = String(e.objetivo || '').slice(0, 2000);
      d.modelo = e.modelo || d.modelo;
      d.modeloRedacao = e.modeloRedacao || null;
      this.inicio = Date.now();
    });

    agente.on('iteracao', (e) => {
      d.passos = e.n;
      d.maxPassos = e.de;
    });

    agente.on('uso', (e) => {
      d.tokens = { prompt: e.prompt, completion: e.completion, total: e.prompt + e.completion };
    });

    agente.on('chamada', (e) => {
      d.chamadas[e.tipo] = (d.chamadas[e.tipo] || 0) + 1;
    });

    // Ver comentário no default de `custoPorChamada`, acima.
    agente.on('uso-chamada', (e) => {
      if (d.custoPorChamada.length < 400) {
        d.custoPorChamada.push({
          tipo: e.tipo,
          prompt: e.promptTokens || 0,
          completion: e.completionTokens || 0,
          duracaoMs: e.duracaoMs ?? null,
        });
      }
    });

    agente.on('resultado', (e) => {
      d.ferramentas.push({
        id: `T${String((this.contadores.ferramenta += 1)).padStart(3, '0')}`,
        nome: e.nome,
        ...(e.argumentos ? { argumentos: e.argumentos } : {}),
        passo: e.n,
        duracaoMs: e.duracao || 0,
        erro: e.erro || null,
        saidaChars: (e.saida || '').length,
      });
      if (!e.erro) return;

      d.incidentes.errosDeFerramenta += 1;
      const texto = String(e.erro);
      if (/Ação repetida/.test(texto)) d.incidentes.acaoRepetida += 1;
      if (/Pergunta prematura/.test(texto)) d.incidentes.perguntaPrematura += 1;
      if (/não existe ou está desativada|Ferramenta indisponível/.test(texto)) {
        d.incidentes.ferramentaInexistente += 1;
      }
    });

    agente.on('fonte', (e) => {
      // busca ganha "B001" e as consultas feitas; leitura ganha "F001" e a
      // busca de onde veio (a última busca antes dela — as ferramentas leem
      // em sequência, então é a dona da leitura)
      const busca = e.tipo === 'busca';
      const id = busca
        ? `B${String((this.contadores.busca += 1)).padStart(3, '0')}`
        : `F${String((this.contadores.fonte += 1)).padStart(3, '0')}`;
      d.fontes.push({
        id,
        tipo: e.tipo, provedor: e.provedor, url: e.url || null, falhas: e.falhas?.length || 0,
        ...(busca && e.consultas?.length ? { consultas: e.consultas.slice(0, 6).map((c) => String(c).slice(0, 200)) } : {}),
        ...(!busca && this.contadores.busca ? { busca: `B${String(this.contadores.busca).padStart(3, '0')}` } : {}),
        ...(e.tentativas?.length ? { tentativas: e.tentativas.slice(0, 6).map((t) => String(t).slice(0, 160)) } : {}),
      });
    });

    agente.on('planejamento-inicial', (e) => {
      d.planoInicial = (e.passos || []).slice(0, 12).map((p) => String(p).slice(0, 300));
    });
    // o último checklist emitido é o estado final (status de cada item)
    agente.on('checklist', (lista) => {
      if (Array.isArray(lista)) d.checklist = lista.slice(0, 20).map((i) => ({ texto: String(i.texto || '').slice(0, 300), status: i.status || 'pendente' }));
    });
    // Etapa I: cada afirmação numérica da resposta e a evidência que a sustenta (ou não)
    agente.on('afirmacoes', (e) => {
      d.afirmacoes = (e.itens || []).slice(0, 60).map(({ afirmacao, produto, valor, unidade, resolucao, status, evidencia, motivo }) => ({ afirmacao, produto, valor, unidade, resolucao, status, evidencia, motivo: motivo || null }));
    });
    agente.on('descarte', (e) => {
      if (d.descartes.length < 300) d.descartes.push({ etapa: e.etapa || '', alvo: String(e.alvo || '').slice(0, 200), motivo: String(e.motivo || '').slice(0, 200) });
    });

    agente.on('skills', (e) => {
      d.skills.push({ etapa: e.etapa, nomes: e.nomes });
    });

    agente.on('destilado', (e) => {
      d.destilacoes.push({ origem: e.origem, fatos: e.fatos, de: e.de, para: e.para });
    });

    // objetivo-reescrito só dispara quando verificarAmbiguidade() muda a
    // leitura do pedido (ver loop.js ~1686) — é o "entendimento" que Davi
    // perguntou sobre; guardar os dois lados deixa claro, ao revisar depois,
    // se o agente entendeu a pergunta errado desde o início.
    agente.on('objetivo-reescrito', (e) => {
      d.entendimento = { original: String(e.original || '').slice(0, 2000), reescrito: String(e.reescrito || '').slice(0, 2000) };
    });

    // raciocinio carrega, por iteração, o mesmo texto (pensamento/raciocínio/
    // crítica de risco) que a UI já mostra ao vivo em cada cartão "raciocínio"
    // — capado em 200 passos por segurança (maxIterations default é 25).
    agente.on('raciocinio', (e) => {
      if (d.passosDetalhados.length < 200) {
        d.passosDetalhados.push({
          n: e.n,
          pensamento: String(e.pensamento || '').slice(0, 2000),
          raciocinio: String(e.raciocinio || '').slice(0, 2000),
          critica: String(e.critica || '').slice(0, 1000),
          plano: Array.isArray(e.plano) ? e.plano.slice(0, 10) : [],
        });
      }
    });

    // critica-plano cobre tanto a crítica periódica de sempre (sem `fase`)
    // quanto os 4 checkpoints automáticos do Copiloto (`fase`: entendimento /
    // plano-inicial / parte-concluida / pre-redacao — ver Agent.criticaAutomatica
    // em loop.js). Guardar o texto de cada uma é o que falta pra saber, numa
    // execução passada, se o Copiloto já tinha sinalizado o problema.
    agente.on('critica-plano', (e) => {
      if (d.criticasAutomaticas.length < 50) {
        d.criticasAutomaticas.push({ n: e.n, fase: e.fase || 'periodica', texto: String(e.texto || '').slice(0, 2000) });
      }
    });

    // Ver comentário no default de `copiloto`, acima — este é o registro
    // "com 100% de certeza" que Davi pediu: toda consulta REAL ao crítico,
    // não só as que geraram texto (uma recusa "ok, nenhum problema" também
    // conta como consulta de verdade, e uma falha de rede também).
    // Linha do tempo de quando cada IA auxiliar entrou (pedido do Davi,
    // 2026-10-10): roteador (Tev1) e crítico/copiloto, com o passo em que
    // aconteceu. O resumo por contagem continua em `copiloto`, acima.
    const acionar = (item) => {
      if ((d.acionamentos ||= []).length < 80) d.acionamentos.push({ n: agente.iteracao || 0, ...item });
    };
    agente.on('tipo-de-pedido', (e) => {
      if (e?.decisor) {
        acionar({
          quem: 'roteador',
          modelo: e.decisor.modelo,
          detalhe: `respondeu "${e.decisor.valor}" (confiança ${typeof e.decisor.confianca === 'number' ? e.decisor.confianca.toFixed(2) : '?'}) — ${e.fonte === 'decisor' ? `trocou a regra ("${e.tipoDaRegra}" → "${e.tipo}")` : 'a regra foi mantida'}`,
          ms: e.ms ?? null,
          ok: true,
        });
      } else if (e?.falhaDoDecisor) {
        acionar({ quem: 'roteador', detalhe: `não respondeu (${e.falhaDoDecisor}) — a regra decidiu`, ms: e.ms ?? null, ok: false });
      }
    });
    agente.on('critica-por-evento', (e) => {
      acionar({ quem: 'crítico', detalhe: `acionado por evento: ${e?.evento || '?'}`, ok: true });
    });
    agente.on('modelos-na-execucao', (e) => {
      d.modelosNaExecucao = Array.isArray(e?.linhas) ? e.linhas.slice(0, 20) : [];
    });
    agente.on('copiloto-consulta', (e) => {
      acionar({ quem: 'crítico', modelo: e.modelo || null, detalhe: `${e.origem || 'consulta'}${e.dedicado ? ' · modelo dedicado' : ' · modelo principal'}${e.ok === false ? ` · falhou: ${String(e.erro || '').slice(0, 120)}` : ''}`, ok: e.ok !== false });
      const c = d.copiloto;
      c.consultas += 1;
      if (e.ok === false) c.falhas += 1;
      if (e.dedicado) {
        c.dedicado += 1;
        if (!c.modeloDedicado) c.modeloDedicado = e.modelo;
      } else {
        c.principal += 1;
      }
      const origem = e.origem || 'desconhecida';
      c.porOrigem[origem] = (c.porOrigem[origem] || 0) + 1;
    });

    agente.on('confianca', (e) => {
      d.confianca = { nivel: e.nivel, motivos: e.motivos };
    });

    agente.on('confronto', (e) => {
      d.confronto = {
        dominios: e.dominios,
        confirmados: e.confirmados.length,
        isolados: e.isolados.length,
        divergencias: e.divergencias.length,
        // Faltava aqui — a cross-validation de opinião (confronto.js,
        // divergenciasDeOpiniao) já roda e já entra no prompt de redação e no
        // cálculo de confiança, mas o evento 'confronto' inteiro nunca era
        // espalhado pro registro, só estes 4 campos escolhidos a dedo.
        divergenciasOpiniao: e.divergenciasOpiniao?.length || 0,
      };
      d.incidentes.divergenciaEntreFontes = e.divergencias.length;
    });

    // Ver comentário no default de `pesquisaPlanejada`, acima.
    const pesquisa = () => (d.pesquisaPlanejada ||= {});
    // Fase B (2026-09-26): mapa do problema e o que o material disse das hipóteses
    agente.on('serie-de-precos', (e) => {
      d.serieDePrecos = e;
    });
    agente.on('contrato-incompleto', (e) => {
      d.contratoIncompleto = e.itens || [];
    });
    agente.on('pesquisa-cadeia', (e) => {
      pesquisa().cadeia = { produto: e.produto, atividade: e.atividade, tipoDeUso: e.tipoDeUso, exige: e.exige, caracteristicas: e.caracteristicas, buscas: e.buscas };
    });
    agente.on('pesquisa-ordem', (e) => {
      pesquisa().ordem = e.ordem;
    });
    agente.on('pesquisa-criterios', (e) => {
      pesquisa().criteriosBase = { tipoDeUso: e.tipoDeUso, criterios: e.criterios, fontes: e.fontes };
    });
    agente.on('pesquisa-mapa', (e) => {
      pesquisa().mapa = { perfis: e.perfis, decide: e.decide, elimina: e.elimina || [], alternativas: e.alternativas, armadilhas: e.armadilhas, hipoteses: e.hipoteses };
    });
    agente.on('pesquisa-hipoteses', (e) => {
      pesquisa().hipoteses = e.hipoteses;
    });
    agente.on('pesquisa-plano', (e) => {
      pesquisa().plano = { uso: e.uso, criterios: e.criterios, opcoesCitadas: e.opcoesCitadas, descoberta: e.descoberta };
    });
    agente.on('pesquisa-candidatos', (e) => {
      pesquisa().candidatos = {
        finalistas: e.finalistas, outros: e.outros, propostos: e.propostos, descartados: e.descartados,
        origem: e.origem, resposta: e.resposta, criteriosDoMaterial: e.criteriosDoMaterial,
        // Fase C: lista larga por consenso (tópicos, sites, elogios, críticas, motivo) e 2ª rodada
        lista: e.lista || [], segundaRodada: e.segundaRodada || 0,
        motivoSegundaRodada: e.motivoSegundaRodada || '',
        foraDaCategoria: e.foraDaCategoria || [],
        // Etapa C: nomes achados em cada tópico pela extração por tópico
        topicos: e.topicos || [],
      };
    });
    // Etapa C: o livro de evidências inteiro (com IDs) — de onde a tabela, as
    // citações e o ranking saíram
    // Etapa F: comparação de desempenho A × B (números calculados pelo código)
    agente.on('pesquisa-desempenho', (e) => {
      pesquisa().desempenho = e;
    });
    // revisão v2: qual caminho do motor rodou (recomendação, desempenho, uso)
    // núcleo de pesquisa (13/10): profundidade usada e se o pedido era de produto
    agente.on('nucleo-entendimento', (e) => {
      d.nucleo = { modo: e.modo || null, produto: e.produto === true };
    });
    agente.on('pesquisa-modo', (e) => {
      pesquisa().modo = e.modo;
    });
    // Etapa G: dado de uso entre profissionais (contagem pelo código)
    // revisão v3: dicas do modo guia, tipo do pedido e assunto da conversa
    agente.on('pesquisa-guia', (e) => {
      pesquisa().guia = { tema: e.tema, topicos: (e.topicos || []).slice(0, 20), dicas: (e.dicas || []).slice(0, 30) };
    });
    agente.on('tipo-de-pedido', (e) => {
      d.tipoDePedido = { tipo: e?.tipo || null, motivo: e?.motivo || null };
      // roteador híbrido: quem decidiu e o que a regra dizia — é o que permite
      // medir, nos registros reais, se o modelo de decisão acerta mais
      if (e?.fonte) d.tipoDePedido.fonte = e.fonte;
      if (e?.tipoDaRegra && e.tipoDaRegra !== e.tipo) d.tipoDePedido.tipoDaRegra = e.tipoDaRegra;
      if (e?.decisor) d.tipoDePedido.decisor = { modelo: e.decisor.modelo, valor: e.decisor.valor, confianca: e.decisor.confianca };
      if (typeof e?.ms === 'number') d.tipoDePedido.ms = e.ms;
      if (e?.falhaDoDecisor) d.tipoDePedido.falhaDoDecisor = e.falhaDoDecisor;
    });
    // retomada (retomada.js): o que a execução interrompida deixou e o que foi de fato reaproveitado
    const retomada = () => (d.retomada = d.retomada || { disponiveis: { paginas: 0, destilacoes: 0 }, paginasUsadas: 0, destilacoesUsadas: 0 });
    agente.on('retomada', (e) => {
      retomada().disponiveis = { paginas: e?.paginas || 0, destilacoes: e?.destilacoes || 0 };
    });
    agente.on('cache-usado', (e) => {
      if (e?.retomada) retomada().paginasUsadas += 1;
      if (e?.preBusca) (d.preBusca ||= { buscas: 0, paginas: 0 }).paginas += 1;
    });
    agente.on('prebusca-usada', () => {
      (d.preBusca ||= { buscas: 0, paginas: 0 }).buscas += 1;
    });
    agente.on('destilacao-retomada', () => {
      retomada().destilacoesUsadas += 1;
    });
    // modo AUTO (auto.js): nível escolhido, por quê, o que foi desligado e,
    // nos níveis 0/1, o que a resposta rápida usou e corrigiu
    agente.on('nivel-auto', (e) => {
      const anterior = d.auto?.nivel;
      d.auto = {
        nivel: e?.nivel ?? null,
        nome: e?.nome || null,
        motivo: e?.motivo || null,
        ajustes: e?.ajustes || {},
        ...(anterior !== undefined && anterior !== null && anterior !== e?.nivel ? { nivelInicial: d.auto.nivelInicial ?? anterior } : {}),
      };
    });
    agente.on('resposta-rapida', (e) => {
      (d.auto ||= {}).rapida = {
        wikis: e?.wikis || [], paginas: e?.paginas || [], fatosConferiveis: e?.fatosConferiveis || 0,
        correcoes: e?.correcoes || [], ms: e?.ms ?? null,
      };
    });
    agente.on('resposta-vazia', (e) => {
      d.respostaVazia = { recuperada: Boolean(e?.recuperada) };
    });
    agente.on('assunto-da-conversa', (e) => {
      d.assuntoDaConversa = { assunto: e?.assunto || null, motivo: e?.motivo || null, objetivo: String(e?.objetivo || '').slice(0, 400) };
    });
    agente.on('pesquisa-uso', (e) => {
      pesquisa().uso = e;
    });
    agente.on('pesquisa-evidencias', (e) => {
      pesquisa().evidencias = e.itens || [];
    });
    agente.on('pesquisa-matriz', (e) => {
      pesquisa().matriz = {
        cobertura: e.cobertura, coberturaTextual: e.coberturaTextual, descartadas: e.descartadas,
        lacunas: e.lacunas, opcoes: e.opcoes, criterios: e.criterios,
        // ficha técnica e opinião da comunidade por opção (pesquisa por produto, 8º teste real)
        resumos: e.resumos || [],
      };
    });
    // 14/10: dossiê de cada produto e o cartão escrito — refazer só a escrita
    // de uma execução real (avaliacao/reescrever.js) parte daqui
    agente.on('pesquisa-cartoes', (e) => {
      pesquisa().cartoes = e;
    });
    agente.on('pesquisa-fim', (e) => {
      Object.assign(pesquisa(), {
        ok: e.ok, motivo: e.motivo, buscas: e.buscas, consultas: e.consultas, planoDeResposta: e.planoDeResposta,
      });
    });

    // Ver comentário no default de `autoridade`, acima.
    agente.on('autoridade-descoberta', (e) => {
      if (d.autoridade.length < 20) {
        d.autoridade.push({ consulta: String(e.consulta || '').slice(0, 300), dominios: e.dominios || [] });
      }
    });

    agente.on('verificacao', (e) => {
      d.verificacao = {
        tentativa: e.tentativa,
        suspeitas: e.suspeitas,
        totalSuspeitas: e.totalSuspeitas,
        totalAfirmacoes: e.totalAfirmacoes,
        respondeAoPedido: e.respondeAoPedido,
        aprovado: e.aprovado,
      };
      d.incidentes.afirmacaoSemRespaldo = e.totalSuspeitas;
      if (e.tentativa > 1) d.incidentes.respostaReescrita = 1;
    });

    agente.on('cobertura', (e) => {
      d.cobertura = { nivel: e.nivel, encontrados: e.encontrados, total: e.total };
    });

    agente.on('aprovacao', (e) => d.aprovacoes.push({ nome: e.nome, risco: e.risco, decisao: null }));
    agente.on('aprovacao-resolvida', (e) => {
      const alvo = [...d.aprovacoes].reverse().find((a) => a.nome === e.nome && a.decisao === null);
      if (alvo) alvo.decisao = e.decisao;
    });

    agente.on('pergunta', () => {
      d.perguntas += 1;
    });
    agente.on('pergunta-respondida', (e) => {
      if (d.dialogos.length < 20) d.dialogos.push({ pergunta: String(e?.pergunta || '').slice(0, 400), resposta: String(e?.resposta ?? '').slice(0, 800) });
    });

    agente.on('protocolo-invalido', (e) => {
      d.incidentes.protocoloInvalido += 1;
      if (e?.estado === 'argumentos-invalidos') d.incidentes.argumentosInvalidos += 1;
      if (e?.estado === 'ferramenta-invalida') d.incidentes.ferramentaInvalida += 1;
      if (d.protocolo.length < 10) d.protocolo.push({ estado: e?.estado, motivo: e?.motivo });
    });

    agente.on('protocolo-recuperado', (e) => {
      d.incidentes.protocoloRecuperado += 1;
      if (d.protocolo.length < 10) d.protocolo.push({ estado: 'recuperado', motivo: e.via });
    });
    agente.on('compactado', () => {
      d.incidentes.compactacoes += 1;
    });
    agente.on('aviso', (e) => {
      const texto = String(e.texto || '');
      if (/curta/.test(texto)) d.incidentes.respostaCurta += 1;
      if (d.avisos.length < 20) d.avisos.push(texto.slice(0, 200));
    });

    agente.on('concluido', (e) => this.encerrar('concluido', e.resumo));
    agente.on('limite', () => this.encerrar('limite'));
    agente.on('resposta-incompleta', (e) => {
      d.respostaIncompleta = e.faltam || [];
    });
    agente.on('redigindo', (e) => {
      if (e?.cobertura === 'montada pelo código') d.respostaMontada = true;
    });
    agente.on('download-concluido', (e) => {
      (d.downloads ||= []).push({ nome: e.nome, caminho: e.caminho, bytes: e.bytes });
    });
    agente.on('limite-atingido', () => {
      d.limiteAtingido = true;
    });
    // Controlador v2 (05/10): janela de contexto e portões novos
    agente.on('contexto-saturado', () => {
      d.incidentes.contextoSaturado = (d.incidentes.contextoSaturado || 0) + 1;
    });
    agente.on('contexto-ajustado', (e) => {
      d.incidentes.contextoAjustado = (d.incidentes.contextoAjustado || 0) + 1;
      if ((d.contextoAjustes ||= []).length < 30) d.contextoAjustes.push({ n: e.n, cortes: e.cortes, estimativaTokens: e.estimativaTokens, orcamentoTokens: e.orcamentoTokens });
    });
    agente.on('critica-por-evento', (e) => {
      if ((d.criticasPorEvento ||= []).length < 30) d.criticasPorEvento.push({ n: e.n, evento: e.evento });
    });
    agente.on('interrompido', () => this.encerrar('interrompido'));
    agente.on('erro', (e) => this.encerrar('erro', null, e.mensagem));

    return this;
  }

  encerrar(resultado, resposta = null, erro = null) {
    if (this.dados.resultado) return this.dados; // já encerrado
    const d = this.dados;
    d.resultado = resultado;
    d.duracaoMs = Date.now() - this.inicio;
    if (resposta) d.resposta = String(resposta).slice(0, 20000);
    if (erro) d.erro = String(erro).slice(0, 500);
    d.incidentes.nomeCorrigido = d.ferramentas.filter((f) => /nome corrigido/.test(f.erro || '')).length;
    d.statusDaTarefa = statusDaTarefa(d);
    return d;
  }

  get resumo() {
    const d = this.dados;
    return {
      passos: d.passos,
      ferramentas: d.ferramentas.length,
      erros: d.incidentes.errosDeFerramenta,
      duracaoMs: d.duracaoMs,
      tokens: d.tokens.total,
      fontes: d.fontes.filter((f) => f.tipo === 'leitura').length,
    };
  }
}

/**
 * Status da TAREFA (Controlador v2, 05/10), separado de `resultado` (que só
 * diz como a execução terminou). "concluido" com uma resposta que diz "não
 * encontrei o contracheque" não é sucesso. Calculado pelo código:
 *   falha       — sem resposta, erro, ou interrompida/limite sem resposta
 *   parcial     — itens do plano não feitos, limite
 *                 de passos atingido, contrato incompleto ou a própria
 *                 resposta admitindo que não conseguiu
 *   sucesso     — o resto
 */
const RESPOSTA_ADMITE_FALHA =
  /\b(n[aã]o (foi poss[ií]vel|consegui|encontrei|achei|localizei|carregou|tenho acesso)|n[aã]o pude|sem sucesso)\b/i;
/**
 * Itens de ENTREGA ("responder", "apresentar o resultado", "resumir para o
 * usuário"…) são cumpridos pela própria resposta — não contam como pendentes.
 */
const ITEM_DE_ENTREGA =
  /^(responder|entregar|escrever|redigir|apresentar|informar|mostrar|resumir|relatar|comunicar|reportar|enviar a resposta|dar a resposta|montar a resposta|fornecer|devolver)/i;
function statusDaTarefa(d) {
  const motivos = [];
  if (!d.resposta || ['erro', 'interrompido', 'limite'].includes(d.resultado)) {
    return { status: d.resultado === 'interrompido' ? 'interrompido' : 'falha', motivos: [d.resultado || 'sem resposta'] };
  }
  const naoFeitos = (d.checklist || []).filter((i) => i.status !== 'feito' && !ITEM_DE_ENTREGA.test(String(i.texto || '').trim()));
  if (naoFeitos.length) motivos.push(`${naoFeitos.length} item(ns) do plano não feito(s)`);
  if (d.limiteAtingido) motivos.push('limite de passos atingido');
  if (d.contratoIncompleto?.length) motivos.push('parte do pedido não entregue');
  // revisão v4 (Simgot): o verificador já dizia que a resposta não tratava do
  // pedido e o status saía "sucesso"
  // (só em pedido de pesquisa/resposta: em ação num site, o verificador mede
  // cobertura de texto e marca "Contracheque emitido." como fora do pedido)
  if (d.respostaIncompleta?.length) motivos.push(`a resposta deixou de fora: ${d.respostaIncompleta.join(', ')}`);
  // resposta montada pelo código: o verificador de texto não vale (o loop também ignora)
  if (d.verificacao?.respondeAoPedido === false && !d.respostaMontada && !['site', 'local'].includes(d.tipoDePedido?.tipo)) motivos.push('o verificador indica que a resposta não trata do que foi pedido');
  // avisos do próprio sistema ("*(Aviso: não consegui confirmar…)*") não contam.
  // Só o começo e o fim (revisão): no meio de uma resposta longa, "não
  // encontrei avaliação do modelo X" é detalhe de um item, não fracasso da
  // tarefa; quem não conseguiu diz isso logo de cara ou no fechamento.
  const texto = String(d.resposta).replace(/\*\([\s\S]*?\)\*/g, ' ').trim();
  const pontas = texto.length > 1200 ? `${texto.slice(0, 600)}\n${texto.slice(-600)}` : texto;
  if (RESPOSTA_ADMITE_FALHA.test(pontas)) motivos.push('a resposta diz que não conseguiu parte do pedido');
  return { status: motivos.length ? 'parcial' : 'sucesso', motivos };
}

/* ------------------------------ armazenamento ------------------------------ */

// pergunta/produto pelo núcleo; nos registros antigos, pelo tipo do pedido
function tipoDaExecucao(r) {
  if (r.nucleo) return r.nucleo.produto ? 'produto' : 'pergunta';
  const t = r.tipoDePedido?.tipo;
  if (t === 'produto') return 'produto';
  // registros do núcleo gravados antes do campo `nucleo`: só buscaram e leram
  if (t === 'guia' || t === 'explicacao' || (!r.ferramentas.length && r.fontes.length)) return 'pergunta';
  return 'tarefa';
}

function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

class Registros {
  constructor(dir, limite = 300) {
    this.dir = dir;
    this.limite = limite;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  salvar(dados) {
    const arquivo = this.caminhoDe(dados?.id);
    if (!arquivo) return null;
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
    this.podar();
    return dados;
  }

  /** Mantém só as N execuções mais recentes; histórico infinito não serve a nada. */
  podar() {
    const arquivos = fs
      .readdirSync(this.dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    for (const antigo of arquivos.slice(0, Math.max(0, arquivos.length - this.limite))) {
      fs.unlinkSync(path.join(this.dir, antigo));
    }
  }

  /**
   * Fase 1 de segurança (2026-09-23): o id vem da interface (`runs:read`,
   * `runs:delete`, `runs:rate`) e virava nome de arquivo sem conferência —
   * `runs:delete('../../algum')` apagava qualquer .json que o usuário pudesse
   * escrever. Ids gerados aqui são só letras, números e hífen (ver
   * Registro.constructor); qualquer outra coisa é recusada. Mesma ideia da
   * checagem de id em src/conversas.js.
   */
  caminhoDe(id) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id ?? ''))) return null;
    return path.join(this.dir, `${id}.json`);
  }

  ler(id) {
    const arquivo = this.caminhoDe(id);
    if (!arquivo) return null;
    try {
      return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    } catch {
      return null;
    }
  }

  todas() {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.em).localeCompare(String(a.em)));
    } catch {
      return [];
    }
  }

  listar(filtro = {}) {
    return this.todas()
      .filter((r) => !filtro.origem || r.origem === filtro.origem)
      .filter((r) => !filtro.modelo || r.modelo === filtro.modelo)
      .map((r) => ({
        id: r.id,
        em: r.em,
        origem: r.origem,
        caso: r.caso,
        modelo: r.modelo,
        pedido: r.pedido.slice(0, 120),
        resultado: r.resultado,
        passos: r.passos,
        duracaoMs: r.duracaoMs,
        tokens: r.tokens.total,
        ferramentas: r.ferramentas.length,
        erros: r.incidentes.errosDeFerramenta,
        fontes: r.fontes.filter((f) => f.tipo === 'leitura').length,
        cobertura: r.cobertura?.nivel || null,
        nota: r.nota,
        // Resumo pro cartão da lista (ver renderer/app.js, pintarExecucoes) —
        // não precisa abrir o relatório inteiro só pra confirmar que "2 IAs"
        // consultou o modelo dedicado nesta execução. `?.` cobre registros
        // salvos ANTES deste campo existir (sem quebrar a lista).
        // Fase 1 (16/10): tipo, profundidade, buscas e sites pro cartão e os filtros
        tipo: tipoDaExecucao(r),
        profundidade: r.nucleo?.modo || null,
        buscas: r.fontes.filter((f) => f.tipo === 'busca').length,
        sites: [...new Set(r.fontes.filter((f) => f.tipo === 'leitura' && f.url).map((f) => hostDe(f.url)).filter(Boolean))],
        copilotoDedicado: r.copiloto?.dedicado || 0,
        copilotoConsultas: r.copiloto?.consultas || 0,
      }));
  }

  avaliar(id, nota) {
    const registro = this.ler(id);
    if (!registro) return null;
    registro.nota = Math.max(1, Math.min(5, Number(nota) || 0)) || null;
    return this.salvar(registro);
  }

  excluir(id) {
    const arquivo = this.caminhoDe(id);
    if (!arquivo) return false;
    try {
      fs.unlinkSync(arquivo);
      return true;
    } catch {
      return false;
    }
  }

  limpar(origem = null) {
    const alvos = this.todas().filter((r) => !origem || r.origem === origem);
    alvos.forEach((r) => this.excluir(r.id));
    return alvos.length;
  }

  /** Agregado por modelo — é a tabela que decide qual modelo usar. */
  estatisticas(filtro = {}) {
    const registros = this.todas()
      .filter((r) => !filtro.origem || r.origem === filtro.origem)
      .filter((r) => r.resultado);

    const porModelo = new Map();
    for (const r of registros) {
      const chave =
        r.modeloRedacao && r.modeloRedacao !== r.modelo
          ? `${r.modelo} → ${r.modeloRedacao}`
          : r.modelo || 'desconhecido';
      if (!porModelo.has(chave)) {
        porModelo.set(chave, {
          modelo: chave, execucoes: 0, concluidas: 0, passos: 0, duracaoMs: 0,
          tokens: 0, erros: 0, perguntas: 0, notas: [], incidentes: 0,
        });
      }
      const m = porModelo.get(chave);
      m.execucoes += 1;
      if (r.resultado === 'concluido') m.concluidas += 1;
      m.passos += r.passos;
      m.duracaoMs += r.duracaoMs;
      m.tokens += r.tokens.total;
      m.erros += r.incidentes.errosDeFerramenta;
      m.perguntas += r.perguntas;
      m.incidentes +=
        r.incidentes.protocoloInvalido + r.incidentes.acaoRepetida + r.incidentes.perguntaPrematura;
      if (r.nota) m.notas.push(r.nota);
    }

    return [...porModelo.values()]
      .map((m) => ({
        modelo: m.modelo,
        execucoes: m.execucoes,
        conclusao: Math.round((m.concluidas / m.execucoes) * 100),
        passosMedios: Number((m.passos / m.execucoes).toFixed(1)),
        segundosMedios: Number((m.duracaoMs / m.execucoes / 1000).toFixed(1)),
        tokensMedios: Math.round(m.tokens / m.execucoes),
        errosPorExecucao: Number((m.erros / m.execucoes).toFixed(1)),
        incidentesPorExecucao: Number((m.incidentes / m.execucoes).toFixed(1)),
        perguntasPorExecucao: Number((m.perguntas / m.execucoes).toFixed(1)),
        nota: m.notas.length ? Number((m.notas.reduce((a, b) => a + b, 0) / m.notas.length).toFixed(1)) : null,
        avaliadas: m.notas.length,
      }))
      .sort((a, b) => b.execucoes - a.execucoes);
  }
}

module.exports = {
  statusDaTarefa, Registro, Registros };
