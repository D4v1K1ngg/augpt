'use strict';

/**
 * Agenda (23/10, bloco 2): o que é pedido de agenda, datas e horas em português e inglês, o título,
 * o arquivo (adicionar, avisar na hora, conferir uma vez por dia), as respostas e a oferta no fim
 * da pesquisa sobre algo que ainda vai acontecer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const a = require('../../src/agent/agenda-no-chat');
const { Agenda, horaDoAviso, conferirAssunto } = require('../../src/agenda');
const rotas = require('../../src/agent/rotas-do-codigo');
const capacidades = require('../../src/agent/capacidades');

const AGORA = new Date(2026, 9, 23, 21, 0); // sexta-feira, 23/10/2026, 21h
const p = (q) => a.pedidoDeAgenda(q, AGORA);
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-agenda-'));

module.exports = [
  {
    nome: 'agenda: entende o pedido — lembrete com dia e hora (pt e en), ideia sem data, acompanhar, listar e cancelar; memória, "marque como lido" e pergunta comum ficam fora',
    tipo: 'unidade',
    executar() {
      const igual = (q, esperado) => JSON.stringify(p(q)) === JSON.stringify(esperado) || `${q} → ${JSON.stringify(p(q))}`;
      return [
        igual('me lembra sexta às 15h de ligar pro banco', { acao: 'criar', tipo: 'lembrete', titulo: 'Ligar pro banco', quando: '2026-10-30T15:00', diaInteiro: false, temDia: true }),
        igual('lembre-me amanhã de manhã de pagar a conta de luz', { acao: 'criar', tipo: 'lembrete', titulo: 'Pagar a conta de luz', quando: '2026-10-24T09:00', diaInteiro: false, temDia: true }),
        igual('marque reunião com o João dia 30 às 10h', { acao: 'criar', tipo: 'lembrete', titulo: 'Reunião com o João', quando: '2026-10-30T10:00', diaInteiro: false, temDia: true }),
        igual('me lembre de tomar remédio daqui a 2 horas', { acao: 'criar', tipo: 'lembrete', titulo: 'Tomar remédio', quando: '2026-10-23T23:00', diaInteiro: false, temDia: false }),
        igual('me lembra às 8h de levar o lixo', { acao: 'criar', tipo: 'lembrete', titulo: 'Levar o lixo', quando: '2026-10-24T08:00', diaInteiro: false, temDia: false }),
        igual('me lembra dia 25/12 do amigo secreto', { acao: 'criar', tipo: 'lembrete', titulo: 'Amigo secreto', quando: '2026-12-25', diaInteiro: true, temDia: true }),
        igual('remind me tomorrow at 3pm to call mom', { acao: 'criar', tipo: 'lembrete', titulo: 'Call mom', quando: '2026-10-24T15:00', diaInteiro: false, temDia: true }),
        igual('anote na agenda: comprar ração', { acao: 'criar', tipo: 'ideia', titulo: 'Comprar ração' }),
        igual('me avise quando a RTX 60 for lançada', { acao: 'acompanhar', assunto: 'RTX 60' }),
        igual('acompanhe o lançamento do GTA 6', { acao: 'acompanhar', assunto: 'GTA 6' }),
        igual('let me know when the RTX 6090 is released', { acao: 'acompanhar', assunto: 'RTX 6090' }),
        igual('o que eu tenho amanhã?', { acao: 'listar', periodo: 'amanha' }),
        igual('cancele o lembrete do banco', { acao: 'cancelar', busca: 'Banco' }),
        p('lembre que meu nome é Zé') === null || 'memória',
        p('marque como lido') === null && p('agende uma reunião') === null || '"marque/agende" sem data',
        p('qual o melhor mouse?') === null || 'pergunta comum',
        rotas.escolherRota({ objetivo: 'me lembra amanhã às 9h de pagar a conta', conversa: [] })?.rota.id === 'agenda' || 'a rota',
        rotas.escolherRota({ objetivo: 'lembre que eu prefiro respostas curtas', conversa: [] })?.rota.id === 'memoria' || 'memória continua',
      ];
    },
  },
  {
    nome: 'agenda: o arquivo — adiciona, avisa na hora (antecedência; dia inteiro às 9h; até 12 h de atraso), marca avisado, confere o acompanhado uma vez por dia e grava sem deixar arquivo pela metade',
    tipo: 'unidade',
    async executar() {
      const dir = pasta();
      const ag = new Agenda(dir);
      const lembrete = ag.adicionar({ tipo: 'lembrete', titulo: 'Dentista', quando: '2026-10-24T14:30', avisarAntes: 30 });
      const diaTodo = ag.adicionar({ tipo: 'lembrete', titulo: 'Aniversário', quando: '2026-10-25' });
      const velho = ag.adicionar({ tipo: 'lembrete', titulo: 'Antigo', quando: '2026-10-20T10:00' });
      const sem = ag.adicionar({ tipo: 'lembrete', titulo: 'Sem data' });
      const acomp = ag.adicionar({ tipo: 'acompanhar', titulo: 'RTX 60' });
      const aviso = (d) => ag.paraAvisar(d).map((i) => i.titulo).join(',');
      const resultado = [
        horaDoAviso(lembrete).getHours() === 14 && horaDoAviso(lembrete).getMinutes() === 0 || 'antecedência de 30 min',
        horaDoAviso(diaTodo).getHours() === 9 && diaTodo.diaInteiro || 'dia inteiro às 9h',
        sem.tipo === 'ideia' || 'lembrete sem data vira ideia',
        aviso(new Date(2026, 9, 24, 13, 59)) === '' || 'antes da hora',
        aviso(new Date(2026, 9, 24, 14, 0)) === 'Dentista' || aviso(new Date(2026, 9, 24, 14, 0)),
        !aviso(new Date(2026, 9, 24, 14, 0)).includes('Antigo') || 'atrasado demais não avisa',
      ];
      ag.atualizar(lembrete.id, { avisado: true });
      resultado.push(aviso(new Date(2026, 9, 24, 14, 5)) === '' || 'avisa uma vez só');
      ag.atualizar(lembrete.id, { quando: '2026-10-24T16:00' });
      resultado.push(ag.listar().find((i) => i.id === lembrete.id).avisado === false || 'mudou a hora: avisa de novo');
      resultado.push(ag.paraConferir(Date.now()).map((i) => i.id).join() === acomp.id || 'acompanhado para conferir');
      ag.atualizar(acomp.id, { acompanhar: { ultimaVerificacao: Date.now() } });
      resultado.push(ag.paraConferir(Date.now()).length === 0 && ag.paraConferir(Date.now() + 21 * 3600000).length === 1 || 'uma vez por dia');
      resultado.push(ag.remover(velho.id) && !ag.listar().some((i) => i.id === velho.id) || 'remover');
      resultado.push(!fs.existsSync(path.join(dir, 'agenda.json.tmp')) || 'arquivo temporário sobrando');
      fs.rmSync(dir, { recursive: true, force: true });
      return resultado;
    },
  },
  {
    nome: 'agenda: conferir um assunto — aconteceu, data confirmada, rumor não conta, pesquisa vazia e resposta ilegível dizem por quê',
    tipo: 'unidade',
    async executar() {
      const julgar = (json) => async () => json;
      const ok = await conferirAssunto('RTX 60', { pesquisar: async () => 'A NVIDIA lançou a RTX 60 hoje.', julgar: julgar('{"aconteceu": true, "data": "2027-01-15", "resumo": "Lançada em 15/01."}') });
      const boato = await conferirAssunto('RTX 60', { pesquisar: async () => 'rumores', julgar: julgar('{"aconteceu": false, "data": "", "resumo": "Só rumores."}') });
      const vazia = await conferirAssunto('RTX 60', { pesquisar: async () => '', julgar: julgar('{}') });
      const ilegivel = await conferirAssunto('RTX 60', { pesquisar: async () => 'texto', julgar: julgar('pensando...') });
      return [
        ok.aconteceu === true && ok.data === '2027-01-15' && ok.resumo === 'Lançada em 15/01.' || JSON.stringify(ok),
        boato.aconteceu === false && boato.data === null || JSON.stringify(boato),
        /vazia/.test(vazia.erro) || JSON.stringify(vazia),
        /conclus/.test(ilegivel.erro) || JSON.stringify(ilegivel),
      ];
    },
  },
  {
    nome: 'agenda: as respostas no chat (anotado, ideia, acompanhar, hora que já passou, listar, cancelar um / ambíguo) e a oferta no fim da pesquisa com o "sim"',
    tipo: 'unidade',
    executar() {
      const dir = pasta();
      const eventos = [];
      const deps = { emit: (e) => eventos.push(e) };
      const r = (q) => a.responderAgenda({ pergunta: q, deps, config: {}, pasta: dir, agora: AGORA }).texto;
      const anotado = r('me lembra amanhã às 9h de pagar a conta de luz');
      const ideia = r('anote na agenda: comprar ração');
      const acomp = r('me avise quando a RTX 60 for lançada');
      const passou = r('me lembra hoje às 8h de ver o jogo');
      r('me lembra amanhã às 10h de ligar pro banco');
      r('me lembra amanhã às 11h de ligar pro mecânico');
      const lista = r('o que eu tenho amanhã?');
      const ambiguo = r('cancele o lembrete de ligar');
      const cancelado = r('cancele o lembrete do banco');
      const depois = r('o que eu tenho amanhã?');
      const conv = [{ role: 'assistant', content: `A RTX 60 ainda não tem data.\n\n${a.ofertaDeAcompanhar('RTX 60')}` }];
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        /^Anotado na agenda ✓ \*\*Pagar a conta de luz\*\* — sábado, 24 de outubro, às 09:00\./.test(anotado) || anotado,
        /^Anotado em \*\*Ideias e planos\*\* ✓ — Comprar ração/.test(ideia) || ideia,
        /^Combinado ✓ Vou acompanhar \*\*RTX 60\*\*/.test(acomp) || acomp,
        /já passou/.test(passou) || passou,
        /Ligar pro banco/.test(lista) && /Ligar pro mecânico/.test(lista) && /Pagar a conta de luz/.test(lista) && /Acompanhando: RTX 60/.test(lista) || lista,
        /mais de um/.test(ambiguo) || ambiguo,
        /^Removido da agenda: \*\*Ligar pro banco\*\*/.test(cancelado) && !/banco/.test(depois) || `${cancelado} / ${depois}`,
        eventos.includes('agenda-mudou') || 'a tela é avisada',
        a.pedeAcompanhar('quando a série rtx 60 será lançada ?') && a.pedeAcompanhar('qual a data de lançamento do iPhone 18?') && !a.pedeAcompanhar('quando a Revolução Francesa começou?') || 'evento futuro',
        JSON.stringify(capacidades.aceitouOferta('sim', conv)) === JSON.stringify({ id: 'agenda', pergunta: 'acompanhe RTX 60' }) || JSON.stringify(capacidades.aceitouOferta('sim', conv)),
      ];
    },
  },
];
