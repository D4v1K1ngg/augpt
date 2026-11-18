'use strict';

/**
 * O diretor da dublagem (17/11, Davi: "o dublador fica esperando, não fica sincronizado, faz muitas pausas — daria certo
 * usar o Qwen 3.5 9B como diretor?"). Medido no vídeo do TED-Ed (65 falas): aceleradas 39 → 4; 16 encurtadas pelo Qwen,
 * 6 refeitas depois de ouvidas; 89% entendidas; mediana de 130 ms entre o começo da fala dublada e o da original.
 */

const fs = require('fs');
const path = require('path');
const d = require('../../src/dublagem/diretor');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'diretor da dublagem: cada fala no tempo do trecho (até o próximo, no mínimo 0,8 s); a longa demais é encurtada pelo Qwen (só fica a reescrita mais curta); a que o whisper não entende é refeita',
    tipo: 'unidade',
    async executar() {
      const segs = [{ inicio: 0, fim: 2000 }, { inicio: 2100, fim: 3000 }, { inicio: 5000, fim: 9000 }];
      const alvos = d.tempoAlvo(segs);
      const longas = d.longasDemais(['Então, aqui estamos nós, com um dos elefantes que vivem neste zoológico', 'Oi', 'Tudo bem'], alvos);
      // o "Qwen" falso: encurta a 1ª; na 2ª, devolve uma mais longa (não vale)
      const chatStream = async ({ messages }) => ({ content: messages[1].content.split('\n').map((l) => { const n = l.split('|')[0]; return n === '1' ? '1| Aqui estamos com os elefantes' : `${n}| uma frase bem mais longa do que a original para não valer`; }).join('\n') });
      const r = await d.reescrever(['Então, aqui estamos nós, com um dos elefantes que vivem neste zoológico', 'Oi tudo bem'], [{ i: 0, limite: 30 }, { i: 1, limite: 8 }], { chatStream, para: 'pt' });
      const dub = ler('src/dublagem/index.js');
      // 18/11: os pedaços de frase seguidos viram uma fala; o tempo disponível vai até a próxima (o silêncio depois serve)
      const juntas = d.juntarEmFrases([
        { inicio: 0, fim: 900, texto: 'Se estou aqui hoje e tenho sucesso,' },
        { inicio: 1000, fim: 2500, texto: 'é por causa de vocês.' },
        { inicio: 2600, fim: 3400, texto: 'Obrigado.' },
        { inicio: 6000, fim: 8000, texto: 'Outra frase, depois de uma pausa.' },
      ]);
      const disp = d.tempoDisponivel(juntas);
      return [
        JSON.stringify(alvos) === JSON.stringify([2000, 900, 4000]) || `tempo de cada fala: ${alvos}`,
        // o pedaço sem fim de frase junta com o seguinte; a frase que já terminou (e tem 1,5 s ou mais) fica sozinha
        juntas.length === 3 && juntas[0].texto === 'Se estou aqui hoje e tenho sucesso, é por causa de vocês.' && juntas[0].fim === 2500 && juntas[1].texto === 'Obrigado.' || JSON.stringify(juntas),
        // até a próxima (menos o respiro); o "Obrigado." pode usar o silêncio depois dele, até 3 s além do trecho
        JSON.stringify(disp) === JSON.stringify([2480, 3280, 5000]) || `tempo disponível: ${disp}`,
        longas.length === 1 && longas[0].i === 0 && longas[0].limite === 30 || JSON.stringify(longas),
        r.textos[0] === 'Aqui estamos com os elefantes' && r.textos[1] === 'Oi tudo bem' && r.mudaram === 1 || JSON.stringify(r),
        d.semelhanca('O legal nesses bichos é que eles têm trombas longas', 'o legal nesses bichos e que eles tem trombas muito longas') === 1 && d.semelhanca('O legal nesses bichos', 'tá bom') === 0 || 'semelhança do que foi ouvido',
        // 18/11 (FalleN, 5 min: fala mais corrida 68,5 → 20,3 caracteres/s; 98% entendidas): ritmo natural primeiro, o Qwen
        // encurta o que não cabe (2 rodadas, a 2ª firme) e a duração forçada fica por último
        /no ritmo natural do modelo/.test(dub) && /for \(let rodada = 1; rodada <= 2 && lista\.length; rodada \+= 1\)/.test(dub) && /motivo: rodada > 1 \|\| encurtadas \? 'apertar' : 'curta'/.test(dub) || 'ritmo natural, encurta em 2 rodadas',
        /2c\. último recurso/.test(dub) && /duracoes = o\.get\('duracoes'\)/.test(ler('src/estudio-de-voz/servidor.py')) || 'a duração forçada só como último recurso',
        /diretor\.juntarEmFrases\(lerSrt/.test(dub) && /const alvos = diretor\.tempoDisponivel\(segs\)/.test(dub) || 'frases inteiras e o tempo disponível',
        /const maxima = duracoes \? 0 :/.test(ler('src/estudio-de-voz/index.js')) || 'com a duração fixa, as pausas não são encurtadas depois',
        // 17/11 (Davi: "o Narrador fica trocando de timbre"): a voz âncora — a descrita lê uma frase e as falas clonam essa
        // frase (medido no TED-Ed: distância do timbre típico, média 0,123 → 0,025)
        /if \(comDuracao && voz\.modo !== 'clonar'\)/.test(dub) && /modo: 'clonar', referenciaFixa: \{ audio: ancora, texto: frase \}/.test(dub) && /o\.modo === 'clonar' && o\.referenciaFixa\?\.audio/.test(ler('src/estudio-de-voz/index.js')) || 'a voz âncora: o timbre não muda de fala em fala',
        /for i, texto in enumerate\(partes, 1\):[\s\S]{0,600}torch\.manual_seed\(int\(semente\)\)/.test(ler('src/estudio-de-voz/servidor.py')) || 'a mesma semente em cada parte',
        /diretor\.ouvir\(f\.partes\.map/.test(dub) && /o\.nota < 0\.55/.test(dub) && /motivo: 'clara'/.test(dub) || 'ouve e refaz as falas que não ficaram claras',
      ];
    },
  },
];
