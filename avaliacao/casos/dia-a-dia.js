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

const audio = require('../../src/agent/audio-no-chat');
const transcrito = (nome, duracao, texto, pergunta = 'O que diz este áudio?') => `${pergunta}\n\nTranscrição do áudio "${nome}" (${duracao}):\n"""\n${texto}\n"""`;
const LONGO = 'Oi, tudo bem? Passa no mercado na volta do trabalho, por favor. Compra leite, pão e uma dúzia de ovos. E não esquece de pegar o remédio da sua mãe na farmácia até as seis da tarde, que depois fecha. A conta deu uns quarenta reais da última vez. Beijo, até mais tarde.';

const timer = require('../../src/agent/timer-no-chat');

const boleto = require('../../src/agent/boleto-no-chat');
const { gerarPdf } = require('../../src/formatos/pdf-escrita');

/** Uma linha digitável válida (os DVs calculados), para o boleto de teste. */
function montarLinha({ banco = '341', vencimento, valor, livre = '1790010104351004791020150' }) {
  const fator = String(1000 + Math.round((Date.UTC(...vencimento) - Date.UTC(2025, 1, 22)) / 86400000)).padStart(4, '0');
  const v = String(Math.round(valor * 100)).padStart(10, '0');
  const dv = boleto.modulo11Banco(`${banco}9${fator}${v}${livre}`);
  const barras = `${banco}9${dv}${fator}${v}${livre}`;
  const c = [barras.slice(0, 4) + barras.slice(19, 24), barras.slice(24, 34), barras.slice(34, 44)];
  return `${c[0]}${boleto.modulo10(c[0])}${c[1]}${boleto.modulo10(c[1])}${c[2]}${boleto.modulo10(c[2])}${dv}${fator}${v}`;
}
const anexado = (nome, pergunta = 'o que é isso?') => `${pergunta}\n\nArquivos anexados, já copiados para a pasta de trabalho:\n- ${nome} (2 KB)\nUse ler_arquivo para abri-los.`;

