'use strict';

/**
 * Faxina dos caches (revisão de 25/10): duas pastas cresciam sem limite — os pedaços do mapa
 * (22 MB e 1.046 arquivos em um dia) e as fotos das respostas (97 MB em 5 semanas). Roda uma vez,
 * pouco depois de abrir o app, em segundo plano:
 * - mapa: apaga os pedaços sem uso há mais de 30 dias (voltam do OpenStreetMap se precisar);
 * - imagens: apaga as fotos com mais de 90 dias que NENHUMA conversa salva usa (as que aparecem
 *   numa conversa ficam, para ela continuar mostrando as fotos).
 */

const fsp = require('fs/promises');
const path = require('path');

const DIA = 24 * 3600 * 1000;
const NOME_DE_IMAGEM = /augpt-img:\/\/([a-z]{20,64}\.(?:jpg|png|webp))/g;

async function arquivosDe(dir) {
  const saida = [];
  const andar = async (d) => {
    let itens;
    try {
      itens = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const i of itens) {
      const caminho = path.join(d, i.name);
      if (i.isDirectory()) await andar(caminho);
      else if (i.isFile()) saida.push(caminho);
    }
  };
  await andar(dir);
  return saida;
}

/** As fotos que alguma conversa salva usa (o texto delas cita `augpt-img://nome`). */
async function imagensEmUso(dirConversas) {
  const usadas = new Set();
  for (const arquivo of await arquivosDe(dirConversas)) {
    if (!arquivo.endsWith('.json')) continue;
    try {
      for (const m of (await fsp.readFile(arquivo, 'utf8')).matchAll(NOME_DE_IMAGEM)) usadas.add(m[1]);
    } catch {
      // conversa ilegível: segue
    }
  }
  return usadas;
}

async function faxina({ userData, agora = Date.now(), diasDoMapa = 30, diasDasImagens = 90 } = {}) {
  const resultado = { mapa: 0, imagens: 0, bytes: 0 };
  const apagar = async (arquivo, info, tipo) => {
    try {
      await fsp.unlink(arquivo);
      resultado[tipo] += 1;
      resultado.bytes += info.size;
    } catch {
      // em uso ou sem permissão: fica para a próxima
    }
  };
  for (const arquivo of await arquivosDe(path.join(userData, 'mapa'))) {
    const info = await fsp.stat(arquivo).catch(() => null);
    if (info && agora - info.mtimeMs > diasDoMapa * DIA) await apagar(arquivo, info, 'mapa');
  }
  // em uso: as conversas e as execuções (a janela "Visualizar execuções" mostra as respostas com fotos)
  const usadas = new Set([...(await imagensEmUso(path.join(userData, 'conversas'))), ...(await imagensEmUso(path.join(userData, 'execucoes')))]);
  const dirImagens = path.join(userData, 'imagens');
  for (const arquivo of await arquivosDe(dirImagens)) {
    const nome = path.basename(arquivo);
    if (!/^[a-z]{20,64}\.(jpg|png|webp)$/.test(nome) || usadas.has(nome)) continue;
    const info = await fsp.stat(arquivo).catch(() => null);
    if (info && agora - info.mtimeMs > diasDasImagens * DIA) await apagar(arquivo, info, 'imagens');
  }
  return resultado;
}

module.exports = { faxina, imagensEmUso };
