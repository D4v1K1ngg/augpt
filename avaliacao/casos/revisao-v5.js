'use strict';

/**
 * Revisão v5 (08/10/2026) — o que o log do Ollama 0.40.1 mostrou no PC do
 * Davi depois do teste do DeepSeek R1 no AuGPT e do chat do próprio Ollama:
 *   1. prompt maior que a janela agora é RECUSADO (erro 400) no motor novo,
 *      em vez de cortado em silêncio — o AuGPT perdia a chamada;
 *   2. modelo de decisão (tev1) escolhido como principal/copiloto e modelo
 *      que "pensa" (R1) gastando o limite de resposta raciocinando;
 *   3. histórico de preço: as páginas certas (Hardware Barato, GPUPrix)
 *      foram lidas, mas ninguém extraiu os números delas.
 */

const http = require('http');
const ollama = require('../../src/llm/ollama');
const destilador = require('../../src/agent/destilador');
const primeiroUso = require('../../src/primeiro-uso');
const serie = require('../../src/agent/serie-de-precos');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa } = require('../fixtures/busca-falsa');

// Páginas sintéticas no FORMATO dos sites de histórico (texto achatado:
// rótulo numa linha, valor na outra) — os números são inventados.
const HIST_LINHA = {
  url: 'https://www.hardwarebarato.com/produtos/placas-de-video/rtx-5080',
  titulo: 'RTX 5080: Preço Hoje e Versões | Hardware Barato',
  data: '2024-12-10',
  textoCompleto: [
    'RTX 5080: Preço Hoje e Versões', '# RTX 5080: preço hoje, versões e menor preço',
    '$ Menor preço à vista', 'R$ 10.000,00', 'Oferta atual em Loja A',
    '$ Menor preço parcelado', 'R$ 11.900,00', 'Parcelado em Loja B',
    'Média dos últimos 30 dias: R$ 10.400,00. Menor preço nos últimos 90 dias: R$ 1.850,00.',
    'Modelo base', 'RTX 5080', 'Lançamento', 'fev. de 2025',
    '### MSI RTX 5080 Shadow', 'Parcelado a partir de R$ 13.299,96',
    '| MSI GeForce RTX 5080 Shadow 3X OC | loja-a | R$ 10.000,00 |',
    '| Zotac RTX 5080 Solid | loja-c | R$ 11.200,00 |',
    '| Asus TUF RTX 5080 | loja-d | R$ 14.000,00 |',
  ].join('\n'),
};
const HIST_AGREGADOR = {
  url: 'https://gpuprix.com/pt/brazil/gpus/geforce-rtx-5080',
  titulo: 'GeForce RTX 5080 Preço em Brasil — Histórico',
  data: null,
  textoCompleto: [
    '# GeForce RTX 5080', 'R$10,800 Unidade Nova', 'Atualizado pela última vez em 7 de out. de 2026',
    'Histórico de preços da GeForce RTX 5080 em Brasil: mínimo atual R$10,800, mínimo em 12 meses R$8,000, mediana em 12 meses R$11,000.',
    'Mediana de 3 meses R$10,900', 'Mediana de 12 meses R$11,000', 'Lançamento', 'Jan 29, 2025',
  ].join('\n'),
};
const HIST_VERSAO = {
  url: 'https://www.hardwarebarato.com/produtos/placas-de-video/rtx-5080/gigabyte-rtx-5080-windforce',
  titulo: 'Gigabyte RTX 5080 Windforce: Preço Hoje e Histórico | Hardware Barato',
  data: null,
  textoCompleto: ['# Gigabyte RTX 5080 Windforce', '$ Menor preço à vista', 'R$ 16.000,00', 'Média dos últimos 30 dias: R$ 15.500,00.'].join('\n'),
};
const NOTICIA_ANTIGA = {
  url: 'https://www.noticias.exemplo/rtx-5080-preco',
  titulo: 'RTX 5080 tem preço revelado',
  data: '2024-12-15',
  textoCompleto: 'Rumor: a RTX 5080 deve chegar por R$ 10.499,99 no Brasil, segundo varejistas.',
};
const SERIE_COM_BF = {
  url: 'https://www.tecmundo.com.br/rtx-5080-historico',
  titulo: 'Quanto custou a RTX 5080 em 2025',
  data: '2025-12-02',
  textoCompleto:
    'Em setembro de 2025 a RTX 5080 custava R$ 9.000,00. Em outubro de 2025 a RTX 5080 seguia em R$ 9.000,00. ' +
    'Na Black Friday, em novembro de 2025, a RTX 5080 saiu por R$ 8.100,00.',
};
const PEDIDO_BF = 'Analise o histórico de preço da rtx 5080 desde o lançamento até hoje e crie uma estimativa do valor que ela pode chegar na black friday de 2026';

/** /api/show + /api/chat falsos: capacidades por nome de modelo; registra o modelo de cada chat. */
function subirOllamaComCapacidades(capacidadesPorModelo) {
  return new Promise((resolve) => {
    const chats = [];
    const shows = [];
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        const pedido = JSON.parse(corpo || '{}');
        res.setHeader('Content-Type', 'application/json');
        if (/\/api\/show/.test(req.url)) {
          shows.push(pedido.model);
          return res.end(JSON.stringify({ capabilities: capacidadesPorModelo[pedido.model] || ['completion'] }));
        }
        chats.push(pedido.model);
        return res.end(JSON.stringify({ message: { content: 'ok' }, prompt_eval_count: 5, eval_count: 1 }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, chats, shows, host: `http://127.0.0.1:${servidor.address().port}` }));
  });
}

