'use strict';

/* Idiomas (22/10, pedido do Davi): português e inglês. O texto da tela continua escrito em
 * português no HTML e no JS; aqui fica só o inglês, com a frase em português como chave.
 *  - tr('frase', {n}) traduz uma frase do código (com {variáveis});
 *  - em inglês, todo nó de texto e placeholder/title/aria-label cujo texto inteiro está no
 *    dicionário é trocado sozinho, inclusive o que aparece depois (MutationObserver). A resposta
 *    do agente (.msg-corpo) e o que o usuário escreve nunca são tocados.
 * O idioma: o escolhido (Ajustes → Geral ou boas-vindas) ou, sem escolha, o do Windows.
 * Roda no <head>, antes de pintar (como tema.js). Fase 1: tela principal e boas-vindas. */
(() => {
  const CHAVE = 'augpt:idioma'; // '' (automático) | 'pt' | 'en'
  const PULAR = '.msg-corpo, .md, [data-sem-traducao], script, style, textarea, code, pre, #listaConversas .titulo';
  const PULAR_ATRIBUTOS = '.msg-corpo, .md, [data-sem-traducao]';
  const ATRIBUTOS = ['placeholder', 'title', 'aria-label'];

  const EN = {
    /* ---------- barra do topo e painel de execução ---------- */
    'Agente': 'Agent', 'Conversa': 'Chat', 'Skills': 'Skills', 'Utilitários': 'Utilities', 'Execuções': 'Runs', 'Ajustes': 'Settings',
    'carregando…': 'loading…', 'verificando…': 'checking…', 'modelos': 'models', 'busca': 'search', 'modelo': 'model', 'pesquisa': 'research',
    'automático · produto pesquisa a fundo': 'automatic · products get deep research',
    'rápido · 1 ou 2 buscas, segundos': 'quick · 1 or 2 searches, seconds',
    'normal · várias buscas e leituras': 'normal · several searches and reads',
    'profundo · muitos ângulos e fontes, mais lento': 'deep · many angles and sources, slower',
    'investigação · você dá o tempo; relatório em PDF': 'investigation · you set the time; PDF report',
    'autonomia (tarefas)': 'autonomy (tasks)',
    'manual · confirma tudo': 'manual · confirms everything',
    'guiado · confirma o que é arriscado': 'guided · confirms what is risky',
    'automático · não pergunta': 'automatic · never asks',
    'raciocínio (tarefas)': 'reasoning (tasks)',
    'leve · rápido, esforço padrão': 'light · fast, standard effort',
    'médio · sempre planeja, busca mais fontes': 'medium · always plans, more sources',
    'alto · pesquisa a fundo, crítico revisa cada parte': 'high · deep research, critic reviews each part',
    'extremo · máximo esforço, bem mais lento': 'extreme · maximum effort, much slower',
    'resposta': 'answer', 'direta': 'direct', 'detalhada': 'detailed', 'técnica': 'technical',
    'pronto': 'ready', 'passos': 'steps', 'tokens': 'tokens', 'decorrido': 'elapsed', 'contexto': 'context',
    'Modelo, autonomia, raciocínio e estado do Ollama': 'Model, autonomy, reasoning and Ollama status',
    'Estado do servidor Ollama': 'Ollama server status',
    'Ver onde cada modelo está rodando (GPU ou CPU)': 'See where each model is running (GPU or CPU)',
    'Modelo de IA usado pelo agente e pela conversa': 'AI model used by the agent and the chat',
    'Modelo de IA': 'AI model',
    'Pesquisa: quanto o agente pesquisa antes de responder (o mesmo seletor da tela inicial)': 'Research: how much the agent searches before answering (same selector as the home screen)',
    'Profundidade da pesquisa': 'Research depth',
    'Autonomia: o que o agente pode fazer sem pedir sua confirmação, em tarefas com arquivo, pasta, site ou comando': 'Autonomy: what the agent may do without asking, in tasks with files, folders, sites or commands',
    'Autonomia do agente': 'Agent autonomy',
    'Raciocínio: quanto esforço o agente põe em cada pedido (mais esforço, mais lento)': 'Reasoning: how much effort the agent puts into each request (more effort, slower)',
    'Nível de raciocínio': 'Reasoning level',
    'Como a resposta deve ser escrita': 'How the answer should be written',
    'Modo da resposta': 'Answer mode',
    'Progresso, arquivos e parágrafos': 'Progress, files and paragraphs',
    'Mostrar ou ocultar a coluna da direita': 'Show or hide the right column',
    'Tema claro ou escuro': 'Light or dark theme',
    'Alternar tema claro e escuro': 'Toggle light and dark theme',
    'quanto da janela de contexto o último passo usou': 'how much of the context window the last step used',
    'Ocultar painel (Ctrl+B)': 'Hide panel (Ctrl+B)', 'Ocultar painel': 'Hide panel',

    /* ---------- faixas ---------- */
    'Detectei que o Ollama está desligado. Deseja que eu ative ele?': 'Ollama seems to be off. Do you want me to start it?',
    'sempre iniciar automaticamente, não perguntar de novo': 'always start it automatically, don\'t ask again',
    'Sim, ativar': 'Yes, start it', 'Não': 'No',
    'Atualizar agora': 'Update now', 'Novidades': 'What\'s new', 'Depois': 'Later', 'Pular esta versão': 'Skip this version',
    'AuGPT {versao} disponível (você está na {atual}).': 'AuGPT {versao} is available (you have {atual}).',
    // imagens das respostas (23/10)
    'Abrir imagem': 'Open image', 'Baixar imagem': 'Download image', 'Ver na fonte original': 'View original source',
    'Opções da imagem': 'Image options', 'Baixar ou ver na fonte': 'Download or view source', 'salva — mostrar na pasta': 'saved — show in folder',
    'não consegui salvar ({erro})': "couldn't save ({erro})",
    // janela Novidades (23/10)
    'Novidades do AuGPT': 'What\'s new in AuGPT', 'Novidades do AuGPT {versao}': 'What\'s new in AuGPT {versao}',
    'Ver novidades': "See what's new", 'Novidades da versão nova': 'What\'s new in the new version', 'Ver no GitHub': 'View on GitHub',
    'Esta versão não trouxe notas.': 'This version has no notes.', 'As notas desta versão estão na página dela no GitHub.': "This version's notes are on its GitHub page.", 'O AuGPT foi atualizado': 'AuGPT was updated',
    'Não consegui ler as novidades desta versão ({erro}).': 'I couldn\'t read this version\'s notes ({erro}).',
    'Você está na {atual}. Isto chega quando você atualizar.': 'You have {atual}. This arrives when you update.',
    'Você está na versão {atual}.': 'You have version {atual}.', 'Bem-vindo à versão {atual}. Veja o que mudou:': 'Welcome to version {atual}. Here\'s what changed:',

    /* ---------- lateral ---------- */
    'agente local': 'local agent', 'Nova conversa': 'New chat', 'Excluir': 'Delete', 'Cancelar': 'Cancel',
    'Selecionar várias': 'Select several', 'Selecionar várias conversas': 'Select several chats', 'Buscar conversa…': 'Search chats…',
    '{n} selecionadas': '{n} selected', '0 selecionadas': '0 selected',
    'Renomear': 'Rename', 'Exportar .md': 'Export .md', 'Compactar': 'Compact', 'Selecionar': 'Select', 'Excluir conversa': 'Delete chat',
    'agora': 'now', 'há {n} min': '{n} min ago', 'há {n} h': '{n} h ago', 'ontem': 'yesterday',

    /* ---------- tela inicial e caixa de mensagem ---------- */
    'O que você precisa?': 'What do you need?',
    'O que você precisa, {nome}?': 'What do you need, {nome}?',
    'Descreva a tarefa. O agente decide os passos e roda no seu computador.': 'Describe the task. The agent plans the steps and runs on your computer.',
    'Pesquisa': 'Research', 'Automático': 'Automatic', 'Rápido': 'Quick', 'Normal': 'Normal', 'Profundo': 'Deep', 'Investigação': 'Investigation', 'min': 'min',
    'Recursos do AuGPT': 'AuGPT features', 'Recurso anterior': 'Previous feature', 'Recursos': 'Features', 'Próximo recurso': 'Next feature',
    'Pausar a rotação': 'Pause rotation', 'Como o agente responde': 'How the agent answers',
    'O agente escolhe: produto pesquisa a fundo, o resto pesquisa normal': 'The agent decides: products get deep research, everything else normal',
    'Uma ou duas buscas e a resposta em segundos': 'One or two searches and the answer in seconds',
    'Várias buscas e leituras (pelo menos 2 buscas)': 'Several searches and reads (at least 2 searches)',
    'Pesquisa de vários ângulos: pelo menos 5 buscas e até 10 páginas lidas. Mais lento': 'Research from several angles: at least 5 searches and up to 10 pages read. Slower',
    'Você dá o tempo e o AuGPT pesquisa o tema por partes até ele acabar; entrega um resumo aqui e o relatório completo em PDF': 'You set the time and AuGPT researches the topic in parts until it runs out; a summary here and the full report as a PDF',
    'Quanto tempo o AuGPT pode pesquisar': 'How long AuGPT may research', 'Minutos de investigação': 'Investigation minutes',
    'Anexar arquivos': 'Attach files', 'Peça alguma coisa ao agente…': 'Ask the agent something…',
    'Raciocínio da próxima resposta': 'Reasoning for the next answer', 'Enviar (Enter)': 'Send (Enter)', 'Enviar': 'Send',
    'Anexar arquivos de texto': 'Attach text files', 'Pergunte alguma coisa…': 'Ask something…',
    'Antes de começar': 'Before you start',
    'O AuGPT usa o Ollama pra rodar a inteligência artificial no seu próprio computador. Falta pouco:': 'AuGPT uses Ollama to run the AI on your own computer. Almost there:',
    'Instalar o Ollama': 'Install Ollama', 'Um programa gratuito que roda os modelos de IA no computador.': 'A free program that runs AI models on your computer.',
    'Deixar o Ollama aberto': 'Keep Ollama open', 'Ele precisa estar rodando enquanto você usa o AuGPT.': 'It must be running while you use AuGPT.',
    'Baixar um modelo de IA': 'Download an AI model', 'É o "cérebro" que o agente usa. Baixa uma vez só.': 'It is the "brain" the agent uses. Downloaded only once.',
    'Converse com o modelo': 'Chat with the model',
    'Sem agente, sem ferramentas — pergunta e resposta direto no modelo que está rodando na sua máquina. Para tarefas que exigem pesquisar, ler documentos ou criar arquivos, use a aba Agente.': 'No agent, no tools: questions and answers straight from the model running on your machine. For tasks that need research, reading documents or creating files, use the Agent tab.',

    /* carrossel */
    'Pesquisa que você regula': 'Research you control',
    'Do rápido à investigação com relatório em PDF. O agente cruza fontes, confere os números e prefere os sites confiáveis.': 'From quick to a full investigation with a PDF report. The agent cross-checks sources, verifies numbers and prefers reliable sites.',
    'Quais os melhores fones intra-auriculares para PUBG até R$ 300?': 'What are the best in-ear headphones for PUBG under $60?',
    'Investigação': 'Investigation',
    'Você vê o que o agente decidiu': 'You see what the agent decided',
    'Etapas, sites consultados e raciocínio ficam na conversa. Dá para conferir como a resposta foi montada.': 'Steps, sites consulted and reasoning stay in the chat, so you can check how the answer was built.',
    'Qual a previsão do tempo para Vitória-ES nesta semana?': 'What is the weather forecast for London this week?',
    'Entendeu o pedido': 'Understood the request', 'previsão, Vitória-ES, 7 dias': 'forecast, London, 7 days',
    'Buscou em 3 fontes': 'Searched 3 sources', 'inmet.gov.br, climatempo, open-meteo': 'metoffice.gov.uk, bbc weather, open-meteo',
    'Comparou as previsões': 'Compared the forecasts', 'chuva só na quinta, nas três': 'rain only on Thursday, in all three',
    'Escrevendo a resposta': 'Writing the answer', 'com as fontes no final': 'with the sources at the end',
    'Conhece o seu computador': 'Knows your computer',
    'Espaço, configuração, drivers, periféricos e o que mais você perguntar. Só lê: nada é mudado e nada sai do PC.': 'Disk space, specs, drivers, peripherals and whatever else you ask. Read-only: nothing is changed and nothing leaves your PC.',
    'meu driver do chipset está atualizado?': 'is my chipset driver up to date?',
    'Unidade C:': 'Drive C:', '94 GB livres de 476 GB': '94 GB free of 476 GB', 'Placa de vídeo': 'Graphics card',
    'driver de setembro, em dia': 'September driver, up to date', 'Chipset AMD': 'AMD chipset', '8.08.12.551, o mais novo': '8.08.12.551, the latest',
    'Mouse e teclado': 'Mouse and keyboard', 'pelo nome de fábrica': 'by their factory name',
    'Mede a sua internet de verdade': 'Measures your real internet speed',
    'Velocidade, ping e bufferbloat, a rota até o servidor do seu jogo e quem está usando a rede da casa.': 'Speed, ping and bufferbloat, the route to your game server and who is using your home network.',
    'teste minha internet': 'test my internet', 'Mbps de download': 'Mbps download', 'de ping': 'ping',
    'PUBG São Paulo · 18 ms': 'PUBG Europe · 18 ms', 'raio-X do roteador': 'router X-ray', '13 aparelhos na rede': '13 devices on the network',
    'Lê o que você anexa, entrega o que você precisa': 'Reads what you attach, delivers what you need',
    'Anexe PDF, planilha ou imagem. O agente analisa e devolve Word, Excel, PDF ou página HTML prontos.': 'Attach a PDF, spreadsheet or image. The agent analyzes it and returns ready Word, Excel, PDF or HTML files.',
    'Analise o boleto que anexei e diga o que muda se eu atrasar': 'Analyze the bill I attached and tell me what changes if I pay late',
    'boleto': 'bill', 'resumo': 'summary', 'planilha': 'spreadsheet', 'relatório': 'report',
    'Resposta que vira gráfico': 'Answers that become charts',
    'Números viram gráficos interativos na própria conversa, e ideias viram páginas interativas numa área isolada.': 'Numbers become interactive charts right in the chat, and ideas become interactive pages in an isolated area.',
    'monte um gráfico com o preço da RTX 5080 desde o lançamento': 'chart the RTX 5080 price since launch',
    'mai': 'May', 'jun': 'Jun', 'jul': 'Jul', 'ago': 'Aug', 'set': 'Sep', 'out': 'Oct',
    'Um agente com ferramentas de verdade': 'An agent with real tools',
    'Utilitários para a rede e o PC, skills e ferramentas embutidas, e servidores MCP para ligar o AuGPT aos seus programas.': 'Network and PC utilities, built-in skills and tools, and MCP servers to connect AuGPT to your apps.',
    'o que você pode fazer?': 'what can you do?', 'utilitários': 'utilities', 'skills': 'skills', 'servidores seus': 'your servers',
    'Buscar na web': 'Web search', 'Ler PDF': 'Read PDFs', 'Planilhas': 'Spreadsheets', 'Criar Word': 'Create Word', 'Gráficos': 'Charts', 'Ler o PC': 'Read the PC', 'Servidor MCP': 'MCP server',
    'Modelo local, sem enviar sua conversa': 'Local model, your chats stay with you',
    'O AuGPT usa o Ollama no seu PC, ou no de outro computador da sua casa. Só as buscas na web saem da máquina.': 'AuGPT uses Ollama on your PC, or on another computer at home. Only web searches leave the machine.',
    'qual a configuração do meu pc?': 'what are my PC specs?', 'Seu computador': 'Your computer', 'Nuvem de IA': 'AI cloud', 'não usada': 'not used',
    '{i} de {n}': '{i} of {n}',

    /* ---------- cada resposta ---------- */
    'você': 'you', 'agente': 'agent', 'preparando…': 'preparing…', 'parar': 'stop',
    'Atividade do agente': 'Agent activity', 'Sites consultados': 'Sites consulted', 'raciocínio': 'reasoning',
    'raciocínio · {n} passo': 'reasoning · {n} step', 'raciocínio · {n} passos': 'reasoning · {n} steps',
    'Entendendo o pedido': 'Understanding the request', 'responde sem pesquisar': 'answers without searching',
    'Pesquisando na internet': 'Searching the web', 'Planejando a pesquisa': 'Planning the research', 'Executando ações': 'Taking actions',
    'Comparando as opções encontradas': 'Comparing the options found', 'Conferindo as evidências de cada opção': 'Checking the evidence for each option',
    'Conferindo a resposta com as fontes': 'Checking the answer against the sources',
    'Busca: {q}': 'Search: {q}', 'Critérios: {c}': 'Criteria: {c}', 'Na frente: {c}': 'Leading: {c}', 'A partir de {n} fonte(s)': 'From {n} source(s)',
    '{p}% dos critérios com evidência': '{p}% of the criteria backed by evidence', 'pesquisa {modo}': '{modo} research',
    '{n} busca': '{n} search', '{n} buscas': '{n} searches', '{n} resultado vistos': '{n} result seen', '{n} resultados vistos': '{n} results seen',
    '{n} página em {s} site': '{n} page on {s} site', '{n} página em {s} sites': '{n} page on {s} sites', '{n} páginas em {s} site': '{n} pages on {s} site', '{n} páginas em {s} sites': '{n} pages on {s} sites',
    '{n} página ✓': '{n} page ✓', '{n} páginas ✓': '{n} pages ✓',
    'pensando · {modelo}': 'thinking · {modelo}', 'passo {n} de {de}': 'step {n} of {de}', 'raciocinando…': 'reasoning…',
    'executando {nome}': 'running {nome}', 'aguardando sua confirmação': 'waiting for your confirmation', 'o agente fez uma pergunta': 'the agent asked a question',
    'redigindo a resposta a partir de {n} fonte(s)…': 'writing the answer from {n} source(s)…',
    '{n} passos · {f} fonte(s)': '{n} steps · {f} source(s)',
    'Parei em {n} passos sem concluir.': 'I stopped after {n} steps without finishing.',
    'Aumente o limite em Ajustes ou peça algo mais específico.': 'Raise the limit in Settings or ask for something more specific.',
    'Interrompido por você após {n} passos.': 'Stopped by you after {n} steps.',
    'mostrar tudo': 'show all',
    '{p} passos · {f} ferramentas · {fo} fontes · {s}s · {t} tokens': '{p} steps · {f} tools · {fo} sources · {s}s · {t} tokens', '{n} erros': '{n} errors',
    'sem modelo': 'no model', 'Ollama desligado · {resto}': 'Ollama off · {resto}', 'investigação {n} min': 'investigation {n} min', 'Você': 'You', 'Copiar': 'Copy', 'copiado ✓': 'copied ✓',

    /* ---------- lateral direita e janelas ---------- */
    'Progresso': 'Progress', 'Nenhum plano ativo no momento.': 'No active plan right now.', 'Arquivos': 'Files', 'Você enviou': 'You sent', 'AuGPT gerou': 'AuGPT created',
    'Nenhum arquivo gerado ou anexado ainda nesta conversa.': 'No files created or attached in this chat yet.', 'Parágrafos': 'Paragraphs',
    'Nenhuma pergunta ainda nesta conversa.': 'No questions in this chat yet.', 'Ocultar': 'Hide',
    'Ocultar card Progresso': 'Hide Progress card', 'Ocultar card Arquivos': 'Hide Files card', 'Ocultar card Parágrafos': 'Hide Paragraphs card',
    'Onde cada modelo está rodando agora': 'Where each model is running now', 'Atualizar': 'Refresh', 'Fechar': 'Close', 'Skill': 'Skill',
    'Mostrar arquivo': 'Show file', 'Arquivo': 'File', 'Abrir com o app padrão': 'Open with the default app', 'Salvar como…': 'Save as…', 'Abrir': 'Open',
    'Encerrando o AuGPT…': 'Closing AuGPT…',
    'Descarregando as IAs em memória antes de fechar, pra liberar os recursos do PC.': 'Unloading the AI models from memory before closing, to free up your PC.',

    /* ---------- boas-vindas ---------- */
    'Bem-vindo ao AuGPT': 'Welcome to AuGPT',
    'Seu agente de IA que roda no seu computador: pesquisa na web, lê o seu PC (só leitura) e responde com as fontes.': 'Your AI agent that runs on your computer: it searches the web, reads your PC (read-only) and answers with sources.',
    'Idioma': 'Language', 'Detectado no Windows: {idioma}': 'Detected from Windows: {idioma}', 'Português': 'Português', 'English': 'English',
    'Como você quer ser chamado?': 'What should we call you?', 'opcional': 'optional', 'Seu nome': 'Your name',
    'O AuGPT usa o nome para falar com você. Fica só neste computador.': 'AuGPT uses your name when talking to you. It stays on this computer.',
    'Continuar': 'Continue', 'Voltar': 'Back', 'Pular por enquanto': 'Skip for now', 'Verificar de novo': 'Check again', 'Começar a usar': 'Start using AuGPT',
    'Boas-vindas': 'Welcome', 'Seu computador': 'Your computer', 'Tudo pronto': 'All set',
    'Vamos preparar o seu computador': 'Let\'s get your computer ready',
    'O AuGPT confere o que já tem e mostra o que falta. Nada é instalado sem você clicar.': 'AuGPT checks what you already have and shows what is missing. Nothing is installed until you click.',
    'Essencial': 'Essential', 'Opcional': 'Optional',
    'Tudo pronto!': 'All set!', 'Tudo pronto, {nome}!': 'All set, {nome}!',
    'O AuGPT está pronto para pesquisar, conferir e responder. Para começar, experimente:': 'AuGPT is ready to research, verify and answer. To start, try:',
    'Privado': 'Private', 'O modelo roda no seu PC; só as buscas na web saem dele.': 'The model runs on your PC; only web searches leave it.',
    'Pesquisa de verdade': 'Real research', 'Lê várias fontes, cruza os números e mostra de onde veio cada informação.': 'Reads several sources, cross-checks the numbers and shows where each fact came from.',
    'Ferramentas': 'Tools', 'Testa a internet, lê o seu PC, cria gráficos, documentos e imagens.': 'Tests your internet, reads your PC, creates charts, documents and images.',
    'Verificando o computador…': 'Checking your computer…', 'Não consegui verificar o computador': 'I could not check your computer',
    'Processador': 'Processor', 'Memória RAM': 'RAM', 'Espaço livre': 'Free space', '{n} núcleos': '{n} cores', '{gb} (disco dos modelos)': '{gb} (models drive)',
    'nenhuma placa de vídeo com memória dedicada encontrada': 'no graphics card with dedicated memory found',
    'Ollama (o programa que roda a IA)': 'Ollama (the program that runs the AI)', 'Instalado e ligado.': 'Installed and running.', 'Instalado, mas desligado.': 'Installed, but not running.',
    'Não está instalado. O AuGPT instala pelo winget (pacote oficial) ou pelo instalador oficial do site ollama.com.': 'Not installed. AuGPT installs it with winget (official package) or the official installer from ollama.com.',
    'Não está instalado. No Mac e no Linux a instalação pede senha de administrador; clique para ver como instalar.': 'Not installed. On Mac and Linux the install asks for an administrator password; click to see how.',
    'Ligar o Ollama': 'Start Ollama', 'Modelos de IA': 'AI models', 'Recomendado para este PC: {rotulo} — {motivo}.': 'Recommended for this PC: {rotulo}. {motivo}.',
    'responde e pesquisa': 'answers and researches', 'escolhe os trechos das páginas': 'picks the relevant parts of pages', 'instalado ✓': 'installed ✓', 'baixando…': 'downloading…', 'Baixar': 'Download',
    'Modelo principal: ': 'Main model: ', 'Outro modelo principal': 'Another main model', ' · recomendado': ' · recommended', ' · pesado para este PC': ' · too heavy for this PC',
    'Baixar os dois ({gb})': 'Download both ({gb})', 'Baixar o que falta ({gb})': 'Download what is missing ({gb})',
    'Busca na web (SearXNG embutido)': 'Web search (built-in SearXNG)', 'Instalada — o AuGPT pesquisa em vários buscadores ao mesmo tempo.': 'Installed: AuGPT searches several engines at once.',
    'Recomendada: um buscador próprio que consulta vários sites de busca de uma vez (baixa Python e o SearXNG, cerca de 130 MB). Sem ela, o AuGPT usa buscadores de reserva, com resultados piores.': 'Recommended: a private search engine that queries several engines at once (downloads Python and SearXNG, about 130 MB). Without it, AuGPT uses fallback engines with worse results.',
    'Instalar a busca': 'Install search',
    'Vídeos do YouTube (yt-dlp)': 'YouTube videos (yt-dlp)', 'Instalado — o agente lê a legenda e os comentários de vídeos, sem baixá-los.': 'Installed: the agent reads video captions and comments without downloading them.',
    'Opcional: deixa o agente "assistir" a reviews e tutoriais lendo a legenda e os comentários (o vídeo não é baixado). Baixa o yt-dlp oficial, 18 MB, com o SHA-256 conferido.': 'Optional: lets the agent "watch" reviews and tutorials by reading captions and comments (the video is not downloaded). Downloads the official yt-dlp, 18 MB, with its SHA-256 verified.',
    'Instalar o yt-dlp': 'Install yt-dlp',
    'Texto de imagens (Tesseract)': 'Text in images (Tesseract)', 'Instalado — o texto das imagens anexadas é lido letra a letra, sem internet.': 'Installed: text in attached images is read letter by letter, offline.',
    'Opcional: lê o texto de prints, documentos e notas fiscais que você anexar, sem IA e sem internet (cerca de 50 MB, pelo winget; o Windows pode pedir permissão).': 'Optional: reads text from screenshots, documents and receipts you attach, without AI and offline (about 50 MB, via winget; Windows may ask for permission).',
    'Instalar o Tesseract': 'Install Tesseract',
    'Criar imagens (FLUX.2 Klein)': 'Create images (FLUX.2 Klein)', 'Instalado — peça "crie uma imagem de…" e ela é feita no seu computador.': 'Installed: ask "create an image of…" and it is made on your computer.',
    'Opcional: cria imagens no seu computador, sem internet. {motivo}. Cerca de {gb} de download.': 'Optional: creates images on your computer, offline. {motivo}. About {gb} to download.',
    'Não disponível neste computador: {motivo}.': 'Not available on this computer: {motivo}.', 'Instalar o gerador de imagens': 'Install the image generator',
    'Começando…': 'Starting…', 'Ligando o Ollama…': 'Starting Ollama…', 'O Ollama não respondeu.': 'Ollama did not respond.',
    '{nome}: preparando…': '{nome}: preparing…', '{nome}: pronto': '{nome}: done', 'Busca instalada.': 'Search installed.', 'A instalação falhou.': 'The installation failed.',
    'yt-dlp instalado.': 'yt-dlp installed.', 'Tesseract instalado.': 'Tesseract installed.', 'Gerador de imagens instalado.': 'Image generator installed.',
    'Falta o essencial: o Ollama ligado e os dois modelos. Dá para pular e preparar depois em Ajustes.': 'Still missing the essentials: Ollama running and both models. You can skip and finish later in Settings.',
    'Automático (do Windows)': 'Automatic (from Windows)', 'Idioma do AuGPT': 'AuGPT language',
    'O idioma das telas e das respostas. Automático segue o idioma do Windows.': 'The language of the screens and answers. Automatic follows the Windows language.',

    /* ================= fase 2 (23/10): Utilitários, Skills, Execuções, Ajustes ================= */
    /* ---------- Utilitários (tela e catálogo) ---------- */
    'Tudo o que o AuGPT faz além de conversar. Peça com as suas palavras no chat ou clique em': 'Everything AuGPT does besides chatting. Ask in your own words in the chat or click',
    'Usar': 'Use', '. Também dá para perguntar a ele:': '. You can also ask it:', '"o que você pode fazer?"': '"what can you do?"',
    'Rede e internet': 'Network and internet', 'Teste de velocidade': 'Speed test',
    'Download, upload, ping, jitter e bufferbloat da sua internet, com gráfico. Gasta até ~300 MB.': 'Download, upload, ping, jitter and bufferbloat of your internet, with a chart. Uses up to ~300 MB.',
    'Só o ping': 'Just the ping', 'Latência, jitter e perda, quase sem gastar dados.': 'Latency, jitter and packet loss, using almost no data.', 'mede meu ping': 'measure my ping',
    'Ping e rota para jogos': 'Ping and route for games',
    'Ping até os servidores de PUBG, Fortnite, CS2, Dota 2, LoL e Valorant, e o caminho (tracert) até o melhor.': 'Ping to the PUBG, Fortnite, CS2, Dota 2, LoL and Valorant servers, and the route (tracert) to the best one.',
    'qual meu ping nos servidores do PUBG?': 'what is my ping to the PUBG servers?',
    'Raio-X da rede': 'Network X-ray', 'Cabo ou Wi-Fi, sinal, ping até o roteador, modelo e firmware do roteador e a configuração (ipconfig).': 'Cable or Wi-Fi, signal, ping to the router, router model and firmware, and the configuration (ipconfig).',
    'faça um raio-x da minha rede': 'do an X-ray of my network',
    'Aparelhos na rede': 'Devices on the network', 'Quantos aparelhos estão conectados e de que fabricante (celular, TV, casa inteligente…).': 'How many devices are connected and from which maker (phone, TV, smart home…).',
    'quantos aparelhos estão conectados na minha rede?': 'how many devices are connected to my network?',
    'O que usa a internet': 'What is using the internet', 'Quanto a placa de rede está usando agora e quais programas estão conectados, e a quê.': 'How much the network adapter is using right now and which programs are connected, and to what.',
    'o que está consumindo minha internet?': 'what is using up my internet?',
    'Ajustes da placa de rede': 'Network adapter tuning', 'DNS, economia de energia da placa, cache de DNS e 5 GHz. Mostra o plano antes, você aprova e dá para desfazer.': 'DNS, adapter power saving, DNS cache and 5 GHz. It shows the plan first, you approve, and it can be undone.',
    'otimize minha placa de rede': 'optimize my network adapter',
    'Este computador': 'This computer', 'Espaço e discos': 'Space and drives', 'Espaço livre de cada unidade e os discos físicos (SSD, HD, NVMe) com a saúde de cada um.': 'Free space on each drive and the physical disks (SSD, HDD, NVMe) with the health of each one.',
    'quanto espaço livre meu pc tem?': 'how much free space does my PC have?',
    'Configuração do PC': 'PC specs', 'Processador, memória RAM (pentes e velocidade), placa-mãe, BIOS e placa de vídeo.': 'Processor, RAM (sticks and speed), motherboard, BIOS and graphics card.',
    'Windows atualizado?': 'Is Windows up to date?', 'Versão do Windows, últimas atualizações e as que estão esperando no Windows Update.': 'Windows version, latest updates and the ones waiting in Windows Update.',
    'meu windows está atualizado?': 'is my Windows up to date?',
    'Driver da placa de vídeo': 'Graphics card driver', 'Versão e data do driver; se for antigo, oferece pesquisar o mais novo.': 'Driver version and date; if it is old, it offers to look up the newest one.',
    'meu driver da placa de vídeo está atualizado?': 'is my graphics card driver up to date?',
    'Periféricos e USB': 'Peripherals and USB', 'Marca e modelo do mouse, teclado e monitor, câmera e aparelhos Bluetooth.': 'Brand and model of the mouse, keyboard and monitor, camera and Bluetooth devices.',
    'qual a marca do meu mouse e do teclado?': 'what brand are my mouse and keyboard?',
    'Placa de som e áudio': 'Sound card and audio', 'Se tem placa de som dedicada e quais saídas de áudio existem.': 'Whether there is a dedicated sound card and which audio outputs exist.',
    'eu tenho placa de som?': 'do I have a sound card?',
    'Fotos, vídeos e músicas': 'Photos, videos and music', 'Quantos arquivos de cada tipo, quanto espaço ocupam e em que pastas estão — contados sem abrir nenhum.': 'How many files of each type, how much space they take and which folders they are in, counted without opening any.',
    'quantas fotos e vídeos eu tenho e onde estão?': 'how many photos and videos do I have and where are they?',
    'Programas instalados': 'Installed programs', 'O que está instalado e em que versão.': 'What is installed and in which version.', 'tenho o Discord instalado?': 'do I have Discord installed?',
    'O que abre com o Windows': 'What starts with Windows', 'Os programas que iniciam sozinhos com o Windows.': 'The programs that start on their own with Windows.',
    'quais programas abrem junto com o windows no meu pc?': 'which programs start with Windows on my PC?',
    'Ler outros dados do PC': 'Read other PC data',
    'Chipset e outros drivers, registro, políticas de grupo, serviços, ajustes da placa de rede… Pesquisa como ler e só lê: nada é mudado, e conteúdo de arquivos, senhas e área de transferência ficam de fora.': 'Chipset and other drivers, registry, group policies, services, network adapter settings… It researches how to read them and only reads: nothing is changed, and file contents, passwords and the clipboard stay out.',
    'Pesquisa com fontes': 'Research with sources', 'Pesquisa na internet e responde citando as fontes, com a data de cada uma e conferindo os números.': 'Searches the web and answers citing the sources, with the date of each one and checking the numbers.',
    'qual a melhor placa de vídeo até R$ 3.000?': 'what is the best graphics card under $600?',
    'Produtos e onde comprar': 'Products and where to buy', 'Recomenda produtos em cartões, com o que a comunidade diz e o preço de hoje nas lojas.': 'Recommends products in cards, with what the community says and today\'s price in stores.',
    'quais os melhores fones intra-auriculares para PUBG?': 'what are the best in-ear headphones for PUBG?',
    'Investigação com relatório': 'Investigation with a report', 'Pesquisa longa pelo tempo que você escolher, com um relatório completo em PDF.': 'Long research for the time you choose, with a full PDF report.',
    'Escolha "Investigação" no seletor de raciocínio, ao lado do campo de mensagem, e faça a pergunta.': 'Choose "Investigation" in the reasoning selector next to the message box and ask your question.',
    'Vídeos do YouTube': 'YouTube videos', 'Assiste vídeos pela legenda e lê os comentários mais curtidos.': 'Watches videos through their captions and reads the most liked comments.',
    'veja vídeos de review do mouse Logitech G Pro X Superlight 2': 'watch review videos of the Logitech G Pro X Superlight 2 mouse',
    'instale o YouTube em Ajustes → Componentes': 'install YouTube in Settings → Components',
    'Criar': 'Create', 'Gráficos interativos': 'Interactive charts', 'Colunas, linhas, área, pizza e projeção com estimativas, montados com os dados da pesquisa.': 'Column, line, area, pie and projection charts with estimates, built from the research data.',
    'Páginas interativas': 'Interactive pages', 'Calculadoras, simulações, animações e quizzes que rodam dentro da resposta.': 'Calculators, simulations, animations and quizzes that run inside the answer.',
    'crie uma calculadora de IMC interativa': 'create an interactive BMI calculator',
    'Buscar imagens': 'Image search', 'Fotos de qualquer coisa — um carro, um lugar, um setup — numa galeria, com o site de onde cada uma veio.': 'Photos of anything (a car, a place, a setup) in a gallery, with the site each one came from.',
    'busque imagens de carros esportivos': 'search for images of sports cars',
    'Criar imagens': 'Create images', 'Cria e edita imagens no seu computador, com o FLUX.2 Klein.': 'Creates and edits images on your computer, with FLUX.2 Klein.',
    'crie uma imagem de um gato astronauta': 'create an image of an astronaut cat', 'instale o Criar imagens em Ajustes → Componentes': 'install Create images in Settings → Components',
    'Ler fotos e prints': 'Read photos and screenshots', 'Olha a foto ou o print que você anexar e lê o texto dele.': 'Looks at the photo or screenshot you attach and reads its text.',
    'Anexe a imagem pelo + da caixa de mensagem e faça a pergunta.': 'Attach the image with the + in the message box and ask your question.',
    'Sites e arquivos': 'Sites and files', 'Navegar em sites': 'Browse sites', 'Abre sites no navegador do AuGPT, faz login, clica, preenche formulários e baixa arquivos.': 'Opens sites in the AuGPT browser, logs in, clicks, fills forms and downloads files.',
    'acesse https://www.kabum.com.br e procure monitores de 144 Hz': 'go to https://www.bestbuy.com and look for 144 Hz monitors',
    'Ler e criar arquivos': 'Read and create files', 'Lê e cria planilhas, documentos, PDFs e código na sua pasta de trabalho.': 'Reads and creates spreadsheets, documents, PDFs and code in your work folder.',
    'crie uma planilha para eu anotar meus gastos do mês': 'create a spreadsheet for my monthly expenses',
    'Memória sobre você': 'Memory about you', 'Guarda o que você pedir (nome, cidade, como prefere as respostas) e usa em todas as conversas. "Esqueça que…" apaga.': 'Keeps what you ask (name, city, how you like your answers) and uses it in every chat. "Forget that…" deletes it.',
    'lembre que eu prefiro respostas curtas e diretas': 'remember that I prefer short, direct answers',

    /* ---------- Skills e ferramentas ---------- */
    'Sugestões': 'Suggestions', 'Instruções de método que entram no prompt quando o pedido combina com os gatilhos. Cada skill é uma pasta com um': 'Method instructions that go into the prompt when a request matches the triggers. Each skill is a folder with a',
    'dentro.': 'inside.', 'As skills valem só nas': 'Skills only apply to', 'tarefas': 'tasks',
    '(arquivo, pasta, site, comando). As perguntas pesquisadas na web passam pelo núcleo de pesquisa, que não usa skills.': '(file, folder, site, command). Questions researched on the web go through the research core, which does not use skills.',
    'Nova skill': 'New skill', 'Abrir pasta': 'Open folder', 'Recarregar': 'Reload', 'Testar quais skills seriam ativadas': 'Test which skills would be activated',
    'Quando o mesmo tipo de pedido se repete sem nenhuma skill cobrindo, o agente rascunha uma skill nova e testa nela mesmo, sozinho, numa execução isolada — antes de qualquer coisa chegar até você. Nada aqui entra em uso enquanto você não aprovar, mesmo o que já passou no autoteste.': 'When the same kind of request keeps coming with no skill covering it, the agent drafts a new skill and tests it on its own, in an isolated run, before anything reaches you. Nothing here is used until you approve it, even what already passed the self-test.',
    'O que o agente sabe executar. Um arquivo': 'What the agent can run. A', 'na pasta de ferramentas vira uma ferramenta nova, sem mexer no código do app.': 'file in the tools folder becomes a new tool, without touching the app code.',
    'Servidores MCP': 'MCP servers',
    'Um servidor MCP entrega várias ferramentas prontas — sistema de arquivos, Git, banco de dados, APIs. As ferramentas dele entram no catálogo como qualquer outra, sempre com': 'An MCP server provides several ready tools: file system, Git, databases, APIs. Its tools join the catalog like any other, always with',
    'risco alto': 'high risk', ': é um processo externo rodando com os seus privilégios.': ': it is an external process running with your privileges.',
    'Testar': 'Test', 'Adicionar': 'Add', 'Reconectar todos': 'Reconnect all',
    'nome (ex.: arquivos)': 'name (e.g. files)', 'comando (ex.: npx)': 'command (e.g. npx)', 'argumentos separados por espaço': 'arguments separated by spaces',
    'lê apenas': 'read-only', 'executa ou apaga': 'runs or deletes', 'essencial': 'essential', 'não pode ser desativada': 'cannot be disabled', 'mostrar arquivo': 'show file',
    'Nenhum servidor configurado.': 'No server configured.', 'informe ao menos nome e comando': 'enter at least a name and a command',
    'sempre ativa': 'always on', 'com rotina': 'with routine', 'formato padrão': 'standard format', 'sem gatilhos': 'no triggers', 'sem descrição': 'no description',
    'passou no autoteste': 'passed the self-test', 'não passou no autoteste': 'failed the self-test',
    'Nenhuma sugestão no momento. Quando o mesmo tipo de pedido se repetir sem nenhuma skill cobrindo, uma proposta testada aparece aqui.': 'No suggestions right now. When the same kind of request repeats with no skill covering it, a tested proposal shows up here.',
    'Nenhuma skill encontrada. Clique em "Nova skill" para criar a primeira.': 'No skills found. Click "New skill" to create the first one.',
    'decisão': 'decision', 'redação': 'writing', 'Nome da nova skill:': 'Name of the new skill:', 'sem pré-visualização pra este formato': 'no preview for this format',

    /* ---------- lateral: conversas ---------- */
    'Nada encontrado.': 'Nothing found.', 'Nenhuma conversa ainda.': 'No chats yet.', 'Conversa compactada.': 'Chat compacted.',
    'Nada novo pra compactar — já está tudo dentro da janela recente.': 'Nothing new to compact: everything is already in the recent window.', 'Novo título:': 'New title:',
    'Mostrar painel (Ctrl+B)': 'Show panel (Ctrl+B)', 'assistente': 'assistant',
    'Ainda não há um modelo de IA pronto pra usar. Siga os passos de "Antes de começar" na tela inicial do Agente (botão Nova conversa) — o AuGPT mostra o que falta e baixa o modelo pra você.': 'There is no AI model ready to use yet. Follow the "Before you start" steps on the Agent home screen (New chat button): AuGPT shows what is missing and downloads the model for you.',
    'Ainda não há um modelo de IA pronto. Abra a aba Agente: a tela inicial mostra o que falta e baixa o modelo pra você.': 'There is no AI model ready yet. Open the Agent tab: the home screen shows what is missing and downloads the model for you.',

    /* ---------- Execuções (aba) ---------- */
    'Cada pergunta ou tarefa vira um registro: quanto pesquisou, quais sites leu e quanto demorou. Exporte as filtradas para mandar como retorno.': 'Every question or task becomes a record: how much it searched, which sites it read and how long it took. Export the filtered ones to send as feedback.',
    'Visualizar execuções ↗': 'View runs ↗', 'Exportar as filtradas': 'Export filtered', 'Limpar': 'Clear', 'Últimos 7 dias ·': 'Last 7 days ·',
    'últimos 7 dias': 'last 7 days', 'últimos 30 dias': 'last 30 days', 'todo o período': 'all time', 'todos os tipos': 'all types', 'perguntas': 'questions', 'produtos': 'products',
    'qualquer resultado': 'any result', 'concluído': 'done', 'bateu o limite': 'hit the limit', 'interrompido': 'stopped', 'erro': 'error', 'todos os modelos': 'all models',
    'tudo': 'all', 'uso real': 'real use', 'bancada': 'test bench', 'Comparativo por modelo': 'Comparison by model', 'Período': 'Period', 'Tipo': 'Type', 'Resultado': 'Result', 'Modelo': 'Model',
    'Nenhuma execução com este modelo nos últimos 7 dias.': 'No runs with this model in the last 7 days.', 'execuções': 'runs', 'concluídas': 'completed',
    'tempo típico (mediana)': 'typical time (median)', 'buscas por execução': 'searches per run', 'páginas lidas por execução': 'pages read per run', 'nota média': 'average rating',
    'Nenhuma execução registrada ainda.': 'No runs recorded yet.', 'conclusão': 'completion', 'nota': 'rating', 'incidentes': 'incidents', 'tempo': 'time',
    'Nenhuma execução ainda. Peça algo ao agente e ela aparece aqui.': 'No runs yet. Ask the agent something and it shows up here.',
    'pergunta': 'question', 'produto': 'product', 'tarefa': 'task', 'buscas': 'searches', 'páginas lidas': 'pages read', 'ferramentas': 'tools', 'erros': 'errors',
    'avalie a qualidade': 'rate the quality', '(sem pedido)': '(no request)', 'ver relatório': 'view report',
    'relatório': 'report',

    /* ---------- janela "Visualizar execuções" ---------- */
    'Buscar por pedido, modelo ou caso…': 'Search by request, model or case…', 'Tendência': 'Trend', 'tokens': 'tokens',
    'Escolha uma execução': 'Pick a run',
    'À esquerda, cada pergunta ou tarefa. Aqui aparece o que o agente fez: onde o tempo foi, o que buscou, o que leu e o que respondeu.': 'On the left, each question or task. Here you see what the agent did: where the time went, what it searched, what it read and what it answered.',
    'tempo total': 'total time', 'chamadas ao modelo': 'model calls', 'Onde o tempo foi': 'Where the time went', 'por etapa do raciocínio': 'by reasoning step',
    'Sem chamadas ao modelo registradas.': 'No model calls recorded.', 'O que buscou e leu': 'What it searched and read', 'Resposta': 'Answer',
    'Ver a resposta inteira': 'See the whole answer', 'Recolher': 'Collapse', 'Raciocínio': 'Reasoning', 'IAs auxiliares': 'Helper AIs', 'Onde cada modelo estava no fim': 'Where each model was at the end',
    'não carregado': 'not loaded', 'Não foi possível abrir esta execução.': 'Could not open this run.', 'Nenhuma execução encontrada.': 'No runs found.',
    'mediana': 'median', 'média': 'average', 'máximo': 'maximum', 'as mais demoradas': 'the slowest', 'as que mais gastaram': 'the most expensive',
    'Nenhuma execução na lista atual.': 'No runs in the current list.', 'Sem dados suficientes ainda.': 'Not enough data yet.', 'Erro': 'Error',
    'entender o pedido': 'understand the request', 'escrever a resposta': 'write the answer', 'destilação': 'distillation', 'crítica do copiloto': 'copilot critique',
    'planejamento': 'planning', 'verificação de ambiguidade': 'ambiguity check', 'interpretação do pedido': 'request interpretation', 'reflexão sobre domínio': 'domain reflection',
    'proposta de skill': 'skill proposal', 'autoteste de skill': 'skill self-test', 'rotina': 'routine',

    /* ---------- Ajustes: abas e Geral ---------- */
    'Geral': 'General', 'Modelos': 'Models', 'Pesquisa na web': 'Web research', 'Memória': 'Memory', 'Tarefas': 'Tasks', 'arquivo, site, comando': 'file, site, command',
    'Componentes': 'Components', 'Avançado': 'Advanced', 'Salvo ✓': 'Saved ✓',
    'O que muda o jeito do AuGPT responder no dia a dia. Tudo é gravado no seu computador assim que você muda.': 'What changes how AuGPT answers day to day. Everything is saved on your computer as soon as you change it.',
    'Respostas': 'Answers', 'Os mesmos seletores do topo da tela — mudar aqui ou lá dá no mesmo.': 'The same selectors as the top of the screen: changing here or there is the same.',
    'Modelo principal': 'Main model', 'Tipo de resposta': 'Answer type', 'Mostrar imagens nas respostas': 'Show images in answers',
    'Foto de cada produto nos cartões de uma recomendação e uma imagem de referência de pessoas, lugares e objetos. As imagens são baixadas pelo app e guardadas na pasta de dados dele.': 'A photo of each product in recommendation cards and a reference image of people, places and objects. Images are downloaded by the app and kept in its data folder.',
    'Revisar as imagens criadas': 'Review created images',
    'Depois de criar uma imagem, o modelo olha o resultado e, se faltar algo do pedido, corrige o prompt e gera de novo — no máximo 2 vezes. Cada revisão soma uns 15 segundos.': 'After creating an image, the model looks at the result and, if something from the request is missing, fixes the prompt and generates again, at most twice. Each review adds about 15 seconds.',
    'Abertura': 'Startup', 'A caixa pequena que cresce até virar a janela do app. Dura uns 6 segundos; um clique ou Esc pula. Vale na próxima vez que o AuGPT abrir.': 'The small box that grows into the app window. It lasts about 6 seconds; a click or Esc skips it. Applies the next time AuGPT opens.',
    'Animação ao abrir o AuGPT': 'Animation when AuGPT opens', 'Som da abertura': 'Startup sound',
    'Pasta de trabalho': 'Work folder', 'O agente só lê e escreve aqui dentro. Arquivos anexados são copiados para cá.': 'The agent only reads and writes inside here. Attached files are copied here.',
    'Trocar pasta': 'Change folder', 'Abrir no explorador': 'Open in Explorer', 'Nenhum arquivo ainda.': 'No files yet.',
    'Situação': 'Status', 'Ollama': 'Ollama', 'Busca embutida': 'Built-in search', 'YouTube (yt-dlp)': 'YouTube (yt-dlp)', 'Texto de imagens (OCR)': 'Text in images (OCR)',
    'Tela': 'Screen', 'Mostrar detalhes técnicos da execução': 'Show technical run details',
    'Cartões como "JSON inválido", "fora do protocolo" e "contexto compactado" mostram como o agente se recuperou de um tropeço. Úteis pra depurar; pra uso normal, ficam escondidos.': 'Cards like "invalid JSON", "off protocol" and "context compacted" show how the agent recovered from a stumble. Useful for debugging; hidden in normal use.',
    'Verificar o computador (boas-vindas)': 'Check the computer (welcome)',
    'não instalada (usa as reservas)': 'not installed (uses fallbacks)', 'instalada, parada': 'installed, stopped', 'ligada': 'running', 'desligado': 'off', 'não instalado': 'not installed',
    'instalado': 'installed', 'a placa não comporta': 'the card can\'t handle it', 'em dia ✓': 'up to date ✓', 'atualização disponível': 'update available', '—': '—',

    /* ---------- Ajustes: Modelos ---------- */
    'Os modelos de IA instalados no Ollama e os recomendados para este computador.': 'The AI models installed in Ollama and the ones recommended for this computer.',
    'Instalados': 'Installed', 'Baixar modelo': 'Download a model', 'Recomendados para este computador': 'Recommended for this computer',
    'Os nomes são os do catálogo do Ollama (ollama.com/library). Baixar de novo um modelo já instalado traz a versão mais nova dele.': 'Names are the ones in the Ollama catalog (ollama.com/library). Downloading an installed model again brings its newest version.',
    'ex.: qwen3.5:9b': 'e.g. qwen3.5:9b', 'principal': 'main', 'embedding': 'embedding', 'Instalar': 'Install',
    'O Ollama está desligado — ligue-o para ver os modelos.': 'Ollama is off: start it to see the models.', 'Nenhum modelo instalado.': 'No models installed.',
    'nenhum modelo baixado': 'no models downloaded', 'consultando o Ollama…': 'asking Ollama…',

    /* ---------- Ajustes: Pesquisa na web ---------- */
    'De onde vêm as buscas, quais fóruns contam como opinião de quem usa e em quais sites confiar.': 'Where searches come from, which forums count as user opinion and which sites to trust.',
    'Buscadores': 'Search engines',
    'A busca tenta vários provedores em cadeia até um responder (busca embutida ou SearXNG → DuckDuckGo → Marginalia → Wikipédia → Jina). A busca embutida se instala na aba Componentes. A chave pública da Marginalia costuma esgotar — pegue a sua de graça em marginalia-search.com/api. A Jina exige chave própria; sem ela, essa reserva fica de fora.': 'Search tries several providers in a chain until one answers (built-in search or SearXNG → DuckDuckGo → Marginalia → Wikipedia → Jina). The built-in search is installed in the Components tab. The public Marginalia key often runs out: get your own for free at marginalia-search.com/api. Jina needs its own key; without it, that fallback is skipped.',
    'SearXNG próprio (opcional)': 'Your own SearXNG (optional)', 'Chave da Marginalia (opcional)': 'Marginalia key (optional)', 'Chave da Jina AI (opcional)': 'Jina AI key (optional)',
    'Fontes da comunidade': 'Community sources',
    'Fóruns e comunidades onde o agente procura opinião de quem usa, um endereço por linha. Vazio usa a lista padrão (Reddit, Clube do Hardware, Fórum Adrenaline e Head-Fi).': 'Forums and communities where the agent looks for user opinions, one address per line. Empty uses the default list (Reddit, Clube do Hardware, Fórum Adrenaline and Head-Fi).',
    'Mostrar onde comprar': 'Show where to buy',
    'Nos pedidos de produto, cada cartão ganha o preço de hoje no KaBuM e nos comparadores Zoom e Buscapé (que cobrem várias lojas), com link. O preço vem da página da loja, não do modelo. Lojas que bloqueiam leitura automática ou não publicam os preços em dados (Magalu, Terabyte, Pichau, eBay) aparecem só pelos comparadores.': 'For product requests, each card gets today\'s price at KaBuM and the Zoom and Buscapé price comparators (which cover several stores), with a link. The price comes from the store page, not from the model. Stores that block automated reading or don\'t publish prices as data (Magalu, Terabyte, Pichau, eBay) only appear through the comparators.',
    'Leitura das páginas': 'Reading pages', 'Renderizar páginas com JavaScript': 'Render pages with JavaScript', 'Usar leitor externo (r.jina.ai)': 'Use the external reader (r.jina.ai)',
    'Quando uma página não abre direto, o endereço dela é enviado ao serviço r.jina.ai pra leitura. Desligado por padrão.': 'When a page doesn\'t open directly, its address is sent to the r.jina.ai service to be read. Off by default.',
    'Permitir endereços da rede local': 'Allow local network addresses',
    'Por segurança, o agente não abre endereços do seu computador nem da sua rede (localhost, 192.168.x.x, o roteador). Ligue só se quiser que ele leia, por exemplo, um servidor de desenvolvimento local.': 'For safety, the agent doesn\'t open addresses on your computer or your network (localhost, 192.168.x.x, the router). Turn it on only if you want it to read, for example, a local development server.',
    'Domínios e credibilidade': 'Domains and credibility',
    'Bases públicas usadas para ordenar as fontes: portais com histórico de conteúdo fabricado descem na fila, órgãos oficiais sobem. Nada é bloqueado em silêncio — fonte marcada continua legível, com o aviso junto.': 'Public lists used to rank sources: sites with a history of fabricated content go down, official bodies go up. Nothing is silently blocked: a flagged source stays readable, with the warning attached.',
    'Consultar um domínio': 'Look up a domain', 'ex.: g1.globo.com': 'e.g. bbc.co.uk', 'Suas marcações': 'Your flags',
    'O seu julgamento vence a base pública: você conhece os sites do seu assunto melhor que uma lista genérica.': 'Your judgment beats the public list: you know the sites in your field better than a generic list.',
    'domínio (ex.: portalx.com.br)': 'domain (e.g. example.com)', 'confiável — sobe na fila': 'reliable: moves up', 'apuração fraca — desce um pouco': 'weak fact-checking: moves down a little',
    'não confiável — desce muito': 'unreliable: moves down a lot', 'sátira — não é notícia real': 'satire: not real news', 'motivo (aparece no material)': 'reason (shown with the source)',
    'confiável': 'reliable', 'apuração fraca': 'weak fact-checking', 'não confiável': 'unreliable', 'sátira': 'satire', 'Remover': 'Remove',
    'peso maior é lido primeiro; negativo desce para o fim da fila': 'higher weight is read first; negative goes to the end of the queue', 'bloqueio judicial no Brasil': 'court block in Brazil',

    /* ---------- Ajustes: Memória ---------- */
    'O que o agente guarda entre as conversas — e o botão para esquecer.': 'What the agent keeps between chats, and the button to forget it.',
    'Só nas tarefas': 'Tasks only', '(pedidos com arquivo, pasta, site ou comando). Fatos e resultados guardados entre os passos e entre execuções, aprendidos em paralelo enquanto o agente trabalha.': '(requests with files, folders, sites or commands). Facts and results kept between steps and between runs, learned in parallel while the agent works.',
    'Esquecer tudo': 'Forget everything', 'Memória central': 'Core memory', 'O que o agente sabe sobre': 'What the agent knows about',
    '— nome, preferências gerais — e que vale em qualquer pasta de trabalho. Para guardar, diga no chat, por exemplo, "lembre que eu prefiro respostas curtas" ou "meu nome é Ana"; para tirar, "esqueça que…". Vale em toda resposta.': '(name, general preferences) and that applies in any work folder. To save something, say in the chat, for example, "remember that I prefer short answers" or "my name is Ana"; to remove it, "forget that…". Applies to every answer.',
    'Esquecer tudo sobre mim': 'Forget everything about me', 'Memória operacional': 'Operational memory', 'Só nas tarefas.': 'Tasks only.', 'O que o agente aprendeu sobre': 'What the agent learned about',
    'como': 'how', 'as coisas funcionam: site que exige JavaScript, provedor de busca instável, ferramenta certa para cada formato. Uma observação só não vira lição — é preciso repetir.': 'things work: a site that needs JavaScript, an unstable search provider, the right tool for each format. A single observation doesn\'t become a lesson: it has to repeat.',
    'Esquecer aprendizado': 'Forget what it learned',
    'Nada guardado ainda. Diga no chat, por exemplo, "lembre que eu prefiro respostas curtas".': 'Nothing saved yet. Say in the chat, for example, "remember that I prefer short answers".',
    'Nada aprendido ainda. As lições aparecem com o uso.': 'Nothing learned yet. Lessons show up with use.',
    'Esquecer tudo que o agente sabe sobre você?': 'Forget everything the agent knows about you?', 'Esquecer tudo que o agente aprendeu sobre como as coisas funcionam?': 'Forget everything the agent learned about how things work?',
    'Esquecer tudo que foi aprendido nesta pasta de trabalho?': 'Forget everything learned in this work folder?',

    /* ---------- Ajustes: Tarefas ---------- */
    'Valem quando o pedido mexe em arquivo, pasta, site ou comando — não nas perguntas pesquisadas na web. Autonomia e raciocínio ficam no topo da tela, na aba Agente.': 'They apply when a request touches files, folders, sites or commands, not to questions researched on the web. Autonomy and reasoning are at the top of the screen, in the Agent tab.',
    'Execução': 'Running', 'Máximo de passos': 'Maximum steps', 'Verificar ambiguidade antes de agir': 'Check for ambiguity before acting',
    'Antes do primeiro passo, uma checagem rápida decide se o pedido já tem informação suficiente ou se falta algo que só você sabe. Só nesse segundo caso a primeira ação é uma pergunta.': 'Before the first step, a quick check decides whether the request already has enough information or is missing something only you know. Only in the second case is the first action a question.',
    'Sempre permitidas': 'Always allowed', 'nenhuma': 'none', 'Limite do terminal e do código (s)': 'Terminal and code time limit (s)', 'Propor skills automaticamente': 'Propose skills automatically',
    'Quando o mesmo tipo de pedido se repete sem nenhuma skill cobrindo, o agente testa um rascunho sozinho antes de sugerir — veja em Skills → Sugestões. Nunca ativa nada sem sua aprovação.': 'When the same kind of request repeats with no skill covering it, the agent tests a draft on its own before suggesting it (see Skills → Suggestions). It never activates anything without your approval.',
    'Navegador': 'Browser', 'Navegação interativa (login e formulários)': 'Interactive browsing (logins and forms)', 'Mostrar a janela do navegador': 'Show the browser window',
    'Com a janela visível você faz login uma vez e o agente continua dali — a sessão fica salva. Toda ação no navegador pede confirmação.': 'With the window visible you log in once and the agent continues from there; the session is saved. Every action in the browser asks for confirmation.',
    'Arquivos baixados pelo navegador': 'Files downloaded by the browser', 'Perguntar onde salvar (janela "Salvar como")': 'Ask where to save ("Save as" window)', 'Salvar sozinho na pasta de trabalho': 'Save automatically to the work folder',
    'Rotina automática': 'Automatic routine', 'Pedidos que disparam sozinhos, na hora certa. Só funciona com o AuGPT aberto.': 'Requests that run on their own, at the right time. Only works with AuGPT open.',
    'Pedido a enviar': 'Request to send', 'Quando disparar': 'When to run', 'a cada X minutos': 'every X minutes', 'todo dia num horário fixo': 'every day at a set time',
    'Intervalo (minutos)': 'Interval (minutes)', 'Horário (HH:MM)': 'Time (HH:MM)', 'ex.: qual a previsão do tempo para hoje?': 'e.g. what is the weather forecast for today?',
    'Ex.: qual a previsão do tempo para amanhã?': 'E.g. what is the weather forecast for tomorrow?', 'Nenhuma rotina automática configurada ainda.': 'No automatic routine set up yet.',

    /* ---------- Ajustes: Componentes ---------- */
    'Os programas que o AuGPT usa por fora. As versões são conferidas quando você abre esta aba; nada é atualizado sem você clicar.': 'The external programs AuGPT uses. Versions are checked when you open this tab; nothing is updated until you click.',
    'As versões novas saem no GitHub (github.com/D4v1K1ngg/augpt). O instalador baixado tem o SHA-512 conferido antes de abrir, e as suas conversas, ajustes e modelos continuam onde estão.': 'New versions are released on GitHub (github.com/D4v1K1ngg/augpt). The downloaded installer has its SHA-512 checked before it opens, and your chats, settings and models stay where they are.',
    'Instalado': 'Installed', 'Mais recente': 'Latest', 'Atualizar o AuGPT': 'Update AuGPT', 'Procurar atualizações ao abrir o AuGPT': 'Check for updates when AuGPT opens',
    'Roda os modelos de IA no seu computador.': 'Runs the AI models on your computer.', 'Atualizar o Ollama': 'Update Ollama', 'Testar a placa de vídeo': 'Test the graphics card',
    'O teste carrega o modelo em uso e mostra se ele roda na placa de vídeo, dividido ou só no processador, e a quantos tokens por segundo. Em placa AMD antiga, sem ROCm (como a RX 580), o Ollama usa o Vulkan dela.': 'The test loads the current model and shows whether it runs on the graphics card, split, or on the processor only, and at how many tokens per second. On older AMD cards without ROCm (like the RX 580), Ollama uses their Vulkan backend.',
    'Busca embutida (SearXNG)': 'Built-in search (SearXNG)',
    'O AuGPT baixa e roda o próprio SearXNG local, que consulta vários buscadores ao mesmo tempo. Só na instalação ele baixa arquivos da internet (Python do python.org e o SearXNG do GitHub). Reinstalar traz a versão mais nova.': 'AuGPT downloads and runs its own local SearXNG, which queries several search engines at once. Only the installation downloads files from the internet (Python from python.org and SearXNG from GitHub). Reinstalling brings the newest version.',
    'Desinstalar': 'Uninstall', 'Usar a busca embutida': 'Use the built-in search',
    'Deixa o agente "assistir" a vídeos: lê a legenda e os comentários mais curtidos, sem baixar o vídeo. O YouTube muda com frequência — quando um vídeo não abrir, confira aqui se há versão nova. Cada atualização tem o SHA-256 conferido, e a versão de antes fica guardada.': 'Lets the agent "watch" videos: it reads the captions and the most liked comments without downloading the video. YouTube changes often: when a video won\'t open, check here for a new version. Every update has its SHA-256 checked, and the previous version is kept.',
    'Voltar à versão anterior': 'Roll back to the previous version',
    'Lê o texto de prints, fotos de documento e notas fiscais letra a letra, sem IA e sem internet. Ajuda o modelo a não errar números e nomes quando você anexa uma imagem. Instala o pacote oficial pelo winget (o Windows pode pedir permissão de administrador) e os idiomas português e inglês.': 'Reads text from screenshots, document photos and receipts letter by letter, without AI and offline. It helps the model get numbers and names right when you attach an image. Installs the official package via winget (Windows may ask for administrator permission) and the Portuguese and English languages.',
    'Gera imagens no seu computador, sem internet: "crie uma imagem de…", "desenhe um logo…", ou anexe uma foto e peça para transformá-la. Usa o FLUX.2 Klein 4B pelo stable-diffusion.cpp; o modelo de texto sai da placa de vídeo enquanto a imagem é feita e volta depois. Tudo baixado é conferido pelo SHA-256 publicado.': 'Creates images on your computer, offline: "create an image of…", "draw a logo…", or attach a photo and ask to transform it. Uses FLUX.2 Klein 4B through stable-diffusion.cpp; the text model leaves the graphics card while the image is made and comes back afterwards. Everything downloaded is checked against the published SHA-256.',
    'Neste computador': 'On this computer', 'Modelos por função': 'Models by role', '"Atualizar" baixa de novo o modelo no Ollama — só o que mudou é transferido.': '"Update" downloads the model again in Ollama; only what changed is transferred.',
    'Verificar de novo': 'Check again', 'Responder e pesquisar': 'Answer and research', 'Escolher os trechos das páginas': 'Pick the relevant parts of pages',
    'Atualizar o yt-dlp': 'Update yt-dlp', 'Instalar o yt-dlp (18 MB)': 'Install yt-dlp (18 MB)', 'Como instalar': 'How to install', 'Baixar os idiomas': 'Download the languages',
    'Atualizar o Tesseract': 'Update Tesseract', 'Instalar o Tesseract (cerca de 50 MB)': 'Install Tesseract (about 50 MB)', 'Atualizar o programa': 'Update the program',
    'programa instalado, faltam os modelos': 'program installed, models missing', 'instalado, desligado': 'installed, off', 'não consegui consultar': 'couldn\'t check',
    'baixando Python…': 'downloading Python…', 'baixando SearXNG…': 'downloading SearXNG…', 'instalando dependências…': 'installing dependencies…', 'instalado, parado': 'installed, stopped',
    'começando…': 'starting…', 'abrindo o instalador…': 'opening the installer…', 'verificando': 'checking',
    'pronto ✓ — o agente já pode ver vídeos do YouTube': 'done ✓: the agent can now watch YouTube videos', 'pronto ✓ — o texto das imagens anexadas passa a ser lido': 'done ✓: text in attached images will now be read',
    'pronto ✓ — peça, por exemplo, "crie uma imagem de um farol numa tempestade"': 'done ✓: ask, for example, "create an image of a lighthouse in a storm"',
    'Voltar o gerador de imagens para a versão anterior do programa?': 'Roll the image generator back to the previous version of the program?', 'Voltar o yt-dlp para a versão anterior?': 'Roll yt-dlp back to the previous version?',
    'Servidor respondendo': 'Server responding', 'fora do lugar': 'out of place', 'fora da configuração': 'not in the settings', 'onde deveria': 'where it should be',
    'Remover o SearXNG embutido? Isso apaga o Python e o SearXNG baixados — dá pra instalar de novo depois.': 'Remove the built-in SearXNG? This deletes the downloaded Python and SearXNG; you can install them again later.',
    'Voltar todos os ajustes ao padrão? A pasta de trabalho, o modelo escolhido, suas rotinas, servidores MCP e domínios marcados continuam como estão.': 'Reset all settings to default? The work folder, the chosen model, your routines, MCP servers and flagged domains stay as they are.',

    /* ---------- Ajustes: Avançado ---------- */
    'Ajustes técnicos. Os valores padrão funcionam pra maioria dos computadores — mude só se souber o que está fazendo.': 'Technical settings. The defaults work for most computers; change them only if you know what you are doing.',
    'Conexão': 'Connection', 'Servidor Ollama': 'Ollama server', 'Procurar na rede': 'Search the network', 'Testar este endereço': 'Test this address', 'Usar o deste PC': 'Use this PC\'s',
    'Para usar o Ollama de outro computador da casa: naquele PC, crie a variável de ambiente': 'To use Ollama on another computer at home: on that PC, create the environment variable',
    'com o valor': 'with the value', ', reinicie o Ollama e permita o Ollama no firewall do Windows (rede privada). Depois clique em': ', restart Ollama and allow Ollama in the Windows firewall (private network). Then click',
    'aqui. O modelo roda lá; o que você pergunta passa pela rede da casa, sem sair dela.': 'here. The model runs there; what you ask goes over your home network without leaving it.',
    'Modelo de embedding': 'Embedding model', 'O embedding escolhe os trechos das páginas mais ligados à pergunta e alimenta a memória.': 'The embedding picks the parts of pages most related to the question and feeds the memory.',
    'Lembranças por consulta': 'Memories per query', 'Modelos e contexto das tarefas': 'Task models and context',
    'Valem nas tarefas (arquivo, site, comando). As perguntas pesquisadas na web usam o modelo principal.': 'They apply to tasks (file, site, command). Questions researched on the web use the main model.',
    'Modelo das decisões': 'Decision model', 'o mesmo do topo': 'same as the top', 'Modelo da redação': 'Writing model', 'Janela de contexto — decisão': 'Context window: decision',
    'Janela de contexto — redação': 'Context window: writing', 'igual à decisão': 'same as decision', 'Temperatura': 'Temperature', 'Restaurar': 'Reset',
    'Volta todos os ajustes para o padrão. Conversas, memória e modelos instalados não são apagados.': 'Resets all settings to default. Chats, memory and installed models are not deleted.',
    'Restaurar padrões': 'Reset to defaults', 'Procurando na rede da casa… (alguns segundos)': 'Searching your home network… (a few seconds)',
    'O AuGPT voltou a usar o Ollama deste computador.': 'AuGPT is using this computer\'s Ollama again.',
    'embutida': 'built-in', 'sua': 'yours', 'gatilhos e ferramentas': 'triggers and tools', 'ver instruções': 'view instructions', 'mcp': 'mcp',
    'Ping até o roteador (ms)': 'Ping to the router (ms)', 'Latência durante o teste (ms)': 'Latency during the test (ms)', 'Latência média: parado x linha cheia (ms)': 'Average latency: idle vs. loaded line (ms)',
    'Tráfego da placa de rede (Mbps)': 'Network adapter traffic (Mbps)', 'Conexões ativas por programa': 'Active connections by program', 'recebendo': 'receiving', 'enviando': 'sending', 'conexões': 'connections', 'parado': 'idle', 'baixando': 'downloading',
    'domínios classificados': 'domains rated', 'com conteúdo fabricado': 'with fabricated content', 'com bloqueio judicial no Brasil': 'court-blocked in Brazil',
  };

  const PADROES = [
    [/^sua placa AMD tem ([\d.,]+) GB, mas é de uma geração antiga \(sem ROCm\): .*$/, 'your AMD card has $1 GB, but it is an older generation (no ROCm): Ollama uses its slower Vulkan backend, so the 4B balances quality and speed'],
    [/^sua placa AMD tem ([\d.,]+) GB e é de uma geração antiga: .*$/, 'your AMD card has $1 GB and is an older generation: the 2B (2.6 GB) fits and runs on Vulkan'],
    [/^sua placa tem ([\d.,]+) GB: cabe o modelo grande, o de melhor qualidade$/, 'your card has $1 GB: the large, best-quality model fits'],
    [/^sua placa tem ([\d.,]+) GB: o 9B cabe inteiro nela — é o que o AuGPT foi ajustado e medido$/, 'your card has $1 GB: the 9B fits entirely, and it is the model AuGPT was tuned and measured with'],
    [/^sua placa tem ([\d.,]+) GB: o 4B cabe inteiro; o 9B ficaria lento$/, 'your card has $1 GB: the 4B fits entirely; the 9B would be slow'],
    [/^sua placa tem ([\d.,]+) GB: o 2B \(2,6 GB\) cabe inteiro nela e é rápido$/, 'your card has $1 GB: the 2B (2.6 GB) fits entirely and is fast'],
    [/^sem placa de vídeo com memória suficiente: roda no processador, usando a RAM \(([\d.,]+) GB\); .*$/, 'no graphics card with enough memory: it runs on the processor using RAM ($1 GB); the 2B fits best, with the same score as the 4B in tests in half the time'],
    [/^memória muito limitada \(([\d.,]+) GB\): .*$/, 'very limited memory ($1 GB): only the smallest model runs, with low quality'],
    [/^pouco espaço no disco dos modelos: ([\d.,]+) GB livres, precisa de uns (\d+) GB$/, 'low space on the models drive: $1 GB free, about $2 GB needed'],
    [/^não achei placa de vídeo com memória dedicada: .*$/, 'no graphics card with dedicated memory found: the model runs on the processor and each answer takes much longer'],
    [/^placa AMD antiga: depois de instalar, .*$/, 'older AMD card: after installing, use "Test the graphics card" in Settings → Components to check that Ollama is using it'],
    [/^por enquanto o AuGPT instala o gerador de imagens só no Windows$/, 'for now AuGPT installs the image generator only on Windows'],
    [/^sua (.+) \(([\d.,]+) GB\) gera uma imagem em cerca de 7 a 15 segundos$/, 'your $1 ($2 GB) creates an image in about 7 to 15 seconds'],
    [/^sua (.+) \(([\d.,]+) GB\) roda pela versão Vulkan, que funciona mas é lenta: numa placa dessa geração, alguns minutos por imagem$/, 'your $1 ($2 GB) runs the Vulkan version, which works but is slow: on a card this old, a few minutes per image'],
    [/^sua (.+) \(([\d.,]+) GB\) roda pela versão Vulkan, que funciona mas é lenta: cerca de 1 minuto por imagem$/, 'your $1 ($2 GB) runs the Vulkan version, which works but is slow: about 1 minute per image'],

    /* fase 2 (23/10): textos da tela montados com números (o i18n aplica também nos nós de texto) */
    [/^(.+) — atualização disponível$/, '$1: update available'],
    [/^(.+) · em dia ✓$/, '$1 · up to date ✓'],
    [/^atualização (.+) disponível$/, 'update $1 available'],
    [/^1 atualização$/, '1 update'], [/^(\d+) atualizações$/, '$1 updates'],
    [/^1 atualização disponível$/, '1 update available'], [/^(\d+) atualizações disponíveis$/, '$1 updates available'],
    [/^não consegui consultar \((.+)\)$/, 'couldn\'t check ($1)'],
    [/^Atualizar para a (.+)$/, 'Update to $1'],
    [/^rodando · porta (\d+)$/, 'running · port $1'],
    [/^ligado · (.*)$/, 'running · $1'],
    [/^(.+) — faltam os idiomas$/, '$1: languages missing'],
    [/^comporta — (.+)$/, (m, motivo) => `supported: ${trTexto(motivo)}`],
    [/^não comporta — (.+)$/, (m, motivo) => `not supported: ${trTexto(motivo)}`],
    [/^Instalar \(cerca de ([\d.,]+) GB, em (.+)\)$/, (m, gb, pasta) => `Install (about ${gb} GB, on ${pasta === 'pasta dos modelos' ? 'the models folder' : pasta})`],
    [/^testando (.+)… \(carregar o modelo pode levar alguns segundos\)$/, 'testing $1… (loading the model may take a few seconds)'],
    [/^(.+): iniciando…$/, '$1: starting…'],
    [/^"(.+)" instalado\.$/, '"$1" installed.'],
    [/^voltou para (.+)$/, (m, v) => `rolled back to ${v === 'a anterior' ? 'the previous one' : v}`],
    [/^Recomendado para este computador: (.+?) — (.+)$/, (m, rotulo, motivo) => `Recommended for this computer: ${rotulo}. ${trTexto(motivo)}`],
    [/^(recomendado|cabe|pesado para este PC) · (.+)$/, (m, nota, gb) => `${{ recomendado: 'recommended', cabe: 'fits', 'pesado para este PC': 'too heavy for this PC' }[nota]} · ${gb}`],
    [/^Sem resposta em (.+)$/, 'No response at $1'],
    [/^modelos · (\d+) carregados?$/, 'models · $1 loaded'],
    [/^Atenção: (.+)\. Clique para ver\.$/, 'Attention: $1. Click to see.'],
    [/^busca · (\d+) de (\d+) buscadores$/, 'search · $1 of $2 engines'],
    [/^nenhum buscador respondeu na última pesquisa$/, 'no search engine answered in the last search'],
    [/^todo dia às (.+)$/, 'every day at $1'], [/^a cada (\d+) min$/, 'every $1 min'],
    [/^(\d+) execução$/, '$1 run'], [/^(\d+) execuções$/, '$1 runs'],
    [/^(\d+) de (\d+)$/, '$1 of $2'],
    [/^há (\d+) ?min$/, '$1 min ago'], [/^há (\d+) ?h$/, '$1 h ago'],
    [/^(\d+) selecionadas?$/, '$1 selected'],
    [/^Mostrar mais \((\d+) restantes\)$/, 'Show more ($1 left)'],
    [/^sua nota: (\d)$/, 'your rating: $1'],
    [/^nota média \((\d+)\)$/, 'average rating ($1)'],
    [/^bancada: (.+)$/, 'test bench: $1'],
    [/^cobertura (.+)$/, 'coverage $1'],
    [/^conectado · (\d+) ferramenta\(s\) · (.*)$/, 'connected · $1 tool(s) · $2'],
    [/^falhou — (.+)$/, 'failed: $1'],
    [/^(\d+) arquivo\(s\) com problema$/, '$1 file(s) with problems'],
    [/^(\d+) buscas?$/, (m, n) => `${n} search${n === '1' ? '' : 'es'}`],
    [/^(\d+) páginas? lidas?$/, (m, n) => `${n} page${n === '1' ? '' : 's'} read`],
    [/^(\d+) passos?$/, (m, n) => `${n} step${n === '1' ? '' : 's'}`],
    [/^(ambas|decisao|redacao|decisão|redação) · prioridade (\d+) · (\d+) caracteres$/, (m, etapa, p, n) => `${{ ambas: 'both', decisao: 'decision', decisão: 'decision', redacao: 'writing', redação: 'writing' }[etapa]} · priority ${p} · ${n} characters`],
    [/^Ping até os servidores do (.+) \(ms\)$/, 'Ping to the $1 servers (ms)'], [/^Latência a cada salto até (.+) \(ms\)$/, 'Latency at each hop to $1 (ms)'],
    [/^· ([\d.,]+) tokens · (\d+) chamadas?$/, (m, t, n) => `· ${t} tokens · ${n} call${n === '1' ? '' : 's'}`],
    [/^pesquisa (rapido|rápido|normal|profundo|automatico|automático|investigacao|investigação)$/, (m, modo) => `${{ rapido: 'quick', rápido: 'quick', normal: 'normal', profundo: 'deep', automatico: 'automatic', automático: 'automatic', investigacao: 'investigation', investigação: 'investigation' }[modo]} research`],
    [/^(.+) · pensa antes de responder \(lento\)$/, '$1 · thinks before answering (slow)'],
    [/^Não consegui ativar o Ollama: (.+)$/, 'I couldn\'t start Ollama: $1'],
    [/^Não consegui consultar o Ollama \((.*)\); mostrando só a configuração\.$/, 'I couldn\'t reach Ollama ($1); showing only the settings.'],
    [/^Não consegui procurar: (.+)$/, 'I couldn\'t search: $1'],
    [/^(.+) não respondeu \((.+)\)\.$/, '$1 did not respond ($2).'],
    /* janelas de confirmação */
    [/^Excluir "(.+)"\? Isso não pode ser desfeito\.$/, 'Delete "$1"? This cannot be undone.'],
    [/^Excluir (\d+) conversa\(s\)\? Isso não pode ser desfeito\.$/, 'Delete $1 chat(s)? This cannot be undone.'],
    [/^Não foi possível compactar: (.+)$/, 'Could not compact: $1'],
    [/^Remover o servidor "(.+)"\?$/, 'Remove the server "$1"?'],
    [/^Descartar a sugestão "(.+)"\?$/, 'Discard the suggestion "$1"?'],
    [/^Baixar e instalar o AuGPT (.*)\? O AuGPT fecha, o instalador troca os arquivos e abre a versão nova\. Suas conversas e ajustes continuam\.$/, 'Download and install AuGPT $1? AuGPT closes, the installer replaces the files and opens the new version. Your chats and settings stay.'],
    [/^Atualizar o Ollama para (.+)\? Ele fecha durante a atualização — não use o agente até terminar\.$/, 'Update Ollama to $1? It closes during the update; don\'t use the agent until it finishes.'],
    [/^(.+)\? O download continua mesmo se você usar o agente, mas não feche o AuGPT até terminar\.$/, (m, acao) => `${trTexto(acao)}? The download continues even if you use the agent, but don't close AuGPT until it finishes.`],
  ];
  /** A tradução pelos padrões com números (null se nenhum serve). */
  function porPadrao(texto) {
    for (const [re, en] of PADROES) if (re.test(texto)) return texto.replace(re, en);
    return null;
  }

  /** Frase que vem pronta do processo principal: o dicionário, e então os padrões com números. */
  function trTexto(s) {
    const texto = String(s ?? '');
    if (idioma !== 'en') return texto;
    if (EN[texto] != null) return EN[texto];
    for (const [re, en] of PADROES) if (re.test(texto)) return texto.replace(re, en);
    return texto;
  }

  const detectado = () => ((navigator.languages?.[0] || navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en');
  let escolha = '';
  try {
    escolha = localStorage.getItem(CHAVE) || '';
  } catch {}
  let idioma = escolha === 'pt' || escolha === 'en' ? escolha : detectado();

  const preencher = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : String(s));
  function tr(pt, vars) {
    return preencher(idioma === 'en' && EN[pt] != null ? EN[pt] : pt, vars);
  }

  /* troca de texto na tela: guarda o original em português em cada nó */
  const pular = (el) => !el || el.closest?.(PULAR);
  function noDeTexto(n) {
    if (pular(n.parentElement)) return;
    const atual = n.nodeValue;
    // o app trocou o texto depois da última tradução: o novo vira o original
    if (n.__pt !== undefined && atual !== n.__mostrado) n.__pt = undefined;
    const original = n.__pt !== undefined ? n.__pt : atual;
    const chave = original.trim();
    if (!chave) return;
    const en = EN[chave] != null ? EN[chave] : porPadrao(chave);
    if (en == null) return;
    n.__pt = original;
    const novo = idioma === 'en' ? original.replace(chave, en) : original;
    n.__mostrado = novo;
    if (atual !== novo) n.nodeValue = novo;
  }
  function atributos(el) {
    if (!el || el.closest?.(PULAR_ATRIBUTOS)) return;
    for (const a of ATRIBUTOS) {
      if (!el.hasAttribute(a)) continue;
      el.__ptAttr = el.__ptAttr || {};
      const atual = el.getAttribute(a);
      if (el.__ptAttr[a] !== undefined && atual !== el.__mostradoAttr?.[a]) el.__ptAttr[a] = undefined;
      const original = el.__ptAttr[a] !== undefined ? el.__ptAttr[a] : atual;
      if (EN[original.trim()] == null) continue;
      el.__ptAttr[a] = original;
      const novo = idioma === 'en' ? EN[original.trim()] : original;
      (el.__mostradoAttr = el.__mostradoAttr || {})[a] = novo;
      if (atual !== novo) el.setAttribute(a, novo);
    }
  }
  function aplicar(raiz = document.body) {
    if (!raiz) return;
    if (raiz.nodeType === 3) return noDeTexto(raiz);
    if (raiz.nodeType !== 1) return;
    atributos(raiz);
    const passeio = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = passeio.nextNode(); n; n = passeio.nextNode()) {
      if (n.nodeType === 3) noDeTexto(n);
      else atributos(n);
    }
  }

  // só em inglês: o português é o texto de origem, nada a fazer
  const observador = new MutationObserver((lista) => {
    for (const m of lista) {
      if (m.type === 'characterData') noDeTexto(m.target);
      else if (m.type === 'attributes') atributos(m.target);
      else m.addedNodes.forEach((n) => aplicar(n));
    }
  });
  const observar = () => {
    observador.disconnect();
    if (idioma === 'en' && document.body) observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
  };

  function definir(nova) {
    escolha = nova === 'pt' || nova === 'en' ? nova : '';
    try {
      localStorage.setItem(CHAVE, escolha);
    } catch {}
    const antes = idioma;
    idioma = escolha || detectado();
    document.documentElement.lang = idioma === 'en' ? 'en' : 'pt-BR';
    if (antes !== idioma) {
      aplicar();
      observar();
      window.dispatchEvent(new CustomEvent('idioma', { detail: idioma }));
    }
    return idioma;
  }

  document.documentElement.lang = idioma === 'en' ? 'en' : 'pt-BR';
  window.addEventListener('DOMContentLoaded', () => {
    if (idioma === 'en') aplicar();
    observar();
  });

  window.i18n = {
    tr,
    trTexto,
    definir,
    aplicar,
    get idioma() { return idioma; },
    get escolha() { return escolha; },
    detectado,
    locale: () => (idioma === 'en' ? 'en-US' : 'pt-BR'),
    nomeDoIdioma: (i) => (i === 'en' ? 'English' : 'Português'),
  };
  window.tr = tr;
  for (const nome of ['confirm', 'alert', 'prompt']) {
    const original = window[nome]?.bind(window);
    if (original) window[nome] = (mensagem, ...resto) => original(trTexto(mensagem), ...resto);
  }
})();
