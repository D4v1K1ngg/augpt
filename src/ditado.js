'use strict';

/**
 * Ditado por voz (24/10, pedido do Davi): você fala, o AuGPT escreve. 100% local, com o whisper.cpp
 * (github.com/ggml-org/whisper.cpp) e o modelo Whisper large-v3-turbo quantizado — bom em português,
 * com pontuação, e reconhece sozinho se a fala é em português ou inglês.
 *
 * Roda no PROCESSADOR de propósito: a placa de vídeo fica com o modelo do Ollama (numa placa de 8 GB,
 * o Whisper na GPU empurrava o qwen para a RAM). Instala só no clique, em <dados>/componentes/ditado:
 * o binário e o modelo têm o SHA-256 conferido contra o publicado (fixo aqui, por versão).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { baixarConferindo } = require('./gerador-de-imagens');

// whisper.cpp 1.9.5 (build b5454, 06/10/2026) — binário para processador x64
const BINARIO = {
  versao: '1.9.5',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  bytes: 8928640,
};
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELOS = {
  turbo: { nome: 'Whisper large-v3-turbo', arquivo: 'ggml-large-v3-turbo-q5_0.bin', sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', bytes: 574041195 },
  // para processador fraco (até 4 núcleos): menos preciso, ~3x mais rápido
  pequeno: { nome: 'Whisper small', arquivo: 'ggml-small-q5_1.bin', sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', bytes: 190085487 },
};
// a escuta do "Ei GPT" (25/10): cada frase curta passa por um modelo pequeno no processador (o turbo
// levava ~2 s — quase tudo carregando 574 MB a cada vez); o pedido em si continua com o turbo.
// Medido no PC do Davi: o small em ~0,6 s, e escreve "Ei GPT" certo em português; o base em ~0,2 s,
// mas errava mais o português ("HGPT", "HG PT") — fica como alternativa mais leve.
const MODELOS_DA_ESCUTA = {
  small: MODELOS.pequeno, // o mesmo arquivo do ditado em processador fraco
  base: { nome: 'Whisper base', arquivo: 'ggml-base-q5_1.bin', sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', bytes: 59707625 },
};
const MODELO_DA_ESCUTA = MODELOS_DA_ESCUTA.base; // compatibilidade
const MB = (b) => `${Math.round(b / 1e6)} MB`;

/* ------------------------------ "Ei GPT" (25/10) ------------------------------ */
const compacto = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// como o Whisper escreve "Ei GPT" (medido: "HGPT", "HG PT", "E aí GPT.", "Hey GPT!", "eI GPT,"), sem espaços
const CHAMADA = /^(ei|eii|hei|hey|hay|ey|ai|eai|e|he|h|a|oi|ok)?(gpt|gepete|gepet|gepte|gpte|gepeto|jipiti|jpt|chatgpt)$/;

/** Distância de edição (letras trocadas, a mais ou a menos). */
function distancia(a, b) {
  const linha = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = linha[0];
    linha[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const antes = linha[j];
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = antes;
    }
  }
  return linha[b.length];
}

/**
 * A "chave de som" de uma palavra: o Whisper escreve a mesma pronúncia de jeitos diferentes
 * ("Jeppetti", "Geppetti", "Juppetti" — medido no teste do treino). Sem o h, j = g, y = i, k/q = c,
 * w = u, z = s, ch = x, e sem letras dobradas.
 */
const chaveDeSom = (t) => String(t || '').replace(/ch/g, 'x').replace(/h/g, '').replace(/j/g, 'g').replace(/y/g, 'i').replace(/[kq]/g, 'c').replace(/w/g, 'u').replace(/z/g, 's').replace(/(.)\1+/g, '$1');

// o treino (25/10) guarda como o Whisper escreve a SUA pronúncia; vale com ~1 letra de diferença a cada 5
// na chave de som (variante com menos de 5 letras na chave só vale exata)
// o miolo da chamada, sem o "ei/hey/hay" da frente — é o começo que mais varia na escrita do Whisper
// ("Hey Geppetti" × "Hay-ey-ja petty": miolo "gepeti" × "gapeti", medido no teste do treino)
const miolo = (k) => k.replace(/^(ai|ei|e|a|i|oi)+/, '');
function bateVariante(junto, variantes) {
  const k = chaveDeSom(junto);
  const parecido = (a, b) => {
    if (a === b) return true;
    const tolera = b.length >= 5 ? Math.max(1, Math.floor(b.length / 5)) : 0;
    return tolera > 0 && Math.abs(b.length - a.length) <= tolera && distancia(b, a) <= tolera;
  };
  return variantes.some((v) => {
    const kv = chaveDeSom(v);
    return parecido(k, kv) || (miolo(kv).length >= 5 && parecido(miolo(k), miolo(kv)));
  });
}

