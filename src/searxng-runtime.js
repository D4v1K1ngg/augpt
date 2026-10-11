'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { montarComando } = require('./comando');
const { EventEmitter } = require('events');

const zip = require('./formatos/zip');
const { baixarBinario } = require('./tools/http');

/**
 * Instalador + gerenciador de processo de um SearXNG embutido — a alternativa
 * a pedir Docker ou uma instalação manual: um botão que baixa um Python (no
 * Windows) ou usa o Python do sistema (Linux/Mac), instala o SearXNG numa
 * pasta própria e sobe o processo local igual a um serviço qualquer.
 *
 * Modelado no mesmo formato de `src/mcp/cliente.js` (spawn, captura de
 * stdout/stderr, tratamento de `error`/`exit`, `kill()` idempotente) — só que
 * no lugar de JSON-RPC por stdio, o "protocolo" aqui é HTTP: sobe o processo e
 * faz polling em `http://127.0.0.1:<porta>/` até responder.
 *
 * IMPORTANTE sobre o que foi validado onde: a extração de zip, a geração do
 * settings.yml, a seleção de porta livre, o `pip install --target`, o spawn
 * do processo e a checagem de saúde foram testados de verdade (bancada +
 * smoke test). Os downloads em si (python.org e GitHub) não puderam ser
 * exercidos no ambiente onde isto foi escrito — a rede de lá bloqueia esses
 * domínios por política. As funções que baixam ficam isoladas e pequenas de
 * propósito, para facilitar revisão, mas só serão validadas de fato na
 * primeira instalação real.
 */

const VERSAO_PYTHON = '3.11.9';
const PORTA_PADRAO = 8888;
const TIMEOUT_SAUDE_MS = 60000;
const INTERVALO_SAUDE_MS = 500;

const urlPythonEmbeddableWindows = () =>
  `https://www.python.org/ftp/python/${VERSAO_PYTHON}/python-${VERSAO_PYTHON}-embed-amd64.zip`;

const urlGetPip = () => 'https://bootstrap.pypa.io/get-pip.py';

const urlUltimaTagSearxng = () => 'https://api.github.com/repos/searxng/searxng/releases/latest';

const urlZipSearxng = (tag) => `https://github.com/searxng/searxng/archive/refs/tags/${tag}.zip`;

const urlZipSearxngMaster = () => 'https://github.com/searxng/searxng/archive/refs/heads/master.zip';

/** Porta preferida se estiver livre; senão, deixa o SO escolher uma. */
function portaLivre(preferida) {
  return new Promise((resolve) => {
    const tentativa = net.createServer();
    tentativa.unref();
    tentativa.on('error', () => {
      const qualquer = net.createServer();
      qualquer.unref();
      qualquer.listen(0, '127.0.0.1', () => {
        const porta = qualquer.address().port;
        qualquer.close(() => resolve(porta));
      });
    });
    tentativa.listen(preferida, '127.0.0.1', () => {
      tentativa.close(() => resolve(preferida));
    });
  });
}

/** Extrai um zip (Buffer) para uma pasta, opcionalmente descartando a pasta-raiz comum. */
function extrairZipPara(buffer, destino, { descartarRaizComum = false } = {}) {
  const lista = zip.listar(buffer);

  let prefixo = '';
  if (descartarRaizComum && lista.length) {
    const primeira = lista[0].nome;
    const barra = primeira.indexOf('/');
    if (barra > 0) {
      const candidato = primeira.slice(0, barra + 1);
      if (lista.every((e) => e.nome.startsWith(candidato))) prefixo = candidato;
    }
  }

  for (const entrada of lista) {
    if (entrada.nome.endsWith('/')) continue; // diretório puro: criado sob demanda pelos arquivos
    const relativo = prefixo && entrada.nome.startsWith(prefixo) ? entrada.nome.slice(prefixo.length) : entrada.nome;
    if (!relativo) continue;
    const destinoArquivo = path.resolve(destino, relativo);
    // Fase 1 de segurança (2026-09-23): "zip slip" — uma entrada chamada
    // "../../algum/arquivo" (ou com caminho absoluto) escreveria fora da pasta
    // do runtime. O zip vem de download via HTTPS de fonte conhecida, mas nada
    // aqui confere hash, então a extração não pode confiar nos nomes.
    const dentro = path.relative(path.resolve(destino), destinoArquivo);
    if (!dentro || dentro.startsWith('..') || path.isAbsolute(dentro)) {
      throw new Error(`zip com caminho inseguro recusado: ${entrada.nome}`);
    }
    fs.mkdirSync(path.dirname(destinoArquivo), { recursive: true });
    const conteudo = zip.extrairEntrada(buffer, entrada);
    fs.writeFileSync(destinoArquivo, conteudo);
  }
  return { total: lista.length, prefixo };
}

