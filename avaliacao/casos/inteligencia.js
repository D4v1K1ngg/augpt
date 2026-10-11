'use strict';

const { fundir } = require('../../src/agent/destilador');
const { ordenarPorQualidade, qualidadeDoDominio } = require('../../src/tools/search');

module.exports = [
  {
    nome: 'lacunas do pedido chegam à decisão seguinte',
    pedido: 'Compare a inflação e o câmbio do Brasil em 2025',
    arquivos: { 'dados.txt': 'Relatório sobre a inflação brasileira no período analisado. '.repeat(20) },
    config: { destilarFatos: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'dados.txt' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'comparação' } },
    ],
    redacao: 'A inflação foi analisada; não há dados de câmbio.',
    espera: {
      ok: true,
      // o material fala de inflação mas não de câmbio: isso tem de aparecer
      promptDecisaoContem: ['AINDA SEM COBERTURA NO MATERIAL', 'cambio'],
    },
  },

  {
    nome: 'ações concluídas voltam como estado, não como resultado inteiro',
    pedido: 'Leia os dois arquivos',
    arquivos: { 'um.txt': 'primeiro', 'dois.txt': 'segundo' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'um.txt' } },
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'dois.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'os dois' } },
    ],
    redacao: 'Ambos foram lidos.',
    espera: {
      ok: true,
      promptDecisaoContem: ['JÁ FEITO: ler_arquivo(um.txt)'],
    },
  },

  {
    nome: 'cobertura boa avisa que dá para responder',
    pedido: 'Qual o valor do boleto?',
    arquivos: { 'boleto.txt': 'O valor do boleto é de R$ 410,49 com vencimento em 17/08/2026.' },
    config: { destilarFatos: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'O boleto é de R$ 410,49.',
    espera: { ok: true, promptDecisaoContem: ['MATERIAL SUFICIENTE'] },
  },

  {
    nome: 'fatos repetidos entre fontes viram uma linha com todas as fontes',
    tipo: 'unidade',
    executar() {
      const r = fundir([
        { origem: 'a', destilado: true, texto: '- [1] Máxima de 32°C na sexta\n- [1] Chuva de 30%\n- [2] Mínima de 21°C' },
        { origem: 'b', destilado: true, texto: '- [3] Máxima de 32°C na sexta\n- [3] Vento de 25 km/h' },
      ]);
      const bruto = fundir([{ origem: 'c', destilado: false, texto: 'texto cru que não foi destilado' }]);

      const maxima = r.fundidos.find((l) => l.includes('32°C'));
      return [
        r.fundidos.length === 4 || `esperava 4 fatos distintos, obteve ${r.fundidos.length}`,
        maxima?.includes('[1][3]') || `o fato repetido não juntou as fontes: ${maxima}`,
        r.fundidos[0].includes('[1][3]') || 'o mais corroborado não veio primeiro',
        bruto.soltos.length === 1 || 'material não destilado deveria passar inteiro',
        bruto.fundidos.length === 0 || 'tentou fundir material não destilado',
      ];
    },
  },

  {
    nome: 'subconsultas dividem o pedido sem chamar o modelo',
    tipo: 'unidade',
    executar() {
      const { subconsultas } = require('../../src/tools/search');
      const duas = subconsultas('inflação e câmbio do Brasil em 2025');
      const produtos = subconsultas('compare o iPhone 16 e o Galaxy S25');
      const simples = subconsultas('melhores IEMs para PUBG');
      const longa = subconsultas(
        'analise os indicadores de emprego, renda e produtividade da indústria brasileira no último triênio'
      );

      return [
        duas.length === 3 || `esperava original + 2 focadas, obteve ${duas.length}`,
        duas[0] === 'inflação e câmbio do Brasil em 2025' || 'a consulta original saiu da lista',
        duas.some((c) => c.includes('inflação') && c.includes('2025')) || 'a parte perdeu o contexto comum',
        duas.some((c) => c.startsWith('câmbio')) || 'não separou a segunda parte',
        produtos.some((c) => c.trim() === 'o iPhone 16') || `verbo não foi removido: ${produtos[1]}`,
        simples.length === 1 || 'dividiu pedido que não tem duas partes',
        longa.length === 1 || 'dividiu frase longa, onde a divisão vira ruído',
      ];
    },
  },

  {
    nome: 'cada parte do pedido é conferida na resposta',
    tipo: 'unidade',
    executar() {
      const v = require('../../src/agent/verificador');
      const pedido = 'Analise o boleto e me diga o valor, o vencimento e o que acontece se eu atrasar';
      const partes = v.decomporPedido(pedido);

      const incompleta = v.verificar({
        resposta: 'O boleto é de R$ 410,49 com vencimento em 17/08/2026.',
        dossie: [{ texto: 'valor R$ 410,49 vencimento 17/08/2026 multa de R$ 8,21 por atraso' }],
        objetivo: pedido,
      });
      const completa = v.verificar({
        resposta: 'O valor é R$ 410,49, vence em 17/08/2026 e, se atrasar, há multa de R$ 8,21.',
        dossie: [{ texto: 'valor R$ 410,49 vencimento 17/08/2026 multa de R$ 8,21 por atraso' }],
        objetivo: pedido,
      });

      return [
        partes.length === 3 || `decompôs em ${partes.length} partes`,
        incompleta.respondeAoPedido === false || 'aceitou resposta que ignora uma das partes',
        incompleta.partesNaoRespondidas.some((p) => /atrasar/.test(p)) || 'não apontou qual parte faltou',
        /deixou de fora/.test(v.instrucaoDeCorrecao(incompleta)) || 'a instrução não diz o que faltou',
        completa.respondeAoPedido === true || 'recusou resposta que cobre tudo',
      ];
    },
  },

  {
    nome: 'confiança sai do que foi medido, não de palpite',
    tipo: 'unidade',
    executar() {
      const { calcularConfianca } = require('../../src/agent/verificador');
      const boa = calcularConfianca({
        verificacao: { totalSuspeitas: 0, respondeAoPedido: true },
        cobertura: { nivel: 'boa' },
        cruzamento: { suficiente: true, dominios: 3, confirmados: [1, 2], divergencias: [] },
        fontes: 3,
      });
      const ruim = calcularConfianca({
        verificacao: { totalSuspeitas: 2, respondeAoPedido: true },
        cobertura: { nivel: 'ausente' },
        fontes: 1,
      });
      const divergente = calcularConfianca({
        verificacao: { totalSuspeitas: 0, respondeAoPedido: true },
        cobertura: { nivel: 'boa' },
        cruzamento: { suficiente: true, dominios: 3, confirmados: [1], divergencias: [{}] },
        fontes: 3,
      });

      return [
        boa.nivel === 'alta' || `material bom e corroborado deu confiança ${boa.nivel}`,
        ruim.nivel === 'baixa' || `sem material e com invenção deu confiança ${ruim.nivel}`,
        ruim.motivos.length >= 2 || 'não explicou por que a confiança é baixa',
        divergente.nivel !== 'alta' || 'divergência entre fontes não reduziu a confiança',
        divergente.motivos.some((m) => /diverg/.test(m)) || 'não citou a divergência como motivo',
      ];
    },
  },

  {
    nome: 'credibilidade rebaixa fonte fabricada sem escondê-la',
    tipo: 'unidade',
    executar() {
      const { qualidadeDoDominio, ordenarPorQualidade } = require('../../src/tools/search');
      const fabricado = qualidadeDoDominio('https://365usanews.com/x');
      const satira = qualidadeDoDominio('https://adobochronicles.com/x');
      const comum = qualidadeDoDominio('https://sitequalquer.com.br/x');
      const oficial = qualidadeDoDominio('https://www.ibge.gov.br/x');

      const ordem = ordenarPorQualidade([
        { titulo: 'fabricado', url: 'https://365usanews.com/a' },
        { titulo: 'oficial', url: 'https://ibge.gov.br/a' },
        { titulo: 'comum', url: 'https://algum.com.br/a' },
      ]).map((r) => r.titulo);

      // classificação de viés político não pode influenciar a ordem
      const tabela = require('../../dados/dominios.json');
      const temViés = Object.values(tabela.dominios).some((v) => /vies|político|politico|esquerda|direita/i.test(v.motivo));

      return [
        fabricado.peso < comum.peso || 'fonte fabricada não foi rebaixada',
        satira.tipo === 'sátira' || `sátira classificada como "${satira.tipo}"`,
        fabricado.alerta?.risco === 'alto' || 'não marcou o risco para levar ao material',
        oficial.peso > comum.peso || 'órgão oficial perdeu a prioridade',
        ordem[0] === 'oficial' && ordem[2] === 'fabricado' || `ordem inesperada: ${ordem.join(' > ')}`,
        !temViés || 'a tabela carrega classificação política — só fabricação deveria entrar',
        Object.keys(tabela.dominios).length > 300 || 'tabela pequena demais para ter valor',
      ];
    },
  },

  {
    nome: 'bases brasileiras: desinformação, veículo verificado e bloqueio',
    tipo: 'unidade',
    executar() {
      const { qualidadeDoDominio, estaBloqueado } = require('../../src/tools/search');

      const desinformacao = qualidadeDoDominio('https://diariodobrasil.org/x');
      const verificado = qualidadeDoDominio('https://g1.globo.com/x');
      const aposta = qualidadeDoDominio('https://00001bet.bet/x');
      const neutro = qualidadeDoDominio('https://umsitequalquer.com.br/x');
      const oficial = qualidadeDoDominio('https://www.ibge.gov.br/x');

      return [
        // o falso positivo que quase passou: "com.br" está na base de bloqueio
        !estaBloqueado('umsitequalquer.com.br') || 'sufixo público bloqueou site brasileiro comum',
        !estaBloqueado('g1.globo.com') || 'veículo legítimo marcado como bloqueado',
        neutro.peso === 3 || `site comum recebeu peso ${neutro.peso}`,
        desinformacao.peso < neutro.peso || 'portal de desinformação não foi rebaixado',
        /notícia falsa/.test(desinformacao.tipo) || `rótulo pouco informativo: ${desinformacao.tipo}`,
        verificado.peso > neutro.peso || 'veículo verificado no corpus não ganhou prioridade',
        aposta.peso < neutro.peso || 'domínio bloqueado não foi rebaixado',
        /bloqueado por ordem judicial/.test(aposta.tipo) || 'não explicou o motivo do rebaixamento',
        oficial.peso > verificado.peso || 'órgão oficial perdeu para imprensa',
      ];
    },
  },

  {
    // Skill "Pesquisa acadêmica" (2026-09-22): sem isto, arXiv/Semantic
    // Scholar/ACM/ScienceDirect/ResearchGate/DOI pontuavam igual a site
    // comum (peso 3, ou 5 pros que terminam em .org) — a skill podia
    // recomendar "prefira fonte acadêmica" que a ordenação de busca de
    // verdade não refletia isso.
    nome: 'periódico/repositório acadêmico pontua acima de site comum (arXiv, Semantic Scholar, ACM, ScienceDirect, ResearchGate, DOI)',
    tipo: 'unidade',
    executar() {
      const { qualidadeDoDominio } = require('../../src/tools/search');
      const neutro = qualidadeDoDominio('https://umsitequalquer.com.br/x');
      const dominios = [
        'https://arxiv.org/abs/1234.5678',
        'https://www.semanticscholar.org/paper/x',
        'https://dl.acm.org/doi/10.1145/x',
        'https://www.sciencedirect.com/science/article/x',
        'https://www.researchgate.net/publication/x',
        'https://doi.org/10.1000/x',
      ];
      const resultados = dominios.map((url) => [url, qualidadeDoDominio(url)]);
      return [
        ...resultados.map(
          ([url, q]) => q.peso > neutro.peso || `${url} não pontuou acima de site comum (peso ${q.peso})`
        ),
        resultados.every(([, q]) => q.tipo === 'periódico/repositório acadêmico') ||
          'algum domínio acadêmico não recebeu o rótulo esperado',
      ];
    },
  },

  {
    // O achado real testando isto: scholar.google.com caía na regra de
    // "buscador" (peso -5) só por ter "google." no domínio — mesmo sendo um
    // índice acadêmico, não um buscador genérico como o Google normal. A
    // regra nova precisa vir ANTES da de "buscador" pra ganhar a disputa.
    nome: 'scholar.google.com pontua como fonte acadêmica, não como "buscador" — google.com comum continua penalizado',
    tipo: 'unidade',
    executar() {
      const { qualidadeDoDominio } = require('../../src/tools/search');
      const scholar = qualidadeDoDominio('https://scholar.google.com/citations?x');
      const buscadorComum = qualidadeDoDominio('https://www.google.com/search?q=x');
      return [
        scholar.tipo === 'periódico/repositório acadêmico' || `scholar.google.com recebeu o rótulo "${scholar.tipo}"`,
        scholar.peso === 7 || `scholar.google.com deveria pontuar 7, pontuou ${scholar.peso}`,
        buscadorComum.tipo === 'buscador' || 'google.com comum não deveria virar fonte acadêmica',
        buscadorComum.peso === -5 || `google.com comum deveria continuar penalizado, pontuou ${buscadorComum.peso}`,
      ];
    },
  },

  {
    nome: 'marcação do usuário vence a base pública',
    tipo: 'unidade',
    executar() {
      const b = require('../../src/tools/search');
      b.definirPersonalizados([
        { dominio: 'meusite.com.br', risco: 'confiavel', motivo: 'fonte oficial do meu setor' },
        { dominio: 'diariodobrasil.org', risco: 'confiavel', motivo: 'eu confio neste' },
      ]);

      const meu = b.qualidadeDoDominio('https://meusite.com.br/x');
      const sobreposto = b.qualidadeDoDominio('https://diariodobrasil.org/x');
      const neutro = b.qualidadeDoDominio('https://outroqualquer.com.br/x');
      b.definirPersonalizados([]); // não deixa resíduo para os outros casos
      const voltou = b.qualidadeDoDominio('https://diariodobrasil.org/x');

      return [
        meu.peso > neutro.peso || 'domínio marcado como confiável não subiu',
        /fonte oficial do meu setor/.test(meu.tipo) || 'o motivo não aparece no rótulo',
        sobreposto.peso > neutro.peso || 'a marcação do usuário não venceu a base pública',
        voltou.peso < neutro.peso || 'a base pública não voltou a valer ao limpar as marcações',
      ];
    },
  },

  {
    nome: 'fontes ordenadas por tipo de domínio e recência',
    tipo: 'unidade',
    executar() {
      const ordem = ordenarPorQualidade(
        [
          { titulo: 'Blog', url: 'https://meublog.blogspot.com/2019/03/post' },
          { titulo: 'Notícia', url: 'https://g1.globo.com/economia/2026/08/materia' },
          { titulo: 'IBGE', url: 'https://www.ibge.gov.br/estatisticas/indice' },
          { titulo: 'Wikipedia', url: 'https://pt.wikipedia.org/wiki/Economia' },
        ],
        { preferirRecente: true }
      ).map((r) => r.titulo);

      return [
        ordem[0] === 'IBGE' || `o órgão oficial ficou em ${ordem.indexOf('IBGE') + 1}º`,
        ordem.indexOf('Blog') > ordem.indexOf('Notícia') || 'blog antigo passou na frente da imprensa',
        qualidadeDoDominio('https://x.gov.br/a').peso > qualidadeDoDominio('https://x.blogspot.com/a').peso ||
          'peso de domínio oficial não supera o de blog',
        qualidadeDoDominio('https://desconhecido.xyz/a').tipo === 'site' || 'domínio comum mal classificado',
      ];
    },
  },
];
