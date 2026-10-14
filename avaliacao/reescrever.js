'use strict';

/**
 * Refaz SÓ a escrita dos cartões de uma execução real, sem pesquisar de novo
 * (14/10). Lê os dossiês gravados no registro (pesquisaPlanejada.cartoes) e
 * chama o modelo de verdade — 1 minuto em vez de 8 para comparar prompt ou
 * modelo sobre o mesmo material.
 *
 *   node avaliacao/reescrever.js <id-da-execução | caminho.json> [--modelo=qwen2.5:14b] [--paralelo=2] [--host=http://127.0.0.1:11434]
 *
 * Sem id: a execução mais recente que tem dossiês.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const ollama = require('../src/llm/ollama');
const { escreverCartoes, CAMPOS } = require('../src/agent/escritor-de-cartoes');
const checagens = require('./qualidade/checagens-de-produto');

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const alvo = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dirExec = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'AuGPT', 'execucoes');

function carregar() {
  if (alvo && fs.existsSync(alvo)) return JSON.parse(fs.readFileSync(alvo, 'utf8'));
  if (alvo) return JSON.parse(fs.readFileSync(path.join(dirExec, `${alvo.replace(/\.json$/, '')}.json`), 'utf8'));
  const arqs = fs.readdirSync(dirExec).map((f) => ({ f, t: fs.statSync(path.join(dirExec, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of arqs) {
    const j = JSON.parse(fs.readFileSync(path.join(dirExec, f), 'utf8'));
    if (j.pesquisaPlanejada?.cartoes?.dossies?.length) return j;
  }
  throw new Error('nenhuma execução com dossiês gravados (rode uma pesquisa de produto com a versão de 14/10)');
}

(async () => {
  const exec = carregar();
  const gravado = exec.pesquisaPlanejada?.cartoes;
  if (!gravado?.dossies?.length) throw new Error(`a execução ${exec.id} não tem dossiês gravados`);
  const modelo = args.modelo || gravado.modelo || 'qwen2.5:7b';
  const host = args.host || 'http://127.0.0.1:11434';
  console.log(`execução ${exec.id} · "${exec.pedido}" · ${gravado.dossies.length} dossiê(s) · modelo ${modelo}`);
  const inicio = Date.now();
  const cartoes = await escreverCartoes({
    dossies: gravado.dossies,
    contexto: gravado.contexto,
    paralelo: Number(args.paralelo) || 1,
    aviso: (t) => console.log(`  aviso: ${t}`),
    chamar: async (prompt) => (await ollama.chat({ host, model: modelo, messages: [{ role: 'user', content: prompt }], temperature: 0.4, numCtx: 8192, numPredict: 700 })).content,
  });
  const seg = Math.round((Date.now() - inicio) / 1000);
  // monta os cartões no formato da resposta, para as checagens de texto
  const texto = [...cartoes].map(([nome, c], i) => [`#### ${i + 1}. ${nome}`, ...CAMPOS.filter((k) => c[k.chave]).map((k) => `**${k.titulo}:** ${c[k.chave]}`)].join('\n\n')).join('\n\n');
  console.log(`\n${texto}\n`);
  console.log(`--- ${cartoes.size} de ${gravado.dossies.length} cartões · ${seg} s`);
  console.log(`frases repetidas entre cartões: ${checagens.frasesRepetidas(texto).length}`);
  console.log(`comentários colados: ${checagens.comentariosColados(texto).length}`);
  console.log(`termos explicados: ${checagens.termosExplicados(texto).length}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
