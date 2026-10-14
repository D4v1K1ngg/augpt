'use strict';

/**
 * Escrita por cartão (14/10): dossiê por produto, cartão escrito com ele,
 * conferência do cartão e a montagem da resposta. O motivo está em
 * src/agent/dossie-do-produto.js e src/agent/escritor-de-cartoes.js.
 */

const { dossieDoProduto, numerarFontes, textoDoDossie } = require('../../src/agent/dossie-do-produto');
const escritor = require('../../src/agent/escritor-de-cartoes');
const compositor = require('../../src/agent/compositor');
const checagens = require('../qualidade/checagens-de-produto');

const ENTRADAS = [
  { url: 'https://headphonesty.com/titan', destilado: true, opcao: 'Dunu Titan S', tipoBusca: 'ficha', texto: '- [1] O Dunu Titan S tem driver dinâmico de 11 mm.\n- [1] A impedância é de 18 ohms.\n- NADA' },
  { url: 'https://www.reddit.com/r/iems/comments/abc/titan', cru: true, tipoBusca: 'comunidade', texto: '[5 votos] Comprei o Dunu Titan S e o palco é amplo, mas o grave é um pouco fraco para quem gosta de batida. Outra frase sem relação nenhuma com o produto.' },
  { url: 'https://lista.com/top', destilado: true, texto: '- [2] O Moondrop Chu II custa 20 dólares.\n- [2] O Dunu Titan S tem som neutro e detalhado.' },
  { url: 'https://fora.com/x', destilado: true, foraDoEscopo: 'não cita', texto: '- O Dunu Titan S aparece aqui fora do escopo.' },
];

const CARTAO_BOM =
  'O QUE É: O Dunu Titan S é um fone intra-auricular com um driver dinâmico (o alto-falante que produz o som) de 11 mm [1].\n' +
  'NO USO: Ele tem som neutro e detalhado [2], e quem usa elogia o palco sonoro (a sensação de espaço e direção do som) amplo [3].\n' +
  'PONTOS FORTES: O equilíbrio do som agrada a quem quer ouvir cada instrumento. A impedância baixa, de 18 ohms [1], facilita usar direto no celular.\n' +
  'PONTOS FRACOS: Quem usa relata que o grave é contido para quem gosta de batida forte [3].\n' +
  'PARA QUEM: Para quem quer um som fiel, sem graves exagerados.';

