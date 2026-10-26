'use strict';

/**
 * A conversa do Davi de 25–26/10 revista: a correção de fala trocou "Iconha" por "Icoaraci"; a chamada
 * veio no meio do pedido; "o preço dessa placa" buscou "dessa placa"; "[preferencias_do_usuario]" vazou;
 * "Itanhaém, Espírito Santo" mostrou SP calado; "o que tem na minha tela?" pesquisou na web; "o que voce
 * saber sobre min" não foi para a memória.
 */

const fs = require('fs');
const path = require('path');
const d = require('../../src/ditado');

module.exports = [
  {
    nome: 'correção de fala só ajusta: "Iconha" → "Icoaraci" e "está" → "custa" derrubam a correção; acento, "50 80" → "5080", "rayzen" → "Ryzen", "pub gi" → "PUBG" passam; acrescentar o estado não passa',
    tipo: 'unidade',
    executar() {
      const casos = [
        ['Qual a previsão do tempo para a cidade de Iconha?', 'Qual a previsão do tempo para a cidade de Icoaraci?', false],
        ['quanto esta a rtx 50 80 hoje nas lojas', 'Quanto custa a RTX 5080 hoje nas lojas?', false],
        ['quanto esta a rtx 50 80 hoje nas lojas', 'Quanto está a RTX 5080 hoje nas lojas?', true],
        ['qual a previsão do tempo pra amanha em campinas', 'Qual a previsão do tempo para amanhã em Campinas?', true],
        ['pesquisa pra mim o melhor fone in iar até 300 reais pra jogar pub gi', 'Pesquisa pra mim o melhor fone In Ear até 300 reais pra jogar PUBG.', true],
        ['compare o rayzen 7 9800 x3d com o core ultra 9 285 k', 'Compare o Ryzen 7 9800X3D com o Core Ultra 9 285K.', true],
        ['Qual a data de hoje? Qual a data de hoje?', 'Qual a data de hoje?', true],
        ['qual a previsão do tempo em iconha', 'Qual a previsão do tempo em Iconha, Espírito Santo?', false],
      ];
      const errados = casos.filter(([o, c, ok]) => Boolean(d.correcaoAceitavel(o, c)) !== ok).map(([, c]) => c);
      return [errados.length === 0 || `errou: ${errados.join(' | ')}`, /NUNCA troque nomes de cidades/.test(d.pedidoDeCorrecao('x')) || 'instrução dos nomes próprios'];
    },
  },
  {
    nome: 'pedido falado: a chamada no meio e a frase repetida saem ("Procure vídeos. E aí, GPT. Procure vídeos." → uma vez); frases diferentes ficam',
    tipo: 'unidade',
    executar() {
      const a = d.limparPedidoFalado('Procure por vídeos dessa placa de vídeo. E aí, GPT. Procure por vídeos dessa placa de vídeo.');
      d.definirNome('Ei Jarvis');
      const b = d.limparPedidoFalado('Que horas são? Ei Jarvis. Que horas são?');
      const c = d.limparPedidoFalado('Abre a agenda. Depois mostra o clima.');
      d.definirNome('GPT');
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      return [
        a === 'Procure por vídeos dessa placa de vídeo.' || a,
        b === 'Que horas são?' || b,
        c === 'Abre a agenda. Depois mostra o clima.' || c,
        /limparPedidoFalado\(semChamada\(r\.texto/.test(main) || 'aplicado no pedido de voz',
      ];
    },
  },
  {
    nome: '"o preço DESSA placa" / "quanto está ELA?": o padrão não busca a referência, mas a intenção de preço vale (o entendimento completa o nome); "qual a melhor placa?" não é preço',
    tipo: 'unidade',
    executar() {
      const c = require('../../src/agent/compras-no-chat');
      return [
        c.pedidoDeCompras('Qual o preço dessa placa de vídeo hoje?') === null && c.intencaoDeCompras('Qual o preço dessa placa de vídeo hoje?') || 'dessa placa',
        c.pedidoDeCompras('qual o preço dela hoje?') === null && c.intencaoDeCompras('qual o preço dela hoje?') || 'dela',
        JSON.stringify(c.pedidoDeCompras('quanto está a RTX 5080?')) === '{"produto":"RTX 5080"}' || 'produto com nome segue igual',
        !c.intencaoDeCompras('qual a melhor placa?') || 'recomendação não é preço',
        // a categoria na frente sai do nome ("Placa DE Vídeo Asus…") e "usado" vira o pedido do usado
        JSON.stringify(c.pedidoDeCompras('Qual o preço da placa de vídeo Asus ROG Astral RTX 5080?')) === '{"produto":"Asus ROG Astral RTX 5080"}' || 'categoria',
        JSON.stringify(c.pedidoDeCompras('quanto está a Asus ROG Astral RTX 5080 usada?')) === '{"produto":"Asus ROG Astral RTX 5080","usado":true}' || 'usado',
        JSON.stringify(c.pedidoDeCompras('quanto está o monitor?')) === '{"produto":"monitor"}' || 'categoria sozinha fica',
        /pedido: \{ produto: base, \.\.\.\(p\.usado/.test(fs.readFileSync(path.join(__dirname, '../../src/agent/compras-no-chat.js'), 'utf8')) || 'sem o modelo exato, o modelo-base',
        /compras\.pedidoDeCompras\(ent\.pergunta\)/.test(fs.readFileSync(path.join(__dirname, '../../src/agent/rotas-do-codigo.js'), 'utf8')) || 'a ação usa a pergunta reescrita',
      ];
    },
  },
  {
    nome: 'escrita: a marcação dos blocos internos ("[preferencias_do_usuario]") não aparece na resposta, e nada é atribuído às preferências se não está nelas; pergunta só sobre a imagem anexada não pesquisa ("o que tem na minha tela?"), "que erro é esse?" pesquisa',
    tipo: 'unidade',
    executar() {
      const n = require('../../src/agent/nucleo');
      const fonte = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      const comImagem = (p) => n.lerEntendimento('{"precisa_buscar":true}', p, { comImagem: true }).precisaBuscar;
      return [
        /preferencias_do_usuario\|sobre_o_usuario\|anotacoes_do_pesquisador/.test(fonte) || 'marcação removida',
        /nunca diga que algo é .{0,4}preferência registrada/.test(fonte) || 'instrução das preferências',
        comImagem('O que que tem na minha tela?') === false && comImagem('Descreva essa imagem') === false && comImagem('traduz isso') === false || 'sobre a imagem: sem busca',
        comImagem('Que erro é esse?') === true && n.lerEntendimento('{"precisa_buscar":true}', 'O que que tem na minha tela?', { comImagem: false }).precisaBuscar === true || 'o resto busca',
      ];
    },
  },
  {
    nome: 'clima: o estado pedido sem cidade com esse nome é avisado ("Não achei Itanhaém em Espírito Santo — mostrando Itanhaém, SP"); memória entende "o que voce saber sobre min"',
    tipo: 'unidade',
    async executar() {
      const clima = require('../../src/agent/clima-no-chat');
      const m = require('../../src/agent/memoria-no-chat');
      const resultados = [{ name: 'Itanhaém', admin1: 'São Paulo', country: 'Brasil', country_code: 'BR', latitude: -24.18, longitude: -46.78, population: 100000 }];
      const deps = { baixar: async () => ({ ok: true, texto: JSON.stringify({ results: resultados }) }) };
      const errado = await clima.acharCidade('Itanhaém, Espírito Santo', { deps });
      const certo = await clima.acharCidade('Itanhaém, SP', { deps });
      const fonte = fs.readFileSync(path.join(__dirname, '../../src/agent/clima-no-chat.js'), 'utf8');
      return [
        errado.pistaQueNaoBateu === 'Espírito Santo' && errado.rotulo === 'Itanhaém, SP' || JSON.stringify(errado),
        certo.pistaQueNaoBateu === null || 'estado certo não avisa',
        /Não achei \*\*\$\{lugar\.nome\}\*\* em \$\{lugar\.pistaQueNaoBateu\}/.test(fonte) || 'o aviso na resposta',
        m.pedidoDeMemoria('Me diga o que voce saber sobre min ?') === 'listar' && m.pedidoDeMemoria('o que você sabe sobre mineração?') === null || 'memória com erro de digitação',
      ];
    },
  },
];
