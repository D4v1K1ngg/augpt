'use strict';

/**
 * Ver e agir na tela do Windows (19/11, Davi: "é possível implementar um recurso igual ao que você faz de ver a tela do
 * meu computador e clicar/interagir?"). Sem instalar nada: um PowerShell que fica aberto, com um trecho em C# compilado
 * uma vez, recebe um pedido por linha (JSON) e responde outra:
 *  - janelas: as janelas abertas, da da frente para a de trás;
 *  - elementos: o que a janela mostra, pela automação de interface do Windows (UI Automation — a mesma que os leitores
 *    de tela usam): botões, campos, menus, links, com o nome, a posição e se é campo de senha;
 *  - foto: a janela (ou a tela) num PNG, para o olho (um modelo de visão pequeno) apontar o que a lista não mostra;
 *  - focar, clicar, digitar (com acento, pelo SendInput Unicode), tecla ("ctrl+s"), rolar, cursor.
 * Tudo em pixels físicos (o processo se declara ciente do DPI).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CSHARP = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

public static class AuTela {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }

  static AuTela() { SetProcessDPIAware(); }

  static string J(string s) {
    if (s == null) return "\"\"";
    var b = new StringBuilder("\"");
    char antes = (char)0;
    foreach (var c in s) {
      if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
      else if (c == '\r' || (c == '\n' && antes != '\r')) b.Append("\\n");
      else if (c == '\n') { }
      else if (c < 32) b.Append(" ");
      else b.Append(c);
      antes = c;
    }
    return b.Append('"').ToString();
  }

  public static string Janelas() {
    var lista = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      if (cloaked != 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      if (r.Right - r.Left < 80 || r.Bottom - r.Top < 60) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string proc = "";
      try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      lista.Add("{\"hwnd\":" + h.ToInt64() + ",\"titulo\":" + J(sb.ToString()) + ",\"pid\":" + pid + ",\"processo\":" + J(proc) + ",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"w\":" + (r.Right - r.Left) + ",\"h\":" + (r.Bottom - r.Top) + "}");
      return true;
    }, IntPtr.Zero);
    return "{\"frente\":" + GetForegroundWindow().ToInt64() + ",\"janelas\":[" + string.Join(",", lista) + "]}";
  }

  static readonly HashSet<string> INTERATIVOS = new HashSet<string> { "botão","campo","caixa","opção","link","menu","item","aba","seleção","lista","documento","controle deslizante","árvore" };
  static string Tipo(ControlType t) {
    if (t == ControlType.Button || t == ControlType.SplitButton) return "botão";
    if (t == ControlType.Edit) return "campo";
    if (t == ControlType.Document) return "documento";
    if (t == ControlType.CheckBox) return "caixa";
    if (t == ControlType.RadioButton) return "opção";
    if (t == ControlType.Hyperlink) return "link";
    if (t == ControlType.MenuItem || t == ControlType.Menu) return "menu";
    if (t == ControlType.ListItem || t == ControlType.TreeItem || t == ControlType.DataItem) return "item";
    if (t == ControlType.TabItem) return "aba";
    if (t == ControlType.ComboBox) return "seleção";
    if (t == ControlType.Slider) return "controle deslizante";
    if (t == ControlType.Text) return "texto";
    return "";
  }

  public static string Elementos(long hwnd, int maximo) {
    var raiz = AutomationElement.FromHandle(new IntPtr(hwnd));
    var cache = new CacheRequest();
    cache.Add(AutomationElement.NameProperty); cache.Add(AutomationElement.ControlTypeProperty);
    cache.Add(AutomationElement.BoundingRectangleProperty); cache.Add(AutomationElement.IsEnabledProperty);
    cache.Add(AutomationElement.IsOffscreenProperty); cache.Add(AutomationElement.IsPasswordProperty);
    cache.Add(ValuePattern.ValueProperty); cache.Add(TogglePattern.ToggleStateProperty);
    cache.Add(AutomationElement.HelpTextProperty);
    cache.TreeScope = TreeScope.Element;
    AutomationElementCollection todos;
    using (cache.Activate()) {
      todos = raiz.FindAll(TreeScope.Descendants, new AndCondition(
        new PropertyCondition(AutomationElement.IsControlElementProperty, true),
        new PropertyCondition(AutomationElement.IsOffscreenProperty, false)));
    }
    var lista = new List<string>();
    var vistos = new HashSet<string>();
    foreach (AutomationElement e in todos) {
      if (lista.Count >= maximo) break;
      string tipo;
      try { tipo = Tipo((ControlType)e.GetCachedPropertyValue(AutomationElement.ControlTypeProperty)); } catch { continue; }
      if (tipo == "") continue;
      System.Windows.Rect r;
      try { r = (System.Windows.Rect)e.GetCachedPropertyValue(AutomationElement.BoundingRectangleProperty); } catch { continue; }
      if (r.IsEmpty || r.Width < 2 || r.Height < 2) continue;
      string nome = ""; try { nome = (string)e.GetCachedPropertyValue(AutomationElement.NameProperty) ?? ""; } catch {}
      if (nome.Length > 120) nome = nome.Substring(0, 120);
      string valor = "";
      try { var v = e.GetCachedPropertyValue(ValuePattern.ValueProperty, true); if (v is string && v != AutomationElement.NotSupported) valor = (string)v; } catch {}
      if (valor.Length > 1500) valor = valor.Substring(0, 1500);
      bool senha = false; try { senha = (bool)e.GetCachedPropertyValue(AutomationElement.IsPasswordProperty); } catch {}
      if (senha) valor = "";
      string marcado = "";
      try { var t = e.GetCachedPropertyValue(TogglePattern.ToggleStateProperty, true); if (t is ToggleState) marcado = ((ToggleState)t) == ToggleState.On ? "sim" : "não"; } catch {}
      bool ativo = true; try { ativo = (bool)e.GetCachedPropertyValue(AutomationElement.IsEnabledProperty); } catch {}
      if (tipo == "texto" && nome.Trim().Length < 2) continue;
      string chave = tipo + "|" + nome + "|" + (int)r.X + "|" + (int)r.Y;
      if (!vistos.Add(chave)) continue;
      lista.Add("{\"tipo\":" + J(tipo) + ",\"nome\":" + J(nome) + ",\"valor\":" + J(valor) + ",\"senha\":" + (senha ? "true" : "false") + ",\"marcado\":" + J(marcado) + ",\"ativo\":" + (ativo ? "true" : "false") + ",\"x\":" + (int)r.X + ",\"y\":" + (int)r.Y + ",\"w\":" + (int)r.Width + ",\"h\":" + (int)r.Height + "}");
    }
    return "{\"elementos\":[" + string.Join(",", lista) + "]}";
  }

  public static string Foto(long hwnd, string arquivo) {
    int x, y, w, h;
    if (hwnd != 0) { RECT r; GetWindowRect(new IntPtr(hwnd), out r); x = r.Left; y = r.Top; w = r.Right - r.Left; h = r.Bottom - r.Top; }
    else { var b = System.Windows.Forms.Screen.PrimaryScreen.Bounds; x = b.X; y = b.Y; w = b.Width; h = b.Height; }
    using (var bmp = new Bitmap(w, h)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
      bmp.Save(arquivo, ImageFormat.Png);
    }
    return "{\"arquivo\":" + J(arquivo) + ",\"x\":" + x + ",\"y\":" + y + ",\"w\":" + w + ",\"h\":" + h + "}";
  }

  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  public static string Focar(long hwnd) {
    var h = new IntPtr(hwnd);
    if (IsIconic(h)) ShowWindow(h, 9);
    // já na frente: nada (19/11: o Alt solto que destravava o foco abria o menu do Bloco de Notas, e o texto digitado
    // virou comandos — "Salvar como" — e um arquivo na Área de Trabalho). Para trazer para a frente: AttachThreadInput
    if (GetForegroundWindow() == h) return "{\"ok\":true}";
    uint pid;
    uint daFrente = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint eu = GetCurrentThreadId();
    AttachThreadInput(eu, daFrente, true);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(eu, daFrente, false);
    return "{\"ok\":" + (ok && GetForegroundWindow() == h ? "true" : "false") + "}";
  }

  static void Tecla(ushort[] vks, bool baixo) {
    var ins = new INPUT[vks.Length];
    for (int i = 0; i < vks.Length; i++) { ins[i].type = 1; ins[i].u.ki.wVk = vks[i]; ins[i].u.ki.dwFlags = baixo ? 0u : 2u; }
    SendInput((uint)ins.Length, ins, Marshal.SizeOf(typeof(INPUT)));
  }

  public static string Teclas(string vksTexto) {
    var partes = vksTexto.Split(',');
    var vks = new ushort[partes.Length];
    for (int i = 0; i < partes.Length; i++) vks[i] = Convert.ToUInt16(partes[i]);
    Tecla(vks, true);
    var solta = new ushort[vks.Length];
    for (int i = 0; i < vks.Length; i++) solta[i] = vks[vks.Length - 1 - i];
    Tecla(solta, false);
    return "{\"ok\":true}";
  }

  public static string Digitar(string texto) {
    foreach (var c in texto) {
      if (c == '\n') { Teclas("13"); System.Threading.Thread.Sleep(8); continue; }
      if (c == '\r') continue;
      if (c == '\t') { Teclas("9"); continue; }
      var ins = new INPUT[2];
      ins[0].type = 1; ins[0].u.ki.wScan = c; ins[0].u.ki.dwFlags = 4;
      ins[1].type = 1; ins[1].u.ki.wScan = c; ins[1].u.ki.dwFlags = 4 | 2;
      SendInput(2, ins, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(6);
    }
    return "{\"ok\":true}";
  }

  public static string Clicar(int x, int y, string botao, bool duplo) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(40);
    uint baixo = botao == "direito" ? 0x0008u : 0x0002u, cima = botao == "direito" ? 0x0010u : 0x0004u;
    for (int k = 0; k < (duplo ? 2 : 1); k++) {
      var ins = new INPUT[2];
      ins[0].type = 0; ins[0].u.mi.dwFlags = baixo;
      ins[1].type = 0; ins[1].u.mi.dwFlags = cima;
      SendInput(2, ins, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(60);
    }
    return "{\"ok\":true}";
  }

  public static string Rolar(int x, int y, int passos) {
    SetCursorPos(x, y);
    var ins = new INPUT[1];
    ins[0].type = 0; ins[0].u.mi.dwFlags = 0x0800; ins[0].u.mi.mouseData = (uint)(-120 * passos);
    SendInput(1, ins, Marshal.SizeOf(typeof(INPUT)));
    return "{\"ok\":true}";
  }

  public static string Cursor() { POINT p; GetCursorPos(out p); return "{\"x\":" + p.X + ",\"y\":" + p.Y + "}"; }
}
`;

// o laço do PowerShell: compila o C# uma vez e responde um pedido JSON por linha (uma linha de resposta, ou {erro})
const LACO = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms -TypeDefinition (Get-Content -Raw -Encoding UTF8 $env:AUGPT_TELA_CS)
[Console]::Out.WriteLine('{"pronto":true}')
while ($true) {
  $linha = [Console]::In.ReadLine()
  if ($linha -eq $null) { break }
  try {
    $p = $linha | ConvertFrom-Json
    $r = switch ($p.cmd) {
      'janelas' { [AuTela]::Janelas() }
      'elementos' { [AuTela]::Elementos([long]$p.hwnd, [int]$p.maximo) }
      'foto' { [AuTela]::Foto([long]$p.hwnd, [string]$p.arquivo) }
      'focar' { [AuTela]::Focar([long]$p.hwnd) }
      'teclas' { [AuTela]::Teclas([string]$p.vks) }
      'digitar' { [AuTela]::Digitar([string]$p.texto) }
      'clicar' { [AuTela]::Clicar([int]$p.x, [int]$p.y, [string]$p.botao, [bool]$p.duplo) }
      'rolar' { [AuTela]::Rolar([int]$p.x, [int]$p.y, [int]$p.passos) }
      'cursor' { [AuTela]::Cursor() }
      default { '{"erro":"comando desconhecido"}' }
    }
  } catch {
    $r = '{"erro":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}'
  }
  [Console]::Out.WriteLine($r)
}
`;

let processo = null;
let fila = Promise.resolve();
let pendente = null;
let buffer = '';

function iniciar() {
  if (processo && !processo.killed && processo.exitCode === null) return processo.pronto;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-tela-'));
  const cs = path.join(dir, 'AuTela.cs');
  const ps1 = path.join(dir, 'laco.ps1');
  fs.writeFileSync(cs, CSHARP);
  fs.writeFileSync(ps1, `﻿${LACO}`);
  processo = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { windowsHide: true, env: { ...process.env, AUGPT_TELA_CS: cs } });
  processo.stdout.setEncoding('utf8');
  let aoPronto;
  let aoFalhar;
  processo.pronto = new Promise((ok, falha) => ((aoPronto = ok), (aoFalhar = falha)));
  let erro = '';
  processo.stderr.on('data', (d) => (erro = `${erro}${d}`.slice(-2000)));
  processo.stdout.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!linha) continue;
      if (linha === '{"pronto":true}') {
        aoPronto();
        continue;
      }
      const p = pendente;
      pendente = null;
      p?.(linha);
    }
  });
  processo.on('exit', () => {
    aoFalhar(new Error(`o ajudante da tela fechou${erro ? `: ${erro.trim().split('\n').slice(-3).join(' ')}` : ''}`));
    pendente?.('{"erro":"o ajudante da tela fechou"}');
    pendente = null;
    processo = null;
  });
  return processo.pronto;
}

/** Um pedido ao ajudante (um de cada vez). */
function pedir(cmd, args = {}, { timeout = 20000 } = {}) {
  const inicio = Date.now();
  if (process.env.AUGPT_DEBUG_TELA) console.log(`[tela] pedido ${cmd}`);
  const vez = fila.then(async () => {
    await iniciar();
    if (process.env.AUGPT_DEBUG_TELA) console.log(`[tela] ${cmd} começou (${Date.now() - inicio} ms na fila)`);
    return new Promise((ok, falha) => {
      const fim = setTimeout(() => {
        pendente = null;
        falha(new Error(`a tela não respondeu (${cmd})`));
      }, timeout);
      pendente = (linha) => {
        clearTimeout(fim);
        let r;
        try {
          r = JSON.parse(linha);
        } catch {
          return falha(new Error(`resposta estranha da tela: ${linha.slice(0, 120)}`));
        }
        return r?.erro ? falha(new Error(r.erro)) : ok(r);
      };
      processo.stdin.write(`${JSON.stringify({ cmd, ...args })}\n`);
    });
  });
  fila = vez.catch(() => {});
  return vez;
}

