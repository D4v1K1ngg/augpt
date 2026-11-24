'use strict';

/**
 * O tipo de cada fonte lida (24/11, fase 1 do "sistema global" — Davi: "o problema atual do augpt está na falta de
 * capacidade de escolher bons sites e de identificar e descartar sites que não possuem relevância"). Quem decide é o
 * Tev1 (modelo de decisão: escolhe entre opções e diz a confiança), não as listas de domínio escritas à mão.
 *
 * Medido em 164 páginas reais do cache do AuGPT, marcadas à mão (117 sites: fones, ar-condicionado, GTA 6, Harry
 * Potter, teoria da computação, streaming, notícias do dia):
 *   regras de hoje 79/164 (48%) — notícia 1/21, afiliado/SEO 5/35: fora das listas de domínio, quase tudo era "site";
 *   Tev1 0.8B 108/164 (66%, 0,07 s na placa, 1,2 s na CPU) · Tev1 4B 137/164 (84%, 0,15 s na placa) — notícia 20/21,
 *   afiliado 26/35, comunidade 17/17, teste 23/24. "Na dúvida, a regra" não ajudou (135/164): a regra só vale onde é
 *   certeira — a lista de lojas.
 *
 * Classes: teste · comunidade · referencia · noticia · loja · afiliado · vazio · outro.
 */

const { tipoDaPagina, qualidadeDoDominio } = require('../tools/search');
const { tipoDeFonte, sitesDaTabela } = require('../tools/comunidade');

const CLASSES = ['teste', 'comunidade', 'referencia', 'noticia', 'loja', 'afiliado', 'vazio', 'outro'];
const PERGUNTA = {
  tipo: {
    type: 'choice',
    instructions: 'The state is a web page that a research assistant opened (site, title and the start of the text). What kind of source is it?',
    criteria: {
      teste: 'A review or test by someone who used or measured the product or thing (hands-on review, measurements, benchmark, ranking from tests)',
      comunidade: 'People discussing or sharing their own experience: forum thread, Reddit, Q&A between users, social media post, user video',
      referencia: 'Official or reference source: manufacturer page, documentation, government or institution, encyclopedia, academic paper or course material',
      noticia: 'A news article or press report about recent events',
      loja: 'A store, product listing, marketplace or price comparison page that sells the product',
      afiliado: 'A generic "best X" list, buying guide or SEO article written to rank on search or earn affiliate commissions, without real testing',
      vazio: 'No real content: blocked page, captcha, login wall, error 404, or just an index/home page with links',
      outro: 'Anything else (homework answers, fan content, unrelated)',
    },
  },
};

const dominio = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

/** As regras de antes (a reserva: sem o Tev1, com a placa ocupada ou se ele falhar). */
function pelasRegras(f) {
  if (tipoDeFonte(f.url) === 'loja') return 'loja';
  const t = tipoDaPagina({ url: f.url, titulo: f.titulo || '', resumo: String(f.resumo || '').slice(0, 300) }, { recomendacao: true }).tipo;
  if (t === 'lista de afiliado') return 'afiliado';
  if (t === 'comunidade') return 'comunidade';
  if (t === 'teste próprio') return 'teste';
  const d = qualidadeDoDominio(f.url).tipo || '';
  if (/fórum|rede social/.test(d)) return 'comunidade';
  if (/referência|universidade|oficial|dicionário/.test(d)) return 'referencia';
  if (/notícia|jornal|imprensa/.test(d)) return 'noticia';
  if (/conteúdo genérico|blog/.test(d)) return 'afiliado';
  return 'outro';
}

/*
 * Memória por site, na sessão: o site julgado afiliado/SEO 2 vezes, e nunca de outro tipo, não pergunta de novo — o
 * "Benchmark Técnico de 10 Modelos" do portaltcm passou como teste (0,85) nas 3 páginas medidas. No app (24/11), o
 * Clube do Hardware ficou "afiliado" assim: o site que as regras conhecem como fórum, notícia ou referência nunca fica.
 * ponytail: só na memória do processo; gravar na memória operacional se valer entre sessões.
 */
