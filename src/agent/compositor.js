'use strict';

/**
 * Resposta montada pelo código (Etapa H da revisão v2, 2026-09-28 — a
 * "Parte 3" combinada com o Davi).
 *
 * Por quê: o redator 7B recebia um plano da resposta bem montado e mesmo
 * assim escrevia o que queria. No 14º teste real: "Melhor no geral / melhor
 * custo-benefício / melhor para sessões longas" era o KZ nos três, a tabela
 * tinha "Cabo over-ear firmes", os comentários dos usuários não apareciam, e
 * na pergunta dos profissionais saiu tabela de preço e estrela inventados.
 * O Davi pediu resposta "bonita", organizada em tópicos, explicando por que
 * cada opção foi escolhida e citando os usuários.
 *
 * Divisão de trabalho:
 *   - o CÓDIGO monta o esqueleto e tudo que é dado: "Como escolhi", um bloco
 *     por produto com o respaldo, as citações (com votos e fórum), a ficha e o
 *     status de cada critério, a tabela, "qual escolher", "o que não foi
 *     confirmado"; na comparação, os números calculados; no dado de uso, a
 *     contagem;
 *   - o MODELO escreve só frases curtas numa chamada (`pedidoDeFrases`): a
 *     resposta direta, uma frase por produto, o veredito e a tradução das
 *     citações em inglês. Cada linha é conferida; o que não passa vira a
 *     frase-padrão feita pelo código a partir da evidência.
 */

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

