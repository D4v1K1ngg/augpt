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

/*
 * A saída dos comandos no Windows (25/10): sem console aberto, o cmd e muitos programas escrevem na
 * tabela antiga do Windows — CP850 no Windows em português ("n�o � reconhecido") — e o UTF-8 virava
 * lixo, para o agente e para a conferência. UTF-8 válido fica como está; senão, CP850 ou Windows-1252,
 * o que der mais letras de verdade.
 */
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
const deCp850 = (buf) => Array.from(buf, (b) => (b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80])).join('');
// acento minúsculo colado em letra minúscula ("não", "operável") conta a favor; maiúscula acentuada
// colada em minúscula ("nÒo", "nÆo"), desenho de caixa e "\ufffd" contam contra
const notaDoTexto = (t) =>
  (t.match(/[a-z][\u00e0-\u00f6\u00f8-\u00ff]|[\u00e0-\u00f6\u00f8-\u00ff][a-z]/g) || []).length -
  2 * (t.match(/[a-z][\u00c0-\u00d6\u00d8-\u00de]|[\u00c0-\u00d6\u00d8-\u00de][a-z]/g) || []).length -
  3 * (t.match(/[\u2500-\u25ff\ufffd\u201a\u0192]/g) || []).length;
function decodificar(buf) {
  if (!buf.length) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    const opcoes = [deCp850(buf), new TextDecoder('windows-1252').decode(buf)];
    return opcoes.sort((a, b) => notaDoTexto(b) - notaDoTexto(a))[0];
  }
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

    const saidas = { stdout: [], stderr: [] };
    const tamanhos = { stdout: 0, stderr: 0 };
    const LIMITE = { stdout: 40000, stderr: 20000 };
    let matou = false;
    const juntar = (qual) => {
      const texto = decodificar(Buffer.concat(saidas[qual]));
      return tamanhos[qual] > LIMITE[qual] ? `${texto.slice(0, LIMITE[qual])}\n[saída truncada]` : texto;
    };

    const timer = setTimeout(() => {
      matou = true;
      child.kill('SIGKILL');
    }, timeout);

    // os bytes crus, decodificados no fim (um caractere pode chegar partido entre dois pedaços)
    for (const qual of ['stdout', 'stderr']) {
      child[qual].on('data', (d) => {
        tamanhos[qual] += d.length;
        if (tamanhos[qual] <= LIMITE[qual] * 2) saidas[qual].push(d);
      });
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: juntar('stdout'), stderr: `${juntar('stderr')}\n${err.message}`, matou });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: juntar('stdout'), stderr: juntar('stderr'), matou });
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
module.exports.decodificar = decodificar;
module.exports.ambienteSemSegredos = ambienteSemSegredos;
module.exports.BLOQUEADOS = BLOQUEADOS;