const porSite = new Map();
const VEZES_PARA_FIXAR = 2;
function lembrar(site, classe) {
  if (!site) return;
  const c = porSite.get(site) || {};
  c[classe] = (c[classe] || 0) + 1;
  porSite.set(site, c);
}
function fixadoDoSite(site, f) {
  const c = porSite.get(site);
  if (!c || (c.afiliado || 0) < VEZES_PARA_FIXAR || Object.keys(c).some((k) => k !== 'afiliado')) return null;
  // o que as regras sabem pelo DOMÍNIO (fórum, notícia, referência) trava; "teste" não — vem da palavra "benchmark" no título
  return ['comunidade', 'referencia', 'noticia'].includes(pelasRegras(f)) ? null : 'afiliado';
}
// os sites que medem e os agregadores da tabela de categorias (dados/comunidades.json) têm a palavra final: o RTINGS saiu
// uma vez "afiliado" (0,64) no app
function daTabela(site) {
  const { testes, agregadores } = sitesDaTabela();
  const de = (conjunto) => [...conjunto].some((d) => site === d || site.endsWith(`.${d}`));
  return de(testes) ? 'teste' : de(agregadores) ? 'comunidade' : null;
}
// abaixo disto, a resposta do Tev1 é palpite (o iemranking saiu "vazio" com 0,22): fica a regra
const CONFIANCA_MINIMA = 0.4;

/**
 * Classifica as fontes lidas (com trechos) que ainda não têm `tipoFonte`. Muda cada fonte: `tipoFonte`, `confTipo`
 * (null pela regra) e `tipoPor` ('tev1' | 'regra' | 'site' | 'loja' | 'tabela'). `decidir` é o ollama.decidir do app; sem ele ou
 * sem `modelo`, ficam as regras. Nunca segura a pesquisa: erro ou demora vira regra. Devolve o resumo para o aviso.
 */
async function classificarFontes(fontes, { decidir, modelo, paralelo = 4, timeoutMs = 5000, signal, naoLidas = [] } = {}) {
  // só as LIDAS (24/11, no app: com os resultados de busca não lidos eram 35 a 46 por pergunta e 6 a 10 s)
  // as LIDAS (24/11, no app: com todos os resultados de busca eram 35 a 46 por pergunta e 6 a 10 s) e, pelo resumo da busca,
  // as não lidas que podem ir para o escritor (`naoLidas`, as mais ligadas à pergunta — a régua da fase 4 mostrou 57–88% do
  // material sem tipo: o escritor também recebe o resumo das que não foram abertas)
  const alvos = [...new Set([...(fontes || []).filter((f) => f && f.trechos?.length), ...naoLidas])].filter((f) => f && f.url && !f.tipoFonte && !f.imagem && (f.trechos?.length || f.resumo));
  let usarTev1 = typeof decidir === 'function' && Boolean(modelo);
  let falhas = 0;
  const um = async (f) => {
    const site = dominio(f.url);
    // a lista de lojas é certeira (24/31 na medição; o Tev1 chamou 2 de vazias)
    if (tipoDeFonte(f.url) === 'loja') return Object.assign(f, { tipoFonte: 'loja', confTipo: null, tipoPor: 'loja' });
    const tabela = daTabela(site);
    if (tabela) return Object.assign(f, { tipoFonte: tabela, confTipo: null, tipoPor: 'tabela' });
    const fixado = fixadoDoSite(site, f);
    if (fixado) return Object.assign(f, { tipoFonte: fixado, confTipo: null, tipoPor: 'site' });
    if (usarTev1 && !signal?.aborted) {
      const texto = String(f.trechos?.length ? f.trechos.join(' ') : f.resumo || '').replace(/\s+/g, ' ').slice(0, 500);
      try {
        const a = await decidir({ model: modelo, state: `Site: ${site}\nTitle: ${String(f.titulo || '').slice(0, 160)}\nStart of the text: ${texto}`, questions: PERGUNTA, timeout: timeoutMs, signal });
        const classe = a?.tipo?.choice;
        const conf = typeof a?.tipo?.confidence === 'number' ? a.tipo.confidence : null;
        if (CLASSES.includes(classe) && (conf === null || conf >= CONFIANCA_MINIMA)) {
          lembrar(site, classe);
          return Object.assign(f, { tipoFonte: classe, confTipo: conf, tipoPor: 'tev1' });
        }
      } catch {
        // o Tev1 caiu ou não está instalado: depois de 2 falhas, a pesquisa inteira fica com as regras
        falhas += 1;
        if (falhas >= 2) usarTev1 = false;
      }
    }
    return Object.assign(f, { tipoFonte: pelasRegras(f), confTipo: null, tipoPor: 'regra' });
  };
  for (let i = 0; i < alvos.length; i += paralelo) await Promise.all(alvos.slice(i, i + paralelo).map(um));
  const contagem = {};
  for (const f of alvos) contagem[f.tipoFonte] = (contagem[f.tipoFonte] || 0) + 1;
  return { classificadas: alvos.length, pelo: alvos.filter((f) => f.tipoPor === 'tev1').length, contagem };
}

/** Para a bancada. */
const _limparMemoria = () => porSite.clear();

module.exports = { classificarFontes, pelasRegras, CLASSES, PERGUNTA, _limparMemoria };
