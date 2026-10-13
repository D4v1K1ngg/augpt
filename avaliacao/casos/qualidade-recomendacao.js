'use strict';

/**
 * Qualidade da resposta de recomendação (diagnóstico de 10/10, itens que a
 * revisão v6 não cobriu): frase-formulário repetida em todo produto, falta de
 * limitações e de preço, "qual escolher" de uma linha e tabela com trecho em
 * inglês cortado. Cenário baseado no experimento dos 5 IEMs (09/10).
 */

const c = require('../../src/agent/compositor');
const m = require('../../src/agent/motor-pesquisa');

const CRITERIOS = [
  { nome: 'passos e posicionamento', peso: 'alto', porque: 'ouvir de onde vem cada passo' },
  { nome: 'palco sonoro', peso: 'alto', porque: 'separar perto de longe' },
  { nome: 'isolamento', peso: 'medio', porque: 'o barulho da casa não cobre os passos' },
];

const celulas = {
  'Kefine Delci AE|passos e posicionamento': { dominios: new Set(['reddit.com', 'site.com']), trechos: [{ texto: 'Waiting for my simgot eg280 I have heard the Kefine images well' }] },
  'Kefine Delci AE|palco sonoro': { dominios: new Set(['reddit.com', 'outro.com']), trechos: [{ texto: 'The Kefine stage is wide for the price' }], veredito: 'palco amplo para o preço' },
  'Ziigaat Arete|passos e posicionamento': { dominios: new Set(['reddit.com']), trechos: [{ texto: 'Arete has precise imaging' }] },
};

function cenario() {
  return {
    modo: 'recomendacao',
    plano: { criterios: CRITERIOS, uso: 'jogar PUBG no PC', tipoDeUso: 'FPS competitivo' },
    finalistas: [
      {
        nome: 'Kefine Delci AE',
        status: { 'passos e posicionamento': 'corroborado', 'palco sonoro': 'corroborado', isolamento: 'sem dados' },
        consenso: {
          topicos: 3,
          criticas: 1,
          citacoes: [
            { texto: 'Kefine Delci AE is my go-to for PUBG, footsteps are very clear.', fonte: 'r/PUBATTLEGROUNDS', votos: 12, tom: 'recomenda' },
            { texto: 'The Kefine Delci AE fit is bulky and hurts after a few hours.', fonte: 'r/iems', votos: 4, tom: 'critica' },
          ],
        },
      },
      {
        nome: 'Ziigaat Arete',
        status: { 'passos e posicionamento': 'fonte única', 'palco sonoro': 'contraditório', isolamento: 'sem dados' },
        consenso: { topicos: 2, criticas: 0, citacoes: [{ texto: 'Ziigaat Arete sounds great in shooters.', fonte: 'r/iems', votos: 3, tom: 'recomenda' }] },
      },
    ],
    matriz: { celula: (o, k) => celulas[`${o}|${k}`] || null, resumos: new Map() },
    precos: {
      'Kefine Delci AE': { moeda: 'BRL', mediana: 520, min: 480, max: 560, n: 3 },
      'Ziigaat Arete': { moeda: 'BRL', mediana: 890, min: 890, max: 890, n: 1 },
    },
  };
}

