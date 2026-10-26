'use strict';

/**
 * Tarefas em segundo plano (pedido do Davi, 27/10): você pede algo demorado e continua usando o AuGPT.
 * Uma fila, uma tarefa por vez, num agente separado do chat (não mexe na conversa aberta). No fim, a
 * resposta vira uma conversa salva e sai um aviso (Windows e celular).
 * - aprovação: espera você (no PC ou no celular), nunca aprova sozinha; "Sempre permitir" não vale aqui;
 * - pergunta do agente: segue com o que tem (não há ninguém olhando);
 * - a fila mora na memória: fechar o AuGPT cancela o que não terminou.
 */

// "em segundo plano: compare 5 notebooks" / "compare 5 notebooks em segundo plano" / "in the background"
const FRASE = /^\s*(?:(?:rode|faça|faz|fa[cç]a isso)\s+)?(?:em|no)\s+segundo\s+plano\s*[:,.-]?\s*|\s*[,.-]?\s*(?:em|no)\s+segundo\s+plano\s*[.!]?\s*$|^\s*in\s+the\s+background\s*[:,.-]?\s*|\s*[,.-]?\s*in\s+the\s+background\s*[.!]?\s*$/i;

/** O pedido sem a frase, ou null quando não pediu segundo plano. */
function pedidoDeFundo(texto) {
  const t = String(texto || '');
  if (!FRASE.test(t)) return null;
  const limpo = t.replace(FRASE, '').trim();
  return limpo.length >= 3 ? limpo : null;
}

const RESPOSTA_A_PERGUNTA = 'Esta tarefa está em segundo plano e ninguém pode responder agora: siga com a melhor opção que você tiver, sem perguntar.';

class FilaDeFundo {
  /**
   * @param {object} o
   * @param {() => object} o.criarAgente  Agent novo (EventEmitter com run/responder/parar)
   * @param {(t: object) => {id: string, titulo: string}} o.salvar  grava a conversa da tarefa pronta
   * @param {(t: object) => void} o.avisar  aviso de pronta/erro/esperando aprovação
   * @param {(lista: object[]) => void} o.mudou  a lista mudou (tela e celular)
   */
  constructor({ criarAgente, salvar, avisar = () => {}, mudou = () => {} }) {
    Object.assign(this, { criarAgente, salvar, avisar, mudou });
    this.itens = [];
    this.atual = null; // { item, agente }
    this.seq = 0;
  }

  get ocupada() {
    return Boolean(this.atual);
  }

  listar() {
    return this.itens.map(({ id, objetivo, estado, passo, idConversa, titulo, erro, aprovacao, criadoEm, fimEm }) =>
      ({ id, objetivo, estado, passo, idConversa, titulo, erro, aprovacao, criadoEm, fimEm }));
  }

  adicionar(objetivo) {
    const texto = String(objetivo || '').trim().slice(0, 4000);
    if (!texto) return null;
    this.seq += 1;
    const item = { id: `fundo-${Date.now().toString(36)}-${this.seq}`, objetivo: texto, estado: 'fila', passo: 0, criadoEm: new Date().toISOString() };
    this.itens.push(item);
    this.mudou(this.listar());
    this.proxima();
    return item.id;
  }

  /** Aprovação de uma tarefa em segundo plano: só 'aprovar' libera. */
  responder(id, valor) {
    const a = this.atual;
    if (!a || a.item.id !== id || !a.item.aprovacao) return false;
    const pendente = a.item.aprovacao.id;
    a.item.aprovacao = null;
    a.item.estado = 'rodando';
    this.mudou(this.listar());
    return a.agente.responder(pendente, valor === 'aprovar' ? 'aprovar' : 'negar');
  }

  /** Cancela (rodando ou na fila) ou tira da lista (já terminada). */
  remover(id) {
    const item = this.itens.find((i) => i.id === id);
    if (!item) return false;
    if (this.atual?.item === item) {
      item.estado = 'cancelada';
      this.atual.agente.parar();
    }
    this.itens = this.itens.filter((i) => i !== item);
    this.mudou(this.listar());
    return true;
  }

  pararTudo() {
    this.itens = [];
    this.atual?.agente.parar();
  }

  async proxima() {
    if (this.atual) return;
    const item = this.itens.find((i) => i.estado === 'fila');
    if (!item) return;
    const agente = this.criarAgente();
    this.atual = { item, agente };
    item.estado = 'rodando';
    this.mudou(this.listar());

    let fim = null; // { resumo } | { erro }
    agente.on('iteracao', ({ n } = {}) => {
      item.passo = n || item.passo + 1;
      this.mudou(this.listar());
    });
    agente.on('aprovacao', ({ id, nome, argumentos, risco, descricao } = {}) => {
      item.aprovacao = { id, nome, argumentos, risco, descricao };
      item.estado = 'esperando';
      this.mudou(this.listar());
      this.avisar(item);
    });
    agente.on('pergunta', ({ id } = {}) => agente.responder(id, RESPOSTA_A_PERGUNTA));
    agente.on('concluido', ({ resumo } = {}) => (fim = { resumo: String(resumo || '') }));
    agente.on('limite', ({ iteracoes } = {}) => (fim = { resumo: `_(parou em ${iteracoes} passos sem concluir)_` }));
    agente.on('erro', ({ mensagem } = {}) => (fim = fim || { erro: String(mensagem || 'erro') }));

    try {
      await agente.run(item.objetivo, [], null, {});
    } catch (err) {
      fim = fim || { erro: err.message };
    }
    this.atual = null;

    if (item.estado !== 'cancelada') {
      item.aprovacao = null;
      item.fimEm = new Date().toISOString();
      if (fim?.resumo) {
        try {
          const g = this.salvar(item, fim.resumo);
          Object.assign(item, { estado: 'pronta', idConversa: g?.id || null, titulo: g?.titulo || item.objetivo.slice(0, 60) });
        } catch (err) {
          Object.assign(item, { estado: 'erro', erro: `não deu para salvar: ${err.message}` });
        }
      } else {
        Object.assign(item, { estado: 'erro', erro: fim?.erro || 'parou sem resposta' });
      }
      this.mudou(this.listar());
      this.avisar(item);
    }
    this.proxima();
  }
}

module.exports = { FilaDeFundo, pedidoDeFundo, RESPOSTA_A_PERGUNTA };
