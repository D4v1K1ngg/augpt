'use strict';

/**
 * Clima no chat (23/10, pedido do Davi, bloco 3): "como está o tempo em Campinas?", "vai chover
 * amanhã?", "previsão do tempo para o fim de semana". O código consulta o Open-Meteo (gratuito,
 * sem chave; só o nome da cidade e as coordenadas saem do PC) e põe um bloco ```clima na resposta,
 * que a tela desenha como um cartão (renderer/clima.js). A cidade vem da pergunta ou da memória
 * ("lembre que moro em Campinas").
 */

const { baixar } = require('../tools/http');
const { MemoriaCentral } = require('./memoria-central');
const { normalizarLugar, porRelacao, naoResolveu, tentativas, escolherLugar } = require('./lugares');

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/* ------------------------------ que pedido é ------------------------------ */

const CLIMA = /\b(previsao do tempo|previsao para (hoje|amanha|o fim de semana|a semana)|como (esta|ta|vai estar|vai ficar|fica|sera|estara) o (tempo|clima)|(o )?clima (em|no|na|de|do|da|hoje|amanha|agora|pra|para|la fora|a noite|a tarde|de manha|neste|nesse|desta|dessa)|tempo (em|no|na|hoje|amanha|agora|la fora)\b|vai chover|vai fazer (frio|calor|sol)|vai ter (chuva|sol|frio|calor)|(esta|ta) chovendo|chance de chuva|chovendo (em|no|na)|temperatura (em|no|na|de|hoje|amanha|agora|atual|la fora|maxima|minima)|qual (e )?a temperatura|quantos graus|(esta|ta|vai estar) (frio|quente|calor)|weather|forecast|will it rain|is it raining|chance of rain|temperature (in|today|tomorrow|now|outside)|how (hot|cold) is it)\b/;
const FORA = /\b(clima (organizacional|politico|economico|de tensao|tenso|entre|do jogo|da partida|no trabalho|na empresa)|mudancas? climaticas?|aquecimento global|historia|por que|porque|tempo de (execucao|resposta|carregamento|espera|entrega|uso|tela|jogo)|quanto tempo|cpu|gpu|placa|processador|ssd|nvme|hd|computador|pc|notebook|celular|motor|agua do|forno|febre|corpo|bebe)\b/;

/** Quando e se é sobre chuva — vale também quando quem chama é o entendimento (a pergunta não bateu nos padrões). */
function partesDoPedido(pergunta) {
  const t = semAcento(pergunta).replace(/\s+/g, ' ').trim();
  const quando = /\b(amanha|tomorrow)\b/.test(t) ? 'amanha'
    : /\b(fim de semana|final de semana|weekend|sabado|domingo|saturday|sunday)\b/.test(t) ? 'fim_de_semana'
    : /\b(semana|proximos dias|next days|this week|7 dias)\b/.test(t) ? 'semana'
    : 'hoje';
  return { quando, chuva: /\b(chov|chuva|rain|guarda-chuva|umbrella)/.test(t), cidade: cidadeNaPergunta(pergunta) };
}

function pedidoDeClima(pergunta) {
  const t = semAcento(pergunta).replace(/\s+/g, ' ').trim();
  if (!t || t.length > 160 || !CLIMA.test(t) || FORA.test(t)) return null;
  return partesDoPedido(pergunta);
}

/* ------------------------------ a cidade ------------------------------ */

// limites que entendem acento (o \b do JS não vê "ã" como letra: "amanhã em BH" virava a cidade)
const TEMPO = /(?<!\p{L})(hoje|amanh[ãa]|agora|ainda|neste|nesse|nesta|nessa|esta|essa|este|esse|semana|fim de semana|final de semana|pr[óo]ximos dias|[àa] noite|de manh[ãa]|[àa] tarde|de tarde|de noite|today|tomorrow|now|tonight|this week(end)?|next days|later|s[áa]bado|domingo|saturday|sunday)(?!\p{L})/giu;
const PALAVRAS_DO_CLIMA = /\b(previs[ãa]o do tempo|previs[ãa]o|clima|tempo|temperatura|weather|forecast|chance de chuva|chance of rain)\b/gi;
const ALIASES = { bh: 'Belo Horizonte', sp: 'São Paulo', sampa: 'São Paulo', rio: 'Rio de Janeiro', rj: 'Rio de Janeiro', poa: 'Porto Alegre', floripa: 'Florianópolis', bsb: 'Brasília', cwb: 'Curitiba', ssa: 'Salvador' };
const NAO_E_CIDADE = /^(aqui|la|ai|casa|minha cidade|minha regiao|onde eu moro|a rua|la fora|outside|here|my city|my area)$/;

