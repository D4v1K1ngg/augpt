'use strict';

/**
 * Dois ajustes que entraram depois dos 5 itens do plano original, a partir de
 * uma auditoria externa (Gemini Pro) que Davi trouxe pra discutir:
 *
 * 1. Reescrita do objetivo, fundida na MESMA chamada de `verificarAmbiguidade`
 *    (item 4) — resolve referência tipo "faz de novo aquilo"/"o outro
 *    arquivo" contra a conversa recente, ANTES de qualquer coisa (seleção de
 *    skill, prompt de sistema, busca de rotina) usar o objetivo cru. Zero
 *    chamada a mais: é a mesma chamada de sempre, só pedindo as duas coisas.
 *
 * 2. Barreira de busca interna — na 1ª iteração, se a memória desta pasta já
 *    tiver algo relevante pro pedido, um aviso entra no prompt de decisão
 *    pedindo pra considerar isso antes de pesquisar na web. Não bloqueia
 *    nada, só nudge — reaproveita a mesma busca de memória que já rodava.
 */
module.exports = [
  /* ------------------------- reescrita do objetivo ------------------------- */

  {
    // Precisa de `conversa` não-vazia: a reescrita só é aplicada quando há
    // conversa anterior pra resolver (ver o comentário em loop.js/run()) —
    // sem isso, "faz de novo" não teria antecedente nenhum de qualquer
    // forma, então o cenário realista sempre tem uma conversa aqui.
    nome: 'reescrita do objetivo: pedido vago é substituído pela versão reescrita no resto da execução',
    pedido: 'faz de novo, mas pro outro arquivo',
    conversa: [
      { role: 'user', content: 'Resuma o arquivo relatorio1.txt' },
      { role: 'assistant', content: 'Aqui está o resumo do relatorio1.txt.' },
    ],
    ambiguidade: 'suficiente\nResumir o arquivo relatorio2.txt',
    arquivos: { 'relatorio2.txt': 'Conteúdo do relatório dois.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio2.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o relatório' } },
    ],
    redacao: 'Resumo do relatório dois.',
    espera: {
      ok: true,
      objetivoReescritoPara: 'Resumir o arquivo relatorio2.txt',
      promptDecisaoContem: ['Resumir o arquivo relatorio2.txt'],
      promptDecisaoNaoContem: ['faz de novo, mas pro outro arquivo'],
    },
  },

  {
    nome: 'reescrita do objetivo: a conversa recente chega no prompt de verificação, pra resolver a referência',
    pedido: 'faz de novo, mas pro outro arquivo',
    conversa: [
      { role: 'user', content: 'Resuma o arquivo relatorio1.txt' },
      { role: 'assistant', content: 'Aqui está o resumo do relatorio1.txt.' },
    ],
    // só reescreve se a conversa (com "relatorio1.txt") realmente chegou no prompt —
    // sem isso o teste passaria mesmo se `conversa` nunca fosse repassado.
    ambiguidade: (promptCru) =>
      /relatorio1\.txt/.test(promptCru) ? 'suficiente\nResumir o arquivo relatorio2.txt' : 'suficiente',
    arquivos: { 'relatorio2.txt': 'Conteúdo dois.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'relatorio2.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o relatório' } },
    ],
    redacao: 'Resumo pronto.',
    espera: { ok: true, objetivoReescritoPara: 'Resumir o arquivo relatorio2.txt' },
  },

  {
    // Caso real de produção (duas vezes, semanas de intervalo): um pedido de
    // 9-10 perguntas de prova (~3600 caracteres), numa conversa NOVA (sem
    // `conversa` nenhuma), era cortado em ~500 caracteres pelo teto do
    // prompt de ambiguidade — o modelo, instruído a "repetir exatamente"
    // quando não bifurca, só conseguia ecoar de volta o trecho truncado que
    // viu, e essa versão SUBSTITUÍA o pedido original pro resto da execução
    // inteira (busca, decomposição de perguntas, redação só viam a Questão 1
    // e um pedaço da 2). Reproduzido aqui com um "servidor falso" que
    // devolve deliberadamente um eco truncado (bem mais curto que o pedido
    // real, cortado no meio) — sem `conversa`, a reescrita nunca deveria ser
    // aplicada, então o pedido completo (incluindo a marca no fim) precisa
    // sobreviver até o prompt de decisão.
    nome: 'reescrita do objetivo: SEM conversa anterior, um eco truncado da verificação de ambiguidade é ignorado (caso real: pedido de prova cortado em ~500 caracteres)',
    pedido:
      'Resolva as seguintes questões: Questão 1: primeira pergunta de teoria bem detalhada e longa. ' +
      'Questão 2: segunda pergunta, também longa. '.repeat(20) +
      'Questão final: MARCA-FIM-DO-PEDIDO, qual a resposta?',
    // simula o que um modelo pequeno faz quando só recebe um PREFIXO do
    // pedido (o teto do prompt de ambiguidade) e é instruído a "repetir
    // exatamente": ele ecoa de volta só o começo, sem a marca do fim.
    ambiguidade: 'suficiente\nResolva as seguintes questões: Questão 1: primeira pergunta de teoria bem detalhada e longa.',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'as questões' } }],
    redacao: 'Resposta.',
    espera: {
      ok: true,
      objetivoNaoReescrito: true,
      promptDecisaoContem: ['MARCA-FIM-DO-PEDIDO'],
    },
  },

  {
    nome: 'reescrita do objetivo: resposta "suficiente" sem reescrita não dispara evento nem muda nada (padrão de todo o resto da bancada)',
    pedido: 'Liste a pasta e responda.',
    // sem `ambiguidade` explícito: usa o padrão do servidor falso, 'suficiente'
    // (sem segunda linha) — o mesmo default que os outros ~200 casos da
    // bancada já usam sem saber, e que continuam passando depois desta mudança.
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'a pasta' } },
    ],
    redacao: 'Pasta listada.',
    espera: { ok: true, objetivoNaoReescrito: true },
  },

  /* ------------------------- barreira de busca interna ------------------------- */

  {
    nome: 'barreira de busca interna: memória relevante nesta pasta gera aviso antes de qualquer decisão',
    pedido: 'Qual a configuração do servidor de produção?',
    arquivos: {
      '.augpt/memory.json': JSON.stringify([
        {
          id: '1',
          texto: 'Configuração do servidor de produção: porta 8080, timeout 30 segundos.',
          tipo: 'passo',
          em: new Date().toISOString(),
        },
      ]),
    },
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a configuração' } }],
    redacao: 'A configuração é porta 8080, timeout 30s.',
    espera: { ok: true, promptDecisaoContem: ['BARREIRA DE MEMÓRIA'] },
  },

  {
    // Caso real (log de 06/09, v0.5.7): um item de memória guardado no
    // formato "Passo N — ferramenta(...) → resultado" (o MESMO formato de um
    // passo atual) foi retomado pelo modelo como se fosse a tarefa em
    // andamento, numa pergunta sem relação nenhuma. A memória injetada agora
    // carrega data e um título deixando explícito que é de uma tarefa
    // PASSADA — este teste confirma que os dois chegam no prompt.
    nome: 'memória relevante injetada no prompt vem datada e rotulada como tarefa passada, não como passo atual',
    pedido: 'Qual a configuração do servidor de produção?',
    arquivos: {
      '.augpt/memory.json': JSON.stringify([
        {
          id: '1',
          // vocabulário compartilhado com o pedido de propósito (servidor,
          // produção, configuração) pra passar no piso de relevância léxica
          // — o que este teste cobre é o FORMATO da injeção, não a busca em si.
          texto: 'Passo 3 — ler_arquivo({"caminho":"servidor.conf"}) → configuração do servidor de produção: porta 8080',
          tipo: 'passo',
          em: '2026-09-06T17:27:28.901Z',
        },
      ]),
    },
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a configuração' } }],
    redacao: 'A configuração é porta 8080, timeout 30s.',
    espera: {
      ok: true,
      promptDecisaoContem: ['MEMÓRIA RELEVANTE (de tarefas PASSADAS', '[06/09/2026]', 'não retome nem repita'],
    },
  },

  {
    nome: 'barreira de busca interna: sem nada relevante em memória, nenhum aviso aparece',
    pedido: 'Qual a capital da Mongólia?',
    arquivos: {
      '.augpt/memory.json': JSON.stringify([
        { id: '1', texto: 'Anotação sobre um assunto completamente diferente.', tipo: 'passo', em: new Date().toISOString() },
      ]),
    },
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a capital' } }],
    redacao: 'A capital da Mongólia é Ulã Bator.',
    espera: { ok: true, promptDecisaoNaoContem: ['BARREIRA DE MEMÓRIA'] },
  },
];
