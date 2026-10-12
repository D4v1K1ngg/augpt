'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Superfície mínima exposta ao renderer. Nada de `require`, `fs` ou `child_process`
 * do lado da interface — tudo passa por estes canais nomeados.
 */
contextBridge.exposeInMainWorld('augpt', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    restaurar: () => ipcRenderer.invoke('config:restaurar'),
  },
  ollama: {
    health: () => ipcRenderer.invoke('ollama:health'),
    // Fase 2: estado completo pra tela de primeira execução (ver src/primeiro-uso.js)
    diagnostico: () => ipcRenderer.invoke('ollama:diagnostico'),
    models: () => ipcRenderer.invoke('ollama:models'),
    iniciar: (lembrar) => ipcRenderer.invoke('ollama:iniciar', { lembrar }),
    pull: (nome) => ipcRenderer.invoke('ollama:pull', { nome }),
    copilotoStatus: () => ipcRenderer.invoke('ollama:copilotoStatus'),
    modelosCarregados: () => ipcRenderer.invoke('ollama:modelosCarregados'),
    saudeDaBusca: () => ipcRenderer.invoke('busca:saude'),
    maxModelosCarregados: () => ipcRenderer.invoke('ollama:maxModelosCarregados'),
    definirMaxModelosCarregados: (valor) => ipcRenderer.invoke('ollama:definirMaxModelosCarregados', { valor }),
    confirmarReinicioMaxModelos: () => ipcRenderer.invoke('ollama:confirmarReinicioMaxModelos'),
    reiniciar: () => ipcRenderer.invoke('ollama:reiniciar'),
  },
  hardware: {
    recomendacao: () => ipcRenderer.invoke('hardware:recomendacao'),
  },
  workspace: {
    choose: () => ipcRenderer.invoke('workspace:choose'),
    tree: () => ipcRenderer.invoke('workspace:tree'),
    read: (caminho) => ipcRenderer.invoke('workspace:read', caminho),
    open: () => ipcRenderer.invoke('workspace:open'),
    reveal: (caminho) => ipcRenderer.invoke('workspace:reveal', caminho),
  },
  memory: {
    stats: () => ipcRenderer.invoke('memory:stats'),
    clear: () => ipcRenderer.invoke('memory:clear'),
    operacional: () => ipcRenderer.invoke('memory:operacional'),
    esquecer: (chave, tipo) => ipcRenderer.invoke('memory:operacionalEsquecer', { chave, tipo }),
    central: () => ipcRenderer.invoke('memory:central'),
    centralEsquecer: (chave) => ipcRenderer.invoke('memory:centralEsquecer', chave),
    centralLimpar: () => ipcRenderer.invoke('memory:centralLimpar'),
  },
  agent: {
    // idConversa (Peça 3, "memória curta", 2026-09-19): opcional — null
    // quando a conversa ainda não foi salva (primeiro turno). Repassado até
    // Agent.run() pra escopar o que for lido nesta execução à conversa.
    start: (objetivo, conversa, idConversa) => ipcRenderer.invoke('agent:start', { objetivo, conversa, idConversa }),
    stop: () => ipcRenderer.invoke('agent:stop'),
    respond: (id, valor) => ipcRenderer.invoke('agent:respond', { id, valor }),
  },
  runs: {
    // Pedido de Davi 2026-09-23: abre a janela dedicada "Visualizar Execuções".
    abrirJanela: () => ipcRenderer.invoke('execucoes:abrirJanela'),
    // Fase 2: avisa a janela de Execuções quando uma execução nova é gravada.
    onAtualizadas: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('execucoes:atualizadas', listener);
      return () => ipcRenderer.removeListener('execucoes:atualizadas', listener);
    },
    list: (filtro) => ipcRenderer.invoke('runs:list', filtro),
    read: (id) => ipcRenderer.invoke('runs:read', id),
    stats: (filtro) => ipcRenderer.invoke('runs:stats', filtro),
    rate: (id, nota) => ipcRenderer.invoke('runs:rate', { id, nota }),
    remove: (id) => ipcRenderer.invoke('runs:delete', id),
    clear: (origem) => ipcRenderer.invoke('runs:clear', origem),
    export: () => ipcRenderer.invoke('runs:export'),
  },
  chats: {
    list: () => ipcRenderer.invoke('chats:list'),
    read: (id) => ipcRenderer.invoke('chats:read', id),
    save: (conversa) => ipcRenderer.invoke('chats:save', conversa),
    rename: (id, titulo) => ipcRenderer.invoke('chats:rename', { id, titulo }),
    remove: (ids) => ipcRenderer.invoke('chats:delete', ids),
    export: (id) => ipcRenderer.invoke('chats:export', id),
    // Item 2 da análise comparativa (2026-09-21, "comando manual de
    // compactação"): compacta a conversa `idConversa` agora, fora de
    // qualquer execução — ver electron/main.js, IPC 'chats:compact'.
    compact: (idConversa) => ipcRenderer.invoke('chats:compact', { idConversa }),
  },
  browser: {
    close: () => ipcRenderer.invoke('browser:close'),
    state: () => ipcRenderer.invoke('browser:state'),
  },
  domains: {
    stats: () => ipcRenderer.invoke('domains:stats'),
    save: (lista) => ipcRenderer.invoke('domains:save', lista),
    lookup: (dominio) => ipcRenderer.invoke('domains:lookup', dominio),
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    save: (servidores) => ipcRenderer.invoke('mcp:save', servidores),
    test: (servidor) => ipcRenderer.invoke('mcp:test', servidor),
    reconnect: () => ipcRenderer.invoke('mcp:reconnect'),
  },
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    toggle: (name, ativa) => ipcRenderer.invoke('tools:toggle', { name, ativa }),
    reload: () => ipcRenderer.invoke('tools:reload'),
    openFolder: () => ipcRenderer.invoke('tools:openFolder'),
    openFile: (name) => ipcRenderer.invoke('tools:openFile', name),
  },
  files: {
    attach: (modo) => ipcRenderer.invoke('files:attach', { modo }),
  },
  arquivos: {
    previa: (caminho) => ipcRenderer.invoke('arquivos:previa', caminho),
    salvarComo: (caminho) => ipcRenderer.invoke('arquivos:salvarComo', caminho),
    abrirExterno: (caminho) => ipcRenderer.invoke('arquivos:abrirExterno', caminho),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    read: (id) => ipcRenderer.invoke('skills:read', id),
    toggle: (id, ativa) => ipcRenderer.invoke('skills:toggle', { id, ativa }),
    reload: () => ipcRenderer.invoke('skills:reload'),
    create: (nome) => ipcRenderer.invoke('skills:create', nome),
    openFolder: () => ipcRenderer.invoke('skills:openFolder'),
    openFile: (id) => ipcRenderer.invoke('skills:openFile', id),
    preview: (texto) => ipcRenderer.invoke('skills:preview', texto),
    sugeridas: () => ipcRenderer.invoke('skills:sugeridas'),
    aprovarSugestao: (id) => ipcRenderer.invoke('skills:aprovarSugestao', id),
    descartarSugestao: (id) => ipcRenderer.invoke('skills:descartarSugestao', id),
  },
  searxngRuntime: {
    estado: () => ipcRenderer.invoke('searxngRuntime:estado'),
    instalar: () => ipcRenderer.invoke('searxngRuntime:instalar'),
    iniciar: () => ipcRenderer.invoke('searxngRuntime:iniciar'),
    parar: () => ipcRenderer.invoke('searxngRuntime:parar'),
    desinstalar: () => ipcRenderer.invoke('searxngRuntime:desinstalar'),
  },
  agendamentos: {
    list: () => ipcRenderer.invoke('agendamentos:list'),
    add: (dados) => ipcRenderer.invoke('agendamentos:add', dados),
    toggle: (id, ativo) => ipcRenderer.invoke('agendamentos:toggle', { id, ativo }),
    remove: (id) => ipcRenderer.invoke('agendamentos:remove', id),
  },
  chat: {
    send: (id, mensagens) => ipcRenderer.invoke('chat:send', { id, mensagens }),
    stop: () => ipcRenderer.invoke('chat:stop'),
    onToken: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('chat:token', listener);
      return () => ipcRenderer.removeListener('chat:token', listener);
    },
  },
  onEvent: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  sistema: {
    // Pedido de Davi 2026-09-14: checklist visível de IAs sendo descarregadas
    // antes da janela fechar de verdade — ver encerrarModelosEFechar,
    // electron/main.js. Canal próprio ('app:encerrando'), fora da lista fixa
    // de eventos do agente ('agent:event'), porque isto é ciclo de vida da
    // janela, não do agente.
    onEncerrando: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('app:encerrando', listener);
      return () => ipcRenderer.removeListener('app:encerrando', listener);
    },
  },
});
