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
    // qwMemorySize (64 bits) primeiro; driver antigo (ex.: AMD Polaris, RX 580) pode gravar só o
    // MemorySize (32 bits, às vezes como bytes) — 17/10, preparando o AuGPT para a RX 580
    const ps = "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { $m = $_.'HardwareInformation.qwMemorySize'; if (-not $m) { $m = $_.'HardwareInformation.MemorySize'; if ($m -is [byte[]]) { $m = [BitConverter]::ToUInt32($m, 0) } }; '{0}|{1}' -f $_.DriverDesc, $m }";
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
/**
 * Placa AMD antiga (Polaris/GCN: RX 400/500, R7/R9, Vega, HD): sem ROCm, o Ollama usa o Vulkan dela,
 * que funciona mas é mais lento — o recomendador desce um degrau (4B em vez do 9B).
 */
const PLACA_AMD_ANTIGA = /\b(rx\s?(4[6-9]0|5[4-9]0)|r[579]\s?\d{3}x?|r9|radeon\s?hd|vega|firepro)\b|2048\s?sp/i;
const placaAntiga = (gpus = [], vramGB = 0) => gpus.some((g) => PLACA_AMD_ANTIGA.test(g.nome) && g.vramGB >= vramGB - 0.1);

function recomendarModelos({ vramGB = 0, ramTotalGB = 0, discoLivreGB = null, gpus = [] } = {}) {
  let chave;
  let motivo;
  const antiga = vramGB >= 3 && placaAntiga(gpus, vramGB);
  if (antiga && vramGB >= 4.5) [chave, motivo] = ['4b', `sua placa AMD tem ${vramGB} GB, mas é de uma geração antiga (sem ROCm): o Ollama usa o Vulkan dela, mais devagar — o 4B é o equilíbrio entre qualidade e velocidade`];
  else if (antiga) [chave, motivo] = ['2b', `sua placa AMD tem ${vramGB} GB e é de uma geração antiga: o 2B (2,6 GB) cabe nela e roda pelo Vulkan`];
  else if (vramGB >= 20) [chave, motivo] = ['27b', `sua placa tem ${vramGB} GB: cabe o modelo grande, o de melhor qualidade`];
  else if (vramGB >= 7.5) [chave, motivo] = ['9b', `sua placa tem ${vramGB} GB: o 9B cabe inteiro nela — é o que o AuGPT foi ajustado e medido`];
  else if (vramGB >= 4.5) [chave, motivo] = ['4b', `sua placa tem ${vramGB} GB: o 4B cabe inteiro; o 9B ficaria lento`];
  // 17/10, medido: o 2B ocupa 2,6 GB na placa e teve a mesma nota do 4B (9,5) na metade do tempo
  else if (vramGB >= 3) [chave, motivo] = ['2b', `sua placa tem ${vramGB} GB: o 2B (2,6 GB) cabe inteiro nela e é rápido`];
  else if (ramTotalGB >= 8) [chave, motivo] = ['2b', `sem placa de vídeo com memória suficiente: roda no processador, usando a RAM (${ramTotalGB} GB); o 2B é o mais indicado aí — nos testes teve a mesma nota do 4B na metade do tempo`];
  else [chave, motivo] = ['0.8b', `memória muito limitada (${ramTotalGB} GB): só o menor modelo roda, com qualidade baixa`];
  const principal = { ...MODELOS[chave], motivo };
  const ordem = ['27b', '9b', '4b', '2b', '0.8b'];
  const alternativas = ordem.filter((k) => k !== chave).map((k) => ({ ...MODELOS[k], cabe: vramGB >= MODELOS[k].precisaVramGB || (!vramGB && ramTotalGB >= MODELOS[k].precisaVramGB * 2) }));
  const avisos = [];
  const total = principal.downloadGB + EMBEDDING.downloadGB;
  if (discoLivreGB != null && discoLivreGB < total + 2) avisos.push(`pouco espaço no disco dos modelos: ${discoLivreGB} GB livres, precisa de uns ${Math.ceil(total + 2)} GB`);
  if (!vramGB) avisos.push('não achei placa de vídeo com memória dedicada: o modelo roda no processador e cada resposta demora bem mais');
  if (antiga) avisos.push('placa AMD antiga: depois de instalar, use "Testar a placa de vídeo" em Ajustes → Componentes para conferir se o Ollama está usando ela');
  return { principal, embedding: EMBEDDING, alternativas, avisos, downloadTotalGB: arred(total) };
}

