'use strict';

/**
 * Calendário interativo das respostas (23/10): o bloco ```calendario que o código põe na resposta
 * (src/agent/calendario-no-chat.js) vira um mês navegável, com hoje, o dia pedido e os feriados
 * marcados. O JSON é só dado: lido com JSON.parse, nada dele vira HTML sem escapar.
 */
(function (global) {
  const iso = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  };
  const TEXTOS = {
    pt: { hoje: 'Hoje', anterior: 'Mês anterior', proximo: 'Próximo mês', semDatas: 'Nenhum feriado nacional neste mês.', facultativo: 'ponto facultativo', comemorativa: 'data comemorativa', dias: (n) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : n === -1 ? 'ontem' : n > 0 ? `daqui a ${n} dias` : `há ${-n} dias`) },
    en: { hoje: 'Today', anterior: 'Previous month', proximo: 'Next month', semDatas: 'No national holidays this month.', facultativo: 'optional day off', comemorativa: 'not a holiday', dias: (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`) },
  };

  function criar(spec) {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    const en = s.idioma === 'en';
    const T = TEXTOS[en ? 'en' : 'pt'];
    const locale = en ? 'en-US' : 'pt-BR';
    const datas = s.datas || {};
    const [ha, hm, hd] = String(s.hoje).split('-').map(Number);
    const hoje = new Date(ha, hm - 1, hd, 12);
    let ano = Number(s.ano) || ha;
    let mes = Number(s.mes) || hm;
    let escolhido = s.marcar || null;

    const raiz = el('div', 'cal');
    raiz.dataset.semTraducao = '';
    const topo = el('div', 'cal-topo');
    const titulo = el('b', 'cal-titulo');
    const botao = (classe, texto, rotulo, acao) => {
      const b = el('button', classe, texto);
      b.type = 'button';
      if (rotulo) b.setAttribute('aria-label', rotulo);
      b.addEventListener('click', acao);
      return b;
    };
    const ir = (delta) => {
      const d = new Date(ano, mes - 1 + delta, 1);
      ano = d.getFullYear();
      mes = d.getMonth() + 1;
      pintar();
    };
    topo.append(
      botao('cal-seta', '‹', T.anterior, () => ir(-1)),
      titulo,
      botao('cal-seta', '›', T.proximo, () => ir(1)),
      botao('cal-hoje', T.hoje, null, () => {
        ano = ha;
        mes = hm;
        escolhido = s.hoje;
        pintar();
      })
    );
    const grade = el('div', 'cal-grade');
    grade.setAttribute('role', 'grid');
    const detalhe = el('div', 'cal-detalhe');
    raiz.append(topo, grade, detalhe);

    const nomeDe = (item) => (en ? item[2] || item[0] : item[0]);
    const tipoDe = (item) => (item[1] === 'facultativo' ? ` (${T.facultativo})` : item[1] === 'comemorativa' ? ` (${T.comemorativa})` : '');

    function pintarDetalhe() {
      detalhe.textContent = '';
      if (escolhido) {
        const [a, m, d] = escolhido.split('-').map(Number);
        const data = new Date(a, m - 1, d, 12);
        const n = Math.round((data - hoje) / 86400000);
        const linha = el('div', 'cal-escolhido');
        linha.append(el('b', '', data.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })), el('span', 'cal-quando', ` · ${T.dias(n)}`));
        for (const item of datas[escolhido] || []) linha.append(el('div', `cal-nome cal-${item[1]}`, nomeDe(item) + tipoDe(item)));
        detalhe.append(linha);
      }
      // as datas do mês mostrado
      const doMes = Object.keys(datas).filter((k) => k.startsWith(`${ano}-${String(mes).padStart(2, '0')}-`)).sort();
      const lista = el('ul', 'cal-lista');
      for (const k of doMes) {
        for (const item of datas[k]) {
          const li = el('li', `cal-${item[1]}`);
          const d = new Date(ano, mes - 1, Number(k.slice(8)), 12);
          li.append(el('span', 'cal-lista-dia', d.toLocaleDateString(locale, { day: 'numeric', weekday: 'short' }).replace('.', '')), el('span', '', nomeDe(item) + tipoDe(item)));
          li.addEventListener('click', () => {
            escolhido = k;
            pintar();
          });
          lista.append(li);
        }
      }
      if (!doMes.some((k) => datas[k].some((i) => i[1] !== 'comemorativa'))) lista.prepend(el('li', 'cal-vazio', T.semDatas));
      detalhe.append(lista);
    }

    function pintar() {
      const t = new Date(ano, mes - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      titulo.textContent = t[0].toUpperCase() + t.slice(1);
      grade.textContent = '';
      // cabeçalho: dom, seg, … (no idioma da resposta)
      for (let i = 0; i < 7; i += 1) {
        const n = new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');
        grade.append(el('div', `cal-semana${i === 0 || i === 6 ? ' cal-fds' : ''}`, n.slice(0, 3)));
      }
      const inicio = new Date(ano, mes - 1, 1).getDay();
      const total = new Date(ano, mes, 0).getDate();
      for (let c = 0; c < 42; c += 1) {
        const d = new Date(ano, mes - 1, 1 - inicio + c, 12);
        if (c >= 35 && d.getMonth() !== mes - 1 && inicio + total <= 35) break; // 5 semanas bastam
        const chave = iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
        const itens = datas[chave] || [];
        const b = el('button', 'cal-dia', String(d.getDate()));
        b.type = 'button';
        if (d.getMonth() !== mes - 1) b.classList.add('cal-fora');
        if (d.getDay() === 0 || d.getDay() === 6) b.classList.add('cal-fds');
        if (chave === s.hoje) b.classList.add('cal-e-hoje');
        if (chave === escolhido) b.classList.add('cal-marcado');
        const principal = itens.find((i) => i[1] === 'feriado') || itens.find((i) => i[1] === 'facultativo') || itens[0];
        if (principal) {
          b.classList.add(`cal-tem-${principal[1]}`);
          b.title = itens.map((i) => nomeDe(i) + tipoDe(i)).join(' · ');
        }
        b.addEventListener('click', () => {
          escolhido = chave;
          if (d.getMonth() !== mes - 1) {
            ano = d.getFullYear();
            mes = d.getMonth() + 1;
          }
          pintar();
        });
        grade.append(b);
      }
      pintarDetalhe();
    }

    pintar();
    return raiz;
  }

  global.calendario = { criar };
})(window);
