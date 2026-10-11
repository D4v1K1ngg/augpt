'use strict';

const { spawn } = require('child_process');

/**
 * Comandos que nunca são executados, mesmo no modo automático.
 * Esta lista é a última barreira — a aprovação manual é a primeira.
 */
const BLOQUEADOS = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+\/(?!\w)/i, // rm -rf /
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+.*of=\/dev\//i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\b(useradd|userdel|passwd|chpasswd)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, // fork bomb
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sqf]\s+[a-z]:\\/i,
  /\breg\s+delete\b/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^|]*\|\s*(ba)?sh\b/i,
];

/**
 * O comando (e o código) que o modelo roda não herda credenciais do ambiente
 * — GITHUB_TOKEN, OPENAI_API_KEY, AWS_SECRET_ACCESS_KEY e afins. Sem isto, uma
 * página com injeção de prompt podia pedir um `echo %GITHUB_TOKEN%` e levar o
 * valor pra resposta. PATH e o resto do ambiente continuam.
 */
const NOME_DE_SEGREDO = /(TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIALS?)(_|$)/i;

function ambienteSemSegredos(ambiente = process.env) {
  return Object.fromEntries(Object.entries(ambiente).filter(([nome]) => !NOME_DE_SEGREDO.test(nome)));
}

function executar(comando, { cwd, timeout, env }) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/bash';
    const args = isWin ? ['/d', '/s', '/c', comando] : ['-lc', comando];

    const child = spawn(shell, args, {
      cwd,
      env: { ...ambienteSemSegredos(), ...env },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let matou = false;

    const timer = setTimeout(() => {
      matou = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 40000) stdout = `${stdout.slice(0, 40000)}\n[saída truncada]`;
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = `${stderr.slice(0, 20000)}\n[saída truncada]`;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, matou });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, matou });
    });
  });
}

function formatar({ code, stdout, stderr, matou }, timeout) {
  const partes = [];
  if (matou) partes.push(`[interrompido: ultrapassou ${timeout / 1000}s]`);
  partes.push(`código de saída: ${code}`);
  if (stdout.trim()) partes.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) partes.push(`stderr:\n${stderr.trim()}`);
  if (!stdout.trim() && !stderr.trim()) partes.push('(sem saída)');
  return partes.join('\n');
}

module.exports = [
  {
    name: 'executar_comando',
    risk: 'alto',
    description: 'Executa um comando de terminal a partir da pasta de trabalho.',
    args: { comando: 'linha de comando completa' },
    async run({ comando }, ctx) {
      if (!comando) throw new Error('Informe "comando".');
      const bloqueio = BLOQUEADOS.find((re) => re.test(comando));
      if (bloqueio) {
        throw new Error('Comando bloqueado pela política de segurança do AuGPT.');
      }
      const timeout = ctx.config.shellTimeoutMs;
      const resultado = await executar(comando, { cwd: ctx.sandbox.root, timeout });
      ctx.emit('workspace-changed');
      return formatar(resultado, timeout);
    },
  },
];

module.exports.executar = executar;
module.exports.formatar = formatar;
module.exports.ambienteSemSegredos = ambienteSemSegredos;
module.exports.BLOQUEADOS = BLOQUEADOS;
