'use strict';

/**
 * A porta de entrada das perguntas (saiu do loop.js em 19/10, revisão do projeto): as rotas que o
 * código responde (rotas-do-codigo.js), a investigação e o núcleo de pesquisa, e o acabamento da
 * resposta (fotos, onde comprar, vídeos, relatório em PDF, fontes). Roda como método do Agent
 * (`this` é o agente): o loop.js instala esta função no protótipo.
 */

const path = require('path');
const fs = require('fs');
const ollama = require('../llm/ollama');
const { Sandbox } = require('../tools/sandbox');
const { consultasNaComunidade } = require('../tools/comunidade');
const { preferenciasDaPergunta } = require('./memoria-no-chat');
const traducao = require('./traducao');
const lugares = require('./lugares');
const agendaNoChat = require('./agenda-no-chat');
const imagens = require('../tools/imagens');
const search = require('../tools/search');
const { lerComCache } = require('../tools/web');
const nucleo = require('./nucleo');
const { investigar } = require('./nucleo/investigacao');
const { ondeComprar, linhaOndeComprar } = require('./onde-comprar');
const { protegerGraficos } = require('./nucleo/graficos');
const catalogo = require('./capacidades');
const rotas = require('./rotas-do-codigo');
const { jogoDoTexto } = require('../rede/rotas');
const { gerarPdf } = require('../formatos/pdf-escrita');
const { YtDlp, pareceMudancaDoYouTube, idDoVideo } = require('../ytdlp');
const { Tesseract } = require('../tesseract');
const { GeradorDeImagens, pastaPadrao } = require('../gerador-de-imagens');
const { explicarTermos } = require('./glossario');
const { comLinks } = require('./escritor-de-cartoes');

/**
 * Imagem no tamanho que o modelo lê bem (16/10, foto de 474 px de um EPOS H6PRO:
 * o 9B lia o "EPOS" miúdo como "EP05" e inventava o modelo; ampliada para 1024 px,
 * leu "EPOS" 4 de 4). Foto muito grande é reduzida (menos tempo na placa). Fora do
 * Electron (bancada), a imagem vai como veio.
 */
function imagemParaOModelo(arquivo) {
  const original = fs.readFileSync(arquivo);
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage?.createFromBuffer?.(original);
    const largura = img && !img.isEmpty() ? img.getSize().width : 0;
    if (!largura || (largura >= 900 && largura <= 1600)) return original.toString('base64');
    return img.resize({ width: largura < 900 ? 1024 : 1600, quality: 'best' }).toJPEG(90).toString('base64');
  } catch {
    return original.toString('base64');
  }
}

/**
 * Núcleo de pesquisa (15/10, src/agent/nucleo): entender → o modelo pesquisa
 * com ferramentas nativas → uma escrita com fontes numeradas. Devolve a
 * resposta final, ou null quando falhou (quem chama segue pelo caminho antigo).
 */
