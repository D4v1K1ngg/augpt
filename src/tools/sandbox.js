'use strict';

const fs = require('fs');
const path = require('path');

/** Compara nomes ignorando acento, caixa, espaço, hífen e underline. */
function achatar(nome) {
  return String(nome)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

/** Distância de edição, limitada — só interessa saber se é perto. */
function distancia(a, b, teto = 4) {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let melhor = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      melhor = Math.min(melhor, atual[j]);
    }
    if (melhor > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Todo acesso a disco do agente passa por aqui. Caminhos que escapam da pasta
 * de trabalho são rejeitados antes de qualquer operação de I/O.
 */
class Sandbox {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    // A própria pasta de trabalho pode ser um link legítimo (ex.: Documentos
    // redirecionado pro OneDrive) — por isso a comparação real é contra o
    // destino verdadeiro dela, não contra o caminho digitado.
    try {
      this.rootReal = fs.realpathSync(this.root);
    } catch {
      this.rootReal = this.root;
    }
  }

  resolve(relativePath = '.') {
    const target = path.resolve(this.root, relativePath);
    const rel = path.relative(this.root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Caminho fora da pasta de trabalho: ${relativePath}`);
    }
    this.conferirDestinoReal(target, relativePath);
    return target;
  }

  /**
   * Fase 1 de segurança (2026-09-23): a checagem acima é só de TEXTO. Um link
   * simbólico ou junção DENTRO da pasta (vindo de um zip extraído, de um git
   * clone ou de um comando) apontando pra fora deixava `ler_arquivo` — que
   * nem pede aprovação — ler qualquer arquivo do computador por "pasta/link/…".
   *
   * Aqui se resolve o destino verdadeiro do trecho do caminho que já existe
   * (o arquivo, ou a pasta-mãe mais próxima quando é um arquivo novo) e se
   * confere de novo contra a raiz real. Um link quebrado conta como fora:
   * escrever nele criaria o arquivo onde o link aponta, não aqui dentro.
   */
  conferirDestinoReal(target, pedido) {
    let existente = target;
    for (;;) {
      try {
        fs.lstatSync(existente);
        break;
      } catch {
        const pai = path.dirname(existente);
        if (pai === existente) return; // nada no caminho existe ainda: não há link a seguir
        existente = pai;
      }
    }
    let real;
    try {
      real = fs.realpathSync(existente);
    } catch {
      throw new Error(`Caminho fora da pasta de trabalho (link quebrado): ${pedido}`);
    }
    const relReal = path.relative(this.rootReal, real);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
      throw new Error(`Caminho fora da pasta de trabalho (atalho ou link apontando pra fora): ${pedido}`);
    }
  }

  relative(absolutePath) {
    return path.relative(this.root, absolutePath) || '.';
  }

  /**
   * Resolve o caminho tolerando erro de digitação do modelo.
   *
   * Modelo pequeno troca uma letra do nome com frequência — "importante-4.txt"
   * vira "important-4.txt" — e um ENOENT cru manda o agente para um beco:
   * ele conclui que o arquivo não existe e vai procurar em Downloads.
   *
   * Aqui, se houver UM candidato claramente parecido, ele é usado, e a correção
   * é informada. Havendo vários, o erro lista as opções em vez de adivinhar.
   */
  encontrar(caminhoRelativo, { permitirAproximado = true } = {}) {
    const alvo = this.resolve(caminhoRelativo);
    if (fs.existsSync(alvo)) return { caminho: alvo, corrigido: null };

    const procurado = path.basename(caminhoRelativo);
    const achatadoAlvo = achatar(procurado);
    const semExtensao = achatar(procurado.replace(/\.[^.]+$/, ''));

    const arquivos = this.tree(600).filter((e) => !e.dir);
    const candidatos = arquivos
      .map((e) => {
        const nome = achatar(e.name);
        const base = achatar(e.name.replace(/\.[^.]+$/, ''));
        let pontos = 0;
        if (nome === achatadoAlvo) pontos = 100;
        else if (base === semExtensao) pontos = 90;
        else if (nome.includes(achatadoAlvo) || achatadoAlvo.includes(nome)) pontos = 70;
        else {
          const d = distancia(nome, achatadoAlvo);
          if (d <= 2) pontos = 60 - d * 10;
        }
        return { entrada: e, pontos };
      })
      .filter((c) => c.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos);

    if (permitirAproximado && candidatos.length) {
      const melhor = candidatos[0];
      const empate = candidatos.filter((c) => c.pontos === melhor.pontos);
      if (empate.length === 1) {
        return { caminho: this.resolve(melhor.entrada.path), corrigido: melhor.entrada.path };
      }
    }

    const lista = (candidatos.length ? candidatos.map((c) => c.entrada.path) : arquivos.map((a) => a.path))
      .slice(0, 12)
      .join(', ');

    throw new Error(
      `"${caminhoRelativo}" não existe na pasta de trabalho.` +
        (candidatos.length
          ? ` Nomes parecidos: ${lista}. Use o nome exato.`
          : ` Arquivos disponíveis: ${lista || '(pasta vazia)'}.`)
    );
  }

  /** Árvore de arquivos para exibir na interface. */
  tree(maxEntries = 400) {
    const out = [];
    const walk = (dir, depth) => {
      if (out.length >= maxEntries || depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const isDir = entry.isDirectory();
        let size = 0;
        if (!isDir) {
          try {
            size = fs.statSync(full).size;
          } catch {
            /* ignora */
          }
        }
        out.push({ path: this.relative(full), name: entry.name, dir: isDir, depth, size });
        if (isDir) walk(full, depth + 1);
        if (out.length >= maxEntries) return;
      }
    };
    walk(this.root, 0);
    return out;
  }
}

/**
 * Fase 1 de segurança (2026-09-23): "Abrir com o app padrão" chamava
 * `shell.openPath` em QUALQUER arquivo da pasta — inclusive .exe, .bat, .lnk,
 * .hta, .js (que no Windows roda direto no Windows Script Host) — e o agente
 * pode escrever arquivos. Só formatos de documento e mídia abrem direto; o
 * resto só é mostrado na pasta, e abrir fica por conta de quem decidir.
 */
const EXTENSOES_ABRIVEIS = new Set([
  'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'log', 'rtf', 'epub', 'html', 'htm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mkv',
]);

function podeAbrirComAppPadrao(caminho) {
  const ext = path.extname(String(caminho || '')).slice(1).toLowerCase();
  return EXTENSOES_ABRIVEIS.has(ext);
}

module.exports = { Sandbox, achatar, distancia, podeAbrirComAppPadrao };
