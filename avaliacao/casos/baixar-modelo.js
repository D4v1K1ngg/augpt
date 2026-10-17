'use strict';

/**
 * Download de modelo com reserva (17/10, PC com RX 580: o download pelo app
 * falhou e só foi pelo `ollama pull` no PowerShell). API e programa são dublês.
 */

const { baixarModelo, lerLinhaDoPull } = require('../../src/baixar-modelo');

module.exports = [
  {
    nome: 'baixar modelo: conexão que cai é tentada de novo (continua de onde parou); Ollama desligado é ligado; esgotadas as tentativas, vai pelo programa `ollama pull`; nome que não existe avisa sem insistir',
    tipo: 'unidade',
    async executar() {
      const r = [];
      // cai uma vez e depois vai
      let n = 0;
      const ok1 = await baixarModelo('qwen3.5:2b', { esperaMs: 0, deps: { pull: async () => (++n === 1 ? Promise.reject(new Error('terminated')) : { status: 'success' }), ligar: async () => {}, localizar: () => ({ encontrado: false }) } });
      r.push((ok1.via === 'api' && n === 2) || `nova tentativa: ${JSON.stringify(ok1)} ${n}`);
      // Ollama desligado: liga
      let ligou = 0;
      let m = 0;
      await baixarModelo('qwen3.5:2b', { esperaMs: 0, deps: { pull: async () => (++m === 1 ? Promise.reject(new Error('fetch failed')) : { status: 'success' }), ligar: async () => ligou++, localizar: () => ({ encontrado: false }) } });
      r.push(ligou === 1 || `ligou o Ollama: ${ligou}`);
      // a API nunca vai: programa
      const usados = [];
      const viaPrograma = await baixarModelo('qwen3.5:2b', { esperaMs: 0, deps: { pull: async () => Promise.reject(new Error('terminated')), ligar: async () => {}, localizar: () => ({ encontrado: true, comando: 'ollama' }), programa: async (cmd, nome) => (usados.push([cmd, nome]), { status: 'success', via: 'programa' }) } });
      r.push((viaPrograma.via === 'programa' && usados[0].join() === 'ollama,qwen3.5:2b') || 'reserva pelo programa');
      // nome errado: não insiste
      let tentativas = 0;
      const erro = await baixarModelo('qwen9.9:xyz', { esperaMs: 0, deps: { pull: async () => (tentativas++, Promise.reject(new Error('pull model manifest: file does not exist'))), ligar: async () => {}, localizar: () => ({ encontrado: true, comando: 'ollama' }) } }).then(() => '', (e) => e.message);
      r.push((/não existe no catálogo/.test(erro) && tentativas === 1) || `nome errado: ${erro} (${tentativas} tentativas)`);
      // tudo falha: o erro diz os dois motivos
      const ambos = await baixarModelo('qwen3.5:2b', { esperaMs: 0, deps: { pull: async () => Promise.reject(new Error('terminated')), ligar: async () => {}, localizar: () => ({ encontrado: true, comando: 'ollama' }), programa: async () => Promise.reject(new Error('sem espaço em disco')) } }).then(() => '', (e) => e.message);
      r.push((/terminated/.test(ambos) && /sem espaço em disco/.test(ambos)) || `erro final: ${ambos}`);
      return r;
    },
  },
  {
    nome: 'baixar modelo: a saída do `ollama pull` vira porcentagem e status limpos (sem barra, cor nem animação)',
    tipo: 'unidade',
    executar() {
      const a = lerLinhaDoPull('\x1b[?25lpulling 8eeb52dfb3bb:  45% ▕████████       ▏ 2.1 GB/4.7 GB  18 MB/s');
      const b = lerLinhaDoPull('pulling manifest ⠋');
      return [
        (a.porcento === 45 && !/▕|█|\x1b/.test(a.status)) || `linha com barra: ${JSON.stringify(a)}`,
        (b.status === 'pulling manifest' && b.porcento === null) || `animação: ${JSON.stringify(b)}`,
        lerLinhaDoPull('   ') === null || 'linha vazia',
      ];
    },
  },
];
