'use strict';

/**
 * O estilo dos bons assistentes de chat (9/11, "no chat do Ollama eles respondem mais, usam emojis, parecido com o
 * ChatGPT"): seções curtas com título (pode ter emoji), tópicos, negrito, 2 a 5 emojis, tom próximo — na explicação de
 * memória e na resposta com fontes. Produto mantém os cartões "#### N." (com o estilo, viravam "### 🎧 1."). As
 * capacidades do AuGPT só aparecem para o problema do próprio usuário ("como funciona o Wi-Fi?" ofereceu o AuGPT 3 vezes).
 * Medido: 15 perguntas, nota 9,56 → 9,61; propaganda no Wi-Fi 3 → 0.
 */
const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'estilo de chat: seções/emojis/negrito na explicação e nas fontes, não no produto (cartões "#### N."); sem capacidades na explicação; capacidades só para o problema do usuário',
    tipo: 'unidade',
    executar() {
      const exp = nucleo.sistemaDoEscritor({ hoje: 'x', comFontes: false, explicacao: true });
      const fontes = nucleo.sistemaDoEscritor({ hoje: 'x', comFontes: true });
      const produto = nucleo.sistemaDoEscritor({ hoje: 'x', comFontes: true, produto: true });
      const indice = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      const cap = fs.readFileSync(path.join(__dirname, '../../src/agent/capacidades.js'), 'utf8');
      const estilo = /Emojis com moderação: de 2 a 5/;
      return [
        estilo.test(exp) && /Não fale do AuGPT/.test(exp) || 'explicação com o estilo',
        estilo.test(fontes) || 'fontes com o estilo',
        !estilo.test(produto) && /"#### 1\. Marca Modelo"/.test(produto) || 'produto só com os cartões',
        /capacidadesNaEscrita: ent\.conversa \|\| ent\.explicacao \? ''/.test(indice) || 'sem capacidades na explicação',
        /Só mencione uma destas capacidades se a pergunta for sobre um problema ou a situação do próprio usuário/.test(cap) || 'capacidades só para o problema do usuário',
      ];
    },
  },
];
