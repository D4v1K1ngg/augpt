'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Agent } = require('../src/agent/loop');
const { Registro, Registros } = require('../src/registro');
const { Skills } = require('../src/skills');
const tools = require('../src/tools');

/**
 * Motor da bancada.
 *
 * A ideia: não dá para testar a inteligência do modelo, mas dá para testar tudo
 * em volta dela — e foi ali que moraram todos os bugs que encontramos. Um
 * servidor falso responde no lugar do Ollama seguindo um roteiro fixo, então o
 * mesmo caso dá sempre o mesmo resultado.
 */

const RAIZ = path.join(os.tmpdir(), 'augpt-avaliacao');

/* ------------------------------ servidor falso ------------------------------ */

function servidorFalso({
  modelosCarregados = [],
  roteiro = [], redacao = null, destilacao = null, parametros = null, embeddings = false,
  // resposta da verificação de ambiguidade (item 4): 'suficiente' por padrão,
  // pra não afetar nenhum caso que não testa isso de propósito — só os casos
  // que passam algo diferente (ou uma função) exercitam o caminho "faltou algo".
  ambiguidade = 'suficiente',
  // criação automática de skills (item 5): rascunho de SKILL.md (objeto ou
  // função que recebe o prompt cru e devolve o objeto) e resposta da
  // autoavaliação do autoteste — ambos com um padrão inofensivo, só os casos
  // que testam isso de propósito passam algo diferente.
  rascunhoDeSkill = { nome: 'Skill de teste', descricao: 'Skill de teste gerada automaticamente.', gatilhos: ['teste'], corpo: 'Método de teste.' },
  autoavaliacaoDeSkill = 'passou: concluiu a tarefa dentro do esperado',
  // crítico de interpretação (bifurcação): só é chamado quando `ambiguidade`
  // devolveu uma linha BIFURCACAO — padrão inofensivo (escolhe A, confiança
  // alta), só os casos que testam isso de propósito passam algo diferente.
  criticaDeInterpretacao = 'ESCOLHA: A\nCONFIANCA: alta\nMOTIVO: teste',
  // crítico do plano (criticaDoPlano/CRITICA_PERIODICA_*): sem interceptação
  // própria, essa chamada caía no balde genérico de destilação e podia virar
  // uma "observação" arbitrária (a heurística de destilação, não "ok") sempre
  // que a crítica disparasse num caso que não testa isso de propósito — 'ok'
  // é o padrão inofensivo (loop.js descarta observação == 'ok').
  criticaDoPlano = 'ok',
  // planejamento inicial forçado (item novo: planejarInicial/
  // classificarPedido) — string vazia é o padrão inofensivo: sem linhas,
  // `planejarInicial` devolve lista vazia e o checklist não é semeado, então
  // nenhum caso que não testa isso de propósito é afetado.
  planejamentoInicial = '',
  // Consulta sob demanda ao crítico (Copiloto nível 2, `consultar_critico`)
  // — sem interceptação própria cairia no balde de destilação, mesma razão
  // das interceptações acima. Padrão inofensivo, só os casos que testam a
  // ferramenta de propósito passam algo diferente.
  consultaCritico = 'Parece no caminho certo, continue.',
  // Checkpoint automático do Copiloto (item novo 2026-09-14: "apertar as
  // rédeas", criticaAutomatica em loop.js, 4 pontos fixos do pipeline) — sem
  // interceptação própria cairia no balde de destilação, mesma razão das
  // interceptações acima. 'ok' é o padrão inofensivo (mesmo filtro de
  // criticaDoPlano: criticaAutomatica descarta 'ok' e não emite evento) —
  // com pipelineForcadoUniversal true por padrão, esta chamada dispara em
  // praticamente todo caso da bancada, então o padrão TEM que ser inofensivo.
  criticaAutomatica = 'ok',
  // Motor de pesquisa (motor-pesquisa.js): plano de pesquisa e lista de
  // opções — mesma razão das interceptações acima (sem format:json, cairiam
  // no balde de destilação). Padrões inofensivos: plano vazio = motor não
  // completa, NENHUMA = nenhuma opção. A bancada já deixa o motor desligado
  // por padrão (ver `motorDePesquisa` na config abaixo).
  planoDePesquisa = '',
  candidatosDePesquisa = 'NENHUMA',
  // julgamento das células (uma chamada por finalista) — vazio = nenhum
  // veredito, a célula fica com o trecho cru (comportamento anterior)
  julgamentoDePesquisa = '',
  // Fase B da pesquisa pela comunidade: mapa do problema (vazio = sem mapa,
  // o motor segue só com o plano) e avaliação das hipóteses
  mapaDoProblema = '',
  hipotesesDePesquisa = '',
  // cadeia do uso e critérios do conhecimento (2026-09-28): vazio = sem
  // cadeia, o motor não faz busca de conhecimento (nenhum caso antigo muda)
  cadeiaDoUso = '',
  criteriosDoConhecimento = '',
  // Etapa C (revisão v2): extração POR TÓPICO — string, ou função(prompt)
  // que devolve as linhas "produto | nº". 'NENHUM' = nenhum caso antigo muda.
  produtosDoTopico = 'NENHUM',
  // Etapa H: frases curtas da resposta montada — string ou função(prompt)
  frasesDaResposta = '',
  // revisão v3 (Fase 1): dicas por tópico do modo guia — string ou função(prompt)
  dicasDoTopico = 'NENHUMA',
  // revisão v5: o que o /api/show falso responde em `capabilities`
  capacidadesDoModelo = ['completion', 'tools'],
}) {
  const registro = {
    decisao: [], redacao: [], destilacao: [], reflexao: [], ambiguidade: [],
    rascunhoDeSkill: [], autoavaliacaoDeSkill: [], criticaDeInterpretacao: [],
    criticaPlano: [], planejamentoInicial: [], consultaCritico: [], criticaAutomatica: [],
    planoDePesquisa: [], candidatosDePesquisa: [], julgamentoDePesquisa: [], mapaDoProblema: [], hipotesesDePesquisa: [],
    cadeiaDoUso: [], criteriosDoConhecimento: [], produtosDoTopico: [], frasesDaResposta: [], dicasDoTopico: [],
    esquemas: [], mensagens: [], pensarDecisao: [], opcoesDecisao: [], embeddings: 0, chamadas: 0,
  };
  let passo = 0;

  const servidor = http.createServer((req, res) => {
    if (/\/api\/(embed|embeddings)/.test(req.url) && !embeddings) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"error":"model not found"}');
    }
    if (/\/api\/version/.test(req.url)) {
      res.setHeader('Content-Type', 'application/json');
      return res.end('{"version":"falso"}');
    }
    // 2026-10-10: quadro de modelos (GET /api/ps) e roteador (POST
    // /v1/systemone) não são chamadas de modelo — sem isto caíam no roteiro
    // e consumiam um passo. /v1/systemone responde 404, como um Ollama
    // anterior à 0.35 (o caso que quer um decisor troca `ollama.decidir`).
    if (/\/api\/ps/.test(req.url)) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ models: modelosCarregados }));
    }
    if (/\/v1\/systemone/.test(req.url)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"error":"404 page not found"}');
    }
    // revisão v5: o agente consulta as capacidades do modelo (POST /api/show)
    // no início — não é chamada de modelo, não entra na contagem
    if (/\/api\/show/.test(req.url)) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ capabilities: capacidadesDoModelo }));
    }

    let corpo = '';
    req.on('data', (d) => {
      corpo += d;
    });
    req.on('end', () => {
      let pedido = {};
      try {
        pedido = JSON.parse(corpo || '{}');
      } catch {
        /* ignora */
      }

      if (/\/api\/(embed|embeddings)/.test(req.url)) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ embeddings: [Array(16).fill(0.1)] }));
      }

      registro.chamadas += 1;
      const conteudoDoPrompt = JSON.stringify(pedido.messages || []);

      // Verificação de ambiguidade (item 4): chamada única, ANTES da primeira
      // decisão, sem format:json — cairia no balde de "destilação" (sem stream,
      // sem format) se não for identificada aqui, poluindo a contagem que
      // outros casos usam pra saber em qual chamada de destilação estão.
      {
        const textoCru = (pedido.messages || []).map((m) => m.content).join('\n');
        if (/Isto tem informação suficiente pra agir AGORA/.test(textoCru)) {
          registro.ambiguidade.push(conteudoDoPrompt);
          const texto = typeof ambiguidade === 'function' ? ambiguidade(conteudoDoPrompt) : ambiguidade;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }

        // Criação automática de skills (item 5): rascunho da skill e
        // autoavaliação do autoteste — mesma razão das interceptações acima:
        // sem format:json, cairiam no balde de destilação e poluiriam a
        // contagem que outros casos usam.
        // Crítico de interpretação: chamada condicional, só acontece quando a
        // verificação de ambiguidade detectou uma bifurcação — mesma razão
        // das interceptações acima, senão cairia no balde de destilação.
        if (/Ele admite duas leituras diferentes:/.test(textoCru)) {
          registro.criticaDeInterpretacao.push(conteudoDoPrompt);
          const texto = typeof criticaDeInterpretacao === 'function' ? criticaDeInterpretacao(conteudoDoPrompt) : criticaDeInterpretacao;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }

        if (/Proponha uma skill nova que cubra esse padrão/.test(textoCru)) {
          registro.rascunhoDeSkill.push(conteudoDoPrompt);
          const objeto = typeof rascunhoDeSkill === 'function' ? rascunhoDeSkill(conteudoDoPrompt) : rascunhoDeSkill;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: JSON.stringify(objeto || {}) }, prompt_eval_count: 20, eval_count: 40 })
          );
        }
        if (/AUTOTESTE de uma skill recém-criada/.test(textoCru)) {
          registro.autoavaliacaoDeSkill.push(conteudoDoPrompt);
          const texto = typeof autoavaliacaoDeSkill === 'function' ? autoavaliacaoDeSkill(conteudoDoPrompt) : autoavaliacaoDeSkill;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }

        // Crítico do plano (criticaDoPlano, disparado a cada N passos ou na
        // iteração 2): mesma razão das interceptações acima — sem isto, cairia
        // no balde de destilação e poluiria a contagem que outros casos usam.
        if (/revisando o trabalho de outro agente NO MEIO da execução/.test(textoCru)) {
          registro.criticaPlano.push(conteudoDoPrompt);
          const texto = typeof criticaDoPlano === 'function' ? criticaDoPlano(conteudoDoPrompt) : criticaDoPlano;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }

        // Planejamento inicial forçado (planejarInicial, só roda quando
        // classificarPedido decidiu que o pedido precisa) — mesma razão das
        // interceptações acima, senão cairia no balde de destilação.
        if (/Antes de agir, monte um plano/.test(textoCru)) {
          registro.planejamentoInicial.push(conteudoDoPrompt);
          const texto =
            typeof planejamentoInicial === 'function' ? planejamentoInicial(conteudoDoPrompt) : planejamentoInicial;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }

        if (/Você vai planejar uma pesquisa de RECOMENDAÇÃO/.test(textoCru)) {
          registro.planoDePesquisa.push(conteudoDoPrompt);
          const texto = typeof planoDePesquisa === 'function' ? planoDePesquisa(conteudoDoPrompt) : planoDePesquisa;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/Antes de pesquisar produtos, desça do pedido/.test(textoCru)) {
          registro.cadeiaDoUso.push(conteudoDoPrompt);
          const texto = typeof cadeiaDoUso === 'function' ? cadeiaDoUso(conteudoDoPrompt) : cadeiaDoUso;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/características técnicas que o MATERIAL diz que decidem/.test(textoCru)) {
          registro.criteriosDoConhecimento.push(conteudoDoPrompt);
          const texto = typeof criteriosDoConhecimento === 'function' ? criteriosDoConhecimento(conteudoDoPrompt) : criteriosDoConhecimento;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/Antes de pesquisar, pense no problema/.test(textoCru)) {
          registro.mapaDoProblema.push(conteudoDoPrompt);
          const texto = typeof mapaDoProblema === 'function' ? mapaDoProblema(conteudoDoPrompt) : mapaDoProblema;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/Para cada hipótese abaixo/.test(textoCru)) {
          registro.hipotesesDePesquisa.push(conteudoDoPrompt);
          const texto = typeof hipotesesDePesquisa === 'function' ? hipotesesDePesquisa(conteudoDoPrompt) : hipotesesDePesquisa;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/TRECHOS DO MATERIAL, POR CRITÉRIO/.test(textoCru)) {
          registro.julgamentoDePesquisa.push(conteudoDoPrompt);
          const texto = typeof julgamentoDePesquisa === 'function' ? julgamentoDePesquisa(conteudoDoPrompt) : julgamentoDePesquisa;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/Você escreve frases curtas em português para uma resposta que o sistema já montou/.test(textoCru)) {
          registro.frasesDaResposta.push(conteudoDoPrompt);
          const texto = typeof frasesDaResposta === 'function' ? frasesDaResposta(conteudoDoPrompt) : frasesDaResposta;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/Quais DICAS CONCRETAS/.test(textoCru)) {
          registro.dicasDoTopico.push(conteudoDoPrompt);
          const texto = typeof dicasDoTopico === 'function' ? dicasDoTopico(conteudoDoPrompt) : dicasDoTopico;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/TÓPICO DE FÓRUM — a pessoa perguntou/.test(textoCru)) {
          registro.produtosDoTopico.push(conteudoDoPrompt);
          const texto = typeof produtosDoTopico === 'function' ? produtosDoTopico(conteudoDoPrompt) : produtosDoTopico;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }
        if (/Quais opções CONCRETAS/.test(textoCru)) {
          registro.candidatosDePesquisa.push(conteudoDoPrompt);
          const texto = typeof candidatosDePesquisa === 'function' ? candidatosDePesquisa(conteudoDoPrompt) : candidatosDePesquisa;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 }));
        }

        // Consulta sob demanda ao crítico (Copiloto nível 2, ferramenta
        // `consultar_critico` — Agent.consultarCritico) — mesma razão das
        // interceptações acima, senão cairia no balde de destilação. Só
        // chega aqui quando o teto/desligado NÃO interceptou antes (ver
        // consultarCritico em loop.js) — esses casos nem chamam o modelo.
        if (/foi o PRÓPRIO agente que pediu sua opinião/.test(textoCru)) {
          registro.consultaCritico.push(conteudoDoPrompt);
          const texto = typeof consultaCritico === 'function' ? consultaCritico(conteudoDoPrompt) : consultaCritico;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }

        // Checkpoint automático do Copiloto (criticaAutomatica, 4 pontos
        // fixos do pipeline) — mesma razão das interceptações acima, senão
        // cairia no balde de destilação. Texto único que só existe em
        // pedidoDeCriticaAutomatica (prompts.js), nunca em
        // pedidoDeConsultaCritico/pedidoDeCriticaDoPlano — os três
        // precisavam ficar distinguíveis pro mock não misturar as contagens.
        if (/checkpoint automático do próprio sistema/.test(textoCru)) {
          registro.criticaAutomatica.push(conteudoDoPrompt);
          const texto =
            typeof criticaAutomatica === 'function' ? criticaAutomatica(conteudoDoPrompt) : criticaAutomatica;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ message: { content: String(texto) }, prompt_eval_count: 20, eval_count: 10 })
          );
        }
      }

      // format:json = passo de decisão; sem format = passo de redação
      // decisão pode vir com format:'json' (reserva) ou com o JSON Schema
      const ehDecisao = pedido.format === 'json' || (pedido.format && typeof pedido.format === 'object');
      if (ehDecisao) {
        const textoCru = (pedido.messages || []).map((m) => m.content).join('\n');

        // A extração de parâmetros de rotina também usa format:json, mas NÃO é
        // uma decisão: não pode consumir um passo do roteiro.
        if (/Extraia os valores abaixo/.test(textoCru)) {
          registro.parametros = textoCru;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({
              message: { content: JSON.stringify(parametros || {}) },
              prompt_eval_count: 20,
              eval_count: 10,
            })
          );
        }

        registro.decisao.push(conteudoDoPrompt);
        registro.mensagens.push(pedido.messages || []);
        // Backlog do Copiloto — correção DeepSeek R1 8B: a chamada de decisão
        // desliga o raciocínio explícito (`pensar: false`, vira `think` no
        // corpo) pra não conflitar com o formato rígido do esquema. Registra
        // o valor de verdade que chegou aqui pra o caso de teste conferir.
        registro.pensarDecisao.push(pedido.think);
        registro.opcoesDecisao.push(pedido.options || {}); // revisão v3: num_predict da decisão
        if (pedido.format && typeof pedido.format === 'object') registro.esquemas.push(pedido.format);
        const item = roteiro[Math.min(passo, roteiro.length - 1)];
        passo += 1;
        const plano =
          typeof item === 'string'
            ? item // resposta crua, para testar protocolo inválido
            : JSON.stringify({
                pensamento: item?.pensamento || 'seguindo',
                raciocinio: item?.raciocinio || '',
                plano: item?.plano || [],
                critica: item?.critica || '',
                ferramenta: { nome: item?.ferramenta, argumentos: item?.argumentos || {} },
              });
        res.setHeader('Content-Type', 'application/json');
        return res.end(
          JSON.stringify({ message: { content: plano }, prompt_eval_count: 40, eval_count: 20 })
        );
      }

      // Chamada sem streaming e sem format é destilação de fatos — MAS a
      // reflexão pós-execução (refletir(), Reflexion leve) usa exatamente o
      // mesmo formato (sem stream, sem format) e cai aqui também. Sem
      // distinguir pelo conteúdo, `registro.destilacao.length` contaria a
      // reflexão como se fosse mais uma chamada de destilação — por isso vai
      // pra um registro à parte, mas continua respeitando o mesmo hook
      // `destilacao` (função ou string) que um caso pode fornecer, já que
      // alguns testes usam justamente esse hook pra responder a reflexão.
      if (pedido.stream !== true) {
        const textoCru = (pedido.messages || []).map((m) => m.content).join('\n');
        const ehReflexao = /REFLEXÃO PÓS-EXECUÇÃO/.test(textoCru);
        (ehReflexao ? registro.reflexao : registro.destilacao).push(conteudoDoPrompt);

        const material = /MATERIAL COLETADO[^\n]*\n([\s\S]*?)\n\nExtraia/.exec(textoCru)?.[1] || '';
        const fatos =
          typeof destilacao === 'function'
            ? destilacao(conteudoDoPrompt)
            : destilacao ||
              (ehReflexao
                ? 'NADA'
                : // destilador falso porém plausível: linhas do material que têm número
                  material
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => /\d/.test(l) && l.length > 20 && !/banner|rodape|rodapé|menu/i.test(l))
                    .slice(0, 8)
                    .map((l) => `- ${l.slice(0, 160)}`)
                    .join('\n')) ||
              'NADA';

        res.setHeader('Content-Type', 'application/json');
        return res.end(
          JSON.stringify({ message: { content: fatos }, prompt_eval_count: 300, eval_count: 80 })
        );
      }

      registro.redacao.push(conteudoDoPrompt);
      const texto =
        typeof redacao === 'function'
          ? redacao(conteudoDoPrompt, registro.redacao.length)
          : redacao || 'Resposta redigida a partir do material coletado.';

      res.setHeader('Content-Type', 'application/x-ndjson');
      for (const pedaco of String(texto).match(/[\s\S]{1,40}/g) || []) {
        res.write(`${JSON.stringify({ message: { content: pedaco } })}\n`);
      }
      res.end(`${JSON.stringify({ done: true, prompt_eval_count: 200, eval_count: 60 })}\n`);
    });
  });

  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolve({
        porta: servidor.address().port,
        registro,
        fechar: () => new Promise((r) => servidor.close(r)),
      });
    });
  });
}

