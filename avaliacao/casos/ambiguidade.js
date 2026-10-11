'use strict';

/**
 * Verificação de ambiguidade (item 4 do plano de melhorias): uma checagem
 * antes da primeira decisão substitui a regra cega de "nunca pergunte nas
 * duas primeiras rodadas" por uma checagem de verdade — que distingue
 * "falta um dado que só o usuário sabe" de "o modelo está com preguiça de
 * pesquisar". A regra cega continua existindo, só ganha uma exceção legítima
 * e estreita (só na 1ª rodada, só quando a verificação apontou a falta).
 *
 * `caso.ambiguidade` controla a resposta fake da verificação — ver
 * avaliacao/motor.js. Sem esse campo, o padrão é 'suficiente' (não afeta
 * nenhum outro caso da bancada).
 */

module.exports = [
  {
    nome: 'verificação de ambiguidade: pedido claro segue direto, sem perguntar nada',
    pedido: 'Me conte sobre o SR-71 Blackbird',
    // ambiguidade não definido = 'suficiente' (padrão) — o pedido já é claro
    roteiro: [
      { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'SR-71 Blackbird' } },
      { ferramenta: 'responder', argumentos: { foco: 'história e características do SR-71' } },
    ],
    espera: { ok: true, perguntouAoUsuario: false },
  },

  {
    nome: 'verificação de ambiguidade: pedido ambíguo vira pergunta já na primeira ação, sem gastar rodada de recusa',
    pedido: 'Apague o arquivo',
    arquivos: { 'relatorio-2025.txt': 'x', 'relatorio-2026.txt': 'y' },
    ambiguidade: 'qual dos dois arquivos parecidos você quer que eu apague: relatorio-2025.txt ou relatorio-2026.txt?',
    roteiro: [
      // a PRIMEIRA decisão já é perguntar_usuario — a verificação prévia já
      // validou que falta um dado que só o usuário sabe, então isto não é a
      // "pergunta preguiçosa" que a regra antiga existe para barrar
      { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'qual dos dois arquivos parecidos você quer que eu apague?' } },
      { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'relatorio-2025.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'confirmação da exclusão' } },
    ],
    espera: { ok: true, perguntouAoUsuario: true },
    posVerificar: (obtido) => [
      !obtido.erros.some((e) => e.includes('Pergunta prematura')) ||
        `a pergunta pré-validada foi barrada como se fosse preguiça: ${JSON.stringify(obtido.erros)}`,
    ],
  },

  {
    nome: 'verificação de ambiguidade: não é uma porta geral — pergunta espontânea na 2ª rodada continua barrada',
    pedido: 'Apague o arquivo',
    arquivos: { 'relatorio-2025.txt': 'x', 'relatorio-2026.txt': 'y' },
    // a verificação sinalizou falta de informação, mas o modelo NÃO perguntou
    // na 1ª rodada (escolheu listar primeiro) — a exceção vale só pra "primeira
    // ação", então uma tentativa espontânea na rodada seguinte deve continuar
    // sendo barrada pela regra antiga, exatamente como antes desta mudança
    ambiguidade: 'qual dos dois arquivos parecidos você quer que eu apague?',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'qual arquivo apago?' } },
      { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'relatorio-2025.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'confirmação da exclusão' } },
    ],
    espera: { perguntouAoUsuario: false },
    posVerificar: (obtido) => [
      obtido.erros.some((e) => e.includes('Pergunta prematura')) ||
        `esperava a regra antiga barrando a tentativa espontânea da 2ª rodada: ${JSON.stringify(obtido.erros)}`,
    ],
  },
];
