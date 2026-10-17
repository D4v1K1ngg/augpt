'use strict';

/**
 * Download de modelo do Ollama com reserva (17/10, PC com RX 580: o download
 * pelo app falhou e só funcionou pelo PowerShell, com `ollama pull`).
 *
 * 1. Pela API (/api/pull), até 3 tentativas — o Ollama guarda o que já baixou,
 *    então cada tentativa continua de onde a anterior parou. A conexão cai à
 *    toa: rede que oscila, ou o Node desistindo depois de 5 min sem dados.
 * 2. Se ainda falhar, o próprio programa `ollama pull` (o que funcionou no
 *    terminal), com o progresso dele lido da saída.
 * O erro que sobrar é o real, não só "fetch failed".
 */

const { spawn } = require('child_process');
const { montarComando } = require('./comando');

/** "pulling 8eeb52dfb3bb:  45% ▕████   ▏ 2.1 GB/4.7 GB" → { porcento: 45, status } */
function lerLinhaDoPull(linha) {
  // tira os códigos de cor e a animação de espera (⠋⠙⠹…) do terminal
  const texto = String(linha || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/[\u2800-\u28ff]/g, '').trim();
  if (!texto) return null;
  const pct = /(\d{1,3})%/.exec(texto);
  return { status: texto.replace(/[▕▏█▉▊▋▌▍▎▏ ]{3,}/g, ' ').slice(0, 120), porcento: pct ? Math.min(100, Number(pct[1])) : null };
}

function pullPeloPrograma(comando, nome, { host, onProgress = () => {} } = {}) {
  return new Promise((ok, falha) => {
    const env = { ...process.env, ...(host ? { OLLAMA_HOST: host } : {}) };
    const p = spawn(...montarComando(comando, ['pull', nome]), { env, windowsHide: true });
    let ultima = '';
    const ler = (pedaco) => {
      for (const linha of String(pedaco).split(/[\r\n]+/)) {
        const l = lerLinhaDoPull(linha);
        if (!l) continue;
        ultima = l.status;
        onProgress({ status: l.status, porcento: l.porcento });
      }
    };
    p.stdout.on('data', ler);
    p.stderr.on('data', ler);
    p.on('error', falha);
    p.on('close', (codigo) => (codigo === 0 ? ok({ status: 'success', via: 'programa' }) : falha(new Error(ultima || `ollama pull terminou com código ${codigo}`))));
  });
}

/**
 * @param deps.pull     pullModel da API (src/llm/ollama.js)
 * @param deps.localizar localizarBinario (src/ollama-runtime.js)
 */
async function baixarModelo(nome, { host, onProgress = () => {}, tentativas = 3, esperaMs = 3000, deps = {} } = {}) {
  const pull = deps.pull || require('./llm/ollama').pullModel;
  const localizar = deps.localizar || require('./ollama-runtime').localizarBinario;
  const programa = deps.programa || pullPeloPrograma;
  // Ollama desligado (ex.: logo depois de instalar): liga e espera responder
  const ligar = deps.ligar || (() => require('./ollama-runtime').localizarEIniciar(host));
  let ligou = false;
  const ligarSeCaiu = async (err) => {
    if (ligou || !/fetch failed|ECONNREFUSED|connect|socket|Nenhuma conex/i.test(err.message)) return;
    ligou = true;
    onProgress({ status: 'o Ollama não respondeu — ligando…' });
    await Promise.resolve(ligar()).catch(() => {});
  };
  const erros = [];
  for (let i = 1; i <= tentativas; i += 1) {
    try {
      return { ...(await pull({ host, name: nome, onProgress })), via: 'api' };
    } catch (err) {
      erros.push(err.message);
      if (/file does not exist|not found|manifest unknown|pull model manifest: file/i.test(err.message)) {
        throw new Error(`o modelo "${nome}" não existe no catálogo do Ollama — confira o nome (ex.: qwen3.5:4b)`);
      }
      await ligarSeCaiu(err);
      if (i < tentativas) {
        onProgress({ status: `a conexão caiu (${err.message.slice(0, 80)}); tentando de novo (${i + 1}/${tentativas}) — continua de onde parou…` });
        await new Promise((ok) => setTimeout(ok, esperaMs * i));
      }
    }
  }
  if (!ligou) await ligarSeCaiu(new Error(erros[erros.length - 1] || ''));
  const bin = localizar();
  if (!bin?.encontrado) throw new Error(`o download falhou ${tentativas} vezes: ${erros[erros.length - 1]}`);
  onProgress({ status: 'tentando pelo programa do Ollama (ollama pull)…' });
  try {
    return await programa(bin.comando, nome, { host, onProgress });
  } catch (err) {
    throw new Error(`o download falhou pela conexão (${erros[erros.length - 1]}) e pelo programa do Ollama (${err.message})`);
  }
}

module.exports = { baixarModelo, lerLinhaDoPull, pullPeloPrograma };
