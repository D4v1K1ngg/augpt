'use strict';

/**
 * Métodos globais (18/10), a partir das conversas reais: valem para qualquer
 * tema, não para os assuntos que os revelaram.
 * 1. o entendimento diz se a resposta muda com o tempo, se depende do usuário
 *    e se uma foto ajuda;
 * 2. a pergunta que muda com o tempo busca o recente e lê pelo menos 2 páginas,
 *    e cada fonte vai para a escrita com a data;
 * 3. todo número e nome da resposta é conferido contra as fontes; muitos sem
 *    fonte, a resposta é reescrita.
 */

const nucleo = require('../../src/agent/nucleo');

const PAGINA_A = 'Resultado do 1º turno: Flávio Bolsonaro (PL) obteve 47,03% dos votos válidos e Lula (PT) 45,16%. O segundo turno será em 25 de outubro.';
const PAGINA_B = 'Pesquisa de setembro: Lula aparecia com 41% e Flávio Bolsonaro com 38%.';

function modelo({ entendimento, textos }) {
  const chamadas = [];
  const escritas = [];
  return {
    chamadas,
    escritas,
    chamar: async (messages, opcoes = {}) => {
      chamadas.push({ messages, opcoes });
      if (opcoes.json) return { content: JSON.stringify(entendimento), chamadas: [] };
      // o pesquisador busca uma vez e para; o código completa as leituras
      return chamadas.filter((c) => !c.opcoes.json).length === 1
        ? { content: '', chamadas: [{ function: { name: 'buscar_na_web', arguments: { buscas: ['resultado eleição presidente'] } } }] }
        : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
    },
    escrever: async (messages, onToken) => {
      escritas.push(messages);
      const t = textos[Math.min(escritas.length - 1, textos.length - 1)];
      onToken(t);
      return t;
    },
  };
}

const deps = (m, extra = {}) => {
  const buscas = [];
  const eventos = [];
  return {
    buscas,
    eventos,
    d: {
      chamar: m.chamar,
      escrever: m.escrever,
      buscar: async (q, o = {}) => (buscas.push({ q, recente: !!o.recente }), [
        { titulo: 'Apuração para presidente: 1º turno', url: 'https://g1.exemplo/apuracao', resumo: 'resultado', data: '2026-10-05' },
        { titulo: 'Pesquisa para presidente', url: 'https://jornal.exemplo/pesquisa', resumo: 'pesquisa', data: '2026-09-09' },
      ]),
      lerPagina: async (url) => ({ texto: /apuracao/.test(url) ? PAGINA_A : PAGINA_B, titulo: 'x', via: 'http', data: /apuracao/.test(url) ? '2026-10-05' : '2026-09-09' }),
      emit: (e, x) => eventos.push([e, x]),
      ...extra,
    },
  };
};