/**
 * SearXNG (versões recentes) importa o módulo `pwd` sem checagem de
 * plataforma nenhuma — `searx/webapp.py` faz `from searx import limiter` no
 * topo do arquivo (incondicional), `searx/limiter.py` importa
 * `searx.valkeydb` também no topo (incondicional), e `searx/valkeydb.py` faz
 * `import pwd` no topo dele. `pwd` é exclusivo de POSIX, não existe no
 * Windows — então o processo morre com `ModuleNotFoundError: No module
 * named 'pwd'` assim que `python -m searx.webapp` sobe, mesmo com o limiter
 * DESLIGADO no `settings.yml` (bug real batido pelo Davi, 2026-09-23): a
 * checagem de `settings['server']['limiter']` só decide se o limiter fica
 * ATIVO (dentro de `limiter.initialize()`), não se o módulo é importado —
 * o import já aconteceu antes disso, no carregamento do `webapp.py`.
 *
 * `pwd.getpwuid()` só é chamado dentro do `except` de uma falha de conexão
 * com o Valkey (`valkeydb.py`), e o `settings.yml` que `gerarSettingsYml()`
 * gera aqui não liga limiter nem configura Valkey nenhum — esse branch
 * nunca é alcançado no nosso fluxo. Um stub que só PRECISA EXISTIR (as
 * funções de verdade nunca chegam a ser chamadas) resolve sem precisar
 * remendar o código-fonte baixado do SearXNG.
 */
function caminhoStubPwd(dirSitePackages) {
  return path.join(dirSitePackages, 'pwd.py');
}

/**
 * Idempotente — chamada tanto ao instalar (instalações novas) quanto no
 * início de cada `iniciar()` (autocura instalações feitas ANTES desta
 * correção, como a do Davi, sem exigir reinstalar ~50MB de SearXNG+deps de
 * novo). Windows-only: Linux/Mac já têm `pwd` de verdade.
 *
 * `plataforma` é injetável (mesmo padrão de `lerMaxModelosCarregados`/
 * `matarTodosProcessosOllama` em src/ollama-runtime.js) pra a bancada poder
 * testar o ramo Windows rodando em qualquer SO, sem mexer em `process.platform`
 * de verdade.
 */
function garantirStubPwdWindows(dirSitePackages, { plataforma = process.platform } = {}) {
  if (plataforma !== 'win32') return;
  const caminho = caminhoStubPwd(dirSitePackages);
  if (fs.existsSync(caminho)) return;
  fs.mkdirSync(dirSitePackages, { recursive: true });
  fs.writeFileSync(
    caminho,
    [
      '"""Stub do modulo `pwd` (exclusivo de POSIX) so para o import nao',
      'quebrar no Windows -- ver comentario em garantirStubPwdWindows(),',
      'src/searxng-runtime.js. searx/valkeydb.py so usa pwd.getpwuid() dentro',
      'do log de uma falha de conexao com o Valkey, que o AuGPT nunca aciona',
      '(settings.yml gerado aqui nao liga limiter nem Valkey)."""',
      '',
      'class _SenhaFalsa:',
      "    pw_name = 'desconhecido'",
      '    pw_uid = -1',
      '',
      '',
      'def getpwuid(_uid):',
      '    return _SenhaFalsa()',
      '',
      '',
      'def getpwnam(_nome):',
      '    return _SenhaFalsa()',
      '',
    ].join('\n'),
    'utf8'
  );
}

