'use strict';

/**
 * Utilitário é ferramenta, não resposta pronta (11/11, pedido do Davi). No app, 5 vezes em 3 dias, "como otimizar o
 * Windows 11 para aumentar o fps em jogo?" foi respondido em 2 s com o plano de ajustes da placa de rede (DNS e
 * economia de energia): a palavra "otimizar" sozinha acionava a rota. Agora: (1) o ajuste de rede só vale quando o
 * pedido fala da rede; (2) numa pergunta aberta, a leitura do PC ou da rede que o entendimento escolher roda calada
 * e o que ela leu vai para o escritor, que responde à pergunta inteira; (3) pedido direto continua com o utilitário.
 */

const nucleo = require('../../src/agent/nucleo');
const rotas = require('../../src/agent/rotas-do-codigo');

const rota = (q) => rotas.escolherRota({ objetivo: q, conversa: [] })?.rota?.id || null;

const deps = (entendimento, extra = {}) => {
  const escritas = [];
  return {
    escritas,
    d: {
      chamar: async (m, o = {}) => (o.json ? { content: JSON.stringify(entendimento) } : { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] }),
      escrever: async (messages, onToken) => (escritas.push(messages), onToken('Ative o Modo de Jogo.'), 'Ative o Modo de Jogo.'),
      buscar: async () => [{ titulo: 'Como otimizar o Windows 11 para jogos', url: 'https://guia.exemplo/x', resumo: 'modo de jogo, drivers, plano de energia' }],
      lerPagina: async () => ({ texto: 'Ative o Modo de Jogo, atualize o driver da placa de vídeo e use o plano de alto desempenho.', titulo: 'Guia' }),
      emit: () => {},
      sobreOUsuario: async () => 'Computador do usuário: placa de vídeo RTX de teste; Windows 11.',
      ...extra,
    },
  };
};

module.exports = [
  {
    nome: 'utilitários: "otimizar o Windows / o PC" não aciona o ajuste de rede (nem pela rota, nem pela ação do modelo); "otimize minha placa de rede", "limpa o cache de dns" e "muda meu dns" continuam acionando',
    tipo: 'unidade',
    executar() {
      const fora = ['como otimizar o windows 11 para aumentar o fps em jogo', 'Como otimizar o windows 11 para ter o melhor desempenho em jogos ?', 'Poderia procurar algumas dicas para otimizar o windows ?', 'quero que voce realize uma pesquisa na internet para buscar como otimizar o windows', 'otimize meu pc'];
      const dentro = ['otimize minha placa de rede', 'otimiza minha internet', 'limpa o cache de dns', 'muda meu dns para o da cloudflare', 'desliga a economia de energia da placa de rede'];
      return [
        ...fora.map((q) => rota(q) !== 'ajustes_de_rede' || `acionou o ajuste de rede: ${q}`),
        ...dentro.map((q) => rota(q) === 'ajustes_de_rede' || `deixou de acionar: ${q} → ${rota(q)}`),
        nucleo.acaoValida('ajustes_de_rede', 'como otimizar o windows 11 para aumentar o fps em jogo') === null || 'a ação do modelo ainda vale só por "otimizar"',
        nucleo.acaoValida('ajustes_de_rede', 'otimize minha placa de rede') === 'ajustes_de_rede' || 'a ação do modelo com a rede no pedido',
        nucleo.PISTA_DO_USUARIO.test('como otimizar o windows 11 para aumentar o fps em jogo') || 'otimizar o Windows é sobre o PC do usuário',
        !nucleo.PISTA_DO_USUARIO.test('como funciona a fotossíntese?') || 'pergunta geral não é sobre o usuário',
      ];
    },
  },
  {
    nome: 'utilitários: pergunta aberta ("como…", "por que…", "o que pode ser") usa a leitura como ferramenta; pedido direto ("quanto espaço…", "consegue ver…", "como está…") fica com o utilitário; teste de velocidade e ajustes nunca rodam como ferramenta',
    tipo: 'unidade',
    executar() {
      const f = nucleo.usaComoFerramenta;
      return [
        f('consultar_pc', 'como otimizar o windows 11 para aumentar o fps em jogo') || 'como otimizar → ferramenta',
        f('consultar_pc', 'por que meu pc trava em jogos?') || 'por que → ferramenta',
        f('diagnostico_da_rede', 'minha internet cai toda hora, o que pode ser?') || 'o que pode ser → ferramenta',
        !f('consultar_pc', 'quanto espaço livre meu pc tem?') || 'pedido direto fica com o utilitário',
        !f('diagnostico_da_rede', 'você consegue ver como está a minha rede?') || '"consegue ver" é pedido de fazer',
        !f('trafego_de_rede', 'como está o uso da minha internet agora?') || '"como está" é pedido de leitura',
        !f('teste_de_rede', 'como melhorar minha internet?') || 'o teste de velocidade gasta dados: não roda sozinho',
        !f('ajustes_de_rede', 'como otimizar minha placa de rede?') || 'ajuste muda o PC: não roda sozinho',
      ];
    },
  },
  {
    nome: 'utilitários: na pergunta aberta a leitura roda calada (comoFerramenta), a resposta é a do escritor e o que foi lido chega a ele junto com os dados do PC; no pedido direto a resposta é a do utilitário',
    tipo: 'unidade',
    async executar() {
      const chamadas = [];
      const executarAcao = async (id, o) => (chamadas.push([id, o.comoFerramenta === true]), { texto: 'Disco C: 12 GB livres de 500 GB. Plano de energia: Equilibrado.', fontes: [], entendimento: {}, buscou: false, produto: false, assuntos: [] });
      const a = deps({ precisa_buscar: true, acao: 'consultar_pc' }, { executarAcao });
      const r1 = await nucleo.responder({ pergunta: 'como otimizar o windows 11 para aumentar o fps em jogo', modo: 'rapido', hoje: '11/11/2026', deps: a.d });
      const sistema = a.escritas[0]?.[0]?.content || '';
      const b = deps({ precisa_buscar: false, acao: 'consultar_pc' }, { executarAcao });
      const r2 = await nucleo.responder({ pergunta: 'quanto espaço livre meu pc tem?', modo: 'rapido', hoje: '11/11/2026', deps: b.d });
      return [
        JSON.stringify(chamadas) === '[["consultar_pc",true],["consultar_pc",false]]' || JSON.stringify(chamadas),
        /Modo de Jogo/.test(r1.texto) && !/^Disco C/.test(r1.texto) || `a resposta aberta: ${r1.texto.slice(0, 120)}`,
        /12 GB livres/.test(sistema) && /RTX de teste/.test(sistema) && /<sobre_o_usuario>/.test(sistema) || 'o escritor recebe o que foi lido e os dados do PC',
        r2.texto.startsWith('Disco C: 12 GB livres') && b.escritas.length === 0 || `o pedido direto: ${r2.texto.slice(0, 120)}`,
      ];
    },
  },
];
