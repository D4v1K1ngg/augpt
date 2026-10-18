'use strict';

/**
 * Ajustes da placa de rede (18/10, item 4) — o único recurso que MUDA o sistema.
 * Regras:
 * - lista fechada: DNS (Cloudflare, Google ou automático), desligar a economia
 *   de energia da placa (EEE, Ethernet Verde, Power Saving…), limpar o cache de
 *   DNS e preferir 5 GHz no Wi-Fi. Nada de "tweaks" de TCP (não ajudam no
 *   Windows atual) e nada no roteador (pede a senha dele);
 * - nunca sozinho: primeiro o plano (Ajuste | Agora | Depois), o usuário
 *   responde "aplicar", o Windows pede a permissão de administrador (UAC);
 * - sempre com volta: o estado de antes fica em <userData>/ajustes-de-rede.json
 *   e "desfazer ajustes de rede" volta tudo;
 * - depois de aplicar, relê e mostra o que ficou.
 * Os comandos vão por um script .ps1 gerado aqui, sem nada do texto do usuário
 * nele (só índices e valores da lista válida que o próprio Windows informa).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function rodar(comando, args, { timeout = 60000 } = {}) {
  return new Promise((ok) => {
    execFile(comando, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, saida, erro) => ok({ saida: String(saida || ''), erro: err ? String(erro || err.message || '') : '' }));
  });
}

const DNS = { dns_cloudflare: ['1.1.1.1', '1.0.0.1'], dns_google: ['8.8.8.8', '8.8.4.4'] };
// nomes das opções em qualquer idioma (o driver da Realtek do Davi fala espanhol: "Desactivado")
const DESLIGADO = /^(disabled?|desactivad[oa]|desativad[oa]|desabilitad[oa]|desligad[oa]|off|aus|deaktiviert)$/i;
const ECONOMIA = /energy[- ]?efficient|green ethernet|ethernet verde|energia eficiente|power saving|economia de energia|gigabit lite|giga ?lite|\beee\b|advanced eee|ultra low power|power down|auto disable gigabit/i;
const BANDA = /preferred band|banda preferida|banda preferencial|band preference/i;

const ESTADO = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
$rota = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
$p = Get-NetAdapter -InterfaceIndex $rota.InterfaceIndex
$ns = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\$($p.InterfaceGuid)" -ErrorAction SilentlyContinue).NameServer
[pscustomobject]@{
  adaptador = [pscustomobject]@{ nome = $p.Name; indice = $p.ifIndex; descricao = $p.InterfaceDescription; wifi = [bool]($p.PhysicalMediaType -match '802\\.11|Wireless') }
  dns = [pscustomobject]@{ servidores = @((Get-DnsClientServerAddress -InterfaceIndex $p.ifIndex -AddressFamily IPv4).ServerAddresses); estatico = [bool]$ns }
  propriedades = @(Get-NetAdapterAdvancedProperty -Name $p.Name -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ nome = $_.DisplayName; valor = $_.DisplayValue; chave = $_.RegistryKeyword; valorReg = [string]($_.RegistryValue -join ','); exibe = @($_.ValidDisplayValues); reg = @($_.ValidRegistryValues) } })
} | ConvertTo-Json -Depth 5 -Compress`;

const lista = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** O estado atual (só leitura, sem administrador). */
async function lerEstado({ executar = rodar } = {}) {
  const { saida } = await executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', ESTADO], { timeout: 30000 });
  const e = JSON.parse(saida);
  e.dns.servidores = lista(e.dns.servidores);
  e.propriedades = lista(e.propriedades).map((p) => ({ ...p, exibe: lista(p.exibe), reg: lista(p.reg) }));
  return e;
}

/** Os ajustes que o texto pede (só da lista fechada). "otimize a placa" = economia de energia + cache de DNS (+5 GHz no Wi-Fi). */
function ajustesPedidos(texto, { wifi = false } = {}) {
  const t = String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const ids = new Set();
  if (/cloudflare|1\.1\.1\.1/.test(t)) ids.add('dns_cloudflare');
  else if (/google|8\.8\.8\.8/.test(t) && /dns/.test(t)) ids.add('dns_google');
  else if (/dns/.test(t) && /(automatic|padrao|original|do roteador|da operadora|dhcp)/.test(t)) ids.add('dns_automatico');
  if (/economia de energia|energy|eee|ethernet verde|green ethernet|power saving/.test(t)) ids.add('economia_de_energia');
  if (/(cache|flush).{0,15}dns|dns.{0,15}(cache|flush)|limp\w* (o )?dns/.test(t)) ids.add('limpar_dns');
  if (/5 ?ghz|banda de 5/.test(t)) ids.add('wifi_5ghz');
  if (!ids.size && /otimiz|melhor\w* (a |minha )?placa|ajust\w* (a |minha )?placa|configur\w* (a |minha )?placa/.test(t)) {
    ids.add('economia_de_energia');
    ids.add('limpar_dns');
    if (wifi) ids.add('wifi_5ghz');
  }
  return [...ids];
}

