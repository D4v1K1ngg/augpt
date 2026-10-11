'use strict';

/**
 * Casos de unidade pra src/ollama-runtime.js — início automático do Ollama
 * (com permissão do usuário). Usa o fixture no lugar do binário real (ver
 * avaliacao/fixtures/servidor-ollama-falso.js) — mesmo espírito dos testes
 * de searxng-runtime.js.
 */

const path = require('path');
const {
  localizarBinario, iniciar, esperarSaude, localizarEIniciar,
  lerMaxModelosCarregados, definirMaxModelosCarregados, MIN_MODELOS_CARREGADOS_DOIS_MODELOS,
  listarProcessosOllama, matarTodosProcessosOllama, reiniciarOllama,
  avaliarSaudeComDebounce, LIMIAR_FALHAS_SAUDE_PADRAO,
} = require('../../src/ollama-runtime');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'servidor-ollama-falso.js');
const FIXTURE_REGSETX = path.join(__dirname, '..', 'fixtures', 'reg-setx-falso.js');
const FIXTURE_TASKLIST_TASKKILL = path.join(__dirname, '..', 'fixtures', 'tasklist-taskkill-falso.js');

/** Roda `bloco`, restaurando a variável de ambiente ao sair (sucesso ou erro). */
async function comEnv(nome, valor, bloco) {
  const antes = process.env[nome];
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
  try {
    return await bloco();
  } finally {
    if (antes === undefined) delete process.env[nome];
    else process.env[nome] = antes;
  }
}

/**
 * src/ollama-runtime.js chama `spawnSync(comando, ['--version'])` e
 * `spawn(comando, ['serve'])` — um único executável, sem argumentos
 * próprios. Usamos o fixture como o PRÓPRIO comando (shebang + bit de
 * execução, igual ao fixture do SearXNG) em vez de `node fixture.js`.
 */
function comandoFixture() {
  return comoComando(FIXTURE);
}

/**
 * No Windows um script .js não roda sozinho (sem shebang, o spawn falha com
 * EFTYPE): lá o comando vira [node, fixture] — ver src/comando.js. No Linux e
 * no macOS continua o próprio script, como sempre.
 */
function comoComando(fixture) {
  return process.platform === 'win32' ? [process.execPath, fixture] : fixture;
}

async function portaLivreDeTeste() {
  const net = require('net');
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.listen(0, '127.0.0.1', () => {
      const porta = s.address().port;
      s.close(() => resolve(porta));
    });
  });
}

