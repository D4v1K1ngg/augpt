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

const { checagensDeTexto } = require('./checagens-de-produto');

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
    // 11/10: só com os critérios acima, uma resposta sem NENHUMA citação da
    // comunidade tirou 10. O que dá para conferir pelo texto, o código confere.
    checagens: [
      { nome: 'cinco opções numeradas', ok: (r) => (r.match(/^#### \d+\. /gm) || r.match(/^\d+\. \*\*/gm) || []).length >= 5 },
      { nome: 'nenhum headset entre as opções', ok: (r) => !(r.match(/^#### \d+\. .*/gm) || []).some((t) => /headset|maxwell|astro a\d|cloud (ii|iii|2|3|alpha|stinger)\b|quantum \d{3}/i.test(t)) },
      // 14/10: era "3 citações de usuários" — premiava o comentário colado; agora a comunidade conta como FONTE
      { nome: 'pelo menos 3 fontes da comunidade (Reddit ou fórum)', ok: (r) => new Set(r.match(/reddit\.com\/r\/\w+\/comments\/\w+|— r\/\w+|clubedohardware\.com\.br\/[^\s)]+|adrenaline\.com\.br\/[^\s)]+|head-fi\.org\/[^\s)]+/gi) || []).size >= 3 },
      { nome: 'pelo menos 3 opções com preço', ok: (r) => (r.match(/\*\*Faixa de preço:\*\*|R\$\s?\d|US\$\s?\d/g) || []).length >= 3 },
      { nome: 'nenhuma opção só com nome de marca ou de site', ok: (r) => !(r.match(/^#### \d+\. .*/gm) || []).some((t) => t.replace(/^#### \d+\. /, '').trim().split(/\s+/).length < 2) },
      ...checagensDeTexto(),
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
    checagens: [
      { nome: 'traz um percentual ou uma medida em FPS', ok: (r) => /\d+([.,]\d+)?\s?%|\d+\s?fps/i.test(r) },
      { nome: 'cita ao menos um link de fonte', ok: (r) => /https?:\/\//.test(r) },
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
    checagens: [
      { nome: 'traz um valor em reais', ok: (r) => /R\$\s?\d/.test(r) },
      { nome: 'diz que é estimativa', ok: (r) => /estimativ|prov[aá]vel|aproximad|pode variar|incert|n[aã]o h[aá] como garantir/i.test(r) },
      { nome: 'cita ao menos um link de fonte', ok: (r) => /https?:\/\//.test(r) },
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
    checagens: [
      { nome: 'pelo menos quatro itens em lista', ok: (r) => (r.match(/^\s*(?:[-*]|\d+\.)\s+\S/gm) || []).length >= 4 },
      { nome: 'cita ao menos uma fonte (link ou comunidade)', ok: (r) => /https?:\/\/|— r\/\w+/.test(r) },
      { nome: 'nenhum produto à venda no meio das dicas', ok: (r) => !/R\$\s?\d|\*\*Faixa de preço/.test(r) },
    ],
  },

  /* ---------------- segunda leva (2026-10-11): perguntas mais difíceis ---------------- */
  // A primeira leva ficou com média 9,4 — perto do teto, não mostrava piora
  // pequena. Estas pedem mais fatos por resposta, misturam áreas e incluem
  // conta e comparação.
  {
    id: 'tcp-handshake',
    tipo: 'explicacao',
    pedido: 'Como funciona o three-way handshake do TCP?',
    fatos: [
      'são três mensagens: SYN, SYN-ACK e ACK',
      'o cliente começa enviando um SYN (com o seu número de sequência inicial)',
      'o servidor responde com SYN-ACK',
      'o cliente confirma com um ACK e a conexão fica estabelecida',
    ],
  },
  {
    id: 'navegador',
    tipo: 'explicacao',
    pedido: 'O que acontece desde que eu digito um endereço no navegador até a página aparecer?',
    fatos: [
      'o nome do site é traduzido em endereço IP pelo DNS',
      'o navegador abre uma conexão com o servidor (TCP, e TLS quando é https)',
      'o navegador envia uma requisição HTTP',
      'o servidor responde com o HTML da página',
      'o navegador baixa os demais recursos (CSS, JavaScript, imagens) e desenha a página',
    ],
  },
  {
    id: 'vacina-mrna',
    tipo: 'explicacao',
    pedido: 'Como funcionam as vacinas de mRNA?',
    fatos: [
      'levam um RNA mensageiro com a instrução para fabricar uma proteína do vírus (a proteína spike, no caso da covid-19)',
      'as células da pessoa produzem essa proteína',
      'o sistema imunológico reconhece a proteína e produz anticorpos e memória imunológica',
      'o mRNA não altera o DNA (não entra no núcleo) e é degradado pelo corpo depois',
    ],
  },
  {
    id: 'bitcoin',
    tipo: 'explicacao',
    pedido: 'Como funciona a mineração de bitcoin?',
    fatos: [
      'os mineradores validam transações e as agrupam em blocos',
      'usa prova de trabalho: é preciso achar um hash abaixo de um alvo, testando valores (nonce)',
      'quem minera o bloco recebe bitcoins novos e as taxas das transações',
      'a dificuldade é reajustada para manter cerca de 10 minutos por bloco',
      'a recompensa cai pela metade periodicamente (halving, a cada cerca de 4 anos)',
    ],
  },
  {
    id: 'inflacao',
    tipo: 'explicacao',
    pedido: 'O que é inflação e como o banco central tenta controlá-la?',
    fatos: [
      'inflação é o aumento generalizado e contínuo dos preços',
      'ela reduz o poder de compra do dinheiro',
      'o banco central sobe a taxa básica de juros (a Selic, no Brasil) para contê-la',
      'juros mais altos encarecem o crédito e reduzem o consumo e a demanda',
    ],
  },
  {
    id: 'revolucao-francesa',
    tipo: 'explicacao',
    pedido: 'Quais foram as causas da Revolução Francesa?',
    fatos: [
      'começou em 1789',
      'crise financeira do Estado francês (dívidas, impostos)',
      'fome e alta do preço do pão, depois de colheitas ruins',
      'desigualdade e privilégios da nobreza e do clero (o Antigo Regime, monarquia absolutista)',
      'influência das ideias do Iluminismo',
    ],
  },
  {
    id: 'segunda-guerra',
    tipo: 'fato',
    pedido: 'Como começou e como terminou a Segunda Guerra Mundial?',
    fatos: [
      'começou em 1939 (1º de setembro), com a invasão da Polônia pela Alemanha',
      'terminou em 1945',
      'a Alemanha se rendeu em maio de 1945',
      'o Japão se rendeu depois das bombas atômicas em Hiroshima e Nagasaki',
    ],
    errada: 'A Segunda Guerra Mundial começou em 1914, com o assassinato de um arquiduque em Sarajevo, e terminou em 1918 com o Tratado de Versalhes. Não houve uso de armas nucleares.',
  },
  {
    id: 'buraco-negro',
    tipo: 'explicacao',
    pedido: 'O que é um buraco negro?',
    fatos: [
      'região do espaço com gravidade tão forte que nem a luz consegue escapar',
      'o limite a partir do qual nada escapa é o horizonte de eventos',
      'forma-se pelo colapso de estrelas de grande massa',
      'existem buracos negros supermassivos no centro das galáxias',
    ],
  },
  {
    id: 'dna-rna',
    tipo: 'explicacao',
    pedido: 'Qual a diferença entre DNA e RNA?',
    fatos: [
      'o DNA tem fita dupla; o RNA, em geral, fita simples',
      'o açúcar do DNA é a desoxirribose; o do RNA, a ribose',
      'o DNA tem timina; o RNA tem uracila no lugar',
      'o DNA guarda a informação genética; o RNA participa da produção de proteínas',
    ],
  },
  {
    id: 'git-merge-rebase',
    tipo: 'explicacao',
    pedido: 'Qual a diferença entre git merge e git rebase?',
    fatos: [
      'o merge junta os dois históricos, em geral criando um commit de merge',
      'o rebase reaplica os commits em cima de outra base, deixando o histórico linear',
      'o rebase reescreve o histórico (os commits ganham novos identificadores)',
      'não se deve fazer rebase de commits já publicados em um branch compartilhado',
    ],
  },
  {
    id: 'ssd-hd',
    tipo: 'explicacao',
    pedido: 'Qual a diferença entre SSD e HD?',
    fatos: [
      'o HD grava em discos magnéticos que giram, com partes móveis',
      'o SSD usa memória flash, sem partes móveis',
      'o SSD é bem mais rápido para ler e gravar',
      'o HD costuma ser mais barato por gigabyte',
    ],
  },
  {
    id: 'ipv4-ipv6',
    tipo: 'explicacao',
    pedido: 'Qual a diferença entre IPv4 e IPv6?',
    fatos: [
      'o endereço IPv4 tem 32 bits (cerca de 4,3 bilhões de endereços)',
      'o endereço IPv6 tem 128 bits',
      'o IPv6 foi criado porque os endereços IPv4 estavam se esgotando',
      'o IPv4 é escrito em decimal com pontos; o IPv6, em hexadecimal com dois-pontos',
    ],
  },
  {
    id: 'pitagoras',
    tipo: 'fato',
    pedido: 'Um triângulo retângulo tem catetos de 9 cm e 12 cm. Quanto mede a hipotenusa e qual é a área?',
    fatos: ['a hipotenusa mede 15 cm', 'a área é 54 cm²'],
    errada: 'A hipotenusa mede 21 cm, que é a soma dos catetos, e a área é 108 cm².',
  },
  {
    id: 'juros-compostos',
    tipo: 'fato',
    pedido: 'Quanto vira R$ 10.000 aplicados a 1% ao mês durante 12 meses, com juros compostos?',
    fatos: ['o montante final é de aproximadamente R$ 11.268 (11.268,25)', 'o rendimento é de aproximadamente R$ 1.268'],
  },
  {
    id: 'machado',
    tipo: 'fato',
    pedido: 'Quem foi Machado de Assis e quais são suas principais obras?',
    fatos: [
      'escritor brasileiro, nascido no Rio de Janeiro em 1839 e morto em 1908',
      'foi fundador e primeiro presidente da Academia Brasileira de Letras',
      'cita Dom Casmurro',
      'cita Memórias Póstumas de Brás Cubas',
    ],
  },
  {
    id: 'independencia',
    tipo: 'fato',
    pedido: 'Quando e como o Brasil se tornou independente?',
    fatos: [
      'em 7 de setembro de 1822',
      'a independência foi proclamada por Dom Pedro I (então príncipe regente)',
      'às margens do riacho Ipiranga, em São Paulo',
      'o Brasil se separou de Portugal',
    ],
  },
  {
    id: 'plutao',
    tipo: 'fato',
    pedido: 'Quantos planetas tem o sistema solar e por que Plutão deixou de ser considerado planeta?',
    fatos: [
      'o sistema solar tem 8 planetas',
      'Plutão foi reclassificado como planeta anão em 2006',
      'a decisão foi da União Astronômica Internacional',
      'porque Plutão não limpou a vizinhança da sua órbita (um dos critérios para ser planeta)',
    ],
  },
  {
    id: 'agua-altitude',
    tipo: 'explicacao',
    pedido: 'Por que a água ferve a uma temperatura menor em lugares altos?',
    fatos: [
      'em altitude a pressão atmosférica é menor',
      'a água ferve quando a sua pressão de vapor se iguala à pressão externa',
      'com menos pressão isso acontece a uma temperatura abaixo de 100 °C',
    ],
  },
  {
    id: 'newton',
    tipo: 'fato',
    pedido: 'Quais são as três leis de Newton?',
    fatos: [
      'primeira lei, da inércia: um corpo mantém repouso ou movimento retilíneo uniforme se a força resultante for nula',
      'segunda lei: a força resultante é igual à massa vezes a aceleração (F = m·a)',
      'terceira lei, da ação e reação: a toda ação corresponde uma reação de mesma intensidade e sentido oposto',
    ],
  },
  {
    id: 'em6l-fps',
    tipo: 'produto',
    pedido: 'O Simgot EM6L é bom para jogar FPS?',
    fatos: ['o EM6L é um fone intra-auricular híbrido, com 1 driver dinâmico e 4 armaduras balanceadas (1DD + 4BA)'],
    criterios: [
      'dá uma resposta clara à pergunta (serve ou não serve, e com que ressalvas)',
      'relata o que usuários dizem sobre usar esse fone em jogos (passos, posicionamento, palco)',
      'menciona pelo menos um ponto fraco ou ressalva',
    ],
    checagens: [
      { nome: 'cita ao menos uma fonte (link ou comunidade)', ok: (r) => /https?:\/\/|— r\/\w+/.test(r) },
      { nome: 'não recomenda outro produto no lugar sem ser pedido', ok: (r) => !/^#### 2\. /m.test(r) },
    ],
  },
  {
    // 12/10, uso real: este pedido (um dos exemplos da tela inicial) foi
    // respondido com trabalhos de conclusão de curso de uma faculdade de sigla FPS
    id: 'iems-planilha',
    tipo: 'produto',
    pedido: 'Compare 3 IEMs para FPS e gere uma planilha com o comparativo',
    criterios: [
      'compara três fones intra-auriculares, cada um com marca e modelo',
      'a comparação trata do uso em jogos de tiro (passos, posicionamento, palco sonoro, separação)',
    ],
    checagens: [
      { nome: 'não fala de faculdade nem de trabalho de conclusão de curso', ok: (r) => !/conclus[aã]o de curso|faculdade|universidade/i.test(r) },
      { nome: 'menciona a planilha ou o arquivo gerado', ok: (r) => /planilha|\.xlsx|arquivo/i.test(r) },
      { nome: 'cita ao menos uma fonte (link ou comunidade)', ok: (r) => /https?:\/\/|— r\/\w+/.test(r) },
    ],
  },
  {
    // uso real de 13/10: virou "fone para treino" e recomendou o Samsung Galaxy Buds
    id: 'dunu-titan-s',
    tipo: 'produto',
    pedido: 'fone de ouvido dunu titan s',
    criterios: [
      'a resposta é sobre o Dunu Titan S: diz o que é o produto e traz dados da ficha dele',
      'traz pontos fortes e pontos fracos do Dunu Titan S explicados em texto, não só comentários colados',
    ],
    checagens: [
      { nome: 'fala do Dunu Titan S', ok: (r) => /dunu/i.test(r) && /titan\s?s/i.test(r) },
      { nome: 'não recomenda outro produto no lugar (Galaxy Buds, Jabra…)', ok: (r) => !/galaxy buds|jabra|aftershokz|recomendo (o|a) (?!dunu)/i.test(r) },
      { nome: 'não inventa uso (treino, músico)', ok: (r) => !/exerc[ií]cio f[ií]sico|para m[uú]sicos?\b/i.test(r) },
      { nome: 'cita ao menos uma fonte (link ou comunidade)', ok: (r) => /https?:\/\/|— r\/\w+/.test(r) },
      ...checagensDeTexto({ minimoExplicados: 1 }),
    ],
  },
  {
    id: 'mouse-fps',
    tipo: 'produto',
    pedido: 'Qual o melhor mouse para jogos de tiro até R$ 300?',
    criterios: [
      'recomenda modelos específicos, com marca e nome',
      'justifica com características que importam em jogo de tiro (sensor, peso, formato, taxa de atualização)',
      'deixa claro qual é a primeira recomendação',
    ],
    checagens: [
      { nome: 'traz preço em reais', ok: (r) => /R\$\s?\d/.test(r) },
      { nome: 'cita ao menos uma fonte (link ou comunidade)', ok: (r) => /https?:\/\/|— r\/\w+/.test(r) },
      { nome: 'as opções são mouses (nenhum teclado, headset ou mousepad como opção)', ok: (r) => !(r.match(/^#### \d+\. .*/gm) || []).some((t) => /teclado|headset|mousepad|fone/i.test(t)) },
      ...checagensDeTexto(),
    ],
  },
  {
    // uso real de 13/10: veio fone de cabeça (HD650), headset (HyperX), "IEMs planares" e a mesma frase em 4 opções
    id: 'iems-musica-10',
    tipo: 'produto',
    pedido: 'Recomende 10 fones intra auriculares para ouvir musica',
    criterios: [
      'recomenda fones intra-auriculares específicos, cada um com marca e modelo',
      'explica, para cada opção principal, como ela soa ou o que tem de diferente (assinatura sonora, graves, palco, conforto), não só que é boa',
      'traz pontos fracos ou ressalvas de pelo menos parte das opções',
      'deixa claro qual é a primeira recomendação',
    ],
    checagens: [
      { nome: 'nenhum fone de cabeça ou headset entre as opções', ok: (r) => !/\b(hd ?6[05]0|hd ?6xx|hd ?560s?|dt ?\d{3}|cloud (ii|iii|alpha|2|3)|arctis|maxwell|headset)\b/i.test(nomesDasOpcoes(r).join(' | ')) },
      { nome: 'nenhuma "opção" que é categoria (ex.: IEMs planares)', ok: (r) => !nomesDasOpcoes(r).some((t) => /\b(iems?|fones?|planares|modelos?)\b/i.test(t) && !/\d/.test(t)) },
      { nome: 'cita ao menos 3 fontes', ok: (r) => (r.match(/https?:\/\//g) || []).length >= 3 },
      ...checagensDeTexto(),
    ],
  },
];

/** Nomes das opções: cartões "#### N. Nome" e a lista "N. **Nome** — …". */
function nomesDasOpcoes(r) {
  return [...String(r).matchAll(/^#### \d+\. (.+)$|^\d+\. \*\*([^*]+)\*\*/gm)].map((m) => (m[1] || m[2]).trim());
}