/** "como está o clima em São Paulo hoje?" → "São Paulo"; "previsão do tempo para amanhã" → null. */
function cidadeNaPergunta(pergunta) {
  const resto = String(pergunta || '').replace(/[?!.]+\s*$/, '').replace(TEMPO, ' ').replace(PALAVRAS_DO_CLIMA, ' ').replace(/\s+/g, ' ').trim();
  const m = /\b(?:em|no|na|para|pra|de|do|da|in|for|at)\s+(.+)$/i.exec(resto);
  if (!m) return null;
  let cidade = m[1].trim();
  // "de em BH", "pra em Recife": as preposições que sobraram
  while (/^(em|no|na|para|pra|de|do|da|in|for|at|o|a|the)\s+/i.test(cidade)) cidade = cidade.replace(/^\S+\s+/, '');
  cidade = cidade.replace(/\s+(vai|vai ter|vai fazer|esta|est[áa]|t[áa]|fica|is|will)\b.*$/i, '').replace(/[,\s]+$/, '').trim();
  const s = semAcento(cidade);
  if (!cidade || cidade.length < 2 || NAO_E_CIDADE.test(s) || /^(chover|chuva|frio|calor|sol|graus?|rain)\b/.test(s)) return null;
  return ALIASES[s] || cidade;
}

/** "moro em Campinas", "minha cidade é Recife", "sou de Curitiba" na memória central. */
function cidadeDaMemoria(pasta) {
  if (!pasta) return null;
  try {
    for (const item of new MemoriaCentral(pasta).listar()) {
      const m = /\b(?:moro|vivo|resido|estou morando|moramos)(?: atualmente| hoje)? (?:em|no|na) ([^.,;!?]+)|\bminha cidade (?:é|e) ([^.,;!?]+)|\bsou de ([^.,;!?]+)|\blive in ([^.,;!?]+)/i.exec(String(item.valor || ''));
      if (m) return (m[1] || m[2] || m[3] || m[4]).trim();
    }
  } catch {
    // sem memória: pergunta a cidade
  }
  return null;
}

