'use strict';

/**
 * Comparativo de desempenho — Etapa F da revisão v2 (2026-09-28, 14º teste
 * real). "Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX
 * 5080?": o agente leu 10 páginas de benchmark e nenhum FPS por jogo chegou
 * à resposta; o modelo disse "a diferença é mínima". Aqui o código extrai
 * "X% mais rápida" (convertendo a direção), pares de FPS e tabelas, e faz a
 * mediana — o modelo só explica.
 */

const c = require('../../src/agent/comparativo-de-desempenho');
const { produtosDoPedido } = require('../../src/agent/serie-de-precos');

const PEDIDO = 'Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?';
const PRODUTOS = produtosDoPedido(PEDIDO); // [RTX 5070 Ti, RTX 5080]
const extrair = (texto, url = 'https://exemplo.com/a') => c.extrairBenchmarks({ texto, url, produtos: PRODUTOS });
const um = (frase) => extrair(frase)[0]?.percentual;

// review em frases (inglês), com armadilhas: preço, RTX 5070 sem Ti, "30% faster than the RTX 5070"
const REVIEW_EN = [
  'RTX 5080 vs RTX 5070 Ti: gaming benchmarks',
  'The GeForce RTX 5080 has 10752 CUDA cores and 16 GB of GDDR7 on a 256-bit bus, while the RTX 5070 Ti has 8960 CUDA cores.',
  'The RTX 5080 costs $999, which is 33% more than the $749 RTX 5070 Ti.',
  'Across our 1440p suite, the RTX 5080 is 15% faster than the RTX 5070 Ti. At 4K, the RTX 5070 Ti is around 12% slower than the RTX 5080.',
  'Cyberpunk 2077 at 1440p: RTX 5070 Ti 98 FPS vs RTX 5080 113 FPS.',
  'For reference, the RTX 5080 is 45% faster than the RTX 5070 in Alan Wake 2.',
  'RTX 5070: 70 fps | RTX 5080: 113 fps',
  'In Hogwarts Legacy the RTX 5070 hits 70 fps, the RTX 5070 Ti 85 fps and the RTX 5080 97 fps.',
  'The RTX 5080 is 15% faster than the 5070 Ti and 30% faster than the RTX 5070.',
].join('\n');

// review em português, produto sem "RTX"
const REVIEW_PT = [
  'Desempenho em jogos',
  'A RTX 5080 é 15% mais rápida que a 5070 Ti na média geral.',
  'Em 4K, a 5070 Ti fica 13% atrás da 5080.',
  'No Cyberpunk 2077 em 4K, a 5070 Ti fez 62 fps e a 5080 chegou a 71 fps.',
  'O desempenho da RTX 5080 é 18% superior ao da 5070 Ti com ray tracing.',
  'A RTX 5080 custa 30% mais caro que a 5070 Ti.',
  'O consumo da RTX 5080 é 20% superior ao da 5070 Ti.',
  'A RTX 5080 chega a ser até 25% mais rápida que a 5070 Ti.',
].join('\n');

// tabela markdown com título de resolução + linha de ficha no meio
const TABELA_PIPE = [
  '## 1440p (rasterization)',
  '| Game | RTX 5070 Ti | RTX 5080 |',
  '|---|---:|---:|',
  '| Cyberpunk 2077 | 98 | 113 |',
  '| Hogwarts Legacy | 120 fps | 136 fps |',
  '| Starfield | 88 | 101 |',
  '| Memory | 16 | 16 |',
  '',
  'Next paragraph mentions 12 and 13 things.',
].join('\n');

// tabela por espaços com uma TERCEIRA coluna (RTX 5070) e outra por tab com a ordem invertida
const TABELA_ESPACO = [
  '4K Ultra',
  'Game  RTX 5070  RTX 5070 Ti  RTX 5080',
  'Alan Wake 2  30  38  44',
  'Black Myth Wukong  35  43  50',
  '',
  'Resultados em 1080p',
  'Jogo\tRTX 5080\tRTX 5070 Ti',
  'Counter-Strike 2\t412\t365',
].join('\n');

