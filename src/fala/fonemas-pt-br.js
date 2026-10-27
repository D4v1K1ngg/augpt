'use strict';

/**
 * Texto em português do Brasil → fonemas no alfabeto do Kokoro (27/10, pedido do Davi: a voz "estilo
 * Jarvis"). O kokoro-js só sabe fazer isso em inglês; o eSpeak completo é GPL e seria um programa à parte.
 * Estas regras seguem a escrita (o português é regular) e o que o eSpeak pt-br produz, que é o que o
 * Kokoro ouviu no treino: o acento (ˈ) logo antes da vogal tônica, "ʧ"/"ʤ" para ti/di, til combinado nas
 * nasais, "x" para o R forte, "w" para o L no fim da sílaba.
 *
 * Limites conhecidos (ponytail: regras, não dicionário): o "e"/"o" tônicos sem acento gráfico saem
 * fechados ("bola" sai "bóla"? não — sai "bôla"); "x" tem leituras irregulares (só as comuns estão aqui);
 * palavra estrangeira fora da lista é lida como se fosse português. Para melhorar: um dicionário de exceções.
 */

/* ------------------------------ números ------------------------------ */
const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n < 20) return UNIDADES[n];
  if (n < 100) return DEZENAS[Math.floor(n / 10)] + (n % 10 ? ` e ${UNIDADES[n % 10]}` : '');
  if (n === 100) return 'cem';
  return CENTENAS[Math.floor(n / 100)] + (n % 100 ? ` e ${ate999(n % 100)}` : '');
}

/** 1234567 → "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete" */
function numeroPorExtenso(n) {
  n = Math.floor(Math.abs(Number(n)));
  if (!Number.isFinite(n)) return '';
  if (n < 1000) return ate999(n);
  const grupos = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões']];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i -= 1) {
    const g = grupos[i];
    if (!g) continue;
    if (i === 1 && g === 1) partes.push('mil');
    else if (i === 0) partes.push(ate999(g));
    else partes.push(`${ate999(g)} ${g === 1 ? nomes[i][0] : nomes[i][1]}`);
  }
  // "mil e cem", "dois mil e trinta"; com mais partes, vírgula (pausa) entre elas
  if (partes.length === 2 && (grupos[0] < 100 || grupos[0] % 100 === 0)) return `${partes[0]} e ${partes[1]}`;
  return partes.join(', ');
}

const comFeminino = (t) => t.replace(/\bum\b/g, 'uma').replace(/\bdois\b/g, 'duas').replace(/(duz|trez|quatroc|quinh|seisc|setec|oitoc|novec)entos\b/g, '$1entas');

