#!/usr/bin/env node
// Servidor MCP mínimo para teste: fala JSON-RPC por stdio como manda o protocolo
const ferramentas = [
  { name: 'buscar_nota', description: 'Busca uma nota fiscal pelo número',
    inputSchema: { type: 'object', properties: { numero: { type: 'string', description: 'número da nota' } }, required: ['numero'] } },
  { name: 'listar-clientes', description: 'Lista clientes ativos',
    inputSchema: { type: 'object', properties: { limite: { type: 'number', description: 'quantos' } } } },
];
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (p) => {
  buffer += p;
  const linhas = buffer.split('\n'); buffer = linhas.pop() || '';
  for (const l of linhas) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    const responder = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
    if (m.method === 'initialize') responder({ protocolVersion: m.params.protocolVersion, serverInfo: { name: 'servidor-teste', version: '1.0' }, capabilities: { tools: {} } });
    else if (m.method === 'tools/list') responder({ tools: ferramentas });
    else if (m.method === 'tools/call') {
      if (m.params.name === 'buscar_nota' && !m.params.arguments?.numero) {
        responder({ isError: true, content: [{ type: 'text', text: 'número é obrigatório' }] });
      } else {
        responder({ content: [{ type: 'text', text: `resultado de ${m.params.name}: ${JSON.stringify(m.params.arguments)}` }] });
      }
    } else if (m.id) responder({});
  }
});
