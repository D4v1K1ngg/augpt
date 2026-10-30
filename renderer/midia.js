'use strict';

/**
 * Cartão de download (30/10, pedido do Davi): o bloco ```midia da resposta (src/agent/midia-no-chat.js) vira uma
 * lista de vídeos — miniatura, título, canal e duração — com os botões "Vídeo" e "Só o áudio". O download é feito
 * pelo processo principal (api.midia), com a barra de progresso aqui, e no fim "Abrir" e "Mostrar na pasta".
 * O JSON é só dado: tudo entra por textContent.
 */
(function (global) {
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  };
  const T = {
    pt: { video: 'Vídeo', videoHd: 'Vídeo (até 1080p)', audio: 'Só o áudio (MP3)', audioM4a: 'Só o áudio (M4A)', cancelar: 'Cancelar', abrir: 'Abrir', pasta: 'Mostrar na pasta', pronto: 'Baixado', erro: 'Não deu certo', semFf: 'Para vídeo em 1080p e áudio em MP3, instale o ffmpeg (87 MB).', instalarFf: 'Instalar o ffmpeg', instalandoFf: 'Instalando o ffmpeg…', ffPronto: 'ffmpeg instalado ✓ — 1080p e MP3 liberados', aviso: 'Baixe só o que você tem direito: seus vídeos, conteúdo livre (Creative Commons) ou cópia para uso pessoal, quando a lei permitir.', baixando: 'baixando', juntando: 'juntando vídeo e áudio', convertendo: 'convertendo para MP3' },
    en: { video: 'Video', videoHd: 'Video (up to 1080p)', audio: 'Audio only (MP3)', audioM4a: 'Audio only (M4A)', cancelar: 'Cancel', abrir: 'Open', pasta: 'Show in folder', pronto: 'Downloaded', erro: 'It did not work', semFf: 'For 1080p video and MP3 audio, install ffmpeg (87 MB).', instalarFf: 'Install ffmpeg', instalandoFf: 'Installing ffmpeg…', ffPronto: 'ffmpeg installed ✓ — 1080p and MP3 enabled', aviso: 'Only download what you have the right to: your own videos, free content (Creative Commons) or a personal copy where the law allows.', baixando: 'downloading', juntando: 'merging video and audio', convertendo: 'converting to MP3' },
  };
  const duracaoTexto = (s) => {
    const n = Number(s) || 0;
    if (!n) return '';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const ss = String(Math.floor(n % 60)).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const tamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  // progresso que chega do processo principal, pelo id de cada download
  const ouvintes = new Map();
  let contador = 0;

  function criar(spec) {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    const L = T[s.idioma === 'en' ? 'en' : 'pt'];
    let comFfmpeg = s.ffmpeg === true;
    const raiz = el('div', 'midia');
    raiz.dataset.semTraducao = '';
    const botoesDeTodos = [];

    for (const item of (Array.isArray(s.itens) ? s.itens : []).slice(0, 5)) {
      const linha = el('div', 'midia-item');
      const foto = el('div', 'midia-foto');
      if (item.img && /^augpt-img:\/\//.test(item.img)) {
        const img = el('img');
        img.src = item.img;
        img.alt = '';
        img.loading = 'lazy';
        foto.append(img);
      }
      if (item.duracao) foto.append(el('span', 'midia-duracao', duracaoTexto(item.duracao)));
      const corpo = el('div', 'midia-corpo');
      corpo.append(el('div', 'midia-titulo', item.titulo || item.url), el('div', 'midia-canal', item.canal || ''));
      const acoes = el('div', 'midia-acoes');
      const progresso = el('div', 'midia-progresso');
      progresso.hidden = true;
      const barra = el('i');
      const rotulo = el('span');
      progresso.append(el('div', 'midia-barra'), rotulo);
      progresso.firstChild.append(barra);

      const botao = (texto, tipo) => {
        const b = el('button', tipo === (s.tipo || 'video') ? 'btn-primario' : 'btn-secundario', texto);
        b.type = 'button';
        b.addEventListener('click', () => baixar(tipo));
        return b;
      };
      const bVideo = botao(comFfmpeg ? L.videoHd : L.video, 'video');
      const bAudio = botao(comFfmpeg ? L.audio : L.audioM4a, 'audio');
      botoesDeTodos.push({ bVideo, bAudio });
      acoes.append(bVideo, bAudio);

      async function baixar(tipo) {
        const id = `m${Date.now()}-${(contador += 1)}`;
        acoes.replaceChildren();
        const cancelar = el('button', 'btn-linha', L.cancelar);
        cancelar.type = 'button';
        cancelar.addEventListener('click', () => api.midia.cancelar(id));
        acoes.append(cancelar);
        progresso.hidden = false;
        barra.style.width = '2%';
        rotulo.textContent = `${L.baixando}…`;
        ouvintes.set(id, ({ porcento, texto }) => {
          if (typeof porcento === 'number') barra.style.width = `${Math.max(2, porcento)}%`;
          const etapa = texto === 'juntando vídeo e áudio' ? L.juntando : texto === 'convertendo para MP3' ? L.convertendo : L.baixando;
          rotulo.textContent = typeof porcento === 'number' && etapa === L.baixando ? `${etapa} ${porcento.toFixed(0)}%` : `${etapa}…`;
        });
        const r = await api.midia.baixar({ id, url: item.url, tipo }).catch((err) => ({ ok: false, error: err.message }));
        ouvintes.delete(id);
        acoes.replaceChildren();
        if (r.ok) {
          barra.style.width = '100%';
          rotulo.textContent = `${L.pronto} ✓ — ${r.nome} (${tamanho(r.bytes || 0)})`;
          const abrir = el('button', 'btn-secundario', L.abrir);
          abrir.type = 'button';
          abrir.addEventListener('click', () => api.midia.abrir(id));
          const pasta = el('button', 'btn-linha', L.pasta);
          pasta.type = 'button';
          pasta.addEventListener('click', () => api.midia.mostrar(id));
          acoes.append(abrir, pasta);
        } else {
          progresso.hidden = true;
          const erro = el('span', 'midia-erro', `${L.erro}: ${r.error || ''}`);
          acoes.append(botao(comFfmpeg ? L.videoHd : L.video, 'video'), botao(comFfmpeg ? L.audio : L.audioM4a, 'audio'), erro);
        }
      }

      linha.append(foto, corpo);
      corpo.append(acoes, progresso);
      raiz.append(linha);
    }

    // sem o ffmpeg: o convite para instalar (um clique, aqui mesmo)
    if (!comFfmpeg) {
      const dica = el('div', 'midia-ffmpeg');
      const texto = el('span', '', L.semFf);
      const instalar = el('button', 'btn-linha', L.instalarFf);
      instalar.type = 'button';
      instalar.addEventListener('click', async () => {
        instalar.disabled = true;
        texto.textContent = L.instalandoFf;
        const r = await api.componentes.instalarFfmpeg().catch((err) => ({ ok: false, error: err.message }));
        if (r.ok) {
          comFfmpeg = true;
          texto.textContent = L.ffPronto;
          instalar.remove();
          for (const { bVideo, bAudio } of botoesDeTodos) {
            bVideo.textContent = L.videoHd;
            bAudio.textContent = L.audio;
          }
        } else {
          texto.textContent = `${L.erro}: ${r.error || ''}`;
          instalar.disabled = false;
        }
      });
      dica.append(texto, instalar);
      raiz.append(dica);
    }
    raiz.append(el('div', 'midia-aviso', L.aviso));
    return raiz;
  }

  if (typeof manipuladores !== 'undefined') {
    manipuladores['midia-progresso'] = (d = {}) => ouvintes.get(d.id)?.(d);
  }
  global.midia = { criar };
})(window);
