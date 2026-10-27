'use strict';

/**
 * Texto → fonemas do Kokoro em português do Brasil (27/10, voz "estilo Jarvis"): src/fala/fonemas-pt-br.js.
 */

const f = require('../../src/fala/fonemas-pt-br');

// o til vai separado (o + U+0303), que é o que o Kokoro conhece
const N = (t) => t.normalize('NFD');
const palavra = (p, esperado) => f.palavraEmFonemas(p) === N(esperado) || `${p} → ${f.palavraEmFonemas(p)} (esperado ${esperado})`;

module.exports = [
  {
    nome: 'fonemas pt-br: tônica, ti/di, nasais, lh/nh/ch, R forte e fraco, L no fim da sílaba, s entre vogais, x, qu/gu, ditongos',
    tipo: 'unidade',
    executar() {
      return [
        palavra('carro', 'kˈaxu'), palavra('rato', 'xˈatu'), palavra('caro', 'kˈaɾu'), palavra('honra', 'ˈõxɐ'),
        palavra('Brasil', 'bɾazˈiw'), palavra('alto', 'ˈawtu'), palavra('casa', 'kˈazɐ'), palavra('mesmo', 'mˈezmu'),
        palavra('chuva', 'ʃˈuvɐ'), palavra('ilha', 'ˈiʎɐ'), palavra('ninho', 'nˈiɲu'), palavra('exame', 'ezˈami'), palavra('táxi', 'tˈaksi'),
        palavra('gente', 'ʒˈẽʧi'), palavra('guerra', 'ɡˈexɐ'), palavra('quente', 'kˈẽʧi'), palavra('cidade', 'sidˈaʤi'), palavra('noite', 'nˈojʧi'),
        palavra('pão', 'pˈɐ̃w'), palavra('mãe', 'mˈɐ̃j'), palavra('tempo', 'tˈẽpu'), palavra('cantam', 'kˈɐ̃tɐ̃w'),
        palavra('vídeo', 'vˈiʤju'), palavra('quarenta', 'kwaɾˈẽtɐ'), palavra('terminou', 'teɾminˈow'), palavra('Vitória', 'vitˈɔɾiɐ'),
        palavra('reais', 'xeˈajs'),
      ];
    },
  },
  {
    nome: 'fonemas pt-br: números, dinheiro, %, horas, graus, siglas soletradas, arquivo e palavras átonas',
    tipo: 'unidade',
    executar() {
      const ext = (t) => f.porExtenso(t);
      return [
        ext('R$ 5,44') === 'cinco reais e quarenta e quatro centavos' || ext('R$ 5,44'),
        ext('R$ 6.999,90') === 'seis mil, novecentos e noventa e nove reais e noventa centavos' || ext('R$ 6.999,90'),
        ext('205.083') === 'duzentos e cinco mil e oitenta e três' || ext('205.083'),
        ext('0,47%') === 'zero vírgula quarenta e sete por cento' || ext('0,47%'),
        ext('às 14h30') === 'às quatorze horas e trinta' || ext('às 14h30'),
        ext('28°C') === 'vinte e oito graus' || ext('28°C'),
        ext('2026') === 'dois mil e vinte e seis' || ext('2026'),
        ext('1ª') === 'primeira' || ext('1ª'),
        /ˈɛxi tˈe ʃˈis/.test(f.textoEmFonemas('a RTX')) || f.textoEmFonemas('a RTX'),
        f.textoEmFonemas('teclado.txt').includes(N('teklˈadu pˈõtu tˈe ʃˈis tˈe')) || f.textoEmFonemas('teclado.txt'),
        f.textoEmFonemas('A cotação do dólar') === N('a kotasˈɐ̃w du dˈɔlɐɾ') || f.textoEmFonemas('A cotação do dólar'),
        f.textoEmFonemas('Boa noite, senhor.') === 'bˈoɐ nˈojʧi, siɲˈoɾ.' || f.textoEmFonemas('Boa noite, senhor.'),
        !/[õẽĩũ]/.test(f.textoEmFonemas('honra, tempo, sim, um, põe')) || 'til junto (o Kokoro joga fora)',
        !/[*#\[\]()]|https/.test(f.textoEmFonemas('**Fontes:** [uol](https://uol.com.br) 🚀')) || 'markdown, link e emoji saem',
      ];
    },
  },
];
