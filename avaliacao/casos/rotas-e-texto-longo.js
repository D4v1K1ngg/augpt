'use strict';

/**
 * 18/11 (Davi: mandou uma prova de 10 questões e a resposta foi a tabela dos ajustes da placa de rede): as palavras das
 * rotas do código ("placa de rede" numa alternativa) não decidem um texto longo colado — quem escolhe a ação é o modelo;
 * e a prova com "Pergunta 1 … a. b. c." é reconhecida como prova.
 */

const rotas = require('../../src/agent/rotas-do-codigo');
const fs = require('fs');
const nucleo = require('../../src/agent/nucleo');

const PROVA = `Responda as seguintes questões: Pergunta 1

    Um dos tipos de dispositivos de E/S são os dispositivos de blocos. Assinale a alternativa correta.
    \ta. \tOs dispositivos de blocos não são endereçáveis.
    \tb. \tA impressora, o mouse e a placa de rede são exemplos de dispositivos de blocos.
    \tc. \tEsses dispositivos perdem a informação quando a energia é desligada.

0,25 pontos
Pergunta 2

    Qual componente desativa a economia de energia da placa?
    \ta. \tO driver.
    \tb. \tO DNS.`;

module.exports = [
  {
    nome: 'texto longo colado não cai numa rota por palavra (a prova com "placa de rede" → o modelo decide); pedido curto continua direto',
    tipo: 'unidade',
    executar() {
      const longa = `${PROVA}\n${'Mais uma linha de texto colado.\n'.repeat(6)}`;
      return [
        rotas.textoLongo(longa) === true && rotas.escolherRota({ objetivo: longa, conversa: [], config: {} }) === null || 'a prova não escolhe rota',
        rotas.reconhecida({ objetivo: 'otimize a placa de rede', conversa: [], config: {} })?.rota.id === 'ajustes_de_rede' && rotas.escolherRota({ objetivo: 'quanto é 12*7?', conversa: [], config: {} })?.rota.id === 'conta' || 'o pedido curto continua reconhecido',
        rotas.ROTAS.filter((r) => r.aceitaTextoLongo).map((r) => r.id).join() === 'audio_transcrito,boleto' || 'só o áudio e o boleto aceitam texto longo',
        rotas.textoLongo(`resuma este arquivo\n\nArquivos anexados, já copiados para a pasta de trabalho:\n- ${'x'.repeat(900)}`) === false || 'os anexos não contam',
        nucleo.questaoDeProva(PROVA) === true || '"Pergunta 1" com "a." é prova',
        nucleo.questaoDeProva('Questão 1\na) sim\nb) não') === true && nucleo.questaoDeProva('qual a pergunta 1 do Enem?') === false || 'o formato antigo continua; pergunta solta não',
      ];
    },
  },
  {
    nome: 'utilitários pelo modelo (19/11): PC, rede, clima, mapa e calendário o entendimento escolhe e o modelo escreve com os dados (o cartão fica acima); o código vira reserva; conta e timer continuam no atalho',
    tipo: 'unidade',
    executar() {
      const ler = (x) => fs.readFileSync(require('path').join(__dirname, '../..', x), 'utf8').replace(/\r/g, '');
      const n = ler('src/agent/nucleo/index.js');
      const CARTAO = '```clima\n{"local":"Campinas"}\n```';
      const { cartoes, resto } = nucleo.separarCartoes(`Agora em **Campinas**: 29°.\n\n${CARTAO}`);
      return [
        ['clima', 'mapa', 'calendario', 'consultar_pc', 'diagnostico_da_rede', 'trafego_de_rede', 'rota_de_jogo', 'teste_de_rede'].every((id) => rotas.ROTAS.find((r) => r.id === id)?.peloModelo === true) || 'as rotas do modelo',
        ['vai chover amanhã em Campinas?', 'quanto espaço livre tem no meu pc?', 'onde fica a torre eiffel?', 'que dia é hoje?'].every((t) => rotas.escolherRota({ objetivo: t, conversa: [], config: {} }) === null) || 'a palavra não decide',
        rotas.intencao('quantos dias faltam para o Natal?') === 'calendario' && rotas.intencao('quanto espaço livre tem no meu pc?') === 'consultar_pc' || 'o código é a reserva',
        ['quanto é 12*7?', 'coloca um timer de 5 minutos'].map((t) => rotas.escolherRota({ objetivo: t, conversa: [], config: {} })?.rota.id).join() === 'conta,timer' || 'os atalhos que ficam',
        // a cotação também é do modelo (19/11): o entendimento a conhece, a trava aceita, e ela é leitura
        rotas.escolherRota({ objetivo: 'cotação do dólar', conversa: [], config: {} }) === null && rotas.intencao('quanto está o euro?') === 'cotacao' && nucleo.acaoValida('cotacao', 'quanto está o dólar?') === 'cotacao' && nucleo.LEITURAS_DO_APP.includes('cotacao') || 'cotação pelo modelo',
        rotas.ROTAS.find((r) => r.id === 'ajustes_de_rede').peloModelo({ tipo: 'planejar' }) === true && rotas.ROTAS.find((r) => r.id === 'ajustes_de_rede').peloModelo({ tipo: 'aplicar' }) === false || '"aplicar" o plano continua pelo código',
        cartoes === CARTAO && resto === 'Agora em **Campinas**: 29°.' || 'cartão para a tela, dados para o escritor',
        !nucleo.LEITURAS_DO_APP.includes('teste_de_rede') && !nucleo.LEITURAS_DO_APP.includes('ajustes_de_rede') || 'teste de velocidade e ajustes têm resposta própria',
        n.includes("if (!ent.acao && LEITURAS_DO_APP.includes(ent.sugerir)) [ent.acao, ent.sugerir] = [ent.sugerir, ''];") || 'leitura sugerida roda',
        n.includes('const texto = cartoesDaFerramenta ? `${cartoesDaFerramenta}\\n\\n${comCautela}` : comCautela;') || 'o cartão acima do texto do modelo',
      ];
    },
  },
];
