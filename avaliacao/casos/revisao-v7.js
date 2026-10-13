'use strict';

/**
 * Revisão v7 (2026-10-12): o que a leitura das conversas reais de 11–12/10
 * mostrou. O risco maior deixou de ser a lentidão: era o agente entender
 * errado o pedido e entregar assim mesmo.
 *
 *   - "Compare 3 IEMs para FPS e gere uma planilha" respondeu sobre trabalhos
 *     de conclusão de curso (a busca achou uma faculdade de sigla FPS);
 *   - "O Bose QC 20 é usado por muitos pro players?" respondeu com a tabela
 *     dos mais usados, sem dizer nada do Bose QC 20;
 *   - no modo automático o agente parou duas vezes para perguntar (477 s);
 *   - a resposta rápida era gravada com o pedido em branco.
 */

const { executarCasoAgente } = require('../motor');
const compositor = require('../../src/agent/compositor');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');

// mais de 400 caracteres e nenhuma palavra do pedido dos casos abaixo
const SOBRE_TCC =
  'Aqui está a lista de trabalhos de conclusão de curso da universidade: o primeiro estuda a espessura muscular medida por ultrassom portátil; ' +
  'o segundo analisa a ansiedade de atletas antes de provas; o terceiro revisa métodos de avaliação nutricional em idosos; ' +
  'o quarto descreve a rotina de enfermeiros em unidades de terapia intensiva; o quinto investiga o sono de estudantes de medicina durante o internato ' +
  'e a relação com o rendimento nas avaliações semestrais da graduação.';
const PEDIDO = 'Quais as diferenças de palco sonoro entre os fones Alfa e Beta?';
const ARQUIVO_TCC = { 'tcc.txt': `${SOBRE_TCC} `.repeat(4) };
const ARQUIVO_FONES = { 'fones.txt': 'O fone Alfa tem palco sonoro amplo, com boa separação. O fone Beta tem palco sonoro mais fechado, porém graves mais fortes. '.repeat(14) };

