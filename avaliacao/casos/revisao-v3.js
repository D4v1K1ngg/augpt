'use strict';

/**
 * Revisão v3 (03/10/2026, depois dos 4 chats reais de 29/09: 10 fones, Gojo,
 * táticas de PUBG, tutorial "dentro do jogo"). Fase 0 = bugs pontuais; Fase 1
 * = tipo de pedido; Fase 2 = assunto da conversa. Cada caso reproduz o que
 * aconteceu no chat real.
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { executarCasoAgente } = require('../motor');
const m = require('../../src/agent/motor-pesquisa');
const compositor = require('../../src/agent/compositor');
const protocolo = require('../../src/agent/protocolo');
const { normalizarSubtarefa, itemDaLeitura, Tarefa } = require('../../src/agent/tarefa');
const { Agent } = require('../../src/agent/loop');
const { Registro } = require('../../src/registro');
const { Sandbox } = require('../../src/tools/sandbox');
const files = require('../../src/tools/files');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');
const guia = require('../../src/agent/guia');
const assunto = require('../../src/agent/assunto-da-conversa');
const prompts = require('../../src/agent/prompts');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

// tópico de fórum Invision (mesma estrutura do Clube do Hardware; ver casos/comunidade.js)
const TOPICO = (titulo, pergunta, respostas) =>
  `<html><head><title>${titulo} - Clube do Hardware</title></head><body>
  <article><div data-role="commentContent" class="ipsType_normal ipsType_richText"><p>${pergunta}</p></div></article>
  ${respostas.map((r) => `<article><div data-role="commentContent" class="ipsType_normal ipsType_richText"><p>${r}</p></div></article>`).join('\n')}
  </body></html>`;

const PEDIDO_TATICAS =
  "Realize uma pesquisa profudanda para encontrar as melhores taticas de jogo para pubg de pc, analise principalmente o cenario 'competitivo' do jogo e veja o que podemos extrair dos profissionais de e-sports desse jogo";
const PEDIDO_TUTORIAL = "Eu queria um 'tutorial' para planejamento tático e movimentação eficiente dentro do jogo, poderia me ajudar ?";
const PEDIDO_GOJO = 'Por que o Satoru Gojo sempre usava uma venda tapando os seus olhos ?';

// o 7B falso do guia: uma dica por comentário que fala de zona/cobertura/
// veículo/comunicação — mais uma com comentário inexistente e uma com número
// que não está no comentário (o código tem de derrubar as duas)
const DICAS_FALSAS = [
  [/zone|zona/i, 'Rotacione cedo para a próxima zona, pela borda'],
  [/cover|cobertura/i, 'Sempre termine a rotação perto de uma cobertura'],
  [/vehicle|veiculo|carro/i, 'Use o veículo para atravessar campo aberto e largue antes da luta'],
  [/call|comunica/i, 'Faça calls curtas: direção e distância do inimigo'],
];
const dicasFalsas = (bruto) => {
  let prompt = String(bruto);
  try {
    prompt = JSON.parse(bruto).map((x) => x.content).join('\n');
  } catch {
    /* texto */
  }
  const linhas = [];
  for (const m of prompt.matchAll(/^\((\d+)\) (.*)$/gm)) {
    for (const [re, dica] of DICAS_FALSAS) if (re.test(m[2])) linhas.push(`- ${dica} | ${m[1]}`);
  }
  linhas.push('- Dica inventada sem comentário de verdade | 99');
  linhas.push('- Jogue 300 partidas por semana para subir | 1');
  return linhas.join('\n');
};

