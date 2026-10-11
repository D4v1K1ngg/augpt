'use strict';

/**
 * Motor de pesquisa (src/agent/motor-pesquisa.js, 2026-09-24): recomendação
 * e comparação viram pesquisa planejada — plano com critérios, descoberta de
 * opções conferida contra o material, busca por finalista, matriz opção ×
 * critério, busca de lacuna e plano da resposta pro redator.
 *
 * Os nomes de produto dos casos são inventados ("Alfa X1", "Beta Z2") de
 * propósito: o que se testa é o método, não o conhecimento de nenhum modelo.
 */

const m = require('../../src/agent/motor-pesquisa');
const { EventEmitter } = require('events');
const { selecionarParaRedacao, ehItemDeEntregaFinal } = require('../../src/agent/loop');
const prompts = require('../../src/agent/prompts');
const { Registro } = require('../../src/registro');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

const PLANO = `USO: jogar PUBG competitivo no PC, ouvindo passos e direção
CRITÉRIOS:
- posicionamento | alto | posicionamento, imaging
- conforto | médio | conforto, comfort
OPÇÕES CITADAS NO PEDIDO:
- nenhuma
BUSCAS DE DESCOBERTA:
- descoberta fones fps competitivo`;

/**
 * Sites falsos do cenário principal. Desde o 8º teste real (pesquisa POR
 * PRODUTO): descoberta (+ "site:" nas fontes da comunidade), e por finalista uma
 * busca de ficha técnica e uma do Reddit; depois as lacunas.
 */
const REGRAS = [
  // descoberta na comunidade vem antes: a consulta também contém "descoberta fones fps"
  {
    contem: 'site:reddit.com descoberta fones fps',
    paginas: [pagina('No subreddit, quem joga FPS repete: Alfa X1 para ouvir passos, Beta Z2 se quiser conforto.')],
  },
  {
    contem: 'descoberta fones fps',
    paginas: [
      pagina('Os mais recomendados para FPS são o Alfa X1 e o Beta Z2, segundo o teste de 2024.'),
      pagina('Para jogos competitivos, Alfa X1, Beta Z2 e Gama Q3 aparecem no topo da lista de 2024.'),
    ],
  },
  { contem: 'alfa x1 especificacoes tecnicas', paginas: [pagina('Ficha do Alfa X1: driver dinâmico de 10 mm, impedância de 32 ohms, conexão com fio P2. Custa 200 reais.')] },
  // tópico do Reddit: as frases não repetem o nome, mas a página é do Alfa X1
  {
    contem: 'site:reddit.com alfa x1',
    paginas: [pagina('Eu uso o Alfa X1 no PUBG faz um ano. O posicionamento dele é preciso nos passos. O conforto é bom em sessões longas, uso por horas sem dor.')],
  },
  // Bluetooth com cabo de carga: "cabo" não pode fazer o atraso dele ser deduzido como fone com fio
  { contem: 'beta z2 especificacoes tecnicas', paginas: [pagina('Beta Z2: driver de 8 mm, Bluetooth 5.3, bateria de 6 h por carga, cabo USB-C para carregar.')] },
  { contem: 'site:reddit.com beta z2', paginas: [pagina('Comprei o Beta Z2 e achei leve, com conforto excelente para jogar por horas.')] },
  { contem: 'gama q3 especificacoes tecnicas', paginas: [pagina('Gama Q3: driver de 12 mm e cabo de 1,2 m.')] },
  { contem: 'site:reddit.com gama q3', paginas: [pagina('Tenho o Gama Q3: achei leve e o conforto dele é mediano depois de duas horas.')] },
  // lacunas (posicionamento de quem não tem)
  { contem: 'beta z2 posicionamento', paginas: [pagina('No teste de 2024, o Beta Z2 mostrou posicionamento razoável dos passos.')] },
  { contem: 'gama q3 posicionamento', paginas: [pagina('O Gama Q3 tem posicionamento correto dos passos.')] },
];

const CONFIG = (porta, extra = {}) => ({
  searxngUrl: `http://127.0.0.1:${porta}`,
  permitirLeitorExterno: false,
  subconsultas: false,
  motorDePesquisa: true,
  ...extra,
});

const PEDIDO = 'Quais os melhores fones intra-auriculares para jogar PUBG no PC?';

const PERGUNTAR_MATERIAL_LIMITADO =
  '{"status":"perguntar","problema":"O material coletado parece ser limitado.","subtarefa":"","evidenciaFaltante":"","proximaEstrategia":"Pesquisar mais"}';

