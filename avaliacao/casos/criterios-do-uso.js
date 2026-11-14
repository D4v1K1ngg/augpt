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
      if (opcoes.json && /Liste de 3 a 5 critérios/.test(texto)) return { content: criterios ?? JSON.stringify({ criterios: [{ nome: 'passos e direção', porque: 'é o que localiza o inimigo', evitar: 'graves exagerados, que mascaram passos', fontes: [5, 99] }, { nome: 'x', porque: '' }], sinais_de_evitar: ['graves potentes', 'bass', 'bass boost'], recomendados: ['Simgot EM6L', 'Truthear Hexa', 'KZ'] }) };
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
      const lidasDosRecomendados = ligado.lidas.filter((u) => /Simgot%20EM6L%20review|Truthear%20Hexa%20review/.test(u));
      const lidasDoCriterio = ligado.lidas.filter((u) => /what%20makes|o%20que%20importa/.test(u));
      return [
        ligado.naWeb.includes('site:reddit.com what makes an IEM good for competitive FPS') || `a de inglês vai ao Reddit: ${ligado.naWeb}`,
        lidasDoCriterio.length >= 1 || `lidas: ${ligado.lidas}`,
        c.length === 1 && c[0].nome === 'passos e direção' && /graves exagerados/.test(c[0].evitar) && !c[0].fontes.includes(99) || JSON.stringify(c),
        /O que importa para este uso[\s\S]*- passos e direção: é o que localiza o inimigo \(evite: graves exagerados[\s\S]*Comece a resposta por isso/.test(bloco) || bloco,
        nucleo.blocoDosCriterios([]) === '' || 'sem critérios, nada',
        JSON.stringify(ligado.fontes.sinaisDeEvitar) === '["graves potentes","bass boost"]' || `sinais (palavra solta e genérica sai): ${JSON.stringify(ligado.fontes.sinaisDeEvitar)}`,
        JSON.stringify(ligado.fontes.recomendadosPelaComunidade) === '["Simgot EM6L","Truthear Hexa"]' && lidasDosRecomendados.length === 2 || `recomendados da comunidade, um review lido cada: ${JSON.stringify(ligado.fontes.recomendadosPelaComunidade)} ${lidasDosRecomendados}`,
        /Quem usa recomenda: Simgot EM6L, Truthear Hexa/.test(nucleo.blocoDosCriterios(c, ligado.fontes.recomendadosPelaComunidade)) || 'o escritor sabe o que a comunidade recomenda',
        !(desligado.fontes.criteriosDoUso || []).length && !desligado.naWeb.some((q) => /what makes/.test(q)) || 'desligado não busca',
        !(semProduto.fontes.criteriosDoUso || []).length || 'fora de produto, nada',
        Array.isArray(quebrado.fontes) && !(quebrado.fontes.criteriosDoUso || []).length || 'JSON quebrado: sem critérios, pesquisa segue',
      ];
    },
  },
  {
    nome: 'descarte pelo código: a opção que elogia o que evitar sai (bloco, frase da introdução e linha da tabela), os blocos são renumerados; crítica nos pontos fracos não conta; nunca fica menos de 2 opções',
    tipo: 'unidade',
    executar() {
      const txt = `Para PUBG, priorize separação. O **KZ EDX Pro** é ótimo para graves. O **Simgot EM6L** tem palco.

| Modelo | Nota |
|---|---|
| KZ EDX Pro | 8 |
| Simgot EM6L | 9 |

#### 1. KZ EDX Pro
**Pontos fortes:** graves potentes para explosões.
**Pontos fracos:** pouco detalhe.

#### 2. Simgot EM6L
**Pontos fortes:** separação.
**Pontos fracos:** não tem graves potentes.

#### 3. Truthear Hexa
**Pontos fortes:** neutro.
`;
      const r = nucleo.semOpcoesContraOsCriterios(txt, ['graves potentes']);
      const dois = nucleo.semOpcoesContraOsCriterios(txt.split('#### 3.')[0], ['graves potentes']);
      const top3 = nucleo.semOpcoesContraOsCriterios(txt, ['graves potentes'], { minimo: 3 });
      const naAtencao = nucleo.semOpcoesContraOsCriterios('#### 1. SteelSeries GameBuds\nTem dongle de 2,4 GHz.\n**Atenção:** pelo Bluetooth a latência alta atrapalha.\n\n#### 2. Moondrop Aria\nNeutro.\n\n#### 3. KZ\nOk.\n', ['latencia alta']);
      return [
        JSON.stringify(r.tiradas) === '["KZ EDX Pro"]' || JSON.stringify(r.tiradas),
        !/KZ EDX/.test(r.texto) && /#### 1\. Simgot EM6L/.test(r.texto) && /#### 2\. Truthear Hexa/.test(r.texto) || r.texto,
        /Simgot EM6L \| 9/.test(r.texto) && !/KZ EDX Pro \| 8/.test(r.texto) && /Para PUBG, priorize separação/.test(r.texto) || 'o resto fica',
        dois.tiradas.length === 0 && dois.texto === txt.split('#### 3.')[0] || 'tirar deixaria 1 opção: fica como está',
        nucleo.semOpcoesContraOsCriterios(txt, []).texto === txt || 'sem sinais, nada muda',
        naAtencao.tiradas.length === 0 && !naAtencao.marcadas?.length || 'o sinal no campo "Atenção" é cuidado, não elogio',
        // "top 3": tirar deixaria 2 — a opção fica, marcada e por último
        JSON.stringify(top3.marcadas) === '["KZ EDX Pro"]' && top3.tiradas.length === 0 && /#### 3\. KZ EDX Pro\n\n> ⚠ Vai contra o que importa para este uso \(graves potentes\)/.test(top3.texto) && /\n\n#### 3\./.test(top3.texto) || top3.texto,
      ];
    },
  },
];
module.exports.push({
  nome: 'campos do produto: "Na comunidade" que só cita lista de afiliado sai, com fonte de fórum fica; preço com valor e sem citação vira "não encontrei", com citação fica',
  tipo: 'unidade',
  executar() {
    const fontes = [
      { n: 3, url: 'https://pandalargo.com.br/top-10', titulo: 'Melhores Fones In-Ear TWS Gamer de 2026: Top 10' },
      { n: 11, url: 'https://www.clubedohardware.com.br/forums/topic/1', titulo: 'Recomendação fones', comunidade: true },
    ];
    const texto = ['#### 1. A', 'Texto [3].', '**Preço:** Entre R$ 400 e R$ 600 (varia).', '**Na comunidade:** Jogadores elogiam [3].', '', '#### 2. B', '**Preço:** R$ 129 [11]', '**Na comunidade:** Citado no Clube do Hardware [(11)].'].join('\n');
    const r = nucleo.conferirCamposDoProduto(texto, fontes);
    return [
      r.semComunidade === 1 && !/Jogadores elogiam/.test(r.texto) && /Citado no Clube do Hardware/.test(r.texto) || r.texto,
      r.semFonteDePreco === 1 && /\*\*Preço:\*\* não encontrei nas fontes lidas\./.test(r.texto) && /R\$ 129 \[11\]/.test(r.texto) || r.texto,
    ];
  },
});
module.exports.push({
  nome: 'modelos citados na comunidade (pelo código): marca conhecida + modelo e nome com código ("Archer AX73"); 2+ menções; os da marca primeiro; "and footsteps" não é modelo; o que a pergunta já cita sai',
  tipo: 'unidade',
  executar() {
    const fones = [
      'I went from the Truthear Hexa to the Simgot EM6L and footsteps are way clearer.',
      'Simgot EM6L or Truthear Hexa? Moondrop Chu 2 is the budget pick. My PC has a USB DAC.',
      'Get the Moondrop Chu 2, Simgot EM6L if you can. Razer Viper V3 mouse lol. Truthear Hexa forever.',
      'Viper V3 is a mouse, Viper V3 again.',
    ];
    const r = nucleo.modelosCitados(fones, { pergunta: 'melhor fone para pubg' });
    const rede = nucleo.modelosCitados(['O TP-Link Archer AX73 é ótimo. Tenho o Archer AX73 e o Deco X20. Deco X20 cobre a casa.'], { pergunta: 'roteador para jogos' });
    const jaNaPergunta = nucleo.modelosCitados(fones, { pergunta: 'simgot em6l ou truthear hexa?' });
    return [
      JSON.stringify(r.slice(0, 3)) === '["Truthear Hexa","Simgot EM6L","Moondrop Chu 2"]' || JSON.stringify(r),
      rede.includes('Archer AX73') && rede.includes('Deco X20') || JSON.stringify(rede),
      !jaNaPergunta.some((n) => /EM6L|Hexa/.test(n)) || JSON.stringify(jaNaPergunta),
      nucleo.modelosCitados(['Simgot EM6L uma vez só.']).length === 0 || 'uma menção só não basta',
      nucleo.modelosCitados(['Postado 29 de março. Postado 29 de abril. Postado 15 maio. Postado 15 junho.']).length === 0 || 'data de post de fórum não é modelo',
    ];
  },
});
