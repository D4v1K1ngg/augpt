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
    modelosCarregados: () => ipcRenderer.invoke('ollama:modelosCarregados'),
    saudeDaBusca: () => ipcRenderer.invoke('busca:saude'),
    procurarNaRede: () => ipcRenderer.invoke('ollama:procurarNaRede'),
    testarServidor: (host) => ipcRenderer.invoke('ollama:testarServidor', { host }),
    exposicao: () => ipcRenderer.invoke('ollama:exposicao'),
  },
  // tela de boas-vindas (15/10)
  utilitarios: { listar: () => ipcRenderer.invoke('utilitarios:listar') },
  atualizacao: { verificar: () => ipcRenderer.invoke('atualizacao:verificar'), instalar: () => ipcRenderer.invoke('atualizacao:instalar') },
  imagem: {
    origem: (nome) => ipcRenderer.invoke('imagem:origem', { nome }),
    salvar: (nome, sugestao) => ipcRenderer.invoke('imagem:salvar', { nome, sugestao }),
    mostrarNaPasta: (caminho) => ipcRenderer.invoke('imagem:mostrarNaPasta', { caminho }),
  },
  // a voz do AuGPT (27/10)
  voz: {
    estado: () => ipcRenderer.invoke('voz:estado'),
    instalar: () => ipcRenderer.invoke('voz:instalar'),
    falar: (texto, opcoes = {}) => ipcRenderer.invoke('voz:falar', { texto, ...opcoes }),
    parar: () => ipcRenderer.invoke('voz:parar'),
    paralela: (dados) => ipcRenderer.invoke('voz:paralela', dados),
    aquecer: () => ipcRenderer.invoke('voz:aquecer'),
    narrar: (dados) => ipcRenderer.invoke('voz:narrar', dados),
  },
  ditado: {
    estado: () => ipcRenderer.invoke('ditado:estado'),
    instalar: () => ipcRenderer.invoke('ditado:instalar'),
    transcrever: (bytes) => ipcRenderer.invoke('ditado:transcrever', bytes),
    instalarEscuta: (modelo) => ipcRenderer.invoke('ditado:instalarEscuta', { modelo }),
    registroDaEscuta: () => ipcRenderer.invoke('ditado:registroDaEscuta'),
    limparRegistroDaEscuta: () => ipcRenderer.invoke('ditado:limparRegistroDaEscuta'),
    treinarFrase: (bytes) => ipcRenderer.invoke('ditado:treinarFrase', bytes),
    salvarTreino: (dados) => ipcRenderer.invoke('ditado:salvarTreino', dados),
    apagarTreino: () => ipcRenderer.invoke('ditado:apagarTreino'),
    aprenderChamada: (texto) => ipcRenderer.invoke('ditado:aprenderChamada', texto),
    esquecerVariante: (variante) => ipcRenderer.invoke('ditado:esquecerVariante', variante),
    vozDoUsuario: () => ipcRenderer.invoke('ditado:vozDoUsuario'),
    chamada: (bytes, pelaVoz) => ipcRenderer.invoke('ditado:chamada', bytes, pelaVoz),
    pedidoDeVoz: (bytes) => ipcRenderer.invoke('ditado:pedidoDeVoz', bytes),
    corrigir: (texto) => ipcRenderer.invoke('ditado:corrigir', texto),
    trazerJanela: () => ipcRenderer.invoke('janela:trazer'),
  },
  fundo: {
    listar: () => ipcRenderer.invoke('fundo:listar'),
    detectar: (texto) => ipcRenderer.invoke('fundo:detectar', texto),
    adicionar: (objetivo) => ipcRenderer.invoke('fundo:adicionar', objetivo),
    responder: (id, valor) => ipcRenderer.invoke('fundo:responder', { id, valor }),
    remover: (id) => ipcRenderer.invoke('fundo:remover', id),
  },
  remoto: {
    estado: () => ipcRenderer.invoke('remoto:estado'),
    novoCodigo: () => ipcRenderer.invoke('remoto:novoCodigo'),
  },
  tela: {
    capturar: (opcoes) => ipcRenderer.invoke('tela:capturar', opcoes),
    atalho: () => ipcRenderer.invoke('tela:atalho'),
  },
  agenda: {
    listar: () => ipcRenderer.invoke('agenda:listar'),
    adicionar: (dados) => ipcRenderer.invoke('agenda:adicionar', dados),
    atualizar: (id, mudancas) => ipcRenderer.invoke('agenda:atualizar', { id, mudancas }),
    remover: (id) => ipcRenderer.invoke('agenda:remover', id),
    conferirAgora: (id) => ipcRenderer.invoke('agenda:conferirAgora', id),
  },
  novidades: { pendentes: () => ipcRenderer.invoke('novidades:pendentes'), ler: (versao) => ipcRenderer.invoke('novidades:ler', { versao }) },
  componentes: {
    estado: () => ipcRenderer.invoke('componentes:estado'),
    atualizarOllama: () => ipcRenderer.invoke('componentes:atualizarOllama'),
    instalarYtdlp: () => ipcRenderer.invoke('componentes:instalarYtdlp'),
    voltarYtdlp: () => ipcRenderer.invoke('componentes:voltarYtdlp'),
    instalarTesseract: () => ipcRenderer.invoke('componentes:instalarTesseract'),
    instalarImagem: () => ipcRenderer.invoke('componentes:instalarImagem'),
    voltarImagem: () => ipcRenderer.invoke('componentes:voltarImagem'),
    testarPlaca: () => ipcRenderer.invoke('componentes:testarPlaca'),
  },
  boasVindas: {
    verificar: () => ipcRenderer.invoke('boasVindas:verificar'),
    instalarOllama: () => ipcRenderer.invoke('boasVindas:instalarOllama'),
    ligarOllama: () => ipcRenderer.invoke('boasVindas:ligarOllama'),
    concluir: (dados) => ipcRenderer.invoke('boasVindas:concluir', dados),
  },
  hardware: {
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
    centralInstrucao: (assunto, instrucao) => ipcRenderer.invoke('memory:centralInstrucao', { assunto, instrucao }),
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
    export: (ids) => ipcRenderer.invoke('runs:export', ids),
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
