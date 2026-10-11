'use strict';

/**
 * Primeira execução e ajuste pelo hardware — Fase 2 (facilidade de uso,
 * 2026-09-23), pedido do Davi antes de publicar no GitHub: "rever facilidade
 * de uso e configurações para usuários".
 *
 * O que a auditoria achou: quem baixava o AuGPT sem o Ollama pronto travava
 * no primeiro minuto. Nenhum aviso quando o Ollama não estava instalado, o
 * aviso de "desligado" só aparecia uns 20 s depois, e todo erro mandava rodar
 * `ollama pull llama3.1` num terminal — mesmo existindo download de modelo
 * dentro do app, escondido nos Ajustes. E quem seguia o COMO-RODAR e baixava
 * também o `nomic-embed-text` podia ter ele escolhido como modelo de conversa.
 *
 * Tudo aqui é puro (sem Electron, sem rede), pra ser testado na bancada. O
 * processo principal junta os dados reais (saúde do Ollama, binário, modelos,
 * memória) e a interface só desenha o resultado.
 */

/**
 * Modelos de embedding não conversam — servem só pra memória. A família vem
 * do próprio Ollama (`details.family`); o nome cobre os mais comuns quando a
 * família não ajuda.
 */
const FAMILIAS_EMBEDDING = new Set(['nomic-bert', 'bert', 'xlm-roberta']);
const NOMES_EMBEDDING = /(embed|embedding|all-minilm|bge-|paraphrase-multilingual|snowflake-arctic-embed)/i;

function ehModeloDeEmbedding(modelo) {
  const nome = typeof modelo === 'string' ? modelo : modelo?.name;
  const familia = typeof modelo === 'string' ? '' : String(modelo?.family || '').toLowerCase();
  return FAMILIAS_EMBEDDING.has(familia) || NOMES_EMBEDDING.test(String(nome || ''));
}

/**
 * Modelos de DECISÃO (revisão v5, 08/10/2026): tev1 e Nimble só escolhem
 * entre opções pelo endpoint /v1/systemone — como modelo de conversa dão
 * "Jinja Exception: System message must be at the beginning" (Davi pôs o
 * tev1 como principal) ou respostas inúteis (como copiloto, 0 críticas
 * aproveitadas em 11 consultas). O Ollama marca "decision" nas capacidades;
 * o nome cobre instalação que não informa.
 */
const NOMES_DECISAO = /^(?:[\w.-]+\/)?(tev\d*|nimble|clef)(?:[:\-_]|$)/i;

function capacidadesDe(modelo) {
  return typeof modelo === 'string' ? [] : (modelo?.capacidades || modelo?.capabilities || []).map((c) => String(c).toLowerCase());
}

function ehModeloDeDecisao(modelo) {
  const nome = typeof modelo === 'string' ? modelo : modelo?.name;
  return capacidadesDe(modelo).includes('decision') || NOMES_DECISAO.test(String(nome || ''));
}

/**
 * Modelos que "pensam" antes de responder (DeepSeek R1, QwQ…): no teste de
 * 08/10 o R1 gerou 33 mil tokens numa execução (10× o Qwen), 11 respostas
 * bateram o limite de 1024 tokens raciocinando e a GPU ficou 12 min sem
 * folga. Não são bloqueados — só marcados e avisados.
 */
const NOMES_QUE_PENSAM = /(deepseek-r1|\bqwq\b|magistral|reasoning|openthinker|r1-distill|-thinking\b|:\S*think)/i;

function ehModeloQuePensa(modelo) {
  const nome = typeof modelo === 'string' ? modelo : modelo?.name;
  return capacidadesDe(modelo).includes('thinking') || NOMES_QUE_PENSAM.test(String(nome || ''));
}

/**
 * Separa a lista do Ollama: conversa (com `pensa` marcado), embedding e
 * decisão — estes dois últimos nunca aparecem como opção de conversa.
 */
function separarModelos(modelos = []) {
  const conversa = [];
  const embedding = [];
  const decisao = [];
  for (const m of modelos) {
    if (ehModeloDeEmbedding(m)) embedding.push(m);
    else if (ehModeloDeDecisao(m)) decisao.push(m);
    else conversa.push(ehModeloQuePensa(m) ? { ...m, pensa: true } : m);
  }
  return { conversa, embedding, decisao };
}

/**
 * Modelo sugerido pela memória TOTAL do computador — não a livre: `os.freemem()`
 * sub-reporta (cache de disco conta como "usado", e no macOS quase sempre parece
 * cheio), e o que decide se o modelo cabe é o total. Tamanhos são os downloads
 * do catálogo do Ollama na quantização padrão, arredondados.
 */
const MODELOS_POR_MEMORIA = [
  { ateGB: 12, nome: 'llama3.2:3b', rotulo: 'Llama 3.2 3B', downloadGB: 2.0,
    motivo: 'leve o bastante pra um computador com pouca memória; responde mais devagar e erra mais que os maiores' },
  { ateGB: 28, nome: 'llama3.1:8b', rotulo: 'Llama 3.1 8B', downloadGB: 4.9,
    motivo: 'o equilíbrio recomendado entre qualidade e velocidade pra este computador' },
  { ateGB: Infinity, nome: 'qwen2.5:14b', rotulo: 'Qwen 2.5 14B', downloadGB: 9.0,
    motivo: 'este computador tem memória de sobra pra um modelo maior, que segue melhor instruções longas' },
];

