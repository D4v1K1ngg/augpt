'use strict';

/**
 * Revisão v2 do plano de pesquisa (2026-09-28, depois do 14º teste real e da
 * análise do ChatGPT que o Davi trouxe). Um caso por etapa (A–I) — cada um
 * reproduz a falha real que a etapa corrige.
 */

const { executarCasoAgente } = require('../motor');
const { EventEmitter } = require('events');
const { resumoDeArgumentos, itemNaoExecutavel, fontesDaResposta } = require('../../src/agent/loop');
const m = require('../../src/agent/motor-pesquisa');
const prompts = require('../../src/agent/prompts');
const verificador = require('../../src/agent/verificador');
const { Evidencias } = require('../../src/agent/evidencias');
const escopo = require('../../src/agent/escopo');
const serie = require('../../src/agent/serie-de-precos');
const perfis = require('../../src/agent/perfis');
const usoPro = require('../../src/agent/uso-profissional');
const compositor = require('../../src/agent/compositor');
const afirmacoes = require('../../src/agent/afirmacoes');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

// tópico de fórum Invision (mesma estrutura do Clube do Hardware; ver casos/comunidade.js)
const TOPICO = (titulo, pergunta, respostas) =>
  `<html><head><title>${titulo} - Clube do Hardware</title></head><body>
  <article><div data-role="commentContent" class="ipsType_normal ipsType_richText"><p>${pergunta}</p></div></article>
  ${respostas.map((r) => `<article><div data-role="commentContent" class="ipsType_normal ipsType_richText"><p>${r}</p></div></article>`).join('\n')}
  </body></html>`;

const PEDIDO_14 = "Realize uma pesquisa profunda em foruns da comunidade como no 'reddit, clube do hardware, forum do adrenalise' para encontrar os 10 melhores fones intra auriculares para se jogar pubg de pc";
const PLANO_FONES = 'USO: jogar PUBG no PC\nCRITÉRIOS:\n- posicionamento | alto | posicionamento, imaging\n- preço | médio | preço\nOPÇÕES CITADAS NO PEDIDO:\n- nenhuma\nBUSCAS DE DESCOBERTA:\n- descoberta fones pubg';
// o 7B falso: aponta os nomes que aparecem em cada comentário (e inventa um, que o código tem de derrubar)
const CONHECIDOS = ['Truthear Hexa', 'Simgot EM6L', 'KZ EDX Pro', 'Moondrop Chu 2', 'Samson SR850', 'HyperX Cloud II'];
const produtosFalsos = (bruto) => {
  let prompt = String(bruto);
  try {
    prompt = JSON.parse(bruto).map((x) => x.content).join('\n');
  } catch {
    /* já é texto */
  }
  const linhas = [];
  for (const m of prompt.matchAll(/^\((\d+)\) (.*)$/gm)) {
    for (const n of CONHECIDOS) if (m[2].toLowerCase().includes(n.toLowerCase())) linhas.push(`- ${n} | ${m[1]}`);
  }
  linhas.push('- Invented Z9 | 1');
  return linhas.join('\n');
};
const { Registro } = require('../../src/registro');

