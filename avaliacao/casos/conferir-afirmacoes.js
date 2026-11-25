'use strict';

/**
 * Conferir as afirmações com as fontes (27/10; 25/11 refeita e ligada por padrão): o que as fontes CONTRADIZEM ("Dom
 * Pedro I nasceu na Espanha" com a fonte dizendo Queluz) e o específico que nenhuma sustenta ("versão Bluetooth" de um
 * fone só com fio) é trocado ou sai — só no trecho, sem reescrever a resposta.
 */

const nucleo = require('../../src/agent/nucleo');

const USADAS = [{ n: 1, titulo: 'Pedro I do Brasil — Wikipédia', trechos: ['Pedro I nasceu no Palácio de Queluz, em Portugal, em 12 de outubro de 1798.'] }];
const RESPOSTA = 'Dom Pedro I foi o primeiro imperador do Brasil. Ele nasceu na Espanha em 1798 [1].';

module.exports = [
  {
    nome: 'conferir afirmações: a contradição com fonte e trecho da resposta vale; a sem fonte vale sem número de fonte; a inventada (fonte que não existe numa contradição, trecho que não está na resposta, JSON quebrado) sai; o formato antigo ainda é lido',
    tipo: 'unidade',
    async executar() {
      const com = (json) => nucleo.contradicoesComAsFontes(RESPOSTA, USADAS, async () => ({ content: typeof json === 'string' ? json : JSON.stringify(json) }));
      const certa = await com({ afirmacoes: [{ trecho: 'Ele nasceu na Espanha em 1798', problema: 'contradiz', troca: 'Ele nasceu em Queluz, Portugal, em 1798', n: 1 }] });
      const semFonte = await com({ afirmacoes: [{ trecho: 'Dom Pedro I foi o primeiro imperador do Brasil.', problema: 'sem_fonte', troca: '', n: 0 }] });
      const fonteInventada = await com({ afirmacoes: [{ trecho: 'Ele nasceu na Espanha em 1798', problema: 'contradiz', troca: 'x', n: 7 }] });
      const foraDaResposta = await com({ afirmacoes: [{ trecho: 'Ele morreu em Lisboa em 1834', problema: 'contradiz', troca: 'x', n: 1 }] });
      const antigo = await com({ contradicoes: [{ afirmacao: 'Ele nasceu na Espanha em 1798', fonte_diz: 'Queluz', n: 1 }] });
      const quebrado = await com('não sei');
      return [
        certa.length === 1 && certa[0].troca.includes('Queluz') || JSON.stringify(certa),
        semFonte.length === 1 && semFonte[0].problema === 'sem_fonte' || JSON.stringify(semFonte),
        fonteInventada.length === 0 || 'fonte que não existe',
        foraDaResposta.length === 0 || 'trecho que não está na resposta',
        antigo.length === 1 || 'formato antigo',
        quebrado.length === 0 || 'JSON quebrado',
      ];
    },
  },
  {
    nome: 'corrigir afirmações: o trecho vira a troca; sem troca, sai (na tabela, "não informado nas fontes"); a indentação das listas fica',
    tipo: 'unidade',
    executar() {
      const texto = 'O EM6L tem ótimo palco. Existe também uma versão Bluetooth do EM6L. Bom para FPS.\n\n| Critério | EM6L |\n| --- | --- |\n| Conexão | Bluetooth 5.3 |\n\n- item\n    * sub item';
      const r = nucleo.corrigirAfirmacoes(texto, [{ trecho: 'Existe também uma versão Bluetooth do EM6L.', troca: '' }, { trecho: 'Bluetooth 5.3', troca: '' }, { trecho: 'ótimo palco', troca: 'palco amplo' }]);
      return [
        !/versão Bluetooth/.test(r) && /O EM6L tem palco amplo\. Bom para FPS\./.test(r) || r,
        /\| Conexão \| não informado nas fontes \|/.test(r) || r,
        /\n    \* sub item/.test(r) || 'indentação',
      ];
    },
  },
  {
    nome: 'conferir afirmações no núcleo: ligado (o padrão), a contradição é corrigida no trecho, sem segunda escrita; desligado ("conferirAfirmacoes": false), nem chama',
    tipo: 'unidade',
    async executar() {
      const rodar = async (ligado) => {
        const prompts = [];
        let escritas = 0;
        const deps = {
          ...(ligado === undefined ? {} : { conferirAfirmacoes: ligado }),
          emit: () => {},
          embed: async () => [],
          buscar: async () => [{ url: 'https://pt.wikipedia.org/wiki/Pedro_I_do_Brasil', titulo: 'Pedro I do Brasil — Wikipédia', resumo: 'Pedro I nasceu no Palácio de Queluz, em Portugal, em 12 de outubro de 1798.' }],
          lerPagina: async () => ({ texto: 'Pedro I nasceu no Palácio de Queluz, em Portugal, em 12 de outubro de 1798. Foi o primeiro imperador do Brasil.', titulo: 'Pedro I do Brasil — Wikipédia' }),
          chamar: async (msgs, o = {}) => {
            const c = String(msgs[msgs.length - 1].content || '');
            prompts.push(c.slice(0, 60));
            if (/Confira a RESPOSTA contra as FONTES/.test(c)) return { content: JSON.stringify({ afirmacoes: [{ trecho: 'Ele nasceu na Espanha em 1798', problema: 'contradiz', troca: 'Ele nasceu no Palácio de Queluz, em Portugal, em 1798', n: 1 }] }) };
            if (o.json) return { content: JSON.stringify({ precisa_buscar: true, assuntos: ['Pedro I'], buscas: ['Pedro I do Brasil'], pergunta: 'quem foi Dom Pedro I?' }) };
            return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
          },
          escrever: async () => {
            escritas += 1;
            return RESPOSTA;
          },
        };
        const r = await nucleo.responder({ pergunta: 'quem foi Dom Pedro I?', deps, modo: 'rapido' });
        return { r, escritas, conferiu: prompts.some((p) => /Confira a RESPOSTA/.test(p)) };
      };
      const padrao = await rodar(undefined);
      const desligado = await rodar(false);
      return [
        (padrao.conferiu && padrao.escritas === 1 && /Queluz/.test(padrao.r.texto) && !/Espanha/.test(padrao.r.texto)) || `padrão: ${padrao.escritas} escritas | ${padrao.r.texto}`,
        padrao.r.afirmacoes?.contradicoes === 1 && padrao.r.afirmacoes?.ficou === 'corrigida' || JSON.stringify(padrao.r.afirmacoes),
        (!desligado.conferiu && desligado.escritas === 1) || `desligado conferiu: ${desligado.conferiu}, ${desligado.escritas} escritas`,
      ];
    },
  },
];
module.exports.push({
  nome: 'conferir afirmações no app (25/11): o "sem fonte" do modelo só sai com o código confirmando (GFLOPS, Bluetooth e "dezembro de 2026" fora do material saem; "palco amplo", que a fonte diz com outras palavras, fica); título de lista e preço ficam; troca sem relação não entra; trecho repetido conta uma vez',
  tipo: 'unidade',
  async executar() {
    const mat = 'As placas RTX 5070 Ti e RTX 5080 da NVIDIA têm 16 GB. A 5080 tem 56 TFLOPS. O EM6L é com fio, cabo de 1,2 m, palco amplo.';
    const r = 'A RTX 5080 tem 56 GFLOPS de poder. Existe também uma versão Bluetooth do EM6L. O palco sonoro é amplo e detalhado. Dados de dezembro de 2026 mostram isso. A RTX 5080 é mais potente em:\n- memória\n**Preço:** não especificado nas fontes. Prefira terrenos altos.';
    const a = (trecho, extra = {}) => ({ trecho, problema: 'sem_fonte', troca: '', n: 0, ...extra });
    const lista = [a('A RTX 5080 tem 56 GFLOPS de poder.'), a('Existe também uma versão Bluetooth do EM6L.'), a('O palco sonoro é amplo e detalhado.'), a('Dados de dezembro de 2026 mostram isso.'), a('A RTX 5080 é mais potente em:'), a('**Preço:** não especificado nas fontes.'), a('Prefira terrenos altos.', { problema: 'contradiz', n: 1, troca: 'Leve bandagens extras.' }), a('Dados de dezembro de 2026 mostram isso.')];
    const achadas = await nucleo.contradicoesComAsFontes(r, [{ n: 1, titulo: 'x', trechos: [mat] }], async () => ({ content: JSON.stringify({ afirmacoes: lista }) }), { material: mat, extra: 'qual a diferença' });
    const t = achadas.map((c) => c.trecho);
    return [JSON.stringify(t) === JSON.stringify(['A RTX 5080 tem 56 GFLOPS de poder.', 'Existe também uma versão Bluetooth do EM6L.', 'Dados de dezembro de 2026 mostram isso.']) || JSON.stringify(t)];
  },
});
module.exports.push({
  nome: 'conferir afirmações (25/11, o teste do ângulo do mouse): dois trechos com a mesma troca, ou uma troca que a resposta já tem, entram uma vez só — a frase não sai repetida',
  tipo: 'unidade',
  async executar() {
    const r = 'Se a linha subir, você tem inclinação. Depois, se subiu, use um número negativo. Use o lápis depois.';
    const troca = 'Se a linha subir à esquerda, ajuste para um número negativo.';
    const lista = [{ trecho: 'Se a linha subir, você tem inclinação.', problema: 'contradiz', troca, n: 1 }, { trecho: 'Depois, se subiu, use um número negativo.', problema: 'contradiz', troca, n: 1 }, { trecho: 'Use o lápis depois.', problema: 'contradiz', troca: 'Se a linha subir, você tem inclinação.', n: 1 }];
    const achadas = await nucleo.contradicoesComAsFontes(r, [{ n: 1, titulo: 'x', trechos: ['linha subir esquerda negativo inclinação lápis'] }], async () => ({ content: JSON.stringify({ afirmacoes: lista }) }));
    const texto = nucleo.corrigirAfirmacoes(r, achadas);
    return [texto.split(troca).length === 2 && achadas.length === 1 || `${achadas.length}: ${texto}`];
  },
});