/** Números, dinheiro, %, horas e símbolos viram palavras (antes das regras de leitura). */
function porExtenso(texto) {
  let t = String(texto || '');
  // dinheiro: R$ 5,44 / R$ 1.299,90 / US$ 30
  t = t.replace(/(R\$|US\$|U\$|€)\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g, (m, moeda, inteiro, cent) => {
    const n = Number(inteiro.replace(/\./g, ''));
    const [um, varios] = moeda === 'R$' ? ['real', 'reais'] : moeda === '€' ? ['euro', 'euros'] : ['dólar', 'dólares'];
    const c = cent ? Number(cent.padEnd(2, '0')) : 0;
    const parteInteira = n ? `${numeroPorExtenso(n)}${n >= 1e6 && n % 1e6 === 0 ? ' de' : ''} ${n === 1 ? um : varios}` : '';
    const parteCent = c ? `${numeroPorExtenso(c)} ${c === 1 ? 'centavo' : 'centavos'}` : '';
    return [parteInteira, parteCent].filter(Boolean).join(' e ') || `zero ${varios}`;
  });
  // horas: 14h30, 9h, 14:30
  t = t.replace(/\b(\d{1,2})(?:h|:)(\d{2})\b/g, (m, h, min) => `${comFeminino(numeroPorExtenso(Number(h)))} ${Number(h) === 1 ? 'hora' : 'horas'}${Number(min) ? ` e ${numeroPorExtenso(Number(min))}` : ''}`);
  t = t.replace(/\b(\d{1,2})h\b/g, (m, h) => `${comFeminino(numeroPorExtenso(Number(h)))} ${Number(h) === 1 ? 'hora' : 'horas'}`);
  // porcentagem e graus
  t = t.replace(/(\d+(?:,\d+)?)\s?%/g, '$1 por cento');
  t = t.replace(/(\d+(?:,\d+)?)\s?°\s?C\b/g, '$1 graus').replace(/(\d+(?:,\d+)?)\s?°/g, '$1 graus');
  // decimal com vírgula: 0,47 → "zero vírgula quarenta e sete"
  t = t.replace(/\b(\d+),(\d+)\b/g, (m, a, b) => `${numeroPorExtenso(Number(a))} vírgula ${/^0/.test(b) ? b.split('').map((d) => UNIDADES[Number(d)]).join(' ') : numeroPorExtenso(Number(b))}`);
  // milhar com ponto: 205.083
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => numeroPorExtenso(Number(m.replace(/\./g, ''))));
  // ordinal simples: 1º, 2ª
  t = t.replace(/\b(\d{1,2})([ºª°])/g, (m, n, g) => {
    const ord = ['', 'primeir', 'segund', 'terceir', 'quart', 'quint', 'sext', 'sétim', 'oitav', 'non', 'décim'][Number(n)];
    return ord ? `${ord}${g === 'ª' ? 'a' : 'o'}` : m;
  });
  // RTX 5080, 7800X3D: número colado em letra é lido dígito a dígito agrupado ("cinquenta e oitenta"? não —
  // "cinco mil e oitenta" engana): número de modelo de 4+ dígitos vai em pares ("cinquenta, oitenta")
  t = t.replace(/\b([A-Za-z]+)[ -]?(\d{4})\b/g, (m, letras, num) => `${letras} ${numeroPorExtenso(Number(num.slice(0, 2)))} ${num.slice(2) === '00' ? 'cem' : numeroPorExtenso(Number(num.slice(2)))}`);
  t = t.replace(/\d+/g, (m) => numeroPorExtenso(Number(m)));
  return t.replace(/&/g, ' e ').replace(/\+/g, ' mais ').replace(/=/g, ' igual a ').replace(/\//g, ' barra ');
}

/* ------------------------------ siglas e estrangeiras ------------------------------ */
const LETRAS = { a: 'á', b: 'bê', c: 'cê', d: 'dê', e: 'ê', f: 'éfe', g: 'gê', h: 'agá', i: 'i', j: 'jóta', k: 'cá', l: 'éle', m: 'ême', n: 'ênne', o: 'ó', p: 'pê', q: 'quê', r: 'érre', s: 'ésse', t: 'tê', u: 'u', v: 'vê', w: 'dáblio', x: 'xis', y: 'ípsilon', z: 'zê' };
// siglas lidas como palavra
const SIGLAS_PALAVRA = new Set(['ONU', 'NASA', 'OTAN', 'UNESCO', 'FIFA', 'PIX', 'ENEM', 'INSS', 'SUS', 'IBGE', 'DETRAN', 'PETROBRAS', 'LED', 'RAM', 'ROM', 'WIFI', 'COVID', 'AUGPT']);
// pronúncia já em fonemas (palavras comuns do dia a dia em inglês e marcas)
const ESTRANGEIRAS = {
  mouse: 'mˈawzi', download: 'dawnlˈowʤi', downloads: 'dawnlˈowʤis', upload: 'aplˈowʤi', gamer: 'ɡˈejmeɾ', gamers: 'ɡˈejmeɾs', game: 'ɡˈejmi', games: 'ɡˈejmis',
  online: 'õlˈajni', offline: 'ɔflˈajni', site: 'sˈajʧi', sites: 'sˈajʧis', link: 'lˈĩki', links: 'lˈĩkis', email: 'imˈejw', app: 'ˈɛpi', apps: 'ˈɛpis',
  wifi: 'wajfˈaj', 'wi-fi': 'wajfˈaj', streaming: 'stɾˈimĩ', streamer: 'stɾˈimeɾ', ping: 'pˈĩ', lag: 'lˈɛɡi', setup: 'sɛʧˈapi', update: 'apdˈejʧi',
  software: 'sˈɔftweɾ', hardware: 'xˈaɾdweɾ', notebook: 'nowʧibˈuki', headset: 'xˈɛdsɛʧi', smartphone: 'smaɾʧifˈoni', iphone: 'ajfˈoni', youtube: 'jutˈubi',
  google: 'ɡˈuɡow', whatsapp: 'wˈatsapi', instagram: 'ĩstaɡɾˈɐ̃', facebook: 'fejsibˈuki', twitter: 'twˈiteɾ', tiktok: 'tʃiktˈɔki', linkedin: 'lĩkedˈĩ',
  nvidia: 'enˈvidiɐ', geforce: 'ʤifˈɔɾsi', intel: 'ĩtˈɛw', amd: 'a ˈemi ˈde', ryzen: 'xˈajzẽ', windows: 'wˈĩdows', microsoft: 'majkɾosˈɔfʧi', bluetooth: 'bluʧˈuʧi',
  jarvis: 'ʤˈaɾvis', hall: 'xˈɔw', txt: 'tˈe ʃˈis tˈe', pdf: 'pˈe dˈe ˈɛfi', ok: 'ɔkˈej', okay: 'ɔkˈej', sir: 'sˈɛɾ', chat: 'ʃˈɛʧi', bug: 'bˈaɡi', reddit: 'xˈɛʤiʧi', ollama: 'olˈama', kokoro: 'kokˈɔɾu', gpt: 'ʒe pe tˈe',
};

