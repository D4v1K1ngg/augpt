'use strict';

/**
 * Tarefas em segundo plano, do lado da tela (27/10; a fila mora em src/segundo-plano.js):
 * - o botão ⏱ ao lado do Enviar (ou "em segundo plano: …" no pedido) manda para a fila;
 * - "Em segundo plano" na lateral: andamento, aprovação (Executar/Recusar), abrir a conversa pronta.
 */
(function () {
  const painel = $('fundoPainel');
  const lista = $('fundoLista');
  const botao = $('btnFundoAgente');

  function meta(t) {
    if (t.estado === 'fila') return tr('na fila');
    if (t.estado === 'rodando') return t.passo ? tr('rodando · passo {n}', { n: t.passo }) : tr('rodando');
    if (t.estado === 'esperando') return tr('precisa da sua aprovação');
    if (t.estado === 'pronta') return tr('pronta · clique para abrir');
    return tr('não terminou: {erro}', { erro: t.erro || '' });
  }

  function pintar(itens = []) {
    painel.hidden = !itens.length;
    lista.replaceChildren();
    for (const t of itens) {
      const li = document.createElement('li');
      li.className = `fundo-item ${t.estado}`;
      li.innerHTML = '<div class="fundo-texto"><span class="item-titulo"></span><span class="item-meta"></span></div><button class="tres-pontos fundo-tirar">×</button>';
      li.querySelector('.item-titulo').textContent = t.titulo || t.objetivo;
      li.querySelector('.item-meta').textContent = meta(t);
      const tirar = li.querySelector('.fundo-tirar');
      tirar.title = ['fila', 'rodando', 'esperando'].includes(t.estado) ? tr('Cancelar a tarefa') : tr('Tirar da lista');
      tirar.addEventListener('click', (e) => {
        e.stopPropagation();
        api.fundo.remover(t.id);
      });
      if (t.estado === 'pronta' && t.idConversa) {
        li.addEventListener('click', () => {
          abrirConversa(t.idConversa);
          api.fundo.remover(t.id);
        });
      }
      if (t.estado === 'esperando' && t.aprovacao) {
        const a = document.createElement('div');
        a.className = 'fundo-aprovacao';
        a.innerHTML = '<code></code><div class="acoes"><button class="btn-primario">Executar</button><button class="btn-secundario">Recusar</button></div>';
        a.querySelector('code').textContent = `${t.aprovacao.nome}(${JSON.stringify(t.aprovacao.argumentos || {}).slice(0, 160)})`;
        const [sim, nao] = a.querySelectorAll('button');
        sim.textContent = tr('Executar');
        nao.textContent = tr('Recusar');
        sim.addEventListener('click', () => api.fundo.responder(t.id, 'aprovar'));
        nao.addEventListener('click', () => api.fundo.responder(t.id, 'negar'));
        li.appendChild(a);
      }
      lista.appendChild(li);
    }
  }

  /** Manda para a fila; devolve true se foi. */
  async function mandarParaFundo(texto) {
    const { contexto } = consumirAnexos('agente');
    const r = await api.fundo.adicionar(texto + contexto);
    if (!r?.id) return false;
    el.aEntrada.value = '';
    autoAltura(el.aEntrada);
    el.aRodape.textContent = tr('mandei para o segundo plano — aviso quando terminar');
    return true;
  }
  window.segundoPlano = { mandar: mandarParaFundo };

  botao.addEventListener('click', () => {
    const texto = el.aEntrada.value.trim();
    if (!texto) {
      el.aRodape.textContent = tr('escreva o pedido e clique no relógio para rodar em segundo plano');
      el.aEntrada.focus();
      return;
    }
    mandarParaFundo(texto);
  });

  manipuladores['fundo-mudou'] = ({ lista: itens } = {}) => pintar(itens);
  manipuladores['fundo-abrir'] = ({ id, idConversa } = {}) => {
    if (!idConversa) return;
    abrirConversa(idConversa);
    api.fundo.remover(id);
  };
  manipuladores['conversas-mudaram'] = () => carregarConversas();
  manipuladores['arvore-mudou'] = () => carregarArvore(true);

  api.fundo.listar().then(pintar).catch(() => {});
})();
