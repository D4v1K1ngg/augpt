#!/usr/bin/env node
'use strict';

// Fixture: finge ser o processo `python -m searx.webapp` real, sem precisar
// de Python nem do SearXNG de verdade instalados. Lê a porta do settings.yml
// apontado por SEARXNG_SETTINGS_PATH — a mesma variável de ambiente que o
// RuntimeSearXNG real (src/searxng-runtime.js) usa pra falar com o processo
// de verdade — e sobe um servidor HTTP respondendo em `/` (checagem de
// saúde) e `/search?format=json` (busca), no formato que o SearXNG real usa.
//
// Invocado como executável direto (via shebang + bit de execução), do mesmo
// jeito que o RuntimeSearXNG spawna `pythonExecutavel` com os argumentos
// `['-m', 'searx.webapp']` — este fixture ignora esses argumentos.

const fs = require('fs');
const http = require('http');
const { URL } = require('url');

const caminhoSettings = process.env.SEARXNG_SETTINGS_PATH;
let porta = 8888;
try {
  const texto = fs.readFileSync(caminhoSettings, 'utf8');
  const m = texto.match(/port:\s*(\d+)/);
  if (m) porta = Number(m[1]);
} catch {
  /* usa a porta padrão */
}

// Usado pelo teste de detecção de crash: o processo sai com erro antes de
// abrir a porta, simulando uma instalação quebrada.
if (process.env.AUGPT_SIMULAR_CRASH) {
  process.stderr.write('crash simulado de propósito (teste)\n');
  process.exit(1);
}

const servidor = http.createServer((req, res) => {
  const alvo = new URL(req.url, `http://127.0.0.1:${porta}`);
  if (alvo.pathname === '/search' && alvo.searchParams.get('format') === 'json') {
    const q = alvo.searchParams.get('q') || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        query: q,
        results: [{ title: `resultado falso para ${q}`, url: 'https://exemplo.com', content: 'conteúdo de teste' }],
      })
    );
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>SearXNG falso (fixture de teste)</body></html>');
});

servidor.listen(porta, '127.0.0.1');
