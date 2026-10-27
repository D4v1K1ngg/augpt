'use strict';

/**
 * Modelo que exige a instrução de sistema no começo (27/10, teste do Bonsai-27B: as tarefas falhavam na hora
 * com "System message must be at the beginning", e o AuGPT dizia "este modelo não conversa").
 */

const fs = require('fs');
const path = require('path');
const ollama = require('../../src/llm/ollama');
const { mensagemAmigavel } = require('../../src/primeiro-uso');

module.exports = [
  {
    nome: 'sistema no início: as mensagens de sistema do meio viram mensagens comuns marcadas (a 1ª fica); só depois da recusa do modelo, e lembrando o modelo; a mensagem de erro não diz mais "não conversa"',
    tipo: 'unidade',
    executar() {
      const fonte = fs.readFileSync(path.join(__dirname, '../../src/llm/ollama.js'), 'utf8');
      const r = ollama.sistemaNoInicio([{ role: 'system', content: 'A' }, { role: 'user', content: 'oi' }, { role: 'system', content: 'B' }, { role: 'assistant', content: 'ok' }]);
      const msg = mensagemAmigavel('Ollama 500: {"error":"Jinja Exception: System message must be at the beginning."}');
      return [
        JSON.stringify(r.map((m) => m.role)) === '["system","user","user","assistant"]' || JSON.stringify(r),
        r[2].content === '[Instrução do sistema] B' || r[2].content,
        /if \(!ERRO_SISTEMA_NO_INICIO\.test\(String\(err\?\.message \|\| ''\)\) \|\| exigeSistemaNoInicio\.has\(chave\)\) throw err;/.test(fonte) || 'tenta de novo uma vez e lembra',
        (fonte.match(/comSistemaNoInicio\(/g) || []).length >= 3 || 'chat e chatStream',
        (!/não conversa/.test(msg) && /qwen3\.5/.test(msg)) || msg,
      ];
    },
  },
];
