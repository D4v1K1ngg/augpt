'use strict';

/**
 * Cliente HTTP compartilhado pelas ferramentas de web.
 * Cuida de: timeout, teto de tamanho, redirecionamento e decodificação de
 * charset (muito site brasileiro antigo ainda serve ISO-8859-1).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CABECALHOS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

function charsetDe(contentType = '', amostra = '') {
  const doCabecalho = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (doCabecalho) return doCabecalho.toLowerCase();
  const daMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(amostra)?.[1] ||
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(amostra)?.[1];
  return (daMeta || 'utf-8').toLowerCase();
}

/**
 * `conferir` (opcional, Fase 1 de segurança 2026-09-23): função assíncrona
 * chamada com a URL de CADA salto — a inicial e cada redirecionamento — antes
 * da requisição. Sem ela, um site público podia responder "302 → http://192.168.0.1/"
 * e o `redirect: 'follow'` levava a leitura pra dentro da rede local mesmo com
 * a URL original conferida. Com `conferir`, os redirecionamentos são seguidos
 * aqui, um por um (até 5), em vez de automaticamente pelo fetch.
 */
async function baixar(url, { timeout = 20000, maxBytes = 3_000_000, headers = {}, metodo = 'GET', corpo, conferir } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  try {
    let atual = url;
    let res;
    for (let saltos = 0; ; saltos += 1) {
      if (conferir) await conferir(atual);
      res = await fetch(atual, {
        method: saltos ? 'GET' : metodo,
        headers: { ...CABECALHOS, ...headers },
        body: saltos ? undefined : corpo,
        redirect: conferir ? 'manual' : 'follow',
        signal: controller.signal,
      });
      const destino = res.headers.get('location');
      if (!conferir || res.status < 300 || res.status >= 400 || !destino) break;
      if (saltos >= 5) throw new Error('redirecionamentos demais');
      await res.body?.cancel().catch(() => {});
      atual = new URL(destino, atual).href;
    }
    if (conferir) url = atual; // eslint-disable-line no-param-reassign -- a URL final é a do último salto

    const tipo = res.headers.get('content-type') || '';
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer.byteLength > maxBytes ? buffer.slice(0, maxBytes) : buffer);

    // primeira passada em latin1 só para achar a meta charset
    const amostra = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    let texto;
    try {
      texto = new TextDecoder(charsetDe(tipo, amostra)).decode(bytes);
    } catch {
      texto = new TextDecoder('utf-8').decode(bytes);
    }

    // `texto` acima decodifica QUALQUER resposta como texto — para um PDF, imagem
    // ou outro binário isso produz lixo (bytes de stream comprimido interpretados
    // como caracteres). Quem lida com páginas (ler(), em extract.js) precisa dos
    // bytes originais pra poder detectar isso e extrair de verdade (ex.: via
    // src/formatos/pdf.js) em vez de repassar o texto decodificado adiante.
    return { ok: res.ok, status: res.status, tipo, texto, buffer: Buffer.from(bytes), url: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Baixa bytes crus (zip, tar.gz, executável) sem passar pela decodificação de
 * texto do `baixar()` acima — decodificar binário como texto corrompe o
 * conteúdo. Usado pelo instalador do runtime SearXNG (`src/searxng-runtime.js`)
 * para baixar o Python embeddable e o código-fonte do SearXNG.
 */
async function baixarBinario(url, { timeout = 120000, maxBytes = 200_000_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`download maior que o limite (${Math.round(buffer.byteLength / 1e6)} MB)`);
    }
    return { ok: res.ok, status: res.status, buffer: Buffer.from(buffer), url: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Valida uma URL vinda do modelo antes de qualquer navegação.
 *
 * Só existia um regex de prefixo (`^https?://`), que deixava passar coisas
 * como duas URLs coladas numa única chamada — o Electron rejeitava lá na
 * frente com ERR_INVALID_URL, um erro técnico que não orienta o modelo a
 * corrigir nada. Validar aqui, cedo, com uma mensagem que pede EXATAMENTE
 * uma URL por chamada.
 */
function validarUrl(bruta) {
  const s = String(bruta || '').trim();
  if (!s) throw new Error('Informe "url".');
  let obj;
  try {
    obj = new URL(s);
  } catch {
    throw new Error(
      `URL inválida: "${s.slice(0, 120)}". Informe EXATAMENTE um endereço completo por chamada, ` +
        'começando com http:// ou https:// — para comparar sites, chame a ferramenta uma vez para cada um.'
    );
  }
  if (obj.protocol !== 'http:' && obj.protocol !== 'https:') {
    throw new Error('A URL precisa começar com http:// ou https://');
  }
  return obj.href;
}

module.exports = { baixar, baixarBinario, UA, CABECALHOS, validarUrl };
