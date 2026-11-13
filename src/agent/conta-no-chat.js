'use strict';

/**
 * Conta (13/11): "quanto é (12783,23 * 0,17) + 823,42?" — o código calcula. A régua pegou o 9B
 * respondendo 2193,1652 e 2.096,53 (o certo é 2.996,57). Só expressão pura: números, + - * / ^ e
 * parênteses; qualquer palavra no meio devolve para o modelo.
 */

const PREFIXO = /^\s*(quanto (e|é|da|dá)|qual (e |é )?o resultado de|calcul[ae]|resolva|conta:?|calculate|what is|what's|how much is)\s*/i;

/** "12.783,23" e "12783,23" → 12783.23; "1.000" → 1000; "2.5" → 2.5 */
function numero(s) {
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s);
}

/** A expressão em JS (só números e operadores) ou null. */
function expressao(texto) {
  const resto = String(texto || '').replace(PREFIXO, '').replace(/[?=!.\s]+$/, '').trim();
  if (!/^[\d\s.,+\-*/x×÷^()]+$/i.test(resto) || !/\d\s*[+\-*/x×÷^]\s*[\d(-]/i.test(resto)) return null;
  const js = resto
    .replace(/\d[\d.,]*/g, (n) => String(numero(n.replace(/[.,]$/, ''))))
    .replace(/[x×]/gi, '*')
    .replace(/÷/g, '/')
    .replace(/\^/g, '**');
  return /NaN/.test(js) ? null : js;
}

function pedidoDeConta(objetivo) {
  const js = expressao(objetivo);
  if (!js) return null;
  let valor;
  try {
    valor = Function(`"use strict"; return (${js});`)(); // só dígitos, operadores e parênteses chegam aqui
  } catch {
    return null;
  }
  return Number.isFinite(valor) ? { js, valor: Math.round(valor * 1e10) / 1e10 } : null;
}

const br = (v, casas) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });

async function responderConta({ pedido }) {
  const { valor } = pedido;
  const exato = br(valor, 10);
  const curto = br(valor, 2);
  const texto = exato === curto ? `O resultado é **${curto}**.` : `O resultado é **${curto}** (exato: ${exato}).`;
  return { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, texto, modo: 'conta' };
}

module.exports = { pedidoDeConta, responderConta, expressao };
