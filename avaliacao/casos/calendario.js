'use strict';

/**
 * Calendário no chat (23/10): datas e feriados respondidos pelo código, com o bloco ```calendario
 * que a tela desenha (src/agent/calendario-no-chat.js, renderer/calendario.js).
 */

const c = require('../../src/agent/calendario-no-chat');
const rotas = require('../../src/agent/rotas-do-codigo');

const AGORA = new Date(2026, 9, 23, 10); // sexta-feira, 23/10/2026
const resp = (pergunta, idioma = 'pt') => c.responderCalendario({ pergunta, agora: AGORA, config: { idiomaEfetivo: idioma } });
const texto = (pergunta, idioma) => resp(pergunta, idioma)?.texto.split('\n```')[0].trim() || null;
const bloco = (pergunta) => JSON.parse(/```calendario\n([\s\S]*?)```/.exec(resp(pergunta).texto)[1]);
const dataDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

module.exports = [
  {
    nome: 'calendário: Páscoa e feriados móveis certos (2024–2030) e os fixos, com a Consciência Negra nacional desde 2024',
    tipo: 'unidade',
    executar() {
      const pascoas = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21' };
      const de = (ano, nome) => c.datasDoAno(ano).filter((d) => d.nome === nome).map((d) => d.iso);
      return [
        ...Object.entries(pascoas).map(([a, d]) => dataDe(c.pascoa(Number(a))) === d || `Páscoa ${a}: ${dataDe(c.pascoa(Number(a)))}`),
        de(2026, 'Carnaval').join() === '2026-02-16,2026-02-17' || `carnaval 2026: ${de(2026, 'Carnaval')}`,
        de(2026, 'Corpus Christi')[0] === '2026-06-04' || 'corpus christi 2026',
        de(2026, 'Sexta-feira Santa')[0] === '2026-04-03' || 'sexta santa 2026',
        de(2026, 'Dia das Mães')[0] === '2026-05-10' && de(2026, 'Dia dos Pais')[0] === '2026-08-09' || 'mães e pais 2026',
        de(2026, 'Dia da Consciência Negra')[0] === '2026-11-20' && de(2023, 'Dia da Consciência Negra').length === 0 || 'consciência negra',
      ];
    },
  },
  {
    nome: 'calendário: reconhece "que dia é hoje", feriados do mês/ano, próximo feriado, contagem, dia da semana e "mostre o calendário"; o resto vai para a pesquisa',
    tipo: 'unidade',
    executar() {
      const tipo = (p) => c.pedidoDeCalendario(p, AGORA)?.tipo || null;
      const casos = {
        'Que dia é hoje?': 'hoje', 'qual a data de hoje': 'hoje', 'what day is today?': 'hoje',
        'quais feriados temos nesse mês ?': 'feriados', 'quais os feriados de novembro?': 'feriados', 'dezembro tem feriado?': 'feriados', 'any holidays this month?': 'feriados',
        'feriados de 2027': 'feriados_do_ano', 'quais os feriados deste ano?': 'feriados_do_ano',
        'qual o próximo feriado?': 'proximo', 'when is the next holiday?': 'proximo',
        'quantos dias faltam pro natal?': 'contagem', 'quando é o carnaval de 2027?': 'contagem', 'quantos dias faltam para 01/01/2027?': 'contagem', 'how many days until christmas?': 'contagem',
        'que dia da semana cai 25/12/2027?': 'semana', 'qual dia da semana foi 1 de janeiro de 2026': 'semana',
        'mostre o calendário de março': 'calendario', 'calendário': 'calendario', 'show me the calendar': 'calendario',
      };
      const fora = ['por que 15 de novembro é feriado?', 'qual a história do feriado de tiradentes', 'quando sai a rtx 60?', 'calendário escolar da unip 2026', 'feriados municipais de campinas', 'quando é o lançamento do GTA 6?', 'me fale sobre o calendário maia'];
      return [
        ...Object.entries(casos).map(([p, t]) => tipo(p) === t || `"${p}" → ${tipo(p)} (esperado ${t})`),
        ...fora.map((p) => tipo(p) === null || `"${p}" deveria ir para a pesquisa (${tipo(p)})`),
        rotas.escolherRota({ objetivo: 'que dia é hoje?', conversa: [] })?.rota.id === 'calendario' || 'a rota do calendário',
        rotas.escolherRota({ objetivo: 'lembre que meu aniversário é 3 de março', conversa: [] })?.rota.id === 'memoria' || 'memória continua antes',
      ];
    },
  },
  {
    nome: 'calendário: as respostas (data por extenso, feriados com o dia da semana, ponto facultativo, contagem, "num sábado", "1º de janeiro") em português e inglês',
    tipo: 'unidade',
    executar() {
      return [
        texto('Que dia é hoje?') === 'Hoje é **sexta-feira, 23 de outubro de 2026**. Próximo feriado: **Finados**, segunda-feira, 2 de novembro (daqui a 10 dias).' || texto('Que dia é hoje?'),
        /2 de novembro\*\* — Finados\n.*15 de novembro\*\* — Proclamação da República\n.*20 de novembro\*\* — Dia da Consciência Negra/.test(texto('quais os feriados de novembro?')) || texto('quais os feriados de novembro?'),
        /Carnaval \(ponto facultativo\)/.test(texto('feriados de 2027')) && /1º de janeiro/.test(texto('feriados de 2027')) || 'ano',
        /^Faltam \*\*63 dias\*\* para o \*\*Natal\*\*/.test(texto('quantos dias faltam pro natal?')) || texto('quantos dias faltam pro natal?'),
        /para a \*\*Páscoa\*\*/.test(texto('quantos dias faltam para a páscoa?')) || texto('quantos dias faltam para a páscoa?'),
        /cai num \*\*sábado\*\*.*É Natal/.test(texto('que dia da semana cai 25/12/2027?')) || texto('que dia da semana cai 25/12/2027?'),
        /não tem feriado nacional/.test(texto('quais os feriados de julho de 2027?') || '') || texto('quais os feriados de julho de 2027?'),
        /^Today is \*\*Friday, October 23, 2026\*\*/.test(texto('what day is today?', 'en')) || texto('what day is today?', 'en'),
        /^\*\*63 days\*\* until \*\*Christmas\*\*/.test(texto('how many days until christmas?', 'en')) || texto('how many days until christmas?', 'en'),
        resp('what day is today?', 'en').noIdioma === true && resp('que dia é hoje?').noIdioma === false || 'noIdioma',
      ];
    },
  },
  {
    nome: 'calendário: o bloco leva o mês certo, hoje, o dia marcado e as datas de um ano antes e depois; a tela troca o bloco pelo calendário e o JSON não vira HTML',
    tipo: 'unidade',
    executar() {
      const natal = bloco('quantos dias faltam pro natal?');
      const hoje = bloco('que dia é hoje?');
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      const html = global.md.render(`Texto.\n\n\`\`\`calendario\n{"ano":2026,"mes":10,"hoje":"2026-10-23","datas":{"2026-10-12":[["<img src=x onerror=alert(1)>","feriado"]]}}\n\`\`\``);
      global.window = antes;
      return [
        natal.ano === 2026 && natal.mes === 12 && natal.marcar === '2026-12-25' && natal.hoje === '2026-10-23' || JSON.stringify({ ano: natal.ano, mes: natal.mes, marcar: natal.marcar }),
        hoje.mes === 10 && hoje.marcar === null || 'hoje sem marca',
        Object.keys(hoje.datas).some((k) => k.startsWith('2025-')) && Object.keys(hoje.datas).some((k) => k.startsWith('2027-')) || 'um ano antes e depois',
        /<div class="calendario-lugar" data-cal="\{&quot;ano&quot;/.test(html) && !/<img/.test(html) || html,
      ];
    },
  },
];
