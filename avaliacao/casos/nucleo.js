'use strict';

/**
 * Núcleo de pesquisa (15/10, src/agent/nucleo): entender → o modelo pesquisa
 * com ferramentas → uma escrita com fontes numeradas. Modelo e rede são dublês.
 */

const nucleo = require('../../src/agent/nucleo');
const { pedacos, ordenar } = require('../../src/agent/nucleo/ranking');

const PAGINA = `${'Introdução sobre fones em geral, sem nome de modelo nenhum aqui. '.repeat(20)}\n\nO Dunu Titan S tem driver dinâmico de 11 mm e impedância de 32 ohms. O som é neutro, com grave levemente elevado.\n\n${'Rodapé, newsletter e links. '.repeat(150)}`;

/** Modelo falso: 1ª chamada é o entendimento (json); depois segue o roteiro de ferramentas. */
function modeloFalso({ entendimento = { precisa_buscar: true, pergunta: 'O que é o fone Dunu Titan S?' }, roteiro = [], texto = 'O Dunu Titan S é um fone intra-auricular com driver de 11 mm [1].' } = {}) {
  const chamadas = [];
  const escritas = [];
  let passo = 0;
  return {
    chamadas,
    escritas,
    chamar: async (messages, opcoes = {}) => {
      chamadas.push({ messages, opcoes });
      if (opcoes.json) return { content: typeof entendimento === 'string' ? entendimento : JSON.stringify(entendimento), chamadas: [] };
      const r = roteiro[passo++] || { pronto: true };
      if (r.texto) return { content: r.texto, chamadas: [] };
      if (r.pronto) return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
      return { content: '', chamadas: r.ferramentas.map(([name, args]) => ({ function: { name, arguments: args } })) };
    },
    escrever: async (messages, onToken) => {
      escritas.push(messages);
      onToken(texto);
      return texto;
    },
  };
}

const RESULTADOS = {
  'dunu titan s review': [
    { titulo: 'Dunu Titan S review', url: 'https://headphonesty.com/titan-s', resumo: 'Review completo do Dunu Titan S, fone intra-auricular.' },
    { titulo: 'Receita de bolo', url: 'https://bolo.com/x', resumo: 'Como fazer bolo de cenoura.' },
  ],
};

