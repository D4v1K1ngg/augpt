'use strict';

/**
 * Contrato de conclusão (2026-09-27). Origem: 10º teste real ("histórico de
 * preços da RTX 5070 Ti e da RTX 5080 ... construir um gráfico") e a
 * "autópsia" que o Davi pediu ao ChatGPT. O plano tinha "Criar um gráfico",
 * o gate barrou responder 3 vezes sem dizer QUAL ferramenta cumpria o item,
 * o agente só pesquisou de novo, e a válvula de escape entregou sem gráfico
 * e sem dizer que faltava.
 *
 * Aqui: item que só uma ferramenta cumpre (gráfico, planilha, PDF) vira
 * conferível — o gate diz qual ferramenta chamar (inclusive com o teto de
 * buscas atingido), a ferramenta rodando marca o item como feito, e o que
 * ficou sem ela aparece na resposta como "O que ficou faltando".
 */

const { executarCasoAgente } = require('../motor');

const PLANO = '- Pesquisar os preços da placa X\n- Criar um gráfico com a evolução dos preços';
const PEDIDO = 'Pesquise o preço da placa X nos últimos meses e construa um gráfico da evolução.';
const CONFIG = { pipelineForcadoUniversal: true, criticaPeriodica: false };

module.exports = [
  {
    nome: 'contrato: item "criar gráfico" — o gate diz para chamar gerar_grafico; depois do gráfico, responder passa e o gráfico está na resposta',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'contrato gráfico',
        pedido: PEDIDO,
        config: CONFIG,
        planejamentoInicial: PLANO,
        roteiro: [
          { ferramenta: 'responder', argumentos: { foco: 'preços' }, plano: ['Criar um gráfico com a evolução dos preços'] },
          {
            ferramenta: 'gerar_grafico',
            argumentos: { tipo: 'line', titulo: 'Placa X', rotulos: ['jan', 'fev', 'mar'], valores: [5000, 4800, 4700] },
            plano: ['Criar um gráfico com a evolução dos preços'],
          },
          { ferramenta: 'responder', argumentos: { foco: 'preços' }, plano: ['Criar um gráfico com a evolução dos preços'] },
        ],
        // o redator "esquece" de copiar o bloco do gráfico
        redacao: 'O preço da placa X caiu de janeiro a março.',
      });
      const gates = obtido.copiloto.map((c) => c.gate);
      return [
        /chame gerar_grafico com os números que você já coletou/.test(obtido.promptDecisao) ||
          'o aviso do gate deveria dizer qual ferramenta cumpre o item',
        gates.filter((g) => g === 'checklist-pendente').length === 1 || `depois do gráfico o gate não deveria barrar de novo: ${gates}`,
        /```chart/.test(obtido.resposta) || `o gráfico montado deveria entrar na resposta mesmo sem o redator copiar: ${obtido.resposta}`,
        !/O que ficou faltando/.test(obtido.resposta) || 'item cumprido não pode aparecer como faltando',
      ];
    },
  },

  {
    nome: 'contrato: sem gerar o gráfico, a válvula de escape libera — e a resposta diz o que ficou faltando',
    tipo: 'unidade',
    async executar() {
      const insistir = { ferramenta: 'responder', argumentos: { foco: 'preços' }, plano: ['Criar um gráfico com a evolução dos preços'] };
      const obtido = await executarCasoAgente({
        nome: 'contrato sem gráfico',
        pedido: PEDIDO,
        config: CONFIG,
        planejamentoInicial: PLANO,
        roteiro: [insistir, insistir, insistir, insistir],
        redacao: 'O preço da placa X caiu de janeiro a março.',
      });
      return [
        obtido.ok || 'deveria entregar mesmo incompleto (válvula de escape)',
        /\*\*O que ficou faltando do pedido:\*\*\n- Criar um gráfico com a evolução dos preços/.test(obtido.resposta) ||
          `a resposta deveria listar o item não cumprido: ${obtido.resposta}`,
      ];
    },
  },

  {
    nome: 'contrato: com o teto de buscas atingido, item de gráfico ainda barra (não precisa de busca), item de pesquisa não',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'contrato teto',
        pedido: PEDIDO,
        config: { ...CONFIG, maxBuscas: 1 },
        planejamentoInicial: PLANO,
        arquivos: {},
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'preço placa x' }, plano: ['Pesquisar os preços da placa X', 'Criar um gráfico com a evolução dos preços'] },
          { ferramenta: 'responder', argumentos: { foco: 'preços' }, plano: ['Pesquisar os preços da placa X', 'Criar um gráfico com a evolução dos preços'] },
          { ferramenta: 'responder', argumentos: { foco: 'preços' }, plano: ['Pesquisar os preços da placa X', 'Criar um gráfico com a evolução dos preços'] },
        ],
        redacao: 'O preço da placa X caiu.',
      });
      const vetoInstrucao = (obtido.promptDecisao.match(/Seu plano ainda tem itens pendentes: .*?Resolva-os/g) || []).pop() || '';
      return [
        obtido.copiloto.some((c) => c.gate === 'checklist-pendente') || 'item de gráfico deveria barrar mesmo com o teto de buscas',
        /Criar um gráfico/.test(vetoInstrucao) && !/Pesquisar os preços/.test(vetoInstrucao) ||
          `no teto, só o item de ferramenta bloqueia: ${vetoInstrucao}`,
      ];
    },
  },
];
