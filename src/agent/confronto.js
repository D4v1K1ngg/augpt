'use strict';

const { extrairNumeros, extrairDatas, extrairEntidades } = require('./verificador');

/**
 * Confronto entre fontes.
 *
 * Ler cinco páginas não adianta se os dados chegam lado a lado e o redator
 * escolhe em silêncio. Aqui os valores são cruzados: quantos domínios
 * confirmam cada número, e onde duas fontes discordam.
 *
 * Contagem é por DOMÍNIO, não por página: três páginas do mesmo portal são uma
 * fonte, e tratá-las como três inflaria a confiança artificialmente.
 *
 * O resultado é indício, não veredicto — a mesma regra do verificador. Fonte
 * única não significa dado errado, significa dado não corroborado.
 */

const MIN_CONFIRMACAO = 2;

/** Duas medidas da mesma unidade que diferem muito são candidatas a divergência. */
const TOLERANCIA_RELATIVA = 0.05;

function normalizarUnidade(unidade) {
  const u = String(unidade || '').toLowerCase();
  if (u.startsWith('°')) return '°C';
  if (u === '%') return '%';
  if (/km\/h/.test(u)) return 'km/h';
  if (/mm|cm|kg|km|gb|mb/.test(u)) return u;
  return '';
}

function coletar(fontes) {
  const porValor = new Map(); // valor canônico → { valor, texto, unidade, dominios:Set }

  for (const fonte of fontes) {
    const dominio = fonte.dominio || fonte.origem || 'fonte';
    const texto = fonte.texto || '';

    for (const n of extrairNumeros(texto)) {
      const unidade = normalizarUnidade(n.unidade);
      const chave = `n:${n.valor}:${unidade}`;
      if (!porValor.has(chave)) {
        porValor.set(chave, { tipo: 'numero', valor: n.valor, texto: n.texto, unidade, dominios: new Set() });
      }
      porValor.get(chave).dominios.add(dominio);
    }

    for (const data of extrairDatas(texto)) {
      const chave = `d:${data}`;
      if (!porValor.has(chave)) {
        const [mes, dia] = data.split('-');
        porValor.set(chave, { tipo: 'data', valor: data, texto: `${dia}/${mes}`, unidade: '', dominios: new Set() });
      }
      porValor.get(chave).dominios.add(dominio);
    }
  }

  return [...porValor.values()].map((v) => ({ ...v, dominios: [...v.dominios] }));
}

/**
 * Valores da mesma unidade, cada um numa fonte diferente e distantes entre si.
 * Só vale para unidade conhecida: comparar dois números sem unidade produziria
 * divergência falsa a cada página.
 */
function divergencias(valores) {
  const achadas = [];

  // Para cada valor de fonte única, procura o valor CORROBORADO mais próximo da
  // mesma unidade. Pegar o mais próximo evita a armadilha óbvia: comparar a
  // mínima de um site com a máxima de outro e chamar isso de divergência.
  const isolados = valores.filter((v) => v.tipo === 'numero' && v.unidade && v.dominios.length === 1);
  const corroborados = valores.filter((v) => v.tipo === 'numero' && v.unidade && v.dominios.length >= MIN_CONFIRMACAO);

  for (const isolado of isolados) {
    const candidatos = corroborados
      .filter((c) => c.unidade === isolado.unidade)
      .filter((c) => !c.dominios.includes(isolado.dominios[0]))
      .map((c) => ({ c, distancia: Math.abs(c.valor - isolado.valor) / (Math.max(Math.abs(c.valor), Math.abs(isolado.valor)) || 1) }))
      .sort((a, b) => a.distancia - b.distancia);

    const melhor = candidatos[0];
    if (!melhor) continue;
    // muito perto é arredondamento; muito longe é outro assunto
    if (melhor.distancia > TOLERANCIA_RELATIVA && melhor.distancia < 0.6) {
      achadas.push({ unidade: isolado.unidade, a: { ...melhor.c }, b: { ...isolado } });
    }
  }

  return achadas.slice(0, 6);
}

