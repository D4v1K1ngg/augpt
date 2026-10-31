'use strict';

/**
 * "Jarvis, toca Bohemian Rhapsody", "toca uma música do Queen", "pausa a música", "próxima música" (31/10, pedido do
 * Davi). O código procura a música nas pastas Música, Downloads\AuGPT e Downloads (pelo nome do arquivo e das pastas
 * de cima: artista e álbum) e abre no reprodutor padrão do Windows. Só abre áudio e vídeo. Sem achar, oferece baixar
 * (o cartão de midia-no-chat.js). Pausar e pular usam as teclas de mídia, então valem para qualquer reprodutor.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const palavras = (t) => semAcento(t).replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

const AUDIO = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.wma', '.aac']);
const VIDEO = new Set(['.mp4', '.webm', '.mkv']);

const INICIO = /^\s*(?:(?:ei|ok|hey)\s+)?(?:(?:jarvis|gpt|augpt)[,!.]?\s+)?/;
const MIDIA = '(?:a |o |uma |um |alguma |algum |essa |esse )?(?:musica|som|cancao|faixa|video|clipe)';
// o que "toca" não é música: "toca no assunto", "toca um alarme", "toque de recolher"
const NAO = /^(no|na|nos|nas|em|nisso|nele|nela|de|do|da|pra|para|um alarme|o alarme|alarme|despertador|campainha|sino|ferida)\b/;

const CONTROLES = [
  ['pausar', new RegExp(`^(pausa|pausar|pause|para|parar)( ${MIDIA}| tudo)?$`)],
  ['continuar', new RegExp(`^(continua|continuar|retoma|retomar|despausa|volta a tocar|solta)( ${MIDIA})$|^(despausa|volta a tocar)$`)],
  ['proxima', new RegExp(`^(proxima|pula|pular|passa|avanca)( ${MIDIA}| essa| esse| pra proxima| para a proxima)*$|^(proxima|pula|passa) ${MIDIA}$`)],
  ['anterior', new RegExp(`^(${MIDIA} anterior|volta ${MIDIA}|volta pra ${MIDIA} anterior|volta para ${MIDIA} anterior|anterior)$`)],
];

/** { acao: 'tocar', consulta } | { acao: 'pausar' | 'continuar' | 'proxima' | 'anterior' } | null */
function pedidoDeTocar(texto) {
  const t = semAcento(texto).replace(INICIO, '').replace(/[.!?]+$/, '').replace(/^(?:o que|que|qual)\b.*/, '').replace(/\s+por favor$/, '').trim();
  for (const [acao, re] of CONTROLES) {
    // "pausa" sozinho é dúbio (a voz do AuGPT?): só vale com "música"; "próxima"/"anterior" sozinhos também
    if (re.test(t) && (acao === 'proxima' || acao === 'anterior' ? /musica|som|faixa|video|clipe/.test(t) : /musica|som|faixa|video|clipe|tudo|tocar|despausa/.test(t))) return { acao };
  }
  const m = /^(?:(?:pode|poderia|voce pode|consegue)\s+)?(?:me\s+)?(toca|toque|tocar|reproduz|reproduza|da (?:um )?play(?: em| no| na)?|bota pra tocar|bota|coloca|coloque|poe|ponha|quero ouvir)\s+(.*)$/.exec(t);
  if (!m) return null;
  let resto = m[2].replace(/\s+(pra mim|para mim|ai|aqui|agora)$/g, '').trim();
  const comPalavraDeMidia = new RegExp(`^${MIDIA}\\b`).test(resto);
  // "bota/coloca/põe/quero ouvir" só com "música" ("coloca isso numa tabela", "quero ouvir sua opinião" não são tocar)
  if (/^(bota|coloca|coloque|poe|ponha|quero ouvir)$/.test(m[1]) && !comPalavraDeMidia) return null;
  if (NAO.test(resto) || resto.split(' ').length > 10) return null;
  resto = resto
    .replace(new RegExp(`^${MIDIA}s?\\b`), ' ')
    .replace(/^\s*(do|da|de|dos|das)\b/, ' ')
    .replace(/\b(no|pelo|com o) (reprodutor|player|media player|windows)( multimidia| do windows)?\b/g, ' ')
    .replace(/\b(qualquer|aleatoria|aleatorio|ai)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { acao: 'tocar', consulta: resto };
}

function pastasDeMusica() {
  let musica = path.join(os.homedir(), 'Music');
  let downloads = path.join(os.homedir(), 'Downloads');
  try {
    const { app } = require('electron');
    if (app?.getPath) [musica, downloads] = [app.getPath('music'), app.getPath('downloads')];
  } catch {}
  return [musica, path.join(downloads, 'AuGPT'), downloads];
}

/** Os arquivos de áudio e vídeo das pastas (com limite: Downloads pode ser grande). */
function listarMidias(pastas, { limite = 5000, fundura = 4 } = {}) {
  const vistos = new Set();
  const out = [];
  const andar = (dir, nivel, raiz) => {
    if (out.length >= limite || nivel > fundura) return;
    let itens = [];
    try {
      itens = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) andar(p, nivel + 1, raiz);
      else if (it.isFile() && !vistos.has(p.toLowerCase())) {
        const ext = path.extname(it.name).toLowerCase();
        if (AUDIO.has(ext) || VIDEO.has(ext)) {
          vistos.add(p.toLowerCase());
          out.push({ arquivo: p, relativo: path.relative(raiz, p), audio: AUDIO.has(ext) });
        }
      }
      if (out.length >= limite) return;
    }
  };
  for (const raiz of pastas) andar(raiz, 0, raiz);
  return out;
}

