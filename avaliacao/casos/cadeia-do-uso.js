'use strict';

/**
 * Cadeia do uso + comunidade como evidência (2026-09-28, pedido do Davi
 * depois do 12º teste real).
 *
 * Parte 1 — o raciocínio que o Davi faz antes de pesquisar: "top 10 intra
 * pra PUBG de PC" → PUBG é FPS competitivo → em FPS importa ouvir os passos e
 * de onde vêm → palco sonoro/imagem, separação, isolamento... → busca "o que
 * torna um fone bom pra FPS" ANTES de procurar produto; os critérios saem
 * daí, com o porquê, e substituem os chutes do plano ("design compacto" com
 * peso alto, no 12º teste).
 *
 * Parte 2 — comunidade como evidência: recomendação ≠ menção ("eu tenho os
 * Bose QC20 há 6 anos" deixou o QC20 em 2º); votos e "fala do uso" pesam; os
 * melhores comentários viram citação na resposta.
 */

const m = require('../../src/agent/motor-pesquisa');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

const CADEIA = `PRODUTO: fone intra-auricular
ATIVIDADE: jogar PUBG no PC
TIPO DE USO: jogo de tiro (FPS) competitivo
O USO EXIGE:
- ouvir os passos dos inimigos | quem ouve primeiro reage primeiro
- saber de onde vem cada som | direção decide para onde mirar
CARACTERÍSTICAS TÉCNICAS:
- palco sonoro e imagem | saber de onde vem cada som | soundstage, imaging
- separação de frequências | ouvir os passos no meio dos tiros | separation, detail
- isolamento acústico | ouvir os passos sem o barulho da casa | isolation, seal
- design compacto | caber no ouvido | compact
BUSCAS DE CONHECIMENTO:
- o que torna um fone bom para fps competitivo
- what makes a good iem for competitive fps`;