module.exports = [
  /* ------------------------------ Fase 0 ------------------------------ */
  {
    nome: 'v3 fase 0: "os 10 MELHOR fones" (singular) e "10 fones" pedem lista de 10; "10 anos", "5 mil", "8 GB" não',
    tipo: 'unidade',
    executar() {
      const q = m.quantidadePedida;
      return [
        q('Realize uma pesquisa profunda para encontrar os 10 melhor fones intra auriculares para se jogar pubg de pc') === 10 || 'chat real: "10 melhor fones" (vieram 5)',
        q('10 melhores fones') === 10 || '"10 melhores" continua',
        q('dez fones intra pra pubg') === 10 || '"dez fones"',
        q('me indique 6 mouses para fps') === 6 || '"6 mouses"',
        q('top 5 placas de vídeo') === 5 || 'top N continua',
        q('jogo PUBG há 10 anos, qual fone?') === 0 || '"10 anos" não é lista',
        q('orçamento de 5 mil reais em um PC') === 0 || '"5 mil" não é lista',
        q('quero um notebook com 8 GB de ram') === 0 || '"8 GB" não é lista',
      ];
    },
  },
  {
    nome: 'v3 fase 0: termo de busca mantém "visão", "gestão", "separação" (o \\b do JS cortava o "o" depois do acento)',
    tipo: 'unidade',
    executar() {
      const l = m.limparTermoDeBusca;
      return [
        l('visão do mapa') === 'visão mapa' || `"${l('visão do mapa')}" (chat real: "visã mapa")`,
        l('gestão da respiração') === 'gestão respiração' || `"${l('gestão da respiração')}"`,
        l('separação e detalhe') === 'separação detalhe' || `"${l('separação e detalhe')}"`,
        l('memória GDDR6X ou superior') === 'memória GDDR6X' || `"ou superior" sai: "${l('memória GDDR6X ou superior')}"`,
        l('posicionamento (imaging) dos sons') === 'posicionamento sons' || `parêntese sai: "${l('posicionamento (imaging) dos sons')}"`,
      ];
    },
  },
  {
    // 10/10: a mesma citação não aparece mais em dois produtos (ia no 1º e se repetia no 2º);
    // continua: uma tradução só, nenhuma cópia em inglês, citação em português intacta
    nome: 'v3 fase 0: citação em inglês com "a" é inglês; a citação repetida sai uma vez, traduzida, e o 2º produto fica com a dele',
    tipo: 'unidade',
    executar() {
      const topo = { texto: 'I have 10-ish different models, mostly for PUBG. Here are my top picks: a great set', fonte: 'r/PUBATTLEGROUNDS', votos: 7 };
      const r = {
        finalistas: [
          { nome: 'Simgot EM6L', consenso: { citacoes: [{ ...topo }] } },
          { nome: 'QKZ x HBB', consenso: { citacoes: [{ ...topo }, { texto: 'Eu uso o QKZ e é muito bom para passos', fonte: 'r/iems' }] } },
        ],
      };
      const lista = compositor.citacoesParaTraduzir(r);
      const frases = new Map([['C1', 'Tenho uns 10 modelos, a maioria para PUBG. Minhas escolhas: um ótimo conjunto']]);
      const texto = compositor.montarRecomendacao(r, frases);
      return [
        lista.length === 1 || `uma tradução só para a citação repetida (veio ${lista.length})`,
        (texto.match(/tradução do inglês/g) || []).length === 1 || 'a citação repetida sai uma vez só, traduzida',
        !/I have 10-ish/.test(texto) || 'nenhuma cópia em inglês',
        /Eu uso o QKZ/.test(texto) && !/Eu uso o QKZ[^\n]*tradução/.test(texto) || 'citação em português fica como está',
      ];
    },
  },
  {
    nome: 'v3 fase 0: resumo de ficha que repete a linha de formato do prompt é descartado (chat real: Kefine e QKZ)',
    tipo: 'unidade',
    executar() {
      const v = m.lerJulgamento('palco: o que os trechos dizem desta opção nesse critério\nisolamento: bom isolamento passivo (1)', [{ nome: 'palco' }, { nome: 'isolamento' }], new Map([[1, 'isolamento']]));
      return [
        m.semRestoDoPrompt('só dados técnicos dos trechos de FICHA TÉCNICA (tipo de conexão, números com unidade),') === null || 'eco da linha de ficha',
        m.semRestoDoPrompt('o que quem usou relata nos trechos de COMUNIDADE (prós e contras),') === null || 'eco da linha de comunidade',
        m.semRestoDoPrompt('Cabo 0.78mm QDC, 4 BA x lado, 8mm DD x lado.') === 'Cabo 0.78mm QDC, 4 BA x lado, 8mm DD x lado.' || 'ficha de verdade continua',
        !v.has('palco') || 'veredito que é eco da instrução não vira célula',
        v.get('isolamento') === 'bom isolamento passivo' || 'veredito normal continua',
      ];
    },
  },
  {
    nome: 'v3 fase 0: checklist e Tarefa usam a MESMA chave (sem acento); leitura marca o item que ela atende, não o primeiro pendente',
    tipo: 'unidade',
    executar() {
      const t = new Tarefa('x');
      t.atualizarSubtarefas([{ texto: 'Pesquisar opções de fones', status: 'pendente' }]);
      t.marcarSubtarefaComEvidencia('Pesquisar opcoes de fones');
      const ck = [
        { texto: 'Ler os mangás de Jujutsu Kaisen', status: 'pendente' },
        { texto: 'Pesquisar sobre o personagem Satoru Gojo no site oficial do anime Jujutsu Kaisen', status: 'pendente' },
      ];
      return [
        normalizarSubtarefa('Pesquisar  Opções de Fones') === 'pesquisar opcoes de fones' || normalizarSubtarefa('Pesquisar  Opções de Fones'),
        t.subtarefas[0].status === 'feito' || 'com e sem acento é o mesmo item',
        itemDaLeitura(ck, 'Satoru Gojo Jujutsu Kaisen site oficial')?.texto === ck[1].texto || 'a busca do Gojo atende o item 2, não o 1',
        itemDaLeitura(ck, 'listar_arquivos') === null || 'leitura sem relação não marca nada',
      ];
    },
  },
  {
    nome: 'v3 fase 0: checkpoint que não consulta o crítico (teto/desligado) apaga a recomendação velha',
    tipo: 'unidade',
    async executar() {
      const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'augpt-v3-'));
      const ag = new Agent({ config: { copiloto2Modo: 'desligado', workspace: raiz }, userDataPath: raiz });
      ag.ultimaRecomendacaoCritico = { status: 'perguntar', problema: 'de 10 passos atrás' };
      const r = await ag.criticaAutomatica({ fase: 'pre-redacao', objetivo: 'x', checklist: [], jaFeito: [], dossie: [] });
      return [r === null || 'sem consulta', ag.ultimaRecomendacaoCritico === null || 'recomendação velha ainda vale no pré-redação'];
    },
  },
  {
    nome: 'v3 fase 0: limite de passos COM material lido entrega resposta com aviso (antes jogava o dossiê fora)',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v3 limite com material',
        pedido: 'Resuma o arquivo base.txt',
        maxIterations: 2,
        arquivos: { 'base.txt': 'A pressão do pneu dianteiro recomendada é 32 psi em uso urbano, segundo o manual de 2024.' },
        config: { criticaPeriodica: false },
        roteiro: [{ ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } }],
        redacao: 'A pressão recomendada é 32 psi.',
      });
      return [
        obtido.ok || `deveria entregar: ${obtido.motivo}`,
        /32 psi/.test(obtido.resposta) || `resposta: ${obtido.resposta.slice(0, 200)}`,
        /limite de \d+ passos/.test(obtido.resposta) || 'aviso do limite na resposta',
        obtido.registro.limiteAtingido === true || 'registro marca o limite',
        /limite/.test(obtido.registro.statusDaTarefa?.motivos?.join(' ') || '') || `status: ${JSON.stringify(obtido.registro.statusDaTarefa)}`,
        obtido.registro.resposta && /32 psi/.test(obtido.registro.resposta) || 'resposta gravada no registro (antes o registro fechava no limite, sem resposta)',
      ];
    },
  },
  {
    nome: 'v3 fase 0: busca com nome de ferramenta ("listar_arquivos") ou URL inventada é recusada antes de rodar',
    tipo: 'unidade',
    async executar() {
      const cat = [{ name: 'listar_arquivos' }, { name: 'ler_arquivo' }, { name: 'pesquisar_e_ler' }];
      const f = { name: 'pesquisar_e_ler' };
      const s = (args, urls = new Set()) => protocolo.argumentoSemSentido(f, args, { catalogo: cat, urlsVistas: urls });
      const obtido = await executarCasoAgente({
        nome: 'v3 consulta = ferramenta',
        pedido: 'Por que o Satoru Gojo usa uma venda?',
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'listar_arquivos' } },
          { ferramenta: 'responder', argumentos: { foco: 'venda' } },
        ],
        redacao: 'Ele usa a venda para poupar os Seis Olhos.',
      });
      return [
        s({ consulta: 'listar_arquivos' }) !== null || 'chat real: busca "listar_arquivos"',
        s({ consulta: 'ler_arquivo -225' }) !== null || 'chat real: busca "ler_arquivo -225"',
        s({ consultas: ['listar_arquivos', 'ler_arquivo'] }) !== null || 'investigar_subtarefa com consultas = ferramentas',
        s({ consulta: 'https://www.youtube.com/watch?v=tutorial_planejamento_tatico' }) !== null || 'URL inventada',
        s({ consulta: 'https://a.com/x' }, new Set(['https://a.com/x'])) === null || 'URL que apareceu num resultado vale',
        s({ consulta: 'Satoru Gojo venda olhos' }) === null || 'consulta normal vale',
        obtido.protocolo.some((p) => p.estado === 'argumentos-invalidos') || 'o agente recebeu a correção',
        !obtido.ferramentasChamadas.includes('pesquisar_e_ler') || 'a busca absurda não rodou',
      ];
    },
  },
  {
    nome: 'v3 fase 0: acrescentar_ao_arquivo (ex-anexar_arquivo) recusa conteúdo vazio e arquivo de mídia; texto continua',
    tipo: 'unidade',
    async executar() {
      const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'augpt-v3-arq-'));
      const sandbox = new Sandbox(raiz);
      const ctx = { sandbox, config: {}, emit: () => {} };
      const t = files.find((x) => x.name === 'acrescentar_ao_arquivo');
      const erro = async (args) => {
        try {
          await t.run(args, ctx);
          return null;
        } catch (e) {
          return e.message;
        }
      };
      const vazio = await erro({ caminho: 'tutorial_planejamento_tatico_e_movimentacao.mp4' });
      const midia = await erro({ caminho: 'video.mp4', conteudo: 'x' });
      const ok = await erro({ caminho: 'notas.md', conteudo: 'linha nova' });
      const criados = await fs.readdir(raiz);
      return [
        !files.some((x) => x.name === 'anexar_arquivo') || 'nome antigo saiu do catálogo',
        Boolean(vazio) || 'chat real: criou .mp4 vazio',
        Boolean(midia) || 'mídia recusada',
        ok === null || `texto continua: ${ok}`,
        !criados.some((n) => n.endsWith('.mp4')) || `nenhum .mp4 criado: ${criados}`,
      ];
    },
  },
  {
    nome: 'v3 fase 0: numPredict da config chega à chamada de decisão (antes 1024 fixo; numPredictDecisao era morto)',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v3 numPredict',
        pedido: 'Diga oi',
        config: { numPredict: 777 },
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'oi' } }],
        redacao: 'Oi!',
      });
      return [obtido.opcoesDecisao[0]?.num_predict === 777 || `num_predict: ${JSON.stringify(obtido.opcoesDecisao[0])}`];
    },
  },
  {
    nome: 'v3 fase 0: a resposta do usuário ao perguntar_usuario vai pro registro (antes só "43 caracteres")',
    tipo: 'unidade',
    executar() {
      const ag = new EventEmitter();
      const reg = new Registro({ modelo: 'x' }).acompanhar(ag);
      ag.emit('pergunta', { id: 1, pergunta: 'Tem vídeos do YouTube?' });
      ag.emit('pergunta-respondida', { pergunta: 'Tem vídeos do YouTube?', resposta: 'não, pesquise você mesmo' });
      return [
        reg.dados.perguntas === 1 || 'contagem continua',
        reg.dados.dialogos[0]?.resposta === 'não, pesquise você mesmo' || JSON.stringify(reg.dados.dialogos),
      ];
    },
  },

  /* ------------------------------ Fase 1 ------------------------------ */
  {
    nome: 'v3 fase 1: tipo de pedido pelo OBJETO — táticas = guia, Gojo = explicação, fones/RTX/pros = produto, conceito = explicação, arquivo = local',
    tipo: 'unidade',
    executar() {
      const t = (x) => tipoDoPedido(x).tipo;
      return [
        t(PEDIDO_TATICAS) === 'guia' || `chat real (táticas → Core i7): ${t(PEDIDO_TATICAS)}`,
        t(PEDIDO_GOJO) === 'explicacao' || `chat real (Gojo): ${t(PEDIDO_GOJO)}`,
        t('Realize uma pesquisa profunda para encontrar os 10 melhor fones intra auriculares para se jogar pubg de pc') === 'produto' || 'fones',
        t('Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?') === 'produto' || 'RTX',
        t('fone mais usado pelos profissionais e-sports no PUBG de PC') === 'produto' || 'uso pro',
        t('qual a diferença entre vírus e bactéria') === 'explicacao' || 'conceito',
        t('explique a diferença entre TCP e UDP') === 'explicacao' || 'siglas são conceito',
        t('qual a diferença entre o KZ EDX Pro e o Truthear Hexa') === 'produto' || 'opções nomeadas',
        t('Resuma o arquivo relatorio.pdf') === 'local' || 'arquivo',
        t('como melhorar meu código') === 'livre' || '"como melhorar" sem jogo não é guia',
        t('como melhorar no PUBG') === 'guia' || '"como melhorar" com jogo é guia',
        t('qual o melhor mouse para controlar o recoil') === 'produto' || 'equipamento + escolha continua produto',
        m.modoDaPesquisa(PEDIDO_TATICAS) === 'guia' || `motor: ${m.modoDaPesquisa(PEDIDO_TATICAS)}`,
        m.modoDaPesquisa(PEDIDO_GOJO) === null || 'explicação fora do motor',
      ];
    },
  },
  {
    nome: 'v3 fase 1: guia — bateria pelo código (subreddit do jogo, guia, pros, português), sem "especificações técnicas"; dica com comentário inexistente ou número inventado sai',
    tipo: 'unidade',
    executar() {
      const jogos = [{ re: /\bpubg\b/, en: 'PUBG', sub: 'PUBATTLEGROUNDS', subCompetitivo: 'CompetitivePUBG' }];
      const q = guia.bateriaDoGuia({ objetivo: PEDIDO_TATICAS, jogos, maximo: 6 }).map((x) => x.consulta);
      const coments = [{ n: 1, texto: 'rotate early to the next zone', integral: 'rotate early to the next zone' }, { n: 2, texto: 'take cover after 2 minutes', integral: 'take cover after 2 minutes' }];
      const d = guia.lerDicasDoTopico('- Rotacione cedo para a próxima zona | 1\n- Proteja-se depois de 2 minutos | 2\n- Jogue 300 partidas | 2\n- Inventada | 9\n- <a dica em português, curta e prática, até 20 palavras> | 1', coments);
      const grupos = guia.agruparDicas([
        { texto: 'Rotacione cedo para a próxima zona', fonte: { chave: 'a', comunidade: true, votos: 7 } },
        { texto: 'Rotacione cedo para a zona seguinte', fonte: { chave: 'b', comunidade: true, votos: 3 } },
        { texto: 'Use smoke antes de reviver', fonte: { chave: 'a', comunidade: true, votos: 1 } },
      ]);
      return [
        q.some((c) => /r\/PUBATTLEGROUNDS/.test(c)) || `subreddit do jogo: ${q}`,
        q.some((c) => /r\/CompetitivePUBG/.test(c)) || `competitivo: ${q}`,
        q.some((c) => /pro players/.test(c)) || 'profissionais',
        !q.some((c) => /especifica|spec/i.test(c)) || 'sem ficha técnica',
        d.length === 2 || `dicas válidas: ${JSON.stringify(d.map((x) => x.dica))}`,
        grupos[0].nFontes === 2 && grupos[0].votos === 10 || `agrupamento: ${JSON.stringify(grupos[0])}`,
        guia.secaoDaDica('Nunca corra em campo aberto') === 'Erros comuns' || 'erro comum',
        guia.secaoDaDica('Rotacione cedo para a próxima zona') === 'Rotação e zona' || 'etapa',
      ];
    },
  },
  {
    nome: 'v3 fase 1 (ponta a ponta, chat real "melhores táticas de PUBG"): vai pro GUIA — dicas da comunidade com fonte e votos, por etapa da partida; nenhum produto, nenhuma ficha',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'r/pubattlegrounds',
          mesmoHost: true,
          paginas: [
            TOPICO('Good players of PUBG, what tips can you give?', 'What tactics do good players use in competitive?', [
              'Rotate early to the next zone, stay on the edge of the circle.',
              'Always end your rotation near hard cover, never in an open field.',
              'Use a vehicle to cross open fields and ditch it before the fight.',
            ]),
          ],
        },
        {
          contem: 'pubg competitive tactics advice',
          mesmoHost: true,
          paginas: [
            TOPICO('Detailed strategy training for competitive PUBG', 'Looking for detailed strategy', [
              'Zone first: rotate before the circle closes, play the edge.',
              'Make short calls: direction and distance of the enemy.',
              'Hard cover wins fights, look for cover before shooting.',
            ]),
          ],
        },
        { contem: 'core i7', paginas: [pagina('Core i7 10700F custa R$ 1.150.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v3 guia taticas',
          pedido: PEDIDO_TATICAS,
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, respostaMontada: true, nivelRaciocinio: 'medio', modoExplicacao: true },
          dicasDoTopico: dicasFalsas,
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'táticas' } }],
          redacao: 'Resposta de teste.',
        });
        const g = obtido.pesquisa.guia || {};
        const textos = (g.dicas || []).map((d) => d.texto);
        return [
          obtido.pesquisa.modo?.modo === 'guia' || `modo: ${JSON.stringify(obtido.pesquisa.modo)}`,
          obtido.promptsDicas.length >= 2 || `extração de dicas por tópico: ${obtido.promptsDicas.length}`,
          obtido.promptsProdutosDoTopico.length === 0 || 'não procura produto',
          !srv.consultas.some((c) => /especificac|core i7/.test(c)) || `buscas de produto: ${srv.consultas.join(' | ')}`,
          textos.some((x) => /zona/.test(x)) && textos.some((x) => /cobertura/.test(x)) || `dicas: ${textos.join(' / ')}`,
          !textos.some((x) => /inventada|300 partidas/i.test(x)) || 'dica inventada passou',
          (g.dicas || []).find((d) => /zona/.test(d.texto))?.fontes === 2 || `"zona" em 2 tópicos: ${JSON.stringify(g.dicas)}`,
          /### (Passo a passo|O que funciona)/.test(obtido.resposta) || `resposta montada: ${obtido.resposta.slice(0, 300)}`,
          /Rotação e zona/.test(obtido.resposta) || 'etapa da partida na resposta',
          !/Core i7|Ficha|Tabela/.test(obtido.resposta) || 'produto/ficha na resposta de táticas',
          /tópicos? da comunidade/.test(obtido.resposta) || 'respaldo de cada dica',
          obtido.registro.tipoDePedido?.tipo === 'guia' || `registro: ${JSON.stringify(obtido.registro.tipoDePedido)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'v3 fase 1 (ponta a ponta, chat real do Gojo): explicação no nível extremo — sem plano de 8 passos, sem crítico periódico, responder na 2ª decisão',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'gojo', paginas: [pagina('Satoru Gojo usa a venda porque os Seis Olhos captam energia amaldiçoada o tempo todo e cansam o cérebro; a venda reduz esse fluxo desde 2018.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v3 explicacao gojo',
          pedido: PEDIDO_GOJO,
          config: {
            searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false,
            pipelineForcadoUniversal: true, criticaPeriodica: true, criticaPeriodicaIntervaloComplexo: 1, criticaPeriodicaMaxComplexo: 20, modoExplicacao: true,
          },
          planejamentoInicial: '- Pesquisar no site oficial\n- Ler os mangás de Jujutsu Kaisen\n- Pesquisar entrevistas com o autor\n- Responder',
          criticaDoPlano: '{"status":"perguntar","problema":"as tarefas 2 a 8 estão pendentes"}',
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'Satoru Gojo venda olhos motivo' } },
            { ferramenta: 'responder', argumentos: { foco: 'venda' } },
          ],
          redacao: 'Ele usa a venda para poupar os Seis Olhos, que cansam o cérebro.',
        });
        return [
          obtido.chamadasPlanejamento === 0 || `plano inicial chamado ${obtido.chamadasPlanejamento}x`,
          obtido.chamadasCriticaPlano === 0 || `crítico periódico chamado ${obtido.chamadasCriticaPlano}x`,
          obtido.ok && /Seis Olhos/.test(obtido.resposta) || `resposta: ${obtido.resposta.slice(0, 200)}`,
          obtido.passos <= 2 || `passos: ${obtido.passos}`,
          /PEDIDO DE EXPLICAÇÃO/.test(obtido.promptDecisao) || 'método curto no prompt',
          obtido.registro.tipoDePedido?.tipo === 'explicacao' || JSON.stringify(obtido.registro.tipoDePedido),
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'v3 fase 1: modoExplicacao: false volta ao comportamento antigo (plano forçado para "por que…")',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v3 explicacao desligada',
        pedido: PEDIDO_GOJO,
        config: { pipelineForcadoUniversal: true, criticaPeriodica: false, modoExplicacao: false },
        planejamentoInicial: '- Pesquisar o motivo\n- Responder',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'venda' } }],
        redacao: 'Resposta.',
      });
      return [obtido.chamadasPlanejamento === 1 || `plano inicial: ${obtido.chamadasPlanejamento}`];
    },
  },

  /* ------------------------------ Fase 2 ------------------------------ */
  {
    nome: 'v3 fase 2: "dentro do jogo" vira "dentro do jogo (PUBG de PC)" pela conversa; "qual o fone de ouvido…" e "o personagem Satoru Gojo" não são referência',
    tipo: 'unidade',
    executar() {
      const conv = [
        { role: 'user', content: PEDIDO_TATICAS },
        { role: 'assistant', content: 'A recomendação é o Core i7 10700F.' },
      ];
      const r = assunto.resolverReferencia(PEDIDO_TUTORIAL, conv);
      const fones = [{ role: 'user', content: '10 melhores fones intra para pubg de pc' }];
      return [
        r.mudou && /dentro do jogo \(PUBG de PC\)/.test(r.objetivo) || `chat real: ${r.objetivo}`,
        assunto.assuntoDaConversa(conv).jogo === 'PUBG' || 'assunto vem do pedido do usuário, não da resposta',
        !assunto.resolverReferencia("Qual o fone de ouvido mais usado pelos profissionais 'e-sports' no pubg de pc ?", fones).mudou || 'pergunta nova com assunto próprio',
        !assunto.resolverReferencia('Por que o personagem Satoru Gojo usa venda?', conv).mudou || 'nome próprio depois do substantivo',
        /intra-auricular/.test(assunto.resolverReferencia('e esse fone, é bom pra música?', fones).objetivo) || 'fone → categoria da conversa',
        !assunto.resolverReferencia(PEDIDO_TUTORIAL, []).mudou || 'sem conversa, nada muda',
        prompts.referenciaConversa(PEDIDO_TUTORIAL, conv) === true || 'redação recebe a conversa',
        tipoDoPedido(r.objetivo).tipo === 'guia' || 'o tutorial resolvido é guia',
      ];
    },
  },
  {
    nome: 'v3 fase 2 (ponta a ponta, chat real do tutorial): o objetivo ganha "(PUBG de PC)", o guia busca PUBG e a página de GTA Online não entra',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'r/pubattlegrounds',
          mesmoHost: true,
          paginas: [
            TOPICO('Movement and tactical planning tips?', 'How do you plan rotations in PUBG?', [
              'Rotate early to the next zone and plan the path with cover.',
              'Use a vehicle to cross open fields, ditch it before the fight.',
              'Hard cover first, then look for the angle.',
            ]),
          ],
        },
        { contem: 'no jogo', paginas: [pagina('Grand Theft Auto Online: missões de 2016 e corridas de acrobacias.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v3 tutorial dentro do jogo',
          pedido: PEDIDO_TUTORIAL,
          conversa: [
            { role: 'user', content: PEDIDO_TATICAS },
            { role: 'assistant', content: 'A recomendação é o Core i7 10700F.' },
          ],
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, respostaMontada: true, nivelRaciocinio: 'leve', modoExplicacao: true },
          dicasDoTopico: dicasFalsas,
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'tutorial' } }],
          redacao: 'Resposta de teste.',
        });
        const reescrito = obtido.objetivoReescrito?.reescrito || '';
        return [
          /\(PUBG de PC\)/.test(reescrito) || `objetivo: ${JSON.stringify(obtido.objetivoReescrito)}`,
          obtido.registro.assuntoDaConversa?.assunto?.jogo === 'PUBG' || JSON.stringify(obtido.registro.assuntoDaConversa),
          obtido.pesquisa.modo?.modo === 'guia' || `modo: ${JSON.stringify(obtido.pesquisa.modo)}`,
          srv.consultas.every((c) => /pubg|pubattlegrounds/.test(c)) || `toda busca do guia leva o jogo: ${srv.consultas.join(' | ')}`,
          !/GTA|Grand Theft/.test(obtido.resposta) || 'GTA na resposta',
          /### Passo a passo/.test(obtido.resposta) || `tutorial vira passo a passo: ${obtido.resposta.slice(0, 200)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------------------ achados do revisor ------------------------------ */
  {
    nome: 'v3 revisor: desempenho e uso pro continuam no motor; "top 10 táticas"/"em 2026" não viram produto; código e dev não viram guia; "salve!" e "planilha" não tiram compra do motor',
    tipo: 'unidade',
    executar() {
      const r = m.modoDaPesquisa;
      const t = (x) => tipoDoPedido(x).tipo;
      return [
        r('quantos fps a mais a rtx 5080 faz que a 5070 ti') === 'desempenho' || 'desempenho fora do motor',
        r('o que os pros de valorant usam de mouse') === 'uso-profissional' || 'uso pro fora do motor',
        r('top 10 táticas de CS2') === 'guia' || `top 10 táticas: ${r('top 10 táticas de CS2')}`,
        r('melhores táticas de pubg em 2026') === 'guia' || 'ano não é modelo',
        r('salve! qual o melhor mouse gamer até 200 reais?') === 'recomendacao' || '"salve" é saudação',
        r('qual o melhor notebook para trabalhar com planilha') === 'recomendacao' || 'planilha no meio do pedido de compra',
        r('como funciona o dlss e qual a melhor placa para usar') === 'recomendacao' || 'explicação + escolha de produto',
        t('como melhorar o fps do meu jogo godot') !== 'guia' || 'dev de jogo',
        t('tutorial de react para iniciantes') !== 'guia' || 'tutorial de programação',
        t('estratégias de cache em redis') !== 'guia' || 'estratégia de código',
        t('crie um programa em python que mostre como funciona o bubble sort') !== 'explicacao' || 'tarefa de código',
        t('o que é um buffer overflow? escreva um relatório em pdf') !== 'explicacao' || 'explicação + criar arquivo',
        m.quantidadePedida('os 5 sentidos') === 0 || 'os 5 sentidos',
        m.quantidadePedida('me indica 4 mouses') === 4 || 'me indica 4 mouses',
        m.quantidadePedida('qual o melhor fone para os 6 jogos que eu jogo') === 0 || '6 jogos que eu jogo',
      ];
    },
  },
  {
    nome: 'v3 revisor: assunto da conversa não corrompe arquivo, dev de jogo, nome próprio novo, livro/anime nem categoria diferente; "fone de ouvido" e "nesse mapa" resolvem',
    tipo: 'unidade',
    executar() {
      const pubg = [{ role: 'user', content: 'melhores taticas de jogo para pubg de pc' }];
      const rtx = [{ role: 'user', content: 'RTX 4060 vs RX 7600 qual a melhor?' }];
      const fones = [{ role: 'user', content: 'melhores fones intra para pubg' }];
      const r = (x, c) => assunto.resolverReferencia(x, c);
      return [
        !r('abra o jogo.html e corrija o bug', pubg).mudou || 'nome de arquivo',
        !r('adicione um placar ao jogo', pubg).mudou || 'dev de jogo',
        !r('sobre o jogo que eu estava jogando ontem, o Hollow Knight', pubg).mudou || 'nome próprio novo',
        !r('resuma o livro que anexei', pubg).mudou || 'livro',
        !r('esse fone é bom?', rtx).objetivo.includes('RTX') || 'produto de outra categoria',
        /fone de ouvido \(intra-auricular/.test(r('o fone de ouvido tem microfone?', fones).objetivo) || r('o fone de ouvido tem microfone?', fones).objetivo,
        /nesse mapa \(PUBG/.test(r('e nesse mapa?', pubg).objetivo) || r('e nesse mapa?', pubg).objetivo,
      ];
    },
  },
  {
    nome: 'v3 revisor: dica sem relação com o comentário sai; página de outro jogo não vira dica; busca "os_walk python" e "read_csv" não é recusada; guia sem jogo busca só em português',
    tipo: 'unidade',
    executar() {
      const coms = [{ n: 1, texto: 'rotate early to the next zone', integral: 'rotate early to the next zone' }, { n: 2, texto: 'lol nice', integral: 'lol nice' }];
      const d = guia.lerDicasDoTopico('- Sempre jogue com fones de ouvido e volume alto | 2\n- Rotacione cedo para a próxima zona | 1', coms);
      const gta = guia.dicasDaPagina({ titulo: 'GTA Online', texto: '- Use veículos blindados para proteger suas operações.\n- Evite missões sem equipe.' }, 4, /\bpubg\b/);
      const cat = [{ name: 'listar_arquivos' }];
      const f = { name: 'pesquisar_e_ler' };
      const q = guia.bateriaDoGuia({ objetivo: 'dicas de segurança na internet', jogos: [], maximo: 6 }).map((x) => x.consulta);
      return [
        d.length === 1 && /zona/.test(d[0].dica) || `dicas: ${JSON.stringify(d.map((x) => x.dica))}`,
        gta.length === 0 || 'página de GTA numa pesquisa de PUBG',
        protocolo.argumentoSemSentido(f, { consulta: 'os_walk python' }, { catalogo: cat }) === null || 'os_walk',
        protocolo.argumentoSemSentido(f, { consulta: 'read_csv' }, { catalogo: cat }) === null || 'read_csv',
        q.every((c) => /segurança/.test(c) && !/\b(guide|tips)\b/.test(c)) || `consultas: ${q.join(' | ')}`,
      ];
    },
  },
  {
    nome: 'tipo de pedido (300 execuções reais, 11/10): "Como um gerador funciona ?", "como que … aconteceu?", "Me conte mais sobre…" e "…o que acontece?" são explicação; "como faço X funcionar", script e top 5 não',
    tipo: 'unidade',
    async executar() {
      const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');
      const tipo = (p) => tipoDoPedido(p).tipo;
      const sim = ['Como um gerador funciona ?', 'como que o acidente de chernobyl aconteceu?', 'Me conte mais sobre o Black bird sr71', 'Se um avião perder todos os seus motores durante um voo o que acontece ?', 'Como o plastico é feito ?', 'Me explique como que um alto falante funciona ?'];
      const nao = ['Como eu faço o wifi funcionar no notebook', 'crie um script que mostre como um gerador funciona', 'Me recomende um top 5 melhores fones intra auriculares para se jogar pubg de pc', 'Qual o avião mais rapido do mundo ?'];
      return [
        ...sim.map((p) => tipo(p) === 'explicacao' || `deveria ser explicação (${tipo(p)}): ${p}`),
        ...nao.map((p) => tipo(p) !== 'explicacao' || `não é explicação: ${p}`),
      ];
    },
  },
];
