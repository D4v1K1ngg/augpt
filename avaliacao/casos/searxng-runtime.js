'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const {
  RuntimeSearXNG,
  portaLivre,
  gerarSettingsYml,
  extrairZipPara,
  habilitarSitePackages,
  adicionarAoPth,
  garantirStubPwdWindows,
  caminhoStubPwd,
} = require('../../src/searxng-runtime');
const { zipar } = require('../../src/formatos/zip-escrita');

const CAMINHO_FIXTURE = path.join(__dirname, '..', 'fixtures', 'servidor-searxng-falso.js');

/** Pasta temporária isolada por teste, limpa no final mesmo se o teste falhar. */
function pastaTemp(prefixo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefixo}-`));
}

/** Uma porta livre de verdade pra os testes — "0" só tem esse significado especial
 * na hora de fazer `listen`, não dá pra usar como número de porta pra `fetch` depois. */
async function portaDeTeste() {
  return portaLivre(20000 + Math.floor(Math.random() * 10000));
}

/**
 * No Windows o fixture .js não roda sozinho (sem shebang, EFTYPE): o
 * marcador aponta pra [node, fixture] — ver src/comando.js.
 */
function executavelFixture() {
  return process.platform === 'win32' ? [process.execPath, CAMINHO_FIXTURE] : CAMINHO_FIXTURE;
}

/** Monta um RuntimeSearXNG já com o marcador de instalado apontando pro fixture, sem
 * precisar baixar nada (o que exigiria rede — ver nota em src/searxng-runtime.js). */
async function runtimeComFixtureInstalada({ porta } = {}) {
  fs.chmodSync(CAMINHO_FIXTURE, 0o755);
  const portaFinal = porta ?? (await portaDeTeste());
  const userData = pastaTemp('userdata-sx');
  const rt = new RuntimeSearXNG({ userDataPath: userData });
  fs.mkdirSync(rt.dirRuntime, { recursive: true });
  fs.mkdirSync(rt.dirInstancia, { recursive: true });
  fs.writeFileSync(path.join(rt.dirInstancia, 'settings.yml'), gerarSettingsYml({ secretKey: 'chave-teste', porta: portaFinal }));
  fs.writeFileSync(path.join(rt.dirInstancia, 'porta.json'), JSON.stringify({ porta: portaFinal }));
  fs.writeFileSync(
    rt._caminhoMarcador(),
    JSON.stringify({ plataforma: process.platform, pythonExecutavel: executavelFixture(), pastaSearx: path.dirname(CAMINHO_FIXTURE) })
  );
  return rt;
}

module.exports = [
  {
    nome: 'searxng-runtime: settings.yml tem chave própria por instalação e formats json+html',
    tipo: 'unidade',
    executar() {
      const a = gerarSettingsYml({ secretKey: 'aaa111', porta: 8888 });
      const b = gerarSettingsYml({ secretKey: 'bbb222', porta: 9999 });
      return [
        /secret_key: "aaa111"/.test(a) || 'settings.yml não trouxe a chave secreta certa',
        /port: 8888/.test(a) || 'settings.yml não trouxe a porta certa',
        /- html/.test(a) && /- json/.test(a) || 'settings.yml não pediu os formatos html+json',
        a !== b || 'duas instalações geraram o mesmo settings.yml — chave devia ser única por instalação',
        !/aaa111/.test(b) || 'chave de uma instalação vazou pra outra',
      ];
    },
  },

  {
    nome: 'searxng-runtime: portaLivre usa a preferida quando ela está livre',
    tipo: 'unidade',
    async executar() {
      const preferida = 20000 + Math.floor(Math.random() * 10000);
      const alvo = await portaLivre(preferida);
      return [alvo === preferida || `devia devolver a preferida (${preferida}), devolveu ${alvo}`];
    },
  },

  {
    nome: 'searxng-runtime: portaLivre foge para outra porta quando a preferida está ocupada',
    tipo: 'unidade',
    async executar() {
      const bloqueador = net.createServer();
      await new Promise((r) => bloqueador.listen(0, '127.0.0.1', r));
      const ocupada = bloqueador.address().port;
      try {
        const alternativa = await portaLivre(ocupada);
        return [alternativa !== ocupada || 'não desviou de uma porta ocupada'];
      } finally {
        await new Promise((r) => bloqueador.close(r));
      }
    },
  },

  {
    nome: 'searxng-runtime: extrairZipPara descompacta e descarta a pasta-raiz comum',
    tipo: 'unidade',
    executar() {
      const buffer = zipar({
        'searxng-1.2.3/requirements.txt': 'flask==3.1.3\n',
        'searxng-1.2.3/searx/webapp.py': '# fake\n',
        'searxng-1.2.3/searx/sub/util.py': '# fake\n',
      });
      const destino = pastaTemp('extract-sx');
      const r = extrairZipPara(buffer, destino, { descartarRaizComum: true });
      return [
        r.prefixo === 'searxng-1.2.3/' || `prefixo detectado errado: "${r.prefixo}"`,
        fs.existsSync(path.join(destino, 'requirements.txt')) || 'requirements.txt não apareceu sem o prefixo',
        fs.existsSync(path.join(destino, 'searx', 'webapp.py')) || 'estrutura de pastas não foi preservada',
        fs.existsSync(path.join(destino, 'searx', 'sub', 'util.py')) || 'subpasta aninhada não foi extraída',
        !fs.existsSync(path.join(destino, 'searxng-1.2.3')) || 'a pasta-raiz comum não devia sobrar no destino',
      ];
    },
  },

  {
    nome: 'searxng-runtime: extrairZipPara sem descartarRaizComum mantém os caminhos originais',
    tipo: 'unidade',
    executar() {
      const buffer = zipar({ 'a.txt': 'conteúdo a', 'sub/b.txt': 'conteúdo b' });
      const destino = pastaTemp('extract-sx-plano');
      extrairZipPara(buffer, destino);
      return [
        fs.readFileSync(path.join(destino, 'a.txt'), 'utf8') === 'conteúdo a' || 'a.txt não bateu',
        fs.readFileSync(path.join(destino, 'sub', 'b.txt'), 'utf8') === 'conteúdo b' || 'sub/b.txt não bateu',
      ];
    },
  },

  {
    // Bug real batido pelo Davi (2026-09-20): o SearXNG embutido morria logo
    // ao subir, no log: "python.exe: Error while finding module specification
    // for 'searx.webapp' (ModuleNotFoundError: No module named 'searx')".
    // Causa: o Python embeddable do Windows, quando um arquivo `._pth`
    // existe (sempre existe aqui — `habilitarSitePackages` garante isso),
    // ignora por completo a variável `PYTHONPATH` e a inserção automática de
    // `cwd` que `python -m <pacote>` normalmente faz — `sys.path` vira
    // exatamente as linhas escritas no `._pth`, nada mais. `habilitarSitePackages`
    // só escrevia a linha de `site-packages` (dependências); a pasta com o
    // CÓDIGO do SearXNG nunca entrava ali, só na variável de ambiente
    // (ignorada). `instalar()` agora chama `adicionarAoPth` também pra
    // `pastaSearx`, depois de baixar o SearXNG — ver src/searxng-runtime.js.
    nome: 'searxng-runtime: habilitarSitePackages liga "import site" e adiciona site-packages ao ._pth, sem duplicar',
    tipo: 'unidade',
    executar() {
      const dirPython = pastaTemp('pth-site-packages');
      const caminhoPth = path.join(dirPython, 'python311._pth');
      fs.writeFileSync(caminhoPth, 'python311.zip\n.\n\n# Uncomment to run site.main() automatically\n#import site\n');

      habilitarSitePackages(dirPython);
      habilitarSitePackages(dirPython); // chamado 2x (ex.: reinstalação) não deve duplicar nada

      const conteudo = fs.readFileSync(caminhoPth, 'utf8');
      const linhas = conteudo.split(/\r?\n/);
      return [
        /^import site$/m.test(conteudo) || '"import site" não foi descomentado/adicionado',
        linhas.filter((l) => l.trim() === 'Lib\\site-packages').length === 1 ||
          `"Lib\\\\site-packages" devia aparecer exatamente 1x, apareceu ${linhas.filter((l) => l.trim() === 'Lib\\site-packages').length}x`,
      ];
    },
  },

  {
    nome: 'searxng-runtime: adicionarAoPth acrescenta a pasta do SearXNG ao ._pth (é isto que faltava no bug real)',
    tipo: 'unidade',
    executar() {
      const dirPython = pastaTemp('pth-searx-src');
      const caminhoPth = path.join(dirPython, 'python311._pth');
      fs.writeFileSync(caminhoPth, 'python311.zip\nLib\\site-packages\nimport site\n');

      const pastaSearx = 'C:\\Users\\Usuario\\AppData\\Roaming\\augpt\\searxng-runtime\\runtime\\searxng-src';
      adicionarAoPth(dirPython, pastaSearx);
      adicionarAoPth(dirPython, pastaSearx); // idempotente — reinstalar não deve duplicar

      const linhas = fs.readFileSync(caminhoPth, 'utf8').split(/\r?\n/);
      const ocorrencias = linhas.filter((l) => l.trim() === pastaSearx).length;
      return [
        ocorrencias === 1 || `pasta do SearXNG devia aparecer exatamente 1x no ._pth, apareceu ${ocorrencias}x`,
        linhas.some((l) => l.trim() === 'Lib\\site-packages') || 'a linha de site-packages que já existia não pode sumir',
      ];
    },
  },

  {
    // Bug real batido pelo Davi (2026-09-23): "SearXNG embutido: processo
    // encerrou (código 1) · ... valkeydb.py, line 22, in <module> import
    // pwd \n ModuleNotFoundError: No module named 'pwd'". Confirmado lendo
    // o código-fonte de verdade do SearXNG: `searx/webapp.py` faz `from
    // searx import limiter` incondicional no topo, `searx/limiter.py`
    // importa `searx.valkeydb` também incondicional no topo, e
    // `searx/valkeydb.py` faz `import pwd` (exclusivo de POSIX) incondicional
    // no topo dele — o import quebra ANTES de qualquer checagem de
    // `settings.yml`, mesmo com o limiter desligado (que é o nosso caso,
    // ver gerarSettingsYml). Este caso confirma que o stub é escrito só no
    // Windows, com o conteúdo certo, e que chamar duas vezes (instalar +
    // autocura em iniciar()) não duplica nem falha.
    nome: 'searxng-runtime: garantirStubPwdWindows escreve o stub de "pwd" só no Windows, idempotente',
    tipo: 'unidade',
    executar() {
      const dirSitePackages = pastaTemp('site-packages-pwd');
      const caminho = caminhoStubPwd(dirSitePackages);

      garantirStubPwdWindows(dirSitePackages, { plataforma: 'linux' });
      const naoEscreveuNoLinux = !fs.existsSync(caminho);

      garantirStubPwdWindows(dirSitePackages, { plataforma: 'win32' });
      const escreveuNoWindows = fs.existsSync(caminho);
      const conteudo = escreveuNoWindows ? fs.readFileSync(caminho, 'utf8') : '';

      garantirStubPwdWindows(dirSitePackages, { plataforma: 'win32' }); // 2ª chamada (autocura em iniciar()) não deve falhar nem duplicar
      const conteudoDepoisDaSegundaChamada = fs.readFileSync(caminho, 'utf8');

      return [
        naoEscreveuNoLinux || 'gravou o stub de "pwd" fora do Windows — Linux/Mac já têm o módulo de verdade',
        escreveuNoWindows || 'não gravou o stub de "pwd" no Windows',
        /def getpwuid/.test(conteudo) || 'stub não define getpwuid (usado por searx/valkeydb.py)',
        /def getpwnam/.test(conteudo) || 'stub não define getpwnam',
        conteudoDepoisDaSegundaChamada === conteudo || 'chamar duas vezes reescreveu/duplicou o conteúdo do stub',
      ];
    },
  },

  {
    nome: 'searxng-runtime: estado() muda de "não instalado" pra "instalado" quando o marcador aparece',
    tipo: 'unidade',
    executar() {
      const userData = pastaTemp('userdata-sx-estado');
      const rt = new RuntimeSearXNG({ userDataPath: userData });
      const antes = rt.estado();

      fs.mkdirSync(rt.dirRuntime, { recursive: true });
      fs.writeFileSync(rt._caminhoMarcador(), JSON.stringify({ plataforma: process.platform }));
      const depois = rt.estado();

      return [
        antes.instalado === false || 'runtime novo já nasceu "instalado"',
        depois.instalado === true || 'marcador escrito não fez estaInstalado() virar true',
        depois.rodando === false || 'estado novo não devia estar "rodando"',
        depois.erro === null || 'estado novo não devia ter erro',
      ];
    },
  },

  {
    nome: 'searxng-runtime: iniciar/parar sobem um processo de verdade, respondem busca e derrubam limpo',
    tipo: 'unidade',
    async executar() {
      const rt = await runtimeComFixtureInstalada();
      try {
        const antesDeIniciar = rt.estado();

        await rt.iniciar();
        const rodando = rt.estado();

        const resp = await fetch(`http://127.0.0.1:${rt.porta}/search?q=augpt&format=json`);
        const json = await resp.json();

        await rt.parar();
        const parado = rt.estado();

        // dá um instante pro SO liberar a porta antes de confirmar que caiu
        await new Promise((r) => setTimeout(r, 200));
        let aindaRespondendo = true;
        try {
          await fetch(`http://127.0.0.1:${rodando.porta}/`, { signal: AbortSignal.timeout(1000) });
        } catch {
          aindaRespondendo = false;
        }

        return [
          antesDeIniciar.rodando === false || 'estado inicial não devia estar rodando',
          rodando.rodando === true || 'iniciar() não marcou como rodando',
          Number.isInteger(rodando.porta) || 'iniciar() não registrou a porta',
          resp.ok || `busca de teste falhou: HTTP ${resp.status}`,
          json.results?.[0]?.title?.includes('augpt') || `resposta da busca veio errada: ${JSON.stringify(json)}`,
          parado.rodando === false || 'parar() não marcou como parado',
          parado.porta === null || 'parar() não limpou a porta do estado',
          !aindaRespondendo || 'o processo continuou respondendo depois de parar()',
        ];
      } finally {
        await rt.parar();
      }
    },
  },

  {
    nome: 'searxng-runtime: iniciar() é idempotente — chamar de novo com o processo já de pé não duplica nada',
    tipo: 'unidade',
    async executar() {
      const rt = await runtimeComFixtureInstalada();
      try {
        await rt.iniciar();
        const primeiraPorta = rt.porta;
        const primeiroProcesso = rt.processo;

        await rt.iniciar(); // segunda chamada, processo já rodando

        return [
          rt.porta === primeiraPorta || 'porta mudou numa segunda chamada a iniciar()',
          rt.processo === primeiroProcesso || 'iniciar() de novo trocou o processo em vez de ser um no-op',
        ];
      } finally {
        await rt.parar();
      }
    },
  },

  {
    nome: 'searxng-runtime: duas chamadas a iniciar() em paralelo não sobem dois processos brigando pela porta',
    tipo: 'unidade',
    async executar() {
      // Regressão: `rodando` só vira true depois da checagem de saúde, então
      // duas chamadas próximas (ex.: o botão Salvar disparando iniciar() bem
      // na hora em que outra chamada já está subindo) driblavam o guard de
      // `this.rodando` e cada uma fazia seu próprio spawn.
      const rt = await runtimeComFixtureInstalada();
      try {
        const [a, b] = await Promise.all([rt.iniciar(), rt.iniciar()]);
        return [
          a.porta === b.porta || 'duas chamadas concorrentes voltaram com portas diferentes',
          rt.estado().rodando === true || 'não ficou rodando depois das chamadas concorrentes',
          !rt.estado().erro || `não devia ter erro: ${rt.estado().erro}`,
        ];
      } finally {
        await rt.parar();
      }
    },
  },

  {
    nome: 'searxng-runtime: crash do processo durante a inicialização vira erro claro, não trava',
    tipo: 'unidade',
    async executar() {
      fs.chmodSync(CAMINHO_FIXTURE, 0o755);
      const portaFinal = await portaDeTeste();
      const userData = pastaTemp('userdata-sx-crash');
      const rt = new RuntimeSearXNG({ userDataPath: userData });
      fs.mkdirSync(rt.dirRuntime, { recursive: true });
      fs.mkdirSync(rt.dirInstancia, { recursive: true });
      fs.writeFileSync(path.join(rt.dirInstancia, 'settings.yml'), gerarSettingsYml({ secretKey: 'x', porta: portaFinal }));
      fs.writeFileSync(path.join(rt.dirInstancia, 'porta.json'), JSON.stringify({ porta: portaFinal }));
      fs.writeFileSync(
        rt._caminhoMarcador(),
        JSON.stringify({ plataforma: process.platform, pythonExecutavel: executavelFixture(), pastaSearx: path.dirname(CAMINHO_FIXTURE) })
      );

      const envOriginal = process.env.AUGPT_SIMULAR_CRASH;
      process.env.AUGPT_SIMULAR_CRASH = '1';
      let erro = null;
      try {
        await rt.iniciar();
      } catch (err) {
        erro = err;
      } finally {
        if (envOriginal === undefined) delete process.env.AUGPT_SIMULAR_CRASH;
        else process.env.AUGPT_SIMULAR_CRASH = envOriginal;
      }

      return [
        Boolean(erro) || 'iniciar() não rejeitou quando o processo caiu antes de responder',
        rt.estado().rodando === false || 'estado ficou "rodando" mesmo com o processo tendo caído',
      ];
    },
  },

  {
    nome: 'searxng-runtime: desinstalar() para o processo e apaga a pasta do runtime',
    tipo: 'unidade',
    async executar() {
      const rt = await runtimeComFixtureInstalada();
      await rt.iniciar();
      await rt.desinstalar();

      return [
        rt.estado().rodando === false || 'desinstalar() não derrubou o processo em execução',
        !fs.existsSync(rt.dirBase) || 'desinstalar() não apagou a pasta do runtime',
        rt.estaInstalado() === false || 'estaInstalado() ainda diz "true" depois de desinstalar',
      ];
    },
  },
];