module.exports = [
  {
    nome: 'cadeia do uso: lê produto, tipo de uso, exigências, características (sem "design"/"qualidade") e as buscas de conhecimento',
    tipo: 'unidade',
    executar() {
      const c = m.lerCadeiaDoUso(CADEIA);
      const q = m.consultasDeConhecimento(c, 2);
      const ruim = m.lerCadeiaDoUso('PRODUTO: fone\nCARACTERÍSTICAS TÉCNICAS:\n- qualidade | x | y');
      return [
        c?.tipoDeUso === 'jogo de tiro (FPS) competitivo' && c?.produto === 'fone intra-auricular' || JSON.stringify(c),
        c?.exige.length === 2 && c.exige[0].porque === 'quem ouve primeiro reage primeiro' || JSON.stringify(c?.exige),
        c?.caracteristicas.length === 3 && !c.caracteristicas.some((k) => /design/.test(k.nome)) || `"design compacto" é vago e sai: ${JSON.stringify(c?.caracteristicas)}`,
        JSON.stringify(c?.caracteristicas[0]?.termosEn) === JSON.stringify(['soundstage', 'imaging']) || 'termos em inglês da característica',
        q[0]?.idioma === 'pt-BR' && q[1]?.idioma === 'all' && /what makes/.test(q[1]?.consulta || '') || `buscas de conhecimento: ${JSON.stringify(q)}`,
        ruim === null || 'sem tipo de uso (ou com 1 característica) não há cadeia',
      ];
    },
  },

  {
    nome: 'cadeia do uso: critérios do conhecimento trazem o porquê e substituem o chute do plano; do plano só entra preço',
    tipo: 'unidade',
    executar() {
      const base = m.lerCriteriosDoConhecimento(
        '- palco sonoro e imagem | alto | você ouve de onde vêm os passos | soundstage, imaging, palco\n' +
          '- separação de frequências | alto | os passos não somem no meio dos tiros | separation\n' +
          '- feedback da comunidade | alto | x | y\n' +
          '- isolamento acústico | médio | o barulho de casa não cobre os passos | isolation'
      );
      const plano = [
        { nome: 'design compacto', peso: 'alto', termos: ['design compacto'] },
        { nome: 'preço', peso: 'medio', termos: ['preço'] },
        { nome: 'posicionamento', peso: 'alto', termos: ['posicionamento'] },
      ];
      const final = m.combinarCriterios(base, plano);
      const poucos = m.combinarCriterios(base.slice(0, 2), plano);
      return [
        base.length === 3 && base[0].porque === 'você ouve de onde vêm os passos' || `critérios do conhecimento: ${JSON.stringify(base)}`,
        !base.some((k) => /feedback/.test(k.nome)) || 'critério sobre a pesquisa não entra',
        JSON.stringify(final.map((k) => k.nome)) === JSON.stringify(['palco sonoro e imagem', 'separação de frequências', 'isolamento acústico', 'preço']) ||
          `combinados: ${JSON.stringify(final.map((k) => k.nome))}`,
        poucos === plano || 'com menos de 3 da base, fica o plano de sempre',
      ];
    },
  },

  {
    nome: 'comunidade como evidência: "tenho há 6 anos" é menção, "vai de X, ouço os passos" é recomendação do uso; votos pesam; citações saem dos melhores comentários',
    tipo: 'unidade',
    executar() {
      const topico = (url, sub, linhas) => ({ url, bruto: [`TÓPICO DO REDDIT (r/${sub}): IEM for PUBG?`, 'POST: qual intra pra pubg?', 'COMENTÁRIOS (3, mais votados primeiro):', ...linhas].join('\n') });
      const entradas = [
        topico('https://www.reddit.com/r/iems/comments/a/', 'iems', [
          '- [25 votos] I use the Truthear Hexa for PUBG, the imaging is great and footsteps are clear.',
          '- [3 votos] Do lado mais caro, mas eu tenho os Bose QC20 há 6 anos.',
        ]),
        topico('https://www.reddit.com/r/PUBATTLEGROUNDS/comments/b/', 'PUBATTLEGROUNDS', [
          '- [4 votos] Vai de Truthear Hexa, 1DD+4BA, separação ótima.',
          '- [1 votos] Bose QC20 é confortável.',
        ]),
        topico('https://www.reddit.com/r/iems/comments/c/', 'iems', ['- [8 votos] Truthear Hexa broke after a month, avoid.']),
      ];
      const termos = m.termosDoUso('top 10 fones intra auriculares para jogar pubg de pc');
      const hexa = m.consensoDe('Truthear Hexa', entradas, {}, { termos });
      const bose = m.consensoDe('Bose QC20', entradas, {}, { termos });
      return [
        termos.includes('pubg') && termos.includes('footsteps') || `termos do uso: ${termos}`,
        m.tomDoComentario('eu tenho os Bose QC20 há 6 anos', termos) === 'mencao' || 'posse sem uso é menção',
        m.tomDoComentario('I use the Truthear Hexa for PUBG, footsteps are clear', termos) === 'recomenda' || 'uso próprio no uso pedido é recomendação',
        m.tomDoComentario('XENNS Mangird Top - 530$; Simgot Supermix 4 - 150$; Truthear Zero - 60$', termos) === 'recomenda' || 'lista com preços é recomendação',
        hexa.topicos === 2 && hexa.criticas === 1 || `Hexa: ${hexa.topicos} tópicos que recomendam, ${hexa.criticas} críticas`,
        bose.topicos === 0 && bose.mencoes === 2 || `Bose: ${bose.topicos} que recomendam / ${bose.mencoes} menções`,
        hexa.pontos > bose.pontos + 5 || `Hexa ${hexa.pontos} × Bose ${bose.pontos}`,
        /imaging is great and footsteps are clear/.test(hexa.citacoes[0]?.texto || '') && hexa.citacoes[0].votos === 25 && hexa.citacoes[0].fonte === 'r/iems' ||
          `melhor citação: ${JSON.stringify(hexa.citacoes[0])}`,
        hexa.citacoes.some((c) => c.tom === 'critica') || 'uma crítica entra nas citações (limitação)',
        hexa.citacoes.some((c) => c.tecnico && /1DD\+4BA/.test(c.texto)) || 'comentário técnico entra nas citações',
        !bose.citacoes.some((c) => /6 anos/.test(c.texto)) || 'menção solta sem uso nem dado técnico não é citação',
      ];
    },
  },

  {
    nome: 'cadeia do uso (ponta a ponta): busca "o que torna bom" ANTES dos produtos; critérios com o porquê no plano da resposta; comentários dos usuários pra citar',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        { contem: 'o que torna um fone', paginas: [pagina('Para FPS, o palco sonoro e a imagem importam: você ouve de onde vêm os passos. A separação de frequências evita que os passos sumam nos tiros.')] },
        { contem: 'what makes a good iem', paginas: [pagina('Imaging and soundstage matter most for hearing footsteps in competitive shooters.')] },
        { contem: 'site:', paginas: [pagina('Vai de Alfa X1, ouço os passos de longe no PUBG. Eu tenho o Beta Z2 há 6 anos.')] },
        { contem: 'descoberta', paginas: [pagina('Lista de fones para jogos: Omega Q9, Alfa X1 e Beta Z2.'), pagina('Outra lista de fones: Omega Q9 e Alfa X1.')] },
      ]);
      if (!srv) return [];
      try {
        const obtido = await executarCasoAgente({
          nome: 'cadeia do uso ponta a ponta',
          pedido: 'Quais os melhores fones intra-auriculares para jogar PUBG no PC?',
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false, motorDePesquisa: true },
          cadeiaDoUso: CADEIA,
          criteriosDoConhecimento:
            '- palco sonoro e imagem | alto | você ouve de onde vêm os passos | soundstage, imaging\n' +
            '- separação de frequências | alto | os passos não somem no meio dos tiros | separation\n' +
            '- isolamento acústico | médio | o barulho de casa não cobre os passos | isolation',
          planoDePesquisa: 'USO: jogar PUBG no PC\nCRITÉRIOS:\n- design compacto | alto | compacto\n- preço | médio | preço\nOPÇÕES CITADAS NO PEDIDO:\n- nenhuma\nBUSCAS DE DESCOBERTA:\n- descoberta fones pubg',
          candidatosDePesquisa: '- Alfa X1\n- Omega Q9\n- Beta Z2',
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fones' } }],
          redacao: 'Resposta de teste.',
        });
        const qs = srv.pedidos.map((p) => p.q);
        const iConhecimento = qs.findIndex((q) => /o que torna/.test(q));
        const iDescoberta = qs.findIndex((q) => /descoberta/.test(q));
        const criterios = (obtido.pesquisa.plano?.criterios || []).map((k) => k.nome);
        const plano = obtido.pesquisa.fim?.planoDeResposta || '';
        return [
          iConhecimento >= 0 && iConhecimento < iDescoberta || `conhecimento antes da descoberta: ${JSON.stringify(qs)}`,
          // nível leve: 1 busca de conhecimento (a em inglês entra do médio pra cima — ver unidade acima)
          /palco sonoro e a imagem importam/.test(obtido.promptCriteriosConhecimento) || 'o material do conhecimento chega ao modelo',
          !criterios.includes('design compacto') && criterios[0] === 'palco sonoro e imagem' && criterios.includes('preço') ||
            `critérios finais: ${JSON.stringify(criterios)}`,
          /COMO ESCOLHER PARA JOGO DE TIRO \(FPS\) COMPETITIVO/.test(plano) || 'seção "como escolher" no plano da resposta',
          /- palco sonoro e imagem: você ouve de onde vêm os passos/.test(plano) || 'o porquê de cada critério vai pro redator',
          /O QUE OS USUÁRIOS DIZEM[^\n]*\n\s+"Vai de Alfa X1, ouço os passos de longe no PUBG\./.test(plano) || `citação do usuário no plano: ${plano.slice(plano.indexOf('Alfa X1:'), plano.indexOf('Alfa X1:') + 900)}`,
          obtido.pesquisa.cadeia?.tipoDeUso === 'jogo de tiro (FPS) competitivo' || 'evento da cadeia',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
];