// palavra de enchimento que pode vir antes da chamada ("Hey, hey, Juppetti", "Ah, ei GPT")
const ENCHIMENTO = /^(e|ei|eh|ah|ai|oi|hey|hei|ei|ok|entao|bom|olha)$/;

/**
 * O FORMATO do som de "gê-pê-tê" (25/10, pelo registro real do Davi: o Whisper escreveu a mesma chamada
 * como "jepeite", "jipete", "Egypte", "e a CPT", "Jepetinho", "EJPT", "jepeta"): sem o "ei/e aí" da frente,
 * um som de j/g/ch, vogal, p, vogal(is), t, vogal — ou j/g/ch + p + t juntos ("gpt", "cpt").
 * "Ei, já pedi" (g-a-p-e-d), "gente", "gaveta", "depois" não têm esse formato. D no lugar do T só
 * depois de "e/i" ("chepe de"), nunca de "a" ("já pedi").
 */
const SOM_DE_GPT = /^(?:[gx][aeiou]{1,2}p[aeiou]{0,2}t[aeiou]{0,2}(?:n[aeiou]{1,2})?|[gx][ei][aeiou]?p[aeiou]{0,2}d[aeiou]{1,2}|[gcx]p[aeiou]?t[aeiou]{0,2})$/;
const temSomDeGPT = (junto) => {
  const k = miolo(chaveDeSom(junto));
  return k.length >= 3 && k.length <= 10 && SOM_DE_GPT.test(k);
};

/*
 * O NOME que chama o assistente (25/10, pedido do Davi: "Ei GPT fica difícil para a identificação" —
 * escolhido na boas-vindas e em Ajustes; sugestões fáceis de reconhecer, como "Jarvis"). "GPT" (o padrão)
 * mantém as regras próprias acima; outro nome é comparado pela chave de som, com ~1 letra de diferença a
 * cada 4. O "ei/ok/hey" da frente é opcional ("Jarvis" e "Ei Jarvis" chamam).
 */
let NOME = { ehGpt: true, chave: '', texto: 'Ei GPT' };
function definirNome(nome) {
  const t = compacto(nome).replace(/^(ei|hey|ok|oi|ola)\s+/, '');
  const junto = t.replace(/\s+/g, '');
  const ehGpt = !junto || /^(gpt|augpt|chatgpt|eigpt)$/.test(junto);
  NOME = { ehGpt, chave: ehGpt ? '' : miolo(chaveDeSom(junto)), texto: ehGpt ? 'Ei GPT' : String(nome).trim() };
  return NOME;
}
const nomeAtual = () => NOME;
const toleranciaDoNome = () => (NOME.chave.length >= 4 ? Math.max(1, Math.floor(NOME.chave.length / 4)) : 0);
function temSomDoNome(junto) {
  if (NOME.ehGpt) return temSomDeGPT(junto);
  const k = miolo(chaveDeSom(junto));
  if (!k) return false;
  if (k === NOME.chave) return true;
  const tol = toleranciaDoNome();
  return tol > 0 && Math.abs(k.length - NOME.chave.length) <= tol && distancia(k, NOME.chave) <= tol;
}
/**
 * O começo do texto LEMBRA o nome (bem mais folgado que reconhecer): para a decisão junto com o som da
 * voz (renderer/voz.js) — "Hay-ey-ja petty" lembra "GPT"; "o jogo foi bom" não lembra "Jarvis".
 */
function lembraONome(texto) {
  const palavras = compacto(texto).split(' ').filter(Boolean);
  for (let de = 0; de <= Math.min(1, palavras.length - 1); de += 1) {
    let junto = '';
    for (let i = de; i < Math.min(de + 3, palavras.length); i += 1) {
      junto += palavras[i];
      const k = miolo(chaveDeSom(junto));
      if (NOME.ehGpt ? /p.*t/.test(k) && k.length <= 12 : k && Math.abs(k.length - NOME.chave.length) <= Math.max(2, Math.floor(NOME.chave.length / 2)) && distancia(k, NOME.chave) <= Math.max(2, Math.floor(NOME.chave.length / 2))) return true;
    }
  }
  return false;
}

/** O começo do texto lembra uma variante aprendida (folgado: até metade das letras) — para a decisão com o som. */
function lembraVariante(texto, variantes = []) {
  if (!variantes.length) return false;
  const palavras = compacto(texto).split(' ').filter(Boolean);
  let junto = '';
  for (let i = 0; i < Math.min(4, palavras.length); i += 1) {
    junto += palavras[i];
    const k = miolo(chaveDeSom(junto));
    if (variantes.some((v) => {
      const kv = miolo(chaveDeSom(v));
      const tol = Math.max(2, Math.floor(kv.length / 2));
      return kv.length >= 4 && Math.abs(kv.length - k.length) <= tol && distancia(kv, k) <= tol;
    })) return true;
  }
  return false;
}

