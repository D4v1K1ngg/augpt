#!/usr/bin/env node
'use strict';

/**
 * Agenda a medição de qualidade para rodar sozinha, toda madrugada.
 *
 *   npm run qualidade:agendar                 cria a tarefa (03:00, todo dia)
 *   npm run qualidade:agendar -- --hora=02:30
 *   npm run qualidade:agendar -- --remover    apaga a tarefa
 *
 * No Windows usa o Agendador de Tarefas (schtasks), na conta de quem rodou o
 * comando. A rodada escreve em avaliacao/qualidade/ultima-rodada.log e grava
 * o resultado em avaliacao/qualidade/resultados/, comparado com a anterior.
 * Precisa do computador ligado e do Ollama aberto na hora marcada.
 *
 * Em Linux e macOS o comando só mostra a linha para pôr no crontab.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const NOME = 'AuGPT - medicao de qualidade';
const raiz = path.join(__dirname, '..');
const hora = /^\d{2}:\d{2}$/.test(String(args.hora)) ? args.hora : '03:00';
const registro = path.join('avaliacao', 'qualidade', 'ultima-rodada.log');

if (process.platform !== 'win32') {
  const [h, m] = hora.split(':');
  console.log('Acrescente esta linha ao crontab (crontab -e):\n');
  console.log(`${Number(m)} ${Number(h)} * * * cd "${raiz}" && npm run qualidade:app > ${registro} 2>&1`);
  process.exit(0);
}

const schtasks = (...a) => spawnSync('schtasks', a, { encoding: 'utf8' });

if (args.remover) {
  const r = schtasks('/Delete', '/TN', NOME, '/F');
  console.log(r.status === 0 ? 'Tarefa removida.' : `Não removi: ${(r.stderr || r.stdout).trim()}`);
  process.exit(r.status === 0 ? 0 : 1);
}

const comando = `cmd /c cd /d "${raiz}" && npm run qualidade:app > "${registro}" 2>&1`;
const r = schtasks('/Create', '/TN', NOME, '/SC', 'DAILY', '/ST', hora, '/TR', comando, '/F');
if (r.status !== 0) {
  console.log(`Não consegui criar a tarefa: ${(r.stderr || r.stdout).trim()}`);
  process.exit(1);
}
console.log(`Tarefa "${NOME}" criada: todo dia às ${hora}.`);
console.log(`Resultado em avaliacao/qualidade/resultados/ e saída em ${registro}.`);
console.log('Para apagar: npm run qualidade:agendar -- --remover');