// teclas pelo nome ("ctrl+s", "enter", "alt+f4") → códigos virtuais do Windows
const VK = { ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, windows: 0x5b, enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, espaco: 0x20, space: 0x20, backspace: 0x08, apagar: 0x08, delete: 0x2e, del: 0x2e, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, cima: 0x26, up: 0x26, baixo: 0x28, down: 0x28, esquerda: 0x25, left: 0x25, direita: 0x27, right: 0x27, insert: 0x2d };
function codigosDaTecla(combo) {
  const partes = String(combo || '').toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
  if (!partes.length) throw new Error('informe a tecla, como "enter" ou "ctrl+s"');
  return partes.map((p) => {
    if (VK[p]) return VK[p];
    if (/^f([1-9]|1[0-2])$/.test(p)) return 0x6f + Number(p.slice(1));
    if (/^[a-z0-9]$/.test(p)) return p.toUpperCase().charCodeAt(0);
    throw new Error(`tecla desconhecida: "${p}"`);
  });
}

const janelas = () => pedir('janelas');
const elementos = (hwnd, maximo = 160) => pedir('elementos', { hwnd, maximo }, { timeout: 30000 });
const foto = (hwnd = 0) => pedir('foto', { hwnd, arquivo: path.join(os.tmpdir(), `augpt-tela-${Date.now()}.png`) });
const focar = (hwnd) => pedir('focar', { hwnd });
const clicar = (x, y, { botao = 'esquerdo', duplo = false } = {}) => pedir('clicar', { x: Math.round(x), y: Math.round(y), botao, duplo });
const digitar = (texto) => pedir('digitar', { texto: String(texto) }, { timeout: 60000 });
const teclas = (combo) => pedir('teclas', { vks: codigosDaTecla(combo).join(',') });
const rolar = (x, y, passos) => pedir('rolar', { x: Math.round(x), y: Math.round(y), passos: Math.round(passos) });
const cursor = () => pedir('cursor');
function fechar() {
  try {
    processo?.kill();
  } catch {
    /* já foi */
  }
  processo = null;
}

module.exports = { janelas, elementos, foto, focar, clicar, digitar, teclas, rolar, cursor, fechar, codigosDaTecla };
