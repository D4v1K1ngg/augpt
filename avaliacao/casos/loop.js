'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pedidoQuerArquivo, resumoDoDossie, Agent } = require('../../src/agent/loop');
const { executarCasoAgente, comparar, servidorFalso, skills } = require('../motor');

/**
 * Servidor local simulando busca+página (mesmo truque de
 * destilacao-por-pagina.js/pesquisa.js) — só pro checkpoint "direção da
 * pesquisa" (loop.js), que precisa de uma busca de VERDADE trazendo material
 * pro dossiê antes de disparar, sem depender de rede real na bancada.
 */
function servidorDeBusca(corpoDaPagina) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/search')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(
          JSON.stringify({ results: [{ title: 'Fonte', url: `http://127.0.0.1:${s.address().port}/p`, content: '' }] })
        );
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(corpoDaPagina);
    });
    s.listen(0, '127.0.0.1', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
  });
}

const paginaCom = (texto) =>
  `<html><body><article><p>${texto} ${'Contexto suficiente para o extrator aceitar este bloco como conteúdo. '.repeat(4)}</p></article></body></html>`;

/** N turnos alternados usuário/assistente, pros casos de "resumo de conversa" abaixo. */
function turnosDeConversa(n) {
  const turnos = [];
  for (let i = 1; i <= n; i += 1) {
    turnos.push({
      role: i % 2 === 1 ? 'user' : 'assistant',
      content: `Turno ${i} de teste, conteúdo qualquer só para preencher a conversa.`,
    });
  }
  return turnos;
}

/**
 * Documento longo, com quebra de parágrafo regular (pro emPedacos cortar
 * direitinho), pros casos de "chunking de documento grande" abaixo. Cada
 * parágrafo tem um número (o destilador falso padrão do motor extrai linha
 * com dígito e >20 caracteres — ver servidorFalso em avaliacao/motor.js),
 * exceto o parágrafo `marcarNo`, que carrega `marcador` — um texto único
 * pra confirmar que o material enviado à destilação alcançou aquele ponto do
 * documento, bem além do corte antigo de 14-20 mil caracteres.
 */
function documentoGrande(n, marcarNo, marcador) {
  const linhas = [];
  for (let i = 1; i <= n; i += 1) {
    linhas.push(
      i === marcarNo
        ? marcador
        : `Parágrafo ${i}: texto de preenchimento consistente para o teste de chunking de documento grande, garantindo quebras de parágrafo regulares e conteúdo plausível.`
    );
  }
  return linhas.join('\n\n');
}

/**
 * Cada caso aqui nasceu de um bug real observado em execução.
 * Se um deles voltar a falhar, é regressão — não novidade.
 */