const ehSigla = (p) => /^[A-Z]{2,6}$/.test(p) && !SIGLAS_PALAVRA.has(p);
const soletrar = (p) => p.toLowerCase().split('').map((l) => LETRAS[l] || l).join(' ');

/* ------------------------------ palavras átonas ------------------------------ */
// sem acento próprio na frase (lidas grudadas na palavra seguinte)
const ATONAS = new Set(['o', 'a', 'os', 'as', 'um', 'uns', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'que', 'se', 'me', 'te', 'lhe', 'nos', 'vos', 'com', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'pro', 'mas', 'ou', 'num', 'numa', 'ao', 'aos', 'à', 'às', 'sem', 'seu', 'sua', 'meu', 'minha', 'teu']);

/* ------------------------------ sílaba tônica ------------------------------ */
const VOGAL = 'aeiouáéíóúâêôãõàü';
// (27/10: sem o !!c, ehVogal('') era true — 'seu' saía 'zeu', 'Brasil' com L)
const ehVogal = (c) => Boolean(c) && VOGAL.includes(c);
const ACENTO = /[áéíóúâêôãõ]/;

/** Os núcleos (grupos de vogais que formam uma sílaba): [{ inicio, fim }] na palavra. */
function nucleos(p) {
  const lista = [];
  let i = 0;
  while (i < p.length) {
    if (!ehVogal(p[i]) || (p[i] === 'u' && /[qg]/.test(p[i - 1] || '') && /[eiéí]/.test(p[i + 1] || ''))) {
      i += 1;
      continue;
    }
    let fim = i + 1;
    // ditongo decrescente: vogal + i/u átono ("noite", "pouco", "mau"); ão, õe, ãe
    const prox = p[fim];
    if (prox && /[iu]/.test(prox) && !/[iu]/.test(p[i]) && !(ehVogal(p[fim + 1] || '') ) && !(/[mn]/.test(p[fim + 1] || '') && !ehVogal(p[fim + 2] || '') && p[fim + 2] !== undefined)) fim += 1;
    else if (prox === 'o' && p[i] === 'ã') fim += 1;
    else if (prox === 'e' && /[ãõ]/.test(p[i])) fim += 1;
    else if (/[ui]/.test(p[i]) && prox && /[iu]/.test(prox) && p[i] !== prox && !ehVogal(p[fim + 1] || '')) fim += 1; // "fui", "riu"
    lista.push({ inicio: i, fim });
    i = fim;
  }
  return lista;
}

/** O índice (em `nucleos`) da sílaba tônica. */
function tonica(p, ns) {
  if (!ns.length) return -1;
  const comAcento = ns.findIndex((n) => ACENTO.test(p.slice(n.inicio, n.fim)) && !/[ãõ]/.test(p.slice(n.inicio, n.fim)));
  if (comAcento >= 0) return comAcento;
  const nasalTil = ns.findIndex((n) => /[ãõ]/.test(p.slice(n.inicio, n.fim)));
  if (nasalTil >= 0) return nasalTil;
  if (ns.length === 1) return 0;
  // paroxítona: termina em a, e, o (com ou sem s), am, em, ens
  if (/([aeo]s?|am|em|ens)$/.test(p)) return ns.length - 2;
  return ns.length - 1;
}

