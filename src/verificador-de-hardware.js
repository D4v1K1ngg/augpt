'use strict';

/**
 * Verificador de hardware da tela de boas-vindas (15/10, distribuição para os
 * amigos do Davi testarem). Diz o que o computador tem e qual modelo cabe:
 *   - placa de vídeo e memória dela (VRAM): `nvidia-smi` quando existe; no
 *     Windows, o registro (vale para NVIDIA, AMD e Intel — o Win32_VideoController
 *     do WMI trava em 4 GB); no Mac com chip Apple, a memória é unificada;
 *   - RAM, processador e espaço livre no disco dos modelos.
 * A recomendação usa a família Qwen3.5 (a medição de 15/10: o 9B tirou 8,9 no
 * núcleo de pesquisa e usa ferramentas nativas) e o nomic-embed-text.
 * Nada aqui instala nem muda nada — só lê.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const GB = 1024 ** 3;
const arred = (n) => Math.round(n * 10) / 10;

function rodar(comando, args, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    execFile(comando, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

/** "NVIDIA GeForce RTX 3060 Ti, 8192" (MiB) por linha. */
function lerGpusNvidiaSmi(saida) {
  return String(saida || '')
    .split(/\r?\n/)
    .map((l) => l.split(',').map((x) => x.trim()))
    .filter(([nome, mib]) => nome && Number(mib) > 0)
    .map(([nome, mib]) => ({ nome, vramGB: arred(Number(mib) / 1024), fonte: 'nvidia-smi' }));
}

/** "Nome|bytes" por linha (registro do Windows, HardwareInformation.qwMemorySize). */
function lerGpusDoRegistro(saida) {
  const vistas = new Set();
  return String(saida || '')
    .split(/\r?\n/)
    .map((l) => l.split('|'))
    .filter(([nome, bytes]) => nome && nome.trim() && Number(bytes) > 0)
    .map(([nome, bytes]) => ({ nome: nome.trim(), vramGB: arred(Number(bytes) / GB), fonte: 'registro' }))
    .filter((g) => !/basic display|microsoft basic|remote display/i.test(g.nome) && !vistas.has(g.nome) && vistas.add(g.nome));
}

async function detectarGpus({ plataforma = process.platform, executar = rodar } = {}) {
  const nvidia = lerGpusNvidiaSmi(await executar('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']));
  if (nvidia.length) return nvidia;
  if (plataforma === 'win32') {
    const ps = "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { '{0}|{1}' -f $_.DriverDesc, $_.'HardwareInformation.qwMemorySize' }";
    return lerGpusDoRegistro(await executar('powershell', ['-NoProfile', '-Command', ps]));
  }
  // Mac com chip Apple: a placa usa a RAM (memória unificada); ~70% fica disponível para o modelo
  if (plataforma === 'darwin' && /apple/i.test(os.cpus()[0]?.model || '')) {
    return [{ nome: 'GPU Apple (memória unificada)', vramGB: arred((os.totalmem() / GB) * 0.7), fonte: 'unificada' }];
  }
  return [];
}

/** Pasta onde o Ollama guarda os modelos (OLLAMA_MODELS ou a padrão). */
function pastaDosModelos(env = process.env) {
  return env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models');
}

/** Espaço livre (GB) no disco da pasta — sobe até achar uma pasta que existe. */
function espacoLivreGB(pasta) {
  let p = pasta;
  while (p && !fs.existsSync(p)) {
    const pai = path.dirname(p);
    if (pai === p) break;
    p = pai;
  }
  try {
    const s = fs.statfsSync(p);
    return arred((s.bavail * s.bsize) / GB);
  } catch {
    return null;
  }
}

async function verificarComputador(opcoes = {}) {
  const gpus = await detectarGpus(opcoes);
  const pasta = pastaDosModelos(opcoes.env);
  return {
    sistema: `${os.type()} ${os.release()}`,
    plataforma: opcoes.plataforma || process.platform,
    cpu: (os.cpus()[0]?.model || '').replace(/\s+/g, ' ').trim(),
    nucleos: os.cpus().length,
    ramTotalGB: arred(os.totalmem() / GB),
    gpus,
    vramGB: gpus.reduce((m, g) => Math.max(m, g.vramGB), 0),
    pastaModelos: pasta,
    discoLivreGB: espacoLivreGB(pasta),
  };
}