module.exports = [
  /* ------------------------------ unidades ------------------------------ */
  {
    nome: 'motor de pesquisa: detecta recomendação/comparação e deixa de fora "como fazer", "vale a pena" e busca de preço',
    tipo: 'unidade',
    executar() {
      const sim = [
        PEDIDO, 'Compare o Alfa X1 com o Beta Z2', 'me recomenda um mouse para FPS',
        'Qual notebook devo comprar para programar?', 'top 5 monitores para jogos', 'alternativas ao Photoshop',
      ];
      const nao = [
        'qual a melhor forma de estudar para a prova', 'vale a pena comprar o Alfa X1?', 'como melhorar minha mira',
        'procure os melhores preços da RTX 5080', 'Como funciona o sol?',
      ];
      return [
        ...sim.map((p) => m.ehPedidoDeRecomendacao(p) === true || `deveria entrar: "${p}"`),
        ...nao.map((p) => m.ehPedidoDeRecomendacao(p) === false || `não deveria entrar: "${p}"`),
      ];
    },
  },

  {
    nome: 'motor de pesquisa: lê o plano tolerando acento, maiúscula e numeração — e recusa plano com menos de 2 critérios',
    tipo: 'unidade',
    executar() {
      const texto = `Claro, aqui está:
uso: jogar competitivo
Criterios
1. posicionamento | ALTA | imaging, posicionamento
2. preço | baixo | preco, price
opcoes citadas no pedido:
- Nenhuma
buscas de descoberta:
- buscas de fones recomendados
- buscas de fones recomendados
- IEM reddit`;
      const p = m.lerPlanoDePesquisa(texto, 'pedido');
      return [
        p !== null || 'plano válido foi recusado',
        p?.uso === 'jogar competitivo' || `uso veio ${p?.uso}`,
        p?.criterios.length === 2 || `esperava 2 critérios, vieram ${p?.criterios.length}`,
        p?.criterios[0].peso === 'alto' && p?.criterios[1].peso === 'baixo' || 'peso não foi normalizado',
        p?.criterios[0].termos.includes('imaging') || 'termos do critério não foram lidos',
        p?.opcoesCitadas.length === 0 || '"Nenhuma" virou opção citada',
        // item que começa com "buscas" não pode ser confundido com cabeçalho; duplicata sai
        JSON.stringify(p?.descoberta) === JSON.stringify(['buscas de fones recomendados', 'IEM reddit']) ||
          `descoberta veio ${JSON.stringify(p?.descoberta)}`,
        m.lerPlanoDePesquisa('USO: x\nCRITÉRIOS:\n- só um | alto | a, b', 'p') === null || 'plano com 1 critério deveria ser recusado',
        m.lerPlanoDePesquisa('texto qualquer sem formato', 'p') === null || 'texto sem formato deveria ser recusado',
      ];
    },
  },

  {
    nome: 'motor de pesquisa: opção que o modelo inventou ou que é só palavra do pedido é descartada; o resto ordena por sites',
    tipo: 'unidade',
    executar() {
      const entradas = [
        { url: 'https://a.com/1', texto: '- Alfa X1 e Beta Z2 são os favoritos para PUBG.' },
        { url: 'https://b.com/2', texto: '- O X1 da Alfa lidera; Gama Q3 é alternativa.' },
        { url: 'https://c.com/3', texto: '- Alfa X1 de novo.' },
      ];
      const nomes = m.lerCandidatos('- **Alfa X1** — o melhor\n- Beta Z2 (custo-benefício)\n- Gama Q3: bom\n- Delta Inventado\n- PUBG');
      const v = m.validarCandidatos(nomes, entradas, { objetivo: 'melhores fones para PUBG' });
      const f = m.escolherFinalistas(v, 3);
      return [
        nomes.length === 5 || `lerCandidatos leu ${nomes.length} nomes`,
        JSON.stringify(v.map((c) => c.nome)) === JSON.stringify(['Alfa X1', 'Beta Z2', 'Gama Q3']) ||
          `validados: ${JSON.stringify(v.map((c) => c.nome))}`,
        v[0].dominios.length === 3 || '"X1 da Alfa" (mesmos tokens, outra ordem) deveria contar como "Alfa X1" (3 sites)',
        // nenhum outro com 2+ sites: completa até 3 com os de 1 site
        f.length === 3 || `esperava 3 finalistas, vieram ${f.length}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa: matriz por célula (opção × critério), com a frase seguinte à que nomeia a opção',
    tipo: 'unidade',
    executar() {
      const criterios = [
        { nome: 'posicionamento', peso: 'alto', termos: ['posicionamento', 'imaging'] },
        { nome: 'conforto', peso: 'medio', termos: ['conforto', 'comfort'] },
      ];
      const finalistas = [{ nome: 'Alfa X1', dominios: ['a.com'] }, { nome: 'Beta Z2', dominios: ['b.com'] }];
      const entradas = [
        { url: 'https://a.com/1', bruto: 'O Alfa X1 custa pouco para o que entrega. O posicionamento é preciso e o imaging é ótimo.' },
        { url: 'https://b.com/2', bruto: 'O Beta Z2 tem conforto excelente em sessões longas. Frase qualquer sobre outro assunto aqui.' },
        { url: 'https://c.com/3', bruto: 'Posicionamento importa muito em PUBG, mas este texto não cita nenhuma opção.' },
      ];
      const matriz = m.montarMatriz({ finalistas, criterios, entradas });
      const lacunas = m.consultasDeLacuna({ matriz, finalistas, criterios, maximo: 3 });
      const texto = m.planoDeResposta({ plano: { uso: 'PUBG', criterios }, finalistas, matriz });
      return [
        matriz.celula('Alfa X1', 'posicionamento').dominios.has('a.com') || 'frase seguinte à do nome não contou como evidência',
        matriz.celula('Beta Z2', 'conforto').dominios.has('b.com') || 'conforto do Beta Z2 não entrou',
        !matriz.celula('Beta Z2', 'posicionamento').dominios.size || 'frase genérica sem a opção virou evidência de célula',
        Math.abs(matriz.cobertura - 3 / 6) < 1e-9 || `cobertura ponderada veio ${matriz.cobertura}`,
        JSON.stringify(lacunas) === JSON.stringify(['Alfa X1 conforto', 'Beta Z2 posicionamento']) ||
          `lacunas: ${JSON.stringify(lacunas)}`,
        /Beta Z2:\n {2}- posicionamento: SEM EVIDÊNCIA/.test(texto) || 'plano da resposta não marcou a célula sem evidência',
        /UMA LINHA POR CRITÉRIO e UMA COLUNA POR OPÇÃO/.test(texto) || 'plano da resposta sem o formato da tabela',
        matriz.entradasUsadas.length === 2 || `esperava 2 leituras usadas, vieram ${matriz.entradasUsadas.length}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa: as leituras que deram evidência à matriz entram sempre no material do redator',
    tipo: 'unidade',
    executar() {
      const dossie = Array.from({ length: 20 }, (_, i) => ({ consulta: `busca ${i}`, origem: `site-${i}`, texto: `- fato ${i}`, fatos: 1 }));
      const semPrioridade = selecionarParaRedacao(dossie);
      const comPrioridade = selecionarParaRedacao(dossie, { prioritarias: [dossie[0], dossie[1]] });
      return [
        !semPrioridade.includes(dossie[0]) || 'premissa do teste: sem prioridade a 1ª leitura ficaria de fora',
        comPrioridade.includes(dossie[0]) && comPrioridade.includes(dossie[1]) || 'leitura prioritária ficou de fora',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (1º teste real): "Concluir a resposta..." conta como entrega final; passo de apuração não',
    tipo: 'unidade',
    executar() {
      return [
        ehItemDeEntregaFinal('Concluir a resposta com as informações restantes e recomendações') || '"Concluir a resposta" não foi reconhecido',
        ehItemDeEntregaFinal('Apresentar a resposta final ao usuário') || '"Apresentar a resposta" não foi reconhecido',
        ehItemDeEntregaFinal('Escrever a resposta consolidada') || 'caso antigo ("escrever a resposta") parou de funcionar',
        !ehItemDeEntregaFinal('Pesquisar o conforto dos finalistas') || 'passo de pesquisa virou entrega final',
        !ehItemDeEntregaFinal('Montar a lista de opções recomendadas') || 'montar lista (sem "resposta") virou entrega final',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (1º teste real): no prompt do redator, o plano vem depois do material e vale mais que o foco',
    tipo: 'unidade',
    executar() {
      const texto = prompts.pedidoDeResposta({
        objetivo: 'melhores fones', material: 'MATERIAL-X', foco: 'comparar só A e B', planoDeResposta: 'PLANO DA RESPOSTA (montado pela pesquisa planejada...)',
      });
      const sem = prompts.pedidoDeResposta({ objetivo: 'melhores fones', material: 'MATERIAL-X', foco: 'comparar só A e B' });
      return [
        texto.indexOf('PLANO DA RESPOSTA (montado') > texto.indexOf('MATERIAL-X') || 'plano antes do material',
        /SIGA O PLANO DA RESPOSTA ACIMA/.test(texto) || 'faltou a regra de precedência do plano',
        /vale mais que este resumo/.test(texto) || 'o foco não avisa que o plano tem precedência',
        !/SIGA O PLANO|vale mais que este resumo/.test(sem) || 'sem plano, o prompt não deveria mencionar plano',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (1º teste real): o registro da execução guarda plano, opções, matriz, consultas e o plano da resposta',
    tipo: 'unidade',
    executar() {
      const agente = new EventEmitter();
      const r = new Registro({ origem: 'app', modelo: 'x', host: 'x' }).acompanhar(agente);
      agente.emit('pesquisa-plano', { uso: 'PUBG no PC', criterios: [{ nome: 'posicionamento', peso: 'alto' }], opcoesCitadas: [], descoberta: ['q1'] });
      agente.emit('pesquisa-candidatos', { finalistas: [{ nome: 'Alfa X1', sites: 2 }], outros: ['Gama Q3'], propostos: 4, descartados: 1 });
      agente.emit('pesquisa-matriz', { cobertura: 0.5, lacunas: [{ candidato: 'Alfa X1', criterio: 'conforto' }], opcoes: ['Alfa X1'], criterios: ['posicionamento'] });
      agente.emit('pesquisa-fim', { ok: true, buscas: 3, consultas: ['q1', 'Alfa X1 posicionamento review'], planoDeResposta: 'PLANO...' });
      const p = r.dados.pesquisaPlanejada;
      return [
        p?.plano?.uso === 'PUBG no PC' || 'plano não registrado',
        p?.candidatos?.finalistas?.[0]?.nome === 'Alfa X1' || 'finalistas não registrados',
        p?.matriz?.cobertura === 0.5 || 'matriz não registrada',
        p?.consultas?.length === 2 && p?.planoDeResposta === 'PLANO...' || 'consultas/plano da resposta não registrados',
      ];
    },
  },

  /* ---------------- 2º teste real (2026-09-24): candidatos = 0 com fórum listando fones ---------------- */
  {
    nome: 'motor de pesquisa (2º teste real): destilação COM foco aceita resposta curta (uma lista de nomes); sem foco continua exigindo o mínimo',
    tipo: 'unidade',
    async executar() {
      const http = require('http');
      const { destilar } = require('../../src/agent/destilador');
      const srv = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: { content: '- Alfa X1 é o mais recomendado' }, prompt_eval_count: 1, eval_count: 1 }));
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const config = { host: `http://127.0.0.1:${srv.address().port}`, model: 'x', destilarFatos: true, destilarAcimaDe: 100, numCtx: 2048 };
      const texto = 'Vitrine com muitos produtos e menus. '.repeat(200);
      try {
        const comFoco = await destilar({ config, objetivo: 'melhores fones', foco: 'descobrir opções', origem: 'x', texto });
        const semFoco = await destilar({ config, objetivo: 'melhores fones', origem: 'x', texto });
        return [
          comFoco.destilado === true && /Alfa X1/.test(comFoco.texto) || 'com foco, a lista curta deveria ser aceita',
          semFoco.destilado === false || 'sem foco, 1 linha em 7 mil caracteres continua sendo destilação fraca',
        ];
      } finally {
        await new Promise((r) => srv.close(r));
      }
    },
  },

  {
    nome: 'motor de pesquisa (2º teste real): material dos candidatos sem "(nada relevante)", destiladas primeiro, e das cruas só linhas com nome de modelo',
    tipo: 'unidade',
    executar() {
      const ents = [
        // a destilação marca "NADA" como destilado:true — por isso ela viria primeiro sem o filtro
        { url: 'https://vitrine.com', destilado: true, texto: '(nada relevante ao pedido em vitrine.com)' },
        { url: 'https://forum.com', bruto: 'Menu Login Home Termos de uso. Eu uso o KZ ZSN Pro X e gosto muito dele.' },
        { url: 'https://guia.com', destilado: true, texto: '- Moondrop Chu 2 recomendado para jogos' },
      ];
      const mat = m.materialParaCandidatos(ents);
      return [
        !/vitrine\.com/.test(mat) || 'leitura "(nada relevante)" entrou no material',
        mat.indexOf('guia.com') < mat.indexOf('forum.com') || 'destilada deveria vir antes da crua',
        /KZ ZSN Pro X/.test(mat) || 'linha com nome de modelo da página crua ficou de fora',
        !/Menu Login Home/.test(mat) || 'menu da página crua entrou no material',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (2º teste real): sem nome do modelo, a segunda chance por padrão acha modelos citados em 2+ sites e ignora ruído',
    tipo: 'unidade',
    executar() {
      const ents = [
        { url: 'https://a.com', bruto: 'O Moondrop Chu 2 é ótimo. Eu uso o KZ ZSN Pro X. Guia Completo 2024. RTX 4060 no PC. Só aqui: Sony XYZ9.' },
        { url: 'https://b.com', bruto: 'Recomendo: Moondrop Chu 2. Testei o KZ ZSN Pro X no PUBG. Guia Completo 2024. RTX 4060.' },
      ];
      const nomes = m.candidatosPorPadrao(ents, { objetivo: 'melhores fones para PUBG' });
      return [
        nomes.includes('Moondrop Chu 2') && nomes.includes('KZ ZSN Pro X') || `faltou modelo: ${JSON.stringify(nomes)}`,
        !nomes.some((n) => /RTX|Guia|2024|PUBG/.test(n)) || `ruído virou opção: ${JSON.stringify(nomes)}`,
        !nomes.some((n) => /^O /.test(n)) || 'o "O" do início da frase grudou no nome',
        !nomes.some((n) => /XYZ9/.test(n)) || 'modelo citado por um site só não deveria entrar pela segunda chance',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (2º teste real): o plano não inventa orçamento e mantém o tipo de produto pedido',
    tipo: 'unidade',
    executar() {
      const t = prompts.pedidoDePlanoDePesquisa({ objetivo: 'melhores fones intra-auriculares para PUBG' });
      return [
        /Não acrescente condição que o pedido não disse — nem "sem fio", nem "com fio", nem orçamento/.test(t) || 'faltou a regra de não inventar orçamento/condição',
        // 8º teste real: o exemplo da regra dizia "sem fio" e o 7B copiou pro uso
        !/\(ex\.: [^)]*"sem fio"[^)]*\)/.test(t) || 'o exemplo de condição a manter não pode citar "sem fio"',
        /mantém o tipo de produto/.test(t) || 'faltou a regra de manter o tipo de produto',
        /pedido: "qual o melhor notebook até 5 mil/.test(t) || 'o exemplo não mostra de onde veio o orçamento dele',
      ];
    },
  },

  /* ------------------------------ ponta a ponta ------------------------------ */
  {
    nome: 'motor de pesquisa (ponta a ponta): plano → descoberta → finalistas → lacuna → matriz completa → plano da resposta no redator',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor de pesquisa ponta a ponta',
          pedido: PEDIDO,
          config: CONFIG(srv.porta, { nivelRaciocinio: 'medio', pipelineForcadoUniversal: true }),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2\n- Gama Q3\n- Delta Inventado',
          // se o checklist operacional rodasse, teria estes passos
          planejamentoInicial: '- pesquisar fones\n- comparar\n- responder',
          // 1º teste real (2026-09-24): o modelo declarou este item e o gate
          // de checklist barrou responder 3 vezes com a pesquisa já pronta
          roteiro: [{
            ferramenta: 'responder',
            plano: ['Concluir a resposta com as informações restantes e recomendações'],
            argumentos: { foco: 'recomendação de fones' },
          }],
          redacao: 'Resposta de teste.',
        });
        const p = obtido.pesquisa;
        const iMaterial = obtido.promptRedacao.lastIndexOf('MATERIAL COLETADO');
        const iPlano = obtido.promptRedacao.lastIndexOf('PLANO DA RESPOSTA (montado');
        const buscas = obtido.ferramentasChamadas.filter((f) => f === 'pesquisar_e_ler').length;
        return [
          obtido.ok || `execução falhou: ${JSON.stringify(obtido.erros)}`,
          obtido.chamadasPlanoDePesquisa === 1 || `plano de pesquisa chamado ${obtido.chamadasPlanoDePesquisa}x`,
          // 2 citados em 2 sites; o Gama Q3 (1 site) completa os 3 (7º teste real)
          JSON.stringify(p.candidatos?.finalistas?.map((f) => f.nome)) === JSON.stringify(['Alfa X1', 'Beta Z2', 'Gama Q3']) ||
            `finalistas: ${JSON.stringify(p.candidatos?.finalistas)}`,
          p.candidatos?.descartados === 1 || 'o nome inventado (Delta Inventado) não foi descartado',
          // Etapa C (14º teste real): 1 descoberta + a bateria da comunidade
          // montada pelo código (nível médio: 4 na 1ª leva) + 3 na 2ª rodada
          // (3 nomes < mínimo 6 → o resto da bateria) + 3 finalistas × (ficha
          // + reddit) + 2 lacunas
          buscas === 16 || `esperava 16 buscas do motor, houve ${buscas}: ${srv.consultas.join(' | ')}`,
          p.candidatos?.segundaRodada === 3 && srv.consultas.includes('site:reddit.com r/pubattlegrounds best iem') ||
            'com poucos nomes, deveria haver uma segunda rodada com o resto da bateria da comunidade',
          ['site:reddit.com best iem for pubg', 'site:clubedohardware.com.br fone intra auricular pubg fps', 'site:forum.adrenaline.com.br fone intra auricular pubg fps'].every((q) => srv.consultas.includes(q)) ||
            'faltou a descoberta nas fontes da comunidade (bateria)',
          ['alfa x1', 'beta z2', 'gama q3'].every((n) => srv.consultas.includes(`${n} especificacoes tecnicas`) && srv.consultas.includes(`site:reddit.com ${n}`)) ||
            `cada finalista deveria ter busca de ficha técnica e de reddit: ${srv.consultas.join(' | ')}`,
          p.matriz?.cobertura === 1 || `cobertura final ${p.matriz?.cobertura} (a lacuna não foi preenchida)`,
          obtido.chamadasPlanejamento === 0 || 'o checklist operacional rodou mesmo com o motor completo',
          /PESQUISA PLANEJADA CONCLUÍDA/.test(obtido.promptDecisao) || 'o modelo de decisão não soube que a pesquisa foi feita',
          /PLANO DA RESPOSTA \(montado pela pesquisa/.test(obtido.promptRedacao) || 'o plano da resposta não chegou ao redator',
          /posicionamento dele é preciso/.test(obtido.promptRedacao) || 'a evidência da célula não chegou ao redator',
          iPlano > iMaterial || 'o plano da resposta deveria vir DEPOIS do material (última coisa antes de escrever)',
          !obtido.copiloto.some((c) => c.gate === 'checklist-pendente') ||
            'o item "Concluir a resposta..." barrou responder com a pesquisa pronta',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (ponta a ponta): opções citadas pelo usuário pulam a descoberta; as buscas do motor contam no teto de buscas soltas',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor de pesquisa com opções do usuário',
          pedido: 'Compare o Alfa X1 com o Beta Z2 para jogar PUBG',
          // profundidade média = teto de 6 buscas soltas (a bancada não deriva do nível sozinha)
          config: CONFIG(srv.porta, { profundidadePesquisa: 'media' }),
          planoDePesquisa: PLANO.replace('- nenhuma', '- Alfa X1\n- Beta Z2'),
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'mais uma busca solta' } },
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'outra busca solta diferente' } },
            { ferramenta: 'responder', argumentos: { foco: 'comparação' } },
          ],
          redacao: 'Resposta de teste.',
        });
        return [
          obtido.promptCandidatos === '' || 'com as opções dadas pelo usuário, não precisava perguntar os candidatos',
          !srv.consultas.some((q) => q.includes('descoberta')) || 'rodou busca de descoberta sem precisar',
          // teto 6; o motor fez 7 (confronto "A vs B" + "site:reddit A vs B" desde 2026-09-28,
          // 2 finalistas × ficha + reddit, + 1 lacuna) → o teto já estourou, nenhuma solta passa
          obtido.ferramentasChamadas.filter((f) => f === 'pesquisar_e_ler').length === 7 ||
            `esperava 7 do motor e nenhuma solta, houve ${obtido.ferramentasChamadas.filter((f) => f === 'pesquisar_e_ler').length}: ${srv.consultas.join(' | ')}`,
          srv.consultas.some((q) => q === 'alfa x1 vs beta z2 benchmark jogos fps 1440p 4k') && srv.consultas.includes('site:reddit.com alfa x1 vs beta z2') ||
            'comparação de nomeados deveria buscar o confronto direto',
          obtido.copiloto.some((c) => c.gate === 'teto-de-buscas') || 'a 2ª busca solta deveria ter sido barrada pelo teto',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa: desligado nos Ajustes, pedido que não é recomendação ou plano ilegível → caminho de sempre',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      const base = { roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'x' } }], redacao: 'Resposta.', planoDePesquisa: PLANO };
      try {
        const desligado = await executarCasoAgente({ ...base, nome: 'motor desligado', pedido: PEDIDO, config: CONFIG(srv.porta, { motorDePesquisa: false }) });
        const naoE = await executarCasoAgente({ ...base, nome: 'motor: não é recomendação', pedido: 'Como funciona o sol?', config: CONFIG(srv.porta) });
        const ilegivel = await executarCasoAgente({
          ...base,
          nome: 'motor: plano ilegível',
          pedido: PEDIDO,
          planoDePesquisa: 'não entendi o pedido',
          planejamentoInicial: '- pesquisar\n- responder',
          config: CONFIG(srv.porta, { nivelRaciocinio: 'medio', pipelineForcadoUniversal: true }),
        });
        return [
          desligado.chamadasPlanoDePesquisa === 0 || 'motor rodou mesmo desligado nos Ajustes',
          naoE.chamadasPlanoDePesquisa === 0 || 'motor rodou num pedido que não é recomendação',
          ilegivel.chamadasPlanoDePesquisa === 1 || 'plano deveria ter sido pedido uma vez',
          !ilegivel.ferramentasChamadas.includes('pesquisar_e_ler') || 'com plano ilegível o motor não deveria buscar nada',
          ilegivel.chamadasPlanejamento === 1 || 'com o motor sem plano, o checklist operacional deveria rodar como antes',
          !/PLANO DA RESPOSTA \(montado pela pesquisa/.test(ilegivel.promptRedacao) || 'plano da resposta apareceu sem pesquisa planejada',
          ilegivel.ok || `execução com plano ilegível falhou: ${JSON.stringify(ilegivel.erros)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'motor de pesquisa (2º teste real, ponta a ponta): modelo responde NENHUMA mas o material cita modelos em 2 sites → segunda chance acha os finalistas',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: candidatos por padrão',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: 'NENHUMA',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const c = obtido.pesquisa.candidatos;
        return [
          c?.origem === 'padrao' || `origem dos nomes veio ${c?.origem}`,
          JSON.stringify(c?.finalistas?.map((f) => f.nome)) === JSON.stringify(['Alfa X1', 'Beta Z2']) ||
            `finalistas: ${JSON.stringify(c?.finalistas)}`,
          obtido.pesquisa.fim?.ok === true || 'o motor deveria ter completado com a segunda chance',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (2º teste real, ponta a ponta): a chamada de candidatos recebe só as linhas com nome de modelo, não o texto cru da página',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: material limpo pros candidatos',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          // simula o modelo pequeno que desiste diante de texto de página cru
          candidatosDePesquisa: (prompt) => (/Contexto suficiente para o extrator/.test(prompt) ? 'NENHUMA' : '- Alfa X1\n- Beta Z2'),
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        return [
          obtido.pesquisa.candidatos?.origem === 'modelo' || `o modelo não achou os nomes (origem ${obtido.pesquisa.candidatos?.origem})`,
          /Alfa X1/.test(obtido.promptCandidatos) || 'o nome do modelo sumiu do material',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (2º teste real, ponta a ponta): sem opção nenhuma, o agente recebe uso + critérios e o checklist genérico não roda',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([{ contem: 'descoberta', paginas: [pagina('Guia genérico sobre áudio, sem citar modelo nenhum de fone.')] }]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: sem opções',
          pedido: PEDIDO,
          config: CONFIG(srv.porta, { nivelRaciocinio: 'medio', pipelineForcadoUniversal: true }),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: 'NENHUMA',
          planejamentoInicial: '- pesquisar\n- comparar\n- verificar requisitos\n- responder',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        return [
          obtido.pesquisa.fim?.ok === false || 'premissa: o motor não deveria completar sem opções',
          obtido.chamadasPlanejamento === 0 || 'com plano de pesquisa, o checklist genérico não deveria rodar',
          /Critérios: posicionamento, conforto/.test(obtido.promptDecisao) || 'o agente não recebeu os critérios do plano',
          /NOMES DE MODELO/.test(obtido.promptDecisao) || 'o agente não recebeu o próximo passo (descobrir nomes de modelo)',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  /* ---------------- 3º e 4º testes reais (2026-09-24) ---------------- */
  {
    nome: 'motor de pesquisa (4º teste real, ponta a ponta): modelo lista 1 opção só, a segunda chance completa com as outras citadas em 2+ sites',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: complemento dos candidatos',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const c = obtido.pesquisa.candidatos;
        return [
          c?.origem === 'modelo+padrao' || `origem veio ${c?.origem}`,
          JSON.stringify(c?.finalistas?.map((f) => f.nome)) === JSON.stringify(['Alfa X1', 'Beta Z2']) ||
            `finalistas: ${JSON.stringify(c?.finalistas)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (4º teste real): destilação que responde "não há informação" vira "nada relevante"; a fraca mostra no aviso o que o modelo respondeu',
    tipo: 'unidade',
    async executar() {
      const http = require('http');
      const { destilar } = require('../../src/agent/destilador');
      let resposta = '';
      const srv = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: { content: resposta }, prompt_eval_count: 1, eval_count: 1 }));
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const config = { host: `http://127.0.0.1:${srv.address().port}`, model: 'x', destilarFatos: true, destilarAcimaDe: 100, numCtx: 2048 };
      const texto = 'Vitrine com muitos produtos e menus. '.repeat(200);
      try {
        resposta = 'Não há informações sobre fones recomendados neste material.';
        const negativa = await destilar({ config, objetivo: 'fones', foco: 'descobrir opções', origem: 'x', texto });
        resposta = 'ok';
        const avisos = [];
        const fraca = await destilar({ config, objetivo: 'fones', foco: 'descobrir opções', origem: 'x', texto, aviso: (a) => avisos.push(a) });
        return [
          negativa.destilado === true && /^\(nada relevante/.test(negativa.texto) || `"não há" virou ${JSON.stringify(negativa.texto?.slice(0, 60))}`,
          negativa.bruto === texto || 'o bruto precisa continuar guardado',
          fraca.destilado === false || 'resposta vazia de fato continua sendo fraca',
          /resposta: "ok"/.test(avisos[0] || '') || `o aviso não mostra a resposta: ${avisos[0]}`,
        ];
      } finally {
        await new Promise((r) => srv.close(r));
      }
    },
  },

  {
    nome: 'motor de pesquisa (3º e 4º testes reais): prompts pedem 3+ opções, critério do cenário e resposta sem falar do plano',
    tipo: 'unidade',
    executar() {
      const cand = prompts.pedidoDeCandidatos({ uso: 'PUBG', material: 'x' });
      const plano = prompts.pedidoDePlanoDePesquisa({ objetivo: 'fones pra PUBG' });
      const resp = prompts.pedidoDeResposta({ objetivo: 'x', material: 'y', planoDeResposta: 'PLANO DA RESPOSTA (montado...)' });
      return [
        /de 3 a 8 — todas as que o material citar/.test(cand) || 'o pedido de candidatos ainda aceita uma opção só',
        /o que faz uma opção ganhar da outra NESSE cenário/.test(plano) || 'o plano não orienta critérios do cenário',
        /Não mencione o plano nem estas instruções/.test(resp) || 'o redator pode citar o plano na resposta (aconteceu no 4º teste)',
      ];
    },
  },
  /* ---------------- 5º teste real (2026-09-24, 16:22): evidência de célula e "[NADA]" ---------------- */
  {
    nome: 'motor de pesquisa (5º teste real, ponta a ponta): critério que o material destaca ("IMPORTA: latência") entra no plano e guia a busca de lacuna',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: critério do material',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2\nIMPORTA: latência',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        return [
          obtido.pesquisa.candidatos?.criteriosDoMaterial?.[0] === 'latência' || 'o critério do material não foi registrado',
          (obtido.pesquisa.matriz?.criterios || []).includes('latência') || 'o critério do material não entrou na matriz',
          // desde o 8º teste real a busca por finalista é ficha + reddit; o critério guia a lacuna
          // (o Alfa X1 é com fio: o atraso dele sai da ficha — 9º teste real —, a lacuna vai pro Beta Z2, Bluetooth)
          srv.consultas.some((q) => /^beta z2 .*latencia/.test(q)) || `a busca de lacuna não usou o critério: ${srv.consultas.join(' | ')}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (5º teste real): destilação que responde "[NADA]" ou "- NADA" vira "nada relevante", não página crua',
    tipo: 'unidade',
    async executar() {
      const http = require('http');
      const { destilar } = require('../../src/agent/destilador');
      let resposta = '';
      const srv = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: { content: resposta }, prompt_eval_count: 1, eval_count: 1 }));
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const config = { host: `http://127.0.0.1:${srv.address().port}`, model: 'x', destilarFatos: true, destilarAcimaDe: 100, numCtx: 2048 };
      const texto = 'Vitrine com muitos produtos e menus. '.repeat(200);
      try {
        const saidas = [];
        for (const r of ['[NADA]', '- NADA', 'NADA']) {
          resposta = r;
          saidas.push(await destilar({ config, objetivo: 'fones', foco: 'x', origem: 'x', texto }));
        }
        return saidas.map((d, i) => (d.destilado === true && /^\(nada relevante/.test(d.texto)) || `resposta ${['[NADA]', '- NADA', 'NADA'][i]} não virou "nada relevante"`);
      } finally {
        await new Promise((r) => srv.close(r));
      }
    },
  },

  {
    nome: 'motor de pesquisa (5º teste real): "IMPORTA:" traz até 2 critérios que o material destaca, sem repetir, e não vira opção',
    tipo: 'unidade',
    executar() {
      const atuais = [{ nome: 'posicionamento', peso: 'alto', termos: ['posicionamento'] }, { nome: 'conforto', peso: 'medio', termos: ['conforto'] }];
      // "palco sonoro" é o mesmo critério que "posicionamento" desde 2026-09-28 (sinônimos)
      const resposta = '- Alfa X1\n- Beta Z2\nIMPORTA: latência, conforto nas orelhas, palco sonoro, isolamento acústico';
      const novos = m.lerCriteriosDoMaterial(resposta, atuais);
      return [
        JSON.stringify(novos.map((k) => k.nome)) === JSON.stringify(['latência', 'isolamento acústico']) || `critérios novos: ${JSON.stringify(novos.map((k) => k.nome))}`,
        // peso médio desde o 9º teste real (o alto passava na frente do "atraso" do plano nas lacunas)
        novos.every((k) => k.peso === 'medio') || 'critério destacado pelo material deveria entrar com peso médio',
        !m.lerCandidatos(resposta).some((n) => /importa/i.test(n)) || 'a linha IMPORTA virou opção',
        m.lerCriteriosDoMaterial('- Alfa X1', atuais).length === 0 || 'sem linha IMPORTA não deveria criar critério',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (5º teste real): julgamento lê "critério: veredito (n)", aceita "sem dados" e recusa número de trecho de outro critério',
    tipo: 'unidade',
    executar() {
      const criterios = [{ nome: 'atraso do som', peso: 'alto' }, { nome: 'conforto', peso: 'medio' }, { nome: 'preço', peso: 'medio' }];
      const numeracao = new Map([[1, 'atraso do som'], [2, 'conforto'], [3, 'preço']]);
      const v = m.lerJulgamento(
        '- Atraso do som: sem dados\n**conforto**: confortável em sessões longas (2)\npreço: barato (1)\nbateria: dura muito (3)',
        criterios,
        numeracao
      );
      return [
        v.get('atraso do som') === null || 'sem dados deveria virar null',
        v.get('conforto') === 'confortável em sessões longas' || `conforto veio ${JSON.stringify(v.get('conforto'))}`,
        v.get('preço') === null || 'número de trecho de outro critério deveria invalidar o veredito',
        !v.has('bateria') || 'critério que não existe no plano não deveria entrar',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (5º teste real, ponta a ponta): célula que o julgamento diz "sem dados" sai da tabela; o redator recebe o veredito, não o trecho cru',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: julgamento das células',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          julgamentoDePesquisa: (prompt) =>
            /OPÇÃO: Alfa X1/.test(prompt)
              ? 'posicionamento: VEREDITO-ALFA preciso nos passos (1)\nconforto: sem dados'
              : 'posicionamento: VEREDITO-BETA razoável (1)\nconforto: VEREDITO-BETA excelente por horas (2)',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const p = obtido.pesquisa;
        const plano = p.fim?.planoDeResposta || '';
        return [
          // desde o 9º teste real: juiz → lacuna → juiz de novo (2 finalistas × 2)
          obtido.chamadasJulgamento === 4 || `esperava 2 julgamentos por finalista (4), houve ${obtido.chamadasJulgamento}`,
          /VEREDITO-ALFA preciso nos passos/.test(obtido.promptRedacao) || 'o veredito não chegou ao redator',
          /Alfa X1:[\s\S]*conforto: SEM EVIDÊNCIA/.test(plano) || 'a célula julgada "sem dados" continuou como evidência',
          (p.matriz?.descartadas || []).some((d) => d.candidato === 'Alfa X1' && d.criterio === 'conforto') || 'descarte não registrado',
          p.matriz?.cobertura < p.matriz?.coberturaTextual || 'a cobertura deveria cair depois do julgamento',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'motor de pesquisa (5º teste real, ponta a ponta): página lida pra investigar uma opção e que nem cita essa opção não vai pra destilação',
    tipo: 'unidade',
    async executar() {
      const longo = (t) => `${t} ${Array.from({ length: 40 }, (_, i) => `Frase ${i + 1} de contexto diferente, rodada ${i + 11}.`).join(' ')}`;
      const srv = await buscaFalsa([
        { contem: 'descoberta', paginas: [pagina(longo('Os melhores: Alfa X1 e Beta Z2.')), pagina(longo('Recomendo Alfa X1 e Beta Z2.'))] },
        { contem: 'alfa x1 especificacoes', paginas: [pagina(longo('Página genérica sobre fones, sem citar modelo nenhum.'))] },
        { contem: 'beta z2 especificacoes', paginas: [pagina(longo('O Beta Z2 tem driver de 8 mm e posicionamento preciso.'))] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: pula destilação sem a opção',
          pedido: PEDIDO,
          config: CONFIG(srv.porta, { destilarFatos: true }),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        return [
          !/Alfa X1: especificações técnicas/.test(obtido.promptDestilacao) || 'a página que não cita o Alfa X1 foi destilada mesmo assim',
          /Beta Z2: especificações técnicas/.test(obtido.promptDestilacao) || 'a página que cita o Beta Z2 deveria ter sido destilada',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- 6º teste real (2026-09-25) ---------------- */
  {
    nome: 'motor de pesquisa (6º teste real): o padrão recusa título de vitrine ("FONE DE OUVIDO INTRA AURICULAR", "CABO 1", "JBL O Fone", "JBL Fone") e mantém nome de modelo',
    tipo: 'unidade',
    executar() {
      // strings copiadas da execução real muh3digf-l3d1, que viraram finalistas
      const vitrine =
        'FONE DE OUVIDO INTRA AURICULAR GAMER COM MICROFONE CABO 1 JBL O Fone JBL Fone JBL Som. WAAW O Fone. ' +
        'Recomendo KZ ZSN PRO 2, o QKZ AK6, o JBL Quantum 50N e o HyperX Cloud Earbuds II. Guia Completo 2024. ' +
        // título em maiúsculas que junta dois produtos, e anúncio genérico com sigla de categoria
        'TOP 2: KZ ZSN PRO 2 E QKZ AK6. HEADSET GAMER HYPERX CLOUD. Promoção relâmpago: Ultra Bass TWS por R$ 39.';
      const ents = [
        { url: 'https://loja-a.com/x', bruto: vitrine },
        { url: 'https://loja-b.com/y', bruto: vitrine },
      ];
      const nomes = m.candidatosPorPadrao(ents, { objetivo: PEDIDO });
      const lixo = ['FONE DE OUVIDO INTRA AURICULAR', 'FONE DE OUVIDO INTRA', 'FONE DE OUVIDO', 'CABO 1', 'JBL O Fone', 'JBL Fone', 'JBL Som', 'WAAW O Fone'];
      return [
        ...lixo.map((l) => !nomes.some((n) => n.toLowerCase().startsWith(l.toLowerCase())) || `"${l}" virou candidato: ${JSON.stringify(nomes)}`),
        ...['KZ ZSN PRO 2', 'QKZ AK6', 'JBL Quantum 50N', 'HyperX Cloud Earbuds II'].map((n) => nomes.includes(n) || `"${n}" deveria ser candidato: ${JSON.stringify(nomes)}`),
        !nomes.some((n) => / E( |$)/.test(n)) || `dois produtos grudados num nome só: ${JSON.stringify(nomes)}`,
        !nomes.some((n) => /^(FONE|HEADSET|GAMER|CABO)\b/i.test(n)) || `nome começando pela categoria: ${JSON.stringify(nomes)}`,
        !nomes.some((n) => /Ultra Bass/.test(n)) || `anúncio genérico ("Ultra Bass TWS") virou candidato: ${JSON.stringify(nomes)}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa (6º teste real): veredito que é número, pontuação, item de lista ou site é ignorado — a célula não vira "fato"',
    tipo: 'unidade',
    executar() {
      const criterios = ['atraso do som', 'conforto', 'isolamento', 'durabilidade', 'microfone', 'preço'].map((nome) => ({ nome, peso: 'medio' }));
      const numeracao = new Map(criterios.map((c, i) => [i + 1, c.nome]));
      // vereditos copiados da execução real muh3digf-l3d1
      const v = m.lerJulgamento(
        'atraso do som: 28913839\nconforto: - Bose QuietComfort Ultra 2\nisolamento: ,\ndurabilidade: kabum.com.br - TH50\npreço: 727\nmicrofone: microfone claro, sem chiado (5)',
        criterios,
        numeracao
      );
      return [
        ...['atraso do som', 'conforto', 'isolamento', 'durabilidade', 'preço'].map(
          (k) => !v.has(k) || `"${k}" aceitou veredito sem sentido: ${JSON.stringify(v.get(k))}`
        ),
        v.get('microfone') === 'microfone claro, sem chiado' || `veredito bom recusado: ${JSON.stringify(v.get('microfone'))}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa (6º teste real, ponta a ponta): o nome que o modelo deu entra nos finalistas antes do padrão; título de vitrine não entra',
    tipo: 'unidade',
    async executar() {
      const vitrine = 'FONE DE OUVIDO INTRA AURICULAR GAMER CABO 1 JBL O Fone.';
      const srv = await buscaFalsa([
        {
          contem: 'descoberta fones fps',
          paginas: [
            pagina(`${vitrine} Os melhores para FPS: Delta K7 e Epsilon R5. Também gostei do Zeta W9.`),
            pagina(`${vitrine} Para jogos competitivos, Delta K7 e Epsilon R5 lideram a lista.`),
          ],
        },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: modelo antes do padrão',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Zeta W9',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const nomes = (obtido.pesquisa.candidatos?.finalistas || []).map((f) => f.nome);
        // 2º cenário: o nome do modelo tem 2 sites, mas o padrão acha 3 nomes
        // com 3 sites cada — ordenar tudo junto por sites cortaria o do modelo
        const fortes = 'Os melhores: Delta K7, Epsilon R5 e Teta M3.';
        const srv2 = await buscaFalsa([
          {
            contem: 'descoberta fones fps',
            paginas: [pagina(`${fortes} Gostei do Zeta W9.`), pagina(`${fortes} O Zeta W9 é bom.`), pagina(fortes)],
          },
        ]);
        let nomes2 = [];
        try {
          const obtido2 = await executarCasoAgente({
            nome: 'motor: modelo antes do padrão (2 sites)',
            pedido: PEDIDO,
            config: CONFIG(srv2.porta),
            planoDePesquisa: PLANO,
            candidatosDePesquisa: '- Zeta W9',
            roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
            redacao: 'Resposta de teste.',
          });
          nomes2 = (obtido2.pesquisa.candidatos?.finalistas || []).map((f) => f.nome);
        } finally {
          await srv2.fechar();
        }
        return [
          nomes.includes('Zeta W9') || `o nome do modelo ficou fora dos finalistas: ${JSON.stringify(nomes)}`,
          nomes2[0] === 'Zeta W9' || `com 2 sites, o nome do modelo deveria vir primeiro: ${JSON.stringify(nomes2)}`,
          nomes.includes('Delta K7') && nomes.includes('Epsilon R5') || `o padrão deveria completar: ${JSON.stringify(nomes)}`,
          !nomes.some((n) => /FONE|CABO|JBL/.test(n)) || `título de vitrine virou finalista: ${JSON.stringify(nomes)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- 7º teste real (2026-09-25 15:40) ---------------- */
  {
    nome: 'motor de pesquisa (7º teste real): frase sobre a compra ("atraso na entrega") não vira evidência de "atraso do som"',
    tipo: 'unidade',
    executar() {
      const criterios = [
        { nome: 'atraso do som', peso: 'alto', termos: ['atraso', 'latencia'] },
        { nome: 'prazo de entrega', peso: 'baixo', termos: ['entrega'] },
      ];
      const finalistas = [{ nome: 'KZ ZSN PRO', dominios: ['a.com'] }];
      const loja = m.montarMatriz({
        finalistas,
        criterios,
        entradas: [{ url: 'https://loja.com/x', bruto: 'O KZ ZSN PRO chegou com um pequeno atraso na entrega, mas veio bem embalado.' }],
      });
      const review = m.montarMatriz({
        finalistas,
        criterios,
        entradas: [{ url: 'https://review.com/x', bruto: 'O KZ ZSN PRO é com fio, então não tem atraso do som perceptível nos passos.' }],
      });
      return [
        !loja.celula('KZ ZSN PRO', 'atraso do som').trechos.length || 'frase de entrega virou evidência de atraso do som',
        loja.celula('KZ ZSN PRO', 'prazo de entrega').trechos.length === 1 || 'critério que É sobre entrega deveria aceitar a frase',
        review.celula('KZ ZSN PRO', 'atraso do som').trechos.length === 1 || 'frase de review sobre atraso do som foi recusada',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (7º teste real): ano que o modelo pôs na busca de descoberta sai; ano que o usuário pediu fica',
    tipo: 'unidade',
    executar() {
      const texto = (pedido) =>
        m.lerPlanoDePesquisa(
          'USO: PUBG\nCRITÉRIOS:\n- atraso do som | alto | atraso\n- conforto | médio | conforto\nOPÇÕES CITADAS NO PEDIDO:\n- nenhuma\nBUSCAS DE DESCOBERTA:\n- melhor fone de ouvido para PUBG PC 2023',
          pedido
        );
      const sem = texto('Quais os melhores fones intra-auriculares para PUBG?');
      const com = texto('Quais os melhores fones para PUBG em 2023?');
      return [
        sem?.descoberta?.[0] === 'melhor fone de ouvido para PUBG PC' || `ano inventado ficou: ${JSON.stringify(sem?.descoberta)}`,
        com?.descoberta?.[0] === 'melhor fone de ouvido para PUBG PC 2023' || `ano do pedido sumiu: ${JSON.stringify(com?.descoberta)}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa (7º teste real): 2 finalistas fortes + 1 nome de 1 site → compara 3; o plano da resposta mostra quem tem evidência nos critérios de peso alto',
    tipo: 'unidade',
    executar() {
      const validos = [
        { nome: 'Galaxy Buds FE', dominios: ['a.com', 'b.com'] },
        { nome: 'KZ ZSN PRO', dominios: ['a.com', 'c.com'] },
        { nome: 'JBL Wave Buds 2', dominios: ['d.com'] },
      ];
      const f3 = m.escolherFinalistas(validos, 4);
      const f2 = m.escolherFinalistas(validos, 2);
      const criterios = [
        { nome: 'atraso do som', peso: 'alto', termos: ['atraso'] },
        { nome: 'conforto', peso: 'medio', termos: ['conforto'] },
      ];
      const matriz = m.montarMatriz({
        finalistas: validos.slice(0, 2),
        criterios,
        entradas: [{ url: 'https://r.com/x', bruto: 'O KZ ZSN PRO não tem atraso perceptível. O Galaxy Buds FE tem bom conforto.' }],
      });
      const plano = m.planoDeResposta({ plano: { uso: 'PUBG', criterios }, finalistas: validos.slice(0, 2), matriz });
      const nenhum = m.planoDeResposta({
        plano: { uso: 'PUBG', criterios },
        finalistas: validos.slice(0, 2),
        matriz: m.montarMatriz({ finalistas: validos.slice(0, 2), criterios, entradas: [] }),
      });
      return [
        f3.map((f) => f.nome).join('|') === 'Galaxy Buds FE|KZ ZSN PRO|JBL Wave Buds 2' || `esperava 3 finalistas: ${JSON.stringify(f3.map((f) => f.nome))}`,
        f2.length === 2 || 'o orçamento de finalistas deveria continuar valendo',
        // Etapa E: status por critério de peso alto, não "N de M"
        /PESO ALTO[^\n]*\n  Galaxy Buds FE: [^\n]*sem dados\n  KZ ZSN PRO: [^\n]*(fonte única|corroborado)/.test(plano) || `placar de peso alto ausente: ${plano.slice(-600)}`,
        /não aponte como "melhor" uma opção com 0/.test(plano) || 'falta a regra de não escolher opção sem evidência',
        /não permite apontar a melhor com segurança/.test(nenhum) || 'sem evidência em peso alto, a resposta deveria dizer que não dá pra apontar a melhor',
      ];
    },
  },

  {
    nome: 'verificação (7º teste real): resposta comparativa que fala das opções pesquisadas conta como "no assunto" parágrafo a parágrafo',
    tipo: 'unidade',
    executar() {
      const v = require('../../src/agent/verificador');
      const pedido = 'Quais os melhores fones de ouvido intra-auriculares para eu jogar pubg de pc ?';
      // estrutura da resposta real: só a 1ª parte repete palavras do pedido
      const resposta = [
        'Para jogar PUBG de PC com baixo atraso, eu escolheria o KZ ZSN PRO, pela evidência sobre atraso e isolamento.',
        '| CRITÉRIO | Galaxy Buds FE | KZ ZSN PRO |\n|---|---|---|\n| Atraso do som | sem dados | baixo |\n| Conforto | leve e confortável | sem dados |',
        '- **Galaxy Buds FE**: ponto forte é o conforto e o design leve; limitação: falta evidência sobre atraso.',
        '- **KZ ZSN PRO**: ponto forte é o isolamento eficaz em ambientes ruidosos; limitação: falta dado sobre conforto.',
        '- O que não foi possível confirmar: cancelamento de ruído e qualidade do microfone em ambos os modelos.',
        '- Melhor custo-benefício: nenhuma das fontes trouxe preço comparável entre os dois modelos citados.',
      ].join('\n\n');
      const sem = v.verificar({ resposta, dossie: [{ texto: 'material' }], objetivo: pedido });
      const com = v.verificar({ resposta, dossie: [{ texto: 'material' }], objetivo: pedido, assunto: ['Galaxy Buds FE', 'KZ ZSN PRO'] });
      const fora = v.verificar({
        resposta: resposta.replace(/Galaxy Buds FE|KZ ZSN PRO/g, 'Monet'),
        dossie: [{ texto: 'material' }],
        objetivo: pedido,
        assunto: ['Galaxy Buds FE', 'KZ ZSN PRO'],
      });
      return [
        !sem.respondeAoPedido || 'sem os nomes das opções, o caso deveria reproduzir o alarme falso do teste real',
        com.respondeAoPedido || 'com as opções pesquisadas como assunto, a resposta comparativa deveria passar',
        !fora.respondeAoPedido || 'resposta que não fala das opções nem do pedido continuaria tendo que falhar',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (7º teste real, ponta a ponta): as opções da pesquisa chegam à verificação da resposta',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const resposta = [
          'Entre os fones intra-auriculares para jogar PUBG de PC, eu escolheria o Alfa X1, pelo posicionamento preciso nos passos.',
          '| CRITÉRIO | Alfa X1 | Beta Z2 |\n|---|---|---|\n| posicionamento | preciso | razoável |\n| conforto | bom | excelente |',
          '- **Alfa X1**: ponto forte é o posicionamento preciso; limitação: nada relevante encontrado além disso.',
          '- **Beta Z2**: ponto forte é o conforto excelente por horas; limitação: posicionamento só razoável.',
          '- O que não foi possível confirmar: durabilidade e qualidade do microfone de cada um dos modelos.',
        ].join('\n\n');
        const obtido = await executarCasoAgente({
          nome: 'motor: opções na verificação',
          pedido: 'Quais os melhores fones de ouvido intra-auriculares para eu jogar pubg de pc ?',
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: resposta,
        });
        return [
          obtido.verificacoes[0]?.respondeAoPedido === true || `a verificação reprovou a comparação: ${JSON.stringify(obtido.verificacoes[0])?.slice(0, 300)}`,
          !/não consegui confirmar com segurança/.test(obtido.resposta || '') || 'o aviso de "pode não cobrir o pedido" apareceu',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- 8º teste real (2026-09-25 16:13) — pesquisa por produto ---------------- */
  {
    nome: 'motor de pesquisa (8º teste real): o plano não acrescenta "sem fio" que o pedido não disse, tira critério vago e junta sinônimo',
    tipo: 'unidade',
    executar() {
      const pedido = 'Realise uma pesquisa profunda e busque para min o top 10 melhores fones de ouvido intra auriculares para se jogar pubg de pc';
      // plano real da execução muh5ufqk-4npl (com "atraso" e "latência" juntos pra testar o sinônimo)
      const plano = m.lerPlanoDePesquisa(
        'USO: se jogar PUBG de PC com a melhor qualidade sonora e sem interferir na performance do jogo, usando fones intra-auriculares sem fio\n' +
          'CRITÉRIOS:\n- cancelamento de som ambiente | alto | cancelamento\n- compatibilidade | alto | compatível\n- atraso do áudio | alto | atraso\n' +
          '- isolamento sonoro | médio | isolamento\n- conforto de uso | médio | conforto\n- baixa latência | alto | latência\n' +
          'OPÇÕES CITADAS NO PEDIDO:\n- nenhuma\nBUSCAS DE DESCOBERTA:\n- top 10 fones intra-auriculares sem fio para jogos PC',
        pedido
      );
      const comFio = m.lerPlanoDePesquisa('USO: jogar sem fio no PC\nCRITÉRIOS:\n- atraso | alto | atraso\n- conforto | médio | conforto\nBUSCAS DE DESCOBERTA:\n- fone sem fio jogo', 'melhor fone sem fio para jogar');
      const nomes = plano.criterios.map((k) => k.nome);
      const importa = m.lerCriteriosDoMaterial('- X\nIMPORTA: Baixa latência, autonomia de bateria', plano.criterios).map((k) => k.nome);
      return [
        !/sem fio/i.test(plano.uso) || `"sem fio" inventado ficou no uso: ${plano.uso}`,
        /PUBG de PC/.test(plano.uso) || `o resto do uso deveria ficar: ${plano.uso}`,
        !/sem fio/i.test(plano.descoberta[0]) || `"sem fio" inventado ficou na busca: ${plano.descoberta[0]}`,
        /sem fio/.test(comFio.uso) && /sem fio/.test(comFio.descoberta[0]) || 'quando o PEDIDO diz "sem fio", a condição fica',
        !nomes.includes('compatibilidade') || 'critério vago "compatibilidade" continuou',
        !nomes.includes('baixa latência') || `latência e atraso viraram dois critérios: ${nomes.join(', ')}`,
        JSON.stringify(importa) === JSON.stringify(['autonomia de bateria']) || `IMPORTA sinônimo de critério existente entrou: ${JSON.stringify(importa)}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa (8º teste real): veredito "Trecho 2, Trecho 3" é ignorado; página lida pra uma opção vale sem repetir o nome',
    tipo: 'unidade',
    executar() {
      const criterios = [{ nome: 'compatibilidade', peso: 'alto' }, { nome: 'conforto', peso: 'medio' }];
      const v = m.lerJulgamento('compatibilidade: Trecho 2, Trecho 3\nconforto: (1) trecho 1', criterios, new Map([[1, 'conforto'], [2, 'compatibilidade'], [3, 'compatibilidade']]));
      const k = [{ nome: 'posicionamento', peso: 'alto', termos: ['posicionamento'] }, { nome: 'conforto', peso: 'medio', termos: ['conforto'] }];
      const fin = [{ nome: 'KZ EDX Pro', dominios: [] }, { nome: 'QKZ AK6', dominios: [] }];
      const matriz = m.montarMatriz({
        finalistas: fin,
        criterios: k,
        entradas: [
          // tópico do Reddit do KZ: as frases não repetem o nome
          { url: 'https://reddit.com/r/iems/1', opcao: 'KZ EDX Pro', bruto: 'Uso no PUBG há meses. O posicionamento é preciso, ouço os passos. Já o QKZ AK6 tem conforto melhor.' },
          // página de descoberta (sem dona): continua exigindo o nome
          { url: 'https://loja.com/x', bruto: 'O posicionamento deste fone é ótimo.' },
        ],
      });
      return [
        !v.has('compatibilidade') || `aceitou número de trecho como veredito: ${v.get('compatibilidade')}`,
        matriz.celula('KZ EDX Pro', 'posicionamento').trechos.length === 1 || 'frase do tópico do KZ (sem o nome) deveria valer pro KZ',
        !matriz.celula('KZ EDX Pro', 'conforto').trechos.length || 'frase que cita OUTRA finalista não pode valer pra dona da página',
        matriz.celula('QKZ AK6', 'conforto').trechos.length === 1 || 'a frase que cita o QKZ vale pro QKZ',
        !matriz.celula('QKZ AK6', 'posicionamento').trechos.length || 'página sem dona e sem nome não pode dar evidência',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (8º teste real, ponta a ponta): cada finalista tem ficha técnica e opinião da comunidade (Reddit) resumidas no plano da resposta',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: ficha + comunidade',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          julgamentoDePesquisa: (prompt) =>
            /OPÇÃO: Alfa X1/.test(prompt)
              ? 'posicionamento: preciso nos passos\nconforto: bom em sessões longas\nficha técnica: FICHA-ALFA driver 10 mm, 32 ohms, com fio\ncomunidade: COMUNIDADE-ALFA ouve bem os passos no PUBG'
              : 'conforto: excelente por horas\nficha técnica: Trecho 3\ncomunidade: sem dados',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        const promptAlfa = obtido.promptJulgamento.split('OPÇÃO:').find((b) => /^ Alfa X1/.test(b)) || '';
        const resumos = obtido.registro?.pesquisaPlanejada?.matriz?.resumos || [];
        return [
          /\[FICHA TÉCNICA\][\s\S]*driver dinâmico de 10 mm/.test(promptAlfa) || 'o juiz não recebeu a ficha técnica do Alfa X1',
          /\[COMUNIDADE\][\s\S]*Eu uso o Alfa X1 no PUBG/.test(promptAlfa) || 'o juiz não recebeu o que a comunidade diz do Alfa X1',
          /FICHA TÉCNICA \([^)]*\): FICHA-ALFA driver 10 mm/.test(plano) || 'a ficha resumida não chegou ao plano da resposta',
          /O QUE A COMUNIDADE DIZ \([^)]*\): COMUNIDADE-ALFA/.test(plano) || 'a opinião da comunidade não chegou ao plano da resposta',
          /Beta Z2:[\s\S]*FICHA TÉCNICA: não encontrada/.test(plano) || 'ficha-lixo ("Trecho 3") do Beta deveria virar "não encontrada"',
          /citando a fonte/.test(plano) && /o que a comunidade \(Reddit, fóruns\) diz/.test(plano) || 'o formato não pede ficha + comunidade nos destaques',
          resumos.some((r) => r.opcao === 'Alfa X1' && r.ficha && r.comunidade) || `registro sem os resumos: ${JSON.stringify(resumos).slice(0, 200)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (8º teste real): "top 10" vira lista de até 10 nomes do material, sem inventar para completar',
    tipo: 'unidade',
    executar() {
      const k = [{ nome: 'posicionamento', peso: 'alto', termos: ['posicionamento'] }, { nome: 'conforto', peso: 'medio', termos: ['conforto'] }];
      const fin = [{ nome: 'Alfa X1', dominios: ['a.com', 'b.com'] }, { nome: 'Beta Z2', dominios: ['a.com', 'c.com'] }];
      const outros = [{ nome: 'Gama Q3', dominios: ['a.com'] }, { nome: 'Delta K7', dominios: ['d.com', 'e.com'] }];
      const matriz = m.montarMatriz({ finalistas: fin, criterios: k, entradas: [] });
      const com = m.planoDeResposta({ plano: { uso: 'PUBG', criterios: k }, finalistas: fin, outros, matriz, quantidade: 10 });
      const sem = m.planoDeResposta({ plano: { uso: 'PUBG', criterios: k }, finalistas: fin, outros, matriz });
      const prompt = prompts.pedidoDeCandidatos({ uso: 'PUBG', material: 'x', maximo: 10 });
      return [
        m.quantidadePedida('busque para min o top 10 melhores fones') === 10 || 'não reconheceu "top 10"',
        m.quantidadePedida('os dez melhores fones') === 10 && m.quantidadePedida('os 5 melhores notebooks') === 5 || 'não reconheceu "dez/5 melhores"',
        m.quantidadePedida('fone com 2 drivers para PUBG') === 0 || 'número solto não é pedido de lista',
        /lista de 10/.test(com) && /O material só tem 4/.test(com) && /não invente nome para completar/.test(com) || 'faltou a instrução da lista de 10',
        /Gama Q3 \(1 site\), Delta K7 \(2 sites\)/.test(com) || 'as outras opções da lista deveriam vir com o nº de sites',
        !/lista de/.test(sem) || 'sem "top N", não pede lista',
        /de 3 a 10/.test(prompt) || 'o pedido de candidatos deveria aceitar até 10 nomes',
        m.lerCandidatos(Array.from({ length: 12 }, (_, i) => `- Modelo K${i + 1}`).join('\n'), 10).length === 10 || 'lerCandidatos deveria aceitar até 10',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (8º teste real): com a pesquisa planejada pronta, "perguntar" da crítica periódica/pré-redação não põe a tarefa esperando o usuário',
    tipo: 'unidade',
    executar() {
      const { Agent } = require('../../src/agent/loop');
      const { Tarefa, ESTADOS } = require('../../src/agent/tarefa');
      const rec = JSON.parse(PERGUNTAR_MATERIAL_LIMITADO);
      const rodar = (planoDeResposta, fase) => {
        const agente = new EventEmitter();
        const eventos = [];
        agente.on('recomendacao-critico', (e) => eventos.push(e));
        agente.planoDeResposta = planoDeResposta;
        agente.tarefa = new Tarefa(PEDIDO).transicionar(ESTADOS.PLANEJANDO, 'teste').transicionar(ESTADOS.EXECUTANDO, 'teste');
        agente.recomendacaoCriticoJaCoberta = () => false;
        agente.replanejamentoChaves = new Set();
        agente.iteracao = 9;
        agente.replanejamentoCooldownAte = 0;
        agente.replanejamentosFeitos = 0;
        // Controlador v2: aqui se testa a regra da pesquisa planejada, não a
        // da falta confirmada — então a verificação inicial "confirmou" a falta
        agente.ambiguidadeInsuficiente = true;
        Agent.prototype.aplicarRecomendacaoCritico.call(agente, rec, fase);
        return { estado: agente.tarefa.estado, eventos };
      };
      const comPlano = rodar('PLANO DA RESPOSTA ...', 'plano');
      const preRedacao = rodar('PLANO DA RESPOSTA ...', 'pre-redacao');
      const semPlano = rodar(null, 'plano');
      const sobDemanda = rodar('PLANO DA RESPOSTA ...', 'sob-demanda');
      return [
        comPlano.estado !== ESTADOS.AGUARDANDO_USUARIO || 'crítica periódica "perguntar" travou a tarefa com a pesquisa pronta',
        comPlano.eventos.some((e) => e.ignorada === 'pesquisa-planejada') || 'a recomendação ignorada deveria aparecer no evento',
        preRedacao.estado !== ESTADOS.AGUARDANDO_USUARIO || 'pré-redação "perguntar" travou a tarefa com a pesquisa pronta',
        semPlano.estado === ESTADOS.AGUARDANDO_USUARIO || 'sem pesquisa planejada, "perguntar" continua valendo (comportamento de antes)',
        sobDemanda.estado === ESTADOS.AGUARDANDO_USUARIO || 'consulta que o próprio agente pediu continua valendo',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (8º teste real, ponta a ponta): com a pesquisa planejada pronta, "material insuficiente" da pré-redação não manda buscar solto',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: pré-redação não desvia depois do motor',
          pedido: PEDIDO,
          config: CONFIG(srv.porta, { pipelineForcadoUniversal: true }),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          criticaAutomatica: (prompt) =>
            /imediatamente antes de escrever a resposta final/.test(prompt) ? 'MATERIAL INSUFICIENTE: o material coletado parece limitado.' : 'ok',
          roteiro: [
            { ferramenta: 'responder', argumentos: { foco: 'fones' } },
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'busca solta depois do veto' } },
            { ferramenta: 'responder', argumentos: { foco: 'fones' } },
          ],
          redacao: 'Resposta de teste.',
        });
        return [
          obtido.ok || `execução falhou: ${JSON.stringify(obtido.erros)}`,
          !obtido.copiloto.some((c) => c.gate === 'material-insuficiente') || 'o veto de material insuficiente rodou com a pesquisa pronta',
          !srv.consultas.includes('busca solta depois do veto') || 'o agente fez busca solta depois da pesquisa planejada',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (8º teste real, ponta a ponta): pedido "top 10" aceita até 10 nomes do modelo de candidatos',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: top 10',
          pedido: 'Quais os top 10 fones intra-auriculares para jogar PUBG no PC?',
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: ['Alfa X1', 'Beta Z2', 'Gama Q3', ...Array.from({ length: 9 }, (_, i) => `Inventado K${i + 1}`)].map((n) => `- ${n}`).join('\n'),
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const c = obtido.pesquisa.candidatos || {};
        return [
          /de 3 a 10/.test(obtido.promptCandidatos) || 'o pedido de candidatos não subiu pra 10',
          c.propostos === 10 || `esperava 10 nomes lidos da resposta, vieram ${c.propostos}`,
          /lista de 10/.test(obtido.pesquisa.fim?.planoDeResposta || '') || 'o plano da resposta não pediu a lista de 10',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- 9º teste real (2026-09-25 16:54, muh7babv-kww5) ---------------- */
  {
    nome: 'motor de pesquisa (9º teste real): o mesmo produto com dois nomes vira um só ("JBL Quantum 50" × "JBL Quantum 50 4"); modelo diferente continua separado',
    tipo: 'unidade',
    executar() {
      const v = [
        { nome: 'JBL Quantum 50', dominios: ['a.com', 'b.com'], mencoes: 9 },
        { nome: 'HyperX Cloud Earbuds II', dominios: ['a.com'], mencoes: 4 },
        { nome: 'JBL Quantum 50 4', dominios: ['a.com', 'c.com'], mencoes: 9 },
        { nome: 'WAAW Energy 10EWG', dominios: ['x.com', 'y.com'], mencoes: 8 },
        { nome: 'ENERGY 10EWG', dominios: ['z.com'], mencoes: 8 },
        { nome: 'JBL Quantum 50 Intra-auricular', dominios: ['q.com'], mencoes: 7 },
        { nome: 'KZ ZSN Pro', dominios: ['a.com'], mencoes: 1 },
        { nome: 'KZ ZSN Pro 2', dominios: ['b.com'], mencoes: 1 },
      ];
      const nomes = m.juntarVariantes(v).map((c) => c.nome);
      const jbl = m.juntarVariantes(v).find((c) => c.nome === 'JBL Quantum 50');
      // vitrine real: nota "4,5 estrelas", "4-8 Horas" de bateria, "Wireless Quantum 2"
      const vitrine = 'O JBL Quantum 50 4,5 estrelas. Bateria de 4-8 Horas no total. Wireless Quantum 2 em oferta. JBL Quantum 50 4 horas de uso.';
      const padrao = m.candidatosPorPadrao(
        [
          { url: 'https://a.com/x', bruto: vitrine },
          { url: 'https://b.com/y', bruto: vitrine },
        ],
        { objetivo: 'fone para pubg' }
      );
      return [
        JSON.stringify(nomes) === JSON.stringify(['JBL Quantum 50', 'HyperX Cloud Earbuds II', 'WAAW Energy 10EWG', 'KZ ZSN Pro', 'KZ ZSN Pro 2']) ||
          `variantes não juntadas direito: ${JSON.stringify(nomes)}`,
        jbl?.dominios.length === 4 || `os sites das variantes deveriam somar: ${JSON.stringify(jbl?.dominios)}`,
        !padrao.some((n) => /Quantum 50 4|Horas|Wireless/.test(n)) || `lixo da vitrine virou candidato: ${JSON.stringify(padrao)}`,
        padrao.includes('JBL Quantum 50') || `o nome de verdade deveria ficar: ${JSON.stringify(padrao)}`,
      ];
    },
  },

  {
    nome: 'motor de pesquisa (9º teste real, ponta a ponta): variante do mesmo produto não vira segundo finalista',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: variantes juntadas',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          // "Alfa X1 2024" = o "JBL Quantum 50 4" do teste real
          candidatosDePesquisa: '- Alfa X1\n- Alfa X1 2024\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const nomes = (obtido.pesquisa.candidatos?.finalistas || []).map((f) => f.nome);
        return [
          !nomes.includes('Alfa X1 2024') || `variante virou finalista: ${JSON.stringify(nomes)}`,
          nomes.includes('Alfa X1') && nomes.includes('Beta Z2') || `finalistas: ${JSON.stringify(nomes)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (9º teste real, ponta a ponta): fone com fio na ficha técnica ganha "sem atraso de transmissão"; Bluetooth não',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: atraso deduzido da conexão',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO.replace('- conforto | médio | conforto, comfort', '- conforto | médio | conforto, comfort\n- atraso | alto | atraso, latência'),
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        // bloco de cada opção, qualquer que seja a ordem (a ordem agora é pela evidência)
        const bloco = (nome) => (plano.split(`\n${nome}:\n`)[1] || '').split(/\n(?=\S[^\n]*:\n)|\n\n/)[0];
        const alfa = `Alfa X1:\n${bloco('Alfa X1')}`;
        const beta = bloco('Beta Z2');
        return [
          // Etapa E: a célula deduzida leva o status "indireto"
          /Alfa X1:[\s\S]*- atraso \[indireto\] \([^)]*\): com fio \(conector na ficha técnica\): sem atraso de transmissão — deduzido/.test(alfa) ||
            `o atraso do Alfa X1 (ficha: conexão com fio P2) não foi deduzido: ${alfa.slice(-900)}`,
          /- atraso: SEM EVIDÊNCIA/.test(beta) || 'o Beta Z2 é Bluetooth: o atraso não pode ser deduzido',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (9º teste real): "IMPORTA" vago sai e o do material entra com peso médio; frase seguinte sobre OUTRA finalista não vira evidência',
    tipo: 'unidade',
    executar() {
      const criterios = [{ nome: 'atraso', peso: 'alto' }, { nome: 'isolamento sonoro', peso: 'alto' }];
      const importa = m.lerCriteriosDoMaterial('- JBL Quantum 50\nIMPORTA: Conectividade tri-modo, compatibilidade com PC.', criterios, PEDIDO);
      const k = [{ nome: 'isolamento sonoro', peso: 'alto', termos: ['isolamento'] }];
      const fin = [{ nome: 'JBL Quantum 50', dominios: [] }, { nome: 'KZ ZSN PRO 2', dominios: [] }];
      const matriz = m.montarMatriz({
        finalistas: fin,
        criterios: k,
        // texto real (reviup.com.br) que deu isolamento ao JBL
        entradas: [{ url: 'https://reviup.com.br/x', bruto: 'O JBL Quantum 50 oferece recursos exclusivos, como plugue USB-C, mas falta um case inclusivo. O KZ ZSN PRO 2 se destaca pelo isolamento acústico, ideal para jogos em ambientes barulhentos.' }],
      });
      return [
        importa.map((c) => c.nome).join('|') === 'Conectividade tri-modo' || `IMPORTA: ${JSON.stringify(importa)}`,
        importa[0]?.peso === 'medio' || `critério do material deveria ter peso médio, veio ${importa[0]?.peso}`,
        !matriz.celula('JBL Quantum 50', 'isolamento sonoro').trechos.length || 'o isolamento do KZ virou evidência do JBL',
        matriz.celula('KZ ZSN PRO 2', 'isolamento sonoro').trechos.length === 1 || 'o isolamento do KZ deveria ficar com o KZ',
      ];
    },
  },

  {
    nome: 'motor de pesquisa (9º teste real, ponta a ponta): a busca de lacuna mira o que o JUIZ deixou vazio, e a matriz é julgada de novo depois',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: lacuna depois do juiz',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          // o texto do Alfa X1 fala de posicionamento, mas o juiz diz que não serve
          julgamentoDePesquisa: (prompt) => (/OPÇÃO: Alfa X1/.test(prompt) ? 'posicionamento: sem dados\nconforto: bom por horas' : 'conforto: excelente'),
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        return [
          srv.consultas.includes('alfa x1 posicionamento') || `a lacuna deveria ir pro posicionamento do Alfa X1 (o juiz esvaziou): ${srv.consultas.join(' | ')}`,
          obtido.chamadasJulgamento === 4 || `esperava 2 julgamentos antes da lacuna + 2 depois, houve ${obtido.chamadasJulgamento}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'motor de pesquisa (9º teste real, ponta a ponta): com a pesquisa pronta, item do plano que o modelo declarou depois não trava o responder',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: checklist não trava depois do motor',
          pedido: PEDIDO,
          // teto 9 (> 7 buscas do motor): o gate não é pulado pelo teto, só pela pesquisa pronta
          config: CONFIG(srv.porta, { pipelineForcadoUniversal: true, profundidadePesquisa: 'alta' }),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [
            // itens reais do passo 17 em diante
            { ferramenta: 'responder', plano: ['Pesquisar o atraso do JBL Quantum 50 e do HyperX', 'Completar a tabela com os dados faltantes e redigir a resposta final'], argumentos: { foco: 'fones' } },
            { ferramenta: 'responder', argumentos: { foco: 'fones' } },
          ],
          redacao: 'Resposta de teste.',
        });
        return [
          obtido.ok || `execução falhou: ${JSON.stringify(obtido.erros)}`,
          !obtido.copiloto.some((c) => c.gate === 'checklist-pendente') || 'o checklist barrou responder com a pesquisa pronta',
          ehItemDeEntregaFinal('Completar a tabela com os dados faltantes e redigir a resposta final') ||
            'item longo de entrega ("... e redigir a resposta final") não foi reconhecido (corte de 60 caracteres)',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- pesquisa pela comunidade, Fase A (2026-09-26) ---------------- */
  {
    nome: 'motor de pesquisa (comunidade, Fase A): descoberta com "site:" nas fontes dos Ajustes, Reddit sem filtro de idioma, fórum brasileiro em pt-BR',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        await executarCasoAgente({
          nome: 'motor: descoberta na comunidade',
          pedido: PEDIDO,
          // fontes do usuário (Ajustes): endereço completo vira domínio
          config: CONFIG(srv.porta, { fontesComunidade: ['https://forum.adrenaline.com.br/threads/fone-para-pubg.123/', 'reddit.com'] }),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const pedido = (q) => srv.pedidos.find((p) => p.q === q);
        return [
          // Etapa C: a bateria da comunidade (uma de cada fonte primeiro)
          pedido('site:forum.adrenaline.com.br fone intra auricular pubg fps')?.idioma === 'pt-BR' ||
            `fórum brasileiro da lista do usuário: ${JSON.stringify(srv.pedidos.slice(0, 4))}`,
          pedido('site:reddit.com best iem for pubg')?.idioma === 'all' || 'descoberta no Reddit não pode filtrar pt-BR',
          pedido('site:reddit.com alfa x1')?.idioma === 'all' || 'opinião do Reddit sobre o produto não pode filtrar pt-BR',
          !srv.consultas.some((q) => q.startsWith('site:clubedohardware')) || 'a lista do usuário substitui a padrão (Clube do Hardware não estava nela)',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- pesquisa pela comunidade, Fase B: mapa do problema (2026-09-26) ---------------- */
  {
    nome: 'mapa do problema (Fase B): lê perfis, o que decide, alternativas, armadilhas e hipóteses com tolerância; mapa ralo vira null',
    tipo: 'unidade',
    executar() {
      const mapa = m.lerMapaDoProblema(
        'Perfis de uso:\n1. jogador competitivo | ouvir de onde vem o passo\n' +
          'O QUE DECIDE:\n- **tipo de conexão** | Bluetooth tem atraso\n- palco e posicionamento | saber a direção do inimigo\n- conforto | partidas de horas\n' +
          'ALTERNATIVAS\n- IEM com microfone separado | quando o fone não tem microfone bom\n' +
          'Armadilhas:\n* comprar fone gamer só pelo RGB\n' +
          'HIPOTESES:\n- fones com fio têm menos atraso que Bluetooth\n- graves fortes atrapalham ouvir passos\n- graves fortes atrapalham ouvir passos\n- IEM barato compete com headset caro'
      );
      const ralo = m.lerMapaDoProblema('O QUE DECIDE:\n- preço\nHIPÓTESES:\n- uma só');
      return [
        mapa?.perfis[0]?.perfil === 'jogador competitivo' || `perfis: ${JSON.stringify(mapa?.perfis)}`,
        mapa?.decide.map((d) => d.fator).join('|') === 'tipo de conexão|palco e posicionamento|conforto' || `decide: ${JSON.stringify(mapa?.decide)}`,
        mapa?.decide[0].porque === 'Bluetooth tem atraso' || 'faltou o porquê do fator',
        mapa?.alternativas[0]?.quando === 'quando o fone não tem microfone bom' || 'faltou o "quando" da alternativa',
        mapa?.armadilhas.length === 1 || 'armadilha com "*" não foi lida',
        mapa?.hipoteses.length === 3 || `hipótese repetida deveria sair: ${JSON.stringify(mapa?.hipoteses)}`,
        ralo === null || 'mapa com 1 fator e 1 hipótese não serve de base',
      ];
    },
  },

  {
    nome: 'mapa do problema (Fase B): o prompt não cita produto nem traz fone no exemplo; o plano recebe o que decide como base dos critérios',
    tipo: 'unidade',
    executar() {
      const t = prompts.pedidoDeMapaDoProblema({ objetivo: PEDIDO });
      const semMapa = prompts.pedidoDePlanoDePesquisa({ objetivo: PEDIDO });
      const comMapa = prompts.pedidoDePlanoDePesquisa({
        objetivo: PEDIDO,
        mapa: { decide: [{ fator: 'tipo de conexão', porque: 'Bluetooth tem atraso' }], armadilhas: ['comprar pelo RGB'] },
      });
      return [
        /Ainda NÃO cite produto, marca ou modelo/.test(t) || 'faltou proibir nome de produto no mapa',
        !/\bfone|sem fio|bluetooth/i.test(t.split('EXEMPLO')[1] || '') || 'o exemplo do mapa não pode ser de fone (o 7B copia do exemplo)',
        /pedido: "qual o melhor tênis/.test(t) || 'o exemplo deveria ser de outro assunto',
        !/MAPA DO PROBLEMA/.test(semMapa) || 'sem mapa, o plano fica como antes',
        /O QUE DECIDE: tipo de conexão \(Bluetooth tem atraso\)/.test(comMapa) && /ARMADILHAS: comprar pelo RGB/.test(comMapa) ||
          'o plano não recebeu o mapa',
        /Transforme cada fator de "O QUE DECIDE" num critério/.test(comMapa) || 'faltou mandar usar os fatores como critérios',
      ];
    },
  },

  {
    nome: 'mapa do problema (Fase B): trecho da hipótese sai do material por palavras dela, comunidade primeiro e sem frase de loja',
    tipo: 'unidade',
    executar() {
      const entradas = [
        { url: 'https://loja.com/x', bruto: 'Fone com graves fortes, entrega rápida para ouvir passos no PUBG com frete grátis.' },
        { url: 'https://site.com/y', bruto: 'Graves fortes deixam o som encorpado, mas atrapalham ouvir passos em jogos competitivos.' },
        { url: 'https://reddit.com/r/iems/1', tipoBusca: 'comunidade', bruto: 'In my experience graves fortes mascaram passos, sério. Graves fortes atrapalham demais ouvir passos.' },
        { url: 'https://site.com/z', bruto: 'O microfone é bom para chamadas.' },
      ];
      const t = m.trechosParaHipotese('graves fortes atrapalham ouvir passos', entradas);
      const curta = m.trechosParaHipotese('som bom', entradas);
      return [
        t[0]?.dominio === 'reddit.com' || `comunidade deveria vir primeiro (mesma pontuação): ${JSON.stringify(t)}`,
        !t.some((x) => x.dominio === 'loja.com') || 'frase de loja (entrega/frete) entrou',
        !t.some((x) => /microfone/.test(x.texto)) || 'frase sem as palavras da hipótese entrou',
        t.length <= 3 || 'no máximo 3 trechos por hipótese',
        curta.length === 0 || 'hipótese com menos de 2 palavras úteis não busca trecho',
      ];
    },
  },

  {
    nome: 'mapa do problema (Fase B): avaliação das hipóteses aceita confirmada/derrubada/sem dados e recusa trecho de outra hipótese ou motivo-lixo',
    tipo: 'unidade',
    executar() {
      const numeracao = new Map([[1, 0], [2, 0], [3, 1], [4, 2]]);
      const v = m.lerAvaliacaoDeHipoteses(
        '**H1:** confirmada — usuários dizem que com fio não atrasa (1, 2)\nH2: derrubada — trecho do outro (4)\nH3: Confirmada — 28913839\nH4: sem dados',
        4,
        numeracao
      );
      const semRef = m.lerAvaliacaoDeHipoteses('H1 - derrubada: graves ajudam a ouvir passos', 1, new Map([[1, 0]]));
      return [
        v.get(0)?.tipo === 'confirmada' && v.get(0)?.motivo === 'usuários dizem que com fio não atrasa' || `H1: ${JSON.stringify(v.get(0))}`,
        v.get(1)?.tipo === 'sem dados' || 'número de trecho de outra hipótese deveria anular o veredito',
        v.get(2)?.tipo === 'sem dados' || 'motivo-lixo ("28913839") deveria anular o veredito',
        v.get(3)?.tipo === 'sem dados' || 'sem dados não foi lido',
        semRef.get(0)?.tipo === 'derrubada' || 'formato "H1 - derrubada:" sem número de trecho deveria ser aceito',
      ];
    },
  },

  {
    nome: 'mapa do problema (Fase B, ponta a ponta): mapa antes do plano, hipóteses conferidas no material e a resposta recebe confirmadas, derrubadas, alternativas e armadilhas',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: mapa do problema',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          mapaDoProblema:
            'PERFIS DE USO:\n- jogador competitivo | ouvir passos\nO QUE DECIDE:\n- posicionamento | saber a direção\n- conforto | partidas longas\n' +
            'ALTERNATIVAS:\n- headset over-ear | quando o intra incomoda\nARMADILHAS:\n- escolher pelo RGB\n' +
            'HIPÓTESES:\n- posicionamento preciso dos passos diferencia os fones\n- conforto pesa em sessões longas de jogo\n- microfone embutido faz diferença grande',
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          hipotesesDePesquisa: 'H1: confirmada — usuários elogiam o posicionamento dos passos\nH2: derrubada — conforto aparece, mas não separa os fones\nH3: sem dados',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        const reg = obtido.registro?.pesquisaPlanejada || {};
        return [
          obtido.promptMapa.length > 0 || 'o mapa do problema não foi pedido',
          /MAPA DO PROBLEMA[\s\S]*O QUE DECIDE: posicionamento \(saber a direção\); conforto \(partidas longas\)/.test(obtido.promptPlanoDePesquisa) ||
            'o plano não recebeu o mapa',
          obtido.chamadasHipoteses === 1 || `esperava 1 chamada de hipóteses, houve ${obtido.chamadasHipoteses}`,
          /H1: posicionamento preciso dos passos[\s\S]*\(1\) [^\n]*posicionamento/.test(obtido.promptHipoteses) || 'a hipótese 1 não recebeu trecho do material',
          // (o prompt vem serializado em JSON: a quebra de linha aparece como "\n")
          /H3: microfone embutido faz diferença grande(\n|\\n)\(nenhum trecho\)/.test(obtido.promptHipoteses) || `hipótese sem material deveria ir marcada "(nenhum trecho)": ${obtido.promptHipoteses.slice(-700)}`,
          /"posicionamento preciso dos passos diferencia os fones": CONFIRMADA pelo material \([^)]+\) — usuários elogiam/.test(plano) ||
            `hipótese confirmada fora do plano da resposta: ${plano.slice(plano.indexOf('HIPÓTESES'), plano.indexOf('HIPÓTESES') + 500)}`,
          /"conforto pesa em sessões longas de jogo": DERRUBADA pelo material/.test(plano) || 'hipótese derrubada fora do plano',
          /"microfone embutido faz diferença grande": SEM DADOS no material/.test(plano) || 'hipótese sem dados fora do plano',
          /ALTERNATIVAS QUE O PEDIDO NÃO CITOU[^\n]*headset over-ear — quando o intra incomoda/.test(plano) || 'faltou a alternativa',
          /ARMADILHAS A AVISAR[^\n]*escolher pelo RGB/.test(plano) || 'faltou a armadilha',
          /6\. Hipóteses e alternativas/.test(plano) || 'o formato não pede a seção de hipóteses',
          reg.mapa?.hipoteses?.length === 3 && reg.hipoteses?.length === 3 || `registro sem mapa/hipóteses: ${JSON.stringify(reg.mapa)?.slice(0, 200)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'mapa do problema (Fase B, ponta a ponta): hipótese que o material não toca nem gasta chamada; sem mapa, nada muda',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const semMaterial = await executarCasoAgente({
          nome: 'motor: hipóteses sem material',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          mapaDoProblema: 'O QUE DECIDE:\n- microfone | chamada com o time\n- cabo | durabilidade\nHIPÓTESES:\n- microfone embutido faz diferença grande\n- cabo trançado dura anos',
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const semMapa = await executarCasoAgente({
          nome: 'motor: sem mapa',
          pedido: PEDIDO,
          config: CONFIG(srv.porta),
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const plano1 = semMaterial.pesquisa.fim?.planoDeResposta || '';
        const plano2 = semMapa.pesquisa.fim?.planoDeResposta || '';
        return [
          semMaterial.chamadasHipoteses === 0 || 'nenhuma hipótese tinha trecho: não precisava chamar o modelo',
          (plano1.match(/SEM DADOS no material/g) || []).length === 2 || 'as duas hipóteses deveriam ir como "sem dados"',
          semMapa.pesquisa.fim?.ok === true || 'sem mapa o motor tem que seguir normalmente',
          !/HIPÓTESES|ALTERNATIVAS QUE|ARMADILHAS/.test(plano2) || 'sem mapa, o plano da resposta fica como antes',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ---------------- pesquisa pela comunidade, Fase C: lista larga por consenso (2026-09-26) ---------------- */
  {
    nome: 'consenso (Fase C): tópico da comunidade pesa 2, site de review 1, loja 0; crítica tira ponto; o motivo sai da comunidade com elogio',
    tipo: 'unidade',
    executar() {
      const entradas = [
        { url: 'https://www.reddit.com/r/iems/comments/aaa/x', bruto: 'The Alfa X1 is great for footsteps, I recommend it. Another line.' },
        { url: 'https://www.reddit.com/r/iems/comments/bbb/y', bruto: 'Alfa X1 broke after a month, avoid. Mas o Alfa X1 tem um palco excelente.' },
        { url: 'https://www.clubedohardware.com.br/forums/topic/1-z/', bruto: 'Uso o Alfa X1 no PUBG e acho ótimo.' },
        { url: 'https://www.techtudo.com.br/review', bruto: 'O Alfa X1 é um fone com driver de 10 mm.' },
        { url: 'https://www.kabum.com.br/produto/1', bruto: 'Alfa X1 em oferta, o melhor preço, recomendado!' },
        { url: 'https://www.mercadolivre.com.br/p/2', bruto: 'Alfa X1 excelente, compre já.' },
      ];
      const c = m.consensoDe('Alfa X1', entradas);
      const naoRecomendo = m.consensoDe('Beta Z2', [{ url: 'https://www.reddit.com/r/a/comments/c/z', bruto: 'Não recomendo o Beta Z2, chiado no cabo.' }]);
      return [
        c.topicos === 3 || `3 tópicos (2 do Reddit + 1 do Clube do Hardware), vieram ${c.topicos}`,
        c.editoriais === 1 && c.lojas === 2 || `editoriais ${c.editoriais}, lojas ${c.lojas}`,
        c.elogios === 3 && c.criticas === 1 || `elogios ${c.elogios} / críticas ${c.criticas} (loja não conta elogio)`,
        // 2026-09-28: tópico que recomenda vale 2 e +1 quando fala do uso (footsteps, palco, PUBG) — os 3 falam
        // editorial só conta quando fala do uso ou elogia (13º teste real) — o do techtudo aqui é só ficha: 0
        c.pontos === 3 * 3 + 0 + 3 - 1 || `pontos ${c.pontos}`,
        c.motivo?.tipo === 'comunidade' && /great for footsteps/.test(c.motivo.texto) || `motivo: ${JSON.stringify(c.motivo)}`,
        naoRecomendo.elogios === 0 && naoRecomendo.criticas === 1 || '"não recomendo" é crítica, não elogio',
      ];
    },
  },

  {
    nome: 'consenso (Fase C): nome que só aparece em loja fica atrás do recomendado pela comunidade; empate vai pro nome que o modelo deu',
    tipo: 'unidade',
    executar() {
      const vitrine = Array.from({ length: 6 }, (_, i) => ({ url: `https://www.loja${i}.com.br/p`, bruto: 'Vitrine V1 com frete grátis, o mais vendido.' }));
      const entradas = [
        ...vitrine,
        { url: 'https://www.reddit.com/r/iems/comments/q/w', bruto: 'Alfa X1 is the best budget IEM for competitive games.' },
        { url: 'https://site-a.com/x', bruto: 'O Gama Q3 e o Delta K7 aparecem na lista.' },
        { url: 'https://site-b.com/y', bruto: 'O Gama Q3 e o Delta K7 também estão aqui.' },
      ];
      const validos = m.validarCandidatos(['Vitrine V1', 'Alfa X1', 'Delta K7', 'Gama Q3'], entradas);
      const r = m.rankearPorConsenso(validos, entradas, { doModelo: new Set(['gama q3']) });
      const nomes = r.map((c) => c.nome);
      const fin = m.escolherPorConsenso(r, 3);
      return [
        nomes.indexOf('Alfa X1') < nomes.indexOf('Vitrine V1') || `loja passou na frente da comunidade: ${nomes.join(' > ')}`,
        r.find((c) => c.nome === 'Vitrine V1')?.pontos === 0 || 'nome só de loja deveria ter 0 pontos',
        nomes.indexOf('Gama Q3') < nomes.indexOf('Delta K7') || 'no empate, o nome que o modelo deu vem primeiro',
        !fin.some((c) => c.nome === 'Vitrine V1') || `nome só de loja virou finalista: ${fin.map((c) => c.nome)}`,
      ];
    },
  },

  {
    nome: 'consenso (Fase C): o plano traz a busca em inglês pro Reddit, sem ano, sem "reddit" e sem condição inventada',
    tipo: 'unidade',
    executar() {
      const p = m.lerPlanoDePesquisa(
        'USO: PUBG\nCRITÉRIOS:\n- a | alto | a\n- b | médio | b\nBUSCAS DE DESCOBERTA:\n- melhores fones pubg\nBUSCA EM INGLÊS:\n- best wireless IEM for PUBG 2023 reddit',
        'melhores fones intra para pubg'
      );
      const t = prompts.pedidoDePlanoDePesquisa({ objetivo: PEDIDO });
      return [
        p.buscaIngles === 'best IEM for PUBG' || `busca em inglês: ${JSON.stringify(p.buscaIngles)}`,
        JSON.stringify(p.descoberta) === JSON.stringify(['melhores fones pubg']) || `"BUSCA EM INGLÊS" não pode virar busca de descoberta: ${JSON.stringify(p.descoberta)}`,
        /BUSCA EM INGLÊS:\n- <a primeira busca de descoberta em inglês/.test(t) || 'o prompt do plano não pede a busca em inglês',
      ];
    },
  },

  {
    nome: 'consenso (Fase C, ponta a ponta): Reddit busca em inglês na 1ª rodada; o recomendado em tópicos passa o citado em mais sites; lista larga, motivo e contagem chegam ao plano',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        // tópicos da comunidade: Alfa X1 recomendado em 2 conversas
        {
          // Etapa C: a busca em inglês do Reddit vem da bateria montada pelo código
          contem: 'site:reddit.com best iem for pubg',
          paginas: [
            pagina('I use the Alfa X1 for PUBG, great footsteps, highly recommend it.'),
            pagina('Alfa X1 is the best budget pick for competitive shooters.'),
          ],
        },
        // descoberta geral: Omega Q9 citado em 3 sites de lista, Alfa X1 em 1
        {
          contem: 'descoberta fones fps',
          paginas: [
            pagina('Lista de fones: Omega Q9, Sigma P5 e Alfa X1.'),
            pagina('Top fones do ano: Omega Q9 e Sigma P5 lideram.'),
            // página de lista real diz do que é a lista (checagem de categoria, 10º teste real)
            pagina('Guia de fones: Omega Q9, Sigma P5, Teta M3.'),
          ],
        },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: consenso da comunidade',
          pedido: 'Quais os top 10 fones intra-auriculares para jogar PUBG no PC?',
          config: CONFIG(srv.porta),
          planoDePesquisa: `${PLANO}\nBUSCA EM INGLÊS:\n- best fps earphones`,
          candidatosDePesquisa: '- Omega Q9\n- Sigma P5\n- Alfa X1\n- Teta M3',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const c = obtido.pesquisa.candidatos || {};
        const nomes = (c.lista || []).map((x) => x.nome);
        const alfa = (c.lista || []).find((x) => x.nome === 'Alfa X1');
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        return [
          // na 1ª rodada (antes da leitura de nomes), não só numa eventual 2ª
          srv.pedidos.findIndex((p) => p.q === 'site:reddit.com best iem for pubg' && p.idioma === 'all') ===
            srv.pedidos.findIndex((p) => p.q.startsWith('site:')) ||
            `o Reddit deveria buscar em inglês já na 1ª rodada: ${JSON.stringify(srv.pedidos.map((p) => p.q))}`,
          srv.pedidos.some((p) => p.q === 'site:clubedohardware.com.br fone intra auricular pubg fps' && p.idioma === 'pt-BR') || 'fórum brasileiro continua em português',
          nomes[0] === 'Alfa X1' || `recomendado em 2 tópicos deveria vir antes do citado em 3 listas: ${nomes.join(' > ')}`,
          alfa?.topicos === 2 && /recommend|best budget/i.test(alfa?.motivo || '') || `contagem/motivo do Alfa: ${JSON.stringify(alfa)}`,
          nomes.length >= 4 || `a lista larga deveria guardar todos os nomes válidos: ${nomes.join(', ')}`,
          // Etapa B (14º teste real): respaldo com palavras honestas — tópicos que recomendam, sem "citada como recomendação em N sites"
          /Alfa X1 \(recomendada em 2 tópicos da comunidade/.test(plano) || 'contagem de tópicos fora do plano da resposta',
          /Alfa X1:\n  - POR QUE É RECOMENDADA \([^)]*comunidade\): "/.test(plano) || 'o motivo da recomendação não chegou ao redator',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'consenso (Fase C, ponta a ponta): com poucos nomes e sem fonte da comunidade sobrando, a 2ª rodada usa a 2ª busca de descoberta do plano',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'segunda busca de fones', paginas: [pagina('Também recomendados: Kappa L2 e Alfa X1.'), pagina('Kappa L2 é ótimo para jogos.')] },
        ...REGRAS,
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'motor: segunda rodada',
          pedido: PEDIDO,
          // só o Adrenaline como fonte: a bateria (Etapa C) tem 1 busca e a 1ª
          // leva já usa — não sobra busca da comunidade
          config: CONFIG(srv.porta, { fontesComunidade: ['forum.adrenaline.com.br'] }),
          planoDePesquisa: PLANO.replace('- descoberta fones fps competitivo', '- descoberta fones fps competitivo\n- segunda busca de fones'),
          candidatosDePesquisa: (prompt) => (/Kappa L2/.test(prompt) ? '- Kappa L2' : '- Alfa X1\n- Beta Z2'),
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const c = obtido.pesquisa.candidatos || {};
        return [
          srv.consultas.includes('segunda busca de fones') || `a 2ª busca do plano deveria rodar na 2ª rodada: ${srv.consultas.join(' | ')}`,
          c.segundaRodada === 1 || `segundaRodada: ${c.segundaRodada}`,
          (c.lista || []).some((x) => x.nome === 'Kappa L2') || `o nome da 2ª rodada deveria entrar na lista: ${JSON.stringify((c.lista || []).map((x) => x.nome))}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'candidatos (10º teste real): slogan, pedaço de lista de celular e nome de site não viram candidato; nome fora da categoria sai da lista',
    tipo: 'unidade',
    executar() {
      const ent = (texto, url, titulo = '') => ({ texto, bruto: texto, url, destilado: false, ...(titulo ? { titulo } : {}) });
      const entradas = [
        ent('Seu ANC avançado é alimentado por um chip. Seu ANC avançado reduz ruído.', 'https://www.jbl.com.br/a'),
        ent('Seu ANC avançado é ótimo. Explore a JBL Brasil e o KZ EDX Pro.', 'https://estadao.com.br/b'),
        ent('iPhone 15 15 Pro 15 Pro Max com 256 GB. Tela de 6,7 polegadas no 15 15 Pro 15 Pro.', 'https://tudocelular.com/c', 'iPhone 15 Pro: ficha'),
        ent('iPhone 15 15 Pro 15 Pro Max, câmera nova. Ou 15 15 Pro 15 Pro.', 'https://canaltech.com.br/d', 'iPhone 15 Pro'),
        ent('Os melhores fones para jogos: KZ EDX Pro e QKZ AK6 lideram. JBL Brasil tem loja.', 'https://techtudo.com.br/e'),
        ent('Fone QKZ AK6 é barato. O KZ EDX Pro também.', 'https://magodatecnologia.com.br/f'),
        ent('TÓPICO DO REDDIT (r/iems): Best IEMs for competitive PUBG\n- Moondrop Chu 2 has great imaging.', 'https://www.reddit.com/r/iems/comments/x/'),
        ent('Moondrop Chu 2 is cheap and clear.', 'https://www.reddit.com/r/headphones/comments/y/'),
        ent('Galaxy S24 Ultra tem câmera boa. Galaxy S24 Ultra é caro.', 'https://tecnoblog.net/g'),
        ent('Galaxy S24 Ultra review completo.', 'https://showmetech.com.br/h'),
      ];
      const padrao = m.candidatosPorPadrao(entradas, { objetivo: 'top 10 fones intra auriculares para pubg', maximo: 10 });
      const validos = m.validarCandidatos(['KZ EDX Pro', 'QKZ AK6', 'Moondrop Chu 2', 'Galaxy S24 Ultra'], entradas, {});
      const { lista, fora } = m.filtrarPorCategoria(validos.map((v) => ({ ...v })), entradas, 'top 10 fones intra auriculares para pubg');
      const nomes = lista.map((c) => c.nome);
      const semCategoria = m.filtrarPorCategoria(validos.map((v) => ({ ...v })), entradas, 'melhor liquidificador');
      return [
        !padrao.some((n) => /seu anc|^anc$/i.test(n)) || `slogan virou candidato: ${padrao.join(' | ')}`,
        !padrao.some((n) => /^15\b/.test(n)) || `pedaço de lista de celular virou candidato: ${padrao.join(' | ')}`,
        !padrao.some((n) => /brasil/i.test(n)) || `nome de site virou candidato: ${padrao.join(' | ')}`,
        ['KZ EDX Pro', 'QKZ AK6', 'Moondrop Chu 2'].every((n) => nomes.includes(n)) || `fones de verdade ficaram: ${nomes.join(', ')}`,
        !nomes.includes('Galaxy S24 Ultra') && fora.includes('Galaxy S24 Ultra') || `celular deveria sair da lista de fones: ${nomes.join(', ')} / fora: ${fora}`,
        semCategoria.lista.length === validos.length || 'categoria fora da tabela não tira nome nenhum',
      ];
    },
  },
  {
    nome: 'mapa e plano (10º teste real): ELIMINA vira critério de peso alto no prompt do plano; critério pendurado sai do USO e das buscas',
    tipo: 'unidade',
    executar() {
      const mapa = m.lerMapaDoProblema(
        'O QUE DECIDE:\n- localização dos passos | ouvir de onde vem o tiro\n- conforto | partidas longas\nELIMINA:\n- atraso de áudio do Bluetooth | o som chega depois do tiro\nHIPÓTESES:\n- fone com fio é melhor para jogo competitivo\n- fone barato serve para iniciante'
      );
      const prompt = prompts.pedidoDePlanoDePesquisa({ objetivo: 'top 10 fones intra auriculares para pubg de pc', mapa });
      const pedido = 'Realise uma pesquisa profunda e busque para min o top 10 melhores fones de ouvido intra auriculares para se jogar pubg de pc';
      const plano = m.lerPlanoDePesquisa(
        'USO: jogar PUBG de PC com isolamento acústico, qualidade sonora precisa e conforto durante longas sessões\nCRITÉRIOS:\n- isolamento | alto | isolamento\n- atraso | alto | latência\n- conforto | médio | conforto\nBUSCAS DE DESCOBERTA:\n- fones de ouvido intra-auriculares recomendados para PC com isolamento acústico\nBUSCA EM INGLÊS:\n- best in-ear headphones for PC gaming with noise cancellation',
        pedido
      );
      return [
        mapa?.elimina?.[0]?.fator === 'atraso de áudio do Bluetooth' || `ELIMINA não lido: ${JSON.stringify(mapa)}`,
        /ELIMINA \(o uso não tolera\): atraso de áudio do Bluetooth \(o som chega depois do tiro\)/.test(prompt) || 'ELIMINA não chegou ao prompt do plano',
        /vira critério de peso alto/.test(prompt) || 'regra do ELIMINA faltando',
        plano?.uso === 'jogar PUBG de PC' || `uso: ${plano?.uso}`,
        plano?.descoberta[0] === 'fones de ouvido intra-auriculares recomendados para PC' || `descoberta: ${plano?.descoberta}`,
        plano?.buscaIngles === 'best in-ear headphones for PC gaming' || `inglês: ${plano?.buscaIngles}`,
        m.semRecursoPendurado('jogar pubg com fones de ouvido', pedido) === 'jogar pubg com fones de ouvido' || 'oração com palavras do pedido fica',
      ];
    },
  },
  {
    nome: '11º teste real: headset fora de "intra-auricular"; "Trechos N (sem dados)" é sem dados; veredito que contradiz o motivo é corrigido',
    tipo: 'unidade',
    executar() {
      const ent = (texto, url, titulo = '') => ({ texto, bruto: texto, url, ...(titulo ? { titulo } : {}) });
      const entradas = [
        ent('Os melhores fones intra-auriculares para jogos: JBL Quantum 50, KZ EDX Pro e HyperX Cloud Earbuds II.', 'https://techtudo.com.br/a'),
        ent('O headset Redragon Zeus Pro tem conexão sem fio. Headset gamer Redragon Zeus Pro com 7.1.', 'https://canaltech.com.br/b', 'Redragon Zeus Pro: análise do headset'),
        ent('Melhores headsets e fones para jogos: Redragon Zeus Pro lidera.', 'https://br.my-best.com/c'),
        ent('Fone JBL Quantum 50 intra-auricular com microfone no cabo.', 'https://jbl.com.br/d'),
        ent('KZ EDX Pro é um IEM barato.', 'https://reddit.com/r/iems/comments/e/'),
      ];
      const validos = m.validarCandidatos(['JBL Quantum 50', 'KZ EDX Pro', 'HyperX Cloud Earbuds II', 'Redragon Zeus Pro'], entradas, {});
      const { lista, fora } = m.filtrarPorCategoria(validos.map((v) => ({ ...v })), entradas, 'top 10 fones intra auriculares para pubg de pc');
      const deFone = m.filtrarPorCategoria(validos.map((v) => ({ ...v })), entradas, 'melhores fones para pubg');
      const criterios = [{ nome: 'isolamento' }, { nome: 'conforto' }, { nome: 'ficha técnica' }];
      const numeracao = new Map([[1, 'isolamento'], [2, 'isolamento'], [5, 'conforto'], [7, 'ficha técnica'], [8, 'ficha técnica']]);
      const v = m.lerJulgamento(
        'isolamento: Trechos 1-2 (sem dados)\nconforto: Trecho 5 (sem dados)\nficha técnica: Trechos 7-8 (Conexão sem fio, alcance de 10m)',
        criterios,
        numeracao
      );
      return [
        fora.includes('Redragon Zeus Pro') && !lista.some((c) => c.nome === 'Redragon Zeus Pro') || `headset deveria sair de intra: ${lista.map((c) => c.nome)} / fora ${fora}`,
        ['JBL Quantum 50', 'KZ EDX Pro', 'HyperX Cloud Earbuds II'].every((n) => lista.some((c) => c.nome === n)) || `intras ficam: ${lista.map((c) => c.nome)}`,
        deFone.lista.some((c) => c.nome === 'Redragon Zeus Pro') || 'pedido de "fone" em geral aceita headset',
        v.get('isolamento') === null && v.get('conforto') === null || `"Trechos N (sem dados)" deveria ser sem dados: ${JSON.stringify([...v])}`,
        v.get('ficha técnica') === 'Conexão sem fio, alcance de 10m' || `ficha: ${v.get('ficha técnica')}`,
        m.coerenteComMotivo('fones com baixa latência são cruciais para jogos competitivos como PUBG', 'derrubada', '"conexões de baixa latência são cruciais"') === 'confirmada' ||
          'motivo que repete a hipótese confirma',
        m.coerenteComMotivo('fone caro é sempre melhor para jogos', 'confirmada', 'fone caro não é necessariamente melhor para jogos') === 'derrubada' ||
          'motivo que nega a hipótese derruba',
        m.coerenteComMotivo('fone barato serve para iniciante', 'confirmada', 'o QKZ AK6 custa 50 reais') === 'confirmada' || 'sem sobreposição, fica o veredito do modelo',
      ];
    },
  },

  {
    nome: '11º teste real: perfil do mapa vira critério que faltava; tópico da comunidade entra cru nos candidatos; vitrine não é motivo; lista top N pelo código',
    tipo: 'unidade',
    executar() {
      const mapa = { perfis: [{ perfil: 'casual', importa: 'conforto e isolamento sonoro' }, { perfil: 'pro', importa: 'qualidade do som e baixa latência' }] };
      const criterios = m.completarComPerfis([{ nome: 'isolamento sonoro' }, { nome: 'qualidade do som' }, { nome: 'conforto' }], mapa, 'fones pubg');
      const topico = {
        url: 'https://www.clubedohardware.com.br/forums/topic/1550172-fones-intra-auriculares-para-fps-de-pc-pubg-etc/',
        texto: '(nada relevante ao pedido em pesquisar_e_ler(clubedohardware.com.br))',
        bruto: 'TÓPICO DE FÓRUM: Fones intra-auriculares para FPS de PC\nPERGUNTA: qual intra pra pubg?\n- vai de kz edx pro, uso faz 2 anos',
        destilado: true,
      };
      const material = m.materialParaCandidatos([{ url: 'https://loja.com/x', texto: 'Loja de fones', bruto: 'Loja', destilado: true }, topico]);
      const c = m.consensoDe(
        'JBL Quantum 50',
        [
          { url: 'https://techtudo.com.br/a', bruto: 'JBL Quantum 50 – A partir de R$ 109. O JBL Quantum 50 tem drivers de 8,6 mm e microfone no cabo para jogar FPS.' },
        ],
        {}
      );
      const f = (nome, sites, topicos, motivo) => ({ nome, dominios: Array.from({ length: sites }, (_, i) => `s${i}.com`), consenso: { topicos, motivo: motivo ? { texto: motivo, dominio: 'reddit.com' } : null } });
      const lista = m.listaNumerada({ finalistas: [f('A1', 3, 2, 'great for footsteps'), f('B2', 2, 0)], outros: [f('C3', 1, 0)], quantidade: 10 });
      return [
        criterios.some((k) => k.nome === 'baixa latência') || `latência do perfil deveria virar critério: ${criterios.map((k) => k.nome)}`,
        criterios.length === 4 || 'critério já coberto não repete',
        /vai de kz edx pro/.test(material) || `o tópico "nada relevante" da comunidade deveria entrar cru: ${material}`,
        material.indexOf('clubedohardware') < material.indexOf('loja.com') || 'comunidade vem primeiro',
        /drivers de 8,6 mm/.test(c.motivo?.texto || '') || `motivo não pode ser linha de vitrine: ${JSON.stringify(c.motivo)}`,
        /^### Lista das 3 opções/.test(lista) || lista.split('\n')[0],
        // Etapa B: respaldo com palavras honestas (tópicos que recomendam primeiro)
        /1\. \*\*A1\*\* — recomendada em 2 tópicos da comunidade, citada em 3 sites; comparada na tabela acima — "great for footsteps" \(reddit\.com\)/.test(lista) || lista,
        /3\. \*\*C3\*\* — citada em 1 site; não pesquisada a fundo/.test(lista) || lista,
        /Achei 3 opções com respaldo no material, não 10/.test(lista) || 'deveria dizer que achou menos que o pedido',
        m.listaNumerada({ finalistas: [f('A1', 3, 2)], quantidade: 0 }) === '' || 'sem "top N", sem lista',
      ];
    },
  },
  {
    nome: '12º teste real: "JBL Quantum" (série) some dentro do "JBL Quantum 50"; "EDX Pro Intra-auricular" junta com "KZ EDX Pro"; headset não se salva com o "earbuds" de outro produto',
    tipo: 'unidade',
    executar() {
      const ent = (texto, url) => ({ texto, bruto: texto, url });
      const entradas = [
        ent('O JBL Quantum 50 é bom. Comprei o JBL Quantum 50 e gostei. JBL Quantum 100 é over-ear.', 'https://a.com/1'),
        ent('JBL Quantum 50 intra-auricular com microfone.', 'https://b.com/2'),
        ent('O fone KZ ZSN Pro é ótimo. KZ ZSN Pro 2 é a versão nova. O KZ ZSN Pro ainda vale.', 'https://c.com/3'),
        ent('Headset HyperX Cloud II com fio. O HyperX Cloud II é um headset.', 'https://d.com/4'),
        ent('Os fones intra HyperX Cloud Earbuds II são bons earbuds.', 'https://e.com/5'),
      ];
      const v = (nome, dominios) => ({ nome, dominios, mencoes: 1 });
      const lista = m.absorverSeries(
        [v('JBL Quantum', ['x.com']), v('JBL Quantum 50', ['a.com']), v('KZ ZSN Pro', ['c.com']), v('KZ ZSN Pro 2', ['c.com'])],
        entradas
      );
      const nomes = lista.map((c) => c.nome);
      const juntos = m.juntarVariantes([v('KZ EDX Pro', ['a']), v('EDX Pro Intra-auricular', ['b'])]);
      const validos = m.validarCandidatos(['HyperX Cloud II', 'HyperX Cloud Earbuds II', 'JBL Quantum 50', 'KZ ZSN Pro'], entradas, {});
      const { fora } = m.filtrarPorCategoria(validos.map((x) => ({ ...x })), entradas, 'top 10 fones intra auriculares para pubg');
      return [
        !nomes.includes('JBL Quantum') && nomes.includes('JBL Quantum 50') || `série deveria sumir: ${nomes}`,
        lista.find((c) => c.nome === 'JBL Quantum 50')?.dominios.includes('x.com') || 'os sites da série passam pro modelo',
        nomes.includes('KZ ZSN Pro') && nomes.includes('KZ ZSN Pro 2') || `modelo citado sozinho continua: ${nomes}`,
        juntos.length === 1 && juntos[0].nome === 'KZ EDX Pro' && juntos[0].dominios.length === 2 || `EDX Pro: ${JSON.stringify(juntos)}`,
        fora.includes('HyperX Cloud II') && !fora.includes('HyperX Cloud Earbuds II') || `headset Cloud II fora, Earbuds dentro: ${fora}`,
      ];
    },
  },

  {
    nome: '12º teste real: critério sobre a pesquisa ("feedback da comunidade") não entra; o que os tópicos da comunidade discutem ("footsteps", "imaging") vira critério',
    tipo: 'unidade',
    executar() {
      const mapa = { perfis: [{ perfil: 'comunidade gamer', importa: 'feedback da comunidade' }] };
      const perfis = m.completarComPerfis([{ nome: 'isolamento sonoro' }, { nome: 'conforto' }], mapa, 'fones pubg');
      const limpos = m.limparCriterios([{ nome: 'isolamento sonoro' }, { nome: 'feedback da comunidade' }, { nome: 'conforto' }], 'fones pubg');
      const topico = (url, txt) => ({ url, bruto: `TÓPICO DO REDDIT (r/iems): x\n${txt}`, texto: '' });
      const achadas = [
        topico('https://www.reddit.com/r/iems/comments/a/', '- Truthear Hexa has great imaging for footsteps'),
        topico('https://www.reddit.com/r/PUBATTLEGROUNDS/comments/b/', '- the soundstage matters, you hear footsteps'),
        topico('https://www.reddit.com/r/iems/comments/c/', '- positional audio and footsteps are everything'),
        topico('https://www.reddit.com/r/iems/comments/d/', '- the mic is fine'),
        { url: 'https://loja.com/x', bruto: 'footsteps footsteps latency latency', texto: '' },
      ];
      const crits = m.completarComComunidade([{ nome: 'isolamento sonoro', peso: 'alto' }, { nome: 'conforto', peso: 'alto' }], achadas);
      const pos = crits.find((k) => k.nome === 'posicionamento dos sons');
      return [
        !perfis.some((k) => /feedback/.test(k.nome)) || `"feedback da comunidade" do perfil não é critério: ${perfis.map((k) => k.nome)}`,
        !limpos.some((k) => /feedback/.test(k.nome)) || 'o plano também não pode ter critério de feedback',
        pos?.peso === 'alto' && pos?.daComunidade === 3 || `posicionamento (3 tópicos) deveria entrar com peso alto: ${JSON.stringify(crits)}`,
        !crits.some((k) => k.nome === 'latência e conexão') || 'latência só em loja (não tópico) não conta',
        !crits.some((k) => k.nome === 'microfone') || 'microfone em 1 tópico só não basta',
        crits.filter((k) => k.nome === 'conforto').length === 1 || 'critério já existente não repete',
      ];
    },
  },
  {
    nome: 'revisão v4 (Simgot EM6L × SuperMix 4): nomes entre parênteses viram as opções — sem descoberta, mesmo com o plano juntando as duas numa linha',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v4 nomeados entre parenteses',
          pedido: 'Entendi, qual fone dentre esses (Alfa X1 e Beta Z2) voce me recomendaria para jogar pubg ?',
          config: CONFIG(srv.porta, { profundidadePesquisa: 'media' }),
          planoDePesquisa: PLANO.replace('- nenhuma', '- Alfa X1, Beta Z2'),
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'comparação' } }],
          redacao: 'Resposta de teste.',
        });
        const fin = obtido.pesquisa?.plano?.opcoesCitadas || [];
        return [
          JSON.stringify(fin) === JSON.stringify(['Alfa X1', 'Beta Z2']) || `opções: ${JSON.stringify(fin)}`,
          ['alfa x1 especificacoes tecnicas', 'beta z2 especificacoes tecnicas'].every((q) => srv.consultas.includes(q)) || `buscas: ${srv.consultas.join(' | ')}`,
          !srv.consultas.some((q) => q.includes('descoberta')) || `rodou descoberta: ${srv.consultas.join(' | ')}`,
          obtido.promptCandidatos === '' || 'perguntou candidatos com as opções dadas',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'revisão v4 (Kinera): UM produto nomeado + "é bom para" vai pro motor como avaliação — ficha e comunidade dele, resposta sem "a recomendação é"',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa(REGRAS);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v4 avaliacao de um nomeado',
          pedido: 'Realize uma pesquisa sobre esse fone (Alfa X1) veja pra min se ele é bom para jogos fps ?',
          config: CONFIG(srv.porta, { profundidadePesquisa: 'media', respostaMontada: true }),
          planoDePesquisa: PLANO,
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'avaliação' } }],
          redacao: 'Resposta de teste.',
        });
        const fin = obtido.pesquisa?.plano?.opcoesCitadas || [];
        return [
          obtido.registro.tipoDePedido?.tipo === 'produto' || JSON.stringify(obtido.registro.tipoDePedido),
          JSON.stringify(fin) === JSON.stringify(['Alfa X1']) || `opções: ${JSON.stringify(fin)}`,
          srv.consultas.includes('alfa x1 especificacoes tecnicas') && srv.consultas.includes('site:reddit.com alfa x1') || `buscas: ${srv.consultas.join(' | ')}`,
          !srv.consultas.some((q) => q.includes('descoberta')) || 'rodou descoberta',
          !/A recomendação é/.test(obtido.resposta) || 'resposta de recomendação para uma avaliação',
          /Alfa X1 nesses critérios/.test(obtido.resposta) || `resposta: ${obtido.resposta.slice(0, 400)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
];
