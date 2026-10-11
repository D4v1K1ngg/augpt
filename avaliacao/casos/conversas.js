'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Conversas } = require('../../src/conversas');

/**
 * Peça "resumo de conversa" (pedido do Davi 2026-09-21): `atualizarResumo()`
 * é o método novo em `src/conversas.js` que o processo principal chama (ver
 * electron/main.js, evento 'resumo-conversa') para persistir o resumo
 * fundido calculado por `Agent.run()` — sem passar por `salvar()`, que exige
 * `mensagens` e apagaria o histórico da conversa se chamado só com o resumo
 * (default `mensagens = []`, sem herdar do registro anterior).
 */
function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-conversas-resumo-'));
}

module.exports = [
  {
    nome: 'Conversas.atualizarResumo(): grava resumo e contagem de turnos SEM tocar em mensagens/título/id',
    tipo: 'unidade',
    async executar() {
      const conversas = new Conversas(pastaTemporaria());
      const gravada = conversas.salvar({
        modo: 'agente',
        mensagens: [
          { role: 'user', content: 'Primeira pergunta' },
          { role: 'assistant', content: 'Primeira resposta' },
        ],
      });

      const atualizada = conversas.atualizarResumo(gravada.id, 'RESUMO_FUNDIDO: usuário perguntou sobre X', 3);
      const relida = conversas.ler(gravada.id);

      return [
        (atualizada && atualizada.resumoConversa === 'RESUMO_FUNDIDO: usuário perguntou sobre X') ||
          `esperava resumoConversa gravado, obteve ${JSON.stringify(atualizada?.resumoConversa)}`,
        (atualizada && atualizada.resumoConversaTurnos === 3) ||
          `esperava resumoConversaTurnos 3, obteve ${JSON.stringify(atualizada?.resumoConversaTurnos)}`,
        (relida && relida.mensagens.length === 2) ||
          `atualizarResumo não pode apagar mensagens — obteve ${JSON.stringify(relida?.mensagens)}`,
        (relida && relida.id === gravada.id && relida.titulo === gravada.titulo) ||
          'id/título têm que sobreviver intactos à atualização de resumo',
      ];
    },
  },

  {
    nome: 'Conversas.atualizarResumo(): id inexistente não cria arquivo nem lança erro (no-op)',
    tipo: 'unidade',
    async executar() {
      const conversas = new Conversas(pastaTemporaria());
      const resultado = conversas.atualizarResumo('conversa-que-nunca-existiu', 'RESUMO', 5);
      return [
        resultado === null || `esperava null para id inexistente, obteve ${JSON.stringify(resultado)}`,
        conversas.listar().length === 0 || 'não deveria ter criado nenhum arquivo de conversa',
      ];
    },
  },

  /**
   * Análise comparativa 2026-09-21, item 1 ("persistir Tarefa por
   * conversa"): `atualizarTarefa()` é o método novo que electron/main.js
   * chama a cada evento 'tarefa-atualizada' (ver criarAgente()) pra gravar
   * o checklist/estado atual no JSON da conversa — mesmo princípio de
   * atualizarResumo() acima, mesmo motivo de não passar por salvar().
   */
  {
    nome: 'Conversas.atualizarTarefa(): grava o estado da Tarefa SEM tocar em mensagens/título/id, e aceita null pra limpar',
    tipo: 'unidade',
    async executar() {
      const conversas = new Conversas(pastaTemporaria());
      const gravada = conversas.salvar({
        modo: 'agente',
        mensagens: [{ role: 'user', content: 'Investigue 5 páginas sobre X' }],
      });

      const tarefaFalsa = { estado: 'executando', subtarefas: [{ texto: 'Ler página 2', status: 'pendente' }] };
      const atualizada = conversas.atualizarTarefa(gravada.id, tarefaFalsa);
      const relida = conversas.ler(gravada.id);
      const limpa = conversas.atualizarTarefa(gravada.id, null);

      return [
        (atualizada && atualizada.tarefa?.estado === 'executando') ||
          `esperava tarefa.estado gravado, obteve ${JSON.stringify(atualizada?.tarefa)}`,
        (relida && relida.mensagens.length === 1) ||
          `atualizarTarefa não pode apagar mensagens — obteve ${JSON.stringify(relida?.mensagens)}`,
        (relida && relida.id === gravada.id && relida.titulo === gravada.titulo) ||
          'id/título têm que sobreviver intactos à atualização de tarefa',
        (limpa && limpa.tarefa === null) || 'passar null precisa limpar a tarefa gravada (execução concluída/nova conversa)',
      ];
    },
  },

  {
    nome: 'Conversas.atualizarTarefa(): id inexistente não cria arquivo nem lança erro (no-op)',
    tipo: 'unidade',
    async executar() {
      const conversas = new Conversas(pastaTemporaria());
      const resultado = conversas.atualizarTarefa('conversa-que-nunca-existiu', { estado: 'executando' });
      return [
        resultado === null || `esperava null para id inexistente, obteve ${JSON.stringify(resultado)}`,
        conversas.listar().length === 0 || 'não deveria ter criado nenhum arquivo de conversa',
      ];
    },
  },
];