module.exports = [
  {
    nome: 'métodos globais: pergunta que muda com o tempo busca o recente e lê 2 páginas até no modo rápido; as fontes vão com a data; a escrita é orientada a ficar com a mais recente; foto só de assunto concreto',
    tipo: 'unidade',
    async executar() {
      const m = modelo({ entendimento: { precisa_buscar: true, muda_com_o_tempo: true, imagem_ajuda: false, assuntos: ['presidente'] }, textos: ['Flávio Bolsonaro (PL) teve 47,03% [1] e Lula (PT) 45,16% [1] no 1º turno; o segundo turno é em 25 de outubro [1].'] });
      const x = deps(m);
      const r = await nucleo.responder({ pergunta: 'Quem sera que vai ganhar como presidente no Brasil ?', modo: 'rapido', deps: x.d, hoje: '18/10/2026' });
      const sistema = m.escritas[0][0].content;
      const pesquisador = m.chamadas.find((c) => c.opcoes.tools)?.messages[0].content || '';
      const ent = x.eventos.find(([e]) => e === 'nucleo-entendimento')[1];
      return [
        x.buscas.every((b) => b.recente) || `busca recente: ${JSON.stringify(x.buscas)}`,
        x.eventos.filter(([e, d]) => e === 'fonte' && d.tipo === 'leitura').length >= 2 || 'leu 2 páginas no rápido',
        /MUDA COM O TEMPO/.test(pesquisador) || 'o pesquisador sabe que é atual',
        /data="05\/10\/2026"/.test(sistema) && /data="09\/09\/2026"/.test(sistema) || 'fontes com data',
        /fique com a mais recente/.test(sistema) && /depende de QUANDO/.test(sistema) || 'regra da discordância',
        ent.fotos.length === 0 || `fotos: ${ent.fotos}`,
        !r.reescrita && !/⚠/.test(r.texto) || `resposta com fonte não é mexida: ${r.texto}`,
      ];
    },
  },
  {
    nome: 'métodos globais: resposta com nomes e números que nenhuma fonte traz é reescrita uma vez (a tela recomeça); o que sobra sem fonte ganha ⚠',
    tipo: 'unidade',
    async executar() {
      const inventada = 'Em 14 de outubro foi baixado o AI n.º 16 pelo Congresso Nacional, que declarou a vacância [1]. A diferença é de 3,5 pontos e 61.000.000 de votos [2].';
      const corrigida = 'Flávio Bolsonaro (PL) teve 47,03% [1] e Lula (PT) 45,16% [1]; a diferença é de 3,5 pontos.';
      const m = modelo({ entendimento: { precisa_buscar: true, muda_com_o_tempo: true }, textos: [inventada, corrigida] });
      const x = deps(m);
      const r = await nucleo.responder({ pergunta: 'quem vai ganhar a eleição para presidente?', modo: 'normal', deps: x.d, hoje: '18/10/2026' });
      const pedido = m.escritas[1]?.at(-1)?.content || '';
      return [
        m.escritas.length === 2 || `escritas: ${m.escritas.length}`,
        /AI/.test(pedido) && /Congresso/.test(pedido) && /61\.000\.000/.test(pedido) || `pedido de reescrita: ${pedido.slice(0, 200)}`,
        x.eventos.some(([e]) => e === 'resposta-reinicia') || 'a tela recomeça a resposta',
        /^Flávio Bolsonaro/.test(r.texto) || r.texto,
        /3,5 ⚠/.test(r.texto) && /Este número não aparece/.test(r.texto) || `número sem fonte marcado: ${r.texto}`,
      ];
    },
  },
  {
    nome: 'métodos globais: pergunta que não muda com o tempo não é reescrita (o saber do modelo vale: "ATP", "ciclo de Calvin"); número sem fonte só ganha ⚠; reescrita que não melhora é descartada',
    tipo: 'unidade',
    async executar() {
      const texto = 'A fase clara gera ATP e NADPH, e o ciclo de Calvin fixa o CO2 em 12 etapas, segundo Melvin Calvin [1].';
      const m = modelo({ entendimento: { precisa_buscar: true, muda_com_o_tempo: false }, textos: [texto] });
      const x = deps(m);
      const r = await nucleo.responder({ pergunta: 'como funciona a fotossíntese?', modo: 'rapido', deps: x.d, hoje: '18/10/2026' });
      const inventada = 'Em 14 de outubro foi baixado o AI n.º 16 pelo Congresso Nacional [1], com 61.000.000 de votos.';
      const m2 = modelo({ entendimento: { precisa_buscar: true, muda_com_o_tempo: true }, textos: [inventada, `${inventada} E o Senado Federal também.`] });
      const x2 = deps(m2);
      const r2 = await nucleo.responder({ pergunta: 'quem vai ganhar a eleição?', modo: 'rapido', deps: x2.d, hoje: '18/10/2026' });
      return [
        m.escritas.length === 1 && !r.reescrita || `não reescreve: ${m.escritas.length}`,
        /12 ⚠/.test(r.texto) || r.texto,
        m2.escritas.length === 2 && r2.reescrita?.ficou === 'original' && !/Senado Federal/.test(r2.texto) || `reescrita pior descartada: ${JSON.stringify(r2.reescrita)}`,
      ];
    },
  },
  {
    nome: 'métodos globais: pergunta sobre a situação do usuário ("meu computador") leva o que o AuGPT sabe dele para a pesquisa e para a escrita; pergunta comum não',
    tipo: 'unidade',
    async executar() {
      const sobre = async () => 'Computador do usuário: placa de vídeo NVIDIA GeForce RTX 3060 Ti (8 GB); 32 GB de RAM.';
      const m = modelo({ entendimento: { precisa_buscar: true, sobre_o_usuario: true }, textos: ['Com a RTX 3060 Ti, ative o DLSS.'] });
      const x = deps(m, { sobreOUsuario: sobre });
      await nucleo.responder({ pergunta: 'como melhorar o desempenho do meu computador para jogos fps', modo: 'rapido', deps: x.d, hoje: '18/10/2026' });
      const pesquisador = m.chamadas.find((c) => c.opcoes.tools)?.messages[1].content || '';
      const m2 = modelo({ entendimento: { precisa_buscar: true, sobre_o_usuario: false }, textos: ['ok'] });
      let chamado = 0;
      const x2 = deps(m2, { sobreOUsuario: async () => (chamado++, 'x') });
      await nucleo.responder({ pergunta: 'como funciona o DLSS?', modo: 'rapido', deps: x2.d, hoje: '18/10/2026' });
      return [
        /RTX 3060 Ti/.test(pesquisador) || 'o pesquisador recebe a máquina',
        /<sobre_o_usuario>[\s\S]*RTX 3060 Ti/.test(m.escritas[0][0].content) && /não recomende comprar o que ele já tem/.test(m.escritas[0][0].content) || 'a escrita recebe a máquina',
        chamado === 0 || 'pergunta comum não lê os dados do usuário',
      ];
    },
  },
  {
    nome: 'métodos globais: trava do código quando o modelo pequeno erra os campos — "hoje", "atual", "resultado" contam como atual e "meu/minha" como do usuário, em qualquer tema; foto só de nome com número ou nome próprio',
    tipo: 'unidade',
    executar() {
      const ent = (j, p) => nucleo.conferirEntendimento(nucleo.lerEntendimento(JSON.stringify(j), p), { pergunta: p });
      return [
        ent({ precisa_buscar: true }, 'qual a cotação do dólar hoje?').atual === true || 'cotação hoje',
        ent({ precisa_buscar: true }, 'qual o resultado do jogo do Flamengo?').atual === true || 'resultado',
        ent({ precisa_buscar: true }, 'como funciona a fotossíntese?').atual === false || 'ciência não é atual',
        ent({ precisa_buscar: true }, 'o que comer na minha dieta?').sobreOUsuario === true || 'minha dieta',
        ent({ precisa_buscar: true, assuntos: ['Torre Eiffel'] }, 'qual a altura da Torre Eiffel?').fotos.join() === 'Torre Eiffel' || 'nome próprio tem foto',
        ent({ precisa_buscar: true, assuntos: ['fotossíntese'] }, 'como funciona a fotossíntese?').fotos.length === 0 || 'conceito sem foto',
        ent({ precisa_buscar: true, imagem_ajuda: false, assuntos: ['Lula'] }, 'o que o Lula disse hoje?').fotos.length === 0 || 'imagem_ajuda false num nome de uma palavra',
        ent({ precisa_buscar: true, imagem_ajuda: false, assuntos: ['Torre Eiffel'] }, 'me fale da Torre Eiffel').fotos.join() === 'Torre Eiffel' || 'nome de 2 palavras tem foto mesmo com imagem_ajuda false (2B errou)',
        ent({ precisa_buscar: true }, 'qual a versão mais nova do Python?').atual === true || 'mais nova é atual',
        ent({ precisa_buscar: true, assuntos: ['a', 'B 1', 'C 2', 'D 3', 'E 4'] }, 'compare B 1, C 2, D 3 e E 4').fotos.length <= 3 || 'no máximo 3',
      ];
    },
  },
];
