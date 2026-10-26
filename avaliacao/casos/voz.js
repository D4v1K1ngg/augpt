'use strict';

/**
 * O nome do assistente e a voz do usuário (25/10): o nome escolhido (boas-vindas/Ajustes) chama pela
 * chave de som; as gravações do treino viram a impressão do som (MFCC) e cada fala nova é comparada com
 * elas (DTW); fala de verdade tem a energia na faixa da voz (clique de teclado não).
 */

const fs = require('fs');
const path = require('path');
const d = require('../../src/ditado');
const v = require('../../renderer/voz');

const TAXA = 16000;
/** Uma "palavra" sintética: tons em sequência (cada [freq, ms]), com harmônicos — `vel` estica ou encolhe. */
function palavra(tons, { vel = 1, silencio = 200 } = {}) {
  const partes = [new Float32Array(Math.round((silencio / 1000) * TAXA))];
  for (const [f, ms] of tons) {
    const n = Math.round(((ms * vel) / 1000) * TAXA);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const t = i / TAXA;
      const env = Math.min(1, i / 200, (n - i) / 200);
      a[i] = env * 0.3 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
    }
    partes.push(a);
  }
  partes.push(new Float32Array(Math.round((silencio / 1000) * TAXA)));
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Float32Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}
const NOME = [[300, 120], [700, 150], [450, 100], [900, 160]];
const OUTRA = [[900, 160], [250, 120], [1200, 150], [350, 100]];

