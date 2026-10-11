'use strict';

const fs = require('fs');
const path = require('path');
const { cosine, vetorDe } = require('./embeddings');
const { diasDesdeDataMaisRecente } = require('./verificador');
const { segredosDoTexto, mascarar } = require('./segredos');

function tokens(texto) {
  return new Set(
    String(texto)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3)
  );
}

function jaccard(a, b) {
  const inter = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size || 1;
  return inter / union;
}

/**
 * Conta ocorrências de cada token (não só presença, como `tokens()` acima
 * faz pra Jaccard) — é o que o BM25 precisa pra saturar termo repetido em vez
 * de tratar "aparece 1x" e "aparece 5x" como iguais.
 */
function contarTokens(texto) {
  const contagem = new Map();
  for (const t of String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)) {
    contagem.set(t, (contagem.get(t) || 0) + 1);
  }
  return contagem;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * BM25 clássico (Okapi) sobre os itens, pros termos da consulta. `tokensDoItem`
 * é injetável pra permitir cache (a classe usa um WeakMap; os testes de
 * unidade passam uma versão sem cache, sem precisar de uma instância real).
 */
function pontuarBM25(consultaTokens, itens, tokensDoItem = (i) => contarTokens(i.texto)) {
  const N = itens.length;
  if (!N || !consultaTokens.length) return itens.map(() => 0);
  const contagens = itens.map(tokensDoItem);
  const tamanhos = contagens.map((c) => [...c.values()].reduce((s, n) => s + n, 0));
  const avgdl = tamanhos.reduce((s, n) => s + n, 0) / N || 1;

  const termosUnicos = [...new Set(consultaTokens)];
  const df = new Map(termosUnicos.map((termo) => [termo, contagens.filter((c) => c.has(termo)).length]));

  return contagens.map((c, idx) => {
    const dl = tamanhos[idx] || 1;
    let score = 0;
    for (const termo of termosUnicos) {
      const f = c.get(termo) || 0;
      if (!f) continue;
      const n = df.get(termo) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl))));
    }
    return score;
  });
}

/**
 * Peça 3 do plano de nível de raciocínio (pedido do Davi 2026-09-19,
 * decisão de arquitetura confirmada em 2026-09-20: extensão de `Memory` em
 * vez de módulo dedicado): quantos dias, hoje, desde a data mais recente que
 * o texto do item continha — calculado a partir do que foi gravado na
 * escrita (`diasVelhoQuandoSalvo`, ver `Memory.add`) mais o tempo corrido
 * desde então, nunca reabrindo o texto bruto original (que a Memory nem
 * guarda inteiro — só o `texto` destilado, até 4000 caracteres). Sem data
 * nenhuma encontrada na escrita (`diasVelhoQuandoSalvo === null`), devolve
 * null — "sem sinal" não é "velho", mesmo espírito de
 * `verificador.diasDesdeDataMaisRecente`.
 */
function diasVelhoAgora(item, agora = new Date()) {
  if (item.diasVelhoQuandoSalvo == null) return null;
  const diasDesdeSalvo = Math.floor((agora - new Date(item.em)) / 86400000);
  return item.diasVelhoQuandoSalvo + Math.max(0, diasDesdeSalvo);
}

/**
 * `frescorMaximoDias` ausente/zero = sem limite (comportamento de sempre,
 * nunca filtra por idade) — só passa a filtrar quando quem chama `buscar()`
 * pede explicitamente (ver `idConversa` em `Memory.buscar`).
 */
function estaVelhoDemais(item, frescorMaximoDias, agora) {
  if (!frescorMaximoDias) return false;
  const idade = diasVelhoAgora(item, agora);
  return idade != null && idade > frescorMaximoDias;
}

const RRF_K = 60;

/**
 * Combina ranking vetorial (cosine) com ranking léxico (BM25) por Reciprocal
 * Rank Fusion — soma 1/(RRF_K + posição) de cada lista. Evita ter que
 * calibrar escala entre um cosine (0-1) e um score BM25 (aberto, depende do
 * corpus): o que importa é a POSIÇÃO em cada ranking, não o valor bruto.
 * Um item só entra na fusão se limpar o piso de relevância de PELO MENOS um
 * dos dois lados (semântico ou lexical) — nunca os dois exigidos ao mesmo
 * tempo, que é justamente o problema que isso resolve: um termo raro exato
 * pode não ser o mais próximo em embedding, e uma reformulação sem repetir
 * a palavra pode não bater lexicalmente.
 */
