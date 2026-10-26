'use strict';

/**
 * Conferir as afirmações com as fontes (27/10, opção em Ajustes, desligada por padrão): o que as fontes
 * CONTRADIZEM é corrigido ("Dom Pedro I nasceu na Espanha" com a fonte dizendo Queluz, Portugal).
 */

const nucleo = require('../../src/agent/nucleo');

const USADAS = [{ n: 1, titulo: 'Pedro I do Brasil — Wikipédia', trechos: ['Pedro I nasceu no Palácio de Queluz, em Portugal, em 12 de outubro de 1798.'] }];
const RESPOSTA = 'Dom Pedro I foi o primeiro imperador do Brasil. Ele nasceu na Espanha em 1798 [1].';

module.exports = [
  {
    nome: 'conferir afirmações: a contradição com fonte e trecho da resposta vale; a inventada (fonte que não existe, trecho que não está na resposta, JSON quebrado) sai',
    tipo: 'unidade',
    async executar() {
      const com = (json) => nucleo.contradicoesComAsFontes(RESPOSTA, USADAS, async () => ({ content: typeof json === 'string' ? json : JSON.stringify(json) }));
      const certa = await com({ contradicoes: [{ afirmacao: 'Ele nasceu na Espanha em 1798', fonte_diz: 'nasceu no Palácio de Queluz, em Portugal', n: 1 }] });
      const fonteInventada = await com({ contradicoes: [{ afirmacao: 'Ele nasceu na Espanha em 1798', fonte_diz: 'Portugal', n: 7 }] });
      const foraDaResposta = await com({ contradicoes: [{ afirmacao: 'Ele morreu em Lisboa em 1834', fonte_diz: 'morreu em Queluz', n: 1 }] });
      const quebrado = await com('não sei');
      return [
        certa.length === 1 || JSON.stringify(certa),
        fonteInventada.length === 0 || 'fonte que não existe',
        foraDaResposta.length === 0 || 'trecho que não está na resposta',
        quebrado.length === 0 || 'JSON quebrado',
      ];
    },
  },
  {
    nome: 'conferir afirmações: ligado, a contradição faz reescrever corrigindo só aquele ponto; desligado (o padrão), nem chama',
    tipo: 'unidade',
    async executar() {
      const rodar = async (ligado) => {
        const prompts = [];
        let escritas = 0;
        const deps = {
          conferirAfirmacoes: ligado,
          emit: () => {},
          embed: async () => [],
          buscar: async () => [{ url: 'https://pt.wikipedia.org/wiki/Pedro_I_do_Brasil', titulo: 'Pedro I do Brasil — Wikipédia', resumo: 'Pedro I nasceu no Palácio de Queluz, em Portugal, em 12 de outubro de 1798.' }],
          lerPagina: async () => ({ texto: 'Pedro I nasceu no Palácio de Queluz, em Portugal, em 12 de outubro de 1798. Foi o primeiro imperador do Brasil.', titulo: 'Pedro I do Brasil — Wikipédia' }),
          chamar: async (msgs, o = {}) => {
            const c = String(msgs[msgs.length - 1].content || '');
            prompts.push(c.slice(0, 60));
            if (/Confira a RESPOSTA contra as FONTES/.test(c)) return { content: JSON.stringify({ contradicoes: [{ afirmacao: 'Ele nasceu na Espanha em 1798', fonte_diz: 'nasceu no Palácio de Queluz, em Portugal', n: 1 }] }) };
            if (o.json) return { content: JSON.stringify({ precisa_buscar: true, assuntos: ['Pedro I'], buscas: ['Pedro I do Brasil'], pergunta: 'quem foi Dom Pedro I?' }) };
            return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
          },
          escrever: async (msgs) => {
            escritas += 1;
            return /contradizem/.test(String(msgs[msgs.length - 1].content || '')) ? 'Dom Pedro I foi o primeiro imperador do Brasil. Ele nasceu no Palácio de Queluz, em Portugal, em 1798 [1].' : RESPOSTA;
          },
        };
        const r = await nucleo.responder({ pergunta: 'quem foi Dom Pedro I?', deps, modo: 'rapido' });
        return { r, escritas, conferiu: prompts.some((p) => /Confira a RESPOSTA/.test(p)) };
      };
      const ligado = await rodar(true);
      const desligado = await rodar(false);
      return [
        (ligado.conferiu && ligado.escritas === 2 && /Queluz/.test(ligado.r.texto) && !/Espanha/.test(ligado.r.texto)) || `ligado: ${ligado.escritas} escritas | ${ligado.r.texto}`,
        ligado.r.afirmacoes?.contradicoes === 1 && ligado.r.afirmacoes?.ficou === 'nova' || JSON.stringify(ligado.r.afirmacoes),
        (!desligado.conferiu && desligado.escritas === 1) || `desligado conferiu: ${desligado.conferiu}, ${desligado.escritas} escritas`,
      ];
    },
  },
];