module.exports = [
  {
    nome: 'ollama-runtime: localizarBinario encontra o fixture e devolve a versão',
    tipo: 'unidade',
    executar() {
      const r = localizarBinario(comandoFixture());
      return [
        r.encontrado === true || 'deveria ter encontrado o fixture',
        (r.versao && r.versao.includes('fixture')) || `versão não veio como esperado: "${r.versao}"`,
      ];
    },
  },
  {
    nome: 'ollama-runtime: localizarBinario devolve encontrado:false pra um comando que não existe',
    tipo: 'unidade',
    executar() {
      const r = localizarBinario('augpt-comando-que-nao-existe-de-verdade');
      return [r.encontrado === false || 'não deveria ter encontrado um comando inexistente'];
    },
  },
  {
    nome: 'ollama-runtime: iniciar + esperarSaude — sobe o fixture como "ollama serve" e confirma saúde de verdade',
    tipo: 'unidade',
    async executar() {
      const porta = await portaLivreDeTeste();
      const host = `http://127.0.0.1:${porta}`;
      const envAntes = process.env.AUGPT_OLLAMA_FIXTURE_PORTA;
      process.env.AUGPT_OLLAMA_FIXTURE_PORTA = String(porta);
      let pid = null;
      try {
        const r = await iniciar(comandoFixture());
        pid = r.pid;
        const saude = await esperarSaude(host, { timeoutMs: 5000, intervaloMs: 100 });
        return [
          saude.online === true || `esperava saúde online, veio ${JSON.stringify(saude)}`,
          saude.version === '0.0.0-fixture' || `versão de saúde inesperada: "${saude.version}"`,
        ];
      } finally {
        if (pid) {
          try {
            process.kill(pid);
          } catch {
            /* já pode ter morrido sozinho */
          }
        }
        if (envAntes === undefined) delete process.env.AUGPT_OLLAMA_FIXTURE_PORTA;
        else process.env.AUGPT_OLLAMA_FIXTURE_PORTA = envAntes;
      }
    },
  },
  {
    nome: 'ollama-runtime: esperarSaude desiste depois do timeout quando nada está escutando',
    tipo: 'unidade',
    async executar() {
      const porta = await portaLivreDeTeste(); // livre de propósito — ninguém escuta nela
      const inicio = Date.now();
      const saude = await esperarSaude(`http://127.0.0.1:${porta}`, { timeoutMs: 800, intervaloMs: 100 });
      const duracao = Date.now() - inicio;
      return [
        saude.online === false || 'deveria ter desistido (nada estava escutando)',
        /não respondeu/.test(saude.error || '') || `mensagem de erro inesperada: "${saude.error}"`,
        duracao < 3000 || `demorou demais pra desistir (${duracao}ms) — timeout não foi respeitado`,
      ];
    },
  },
  {
    // O caminho de sucesso (encontrar + ligar + confirmar saúde) já é
    // exercitado de ponta a ponta pelo teste "iniciar + esperarSaude" acima
    // — repetir aqui via localizarEIniciar spawnaria um SEGUNDO fixture sem
    // dar um jeito de capturar o pid pra matar depois (a função não expõe
    // isso pro chamador de propósito), o que deixaria um processo órfão
    // rodando pra sempre a cada execução da bancada. Este teste cobre só o
    // ramo que não spawna nada: comando inexistente sai cedo, sem tentar
    // ligar.
    nome: 'ollama-runtime: localizarEIniciar devolve encontrado:false sem tentar ligar nada, quando o comando não existe',
    tipo: 'unidade',
    async executar() {
      const r = await localizarEIniciar('http://127.0.0.1:1', 'augpt-comando-que-nao-existe-de-verdade');
      return [
        r.ok === false || 'não deveria ter dado certo',
        r.encontrado === false || 'não deveria ter "encontrado" um comando inexistente',
        (r.error && r.error.length > 5) || 'deveria vir com uma mensagem de erro explicando',
      ];
    },
  },

  {
    // Segundo caso real, MESMO dia: com o teto em 2, o Davi via (via `ollama
    // ps` ao vivo) o modelo principal e o crítico coexistindo na maior parte
    // do tempo, mas de vez em quando um dos dois sumia sozinho, sem nenhuma
    // chamada nova pro outro ter acontecido — o "revezando" que ele
    // reportou. Achado: o modelo de EMBEDDINGS (`embedModel`, usado pra
    // seleção de skill e busca semântica em memória) sempre competiu pelo
    // mesmo teto, e nunca tinha sido contado — carregá-lo expulsava um dos
    // outros dois por LRU. Trava este valor em 3 (não 2) pra não regredir em
    // silêncio se alguém mexer na constante sem lembrar do terceiro modelo.
    nome: 'ollama-runtime: MIN_MODELOS_CARREGADOS_DOIS_MODELOS é 3 (principal + crítico dedicado + modelo de embeddings), não 2 (bug corrigido 2026-09-18)',
    tipo: 'unidade',
    executar() {
      return [
        MIN_MODELOS_CARREGADOS_DOIS_MODELOS === 3 ||
          `esperava 3 (principal+crítico+embeddings), veio ${MIN_MODELOS_CARREGADOS_DOIS_MODELOS}`,
      ];
    },
  },
  {
    // Caso real (investigação com o Davi, 2026-09-18): `ollama ps` mostrou o
    // modelo principal virando "Stopping..." assim que o crítico dedicado do
    // "2 IAs" foi pedido — o Ollama dele só mantinha 1 modelo carregado por
    // vez. `lerMaxModelosCarregados`/`definirMaxModelosCarregados` existem
    // pra oferecer o ajuste (o mesmo `setx` que o Davi rodou manual) direto
    // pela UI, sem exigir terminal. Fora do Windows não há como ler/gravar
    // isso de forma confiável e genérica — `suportado:false` avisa a UI a
    // simplesmente não oferecer nada nesses sistemas.
    nome: 'ollama-runtime: lerMaxModelosCarregados devolve suportado:false fora do Windows, sem tentar rodar nada',
    tipo: 'unidade',
    executar() {
      const r = lerMaxModelosCarregados({ plataforma: 'linux' });
      return [r.suportado === false || 'não deveria alegar suporte fora do Windows'];
    },
  },
  {
    nome: 'ollama-runtime: lerMaxModelosCarregados lê o valor gravado (fixture simula "reg query" com a variável definida)',
    tipo: 'unidade',
    async executar() {
      return comEnv('AUGPT_REGSETX_FIXTURE_VALOR', '2', () => {
        const r = lerMaxModelosCarregados({ plataforma: 'win32', comandoReg: comoComando(FIXTURE_REGSETX) });
        return [
          r.suportado === true || 'deveria alegar suporte no Windows',
          r.valor === 2 || `esperava valor 2, veio ${JSON.stringify(r.valor)}`,
        ];
      });
    },
  },
  {
    nome: 'ollama-runtime: lerMaxModelosCarregados devolve valor:null quando a variável ainda não foi definida (fixture simula "reg query" sem achar)',
    tipo: 'unidade',
    async executar() {
      return comEnv('AUGPT_REGSETX_FIXTURE_VALOR', undefined, () => {
        const r = lerMaxModelosCarregados({ plataforma: 'win32', comandoReg: comoComando(FIXTURE_REGSETX) });
        return [
          r.suportado === true || 'deveria alegar suporte no Windows',
          r.valor === null || `esperava valor null (variável não definida), veio ${JSON.stringify(r.valor)}`,
        ];
      });
    },
  },
  {
    nome: 'ollama-runtime: definirMaxModelosCarregados devolve ok:false fora do Windows, sem tentar rodar nada',
    tipo: 'unidade',
    executar() {
      const r = definirMaxModelosCarregados(2, { plataforma: 'darwin' });
      return [
        r.ok === false || 'não deveria ter dado certo fora do Windows',
        r.suportado === false || 'não deveria alegar suporte fora do Windows',
      ];
    },
  },
  {
    nome: 'ollama-runtime: definirMaxModelosCarregados grava com sucesso (fixture simula "setx" funcionando)',
    tipo: 'unidade',
    executar() {
      const r = definirMaxModelosCarregados(MIN_MODELOS_CARREGADOS_DOIS_MODELOS, {
        plataforma: 'win32',
        comandoSetx: comoComando(FIXTURE_REGSETX),
      });
      return [r.ok === true || `esperava sucesso, veio ${JSON.stringify(r)}`];
    },
  },
  {
    nome: 'ollama-runtime: definirMaxModelosCarregados devolve o erro quando "setx" falha (fixture simula falta de permissão)',
    tipo: 'unidade',
    async executar() {
      return comEnv('AUGPT_REGSETX_FIXTURE_FALHAR', '1', () => {
        const r = definirMaxModelosCarregados(2, { plataforma: 'win32', comandoSetx: comoComando(FIXTURE_REGSETX) });
        return [
          r.ok === false || 'deveria ter falhado (fixture forçado a falhar)',
          r.suportado === true || 'ainda deveria alegar suporte (é o Windows — só o comando falhou)',
          (r.error && r.error.length > 3) || 'deveria vir com uma mensagem de erro explicando',
        ];
      });
    },
  },

  // Caso real (Davi, 2026-09-18): com "2 IAs" + pipelineForcadoUniversal, o
  // crítico dedicado é chamado em quase todo passo — como o Ollama dele só
  // mantinha 1 modelo carregado por vez, cada troca podia deixá-lo sem
  // responder por um instante, e o polling de saúde de 20s (electron/main.js,
  // ipcMain.handle('ollama:health', ...)) tratava isso como "caiu de
  // verdade", disparando `localizarEIniciar` (spawns que abriam uma janela de
  // Prompt de Comando visível no Windows dele) a cada soluço passageiro.
  // `avaliarSaudeComDebounce` é a decisão pura por trás do conserto: só
  // "atingiuLimiar" depois de falhas SEGUIDAS o bastante.
  // Caso real (Davi, 2026-09-18, na sequência direta da correção de
  // MIN_MODELOS_CARREGADOS_DOIS_MODELOS acima): depois de gravar o valor
  // novo E "fechar e abrir o Ollama de novo" pela bandeja, o `ollama ps`
  // continuou mostrando o comportamento antigo. Achado: sobrou um
  // `ollama.exe` órfão rodando (o Gerenciador de Tarefas confirmou), com a
  // variável de ambiente antiga — o botão "Reiniciar o Ollama pra mim"
  // existe pra resolver isso automaticamente (matar TODOS os processos
  // antes de religar), sem depender do usuário caçar processo órfão no
  // Gerenciador de Tarefas manualmente.
  {
    nome: 'ollama-runtime: listarProcessosOllama devolve suportado:false fora do Windows, sem tentar rodar nada',
    tipo: 'unidade',
    executar() {
      const r = listarProcessosOllama({ plataforma: 'linux' });
      return [
        r.suportado === false || 'não deveria alegar suporte fora do Windows',
        Array.isArray(r.pids) && r.pids.length === 0 || 'não deveria vir com PIDs fora do Windows',
      ];
    },
  },
  {
    nome: 'ollama-runtime: listarProcessosOllama lê os PIDs do fixture (simula tasklist com processos órfãos rodando)',
    tipo: 'unidade',
    async executar() {
      return comEnv('AUGPT_TASKLIST_FIXTURE_PIDS', '1234,5678', () => {
        const r = listarProcessosOllama({ plataforma: 'win32', comandoTasklist: comoComando(FIXTURE_TASKLIST_TASKKILL) });
        return [
          r.suportado === true || 'deveria alegar suporte no Windows',
          (r.pids.length === 2 && r.pids.includes(1234) && r.pids.includes(5678)) ||
            `esperava PIDs [1234, 5678], veio ${JSON.stringify(r.pids)}`,
        ];
      });
    },
  },
  {
    nome: 'ollama-runtime: listarProcessosOllama devolve pids:[] quando não há nenhum ollama.exe rodando (fixture simula tasklist vazio)',
    tipo: 'unidade',
    async executar() {
      return comEnv('AUGPT_TASKLIST_FIXTURE_PIDS', undefined, () => {
        const r = listarProcessosOllama({ plataforma: 'win32', comandoTasklist: comoComando(FIXTURE_TASKLIST_TASKKILL) });
        return [
          r.suportado === true || 'deveria alegar suporte no Windows',
          r.pids.length === 0 || `esperava nenhum PID, veio ${JSON.stringify(r.pids)}`,
        ];
      });
    },
  },
  {
    nome: 'ollama-runtime: matarTodosProcessosOllama devolve ok:false fora do Windows, sem tentar rodar nada',
    tipo: 'unidade',
    executar() {
      const r = matarTodosProcessosOllama({ plataforma: 'darwin' });
      return [
        r.ok === false || 'não deveria ter dado certo fora do Windows',
        r.suportado === false || 'não deveria alegar suporte fora do Windows',
      ];
    },
  },
  {
    nome: 'ollama-runtime: matarTodosProcessosOllama devolve ok:true (fixture simula taskkill terminando o(s) processo(s))',
    tipo: 'unidade',
    executar() {
      const r = matarTodosProcessosOllama({ plataforma: 'win32', comandoTaskkill: comoComando(FIXTURE_TASKLIST_TASKKILL) });
      return [r.ok === true || `esperava sucesso, veio ${JSON.stringify(r)}`];
    },
  },
  {
    nome: 'ollama-runtime: reiniciarOllama devolve suportado:false fora do Windows, sem tentar matar nem religar nada',
    tipo: 'unidade',
    async executar() {
      const r = await reiniciarOllama('http://127.0.0.1:1', { plataforma: 'linux' });
      return [
        r.ok === false || 'não deveria ter dado certo fora do Windows',
        r.suportado === false || 'não deveria alegar suporte fora do Windows',
      ];
    },
  },
  {
    // Confirma o corte antecipado: se matar falhar de cara, reiniciarOllama
    // NUNCA deveria chegar a tentar subir um `ollama serve` novo por cima de
    // processos que podem ainda estar vivos. Usa um comando inexistente (em
    // vez de um fixture) pra forçar a falha de spawn com segurança, sem
    // arriscar deixar um processo do fixture do Ollama órfão na bancada (o
    // caminho de sucesso ponta a ponta já é coberto pelos testes de
    // `matarTodosProcessosOllama` e de `iniciar`+`esperarSaude` em separado —
    // mesmo raciocínio já usado no teste de `localizarEIniciar` acima).
    nome: 'ollama-runtime: reiniciarOllama para cedo (sem tentar religar) quando o próprio comando de matar falha',
    tipo: 'unidade',
    async executar() {
      const r = await reiniciarOllama('http://127.0.0.1:1', {
        plataforma: 'win32',
        comandoTaskkill: 'augpt-comando-que-nao-existe-de-verdade',
      });
      return [
        r.ok === false || 'não deveria ter dado certo (matar falhou de cara)',
        (r.error && r.error.length > 3) || 'deveria vir com uma mensagem de erro explicando',
      ];
    },
  },

  {
    nome: 'ollama-runtime: avaliarSaudeComDebounce não atinge o limiar numa única falha isolada',
    tipo: 'unidade',
    executar() {
      const r = avaliarSaudeComDebounce(false, 0);
      return [
        r.falhasConsecutivas === 1 || `esperava contar 1 falha, veio ${r.falhasConsecutivas}`,
        r.atingiuLimiar === false || 'uma única falha não deveria já disparar a ação',
      ];
    },
  },
  {
    nome: 'ollama-runtime: avaliarSaudeComDebounce atinge o limiar depois de falhas seguidas o bastante',
    tipo: 'unidade',
    executar() {
      let falhas = 0;
      let ultimo;
      for (let i = 0; i < LIMIAR_FALHAS_SAUDE_PADRAO; i++) {
        ultimo = avaliarSaudeComDebounce(false, falhas);
        falhas = ultimo.falhasConsecutivas;
      }
      return [
        falhas === LIMIAR_FALHAS_SAUDE_PADRAO || `esperava ${LIMIAR_FALHAS_SAUDE_PADRAO} falhas seguidas, veio ${falhas}`,
        ultimo.atingiuLimiar === true || 'deveria ter atingido o limiar depois de falhas seguidas suficientes',
      ];
    },
  },
  {
    nome: 'ollama-runtime: avaliarSaudeComDebounce zera a contagem assim que uma checagem volta online (não é média, é "seguidas")',
    tipo: 'unidade',
    executar() {
      const depoisDeFalhar = avaliarSaudeComDebounce(false, LIMIAR_FALHAS_SAUDE_PADRAO - 1);
      const depoisDeVoltar = avaliarSaudeComDebounce(true, depoisDeFalhar.falhasConsecutivas);
      return [
        depoisDeVoltar.falhasConsecutivas === 0 || 'uma checagem online deveria zerar a contagem de falhas seguidas',
        depoisDeVoltar.atingiuLimiar === false || 'checagem online nunca deveria "atingir o limiar"',
      ];
    },
  },
  {
    nome: 'ollama-runtime: avaliarSaudeComDebounce respeita um limiar customizado (não fica preso no padrão)',
    tipo: 'unidade',
    executar() {
      const r1 = avaliarSaudeComDebounce(false, 0, 1);
      return [
        r1.atingiuLimiar === true || 'com limiar 1, uma única falha já deveria bastar',
      ];
    },
  },
];
