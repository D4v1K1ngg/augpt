'use strict';

/**
 * Cartões da recomendação (21/10, conversa dos "5 melhores setups gamers"): a foto busca o assunto
 * junto com o nome e não aceita imagem fora dele quando o nome é um conceito; a citação "(17)" vira
 * a etiqueta do site.
 */

const imagens = require('../../src/tools/imagens');

global.window = global.window || {};
require('../../renderer/md.js');
const md = global.window.md;

// um buscador de imagens falso: o nome sozinho traz um prédio; com o assunto, um setup
const buscador = (consultas) => async (q) => {
  consultas.push(q);
  if (/setup gamer/.test(q)) return [{ titulo: 'Clean minimalist white gaming setup', url: 'https://x.com/setup.jpg' }, { titulo: 'Clean white minimalist building facade', url: 'https://x.com/predio.jpg' }];
  return [{ titulo: 'Clean white minimalist building facade', url: 'https://x.com/predio.jpg' }];
};

module.exports = [
  {
    nome: 'cartões: a foto de um conceito busca com o assunto e só aceita imagem que cite o assunto ("Clean Minimalist White Build" não vira prédio); sem nada certo, fica sem foto; modelo com número ainda tenta o nome sozinho',
    tipo: 'unidade',
    async executar() {
      const baixadas = [];
      const deps = (consultas) => ({ buscarImagens: buscador(consultas), baixar: async (url) => (baixadas.push(url), { ok: true, tipo: 'image/jpeg', bytes: Buffer.alloc(20000) }) });
      const c1 = [];
      const uri = await imagens.imagemDoCartao('Clean Minimalist White Build', { contexto: 'setup gamer', dir: require('os').tmpdir(), deps: deps(c1) });
      const c2 = [];
      const nada = await imagens.imagemDoCartao('Purple Loft with Geometric Drama', { contexto: 'setup gamer', dir: require('os').tmpdir(), deps: { buscarImagens: async (q) => (c2.push(q), [{ titulo: 'Purple loft apartment interior', url: 'https://x.com/loft.jpg' }]) } });
      const c3 = [];
      await imagens.imagemDoCartao('KZ ZS10 Pro X', { contexto: 'fone intra-auricular', dir: require('os').tmpdir(), deps: { buscarImagens: async (q) => (c3.push(q), []) } });
      return [
        c1[0] === 'Clean Minimalist White Build setup gamer' || `consulta: ${c1}`,
        !baixadas.includes('https://x.com/predio.jpg') || 'baixou o prédio',
        nada === null && c2.length === 1 || `conceito sem imagem do assunto: ${nada} / ${c2}`,
        c3.length === 2 && c3[1] === 'KZ ZS10 Pro X' || `modelo tenta o nome sozinho: ${c3}`,
        imagens.citaOAssunto('Clean white gaming setup', 'setup gamer') && !imagens.citaOAssunto('White building facade', 'setup gamer') || 'cita o assunto',
      ];
    },
  },
  {
    nome: 'cartões: a citação "[(17)](url)" vira a etiqueta com o nome do site (sem o número no texto), com a fonte no título; link comum continua link',
    tipo: 'unidade',
    executar() {
      // 29/10: por padrão a citação sai do texto (as fontes ficam no fim); a etiqueta só com a opção ligada
      const texto = 'Muito citado [(17)](https://www.techtudo.com.br/x)[(3)](https://www.reddit.com/r/a) e [aqui](https://g1.globo.com/y).';
      const limpo = md.render(texto);
      const antes = global.config;
      global.config = { citacoesNoTexto: true };
      let html;
      try {
        html = md.render(texto);
      } finally {
        global.config = antes;
      }
      return [
        limpo === '<p>Muito citado e <a href="https://g1.globo.com/y" data-externo="1">aqui</a>.</p>' || limpo,
        /<a class="cita" href="https:\/\/www\.techtudo\.com\.br\/x"[^>]*title="Fonte 17 · techtudo\.com\.br">techtudo<\/a>/.test(html) || html,
        /<a class="cita"[^>]*>reddit<\/a>/.test(html) || 'reddit',
        !/\(17\)|\(3\)/.test(html) || 'o número ficou no texto',
        /<a href="https:\/\/g1\.globo\.com\/y" data-externo="1">aqui<\/a>/.test(html) || 'link comum',
      ];
    },
  },
  {
    nome: 'fontes no fim (29/10): "---" + "Fontes" + lista viram o bloco recolhido "Fontes · N sites" com o nome de cada site; a coluna da tabela que só tinha citações sai',
    tipo: 'unidade',
    executar() {
      const html = md.render('Texto [(1)](https://www.infoescola.com/x).\n\n---\n**Fontes**\n1. [Motor a vapor - InfoEscola](https://www.infoescola.com/x)\n2. [Um blog](https://meublog.wordpress.com/y)');
      const tabela = md.render('| Característica | Descrição | Fonte |\n|---|---|---|\n| Tipo | Externa | [(1)](https://a.com/x) |');
      return [
        /<details class="fontes-da-resposta"><summary>Fontes · 2 sites<\/summary>/.test(html) || html,
        /<li><a href="https:\/\/www\.infoescola\.com\/x" data-externo="1"><span class="fonte-site">infoescola<\/span><span class="fonte-nome">Motor a vapor - InfoEscola<\/span><\/a><\/li>/.test(html) || 'item com o site',
        // repetida (mesmo site e título) aparece uma vez; sem as citações no texto, a lista conta 1, 2, 3
        (md.render('x\n\n---\n**Fontes**\n1. [Motor](https://pt.wikipedia.org/wiki/A)\n2. [Motor](https://pt.wikipedia.org/wiki/B)').match(/<li>/g) || []).length === 1 || 'repetida',
        /<span class="fonte-site">meublog<\/span>/.test(html) || 'blog hospedado: o nome do blog',
        !/<hr \/>/.test(html) && /^<p>Texto\.<\/p>/.test(html) || 'sem a linha e sem a citação no texto',
        !/Fonte<\/th>/.test(tabela) && /<th>Descrição<\/th>/.test(tabela) || tabela,
      ];
    },
  },
  {
    nome: 'texto final (29/10): preço sem fonte tira a frase (sem "(preço não confirmado)" no meio); parágrafo que só anuncia sai, conteúdo fica; o escritor não anuncia nem repete o começo no fim',
    tipo: 'unidade',
    executar() {
      const nucleo = require('../../src/agent/nucleo');
      const r = nucleo.conferirResposta('A melhor é a RTX 5060 Ti. Ela custa R$ 2.899 hoje. Vale a pena.\n\n#### 1. CORSAIR RM850x\n**Faixa de preço:** A partir de aproximadamente R$ 899.\n**Pontos fortes:** Silenciosa. Custa R$ 700 no ML.\n\n| Modelo | Preço |\n|---|---|\n| RM850x | R$ 899 |\n| MSI | R$ 649,90 |\n\n- Opção por R$ 300.\n- Outra boa.', { material: 'MSI R$ 649,90', produto: true }).texto;
      const corpo = r.split('\n\n*Tirei')[0];
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      const anuncio = eval(src.match(/const PARAGRAFO_DE_ANUNCIO = (\/.*\/i);/)[1]);
      const escritor = nucleo.sistemaDoEscritor({ hoje: 'x', comFontes: true });
      return [
        !/não confirmado/.test(r) && !/\u2062/.test(r) || 'sem buraco',
        /^A melhor é a RTX 5060 Ti\. Vale a pena\./.test(corpo) || corpo,
        /\*\*Faixa de preço:\*\* não encontrei nas fontes lidas\./.test(corpo) && /\*\*Pontos fortes:\*\* Silenciosa\.\n/.test(corpo) || 'campos do cartão',
        /\| RM850x \| — \|/.test(corpo) && /R\$ 649,90/.test(corpo) || 'tabela',
        !/Opção por/.test(corpo) && /- Outra boa\./.test(corpo) || 'item da lista',
        /Tirei 4 preços que não aparecem/.test(r) || 'o aviso do fim',
        anuncio.test('Aqui está uma explicação detalhada do funcionamento, dividida por etapas:') && anuncio.test('Abaixo, detalho as opções encontradas.') && anuncio.test('Segue uma comparação entre os modelos:') || 'anúncio sai',
        !anuncio.test('Aqui está o motivo: a água ferve no nível do mar.') && !anuncio.test('Abaixo do mar, a pressão aumenta e muda tudo.') || 'conteúdo fica',
        /Não anuncie o que vai escrever/.test(escritor) && /Não termine repetindo o começo/.test(escritor) || 'regras do escritor',
      ];
    },
  },
];