module.exports = [
  {
    nome: 'nome do assistente: "Jarvis", "Nexus", "Sexta-feira", "Aurora" chamam com o "ei/ok" ou sem; frases comuns não; "Atlas" × "atrás da porta" é por isso que não está nas sugestões; "GPT" volta às regras de sempre',
    tipo: 'unidade',
    executar() {
      const comuns = ['Ei, já pedi', 'Ei, gente', 'O jogo foi bom', 'Javier chegou', 'Charles', 'Ontem eu fui ao mercado', 'Travis', 'Ei, tudo bem', 'próximo nível', 'nexo causal', 'ônibus atrasou', 'vamos jogar', 'Jair vai', 'Ok, beleza', 'Nossa, que legal', 'Ei GPT'];
      const resultado = [];
      for (const [nome, chamam] of [['Jarvis', ['Jarvis', 'Ei Jarvis, que horas são?', 'Hey Jarvis!', 'Jarves', 'Jarbis', 'Ok Jarvis']], ['Nexus', ['Nexus', 'Ei Nexus', 'Néxus, abre a agenda']], ['Sexta-feira', ['Sexta-feira', 'Ei, sexta feira, que horas são']], ['Aurora', ['Aurora', 'Ei Aurora', 'Aurôra, vai chover?']]]) {
        d.definirNome(nome);
        const naoChamou = chamam.filter((t) => !d.ehChamada(t));
        const falsos = comuns.filter((t) => d.ehChamada(t));
        resultado.push((naoChamou.length === 0 && falsos.length === 0) || `${nome}: não chamou ${naoChamou}; falso ${falsos}`);
      }
      d.definirNome('Jarvis');
      resultado.push(d.semChamada('Ei Jarvis, que horas são?') === 'Que horas são?' || d.semChamada('Ei Jarvis, que horas são?'));
      // 26/10 (PC do Davi): no treino, o que o Whisper escreveu quando VOCÊ disse o nome vale ("Ei Jarvis" →
      // "Age of Elvis"); "Jarves" já chama sozinho (não vira variante); ruído nunca entra, nem sem espaços
      const treino = d.variantesDoTreino(['Jarves', 'Age of Elvis', 'Som de barulho']);
      resultado.push(JSON.stringify(treino.variantes) === '["ageofelvis"]' && treino.recusadas.length === 1 && !d.varianteValida('somdebarulho') || `variantes de Jarvis: ${JSON.stringify(treino)}`);
      resultado.push(d.ehChamada('Age of Elvis, que horas são', treino.variantes) && d.lembraVariante('Age of service.', treino.variantes) && !d.lembraVariante('O jogo foi bom', treino.variantes) || 'a variante chama, e o parecido só "lembra" (para a decisão com a voz)');
      resultado.push(d.lembraONome('Jervys') && !d.lembraONome('o jogo foi bom') || 'lembra o nome');
      d.definirNome('Atlas');
      resultado.push(d.ehChamada('Atrás da porta') || 'Atlas × atrás (se parar de disparar, dá para sugerir de novo)');
      d.definirNome('GPT');
      resultado.push(d.ehChamada('e jepeite') && !d.ehChamada('Ei, já pedi') && !d.ehChamada('Jarvis') || 'GPT de volta');
      resultado.push(JSON.stringify(v.nomesSugeridos) === '["Jarvis","Nexus","Sexta-feira","Aurora"]' || 'sugestões');
      return resultado;
    },
  },
  {
    nome: 'voz do usuário: a mesma "palavra" mais lenta ou mais rápida bate com as gravações (DTW); outra palavra não; com menos de 4 gravações, não decide; o corte cai no fim do nome',
    tipo: 'unidade',
    executar() {
      const modelos = [0.85, 0.95, 1.05, 1.15, 1.25].map((vel) => v.impressao(palavra(NOME, { vel })).quadros);
      const limite = v.limiteDosModelos(modelos);
      const lento = v.reconhecer(palavra(NOME, { vel: 1.3 }), modelos, limite);
      const rapido = v.reconhecer(palavra(NOME, { vel: 0.8 }), modelos, limite);
      const outra = v.reconhecer(palavra(OUTRA), modelos, limite);
      // o nome seguido de mais "fala": o corte cai perto do fim do nome (200 ms de silêncio + ~530 ms)
      const comPedido = new Float32Array([...palavra(NOME, { silencio: 200 }).slice(0, -3200), ...palavra(OUTRA, { silencio: 50 })]);
      const corte = v.reconhecer(comPedido, modelos, limite);
      return [
        Number.isFinite(limite) || `limite: ${limite}`,
        lento.chamou && rapido.chamou || `mesma palavra: ${lento.custo} / ${rapido.custo} (limite ${limite})`,
        !outra.chamou && outra.custo > limite * 1.3 || `outra palavra: ${outra.custo} (limite ${limite})`,
        corte.chamou && corte.corteSegundos > 0.55 && corte.corteSegundos < 0.95 || `corte: ${corte.corteSegundos}`,
        v.limiteDosModelos(modelos.slice(0, 3)) === null || 'com 3 gravações não decide',
        v.reconhecer(palavra(NOME), [], null).chamou === false || 'sem gravações',
      ];
    },
  },
  {
    nome: 'faixa da voz: tom na faixa da fala passa; estalo de teclado (energia espalhada) não; a escuta exige ~250 ms de voz antes de abrir a frase',
    tipo: 'unidade',
    executar() {
      const tom = new Float32Array(4096).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 600 * i) / 48000) + 0.15 * Math.sin((2 * Math.PI * 1200 * i) / 48000));
      // estalos de 1 amostra (espectro plano, como um clique de verdade) — determinístico, sem sorteio
      const clique = new Float32Array(4096).map((_, i) => (i % 900 === 0 ? 0.8 : 0));
      const chiado = new Float32Array(4096).map(() => (Math.random() * 2 - 1) * 0.2);
      const escuta = fs.readFileSync(path.join(__dirname, '../../renderer/escuta.js'), 'utf8');
      return [
        v.faixaDeVoz(tom, 48000) > 0.9 || `tom: ${v.faixaDeVoz(tom, 48000)}`,
        v.faixaDeVoz(clique, 48000) < 0.65 || `clique: ${v.faixaDeVoz(clique, 48000)}`,
        v.faixaDeVoz(chiado, 48000) < 0.65 || `chiado: ${v.faixaDeVoz(chiado, 48000)}`,
        /PEDACOS_DE_FALA = 3/.test(escuta) && /e\.recentes\.filter\(Boolean\)\.length >= PEDACOS_DE_FALA/.test(escuta) || 'duração mínima',
        /faixaDeVoz\(dados, e\.taxa\)[^;]*>= FAIXA_MINIMA/.test(escuta) || 'faixa na escuta',
        /e\.trecho = \[\.\.\.e\.antes\];/.test(escuta) || 'sem o pedaço duplicado no começo da frase',
      ];
    },
  },
  {
    nome: 'voz do usuário no app: decide junto com o texto (o som sozinho não chama — o começo tem que lembrar o nome); as gravações ficam como números (escuta-voz.json, até 12) e somem ao trocar de nome ou apagar o treino',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const escuta = fs.readFileSync(path.join(__dirname, '../../renderer/escuta.js'), 'utf8');
      return [
        /!r\.chamou && pelaVoz\?\.chamou === true && r\.parecido/.test(main) || 'som + texto',
        /escuta-voz\.json/.test(main) && /\.slice\(0, 12\)/.test(main) && /quadrosValidos/.test(main) || 'gravações guardadas como números',
        /'nomeDaChamada' in patch\) aplicarNomeDaChamada\(\{ zerar:/.test(main) && /fs\.rmSync\(arquivoDaVoz\(\)/.test(main) || 'trocar o nome zera',
        /g\.corte = pelaVoz\?\.chamou \? pelaVoz\.corteSegundos/.test(escuta) || 'corte do pedido pelo som',
      ];
    },
  },
];