const UF = { ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará', df: 'Federal District', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mt: 'Mato Grosso', ms: 'Mato Grosso do Sul', mg: 'Minas Gerais', pa: 'Pará', pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima', sc: 'Santa Catarina', sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins' };
const SIGLA = Object.fromEntries(Object.entries(UF).map(([s, n]) => [semAcento(n), s.toUpperCase()]));
SIGLA['distrito federal'] = 'DF';

/* ------------------------------ Open-Meteo ------------------------------ */

async function pedirJson(url, deps) {
  const r = await (deps.baixar || baixar)(url, { timeout: 10000, headers: { Accept: 'application/json' } });
  if (!r?.ok) throw new Error(`HTTP ${r?.status || '?'}`);
  return JSON.parse(r.texto);
}

/** "Campinas", "Curitiba, PR", "Paris, França" → { nome, rotulo, lat, lon } ou null. */
async function acharCidade(nome, { idioma = 'pt', deps = {} } = {}) {
  // "Vitória ES" / "Vitória-ES" sem vírgula (27/10, no app: "Não achei a cidade Vitória ES"): a sigla do fim é o estado
  let texto = String(nome).trim();
  const comSigla = /^(.+?)[\s-]+([A-Za-z]{2})$/.exec(texto);
  if (!texto.includes(',') && comSigla && UF[comSigla[2].toLowerCase()]) texto = `${comSigla[1]}, ${comSigla[2]}`;
  const [cidade, ...dica] = texto.split(',').map((p) => p.trim()).filter(Boolean);
  const j = await pedirJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=10&language=${idioma}&format=json`, deps);
  const lista = j.results || [];
  if (!lista.length) return null;
  const pista = semAcento(dica.join(' '));
  const estado = UF[pista] ? semAcento(UF[pista]) : pista;
  // sigla de estado vale só no Brasil (27/10: "Vitória, ES" virou Vitoria, Espanha — "ES" é também o código do país)
  const daPista = pista && lista.find((x) => (UF[pista]
    ? x.country_code === 'BR' && semAcento(x.admin1) === estado
    : [x.admin1, x.country, x.country_code].some((v) => semAcento(v) === estado || semAcento(v) === pista)));
  const escolhida = daPista
    // sem pista: a do Brasil (o AuGPT é usado aqui) com mais gente, senão a primeira da busca
    || (!pista && lista.filter((x) => x.country_code === 'BR').sort((a, b) => (b.population || 0) - (a.population || 0))[0])
    || lista[0];
  const uf = escolhida.country_code === 'BR' ? SIGLA[semAcento(escolhida.admin1)] : null;
  const rotulo = [escolhida.name, uf || escolhida.admin1, escolhida.country_code === 'BR' ? null : escolhida.country].filter((v, i, l) => v && l.indexOf(v) === i).join(', ');
  // 26/10 (no app): "Itanhaém, Espírito Santo" mostrou Itanhaém, SP sem dizer nada — o estado pedido não
  // tinha cidade com esse nome; a resposta agora avisa
  return { nome: escolhida.name, rotulo, lat: escolhida.latitude, lon: escolhida.longitude, pistaQueNaoBateu: pista && !daPista ? dica.join(', ') : null };
}

async function previsao(lugar, deps = {}) {
  const q = new URLSearchParams({
    latitude: lugar.lat, longitude: lugar.lon, timezone: 'auto', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max',
  });
  return pedirJson(`https://api.open-meteo.com/v1/forecast?${q}`, deps);
}

/* ------------------------------ códigos do tempo (WMO) ------------------------------ */

const WMO = {
  0: ['céu limpo', 'clear sky', '☀️'], 1: ['predominantemente limpo', 'mainly clear', '🌤️'], 2: ['parcialmente nublado', 'partly cloudy', '⛅'], 3: ['nublado', 'overcast', '☁️'],
  45: ['neblina', 'fog', '🌫️'], 48: ['neblina com geada', 'freezing fog', '🌫️'],
  51: ['garoa fraca', 'light drizzle', '🌦️'], 53: ['garoa', 'drizzle', '🌦️'], 55: ['garoa forte', 'heavy drizzle', '🌧️'], 56: ['garoa congelante', 'freezing drizzle', '🌧️'], 57: ['garoa congelante', 'freezing drizzle', '🌧️'],
  61: ['chuva fraca', 'light rain', '🌦️'], 63: ['chuva moderada', 'moderate rain', '🌧️'], 65: ['chuva forte', 'heavy rain', '🌧️'], 66: ['chuva congelante', 'freezing rain', '🌧️'], 67: ['chuva congelante', 'freezing rain', '🌧️'],
  71: ['neve fraca', 'light snow', '🌨️'], 73: ['neve', 'snow', '🌨️'], 75: ['neve forte', 'heavy snow', '❄️'], 77: ['grãos de neve', 'snow grains', '🌨️'],
  80: ['pancadas de chuva', 'rain showers', '🌦️'], 81: ['pancadas de chuva', 'rain showers', '🌧️'], 82: ['pancadas de chuva fortes', 'violent rain showers', '⛈️'],
  85: ['pancadas de neve', 'snow showers', '🌨️'], 86: ['pancadas de neve fortes', 'heavy snow showers', '❄️'],
  95: ['trovoadas', 'thunderstorm', '⛈️'], 96: ['trovoadas com granizo', 'thunderstorm with hail', '⛈️'], 99: ['trovoadas com granizo', 'thunderstorm with hail', '⛈️'],
};
const descricao = (cod, en) => (WMO[cod] || ['tempo instável', 'unsettled', '🌥️'])[en ? 1 : 0];
const icone = (cod, dia = 1) => (Number(cod) <= 1 && !dia ? '🌙' : (WMO[cod] || [0, 0, '🌥️'])[2]);
const graus = (v) => `${Math.round(v)} °C`;

/* ------------------------------ a resposta ------------------------------ */

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };

