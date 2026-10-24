'use strict';

/**
 * Cartão de compras (24/10, no estilo do Google Shopping): o bloco ```compras da resposta
 * (src/agent/compras-no-chat.js) vira uma grade de ofertas — foto, nome, preço, parcelas e loja —,
 * com filtros (só o produto pedido, novo/usado, lojas), ordem e o link de cada oferta.
 * O JSON é só dado: tudo entra por textContent; o link abre fora (no navegador do Windows).
 */
(function (global) {
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  };
  const TEXTOS = {
    pt: { titulo: 'Ofertas de', agora: 'agora', so: 'Só', novo: 'Novo', usado: 'Usado', menor: 'Menor preço', maior: 'Maior preço', mais: 'Mostrar mais', suspeito: '⚠ preço muito abaixo — confira a loja', nada: 'Nenhuma oferta com esses filtros.', rodape: 'Preços dos comparadores e das lojas no momento da pergunta; o que vale é o da página da loja.', parecido: 'parecido', de: 'de' },
    en: { titulo: 'Offers for', agora: 'now', so: 'Only', novo: 'New', usado: 'Used', menor: 'Lowest price', maior: 'Highest price', mais: 'Show more', suspeito: '⚠ far below the others — check the store', nada: 'No offers with these filters.', rodape: 'Prices from comparison sites and stores at the time of the question; the store page is what counts.', parecido: 'similar', de: 'of' },
  };

  function criar(spec) {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    const en = s.idioma === 'en';
    const T = TEXTOS[en ? 'en' : 'pt'];
    const locale = en ? 'en-US' : 'pt-BR';
    const reais = (v) => `R$ ${Number(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const ofertas = Array.isArray(s.ofertas) ? s.ofertas : [];
    const lojas = [...new Set(ofertas.map((o) => o.loja).filter(Boolean))];
    const filtro = { soExato: ofertas.some((o) => o.exato), condicao: null, lojas: new Set(), ordem: 'menor', limite: 12 };

    const raiz = el('div', 'compras');
    raiz.dataset.semTraducao = '';
    const topo = el('div', 'compras-topo');
    const titulo = el('div', 'compras-titulo');
    titulo.append(el('span', '', `${T.titulo} `), el('b', '', s.produto));
    const quando = s.quando ? new Date(s.quando).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : T.agora;
    topo.append(titulo, el('span', 'compras-fontes', `${quando} · ${(s.fontes || []).join(', ')}`));

    const barra = el('div', 'compras-filtros');
    const ordem = el('select', 'compras-ordem');
    ordem.append(new Option(T.menor, 'menor'), new Option(T.maior, 'maior'));
    ordem.addEventListener('change', () => {
      filtro.ordem = ordem.value;
      pintar();
    });
    const chip = (texto, ativo, aoClicar) => {
      const b = el('button', `compras-chip${ativo ? ' compras-chip-ativo' : ''}`, texto);
      b.type = 'button';
      b.addEventListener('click', () => {
        aoClicar();
        pintar();
      });
      return b;
    };
    const grade = el('div', 'compras-grade');
    const mais = el('button', 'compras-mais');
    mais.type = 'button';
    mais.addEventListener('click', () => {
      filtro.limite += 12;
      pintar();
    });
    raiz.append(topo, barra, grade, mais, el('div', 'compras-rodape', T.rodape));

    function pintarFiltros() {
      barra.textContent = '';
      barra.append(ordem);
      if (ofertas.some((o) => !o.exato)) barra.append(chip(`${T.so} ${s.produto}`, filtro.soExato, () => (filtro.soExato = !filtro.soExato)));
      if (ofertas.some((o) => o.usado)) {
        barra.append(chip(T.novo, filtro.condicao === 'novo', () => (filtro.condicao = filtro.condicao === 'novo' ? null : 'novo')));
        barra.append(chip(T.usado, filtro.condicao === 'usado', () => (filtro.condicao = filtro.condicao === 'usado' ? null : 'usado')));
      }
      if (lojas.length > 1) {
        for (const l of lojas) barra.append(chip(l, filtro.lojas.has(l), () => (filtro.lojas.has(l) ? filtro.lojas.delete(l) : filtro.lojas.add(l))));
      }
    }

    function tile(o) {
      const a = el('a', `compras-oferta${o.suspeito ? ' compras-suspeita' : ''}${o.exato ? '' : ' compras-parecida'}`);
      a.href = o.link;
      a.dataset.externo = '1';
      a.title = o.nome;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(o.link, '_blank'); // abre no navegador do Windows (setWindowOpenHandler)
      });
      const foto = el('div', 'compras-foto');
      if (o.img) {
        const img = el('img');
        img.src = o.img;
        img.alt = '';
        img.loading = 'lazy';
        foto.append(img);
      }
      if (o.usado) foto.append(el('span', 'compras-selo', T.usado));
      a.append(foto, el('div', 'compras-nome', o.nome), el('div', 'compras-preco', reais(o.preco)));
      if (o.parcelas?.vezes > 1) a.append(el('div', 'compras-parcelas', `${o.parcelas.vezes}x ${T.de} ${reais(o.parcelas.valor)}`));
      a.append(el('div', 'compras-loja', o.exato ? o.loja : `${o.loja} · ${T.parecido}`));
      if (o.suspeito) a.append(el('div', 'compras-aviso', T.suspeito));
      return a;
    }

    function pintar() {
      pintarFiltros();
      const lista = ofertas
        .filter((o) => (!filtro.soExato || o.exato) && (!filtro.condicao || (filtro.condicao === 'usado') === Boolean(o.usado)) && (!filtro.lojas.size || filtro.lojas.has(o.loja)))
        .sort((a, b) => (filtro.ordem === 'maior' ? b.preco - a.preco : a.preco - b.preco));
      grade.textContent = '';
      for (const o of lista.slice(0, filtro.limite)) grade.append(tile(o));
      if (!lista.length) grade.append(el('div', 'compras-nada', T.nada));
      mais.hidden = lista.length <= filtro.limite;
      mais.textContent = `${T.mais} (${lista.length - filtro.limite})`;
    }

    pintar();
    return raiz;
  }

  global.compras = { criar };
})(window);