module.exports = [
  {
    nome: 'núcleo: seleção de trechos — a palavra exata acha o modelo ("Dunu Titan S") no meio da página; corte em pedaços com sobreposição; quase iguais saem',
    tipo: 'unidade',
    async executar() {
      const p = pedacos(PAGINA, { tamanho: 400, sobra: 50 });
      const melhores = await ordenar('Dunu Titan S driver', p.map((texto) => ({ texto })), { maximo: 2 });
      const iguais = await ordenar('fone', [{ texto: 'O fone é bom.' }, { texto: 'O fone é bom.' }, { texto: 'Outro texto sobre fone.' }]);
      return [
        p.length >= 3 || `pedaços: ${p.length}`,
        /Dunu Titan S tem driver/.test(melhores[0]?.texto) || `melhor trecho: ${String(melhores[0]?.texto).slice(0, 80)}`,
        iguais.length === 2 || 'trecho repetido sai',
      ];
    },
  },
  {
    nome: 'núcleo: ponta a ponta — entende, o modelo busca e lê com foco, chama pronto; a escrita recebe as fontes numeradas e só os trechos certos da página; a fonte citada fica na lista',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({
        roteiro: [{ ferramentas: [['buscar_na_web', { buscas: ['dunu titan s review'] }]] }, { ferramentas: [['ler_pagina', { fonte: 1, foco: 'driver e som' }]] }, { pronto: true }],
      });
      const eventos = [];
      const buscas = [];
      const r = await nucleo.responder({
        pergunta: 'fone de ouvido dunu titan s',
        deps: {
          chamar: m.chamar,
          escrever: m.escrever,
          buscar: async (q) => (buscas.push(q), RESULTADOS[q] || []),
          lerPagina: async () => ({ texto: PAGINA, titulo: 'Dunu Titan S review', via: 'http' }),
          emit: (e, d) => eventos.push([e, d]),
        },
        hoje: '15/10/2026',
      });
      const sistema = m.escritas[0][0].content;
      return [
        buscas.join() === 'dunu titan s review' || `buscas: ${buscas}`,
        m.chamadas[1].opcoes.tools?.some((t) => t.function.name === 'buscar_na_web') || 'o pesquisador recebe as ferramentas nativas',
        /Pergunta do usuário: O que é o fone Dunu Titan S\?/.test(m.chamadas[1].messages[1].content) || 'o pesquisador recebe a pergunta reescrita pelo entendimento',
        /<fonte n="1"[^>]*site="headphonesty\.com">/.test(sistema) && /driver dinâmico de 11 mm/.test(sistema) || `fonte na escrita: ${sistema.slice(-500)}`,
        (sistema.match(/Rodapé, newsletter/g) || []).length < 40 || 'só os trechos escolhidos da página vão para a escrita (o rodapé de 150 linhas fica de fora)',
        r.fontes.length === 1 && r.fontes[0].url === 'https://headphonesty.com/titan-s' || `fontes: ${JSON.stringify(r.fontes)}`,
        eventos.some(([e, d]) => e === 'fonte' && d.tipo === 'leitura') && eventos.some(([e]) => e === 'redigindo') || 'eventos do painel de atividade',
        r.texto.startsWith('O Dunu Titan S é um fone') || r.texto,
      ];
    },
  },
  {
    nome: 'núcleo: modelo que não chama ferramenta na 1ª rodada — o código busca a própria pergunta (Open WebUI) e o modelo continua; "precisa_buscar: false" responde sem pesquisa; entendimento ilegível busca',
    tipo: 'unidade',
    async executar() {
      const semFerramenta = modeloFalso({ roteiro: [{ texto: 'vou responder de memória' }, { pronto: true }] });
      const buscas = [];
      const deps = (m) => ({ chamar: m.chamar, escrever: m.escrever, buscar: async (q) => (buscas.push(q), [{ titulo: 't', url: 'https://a.com/x', resumo: 'algo sobre o tema' }]), lerPagina: async () => ({}) });
      await nucleo.responder({ pergunta: 'o que é o fone Dunu Titan S?', deps: deps(semFerramenta) });
      const conversaFiada = modeloFalso({ entendimento: { precisa_buscar: false, pergunta: 'obrigado!' }, texto: 'De nada!' });
      const semBusca = await nucleo.responder({ pergunta: 'obrigado!', deps: deps(conversaFiada) });
      const quebrado = nucleo.lerEntendimento('não sei responder em JSON', 'pergunta original');
      return [
        buscas[0] === 'O que é o fone Dunu Titan S?' || `busca da própria pergunta: ${buscas}`,
        // 29/10: "obrigado!" é conversa que o código reconhece — nem o entendimento é chamado, só a escrita
        semBusca.buscou === false && semBusca.fontes.length === 0 && conversaFiada.chamadas.length === 0 || 'sem busca: só a escrita',
        !/<fontes>/.test(conversaFiada.escritas[0][0].content) || 'sem fontes, a escrita não recebe bloco de fontes',
        quebrado.precisaBuscar === true && quebrado.pergunta === 'pergunta original' || 'JSON quebrado: busca a pergunta como veio',
      ];
    },
  },
  {
    nome: 'núcleo: limite de rodadas por modo (rápido 2, normal 6, profundo 12); "ler_pagina" de fonte inexistente não quebra',
    tipo: 'unidade',
    async executar() {
      const sempreBusca = { chamar: async (msgs, o) => (o.json ? { content: '{"precisa_buscar": true, "pergunta": "x"}' } : { content: '', chamadas: [{ function: { name: 'buscar_na_web', arguments: { buscas: [`q${Math.random()}`] } } }, { function: { name: 'ler_pagina', arguments: { fonte: 99, foco: 'x' } } }] }), buscar: async () => [], lerPagina: async () => ({}) };
      const rodadas = async (modo) => {
        let n = 0;
        await nucleo.pesquisar({ pergunta: 'x', modo, deps: { ...sempreBusca, emit: (e) => { if (e === 'iteracao') n += 1; } }, hoje: 'hoje' });
        return n;
      };
      return [(await rodadas('rapido')) === 2 || 'rápido', (await rodadas('normal')) === 6 || 'normal', (await rodadas('profundo')) === 12 || 'profundo'];
    },
  },
  {
    nome: 'núcleo: conferência de anos (medição de 15/10: Santos Dumont "1873–1933", a fonte dizia 1932) — ano sem fonte ganha ⚠ e aviso no fim; ano das fontes, da pergunta, de hoje e de link não é marcado',
    tipo: 'unidade',
    executar() {
      const { conferirAnos } = nucleo;
      const r = conferirAnos('Santos Dumont (1873–1933) voou o 14-Bis em 1906 [1]. Veja https://site.com/2019/x. Em 2026 ainda é lembrado.', { material: 'nasceu em 1873, morreu em 1932; o 14-Bis voou em 1906', pergunta: 'quem foi santos dumont', hoje: '15/10/2026' });
      const limpo = conferirAnos('O 14-Bis voou em 1906 [1].', { material: 'voo de 1906' });
      return [
        /1873–1933 ⚠\)/.test(r.texto) && r.faltam.join() === '1933' || `marcação: ${r.texto}`,
        /\*⚠ Este ano não aparece nas fontes lidas: 1933\. Vale conferir\.\*$/.test(r.texto) || 'aviso no fim',
        /\/2019\/x/.test(r.texto) && !/2019 ⚠/.test(r.texto) && !/2026 ⚠/.test(r.texto) && !/1906 ⚠/.test(r.texto) || 'link, ano de hoje e ano da fonte não são marcados',
        limpo.texto === 'O 14-Bis voou em 1906 [1].' && limpo.faltam.length === 0 || 'tudo conferido: texto intacto',
      ];
    },
  },
  {
    nome: 'núcleo (15/10, pedido do Davi): pedido de PRODUTO — o pesquisador recebe buscar_na_comunidade; se não usar, o código busca na comunidade e lê 2 tópicos antes da escrita; a escrita pede os cartões "#### N. Nome". Pedido geral não muda',
    tipo: 'unidade',
    async executar() {
      const deps = (m, registro) => ({
        chamar: m.chamar,
        escrever: m.escrever,
        buscar: async (q) => (registro.web.push(q), [{ titulo: 'Loja', url: 'https://loja.com/titan', resumo: 'Dunu Titan S por R$ 450' }]),
        buscarNaComunidade: async (q) => (registro.comunidade.push(q), [
          { titulo: 'Titan S vale a pena?', url: 'https://www.reddit.com/r/iems/comments/a1/titan', resumo: 'tópico sobre o Dunu Titan S' },
          { titulo: 'Dunu Titan S impressões', url: 'https://www.clubedohardware.com.br/forums/topic/1/', resumo: 'impressões do Dunu Titan S' },
        ]),
        lerPagina: async (url) => (registro.lidas.push(url), { texto: `Comprei o Dunu Titan S e o palco é amplo, mas o grave é contido. ${url}` }),
      });
      // o modelo só usa a busca comum e chama pronto: a garantia do código entra
      const produto = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, pergunta: 'fone dunu titan s' }, roteiro: [{ ferramentas: [['buscar_na_web', { buscas: ['dunu titan s'] }]] }, { pronto: true }] });
      const reg = { web: [], comunidade: [], lidas: [] };
      const r = await nucleo.responder({ pergunta: 'fone dunu titan s', deps: deps(produto, reg) });
      const ferramentas = produto.chamadas[1].opcoes.tools.map((t) => t.function.name);
      const sistemaDaPesquisa = produto.chamadas[1].messages[0].content;
      const sistemaDaEscrita = produto.escritas[0][0].content;
      // pedido geral: nada de comunidade nem de cartões
      const geral = modeloFalso({ entendimento: { precisa_buscar: true, produto: false, pergunta: 'quem foi santos dumont' }, roteiro: [{ ferramentas: [['buscar_na_web', { buscas: ['santos dumont'] }]] }, { pronto: true }] });
      const reg2 = { web: [], comunidade: [], lidas: [] };
      await nucleo.responder({ pergunta: 'quem foi santos dumont', deps: deps(geral, reg2) });
      return [
        ferramentas[0] === 'buscar_na_comunidade' || `ferramentas do produto: ${ferramentas}`,
        /use buscar_na_comunidade pelo menos uma vez/.test(sistemaDaPesquisa) || 'o pesquisador é instruído a usar a comunidade',
        reg.comunidade.join() === 'fone dunu titan s' || `garantia: busca na comunidade feita pelo código: ${reg.comunidade}`,
        reg.lidas.filter((u) => /reddit|clubedohardware/.test(u)).length === 2 || `garantia: 2 tópicos lidos: ${reg.lidas}`,
        /comunidade/.test(sistemaDaEscrita) && /#### 1\. Marca Modelo/.test(sistemaDaEscrita) && /\*\*Na comunidade:\*\*/.test(sistemaDaEscrita) || 'a escrita pede os cartões',
        r.produto === true || 'o resultado diz que é produto (o agente põe as fotos nos cartões)',
        !geral.chamadas[1].opcoes.tools.some((t) => t.function.name === 'buscar_na_comunidade') && reg2.comunidade.length === 0 || 'pedido geral: sem comunidade',
        !/#### 1\. Marca Modelo/.test(geral.escritas[0][0].content) || 'pedido geral: sem formato de cartão',
      ];
    },
  },
  {
    nome: 'núcleo (15/10): profundidade — "pronto" antes do mínimo de buscas recebe "ainda é cedo"; teto de páginas lidas; automático manda produto para o profundo e o resto para o normal; "Resposta" muda a instrução da escrita; o entendimento traz os assuntos para as imagens',
    tipo: 'unidade',
    async executar() {
      const roteiro = (n) => Array.from({ length: n }, (_, i) => ({ ferramentas: [['buscar_na_web', { buscas: [`b${i}`] }], ['pronto', {}]] }));
      const rodar = async ({ modo, entendimento, leituras = 0, tamanho }) => {
        const r = [{ ferramentas: [['buscar_na_web', { buscas: ['b0'] }], ...Array.from({ length: leituras }, (_, i) => ['ler_pagina', { fonte: i + 1, foco: 'x' }]), ['pronto', {}]] }, ...roteiro(11)];
        const m = modeloFalso({ entendimento, roteiro: r });
        const eventos = [];
        let n = 0;
        const res = await nucleo.responder({
          pergunta: entendimento?.pergunta || 'p',
          modo,
          tamanho,
          deps: {
            chamar: m.chamar,
            escrever: m.escrever,
            buscar: async (q) => Array.from({ length: 12 }, (_, i) => ({ titulo: `${q}-${i}`, url: `https://s${n++}.com/x`, resumo: 'texto' })),
            lerPagina: async () => ({ texto: 'conteúdo da página '.repeat(30) }),
            emit: (e, d) => eventos.push([e, d]),
          },
        });
        return { m, eventos, res };
      };
      const conta = (ev, nome) => ev.filter(([e, d]) => e === 'ferramenta' && d.nome === nome).length;
      const normal = await rodar({ modo: 'normal', entendimento: { precisa_buscar: true, produto: false, assuntos: ['Nikola Tesla'], pergunta: 'quem foi tesla' } });
      const profundoAuto = await rodar({ modo: 'automatico', entendimento: { precisa_buscar: true, produto: true, assuntos: ['Dunu Titan S'], pergunta: 'dunu titan s' } });
      const muitasLeituras = await rodar({ modo: 'rapido', entendimento: { precisa_buscar: true, produto: false, pergunta: 'x' }, leituras: 4 });
      const detalhada = await rodar({ modo: 'rapido', entendimento: { precisa_buscar: true, produto: false, pergunta: 'x' }, tamanho: 'detalhada' });
      const pedidoAinda = normal.m.chamadas.some((c) => c.messages.some((x) => /Ainda é cedo para parar: foram 1 busca/.test(x.content || '')));
      return [
        // 2 buscas do mínimo + 1 na rodada do pedido de leitura (Fase 2), que o roteiro gasta buscando
        conta(normal.eventos, 'buscar_na_web') === 3 && pedidoAinda || `normal: mínimo de 2 buscas (${conta(normal.eventos, 'buscar_na_web')}), com o "ainda é cedo"`,
        profundoAuto.res.modo === 'profundo' && conta(profundoAuto.eventos, 'buscar_na_web') === 6 || `automático + produto = profundo com 5 buscas: ${profundoAuto.res.modo} / ${conta(profundoAuto.eventos, 'buscar_na_web')}`,
        normal.res.modo === 'normal' || 'modo pedido é respeitado',
        conta(muitasLeituras.eventos, 'ler_pagina') === 2 || `rápido lê no máximo 2 páginas: ${conta(muitasLeituras.eventos, 'ler_pagina')}`,
        /RESPOSTA DETALHADA/.test(detalhada.m.escritas[0][0].content) && !/RESPOSTA DETALHADA/.test(normal.m.escritas[0][0].content) || 'o ajuste "Resposta" chega à escrita',
        normal.res.assuntos.join() === 'Nikola Tesla' && profundoAuto.res.assuntos.join() === 'Dunu Titan S' || `assuntos: ${normal.res.assuntos} / ${profundoAuto.res.assuntos}`,
        normal.eventos.some(([e, d]) => e === 'fonte' && d.tipo === 'busca' && d.resultados === 12) || 'a busca informa quantos resultados vieram (painel de atividade)',
      ];
    },
  },
  {
    nome: 'núcleo (Fase 2, 16/10): mínimo de páginas lidas — normal 3, profundo 6, rápido nenhum; o modelo que para sem ler recebe UM pedido de leitura; o que faltar o código lê, um site por vez; página que não abre não conta',
    tipo: 'unidade',
    async executar() {
      const rodar = async ({ modo, falha = () => false, lerNoPedido = 0 }) => {
        // o modelo busca 5 vezes e para sem ler; na rodada depois do pedido de leitura, lê `lerNoPedido` páginas
        const roteiro = [
          ...Array.from({ length: 5 }, (_, i) => ({ ferramentas: [['buscar_na_web', { buscas: [`b${i}`] }], ['pronto', {}]] })),
          { ferramentas: [...Array.from({ length: lerNoPedido }, (_, i) => ['ler_pagina', { fonte: i + 1, foco: 'x' }]), ['pronto', {}]] },
          ...Array.from({ length: 8 }, () => ({ ferramentas: [['pronto', {}]] })),
        ];
        const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: false, pergunta: 'p' }, roteiro });
        const eventos = [];
        let n = 0;
        const res = await nucleo.responder({
          pergunta: 'p',
          modo,
          deps: {
            chamar: m.chamar,
            escrever: m.escrever,
            // 2 resultados por site, para ver o "um site por vez"
            buscar: async (q) => Array.from({ length: 6 }, (_, i) => ({ titulo: `${q}-${i}`, url: `https://site${Math.floor(n++ / 2)}.com/${q}-${i}`, resumo: 'texto' })),
            lerPagina: async (url) => (falha(url) ? Promise.reject(new Error('fora do ar')) : { texto: 'conteúdo da página '.repeat(30) }),
            emit: (e, d) => eventos.push([e, d]),
          },
        });
        const lidas = eventos.filter(([e, d]) => e === 'fonte' && d.tipo === 'leitura').map(([, d]) => new URL(d.url).hostname);
        const pedidos = m.chamadas.filter((c) => /você leu \d+ página/.test(c.messages[c.messages.length - 1]?.content || '')).length;
        return { lidas, pedidos, res };
      };
      const normal = await rodar({ modo: 'normal' });
      const profundo = await rodar({ modo: 'profundo' });
      const rapido = await rodar({ modo: 'rapido' });
      const leu = await rodar({ modo: 'normal', lerNoPedido: 3 });
      const comFalha = await rodar({ modo: 'normal', falha: (url) => /site0\.com/.test(url) });
      return [
        normal.lidas.length === 3 && normal.pedidos === 1 || `normal: 3 páginas e 1 pedido (${normal.lidas.length} / ${normal.pedidos})`,
        new Set(normal.lidas).size === 3 || `um site por vez: ${normal.lidas}`,
        profundo.lidas.length === 6 || `profundo: 6 páginas (${profundo.lidas.length})`,
        rapido.lidas.length === 0 && rapido.pedidos === 0 || `rápido não exige leitura (${rapido.lidas.length})`,
        leu.lidas.length === 3 && leu.pedidos === 1 || `modelo que atende ao pedido: o código não lê a mais (${leu.lidas.length})`,
        comFalha.lidas.length === 3 && !comFalha.lidas.includes('site0.com') || `página fora do ar não conta: ${comFalha.lidas}`,
      ];
    },
  },
  {
    nome: 'núcleo (16/10): a leitura automática da comunidade só pega tópico que cita o assunto ("Adata é uma marca confiável? Esse SSD vale a pena?" não entra num pedido do Dunu Titan S)',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, assuntos: ['Dunu Titan S'], pergunta: 'o dunu titan s vale a pena?' }, roteiro: Array.from({ length: 12 }, () => ({ ferramentas: [['buscar_na_web', { buscas: ['dunu titan s'] }], ['pronto', {}]] })) });
      const lidas = [];
      let n = 0;
      await nucleo.responder({
        pergunta: 'o dunu titan s vale a pena?',
        modo: 'normal',
        deps: {
          chamar: m.chamar,
          escrever: m.escrever,
          buscar: async (q) => [{ titulo: `${q} ${n}`, url: `https://web${n++}.com/x`, resumo: 'texto' }],
          buscarNaComunidade: async () => [
            { titulo: 'Adata é uma marca confiável? Esse SSD vale a pena?', url: 'https://forum.com/adata', resumo: 'SSD Adata' },
            { titulo: 'Dunu Titan S: vale a pena?', url: 'https://forum.com/titan', resumo: 'impressões do Titan S' },
          ],
          lerPagina: async (url) => (lidas.push(url), { texto: 'conteúdo da página '.repeat(30) }),
        },
      });
      return [
        lidas.includes('https://forum.com/titan') || `o tópico do Titan S é lido: ${lidas}`,
        !lidas.includes('https://forum.com/adata') || 'o tópico de SSD não é lido pela garantia',
      ];
    },
  },
  {
    nome: 'núcleo (revisão dos chats de 16/10): nome solto ("Dragon Ball Super Beerus") pesquisa mesmo com "precisa_buscar: false" — só saudação, conta, tradução e texto criativo ficam sem busca',
    tipo: 'unidade',
    executar() {
      const ent = (t) => nucleo.lerEntendimento(JSON.stringify({ precisa_buscar: false, produto: false, assuntos: [], pergunta: t }), t).precisaBuscar;
      return [
        ent('Dragon Ball Super Beerus') === true || 'Beerus pesquisa',
        ['oi', 'obrigado!', 'bom dia', '2+2*3', 'traduza isso para o inglês', 'escreva um poema sobre o mar'].every((t) => ent(t) === false) || 'conversa pura fica sem busca',
      ];
    },
  },
  {
    nome: 'núcleo (revisão dos chats de 16/10): o pesquisador vê os assuntos e o que o usuário perguntou antes ("e quanto ao Vectra 2.0?" depois de carros virava busca de fone Sony)',
    tipo: 'unidade',
    async executar() {
      let primeira = null;
      await nucleo.pesquisar({
        pergunta: 'e quanto ao Vectra 2.0?',
        modo: 'normal',
        produto: true,
        assuntos: ['Chevrolet Vectra 2.0'],
        conversa: [
          { role: 'user', content: 'Qual o carro mais em conta para se comprar em 2026?' },
          { role: 'assistant', content: 'O Chevrolet Corsa…' },
        ],
        deps: {
          chamar: async (messages) => ((primeira = primeira || messages), { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
          buscar: async () => [],
          lerPagina: async () => ({ texto: '' }),
        },
      });
      const texto = primeira.map((m) => m.content).join('\n');
      return [
        /Do que ela trata: Chevrolet Vectra 2\.0/.test(texto) || 'assuntos chegam ao pesquisador',
        /carro mais em conta para se comprar em 2026/.test(texto) || 'pergunta anterior chega ao pesquisador',
        !/intra-auricular/.test(texto) || 'sem exemplo de fone nas instruções',
      ];
    },
  },
  {
    nome: 'núcleo (revisão dos chats de 16/10): pediu vídeo do YouTube sem o yt-dlp — a escrita é avisada para não dizer que viu vídeos, e aparece o aviso para instalar',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: false, pergunta: 'pesquise vídeos no youtube sobre o G Pro X2' } });
      const eventos = [];
      await nucleo.responder({
        pergunta: 'pesquise vídeos no youtube sobre o G Pro X2',
        modo: 'rapido',
        deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [{ titulo: 'G Pro X2', url: 'https://a.com/x', resumo: 'mouse' }], lerPagina: async () => ({ texto: 'x '.repeat(50) }), emit: (e, d) => eventos.push([e, d]) },
      });
      return [
        /NÃO diga que pesquisou, viu ou assistiu a vídeos/.test(m.escritas[0][0].content) || 'a escrita é avisada',
        eventos.some(([e, d]) => e === 'aviso' && /yt-dlp/.test(d.texto)) || 'aviso para instalar',
      ];
    },
  },
  {
    nome: 'prompts (revisão dos chats de 16/10): "Use a conversa atual … como material e crie um PDF" é pedido sobre a própria conversa (pesquisava tudo de novo, 690 s); "crie um pdf sobre fones" não é',
    tipo: 'unidade',
    executar() {
      const { pedeConversaCompleta } = require('../../src/agent/prompts');
      return [
        ['Use a conversa atual sobre os fones como material e crie um PDF', 'use a nossa conversa atual como material', 'crie um pdf com base na conversa', 'salve o chat atual em pdf'].every(pedeConversaCompleta) || 'variações reconhecidas',
        !pedeConversaCompleta('crie um pdf sobre fones para jogar') || 'pedido sem a conversa não casa',
      ];
    },
  },
  {
    nome: 'glossário (16/10): explicação conforme o aparelho do texto — switch mecânico de mouse não é peça de teclado; "taxa de atualização" e "tempo de resposta" só são de tela num texto de tela',
    tipo: 'unidade',
    executar() {
      const { explicarTermos } = require('../../src/agent/glossario');
      const mouse = explicarTermos('O mouse tem switches mecânicos e taxa de atualização de 8000 Hz. Um mouse leve.');
      const teclado = explicarTermos('O teclado tem switches mecânicos. Bom teclado.');
      const monitor = explicarTermos('O monitor tem taxa de atualização de 240 Hz.');
      return [
        /switches mecânicos \(o botão de clique com contato metálico/.test(mouse) && !/a tela mostra/.test(mouse) || `mouse: ${mouse}`,
        /switches mecânicos \(a peça sob cada tecla/.test(teclado) || `teclado: ${teclado}`,
        /taxa de atualização \(quantas imagens por segundo a tela mostra/.test(monitor) || `monitor: ${monitor}`,
      ];
    },
  },
  {
    nome: 'núcleo (16/10): a escrita não recebe as imagens das respostas anteriores e a imagem que ela escrever sai (o cartão de seguimento saiu com duas fotos)',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, pergunta: 'e o G Pro X2?' }, texto: '#### 1. G Pro X2\n![G Pro X2](augpt-img://abcdefghijklmnopqrstuvwxyz.jpg)\n**Faixa de preço:** US$ 179 [1]' });
      const r = await nucleo.responder({
        pergunta: 'e o G Pro X2?',
        modo: 'rapido',
        conversa: [{ role: 'user', content: 'mouse da logitech magnético?' }, { role: 'assistant', content: '#### 1. G Pro X2\n![G Pro X2](augpt-img://zyxwvutsrqponmlkjihgfedcba.jpg)\n**Faixa de preço:** US$ 179' }],
        deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [{ titulo: 'G Pro X2', url: 'https://a.com/x', resumo: 'mouse' }], lerPagina: async () => ({ texto: 'x '.repeat(50) }) },
      });
      const enviado = m.escritas[0].map((x) => x.content).join('\n');
      return [
        !/augpt-img:/.test(enviado) || 'a conversa chega à escrita sem as imagens',
        !/augpt-img:/.test(r.texto) && /#### 1\. G Pro X2\n\*\*Faixa/.test(r.texto) || `a imagem escrita pelo modelo sai: ${r.texto}`,
      ];
    },
  },
  {
    nome: 'núcleo (17/10, Llama 3.2 3B): lista de buscas mandada como texto vira lista; busca sem o assunto ("especificações e dados técnicos") ganha o assunto; busca repetida não roda de novo (na mesma ferramenta)',
    tipo: 'unidade',
    async executar() {
      const buscas = [];
      const m = modeloFalso({
        entendimento: { precisa_buscar: true, produto: false, assuntos: ['Dunu Titan S'], pergunta: 'o Dunu Titan S é bom?' },
        roteiro: [
          { ferramentas: [['buscar_na_web', { buscas: '["Dunu Titan S review", "especificações e dados técnicos"]' }]] },
          { ferramentas: [['buscar_na_web', { buscas: ['dunu titan s REVIEW'] }]] },
          { pronto: true },
        ],
      });
      await nucleo.responder({ pergunta: 'o Dunu Titan S é bom?', modo: 'normal', deps: { chamar: m.chamar, escrever: m.escrever, buscar: async (q) => (buscas.push(q), []), lerPagina: async () => ({}) } });
      const resposta2 = m.chamadas.flatMap((c) => c.messages).filter((x) => x.role === 'tool').map((x) => x.content).find((t) => /já foram feitas/.test(t)) || '';
      return [
        JSON.stringify(nucleo.listaDeBuscas('["a b", "c d"]')) === '["a b","c d"]' && JSON.stringify(nucleo.listaDeBuscas('"um", "dois"')) === '["um","dois"]' || 'texto vira lista',
        buscas[0] === 'Dunu Titan S review' && buscas[1] === 'Dunu Titan S especificações e dados técnicos' || `buscas: ${JSON.stringify(buscas)}`,
        buscas.length === 2 && /já foram feitas/.test(resposta2) || `repetida não roda: ${buscas.length} / ${resposta2.slice(0, 60)}`,
      ];
    },
  },
  {
    nome: 'núcleo (17/10, Llama 3.2 3B): o entendimento que copia o exemplo das instruções ("Chevrolet Vectra 2.0" num pedido de fone) é descartado pelo código — vale a pergunta do usuário; assunto da conversa continua valendo',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, assuntos: ['Chevrolet Vectra 2.0'], pergunta: 'o Chevrolet Vectra 2.0 usado é uma boa compra em 2026?' }, roteiro: [{ pronto: true }] });
      const r = await nucleo.responder({ pergunta: 'top 5 fones intra auriculares para pubg', modo: 'rapido', deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [], lerPagina: async () => ({}) } });
      const m2 = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, assuntos: ['Dunu Titan S'], pergunta: 'o Dunu Titan S é bom para jogar?' }, roteiro: [{ pronto: true }] });
      const r2 = await nucleo.responder({ pergunta: 'e ele é bom para jogar?', conversa: [{ role: 'user', content: 'o que acha do Dunu Titan S?' }, { role: 'assistant', content: 'É um bom IEM.' }], modo: 'rapido', deps: { chamar: m2.chamar, escrever: m2.escrever, buscar: async () => [], lerPagina: async () => ({}) } });
      return [
        r.entendimento.pergunta === 'top 5 fones intra auriculares para pubg' && r.assuntos.length === 0 || `copiado: ${JSON.stringify(r.entendimento)}`,
        r2.entendimento.pergunta === 'o Dunu Titan S é bom para jogar?' && r2.assuntos.join() === 'Dunu Titan S' || `da conversa: ${JSON.stringify(r2.entendimento)}`,
      ];
    },
  },
  {
    nome: 'núcleo (17/10, Llama 3.2 3B): conferência da resposta — citação de fonte que não existe sai; cartão de produto que nenhuma fonte cita sai (renumerando, com aviso); preço que não está no material sai do texto, com nota; se nenhum cartão tem fonte, ficam todos com o aviso',
    tipo: 'unidade',
    executar() {
      const material = 'Kefine Delci AE custa R$ 649,90 no Mercado Livre. HyperX Cloud Earbuds II por R$ 299.';
      const texto = 'Intro [1][9].\n\n#### 1. Kefine Delci AE\n**Faixa de preço:** R$ 649,90 (fonte: [9])\n\n#### 2. Razer Opus 7\n**Faixa de preço:** R$ 499,00 [2]\n\n#### 3. HyperX Cloud Earbuds II\n**Faixa de preço:** R$ 350 [1]\n\n## Conclusão\nfim';
      const r = nucleo.conferirResposta(texto, { numeros: [1, 2], material, produto: true });
      const nenhum = nucleo.conferirResposta('#### 1. Marca X1\ntexto\n\n#### 2. Marca Y2\ntexto', { numeros: [1], material: 'nada a ver', produto: true });
      return [
        !/\[9\]/.test(r.texto) && /Intro \[1\]\./.test(r.texto) && !/\(fonte: \)/.test(r.texto) || `citação inexistente: ${r.texto}`,
        !/Razer Opus 7\n/.test(r.texto) && /#### 2\. HyperX Cloud Earbuds II/.test(r.texto) && /Tirei 1 opção que não aparece em nenhuma fonte lida: Razer Opus 7/.test(r.texto) || `cartão sem fonte: ${r.texto}`,
        // 19/10: o preço sem fonte sai do texto (antes ganhava ⚠); o das fontes fica
        !/R\$ 350/.test(r.texto.split('\n\n*Tirei')[0]) && /HyperX Cloud Earbuds II\n\*\*Faixa de preço:\*\* \*\(preço não confirmado\)\*/.test(r.texto) && /R\$ 649,90/.test(r.texto) && /Tirei 1 preço que não aparece nas fontes lidas \(R\$ 350\)/.test(r.texto) && !/R\$ 499,00/.test(r.texto) || `preço: ${r.texto}`,
        /## Conclusão\nfim/.test(r.texto) || 'o que vem depois dos cartões fica',
        /#### 1\. Marca X1/.test(nenhum.texto) && /Nenhuma das opções aparece/.test(nenhum.texto) || `nenhum com fonte: ${nenhum.texto}`,
      ];
    },
  },
  {
    nome: 'núcleo (17/10, Llama 3.2 3B): "produto" do modelo só vale com pista no pedido (compra, categoria, modelo com número) ou nome curto sem palavra de pergunta — "como o acidente de Chernobyl aconteceu?" não vira cartão de produto',
    tipo: 'unidade',
    async executar() {
      const ent = async (pergunta, conversa = []) => {
        const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, assuntos: [], pergunta }, roteiro: [{ pronto: true }] });
        return (await nucleo.responder({ pergunta, conversa, modo: 'rapido', deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [], lerPagina: async () => ({}) } })).produto;
      };
      return [
        (await ent('como que o acidente de chernobyl aconteceu?')) === false || 'Chernobyl não é produto',
        (await ent('quem foi santos dumont')) === false || 'pessoa não é produto',
        (await ent('fone bose qc 20')) === true && (await ent('dunu titan s')) === true && (await ent('qual o melhor mouse gamer?')) === true || 'produto de verdade continua',
        (await ent('e ele é bom?', [{ role: 'user', content: 'qual o melhor fone para jogar?' }, { role: 'assistant', content: '…' }])) === true || 'seguimento de conversa de produto continua',
      ];
    },
  },
  {
    nome: 'núcleo (17/10, Llama 3.2 3B): título de cartão dentro de negrito ("**#### 1. HyperX Cloud Earbuds**") é desembrulhado e vira cartão',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: true, assuntos: [], pergunta: 'melhor fone intra auricular para jogar' }, roteiro: [{ pronto: true }], texto: '**#### 1. HyperX Cloud Earbuds**\n\n**Faixa de preço:** R$ 229 [1]' });
      const r = await nucleo.responder({ pergunta: 'melhor fone intra auricular para jogar', modo: 'rapido', deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [{ titulo: 'HyperX Cloud Earbuds R$ 229', url: 'https://a.com/x', resumo: 'HyperX Cloud Earbuds custa R$ 229' }], lerPagina: async () => ({}) } });
      return [/^#### 1\. HyperX Cloud Earbuds$/m.test(r.texto) || `cartão: ${r.texto.slice(0, 120)}`];
    },
  },
  {
    nome: 'núcleo (17/10, RX 580): o começo da conversa do pesquisador é igual em toda rodada (o Ollama reaproveita o que já leu); "última rodada" vai no fim, só na última',
    tipo: 'unidade',
    async executar() {
      const m = modeloFalso({ entendimento: { precisa_buscar: true, produto: false, assuntos: [], pergunta: 'como foi a segunda guerra?' }, roteiro: Array.from({ length: 6 }, (_, i) => ({ ferramentas: [['buscar_na_web', { buscas: [`segunda guerra ${i}`] }]] })) });
      await nucleo.responder({ pergunta: 'como foi a segunda guerra?', modo: 'normal', deps: { chamar: m.chamar, escrever: m.escrever, buscar: async () => [], lerPagina: async () => ({}) } });
      const rodadas = m.chamadas.filter((c) => c.opcoes.tools);
      const sistemas = new Set(rodadas.map((c) => c.messages[0].content));
      const ultimas = rodadas.map((c) => /última rodada/.test(c.messages[c.messages.length - 1].content || ''));
      return [
        rodadas.length === 6 && sistemas.size === 1 || `instruções iguais nas ${rodadas.length} rodadas: ${sistemas.size} versões`,
        ultimas.slice(0, -1).every((x) => !x) && ultimas[ultimas.length - 1] === true || `aviso só na última: ${ultimas}`,
      ];
    },
  },
];
