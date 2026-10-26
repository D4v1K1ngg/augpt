'use strict';

/**
 * Mapa e globo das respostas (23/10, bloco 4): o bloco ```mapa (src/agent/mapa-no-chat.js) vira um
 * globo da MapLibre que gira até o lugar, ou a rota desenhada (carro, a pé, bicicleta). Os pedaços
 * do mapa vêm por augpt-mapa:// (src/mapa-tiles.js). O JSON é só dado: textos por textContent.
 * Cada mapa usa um contexto WebGL e o Chromium segura poucos: o mapa só existe enquanto o cartão
 * está perto da tela; longe dela, some e volta quando o cartão reaparece.
 */
(function (global) {
  const LIB = 'vendor/maplibre-gl-5.24.0/'; // cópia dos 3 arquivos que a tela usa (BSD-3, ver LICENSE.txt)
  if (global.maplibregl?.setWorkerUrl) global.maplibregl.setWorkerUrl(`${LIB}maplibre-gl-csp-worker.js`);

  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  };
  const TEXTOS = {
    pt: { mapa: 'Mapa', satelite: 'Satélite', ampliar: 'Ampliar', fechar: 'Fechar', carro: 'Carro', pe: 'A pé', bike: 'Bicicleta', semRota: 'sem rota', reta: 'em linha reta', semMapa: 'O mapa não abriu neste computador (WebGL indisponível).' },
    en: { mapa: 'Map', satelite: 'Satellite', ampliar: 'Expand', fechar: 'Close', carro: 'Car', pe: 'Walk', bike: 'Bike', semRota: 'no route', reta: 'straight line', semMapa: 'The map could not open on this computer (WebGL unavailable).' },
  };
  const ICONES = { carro: '🚗', pe: '🚶', bike: '🚲' };
  const duracao = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`);
  const km = (v, locale) => `${v < 10 ? v.toLocaleString(locale, { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString(locale)} km`;

  // montado na hora de desenhar (26/10): o celular define AUGPT_MAPA depois deste script carregar
  const estilo = () => ({
    version: 8,
    projection: { type: 'globe' },
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
    sources: {
      // a base dos pedaços: no PC, augpt-mapa://; no celular (26/10), a página do AuGPT na rede (AUGPT_MAPA)
      osm: { type: 'raster', tiles: [`${global.AUGPT_MAPA || 'augpt-mapa://'}osm/{z}/{x}/{y}`], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
      sat: { type: 'raster', tiles: [`${global.AUGPT_MAPA || 'augpt-mapa://'}sat/{z}/{x}/{y}`], tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless — <a href="https://s2maps.eu">s2maps.eu</a> by EOX (Copernicus Sentinel data 2016)' },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
      { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
    ],
  });

  function marcador(texto, classe) {
    const m = el('div', `mapa-pino ${classe || ''}`, texto);
    return m;
  }

  function criar(spec) {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    const en = s.idioma === 'en';
    const T = TEXTOS[en ? 'en' : 'pt'];
    const locale = en ? 'en-US' : 'pt-BR';
    const ehRota = s.tipo === 'rota';
    let modo = s.modo || 'carro';
    let camada = 'osm';
    let mapa = null;
    let sumir = null;

    const raiz = el('div', 'mapa-cartao');
    raiz.dataset.semTraducao = '';
    const topo = el('div', 'mapa-topo');
    const titulo = el('div', 'mapa-titulo');
    if (ehRota) titulo.append(el('b', '', s.origem?.nome), el('span', 'mapa-seta', ' → '), el('b', '', s.destino?.nome));
    else titulo.append(el('b', '', s.lugar?.nome), el('span', 'mapa-onde', s.lugar?.onde ? ` · ${s.lugar.onde}` : ''));
    const botoes = el('div', 'mapa-botoes');
    const bCamada = el('button', 'mapa-botao', T.satelite);
    bCamada.type = 'button';
    const bAmpliar = el('button', 'mapa-botao', T.ampliar);
    bAmpliar.type = 'button';
    botoes.append(bCamada, bAmpliar);
    topo.append(titulo, botoes);

    const area = el('div', 'mapa-area');
    raiz.append(topo, area);

    // rota: uma aba por modo, com o tempo e a distância
    const abas = el('div', 'mapa-modos');
    if (ehRota) {
      for (const m of ['carro', 'pe', 'bike']) {
        const r = s.rotas?.[m];
        const b = el('button', `mapa-modo${m === modo ? ' mapa-modo-ativo' : ''}`);
        b.type = 'button';
        b.disabled = !r;
        b.append(el('span', 'mapa-modo-ico', ICONES[m]), el('span', 'mapa-modo-nome', T[m]), el('b', '', r ? duracao(r.min) : T.semRota), el('span', 'mapa-modo-km', r ? km(r.km, locale) : ''));
        b.addEventListener('click', () => {
          modo = m;
          abas.querySelectorAll('.mapa-modo').forEach((x) => x.classList.toggle('mapa-modo-ativo', x === b));
          desenharRota(true);
        });
        abas.append(b);
      }
      if (s.reta) abas.append(el('span', 'mapa-reta', `${km(s.reta, locale)} ${T.reta}`));
      raiz.append(abas);
    }

    function limites(pontos) {
      const b = new global.maplibregl.LngLatBounds(pontos[0], pontos[0]);
      pontos.forEach((p) => b.extend(p));
      return b;
    }

    function desenharRota(animar) {
      if (!mapa?.isStyleLoaded()) return;
      const r = s.rotas?.[modo];
      const linha = r?.linha?.length ? r.linha : [[s.origem.lon, s.origem.lat], [s.destino.lon, s.destino.lat]];
      const dados = { type: 'Feature', geometry: { type: 'LineString', coordinates: linha }, properties: {} };
      if (mapa.getSource('rota')) mapa.getSource('rota').setData(dados);
      else {
        mapa.addSource('rota', { type: 'geojson', data: dados });
        mapa.addLayer({ id: 'rota-borda', type: 'line', source: 'rota', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a1406', 'line-width': 7, 'line-opacity': 0.55 } });
        mapa.addLayer({ id: 'rota', type: 'line', source: 'rota', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e0b04f', 'line-width': 4 } });
      }
      mapa.setPaintProperty('rota', 'line-dasharray', r ? [1, 0] : [2, 2]);
      mapa.fitBounds(limites(linha), { padding: 50, duration: animar ? 1200 : 0, maxZoom: 15 });
    }

    function abrirMapa() {
      if (mapa || !global.maplibregl) return;
      clearTimeout(sumir);
      try {
        const alvo = ehRota ? [s.origem.lon, s.origem.lat] : [s.lugar.lon, s.lugar.lat];
        mapa = new global.maplibregl.Map({
          container: area,
          style: estilo(),
          center: alvo,
          zoom: 1.4,
          attributionControl: { compact: true },
          fadeDuration: 0,
        });
      } catch {
        area.textContent = T.semMapa;
        area.classList.add('mapa-erro');
        return;
      }
      mapa.addControl(new global.maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      mapa.addControl(new global.maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      if (camada === 'sat') trocarCamada(true);
      mapa.on('load', () => {
        if (camada === 'sat') trocarCamada(true);
        if (ehRota) {
          new global.maplibregl.Marker({ element: marcador('A', 'mapa-pino-a') }).setLngLat([s.origem.lon, s.origem.lat]).addTo(mapa);
          new global.maplibregl.Marker({ element: marcador('B', 'mapa-pino-b') }).setLngLat([s.destino.lon, s.destino.lat]).addTo(mapa);
          setTimeout(() => desenharRota(true), 250);
        } else {
          new global.maplibregl.Marker({ color: '#e0b04f' }).setLngLat([s.lugar.lon, s.lugar.lat]).addTo(mapa);
          // do globo até o lugar, como no Google Earth
          const bb = s.lugar.bbox;
          setTimeout(() => {
            // essential: a viagem do globo até o lugar é o recurso (com "reduzir animações" no Windows, a MapLibre pulava)
            if (bb && bb[2] - bb[0] > 0.02) mapa.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 40, duration: 3500, maxZoom: 16, essential: true });
            else mapa.flyTo({ center: [s.lugar.lon, s.lugar.lat], zoom: 15, duration: 3500, essential: true });
          }, 400);
        }
      });
    }

    function fecharMapa() {
      if (!mapa) return;
      mapa.remove();
      mapa = null;
      area.textContent = '';
    }

    function trocarCamada(ja) {
      if (!ja) camada = camada === 'osm' ? 'sat' : 'osm';
      bCamada.textContent = camada === 'osm' ? T.satelite : T.mapa;
      if (!mapa?.isStyleLoaded()) return;
      mapa.setLayoutProperty('osm', 'visibility', camada === 'osm' ? 'visible' : 'none');
      mapa.setLayoutProperty('sat', 'visibility', camada === 'sat' ? 'visible' : 'none');
      // o satélite gratuito (10 m por pixel) vai até o nível de bairro; mais perto, fica borrado
      if (camada === 'sat' && !ja && mapa.getZoom() > 13) mapa.easeTo({ zoom: 13, duration: 800 });
    }
    bCamada.addEventListener('click', () => trocarCamada(false));

    // ampliar: o cartão vai para o fim do <body> (fora das camadas do chat) e ocupa a janela;
    // um marcador guarda o lugar dele na conversa. Esc, o fundo ou o botão volta.
    const fundo = el('div', 'mapa-fundo');
    const lugarNoChat = el('div', 'mapa-lugar');
    function ampliar(sim) {
      if (sim === raiz.classList.contains('mapa-grande')) return;
      if (sim) {
        lugarNoChat.style.height = `${raiz.offsetHeight}px`;
        raiz.replaceWith(lugarNoChat);
        document.body.append(fundo, raiz);
      } else {
        fundo.remove();
        lugarNoChat.replaceWith(raiz);
      }
      raiz.classList.toggle('mapa-grande', sim);
      bAmpliar.textContent = sim ? T.fechar : T.ampliar;
      setTimeout(() => mapa?.resize(), 50);
    }
    bAmpliar.addEventListener('click', () => ampliar(!raiz.classList.contains('mapa-grande')));
    fundo.addEventListener('click', () => ampliar(false));
    // Esc fecha o ampliado: um ouvinte só para a tela toda (revisão de 25/10 — antes, um por cartão, que nunca saía)
    raiz.fecharAmpliado = () => ampliar(false);

    // o mapa só existe perto da tela (contexto WebGL é limitado)
    const vigia = new IntersectionObserver((itens) => {
      for (const i of itens) {
        if (i.isIntersecting) abrirMapa();
        else if (mapa && !raiz.classList.contains('mapa-grande')) {
          clearTimeout(sumir);
          sumir = setTimeout(() => {
            if (!raiz.isConnected || !raiz.classList.contains('mapa-grande')) fecharMapa();
          }, 30000);
        }
        if (!raiz.isConnected) {
          fecharMapa();
          vigia.disconnect();
        }
      }
    }, { rootMargin: '300px 0px' });
    vigia.observe(raiz);
    return raiz;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelector('.mapa-cartao.mapa-grande')?.fecharAmpliado?.();
  });

  global.mapa = { criar };
})(window);
