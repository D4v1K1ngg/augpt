'use strict';

/**
 * Casos da Onda 2 do roadmap: rotina automática (agendamentos que disparam
 * sozinhos, com o app aberto) e subagente crítico (crítica periódica do
 * plano, além da segunda opinião que já existia só para ações destrutivas).
 */

const agendador = require('../../src/agent/agendador');
const { skills } = require('../motor');

/* ------------------------------ rotina automática (agendador.js) ------------------------------ */

const UM_MINUTO = 60000;
const UM_DIA = 24 * 60 * UM_MINUTO;

const casosAgendador = [
  {
    nome: 'agendador: intervalo nunca executado dispara na primeira checagem',
    tipo: 'unidade',
    async executar() {
      const item = { tipo: 'intervalo', minutos: 30, ativo: true, ultimaExecucao: null };
      return [agendador.deveDisparar(item, Date.now()) || 'deveria disparar sem execução anterior'];
    },
  },
  {
    nome: 'agendador: intervalo não dispara antes do tempo',
    tipo: 'unidade',
    async executar() {
      const agora = Date.now();
      const item = { tipo: 'intervalo', minutos: 30, ativo: true, ultimaExecucao: agora - 10 * UM_MINUTO };
      return [!agendador.deveDisparar(item, agora) || 'não deveria disparar com 10 de 30 minutos passados'];
    },
  },
  {
    nome: 'agendador: intervalo dispara assim que o tempo passa',
    tipo: 'unidade',
    async executar() {
      const agora = Date.now();
      const item = { tipo: 'intervalo', minutos: 30, ativo: true, ultimaExecucao: agora - 31 * UM_MINUTO };
      return [agendador.deveDisparar(item, agora) || 'deveria disparar depois de 31 de 30 minutos'];
    },
  },
  {
    nome: 'agendador: horário fixo não dispara antes da hora',
    tipo: 'unidade',
    async executar() {
      const agora = new Date();
      agora.setHours(8, 0, 0, 0);
      const item = { tipo: 'horario', horario: '09:00', ativo: true, ultimaExecucao: null };
      return [!agendador.deveDisparar(item, agora.getTime()) || 'não deveria disparar antes das 09:00'];
    },
  },
  {
    nome: 'agendador: horário fixo dispara ao passar da hora, se nunca executou',
    tipo: 'unidade',
    async executar() {
      const agora = new Date();
      agora.setHours(9, 5, 0, 0);
      const item = { tipo: 'horario', horario: '09:00', ativo: true, ultimaExecucao: null };
      return [agendador.deveDisparar(item, agora.getTime()) || 'deveria disparar às 09:05 se nunca rodou'];
    },
  },
  {
    nome: 'agendador: horário fixo não dispara de novo no mesmo dia',
    tipo: 'unidade',
    async executar() {
      const agora = new Date();
      agora.setHours(9, 30, 0, 0);
      const item = { tipo: 'horario', horario: '09:00', ativo: true, ultimaExecucao: agora.getTime() - UM_MINUTO };
      return [!agendador.deveDisparar(item, agora.getTime()) || 'não deveria disparar de novo no mesmo dia'];
    },
  },
  {
    nome: 'agendador: horário fixo dispara de novo no dia seguinte',
    tipo: 'unidade',
    async executar() {
      const agora = new Date();
      agora.setHours(9, 30, 0, 0);
      const item = { tipo: 'horario', horario: '09:00', ativo: true, ultimaExecucao: agora.getTime() - UM_DIA };
      return [agendador.deveDisparar(item, agora.getTime()) || 'deveria disparar de novo no dia seguinte'];
    },
  },
  {
    nome: 'agendador: inativo nunca dispara mesmo com a condição batendo',
    tipo: 'unidade',
    async executar() {
      const item = { tipo: 'intervalo', minutos: 1, ativo: false, ultimaExecucao: null };
      return [!agendador.deveDisparar(item, Date.now()) || 'agendamento inativo não deveria disparar'];
    },
  },
  {
    nome: 'agendador: agendamentosParaDisparar filtra só os prontos de uma lista mista',
    tipo: 'unidade',
    async executar() {
      const agora = Date.now();
      const lista = [
        { id: 'a', tipo: 'intervalo', minutos: 10, ativo: true, ultimaExecucao: agora - 20 * UM_MINUTO }, // pronto
        { id: 'b', tipo: 'intervalo', minutos: 60, ativo: true, ultimaExecucao: agora - 5 * UM_MINUTO }, // não
        { id: 'c', tipo: 'intervalo', minutos: 10, ativo: false, ultimaExecucao: agora - 20 * UM_MINUTO }, // inativo
      ];
      const prontos = agendador.agendamentosParaDisparar(lista, agora);
      return [
        (prontos.length === 1 && prontos[0].id === 'a') ||
          `esperava só "a" pronto, obteve ${JSON.stringify(prontos.map((p) => p.id))}`,
      ];
    },
  },
  {
    nome: 'agendador: criarAgendamento aplica defaults sãos',
    tipo: 'unidade',
    async executar() {
      const item = agendador.criarAgendamento({ texto: 'checar preço', tipo: 'intervalo', minutos: '0' });
      const item2 = agendador.criarAgendamento({ texto: 'bom dia', tipo: 'horario', horario: 'não é hora' });
      return [
        item.minutos >= 1 || 'minutos deveria ter um mínimo de 1 mesmo pedindo 0',
        item.ativo === true || 'novo agendamento deveria nascer ativo',
        /^([01]?\d|2[0-3]):[0-5]\d$/.test(item2.horario) || 'horário inválido deveria cair para um default válido',
        item.id !== item2.id || 'dois agendamentos criados não deveriam ter o mesmo id',
      ];
    },
  },
];

