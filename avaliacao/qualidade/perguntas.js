'use strict';

/**
 * Conjunto fixo de perguntas da medição de qualidade (`npm run qualidade`).
 *
 * Cada pergunta tem um GABARITO, e é contra ele que o modelo-juiz corrige — o
 * juiz não usa o que "sabe", só compara a resposta com o que está aqui:
 *   - `fatos`: afirmações que uma resposta boa traz. O juiz marca cada uma
 *     como presente, ausente ou contradita.
 *   - `criterios`: para pedidos sem resposta única (recomendação, preço de
 *     hoje), o que a resposta precisa TER — conferível só lendo o texto.
 *   - `errada` (em algumas): uma resposta ruim de propósito. Serve para
 *     calibrar o juiz antes da rodada: se ele der nota alta a ela, a nota
 *     dele não vale.
 *
 * Boa parte dos pedidos saiu do uso real do app (registros de ago–out/2026).
 * Ao acrescentar: fato curto, estável e que não dependa de data de hoje.
 */

module.exports = [
  /* ------------------------------ explicação ------------------------------ */
  {
    id: 'gerador',
    tipo: 'explicacao',
    pedido: 'Como um gerador funciona ?',
    fatos: [
      'converte energia mecânica em energia elétrica',
      'funciona por indução eletromagnética (lei de Faraday)',
      'o movimento relativo entre um campo magnético (ímã ou rotor) e bobinas/enrolamentos induz tensão ou corrente',
      'a energia mecânica vem de uma fonte externa, como turbina ou motor',
    ],
    errada:
      'Um gerador cria eletricidade a partir do nada, usando baterias químicas que nunca descarregam. Foi inventado por Nikola Tesla em 1950 e funciona pelo atrito entre duas placas de plástico, sem nenhum ímã ou bobina.',
  },
  {
    id: 'chernobyl',
    tipo: 'explicacao',
    pedido: 'como que o acidente de chernobyl aconteceu?',
    fatos: [
      'aconteceu em 26 de abril de 1986',
      'foi no reator número 4 da usina',
      'ocorreu durante um teste de segurança',
      'houve explosão e incêndio que liberaram material radioativo',
      'as causas combinam falhas de projeto do reator (RBMK) com erros de operação',
      'a cidade de Pripyat foi evacuada (ou: criou-se uma zona de exclusão)',
    ],
    errada:
      'O acidente de Chernobyl aconteceu em 2011, no Japão, quando um tsunami atingiu a usina. Não houve explosão nem liberação de radiação, e ninguém precisou sair da região.',
  },
  {
    id: 'sr71',
    tipo: 'explicacao',
    pedido: 'Me conte mais sobre o Black bird sr71',
    fatos: [
      'é um avião de reconhecimento estratégico',
      'foi fabricado pela Lockheed (divisão Skunk Works)',
      'voava acima de Mach 3',
      'o primeiro voo foi em 1964',
      'operava a altitudes muito altas, em torno de 25 km (85 mil pés)',
      'foi usado pela Força Aérea dos Estados Unidos',
    ],
    errada:
      'O SR-71 Blackbird é um avião de passageiros da Boeing, lançado em 2005, que voa a 900 km/h e transporta até 300 pessoas em rotas comerciais.',
  },
  {
    id: 'aviao-sem-motores',
    tipo: 'explicacao',
    pedido: 'Se um avião perder todos os seus motores durante um voo o que acontece ?',
    fatos: [
      'o avião não cai de imediato: ele plana',
      'planando ele consegue percorrer uma boa distância (dezenas de quilômetros a partir da altitude de cruzeiro)',
      'os pilotos tentam religar os motores e/ou buscam um lugar para pouso de emergência',
      'os comandos continuam funcionando com energia de emergência (turbina de ar de impacto/RAT, APU ou baterias)',
    ],
  },
  {
    id: 'plastico',
    tipo: 'explicacao',
    pedido: 'Como o plastico é feito ?',
    fatos: [
      'a matéria-prima principal vem do petróleo ou do gás natural (nafta)',
      'dela se obtêm monômeros, como etileno e propileno',
      'os monômeros são ligados em cadeias longas por polimerização',
      'a resina (grãos/pellets) é moldada por processos como extrusão, injeção ou sopro',
    ],
  },
  {
    id: 'ceu-azul',
    tipo: 'explicacao',
    pedido: 'Por que o céu é azul?',
    fatos: [
      'a luz do Sol é espalhada pelas moléculas da atmosfera',
      'o fenômeno é o espalhamento de Rayleigh',
      'a luz azul, de comprimento de onda mais curto, é espalhada muito mais do que a vermelha',
    ],
  },
  {
    id: 'fotossintese',
    tipo: 'explicacao',
    pedido: 'O que é fotossíntese?',
    fatos: [
      'processo em que plantas, algas e algumas bactérias transformam energia da luz em energia química',
      'usa gás carbônico (CO2) e água',
      'produz glicose (açúcar) e libera oxigênio',
      'acontece nos cloroplastos, com a clorofila',
    ],
  },
  {
    id: 'relatividade',
    tipo: 'explicacao',
    pedido: 'Me explique como que funciona a teoria da relatividade de Albert Einstein',
    fatos: [
      'são duas teorias: a relatividade restrita (1905) e a geral (1915)',
      'a velocidade da luz no vácuo é a mesma para todos os observadores',
      'tempo e espaço dependem do observador (dilatação do tempo, contração do espaço)',
      'na relatividade geral a gravidade é a curvatura do espaço-tempo causada por massa e energia',
      'massa e energia são equivalentes (E = mc²)',
    ],
  },
  {
    id: 'alto-falante',
    tipo: 'explicacao',
    pedido: 'Me explique como que um alto falante funciona ?',
    fatos: [
      'o sinal elétrico de áudio passa por uma bobina',
      'a bobina fica no campo de um ímã permanente e se move quando a corrente varia',
      'a bobina está presa a um cone (diafragma), que vibra junto',
      'a vibração do cone movimenta o ar e produz as ondas sonoras',
    ],
  },
  {
    id: 'terra-para',
    tipo: 'explicacao',
    pedido: 'Se a terra parasse de girar do nada, o que aconteceria ?',
    fatos: [
      'por inércia, tudo o que não está preso ao solo continuaria em movimento para leste',
      'a velocidade de rotação no equador é de cerca de 1.670 km/h',
      'haveria ventos, ondas gigantes e destruição em escala global',
      'um dia passaria a durar um ano (cerca de seis meses de luz e seis de escuridão)',
    ],
  },
  {
    id: 'processador',
    tipo: 'explicacao',
    pedido: 'Como um processador é fabricado?',
    fatos: [
      'é feito de silício, em discos chamados wafers',
      'os circuitos são gravados por fotolitografia, camada por camada',
      'o resultado são bilhões de transistores microscópicos',
      'a fabricação acontece em salas limpas',
      'o wafer é cortado em chips, que são testados e encapsulados',
    ],
  },
  {
    id: 'thrashing',
    tipo: 'explicacao',
    pedido: 'O que é thrashing em sistemas operacionais?',
    fatos: [
      'acontece quando a memória RAM é insuficiente para os processos em execução',
      'o sistema passa a trocar páginas entre a memória e o disco o tempo todo (paginação excessiva)',
      'gasta-se mais tempo trocando páginas do que executando os programas',
      'o desempenho cai drasticamente',
    ],
  },

  /* ------------------------------ fato direto ------------------------------ */
  {
    id: 'aviao-mais-rapido',
    tipo: 'fato',
    pedido: 'Qual o avião mais rapido do mundo ?',
    fatos: [
      'cita o Lockheed SR-71 Blackbird como o avião a jato tripulado mais rápido (ou o North American X-15 como o mais rápido movido a foguete)',
      'dá a velocidade: acima de Mach 3 / cerca de 3.500 km/h para o SR-71 (ou cerca de Mach 6,7 / 7.200 km/h para o X-15)',
    ],
  },
  {
    id: 'santos-dumont',
    tipo: 'fato',
    pedido: 'Quem foi Santos Dumont?',
    fatos: [
      'inventor e aviador brasileiro, pioneiro da aviação',
      'voou com o 14-Bis em 1906, em Paris',
      'antes disso construiu e pilotou balões e dirigíveis (contornou a Torre Eiffel em 1901)',
      'nasceu em 1873 e morreu em 1932',
    ],
  },
  {
    id: 'lua',
    tipo: 'fato',
    pedido: 'Quando o homem pisou na Lua pela primeira vez e quem foi?',
    fatos: ['foi em 20 de julho de 1969', 'na missão Apollo 11', 'o primeiro a pisar foi Neil Armstrong'],
    errada: 'O homem pisou na Lua pela primeira vez em 1975, na missão Apollo 20, e o primeiro a descer foi Yuri Gagarin.',
  },
  {
    id: 'canberra',
    tipo: 'fato',
    pedido: 'Qual a capital da Austrália e por que não é Sydney?',
    fatos: [
      'a capital é Canberra',
      'foi escolhida (construída) como solução de compromisso na disputa entre Sydney e Melbourne',
    ],
  },
  {
    id: 'conta',
    tipo: 'fato',
    pedido: 'Quanto é (12783,23 * 0,17) + 823,42?',
    fatos: ['o resultado é 2.996,57 (aproximadamente 2996,57)'],
  },
  {
    id: 'terra-sol',
    tipo: 'fato',
    pedido: 'Qual a distância da Terra ao Sol?',
    fatos: [
      'cerca de 150 milhões de quilômetros (ou 149,6 milhões; 1 unidade astronômica)',
      'a luz do Sol leva cerca de 8 minutos para chegar à Terra',
    ],
  },
  {
    id: 'tres-perguntas',
    tipo: 'fato',
    pedido: 'O que é NP-completo? O que é thrashing? Como funciona o Paxos?',
    fatos: [
      'NP-completo: problemas de NP para os quais todo problema de NP pode ser reduzido em tempo polinomial (os mais difíceis de NP)',
      'NP-completo: não se conhece algoritmo de tempo polinomial para eles',
      'thrashing: paginação excessiva por falta de memória, que derruba o desempenho',
      'Paxos: algoritmo de consenso para sistemas distribuídos (os nós concordam em um valor mesmo com falhas)',
      'Paxos: um valor só é escolhido com o aceite da maioria (quórum), em fases de proposta e aceitação',
    ],
  },

  /* ---------------- recomendação, comparação e preço (sem resposta única) ---------------- */
  {
    id: 'fones-pubg',
    tipo: 'produto',
    pedido: 'Me recomende um top 5 melhores fones intra auriculares para se jogar pubg de pc',
    criterios: [
      'lista cinco modelos, cada um com marca e nome de modelo',
      'justifica as escolhas com características que importam em jogo de tiro (ouvir passos, posicionamento, palco sonoro, separação)',
      'diz de onde vêm as recomendações (sites, comunidade ou links)',
      'deixa claro qual é a primeira recomendação',
      'os fones recomendados são intra-auriculares (não headsets)',
    ],
  },
  {
    id: 'rtx-diferenca',
    tipo: 'produto',
    pedido: 'Qual a diferença de desempenho entre a RTX 5070 Ti e a RTX 5080?',
    fatos: ['a RTX 5080 é a mais rápida das duas'],
    criterios: [
      'dá a diferença em número (percentual ou quadros por segundo)',
      'diz em que condição o número vale (resolução, jogos ou tipo de teste)',
      'cita a fonte dos números',
    ],
  },
  {
    id: 'rtx-black-friday',
    tipo: 'produto',
    pedido: 'Qual o valor mais provavel que a rtx 5080 podera chegar na black friday de 2026 ?',
    criterios: [
      'dá um valor ou uma faixa em reais',
      'explica como chegou ao valor (histórico de preços, descontos de anos anteriores ou método parecido)',
      'deixa claro que é uma estimativa, com incerteza',
      'os números não se contradizem entre si (texto, listas, tabela e gráfico dizem a mesma coisa)',
      'cita as fontes dos preços',
    ],
  },
  {
    id: 'latencia-nvidia',
    tipo: 'produto',
    pedido: "Eu devo usar a opção 'Modo de latência baixa' da NVIDIA no modo Ultra para jogar PUBG?",
    criterios: [
      'explica o que o modo faz (reduz a fila de quadros prontos / o atraso entre o comando e a imagem)',
      'dá uma recomendação clara (usar, não usar ou em que caso usar)',
      'menciona de que depende o ganho (por exemplo: placa de vídeo no limite, ou o jogo ter NVIDIA Reflex)',
      'cita fonte',
    ],
  },

  /* ------------------------------ guia ------------------------------ */
  {
    id: 'taticas-pubg',
    tipo: 'guia',
    pedido: 'Quais as melhores táticas para vencer partidas de PUBG no PC?',
    criterios: [
      'traz pelo menos quatro dicas concretas e aplicáveis',
      'as dicas são específicas de PUBG (zona, loot, posicionamento, veículos, rotação), não conselho genérico de jogo',
      'está organizado por tema ou por fase da partida',
      'diz de onde vêm as dicas (comunidade, guias ou links)',
    ],
  },
];
