'use strict';

/**
 * Os sites certos (30/10, análise das pesquisas do Davi: lojas falsas da Bose e o "wukihow" foram lidos como fonte;
 * fazendas de conteúdo no lugar de fontes melhores).
 */

const fs = require('fs');
const path = require('path');
const { imitacao, oficiaisDaPergunta } = require('../../src/tools/imitacao');
const { qualidadeDoDominio } = require('../../src/tools/search');
const nucleo = require('../../src/agent/nucleo');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

module.exports = [
  {
    nome: 'registros do Davi (30/10): prova colada não vai para "consultar o PC" (só pedido curto vai); questão com alternativas não pesquisa nem usa rota do código; "está aí?" é cumprimento',
    tipo: 'unidade',
    executar() {
      const pc = require('../../src/pc/inspetor');
      const prova = `Questão 1 (Incompatibilidade e Impedimento) Roberto, advogado inscrito na OAB, assume o cargo de Diretor de uma Unidade Básica de Saúde. ${'Texto da questão. '.repeat(30)}Nesse caso, quanto ao espaço de atuação dele, assinale a correta, se esta for possível:\n• A) Pode advogar.\n• B) Não pode.`;
      const crase = 'Questão 1 (Emprego da Crase)\n\nAssinale a alternativa correta:\n• A) Fui à praia.\n• B) Fui a praia.';
      return [
        pc.consultasDoPedido(prova).length === 0 || 'prova longa não é pergunta sobre o PC',
        JSON.stringify(pc.consultasDoPedido('quanto espaço tem no meu pc?')) === '["discos"]' || 'pergunta curta continua',
        nucleo.questaoDeProva(prova) && nucleo.questaoDeProva(crase) && !nucleo.questaoDeProva('Qual é melhor: A) RTX 5070 ou B) RX 9070?') || 'questão de prova',
        // só a de exatas responde sem pesquisa; direito e português pesquisam (sem fonte, o modelo inventou artigo de lei)
        nucleo.lerEntendimento('{"precisa_buscar": true}', crase).precisaBuscar === true && nucleo.lerEntendimento('{"precisa_buscar": true}', 'Questão 1: 60 * 2 = ?\nA) 100\nB) 120').precisaBuscar === false || 'pesquisa da prova',
        /const prova = nucleo\.questaoDeProva\(objetivo\);[\s\S]{0,200}!prova \? rotas\.escolherRota/.test(ler('src/agent/loop-nucleo.js')) || 'sem rota do código',
        ['Está aí.', 'Está aí?', 'Jarvis, está aí?', 'Tá me ouvindo?', 'Alô?'].every((p) => nucleo.soCumprimento(p)) && !nucleo.soCumprimento('Está aí o relatório?') || 'está aí',
        // texto longo: o modelo reescrevia tudo em "pergunta", o JSON cortava em 300 tokens e a reserva não pesquisava
        /Se a ÚLTIMA MENSAGEM for longa \(mais de 400 letras/.test(nucleo.pedidoDeEntendimento({ pergunta: 'x', conversa: [], hoje: 'x' })) || 'mensagem longa: "pergunta" vazia',
        nucleo.lerEntendimento('{"precisa_buscar": true, "buscas": ["corta aqui', `${prova}\nSegundo a Lei nº 8.906/94 e o Estatuto da OAB.`).precisaBuscar === true || 'JSON cortado: prova de direito pesquisa',
        nucleo.lerEntendimento('{"precisa_buscar": true}', 'Questão 2: segundo a Lei nº 8.906/94, pode?\nA) Sim\nB) Não').precisaBuscar === true || 'número de lei não é conta',
      ];
    },
  },
  {
    nome: 'voz (30/10): fala curta que soa como a resposta que o AuGPT sugeriu vira ela ("Pais testa." → "pode testar"; "pode parar" não); pedido pela voz não sai "detalhado"',
    tipo: 'unidade',
    executar() {
      const d = require('../../src/ditado');
      const rede = 'Posso medir a sua internet agora.\n\nResponda **"pode testar"** para seguir, ou **"só o ping"** para medir só a latência, quase sem gastar dados.';
      const sim = 'Quer que eu acompanhe **RTX 60**? É só responder **"sim"**.';
      const main = ler('electron/main.js');
      return [
        d.respostaSugeridaParecida('Pais testa.', rede) === 'pode testar' || d.respostaSugeridaParecida('Pais testa.', rede),
        d.respostaSugeridaParecida('Só o pinguim.', rede) === 'só o ping' || 'só o ping',
        d.respostaSugeridaParecida('Pode parar.', rede) === null && d.respostaSugeridaParecida('Qual a previsão do tempo?', rede) === null || 'o que não é resposta fica',
        d.respostaSugeridaParecida('Sim.', sim) === 'sim' && d.respostaSugeridaParecida('Pais testa.', 'Resposta sem sugestão.') === null || 'sem sugestão, nada',
        /const sugerida = original \? require\('\.\.\/src\/ditado'\)\.respostaSugeridaParecida\(original, contexto\) : null;\s*if \(sugerida\) return/.test(main) || 'antes do modelo, mesmo com a correção desligada',
        !/'--prompt'/.test(ler('src/ditado.js')) || 'nada de dica no Whisper (ele tira a frase da dica)',
        /if \(porVoz === true && agent\.config\.modoResposta === 'detalhada'\) agent\.config = \{ \.\.\.agent\.config, modoResposta: 'normal' \};/.test(main) || 'voz não sai detalhada',
        /porVoz: window\.falaPorVoz\?\.pedidoPorVoz === true/.test(ler('renderer/app-abas.js')) || 'a tela avisa que veio pela voz',
      ];
    },
  },
  {
    nome: 'sites certos: loja falsa com o nome da marca e nome quase igual ao de site conhecido são imitação; os de verdade (e os parecidos legítimos) não',
    tipo: 'unidade',
    executar() {
      const imitam = ['bosebrasilsiteoficial.com', 'bose-brazil.com', 'wukihow.com', 'loja-samsung-oficial.com', 'kabumofertas.com.br', 'redddit.com', 'applestore-brasil.net', 'americanasoficial.shop'];
      const legitimos = ['bose.com', 'bose.fandom.com', 'bosebuild.com', 'wikihow.com', 'kabum.com.br', 'reddit.com', 'forum.adrenaline.com.br', 'store.steampowered.com', 'steamcommunity.com', 'pineapple.com', 'terabyteshop.com.br', 'pichau.com.br', 'intelbras.com.br', 'stf.jus.br'];
      return [
        ...imitam.map((d) => Boolean(imitacao(d)) || `devia ser imitação: ${d}`),
        ...legitimos.map((d) => !imitacao(d) || `não é imitação: ${d} (${imitacao(d)?.motivo})`),
        qualidadeDoDominio('https://bose-brazil.com/fone').alerta?.risco === 'alto' || 'imitação = risco alto (sai da pesquisa)',
        qualidadeDoDominio('https://reviewstrails.com/x').tipo === 'conteúdo genérico' || 'fazenda de conteúdo',
        JSON.stringify(oficiaisDaPergunta('o novo fone da Bose')) === '["bose.com","bose.com.br","bose.co.uk"]' && JSON.stringify(oficiaisDaPergunta('decisão do STF')) === '["stf.jus.br"]' && oficiaisDaPergunta('qual a melhor placa?').length === 0 || 'oficiais da pergunta',
      ];
    },
  },
  {
    nome: 'sites certos na pesquisa: imitação sai, o site oficial da marca citada passa na frente, conteúdo genérico fica por último; das respostas anteriores vai só o começo; tempo por site no relatório',
    tipo: 'unidade',
    executar() {
      const res = [
        { url: 'https://bosebrasilsiteoficial.com/fone', nota: 0.9 },
        { url: 'https://reviewstrails.com/bose', nota: 0.85 },
        { url: 'https://www.bose.com/p/qc-ultra', nota: 0.7 },
        { url: 'https://www.rtings.com/headphones/bose', nota: 0.8 },
        { url: 'https://bose-brazil.com/x', nota: 0.95 },
      ];
      const ordem = nucleo.comCredibilidade(res, { oficiais: oficiaisDaPergunta('fone novo da Bose') }).map((r) => new URL(r.url).hostname.replace(/^www\./, ''));
      const longa = `${'O motor a vapor transforma calor em trabalho. '.repeat(40)}\n\n---\n**Fontes**\n1. [x](https://x.com)`;
      const fonte = ler('src/agent/nucleo/index.js');
      return [
        JSON.stringify(ordem) === '["bose.com","rtings.com","reviewstrails.com"]' || JSON.stringify(ordem),
        /conversa\.slice\(-6\)\.map\(\(m\) => \(\{ role: m\.role, content: m\.role === 'assistant' \? comecoDaResposta\(m\.content\)/.test(fonte) || 'começo das respostas',
        /^O motor a vapor/.test(nucleo.comecoDaResposta ? nucleo.comecoDaResposta(longa) : 'O motor a vapor') || 'começo',
        /s\.falhas \+= 1;/.test(ler('src/agent/loop-nucleo.js')) && /Sites lentos:/.test(ler('renderer/app-historico.js')) || 'tempo por site',
      ];
    },
  },
];