const JANELA_FALSA = 3000;

/**
 * Ollama falso que imita o llama-server do 0.40.1: estimativa do prompt
 * acima de `janela` → 400 com a mensagem real; senão responde (JSON ou
 * NDJSON, conforme `stream`).
 */
function subirOllamaComJanela(janela = JANELA_FALSA, { erro = null } = {}) {
  return new Promise((resolve) => {
    const recebidos = [];
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        const pedido = JSON.parse(corpo || '{}');
        recebidos.push(pedido);
        const texto = (pedido.messages || []).map((m) => m.content).join('\n');
        const tokens = ollama.estimarTokens(texto);
        if (erro) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: erro }));
          return;
        }
        if (tokens > janela) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: `request (${tokens} tokens) exceeds the available context size (${janela} tokens), try increasing it` }));
          return;
        }
        if (pedido.stream) {
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.write(`${JSON.stringify({ message: { content: 'ok ' } })}\n`);
          res.end(`${JSON.stringify({ message: { content: 'fim' }, done: true, prompt_eval_count: tokens, eval_count: 2 })}\n`);
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: { content: '- [1] RTX 5080 por R$ 10.319,14' }, prompt_eval_count: tokens, eval_count: 9 }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, recebidos, host: `http://127.0.0.1:${servidor.address().port}` }));
  });
}

const PAGINA_DE_PRECOS = Array.from({ length: 400 }, (_, i) => `| Placa RTX 5080 versão ${i} | R$ ${(10000 + i * 7).toLocaleString('pt-BR')},99 | loja ${i % 9} |`).join('\n');