/** Quantas palavras do começo do texto são a chamada (0 = não chamou). Olha até as 4 primeiras (5 com enchimento). */
function palavrasDaChamada(texto, variantes = []) {
  const palavras = compacto(texto).split(' ').filter(Boolean);
  const tentar = (de) => {
    let junto = '';
    for (let i = de; i < Math.min(de + 4, palavras.length); i += 1) {
      junto += palavras[i];
      if ((NOME.ehGpt && (CHAMADA.test(junto) || CHAMADA.test(chaveDeSom(junto)))) || temSomDoNome(junto) || bateVariante(junto, variantes)) return i + 1;
    }
    return 0;
  };
  return tentar(0) || (ENCHIMENTO.test(palavras[0] || '') ? tentar(1) : 0);
}
const ehChamada = (texto, variantes = []) => palavrasDaChamada(texto, variantes) > 0;

// o que nunca vira variante: começo comum de frase ("Ei.", "E aí", "Oi", "Hey") dispararia o tempo todo
const COMUM = /^(e|ei|eii|eai|ai|hey|hei|ok|oi|ola|alo|aham|hum|hmm|uhum|sim|nao|obrigado|obrigada|tchau|legenda[a-z]*|amara[a-z]*)$/;
/**
 * O treino: das frases "Ei GPT" que você gravou, como o Whisper escreveu cada uma (sem espaços).
 * Ficam de fora o vazio, o curto demais (menos de 5 letras), a frase longa (não é a chamada) e o
 * começo comum de frase. → { variantes, recusadas }
 */
function variantesDoTreino(textos) {
  const variantes = [];
  const recusadas = [];
  for (const t of textos) {
    const palavras = compacto(t).split(' ').filter(Boolean);
    const junto = palavras.join('');
    if (!junto || (NOME.ehGpt && (CHAMADA.test(junto) || CHAMADA.test(chaveDeSom(junto)))) || temSomDoNome(junto)) continue; // vazio, ou já reconhecida sem treino
    if (palavras.length > 4 || !varianteValida(junto)) recusadas.push(t);
    else if (!variantes.includes(junto)) variantes.push(junto);
  }
  return { variantes, recusadas };
}

/**
 * Pode ser o "Ei GPT" de alguém? 5 a 16 letras, não é começo comum de frase nem o que o Whisper escreve
 * no ruído, e soa como "GPT": um p e depois um t (25/10: "somdebarulho" — o teclado — tinha virado
 * variante no treino e o AuGPT passou a ser chamado pela digitação).
 */
function varianteValida(junto) {
  const k = String(junto || '');
  // o ruído também chega sem espaços ('somdebarulho'): a lista confere das duas formas
  if (k.length < 4 || k.length > 18 || COMUM.test(k) || ALUCINACAO.test(k) || ALUCINACAO_JUNTO.test(k)) return false;
  // "GPT": um p e depois um t; outro nome: a variante tem que lembrar o nome escolhido
  if (NOME.ehGpt) return k.length >= 5 && /p.*t/.test(chaveDeSom(k));
  // outro nome (26/10): vale o que o Whisper escreveu quando VOCÊ disse o nome — no PC do Davi, "Ei Jarvis"
  // virou "Age of Elvis" no treino. Variante só entra pelo treino, pela repetição ou pelo "Era eu chamando"
  // (sempre você chamando), e a escuta ainda confere com o som da voz quando o texto não basta.
  // 27/10 (registro do Davi): "agora" tinha virado variante de "Jarvis" e "Agora é certo" chamava. Agora a
  // variante tem que lembrar o nome em algum ponto do fim ("vocetaaijarvis", "daijervis", "javes").
  for (let i = 0; i <= Math.max(0, k.length - 3); i += 1) if (lembraONome(k.slice(i)) || temSomDoNome(k.slice(i))) return true;
  return false;
}
const variantesValidas = (lista) => (Array.isArray(lista) ? lista : []).filter((v) => typeof v === 'string' && varianteValida(v));

/** O treino soma (25/10, "quanto mais eu treinar, melhor"): as novas na frente, sem repetir, até 24. */
const juntarVariantes = (novas, antigas) => [...new Set([...novas, ...variantesValidas(antigas)])].filter(varianteValida).slice(0, 24);

/**
 * Como a chamada foi escrita, para aprender: "Ei Jipitê, que horas são?" → "eijipite". Da frase que
 * chamou, as palavras da chamada; da frase que NÃO chamou ("era eu chamando" no registro), as primeiras
 * 1 a 3 palavras que soam como "GPT". null se nada serve.
 */