module.exports = [
  {
    nome: 'qualidade: frase-formulário ("entrou devido à sua excelente…" ou 3+ critérios numa frase) é recusada e vira a frase feita da evidência',
    tipo: 'unidade',
    executar() {
      const r = cenario();
      const lidas = c.lerFrases(
        [
          'Kefine Delci AE: Esta opção entrou devido à sua excelente passos e posicionamento, palco sonoro e isolamento.',
          'Ziigaat Arete: Ótimo em passos e posicionamento, palco sonoro e isolamento segundo as fontes.',
          'DIRETA: Recomendo o Kefine Delci AE: quem joga diz que os passos ficam claros.',
        ].join('\n'),
        { produtos: r.finalistas.map((f) => f.nome), numerosPermitidos: c.numerosDaComposicao(r), criterios: CRITERIOS.map((k) => k.nome) }
      );
      const texto = c.montar(r, lidas);
      return [
        !lidas.has('KEFINE DELCI AE') || 'a frase "entrou devido" deveria ser recusada',
        !lidas.has('ZIIGAAT ARETE') || 'frase com 3 critérios listados deveria ser recusada',
        lidas.has('DIRETA') || 'a resposta direta com fato concreto continua',
        !/entrou devido/.test(texto) || 'a frase-formulário não pode chegar à resposta',
      ];
    },
  },
  {
    nome: 'qualidade: cada opção tem preço observado e "Limitações" (crítica do usuário, fontes que discordam, critério de peso alto sem evidência); sem nada, diz que o material não trouxe',
    tipo: 'unidade',
    executar() {
      const r = cenario();
      const texto = c.montar(r, new Map());
      const bloco = (nome) => texto.split(/\n#### /).find((b) => b.includes(nome) && /^\d\./.test(b)) || '';
      const kefine = bloco('Kefine Delci AE');
      const arete = bloco('Ziigaat Arete');
      // 11/10: formato de cartão — "Faixa de preço", "Na comunidade" e "Ponto de atenção"
      const usuarios = (kefine.split('**Na comunidade:**')[1] || '').split('**Ponto de atenção')[0];
      const semNada = c.montar({ ...cenario(), finalistas: [{ ...cenario().finalistas[0], status: { 'passos e posicionamento': 'corroborado', 'palco sonoro': 'corroborado', isolamento: 'corroborado' }, consenso: { topicos: 2, citacoes: [] } }] }, new Map());
      return [
        /\*\*Faixa de preço:\*\* R\$ 480 a R\$ 560/.test(kefine) || `preço do Kefine: ${kefine.slice(0, 300)}`,
        /^1\. Kefine Delci AE\n\*Recomendação principal\*\n/.test(kefine) || `o 1º leva o selo logo abaixo do nome: ${kefine.slice(0, 80)}`,
        /\*\*Ponto de atenção:\*\*/.test(kefine) && /hurts after a few hours/.test(kefine.split('**Ponto de atenção:**')[1] || '') || 'a crítica do usuário tem que ir em Ponto de atenção',
        !/hurts after/.test(usuarios) || 'a crítica não pode aparecer como "o que os usuários dizem" a favor',
        /discordam sobre palco sonoro/.test(arete) || `fontes que discordam viram limitação: ${arete}`,
        /sem evidência sobre/.test(arete) === false || 'isolamento é peso médio: não entra como limitação de peso alto',
        /não trouxe críticas nem pontos fracos/.test(semNada) || 'sem crítica nem lacuna, a resposta diz que o material não trouxe',
      ];
    },
  },
  {
    nome: 'qualidade: "Qual escolher" explica por que o 1º ganha do 2º e aponta o mais barato; a tabela não mostra trecho em inglês cortado',
    tipo: 'unidade',
    executar() {
      const r = cenario();
      r.finalistas[1].consenso.topicos = 1;
      r.precos['Ziigaat Arete'].mediana = 300;
      const texto = c.montar(r, new Map());
      const tabela = (texto.split('### Tabela')[1] || '').split('###')[0];
      return [
        /\*\*Melhor no geral:\*\* Kefine Delci AE — ficou à frente do Ziigaat Arete por ter mais recomendações na comunidade \(3 tópicos contra 1\)/.test(texto) || `motivo do 1º: ${(texto.match(/Melhor no geral.*$/m) || [''])[0]}`,
        /\*\*Pelo preço:\*\* o menor preço observado em real, Ziigaat Arete \(R\$ 300\)/.test(texto) || `pelo preço: ${(texto.match(/Pelo preço.*$/m) || ['(ausente)'])[0]}`,
        !/Waiting for my|I have heard/.test(tabela) || `trecho em inglês na tabela: ${tabela}`,
        /palco amplo para o preço/.test(tabela) || 'veredito curto em português continua na célula',
        /2\+ fontes comentam/.test(tabela) || 'sem veredito, a célula diz quantas fontes comentam',
      ];
    },
  },
  {
    nome: 'qualidade: o modelo recebe o que o material diz de cada produto (trecho, preço, crítica), não a lista de critérios com evidência',
    tipo: 'unidade',
    executar() {
      const pedido = c.pedidoDeFrases(cenario(), 'Quais os melhores IEMs para PUBG no PC?');
      const linhaKefine = pedido.split('\n').find((l) => /^1\. Kefine/.test(l)) || '';
      return [
        !/evidência a favor em:/.test(pedido) || 'a lista de critérios com evidência não deveria ir para o modelo',
        /palco amplo para o preço/.test(linhaKefine) || `trecho do material: ${linhaKefine}`,
        /preço observado: R\$ 480 a R\$ 560/.test(linhaKefine) || 'o preço observado vai junto',
        /crítica de um usuário/.test(linhaKefine) || 'a crítica vai junto, para a frase poder trazer a ressalva',
        /frases diferentes para cada um/.test(pedido) || 'a instrução contra frase repetida tem que estar no pedido',
      ];
    },
  },
  {
    nome: 'qualidade: preço por opção vem só de frase que cita a opção e nenhuma outra; real tem preferência; parcela não conta',
    tipo: 'unidade',
    executar() {
      const entradas = [
        { bruto: 'O Kefine Delci AE sai por R$ 499 na loja. O Ziigaat Arete custa US$ 129 lá fora.' },
        { bruto: 'Kefine Delci AE e Ziigaat Arete juntos por R$ 999 no combo.' },
        { bruto: 'Ziigaat Arete em 10x de R$ 89 sem juros. Kefine Delci AE agora por R$ 459.' },
      ];
      const p = m.precosDasOpcoes(entradas, [{ nome: 'Kefine Delci AE' }, { nome: 'Ziigaat Arete' }]);
      return [
        p['Kefine Delci AE']?.moeda === 'BRL' && p['Kefine Delci AE'].min === 459 && p['Kefine Delci AE'].max === 499 || `Kefine: ${JSON.stringify(p['Kefine Delci AE'])}`,
        p['Ziigaat Arete']?.moeda === 'USD' && p['Ziigaat Arete'].mediana === 129 || `Arete (sem real, vale o dólar; combo e parcela fora): ${JSON.stringify(p['Ziigaat Arete'])}`,
      ];
    },
  },

  // ---- segunda rodada (pesquisa real de 10/10, 11:25: EM6L, Kefine, Supermix 4, Vivace, QKZ) ----
  {
    nome: 'qualidade 2: produto sem crítica não ganha ressalva inventada ("mas o preço é baixo", "fora do seu orçamento"); com crítica, a ressalva passa',
    tipo: 'unidade',
    executar() {
      const r = cenario(); // Kefine tem crítica; Arete não
      const opcoes = { produtos: r.finalistas.map((f) => f.nome), numerosPermitidos: c.numerosDaComposicao(r), criterios: CRITERIOS.map((k) => k.nome), semCritica: c.produtosSemCritica(r) };
      const lidas = c.lerFrases(
        [
          'Ziigaat Arete: Quem joga destaca o imaging preciso, mas pode estar fora do seu orçamento.',
          'Kefine Delci AE: Os passos ficam claros, mas o encaixe incomoda depois de algumas horas.',
        ].join('\n'),
        opcoes
      );
      const pedido = c.pedidoDeFrases(r, 'top fones para PUBG');
      return [
        c.produtosSemCritica(r).join() === 'Ziigaat Arete' || `sem crítica: ${c.produtosSemCritica(r)}`,
        !lidas.has('ZIIGAAT ARETE') || 'ressalva inventada no produto sem crítica deveria ser recusada',
        lidas.has('KEFINE DELCI AE') || 'ressalva de produto COM crítica é legítima',
        /Ziigaat Arete: <3 ou 4 frases[^\n]*NÃO tem crítica/.test(pedido) || 'o pedido avisa que o produto não tem crítica',
      ];
    },
  },
  {
    nome: 'qualidade 2: resposta direta que não fala do uso ("qualidade de áudio hifi e design versátil") é recusada; a que fala de passos passa',
    tipo: 'unidade',
    executar() {
      const r = cenario();
      const opcoes = { produtos: r.finalistas.map((f) => f.nome), numerosPermitidos: c.numerosDaComposicao(r), criterios: CRITERIOS.map((k) => k.nome) };
      const generica = c.lerFrases('DIRETA: Recomendo o Kefine Delci AE por sua qualidade de áudio hifi e design versátil.', opcoes);
      const doUso = c.lerFrases('DIRETA: Recomendo o Kefine Delci AE: quem joga PUBG diz que os passos e o posicionamento ficam claros.', opcoes);
      return [!generica.has('DIRETA') || 'direta genérica deveria cair na frase da evidência', doUso.has('DIRETA') || 'direta ligada ao uso continua'];
    },
  },
  {
    nome: 'qualidade 2: a mesma citação não se repete em dois produtos; comentário-lista só entra quando não há outro; crítica-lista não vira limitação',
    tipo: 'unidade',
    executar() {
      const lista = { texto: 'Minhas escolhas pra PUBG: Tripowin Vivace 35€, Simgot EM6L 120€, Truthear Zero Blue 60€, QKZ x HBB 20€', fonte: 'r/PUBATTLEGROUNDS', votos: 7, tom: 'recomenda', lista: true };
      const r = {
        modo: 'recomendacao',
        plano: { criterios: CRITERIOS },
        finalistas: [
          { nome: 'Simgot EM6L', status: {}, consenso: { topicos: 8, citacoes: [{ ...lista }, { texto: 'Uso o Simgot EM6L e ouço os passos chegando.', fonte: 'r/PUBATTLEGROUNDS', votos: 4, tom: 'recomenda' }] } },
          { nome: 'Tripowin Vivace', status: {}, consenso: { topicos: 5, citacoes: [{ ...lista }, { texto: 'O que eu não recomendaria: Salnotes Zero, Moondrop Chu, Tripowin Vivace', tom: 'critica', lista: true, fonte: 'r/x' }] } },
        ],
        matriz: { celula: () => null, resumos: new Map() },
      };
      const texto = c.montar(r, new Map());
      const vezes = (texto.match(/Minhas escolhas pra PUBG/g) || []).length;
      const em6l = texto.split('#### 2.')[0];
      return [
        vezes <= 1 || `comentário-lista apareceu ${vezes} vezes`,
        em6l.indexOf('Uso o Simgot EM6L') < em6l.indexOf('Minhas escolhas') || em6l.indexOf('Minhas escolhas') < 0 || 'o comentário sobre o próprio produto vem antes do comentário-lista',
        !/não recomendaria/.test(texto) || 'crítica que é lista de vários produtos não vira limitação',
      ];
    },
  },
  {
    nome: 'qualidade 2: consenso — críticas contadas e nenhuma citada → a melhor crítica entra; "just order… I\'ll update you" é menção; comentário-lista perde a vez',
    tipo: 'unidade',
    executar() {
      const termos = ['fps', 'pubg', 'footsteps', 'imaging'];
      const topico = {
        url: 'https://www.reddit.com/r/PUBATTLEGROUNDS/comments/a/iem_for_pubg',
        bruto: [
          'TÓPICO DO REDDIT (r/PUBATTLEGROUNDS): IEM for PUBG?',
          '- [30 votos] Tripowin Vivace is great for PUBG, footsteps are crystal clear.',
          '- [25 votos] Tripowin Vivace has amazing imaging for FPS, highly recommend.',
          '- [20 votos] Tripowin Vivace is my go to for pubg, love it.',
          '- [2 votos] The Tripowin Vivace is bad for PUBG, the bass muddies the footsteps and I returned it.',
        ].join('\n'),
      };
      const k = m.consensoDe('Tripowin Vivace', [topico], {}, { termos });
      const encomenda = "I'm using the 7hz Divine. Also just order the Kefine Delci AE which may be one of the best for gaming. I'll update you on the weekend.";
      return [
        k.criticas >= 1 || `cenário: deveria contar a crítica (${JSON.stringify(k)})`,
        k.citacoes.some((x) => x.tom === 'critica') || `a crítica deveria ser citada: ${JSON.stringify(k.citacoes.map((x) => x.tom))}`,
        m.tomDoComentario(encomenda, termos, 'Kefine Delci AE', {}) === 'mencao' || `"just order" deveria ser menção, veio ${m.tomDoComentario(encomenda, termos, 'Kefine Delci AE', {})}`,
      ];
    },
  },
  {
    nome: 'qualidade 2: tabela recusa veredito que é título de página ou inglês; "Pelo preço" diz real e dólar separados; lista final não repete as opções já comparadas',
    tipo: 'unidade',
    executar() {
      const r = cenario();
      celulas['Kefine Delci AE|passos e posicionamento'].veredito = '/ Specification / Details / Features /';
      celulas['Kefine Delci AE|palco sonoro'].veredito = 'Tonality pleasant, micro-detail, airy atmosphere';
      r.finalistas.push({ nome: 'Tripowin Vivace', status: {}, consenso: { topicos: 1, citacoes: [] } });
      r.finalistas.push({ nome: 'Truthear Hexa', status: {}, consenso: { topicos: 1, citacoes: [] } });
      r.precos['Tripowin Vivace'] = { moeda: 'USD', mediana: 30, min: 30, max: 30, n: 1 };
      r.precos['Truthear Hexa'] = { moeda: 'USD', mediana: 70, min: 70, max: 70, n: 1 };
      r.precos['Ziigaat Arete'] = { moeda: 'BRL', mediana: 300, min: 300, max: 300, n: 1 };
      const texto = c.montar(r, new Map());
      const tabela = (texto.split('### Tabela')[1] || '').split('###')[0];
      celulas['Kefine Delci AE|passos e posicionamento'].veredito = undefined;
      celulas['Kefine Delci AE|palco sonoro'].veredito = 'palco amplo para o preço';
      return [
        !/Specification|Tonality/.test(tabela) || `lixo na tabela: ${tabela}`,
        /Pelo preço:\*\* o menor preço observado em real, Ziigaat Arete \(R\$ 300\); em dólar, Tripowin Vivace \(US\$ 30\)/.test(texto) || `pelo preço: ${(texto.match(/Pelo preço.*$/m) || ['(ausente)'])[0]}`,
        (() => {
          const { listaSemOsComparados } = require('../../src/agent/loop');
          const lista = '### Lista das 3 opções\n1. **Kefine Delci AE** — x\n2. **Ziigaat Arete** — y\n3. **Moondrop Chu 2** — z';
          const so = listaSemOsComparados(lista, texto);
          const nada = listaSemOsComparados('### Lista\n1. **Kefine Delci AE** — x', texto);
          return (/Moondrop Chu 2/.test(so) && !/Kefine/.test(so) && nada === '') || `lista final: ${JSON.stringify(so)} / ${JSON.stringify(nada)}`;
        })(),
      ];
    },
  },
  {
    nome: 'cartão de produto (11/10): na tela, cada "#### N. Nome" vira um cartão que fecha no próximo título; título sem número não vira cartão',
    tipo: 'unidade',
    executar() {
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.md.render('### As opções\n\n#### 1. Kefine Delci AE\n*Recomendação principal*\n\n**Pontos fortes:** passos claros.\n\n#### 2. Ziigaat Arete\n**Pontos fortes:** palco.\n\n### Tabela\n\n#### Observação\ntexto');
      global.window = antes;
      return [
        (html.match(/<section class="cartao-produto">/g) || []).length === 2 || `esperava 2 cartões: ${html}`,
        /<section class="cartao-produto">\n<h5>1\. Kefine Delci AE<\/h5>\n<p><em>Recomendação principal<\/em><\/p>/.test(html) || 'o selo vem logo abaixo do nome',
        /<\/section>\n<section class="cartao-produto">\n<h5>2\. /.test(html) || 'o 2º cartão fecha o 1º',
        /<\/section>\n<h4>Tabela<\/h4>/.test(html) || 'o próximo título fecha o cartão',
        !/<section[^>]*>\n<h5>Observação/.test(html) || 'título sem número não é cartão',
      ];
    },
  },
];
