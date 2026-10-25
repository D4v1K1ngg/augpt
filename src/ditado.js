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
function bateVariante(junto, variantes) {
  const k = chaveDeSom(junto);
  return variantes.some((v) => {
    const kv = chaveDeSom(v);
    if (kv === k) return true;
    const tolera = kv.length >= 5 ? Math.max(1, Math.floor(kv.length / 5)) : 0;
    return tolera > 0 && Math.abs(kv.length - k.length) <= tolera && distancia(kv, k) <= tolera;
  });
}

// palavra de enchimento que pode vir antes da chamada ("Hey, hey, Juppetti", "Ah, ei GPT")
const ENCHIMENTO = /^(e|ei|eh|ah|ai|oi|hey|hei|ei|ok|entao|bom|olha)$/;

/** Quantas palavras do começo do texto são a chamada (0 = não chamou). Olha até as 4 primeiras (5 com enchimento). */
function palavrasDaChamada(texto, variantes = []) {
  const palavras = compacto(texto).split(' ').filter(Boolean);
  const tentar = (de) => {
    let junto = '';
    for (let i = de; i < Math.min(de + 4, palavras.length); i += 1) {
      junto += palavras[i];
      if (CHAMADA.test(junto) || CHAMADA.test(chaveDeSom(junto)) || bateVariante(junto, variantes)) return i + 1;
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
    if (!junto || CHAMADA.test(junto) || CHAMADA.test(chaveDeSom(junto))) continue; // vazio, ou já reconhecida sem treino
    if (junto.length < 5 || junto.length > 16 || palavras.length > 4 || COMUM.test(junto)) recusadas.push(t);
    else if (!variantes.includes(junto)) variantes.push(junto);
  }
  return { variantes, recusadas };
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

/** Comando direto, sem passar pelo modelo: 'nova-conversa', 'parar' ou null. */
function comandoDeVoz(texto) {
  const t = compacto(texto);
  if (/^((abr[ae]|abrir|comec[ae]|comecar|inici[ae]|iniciar|nova|uma) )?(uma )?nova conversa( por favor)?$|^(new|start a new) (chat|conversation)$/.test(t)) return 'nova-conversa';
  if (/^(para|pare|parar|cancela|cancele|cancelar|chega|stop|cancel)( (tudo|isso|a resposta|de responder))?( por favor)?$/.test(t)) return 'parar';
  return null;
}

/** O pedido para o modelo corrigir o que o Whisper ouviu. */
function pedidoDeCorrecao(texto, idioma = 'pt') {
  return `Você corrige transcrições de fala feitas por reconhecimento de voz${idioma === 'en' ? ' (em inglês)' : ' (em português do Brasil)'}.
Corrija SÓ: palavras ouvidas errado (pelo sentido da frase), ortografia, acentos, pontuação e nomes de produtos, marcas e termos de tecnologia (ex.: "RTX 5080", "PlayStation 5", "Windows").
NÃO responda ao que foi dito, NÃO acrescente nem tire informação, NÃO mude o sentido nem o jeito de falar. Se já estiver certo, devolva igual.
Devolva só o texto corrigido, sem aspas e sem explicação.

Transcrição: ${texto}`;
}

/** Aceita a correção só se ela parece a mesma frase (nada de resposta, explicação ou texto inventado). */
function correcaoAceitavel(original, corrigido) {
  const o = String(original || '').trim();
  const c = String(corrigido || '').trim().replace(/^["'“”«]+|["'“”»]+$/g, '').trim();
  if (!c || c.length > o.length * 1.6 + 20 || c.length < o.length * 0.5) return null;
  if (/\n\s*\n|^(aqui est|claro|a transcri|texto corrigido|corrigido:)/i.test(c)) return null;
  // metade das palavras do original (de 4+ letras) continuam lá
  const palavras = compacto(o).split(' ').filter((p) => p.length >= 4);
  const ficaram = palavras.filter((p) => compacto(c).includes(p)).length;
  if (palavras.length >= 2 && ficaram / palavras.length < 0.5) return null;
  return c;
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

/** A saída do whisper-cli sem marcações: junta as linhas, tira "[BLANK_AUDIO]", "(música)" e afins. */
function limparTranscricao(saida) {
  return String(saida || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\[[\d:.\s>-]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\[(?:BLANK_AUDIO|MUSIC|silence|música|musica|aplausos|risos)[^\]]*\]|\((?:música|musica|music|silêncio|silence|aplausos|risos)[^)]*\)/gi, '')
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
    return { texto, chamou, resto: chamou ? semChamada(texto, variantes) : '', modelo: usado, ms: Date.now() - inicio };
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

module.exports = { Ditado, MODELOS, MODELO_DA_ESCUTA, MODELOS_DA_ESCUTA, variantesDoTreino, sensibilidadeDoTreino, distancia, BINARIO, limparTranscricao, janelaDeAudio, modeloRecomendado, nucleosParaUsar, ehChamada, semChamada, palavrasDaChamada, comandoDeVoz, pedidoDeCorrecao, correcaoAceitavel };
