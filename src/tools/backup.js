'use strict';

const fs = require('fs/promises');
const path = require('path');

/**
 * Rede de segurança pra `escrever_arquivo`, `acrescentar_ao_arquivo` e `apagar_arquivo`
 * (ver src/tools/files.js) — pedido do Davi 2026-09-18, depois de confirmarmos
 * que hoje NENHUMA dessas três tem qualquer forma de recuperação: sobrescrita e
 * remoção são definitivas (o próprio apagar_arquivo já tinha o comentário
 * "apagar o arquivo errado não tem volta" — isso deixa de ser verdade).
 *
 * A ideia é simples: antes de qualquer uma das três operações mexer no conteúdo
 * de um arquivo que já existia, uma cópia do que ele tinha ANTES é salva aqui.
 * Não é controle de versão de verdade (sem diff, sem histórico por commit) —
 * é só "o que tinha um instante atrás", o suficiente pra desfazer um engano do
 * agente sem depender de o usuário ter outro backup por fora.
 *
 * Os backups vivem DENTRO da própria sandbox, numa pasta espelhando a estrutura
 * do projeto (ex.: notas.txt → .augpt-backups/notas.txt/<versão>.bak) — mesma
 * fronteira de segurança que já vale pra qualquer outro arquivo (Sandbox.resolve
 * não deixa nada escapar da pasta de trabalho, então também não deixa os
 * backups escaparem). O nome começa com "." de propósito: Sandbox.tree() já
 * ignora entradas começando com "." (sandbox.js, dentro de walk()), então os
 * backups ficam automaticamente fora da árvore que a interface mostra, fora de
 * buscar_no_projeto e fora do encontrar() por aproximação — não viram "arquivo
 * do projeto" nem pro modelo nem pro usuário, só aparecem via listar_backups.
 */

const PASTA_BACKUPS = '.augpt-backups';

// Teto por arquivo — sem isso, um agente que reescreve o mesmo arquivo em loop
// (já aconteceu, ver AuGPT-plano-de-implementacao.md) encheria o disco de
// backups. 20 versões cobre bem mais reviravolta do que qualquer sessão normal
// precisa desfazer.
const MAX_VERSOES_POR_ARQUIVO = 20;

// Contador só pra desempatar backups da MESMA execução que caem no mesmo
// milissegundo (achado testando: dois `salvarVersaoAnterior` em sequência
// rápida podem gerar o mesmo Date.toISOString(), e sem isso o segundo
// sobrescreveria o primeiro em silêncio — perdendo exatamente a versão que
// esse módulo existe pra preservar). Sobrevive só durante o processo, o que
// já basta: colisão entre execuções diferentes do AuGPT não acontece porque
// cada uma tem seu próprio milissegundo de verdade.
let contadorMesmoInstante = 0;

/** Nome de arquivo válido em Windows também — ":" e "." não são permitidos lá. */
function nomeVersao(dataIso) {
  contadorMesmoInstante = (contadorMesmoInstante + 1) % 1e6;
  const seq = String(contadorMesmoInstante).padStart(6, '0');
  return `${dataIso.replace(/[:.]/g, '-')}-${seq}.bak`;
}

/** Pasta de backups de UM arquivo específico, dado seu caminho absoluto. */
function pastaBackupDe(sandbox, caminhoAbsoluto) {
  return path.join(sandbox.root, PASTA_BACKUPS, sandbox.relative(caminhoAbsoluto));
}

async function podarVersoesAntigas(pastaDoArquivo, maxVersoes = MAX_VERSOES_POR_ARQUIVO) {
  const entradas = await fs.readdir(pastaDoArquivo);
  if (entradas.length <= maxVersoes) return;
  // nomes são timestamps ISO (com ":"/"." trocados) — ordem lexicográfica já é ordem cronológica
  const excesso = entradas.sort().slice(0, entradas.length - maxVersoes);
  await Promise.all(excesso.map((nome) => fs.unlink(path.join(pastaDoArquivo, nome)).catch(() => {})));
}

/**
 * Salva uma cópia do conteúdo ATUAL de `caminhoAbsoluto` antes de uma operação
 * destrutiva rodar por cima dele. Chamada pelas três ferramentas de arquivo em
 * files.js, sempre ANTES de escrever/apagar de verdade.
 *
 * Se o arquivo ainda não existe (primeira escrita), não há o que preservar —
 * devolve null sem erro, silenciosamente.
 *
 * Nunca lança: um backup que falha (disco cheio, permissão) não pode travar a
 * operação original que o chamou — a ferramenta segue seu fluxo normal, só
 * fica sem rede de segurança PARA ESSA escrita específica. Preferível a travar
 * o agente inteiro por causa de um problema na pasta de backup.
 */
async function salvarVersaoAnterior(sandbox, caminhoAbsoluto) {
  let conteudo;
  try {
    conteudo = await fs.readFile(caminhoAbsoluto);
  } catch {
    return null; // arquivo não existe ainda — nada a preservar
  }
  try {
    const pastaDoArquivo = pastaBackupDe(sandbox, caminhoAbsoluto);
    await fs.mkdir(pastaDoArquivo, { recursive: true });
    const arquivo = path.join(pastaDoArquivo, nomeVersao(new Date().toISOString()));
    await fs.writeFile(arquivo, conteudo);
    await podarVersoesAntigas(pastaDoArquivo);
    return arquivo;
  } catch {
    return null;
  }
}

/** Lista as versões salvas de um arquivo, mais recente primeiro. */
async function listarVersoes(sandbox, caminhoRelativo) {
  const alvo = sandbox.resolve(caminhoRelativo);
  const pastaDoArquivo = pastaBackupDe(sandbox, alvo);
  let entradas;
  try {
    entradas = await fs.readdir(pastaDoArquivo);
  } catch {
    return [];
  }
  return entradas.filter((n) => n.endsWith('.bak')).sort().reverse();
}

/**
 * Restaura uma versão salva de volta pro caminho original. `versao` é um nome
 * exato devolvido por listarVersoes; omitido, usa a mais recente.
 *
 * A própria restauração passa pelo mesmo mecanismo (o conteúdo atual, antes de
 * ser sobrescrito pela versão restaurada, também vira backup) — restaurar
 * errado também não deveria ser sem volta.
 */
async function restaurarVersao(sandbox, caminhoRelativo, versao = null) {
  const alvo = sandbox.resolve(caminhoRelativo);
  const versoes = await listarVersoes(sandbox, caminhoRelativo);
  if (!versoes.length) {
    throw new Error(`Nenhum backup encontrado para "${caminhoRelativo}".`);
  }
  const escolhida = versao || versoes[0];
  if (!versoes.includes(escolhida)) {
    throw new Error(`Versão "${escolhida}" não encontrada. Disponíveis: ${versoes.join(', ')}`);
  }
  const origem = path.join(pastaBackupDe(sandbox, alvo), escolhida);
  const conteudo = await fs.readFile(origem);
  await salvarVersaoAnterior(sandbox, alvo);
  await fs.mkdir(path.dirname(alvo), { recursive: true });
  await fs.writeFile(alvo, conteudo);
  return { restaurado: sandbox.relative(alvo), versao: escolhida };
}

module.exports = {
  PASTA_BACKUPS,
  MAX_VERSOES_POR_ARQUIVO,
  salvarVersaoAnterior,
  listarVersoes,
  restaurarVersao,
};