// Qwen3.5, tamanhos do catálogo do Ollama (download da quantização padrão)
const MODELOS = {
  '27b': { nome: 'qwen3.5:27b', rotulo: 'Qwen3.5 27B', downloadGB: 17, precisaVramGB: 20 },
  '9b': { nome: 'qwen3.5:9b', rotulo: 'Qwen3.5 9B', downloadGB: 6.6, precisaVramGB: 8 },
  '4b': { nome: 'qwen3.5:4b', rotulo: 'Qwen3.5 4B', downloadGB: 3.3, precisaVramGB: 4.5 },
  '2b': { nome: 'qwen3.5:2b', rotulo: 'Qwen3.5 2B', downloadGB: 2.7, precisaVramGB: 3 },
  '0.8b': { nome: 'qwen3.5:0.8b', rotulo: 'Qwen3.5 0.8B', downloadGB: 1.2, precisaVramGB: 1.5 },
};
const EMBEDDING = { nome: 'nomic-embed-text', rotulo: 'Nomic Embed Text', downloadGB: 0.3, motivo: 'escolhe os melhores trechos das páginas lidas (obrigatório, leve)' };

/**
 * Qual modelo cabe. Com placa de vídeo, decide a VRAM (o modelo inteiro na
 * placa é várias vezes mais rápido); sem ela, a RAM (roda no processador, bem
 * mais devagar). Devolve o principal, o de embedding, as alternativas e avisos.
 */
function recomendarModelos({ vramGB = 0, ramTotalGB = 0, discoLivreGB = null } = {}) {
  let chave;
  let motivo;
  if (vramGB >= 20) [chave, motivo] = ['27b', `sua placa tem ${vramGB} GB: cabe o modelo grande, o de melhor qualidade`];
  else if (vramGB >= 7.5) [chave, motivo] = ['9b', `sua placa tem ${vramGB} GB: o 9B cabe inteiro nela — é o que o AuGPT foi ajustado e medido`];
  else if (vramGB >= 4.5) [chave, motivo] = ['4b', `sua placa tem ${vramGB} GB: o 4B cabe inteiro; o 9B ficaria lento`];
  else if (ramTotalGB >= 16) [chave, motivo] = ['4b', `sem placa de vídeo com memória suficiente: roda no processador, usando ${ramTotalGB} GB de RAM (mais devagar)`];
  else if (ramTotalGB >= 8) [chave, motivo] = ['2b', `pouca memória (${ramTotalGB} GB de RAM, sem placa adequada): um modelo leve, que responde pior`];
  else [chave, motivo] = ['0.8b', `memória muito limitada (${ramTotalGB} GB): só o menor modelo roda, com qualidade baixa`];
  const principal = { ...MODELOS[chave], motivo };
  const ordem = ['27b', '9b', '4b', '2b', '0.8b'];
  const alternativas = ordem.filter((k) => k !== chave).map((k) => ({ ...MODELOS[k], cabe: vramGB >= MODELOS[k].precisaVramGB || (!vramGB && ramTotalGB >= MODELOS[k].precisaVramGB * 2) }));
  const avisos = [];
  const total = principal.downloadGB + EMBEDDING.downloadGB;
  if (discoLivreGB != null && discoLivreGB < total + 2) avisos.push(`pouco espaço no disco dos modelos: ${discoLivreGB} GB livres, precisa de uns ${Math.ceil(total + 2)} GB`);
  if (!vramGB) avisos.push('não achei placa de vídeo com memória dedicada: o modelo roda no processador e cada resposta demora bem mais');
  return { principal, embedding: EMBEDDING, alternativas, avisos, downloadTotalGB: arred(total) };
}

module.exports = { verificarComputador, detectarGpus, lerGpusNvidiaSmi, lerGpusDoRegistro, recomendarModelos, espacoLivreGB, pastaDosModelos, MODELOS, EMBEDDING };