/**
 * Cross-validation de opinião (pedido do Davi, 2026-09-23 — item 1 da parte
 * "cara" do Source Intelligence Engine, priorizado por ele antes da
 * descoberta de autoridade em duas fases: "na minha opinião era a peça que
 * faltava pro AuGPT conseguir realizar pesquisas mais cirúrgicas").
 *
 * `divergencias()` acima só cobre número e data — mas comparação de produto/
 * ferramenta/decisão (a skill "Comparativo" existe justamente pra isso) é tão
 * ou mais sujeita a fonte discordando quanto preço ou previsão do tempo: um
 * site diz "confiável, recomendo", outro diz "não recomendo, cheio de
 * defeito" sobre o MESMO item — e sem cruzar isso, o redator escolhe um lado
 * em silêncio (o mesmo problema que `divergencias()` resolve pra número).
 *
 * Mesma filosofia do resto deste arquivo e de verificador.js: regra
 * determinística sobre vocabulário concreto, não classificação de sentimento
 * genérica (que exigiria modelo, custo e imprevisibilidade que o resto do
 * projeto evita nesta camada). O vocabulário é o de VEREDITO explícito sobre
 * algo avaliado (recomendo/não recomendo, confiável/não confiável,
 * defeito/recall) — não qualquer palavra com carga emocional.
 */

// Frases com "não" já embutido no meio da locução: o sentido delas não é a
// raiz sozinha invertida por regra genérica (ver NEGACAO_ANTES abaixo) porque
// a posição do "não" varia ("não é confiável" nega "confiável", mas "não
// decepciona" NÃO nega "decepciona" no sentido raiz-oposta — o verbo já é
// negativo e o "não" o transforma em elogio). Checadas ANTES das raízes soltas.
const FRASES_EXPLICITAS_OPINIAO = [
  { re: /\bn[aã]o recomendo\b/i, polaridade: 'negativo' },
  { re: /\bn[aã]o (?:é|eh) confi[aá]vel\b/i, polaridade: 'negativo' },
  { re: /\bn[aã]o vale a pena\b/i, polaridade: 'negativo' },
  { re: /\bn[aã]o funciona\b/i, polaridade: 'negativo' },
  { re: /\bn[aã]o decepciona\b/i, polaridade: 'positivo' },
  { re: /\bn[aã]o (?:teve|tive) problemas?\b/i, polaridade: 'positivo' },
  { re: /\bvale a pena\b/i, polaridade: 'positivo' },
];

// Raízes soltas — palavra de veredito sem "não" grudado nela. Checada por
// NEGACAO_ANTES: se um "não"/"nunca"/"jamais"/"nem" aparecer até 3 palavras
// antes da raiz (e nenhuma FRASE_EXPLICITA acima já bateu — essa tem
// prioridade), a polaridade abaixo é invertida.
const RAIZES_OPINIAO = [
  { re: /\brecomend(?:o|ado|ada|amos)\b/i, polaridade: 'positivo' },
  { re: /\bconfi[aá]vel\b/i, polaridade: 'positivo' },
  { re: /\bdur[aá]vel\b/i, polaridade: 'positivo' },
  { re: /\bexcelente\b/i, polaridade: 'positivo' },
  { re: /\b[oó]tim[oa]\b/i, polaridade: 'positivo' },
  { re: /\bsatisfeit[oa]\b/i, polaridade: 'positivo' },
  { re: /\baprovad[oa]\b/i, polaridade: 'positivo' },
  { re: /\bsegur[oa]\b/i, polaridade: 'positivo' },
  { re: /\bp[eé]ssim[oa]\b/i, polaridade: 'negativo' },
  { re: /\bhorr[ií]vel\b/i, polaridade: 'negativo' },
  { re: /\bterr[ií]vel\b/i, polaridade: 'negativo' },
  { re: /\breprovad[oa]\b/i, polaridade: 'negativo' },
  { re: /\bdecepcion(?:a|ado|ada|ante|ei)\b/i, polaridade: 'negativo' },
  { re: /\bdefeito/i, polaridade: 'negativo' },
  { re: /\bquebr(?:ou|a f[aá]cil)\b/i, polaridade: 'negativo' },
  { re: /\brecall\b/i, polaridade: 'negativo' },
  { re: /\barrepend/i, polaridade: 'negativo' },
  { re: /\binsegur[oa]\b/i, polaridade: 'negativo' },
];

const NEGACAO_ANTES = /\b(n[aã]o|nunca|jamais|nem)\s+(?:\w+\s+){0,3}$/i;

/** Polaridade de uma frase, ou null se não tem nenhum marcador de veredito. */
function polaridadeDaFrase(frase) {
  for (const { re, polaridade } of FRASES_EXPLICITAS_OPINIAO) {
    if (re.test(frase)) return polaridade;
  }
  for (const { re, polaridade } of RAIZES_OPINIAO) {
    const m = re.exec(frase);
    if (!m) continue;
    const antes = frase.slice(0, m.index);
    return NEGACAO_ANTES.test(antes) ? (polaridade === 'positivo' ? 'negativo' : 'positivo') : polaridade;
  }
  return null;
}