function chamadaEscrita(texto, variantes = []) {
  let palavras = compacto(texto).split(' ').filter(Boolean);
  // "Hey, hey, Juppetti" → "hey juppetti": enchimento repetido fica um só
  while (palavras.length > 2 && ENCHIMENTO.test(palavras[0]) && ENCHIMENTO.test(palavras[1])) palavras = palavras.slice(1);
  const n = palavrasDaChamada(palavras.join(' '), variantes);
  const ate = n || [1, 2, 3].find((i) => i <= palavras.length && varianteValida(palavras.slice(0, i).join(''))) || 0;
  const junto = palavras.slice(0, ate).join('');
  return ate && varianteValida(junto) ? junto : null;
}

/**
 * O limite de fala da escuta pelo volume da sua voz no treino: 35% da média dos picos, entre 0,002
 * e 0,012 (o padrão é 0,006). Microfone de mesa longe da boca fica bem abaixo do padrão.
 */
function sensibilidadeDoTreino(niveis) {
  const validos = (niveis || []).filter((n) => Number.isFinite(n) && n > 0);
  if (!validos.length) return null;
  const media = validos.reduce((a, b) => a + b, 0) / validos.length;
  return Math.round(Math.min(0.012, Math.max(0.002, media * 0.35)) * 10000) / 10000;
}

/** O pedido sem a chamada: "Ei GPT, que horas são?" → "que horas são?" (com a primeira letra maiúscula). */
function semChamada(texto, variantes = []) {
  const n = palavrasDaChamada(texto, variantes);
  if (!n) return String(texto || '').trim();
  // anda pelas palavras do texto original (com pontuação) até passar as n da chamada
  const partes = String(texto).trim().split(/\s+/);
  let contadas = 0;
  let i = 0;
  while (i < partes.length && contadas < n) {
    contadas += compacto(partes[i]).split(' ').filter(Boolean).length;
    i += 1;
  }
  const resto = partes.slice(i).join(' ').replace(/^[\s,.;:!?…-]+/, '').trim();
  return resto ? resto[0].toUpperCase() + resto.slice(1) : '';
}

/**
 * O pedido falado sem chamada no meio e sem frase repetida (26/10, no app: "Procure por vídeos dessa placa
 * de vídeo. E aí, AuGPT. Procure por vídeos dessa placa de vídeo." — chamou de novo no meio e repetiu).
 */
function limparPedidoFalado(texto, variantes = []) {
  const frases = String(texto || '').split(/(?<=[.!?…])\s+/).filter(Boolean);
  const vistas = new Set();
  const saida = [];
  for (const f of frases) {
    if (palavrasDaChamada(f, variantes) && !semChamada(f, variantes)) continue; // a frase é só a chamada
    const k = compactoFrase(f);
    if (!k || vistas.has(k)) continue;
    vistas.add(k);
    saida.push(f);
  }
  return saida.join(' ').trim();
}