module.exports = [
  {
    nome: 'boleto: os dígitos de verificação batem com exemplos públicos (Itaú e contas de consumo); um número errado não vira boleto; o fator de vencimento usa a base nova (22/02/2025) ou a antiga, a que fica mais perto de hoje',
    tipo: 'unidade',
    executar() {
      const itau = boleto.lerLinhaBancaria('34191.09008 63571.277308 71444.640008 5 81310000020000', new Date(2026, 9, 31));
      const luz = boleto.lerLinhaArrecadacao('836200000005 667800481000 180975657313 001589636081');
      const errado = boleto.lerLinhaBancaria('34191.09008 63571.277308 71444.640008 5 81310000020001');
      return [
        itau?.valor === 200 && itau.vencimentoDoFator === '2020-01-11' || JSON.stringify(itau),
        luz?.valor === 66.78 && luz.tipo === 'arrecadacao' || JSON.stringify(luz),
        boleto.lerLinhaArrecadacao('846700000017 435900240209 024050002435 842210108119')?.valor === 143.59 || 'segunda conta',
        errado === null && boleto.lerLinhaArrecadacao('836200000005 667800481000 180975657313 001589636082') === null || 'DV errado passou',
        boleto.dataDoFator(1623, new Date(2026, 9, 31)) === '2026-11-07' && boleto.dataDoFator(9999, new Date(2024, 0, 1)) === '2025-02-21' || 'fator',
        boleto.lerLinhaBancaria(montarLinha({ vencimento: [2026, 10, 7], valor: 187.45 }))?.valor === 187.45 || 'a linha montada no teste',
      ];
    },
  },
  {
    nome: 'boleto: o PDF anexado vira valor, vencimento, quem cobra e a linha conferida, com o lembrete às 9h da véspera (sem repetir); vencido avisa de juros e não lembra; "resuma este contrato" e PDF que não é boleto ficam com o agente; "quais contas eu tenho?" soma',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-boleto-'));
      try {
        const linha = montarLinha({ vencimento: [2026, 10, 7], valor: 187.45 });
        fs.writeFileSync(path.join(dir, 'boleto.pdf'), gerarPdf({ conteudo: `Banco Itaú | 341-7 | ${linha.slice(0, 5)}.${linha.slice(5, 10)} ${linha.slice(10, 15)}.${linha.slice(15, 21)} ${linha.slice(21, 26)}.${linha.slice(26, 32)} ${linha[32]} ${linha.slice(33)}\n\nBeneficiário: ENEL DISTRIBUIÇÃO SÃO PAULO CNPJ 61.695.227/0001-93\n\nVencimento\n07/11/2026\n\nValor do Documento\nR$ 187,45` }));
        fs.writeFileSync(path.join(dir, 'contrato.pdf'), gerarPdf({ conteudo: 'Contrato de locação. Valor do aluguel R$ 1.200,00, vencimento todo dia 10.' }));
        const agora = new Date(2026, 9, 31, 10);
        const p = boleto.pedidoDeBoleto(anexado('boleto.pdf'), { workspace: dir, agora });
        const deps = { emit: () => {} };
        const r1 = boleto.responderBoleto({ pedido: p, deps, pasta: dir, agora });
        const r2 = boleto.responderBoleto({ pedido: p, deps, pasta: dir, agora });
        const { Agenda } = require('../../src/agenda');
        const itens = new Agenda(dir).listar();
        const vencido = boleto.responderBoleto({ pedido: { acao: 'ler', boletos: [{ ...p.boletos[0], linha: 'outra', vencimento: '2026-10-20' }] }, deps, pasta: dir, agora });
        const lista = boleto.responderBoleto({ pedido: boleto.pedidoDeContas('quais contas eu tenho este mês?'), deps, pasta: dir, agora });
        const rotas = require('../../src/agent/rotas-do-codigo');
        const loop = fs.readFileSync(path.join(__dirname, '../../src/agent/loop.js'), 'utf8');
        return [
          p?.boletos?.[0]?.valor === 187.45 && p.boletos[0].vencimento === '2026-11-07' && p.boletos[0].beneficiario === 'ENEL DISTRIBUIÇÃO SÃO PAULO' || JSON.stringify(p),
          /R\$ 187,45\*\*, vence \*\*sábado, 07\/11\/2026\*\* \(daqui a 7 dias\)\. Te lembro sexta-feira às 09:00/.test(r1.texto) && /```\n34191\./.test(r1.texto) && /golpe do boleto/.test(r1.texto) || r1.texto,
          itens.length === 1 && itens[0].quando === '2026-11-06T09:00' && itens[0].conta?.valor === 187.45 && /já estava na sua agenda/.test(r2.texto) || JSON.stringify(itens),
          /\*\*venceu\*\* em .*há 11 dias.*juros e multa/.test(vencido.texto) && new Agenda(dir).listar().length === 1 || vencido.texto,
          /Contas a pagar[\s\S]*ENEL DISTRIBUIÇÃO SÃO PAULO: R\$ 187,45[\s\S]*Total: R\$ 187,45/.test(lista.texto) || lista.texto,
          boleto.pedidoDeBoleto(anexado('boleto.pdf', 'resuma este contrato'), { workspace: dir }) === null && boleto.pedidoDeBoleto(anexado('contrato.pdf'), { workspace: dir }) === null || 'o que não é boleto',
          boleto.pedidoDeBoleto(anexado('../fora.pdf'), { workspace: dir }) === null || 'fora da pasta de trabalho',
          rotas.escolherRota({ objetivo: anexado('boleto.pdf'), conversa: [], config: { workspace: dir } })?.rota?.id === 'boleto' && /ehBoleto \|\| \(!\['local', 'site'\]/.test(loop) || 'a rota e a porta do núcleo',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'timer: duração em número ou por extenso ("meia hora", "1h30", "vinte e cinco minutos", "um minuto e meio"), alarme no horário ("às 7 da noite", "às 5 e meia"), o nome ("pro miojo") e cancelar; "me lembra daqui a 20 min de…" fica com a agenda',
    tipo: 'unidade',
    executar() {
      const p = (t) => JSON.stringify(timer.pedidoDeTimer(t));
      const rotas = require('../../src/agent/rotas-do-codigo');
      const casos = {
        'timer de 10 minutos pro miojo': '{"acao":"criar","segundos":600,"rotulo":"miojo"}',
        'Jarvis, coloca um timer de meia hora': '{"acao":"criar","segundos":1800,"rotulo":null}',
        'timer de 1h30 para o bolo': '{"acao":"criar","segundos":5400,"rotulo":"bolo"}',
        'temporizador de vinte e cinco minutos': '{"acao":"criar","segundos":1500,"rotulo":null}',
        'timer de um minuto e meio': '{"acao":"criar","segundos":90,"rotulo":null}',
        'cronômetro de 2 horas e 15 minutos': '{"acao":"criar","segundos":8100,"rotulo":null}',
        'me acorda em 20 minutos': '{"acao":"criar","segundos":1200,"rotulo":null}',
        'alarme às 7h': '{"acao":"criar","hora":7,"minuto":0,"rotulo":null}',
        'alarme pras 7 da noite pra ir na academia': '{"acao":"criar","hora":19,"minuto":0,"rotulo":"ir na academia"}',
        'despertador às 5 e meia': '{"acao":"criar","hora":5,"minuto":30,"rotulo":null}',
        'cancela o timer': '{"acao":"cancelar"}',
        'para o alarme': '{"acao":"cancelar"}',
      };
      const errados = Object.entries(casos).filter(([t, j]) => p(t) !== j).map(([t]) => `${t} → ${p(t)}`);
      return [
        !errados.length || errados.join(' | '),
        ['me lembra daqui a 20 minutos de tirar o bolo', 'quanto tempo dura um timer?', 'o jogo começa às 7h', 'esse alarme do carro é chato', 'o PC demorou 10 minutos pra ligar'].every((t) => timer.pedidoDeTimer(t) === null) || 'o que não é timer',
        rotas.escolherRota({ objetivo: 'me lembra daqui a 20 minutos de tirar o bolo', conversa: [] })?.rota?.id === 'agenda' && rotas.escolherRota({ objetivo: 'timer de 10 minutos pro miojo', conversa: [] })?.rota?.id === 'timer' || 'rotas',
      ];
    },
  },
  {
    nome: 'timer: a resposta traz o cartão com o fim certo (alarme já passado vai para amanhã); cancelar avisa a tela pelo evento "timer", que o processo principal deixa passar',
    tipo: 'unidade',
    executar() {
      const agora = new Date(2026, 9, 31, 13, 0, 0);
      const eventos = [];
      const deps = { emit: (e, d) => eventos.push([e, d]) };
      const bloco = (r) => JSON.parse(/```timer\n([\s\S]*?)\n```/.exec(r.texto)[1]);
      const t1 = timer.responderTimer({ pedido: { acao: 'criar', segundos: 600, rotulo: 'miojo' }, deps, agora });
      const t2 = timer.responderTimer({ pedido: { acao: 'criar', hora: 7, minuto: 0, rotulo: null }, deps, agora });
      timer.responderTimer({ pedido: { acao: 'cancelar' }, deps, agora });
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const md = fs.readFileSync(path.join(__dirname, '../../renderer/md.js'), 'utf8');
      return [
        /Timer de \*\*10 minutos\*\* para \*\*miojo\*\* — toca às 13:10/.test(t1.texto) && bloco(t1).fim === agora.getTime() + 600000 && bloco(t1).rotulo === 'miojo' || t1.texto,
        /Alarme para as \*\*07:00\*\* de amanhã/.test(t2.texto) && bloco(t2).fim === new Date(2026, 10, 1, 7, 0, 0).getTime() && bloco(t2).alarme === true || t2.texto,
        eventos.some(([e, d]) => e === 'timer' && d.acao === 'cancelar') || 'evento',
        /'agenda-mudou',\n\s*\/\/[^\n]*\n\s*'timer',/.test(main.replace(/\r/g, '')) && /'midia', 'timer'\]/.test(md) || 'evento liberado e cartão registrado',
      ];
    },
  },
  {
    nome: 'áudio anexado: a transcrição vira pedido da rota de áudio (a primeira: "vai chover" e "bom dia" no áudio não caem em outra rota); com outro anexo junto, fica com o agente',
    tipo: 'unidade',
    executar() {
      const rotas = require('../../src/agent/rotas-do-codigo');
      const p = audio.pedidoDeAudio(transcrito('PTT-WA0003.opus', '0:42', 'Bom dia! Vai chover amanhã em Campinas, leva guarda-chuva.'));
      const comPergunta = audio.pedidoDeAudio(transcrito('a.opus', '0:10', 'x', 'até que horas?') + transcrito('b.ogg', '1:05', 'y', ''));
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      return [
        p?.audios?.[0]?.nome === 'PTT-WA0003.opus' && p.audios[0].duracao === '0:42' && p.pergunta === '' || JSON.stringify(p),
        comPergunta?.audios?.length === 2 && comPergunta.pergunta === 'até que horas?' || JSON.stringify(comPergunta),
        rotas.escolherRota({ objetivo: transcrito('a.opus', '0:42', 'Bom dia! Vai chover amanhã em Campinas?'), conversa: [] })?.rota?.id === 'audio_transcrito' || 'rota',
        audio.pedidoDeAudio(`${transcrito('a.opus', '0:10', 'x')}\n\nArquivos anexados, já copiados para a pasta de trabalho:\n- planilha.xlsx\nUse ler_arquivo para abri-los.`) === null || 'com outro anexo',
        audio.pedidoDeAudio('O que diz este áudio?') === null || 'sem transcrição',
        /EXTENSOES_AUDIO = new Set\(\['\.opus', '\.ogg'/.test(main) && /audio: true, bytes: fs\.readFileSync\(origem\)/.test(main) || 'o anexo leva os bytes do áudio',
      ];
    },
  },
  {
    nome: 'áudio anexado: curto sai só a transcrição (sem chamar o modelo); longo leva um resumo; com pergunta, a resposta vem pelo que foi dito; sem fala, avisa',
    tipo: 'unidade',
    async executar() {
      const pedidos = [];
      const chamar = async (msgs) => {
        pedidos.push(msgs);
        return { content: /Pergunta:/.test(msgs[1].content) ? 'Leite, pão e ovos, e o remédio até as 18h.' : '<think>x</think>Pedem para passar no mercado e pegar o remédio até as 18h.' };
      };
      const pedacos = [];
      const deps = { chamar, emit: (e, d) => e === 'resposta-token' && pedacos.push(d.pedaco) };
      const curto = await audio.responderAudio({ pedido: audio.pedidoDeAudio(transcrito('a.opus', '0:04', 'Tô chegando, abre o portão.')), deps });
      const chamadasDoCurto = pedidos.length;
      const longo = await audio.responderAudio({ pedido: audio.pedidoDeAudio(transcrito('PTT.opus', '0:18', LONGO)), deps });
      const pergunta = await audio.responderAudio({ pedido: audio.pedidoDeAudio(transcrito('PTT.opus', '0:18', LONGO, 'o que eu preciso comprar?')), deps });
      const mudo = await audio.responderAudio({ pedido: audio.pedidoDeAudio(transcrito('z.opus', '0:03', '(sem fala no áudio)')), deps });
      return [
        chamadasDoCurto === 0 && /🎙️ \*\*a\.opus\*\* \(0:04\)\n\n> Tô chegando, abre o portão\./.test(curto.texto) || curto.texto,
        /^\*\*Resumo:\*\* Pedem para passar no mercado/.test(longo.texto) && !/think/.test(longo.texto) && /> Oi, tudo bem\?/.test(longo.texto) || longo.texto,
        /^Leite, pão e ovos/.test(pergunta.texto) && /Pergunta: o que eu preciso comprar\?/.test(pedidos.at(-1)[1].content) && /Use SÓ o que foi dito/.test(pedidos.at(-1)[0].content) || pergunta.texto,
        /^Não ouvi fala neste áudio/.test(mudo.texto) && pedidos.length === 2 || mudo.texto,
        pedacos.length === 4 && pedacos[1] === longo.texto || `pedaços: ${pedacos.length}`,
      ];
    },
  },
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
