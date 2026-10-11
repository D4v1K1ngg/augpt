#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const { Registros } = require('../src/registro');

/**
 * Comparação de modelos.
 *
 *   npm run comparar -- llama3.1 qwen2.5:14b
 *   npm run comparar -- llama3.1 "qwen2.5:3b→qwen2.5:14b"
 *
 * A seta configura o modo híbrido: modelo da esquerda decide, o da direita
 * redige. Roda o mesmo conjunto de tarefas em cada configuração e imprime a
 * tabela — que é a resposta para "vale a pena o modelo maior?".
 */

const COR = process.stdout.isTTY;
const c = (n, t) => (COR ? `\u001b[${n}m${t}\u001b[0m` : t);
const cinza = (t) => c(90, t);
const amarelo = (t) => c(33, t);
const verde = (t) => c(32, t);

const alvos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!alvos.length) {
  console.log(`
Uso:  npm run comparar -- <modelo> [modelo...]

  npm run comparar -- llama3.1 qwen2.5:14b
  npm run comparar -- "qwen2.5:3b→qwen2.5:14b"     (híbrido: decide → redige)

Roda as tarefas reais em cada configuração e compara.
Exige o Ollama no ar e os modelos já baixados.
`);
  process.exit(0);
}

const dirRegistros =
  process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData/Roaming/AuGPT/execucoes')
    : path.join(os.homedir(), '.config/AuGPT/execucoes');

function medir(alvo) {
  const [decisao, redacao] = alvo.split(/→|->/).map((s) => s.trim());
  const rotulo = redacao ? `${decisao} → ${redacao}` : decisao;

  console.log(`\n${amarelo('▶')} ${rotulo}`);

  const inicio = Date.now();
  const r = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'executar.js'),
      '--real',
      `--modelo=${decisao}`,
      ...(redacao ? [`--modeloRedacao=${redacao}`] : []),
      `--registros=${dirRegistros}`,
    ],
    { encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 }
  );

  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(
    saida
      .split('\n')
      .filter((l) => /✓|~|✗|fatos|MEDIÇÃO|faltou|inventou/.test(l))
      .map((l) => `  ${l.trim()}`)
      .join('\n')
  );

  const numero = (rotuloProcurado) => {
    const m = new RegExp(`${rotuloProcurado}\\s+([\\d.,]+)`).exec(saida);
    return m ? Number(m[1].replace(',', '.')) : null;
  };

  return {
    rotulo,
    fatos: numero('fatos encontrados'),
    passos: numero('passos por tarefa'),
    segundos: numero('segundos por tarefa'),
    total: Number(((Date.now() - inicio) / 1000).toFixed(0)),
    inventou: /inventou dado em (\d+)/.exec(saida)?.[1] || 0,
    falhou: r.status !== 0 && !/MEDIÇÃO/.test(saida),
  };
}

const resultados = alvos.map(medir);

console.log(`\n${'─'.repeat(72)}`);
const colunas = [
  ['configuração', (r) => r.rotulo, 26],
  ['fatos', (r) => (r.fatos === null ? '—' : `${r.fatos}%`), 7],
  ['passos', (r) => r.passos ?? '—', 8],
  ['s/tarefa', (r) => r.segundos ?? '—', 10],
  ['inventou', (r) => r.inventou, 9],
  ['total', (r) => `${r.total}s`, 7],
];

console.log(colunas.map(([t, , l]) => cinza(t.padEnd(l))).join(''));
for (const r of resultados) {
  const melhor = r.fatos === Math.max(...resultados.map((x) => x.fatos ?? -1));
  const linha = colunas.map(([, f, l]) => String(f(r)).padEnd(l)).join('');
  console.log(melhor && r.fatos !== null ? verde(linha) : linha);
}

console.log(
  cinza(
    '\nfatos = proporção dos dados esperados que apareceram na resposta.\n' +
      'Modelo mais lento pode perder no uso real mesmo ganhando em fatos — olhe s/tarefa.\n' +
      'Detalhe por execução na aba Execuções do app.'
  )
);

try {
  const total = new Registros(dirRegistros).listar({ origem: 'bancada' }).length;
  console.log(cinza(`${total} execuções de bancada registradas em ${dirRegistros}`));
} catch {
  /* sem registros ainda */
}
