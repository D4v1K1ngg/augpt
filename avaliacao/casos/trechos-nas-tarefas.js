'use strict';

/**
 * Tarefas mais rápidas (27/10, análise do Davi): cada página lida numa tarefa passava por uma destilação de
 * ~7 s (52 numa tarefa de 2–5 min). Leitura simples agora leva os trechos mais ligados ao pedido, sem o
 * modelo; a pesquisa planejada (com foco), a investigação de uma opção e "destilarComModelo" seguem no modelo.
 */

const os = require('os');
const { Agent } = require('../../src/agent/loop');

const PAGINA = [
  'Menu Início Notícias Promoções Assine já a nossa newsletter e receba ofertas.',
  'Teclados magnéticos usam sensores de efeito Hall: cada tecla tem um ímã e o sensor mede o campo magnético para saber o quanto ela desceu.',
  'Com isso o ponto de acionamento é ajustável, de 0,1 mm a 4 mm, e dá para usar o rapid trigger, que solta a tecla assim que ela sobe um pouco.',
  'Política de privacidade. Termos de uso. Todos os direitos reservados. Siga-nos nas redes sociais.',
].map((p) => p.repeat(3)).join('\n\n');

function agente(config = {}) {
  const a = new Agent({ config: { host: 'http://127.0.0.1:9', embedModel: 'nomic-embed-text', ...config }, userDataPath: os.tmpdir() });
  a.controller = new AbortController();
  a.chamadas = 0;
  a._destilarUm = async () => ((a.chamadas += 1), { texto: 'resumo do modelo', fatos: 2, destilado: true });
  return a;
}

module.exports = [
  {
    nome: 'tarefas: página lida sem foco vira os trechos ligados ao pedido, sem chamar o modelo (o rodapé e o menu ficam de fora); com foco, com opção ou com "destilarComModelo", o modelo resume',
    tipo: 'unidade',
    async executar() {
      const r = [];
      const a = agente();
      const [e] = await a._destilarGrande({ objetivo: 'como funciona um teclado magnético efeito Hall', origem: 'pesquisar_e_ler(x)', texto: PAGINA, url: 'https://exemplo.com/teclado' });
      r.push(a.chamadas === 0 || `chamou o modelo ${a.chamadas}×`);
      r.push((e.trechos === true && e.destilado === true && !e.cru && e.fatos >= 1) || JSON.stringify({ ...e, bruto: undefined }));
      r.push((/efeito Hall/.test(e.texto) && !/Política de privacidade/.test(e.texto)) || e.texto.slice(0, 300));
      r.push(e.bruto === PAGINA || 'o bruto fica guardado');

      const comFoco = agente();
      await comFoco._destilarGrande({ objetivo: 'fones', foco: 'descobrir opções', origem: 'o', texto: 'Artigo sobre fones com várias opções citadas.', url: 'https://exemplo.com/a' });
      r.push(comFoco.chamadas === 1 || `com foco: ${comFoco.chamadas}`);
      const comOpcao = agente();
      await comOpcao._destilarGrande({ objetivo: 'fones', opcao: 'KZ ZSN Pro', origem: 'o', texto: 'Review do KZ ZSN Pro: graves fortes.', url: 'https://exemplo.com/b' });
      r.push(comOpcao.chamadas === 1 || `com opção: ${comOpcao.chamadas}`);
      const comModelo = agente({ destilarComModelo: true });
      await comModelo._destilarGrande({ objetivo: 'teclado', origem: 'o', texto: PAGINA, url: 'https://exemplo.com/c' });
      r.push(comModelo.chamadas >= 1 || 'com destilarComModelo: o modelo');
      return r;
    },
  },
];
