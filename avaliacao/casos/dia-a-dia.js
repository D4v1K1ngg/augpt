'use strict';

/**
 * Recursos do dia a dia (31/10, pedido do Davi): o resumo da manhã, a transcrição de áudio, os timers, as contas e
 * o controle do PC pela voz.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const resumo = require('../../src/agent/resumo-do-dia');

const RSS = `<?xml version="1.0"?><rss><channel><title>Agência Brasil</title>
<item><title><![CDATA[Inmet alerta para chuvas no Sudeste]]></title><link>https://agenciabrasil.ebc.com.br/geral/noticia/a</link></item>
<item><title>Acordo Mercosul-UE eleva exportações &amp; empregos</title><link>https://agenciabrasil.ebc.com.br/economia/noticia/b</link></item>
<item><title>Sem link seguro</title><link>http://exemplo.com/c</link></item>
</channel></rss>`;

module.exports = [
  {
    nome: 'resumo do dia: "bom dia, Jarvis" no começo da conversa e "resumo do dia" sempre; "bom dia" no meio da conversa, "bom dia, me ajuda com…" e "o que eu tenho pra hoje?" (agenda) não',
    tipo: 'unidade',
    executar() {
      const p = (t, c = []) => resumo.pedidoDeResumo(t, c);
      const rotas = require('../../src/agent/rotas-do-codigo');
      return [
        p('Bom dia, Jarvis!')?.saudacao === true || 'bom dia',
        p('bom dia, tudo bem?')?.acao === 'resumo' || 'bom dia, tudo bem',
        p('bom dia', [{ role: 'user', content: 'oi' }]) === null || 'no meio da conversa',
        p('Jarvis, resumo do dia', [{ role: 'user', content: 'oi' }])?.acao === 'resumo' && p('como está meu dia?')?.acao === 'resumo' || 'pedido direto',
        p('bom dia, me ajuda com uma planilha') === null || 'bom dia com pedido',
        rotas.escolherRota({ objetivo: 'o que eu tenho pra hoje?', conversa: [] })?.rota?.id === 'agenda' || 'agenda',
        rotas.escolherRota({ objetivo: 'Bom dia, Jarvis', conversa: [] })?.rota?.id === 'resumo_do_dia' || 'rota',
      ];
    },
  },
  {
    nome: 'resumo do dia: manchetes do RSS (só https, sem repetir), o feriado perto, o tempo da cidade da memória e a agenda de hoje numa resposta só; sem cidade, pede a cidade',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-resumo-'));
      try {
        const m = resumo.manchetesDoRss(RSS);
        const feriado = resumo.feriadoPerto(new Date(2026, 9, 31, 8), false);
        const noDia = resumo.feriadoPerto(new Date(2026, 10, 2, 8), false);
        const urls = [];
        const baixar = async (url) => {
          urls.push(url);
          if (url.includes('agenciabrasil')) return { ok: true, texto: RSS };
          if (url.includes('geocoding')) return { ok: true, texto: JSON.stringify({ results: [{ name: 'Campinas', latitude: -22.9, longitude: -47.06, country_code: 'BR', admin1: 'São Paulo', population: 1 }] }) };
          const dias = ['2026-10-31', '2026-11-01'];
          return { ok: true, texto: JSON.stringify({ current: { time: '2026-10-31T08:00', temperature_2m: 22, apparent_temperature: 23, weather_code: 1, relative_humidity_2m: 70, wind_speed_10m: 5, is_day: 1 }, daily: { time: dias, weather_code: [1, 3], temperature_2m_max: [28, 26], temperature_2m_min: [17, 18], precipitation_probability_max: [10, 40] }, hourly: { time: [], temperature_2m: [] } }) };
        };
        const semCidade = await resumo.responderResumo({ pedido: { saudacao: true }, deps: { baixar }, pasta: dir, agora: new Date(2026, 9, 31, 8) });
        const { MemoriaCentral } = require('../../src/agent/memoria-central');
        new MemoriaCentral(dir).definir({ chave: 'cidade', valor: 'Moro em Campinas' });
        const { Agenda } = require('../../src/agenda');
        new Agenda(dir).adicionar({ tipo: 'lembrete', titulo: 'ligar pro banco', quando: '2026-10-31T15:00', temDia: true });
        const pedacos = [];
        const comCidade = await resumo.responderResumo({ pedido: { saudacao: true }, deps: { baixar, emit: (e, d) => e === 'resposta-token' && pedacos.push(d.pedaco) }, pasta: dir, agora: new Date(2026, 9, 31, 8) });
        return [
          m.length === 2 && m[1].titulo === 'Acordo Mercosul-UE eleva exportações & empregos' || JSON.stringify(m),
          /Próximo feriado: \*\*Finados\*\*.*daqui a 2 dias/.test(feriado) && /Hoje é feriado: \*\*Finados\*\*/.test(noDia) || `${feriado} / ${noDia}`,
          /^Bom dia! Hoje é sábado, 31 de outubro/.test(semCidade.texto) && /lembre que moro em Campinas/.test(semCidade.texto) || semCidade.texto,
          /Agora em \*\*Campinas, SP\*\*: \*\*22 °C\*\*/.test(comCidade.texto) && /ligar pro banco/.test(comCidade.texto) && /\[Inmet alerta para chuvas no Sudeste\]\(https:/.test(comCidade.texto) || comCidade.texto,
          /```clima\n/.test(comCidade.texto) && comCidade.texto.trim().endsWith('```') || 'o cartão do clima no fim',
          pedacos.length === 1 && pedacos[0] === comCidade.texto || `a tela recebeu ${pedacos.length} pedaços`,
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];
