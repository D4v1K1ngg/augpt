'use strict';

/**
 * Especialistas (19/11, Davi: "usar outros modelos de IA que são mais capazes de certas tarefas — um sistema de
 * especialistas"; medido no mesmo dia, a prova de 10 questões: Qwen 3.5 9B 7/10, Qwen3.8 27B 10/10, +20 s). Em Ajustes,
 * cada tipo de pedido pode ter o seu modelo; vazio (o padrão) = o modelo do topo. O código reconhece o tipo de pedido e,
 * se o modelo escolhido não estiver instalado, segue com o do topo e avisa — quem não tem a placa nem o modelo não sente.
 */

const nucleo = require('./nucleo');

const TAREFAS = [
  {
    id: 'prova',
    nome: 'Provas e exercícios',
    descricao: 'Questões de prova, simulado e lista de exercícios coladas no chat (alternativas, afirmativas, contas).',
    reconhece: ({ objetivo }) => nucleo.questaoDeProva(objetivo),
  },
  {
    id: 'imagem',
    nome: 'Imagens anexadas',
    descricao: 'Pedidos com foto ou print anexado — escolha um modelo com visão.',
    reconhece: ({ imagens }) => imagens.length > 0,
  },
];

/**
 * O especialista deste pedido: { tarefa, nome, modelo } · { tarefa, nome, faltando } (escolhido, mas não instalado) · null.
 * `listar()` devolve os nomes dos modelos instalados no Ollama.
 */
async function escolherEspecialista({ objetivo = '', imagens = [], config = {}, listar = async () => [] }) {
  const escolhidos = config.especialistas || {};
  const t = TAREFAS.find((x) => String(escolhidos[x.id] || '').trim() && x.reconhece({ objetivo: String(objetivo), imagens }));
  if (!t) return null;
  const modelo = String(escolhidos[t.id]).trim();
  const instalados = await listar().catch(() => null);
  // sem a lista (Ollama remoto que não responde ao /api/tags): tenta o escolhido
  if (Array.isArray(instalados) && !instalados.some((n) => n === modelo || n === `${modelo}:latest` || `${n}:latest` === modelo)) return { tarefa: t.id, nome: t.nome, faltando: modelo };
  return { tarefa: t.id, nome: t.nome, modelo };
}

module.exports = { TAREFAS: TAREFAS.map(({ reconhece, ...resto }) => resto), escolherEspecialista };