const SINTETICO = [
  '3DMark Time Spy: RTX 5070 Ti 24,500 points vs RTX 5080 28,200 points',
  'In 3DMark Speed Way the RTX 5080 is 17% faster than the RTX 5070 Ti.',
].join('\n');

const FICHA = [
  'NVIDIA GeForce RTX 5070 Ti',
  'CUDA Cores: 8960',
  'Memory Size 16 GB',
  'Memory Type GDDR7',
  'Memory Bus 256 bit',
  'Boost Clock 2452 MHz',
  'Total Graphics Power 300W',
  'Compared to the RTX 5080 (10752 CUDA cores), it is cheaper.',
].join('\n');

const json = (x) => JSON.stringify(x);

module.exports = [
  {
    nome: 'comparativo: direção do "X% mais rápida" convertida para "quanto B é mais rápido que A" (os quatro casos)',
    tipo: 'unidade',
    executar() {
      return [
        um('The RTX 5080 is 15% faster than the RTX 5070 Ti.') === 15 || `B mais rápido x%: ${um('The RTX 5080 is 15% faster than the RTX 5070 Ti.')}`,
        um('The RTX 5070 Ti is around 12% slower than the RTX 5080.') === 13.6 || `A mais lento 12% → +13,6: ${um('The RTX 5070 Ti is around 12% slower than the RTX 5080.')}`,
        um('The RTX 5070 Ti is 10% faster than the RTX 5080.') === -9.1 || `A mais rápido 10% → -9,1: ${um('The RTX 5070 Ti is 10% faster than the RTX 5080.')}`,
        um('The RTX 5080 is 8% slower than the RTX 5070 Ti.') === -8 || `B mais lento 8% → -8: ${um('The RTX 5080 is 8% slower than the RTX 5070 Ti.')}`,
        um('Against the RTX 5070 Ti, the 5080 leads by 14% on average.') === 14 || 'leads by (sujeito antes do verbo)',
        um('The RTX 5070 Ti trails the RTX 5080 by 12%.') === 13.6 || `trails ... by: ${um('The RTX 5070 Ti trails the RTX 5080 by 12%.')}`,
        um('a 5070 Ti fica 13% atrás da 5080') === 14.9 || `"fica 13% atrás": ${um('a 5070 Ti fica 13% atrás da 5080')}`,
      ];
    },
  },

  {
    nome: 'comparativo: review em inglês — pares de FPS, resolução da frase, e nada da RTX 5070 (sem Ti) nem de preço',
    tipo: 'unidade',
    executar() {
      const it = extrair(REVIEW_EN);
      const pares = it.filter((i) => i.tipo === 'par');
      const pcts = it.filter((i) => i.tipo === 'percentual');
      const cp = pares.find((i) => i.jogo === 'Cyberpunk 2077');
      const hog = pares.find((i) => i.jogo === 'Hogwarts Legacy');
      return [
        json(pcts.map((i) => [i.percentual, i.resolucao])) === json([[15, '1440p'], [13.6, '4K'], [15, null]]) ||
          `percentuais: ${json(pcts.map((i) => [i.percentual, i.resolucao, i.trecho]))}`,
        cp?.valorA === 98 && cp?.valorB === 113 && cp?.percentual === 15.3 && cp?.resolucao === '1440p' || `par Cyberpunk: ${json(cp)}`,
        hog?.valorA === 85 && hog?.valorB === 97 || `os 70 fps da RTX 5070 viraram 5070 Ti: ${json(hog)}`,
        !it.some((i) => i.valorA === 70 || i.valorB === 70) || 'número da RTX 5070 (sem Ti) entrou',
        !it.some((i) => /\b45%|33%/.test(i.trecho)) || 'frase de preço ou de outra placa virou resultado',
        it.every((i) => i.produtoA === 'RTX 5070 Ti' && i.produtoB === 'RTX 5080' && i.url === 'https://exemplo.com/a') || 'produtos/url no item',
        pares.length === 2 && pcts.length === 3 || `itens: ${it.length}`,
      ];
    },
  },

  {
    nome: 'comparativo: review em português, produto sem "RTX", RT; preço, consumo e "até X%" ficam fora',
    tipo: 'unidade',
    executar() {
      const it = extrair(REVIEW_PT, 'https://adrenaline.com.br/x');
      const rt = it.find((i) => i.percentual === 18);
      const par = it.find((i) => i.tipo === 'par');
      return [
        json(it.map((i) => i.percentual)) === json([15, 14.9, 14.5, 18]) || `percentuais: ${json(it.map((i) => [i.percentual, i.trecho]))}`,
        par?.jogo === 'Cyberpunk 2077' && par?.resolucao === '4K' && par?.valorA === 62 && par?.valorB === 71 || `par PT: ${json(par)}`,
        rt?.rt === true || `ray tracing: ${json(rt)}`,
        it[1]?.resolucao === '4K' || 'resolução "Em 4K"',
      ];
    },
  },

  {
    nome: 'comparativo: tabelas — pipe com título de resolução, espaços com coluna extra (RTX 5070), tab com ordem invertida',
    tipo: 'unidade',
    executar() {
      const pipe = extrair(TABELA_PIPE);
      const esp = extrair(TABELA_ESPACO);
      const aw = esp.find((i) => i.jogo === 'Alan Wake 2');
      const cs = esp.find((i) => i.jogo === 'Counter-Strike 2');
      return [
        json(pipe.map((i) => [i.jogo, i.valorA, i.valorB])) === json([['Cyberpunk 2077', 98, 113], ['Hogwarts Legacy', 120, 136], ['Starfield', 88, 101]]) ||
          `tabela pipe: ${json(pipe.map((i) => [i.jogo, i.valorA, i.valorB]))}`,
        pipe.every((i) => i.resolucao === '1440p' && i.rt === false) || 'resolução/raster do título da tabela',
        aw?.valorA === 38 && aw?.valorB === 44 && aw?.resolucao === '4K' || `coluna da RTX 5070 confundida: ${json(aw)}`,
        esp.some((i) => i.jogo === 'Black Myth: Wukong' && i.valorA === 43) || 'Black Myth',
        cs?.valorA === 365 && cs?.valorB === 412 && cs?.percentual === 12.9 && cs?.resolucao === '1080p' || `ordem das colunas no tab: ${json(cs)}`,
      ];
    },
  },

  {
    nome: 'comparativo: teste sintético (3DMark) é marcado e não entra na média de jogos',
    tipo: 'unidade',
    executar() {
      const it = extrair(SINTETICO, 'https://s.com').concat(extrair(TABELA_PIPE, 'https://p.com'));
      const ag = c.agregarBenchmarks(it, { produtoA: 'RTX 5070 Ti', produtoB: 'RTX 5080' });
      return [
        it.filter((i) => i.sintetico).length === 2 || `sintéticos: ${json(it.filter((i) => i.sintetico))}`,
        ag.sinteticos?.n === 2 && ag.sinteticos?.mediana === 16.1 || `sinteticos: ${json(ag.sinteticos)}`,
        ag.porResolucao.geral?.n === 3 && ag.fontes === 1 || `geral só com jogos: ${json(ag.porResolucao.geral)}`,
        !ag.jogos.some((j) => j.valorA === 24500) || 'pontuação do 3DMark na tabela de jogos',
      ];
    },
  },

  {
    nome: 'comparativo: agregação — mediana por resolução, geral com percentual sem resolução, fora da curva descartado',
    tipo: 'unidade',
    executar() {
      const item = (percentual, resolucao, url, extra = {}) => ({ tipo: 'percentual', percentual, resolucao, url, sintetico: false, ...extra });
      const itens = [
        item(14, '1440p', 'a'), item(15, '1440p', 'b'), item(16, '4K', 'a'), item(18, '4K', 'c'),
        item(15, null, 'd'), item(60, null, 'e'), item(15, null, 'd'), // repetido na mesma página: conta uma vez
        { tipo: 'par', percentual: 15.3, valorA: 98, valorB: 113, jogo: 'Cyberpunk 2077', resolucao: '1440p', url: 'b', sintetico: false },
      ];
      const ag = c.agregarBenchmarks(itens, { produtoA: 'RTX 5070 Ti', produtoB: 'RTX 5080' });
      const r = ag.porResolucao;
      return [
        ag.descartados === 1 && r.geral?.max === 18 || `o 60% deveria cair (3× MAD): ${json(r.geral)} descartados=${ag.descartados}`,
        r.geral?.n === 6 && r.geral?.mediana === 15.2 && r.geral?.fontes === 4 || `geral: ${json(r.geral)}`,
        r['1440p']?.n === 3 && r['1440p']?.mediana === 15 || `1440p: ${json(r['1440p'])}`,
        r['4K']?.mediana === 17 && r['4K']?.fontes === 2 || `4K: ${json(r['4K'])}`,
        r['1080p'] === null && ag.sinteticos === null || '1080p/sintético vazios devem ser null',
        ag.jogos.length === 1 && ag.jogos[0].jogo === 'Cyberpunk 2077' && ag.itens === 6 || `jogos: ${json(ag.jogos)}`,
        c.agregarBenchmarks([item(10, null, 'a'), item(12, null, 'b'), item(40, null, 'c')]).descartados === 0 || 'com menos de 5 resultados não descarta nada',
      ];
    },
  },

  {
    nome: 'comparativo: bloco pro redator — "mais rápida", vírgula decimal, linha da tabela, por resolução e método',
    tipo: 'unidade',
    executar() {
      const it = [...extrair(REVIEW_EN, 'https://a.com'), ...extrair(TABELA_PIPE, 'https://b.com'), ...extrair(SINTETICO, 'https://c.com')];
      const bloco = c.blocoDoComparativo(c.agregarBenchmarks(it, { produtoA: 'RTX 5070 Ti', produtoB: 'RTX 5080' }));
      const lento = c.blocoDoComparativo(
        c.agregarBenchmarks([{ tipo: 'percentual', percentual: -8.4, resolucao: null, url: 'x', sintetico: false }], { produtoA: 'RTX 5080', produtoB: 'RTX 5070 Ti' })
      );
      return [
        /^DESEMPENHO MEDIDO PELO CÓDIGO \(não recalcule; use estes números\):/.test(bloco) || `cabeçalho: ${bloco}`,
        /- Em jogos, a RTX 5080 é em média 14,9% mais rápida que a RTX 5070 Ti \(mediana de 8 resultados de 2 fontes; faixa 13,3% a 15,3%\)\./.test(bloco) || bloco,
        /\| Cyberpunk 2077 \| 1440p \| 98 \| 113 \| \+15,3% \|/.test(bloco) || 'linha do Cyberpunk na tabela',
        /1440p: \+15% \(5 resultados, 2 fontes\) · 4K: \+13,6% \(1 resultado, 1 fonte\)/.test(bloco) || 'linha por resolução',
        /Testes sintéticos \(3DMark etc\.\) — só como complemento: \+16,1%/.test(bloco) || 'linha do sintético',
        /MÉTODO: diferença = FPS da RTX 5080 ÷ FPS da RTX 5070 Ti − 1/.test(bloco) || 'método',
        !/Poucos resultados/.test(bloco) || 'aviso de poucos resultados com 8 resultados',
        /a RTX 5070 Ti é em média 8,4% mais lenta que a RTX 5080/.test(lento) && /Poucos resultados medidos/.test(lento) || lento,
        !/1080p:|1440p:|4K:/.test(lento) || 'só "geral": sem linha por resolução',
        c.blocoDoComparativo(c.agregarBenchmarks(extrair(SINTETICO))) === '' || 'só sintético → bloco vazio',
      ];
    },
  },

  {
    nome: 'comparativo: ehPedidoDeDesempenho distingue comparação de desempenho de histórico de preço e de produto único',
    tipo: 'unidade',
    executar() {
      const sim = [
        PEDIDO,
        'RTX 5070 Ti vs RTX 5080',
        '5070 Ti ou 5080, qual é mais rápida?',
        'quanto a RTX 5080 é mais rápida que a RTX 5070 Ti',
        'vale a pena trocar a RTX 4070 pela RTX 5080?',
        'comparar desempenho RTX 5070 Ti e RX 9070 XT',
      ];
      const nao = [
        'histórico de preço da RTX 5070 Ti e RTX 5080',
        'média de preço da RTX 5080 e 5070 Ti',
        'qual a diferença de preço entre a RTX 5070 Ti e a RTX 5080',
        'desempenho da RTX 5080 em 4K',
        'quais os melhores fones para FPS?',
      ];
      return [
        ...sim.map((q) => c.ehPedidoDeDesempenho(q) === true || `deveria ser pedido de desempenho: "${q}"`),
        ...nao.map((q) => c.ehPedidoDeDesempenho(q) === false || `não é pedido de desempenho: "${q}"`),
      ];
    },
  },

  {
    nome: 'comparativo: extrairFicha — CUDA, VRAM, tipo de memória, barramento, TDP e boost, perto da menção do produto',
    tipo: 'unidade',
    executar() {
      const ti = c.extrairFicha({ texto: FICHA, produto: PRODUTOS[0] });
      const x80 = c.extrairFicha({ texto: FICHA, produto: PRODUTOS[1] });
      const pt = c.extrairFicha({
        texto: 'A RTX 5080 tem 10.752 núcleos CUDA, 16 GB GDDR7, barramento de 256 bits, TDP de 360 W e boost de 2,62 GHz.',
        produto: 'RTX 5080',
      });
      return [
        json(ti) === json({ cuda: 8960, vram: 16, tipoMemoria: 'GDDR7', barramento: 256, tdp: 300, boostMhz: 2452 }) || `ficha 5070 Ti: ${json(ti)}`,
        x80.cuda === 10752 || `CUDA da 5080 perto da menção dela: ${json(x80)}`,
        json(pt) === json({ cuda: 10752, vram: 16, tipoMemoria: 'GDDR7', barramento: 256, tdp: 360, boostMhz: 2620 }) || `ficha PT: ${json(pt)}`,
        json(c.extrairFicha({ texto: 'Sem números de ficha aqui.', produto: PRODUTOS[0] })) === '{}' || 'nada → {}',
      ];
    },
  },

  {
    nome: 'comparativo: item vira evidência "benchmark" no livro de evidências',
    tipo: 'unidade',
    executar() {
      const { Evidencias } = require('../../src/agent/evidencias');
      const livro = new Evidencias();
      for (const i of extrair(REVIEW_EN, 'https://a.com')) livro.adicionar(c.paraEvidencia(i));
      const b = livro.porTipo('benchmark');
      const cp = b.find((e) => e.condicoes.jogo === 'Cyberpunk 2077');
      return [
        b.length === 5 || `evidências: ${b.length}`,
        cp?.valor === 98 && cp?.valorB === 113 && cp?.unidade === 'fps' && cp?.condicoes.resolucao === '1440p' || `evidência do par: ${json(cp)}`,
        b.every((e) => e.produtoA === 'RTX 5070 Ti' && e.produtoB === 'RTX 5080' && e.trecho) || 'produtos/trecho na evidência',
      ];
    },
  },
];
