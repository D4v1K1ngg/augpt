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
    id: 'trafego_de_rede',
    executa: true,
    faz: 'mostra quanto a placa de rede está recebendo e enviando agora e quais programas estão conectados, e a quê',
    quando: 'o que está usando ou consumindo a internet, programa suspeito usando a rede, internet lenta sem motivo',
    oferta: 'Posso **ver agora o que está usando a sua internet**: o tráfego da placa de rede e os programas conectados. Quer? É só responder **"sim"**.',
  },
  { id: 'grafico', faz: 'monta gráficos interativos na resposta (colunas, linhas, área, pizza, projeção com estimativas) com dados pesquisados ou dados que o usuário der', quando: 'comparar números, evolução no tempo, partes de um total', comoUsar: 'peça "monte um gráfico com…"' },
  { id: 'visual', faz: 'cria uma página interativa que roda na resposta (calculadora, simulação, animação, quiz, painel)', quando: 'o usuário quer uma ferramenta interativa', comoUsar: 'peça "crie uma calculadora/simulação de…"' },
  { id: 'criar_imagem', precisa: 'gerarImagem', faz: 'cria e edita imagens no computador do usuário (FLUX.2 Klein)', quando: 'o usuário quer uma imagem, ilustração, logo ou edição de foto', comoUsar: 'peça "crie uma imagem de…" ou anexe a foto e peça a edição' },
  { id: 'ver_imagem', faz: 'olha fotos e prints anexados e lê o texto deles', quando: 'o usuário fala de algo que está numa foto ou print', comoUsar: 'anexe a imagem pelo + da caixa de mensagem' },
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
  ajustes_de_rede: /\bdns\b|economia de energia|placa de rede|cache/i,
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
const ofertaDe = (id) => POR_ID.get(id)?.executa ? POR_ID.get(id).oferta : null;

const SIM = /^\s*(sim|s|pode|pode sim|pode testar|pode fazer|pode ver|quero|ok|okay|blz|beleza|manda|vai|claro|bora|faz|fa[cç]a|isso|por favor|claro que sim)\b/i;

/**
 * "sim" logo depois de uma oferta → a capacidade oferecida (e "só o ping" na oferta do teste de rede).
 * @returns { id, modo? } | null
 */
function aceitouOferta(texto, conversa = []) {
  const ultima = [...conversa].reverse().find((m) => m.role === 'assistant');
  if (!ultima) return null;
  const t = String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const oferecida = CAPACIDADES.find((c) => c.executa && String(ultima.content || '').includes(c.oferta.slice(0, 40)));
  if (!oferecida) return null;
  if (oferecida.id === 'teste_de_rede' && /\bso (o )?(ping|latencia)\b/.test(t)) return { id: oferecida.id, modo: 'ping' };
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

module.exports = { conferirPromessas, PALAVRAS, CAPACIDADES, EXECUTAVEIS, disponiveis, listaParaEntender, blocoParaEscrever, valida, ofertaDe, aceitouOferta };
