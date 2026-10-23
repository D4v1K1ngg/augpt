'use strict';

/**
 * Idiomas (22/10): português e inglês. O texto de origem é o português; renderer/i18n.js guarda o
 * inglês com a frase em português como chave. Aqui: toda frase passada a tr()/t() no código tem
 * tradução (pega erro de digitação, que deixaria o texto em português na tela em inglês), as
 * frases com número do processo principal viram inglês, e o escritor do núcleo responde em inglês.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { sistemaDoEscritor } = require('../../src/agent/nucleo');

const RENDERER = path.join(__dirname, '..', '..', 'renderer');

/** Carrega o i18n.js num contexto falso de navegador, já em inglês. */
function i18nEmIngles() {
  const contexto = {
    navigator: { language: 'en-US', languages: ['en-US'] },
    localStorage: { getItem: () => 'en', setItem() {} },
    document: { documentElement: {}, body: null },
    addEventListener() {},
    dispatchEvent() {},
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class {},
    NodeFilter: {},
  };
  contexto.window = contexto;
  vm.runInNewContext(fs.readFileSync(path.join(RENDERER, 'i18n.js'), 'utf8'), contexto);
  return contexto.window.i18n;
}

const traducao = require('../../src/agent/traducao');
const catalogo = require('../../src/agent/capacidades');

module.exports = [
  {
    nome: 'idiomas (fase 2): a resposta de uma rota sai em inglês com tabela, link, código, imagem e oferta intactos; o streaming nunca mostra marcador pela metade; marcador perdido devolve o original',
    tipo: 'unidade',
    async executar() {
      const oferta = catalogo.ofertaDe('consultar_pc');
      const texto = `**Espaço nas unidades**\n\n![disco](augpt-img://abc.png)\n\nVeja \`cleanmgr\` em https://support.microsoft.com/pt-br e [o guia](https://exemplo.com/guia).\n\n\`\`\`chart\n{"type":"bar"}\n\`\`\`\n\n${oferta}`;
      // o "modelo" traduz o que não está protegido e devolve em pedaços pequenos, cortando marcadores no meio
      const traduzir = (s) => s.replace('Espaço nas unidades', 'Drive space').replace('Veja', 'See').replace('em ', 'at ').replace('o guia', 'the guide');
      const escritor = (perder = false) => async (msgs, onToken) => {
        let saida = traduzir(msgs[1].content);
        if (perder) saida = saida.replace('⟦0⟧', '');
        for (let i = 0; i < saida.length; i += 3) onToken(saida.slice(i, i + 3));
        return saida;
      };
      const pedacos = [];
      const en = await traducao.paraIngles(texto, { escrever: escritor(), fixos: catalogo.ofertasBilingues(), onPedaco: (p) => pedacos.push(p) });
      let falha = '';
      const perdido = await traducao.paraIngles(texto, { escrever: escritor(true), fixos: catalogo.ofertasBilingues(), onFalha: (m) => (falha = m) });
      const conversa = [{ role: 'assistant', content: en }];
      return [
        /^\*\*Drive space\*\*/.test(en) || en.slice(0, 80),
        en.includes('![disco](augpt-img://abc.png)') && en.includes('`cleanmgr`') && en.includes('https://support.microsoft.com/pt-br') && en.includes('[the guide](https://exemplo.com/guia)') && en.includes('```chart\n{"type":"bar"}\n```') || en,
        en.includes(catalogo.ofertaDe('consultar_pc', 'en')) && !en.includes(oferta) || 'oferta em inglês',
        pedacos.join('') === en && !pedacos.some((p) => /⟦|⟧/.test(p)) || 'streaming sem marcador',
        perdido === texto && /perdeu/.test(falha) || 'marcador perdido: fica o original',
        catalogo.aceitouOferta('yes', conversa)?.id === 'consultar_pc' || 'o "yes" aceita a oferta traduzida',
        traducao.pareceIngles('how much free space does my pc have?') && traducao.pareceIngles('what can you do?') && !traducao.pareceIngles('quanto espaço livre meu pc tem?') && !traducao.pareceIngles('o que você pode fazer?') || 'pareceIngles',
      ];
    },
  },
  {
    nome: 'idiomas: toda frase passada a tr()/t() no código da tela tem tradução para o inglês',
    tipo: 'unidade',
    executar() {
      const i18n = i18nEmIngles();
      const faltam = [];
      for (const arquivo of fs.readdirSync(RENDERER).filter((f) => f.endsWith('.js') && f !== 'i18n.js')) {
        const codigo = fs.readFileSync(path.join(RENDERER, arquivo), 'utf8');
        for (const m of codigo.matchAll(/\b(?:tr|t)\(\s*'((?:[^'\\]|\\.)+)'/g)) {
          const frase = m[1].replace(/\\'/g, "'");
          if (i18n.tr(frase) === frase && !/^[\s·:,.!?…-]*$/.test(frase)) faltam.push(`${arquivo}: ${frase}`);
        }
      }
      return [faltam.length === 0 || `sem tradução: ${faltam.join(' | ')}`];
    },
  },
  {
    nome: 'idiomas: variáveis, frases com número do processo principal e o escritor do núcleo em inglês',
    tipo: 'unidade',
    executar() {
      const i18n = i18nEmIngles();
      const escritorEn = sistemaDoEscritor({ hoje: '22/10/2026', comFontes: true, idioma: 'en' });
      const escritorPt = sistemaDoEscritor({ hoje: '22/10/2026', comFontes: true });
      return [
        i18n.tr('O que você precisa, {nome}?', { nome: 'Ana' }) === 'What do you need, Ana?' || i18n.tr('O que você precisa, {nome}?', { nome: 'Ana' }),
        i18n.tr('frase que não está no dicionário') === 'frase que não está no dicionário' || 'sem tradução, fica o original',
        i18n.trTexto('sua placa tem 8 GB: o 9B cabe inteiro nela — é o que o AuGPT foi ajustado e medido') === 'your card has 8 GB: the 9B fits entirely, and it is the model AuGPT was tuned and measured with' || 'motivo do 9B',
        i18n.trTexto('pouco espaço no disco dos modelos: 5.2 GB livres, precisa de uns 9 GB') === 'low space on the models drive: 5.2 GB free, about 9 GB needed' || 'aviso de disco',
        /INGLÊS \(en-US\)/.test(escritorEn) && !/INGLÊS/.test(escritorPt) && /português do Brasil/.test(escritorPt) || 'escritor no idioma',
      ];
    },
  },
];