/* ------------------------------ uma palavra ------------------------------ */
// o Kokoro só conhece o til SEPARADO (o + U+0303): "õ" inteiro era jogado fora pelo tokenizador (27/10)
const kokoro = (t) => t.normalize('NFD');
function palavraEmFonemas(original, opcoes = {}) {
  return kokoro(palavraCrua(original, opcoes));
}
function palavraCrua(original, { atona = false } = {}) {
  const p = original.toLowerCase();
  if (ESTRANGEIRAS[p]) return ESTRANGEIRAS[p];
  // palavras curtas irregulares
  const IRREG = { e: 'i', é: 'ˈɛ', o: 'u', a: 'a', ao: 'aw', à: 'a', de: 'ʤi', que: 'ki', se: 'si', me: 'mi', te: 'ʧi', lhe: 'ʎi', com: 'kõ', por: 'poɾ', para: 'paɾɐ', pra: 'pɾɐ', mas: 'mas', muito: 'mˈũjtu', muita: 'mˈũjtɐ', muitos: 'mˈũjtus', muitas: 'mˈũjtɐs', também: 'tɐ̃bˈẽj', bem: 'bˈẽj', sem: 'sẽj', em: 'ẽj', um: 'ũ', uma: 'ˈumɐ', mim: 'mˈĩ', sim: 'sˈĩ', não: 'nˈɐ̃w', só: 'sˈɔ', nós: 'nˈɔs', vós: 'vˈɔs', está: 'istˈa', estão: 'istˈɐ̃w', isto: 'ˈistu', isso: 'ˈisu', esse: 'ˈesi', essa: 'ˈɛsɐ', este: 'ˈesʧi', esta: 'ˈɛstɐ', senhor: 'siɲˈoɾ', senhora: 'siɲˈɔɾɐ', você: 'vosˈe', vocês: 'vosˈes', tem: 'tˈẽj', têm: 'tˈẽjẽj', vem: 'vˈẽj', quem: 'kˈẽj', hoje: 'ˈoʒi', ontem: 'ˈõtẽj', agora: 'aɡˈɔɾɐ', depois: 'depˈojs', obrigado: 'obɾiɡˈadu', obrigada: 'obɾiɡˈadɐ', sobre: 'sˈobɾi', onde: 'ˈõʤi', fora: 'fˈɔɾɐ', hora: 'ˈɔɾɐ', horas: 'ˈɔɾɐs', nova: 'nˈɔvɐ', novo: 'nˈovu', boa: 'bˈoɐ', bom: 'bˈõ', pessoa: 'pesˈoɐ', melhor: 'meʎˈɔɾ', pior: 'piˈɔɾ', maior: 'majˈɔɾ', menor: 'menˈɔɾ', porque: 'poɾkˈe', mês: 'mˈes', três: 'tɾˈes', seis: 'sˈejs', dez: 'dˈɛs', mil: 'mˈiw', cem: 'sˈẽj', dois: 'dˈojs', aos: 'aws', às: 'as' };
  if (IRREG[p]) return atona ? IRREG[p].replace(/ˈ/g, '') : IRREG[p];

  const ns = nucleos(p);
  const t = atona ? -1 : tonica(p, ns);
  const tonicoEm = t >= 0 ? ns[t].inicio : -1;
  const ultimoNucleo = ns.length ? ns[ns.length - 1] : null;
  let saida = '';
  let i = 0;
  const prox = (k = 1) => p[i + k] || '';
  const ant = () => p[i - 1] || '';
  const fimDaSilaba = (k) => !p[k] || (!ehVogal(p[k]) && !/[lr]/.test(p[k]) && !(ehVogal(p[k + 1] || ''))) || (!ehVogal(p[k]) && !ehVogal(p[k + 1] || ''));
  while (i < p.length) {
    const c = p[i];
    // a sílaba tônica: a marca vem logo antes da vogal
    if (i === tonicoEm) saida += 'ˈ';
    if (ehVogal(c)) {
      const nucleo = ns.find((n) => i >= n.inicio && i < n.fim);
      const ehTonica = nucleo && nucleo.inicio === tonicoEm;
      // a última vogal átona (o "e" de "noite" vira i, o "o" de "carro" vira u) — palavra de uma sílaba só não ("seu")
      const ehFinal = nucleo === ultimoNucleo && !ehTonica && (ns.length > 1 || (atona && nucleo.fim - nucleo.inicio === 1));
      // nasal: vogal + m/n antes de consoante ou no fim ("tempo", "bem", "canto")
      const depois = p[i + 1] || '';
      const nasalPorMN = /[mn]/.test(depois) && (!p[i + 2] || (!ehVogal(p[i + 2]) && p[i + 2] !== 'h'));
      let v;
      switch (c) {
        case 'á': case 'à': v = 'a'; break;
        case 'â': v = 'ɐ'; break;
        case 'ã': v = 'ɐ̃'; break;
        case 'é': v = 'ɛ'; break;
        case 'ê': v = 'e'; break;
        case 'í': v = 'i'; break;
        case 'ó': v = 'ɔ'; break;
        case 'ô': v = 'o'; break;
        case 'õ': v = 'õ'; break;
        case 'ú': case 'ü': v = 'u'; break;
        case 'a': v = ehFinal ? 'ɐ' : 'a'; break;
        case 'e': v = ehFinal && !nasalPorMN ? 'i' : 'e'; break;
        case 'o': v = ehFinal && !nasalPorMN ? 'u' : 'o'; break;
        default: v = c; // i, u
      }
      // 'e' átono antes da última vogal: vídeo → vidʒju, área → aɾja
      if (c === 'e' && !ehTonica && /^[ao]s?$/.test(p.slice(i + 1)) && ns.length > 1) v = 'j';
      // semivogal no ditongo ("noite" → "nojʧi", "pouco" → "powku")
      if (nucleo && i > nucleo.inicio && /[iu]/.test(c) && nucleo.fim - nucleo.inicio === 2) v = c === 'i' ? 'j' : 'w';
      // ão, õe, ãe
      if (c === 'o' && ant() === 'ã') v = 'w';
      if (c === 'e' && /[ãõ]/.test(ant())) v = 'j';
      if (nasalPorMN && !/[ãõ]/.test(c)) {
        const base = v === 'ɐ' ? 'ɐ' : v.replace('a', 'ɐ');
        // "em"/"ens" no fim: ẽj; "am" no fim: ɐ̃w
        if (!p[i + 2] && depois === 'm' && c === 'e') { saida += 'ẽj'; i += 2; continue; }
        if (p.slice(i + 1) === 'ns' && c === 'e') { saida += 'ẽjs'; i += 3; continue; }
        if (!p[i + 2] && depois === 'm' && c === 'a') { saida += 'ɐ̃w'; i += 2; continue; }
        saida += `${c === 'a' || c === 'â' ? 'ɐ' : base}̃`;
        i += 2; // a consoante nasal some
        continue;
      }
      saida += v;
      i += 1;
      continue;
    }
    // consoantes
    switch (c) {
      case 'b': case 'f': case 'k': case 'p': case 'v': saida += c; break;
      case 'w': saida += 'w'; break;
      case 'y': saida += 'i'; break;
      case 'h': break; // mudo (lh, nh, ch tratados abaixo)
      case 'ç': saida += 's'; break;
      case 'c':
        if (prox() === 'h') { saida += 'ʃ'; i += 1; } else saida += /[eiéêí]/.test(prox()) ? 's' : 'k';
        break;
      case 'q':
        saida += 'k';
        if (prox() === 'u' && /[eiéí]/.test(prox(2))) i += 1;
        else if (prox() === 'u' && /[aoáó]/.test(prox(2))) { saida += 'w'; i += 1; } // quarenta, quatro
        break;
      case 'g':
        if (prox() === 'u' && /[eiéí]/.test(prox(2))) { saida += 'ɡ'; i += 1; } else if (prox() === 'u' && /[aoáó]/.test(prox(2)) && tonicoEm !== i + 1) { saida += 'ɡw'; i += 1; } else saida += /[eiéêí]/.test(prox()) ? 'ʒ' : 'ɡ';
        break;
      case 'j': saida += 'ʒ'; break;
      case 't': case 'd': {
        // ti/di (e o "e" final átono, que vira i): tchi/dji
        const seguinte = p[i + 1] || '';
        const viraI = seguinte === 'i' || seguinte === 'í' || (seguinte === 'e' && /[ao]/.test(p[i + 2] || '') && i + 1 !== tonicoEm && !p[i + 3]) || (seguinte === 'e' && i + 1 === (ultimoNucleo?.inicio) && ultimoNucleo.inicio !== tonicoEm && !p[i + 2]) || (seguinte === 'e' && p.slice(i + 1) === 'es' && ultimoNucleo.inicio !== tonicoEm);
        saida += viraI ? (c === 't' ? 'ʧ' : 'ʤ') : c;
        break;
      }
      case 'l':
        if (prox() === 'h') { saida += 'ʎ'; i += 1; break; }
        saida += ehVogal(prox()) ? 'l' : 'w'; // "Brasil", "alto"
        break;
      case 'm': saida += ehVogal(prox()) ? 'm' : ''; break;
      case 'n':
        if (prox() === 'h') { saida += 'ɲ'; i += 1; break; }
        saida += 'n';
        break;
      case 'r':
        if (prox() === 'r') { saida += 'x'; i += 1; break; }
        // forte no começo e depois de n, l, s; fraco entre vogais e em encontro ("prato")
        if (i === 0 || /[nls]/.test(ant())) saida += 'x';
        else if (ehVogal(prox()) || !prox()) saida += ehVogal(ant()) && ehVogal(prox()) ? 'ɾ' : (prox() ? 'ɾ' : 'ɾ');
        else saida += /[bcdfgkptv]/.test(ant()) ? 'ɾ' : 'ɾ';
        break;
      case 's':
        if (prox() === 's') { saida += 's'; i += 1; break; }
        if (prox() === 'c' && /[eiéí]/.test(prox(2))) { saida += 's'; i += 1; break; }
        if (prox() === 'ç') { saida += 's'; i += 1; break; }
        if (ehVogal(ant()) && ehVogal(prox())) { saida += 'z'; break; } // casa
        saida += /[bdgjlmnrvz]/.test(prox()) ? 'z' : 's'; // "mesmo" → mezmu
        break;
      case 'x':
        if (i === p.length - 1) { saida += 'ks'; break; } // tórax, xerox
        if (/^ex[aeiouáéíóú]/.test(p.slice(i - 1)) && i === 1) { saida += 'z'; break; } // exame, exemplo
        if (prox() === 'c' && /[eiéí]/.test(prox(2))) { saida += 's'; i += 1; break; } // exceto
        if (/^(t[aá]xi|t[oó]xic|fixo|fix|sexo|anex|reflex|complex|flex|nex|box|lux)/.test(p.slice(Math.max(0, i - 3)))) { saida += 'ks'; break; }
        if (/^(pr[oó]xim|m[aá]xim|aux[ií]li|sint[aá]x|trouxe)/.test(p.slice(Math.max(0, i - 4)))) { saida += 's'; break; }
        saida += 'ʃ';
        break;
      case 'z': saida += i === p.length - 1 ? 's' : 'z'; break;
      default: saida += c;
    }
    i += 1;
  }
  void fimDaSilaba;
  return saida;
}

