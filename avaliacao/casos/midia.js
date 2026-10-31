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

const tocar = require('../../src/agent/tocar-no-chat');

module.exports = [
  {
    nome: 'tocar música: "toca X", "quero ouvir uma música do Y", "pausa/continua a música", "próxima música" — e "toca no assunto", "pausa" sozinho, "quero ouvir sua opinião" não',
    tipo: 'unidade',
    executar() {
      const p = (t) => JSON.stringify(tocar.pedidoDeTocar(t));
      const rotas = require('../../src/agent/rotas-do-codigo');
      return [
        p('Jarvis, toca Bohemian Rhapsody') === '{"acao":"tocar","consulta":"bohemian rhapsody"}' || p('Jarvis, toca Bohemian Rhapsody'),
        p('quero ouvir uma música do Coldplay') === '{"acao":"tocar","consulta":"coldplay"}' || p('quero ouvir uma música do Coldplay'),
        p('pode tocar Imagine Dragons?') === '{"acao":"tocar","consulta":"imagine dragons"}' || 'pergunta educada',
        p('me toca uma música aleatória') === '{"acao":"tocar","consulta":""}' || 'ao acaso',
        p('Jarvis, toca Believer no reprodutor do Windows') === '{"acao":"tocar","consulta":"believer"}' || 'sem o "reprodutor"',
        ['pausa a música', 'continua a música', 'próxima música', 'pula essa música', 'música anterior'].map((t) => tocar.pedidoDeTocar(t)?.acao).join() === 'pausar,continuar,proxima,proxima,anterior' || 'controles',
        ['toca no assunto', 'pausa', 'próxima', 'quero ouvir sua opinião', 'coloca isso numa tabela', 'O que toca na rádio?', 'toca um alarme às 7'].every((t) => tocar.pedidoDeTocar(t) === null) || 'o que não é tocar',
        rotas.escolherRota({ objetivo: 'toca Paradise do Coldplay', conversa: [] })?.rota?.id === 'tocar_musica' && rotas.escolherRota({ objetivo: 'baixa a música Paradise', conversa: [] })?.rota?.id === 'baixar_midia' || 'rotas',
      ];
    },
  },
  {
    nome: 'tocar música: acha pelo nome e pela pasta do artista, prefere áudio; sem achar, o cartão para baixar; pausar sem nada tocando avisa; só áudio e vídeo entram na lista',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-tocar-'));
      try {
        fs.mkdirSync(path.join(dir, 'Queen'));
        for (const f of ['Queen/Bohemian Rhapsody.mp3', 'Queen/Under Pressure.mp3', 'Bohemian Rhapsody (clipe) [abc].mp4', 'Believer [x1].m4a', 'notas.txt', 'virus.exe']) fs.writeFileSync(path.join(dir, f), '');
        const lista = tocar.listarMidias([dir]);
        const escolha = (c) => tocar.escolherMusica(lista, c, () => 0)?.escolhida.relativo;
        const abertos = [];
        const deps = { emit: () => {}, emTeste: true };
        const tocou = await tocar.responderTocar({ pedido: { acao: 'tocar', consulta: 'believer' }, deps, pastas: [dir], abrir: async (a) => abertos.push(a) });
        const pausa = await tocar.responderTocar({ pedido: { acao: 'pausar' }, deps, pastas: [dir], tecla: async () => 'nada' });
        const proxima = await tocar.responderTocar({ pedido: { acao: 'proxima' }, deps, pastas: [dir], tecla: async () => 'ok' });
        const semYtdlp = await tocar.responderTocar({ pedido: { acao: 'tocar', consulta: 'coldplay yellow' }, deps, pastas: [dir], pasta: dir, abrir: async (a) => abertos.push(a) });
        return [
          lista.length === 4 || `lista: ${lista.map((m) => m.relativo)}`,
          escolha('bohemian rhapsody') === path.join('Queen', 'Bohemian Rhapsody.mp3') || escolha('bohemian rhapsody'),
          escolha('queen') === path.join('Queen', 'Bohemian Rhapsody.mp3') || escolha('queen'),
          escolha('coldplay') === undefined || 'não inventa',
          abertos.length === 1 && abertos[0].endsWith('Believer [x1].m4a') && /Tocando \*\*Believer\*\*/.test(tocou.texto) || tocou.texto,
          /Não tem nada tocando/.test(pausa.texto) && /Próxima/.test(proxima.texto) || `${pausa.texto} / ${proxima.texto}`,
          /Não achei "coldplay yellow" no seu PC.*yt-dlp/.test(semYtdlp.texto) && abertos.length === 1 || semYtdlp.texto,
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
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
        /id: 'baixar_midia'/.test(ler('src/agent/rotas-do-codigo.js')) && /'compras', 'midia'[,\]]/.test(ler('renderer/md.js')) || 'rota e cartão',
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
