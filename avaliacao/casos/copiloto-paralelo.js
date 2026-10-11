'use strict';

/**
 * Casos de unidade pro plano "2 IAs em paralelo" (pedido do Davi 2026-09-18,
 * depois do sistema de backup/reversão): duas mudanças em src/agent/loop.js —
 *
 *   1. segundaOpiniao passou a rotear por _perguntarAoCritico, então no modo
 *      "2 IAs" (copiloto2Modo: 'doisModelos') ela usa o modelo DEDICADO (CPU,
 *      num_gpu:0) em vez de sempre o modelo principal — antes disto, mesmo
 *      com "2 IAs" configurado, a segunda opinião era "o modelo concordando
 *      consigo mesmo".
 *   2. pedirAprovacao (novo método, substitui a lógica que existia duplicada
 *      em dois pontos de loop.js) mostra o cartão de aprovação IMEDIATAMENTE,
 *      sem esperar a segunda opinião responder — ela chega depois, se der
 *      tempo, por um evento à parte ('aprovacao-critica'), só se o usuário
 *      ainda não tiver decidido.
 *
 * O "acompanha a aprovação" (critica chegando a tempo, com conteúdo certo)
 * já é coberto pelo caso de cenário existente em nivel1.js ("segunda opinião
 * acompanha a aprovação de apagar_arquivo") — o motor.js da bancada foi
 * ajustado pra dar 20ms de folga antes de auto-aprovar, tempo de sobra pro
 * servidor falso (HTTP local) responder primeiro. O que SÓ dá pra provar
 * instanciando o Agent direto (sem rodar run() inteiro) é: qual modelo
 * exatamente foi chamado (o cenário não expõe isso), e a ORDEM exata dos
 * eventos (cartão antes da rede completar; nenhum evento tardio quando a
 * decisão já saiu primeiro) — por isso os testes aqui.
 */

const http = require('http');
const { Agent } = require('../../src/agent/loop');
const { skills } = require('../motor');

/**
 * Servidor HTTP mínimo que grava cada corpo de requisição recebido e deixa o
 * chamador controlar quando (e o quê) responder — `handler` pode ser síncrono
 * (string) ou devolver uma Promise, pra simular uma segunda opinião "lenta"
 * de propósito nos testes que precisam disso.
 */
function servidorCaptura(handler) {
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => {
      corpo += d;
    });
    req.on('end', async () => {
      let pedido = {};
      try {
        pedido = JSON.parse(corpo || '{}');
      } catch {
        /* ignora */
      }
      chamadas.push(pedido);
      const resposta = await handler(pedido);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: { content: resposta }, prompt_eval_count: 10, eval_count: 5 }));
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolve({ porta: servidor.address().port, chamadas, fechar: () => new Promise((r) => servidor.close(r)) });
    });
  });
}

/** Agent pronto pra chamar segundaOpiniao/pedirAprovacao direto, sem passar por run(). */
function agenteDeTeste(config) {
  const agente = new Agent({
    config: {
      host: '',
      model: 'principal-falso',
      numCtx: 4096,
      numPredict: 200,
      manterModeloVivo: '0',
      ...config,
    },
    userDataPath: '/tmp',
    skills,
  });
  // this.controller normalmente só existe depois que run() começa — os dois
  // métodos testados aqui usam this.controller.signal.
  agente.controller = new AbortController();
  return agente;
}

