'use strict';

/**
 * O que o AuGPT sabe fazer (18/10, conversa do Davi): perguntado "você consegue
 * ver como está a qualidade da minha conexão?", o AuGPT respondeu "não consigo
 * medir… não tenho acesso à sua rede" — e ele mede. As ferramentas só eram
 * acionadas por palavra-chave, e o modelo não sabia que elas existiam.
 *
 * Este catálogo é a fonte única das capacidades, usada em três lugares:
 * 1. ENTENDER (nucleo, entendimento): o modelo escolhe aqui se o usuário está
 *    pedindo uma ação que o AuGPT executa ("acao") ou se uma delas ajudaria
 *    ("sugerir"). As palavras-chave continuam como reserva.
 * 2. ESCREVER: a escrita recebe a lista do que está disponível neste PC e não
 *    pode dizer que não consegue fazer o que está nela.
 * 3. SUGERIR: o código põe a oferta no fim da resposta; "sim" na mensagem
 *    seguinte executa (ver aceitouOferta).
 */

const CAPACIDADES = [
  {
    id: 'teste_de_rede',
    executa: true,
    faz: 'mede agora a internet do usuário: download, upload, ping, jitter, perda e bufferbloat (gasta até ~300 MB)',
    quando: 'qualidade, velocidade ou estabilidade da internet ou do Wi-Fi do usuário, internet lenta, lag, ping alto, se a internet aguenta algo',
    oferta: 'Posso **testar a sua internet agora**: download, upload, ping e bufferbloat (o teste gasta até ~300 MB). Quer? É só responder **"sim"** — ou **"só o ping"**, que quase não gasta dados.',
  },
  {
    id: 'rota_de_jogo',
    executa: true,
    faz: 'mede o ping do usuário até os servidores de um jogo online (PUBG, Fortnite, CS2, Dota 2, LoL, Valorant) e o caminho (tracert) até o melhor',
    quando: 'lag ou ping em jogo online, qual servidor escolher, região do jogo',
    oferta: 'Posso **medir o seu ping até os servidores do jogo** e mostrar o caminho até o melhor deles. Quer? É só responder **"sim"**.',
  },
  {
    id: 'diagnostico_da_rede',
    executa: true,
    faz: 'faz o raio-X da rede local: cabo ou Wi-Fi (sinal, banda, canal), ping até o roteador, modelo e firmware do roteador, aparelhos conectados na rede e a configuração (ipconfig: IP, DNS, DHCP)',
    quando: 'problema entre o PC e o roteador, Wi-Fi fraco, muitos aparelhos na rede, qual é o roteador, configuração de rede, DNS, "o problema é na minha casa?"',
    oferta: 'Posso **fazer um raio-X da sua rede agora**: cabo ou Wi-Fi, ping até o roteador, modelo do roteador e quantos aparelhos estão conectados (só leitura, nada é mudado). Quer? É só responder **"sim"**.',
  },
  {
    id: 'consultar_pc',
    executa: true,
    faz: 'consulta o computador do usuário, só lendo: espaço e discos, configuração (processador, RAM, placa-mãe), versão e atualizações do Windows, placa de vídeo e driver, marca do mouse, teclado e monitor, placa de som, quantas fotos/vídeos/músicas e onde estão, programas instalados, o que abre com o Windows, bateria; e o resto do que é só leitura (chipset e outros drivers, registro, políticas de grupo, serviços, ajustes da placa de rede), com um comando que o AuGPT escreve e o código confere',
    quando: 'o usuário pergunta algo sobre o próprio computador: espaço livre, quantos discos, configuração, se o Windows ou o driver está atualizado, que mouse/teclado/placa de som tem, quantas fotos ou vídeos e onde, se um programa está instalado',
    oferta: 'Posso **consultar o seu computador** para ver isso (só leitura: espaço, configuração, drivers, periféricos, arquivos). Quer? É só responder **"sim"**.',
  },
  {
    id: 'ajustes_de_rede',
    executa: true,
    faz: 'muda ajustes da placa de rede com a aprovação do usuário e desfaz quando ele pedir: DNS (Cloudflare, Google ou automático), desligar a economia de energia da placa, limpar o cache de DNS, preferir 5 GHz no Wi-Fi',
    quando: 'o usuário quer mudar o DNS, otimizar ou configurar a placa de rede, limpar o cache de DNS, desligar a economia de energia da rede',
    oferta: 'Posso **ajustar a sua placa de rede** (DNS, economia de energia da placa, cache de DNS): mostro antes o que muda, você aprova e dá para desfazer. Quer? É só responder **"sim"**.',
  },
  {
    id: 'trafego_de_rede',
    executa: true,
    faz: 'mostra quanto a placa de rede está recebendo e enviando agora e quais programas estão conectados, e a quê',
    quando: 'o que está usando ou consumindo a internet, programa suspeito usando a rede, internet lenta sem motivo',
    oferta: 'Posso **ver agora o que está usando a sua internet**: o tráfego da placa de rede e os programas conectados. Quer? É só responder **"sim"**.',
  },
  { id: 'grafico', faz: 'monta gráficos interativos na resposta (colunas, linhas, área, pizza, projeção com estimativas) com dados pesquisados ou dados que o usuário der', quando: 'comparar números, evolução no tempo, partes de um total', comoUsar: 'peça "monte um gráfico com…"' },
  { id: 'visual', faz: 'cria uma página interativa que roda na resposta (calculadora, simulação, animação, quiz, painel)', quando: 'o usuário quer uma ferramenta interativa', comoUsar: 'peça "crie uma calculadora/simulação de…"' },
  { id: 'criar_imagem', precisa: 'gerarImagem', faz: 'cria e edita imagens no computador do usuário (FLUX.2 Klein)', quando: 'o usuário quer uma imagem, ilustração, logo ou edição de foto', comoUsar: 'peça "crie uma imagem de…" ou anexe a foto e peça a edição' },
  { id: 'buscar_imagens', executa: true, faz: 'busca fotos na internet de qualquer coisa e mostra numa galeria (com o site de cada foto)', quando: 'o usuário quer ver como algo é: um carro, um lugar, um setup, um produto, uma pessoa conhecida', oferta: 'Posso **buscar fotos** disso para você ver. Quer? É só responder **"sim"**.' },
  { id: 'ver_imagem', faz: 'olha fotos e prints anexados e lê o texto deles', quando: 'o usuário fala de algo que está numa foto ou print', comoUsar: 'anexe a imagem pelo + da caixa de mensagem' },
  { id: 'memoria', faz: 'guarda o que o usuário pede sobre ele (nome, cidade, preferências de resposta) e usa em todas as conversas', quando: 'o usuário quer que o AuGPT lembre algo dele ou se adapte de vez', comoUsar: 'diga "lembre que…"; para ver, "o que você sabe sobre mim?"; para apagar, "esqueça que…"' },
  { id: 'youtube', precisa: 'buscarNoYoutube', faz: 'assiste vídeos do YouTube pela legenda e lê os comentários', quando: 'review, tutorial ou opinião de quem testou em vídeo', comoUsar: 'peça "veja vídeos do YouTube sobre…"' },
  { id: 'navegador', faz: 'abre sites no navegador do AuGPT, faz login, clica, preenche formulários e baixa arquivos', quando: 'tarefa num site (portal, conta, formulário, download)', comoUsar: 'peça "acesse o site … e …" com o endereço' },
  { id: 'investigacao', faz: 'pesquisa longa por um tempo escolhido, com relatório completo em PDF', quando: 'assunto amplo que pede estudo aprofundado', comoUsar: 'escolha o modo Investigação no seletor de raciocínio, ao lado do campo de mensagem' },
  { id: 'onde_comprar', faz: 'mostra o preço de hoje nas lojas (KaBuM e comparadores) com link', quando: 'preço ou compra de um produto', comoUsar: 'pergunte o preço ou peça recomendação de produto' },
  { id: 'arquivos', faz: 'lê e cria arquivos na pasta de trabalho (planilhas, documentos, PDF, código)', quando: 'o usuário fala de um arquivo dele ou quer um arquivo pronto', comoUsar: 'diga o arquivo ou peça "crie uma planilha com…"' },
];