module.exports = [
  {
    nome: 'v5 · contexto: erro do llama-server vira codigo "contexto" com as duas contagens; outro 400 não',
    tipo: 'unidade',
    executar() {
      const e = ollama.erroDoOllama(400, '{"error":"request (9950 tokens) exceeds the available context size (9216 tokens), try increasing it"}');
      const outro = ollama.erroDoOllama(400, '{"error":"invalid format: expected json schema"}');
      return [
        e.codigo === 'contexto' || 'não reconheceu o erro de contexto',
        (e.tokensPedido === 9950 && e.tokensDisponiveis === 9216) || `contagens: ${e.tokensPedido}/${e.tokensDisponiveis}`,
        /^Ollama 400:/.test(e.message) || 'mensagem mudou de formato (quem lê o erro espera "Ollama 400:")',
        outro.codigo === undefined || 'erro de formato marcado como contexto',
      ];
    },
  },

  {
    nome: 'v5 · contexto: estimativa conta dígito como token (página de preço é densa), texto corrido fica perto de 3–4 caracteres/token',
    tipo: 'unidade',
    executar() {
      const preco = 'R$ 10.319,14';
      const corrido = 'A placa de vídeo é muito boa para jogar em resolução alta com qualidade máxima nos jogos atuais.';
      const r = corrido.length / ollama.estimarTokens(corrido);
      return [
        ollama.estimarTokens(preco) >= 9 || `preço estimado em ${ollama.estimarTokens(preco)} tokens (esperado ≥ 9)`,
        (r > 2.6 && r < 4) || `texto corrido: ${r.toFixed(2)} caracteres/token`,
        ollama.estimarTokens('') === 0 || 'texto vazio',
      ];
    },
  },

  {
    nome: 'v5 · contexto: reduzirParaCaber corta o MEIO da maior mensagem, mantém começo e fim, e devolve null se não der',
    tipo: 'unidade',
    executar() {
      const grande = `INICIO-DO-PEDIDO ${'x'.repeat(20000)} INSTRUCOES-DO-FIM`;
      const msgs = [{ role: 'system', content: 'regras curtas' }, { role: 'user', content: grande }];
      const r = ollama.reduzirParaCaber(msgs, { tokensPedido: 10000, alvo: 5000 });
      const u = r && r.messages[1].content;
      const impossivel = ollama.reduzirParaCaber([{ role: 'user', content: 'curto demais' }], { tokensPedido: 9000, alvo: 100 });
      return [
        Boolean(r) || 'não reduziu',
        r && r.messages[0].content === 'regras curtas' || 'mexeu na mensagem pequena',
        u && u.startsWith('INICIO-DO-PEDIDO') && u.endsWith('INSTRUCOES-DO-FIM') || 'perdeu o começo ou o fim',
        u && u.includes('cortado pelo AuGPT') || 'sem marca do corte',
        u && u.length <= grande.length * 0.55 || `cortou pouco: ${u && u.length} de ${grande.length}`,
        impossivel === null || 'devia desistir quando não há o que cortar',
        msgs[1].content === grande || 'alterou o array original',
      ];
    },
  },

  {
    nome: 'v5 · contexto: chat recusado por contexto reenvia UMA vez reduzido e informa contextoReduzido',
    tipo: 'unidade',
    async executar() {
      const { servidor, recebidos, host } = await subirOllamaComJanela();
      try {
        const conteudo = `PEDIDO: histórico de preço\n${PAGINA_DE_PRECOS}\nREGRAS: um fato por linha.`;
        const r = await ollama.chat({ host, model: 'falso', messages: [{ role: 'user', content: conteudo }], numCtx: JANELA_FALSA, numPredict: 400 });
        const segundo = recebidos[1]?.messages?.[0]?.content || '';
        return [
          recebidos.length === 2 || `esperava 2 envios, foram ${recebidos.length}`,
          Boolean(r.contextoReduzido) || 'não informou a redução',
          r.contextoReduzido?.tokensDisponiveis === JANELA_FALSA || 'janela do erro não chegou',
          ollama.estimarTokens(segundo) <= JANELA_FALSA || 'o reenvio ainda não cabia',
          segundo.startsWith('PEDIDO:') && segundo.endsWith('um fato por linha.') || 'reenvio perdeu começo/fim',
          /RTX 5080/.test(r.content) || 'resposta não voltou',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'v5 · contexto: prompt que cabe vai uma vez só; erro que não é de contexto não é reenviado',
    tipo: 'unidade',
    async executar() {
      const ok = await subirOllamaComJanela();
      const ruim = await subirOllamaComJanela(JANELA_FALSA, { erro: 'model requires more system memory' });
      try {
        const r = await ollama.chat({ host: ok.host, model: 'falso', messages: [{ role: 'user', content: 'pergunta curta' }] });
        let falhou = null;
        try {
          await ollama.chat({ host: ruim.host, model: 'falso', messages: [{ role: 'user', content: PAGINA_DE_PRECOS }] });
        } catch (err) {
          falhou = err;
        }
        return [
          ok.recebidos.length === 1 && r.contextoReduzido === null || 'prompt pequeno não devia ser reenviado',
          Boolean(falhou) && ruim.recebidos.length === 1 || `erro comum reenviado (${ruim.recebidos.length} envios)`,
        ];
      } finally {
        ok.servidor.close();
        ruim.servidor.close();
      }
    },
  },

  {
    nome: 'v5 · contexto: chatStream (redação) também reduz e reenvia',
    tipo: 'unidade',
    async executar() {
      const { servidor, recebidos, host } = await subirOllamaComJanela();
      try {
        const tokens = [];
        const r = await ollama.chatStream({
          host, model: 'falso', numCtx: JANELA_FALSA, numPredict: 600,
          messages: [{ role: 'system', content: 'redator' }, { role: 'user', content: `MATERIAL\n${PAGINA_DE_PRECOS}\nESCREVA A RESPOSTA` }],
          onToken: (t) => tokens.push(t),
        });
        return [
          recebidos.length === 2 || `envios: ${recebidos.length}`,
          r.content === 'ok fim' || `conteúdo: ${r.content}`,
          Boolean(r.contextoReduzido) || 'sem contextoReduzido',
          tokens.join('') === 'ok fim' || 'tokens duplicados ou perdidos no reenvio',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'v5 · contexto: destilador mede a densidade do material e manda só o que cabe (página de preço numa janela pequena)',
    tipo: 'unidade',
    async executar() {
      const { servidor, recebidos, host } = await subirOllamaComJanela(4096);
      try {
        const avisos = [];
        const cabe = destilador.maximoQueCabe({ numCtx: 4096, objetivo: 'histórico de preço da RTX 5080', texto: PAGINA_DE_PRECOS });
        const corrido = 'Texto corrido sobre placas de vídeo e jogos, sem número nenhum aqui. '.repeat(400);
        const cabeCorrido = destilador.maximoQueCabe({ numCtx: 9216, objetivo: 'x', texto: corrido });
        const r = await destilador.destilar({
          config: { host, destilarFatos: true, numCtx: 4096, destilarAcimaDe: 1500 },
          objetivo: 'histórico de preço da RTX 5080', foco: 'preços da RTX 5080', origem: 'pesquisar_e_ler(hardwarebarato.com)',
          texto: PAGINA_DE_PRECOS, modelo: 'falso', aviso: (a) => avisos.push(a),
        });
        return [
          cabe < destilador.MAXIMO_ENVIADO && cabe >= 2000 || `máximo para página densa: ${cabe}`,
          cabeCorrido === destilador.MAXIMO_ENVIADO || `texto corrido devia usar o teto inteiro: ${cabeCorrido}`,
          recebidos.length === 1 || `a destilação precisou de reenvio (${recebidos.length}) — a conferência prévia falhou`,
          r.destilado === true || 'destilação não aconteceu',
          avisos.some((a) => /material denso/.test(a)) || `sem aviso do corte: ${avisos.join(' | ')}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'v5 · modelos: decisão (tev1/Nimble, pela capacidade ou pelo nome) sai da lista; quem pensa (R1) vem marcado; embedding continua fora',
    tipo: 'unidade',
    executar() {
      const lista = [
        { name: 'qwen2.5:7b', capacidades: ['completion', 'tools'] },
        { name: 'tev1:latest', capacidades: ['decision', 'tools', 'thinking', 'completion'] },
        { name: 'tev1:0.8b' }, // sem capacidades (Ollama antigo): pelo nome
        { name: 'bespoke/nimble:9b', capacidades: [] },
        { name: 'deepseek-r1:8b', capacidades: ['completion', 'thinking'] },
        { name: 'llama3.2:3b', capacidades: ['completion', 'tools'] },
        { name: 'nomic-embed-text:latest', family: 'nomic-bert' },
        { name: 'tevye-chat:7b' }, // nome parecido não é decisão
      ];
      const { conversa, embedding, decisao } = primeiroUso.separarModelos(lista);
      const nomes = (l) => l.map((m) => m.name).join(',');
      return [
        nomes(decisao) === 'tev1:latest,tev1:0.8b,bespoke/nimble:9b' || `decisão: ${nomes(decisao)}`,
        nomes(conversa) === 'qwen2.5:7b,deepseek-r1:8b,llama3.2:3b,tevye-chat:7b' || `conversa: ${nomes(conversa)}`,
        conversa.find((m) => m.name === 'deepseek-r1:8b')?.pensa === true || 'R1 sem a marca "pensa"',
        !conversa.find((m) => m.name === 'qwen2.5:7b')?.pensa || 'Qwen marcado como "pensa"',
        primeiroUso.ehModeloQuePensa('qwq:32b') && !primeiroUso.ehModeloQuePensa('qwen2.5:7b') || 'regra por nome de quem pensa',
        nomes(embedding) === 'nomic-embed-text:latest' || `embedding: ${nomes(embedding)}`,
        /modelo de decisão/.test(primeiroUso.mensagemAmigavel('Ollama 500: Jinja Exception: System message must be at the beginning.') || '') ||
          'erro do Jinja sem explicação amigável',
      ];
    },
  },

  {
    nome: 'v5 · modelos: tev1 como principal para a execução antes de começar (sem ficar "rodando"); tev1 como copiloto é ignorado e a crítica usa o principal',
    tipo: 'unidade',
    async executar() {
      const { Agent } = require('../../src/agent/loop');
      const os = require('os');
      const { servidor, chats, host } = await subirOllamaComCapacidades({
        'tev1:latest': ['decision', 'completion'],
        'deepseek-r1:8b': ['completion', 'thinking'],
      });
      try {
        const base = { host, workspace: os.tmpdir(), numCtx: 4096 };
        const comTev = new Agent({ config: { ...base, model: 'tev1:latest' }, userDataPath: os.tmpdir() });
        let erro = null;
        try {
          await comTev.run('qual o melhor fone?');
        } catch (e) {
          erro = e;
        }

        const agente = new Agent({ config: { ...base, model: 'qwen2.5:7b', copiloto2Modo: 'doisModelos', modelCopiloto2: 'tev1:0.8b' }, userDataPath: os.tmpdir() });
        agente.controller = new AbortController();
        const avisos = await agente.conferirModelos();
        const consulta = [];
        agente.on('copiloto-consulta', (e) => consulta.push(e));
        await agente._perguntarAoCritico({ objetivo: 'x', checklist: [], jaFeito: [], dossie: [], motivo: 'teste' });

        const comR1 = new Agent({ config: { ...base, model: 'deepseek-r1:8b' }, userDataPath: os.tmpdir() });
        const avisosR1 = await comR1.conferirModelos();
        const llama = new Agent({ config: { ...base, model: 'qwen2.5:7b', copiloto2Modo: 'doisModelos', modelCopiloto2: 'llama3.2:3b' }, userDataPath: os.tmpdir() });
        const avisosLlama = await llama.conferirModelos();
        return [
          erro && /modelo de decisão/.test(erro.message) || `tev1 como principal não foi barrado: ${erro?.message}`,
          comTev.rodando === false || 'ficou marcado como rodando depois do erro',
          avisos.some((a) => /copiloto "tev1:0\.8b" ignorado/.test(a)) || `sem aviso do copiloto: ${avisos.join(' | ')}`,
          consulta[0]?.modelo === 'qwen2.5:7b' && consulta[0]?.dedicado === false || `crítica foi para ${consulta[0]?.modelo}`,
          chats[chats.length - 1] === 'qwen2.5:7b' || `último chat foi para ${chats[chats.length - 1]}`,
          avisosR1.some((a) => /pensa antes de responder/.test(a)) || 'R1 como principal sem aviso',
          avisosLlama.length === 0 && llama.copilotoDescartado === null || `llama3.2 como copiloto gerou aviso: ${avisosLlama.join(' | ')}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'v5 · histórico: estatísticas dos sites (atual, mínimo/mediana de 12 meses, média de 30 dias) saem por código; parcelado e "a partir de" ficam fora; versão é marcada',
    tipo: 'unidade',
    executar() {
      const produtos = serie.produtosDoPedido(PEDIDO_BF);
      const linha = serie.estatisticasDaPagina(HIST_LINHA, produtos, { hoje: '2026-10-08' });
      const agr = serie.estatisticasDaPagina(HIST_AGREGADOR, produtos, { hoje: '2026-10-08' });
      const versao = serie.estatisticasDaPagina(HIST_VERSAO, produtos, { hoje: '2026-10-08' });
      const tem = (lista, tipo, valor, periodo = null) => lista.some((e) => e.tipo === tipo && e.valor === valor && (periodo === null || e.periodoDias === periodo));
      return [
        tem(linha, 'atual', 10000) || `atual da linha: ${JSON.stringify(linha)}`,
        tem(linha, 'media', 10400, 30) || 'média de 30 dias',
        tem(linha, 'minimo', 1850, 90) || 'mínimo de 90 dias (o descarte vem depois)',
        !linha.some((e) => e.valor === 11900 || e.valor === 13299.96) || 'parcelado/"a partir de" virou estatística',
        tem(agr, 'atual', 10800) && tem(agr, 'minimo', 8000, 360) && tem(agr, 'mediana', 11000, 360) && tem(agr, 'mediana', 10900, 90) ||
          `agregador: ${JSON.stringify(agr.map((e) => [e.tipo, e.periodoDias, e.valor]))}`,
        agr.every((e) => e.mes === '2026-10') || 'data de "atualizado em" não usada',
        versao.length && versao.every((e) => /Gigabyte RTX 5080 Windforce/.test(e.variante || '')) || 'página de versão não marcada',
        serie.lancamentoDaPagina(HIST_AGREGADOR.textoCompleto) === '2025-01' && serie.lancamentoDaPagina(HIST_LINHA.textoCompleto) === '2025-02' || 'lançamento',
      ];
    },
  },

  {
    nome: 'v5 · histórico: valor absurdo (R$ 1.850 numa placa de R$ 10 mil) é descartado; preço de antes do lançamento sai da série; loja vale como preço de hoje; estatística não vira ponto do mês',
    tipo: 'unidade',
    executar() {
      const r = serie.montarSerie({ objetivo: PEDIDO_BF, fontes: [HIST_LINHA, HIST_AGREGADOR, HIST_VERSAO, NOTICIA_ANTIGA], hoje: '2026-10-08' });
      const a = r?.analise;
      const x = a?.resumo.find((y) => y.produto === 'RTX 5080');
      return [
        r?.descartados >= 1 && /DESCARTADOS[\s\S]*R\$ 1\.850,00/.test(r.bloco) || `descarte: ${r?.descartados}`,
        !(a?.meses || []).includes('2024-12') || 'preço de antes do lançamento entrou na série',
        /LANÇAMENTO de RTX 5080: jan\/2025/.test(r?.bloco || '') || 'lançamento fora do bloco',
        x && x.porMes['2026-10'] === 10000 || `out/2026 devia ser o menor preço de hoje (10.000): ${JSON.stringify(x?.porMes)}`,
        !a?.usadas.some((o) => o.preco === 8000 || o.preco === 11000) || 'estatística de 12 meses virou preço do mês',
        !a?.usadas.some((o) => o.preco === 14000) || 'vitrine: devia ficar só o menor preço da página',
        !/versão Gigabyte/.test(r?.bloco || '') || 'estatística de versão aparece mesmo havendo da linha',
        /ESTATÍSTICAS DOS SITES DE HISTÓRICO[\s\S]*mínimo de 12 meses: R\$ 8\.000,00 · gpuprix\.com/.test(r?.bloco || '') || 'estatísticas no bloco',
      ];
    },
  },

  {
    nome: 'v5 · histórico: estimativa da Black Friday pelo código — com Black Friday anterior usa a queda observada; sem ela, faixa limitada pelo mínimo de 12 meses; sem base, diz que não há',
    tipo: 'unidade',
    executar() {
      const semBF = serie.montarSerie({ objetivo: PEDIDO_BF, fontes: [HIST_LINHA, HIST_AGREGADOR], hoje: '2026-10-08' });
      const e1 = semBF?.estimativa?.resultados[0];
      const comBF = serie.montarSerie({ objetivo: PEDIDO_BF, fontes: [HIST_LINHA, HIST_AGREGADOR, SERIE_COM_BF], hoje: '2026-10-08' });
      const e2 = comBF?.estimativa?.resultados[0];
      const semBase = serie.montarSerie({ objetivo: PEDIDO_BF, fontes: [HIST_VERSAO], hoje: '2026-10-08' });
      const e3 = semBase?.estimativa?.resultados[0];
      return [
        // referência 10.000 (menor atual); queda 12m = (11.000−8.000)/11.000 = 27% → limitada a 15% → piso 8.500
        e1?.faixa?.[0] === 8500 && e1?.faixa?.[1] === 10000 || `sem BF: ${JSON.stringify(e1)}`,
        /HIPÓTESE/.test(e1?.metodo || '') || 'sem BF o método tem que se dizer hipótese',
        // nov/2025 = 8.100 contra set–out = 9.000 → −10% → centro 9.000
        e2?.centro === 9000 && e2?.faixa?.[0] === 8730 && e2?.faixa?.[1] === 9270 || `com BF: ${JSON.stringify(e2)}`,
        /Black Friday de 2025/.test(e2?.metodo || '') || 'método não cita a Black Friday anterior',
        e3 && e3.faixa === null || `só página de versão: ${JSON.stringify(e3)}`,
        /não aplique desconto "típico"/.test(semBF?.bloco || '') || 'instrução contra desconto de cabeça',
        serie.ehPedidoDeEstimativa('quanto a RTX 5080 vai custar na black friday?') && !serie.ehPedidoDeEstimativa('qual a melhor RTX para 1440p?') || 'detecção do pedido',
      ];
    },
  },

  {
    nome: 'v5 · histórico (ponta a ponta): sem página de histórico o agente recebe a dica de buscar uma; com ela, o redator recebe estatísticas e a estimativa calculadas',
    tipo: 'unidade',
    async executar() {
      const html = (titulo, linhas) =>
        `<html><head><title>${titulo}</title></head><body><article><h1>${titulo}</h1>${linhas.map((l) => `<p>${l}</p>`).join('')}<p>Texto adicional de contexto para o extrator aceitar o bloco como conteúdo de verdade nesta página.</p></article></body></html>`;
      const srv = await buscaFalsa([
        { contem: 'historico de preco', paginas: [html('RTX 5080 Preço em Brasil — Histórico', [
          'Atualizado pela última vez em 7 de out. de 2026',
          'Histórico de preços da RTX 5080 em Brasil: mínimo atual R$10,800, mínimo em 12 meses R$8,000, mediana em 12 meses R$11,000.',
        ])] },
        { contem: 'rtx 5080', paginas: [html('Notícia sobre a RTX 5080', ['A RTX 5080 chegou às lojas brasileiras e tem desempenho excelente em 4K, segundo os testes de várias publicações.'])] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'v5 histórico ponta a ponta',
          pedido: PEDIDO_BF,
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: false, criticaPeriodica: false },
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'rtx 5080 preço' } },
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'rtx 5080 historico de preco' } },
            { ferramenta: 'responder', argumentos: { foco: 'histórico e estimativa' } },
          ],
          redacao: 'Hoje a RTX 5080 sai por R$ 10.800,00; a estimativa para a Black Friday vai de R$ 9.180,00 a R$ 10.800,00.',
        });
        return [
          /HISTÓRICO DE PREÇO: ainda não foi lida nenhuma página de histórico de RTX 5080/.test(obtido.promptDecisao) || 'a dica não apareceu para o modelo de decisão',
          /ESTATÍSTICAS DOS SITES DE HISTÓRICO/.test(obtido.promptRedacao) || 'estatísticas não chegaram ao redator',
          /ESTIMATIVA PARA A BLACK FRIDAY CALCULADA PELO CÓDIGO[\s\S]*R\$ 9\.180,00 a R\$ 10\.800,00/.test(obtido.promptRedacao) ||
            `estimativa no redator: ${(obtido.promptRedacao.match(/ESTIMATIVA[^\n]*\n[^\n]*/) || [''])[0]}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  // ---- achados da revisão independente (09/10/2026) ----
  {
    nome: 'v5 rev · página com dois modelos: cada preço vai para o modelo citado antes dele; outro modelo (5070 Ti, 5080 Super) fica fora',
    tipo: 'unidade',
    executar() {
      const produtos = serie.produtosDoPedido(PEDIDO_BF);
      const pag = {
        url: 'https://www.tecmundo.com.br/comparativo-rtx-5070-ti-vs-rtx-5080',
        titulo: 'RTX 5070 Ti vs RTX 5080: qual comprar?',
        textoCompleto: ['RTX 5070 Ti', 'Menor preço atual R$ 5.999,00', 'Mínimo em 12 meses R$ 5.400,00', 'RTX 5080', 'Menor preço atual R$ 8.999,00',
          'Mínimo em 12 meses R$ 7.900,00', 'A RTX 5080 Super deve chegar: menor preço atual R$ 14.000,00'].join('\n'),
      };
      const e = serie.estatisticasDaPagina(pag, produtos, { hoje: '2026-10-08' });
      const frase = { url: 'https://blog.exemplo/precos', data: '2026-08-10', titulo: 'Preços em agosto', textoCompleto: 'Em agosto de 2026 a RTX 5070 Ti custava R$ 5.999,00 e a RTX 5080 custava R$ 8.999,00.' };
      const obs = serie.extrairObservacoes([frase], produtos, { hoje: '2026-10-08' }).observacoes;
      const marcas = { ...pag, titulo: 'RTX 5080 vs RX 9070 XT', textoCompleto: pag.textoCompleto.replace('RTX 5070 Ti', 'RX 9070 XT') };
      const eMarcas = serie.estatisticasDaPagina(marcas, produtos, { hoje: '2026-10-08' });
      const obsMarcas = serie.extrairObservacoes([{ ...frase, textoCompleto: 'Em agosto de 2026 a RTX 5080 custava R$ 9.999,00 e a RX 9070 XT custava R$ 4.299,00.' }], produtos, { hoje: '2026-10-08' }).observacoes;
      return [
        eMarcas.every((x) => x.valor !== 5999 && x.valor !== 5400) || `outra marca (RX) entrou: ${JSON.stringify(eMarcas.map((x) => x.valor))}`,
        obsMarcas.length === 1 && obsMarcas[0].preco === 9999 || `frase com RX: ${JSON.stringify(obsMarcas.map((o) => o.preco))}`,
        e.length === 2 && e.every((x) => x.produto === 'RTX 5080' && [8999, 7900].includes(x.valor)) || `estatísticas: ${JSON.stringify(e.map((x) => [x.tipo, x.valor]))}`,
        obs.length === 1 && obs[0].preco === 8999 || `observações: ${JSON.stringify(obs.map((o) => o.preco))}`,
      ];
    },
  },

  {
    nome: 'v5 rev · "released" de driver/firmware não é lançamento; "lançamento" que apagaria a série inteira é ignorado',
    tipo: 'unidade',
    executar() {
      const datadas = ['Em fevereiro de 2025 a RTX 5080 custava R$ 12.999,00.', 'Em junho de 2025 a RTX 5080 custava R$ 9.999,00.', 'Em agosto de 2026 a RTX 5080 custava R$ 8.999,00.']
        .map((t, i) => ({ url: `https://blog${i}.exemplo/a`, data: null, titulo: 'Preço da RTX 5080', textoCompleto: t }));
      const driver = { url: 'https://noticias.exemplo/driver', titulo: 'GeForce RTX 5080: novo driver', textoCompleto: 'A NVIDIA released driver 581.15 on Sep 9, 2026 com melhorias para a RTX 5080.' };
      const rumor = { url: 'https://noticias.exemplo/rumor', titulo: 'RTX 5080 rumor', textoCompleto: 'Lançamento: setembro de 2026, segundo um rumor sobre a RTX 5080.' };
      const r1 = serie.montarSerie({ objetivo: PEDIDO_BF, fontes: [...datadas, driver], hoje: '2026-10-08' });
      const r2 = serie.montarSerie({ objetivo: PEDIDO_BF, fontes: [...datadas, rumor], hoje: '2026-10-08' });
      return [
        serie.lancamentoDaPagina(driver.textoCompleto) === null || 'released de driver virou lançamento',
        serie.lancamentoDaPagina('Release Date Jan 30th, 2025') === '2025-01' && serie.lancamentoDaPagina('Lançamento\nfev. de 2025') === '2025-02' || 'rótulo de lançamento real',
        r1?.observacoes === 3 || `com a página do driver: ${r1?.observacoes} observações`,
        r2?.observacoes === 3 || `lançamento que apagaria a série: ${r2?.observacoes} observações`,
      ];
    },
  },

  {
    nome: 'v5 rev · queda real ao longo dos anos fica na série (faixa de plausibilidade só no mesmo mês); estatística absurda continua descartada',
    tipo: 'unidade',
    executar() {
      const pontos = [['maio de 2021', '12.999,90'], ['junho de 2021', '12.499,90'], ['agosto de 2021', '11.499,90'], ['setembro de 2021', '11.999,90'], ['dezembro de 2021', '9.499,90'],
        ['março de 2022', '7.499,90'], ['julho de 2022', '5.299,90'], ['outubro de 2022', '4.799,90'], ['fevereiro de 2023', '4.299,90'], ['janeiro de 2024', '3.999,90']];
      const fontes = pontos.map(([m, v], i) => ({ url: `https://blog${i}.exemplo/rtx-3080`, titulo: 'RTX 3080', data: null, textoCompleto: `Em ${m} a RTX 3080 custava R$ ${v}.` }));
      const r = serie.montarSerie({ objetivo: 'Histórico de preço da RTX 3080 desde o lançamento', fontes, hoje: '2026-10-08' });
      const mesmoMes = [1, 2, 3].map((i) => ({ url: `https://loja${i}.exemplo/rtx-3080`, titulo: 'RTX 3080', data: null, textoCompleto: `Em março de 2022 a RTX 3080 custava R$ ${['7.499,90', '7.299,90', '749,90'][i - 1]}.` }));
      const r2 = serie.montarSerie({ objetivo: 'Histórico de preço da RTX 3080 desde o lançamento', fontes: [...fontes, ...mesmoMes], hoje: '2026-10-08' });
      return [
        r?.observacoes === 10 && r.descartados === 0 || `série com queda real: ${r?.observacoes} obs, ${r?.descartados} descartados`,
        r2?.descartados === 1 && /DESCARTADOS[\s\S]*R\$ 749,90/.test(r2.bloco) || `valor absurdo no mesmo mês: ${r2?.descartados}`,
      ];
    },
  },

  {
    nome: 'v5 rev · reenvio por contexto corta o material, não a mensagem system',
    tipo: 'unidade',
    executar() {
      const system = `REGRAS ${'catálogo de ferramentas e regras da decisão. '.repeat(330)}FIM-DAS-REGRAS`;
      const pagina = (n) => `PÁGINA ${n} ${'RTX 5080 R$ 10.319,14 · '.repeat(230)}`;
      const msgs = [{ role: 'system', content: system }, { role: 'user', content: pagina(1) }, { role: 'user', content: pagina(2) }, { role: 'user', content: 'qual o histórico?' }];
      const tokens = ollama.estimarTokens(msgs.map((m) => m.content).join('\n'));
      const r = ollama.reduzirParaCaber(msgs, { tokensPedido: tokens, alvo: Math.floor(tokens * 0.85) });
      return [
        r && r.messages[0].content === system || 'a mensagem system foi cortada',
        r && r.messages[3].content === 'qual o histórico?' || 'a pergunta mudou',
        r && r.messages[1].content.length < msgs[1].content.length || 'o material não foi cortado',
      ];
    },
  },

  {
    nome: 'v5 rev · enquanto confere os modelos a execução já conta como em andamento, e parar() nessa hora encerra sem chamar o modelo',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const { Agent } = require('../../src/agent/loop');
      let chats = 0;
      const servidor = http.createServer((req, res) => {
        let corpo = '';
        req.on('data', (d) => {
          corpo += d;
        });
        req.on('end', () => {
          if (/\/api\/show/.test(req.url)) {
            setTimeout(() => res.end(JSON.stringify({ capabilities: ['completion'] })), 300);
            return;
          }
          chats += 1;
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'falso' }));
        });
      });
      await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
      const host = `http://127.0.0.1:${servidor.address().port}`;
      try {
        const a = new Agent({ config: { host, workspace: os.tmpdir(), model: 'qwen2.5:7b', numCtx: 4096 }, userDataPath: os.tmpdir() });
        const primeiro = a.run('primeiro pedido');
        await new Promise((r) => setTimeout(r, 50));
        let erroDoSegundo = null;
        try {
          await a.run('segundo pedido');
        } catch (e) {
          erroDoSegundo = e.message;
        }
        a.parar();
        const r1 = await primeiro;
        return [
          /em andamento/.test(erroDoSegundo || '') || `segundo início: ${erroDoSegundo}`,
          r1?.motivo === 'interrompido' || `primeiro: ${JSON.stringify(r1)}`,
          chats === 0 || `${chats} chamada(s) ao modelo depois do parar()`,
          a.rodando === false || 'continuou marcado como rodando',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'v5 rev · Black Friday: novembro corrente não é BF observada; alta não é queda; referência abaixo do mínimo de 12 meses não inverte a faixa',
    tipo: 'unidade',
    executar() {
      const P = 'Quanto a RTX 5080 vai chegar na black friday? estimativa de preço';
      const est = [
        { produto: 'RTX 5080', tipo: 'atual', valor: 6999, moeda: 'BRL', mes: '2026-10', dominio: 'hardwarebarato.com' },
        { produto: 'RTX 5080', tipo: 'minimo', periodoDias: 360, valor: 7241, moeda: 'BRL', mes: '2026-10', dominio: 'gpuprix.com' },
        { produto: 'RTX 5080', tipo: 'mediana', periodoDias: 360, valor: 11500, moeda: 'BRL', mes: '2026-10', dominio: 'gpuprix.com' },
      ];
      const e1 = serie.estimar({ objetivo: P, analise: null, estatisticas: est, hoje: '2026-10-08' }).resultados[0];
      const analise = (porMes) => ({ moeda: 'BRL', resumo: [{ produto: 'RTX 5080', n: Object.keys(porMes).length, porMes, ate: Object.keys(porMes).sort().pop() }] });
      const e2 = serie.estimar({ objetivo: P, analise: analise({ '2026-09': 10000, '2026-10': 10000, '2026-11': 9500 }), estatisticas: [], hoje: '2026-11-10' }).resultados[0];
      const e3 = serie.estimar({ objetivo: P, analise: analise({ '2025-09': 9000, '2025-10': 9000, '2025-11': 9300, '2026-10': 10000 }), estatisticas: [], hoje: '2026-10-08' }).resultados[0];
      return [
        e1.faixa === null && /mínimo de 12 meses/.test(e1.motivo || '') || `referência abaixo do mínimo: ${JSON.stringify(e1.faixa)} ${e1.motivo || ''}`,
        !e2.quedaBF || `novembro corrente virou BF observada: ${JSON.stringify(e2.quedaBF)}`,
        !e3.centro || e3.centro <= 10000 || `alta de 3% virou "queda": centro ${e3.centro}`,
      ];
    },
  },

  {
    nome: 'v5 rev · "estimativa de entrega", "previsão de entrega", "tendência de consumo" não são pedido de estimativa de preço',
    tipo: 'unidade',
    executar() {
      const nao = [
        'Qual o preço da RTX 5070 na Kabum e a estimativa de tempo de entrega para Iconha-ES?',
        'Qual o valor do frete e a previsão de entrega do Galaxy S24?',
        'Compare custo-benefício da RTX 5070 e RX 9070 e a tendência de consumo de energia',
        'Qual o preço do iPhone 15 e a data prevista de lançamento do iPhone 17?',
      ];
      nao.push('Faça uma projeção de quanto o RTX 5080 consome por mês de energia em valor na conta de luz', 'qual a estimativa de fps da RTX 5080 em 4K e o preço dela?');
      const sim = ['Estimativa de quanto a RTX 5080 vai custar no fim do ano', 'A RTX 5080 vai baixar de preço até dezembro? faça uma estimativa',
        'Quanto a RTX 5080 vai custar em dezembro?', 'Estime o preço da RTX 5080 para dezembro', 'qual a previsão de preço da RTX 5090 para 2027?', 'o preço da RX 9070 XT deve cair até dezembro?', 'faça uma estimativa do valor da RTX 5080 em dezembro', PEDIDO_BF];
      return [
        ...nao.map((t) => !serie.ehPedidoDeHistoricoOuEstimativa(t) || `disparou: ${t}`),
        ...sim.map((t) => serie.ehPedidoDeEstimativa(t) || `não reconheceu: ${t}`),
      ];
    },
  },
];