function gerarSettingsYml({ secretKey, porta }) {
  return [
    'use_default_settings: true',
    'server:',
    `  secret_key: "${secretKey}"`,
    '  bind_address: "127.0.0.1"',
    `  port: ${porta}`,
    'search:',
    '  formats:',
    '    - html',
    '    - json',
    // Medido em 11/10: os três buscadores ligados por padrão (brave,
    // duckduckgo, google cse) estavam todos suspensos por "too many requests"
    // ou timeout, e o SearXNG devolvia zero resultados; bing e yahoo, que vêm
    // desligados, respondiam. Mais buscadores independentes = um bloqueio
    // não derruba a busca. (google "puro", qwant e mojeek foram testados e
    // recusam: access denied / CAPTCHA.)
    'engines:',
    '  - name: bing',
    '    disabled: false',
    '  - name: yahoo',
    '    disabled: false',
    '',
  ].join('\n');
}

/** Instalação antiga (settings.yml sem a lista de buscadores): regrava com a
 * mesma chave e a mesma porta. */
function atualizarSettingsYml(arquivo) {
  let atual;
  try {
    atual = fs.readFileSync(arquivo, 'utf8');
  } catch {
    return false;
  }
  if (/name: bing/.test(atual)) return false;
  const secretKey = /secret_key: "([^"]+)"/.exec(atual)?.[1];
  const porta = Number(/^\s*port: (\d+)/m.exec(atual)?.[1]);
  if (!secretKey || !porta) return false;
  fs.writeFileSync(arquivo, gerarSettingsYml({ secretKey, porta }));
  return true;
}

/** Acha o arquivo `python3XX._pth` dentro da pasta do Python embeddable
 * (nome varia por versão de patch, por isso a busca por regex). */
function _arquivoPth(dirPython) {
  const arquivo = fs.readdirSync(dirPython).find((f) => /^python\d+\._pth$/.test(f));
  if (!arquivo) throw new Error('não encontrei o arquivo ._pth no Python embeddable — build inesperado');
  return path.join(dirPython, arquivo);
}

/**
 * Acrescenta uma linha (caminho absoluto ou relativo ao dirPython) ao
 * `._pth`, sem duplicar se já estiver lá.
 *
 * Bug real batido pelo Davi (2026-09-20): o processo do SearXNG embutido
 * morria com `ModuleNotFoundError: No module named 'searx'`, mesmo com
 * `PYTHONPATH` apontando pra pasta certa no `env` do `spawn()` — porque o
 * Python embeddable, quando um arquivo `._pth` existe (é sempre o caso
 * aqui — `habilitarSitePackages` abaixo garante isso), entra em modo
 * "isolado": `PYTHONPATH` é IGNORADO por inteiro, e o `cwd` deixa de ser
 * adicionado automaticamente a `sys.path` (o que `python -m <pacote>`
 * normalmente faz sozinho). `sys.path` vira exatamente o que está listado
 * no `._pth`, nada mais — então qualquer pasta que o processo precisa
 * enxergar (site-packages das dependências, e o código-fonte do próprio
 * SearXNG) precisa estar escrita aqui dentro, não só numa variável de
 * ambiente. `_instalar()` chama isto pra `pastaSearx` logo depois de
 * baixar/extrair o SearXNG (ver `instalar()` mais abaixo).
 */
function adicionarAoPth(dirPython, linha) {
  const caminho = _arquivoPth(dirPython);
  const conteudo = fs.readFileSync(caminho, 'utf8');
  if (conteudo.split(/\r?\n/).some((l) => l.trim() === linha)) return;
  fs.writeFileSync(caminho, `${conteudo.replace(/\n?$/, '\n')}${linha}\n`, 'utf8');
}