// do que fala uma promessa que essa capacidade cumpre (trava de promessa, abaixo)
const PALAVRAS = {
  teste_de_rede: /internet|velocidade|\bping\b|lat[êe]ncia|bufferbloat|download|upload|conex[ãa]o/i,
  rota_de_jogo: /servidor|\brota\b|tracert|\bping\b/i,
  diagnostico_da_rede: /roteador|rede (local|de casa)|aparelhos|dispositivos|wi-?fi|ipconfig|\bdns\b|gateway|placa de rede|raio-?x|\bsinal\b|\bcabo\b/i,
  trafego_de_rede: /tr[áa]fego|consum|(programas?|aplicativos?).{0,30}(conect|internet|rede)/i,
  buscar_imagens: /fotos?|imagens?|galeria/i,
  ajustes_de_rede: /\bdns\b|economia de energia|placa de rede|cache/i,
  consultar_pc: /computador|\bpc\b|disco|espa[çc]o|configura[çc]|driver|windows|mouse|teclado|monitor|placa de (som|v[íi]deo)|fotos|v[íi]deos|m[úu]sicas|programas|arquivos|mem[óo]ria|processador|bateria/i,
  grafico: /gr[áa]fico/i,
  visual: /calculadora|simula|anima|p[áa]gina interativa|painel interativo|quiz|interativ/i,
  criar_imagem: /imagem|ilustra|logo|desenh|\bfoto/i,
  ver_imagem: /\bfoto|print|imagem|anex/i,
  youtube: /v[íi]deo|youtube/i,
  navegador: /\bsite\b|navegador|login|formul[áa]rio|p[áa]gina|baix/i,
  investigacao: /investiga|relat[óo]rio|\bpdf\b|pesquis/i,
  onde_comprar: /pre[çc]o|\bloja|compr/i,
  arquivos: /arquivo|planilha|documento|\bpdf\b|pasta/i,
};

