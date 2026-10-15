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
      await nucleo.responder({ pergunta: 'quem ganhou a copa de 2026?', deps: deps(semFerramenta) });
      const conversaFiada = modeloFalso({ entendimento: { precisa_buscar: false, pergunta: 'obrigado!' }, texto: 'De nada!' });
      const semBusca = await nucleo.responder({ pergunta: 'obrigado!', deps: deps(conversaFiada) });
      const quebrado = nucleo.lerEntendimento('não sei responder em JSON', 'pergunta original');
      return [
        buscas[0] === 'O que é o fone Dunu Titan S?' || `busca da própria pergunta: ${buscas}`,
        semBusca.buscou === false && semBusca.fontes.length === 0 && conversaFiada.chamadas.length === 1 || 'sem busca: só o entendimento e a escrita',
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
];
