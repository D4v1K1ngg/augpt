'use strict';

/**
 * Clima no chat (23/10): o que é pergunta de clima, a cidade (da pergunta ou da memória), a
 * resposta e o bloco ```clima. O Open-Meteo é trocado por um dublê — a bancada não sai para a rede.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const c = require('../../src/agent/clima-no-chat');
const rotas = require('../../src/agent/rotas-do-codigo');
const { MemoriaCentral } = require('../../src/agent/memoria-central');

const DIAS = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];
const HORAS = DIAS.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));

/** Open-Meteo falso: Campinas (e uma Campinas do Piauí, menor), Curitiba e Londres; a previsão é fixa. */
function openMeteo(pedidos = []) {
  const cidades = {
    campinas: [{ name: 'Campinas', latitude: -7.6, longitude: -41.8, country_code: 'BR', country: 'Brasil', admin1: 'Piauí', population: 1000 }, { name: 'Campinas', latitude: -22.9, longitude: -47.06, country_code: 'BR', country: 'Brasil', admin1: 'São Paulo', population: 1200000 }],
    curitiba: [{ name: 'Curitiba', latitude: -25.4, longitude: -49.3, country_code: 'BR', country: 'Brasil', admin1: 'Paraná', population: 1900000 }],
    london: [{ name: 'London', latitude: 51.5, longitude: -0.12, country_code: 'GB', country: 'United Kingdom', admin1: 'England', population: 9000000 }],
  };
  return async (url) => {
    pedidos.push(url);
    if (url.includes('geocoding-api')) {
      const nome = decodeURIComponent(/name=([^&]+)/.exec(url)[1]).toLowerCase();
      return { ok: true, status: 200, texto: JSON.stringify({ results: cidades[nome] }) };
    }
    return {
      ok: true,
      status: 200,
      texto: JSON.stringify({
        current: { time: '2026-10-23T14:00', temperature_2m: 24.4, apparent_temperature: 25.1, relative_humidity_2m: 60, precipitation: 0, weather_code: 2, wind_speed_10m: 11.6, is_day: 1 },
        hourly: { time: HORAS, temperature_2m: HORAS.map((_, i) => 18 + (i % 24) / 3), precipitation_probability: HORAS.map((t) => (t.startsWith('2026-10-24') ? 90 : t >= '2026-10-23T14' && t < '2026-10-23T20' ? 20 : 5)), weather_code: HORAS.map(() => 2), is_day: HORAS.map((t) => (t.slice(11, 13) >= '06' && t.slice(11, 13) < '18' ? 1 : 0)) },
        daily: { time: DIAS, weather_code: [2, 95, 61, 0, 1, 3, 80], temperature_2m_max: [29, 22, 25, 30, 31, 27, 26], temperature_2m_min: [17, 16, 15, 18, 19, 17, 16], precipitation_probability_max: [20, 91, 60, 0, 5, 30, 70], precipitation_sum: [0, 25.6, 4, 0, 0, 1.2, 8], sunrise: DIAS.map((d) => `${d}T05:45`), sunset: DIAS.map((d) => `${d}T18:20`), uv_index_max: [9, 4, 6, 11, 10, 7, 6] },
      }),
    };
  };
}

