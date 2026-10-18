'use strict';

/**
 * O AuGPT sabe o que faz (18/10, conversa do Davi): "você consegue ver como
 * está a qualidade da minha conexão?" foi respondido com "não consigo medir…
 * não tenho acesso à sua rede". Agora: o entendimento escolhe a ação no
 * catálogo (src/agent/capacidades.js), a escrita sabe o que o AuGPT faz, e a
 * resposta oferece a ação que ajuda — "sim" na mensagem seguinte executa.
 * Conferido no app (cópia isolada) com a conversa do Davi e com "meu pubg está
 * com lag, o que fazer? || sim".
 */

const nucleo = require('../../src/agent/nucleo');
const capacidades = require('../../src/agent/capacidades');
const { pedidoDeRota } = require('../../src/agent/rede-no-chat');

const deps = (entendimento, extra = {}) => {
  const escritas = [];
  return {
    escritas,
    d: {
      chamar: async (m, o = {}) => (o.json ? { content: JSON.stringify(entendimento) } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
      escrever: async (messages, onToken) => (escritas.push(messages), onToken('Use cabo em vez de Wi-Fi.'), 'Use cabo em vez de Wi-Fi.'),
      buscar: async () => [{ titulo: 'Como melhorar a internet para jogos', url: 'https://guia.exemplo/x', resumo: 'cabo, roteador, QoS' }],
      lerPagina: async () => ({ texto: 'Use cabo de rede, ative o QoS do roteador.', titulo: 'Guia' }),
      emit: () => {},
      ...extra,
    },
  };
};

module.exports = [
  {
    nome: 'capacidades: o entendimento escolhe a ação ("acao") ou a que ajudaria ("sugerir"); pedido de fazer ("você consegue ver…", "dá pra medir…") com sugestão vira ação; a ação precisa ter a ver com a pergunta (trava do modelo pequeno)',
    tipo: 'unidade',
    executar() {
      const ent = (j, p) => nucleo.lerEntendimento(JSON.stringify({ precisa_buscar: true, ...j }), p);
      const sug = { acao: '', sugerir: 'teste_de_rede' };
      return [
        ent(sug, 'voce consegue ver como esta a qualidade da minha coneção de internet atualmente ?').acao === 'teste_de_rede' || 'você consegue ver → ação',
        ent(sug, 'dá pra medir meu ping?').acao === 'teste_de_rede' || 'dá pra medir → ação',
        ent(sug, 'o que eu posso fazer para melhorar a minha conexão para jogar?').sugerir === 'teste_de_rede' && !ent(sug, 'o que eu posso fazer para melhorar a minha conexão para jogar?').acao || 'conselho → sugestão',
        ent(sug, 'o que você pode me dizer sobre a minha internet?').acao === null || '"pode me dizer" é pergunta',
        ent({ acao: 'teste_de_rede' }, 'qual a capital da França?').acao === null || 'ação sem relação com a pergunta',
        ent({ acao: 'apagar_tudo' }, 'apague meus arquivos da internet').acao === null || 'ação fora do catálogo',
        ent({ sugerir: 'rota_de_jogo' }, 'meu pubg está com lag, o que fazer?').sugerir === 'rota_de_jogo' || 'lag no jogo → sugere a rota',
        /teste_de_rede/.test(nucleo.pedidoDeEntendimento({ pergunta: 'x', hoje: '18/10/2026' })) && /"sugerir"/.test(nucleo.pedidoDeEntendimento({ pergunta: 'x', hoje: '18/10/2026' })) || 'o entendimento recebe o catálogo',
      ];
    },
  },
  {
    nome: 'capacidades: a ação pedida é executada pelo app (sem pesquisar); a sugestão vira a oferta no fim da resposta, uma vez só; a escrita sabe o que o AuGPT faz e não pode dizer que não consegue',
    tipo: 'unidade',
    async executar() {
      const feitas = [];
      const a = deps({ precisa_buscar: true, acao: 'teste_de_rede' }, { executarAcao: async (id) => (feitas.push(id), { texto: 'Posso medir a sua internet agora.', fontes: [], entendimento: {}, buscou: false, produto: false, assuntos: [] }) });
      const r1 = await nucleo.responder({ pergunta: 'você consegue testar a minha internet?', modo: 'rapido', hoje: '18/10/2026', deps: a.d });
      const b = deps({ precisa_buscar: true, sugerir: 'teste_de_rede' });
      const r2 = await nucleo.responder({ pergunta: 'como melhorar minha internet para jogar?', modo: 'rapido', hoje: '18/10/2026', deps: b.d });
      const c = deps({ precisa_buscar: true, sugerir: 'teste_de_rede' });
      const r3 = await nucleo.responder({ pergunta: 'e o roteador, ajuda na internet?', conversa: [{ role: 'user', content: 'como melhorar?' }, { role: 'assistant', content: r2.texto }], modo: 'rapido', hoje: '18/10/2026', deps: c.d });
      const sistema = b.escritas[0][0].content;
      return [
        feitas.join() === 'teste_de_rede' && r1.texto === 'Posso medir a sua internet agora.' && a.escritas.length === 0 || `ação: ${feitas} | ${r1.texto}`,
        r2.texto.endsWith(capacidades.ofertaDe('teste_de_rede')) || r2.texto.slice(-200),
        !r3.texto.includes(capacidades.ofertaDe('teste_de_rede').slice(0, 40)) || 'oferta repetida na resposta seguinte',
        /<o_que_o_augpt_faz>/.test(sistema) && /mede agora a internet do usuário/.test(sistema) && /Nunca diga que não consegue/.test(sistema) || 'a escrita sabe o que o AuGPT faz',
        !/cria e edita imagens/.test(sistema) || 'criar imagem só com o gerador instalado',
      ];
    },
  },
  {
    nome: 'capacidades: "sim" logo depois da oferta aciona a capacidade oferecida ("só o ping" na do teste de rede); "sim" sem oferta antes, ou resposta longa, não aciona; "lag, o que fazer?" não mede direto (é conselho), "qual meu ping no PUBG?" mede',
    tipo: 'unidade',
    executar() {
      const depois = (id) => [{ role: 'user', content: 'x' }, { role: 'assistant', content: `Dicas…\n\n${capacidades.ofertaDe(id)}` }];
      return [
        capacidades.aceitouOferta('sim', depois('teste_de_rede'))?.id === 'teste_de_rede' || 'sim → teste',
        capacidades.aceitouOferta('só o ping', depois('teste_de_rede'))?.modo === 'ping' || 'só o ping',
        capacidades.aceitouOferta('pode sim', depois('rota_de_jogo'))?.id === 'rota_de_jogo' || 'pode sim → rota',
        capacidades.aceitouOferta('sim', [{ role: 'assistant', content: 'Use cabo.' }]) === null || 'sem oferta antes',
        capacidades.aceitouOferta('sim, mas antes me explique em detalhes como funciona o bufferbloat e o QoS do meu roteador', depois('teste_de_rede')) === null || 'resposta longa é outra pergunta',
        pedidoDeRota('meu pubg está com lag, o que fazer?') === null && pedidoDeRota('como diminuir o ping no pubg?') === null || 'conselho não mede direto',
        pedidoDeRota('qual meu ping nos servidores do PUBG?')?.jogo === 'pubg' || 'ping do PUBG mede',
      ];
    },
  },
];
