'use strict';

/**
 * Ações de cada resposta e sugestões de próxima pergunta (16/11, fases 3 e 4 do visual novo).
 */

const fs = require('fs');
const path = require('path');
const { pedidoDeSugestoes, lerSugestoes } = require('../../src/sugestoes');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'sugestões de continuação: até 3, curtas, sem repetir a pergunta nem entre si, com "?" no fim; JSON ilegível = nenhuma',
    tipo: 'unidade',
    executar() {
      const r = lerSugestoes('{"sugestoes": ["E o Truthear Nova, vale a pena", "Qual o melhor fone?", "e o truthear nova vale a pena?", "ok", "Como regular o equalizador?", "Onde comprar mais barato?"]}', 'Qual o melhor fone?');
      return [
        JSON.stringify(r) === JSON.stringify(['E o Truthear Nova, vale a pena?', 'Como regular o equalizador?', 'Onde comprar mais barato?']) || JSON.stringify(r),
        lerSugestoes('sem json', 'x').length === 0 || 'ilegível',
        /em português do Brasil/.test(pedidoDeSugestoes('a', 'b')) && /in English/.test(pedidoDeSugestoes('a', 'b', 'en')) || 'idioma da tela',
        !/!\[|```/.test(pedidoDeSugestoes('p', 'texto ![foto](augpt-img://x.jpg) ```js\ncodigo\n``` fim')) || 'imagem e código saem do resumo',
      ];
    },
  },
  {
    nome: 'ações da resposta: copiar e refazer (só na última do Agente), o 🔊 e o modelo na mesma linha; sugestões no fim da resposta e o interruptor em Ajustes',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const eventos = ler('renderer/app-eventos.js');
      return [
        /<script src="estudio\.js"><\/script>\n<script src="acoes-da-resposta\.js"><\/script>/.test(html) || 'o script depois do estudio.js',
        /acoesDaResposta\?\.\(t\.resposta, resumo, \{ ultima: true \}\);\n\s*window\.botaoDeAudio/.test(eventos) || 'as ações antes do 🔊 (que entra na linha)',
        /sugestoesDeContinuacao\?\.\(t\.resposta, anexosDoPedido\(pergunta\)\.texto, resumo\)/.test(eventos) || 'as sugestões no fim da resposta',
        /\.resposta-acoes'\) \|\| corpo\)\.appendChild\(caixa\)/.test(ler('renderer/estudio.js')) || 'o 🔊 na linha de ações',
        /\.resposta-acoes'\) \|\| caixa\)\.appendChild\(linha\)/.test(ler('renderer/app-historico.js')) || 'o modelo na linha de ações',
        /id="cfgSugestoes"/.test(html) && /sugestoesDeContinuacao: \$\('cfgSugestoes'\)\.checked/.test(ler('renderer/app-ajustes.js')) || 'o interruptor em Ajustes',
        /ipcMain\.handle\('sugestoes:gerar'/.test(ler('electron/main.js')) && /config\.data\.sugestoesDeContinuacao === false/.test(ler('electron/main.js')) || 'o processo principal respeita o interruptor',
      ];
    },
  },
];