module.exports = [
  {
    nome: 'clima: reconhece tempo, chuva, temperatura e previsão (pt e en) e acha a cidade; temperatura da CPU, "quanto tempo", clima organizacional e mudança climática ficam fora',
    tipo: 'unidade',
    executar() {
      const cidade = (p) => c.pedidoDeClima(p)?.cidade;
      const fora = ['qual a temperatura da minha cpu?', 'quanto tempo leva pra ir a Campinas?', 'clima organizacional da empresa', 'mudança climática no Brasil', 'previsão de lançamento da rtx 60', 'tempo de resposta do servidor', 'como está o clima entre EUA e China?', 'por que está tão quente hoje?'];
      return [
        cidade('como está o clima em São Paulo hoje?') === 'São Paulo' || cidade('como está o clima em São Paulo hoje?'),
        cidade('vai chover amanhã em Curitiba, PR?') === 'Curitiba, PR' || 'curitiba',
        cidade('como vai estar o tempo de amanhã em BH') === 'Belo Horizonte' || cidade('como vai estar o tempo de amanhã em BH'),
        cidade('clima no Rio de Janeiro') === 'Rio de Janeiro' || 'rio',
        cidade('previsão do tempo para o fim de semana em Campinas') === 'Campinas' || 'campinas',
        cidade('weather in London') === 'London' || 'london',
        c.pedidoDeClima('como está o tempo hoje?')?.cidade === null || 'sem cidade',
        c.pedidoDeClima('vai chover amanhã?')?.quando === 'amanha' && c.pedidoDeClima('vai chover amanhã?').chuva === true || 'amanhã com chuva',
        c.pedidoDeClima('previsão para o fim de semana')?.quando === 'fim_de_semana' || 'fim de semana',
        ...fora.map((p) => c.pedidoDeClima(p) === null || `fora: ${p}`),
        rotas.escolherRota({ objetivo: 'como está o tempo em Campinas?', conversa: [] })?.rota.id === 'clima' || 'a rota do clima',
      ];
    },
  },
  {
    nome: 'clima: a resposta (agora, amanhã com chuva, fim de semana, inglês), a Campinas certa (a maior do Brasil; "Curitiba, PR" usa o estado), a cidade da memória e o bloco para o cartão',
    tipo: 'unidade',
    async executar() {
      const pedidos = [];
      const deps = { baixar: openMeteo(pedidos) };
      const r = (pergunta, extra = {}) => c.responderClima({ pergunta, deps, config: {}, ...extra });
      const agora = await r('como está o clima em Campinas?');
      const amanha = await r('vai chover amanhã em Curitiba, PR?');
      const fds = await r('previsão do tempo para o fim de semana em Campinas');
      const ingles = await c.responderClima({ pergunta: 'weather in London', deps, config: { idiomaEfetivo: 'en' } });
      const semCidade = await r('previsão do tempo');
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-clima-'));
      new MemoriaCentral(pasta).definir({ chave: 'cidade', valor: 'Moro em Campinas' });
      const daMemoria = await r('vai chover hoje?', { pasta });
      fs.rmSync(pasta, { recursive: true, force: true });
      const bloco = JSON.parse(/```clima\n([\s\S]*?)```/.exec(agora.texto)[1]);
      const sem = await c.responderClima({ pergunta: 'clima em Campinas', deps: { baixar: async () => ({ ok: false, status: 503 }) }, config: {} });
      return [
        agora.texto.startsWith('Agora em **Campinas, SP**: **24 °C**, parcialmente nublado (sensação de 25 °C). Hoje: mínima de 17 °C e máxima de 29 °C, 20% de chance de chuva.') || agora.texto.slice(0, 200),
        /^Sim, deve chover amanhã em \*\*Curitiba, PR\*\*: trovoadas, 91% de chance de chuva \(25,6 mm\)\. Mínima de 16 °C e máxima de 22 °C\./.test(amanha.texto) || amanha.texto.slice(0, 200),
        /Fim de semana em \*\*Campinas, SP\*\*:\n\n- \*\*sábado\*\*: ⛈️ trovoadas.*\n- \*\*domingo\*\*: 🌦️ chuva fraca/.test(fds.texto) || fds.texto.slice(0, 250),
        /^Right now in \*\*London, England, United Kingdom\*\*: \*\*24 °C\*\*, partly cloudy/.test(ingles.texto) && ingles.noIdioma === true || ingles.texto.slice(0, 120),
        /^De qual cidade\?/.test(semCidade.texto) && !semCidade.texto.includes('```') || semCidade.texto,
        /^Provavelmente não hoje em \*\*Campinas, SP\*\* \(até 20% nas próximas horas\)/.test(daMemoria?.texto || '') || daMemoria?.texto?.slice(0, 160),
        bloco.local === 'Campinas, SP' && bloco.dias.length === 7 && bloco.horas.t.length === 168 && bloco.agora.t === 24 && bloco.dias[1].ico === '⛈️' || JSON.stringify(bloco).slice(0, 200),
        pedidos.some((u) => u.includes('api.open-meteo.com/v1/forecast') && u.includes('latitude=-22.9')) || 'a previsão é da Campinas de SP',
        sem === null || 'Open-Meteo fora: a rota devolve para a pesquisa',
      ];
    },
  },
  {
    nome: 'clima: a tela troca o bloco pelo cartão (md.js) e o JSON não vira HTML',
    tipo: 'unidade',
    executar() {
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.md.render('Texto.\n\n```clima\n{"local":"<img src=x onerror=alert(1)>","dias":[]}\n```');
      global.window = antes;
      return [/<div class="cartao-lugar" data-tipo="clima" data-cal="\{&quot;local&quot;/.test(html) && !/<img/.test(html) || html];
    },
  },
];
