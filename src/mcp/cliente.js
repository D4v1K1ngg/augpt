'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/**
 * Cliente MCP (Model Context Protocol) sobre stdio.
 *
 * MCP é JSON-RPC 2.0 com mensagens delimitadas por quebra de linha. São três
 * chamadas que importam: `initialize`, `tools/list` e `tools/call`. Por isso o
 * cliente cabe em um arquivo e não traz dependência nenhuma — o que mantém a
 * promessa do projeto.
 *
 * O ganho: cada servidor MCP que o usuário configurar entrega um punhado de
 * ferramentas prontas, sem eu escrever integração nenhuma.
 */

const VERSOES = ['2025-06-18', '2024-11-05']; // tenta a nova, cai para a antiga
const TEMPO_LIMITE = 30000;

class ClienteMCP extends EventEmitter {
  constructor({ nome, comando, argumentos = [], env = {}, cwd, timeout = TEMPO_LIMITE }) {
    super();
    this.nome = nome;
    this.comando = comando;
    this.argumentos = argumentos;
    this.env = env;
    this.cwd = cwd;
    this.timeout = timeout;

    this.processo = null;
    this.conectado = false;
    this.morto = false;
    this.ferramentas = [];
    this.servidor = null;
    this.erro = null;

    this.proximoId = 1;
    this.pendentes = new Map();
    this.buffer = '';
  }

  /* ------------------------------ transporte ------------------------------ */

  iniciar() {
    if (this.processo) return;

    this.processo = spawn(this.comando, this.argumentos, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.processo.stdout.setEncoding('utf8');
    this.processo.stdout.on('data', (pedaco) => this.receber(pedaco));

    // servidor bem-comportado usa stderr para log; guardamos para diagnóstico
    this.processo.stderr.setEncoding('utf8');
    this.processo.stderr.on('data', (texto) => {
      this.ultimoLog = String(texto).slice(-400);
    });

    // Comando inexistente ou processo que morre no arranque precisa falhar na
    // hora. Sem isto, cada tentativa de handshake esperava o tempo limite
    // inteiro, e um servidor mal configurado travava a abertura do app.
    this.processo.on('error', (err) => {
      this.morto = true;
      this.encerrar(`falha ao iniciar: ${err.message}`);
    });
    this.processo.on('exit', (codigo) => {
      this.morto = true;
      this.encerrar(`processo encerrou (código ${codigo})`);
    });
  }

  receber(pedaco) {
    this.buffer += pedaco;
    const linhas = this.buffer.split('\n');
    this.buffer = linhas.pop() || '';

    for (const linha of linhas) {
      const texto = linha.trim();
      if (!texto || texto[0] !== '{') continue; // ruído no stdout é ignorado
      let mensagem;
      try {
        mensagem = JSON.parse(texto);
      } catch {
        continue;
      }
      const pendente = this.pendentes.get(mensagem.id);
      if (!pendente) continue;
      this.pendentes.delete(mensagem.id);
      clearTimeout(pendente.cronometro);
      if (mensagem.error) pendente.rejeitar(new Error(mensagem.error.message || 'erro do servidor MCP'));
      else pendente.resolver(mensagem.result);
    }
  }

  enviar(metodo, parametros = {}, { notificacao = false } = {}) {
    if (!this.processo || this.processo.killed || this.morto) {
      return Promise.reject(new Error(this.erro || 'servidor não está rodando'));
    }

    const mensagem = { jsonrpc: '2.0', method: metodo, params: parametros };
    if (notificacao) {
      this.processo.stdin.write(`${JSON.stringify(mensagem)}\n`);
      return Promise.resolve();
    }

    const id = this.proximoId;
    this.proximoId += 1;
    mensagem.id = id;

    return new Promise((resolver, rejeitar) => {
      const cronometro = setTimeout(() => {
        this.pendentes.delete(id);
        rejeitar(new Error(`${metodo} não respondeu em ${this.timeout / 1000}s`));
      }, this.timeout);

      this.pendentes.set(id, { resolver, rejeitar, cronometro });
      this.processo.stdin.write(`${JSON.stringify(mensagem)}\n`);
    });
  }

  encerrar(motivo) {
    if (motivo && !this.erro && !this.conectado) this.erro = motivo;
    this.conectado = false;
    for (const [, p] of this.pendentes) {
      clearTimeout(p.cronometro);
      p.rejeitar(new Error(motivo || 'conexão encerrada'));
    }
    this.pendentes.clear();
  }

  /* ------------------------------ protocolo ------------------------------ */

  async conectar() {
    this.iniciar();

    let ultimoErro = null;
    for (const versao of VERSOES) {
      if (this.morto) break; // processo já caiu: não adianta tentar outra versão
      try {
        this.servidor = await this.enviar('initialize', {
          protocolVersion: versao,
          capabilities: {},
          clientInfo: { name: 'AuGPT', version: '1.0.0' },
        });
        await this.enviar('notifications/initialized', {}, { notificacao: true });
        this.conectado = true;
        this.erro = null;
        break;
      } catch (err) {
        ultimoErro = err;
      }
    }

    if (!this.conectado) {
      this.erro = `handshake falhou: ${ultimoErro?.message || 'sem resposta'}${
        this.ultimoLog ? ` · ${this.ultimoLog.trim().slice(-160)}` : ''
      }`;
      this.desconectar();
      throw new Error(this.erro);
    }

    this.ferramentas = await this.listarFerramentas();
    return this.ferramentas;
  }

  async listarFerramentas() {
    const r = await this.enviar('tools/list', {});
    return Array.isArray(r?.tools) ? r.tools : [];
  }

  /** Devolve o resultado já achatado em texto, que é o que o agente consome. */
  async chamar(nome, argumentos = {}) {
    const r = await this.enviar('tools/call', { name: nome, arguments: argumentos });

    const partes = (r?.content || [])
      .map((item) => {
        if (item?.type === 'text') return item.text;
        if (item?.type === 'resource') return item.resource?.text || `[recurso: ${item.resource?.uri || '?'}]`;
        if (item?.type === 'image') return '[imagem devolvida pelo servidor, não exibível aqui]';
        return '';
      })
      .filter(Boolean);

    const texto = partes.join('\n').trim();
    if (r?.isError) throw new Error(texto || 'o servidor MCP sinalizou erro');
    return texto || '(o servidor respondeu sem conteúdo)';
  }

  desconectar() {
    this.encerrar('desconectado');
    try {
      this.processo?.kill();
    } catch {
      /* já morreu */
    }
    this.processo = null;
  }

  get estado() {
    return {
      nome: this.nome,
      conectado: this.conectado,
      erro: this.erro,
      servidor: this.servidor?.serverInfo?.name || null,
      versao: this.servidor?.protocolVersion || null,
      ferramentas: this.ferramentas.length,
    };
  }
}

module.exports = { ClienteMCP, VERSOES };
