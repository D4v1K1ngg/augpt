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
  ];
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
    if (!chave || EN[chave] == null) return;
    n.__pt = original;
    const novo = idioma === 'en' ? original.replace(chave, EN[chave]) : original;
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
})();
