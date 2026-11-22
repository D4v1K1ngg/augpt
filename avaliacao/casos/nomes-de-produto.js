'use strict';

/**
 * Nomes de produto (22/11, Davi: "ele ainda traz nomes estranhos"): consenso entre tópicos de sites diferentes, o mesmo
 * modelo com o nome cortado, o que não é marca e modelo, e o candidato de outro tipo (headset num pedido de intra-auricular).
 */

const nucleo = require('../../src/agent/nucleo');

module.exports = [
  {
    nome: 'nomes de produto: o citado em tópicos de 2 sites vem antes do repetido num tópico só; nome cortado ("Technica ATH-M40x", "Bio H801") é o mesmo modelo; frase do modelo ("IEMs com tuning de graves…") não é produto',
    tipo: 'unidade',
    executar() {
      const fontes = [
        { n: 1, url: 'https://forum.x.com.br/a', titulo: 'Fones para FPS', comunidade: true, trechos: ['Redragon Bio H801 é top. Redragon Bio H801 de novo, Redragon Bio H801 sempre. Tenho também o Truthear Hexa.'] },
        { n: 2, url: 'https://www.reddit.com/r/iems/b', titulo: 'IEM for FPS', comunidade: true, trechos: ['Truthear Hexa for footsteps, Truthear Hexa again.'] },
      ];
      const c = nucleo.citadosNaComunidade(fontes, 'melhor fone intra auricular para pubg');
      const nomes = nucleo.modelosCitados(['Audio-Technica ATH-M40x é ótimo. O Audio-Technica ATH-M40x de novo. Technica ATH-M40x. Technica ATH-M40x.', 'Redragon Bio H801 bom, Redragon Bio H801. Bio H801, Bio H801.']);
      const bloco = nucleo.blocoDaComunidade(c);
      return [
        c[0]?.nome === 'Truthear Hexa' && c[0].sites === 2 && c[1]?.nome === 'Redragon Bio H801' || JSON.stringify(c),
        /citado em um tópico só/.test(bloco) && /A 1ª opção é um dos citados em mais de um tópico/.test(bloco) || bloco,
        nomes.length === 2 && nomes.some((n) => n === 'Audio-Technica ATH-M40x') && nomes.some((n) => /Redragon Bio H801/i.test(n)) || JSON.stringify(nomes),
        JSON.stringify(nucleo.modelosCitados(['Logitech G305 Gaming é bom, Logitech G305 Gaming de novo. KZ EDX Intra-auricular, KZ EDX Intra-auricular.'])) === '["Logitech G305","KZ EDX"]' || `a palavra do tipo no fim sai: ${JSON.stringify(nucleo.modelosCitados(['Logitech G305 Gaming é bom, Logitech G305 Gaming de novo. KZ EDX Intra-auricular, KZ EDX Intra-auricular.']))}`,
        nucleo.mesmoModelo('Technica ATH-M40x', 'Audio-Technica ATH-M40x') && !nucleo.mesmoModelo('KZ ZSN', 'Tin T2') || 'mesmo modelo',
        ['Truthear Zero', 'Shure SE215', 'Moondrop Chu II'].every(nucleo.pareceModelo) || 'modelo de verdade',
        !['IEMs com tuning de graves baixos e ganho de pinna', 'Modelos com drivers de armadura balanceada', 'Opções entre 20-50 dólares'].some(nucleo.pareceModelo) || 'frase não é produto',
      ];
    },
  },
  {
    nome: 'nomes de produto (recência): tópico com mais de 4 anos não conta como site do consenso; o citado só em tópicos antigos vai para o fim, com o ano no bloco do escritor; página sem data conta como recente; a data do tópico do Reddit vem do JSON',
    tipo: 'unidade',
    executar() {
      const hoje = new Date('2026-11-22');
      const fontes = [
        { n: 1, url: 'https://www.reddit.com/r/gamesEcultura/a', titulo: 'Fone para PUBG', comunidade: true, data: '2018-03-02', trechos: ['HyperX Cloud Stinger é o melhor, HyperX Cloud Stinger sempre. Tem o Truthear Hexa também.'] },
        { n: 2, url: 'https://forum.adrenaline.com.br/b', titulo: 'Fones FPS', comunidade: true, data: '2019-05-01', trechos: ['HyperX Cloud Stinger de novo.'] },
        { n: 3, url: 'https://www.reddit.com/r/iems/c', titulo: 'IEM for FPS', comunidade: true, data: '2025-01-10', trechos: ['Truthear Hexa for footsteps.'] },
        { n: 4, url: 'https://www.head-fi.org/d', titulo: 'FPS IEM', comunidade: true, trechos: ['Truthear Hexa is great.'] },
      ];
      const c = nucleo.citadosNaComunidade(fontes, 'melhor fone intra auricular para pubg', { hoje });
      const bloco = nucleo.blocoDaComunidade(c);
      const { topicoDoReddit } = require('../../src/tools/comunidade');
      const reddit = topicoDoReddit([{ data: { children: [{ data: { title: 'IEM for FPS', subreddit: 'iems', created_utc: 1704067200 } }] } }, { data: { children: [] } }]);
      return [
        c[0]?.nome === 'Truthear Hexa' && c[0].sites === 2 && c[1]?.nome === 'HyperX Cloud Stinger' && c[1].soAntigos === 2019 || JSON.stringify(c),
        /HyperX Cloud Stinger \[1\]\[2\] — só em tópico antigo \(2019\)/.test(bloco) || bloco,
        reddit?.data === '2024-01-01' || `data do Reddit: ${reddit?.data}`,
      ];
    },
  },
  {
    nome: 'nomes de produto: na pesquisa, o candidato de outro tipo (headset num pedido de intra-auricular) sai da lista da comunidade, com aviso; a busca pelo nome é feita uma vez; a resposta quebrada não tira ninguém',
    tipo: 'unidade',
    async executar() {
      const rodar = async (resposta) => {
        const buscasPeloNome = [];
        const avisos = [];
        const deps = {
          emit: (tipo, d) => (tipo === 'aviso' ? avisos.push(d.texto) : null),
          chamar: async (messages, opcoes = {}) => {
            const texto = messages.map((m) => m.content).join('\n');
            if (opcoes.json && /Candidatos citados nas fontes/.test(texto)) {
              const n = (nome) => (/^(\d+)\. (.+)$/gm.exec(texto) && [...texto.matchAll(/^(\d+)\. (.+)$/gm)].find((m) => m[2] === nome)?.[1]);
              return { content: resposta(n) };
            }
            if (opcoes.json) return { content: '{}' };
            return { content: '', chamadas: [{ function: { name: 'pronto', arguments: {} } }] };
          },
          buscar: async (q) => {
            if (/^(Truthear Hexa|HyperX Stinger)$/.test(q)) buscasPeloNome.push(q);
            return [0, 1].map((i) => ({ titulo: `${q} ${i}`, url: `https://loja${i}.com/${encodeURIComponent(q)}`, resumo: 'texto' }));
          },
          buscarNaComunidade: async (q) => [0, 1].map((i) => ({ titulo: `${q} — tópico ${i}`, url: `https://forum${i}.com.br/${encodeURIComponent(q)}`, resumo: 'discussão' })),
          lerPagina: async () => ({ texto: 'Truthear Hexa for footsteps. HyperX Stinger is fine. Truthear Hexa again, HyperX Stinger again. '.repeat(5) }),
        };
        const fontes = await nucleo.pesquisar({ pergunta: 'qual o melhor fone intra auricular para jogar PUBG competitivo?', modo: 'normal', deps, hoje: 'x', produto: true, buscasIniciais: ['melhor fone intra auricular PUBG'] });
        return { citados: (fontes.citadosNaComunidade || []).map((c) => c.nome), avisos, buscasPeloNome };
      };
      const conferido = await rodar((n) => JSON.stringify({ candidatos: [{ n: Number(n('Truthear Hexa')), tipo: 'fone intra-auricular', serve: true }, { n: Number(n('HyperX Stinger')), tipo: 'headset', serve: false }] }));
      const quebrado = await rodar(() => 'não sei');
      return [
        conferido.citados.includes('Truthear Hexa') && !conferido.citados.includes('HyperX Stinger') || `citados: ${conferido.citados}`,
        conferido.avisos.some((a) => /fora do tipo pedido: HyperX Stinger \(headset\)/.test(a)) || `avisos: ${conferido.avisos.join(' | ')}`,
        conferido.buscasPeloNome.filter((q) => q === 'HyperX Stinger').length === 1 || `uma busca por nome: ${conferido.buscasPeloNome}`,
        quebrado.citados.includes('Truthear Hexa') && quebrado.citados.includes('HyperX Stinger') || `resposta quebrada tira ninguém: ${quebrado.citados}`,
      ];
    },
  },
];
