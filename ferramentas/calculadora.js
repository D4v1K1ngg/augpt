'use strict';

/**
 * Avaliador aritmético sem eval: analisa a expressão caractere a caractere.
 * Existe porque modelo pequeno erra conta de cabeça com frequência, e abrir
 * um processo Python só para somar dois números é desperdício.
 */

// Caso real de produção (Davi, bateria de 7 questões de combinatória/
// probabilidade): metade delas dependia de fatorial (permutação, C(n,k)) e a
// calculadora não aceitava "!" — o modelo tentou várias variações da mesma
// expressão, bateu no guarda de "ação repetida" umas 12 vezes seguidas e
// nunca chegou a um resultado exato pra essas questões. Fatorial de inteiro
// não negativo é o caso mais comum de "conta que dá pra fazer exata, mas dá
// trabalho de cabeça" depois dos quatro operadores básicos — exatamente o
// motivo de a calculadora existir. Limite de 170: acima disso o resultado já
// estoura double e vira Infinity (barrado pelo Number.isFinite no final de
// avaliar()) — melhor recusar cedo com uma mensagem clara do que deixar o
// laço `for` de fatorial() rodar milhões de iterações à toa.
function fatorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('fatorial só existe para um inteiro não negativo');
  if (n > 170) throw new Error('fatorial grande demais para calcular com exatidão (máximo 170)');
  let v = 1;
  for (let k = 2; k <= n; k += 1) v *= k;
  return v;
}

function avaliar(expressao) {
  const entrada = String(expressao).replace(/\s+/g, '').replace(/,(\d)/g, '.$1');
  if (!/^[-+*/^%().!\d]+$/.test(entrada)) {
    throw new Error('a expressão só pode conter números e os operadores + - * / % ^ ! ( )');
  }

  let i = 0;
  const olhar = () => entrada[i];
  const consumir = (c) => {
    if (entrada[i] === c) {
      i += 1;
      return true;
    }
    return false;
  };

  // Fatorial é pós-fixo e só se aplica ao átomo (número ou parêntese) que
  // acabou de ser lido — não ao resultado de um unário à frente, pra "-5!"
  // seguir a convenção matemática -(5!) = -120, e não (-5)!  (que seria
  // erro, fatorial de negativo). Por isso mora dentro de atomo(), chamado
  // DEPOIS do sinal já ter sido consumido em numero(), nunca antes.
  function posFatorial(v) {
    let r = v;
    while (consumir('!')) r = fatorial(r);
    return r;
  }

  function atomo() {
    if (consumir('(')) {
      const v = soma();
      if (!consumir(')')) throw new Error('parêntese não fechado');
      return posFatorial(v);
    }
    const inicio = i;
    while (i < entrada.length && /[\d.]/.test(entrada[i])) i += 1;
    if (i === inicio) throw new Error(`caractere inesperado em "${entrada.slice(i, i + 6)}"`);
    const v = Number(entrada.slice(inicio, i));
    if (Number.isNaN(v)) throw new Error('número inválido');
    return posFatorial(v);
  }

  function numero() {
    if (consumir('-')) return -numero();
    if (consumir('+')) return numero();
    return atomo();
  }

  function potencia() {
    const base = numero();
    if (consumir('^')) return base ** potencia();
    return base;
  }

  function produto() {
    let v = potencia();
    for (;;) {
      if (consumir('*')) v *= potencia();
      else if (consumir('/')) {
        const d = potencia();
        if (d === 0) throw new Error('divisão por zero');
        v /= d;
      } else if (consumir('%')) v %= potencia();
      else return v;
    }
  }

  function soma() {
    let v = produto();
    for (;;) {
      if (consumir('+')) v += produto();
      else if (consumir('-')) v -= produto();
      else return v;
    }
  }

  const resultado = soma();
  if (i < entrada.length) throw new Error(`sobrou "${entrada.slice(i)}" no fim da expressão`);
  if (!Number.isFinite(resultado)) throw new Error('resultado não é um número finito');
  return resultado;
}

module.exports = {
  name: 'calcular',
  risk: 'baixo',
  description:
    'Calcula uma expressão aritmética exata (+ - * / % ^ ! e parênteses — "!" é fatorial de um inteiro não negativo até 170, ex.: para permutação e combinação). Use sempre que precisar de um número em vez de estimar de cabeça.',
  args: { expressao: 'ex.: (1250 * 1.18) / 3, ou 5! / (3! * 2!) para combinação' },

  async run({ expressao }) {
    if (!expressao) throw new Error('Informe "expressao".');
    const valor = avaliar(expressao);
    const arredondado = Math.round(valor * 1e10) / 1e10;
    return `${expressao} = ${arredondado.toLocaleString('pt-BR', { maximumFractionDigits: 10 })}`;
  },
};
