#!/usr/bin/env node
'use strict';

// Fixture: finge ser o binário `ollama` real, sem precisar dele instalado.
// Usado no lugar do comando passado a src/ollama-runtime.js (localizarBinario/
// iniciar aceitam um `comando` parametrizável só pra isto) — mesmo espírito
// do fixture do SearXNG (avaliacao/fixtures/servidor-searxng-falso.js).
//
// `ollama --version` real imprime algo como "ollama version is 0.x.x" e sai
// com código 0 — reproduzido aqui. `ollama serve` real sobe um servidor HTTP
// que nunca termina sozinho — reproduzido abrindo `/api/version` na porta
// dada por AUGPT_OLLAMA_FIXTURE_PORTA (padrão 11434, igual ao Ollama real).
//
// AUGPT_OLLAMA_FIXTURE_ATRASO_MS atrasa a porta abrir — usado pelo teste que
// confere se `esperarSaude` espera de verdade, e não só verifica uma vez.
// AUGPT_OLLAMA_FIXTURE_FALHAR faz `--version` sair com erro, simulando
// "comando existe mas está quebrado" (ainda assim seria localizado; usado
// só para exercitar o caminho de encontrado:false com um comando qualquer,
// não este cenário específico).

const http = require('http');

const args = process.argv.slice(2);

if (args[0] === '--version') {
  process.stdout.write('ollama version is 0.0.0-fixture\n');
  process.exit(0);
}

if (args[0] === 'serve') {
  const porta = Number(process.env.AUGPT_OLLAMA_FIXTURE_PORTA || 11434);
  const atrasoMs = Number(process.env.AUGPT_OLLAMA_FIXTURE_ATRASO_MS || 0);
  setTimeout(() => {
    const servidor = http.createServer((req, res) => {
      if (req.url === '/api/version') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ version: '0.0.0-fixture' }));
      }
      res.writeHead(404);
      res.end();
    });
    servidor.listen(porta, '127.0.0.1');
  }, atrasoMs);
  // não sai — como o `ollama serve` real, que fica rodando até ser morto
} else {
  process.exit(1); // comando desconhecido
}