module.exports = [
  {
    nome: 'responder com campo vazio ainda entrega resposta',
    pedido: 'Analise a nota anexada',
    arquivos: { 'nota.txt': 'A nota registra o valor de R$ 1.240,00 pagos em 12/08.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
      { ferramenta: 'responder', argumentos: { resposta: '', fontes: [] } },
    ],
    redacao: 'O documento registra R$ 1.240,00 pagos em 12/08.',
    espera: {
      ok: true,
      passos: { max: 3 },
      respostaContem: ['1.240,00'],
      promptRedacaoContem: ['R$ 1.240,00'],
      perguntouAoUsuario: false,
      // Correção DeepSeek R1 8B: toda chamada de decisão pede think:false —
      // formato rígido (esquema) não tem espaço útil pra "pensar alto".
      pensarDecisao: false,
    },
  },

  {
    nome: 'resposta fora do protocolo é recuperada',
    pedido: 'Some 2 mais 2',
    roteiro: [
      'desculpa, não vou usar JSON aqui',
      { ferramenta: 'calcular', argumentos: { expressao: '2+2' } },
      { ferramenta: 'responder', argumentos: { foco: 'o resultado' } },
    ],
    redacao: 'O resultado é 4.',
    espera: { ok: true, eventos: ['protocolo-invalido'], ferramentasChamadas: ['calcular'] },
  },

  {
    // Caso real de produção (prova de 6 questões, 12/09): o gate de
    // checklist barrou corretamente um "responder" prematuro (achado
    // anterior desta mesma semana), e o modelo, tentando obedecer, passou
    // a chamar pesquisar_e_ler sem o argumento "consulta" 4 vezes seguidas
    // — cada uma vira "argumentos-invalidos", e ANTES desta correção o
    // teto de falhasSeguidas (4) jogava um erro fatal: resposta vazia,
    // nada do que já tinha sido reunido chegava ao usuário. Pior do que
    // responder incompleto. Agora, ao bater o teto, a execução encerra
    // como qualquer outra desistência "de boa fé" (limite de iterações,
    // teto de busca): redige com o que existir e avisa na própria
    // resposta que o protocolo falhou, em vez de travar sem nada.
    nome: 'falha de protocolo repetida (4x seguidas) encerra com resposta e aviso, não com erro fatal',
    pedido: 'Qual a capital da França?',
    roteiro: [
      { ferramenta: 'pesquisar_e_ler', argumentos: {} },
      { ferramenta: 'pesquisar_e_ler', argumentos: {} },
      { ferramenta: 'pesquisar_e_ler', argumentos: {} },
      { ferramenta: 'pesquisar_e_ler', argumentos: {} },
    ],
    redacao: 'A capital da França é Paris.',
    espera: {
      ok: true,
      passos: { min: 4, max: 4 },
      protocoloRecusou: 'argumentos-invalidos',
      instrucaoContem: ['consulta'],
      respostaContem: ['modelo teve dificuldade em seguir o protocolo'],
    },
  },

  {
    // Achado pelo Davi na UI (2026-09-20), revisando o painel "Progresso":
    // quando a execução termina pela desistência "de boa fé" acima (falha
    // de protocolo repetida), os itens do checklist que ainda estavam
    // "pendente" no momento da desistência ficavam PRA SEMPRE com o círculo
    // vazio — nem marca de "feito" (✓ verde), nem risco de "pulado" —
    // porque essa saída de emergência ia direto pra `finalizarComResposta`
    // sem passar pelo gate normal de responder/concluir (só ele resolve os
    // pendentes). Teste direto via `Agent` (não pelo formato roteiro/espera
    // — preciso conferir os DOIS itens do checklist, não só um) pra provar
    // que agora eles saem marcados "pulado" (não "feito": a execução está
    // desistindo por falha do modelo, não entregando o item de verdade).
    nome: 'checklist: itens ainda pendentes na desistência por falha de protocolo (4x) saem marcados "pulado", não travados em "pendente" para sempre',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [
          {
            ferramenta: 'listar_arquivos',
            argumentos: { caminho: '.' },
            plano: ['pesquisar a capital da frança', 'responder com a capital'],
          },
          { ferramenta: 'pesquisar_e_ler', argumentos: {} },
          { ferramenta: 'pesquisar_e_ler', argumentos: {} },
          { ferramenta: 'pesquisar_e_ler', argumentos: {} },
          { ferramenta: 'pesquisar_e_ler', argumentos: {} },
        ],
        redacao: 'A capital da França é Paris. (O modelo teve dificuldade em seguir o protocolo nesta execução.)',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-checklist-protocolo-'));
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
          maxIterations: 10,
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
          pipelineForcadoUniversal: true, // força o checklist a existir, mesmo pedido curto
        },
        userDataPath: workspace,
        skills,
      });

      let ultimoChecklist = [];
      agente.on('checklist', (c) => {
        ultimoChecklist = c;
      });

      let retorno;
      try {
        retorno = await agente.run('Qual a capital da frança?');
      } finally {
        await falso.fechar?.();
      }

      const pendentesRestantes = ultimoChecklist.filter((i) => i.status === 'pendente');
      const todosPulados = ultimoChecklist.length > 0 && ultimoChecklist.every((i) => i.status === 'pulado');

      return [
        Boolean(retorno?.ok) || `execução não terminou ok: ${JSON.stringify(retorno)}`,
        ultimoChecklist.length >= 2 ||
          `esperava pelo menos 2 itens no checklist final, obteve ${JSON.stringify(ultimoChecklist)}`,
        pendentesRestantes.length === 0 ||
          `item(ns) ainda travados em "pendente" depois da desistência: ${JSON.stringify(pendentesRestantes)}`,
        todosPulados || `esperava todos os itens "pulado", obteve ${JSON.stringify(ultimoChecklist)}`,
      ];
    },
  },

  {
    nome: 'busca repetida é bloqueada na terceira vez',
    pedido: 'Pesquise sobre um assunto qualquer',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o que encontrei' } },
    ],
    espera: { ok: true, erroContem: ['Ação repetida'] },
  },

  {
    // Achado na MESMA execução real do teste de `investigar_subtarefa` acima
    // (Davi, 2026-09-22/23, "melhor fone pra PUBG" 2ª rodada): o gate de
    // "ação repetida" (loop.js, perto de `mensagemDeAcaoRepetida`) move
    // `tarefa.estado` de EXECUTANDO pra REPLANEJANDO, mas — diferente do
    // replanejamento normal (aplicarRecomendacaoCritico, que sempre agenda
    // `this.replanejamentoPendente`, devolvido a EXECUTANDO no topo da
    // próxima iteração) — NUNCA agendava nada. Sem recuperação, a tarefa
    // ficava presa em REPLANEJANDO pelo resto da execução, e os ramos
    // "perguntar"/"replanejar" de `aplicarRecomendacaoCritico` (inclusive a
    // crítica PERIÓDICA, que é a que mais roda) só agem quando
    // `tarefa.estado` está em PLANEJANDO/EXECUTANDO — travada, toda
    // recomendação seguinte do crítico virava letra morta em silêncio. Na
    // execução real isso engoliu 9+ "perguntar" depois do gate disparar uma
    // única vez.
    //
    // Este caso reproduz a sequência mínima: 3 chamadas repetidas disparam
    // o gate (mesmo padrão do teste acima), DEPOIS a crítica periódica
    // recomenda "perguntar" — sem a correção (devolver a EXECUTANDO logo
    // após o veto), essa recomendação seria ignorada e o `responder`
    // seguinte passaria direto; com a correção, ele é vetado pelo gate
    // `tarefa-aguardando_usuario` (até o teto de 2 vezes, ver
    // TAREFA_ESTADO_MAX_VETOS).
    nome: 'gate de ação repetida não deixa a tarefa presa em REPLANEJANDO — crítica periódica ainda consegue vetar responder depois dele',
    pedido: 'Pesquise sobre um assunto qualquer e depois me diga o que achou',
    arquivos: { 'nota.txt': 'Encontrei o número 42 nesta nota de teste, com texto suficiente para a destilação.' },
    config: { criticaPeriodica: true, pipelineForcadoUniversal: false, orcamentoVetosDeResposta: 10, criticoSoPerguntaComFaltaConfirmada: false }, // comportamento antigo dos portões (antes do Controlador v2)
    criticaDoPlano: (() => {
      let chamadas = 0;
      return () => {
        chamadas += 1;
        // 1ª chamada periódica cai na iteração 2 (regra "adianta a primeira
        // crítica"), ANTES do gate de ação repetida disparar (só na 3ª
        // chamada de listar_arquivos, iteração 3) — "ok" pra não interferir
        // no cenário. Só a 2ª chamada (iteração 5, intervalo padrão de 5)
        // devolve "perguntar", já depois do estado ter passado por
        // REPLANEJANDO.
        return chamadas >= 2
          ? '{"status":"perguntar","problema":"falta confirmar um detalhe com o usuário antes de concluir"}'
          : 'ok';
      };
    })(),
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 3ª vez: gate de ação repetida dispara aqui
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } }, // chave diferente, só avança a iteração
      { ferramenta: 'responder', argumentos: { foco: 'o que encontrei' } }, // vetado 2x, passa na 3ª tentativa
    ],
    redacao: 'Resumo do que encontrei.',
    espera: {
      ok: true,
      copilotoGates: ['acao-repetida', 'tarefa-aguardando_usuario', 'tarefa-aguardando_usuario'],
    },
  },

  {
    nome: 'concluir sem responder ainda redige a resposta',
    pedido: 'O que diz o arquivo de notas?',
    arquivos: { 'notas.txt': 'A reunião ficou marcada para quinta-feira às 14h.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'notas.txt' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'Objetivo concluído.' } },
    ],
    redacao: 'A reunião está marcada para quinta-feira às 14h.',
    espera: { ok: true, eventos: ['redigindo'], respostaNaoContem: ['Objetivo concluído'] },
  },

  {
    nome: 'pergunta prematura é recusada',
    pedido: 'Me conte sobre o conteúdo da pasta',
    roteiro: [
      { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'o que você quer saber?' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o conteúdo' } },
    ],
    espera: {
      perguntouAoUsuario: false,
      erroContem: ['Pergunta prematura'],
      // Backlog do Copiloto, item m3: este gate também passa pelo helper
      // comum agora (generalização do padrão de m1) — confere o nome certo.
      copilotoGates: ['pergunta-prematura'],
    },
  },

  {
    nome: 'resposta curta demais para o tamanho pedido é refeita',
    pedido: 'Faça um resumo de 40 linhas sobre o arquivo',
    arquivos: { 'base.txt': 'Conteúdo técnico suficiente para desenvolver um texto longo.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'resumo completo' } },
    ],
    // a primeira redação vem curta de propósito; a segunda, completa
    redacao: (_prompt, tentativa) =>
      tentativa === 1
        ? 'Resumo curto.'
        : Array.from({ length: 42 }, (_, i) => `Linha ${i + 1} do resumo desenvolvido.`).join('\n'),
    espera: { ok: true, respostaLinhasMin: 40, promptRedacaoContem: ['TAMANHO OBRIGATÓRIO'] },
  },

  {
    nome: 'limite de passos encerra sem travar',
    pedido: 'Faça algo interminável',
    maxIterations: 3,
    roteiro: [{ ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }],
    espera: { ok: false, eventos: ['limite'], passos: { max: 3 } },
  },

  {
    nome: 'contexto da conversa anterior chega ao prompt',
    pedido: 'E amanhã?',
    conversa: [
      { role: 'user', content: 'Qual a previsão para hoje em Vitória?' },
      { role: 'assistant', content: 'Hoje: 21°C e nublado.' },
    ],
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'previsão de amanhã' } }],
    espera: { promptDecisaoContem: ['CONVERSA ATÉ AQUI', 'Vitória'], promptRedacaoContem: ['CONVERSA ANTERIOR'] },
  },

  {
    // Caso real de produção: numa pergunta sobre carreira em jogo, a skill
    // "Previsão do tempo" ativou — a seleção de skill usava a conversa
    // inteira (inclusive respostas longas do PRÓPRIO agente), e uma menção
    // solta de "tempo" numa resposta anterior sem nada a ver com clima
    // bastava pra ativar. Aqui: a resposta anterior do AGENTE menciona
    // "tempo" fora de contexto de clima — não deve mais ativar a skill.
    nome: 'seleção de skill: menção solta de "tempo" numa resposta ANTERIOR do agente não ativa "Previsão do tempo"',
    pedido: 'Qual caminho devo tomar para virar um jogador melhor?',
    conversa: [
      { role: 'user', content: 'Como ficar melhor no jogo?' },
      { role: 'assistant', content: 'Isso leva tempo e prática — o tempo de reação também importa bastante.' },
    ],
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'como evoluir' } }],
    redacao: 'Pratique regularmente e analise suas partidas.',
    espera: { ok: true, skillsNaoAtivadas: ['Previsão do tempo'] },
  },

  {
    // Contraste com o caso acima: quando é o USUÁRIO quem menciona o assunto
    // antes (não o agente), a continuidade continua funcionando — reduzido,
    // não removido.
    nome: 'seleção de skill: menção do USUÁRIO numa mensagem anterior ainda conta pra continuidade',
    pedido: 'E amanhã, como fica?',
    conversa: [
      { role: 'user', content: 'Qual a previsão do tempo pra hoje?' },
      { role: 'assistant', content: 'Hoje: 21°C e nublado.' },
    ],
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'amanhã' } }],
    redacao: 'Amanhã: 19°C e sol.',
    espera: { ok: true, skillsAtivadas: ['Previsão do tempo'] },
  },

  {
    nome: 'material sobre assunto vizinho é marcado como cobertura ausente',
    pedido: 'O Ollama consegue gerar arquivos docx e xlsx?',
    arquivos: { 'ranking.txt': 'Ranking de modelos: Qwen ativa 3 bilhões por token. SWE-bench 73,4 por cento.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'ranking.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'geração de arquivos' } },
    ],
    espera: { coberturaNivel: 'ausente', promptRedacaoContem: ['desistência'] },
  },

  {
    nome: 'redator recebe o texto original da fonte, não só os fatos destilados',
    // Bug real: a destilação comprime uma leitura em ~8 fatos numéricos e
    // descarta qualquer nuance sem número — uma ressalva, um detalhe do
    // contrato — mesmo quando o texto bruto continuava disponível no dossiê
    // (só não era usado). O redator via só a versão comprimida.
    pedido: 'Resuma o relatório interno anexado',
    arquivos: {
      'relatorio.txt': [
        ...Array.from(
          { length: 14 },
          (_, i) =>
            `Registro ${i + 1} do relatório: o item testado gerou saída consistente com o padrão ` +
            'esperado para esta rodada de verificação interna.'
        ),
        'O relatório também observa uma cláusula de rescisão amigável pouco comum para esse tipo de contrato padrão.',
      ].join('\n'),
    },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o conteúdo do relatório' } },
    ],
    config: { destilarFatos: true, destilarAcimaDe: 500 },
    espera: {
      ok: true,
      destilou: true,
      // ler_arquivo não popula ctx.estado.fontesLidas — cai no caminho de
      // sempre (uma destilação só, sobre a saída inteira da ferramenta),
      // não no caminho novo de "uma destilação por fonte lida"
      chamadasDeDestilacao: 1,
      promptDestilacaoContem: ['Registro 1 do relatório', 'cláusula de rescisão amigável'],
      // sobreviveu à destilação (tinha número): continua chegando ao redator
      promptRedacaoContem: ['Registro 1 do relatório', 'cláusula de rescisão amigável'],
    },
  },

  {
    // Bug real (v0.5.7, teste ao vivo): "Crie um pdf com um
    // resumo curto sobre baterias de íon-lítio" — a busca não trouxe material
    // e o modelo, já na primeira iteração, chamou `responder` direto, sem
    // NUNCA tentar gerar_pdf. A regra 6b do prompt já pedia pra nunca
    // terminar em "responder" quando o pedido é por arquivo, mas é uma frase
    // entre outras nove — o modelo não seguiu. pedidoQuerArquivo() vira uma
    // trava determinística: aqui o roteiro tenta "responder" primeiro (como o
    // modelo fez de verdade) e o teste confere que o agente REJEITA essa
    // tentativa e força a próxima decisão a gerar o arquivo de verdade.
    nome: 'pedido de arquivo que tenta terminar em "responder" sem gerar nada é barrado e corrigido',
    pedido: 'Crie um pdf com um resumo curto sobre baterias de íon-lítio.',
    roteiro: [
      { ferramenta: 'responder', argumentos: { foco: 'baterias de íon-lítio' } },
      { ferramenta: 'gerar_pdf', argumentos: { caminho: 'baterias.pdf', conteudo: 'Resumo sobre baterias de íon-lítio.' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'PDF gerado.' } },
    ],
    espera: {
      ok: true,
      ferramentasChamadas: ['gerar_pdf'],
      // a mensagem corretiva empurrada pro histórico depois da tentativa
      // barrada — prova que foi a trava (e não o modelo) que corrigiu o rumo
      promptDecisaoContem: ['O pedido pede um arquivo'],
      // Backlog do Copiloto, item m1: este gate passou a usar o mesmo
      // helper que os outros três — confere que ele se anuncia com o nome
      // certo, não com o de outro gate.
      copilotoGates: ['pedido-de-arquivo'],
    },
  },

  {
    nome: 'pedidoQuerArquivo: pedido imperativo com formato reconhece corretamente',
    tipo: 'unidade',
    async executar() {
      return [
        pedidoQuerArquivo('Crie um pdf com um resumo curto sobre baterias de íon-lítio.') ||
          'deveria reconhecer "crie um pdf"',
        pedidoQuerArquivo('Crie um documento word com um resumo sobre energia solar.') ||
          'deveria reconhecer "crie um documento word"',
        pedidoQuerArquivo('Gere uma planilha xlsx comparando 3 marcas de painel solar.') ||
          'deveria reconhecer "gere uma planilha xlsx"',
        pedidoQuerArquivo('Exporte esse relatório como excel.') || 'deveria reconhecer "exporte como excel"',
      ];
    },
  },

  {
    // Duas armadilhas reais achadas pela própria bancada (ver rotinas.js e o
    // caso "O Ollama consegue gerar arquivos docx e xlsx?" logo acima nesta
    // lista): só mencionar o nome do formato não é pedido de arquivo.
    nome: 'pedidoQuerArquivo: menção ao formato sem intenção de gerar não dispara',
    tipo: 'unidade',
    async executar() {
      return [
        !pedidoQuerArquivo('O Ollama consegue gerar arquivos docx e xlsx?') ||
          'pergunta de capacidade não deveria contar como pedido',
        !pedidoQuerArquivo('Analise o relatorio-inexistente.pdf') ||
          'citar a extensão de um arquivo existente não deveria contar como pedido',
        !pedidoQuerArquivo('O que diz o relatorio.docx? Cite os números da tabela.') ||
          'perguntar sobre o conteúdo de um docx existente não deveria contar como pedido',
        !pedidoQuerArquivo('Qual a previsão do tempo para Vitória nesta semana?') ||
          'pedido sem nenhum formato de arquivo não deveria contar como pedido',
      ];
    },
  },

  {
    // Caso real (Davi, conversa sobre "Como funciona o sol?"): a crítica do
    // plano (criticaDoPlano, dispara na iteração 2) alegou "não menciona como
    // o sol afeta a vida na Terra" quando a busca já tinha trazido exatamente
    // isso — porque o crítico só via o PLANO (texto que o outro agente
    // DECLAROU) e a lista `jaFeito` ("ferramenta(argumento)", sem conteúdo),
    // nunca o que foi de fato lido. Este teste confere que o prompt enviado
    // ao crítico agora carrega uma amostra do material coletado de verdade
    // (dossiê), não só o plano declarado.
    nome: 'crítica do plano recebe o material já coletado, não só o plano declarado (caso real: pergunta sobre o Sol)',
    pedido: 'Como funciona o sol? (especificamente como ele afeta a vida na Terra)',
    arquivos: {
      'fonte.txt':
        'O Sol fornece a energia da fotossíntese, sustentando a vida na Terra e toda a cadeia alimentar.',
    },
    // pipelineForcadoUniversal desligado de propósito: este teste conta
    // chamadas exatas do crítico periódico na cadência "simples" (1 chamada
    // na iteração 2) — com o pipeline universal (padrão desde 2026-09-14)
    // este pedido de 1 pergunta usaria a cadência "Complexo" (mais frequente)
    // e o teste contaria chamadas a mais sem relação com o que ele verifica.
    config: { criticaPeriodica: true, pipelineForcadoUniversal: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fonte.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'como o sol afeta a vida na Terra', fontes: [] } },
    ],
    // resposta fixa e inofensiva do crítico — o que este teste prova é que o
    // MATERIAL chegou ao prompt dele, não o que um modelo de verdade
    // concluiria a partir disso (isso não dá pra testar deterministicamente).
    criticaDoPlano: 'ok',
    redacao: 'O Sol sustenta a vida na Terra através da fotossíntese.',
    espera: {
      ok: true,
      chamadasCriticaPlano: 1,
      promptCriticaContem: ['MATERIAL JÁ COLETADO', 'fotossíntese', 'vida na Terra'],
    },
  },

  {
    // Caso real de produção: pedido com 9-10 perguntas de prova (uma por
    // assunto de Ciência da Computação) recebeu de volta um resumo da
    // ESTRUTURA de uma única página web, sem responder nenhuma pergunta de
    // verdade — o teto antigo de 5 em decomporPedido só rastreava metade
    // delas, e nada instruía o redator a tratar cada pergunta separadamente.
    // Versão reduzida aqui (4 perguntas, suficiente pra passar do piso de 3
    // de perguntasMultiplas) confere que o prompt de redação carrega a
    // lista numerada de perguntas — não dá pra testar deterministicamente
    // se um modelo de verdade vai responder todas, só que a instrução chega.
    nome: 'pedido com várias perguntas distintas (caso real: prova com 9-10 questões) — redator recebe cada uma numerada',
    pedido: 'O que é NP-completo? O que é thrashing em sistemas operacionais? Como funciona o Paxos? O que é RSA?',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'as 4 perguntas de teoria' } }],
    redacao:
      '1. NP-completo é a classe de problemas de decisão verificáveis em tempo polinomial. ' +
      '2. Thrashing é quando o sistema operacional gasta mais tempo trocando páginas de memória do que executando. ' +
      '3. Paxos é um protocolo de consenso distribuído tolerante a falhas. ' +
      '4. RSA é um algoritmo de criptografia de chave pública baseado em fatoração de números primos.',
    espera: {
      ok: true,
      promptRedacaoContem: [
        'ESTE PEDIDO TEM 4 PERGUNTAS DISTINTAS',
        '1. O que é NP-completo',
        '2. O que é thrashing em sistemas operacionais',
        '3. Como funciona o Paxos',
        '4. O que é RSA',
      ],
    },
  },

  {
    // Peça de discussão com o Davi (02/09): decidir "este pedido precisa de
    // plano?" é o tipo de julgamento que um modelo pequeno responde de forma
    // inconsistente — às vezes declara `plano` na primeira decisão, às vezes
    // não. classificarPedido (verificador.js) tira isso do modelo: quando um
    // pedido tem 3+ perguntas distintas, planejarInicial roda ANTES da
    // primeira iteração, e o resultado já aparece como "SEU PLANO:" desde o
    // passo 1 — não fica esperando o modelo lembrar de propor um plano.
    nome: 'pedido classificado como complexo (3+ perguntas) recebe plano inicial forçado antes da primeira decisão',
    pedido: 'O que é NP-completo? O que é thrashing? Como funciona o Paxos?',
    planejamentoInicial: '- Responder o que é NP-completo\n- Responder o que é thrashing\n- Responder como funciona o Paxos',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'as 3 perguntas' } }],
    redacao: 'Resposta às três perguntas.',
    espera: {
      ok: true,
      chamadasPlanejamento: 1,
      promptDecisaoContem: [
        'SEU PLANO:',
        'Responder o que é NP-completo',
        'Responder o que é thrashing',
        'Responder como funciona o Paxos',
      ],
    },
  },

  {
    // pipelineForcadoUniversal desligado de propósito: este teste prova que
    // classificarPedido() por si só (sem o flag universal, padrão desde
    // 2026-09-14) continua isentando pedido simples do plano forçado — ver
    // "pedido classificado como complexo..." (com o flag ligado, TODO pedido
    // recebe plano forçado, inclusive este).
    nome: 'pedido simples (sem múltiplas perguntas, curto) NÃO dispara planejamento inicial quando pipelineForcadoUniversal está desligado',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer do relatório.' },
    config: { pipelineForcadoUniversal: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o resumo' } },
    ],
    redacao: 'Resumo do relatório.',
    espera: { ok: true, chamadasPlanejamento: 0, promptDecisaoNaoContem: ['SEU PLANO:'] },
  },

  {
    // Contraprova: o MESMO pedido simples, mas com pipelineForcadoUniversal
    // ligado explicitamente — pedido de Davi 2026-09-14 ("apertar as rédeas
    // pra qualquer tipo de pergunta"): agora recebe plano forçado mesmo
    // sendo curto e de 1 pergunta só. Davi testou o padrão universal na
    // prática (2026-09-16) e achou a latência alta demais pro dia a dia —
    // o padrão voltou a ser `false` (ver config.js), mas o flag continua
    // disponível ligando explicitamente, como aqui.
    nome: 'pedido simples (sem múltiplas perguntas, curto) TAMBÉM recebe planejamento inicial com pipelineForcadoUniversal ligado',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer do relatório.' },
    planejamentoInicial: '- Ler o relatório\n- Resumir o conteúdo',
    config: { pipelineForcadoUniversal: true },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' } },
      // plano: [''] (ver a "pegadinha" documentada no teste do gate de
      // checklist logo acima) — representa "não sobrou nenhum item", pra
      // reconciliarChecklist fechar os 2 itens do plano forçado e o gate
      // (ligado aqui) não barrar este responder.
      { ferramenta: 'responder', argumentos: { foco: 'o resumo' }, plano: [''] },
    ],
    redacao: 'Resumo do relatório.',
    espera: { ok: true, chamadasPlanejamento: 1, promptDecisaoContem: ['SEU PLANO:', 'Ler o relatório'] },
  },

  {
    // Caso real de produção (bateria de testes com o Davi, prova de 6
    // questões de teoria de CC): o plano forçado criava o checklist certo,
    // mas o modelo pesquisou só a questão 1 (duas buscas) e já chamou
    // `responder` com as outras 5 ainda pendentes — nada barrava isso antes.
    // Este caso reduz pra 3 perguntas (mesmo piso de classificarPedido) e
    // simula essa sequência: a 1ª tentativa de `responder` ainda redeclara
    // os 3 itens do plano (nenhum foi resolvido de verdade) e deve ser
    // barrada; só na 2ª tentativa, quando o modelo já não tem mais nada a
    // planejar, é que `responder` passa.
    //
    // Pegadinha pra quem for mexer neste teste: `plano: []` (array
    // literalmente vazio) NÃO serve pra representar "nada mais a fazer" —
    // reconciliarChecklist só roda quando `plano.plano.length` é verdadeiro
    // (ver loop.js), então [] deixaria o checklist antigo intocado pra
    // sempre (os 3 itens continuariam pendentes e o gate nunca liberaria,
    // fora pelo teto). Um placeholder textual novo tipo "responder" ou
    // "finalizar" também não serve — reconciliarChecklist compara por
    // SUBSTRING (aindaNoNovo) e por texto desconhecido (novosItens), então
    // ou o texto bate com um item antigo (ele continua "encontrado", logo
    // pendente) ou vira um item NOVO pendente (fantasma). O que representa
    // de verdade "não sobrou nenhum plano" é um array não-vazio cujo único
    // conteúdo é uma string em branco (`['']`) — passa pelo teste de
    // tamanho em loop.js (tem 1 elemento), mas reconciliarChecklist filtra
    // strings vazias internamente, então o `novo` efetivo fica vazio: todo
    // item pendente perde a correspondência e vira feito/pulado, sem
    // adicionar nada novo.
    nome: 'gate de checklist pendente barra "responder" enquanto o plano forçado ainda tem itens (caso real: prova de 3+ questões respondida só em parte)',
    pedido: 'O que é NP-completo? O que é thrashing? Como funciona o Paxos?',
    planejamentoInicial: '- Responder o que é NP-completo\n- Responder o que é thrashing\n- Responder como funciona o Paxos',
    roteiro: [
      {
        // tenta encerrar redeclarando os 3 itens no plano — nenhum foi
        // abandonado de verdade, então o checklist continua com 3 pendentes.
        ferramenta: 'responder',
        argumentos: { foco: 'NP-completo' },
        plano: ['Responder o que é NP-completo', 'Responder o que é thrashing', 'Responder como funciona o Paxos'],
      },
      {
        // agora o modelo não declara mais nenhum item ativo — os 3 somem da
        // lista e viram feito/pulado (ver pegadinha do comentário acima).
        ferramenta: 'responder',
        argumentos: { foco: 'as 3 perguntas' },
        plano: [''],
      },
    ],
    redacao: 'Resposta às três perguntas: NP-completo, thrashing e Paxos.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['responder'],
      erroContem: ['Seu plano ainda tem 3 item(ns) pendente(s)'],
      // Backlog do Copiloto, item m1: este gate (checklist-pendente) agora
      // passa pelo helper comum `vetoDoCopiloto` — confere que o evento
      // 'copiloto' nomeia o gate certo e conta a intervenção.
      copilotoGates: ['checklist-pendente'],
    },
  },

  {
    // Contraprova do gate acima: pedido SIMPLES (classificarPedido diz que
    // não precisa de planejamento) chamando "responder" direto, mesmo
    // redeclarando itens "pendentes" no plano — com pipelineForcadoUniversal
    // desligado de propósito (ver comentário no teste equivalente de
    // planejamento acima), o gate volta a só existir pra pedidos
    // classificados como complexos, então aqui não deve barrar nada, nem
    // gastar um passo a mais. Sem o flag desligado, este MESMO roteiro seria
    // barrado — é exatamente o comportamento novo que o Davi pediu (ver o
    // teste seguinte).
    nome: 'gate de checklist pendente NÃO se aplica a pedido simples quando pipelineForcadoUniversal está desligado',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer do relatório.' },
    config: { pipelineForcadoUniversal: false },
    roteiro: [
      {
        ferramenta: 'responder',
        argumentos: { foco: 'o resumo' },
        plano: ['ler o arquivo', 'resumir o conteúdo'],
      },
    ],
    redacao: 'Resumo do relatório.',
    espera: { ok: true, passos: { max: 1 }, ferramentasChamadas: ['responder'] },
  },

  {
    // Pedido de Davi 2026-09-14 ("apertar as rédeas pra qualquer tipo de
    // pergunta"): o MESMO pedido simples de cima, mas com
    // pipelineForcadoUniversal ligado explicitamente (não é mais o padrão —
    // ver nota acima) — o gate de checklist vale mesmo sem classificarPedido
    // considerar o pedido complexo, e barra "responder" enquanto o plano
    // (mesmo um autodeclarado pelo modelo, sem vir de planejarInicial) ainda
    // tiver item pendente.
    nome: 'gate de checklist pendente TAMBÉM se aplica a pedido simples com pipelineForcadoUniversal ligado',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer do relatório.' },
    config: { pipelineForcadoUniversal: true },
    roteiro: [
      {
        ferramenta: 'responder',
        argumentos: { foco: 'o resumo' },
        plano: ['ler o arquivo', 'resumir o conteúdo'],
      },
      { ferramenta: 'responder', argumentos: { foco: 'o resumo' }, plano: [''] },
    ],
    redacao: 'Resumo do relatório.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['responder'],
      erroContem: ['item(ns) pendente(s)'],
    },
  },

  {
    // O teto (ITENS_PENDENTES_MAX_VETOS) existe pra não travar pra sempre se
    // o modelo insistir errado ou algum item for genuinamente impossível de
    // resolver — depois de barrar 1 vez (era 3 até 11/10), a 2ª tentativa de "responder" deve
    // passar mesmo com itens ainda pendentes (mesmo padrão de "falha após N
    // tentativas" já usado no resto do arquivo, ex.: mensagemDeAcaoRepetida).
    nome: 'gate de checklist pendente para de barrar depois do teto (ITENS_PENDENTES_MAX_VETOS) e deixa passar mesmo incompleto',
    pedido: 'O que é NP-completo? O que é thrashing? Como funciona o Paxos?',
    config: { orcamentoVetosDeResposta: 10, criticoSoPerguntaComFaltaConfirmada: false }, // teto próprio do portão de checklist (antes do orçamento único de vetos)
    planejamentoInicial: '- Responder o que é NP-completo\n- Responder o que é thrashing\n- Responder como funciona o Paxos',
    roteiro: [
      {
        ferramenta: 'responder',
        argumentos: { foco: 'insistindo' },
        plano: ['Responder o que é NP-completo', 'Responder o que é thrashing', 'Responder como funciona o Paxos'],
      },
      {
        ferramenta: 'responder',
        argumentos: { foco: 'insistindo' },
        plano: ['Responder o que é NP-completo', 'Responder o que é thrashing', 'Responder como funciona o Paxos'],
      },
      {
        ferramenta: 'responder',
        argumentos: { foco: 'insistindo' },
        plano: ['Responder o que é NP-completo', 'Responder o que é thrashing', 'Responder como funciona o Paxos'],
      },
      {
        // sobra do roteiro de quando o teto era 3: a 2ª tentativa já passa
        ferramenta: 'responder',
        argumentos: { foco: 'insistindo' },
        plano: ['Responder o que é NP-completo', 'Responder o que é thrashing', 'Responder como funciona o Paxos'],
      },
    ],
    redacao: 'Resposta parcial, só sobre NP-completo.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['responder'],
      erroContem: ['Seu plano ainda tem 3 item(ns) pendente(s)'],
      // um veto só (a 2ª tentativa passa)
      copilotoGates: ['checklist-pendente'],
    },
  },

  {
    // Caso real (Davi, bateria de matemática de 7 questões, rastro de 24
    // passos): `planejarInicial` propõe um passo final do tipo "escrever a
    // resposta consolidada" — legítimo, mas nenhuma ferramenta além de
    // responder/concluir resolve "escrever a resposta". Sobrando só esse
    // item, o gate de checklist pendente barrava a ÚNICA ação capaz de
    // cumpri-lo — um impasse contra o próprio gate, só desfeito gastando os
    // 3 vetos à toa (ver ehItemDeEntregaFinal em loop.js). Aqui o item final
    // continua pendente na hora de chamar responder (o modelo ainda o
    // redeclara em `plano`, igual faria de verdade) — o gate deve deixar
    // passar DE PRIMEIRA, sem nenhum veto.
    nome: 'gate de checklist pendente NÃO barra mais quando só resta o item "escrever a resposta final" (caso real: rastro de 24 passos)',
    pedido: 'Resolva a questão 1 e escreva a resposta final consolidada',
    planejamentoInicial: '- Resolver a questão 1\n- Escrever a resposta final consolidada',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' }, plano: ['Escrever a resposta final consolidada'] },
      { ferramenta: 'responder', argumentos: { foco: 'a resposta' }, plano: ['Escrever a resposta final consolidada'] },
      // resto é só rede de segurança — se a correção regredir, o gate volta a
      // vetar e o teste falha de forma clara em `passos`/`copilotoGates`, em
      // vez de estourar o roteiro.
      { ferramenta: 'responder', argumentos: { foco: 'a resposta' }, plano: ['Escrever a resposta final consolidada'] },
      { ferramenta: 'responder', argumentos: { foco: 'a resposta' }, plano: ['Escrever a resposta final consolidada'] },
      { ferramenta: 'responder', argumentos: { foco: 'a resposta' }, plano: [] },
    ],
    redacao: 'Resposta consolidada da questão 1.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      copilotoGates: [],
      ferramentasChamadas: ['listar_arquivos', 'responder'],
    },
  },

  {
    // Contraprova do item acima: um item de entrega final na mesma lista NÃO
    // isenta os OUTROS itens genuínos ainda pendentes — o gate continua
    // barrando por causa deles normalmente. Só depois que o item genuíno
    // também se resolve (2ª questão) é que sobra só o item de entrega, e aí
    // sim o gate deixa passar sem vetar de novo.
    nome: 'gate de checklist pendente: item de entrega final não isenta itens genuínos ainda pendentes (contraprova)',
    pedido: 'Resolva as questões 1 e 2 e escreva a resposta final consolidada',
    planejamentoInicial: '- Resolver a questão 1\n- Resolver a questão 2\n- Escrever a resposta final consolidada',
    config: { pipelineForcadoUniversal: true },
    roteiro: [
      {
        ferramenta: 'listar_arquivos',
        argumentos: { caminho: '.' },
        plano: ['Resolver a questão 2', 'Escrever a resposta final consolidada'],
      },
      {
        // só "questão 1" foi resolvida — "questão 2" (item genuíno) ainda
        // pendente deve barrar normalmente, mesmo com o item de entrega
        // final também pendente ao lado dele.
        ferramenta: 'responder',
        argumentos: { foco: 'a resposta' },
        plano: ['Resolver a questão 2', 'Escrever a resposta final consolidada'],
      },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' }, plano: ['Escrever a resposta final consolidada'] },
      // agora só resta o item de entrega final — passa sem vetar de novo.
      { ferramenta: 'responder', argumentos: { foco: 'a resposta' }, plano: ['Escrever a resposta final consolidada'] },
    ],
    redacao: 'Resposta consolidada das questões 1 e 2.',
    espera: {
      ok: true,
      passos: { min: 4, max: 4 },
      copilotoGates: ['checklist-pendente'],
      erroContem: ['Seu plano ainda tem 1 item(ns) pendente(s)'],
    },
  },

  {
    // Pedido de Davi (2026-09-15): o checkpoint 4/4 do Copiloto ("antes de
    // redigir") virou bloqueante — antes só entrava como sugestão no `foco`
    // da redação, e o modelo de redação (pequeno) podia ignorar (caso real:
    // bateria de matemática, dossiê só com tutoriais genéricos, resposta
    // virou um mosaico deles apesar do crítico já ter notado o problema).
    // Agora, quando o crítico sinaliza explicitamente "MATERIAL INSUFICIENTE"
    // (marca própria da fase pre-redacao — ver pedidoDeCriticaAutomatica em
    // prompts.js), o gate barra "responder" e manda pesquisar mais, mesmo
    // padrão do gate de checklist pendente. Uma segunda tentativa, com o
    // crítico satisfeito, passa normalmente.
    nome: 'gate material-insuficiente barra "responder" quando o Copiloto sinaliza que o material coletado não resolve o pedido',
    pedido: 'Explique a teoria da relatividade de Einstein',
    config: { pipelineForcadoUniversal: true },
    criticaAutomatica: (() => {
      let chamadasPreRedacao = 0;
      return (prompt) => {
        // só a fase pre-redacao pode bloquear — as outras (entendimento etc.)
        // recebem a mesma função mock, mas continuam com o padrão inofensivo.
        if (!/imediatamente antes de escrever a resposta final/.test(prompt)) return 'ok';
        chamadasPreRedacao += 1;
        return chamadasPreRedacao === 1 ? 'MATERIAL INSUFICIENTE: o material é sobre outro assunto.' : 'ok';
      };
    })(),
    roteiro: [
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
    ],
    redacao: 'A relatividade de Einstein se divide em restrita e geral.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['responder'],
      erroContem: ['O Copiloto avaliou que o material coletado ainda não resolve o pedido'],
      copilotoGates: ['material-insuficiente'],
    },
  },

  {
    // Caso real de produção (Davi, "Qual o papel da IA no enfrentamento de
    // desafios globais, como mudanças climáticas ou redução da pobreza?",
    // 2026-09-15, conversa mu31qm60-bud6l / execução mu31k022-5r15): o
    // crítico concluiu, em texto livre e SEM a marca "MATERIAL INSUFICIENTE"
    // nem o formato JSON estruturado, que o material "não resolve
    // completamente o pedido original" e "não é diretamente relevante para o
    // objetivo original" (texto verbatim do rastro real) — o gate antigo (só
    // regex ^material insuficiente) deixou passar, e a resposta final saiu
    // uma alucinação completa. INDICA_MATERIAL_INSUFICIENTE cobre essa
    // conclusão equivalente mesmo sem a marca literal.
    nome: 'gate material-insuficiente barra "responder" quando o Copiloto conclui que o material não resolve o pedido, mesmo sem a marca literal (caso real: "IA e desafios globais")',
    pedido: 'Qual o papel da IA no enfrentamento de desafios globais, como mudanças climáticas ou redução da pobreza?',
    config: { pipelineForcadoUniversal: true },
    criticaAutomatica: (() => {
      let chamadasPreRedacao = 0;
      return (prompt) => {
        if (!/imediatamente antes de escrever a resposta final/.test(prompt)) return 'ok';
        chamadasPreRedacao += 1;
        return chamadasPreRedacao === 1
          ? 'Após revisar o material coletado, posso dizer que ele não resolve completamente o pedido original. ' +
              'Embora contenha informações relevantes sobre a aplicação da IA em monitoramento climático, alguns ' +
              'trechos não são diretamente relevante para o objetivo original.'
          : 'ok';
      };
    })(),
    roteiro: [
      { ferramenta: 'responder', argumentos: { foco: 'o papel da IA' } },
      { ferramenta: 'responder', argumentos: { foco: 'o papel da IA' } },
    ],
    redacao: 'A IA contribui para o enfrentamento de desafios globais de várias formas.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['responder'],
      erroContem: ['O Copiloto avaliou que o material coletado ainda não resolve o pedido'],
      copilotoGates: ['material-insuficiente'],
    },
  },

  {
    // Segundo sinal, independente do texto livre: quando o crítico segue o
    // formato JSON estruturado (instrucaoCriticaEstruturada, ver prompts.js)
    // e devolve status "bloquear", o gate barra mesmo sem NENHUMA das duas
    // marcas em texto — usa this.ultimaRecomendacaoCritico (setado dentro da
    // MESMA chamada a criticaAutomatica logo acima) em vez de reanalisar o
    // texto bruto.
    //
    // Descoberta ao escrever este teste (2026-09-17): status "bloquear"
    // também transiciona tarefa.estado pra BLOQUEADA (efeito colateral de
    // aplicarRecomendacaoCritico, que roda DENTRO de criticaAutomatica) — e
    // o gate mais antigo `tarefa-${tarefa.estado}` (mais acima no arquivo,
    // do sistema de Tarefa) vetava TODO responder/concluir daí em diante,
    // SEM TETO — nenhum outro gate deste arquivo se comportava assim, e
    // `TRANSICOES[BLOQUEADA]` (tarefa.js) é um conjunto vazio: nada tira a
    // tarefa desse estado sozinha. A execução só parava ao esgotar o teto de
    // iterações da execução inteira, sem nunca entregar nada — mesmo a
    // própria instrução do gate dizendo pro modelo "informe o bloqueio ao
    // usuário", que só é possível chamando responder, a ferramenta que o
    // próprio gate bloqueava. Corrigido dando um teto (`TAREFA_ESTADO_MAX_VETOS`)
    // a esse gate, mesmo padrão de "falha após N tentativas" do resto do
    // arquivo — depois de 2 vetos, deixa passar. Este teste, mais o de baixo,
    // provam a correção: aqui o crítico continua insistindo (nunca digere
    // "ok"), então o teto do PRÓPRIO gate de pré-redação some com um segundo
    // veto "material-insuficiente" no meio do caminho — mas a execução
    // sempre termina respondendo, nunca mais travada.
    nome: 'gate material-insuficiente barra "responder" quando o Copiloto devolve status "bloquear" estruturado, sem nenhuma marca em texto — e a execução não fica presa pra sempre (caso real: sem teto no gate tarefa-bloqueada)',
    pedido: 'Explique a teoria da relatividade de Einstein',
    config: { pipelineForcadoUniversal: true, orcamentoVetosDeResposta: 10, criticoSoPerguntaComFaltaConfirmada: false }, // portões antigos, cada um com seu teto
    criticaAutomatica: (prompt) =>
      /imediatamente antes de escrever a resposta final/.test(prompt)
        ? '{"status":"bloquear","problema":"o dossiê fala de mecânica clássica, não de relatividade"}'
        : 'ok',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a relatividade' } }],
    redacao: 'A relatividade de Einstein se divide em restrita e geral.',
    espera: {
      ok: true,
      passos: { min: 5, max: 5 },
      ferramentasChamadas: ['responder'],
      erroContem: ['O Copiloto avaliou que o material coletado ainda não resolve o pedido'],
      copilotoGates: ['material-insuficiente', 'tarefa-bloqueada', 'tarefa-bloqueada', 'material-insuficiente'],
    },
  },

  {
    // Teto do gate `tarefa-${tarefa.estado}` isolado (sem interferência do
    // gate material-insuficiente, que no teste acima também dispara e
    // mascararia se o teto FOI de fato TAREFA_ESTADO_MAX_VETOS e não outro
    // número): força a tarefa pra AGUARDANDO_USUARIO de fora (usando
    // consultar_critico sob demanda, que também passa por
    // aplicarRecomendacaoCritico) — sem tocar na fase pre-redacao — e
    // confirma que exatamente 2 vetos "tarefa-aguardando_usuario" acontecem
    // antes de "responder" ser aceito.
    nome: 'gate tarefa-aguardando_usuario para de barrar depois do teto (TAREFA_ESTADO_MAX_VETOS) e deixa passar mesmo sem perguntar_usuario',
    pedido: 'Explique a teoria da relatividade de Einstein',
    config: { pipelineForcadoUniversal: true },
    criticaAutomatica: 'ok',
    consultaCritico: () => '{"status":"perguntar","problema":"falta saber o nível de detalhe desejado"}',
    roteiro: [
      { ferramenta: 'consultar_critico', argumentos: { motivo: 'confirmar nível de detalhe' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
    ],
    redacao: 'A relatividade de Einstein se divide em restrita e geral.',
    espera: {
      ok: true,
      passos: { min: 4, max: 4 },
      ferramentasChamadas: ['consultar_critico', 'responder'],
      copilotoGates: ['tarefa-aguardando_usuario', 'tarefa-aguardando_usuario'],
    },
  },

  {
    // Achado analisando execução real (Davi, 2026-09-22, "melhor fone
    // intra-auricular pra PUBG PC"): a crítica PERIÓDICA (criticaDoPlano,
    // dispara sozinha a cada N passos — é a que mais roda na prática, 11 das
    // 17 consultas ao copiloto naquela execução) já conseguia sinalizar
    // "replanejar" (fase 'plano' sempre esteve em FASES_QUE_PODEM_REPLANEJAR),
    // mas "perguntar" vindo dela nunca virava nada — só pre-redacao/
    // sob-demanda estavam no gate. Na execução real, o crítico apontou 5
    // vezes que faltava comparar as características técnicas e verificar
    // opinião de usuário sobre o fone NO JOGO, e nenhuma teve efeito: o
    // agente seguiu repetindo a mesma busca genérica. Este teste prova que
    // "perguntar" vindo da crítica periódica agora também transiciona pra
    // AGUARDANDO_USUARIO (mesmo gate/mesmo teto de 2 vetos que já protegia
    // consultar_critico, ver teste acima) — sem precisar do agente pedir
    // segunda opinião sozinho.
    nome: 'crítica PERIÓDICA (não só consultar_critico) com "perguntar" também transiciona pra AGUARDANDO_USUARIO e veta responder até o teto (caso real: fone pra PUBG)',
    pedido: 'Explique a teoria da relatividade de Einstein',
    // mesmo motivo do teste "crítica do plano recebe o material..." acima:
    // pipelineForcadoUniversal desligado pra cair na cadência simples (1
    // chamada, fixa na iteração 2), não na Complexo (dispara toda iteração e
    // acabaria confundindo a contagem de vetos que este teste confere).
    config: { criticaPeriodica: true, pipelineForcadoUniversal: false, orcamentoVetosDeResposta: 10, criticoSoPerguntaComFaltaConfirmada: false }, // "perguntar" do crítico sem confirmação (antes do Controlador v2)
    criticaDoPlano: () => '{"status":"perguntar","problema":"falta comparar as opções e verificar opinião de quem já usa"}',
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fonte.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
    ],
    arquivos: { 'fonte.txt': 'A relatividade de Einstein se divide em restrita e geral.' },
    redacao: 'A relatividade de Einstein se divide em restrita e geral.',
    espera: {
      ok: true,
      passos: { min: 4, max: 4 },
      ferramentasChamadas: ['ler_arquivo', 'responder'],
      copilotoGates: ['tarefa-aguardando_usuario', 'tarefa-aguardando_usuario'],
    },
  },

  {
    // Contraprova: uma crítica que NÃO usa a marca "MATERIAL INSUFICIENTE"
    // (um comentário menor, não uma falha real) continua só consultiva —
    // não barra "responder". O gate só bloqueia com o sinal explícito.
    nome: 'gate material-insuficiente NÃO barra "responder" quando a crítica não usa a marca explícita',
    pedido: 'Explique a teoria da relatividade de Einstein',
    config: { pipelineForcadoUniversal: true },
    criticaAutomatica: (prompt) =>
      /imediatamente antes de escrever a resposta final/.test(prompt)
        ? 'Poderia ter mais uma fonte para corroborar o valor de E=mc².'
        : 'ok',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a relatividade' } }],
    redacao: 'A relatividade de Einstein se divide em restrita e geral.',
    espera: {
      ok: true,
      passos: { min: 1, max: 1 },
      ferramentasChamadas: ['responder'],
      copilotoGates: [],
    },
  },

  {
    // Teto (PRE_REDACAO_MAX_VETOS) — mesmo espírito de ITENS_PENDENTES_MAX_VETOS:
    // se o crítico insistir "insuficiente" indefinidamente, a execução não pode
    // travar pra sempre. Depois de 2 vetos, a 3ª tentativa passa mesmo assim.
    nome: 'gate material-insuficiente para de barrar depois do teto (PRE_REDACAO_MAX_VETOS) e deixa passar mesmo assim',
    pedido: 'Explique a teoria da relatividade de Einstein',
    config: { pipelineForcadoUniversal: true },
    criticaAutomatica: (prompt) =>
      /imediatamente antes de escrever a resposta final/.test(prompt) ? 'MATERIAL INSUFICIENTE: continua fora do assunto.' : 'ok',
    roteiro: [
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
      { ferramenta: 'responder', argumentos: { foco: 'a relatividade' } },
    ],
    redacao: 'Resposta parcial, mesmo sem o crítico aprovar de verdade.',
    espera: {
      ok: true,
      passos: { min: 3, max: 3 },
      ferramentasChamadas: ['responder'],
      copilotoGates: ['material-insuficiente', 'material-insuficiente'],
    },
  },

  {
    nome: 'resumoDoDossie: unidade',
    tipo: 'unidade',
    async executar() {
      const vazio = resumoDoDossie([]);
      const umItem = resumoDoDossie([{ origem: 'ler_arquivo(fonte.txt)', texto: 'fato relevante sobre o Sol' }]);
      // cada item passa pelo corte de 300 caracteres por item (dentro de
      // resumoDoDossie), então o marcador precisa caber nesse corte — daí o
      // texto repetido vir DEPOIS do marcador, não substituí-lo.
      const truncado = resumoDoDossie(
        [
          { origem: 'a', texto: `MARCA-A ${'x'.repeat(400)}` },
          { origem: 'b', texto: `MARCA-B ${'y'.repeat(400)}` },
          { origem: 'c', texto: `MARCA-C ${'z'.repeat(400)}` },
        ],
        700
      );
      return [
        vazio === '' || 'dossiê vazio deveria devolver string vazia',
        (umItem.includes('fato relevante sobre o Sol') && umItem.includes('ler_arquivo(fonte.txt)')) ||
          'deveria incluir a origem e o texto do item',
        (!truncado.includes('MARCA-A') && truncado.includes('MARCA-B') && truncado.includes('MARCA-C')) ||
          `com teto de caracteres, deveria manter os itens mais recentes e descartar os mais antigos (obteve: ${truncado.slice(0, 80)}...)`,
      ];
    },
  },

  {
    // Copiloto nível 2 (item novo, planejamento em
    // AuGPT-plano-de-implementacao.md): o próprio agente pode pedir uma
    // segunda opinião quando não tem certeza — diferente da crítica
    // periódica (o orquestrador decide chamar), aqui o resultado volta
    // DIRETO no resultado da ferramenta, então a PRÓXIMA decisão já vê o
    // texto do crítico no próprio histórico.
    nome: 'consultar_critico: ferramenta sob demanda devolve a opinião do crítico direto no resultado, que chega à próxima decisão',
    pedido: 'Resuma as notícias de hoje sobre IA.',
    roteiro: [
      { ferramenta: 'consultar_critico', argumentos: { motivo: 'Não tenho certeza se já pesquisei o suficiente.' } },
      { ferramenta: 'responder', argumentos: { foco: 'notícias sobre IA', fontes: [] } },
    ],
    consultaCritico: 'Você ainda não buscou nenhuma fonte — pesquise antes de responder.',
    redacao: 'Resumo das notícias sobre IA.',
    espera: {
      ok: true,
      ferramentasChamadas: ['consultar_critico'],
      chamadasConsultaCritico: 1,
      promptDecisaoContem: ['Você ainda não buscou nenhuma fonte'],
    },
  },

  {
    // Teto próprio (`criticaSobDemandaMax`, separado do teto da crítica
    // periódica) — mesmo espírito de ITENS_PENDENTES_MAX_VETOS: sem isso, um
    // agente inseguro poderia gastar a execução inteira só perguntando. Após
    // o limite, a ferramenta continua "funcionando" (não vira erro), mas
    // devolve um aviso fixo sem gastar mais uma chamada de modelo.
    nome: 'consultar_critico: teto de consultas por execução — depois do limite, devolve aviso sem gastar chamada de modelo',
    pedido: 'Explique como funciona TCP.',
    config: { criticaSobDemandaMax: 2 },
    roteiro: [
      { ferramenta: 'consultar_critico', argumentos: { motivo: 'dúvida 1' } },
      { ferramenta: 'consultar_critico', argumentos: { motivo: 'dúvida 2' } },
      { ferramenta: 'consultar_critico', argumentos: { motivo: 'dúvida 3 — já devia estar barrada' } },
      { ferramenta: 'responder', argumentos: { foco: 'TCP', fontes: [] } },
    ],
    consultaCritico: 'Parece no caminho certo, continue.',
    redacao: 'TCP é um protocolo de transporte confiável.',
    espera: {
      ok: true,
      chamadasConsultaCritico: 2, // só as 2 primeiras chamaram o modelo de verdade
      promptDecisaoContem: ['Limite de consultas ao crítico já atingido nesta execução (2)'],
    },
  },

  {
    // `copiloto2Modo: 'desligado'` tira o Copiloto inteiro (nível 1 + esta
    // consulta sob demanda) — a ferramenta continua existindo no catálogo
    // (não é um erro chamá-la), só que devolve um aviso claro em vez de
    // fingir que consultou alguém.
    nome: 'consultar_critico: com copiloto2Modo "desligado", devolve aviso sem chamar o modelo',
    pedido: 'Explique o que é recursão.',
    config: { copiloto2Modo: 'desligado' },
    roteiro: [
      { ferramenta: 'consultar_critico', argumentos: { motivo: 'dúvida qualquer' } },
      { ferramenta: 'responder', argumentos: { foco: 'recursão', fontes: [] } },
    ],
    redacao: 'Recursão é quando uma função chama a si mesma.',
    espera: {
      ok: true,
      chamadasConsultaCritico: 0,
      promptDecisaoContem: ['O Copiloto está desligado'],
    },
  },

  {
    // O seletor de 3 modos da UI (renderer/index.html #cfgCopiloto2Modo)
    // substituiu o antigo toggle avulso (#cfgCriticaPeriodica) — "Desligado"
    // precisa desligar TANTO a consulta sob demanda (já coberto acima)
    // QUANTO a crítica PERIÓDICA, mesmo que `criticaPeriodica` (o campo
    // antigo, ainda existe por baixo só por compatibilidade — ver
    // Agent.criticaDoPlano) continue marcado true de uma sessão anterior.
    // Sem este teste, o novo seletor pareceria funcionar na tela mas não
    // desligaria de fato a crítica periódica.
    nome: 'copiloto2Modo "desligado" também desliga a crítica PERIÓDICA, mesmo com criticaPeriodica (campo antigo) ainda true',
    pedido: 'Como funciona o sol?',
    arquivos: { 'fonte.txt': 'O Sol fornece a energia da fotossíntese.' },
    config: { criticaPeriodica: true, copiloto2Modo: 'desligado' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fonte.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'como o sol funciona', fontes: [] } },
    ],
    criticaDoPlano: 'ok',
    redacao: 'O Sol sustenta a vida na Terra através da fotossíntese.',
    espera: {
      ok: true,
      chamadasCriticaPlano: 0,
    },
  },

  {
    // Pedido de Davi 2026-09-14 ("apertar as rédeas": usar o Copiloto EM
    // TODOS OS PASSOS do pipeline, não só ocasionalmente) — os 4 checkpoints
    // fixos de Agent.criticaAutomatica: entendimento (logo após a verificação
    // de ambiguidade), plano inicial (logo após planejarInicial popular o
    // checklist), cada parte concluída (quando um item do checklist sai de
    // "pendente" — aqui a parte A fecha no passo 1, a parte B no passo 2), e
    // antes de redigir (finalizarComResposta, antes da 1ª chamada a
    // redigir()). Confere que os 5 disparam, na ordem certa.
    nome: 'checkpoint automático do Copiloto dispara nos 4 pontos fixos do pipeline (entendimento, plano, cada parte concluída, antes de redigir)',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer do relatório.' },
    config: { pipelineForcadoUniversal: true },
    planejamentoInicial: '- Resolver parte A\n- Resolver parte B',
    criticaAutomatica: 'Considere revisar isso com mais cuidado.',
    roteiro: [
      // fecha "parte A" (não redeclarada) sem tocar em "parte B"
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' }, plano: ['Resolver parte B'] },
      // plano: [''] fecha "parte B" — ver a pegadinha documentada no teste
      // do gate de checklist, mais acima nesta lista.
      { ferramenta: 'responder', argumentos: { foco: 'o resumo' }, plano: [''] },
    ],
    redacao: 'Resumo do relatório.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['listar_arquivos', 'responder'],
      chamadasCriticaAutomatica: 5,
      fasesCriticaAutomatica: ['entendimento', 'plano-inicial', 'parte-concluida', 'parte-concluida', 'pre-redacao'],
    },
  },

  {
    // Teto próprio do checkpoint automático (`criticaAutomaticaPorEtapaMax`,
    // contador separado de criticaSobDemandaMax e criticaPeriodicaMax*) —
    // esgotado, os checkpoints seguintes pulam em silêncio (nem chamam o
    // modelo) em vez de travar a execução. Teto baixo (2) de propósito: os
    // dois primeiros checkpoints (entendimento + plano inicial) já esgotam
    // ele sozinhos, então os 3 que viriam depois (2 partes concluídas + 1
    // antes de redigir) não devem custar nem uma chamada a mais.
    nome: 'checkpoint automático do Copiloto para de custar chamada depois do teto (criticaAutomaticaPorEtapaMax) e não trava a execução',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer do relatório.' },
    config: { criticaAutomaticaPorEtapaMax: 2, pipelineForcadoUniversal: true },
    planejamentoInicial: '- Parte A\n- Parte B\n- Parte C',
    criticaAutomatica: 'Isto não deveria ser chamado depois do teto.',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' }, plano: ['Parte B', 'Parte C'] },
      { ferramenta: 'responder', argumentos: { foco: 'o resumo' }, plano: [''] },
    ],
    redacao: 'Resumo do relatório.',
    espera: {
      ok: true,
      passos: { min: 2, max: 2 },
      ferramentasChamadas: ['listar_arquivos', 'responder'],
      chamadasCriticaAutomatica: 2,
      fasesCriticaAutomatica: ['entendimento', 'plano-inicial'],
    },
  },

  {
    // Caso real que motivou este checkpoint (2026-09-14, bateria de 7
    // questões de matemática): o dossiê ficou cheio de material genérico que
    // não resolve o pedido, e isso só foi descoberto DEPOIS da resposta
    // pronta (verificador pós-hoc). Este teste confere o mecanismo que evita
    // isso: quando o checkpoint "antes de redigir" aponta um problema real
    // (resposta diferente de "ok"), o texto chega no `foco` passado pra
    // redigir() — não fica só num evento que ninguém lê antes de escrever.
    nome: 'checkpoint "antes de redigir" chega no foco passado pra redigir() quando aponta um problema real',
    pedido: 'O que é NP-completo?',
    config: { pipelineForcadoUniversal: true },
    criticaAutomatica: (prompt) =>
      /antes de redigir a resposta final/.test(prompt) ? 'O material coletado não cobre a pergunta feita.' : 'ok',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'NP-completo' }, plano: [''] }],
    redacao: 'NP-completo é uma classe de problemas de decisão.',
    espera: {
      ok: true,
      promptRedacaoContem: ['O material coletado não cobre a pergunta feita.'],
    },
  },

  {
    // Contraprova: com pipelineForcadoUniversal desligado (e um pedido que
    // classificarPedido não considera complexo), os 4 checkpoints não devem
    // disparar nenhuma vez — o mesmo `pipelineCompleto` que gateia o plano
    // forçado e o gate de checklist (item 1) gateia os checkpoints também.
    nome: 'checkpoint automático do Copiloto NÃO dispara quando pipelineForcadoUniversal está desligado e o pedido é simples',
    pedido: 'Resuma o arquivo relatorio.txt',
    arquivos: { 'relatorio.txt': 'Conteúdo qualquer.' },
    config: { pipelineForcadoUniversal: false },
    criticaAutomatica: 'Isto não deveria nunca ser lido.',
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o resumo' } },
    ],
    redacao: 'Resumo do relatório.',
    espera: { ok: true, chamadasCriticaAutomatica: 0 },
  },

  {
    // Checkpoint 3/5 do Copiloto: DIREÇÃO DA PESQUISA (pedido de Davi
    // 2026-09-15, depois do caso em que `respondeAoPedido` aprovou uma
    // resposta sobre história da arte pra um pedido de física quântica — a
    // pesquisa em si foi bem-feita, só que atrás do assunto errado, e nada
    // até então revisava o que a busca de fato trouxe). Usa um servidor
    // local de verdade (não um mock do tipo criticaAutomatica direto) porque
    // o gate só dispara depois de uma leitura REAL alimentar o dossiê — não
    // dá pra testar isso sem uma busca de verdade acontecendo.
    nome: 'checkpoint "direção da pesquisa" dispara depois da 1ª busca trazer material fora do assunto, e a observação chega na próxima decisão',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeBusca(
        paginaCom('A pintura renascentista floresceu no século XV, com mais de 200 obras catalogadas no acervo do museu.')
      );
      try {
        const obtido = await executarCasoAgente({
          nome: 'direcao-pesquisa: fora do assunto',
          pedido: 'Explique o princípio da incerteza de Heisenberg em física quântica',
          config: {
            searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
            permitirLeitorExterno: false,
            subconsultas: false,
            pipelineForcadoUniversal: true,
          },
          // só a fase 'direcao-pesquisa' tem essa frase no rótulo (ver
          // RÓTULO_FASE em prompts.js) — as outras (entendimento, pre-redacao)
          // caem no 'ok' padrão, sem gerar observação nem custar assertiva a mais.
          criticaAutomatica: (prompt) =>
            /mirando o assunto certo do pedido/.test(prompt)
              ? 'O material fala de pintura renascentista, não de física quântica — a busca parece fora do assunto.'
              : 'ok',
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'incerteza de heisenberg', paginas: 1 } },
            { ferramenta: 'responder', argumentos: { foco: 'a explicação' } },
          ],
          redacao: 'A incerteza de Heisenberg diz que posição e momento não podem ser conhecidos com precisão simultânea.',
        });
        return comparar(
          {
            ok: true,
            // 3 checkpoints disparam de verdade (entendimento, direcao-
            // pesquisa, pre-redacao — plano-inicial/parte-concluida ficam de
            // fora porque não há checklist neste caso), mas só direcao-
            // pesquisa devolve texto que não é "ok": é o único que aparece em
            // fasesCriticaAutomatica (ela só lista fases com OBSERVAÇÃO real,
            // não toda chamada — ver VERIFICADORES.fasesCriticaAutomatica em
            // motor.js).
            chamadasCriticaAutomatica: 3,
            fasesCriticaAutomatica: ['direcao-pesquisa'],
            promptDecisaoContem: ['pintura renascentista, não de física quântica'],
          },
          obtido
        );
      } finally {
        await conteudo.fechar();
      }
    },
  },

  {
    // Mesmo checkpoint: com DUAS buscas na mesma execução, confirma que só
    // dispara na PRIMEIRA (ctx.estado.direcaoPesquisaChecada) — cedo o
    // bastante pra intervir, mas sem custar uma chamada a mais a cada nova
    // busca da mesma execução.
    nome: 'checkpoint "direção da pesquisa" dispara só uma vez, mesmo com mais de uma busca na mesma execução',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeBusca(
        paginaCom('Conteúdo genérico de teste com algum número como 123 para passar da destilação.')
      );
      try {
        const obtido = await executarCasoAgente({
          nome: 'direcao-pesquisa: dispara só uma vez',
          pedido: 'Pesquise sobre energias renováveis e faça um resumo',
          config: {
            searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
            permitirLeitorExterno: false,
            subconsultas: false,
            pipelineForcadoUniversal: true,
          },
          criticaAutomatica: 'ok',
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'energia solar', paginas: 1 } },
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'energia eólica', paginas: 1 } },
            { ferramenta: 'responder', argumentos: { foco: 'o resumo' } },
          ],
          redacao: 'Resumo sobre energias renováveis.',
        });
        // 'ok' em toda resposta (dismissal) não gera nenhum evento
        // 'critica-plano' — por isso a prova de "só uma vez" usa a CONTAGEM
        // bruta de chamadas (entendimento + direcao-pesquisa + pre-redacao =
        // 3), não fasesCriticaAutomatica: se o gate disparasse a cada busca,
        // esse total seria 4 (uma direcao-pesquisa a mais, na 2ª busca).
        return comparar({ ok: true, chamadasCriticaAutomatica: 3 }, obtido);
      } finally {
        await conteudo.fechar();
      }
    },
  },

  {
    // Contraprova: mesmo com uma busca de verdade trazendo material, o
    // checkpoint não deve disparar quando `pipelineCompleto` não vale pra
    // este pedido (pipelineForcadoUniversal desligado + pedido simples,
    // igual à contraprova genérica logo acima — só que aqui exercitando
    // especificamente o caminho de ferramenta de busca, não listar_arquivos).
    nome: 'checkpoint "direção da pesquisa" NÃO dispara quando pipelineForcadoUniversal está desligado e o pedido é simples (contraprova)',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeBusca(
        paginaCom('Conteúdo qualquer de teste com número 42 para passar da destilação.')
      );
      try {
        const obtido = await executarCasoAgente({
          nome: 'direcao-pesquisa: desligado',
          pedido: 'Qual a capital da França?',
          config: {
            searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
            permitirLeitorExterno: false,
            subconsultas: false,
            pipelineForcadoUniversal: false,
          },
          criticaAutomatica: 'Isto não deveria nunca ser lido.',
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'capital da frança', paginas: 1 } },
            { ferramenta: 'responder', argumentos: { foco: 'a resposta' } },
          ],
          redacao: 'A capital da França é Paris.',
        });
        return comparar({ ok: true, chamadasCriticaAutomatica: 0 }, obtido);
      } finally {
        await conteudo.fechar();
      }
    },
  },

  /* ------------------------------ numCtxDe: janela de contexto por modelo (decisão/redação/copiloto) ------------------------------ */

  {
    // Pedido do Davi 2026-09-20: as 3 IAs (decisão, redação, copiloto
    // dedicado) podem rodar modelos diferentes e agora também podem ter
    // `numCtx` diferente — mesmo padrão de fallback de `modeloDe()` (campo
    // específico vazio/nulo cai no valor geral). Teste direto no método
    // (sem precisar rodar a execução inteira), como `reselecionarSkillsPorSubtarefa`
    // já faz em avaliacao/casos/melhorias.js.
    nome: 'numCtxDe: sem numCtxRedacao/numCtxCopiloto configurados, as 3 etapas caem no numCtx geral',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({ config: { host: '', model: 'falso', numCtx: 12000 }, skills });
      return [
        agente.numCtxDe('decisao') === 12000 || `decisão deveria cair no geral (12000), obteve ${agente.numCtxDe('decisao')}`,
        agente.numCtxDe('redacao') === 12000 || `redação deveria cair no geral (12000), obteve ${agente.numCtxDe('redacao')}`,
        agente.numCtxDe('copiloto') === 12000 || `copiloto deveria cair no geral (12000), obteve ${agente.numCtxDe('copiloto')}`,
      ];
    },
  },

  {
    nome: 'numCtxDe: numCtxRedacao/numCtxCopiloto preenchidos valem só pra etapa certa — decisão nunca é afetada',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({
        config: { host: '', model: 'falso', numCtx: 12000, numCtxRedacao: 24000, numCtxCopiloto: 6000 },
        skills,
      });
      return [
        agente.numCtxDe('decisao') === 12000 || `decisão não deveria mudar, obteve ${agente.numCtxDe('decisao')}`,
        agente.numCtxDe('redacao') === 24000 || `esperava numCtxRedacao (24000), obteve ${agente.numCtxDe('redacao')}`,
        agente.numCtxDe('copiloto') === 6000 || `esperava numCtxCopiloto (6000), obteve ${agente.numCtxDe('copiloto')}`,
      ];
    },
  },

  {
    // Pedido de Davi 2026-09-23 (nova janela "Visualizar Execuções",
    // gráfico "qual parte do raciocínio levou mais tempo e custou mais
    // tokens"): `contabilizar(uso, meta)` ganhou um segundo argumento
    // opcional que emite 'uso-chamada' (tipo + tokens + duração), sem mudar
    // o comportamento antigo (acumulado em `this.uso` + evento 'uso'
    // continuam idênticos). Este teste confirma as duas pontas: o evento
    // novo sai certo QUANDO `meta.tipo` é passado, e NÃO sai (compatível com
    // as chamadas antigas de `contabilizar(uso)` sem segundo argumento, ex.:
    // a injetada em `rotinas.preencher`) quando não é.
    nome: 'contabilizar: emite uso-chamada com tipo/duração quando meta.tipo é passado; sem meta, só o acumulado de sempre',
    tipo: 'unidade',
    executar() {
      const agente = new Agent({ config: { host: '', model: 'falso' }, skills });
      const chamadas = [];
      agente.on('uso-chamada', (e) => chamadas.push(e));

      agente.contabilizar({ promptTokens: 100, completionTokens: 40 }, { tipo: 'redacao', duracaoMs: 1234 });
      agente.contabilizar({ promptTokens: 30, completionTokens: 10 }); // sem meta — chamada antiga, não deve gerar uso-chamada
      agente.contabilizar({ promptTokens: 0, completionTokens: 0 }, { tipo: 'decisao' }); // sem tokens — nem o acumulado conta

      return [
        chamadas.length === 1 || `esperava 1 evento uso-chamada, veio ${chamadas.length}`,
        chamadas[0]?.tipo === 'redacao' || `tipo veio ${chamadas[0]?.tipo}`,
        chamadas[0]?.promptTokens === 100 && chamadas[0]?.completionTokens === 40 || 'tokens do uso-chamada não bateram',
        chamadas[0]?.duracaoMs === 1234 || `duracaoMs veio ${chamadas[0]?.duracaoMs}`,
        agente.uso.prompt === 130 && agente.uso.completion === 50 || `acumulado veio ${JSON.stringify(agente.uso)}`,
      ];
    },
  },

  {
    // Ponta a ponta de verdade: confirma que a chamada de REDAÇÃO real
    // (redigir(), a única das 3 etapas com um único ponto de chamada fácil
    // de isolar) manda o `num_ctx` de `numCtxRedacao` pro Ollama — não o
    // `numCtx` geral. Prova que o valor calculado por `numCtxDe()` chega de
    // fato até a requisição HTTP, não só até o método.
    nome: 'numCtxDe: end-to-end — redigir() manda numCtxRedacao (não o numCtx geral) na chamada real ao Ollama',
    tipo: 'unidade',
    async executar() {
      let numCtxRecebido = null;
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
          if (/\/api\/embed/.test(req.url)) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ embeddings: [Array(16).fill(0.1)] }));
          }
          // `redigir()` é a ÚNICA chamada desta execução que usa
          // `ollama.chatStream` (stream:true) — todas as outras (decisão via
          // `ollama.chat`, e a `refletir()` que finalizarComResposta também
          // chama antes de redigir, achado depurando este teste: também é
          // format-less, então não dava pra usar `!format` como sinal) usam
          // `ollama.chat` (stream:false). `stream:true` é o sinal certo.
          if (pedido.stream === true) numCtxRecebido = pedido.options?.num_ctx ?? null;
          res.setHeader('Content-Type', 'application/json');
          const conteudo = pedido.format
            ? JSON.stringify({ ferramenta: 'responder', argumentos: { foco: 'teste' }, plano: [] })
            : 'Resposta de teste.';
          // NDJSON: `chatStream` só processa uma linha depois de ver o '\n'
          // seguinte (a última linha do buffer é tratada como possivelmente
          // incompleta) — sem a quebra de linha final, o conteúdo nunca é
          // interpretado e `redigir()` volta com texto vazio.
          res.end(`${JSON.stringify({ message: { content: conteudo }, done: true, prompt_eval_count: 10, eval_count: 5 })}\n`);
        });
      });
      await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-numctx-redacao-'));
      const agente = new Agent({
        config: {
          host: `http://127.0.0.1:${servidor.address().port}`,
          model: 'falso',
          modelDecisao: '',
          modelRedacao: '',
          embedModel: '',
          numCtx: 12000,
          numCtxRedacao: 24000,
          temperature: 0.3,
          numPredict: 200,
          numPredictResposta: 200,
          maxIterations: 4,
          autonomy: 'auto',
          workspace,
          usarRotinas: false,
          skillsDesativadas: [],
          ferramentasDesativadas: [],
          destilarFatos: false,
          verificarAmbiguidade: false,
        },
        userDataPath: workspace,
        skills,
      });

      try {
        await agente.run('Diga oi');
      } finally {
        await new Promise((resolve) => servidor.close(resolve));
      }

      return [numCtxRecebido === 24000 || `esperava num_ctx 24000 (numCtxRedacao) na chamada de redação, obteve ${numCtxRecebido}`];
    },
  },

  /* ------------------------------ compactação de contexto: sem "resumo do resumo" ------------------------------ */

  {
    // Bug real (documento trazido pelo Davi, 2026-09-21, sobre o antipadrão
    // "resumo → resumo do resumo → perda cumulativa"): a compactação de
    // histórico em loop.js concatenava cada resumo novo no FIM do resumo
    // anterior (`resumo + '\n' + novo`) e só então cortava o total pelo
    // TAMANHO com `.slice(-6000)` — corte cego pela frente, sem o modelo
    // nunca ver o que já tinha sido resumido antes. Numa execução com 2+
    // compactações, fato antigo desaparecia em silêncio.
    //
    // Este caso força DUAS compactações na mesma execução: `numCtx` bem
    // pequeno derruba o limiar pro piso de 4000 caracteres (determinístico,
    // não depende do tamanho do prompt de sistema — ver comentário no
    // `config` abaixo), e os argumentos de `salvar_memoria` são grandes o
    // bastante (nunca entram no corte de "resultado antigo" de `paraEnvio` —
    // só o RESULTADO da ferramenta encolhe pra `curto`, o argumento decisão-
    // a-decisão em `decisaoCompacta` nunca encolhe) pra cruzar esse piso já
    // na 3ª e de novo na 5ª iteração (historico.length só passa de 6 a
    // partir da 3ª iteração, então esse é o disparo mais cedo possível).
    //
    // Confere duas coisas, cada uma provando uma metade da correção:
    // (1) `promptDestilacaoContem: ['RESUMO_UM…']` — o resumo ANTERIOR
    //     entra no pedido da 2ª fusão (prova que loop.js está de fato
    //     PASSANDO `resumo` pra `prompts.pedidoDeResumo`, não só que a
    //     função aceita o parâmetro novo);
    // (2) `historicoEnxuto` na ÚLTIMA decisão (a de "concluir", já depois
    //     das duas compactações): carrega o resultado da FUSÃO (RESUMO_DOIS),
    //     nunca mais RESUMO_UM concatenado por fora do modelo. Antes da 2ª
    //     compactação, RESUMO_UM aparecer numa decisão é ESPERADO (é o
    //     resumo vigente até ali) — por isso a checagem é só na última
    //     decisão, não em todas (usar `promptDecisaoNaoContem`, que junta
    //     TODAS as decisões da execução, acusaria até a correção certa).
    nome: 'compactação de histórico: resumo anterior entra na fusão, nunca mais é concatenado e cortado às cegas (2 compactações seguidas)',
    pedido: 'Anote cada um dos registros abaixo na memória de longo prazo, um de cada vez, depois conclua.',
    maxIterations: 8,
    config: {
      // Bem pequeno de propósito: derruba `(numCtxDe('decisao') -
      // tokensDoFixo) * 0.45 * 3.5` pra negativo, garantindo que o limiar de
      // compactação caia sempre no piso `Math.max(4000, ...)` — o teste não
      // depende do tamanho exato do prompt de sistema pra decidir quando
      // compactar.
      numCtx: 50,
    },
    roteiro: [1, 2, 3, 4, 5]
      .map((n) => ({
        ferramenta: 'escrever_arquivo',
        argumentos: {
          // `caminho` diferente a cada chamada de propósito: o portão de
          // "ação repetida" (loop.js, ~linha 3251) monta a chave de
          // detecção com `caminho` (entre outros campos) — usar sempre o
          // MESMO caminho (ou uma ferramenta como salvar_memoria, cujo
          // único argumento não entra nessa chave) faria a 3ª chamada em
          // diante ser barrada como repetição, nunca chegando a executar
          // de verdade nem a passar pelo trecho de compactação.
          caminho: `registro-${n}.txt`,
          // Vai inteiro pro histórico via `decisaoCompacta` (nunca encolhe,
          // diferente do RESULTADO da ferramenta) — é isso que infla
          // `historico` rápido o bastante pra cruzar o piso de 4000
          // caracteres já na 3ª e na 5ª iteração.
          conteudo: `Registro de teste número ${n}, só para ocupar espaço no histórico e forçar a compactação — ${'dado irrelevante repetido '.repeat(100)}`.slice(0, 3000),
        },
      }))
      .concat([{ ferramenta: 'concluir', argumentos: { resumo: 'Registros anotados.' } }]),
    destilacao: (() => {
      // pedidoDeResumo() não tem interceptação própria em servidorFalso —
      // cai no balde genérico de "destilação" (stream:false, sem format).
      // Cada chamada é identificável pelo texto fixo do prompt; a ORDEM das
      // chamadas é a ordem das 2 compactações desta execução.
      let chamadasDeResumo = 0;
      return (prompt) => {
        if (/Resuma o histórico abaixo/.test(prompt)) {
          chamadasDeResumo += 1;
          return chamadasDeResumo === 1
            ? 'RESUMO_UM: já escreveu os registros 1 e 2 na memória, faltam os demais.'
            : 'RESUMO_DOIS: já escreveu os registros 1 a 4 na memória, falta concluir.';
        }
        return 'NADA'; // reflexão pós-execução e qualquer outra chamada não testada aqui
      };
    })(),
    espera: {
      ok: true,
      ferramentasChamadas: ['escrever_arquivo', 'concluir'],
      eventos: ['compactado'],
      promptDestilacaoContem: ['RESUMO_UM: já escreveu'],
      historicoEnxuto: {
        comNaUltima: ['RESUMO_DOIS'],
        semNaUltima: ['RESUMO_UM: já escreveu'],
      },
    },
  },

  /* ------------------------------ resumo de conversa (cross-turno) ------------------------------ */
  //
  // Pedido do Davi 2026-09-21, mesma conversa do Item 1 acima: prompts.sistema()
  // só mostra os últimos 6 turnos (`conversa.slice(-6)`) — qualquer turno mais
  // antigo simplesmente não existe mais pro modelo, sem aviso nenhum, numa
  // conversa longa (o próprio Davi comparou isso à minha compactação visível
  // neste chat). A correção funde os turnos que saem dessa janela num resumo
  // acumulado (`resumoConversa`, calculado em run() e persistido por fora, em
  // electron/main.js + Conversas.atualizarResumo — ver avaliacao/casos/
  // conversas.js) — mesmo padrão de fusão do Item 1 (nunca concatena por
  // fora do modelo), aplicado à conversa inteira em vez de a uma execução só.
  //
  // Estes três casos usam `tipo: 'unidade'` (Agent + servidorFalso manuais,
  // mesmo padrão já usado em melhorias.js pra "memória curta") porque
  // precisam passar `idConversa` e o 4º parâmetro de `run()` — o formato
  // declarativo (`executarCasoAgente`) só chama `agente.run(pedido, conversa)`,
  // sem essas duas pontas.

  {
    nome: 'resumo de conversa: turnos que saem da janela dos últimos 6 são fundidos e o resumo chega ao prompt de sistema',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'confirmação do pedido' } }],
        redacao: 'Resposta final de teste.',
        destilacao: (prompt) =>
          /Resuma as trocas abaixo/.test(prompt)
            ? 'RESUMO_CONVERSA_UM: usuário mencionou o arquivo relatorio.pdf e pediu um resumo dele.'
            : 'NADA',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-resumo-conversa-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const resumosEmitidos = [];
      agente.on('resumo-conversa', (d) => resumosEmitidos.push(d));

      try {
        // 9 turnos prévios: janela mostra os últimos 6, os 3 mais antigos
        // (turnos 1-3) precisam ser fundidos.
        await agente.run('E sobre a parte financeira, o que você achou?', turnosDeConversa(9), 'conv-fold-teste', {
          resumoConversa: '',
          resumoConversaTurnos: 0,
        });
      } finally {
        await falso.fechar?.();
      }

      const destilacaoTexto = falso.registro.destilacao.join('\n');
      const decisaoTexto = falso.registro.decisao.join('\n');

      return [
        /Resuma as trocas abaixo/.test(destilacaoTexto) ||
          'esperava uma chamada de fusão de conversa (prompts.pedidoDeResumoDeConversa), nenhuma aconteceu',
        resumosEmitidos.length === 1 ||
          `esperava exatamente 1 evento 'resumo-conversa', obteve ${resumosEmitidos.length}`,
        (resumosEmitidos[0] && resumosEmitidos[0].idConversa === 'conv-fold-teste') ||
          `esperava idConversa "conv-fold-teste" no evento, obteve ${JSON.stringify(resumosEmitidos[0])}`,
        (resumosEmitidos[0] && resumosEmitidos[0].turnos === 3) ||
          `esperava 3 turnos fundidos (9 turnos - janela de 6), obteve ${JSON.stringify(resumosEmitidos[0]?.turnos)}`,
        /RESUMO_CONVERSA_UM/.test(resumosEmitidos[0]?.resumo || '') ||
          'o resumo emitido deveria conter o texto que o modelo (falso) devolveu',
        /RESUMO_CONVERSA_UM/.test(decisaoTexto) ||
          'o resumo fundido deveria aparecer no prompt de sistema visto pelo modelo (bloco "RESUMO DO COMEÇO DESTA CONVERSA")',
      ];
    },
  },

  {
    nome: 'resumo de conversa: conversa curta (dentro da janela de 6) não gasta chamada nenhuma de fusão',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'confirmação do pedido' } }],
        redacao: 'Resposta final de teste.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-resumo-conversa-curta-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const resumosEmitidos = [];
      agente.on('resumo-conversa', (d) => resumosEmitidos.push(d));

      try {
        // 4 turnos: nunca ultrapassa a janela de 6 — nenhum turno "sai" dela.
        await agente.run('Continuando o que falamos', turnosDeConversa(4), 'conv-curta-teste');
      } finally {
        await falso.fechar?.();
      }

      const destilacaoTexto = falso.registro.destilacao.join('\n');

      return [
        !/Resuma as trocas abaixo/.test(destilacaoTexto) ||
          'conversa dentro da janela de 6 turnos não deveria disparar nenhuma chamada de fusão',
        resumosEmitidos.length === 0 ||
          `não deveria ter emitido 'resumo-conversa' com a conversa toda dentro da janela, obteve ${JSON.stringify(resumosEmitidos)}`,
      ];
    },
  },

  {
    nome: 'resumo de conversa: um resumo já existente entra na fusão (nunca é substituído às cegas) — só os turnos NOVOS que saíram da janela são fundidos',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'confirmação do pedido' } }],
        redacao: 'Resposta final de teste.',
        destilacao: (prompt) =>
          /Resuma as trocas abaixo/.test(prompt)
            ? 'RESUMO_CONVERSA_DOIS: usuário também perguntou sobre o prazo de entrega.'
            : 'NADA',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-resumo-conversa-fusao-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const resumosEmitidos = [];
      agente.on('resumo-conversa', (d) => resumosEmitidos.push(d));

      try {
        // 10 turnos, mas os 3 primeiros já tinham sido fundidos antes (
        // resumoConversaTurnos: 3, vindo de uma execução anterior desta mesma
        // conversa) — só o turno 4 (o único que saiu da janela DESDE então)
        // deveria entrar na fusão nova, junto com o resumo já existente.
        await agente.run('Mais uma pergunta de acompanhamento', turnosDeConversa(10), 'conv-fusao-teste', {
          resumoConversa: 'RESUMO_CONVERSA_ANTERIOR_EXISTENTE: usuário perguntou sobre o assunto X.',
          resumoConversaTurnos: 3,
        });
      } finally {
        await falso.fechar?.();
      }

      const destilacaoTexto = falso.registro.destilacao.join('\n');

      return [
        /RESUMO_CONVERSA_ANTERIOR_EXISTENTE/.test(destilacaoTexto) ||
          'o resumo já existente tinha que entrar no pedido de fusão, não ser substituído às cegas',
        resumosEmitidos.length === 1 ||
          `esperava exatamente 1 evento 'resumo-conversa', obteve ${resumosEmitidos.length}`,
        (resumosEmitidos[0] && resumosEmitidos[0].turnos === 4) ||
          `esperava 4 turnos fundidos no total (10 turnos - janela de 6), obteve ${JSON.stringify(resumosEmitidos[0]?.turnos)}`,
      ];
    },
  },

  /* ------------------------------ persistência de Tarefa por conversa ------------------------------ */
  //
  // Análise comparativa 2026-09-21, item 1 ("persistir Tarefa por conversa",
  // inspirado no research_plan.md do web-ui/deep_research_agent.py):
  // electron/main.js grava tarefa.serializar() no JSON da conversa a cada
  // evento 'tarefa-atualizada' (ver Conversas.atualizarTarefa) e, se a
  // execução anterior desta mesma conversa ficou incompleta, repassa esse
  // registro como `tarefaAnterior` pro próximo agent:start. Este caso cobre
  // só o lado de dentro do loop.js: que `run()` de fato semeia o checklist
  // retomado (via Tarefa.retomarDe(), já testado isoladamente em
  // avaliacao/casos/tarefa.js) logo no início da execução, ANTES de
  // qualquer passo do roteiro rodar.

  {
    nome: 'persistência de Tarefa por conversa: tarefaAnterior com subtarefa pendente é retomada já no 1º evento de tarefa',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'confirmação do pedido' } }],
        redacao: 'Resposta final de teste.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-tarefa-anterior-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const eventosTarefa = [];
      agente.on('tarefa-atualizada', (d) => eventosTarefa.push(d));

      const tarefaAnterior = {
        estado: 'executando',
        subtarefas: [
          { id: 'tarefa-1', chave: 'ler pagina 1', texto: 'Ler página 1', status: 'feito' },
          { id: 'tarefa-2', chave: 'ler pagina 2', texto: 'Ler página 2', status: 'pendente' },
        ],
      };

      try {
        await agente.run('Continue investigando as páginas que faltam', [], 'conv-retomada-teste', { tarefaAnterior });
      } finally {
        await falso.fechar?.();
      }

      const primeiro = eventosTarefa[0];

      return [
        eventosTarefa.length > 0 || 'esperava pelo menos 1 evento tarefa-atualizada durante a execução',
        (primeiro && primeiro.subtarefas.some((s) => s.texto === 'Ler página 2' && s.status === 'pendente')) ||
          `esperava o item pendente da execução anterior já retomado no 1º evento, obteve ${JSON.stringify(primeiro?.subtarefas)}`,
        (primeiro && primeiro.subtarefas.some((s) => s.texto === 'Ler página 1' && s.status === 'feito')) ||
          'esperava o item já feito na execução anterior retomado com o status preservado (não reabrir trabalho concluído)',
      ];
    },
  },

  {
    nome: 'persistência de Tarefa por conversa: tarefaAnterior CONCLUÍDA (sem pendente) não injeta checklist velho num pedido novo',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'confirmação do pedido' } }],
        redacao: 'Resposta final de teste.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-tarefa-anterior-concluida-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const eventosTarefa = [];
      agente.on('tarefa-atualizada', (d) => eventosTarefa.push(d));

      const tarefaAnteriorConcluida = {
        estado: 'concluida',
        subtarefas: [{ id: 'tarefa-1', chave: 'ler pagina 1', texto: 'Ler página 1', status: 'feito' }],
      };

      try {
        await agente.run('Uma pergunta nova, sem relação com a tarefa anterior', [], 'conv-nova-teste', {
          tarefaAnterior: tarefaAnteriorConcluida,
        });
      } finally {
        await falso.fechar?.();
      }

      const primeiro = eventosTarefa[0];

      return [
        !(primeiro?.subtarefas || []).some((s) => s.texto === 'Ler página 1') ||
          'uma tarefa anterior sem nenhum item pendente não deveria vazar checklist velho pro pedido novo',
      ];
    },
  },

  /* ------------------------------ item 2: comando manual de compactação + indicador de contexto ------------------------------ */
  //
  // Análise comparativa 2026-09-21, item 2 (inspirado no /compact + medidor
  // de % do deer-flow): fundirResumoConversa() foi extraído de dentro de
  // run() pra poder ser chamado SOB DEMANDA, fora de qualquer execução (ver
  // electron/main.js, IPC 'chats:compact') — este caso prova que funciona
  // isolado e que é idempotente (2ª chamada sem turno novo não gasta
  // destilação). 'janela-contexto' é o evento novo do indicador — este outro
  // caso prova que o percentual emitido bate com promptTokens/numCtx reais.

  {
    nome: 'fundirResumoConversa(): chamado fora de run() funde os turnos antigos, e é idempotente (2ª chamada sem turno novo não gasta destilação)',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        destilacao: (prompt) =>
          /Resuma as trocas abaixo/.test(prompt)
            ? 'RESUMO_MANUAL: usuário perguntou sobre o assunto Y.'
            : 'NADA',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-compactar-manual-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const resumosEmitidos = [];
      agente.on('resumo-conversa', (d) => resumosEmitidos.push(d));

      // Chamado DIRETO, sem agente.run() nenhum — é exatamente o que
      // electron/main.js faz no IPC 'chats:compact' (criarAgente() sem
      // .run()). this.controller não existe aqui (nenhuma execução em
      // andamento) — prova que o `?.signal` cobre esse caso.
      const primeira = await agente.fundirResumoConversa(turnosDeConversa(9), 'conv-compactar-manual', {
        resumoConversa: '',
        resumoConversaTurnos: 0,
      });
      const chamadasApósPrimeira = falso.registro.destilacao.length;
      const segunda = await agente.fundirResumoConversa(turnosDeConversa(9), 'conv-compactar-manual', primeira);

      await falso.fechar?.();

      return [
        /RESUMO_MANUAL/.test(primeira.resumoConversa) ||
          `esperava o resumo fundido fora de run(), obteve ${JSON.stringify(primeira.resumoConversa)}`,
        primeira.resumoConversaTurnos === 3 || `esperava 3 turnos fundidos (9 - janela de 6), obteve ${primeira.resumoConversaTurnos}`,
        resumosEmitidos.length === 1 || `esperava 1 evento 'resumo-conversa' fora de run(), obteve ${resumosEmitidos.length}`,
        chamadasApósPrimeira > 0 || 'a 1ª chamada precisa ter gasto pelo menos 1 chamada de destilação',
        falso.registro.destilacao.length === chamadasApósPrimeira ||
          '2ª chamada sem turno novo desde a 1ª fusão não deveria gastar NENHUMA chamada de destilação a mais (idempotente)',
        segunda.resumoConversa === primeira.resumoConversa && segunda.resumoConversaTurnos === primeira.resumoConversaTurnos ||
          '2ª chamada idempotente deveria devolver exatamente os mesmos valores recebidos',
      ];
    },
  },

  {
    nome: "evento 'janela-contexto': percentual emitido a cada decisão bate com promptTokens/numCtx reais (não é o acumulado de 'uso')",
    tipo: 'unidade',
    async executar() {
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'responder', argumentos: { foco: 'confirmação do pedido' } },
        ],
        redacao: 'Resposta final de teste.',
      });

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-janela-contexto-'));
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
        },
        userDataPath: workspace,
        skills,
      });

      const eventosJanela = [];
      agente.on('janela-contexto', (d) => eventosJanela.push(d));

      try {
        await agente.run('Confirme que entendeu o pedido.', []);
      } finally {
        await falso.fechar?.();
      }

      const todosCoerentes = eventosJanela.every(
        (e) => e.numCtx === 8192 && e.promptTokens > 0 && e.percentual === Math.round((e.promptTokens / e.numCtx) * 100)
      );

      return [
        eventosJanela.length > 0 || "esperava pelo menos 1 evento 'janela-contexto' (uma decisão pelo menos rodou)",
        todosCoerentes ||
          `percentual precisa ser sempre Math.round(promptTokens/numCtx*100) com numCtx=8192, obteve ${JSON.stringify(eventosJanela)}`,
      ];
    },
  },

  /* ------------------------------ item 3: allowed-tools por skill ------------------------------ */
  //
  // Análise comparativa 2026-09-21, item 3 (inspirado no campo `allowed-tools`
  // do formato de skill do deer-flow/Claude): ferramentasDesativadasParaSkills()
  // é pura e síncrona — testada direto, sem precisar de agente.run() nem de
  // servidor falso (mesmo espírito do teste direto de fundirResumoConversa()
  // acima). skill "de mentira" aqui é só o objeto simples que Skills.selecionar
  // devolveria — o método não lê nada além de `.sempre`/`.ferramentasPermitidas`.

  {
    nome: 'ferramentasDesativadasParaSkills(): nenhuma skill ativa declarando ferramentas_permitidas fica aberto (comportamento de hoje, sem regressão)',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({ config: { ferramentasDesativadas: ['executar_comando'] } });
      const semRestricao = [{ nome: 'skill-livre', sempre: false, ferramentasPermitidas: [] }];
      const resultado = agente.ferramentasDesativadasParaSkills(semRestricao);
      return [
        (resultado.length === 1 && resultado[0] === 'executar_comando') ||
          `esperava só a lista manual (['executar_comando']) sem nenhuma skill restringindo, obteve ${JSON.stringify(resultado)}`,
      ];
    },
  },

  {
    nome: 'ferramentasDesativadasParaSkills(): unanimidade — TODAS as skills ativas (exceto sempre:true) restringindo, bloqueia o resto do catálogo mas nunca ESSENCIAIS',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({ config: { ferramentasDesativadas: [] } });
      const restringindo = [
        { nome: 'skill-leitura', sempre: false, ferramentasPermitidas: ['ler_arquivo', 'listar_arquivos'] },
      ];
      const bloqueadas = agente.ferramentasDesativadasParaSkills(restringindo);
      return [
        bloqueadas.includes('executar_comando') || 'esperava "executar_comando" bloqueada (fora da lista permitida pela skill)',
        bloqueadas.includes('buscar_web') || 'esperava "buscar_web" bloqueada (fora da lista permitida pela skill)',
        !bloqueadas.includes('ler_arquivo') && !bloqueadas.includes('listar_arquivos') ||
          'as ferramentas que a skill permitiu não deveriam estar na lista de bloqueadas',
        !bloqueadas.includes('responder') && !bloqueadas.includes('concluir') ||
          'ESSENCIAIS (responder/concluir) nunca podem ser bloqueadas, mesmo fora da lista permitida — sem elas o laço não fecha',
      ];
    },
  },

  {
    nome: 'ferramentasDesativadasParaSkills(): uma única skill ativa sem restrição, na mistura, já basta pra deixar tudo aberto (unanimidade real, não maioria)',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({ config: { ferramentasDesativadas: [] } });
      const mistura = [
        { nome: 'skill-restrita', sempre: false, ferramentasPermitidas: ['ler_arquivo'] },
        { nome: 'skill-geral-sem-restricao', sempre: false, ferramentasPermitidas: [] },
      ];
      const resultado = agente.ferramentasDesativadasParaSkills(mistura);
      return [
        resultado.length === 0 ||
          `uma skill ativa sem ferramentas_permitidas na mistura deveria deixar tudo aberto (fail-open), obteve ${JSON.stringify(resultado)}`,
      ];
    },
  },

  {
    nome: 'ferramentasDesativadasParaSkills(): skill sempre:true (ex. "Pesquisa na web") fica FORA da exigência de unanimidade — não invalida a restrição de outra skill',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({ config: { ferramentasDesativadas: [] } });
      const comSempre = [
        { nome: 'Pesquisa na web', sempre: true, ferramentasPermitidas: [] }, // nunca declarou restrição — não devia contar
        { nome: 'skill-restrita', sempre: false, ferramentasPermitidas: ['ler_arquivo'] },
      ];
      const bloqueadas = agente.ferramentasDesativadasParaSkills(comSempre);
      return [
        bloqueadas.includes('executar_comando') ||
          'esperava restrição ativa (a skill sempre:true sem ferramentas_permitidas não deveria contar pra unanimidade)',
        !bloqueadas.includes('ler_arquivo') || 'a ferramenta que a skill restrita permitiu não deveria estar bloqueada',
      ];
    },
  },

  {
    nome: 'ferramentasDesativadasParaSkills(): nenhuma skill ativa (checklist concluído) não quebra — devolve só a lista manual',
    tipo: 'unidade',
    async executar() {
      const agente = new Agent({ config: { ferramentasDesativadas: ['executar_comando'] } });
      const resultado = agente.ferramentasDesativadasParaSkills([]);
      return [
        (resultado.length === 1 && resultado[0] === 'executar_comando') ||
          `sem nenhuma skill ativa, esperava só a lista manual, obteve ${JSON.stringify(resultado)}`,
      ];
    },
  },

  /* ------------------------------ item 5: sub-tarefa despachada com contexto descartável ------------------------------ */
  //
  // Análise comparativa 2026-09-21/22, item 5 (o mais caro da lista — "mecanismo
  // novo de verdade", inspirado no isolamento de contexto de deer-flow/
  // hermes-agent, mas sequencial): a ferramenta nova `investigar_subtarefa`
  // despacha várias buscas relacionadas (pesquisar_e_ler, reaproveitada 100%)
  // numa ÚNICA chamada de decisão do modelo principal — as chamadas internas
  // não passam pelo corpo do laço principal (só por executarPasso direto), então
  // não geram entrada de historico própria; só o resultado CONSOLIDADO de
  // `despacharSubtarefa()` (Agent, loop.js) entra no historico, exatamente como
  // o de qualquer outra ferramenta. Este caso prova as duas metades da alegação:
  // (a) as 2 consultas realmente rodaram (2 chamadas reais de pesquisar_e_ler,
  // buscando de verdade no servidor local de teste) e (b) nenhuma delas aparece
  // separada no prompt da PRÓXIMA decisão — só o bloco consolidado.

  {
    nome: 'investigar_subtarefa (item 5): várias buscas relacionadas cabem numa ÚNICA decisão — o passo a passo interno não vaza pro histórico da decisão principal, só o resultado consolidado',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeBusca(
        paginaCom('Dado de teste ORCA-771 encontrado na página, com contexto suficiente para passar da destilação.')
      );
      try {
        const obtido = await executarCasoAgente({
          nome: 'investigar_subtarefa: duas consultas numa só chamada',
          pedido: 'Compare o produto A com o produto B e diga qual é melhor',
          config: {
            searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
            permitirLeitorExterno: false,
            subconsultas: false,
          },
          roteiro: [
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: {
                objetivo: 'comparar as especificações do produto A e do produto B',
                consultas: ['especificações do produto A', 'especificações do produto B'],
              },
            },
            { ferramenta: 'responder', argumentos: { foco: 'a comparação' } },
          ],
          redacao: 'O produto A supera o produto B no teste.',
        });

        const buscasInternas = obtido.ferramentasChamadas.filter((f) => f === 'pesquisar_e_ler').length;
        const falhasPadrao = comparar(
          {
            ok: true,
            ferramentasChamadas: ['investigar_subtarefa', 'responder'],
            // prova (b): o resultado consolidado (texto literal devolvido por
            // despacharSubtarefa) chega à PRÓXIMA decisão...
            promptDecisaoContem: ['Resultado da sub-tarefa'],
            // ...mas o padrão que o laço principal usaria se cada
            // pesquisar_e_ler tivesse passado pelo corpo do laço normalmente
            // (ver "RESULTADO DE ${nome}:", loop.js) não aparece — prova que as
            // 2 chamadas internas realmente não passaram por ali.
            promptDecisaoNaoContem: ['RESULTADO DE pesquisar_e_ler'],
          },
          obtido
        );
        return [
          ...falhasPadrao,
          // prova (a): as 2 consultas rodaram de verdade, não só 1 (ex.: um
          // bug que ignorasse a 2ª consulta da lista passaria pela prova (b)
          // sozinha, mas não por esta)
          buscasInternas === 2 ||
            `esperava 2 chamadas internas de pesquisar_e_ler (uma por consulta), houve ${buscasInternas}`,
        ];
      } finally {
        await conteudo.fechar();
      }
    },
  },

  {
    // Contraprova do teto: TETO_CONSULTAS_SUBTAREFA corta em 4, mesmo se o
    // modelo pedir mais — e as chamadas internas respeitam um teto. Desde as
    // correções rápidas do motor de pesquisa (2026-09-24) esse teto é um
    // orçamento PRÓPRIO das subtarefas, do mesmo tamanho de tetoDeBuscas (ver
    // `buscasEmSubtarefas` em despacharSubtarefa, loop.js, e o caso
    // "orçamento próprio" em pesquisa-correcoes.js) — continua não sendo um
    // jeito de buscar sem limite.
    nome: 'investigar_subtarefa (item 5): respeita o teto de buscas DA EXECUÇÃO, mesmo pedindo mais consultas do que o limite restante',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeBusca(paginaCom('Conteúdo de teste com número 55 para passar da destilação.'));
      try {
        const obtido = await executarCasoAgente({
          nome: 'investigar_subtarefa: teto de buscas da execução',
          pedido: 'Pesquise vários aspectos de um tema amplo',
          config: {
            searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
            permitirLeitorExterno: false,
            subconsultas: false,
            maxBuscas: 1, // só 1 busca permitida na execução inteira
          },
          roteiro: [
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: {
                objetivo: 'investigar 3 aspectos do tema',
                consultas: ['aspecto um', 'aspecto dois', 'aspecto três'],
              },
            },
            { ferramenta: 'responder', argumentos: { foco: 'o que foi encontrado' } },
          ],
          redacao: 'Resumo do que foi encontrado.',
        });

        const buscasInternas = obtido.ferramentasChamadas.filter((f) => f === 'pesquisar_e_ler').length;
        return [
          obtido.ok || `esperava execução ok, obteve erro: ${JSON.stringify(obtido.erros)}`,
          buscasInternas === 1 ||
            `esperava só 1 chamada interna (maxBuscas: 1 pra execução inteira), houve ${buscasInternas}`,
        ];
      } finally {
        await conteudo.fechar();
      }
    },
  },

  {
    // Achado revisando uma execução real (Davi, 2026-09-22/23, "melhor fone
    // pra PUBG" — 2ª rodada, já com os Itens 1-3 da rodada anterior em
    // produção): o gate de "ação repetida" (loop.js, perto de `assinaturas`)
    // calcula a chave de dedup só com `argumentos.consulta || .url || .caminho
    // || .motivo` — nenhum desses é o formato de `investigar_subtarefa`
    // (`objetivo` + `consultas`), então toda chamada dela caía na mesma chave
    // vazia "investigar_subtarefa|" e a 3ª chamada da execução era barrada
    // como "repetida", mesmo investigando um sub-tema totalmente diferente
    // das 2 anteriores. Na execução real isso bloqueou 3 chamadas seguidas.
    // Este caso chama a ferramenta 3x com `objetivo` DIFERENTE a cada vez —
    // sem a correção (incluir `objetivos` na cadeia de fallback da chave), a
    // 3ª chamada não aparece em `ferramentasChamadas` e o gate 'acao-repetida'
    // dispara em `obtido.copiloto`.
    nome: 'investigar_subtarefa: 3 chamadas com objetivo DIFERENTE não são barradas como "ação repetida" (caso real: "melhor fone pra PUBG" 2ª rodada)',
    tipo: 'unidade',
    async executar() {
      const conteudo = await servidorDeBusca(
        paginaCom('Dado de teste ORCA-991 encontrado na página, com contexto suficiente para passar da destilação.')
      );
      try {
        const obtido = await executarCasoAgente({
          nome: 'investigar_subtarefa: 3 sub-investigações de temas diferentes na mesma execução',
          pedido: 'Levante um panorama amplo sobre um tema com várias frentes distintas',
          config: {
            searxngUrl: `http://127.0.0.1:${conteudo.porta}`,
            permitirLeitorExterno: false,
            subconsultas: false,
          },
          roteiro: [
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: { objetivo: 'levantar características técnicas do tema', consultas: ['ângulo técnico'] },
            },
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: { objetivo: 'levantar a relação do tema com o uso prático', consultas: ['ângulo de uso'] },
            },
            {
              ferramenta: 'investigar_subtarefa',
              argumentos: { objetivo: 'levantar a opinião da comunidade sobre o tema', consultas: ['ângulo de opinião'] },
            },
            { ferramenta: 'responder', argumentos: { foco: 'o panorama' } },
          ],
          redacao: 'Panorama consolidado sobre o tema.',
        });

        const chamadasInvestigar = obtido.ferramentasChamadas.filter((f) => f === 'investigar_subtarefa').length;
        return [
          obtido.ok || `esperava execução ok, obteve erro: ${JSON.stringify(obtido.erros)}`,
          chamadasInvestigar === 3 ||
            `esperava as 3 chamadas de investigar_subtarefa passarem (objetivo diferente cada), só ${chamadasInvestigar} passaram`,
          !obtido.copiloto.some((c) => c.gate === 'acao-repetida') ||
            `gate 'acao-repetida' disparou sem repetição real de verdade (chave de dedup ainda ignorando 'objetivo')`,
        ];
      } finally {
        await conteudo.fechar();
      }
    },
  },

  /* ------------------------------ item 6: ativação manual de skill por /nome ------------------------------ */
  //
  // Análise comparativa 2026-09-21/22, item 6 (inspirado no /nome-da-skill do
  // deer-flow): "/skill resto do pedido" força a seleção da skill nomeada,
  // ignorando gatilho/embedding — Skills.porNome()/selecionar({forcarId}) já
  // testados isolados em avaliacao/casos/skills.js; estes casos provam a
  // integração ponta a ponta com Agent.run() (parsing, remoção do prefixo do
  // objetivo, e a skill de fato chegando ativa na decisão).

  {
    nome: '/nome (item 6): "/previsao-do-tempo" força a skill mesmo com um pedido que não tem nada a ver com clima, e tira o "/nome" do objetivo antes de qualquer outra coisa usá-lo',
    pedido: '/previsao-do-tempo resuma a história do Brasil em 3 frases',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o resumo' } }],
    redacao: 'Resumo da história do Brasil em 3 frases.',
    espera: {
      ok: true,
      skillsAtivadas: ['Previsão do tempo'],
      // o "/previsao-do-tempo" não deveria sobreviver em lugar nenhum do
      // prompt de decisão — só o resto do pedido, já sem o prefixo
      promptDecisaoNaoContem: ['/previsao-do-tempo'],
      promptDecisaoContem: ['história do Brasil'],
    },
  },

  {
    // Contraprova: o MESMO texto, sem a barra, não deveria ativar "Previsão
    // do tempo" — prova que o caso acima é o mecanismo /nome funcionando, não
    // uma coincidência de gatilho/fallback semântico pegando "história do
    // Brasil" por acaso.
    nome: '/nome (item 6): contraprova — o mesmo pedido SEM a barra não ativa "Previsão do tempo" (prova que o caso acima é o /nome, não coincidência)',
    pedido: 'resuma a história do Brasil em 3 frases',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o resumo' } }],
    redacao: 'Resumo da história do Brasil em 3 frases.',
    espera: { ok: true, skillsNaoAtivadas: ['Previsão do tempo'] },
  },

  {
    // Prefixo único ("previsao" só bate com "previsao-do-tempo" no catálogo,
    // ver teste de porNome() em skills.js) também funciona ponta a ponta, não
    // só o nome/pasta completo.
    nome: '/nome (item 6): prefixo único ("/previsao") também força a skill, não precisa do nome completo',
    pedido: '/previsao resuma a história do Brasil em 3 frases',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o resumo' } }],
    redacao: 'Resumo da história do Brasil em 3 frases.',
    espera: { ok: true, skillsAtivadas: ['Previsão do tempo'] },
  },

  {
    // "/algo" que não bate com skill nenhuma: degrada com segurança — não
    // quebra a execução, e o objetivo segue INTACTO (com a barra e tudo),
    // porque pode genuinamente ser o pedido do usuário começando com "/" por
    // acaso, não necessariamente uma tentativa de nomear uma skill.
    nome: '/nome (item 6): "/algo" que não bate com skill nenhuma não quebra a execução — o objetivo segue intacto, seleção automática decide normalmente',
    pedido: '/esta-skill-nao-existe some help please',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a resposta' } }],
    redacao: 'Resposta de teste.',
    espera: {
      ok: true,
      // objetivo não foi tocado — o texto cru (com a barra) chega à decisão
      promptDecisaoContem: ['/esta-skill-nao-existe some help please'],
    },
  },

  /* ------------------------------ chunking de documento grande ------------------------------ */
  //
  // Pedido do Davi 2026-09-21 ("mandar vários PDFs gigantes pro AuGPT
  // analisar"): _destilarUm cortava o texto em 20000 caracteres e destilar()
  // (destilador.js) cortava DE NOVO por dentro em MAXIMO_ENVIADO (14000) —
  // um documento de 100 páginas via ler_documento/ler_arquivo só tinha as
  // primeiras ~10-15 páginas realmente analisadas, o resto descartado em
  // silêncio. _destilarGrande() divide o texto em pedaços de até
  // MAXIMO_ENVIADO (emPedacos), cada um destilado separadamente, até o teto
  // de TETO_DE_CHUNKS — e avisa quando o teto corta conteúdo de verdade.

  {
    nome: 'chunking de documento grande: conteúdo além do corte antigo (14-20 mil caracteres) chega à destilação, dividido em pedaços',
    pedido: 'Resuma o relatorio-grande.txt, com atenção a cláusulas incomuns.',
    arquivos: {
      // 200 parágrafos, marcador no parágrafo 130 (~21-22 mil caracteres —
      // bem além dos 14000/20000 que _destilarUm/destilar() cortavam antes
      // desta peça), dentro do 2º de 3 pedaços de 14000 caracteres.
      'relatorio-grande.txt': documentoGrande(
        200,
        130,
        'Parágrafo 130: CLÁUSULA-RARA-9987 encontrada — prazo de garantia estendido para 47 meses, válido só para pedidos internacionais.'
      ),
    },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio-grande.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'as cláusulas incomuns do relatório' } },
    ],
    config: { destilarFatos: true, destilarAcimaDe: 500 },
    espera: {
      ok: true,
      // ler_arquivo não popula fontesLidas — 1 chamada por PEDAÇO do texto
      // (3 pedaços de ~14000 caracteres pros ~33 mil do documento gerado),
      // não 1 chamada só truncada como antes desta peça.
      chamadasDeDestilacao: 3,
      // prova o ponto central: o material que chega à destilação inclui
      // texto que, antes desta peça, nunca passava do corte de 14-20 mil.
      promptDestilacaoContem: ['CLÁUSULA-RARA-9987 encontrada'],
    },
  },

  {
    nome: 'chunking de documento grande: teto de pedaços (TETO_DE_CHUNKS) é respeitado e avisa quando ainda sobra conteúdo descartado',
    pedido: 'Resuma o relatorio-enorme.txt.',
    arquivos: {
      // 500 parágrafos (~83 mil caracteres, truncados pra 60000 pelo MAX_READ
      // de ler_arquivo) — bem mais que os 3 pedaços de 14000 que o teto
      // "normal" (TETO_DE_CHUNKS.normal) permite: o excedente tem que ser
      // descartado com AVISO, não em silêncio.
      'relatorio-enorme.txt': documentoGrande(500, -1, ''),
    },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio-enorme.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o conteúdo do relatório' } },
    ],
    config: { destilarFatos: true, destilarAcimaDe: 500 },
    espera: {
      ok: true,
      // parado no teto (TETO_DE_CHUNKS.normal = 3), não numa chamada por
      // pedaço até o fim do documento (que teria mais de 3)
      chamadasDeDestilacao: 3,
      eventos: ['aviso'],
    },
  },
  {
    nome: 'item de síntese (registros reais de 11/10) conta como entrega e não barra responder: "Resumir a informação…", "Concluir que…", "Gerar um resumo comparativo…"; pesquisar, ler e comparar preços continuam sendo trabalho',
    tipo: 'unidade',
    async executar() {
      const { ehItemDeEntregaFinal } = require('../../src/agent/loop');
      const sim = ['Resumir a informação sobre os modos de latência baixa', 'Concluir que o modo Ultra é mais recomendado para PUBG', 'Gerar um resumo comparativo das informações coletadas', 'Responder sobre as percepções auditivas dos dois fones'];
      const nao = ['Pesquisar sobre o modo Ultra da NVIDIA em jogos', 'Ler relatórios oficiais da NVIDIA sobre o modo Ultra', 'Comparar preços e características com outros modelos em marketplaces', 'Calcular a média dos preços observados'];
      return [
        ...sim.map((t) => ehItemDeEntregaFinal(t) || `síntese deveria contar como entrega: ${t}`),
        ...nao.map((t) => !ehItemDeEntregaFinal(t) || `trabalho de verdade não é entrega: ${t}`),
      ];
    },
  },
];
