'use strict';

/**
 * Atualizar o próprio AuGPT (21/10, pedido do Davi). As versões saem como Releases do GitHub
 * (github.com/D4v1K1ngg/augpt), publicadas pelo .github/workflows/lancamento.yml a cada tag v*.
 * O app só confere e avisa; baixar e instalar é no clique do usuário. O instalador baixado tem o
 * SHA-512 e o tamanho conferidos contra o latest.yml da mesma versão (gerado pelo electron-builder)
 * antes de rodar; os dados do usuário (conversas, ajustes, modelos) ficam onde estão.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'D4v1K1ngg/augpt';
// o latest.yml da Release mais nova é um download comum do GitHub: sem o limite de 60 consultas
// por hora da API (que vale por endereço de internet e acabava em provedores que dividem o IP)
const BASE = `https://github.com/${REPO}/releases`;

/** "v0.28.0" é mais nova que "0.27.0"? (só números; "-beta" e afins são ignorados) */
function maisNova(nova, atual) {
  const partes = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [a, b] = [partes(nova), partes(atual)];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** O que o latest.yml diz: versão e o instalador (nome, SHA-512 em base64, tamanho). */
function lerLatestYml(texto) {
  const t = String(texto || '');
  const versao = /^version:\s*['"]?([^\s'"]+)/m.exec(t)?.[1];
  const caminho = /^path:\s*(\S+)\s*$/m.exec(t)?.[1];
  const sha512 = /^sha512:\s*(\S+)\s*$/m.exec(t)?.[1];
  const tamanho = Number(/^\s+size:\s*(\d+)\s*$/m.exec(t)?.[1]) || null;
  return versao && caminho && sha512 ? { versao, caminho, sha512, tamanho } : null;
}

const pedir = (buscar, url, ms) => buscar(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'AuGPT' }, redirect: 'follow' });

/** A versão publicada mais nova e se ela é mais nova que a instalada. */
async function verificar({ atual, buscar = (...a) => fetch(...a) } = {}) {
  const r = await pedir(buscar, `${BASE}/latest/download/latest.yml`, 15000);
  if (r.status === 404) return { disponivel: false, atual, versao: null, motivo: 'nenhuma versão publicada ainda' };
  if (!r.ok) throw new Error(`o GitHub respondeu HTTP ${r.status}`);
  const yml = lerLatestYml(await r.text());
  if (!yml) throw new Error('não consegui ler o latest.yml da versão mais nova');
  const tag = `v${yml.versao}`;
  return {
    atual,
    versao: yml.versao,
    disponivel: maisNova(yml.versao, atual),
    pagina: `${BASE}/tag/${tag}`,
    instalador: `${BASE}/download/${tag}/${yml.caminho}`,
    yml,
  };
}

/** Baixa o instalador da versão, confere SHA-512 e tamanho e devolve o caminho do .exe. */
async function baixar(info, { dir, buscar = (...a) => fetch(...a), emitir = () => {} } = {}) {
  const yml = info?.yml;
  if (!info?.instalador || !yml) throw new Error('esta versão não tem o instalador do Windows publicado');
  emitir({ texto: `Baixando o AuGPT ${info.versao}…`, porcento: 0 });
  const r = await pedir(buscar, info.instalador, 15 * 60 * 1000);
  if (!r.ok) throw new Error(`download falhou (HTTP ${r.status})`);
  const total = Number(r.headers.get('content-length')) || yml.tamanho || 0;
  const pedacos = [];
  let recebido = 0;
  let ultimo = -1;
  for await (const p of r.body) {
    pedacos.push(Buffer.from(p));
    recebido += p.length;
    const pct = total ? Math.floor((recebido / total) * 100) : 0;
    if (pct !== ultimo) emitir({ texto: `Baixando o AuGPT ${info.versao}… ${pct}%`, porcento: (ultimo = pct) });
  }
  const binario = Buffer.concat(pedacos);
  if (yml.tamanho && binario.length !== yml.tamanho) throw new Error('o tamanho do arquivo baixado não confere com o publicado — nada foi instalado');
  if (crypto.createHash('sha512').update(binario).digest('base64') !== yml.sha512) throw new Error('o SHA-512 do instalador não confere com o publicado — nada foi instalado');
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, path.basename(yml.caminho));
  fs.writeFileSync(arquivo, binario);
  emitir({ texto: 'Download conferido ✓ — abrindo o instalador…', porcento: 100 });
  return arquivo;
}

module.exports = { REPO, maisNova, lerLatestYml, verificar, baixar };
