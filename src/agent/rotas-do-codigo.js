'use strict';

/**
 * As rotas que o código responde, num lugar só (19/10, revisão do projeto). Antes, o
 * loop decidia numa cadeia de 9 detectores em que cada um precisava saber de todos os
 * outros (`!pedeAjuste && !pedeRota && !pedeRaioX…`) — de lá vieram "driver" caindo na
 * placa de vídeo e a lista de utilitários travando a tela. Agora a ORDEM desta lista é a
 * prioridade: a primeira rota que reconhece o pedido responde. A mesma lista atende a ação
 * escolhida pelo entendimento e o "sim" a uma oferta (`executar`).
 *
 * Cada rota: { id, detecta(ctx) → pedido | falso, responde(ctx, pedido) → resposta | null }.
 * ctx: { objetivo, conversa, deps, signal, pasta, jogo, confirmado, modo }.
 * `null` de responde = não era desta rota (a leitura livre devolve para a pesquisa).
 */

const catalogo = require('./capacidades');
const rede = require('./rede-no-chat');
const pc = require('./pc-no-chat');
const imagensNoChat = require('./imagens-no-chat');
const memoria = require('./memoria-no-chat');
const calendario = require('./calendario-no-chat');
const clima = require('./clima-no-chat');
const mapa = require('./mapa-no-chat');
const agenda = require('./agenda-no-chat');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };

const ROTAS = [
  {
    // "me lembra sexta às 15h de ligar pro banco", "me avise quando a RTX 60 for lançada", "o que
    // eu tenho amanhã?" (23/10): antes da memória ("lembre QUE…" é memória; "me lembra DE…" é agenda)
    id: 'agenda',
    detecta: ({ objetivo }) => agenda.pedidoDeAgenda(objetivo),
    responde: ({ objetivo, deps, config, pasta }, pedido) => agenda.responderAgenda({ pergunta: objetivo, deps, config, pasta, ...(pedido ? { pedido } : {}) }),
  },
  {
    // "lembre que eu prefiro respostas curtas", "esqueça que…", "o que você sabe sobre mim?" (22/10)
    id: 'memoria',
    detecta: ({ objetivo }) => memoria.pedidoDeMemoria(objetivo),
    responde: ({ objetivo, deps, pasta, config }, pedido) => memoria.responderMemoria({ pergunta: objetivo, deps, pasta, config, ...(pedido ? { acao: pedido } : {}) }),
  },
  {
    // "que dia é hoje?", "quais feriados temos este mês?", "quantos dias faltam pro Natal?" (23/10):
    // o código responde, com o calendário interativo na resposta
    id: 'calendario',
    detecta: ({ objetivo }) => calendario.pedidoDeCalendario(objetivo),
    responde: ({ objetivo, deps, config }, pedido) => calendario.responderCalendario({ pergunta: objetivo, deps, config, ...(pedido ? { pedido } : {}) }),
  },
  {
    // "como está o tempo em Campinas?", "vai chover amanhã?" (23/10): Open-Meteo e o cartão do clima;
    // sem resposta do Open-Meteo, a rota devolve e a pesquisa responde
    id: 'clima',
    detecta: ({ objetivo }) => clima.pedidoDeClima(objetivo),
    intencao: (objetivo) => clima.intencaoDeClima(objetivo),
    responde: ({ objetivo, conversa, deps, config, pasta, ent }, pedido) => clima.responderClima({ pergunta: objetivo, conversa, deps, config, pasta, lugares: ent?.lugares, ...(pedido ? { pedido } : {}) }),
  },
  {
    // "onde fica a Torre Eiffel?", "quanto tempo de Campinas até São Paulo?" (23/10): Nominatim, OSRM
    // e o globo na resposta; lugar que o mapa não conhece ou serviço fora, a pesquisa responde
    id: 'mapa',
    detecta: ({ objetivo }) => mapa.pedidoDeMapa(objetivo),
    intencao: (objetivo) => mapa.intencaoDeMapa(objetivo),
    responde: ({ objetivo, conversa, deps, config, pasta, ent }, pedido) => mapa.responderMapa({ pergunta: objetivo, conversa, deps, config, pasta, lugares: ent?.lugares, ...(pedido ? { pedido } : {}) }),
  },
  {
    // "o que você pode fazer?": a mesma lista da aba Utilitários, montada pelo código
    id: 'utilitarios',
    detecta: ({ objetivo }) => catalogo.pedeOQueFaz(objetivo),
    responde: ({ deps, config }) => {
      const idioma = config?.idiomaEfetivo === 'en' ? 'en' : 'pt';
      const texto = catalogo.textoDosUtilitarios(catalogo.utilitarios({ instalados: { imagem: !!deps.gerarImagem, youtube: !!deps.buscarNoYoutube } }), idioma);
      deps.emit('resposta-token', { pedaco: texto, noIdioma: idioma === 'en' });
      // já sai no idioma da tela: a tradução pelo modelo (traducao.js) não é preciso
      return { ...SEM_PESQUISA, texto, modo: 'utilitarios', noIdioma: idioma === 'en' };
    },
  },
  {
    // "busque uma imagem de um carro", "mostre fotos da Torre Eiffel", "imagens desses setups" (21/10)
    id: 'buscar_imagens',
    detecta: ({ objetivo }) => imagensNoChat.pedidoDeImagens(objetivo),
    responde: ({ objetivo, conversa, deps, dirImagens, config }) => imagensNoChat.responderImagens({ pergunta: objetivo, conversa, deps, dir: dirImagens, config }),
  },
  {
    // antes de tudo: "aplicar" e "desfazer ajustes" dependem da resposta anterior
    id: 'ajustes_de_rede',
    detecta: ({ objetivo, conversa }) => rede.pedidoDeAjuste(objetivo, conversa),
    responde: ({ objetivo, conversa, deps, pasta }, pedido) => rede.responderAjuste({ pergunta: objetivo, conversa, deps, pasta, ...(pedido ? { pedido } : {}) }),
  },
  {
    // antes do teste de rede: "meu ping no PUBG" é de servidor do jogo
    id: 'rota_de_jogo',
    detecta: ({ objetivo }) => rede.pedidoDeRota(objetivo),
    responde: ({ objetivo, deps, jogo }, pedido) => rede.responderRota({ pergunta: objetivo, deps, ...(pedido ? {} : { jogo }) }),
  },
  {
    id: 'diagnostico_da_rede',
    detecta: ({ objetivo }) => rede.pedidoDeDiagnostico(objetivo),
    responde: ({ objetivo, conversa, deps }) => rede.responderDiagnostico({ pergunta: objetivo, conversa, deps }),
  },
  {
    // "quanto espaço livre meu pc tem?", "qual a marca do meu mouse?"
    id: 'consultar_pc',
    detecta: ({ objetivo }) => pc.pedidoDeConsultaPC(objetivo),
    responde: ({ objetivo, deps }, pedido) => pc.responderConsultaPC({ pergunta: objetivo, deps, ...(pedido ? { ids: pedido.ids } : {}) }),
  },
  {
    id: 'trafego_de_rede',
    detecta: ({ objetivo }) => rede.pedidoDeTrafego(objetivo),
    responde: ({ objetivo, deps }) => rede.responderTrafego({ pergunta: objetivo, deps }),
  },
  {
    id: 'teste_de_rede',
    detecta: ({ objetivo, conversa }) => rede.pedidoDeRede(objetivo, conversa),
    // pela ação ou pelo "sim": o modo da oferta (ping ou completo), já confirmado
    responde: ({ objetivo, conversa, deps, signal, modo, confirmado }, pedido) =>
      rede.responderRede({ pergunta: objetivo, conversa, deps, signal, pedido: pedido || rede.pedidoDeRede(objetivo, conversa) || { modo: modo || 'completo', confirmado: confirmado || modo === 'ping' } }),
  },
  {
    // o resto do que é do PC (chipset, drivers, registro, políticas…): por último, depois da rede
    id: 'leitura_livre',
    detecta: ({ objetivo }) => pc.pedidoDeLeituraLivre(objetivo),
    responde: ({ objetivo, conversa, deps }) => pc.responderLeituraLivre({ pergunta: objetivo, conversa, deps }),
  },
];

