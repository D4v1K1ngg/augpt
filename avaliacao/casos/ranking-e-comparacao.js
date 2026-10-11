'use strict';

/**
 * 13º teste real (2026-09-28): ranking por contagem e comparação rasa.
 *
 * Fones: "HyperX Cloud 3" (headset!) em 1º de uma lista de intra pra PUBG
 * só por aparecer em 18 sites de headset em geral; "microfone claro" com peso
 * alto; o Davi: "ele tenta classificar pela quantidade de citações... devemos
 * rever isso". Placa de vídeo: "diferença de desempenho entre a RTX 5070 Ti e
 * a RTX 5080" não entrava no motor — PassMark, sem jogos, sem comunidade.
 */

const m = require('../../src/agent/motor-pesquisa');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

const topico = (url, sub, linhas) => ({
  url,
  bruto: [`TÓPICO DO REDDIT (r/${sub}): best IEM for FPS?`, 'POST: which iem for pubg?', 'COMENTÁRIOS:', ...linhas].join('\n'),
});

module.exports = [
  {
    nome: 'ranking (13º teste real): 18 sites que só citam um headset não ganham de um intra recomendado pra FPS em 2 tópicos; site editorial conta no máximo 3 e só quando fala do uso',
    tipo: 'unidade',
    executar() {
      const termos = m.termosDoUso('top 10 fones intra auriculares para jogar pubg de pc');
      const sites = Array.from({ length: 18 }, (_, i) => ({ url: `https://site${i}.com.br/a`, bruto: `O HyperX Cloud 3 tem drivers de 53 mm e conexão USB.` }));
      const entradas = [
        ...sites,
        topico('https://www.reddit.com/r/iems/comments/a/', 'iems', ['- [12 votos] Simgot EM6L is great for footsteps in PUBG.']),
        topico('https://www.reddit.com/r/FPS/comments/b/', 'FPS', ['- [3 votos] Vai de Simgot EM6L, imaging excelente.']),
        { url: 'https://guia.com.br/x', titulo: 'Melhores fones para jogos FPS', bruto: 'O Simgot EM6L aparece no guia.' },
      ];
      const validos = m.validarCandidatos(['HyperX Cloud 3', 'Simgot EM6L'], entradas);
      const r = m.rankearPorConsenso(validos, entradas, { termos });
      const hx = r.find((c) => c.nome === 'HyperX Cloud 3');
      const em = r.find((c) => c.nome === 'Simgot EM6L');
      return [
        r[0].nome === 'Simgot EM6L' || `ordem: ${r.map((c) => `${c.nome} ${c.pontos}`).join(' > ')}`,
        hx.consenso.editoriais === 18 && hx.consenso.editoriaisDoUso === 0 && hx.pontos === 0 || `HyperX: ${JSON.stringify(hx.consenso)} pontos ${hx.pontos}`,
        em.consenso.editoriaisDoUso === 1 || 'guia com título do uso conta como editorial do uso',
        m.consensoDe('Kappa L2', Array.from({ length: 10 }, (_, i) => ({ url: `https://g${i}.com/x`, titulo: 'Melhores fones para jogos FPS', bruto: 'O Kappa L2 está na lista.' })), {}, { termos }).pontos === 3 ||
          '10 sites do uso contam no máximo 3 pontos',
      ];
    },
  },

  {
    nome: 'ranking: headset citado com "earbuds" numa frase só continua headset (maioria); nome com "+ DAC" perde o acessório',
    tipo: 'unidade',
    executar() {
      const ent = (texto, url) => ({ texto, bruto: texto, url });
      const entradas = [
        ent('Headset HyperX Cloud 3 com fio. O HyperX Cloud 3 é um headset confortável.', 'https://a.com/1'),
        ent('HyperX Cloud 3 headset gamer em oferta.', 'https://b.com/2'),
        ent('Comparei o HyperX Cloud 3 com earbuds baratos.', 'https://c.com/3'),
        ent('Os melhores fones intra: KZ EDX Pro, Simgot EM6L e Truthear Hexa.', 'https://d.com/4'),
        ent('O fone intra KZ EDX Pro e o IEM Simgot EM6L. Truthear Hexa é um IEM.', 'https://e.com/5'),
      ];
      const validos = m.validarCandidatos(['HyperX Cloud 3', 'KZ EDX Pro', 'Simgot EM6L', 'Truthear Hexa'], entradas);
      const { fora } = m.filtrarPorCategoria(validos.map((x) => ({ ...x })), entradas, 'top 10 fones intra auriculares para pubg');
      const nomes = m.lerCandidatos('- Thrutear Zero Red + DAC Fosi K5\n- Simgot EM6L com cabo 4.4\n- Moondrop Chu 2');
      return [
        fora.includes('HyperX Cloud 3') || `HyperX Cloud 3 (3 frases de headset × 1 de earbuds) deveria sair: fora=${fora}`,
        JSON.stringify(nomes) === JSON.stringify(['Thrutear Zero Red', 'Simgot EM6L', 'Moondrop Chu 2']) || `nomes: ${JSON.stringify(nomes)}`,
      ];
    },
  },

  {
    nome: 'critérios pesados pela comunidade: discutido em 3+ tópicos sobe pra alto; peso alto que nenhum tópico discute desce; preço não desce',
    tipo: 'unidade',
    executar() {
      const achadas = [
        topico('https://www.reddit.com/r/iems/comments/a/', 'iems', ['- footsteps and imaging matter most']),
        topico('https://www.reddit.com/r/iems/comments/b/', 'iems', ['- soundstage and imaging for footsteps']),
        topico('https://www.reddit.com/r/iems/comments/c/', 'iems', ['- the imaging on this is great']),
        topico('https://www.reddit.com/r/iems/comments/d/', 'iems', ['- comfy for long sessions']),
      ];
      const crits = m.pesarCriteriosPelaComunidade(
        [
          { nome: 'microfone claro', peso: 'alto', termos: ['microfone', 'mic'] },
          { nome: 'preço', peso: 'alto', termos: ['preço', 'price'] },
          { nome: 'posicionamento dos sons', peso: 'medio', termos: ['imaging', 'soundstage', 'footsteps'] },
        ],
        achadas
      );
      const por = (n) => crits.find((k) => k.nome === n);
      return [
        por('posicionamento dos sons').peso === 'alto' && por('posicionamento dos sons').discutidoEm === 3 || JSON.stringify(por('posicionamento dos sons')),
        por('microfone claro').peso === 'medio' || 'microfone (ninguém discute) desce pra médio',
        por('preço').peso === 'alto' || 'preço não desce',
        crits[0].nome === 'posicionamento dos sons' || `ordem: ${crits.map((k) => k.nome)}`,
      ];
    },
  },

  {
    nome: 'ordem final pela evidência: critério de peso alto a favor pesa mais que número de sites; "sem atraso" é a favor',
    tipo: 'unidade',
    executar() {
      const celulas = {
        'A|posicionamento': { dominios: new Set(['x']), veredito: 'passos precisos' },
        'A|atraso': { dominios: new Set(['x']), veredito: 'com fio: sem atraso de transmissão' },
        'B|posicionamento': { dominios: new Set(['x']), veredito: 'palco exagerado, ruim para passos' },
        'B|conforto': { dominios: new Set(['x']), veredito: 'confortável' },
      };
      const matriz = { celula: (o, k) => celulas[`${o}|${k}`] };
      const criterios = [{ nome: 'posicionamento', peso: 'alto' }, { nome: 'atraso', peso: 'alto' }, { nome: 'conforto', peso: 'medio' }];
      const r = m.ordenarPorEvidencia(
        [
          { nome: 'B', dominios: Array(12).fill('s'), consenso: { pontos: 3 } },
          { nome: 'A', dominios: ['s'], consenso: { pontos: 2 } },
        ],
        matriz,
        criterios
      );
      return [
        r[0].nome === 'A' && r[0].positivosAltos === 2 || `ordem: ${JSON.stringify(r.map((f) => [f.nome, f.notaFinal, f.evidencia]))}`,
        // Etapa E: status — contraditório no alto (-0,5 × 2) + fonte única no médio (0,6 × 1) = -0,4
        r[1].evidencia === -0.4 || `B: posicionamento contraditório (-1) + conforto fonte única (+0,6) = -0,4, veio ${r[1].evidencia}`,
      ];
    },
  },

  {
    nome: 'comparação de nomeados (13º teste real): "diferença de desempenho entre a RTX 5070 Ti e a RTX 5080" entra no motor, com as duas opções do pedido',
    tipo: 'unidade',
    executar() {
      const pedido = 'Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?';
      return [
        m.ehPedidoDeRecomendacao(pedido) === true || 'deveria entrar no motor',
        JSON.stringify(m.produtosDaComparacao(pedido)) === JSON.stringify(['RTX 5070 Ti', 'RTX 5080']) || JSON.stringify(m.produtosDaComparacao(pedido)),
        m.produtosDaComparacao('melhores fones para pubg').length === 0 || 'sem dois nomes não é comparação',
        // revisão v3 (Fase 1, 03/10): antes este caso TRAVAVA o contrário ("gatilho
        // amplo; o motor desiste sozinho"). Agora o objeto decide: diferença
        // entre CONCEITOS é explicação e fica fora do motor de produto.
        m.ehPedidoDeRecomendacao('qual a diferença entre vírus e bactéria') === false || 'diferença entre conceitos não é pesquisa de produto',
        m.ehPedidoDeRecomendacao('qual a diferença entre o KZ EDX Pro e o Truthear Hexa') === true || 'diferença entre opções nomeadas continua no motor',
      ];
    },
  },

  {
    // Etapa F (revisão v2, 14º teste real): a comparação de desempenho tem
    // caminho próprio — números de jogos extraídos e calculados pelo código
    nome: 'comparação de desempenho (ponta a ponta): caminho próprio — sem cadeia/mapa/plano do 7B; benchmark de jogos extraído e calculado pelo código; ficha pelo código; Reddit do confronto',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'vs rtx 5080 benchmark', paginas: [pagina('Em Cyberpunk 2077 a 1440p, a RTX 5080 faz 120 FPS e a RTX 5070 Ti faz 104 FPS. Em Cyberpunk 2077 a 4K, a RTX 5080 faz 68 FPS e a RTX 5070 Ti faz 58 FPS.')] },
        { contem: 'site:reddit.com rtx 5070 ti vs rtx 5080', paginas: [pagina('Honestly the RTX 5070 Ti is the better value, the RTX 5080 is only 15% faster than the RTX 5070 Ti in games.')] },
        { contem: 'rtx 5070 ti especificacoes', paginas: [pagina('RTX 5070 Ti: 8960 CUDA cores, 16 GB GDDR7, 256-bit, TDP 300 W.')] },
        { contem: 'rtx 5080 especificacoes', paginas: [pagina('RTX 5080: 10752 CUDA cores, 16 GB GDDR7, 256-bit, TDP 360 W.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'comparação de placas',
          pedido: 'Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?',
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true },
          planoDePesquisa: 'USO: x\nCRITÉRIOS:\n- memória GDDR6X ou superior | alto | x\n- y | médio | y\nOPÇÕES CITADAS NO PEDIDO:\n- nenhuma\nBUSCAS DE DESCOBERTA:\n- placas de vídeo',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'comparação' } }],
          redacao: 'Resposta de teste.',
        });
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        const d = obtido.pesquisa.desempenho || {};
        return [
          srv.consultas.includes('rtx 5070 ti vs rtx 5080 benchmark 1440p 4k') || `confronto no uso real: ${srv.consultas.join(' | ')}`,
          srv.consultas.includes('site:reddit.com rtx 5070 ti vs rtx 5080') || 'confronto na comunidade',
          !srv.consultas.some((q) => /superior|placas de video|o que torna/.test(q)) || `busca fora do modo: ${srv.consultas.join(' | ')}`,
          obtido.chamadasPlanoDePesquisa === 0 && obtido.promptCadeia === '' && obtido.promptMapa === '' || 'modo desempenho não chama cadeia, mapa nem plano do 7B',
          /DESEMPENHO MEDIDO PELO CÓDIGO/.test(plano) && /mais rápida/.test(plano) || `bloco de desempenho: ${plano.slice(0, 600)}`,
          /\| Cyberpunk 2077 \| 1440p \| 104 \| 120 \| \+15,4% \|/.test(plano) || 'tabela de jogos calculada pelo código',
          d.geral?.mediana === 15.4 && d.geral?.n === 3 || `mediana geral: ${JSON.stringify(d.geral)}`,
          /\| núcleos CUDA \| 8960 \| 10752 \|/.test(plano) || 'ficha pelo código',
          /\(teste sintético\)/.test(plano) || 'regra do teste sintético',
          (obtido.registro.pesquisaPlanejada?.evidencias || []).some((e) => e.tipo === 'benchmark' && e.url) || 'benchmark no livro de evidências',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'pedido de recomendação não bifurca a interpretação (13º teste real: "top 10 intra pra PUBG" virou "qualidade sonora e clareza de áudio")',
    pedido: 'Quais os 5 melhores fones intra auriculares para jogar PUBG de PC?',
    config: { motorDePesquisa: true },
    ambiguidade:
      'suficiente\nQuais os 5 melhores fones intra auriculares para jogar PUBG de PC?\nBIFURCACAO: pesquisar qualidade sonora e clareza de áudio para música || comparar latência de conexões sem fio em consoles',
    criticaDeInterpretacao: 'ESCOLHA: A\nCONFIANCA: alta\nMOTIVO: x',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
    redacao: 'Resposta de teste.',
    espera: { ok: true, interpretacaoNaoBifurcada: true, promptDecisaoNaoContem: ['(especificamente:'] },
  },
];
