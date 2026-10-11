'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { Skills } = require('../../src/skills');

const carregar = () =>
  new Skills({
    dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
    dirUsuario: path.join(os.tmpdir(), `augpt-skills-teste-${Date.now()}`),
  });

const nomes = async (s, pedido) =>
  [...new Set(
    (await s.selecionar(pedido, { etapa: 'decisao' }))
      .concat(await s.selecionar(pedido, { etapa: 'redacao' }))
      .map((k) => k.nome)
  )].filter((n) => n !== 'Pesquisa na web');

module.exports = [
  {
    nome: 'skills: cada tipo de pedido ativa a skill certa',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const esperado = [
        ['o que é inflação e como ela funciona', 'Explicação didática'],
        ['quanto é 17% de 3480 dividido por 12', 'Matemática e cálculo'],
        ['faça uma pesquisa profunda sobre energia solar', 'Pesquisa profunda'],
        ['devo migrar meu servidor para a nuvem?', 'Decisão e cenários'],
        ['crie uma função em python que valide CPF', 'Escrever e depurar código'],
        ['meu código dá TypeError undefined', 'Escrever e depurar código'],
        ['gere um pdf com o relatório', 'Gerar PDF, Word e Excel'],
        ['analise o boleto anexado', 'Analisar documento anexado'],
      ];
      const resultados = [];
      for (const [pedido, skill] of esperado) {
        const ativas = await nomes(s, pedido);
        resultados.push(
          ativas.includes(skill) || `"${pedido.slice(0, 32)}" ativou [${ativas.join(', ') || 'nada'}] em vez de ${skill}`
        );
      }
      return resultados.filter((r) => r !== true).concat([true]);
    },
  },

  {
    nome: 'skills: antigatilho tira a skill de cena',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const auto = s.lista.find((k) => k.pasta === 'o-proprio-augpt');
      const texto = s.lista.find((k) => k.pasta === 'texto-longo');

      return [
        auto.naoUsePara.length > 0 || 'a skill de auto-conhecimento não declara antigatilhos',
        s.pontuar(auto, 'gere um pdf com o relatório') === 0 ||
          'auto-conhecimento ainda disputa pedido de geração de PDF',
        s.pontuar(auto, 'o que você consegue fazer?') > 0 || 'antigatilho zerou o uso legítimo da skill',
        s.pontuar(texto, 'escreva um conto de ficção científica') === 0 ||
          'skill de texto técnico ainda pega pedido de história',
        s.pontuar(texto, 'faça um resumo de 40 linhas') > 0 || 'antigatilho quebrou o uso normal',
      ];
    },
  },

  {
    // Caso real (v0.5.7, teste ao vivo): "crie um documento
    // word com um resumo sobre X" ativava "Analisar documento anexado" (via
    // o gatilho solto "documento") ao lado de "Gerar PDF, Word e Excel" — e a
    // instrução "leia antes de qualquer outra coisa" daquela skill fazia o
    // modelo chamar `ler_documento` num arquivo que ainda nem existia (a
    // tarefa era CRIAR, não ler), derrubando o resto da execução. O
    // documento nunca chegava a ser gerado.
    nome: 'skills: pedido pra CRIAR um documento não ativa mais "Analisar documento anexado" (antigatilho novo)',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const analisar = s.lista.find((k) => k.pasta === 'analisar-documento');
      const gerar = s.lista.find((k) => k.pasta === 'gerar-documentos');
      return [
        s.pontuar(analisar, 'Crie um documento word com um resumo curto sobre energia solar residencial.') === 0 ||
          '"Analisar documento anexado" ainda ativa em pedido de criação',
        s.pontuar(gerar, 'Crie um documento word com um resumo curto sobre energia solar residencial.') > 0 ||
          '"Gerar PDF, Word e Excel" não ativou pro mesmo pedido',
        // continua funcionando pro uso legítimo (analisar arquivo que já existe)
        s.pontuar(analisar, 'analise o documento anexado e me diga o valor total') > 0 ||
          'perdeu o uso legítimo (analisar documento anexado de verdade)',
        s.pontuar(analisar, 'resuma o contrato que anexei') > 0 || 'perdeu o uso legítimo (resumir contrato anexado)',
      ];
    },
  },

  {
    // Caso real (v0.5.7, mesmo teste ao vivo): mesmo quando o roteamento pra
    // "Gerar PDF, Word e Excel" batia, o CORPO da skill mandava usar
    // `executar_codigo` em Python (python-docx/openpyxl/reportlab) — que não
    // está mais no catálogo de ferramentas desde que a geração virou nativa
    // (`src/tools/gerar.js`). O modelo nunca chamava `gerar_docx` de
    // verdade: tentava ler um arquivo inexistente, pesquisava na web, e no
    // fim só respondia em texto puro, sem gerar arquivo nenhum.
    nome: 'skills: "Gerar PDF, Word e Excel" não instrui mais Python/executar_codigo pros formatos nativos',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const gerar = s.lista.find((k) => k.pasta === 'gerar-documentos');
      const corpo = gerar.corpo.toLowerCase();
      return [
        // não é a PALAVRA que importa (ela aparece de propósito numa frase de
        // "nunca use X") — é não ter mais RECEITA de código ensinando a usar
        !corpo.includes('from docx import') || 'ainda ensina o código de python-docx pro Word',
        !corpo.includes('from openpyxl import') || 'ainda ensina o código de openpyxl pro Excel',
        !corpo.includes('from reportlab') || 'ainda ensina o código de reportlab pro PDF',
        !corpo.includes('pip install python-docx') || 'ainda instrui pip install como caminho principal',
        corpo.includes('gerar_docx') || 'não menciona a ferramenta nativa gerar_docx',
        corpo.includes('gerar_xlsx') || 'não menciona a ferramenta nativa gerar_xlsx',
        corpo.includes('gerar_pdf') || 'não menciona a ferramenta nativa gerar_pdf',
        gerar.ferramentas.includes('gerar_docx') || 'ferramentas do front-matter não incluem gerar_docx',
        !gerar.ferramentas.includes('executar_codigo') ||
          'executar_codigo ainda listado como ferramenta principal desta skill',
      ];
    },
  },

  {
    nome: 'skills: gatilho de duas palavras tolera palavra no meio',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const didatica = s.lista.find((k) => k.pasta === 'explicacao-didatica');
      return [
        s.pontuar(didatica, 'como funciona um motor') > 0 || 'não casou a forma exata',
        s.pontuar(didatica, 'o que é inflação e como ela funciona') > 0 ||
          '"como ela funciona" não casou com o gatilho "como funciona"',
        s.pontuar(didatica, 'quero comprar um carro') === 0 || 'casou com pedido sem relação',
      ];
    },
  },

  {
    // Caso real de produção: numa pergunta sobre "virar pro player" (carreira
    // em jogo), a skill "Previsão do tempo" ativou na etapa de decisão. A
    // causa era o gatilho "tempo" sozinho — palavra comum demais em
    // português (significa tanto "clima" quanto "duração") — casando com
    // qualquer menção de tempo que não tem nada a ver com meteorologia.
    nome: 'skills: gatilho "tempo" sozinho foi removido — não ativa mais em uso genérico da palavra',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const tempo = s.lista.find((k) => k.pasta === 'previsao-do-tempo');
      return [
        s.pontuar(tempo, 'quanto tempo falta pra acabar a partida') === 0 ||
          'gatilho genérico "tempo" ainda ativa em uso sem relação com clima',
        s.pontuar(tempo, 'não tenho tempo pra isso hoje') === 0 ||
          'gatilho genérico "tempo" ainda ativa em uso sem relação com clima',
        // continua funcionando pras formas específicas de verdade
        s.pontuar(tempo, 'qual a previsão do tempo pra amanhã') > 0 || 'perdeu o uso legítimo (previsão do tempo)',
        s.pontuar(tempo, 'como está o clima em Vitória') > 0 || 'perdeu o uso legítimo (clima)',
        s.pontuar(tempo, 'vai chover essa semana?') > 0 || 'perdeu o uso legítimo (vai chover)',
      ];
    },
  },

  {
    // Caso real (v0.5.7, teste ao vivo — e literalmente um dos
    // exemplos sugeridos na tela inicial do próprio AuGPT: "Compare 3 IEMs
    // para FPS e gere uma planilha com o comparativo"): pedido "gere uma
    // planilha xlsx comparando 3 marcas de painel solar" ativou "Comparar
    // preços e produtos" JUNTO com "Gerar PDF, Word e Excel" (as duas
    // corretamente selecionadas), mas o modelo só respondeu com a tabela
    // markdown solta no chat — nunca chamou `gerar_xlsx`. Causa: o corpo de
    // "Comparativo" instruía terminar na tabela + recomendação, sem nunca
    // considerar que o pedido também queria um ARQUIVO. Corpo ganhou uma
    // seção cobrindo esse caso.
    nome: 'skills: "Comparativo" agora considera gerar arquivo quando o pedido também pede um',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const comparativo = s.lista.find((k) => k.pasta === 'comparativo');
      const corpo = comparativo.corpo.toLowerCase();
      return [
        corpo.includes('gerar_xlsx') || 'não menciona gerar_xlsx pro caso de pedido com arquivo',
        corpo.includes('gerar pdf, word e excel') || 'não referencia a skill de geração de arquivo',
        corpo.includes('planilha') && corpo.includes('recomende') ||
          'perdeu conteúdo original (formato de tabela / recomendação)',
      ];
    },
  },

  {
    // Item 3 da rodada de 2026-09-22 (Davi, achado analisando execução real
    // "melhor fone intra-auricular pra PUBG PC"): o agente tinha
    // `investigar_subtarefa` (despacha até 4 buscas relacionadas numa
    // chamada só) disponível e usou 1 vez em 9 buscas — o resto foi
    // `pesquisar_e_ler` da mesma pergunta reformulada. "Comparativo" e
    // "Pesquisa profunda" ganharam a ferramenta na lista `ferramentas:` (pra
    // aparecer garantida no catálogo, mesmo em modo seletivo) e uma
    // instrução explícita no corpo pra preferi-la a `pesquisar_e_ler` um
    // item/ângulo de cada vez.
    nome: 'skills: "Comparativo" e "Pesquisa profunda" recomendam investigar_subtarefa em vez de pesquisar_e_ler item por item',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const comparativo = s.lista.find((k) => k.pasta === 'comparativo');
      const pesquisaProfunda = s.lista.find((k) => k.pasta === 'pesquisa-profunda');
      return [
        comparativo.ferramentas.includes('investigar_subtarefa') ||
          '"Comparativo" não lista investigar_subtarefa em ferramentas',
        pesquisaProfunda.ferramentas.includes('investigar_subtarefa') ||
          '"Pesquisa profunda" não lista investigar_subtarefa em ferramentas',
        comparativo.corpo.toLowerCase().includes('investigar_subtarefa') ||
          '"Comparativo" não menciona investigar_subtarefa no corpo da instrução',
        pesquisaProfunda.corpo.toLowerCase().includes('investigar_subtarefa') ||
          '"Pesquisa profunda" não menciona investigar_subtarefa no corpo da instrução',
      ];
    },
  },

  {
    // Parte "barata" da ideia de "Source Intelligence" que Davi trouxe
    // (documento de outra IA, 2026-09-23): em vez de um pipeline novo
    // (classificador de domínio, avaliador de fonte etc. — descartado por
    // ora, custaria chamada de modelo extra por estágio), ensinar como
    // PROSA nas skills que já existem qual tipo de fonte serve pra qual tipo
    // de afirmação (especificação→fabricante, medição→teste técnico,
    // conforto/durabilidade→comunidade, preço→loja atual) — mesmo padrão do
    // Item 3 (instrução no corpo, sem mecanismo novo).
    nome: 'skills: "Comparativo" e "Pesquisa profunda" orientam qual tipo de fonte serve pra qual tipo de afirmação',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const comparativo = s.lista.find((k) => k.pasta === 'comparativo');
      const pesquisaProfunda = s.lista.find((k) => k.pasta === 'pesquisa-profunda');
      return [
        pesquisaProfunda.corpo.toLowerCase().includes('fabricante') ||
          '"Pesquisa profunda" não orienta usar o fabricante pra especificação declarada',
        pesquisaProfunda.corpo.toLowerCase().includes('comunidade') ||
          '"Pesquisa profunda" não orienta usar comunidade pra experiência de uso/durabilidade',
        comparativo.corpo.toLowerCase().includes('fabricante') ||
          '"Comparativo" não orienta usar o fabricante pra especificação declarada',
        comparativo.corpo.toLowerCase().includes('comunidade') ||
          '"Comparativo" não orienta usar comunidade pra conforto/durabilidade',
      ];
    },
  },

  {
    // Outro caso do mesmo relatório: a mesma pergunta ativou "Decisão e
    // cenários" (na época, via o gatilho solto "devo" — removido depois,
    // ver o teste "gatilho 'devo' sozinho..." mais abaixo) mas a resposta
    // final saiu com uma tabela de "manter local vs migrar pra nuvem" e uma
    // frase sobre "equipe passar de 10 pessoas" — completamente fora do
    // assunto (carreira em jogo). Naquele momento a causa aparente não era o
    // roteamento (o gatilho batia), era o CONTEÚDO da skill: um exemplo
    // concreto demais, que o modelo pequeno copiava em vez de adaptar. Aqui
    // só confere que o exemplo concreto saiu do arquivo — não dá pra testar
    // "o modelo copiou" sem rodar o modelo de verdade, mas dá pra garantir
    // que o texto que convidava a cópia não está mais lá.
    nome: 'skills: "Decisão e cenários" não carrega mais exemplo concreto de outro domínio (infra/nuvem)',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const decisao = s.lista.find((k) => k.pasta === 'decisao-e-cenarios');
      const corpo = decisao.corpo.toLowerCase();
      return [
        !corpo.includes('migrar para nuvem') || 'ainda tem o exemplo concreto "migrar para nuvem" no corpo',
        !corpo.includes('manter local') || 'ainda tem o exemplo concreto "manter local" no corpo',
        !corpo.includes('equipe passar de 10 pessoas') || 'ainda tem o exemplo concreto de equipe/pessoas no corpo',
        corpo.includes('opção a') || 'perdeu o formato de tabela genérica (opção a/b)',
      ];
    },
  },

  {
    // Casos reais de produção (relatório de 09/11, pós-v0.5.5): o gatilho
    // solto "devo" ativava "Decisão e cenários" em QUALQUER "como devo
    // fazer X" — mesmo sem ser uma decisão A-vs-B de verdade. Duas perguntas
    // de habilidade/execução ("como devo treinar", "que caminho devo
    // tomar") ativaram a skill e saíram com tabela de opções fora de
    // propósito. O gatilho "devo" foi removido; os gatilhos que sobraram
    // (vale a pena, qual escolher, migrar, faz sentido, decidir, cenário,
    // compensa etc.) continuam cobrindo pedidos de decisão de verdade — "devo
    // migrar meu servidor pra nuvem?" já tinha "migrar" também, então
    // continua ativando.
    nome: 'skills: gatilho "devo" sozinho foi removido de "Decisão e cenários" — não ativa mais em pergunta de habilidade/execução',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const decisao = s.lista.find((k) => k.pasta === 'decisao-e-cenarios');
      return [
        s.pontuar(decisao, 'Como devo manter uma boa constância no uso do spray?') === 0 ||
          'gatilho "devo" sozinho ainda ativa em pergunta de execução/habilidade',
        s.pontuar(decisao, 'Qual caminho devo tomar para virar um jogador melhor?') === 0 ||
          'gatilho "devo" sozinho ainda ativa em pergunta de execução/habilidade',
        // continua funcionando pro caso real de decisão de verdade
        s.pontuar(decisao, 'devo migrar meu servidor para a nuvem?') > 0 ||
          'perdeu o uso legítimo (decisão real, coberto por "migrar")',
        s.pontuar(decisao, 'vale a pena trocar de emprego agora?') > 0 ||
          'perdeu o uso legítimo (vale a pena)',
      ];
    },
  },

  {
    nome: 'Skills.formatar: com só 1 skill, mantém o formato simples de sempre (sem estratégia)',
    tipo: 'unidade',
    executar() {
      const bloco = Skills.formatar([{ nome: 'Matemática e cálculo', corpo: 'Use calcular sempre.', sempre: false }]);
      return [
        bloco.includes('### Matemática e cálculo') || 'não incluiu o título da skill',
        bloco.includes('Use calcular sempre.') || 'não incluiu o corpo da skill',
        !bloco.includes('PRINCIPAL') || 'com 1 skill só não deveria falar de "principal" (não há o que decidir)',
        !bloco.includes('combinadas') || 'com 1 skill só não deveria falar em skills combinadas',
      ];
    },
  },

  {
    // Backlog do Copiloto, item m2 (Etapa mínima de Estratégia): antes, quando
    // mais de uma skill relevante batia no mesmo pedido, o prompt só empilhava
    // as instruções de todas lado a lado, em pé de igualdade — nada dizia qual
    // delas deveria mandar se elas se contradissessem. Caso real de combinação
    // sem antigatilho entre as duas: "compare o preço de duas placas de vídeo
    // e diga qual é mais barata" ativa "Comparar preços e produtos" (gatilhos
    // "preço"+"mais barato", prioridade 3 → 9 pontos) junto com "Pesquisa na
    // web" (skill `sempre: true`, sempre ativa na etapa de decisão).
    nome: 'Skills.formatar: com 2+ skills combinadas, o prompt decide explicitamente qual é a PRINCIPAL',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const pedido = 'compare o preço de duas placas de vídeo e diga qual é mais barata';
      const ativas = await s.selecionar(pedido, { etapa: 'decisao' });
      const nomesAtivos = ativas.map((k) => k.nome);
      const bloco = Skills.formatar(ativas);

      return [
        ativas.length >= 2 || `esperava 2+ skills combinadas, ativou só [${nomesAtivos.join(', ')}]`,
        nomesAtivos.includes('Comparar preços e produtos') || 'não ativou "Comparar preços e produtos"',
        nomesAtivos.includes('Pesquisa na web') || 'não ativou a skill sempre-ativa "Pesquisa na web"',
        bloco.includes('skills combinadas') || 'não avisou que há skills combinadas',
        bloco.includes('"Comparar preços e produtos" é a PRINCIPAL') ||
          'não escolheu a skill de domínio específico como principal',
        bloco.includes('### Comparar preços e produtos (principal)') ||
          'não marcou "(principal)" na seção certa do bloco',
        // a skill "sempre: true" nunca deve virar principal, mesmo pontuando mais alto
        // (100+prioridade, artificial, só pra nunca ser cortada pelo teto de skills)
        !bloco.includes('"Pesquisa na web" é a PRINCIPAL') ||
          'a skill sempre-ativa (baseline genérico) virou principal por engano',
        !bloco.includes('### Pesquisa na web (principal)') ||
          'a skill sempre-ativa (baseline genérico) foi marcada como principal',
      ];
    },
  },

  {
    nome: 'skills: formato padrão (name/description) é importável',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-import-${Date.now()}`);
      fs.mkdirSync(path.join(dir, 'importada'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'importada', 'SKILL.md'),
        `---
name: kubernetes-debug
description: "Use this skill whenever the user mentions 'kubernetes' or 'kubectl' troubleshooting. Triggers include: pod crash, CrashLoopBackOff."
---

# Kubernetes debugging
Sempre comece por kubectl describe pod.
`,
        'utf8'
      );

      const s = new Skills({
        dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
        dirUsuario: dir,
      });
      const importada = s.lista.find((k) => k.pasta === 'importada');
      const pontos = importada ? s.pontuar(importada, 'meu pod está em CrashLoopBackOff no kubernetes') : 0;
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        Boolean(importada) || 'skill no formato padrão não foi carregada',
        importada?.nome === 'kubernetes-debug' || `nome não veio de "name": ${importada?.nome}`,
        importada?.gatilhos.length > 0 || 'nenhum gatilho foi derivado da descrição',
        pontos > 0 || 'a skill importada nunca ativaria',
        importada?.importada === true || 'não marcou a skill como importada',
      ];
    },
  },

  {
    // Item 3 da análise comparativa (2026-09-21, "allowed-tools por skill"):
    // campo novo, opt-in — skill sem o campo (a esmagadora maioria) tem que
    // continuar com ferramentasPermitidas vazio (sem restringir nada). Duas
    // skills novas aqui provam os dois nomes de campo aceitos: o nosso
    // (`ferramentas_permitidas`) e o do formato padrão da comunidade
    // (`allowed-tools`), lado a lado com uma skill comum que não declara
    // nenhum dos dois.
    nome: 'skills: ferramentas_permitidas (e o alias allowed-tools) são carregados do frontmatter; skill sem o campo fica com lista vazia (não restringe nada)',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-allowed-tools-${Date.now()}`);
      fs.mkdirSync(path.join(dir, 'restrita-nossa'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'restrita-padrao'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'restrita-nossa', 'SKILL.md'),
        `---
nome: Skill restrita (campo nosso)
descricao: teste do campo ferramentas_permitidas
gatilhos: [teste-restrita-nossa]
ferramentas_permitidas: [ler_arquivo, listar_arquivos]
---

Corpo de teste.
`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'restrita-padrao', 'SKILL.md'),
        `---
name: skill-restrita-padrao
description: teste do campo allowed-tools (formato padrão da comunidade)
allowed-tools: [buscar_web]
---

Corpo de teste.
`,
        'utf8'
      );

      const s = new Skills({
        dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
        dirUsuario: dir,
      });
      const nossa = s.lista.find((k) => k.pasta === 'restrita-nossa');
      const padrao = s.lista.find((k) => k.pasta === 'restrita-padrao');
      const comum = s.lista.find((k) => k.pasta === 'texto-longo'); // skill embutida qualquer, sem o campo
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        (nossa?.ferramentasPermitidas || []).join(',') === 'ler_arquivo,listar_arquivos' ||
          `ferramentas_permitidas não veio como esperado: ${JSON.stringify(nossa?.ferramentasPermitidas)}`,
        (padrao?.ferramentasPermitidas || []).join(',') === 'buscar_web' ||
          `allowed-tools (alias) não veio como esperado: ${JSON.stringify(padrao?.ferramentasPermitidas)}`,
        Array.isArray(comum?.ferramentasPermitidas) && comum.ferramentasPermitidas.length === 0 ||
          'skill sem o campo deveria ficar com ferramentasPermitidas vazio (opt-in, sem restringir nada)',
      ];
    },
  },

  /* ------------------------------ item 6: ativação manual de skill por /nome ------------------------------ */
  //
  // Análise comparativa 2026-09-21/22, item 6 (inspirado no /nome-da-skill do
  // deer-flow): `porNome()` acha a skill que o usuário digitou depois da
  // barra, por slug — pra `Agent.run()` (loop.js) forçar sua seleção via
  // `forcarId` em `selecionar()`.

  {
    nome: 'skills: porNome() acha por pasta ou nome (acento/maiúscula não importa), prefixo só quando é único, e nada quando ambíguo ou fora do catálogo',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      return [
        s.porNome('previsao-do-tempo')?.pasta === 'previsao-do-tempo' ||
          'exato por pasta não achou "previsao-do-tempo"',
        s.porNome('Previsão do Tempo')?.pasta === 'previsao-do-tempo' ||
          'exato por nome (com acento/maiúscula) não achou "previsao-do-tempo"',
        s.porNome('PREVISAO-DO-TEMPO')?.pasta === 'previsao-do-tempo' ||
          'exato por pasta em maiúsculas não achou "previsao-do-tempo"',
        // "previsao" é prefixo de só uma pasta/nome no catálogo — único candidato
        s.porNome('previsao')?.pasta === 'previsao-do-tempo' ||
          'prefixo único ("previsao") não achou "previsao-do-tempo"',
        // "texto" é prefixo de "texto-longo" — mas também bate por acaso com
        // outra coisa? Não deveria (é único) — prova o caminho feliz de novo
        // com outra skill, não só previsão do tempo.
        s.porNome('texto')?.pasta === 'texto-longo' || 'prefixo único ("texto") não achou "texto-longo"',
        s.porNome('') === null || 'string vazia não deveria achar nada',
        s.porNome('skill-que-nao-existe-no-catalogo') === null ||
          'nome fora do catálogo não deveria achar nada',
      ];
    },
  },

  {
    nome: 'skills: porNome() respeita desativadas (skill desligada no painel não é achável por /nome) e nunca acha skill sugerida (ainda não aprovada)',
    tipo: 'unidade',
    executar() {
      const s = carregar();
      const previsao = s.lista.find((k) => k.pasta === 'previsao-do-tempo');
      const achadaDesativada = s.porNome('previsao-do-tempo', { desativadas: [previsao.id] });
      const achadaAtiva = s.porNome('previsao-do-tempo', { desativadas: [] });

      // skill sugerida (item 5, criação automática) só existe em memória —
      // simula uma sem gravar disco, pra testar o filtro sem precisar do
      // fluxo de criação inteiro
      s.lista.push({
        id: 'sua:rascunho-teste', pasta: 'rascunho-teste', nome: 'Rascunho de teste',
        descricao: '', gatilhos: [], naoUsePara: [], ferramentas: [], ferramentasPermitidas: [],
        etapa: 'ambas', prioridade: 1, sempre: false, sugerida: true, tamanho: 10,
      });

      return [
        achadaDesativada === null || 'skill desativada não deveria ser achável por /nome',
        achadaAtiva?.pasta === 'previsao-do-tempo' || 'skill ativa deveria continuar achável',
        s.porNome('rascunho-teste') === null || 'skill sugerida (não aprovada) não deveria ser achável por /nome',
      ];
    },
  },

  {
    nome: 'skills: selecionar() com forcarId garante a skill na 1ª posição mesmo sem NENHUM gatilho bater, e ainda deixa a seleção automática preencher o resto',
    tipo: 'unidade',
    async executar() {
      const dir = path.join(os.tmpdir(), `augpt-forcar-skill-${Date.now()}`);
      fs.mkdirSync(path.join(dir, 'forcada-sem-gatilho'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'forcada-sem-gatilho', 'SKILL.md'),
        `---
nome: Forçada sem gatilho
descricao: skill de teste que não deveria pontuar nada sozinha
gatilhos: [zzz-termo-que-nunca-aparece-em-pedido-nenhum]
---

Corpo de teste.
`,
        'utf8'
      );

      const s = new Skills({
        dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
        dirUsuario: dir,
      });
      const forcada = s.lista.find((k) => k.pasta === 'forcada-sem-gatilho');
      const semForcar = await s.selecionar('crie uma função em python que valide CPF', { etapa: 'decisao' });
      const comForcar = await s.selecionar('crie uma função em python que valide CPF', {
        etapa: 'decisao',
        forcarId: forcada.id,
      });
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        !semForcar.some((k) => k.pasta === 'forcada-sem-gatilho') ||
          'sem forçar, a skill sem gatilho nenhum não deveria ter entrado sozinha',
        comForcar[0]?.pasta === 'forcada-sem-gatilho' ||
          `forçada deveria vir em 1º lugar, veio [${comForcar.map((k) => k.pasta).join(', ')}]`,
        // "Pesquisa na web" (sempre: true) pontua 100+prioridade — SEMPRE o
        // maior escore entre as automáticas, então é a prova mais robusta de
        // que a seleção automática continuou rodando normalmente ao lado da
        // forçada (não travou nem foi substituída por ela sozinha).
        comForcar.some((k) => k.pasta === 'pesquisa-web') ||
          `a seleção automática deveria continuar preenchendo o resto, obteve [${comForcar.map((k) => k.pasta).join(', ')}]`,
      ];
    },
  },

  {
    nome: 'skills: selecionar() com forcarId inválido (id que não existe ou não elegível nesta etapa) não quebra — cai pra seleção automática normal',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const resultado = await s.selecionar('crie uma função em python que valide CPF', {
        etapa: 'decisao',
        forcarId: 'embutida:id-que-nao-existe',
      });
      return [
        resultado.some((k) => k.pasta === 'escrever-codigo') ||
          `forcarId inválido deveria cair pra seleção automática normal, obteve [${resultado.map((k) => k.pasta).join(', ')}]`,
      ];
    },
  },

  /* ------------------------------ skill nova: redação ENEM (2026-09-22) ------------------------------ */

  {
    nome: 'skill "Redação dissertativa-argumentativa (ENEM)": ativa em pedido de redação nova',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const ativas = await nomes(s, 'faça uma redação dissertativa-argumentativa sobre desafios da educação no Brasil');
      return [
        ativas.includes('Redação dissertativa-argumentativa (ENEM)') ||
          `esperava a skill de redação ativa, obteve [${ativas.join(', ')}]`,
      ];
    },
  },

  {
    // Achado testando a skill nova: "corrija" é gatilho de "Revisão de código"
    // (pensado pra "corrija esse bug") e batia igual em "corrija minha
    // redação" — as duas skills competiam pelo mesmo pedido de texto. Corrigido
    // com um nao_use_para em revisao-de-codigo/SKILL.md (redação/dissertação).
    // Este teste prova o cruzamento resolvido; o próximo prova que a correção
    // não quebrou o caso normal de revisão de código.
    nome: 'skill "Redação dissertativa-argumentativa (ENEM)": "corrija minha redação" NÃO ativa junto "Revisão de código" (cruzamento de gatilho corrigido)',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const ativas = await nomes(s, 'corrija minha redação sobre o tema violência urbana: [texto colado aqui]');
      return [
        ativas.includes('Redação dissertativa-argumentativa (ENEM)') ||
          `esperava a skill de redação ativa, obteve [${ativas.join(', ')}]`,
        !ativas.includes('Revisão de código') ||
          `"corrija minha redação" não deveria ativar "Revisão de código", obteve [${ativas.join(', ')}]`,
      ];
    },
  },

  {
    nome: 'skill "Revisão de código": contraprova — "corrija esse bug" continua ativando normalmente após o nao_use_para',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const ativas = await nomes(s, 'corrija esse bug na função de login');
      return [
        ativas.includes('Revisão de código') ||
          `"corrija esse bug" deveria continuar ativando "Revisão de código", obteve [${ativas.join(', ')}]`,
        !ativas.includes('Redação dissertativa-argumentativa (ENEM)') ||
          `"corrija esse bug" não deveria ativar a skill de redação, obteve [${ativas.join(', ')}]`,
      ];
    },
  },

  {
    nome: 'skill "Redação dissertativa-argumentativa (ENEM)": ativável manualmente por /redacao-enem (item 6)',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const skill = s.porNome('redacao-enem');
      return [
        skill?.pasta === 'redacao-enem' || `porNome("redacao-enem") deveria achar a skill, obteve ${JSON.stringify(skill)}`,
      ];
    },
  },

  {
    nome: 'skill "Redação dissertativa-argumentativa (ENEM)": pedido sem nenhuma relação (biologia) não ativa',
    tipo: 'unidade',
    async executar() {
      const s = carregar();
      const ativas = await nomes(s, 'como funciona o olho de um gato?');
      return [
        !ativas.includes('Redação dissertativa-argumentativa (ENEM)') ||
          `pedido sem relação não deveria ativar a skill de redação, obteve [${ativas.join(', ')}]`,
      ];
    },
  },
];