/* ------------------------------ subagente crítico (crítica periódica) ------------------------------ */

const casosCriticaPeriodica = [
  {
    nome: 'crítica periódica: dispara a cada N passos e o histórico da próxima decisão carrega a observação',
    pedido: 'Liste a pasta várias vezes e depois responda.',
    config: { criticaPeriodica: true },
    criticaDoPlano: () => 'Está repetindo a mesma leitura sem necessidade.',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 1
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 2
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 3
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 4
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 5 — dispara aqui
      { ferramenta: 'responder', argumentos: { foco: 'o que foi listado' } }, // 6
    ],
    redacao: 'A pasta foi listada.',
    espera: { ok: true, criticaPlanoDisparada: true },
    posVerificar(obtido) {
      const observacao = 'Está repetindo a mesma leitura sem necessidade.';
      const apareceuNumaDecisaoPosterior = obtido.mensagensDeDecisao
        .slice(5) // só as decisões DEPOIS da 5ª (onde a crítica disparou)
        .some((msgs) => JSON.stringify(msgs).includes(observacao));
      return [
        apareceuNumaDecisaoPosterior ||
          'a observação da crítica deveria aparecer no histórico enviado numa decisão posterior',
      ];
    },
  },

  {
    // pipelineForcadoUniversal desligado de propósito: este teste conta o
    // teto exato da cadência "simples" (criticaPeriodicaMax, hoje 2) — com o
    // pipeline universal (padrão desde 2026-09-14) este pedido de 1 pergunta
    // usaria o teto "Complexo" (bem mais alto) e o teste falharia por um
    // motivo que não tem nada a ver com o que ele verifica.
    nome: 'crítica periódica: teto de rodadas por execução não é ultrapassado',
    pedido: 'Liste a pasta muitas vezes e depois responda.',
    config: { criticaPeriodica: true, pipelineForcadoUniversal: false },
    maxIterations: 20,
    criticaDoPlano: () => 'Considere uma abordagem diferente.',
    roteiro: [
      ...Array.from({ length: 15 }, () => ({ ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } })),
      { ferramenta: 'responder', argumentos: { foco: 'o que foi listado' } },
    ],
    redacao: 'A pasta foi listada.',
    espera: { ok: true, criticaPlanoDisparada: true, criticaPlanoNoMaximo: 2 },
  },

  {
    nome: 'crítica periódica: duas falhas seguidas disparam a crítica antes mesmo do intervalo de N passos',
    pedido: 'Tente listar uma pasta fora do permitido, duas vezes, depois liste a pasta certa e responda.',
    config: { criticaPeriodica: true },
    criticaDoPlano: () => 'O caminho pedido está fora da pasta de trabalho — considere revisar a abordagem.',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '../../etc' } }, // 1 — falha (fora do jail)
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '../../etc' } }, // 2 — falha de novo
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 3 — crítica dispara ANTES desta, por 2 falhas seguidas
      { ferramenta: 'responder', argumentos: { foco: 'o que aconteceu' } }, // 4
    ],
    redacao: 'Não consegui listar a pasta pedida; listei a pasta de trabalho no lugar.',
    espera: { ok: true, criticaPlanoDisparada: true },
  },

  {
    nome: 'crítica periódica: desligada por configuração não faz chamada nenhuma',
    pedido: 'Liste a pasta várias vezes e depois responda.',
    config: { criticaPeriodica: false },
    criticaDoPlano: () => 'Isto não deveria nunca ser lido.',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o que foi listado' } },
    ],
    redacao: 'A pasta foi listada.',
    espera: { ok: true, criticaPlanoDisparada: false },
  },

  {
    nome: 'crítica periódica: resposta "ok" do revisor não vira observação nem evento',
    pedido: 'Liste a pasta várias vezes e depois responda.',
    config: { criticaPeriodica: true },
    criticaDoPlano: () => 'ok',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o que foi listado' } },
    ],
    redacao: 'A pasta foi listada.',
    espera: { ok: true, criticaPlanoDisparada: false },
  },

  {
    // pipelineForcadoUniversal desligado de propósito: com a cadência
    // "Complexo" (padrão desde 2026-09-14, intervalo 1) a crítica dispara em
    // TODA iteração, não só na 2ª — o que este teste quer provar
    // especificamente (a antecipação da 5ª pra 2ª rodada na cadência
    // "simples") ficaria mascarado por um comportamento mais agressivo que
    // não tem nada a ver com o que está sendo checado aqui.
    nome: 'crítica periódica: primeira crítica adianta pra logo após o primeiro passo, não espera a 5ª rodada',
    pedido: 'Liste a pasta várias vezes e depois responda.',
    config: { criticaPeriodica: true, pipelineForcadoUniversal: false },
    // nenhuma falha de ferramenta acontece aqui (listar_arquivos sempre funciona)
    // — só a checagem antecipada por iteração pode explicar disparar cedo.
    criticaDoPlano: () => 'Está se desviando do que foi pedido desde o início.',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 1
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 2 — crítica antecipada dispara aqui
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 3
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 4
      { ferramenta: 'responder', argumentos: { foco: 'o que foi listado' } }, // 5
    ],
    redacao: 'A pasta foi listada.',
    espera: { ok: true, criticaPlanoDisparada: true },
    posVerificar(obtido) {
      const primeira = obtido.criticasPlano[0];
      return [
        (primeira && primeira.n === 2) ||
          `esperava a primeira crítica na iteração 2, obteve ${JSON.stringify(obtido.criticasPlano.map((c) => c.n))}`,
      ];
    },
  },

  {
    // Caso real (DeepSeek R1 8B numa prova de 10 questões): pedido com
    // várias perguntas na mesma mensagem precisa do Copiloto acompanhando
    // "quase todo passo", não só de 5 em 5 — daí `criticaPeriodicaIntervalo/
    // MaxComplexo` (config.js) ficarem bem mais agressivos (1 / 20) que o
    // padrão simples (5 / 2). Este teste usa um pedido que
    // `classificarPedido` detecta como complexo (3+ perguntas com "?") e
    // confere que a crítica dispara em TODO passo, não só de longe em longe.
    nome: 'crítica periódica: pedido complexo (várias perguntas, tipo prova) usa o intervalo/teto "Complexo" — crítica a cada passo',
    pedido:
      'Qual é a capital da França? Qual é a capital da Alemanha? Qual é a capital da Itália? Depois liste a pasta e responda um resumo.',
    config: { criticaPeriodica: true },
    criticaDoPlano: () => 'Confira se todas as perguntas da prova foram cobertas antes de fechar.',
    roteiro: [
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 1
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 2
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 3
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, // 4
      { ferramenta: 'responder', argumentos: { foco: 'as capitais e o que foi listado' } }, // 5
    ],
    redacao: 'As capitais são Paris, Berlim e Roma; a pasta foi listada.',
    espera: { ok: true, criticaPlanoDisparada: true },
    posVerificar(obtido) {
      // Com intervalo=1 (Complexo), toda iteração satisfaz `iteracao %
      // intervaloCritica === 0` — bem diferente do caso simples (intervalo
      // 5, teto 2), que não chegaria nem perto de 4 críticas em só 4 passos.
      return [
        obtido.criticasPlano.length >= 4 ||
          `esperava crítica em praticamente todo passo (>= 4 vezes em 4 rodadas), obteve ${obtido.criticasPlano.length}`,
      ];
    },
  },
];

module.exports = [...casosAgendador, ...casosCriticaPeriodica];
