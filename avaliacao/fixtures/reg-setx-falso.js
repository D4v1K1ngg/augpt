#!/usr/bin/env node
'use strict';

// Fixture: finge ser `reg.exe` (query) e `setx.exe` do Windows, pros testes
// de src/ollama-runtime.js (lerMaxModelosCarregados/definirMaxModelosCarregados)
// poderem rodar em qualquer SO — mesmo espírito do fixture do Ollama
// (servidor-ollama-falso.js): um binário real do Windows não existe aqui,
// então o comando parametrizável (`comandoReg`/`comandoSetx`) aponta pra
// este arquivo em vez do `reg`/`setx` de verdade.
//
// `reg query HKCU\Environment /v OLLAMA_MAX_LOADED_MODELS` real: imprime o
// valor gravado (formato "NOME    REG_SZ    valor") e sai 0, ou sai != 0 com
// "ERROR: ..." no stderr quando a variável não existe. Reproduzido aqui via
// AUGPT_REGSETX_FIXTURE_VALOR (se definida, "existe"; se não, "não existe").
//
// `setx NOME VALOR` real: grava e sai 0 com "SUCCESS: ...". Reproduzido aqui
// sempre com sucesso, a menos que AUGPT_REGSETX_FIXTURE_FALHAR esteja
// definida (simula setx falhando, ex.: sem permissão).

const args = process.argv.slice(2);

if (process.env.AUGPT_REGSETX_FIXTURE_FALHAR) {
  process.stderr.write('ERRO: falha simulada pelo fixture\n');
  process.exit(1);
}

if (args[0] === 'query') {
  const valor = process.env.AUGPT_REGSETX_FIXTURE_VALOR;
  if (!valor) {
    process.stderr.write('ERROR: The system was unable to find the specified registry key or value.\n');
    process.exit(1);
  }
  process.stdout.write(`\nHKEY_CURRENT_USER\\Environment\n    OLLAMA_MAX_LOADED_MODELS    REG_SZ    ${valor}\n\n`);
  process.exit(0);
} else {
  // setx NOME VALOR — não interessa validar os argumentos aqui, só simular
  // o sucesso que definirMaxModelosCarregados espera.
  process.stdout.write('\n\nSUCCESS: Specified value was saved.\n');
  process.exit(0);
}
