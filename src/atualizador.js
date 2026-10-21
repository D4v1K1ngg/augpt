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
const RELEASES = `https://api.github.com/repos/${REPO}/releases/latest`;

/** "v0.28.0" é mais nova que "0.27.0"? (só números; "-beta" e afins são ignorados) */
function maisNova(nova, atual) {
  const partes = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [a, b] = [partes(nova), partes(atual)];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** O que o latest.yml diz do instalador: nome, SHA-512 (base64) e tamanho. */
function lerLatestYml(texto) {
  const t = String(texto || '');
  const caminho = /^path:\s*(\S+)\s*$/m.exec(t)?.[1];
  const sha512 = /^sha512:\s*(\S+)\s*$/m.exec(t)?.[1];
  const tamanho = Number(/^\s+size:\s*(\d+)\s*$/m.exec(t)?.[1]) || null;
  return caminho && sha512 ? { caminho, sha512, tamanho } : null;
}

const pedir = (buscar, url, ms) => buscar(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'AuGPT', Accept: 'application/vnd.github+json' } });

/** A versão publicada mais nova e se ela é mais nova que a instalada. */
async function verificar({ atual, buscar = (...a) => fetch(...a) } = {}) {
  const r = await pedir(buscar, RELEASES, 10000);
  if (r.status === 404) return { disponivel: false, atual, versao: null, motivo: 'nenhuma versão publicada ainda' };
  if (!r.ok) throw new Error(`o GitHub respondeu HTTP ${r.status}`);
  const j = await r.json();
  const url = (teste) => j.assets?.find((a) => teste(a.name))?.browser_download_url || null;
  const versao = String(j.tag_name || '').replace(/^v/, '');
  return {
    atual,
    versao,
    disponivel: maisNova(versao, atual),
    notas: String(j.body || '').slice(0, 4000),
    pagina: j.html_url || `https://github.com/${REPO}/releases`,
    instalador: url((n) => /\.exe$/i.test(n)),
    latestYml: url((n) => n === 'latest.yml'),
  };
}

/** Baixa o instalador da versão, confere SHA-512 e tamanho e devolve o caminho do .exe. */
async function baixar(info, { dir, buscar = (...a) => fetch(...a), emitir = () => {} } = {}) {
  if (!info?.instalador || !info?.latestYml) throw new Error('esta versão não tem o instalador do Windows publicado');
  const yml = lerLatestYml(await (await pedir(buscar, info.latestYml, 15000)).text());
  if (!yml) throw new Error('não consegui ler o latest.yml da versão');
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
