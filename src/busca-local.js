'use strict';

/**
 * Busca nos seus arquivos (31/10, pedido do Davi: "onde está aquilo?"). Só nas pastas que você escolher em
 * Ajustes (desligado por padrão), o AuGPT lê os documentos — PDF, Word, Excel, PowerPoint, texto e, se você
 * quiser, o texto de fotos e prints (OCR) — e guarda um índice em <dados>/busca-local/indice.json. Nada sai do
 * PC: o "sentido" de cada arquivo vem do nomic-embed-text, no Ollama local.
 *
 * A busca junta duas notas: as palavras (todas as do pedido no nome ou no texto, com peso para o nome) e o
 * sentido ("contrato do aluguel" acha "locação"). Atualizar só relê o que mudou (data e tamanho).
 */

const fs = require('fs');
const path = require('path');
const { extrair } = require('./formatos');
const { cosine } = require('./agent/embeddings');

const DOCUMENTOS = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.epub', '.txt', '.md', '.csv']);
const IMAGENS = new Set(['.png', '.jpg', '.jpeg']);
const PULAR = /^(node_modules|\.git|\.svn|appdata|\$recycle\.bin|system volume information|windows|program files.*|programdata|\.cache|\.vscode|venv|\.venv|__pycache__)$/i;
const MAX_ARQUIVOS = 4000;
const MAX_TEXTO = 12000; // por arquivo
const VERSAO = 1;

