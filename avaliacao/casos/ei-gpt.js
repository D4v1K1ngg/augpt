'use strict';

/**
 * "Ei GPT" (25/10): a chamada como o Whisper escreve, o pedido sem ela, os comandos diretos, a
 * correção pelo modelo só quando parece a mesma frase, e as travas (desligado por padrão, só com a
 * opção marcada, áudio curto).
 */

const fs = require('fs');
const path = require('path');
const d = require('../../src/ditado');

module.exports = [
  {
    nome: '"Ei GPT": reconhece a chamada como o Whisper escreve ("HGPT", "HG PT", "E aí GPT.", "Hey GPT!") e tira ela do pedido; fala comum, "O GPT é bom" e "Ei, tudo bem?" não chamam',
    tipo: 'unidade',
    executar() {
      const chamam = ['HGPT', 'HG PT', 'E aí GPT.', 'Hey GPT!', 'eI GPT,', 'Ei, GPT, que horas são?', 'Ei gepetê, vai chover amanhã?', 'Hey G P T, what time is it?'];
      const naoChamam = ['E aí eu fui para o mercado', 'O GPT é bom', 'gente, vamos', 'Ei, tudo bem?', 'Yesterday I went to the market', ''];
      return [
        chamam.filter((t) => !d.ehChamada(t)).join(' / ') === '' || `não chamaram: ${chamam.filter((t) => !d.ehChamada(t))}`,
        naoChamam.filter((t) => d.ehChamada(t)).join(' / ') === '' || `chamaram: ${naoChamam.filter((t) => d.ehChamada(t))}`,
        d.semChamada('Ei, GPT, que horas são?') === 'Que horas são?' || d.semChamada('Ei, GPT, que horas são?'),
        d.semChamada('Hey G P T, what time is it?') === 'What time is it?' || d.semChamada('Hey G P T, what time is it?'),
        d.semChamada('HGPT.') === '' || 'só a chamada',
      ];
    },
  },
  {
    nome: '"Ei GPT": "nova conversa" e "para" são comandos diretos (pt e en); pedido comum não é',
    tipo: 'unidade',
    executar() {
      return [
        ['Nova conversa', 'abre uma nova conversa', 'Começa uma nova conversa, por favor', 'start a new chat', 'new conversation'].every((t) => d.comandoDeVoz(t) === 'nova-conversa') || 'nova conversa',
        ['Para.', 'pare', 'Cancela', 'stop', 'para de responder'].every((t) => d.comandoDeVoz(t) === 'parar') || 'parar',
        [null].includes(d.comandoDeVoz('para quando é o feriado?')) && d.comandoDeVoz('qual a melhor conversa sobre IA') === null || 'pedido comum',
      ];
    },
  },
  {
    nome: 'correção do texto falado: aceita a mesma frase corrigida; recusa resposta, explicação e texto inventado (fica o original)',
    tipo: 'unidade',
    executar() {
      return [
        d.correcaoAceitavel('quanto esta a rtx 5080 hoje', 'Quanto está a RTX 5080 hoje?') === 'Quanto está a RTX 5080 hoje?' || 'correção boa',
        d.correcaoAceitavel('vai chover amanha em campinas', '"Vai chover amanhã em Campinas?"') === 'Vai chover amanhã em Campinas?' || 'tira as aspas',
        d.correcaoAceitavel('quanto esta a rtx 5080', 'A RTX 5080 custa cerca de R$ 8 mil hoje nas lojas brasileiras, segundo os comparadores de preço.') === null || 'resposta no lugar da correção',
        d.correcaoAceitavel('que horas sao em toquio', 'Aqui está o texto corrigido: Que horas são em Tóquio?') === null || 'explicação',
        d.correcaoAceitavel('me lembra de pagar a conta de luz', 'Lembrete criado para amanhã') === null || 'outra frase',
        d.correcaoAceitavel('abc', '') === null || 'vazio',
        /NÃO responda/.test(d.pedidoDeCorrecao('x')) || 'o pedido proíbe responder',
      ];
    },
  },
  {
    nome: '"Ei GPT": desligado por padrão; o processo principal só confere a chamada com a opção marcada e áudio de até 8 s; a correção respeita o ajuste; a tela carrega a escuta e liga ao abrir',
    tipo: 'unidade',
    executar() {
      const { DEFAULTS } = require('../../src/config');
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const html = fs.readFileSync(path.join(__dirname, '../../renderer/index.html'), 'utf8');
      const ajustes = fs.readFileSync(path.join(__dirname, '../../renderer/app-ajustes.js'), 'utf8');
      const i18n = fs.readFileSync(path.join(__dirname, '../../renderer/i18n.js'), 'utf8');
      return [
        (DEFAULTS ? DEFAULTS.ouvirChamada === false && DEFAULTS.ditadoCorrigir === true : /ouvirChamada: false/.test(fs.readFileSync(path.join(__dirname, '../../src/config.js'), 'utf8'))) || 'padrões',
        /'ditado:chamada'[\s\S]{0,120}config\.data\.ouvirChamada/.test(main) && /ehWav\(audio, 8\)/.test(main) || 'trava da chamada',
        /'ditado:corrigir'[\s\S]{0,200}ditadoCorrigir === false/.test(main) || 'correção respeita o ajuste',
        /<script src="ditado\.js"><\/script>\s*<script src="escuta\.js"><\/script>/.test(html) || 'escuta.js depois do ditado.js',
        /ouvirChamada === true\) window\.escutaPorVoz\?\.ligar\(\)/.test(ajustes) || 'liga ao abrir',
        ['Chamar com "Ei GPT"', 'Corrigir o texto falado', 'Pode falar…'].every((k) => i18n.includes(`'${k}'`)) || 'traduções',
        d.MODELO_DA_ESCUTA.sha256.length === 64 || 'SHA do modelo da escuta',
      ];
    },
  },
];