module.exports = [
  {
    nome: 'copiloto-paralelo: segundaOpiniao usa o modelo PRINCIPAL quando "2 IAs" não está configurado (padrão de hoje)',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorCaptura(() => 'confirme o nome do arquivo antes de apagar');
      try {
        const agente = agenteDeTeste({ host: `http://127.0.0.1:${falso.porta}`, copiloto2Modo: 'mesmoModelo' });
        const critica = await agente.segundaOpiniao({ nome: 'apagar_arquivo', argumentos: { caminho: 'x.txt' } });
        const pedido = falso.chamadas[0];
        return [
          critica === 'confirme o nome do arquivo antes de apagar' || `esperava a crítica, veio "${critica}"`,
          pedido.model === 'principal-falso' || `esperava o modelo principal, veio "${pedido.model}"`,
          pedido.options.num_gpu === undefined || 'não deveria forçar num_gpu sem "2 IAs" configurado',
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'copiloto-paralelo: segundaOpiniao usa o modelo DEDICADO (CPU, num_gpu:0) quando "2 IAs" está configurado',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorCaptura(() => 'nenhum');
      try {
        const agente = agenteDeTeste({
          host: `http://127.0.0.1:${falso.porta}`,
          copiloto2Modo: 'doisModelos',
          modelCopiloto2: 'llama3.2:3b-critico',
        });
        await agente.segundaOpiniao({ nome: 'executar_comando', argumentos: { comando: 'ls' } });
        const pedido = falso.chamadas[0];
        return [
          pedido.model === 'llama3.2:3b-critico' || `esperava o modelo dedicado, veio "${pedido.model}"`,
          pedido.options.num_gpu === 0 || `esperava num_gpu:0 (CPU), veio ${JSON.stringify(pedido.options.num_gpu)}`,
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'copiloto-paralelo: "2 IAs" configurado mas SEM modelCopiloto2 escolhido continua caindo no modelo principal (não quebra)',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorCaptura(() => 'nenhum');
      try {
        const agente = agenteDeTeste({ host: `http://127.0.0.1:${falso.porta}`, copiloto2Modo: 'doisModelos' }); // sem modelCopiloto2
        await agente.segundaOpiniao({ nome: 'apagar_arquivo', argumentos: {} });
        const pedido = falso.chamadas[0];
        return [
          pedido.model === 'principal-falso' || `esperava cair no modelo principal, veio "${pedido.model}"`,
          pedido.options.num_gpu === undefined || 'não deveria forçar CPU sem um modelCopiloto2 de verdade',
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'copiloto-paralelo: pedirAprovacao mostra o cartão ANTES da segunda opinião responder, e anexa a crítica quando ela chega a tempo',
    tipo: 'unidade',
    async executar() {
      let liberarCritica;
      const travaCritica = new Promise((r) => {
        liberarCritica = r;
      });
      const falso = await servidorCaptura(async () => {
        await travaCritica; // só responde quando o teste mandar — simula uma segunda opinião lenta
        return 'confirme que é o arquivo certo antes de apagar';
      });
      try {
        const agente = agenteDeTeste({ host: `http://127.0.0.1:${falso.porta}` });
        let aprovacaoEmitida = null;
        let criticaEmitida = null;
        agente.on('aprovacao', (d) => {
          aprovacaoEmitida = d;
        });
        agente.on('aprovacao-critica', (d) => {
          criticaEmitida = d;
        });

        const promessaDecisao = agente.pedirAprovacao({
          nome: 'apagar_arquivo',
          argumentos: { caminho: 'x.txt' },
          ferramenta: { risk: 'alto', description: 'Apaga um arquivo.' },
        });

        // Ainda no MESMO tick síncrono — a requisição HTTP da segunda opinião
        // já foi disparada (travada em `travaCritica`), mas 'aprovacao' não
        // devia ter esperado nada disso pra sair.
        const falhas = [];
        if (!aprovacaoEmitida) falhas.push('"aprovacao" deveria ter disparado de imediato, antes de qualquer rede completar');
        else if (aprovacaoEmitida.critica !== null) falhas.push(`critica deveria vir null no cartão inicial, veio "${aprovacaoEmitida.critica}"`);
        if (criticaEmitida !== null) falhas.push('"aprovacao-critica" não deveria ter disparado ainda (a rede está travada de propósito)');
        if (falhas.length) return falhas;

        liberarCritica(); // agora sim, a segunda opinião pode responder
        await new Promise((r) => setTimeout(r, 50)); // tempo de sobra pro round-trip HTTP completar

        if (!criticaEmitida) falhas.push('esperava "aprovacao-critica" depois que a segunda opinião respondeu');
        else {
          if (criticaEmitida.id !== aprovacaoEmitida.id) falhas.push('"aprovacao-critica" veio com um id diferente do cartão original');
          if (criticaEmitida.critica !== 'confirme que é o arquivo certo antes de apagar') {
            falhas.push(`crítica anexada veio errada: "${criticaEmitida.critica}"`);
          }
        }

        agente.responder(aprovacaoEmitida.id, 'aprovar');
        const decisao = await promessaDecisao;
        if (decisao !== 'aprovar') falhas.push(`esperava a decisão "aprovar" de volta, veio "${decisao}"`);
        return falhas.length ? falhas : [true];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'copiloto-paralelo: se o usuário decide ANTES da segunda opinião responder, "aprovacao-critica" nunca dispara (chegaria tarde demais)',
    tipo: 'unidade',
    async executar() {
      let liberarCritica;
      const travaCritica = new Promise((r) => {
        liberarCritica = r;
      });
      const falso = await servidorCaptura(async () => {
        await travaCritica;
        return 'opinião tardia — não devia chegar a lugar nenhum';
      });
      try {
        const agente = agenteDeTeste({ host: `http://127.0.0.1:${falso.porta}` });
        let aprovacaoEmitida = null;
        let criticaEmitida = null;
        agente.on('aprovacao', (d) => {
          aprovacaoEmitida = d;
        });
        agente.on('aprovacao-critica', (d) => {
          criticaEmitida = d;
        });

        const promessaDecisao = agente.pedirAprovacao({
          nome: 'executar_comando',
          argumentos: { comando: 'ls' },
          ferramenta: { risk: 'alto', description: 'Executa um comando.' },
        });
        if (!aprovacaoEmitida) return ['"aprovacao" deveria ter disparado de imediato'];

        agente.responder(aprovacaoEmitida.id, 'aprovar'); // decide ANTES de a segunda opinião responder
        const decisao = await promessaDecisao;

        liberarCritica(); // só agora a segunda opinião (tarde demais) responde
        await new Promise((r) => setTimeout(r, 50));

        return [
          decisao === 'aprovar' || `esperava "aprovar", veio "${decisao}"`,
          criticaEmitida === null ||
            `"aprovacao-critica" não deveria ter disparado (decisão já tinha saído): ${JSON.stringify(criticaEmitida)}`,
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  /* -------- caso real (Davi, 2026-09-18): criticaDoPlano nunca usava o modelo dedicado -------- */

  {
    // Bug real encontrado montando o relatório de consultas do Copiloto: esta
    // era a ÚNICA das quatro chamadas ao crítico com seu próprio `ollama.chat`
    // direto — nunca passava por `_perguntarAoCritico`, então nunca usava o
    // modelo dedicado de "2 IAs", mesmo configurado. Como é a crítica que
    // mais dispara na prática (intervalo pode ser 1 passo), a maior parte das
    // "consultas ao crítico" de quem usa 2 IAs era, na prática, só o modelo
    // principal concordando consigo mesmo. Mesmo teste-espelho de
    // "segundaOpiniao usa o modelo DEDICADO" acima, agora pra criticaDoPlano.
    nome: 'copiloto-paralelo: criticaDoPlano (crítica periódica) usa o modelo DEDICADO quando "2 IAs" está configurado (bug corrigido 2026-09-18)',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorCaptura(() => 'nenhum');
      try {
        const agente = agenteDeTeste({
          host: `http://127.0.0.1:${falso.porta}`,
          copiloto2Modo: 'doisModelos',
          modelCopiloto2: 'llama3.2:3b-critico',
        });
        await agente.criticaDoPlano({ objetivo: 'testar', checklist: [], jaFeito: [], dossie: [] });
        const pedido = falso.chamadas[0];
        return [
          pedido.model === 'llama3.2:3b-critico' || `esperava o modelo dedicado, veio "${pedido.model}"`,
          pedido.options.num_gpu === 0 || `esperava num_gpu:0 (CPU), veio ${JSON.stringify(pedido.options.num_gpu)}`,
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'copiloto-paralelo: criticaDoPlano usa o modelo PRINCIPAL quando "2 IAs" não está configurado (comportamento de sempre, sem regressão)',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorCaptura(() => 'nenhum');
      try {
        const agente = agenteDeTeste({ host: `http://127.0.0.1:${falso.porta}`, copiloto2Modo: 'mesmoModelo' });
        await agente.criticaDoPlano({ objetivo: 'testar', checklist: [], jaFeito: [], dossie: [] });
        const pedido = falso.chamadas[0];
        return [
          pedido.model === 'principal-falso' || `esperava o modelo principal, veio "${pedido.model}"`,
          pedido.options.num_gpu === undefined || 'não deveria forçar num_gpu sem "2 IAs" configurado',
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  /* -------- caso real (Davi, 2026-09-18): relatório "com 100% de certeza" de quando as 2 IAs foram usadas -------- */

  {
    // Confirma o evento que src/registro.js grava e renderer/app.js mostra
    // no relatório — a garantia que Davi pediu de poder confirmar, depois do
    // fato, que o modelo dedicado (e não o principal) respondeu.
    nome: 'copiloto-paralelo: toda consulta ao crítico emite "copiloto-consulta" com o modelo REAL usado e a origem certa',
    tipo: 'unidade',
    async executar() {
      const falso = await servidorCaptura(() => 'nenhum');
      try {
        const agente = agenteDeTeste({
          host: `http://127.0.0.1:${falso.porta}`,
          copiloto2Modo: 'doisModelos',
          modelCopiloto2: 'llama3.2:3b-critico',
        });
        const consultas = [];
        agente.on('copiloto-consulta', (d) => consultas.push(d));

        await agente.criticaDoPlano({ objetivo: 'testar', checklist: [], jaFeito: [], dossie: [] });
        await agente.consultarCritico({ objetivo: 'testar', checklist: [], jaFeito: [], dossie: [] });
        await agente.segundaOpiniao({ nome: 'apagar_arquivo', argumentos: {} });

        const porOrigem = Object.fromEntries(consultas.map((c) => [c.origem, c]));
        return [
          consultas.length === 3 || `esperava 3 consultas emitidas, vieram ${consultas.length}`,
          porOrigem.periodica?.dedicado === true || 'criticaDoPlano deveria emitir origem "periodica" com dedicado:true',
          porOrigem['sob-demanda']?.dedicado === true || 'consultarCritico deveria emitir origem "sob-demanda" com dedicado:true',
          porOrigem.aprovacao?.dedicado === true || 'segundaOpiniao deveria emitir origem "aprovacao" com dedicado:true',
          consultas.every((c) => c.modelo === 'llama3.2:3b-critico') ||
            `todas deveriam usar o modelo dedicado, veio ${JSON.stringify(consultas.map((c) => c.modelo))}`,
          consultas.every((c) => c.ok === true) || 'todas deveriam vir com ok:true (o servidor falso não falha)',
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'copiloto-paralelo: "copiloto-consulta" vem com dedicado:false e ok:false quando a chamada falha, sem "2 IAs" configurado',
    tipo: 'unidade',
    async executar() {
      // porta que ninguém escuta — a chamada falha de verdade (ECONNREFUSED),
      // exercitando o ramo `catch` de _perguntarAoCritico.
      const agente = agenteDeTeste({ host: 'http://127.0.0.1:1', copiloto2Modo: 'mesmoModelo' });
      const consultas = [];
      agente.on('copiloto-consulta', (d) => consultas.push(d));
      await agente.consultarCritico({ objetivo: 'testar', checklist: [], jaFeito: [], dossie: [] });
      const c = consultas[0];
      return [
        consultas.length === 1 || `esperava 1 consulta emitida, vieram ${consultas.length}`,
        c?.dedicado === false || 'sem "2 IAs" configurado, dedicado deveria ser false',
        c?.ok === false || 'a chamada deveria ter falhado (porta sem servidor), ok deveria ser false',
      ];
    },
  },
];
