'use strict';

/**
 * Conversas reais de 3 e 4/11: a fonte Corsair RM1000x ficou sem preço três vezes, o currículo virou
 * tabela de campos, "crie uma imagem dessa placa de som" desenhou outra placa e "Hoje (31/10)" no dia 3/11.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const precos = require('../../src/tools/precos');
const { casa } = require('../../src/agent/onde-comprar');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'fora do assunto: "rm1000x" (o nome vira "RM 1000x") casa com a página que escreve "RM1000x" — antes as páginas certas saíam todas; a RM850x continua fora',
    tipo: 'unidade',
    executar() {
      const itens = ['Corsair RM1000x 1000W: Preço Hoje e Histórico | Hardware Barato', 'Fonte Corsair RM1000x, 1000W, 80 Plus Gold', 'Corsair RM850x review']
        .map((t, i) => ({ f: { titulo: t, n: i + 1 }, texto: `texto sobre a ${t}`, semelhanca: 0.8 - i * 0.01, palavras: true }));
      const ficou = nucleo.semFontesForaDoAssunto('qual o preço hoje da fonte fonte corsair rm1000x', itens).map((x) => x.f.titulo);
      const rtx = nucleo.padraoDoProduto('RTX 5070');
      return [
        JSON.stringify(ficou) === JSON.stringify(itens.slice(0, 2).map((x) => x.f.titulo)) || JSON.stringify(ficou),
        rtx.test('placa rtx5070 nova') && rtx.test('rtx 5070') && rtx.test('a 5070 da nvidia') || String(rtx),
      ];
    },
  },
  {
    nome: 'lojas: "Fonte Corsair RM1000x … Com Cabo" é a fonte, não um cabo; "Cabo de força para fonte" e "Capa para iPhone" continuam acessório',
    tipo: 'unidade',
    executar() {
      const fonte = 'Fonte Corsair RM1000x SHIFT, 1000W, 80 Plus Gold, Totalmente Modular, PFC Ativo, Com Cabo, Preto';
      return [
        precos.ehOProduto(fonte, 'fonte corsair rm1000x') && casa(fonte, 'corsair rm1000x') || 'a fonte com cabo',
        !precos.ehOProduto('Cabo de força para Fonte Corsair RM1000x', 'fonte corsair rm1000x') && !casa('Cabo de força para Fonte Corsair RM1000x', 'corsair rm1000x') || 'cabo avulso',
        !casa('Capa para iPhone 15', 'iphone 15') || 'capa',
      ];
    },
  },
  {
    nome: 'documento anexado: "o que você acha desse currículo?" pede avaliação (pontos fortes, o que melhorar, o que falta), não a tabela de campos',
    tipo: 'unidade',
    executar() {
      const s = ler('skills/analisar-documento/SKILL.md');
      return [
        /Pedido de opinião ou de melhoria[\s\S]*sem tabela de campos/.test(s) || 'a regra da opinião',
        /Opinião sobre a escrita de um documento/.test(s) || 'opinião pode ser dada',
      ];
    },
  },
  {
    nome: 'imagem: "dessa placa de som" leva a última resposta ao prompt; "--v 5" e "--ar 16:9" saem do prompt; logo ilegível não refaz a imagem',
    tipo: 'unidade',
    executar() {
      const indice = ler('src/agent/nucleo/index.js');
      const p = nucleo.lerPrompt('{"prompt": "close-up of a black USB sound card, studio lighting --v 5 --ar 16:9"}', 'x').prompt;
      return [
        p === 'close-up of a black USB sound card, studio lighting' || p,
        /Sua última resposta \(quando o pedido diz "dessa"/.test(indice) || 'a última resposta no prompt',
        /Logo, marca ou letreiro ilegível NÃO é motivo para refazer/.test(indice) || 'a revisão',
      ];
    },
  },
  {
    nome: 'data: "Hoje (31/10/2026)" no dia 3/11 vira "Em 31/10/2026"; com a data de hoje, fica',
    tipo: 'unidade',
    executar() {
      const hoje = new Date(2026, 10, 3, 14);
      const t1 = nucleo.conferirResposta('Hoje (31/10/2026), o menor preço é R$ 8.359,02 na KaBuM!.', { material: 'R$ 8.359,02', hoje }).texto;
      const t2 = nucleo.conferirResposta('Hoje (03/11/2026), o menor preço é R$ 8.359,02.', { material: 'R$ 8.359,02', hoje }).texto;
      return [
        /^Em 31\/10\/2026, o menor preço/.test(t1) || t1,
        /^Hoje \(03\/11\/2026\)/.test(t2) || t2,
      ];
    },
  },
  {
    nome: 'lojas sem o modelo e resposta repetida (5/11): a nota diz o que veio nas lojas; 90% das palavras iguais é repetição, 58% (as duas respostas da Corsair) não; o alerta acende para a página do produto tirada e o "não encontrei o preço"',
    tipo: 'unidade',
    executar() {
      const { notaSemNasLojas } = require('../../src/agent/compras-no-chat');
      const { mesmaResposta } = require('../../src/agent/resposta-repetida');
      const { alertasDe } = require('../alertas');
      const base = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ');
      const metade = Array.from({ length: 60 }, (_, i) => (i % 2 ? `outra${i}` : `palavra${i}`)).join(' ');
      const nota = notaSemNasLojas({ produto: 'Fonte Corsair RM1000X', total: 62, parecidos: ['Fonte Corsair CX650'] });
      const alertas = alertasDe({
        objetivo: 'qual o preço hoje da fonte corsair rm1000x',
        resposta: 'Não encontrei nas fontes pesquisadas o preço exato de hoje.',
        avisos: ['fora do assunto, ficaram de fora da resposta: Corsair RM1000x 1000W: Preço Hoje e Histórico | Hardware Barato · Fonte Corsair RM850x'],
        duracaoMs: 81000,
      });
      return [
        /trouxe 62 ofertas, nenhuma desse modelo exato — as mais parecidas: Fonte Corsair CX650/.test(nota) || nota,
        mesmaResposta(base, `${base} fim`) && !mesmaResposta(base, metade) && !mesmaResposta('curta', 'curta') || 'repetição',
        alertas.length === 2 && /filtro tirou 1 página\(s\) do produto: Corsair RM1000x/.test(alertas[0]) && /não achou/.test(alertas[1]) || JSON.stringify(alertas),
        /if \(deps\.diagnostico\?\.lojas && r\.rota === 'pesquisa'/.test(ler('src/agent/loop-nucleo.js')) || 'ligado na resposta',
      ];
    },
  },
  {
    nome: 'produto em até 3 opções (5/11, mais rápido), mas o número do usuário manda: "top 5" = 5, "três teclados" = 3, "top dez" = 10; "monitor de 27 polegadas" e "melhor mouse" não pedem número',
    tipo: 'unidade',
    executar() {
      const casos = { 'Me recomende um top 5 melhores fones intra auriculares': 5, 'os 10 melhores iems para música': 10, 'me indica três teclados': 3, 'top dez jogos de 2026': 10, 'monitor de 27 polegadas 144hz': null, 'Qual o melhor mouse para jogos de tiro até R$ 300?': null };
      const errados = Object.entries(casos).filter(([q, n]) => nucleo.opcoesPedidas(q) !== n).map(([q]) => `${q} → ${nucleo.opcoesPedidas(q)}`);
      const indice = ler('src/agent/nucleo/index.js');
      return [
        errados.length === 0 || errados.join(' · '),
        /No máximo 3 opções — as melhores para o pedido/.test(indice) && /O usuário pediu \$\{opcoesPedidas\(pergunta\)\} opções/.test(indice) || 'as regras na escrita',
      ];
    },
  },
  {
    nome: 'explicação estável de memória (5/11, "ele sempre tenta pesquisar"): como funciona / o que é / por que / diferença entre saem sem busca mesmo com o modelo marcando busca; produto, modelo com número, "hoje", ano, link e pedido de pesquisa continuam pesquisando; a escrita é de pessoa e oferece a pesquisa',
    tipo: 'unidade',
    executar() {
      const modeloQuerBuscar = JSON.stringify({ precisa_buscar: true, muda_com_o_tempo: true, produto: false });
      // 9/11: o pedido também vem depois de "eu queria saber", "você sabe", "me diz", "oi," (o processador virou conversa)
      const sem = ['Como funciona o wifi ?', 'Por que o céu é azul?', 'Qual a diferença entre SSD e HD?', 'O que é fotossíntese?', 'me explica como funciona um alto falante', 'Eu queria saber como funciona exatamente um processador ?', 'você sabe como funciona um ssd?', 'me diz o que é inflação', 'oi, como funciona o wifi?'];
      const com = ['como funciona a RTX 5070 Ti?', 'o que é o DLSS 4?', 'como funciona o wifi 7 hoje?', 'o que é o Pix Automático lançado em 2025?', 'pesquise como funciona um ssd', 'Me conte quem foi nicola tesla', 'o que é isso https://exemplo.com'];
      const errados = [
        ...sem.filter((q) => nucleo.lerEntendimento(modeloQuerBuscar, q).precisaBuscar).map((q) => `pesquisou: ${q}`),
        ...com.filter((q) => !nucleo.lerEntendimento(modeloQuerBuscar, q).precisaBuscar).map((q) => `não pesquisou: ${q}`),
        ...(nucleo.lerEntendimento(JSON.stringify({ produto: true }), 'o que é a melhor placa de vídeo até 3 mil?').precisaBuscar ? [] : ['produto sem busca']),
        // 9/11: pedido com forma de explicação nunca vira conversa — com nome próprio, pesquisa
        ...['Me explique como que funciona a teoria da relatividade de Albert Einstein', 'Me explique como funciona o fone Dunu Titan S'].filter((q) => { const e = nucleo.lerEntendimento(JSON.stringify({ precisa_buscar: false, conversa: true }), q); return e.conversa || !e.precisaBuscar; }).map((q) => `virou conversa: ${q}`),
      ];
      const indice = ler('src/agent/nucleo/index.js');
      return [
        errados.length === 0 || errados.join(' · '),
        /Agora é uma EXPLICAÇÃO, sem pesquisa/.test(indice) && /if \(ent\.explicacao && !usadas\.length && !oferta\)/.test(indice) || 'escrita de pessoa e a oferta',
      ];
    },
  },
  {
    nome: 'nomes difíceis de produto (4/11): colado, com hífen ou separado — rm1000x, i5-12400F, RX7600XT, WH1000XM5, 7800X3D, SN850X, B580, RTX5070Ti — casam no filtro de assunto e nas lojas; os vizinhos (RM850x, RX 7600, WH-1000XM4, 13400F, SN850X 2TB, RTX 5070) não',
    tipo: 'unidade',
    executar() {
      const { produtosDoPedido } = require('../../src/agent/serie-de-precos');
      const { normalizar } = require('../../src/agent/nucleo/ranking');
      const CASOS = [
        ['qual o preço da fonte corsair rm1000x', 'corsair rm1000x', ['Fonte Corsair RM1000x, 1000W, 80 Plus Gold, Com Cabo', 'Corsair RM1000x Shift 1000W'], ['Fonte Corsair RM850x 850W', 'Fonte Corsair RM1000e']],
        ['quanto custa o i5-12400f', 'i5-12400f', ['Processador Intel Core i5-12400F, 2.5GHz, LGA1700', 'Intel Core i5 12400F Box'], ['Processador Intel Core i5-12400, 2.5GHz', 'Intel Core i5-13400F']],
        ['preço da rx 7600 xt', 'rx 7600 xt', ['Placa de Vídeo ASRock Radeon RX 7600 XT Challenger 16GB', 'Sapphire Pulse RX7600XT 16GB'], ['Placa de Vídeo ASRock Radeon RX 7600 Challenger 8GB']],
        ['quanto está o fone sony wh-1000xm5', 'sony wh-1000xm5', ['Fone de Ouvido Sony WH-1000XM5 Bluetooth, Preto', 'Headphone Sony WH1000XM5'], ['Fone de Ouvido Sony WH-1000XM4', 'Capa para Sony WH-1000XM5']],
        ['preço do ryzen 7 7800x3d', 'ryzen 7 7800x3d', ['Processador AMD Ryzen 7 7800X3D, 4.2GHz, AM5', 'AMD Ryzen 7 7800X3D Box'], ['Processador AMD Ryzen 7 7700X', 'AMD Ryzen 9 7950X3D']],
        ['quanto custa o ssd wd black sn850x 1tb', 'wd black sn850x 1tb', ['SSD WD Black SN850X 1TB NVMe M.2', 'SSD 1TB WD_BLACK SN850X, PCIe 4.0'], ['SSD WD Black SN770 1TB', 'SSD WD Black SN850X 2TB']],
        ['preço da intel arc b580', 'intel arc b580', ['Placa de Vídeo Intel Arc B580 12GB', 'ASRock Intel Arc B580 Challenger OC'], ['Placa de Vídeo Intel Arc B570 10GB']],
        ['quanto está a rtx 5070 ti', 'rtx 5070 ti', ['Placa de Vídeo MSI GeForce RTX 5070 Ti Ventus 3X OC 16GB', 'Gigabyte RTX5070Ti Gaming OC'], ['Placa de Vídeo MSI GeForce RTX 5070 12GB', 'PC Gamer RTX 5070 Ti Ryzen 7']],
      ];
      const erros = [];
      for (const [pergunta, produto, sim, nao] of CASOS) {
        const pads = produtosDoPedido(pergunta).map((e) => nucleo.padraoDoProduto(e?.nome || e)).filter(Boolean);
        for (const t of sim) if (!(pads.every((re) => re.test(normalizar(t))) && precos.ehOProduto(t, produto) && casa(t, produto))) erros.push('devia casar: ' + t);
        for (const t of nao) if (precos.ehOProduto(t, produto)) erros.push('não devia: ' + t);
      }
      return [erros.length === 0 || erros.join(' · ')];
    },
  },
];
