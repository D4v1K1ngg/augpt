'use strict';

/**
 * A página Agenda (23/10, bloco 2): o calendário com os dias que têm lembrete, a lista dos próximos
 * (filtrável pelo dia clicado), os assuntos acompanhados, as ideias e planos e o que já passou.
 * Os dados ficam no processo principal (src/agenda.js); o chat também mexe nela (rota "agenda").
 */
(function () {
  const estado = { itens: [], feriados: {}, dia: null, conferindo: false };
  const ingles = () => window.i18n?.idioma === 'en';
  const locale = () => (ingles() ? 'en-US' : 'pt-BR');
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  };
  const paraData = (q) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(q || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
  };
  const chaveDoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hojeChave = () => chaveDoDia(new Date());

  function nomeDoDia(chave) {
    const d = paraData(chave);
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    if (chave === hojeChave()) return tr('Hoje');
    if (chave === chaveDoDia(amanha)) return tr('Amanhã');
    const t = d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    return t[0].toUpperCase() + t.slice(1);
  }

  function metaDoLembrete(i) {
    const d = paraData(i.quando);
    const partes = [];
    if (!d) return '';
    partes.push(i.diaInteiro ? tr('dia inteiro (aviso às 9h)') : d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }));
    if (!i.diaInteiro && Number(i.avisarAntes)) partes.push(tr('aviso {n} antes', { n: Number(i.avisarAntes) >= 1440 ? tr('1 dia') : Number(i.avisarAntes) >= 60 ? tr('1 hora') : `${i.avisarAntes} min` }));
    if (i.avisado && !i.feito) partes.push(tr('avisado'));
    return partes.join(' · ');
  }

  function linha(i, { meta, acoes = [] } = {}) {
    const li = el('li', `agenda-item${i.feito ? ' agenda-feito' : ''}${i.tipo === 'acompanhar' ? ' agenda-acompanhar' : ''}`);
    if (i.tipo !== 'acompanhar') {
      const caixa = el('input', 'marcador');
      caixa.type = 'checkbox';
      caixa.checked = Boolean(i.feito);
      caixa.title = i.feito ? tr('Desmarcar') : tr('Marcar como feito');
      caixa.addEventListener('change', async () => {
        await api.agenda.atualizar(i.id, { feito: caixa.checked });
        carregarAgenda();
      });
      li.append(caixa);
    } else {
      li.append(el('span', `agenda-estado agenda-estado-${i.acompanhar?.status || 'ativo'}`, i.acompanhar?.status === 'aconteceu' ? '✓' : i.acompanhar?.status === 'pausado' ? '❚❚' : '◉'));
    }
    const texto = el('div', 'agenda-texto');
    texto.append(el('div', 'agenda-titulo', i.titulo));
    if (meta) texto.append(el('div', 'agenda-meta', meta));
    li.append(texto);
    for (const a of acoes) {
      const b = el('button', 'agenda-acao', a.rotulo);
      b.type = 'button';
      if (a.desligado) b.disabled = true;
      b.addEventListener('click', a.fazer);
      li.append(b);
    }
    const x = el('button', 'agenda-x', '×');
    x.type = 'button';
    x.title = tr('Remover');
    x.setAttribute('aria-label', tr('Remover'));
    x.addEventListener('click', async () => {
      if (!confirm(tr('Remover "{titulo}" da agenda?', { titulo: i.titulo }))) return;
      await api.agenda.remover(i.id);
      carregarAgenda();
    });
    li.append(x);
    return li;
  }

  function vazio(ul, texto) {
    ul.append(el('li', 'agenda-vazio', texto));
  }

  function pintarListas() {
    const agora = new Date();
    const lembretes = estado.itens.filter((i) => i.tipo === 'lembrete').sort((a, b) => paraData(a.quando) - paraData(b.quando));
    const passou = (i) => (i.diaInteiro ? String(i.quando).slice(0, 10) < hojeChave() : paraData(i.quando) < agora);
    const proximos = lembretes.filter((i) => !i.feito && !passou(i) && (!estado.dia || String(i.quando).startsWith(estado.dia)));
    const feitos = lembretes.filter((i) => i.feito || passou(i)).reverse().concat(estado.itens.filter((i) => i.tipo === 'ideia' && i.feito));

    $('agendaTituloProximos').textContent = estado.dia ? nomeDoDia(estado.dia) : tr('Próximos');
    $('agendaVerTodos').hidden = !estado.dia;
    const ul = $('agendaProximos');
    ul.textContent = '';
    let diaAtual = null;
    for (const i of proximos) {
      const dia = String(i.quando).slice(0, 10);
      if (!estado.dia && dia !== diaAtual) {
        diaAtual = dia;
        ul.append(el('li', 'agenda-dia', nomeDoDia(dia)));
      }
      ul.append(linha(i, { meta: metaDoLembrete(i) }));
    }
    if (!proximos.length) vazio(ul, estado.dia ? tr('Nada neste dia.') : tr('Nenhum lembrete pela frente. Escreva acima ou peça no chat.'));

    const acomp = $('agendaAcompanhando');
    acomp.textContent = '';
    const acompanhando = estado.itens.filter((i) => i.tipo === 'acompanhar');
    for (const i of acompanhando) {
      const a = i.acompanhar || {};
      const quando = a.ultimaVerificacao ? new Date(a.ultimaVerificacao).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
      const meta = a.status === 'aconteceu'
        ? `${tr('Aconteceu')} — ${a.resumo || ''}`
        : [quando ? tr('conferido em {quando}', { quando }) : tr('ainda não conferido (a primeira checagem sai em alguns minutos, com o agente parado)'), a.erro ? tr('não deu para conferir: {erro}', { erro: a.erro }) : '', a.data ? tr('data confirmada: {data}', { data: paraData(a.data).toLocaleDateString(locale()) }) : '', a.resumo].filter(Boolean).join(' — ');
      // alerta de preço: "Ver oferta" abre a loja do menor preço (link da última checagem)
      const verOferta = a.link ? [{ rotulo: tr('Ver oferta'), fazer: () => window.open(a.link, '_blank') }] : [];
      acomp.append(linha(i, {
        meta,
        acoes: a.status === 'aconteceu' ? verOferta : [
          ...verOferta,
          { rotulo: estado.conferindo === i.id ? tr('conferindo…') : tr('Conferir agora'), desligado: Boolean(estado.conferindo), fazer: async () => {
            const r = await api.agenda.conferirAgora(i.id);
            $('agendaNota').textContent = r.ok ? tr('Conferindo {titulo} em segundo plano…', { titulo: i.titulo }) : r.error;
          } },
          { rotulo: a.status === 'pausado' ? tr('Retomar') : tr('Pausar'), fazer: async () => {
            await api.agenda.atualizar(i.id, { status: a.status === 'pausado' ? 'ativo' : 'pausado' });
            carregarAgenda();
          } },
        ],
      }));
    }
    if (!acompanhando.length) vazio(acomp, tr('Nenhum assunto. Ex.: "me avise quando a RTX 60 for lançada".'));

    const ideias = $('agendaIdeias');
    ideias.textContent = '';
    const abertas = estado.itens.filter((i) => i.tipo === 'ideia' && !i.feito);
    for (const i of abertas) ideias.append(linha(i, { meta: new Date(i.criado).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) }));
    if (!abertas.length) vazio(ideias, tr('Nenhuma ideia anotada.'));

    const ulFeitos = $('agendaFeitos');
    ulFeitos.textContent = '';
    for (const i of feitos.slice(0, 50)) ulFeitos.append(linha(i, { meta: i.quando ? `${nomeDoDia(String(i.quando).slice(0, 10))} · ${metaDoLembrete(i)}` : '' }));
    if (!feitos.length) vazio(ulFeitos, tr('Nada ainda.'));
  }

  function pintarCalendario() {
    const datas = JSON.parse(JSON.stringify(estado.feriados || {}));
    for (const i of estado.itens.filter((x) => x.tipo === 'lembrete' && !x.feito)) {
      const dia = String(i.quando).slice(0, 10);
      (datas[dia] ||= []).push([i.titulo, 'agenda', i.titulo]);
    }
    const agora = new Date();
    const lugar = $('agendaCalendario');
    lugar.textContent = '';
    lugar.append(window.calendario.criar({ idioma: ingles() ? 'en' : 'pt', ano: agora.getFullYear(), mes: agora.getMonth() + 1, hoje: hojeChave(), marcar: estado.dia, datas }, {
      aoEscolher: (chave) => {
        estado.dia = estado.dia === chave ? null : chave;
        pintarListas();
      },
    }));
  }

  function pintarContador() {
    const hoje = hojeChave();
    const n = estado.itens.filter((i) => i.tipo === 'lembrete' && !i.feito && String(i.quando).startsWith(hoje)).length;
    $('navAgendaContador').hidden = !n;
    $('navAgendaContador').textContent = n;
    $('navAgendaContador').title = tr('{n} para hoje', { n });
  }

  async function carregarAgenda() {
    const r = await api.agenda.listar().catch(() => null);
    if (!r) return;
    estado.itens = r.itens || [];
    estado.feriados = r.feriados || {};
    pintarContador();
    if ($('viewAgenda').hidden) return;
    pintarCalendario();
    pintarListas();
  }
  window.carregarAgenda = carregarAgenda;

  // o formulário: lembrete com dia (e hora), ideia sem nada, acompanhar só o assunto
  function ajustarFormulario() {
    const tipo = $('agendaTipo').value;
    for (const id of ['agendaDia', 'agendaHora', 'agendaAntes']) $(id).hidden = tipo !== 'lembrete';
    $('agendaTitulo').placeholder = tr(tipo === 'acompanhar' ? 'Qual assunto? (ex.: lançamento da RTX 60)' : tipo === 'ideia' ? 'Qual ideia ou plano?' : 'O que lembrar?');
  }
  $('agendaTipo').addEventListener('change', ajustarFormulario);
  $('agendaNovo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = $('agendaTipo').value;
    const titulo = $('agendaTitulo').value.trim();
    if (!titulo) return;
    const dia = $('agendaDia').value;
    const hora = $('agendaHora').value;
    if (tipo === 'lembrete' && !dia) {
      $('agendaNota').textContent = tr('Escolha o dia do lembrete (a hora é opcional).');
      return;
    }
    const r = await api.agenda.adicionar({ tipo, titulo, assunto: titulo, quando: tipo === 'lembrete' ? (hora ? `${dia}T${hora}` : dia) : null, diaInteiro: !hora, avisarAntes: Number($('agendaAntes').value) || 0 });
    $('agendaNota').textContent = r.ok ? '' : r.error;
    if (r.ok) {
      $('agendaTitulo').value = '';
      $('agendaHora').value = '';
      carregarAgenda();
    }
  });
  $('agendaVerTodos').addEventListener('click', () => {
    estado.dia = null;
    pintarCalendario();
    pintarListas();
  });

  // eventos do processo principal: o chat mexeu na agenda, um aviso saiu, uma checagem começou/acabou
  Object.assign(manipuladores, {
    'agenda-mudou'() {
      carregarAgenda();
    },
    'agenda-abrir'() {
      trocarAba('agenda');
    },
    'agenda-conferindo'({ id, conferindo }) {
      estado.conferindo = conferindo ? id : false;
      if (!conferindo) $('agendaNota').textContent = '';
      if (!$('viewAgenda').hidden) pintarListas();
    },
  });

  $('agendaDia').value = hojeChave();
  ajustarFormulario();
  carregarAgenda();
  // o contador "para hoje" muda à meia-noite e quando um lembrete passa
  setInterval(carregarAgenda, 5 * 60000);
})();