/* ------------------------------ execução de um caso ------------------------------ */

function prepararPasta(nome, arquivos = {}, { manter = false } = {}) {
  const dir = path.join(RAIZ, nome.replace(/[^\w-]+/g, '-').slice(0, 60));
  // `manter`: casos de retomada rodam duas execuções na MESMA pasta de trabalho
  if (!manter) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const destino = path.join(dir, caminho);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    if (Buffer.isBuffer(conteudo)) fs.writeFileSync(destino, conteudo);
    else if (typeof conteudo === 'object' && conteudo.copiarDe) {
      fs.copyFileSync(conteudo.copiarDe, destino);
    } else {
      fs.writeFileSync(destino, String(conteudo), 'utf8');
    }
  }
  return dir;
}

const skills = new Skills({
  dirEmbutidas: path.join(__dirname, '..', 'skills'),
  dirUsuario: path.join(RAIZ, 'skills-vazias'),
});

tools.recarregar({
  dirEmbutidas: path.join(__dirname, '..', 'ferramentas'),
  dirUsuario: path.join(RAIZ, 'ferramentas-vazias'),
});

async function executarCasoAgente(caso, opcoes = {}) {
  const workspace = prepararPasta(caso.nome, caso.arquivos, { manter: caso.manterPasta === true });
  const falso = opcoes.real ? null : await servidorFalso(caso);

  const config = {
    host: opcoes.real ? opcoes.host : `http://127.0.0.1:${falso.porta}`,
    model: opcoes.real ? opcoes.modelo : 'falso',
    modelDecisao: '',
    modelRedacao: opcoes.real ? opcoes.modeloRedacao || '' : '',
    embedModel: 'nomic-embed-text',
    temperature: 0.3,
    numCtx: 8192,
    numPredict: 1024,
    numPredictResposta: 2048,
    maxIterations: caso.maxIterations || 8,
    autonomy: caso.autonomia || 'auto',
    shellTimeoutMs: 8000,
    codeTimeoutMs: 8000,
    workspace,
    memoryTopK: 2,
    alwaysAllow: [],
    // rotinas ficam desligadas por padrão na bancada: o caso que quer testá-las
    // liga explicitamente, senão elas atropelariam o roteiro dos outros
    usarRotinas: Boolean(caso.parametros),
    // mesma lógica: a crítica periódica do subagente crítico consumiria uma
    // chamada extra ao servidor falso (fora do roteiro) em qualquer caso que
    // passe de 5 iterações — desligada por padrão, o caso que quer testá-la liga
    criticaPeriodica: false,
    skillsDesativadas: caso.skillsDesativadas || [],
    ferramentasDesativadas: caso.ferramentasDesativadas || [],
    permitirLeitorExterno: false,
    renderizarJs: false,
    // Motor de pesquisa: desligado por padrão na bancada, mesma lógica de
    // `usarRotinas`/`criticaPeriodica` acima — muitos casos antigos têm
    // "melhor"/"compare" no pedido e o motor atropelaria o roteiro deles.
    // O caso que testa o motor liga em `config`.
    motorDePesquisa: false,
    // Etapa E (revisão v2): perfis de uso curados desligados por padrão na
    // bancada — os casos antigos testam mecanismos (lacuna, juiz, dedução do
    // atraso) com critérios próprios; os casos da Etapa E ligam.
    perfisDeUso: false,
    // Etapa H: resposta montada pelo código desligada por padrão na bancada
    // (os casos antigos conferem o que chega ao redator); os da Etapa H ligam
    respostaMontada: false,
    // imagens nas respostas (11/10): desligadas na bancada — a busca de imagens
    // é uma chamada a mais ao SearXNG falso, e os casos contam as buscas
    imagensNasRespostas: false,
    // destilação uma página por vez: os roteiros falsos respondem na ordem das chamadas
    destilacaoParalela: 1,
    // resposta curta do nível 1 (11/10): os casos antigos do AUTO conferem o
    // pedido de escrita e o teto de tokens da resposta completa
    autoRespostaCurta: false,
    // revisão v3 (Fase 1): o modo explicação tira o pipeline forçado de
    // "por que…/o que é…" — os casos antigos do Copiloto usam justamente
    // perguntas assim pra exercitar crítico e portões; os casos v3 ligam
    modoExplicacao: false,
    // Modo AUTO (10/10): desligado por padrão na bancada — os casos antigos
    // têm roteiro para o laço completo; os casos do AUTO (casos/auto.js) ligam
    modoAuto: false,
    ...(caso.config || {}),
  };

  const agente = new Agent({
    config,
    userDataPath: workspace,
    skills,
    navegador: caso.navegador || null, // o caso pode injetar uma sessão falsa
    render: caso.render || null, // leitura de página com JavaScript (só quando a medição roda dentro do Electron)
  });
  // resposta rápida do AUTO: busca, Wikipédia e leitura viram dublês
  if (caso.depsRespostaRapida) agente.depsRespostaRapida = caso.depsRespostaRapida;

  // Mesmo registro que o app usa: medição sintética e uso real caem no mesmo
  // placar, em vez de virarem dois números que não se comparam.
  const registro = new Registro({
    origem: 'bancada',
    caso: caso.nome,
    modelo: config.model,
    host: config.host,
  }).acompanhar(agente);

  const obtido = {
    ferramentasChamadas: [],
    eventos: [],
    skillsAtivadas: [],
    perguntouAoUsuario: false,
    aprovacoesPedidas: [],
    criticasRecebidas: [],
    erros: [],
    resposta: '',
    passos: 0,
    coberturaNivel: null,
    tokens: 0,
    verificacoes: [],
    destilacoes: [],
    protocolo: [],
    recuperacoes: [],
    rotina: null,
    rotinaConcluida: null,
    rotinaIgnorada: null,
    checklist: null,
    confianca: null,
    confrontos: [],
    buscasReforco: [],
    buscasAjustadas: [],
    criticasPlano: [],
    objetivoReescrito: null,
    interpretacaoEscolhida: null,
    copiloto: [], // backlog do Copiloto, item m1 — cada intervenção dos gates determinísticos (ver vetoDoCopiloto)
    // Caso real (Davi, 2026-09-18): 'resposta-reinicia' sempre existiu, mas
    // saía sem nenhuma explicação — pro usuário parecia um glitch. Cada
    // reinício agora carrega `motivo` (ver loop.js) — capturado aqui pra
    // confirmar isso na bancada (ver checker `reiniciosComMotivo` abaixo).
    reiniciosResposta: [],
  };

  agente.on('resposta-reinicia', (d) => obtido.reiniciosResposta.push(d));
  obtido.pesquisa = {};
  for (const ev of ['pesquisa-cadeia', 'pesquisa-criterios', 'pesquisa-ordem', 'pesquisa-mapa', 'pesquisa-plano', 'pesquisa-candidatos', 'pesquisa-matriz', 'pesquisa-hipoteses', 'pesquisa-fim', 'pesquisa-desempenho', 'pesquisa-uso', 'pesquisa-guia', 'pesquisa-modo']) {
    agente.on(ev, (d) => {
      obtido.pesquisa[ev.replace('pesquisa-', '')] = d;
    });
  }
  agente.on('ferramenta', (d) => obtido.ferramentasChamadas.push(d.nome));
  agente.on('skills', (d) => obtido.skillsAtivadas.push(...d.nomes));
  agente.on('cobertura', (d) => {
    obtido.coberturaNivel = d.nivel;
  });
  agente.on('verificacao', (d) => {
    obtido.verificacoes.push(d);
  });
  agente.on('destilado', (d) => {
    obtido.destilacoes.push(d);
  });
  agente.on('protocolo-invalido', (d) => {
    obtido.protocolo.push({ estado: d.estado, motivo: d.motivo });
  });
  agente.on('protocolo-recuperado', (d) => {
    obtido.recuperacoes.push(d);
  });
  agente.on('rotina-inicio', (d) => {
    obtido.rotina = { nome: d.rotina, passos: d.passos, parametros: d.parametros };
  });
  agente.on('rotina-fim', (d) => {
    obtido.rotinaConcluida = d.concluida;
    obtido.rotinaMotivo = d.motivo || null;
  });
  agente.on('rotina-ignorada', (d) => {
    obtido.rotinaIgnorada = d.motivo;
  });
  agente.on('checklist', (d) => {
    obtido.checklist = d;
  });
  agente.on('confianca', (d) => {
    obtido.confianca = d;
  });
  agente.on('confronto', (d) => {
    obtido.confrontos.push(d);
  });
  agente.on('busca-reforco', (d) => {
    obtido.buscasReforco.push(d);
  });
  agente.on('critica-plano', (d) => {
    obtido.criticasPlano.push(d);
  });
  agente.on('objetivo-reescrito', (d) => {
    obtido.objetivoReescrito = d;
  });
  agente.on('interpretacao-escolhida', (d) => {
    obtido.interpretacaoEscolhida = d;
  });
  agente.on('busca-ajustada', (d) => {
    obtido.buscasAjustadas.push(d);
  });
  agente.on('copiloto', (d) => {
    obtido.copiloto.push(d);
  });
  agente.on('resultado', (d) => {
    if (d.erro) obtido.erros.push(`${d.nome}: ${d.erro}`);
  });
  agente.on('iteracao', (d) => {
    obtido.passos = d.n;
  });
  agente.on('uso', (d) => {
    obtido.tokens = (d.prompt || 0) + (d.completion || 0);
  });

  for (const evento of ['protocolo-invalido', 'compactado', 'negado', 'limite', 'redigindo', 'aviso']) {
    agente.on(evento, () => obtido.eventos.push(evento));
  }

  // responde sozinho ao que o agente perguntar, para o caso não travar
  agente.on('pergunta', (d) => {
    obtido.perguntouAoUsuario = true;
    agente.responder(d.id, caso.respostaDoUsuario || 'siga com o que você tem');
  });
  // Pedido de Davi 2026-09-18 (plano das "2 IAs em paralelo"): o cartão de
  // aprovação (loop.js: pedirAprovacao) não espera mais a segunda opinião
  // (segundaOpiniao) terminar — ela chega depois, se der tempo, pelo evento
  // 'aprovacao-critica'. Responder SÍNCRONO aqui (como antes) tornaria a
  // bancada determinística demais pra pegar isso: o id sairia de
  // `agente.pendentes` antes da crítica (assíncrona) sequer voltar, e
  // 'aprovacao-critica' nunca chegaria a disparar. Os 20ms adiante são de
  // sobra pro servidor falso (HTTP local de verdade, mas em loopback —
  // tipicamente sub-milissegundo) responder primeiro, sem tornar a bancada
  // perceptivelmente mais lenta nem flaky.
  const aprovacoesPendentes = new Map(); // id -> nome, só pra 'aprovacao-critica' saber de quem é
  agente.on('aprovacao', (d) => {
    obtido.aprovacoesPedidas.push(d.nome);
    if (d.critica) obtido.criticasRecebidas.push({ nome: d.nome, critica: d.critica });
    aprovacoesPendentes.set(d.id, d.nome);
    setTimeout(() => agente.responder(d.id, caso.aprovar === false ? 'negar' : 'aprovar'), 20);
  });
  agente.on('aprovacao-critica', (d) => {
    const nome = aprovacoesPendentes.get(d.id);
    if (nome) obtido.criticasRecebidas.push({ nome, critica: d.critica });
  });

  const inicio = Date.now();
  let retorno;
  try {
    retorno = await agente.run(caso.pedido, caso.conversa || [], caso.idConversa || null, { tarefaAnterior: caso.tarefaAnterior || null });
  } catch (err) {
    retorno = { ok: false, motivo: err.message };
  }
  const duracao = Date.now() - inicio;

  obtido.resposta = retorno?.resumo || '';
  obtido.ok = Boolean(retorno?.ok);
  obtido.motivo = retorno?.motivo || null;
  obtido.promptDecisao = falso ? falso.registro.decisao.join('\n') : '';
  obtido.promptRedacao = falso ? falso.registro.redacao.join('\n') : '';
  // Correção "item-a-item" (prova de 10 questões): quantas chamadas de
  // redação de fato aconteceram (1ª tentativa + reescrita + cada complemento
  // por parte faltante, se for o caso) — diferente de `promptRedacao`, que só
  // dá o texto concatenado, isso deixa o TESTE afirmar quantas chamadas
  // separadas o loop.js fez.
  obtido.chamadasRedacao = falso ? falso.registro.redacao.length : 0;
  obtido.promptDestilacao = falso ? falso.registro.destilacao.join('\n') : '';
  obtido.promptCritica = falso ? falso.registro.criticaPlano.join('\n') : '';
  obtido.chamadasCriticaPlano = falso ? falso.registro.criticaPlano.length : 0;
  obtido.promptPlanejamento = falso ? falso.registro.planejamentoInicial.join('\n') : '';
  obtido.chamadasPlanoDePesquisa = falso ? falso.registro.planoDePesquisa.length : 0;
  obtido.promptCandidatos = falso ? falso.registro.candidatosDePesquisa.join('\n') : '';
  obtido.promptsProdutosDoTopico = falso ? falso.registro.produtosDoTopico : [];
  obtido.promptsFrases = falso ? falso.registro.frasesDaResposta : [];
  obtido.promptsDicas = falso ? falso.registro.dicasDoTopico : [];
  obtido.promptJulgamento = falso ? falso.registro.julgamentoDePesquisa.join('\n') : '';
  obtido.chamadasJulgamento = falso ? falso.registro.julgamentoDePesquisa.length : 0;
  obtido.promptMapa = falso ? falso.registro.mapaDoProblema.join('\n') : '';
  obtido.promptCadeia = falso ? falso.registro.cadeiaDoUso.join('\n') : '';
  obtido.promptCriteriosConhecimento = falso ? falso.registro.criteriosDoConhecimento.join('\n') : '';
  obtido.promptPlanoDePesquisa = falso ? falso.registro.planoDePesquisa.join('\n') : '';
  obtido.promptHipoteses = falso ? falso.registro.hipotesesDePesquisa.join('\n') : '';
  obtido.chamadasHipoteses = falso ? falso.registro.hipotesesDePesquisa.length : 0;
  obtido.chamadasPlanejamento = falso ? falso.registro.planejamentoInicial.length : 0;
  obtido.promptConsultaCritico = falso ? falso.registro.consultaCritico.join('\n') : '';
  obtido.chamadasConsultaCritico = falso ? falso.registro.consultaCritico.length : 0;
  // Checkpoint automático do Copiloto (item novo 2026-09-14) — mesma dupla
  // prompt/contagem dos três acima, só que pros 4 pontos fixos do pipeline.
  obtido.promptCriticaAutomatica = falso ? falso.registro.criticaAutomatica.join('\n') : '';
  obtido.chamadasCriticaAutomatica = falso ? falso.registro.criticaAutomatica.length : 0;
  // conta chamadas de verdade (mesmo quando a destilação veio fraca e caiu de
  // volta pro original) — diferente de obtido.destilacoes, que só cresce
  // quando o evento 'destilado' dispara (compressão bem-sucedida)
  obtido.chamadasDestilacao = falso ? falso.registro.destilacao.length : 0;
  obtido.esquemas = falso ? falso.registro.esquemas : [];
  obtido.mensagensDeDecisao = falso ? falso.registro.mensagens : [];
  obtido.pensarDecisao = falso ? falso.registro.pensarDecisao : [];
  obtido.opcoesDecisao = falso ? falso.registro.opcoesDecisao : [];
  // uma consulta à memória gera um embedding da pergunta; as gravações geram os
  // seus, então descontamos o que foi memorizado
  obtido.buscasDeEmbedding = falso ? Math.max(0, falso.registro.embeddings - obtido.ferramentasChamadas.length - 1) : 0;
  obtido.arquivos = fs.readdirSync(workspace).filter((n) => !n.startsWith('.'));
  obtido.duracao = duracao;
  obtido.workspace = workspace;
  obtido.registro = registro.encerrar(retorno?.ok ? 'concluido' : 'erro', obtido.resposta);

  if (opcoes.gravarRegistro) {
    new Registros(opcoes.gravarRegistro).salvar(obtido.registro);
  }

  await falso?.fechar();
  return obtido;
}

