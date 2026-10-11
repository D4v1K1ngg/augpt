'use strict';

/**
 * Comando externo como string ("ollama", "reg", o caminho do python) — o
 * normal — ou como lista [executável, ...argumentos fixos].
 *
 * Por que a lista existe (2026-09-24): a bancada troca os binários reais
 * (ollama, reg, setx, tasklist, taskkill, o python do SearXNG) por scripts
 * .js falsos em avaliacao/fixtures/. No Linux e no macOS o script roda
 * direto, pela linha "#!/usr/bin/env node"; no Windows não existe isso, e o
 * spawn falha com EFTYPE — 10 casos da bancada falhavam no PC do Davi por
 * esse motivo, sem nada de errado no código testado. No Windows os testes
 * passam [process.execPath, 'fixture.js'] (o node rodando o script), e é
 * esta função que junta os argumentos fixos com os da chamada.
 *
 * Em uso normal o app sempre passa string, e nada muda.
 */
function montarComando(comando, argumentos = []) {
  if (Array.isArray(comando)) return [comando[0], [...comando.slice(1), ...argumentos]];
  return [comando, argumentos];
}

module.exports = { montarComando };