module.exports = [
  /* ------------------------------ Etapa A ------------------------------ */
  {
    nome: 'etapa A: argumentos das ferramentas, plano inicial e checklist vão pro registro, com IDs de busca e fonte',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'etapa A registro',
        pedido: 'Pesquise o que é o protocolo QUIC e responda.',
        config: { pipelineForcadoUniversal: true, criticaPeriodica: false },
        planejamentoInicial: '- Pesquisar o protocolo QUIC\n- Responder ao usuário',
        roteiro: [
          { ferramenta: 'buscar_web', argumentos: { consulta: 'protocolo QUIC o que é' }, plano: ['Pesquisar o protocolo QUIC'] },
          { ferramenta: 'responder', argumentos: { foco: 'QUIC' } },
        ],
        redacao: 'QUIC é um protocolo de transporte.',
      });
      const r = obtido.registro;
      const busca = r.ferramentas.find((f) => f.nome === 'buscar_web');
      const longo = resumoDeArgumentos({ conteudo: 'x'.repeat(900), consulta: 'abc' });
      return [
        busca?.argumentos?.consulta === 'protocolo QUIC o que é' || `argumentos da busca no registro: ${JSON.stringify(busca)}`,
        /^T\d{3}$/.test(busca?.id || '') || `id da ferramenta: ${busca?.id}`,
        JSON.stringify(r.planoInicial) === JSON.stringify(['Pesquisar o protocolo QUIC', 'Responder ao usuário']) || `plano inicial: ${JSON.stringify(r.planoInicial)}`,
        r.checklist.length === 2 || `checklist final: ${JSON.stringify(r.checklist)}`,
        longo.conteudo === '(900 caracteres)' && longo.consulta === 'abc' || `texto longo vira tamanho: ${JSON.stringify(longo)}`,
        Array.isArray(r.descartes) || 'campo de descartes',
      ];
    },
  },

  {
    nome: 'etapa A: busca ganha B001 com as consultas; leitura ganha F001 ligada à busca de onde veio; descarte registrado',
    tipo: 'unidade',
    executar() {
      const ag = new EventEmitter();
      const reg = new Registro({ modelo: 'x' }).acompanhar(ag);
      ag.emit('fonte', { tipo: 'busca', provedor: 'searxng', falhas: [], consultas: ['iem fps footsteps'] });
      ag.emit('fonte', { tipo: 'leitura', provedor: 'densidade', url: 'https://a.com/1' });
      ag.emit('fonte', { tipo: 'busca', provedor: 'searxng', falhas: [], consultas: ['site:reddit.com iem pubg'] });
      ag.emit('fonte', { tipo: 'leitura', provedor: 'densidade', url: 'https://b.com/2' });
      ag.emit('descarte', { etapa: 'categoria', alvo: 'SteelSeries Arctis 1', motivo: 'headset num pedido de intra' });
      const f = reg.dados.fontes;
      return [
        f[0].id === 'B001' && f[0].consultas[0] === 'iem fps footsteps' || JSON.stringify(f[0]),
        f[1].id === 'F001' && f[1].busca === 'B001' || JSON.stringify(f[1]),
        f[3].id === 'F002' && f[3].busca === 'B002' || JSON.stringify(f[3]),
        reg.dados.descartes[0]?.alvo === 'SteelSeries Arctis 1' || JSON.stringify(reg.dados.descartes),
      ];
    },
  },

  /* ------------------------------ Etapa B ------------------------------ */
  {
    nome: 'etapa B: juiz — "(…) sem dados" no fim também é sem dados (Arctis 1 com "4 de 4" no 14º teste)',
    tipo: 'unidade',
    executar() {
      const k = [{ nome: 'posicionamento dos sons' }, { nome: 'Baixa latência' }];
      const v = m.lerJulgamento('posicionamento dos sons: (X-Ray Hearing permite ouvir sons antes de vê-los) sem dados\nBaixa latência: com fio, sem atraso', k, new Map());
      return [
        v.get('posicionamento dos sons') === null || `veredito: ${v.get('posicionamento dos sons')}`,
        v.get('Baixa latência') === 'com fio, sem atraso' || 'veredito normal continua',
      ];
    },
  },
  {
    nome: 'etapa B: tom — pergunta com "recomendado" não é recomendação; resposta só com o nome num tópico que pede indicação é; "entre A e B? O B" não recomenda o A',
    tipo: 'unidade',
    executar() {
      const t = m.termosDoUso('10 melhores fones intra auriculares para jogar pubg de pc');
      const ctx = { pedeIndicacao: true, doUso: true };
      const samson = '@Pepse escrevi mal, o Samson já me havia sido recomendado mas quero um sem fio mesmo, o kz edx pro só achei versão sem fio, poderia me recomendar algum?';
      return [
        m.tomDoComentario(samson, t, 'KZ EDX PRO', ctx) === 'pergunta' || 'pedido de indicação virou recomendação',
        m.tomDoComentario('Truthear Hexa', t, 'Truthear Hexa', ctx) === 'recomenda' || 'resposta direta num tópico que pede indicação',
        m.tomDoComentario('Truthear Hexa', t, 'Truthear Hexa', {}) === 'mencao' || 'fora de tópico de indicação, nome solto é menção',
        m.tomDoComentario('Simgot EM6L. Thank me later', t, 'Simgot EM6L', ctx) === 'recomenda' || 'frase seguinte completa a do nome',
        m.tomDoComentario('Qual dos dois eu recomendo entre KZ EDX e SR850? O Samson, porque tem palco', t, 'KZ EDX', ctx) === 'pergunta' || '"entre A e B?" não recomenda o A',
        m.tomDoComentario('Do lado mais caro, mas eu tenho os Bose QC20 há 6 anos.', t, 'Bose QC20', ctx) === 'mencao' || 'posse sem uso continua menção',
      ];
    },
  },
  {
    nome: 'etapa B: consenso — tópico que pede indicação dá contexto; respostas curtas em 3 tópicos somam como recomendação; Reddit conta por tópico',
    tipo: 'unidade',
    executar() {
      const topico = (i, linhas) => ({
        url: `https://www.reddit.com/r/iems/comments/${i}/x/`,
        titulo: 'IEM recommendation for competitive FPS gaming',
        bruto: ['TÓPICO DO REDDIT (r/iems): IEM recommendation for competitive FPS gaming', 'POST: which iem should i get for pubg?', 'COMENTÁRIOS:', ...linhas].join('\n'),
      });
      const entradas = [topico(1, ['- [30 votos] truthear hexa']), topico(2, ['- [6 votos] Truthear Hexa ($80)']), topico(3, ['- [2 votos] hexa or zero red, truthear hexa'])];
      const termos = m.termosDoUso('10 melhores fones intra auriculares para jogar pubg de pc');
      const c = m.consensoDe('Truthear Hexa', entradas, {}, { termos });
      const v = m.validarCandidatos(['Truthear Hexa'], entradas);
      return [
        c.topicos >= 2 || `tópicos que recomendam: ${c.topicos} (${JSON.stringify(c)})`,
        c.pontos >= 8 || `pontos: ${c.pontos}`,
        v[0]?.fontes === 3 || `fontes por tópico: ${JSON.stringify(v)}`,
      ];
    },
  },
  {
    nome: 'etapa B: lacuna sem "ou superior"; leitura de ficha que não cita a opção sai do material; hipótese "não afirmam" é sem dados; busca sem preposição pendurada; resumo sem resto do prompt',
    tipo: 'unidade',
    executar() {
      return [
        m.limparTermoDeBusca('memória GDDR6X ou superior') === 'memória GDDR6X' || m.limparTermoDeBusca('memória GDDR6X ou superior'),
        m.coerenteComMotivo('a maioria dos jogadores prefere fones com cancelamento', 'derrubada', 'Materiais sugerem preferência por ANC mas não afirmam maioria') === 'sem dados' || 'hipótese',
        m.semPreposicaoPendurada('10 melhores fones para jogar PUBG no PC em') === '10 melhores fones para jogar PUBG no PC' || 'preposição',
        m.semRestoDoPrompt('a 15 (Conexão com fio: Sim; Microfone: Sim) em 20 palavras') === 'Conexão com fio: Sim; Microfone: Sim' || 'resto do prompt',
        m.respaldoDe({ consenso: { topicos: 0, editoriais: 11, editoriaisDoUso: 0 } }) === 'citada em 11 sites (fora do uso pedido)' || m.respaldoDe({ consenso: { topicos: 0, editoriais: 11 } }),
      ];
    },
  },
  {
    nome: 'etapa B: plano — "definir as plataformas" e "contatar marcas" saem; conversa anterior não vira alvo de busca sem referência; fontes só do que foi lido, sem loja',
    tipo: 'unidade',
    executar() {
      const conversa = [
        { role: 'user', content: "pesquisa profunda em foruns como 'reddit, clube do hardware, forum do adrenalise' pra achar 10 intra pra PUBG" },
        { role: 'assistant', content: 'Resposta longa sobre KZ EDX PRO…' },
      ];
      const novo = "Qual o fone de ouvido mais usado pelos profissionais 'e-sports' no pubg de pc ?";
      const sis = prompts.sistema({ objetivo: novo, workspace: '/w', so: 'x', conversa });
      const sisRef = prompts.sistema({ objetivo: 'e desses aí, qual é o mais barato?', workspace: '/w', so: 'x', conversa });
      const fontes = fontesDaResposta({
        doModelo: ['https://lista.mercadolivre.com.br/fone', 'https://pt.wikipedia.org/wiki/Superior', 'https://www.reddit.com/r/iems/comments/1/x/'],
        daPesquisa: ['https://www.reddit.com/r/PUBATTLEGROUNDS/comments/2/y/'],
        dossie: [{ url: 'https://www.reddit.com/r/iems/comments/1/x/' }, { url: 'https://lista.mercadolivre.com.br/fone' }],
      });
      return [
        itemNaoExecutavel('Definir as plataformas de pesquisa relevantes') !== null || 'metodologia',
        itemNaoExecutavel('Contatar marcas de equipamento') !== null || 'ação impossível',
        itemNaoExecutavel('Pesquisar listas de equipamento dos profissionais de PUBG') === null || 'ação executável fica',
        !/CONVERSA ATÉ AQUI/.test(sis) && /PEDIDO ANTERIOR NESTA CONVERSA \(só contexto/.test(sis) && !/Resposta longa/.test(sis) || 'sem referência: conversa só como contexto de uma linha',
        /CONVERSA ATÉ AQUI/.test(sisRef) || 'com referência ("desses aí"): conversa completa',
        JSON.stringify(fontes) === JSON.stringify(['https://www.reddit.com/r/PUBATTLEGROUNDS/comments/2/y/', 'https://www.reddit.com/r/iems/comments/1/x/']) || `fontes: ${JSON.stringify(fontes)}`,
      ];
    },
  },
  {
    nome: 'etapa B: tabela com estrelas e preço que não estão no material — coluna de estrela sai, preço vira "sem dado" (14º teste real)',
    tipo: 'unidade',
    executar() {
      const t = '| Fone | Preço (R$) | Áudio | Melhor Uso |\n|---|---:|---:|---|\n| Arctis Nova Pro | 1.200-1.400 | ⭐⭐⭐⭐⭐ | Competitivo |\n| ROG Theta | 899 | ⭐⭐⭐⭐ | FPS |';
      const r = verificador.semDadoInventadoEmTabela(t, 'O ROG Theta custa R$ 899.');
      return [
        !/⭐/.test(r.texto) || r.texto,
        /\| Arctis Nova Pro \| sem dado \| Competitivo \|/.test(r.texto) || r.texto,
        /\| ROG Theta \| 899 \| FPS \|/.test(r.texto) || 'preço que está no material fica',
        r.removidas.length === 2 || JSON.stringify(r.removidas),
      ];
    },
  },

  /* ------------------------------ Etapa C ------------------------------ */
  {
    nome: 'etapa C: bateria da comunidade montada pelo código (IEM em inglês, subreddit do jogo e da categoria, fórum em pt) e nome canônico (loja fora, grafia da marca)',
    tipo: 'unidade',
    executar() {
      const b = m.bateriaDaComunidade({ objetivo: PEDIDO_14, maximo: 12 }).map((q) => q.consulta);
      const so = m.bateriaDaComunidade({ objetivo: PEDIDO_14, config: { fontesComunidade: ['reddit.com'] } }).map((q) => q.consulta);
      const c = m.canonizarNomes(['Thrutear Zero Red', 'Truthear Hexa', 'Linsoul Simgot EM6L'], 'Truthear Hexa... truthear zero');
      return [
        b[0] === 'site:reddit.com best IEM for PUBG' || b[0],
        b.includes('site:clubedohardware.com.br fone intra auricular pubg fps') && b.includes('site:forum.adrenaline.com.br fone intra auricular pubg fps') || JSON.stringify(b),
        b.includes('site:reddit.com r/PUBATTLEGROUNDS best IEM') && b.includes('site:reddit.com r/iems IEM FPS gaming') || JSON.stringify(b),
        !b.some((q) => /headset/i.test(q)) || 'intra-auricular não pode buscar "headset"',
        so.every((q) => q.startsWith('site:reddit.com')) || 'só as fontes dos Ajustes',
        m.bateriaDaComunidade({ objetivo: 'melhor liquidificador' }).length === 0 || 'categoria fora do dicionário usa a descoberta antiga',
        c.get('Thrutear Zero Red') === 'Truthear Zero Red' && c.get('Linsoul Simgot EM6L') === 'Simgot EM6L' || JSON.stringify([...c]),
      ];
    },
  },
  {
    nome: 'etapa C: extração por tópico — nome inventado sai, pergunta não recomenda, crítica vira crítica; livro de evidências com ID, trecho e fonte',
    tipo: 'unidade',
    async executar() {
      const e = {
        url: 'https://www.reddit.com/r/iems/comments/1/x/',
        bruto: 'TÓPICO DO REDDIT (r/iems): IEM recommendation for competitive FPS gaming\nPOST: which iem for pubg?\nCOMENTÁRIOS:\n- [30 votos] truthear hexa\n- [4 votos] the kz edx pro broke after a week, avoid\n- [2 votos] poderia me recomendar algo parecido com o Samson SR850?',
      };
      const livro = new Evidencias();
      const termos = m.termosDoUso(PEDIDO_14);
      const topicos = m.selecionarTopicos([e], { objetivo: PEDIDO_14, termos, maximo: 4 });
      const r = await m.extrairDaComunidade({ topicos, chamarModelo: async (p) => produtosFalsos(p), livro, termos });
      const hexa = livro.doProduto('Truthear Hexa')[0];
      return [
        topicos.length === 1 || 'tópico do uso selecionado',
        JSON.stringify(r.recomendados) === JSON.stringify(['Truthear Hexa']) || `recomendados: ${JSON.stringify(r.recomendados)}`,
        !livro.doProduto('Invented Z9').length || 'nome que não está em comentário nenhum entrou',
        !livro.doProduto('Samson SR850').length || 'pergunta não é evidência',
        livro.doProduto('KZ EDX Pro')[0]?.tipo === 'critica' || JSON.stringify(livro.doProduto('KZ EDX Pro')),
        hexa?.id === 'E0001' && hexa.votos === 30 && hexa.fonte === 'r/iems' && hexa.url === e.url && hexa.trecho === 'truthear hexa' && hexa.doUso || JSON.stringify(hexa),
        livro.resumoDaComunidade('Truthear Hexa').recomendacoes === 1 || 'resumo da comunidade',
      ];
    },
  },
  {
    nome: 'etapa C (ponta a ponta, 14º teste real): o 7B diz NENHUMA na chamada grande, mas a extração por tópico acha os IEMs da comunidade; headset fica fora; livro no registro',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'site:reddit.com best iem for pubg',
          mesmoHost: true,
          paginas: [
            TOPICO('IEM recommendation for competitive FPS gaming', 'Which IEM should I get for PUBG?', ['truthear hexa', 'Simgot EM6L, thank me later', 'the kz edx pro broke after a week, avoid']),
          ],
        },
        {
          contem: 'site:reddit.com iem for fps',
          mesmoHost: true,
          paginas: [TOPICO('Best earbuds for picking up footsteps in PUBG?', 'Looking for IEMs to hear footsteps', ['moondrop chu 2 for budget', 'Truthear Hexa here too, imaging is great for footsteps'])],
        },
        {
          contem: 'site:clubedohardware.com.br',
          mesmoHost: true,
          paginas: [TOPICO('Fone intra auricular para PUBG', 'Qual fone intra auricular vocês indicam pra PUBG?', ['Vai de Truthear Hexa, ouço os passos de longe.', 'o Samson SR850 já me havia sido recomendado, poderia me recomendar algum sem fio?'])],
        },
        {
          contem: 'descoberta fones pubg',
          paginas: [pagina('Os melhores headsets para jogos: o headset HyperX Cloud II lidera. Entre os fones intra, o KZ EDX Pro é o mais barato.'), pagina('Headset HyperX Cloud II para gamers, com microfone.')],
        },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'etapa C ponta a ponta',
          pedido: PEDIDO_14,
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, nivelRaciocinio: 'medio' },
          planoDePesquisa: PLANO_FONES,
          candidatosDePesquisa: 'NENHUMA',
          produtosDoTopico: produtosFalsos,
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const c = obtido.pesquisa.candidatos || {};
        const nomes = (c.lista || []).map((x) => x.nome);
        const ev = obtido.registro.pesquisaPlanejada?.evidencias || [];
        return [
          obtido.promptsProdutosDoTopico.length >= 3 || `extração por tópico: ${obtido.promptsProdutosDoTopico.length} chamadas`,
          nomes[0] === 'Truthear Hexa' || `recomendado em 3 tópicos deveria vir primeiro: ${nomes.join(' > ')}`,
          ['Simgot EM6L', 'Moondrop Chu 2'].every((n) => nomes.includes(n)) || `nomes da comunidade: ${nomes.join(', ')}`,
          !nomes.includes('Invented Z9') && !nomes.includes('Samson SR850') || `inventado/pergunta na lista: ${nomes.join(', ')}`,
          !nomes.includes('HyperX Cloud II') || `headset na lista de intra: ${nomes.join(', ')}`,
          (c.topicos || []).some((t) => t.nomes.some((n) => /Truthear Hexa \(recomendacao/.test(n))) || `registro por tópico: ${JSON.stringify(c.topicos)}`,
          ev.some((x) => /^E\d{4}$/.test(x.id) && x.produto === 'Truthear Hexa' && x.tipo === 'recomendacao' && x.url) || `livro no registro: ${JSON.stringify(ev.slice(0, 3))}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------------------ Etapa D ------------------------------ */
  {
    nome: 'etapa D: classificador de página — home, índice, subreddit, rede social, login, canal e agenda não são lidos; tópico, benchmark, ficha, loja e review são reconhecidos (URLs do 14º teste real)',
    tipo: 'unidade',
    executar() {
      const c = escopo.classificarPagina;
      const casos = [
        ['https://www.reddit.com/r/esports/', 'indice'],
        ['https://www.reddit.com/t/esports/', 'indice'],
        ['https://www.reddit.com/', 'indice'],
        ['https://www.reddit.com/r/PUBATTLEGROUNDS/comments/13oqqfi/headsets/', 'topico'],
        ['https://www.clubedohardware.com.br/', 'home'],
        ['https://www.clubedohardware.com.br/forums/forum/8-clube-do-hardware/', 'indice'],
        ['https://www.clubedohardware.com.br/forums/topic/1213288-fone-intra-auricular-para-jogos/', 'topico'],
        ['https://forum.adrenaline.com.br/threads/existe-fone-de-ouvido-sem-fio-sem-delay.694670/', 'topico'],
        ['https://forum.adrenaline.com.br/', 'home'],
        ['https://www.youtube.com/c/clubedohardware', 'canal'],
        ['https://www.youtube.com/watch?v=abc', 'video'],
        ['https://t.me/s/ClubeDoHardware', 'social'],
        ['https://www.instagram.com/p/DLgJ5ppsmhY/', 'social'],
        ['https://www.threads.com/login', 'social'],
        ['https://pubg.com/pt-br/main', 'home'],
        ['https://esports.op.gg/pubg/schedules?hl=pt_BR', 'agenda'],
        ['https://www.vlr.gg/', 'home'],
        ['https://www.terabyteshop.com.br/versus/rtx-5080-vs-rtx-5070-ti', 'benchmark'],
        ['https://thepcenthusiast.com/rtx-5070-ti-vs-rtx-5080-gpu-comparison-1440p-and-4k-benchmarks/', 'benchmark'],
        ['https://www.techpowerup.com/gpu-specs/geforce-rtx-5070-ti.c4243', 'ficha'],
        ['https://www.amazon.com.br/SteelSeries-Arctis-Headset-com-Fio/dp/B07SJHG1MJ', 'loja'],
        ['https://noobmobile.com.br/review-do-kz-edx-pro/', 'review'],
        ['https://blog.waaw.com.br/melhor-fone-para-jogos-fps/', 'artigo'],
        ['http://127.0.0.2:3000/p0', 'artigo'],
      ];
      return casos.map(([u, esperado]) => c(u) === esperado || `${u}: ${c(u)} (esperado ${esperado})`);
    },
  },
  {
    nome: 'etapa D: escopo do pedido — "PUBG de PC" exclui página de PUBG Mobile; pedido com produto nomeado exclui página que não o cita ("curso superior")',
    tipo: 'unidade',
    executar() {
      const pc = escopo.escopoDoPedido("Qual o fone de ouvido mais usado pelos profissionais 'e-sports' no pubg de pc ?");
      const mobile = escopo.escopoDoPedido('melhor fone para PUBG Mobile no celular');
      const rtx = escopo.escopoDoPedido('Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?', { entidades: serie.produtosDoPedido('Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?') });
      return [
        escopo.foraDoEscopo({ titulo: 'PUBG Mobile Audio EQ Guide: Master Footstep Detection', url: 'https://bittopup.com/pt/article/PUBG-Mobile-Audio-EQ-Guide', bruto: '...' }, pc) !== null || 'guia de PUBG Mobile num pedido de PC',
        escopo.foraDoEscopo({ titulo: 'Best headset for PUBG', url: 'https://siege.gg/pubg/best-headset-for-pubg', bruto: 'Pros in PUBG use the HyperX Cloud II. PUBG Mobile players too.' }, pc) === null || 'página de PUBG de PC que cita o Mobile uma vez fica',
        escopo.foraDoEscopo({ titulo: 'PUBG Mobile', url: 'https://x.com/a', bruto: 'PUBG Mobile' }, mobile) === null || 'quem pediu mobile não exclui mobile',
        escopo.foraDoEscopo({ titulo: 'Superior – Wikipédia', url: 'https://pt.wikipedia.org/wiki/Superior', bruto: 'Superior pode referir-se a: ensino superior, lago Superior...' }, rtx) !== null || '"Superior" não é página das RTX',
        escopo.foraDoEscopo({ titulo: 'RTX 5070 Ti vs RTX 5080', url: 'https://a.com/b', bruto: 'The RTX 5080 is 15% faster than the 5070 Ti at 4K.' }, rtx) === null || 'página das RTX fica',
      ];
    },
  },
  {
    nome: 'etapa D (ponta a ponta): leitura de PUBG Mobile num pedido de PUBG de PC não entra no dossiê nem na redação; o descarte vai pro registro',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'fone profissionais pubg',
          paginas: [
            '<html><head><title>PUBG Mobile Audio EQ Guide</title></head><body><article><p>PUBG Mobile players should use the EQ preset XYZ-MOBILE for footsteps. PUBG Mobile pros prefer earbuds. PUBG Mobile is different.</p></article></body></html>',
            pagina('No PUBG de PC, profissionais usam o headset HyperX Cloud II com frequência, segundo a lista de equipamentos.'),
          ],
        },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'etapa D escopo',
          pedido: 'Qual o fone de ouvido mais usado pelos profissionais de e-sports no PUBG de PC?',
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false },
          roteiro: [
            { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'fone profissionais pubg' } },
            { ferramenta: 'responder', argumentos: { foco: 'fone mais usado' } },
          ],
          redacao: 'Resposta de teste.',
        });
        return [
          !/XYZ-MOBILE/.test(obtido.promptRedacao) || 'página de PUBG Mobile chegou à redação',
          /HyperX Cloud II/.test(obtido.promptRedacao) || 'a página de PC deveria chegar',
          obtido.registro.descartes.some((d) => d.etapa === 'escopo' && /Mobile/.test(d.motivo)) || `descartes: ${JSON.stringify(obtido.registro.descartes)}`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------------------ Etapa E ------------------------------ */
  {
    nome: 'etapa E: perfis curados — intra pra PUBG pega o perfil de FPS (passos, palco, separação…); headset e placa de vídeo têm o deles; liquidificador não tem',
    tipo: 'unidade',
    executar() {
      const iem = perfis.perfilDoPedido(PEDIDO_14);
      const gpu = perfis.perfilDoPedido('Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?');
      const hs = perfis.perfilDoPedido('melhor headset para valorant');
      const custom = perfis.lerPerfis('## x\nquando: panela + arroz\n- a | alto | b | c\n- d | médio | e | f\n- g | baixo | h | i');
      return [
        iem?.nome === 'fone intra-auricular para FPS competitivo' || `perfil: ${iem?.nome}`,
        iem?.criterios[0]?.nome === 'passos e posicionamento' && /reage primeiro/.test(iem.criterios[0].porque) || JSON.stringify(iem?.criterios[0]),
        !iem.criterios.some((k) => /microfone|lat[eê]ncia/i.test(k.nome)) || 'perfil de intra pra FPS não tem microfone nem latência',
        gpu?.nome === 'placa de vídeo para jogos' && gpu.criterios[0].nome === 'FPS em jogos por resolução' || `gpu: ${gpu?.nome}`,
        hs?.nome === 'headset para FPS competitivo' || `headset: ${hs?.nome}`,
        perfis.perfilDoPedido('melhor liquidificador') === null || 'sem perfil',
        perfis.perfilDoPedido('panela para arroz', custom)?.nome === 'x' || 'o arquivo é editável: perfil novo funciona',
      ];
    },
  },
  {
    nome: 'etapa E: critérios que o pedido não sustenta saem (over-ear num intra, microfone sem pedir, latência de fone com fio com perfil); ficha que diz "headset" tira o finalista',
    tipo: 'unidade',
    executar() {
      const crit = [
        { nome: 'Baixa latência', termos: [] },
        { nome: 'Isolamento acústico passivo', termos: [] },
        { nome: 'Microfone integrado com cancelamento de ruído', termos: [] },
        { nome: 'Cabo over-ear firmes', termos: [] },
        { nome: 'preço', termos: [] },
      ];
      const comPerfil = m.filtrarCriteriosDoPedido(crit, PEDIDO_14, { perfil: { nome: 'x' } });
      const semPerfil = m.filtrarCriteriosDoPedido(crit, PEDIDO_14);
      const cat = m.categoriaDoPedido(PEDIDO_14);
      const ficha = (titulo, texto) => ({ titulo, bruto: texto });
      return [
        JSON.stringify(comPerfil.criterios.map((k) => k.nome)) === JSON.stringify(['Isolamento acústico passivo', 'preço']) || JSON.stringify(comPerfil.criterios.map((k) => k.nome)),
        semPerfil.criterios.some((k) => k.nome === 'Baixa latência') || 'sem perfil, a latência fica (a dedução do fone com fio continua)',
        m.fichaDeOutroTipo('SteelSeries Arctis 1', [ficha('Headset Gamer SteelSeries Arctis 1', 'Headset over-ear com microfone. Headset para PC e console.')], cat) === true || 'Arctis 1 é headset',
        m.fichaDeOutroTipo('KZ EDX Pro', [ficha('Fone de ouvido in-ear KZ EDX Pro', 'IEM com driver dinâmico de 10 mm. Fone intra auricular.')], cat) === false || 'KZ EDX Pro é intra',
        m.fichaDeOutroTipo('KZ EDX Pro', [], cat) === false || 'sem ficha não decide',
      ];
    },
  },
  {
    nome: 'etapa E: status da célula — 2 tópicos a favor = corroborado; 1 = fonte única; veredito negativo = contraditório; deduzido = indireto; vazio = sem dados',
    tipo: 'unidade',
    executar() {
      const st = m.statusDaCelula;
      return [
        st({ dominios: new Set(['reddit.com']), fontes: new Set(['reddit.com/r/iems/comments/1', 'reddit.com/r/iems/comments/2']), veredito: 'imaging preciso' }) === 'corroborado' || 'dois tópicos do Reddit são duas fontes',
        st({ dominios: new Set(['a.com']), fontes: new Set(['a.com']), veredito: 'bom palco' }) === 'fonte única' || 'fonte única',
        st({ dominios: new Set(['a.com']), fontes: new Set(['a.com']), veredito: 'palco estreito, ruim para passos' }) === 'contraditório' || 'negativo',
        st({ dominios: new Set(['a.com']), deduzido: true, veredito: 'com fio' }) === 'indireto' || 'deduzido',
        st({ dominios: new Set() }) === 'sem dados' || 'vazio',
      ];
    },
  },
  {
    nome: 'etapa E (ponta a ponta): com perfil, os critérios são os do perfil (sem busca de conhecimento), o plano da resposta traz o status de cada célula e o "porquê" do perfil',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'site:reddit.com best iem for pubg', mesmoHost: true, paginas: [TOPICO('IEM for competitive FPS gaming', 'Which IEM for PUBG?', ['truthear hexa, great imaging for footsteps', 'Simgot EM6L, thank me later'])] },
        { contem: 'site:reddit.com iem for fps', mesmoHost: true, paginas: [TOPICO('IEMs to hear footsteps', 'IEM for footsteps?', ['Truthear Hexa here too, imaging is great for footsteps'])] },
        { contem: 'descoberta fones pubg', paginas: [pagina('Fones intra para jogos: Truthear Hexa tem imaging preciso para passos.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'etapa E ponta a ponta',
          pedido: PEDIDO_14,
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, nivelRaciocinio: 'medio', perfisDeUso: true },
          planoDePesquisa: PLANO_FONES,
          cadeiaDoUso: 'PRODUTO: fone intra-auricular\nATIVIDADE: jogar PUBG no PC\nTIPO DE USO: jogo de tiro (FPS) competitivo\nO USO EXIGE:\n- ouvir passos | reagir\nCARACTERÍSTICAS TÉCNICAS:\n- microfone | falar | mic\n- sensibilidade | x | sensitivity\nBUSCAS DE CONHECIMENTO:\n- o que torna\n- what makes',
          candidatosDePesquisa: 'NENHUMA',
          produtosDoTopico: produtosFalsos,
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const criterios = (obtido.pesquisa.plano?.criterios || []).map((k) => k.nome);
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        return [
          criterios[0] === 'passos e posicionamento' && !criterios.some((k) => /microfone|sensibilidade/i.test(k)) || `critérios: ${JSON.stringify(criterios)}`,
          !srv.consultas.some((q) => /o que torna|what makes/.test(q)) || 'com perfil, a busca de conhecimento não roda',
          /- passos e posicionamento: ouvir de onde vem cada passo/.test(plano) || 'o porquê do perfil vai pro redator',
          /Truthear Hexa:[\s\S]*passos e posicionamento \[(corroborado|fonte única)/.test(plano) || `status da célula no plano: ${plano.slice(plano.indexOf('Truthear Hexa:'), plano.indexOf('Truthear Hexa:') + 500)}`,
          obtido.pesquisa.criterios?.perfil === 'fone intra-auricular para FPS competitivo' || 'perfil no registro',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------------------ Etapa G ------------------------------ */
  {
    nome: 'etapa G: roteador — "mais usado pelos profissionais" é dado de uso, "diferença de desempenho" é desempenho, "top 10" é recomendação; o resto fica no laço',
    tipo: 'unidade',
    executar() {
      const r = m.modoDaPesquisa;
      return [
        r("Qual o fone de ouvido mais usado pelos profissionais 'e-sports' no pubg de pc ?") === 'uso-profissional' || 'uso',
        r('qual mouse os pros de valorant usam?') === 'uso-profissional' || 'uso 2',
        r('Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?') === 'desempenho' || 'desempenho',
        r(PEDIDO_14) === 'recomendacao' || 'recomendação',
        r('como melhorar meu código') === null && r('melhor preço da RTX 5080') === null || 'fora do motor',
      ];
    },
  },
  {
    nome: 'etapa G: contagem por jogador distinto a partir de tabela de "pro settings" e página de jogador; coluna certa (headset, não mouse); "Cloud 2" = "Cloud II"; porcentagem declarada com a fonte',
    tipo: 'unidade',
    executar() {
      const eq = usoPro.equipamentoDoPedido("Qual o fone de ouvido mais usado pelos profissionais no pubg de pc");
      const tabela = '| Player | Team | Mouse | Headset |\n|---|---|---|---|\n| TGLTN | Soniqs | Logitech G Pro X Superlight | HyperX Cloud II |\n| Kickstart | NAVI | Zowie EC2 | Logitech G Pro X |\n| ibiza | Twisted | Razer Viper | HyperX Cloud 2 |';
      const a = usoPro.agregarUso([
        usoPro.extrairUsoProfissional({ texto: tabela, url: 'https://prosettings.net/pubg', coluna: eq.coluna }),
        usoPro.extrairUsoProfissional({ texto: 'Mouse: Zowie EC2\nHeadset: HyperX Cloud II', url: 'https://x.gg/tgltn', titulo: 'TGLTN PUBG Settings and Setup', coluna: eq.coluna }),
        usoPro.extrairUsoProfissional({ texto: 'About 30% of pros use the HyperX Cloud II headset.', url: 'https://y.com', coluna: eq.coluna }),
      ]);
      const bloco = usoPro.blocoDoUso(a, { equipamento: eq.nome, jogo: 'PUBG' });
      return [
        a.total === 3 || `TGLTN aparece em duas bases e conta uma vez: ${a.total}`,
        a.ranking[0]?.produto === 'HyperX Cloud II' && a.ranking[0].jogadores === 2 || JSON.stringify(a.ranking),
        !a.ranking.some((r) => /Zowie|Razer|Superlight/.test(r.produto)) || 'coluna de mouse entrou na contagem de fone',
        a.declarados[0]?.valores[0]?.valor === 30 || 'porcentagem declarada',
        /\| HyperX Cloud II \| 2 \| 66,7% \|/.test(bloco) && /RESSALVAS/.test(bloco) || bloco,
      ];
    },
  },
  {
    nome: 'etapa G (ponta a ponta, 14º teste real): a pergunta vai pro motor, busca bases de "pro settings", conta pelo código; sem lista, diz que não achou (sem tabela de preço/estrela)',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'pubg pro settings headset', paginas: ['<html><head><title>PUBG Pro Settings</title></head><body><article><table><tr><th>Player</th><th>Mouse</th><th>Headset</th></tr><tr><td>TGLTN</td><td>Zowie EC2</td><td>HyperX Cloud II</td></tr><tr><td>Kickstart</td><td>Logitech G Pro</td><td>HyperX Cloud II</td></tr><tr><td>Pio</td><td>Razer Viper</td><td>Logitech G Pro X</td></tr></table><p>Lista de equipamento dos jogadores profissionais de PUBG, atualizada.</p></article></body></html>'] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'etapa G ponta a ponta',
          pedido: "Qual o fone de ouvido mais usado pelos profissionais 'e-sports' no pubg de pc ?",
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true },
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'uso' } }],
          redacao: 'Resposta de teste.',
        });
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        const u = obtido.pesquisa.uso || {};
        return [
          srv.consultas.includes('pubg pro settings headset') || `buscas: ${srv.consultas.join(' | ')}`,
          !srv.consultas.some((q) => /clube do hardware|adrenal/.test(q)) || 'buscou fórum da pergunta anterior',
          obtido.chamadasPlanoDePesquisa === 0 || 'modo uso não chama o plano do 7B',
          /USO ENTRE PROFISSIONAIS/.test(plano) && /\| HyperX Cloud II \| 2 \| 66,7% \|/.test(plano) || `plano: ${plano.slice(0, 400)}`,
          u.total === 3 || `contagem: ${JSON.stringify(u)}`,
          !/⭐|R\$/.test(plano) || 'preço/estrela no plano',
          typeof u.total === 'number' || 'evento de uso no registro',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------------------ Etapa H ------------------------------ */
  {
    nome: 'etapa H: frases do modelo conferidas — número inventado, frase de outro produto e placeholder são descartados (vira a frase-padrão da evidência)',
    tipo: 'unidade',
    executar() {
      const f = compositor.lerFrases(
        'DIRETA: Recomendo o Truthear Hexa pelo imaging que a comunidade elogia.\nTruthear Hexa: Custa R$ 199 e é o melhor.\nSimgot EM6L: O Truthear Hexa é melhor que ele.\nKZ EDX Pro: <1 frase>\nC1: o imaging é ótimo para passos',
        { produtos: ['Truthear Hexa', 'Simgot EM6L', 'KZ EDX Pro'], numerosPermitidos: 'recomendado em 3 tópicos' }
      );
      return [
        /Truthear Hexa pelo imaging/.test(f.get('DIRETA') || '') || 'frase boa fica',
        !f.has('TRUTHEAR HEXA') || 'número que não está nos fatos (R$ 199) derruba a frase',
        !f.has('SIMGOT EM6L') || 'frase de um produto falando de outro sai',
        !f.has('KZ EDX PRO') || 'placeholder "<1 frase>" sai',
        f.get('C1') === 'o imaging é ótimo para passos' || 'tradução',
      ];
    },
  },
  {
    nome: 'etapa H (ponta a ponta): recomendação montada pelo código — resposta direta, "Como escolhi" com o porquê, um bloco por opção com citação traduzida e status, tabela, o que não foi confirmado',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'site:reddit.com best iem for pubg', mesmoHost: true, paginas: [TOPICO('IEM for competitive FPS gaming', 'Which IEM for PUBG?', ['truthear hexa, great imaging for footsteps', 'Simgot EM6L, thank me later'])] },
        { contem: 'site:reddit.com iem for fps', mesmoHost: true, paginas: [TOPICO('IEMs to hear footsteps', 'IEM for footsteps?', ['Truthear Hexa here too, imaging is great for footsteps'])] },
        { contem: 'descoberta fones pubg', paginas: [pagina('Fones intra para jogos: Truthear Hexa tem imaging preciso para passos.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'etapa H ponta a ponta',
          pedido: PEDIDO_14,
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, nivelRaciocinio: 'medio', perfisDeUso: true, respostaMontada: true },
          planoDePesquisa: PLANO_FONES,
          candidatosDePesquisa: 'NENHUMA',
          produtosDoTopico: produtosFalsos,
          frasesDaResposta: 'DIRETA: Recomendo o Truthear Hexa: a comunidade elogia o imaging para ouvir passos.\nTruthear Hexa: O imaging preciso é o que mais aparece nos tópicos.\nC1: truthear hexa, ótimo imaging para passos',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'REDATOR LIVRE — não deveria aparecer',
        });
        const r = obtido.resposta;
        return [
          obtido.promptsFrases.length === 1 || `uma chamada de frases: ${obtido.promptsFrases.length}`,
          !/REDATOR LIVRE/.test(r) || 'o redator livre não escreve a resposta montada',
          /### Resposta direta\nRecomendo o Truthear Hexa/.test(r) || r.slice(0, 300),
          /### Como escolhi[^\n]*\n- \*\*passos e posicionamento\*\* — ouvir de onde vem cada passo/.test(r) || 'como escolhi',
          /#### 1\. Truthear Hexa\nO imaging preciso/.test(r) || `bloco do produto: ${r.slice(r.indexOf('#### 1.'), r.indexOf('#### 1.') + 300)}`,
          /> "truthear hexa, ótimo imaging para passos" — [^\n]*\(tradução do inglês\)/.test(r) || 'citação traduzida com a fonte',
          // 10/10: "confirmado" virou "comentado" (a matriz mede menção, não elogio)
          /\*\*Nos critérios:\*\* passos e posicionamento: comentado por (2\+ fontes|1 fonte)/.test(r) || 'status por critério',
          /### Tabela\n\| Critério \|/.test(r) || 'tabela',
          /### O que não foi confirmado/.test(r) || 'o que não foi confirmado',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'etapa H (ponta a ponta): comparação de desempenho montada — % em jogos do código na resposta direta, jogos medidos, ficha, veredito do modelo',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'vs rtx 5080 benchmark', paginas: [pagina('Em Cyberpunk 2077 a 1440p, a RTX 5080 faz 120 FPS e a RTX 5070 Ti faz 104 FPS. Em Cyberpunk 2077 a 4K, a RTX 5080 faz 68 FPS e a RTX 5070 Ti faz 58 FPS.')] },
        { contem: 'rtx 5070 ti especificacoes', paginas: [pagina('RTX 5070 Ti: 8960 CUDA cores, 16 GB GDDR7, 256-bit, TDP 300 W.')] },
        { contem: 'rtx 5080 especificacoes', paginas: [pagina('RTX 5080: 10752 CUDA cores, 16 GB GDDR7, 256-bit, TDP 360 W.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'etapa H desempenho',
          pedido: 'Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?',
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, respostaMontada: true },
          frasesDaResposta: 'PRATICA: Num jogo que roda a 60 FPS na 5070 Ti, a 5080 chega perto de 70.\nVEREDITO: A RTX 5070 Ti vale para quem quer o melhor custo; a RTX 5080 para quem joga em 4K e quer cada quadro.',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'comparação' } }],
          redacao: 'REDATOR LIVRE',
        });
        const r = obtido.resposta;
        return [
          /Em jogos, a \*\*RTX 5080\*\* é \*\*16,3% mais rápida\*\* que a \*\*RTX 5070 Ti\*\*/.test(r) || r.slice(0, 400),
          !/60 FPS na 5070 Ti/.test(r) || 'frase com número que não está nos dados (60, 70) é descartada',
          /### Jogos medidos\n\| Jogo \|/.test(r) || 'tabela de jogos',
          /### Ficha técnica\n\| Item \|/.test(r) || 'ficha',
          /### Veredito\nA RTX 5070 Ti vale para quem quer o melhor custo/.test(r) || 'veredito do modelo',
          !/REDATOR LIVRE/.test(r) || 'redator livre',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------------------ Etapa I ------------------------------ */
  {
    nome: 'etapa I: afirmação → evidência — valor certo na condição certa é sustentado; valor de 4K dito como 1440p, ou de outro produto, é contexto errado; % calculada pelo código conta; número sem fonte é sem evidência',
    tipo: 'unidade',
    executar() {
      const l = new Evidencias();
      l.adicionar({ tipo: 'benchmark', produtoA: 'RTX 5070 Ti', produtoB: 'RTX 5080', valor: 98, valorB: 113, unidade: 'fps', condicoes: { jogo: 'Cyberpunk 2077', resolucao: '4K', percentual: 15.3 }, url: 'u', trecho: 'x' });
      l.adicionar({ tipo: 'benchmark', produtoA: 'RTX 5070 Ti', produtoB: 'RTX 5080', valor: 104, valorB: 120, unidade: 'fps', condicoes: { jogo: 'Cyberpunk 2077', resolucao: '1440p', percentual: 15.4 }, url: 'u', trecho: 'y' });
      const r = afirmacoes.verificarAfirmacoes(
        'A RTX 5080 faz 113 FPS em 1440p. A RTX 5080 faz 120 FPS em 1440p. A RTX 5070 Ti faz 113 FPS em 4K. A RTX 5080 é 16,3% mais rápida que a RTX 5070 Ti. A RTX 5080 é 40% mais rápida.\n| Cyberpunk | 1440p | 999 | 999 |',
        l,
        [{ valor: 16.3, unidade: '%' }]
      );
      const st = r.map((x) => x.status);
      return [
        JSON.stringify(st) === JSON.stringify(['contexto-errado', 'sustentada', 'contexto-errado', 'sustentada', 'sem-evidencia']) || JSON.stringify(r.map((x) => [x.afirmacao, x.status])),
        /4K, não de 1440p/.test(r[0].motivo || '') || r[0].motivo,
        r[1].evidencia === 'E0002' || 'a afirmação aponta o ID da evidência',
        !r.some((x) => /999/.test(x.afirmacao)) || 'linha de tabela (montada pelo código) não é conferida',
      ];
    },
  },
  {
    nome: 'etapa I: a matriz é uma visão do livro — a célula sai das avaliações gravadas, com status e IDs',
    tipo: 'unidade',
    executar() {
      const l = new Evidencias();
      l.adicionar({ tipo: 'avaliacao', produto: 'Truthear Hexa', criterio: 'palco sonoro', valor: 'corroborado', trecho: 'palco amplo', fonte: 'r/iems' });
      const c = l.celula('Truthear Hexa', 'palco sonoro');
      return [c?.veredito === 'palco amplo' && c.status === 'corroborado' && c.ids[0] === 'E0001' || JSON.stringify(c), l.celula('Truthear Hexa', 'isolamento') === null || 'célula sem avaliação'];
    },
  },
  {
    nome: 'etapa I (ponta a ponta): redator livre que diz "68 FPS em 1440p" (o 68 é de 4K) é pego no contexto errado, reescreve, e o registro guarda afirmação → evidência',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'vs rtx 5080 benchmark', paginas: [pagina('Em Cyberpunk 2077 a 1440p, a RTX 5080 faz 120 FPS e a RTX 5070 Ti faz 104 FPS. Em Cyberpunk 2077 a 4K, a RTX 5080 faz 68 FPS e a RTX 5070 Ti faz 58 FPS.')] },
      ]);
      if (!srv) return [];
      try {
        let n = 0;
        const obtido = await executarCasoAgente({
          nome: 'etapa I ponta a ponta',
          pedido: 'Qual é a diferença de desempenho entre a RTX 5070 TI e a RTX 5080 ?',
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true, respostaMontada: false },
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'comparação' } }],
          redacao: () => ((n += 1) === 1 ? 'A RTX 5080 faz 68 FPS em 1440p no Cyberpunk 2077, contra 104 FPS da RTX 5070 Ti.' : 'A RTX 5080 faz 120 FPS em 1440p no Cyberpunk 2077, contra 104 FPS da RTX 5070 Ti.'),
        });
        const af = obtido.registro.afirmacoes || [];
        return [
          af.some((a) => a.status === 'contexto-errado' && a.valor === 68) || `afirmações: ${JSON.stringify(af)}`,
          obtido.chamadasRedacao >= 2 || `deveria reescrever: ${obtido.chamadasRedacao}`,
          /CONTEXTO ERRADO/.test(obtido.promptRedacao) || 'a instrução de correção fala do contexto',
          /120 FPS em 1440p/.test(obtido.resposta) || obtido.resposta,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },

  /* ------------------- revisão independente (achados reais) ------------------- */
  {
    nome: 'revisão: preço/medida no pedido não vira produto obrigatório; "In Ear Monitor Headphones" é IEM; mouse não vira jogador; modelo parecido não empresta evidência; fórum sem URL amigável é tópico',
    tipo: 'unidade',
    executar() {
      const ent = (o) => escopo.escopoDoPedido(o, { entidades: serie.produtosDoPedido(o) }).entidades;
      const cat = m.categoriaDoPedido(PEDIDO_14);
      const eq = usoPro.equipamentoDoPedido('fone mais usado pelos pros de pubg de pc');
      const tabela = '| Player | Team | Mouse | Headset |\n|---|---|---|---|\n| TGLTN | Soniqs | Logitech G Pro X Superlight | HyperX Cloud II |\n| Kickstart | Oxygen | Logitech G Pro Wireless | Audio-Technica ATH-M50x |\n| hwinn | FaZe | Zowie EC2 | HyperX Cloud II |';
      const u = usoPro.agregarUso([usoPro.extrairUsoProfissional({ texto: tabela, url: 'u', coluna: eq.coluna })]);
      const l = new Evidencias();
      l.adicionar({ tipo: 'avaliacao', produto: 'KZ ZSN Pro X', criterio: 'palco sonoro', valor: 'fonte única', trecho: 'palco do X' });
      return [
        ent('melhor fone até R$ 300').length === 0 && ent('mouse 60g').length === 0 && ent('monitor 27 polegadas 1440p').length === 0 || 'preço/medida virou produto',
        JSON.stringify(ent('diferença entre RTX 5070 Ti e RTX 5080')) === JSON.stringify(['RTX 5070 Ti', 'RTX 5080']) || 'produto de verdade fica',
        m.fichaDeOutroTipo('KZ ZSN Pro X', [{ titulo: 'KZ ZSN Pro X In Ear Monitor Headphones, HiFi Stereo Headphones Wired', bruto: 'KZ ZSN Pro X In Ear Monitor Headphones.' }], cat) === false || 'IEM de vitrine virou headset',
        u.total === 3 && !u.ranking.some((r) => /Zowie|Superlight|Wireless$/.test(r.produto) && r.exemplos.some((x) => /Logitech|Zowie/.test(x))) || `contagem: ${JSON.stringify(u.ranking)}`,
        l.celula('KZ ZSN Pro', 'palco sonoro') === null || 'ZSN Pro pegou o veredito do ZSN Pro X',
        escopo.classificarPagina('https://forum.exemplo.com.br/index.php?threads/fone-pubg.123/') === 'topico' && escopo.classificarPagina('https://forum.y.com/index.php?topic=123.0') === 'topico' || 'fórum sem URL amigável',
        escopo.classificarPagina('https://site.com/category/reviews/moondrop-chu-2-review') !== 'indice' && escopo.classificarPagina('https://www.rtings.com/pc') !== 'home' || 'review em categoria / caminho de 2 letras',
      ];
    },
  },
  {
    nome: 'revisão: celular não entra no modo de desempenho de GPU; página de PUBG de PC com menu citando "PUBG Mobile" fica; seguimento curto ("pode resumir?") mantém a conversa; "Pesquisar onde comprar" é executável',
    tipo: 'unidade',
    executar() {
      const cmp = require('../../src/agent/comparativo-de-desempenho');
      const pc = escopo.escopoDoPedido('fone mais usado pelos pros no pubg de pc');
      const c = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }];
      return [
        !cmp.ehPedidoDeDesempenho('qual o melhor celular entre iPhone 15 e Galaxy S24?') && cmp.ehPedidoDeDesempenho('5070 Ti ou 5080, qual é mais rápida?') || 'modo de desempenho',
        escopo.foraDoEscopo({ titulo: 'TGLTN PUBG settings', url: 'https://prosettings.net/players/tgltn', bruto: 'Games: PUBG, PUBG Mobile, CS2. PUBG Mobile. PUBG Mobile pros. TGLTN PUBG settings. PUBG PUBG PUBG pro. PUBG sens.' }, pc) === null || 'página de PC saiu',
        ['pode resumir?', 'explica melhor', 'qual o mais barato?', 'compara os dois', 'Sim'].every((o) => prompts.referenciaConversa(o, c)) || 'seguimento perdeu a conversa',
        itemNaoExecutavel('Pesquisar onde comprar o KZ EDX Pro mais barato') === null && itemNaoExecutavel('Comprar o fone') !== null || 'âncora da ação impossível',
        compositor.lerFrases('**DIRETA:** **Recomendo o Hexa.', {}).get('DIRETA') === 'Recomendo o Hexa.' || 'asterisco no começo da frase',
      ];
    },
  },
];