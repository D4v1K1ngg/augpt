'use strict';

/**
 * Investigação com tempo (17/10, pedido do Davi): o usuário dá N minutos e o
 * AuGPT pesquisa o tema por partes até o tempo acabar — em vez de umas poucas
 * buscas e a resposta, como o modelo local faz quando decide sozinho ("é
 * preguiçoso"). Quem comanda o tempo e a ordem é o CÓDIGO:
 *
 *   1. entende o pedido e divide o tema em subtemas (o modelo propõe);
 *   2. pesquisa um subtema por vez com o núcleo (modo normal) e escreve uma
 *      seção com as fontes dele, numeradas num índice único;
 *   3. sobrando tempo depois da lista, pede ao modelo o que ainda falta saber
 *      (lacunas) e continua;
 *   4. guarda uma reserva para o fim: um resumo para o chat e o relatório
 *      completo (seções + fontes), que o app grava em PDF.
 *
 * Como no STORM (Stanford): perguntas por ângulo, depois a síntese. Escrever
 * por seção cabe no contexto de 16 mil tokens; o relatório inteiro não caberia.
 * Cancelado no meio, entrega o que já tem.
 */

const nucleo = require('./index');

const MAX_SUBTEMAS = 16;

function pedidoDePlano({ pergunta, conversa = [], minutos }) {
  const antes = conversa.filter((m) => m.role === 'user').slice(-3).map((m) => `- ${String(m.content || '').slice(0, 200)}`).join('\n');
  const quantos = Math.max(3, Math.min(10, Math.round(minutos / 1.5)));
  return `Você vai planejar uma investigação de cerca de ${minutos} minutos sobre o pedido: "${String(pergunta).slice(0, 1500)}"
${antes ? `\nO que o usuário perguntou antes:\n${antes}\n` : ''}
Divida o tema em ${quantos} subtemas que, juntos, respondem ao pedido por completo: o essencial primeiro, depois os ângulos que um especialista também investigaria (como funciona, dados e números, história, comparação, prós e contras, situação atual, críticas, o que vem por aí — o que fizer sentido para o tema).
Responda SÓ com um JSON:
{"titulo": "título curto do relatório", "subtemas": [{"titulo": "título da seção", "pergunta": "a pergunta de pesquisa desse subtema, completa e com o nome do assunto"}]}`;
}

function pedidoDeLacunas({ pergunta, feitas, notas }) {
  return `Investigação sobre: "${String(pergunta).slice(0, 800)}"
Já pesquisado: ${feitas.map((t) => `"${t}"`).join(', ')}.
Resumo do que se achou até agora:
${String(notas).slice(0, 4000)}

Ainda há tempo. Que 2 ou 3 perguntas ainda faltam responder para a investigação ficar completa (lacunas, pontos que as fontes deixaram em aberto, contradições a esclarecer)? Não repita o que já foi pesquisado.
Responda SÓ com um JSON:
{"subtemas": [{"titulo": "título da seção", "pergunta": "a pergunta de pesquisa, completa e com o nome do assunto"}]}`;
}

function lerPlano(texto, pergunta) {
  try {
    const j = JSON.parse(String(texto).slice(String(texto).indexOf('{'), String(texto).lastIndexOf('}') + 1));
    const subtemas = (Array.isArray(j.subtemas) ? j.subtemas : [])
      .map((s) => ({ titulo: String(s?.titulo || '').trim().slice(0, 120), pergunta: String(s?.pergunta || s?.titulo || '').trim().slice(0, 400) }))
      .filter((s) => s.titulo && s.pergunta.length >= 8);
    return { titulo: String(j.titulo || '').trim().slice(0, 140), subtemas };
  } catch {
    return { titulo: '', subtemas: [] };
  }
}

function sistemaDaSecao({ hoje, pergunta, titulo }) {
  return `Você escreve UMA seção de um relatório de investigação, em português do Brasil. Hoje é ${hoje}.
Relatório sobre: "${String(pergunta).slice(0, 600)}"
Seção: "${titulo}"
- Use só as fontes abaixo. Cite a fonte de cada informação com [n] no fim da frase; não cite número que não está nas fontes.
- Escreva de 2 a 5 parágrafos, com os dados concretos que as fontes trazem (números, datas, nomes). Lista ou tabela quando ajudar.
- Não escreva o título da seção nem introdução ao relatório inteiro — só o conteúdo desta seção.
- Se as fontes não respondem a esta parte, diga isso em uma frase, sem inventar.`;
}