/** O plano: para cada ajuste, o que está agora, o que fica e os comandos (aplicar e desfazer). */
function planejar(ids, e) {
  const passos = [];
  const nome = String(e.adaptador.nome).replace(/'/g, "''");
  const dnsAgora = e.dns.servidores.length ? `${e.dns.servidores.join(', ')}${e.dns.estatico ? '' : ' (automático)'}` : 'automático';
  const voltarDns = e.dns.estatico ? `Set-DnsClientServerAddress -InterfaceIndex ${Number(e.adaptador.indice)} -ServerAddresses ${e.dns.servidores.map((s) => `'${String(s).replace(/[^0-9a-f.:]/gi, '')}'`).join(',')}` : `Set-DnsClientServerAddress -InterfaceIndex ${Number(e.adaptador.indice)} -ResetServerAddresses`;
  for (const id of ids) {
    if (DNS[id]) {
      const ja = e.dns.estatico && DNS[id].every((s) => e.dns.servidores.includes(s));
      passos.push({ id, titulo: `DNS ${id === 'dns_cloudflare' ? 'da Cloudflare' : 'do Google'}`, agora: dnsAgora, depois: DNS[id].join(', '), mudar: !ja, admin: true, aplicar: `Set-DnsClientServerAddress -InterfaceIndex ${Number(e.adaptador.indice)} -ServerAddresses ${DNS[id].map((s) => `'${s}'`).join(',')}`, desfazer: voltarDns });
    } else if (id === 'dns_automatico') {
      passos.push({ id, titulo: 'DNS automático (o do roteador/operadora)', agora: dnsAgora, depois: 'automático', mudar: e.dns.estatico, admin: true, aplicar: `Set-DnsClientServerAddress -InterfaceIndex ${Number(e.adaptador.indice)} -ResetServerAddresses`, desfazer: voltarDns });
    } else if (id === 'economia_de_energia') {
      const props = e.propriedades.filter((p) => ECONOMIA.test(p.nome) && p.exibe.some((x) => DESLIGADO.test(x)));
      if (!props.length) passos.push({ id, titulo: 'Economia de energia da placa', agora: 'a placa não tem essa opção', depois: '—', mudar: false });
      for (const p of props) {
        const i = p.exibe.findIndex((x) => DESLIGADO.test(x));
        const ja = DESLIGADO.test(p.valor);
        const chave = String(p.chave).replace(/'/g, "''");
        passos.push({ id, titulo: `Economia de energia: ${p.nome}`, agora: p.valor, depois: p.exibe[i], mudar: !ja, admin: true, reinicia: true, aplicar: `Set-NetAdapterAdvancedProperty -Name '${nome}' -RegistryKeyword '${chave}' -RegistryValue '${String(p.reg[i]).replace(/'/g, "''")}'`, desfazer: `Set-NetAdapterAdvancedProperty -Name '${nome}' -RegistryKeyword '${chave}' -RegistryValue '${String(p.valorReg).replace(/'/g, "''")}'` });
      }
    } else if (id === 'wifi_5ghz') {
      const p = e.propriedades.find((x) => BANDA.test(x.nome));
      const i = p ? p.exibe.findIndex((x) => /5 ?g/i.test(x)) : -1;
      if (!e.adaptador.wifi || !p || i < 0) passos.push({ id, titulo: 'Preferir 5 GHz no Wi-Fi', agora: e.adaptador.wifi ? 'a placa não tem essa opção' : 'o PC está no cabo', depois: '—', mudar: false });
      else {
        const chave = String(p.chave).replace(/'/g, "''");
        passos.push({ id, titulo: 'Preferir 5 GHz no Wi-Fi', agora: p.valor, depois: p.exibe[i], mudar: p.valor !== p.exibe[i], admin: true, reinicia: true, aplicar: `Set-NetAdapterAdvancedProperty -Name '${nome}' -RegistryKeyword '${chave}' -RegistryValue '${String(p.reg[i]).replace(/'/g, "''")}'`, desfazer: `Set-NetAdapterAdvancedProperty -Name '${nome}' -RegistryKeyword '${chave}' -RegistryValue '${String(p.valorReg).replace(/'/g, "''")}'` });
      }
    } else if (id === 'limpar_dns') {
      passos.push({ id, titulo: 'Limpar o cache de DNS', agora: 'cache com os endereços já consultados', depois: 'cache vazio (refaz sozinho)', mudar: true, admin: false, comando: ['ipconfig', ['/flushdns']] });
    }
  }
  return { adaptador: e.adaptador, passos };
}

function tabelaDoPlano(plano) {
  const linhas = ['| Ajuste | Agora | Depois |', '| --- | --- | --- |', ...plano.passos.map((p) => `| ${p.titulo} | ${p.agora} | ${p.mudar ? `**${p.depois}**` : `${p.depois === '—' ? '—' : 'já está assim'}`} |`)];
  return `${linhas.join('\n')}\n\n*Placa: ${plano.adaptador.descricao} (${plano.adaptador.nome}).*`;
}

/** Roda os comandos com administrador: um script .ps1 e o pedido de permissão do Windows (UAC). */
async function comoAdministrador(comandos, { executar = rodar } = {}) {
  if (!comandos.length) return { ok: true };
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ajustes-'));
  const script = path.join(pasta, 'ajustes.ps1');
  const log = path.join(pasta, 'resultado.txt');
  fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'\ntry {\n${comandos.map((c) => `  ${c}`).join('\n')}\n  'ok' | Out-File -Encoding utf8 '${log.replace(/'/g, "''")}'\n} catch { "erro: $($_.Exception.Message)" | Out-File -Encoding utf8 '${log.replace(/'/g, "''")}' }\n`, 'utf8');
  const { erro } = await executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${script}"'`], { timeout: 180000 });
  let resultado = '';
  try {
    resultado = fs.readFileSync(log, 'utf8').replace(/^﻿/, '').trim();
  } catch {
    resultado = '';
  }
  fs.rmSync(pasta, { recursive: true, force: true });
  if (resultado === 'ok') return { ok: true };
  if (!resultado && /cancel|cancelad/i.test(erro)) return { ok: false, motivo: 'a permissão de administrador foi negada na janela do Windows' };
  return { ok: false, motivo: resultado.replace(/^erro:\s*/, '') || erro.trim().slice(0, 200) || 'o Windows não confirmou a mudança' };
}

const arquivoDeVolta = (pasta) => path.join(pasta, 'ajustes-de-rede.json');

/** Aplica o plano: guarda o que era, roda (com UAC o que precisa), relê. */
async function aplicar(plano, { pasta, executar = rodar } = {}) {
  const mudar = plano.passos.filter((p) => p.mudar);
  const comAdmin = mudar.filter((p) => p.admin);
  if (comAdmin.length) {
    // a volta fica guardada ANTES de mudar (se o Windows cair no meio, ela já existe)
    const anterior = fs.existsSync(arquivoDeVolta(pasta)) ? JSON.parse(fs.readFileSync(arquivoDeVolta(pasta), 'utf8')) : { passos: [] };
    const jaGuardados = new Set(anterior.passos.map((p) => p.desfazer));
    const volta = { em: new Date().toISOString(), adaptador: plano.adaptador, passos: [...anterior.passos, ...comAdmin.filter((p) => !jaGuardados.has(p.desfazer)).map((p) => ({ titulo: p.titulo, agora: p.agora, desfazer: p.desfazer }))] };
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(arquivoDeVolta(pasta), JSON.stringify(volta, null, 2));
  }
  const r = await comoAdministrador(comAdmin.map((p) => p.aplicar), { executar });
  if (!r.ok) return { ok: false, motivo: r.motivo };
  for (const p of mudar.filter((x) => !x.admin)) await executar(...p.comando);
  return { ok: true, aplicados: mudar.map((p) => p.titulo) };
}

/** "desfazer ajustes de rede": volta o que foi guardado. */
async function desfazer({ pasta, executar = rodar } = {}) {
  if (!fs.existsSync(arquivoDeVolta(pasta))) return { ok: false, motivo: 'não há ajustes do AuGPT para desfazer' };
  const volta = JSON.parse(fs.readFileSync(arquivoDeVolta(pasta), 'utf8'));
  // do último para o primeiro
  const r = await comoAdministrador([...volta.passos].reverse().map((p) => p.desfazer), { executar });
  if (!r.ok) return { ok: false, motivo: r.motivo };
  fs.rmSync(arquivoDeVolta(pasta), { force: true });
  return { ok: true, desfeitos: volta.passos.map((p) => `${p.titulo} (voltou para: ${p.agora})`) };
}

const temVolta = (pasta) => fs.existsSync(arquivoDeVolta(pasta));

module.exports = { lerEstado, ajustesPedidos, planejar, tabelaDoPlano, aplicar, desfazer, temVolta, comoAdministrador, DESLIGADO, ECONOMIA };