/** Habilita site-packages num Python embeddable do Windows (vem desligado por padrão). */
function habilitarSitePackages(dirPython) {
  const caminho = _arquivoPth(dirPython);
  let conteudo = fs.readFileSync(caminho, 'utf8');
  conteudo = conteudo.replace(/^#\s*import site/m, 'import site');
  if (!/^import site/m.test(conteudo)) conteudo += '\nimport site\n';
  fs.writeFileSync(caminho, conteudo, 'utf8');
  adicionarAoPth(dirPython, 'Lib\\site-packages');
}

function rodar(comando, argumentos, opcoes = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(comando, argumentos, { windowsHide: true, ...opcoes });
    let saida = '';
    let erro = '';
    p.stdout?.on('data', (d) => {
      saida += d;
    });
    p.stderr?.on('data', (d) => {
      erro += d;
    });
    p.on('error', (err) => reject(new Error(`falha ao rodar ${comando}: ${err.message}`)));
    p.on('exit', (codigo) => {
      if (codigo === 0) resolve({ saida, erro });
      else reject(new Error(`${comando} ${argumentos.join(' ')} saiu com código ${codigo}: ${erro.slice(-800) || saida.slice(-800)}`));
    });
  });
}

class RuntimeSearXNG extends EventEmitter {
  constructor({ userDataPath }) {
    super();
    this.dirBase = path.join(userDataPath, 'searxng-runtime');
    this.dirRuntime = path.join(this.dirBase, 'runtime');
    this.dirInstancia = path.join(this.dirBase, 'instancia');
    this.processo = null;
    this.rodando = false;
    this.porta = null;
    this.erro = null;
    this.instalando = false;
    this.ultimoLog = '';
    this._processoAtivo = false;
  }

  _caminhoMarcador() {
    return path.join(this.dirRuntime, '.instalado.json');
  }

  estaInstalado() {
    return fs.existsSync(this._caminhoMarcador());
  }

  _marcador() {
    try {
      return JSON.parse(fs.readFileSync(this._caminhoMarcador(), 'utf8'));
    } catch {
      return null;
    }
  }

  estado() {
    return {
      instalado: this.estaInstalado(),
      instalando: this.instalando,
      rodando: this.rodando,
      porta: this.porta,
      erro: this.erro,
    };
  }

  /* ------------------------------ instalação ------------------------------ */

  async instalar(emitirProgresso = () => {}) {
    if (this.instalando) throw new Error('uma instalação já está em andamento');
    if (this.rodando) await this.parar();

    this.instalando = true;
    this.erro = null;
    try {
      fs.rmSync(this.dirRuntime, { recursive: true, force: true });
      fs.mkdirSync(this.dirRuntime, { recursive: true });

      emitirProgresso('baixando-python');
      const python = await this._prepararPython();

      emitirProgresso('baixando-searxng');
      const pastaSearx = await this._baixarSearxng();
      // Ver comentário de adicionarAoPth() acima: sem isto, `python -m
      // searx.webapp` não acha o pacote `searx` no Windows (embeddable
      // ignora PYTHONPATH/cwd quando ._pth existe — sempre existe aqui).
      if (process.platform === 'win32') adicionarAoPth(python.dirPython, pastaSearx);

      emitirProgresso('instalando-dependencias');
      await this._instalarDependencias(python, pastaSearx);
      // Ver comentário de garantirStubPwdWindows() acima: sem isto, o
      // processo do SearXNG morre no Windows com "No module named 'pwd'"
      // assim que sobe, mesmo com o limiter desligado no settings.yml.
      garantirStubPwdWindows(python.sitePackages);

      emitirProgresso('configurando');
      await this._gerarInstancia();

      fs.writeFileSync(
        this._caminhoMarcador(),
        JSON.stringify(
          {
            plataforma: process.platform,
            pythonExecutavel: python.executavel,
            pastaSearx,
            instaladoEm: new Date().toISOString(),
          },
          null,
          2
        )
      );

      emitirProgresso('pronto');
      return this.estado();
    } catch (err) {
      this.erro = err.message;
      throw err;
    } finally {
      this.instalando = false;
    }
  }

