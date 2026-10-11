'use strict';

/**
 * Ferramentas de navegação com interação.
 *
 * A sessão real vive no processo principal (Electron) e chega aqui por
 * `ctx.navegador`. Sem ela — na bancada, por exemplo — as ferramentas recusam
 * com mensagem clara em vez de quebrar.
 *
 * Todas são de risco ALTO: o navegador age na web com as SUAS sessões abertas.
 * Clicar em "confirmar compra" logado é uma ação irreversível como qualquer
 * outra, e por isso passa pelo mesmo portão de aprovação do terminal.
 */

const { validarUrl } = require('./http');
const { conferirDestino } = require('./rede');

function sessao(ctx) {
  if (!ctx.navegador) {
    throw new Error(
      'navegação interativa indisponível nesta execução. Use abrir_pagina para leitura simples.'
    );
  }
  return ctx.navegador;
}

const crypto = require('crypto');

/**
 * Controlador v2 (revisão v3, execuções de 05/10): o que MUDOU na página
 * depois da ação, medido pelo código. Antes o modelo recebia a página nova
 * inteira e tinha de deduzir sozinho se o clique funcionou — e o guarda de
 * repetição não sabia se a página era a mesma. A impressão digital (URL +
 * título + elementos + começo do texto) responde as duas coisas.
 */
const ACOES_QUE_DEVEM_MUDAR = new Set(['navegar', 'clicar', 'enviar_formulario', 'voltar_pagina']);
/**
 * Relógios, contadores de sessão e datas mudam sozinhos e fariam toda página
 * parecer "nova" (revisão do Controlador v2): saem da impressão. O texto entra
 * INTEIRO — cortar nos 3000 primeiros caracteres escondia mudanças no rodapé
 * (mensagem de erro, resultado do formulário) e dava falso "nada mudou".
 */
const RUIDO_DE_TEMPO = /\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\bh[aá]\s+\d+\s+\w+/gi;
function impressaoDaPagina(p = {}) {
  const texto = String(p.texto || '').replace(RUIDO_DE_TEMPO, '#');
  return crypto
    .createHash('sha1')
    .update([p.url || '', p.titulo || '', (p.elementos || []).join('\n'), texto].join('\u0000'))
    .digest('hex')
    .slice(0, 12);
}