const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const PARADAS = new Set(['a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'pra', 'pro', 'com', 'por', 'que', 'meu', 'minha', 'meus', 'minhas', 'aquele', 'aquela', 'esse', 'essa', 'the', 'of', 'and', 'my']);
const palavras = (t) => semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((p) => p.length >= 2 && !PARADAS.has(p));

const paraBase64 = (v) => Buffer.from(Float32Array.from(v).buffer).toString('base64');
const deBase64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

const instancias = new Map();

class BuscaLocal {
  /** Uma por pasta: o processo principal (que atualiza) e a rota do chat (que busca) veem o mesmo índice. */
  static de(dir, deps = {}) {
    if (!instancias.has(dir)) instancias.set(dir, new BuscaLocal(dir, deps));
    const b = instancias.get(dir);
    for (const [k, v] of Object.entries(deps)) if (!b.deps[k]) b.deps[k] = v; // quem criou primeiro manda
    return b;
  }

  /** @param dir <dados>/busca-local; `deps`: { vetor(texto) → número[] | null, ocr(arquivo) → texto, ocupado() → bool } */
  constructor(dir, deps = {}) {
    this.dir = dir;
    this.arquivo = path.join(dir, 'indice.json');
    this.deps = deps;
    this.indice = null;
    this.rodando = null;
  }

  carregar() {
    if (this.indice) return this.indice;
    try {
      const j = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      this.indice = j.versao === VERSAO ? j : { versao: VERSAO, arquivos: {}, atualizado: 0 };
    } catch {
      this.indice = { versao: VERSAO, arquivos: {}, atualizado: 0 };
    }
    return this.indice;
  }

  gravar() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.indice));
    fs.renameSync(tmp, this.arquivo);
  }

  estado() {
    const i = this.carregar();
    return { arquivos: Object.keys(i.arquivos).length, atualizado: i.atualizado || 0, indexando: Boolean(this.rodando), progresso: this.progresso || null };
  }

  apagar() {
    this.indice = { versao: VERSAO, arquivos: {}, atualizado: 0 };
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** Os arquivos das pastas (com limite e sem pastas de sistema). */
  listar(pastas, { comImagens = false } = {}) {
    const out = [];
    const andar = (dir, nivel) => {
      if (out.length >= MAX_ARQUIVOS || nivel > 8) return;
      let itens = [];
      try {
        itens = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of itens) {
        if (out.length >= MAX_ARQUIVOS) return;
        if (it.name.startsWith('.') || it.name.startsWith('~$')) continue;
        const p = path.join(dir, it.name);
        if (it.isDirectory()) {
          if (!PULAR.test(it.name)) andar(p, nivel + 1);
        } else if (it.isFile()) {
          const ext = path.extname(it.name).toLowerCase();
          if (DOCUMENTOS.has(ext) || (comImagens && IMAGENS.has(ext))) out.push(p);
        }
      }
    };
    for (const pasta of pastas) andar(pasta, 0);
    return out;
  }

  /**
   * Lê o que é novo ou mudou e tira o que sumiu. Pausa enquanto `ocupado()` (jogo em tela cheia, o agente
   * trabalhando) e para com `signal`. → { lidos, removidos, total }
   */
  async atualizar(pastas, { comImagens = false, emitir = () => {}, signal } = {}) {
    if (this.rodando) return this.rodando;
    this.rodando = (async () => {
      const i = this.carregar();
      const lista = this.listar(pastas, { comImagens });
      const presentes = new Set(lista);
      let removidos = 0;
      for (const p of Object.keys(i.arquivos)) {
        if (!presentes.has(p)) {
          delete i.arquivos[p];
          removidos += 1;
        }
      }
      let lidos = 0;
      let desdeGravar = 0;
      for (let n = 0; n < lista.length; n += 1) {
        if (signal?.aborted) break;
        const p = lista[n];
        let stat;
        try {
          stat = fs.statSync(p);
        } catch {
          continue;
        }
        const ja = i.arquivos[p];
        if (ja && ja.mtime === stat.mtimeMs && ja.tamanho === stat.size) continue;
        // a conferência do Windows custa ~0,8 s (PowerShell): uma a cada 20 s, não por arquivo (31/10: 12 arquivos levavam 10 s)
        while (this.deps.ocupado && Date.now() - (this.conferidoEm || 0) > 20000 && ((this.conferidoEm = Date.now()), await this.deps.ocupado())) {
          this.conferidoEm = 0; // ocupado: confere de novo na próxima volta
          this.progresso = { feitos: n, total: lista.length, pausado: true };
          emitir(this.progresso);
          if (signal?.aborted) break;
          await new Promise((r) => setTimeout(r, 15000));
        }
        this.progresso = { feitos: n, total: lista.length, arquivo: path.basename(p) };
        if (n % 10 === 0) emitir(this.progresso);
        const ext = path.extname(p).toLowerCase();
        let texto = '';
        try {
          if (IMAGENS.has(ext)) texto = stat.size <= 6 * 1024 * 1024 && this.deps.ocr ? String((await this.deps.ocr(p)) || '') : '';
          else if (stat.size <= 40 * 1024 * 1024) texto = extrair(p, { limite: MAX_TEXTO }).texto || '';
        } catch {
          texto = ''; // protegido, estragado, formato antigo: fica só o nome
        }
        texto = texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
        const nome = path.basename(p);
        let vetor = null;
        try {
          // os prefixos do nomic-embed-text (search_document / search_query) separam bem melhor
          const v = this.deps.vetor ? await this.deps.vetor(`search_document: ${nome.replace(/[._-]+/g, ' ')}\n${texto.slice(0, 1500)}`) : null;
          vetor = v?.length ? paraBase64(v) : null;
        } catch {
          vetor = null;
        }
        i.arquivos[p] = { nome, mtime: stat.mtimeMs, tamanho: stat.size, texto, vetor };
        lidos += 1;
        desdeGravar += 1;
        if (desdeGravar >= 50) {
          this.gravar();
          desdeGravar = 0;
        }
        await new Promise((r) => setImmediate(r)); // a tela não trava
      }
      i.atualizado = Date.now();
      this.gravar();
      this.progresso = null;
      emitir({ fim: true, lidos, removidos, total: Object.keys(i.arquivos).length });
      return { lidos, removidos, total: Object.keys(i.arquivos).length };
    })().finally(() => {
      this.rodando = null;
    });
    return this.rodando;
  }

  /** Os arquivos que mais batem com o pedido: [{ caminho, nome, nota, trecho, mtime }]. */
  async buscar(consulta, { n = 6 } = {}) {
    const i = this.carregar();
    const busca = palavras(consulta);
    const vq = this.deps.vetor ? await this.deps.vetor(`search_query: ${consulta}`).catch(() => null) : null;
    const lista = Object.entries(i.arquivos).map(([caminho, a]) => {
      const v = vq && a.vetor ? deBase64(a.vetor) : null;
      // outro modelo de embedding (outro tamanho de vetor) não compara: até a próxima leitura, só as palavras
      return { caminho, a, sentido: v && v.length === vq.length ? cosine(vq, v) : null };
    });
    // o sentido do nomic não tem um "zero" fixo (coisas sem relação dão 0,45-0,57): vale o quanto passa da mediana
    const sentidos = lista.map((x) => x.sentido).filter((s) => s != null).sort((a, b) => a - b);
    const mediana = sentidos.length ? sentidos[Math.floor(sentidos.length / 2)] : 0;
    const notas = [];
    for (const { caminho, a, sentido } of lista) {
      const nome = new Set(palavras(a.nome));
      const texto = semAcento(a.texto);
      let lexica = 0;
      for (const b of busca) {
        if (nome.has(b) || [...nome].some((w) => b.length >= 4 && w.startsWith(b))) lexica += 2;
        else if (texto.includes(b)) lexica += 1;
      }
      const fracao = busca.length ? lexica / (2 * busca.length) : 0;
      const nota = fracao * 0.6 + (sentido != null && sentidos.length >= 3 ? Math.max(0, sentido - mediana - 0.03) * 5 : 0);
      if (nota >= 0.2) notas.push({ caminho, a, nota });
    }
    notas.sort((x, y) => y.nota - x.nota);
    // o que fica muito abaixo do melhor é ruído
    return notas.filter((x) => x.nota >= notas[0].nota * 0.4).slice(0, n).map(({ caminho, a, nota }) => ({ caminho, nome: a.nome, nota: Math.round(nota * 100) / 100, mtime: a.mtime, trecho: trechoCom(a.texto, busca), texto: a.texto }));
  }
}

/** ~220 caracteres em volta da primeira palavra da busca que aparece no texto. */
function trechoCom(texto, busca) {
  const t = String(texto || '');
  if (!t) return '';
  const baixo = semAcento(t);
  const pos = busca.map((b) => baixo.indexOf(b)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0;
  const ini = Math.max(0, pos - 80);
  return `${ini ? '…' : ''}${t.slice(ini, ini + 220).trim()}${ini + 220 < t.length ? '…' : ''}`;
}

module.exports = { BuscaLocal, palavras, trechoCom, DOCUMENTOS, IMAGENS };
