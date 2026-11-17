'use strict';

/**
 * 17/11 (Davi: "o whisper na CPU deixa demorado", "a voz original fica mesmo após a dublagem"): o whisper com CUDA nas
 * legendas e na dublagem, com o processador de reserva; e o Demucs separa a voz do fundo para a dublagem.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BINARIO_GPU, Ditado } = require('../../src/ditado');
const { EstudioDeVoz } = require('../../src/estudio-de-voz');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'whisper na placa: o pacote CUDA 12.4 (o do 11.8 não traz o cuBLAS e caía no processador); a legenda usa a placa e refaz no processador se ela falhar',
    tipo: 'unidade',
    executar() {
      const fonte = ler('src/legendas/index.js');
      return [
        /whisper-bin-win-cuda-12\.4\.0-x64\.zip/.test(BINARIO_GPU.url) && BINARIO_GPU.sha256.length === 64 || 'o pacote CUDA 12.4, com o SHA-256',
        typeof Ditado.prototype.exeGpu === 'function' && typeof Ditado.prototype.instalarGpu === 'function' || 'o Ditado acha e instala o whisper da placa',
        /const naPlaca = Boolean\(whisper\.gpu && fs\.existsSync\(whisper\.gpu\)\);/.test(fonte) || 'usa a placa quando instalada',
        /if \(!naPlaca \|\| signal\?\.aborted \|\| !whisper\.exe\) throw err;[\s\S]{0,200}transcrever\(whisper\.exe, ' no processador'\)/.test(fonte) || 'falhou na placa: refaz no processador',
        (ler('electron/main.js').match(/whisper: \{ exe: d\.exe\(\), gpu: d\.exeGpu\(\)/g) || []).length >= 3 || 'legendas, dublagem e o Studio passam o whisper da placa',
      ];
    },
  },
  {
    nome: 'separar a voz do fundo: o Demucs no Python do OmniVoice (sem baixar outro PyTorch), o separar.py lê e grava com o soundfile; a dublagem "separado" vai sobre o fundo sem a voz original',
    tipo: 'unidade',
    executar() {
      const e = new EstudioDeVoz(path.join(os.tmpdir(), 'nao-existe-estudio'));
      const py = ler('src/estudio-de-voz/separar.py');
      const est = ler('src/estudio-de-voz/index.js');
      const dub = ler('src/dublagem/index.js');
      return [
        e.separadorInstalado() === false && typeof e.separar === 'function' && typeof e.instalarSeparador === 'function' || 'o Estúdio separa e instala o separador',
        /\['pip', 'install', '--python', this\.python\('omni'\), 'demucs'\]/.test(est) || 'instala só o demucs no Python do OmniVoice',
        /TORCH_HOME: path\.join\(this\.pasta, 'hf', 'torch'\)/.test(est) || 'o modelo fica na pasta do Estúdio',
        /sf\.read\(/.test(py) && /sf\.write\(saida_voz/.test(py) && /apply_model\(/.test(py) && !/torchaudio\.(load|save)/.test(py) || 'separar.py: soundfile, não torchaudio (quebra no 2.9+)',
        /const separado = fundo === 'separado';/.test(dub) && /'\[2:a\]aresample=48000\[f\];\[1:a\]aresample=48000\[v\];\[f\]\[v\]amix/.test(dub) || 'a dublagem vai sobre o fundo separado',
        /estudio\.separar\(leg\.video/.test(dub) || 'a dublagem chama a separação',
      ];
    },
  },
];
