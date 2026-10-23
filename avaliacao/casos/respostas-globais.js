'use strict';

/**
 * Ajustes globais das respostas (23/10, a partir do histórico real): tamanho na medida da pergunta,
 * sem abertura de enchimento e sem negar o que o AuGPT faz.
 */

const c = require('../../src/agent/capacidades');
const { tamanhoNaMedida, sistemaDoEscritor } = require('../../src/agent/nucleo');

const nucleo = require('../../src/agent/nucleo');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');

module.exports = [
  {
    nome: 'pesquisa para quando o material basta: cumpridos os mínimos, as leituras esgotadas encerram antes da 6ª rodada; sem fonte nenhuma, continua tentando',
    tipo: 'unidade',
    async executar() {
      let n = 0;
      let lidasN = 0;
      const deps = {
        // o "modelo" nunca chama pronto: sempre busca de novo e pede para ler mais uma fonte
        chamar: async (msgs, o) => (o.json ? { content: '{"precisa_buscar": true}' } : { content: '', chamadas: [{ function: { name: 'buscar_na_web', arguments: { buscas: [`q${n}`] } } }, { function: { name: 'ler_pagina', arguments: { fonte: 3 * n, foco: 'x' } } }] }),
        buscar: async (q) => [1, 2, 3].map((i) => ({ titulo: `${q} ${i}`, url: `https://site${String(q).replace(/\W/g, '')}${i}.com/p`, resumo: 'texto sobre x' })),
        lerPagina: async () => (lidasN += 1, { texto: 'conteúdo útil sobre x '.repeat(40), titulo: 'x' }),
        embed: async (t) => t.map(() => [1, 0]),
        emit: (e) => { if (e === 'iteracao') n += 1; },
      };
      await nucleo.pesquisar({ pergunta: 'x', modo: 'normal', deps, hoje: 'hoje' });
      return [n < 6 || `rodadas: ${n}`, lidasN >= 3 || `leu ${lidasN}`];
    },
  },
  {
    nome: 'fotos: pergunta de suporte ("como atualizar o chipset?", "é possível usar o loudness na minha G6?") vai sem foto no topo; pergunta sobre o produto continua com foto',
    tipo: 'unidade',
    executar() {
      const fotos = (p, assuntos) => nucleo.conferirEntendimento({ produto: false, imagemAjuda: true, assuntos, pergunta: p }, { pergunta: p, conversa: [] }).fotos;
      return [
        fotos('como atualizar o chipset do processador Ryzen 7 7800X3D?', ['Ryzen 7 7800X3D']).length === 0 || 'chipset',
        fotos('É possivel usar o loudness equalization na minha sound blaster g6 ?', ['Sound Blaster G6']).length === 0 || 'loudness',
        fotos('me fale da Sound Blaster G6', ['Sound Blaster G6']).length === 1 || 'produto continua com foto',
      ];
    },
  },
  {
    nome: 'pesquisa só quando precisa: sobre o AuGPT, conta direta e prova ficam sem busca (inclusive quando o JSON do entendimento vem ilegível); cotação, notícia e "como funciona" pesquisam',
    tipo: 'unidade',
    executar() {
      const sem = ['Quem é voce ?', 'o que você é?', 'como você funciona?', 'calcule 37*48', 'quanto é 2^10?', 'Questão 1 — Álgebra: x+y=6 e \\(x^3+y^3=72\\)'];
      const com = ['quanto é o dólar hoje?', 'Como que uma lanpada de led funciona ?', 'qual a cotação do dolar?', 'o que você acha da rtx 5080?'];
      return [
        ...sem.map((p) => nucleo.podeFicarSemBusca(p) || `sem busca: ${p}`),
        ...com.map((p) => !nucleo.podeFicarSemBusca(p) || `pesquisa: ${p}`),
        nucleo.lerEntendimento('{"precisa_buscar": true}', 'Quem é você?').precisaBuscar === false || 'o modelo não força busca sobre o AuGPT',
        nucleo.lerEntendimento('sem json nenhum', 'Questão 1 — Álgebra: x+y=6 e \\(x^3+y^3=72\\)').precisaBuscar === false || 'reserva respeita a prova',
        nucleo.lerEntendimento('sem json nenhum', 'qual a cotação do dólar?').precisaBuscar === true || 'reserva pesquisa o resto',
      ];
    },
  },
  {
    nome: 'pedido de ação vai para o navegador ("navegue nesse site", "abra https://…"); pergunta analítica depois de uma conversa de produto não vira produto (sem fotos nem "Onde comprar")',
    tipo: 'unidade',
    executar() {
      const conversa = [{ role: 'user', content: 'Será que a RTX 60 vai vir custando muito? qual comprar?' }];
      const produto = (p) => nucleo.conferirEntendimento({ produto: true, assuntos: ['RTX 60'], pergunta: p }, { pergunta: p, conversa }).produto;
      return [
        tipoDoPedido("Navegue nesse site pra min 'https://www.unip.br/aluno/central/'").tipo === 'site' || 'navegue',
        tipoDoPedido('abra https://g1.globo.com').tipo === 'site' || 'abra',
        tipoDoPedido('acesse o site https://g1.globo.com e resuma a manchete').tipo !== 'site' || 'ler o site continua leitura',
        produto('Quais evidências concretas sustentam sua previsão de que a RTX 60 será mais cara? Separe fatos, rumores e inferências') === false || 'analítica',
        produto('qual o preço de hoje da rtx 5080?') === true || 'preço continua produto',
        produto('qual a diferença entre a 5080 e a 5070 ti, vale a pena?') === true || 'vale a pena continua produto',
      ];
    },
  },
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
