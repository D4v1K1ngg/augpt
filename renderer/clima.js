'use strict';

/**
 * Cartão do clima (23/10): o bloco ```clima da resposta (src/agent/clima-no-chat.js) vira um cartão
 * com o agora, as horas do dia escolhido e os 7 dias (clicar num dia troca as horas e o detalhe).
 * O JSON é só dado: tudo entra por textContent.
 */
(function (global) {
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  };
  const TEXTOS = {
    pt: { hoje: 'Hoje', amanha: 'Amanhã', sensacao: 'Sensação', umidade: 'Umidade', vento: 'Vento', nascer: 'Nascer do sol', por: 'Pôr do sol', uv: 'UV máx.', chuva: 'Chuva', atualizado: 'atualizado às', fonte: 'Dados: Open-Meteo' },
    en: { hoje: 'Today', amanha: 'Tomorrow', sensacao: 'Feels like', umidade: 'Humidity', vento: 'Wind', nascer: 'Sunrise', por: 'Sunset', uv: 'Max UV', chuva: 'Rain', atualizado: 'updated at', fonte: 'Data: Open-Meteo' },
  };

  function criar(spec) {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    const en = s.idioma === 'en';
    const T = TEXTOS[en ? 'en' : 'pt'];
    const locale = en ? 'en-US' : 'pt-BR';
    const dias = Array.isArray(s.dias) ? s.dias : [];
    const horas = s.horas || {};
    let foco = Math.min(Number(s.foco) || 0, Math.max(0, dias.length - 1));

    const raiz = el('div', 'clima');
    raiz.dataset.semTraducao = '';

    const topo = el('div', 'clima-topo');
    topo.append(el('b', 'clima-local', s.local), el('span', 'clima-hora', s.hora ? `${T.atualizado} ${String(s.hora).slice(11, 16)}` : ''));

    const a = s.agora || {};
    const agora = el('div', 'clima-agora');
    const info = el('div', 'clima-agora-info');
    info.append(
      el('div', 'clima-desc', a.desc ? a.desc[0].toUpperCase() + a.desc.slice(1) : ''),
      el('div', 'clima-extras', [`${T.sensacao} ${a.sens}°`, `${T.umidade} ${a.umid}%`, `${T.vento} ${a.vento} km/h`].join(' · '))
    );
    agora.append(el('span', 'clima-ico-grande', a.ico), el('span', 'clima-temp', `${a.t}°`), info);

    const faixaHoras = el('div', 'clima-horas');
    const detalhe = el('div', 'clima-detalhe');
    const listaDias = el('div', 'clima-dias');
    const menor = Math.min(...dias.map((d) => d.min));
    const maior = Math.max(...dias.map((d) => d.max));
    const nomeDoDia = (d, i) => (i === 0 ? T.hoje : i === 1 ? T.amanha : new Date(`${d.d}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''));

    function pintarHoras() {
      faixaHoras.textContent = '';
      const dia = dias[foco];
      if (!dia) return;
      const agoraHora = String(s.hora || '').slice(0, 13);
      // hoje: as próximas 24 horas (à noite, entra a madrugada de amanhã); outro dia: as 24 horas dele
      let vistas = 0;
      (horas.t || []).forEach((t, i) => {
        if (foco === 0 ? t.slice(0, 13) < agoraHora || vistas >= 24 : !t.startsWith(dia.d)) return;
        vistas += 1;
        const item = el('div', `clima-h${t.slice(0, 13) === agoraHora ? ' clima-h-agora' : ''}`);
        const prob = horas.prob?.[i];
        item.append(el('span', 'clima-h-hora', t.slice(11, 16)), el('span', 'clima-h-ico', horas.ico?.[i]), el('b', 'clima-h-temp', `${horas.temp?.[i]}°`), el('span', 'clima-h-prob', prob ? `${prob}%` : ''));
        faixaHoras.append(item);
      });
      faixaHoras.scrollLeft = 0;
      const partes = [`${T.nascer} ${dia.nasce}`, `${T.por} ${dia.poe}`];
      if (dia.uv != null) partes.push(`${T.uv} ${Math.round(dia.uv)}`);
      if (dia.mm) partes.push(`${T.chuva} ${dia.mm.toLocaleString(locale)} mm`);
      detalhe.textContent = '';
      detalhe.append(el('b', '', `${nomeDoDia(dia, foco)} · ${dia.desc}`), el('span', '', ` — ${partes.join(' · ')}`));
    }

    function pintarDias() {
      listaDias.textContent = '';
      dias.forEach((d, i) => {
        const b = el('button', `clima-dia${i === foco ? ' clima-dia-foco' : ''}`);
        b.type = 'button';
        const barra = el('span', 'clima-barra');
        const preenchido = el('span', 'clima-barra-cheia');
        const total = Math.max(1, maior - menor);
        preenchido.style.left = `${((d.min - menor) / total) * 100}%`;
        preenchido.style.right = `${((maior - d.max) / total) * 100}%`;
        barra.append(preenchido);
        b.append(el('span', 'clima-dia-nome', nomeDoDia(d, i)), el('span', 'clima-dia-ico', d.ico), el('span', 'clima-dia-prob', d.prob ? `💧${d.prob}%` : ''), el('span', 'clima-dia-min', `${d.min}°`), barra, el('span', 'clima-dia-max', `${d.max}°`));
        b.title = d.desc;
        b.addEventListener('click', () => {
          foco = i;
          pintarDias();
          pintarHoras();
        });
        listaDias.append(b);
      });
    }

    raiz.append(topo, agora, faixaHoras, detalhe, listaDias, el('div', 'clima-fonte', T.fonte));
    pintarDias();
    pintarHoras();
    return raiz;
  }

  global.clima = { criar };
})(window);
