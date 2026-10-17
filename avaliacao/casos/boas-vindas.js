'use strict';

/**
 * Tela de boas-vindas (15/10): verificador de hardware, recomendação de
 * modelos e instalação do Ollama (com dublês no lugar do winget e do download).
 */

const v = require('../../src/verificador-de-hardware');
const { instalarOllama, versaoMaisNova, versoesDoOllama } = require('../../src/instalador-ollama');

module.exports = [
  {
    nome: 'boas-vindas: placa de vídeo pelo nvidia-smi e pelo registro do Windows (NVIDIA, AMD, Intel); adaptador genérico e repetido saem; sem placa, lista vazia',
    tipo: 'unidade',
    async executar() {
      const smi = v.lerGpusNvidiaSmi('NVIDIA GeForce RTX 3060 Ti, 8192\r\nNVIDIA GeForce RTX 4090, 24564\n');
      const reg = v.lerGpusDoRegistro('AMD Radeon RX 7800 XT|17163091968\nMicrosoft Basic Display Adapter|0\nIntel(R) UHD Graphics|1073741824\nAMD Radeon RX 7800 XT|17163091968\n');
      const semNvidia = await v.detectarGpus({ plataforma: 'win32', executar: async (cmd) => (cmd === 'nvidia-smi' ? null : 'AMD Radeon RX 6600|8573157376\n') });
      const nada = await v.detectarGpus({ plataforma: 'linux', executar: async () => null });
      return [
        smi.length === 2 && smi[0].vramGB === 8 && smi[1].vramGB === 24 || `nvidia-smi: ${JSON.stringify(smi)}`,
        reg.length === 2 && reg[0].vramGB === 16 && reg[1].nome.startsWith('Intel') || `registro: ${JSON.stringify(reg)}`,
        semNvidia.length === 1 && semNvidia[0].nome === 'AMD Radeon RX 6600' && semNvidia[0].vramGB === 8 || `sem nvidia-smi, cai no registro: ${JSON.stringify(semNvidia)}`,
        nada.length === 0 || 'sem placa: vazio',
      ];
    },
  },
  {
    nome: 'boas-vindas: recomendação pelo hardware — VRAM decide quando há placa (27B / 9B / 4B), RAM quando não há (2B / 0.8B); placa de 3 a 4,5 GB → 2B; sempre com o nomic-embed-text; avisa disco curto e falta de placa',
    tipo: 'unidade',
    executar() {
      const r = (hw) => v.recomendarModelos(hw);
      const pc = r({ vramGB: 8, ramTotalGB: 32, discoLivreGB: 90 });
      const semDisco = r({ vramGB: 8, ramTotalGB: 32, discoLivreGB: 5 });
      const semPlaca = r({ vramGB: 0, ramTotalGB: 16 });
      return [
        r({ vramGB: 24, ramTotalGB: 64 }).principal.nome === 'qwen3.5:27b' || '24 GB → 27B',
        pc.principal.nome === 'qwen3.5:9b' && pc.avisos.length === 0 || `8 GB → 9B sem aviso: ${pc.principal.nome} ${pc.avisos}`,
        r({ vramGB: 6, ramTotalGB: 16 }).principal.nome === 'qwen3.5:4b' || '6 GB → 4B',
        semPlaca.principal.nome === 'qwen3.5:2b' && semPlaca.avisos.some((a) => /processador/.test(a)) || 'sem placa, 16 GB → 2B no processador (mais rápido, mesma nota do 4B), com aviso',
        r({ vramGB: 4, ramTotalGB: 16 }).principal.nome === 'qwen3.5:2b' || 'placa de 3 a 4,5 GB → 2B inteiro nela',
        r({ vramGB: 0, ramTotalGB: 8 }).principal.nome === 'qwen3.5:2b' && r({ vramGB: 0, ramTotalGB: 4 }).principal.nome === 'qwen3.5:0.8b' || 'pouca RAM → 2B / 0.8B',
        pc.embedding.nome === 'nomic-embed-text' && pc.downloadTotalGB === 6.9 || `embedding e total: ${pc.downloadTotalGB}`,
        semDisco.avisos.some((a) => /pouco espaço/.test(a)) || 'disco curto avisa',
        !pc.alternativas.some((m) => m.nome === pc.principal.nome) && pc.alternativas.length === 4 || 'alternativas sem o principal',
      ];
    },
  },
  {
    nome: 'boas-vindas: instalar o Ollama — winget primeiro; winget falhou → baixa o instalador oficial e roda em modo silencioso; Mac/Linux devolvem as instruções; depois liga o Ollama',
    tipo: 'unidade',
    async executar() {
      const chamadas = [];
      const progresso = [];
      const ok = await instalarOllama({
        plataforma: 'win32',
        emitir: (p) => progresso.push(p.fase),
        ligar: async () => ({ ok: true }),
        deps: { executar: async (cmd, args) => (chamadas.push([cmd, args.join(' ')]), { codigo: 0, saida: 'Successfully installed' }) },
      });
      const baixados = [];
      const semWinget = await instalarOllama({
        plataforma: 'win32',
        ligar: async () => ({ ok: true }),
        deps: {
          executar: async (cmd, args) => (cmd === 'winget' ? { codigo: -1, saida: 'winget não encontrado' } : (chamadas.push([cmd, args.join(' ')]), { codigo: 0, saida: '' })),
          baixar: async (url, destino, aoProgredir) => (baixados.push(url), aoProgredir(100, 1), require('fs').writeFileSync(destino, 'x'), destino),
        },
      });
      const naoLigou = await instalarOllama({ plataforma: 'win32', ligar: async () => ({ ok: false }), deps: { executar: async () => ({ codigo: 0, saida: '' }) } });
      const mac = await instalarOllama({ plataforma: 'darwin' });
      return [
        ok.ok && ok.via === 'winget' && chamadas[0][0] === 'winget' && /Ollama\.Ollama/.test(chamadas[0][1]) && progresso.includes('ligando') || `winget: ${JSON.stringify(ok)} ${JSON.stringify(chamadas[0])}`,
        semWinget.ok && semWinget.via === 'instalador' && baixados[0] === 'https://ollama.com/download/OllamaSetup.exe' && /\/VERYSILENT/.test(chamadas[chamadas.length - 1][1]) || `instalador: ${JSON.stringify(semWinget)}`,
        naoLigou.ok === false && /não respondeu/.test(naoLigou.texto) || 'instalado mas não ligou: avisa',
        mac.manual === true && /ollama\.com\/download/.test(mac.texto) || 'Mac: instruções',
      ];
    },
  },
  {
    nome: 'componentes: versão do Ollama instalada × a mais recente do GitHub; "atualizar" usa winget upgrade; sem internet, nada é oferecido',
    tipo: 'unidade',
    async executar() {
      const resposta = (dados) => ({ ok: true, json: async () => dados });
      const buscar = (instalada, ultima) => async (url) => (/api\/version$/.test(url) ? resposta({ version: instalada }) : resposta({ tag_name: ultima }));
      const velha = await versoesDoOllama('http://127.0.0.1:11434/', { buscar: buscar('0.40.1', 'v0.40.5') });
      const igual = await versoesDoOllama('http://h', { buscar: buscar('0.40.5', 'v0.40.5') });
      const semRede = await versoesDoOllama('http://h', { buscar: async () => { throw new Error('offline'); } });
      const chamadas = [];
      await instalarOllama({ plataforma: 'win32', atualizar: true, ligar: async () => ({ ok: true }), deps: { executar: async (cmd, args) => (chamadas.push(args[0]), { codigo: 0, saida: '' }) } });
      return [
        versaoMaisNova('0.40.10', '0.40.9') && versaoMaisNova('v1.0', '0.99.9') && !versaoMaisNova('0.40.1', '0.40.1') && !versaoMaisNova('0.39', '0.40') || 'compara número a número',
        velha.atualizar === true && velha.instalada === '0.40.1' && velha.disponivel === '0.40.5' || `desatualizado: ${JSON.stringify(velha)}`,
        igual.atualizar === false || 'em dia: nada a oferecer',
        semRede.atualizar === false && semRede.disponivel === null || 'sem rede: não oferece',
        chamadas[0] === 'upgrade' || `winget upgrade: ${chamadas[0]}`,
      ];
    },
  },
];
