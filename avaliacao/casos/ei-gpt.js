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
    nome: 'treino da voz: guarda como o Whisper escreve a SUA pronúncia (sem o começo comum de frase nem frase longa); depois, a mesma pronúncia escrita de outro jeito chama ("Juppetti" × "Geppetti", com enchimento antes) e o parecido não ("Hey, pretty", "Ei, já pedi"); a sensibilidade vem do volume, entre 0,002 e 0,012',
    tipo: 'unidade',
    executar() {
      const t = d.variantesDoTreino(['Hey Geppetti!', 'Ei GPT.', 'E aí.', 'Hey Geppetti', 'hoje eu vou ao mercado comprar pão']);
      const v = t.variantes;
      return [
        JSON.stringify(v) === '["heygeppetti"]' || JSON.stringify(t),
        t.recusadas.length === 2 || `recusadas: ${t.recusadas}`,
        ['Hey, hey, Juppetti!', 'Hey Jeppetti!', 'Hey Geppetti, what time is it?'].every((x) => d.ehChamada(x, v)) || 'variações da pronúncia treinada',
        d.semChamada('Hey, hey, Juppetti, what time is it?', v) === 'What time is it?' || d.semChamada('Hey, hey, Juppetti, what time is it?', v),
        !['Hey, pretty', 'Hey there', 'Hey, Peppa'].some((x) => d.ehChamada(x, v)) || 'parecido não chama',
        !['Ei, depois', 'Ei, já pedi', 'Ei, gente bonita'].some((x) => d.ehChamada(x, ['eijepete'])) || 'parecido não chama (pt)',
        d.ehChamada('Ei, Jepetê') && d.ehChamada('Hei Gepeto') || 'chave de som na lista de sempre',
        d.sensibilidadeDoTreino([0.03, 0.02, 0.025]) === 0.0088 && d.sensibilidadeDoTreino([0.2]) === 0.012 && d.sensibilidadeDoTreino([0.001]) === 0.002 && d.sensibilidadeDoTreino([]) === null || 'sensibilidade',
      ];
    },
  },
  {
    nome: 'modelo da escuta: small por padrão, base como alternativa; sem o escolhido baixado, usa o outro; o registro do que a escuta ouviu fica só na memória (até 40) e o treino confere sem as variantes antigas',
    tipo: 'unidade',
    executar() {
      const fs2 = require('fs');
      const os = require('os');
      const dir = fs2.mkdtempSync(path.join(os.tmpdir(), 'augpt-escuta-'));
      const x = new d.Ditado(dir);
      const mod = (n) => path.join(dir, 'ditado', 'modelos', n);
      fs2.mkdirSync(path.join(dir, 'ditado', 'bin'), { recursive: true });
      fs2.mkdirSync(path.join(dir, 'ditado', 'modelos'), { recursive: true });
      fs2.writeFileSync(path.join(dir, 'ditado', 'bin', 'whisper-cli.exe'), '');
      fs2.writeFileSync(mod(d.MODELOS.turbo.arquivo), '');
      const nenhum = x.modeloDaEscuta('small');
      fs2.writeFileSync(mod(d.MODELOS_DA_ESCUTA.base.arquivo), '');
      const soBase = [x.modeloDaEscuta('small'), x.modeloDaEscuta('base')];
      fs2.writeFileSync(mod(d.MODELOS_DA_ESCUTA.small.arquivo), '');
      const ambos = [x.modeloDaEscuta('small'), x.modeloDaEscuta('base')];
      fs2.rmSync(dir, { recursive: true, force: true });
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const cfg = fs.readFileSync(path.join(__dirname, '../../src/config.js'), 'utf8');
      return [
        nenhum === null && JSON.stringify(soBase) === '["base","base"]' && JSON.stringify(ambos) === '["small","base"]' || JSON.stringify({ nenhum, soBase, ambos }),
        d.MODELOS_DA_ESCUTA.small.sha256 === d.MODELOS.pequeno.sha256 || 'o small é o mesmo arquivo do ditado',
        /escutaModelo: 'small'/.test(cfg) && /escutaVariantes: \[\]/.test(cfg) || 'padrões',
        /registroDaEscuta\.length = Math\.min\(registroDaEscuta\.length, 40\)/.test(main) || 'registro limitado',
        /'ditado:treinarFrase'[\s\S]{0,200}variantes: \[\]/.test(main) || 'treino sem as variantes antigas',
      ];
    },
  },
  {
    nome: 'no app (25/10): o teclado chamava o AuGPT — "Som de barulho" tinha virado variante no treino. Variante só se soa como "GPT"; o que o Whisper inventa no ruído sai da transcrição; a frase repetida fica uma vez',
    tipo: 'unidade',
    executar() {
      return [
        !d.varianteValida('somdebarulho') && d.varianteValida('eijipete') && d.varianteValida('eaichepete') || 'variante válida',
        JSON.stringify(d.variantesValidas(['eijipete', 'somdebarulho', 'eaichepete'])) === '["eijipete","eaichepete"]' || 'limpa as antigas',
        JSON.stringify(d.variantesDoTreino(['Som de barulho', 'Ei, Jipitê!']).variantes) === '["eijipite"]' || 'treino recusa o ruído',
        !d.ehChamada('Som de barulho', d.variantesValidas(['somdebarulho'])) || 'o ruído não chama',
        d.limparTranscricao('Som de barulho.') === '' && d.limparTranscricao('Legendas pela comunidade Amara.org') === '' || 'alucinação sai',
        d.limparTranscricao('Qual a data de hoje? Qual a data de hoje?') === 'Qual a data de hoje?' || 'repetição',
        d.limparTranscricao('Ei GPT, que horas são? Obrigado.') === 'Ei GPT, que horas são? Obrigado.' || 'frase normal fica',
      ];
    },
  },
  {
    nome: 'quanto mais treina, melhor (25/10): o treino soma às variantes que já havia (até 24); a chamada que virou pedido ensina como o Whisper escreveu; "Era eu chamando" no registro ensina a que não pegou',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const muitas = Array.from({ length: 30 }, (_, i) => `eigepete${String.fromCharCode(97 + (i % 26))}${i}`).filter(d.varianteValida);
      return [
        JSON.stringify(d.juntarVariantes(['novaapete'], ['eijipete', 'somdebarulho'])) === '["novaapete","eijipete"]' || 'soma e limpa',
        d.juntarVariantes(muitas, muitas).length <= 24 || 'teto',
        d.chamadaEscrita('Ei, Jipitê, que horas são?', ['eijipete']) === 'eijipite' || d.chamadaEscrita('Ei, Jipitê, que horas são?', ['eijipete']),
        d.chamadaEscrita('Hey, hey, Juppetti!') === 'heyjuppetti' || d.chamadaEscrita('Hey, hey, Juppetti!'),
        d.chamadaEscrita('Som de barulho') === null && d.chamadaEscrita('Ontem eu fui ao mercado') === null || 'nada a aprender',
        /juntarVariantes\(variantes, config\.data\.escutaVariantes\)/.test(main) || 'o treino soma',
        /ultimaChamada && Date\.now\(\) - ultimaChamada\.em < 120000[\s\S]{0,80}aprenderChamada\(ultimaChamada\.junto\)/.test(main) || 'aprende com o uso',
        /'ditado:aprenderChamada'/.test(main) || '"Era eu chamando"',
        /variantesValidas\(config\.data\.escutaVariantes\)[\s\S]{0,120}config\.save\(\{ escutaVariantes: variantesLimpas \}\)/.test(main) || 'limpa ao abrir',
      ];
    },
  },
  {
    nome: 'correção do texto falado (25/10): sabe o que o AuGPT faz ("ritmo de rede" → "teste de rede"), não troca palavra certa por sinônimo e tira a frase repetida',
    tipo: 'unidade',
    executar() {
      const p = d.pedidoDeCorrecao('x');
      return [/teste de rede/.test(p) && /NÃO troque palavra certa por sinônimo/.test(p) && /Frase repetida/.test(p) || 'pedido da correção'];
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