/** Tipo do elemento N ('[3] caixa "Lembrar"' → 'caixa'). */
function tipoDoElemento(pagina, numero) {
  const linha = (pagina?.elementos || []).find((l) => new RegExp(`^\\[${Number(numero)}\\]`).test(String(l)));
  return linha ? (/^\[\d+\]\s+([^"]+?)\s*"/.exec(String(linha))?.[1] || '').trim() : '';
}
/**
 * Cliques que legitimamente não mudam a leitura: marcar caixa/opção, abrir
 * seleção ou focar campo. Contá-los como "sem progresso" travava formulários.
 */
const ALVO_SEM_MUDANCA_VISIVEL = /^(caixa|op[cç][aã]o|sele[cç][aã]o|campo)/i;

/**
 * Grava o estado da página em ctx.estado e devolve a linha de mudança pro modelo.
 * `info` traz o número do elemento e o valor (preencher) para o guarda saber
 * se a ação foi de fato diferente da anterior.
 */
function registrarPagina(ctx, pagina, acao, info = {}) {
  const eventos = linhasDosEventos(ctx, pagina.eventos);
  const mudanca = linhaDeMudanca(ctx, pagina, acao, info, eventos.relevante);
  if (ctx.estado?.ultimaAcaoNavegador) {
    ctx.estado.ultimaAcaoNavegador.downloads = eventos.downloads;
    ctx.estado.ultimaAcaoNavegador.janelaNova = (pagina.eventos || []).some((e) => e.tipo === 'janela-nova');
  }
  return [...eventos.linhas, mudanca].filter(Boolean).join('\n');
}

/**
 * Revisão v4 (contracheque real, 07/10): o que aconteceu FORA da página lida
 * — download, janela nova, janela fechada (ver electron/navegador.js). Sem
 * isto o agente baixou o PDF, recebeu "nada mudou" e respondeu que não
 * conseguiu.
 */
function linhasDosEventos(ctx, eventos = []) {
  const linhas = [];
  const downloads = [];
  let relevante = false;
  const estado = ctx.estado || (ctx.estado = {});
  const workspace = ctx.config?.workspace || ctx.workspace || '';
  for (const e of eventos || []) {
    if (e.tipo === 'janela-nova') {
      relevante = true;
      linhas.push(`NOVA JANELA ABERTA pelo site${e.url ? ` (${e.url})` : ''} — a leitura abaixo já é dela, e as próximas ações acontecem nela.`);
    } else if (e.tipo === 'janela-fechada') {
      relevante = true;
      linhas.push('A JANELA NOVA FOI FECHADA — de volta à janela anterior (leitura abaixo).');
    } else if (e.tipo === 'download') {
      const kb = e.bytes ? ` (${Math.max(1, Math.round(e.bytes / 1024))} KB)` : '';
      if (e.estado === 'concluido') {
        relevante = true;
        const registro = { nome: e.nome, caminho: e.caminho || '', bytes: e.bytes || 0 };
        downloads.push(registro);
        (estado.downloads ||= []).push(registro);
        linhas.push(`DOWNLOAD CONCLUÍDO: "${e.nome}"${kb} salvo em ${e.caminho || '(pasta escolhida pelo usuário)'}. O arquivo já está no computador do usuário — não precisa baixar de novo.`);
        // dentro da pasta de trabalho: vira anexo na conversa, como os arquivos gerados
        const relativo = workspace && e.caminho && pathRelativoDentro(workspace, e.caminho);
        ctx.emit?.('download-concluido', { nome: e.nome, caminho: e.caminho || '', relativo: relativo || null, bytes: e.bytes || 0 });
      } else if (e.estado === 'em-andamento') {
        relevante = true;
        linhas.push(`DOWNLOAD EM ANDAMENTO: "${e.nome}" — ainda não terminou (talvez a janela "Salvar como" esteja esperando o usuário). Use ver_pagina daqui a pouco para saber se concluiu.`);
      } else {
        linhas.push(`DOWNLOAD ${e.estado === 'cancelado' ? 'CANCELADO' : 'FALHOU'}: "${e.nome}".`);
      }
    }
  }
  return { linhas, downloads, relevante };
}

function pathRelativoDentro(raiz, alvo) {
  const path = require('path');
  const rel = path.relative(path.resolve(raiz), path.resolve(alvo));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null;
}

function linhaDeMudanca(ctx, pagina, acao, info = {}, aconteceuAlgo = false) {
  const estado = ctx.estado || (ctx.estado = {});
  const antes = estado.pagina || null;
  const impressao = impressaoDaPagina(pagina);
  let mudou = !antes || antes.impressao !== impressao || aconteceuAlgo;
  const urlMudou = !antes || antes.url !== pagina.url;
  // Valor digitado: campos de senha não aparecem na leitura, então o código
  // guarda o que foi preenchido. Valor novo no campo = progresso.
  if (acao === 'preencher_campo' && info.numero != null) {
    const preenchidos = estado.preenchidos || (estado.preenchidos = {});
    const chave = String(Number(info.numero));
    const valor = String(info.valor ?? '');
    if (preenchidos[chave] !== valor) mudou = true;
    preenchidos[chave] = valor;
  }
  if (urlMudou && antes) estado.preenchidos = acao === 'preencher_campo' ? estado.preenchidos : {};
  const tipoAlvo = acao === 'clicar' && antes ? tipoDoElemento(antes, info.numero) : '';
  estado.pagina = { url: pagina.url, titulo: pagina.titulo || '', impressao, elementos: (pagina.elementos || []).slice(0, 120) };
  estado.paginaAnterior = antes;
  estado.ultimaAcaoNavegador = { acao, mudou, urlMudou, numero: info.numero ?? null };
  // Progresso: QUALQUER mudança zera o contador; só conta como "sem progresso"
  // a ação que deveria mudar a página e não mudou. Voltar e cliques em
  // caixa/opção/seleção/campo ficam de fora (mudam estado sem mudar a leitura).
  // voltar também zera: é a saída do beco, não mais uma tentativa às cegas
  if (mudou || acao === 'voltar_pagina') estado.navSemProgresso = 0;
  else if (ACOES_QUE_DEVEM_MUDAR.has(acao) && acao !== 'voltar_pagina' && !ALVO_SEM_MUDANCA_VISIVEL.test(tipoAlvo)) {
    estado.navSemProgresso = (estado.navSemProgresso || 0) + 1;
  }
  if (!antes || acao === 'ver_pagina') return '';
  if (!mudou) {
    if (ALVO_SEM_MUDANCA_VISIVEL.test(tipoAlvo)) return `MUDANÇA NA PÁGINA: nenhuma visível (normal ao clicar em ${tipoAlvo}).`;
    return ACOES_QUE_DEVEM_MUDAR.has(acao)
      ? 'MUDANÇA NA PÁGINA: NENHUMA — a página ficou exatamente igual depois desta ação. Não repita a mesma ação: escolha outro elemento pelo TEXTO, volte (voltar_pagina), ou responda com o que conseguiu.'
      : 'MUDANÇA NA PÁGINA: nenhuma visível (o mesmo valor já estava no campo).';
  }
  if (acao === 'preencher_campo' && !urlMudou && antes.impressao === impressao) return 'MUDANÇA NA PÁGINA: valor digitado no campo (senhas não aparecem na leitura).';
  return urlMudou ? `MUDANÇA NA PÁGINA: sim — página nova (${pagina.url}).` : 'MUDANÇA NA PÁGINA: sim — mesma URL, conteúdo ou elementos mudaram.';
}

/** Rótulo do elemento N na página atual ('[3] botão "Emitir"' → 'Emitir'). */
function rotuloDoElemento(pagina, numero) {
  const linha = (pagina?.elementos || []).find((l) => new RegExp(`^\\[${Number(numero)}\\]`).test(String(l)));
  return linha ? (/"([^"]*)"/.exec(linha)?.[1] || '').trim() : '';
}

/** Formata a leitura da página no que o modelo precisa para decidir o passo. */
function descrever(pagina, prefixo = '', mudanca = '') {
  const partes = [
    mudanca || null,
    `${prefixo}${pagina.titulo || '(sem título)'}`,
    pagina.url,
    '',
    pagina.elementos.length
      ? `ELEMENTOS INTERAGÍVEIS (use o número):\n${pagina.elementos.join('\n')}`
      : 'Nenhum elemento interagível encontrado.',
    '',
    'CONTEÚDO DA PÁGINA:',
    pagina.texto || '(sem texto)',
    pagina.truncado ? '\n[…texto truncado]' : '',
  ];
  return partes.filter((p) => p !== null).join('\n');
}

module.exports = [
  {
    name: 'navegar',
    risk: 'alto',
    description:
      'Abre uma página num navegador de verdade e devolve o texto mais a lista numerada de links, botões e campos. Use quando a página exigir login, clique ou preenchimento — para leitura simples, abrir_pagina é mais barato.',
    args: { url: 'endereço completo com https://' },
    obrigatorios: ['url'],
    async run({ url }, ctx) {
      validarUrl(url);
      // Fase 1 de segurança: mesmo bloqueio de rede local de abrir_pagina
      // (src/tools/rede.js). Redirecionamentos e cliques dentro do navegador
      // são barrados pela própria sessão (electron/navegador.js).
      await conferirDestino(String(url), ctx.config);
      const pagina = await sessao(ctx).navegar(String(url));
      ctx.emit('fonte', { tipo: 'leitura', provedor: 'navegador', url: pagina.url });
      ctx.estado.navegando = true;
      return descrever(pagina, '', registrarPagina(ctx, pagina, 'navegar'));
    },
  },

  {
    name: 'ver_pagina',
    risk: 'baixo',
    description:
      'Relê a página aberta no navegador, atualizando a numeração dos elementos. Use depois de qualquer ação que mude a tela.',
    args: {},
    obrigatorios: [],
    async run(_argumentos, ctx) {
      const pagina = await sessao(ctx).ler();
      return descrever(pagina, 'Página atual: ', registrarPagina(ctx, pagina, 'ver_pagina'));
    },
  },

  {
    name: 'clicar',
    risk: 'alto',
    description:
      'Clica num elemento da página aberta, pelo número que apareceu na leitura. Devolve a página já atualizada.',
    args: { numero: 'número do elemento, como aparece entre colchetes na leitura' },
    obrigatorios: ['numero'],
    async run({ numero }, ctx) {
      const pagina = await sessao(ctx).clicar(numero);
      return descrever(pagina, `Depois de clicar em [${numero}]: `, registrarPagina(ctx, pagina, 'clicar', { numero }));
    },
  },

  {
    name: 'preencher_campo',
    risk: 'alto',
    description: 'Escreve um valor num campo da página aberta, pelo número do elemento.',
    args: {
      numero: 'número do campo, como aparece entre colchetes na leitura',
      valor: 'texto a digitar',
    },
    obrigatorios: ['numero', 'valor'],
    async run({ numero, valor }, ctx) {
      const pagina = await sessao(ctx).preencher(numero, valor);
      return descrever(pagina, `Depois de preencher [${numero}]: `, registrarPagina(ctx, pagina, 'preencher_campo', { numero, valor }));
    },
  },

  {
    name: 'enviar_formulario',
    risk: 'alto',
    description:
      'Envia o formulário do campo indicado, como se você apertasse Enter nele. Use depois de preencher os campos.',
    args: { numero: 'número de um campo do formulário' },
    obrigatorios: ['numero'],
    async run({ numero }, ctx) {
      const pagina = await sessao(ctx).enviar(numero);
      return descrever(pagina, 'Depois de enviar o formulário: ', registrarPagina(ctx, pagina, 'enviar_formulario', { numero }));
    },
  },

  {
    name: 'voltar_pagina',
    risk: 'medio',
    description: 'Volta uma página no histórico do navegador.',
    args: {},
    obrigatorios: [],
    async run(_argumentos, ctx) {
      const pagina = await sessao(ctx).voltar();
      return descrever(pagina, 'Depois de voltar: ', registrarPagina(ctx, pagina, 'voltar_pagina'));
    },
  },
];

module.exports.descrever = descrever;
module.exports.impressaoDaPagina = impressaoDaPagina;
module.exports.registrarPagina = registrarPagina;
module.exports.rotuloDoElemento = rotuloDoElemento;
module.exports.ACOES_QUE_DEVEM_MUDAR = ACOES_QUE_DEVEM_MUDAR;
module.exports.tipoDoElemento = tipoDoElemento;
