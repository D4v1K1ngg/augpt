'use strict';

/**
 * Avisos falados (27/10, fase 2 da conversa estilo Jarvis): antes de falar um aviso, o AuGPT confere se é
 * hora — fora do horário de silêncio, sem jogo ou apresentação em tela cheia, sem o "não incomodar" do
 * Windows e sem outro programa usando o microfone (uma chamada de vídeo). Só LÊ o estado do Windows:
 * SHQueryUserNotificationState (o mesmo que o Windows usa para segurar as notificações) e a lista de
 * quem está com o microfone aberto (Configurações → Privacidade → Microfone).
 */

const { execFile } = require('child_process');

const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "Add-Type -Namespace AuGPT -Name Estado -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s);'",
  '$s = 0; [void][AuGPT.Estado]::SHQueryUserNotificationState([ref]$s); "estado=$s"',
  "$base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'",
  'Get-ChildItem $base -Recurse | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.LastUsedTimeStart -gt 0 -and $p.LastUsedTimeStop -eq 0) { "mic=" + $_.PSChildName } }',
].join('\n');

// QUERY_USER_NOTIFICATION_STATE: só o 5 (aceita notificações) é "pode falar"
const MOTIVOS = {
  1: 'tela bloqueada ou protetor de tela',
  2: 'um programa em tela cheia',
  3: 'um jogo em tela cheia',
  4: 'modo de apresentação',
  6: 'o "não incomodar" do Windows',
  7: 'um app em tela cheia',
};

// o próprio AuGPT (a escuta do "Ei Jarvis" deixa o microfone aberto) não conta
const O_PROPRIO = /electron\.exe$|augpt/i;

/** A saída do script → { livre, motivo }. Puro (testado na bancada). */
function interpretar(saida) {
  const linhas = String(saida || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const estado = Number(/^estado=(\d+)/.exec(linhas.find((l) => l.startsWith('estado=')) || '')?.[1]);
  if (MOTIVOS[estado]) return { livre: false, motivo: MOTIVOS[estado] };
  const outros = linhas.filter((l) => l.startsWith('mic=')).map((l) => l.slice(4)).filter((m) => !O_PROPRIO.test(m));
  if (outros.length) return { livre: false, motivo: `o microfone em uso por outro programa (${outros[0].split('#').pop()})` };
  return { livre: true, motivo: '' };
}

/** "22:00" até "07:00" (passa da meia-noite) ou "13:00" até "14:00"; horário inválido = sem silêncio. */
function emSilencio(agora, de, ate) {
  const min = (h) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim());
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const [a, b] = [min(de), min(ate)];
  if (a === null || b === null || a === b) return false;
  const t = agora.getHours() * 60 + agora.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** O estado do Windows agora. Falhou ou não é Windows: livre (o aviso escrito aparece de qualquer jeito). */
function estadoDoPc() {
  if (process.platform !== 'win32') return Promise.resolve({ livre: true, motivo: '' });
  return new Promise((ok) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { timeout: 8000, windowsHide: true }, (err, saida) => {
      ok(err && !saida ? { livre: true, motivo: '' } : interpretar(saida));
    });
  });
}

module.exports = { interpretar, emSilencio, estadoDoPc, SCRIPT };