function sistemaDoResumo({ hoje, tamanho = 'normal' }) {
  return `Você escreve o RESUMO de uma investigação, em português do Brasil, para o chat. Hoje é ${hoje}.
- Comece respondendo diretamente ao pedido. Depois traga os pontos mais importantes de cada parte, com os dados concretos.
- Cite as fontes com [n], os mesmos números das seções.
- ${tamanho === 'detalhada' ? 'Até umas 800 palavras.' : 'Entre 250 e 500 palavras.'} O relatório completo vai em PDF; não diga "veja o PDF" a cada parágrafo.
- Não invente nada que não esteja nas seções.`;
}

/**
 * @param minutos   tempo total que o usuário deu
 * @param deps      os mesmos do núcleo (chamar, escrever, buscar, lerPagina, embed, emit, signal…)
 * @returns {{ texto, relatorio: { titulo, markdown }, fontes, secoes, buscou, modo }}
 */
async function investigar({ pergunta, conversa = [], minutos = 10, tamanho = 'normal', deps, hoje = new Date().toLocaleDateString('pt-BR'), agora = () => Date.now() }) {
  const { chamar, escrever, embed, emit = () => {}, signal } = deps;
  const inicio = agora();
  const totalMs = Math.max(1, Number(minutos) || 10) * 60000;
  const limite = inicio + totalMs;
  // reserva para o resumo e o relatório (medido em 17/10: o resumo
  // levou 11 s na RTX 3060 Ti; com 20%/90 s, uma investigação de 4 min parou em 2 min 26 s)
  // (e com 45 s fixos, uma de 2 min usou só 73 s): 10%, mínimo de 25 s
  const reserva = Math.min(3 * 60000, Math.max(25000, totalMs * 0.1));
  const restanteS = () => Math.max(0, Math.round((limite - agora()) / 1000));

  emit('iteracao', { n: 1, de: 1 });
  const ent = nucleo.conferirEntendimento(
    nucleo.lerEntendimento((await chamar([{ role: 'user', content: nucleo.pedidoDeEntendimento({ pergunta, conversa, hoje }) }], { json: true, numPredict: 300 })).content, pergunta),
    { pergunta, conversa }
  );
  const plano = lerPlano((await chamar([{ role: 'user', content: pedidoDePlano({ pergunta: ent.pergunta, conversa, minutos }) }], { json: true, numPredict: 900 })).content, ent.pergunta);
  const fila = plano.subtemas.length ? plano.subtemas : [{ titulo: 'Visão geral', pergunta: ent.pergunta }];
  const titulo = plano.titulo || ent.pergunta;
  emit('investigacao-plano', { titulo, subtemas: fila.map((s) => s.titulo), minutos });

  const fontes = []; // índice único do relatório
  const porUrl = new Map();
  const secoes = [];
  const feitas = new Set();
  let pediuLacunas = 0;
  const inicioDaPesquisa = agora();

  while (fila.length && !signal?.aborted && secoes.length < MAX_SUBTEMAS) {
    const sobra = limite - agora() - reserva;
    const media = secoes.length ? (agora() - inicioDaPesquisa) / secoes.length : 0;
    // não começa um subtema que não vai dar tempo de terminar (o primeiro sempre roda)
    if (secoes.length && (sobra <= 0 || sobra < media * 0.7)) break;
    const sub = fila.shift();
    if (feitas.has(sub.titulo.toLowerCase())) continue;
    feitas.add(sub.titulo.toLowerCase());
    emit('investigacao-progresso', { parte: secoes.length + 1, titulo: sub.titulo, previstas: secoes.length + 1 + fila.length, restanteS: restanteS() });

    let achadas = [];
    try {
      achadas = await nucleo.pesquisar({ pergunta: sub.pergunta, modo: 'normal', deps, hoje, produto: false, assuntos: ent.assuntos || [], conversa });
    } catch (err) {
      if (signal?.aborted) break;
      emit('aviso', { texto: `investigação: "${sub.titulo}" falhou (${err.message}); seguindo` });
      continue;
    }
    if (signal?.aborted) break;
    const usadas = achadas.length ? await nucleo.materialDaEscrita(sub.pergunta, achadas, { embed, limite: 9000 }) : [];
    // números locais → índice único (a mesma página em dois subtemas é uma fonte só)
    const mapa = new Map();
    for (const f of usadas) {
      let g = porUrl.get(f.url);
      if (!g) {
        g = { n: fontes.length + 1, url: f.url, titulo: f.titulo, video: f.video || false, conteudo: f.conteudo };
        fontes.push(g);
        porUrl.set(f.url, g);
      }
      mapa.set(f.n, g.n);
    }
    const material = usadas.map((f) => ({ ...f, n: mapa.get(f.n) }));
    let texto = '';
    if (material.length) {
      texto = nucleo.semImagens(
        await escrever(
          [
            { role: 'system', content: `${sistemaDaSecao({ hoje, pergunta: ent.pergunta, titulo: sub.titulo })}\n\n<fontes>\n${nucleo.blocoDeFontes(material)}\n</fontes>` },
            { role: 'user', content: sub.pergunta },
          ],
          () => {}
        )
      ).replace(/^\s*#{1,6} .*\n/, '');
      const mat = material.map((f) => `${f.titulo} ${f.conteudo}`).join(' ');
      texto = nucleo.conferirResposta(nucleo.conferirAnos(texto.trim(), { material: mat, pergunta, hoje }).texto, { numeros: material.map((f) => f.n), material: mat }).texto;
    } else {
      texto = '*As buscas desta parte não trouxeram fontes que respondessem a ela.*';
    }
    secoes.push({ titulo: sub.titulo, pergunta: sub.pergunta, texto, fontes: material.map((f) => f.n) });
    emit('investigacao-secao', { parte: secoes.length, titulo: sub.titulo, fontes: material.length, restanteS: restanteS() });

    // acabou a lista e sobra tempo para mais umas partes: o que ainda falta saber?
    const mediaAgora = (agora() - inicioDaPesquisa) / secoes.length;
    if (!fila.length && pediuLacunas < 2 && limite - agora() - reserva > mediaAgora * 0.9 && !signal?.aborted) {
      pediuLacunas += 1;
      const notas = secoes.map((s) => `${s.titulo}: ${s.texto.replace(/\[\d+\]/g, '').slice(0, 500)}`).join('\n');
      const novas = lerPlano((await chamar([{ role: 'user', content: pedidoDeLacunas({ pergunta: ent.pergunta, feitas: secoes.map((s) => s.titulo), notas }) }], { json: true, numPredict: 600 })).content, ent.pergunta).subtemas;
      fila.push(...novas.filter((s) => !feitas.has(s.titulo.toLowerCase())).slice(0, 3));
      if (novas.length) emit('investigacao-plano', { titulo, subtemas: [...secoes.map((s) => s.titulo), ...fila.map((s) => s.titulo)], minutos, lacunas: true });
    }
  }

  // resumo para o chat: o que cada seção achou (as seções inteiras vão para o PDF)
  emit('redigindo', { fontes: fontes.length });
  const partes = secoes.map((s, i) => `## ${i + 1}. ${s.titulo}\n${s.texto.slice(0, 2200)}`).join('\n\n');
  let resumo = '';
  if (secoes.length) {
    resumo = nucleo.semImagens(
      await escrever(
        [
          { role: 'system', content: `${sistemaDoResumo({ hoje, tamanho })}\n\n<secoes_do_relatorio>\n${partes.slice(0, 26000)}\n</secoes_do_relatorio>` },
          { role: 'user', content: pergunta },
        ],
        (pedaco) => emit('resposta-token', { pedaco })
      )
    ).trim();
    const mat = fontes.map((f) => `${f.titulo} ${f.conteudo}`).join(' ');
    resumo = nucleo.conferirResposta(nucleo.conferirAnos(resumo, { material: mat, pergunta, hoje }).texto, { numeros: fontes.map((f) => f.n), material: mat }).texto;
  } else {
    resumo = 'A investigação não chegou a terminar nenhuma parte — tente com mais tempo.';
  }

  const gastoS = Math.round((agora() - inicio) / 1000);
  const minutosGastos = `${Math.floor(gastoS / 60)} min ${gastoS % 60} s`;
  const citadas = new Set([...`${resumo} ${secoes.map((s) => s.texto).join(' ')}`.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const listaDeFontes = fontes.filter((f) => citadas.has(f.n));
  const markdown = [
    `# ${titulo}`,
    '',
    `*Investigação do AuGPT · ${hoje} · ${minutosGastos} de ${minutos} min · ${secoes.length} partes · ${listaDeFontes.length} fontes citadas${signal?.aborted ? ' · interrompida antes do fim' : ''}*`,
    '',
    `**Pedido:** ${pergunta}`,
    '',
    '## Resumo',
    '',
    resumo,
    '',
    ...secoes.flatMap((s, i) => [`## ${i + 1}. ${s.titulo}`, '', s.texto, '']),
    '## Fontes',
    '',
    ...listaDeFontes.map((f) => `${f.n}. ${String(f.titulo || f.url).replace(/[[\]]/g, '')} — ${f.url}`),
  ].join('\n');

  return {
    texto: resumo,
    relatorio: { titulo, markdown },
    fontes: listaDeFontes.map(({ n, url, titulo: t }) => ({ n, url, titulo: t })),
    secoes: secoes.map((s) => s.titulo),
    entendimento: ent,
    buscou: fontes.length > 0,
    produto: false,
    assuntos: ent.assuntos || [],
    modo: 'investigacao',
    gastoS,
    interrompida: !!signal?.aborted,
  };
}

module.exports = { investigar, pedidoDePlano, pedidoDeLacunas, lerPlano };