/* ------------------------------ afirmações ------------------------------ */

const VERIFICADORES = {
  passos: (esperado, obtido) => {
    const falhas = [];
    if (esperado.max !== undefined && obtido.passos > esperado.max) {
      falhas.push(`esperava no máximo ${esperado.max} passos, gastou ${obtido.passos}`);
    }
    if (esperado.min !== undefined && obtido.passos < esperado.min) {
      falhas.push(`esperava no mínimo ${esperado.min} passos, gastou ${obtido.passos}`);
    }
    return falhas;
  },

  ferramentasChamadas: (esperado, obtido) =>
    esperado
      .filter((f) => !obtido.ferramentasChamadas.includes(f))
      .map((f) => `esperava a ferramenta "${f}"; chamou [${obtido.ferramentasChamadas.join(', ') || 'nenhuma'}]`),

  ferramentasNaoChamadas: (esperado, obtido) =>
    esperado.filter((f) => obtido.ferramentasChamadas.includes(f)).map((f) => `não deveria ter chamado "${f}"`),

  perguntouAoUsuario: (esperado, obtido) =>
    obtido.perguntouAoUsuario === esperado
      ? []
      : [esperado ? 'esperava que perguntasse ao usuário' : 'perguntou ao usuário sem necessidade'],

  aprovacoesPedidas: (esperado, obtido) => {
    const faltando = esperado.filter((f) => !obtido.aprovacoesPedidas.includes(f));
    return faltando.length ? [`esperava aprovação para [${faltando.join(', ')}]`] : [];
  },

  semAprovacaoPara: (esperado, obtido) =>
    esperado.filter((f) => obtido.aprovacoesPedidas.includes(f)).map((f) => `pediu aprovação para "${f}" sem precisar`),

  criticaPedida: (esperado, obtido) =>
    obtido.criticasRecebidas.some((c) => c.nome === esperado)
      ? []
      : [`esperava segunda opinião ao aprovar "${esperado}"; recebeu [${obtido.criticasRecebidas.map((c) => c.nome).join(', ') || 'nenhuma'}]`],

  semCriticaPara: (esperado, obtido) =>
    esperado
      .filter((f) => obtido.criticasRecebidas.some((c) => c.nome === f))
      .map((f) => `pediu segunda opinião para "${f}" sem precisar`),

  criticaContem: (esperado, obtido) => {
    const juntas = obtido.criticasRecebidas.map((c) => c.critica).join(' | ');
    return esperado
      .filter((t) => !juntas.includes(t))
      .map((t) => `nenhuma segunda opinião contendo "${t}" (houve: ${juntas || 'nenhuma'})`);
  },

  respostaContem: (esperado, obtido) =>
    esperado
      .filter((t) => !obtido.resposta.toLowerCase().includes(String(t).toLowerCase()))
      .map((t) => `resposta não contém "${t}"`),

  respostaNaoContem: (esperado, obtido) =>
    esperado
      .filter((t) => obtido.resposta.toLowerCase().includes(String(t).toLowerCase()))
      .map((t) => `resposta não deveria conter "${t}"`),

  respostaLinhasMin: (esperado, obtido) => {
    const linhas = obtido.resposta.split('\n').filter((l) => l.trim()).length;
    return linhas >= esperado ? [] : [`esperava ao menos ${esperado} linhas na resposta, veio com ${linhas}`];
  },

  promptDecisaoContem: (esperado, obtido) =>
    esperado.filter((t) => !obtido.promptDecisao.includes(t)).map((t) => `prompt de decisão sem "${t}"`),

  promptDecisaoNaoContem: (esperado, obtido) =>
    esperado.filter((t) => obtido.promptDecisao.includes(t)).map((t) => `prompt de decisão contém "${t}" indevidamente`),

  promptRedacaoContem: (esperado, obtido) =>
    esperado.filter((t) => !obtido.promptRedacao.includes(t)).map((t) => `prompt de redação sem "${t}"`),

  promptRedacaoNaoContem: (esperado, obtido) =>
    esperado
      .filter((t) => obtido.promptRedacao.includes(t))
      .map((t) => `prompt de redação ainda contém "${t}" — o ruído não foi destilado`),

  promptDestilacaoContem: (esperado, obtido) =>
    esperado.filter((t) => !obtido.promptDestilacao.includes(t)).map((t) => `prompt de destilação sem "${t}"`),

  promptCriticaContem: (esperado, obtido) =>
    esperado.filter((t) => !obtido.promptCritica.includes(t)).map((t) => `prompt do crítico do plano sem "${t}"`),

  promptCriticaNaoContem: (esperado, obtido) =>
    esperado.filter((t) => obtido.promptCritica.includes(t)).map((t) => `prompt do crítico do plano não deveria conter "${t}"`),

  chamadasDeDestilacao: (esperado, obtido) =>
    obtido.chamadasDestilacao === esperado
      ? []
      : [`esperava ${esperado} chamada(s) de destilação, houve ${obtido.chamadasDestilacao}`],

  chamadasCriticaPlano: (esperado, obtido) =>
    obtido.chamadasCriticaPlano === esperado
      ? []
      : [`esperava ${esperado} chamada(s) do crítico do plano, houve ${obtido.chamadasCriticaPlano}`],

  chamadasPlanejamento: (esperado, obtido) =>
    obtido.chamadasPlanejamento === esperado
      ? []
      : [`esperava ${esperado} chamada(s) de planejamento inicial, houve ${obtido.chamadasPlanejamento}`],

  chamadasConsultaCritico: (esperado, obtido) =>
    obtido.chamadasConsultaCritico === esperado
      ? []
      : [`esperava ${esperado} chamada(s) de consulta ao crítico, houve ${obtido.chamadasConsultaCritico}`],

  chamadasCriticaAutomatica: (esperado, obtido) =>
    obtido.chamadasCriticaAutomatica === esperado
      ? []
      : [`esperava ${esperado} chamada(s) de checkpoint automático do Copiloto, houve ${obtido.chamadasCriticaAutomatica}`],

  // fases dos checkpoints automáticos que dispararam de verdade (ver
  // criticaAutomatica/emit('critica-plano', {fase}) em loop.js), na ordem —
  // filtra só os eventos com `fase` preenchida (criticaDoPlano, a crítica
  // periódica antiga, não manda esse campo, então não entra aqui).
  fasesCriticaAutomatica: (esperado, obtido) => {
    const fases = obtido.criticasPlano.filter((c) => c.fase).map((c) => c.fase);
    return JSON.stringify(fases) === JSON.stringify(esperado)
      ? []
      : [`esperava as fases ${JSON.stringify(esperado)}, houve ${JSON.stringify(fases)}`];
  },

  // backlog do Copiloto, item m1: confere a SEQUÊNCIA de gates que
  // intervieram (na ordem em que dispararam) e que o total acumulado
  // (emitido em cada evento 'copiloto') cresce 1 por 1 — prova que o
  // contador consolidado é o mesmo através de gates diferentes, não um por
  // gate.
  copilotoGates: (esperado, obtido) => {
    const gates = obtido.copiloto.map((c) => c.gate);
    const erros = esperado.length === gates.length && esperado.every((g, i) => g === gates[i])
      ? []
      : [`esperava a sequência de gates ${JSON.stringify(esperado)}, houve ${JSON.stringify(gates)}`];
    const totais = obtido.copiloto.map((c) => c.total);
    const totalCrescente = totais.every((t, i) => t === i + 1);
    if (!totalCrescente) erros.push(`total do copiloto deveria crescer 1 por 1, veio ${JSON.stringify(totais)}`);
    return erros;
  },

  // correção DeepSeek R1 8B: toda chamada de decisão deve pedir `think: false`
  // ao Ollama (esperado é sempre `false` — não há caso de uso hoje que passe
  // outro valor pra este verificador).
  pensarDecisao: (esperado, obtido) => {
    const errados = obtido.pensarDecisao.filter((v) => v !== esperado);
    return errados.length
      ? [`esperava think=${esperado} em toda chamada de decisão, alguma(s) vieram diferentes: ${JSON.stringify(obtido.pensarDecisao)}`]
      : [];
  },

  protocoloRecusou: (esperado, obtido) => {
    const estados = obtido.protocolo.map((p) => p.estado);
    return estados.includes(esperado)
      ? []
      : [`esperava recusa de protocolo "${esperado}", houve [${estados.join(', ') || 'nenhuma'}]`];
  },

  instrucaoContem: (esperado, obtido) => {
    const juntas = obtido.protocolo.map((p) => p.motivo).join(' | ');
    return esperado
      .filter((t) => !juntas.includes(t))
      .map((t) => `nenhuma instrução de correção contendo "${t}" (houve: ${juntas || 'nenhuma'})`);
  },

  protocoloRecuperou: (esperado, obtido) => {
    const vias = obtido.recuperacoes.map((r) => r.via);
    if (esperado === false) return vias.length ? [`recuperou sem necessidade: ${vias.join(', ')}`] : [];
    return vias.includes(esperado) ? [] : [`esperava recuperação "${esperado}", houve [${vias.join(', ') || 'nenhuma'}]`];
  },

  historicoEnxuto: (esperado, obtido) => {
    const ultima = obtido.mensagensDeDecisao[obtido.mensagensDeDecisao.length - 1] || [];
    const texto = ultima.map((m) => m.content).join('\n');
    const falhas = [];
    for (const t of esperado.semNaUltima || []) {
      if (texto.includes(t)) falhas.push(`o histórico ainda carrega "${t.slice(0, 30)}…" na última decisão`);
    }
    for (const t of esperado.comNaUltima || []) {
      if (!texto.includes(t)) falhas.push(`faltou o resumo curto "${t}" na última decisão`);
    }
    return falhas;
  },

  buscasNaMemoria: (esperado, obtido) => {
    const n = obtido.buscasDeEmbedding;
    return n <= esperado.max ? [] : [`consultou a memória ${n} vezes; o teto é ${esperado.max}`];
  },

  tokensMin: (esperado, obtido) =>
    obtido.tokens >= esperado
      ? []
      : [`esperava ao menos ${esperado} tokens contabilizados, obteve ${obtido.tokens}`],

  prefixoEstavel: (esperado, obtido) => {
    // em toda decisão, a primeira mensagem tem de ser o mesmo bloco de sistema
    const prefixos = obtido.mensagensDeDecisao.map((m) => (m[0]?.role === 'system' ? m[0].content : ''));
    const iguais = prefixos.every((p) => p && p === prefixos[0]);
    const volatilAntesDoHistorico = obtido.mensagensDeDecisao.some(
      (m) => m[1]?.role === 'system' && /MEMÓRIA RELEVANTE|RESUMO DO QUE/.test(m[1].content || '')
    );
    const falhas = [];
    if (esperado && !iguais) falhas.push('o bloco de sistema mudou entre as decisões — o cache de prefixo se perde');
    if (esperado && volatilAntesDoHistorico) falhas.push('bloco volátil ainda vem antes do histórico');
    return falhas;
  },

  esquemaEnviado: (esperado, obtido) => {
    const houve = obtido.esquemas.length > 0;
    if (houve !== esperado) return [esperado ? 'o schema não foi enviado ao Ollama' : 'enviou schema sem necessidade'];
    if (!houve) return [];
    const enumerado = obtido.esquemas[0]?.properties?.ferramenta?.properties?.nome?.enum;
    return Array.isArray(enumerado) && enumerado.length ? [] : ['schema enviado sem enum de ferramentas'];
  },

  rotinaUsada: (esperado, obtido) => {
    const usou = Boolean(obtido.rotina);
    if (usou !== Boolean(esperado)) {
      return [esperado ? 'esperava que a rotina fosse usada' : 'usou rotina sem necessidade'];
    }
    if (typeof esperado === 'string' && obtido.rotina?.nome !== esperado) {
      return [`esperava a rotina "${esperado}", usou "${obtido.rotina?.nome}"`];
    }
    return [];
  },

  rotinaConcluida: (esperado, obtido) =>
    obtido.rotinaConcluida === esperado
      ? []
      : [`esperava rotinaConcluida=${esperado}, obteve ${obtido.rotinaConcluida}`],

  destilou: (esperado, obtido) => {
    const houve = obtido.destilacoes.length > 0;
    return houve === esperado ? [] : [esperado ? 'esperava destilação' : 'destilou sem necessidade'];
  },

  skillsAtivadas: (esperado, obtido) =>
    esperado
      .filter((s) => !obtido.skillsAtivadas.includes(s))
      .map((s) => `esperava a skill "${s}"; ativou [${obtido.skillsAtivadas.join(', ') || 'nenhuma'}]`),

  skillsNaoAtivadas: (esperado, obtido) =>
    esperado.filter((s) => obtido.skillsAtivadas.includes(s)).map((s) => `skill "${s}" não deveria ter ativado`),

  eventos: (esperado, obtido) =>
    esperado.filter((e) => !obtido.eventos.includes(e)).map((e) => `esperava o evento "${e}"`),

  coberturaNivel: (esperado, obtido) =>
    obtido.coberturaNivel === esperado
      ? []
      : [`esperava cobertura "${esperado}", obteve "${obtido.coberturaNivel}"`],

  erroContem: (esperado, obtido) => {
    const juntos = obtido.erros.join(' | ');
    return esperado.filter((t) => !juntos.includes(t)).map((t) => `nenhum erro contendo "${t}" (erros: ${juntos || 'nenhum'})`);
  },

  arquivosCriados: (esperado, obtido) =>
    esperado.filter((a) => !obtido.arquivos.includes(a)).map((a) => `arquivo "${a}" não foi criado`),

  ok: (esperado, obtido) => (obtido.ok === esperado ? [] : [`esperava ok=${esperado}, obteve ${obtido.ok}`]),

  chamadasRedacao: (esperado, obtido) =>
    obtido.chamadasRedacao === esperado
      ? []
      : [`esperava ${esperado} chamada(s) de redação, obteve ${obtido.chamadasRedacao}`],

  verificacaoReescreveu: (esperado, obtido) => {
    const reescreveu = obtido.verificacoes.some((v) => v.tentativa > 1);
    return reescreveu === esperado
      ? []
      : [esperado ? 'esperava que a verificação disparasse reescrita' : 'reescreveu sem necessidade'];
  },

  // Caso real (Davi, 2026-09-18): 'resposta-reinicia' apagava a resposta em
  // andamento sem nenhuma explicação — a UI (renderer/app.js) agora mostra
  // `motivo` no lugar do texto que sumiu. Este checker confirma que TODO
  // reinício disparado nesta execução veio com um motivo não-vazio (nunca
  // `{}` silencioso de novo).
  reiniciosComMotivo: (esperado, obtido) => {
    if (!esperado) return [];
    if (!obtido.reiniciosResposta.length) return ['esperava pelo menos um reinício de resposta, não houve nenhum'];
    const semMotivo = obtido.reiniciosResposta.filter((r) => !r?.motivo || !String(r.motivo).trim());
    return semMotivo.length ? [`${semMotivo.length} reinício(s) de resposta sem motivo explicando o porquê`] : [];
  },

  suspeitasFinais: (esperado, obtido) => {
    const ultima = obtido.verificacoes[obtido.verificacoes.length - 1];
    const total = ultima?.totalSuspeitas ?? 0;
    return total === esperado ? [] : [`esperava ${esperado} suspeitas ao final, obteve ${total}`];
  },

  // esperado: { texto, status } — confere o status final de UM item da
  // lista de tarefas (ver reconciliarChecklist em loop.js), casando pelo
  // início do texto pra não depender de acento/pontuação exatos do modelo.
  checklistItem: (esperado, obtido) => {
    const item = (obtido.checklist || []).find((i) =>
      i.texto.toLowerCase().startsWith(String(esperado.texto).toLowerCase())
    );
    if (!item) return [`nenhum item do checklist começando com "${esperado.texto}" (checklist: ${JSON.stringify(obtido.checklist)})`];
    return item.status === esperado.status
      ? []
      : [`item "${esperado.texto}" esperava status "${esperado.status}", obteve "${item.status}"`];
  },

  confiancaNivel: (esperado, obtido) =>
    obtido.confianca?.nivel === esperado
      ? []
      : [`esperava confiança "${esperado}", obteve "${obtido.confianca?.nivel}" (motivos: ${(obtido.confianca?.motivos || []).join('; ')})`],

  confiancaMotivosContem: (esperado, obtido) => {
    const juntos = (obtido.confianca?.motivos || []).join(' | ');
    return esperado.filter((t) => !juntos.includes(t)).map((t) => `nenhum motivo de confiança contendo "${t}" (motivos: ${juntos || 'nenhum'})`);
  },

  buscaDeReforcoDisparada: (esperado, obtido) => {
    const disparou = obtido.buscasReforco.length > 0;
    return disparou === esperado
      ? []
      : [esperado ? 'esperava busca de reforço por baixa confiança' : 'busca de reforço disparou sem necessidade'];
  },

  buscaAjustadaContem: (esperado, obtido) => {
    const todosOsTermos = obtido.buscasAjustadas.flatMap((b) => b.termos || []);
    return esperado.filter((t) => !todosOsTermos.includes(t)).map((t) => `esperava o termo "${t}" numa busca ajustada pela cobertura`);
  },

  criticaPlanoDisparada: (esperado, obtido) => {
    const disparou = obtido.criticasPlano.length > 0;
    return disparou === esperado
      ? []
      : [esperado ? 'esperava que a crítica periódica do plano disparasse' : 'crítica periódica do plano disparou sem necessidade'];
  },

  criticaPlanoNoMaximo: (esperado, obtido) =>
    obtido.criticasPlano.length <= esperado
      ? []
      : [`esperava no máximo ${esperado} crítica(s) do plano, obteve ${obtido.criticasPlano.length}`],

  objetivoReescritoPara: (esperado, obtido) =>
    obtido.objetivoReescrito?.reescrito === esperado
      ? []
      : [`esperava o objetivo reescrito para "${esperado}", obteve ${JSON.stringify(obtido.objetivoReescrito)}`],

  objetivoNaoReescrito: (esperado, obtido) =>
    !esperado || !obtido.objetivoReescrito
      ? []
      : [`objetivo não deveria ter sido reescrito, mas foi para "${obtido.objetivoReescrito.reescrito}"`],

  interpretacaoEscolhida: (esperado, obtido) =>
    obtido.interpretacaoEscolhida?.escolhida === esperado
      ? []
      : [`esperava a interpretação escolhida "${esperado}", obteve ${JSON.stringify(obtido.interpretacaoEscolhida)}`],

  interpretacaoNaoBifurcada: (esperado, obtido) =>
    !esperado || !obtido.interpretacaoEscolhida
      ? []
      : [`não deveria ter bifurcado interpretação, mas escolheu "${obtido.interpretacaoEscolhida.escolhida}"`],
};

function comparar(espera = {}, obtido) {
  const falhas = [];
  for (const [chave, esperado] of Object.entries(espera)) {
    const verificador = VERIFICADORES[chave];
    if (!verificador) {
      falhas.push(`afirmação desconhecida: "${chave}"`);
      continue;
    }
    falhas.push(...verificador(esperado, obtido));
  }
  return falhas;
}

module.exports = { servidorFalso, executarCasoAgente, comparar, prepararPasta, RAIZ, skills, tools };
