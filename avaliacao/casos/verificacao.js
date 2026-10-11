'use strict';

const verificador = require('../../src/agent/verificador');
const { extrairEntidades } = verificador;
const { executarCasoAgente } = require('../motor');

const MATERIAL = 'Sexta 14 Ago: 30% de chuva, 32°/21°. Valor do documento R$ 410,49, vencimento 17/08/2026.';

// Caso real de produção (log de 2026-09-11, id mtx0medt-ifxe): pedida uma
// análise política/econômica/social do Brasil 2000-2026, a busca só trouxe
// as páginas da Wikipédia sobre a eleição de 2010 e sobre Ciro Gomes — e a
// resposta final afirmou que "as eleições de 2022 resultaram em uma vitória
// surpreendente para Jair Bolsonaro" (que na verdade perdeu aquela eleição).
// Nem número, nem data: "verificacao": { "suspeitas": [], "totalSuspeitas":
// 0, "aprovado": true } no log real — passou batido antes desta correção.
const MATERIAL_ELEICAO_2010 =
  'A eleição presidencial no Brasil em 2010 teve como candidatos Dilma Rousseff, José Serra e Ciro Gomes. ' +
  'Ciro Gomes concorreu pelo PSB e terminou em terceiro lugar na disputa.';

module.exports = [
  {
    nome: 'número inventado vira suspeita e dispara reescrita',
    pedido: 'Qual o valor e o vencimento do boleto?',
    arquivos: { 'boleto.txt': MATERIAL },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'valor e vencimento' } },
    ],
    // primeira redação inventa; segunda usa os dados reais
    redacao: (_p, tentativa) =>
      tentativa === 1
        ? 'O valor é R$ 890,00 com vencimento em 25/12/2026 e multa de R$ 77,00.'
        : 'O valor é R$ 410,49 com vencimento em 17/08/2026.',
    espera: {
      ok: true,
      respostaContem: ['410,49', '17/08/2026'],
      respostaNaoContem: ['890,00'],
      verificacaoReescreveu: true,
      suspeitasFinais: 0,
    },
  },

  {
    nome: 'resposta correta passa sem reescrita',
    pedido: 'Qual o valor do boleto?',
    arquivos: { 'boleto.txt': MATERIAL },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'O documento tem valor de R$ 410,49, com vencimento em 17 de agosto de 2026.',
    espera: { ok: true, respostaContem: ['410,49'], verificacaoReescreveu: false, suspeitasFinais: 0 },
  },

  {
    nome: 'resposta fora do assunto é reescrita',
    pedido: 'Qual a previsão de chuva para sexta?',
    arquivos: { 'clima.txt': MATERIAL },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'clima.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'chuva na sexta' } },
    ],
    redacao: (_p, tentativa) =>
      tentativa === 1
        ? 'Este documento trata de assuntos administrativos diversos.'
        : 'Na sexta, 30% de chance de chuva, com máxima de 32°.',
    // Caso real (Davi, 2026-09-18): o 'resposta-reinicia' que apaga a
    // resposta e começa de novo parecia um glitch, sem explicação nenhuma
    // pro usuário — agora vem com `motivo` (ver renderer/app.js).
    espera: { ok: true, respostaContem: ['30%'], verificacaoReescreveu: true, reiniciosComMotivo: true },
  },

  {
    nome: 'sem material coletado não acusa invenção',
    pedido: 'Quanto é 2 elevado a 10?',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'a conta' } }],
    redacao: 'O resultado é 1.024.',
    espera: { ok: true, respostaContem: ['1.024'], verificacaoReescreveu: false },
  },

  {
    // Caso real de produção (log de 2026-09-11): busca de preço de GPU que
    // não achou nada — `semMaterial: true` — mas o modelo inventou vários
    // preços mesmo assim, e o verificador (antes desta correção) deixava
    // passar porque a checagem de fabricação se desligava sozinha
    // justamente quando não havia material nenhum pra comparar.
    nome: 'fabricação farta SEM material nenhum agora dispara reescrita (o verificador não se desliga mais sozinho)',
    pedido: 'Qual o preço da placa de vídeo RTX 5080 nas lojas?',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o preço' } }],
    redacao: (_p, tentativa) =>
      tentativa === 1
        ? 'A RTX 5080 custa R$ 11,50 na Loja A, R$ 4.999,00 na Loja B e R$ 5.200,00 na Loja C.'
        : 'A busca não encontrou um preço confiável pra RTX 5080 nas fontes consultadas.',
    espera: {
      ok: true,
      verificacaoReescreveu: true,
      respostaNaoContem: ['11,50'],
    },
  },

  {
    // Contraste com o caso acima: um único valor sem material (não "fartura"
    // de invenção) continua sem disparar reescrita — mesmo comportamento de
    // antes, só a fabricação farta (3+ afirmações) que agora é pega.
    nome: 'um único valor isolado sem material continua sem disparar reescrita (só fabricação farta dispara)',
    pedido: 'Em que ano o homem pisou na Lua pela primeira vez?',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o ano' } }],
    redacao: 'Foi em 1969.',
    espera: { ok: true, respostaContem: ['1969'], verificacaoReescreveu: false },
  },

  /* -------- fase 4: nome próprio inventado (numero/data não pegam isso) -------- */

  {
    nome: 'nome próprio inventado (caso real: vencedor errado de eleição) dispara reescrita, nome grounded sobrevive',
    pedido: 'Quem disputou e quem venceu as eleições presidenciais analisadas no material?',
    arquivos: { 'eleicao.txt': MATERIAL_ELEICAO_2010 },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'eleicao.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'candidatos e resultado' } },
    ],
    // primeira redação reproduz a fabricação real do log (nome inventado,
    // sem número nem data — só o crítico de entidades pega); segunda usa só
    // o que está no material
    redacao: (_p, tentativa) =>
      tentativa === 1
        ? 'As eleições de 2022 resultaram em uma vitória surpreendente para Jair Bolsonaro, ' +
          'consolidando o Partido da República. Antes disso, Ciro Gomes também disputou a presidência.'
        : 'Ciro Gomes disputou a eleição de 2010 pelo PSB e terminou em terceiro lugar.',
    espera: {
      ok: true,
      respostaContem: ['Ciro Gomes'],
      respostaNaoContem: ['Jair Bolsonaro'],
      verificacaoReescreveu: true,
    },
  },

  /* -------- reescrita item-a-item (caso real: prova de 10 questões, DeepSeek R1 8B) -------- */

  {
    // Caso real analisado com o Davi (3 conversas reais, prova de 10
    // questões): a reescrita pós-verificação era UMA chamada só pedindo
    // "responda tudo que faltou", com `rascunho: ''` — jogava fora o que já
    // tinha sido respondido certo e mandava o modelo reescrever o PEDIDO
    // INTEIRO de novo. Na prática isso costumava voltar só com a primeira
    // questão respondida (o padrão visto nas 3 conversas). Esta versão
    // simplificada usa 3 perguntas (piso de "pedido tipo prova", ver
    // `perguntasMultiplas`/MIN_PERGUNTAS_MULTIPLAS) sobre assuntos bem
    // distintos entre si, pra que a cobertura por termos não se confunda de
    // uma pergunta pra outra (ao contrário de perguntas com palavras em
    // comum, tipo "qual a capital de X").
    nome: 'reescrita item-a-item: cada parte que faltou vira uma chamada de redação isolada, sem descartar o que já tinha sido respondido',
    pedido:
      'Explique o que é Teoria da Complexidade Computacional? Explique o que é um Deadlock em Sistemas ' +
      'Operacionais? Explique o que é o protocolo TCP/IP em Redes de Computadores?',
    arquivos: { 'apoio.txt': 'Material de apoio genérico sobre ciência da computação, sem relação direta com nenhuma das 3 perguntas.' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'apoio.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'as 3 perguntas' } },
    ],
    // 1ª tentativa: só a primeira pergunta (o bug real). 2ª e 3ª chamadas são
    // os COMPLEMENTOS item-a-item, um por parte que faltou, na ordem em que
    // apareceram no pedido.
    redacao: (_p, tentativa) => {
      if (tentativa === 1) {
        return 'Teoria da Complexidade Computacional estuda os recursos (tempo e memória) necessários pra resolver um problema.';
      }
      if (tentativa === 2) {
        return 'Deadlock em Sistemas Operacionais é quando processos ficam presos esperando recursos uns dos outros, sem nenhum avançar.';
      }
      return 'O protocolo TCP/IP em Redes de Computadores organiza a comunicação entre computadores em camadas, garantindo entrega confiável dos dados.';
    },
    espera: {
      ok: true,
      // as 3 respostas precisam estar TODAS no texto final — não só a 1ª,
      // que era o bug — e a de complexidade (já correta na 1ª tentativa) não
      // pode ter sido descartada pelas chamadas de complemento.
      respostaContem: ['Complexidade Computacional', 'Deadlock', 'TCP/IP'],
      verificacaoReescreveu: true,
      // Caso real (Davi, 2026-09-18): cada reinício item-a-item precisa vir
      // com `motivo` explicando qual parte está sendo completada — não só o
      // primeiro (ver renderer/app.js, manipuladores['resposta-reinicia']).
      reiniciosComMotivo: true,
      // 1 (1ª tentativa) + 2 complementos (um por parte que faltou) = 3.
      // Se algum dia voltar a ser 2 (1 tentativa + 1 reescrita monolítica),
      // este teste falha — é exatamente o comportamento antigo que causava
      // o bug.
      chamadasRedacao: 3,
    },
  },

  {
    nome: 'nome próprio presente no material não é suspeita, mesmo com acento/maiúscula diferentes',
    pedido: 'Quem disputou a eleição segundo o material?',
    arquivos: { 'eleicao.txt': MATERIAL_ELEICAO_2010 },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'eleicao.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'os candidatos' } },
    ],
    redacao: 'Dilma Rousseff e José Serra disputaram a eleição, além de Ciro Gomes.',
    espera: { ok: true, verificacaoReescreveu: false, suspeitasFinais: 0 },
  },

  {
    nome: 'extrairEntidades: título markdown e rótulo em negrito são formatação, não viram entidade',
    tipo: 'unidade',
    executar() {
      const texto =
        '### Análise das Questões Políticas do Brasil\n' +
        '- **Estabilidade Institucional:** o país viveu um período calmo.\n' +
        '- **Crise Econômica:** houve recessão.';
      const achadas = extrairEntidades(texto);
      return [
        !achadas.includes('Análise das Questões') || 'título markdown virou entidade',
        !achadas.some((e) => e.includes('Estabilidade Institucional')) || 'rótulo em negrito virou entidade',
        !achadas.some((e) => e.includes('Crise Econômica')) || 'rótulo em negrito virou entidade',
      ];
    },
  },

  {
    nome: 'extrairEntidades: palavra capitalizada sozinha (início de frase) não conta como nome próprio',
    tipo: 'unidade',
    executar() {
      const achadas = extrairEntidades('Além disso, o resultado foi positivo. Segundo os dados, tudo melhorou.');
      return [achadas.length === 0 || `esperava zero entidades, veio: ${JSON.stringify(achadas)}`];
    },
  },

  {
    nome: 'extrairEntidades: preposição liga o nome ("Partido da República"), mas "e" não gruda nomes diferentes',
    tipo: 'unidade',
    executar() {
      const comPreposicao = extrairEntidades('O Partido da República venceu a disputa.');
      const comE = extrairEntidades('Fernando Henrique Cardoso e Lula governaram em décadas diferentes.');
      return [
        comPreposicao.includes('Partido da República') || `esperava "Partido da República", veio: ${JSON.stringify(comPreposicao)}`,
        comE.includes('Fernando Henrique Cardoso') || `esperava "Fernando Henrique Cardoso" isolado, veio: ${JSON.stringify(comE)}`,
        !comE.some((e) => e.includes(' e Lula')) || `"e" grudou dois nomes diferentes num só: ${JSON.stringify(comE)}`,
      ];
    },
  },

  {
    nome: 'extrairEntidades: sequência de maiúsculas longa demais (6+ palavras) é descartada como ruído',
    tipo: 'unidade',
    executar() {
      const achadas = extrairEntidades(
        'Ministério da Economia da Fazenda do Planejamento do Desenvolvimento Nacional atuou.'
      );
      return [achadas.length === 0 || `esperava descarte por tamanho, veio: ${JSON.stringify(achadas)}`];
    },
  },

  {
    // Achado cosmético do mesmo relatório (log de 09/11): sigla seguida de
    // plural minúsculo colado ("LMGs") truncava pra "LM" — o "s" minúsculo
    // logo depois de "LMG" derrubava o lookahead de "maiúscula sem minúscula
    // colada" na maior tentativa de match, e o regex recuava pra "LM" (que
    // É seguido de maiúscula, "G", então passa). Não muda se a suspeita
    // dispara ou não — só evita um valor truncado e esquisito no relatório.
    nome: 'extrairEntidades: sigla seguida de plural minúsculo ("LMGs") não trunca mais pra "LM"',
    tipo: 'unidade',
    executar() {
      const achadas = extrairEntidades('Ajustes no tempo de mira. Balanço das LMGs foi revisado nesta atualização.');
      return [
        achadas.includes('Balanço das LMGs') || `esperava "Balanço das LMGs" inteiro, veio: ${JSON.stringify(achadas)}`,
        !achadas.some((a) => a.endsWith(' LM')) || `ainda truncou pra "LM": ${JSON.stringify(achadas)}`,
      ];
    },
  },

  {
    // Mesmo piso já usado pros números: um único nome sem respaldo (não
    // "fartura" de invenção) não força reescrita sozinho.
    nome: 'verificar: um único nome próprio sem respaldo não basta pra disparar reescrita sozinho',
    tipo: 'unidade',
    executar() {
      const { verificar } = require('../../src/agent/verificador');
      const r = verificar({
        resposta: 'Segundo o material, Ciro Gomes disputou a eleição de 2010. Michel Temer também foi citado no debate.',
        dossie: [MATERIAL_ELEICAO_2010],
        objetivo: 'Quem disputou as eleições?',
      });
      return [
        r.suspeitas.some((s) => s.tipo === 'entidade' && s.valor === 'Michel Temer') ||
          `deveria haver suspeita de entidade pra "Michel Temer" (sem respaldo no material): ${JSON.stringify(r.suspeitas)}`,
        !r.suspeitas.some((s) => s.valor.includes('Ciro Gomes')) || 'Ciro Gomes está no material e não deveria ser suspeita',
        !r.reescrever || `um único nome isolado não deveria disparar reescrita sozinho: ${JSON.stringify(r)}`,
      ];
    },
  },

  /* -------- reescrita que não corrige de verdade (caso real: RTX 5080 a R$ 11,50) -------- */

  {
    // calcularConfianca isolado: uma suspeita "persistente" (sobreviveu à
    // reescrita) pesa MAIS que uma suspeita comum — sinal de que a correção
    // foi tentada e não resolveu aquele ponto específico.
    nome: 'calcularConfianca: suspeita que sobrevive à reescrita pesa mais que uma suspeita comum',
    tipo: 'unidade',
    executar() {
      const base = { totalSuspeitas: 1, suspeitas: [{ tipo: 'numero', valor: 'R$ 11,50' }], respondeAoPedido: true };
      const comum = verificador.calcularConfianca({ verificacao: base, cobertura: { nivel: 'boa' }, cruzamento: {}, fontes: 2 });
      const persistente = verificador.calcularConfianca({
        verificacao: { ...base, suspeitasPersistentes: base.suspeitas },
        cobertura: { nivel: 'boa' },
        cruzamento: {},
        fontes: 2,
      });
      return [
        persistente.pontos < comum.pontos ||
          `esperava menos pontos com suspeita persistente (${persistente.pontos}) do que sem (${comum.pontos})`,
        persistente.motivos.some((m) => m.includes('continuaram sem respaldo mesmo depois da correção')) ||
          `esperava motivo explícito sobre suspeita persistente: ${JSON.stringify(persistente.motivos)}`,
      ];
    },
  },

  {
    // calcularConfianca isolado: divergência de OPINIÃO (item 1 do pedido do
    // Davi, 2026-09-23 — cross-validation de opinião em confronto.js) pesa
    // contra a confiança, mas menos que divergência de NÚMERO (-1 vs -2):
    // opinião varia mais legitimamente entre fonte do que fato objetivo.
    nome: 'calcularConfianca: divergência de opinião pesa contra a confiança, mas menos que divergência de número',
    tipo: 'unidade',
    executar() {
      const semDivergencia = verificador.calcularConfianca({
        cobertura: { nivel: 'boa' },
        cruzamento: { suficiente: true, dominios: 2, confirmados: [] },
        fontes: 2,
      });
      const comOpiniao = verificador.calcularConfianca({
        cobertura: { nivel: 'boa' },
        cruzamento: { suficiente: true, dominios: 2, confirmados: [], divergenciasOpiniao: [{ entidade: 'X' }] },
        fontes: 2,
      });
      const comNumero = verificador.calcularConfianca({
        cobertura: { nivel: 'boa' },
        cruzamento: { suficiente: true, dominios: 2, confirmados: [], divergencias: [{ unidade: '°C' }] },
        fontes: 2,
      });
      return [
        comOpiniao.pontos < semDivergencia.pontos || 'divergência de opinião deveria reduzir a pontuação',
        comOpiniao.motivos.some((m) => m.includes('divergem na avaliação')) ||
          `esperava motivo sobre divergência de opinião: ${JSON.stringify(comOpiniao.motivos)}`,
        comOpiniao.pontos > comNumero.pontos ||
          `divergência de opinião deveria pesar menos que a de número (opinião: ${comOpiniao.pontos}, número: ${comNumero.pontos})`,
      ];
    },
  },

  {
    // Caso real de produção (log de 09/11): busca de preço da RTX 5080 sem
    // fonte confiável — a 1ª redação inventa R$ 11,50; a verificação pede
    // correção; a 2ª redação, em vez de remover o valor, só coloca uma
    // ressalva em volta dele ("não pode ser verificada") e MANTÉM o mesmo
    // R$ 11,50. `totalSuspeitas` não piora (1 em ambas as tentativas), então
    // antes desta correção a versão "corrigida" era aceita como resolvida.
    // Agora: a confiança final registra explicitamente que aquele valor
    // sobreviveu à correção — não removemos nada da resposta (ver o cabeçalho
    // de verificador.js), só paramos de tratar isso como problema resolvido.
    nome: 'confiança final registra quando a reescrita NÃO remove a mesma suspeita (caso real: RTX 5080 a R$ 11,50)',
    pedido: 'Qual o preço da placa de vídeo RTX 5080 nas lojas?',
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'o preço' } }],
    redacao: (_p, tentativa) =>
      tentativa === 1
        ? 'A RTX 5080 custa R$ 11,50 na gpuprix.com, R$ 4.999,00 na Loja B e R$ 5.200,00 na Loja C.'
        : 'Não foi possível confirmar preços atualizados nas demais lojas; a gpuprix.com chegou a mostrar R$ 11,50, mas essa informação não pode ser verificada.',
    espera: {
      ok: true,
      verificacaoReescreveu: true,
      confiancaMotivosContem: ['continuaram sem respaldo mesmo depois da correção'],
    },
  },

  /* -------- escolha entre tentativas não pode trocar "responde ao pedido" por "sem invenção" -------- */

  {
    // Gap real encontrado numa bateria de testes com o Davi (Testes 2 e 3 da
    // rodada de planejamento forçado): a 1ª redação dispara reescrita por
    // fabricação farta (3+ afirmações sem respaldo), mas ainda respondia ao
    // que foi pedido. A regra antiga de escolha comparava só `totalSuspeitas`
    // — aqui a 2ª tentativa "corrige" removendo os números inventados, só que
    // indo pro assunto errado (0 suspeitas, mas não responde mais ao
    // pedido). Antes desta correção, a versão fora do assunto vencia (0 <= 3
    // suspeitas). Agora: regredir de respondeAoPedido=true pra false nunca é
    // aceito, não importa quanto menos suspeito o texto ficou — fica com a
    // primeira tentativa (que ao menos trata do que foi perguntado, mesmo
    // com os números errados sinalizados como suspeita).
    nome: 'escolha entre tentativas: revisão que "corrige" indo pro assunto errado não é aceita (respondeAoPedido não pode regredir)',
    pedido: 'Qual o valor e o vencimento do boleto?',
    arquivos: { 'boleto.txt': MATERIAL },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'valor e vencimento' } },
    ],
    redacao: (_p, tentativa) =>
      tentativa === 1
        ? 'O valor é R$ 890,00 com vencimento em 25/12/2026 e multa de R$ 77,00.'
        : 'Este documento trata de assuntos administrativos diversos.',
    espera: {
      ok: true,
      verificacaoReescreveu: true,
      respostaContem: ['890,00'],
      respostaNaoContem: ['assuntos administrativos'],
    },
  },

  {
    // Contraparte do caso acima: quando as DUAS tentativas continuam sem
    // responder ao pedido (nenhuma alternativa melhor disponível), a escolha
    // entre elas não muda — mas o usuário passa a ser avisado no fim da
    // resposta de que a verificação interna não aprovou o resultado, em vez
    // de receber a resposta ruim calada como "concluído" (caso real: Testes
    // 2 e 3 da mesma bateria — o sistema sabia que tinha errado e entregava
    // do mesmo jeito).
    nome: 'aviso ao usuário quando nem a reescrita consegue aprovação da verificação (resposta continua fora do assunto nas duas tentativas)',
    pedido: 'Qual a previsão de chuva para sexta?',
    arquivos: { 'clima.txt': MATERIAL },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'clima.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'chuva na sexta' } },
    ],
    redacao: 'Este documento trata de assuntos administrativos diversos, sem relação com o pedido.',
    espera: {
      ok: true,
      respostaContem: ['não consegui confirmar com segurança que esta resposta cobre bem o que foi pedido'],
    },
  },

  {
    // Bug real de produção (achado pelo próprio Davi, rodando de novo um dos
    // testes da bateria já com o aviso acima implementado): a resposta era
    // longa, correta e respondia bem a todas as partes do pedido sobre
    // compilação em C — mas usava "**Linkagem Dinâmica**" como subtítulo em
    // negrito, e esse subtítulo (uma frase capitalizada de duas palavras que
    // não aparece literalmente igual no material) foi sinalizado como
    // "entidade sem respaldo". Isso sozinho derrubava `aprovado` pra false
    // (que exige ZERO suspeitas, por menor que seja a gravidade), disparando
    // o aviso numa resposta que na verdade estava ótima — exatamente o tipo
    // de falso positivo que `reescrever` já sabia evitar (ver "um único nome
    // próprio sem respaldo não basta pra disparar reescrita sozinho", link:
    // `verificar: um único nome próprio sem respaldo não basta pra disparar
    // reescrita sozinho`, tipo unidade, acima). O aviso não deve aparecer
    // aqui: só uma suspeita isolada, `respondeAoPedido: true`, sem fabricação
    // farta — reescrever nem chega a disparar (`verificacaoReescreveu:
    // false` abaixo confere isso).
    nome: 'aviso NÃO aparece quando só há uma suspeita isolada (subtítulo em negrito) numa resposta que responde bem ao pedido (caso real: "Linkagem Dinâmica")',
    pedido: 'Explique o processo de linkagem de um programa em C.',
    arquivos: {
      'linkagem.txt':
        'O processo de linkagem une arquivos objeto e bibliotecas para produzir o executável final. Pode ser estática ou dinâmica.',
    },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'linkagem.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o processo de linkagem' } },
    ],
    redacao:
      'O processo de linkagem une os arquivos objeto às bibliotecas necessárias.\n\n' +
      '**Linkagem Dinâmica**: o executável carrega bibliotecas em tempo de execução, resolvendo símbolos dinamicamente.',
    espera: {
      ok: true,
      verificacaoReescreveu: false,
      respostaNaoContem: ['não consegui confirmar com segurança'],
    },
  },

  {
    // Caso real de produção: pedido com 9-10 perguntas de prova (uma por
    // assunto de CC) — o teto antigo de 5 em decomporPedido descartava as
    // partes 6-10, e a verificação de cobertura simplesmente não tinha como
    // perceber que elas ficaram sem resposta. Aqui confere só a decomposição
    // em si, com um pedido sintético de 8 perguntas.
    nome: 'decomporPedido: teto levantado de 5 pra 20 (caso real: prova com 9-10 perguntas)',
    tipo: 'unidade',
    executar() {
      const pedido = Array.from({ length: 8 }, (_, i) => `Pergunta número ${i + 1}, sobre o assunto ${i + 1}`)
        .map((p) => `${p}?`)
        .join(' ');
      const partes = verificador.decomporPedido(pedido);
      return [
        partes.length === 8 || `esperava as 8 perguntas rastreadas, veio ${partes.length}`,
      ];
    },
  },

  {
    // Caso real de produção: depois do fix de "várias perguntas" (que
    // instrui o redator a numerar cada resposta — ver perguntasMultiplas),
    // uma resposta de 10 itens numerados ("1. Questão 1 ... 2. Questão 2
    // ...") virou 10+ "afirmações numéricas sem respaldo" — o "." do
    // marcador de lista ("1.") era engolido pelo regex guloso de
    // extrairNumeros e contava como se fosse separador decimal, disparando
    // o filtro de "número com vírgula/ponto" que deveria justamente
    // IGNORAR numeração de lista (ver o comentário no próprio código). Isso
    // derrubava a confiança da resposta pra "baixa" e disparava uma
    // reescrita inútil, mesmo a resposta estando correta e completa.
    nome: 'extrairNumeros: numeração de lista markdown ("1. Questão 1") não conta como afirmação numérica',
    tipo: 'unidade',
    executar() {
      const achados = verificador.extrairNumeros(
        '1. Questão 1 (Teoria da Complexidade)\n2. Questão 2 (Sistemas Operacionais)\n11. Questão 10 (Linguagens)'
      );
      return [
        achados.length === 0 || `esperava nenhum número relevante (é só numeração de lista), veio: ${JSON.stringify(achados)}`,
      ];
    },
  },

  {
    nome: 'extrairNumeros: separador decimal/milhar de verdade continua contando mesmo colado no fim da frase',
    tipo: 'unidade',
    executar() {
      const achados = verificador.extrairNumeros('O valor é R$ 1.240,50, conforme o contrato.');
      return [
        achados.some((a) => a.valor === 1240.5) || `esperava capturar 1.240,50 como 1240.5, veio: ${JSON.stringify(achados)}`,
      ];
    },
  },

  {
    // Caso real de produção: um pedido de várias perguntas trazia os
    // próprios títulos de categoria ("Teoria da Complexidade", "Bancos de
    // Dados"...) — a resposta ecoou esses títulos de volta (comportamento
    // normal, não invenção) e, sem material nenhum (a busca não achou
    // nada), isso virava "nome próprio sem respaldo": o usuário deu esse
    // texto no próprio pedido, o modelo não inventou.
    nome: 'verificar: nome próprio que já vem do PRÓPRIO PEDIDO não é suspeita, mesmo sem material',
    tipo: 'unidade',
    executar() {
      const { verificar } = verificador;
      const objetivo = 'Explique a Teoria da Complexidade e o que é NP-Completo.';
      const resposta = 'A Teoria da Complexidade estuda o Problema da Parada e outros temas centrais.';
      const v = verificar({ resposta, dossie: [], objetivo });
      return [
        !v.suspeitas.some((s) => s.tipo === 'entidade' && s.valor === 'Teoria da Complexidade') ||
          `"Teoria da Complexidade" veio do próprio pedido e não deveria ser suspeita: ${JSON.stringify(v.suspeitas)}`,
        v.suspeitas.some((s) => s.tipo === 'entidade' && s.valor === 'Problema da Parada') ||
          `"Problema da Parada" não está no pedido nem no material — devia continuar suspeito: ${JSON.stringify(v.suspeitas)}`,
      ];
    },
  },

  {
    // Caso real de produção (chat "Pergunta 1", prova de 4 questões sobre o
    // guia PMBOK 7ª edição, formato exportado de plataforma de ensino):
    // "Pergunta N" + enunciado + alternativas a-e, separadas por uma linha
    // "0 pontos". A estratégia antiga (cortar por "?") falhava de duas
    // formas aqui: nem toda questão termina em "?" (a última terminava em
    // ":", "...são chamadas de:") e mesmo quando termina, o corte cai ENTRE
    // o enunciado e as próprias alternativas da mesma questão — a parte N
    // ficava só com o enunciado, e a parte N+1 misturava as alternativas de
    // N com o enunciado de N+1. Isso não é só estético: a verificação por
    // parte (`conferirPartes`) e a lista de perguntas no prompt de redação
    // checam/mostram CADA parte isolada, então uma alternativa grudada na
    // questão errada é uma alternativa que nenhuma verificação corretamente
    // associa à sua própria pergunta.
    nome: 'decomporPedido: prova com "Pergunta N" + alternativas a-e mantém enunciado e alternativas juntos na MESMA parte',
    tipo: 'unidade',
    executar() {
      const pedido = [
        'Pergunta 1',
        'Considerando o guia PMBOK, qual das alternativas a seguir não pode ser considerada um domínio de desempenho?',
        '\ta.\t\tPartes interessadas.',
        '\tb.\t\tEquipe.',
        '\tc.\t\tCadência.',
        '',
        '0 pontos',
        '',
        'Pergunta 2',
        'Como é chamada a primeira etapa no engajamento das partes interessadas?',
        '\ta.\t\tCompreender.',
        '\tb.\t\tIdentificar.',
        '\tc.\t\tEngajar.',
        '',
        '0 pontos',
        '',
        'Pergunta 3',
        // Enunciado sem "?" no fim — caso real: nem toda questão de prova é
        // formulada como interrogação.
        'As formas de otimizar tarefas dentro de um projeto são chamadas de:',
        '\ta.\t\tTailoring.',
        '\tb.\t\tMétodos.',
        '\tc.\t\tMedição.',
      ].join('\n');
      const partes = verificador.decomporPedido(pedido);
      return [
        partes.length === 3 || `esperava 3 questões, vieram ${partes.length}`,
        (partes[0]?.includes('domínio de desempenho') && partes[0]?.includes('Partes interessadas.')) ||
          'parte 1 não trouxe o enunciado JUNTO com sua própria alternativa',
        !partes[0]?.includes('engajamento das partes interessadas') ||
          'parte 1 vazou o enunciado da PRÓXIMA questão',
        (partes[1]?.includes('engajamento das partes interessadas') && partes[1]?.includes('Identificar.')) ||
          'parte 2 não trouxe o enunciado JUNTO com sua própria alternativa',
        !partes[1]?.includes('Cadência') || 'parte 2 vazou uma alternativa da questão ANTERIOR',
        (partes[2]?.includes('chamadas de:') && partes[2]?.includes('Métodos.')) ||
          'parte 3 (enunciado sem "?") não foi reconhecida como questão própria com sua alternativa',
      ];
    },
  },

  {
    nome: 'perguntasMultiplas: só considera "tipo prova" a partir de 3 perguntas distintas',
    tipo: 'unidade',
    executar() {
      const duasPerguntas = 'Qual o valor do boleto? Quando vence?';
      const tresPerguntas = 'O que é NP-completo? O que é thrashing? Como funciona o Paxos?';
      return [
        verificador.perguntasMultiplas(duasPerguntas) === null ||
          `esperava null com só 2 perguntas, veio ${JSON.stringify(verificador.perguntasMultiplas(duasPerguntas))}`,
        verificador.perguntasMultiplas(tresPerguntas)?.length === 3 ||
          `esperava 3 partes com 3 perguntas, veio ${JSON.stringify(verificador.perguntasMultiplas(tresPerguntas))}`,
      ];
    },
  },

  {
    nome:
      'classificarPedido: decide determinísticamente (sem chamar o modelo) quando um pedido precisa de planejamento forçado',
    tipo: 'unidade',
    executar() {
      const simples = 'Resuma o arquivo relatorio.txt';
      const provaComPerguntas = 'O que é NP-completo? O que é thrashing? Como funciona o Paxos? O que é RSA?';
      const pedidoLongoSemPontuacaoLimpa = 'Explique detalhadamente '.repeat(60); // > 800 chars, sem "?" nem lista

      const cSimples = verificador.classificarPedido(simples);
      const cProva = verificador.classificarPedido(provaComPerguntas);
      const cLongo = verificador.classificarPedido(pedidoLongoSemPontuacaoLimpa);

      return [
        cSimples.precisaPlanejamento === false ||
          `pedido simples não deveria precisar de planejamento, veio ${JSON.stringify(cSimples)}`,
        cSimples.perguntas === null || 'pedido simples não deveria ter perguntas decompostas',
        cProva.precisaPlanejamento === true ||
          `pedido com 4 perguntas deveria precisar de planejamento, veio ${JSON.stringify(cProva)}`,
        cProva.perguntas?.length === 4 || `esperava 4 perguntas decompostas, veio ${JSON.stringify(cProva.perguntas)}`,
        cLongo.precisaPlanejamento === true ||
          'pedido longo (>800 chars) sem pontuação limpa deveria precisar de planejamento pelo comprimento',
      ];
    },
  },

  {
    // Backlog do Copiloto, item c1 (Estruturação — "Outline do dossiê por
    // tópico antes da redação"). Caso real da mesma classe do gate de
    // checklist: prova de 3 perguntas (NP-completo, thrashing, Paxos) em que
    // a busca só trouxe material sobre as duas primeiras. Antes desta
    // função, o redator recebia o dossiê inteiro como um bloco só de texto e
    // tinha que adivinhar sozinho que a 3ª pergunta ficou sem cobertura —
    // aqui isso é medido por código, pra virar aviso explícito no prompt.
    nome: 'esbocoPorTopico: aponta qual pergunta tem material coletado no dossiê e qual não tem',
    tipo: 'unidade',
    executar() {
      const perguntas = ['O que é NP-completo', 'O que é thrashing', 'Como funciona o Paxos'];
      const dossie = [
        { texto: 'NP-completo é uma classe de problemas de complexidade computacional muito estudada.' },
        { texto: 'Thrashing acontece quando o sistema operacional troca páginas de memória demais e trava.' },
      ];
      const esboco = verificador.esbocoPorTopico(perguntas, dossie);

      return [
        esboco?.length === 3 || `esperava 3 entradas, veio ${JSON.stringify(esboco)}`,
        esboco?.[0]?.temMaterial === true || 'deveria achar material de NP-completo no dossiê',
        esboco?.[1]?.temMaterial === true || 'deveria achar material de thrashing no dossiê',
        esboco?.[2]?.temMaterial === false || 'não deveria achar material de Paxos (não está no dossiê)',
        verificador.esbocoPorTopico(null, dossie) === null || 'sem perguntas múltiplas, não deveria calcular esboço',
        verificador.esbocoPorTopico(perguntas, []) === null || 'sem dossiê, não deveria calcular esboço',
      ];
    },
  },

  {
    // Caso real de produção (prova de 10 questões de ciência da
    // computação, cada uma citando um algoritmo/protocolo/teorema nomeado —
    // RSA, Paxos, Dijkstra, Hindley-Milner, Cook-Levin, RAW, 2PL, etc.): a
    // resposta do modelo (20 mil caracteres!) derrapou pra um assunto
    // GENÉRICO diferente (gerência de memória virtual, repetido várias
    // vezes) e não mencionou nenhum desses termos nem uma vez — mas a
    // cobertura por radical genérico (`termosPrincipais`, 40%) aprovou as 11
    // partes como "respondidas" mesmo assim, só por vocabulário acadêmico
    // comum ("sistema", "processo", "algoritmo") se repetir bastante numa
    // resposta comprida. `respondeAoPedido` voltava `true` numa resposta que,
    // de fato, não tratava de quase nada do que foi perguntado.
    //
    // Versão reduzida do mesmo padrão (4 perguntas, cada uma com um marcador
    // técnico bem definido; resposta longa e repetitiva sobre os MESMOS
    // assuntos em termos genéricos, sem citar nenhum marcador específico).
    nome:
      'conferirPartes: marcador técnico específico (RSA, Dijkstra, LL/LR...) tem que aparecer, não só ' +
      'vocabulário genérico compartilhado (caso real: prova de 10 questões, resposta de 20 mil caracteres fora do assunto)',
    tipo: 'unidade',
    executar() {
      const pedido =
        'Questão 1 (Criptografia) Qual problema matemático fundamenta a segurança do RSA? ' +
        'Questão 2 (Grafos) Por que o Algoritmo de Dijkstra falha com arestas de peso negativo? ' +
        'Questão 3 (Compiladores) Qual a diferença entre um parser LL(1) e um parser LR(1)?';
      const paragrafoGenerico =
        'A segurança de sistemas modernos depende de algoritmos matemáticos bem projetados. ' +
        'O estudo de grafos e estruturas de dados ajuda a entender como um algoritmo processa e resolve problemas de forma eficiente. ' +
        'Compiladores usam algoritmos de análise para transformar um programa em código executável, processando cada parte do texto. ';
      // repete o mesmo parágrafo genérico várias vezes — como a resposta
      // real, que ficava enorme sem nunca sair do assunto errado — pra
      // inflar a cobertura por radical em todas as partes sem citar nenhum
      // dos marcadores (RSA, Dijkstra, LL, LR) uma vez sequer.
      const respostaForaDoAssunto =
        `${paragrafoGenerico}\n\n`.repeat(5) +
        'Em resumo, criptografia, grafos e compiladores são temas centrais da ciência da computação.';

      const partes = verificador.conferirPartes(pedido, respostaForaDoAssunto);
      const v = verificador.verificar({ resposta: respostaForaDoAssunto, dossie: [{ texto: 'material qualquer' }], objetivo: pedido });

      return [
        partes.length === 3 || `esperava 3 partes, veio ${partes.length}`,
        partes.every((p) => !p.respondida) ||
          `nenhuma das 3 partes deveria contar como respondida (nenhum marcador específico aparece), veio ${JSON.stringify(
            partes.map((p) => p.respondida)
          )}`,
        v.respondeAoPedido === false ||
          'respondeAoPedido deveria ser false — a resposta não cita nenhum dos marcadores técnicos específicos',
        v.partesNaoRespondidas.length === 3 || `esperava as 3 partes como não respondidas, veio ${v.partesNaoRespondidas.length}`,
      ];
    },
  },

  {
    // Contraste com o caso acima: quando a resposta REALMENTE cita o
    // marcador específico (mesmo sem repetir todo o vocabulário da
    // pergunta), a parte conta como respondida — o mecanismo novo não fica
    // mais rígido que o necessário, só fecha o furo do vocabulário genérico.
    nome: 'conferirPartes: marcador específico presente é suficiente, não precisa repetir toda a pergunta',
    tipo: 'unidade',
    executar() {
      const pedido = 'Questão 1 (Criptografia) Qual problema matemático fundamenta a segurança do RSA?';
      const resposta = 'O RSA depende da dificuldade de fatorar números inteiros grandes em seus fatores primos.';
      const partes = verificador.conferirPartes(pedido, resposta);
      return [
        partes.length === 1 || `esperava 1 parte, veio ${partes.length}`,
        partes[0]?.respondida === true || 'deveria contar como respondida — o marcador "RSA" está presente',
      ];
    },
  },

  {
    // Caso real de produção (2026-09-15, logs `mu2shec3-1pru` e
    // `mu2supwh-ld3h`): a MESMA pergunta sobre a teoria da relatividade de
    // Einstein, feita duas vezes com reformulação mínima, saiu uma vez
    // correta e outra vez como um ensaio de história da arte (Van Eyck,
    // Manet, Monet, Picasso) que só menciona "teoria"/"relatividade" na
    // abertura e no fechamento. `respondeAoPedido` aprovava (`true`) porque
    // a cobertura por termo só pergunta SE aparece em algum lugar do texto
    // inteiro, não ONDE — e o pedido é uma pergunta ÚNICA (sem 2+ partes
    // pra `conferirPartes` entrar em ação). Versão reduzida do mesmo padrão.
    nome: 'verificar: assunto só na moldura (abertura/fechamento) não conta como resposta, mesmo com pergunta única',
    tipo: 'unidade',
    executar() {
      const { verificar } = verificador;
      const objetivo = 'Me explique como que funciona a teoria da relatividade de Albert Einstein';
      const paragrafoDeArte =
        'A pintura de Duccio di Buoninsegna ainda tratava o espaço de forma simbólica, sem profundidade real. ' +
        'Já Van Eyck, em obras como a Madona do Chanceler Rolin, explorou minuciosamente a perspectiva e o detalhe. ' +
        'Manet, em Piquenique sobre a Relva, rompeu com a representação tradicional do espaço pictórico.';
      const respostaForaDoAssunto =
        'Vou explicar a teoria da relatividade através de uma analogia com a história da arte.\n\n' +
        `${paragrafoDeArte}\n\n`.repeat(6) +
        'Assim como esses pintores reinventaram o espaço na tela, a relatividade reinventou o espaço na física.';

      const v = verificar({ resposta: respostaForaDoAssunto, dossie: [{ texto: 'material qualquer sobre arte e física' }], objetivo });
      const distribuicao = verificador.coberturaPorParagrafo(verificador.termosPrincipais(objetivo), respostaForaDoAssunto);

      return [
        (distribuicao !== null && distribuicao < 0.34) ||
          `esperava distribuição baixa (assunto só na moldura), veio ${distribuicao}`,
        v.respondeAoPedido === false || 'respondeAoPedido deveria ser false — o corpo da resposta não trata do pedido',
      ];
    },
  },

  {
    // Contraste com o caso acima: quando o assunto está espalhado pelo corpo
    // da resposta (não só na moldura), a distribuição por parágrafo não deve
    // derrubar uma resposta que de fato trata do pedido.
    nome: 'verificar: assunto espalhado pelo corpo da resposta continua aprovado (distribuição não penaliza resposta boa)',
    tipo: 'unidade',
    executar() {
      const { verificar } = verificador;
      const objetivo = 'Me explique como que funciona a teoria da relatividade de Albert Einstein';
      const respostaBoa =
        'A teoria da relatividade de Einstein se divide em restrita e geral.\n\n' +
        'Na relatividade restrita, o tempo e o espaço são relativos ao observador, e a fórmula E=mc² relaciona massa e energia.\n\n' +
        'Já a relatividade geral descreve a gravidade como curvatura do espaço-tempo causada pela massa.\n\n' +
        'Um exemplo prático da relatividade é o ajuste de relógios usado pelo sistema de GPS.';

      const v = verificar({ resposta: respostaBoa, dossie: [{ texto: 'material sobre relatividade e Einstein' }], objetivo });

      return [v.respondeAoPedido === true || `respondeAoPedido deveria ser true, veio ${JSON.stringify(v)}`];
    },
  },

  {
    // Caso real de produção (Davi repetiu a mesma prova de 10 questões
    // depois da correção acima, pra conferir): a resposta acertou Dijkstra
    // ("Dijkstra falha silenciosamente... use Bellman-Ford") mas nunca repete
    // a frase inteira "Algoritmo de Dijkstra" que `extrairEntidades` extraiu
    // como marcador — só "Dijkstra" sozinho. A 1ª versão desta correção
    // exigia a frase INTEIRA, e isso quase virou um falso negativo novo (uma
    // resposta correta marcada como "não respondida"). Ao mesmo tempo, um
    // teste sintético revelou o motivo de não bastar decompor a entidade em
    // QUALQUER palavra sua: "Algoritmo" (a primeira palavra da entidade) é
    // maiúscula só por estar no início da frase, não por ser nome próprio —
    // uma resposta genérica que só repete "algoritmo" à toa (sem nunca citar
    // "Dijkstra") não pode contar como resposta à questão de Dijkstra.
    nome:
      'conferirPartes: nome próprio dentro de uma entidade multi-palavra (ex.: "Dijkstra" em "Algoritmo de ' +
      'Dijkstra") basta sozinho — mas a primeira palavra da entidade (posicional, não nome próprio) não conta',
    tipo: 'unidade',
    executar() {
      const pedido =
        'Questão 1 (Criptografia) Qual problema matemático fundamenta a segurança do RSA? ' +
        'Questão 2 (Grafos) Por que o Algoritmo de Dijkstra falha com arestas de peso negativo? ' +
        'Questão 3 (Compiladores) Qual a diferença entre um parser LL(1) e um parser LR(1)?';

      const respostaBoaSemFraseCompleta =
        'O RSA depende de fatorar números primos grandes. ' +
        'Dijkstra falha silenciosamente quando há arestas de peso negativo; use Bellman-Ford nesse caso. ' +
        'Um parser LL(1) constrói a árvore top-down, enquanto um LR(1) constrói bottom-up.';
      const boa = verificador.conferirPartes(pedido, respostaBoaSemFraseCompleta);

      const paragrafoGenerico =
        'A segurança de sistemas modernos depende de algoritmos matemáticos bem projetados. ' +
        'Sistemas distribuídos coordenam processos em máquinas diferentes através de algoritmos de consenso entre os participantes. ' +
        'O estudo de grafos e estruturas de dados ajuda a entender como um algoritmo processa e resolve problemas de forma eficiente. ' +
        'Compiladores usam algoritmos de análise para transformar um programa em código executável, processando cada parte do texto. ';
      const respostaGenericaSemDijkstra = `${paragrafoGenerico}\n\n`.repeat(5);
      const ruim = verificador.conferirPartes(pedido, respostaGenericaSemDijkstra);

      return [
        boa[1]?.respondida === true ||
          `Dijkstra deveria contar como respondida sem repetir "Algoritmo de Dijkstra" por inteiro, veio ${JSON.stringify(boa[1])}`,
        ruim[1]?.respondida === false ||
          `resposta que só repete "algoritmo" (a palavra posicional, não o nome próprio) não deveria contar como respondida, veio ${JSON.stringify(ruim[1])}`,
      ];
    },
  },

  {
    // Caso real de produção (2026-09-14, cotação de dólar): material com
    // "29/06/2026" apresentado como "a cotação atual" com hoje sendo
    // 14/09/2026 — quase 2,5 meses (77 dias) de diferença, sem nenhuma
    // ressalva na resposta. O dado não é inventado (está no material), então
    // `verificar()` nunca pegaria isso — é sobre IDADE, não fabricação.
    nome: 'diasDesdeDataMaisRecente: mede a idade do dado mais recente com data completa (caso real: cotação de dólar de 77 dias)',
    tipo: 'unidade',
    executar() {
      const hoje = new Date(2026, 8, 14); // 14/09/2026 (mês 0-indexado)
      const dias = verificador.diasDesdeDataMaisRecente(
        'Cotação em 29/06/2026: R$ 5,1698. Fonte consultada.',
        hoje
      );
      return [dias === 77 || `esperava 77 dias, veio ${dias}`];
    },
  },

  {
    nome: 'diasDesdeDataMaisRecente: sem data nenhuma no texto devolve null (nada a avisar)',
    tipo: 'unidade',
    executar() {
      const dias = verificador.diasDesdeDataMaisRecente('Um texto qualquer, sem nenhuma data.', new Date(2026, 8, 14));
      return [dias === null || `esperava null, veio ${dias}`];
    },
  },

  {
    nome: 'diasDesdeDataMaisRecente: pega a MAIS RECENTE entre várias datas, e ignora data no futuro',
    tipo: 'unidade',
    executar() {
      const hoje = new Date(2026, 8, 14); // 14/09/2026
      // 3 datas: uma bem antiga, uma recente (2 dias atrás) e uma no FUTURO
      // (não deve contar — não serve pra medir "quão velho" o material é).
      const dias = verificador.diasDesdeDataMaisRecente(
        'Publicado em 01/01/2026. Atualizado em 12/09/2026. Previsão para 01/12/2026.',
        hoje
      );
      return [dias === 2 || `esperava 2 dias (a mais recente das 3, ignorando a futura), veio ${dias}`];
    },
  },

  {
    nome: 'diasDesdeDataMaisRecente: data de hoje mesmo (0 dias) não conta como desatualizado',
    tipo: 'unidade',
    executar() {
      const hoje = new Date(2026, 8, 14);
      const dias = verificador.diasDesdeDataMaisRecente('Cotação de hoje, 14/09/2026: R$ 5,45.', hoje);
      return [dias === null || `data de hoje não deveria contar como desatualizada, veio ${dias}`];
    },
  },
  {
    nome: 'partes do pedido (10º teste real): lista de nomes entre aspas não vira 3 perguntas; conectivo curto não é parte',
    tipo: 'unidade',
    executar() {
      const forum = verificador.decomporPedido(
        "Realize uma pesquisa profunda em foruns da comunidade como no 'reddit, clube do hardware, forum do adrenalise' para encontrar os 10 melhores fones intra auriculares para se jogar pubg de pc"
      );
      const precos = verificador.decomporPedido(
        'Analise o histórico de preços da RTX 5070 Ti desde o lançamento junto da RTX 5080, dessa forma vamos montar uma média de preço até hoje, após obter os dados, vamos construir um gráfico relacionando a média com as datas.'
      );
      const boleto = verificador.decomporPedido('o valor, o vencimento e o que acontece se eu atrasar');
      return [
        forum.length === 1 || `a lista entre aspas virou ${forum.length} partes: ${JSON.stringify(forum)}`,
        !precos.some((p) => /^após obter os dados$/i.test(p)) || `"após obter os dados" virou parte: ${JSON.stringify(precos)}`,
        precos.some((p) => /gráfico/.test(p)) || 'a parte do gráfico continua sendo conferida',
        boleto.length === 3 || `enumeração curta de sempre continua em 3 partes: ${JSON.stringify(boleto)}`,
      ];
    },
  },

  {
    nome: 'complemento que só repete a resposta é reconhecido (mesmos títulos / mesmas linhas)',
    tipo: 'unidade',
    executar() {
      const resposta = '### Resposta Direta\nPara jogar PUBG eu escolheria o KZ EDX Pro, pelo palco sonoro.\n\n### Destaques\n- KZ EDX Pro: cabo destacável, 16 ohms, bom para passos.';
      const repetido = '### Resposta Direta\nPara jogar PUBG, eu escolheria o KZ EDX Pro — pelo palco sonoro.\n\n### Destaques\n- outra coisa qualquer escrita aqui.';
      const novo = 'Sobre o Clube do Hardware: os tópicos de lá recomendam o QKZ AK6 como opção barata para jogos.';
      return [
        verificador.complementoRepete(resposta, repetido) === true || 'dois títulos repetidos = repetição',
        verificador.complementoRepete(resposta, `${resposta}\n`) === true || 'texto idêntico = repetição',
        verificador.complementoRepete(resposta, novo) === false || 'complemento de verdade não pode ser descartado',
      ];
    },
  },

  {
    nome: 'complemento por parte que reescreve a resposta inteira não é colado no fim (resposta saía 3x, 10º teste real)',
    tipo: 'unidade',
    async executar() {
      const inteira =
        '### Resposta\nO valor do boleto é R$ 410,49 conforme o documento.\n\n### Detalhes do boleto\nO boleto tem valor de R$ 410,49 e foi emitido pelo banco emissor.';
      const obtido = await executarCasoAgente({
        nome: 'complemento repetido',
        pedido: 'o valor do boleto, o vencimento do boleto e o que acontece se eu atrasar o pagamento',
        arquivos: { 'boleto.txt': MATERIAL },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'boleto' } },
        ],
        // toda redação (inclusive os "complementos") devolve a resposta inteira de novo
        redacao: () => inteira,
      });
      const vezes = (obtido.resposta.match(/### Detalhes do boleto/g) || []).length;
      return [
        obtido.chamadasRedacao >= 2 || `o caso deveria passar pelos complementos por parte (redações: ${obtido.chamadasRedacao})`,
        vezes === 1 || `a resposta saiu ${vezes} vezes: ${obtido.resposta.slice(0, 400)}`,
      ];
    },
  },
  {
    nome: 'calibragem (300 execuções reais, 11/10): pergunta explicativa não é reprovada por conhecimento geral; com preço na resposta a regra antiga vale; texto que contradiz a série calculada é pego',
    tipo: 'unidade',
    async executar() {
      const v = require('../../src/agent/verificador');
      const serie = require('../../src/agent/serie-de-precos');
      const resposta = 'Um gerador converte energia mecânica em elétrica pela indução eletromagnética, descoberta por Michael Faraday em 1831.';
      const objetivo = 'Como um gerador funciona?';
      const antes = v.verificar({ resposta, objetivo });
      const geral = v.verificar({ resposta, objetivo, conhecimentoGeral: true });
      const comPreco = v.verificar({ resposta: `${resposta} Um modelo de 1831 custava R$ 4.500 em 12 lojas de 7 cidades.`, objetivo, conhecimentoGeral: true });
      const confianca = v.calcularConfianca({ verificacao: geral, cobertura: { nivel: 'ausente' } });

      const analise = serie.analisar(
        {
          observacoes: [
            { produto: 'RTX 5080', mes: '2025-01', preco: 6108, moeda: 'BRL' },
            { produto: 'RTX 5080', mes: '2025-04', preco: 9999, moeda: 'BRL' },
            { produto: 'RTX 5080', mes: '2026-10', preco: 6500, moeda: 'BRL' },
          ],
          semData: 0,
        },
        [{ nome: 'RTX 5080' }]
      );
      const contradiz = serie.contradicoesComASerie('- **janeiro de 2025:** R$ 23.000,00\n- **abril de 2025:** R$ 9.999,00\n- Em 2027 deve cair.', analise);
      const bate = serie.contradicoesComASerie('- **janeiro de 2025:** R$ 6.108,00\n- **outubro de 2026:** R$ 6.500,00 (menor valor)\n- março de 2025: R$ 1.234,00', analise);
      return [
        (antes.totalSuspeitas > 0 && !antes.aprovado) || 'sem a marca, o comportamento antigo não pode mudar',
        (geral.aprovado && !geral.reescrever) || `explicação de conhecimento geral reprovada: ${JSON.stringify({ a: geral.aprovado, r: geral.reescrever })}`,
        !confianca.motivos.some((m) => /sem respaldo/.test(m)) || `motivo enganoso: ${confianca.motivos.join(' | ')}`,
        (!comPreco.aprovado && !comPreco.conhecimentoGeral) || 'resposta com preço tem que seguir a regra rígida',
        (contradiz.length === 1 && /23\.000/.test(contradiz[0].valor) && /6108/.test(contradiz[0].detalhe)) || `contradição com a série: ${JSON.stringify(contradiz)}`,
        bate.length === 0 || `valor que bate (ou mês sem dado) não é contradição: ${JSON.stringify(bate)}`,
      ];
    },
  },
];