// `lugares`: o que o entendimento leu na pergunta (reserva quando a cidade não sai dos padrões ou não é achada)
// `lugares` indefinido = primeira tentativa (pelos padrões, sem o entendimento): faltando a cidade,
// devolve (null) para o entendimento, que lê a conversa ("e o clima lá amanhã?"), completar
async function responderClima({ pergunta, deps = {}, config = {}, pasta, pedido, lugares, conversa = [] } = {}) {
  const p = pedido || pedidoDeClima(pergunta) || partesDoPedido(pergunta);
  const reservas = (Array.isArray(lugares) ? lugares : []).filter(Boolean);
  const en = config.idiomaEfetivo === 'en';
  const fim = (texto, extra = {}) => {
    deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
    return { ...SEM_PESQUISA, texto, modo: 'clima', noIdioma: en, ...extra };
  };
  // "o tempo na capital da Bahia": a cidade pede conhecimento — o entendimento resolve (não a memória)
  if (porRelacao(pergunta) && (lugares === undefined || naoResolveu(pergunta, lugares))) return null;
  // a cidade: a do texto, a que o entendimento leu, a da conversa ("e o clima lá?") ou a da memória
  const nome = normalizarLugar(escolherLugar({ doTexto: p.cidade, reservas, conversa, pergunta, memoria: cidadeDaMemoria(pasta) }) || '');
  if (!nome) {
    if (lugares === undefined) return null;
    return fim(en
      ? 'Which city? Ask, for example, **"weather in Campinas"**, or say **"remember that I live in Campinas"** and I\'ll use it every time.'
      : 'De qual cidade? Pergunte, por exemplo, **"clima em Campinas"**, ou diga **"lembre que moro em Campinas"** e eu uso sempre.');
  }
  let lugar;
  let j;
  try {
    for (const tentativa of tentativas(nome, reservas)) {
      lugar = await acharCidade(tentativa, { idioma: en ? 'en' : 'pt', deps });
      if (lugar) break;
    }
    if (!lugar) return fim(en ? `I couldn't find the city **"${nome}"**. Try the full name, like "Curitiba, PR".` : `Não achei a cidade **"${nome}"**. Tente o nome completo, como "Curitiba, PR".`);
    j = await previsao(lugar, deps);
  } catch (err) {
    deps.emit?.('aviso', { texto: `clima: ${err.message}` });
    return null; // sem o Open-Meteo, a pesquisa responde
  }

  const c = j.current || {};
  const d = j.daily || {};
  const h = j.hourly || {};
  const dias = (d.time || []).map((data, i) => ({
    d: data, cod: d.weather_code[i], ico: icone(d.weather_code[i]), desc: descricao(d.weather_code[i], en),
    max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
    prob: d.precipitation_probability_max?.[i] ?? null, mm: d.precipitation_sum?.[i] ?? null,
    nasce: String(d.sunrise?.[i] || '').slice(11, 16), poe: String(d.sunset?.[i] || '').slice(11, 16), uv: d.uv_index_max?.[i] ?? null,
  }));
  const agoraLocal = String(c.time || '');
  const hoje = dias[0];
  const amanha = dias[1];
  const nomeDoDia = (x) => new Date(`${x.d}T12:00:00`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { weekday: 'long' });
  const chanceDe = (x) => (x.prob == null ? '' : en ? `, ${x.prob}% chance of rain` : `, ${x.prob}% de chance de chuva`);
  const resumoDoDia = (x) => (en ? `${x.desc}, low ${graus(x.min)}, high ${graus(x.max)}${chanceDe(x)}` : `${x.desc}, mínima de ${graus(x.min)} e máxima de ${graus(x.max)}${chanceDe(x)}`);
  // o resto de hoje: a maior chance de chuva das horas que faltam
  const restoDeHoje = (h.time || []).map((t, i) => [t, h.precipitation_probability?.[i]]).filter(([t]) => t.startsWith(hoje.d) && t >= agoraLocal.slice(0, 13)).map(([, v]) => v ?? 0);
  const chuvaHoje = restoDeHoje.length ? Math.max(...restoDeHoje) : hoje.prob ?? 0;
  const vaiChover = (prob) => (prob >= 60 ? (en ? 'Yes, rain is likely' : 'Sim, deve chover') : prob >= 30 ? (en ? 'It might rain' : 'Pode chover') : (en ? 'Probably not' : 'Provavelmente não'));
  const local = `**${lugar.rotulo}**`;

  let texto;
  if (p.quando === 'amanha' && amanha) {
    const mm = amanha.mm ? ` (${amanha.mm.toLocaleString(en ? 'en-US' : 'pt-BR')} mm)` : '';
    texto = p.chuva
      ? `${vaiChover(amanha.prob ?? 0)} ${en ? 'tomorrow in' : 'amanhã em'} ${local}: ${amanha.desc}${chanceDe(amanha)}${mm}. ${en ? `Low ${graus(amanha.min)}, high ${graus(amanha.max)}.` : `Mínima de ${graus(amanha.min)} e máxima de ${graus(amanha.max)}.`}`
      : en ? `Tomorrow in ${local}: ${resumoDoDia(amanha)}.` : `Amanhã em ${local}: ${resumoDoDia(amanha)}.`;
  } else if (p.quando === 'fim_de_semana' || p.quando === 'semana') {
    const escolhidos = p.quando === 'semana' ? dias : dias.filter((x) => [0, 6].includes(new Date(`${x.d}T12:00:00`).getDay()));
    const titulo = p.quando === 'semana' ? (en ? `Next days in ${local}:` : `Próximos dias em ${local}:`) : (en ? `Weekend in ${local}:` : `Fim de semana em ${local}:`);
    texto = `${titulo}\n\n${escolhidos.map((x) => `- **${nomeDoDia(x)}**: ${x.ico} ${resumoDoDia(x)}`).join('\n')}`;
  } else {
    texto = p.chuva ? `${vaiChover(chuvaHoje)} ${en ? 'today in' : 'hoje em'} ${local} (${en ? 'up to' : 'até'} ${chuvaHoje}% ${en ? 'in the coming hours' : 'nas próximas horas'}). ` : '';
    texto += en
      ? `Right now in ${local}: **${graus(c.temperature_2m)}**, ${descricao(c.weather_code, true)} (feels like ${graus(c.apparent_temperature)}). Today: low ${graus(hoje.min)}, high ${graus(hoje.max)}${chanceDe(hoje)}.`
      : `Agora em ${local}: **${graus(c.temperature_2m)}**, ${descricao(c.weather_code, false)} (sensação de ${graus(c.apparent_temperature)}). Hoje: mínima de ${graus(hoje.min)} e máxima de ${graus(hoje.max)}${chanceDe(hoje)}.`;
  }

  const bloco = {
    idioma: en ? 'en' : 'pt',
    local: lugar.rotulo,
    hora: agoraLocal,
    foco: p.quando === 'amanha' ? 1 : p.quando === 'fim_de_semana' ? Math.max(0, dias.findIndex((x) => [0, 6].includes(new Date(`${x.d}T12:00:00`).getDay()))) : 0,
    agora: { t: Math.round(c.temperature_2m), sens: Math.round(c.apparent_temperature), umid: c.relative_humidity_2m, vento: Math.round(c.wind_speed_10m), ico: icone(c.weather_code, c.is_day), desc: descricao(c.weather_code, en) },
    dias,
    horas: { t: h.time || [], temp: (h.temperature_2m || []).map(Math.round), prob: h.precipitation_probability || [], ico: (h.weather_code || []).map((cod, i) => icone(cod, h.is_day?.[i] ?? 1)) },
  };
  if (lugar.pistaQueNaoBateu) texto = `${en ? `I didn't find **${lugar.nome}** in ${lugar.pistaQueNaoBateu} — showing ${local}.` : `Não achei **${lugar.nome}** em ${lugar.pistaQueNaoBateu} — mostrando ${local}.`}\n\n${texto}`;
  return fim(`${texto}\n\n\`\`\`clima\n${JSON.stringify(bloco)}\n\`\`\``);
}

module.exports = { pedidoDeClima, intencaoDeClima: (p) => Boolean(pedidoDeClima(p)), cidadeNaPergunta, cidadeDaMemoria, acharCidade, responderClima, descricao, ALIASES };
