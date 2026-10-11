'use strict';

const path = require('path');
const { GerenciadorMCP, normalizarNome, converterArgumentos } = require('../../src/mcp');
const tools = require('../../src/tools');

const servidorDeTeste = (nome = 'ERP Teste') => ({
  nome,
  comando: process.execPath,
  argumentos: [path.join(__dirname, '..', 'fixtures', 'servidor-mcp.js')],
});

module.exports = [
  {
    nome: 'mcp: handshake, listagem e chamada de ferramenta',
    tipo: 'unidade',
    async executar() {
      const g = new GerenciadorMCP();
      try {
        const ferramentas = await g.conectar([servidorDeTeste()]);
        const estado = g.estado()[0];
        const busca = ferramentas.find((f) => f.name.includes('buscar_nota'));

        const resultado = await busca.run({ numero: '12345' });
        let erroTratado = '';
        try {
          await busca.run({});
        } catch (err) {
          erroTratado = err.message;
        }

        return [
          estado.conectado || `não conectou: ${g.problemas.join(' | ')}`,
          estado.servidor === 'servidor-teste' || `serverInfo não veio: ${estado.servidor}`,
          ferramentas.length === 2 || `anunciou ${ferramentas.length} ferramentas`,
          resultado.includes('12345') || `chamada devolveu: ${resultado}`,
          /obrigatório/.test(erroTratado) || `erro do servidor não propagou: ${erroTratado}`,
        ];
      } finally {
        await g.desconectar();
      }
    },
  },

  {
    nome: 'mcp: ferramenta remota entra no catálogo com risco alto',
    tipo: 'unidade',
    async executar() {
      const g = new GerenciadorMCP();
      try {
        const ferramentas = await g.conectar([servidorDeTeste()]);
        tools.registrarRemotas(ferramentas);

        const nome = ferramentas[0].name;
        const noCatalogo = tools.catalogo().includes(nome);
        const encontrada = tools.get(nome);
        const precisaAprovar = tools.precisaAprovacao(nome, { autonomy: 'guiado', alwaysAllow: [] });
        const desativavel = !tools.get(nome, [nome]);
        const inventario = tools.inventario([]).find((f) => f.name === nome);

        tools.registrarRemotas([]); // não deixa resíduo para os outros casos

        return [
          noCatalogo || 'ferramenta remota não apareceu no catálogo do prompt',
          Boolean(encontrada) || 'tools.get não encontra a ferramenta remota',
          // servidor externo roda com os privilégios do usuário: aprovação é obrigatória
          precisaAprovar || 'ferramenta MCP passou sem portão de aprovação',
          desativavel || 'não dá para desativar uma ferramenta remota',
          inventario?.origem === 'mcp' || `origem no inventário veio "${inventario?.origem}"`,
          inventario?.servidor === 'ERP Teste' || 'o painel não sabe de qual servidor a ferramenta veio',
        ];
      } finally {
        await g.desconectar();
      }
    },
  },

  {
    nome: 'mcp: servidor quebrado não derruba os demais',
    tipo: 'unidade',
    async executar() {
      const g = new GerenciadorMCP();
      try {
        const ferramentas = await g.conectar([
          { nome: 'Quebrado', comando: 'comando-que-nao-existe-em-lugar-nenhum', argumentos: [] },
          servidorDeTeste('Bom'),
        ]);
        return [
          g.problemas.length === 1 || `esperava 1 problema, houve ${g.problemas.length}`,
          g.problemas[0].startsWith('Quebrado:') || `problema mal atribuído: ${g.problemas[0]}`,
          ferramentas.length === 2 || 'as ferramentas do servidor bom se perderam',
          g.estado().length === 1 || 'servidor quebrado ficou registrado como conectado',
        ];
      } finally {
        await g.desconectar();
      }
    },
  },

  {
    nome: 'mcp: nomes e argumentos convertidos para o formato do registry',
    tipo: 'unidade',
    executar() {
      const nome = normalizarNome('ERP Teste', 'listar-clientes');
      const longo = normalizarNome('servidor-com-nome-muito-comprido', 'ferramenta-de-nome-igualmente-longo');
      const { args, obrigatorios } = converterArgumentos({
        type: 'object',
        properties: {
          numero: { type: 'string', description: 'número da nota' },
          limite: { type: 'number', description: 'quantos' },
        },
        required: ['numero'],
      });

      return [
        nome === 'erp_teste_listar_clientes' || `converteu para "${nome}"`,
        /^[a-z][a-z0-9_]{2,39}$/.test(nome) || 'nome não passa na validação do registry',
        /^[a-z][a-z0-9_]{2,39}$/.test(longo) || `nome longo não foi cortado: ${longo}`,
        obrigatorios.join() === 'numero' || 'não trouxe os obrigatórios do schema',
        /number/.test(args.limite) || 'perdeu o tipo do argumento não textual',
      ];
    },
  },
];