const POR_ID = new Map(CAPACIDADES.map((c) => [c.id, c]));
const EXECUTAVEIS = CAPACIDADES.filter((c) => c.executa).map((c) => c.id);

/** As capacidades disponíveis neste PC (as que dependem de componente só com ele instalado). */
const disponiveis = (deps = {}) => CAPACIDADES.filter((c) => !c.precisa || typeof deps[c.precisa] === 'function');

/** Para o entendimento: só as que executam, numa linha cada. */
const listaParaEntender = () => CAPACIDADES.filter((c) => c.executa).map((c) => `  "${c.id}": ${c.faz} (quando: ${c.quando})`).join('\n');

/** Para a escrita: tudo o que o AuGPT faz aqui. */
function blocoParaEscrever(deps = {}) {
  const linhas = disponiveis(deps).map((c) => `- ${c.faz}${c.comoUsar ? ` — ${c.comoUsar}` : ''}`);
  return `<o_que_o_augpt_faz>
O AuGPT roda no computador do usuário e, além de pesquisar, faz isto:
${linhas.join('\n')}
</o_que_o_augpt_faz>
Nunca diga que não consegue fazer algo desta lista (não diga "sou uma IA de texto", "não tenho acesso à sua rede"). Se uma destas capacidades ajuda no que o usuário quer, diga numa frase que o AuGPT faz isso e como pedir.
E só ofereça o que está nesta lista: o AuGPT NÃO abre programas do Windows (Gerenciador de Tarefas, Painel de Controle), não mexe no roteador nem monitora o PC em segundo plano. O que estiver fora da lista, explique como o usuário faz.`;
}

const valida = (id) => (POR_ID.has(String(id || '')) ? String(id) : null);

