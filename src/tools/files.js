'use strict';

const fs = require('fs/promises');
const path = require('path');
const { extrair, TEXTO } = require('../formatos');
const backup = require('./backup');

const MAX_READ = 60000; // caracteres devolvidos ao modelo

module.exports = [
  {
    name: 'listar_arquivos',
    risk: 'baixo',
    description: 'Lista arquivos e pastas dentro da pasta de trabalho.',
    args: { caminho: 'pasta relativa, use "." para a raiz' },
    // Achado real de produção (2026-09-14, rastro de 24 passos): o modelo
    // chamou sem "caminho" duas vezes, cada uma um passo inteiro perdido em
    // "argumentos-invalidos". O `run()` já tem default `'.'` pra esse caso —
    // mas `validarArgumentos` (protocolo.js) só respeita esse default quando
    // a ferramenta declara `obrigatorios` explicitamente; sem isso, ela cai
    // na convenção "o primeiro argumento declarado é essencial" e rejeita
    // ANTES do run() rodar, tornando o default morto letra.
    obrigatorios: [],
    async run({ caminho = '.' }, ctx) {
      const dir = ctx.sandbox.resolve(caminho);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (!entries.length) return 'Pasta vazia.';
      const lines = await Promise.all(
        entries.map(async (e) => {
          if (e.isDirectory()) return `${e.name}/`;
          const stat = await fs.stat(path.join(dir, e.name));
          return `${e.name}  (${stat.size} bytes)`;
        })
      );
      return lines.join('\n');
    },
  },

  {
    name: 'ler_arquivo',
    risk: 'baixo',
    description: 'Lê o conteúdo de um arquivo de texto.',
    args: { caminho: 'arquivo relativo à pasta de trabalho' },
    async run({ caminho }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const { caminho: file, corrigido } = ctx.sandbox.encontrar(caminho);
      const nota = corrigido ? `[nome corrigido: "${caminho}" → "${corrigido}"]\n` : '';
      const ext = path.extname(corrigido || caminho).toLowerCase();

      // PDF, docx, xlsx e afins não são texto: delega para o extrator em vez
      // de devolver bytes ilegíveis ao modelo.
      if (!TEXTO.has(ext)) {
        const r = extrair(file, { limite: MAX_READ });
        return `${nota}[${path.basename(file)} · ${r.tipo}]\n\n${r.texto || '(sem texto extraível)'}`;
      }

      const content = await fs.readFile(file, 'utf8');
      if (content.length > MAX_READ) {
        return `${nota}${content.slice(0, MAX_READ)}\n\n[...truncado: ${content.length - MAX_READ} caracteres restantes]`;
      }
      return `${nota}${content || '[arquivo vazio]'}`;
    },
  },

  {
    name: 'escrever_arquivo',
    risk: 'medio',
    description: 'Cria ou sobrescreve um arquivo de texto. Cria as pastas necessárias.',
    args: { caminho: 'arquivo relativo', conteudo: 'texto completo do arquivo' },
    async run({ caminho, conteudo = '' }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const file = ctx.sandbox.resolve(caminho);
      // pedido de Davi 2026-09-18: sobrescrever não pode mais ser sem volta —
      // ver src/tools/backup.js. Se o arquivo ainda não existe, não há nada
      // pra preservar (salvarVersaoAnterior devolve null nesse caso).
      const versaoAnterior = await backup.salvarVersaoAnterior(ctx.sandbox, file);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, String(conteudo), 'utf8');
      ctx.emit('workspace-changed');
      const nota = versaoAnterior ? ' (versão anterior preservada — restaurar_arquivo desfaz)' : '';
      return `Gravado ${Buffer.byteLength(conteudo)} bytes em ${caminho}${nota}`;
    },
  },

  {
    // Revisão v3 (chats de 29/09): chamava `anexar_arquivo`. Em português
    // "anexar" soa como "anexar um vídeo/arquivo à conversa" — o 7B chamou
    // anexar_arquivo("tutorial….mp4") achando que o usuário tinha mandado um
    // vídeo, e a ferramenta CRIOU um .mp4 vazio na pasta de trabalho. Nome
    // novo diz o que ela faz; conteúdo vazio e arquivo de mídia são recusados.
    name: 'acrescentar_ao_arquivo',
    risk: 'medio',
    description: 'Acrescenta TEXTO ao final de um arquivo de texto (.txt, .md, .csv, .json…). Não anexa arquivo à conversa e não abre mídia.',
    args: { caminho: 'arquivo de texto relativo', conteudo: 'texto a acrescentar' },
    obrigatorios: ['caminho', 'conteudo'],
    async run({ caminho, conteudo = '' }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      if (!String(conteudo).trim()) {
        throw new Error('Informe "conteudo": esta ferramenta só ACRESCENTA texto ao fim de um arquivo de texto. Ela não anexa arquivos à conversa.');
      }
      if (/\.(mp4|mkv|avi|mov|webm|mp3|wav|ogg|flac|jpe?g|png|gif|webp|bmp|pdf|docx?|xlsx?|pptx?|zip|rar|7z|exe|dll)$/i.test(String(caminho).trim())) {
        throw new Error(`"${caminho}" não é arquivo de texto: acrescentar_ao_arquivo só escreve texto (.txt, .md, .csv, .json…). Ela não abre nem anexa mídia ou documentos.`);
      }
      let file;
      let corrigido = null;
      try {
        ({ caminho: file, corrigido } = ctx.sandbox.encontrar(caminho));
      } catch {
        file = ctx.sandbox.resolve(caminho); // arquivo novo: cria mesmo
      }
      // mesma rede de segurança de escrever_arquivo — ver src/tools/backup.js
      await backup.salvarVersaoAnterior(ctx.sandbox, file);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, String(conteudo), 'utf8');
      ctx.emit('workspace-changed');
      return `Acrescentado a ${corrigido || caminho}`;
    },
  },

  {
    name: 'apagar_arquivo',
    risk: 'alto',
    description: 'Apaga um arquivo da pasta de trabalho.',
    args: { caminho: 'arquivo relativo' },
    async run({ caminho }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      // apagar nunca resolve por aproximação: apagar o arquivo errado é grave
      // demais pra adivinhar o nome — mas deixou de ser "sem volta": ver
      // src/tools/backup.js e a ferramenta restaurar_arquivo, abaixo.
      const { caminho: alvo } = ctx.sandbox.encontrar(caminho, { permitirAproximado: false });
      await backup.salvarVersaoAnterior(ctx.sandbox, alvo);
      await fs.unlink(alvo);
      ctx.emit('workspace-changed');
      return `${caminho} apagado (versão anterior preservada — restaurar_arquivo desfaz).`;
    },
  },

  {
    name: 'restaurar_arquivo',
    risk: 'medio',
    description: 'Restaura a versão anterior de um arquivo que foi sobrescrito, alterado ou apagado pelo agente.',
    args: {
      caminho: 'arquivo relativo à pasta de trabalho',
      versao: 'nome exato da versão a restaurar (opcional — sem isso, usa a mais recente salva por listar_backups)',
    },
    async run({ caminho, versao }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const r = await backup.restaurarVersao(ctx.sandbox, caminho, versao || null);
      ctx.emit('workspace-changed');
      return `${r.restaurado} restaurado a partir do backup "${r.versao}".`;
    },
  },

  {
    name: 'listar_backups',
    risk: 'baixo',
    description: 'Lista as versões anteriores salvas automaticamente de um arquivo (backups feitos antes de cada sobrescrita, anexação ou remoção).',
    args: { caminho: 'arquivo relativo à pasta de trabalho' },
    async run({ caminho }, ctx) {
      if (!caminho) throw new Error('Informe "caminho".');
      const versoes = await backup.listarVersoes(ctx.sandbox, caminho);
      if (!versoes.length) return `Nenhum backup encontrado para "${caminho}".`;
      return versoes.map((v, i) => (i === 0 ? `${v} (mais recente)` : v)).join('\n');
    },
  },

  {
    name: 'buscar_no_projeto',
    risk: 'baixo',
    description: 'Procura um trecho de texto em todos os arquivos da pasta de trabalho.',
    args: { termo: 'texto a procurar' },
    async run({ termo }, ctx) {
      if (!termo) throw new Error('Informe "termo".');
      const hits = [];
      const alvo = String(termo).toLowerCase();
      for (const entry of ctx.sandbox.tree(800)) {
        if (entry.dir || entry.size > 2_000_000) continue;
        try {
          const content = await fs.readFile(ctx.sandbox.resolve(entry.path), 'utf8');
          content.split('\n').forEach((line, i) => {
            if (line.toLowerCase().includes(alvo) && hits.length < 60) {
              hits.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 200)}`);
            }
          });
        } catch {
          /* binário ou sem permissão */
        }
      }
      return hits.length ? hits.join('\n') : `Nenhuma ocorrência de "${termo}".`;
    },
  },
];
