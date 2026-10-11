'use strict';

/**
 * Revisão v6 (09/10/2026) — experimento A/B/C (mesmo dossiê, três respostas)
 * rodado no PC do Davi com "Quais são os 5 melhores IEMs para PUBG no PC?",
 * nível leve e alto. O que estava errado ANTES da redação:
 *   1. a matriz punha na célula de uma opção frases de OUTRO produto (JBL
 *      C50HI na do QKZ AK6, Z1 Pro na do KZ EDX Pro, Simgot EG280 na do
 *      Kefine, HyperX Cloud Earbuds II na do HyperX Cloud II) e política de
 *      devolução como "isolamento";
 *   2. headset (HyperX Cloud II) e pseudo-produto sem evidência nenhuma
 *      ("HyperX Clouds") viraram finalistas de "intra pra PUBG";
 *   3. comentário que escolhe OUTRO fone ("os Astrals são minha escolha… do
 *      que aqueles") contava como recomendação do Ziigaat Arete; "também
 *      encomendei o Kefine" contava como experiência; resposta de bot
 *      ("I'm the Vetted AI Bot") contava como opinião de usuário.
 * As frases abaixo são as dos dossiês reais (encurtadas).
 */

const m = require('../../src/agent/motor-pesquisa');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

const PLANO = `USO: jogar PUBG competitivo no PC, ouvindo passos e direção
CRITÉRIOS:
- posicionamento | alto | posicionamento, imaging
- conforto | médio | conforto, comfort
OPÇÕES CITADAS NO PEDIDO:
- nenhuma
BUSCAS DE DESCOBERTA:
- descoberta fones fps competitivo
BUSCA EM INGLÊS:
- best fps earphones`;

const CRITERIOS = [
  { nome: 'passos e posicionamento', peso: 'alto', termos: ['posicionamento', 'posiciona', 'imaging', 'footsteps', 'passos'] },
  { nome: 'separação e detalhe', peso: 'alto', termos: ['separacao', 'detalhe', 'detalhes', 'separation', 'detail'] },
  { nome: 'isolamento', peso: 'medio', termos: ['isolamento', 'isolation', 'sealed', 'vedacao'] },
  { nome: 'resposta de frequência', peso: 'medio', termos: ['resposta de frequencia', 'frequency response', 'hybrid', 'drivers'] },
];
const fin = (...nomes) => nomes.map((nome) => ({ nome }));
const temEvidencia = (matriz, opcao, criterio) => Boolean(matriz.celula(opcao, criterio)?.dominios?.size);

