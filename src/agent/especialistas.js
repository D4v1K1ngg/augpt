'use strict';

/**
 * Especialistas (19/11, Davi: "usar outros modelos de IA que são mais capazes de certas tarefas — um sistema de
 * especialistas"; medido no mesmo dia, a prova de 10 questões: Qwen 3.5 9B 7/10, Qwen3.8 27B 10/10, +20 s). Em Ajustes,
 * cada tipo de pedido pode ter o seu modelo; vazio (o padrão) = o modelo do topo. O código reconhece o tipo de pedido e,
 * se o modelo escolhido não estiver instalado, segue com o do topo e avisa — quem não tem a placa nem o modelo não sente.
 */

const nucleo = require('./nucleo');
const peca3d = require('./nucleo/peca-3d');

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
  {
    // 27/11: 15 pedidos reais, olhando cada peça — Qwen 3.5 9B 2–3 certas, gpt-oss 20B ~7, Gemma 4 26B ~9 (src/agent/nucleo/peca-3d.js).
    // O Gemma entra sozinho quando está instalado ('padrao'); sem ele, o modelo do topo, sem aviso.
    id: 'peca3d',
    nome: 'Peças para impressão 3D',
    descricao: 'Criar e ajustar peças em OpenSCAD (STL/3MF) — escolha um modelo com visão, que confere a peça pela foto.',
    padrao: 'gemma4:26b-a4b-it-qat',
    reconhece: ({ objetivo, imagens, conversa }) => !imagens.length && (peca3d.pedePeca3d(objetivo) || Boolean(peca3d.ajusteDaPeca(objetivo, conversa))),
  },
];

/**
 * O especialista deste pedido: { tarefa, nome, modelo } · { tarefa, nome, faltando } (escolhido, mas não instalado) · null.
 * `listar()` devolve os nomes dos modelos instalados no Ollama.
 */
async function escolherEspecialista({ objetivo = '', imagens = [], conversa = [], config = {}, listar = async () => [] }) {
  const escolhidos = config.especialistas || {};
  const t = TAREFAS.find((x) => String(escolhidos[x.id] || x.padrao || '').trim() && x.reconhece({ objetivo: String(objetivo), imagens, conversa }));
  if (!t) return null;
  const modelo = String(escolhidos[t.id] || t.padrao).trim();
  const instalados = await listar().catch(() => null);
  // o padrão da tarefa (não escolhido pelo usuário) que não está instalado: segue com o do topo, sem aviso
  if (!String(escolhidos[t.id] || '').trim() && (!Array.isArray(instalados) || !instalados.some((n) => n === modelo || n === `${modelo}:latest`))) return null;
  // sem a lista (Ollama remoto que não responde ao /api/tags): tenta o escolhido
  if (Array.isArray(instalados) && !instalados.some((n) => n === modelo || n === `${modelo}:latest` || `${n}:latest` === modelo)) return { tarefa: t.id, nome: t.nome, faltando: modelo };
  return { tarefa: t.id, nome: t.nome, modelo };
}

module.exports = { TAREFAS: TAREFAS.map(({ reconhece, ...resto }) => resto), escolherEspecialista };