/* ------------------------------ o texto ------------------------------ */
/**
 * Texto → fonemas para o Kokoro (voz pf_dora / pm_alex / pm_santa). Pontuação fica (dá as pausas).
 * Markdown, links e emojis saem antes.
 */
function textoEmFonemas(texto) {
  let t = String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#`>|~]/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ');
  // nome de arquivo: teclado.txt → 'teclado ponto txt'
  t = t.replace(/\b([\p{L}\d_-]+)\.([a-z]{2,4})\b/gu, (m, nome, ext) => `${nome} ponto ${ext.toUpperCase()}`);
  t = porExtenso(t);
  // siglas antes de tudo virar minúscula
  t = t.replace(/\b[A-Z]{2,6}\b/g, (m) => (ehSigla(m) ? soletrar(m) : m));
  const tokens = t.match(/[\p{L}][\p{L}'-]*|[.,!?;:…—]/gu) || [];
  const saida = [];
  tokens.forEach((tok, k) => {
    if (/^[.,!?;:…—]$/.test(tok)) {
      saida.push(tok);
      return;
    }
    const partes = tok.split('-').filter(Boolean);
    const fon = partes.map((parte, j) => {
      const atona = ATONAS.has(parte.toLowerCase()) && (j < partes.length - 1 || /^\p{L}/u.test(tokens[k + 1] || ''));
      return palavraEmFonemas(parte, { atona });
    });
    saida.push(fon.join(' '));
  });
  return saida.join(' ').replace(/ ([.,!?;:…])/g, '$1').replace(/\s+/g, ' ').trim();
}

module.exports = { textoEmFonemas, palavraEmFonemas, porExtenso, numeroPorExtenso };