  /** Windows: baixa o Python embeddable oficial. Linux/Mac: usa o `python3` do sistema. */
  async _prepararPython() {
    if (process.platform === 'win32') {
      const dirPython = path.join(this.dirRuntime, 'python');
      fs.mkdirSync(dirPython, { recursive: true });

      const zipPython = await baixarBinario(urlPythonEmbeddableWindows(), { timeout: 180000 });
      if (!zipPython.ok) throw new Error(`não consegui baixar o Python (HTTP ${zipPython.status})`);
      extrairZipPara(zipPython.buffer, dirPython);
      habilitarSitePackages(dirPython);

      const executavel = path.join(dirPython, 'python.exe');

      // embeddable não vem com pip — bootstrap via get-pip.py, do jeito oficial
      const getPip = await baixarBinario(urlGetPip(), { timeout: 60000 });
      if (!getPip.ok) throw new Error(`não consegui baixar o get-pip.py (HTTP ${getPip.status})`);
      const caminhoGetPip = path.join(dirPython, 'get-pip.py');
      fs.writeFileSync(caminhoGetPip, getPip.buffer);
      await rodar(executavel, [caminhoGetPip, '--no-warn-script-location']);

      return { executavel, dirPython, sitePackages: path.join(dirPython, 'Lib', 'site-packages') };
    }

    // Linux/Mac: exige python3 já instalado — é um passo só nesses sistemas,
    // ao contrário do Windows, onde "baixar um Python" é o ponto todo.
    const teste = spawnSync('python3', ['--version']);
    if (teste.error || teste.status !== 0) {
      throw new Error(
        'não encontrei o "python3" no sistema. Instale o Python 3.11+ (pelo gerenciador de pacotes da sua ' +
          'distro, ou python.org no Mac) e tente instalar de novo.'
      );
    }
    const dirSite = path.join(this.dirRuntime, 'site-packages');
    fs.mkdirSync(dirSite, { recursive: true });
    return { executavel: 'python3', sitePackages: dirSite };
  }

  /** Baixa o código-fonte do SearXNG (release mais recente; cai para master se a API falhar). */
  async _baixarSearxng() {
    let urlZip = urlZipSearxngMaster();
    try {
      const r = await baixarBinario(urlUltimaTagSearxng(), { timeout: 15000, headers: { Accept: 'application/vnd.github+json' } });
      if (r.ok) {
        const dados = JSON.parse(r.buffer.toString('utf8'));
        if (dados?.tag_name) urlZip = urlZipSearxng(dados.tag_name);
      }
    } catch {
      /* API indisponível: segue com master, que sempre existe */
    }

    const pastaSearx = path.join(this.dirRuntime, 'searxng-src');
    const zipSearx = await baixarBinario(urlZip, { timeout: 120000 });
    if (!zipSearx.ok) throw new Error(`não consegui baixar o SearXNG (HTTP ${zipSearx.status})`);
    extrairZipPara(zipSearx.buffer, pastaSearx, { descartarRaizComum: true });

    const requirements = path.join(pastaSearx, 'requirements.txt');
    if (!fs.existsSync(requirements)) throw new Error('o zip do SearXNG não trouxe requirements.txt — build inesperado');
    return pastaSearx;
  }

  async _instalarDependencias(python, pastaSearx) {
    const requirements = path.join(pastaSearx, 'requirements.txt');
    await rodar(python.executavel, [
      '-m',
      'pip',
      'install',
      '--target',
      python.sitePackages,
      '--no-warn-script-location',
      '-r',
      requirements,
    ]);
  }