async function responderPeloNucleo({ objetivo, conversa: conversaCrua, imagens: anexadas = [] }) {
  // o JSON dos cartões (calendário, clima, mapa; 23/10) é para a tela desenhar: no histórico, fica
  // só um rastro curto do que o cartão mostrou ("[cartão de mapa: Iconha, Espírito Santo]"), para o
  // modelo e as rotas entenderem "e o clima lá?"
  const conversa = (Array.isArray(conversaCrua) ? conversaCrua : []).map((m) => (typeof m?.content === 'string' && /```(calendario|clima|mapa|compras)\n/.test(m.content) ? { ...m, content: m.content.replace(/\n*```(calendario|clima|mapa|compras)\n([\s\S]*?)```/g, (_, tipo, json) => `\n${lugares.rastroDoCartao(tipo, json)}`) } : m));
  // prova com várias questões (18/10): ~700 tokens por questão resolvida; o
  // padrão de 3.072 cortava a resposta na 4ª de 10
  const questoes = new Set((String(objetivo).match(/\bquest(?:ão|ao)\s*(\d+)/gi) || []).map((q) => q.replace(/\D/g, ''))).size;
  // página interativa (bloco visual, item 4): o HTML inteiro não cabe em 3.072 (18/10: a animação foi cortada no meio)
  const limiteDaEscrita = Math.max(Number(this.config.numPredictResposta) || 3072, Math.min(12000, questoes * 700), nucleo.pedeVisual(objetivo) ? 8000 : 0);
  const inicio = Date.now();
  const cfg = this.config;
  // imagens anexadas: lidas da pasta de trabalho; com o Tesseract instalado, o texto delas vai junto (OCR)
  const ocr = this.userDataPath ? new Tesseract(path.join(this.userDataPath, 'componentes')) : null;
  const imagensDoPedido = [];
  for (const rel of anexadas) {
    try {
      const arquivo = new Sandbox(cfg.workspace).resolve(rel);
      if (fs.statSync(arquivo).size > 20 * 1024 * 1024) continue;
      const texto = ocr?.instalado() ? await ocr.lerTexto(arquivo).catch(() => '') : '';
      imagensDoPedido.push({ nome: path.basename(rel), arquivo, base64: imagemParaOModelo(arquivo), texto });
    } catch {
      /* imagem que não abre: segue sem ela */
    }
  }
  const modelo = cfg.model;
  const signal = this.controller.signal;
  const ctxWeb = {
    estado: {},
    config: cfg,
    emit: (e, d) => this.emit(e, d || {}),
    render: this.render,
    retomada: this.retomada,
    dirCachePaginas: this.userDataPath ? path.join(this.userDataPath, 'cache-paginas') : null,
  };
  const ingles = (q) => /\b(the|best|for|with|vs|review|reddit|how|what|which)\b/i.test(q) && !/[ãõçáéíóúâêà]/i.test(q);
  let escreveu = false;
  const deps = {
    signal,
    emit: (evento, dados) => this.emit(evento, dados),
    chamar: async (messages, { tools, json, numPredict } = {}) => {
      const r = await ollama.chat({ host: cfg.host, model: modelo, messages, tools, json, temperature: 0.3, numCtx: 16384, numPredict: numPredict || 800, manterVivo: cfg.manterModeloVivo, signal });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: tools ? 'decisao' : 'entendimento', duracaoMs: r.durationMs });
      return r;
    },
    escrever: async (messages, onToken) => {
      const r = await ollama.chatStream({ host: cfg.host, model: modelo, messages, temperature: 0.4, numCtx: 16384, numPredict: limiteDaEscrita, manterVivo: cfg.manterModeloVivo, signal, onToken: (p) => { escreveu = true; onToken(p); } });
      this.contabilizar({ promptTokens: r.promptTokens, completionTokens: r.completionTokens }, { tipo: 'redacao', duracaoMs: r.durationMs });
      return r.content;
    },
    // pergunta que muda com o tempo (18/10): notícias e web do último mês (as notícias na frente,
    // marcadas como recentes); com menos de 3 resultados, a busca de sempre
    buscar: async (q, { recente = false } = {}) => {
      const opcoes = { searxngUrl: cfg.searxngUrl, marginaliaKey: cfg.marginaliaKey, jinaKey: cfg.jinaKey, idioma: ingles(q) ? 'all' : 'pt-BR' };
      if (recente) {
        const soSearxng = { ...opcoes, periodo: 'month', pular: search.CADEIA.map((p) => p.nome).filter((n) => n !== 'searxng') };
        const [noticias, web] = await Promise.all([
          search.buscar(q, { ...soSearxng, categoria: 'news' }).then((x) => x.resultados.map((r) => ({ ...r, recente: true }))).catch(() => []),
          search.buscar(q, opcoes).then((x) => x.resultados).catch(() => []),
        ]);
        const vistos = new Set();
        const juntos = [...noticias.slice(0, 6), ...web].filter((r) => !vistos.has(r.url) && vistos.add(r.url));
        if (juntos.length >= 3) return juntos;
      }
      return (await search.buscar(q, opcoes)).resultados;
    },
    // "meu computador" (18/10): a máquina do usuário (a memória central vai em toda resposta, por `preferencias`)
    sobreOUsuario: async () => {
      const partes = [];
      const pc = await (this._computador ||= require('../verificador-de-hardware').verificarComputador().catch(() => null));
      // a memória de vídeo escrita por extenso (18/10: "RTX 3060 Ti (8 GB)" virou "8 GB de RAM" na resposta)
      if (pc) partes.push(`Computador do usuário: ${pc.gpus?.length ? `placa de vídeo ${pc.gpus.map((g) => `${g.nome}${g.vramGB ? ` com ${g.vramGB} GB de memória de vídeo (VRAM)` : ''}`).join(' + ')}; ` : ''}processador ${pc.cpu} (${pc.nucleos} núcleos); memória RAM do sistema: ${pc.ramTotalGB} GB; ${pc.sistema}.`);
      return partes.join('\n');
    },
    // o que o usuário pediu para guardar ("lembre que…", 22/10): vai para o escritor em toda resposta
    // instrução por assunto (27/10): só as do assunto da pergunta (o modelo decide numa chamada curta)
    preferencias: (pergunta) => preferenciasDaPergunta(this.userDataPath, cfg, { pergunta, chamar: (m, o) => deps.chamar(m, o) }),
    // o idioma das telas (22/10): 'en' faz o escritor responder em inglês
    idioma: cfg.idiomaEfetivo === 'en' ? 'en' : 'pt',
    lerPagina: (url) => lerComCache(url, ctxWeb),
    embed: (textos) => ollama.embed({ host: cfg.host, model: cfg.embedModel || 'nomic-embed-text', input: textos, signal }),
    // Reddit e fóruns cadastrados (dados/fontes-da-comunidade.json): "site:reddit.com …", "site:clubedohardware.com.br …"
    buscarNaComunidade: async (q) => {
      const lista = consultasNaComunidade(q, { config: cfg, maximo: 3 });
      const achados = await Promise.all(lista.map((c) => search.buscar(c.consulta, { searxngUrl: cfg.searxngUrl, marginaliaKey: cfg.marginaliaKey, jinaKey: cfg.jinaKey, idioma: c.idioma }).then((x) => x.resultados).catch(() => [])));
      return achados.flat();
    },
  };
  // modelo sem visão (17/10, Llama 3.2 3B): nada de mandar imagem para ele
  const capacidades = await ollama.capacidades(cfg.host, modelo).catch(() => []);
  const enxerga = !capacidades.length || capacidades.includes('vision'); // sem a lista (Ollama antigo): tenta
  if (!enxerga) {
    deps.semVisao = `O modelo em uso (**${modelo}**) não enxerga imagens. Para perguntar sobre fotos, escolha um **Qwen 3.5** no seletor de modelo do topo — até o de 2B enxerga. Para ler o texto de prints e documentos, instale o **Tesseract** em Ajustes → Componentes.`;
  }
  // Fase 5: criar imagens com o FLUX.2 Klein (Ajustes → Componentes)
  const gerador = this.userDataPath ? new GeradorDeImagens(pastaPadrao(this.userDataPath)) : null;
  if (gerador?.instalado()) {
    // revisar e escolher a foto de referência pedem visão
    deps.revisoesDeImagem = cfg.revisarImagensCriadas === false || !enxerga ? 0 : 2;
    deps.gerarImagem = async ({ prompt, largura, altura, semente, referencias = [], legenda }) => {
      // o FLUX usa ~7 GB da placa: os modelos do Ollama saem antes (voltam sozinhos no próximo pedido)
      for (const m of await ollama.psModels(cfg.host).catch(() => [])) await ollama.unloadModel(cfg.host, m.name).catch(() => {});
      for (let i = 0; i < 20 && (await ollama.psModels(cfg.host).catch(() => [])).length; i += 1) await new Promise((ok) => setTimeout(ok, 250));
      // edição sem tamanho escolhido: o da imagem anexada, até 1024 no lado maior, múltiplo de 16
      if ((!largura || !altura) && referencias[0]) {
        try {
          const { width, height } = require('electron').nativeImage.createFromPath(referencias[0]).getSize();
          const escala = Math.min(1, 1024 / Math.max(width, height));
          [largura, altura] = [width, height].map((x) => Math.max(256, Math.round((x * escala) / 16) * 16));
        } catch {
          [largura, altura] = [1024, 1024];
        }
      }
      const nome = `${Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')}.png`;
      const saida = path.join(this.dirImagens(), nome);
      fs.mkdirSync(this.dirImagens(), { recursive: true });
      const r = await gerador.gerar({ prompt, saida, largura: largura || 1024, altura: altura || 1024, semente, referencias });
      // uma cópia na pasta de trabalho, para o usuário achar e usar
      let caminho = null;
      try {
        const pasta = path.join(cfg.workspace, 'imagens-criadas');
        fs.mkdirSync(pasta, { recursive: true });
        const base = String(legenda || 'imagem').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'imagem';
        caminho = path.join('imagens-criadas', `${base}-${Date.now()}.png`);
        fs.copyFileSync(saida, path.join(cfg.workspace, caminho));
      } catch {
        caminho = null;
      }
      return { uri: `augpt-img://${nome}`, base64: fs.readFileSync(saida).toString('base64'), ms: r.ms, caminho };
    };
    // fotos reais de referência: versão grande da busca de imagens; miniatura (menos de 300 px) fica de fora
    if (cfg.searxngUrl && enxerga) {
      deps.buscarReferencias = async (q) => {
        const candidatas = (await imagens.buscarImagens(q, { config: cfg, maximo: 12, grande: true })).slice(0, 8);
        const uris = await Promise.all(candidatas.map((c) => imagens.guardarImagem(c.url, { pagina: c.pagina, dir: this.dirImagens(), config: cfg }).catch(() => null)));
        const prontas = [];
        for (const [i, uri] of uris.entries()) {
          if (!uri || prontas.length >= 4) continue;
          const arquivo = path.join(this.dirImagens(), uri.replace(/^augpt-img:\/\//, ''));
          try {
            const { width, height } = require('electron').nativeImage.createFromPath(arquivo).getSize();
            if (Math.min(width, height) < 300) continue;
          } catch {
            if (fs.statSync(arquivo).size < 20000) continue; // fora do Electron: pelo tamanho do arquivo
          }
          prontas.push({ ...candidatas[i], arquivo, base64: imagemParaOModelo(arquivo) });
        }
        return prontas;
      };
    }
  } else if (gerador) {
    deps.semGerador = 'Para criar imagens, o AuGPT usa o FLUX.2 Klein, que roda no seu computador. Ele ainda não está instalado: em **Ajustes → Componentes → Criar imagens** dá para ver se a sua placa de vídeo comporta e instalar com um clique (cerca de 6 GB).';
  }
  // Fase 4: o pesquisador olha imagens da web (a busca de imagens é a do SearXNG)
  if (cfg.searxngUrl && cfg.imagensNasRespostas !== false && enxerga) {
    deps.buscarImagensParaVer = async (q) => {
      const candidatas = (await imagens.buscarImagens(q, { config: cfg, maximo: 8 })).slice(0, 6);
      const uris = await Promise.all(candidatas.map((c) => imagens.guardarImagem(c.url, { pagina: c.pagina, dir: this.dirImagens(), config: cfg }).catch(() => null)));
      return candidatas
        .map((c, i) => (uris[i] ? { ...c, base64: fs.readFileSync(path.join(this.dirImagens(), uris[i].replace(/^augpt-img:\/\//, ''))).toString('base64') } : null))
        .filter(Boolean)
        .slice(0, 3);
    };
  }
  // YouTube (Fase 3): só com o yt-dlp instalado em Ajustes → Componentes (ou na boas-vindas)
  const yt = this.userDataPath ? new YtDlp(path.join(this.userDataPath, 'componentes')) : null;
  if (yt?.instalado()) {
    deps.buscarNoYoutube = (q) => yt.buscarVideos(q, 5);
    deps.verVideo = (url) =>
      yt.verVideo(url).catch((err) => {
        throw Object.assign(err, { mudancaDoYouTube: pareceMudancaDoYouTube(err.stderr || err.message) });
      });
  }
  try {
    this.emit('inicio-rapido', { objetivo });
    // profundidade: seletor da tela inicial / painel ("Resposta direta" antigo = rápido)
    const modo = cfg.respostaDireta === true ? 'rapido' : cfg.modoDePesquisa || 'automatico';
    // imagens de referência dos ASSUNTOS que o modelo apontou no entendimento (pessoa, lugar,
    // produto, objeto…), buscadas em paralelo com a pesquisa — 15/10: antes era o texto da
    // pergunta, e "Esse fone é bom para jogar pubg?" buscava imagem de "Esse fone é bom…"
    let figuras = Promise.resolve([]);
    const emitirOriginal = deps.emit;
    deps.emit = (evento, dados) => {
      // 18/10: só os assuntos concretos que o entendimento escolheu (antes, sem assunto, a busca de
      // imagem ia pelo texto da pergunta e vinham fotos de "presidente" e "login no site"); até 3 no total
      if (evento === 'nucleo-entendimento' && dados?.precisaBuscar && dados.fotos?.length) {
        const lista = dados.fotos;
        const n = Math.max(1, Math.floor(3 / lista.length));
        figuras = imagens.comLimite(Promise.all(lista.map((a) => imagens.imagensDeReferencia(a, { config: cfg, dir: this.dirImagens(), n }).then((imgs) => (imgs.length ? { nome: a, imgs } : null)).catch(() => null))), 25000, []);
      }
      emitirOriginal(evento, dados);
    };
    // investigação com tempo (17/10): o usuário dá os minutos; o código pesquisa por partes até o tempo acabar
    const investigando = modo === 'investigacao' && !imagensDoPedido.length;
    // teste de rede (18/10): "teste minha internet", "mede meu ping" — o código mede, o modelo explica
    // as ações que o AuGPT executa (capacidades.js): pelo entendimento do modelo, pelo "sim" à oferta
    // da resposta anterior ou, como reserva, pelas palavras do pedido
    const normalizado = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const jogoDaConversa = () => jogoDoTexto(normalizado(`${objetivo} ${conversa.slice(-4).map((m) => m.content).join(' ')}`)) || 'aws';
    // as rotas que o código responde (rotas-do-codigo.js): a ordem da lista é a prioridade
    // tela em inglês (23/10): as rotas entendem e escrevem português. O pedido em inglês vira
    // português para a rota, e o texto dela não vai direto para a tela: sai traduzido no fim
    const emIngles = cfg.idiomaEfetivo === 'en';
    // (a lista de utilitários já escreve em inglês: mostra na hora, ver noIdioma)
    const depsDasRotas = emIngles ? { ...deps, emit: (e, d) => (e === 'resposta-token' && !d?.noIdioma ? undefined : deps.emit(e, d)) } : deps;
    const emPortugues = async (texto) => (emIngles && traducao.pareceIngles(texto) ? (await traducao.paraPortugues(texto, deps.chamar)) || texto : texto);
    const contexto = (extra = {}) => ({ objetivo, conversa, deps: depsDasRotas, signal, pasta: this.userDataPath, jogo: jogoDaConversa(), dirImagens: this.dirImagens(), config: cfg, ...extra });
    // `ent` (23/10): o que o entendimento leu — os lugares servem de reserva ao mapa e ao clima
    deps.executarAcao = async (id, { pergunta, modo: modoDoTeste = null, confirmado = false, ent = null } = {}) => rotas.executar(id, contexto({ objetivo: await emPortugues(pergunta), modo: modoDoTeste, confirmado, ent }));
    const aceitou = !investigando && !imagensDoPedido.length && catalogo.aceitouOferta(objetivo, conversa);
    let escolha = !investigando && !aceitou && !imagensDoPedido.length ? rotas.escolherRota(contexto()) : null;
    let objetivoDaRota = objetivo;
    if (emIngles && !escolha && !investigando && !aceitou && !imagensDoPedido.length && traducao.pareceIngles(objetivo)) {
      const pt = await emPortugues(objetivo);
      const achada = pt !== objetivo && rotas.escolherRota(contexto({ objetivo: pt }));
      if (achada) [escolha, objetivoDaRota] = [achada, pt];
    }
    // a intenção que o código reconhece sem montar o pedido (23/10): o entendimento completa os lugares
    // (também quando a rota reconheceu e não achou: a segunda tentativa leva os lugares do modelo)
    deps.intencaoDoCodigo = !investigando && !aceitou ? rotas.intencao(objetivoDaRota) : null;
    // a ação que o entendimento escolheu dentro da pesquisa (23/10: "onde fica iconha?" → mapa) fica com o nome dela no registro
    const pelaPesquisa = async () => ({ rota: 'pesquisa', ...(await nucleo.responder({ pergunta: aceitou?.id === 'pesquisa' ? aceitou.pergunta : objetivo, conversa, modo, tamanho: cfg.modoResposta || 'normal', deps, imagens: imagensDoPedido })) });
    const r = aceitou && aceitou.id !== 'pesquisa'
      ? (await deps.executarAcao(aceitou.id, { pergunta: aceitou.pergunta || objetivo, modo: aceitou.modo, confirmado: true })) || (await pelaPesquisa())
      : investigando
      ? { ...(await investigar({ pergunta: objetivo, conversa, minutos: Number(cfg.minutosDeInvestigacao) || 10, tamanho: cfg.modoResposta || 'normal', deps })), rota: 'investigacao' }
      : escolha
      ? (await rotas.responderPelaRota(contexto({ objetivo: objetivoDaRota }), escolha)) || (await pelaPesquisa())
      : await pelaPesquisa();
    // o relatório completo vira PDF na pasta de trabalho, anexado à resposta
    let relatorioPdf = null;
    if (r.relatorio) {
      try {
        const data = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        const base = String(r.relatorio.titulo || 'investigacao').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'investigacao';
        relatorioPdf = path.join('investigacoes', `${base}-${data}.pdf`);
        // o gerador de PDF já põe o título no topo: o "# título" do relatório sai
        const buffer = gerarPdf({ conteudo: r.relatorio.markdown.replace(/^# .*\n+/, ''), titulo: r.relatorio.titulo });
        const alvo = new Sandbox(cfg.workspace).resolve(relatorioPdf);
        fs.mkdirSync(path.dirname(alvo), { recursive: true });
        fs.writeFileSync(alvo, buffer);
        this.emit('arquivo-criado', { nome: path.basename(alvo), relativo: relatorioPdf, bytes: buffer.length });
      } catch (err) {
        relatorioPdf = null;
        this.emit('aviso', { texto: `Não consegui gravar o relatório em PDF: ${err.message}` });
      }
    }
    if (!r.texto) throw new Error('a escrita veio vazia');
    // o texto montado pelo código (as rotas) sai em inglês, em streaming; a investigação já escreve no idioma
    if (emIngles && r.doCodigo && !r.noIdioma) {
      const ofertasDePesquisa = [...r.texto.matchAll(/Quer que eu pesquise \*\*(.+?)\*\*\? É só responder \*\*"sim"\*\*\./g)].map((m) => [m[0], catalogo.ofertaDePesquisa(m[1], 'en')]);
      r.texto = await traducao.paraIngles(r.texto, {
        escrever: deps.escrever,
        fixos: [...catalogo.ofertasBilingues(), ...ofertasDePesquisa],
        traduzirFixo: require('./i18n-do-app').emIngles, // títulos e séries dos gráficos
        onPedaco: (pedaco) => deps.emit('resposta-token', { pedaco }),
        onFalha: (motivo) => this.emit('aviso', { texto: motivo }),
      });
    }
    // trava de promessa: o AuGPT não oferece o que não faz (capacidades.js)
    // 21/10: o modelo pequeno escreveu "### #### 1. Setup Híbrido" — o título duplo não virava cartão (sem cartão, sem foto)
    if (r.produto) r.texto = r.texto.replace(/^#{1,3}\s+(?=#### \d+\.\s)/gm, '');
    // o que o modelo escreveu (não as rotas): sem abertura de enchimento e sem negar o que o AuGPT faz (23/10)
    if (!r.doCodigo) {
      r.texto = catalogo.semEnchimento(r.texto);
      const negacoes = catalogo.conferirNegacoes(r.texto, emIngles ? 'en' : 'pt');
      if (negacoes.tiradas.length) {
        r.texto = negacoes.texto;
        this.emit('aviso', { texto: `negação de um recurso do AuGPT, tirada da resposta: ${negacoes.tiradas.join(' | ').slice(0, 300)}` });
      }
    }
    const promessas = catalogo.conferirPromessas(r.texto);
    if (promessas.tiradas.length) {
      r.texto = promessas.texto;
      this.emit('aviso', { texto: `promessa fora do que o AuGPT faz, tirada da resposta: ${promessas.tiradas.join(' | ').slice(0, 300)}` });
    }
    // produto: uma foto em cada cartão "#### N. Nome"; o resto: a imagem de cada assunto no topo
    const limparNome = (t) => String(t).replace(/[*_[\]]/g, '').trim();
    const nomes = r.produto ? [...r.texto.matchAll(/^#### \d+\. (.+)$/gm)].map((m) => limparNome(m[1])) : [];
    // fotos e "onde comprar" (17/10) ao mesmo tempo: o preço de hoje vem da página de cada loja
    const lojasDosProdutos = nomes.length && cfg.ondeComprar !== false
      ? imagens.comLimite(Promise.all(nomes.slice(0, 6).map((n) => ondeComprar(n, { ler: (url) => lerComCache(url, ctxWeb) }).catch(() => []))), 35000, [])
      : Promise.resolve([]);
    // o assunto vai junto na busca da foto ("Clean Minimalist White Build" sozinho trazia um prédio)
    const contextoDasFotos = (r.assuntos || []).slice(0, 2).join(' ') || r.entendimento?.pergunta || objetivo;
    const fotos = nomes.length ? await imagens.comLimite(imagens.imagensDosProdutos(nomes, { config: cfg, dir: this.dirImagens(), contexto: String(contextoDasFotos).slice(0, 60) }), 20000, new Map()) : new Map();
    const precosNasLojas = new Map((await lojasDosProdutos).map((achados, i) => [nomes[i], achados]));
    // pergunta de preço de UM produto, sem cartões (18/10: "melhor preço para a rtx 5080" saiu com
    // preços inventados e sem link): o preço de hoje nas lojas vai no topo, pelo assunto entendido
    const pedePreco = /\b(pre[çc]os?|quanto custa|onde comprar|link de compra|mais barat\w*|comprar)\b/i.test(objetivo);
    const linhaDoAssunto = !nomes.length && pedePreco && cfg.ondeComprar !== false && r.assuntos?.length
      ? linhaOndeComprar((await imagens.comLimite(Promise.all(r.assuntos.slice(0, 2).map((a) => ondeComprar(a, { ler: (url) => lerComCache(url, ctxWeb) }).catch(() => []))), 30000, [])).find((x) => x.length) || [])
      : '';
    // 21/10: resposta visual que não é de produto ("os 5 setups mais bonitos", "lugares para visitar"):
    // com itens numerados e o entendimento dizendo que imagem ajuda, cada item ganha a sua foto
    const RE_ITEM = /^(#{2,4})\s+(\d+)\.\s+(.+)$/gm;
    const pedidoVisual = r.entendimento?.imagemAjuda || /\b(bonit\w*|lind\w*|inspira\w*|refer[eê]ncias?|decora\w*|apar[eê]ncia|estilos?|design|visual|lugares|paisage\w*|destinos?|setups?)\b/i.test(objetivo);
    const itensVisuais = !nomes.length && pedidoVisual && cfg.imagensNasRespostas !== false ? [...r.texto.matchAll(RE_ITEM)].map((m) => limparNome(m[3]).replace(/\s*[—–:].*$/, '')) : [];
    const fotosDosItens = itensVisuais.length >= 2
      ? await imagens.comLimite(imagens.imagensDosItens(itensVisuais.slice(0, 6), { config: cfg, dir: this.dirImagens(), contexto: String(contextoDasFotos).slice(0, 60) }), 25000, new Map())
      : new Map();
    const comItens = fotosDosItens.size
      ? r.texto.replace(RE_ITEM, (linha, h, n, nome) => {
          const img = fotosDosItens.get(limparNome(nome).replace(/\s*[—–:].*$/, ''));
          return img ? `${linha}\n${imagens.marcacao(limparNome(nome), img)}\n` : linha;
        })
      : r.texto;
    const doTopo = r.buscou && !nomes.length && !fotosDosItens.size ? (await figuras).filter(Boolean) : [];
    const comCartoes = nomes.length
      ? r.texto.replace(/^#### \d+\. (.+)$/gm, (linha, nome) => {
          const img = fotos.get(limparNome(nome));
          const lojas = linhaOndeComprar(precosNasLojas.get(limparNome(nome)) || []);
          return `${linha}${img ? `\n${imagens.marcacao(limparNome(nome), img)}\n` : ''}${lojas ? `\n${lojas}\n` : ''}`;
        })
      : comItens;
    // gráfico protegido: o link das citações e o glossário não entram no JSON dele
    const corpo = protegerGraficos(linhaDoAssunto ? `${linhaDoAssunto}\n\n${comCartoes}` : comCartoes, (t) => explicarTermos(comLinks(t, r.fontes)));
    // as imagens de todos os assuntos numa linha só: o renderer monta o carrossel (md.js)
    const marcas = doTopo.flatMap((x) => x.imgs.map((img) => imagens.marcacao(x.nome, img)));
    const comFoto = marcas.length ? `${marcas.join(' ')}\n\n${corpo}` : corpo;
    // vídeos que a pesquisa assistiu: miniatura que vira o player no clique (md.js, "{yt:ID}")
    const assistidos = r.fontes.filter((f) => f.video && f.lido).slice(0, 3);
    const miniaturas = await imagens.comLimite(
      Promise.all(assistidos.map((f) => imagens.guardarImagem(`https://i.ytimg.com/vi/${idDoVideo(f.url)}/hqdefault.jpg`, { dir: this.dirImagens(), config: cfg }).catch(() => null))),
      15000,
      []
    );
    const videos = assistidos.length
      ? `\n\n**${cfg.idiomaEfetivo === 'en' ? 'Videos' : 'Vídeos'}**\n${assistidos
          .map((f, i) => (miniaturas[i] ? `${imagens.marcacao(`▶ ${f.titulo}`, miniaturas[i])}{yt:${idDoVideo(f.url)}}` : `- [▶ ${String(f.titulo).replace(/[[\]]/g, '')}](${f.url})`))
          .join('\n')}`
      : '';
    const comVideos = `${comFoto}${videos}`;
    const comRelatorio = r.relatorio
      ? `${comVideos}\n\n${relatorioPdf ? `**Relatório completo em PDF:** \`${relatorioPdf}\` — ${r.secoes.length} partes, ${r.fontes.length} fontes, ${Math.max(1, Math.round(r.gastoS / 60))} min de pesquisa${r.interrompida ? ' (interrompida antes do fim)' : ''}.` : ''}`
      : comVideos;
    // 23/10 (agenda): pesquisa sobre algo que ainda vai acontecer ("quando sai a RTX 60?") termina
    // oferecendo acompanhar; o "sim" vira um item da agenda (aceitouOferta → rota agenda)
    const assuntoDoEvento = (r.rota || 'pesquisa') === 'pesquisa' && agendaNoChat.pedeAcompanhar(objetivo) ? (r.assuntos || r.entendimento?.assuntos || [])[0] : null;
    const comOferta = assuntoDoEvento ? `${comRelatorio}\n\n${agendaNoChat.ofertaDeAcompanhar(assuntoDoEvento, emIngles ? 'en' : 'pt')}` : comRelatorio;
    const final = r.fontes.length ? `${comOferta}\n\n---\n**${cfg.idiomaEfetivo === 'en' ? 'Sources' : 'Fontes'}**\n${r.fontes.map((f) => `${f.n}. [${String(f.titulo || f.url).replace(/[[\]]/g, '')}](${f.url})`).join('\n')}` : comOferta;
    this.emit('nucleo-fim', { modo, rota: r.rota || 'pesquisa', ms: Date.now() - inicio, fontes: r.fontes.length, entendimento: r.entendimento });
    await this.fotografarModelos();
    this.emit('concluido', { resumo: final, resposta: true, iteracoes: 0, uso: this.uso, verificacao: null, confianca: null });
    this.rodando = false;
    return { ok: true, resumo: final };
  } catch (err) {
    if (signal.aborted) {
      this.rodando = false;
      this.emit('interrompido', { iteracoes: 0, uso: this.uso });
      return { ok: false, motivo: 'interrompido' };
    }
    if (escreveu) this.emit('resposta-reinicia', { motivo: 'o núcleo de pesquisa falhou — seguindo pelo caminho antigo' });
    this.emit('aviso', { texto: `Núcleo de pesquisa falhou: ${err.message}. Seguindo pelo caminho antigo.` });
    return null;
  }
}

module.exports = { responderPeloNucleo };
