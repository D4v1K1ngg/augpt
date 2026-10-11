#!/usr/bin/env node
'use strict';

// Fixture: finge ser `tasklist.exe` (consulta) e `taskkill.exe` (mata) do
// Windows, pros testes de src/ollama-runtime.js (listarProcessosOllama/
// matarTodosProcessosOllama/reiniciarOllama) poderem rodar em qualquer SO —
// mesmo espírito de reg-setx-falso.js.
//
// `tasklist /FI "IMAGENAME eq ollama.exe" /FO CSV /NH` real: imprime uma
// linha CSV por processo encontrado (colunas: nome da imagem, PID, sessão,
// nº da sessão, uso de memória), ou sai 0 com uma mensagem "INFO: No
// tasks..." quando não acha nada. Reproduzido aqui via
// AUGPT_TASKLIST_FIXTURE_PIDS (lista de PIDs separados por vírgula; vazia/
// ausente = nenhum processo rodando).
//
// `taskkill /IM ollama.exe /F /T` real: sempre sai com sucesso simulado
// aqui — o caso "comando não existe" (spawn falhando de verdade) é testado
// apontando `comandoTaskkill` pra um caminho inexistente, sem precisar de
// um fixture pra isso.

const args = process.argv.slice(2);

if (args[0] === '/FI') {
  const pidsEnv = process.env.AUGPT_TASKLIST_FIXTURE_PIDS;
  if (!pidsEnv) {
    process.stdout.write('INFO: No tasks are running which match the specified criteria.\n');
    process.exit(0);
  }
  const linhas = pidsEnv
    .split(',')
    .map((pid) => `"ollama.exe","${pid.trim()}","Console","1","12.345 K"`)
    .join('\r\n');
  process.stdout.write(`${linhas}\r\n`);
  process.exit(0);
} else {
  // taskkill /IM ollama.exe /F /T
  process.stdout.write('SUCCESS: The process "ollama.exe" with PID 1234 has been terminated.\n');
  process.exit(0);
}