const porcento = (v) => `${Math.abs(v).toFixed(1).replace('.', ',')}%`;
// com sinal (faixa que cruza o zero: "de −4,0% a +21,0%")
const comSinal = (v) => `${v >= 0 ? '+' : '−'}${porcento(v)}`;
const curto = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};
// Revisão v3 (29/09): por PALAVRA, não por `\b` — o `\b` do JavaScript não
// enxerga "é/são/não" (acento é fronteira) e o "a" do inglês ("a great IEM")
// marcava a citação como portuguesa; metade das citações saiu sem tradução.
const PALAVRAS_EN = new Set(['the', 'is', 'are', 'and', 'for', 'with', 'great', 'good', 'you', 'it', 'this', 'my', 'i', 'have', 'was', 'but', 'they', 'just', 'really', 'if', 'of', 'to', 'in', 'not']);
const PALAVRAS_PT = new Set(['é', 'são', 'para', 'com', 'que', 'não', 'muito', 'bom', 'boa', 'eu', 'um', 'uma', 'mas', 'mais', 'também', 'pra', 'esse', 'isso', 'tem', 'ele']);
const emIngles = (t) => {
  const palavras = String(t || '').toLowerCase().split(/[^a-zà-ÿ']+/).filter(Boolean);
  const en = palavras.filter((p) => PALAVRAS_EN.has(p)).length;
  const pt = palavras.filter((p) => PALAVRAS_PT.has(p)).length;
  return en >= 1 && en > pt;
};

/* ------------------------------ frases do modelo ------------------------------ */

/** Citações (as primeiras de cada produto) que precisam de tradução, numeradas. */
// A mesma citação aparece em vários produtos (o comentário que lista 4 fones
// é citado nos 4): conta UMA vez, e a tradução vale pra todas as cópias
// (casada pelo texto, não pelo objeto). Antes, cópias além da 8ª saíam em
// inglês e a mesma frase aparecia traduzida num produto e não no outro.
function citacoesParaTraduzir(r) {
  const lista = [];
  const vistos = new Set();
  if (r.modo === 'guia') {
    for (const c of citacoesDoGuia(r)) {
      if (!emIngles(c.texto) || vistos.has(c.texto)) continue;
      vistos.add(c.texto);
      lista.push(c);
    }
    return lista.slice(0, 10);
  }
  for (const f of r.finalistas || []) {
    // as citações que a montagem mostra: até 2 a favor + a crítica (em "Limitações")
    for (const c of citacoesMostradas(f, r)) {
      if (!emIngles(c.texto) || vistos.has(c.texto)) continue;
      vistos.add(c.texto);
      lista.push(c);
    }
  }
  return lista.slice(0, 10);
}
const indiceDaTraducao = (traducoes, c) => traducoes.findIndex((x) => x === c || x.texto === c?.texto);

/**
 * Citações de cada produto: até 2 a favor (vão em "O que os usuários dizem") e
 * a crítica, se houver (vai em "Limitações"). 10/10: o mesmo comentário-lista
 * ("minhas escolhas: Vivace, EM6L, Zero Blue, QKZ") aparecia em 3 produtos.
 * Agora uma citação aparece em um produto só (o primeiro na ordem), e
 * comentário que lista 3+ produtos só entra se não houver outro.
 */
const cacheDeCitacoes = new WeakMap();
function citacoesPorProduto(r) {
  if (r && cacheDeCitacoes.has(r)) return cacheDeCitacoes.get(r);
  const mapa = new Map();
  const usadas = new Set();
  for (const f of r?.finalistas || []) {
    const todas = (f.consenso?.citacoes || []).filter((c) => !usadas.has(normalizar(c.texto)));
    const favor = todas.filter((c) => c.tom !== 'critica');
    const aFavor = [...favor.filter((c) => !c.lista), ...favor.filter((c) => c.lista)].slice(0, 2);
    const critica = todas.find((c) => c.tom === 'critica' && !c.lista) || null;
    for (const c of [...aFavor, critica].filter(Boolean)) usadas.add(normalizar(c.texto));
    mapa.set(f.nome, { aFavor, critica });
  }
  if (r) cacheDeCitacoes.set(r, mapa);
  return mapa;
}
function citacoesDoProduto(f, r) {
  if (r) return citacoesPorProduto(r).get(f.nome) || { aFavor: [], critica: null };
  const todas = f.consenso?.citacoes || [];
  return { aFavor: todas.filter((c) => c.tom !== 'critica').slice(0, 2), critica: todas.find((c) => c.tom === 'critica') || null };
}
function citacoesMostradas(f, r) {
  const { aFavor, critica } = citacoesDoProduto(f, r);
  return critica ? [...aFavor, critica] : aFavor;
}

/** "R$ 389" · "R$ 350 a R$ 420 (mediana de 4 preços)" · "US$ 120 (em dólar…)". */
function textoDoPreco(p) {
  if (!p) return '';
  const fmt = (v) => `${p.moeda === 'BRL' ? 'R$' : 'US$'} ${Math.round(v).toLocaleString('pt-BR')}`;
  const faixa = p.n > 1 && p.max > p.min ? `${fmt(p.min)} a ${fmt(p.max)} (mediana ${fmt(p.mediana)}, ${p.n} preços nas páginas lidas)` : `${fmt(p.mediana)} (${p.n > 1 ? `${p.n} preços` : '1 preço'} nas páginas lidas)`;
  return p.moeda === 'USD' ? `${faixa} — em dólar; o material não trouxe preço em real` : faixa;
}

/** Fatos compactos de cada produto (o que o modelo pode usar numa frase). */
function fatosDoProduto(f, r) {
  const partes = [];
  const k = f.consenso || {};
  if (k.topicos) partes.push(`recomendado em ${k.topicos} tópico(s) da comunidade`);
  if (k.criticas) partes.push(`${k.criticas} crítica(s)`);
  // Diagnóstico de 10/10: com a lista de critérios "com evidência" aqui, o 7B
  // devolvia a lista ("entrou devido à sua excelente passos e posicionamento,
  // palco sonoro…") para TODOS os produtos. O modelo recebe o que o material
  // diz de cada um — o trecho, não o rótulo; a lista de critérios já está na tabela.
  const ditos = (r.plano?.criterios || [])
    .map((c) => ({ c, cel: r.livro?.celula?.(f.nome, c.nome) || r.matriz?.celula?.(f.nome, c.nome) }))
    .filter(({ cel }) => cel?.dominios?.size && (cel.veredito || cel.trechos?.[0]?.texto))
    .slice(0, 3)
    .map(({ c, cel }) => `${c.nome}: "${curto(cel.veredito || cel.trechos[0].texto, 140)}"`);
  if (ditos.length) partes.push(`o material diz — ${ditos.join('; ')}`);
  const preco = r.precos?.[f.nome];
  if (preco) partes.push(`preço observado: ${textoDoPreco(preco)}`);
  const { aFavor, critica } = citacoesDoProduto(f, r);
  // 13/10: o modelo passa a RESUMIR o que quem usa diz (antes a resposta colava
  // os comentários) — recebe todos os que serão a base, e a ficha
  const ficha = r.matriz?.resumos?.get?.(f.nome)?.ficha?.texto;
  if (ficha) partes.push(`ficha: "${curto(ficha, 220)}"`);
  aFavor.forEach((c) => partes.push(`um usuário disse: "${curto(c.texto, 200)}"`));
  if (critica) partes.push(`crítica de um usuário: "${curto(critica.texto, 200)}"`);
  return partes.join(' | ') || 'pouca evidência';
}

/* ------------------------------ guia (revisão v3, Fase 1) ------------------------------ */

/** Citação de comunidade da dica: o comentário mais votado entre as fontes dela. */
function citacaoDaDica(d) {
  const f = [...(d.fontes || [])].filter((x) => x.comunidade && x.trecho).sort((a, b) => (b.votos || 0) - (a.votos || 0))[0];
  return f ? { texto: f.trecho, fonte: f.rotulo, votos: f.votos, url: f.url } : null;
}
/** Citações que aparecem no guia: as das 6 dicas mais fortes. */
function citacoesDoGuia(r) {
  return (r.dicas || []).slice(0, 6).map(citacaoDaDica).filter(Boolean);
}
function respaldoDaDica(d) {
  const partes = [];
  if (d.comunidade) partes.push(`${d.comunidade} ${d.comunidade === 1 ? 'tópico' : 'tópicos'} da comunidade`);
  const editoriais = (d.nFontes || 0) - (d.comunidade || 0);
  if (editoriais) partes.push(`${editoriais} ${editoriais === 1 ? 'guia' : 'guias'}`);
  if (d.votos) partes.push(`${d.votos} votos`);
  return partes.join(', ');
}

function pedidoDeFrasesDoGuia(r, objetivo) {
  const citacoes = citacoesParaTraduzir(r);
  const dicas = (r.dicas || []).slice(0, 8);
  return `Você escreve frases curtas em português para uma resposta que o sistema já montou (as dicas e a ordem já estão decididas). NÃO invente dica, número, nome de jogador ou de mapa: use só o que está abaixo.

PEDIDO: ${objetivo}
TEMA: ${r.tema || ''}
DICAS MAIS CITADAS (com quantas fontes):
${dicas.map((d, i) => `${i + 1}. ${d.texto} (${d.nFontes} fonte(s))`).join('\n')}
${citacoes.length ? `\nCITAÇÕES EM INGLÊS (traduza cada uma, fiel e curta):\n${citacoes.map((c, i) => `C${i + 1}: "${curto(c.texto, 260)}"`).join('\n')}\n` : ''}
Responda EXATAMENTE nestas linhas, sem mais nada:
DIRETA: <2 ou 3 frases: o que mais se repete nessas dicas, como ideia central para ${r.tema || 'o tema'}>
${citacoes.map((_, i) => `C${i + 1}: <tradução>`).join('\n')}`.replace(/\n{3,}/g, '\n\n');
}

function montarGuia(r, frases = new Map()) {
  const dicas = r.dicas || [];
  const traducoes = citacoesParaTraduzir(r);
  const traducaoDe = (c) => {
    const i = indiceDaTraducao(traducoes, c);
    return i >= 0 ? frases.get(`C${i + 1}`) || null : null;
  };
  const comCitacao = new Set(dicas.slice(0, 6));
  const fontes = new Set(dicas.flatMap((d) => d.fontes.map((f) => f.chave)));
  const partes = ['### Resposta direta'];
  partes.push(
    frases.get('DIRETA') ||
      `Juntei as ${dicas.length} dicas sobre ${r.tema || 'o tema'} que aparecem no material, de ${fontes.size} fonte(s) — tópicos da comunidade e guias. Abaixo${r.jogo ? ', na ordem de uma partida,' : ''} com quantas fontes repetem cada uma.`
  );
  const titulo = r.tutorial ? '### Passo a passo' : '### O que funciona';
  partes.push('', titulo);
  const etapas = (r.secoes || []).filter((s) => s.titulo !== 'Erros comuns');
  etapas.forEach((s, i) => {
    partes.push('', `#### ${i + 1}. ${s.titulo}`);
    for (const d of s.dicas) {
      const respaldo = respaldoDaDica(d);
      partes.push(`- **${d.texto.replace(/\.$/, '')}.**${respaldo ? ` *(${respaldo})*` : ''}`);
      const c = comCitacao.has(d) ? citacaoDaDica(d) : null;
      if (c) partes.push(`  ${citacaoFormatada(c, traducaoDe(c))}`);
    }
  });
  const erros = (r.secoes || []).find((s) => s.titulo === 'Erros comuns');
  if (erros) {
    partes.push('', '### Erros comuns');
    for (const d of erros.dicas) partes.push(`- ${d.texto.replace(/\.$/, '')}.${respaldoDaDica(d) ? ` *(${respaldoDaDica(d)})*` : ''}`);
  }
  const pro = dicas.filter((d) => d.pro);
  if (pro.length) {
    partes.push('', '### O que vem dos profissionais e do cenário competitivo');
    for (const d of pro.slice(0, 5)) partes.push(`- ${d.texto.replace(/\.$/, '')}.`);
  }
  partes.push('', `*Como foi montado: dicas extraídas de ${r.topicos?.filter((t) => t.dicas).length || 0} tópico(s) da comunidade e de guias lidos; cada dica mostra quantas fontes independentes a repetem. Nada foi acrescentado de conhecimento próprio.*`);
  return partes.join('\n');
}

/**
 * O pedido de frases: UMA chamada, linhas com prefixo fixo. O modelo não
 * decide estrutura, ordem, números nem produtos — só escreve frases.
 */
function pedidoDeFrases(r, objetivo) {
  if (r.modo === 'guia') return pedidoDeFrasesDoGuia(r, objetivo);
  const citacoes = citacoesParaTraduzir(r);
  if (r.modo === 'desempenho') {
    const [A, B] = r.plano?.opcoesCitadas || [];
    const g = r.desempenho?.porResolucao?.geral;
    return `Você escreve frases curtas em português para uma resposta que o sistema já montou. NÃO invente número: use só os abaixo.

PERGUNTA: ${objetivo}
DADOS MEDIDOS: ${g ? `em jogos a ${B} é ${g.mediana >= 0 ? `${porcento(g.mediana)} mais rápida` : `${porcento(g.mediana)} mais lenta`} que a ${A} (mediana de ${g.n} resultados de ${g.fontes} fonte(s))` : 'não há medição de jogos com as duas placas'}.
${r.precos?.[A] && r.precos?.[B] ? `PREÇO OBSERVADO: ${A} R$ ${Math.round(r.precos[A].mediana)} · ${B} R$ ${Math.round(r.precos[B].mediana)}.` : ''}
${citacoes.length ? `CITAÇÕES EM INGLÊS (traduza cada uma, fiel e curta):\n${citacoes.map((c, i) => `C${i + 1}: "${curto(c.texto, 260)}"`).join('\n')}` : ''}

Responda EXATAMENTE nestas linhas, sem mais nada:
PRATICA: <uma frase: o que essa diferença significa na prática, ex.: num jogo a 60 FPS numa, quanto na outra>
VEREDITO: <duas frases: para quem vale a ${A} e para quem vale a ${B}, com base nos dados>
${citacoes.map((_, i) => `C${i + 1}: <tradução>`).join('\n')}`.replace(/\n{3,}/g, '\n\n');
  }
  const finalistas = r.finalistas || [];
  return `Você escreve, em português claro e bem redigido, os textos de uma resposta que o sistema já montou (a ordem e as opções já estão decididas). NÃO invente dado, número, preço ou nota: use só os fatos abaixo. Explique com as SUAS palavras — não copie os comentários dos usuários nem use aspas: diga o que eles relatam e por que isso importa para o uso. Cada produto tem fatos diferentes: escreva frases diferentes para cada um, sem começar todas do mesmo jeito, sem repetir a lista de critérios e sem "excelente" que o fato não mostre.

PEDIDO: ${objetivo}
USO: ${r.plano?.uso || ''}
OPÇÕES, NA ORDEM DA EVIDÊNCIA (a 1ª é a recomendada):
${finalistas.map((f, i) => `${i + 1}. ${f.nome} — ${fatosDoProduto(f, r)}`).join('\n')}
${citacoes.length ? `\nCITAÇÕES EM INGLÊS (traduza cada uma, fiel e curta):\n${citacoes.map((c, i) => `C${i + 1}: "${curto(c.texto, 260)}"`).join('\n')}\n` : ''}
Responda EXATAMENTE nestas linhas, sem mais nada:
${
    r.avaliacao
      ? `OQUEE: <2 frases: o que é o ${finalistas[0]?.nome} (que tipo de produto é e o que ele tem de principal), só com a ficha e os fatos dele>\nDIRETA: <2 ou 3 frases: responda a pergunta sobre o ${finalistas[0]?.nome} — serve ou não para esse uso, e com que ressalvas —, só com os fatos dele>`
      : `DIRETA: <2 ou 3 frases: recomende ${finalistas[0]?.nome || 'a 1ª opção'} para ${r.plano?.uso || 'esse uso'} e diga por quê, com um fato da linha dela ligado a esse uso — não fale de design nem de "qualidade" genérica>`
  }
${finalistas
  .map((f) =>
    citacoesDoProduto(f, r).critica
      ? `${f.nome}: <3 ou 4 frases, numa linha só: por que ele serve para esse uso (um fato concreto da linha dele), o que quem usa relata, com as suas palavras, e a ressalva que a crítica da linha dele traz>`
      : `${f.nome}: <3 ou 4 frases, numa linha só: por que ele serve para esse uso (um fato concreto da linha dele), o que quem usa relata, com as suas palavras, e para quem ele faz mais sentido. A linha dele NÃO tem crítica: não escreva ressalva, "mas…" nem nada sobre preço alto ou orçamento>`
  )
  .join('\n')}
${citacoes.map((_, i) => `C${i + 1}: <tradução>`).join('\n')}`.replace(/\n{3,}/g, '\n\n');
}

/**
 * Lê as linhas "PREFIXO: frase". Frase que cita número que não está nos
 * fatos, que é longa demais ou que fala de outro produto da lista é
 * descartada (o código põe a frase-padrão).
 */
function lerFrases(texto, { produtos = [], numerosPermitidos = '', criterios = [], semCritica = [] } = {}) {
  const semCriticaNorm = new Set(semCritica.map(normalizar));
  // palavras que ligam a resposta direta ao uso: os termos dos critérios (5+ letras)
  const doUso = new Set(criterios.flatMap((c) => normalizar(c).split(' ')).filter((t) => t.length >= 5));
  const saida = new Map();
  const permitidos = new Set((String(numerosPermitidos).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')));
  for (const bruta of String(texto || '').split('\n')) {
    const m = /^\s*[-*]?\s*\**([^:*]{1,60})\**\s*:\s*(.+)$/.exec(bruta);
    if (!m) continue;
    const chave = m[1].trim();
    let frase = m[2].trim().replace(/^[*\s]+/, '').replace(/^["“]|["”]$/g, '');
    if (!frase || frase.length > 750 || /^<.*>$/.test(frase)) continue;
    // número que não está nos fatos → frase inventada
    const nums = (frase.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'));
    if (nums.some((n) => !permitidos.has(n) && !/^\d$/.test(n))) continue;
    // frase de um produto que fala de OUTRO produto da lista
    const outro = produtos.find((p) => normalizar(p) !== normalizar(chave) && normalizar(frase).includes(normalizar(p)));
    if (produtos.some((p) => normalizar(p) === normalizar(chave)) && outro) continue;
    // frase-formulário (diagnóstico de 10/10): "entrou devido à sua excelente
    // passos, palco sonoro, separação…" — 3+ critérios numa frase é a lista
    // repetida, não um fato; sai e o código põe a frase feita da evidência
    const nf = normalizar(frase);
    if (/entrou devido|entrou por causa/.test(nf) || criterios.filter((c) => normalizar(c) && nf.includes(normalizar(c))).length >= 3) continue;
    // 10/10: sem crítica no material, o 7B inventava a ressalva ("mas o preço é
    // baixo", "pode estar fora do seu orçamento" no mais barato da lista)
    if (semCriticaNorm.has(normalizar(chave)) && /\b(mas|porem|no entanto|entretanto|embora|contudo|apesar)\b|orcamento|caro|preco (pode ser |e )?(alto|elevado|baixo)/.test(nf)) continue;
    // 10/10: resposta direta que não fala do uso ("qualidade de áudio hifi e
    // design versátil" para quem pediu fone de FPS) → frase da evidência
    if (chave.toUpperCase() === 'DIRETA' && doUso.size && !nf.split(' ').some((t) => doUso.has(t))) continue;
    frase = frase.replace(/\s+/g, ' ');
    if (!saida.has(chave.toUpperCase())) saida.set(chave.toUpperCase(), frase);
  }
  return saida;
}

/* ------------------------------ montagem: recomendação ------------------------------ */

const ROTULO_STATUS = {
  // 10/10: a matriz sabe que a fonte COMENTA o aspecto, não que elogia —
  // "confirmado" prometia mais do que a medição entrega
  corroborado: 'comentado por 2+ fontes',
  'fonte única': 'comentado por 1 fonte',
  contraditório: 'fontes discordam',
  indireto: 'deduzido',
  'sem dados': 'sem dados',
  'não se aplica': 'não se aplica',
};

function citacaoFormatada(c, traducao) {
  const origem = `${c.fonte}${c.votos ? `, ${c.votos} votos` : ''}${c.tom === 'critica' ? ', crítica' : ''}`;
  if (traducao) return `> "${curto(traducao, 260)}" — ${origem} *(tradução do inglês)*`;
  return `> "${curto(c.texto, 260)}" — ${origem}`;
}

function respaldoCurto(f) {
  const k = f.consenso || {};
  const partes = [];
  if (k.topicos) partes.push(`recomendado em ${k.topicos} tópico${k.topicos === 1 ? '' : 's'} da comunidade`);
  if (k.editoriaisDoUso) partes.push(`citado em ${k.editoriaisDoUso} review${k.editoriaisDoUso === 1 ? '' : 's'} sobre o uso`);
  if (k.criticas) partes.push(`${k.criticas} crítica${k.criticas === 1 ? '' : 's'}`);
  return partes.join(', ') || 'pouca evidência no material';
}

function fraseRecomendacaoPadrao(f, r) {
  const fortes = Object.entries(f.status || {}).filter(([, st]) => st === 'corroborado').map(([c]) => c);
  const unicas = Object.entries(f.status || {}).filter(([, st]) => st === 'fonte única').map(([c]) => c);
  const k = f.consenso || {};
  const base = k.topicos ? `Quem usa recomenda o ${f.nome} (${respaldoCurto(f)})` : `O ${f.nome} aparece no material (${respaldoCurto(f)})`;
  if (fortes.length) return `${base}; ${fortes.join(', ')} comentados por mais de uma fonte.`;
  if (unicas.length) return `${base}; ${unicas.join(', ')} comentado por uma fonte.`;
  return `${base}.`;
}

/**
 * O veredito da matriz só vai pra tabela quando é frase curta em português.
 * 10/10: entravam títulos de página ("/ Specification / Details / Features /",
 * "## Sound Signature Overview") e inglês que o detector não pegava ("Tonality
 * pleasant, micro-detail…"): exige palavra portuguesa ou acento.
 */
function vereditoMostravel(v) {
  const t = String(v || '').trim();
  if (t.length < 4 || t.length > 60) return false;
  if (/^[#/|*\-]|##|\s\/\s|https?:/.test(t)) return false;
  if ((t.match(/[a-zà-ÿ]/gi) || []).length < t.length * 0.6) return false;
  const palavras = t.toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean);
  return /[áéíóúâêôãõç]/i.test(t) || palavras.some((p) => PALAVRAS_PT.has(p) || ['de', 'do', 'da', 'em', 'bom', 'boa', 'bem', 'pouco', 'forte', 'fraco', 'amplo', 'claro'].includes(p));
}

/** Rótulo curto da célula da tabela quando não há veredito em português. */
const ROTULO_CELULA = { corroborado: '2+ fontes comentam', 'fonte única': '1 fonte comenta', contraditório: 'fontes discordam', indireto: 'deduzido', 'sem dados': 'sem dados', 'não se aplica': '—' };

/**
 * Limitações de cada opção (diagnóstico de 10/10: o pedido pedia "vantagens e
 * limitações" e a resposta não tinha nenhuma). Só do material: a crítica de
 * um usuário, critério em que as fontes discordam e critério de peso alto sem
 * evidência. Sem nada disso, a resposta diz que o material não trouxe — não
 * inventa ponto fraco.
 */
function linhasDeLimitacoes(f, criterios, critica, traducaoDe) {
  const itens = [];
  const discordam = criterios.filter((k) => f.status?.[k.nome] === 'contraditório').map((k) => k.nome);
  if (discordam.length) itens.push(`as fontes discordam sobre ${discordam.join(', ')}`);
  const semAlto = criterios.filter((k) => k.peso === 'alto' && (f.status?.[k.nome] || 'sem dados') === 'sem dados').map((k) => k.nome);
  if (semAlto.length) itens.push(`sem evidência sobre ${semAlto.join(', ')}, que pesa muito para esse uso`);
  if (!itens.length && !critica) return ['**Ponto de atenção:** o material lido não trouxe críticas nem pontos fracos deste modelo.'];
  const linhas = [`**Ponto de atenção:** ${itens.length ? `${itens.join('; ')}.` : 'a crítica abaixo é a única que apareceu no material.'}`];
  if (critica) linhas.push(citacaoFormatada(critica, traducaoDe(critica)));
  return linhas;
}

/** Por que o 1º ficou na frente do 2º, pelos números que decidem a ordem. */
function porQueNaFrente(a, b, criterios) {
  if (!b) return 'a única opção com respaldo suficiente no material';
  const fortes = (f) => criterios.filter((k) => f.status?.[k.nome] === 'corroborado').length;
  const ka = a.consenso || {};
  const kb = b.consenso || {};
  const razoes = [];
  if ((ka.topicos || 0) > (kb.topicos || 0)) razoes.push(`mais recomendações na comunidade (${ka.topicos} tópico${ka.topicos === 1 ? '' : 's'} contra ${kb.topicos || 0})`);
  if (fortes(a) > fortes(b)) razoes.push(`mais critérios comentados por 2+ fontes (${fortes(a)} contra ${fortes(b)})`);
  if ((ka.criticas || 0) < (kb.criticas || 0)) razoes.push(`menos críticas (${ka.criticas || 0} contra ${kb.criticas})`);
  if (!razoes.length) return `ficou à frente do ${b.nome} por pouco — no material, os dois estão praticamente empatados`;
  return `ficou à frente do ${b.nome} por ter ${razoes.join(' e ')}`;
}

/** A opção mais barata em cada moeda (só moeda com 2+ opções com preço). */
function opcoesMaisBaratas(finalistas, precos) {
  if (!precos) return [];
  const saida = [];
  for (const moeda of ['BRL', 'USD']) {
    const com = finalistas.map((f) => ({ f, p: precos[f.nome] })).filter((x) => x.p?.moeda === moeda);
    if (com.length >= 2) saida.push(com.sort((x, y) => x.p.mediana - y.p.mediana)[0]);
  }
  return saida;
}
const precoCurto = (p) => `${p.moeda === 'BRL' ? 'R$' : 'US$'} ${Math.round(p.mediana).toLocaleString('pt-BR')}`;

function montarRecomendacao(r, frases = new Map()) {
  const finalistas = r.finalistas || [];
  const criterios = r.plano?.criterios || [];
  const traducoes = citacoesParaTraduzir(r);
  const traducaoDe = (c) => {
    const i = indiceDaTraducao(traducoes, c);
    return i >= 0 ? frases.get(`C${i + 1}`) || null : null;
  };
  const partes = [];
  const topo = finalistas[0];
  // Revisão v4: UM produto nomeado ("o Kinera é bom para FPS?") é avaliação,
  // não recomendação — sem "a recomendação é", sem "As opções"/"Qual escolher"
  if (r.avaliacao && topo) return montarAvaliacao(r, topo, frases, traducaoDe);
  partes.push('### Resposta direta', frases.get('DIRETA') || (topo ? `A recomendação é o **${topo.nome}**. ${fraseRecomendacaoPadrao(topo, r)}` : 'O material não trouxe opção com respaldo suficiente para recomendar.'));

  const comPorque = criterios.filter((k) => k.porque);
  if (comPorque.length) {
    partes.push('', `### Como escolhi${r.plano?.tipoDeUso ? ` (${r.plano.tipoDeUso})` : ''}`, ...comPorque.map((k) => `- **${k.nome}** — ${k.porque}`));
    partes.push('', 'A ordem abaixo vem da evidência nesses critérios e de quantas conversas da comunidade recomendam cada opção para esse uso — não da quantidade de sites que citam o nome.');
  }

  // Um cartão por opção (11/10, formato pedido pelo Davi a partir de uma
  // resposta de referência): nome numerado, selo, faixa de preço, pontos
  // fortes, o que quem usa diz e o ponto de atenção — parágrafos rotulados em
  // vez de lista. O status por critério saiu daqui: repetia "comentado por 2+
  // fontes" sete vezes por opção, e a Tabela logo abaixo já mostra isso.
  // (renderer/md.js desenha cada "#### N. Nome" como cartão.)
  const maisRecomendado = [...finalistas].sort((a, b) => (b.consenso?.topicos || 0) - (a.consenso?.topicos || 0))[0];
  const baratos = opcoesMaisBaratas(finalistas, r.precos).filter((x) => x.f !== topo);
  const seloDe = (f) => {
    if (f === topo) return 'Recomendação principal';
    if (f === maisRecomendado && f.consenso?.topicos) return 'Mais recomendado pela comunidade';
    if (baratos.some((x) => x.f === f)) return 'Menor preço observado';
    return '';
  };
  partes.push('', '### As opções');
  finalistas.forEach((f, i) => {
    partes.push('', `#### ${i + 1}. ${f.nome}`);
    // foto do produto (src/tools/imagens.js), quando a busca de imagens achou uma
    const foto = r.imagens?.get?.(f.nome);
    if (foto) partes.push(`![${f.nome.replace(/[[\]]/g, ' ')}](${foto})`, '');
    if (seloDe(f)) partes.push(`*${seloDe(f)}*`, '');
    if (r.precos?.[f.nome]) partes.push(`**Faixa de preço:** ${textoDoPreco(r.precos[f.nome])}`, '');
    partes.push(`**Pontos fortes:** ${frases.get(f.nome.toUpperCase()) || fraseRecomendacaoPadrao(f, r)}`, '');
    partes.push(`**Na comunidade:** ${respaldoCurto(f)}.`);
    const { aFavor, critica } = citacoesDoProduto(f, r);
    // 13/10: o texto de "Pontos fortes" já explica o que quem usa relata; aqui
    // fica UM comentário como prova (antes iam dois, e a resposta parecia colagem)
    if (aFavor[0]) partes.push(citacaoFormatada(aFavor[0], traducaoDe(aFavor[0])));
    partes.push('', ...linhasDeLimitacoes(f, criterios, critica, traducaoDe));
    const resumo = r.matriz?.resumos?.get?.(f.nome) || {};
    if (resumo.ficha?.texto) partes.push('', `**Ficha:** ${curto(resumo.ficha.texto, 200)}`);
  });

  // tabela curta: o que o material diz de cada opção em cada critério
  if (finalistas.length >= 2 && criterios.length) {
    // Etapa I: a tabela é uma visão do livro de evidências (com a matriz de reserva)
    // diagnóstico de 10/10: a célula mostrava o começo de um trecho em inglês
    // ("- [1 votos] Waiting for my simgot eg280 I have…"), que não diz nada.
    // Agora: o veredito curto quando existe e está em português; senão, quanto
    // o material sustenta (o trecho inteiro continua no bloco de cada produto).
    const cel = (f, k) => {
      const c = r.livro?.celula?.(f.nome, k.nome) || r.matriz?.celula?.(f.nome, k.nome);
      if (!c?.dominios?.size) return 'sem dados';
      if (vereditoMostravel(c.veredito)) return c.veredito.replace(/\|/g, '/');
      const st = f.status?.[k.nome] || (c.dominios.size >= 2 ? 'corroborado' : 'fonte única');
      return ROTULO_CELULA[st] || ROTULO_STATUS[st] || st;
    };
    partes.push('', '### Tabela', `| Critério | ${finalistas.map((f) => f.nome).join(' | ')} |`, `|---|${finalistas.map(() => '---').join('|')}|`);
    for (const k of criterios) partes.push(`| ${k.nome} | ${finalistas.map((f) => cel(f, k)).join(' | ')} |`);
  }

  // qual escolher: só cenário com opção diferente e com motivo
  const cenarios = [];
  if (topo) cenarios.push(`- **Melhor no geral:** ${topo.nome} — ${porQueNaFrente(topo, finalistas[1], criterios)}.`);
  if (maisRecomendado && maisRecomendado !== topo && maisRecomendado.consenso?.topicos) cenarios.push(`- **Mais recomendado pela comunidade:** ${maisRecomendado.nome} — ${respaldoCurto(maisRecomendado)}.`);
  const maisBarato = baratos[0] || null;
  if (baratos.length) {
    // 10/10: comparava só os preços em real (QKZ a R$ 160) com o Vivace a US$ 30 ao lado — sem converter moeda, diz cada uma
    const porMoeda = baratos.map((x) => `${x.p.moeda === 'BRL' ? 'em real' : 'em dólar'}, ${x.f.nome} (${precoCurto(x.p)})`);
    cenarios.push(`- **Pelo preço:** o menor preço observado ${porMoeda.join('; ')}${baratos.length > 1 ? ' — as moedas não foram convertidas' : ''}.`);
  }
  const preco = maisBarato ? null : criterios.find((k) => /pre[cç]o|custo/i.test(k.nome));
  if (preco) {
    const barato = finalistas.find((f) => f !== topo && ['corroborado', 'fonte única'].includes(f.status?.[preco.nome]));
    if (barato) cenarios.push(`- **Pelo preço:** ${barato.nome} — ${curto(r.matriz?.celula?.(barato.nome, preco.nome)?.veredito || 'o material destaca o preço', 90)}.`);
  }
  if (cenarios.length) partes.push('', '### Qual escolher', ...cenarios);

  const faltas = [];
  for (const f of finalistas) {
    const sem = criterios.filter((k) => (f.status?.[k.nome] || 'sem dados') === 'sem dados').map((k) => k.nome);
    if (sem.length) faltas.push(`- ${f.nome}: ${sem.join(', ')}`);
  }
  if (faltas.length) partes.push('', '### O que não foi confirmado', 'Sem evidência no material lido (não quer dizer que seja ruim):', ...faltas);
  return partes.join('\n');
}

function montarAvaliacao(r, f, frases, traducaoDe) {
  const criterios = r.plano?.criterios || [];
  // 13/10 (pedido do Davi): a avaliação de UM produto abre como as outras
  // respostas — foto, o que é o produto e o preço — antes do veredito
  const partes = [];
  const foto = r.imagens?.get?.(f.nome);
  if (foto) partes.push(`![${f.nome.replace(/[[\]]/g, ' ')}](${foto})`, '');
  if (frases.get('OQUEE')) partes.push(frases.get('OQUEE'), '');
  partes.push('### Resposta direta', frases.get('DIRETA') || `O que o material diz do **${f.nome}** para ${r.plano?.uso || 'esse uso'}: ${fraseRecomendacaoPadrao(f, r)}`);
  if (frases.get(f.nome.toUpperCase())) partes.push('', frases.get(f.nome.toUpperCase()));
  if (r.precos?.[f.nome]) partes.push('', `**Faixa de preço:** ${textoDoPreco(r.precos[f.nome])}`);
  const comPorque = criterios.filter((k) => k.porque);
  if (comPorque.length) partes.push('', `### O que importa${r.plano?.tipoDeUso ? ` (${r.plano.tipoDeUso})` : ''}`, ...comPorque.map((k) => `- **${k.nome}** — ${k.porque}`));
  partes.push('', `### ${f.nome} nesses critérios`);
  const resumo = r.matriz?.resumos?.get?.(f.nome) || {};
  if (resumo.ficha?.texto) partes.push(`- **Ficha:** ${curto(resumo.ficha.texto, 220)}`);
  for (const k of criterios) {
    const c = r.livro?.celula?.(f.nome, k.nome) || r.matriz?.celula?.(f.nome, k.nome);
    const st = f.status?.[k.nome] || 'sem dados';
    const texto = c?.dominios?.size ? curto(c.veredito || c.trechos?.[0]?.texto || 'citado', 160) : 'sem evidência no material lido';
    partes.push(`- **${k.nome}** (${ROTULO_STATUS[st] || st}): ${texto}`);
  }
  partes.push(`- **Comunidade:** ${respaldoCurto(f)}.`);
  const cits = (f.consenso?.citacoes || []).slice(0, 2);
  if (cits.length) {
    partes.push('', '### O que os usuários dizem');
    for (const c of cits) partes.push(citacaoFormatada(c, traducaoDe(c)));
  }
  const sem = criterios.filter((k) => (f.status?.[k.nome] || 'sem dados') === 'sem dados').map((k) => k.nome);
  if (sem.length) partes.push('', '### O que não foi confirmado', `Sem evidência no material lido sobre ${sem.join(', ')} (não quer dizer que seja ruim).`);
  return partes.join('\n');
}

/* ------------------------------ montagem: desempenho ------------------------------ */

function montarDesempenho(r, frases = new Map()) {
  const [A, B] = r.plano?.opcoesCitadas || [];
  const d = r.desempenho || {};
  const g = d.porResolucao?.geral;
  const partes = ['### Resposta direta'];
  if (g) {
    partes.push(
      `Em jogos, a **${B}** é **${porcento(g.mediana)} ${g.mediana >= 0 ? 'mais rápida' : 'mais lenta'}** que a **${A}** — mediana de ${g.n} resultado${g.n === 1 ? '' : 's'} de ${g.fontes} fonte${g.fontes === 1 ? '' : 's'} (de ${comSinal(g.min)} a ${comSinal(g.max)}).` +
        (frases.get('PRATICA') ? ` ${frases.get('PRATICA')}` : '')
    );
    const res = ['1080p', '1440p', '4K'].filter((k) => d.porResolucao?.[k]).map((k) => `**${k}:** ${d.porResolucao[k].mediana >= 0 ? '+' : '−'}${porcento(d.porResolucao[k].mediana)} (${d.porResolucao[k].n} resultado${d.porResolucao[k].n === 1 ? '' : 's'})`);
    if (res.length) partes.push('', '### Diferença por resolução', res.join(' · '));
  } else {
    partes.push(`Não encontrei medição de FPS em jogos com as duas placas nas páginas lidas — por isso não dou uma porcentagem.${d.sinteticos ? ` Só há teste sintético, que não mede jogo: ${porcento(d.sinteticos.mediana)} (teste sintético).` : ''}`);
  }
  const tabelaJogos = String(r.blocoDesempenho || '').split('JOGOS MEDIDOS:')[1];
  if (tabelaJogos) partes.push('', '### Jogos medidos', tabelaJogos.split('MÉTODO:')[0].trim());
  const ficha = String(r.planoDeResposta || '').match(/FICHA TÉCNICA \(extraída pelo código[^\n]*\n([\s\S]*?)(\n\n|$)/);
  if (ficha) partes.push('', '### Ficha técnica', ficha[1].trim());
  if (r.precos?.[A] && r.precos?.[B]) {
    const dif = (r.precos[B].mediana / r.precos[A].mediana - 1) * 100;
    partes.push(
      '',
      '### Preço e custo por quadro',
      `Preço observado nas páginas lidas: ${A} R$ ${Math.round(r.precos[A].mediana).toLocaleString('pt-BR')} · ${B} R$ ${Math.round(r.precos[B].mediana).toLocaleString('pt-BR')}. A ${B} custa ${dif >= 0 ? '+' : '−'}${porcento(dif)}${g ? ` para ${g.mediana >= 0 ? '+' : '−'}${porcento(g.mediana)} de desempenho em jogos` : ''}.`
    );
  }
  const traducoes = citacoesParaTraduzir(r);
  const cits = (r.finalistas || []).flatMap((f) => (f.consenso?.citacoes || []).slice(0, 2));
  if (cits.length) {
    partes.push('', '### O que a comunidade diz');
    for (const c of cits.slice(0, 4)) {
      const i = indiceDaTraducao(traducoes, c);
      partes.push(citacaoFormatada(c, i >= 0 ? frases.get(`C${i + 1}`) : null));
    }
  }
  const veredito = !g
    ? 'Sem medição de jogos, não dá para dizer com segurança qual vale mais — confira reviews com FPS em jogos.'
    : Math.abs(g.mediana) < 1
      ? `Em jogos as duas ficam praticamente empatadas: decida pelo preço e pelo consumo.`
      : g.mediana > 0
        ? `Se o orçamento permite e o jogo é pesado em 1440p/4K, os ${porcento(g.mediana)} a mais da ${B} aparecem; se não, a ${A} entrega a maior parte do desempenho.`
        : `A ${A} é ${porcento(g.mediana)} mais rápida em jogos; a ${B} só compensa se for bem mais barata.`;
  partes.push('', '### Veredito', frases.get('VEREDITO') || veredito);
  const faltas = [];
  if (!g) faltas.push('- FPS em jogos com as duas placas');
  if (!(r.precos?.[A] && r.precos?.[B])) faltas.push('- preço das duas placas nas páginas lidas');
  if (!ficha) faltas.push('- ficha técnica');
  if (faltas.length) partes.push('', '### O que não foi possível medir', ...faltas);
  return partes.join('\n');
}

/* ------------------------------ montagem: dado de uso ------------------------------ */

/** Produto que o pedido nomeia ("O Bose QC 20 é usado…" → "Bose QC 20"): marca + modelo, com número ou sigla. */
function produtoNomeadoNoPedido(objetivo) {
  const candidatos = String(objetivo || '').match(/[A-Z][A-Za-z]+(?:[ -](?:[A-Z]{2,}|[A-Z]?[a-z]*\d[\w]*|\d+|[A-Z][a-z]+)){1,3}/g) || [];
  return candidatos.find((c) => /\d|[A-Z]{2,}/.test(c.split(/[ -]/).slice(1).join(' '))) || null;
}

function montarUso(r) {
  const u = r.uso || {};
  const topo = u.ranking?.[0];
  const partes = ['### Resposta direta'];
  // 12/10: "O Bose QC 20 é usado por muitos pro players?" recebia só a tabela
  // dos mais usados, sem dizer se o Bose QC 20 está nela. Quando o pedido
  // nomeia um produto, a primeira frase responde sobre ELE.
  const nomeado = produtoNomeadoNoPedido(r.objetivo);
  if (nomeado && u.total >= 3) {
    const chave = (t) => normalizar(t).replace(/ /g, '');
    const posicao = (u.ranking || []).findIndex((x) => chave(x.produto).includes(chave(nomeado)) || chave(nomeado).includes(chave(x.produto)));
    const item = u.ranking?.[posicao];
    partes.push(
      item
        ? `O **${nomeado}** aparece com ${item.jogadores} de ${u.total} jogadores listados (${String(item.parcela).replace('.', ',')}%), em ${posicao + 1}º lugar entre os equipamentos.`
        : `O **${nomeado}** não aparece entre os ${u.total} profissionais listados nas bases lidas — por esses dados, não é um equipamento comum entre eles.`,
      ''
    );
  }
  if (topo && u.total >= 3) {
    partes.push(`Entre os profissionais listados nas bases lidas, o mais usado é o **${topo.produto}**: ${topo.jogadores} de ${u.total} jogadores (${String(topo.parcela).replace('.', ',')}%).`);
    partes.push('', '### Os mais usados', '| Equipamento | Jogadores | Parcela dos listados | Exemplos |', '|---|---:|---:|---|');
    for (const x of u.ranking.slice(0, 10)) partes.push(`| ${x.produto} | ${x.jogadores} | ${String(x.parcela).replace('.', ',')}% | ${x.exemplos.join(', ')} |`);
  } else {
    partes.push('Não encontrei, nas páginas lidas, uma lista de equipamento dos profissionais com dados suficientes para dizer qual é o mais usado.');
  }
  if (u.declarados?.length) {
    partes.push('', '### O que as fontes declaram');
    for (const d of u.declarados.slice(0, 6)) for (const v of d.valores.slice(0, 1)) partes.push(`- **${d.produto}:** ${v.unidade === '%' ? `${String(v.valor).replace('.', ',')}%` : `${v.valor} jogadores`} — "${curto(v.trecho, 200)}"`);
  }
  partes.push(
    '',
    '### Ressalvas',
    '- A contagem vale para os jogadores listados nessas bases, não para todos os profissionais.',
    '- Patrocínio do time influencia o equipamento.',
    '- Em campeonato presencial, a organização costuma padronizar o equipamento de áudio.'
  );
  return partes.join('\n');
}

/** Números que o modelo pode usar nas frases (os do material que o código montou). */
function numerosDaComposicao(r) {
  // nomes dos produtos (5070, 5080) e resoluções também são "números permitidos"
  const partes = [JSON.stringify(r.desempenho?.porResolucao || {}), JSON.stringify(r.precos || {}), ...(r.plano?.opcoesCitadas || []), '1080 1440 4 2160 1080p 1440p 4k'];
  for (const f of r.finalistas || []) partes.push(fatosDoProduto(f, r), JSON.stringify(f.consenso?.citacoes || []));
  for (const d of r.dicas || []) partes.push(d.texto, d.fontes.map((f) => f.trecho).join(' '), String(d.nFontes));
  return partes.join(' ');
}

function montar(r, frases) {
  if (r.modo === 'desempenho') return montarDesempenho(r, frases);
  if (r.modo === 'uso-profissional') return montarUso(r);
  if (r.modo === 'guia') return montarGuia(r, frases);
  return montarRecomendacao(r, frases);
}

/** Produtos sem crítica no material (a frase deles não pode trazer ressalva). */
function produtosSemCritica(r) {
  return (r?.finalistas || []).filter((f) => !citacoesDoProduto(f, r).critica).map((f) => f.nome);
}

module.exports = { produtosSemCritica, pedidoDeFrases, lerFrases, montar, montarRecomendacao, montarDesempenho, montarUso, montarGuia, numerosDaComposicao, citacoesParaTraduzir, textoDoPreco, porQueNaFrente };
