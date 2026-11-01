'use strict';

/**
 * A voz natural (Qwen3-TTS) saiu em 1/11 (no uso real ficou lenta): quem tinha escolhido uma delas ("qwen:eric")
 * volta para a voz padrão do Kokoro, e uma voz desconhecida nunca chega ao Kokoro.
 */

const fs = require('fs');
const path = require('path');

module.exports = [
  {
    nome: 'voz do AuGPT: só o Kokoro; a voz salva que não existe mais ("qwen:eric") volta para a padrão (pm_alex) ao abrir e nunca chega ao motor',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8').replace(/\r/g, '');
      const { VOZES } = require('../../src/fala/voz');
      return [
        !VOZES['qwen:eric'] && Boolean(VOZES.pm_alex) || 'as vozes do Kokoro',
        /if \(!require\('\.\.\/src\/fala\/voz'\)\.VOZES\[config\.data\.vozNome \|\| 'pm_alex'\]\) config\.save\(\{ vozNome: 'pm_alex' \}\)/.test(main) || 'a voz salva volta para a padrão',
        /voz: VOZES\[config\.data\.vozNome\] \? config\.data\.vozNome : 'pm_alex'/.test(main) || 'voz desconhecida não chega ao motor',
        !fs.existsSync(path.join(__dirname, '../../src/fala/voz-qwen.js')) && !/vozNatural/.test(main) || 'a voz natural saiu',
      ];
    },
  },
];