/** A melhor para a busca: todas as palavras no nome (ou nas pastas de cima); sem busca, uma ao acaso. */
function escolherMusica(midias, consulta, sorteio = Math.random) {
  const busca = palavras(consulta).filter((p) => p.length >= 2 || /\d/.test(p));
  if (!busca.length) {
    const audios = midias.filter((m) => m.audio);
    const lista = audios.length ? audios : midias;
    return lista.length ? { escolhida: lista[Math.floor(sorteio() * lista.length)], outras: lista.length - 1, aoAcaso: true } : null;
  }
  const achadas = midias
    .map((m) => {
      const nome = palavras(path.basename(m.arquivo, path.extname(m.arquivo)));
      const tudo = new Set([...nome, ...palavras(path.dirname(m.relativo))]);
      if (!busca.every((p) => tudo.has(p) || [...tudo].some((w) => w.length >= 4 && p.length >= 4 && w.startsWith(p)))) return null;
      const noNome = busca.filter((p) => nome.includes(p)).length;
      return { m, nota: noNome * 10 + (m.audio ? 5 : 0) - nome.length * 0.1 };
    })
    .filter(Boolean)
    .sort((a, b) => b.nota - a.nota);
  if (!achadas.length) return null;
  // "toca Queen" com várias do Queen: uma delas ao acaso (é mais divertido que sempre a mesma)
  const doArtista = achadas.filter((a) => a.nota === achadas[0].nota);
  const escolhida = doArtista.length > 1 && busca.length <= 2 ? doArtista[Math.floor(sorteio() * doArtista.length)].m : achadas[0].m;
  return { escolhida, outras: achadas.length - 1, aoAcaso: false };
}

function abrirNoReprodutor(arquivo) {
  try {
    const { shell } = require('electron');
    if (shell?.openPath) return shell.openPath(arquivo).then((erro) => (erro ? Promise.reject(new Error(erro)) : undefined));
  } catch {}
  return new Promise((ok, falha) => spawn('explorer.exe', [arquivo], { detached: true, stdio: 'ignore' }).on('error', falha).on('spawn', ok).unref());
}

/**
 * O controle de mídia do Windows (o mesmo do painel de volume), não a tecla de mídia: a tecla vai para o app que o
 * Windows escolher (no teste, pausou outro app e não o Reprodutor). Aqui: pausar = o que está TOCANDO; continuar =
 * o Reprodutor (ou o último); próxima/anterior = o que está tocando, senão o Reprodutor. Devolve 'ok' ou 'nada'.
 */
const METODO = { pausar: 'TryPauseAsync', continuar: 'TryPlayAsync', proxima: 'TrySkipNextAsync', anterior: 'TrySkipPreviousAsync' };

function controlarReprodutor(acao) {
  const ps = [
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\' })[0]', // aspas simples: nas duplas, `1 é escape do PowerShell
    'function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }',
    '$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]',
    '$m = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
    '$ss = @($m.GetSessions())',
    '$tocando = @($ss | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq "Playing" })',
    '$player = @($ss | Where-Object { $_.SourceAppUserModelId -match "ZuneMusic|MediaPlayer|wmplayer" })',
    `$acao = "${acao}"`,
    '$alvos = if ($acao -eq "pausar") { $tocando } elseif ($acao -eq "continuar") { @(($player + @($m.GetCurrentSession())) | Where-Object { $_ })[0] } else { @(($tocando + $player) | Where-Object { $_ })[0] }',
    '$alvos = @($alvos | Where-Object { $_ })',
    'if (-not $alvos.Count) { "nada"; exit }',
    `foreach ($s in $alvos) { $null = Await ($s.${METODO[acao]}()) ([bool]) }`,
    '"ok"',
  ].join('\n');
  // -EncodedCommand: o script de várias linhas chega inteiro, sem as aspas do Windows no meio
  return new Promise((ok, falha) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],{ windowsHide: true, timeout: 15000 }, (err, saida) => (err ? falha(err) : ok(String(saida).trim().split(/\r?\n/).pop()))));
}

