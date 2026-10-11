'use strict';

/**
 * MODELO DE FERRAMENTA EXTERNA
 *
 * Copie este arquivo, renomeie e edite. Arquivos começando com _ são ignorados
 * pelo carregador, então este modelo não vira uma ferramenta de verdade.
 *
 * Depois de salvar: aba Skills > Ferramentas > Recarregar. Não precisa reiniciar.
 *
 * O que chega em ctx:
 *   ctx.sandbox   jail da pasta de trabalho — use ctx.sandbox.resolve(rel)
 *   ctx.config    configuração atual (host do Ollama, timeouts, etc.)
 *   ctx.memory    memória de longo prazo — await ctx.memory.add(texto)
 *   ctx.emit      emite evento para a interface: ctx.emit('fonte', {...})
 *   ctx.ask       pergunta ao usuário e espera: await ctx.ask('qual pasta?')
 *   ctx.render    renderiza uma página com JS: await ctx.render(url)
 *   ctx.objetivo  o pedido original do usuário
 *   ctx.estado    rascunho compartilhado durante a execução
 *
 * Devolva SEMPRE uma string — é o que o modelo vai ler.
 * Para sinalizar erro, lance: throw new Error('mensagem clara').
 */

module.exports = {
  name: 'exemplo_ferramenta', // minúsculas, números e _ ; 3 a 40 caracteres
  risk: 'baixo', // baixo = não pede aprovação | medio | alto
  description: 'Descreva em uma linha o que faz. Isto entra no catálogo do prompt.',
  args: {
    texto: 'descrição do parâmetro, vista pelo modelo',
  },

  async run({ texto }, ctx) {
    if (!texto) throw new Error('Informe "texto".');
    return `Recebi: ${texto} (pasta de trabalho: ${ctx.sandbox.root})`;
  },
};
