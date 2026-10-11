'use strict';

/**
 * Quadro "onde está rodando cada modelo" (pedido do Davi, 2026-10-10): o
 * modelo principal e o nomic-embed-text deveriam estar na GPU; o Tev1
 * (roteador) e o copiloto dedicado, na CPU, pra não disputar a VRAM.
 *
 * Fonte: GET /api/ps do Ollama (`ollama.psModels`), que diz, para cada
 * modelo carregado agora, o tamanho total e quanto está na VRAM —
 * sizeVram === 0 → 100% CPU; sizeVram === size → 100% GPU; entre os dois →
 * dividido (não coube inteiro na placa). Função pura: a tela (renderer) e o
 * registro de cada execução usam a mesma montagem.
 */

/** "tev1" casa com "tev1:latest"; "qwen2.5:7b" só com ele mesmo. */
function mesmoModelo(a, b) {
  const n = (x) => String(x || '').trim().toLowerCase().replace(/:latest$/, '');
  return Boolean(a && b) && n(a) === n(b);
}

function ondeEsta(m) {
  if (!m) return null;
  const size = Number(m.size) || 0;
  const vram = Number(m.sizeVram) || 0;
  if (!size) return { onde: vram ? 'GPU' : 'CPU', gpuPct: vram ? 100 : 0 };
  const gpuPct = Math.round((vram / size) * 100);
  if (gpuPct >= 99) return { onde: 'GPU', gpuPct: 100 };
  if (gpuPct <= 1) return { onde: 'CPU', gpuPct: 0 };
  return { onde: 'GPU+CPU', gpuPct };
}

/** Os papéis que a configuração atual usa, com onde cada um DEVERIA rodar. */
function papeisDaConfig(config = {}) {
  const papeis = [];
  const add = (papel, modelo, esperado, nota = '') => {
    if (!modelo) return;
    // o mesmo modelo em dois papéis (ex.: decisão = principal) aparece uma vez, com os dois nomes
    const ja = papeis.find((p) => mesmoModelo(p.modelo, modelo));
    if (ja) {
      ja.papel += ` + ${papel}`;
      return;
    }
    papeis.push({ papel, modelo, esperado, nota });
  };
  add('principal', config.model, 'GPU');
  add('decisão', config.modelDecisao, 'GPU');
  add('redação', config.modelRedacao, 'GPU');
  add('memória (embedding)', config.embedModel, 'GPU');
  if (config.roteadorDecisor) add('roteador (Tev1)', config.modeloDecisor || 'tev1', 'CPU', 'use um Modelfile com PARAMETER num_gpu 0 (ex.: tev1-cpu)');
  if (config.roteadorDecisor) add('roteador rápido', config.modeloDecisorRapido, 'CPU', 'use um Modelfile com PARAMETER num_gpu 0 (ex.: tev1-0.8b-cpu)');
  if (config.copiloto2Modo === 'doisModelos') add('copiloto dedicado', config.modelCopiloto2, 'CPU');
  return papeis;
}

/**
 * `carregados`: saída de `ollama.psModels`. Devolve uma linha por papel
 * configurado (carregado ou não) + uma por modelo carregado que nenhum papel
 * usa (outro programa, ou um modelo trocado nos ajustes).
 */
function montarQuadroDeModelos({ config = {}, carregados = [] } = {}) {
  const linhas = [];
  const usados = new Set();
  for (const p of papeisDaConfig(config)) {
    const m = carregados.find((c) => mesmoModelo(c.name, p.modelo));
    if (m) usados.add(m.name);
    const local = ondeEsta(m);
    let situacao;
    if (!m) situacao = 'ocioso';
    else if (local.onde === p.esperado) situacao = 'ok';
    else situacao = 'atencao';
    linhas.push({
      papel: p.papel,
      modelo: m?.name || p.modelo,
      carregado: Boolean(m),
      onde: local?.onde || null,
      gpuPct: local ? local.gpuPct : null,
      tamanhoMB: m ? Math.round((Number(m.size) || 0) / 1048576) : null,
      esperado: p.esperado,
      situacao,
      dica:
        situacao === 'atencao'
          ? p.esperado === 'CPU'
            ? `está na ${local.onde}, deveria estar na CPU — ${p.nota || 'carregue com num_gpu 0'}`
            : `está ${local.onde === 'CPU' ? 'só na CPU' : 'dividido entre GPU e CPU'} — fica bem mais lento; feche outros modelos ou reduza a janela de contexto`
          : situacao === 'ocioso'
            ? 'não carregado agora (o Ollama carrega na primeira chamada e descarrega depois de alguns minutos parado)'
            : '',
    });
  }
  for (const m of carregados) {
    if (usados.has(m.name)) continue;
    const local = ondeEsta(m);
    linhas.push({
      papel: 'outro',
      modelo: m.name,
      carregado: true,
      onde: local.onde,
      gpuPct: local.gpuPct,
      tamanhoMB: Math.round((Number(m.size) || 0) / 1048576),
      esperado: null,
      situacao: 'outro',
      dica: 'carregado, mas não é usado pela configuração atual do AuGPT (ocupa memória)',
    });
  }
  return linhas;
}

/** Uma linha de texto por modelo, para o relatório da execução. */
function resumoDoQuadro(linhas = []) {
  return linhas.map((l) => {
    const onde = l.carregado ? `${l.onde}${l.onde === 'GPU+CPU' ? ` (${l.gpuPct}% na GPU)` : ''}` : 'não carregado';
    const marca = l.situacao === 'ok' ? '✓' : l.situacao === 'atencao' ? '⚠' : '·';
    return `${marca} ${l.papel}: ${l.modelo} — ${onde}${l.esperado ? ` (esperado: ${l.esperado})` : ''}`;
  });
}

module.exports = { montarQuadroDeModelos, papeisDaConfig, ondeEsta, mesmoModelo, resumoDoQuadro };
