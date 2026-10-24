'use strict';

/**
 * A agenda do AuGPT (23/10, pedido do Davi, bloco 2): lembretes com aviso na hora, ideias e planos
 * sem data e assuntos que o AuGPT acompanha ("me avise quando a RTX 60 for lançada"). Fica só no
 * computador, em userData/agenda.json.
 *
 * Item: { id, tipo: 'lembrete' | 'ideia' | 'acompanhar', titulo, quando ('AAAA-MM-DDTHH:MM', hora
 * local), diaInteiro, avisarAntes (minutos), feito, avisado, criado, acompanhar: { assunto, status:
 * 'ativo' | 'aconteceu' | 'pausado', ultimaVerificacao, resumo, data } }
 */

const fs = require('fs');
const path = require('path');

const HORA_DO_AVISO_DO_DIA = '09:00'; // lembrete sem hora: avisa às 9h do dia
const INTERVALO_DO_ACOMPANHAMENTO = 20 * 3600 * 1000; // uma checagem por dia (com folga)

/** "2026-10-24T15:00" → Date na hora local. */
const paraData = (quando) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(quando || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
};
/** Date → "2026-10-24T15:00" (hora local). */
const deData = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Quando avisar: a hora menos a antecedência; dia inteiro, às 9h do dia. */
function horaDoAviso(item) {
  const d = paraData(item.diaInteiro ? `${String(item.quando).slice(0, 10)}T${HORA_DO_AVISO_DO_DIA}` : item.quando);
  return d ? new Date(d.getTime() - (item.diaInteiro ? 0 : Number(item.avisarAntes) || 0) * 60000) : null;
}

class Agenda {
  constructor(dir) {
    this.arquivo = path.join(dir, 'agenda.json');
  }

  listar() {
    try {
      const lista = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      return Array.isArray(lista) ? lista : [];
    } catch {
      return [];
    }
  }

  gravar(lista) {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const temp = `${this.arquivo}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(lista, null, 2));
    fs.renameSync(temp, this.arquivo); // nunca deixa o arquivo pela metade
    return lista;
  }

  adicionar(dados) {
    const tipo = ['lembrete', 'ideia', 'acompanhar'].includes(dados.tipo) ? dados.tipo : dados.quando ? 'lembrete' : 'ideia';
    const titulo = String(dados.titulo || '').trim().slice(0, 200);
    if (!titulo) return null;
    const item = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      tipo,
      titulo,
      quando: tipo === 'lembrete' && paraData(dados.quando) ? String(dados.quando).slice(0, 16) : null,
      diaInteiro: tipo === 'lembrete' && (dados.diaInteiro === true || /^\d{4}-\d{2}-\d{2}$/.test(String(dados.quando || ''))),
      avisarAntes: Math.max(0, Number(dados.avisarAntes) || 0),
      feito: false,
      avisado: false,
      criado: new Date().toISOString(),
      ...(tipo === 'acompanhar' ? { acompanhar: { assunto: String(dados.assunto || titulo).trim().slice(0, 120), status: 'ativo', ultimaVerificacao: 0, resumo: '', data: null } } : {}),
    };
    if (item.tipo === 'lembrete' && !item.quando) item.tipo = 'ideia';
    this.gravar([...this.listar(), item]);
    return item;
  }

  atualizar(id, mudancas = {}) {
    let achado = null;
    const lista = this.listar().map((i) => {
      if (i.id !== id) return i;
      achado = { ...i, ...mudancas, id: i.id, ...(mudancas.acompanhar ? { acompanhar: { ...i.acompanhar, ...mudancas.acompanhar } } : {}) };
      // mudou a hora: avisa de novo
      if ('quando' in mudancas || 'avisarAntes' in mudancas) achado.avisado = false;
      return achado;
    });
    if (achado) this.gravar(lista);
    return achado;
  }

  remover(id) {
    const lista = this.listar();
    const resto = lista.filter((i) => i.id !== id);
    if (resto.length !== lista.length) this.gravar(resto);
    return resto.length !== lista.length;
  }

  /** Lembretes que chegaram na hora do aviso e ainda não avisaram (até 12 h de atraso: o PC estava desligado). */
  paraAvisar(agora = new Date()) {
    return this.listar().filter((i) => {
      if (i.tipo !== 'lembrete' || i.feito || i.avisado) return false;
      const aviso = horaDoAviso(i);
      return aviso && aviso <= agora && agora - aviso < 12 * 3600 * 1000;
    });
  }

  /** Assuntos acompanhados que não foram conferidos nas últimas ~20 h. */
  paraConferir(agora = Date.now()) {
    return this.listar().filter((i) => i.tipo === 'acompanhar' && i.acompanhar?.status === 'ativo' && agora - (Number(i.acompanhar.ultimaVerificacao) || 0) >= INTERVALO_DO_ACOMPANHAMENTO);
  }
}

/* ------------------------------ conferir um assunto acompanhado ------------------------------ */

const pedidoDoJulgamento = (assunto, texto, hoje) => `Hoje é ${hoje}. O usuário pediu para ser avisado sobre: "${assunto}".
Abaixo, o que uma pesquisa de hoje encontrou. Responda SÓ com JSON:
{"aconteceu": true ou false, "data": "AAAA-MM-DD ou vazio", "resumo": "uma frase curta, em português, com a situação de hoje"}
- "aconteceu": true SÓ se as fontes dizem que já aconteceu (foi lançado, saiu, estreou, foi anunciado oficialmente com data). Rumor, vazamento ou previsão: false.
- "data": a data oficial confirmada, se houver (mesmo que no futuro). Senão, vazio.

PESQUISA:
${String(texto || '').slice(0, 6000)}`;

/**
 * Pesquisa o assunto e julga se aconteceu. `pesquisar(pergunta)` → texto; `julgar(prompt)` → texto
 * do modelo. Devolve { aconteceu, data, resumo } (ou null se não deu para conferir).
 */
async function conferirAssunto(assunto, { pesquisar, julgar, hoje = new Date().toLocaleDateString('pt-BR') } = {}) {
  // `erro`: por que não deu para conferir (a Agenda mostra; a próxima checagem tenta de novo)
  const texto = await pesquisar(`${assunto}: já foi lançado ou anunciado oficialmente? Qual a data confirmada?`);
  if (!String(texto || '').trim()) return { erro: 'a pesquisa voltou vazia' };
  const bruto = String(await julgar(pedidoDoJulgamento(assunto, texto, hoje)) || '');
  try {
    const j = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1));
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(j.data || '')) ? j.data : null;
    return { aconteceu: j.aconteceu === true, data, resumo: String(j.resumo || '').trim().slice(0, 300) };
  } catch {
    return { erro: 'o modelo não devolveu a conclusão' };
  }
}

module.exports = { Agenda, paraData, deData, horaDoAviso, conferirAssunto, pedidoDoJulgamento, INTERVALO_DO_ACOMPANHAMENTO };
