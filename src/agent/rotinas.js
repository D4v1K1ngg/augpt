'use strict';

const fs = require('fs');
const path = require('path');
const ollama = require('../llm/ollama');

/**
 * Rotinas executáveis.
 *
 * Skill descreve método em texto e o modelo interpreta. Rotina é o caminho já
 * decidido: uma sequência fixa de ferramentas. Para tarefa cujo percurso é
 * sempre o mesmo — previsão do tempo, ler documento anexado — deixar um modelo
 * de 8B redescobrir o caminho a cada vez só cria chance de erro.
 *
 * LIMITE DELIBERADO: passos lineares, sem condicional e sem laço. Assim que se
 * admite `if`, o JSON vira linguagem de programação sem depurador. Falhou um
 * passo, a rotina devolve o controle ao agente com o que já coletou.
 */

const MAX_PASSOS = 8;

function carregar(skill) {
  const arquivo = path.join(path.dirname(skill.caminho), 'workflow.json');
  let bruto;
  try {
    bruto = fs.readFileSync(arquivo, 'utf8');
  } catch {
    return null;
  }

  try {
    const rotina = JSON.parse(bruto);
    if (!Array.isArray(rotina.passos) || !rotina.passos.length) return null;
    return {
      nome: rotina.nome || skill.nome,
      quando: rotina.quando || '',
      parametros: Array.isArray(rotina.parametros) ? rotina.parametros : [],
      passos: rotina.passos.slice(0, MAX_PASSOS),
      foco: rotina.foco || '',
      skill: skill.nome,
      arquivo,
    };
  } catch {
    return null; // workflow quebrado é ignorado; a skill de texto continua valendo
  }
}

/** Uma chamada só para extrair os parâmetros do pedido. */
async function preencher({ rotina, objetivo, config, modelo, signal, contabilizar }) {
  if (!rotina.parametros.length) return {};

  const descricao = rotina.parametros
    .map((p) => (typeof p === 'string' ? `"${p}": <valor extraído do pedido, ou null>` : `"${p.nome}": <${p.descricao}>`))
    .join(',\n  ');

  const r = await ollama.chat({
    host: config.host,
    model: modelo || config.model,
    messages: [
      {
        role: 'user',
        content: `PEDIDO DO USUÁRIO:
${objetivo}

Extraia os valores abaixo do pedido. Responda apenas com o objeto JSON:
{
  ${descricao}
}

Se um valor não estiver no pedido, use null. Não invente.`,
      },
    ],
    json: true,
    temperature: 0,
    numCtx: config.numCtx,
    numPredict: 200,
      manterVivo: config.manterModeloVivo,
    signal,
  });

  contabilizar?.({ promptTokens: r.promptTokens, completionTokens: r.completionTokens });

  try {
    const dados = JSON.parse(String(r.content).replace(/```(json)?/g, '').trim());
    return dados && typeof dados === 'object' ? dados : {};
  } catch {
    return {};
  }
}

const nomeDoParametro = (p) => (typeof p === 'string' ? p : p.nome);

/** Troca {parametro} pelos valores extraídos, em qualquer profundidade. */
function aplicar(valor, parametros) {
  if (typeof valor === 'string') {
    return valor.replace(/\{(\w+)\}/g, (inteiro, chave) =>
      parametros[chave] === undefined || parametros[chave] === null ? inteiro : String(parametros[chave])
    );
  }
  if (Array.isArray(valor)) return valor.map((v) => aplicar(v, parametros));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, aplicar(v, parametros)]));
  }
  return valor;
}

/** Todos os parâmetros obrigatórios foram encontrados? */
function completa(rotina, parametros) {
  return rotina.parametros
    .filter((p) => typeof p === 'string' || p.obrigatorio !== false)
    .every((p) => {
      const valor = parametros[nomeDoParametro(p)];
      return valor !== undefined && valor !== null && String(valor).trim() !== '';
    });
}

/**
 * Executa os passos em ordem. Devolve { concluida, executados, foco, motivo }.
 * `executarPasso` vem do loop, para que aprovação, dossiê e registro continuem
 * valendo — a rotina não é um caminho paralelo, é o mesmo caminho sem as
 * decisões intermediárias.
 */
async function executar({ rotina, parametros, executarPasso, emitir }) {
  const executados = [];

  for (const [indice, passo] of rotina.passos.entries()) {
    const nome = passo.ferramenta;
    if (!nome) continue;

    const argumentos = aplicar(passo.argumentos || {}, parametros);
    emitir?.('rotina-passo', { rotina: rotina.nome, passo: indice + 1, de: rotina.passos.length, ferramenta: nome });

    const r = await executarPasso({ nome, argumentos, rotina: rotina.nome });
    executados.push({ nome, erro: r?.erro || null });

    if (r?.erro) {
      // sem condicional e sem retentativa: devolve o controle ao agente
      return {
        concluida: false,
        executados,
        motivo: `o passo ${indice + 1} (${nome}) falhou: ${r.erro}`,
        foco: aplicar(rotina.foco, parametros),
      };
    }
    if (r?.parar) break;
  }

  return { concluida: true, executados, foco: aplicar(rotina.foco, parametros) };
}

module.exports = { carregar, preencher, executar, completa, aplicar, nomeDoParametro };
