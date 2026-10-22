'use strict';

const http = require('http');
const { Sandbox } = require('../../src/tools/sandbox');
const tools = require('../../src/tools');
const confronto = require('../../src/agent/confronto');
const search = require('../../src/tools/search');
const { extrairDoHtml, pareceListagem, ler, pareceMalcodificado } = require('../../src/tools/extract');
const { recortarRelevante } = require('../../src/tools/web');

/** Servidor com vários domínios simulados por caminho. */
function servidorDeConteudo(paginas) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/search')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ results: paginas.map((p) => ({ title: p.titulo, url: p.url(s.address().port), content: '' })) }));
      }
      const alvo = paginas.find((p) => req.url.startsWith(p.caminho));
      res.setHeader('Content-Type', 'text/html');
      res.end(alvo ? alvo.html : '<html><body><p>vazio</p></body></html>');
    });
    s.listen(0, '127.0.0.1', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
  });
}

const corpo = (texto) => `<html><body><article><p>${texto} ${'Texto complementar suficiente para o extrator aceitar o bloco. '.repeat(3)}</p></article></body></html>`;

module.exports = [
  {
    nome: 'pesquisa: profundidade define o número de fontes',
    tipo: 'unidade',
    async executar() {
      const paginas = Array.from({ length: 12 }, (_, i) => ({
        caminho: `/s${i}`,
        titulo: `Fonte ${i}`,
        // caminhos diferentes no mesmo host contam como o MESMO domínio
        url: (porta) => `http://127.0.0.1:${porta}/s${i}`,
        html: corpo(`Dado da fonte ${i}: valor de R$ ${100 + i},00.`),
      }));
      const srv = await servidorDeConteudo(paginas);
      const ferramenta = tools.get('pesquisar_e_ler');
      const base = {
        sandbox: new Sandbox('/tmp/augpt-pesq'),
        emit() {},
        estado: {},
        config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false },
      };

      const saida = await ferramenta.run({ consulta: 'teste' }, base);
      await srv.fechar();

      const lidas = (saida.match(/--- FONTE/g) || []).length;
      return [
        // mesmo domínio: a política corta em 1 fonte útil, não em 6
        lidas === 1 || `leu ${lidas} páginas do mesmo domínio como se fossem fontes distintas`,
        saida.includes('profundidade: normal') || 'não registrou a profundidade usada',
        saida.includes('3–6 fontes') || 'não registrou os limites da política',
      ];
    },
  },

  {
    nome: 'pesquisa: diversidade de domínio vale para a execução inteira',
    tipo: 'unidade',
    async executar() {
      // dois domínios, três páginas cada
      const paginas = [];
      for (const d of [1, 2]) for (const p of [1, 2, 3]) paginas.push({ host: `127.0.0.${d}`, path: `/p${p}` });

      const srv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          if (req.url.startsWith('/search')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(
              JSON.stringify({
                results: paginas.map((p) => ({ title: p.host + p.path, url: `http://${p.host}:${s.address().port}${p.path}`, content: '' })),
              })
            );
          }
          res.setHeader('Content-Type', 'text/html');
          res.end(corpo(`Conteúdo de ${req.headers.host}${req.url}.`));
        });
        s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
      });

      const ctx = {
        sandbox: new Sandbox('/tmp/augpt-dominios'),
        emit() {},
        estado: {},
        config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, profundidadePesquisa: 'alta', subconsultas: false },
      };

      const ferramenta = tools.get('pesquisar_e_ler');
      const leituras = [];
      for (const n of [1, 2, 3]) {
        const saida = await ferramenta.run({ consulta: `consulta ${n}` }, ctx);
        leituras.push((saida.match(/--- FONTE/g) || []).length);
      }
      const contagem = [...(ctx.estado.dominiosLidos || new Map())].map(([, n]) => n);
      const ultima = await ferramenta.run({ consulta: 'consulta 4' }, ctx);
      await srv.fechar();

      return [
        // o filtro era local a cada chamada: a segunda busca relia o mesmo portal
        contagem.every((n) => n <= 2) || `leu ${Math.max(...contagem)} páginas do mesmo domínio`,
        leituras[0] === 2 || `primeira busca leu ${leituras[0]} fontes`,
        leituras[2] === 0 || 'continuou lendo depois de esgotar os domínios',
        /nenhum domínio NOVO/.test(ultima) || 'não avisou que as fontes se esgotaram',
        /ângulo diferente/.test(ultima) || 'não orientou o que fazer em seguida',
      ];
    },
  },

  {
    nome: 'pesquisa: skill não contradiz a política de profundidade',
    tipo: 'unidade',
    executar() {
      const fs = require('fs');
      const path = require('path');
      const skill = fs.readFileSync(
        path.join(__dirname, '..', '..', 'skills', 'pesquisa-web', 'SKILL.md'),
        'utf8'
      );

      return [
        // a skill mandava parar em 2 fontes; a profundidade alta pede 6 a 10
        !/Duas fontes independentes cobrem/.test(skill) || 'a skill ainda fixa um número de fontes',
        !/8\.000 caracteres/.test(skill) || 'a skill ainda fixa um teto de caracteres',
        /não é decisão sua|profundidade/.test(skill) || 'a skill não remete à política de profundidade',
      ];
    },
  },

  {
    nome: 'recortarRelevante: acha o trecho da consulta mesmo longe do início da página',
    tipo: 'unidade',
    executar() {
      // Bug real (relatado pelo Davi): patch note oficial do PUBG 43.1 tem uma
      // seção inteira "(PC) Introduction of DLSS/FSR" a uns 75% do documento,
      // depois de Gameplay/Ranked/Leaderboard — o corte simples (só os
      // primeiros N caracteres) nunca chegava lá, e a resposta saía dizendo
      // que a atualização "não menciona DLSS/FSR" com a informação bem ali,
      // só que fora da janela lida.
      const introducao = 'Notas de lançamento do jogo, com diversas mudanças de jogabilidade. '.repeat(60); // ~4600 chars, "cabeça" irrelevante
      const secaoAlvo = 'Introdução do DLSS/FSR: NVIDIA DLSS 4.5 e AMD FSR 4.1 agora são suportados para melhor gráfico.';
      const rodape = 'Correções de bugs diversas neste lançamento. '.repeat(40);
      const pagina = `${introducao}\n\n${secaoAlvo}\n\n${rodape}`;

      const simples = pagina.slice(0, 1500);
      const recortado = recortarRelevante(pagina, 'DLSS FSR', 1500);

      return [
        !simples.includes('DLSS') || 'o teste não representa o bug: o corte simples já pegava o termo',
        recortado.includes('NVIDIA DLSS 4.5') || 'não localizou a seção relevante mais adiante na página',
        recortado.includes('AMD FSR 4.1') || 'não trouxe o trecho inteiro ao redor do termo encontrado',
        recortado.length < pagina.length || 'não cortou nada — orçamento não foi respeitado',
      ];
    },
  },

  {
    nome: 'recortarRelevante: página que já cabe, ou sem termo da consulta, não muda de comportamento',
    tipo: 'unidade',
    executar() {
      const curta = 'Texto curto que cabe inteiro no orçamento.';
      const longaSemTermo = 'Parágrafo genérico sem relação com a busca. '.repeat(60);

      return [
        recortarRelevante(curta, 'qualquer coisa', 1500) === curta || 'mexeu num texto que já cabia',
        recortarRelevante(longaSemTermo, 'assunto totalmente diferente', 500) ===
          `${longaSemTermo.slice(0, 500)}\n[…]` || 'sem o termo da consulta, deveria cair no corte simples de sempre',
      ];
    },
  },

  {
    nome: 'pesquisa: seção sobre o assunto pedido, no fim de uma página longa, chega ao dossiê',
    tipo: 'unidade',
    async executar() {
      const introducao = 'Notas de lançamento do jogo, com diversas mudanças de jogabilidade. '.repeat(60);
      const secaoAlvo = 'Introdução do DLSS/FSR: NVIDIA DLSS 4.5 e AMD FSR 4.1 agora são suportados para melhor gráfico.';
      const rodape = 'Correções de bugs diversas neste lançamento. '.repeat(40);
      const paginaHtml = corpo(`${introducao}\n\n${secaoAlvo}\n\n${rodape}`);

      const paginas = [{ caminho: '/patch', titulo: 'Patch notes 43.1', url: (p) => `http://127.0.0.1:${p}/patch`, html: paginaHtml }];
      const srv = await servidorDeConteudo(paginas);
      const ferramenta = tools.get('pesquisar_e_ler');
      const ctx = {
        sandbox: new Sandbox('/tmp/augpt-recorte'),
        emit() {},
        estado: {},
        config: {
          searxngUrl: `http://127.0.0.1:${srv.porta}`,
          permitirLeitorExterno: false,
          subconsultas: false,
          profundidadePesquisa: 'normal', // porPagina: 3500 — bem menor que a página inteira
        },
      };
      const saida = await ferramenta.run({ consulta: 'DLSS FSR' }, ctx);
      await srv.fechar();

      return [saida.includes('NVIDIA DLSS 4.5') || 'a seção sobre DLSS/FSR não chegou ao dossiê'];
    },
  },

  {
    nome: 'pesquisa: mesma página com query string diferente não rouba o 2º slot do domínio',
    tipo: 'unidade',
    async executar() {
      // Bug real (relatado pelo Davi): duas buscas parecidas na mesma execução
      // devolvem a mesma página no topo, só que com um "?utm_source=..." diferente
      // — a chave de cache antiga só descartava "#", então isso furava o cache
      // (requisição repetida) E gastava o único slot restante do domínio numa
      // página que já tinha sido lida, em vez de sobrar pra uma página nova.
      let requisicoesPagina1 = 0;
      const s = http.createServer((req, res) => {
        const caminho = req.url.split('?')[0];
        if (req.url.startsWith('/search')) {
          res.setHeader('Content-Type', 'application/json');
          const porta = s.address().port;
          const query = new URL(req.url, 'http://x').searchParams.get('q') || '';
          // a "segunda busca" (subconsulta parecida) traz a MESMA página 1, só
          // que com utm diferente, e desta vez também uma página 2 nova
          const resultados =
            query.includes('2')
              ? [
                  { title: 'Página 1 de novo', url: `http://127.0.0.1:${porta}/pagina1?utm_source=outra`, content: '' },
                  { title: 'Página 2', url: `http://127.0.0.1:${porta}/pagina2`, content: '' },
                ]
              : [{ title: 'Página 1', url: `http://127.0.0.1:${porta}/pagina1?utm_source=primeira`, content: '' }];
          return res.end(JSON.stringify({ results: resultados }));
        }
        if (caminho === '/pagina1') requisicoesPagina1 += 1;
        res.setHeader('Content-Type', 'text/html');
        res.end(corpo(`Conteúdo de ${caminho}.`));
      });
      await new Promise((r) => s.listen(0, '127.0.0.1', r));

      const ctx = {
        sandbox: new Sandbox('/tmp/augpt-dedup-qs'),
        emit() {},
        estado: {},
        config: { searxngUrl: `http://127.0.0.1:${s.address().port}`, permitirLeitorExterno: false, subconsultas: false },
      };
      const ferramenta = tools.get('pesquisar_e_ler');
      await ferramenta.run({ consulta: 'busca 1' }, ctx);
      const saida2 = await ferramenta.run({ consulta: 'busca 2' }, ctx);
      await new Promise((r) => s.close(r));

      return [
        requisicoesPagina1 === 1 || `página 1 foi buscada de verdade ${requisicoesPagina1} vezes (query string furou o cache)`,
        saida2.includes('/pagina2') || 'não aproveitou o slot livre do domínio pra ler a página nova',
        !saida2.includes('Página 1 de novo') || 'releu a página 1 em vez de pular pra uma página nova do mesmo domínio',
      ];
    },
  },

  {
    nome: 'pesquisa: cache evita ler a mesma URL duas vezes',
    tipo: 'unidade',
    async executar() {
      let requisicoes = 0;
      const s = http.createServer((req, res) => {
        requisicoes += 1;
        res.setHeader('Content-Type', 'text/html');
        res.end(corpo('Conteúdo estável para o teste de cache.'));
      });
      await new Promise((r) => s.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${s.address().port}/pagina`;

      const ctx = {
        sandbox: new Sandbox('/tmp/augpt-cache'),
        emit() {},
        estado: {},
        config: { permitirLeitorExterno: false },
      };
      const abrir = tools.get('abrir_pagina');
      await abrir.run({ url }, ctx);
      await abrir.run({ url }, ctx);
      await abrir.run({ url: `${url}#secao` }, ctx); // âncora não muda o recurso
      await new Promise((r) => s.close(r));

      return [requisicoes === 1 || `fez ${requisicoes} requisições para a mesma URL`];
    },
  },

  {
    nome: 'extração: pareceListagem distingue capa de matéria',
    tipo: 'unidade',
    executar() {
      // capa de portal: várias manchetes curtas, sem nenhum parágrafo longo de
      // desenvolvimento — é o formato que fazia o destilador misturar Irã, dólar
      // e lançamento de celular como se fosse um texto corrido só.
      const manchetes = [
        'Governo anuncia mudança na política de juros para o próximo trimestre',
        'Seleção brasileira convoca jogadores para os próximos amistosos',
        'Nova atualização do aplicativo traz recursos de segurança',
        'Chuvas fortes atingem região sul e deixam moradores em alerta',
        'Empresa de tecnologia anuncia resultado trimestral acima do esperado',
        'Ministério divulga novo cronograma de vacinação para o próximo mês',
        'Trânsito é interditado após acidente na rodovia principal da cidade',
      ].join('\n\n');
      const capa = pareceListagem(manchetes);

      // matéria curta legítima: poucos blocos, não deve ser marcada como capa
      const materiaCurta = pareceListagem(
        'Vencimento do boleto é 17/08/2026.\n\nValor total: R$ 410,49.'
      );

      // matéria longa legítima: mesmo com alguns blocos curtos (subtítulos),
      // tem parágrafo de desenvolvimento — não é uma capa
      const materiaLonga = pareceListagem(
        [
          '## Atualização 43.1 traz mudanças no mapa',
          'A desenvolvedora publicou nesta terça-feira as notas completas da atualização 43.1, ' +
            'detalhando ajustes de balanceamento em armas, correções de bugs reportados pela ' +
            'comunidade desde a última temporada e uma revisão no sistema de pontuação da ' +
            'temporada ranqueada, que passa a considerar também o tempo de sobrevivência médio.',
          '## Próximos passos',
          'A empresa afirmou que uma nova rodada de testes começa na próxima semana.',
        ].join('\n\n')
      );

      return [
        capa === true || 'não reconheceu manchetes soltas como página de índice',
        materiaCurta === false || 'marcou uma matéria curta legítima como capa',
        materiaLonga === false || 'marcou uma matéria longa (com subtítulos curtos) como capa',
      ];
    },
  },

  {
    // Caso real: pubg.com/pt-br/news/ (visto num log de execução do Davi) escapava
    // da detecção de capa porque cada card repete o próprio título dentro do bloco
    // — uma vez como texto do link, outra como alt/aria-label da imagem — quase
    // dobrando o tamanho do bloco sem acrescentar informação. Isso empurrava blocos
    // que são manchetes curtas de verdade para fora do balde "curto" (<90 chars),
    // fazendo pareceListagem devolver false para uma capa de portal de verdade.
    nome: 'extração: pareceListagem desconta título duplicado dentro do bloco (capa real do pubg.com)',
    tipo: 'unidade',
    executar() {
      const cardDuplicado = (titulo, meta) => `${titulo} ${titulo} ${meta}`;
      const blocos = [
        'NOTÍCIAS',
        cardDuplicado('Atualização 43.1 chega aos servidores de PC', '01/09/2026'),
        cardDuplicado('Aviso Semanal de Banimentos', '2026.09.09'),
        cardDuplicado('Novo modo de jogo Caos Total é lançado', '28/08/2026'),
        cardDuplicado('Evento de aniversário começa nesta semana', '25/08/2026'),
        cardDuplicado('Correções de bugs da atualização 43.1', '02/09/2026'),
        cardDuplicado('Ajustes de balanceamento de armas na temporada atual', '03/09/2026'),
        cardDuplicado('Novo passe de temporada disponível na loja', '04/09/2026'),
        cardDuplicado('Torneio regional anunciado', '05/09/2026'),
        cardDuplicado('Mudanças no sistema de pontuação ranqueada', '06/09/2026'),
        cardDuplicado('Colaboração especial chega ao jogo', '07/09/2026'),
      ].join('\n\n');

      const semDesconto = blocos
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter(Boolean)
        .filter((b) => b.length < 90).length;

      return [
        pareceListagem(blocos) === true ||
          'não reconheceu a capa real do pubg.com (títulos duplicados dentro do bloco) como página de índice',
        semDesconto < 7 ||
          'fixture não reproduz o bug: mesmo sem descontar a duplicação já cairia como capa (teste não seria significativo)',
      ];
    },
  },

  {
    // Caso real: um link de um PDF (relatório da Nvidia) numa página de resultados
    // foi lido e os BYTES CRUS do PDF (`%PDF-1.4 ... stream ... JFIF ...`) foram
    // despejados no material coletado, como se fosse texto de verdade — a
    // ferramenta de web decodifica qualquer resposta como texto, e o PDF nunca
    // era detectado como um formato à parte. O projeto já tem um extrator de PDF
    // de verdade (usado por ler_arquivo); faltava ligá-lo na leitura de páginas.
    nome: 'extração: PDF baixado da web é extraído de verdade, não despejado como bytes crus',
    tipo: 'unidade',
    async executar() {
      const fs = require('fs');
      const path = require('path');
      const pdfBuffer = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'manual.pdf'));
      const srv = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/pdf');
        res.end(pdfBuffer);
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const porta = srv.address().port;
      let resultado;
      try {
        resultado = await ler(`http://127.0.0.1:${porta}/relatorio.pdf`);
      } finally {
        await new Promise((r) => srv.close(r));
      }
      return [
        resultado.via === 'pdf' || `via veio "${resultado.via}", não extraiu como pdf`,
        resultado.texto.includes('Manual de Operação') || 'não extraiu o texto real do PDF',
        !resultado.texto.includes('%PDF-') || 'despejou os bytes crus do PDF no material',
        !/endstream|endobj/.test(resultado.texto) || 'despejou estrutura interna do PDF (streams) no material',
      ];
    },
  },

  {
    // Caso real (chat "Pergunta 1" sobre o guia PMBOK, 2026-09-18): entre os PDFs
    // lidos durante a pesquisa, um tinha fonte sem mapa de codificação (Identity-H
    // sem ToUnicode) — `src/formatos/pdf.js` já detecta isso (`pareceLegivel` volta
    // false) e marca `meta.aviso`, mas o texto embaralhado ainda vinha de volta em
    // `extraido.texto`, não-vazio. `ler()` só checava o COMPRIMENTO do texto (>=40
    // caracteres) antes de aceitar como material válido — o aviso da própria
    // extração era descartado. O texto virou "material coletado" no dossiê e o
    // modelo, em vez de ignorar, tentou "decifrar" o ruído e nunca respondeu às
    // perguntas de verdade. Esta fixture reproduz o sintoma (texto extraído sem
    // letras/vogais suficientes, exatamente o que `pareceLegivel` mede) sem
    // depender de um PDF real com fonte quebrada.
    nome: 'extração: ler() descarta PDF com extração ilegível (aviso da própria extração) em vez de aceitar por comprimento',
    tipo: 'unidade',
    async executar() {
      const fs = require('fs');
      const conteudoGarbled = '1234567890!@#$%^&*_+-=~`'.repeat(4);
      const pdfIlegivel = Buffer.from(
        `%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Length ${conteudoGarbled.length + 30} >>\nstream\nBT /F1 12 Tf (${conteudoGarbled}) Tj ET\nendstream\nendobj\n`,
        'latin1'
      );
      const srv = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/pdf');
        res.end(pdfIlegivel);
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const porta = srv.address().port;
      let resultado;
      let erro = null;
      try {
        resultado = await ler(`http://127.0.0.1:${porta}/manual-quebrado.pdf`, { permitirExterno: false });
      } catch (err) {
        erro = err;
      } finally {
        await new Promise((r) => srv.close(r));
      }
      return [
        Boolean(erro) || `ler() devolveu via="${resultado?.via}" com texto ilegível, em vez de falhar`,
        !erro || /pdf:/.test(erro.message) || `erro não mencionou o motivo do pdf: "${erro.message}"`,
      ];
    },
  },

  {
    // Caso real (v0.5.7, teste ao vivo): uma página devolveu
    // texto que `http.js` decodificou sem erro nenhum (nenhuma exceção,
    // charset "válido") mas o resultado era ruído sem sentido — charset
    // errado pro conteúdo de verdade da página (não é o caso de PDF/binário
    // virando texto, que já tinha correção própria — aqui É texto, só que no
    // charset errado). Isso virou "material coletado" no prompt e o modelo
    // tentou "reproduzir fielmente" o lixo em vez de ignorá-lo.
    nome: 'extração: pareceMalcodificado distingue texto malcodificado (charset errado) de texto legítimo',
    tipo: 'unidade',
    executar() {
      const garbled = 'CPX@□□□(□8□□□□□□8H□X□˜□,□□□□□□□??? CPX@R□□□□□u□□□□□·□□□□h□□□□□L0|□□□g□□□□#3□C□S□c□s□□□□□(□8H□X□x□□‘□7□G□W□w□·□□ '.repeat(6);
      const legivel =
        'A energia solar residencial usa painéis fotovoltaicos instalados no telhado para captar a luz do sol e converter em eletricidade, reduzindo a conta de luz em até 95% ao longo do tempo. '.repeat(4);
      return [
        pareceMalcodificado(garbled) === true || 'não detectou texto malcodificado de verdade',
        pareceMalcodificado(legivel) === false || 'marcou texto legítimo em português como malcodificado',
        pareceMalcodificado('curto demais') === false || 'amostra curta não devia ter como avaliar',
      ];
    },
  },

  {
    nome: 'extração: ler() descarta página malcodificada em vez de devolver ruído como material válido',
    tipo: 'unidade',
    async executar() {
      const garbled = 'CPX@□□□(□8□□□□□□8H□X□˜□,□□□□□□□??? CPX@R□□□□□u□□□□□·□□□□h□□□□□L0|□□□g□□□□#3□C□S□c□s□□□□□(□8H□X□x□□‘□7□G□W□w□·□□ '.repeat(20);
      const srv = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<html><body><article><p>${garbled}</p></article></body></html>`);
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const porta = srv.address().port;
      let erro = null;
      try {
        await ler(`http://127.0.0.1:${porta}/pagina-malcodificada`);
      } catch (err) {
        erro = err;
      } finally {
        await new Promise((r) => srv.close(r));
      }
      return [
        Boolean(erro) || 'ler() devolveu o texto malcodificado como se fosse material válido, em vez de falhar',
      ];
    },
  },

  {
    nome: 'extração: capa de portal marcada em extrairDoHtml, matéria normal não',
    tipo: 'unidade',
    executar() {
      const manchete = (t) => `<h2>${t}</h2>`;
      const capaHtml = `<html><body>${[
        'Governo anuncia mudança na política de juros para o próximo trimestre',
        'Seleção brasileira convoca jogadores para os próximos amistosos',
        'Nova atualização do aplicativo traz recursos de segurança',
        'Chuvas fortes atingem região sul e deixam moradores em alerta',
        'Empresa de tecnologia anuncia resultado trimestral acima do esperado',
        'Ministério divulga novo cronograma de vacinação para o próximo mês',
      ].map(manchete).join('')}</body></html>`;

      const capa = extrairDoHtml(capaHtml);
      const materia = extrairDoHtml(corpo('Explicação detalhada de um assunto específico e único.'));

      return [
        capa.listagem === true || 'não marcou a capa sintética como página de índice',
        materia.listagem === false || 'marcou uma matéria normal como página de índice',
      ];
    },
  },

  {
    nome: 'pesquisa: FONTE de página de índice recebe aviso, matéria normal não',
    tipo: 'unidade',
    async executar() {
      const manchete = (t) => `<h2>${t}</h2>`;
      const capaHtml = `<html><body>${[
        'Governo anuncia mudança na política de juros para o próximo trimestre',
        'Seleção brasileira convoca jogadores para os próximos amistosos',
        'Nova atualização do aplicativo traz recursos de segurança',
        'Chuvas fortes atingem região sul e deixam moradores em alerta',
        'Empresa de tecnologia anuncia resultado trimestral acima do esperado',
        'Ministério divulga novo cronograma de vacinação para o próximo mês',
      ].map(manchete).join('')}</body></html>`;
      const materiaHtml = corpo('Explicação detalhada de um assunto específico e único.');

      const paginas = [
        { caminho: '/capa', titulo: 'Capa do portal', url: (p) => `http://127.0.0.1:${p}/capa`, html: capaHtml },
        { caminho: '/materia', titulo: 'Matéria específica', url: (p) => `http://127.0.0.1:${p}/materia`, html: materiaHtml },
      ];
      const srv = await servidorDeConteudo(paginas);
      const ferramenta = tools.get('pesquisar_e_ler');
      const ctx = {
        sandbox: new Sandbox('/tmp/augpt-listagem'),
        emit() {},
        estado: {},
        config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false },
      };
      const saida = await ferramenta.run({ consulta: 'teste listagem' }, ctx);
      await srv.fechar();

      const blocoCapa = saida.split('--- FONTE').find((b) => b.includes('/capa'));
      const blocoMateria = saida.split('--- FONTE').find((b) => b.includes('/materia'));

      return [
        (blocoCapa || '').includes('PÁGINA DE ÍNDICE') || 'não avisou sobre a página de índice na FONTE',
        !(blocoMateria || '').includes('PÁGINA DE ÍNDICE') || 'avisou indevidamente sobre a matéria normal',
      ];
    },
  },

  {
    nome: 'extração: tabela preservada, data e dados estruturados',
    tipo: 'unidade',
    executar() {
      const html = `<html><head>
        <meta property="article:published_time" content="2026-08-12T10:00:00Z">
        <script type="application/ld+json">{"@type":"Product","name":"Teclado K70","offers":{"price":"199.90","priceCurrency":"BRL"}}</script>
        </head><body><article>
        <p>Introdução com texto suficiente para o extrator aceitar este bloco de conteúdo.</p>
        <table><tr><th>Item</th><th>Preço</th></tr><tr><td>Teclado</td><td>R$ 199,90</td></tr><tr><td>Monitor</td><td>R$ 1.450,00</td></tr></table>
        <table><tr><td>leiaute</td></tr></table>
        </article></body></html>`;
      const r = extrairDoHtml(html);
      return [
        r.texto.includes('| Item | Preço |') || 'a tabela não virou markdown',
        r.texto.includes('| Teclado | R$ 199,90 |') || 'perdeu a relação entre coluna e valor',
        !r.texto.includes('| leiaute |') || 'tabela de leiaute virou dado',
        r.data === '2026-08-12' || `data extraída: ${r.data}`,
        r.texto.includes('Produto: Teclado K70') || 'ignorou o dado estruturado',
        r.texto.includes('199.90') || 'perdeu o preço estruturado',
      ];
    },
  },

  {
    nome: 'confronto: confirma pelo domínio e acha divergência real',
    tipo: 'unidade',
    executar() {
      const r = confronto.confrontar([
        { dominio: 'a.com', texto: 'Sexta 14/08: máxima de 32°C, mínima de 21°C, 30% de chuva.' },
        { dominio: 'b.com', texto: 'Sexta 14 Ago 32° / 21° com 30% de chuva.' },
        { dominio: 'c.gov.br', texto: 'Para sexta 14/08 a previsão é de 28°C com 30% de chuva.' },
      ]);
      const bloco = confronto.paraPrompt(r);
      const div = r.divergencias[0];

      // três páginas do mesmo portal não podem valer três confirmações
      const mesmoPortal = confronto.confrontar([
        { dominio: 'a.com', texto: 'valor de R$ 500,00' },
        { dominio: 'a.com', texto: 'valor de R$ 500,00' },
      ]);
      const inflado = mesmoPortal.confirmados.length;

      return [
        r.dominios === 3 || `contou ${r.dominios} domínios`,
        r.confirmados.some((c) => c.texto.includes('30%')) || 'não confirmou o dado presente nas três',
        r.divergencias.length === 1 || `achou ${r.divergencias.length} divergências`,
        div && div.b.texto.includes('28') || 'não identificou o valor discordante',
        div && div.a.texto.includes('32') || 'comparou com o valor errado (provável mínima × máxima)',
        bloco.includes('DIVERGÊNCIA') || 'não levou a divergência ao prompt',
        inflado === 0 || 'contou o mesmo domínio como confirmação de si mesmo',
        confronto.confrontar([{ dominio: 'a.com', texto: 'x' }]).suficiente === false || 'confrontou fonte única',
      ];
    },
  },

  {
    // Item 1 do pedido do Davi (2026-09-23): cross-validation de opinião —
    // mesma ideia de `divergencias()` (número/data), mas para veredito
    // qualitativo ("recomendo" × "não recomendo") sobre o mesmo item.
    nome: 'confronto: cross-validation de opinião acha divergência de veredito sobre o mesmo item (caso real: comparativo de produto)',
    tipo: 'unidade',
    executar() {
      const r = confronto.confrontar([
        { dominio: 'a.com', texto: 'O Fone Omega é confiável e recomendo para quem joga bastante.' },
        { dominio: 'b.com', texto: 'Uso o Fone Omega há um ano, é confiável e recomendo sem dúvida.' },
        { dominio: 'c.com', texto: 'Cuidado: o Fone Omega não é confiável, teve muitos defeitos no meu uso.' },
      ]);
      const bloco = confronto.paraPrompt(r);
      const div = r.divergenciasOpiniao[0];

      // sem entidade nenhuma na frase, a opinião não tem "sobre o quê" — não deve virar divergência
      const semEntidade = confronto.confrontar([
        { dominio: 'a.com', texto: 'Recomendo bastante, muito bom.' },
        { dominio: 'b.com', texto: 'Não recomendo, péssimo.' },
      ]);

      // as duas fontes concordando (as duas positivas) não é divergência
      const semDivergencia = confronto.confrontar([
        { dominio: 'a.com', texto: 'O Fone Omega é confiável, recomendo.' },
        { dominio: 'b.com', texto: 'O Fone Omega é excelente, recomendo muito.' },
      ]);

      return [
        r.divergenciasOpiniao.length === 1 || `achou ${r.divergenciasOpiniao.length} divergências de opinião`,
        div?.entidade === 'Fone Omega' || `entidade errada: ${JSON.stringify(div)}`,
        (div?.positivos || []).sort().join(',') === 'a.com,b.com' || `positivos errados: ${JSON.stringify(div?.positivos)}`,
        (div?.negativos || []).join(',') === 'c.com' || `negativos errados: ${JSON.stringify(div?.negativos)}`,
        bloco.includes('DIVERGÊNCIA DE OPINIÃO sobre "Fone Omega"') || 'não levou a divergência de opinião ao prompt',
        semEntidade.divergenciasOpiniao.length === 0 || 'opinião sem entidade não deveria virar divergência',
        semDivergencia.divergenciasOpiniao.length === 0 || 'duas fontes concordando não é divergência',
      ];
    },
  },

  {
    nome: 'confronto: polaridadeDaFrase trata negação corretamente ("não decepciona" é elogio, "não recomendo" é crítica)',
    tipo: 'unidade',
    executar() {
      return [
        confronto.polaridadeDaFrase('O produto não decepciona.') === 'positivo' || '"não decepciona" deveria ser positivo',
        confronto.polaridadeDaFrase('Eu não recomendo esse produto.') === 'negativo' || '"não recomendo" deveria ser negativo',
        confronto.polaridadeDaFrase('Veja como funciona o motor a diesel.') === null ||
          '"como funciona" é descritivo, não veredicto — não deveria ter polaridade',
        confronto.polaridadeDaFrase('É um excelente produto, muito satisfeito.') === 'positivo' ||
          'raiz positiva simples deveria bater',
        confronto.polaridadeDaFrase('Péssimo atendimento, teve recall duas vezes.') === 'negativo' ||
          'raiz negativa simples deveria bater',
      ];
    },
  },

  /* ------------------------------ item 2: descoberta de autoridade em duas fases ------------------------------ */

];