/** A oferta para o fim da resposta (só das que executam: o "sim" seguinte aciona). */
// as ofertas em inglês (23/10): fixas, para o "yes" continuar valendo (aceitouOferta confere as duas)
const OFERTAS_EN = {
  teste_de_rede: 'I can **test your internet now**: download, upload, ping and bufferbloat (the test uses up to ~300 MB). Want me to? Just reply **"yes"**, or **"just the ping"**, which uses almost no data.',
  rota_de_jogo: 'I can **measure your ping to the game servers** and show the route to the best one. Want me to? Just reply **"yes"**.',
  diagnostico_da_rede: 'I can **X-ray your network now**: cable or Wi-Fi, ping to the router, router model and how many devices are connected (read-only, nothing is changed). Want me to? Just reply **"yes"**.',
  consultar_pc: 'I can **check your computer** to see that (read-only: space, specs, drivers, peripherals, files). Want me to? Just reply **"yes"**.',
  ajustes_de_rede: 'I can **tune your network adapter** (DNS, adapter power saving, DNS cache): I show what changes first, you approve, and it can be undone. Want me to? Just reply **"yes"**.',
  trafego_de_rede: 'I can **see what is using your internet now**: the adapter traffic and the connected programs. Want me to? Just reply **"yes"**.',
};
const ofertaDe = (id, idioma = 'pt') => (POR_ID.get(id)?.executa ? (idioma === 'en' && OFERTAS_EN[id]) || POR_ID.get(id).oferta : null);
/** [português, inglês] de cada oferta: a tradução das respostas do código troca uma pela outra sem passar pelo modelo. */
const ofertasBilingues = () => CAPACIDADES.filter((c) => c.executa && c.oferta && OFERTAS_EN[c.id]).map((c) => [c.oferta, OFERTAS_EN[c.id]]);

const SIM = /^\s*(sim|s|pode|pode sim|pode testar|pode fazer|pode ver|quero|ok|okay|blz|beleza|manda|vai|claro|bora|faz|fa[cç]a|isso|por favor|claro que sim|yes|y|yeah|yep|sure|please|go ahead|do it|of course)\b/i;

/**
 * "sim" logo depois de uma oferta → a capacidade oferecida (e "só o ping" na oferta do teste de rede).
 * @returns { id, modo? } | null
 */
/** Oferta de pesquisa (item 3): o "sim" seguinte vira a pergunta "pesquise <assunto>". */
const ofertaDePesquisa = (assunto, idioma = 'pt') => (idioma === 'en' ? `Want me to research **${assunto}**? Just reply **"yes"**.` : `Quer que eu pesquise **${assunto}**? É só responder **"sim"**.`);

function aceitouOferta(texto, conversa = []) {
  const ultima = [...conversa].reverse().find((m) => m.role === 'assistant');
  if (!ultima) return null;
  const t = String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const pesquisa = /(?:Quer que eu pesquise|Want me to research) \*\*(.+?)\*\*\? (?:É só responder|Just reply)/.exec(String(ultima.content || ''));
  if (pesquisa && SIM.test(t) && t.length <= 60) return { id: 'pesquisa', pergunta: `pesquise ${pesquisa[1]}` };
  const oferecida = CAPACIDADES.find((c) => c.executa && [c.oferta, OFERTAS_EN[c.id]].some((o) => o && String(ultima.content || '').includes(o.slice(0, 40))));
  if (!oferecida) return null;
  if (oferecida.id === 'teste_de_rede' && /\bso (o )?(ping|latencia)\b|\bjust (the )?ping\b|\bonly (the )?ping\b/.test(t)) return { id: oferecida.id, modo: 'ping' };
  return SIM.test(t) && t.length <= 60 ? { id: oferecida.id } : null;
}

/**
 * Trava de promessa (18/10, conversa do Davi): sabendo que tem capacidades, o modelo pequeno inventou
 * outras — "o AuGPT pode rodar um teste de transferência local", "posso abrir o Gerenciador de
 * Tarefas". Frase em que o AuGPT promete FAZER algo e que não fala de nenhuma capacidade do catálogo
 * sai da resposta. Vale para qualquer texto escrito pelo modelo.
 * ponytail: casa pelas palavras da frase; "posso abrir o site X" passa (navegador), "posso abrir o
 * Painel de Controle" não — frase sem verbo de ação ("posso explicar", "posso pesquisar") fica sempre.
 */
