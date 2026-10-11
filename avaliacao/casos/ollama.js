'use strict';

const http = require('http');
const ollama = require('../../src/llm/ollama');

/**
 * Correção DeepSeek R1 8B (prova de 10 questões): modelos
 * "raciocinadores" podem emitir um bloco `<think>...</think>` antes da
 * resposta de verdade. Quando a instalação/template do Ollama não separa
 * isso em `message.thinking`, o bloco vaza cru dentro de `message.content` —
 * e quem lê `content` pra extrair JSON (protocolo de decisão) não sabe lidar
 * com isso. `ollama.js` ganhou duas defesas: (1) a chamada de decisão passa
 * `pensar: false` (vira `think: false` no corpo da requisição, ver
 * `src/agent/loop.js`), e (2) uma rede de segurança que tira qualquer bloco
 * `<think>` que ainda apareça em `content`, para qualquer chamador.
 *
 * Este arquivo sobe seu próprio servidor HTTP fake (não usa o `servidorFalso`
 * da bancada — aqui o que importa é o contrato HTTP baixo nível do cliente
 * Ollama em si, não o comportamento do Agent).
 */

function subirServidorCapturando(respostaFn) {
  return new Promise((resolve) => {
    const capturado = [];
    const caminhos = []; // req.url de cada chamada, na mesma ordem de `capturado`
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo || '{}');
        } catch {
          /* ignora corpo inválido */
        }
        capturado.push(pedido);
        caminhos.push(req.url);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(respostaFn(pedido)));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, capturado, caminhos }));
  });
}

/** Servidor fake que devolve NDJSON em vários pedaços — usado pra testar
 * ollama.pullModel, que consome exatamente esse formato (mesmo mecanismo de
 * leitura de chatStream, formato de linha diferente: {status,...}). */
function subirServidorNDJSON(linhas) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/x-ndjson');
      for (const linha of linhas) {
        res.write(`${JSON.stringify(linha)}\n`);
      }
      res.end();
    });
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor }));
  });
}

