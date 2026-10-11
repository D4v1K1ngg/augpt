'use strict';

/**
 * Retomada de execução interrompida (2026-10-10).
 *
 * O problema: `tarefa.retomarDe()` só repassa o CHECKLIST da execução
 * anterior. Uma pesquisa de 20 minutos parada no meio (app fechado, botão
 * parar, limite de passos) relia todas as páginas e refazia todas as
 * destilações ao ser pedida de novo — as duas partes mais lentas do trabalho
 * (renderização de página com JavaScript e uma chamada ao modelo por página).
 *
 * O que fica guardado, por conversa, em `<pasta de trabalho>/.augpt/retomada/`:
 *   - páginas já baixadas (URL sem query/fragmento → texto, título, via);
 *   - destilações já feitas (chave = objetivo + foco + opção + texto da
 *     página → os fatos destilados).
 * A chave da destilação inclui o objetivo e o texto: pedido diferente, ou
 * página que mudou, não reaproveita nada. A busca em si (SearXNG) é barata e
 * continua sendo refeita — o que muda é que a página e a destilação, quando
 * já existem, não custam de novo.
 *
 * Só vale para a execução que vem logo depois de uma interrompida: quem chama
 * (loop.js) limpa o arquivo quando a execução anterior da conversa terminou
 * (`tarefaAnterior` nulo). E tudo expira em 12 horas: página velha não pode
 * virar fonte de um pedido feito no dia seguinte.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALIDADE_PADRAO_MS = 12 * 60 * 60 * 1000;
const MAX_PAGINAS = 80;
const MAX_DESTILACOES = 240;
const MAX_TEXTO_PAGINA = 60000;

const chaveDeUrl = (url) => String(url || '').replace(/[#?].*$/, '');
const nomeSeguro = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

class Retomada {
  constructor({ dir, idConversa, validadeMs = VALIDADE_PADRAO_MS, agora = () => Date.now() } = {}) {
    this.ativo = Boolean(dir && idConversa);
    this.arquivo = this.ativo ? path.join(dir, 'retomada', `${nomeSeguro(idConversa)}.json`) : null;
    this.validadeMs = validadeMs;
    this.agora = agora;
    this.paginas = new Map();
    this.destilacoes = new Map();
    this.usadas = { paginas: 0, destilacoes: 0 };
  }

  /** Lê o que a execução interrompida deixou (descartando o que expirou). */
  carregar() {
    if (!this.ativo) return this;
    try {
      const dados = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      const limite = this.agora() - this.validadeMs;
      for (const [k, v] of Object.entries(dados.paginas || {})) if (v?.em >= limite && v.pagina?.texto) this.paginas.set(k, v);
      for (const [k, v] of Object.entries(dados.destilacoes || {})) if (v?.em >= limite && Array.isArray(v.entradas)) this.destilacoes.set(k, v);
    } catch {
      /* sem arquivo ou corrompido: começa vazio */
    }
    return this;
  }

  /** Execução anterior terminou (ou não há): nada a retomar. */
  limpar() {
    this.paginas.clear();
    this.destilacoes.clear();
    if (!this.ativo) return this;
    try {
      fs.rmSync(this.arquivo, { force: true });
    } catch {
      /* best-effort */
    }
    return this;
  }

  get vazia() {
    return !this.paginas.size && !this.destilacoes.size;
  }

  pagina(url) {
    const item = this.paginas.get(chaveDeUrl(url));
    if (!item) return null;
    this.usadas.paginas += 1;
    return item.pagina;
  }

  guardarPagina(url, pagina) {
    if (!this.ativo || !pagina?.texto) return;
    const { tentativas, ...resto } = pagina; // tentativas é diagnóstico da leitura original
    this.paginas.set(chaveDeUrl(url), { em: this.agora(), pagina: { ...resto, texto: String(resto.texto).slice(0, MAX_TEXTO_PAGINA) } });
    this._aparar(this.paginas, MAX_PAGINAS);
    this._salvar();
  }

  static chaveDestilacao({ objetivo = '', foco = '', opcao = '', texto = '' } = {}) {
    return crypto.createHash('sha1').update(`${objetivo}\u0000${foco}\u0000${opcao}\u0000${texto}`).digest('hex');
  }

  destilacao(chave) {
    const item = this.destilacoes.get(chave);
    if (!item) return null;
    this.usadas.destilacoes += 1;
    return item.entradas.map((e) => ({ ...e }));
  }

  guardarDestilacao(chave, entradas) {
    if (!this.ativo || !Array.isArray(entradas) || !entradas.length) return;
    this.destilacoes.set(chave, { em: this.agora(), entradas });
    this._aparar(this.destilacoes, MAX_DESTILACOES);
    this._salvar();
  }

  _aparar(mapa, maximo) {
    while (mapa.size > maximo) mapa.delete(mapa.keys().next().value);
  }

  _salvar() {
    try {
      fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
      const dados = { versao: 1, paginas: Object.fromEntries(this.paginas), destilacoes: Object.fromEntries(this.destilacoes) };
      fs.writeFileSync(this.arquivo, JSON.stringify(dados), 'utf8');
    } catch {
      /* retomada é bônus: falha de disco não pode derrubar a execução */
    }
  }
}

module.exports = { Retomada, chaveDeUrl, VALIDADE_PADRAO_MS };