/**
 * Opiniões por entidade (nome próprio/produto — mesmo extrator de
 * verificador.js, já testado contra ruído de maiúscula solta). Frase sem
 * nenhuma entidade nela não contribui: sem "sobre o quê", uma opinião
 * solta não tem como ser cruzada com a de outra fonte.
 */
function coletarOpinioes(fontes) {
  const porEntidade = new Map(); // chave normalizada → { entidade, positivos:Set, negativos:Set }

  for (const fonte of fontes) {
    const dominio = fonte.dominio || fonte.origem || 'fonte';
    const texto = fonte.texto || '';
    const frases = texto.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

    for (const frase of frases) {
      const polaridade = polaridadeDaFrase(frase);
      if (!polaridade) continue;

      for (const entidade of extrairEntidades(frase)) {
        const chave = entidade.toLowerCase();
        if (!porEntidade.has(chave)) {
          porEntidade.set(chave, { entidade, positivos: new Set(), negativos: new Set() });
        }
        porEntidade.get(chave)[polaridade === 'positivo' ? 'positivos' : 'negativos'].add(dominio);
      }
    }
  }

  return [...porEntidade.values()];
}

/** Entidade com veredito bom por um domínio e ruim por outro. */
function divergenciasDeOpiniao(opinioes) {
  return opinioes
    .filter((o) => o.positivos.size && o.negativos.size)
    .map((o) => ({ entidade: o.entidade, positivos: [...o.positivos], negativos: [...o.negativos] }))
    .slice(0, 6);
}

function confrontar(fontes = []) {
  const dominios = [...new Set(fontes.map((f) => f.dominio || f.origem || 'fonte'))];
  if (fontes.length < 2) {
    return {
      fontes: fontes.length,
      dominios: dominios.length,
      suficiente: false,
      confirmados: [],
      isolados: [],
      divergencias: [],
      divergenciasOpiniao: [],
    };
  }

  const valores = coletar(fontes);
  const confirmados = valores
    .filter((v) => v.dominios.length >= MIN_CONFIRMACAO)
    .sort((a, b) => b.dominios.length - a.dominios.length)
    .slice(0, 12);

  const isolados = valores
    .filter((v) => v.dominios.length === 1 && (v.unidade || v.tipo === 'data' || Math.abs(v.valor) >= 100))
    .slice(0, 10);

  return {
    fontes: fontes.length,
    dominios: dominios.length,
    suficiente: true,
    confirmados,
    isolados,
    divergencias: divergencias(valores),
    divergenciasOpiniao: divergenciasDeOpiniao(coletarOpinioes(fontes)),
  };
}

/** Bloco para o prompt de redação. Vazio quando não há o que confrontar. */
function paraPrompt(resultado) {
  if (!resultado?.suficiente) return '';
  const linhas = [];

  if (resultado.confirmados.length) {
    linhas.push(
      `Confirmados por mais de uma fonte: ${resultado.confirmados
        .map((v) => `${v.texto} (${v.dominios.length} fontes)`)
        .join(' · ')}`
    );
  }
  if (resultado.isolados.length) {
    linhas.push(
      `Aparecem em uma fonte só: ${resultado.isolados
        .map((v) => `${v.texto} (${v.dominios[0]})`)
        .join(' · ')}`
    );
  }
  for (const d of resultado.divergencias) {
    linhas.push(
      `DIVERGÊNCIA em ${d.unidade}: ${d.a.texto} em ${d.a.dominios.length} fonte(s) ` +
        `(${d.a.dominios.join(', ')}), mas ${d.b.texto} em ${d.b.dominios[0]} — ` +
        'cite o valor corroborado e registre a discordância.'
    );
  }
  for (const d of resultado.divergenciasOpiniao || []) {
    linhas.push(
      `DIVERGÊNCIA DE OPINIÃO sobre "${d.entidade}": avaliação boa em ${d.positivos.length} fonte(s) ` +
        `(${d.positivos.join(', ')}), mas avaliação ruim em ${d.negativos.length} fonte(s) ` +
        `(${d.negativos.join(', ')}) — apresente os dois lados, não escolha um em silêncio.`
    );
  }

  if (!linhas.length) return '';
  return `\nCONFRONTO ENTRE AS ${resultado.dominios} FONTES LIDAS:\n${linhas
    .map((l) => `- ${l}`)
    .join('\n')}\nDado corroborado por várias fontes é mais confiável. Dado de fonte única pode ser citado, mas não como certeza.\n`;
}

module.exports = {
  confrontar,
  paraPrompt,
  coletar,
  divergencias,
  MIN_CONFIRMACAO,
  coletarOpinioes,
  divergenciasDeOpiniao,
  polaridadeDaFrase,
};
