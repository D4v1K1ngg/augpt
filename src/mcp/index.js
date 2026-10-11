'use strict';

const { ClienteMCP } = require('./cliente');

/**
 * Gerenciador dos servidores MCP.
 *
 * Converte cada ferramenta anunciada pelo servidor numa ferramenta do AuGPT,
 * com a mesma forma das outras — nome, descrição, argumentos e `run`. Assim o
 * catálogo, o portão de aprovação, o registro de execução e a bancada
 * continuam valendo sem saber que MCP existe.
 */

/** Nome de ferramenta precisa caber no padrão do registry: minúsculas e _. */
function normalizarNome(servidor, ferramenta) {
  const limpar = (t) =>
    String(t)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  // prefixo do servidor evita colisão entre dois servidores com a mesma função
  return `${limpar(servidor)}_${limpar(ferramenta)}`.slice(0, 40);
}

/** JSON Schema do MCP → o formato de argumentos que o catálogo mostra. */
function converterArgumentos(schema) {
  const propriedades = schema?.properties || {};
  const args = {};

  for (const [chave, valor] of Object.entries(propriedades)) {
    const tipo = Array.isArray(valor?.type) ? valor.type[0] : valor?.type;
    const descricao = valor?.description || `parâmetro ${chave}`;
    args[chave] = tipo && tipo !== 'string' ? `${descricao} (${tipo})` : descricao;
  }

  return { args, obrigatorios: Array.isArray(schema?.required) ? schema.required : [] };
}

class GerenciadorMCP {
  constructor() {
    this.clientes = new Map();
    this.problemas = [];
  }

  /**
   * Conecta os servidores configurados e devolve as ferramentas de todos.
   * Servidor que falha não derruba os outros — vira problema listado.
   */
  async conectar(servidores = []) {
    await this.desconectar();
    this.problemas = [];
    const ferramentas = [];

    for (const config of servidores) {
      if (!config?.nome || !config?.comando || config.ativo === false) continue;

      const cliente = new ClienteMCP({
        nome: config.nome,
        comando: config.comando,
        argumentos: config.argumentos || [],
        env: config.env || {},
        cwd: config.cwd,
        timeout: config.timeout || 30000,
      });

      try {
        const anunciadas = await cliente.conectar();
        this.clientes.set(config.nome, cliente);
        ferramentas.push(...anunciadas.map((f) => this.converter(config, cliente, f)));
      } catch (err) {
        this.problemas.push(`${config.nome}: ${err.message}`);
        cliente.desconectar();
      }
    }

    return ferramentas;
  }

  converter(config, cliente, ferramenta) {
    const { args, obrigatorios } = converterArgumentos(ferramenta.inputSchema);

    return {
      name: normalizarNome(config.nome, ferramenta.name),
      // O risco é ALTO por padrão, e não é excesso de zelo: o servidor é um
      // processo externo rodando com os privilégios do usuário, e o AuGPT não
      // tem como saber o que cada ferramenta faz. Quem confia marca como
      // sempre permitida no painel.
      risk: config.risco || 'alto',
      description: `[${config.nome}] ${ferramenta.description || ferramenta.name}`,
      args,
      obrigatorios,
      origem: 'mcp',
      servidor: config.nome,
      nomeRemoto: ferramenta.name,
      async run(argumentos) {
        if (!cliente.conectado) throw new Error(`o servidor "${config.nome}" não está conectado`);
        return cliente.chamar(ferramenta.name, argumentos);
      },
    };
  }

  estado() {
    return [...this.clientes.values()].map((c) => c.estado);
  }

  async desconectar() {
    for (const cliente of this.clientes.values()) cliente.desconectar();
    this.clientes.clear();
  }

  /** Testa uma configuração sem adicionar nada — usado pelo botão Testar. */
  async testar(config) {
    const cliente = new ClienteMCP({
      nome: config.nome || 'teste',
      comando: config.comando,
      argumentos: config.argumentos || [],
      env: config.env || {},
      timeout: 20000,
    });
    try {
      const ferramentas = await cliente.conectar();
      const estado = cliente.estado;
      return { ok: true, ...estado, nomes: ferramentas.map((f) => f.name).slice(0, 12) };
    } catch (err) {
      return { ok: false, erro: err.message };
    } finally {
      cliente.desconectar();
    }
  }
}

module.exports = { GerenciadorMCP, normalizarNome, converterArgumentos };
