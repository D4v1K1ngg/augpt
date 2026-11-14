'use strict';

/** Critérios antes dos produtos (14/11, nucleo.pesquisar/buscarCriterios + blocoDosCriterios). */

const nucleo = require('../../src/agent/nucleo');

async function rodar({ produto = true, criteriosAntes = true, criterios } = {}) {
  const naComunidade = [];
  const naWeb = [];
  const lidas = [];
  const deps = {
    criteriosAntes,
    chamar: async (messages, opcoes = {}) => {
      const texto = messages.map((m) => m.content).join('\n');
      if (opcoes.json && /Escreva 2 buscas/.test(texto)) return { content: JSON.stringify({ buscas: ['what makes an IEM good for competitive FPS', 'o que importa num fone para jogos de tiro'] }) };
      if (opcoes.json && /Liste de 3 a 5 critérios/.test(texto)) return { content: criterios ?? JSON.stringify({ criterios: [{ nome: 'passos e direção', porque: 'é o que localiza o inimigo', evitar: 'graves exagerados, que mascaram passos', fontes: [5, 99] }, { nome: 'x', porque: '' }] }) };
      if (opcoes.json) return { content: '{}' };
      return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
    },
    escrever: async () => 'ok',
    buscar: async (q) => (naWeb.push(q), null) || Array.from({ length: 3 }, (_, i) => ({ titulo: `${q} ${i}`, url: `https://loja${i}.com/${encodeURIComponent(q)}`, resumo: 'texto' })),
    buscarNaComunidade: async (q) => (naComunidade.push(q), [0, 1].map((i) => ({ titulo: `${q} — thread ${i}`, url: `https://www.reddit.com/r/iems/${encodeURIComponent(q)}/${i}`, resumo: 'discussão' }))),
    lerPagina: async (url) => (lidas.push(url), { texto: 'Bass-heavy IEMs mask footsteps; you want imaging and separation. '.repeat(20) }),
  };
  const fontes = await nucleo.pesquisar({ pergunta: 'qual o melhor fone intra auricular para jogar PUBG competitivo?', modo: 'normal', deps, hoje: 'x', produto, buscasIniciais: ['melhor fone intra auricular PUBG'] });
  return { fontes, naComunidade, naWeb, lidas };
}

module.exports = [
  {
    nome: 'critérios do uso: pedido de produto busca "o que torna bom" (sem marca; a de inglês no Reddit), lê e tira os critérios (fonte inventada e critério vazio saem); o escritor recebe a lista curta; desligado ou fora de produto, nada; JSON quebrado não trava',
    tipo: 'unidade',
    async executar() {
      const ligado = await rodar();
      const desligado = await rodar({ criteriosAntes: false });
      const semProduto = await rodar({ produto: false });
      const quebrado = await rodar({ criterios: 'não sei' });
      const c = ligado.fontes.criteriosDoUso || [];
      const bloco = nucleo.blocoDosCriterios(c);
      const lidasDoCriterio = ligado.lidas.filter((u) => /what%20makes|o%20que%20importa/.test(u));
      return [
        ligado.naWeb.includes('site:reddit.com what makes an IEM good for competitive FPS') || `a de inglês vai ao Reddit: ${ligado.naWeb}`,
        lidasDoCriterio.length >= 1 || `lidas: ${ligado.lidas}`,
        c.length === 1 && c[0].nome === 'passos e direção' && /graves exagerados/.test(c[0].evitar) && !c[0].fontes.includes(99) || JSON.stringify(c),
        /O que importa para este uso[\s\S]*- passos e direção: é o que localiza o inimigo \(evite: graves exagerados[\s\S]*Comece a resposta por isso/.test(bloco) || bloco,
        nucleo.blocoDosCriterios([]) === '' || 'sem critérios, nada',
        !(desligado.fontes.criteriosDoUso || []).length && !desligado.naWeb.some((q) => /what makes/.test(q)) || 'desligado não busca',
        !(semProduto.fontes.criteriosDoUso || []).length || 'fora de produto, nada',
        Array.isArray(quebrado.fontes) && !(quebrado.fontes.criteriosDoUso || []).length || 'JSON quebrado: sem critérios, pesquisa segue',
      ];
    },
  },
];