module.exports = [
  {
    nome: 'ollama.semBlocoDePensamento: tira um bloco <think>...</think> bem formado, mesmo com maiúsculas',
    tipo: 'unidade',
    executar() {
      const comBloco = '<think>\nvou considerar as opções...\ntalvez seja A\n</think>\nA resposta é 42.';
      const comBlocoMaiusculo = '<THINK>raciocinando</THINK>\nResposta final.';
      const semBloco = 'Resposta direta, sem nenhum bloco de pensamento.';
      return [
        ollama.semBlocoDePensamento(comBloco) === 'A resposta é 42.' ||
          `não tirou o bloco corretamente: ${JSON.stringify(ollama.semBlocoDePensamento(comBloco))}`,
        ollama.semBlocoDePensamento(comBlocoMaiusculo) === 'Resposta final.' ||
          'não casou a tag em maiúsculas (case-insensitive esperado)',
        ollama.semBlocoDePensamento(semBloco) === semBloco ||
          'mexeu em texto que não tinha bloco de pensamento nenhum',
      ];
    },
  },

  {
    nome: 'ollama.semBlocoDePensamento: bloco sem fechar (truncado por falta de tokens) não é mexido às cegas',
    tipo: 'unidade',
    executar() {
      // Sem "</think>", não dá pra saber com segurança onde a resposta de
      // verdade começaria — mais seguro não descartar nada do que apagar
      // conteúdo que podia ser a resposta inteira.
      const truncado = '<think>ainda pensando quando os tokens acabaram';
      return [
        ollama.semBlocoDePensamento(truncado) === truncado ||
          'mexeu em bloco de pensamento sem fechamento, sem ter como saber onde ele termina',
      ];
    },
  },

  {
    nome: 'ollama.chat: chamada de decisão (pensar: false) manda think:false pro Ollama; sem `pensar`, não manda o campo',
    tipo: 'unidade',
    async executar() {
      const { servidor, capturado } = await subirServidorCapturando(() => ({
        message: { content: '{"ok":true}' },
        prompt_eval_count: 10,
        eval_count: 5,
      }));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }], pensar: false });
        await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }] });

        return [
          capturado[0].think === false || `esperava think:false na 1ª chamada, veio ${JSON.stringify(capturado[0].think)}`,
          !('think' in capturado[1]) || 'chamada sem `pensar` não deveria incluir o campo think no corpo',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Copiloto nível 2, modo "doisModelos" (Agent.consultarCritico/
    // criticaDoPlano): `numGpu: 0` força o crítico dedicado a rodar na CPU,
    // pra não disputar VRAM com o modelo principal. Mesmo padrão do teste de
    // `pensar` acima — só entra no corpo quando definido explicitamente.
    nome: 'ollama.chat: numGpu vira options.num_gpu no corpo; sem `numGpu`, não manda o campo',
    tipo: 'unidade',
    async executar() {
      const { servidor, capturado } = await subirServidorCapturando(() => ({
        message: { content: '{"ok":true}' },
        prompt_eval_count: 10,
        eval_count: 5,
      }));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }], numGpu: 0 });
        await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }] });

        return [
          capturado[0].options?.num_gpu === 0 ||
            `esperava options.num_gpu:0 na 1ª chamada, veio ${JSON.stringify(capturado[0].options)}`,
          !('num_gpu' in (capturado[1].options || {})) ||
            'chamada sem `numGpu` não deveria incluir o campo num_gpu nas options',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Bug real batido pelo Davi (2026-09-20): "MaxListenersExceededWarning:
    // Possible EventTarget memory leak detected. 11 abort listeners added to
    // [AbortSignal]" no log do AuGPT. Causa: `Agent.controller.signal` (src/
    // agent/loop.js) vive pela execução INTEIRA — uma só instância, passada
    // pra CADA chamada de `ollama.chat`/`embed` que a execução faz (decisão,
    // redação via esquema, copiloto, embeddings de memória...). `request()`
    // registrava um listener de 'abort' nesse signal a cada chamada e só o
    // removia se o abort de fato disparasse (`{once:true}`) — numa execução
    // com várias chamadas de modelo, cada uma deixava um listener parado pra
    // sempre. Este teste simula exatamente isso: um signal compartilhado
    // (como `this.controller.signal`) usado em várias chamadas seguidas.
    nome: 'ollama.chat: várias chamadas com o MESMO signal (como this.controller.signal do Agent) não acumulam listeners de abort',
    tipo: 'unidade',
    async executar() {
      const { servidor } = await subirServidorCapturando(() => ({
        message: { content: '{"ok":true}' },
        prompt_eval_count: 1,
        eval_count: 1,
      }));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const controller = new AbortController();
        const TOTAL_CHAMADAS = 15; // mais que os 10 padrão do Node, pra bater o mesmo limiar do aviso real

        for (let i = 0; i < TOTAL_CHAMADAS; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- precisa ser sequencial: cada chamada tem que
          // terminar (e o listener dela ser removido) antes da próxima, senão o teste não prova nada
          await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }], signal: controller.signal });
        }

        const { getEventListeners } = require('events');
        const restantes = getEventListeners(controller.signal, 'abort').length;
        return [restantes === 0 || `${restantes} listener(s) de 'abort' ficaram parados no signal depois de ${TOTAL_CHAMADAS} chamadas concluídas (esperado: 0)`];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Caso real: instalação/template que NÃO separa o raciocínio — o bloco
    // vem embutido no próprio `content`, como uma instalação de DeepSeek R1
    // sem suporte a `message.thinking` faria.
    nome: 'ollama.chat: bloco <think> vazado no content do servidor é removido antes de devolver',
    tipo: 'unidade',
    async executar() {
      const { servidor } = await subirServidorCapturando(() => ({
        message: { content: '<think>hmm, deixa eu ver...</think>\nResposta final do modelo.' },
        prompt_eval_count: 10,
        eval_count: 5,
      }));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const r = await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }] });
        return [
          r.content === 'Resposta final do modelo.' ||
            `content deveria vir sem o bloco de pensamento, veio ${JSON.stringify(r.content)}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Quando o Ollama já separa direito (campo `message.thinking` próprio),
    // `content` não precisa de limpeza nenhuma, e o pensamento fica disponível
    // à parte (não usado por ninguém ainda, só exposto pra uso futuro).
    nome: 'ollama.chat: quando o servidor já separa message.thinking, content não é tocado e o pensamento vem exposto à parte',
    tipo: 'unidade',
    async executar() {
      const { servidor } = await subirServidorCapturando(() => ({
        message: { content: 'Resposta final.', thinking: 'raciocínio separado pelo próprio Ollama' },
        prompt_eval_count: 10,
        eval_count: 5,
      }));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const r = await ollama.chat({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }], pensar: true });
        return [
          r.content === 'Resposta final.' || 'content não deveria ser alterado quando já vem limpo',
          r.pensamento === 'raciocínio separado pelo próprio Ollama' || 'pensamento separado não foi repassado',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Ollama: baixar/instalar modelo de dentro do app — item do plano do
    // Copiloto nível 2 (hoje o app só LISTA modelos, nunca instala). O
    // servidor real manda várias linhas de progresso (baixando manifesto,
    // baixando cada camada, verificando, sucesso) — onProgress precisa
    // receber TODAS elas, não só a última.
    nome: 'ollama.pullModel: onProgress recebe cada linha do NDJSON, e o status final reflete a última',
    tipo: 'unidade',
    async executar() {
      const linhas = [
        { status: 'pulling manifest' },
        { status: 'downloading digest-a', digest: 'sha256:a', total: 1000, completed: 200 },
        { status: 'downloading digest-a', digest: 'sha256:a', total: 1000, completed: 1000 },
        { status: 'verifying sha256 digest' },
        { status: 'success' },
      ];
      const { servidor } = await subirServidorNDJSON(linhas);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const recebidas = [];
        const r = await ollama.pullModel({ host, name: 'llama3.2:3b', onProgress: (p) => recebidas.push(p) });
        return [
          recebidas.length === linhas.length ||
            `esperava ${linhas.length} chamadas de progresso, veio ${recebidas.length}`,
          recebidas[1].total === 1000 && recebidas[1].completed === 200 ||
            `progresso intermediário não veio como esperado: ${JSON.stringify(recebidas[1])}`,
          r.status === 'success' || `esperava status final "success", veio "${r.status}"`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Caso real: Davi testou o modo "2 IAs" do Copiloto numa pergunta
    // simples e não tinha como saber, só olhando a conversa, se o modelo
    // dedicado chegou a ser chamado e se foi de fato pra CPU (`numGpu: 0`).
    // psModels (GET /api/ps) é a base do indicador "2ª IA" na tela — este
    // teste confere os dois casos que o indicador precisa distinguir:
    // sizeVram 0 (100% CPU, como esperado) e sizeVram == size (100% GPU).
    nome: 'ollama.psModels: sizeVram 0 é CPU, sizeVram igual ao size é GPU',
    tipo: 'unidade',
    async executar() {
      const { servidor } = await subirServidorCapturando(() => ({
        models: [
          { name: 'llama3.2:3b', size: 2000000000, size_vram: 0 },
          { name: 'qwen2.5:7b', size: 5000000000, size_vram: 5000000000 },
        ],
      }));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const modelos = await ollama.psModels(host);
        const cpu = modelos.find((m) => m.name === 'llama3.2:3b');
        const gpu = modelos.find((m) => m.name === 'qwen2.5:7b');
        return [
          modelos.length === 2 || `esperava 2 modelos carregados, veio ${modelos.length}`,
          (cpu && cpu.sizeVram === 0) || 'modelo 100% CPU deveria vir com sizeVram 0',
          (gpu && gpu.sizeVram === gpu.size) || 'modelo 100% GPU deveria vir com sizeVram igual ao size',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Pedido de Davi 2026-09-14: fechar o AuGPT descarrega as IAs carregadas
    // antes de fechar de verdade (electron/main.js), pra liberar VRAM/RAM.
    // Confere o contrato HTTP exato que a Ollama documenta pra "descarregar
    // agora sem rodar inferência": POST /api/generate, keep_alive:0, e SEM
    // o campo "prompt" (mandar prompt faria o Ollama gerar uma resposta de
    // verdade antes de descarregar, o oposto do que se quer aqui).
    nome: 'ollama.unloadModel: manda POST /api/generate com keep_alive:0 e sem "prompt" (descarrega sem rodar inferência)',
    tipo: 'unidade',
    async executar() {
      const { servidor, capturado, caminhos } = await subirServidorCapturando(() => ({}));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        await ollama.unloadModel(host, 'qwen2.5:7b');
        return [
          caminhos[0] === '/api/generate' || `esperava POST em /api/generate, foi em "${caminhos[0]}"`,
          capturado[0].model === 'qwen2.5:7b' || `modelo errado no corpo: ${JSON.stringify(capturado[0])}`,
          capturado[0].keep_alive === 0 || `esperava keep_alive:0, veio ${JSON.stringify(capturado[0].keep_alive)}`,
          !('prompt' in capturado[0]) || 'não deveria mandar "prompt" — isso rodaria inferência em vez de só descarregar',
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Pedido de Davi 2026-09-23 (nova janela "Visualizar Execuções",
    // gráfico "qual parte do raciocínio levou mais tempo/custou mais
    // tokens"): `chat()` (não streaming) sempre devolveu `durationMs`
    // (a partir de `total_duration`, nanossegundos) — `chatStream()`
    // (usado só por `redigir()`, a chamada de redação) descartava o mesmo
    // campo, mesmo o Ollama mandando ele igual no chunk final do NDJSON.
    // Sem isso, redação sempre aparecia com custo de tempo zero no
    // detalhamento por fase.
    nome: 'ollama.chatStream: durationMs vem calculado do total_duration (ns→ms) do chunk final, igual ao chat() não-streaming',
    tipo: 'unidade',
    async executar() {
      const servidor = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(`${JSON.stringify({ message: { content: 'Olá' } })}\n`);
        res.write(`${JSON.stringify({ message: { content: ' mundo.' } })}\n`);
        res.write(
          `${JSON.stringify({
            message: { content: '' },
            done: true,
            prompt_eval_count: 20,
            eval_count: 8,
            total_duration: 1500000000, // 1500ms em nanossegundos
          })}\n`
        );
        res.end();
      });
      await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const r = await ollama.chatStream({ host, model: 'qualquer', messages: [{ role: 'user', content: 'oi' }] });
        return [
          r.content === 'Olá mundo.' || `content veio ${JSON.stringify(r.content)}`,
          r.promptTokens === 20 && r.completionTokens === 8 || `tokens vieram ${JSON.stringify(r)}`,
          r.durationMs === 1500 || `esperava durationMs 1500, veio ${r.durationMs}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'ollama.pullModel: linha com "error" vira exceção (ex.: nome de modelo inexistente)',
    tipo: 'unidade',
    async executar() {
      const { servidor } = await subirServidorNDJSON([
        { status: 'pulling manifest' },
        { error: 'pull model manifest: file does not exist' },
      ]);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        try {
          await ollama.pullModel({ host, name: 'modelo-que-nao-existe' });
          return ['deveria ter lançado erro pra uma linha com "error"'];
        } catch (err) {
          return [/does not exist/.test(err.message) || `mensagem de erro não veio como esperado: "${err.message}"`];
        }
      } finally {
        servidor.close();
      }
    },
  },
];