  async _gerarInstancia() {
    fs.mkdirSync(this.dirInstancia, { recursive: true });
    const porta = await portaLivre(PORTA_PADRAO);
    const secretKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(this.dirInstancia, 'settings.yml'), gerarSettingsYml({ secretKey, porta }));
    fs.writeFileSync(path.join(this.dirInstancia, 'porta.json'), JSON.stringify({ porta }));
  }

  async desinstalar() {
    await this.parar();
    fs.rmSync(this.dirBase, { recursive: true, force: true });
  }

  /* ------------------------------ processo ------------------------------ */

  /**
   * `rodando` só vira `true` depois da checagem de saúde (que leva um tempo) —
   * sem essa trava, duas chamadas próximas (ex.: o clique em Salvar disparando
   * `iniciar()` enquanto outra já está subindo o processo) driblariam o guard
   * de `this.rodando` e cada uma faria seu próprio `spawn`, os dois brigando
   * pela mesma porta. Chamadas concorrentes esperam a mesma promessa em vez
   * de duplicar o processo.
   */
  iniciar() {
    if (this.rodando) return Promise.resolve(this.estado());
    if (!this._promessaIniciar) {
      this._promessaIniciar = this._iniciarInterno().finally(() => {
        this._promessaIniciar = null;
      });
    }
    return this._promessaIniciar;
  }

  async _iniciarInterno() {
    const marcador = this._marcador();
    if (!marcador) throw new Error('SearXNG embutido não está instalado');

    let porta = PORTA_PADRAO;
    try {
      porta = JSON.parse(fs.readFileSync(path.join(this.dirInstancia, 'porta.json'), 'utf8')).porta;
    } catch {
      /* usa a padrão */
    }

    const dirSitePackages =
      process.platform === 'win32'
        ? path.join(this.dirRuntime, 'python', 'Lib', 'site-packages')
        : path.join(this.dirRuntime, 'site-packages');
    // Autocura: instâncias instaladas ANTES desta correção (ver
    // garantirStubPwdWindows() acima) nunca tiveram o stub gravado — sem
    // isto aqui, elas continuariam morrendo com "No module named 'pwd'"
    // pra sempre, mesmo depois de atualizar o app, porque `instalar()` só
    // roda de novo se o usuário reinstalar de propósito.
    garantirStubPwdWindows(dirSitePackages);
    atualizarSettingsYml(path.join(this.dirInstancia, 'settings.yml'));

    const env = {
      ...process.env,
      SEARXNG_SETTINGS_PATH: path.join(this.dirInstancia, 'settings.yml'),
      PYTHONPATH: dirSitePackages,
    };

    this.ultimoLog = '';
    this.processo = spawn(...montarComando(marcador.pythonExecutavel, ['-m', 'searx.webapp']), {
      cwd: marcador.pastaSearx,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.processo.stdout.setEncoding('utf8');
    this.processo.stderr.setEncoding('utf8');
    this.processo.stderr.on('data', (texto) => {
      // acumula (não sobrescreve) — o erro que importa pode vir antes de
      // linhas de log benignas que chegam depois, e um `data` isolado não
      // pode apagar o que veio no anterior.
      this.ultimoLog = (this.ultimoLog + String(texto)).slice(-2000);
    });

    this._processoAtivo = true;
    this.processo.on('error', (err) => {
      this._processoAtivo = false;
      this._encerrar(`falha ao iniciar: ${err.message}`);
    });
    this.processo.on('exit', (codigo, sinal) => {
      this._processoAtivo = false;
      const motivo = sinal ? `processo encerrou (sinal ${sinal})` : `processo encerrou (código ${codigo})`;
      if (this.rodando || !this.erro) this._encerrar(`${motivo}${this.ultimoLog ? ` · ${this.ultimoLog.trim().slice(-300)}` : ''}`);
    });

    await this._esperarSaude(porta);
    this.rodando = true;
    this.porta = porta;
    this.erro = null;
    return this.estado();
  }

  async _esperarSaude(porta) {
    const limite = Date.now() + TIMEOUT_SAUDE_MS;
    while (Date.now() < limite) {
      if (!this.processo || this.processo.killed || !this._processoAtivo) {
        throw new Error(this.erro || 'o processo encerrou antes de responder');
      }
      try {
        const r = await fetch(`http://127.0.0.1:${porta}/`, { signal: AbortSignal.timeout(2000) });
        if (r.status < 500) return; // qualquer resposta HTTP (mesmo 404) já indica que subiu
      } catch {
        /* ainda não respondeu: tenta de novo */
      }
      await new Promise((r) => setTimeout(r, INTERVALO_SAUDE_MS));
    }
    this.parar();
    throw new Error(`SearXNG não respondeu em ${TIMEOUT_SAUDE_MS / 1000}s`);
  }

  _encerrar(motivo) {
    if (motivo && !this.erro) this.erro = motivo;
    this.rodando = false;
    this.porta = null;
  }

  async parar() {
    this._encerrar(null);
    try {
      this.processo?.kill();
    } catch {
      /* já morreu */
    }
    this.processo = null;
  }
}

module.exports = {
  RuntimeSearXNG,
  portaLivre,
  gerarSettingsYml,
  atualizarSettingsYml,
  extrairZipPara,
  habilitarSitePackages,
  adicionarAoPth,
  garantirStubPwdWindows,
  caminhoStubPwd,
};
