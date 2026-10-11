'use strict';

/**
 * Fase 2 (facilidade de uso, 2026-09-23) — primeira execução e ajuste pelo
 * hardware. A interface em si não roda na bancada; aqui fica testada toda a
 * decisão por trás dela (src/primeiro-uso.js) e a procura do Ollama fora do
 * PATH (src/ollama-runtime.js).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pu = require('../../src/primeiro-uso');
const { Config } = require('../../src/config');
const { localizarBinario, caminhosConhecidosDoOllama } = require('../../src/ollama-runtime');

const MODELOS = [
  { name: 'nomic-embed-text:latest', family: 'nomic-bert' },
  { name: 'llama3.1:8b', family: 'llama' },
  { name: 'mxbai-embed-large:latest', family: 'bert' },
  { name: 'qwen2.5:7b', family: 'qwen2' },
];

module.exports = [
  {
    nome: 'primeiro uso: modelos de embedding nunca aparecem como modelo de conversa (antes o nomic-embed-text podia virar o principal)',
    tipo: 'unidade',
    executar() {
      const { conversa, embedding } = pu.separarModelos(MODELOS);
      return [
        JSON.stringify(conversa.map((m) => m.name)) === JSON.stringify(['llama3.1:8b', 'qwen2.5:7b']) ||
          `conversa veio ${JSON.stringify(conversa.map((m) => m.name))}`,
        embedding.length === 2 || `embedding veio ${embedding.length}`,
        pu.ehModeloDeEmbedding('all-minilm') === true || 'all-minilm deveria ser embedding pelo nome',
        pu.ehModeloDeEmbedding({ name: 'modelo-qualquer', family: 'nomic-bert' }) === true || 'família nomic-bert não foi reconhecida',
        pu.ehModeloDeEmbedding('llama3.2:3b') === false || 'llama3.2 marcado como embedding',
      ];
    },
  },

  {
    nome: 'primeiro uso: modelo recomendado pela memória TOTAL (8 GB → 3B, 16 GB → 8B, 32 GB → 14B)',
    tipo: 'unidade',
    executar() {
      return [
        pu.recomendarModelo(7.8).nome === 'llama3.2:3b' || `8 GB recomendou ${pu.recomendarModelo(7.8).nome}`,
        pu.recomendarModelo(15.9).nome === 'llama3.1:8b' || `16 GB recomendou ${pu.recomendarModelo(15.9).nome}`,
        pu.recomendarModelo(31.9).nome === 'qwen2.5:14b' || `32 GB recomendou ${pu.recomendarModelo(31.9).nome}`,
        pu.recomendarModelo(0).nome === 'llama3.2:3b' || 'memória desconhecida deveria ir pro mais leve',
        typeof pu.recomendarModelo(16).downloadGB === 'number' || 'faltou o tamanho do download pra mostrar na tela',
      ];
    },
  },

  {
    nome: 'primeiro uso: diagnóstico aponta o passo certo (sem Ollama → desligado → sem modelo → pronto)',
    tipo: 'unidade',
    executar() {
      const semOllama = pu.diagnosticarPrimeiroUso({ online: false, binarioEncontrado: false, ramTotalGB: 16 });
      const desligado = pu.diagnosticarPrimeiroUso({ online: false, binarioEncontrado: true, ramTotalGB: 16 });
      const soEmbedding = pu.diagnosticarPrimeiroUso({ online: true, modelos: [MODELOS[0]], ramTotalGB: 16 });
      const pronto = pu.diagnosticarPrimeiroUso({ online: true, modelos: MODELOS, ramTotalGB: 16 });
      return [
        semOllama.etapa === 'sem-ollama' || `sem Ollama deu ${semOllama.etapa}`,
        desligado.etapa === 'ollama-desligado' || `desligado deu ${desligado.etapa}`,
        soEmbedding.etapa === 'sem-modelo' || `só com embedding deu ${soEmbedding.etapa} (embedding não conversa)`,
        soEmbedding.temEmbedding === true || 'não reconheceu que o embedding já está baixado',
        pronto.etapa === 'pronto' || `com modelos deu ${pronto.etapa}`,
        semOllama.recomendado.nome === 'llama3.1:8b' || 'recomendação não veio junto do diagnóstico',
      ];
    },
  },

  {
    nome: 'primeiro uso: padrões leves só em computador com pouca memória, e só numa instalação nova',
    tipo: 'unidade',
    executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-primeiro-uso-'));
      try {
        const nova = new Config(dir);
        const eraNova = nova.novo;
        nova.save({ model: 'x' });
        const existente = new Config(dir);
        return [
          JSON.stringify(pu.padroesPorHardware(8)) === JSON.stringify({ numCtx: 8192, criacaoAutomaticaDeSkills: false }) ||
            `8 GB deu ${JSON.stringify(pu.padroesPorHardware(8))}`,
          JSON.stringify(pu.padroesPorHardware(16)) === '{}' || '16 GB não deveria mudar nada',
          JSON.stringify(pu.padroesPorHardware(0)) === '{}' || 'memória desconhecida não deveria mudar nada',
          eraNova === true || 'Config sem config.json não se marcou como instalação nova',
          existente.novo === false || 'Config com config.json existente se marcou como nova (mexeria em quem já usa)',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    nome: 'ajustes: "Restaurar padrões" volta os ajustes mas preserva pasta, modelo, rotinas, MCP e domínios',
    tipo: 'unidade',
    executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-restaurar-'));
      try {
        const config = new Config(dir);
        config.save({
          workspace: '/minha/pasta', model: 'llama3.1:8b', temperature: 1.7, numCtx: 4096, autonomy: 'manual',
          nivelRaciocinio: 'extremo', permitirRedeLocal: true, agendamentos: [{ id: 'a1' }],
          mcpServidores: [{ nome: 'git' }], dominiosPersonalizados: [{ dominio: 'x.com' }], alwaysAllow: ['gerar_pdf'],
        });
        const r = config.restaurarPadroes({ numCtx: 8192 });
        const relido = new Config(dir).data;
        return [
          r.temperature === 0.4 && r.autonomy === 'guiado' && r.nivelRaciocinio === 'leve' || 'ajustes não voltaram ao padrão',
          r.profundidadePesquisa === 'normal' || 'campo derivado do nível não foi recalculado',
          r.permitirRedeLocal === false && JSON.stringify(r.alwaysAllow) === '[]' || 'liberações de segurança não voltaram ao padrão',
          r.numCtx === 8192 || 'padrões de hardware (extras) não foram aplicados por cima',
          r.workspace === '/minha/pasta' && r.model === 'llama3.1:8b' || 'apagou a pasta de trabalho ou o modelo escolhido',
          r.agendamentos.length === 1 && r.mcpServidores.length === 1 && r.dominiosPersonalizados.length === 1 ||
            'apagou rotinas, servidores MCP ou domínios marcados',
          relido.temperature === 0.4 && relido.workspace === '/minha/pasta' || 'não gravou no config.json',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    nome: 'primeiro uso: erros técnicos viram frase com o que fazer (modelo ausente, Ollama fora, falta de memória)',
    tipo: 'unidade',
    executar() {
      const modelo = pu.mensagemAmigavel('Ollama 404: {"error":"model \\"llama3.1\\" not found, try pulling it first"}');
      const fora = pu.mensagemAmigavel(new Error('fetch failed'));
      const memoria = pu.mensagemAmigavel('Ollama 500: {"error":"model requires more system memory (9.1 GiB) than is available (6.2 GiB)"}');
      return [
        /"llama3\.1" não está baixado/.test(modelo || '') || `modelo ausente virou ${modelo}`,
        /parou de responder/.test(fora || '') || `fetch failed virou ${fora}`,
        /Faltou memória/.test(memoria || '') || `falta de memória virou ${memoria}`,
        pu.mensagemAmigavel('algo que ninguém conhece') === null || 'erro desconhecido deveria voltar null (mostra o original)',
      ];
    },
  },

  {
    nome: 'primeiro uso: Ollama instalado fora do PATH é encontrado pelos caminhos do instalador',
    tipo: 'unidade',
    executar() {
      const win = caminhosConhecidosDoOllama({ plataforma: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' } });
      // fixture que já existe na bancada e responde a "--version" como o Ollama
      const fixture = path.join(__dirname, '..', 'fixtures', 'servidor-ollama-falso.js');
      const comando = process.execPath;
      const achou = localizarBinario('comando-que-nao-existe-augpt', { caminhos: ['/caminho/que/nao/existe', comando] });
      return [
        win[0] === 'C:\\Users\\x\\AppData\\Local\\Programs\\Ollama\\ollama.exe' || `caminho Windows veio ${win[0]}`,
        caminhosConhecidosDoOllama({ plataforma: 'darwin' }).some((c) => c.includes('Ollama.app')) || 'faltou o caminho do app no macOS',
        fs.existsSync(fixture) || 'fixture sumiu',
        achou.encontrado === true && achou.comando === comando || `não achou pelo caminho conhecido: ${JSON.stringify(achou)}`,
        localizarBinario('comando-que-nao-existe-augpt').encontrado === false ||
          'comando de teste inexistente, sem caminhos, deveria continuar não encontrado',
      ];
    },
  },
];