const PROMESSA = /\b(posso|consigo|vou|irei|o augpt (pode|consegue|vai|ir[áa])|eu (posso|consigo|vou))\s+(?:[\wà-ú]+\s+){0,2}?(abrir|rodar|executar|acessar|monitorar|alterar|mudar|configurar|instalar|desinstalar|reiniciar|mostrar|verificar|medir|testar|analisar|desligar|ligar|limpar|otimizar|escanear|varrer|controlar|bloquear|acompanhar|fazer um teste|fazer uma varredura)\b([^.!?\n]{0,40})/gi;

/** Promessas da frase que nenhuma capacidade cumpre (confere o OBJETO: as ~40 letras depois do verbo). */
function promessasSemCapacidade(frase) {
  return [...String(frase).matchAll(PROMESSA)].filter((m) => !Object.values(PALAVRAS).some((re) => re.test(`${m[4]} ${m[5]}`)));
}

function conferirPromessas(texto) {
  const tiradas = [];
  const original = String(texto || '').split('\n');
  let noCodigo = false;
  const linhas = original.map((linha) => {
    if (/^\s*```/.test(linha)) noCodigo = !noCodigo;
    if (noCodigo || /^\s*(\||```|#)/.test(linha)) return linha;
    if (!promessasSemCapacidade(linha).length) return linha;
    const frases = linha.split(/(?<=[.!?])\s+(?=[*_\p{Lu}"(])/u);
    return frases
      .filter((f) => {
        const ruins = promessasSemCapacidade(f);
        if (ruins.length) tiradas.push(f.trim().slice(0, 140));
        return !ruins.length;
      })
      .join(' ');
  });
  // item de lista que ficou vazio ("- **Ação do AuGPT:**") sai junto
  const limpo = linhas.filter((l, i) => l === original[i] || !/^\s*([-*•]|\d+[.)])?\s*(\*\*[^*]*\*\*:?)?\s*$/.test(l)).join('\n');
  return { texto: limpo, tiradas };
}

/* ------------------------------ utilitários (a aba e o "o que você pode fazer?") ------------------------------ */

/**
 * Os cartões da aba Utilitários (19/10, pedido do Davi). A mesma lista responde
 * "o que você pode fazer?" no chat — o que a tela mostra e o que o AuGPT diz
 * nunca se desencontram. `exemplo` é o pedido que aciona o recurso (o botão
 * "Usar" manda ele ao agente); `precisa` é o componente que tem de estar
 * instalado; `so` = 'win32' para o que só existe no Windows; `rota` = a rota do código
 * (rotas-do-codigo.js) que o exemplo aciona — sem ela, o exemplo vai para a pesquisa.
 */
const UTILITARIOS = [
  { id: 'teste_de_velocidade', rota: 'teste_de_rede', grupo: 'Rede e internet', icone: 'velocidade', nome: 'Teste de velocidade', descricao: 'Download, upload, ping, jitter e bufferbloat da sua internet, com gráfico. Gasta até ~300 MB.', exemplo: 'teste minha internet' },
  { id: 'ping', rota: 'teste_de_rede', grupo: 'Rede e internet', icone: 'pulso', nome: 'Só o ping', descricao: 'Latência, jitter e perda, quase sem gastar dados.', exemplo: 'mede meu ping' },
  { id: 'rota_de_jogo', rota: 'rota_de_jogo', grupo: 'Rede e internet', icone: 'jogo', nome: 'Ping e rota para jogos', descricao: 'Ping até os servidores de PUBG, Fortnite, CS2, Dota 2, LoL e Valorant, e o caminho (tracert) até o melhor.', exemplo: 'qual meu ping nos servidores do PUBG?', so: 'win32' },
  { id: 'raio_x', rota: 'diagnostico_da_rede', grupo: 'Rede e internet', icone: 'raiox', nome: 'Raio-X da rede', descricao: 'Cabo ou Wi-Fi, sinal, ping até o roteador, modelo e firmware do roteador e a configuração (ipconfig).', exemplo: 'faça um raio-x da minha rede', so: 'win32' },
  { id: 'aparelhos', rota: 'diagnostico_da_rede', grupo: 'Rede e internet', icone: 'aparelhos', nome: 'Aparelhos na rede', descricao: 'Quantos aparelhos estão conectados e de que fabricante (celular, TV, casa inteligente…).', exemplo: 'quantos aparelhos estão conectados na minha rede?', so: 'win32' },
  { id: 'trafego', rota: 'trafego_de_rede', grupo: 'Rede e internet', icone: 'trafego', nome: 'O que usa a internet', descricao: 'Quanto a placa de rede está usando agora e quais programas estão conectados, e a quê.', exemplo: 'o que está consumindo minha internet?', so: 'win32' },
  { id: 'ajustes_de_rede', rota: 'ajustes_de_rede', grupo: 'Rede e internet', icone: 'ajustes', nome: 'Ajustes da placa de rede', descricao: 'DNS, economia de energia da placa, cache de DNS e 5 GHz. Mostra o plano antes, você aprova e dá para desfazer.', exemplo: 'otimize minha placa de rede', so: 'win32' },
  { id: 'espaco', rota: 'consultar_pc', grupo: 'Este computador', icone: 'disco', nome: 'Espaço e discos', descricao: 'Espaço livre de cada unidade e os discos físicos (SSD, HD, NVMe) com a saúde de cada um.', exemplo: 'quanto espaço livre meu pc tem?', so: 'win32' },
  { id: 'configuracao', rota: 'consultar_pc', grupo: 'Este computador', icone: 'cpu', nome: 'Configuração do PC', descricao: 'Processador, memória RAM (pentes e velocidade), placa-mãe, BIOS e placa de vídeo.', exemplo: 'qual a configuração do meu pc?', so: 'win32' },
  { id: 'windows', rota: 'consultar_pc', grupo: 'Este computador', icone: 'janela', nome: 'Windows atualizado?', descricao: 'Versão do Windows, últimas atualizações e as que estão esperando no Windows Update.', exemplo: 'meu windows está atualizado?', so: 'win32' },
  { id: 'drivers', rota: 'consultar_pc', grupo: 'Este computador', icone: 'placa', nome: 'Driver da placa de vídeo', descricao: 'Versão e data do driver; se for antigo, oferece pesquisar o mais novo.', exemplo: 'meu driver da placa de vídeo está atualizado?', so: 'win32' },
  { id: 'perifericos', rota: 'consultar_pc', grupo: 'Este computador', icone: 'mouse', nome: 'Periféricos e USB', descricao: 'Marca e modelo do mouse, teclado e monitor, câmera e aparelhos Bluetooth.', exemplo: 'qual a marca do meu mouse e do teclado?', so: 'win32' },
  { id: 'audio', rota: 'consultar_pc', grupo: 'Este computador', icone: 'som', nome: 'Placa de som e áudio', descricao: 'Se tem placa de som dedicada e quais saídas de áudio existem.', exemplo: 'eu tenho placa de som?', so: 'win32' },
  { id: 'arquivos_do_pc', rota: 'consultar_pc', grupo: 'Este computador', icone: 'fotos', nome: 'Fotos, vídeos e músicas', descricao: 'Quantos arquivos de cada tipo, quanto espaço ocupam e em que pastas estão — contados sem abrir nenhum.', exemplo: 'quantas fotos e vídeos eu tenho e onde estão?', so: 'win32' },
  { id: 'programas', rota: 'consultar_pc', grupo: 'Este computador', icone: 'programas', nome: 'Programas instalados', descricao: 'O que está instalado e em que versão.', exemplo: 'tenho o Discord instalado?', so: 'win32' },
  { id: 'inicializacao', rota: 'consultar_pc', grupo: 'Este computador', icone: 'ligar', nome: 'O que abre com o Windows', descricao: 'Os programas que iniciam sozinhos com o Windows.', exemplo: 'quais programas abrem junto com o windows no meu pc?', so: 'win32' },
  { id: 'leitura_livre', rota: 'leitura_livre', grupo: 'Este computador', icone: 'olho', nome: 'Ler outros dados do PC', descricao: 'Chipset e outros drivers, registro, políticas de grupo, serviços, ajustes da placa de rede… Pesquisa como ler e só lê: nada é mudado, e conteúdo de arquivos, senhas e área de transferência ficam de fora.', exemplo: 'meu driver do chipset está atualizado?', so: 'win32' },
  { id: 'pesquisa', grupo: 'Pesquisa', icone: 'lupa', nome: 'Pesquisa com fontes', descricao: 'Pesquisa na internet e responde citando as fontes, com a data de cada uma e conferindo os números.', exemplo: 'qual a melhor placa de vídeo até R$ 3.000?' },
  { id: 'onde_comprar', grupo: 'Pesquisa', icone: 'carrinho', nome: 'Produtos e onde comprar', descricao: 'Recomenda produtos em cartões, com o que a comunidade diz e o preço de hoje nas lojas.', exemplo: 'quais os melhores fones intra-auriculares para PUBG?' },
  { id: 'investigacao', grupo: 'Pesquisa', icone: 'relatorio', nome: 'Investigação com relatório', descricao: 'Pesquisa longa pelo tempo que você escolher, com um relatório completo em PDF.', dica: 'Escolha "Investigação" no seletor de raciocínio, ao lado do campo de mensagem, e faça a pergunta.' },
  { id: 'youtube', grupo: 'Pesquisa', icone: 'video', nome: 'Vídeos do YouTube', descricao: 'Assiste vídeos pela legenda e lê os comentários mais curtidos.', exemplo: 'veja vídeos de review do mouse Logitech G Pro X Superlight 2', precisa: 'youtube' },
  { id: 'grafico', grupo: 'Criar', icone: 'grafico', nome: 'Gráficos interativos', descricao: 'Colunas, linhas, área, pizza e projeção com estimativas, montados com os dados da pesquisa.', exemplo: 'monte um gráfico com o preço da RTX 5080 desde o lançamento' },
  { id: 'visual', grupo: 'Criar', icone: 'codigo', nome: 'Páginas interativas', descricao: 'Calculadoras, simulações, animações e quizzes que rodam dentro da resposta.', exemplo: 'crie uma calculadora de IMC interativa' },
  { id: 'buscar_imagens', rota: 'buscar_imagens', grupo: 'Pesquisa', icone: 'fotos', nome: 'Buscar imagens', descricao: 'Fotos de qualquer coisa — um carro, um lugar, um setup — numa galeria, com o site de onde cada uma veio.', exemplo: 'busque imagens de carros esportivos' },
  { id: 'criar_imagem', grupo: 'Criar', icone: 'pincel', nome: 'Criar imagens', descricao: 'Cria e edita imagens no seu computador, com o FLUX.2 Klein.', exemplo: 'crie uma imagem de um gato astronauta', precisa: 'imagem' },
  { id: 'ver_imagem', grupo: 'Criar', icone: 'olho', nome: 'Ler fotos e prints', descricao: 'Olha a foto ou o print que você anexar e lê o texto dele.', dica: 'Anexe a imagem pelo + da caixa de mensagem e faça a pergunta.' },
  { id: 'navegador', grupo: 'Sites e arquivos', icone: 'globo', nome: 'Navegar em sites', descricao: 'Abre sites no navegador do AuGPT, faz login, clica, preenche formulários e baixa arquivos.', exemplo: 'acesse https://www.kabum.com.br e procure monitores de 144 Hz' },
  { id: 'arquivos', grupo: 'Sites e arquivos', icone: 'arquivo', nome: 'Ler e criar arquivos', descricao: 'Lê e cria planilhas, documentos, PDFs e código na sua pasta de trabalho.', exemplo: 'crie uma planilha para eu anotar meus gastos do mês' },
  { id: 'memoria', rota: 'memoria', grupo: 'Você', icone: 'relatorio', nome: 'Memória sobre você', descricao: 'Guarda o que você pedir (nome, cidade, como prefere as respostas) e usa em todas as conversas. "Esqueça que…" apaga.', exemplo: 'lembre que eu prefiro respostas curtas e diretas' },
];

/** Os cartões com a disponibilidade neste PC: { ...cartão, disponivel, falta }. */
function utilitarios({ instalados = {}, plataforma = process.platform } = {}) {
  return UTILITARIOS.map((u) => {
    const falta = u.so && u.so !== plataforma ? 'só no Windows, por enquanto' : u.precisa && !instalados[u.precisa] ? `instale o ${u.precisa === 'imagem' ? 'Criar imagens' : 'YouTube'} em Ajustes → Componentes` : null;
    return { ...u, disponivel: !falta, falta };
  });
}

// "o que você pode fazer?", "quais utilitários você tem?", "me mostra seus recursos"
const PEDE_O_QUE_FAZ = /\b(o que (voce|vc|o augpt|tu) (pode|consegue|sabe|e capaz de) fazer|o que (voce|vc|o augpt) faz|quais (sao )?(os |as )?(seus|teus|suas|tuas) (utilitarios|recursos|ferramentas|capacidades|funcoes|funcionalidades|habilidades)|quais (utilitarios|recursos|ferramentas|capacidades|funcoes|funcionalidades|habilidades) (voce|vc|o augpt) (tem|possui|oferece)|me (mostre|mostra|diga|fala|liste|lista) (o que voce (pode|faz|sabe)|(os )?(seus )?(utilitarios|recursos|ferramentas))|lista de (utilitarios|recursos|ferramentas)|como (voce|vc) pode me ajudar)\b/;
const pedeOQueFaz = (texto) => PEDE_O_QUE_FAZ.test(String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());

/** A resposta de "o que você pode fazer?", montada pelo código com a mesma lista da aba. */
function textoDosUtilitarios(cartoes, idioma = 'pt') {
  // em inglês (23/10): o mesmo texto pelo dicionário da tela, sem passar pelo modelo
  const t = idioma === 'en' ? require('./i18n-do-app').emIngles : (s) => s;
  const grupos = [];
  for (const c of cartoes) {
    let g = grupos.find((x) => x.nome === c.grupo);
    if (!g) grupos.push((g = { nome: c.grupo, itens: [] }));
    g.itens.push(c);
  }
  const en = idioma === 'en';
  const linhas = [en ? 'I run on your computer and, besides searching the web, I do the following. Just ask in your own words (the examples below work):' : 'Rodo no seu computador e, além de pesquisar na internet, faço isto — é só pedir com as suas palavras (os exemplos abaixo funcionam):', ''];
  for (const g of grupos) {
    linhas.push(`**${t(g.nome)}**`);
    for (const c of g.itens) {
      const como = c.exemplo ? ` — ${en ? 'e.g.' : 'ex.:'} *"${t(c.exemplo)}"*` : c.dica ? ` — ${t(c.dica)}` : '';
      linhas.push(`- **${t(c.nome)}**: ${t(c.descricao)}${como}${c.disponivel ? '' : ` *(${t(c.falta)})*`}`);
    }
    linhas.push('');
  }
  if (en) linhas.push('All of this is also in the **Utilities** tab, on the left bar, with a button to use each one.', '', '*What is on your computer I only read: nothing is changed without your approval (as with the network adapter tuning), and nothing leaves it.*');
  else linhas.push('Tudo isso também está na aba **Utilitários**, na barra da esquerda, com um botão para usar cada um.', '', '*O que é do seu computador eu só leio — nada é mudado sem você aprovar (como nos ajustes da placa de rede), e nada sai dele.*');
  return linhas.join('\n');
}

module.exports = { UTILITARIOS, utilitarios, pedeOQueFaz, textoDosUtilitarios, ofertaDePesquisa, ofertasBilingues, conferirPromessas, PALAVRAS, CAPACIDADES, EXECUTAVEIS, disponiveis, listaParaEntender, blocoParaEscrever, valida, ofertaDe, aceitouOferta };
