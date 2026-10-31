'use strict';

/**
 * Busca nos seus arquivos (31/10): Ajustes → Memória (as pastas, atualizar, apagar) e o cartão ```arquivos do chat
 * (src/agent/busca-local-no-chat.js) — o nome, a pasta, a data, o trecho e os botões Abrir e Mostrar na pasta,
 * que o processo principal só atende para arquivos do índice. O JSON é só dado: tudo entra por textContent.
 */
(function (global) {
  const T = {
    pt: { abrir: 'Abrir', pasta: 'Mostrar na pasta', sumiu: 'O arquivo não está mais lá.' },
    en: { abrir: 'Open', pasta: 'Show in folder', sumiu: 'The file is no longer there.' },
  };
  const ICONE = (nome) => (/\.pdf$/i.test(nome) ? '📕' : /\.(docx|odt|rtf)$/i.test(nome) ? '📘' : /\.(xlsx|ods|csv)$/i.test(nome) ? '📗' : /\.(pptx|odp)$/i.test(nome) ? '📙' : /\.(png|jpe?g)$/i.test(nome) ? '🖼️' : '📄');
  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = String(texto);
    return e;
  };

  function criar(dado) {
    const s = typeof dado === 'string' ? JSON.parse(dado) : dado;
    const L = T[s.idioma === 'en' ? 'en' : 'pt'];
    const raiz = el('div', 'arquivos-achados');
    raiz.dataset.semTraducao = '';
    for (const item of s.itens || []) {
      const linha = el('div', 'arquivo-achado');
      linha.appendChild(el('div', 'arquivo-icone', ICONE(item.nome)));
      const meio = el('div', 'arquivo-meio');
      meio.appendChild(el('div', 'arquivo-nome', item.nome));
      meio.appendChild(el('div', 'arquivo-onde', `${item.pasta} · ${item.data}`));
      if (item.trecho) meio.appendChild(el('div', 'arquivo-trecho', item.trecho));
      const acoes = el('div', 'arquivo-acoes');
      const erro = el('div', 'arquivo-erro');
      for (const [rotulo, fn, classe] of [[L.abrir, 'abrir', 'btn-primario'], [L.pasta, 'mostrar', 'btn-secundario']]) {
        const b = el('button', classe, rotulo);
        b.addEventListener('click', async () => {
          const r = await api.buscaLocal[fn](item.caminho).catch(() => ({ ok: false }));
          erro.textContent = r?.ok ? '' : L.sumiu;
        });
        acoes.appendChild(b);
      }
      meio.appendChild(acoes);
      meio.appendChild(erro);
      linha.appendChild(meio);
      raiz.appendChild(linha);
    }
    return raiz;
  }
  global.arquivos = { criar };

  /* ------------------------------ Ajustes → Memória ------------------------------ */
  const $ = (id) => document.getElementById(id);
  const tempo = (ms) => {
    if (!ms) return tr('ainda não leu');
    const min = Math.round((Date.now() - ms) / 60000);
    return min < 1 ? tr('atualizado agora') : min < 60 ? tr('atualizado há {n} min', { n: min }) : tr('atualizado há {n} h', { n: Math.round(min / 60) });
  };

  function pintar(e) {
    if (!$('buscaLocalPastas')) return;
    $('buscaLocalTotal').textContent = e.arquivos || 0;
    const lista = $('buscaLocalPastas');
    lista.innerHTML = '';
    if (!e.pastas.length) lista.innerHTML = `<li class="vazio">${tr('Nenhuma pasta ainda — a busca está desligada.')}</li>`;
    for (const p of e.pastas) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="op-texto"><span class="op-licao"></span></div><button class="btn-linha">✕</button>';
      li.querySelector('.op-licao').textContent = p;
      li.querySelector('button').title = tr('Tirar esta pasta da busca');
      li.querySelector('button').addEventListener('click', async () => pintar(await api.buscaLocal.removerPasta(p)));
      lista.appendChild(li);
    }
    $('cfgBuscaLocalImagens').checked = e.imagens;
    $('cfgBuscaLocalImagens').disabled = !e.ocr;
    $('buscaLocalImagensDica').textContent = e.ocr ? '' : tr('Instale o Tesseract em Componentes para ligar.');
    $('btnBuscaLocalAtualizar').hidden = !e.pastas.length;
    $('btnBuscaLocalApagar').hidden = !e.pastas.length && !e.arquivos;
    if (e.erro) $('buscaLocalStatus').textContent = tr(e.erro);
    else if (!e.indexando) $('buscaLocalStatus').textContent = e.pastas.length ? `${tr('{n} arquivos lidos', { n: e.arquivos || 0 })} · ${tempo(e.atualizado)}` : '';
  }
  const carregar = async () => pintar(await api.buscaLocal.estado());

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('btnBuscaLocalPasta')) return;
    $('btnBuscaLocalPasta').addEventListener('click', async () => pintar(await api.buscaLocal.adicionarPasta()));
    $('btnBuscaLocalAtualizar').addEventListener('click', async () => pintar(await api.buscaLocal.atualizar()));
    $('btnBuscaLocalApagar').addEventListener('click', async () => {
      if (!confirm(tr('Apagar o índice e tirar todas as pastas da busca? Os seus arquivos não são apagados.'))) return;
      pintar(await api.buscaLocal.apagar());
    });
    $('cfgBuscaLocalImagens').addEventListener('change', async (ev) => pintar(await api.buscaLocal.imagens(ev.target.checked)));
  });

  if (typeof manipuladores !== 'undefined') {
    Object.assign(manipuladores, {
      'busca-local-progresso'(p = {}) {
        const status = $('buscaLocalStatus');
        if (!status) return;
        if (p.fim) {
          if (p.erro) status.textContent = `${tr('não deu certo')}: ${p.erro}`;
          carregar();
          return;
        }
        status.textContent = p.pausado
          ? tr('pausado — um jogo ou o agente está usando o PC ({f} de {t})', { f: p.feitos, t: p.total })
          : tr('lendo {f} de {t}…', { f: p.feitos, t: p.total });
      },
    });
  }

  global.buscaLocalUi = { carregar };
})(window);