function ordenarPorHibrido({ itens, vec, consultaTokens, k, tokensDoItem }) {
  const rankVetor = itens
    .filter((i) => Array.isArray(i.vec) && i.vec.length === vec.length)
    .map((item) => ({ item, score: cosine(vec, item.vec) }))
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);

  const scoresBM25 = pontuarBM25(consultaTokens, itens, tokensDoItem);
  const rankBM25 = itens
    .map((item, idx) => ({ item, score: scoresBM25[idx] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);

  const fundido = new Map();
  rankVetor.forEach((item, idx) => fundido.set(item, (fundido.get(item) || 0) + 1 / (RRF_K + idx + 1)));
  rankBM25.forEach((item, idx) => fundido.set(item, (fundido.get(item) || 0) + 1 / (RRF_K + idx + 1)));

  return [...fundido.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([item]) => item);
}

/**
 * Memória de longo prazo. Usa embeddings quando o modelo de embedding estiver
 * disponível e degrada para similaridade léxica quando não estiver — o agente
 * continua funcionando mesmo sem o nomic-embed-text baixado. Quando há
 * embedding, a busca é híbrida (vetor + BM25 — ver `ordenarPorHibrido`): só
 * cosine deixava passar termo exato/raro que o embedding dilui num vizinho
 * semântico "parecido, mas não é bem aquilo".
 *
 * Peça 3 do plano de nível de raciocínio ("memória curta" — dossiê da
 * conversa aberta, pedido do Davi 2026-09-19): em vez de um módulo dedicado
 * novo, cada item ganhou um `idConversa` opcional (`add`/`buscar`) — quando
 * `buscar()` recebe um `idConversa`, filtra pelos itens DESTA conversa
 * primeiro (descartando os velhos demais, ver `frescorMaximoDias` e
 * `diasVelhoAgora` acima) e só cai pro resto da pasta (comportamento de
 * sempre, sem filtro nenhum) se nada sobrar depois do filtro — nunca os dois
 * exigidos ao mesmo tempo. Reaproveita a MESMA busca híbrida de sempre, só
 * escopada; nenhuma lógica de ranking nova. Trade-off aceito conscientemente
 * (opção escolhida sobre um módulo dedicado, isolado): itens de dossiê
 * entram no MESMO arquivo/teto de 500 itens que as notas de longo prazo
 * (`salvar_memoria`) — uma conversa com muita pesquisa pode, no limite,
 * empurrar notas antigas pra fora mais cedo. Sem rotina de limpeza por
 * conversa nesta primeira versão.
 */
class Memory {
  constructor({ dir, config, log }) {
    this.file = path.join(dir, 'memory.json');
    this.config = config;
    this.log = log || (() => {});
    this.items = [];
    this.vetorial = true;
    this._tokensCache = new WeakMap();
    this.load();
  }

  _tokensDoItem(item) {
    let t = this._tokensCache.get(item);
    if (!t) {
      t = contarTokens(item.texto);
      this._tokensCache.set(item, t);
    }
    return t;
  }

  load() {
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.items = [];
    }
    if (!Array.isArray(this.items)) this.items = [];
    this.limparSegredosAntigos();
  }

  /**
   * Revisão v4 (07/10/2026): antes do mascaramento (segredos.js), cada passo
   * ia pra cá com os argumentos inteiros — inclusive o valor do campo de
   * senha — e a resposta repetia login/senha do pedido. Ao carregar: passos
   * de preencher_campo saem (não servem de memória pra nada) e login/senha
   * escritos no padrão "a senha é (…)" viram ••••••.
   */
  limparSegredosAntigos() {
    let mudou = false;
    const antes = this.items.length;
    this.items = this.items.filter((i) => !(i && /\bpreencher_campo\(/.test(String(i.texto || ''))));
    if (this.items.length !== antes) mudou = true;
    for (const item of this.items) {
      const segredos = segredosDoTexto(item?.texto);
      if (!segredos.length) continue;
      item.texto = mascarar(item.texto, segredos);
      mudou = true;
    }
    if (mudou) this.persist();
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items), 'utf8');
    } catch (err) {
      this.log(`Não foi possível gravar a memória: ${err.message}`);
    }
  }

  async vetor(texto) {
    if (!this.vetorial) return null;
    const vec = await vetorDe(texto, { host: this.config.host, embedModel: this.config.embedModel });
    if (!vec) {
      this.vetorial = false;
      this.log('Memória vetorial desativada (sem resposta do modelo de embedding). Usando similaridade léxica.');
    }
    return vec;
  }

  /**
   * `idConversa`/`bruto` são opcionais e retrocompatíveis: quem já chamava
   * `add(texto, tipo)` (ex.: a ferramenta `salvar_memoria`) continua
   * funcionando igual — item sem `idConversa` (nunca escopado a nenhuma
   * conversa, só entra pelo fallback) e sem frescor calculado. `bruto`, se
   * passado, é usado só na hora de gravar (`diasDesdeDataMaisRecente`) — a
   * Memory nunca guarda o texto bruto inteiro, só o resultado desse cálculo.
   */
  async add(texto, tipo = 'passo', { idConversa = null, bruto } = {}) {
    if (!texto || !String(texto).trim()) return;
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      texto: String(texto).slice(0, 4000),
      tipo,
      em: new Date().toISOString(),
      vec: await this.vetor(texto),
      idConversa: idConversa || null,
      diasVelhoQuandoSalvo: bruto ? diasDesdeDataMaisRecente(bruto) : null,
    };
    this.items.push(item);
    if (this.items.length > 500) this.items = this.items.slice(-500);
    this.persist();
  }

  /** Ranking (híbrido com embedding, ou léxico puro sem ele) escopado a `itens` — miolo repetido por `buscar()`. */
  _ordenar(consulta, itens, vec, k) {
    if (!itens.length) return [];
    if (!vec) {
      const t = tokens(consulta);
      return itens
        .map((i) => ({ item: i, score: jaccard(t, tokens(i.texto)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .filter((r) => r.score > 0.15)
        .map((r) => r.item);
    }
    return ordenarPorHibrido({
      itens,
      vec,
      consultaTokens: [...tokens(consulta)],
      k,
      tokensDoItem: (item) => this._tokensDoItem(item),
    });
  }

  /**
   * `idConversa` (opcional): escopa a busca aos itens desta conversa primeiro
   * — só cai pro resto da pasta se esse filtro não achar nada. `frescorMaximoDias`
   * (opcional, só faz sentido junto de `idConversa`): descarta item velho
   * demais tanto do escopo QUANTO do fallback — um item rejeitado por estar
   * velho não pode reaparecer pela porta dos fundos só porque a busca escopada
   * não achou nada; se está velho demais pra confiar, está velho demais nos
   * dois caminhos. Sem `idConversa`/`frescorMaximoDias`, comportamento
   * idêntico a antes desta peça. O embedding da CONSULTA é calculado uma
   * única vez por chamada mesmo quando as duas buscas (escopada + fallback)
   * rodam — reaproveitado entre elas, nunca pago duas vezes pela mesma
   * pergunta.
   */
  async buscar(consulta, k = 4, { idConversa, frescorMaximoDias } = {}) {
    if (!this.items.length) return [];
    const vec = await this.vetor(consulta);

    const agora = new Date();
    const elegiveis = frescorMaximoDias
      ? this.items.filter((i) => !estaVelhoDemais(i, frescorMaximoDias, agora))
      : this.items;

    if (idConversa) {
      const escopo = elegiveis.filter((i) => i.idConversa === idConversa);
      if (escopo.length) {
        const resultado = this._ordenar(consulta, escopo, vec, k);
        if (resultado.length) return resultado;
      }
    }

    return this._ordenar(consulta, elegiveis, vec, k);
  }

  limpar() {
    this.items = [];
    this.persist();
  }

  get tamanho() {
    return this.items.length;
  }
}

module.exports = { Memory, ordenarPorHibrido, pontuarBM25, contarTokens, diasVelhoAgora };
