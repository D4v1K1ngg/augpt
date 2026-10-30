'use strict';

/**
 * Baixar vídeos e músicas (30/10, pedido do Davi) e o componente ffmpeg (instalar, atualizar e voltar, igual ao yt-dlp).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pedidoDeMidia } = require('../../src/agent/midia-no-chat');
const { argumentosDoFormato, porcentoDaLinha, etapaDaLinha, enderecoValido } = require('../../src/midia');
const { Ffmpeg, acharBin } = require('../../src/ffmpeg');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

module.exports = [
  {
    nome: 'baixar mídia: o pedido com link ou nome vira download (vídeo ou áudio); "baixar o modelo", "baixou o preço", dúvida ("como baixar…?") e pergunta comum não',
    tipo: 'unidade',
    executar() {
      const p = (t) => pedidoDeMidia(t);
      return [
        JSON.stringify(p('Baixa esse vídeo https://www.youtube.com/watch?v=jNQXAC9IVRw')) === '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","tipo":"video"}' || JSON.stringify(p('Baixa esse vídeo https://www.youtube.com/watch?v=jNQXAC9IVRw')),
        JSON.stringify(p('baixa a música Bohemian Rhapsody em MP3')) === '{"consulta":"Bohemian Rhapsody","tipo":"audio"}' || JSON.stringify(p('baixa a música Bohemian Rhapsody em MP3')),
        p('Jarvis, baixa essa música do Queen, Bohemian Rhapsody')?.consulta === 'Queen Bohemian Rhapsody' || 'pela voz, com o nome',
        p('Faz o download desse vídeo pra mim: https://youtu.be/jNQXAC9IVRw.')?.url === 'https://youtu.be/jNQXAC9IVRw' || 'ponto final fora do link',
        p('Você consegue baixar esse vídeo https://youtu.be/jNQXAC9IVRw ?')?.url === 'https://youtu.be/jNQXAC9IVRw' || 'pergunta com link é pedido',
        ['baixar o modelo qwen3.5', 'baixou o preço da RTX?', 'Quero baixar o Ollama', 'baixe a planilha', 'Qual a melhor música do Queen?', 'Como baixar música do YouTube?', 'Dá pra baixar vídeo do Instagram?'].every((t) => p(t) === null) || 'o que não é pedido de download',
      ];
    },
  },
  {
    nome: 'baixar mídia: formatos (1080p e MP3 com ffmpeg; um arquivo só e M4A sem), progresso e etapas do yt-dlp, só endereço da web; "Mostrar na pasta" e "Abrir" só para o que o AuGPT baixou',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      return [
        argumentosDoFormato('audio', true).join(' ') === '-x --audio-format mp3 --audio-quality 0' || 'áudio MP3',
        argumentosDoFormato('audio', false).join(' ') === '-f ba[ext=m4a]/ba' || 'áudio sem ffmpeg',
        /height<=1080/.test(argumentosDoFormato('video', true).join(' ')) && argumentosDoFormato('video', true).includes('--merge-output-format') || 'vídeo 1080p',
        !argumentosDoFormato('video', false).includes('--merge-output-format') || 'sem ffmpeg não junta',
        porcentoDaLinha('[download]  45.3% of ~ 12.34MiB at 3.21MiB/s ETA 00:12') === 45.3 && porcentoDaLinha('[youtube] Extracting URL') === null || 'progresso',
        etapaDaLinha('[Merger] Merging formats into "x.mp4"') === 'juntando vídeo e áudio' && etapaDaLinha('[ExtractAudio] Destination: x.mp3') === 'convertendo para MP3' || 'etapas',
        enderecoValido('https://youtu.be/x') && !enderecoValido('file:///C:/x') && !enderecoValido('http://192.168.0.1/x') && !enderecoValido('http://localhost:3000') && !enderecoValido('calc.exe') || 'endereço',
        /const arquivo = midiaBaixada\.get\(String\(id \|\| ''\)\);[\s\S]{0,120}shell\.showItemInFolder\(arquivo\)/.test(main) || 'mostrar só o baixado',
        /\/\\\.\(mp4\|mp3\|m4a\|webm\|mkv\|opus\)\$\/i\.test\(arquivo\)/.test(main) || 'abrir só vídeo ou áudio',
        /id: 'baixar_midia'/.test(ler('src/agent/rotas-do-codigo.js')) && /'compras', 'midia'\]/.test(ler('renderer/md.js')) || 'rota e cartão',
        /Baixe só o que você tem direito/.test(ler('renderer/midia.js')) || 'aviso de direitos',
      ];
    },
  },
  {
    nome: 'ffmpeg: a versão é a data da publicação; o SHA-256 confere ou nada é trocado; a pasta bin é achada no pacote; sem Windows, "não disponível"',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ff-'));
      try {
        const release = { name: 'Latest Auto-Build (2026-10-30 19:13)', published_at: '2026-10-30T19:16:00Z', assets: [{ name: 'ffmpeg-master-latest-win64-gpl-shared.zip', size: 91226112, browser_download_url: 'https://x/z.zip' }, { name: 'checksums.sha256', browser_download_url: 'https://x/s' }] };
        const buscar = async (url) => (url.includes('api.github.com')
          ? { ok: true, json: async () => release }
          : { ok: true, arrayBuffer: async () => (url.endsWith('/s') ? Buffer.from(`${'0'.repeat(64)}  ffmpeg-master-latest-win64-gpl-shared.zip\n`) : Buffer.from('zip falso')) });
        const f = new Ffmpeg(path.join(dir, 'ffmpeg'), { plataforma: 'win32', buscar });
        const ultima = await f.ultima();
        let erro = '';
        try {
          await f.instalar();
        } catch (e) {
          erro = e.message;
        }
        fs.mkdirSync(path.join(dir, 'pacote', 'ffmpeg-master', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'pacote', 'ffmpeg-master', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'x');
        const semWindows = await new Ffmpeg(path.join(dir, 'outro'), { plataforma: 'linux', buscar }).estado();
        return [
          ultima?.versao === '2026-10-30 19:13' && ultima.megas === 87 || JSON.stringify(ultima),
          /SHA-256 do arquivo baixado não confere/.test(erro) && !fs.existsSync(path.join(dir, 'ffmpeg')) || erro,
          acharBin(path.join(dir, 'pacote')) === path.join(dir, 'pacote', 'ffmpeg-master', 'bin') || 'bin',
          semWindows.suportado === false && semWindows.instalado === false || JSON.stringify(semWindows),
          /componentes:instalarFfmpeg/.test(ler('electron/main.js')) && /componentes:voltarFfmpeg/.test(ler('electron/main.js')) && /id="btnCompFfInstalar"/.test(ler('renderer/index.html')) || 'Ajustes → Componentes',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];
