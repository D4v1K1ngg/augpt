'use strict';

/**
 * Ajustes globais das respostas (23/10, a partir do histórico real): tamanho na medida da pergunta,
 * sem abertura de enchimento e sem negar o que o AuGPT faz.
 */

const c = require('../../src/agent/capacidades');
const { tamanhoNaMedida, sistemaDoEscritor } = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'respostas: pergunta simples recebe resposta curta mesmo no "detalhada"; comparação, explicação, guia e produto ficam com o tamanho escolhido; o "detalhada" não pede mais 1.200 palavras',
    tipo: 'unidade',
    executar() {
      const curtas = ['Quem é voce ?', 'Qual a cotação do dolar atualmente ?', 'quando sai a terceira temporada de vinland saga?', 'o que é bufferbloat?'];
      const longas = ['Como que uma lanpada de led funciona ?', 'Quem é o melhor pro player de pubg de pc atualmente ? e por que ?', 'qual a diferença entre GDDR7 e LPDDR?', 'Como controlar melhor o spray no pubg de pc ?', 'DLSS5'];
      const escritor = sistemaDoEscritor({ hoje: '23/10/2026', comFontes: true, tamanho: 'detalhada' });
      return [
        ...curtas.map((p) => tamanhoNaMedida(p, 'detalhada') === 'curta' || `curta: ${p}`),
        ...longas.map((p) => tamanhoNaMedida(p, 'detalhada') === 'detalhada' || `detalhada: ${p}`),
        tamanhoNaMedida('qual o preço da rtx 5080?', 'detalhada', { produto: true }) === 'detalhada' || 'produto mantém',
        !/1\.200 palavras|como um relat[óo]rio/.test(escritor) && /NA MEDIDA DA PERGUNTA/.test(escritor) && /Não comece com a data/.test(escritor) || 'instruções do escritor',
      ];
    },
  },
  {
    nome: 'respostas: a abertura de enchimento sai ("Hoje é…", "Com base nas fontes…", "Como o AuGPT…", "# Relatório…"), também depois das fotos do topo; o resto do texto não muda',
    tipo: 'unidade',
    executar() {
      return [
        c.semEnchimento('Hoje é 22 de outubro de 2026. A análise mostra X.') === 'A análise mostra X.' || 'hoje é',
        c.semEnchimento('# Relatório: Cotação Atual do Dólar\n\n**Data de Referência:** 21 de outubro\n\nO dólar está R$ 5,40.') === 'O dólar está R$ 5,40.' || 'relatório',
        c.semEnchimento('![a](augpt-img://x.jpg)\n\nCom base nas fontes disponíveis para a data de hoje, a resposta é sim.') === '![a](augpt-img://x.jpg)\n\nA resposta é sim.' || 'depois das fotos',
        c.semEnchimento('Como o AuGPT, analisei as fontes.') === 'Analisei as fontes.' || 'como o augpt',
        c.semEnchimento('Paris é a capital. Hoje é dia de sol.') === 'Paris é a capital. Hoje é dia de sol.' || 'o meio não é tocado',
      ];
    },
  },
  {
    nome: 'respostas: frase que nega um recurso do AuGPT sai e a oferta do recurso entra no fim; falha de verdade ("não consegui medir") fica; tabela e código não são tocados',
    tipo: 'unidade',
    executar() {
      const rede = c.conferirNegacoes('Seu ping está ótimo. Não consigo medir diretamente a velocidade da sua conexão neste momento. Use o speedtest.');
      const nav = c.conferirNegacoes('O AuGPT não consegue navegar diretamente pelo navegador interno para acessar links externos.');
      const img = c.conferirNegacoes('Não consigo exibir as imagens diretamente aqui no chat.', 'en');
      const pc = c.conferirNegacoes('Como sou uma inteligência artificial baseada em texto e não tenho acesso ao seu hardware, sugiro o CPU-Z.');
      const falha = c.conferirNegacoes('Não consegui medir o download: o servidor limitou os pedidos.');
      const tabela = c.conferirNegacoes('| Não consigo medir | x |\n|---|---|');
      return [
        !/Não consigo medir/.test(rede.texto) && rede.texto.includes(c.ofertaDe('teste_de_rede').slice(0, 40)) && /Use o speedtest/.test(rede.texto) || rede.texto,
        /consigo abrir sites/.test(nav.texto) && !/não consegue navegar/.test(nav.texto) || nav.texto,
        img.tiradas.length === 1 || 'imagens',
        pc.tiradas.length === 1 && pc.texto.includes(c.ofertaDe('consultar_pc').slice(0, 40)) || pc.texto,
        falha.tiradas.length === 0 || 'falha real fica',
        tabela.tiradas.length === 0 || 'tabela intacta',
      ];
    },
  },
];