/** Comando direto, sem passar pelo modelo: 'nova-conversa', 'parar' ou null. */
function comandoDeVoz(texto) {
  const t = compacto(texto);
  if (/^((abr[ae]|abrir|comec[ae]|comecar|inici[ae]|iniciar|nova|uma) )?(uma )?nova conversa( por favor)?$|^(new|start a new) (chat|conversation)$/.test(t)) return 'nova-conversa';
  if (/^(para|pare|parar|cancela|cancele|cancelar|chega|stop|cancel)( (tudo|isso|a resposta|de responder))?( por favor)?$/.test(t)) return 'parar';
  // 28/10: o seletor "Conversar" do Agente pela voz
  if (/^((agora )?(vamos|bora|quero|pode|vamo) )?(so )?conversar( (um pouco|comigo|so))?( por favor)?$|^(modo (de )?conversa|so conversa)( por favor)?$|^(let'?s )?just chat$/.test(t)) return 'so-conversar';
  if (/^((pode|volta a|volte a|voltar a) )?pesquisar (de novo|novamente)( por favor)?$|^(sai|sair) do modo (de )?conversa$|^(modo (de )?pesquisa|pesquisa automatica)$|^(you can )?research again$/.test(t)) return 'pesquisar';
  return null;
}

/**
 * O que o AuGPT acabou de perguntar ou oferecer (30/10, conversa do Davi: depois de 'Responda "pode testar" para
 * seguir, ou "só o ping"', o "pode testar" falado saiu "Pais testa." e virou pesquisa): a última pergunta do fim da
 * resposta anterior e as respostas que ele mesmo sugeriu entre aspas — vão para a CORREÇÃO pelo modelo, não para o
 * Whisper: frase na dica (--prompt) ele trata como já dita e tira da transcrição (25/10, com o "Ei GPT").
 * @returns {{ pergunta: string, respostas: string[] }}
 */
function contextoDaFala(resposta) {
  const t = String(resposta || '').split(/\n-{3,}\s*\n/)[0].replace(/```[\s\S]*?```/g, ' ').replace(/[*_#`>|]/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().slice(-500);
  const perguntas = t.match(/[^.!?]*\?/g);
  const respostas = [...t.matchAll(/["“]([^"”]{1,40})["”]/g)].map((m) => m[1].trim()).filter((r) => r && r.split(/\s+/).length <= 6);
  return { pergunta: perguntas ? perguntas[perguntas.length - 1].trim().slice(-200) : '', respostas: [...new Set(respostas)].slice(0, 4) };
}

/**
 * A fala curta que soa como uma das respostas que o AuGPT sugeriu vira essa resposta (30/10: "Pais testa." era
 * "pode testar" — e nem com o contexto o modelo da correção trocava). Mesmo número de palavras (±1), cada palavra
 * com a mesma inicial ("pode parar" não vira "pode testar") e no máximo ~45% de letras diferentes.
 */
function respostaSugeridaParecida(texto, contexto = '') {
  const { respostas } = contextoDaFala(contexto);
  if (!respostas.length) return null;
  const limpa = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const a = limpa(texto);
  const pa = a.split(' ').filter(Boolean);
  if (!pa.length || pa.length > 5) return null;
  for (const r of respostas) {
    const b = limpa(r);
    const pb = b.split(' ').filter(Boolean);
    if (a === b) return r;
    if (Math.abs(pa.length - pb.length) > 1) continue;
    const pares = Math.min(pa.length, pb.length);
    let mesmasIniciais = true;
    for (let i = 0; i < pares; i += 1) if (pa[i][0] !== pb[i][0]) mesmasIniciais = false;
    if (mesmasIniciais && distancia(a, b) <= Math.max(2, b.length * 0.45)) return r;
  }
  return null;
}

/** O pedido para o modelo corrigir o que o Whisper ouviu (com o que o AuGPT acabou de perguntar, se houver). */
function pedidoDeCorrecao(texto, idioma = 'pt', contexto = '') {
  const { pergunta, respostas } = contextoDaFala(contexto);
  if (!pergunta && !respostas.length) return pedidoDeCorrecaoSemContexto(texto, idioma);
  const disse = [pergunta && `perguntou: "${pergunta}"`, respostas.length && `sugeriu responder: ${respostas.map((r) => `"${r}"`).join(' ou ')}`].filter(Boolean).join('; e ');
  return `${pedidoDeCorrecaoSemContexto(texto, idioma).replace(/\n\nTranscrição: [\s\S]*$/, '')}
Logo antes, o AuGPT ${disse}. A fala pode ser a resposta a isso — se a transcrição soa parecida com uma dessas respostas, corrija para ela.

Transcrição: ${texto}`;
}

/** O pedido para o modelo corrigir o que o Whisper ouviu. */

function pedidoDeCorrecaoSemContexto(texto, idioma = 'pt') {
  return `Você corrige transcrições de fala feitas por reconhecimento de voz${idioma === 'en' ? ' (em inglês)' : ' (em português do Brasil)'}.
São pedidos para o AuGPT, um assistente no computador que pesquisa na web, compara preços em lojas, vê o clima, mostra mapas e rotas, marca lembretes na agenda, faz teste de rede (velocidade, ping), vê vídeos do YouTube e responde sobre o PC.
Corrija SÓ: palavras ouvidas errado (pelo sentido da frase — ex.: "ritmo de rede" → "teste de rede", "pingue" → "ping"), ortografia, acentos, pontuação e nomes de produtos, marcas e termos de tecnologia (ex.: "RTX 5080", "Ryzen 7 9800X3D", "PlayStation 5", "PUBG").
NUNCA troque nomes de cidades, lugares, pessoas ou produtos por outros parecidos ou mais conhecidos: se o nome existe, mesmo pouco conhecido (ex.: "Iconha"), deixe como está.
NÃO responda ao que foi dito, NÃO acrescente nem tire informação, NÃO troque palavra certa por sinônimo ("quanto está" continua "quanto está"), NÃO mude o sentido nem o jeito de falar. Frase repetida em seguida fica uma vez só. Se já estiver certo, devolva igual.
Devolva só o texto corrigido, sem aspas e sem explicação.

Transcrição: ${texto}`;
}

/** Aceita a correção só se ela parece a mesma frase (nada de resposta, explicação ou texto inventado). */
function correcaoAceitavel(original, corrigido) {
  // o original já sem a frase repetida ("Qual a data de hoje? Qual a data de hoje?"): a medida do tamanho é dele
  const o = semRepeticao(String(original || '').trim()) || String(original || '').trim();
  const c = String(corrigido || '').trim().replace(/^["'“”«]+|["'“”»]+$/g, '').trim();
  if (!c || c.length > o.length * 1.6 + 20 || c.length < o.length * 0.5) return null;
  if (/\n\s*\n|^(aqui est|claro|a transcri|texto corrigido|corrigido:)/i.test(c)) return null;
  // metade das palavras do original (de 4+ letras) continuam lá
  const palavras = compacto(o).split(' ').filter((p) => p.length >= 4);
  const ficaram = palavras.filter((p) => compacto(c).includes(p)).length;
  if (palavras.length >= 2 && ficaram / palavras.length < 0.5) return null;
  return trocasPequenas(o, c) ? c : null;
}

// palavras de enchimento que a correção pode tirar sem mudar o pedido
const ENCHIMENTO_DA_FALA = /^(ne|tipo|ah|eh|e|hum|hmm|entao|assim|ai|la|que)$/;
/**
 * A correção só AJUSTA (26/10, no app: o Davi falou "Iconha" — o Whisper escreveu certo — e o qwen
 * "corrigiu" para "Icoaraci", uma cidade mais conhecida): as frases alinhadas palavra por palavra, cada
 * trecho trocado tem que soar quase igual ao original (até 1 letra a cada 3 na chave de som) — acento,
 * letra ouvida errado, "50 80" → "5080", "rayzen" → "Ryzen", "pub gi" → "PUBG". Trocar por outra palavra
 * ("Iconha" → "Icoaraci", "está" → "custa") ou acrescentar palavra derruba a correção inteira.
 */
function trocasPequenas(original, corrigido) {
  const a = compacto(original).split(' ').filter(Boolean);
  const b = compacto(corrigido).split(' ').filter(Boolean);
  // alinhamento (maior subsequência comum) das palavras
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const blocos = [];
  let bloco = { de: [], para: [] };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (bloco.de.length || bloco.para.length) blocos.push(bloco);
      bloco = { de: [], para: [] };
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) bloco.para.push(b[j++]);
    else bloco.de.push(a[i++]);
  }
  if (bloco.de.length || bloco.para.length) blocos.push(bloco);
  return blocos.every(({ de, para }) => {
    const x = chaveDeSom(de.join(''));
    const y = chaveDeSom(para.join(''));
    if (!y) return de.every((p) => ENCHIMENTO_DA_FALA.test(p) || a.filter((q) => q === p).length > 1); // tirou enchimento ou repetição
    if (!x) return false; // acrescentou palavra
    return distancia(x, y) <= Math.max(1, Math.floor(Math.max(x.length, y.length) / 3));
  });
}

/** O modelo para este PC: o turbo com 6 núcleos ou mais; senão, o pequeno. */
const modeloRecomendado = (nucleos = os.cpus().length) => (nucleos >= 6 ? 'turbo' : 'pequeno');
/** Quantos núcleos usar: deixa dois para o resto do PC. */
const nucleosParaUsar = (nucleos = os.cpus().length) => Math.max(2, Math.min(8, nucleos - 2));

/**
 * A janela de áudio do encoder (-ac): o Whisper sempre processa 30 s (1500); para fala curta, só o
 * tamanho dela mais 2 s de folga, em múltiplos de 64, entre 384 e 1500. Quanto menor, mais rápido.
 */
const janelaDeAudio = (segundos) => Math.min(1500, Math.max(384, Math.ceil((((Number(segundos) || 0) + 2) / 30) * 1500 / 64) * 64));

// frases que o Whisper escreve com ruído ou silêncio (25/10, no PC do Davi: o teclado virou "Som de barulho")
const ALUCINACAO = /^(som de barulho|barulho|barulhos|ruido|ruidos|som|sons|som de teclado|digitando|musica|aplausos|risos|silencio|legendas? pela comunidade amara org|legendas? por [a-z ]+|obrigad[oa] por assistir|inscreva se( no canal)?|ate a proxima|tchau tchau)$/;
const ALUCINACAO_JUNTO = new RegExp(ALUCINACAO.source.replace(/ /g, ''));
const compactoFrase = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A saída do whisper-cli sem marcações: junta as linhas, tira "[BLANK_AUDIO]", "(música)" e afins. */
function limparTranscricao(saida) {
  return semRepeticao(limparMarcacoes(saida));
}

/**
 * Sem as frases inventadas no ruído ("Som de barulho") e sem a frase repetida em seguida (25/10: "Qual a
 * data de hoje? Qual a data de hoje?" — o Whisper repete o fim quando o áudio acaba em silêncio).
 */
function semRepeticao(texto) {
  const frases = String(texto || '').split(/(?<=[.!?…])\s+/).filter(Boolean);
  const saida = [];
  for (const f of frases) {
    const k = compactoFrase(f);
    if (!k || ALUCINACAO.test(k)) continue;
    if (saida.length && compactoFrase(saida[saida.length - 1]) === k) continue;
    saida.push(f);
  }
  return saida.join(' ').trim();
}

function limparMarcacoes(saida) {
  return String(saida || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\[[\d:.\s>-]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    // tudo entre colchetes é o Whisper descrevendo som, não fala (25/10, no PC do Davi: "[Som de futebol]",
    // "[Toc, toc, toc]", "[Tocando]" — a TV e o teclado)
    .replace(/\[[^\]]{0,80}\]/g, '')
    .replace(/\((?:música|musica|music|silêncio|silence|aplausos|risos|som|sons|barulho)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class Ditado {
  constructor(dirComponentes, { buscar = (...a) => fetch(...a), extrairZip, executar } = {}) {
    this.dir = path.join(dirComponentes, 'ditado');
    this.buscar = buscar;
    this.extrairZip = extrairZip || ((buffer, destino) => require('./searxng-runtime').extrairZipPara(buffer, destino));
    this.executar = executar || ((arquivo, args, opcoes) => new Promise((ok, falha) =>
      execFile(arquivo, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8', ...opcoes }, (err, stdout, stderr) =>
        err ? falha(Object.assign(new Error(String(stderr || err.message).trim().split('\n').pop().slice(0, 300)), { stderr })) : ok(stdout)
      )
    ));
  }

  /** O whisper-cli.exe dentro da pasta (o zip traz uma subpasta "Release"). */
  exe() {
    const procurar = (dir) => {
      if (!fs.existsSync(dir)) return null;
      for (const nome of fs.readdirSync(dir)) {
        const caminho = path.join(dir, nome);
        if (/^whisper-cli(\.exe)?$/i.test(nome)) return caminho;
        if (fs.statSync(caminho).isDirectory()) {
          const achado = procurar(caminho);
          if (achado) return achado;
        }
      }
      return null;
    };
    return procurar(path.join(this.dir, 'bin'));
  }

  modeloInstalado() {
    return Object.keys(MODELOS).find((id) => fs.existsSync(path.join(this.dir, 'modelos', MODELOS[id].arquivo))) || null;
  }

  instalado() {
    return Boolean(this.exe() && this.modeloInstalado());
  }

  arquivoDaEscuta(modelo = 'small') {
    return path.join(this.dir, 'modelos', (MODELOS_DA_ESCUTA[modelo] || MODELOS_DA_ESCUTA.small).arquivo);
  }

  /** O modelo da escuta que vale: o escolhido, se baixado; senão o outro, se baixado; senão null. */
  modeloDaEscuta(preferido = 'small') {
    const ordem = preferido === 'base' ? ['base', 'small'] : ['small', 'base'];
    return this.instalado() ? ordem.find((m) => fs.existsSync(this.arquivoDaEscuta(m))) || null : null;
  }

  escutaInstalada(preferido = 'small') {
    return Boolean(this.modeloDaEscuta(preferido));
  }

  /** O modelo da escuta (small, 190 MB; base, 60 MB), só no clique — o ditado já precisa estar instalado. */
  async instalarEscuta({ modelo = 'small', emitir = () => {} } = {}) {
    if (!this.instalado()) throw new Error('instale antes o ditado por voz (Ajustes → Componentes)');
    const m = MODELOS_DA_ESCUTA[modelo] || MODELOS_DA_ESCUTA.small;
    if (!fs.existsSync(this.arquivoDaEscuta(modelo))) {
      await baixarConferindo(`${HF}/${m.arquivo}`, this.arquivoDaEscuta(modelo), { sha256: m.sha256, buscar: this.buscar, emitir, rotulo: `o modelo ${m.nome}`, total: m.bytes });
    }
    emitir({ texto: '"Ei GPT" pronto ✓', porcento: 100 });
    return this.estado();
  }

  /**
   * A frase curta (até ~5 s) chamou o AuGPT? Com o modelo pequeno, em ~0,2 s. → { texto, chamou, ms }
   * Sem prompt de propósito: com "Ei GPT," de prompt inicial o Whisper inventava a chamada e comia palavras.
   */
  async ouvirChamada(wav, { idioma = 'pt', modelo = 'small', variantes = [] } = {}) {
    const exe = this.exe();
    const usado = this.modeloDaEscuta(modelo);
    if (!exe || !usado) throw new Error('a escuta do "Ei GPT" não está instalada');
    const inicio = Date.now();
    const args = ['-m', this.arquivoDaEscuta(usado), '-f', wav, '-l', idioma === 'en' ? 'en' : 'pt', '-t', String(Math.min(8, nucleosParaUsar())), '-nt', '-np', '-ng', '-bs', '1', '-bo', '1', '-ac', '384'];
    const texto = limparTranscricao(await this.executar(exe, args, { cwd: path.dirname(exe), timeout: 15000 }));
    const chamou = ehChamada(texto, variantes);
    // `parecido`: não chamou pelo texto, mas o começo lembra o nome — a escuta decide junto com o som da voz
    return { texto, chamou, parecido: chamou || lembraONome(texto) || lembraVariante(texto, variantes), resto: chamou ? semChamada(texto, variantes) : '', modelo: usado, ms: Date.now() - inicio };
  }

  estado() {
    const modelo = this.modeloInstalado();
    const recomendado = modeloRecomendado();
    return {
      escuta: this.escutaInstalada(),
      escutaModelos: Object.fromEntries(Object.keys(MODELOS_DA_ESCUTA).map((m) => [m, this.instalado() && fs.existsSync(this.arquivoDaEscuta(m))])),
      tamanhoDaEscuta: MB(MODELOS_DA_ESCUTA.small.bytes),
      tamanhosDaEscuta: Object.fromEntries(Object.entries(MODELOS_DA_ESCUTA).map(([m, x]) => [m, MB(x.bytes)])),
      instalado: this.instalado(),
      modelo: modelo ? MODELOS[modelo].nome : null,
      versao: this.exe() ? BINARIO.versao : null,
      recomendado,
      tamanho: MB(BINARIO.bytes + MODELOS[recomendado].bytes),
      nucleos: os.cpus().length,
    };
  }

  /** Baixa e confere o binário e o modelo (só no clique). `emitir({ texto, porcento })`. */
  async instalar({ modelo = modeloRecomendado(), emitir = () => {} } = {}) {
    if (process.platform !== 'win32') throw new Error('o ditado por voz, por enquanto, é só no Windows');
    const m = MODELOS[modelo] || MODELOS.turbo;
    fs.mkdirSync(path.join(this.dir, 'modelos'), { recursive: true });
    if (!this.exe()) {
      const zip = path.join(this.dir, 'whisper-bin-x64.zip');
      await baixarConferindo(BINARIO.url, zip, { sha256: BINARIO.sha256, buscar: this.buscar, emitir, rotulo: 'o whisper.cpp', total: BINARIO.bytes });
      const destino = path.join(this.dir, 'bin');
      fs.rmSync(destino, { recursive: true, force: true });
      this.extrairZip(fs.readFileSync(zip), destino);
      fs.rmSync(zip, { force: true });
      if (!this.exe()) throw new Error('o pacote baixado não tem o whisper-cli');
    }
    const arquivo = path.join(this.dir, 'modelos', m.arquivo);
    if (!fs.existsSync(arquivo)) await baixarConferindo(`${HF}/${m.arquivo}`, arquivo, { sha256: m.sha256, buscar: this.buscar, emitir, rotulo: `o modelo ${m.nome}`, total: m.bytes });
    emitir({ texto: 'Ditado por voz instalado ✓', porcento: 100 });
    return this.estado();
  }

  /**
   * Áudio WAV 16 kHz mono → texto. `idioma`: 'pt' ou 'en' (o da tela do AuGPT). Devolve { texto, ms }.
   * Medido no PC do Davi (24/10, 8 s de fala, 16 núcleos): 11,4 s → ~2 s com o idioma fixo (o "auto"
   * roda o encoder duas vezes, uma só para descobrir o idioma), a janela de áudio do tamanho da fala
   * (janelaDeAudio) e a busca simples (-bs 1 -bo 1); a transcrição saiu igual.
   */
  async transcrever(wav, { idioma = 'pt' } = {}) {
    const exe = this.exe();
    const modelo = this.modeloInstalado();
    if (!exe || !modelo) throw new Error('o ditado por voz não está instalado (Ajustes → Componentes)');
    const inicio = Date.now();
    const segundos = Math.max(0, (fs.statSync(wav).size - 44) / 32000); // 16 kHz × 16 bits × mono
    const args = ['-m', path.join(this.dir, 'modelos', MODELOS[modelo].arquivo), '-f', wav, '-l', idioma === 'en' ? 'en' : 'pt', '-t', String(nucleosParaUsar()), '-nt', '-np', '-ng', '-bs', '1', '-bo', '1', '-ac', String(janelaDeAudio(segundos))];
    const saida = await this.executar(exe, args, { cwd: path.dirname(exe) });
    return { texto: limparTranscricao(saida), ms: Date.now() - inicio };
  }
}

module.exports = { limparPedidoFalado, definirNome, nomeAtual, lembraONome, lembraVariante, temSomDoNome, temSomDeGPT, Ditado, MODELOS, MODELO_DA_ESCUTA, MODELOS_DA_ESCUTA, variantesDoTreino, sensibilidadeDoTreino, distancia, varianteValida, variantesValidas, juntarVariantes, chamadaEscrita, semRepeticao, BINARIO, limparTranscricao, janelaDeAudio, modeloRecomendado, nucleosParaUsar, ehChamada, semChamada, palavrasDaChamada, comandoDeVoz, pedidoDeCorrecao, correcaoAceitavel, contextoDaFala, respostaSugeridaParecida };
