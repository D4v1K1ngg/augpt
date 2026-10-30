'use strict';

/**
 * "Baixa esse vídeo <link>", "baixa a música Bohemian Rhapsody em MP3", "Jarvis, baixa essa música" (30/10, pedido do
 * Davi). O código reconhece o pedido, lê o link (ou procura no YouTube) e responde com o cartão ```midia: miniatura,
 * título, duração e os botões "Vídeo" e "Só o áudio". Quem baixa é o processo principal, quando você clica
 * (src/midia.js) — sem link, ele MOSTRA o que achou antes, para não baixar a música errada.
 */

const fs = require('fs');
const path = require('path');
const { YtDlp } = require('../ytdlp');
const imagens = require('../tools/imagens');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const VERBO = /(?<![a-z])(baix(a|e|ar|ar o|ar a)|fa(c|z|ca) (o )?download|download d|salv(a|e|ar) (o|a|esse|essa|este|esta) (video|musica|audio|clipe))(?![a-z])/;
const MIDIA = /(?<![a-z])(videos?|musicas?|audios?|mp3|mp4|clipes?|faixas?|cancao|cancoes|podcasts?|episodios?|som)(?![a-z])/;
const AUDIO = /(?<![a-z])(musicas?|audios?|mp3|cancao|cancoes|faixas?|podcasts?|som|so o audio)(?![a-z])/;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;
// o que não é vídeo nem música ("baixar o modelo", "baixa o preço", "baixar o ollama")
const NAO_E_MIDIA = /(?<![a-z])(modelo|ollama|programa|aplicativo|app|driver|jogo|atualizacao|preco|arquivo|pdf|planilha|imagem|foto|componente|qwen|llama|whisper)(?![a-z])/;

/** { url?, consulta?, tipo: 'audio' | 'video' | null } ou null. */
function pedidoDeMidia(texto) {
  const original = String(texto || '').trim();
  const t = semAcento(original);
  if (!VERBO.test(t)) return null;
  const url = URL_RE.exec(original)?.[0]?.replace(/[.,;!?]+$/, '');
  if (!url && (!MIDIA.test(t) || NAO_E_MIDIA.test(t))) return null;
  // dúvida, não pedido ("como baixar música do YouTube?", "dá pra baixar vídeo do Instagram?") — sem link, a pesquisa responde
  if (!url && /^\s*(como|onde|da pra|da para|e possivel|tem como|qual|quais|por que|porque|e legal|pode(m)?|posso|devo)\b/.test(t)) return null;
  const tipo = AUDIO.test(t) ? 'audio' : /(?<![a-z])(videos?|mp4|clipes?)(?![a-z])/.test(t) ? 'video' : null;
  if (url) return { url, tipo };
  // a busca: o pedido sem o verbo, as palavras de mídia e o enchimento
  const consulta = original
    .replace(/^\s*(ei|ok|hey)?\s*(jarvis|gpt|augpt)[,!.]?\s*/i, '')
    .replace(/\b(baix(a|e|ar)|fa[cç]a o download d[aeo]s?|download d[aeo]s?|pra mim|para mim|por favor|aqui|ai|aí)\b/gi, ' ')
    .replace(/\b(a|o|as|os|um|uma|essa|esse|esta|este|do|da|de|no|na|em|pelo|pela|youtube)\b/gi, ' ')
    .replace(/\b(m[uú]sicas?|v[ií]deos?|[aá]udios?|mp3|mp4|clipes?|faixas?|can[cç][aã]o|can[cç][oõ]es|podcasts?|epis[oó]dios?|som)\b/gi, ' ')
    .replace(/[?!.,;"'“”]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return consulta.length >= 2 ? { consulta, tipo } : null;
}

async function responderMidia({ pedido, deps = {}, config = {}, pasta, dirImagens }) {
  const en = config.idiomaEfetivo === 'en';
  const componentes = path.join(pasta || '', 'componentes');
  const yt = new YtDlp(componentes);
  const responder = (texto) => {
    deps.emit?.('resposta-token', { pedaco: texto });
    return { ...SEM_PESQUISA, texto, modo: 'midia' };
  };
  if (!yt.instalado()) {
    return responder(en
      ? 'To download videos and music, install yt-dlp first in **Settings → Components** (18 MB). Then ask again.'
      : 'Para baixar vídeos e músicas, instale antes o **yt-dlp** em **Ajustes → Componentes** (18 MB). Depois é só pedir de novo.');
  }
  const comFfmpeg = fs.existsSync(path.join(componentes, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  let itens = [];
  try {
    if (pedido.url) {
      const { Midia } = require('../midia');
      const info = await new Midia({ ytdlp: yt.caminho, pasta: '' }).info(pedido.url);
      itens = [info];
    } else {
      deps.emit?.('ferramenta', { nome: 'buscar_no_youtube', argumentos: { consulta: pedido.consulta }, risco: 'leitura' });
      itens = (await yt.buscarVideos(pedido.consulta, 3)).map((v) => ({ url: v.url, titulo: v.titulo, canal: v.canal, duracao: v.duracao, miniatura: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` }));
    }
  } catch (err) {
    const mudou = require('../ytdlp').pareceMudancaDoYouTube(err.message);
    return responder(en
      ? `I couldn't read that${pedido.url ? ' link' : ' search'}: ${err.message}.${mudou ? ' YouTube may have changed — update yt-dlp in Settings → Components.' : ''}`
      : `Não consegui ler ${pedido.url ? 'esse link' : 'essa busca'}: ${err.message}.${mudou ? ' O YouTube pode ter mudado — atualize o yt-dlp em Ajustes → Componentes.' : ''}`);
  }
  if (!itens.length) return responder(en ? `I found nothing on YouTube for "${pedido.consulta}".` : `Não achei nada no YouTube para "${pedido.consulta}".`);
  // as miniaturas guardadas pelo app (a tela só mostra imagem guardada: augpt-img://)
  const fotos = dirImagens ? await imagens.comLimite(Promise.all(itens.map((i) => (i.miniatura ? imagens.guardarImagem(i.miniatura, { dir: dirImagens, config }).catch(() => null) : null))), 8000, []) : [];
  const bloco = {
    idioma: en ? 'en' : 'pt',
    tipo: pedido.tipo,
    ffmpeg: comFfmpeg,
    itens: itens.map((i, n) => ({ url: i.url, titulo: i.titulo, canal: i.canal, duracao: i.duracao, img: fotos[n] || null })),
  };
  const frase = pedido.url
    ? (en ? `Found it: **${itens[0].titulo}**${itens[0].canal ? ` — ${itens[0].canal}` : ''}. Choose how to download:` : `Achei: **${itens[0].titulo}**${itens[0].canal ? ` — ${itens[0].canal}` : ''}. Escolha como baixar:`)
    : (en ? `I found these on YouTube for "${pedido.consulta}" — choose which one and how:` : `Achei estes no YouTube para "${pedido.consulta}" — escolha qual baixar e como:`);
  return responder(`${frase}\n\n\`\`\`midia\n${JSON.stringify(bloco)}\n\`\`\``);
}

module.exports = { pedidoDeMidia, responderMidia };