/** A primeira rota que reconhece o pedido → { rota, pedido } ou null (vai para a pesquisa). */
function escolherRota(ctx) {
  for (const rota of ROTAS) {
    const pedido = rota.detecta(ctx);
    if (pedido) return { rota, pedido };
  }
  return null;
}

/** Responde pela rota escolhida; null = a rota devolveu (a pesquisa responde). A resposta leva `rota`. */
async function responderPelaRota(ctx, escolha) {
  const r = await escolha.rota.responde(ctx, escolha.pedido);
  // doCodigo: o texto foi montado pelo código, em português (a tela em inglês traduz — traducao.js)
  return r ? { ...r, rota: escolha.rota.id, doCodigo: true } : null;
}

/**
 * A intenção que o código reconhece mesmo sem conseguir montar o pedido (23/10: "onde fica a capital
 * da Bahia?" é mapa, mas o lugar só o modelo resolve). O entendimento completa os lugares e esta
 * ação vale se ele não escolher outra.
 */
function intencao(objetivo) {
  return ROTAS.find((r) => r.intencao?.(objetivo))?.id || null;
}

/** Ação pelo id (entendimento ou "sim" a uma oferta), sem passar pela detecção. */
function executar(id, ctx) {
  const rota = ROTAS.find((r) => r.id === id);
  return rota ? responderPelaRota(ctx, { rota, pedido: null }) : Promise.resolve(null);
}

module.exports = { ROTAS, escolherRota, responderPelaRota, executar, intencao };