/**
 * Teste da placa (17/10): carrega o modelo com o contexto do AuGPT, gera um texto curto e diz onde
 * ele rodou (placa, dividido ou processador) e a quantos tokens por segundo. É o jeito de saber se
 * uma placa sem ROCm (ex.: RX 580) está mesmo sendo usada pelo Vulkan do Ollama.
 */
async function testarAceleracao({ host, modelo, buscar = (...a) => fetch(...a), gpus = [] }) {
  const pedir = (caminho, corpo) => buscar(`${String(host).replace(/\/$/, '')}${caminho}`, { method: corpo ? 'POST' : 'GET', body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(180000) }).then((r) => r.json());
  const r = await pedir('/api/generate', { model: modelo, prompt: 'Conte de 1 a 40, separando com vírgulas.', stream: false, think: false, options: { num_ctx: 16384, num_predict: 120 } });
  if (r.error) throw new Error(r.error);
  const ps = await pedir('/api/ps');
  const m = (ps.models || []).find((x) => x.name === modelo || x.model === modelo) || {};
  const naPlaca = m.size ? Math.round((100 * (m.size_vram || 0)) / m.size) : 0;
  const tokensPorSegundo = r.eval_count && r.eval_duration ? Math.round(r.eval_count / (r.eval_duration / 1e9)) : null;
  const amd = gpus.some((g) => /amd|radeon/i.test(g.nome));
  let veredito;
  if (naPlaca >= 90) veredito = `rodando na placa de vídeo (${naPlaca}%), ${tokensPorSegundo} tokens por segundo`;
  else if (naPlaca >= 10) veredito = `dividido: ${naPlaca}% na placa e o resto no processador, ${tokensPorSegundo} tokens por segundo — um modelo menor caberia inteiro e ficaria mais rápido`;
  else veredito = `rodando só no processador (${tokensPorSegundo} tokens por segundo): a placa de vídeo não está sendo usada. ${amd ? 'Em placa AMD sem ROCm (como a RX 580), o Ollama usa o Vulkan: atualize o driver da AMD (Adrenalin) e o Ollama (em Componentes) e teste de novo.' : 'Atualize o driver da placa e o Ollama (em Componentes) e teste de novo.'}`;
  // placa lenta (17/10, RX 580: 8 minutos numa pergunta): o ajuste que mais ajuda é pesquisar e escrever menos
  if (tokensPorSegundo && tokensPorSegundo < 25) veredito += ` Placa lenta para IA: em Ajustes → Geral, Profundidade "rápido" e Tipo de resposta "direta" deixam cada resposta várias vezes mais rápida.`;
  return { modelo, naPlaca, tokensPorSegundo, carregouEmS: r.load_duration ? Math.round(r.load_duration / 1e8) / 10 : null, veredito };
}

/**
 * Esfera neural (20/10): o modo Alto desenha em WebGL com bloom a 45 quadros por segundo, na mesma
 * placa que o Ollama usa para gerar a resposta. Em hardware fraco ela vem DESLIGADA (o usuário liga
 * em Ajustes → Geral, se quiser): sem placa de vídeo com pelo menos 4 GB, ou uma AMD antiga
 * (RX 580 e afins, que rodam o modelo pelo Vulkan e já estão no limite).
 */
function esferaRecomendada(computador = {}) {
  const vram = Number(computador.vramGB) || 0;
  const gpus = computador.gpus || [];
  if (!gpus.length || vram < 4) return { modo: 'off', motivo: 'sem placa de vídeo com pelo menos 4 GB, a esfera neural disputaria a placa com o modelo de IA' };
  if (placaAntiga(gpus, vram)) return { modo: 'off', motivo: 'a placa de vídeo é de uma geração antiga e já fica no limite com o modelo de IA' };
  return { modo: 'alto', motivo: '' };
}

module.exports = { esferaRecomendada, testarAceleracao, placaAntiga, PLACA_AMD_ANTIGA, verificarComputador, detectarGpus, lerGpusNvidiaSmi, lerGpusDoRegistro, recomendarModelos, espacoLivreGB, pastaDosModelos, MODELOS, EMBEDDING };