module.exports = [
  {
    nome: 'v7: resposta longa sem NENHUM termo do pedido não é entregue — sem material do assunto, o agente diz que não achou (caso real: "Compare 3 IEMs para FPS" respondido com trabalhos de conclusão de curso)',
    pedido: PEDIDO,
    arquivos: ARQUIVO_TCC,
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'tcc.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'diferenças de palco sonoro' } },
    ],
    redacao: SOBRE_TCC,
    espera: {
      ok: true,
      respostaContem: ['Não consegui montar uma resposta confiável'],
      respostaNaoContem: ['trabalhos de conclusão de curso'],
    },
  },
  {
    nome: 'v7: fora do assunto, mas HÁ material que trata do pedido — refaz só com ele e entrega a resposta certa',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v7 fora do assunto recuperado',
        pedido: PEDIDO,
        arquivos: { ...ARQUIVO_TCC, ...ARQUIVO_FONES },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'tcc.txt' } },
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fones.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'diferenças de palco sonoro' } },
        ],
        // as duas primeiras redações saem sobre o outro assunto; a terceira recebe só o material dos fones
        redacao: (prompt, n) => (n <= 2 ? SOBRE_TCC : 'O fone Alfa tem palco sonoro amplo; o fone Beta, um palco sonoro mais fechado. Essa é a principal diferença entre os dois.'),
      });
      const ultima = obtido.promptRedacao.split('MATERIAL').pop();
      return [
        /palco sonoro amplo/.test(obtido.resposta) || `deveria entregar a resposta sobre os fones: ${obtido.resposta.slice(0, 120)}`,
        !/Não consegui montar/.test(obtido.resposta) || 'com material do assunto não é caso de desistir',
        obtido.chamadasRedacao === 3 || `esperava 3 redações (a original, a reescrita e a refeita com o material certo), houve ${obtido.chamadasRedacao}`,
        !/ultrassom/.test(ultima) || 'a redação refeita não pode receber o material do outro assunto',
      ];
    },
  },
  {
    nome: 'v7: resposta curta e direta, sem repetir as palavras da pergunta, NÃO é "fora do assunto"',
    pedido: PEDIDO,
    arquivos: ARQUIVO_FONES,
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'fones.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'diferenças' } },
    ],
    redacao: 'O primeiro é mais aberto; o segundo, mais fechado.',
    espera: { ok: true, respostaContem: ['mais aberto'], respostaNaoContem: ['Não consegui montar'] },
  },
  {
    nome: 'v7: comparação de produtos com arquivo de SAÍDA é pedido de produto (vai para a pesquisa planejada); arquivo de ENTRADA e pedido só de arquivo continuam "local"',
    tipo: 'unidade',
    executar() {
      const tipo = (p) => tipoDoPedido(p).tipo;
      return [
        tipo('Compare 3 IEMs para FPS e gere uma planilha com o comparativo') === 'produto' || 'comparar produtos + planilha de saída é produto',
        /arquivo de saída/.test(tipoDoPedido('Compare 3 IEMs para FPS e gere uma planilha com o comparativo').motivo) || 'o motivo registra que há arquivo de saída',
        tipo('Qual o melhor mouse para fps? Coloque numa planilha') === 'produto' || 'escolha de produto + planilha',
        tipo('Crie uma planilha com os gastos do extrato.csv') === 'local' || 'arquivo de entrada (extrato.csv) é local',
        tipo('Leia o contrato.pdf e me diga as multas') === 'local' || 'ler documento é local',
        tipo('Gere um pdf com um resumo da reunião') === 'local' || 'pedido que é só gerar arquivo continua local',
        tipo('Analise o boleto que anexei e gere um pdf') === 'local' || 'anexo + arquivo de saída é local',
      ];
    },
  },
  {
    nome: 'v7: pergunta sobre UM produto nas listas dos profissionais responde sobre ele — está na lista (quantos, em que lugar) ou não aparece; sem produto nomeado, nada muda',
    tipo: 'unidade',
    executar() {
      const uso = {
        total: 48,
        ranking: [
          { produto: 'HyperX Cloud II', jogadores: 16, parcela: 33.3, exemplos: ['Space', 'Verbo'] },
          { produto: 'Logitech G Pro', jogadores: 7, parcela: 14.6, exemplos: ['Kalios'] },
          { produto: 'Bose QC20', jogadores: 2, parcela: 4.2, exemplos: ['Stoop'] },
        ],
      };
      const montar = (objetivo, u = uso) => compositor.montar({ modo: 'uso-profissional', objetivo, uso: u }, new Map());
      const naLista = montar('O Bose QC 20 é usado por muitos pro players?');
      const fora = montar('O Bose QC 20 é usado por muitos pro players?', { ...uso, ranking: uso.ranking.slice(0, 2) });
      const geral = montar('Qual o fone mais usado pelos profissionais de PUBG?');
      return [
        /### Resposta direta\nO \*\*Bose QC 20\*\* aparece com 2 de 48 jogadores listados \(4,2%\), em 3º lugar/.test(naLista) || `produto que está na lista: ${naLista.slice(0, 200)}`,
        /O \*\*Bose QC 20\*\* não aparece entre os 48 profissionais listados/.test(fora) || `produto fora da lista: ${fora.slice(0, 200)}`,
        /o mais usado é o \*\*HyperX Cloud II\*\*/.test(naLista) || 'a tabela dos mais usados continua vindo depois',
        /^### Resposta direta\nEntre os profissionais listados/.test(geral) || `sem produto nomeado, a resposta de sempre: ${geral.slice(0, 120)}`,
      ];
    },
  },
  {
    nome: 'v7: no modo automático o agente não para pra perguntar — recebe a instrução de seguir com a suposição e declará-la (caso real: 477 de 957 s esperando resposta)',
    pedido: 'Qual das duas placas de vídeo eu devo comprar?',
    arquivos: { 'nota.txt': 'RTX 5070 Ti e RTX 5080.' },
    config: { naoPerguntarNoAutomatico: true },
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: {} },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
      { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'Qual é o seu orçamento para a placa de vídeo?' } },
      { ferramenta: 'responder', argumentos: { foco: 'qual comprar, supondo orçamento médio' } },
    ],
    redacao: 'Supondo um orçamento médio, a RTX 5070 Ti é a escolha mais equilibrada das duas placas de vídeo.',
    espera: { ok: true, perguntouAoUsuario: false, erroContem: ['Modo automático: o usuário pediu para não ser interrompido'], respostaContem: ['Supondo um orçamento médio'] },
  },
  {
    nome: 'v7: a resposta rápida do AUTO grava o pedido no registro (antes ficava em branco)',
    tipo: 'unidade',
    async executar() {
      const pedido = 'Quem foi Galileu Galilei?';
      const obtido = await executarCasoAgente({
        nome: 'v7 registro da resposta rapida',
        pedido,
        config: { modoAuto: true },
        depsRespostaRapida: {
          buscar: async () => ({ resultados: [] }),
          wikipedia: async (_a, idioma) => (idioma === 'pt' ? { idioma, titulo: 'Galileu Galilei', url: 'https://pt.wikipedia.org/wiki/Galileu_Galilei', introducao: 'Galileu Galilei foi um astrônomo e físico italiano.', campos: [] } : null),
          escrever: async () => ({ content: 'Galileu Galilei foi um astrônomo e físico italiano.' }),
        },
      });
      return [
        obtido.passos === 0 || `deveria responder pelo caminho rápido, sem o laço (passos: ${obtido.passos})`,
        obtido.registro?.pedido === pedido || `pedido no registro: ${JSON.stringify(obtido.registro?.pedido)}`,
      ];
    },
  },
  {
    nome: 'v7 (uso real de 12/10): UM produto citado pelo plano e escrito no pedido é avaliação daquele produto ("fone bose qc 20") — categoria, nome fora do pedido e pedido de alternativas continuam na descoberta',
    tipo: 'unidade',
    executar() {
      const unico = require('../../src/agent/motor-pesquisa').produtoUnicoDoPedido;
      return [
        unico('fone bose qc 20', ['Bose QC 20']) === true || 'nome com modelo, escrito no pedido em minúsculas',
        unico('O fone de ouvido bose qc 20 e bom para jogar pubg ?', ['Bose QC 20']) === true || 'pergunta sobre um produto',
        unico('O Audeze Maxwell vale a pena?', ['Audeze Maxwell']) === true || 'nome sem dígito, com duas palavras',
        unico('Qual o melhor fone gamer para pubg?', ['fone gamer']) === false || 'categoria não é produto',
        unico('Qual o melhor fone para pubg?', ['HyperX Cloud II']) === false || 'nome que o modelo lembrou e não está no pedido',
        unico('Alternativas ao Bose QC 20', ['Bose QC 20']) === false || 'pedir alternativas é descoberta',
        unico('Qual o melhor mouse da Razer?', ['Razer']) === false || 'marca sozinha não é um produto',
        unico('Bose QC 20 ou Sony WF-1000XM5?', ['Bose QC 20', 'Sony WF-1000XM5']) === false || 'duas opções já têm o caminho da comparação',
      ];
    },
  },
  {
    nome: 'v7 (13/10): avaliação de UM produto abre com a foto, o que é o produto e a análise escrita pelo modelo; cada cartão da recomendação leva UM comentário como prova, e o pedido manda explicar com as próprias palavras',
    tipo: 'unidade',
    executar() {
      const citacoes = [
        { texto: 'Uso o Bose QC 20 no avião e o ruído some.', fonte: 'r/headphones', votos: 9, tom: 'recomenda' },
        { texto: 'O cancelamento do Bose QC 20 ainda é dos melhores.', fonte: 'r/headphones', votos: 4, tom: 'recomenda' },
      ];
      const bose = { nome: 'Bose QC 20', status: { isolamento: 'corroborado' }, consenso: { topicos: 2, citacoes } };
      const base = { modo: 'recomendacao', plano: { uso: 'viajar', criterios: [{ nome: 'isolamento', peso: 'alto', porque: 'corta o ruído do motor' }] }, matriz: { celula: () => null, resumos: new Map() } };
      const r = { ...base, avaliacao: true, finalistas: [bose], imagens: new Map([['Bose QC 20', 'augpt-img://abc.jpg']]) };
      const frases = new Map([['OQUEE', 'O Bose QC 20 é um fone intra-auricular com cancelamento ativo de ruído.'], ['DIRETA', 'Serve bem para viajar.'], ['BOSE QC 20', 'Quem usa relata que o ruído do avião praticamente some.']]);
      const texto = compositor.montar(r, frases);
      const pedido = compositor.pedidoDeFrases(r, 'fone bose qc 20');
      const lista = compositor.montar({ ...base, finalistas: [bose, { nome: 'Outro Z9', status: {}, consenso: { topicos: 1, citacoes: [] } }] }, new Map());
      return [
        /^!\[Bose QC 20\]\(augpt-img:\/\/abc\.jpg\)\n\nO Bose QC 20 é um fone intra-auricular/.test(texto) || `abre com a foto e o que é o produto: ${texto.slice(0, 160)}`,
        /### Resposta direta\nServe bem para viajar\.\n\nQuem usa relata/.test(texto) || 'a análise do modelo vem logo depois da resposta direta',
        /### Bose QC 20 nesses critérios/.test(texto) || 'a parte por critério continua',
        /OQUEE: </.test(pedido) && /com as SUAS palavras/.test(pedido) && /3 ou 4 frases/.test(pedido) || 'o pedido de frases pede o que é o produto e a explicação com as próprias palavras',
        (pedido.match(/um usuário disse/g) || []).length === 2 || 'o modelo recebe os dois comentários para resumir',
        (lista.split('#### 2.')[0].match(/^> /gm) || []).length === 1 || 'no cartão, um comentário só como prova',
      ];
    },
  },
  {
    nome: 'v7 (13/10): entendimento do pedido — o modelo diz produto, uso e intenção e o código confere contra o pedido (nome tem que estar escrito; uso que o pedido não diz vira "não informado"; recomendar/comparar/alternativas não é pedido de UM produto)',
    tipo: 'unidade',
    executar() {
      const { lerEntendimento, mencionaNome } = require('../../src/agent/motor-pesquisa');
      const r = (produto, uso, intencao, pedido, categoria = 'fone de ouvido') => lerEntendimento(`PRODUTO: ${produto}\nCATEGORIA: ${categoria}\nUSO: ${uso}\nINTENCAO: ${intencao}`, pedido);
      const dunu = r('dunu titan s', 'ouvir música durante treinos', 'conhecer', 'fone de ouvido dunu titan s');
      const bose = r('Bose QC 20', 'jogar PUBG', 'avaliar', 'O fone de ouvido bose qc 20 e bom para jogar pubg ?');
      return [
        (dunu?.produto === 'dunu titan s' && dunu.uso === '') || `produto certo e uso inventado descartado: ${JSON.stringify(dunu)}`,
        (bose?.produto === 'Bose QC 20' && bose.uso === 'jogar PUBG') || `uso escrito no pedido fica: ${JSON.stringify(bose)}`,
        r('fone de ouvido Dunu Titan S', 'não informado', 'conhecer', 'fone de ouvido dunu titan s')?.produto === 'Dunu Titan S' || 'o tipo de produto repetido na frente do nome sai',
        r('samsung s26 ultra', 'não informado', 'conhecer', 'sansung s26 ultra', 'não informado')?.produto === 'samsung s26 ultra' || 'uma palavra corrigida pelo modelo é aceita',
        r('bose qc20', 'não informado', 'conhecer', 'Bose qc 20')?.produto === 'bose qc20' || 'nome colado/separado diferente é o mesmo produto',
        r('HyperX Cloud II', 'jogar PUBG', 'avaliar', 'Qual o melhor fone para pubg?') === null || 'produto que não está no pedido é recusado',
        r('nenhum', 'jogar PUBG', 'recomendar', 'Qual o melhor fone para pubg?') === null || 'sem produto citado segue a recomendação',
        r('Bose QC 20', 'não informado', 'conhecer', 'Alternativas ao Bose QC 20') === null || 'pedir alternativas é recomendação',
        r('fone gamer', 'não informado', 'conhecer', 'fone gamer barato') === null || 'categoria não é produto',
        lerEntendimento('não sei', 'fone bose qc 20') === null || 'resposta ilegível não muda nada',
        (mencionaNome('review do bose qc20 em 2026', 'Bose QC 20') && !mencionaNome('review do bose 700', 'Bose QC 20')) || 'a página que escreve o modelo colado cita o produto',
      ];
    },
  },
  {
    nome: 'v7 (13/10): "fone de ouvido dunu titan s" — o motor pesquisa SÓ aquele produto (review, ficha, comunidade, preço), sem cadeia de uso nem descoberta de outras opções, e entrega o plano de uma resposta sobre ele',
    tipo: 'unidade',
    async executar() {
      const motor = require('../../src/agent/motor-pesquisa');
      const tipos = [];
      const feitas = [];
      const r = await motor.executarPesquisaPlanejada({
        objetivo: 'fone de ouvido dunu titan s',
        chamarModelo: async (_p, { tipo }) => {
          tipos.push(tipo);
          return tipo === 'entendimento' ? 'PRODUTO: dunu titan s\nCATEGORIA: fone de ouvido\nUSO: ouvir música durante treinos\nINTENCAO: conhecer' : '';
        },
        buscar: async (consulta) => {
          feitas.push(consulta);
          return [
            { url: `https://exemplo.com/${feitas.length}`, origem: 'exemplo.com', texto: 'O Dunu Titan S tem driver dinâmico de 11 mm.', bruto: 'O Dunu Titan S tem driver dinâmico de 11 mm.' },
            { url: `https://outro.com/${feitas.length}`, origem: 'outro.com', texto: 'Os melhores fones para treino.', bruto: 'Os melhores fones para treino.' },
          ];
        },
      });
      return [
        (r.ok && r.modo === 'produto' && r.produto === 'dunu titan s') || `modo: ${r.modo}, ok: ${r.ok}, motivo: ${r.motivo}`,
        tipos.join() === 'entendimento' || `só a chamada de entendimento, sem cadeia de uso nem plano de recomendação: ${tipos}`,
        (feitas.length === 5 && feitas.every((c) => /dunu titan s/.test(c))) || `todas as buscas citam o produto: ${feitas.join(' | ')}`,
        !feitas.some((c) => /treino|melhor/.test(c)) || 'nenhuma busca sobre o uso inventado',
        (r.entradas.length === 5 && r.entradas.every((e) => /Dunu/.test(e.texto))) || `página que não cita o produto fica de fora: ${r.entradas.length}`,
        /sobre UM produto: dunu titan s/.test(r.planoDeResposta) && /NÃO recomende nem liste outros produtos/.test(r.planoDeResposta) || 'o plano da resposta é sobre o produto',
      ];
    },
  },
  {
    nome: 'v7 (13/10): botão "Resposta direta" — com respostaDireta ligado, um pedido de produto (que iria para a pesquisa profunda) é respondido pelo caminho rápido do nível 1, sem o laço',
    tipo: 'unidade',
    async executar() {
      const deps = {
        buscar: async () => ({ provedor: 'falso', resultados: [{ titulo: 'Dunu Titan S review', url: 'https://exemplo.com/titan', resumo: 'O Dunu Titan S é um fone intra-auricular com driver dinâmico de 11 mm.' }] }),
        wikipedia: async () => null,
        ler: async () => ({ texto: 'O Dunu Titan S é um fone intra-auricular com driver dinâmico de 11 mm e som neutro. '.repeat(8), url: 'https://exemplo.com/titan' }),
        escrever: async () => ({ content: 'O Dunu Titan S é um fone intra-auricular com driver dinâmico de 11 mm e som neutro.' }),
      };
      const caso = (config) => executarCasoAgente({ nome: 'v7 resposta direta', pedido: 'fone dunu titan s vale a pena comprar?', config: { modoAuto: true, ...config }, depsRespostaRapida: deps, roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fone' } }], redacao: 'Resposta do laço.' });
      const direta = await caso({ respostaDireta: true });
      return [
        direta.passos === 0 || `com o botão ligado responde sem o laço (passos: ${direta.passos})`,
        /Dunu Titan S é um fone intra-auricular/.test(direta.resposta) || `resposta do caminho rápido: ${String(direta.resposta).slice(0, 120)}`,
        direta.registro?.auto?.nivel === 1 || `nível registrado: ${JSON.stringify(direta.registro?.auto)}`,
      ];
    },
  },
];