const bonito = (arquivo) => path.basename(arquivo, path.extname(arquivo)).replace(/\s*\[[^\]]*\]\s*$/, '').trim();

async function responderTocar({ pedido, deps = {}, config = {}, pasta, dirImagens, abrir = abrirNoReprodutor, tecla = controlarReprodutor, pastas = pastasDeMusica() }) {
  const en = config.idiomaEfetivo === 'en';
  const responder = (texto) => {
    deps.emit?.('resposta-token', { pedaco: texto });
    return { ...SEM_PESQUISA, texto, modo: 'tocar' };
  };
  if (process.platform !== 'win32' && !deps.emTeste) return responder(en ? 'Playing music is only available on Windows for now.' : 'Tocar música por enquanto só funciona no Windows.');
  if (pedido.acao !== 'tocar') {
    let saida;
    try {
      saida = await tecla(pedido.acao);
    } catch (err) {
      return responder(en ? `I couldn't control the player: ${err.message}` : `Não consegui controlar o reprodutor: ${err.message}`);
    }
    if (saida === 'nada') return responder(en ? 'Nothing is playing right now.' : 'Não tem nada tocando agora.');
    const feito = { pausar: ['Pausei ⏸', 'Paused ⏸'], continuar: ['Voltou a tocar ▶', 'Playing again ▶'], proxima: ['Próxima ⏭', 'Next ⏭'], anterior: ['Anterior ⏮', 'Previous ⏮'] }[pedido.acao];
    return responder(feito[en ? 1 : 0]);
  }
  deps.emit?.('ferramenta', { nome: 'procurar_musica', argumentos: { consulta: pedido.consulta || '(qualquer uma)' }, risco: 'leitura' });
  const achou = escolherMusica(listarMidias(pastas), pedido.consulta);
  if (!achou) {
    if (!pedido.consulta) return responder(en ? 'I found no music in your Music and Downloads folders. Ask me to download one: "download the song …".' : 'Não achei nenhuma música nas pastas Música e Downloads. Peça para eu baixar uma: "baixa a música …".');
    const aviso = en ? `I didn't find "${pedido.consulta}" on your PC. ` : `Não achei "${pedido.consulta}" no seu PC. `;
    // sem achar: o cartão para baixar (já em MP3); depois de baixar, é só pedir para tocar de novo
    const { YtDlp } = require('../ytdlp');
    if (!new YtDlp(path.join(pasta || '', 'componentes')).instalado()) return responder(aviso + (en ? 'To download it, install yt-dlp in **Settings → Components**.' : 'Para baixar, instale o **yt-dlp** em **Ajustes → Componentes**.'));
    deps.emit?.('resposta-token', { pedaco: aviso });
    const r = await require('./midia-no-chat').responderMidia({ pedido: { consulta: pedido.consulta, tipo: 'audio' }, deps, config, pasta, dirImagens });
    return { ...r, texto: aviso + r.texto + (en ? '\n\nOnce downloaded, ask me to play it again.' : '\n\nDepois de baixar, é só pedir para tocar de novo.') };
  }
  try {
    await abrir(achou.escolhida.arquivo);
  } catch (err) {
    return responder(en ? `I found it, but couldn't open it: ${err.message}` : `Achei, mas não consegui abrir: ${err.message}`);
  }
  const nome = bonito(achou.escolhida.arquivo);
  const extra = achou.outras > 0 ? (en ? ` (${achou.outras} more matched)` : ` (tem mais ${achou.outras} parecida${achou.outras > 1 ? 's' : ''})`) : '';
  return responder(en
    ? `🎵 ${achou.aoAcaso ? 'Picked at random: ' : 'Playing '}**${nome}**${achou.aoAcaso ? '' : extra}. Say "pause the music" or "next song" to control it.`
    : `🎵 ${achou.aoAcaso ? 'Escolhi ao acaso: ' : 'Tocando '}**${nome}**${achou.aoAcaso ? '' : extra}. Diga "pausa a música" ou "próxima música" para controlar.`);
}

module.exports = { pedidoDeTocar, listarMidias, escolherMusica, responderTocar, controlarReprodutor };