const MODELO_EMBEDDING_PADRAO = { nome: 'nomic-embed-text', rotulo: 'Nomic Embed Text', downloadGB: 0.3 };

function recomendarModelo(ramTotalGB) {
  const ram = Number(ramTotalGB) || 0;
  const escolhido = MODELOS_POR_MEMORIA.find((m) => ram < m.ateGB) || MODELOS_POR_MEMORIA[MODELOS_POR_MEMORIA.length - 1];
  const { ateGB, ...resto } = escolhido; // eslint-disable-line no-unused-vars
  return resto;
}

/**
 * Padrões mais leves pra computador com pouca memória, aplicados UMA vez, só
 * numa instalação nova (config.json ainda não existia) — nunca mexe no que um
 * usuário existente já tem. Janela de contexto de 16384 com um modelo de 3B na
 * CPU de uma máquina de 8 GB deixava cada pedido em minutos; o autoteste de
 * skills roda chamadas extras de modelo em segundo plano depois de cada pedido.
 */
function padroesPorHardware(ramTotalGB) {
  const ram = Number(ramTotalGB) || 0;
  if (ram > 0 && ram < 12) return { numCtx: 8192, criacaoAutomaticaDeSkills: false };
  return {};
}

/**
 * Em que passo da preparação o usuário está. `pronto` só quando o Ollama
 * responde e existe pelo menos um modelo de conversa.
 */
function diagnosticarPrimeiroUso({ online, binarioEncontrado, modelos = [], ramTotalGB = 0, embedModel = 'nomic-embed-text' } = {}) {
  const { conversa, embedding } = separarModelos(modelos);
  let etapa = 'pronto';
  if (!online) etapa = binarioEncontrado ? 'ollama-desligado' : 'sem-ollama';
  else if (!conversa.length) etapa = 'sem-modelo';
  const base = String(embedModel || '').split(':')[0];
  return {
    etapa,
    online: Boolean(online),
    binarioEncontrado: Boolean(binarioEncontrado || online),
    modelosConversa: conversa.map((m) => m.name),
    temEmbedding: embedding.some((m) => String(m.name).split(':')[0] === base),
    recomendado: recomendarModelo(ramTotalGB),
    embedding: MODELO_EMBEDDING_PADRAO,
    ramTotalGB: Number(ramTotalGB) || 0,
  };
}

/**
 * Traduz erros técnicos (vindos do Ollama, do fetch do Node, do sistema) em
 * uma frase que diz o que aconteceu e o que fazer. Devolve `null` quando não
 * reconhece — aí a mensagem original é mostrada como está.
 */
function mensagemAmigavel(erro) {
  const texto = String(erro?.message || erro || '');
  if (!texto) return null;
  // o Ollama devolve o erro em JSON, então as aspas chegam escapadas: model \"x\" not found
  const modelo = /model\s+\\?["']?([^"'\\\s]+)\\?["']?\s+not found/i.exec(texto)?.[1];
  if (modelo) {
    return `O modelo "${modelo}" não está baixado no Ollama. Escolha outro no seletor "modelo" do topo, ou baixe esse na tela inicial do Agente.`;
  }
  if (/ECONNREFUSED|fetch failed|connect ECONN|ENOTFOUND 127|socket hang up|Ollama 50[23]/i.test(texto)) {
    return 'O Ollama parou de responder. Confira se ele está aberto (o indicador no topo mostra o estado) e tente de novo.';
  }
  if (/timeout|aborted due to timeout/i.test(texto) && !/interromp/i.test(texto)) {
    return 'O modelo demorou demais pra responder. Em computador sem placa de vídeo isso é comum com modelos grandes: tente o raciocínio "leve" ou um modelo menor.';
  }
  if (/System message must be at the beginning|Jinja Exception/i.test(texto)) {
    return 'Este modelo não conversa: é um modelo de decisão (como o tev1), que só escolhe entre opções. Em Ajustes, escolha um modelo de conversa, como o qwen2.5:7b, como principal e como copiloto.';
  }
  if (/out of memory|cudaMalloc|requires more system memory|insufficient memory/i.test(texto)) {
    return 'Faltou memória pra carregar o modelo. Escolha um modelo menor, ou reduza a janela de contexto em Ajustes → Avançado.';
  }
  if (/Nenhum provedor de busca|todos os provedores/i.test(texto)) {
    return 'Nenhum buscador respondeu agora. Os buscadores públicos às vezes limitam o acesso — tente de novo em alguns minutos, ou ative o SearXNG embutido em Ajustes.';
  }
  return null;
}

module.exports = {
  ehModeloDeEmbedding, separarModelos, recomendarModelo, padroesPorHardware,
  diagnosticarPrimeiroUso, mensagemAmigavel, MODELOS_POR_MEMORIA, MODELO_EMBEDDING_PADRAO,
  ehModeloDeDecisao,
  ehModeloQuePensa,
};