module.exports = [
  {
    nome: 'cartões: o dossiê junta tudo que cita o produto — a leitura feita PARA ele inteira, das outras só o que o cita, da comunidade a frase que o cita; o que foi marcado fora do escopo fica de fora; fontes numeradas uma vez só',
    tipo: 'unidade',
    executar() {
      const titan = dossieDoProduto('Dunu Titan S', { entradas: ENTRADAS });
      const chu = dossieDoProduto('Moondrop Chu II', { entradas: ENTRADAS });
      const { fontes } = numerarFontes([titan, chu]);
      const texto = textoDoDossie(titan);
      return [
        titan.itens.length === 4 || `itens do Titan S: ${titan.itens.map((i) => i.texto).join(' | ')}`,
        /11 mm/.test(texto) && /18 ohms/.test(texto) || 'a ficha feita para ele entra inteira',
        /palco é amplo/.test(texto) && !/sem relação/.test(texto) || 'do tópico cru, só a frase que cita o produto',
        !/fora do escopo/.test(texto) && !/Chu II/.test(texto) || 'nem leitura fora do escopo, nem fato de outro produto',
        titan.itens[0].tipo === 'ficha' || 'ficha primeiro',
        fontes.length === 3 && chu.itens[0].n === 2 || `numeração única: ${JSON.stringify(fontes)}`,
        /^\[1\] \(headphonesty\.com, ficha\)/.test(texto) && /\(r\/iems, quem usa\)/.test(texto) || `formato do dossiê: ${texto.slice(0, 120)}`,
      ];
    },
  },
  {
    nome: 'cartões: leitura dos 5 campos (negrito, acento, campo em duas linhas) e conferência — número fora do material e fonte inexistente saem; cópia de comentário e frase de outro cartão saem e o resto do cartão fica',
    tipo: 'unidade',
    executar() {
      const dossie = dossieDoProduto('Dunu Titan S', { entradas: ENTRADAS });
      numerarFontes([dossie]);
      const lido = escritor.lerCartao(`**O que é:** É um fone intra-auricular\ncom driver de 11 mm [1].\nNo uso: Som neutro [2].\nPontos fortes: Detalhe [2].\nPontos fracos: Grave contido [3].\nPara quem: Quem quer fidelidade.`);
      const bom = escritor.conferirCartao(escritor.lerCartao(CARTAO_BOM), { dossie });
      const inventado = escritor.conferirCartao(escritor.lerCartao(`${CARTAO_BOM.replace('O QUE É: O Dunu', 'O QUE É: Custa 999 reais [1]. O Dunu')}`.replace('[3].\nPARA', '[9].\nPARA')), { dossie });
      const copia = escritor.conferirCartao(escritor.lerCartao(CARTAO_BOM.replace('PONTOS FRACOS: Quem usa relata que o grave é contido para quem gosta de batida forte [3].', 'PONTOS FRACOS: Comprei o Dunu Titan S e o palco é amplo, mas o grave é um pouco fraco para quem gosta de batida.')), { dossie });
      const repetida = escritor.conferirCartao(escritor.lerCartao(CARTAO_BOM), { dossie, outros: ['Para quem quer um som fiel, sem graves exagerados.'] });
      return [
        lido.oQueE === 'É um fone intra-auricular com driver de 11 mm [1].' && lido.paraQuem === 'Quem quer fidelidade.' || `leitura: ${JSON.stringify(lido)}`,
        bom.problemas.length === 0 && Object.keys(bom.cartao).length === 5 || `cartão bom: ${JSON.stringify(bom.problemas)}`,
        !/999/.test(inventado.cartao.oQueE) && /11 mm/.test(inventado.cartao.oQueE) || 'frase com número inventado sai, o resto fica',
        !/\[9\]/.test(inventado.cartao.fracos || '') || 'marca de fonte inexistente sai',
        // 14/10, 2ª versão: corrige, não rejeita — a frase ruim sai, o resto do cartão fica
        copia.removidas.some((x) => x.motivo === 'copiou um comentário') && !copia.cartao.fracos && copia.cartao.oQueE && copia.problemas.length === 0 || `cópia: ${JSON.stringify(copia.removidas)}`,
        repetida.removidas.some((x) => x.motivo === 'frase igual à de outro cartão') && !repetida.cartao.paraQuem && Object.keys(repetida.cartao).length === 4 || 'frase igual à de outro cartão sai, o resto fica',
        escritor.lerCartao('### Sobre o Dunu\nO Dunu Titan S é um fone neutro [2]. Quem usa elogia o palco [3].').noUso === 'O Dunu Titan S é um fone neutro [2]. Quem usa elogia o palco [3].' || 'sem os rótulos, o texto corrido é aproveitado',
        Boolean(escritor.conferirCartao({ oQueE: 'Tem sensor de 12.000 DPI [1].', fortes: 'É leve [1].' }, { dossie: { nome: 'G305', itens: [{ texto: 'sensor de até 12000 DPI', n: 1, url: 'u', tipo: 'ficha' }] } }).cartao.oQueE) || '"12.000" e "12000" são o mesmo número',
      ];
    },
  },
  {
    nome: 'cartões: escrita — o 2º cartão só repete o 1º, sobra texto de menos e é reescrito com a lista do que evitar; produto com material de menos não ganha cartão; chamada que falha não derruba a resposta',
    tipo: 'unidade',
    async executar() {
      const a = { nome: 'Alfa X1', itens: [{ texto: 'O Alfa X1 tem driver de 10 mm.', n: 1, url: 'https://a.com', tipo: 'ficha' }, { texto: 'O Alfa X1 tem grave forte.', n: 2, url: 'https://b.com', tipo: 'review' }] };
      const b = { nome: 'Beta Y2', itens: [{ texto: 'O Beta Y2 tem driver de 8 mm.', n: 3, url: 'https://c.com', tipo: 'ficha' }, { texto: 'O Beta Y2 é leve.', n: 4, url: 'https://d.com', tipo: 'review' }] };
      const pobre = { nome: 'Gama Z3', itens: [{ texto: 'O Gama Z3 existe.', n: 5, url: 'https://e.com', tipo: 'review' }] };
      const pedidos = [];
      const igual = 'PARA QUEM: Para quem quer ouvir música com conforto por muitas horas seguidas.';
      const r = await escritor.escreverCartoes({
        dossies: [a, b, pobre],
        contexto: { objetivo: 'fones para música', uso: 'ouvir música' },
        paralelo: 1,
        chamar: async (prompt) => {
          pedidos.push(prompt);
          if (/sobre o Alfa X1, com base/.test(prompt)) return `O QUE É: Fone com driver de 10 mm [1].\nPONTOS FORTES: Grave forte [2].\n${igual}`;
          // 1ª resposta do Beta: só a frase repetida (sobra texto de menos → reescreve); a 2ª é boa
          if (pedidos.length === 2) return igual;
          return 'O QUE É: Fone com driver de 8 mm [3].\nPONTOS FORTES: É leve [4].\nPARA QUEM: Para quem viaja.';
        },
      });
      const falhou = await escritor.escreverCartoes({ dossies: [a], contexto: {}, chamar: async () => { throw new Error('caiu'); } });
      return [
        r.size === 2 && r.has('Alfa X1') && r.has('Beta Y2') && !r.has('Gama Z3') || `cartões: ${[...r.keys()]}`,
        pedidos.length === 3 || `chamadas: ${pedidos.length} (Alfa, Beta, Beta reescrito)`,
        /Não repita estas frases/.test(pedidos[2]) && /conforto por muitas horas/.test(pedidos[2]) || 'a reescrita diz o que evitar',
        r.get('Beta Y2').paraQuem === 'Para quem viaja.' || `Beta reescrito: ${JSON.stringify(r.get('Beta Y2'))}`,
        /Exemplo do formato, com outro produto/.test(pedidos[0]) && pedidos[0].length < 3000 || 'o pedido é curto e traz um exemplo',
        falhou.size === 0 || 'chamada que falha: sem cartão, sem exceção',
      ];
    },
  },
  {
    nome: 'cartões: na resposta, o cartão entra no lugar da frase-fórmula e do comentário colado — campos rotulados, fonte em link, ficha limpa; sem cartão, o formato de antes; "conhecer um produto" monta foto + cartão',
    tipo: 'unidade',
    executar() {
      const dossie = dossieDoProduto('Dunu Titan S', { entradas: ENTRADAS });
      const { fontes } = numerarFontes([dossie]);
      const cartao = escritor.conferirCartao(escritor.lerCartao(CARTAO_BOM), { dossie }).cartao;
      const citacoes = [{ texto: 'Comprei o Dunu Titan S e o palco é amplo, mas o grave é um pouco fraco.', fonte: 'r/iems', votos: 5, tom: 'recomenda' }];
      const base = {
        modo: 'recomendacao',
        plano: { uso: 'ouvir música', criterios: [{ nome: 'palco sonoro', peso: 'alto', porque: 'separa os instrumentos' }] },
        finalistas: [{ nome: 'Dunu Titan S', status: {}, consenso: { topicos: 2, citacoes } }, { nome: 'Outro Z9', status: {}, consenso: { topicos: 1, citacoes: [] } }],
        matriz: { celula: () => null, resumos: new Map([['Dunu Titan S', { ficha: { texto: ', , , 11mm driver dinâmico, 18 ohms (números 12, 13)' } }]]) },
      };
      const com = compositor.montar({ ...base, cartoes: new Map([['Dunu Titan S', cartao]]), fontesNumeradas: fontes }, new Map());
      const sem = compositor.montar(base, new Map());
      const bloco = com.split('#### 2.')[0];
      const produto = compositor.montar({ modo: 'produto', produto: 'Dunu Titan S', finalistas: [{ nome: 'Dunu Titan S' }], imagens: new Map([['Dunu Titan S', 'augpt-img://t.jpg']]), cartoes: new Map([['Dunu Titan S', cartao]]), fontesNumeradas: fontes }, new Map());
      const pedido = compositor.pedidoDeFrases({ ...base, cartoes: new Map([['Dunu Titan S', cartao]]) }, 'fones para música');
      return [
        /\*\*O que é:\*\* O Dunu Titan S é um fone/.test(bloco) && /\*\*Pontos fracos:\*\*/.test(bloco) && /\*\*Para quem:\*\*/.test(bloco) || `campos do cartão: ${bloco.slice(0, 300)}`,
        /\[\(1\)\]\(https:\/\/headphonesty\.com\/titan\)/.test(bloco) || 'a fonte vira link',
        !/^> /m.test(bloco) && checagens.comentariosColados(com).length === 0 || 'com cartão, nenhum comentário colado',
        /\*\*Ficha:\*\* 11mm driver dinâmico, 18 ohms$/m.test(bloco) || `ficha limpa: ${(bloco.match(/\*\*Ficha:\*\*.*/) || [''])[0]}`,
        /^> "Comprei o Dunu/m.test(sem) && /\*\*Pontos fortes:\*\*/.test(sem) || 'sem cartão, o formato de antes',
        /^!\[Dunu Titan S\]\(augpt-img:\/\/t\.jpg\)\n\n### Dunu Titan S\n\n\*\*O que é:\*\*/.test(produto) || `conhecer um produto: ${produto.slice(0, 160)}`,
        !/Dunu Titan S: <3 ou 4 frases/.test(pedido) && /Outro Z9: <3 ou 4 frases/.test(pedido) && !/CITAÇÕES EM INGLÊS/.test(pedido) || 'o pedido de frases não pede de novo o que o cartão já escreveu',
        checagens.termosExplicados(com).length >= 2 || 'as explicações de termo do cartão contam na checagem',
      ];
    },
  },
  {
    nome: 'fase 1 (14/10): o modelo marca o que não é do tipo pedido (fone de cabeça, headset, categoria) e o código tira só os nomes da lista; "não sei" e nome fora da lista não tiram nada',
    tipo: 'unidade',
    executar() {
      const { lerForaDaCategoria } = require('../../src/agent/motor-pesquisa');
      const nomes = ['Moondrop Chu II', 'Sennheiser HD650', 'HyperX Cloud III', 'IEMs planares', 'Ikko OH10'];
      const fora = lerForaDaCategoria('- Moondrop Chu II: sim\n- **Sennheiser HD650**: não\n- HyperX Cloud III: Não\nIEMs planares: não\n- Ikko OH10: não sei\n- Inventado X: não', nomes);
      return [
        [...fora].join() === 'Sennheiser HD650,HyperX Cloud III,IEMs planares' || `fora: ${[...fora]}`,
        lerForaDaCategoria('não entendi', nomes).size === 0 || 'resposta ilegível não tira nada',
      ];
    },
  },
  {
    nome: 'fase 1 (14/10): critério sem evidência para a maioria das opções sai de "Como escolhi", da tabela e do ponto de atenção; ficha com vírgulas soltas e referências internas é limpa',
    tipo: 'unidade',
    executar() {
      const criterios = [
        { nome: 'assinatura sonora', peso: 'alto', porque: 'decide o gosto' },
        { nome: 'bateria', peso: 'alto', porque: 'dura o dia' },
      ];
      const f = (nome) => ({ nome, status: { 'assinatura sonora': 'corroborado' }, consenso: { topicos: 1, citacoes: [] } });
      const texto = compositor.montar({ modo: 'recomendacao', plano: { uso: 'música', criterios }, finalistas: [f('A1 X'), f('B2 Y'), f('C3 Z')], matriz: { celula: () => null, resumos: new Map() } }, new Map());
      return [
        /\*\*assinatura sonora\*\*/.test(texto) || 'critério com dados fica',
        !/bateria/i.test(texto) || `critério sem dados em todas as opções sai: ${(texto.match(/.*bateria.*/i) || [''])[0]}`,
        compositor.limparFicha(', , , , , 14.8mm planar magnetic driver, 102db sensitivity (números 12, 13, 15)') === '14.8mm planar magnetic driver, 102db sensitivity' || `ficha: ${compositor.limparFicha(', , , , , 14.8mm planar magnetic driver, 102db sensitivity (números 12, 13, 15)')}`,
      ];
    },
  },
];
