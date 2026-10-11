'use strict';

const fs = require('fs/promises');
const path = require('path');
const { executar, formatar } = require('./shell');

const RUNTIMES = {
  javascript: { ext: 'js', bin: process.platform === 'win32' ? 'node' : 'node' },
  node: { ext: 'js', bin: 'node' },
  python: { ext: 'py', bin: process.platform === 'win32' ? 'python' : 'python3' },
};

/**
 * Detecta leitura de arquivo que o script não cria antes, e que também não
 * existe de verdade na pasta de trabalho.
 *
 * Caso real (Davi, 2026-09-14, bateria de projeção do dólar): o modelo
 * chamou `executar_codigo` com `pd.read_csv('historico_dolar.csv')` como se
 * o arquivo já existisse — sem nunca tê-lo escrito (nem com
 * `escrever_arquivo`, nem dentro do próprio script) — e repetiu o MESMO
 * erro 15 passos depois (passos 5 e 20, idêntico). Não é falta de
 * capacidade: a ferramenta pra criar o arquivo existe, o modelo só não a
 * usou. O traceback cru (FileNotFoundError) que o script gerou da primeira
 * vez não foi memorável o bastante pra evitar a repetição. Por isso a
 * checagem roda ANTES de executar — sem gastar um passo inteiro com um
 * script fadado a falhar — e devolve uma instrução acionável em vez de um
 * traceback puro.
 *
 * Escopo deliberadamente estreito, pra evitar falso positivo: só pega
 * caminho escrito como STRING LITERAL (variável/expressão não é capturada —
 * fica de fora do escopo desta checagem, sem bloquear nada); só caminho
 * RELATIVO (absoluto ou URL não é o padrão do bug, fica de fora); e um
 * arquivo que o PRÓPRIO SCRIPT também escreve (`to_csv`, `open(..., 'w')`,
 * `fs.writeFileSync`...) antes de ler nunca é sinalizado — gerar dado
 * sintético e já ler de volta no mesmo script é uso legítimo.
 */
const PADRAO_LEITURA = [
  /pd\.read_(?:csv|excel|json|table)\(\s*['"`]([^'"`]+)['"`]/g,
  /\bopen\(\s*['"`]([^'"`]+)['"`]\s*(?:\)|,\s*['"`]r)/g,
  /fs\.readFileSync?\(\s*['"`]([^'"`]+)['"`]/g,
];
const PADRAO_ESCRITA = [
  /\.to_(?:csv|excel|json)\(\s*['"`]([^'"`]+)['"`]/g,
  /\bopen\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`][wax]/g,
  /fs\.writeFileSync?\(\s*['"`]([^'"`]+)['"`]/g,
];

function caminhosDe(codigo, padroes) {
  const achados = new Set();
  for (const padrao of padroes) {
    for (const m of codigo.matchAll(padrao)) achados.add(m[1]);
  }
  return achados;
}

/** Devolve o primeiro caminho lido-sem-criar que não existe de verdade, ou null. */
async function arquivoInventado(codigo, sandbox) {
  const lidos = caminhosDe(codigo, PADRAO_LEITURA);
  if (!lidos.size) return null;
  const escritos = caminhosDe(codigo, PADRAO_ESCRITA);
  for (const caminho of lidos) {
    if (escritos.has(caminho)) continue;
    if (/^([a-zA-Z]:[\\/]|[\\/]|https?:\/\/)/.test(caminho)) continue; // só relativo — absoluto/URL foge do padrão do bug
    try {
      await fs.access(sandbox.resolve(caminho));
    } catch {
      return caminho;
    }
  }
  return null;
}

module.exports = [
  {
    name: 'executar_codigo',
    risk: 'alto',
    description:
      'Escreve um script temporário e o executa. Use para cálculos, testes e transformações de dados. ' +
      'NUNCA leia um arquivo (CSV, Excel, JSON...) que você mesmo não criou nesta execução (com escrever_arquivo, ou gerado ' +
      'dentro deste mesmo script) — um arquivo não vira real só por ser citado no código; confira com listar_arquivos antes se tiver dúvida.',
    args: {
      linguagem: 'javascript ou python',
      codigo: 'código-fonte completo do script',
    },
    async run({ linguagem = 'python', codigo }, ctx) {
      if (!codigo) throw new Error('Informe "codigo".');
      const runtime = RUNTIMES[String(linguagem).toLowerCase()];
      if (!runtime) {
        throw new Error(`Linguagem não suportada: ${linguagem}. Use javascript ou python.`);
      }

      const inventado = await arquivoInventado(String(codigo), ctx.sandbox);
      if (inventado) {
        throw new Error(
          `O script tenta ler "${inventado}", mas esse arquivo não existe na pasta de trabalho e o script não o cria antes de ler ` +
            '(nem com escrever_arquivo, nem dentro do próprio script). Um arquivo não existe só por ser citado no código. ' +
            'Se os dados vieram de pesquisa/leitura anterior, grave-os primeiro com escrever_arquivo — ou gere o arquivo dentro ' +
            'deste mesmo script antes de lê-lo. Confira com listar_arquivos se tiver dúvida sobre o que já existe.'
        );
      }

      const dir = path.join(ctx.sandbox.root, '.augpt-tmp');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `script_${Date.now()}.${runtime.ext}`);
      await fs.writeFile(file, String(codigo), 'utf8');

      const timeout = ctx.config.codeTimeoutMs;
      const comando = `${runtime.bin} ${JSON.stringify(file)}`;
      const resultado = await executar(comando, { cwd: ctx.sandbox.root, timeout });

      await fs.unlink(file).catch(() => {});
      ctx.emit('workspace-changed');

      if (resultado.code === -1 && /ENOENT|not found|não é reconhecido/i.test(resultado.stderr)) {
        return `${runtime.bin} não está instalado ou não está no PATH. Tente outra linguagem.`;
      }
      return formatar(resultado, timeout);
    },
  },
];
