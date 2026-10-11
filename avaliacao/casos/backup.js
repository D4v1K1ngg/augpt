'use strict';

/**
 * Casos de unidade pra src/tools/backup.js — rede de segurança de
 * escrever_arquivo/acrescentar_ao_arquivo/apagar_arquivo (pedido do Davi 2026-09-18,
 * depois de confirmarmos que essas três ferramentas eram irreversíveis).
 * Usa a Sandbox de verdade sobre uma pasta temporária — mesmo espírito dos
 * outros testes de unidade (ollama-runtime.js) que evitam mockar o que dá
 * pra rodar de verdade e rápido.
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Sandbox } = require('../../src/tools/sandbox');
const backup = require('../../src/tools/backup');
const files = require('../../src/tools/files');

async function pastaTemporaria() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'augpt-backup-teste-'));
}

function ctxFalso(sandbox) {
  return { sandbox, config: {}, emit: () => {} };
}

function ferramenta(nome) {
  return files.find((t) => t.name === nome);
}

module.exports = [
  {
    nome: 'backup: salvarVersaoAnterior não faz nada quando o arquivo ainda não existe',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('novo.txt'); // nunca foi escrito
      const r = await backup.salvarVersaoAnterior(sandbox, alvo);
      return [r === null || `esperava null (nada a preservar), veio ${JSON.stringify(r)}`];
    },
  },

  {
    nome: 'backup: salvarVersaoAnterior preserva o conteúdo antigo, recuperável por listarVersoes/restaurarVersao',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('notas.txt');
      await fs.writeFile(alvo, 'versão original');
      await backup.salvarVersaoAnterior(sandbox, alvo);
      await fs.writeFile(alvo, 'versão nova, sobrescrita por cima');

      const versoes = await backup.listarVersoes(sandbox, 'notas.txt');
      if (versoes.length !== 1) return [`esperava 1 versão salva, veio ${versoes.length}`];

      const r = await backup.restaurarVersao(sandbox, 'notas.txt');
      const conteudoFinal = await fs.readFile(alvo, 'utf8');
      return [
        conteudoFinal === 'versão original' || `esperava restaurar "versão original", veio "${conteudoFinal}"`,
        r.versao === versoes[0] || 'restaurarVersao não usou a versão mais recente por padrão',
      ];
    },
  },

  {
    nome: 'backup: os próprios arquivos de backup ficam invisíveis pra Sandbox.tree() (pasta começa com ".")',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('a.txt');
      await fs.writeFile(alvo, 'x');
      await backup.salvarVersaoAnterior(sandbox, alvo);
      await fs.writeFile(alvo, 'y'); // pra ter mais de uma versão eventualmente

      const arvore = sandbox.tree(100).map((e) => e.path);
      const vazouBackup = arvore.some((p) => p.includes(backup.PASTA_BACKUPS));
      return [!vazouBackup || `a árvore não deveria conter nada de "${backup.PASTA_BACKUPS}": ${JSON.stringify(arvore)}`];
    },
  },

  {
    nome: 'backup: restaurarVersao com "versao" explícita pega uma versão específica, não só a mais recente',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('historico.txt');

      await fs.writeFile(alvo, 'v1');
      await backup.salvarVersaoAnterior(sandbox, alvo); // salva "v1"
      await fs.writeFile(alvo, 'v2');
      await backup.salvarVersaoAnterior(sandbox, alvo); // salva "v2"
      await fs.writeFile(alvo, 'v3'); // conteúdo atual, nunca salvo

      const versoes = await backup.listarVersoes(sandbox, 'historico.txt'); // [v2, v1] (mais recente primeiro)
      if (versoes.length !== 2) return [`esperava 2 versões, veio ${versoes.length}: ${JSON.stringify(versoes)}`];

      await backup.restaurarVersao(sandbox, 'historico.txt', versoes[1]); // pede explicitamente a mais antiga (v1)
      const conteudo = await fs.readFile(alvo, 'utf8');
      return [conteudo === 'v1' || `esperava restaurar "v1", veio "${conteudo}"`];
    },
  },

  {
    nome: 'backup: restaurarVersao sem nenhum backup salvo dá erro claro, não exceção genérica',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      try {
        await backup.restaurarVersao(sandbox, 'fantasma.txt');
        return ['deveria ter lançado erro — não havia backup nenhum'];
      } catch (err) {
        return [/nenhum backup/i.test(err.message) || `mensagem inesperada: "${err.message}"`];
      }
    },
  },

  {
    nome: 'backup: a própria restauração também vira backup (restaurar errado não é sem volta)',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('duplamente-seguro.txt');

      await fs.writeFile(alvo, 'original');
      await backup.salvarVersaoAnterior(sandbox, alvo); // salva "original"
      await fs.writeFile(alvo, 'editado');
      await backup.restaurarVersao(sandbox, 'duplamente-seguro.txt'); // volta pra "original", e agora "editado" devia ter virado backup também

      const versoes = await backup.listarVersoes(sandbox, 'duplamente-seguro.txt');
      return [versoes.length === 2 || `esperava 2 versões salvas após a restauração, veio ${versoes.length}`];
    },
  },

  {
    nome: 'backup: poda mantém só as MAX_VERSOES_POR_ARQUIVO mais recentes',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('log.txt');

      const total = backup.MAX_VERSOES_POR_ARQUIVO + 5;
      for (let i = 0; i < total; i += 1) {
        await fs.writeFile(alvo, `conteúdo ${i}`);
        // eslint-disable-next-line no-await-in-loop
        await backup.salvarVersaoAnterior(sandbox, alvo);
      }

      const versoes = await backup.listarVersoes(sandbox, 'log.txt');
      return [
        versoes.length === backup.MAX_VERSOES_POR_ARQUIVO ||
          `esperava no máximo ${backup.MAX_VERSOES_POR_ARQUIVO} versões após a poda, veio ${versoes.length}`,
      ];
    },
  },

  {
    // Achado testando este módulo (2026-09-18): dois backups do MESMO arquivo
    // disparados sem intervalo caem no mesmo Date.toISOString() (mesmo
    // milissegundo) — sem um desempate, o segundo writeFile sobrescreveria o
    // primeiro backup em silêncio, perdendo exatamente a versão que a rede de
    // segurança existe pra preservar. Corrigido com um contador de desempate
    // em nomeVersao(); este teste prova que duas chamadas nervosas (sem
    // await entre elas) não colidem.
    nome: 'backup: duas chamadas a salvarVersaoAnterior no mesmo instante não se sobrescrevem',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const alvo = sandbox.resolve('rapido.txt');

      await fs.writeFile(alvo, 'estado A');
      await backup.salvarVersaoAnterior(sandbox, alvo);
      await fs.writeFile(alvo, 'estado B');
      // sem nenhum await/setTimeout entre estas duas chamadas — de propósito,
      // pra forçar o caso do mesmo milissegundo
      await backup.salvarVersaoAnterior(sandbox, alvo);

      const versoes = await backup.listarVersoes(sandbox, 'rapido.txt');
      return [versoes.length === 2 || `esperava 2 backups distintos, veio ${versoes.length}: ${JSON.stringify(versoes)}`];
    },
  },

  {
    nome: 'backup + escrever_arquivo: sobrescrever um arquivo existente preserva o conteúdo anterior',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const escrever = ferramenta('escrever_arquivo');
      const ctx = ctxFalso(sandbox);

      await escrever.run({ caminho: 'doc.md', conteudo: 'primeira versão' }, ctx);
      const r = await escrever.run({ caminho: 'doc.md', conteudo: 'segunda versão' }, ctx);

      const versoes = await backup.listarVersoes(sandbox, 'doc.md');
      return [
        versoes.length === 1 || `esperava 1 backup depois da segunda escrita, veio ${versoes.length}`,
        r.includes('preservada') || `mensagem deveria avisar sobre a versão preservada: "${r}"`,
      ];
    },
  },

  {
    nome: 'backup + apagar_arquivo + restaurar_arquivo: apagar e trazer de volta pelo fluxo completo das ferramentas',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const ctx = ctxFalso(sandbox);
      const escrever = ferramenta('escrever_arquivo');
      const apagar = ferramenta('apagar_arquivo');
      const restaurar = ferramenta('restaurar_arquivo');
      const listar = ferramenta('listar_backups');

      await escrever.run({ caminho: 'relatorio.txt', conteudo: 'conteúdo importante' }, ctx);
      await apagar.run({ caminho: 'relatorio.txt' }, ctx);

      const existeAntesDeRestaurar = await fs
        .access(sandbox.resolve('relatorio.txt'))
        .then(() => true)
        .catch(() => false);

      const listagem = await listar.run({ caminho: 'relatorio.txt' }, ctx);
      await restaurar.run({ caminho: 'relatorio.txt' }, ctx);
      const conteudoRestaurado = await fs.readFile(sandbox.resolve('relatorio.txt'), 'utf8');

      return [
        existeAntesDeRestaurar === false || 'o arquivo não deveria existir logo após apagar_arquivo',
        listagem.includes('mais recente') || `listar_backups deveria mostrar a versão: "${listagem}"`,
        conteudoRestaurado === 'conteúdo importante' ||
          `esperava o conteúdo original de volta, veio "${conteudoRestaurado}"`,
      ];
    },
  },

  {
    nome: 'backup + listar_backups: arquivo sem histórico devolve mensagem clara, não erro nem lista vazia confusa',
    tipo: 'unidade',
    async executar() {
      const raiz = await pastaTemporaria();
      const sandbox = new Sandbox(raiz);
      const ctx = ctxFalso(sandbox);
      const listar = ferramenta('listar_backups');

      const r = await listar.run({ caminho: 'nunca-existiu.txt' }, ctx);
      return [/nenhum backup/i.test(r) || `mensagem inesperada: "${r}"`];
    },
  },
];
