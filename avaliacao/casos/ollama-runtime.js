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
  avaliarSaudeComDebounce, LIMIAR_FALHAS_SAUDE_PADRAO,
} = require('../../src/ollama-runtime');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'servidor-ollama-falso.js');

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