module.exports = [
  {
    nome: 'revisão v6 (matriz): página lida pra lacuna do QKZ AK6 não empresta frase do JBL C50HI; a frase do próprio QKZ continua valendo',
    tipo: 'unidade',
    executar() {
      const entradas = [
        {
          url: 'https://topdezmelhores.com.br/melhores/fones-intra-gamer/',
          opcao: 'QKZ AK6',
          tipoBusca: 'lacuna',
          bruto:
            'O JBL C50HI se posiciona como uma alternativa acessível dentro da linha de fones intra-auriculares da JBL, mantendo a promessa de um som envolvente.\n' +
            'O QKZ AK6 tem drivers de 8 mm e bons detalhes nos médios.',
        },
      ];
      const matriz = m.montarMatriz({ finalistas: fin('QKZ AK6', 'KZ EDX Pro Monitor'), criterios: CRITERIOS, entradas });
      return [
        !temEvidencia(matriz, 'QKZ AK6', 'passos e posicionamento') || `"O JBL C50HI se posiciona…" virou posicionamento do QKZ: ${JSON.stringify(matriz.celula('QKZ AK6', 'passos e posicionamento').trechos)}`,
        temEvidencia(matriz, 'QKZ AK6', 'separação e detalhe') || 'a frase que nomeia o QKZ AK6 ("bons detalhes") deveria contar',
      ];
    },
  },

  {
    nome: 'revisão v6 (matriz): frase de outro modelo da mesma loja/lista (Z1 Pro, KZ AS16 Pro, KZ D-Fi) não vai pra célula do KZ EDX Pro',
    tipo: 'unidade',
    executar() {
      const entradas = [
        {
          url: 'https://melhordofonedeouvido.com.br/melhor-fone-kz/',
          opcao: 'KZ EDX Pro Monitor',
          tipoBusca: 'lacuna',
          bruto:
            'A certificação IPX6 posiciona o Z1 Pro acima dos TWS convencionais de entrada: ele aguenta treino com suor intenso.\n' +
            'O KZ AS16 Pro é para quem não abre mão de máximo detalhamento com 16 drivers de armadura balanceada.\n' +
            // sem nome, logo depois da frase do AS16 Pro: continua falando do AS16 Pro
            'Seu acabamento em resina garante isolamento eficiente.',
        },
        {
          url: 'https://loja.oacustico.com.br/fone-de-ouvido-kz-edx-prox-monitor-de-palco',
          opcao: 'KZ EDX Pro Monitor',
          tipoBusca: 'ficha',
          bruto: 'Fone de ouvido KZ EDX Pro X Monitor de palco.\nSeu design ergonômico garante encaixe confortável e isolamento eficiente, mesmo em ambientes de palco.',
        },
      ];
      const matriz = m.montarMatriz({ finalistas: fin('KZ EDX Pro Monitor', 'QKZ AK6'), criterios: CRITERIOS, entradas, conhecidos: ['KZ AS16 Pro'] });
      return [
        !temEvidencia(matriz, 'KZ EDX Pro Monitor', 'passos e posicionamento') || 'frase do Z1 Pro (IPX6) virou posicionamento do EDX Pro',
        !temEvidencia(matriz, 'KZ EDX Pro Monitor', 'separação e detalhe') && !temEvidencia(matriz, 'KZ EDX Pro Monitor', 'resposta de frequência') ||
          'frase do KZ AS16 Pro (16 drivers) virou evidência do EDX Pro',
        // frase sem outro produto, na página lida pra opção: continua valendo (é o caso do tópico/ficha do próprio produto)
        temEvidencia(matriz, 'KZ EDX Pro Monitor', 'isolamento') || 'frase neutra da página da opção ("isolamento eficiente") deveria contar',
        (matriz.celula('KZ EDX Pro Monitor', 'isolamento')?.trechos || []).every((t) => /oacustico/.test(t.url)) ||
          `a frase sem nome depois da do AS16 Pro não é do EDX Pro: ${JSON.stringify(matriz.celula('KZ EDX Pro Monitor', 'isolamento').trechos)}`,
      ];
    },
  },

  {
    nome: 'revisão v6 (matriz): "HyperX Cloud Earbuds II" não é o HyperX Cloud II; política de devolução não é isolamento; pergunta não é evidência',
    tipo: 'unidade',
    executar() {
      const entradas = [
        {
          url: 'https://dmaisdesign.com.br/hyperx',
          // lida como ficha DO Cloud II (no teste real foi assim): nem a regra "página da opção" pode salvar
          opcao: 'HyperX Cloud II',
          tipoBusca: 'ficha',
          bruto: 'Com um microfone integrado, o HyperX Cloud Earbuds II permite que você se comunique com clareza. Sua qualidade de som é excepcional, garantindo que você não perca nenhum detalhe.',
        },
        { url: 'https://www.linsoul.com/products/simgot-em6l', opcao: 'Simgot EM6L', tipoBusca: 'ficha', bruto: 'For Factory Sealed Products.\nIEM earphones can only be returned if they have not been used and are still in their original sealed packaging.' },
        { url: 'https://www.reddit.com/r/iems/comments/x/em6l', opcao: 'Simgot EM6L', tipoBusca: 'comunidade', bruto: 'TÓPICO DO REDDIT (r/iems): EM6L for gaming\n- [3 votos] Is the imaging really that good?\n- [5 votos] The imaging is great, I hear footsteps clearly.' },
      ];
      const matriz = m.montarMatriz({ finalistas: fin('HyperX Cloud II', 'Simgot EM6L'), criterios: CRITERIOS, entradas });
      const imagem = matriz.celula('Simgot EM6L', 'passos e posicionamento');
      return [
        !temEvidencia(matriz, 'HyperX Cloud II', 'separação e detalhe') || 'frase do Cloud Earbuds II virou detalhe do Cloud II (headset)',
        !temEvidencia(matriz, 'Simgot EM6L', 'isolamento') || `política de devolução virou isolamento: ${JSON.stringify(matriz.celula('Simgot EM6L', 'isolamento').trechos)}`,
        temEvidencia(matriz, 'Simgot EM6L', 'passos e posicionamento') || 'o comentário afirmativo sobre imaging deveria contar',
        !imagem.trechos.some((t) => /\?/.test(t.texto)) || `a pergunta entrou como trecho: ${JSON.stringify(imagem.trechos)}`,
      ];
    },
  },

  {
    nome: 'revisão v6 (matriz): comentários colados na mesma linha ("- [1 votos] … - [1 votos] …") viram frases separadas — o do Simgot EG280 não vale pro Kefine',
    tipo: 'unidade',
    executar() {
      const entradas = [
        {
          url: 'https://www.reddit.com/r/PUBATTLEGROUNDS/comments/y/iem',
          opcao: 'Kefine Delci AE',
          tipoBusca: 'comunidade',
          conhecidos: [],
          bruto:
            'TÓPICO DO REDDIT (r/PUBATTLEGROUNDS): best iem for pubg\n' +
            '- [1 votos] Waiting for my Simgot EG280, its imaging is what everyone talks about - [2 votos] i also own truthear zero blue but the footsteps feel far',
        },
      ];
      const matriz = m.montarMatriz({ finalistas: fin('Kefine Delci AE', 'Ziigaat Arete'), criterios: CRITERIOS, entradas, conhecidos: ['Truthear Zero Blue', 'Simgot EG280'] });
      return [
        !temEvidencia(matriz, 'Kefine Delci AE', 'passos e posicionamento') ||
          `comentário do EG280/Truthear virou posicionamento do Kefine: ${JSON.stringify(matriz.celula('Kefine Delci AE', 'passos e posicionamento').trechos)}`,
        m.nomesNaFrase('Waiting for my Simgot EG280, its imaging is great').includes('Simgot EG280') || 'nomesNaFrase deveria achar "Simgot EG280"',
      ];
    },
  },

  {
    nome: 'revisão v6 (nomes na frase): ficha técnica não vira "outro produto" ("1DD+4BA Hybrid Configuration", "IPX6 Rating", "DSP Chip", "10mm Dynamic Driver")',
    tipo: 'unidade',
    executar() {
      const fichas = [
        'The Arete features a 1DD+4BA Hybrid Configuration with a biocellulose diaphragm driver.',
        'IPX6 Rating keeps it safe from sweat.',
        'The DSP Chip in the USB-C plug means you do not need a DAC.',
        'It uses a 10mm Dynamic Driver with a DLC diaphragm.',
        'O Kefine Delci AE usa driver dinâmico de 10 mm.',
      ];
      return [
        ...fichas.map((f) => !m.falaDeOutroProduto(f, f.includes('Kefine') ? 'Kefine Delci AE' : 'Ziigaat Arete') || `frase de ficha tratada como outro produto: "${f}" → ${JSON.stringify(m.nomesNaFrase(f))}`),
        m.falaDeOutroProduto('O JBL T110 é uma escolha sólida para quem busca a assinatura sonora da JBL.', 'QKZ AK6') || 'JBL T110 deveria ser outro produto',
        !m.falaDeOutroProduto('O Kefine Delci tem um palco amplo.', 'Kefine Delci AE') || '"Kefine Delci" (sem o AE) é a própria opção',
      ];
    },
  },

  {
    nome: 'revisão v6 (categoria): "HyperX Cloud II Gaming Headset" num tópico de IEM — o tipo escrito logo depois do nome tira o headset do pedido de intra',
    tipo: 'unidade',
    executar() {
      const entradas = [
        { url: 'https://www.reddit.com/r/PUBATTLEGROUNDS/comments/z/iem', titulo: 'best iem for pubg', bruto: 'TÓPICO DO REDDIT (r/PUBATTLEGROUNDS): best iem for pubg\n- [2 votos] I have tried premium headphones, earbuds, cheap Monoprice ones, and nothing beats these: HyperX Cloud II Gaming Headset - amazon link\n- [3 votos] Currently using a HyperX Cloud II and I am happy with it.\n- [5 votos] The Kefine Delci AE IEM is great for footsteps.' },
      ];
      const termos = m.categoriaDoPedido('Quais são os 5 melhores fones intra-auriculares (IEM) para jogar PUBG no PC?');
      return [
        m.deOutroTipo('HyperX Cloud II', entradas, termos) || 'o Cloud II escrito como "Gaming Headset" deveria ser de outro tipo',
        !m.deOutroTipo('Kefine Delci AE', entradas, termos) || 'o Kefine (IEM) não pode sair',
      ];
    },
  },

  {
    nome: 'revisão v6 (consenso): escolha de OUTRO fone é crítica (perde na comparação); "encomendei" é menção; resposta de bot não conta',
    tipo: 'unidade',
    executar() {
      const termos = ['fps', 'pubg', 'gaming', 'footsteps', 'imaging'];
      const astral =
        "Out of all the IEMs I've used, which include Ziigaat Arete 2, Xenns Tea Pro SE, Softears Volume S and Kiwi Astrals, the Astrals are my pick for FPS games. The soundstage is perfect and I find it easier to pinpoint than those IEMs.";
      const encomenda = "I'm using the 7hz Divine in arc raiders and it has decent imaging. I also ordered the Kefine Delci AE, which may be one of the best options under $100 for gaming.";
      const bot = {
        url: 'https://www.reddit.com/r/PUBATTLEGROUNDS/comments/w/headset',
        bruto: "TÓPICO DO REDDIT (r/PUBATTLEGROUNDS): headset?\n- [1 votos] Hey there, I'm the Vetted AI Bot! I researched the HyperX Cloud II and users liked: comfortable with excellent sound, highly recommend.",
      };
      const c = m.consensoDe('HyperX Cloud II', [bot], {}, { termos });
      return [
        m.tomDoComentario(astral, termos, 'Ziigaat Arete', {}) === 'critica' || `Astrals escolhido sobre o Arete deveria ser crítica do Arete, veio ${m.tomDoComentario(astral, termos, 'Ziigaat Arete', {})}`,
        m.tomDoComentario(astral, termos, 'Kiwi Astrals', {}) !== 'critica' || 'o escolhido (Astrals) não pode virar crítica',
        m.tomDoComentario(encomenda, termos, 'Kefine Delci AE', {}) === 'mencao' || 'quem só encomendou não recomenda por experiência',
        m.tomDoComentario('The Truthear Hexa is my pick for FPS, footsteps are clear', termos, 'Truthear Hexa', {}) === 'recomenda' || 'o próprio nome como escolha continua recomendação',
        m.tomDoComentario('I use the Truthear Hexa for PUBG, footsteps are clear', termos, 'Truthear Hexa', {}) === 'recomenda' || 'uso próprio no uso pedido continua recomendação',
        m.tomDoComentario('I bought the Kefine Delci AE last month and honestly this one is my pick for FPS.', termos, 'Kefine Delci AE', {}) === 'recomenda' ||
          '"this one is my pick" (pronome) não diz que a escolha é outra',
        c.topicos === 0 && c.citacoes.length === 0 || `bot contou como comunidade: ${JSON.stringify(c)}`,
      ];
    },
  },

  {
    nome: 'revisão v6 (evidência mínima, ponta a ponta): finalista com 1 tópico e nenhum critério com evidência ("Gama Clouds") sai; o próximo com recomendação entra e é investigado',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'site:reddit.com best iem for pubg',
          paginas: [
            pagina('I use the Alfa X1 for PUBG, great footsteps, highly recommend it.'),
            pagina('Alfa X1 is the best budget pick for competitive shooters.'),
            pagina('Delta D4 is great for PUBG footsteps.'),
            pagina('Gama Clouds are great for PUBG.'),
            pagina('Epsilon E5 is great.'),
          ],
        },
        { contem: 'descoberta fones fps', paginas: [pagina('Guia de fones intra-auriculares: Alfa X1, Delta D4, Gama Clouds, Epsilon E5.')] },
        { contem: 'alfa x1 especificacoes', paginas: [pagina('Ficha do fone intra-auricular Alfa X1: o Alfa X1 tem ótimo posicionamento e imaging preciso.')] },
        { contem: 'delta d4 especificacoes', paginas: [pagina('Ficha do fone intra-auricular Delta D4: o Delta D4 tem posicionamento excelente.')] },
        { contem: 'epsilon e5 especificacoes', paginas: [pagina('Ficha do fone intra-auricular Epsilon E5: o Epsilon E5 tem conforto excelente.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v6: evidência mínima',
          pedido: 'Quais os melhores fones intra-auriculares para jogar PUBG no PC?',
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true },
          planoDePesquisa: PLANO,
          candidatosDePesquisa: '- Alfa X1\n- Delta D4\n- Gama Clouds\n- Epsilon E5',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const opcoes = (obtido.pesquisa.fim?.planoDeResposta || '').split('\n').find((l) => /^OPÇÕES COMPARADAS/.test(l)) || '';
        const descartes = obtido.registro?.descartes || [];
        return [
          (obtido.pesquisa.candidatos?.finalistas || []).some((f) => f.nome === 'Gama Clouds') || 'o cenário deveria pôr o Gama Clouds entre os finalistas iniciais',
          descartes.some((d) => d.etapa === 'evidencia' && d.alvo === 'Gama Clouds') || `descarte por evidência não registrado: ${JSON.stringify(descartes)}`,
          !/Gama Clouds/.test(opcoes) || `Gama Clouds continuou nas opções: ${opcoes}`,
          /Epsilon E5/.test(opcoes) || `a reserva (Epsilon E5) deveria entrar: ${opcoes}`,
          /Alfa X1/.test(opcoes) && /Delta D4/.test(opcoes) || `os finalistas com evidência têm que ficar: ${opcoes}`,
          srv.pedidos.some((p) => /epsilon e5 especifica/i.test(p.q)) || 'a reserva que entrou deveria ser investigada (ficha)',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  {
    nome: 'revisão v6 (matriz): frase com o modelo da opção que cita o antecessor continua valendo ("O EM6L é o sucessor do Simgot EM5…"); "use your imagination" não é imaging',
    tipo: 'unidade',
    executar() {
      const entradas = [
        {
          url: 'https://www.hangout.audio/simgot-em6l',
          opcao: 'Simgot EM6L',
          tipoBusca: 'ficha',
          bruto: 'O EM6L é o sucessor do Simgot EM5 e usa uma configuração híbrida com ótima separação e detalhe nos médios.',
        },
        {
          url: 'https://www.reddit.com/r/iems/comments/k/delci',
          opcao: 'Kefine Delci AE',
          tipoBusca: 'comunidade',
          bruto: 'TÓPICO DO REDDIT (r/iems): Delci AE nozzles\n- [2 votos] Use your imagination, for me it is purely a preference in appearance with all things equal.',
        },
      ];
      const matriz = m.montarMatriz({ finalistas: fin('Simgot EM6L', 'Kefine Delci AE'), criterios: CRITERIOS, entradas });
      return [
        temEvidencia(matriz, 'Simgot EM6L', 'separação e detalhe') || 'a frase do EM6L (com o EM5 citado como antecessor) deveria contar',
        !temEvidencia(matriz, 'Kefine Delci AE', 'passos e posicionamento') || '"imagination" virou imaging/posicionamento',
      ];
    },
  },
];
