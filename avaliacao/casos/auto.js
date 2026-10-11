'use strict';

/**
 * Modo AUTO (10/10/2026) e as correções da análise do SR-71: nível do
 * pedido, resposta rápida com ficha de conferência, conferência numérica,
 * raciocínio desligado nos modelos que pensam, resposta vazia, Wikipédia em
 * uma língua só, destilação e redação de pedido aberto.
 */

const http = require('http');
const auto = require('../../src/agent/auto');
const rapida = require('../../src/agent/resposta-rapida');
const destilador = require('../../src/agent/destilador');
const prompts = require('../../src/agent/prompts');
const ollama = require('../../src/llm/ollama');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');
const { executarCasoAgente } = require('../motor');
const web = require('../../src/tools/web');

const nivelDe = (pedido, extra = {}) => auto.decidirNivel({ objetivo: pedido, tipo: tipoDoPedido(pedido).tipo, ...extra }).nivel;

// wikitexto no formato real do artigo em inglês (caixa + especificações)
const WIKITEXTO_SR71 = `{{Infobox aircraft begin
 |name=SR-71 "Blackbird"
 |image=Lockheed SR-71 Blackbird.jpg
 |caption=An SR-71B trainer over the Sierra Nevada
}}{{Infobox aircraft type
 |first flight = {{start date and age|1964|12|22}}
 |introduction = January 1966
 |retired = 1998 (USAF), 1999 (NASA)
 |number built = 32<ref name="Lock">Lockheed history.</ref>
 |primary user = [[United States Air Force]]
}}
The '''Lockheed SR-71 "Blackbird"''' is a retired long-range, high-altitude, Mach 3+ strategic reconnaissance aircraft.
==Specifications==
{{Aircraft specs
|crew=2: Pilot and [[reconnaissance systems officer]] (RSO)
|length m=32.74
|span m=16.94
|height m=5.64
|empty weight kg=30617
|max speed kmh=3540
|ceiling m=25900
}}`;

// a resposta do qwen3.5:9b puro que o Davi mostrou (trechos com os erros)
const RESPOSTA_LIVRE = `# Lockheed SR-71 Blackbird
* Velocidade máxima: Mach 3,2 (aproximadamente 3.540 km/h ou 2.200 mph)
* Comprimento: 69,7 metros
* Envergadura: 16,9 metros
* Peso vazio: 16.830 kg
* Entrada em serviço: 1964
3. Tripulação: Normalmente 3 pessoas - piloto e oficial de reconhecimento`;

const depsSR71 = ({ falharWiki = false } = {}) => ({
  buscar: async () => ({
    provedor: 'falso',
    falhas: [],
    resultados: [
      { titulo: 'Lockheed SR-71 Blackbird - Wikipedia', url: 'https://en.wikipedia.org/wiki/Lockheed_SR-71_Blackbird' },
      { titulo: 'SR-71: o avião espião', url: 'https://www.aereo.jor.br/sr-71' },
      { titulo: 'vídeo', url: 'https://www.youtube.com/watch?v=1' },
    ],
  }),
  wikipedia: async (assunto, idioma) => {
    if (falharWiki) throw new Error('sem rede');
    return {
      idioma,
      titulo: 'Lockheed SR-71 Blackbird',
      url: `https://${idioma}.wikipedia.org/wiki/Lockheed_SR-71_Blackbird`,
      introducao: idioma === 'pt'
        ? 'O Lockheed SR-71 Blackbird é um avião de reconhecimento estratégico de longo alcance, capaz de voar acima de Mach 3. Foi aposentado em 1998.'
        : 'The Lockheed SR-71 Blackbird is a retired long-range, high-altitude, Mach 3+ strategic reconnaissance aircraft developed by Lockheed Skunk Works.',
      campos: idioma === 'en' ? rapida.camposDaInfobox(WIKITEXTO_SR71) : [],
    };
  },
  ler: async (url) => ({ texto: `Reportagem: o SR-71 foi construído com titânio comprado da União Soviética por empresas de fachada. ${'Detalhes da fuselagem e dos motores J58. '.repeat(20)}`, url }),
});

module.exports = [
  {
    nome: 'auto: nível de cada pedido (0 saudação/criativo/conta, 1 "me fale sobre", 2 atual/arquivo/geral, 3 compra/guia/várias partes)',
    tipo: 'unidade',
    executar() {
      const casos = [
        ['oi, tudo bem?', 0], ['obrigado!', 0], ['escreva um poema sobre o mar', 0], ['quanto é 15*37', 0],
        ['Me conte mais sobre o Black bird sr71', 1], ['Quem foi Santos Dumont?', 1], ['Como funciona um motor a jato?', 1],
        ['por que o céu é azul', 1], ['fale sobre a história do Império Romano', 1],
        ['qual a cotação do dólar hoje', 2], ['quais as novidades do patch 35 do pubg', 2], ['resuma o arquivo relatorio.pdf', 2],
        ['crie um script python que renomeie fotos', 2], ['me fale sobre as notícias de hoje do Brasil', 2],
        ['top 5 IEM para PUBG PC', 3], ['quais as melhores táticas de PUBG', 3],
      ];
      const erros = casos.filter(([p, n]) => nivelDe(p) !== n).map(([p, n]) => `"${p}": esperava ${n}, veio ${nivelDe(p)} (${auto.decidirNivel({ objetivo: p, tipo: tipoDoPedido(p).tipo }).motivo})`);
      return [
        erros.length === 0 || erros.join(' | '),
        nivelDe('Me conte mais sobre o Black bird sr71', { refereConversa: true }) === 2 || 'pedido que depende da conversa não vai para a resposta rápida',
        nivelDe('valeu!', { refereConversa: true }) === 0 || 'agradecimento depois de uma resposta é nível 0',
        nivelDe('Quem foi Santos Dumont?', { multiplas: 3 }) === 3 || 'três perguntas na mesma mensagem = nível 3',
        auto.assuntoDoPedido('Me conte mais sobre o Black bird sr71') === 'Black bird sr71' || `assunto: ${auto.assuntoDoPedido('Me conte mais sobre o Black bird sr71')}`,
        auto.assuntoDoPedido('Quem foi Santos Dumont?') === 'Santos Dumont' || 'assunto de "quem foi"',
        auto.assuntoNaMemoria('projeto fenix', [{ tipo: 'nota', texto: 'O projeto Fênix atrasou.' }]) || 'nota salva sobre o assunto → laço com memória',
        auto.assuntoNaMemoria('projeto fenix', [{ tipo: 'dossie', texto: 'projeto fenix', idConversa: 'a' }], { idConversa: 'a' }) || 'leitura desta conversa conta',
        !auto.assuntoNaMemoria('Black bird sr71', [{ tipo: 'dossie', texto: 'Black bird SR71 Mach 3', idConversa: 'ontem' }], { idConversa: 'hoje' }) || 'leitura de outra conversa não prende o assunto no laço',
      ];
    },
  },
  {
    nome: 'auto: os ajustes só DESLIGAM (teto = Ajustes); nível 3 não muda nada além do modelo profundo; sem conversa, nível 2 pula a ambiguidade',
    tipo: 'unidade',
    executar() {
      const alto = { nivelRaciocinio: 'alto', profundidadePesquisa: 'alta', criticaAutomaticaPorEtapaMax: 18 };
      const leve = { nivelRaciocinio: 'leve', profundidadePesquisa: 'normal', criticaAutomaticaPorEtapaMax: 12 };
      const a2 = auto.ajustesDoNivel(2, alto, { temConversa: false });
      const l2 = auto.ajustesDoNivel(2, leve);
      const a3 = auto.ajustesDoNivel(3, { ...alto, autoModeloProfundo: 'qwen3.5:9b' });
      return [
        a2.profundidadePesquisa === 'media' && !('nivelRaciocinio' in a2) || `profundidade alta vira média no nível 2; a cautela com memória (nivelRaciocinio) fica: ${JSON.stringify(a2)}`,
        a2.planejamentoInicial === false && a2.criticaPeriodica === false && a2.pipelineForcadoUniversal === false || 'nível 2 sem plano forçado nem crítico periódico',
        a2.verificarAmbiguidade === false || 'sem conversa, a ambiguidade não roda no nível 2',
        l2.profundidadePesquisa === 'normal' || `leve continua leve (o AUTO não sobe nada): ${JSON.stringify(l2)}`,
        !('verificarAmbiguidade' in l2) || 'com conversa a ambiguidade continua (resolve "aquilo", "de novo")',
        JSON.stringify(a3) === JSON.stringify({ modelRedacao: 'qwen3.5:9b' }) || `nível 3: ${JSON.stringify(a3)}`,
        Object.keys(auto.ajustesDoNivel(3, alto)).length === 0 || 'nível 3 sem modelo profundo não muda nada',
      ];
    },
  },
  {
    nome: 'resposta rápida: ficha da Wikipédia (caixa + especificações) e conferência corrigem os erros do qwen3.5 puro (69,7 m, 16.830 kg, 1964, 3 tripulantes) sem mexer no resto',
    tipo: 'unidade',
    executar() {
      const campos = rapida.camposDaInfobox(WIKITEXTO_SR71);
      const fatos = rapida.fatosDaFicha([{ idioma: 'en', campos }]);
      const { texto, correcoes } = rapida.conferirNumeros(RESPOSTA_LIVRE, fatos);
      const de = (nome) => fatos.find((f) => f.nome === nome)?.valor;
      return [
        !campos.some((c) => /^(image|caption)/.test(c.chave)) || 'imagem e legenda não entram na ficha',
        campos.find((c) => c.chave === 'number built')?.valor === '32' || 'a referência <ref> sai do valor',
        de('comprimento') === 32.74 && de('tripulação') === 2 && de('unidades construídas') === 32 && de('primeiro voo') === 1964 && de('entrada em serviço') === 1966 || `fatos: ${JSON.stringify(fatos.map((f) => [f.nome, f.valor]))}`,
        /Comprimento: 32,74 metros/.test(texto) || 'comprimento corrigido',
        /Peso vazio: 30\.617 kg/.test(texto) || 'peso corrigido',
        /Entrada em serviço: 1966/.test(texto) || 'ano de entrada corrigido',
        /Tripulação: Normalmente 2 pessoas/.test(texto) || 'tripulação corrigida',
        /Envergadura: 16,9 metros/.test(texto) || 'arredondamento (16,9 × 16,94) não é erro',
        /3\.540 km\/h ou 2\.200 mph/.test(texto) || 'velocidade certa fica como estava',
        /^# Lockheed SR-71 Blackbird/.test(texto) || 'o estilo (título, listas) não muda',
        correcoes.length === 4 || `4 correções esperadas: ${JSON.stringify(correcoes)}`,
      ];
    },
  },
  {
    nome: 'resposta rápida: sem número na linha ou com dois candidatos, não mexe; valor pt "32,74 m" e en "3,540" são lidos certo',
    tipo: 'unidade',
    executar() {
      const fatos = rapida.fatosDaFicha([
        { idioma: 'pt', campos: [{ chave: 'comprimento', valor: '32,74 m' }] },
        { idioma: 'en', campos: [{ chave: 'max speed kmh', valor: '3,540' }] },
      ]);
      const dois = rapida.conferirNumeros('O comprimento varia entre 20 m e 40 m conforme a versão.', fatos);
      const semNumero = rapida.conferirNumeros('O comprimento impressiona.', fatos);
      return [
        fatos.find((f) => f.nome === 'comprimento')?.valor === 32.74 || `pt: ${JSON.stringify(fatos)}`,
        fatos.find((f) => f.nome === 'velocidade máxima')?.valor === 3540 || `en: ${JSON.stringify(fatos)}`,
        dois.correcoes.length === 0 || 'dois números na linha: não sabe qual é, não mexe',
        semNumero.correcoes.length === 0 || 'sem número, nada a corrigir',
        rapida.numero('3.540') === 3540 && rapida.numero('32,74') === 32.74 && rapida.numero('16.830') === 16830 || 'números pt-BR',
      ];
    },
  },
  {
    nome: 'auto nível 1: "Me conte mais sobre o Black bird sr71" responde sem o laço (nenhuma decisão, nenhuma destilação), com a ficha no prompt, número corrigido e fontes no fim',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'auto: nivel 1 sr71',
        pedido: 'Me conte mais sobre o Black bird sr71',
        config: { modoAuto: true },
        depsRespostaRapida: depsSR71(),
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'não deveria chegar aqui' } }],
        redacao: (prompt) => (/FICHA DE CONFERÊNCIA/.test(prompt)
          ? '# SR-71 Blackbird\nO avião tripulado mais rápido.\n* Comprimento: 69,7 metros\n* Tripulação: 3 pessoas'
          : 'redação errada'),
      });
      const r = obtido.registro || {};
      return [
        obtido.ok || `deveria concluir: ${obtido.motivo}`,
        !obtido.promptDecisao || 'nenhuma decisão do laço deveria acontecer',
        !obtido.promptDestilacao || 'nenhuma destilação deveria acontecer',
        obtido.chamadasRedacao === 1 || `1 redação (${obtido.chamadasRedacao})`,
        /32,74 metros/.test(obtido.resposta) && /Tripulação: 2/.test(obtido.resposta) || `números conferidos: ${obtido.resposta}`,
        /\*\*Fontes\*\*[\s\S]*en\.wikipedia\.org[\s\S]*aereo\.jor\.br/.test(obtido.resposta) || 'Wikipédia e a página lida nas fontes',
        !/youtube/.test(obtido.resposta) || 'vídeo não é lido',
        /titânio comprado da União Soviética/.test(obtido.promptRedacao) || 'o trecho da página entra na ficha',
        /length m: 32\.74/.test(obtido.promptRedacao) && /DADOS CONFERIDOS/.test(obtido.promptRedacao) || 'a ficha técnica entra no prompt',
        r.auto?.nivel === 1 && r.auto?.rapida?.correcoes?.length === 2 || `registro: ${JSON.stringify(r.auto)}`,
      ];
    },
  },
  {
    nome: 'auto nível 1: se a resposta rápida falhar (modelo devolve vazio), segue pelo laço no nível 2 e responde normalmente',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'auto: nivel 1 falha',
        pedido: 'Quem foi Santos Dumont?',
        config: { modoAuto: true },
        depsRespostaRapida: depsSR71({ falharWiki: true }),
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'Santos Dumont' } }],
        redacao: (prompt, n) => (n === 1 ? '' : 'Santos Dumont foi um inventor brasileiro.'),
      });
      const r = obtido.registro || {};
      return [
        obtido.ok || `deveria concluir: ${obtido.motivo}`,
        /inventor brasileiro/.test(obtido.resposta) || `resposta pelo laço: ${obtido.resposta}`,
        r.auto?.nivel === 2 && r.auto?.nivelInicial === 1 || `registro: ${JSON.stringify(r.auto)}`,
        /falhou/.test(r.auto?.motivo || '') || 'o motivo diz que a resposta rápida falhou',
      ];
    },
  },
  {
    nome: 'auto nível 2: "cotação do dólar hoje" roda o laço sem plano forçado, sem crítico periódico e sem ambiguidade; o relatório mostra os ajustes',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'auto: nivel 2',
        pedido: 'qual a cotação do dólar hoje',
        config: { modoAuto: true, planejamentoInicial: true, pipelineForcadoUniversal: true, criticaPeriodica: true, nivelRaciocinio: 'alto', profundidadePesquisa: 'alta' },
        planejamentoInicial: '1. Pesquisar a cotação\n2. Pesquisar o histórico\n3. Pesquisar vídeos no YouTube',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'cotação' } }],
        redacao: 'O dólar está em R$ 5,40.',
      });
      const r = obtido.registro || {};
      return [
        obtido.ok || `deveria concluir: ${obtido.motivo}`,
        r.auto?.nivel === 2 || `nível: ${JSON.stringify(r.auto)}`,
        r.auto?.ajustes?.planejamentoInicial === false && r.auto?.ajustes?.profundidadePesquisa === 'media' || `ajustes: ${JSON.stringify(r.auto?.ajustes)}`,
        !obtido.promptPlanejamento || 'o plano inicial não deveria rodar no nível 2',
        !(r.checklist || []).some((i) => /YouTube/.test(i.texto)) || 'nada de plano com vídeos',
      ];
    },
  },
  {
    nome: 'auto desligado: tudo como antes (sem nível no registro)',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'auto: desligado',
        pedido: 'Me conte mais sobre o Black bird sr71',
        config: { modoAuto: false },
        depsRespostaRapida: depsSR71(),
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'SR-71' } }],
        redacao: 'Resposta pelo laço.',
      });
      return [
        /Resposta pelo laço/.test(obtido.resposta) || obtido.resposta,
        !obtido.registro?.auto || `não deveria registrar nível: ${JSON.stringify(obtido.registro?.auto)}`,
      ];
    },
  },
  {
    nome: 'resposta vazia: a redação é tentada de novo e nunca sai uma resposta só com as fontes',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'resposta vazia',
        pedido: 'Explique o que é fotossíntese',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fotossíntese' } }],
        redacao: (prompt, n) => (n === 1 ? '' : 'A fotossíntese transforma luz em energia química.'),
      });
      const sempre = await executarCasoAgente({
        nome: 'resposta vazia sempre',
        pedido: 'Explique o que é fotossíntese',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fotossíntese' } }],
        redacao: '',
      });
      // a 1ª não trata do pedido → o verificador pede a reescrita, e ELA vem vazia
      const reescrita = await executarCasoAgente({
        nome: 'reescrita vazia',
        pedido: 'Explique o que é fotossíntese',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'fotossíntese' } }],
        redacao: (prompt, n) => (n === 1 ? 'O campeonato de 1987 teve 4521 torcedores, 77% de ocupação e 9 gols de Zico em 12 jogos no Maracanã.' : ''),
      });
      return [
        (reescrita.chamadasRedacao >= 2 && /campeonato de 1987/.test(reescrita.resposta)) || `reescrita vazia não pode substituir a original: ${JSON.stringify(reescrita.resposta.slice(0, 80))}`,
        /luz em energia/.test(obtido.resposta) || `2ª tentativa: ${obtido.resposta}`,
        obtido.chamadasRedacao >= 2 || 'deveria redigir de novo',
        String(sempre.resposta || '').trim().length > 20 || `vazia duas vezes: precisa dizer algo (${JSON.stringify(sempre.resposta)})`,
      ];
    },
  },
  {
    nome: 'modelos que pensam: com o padrão desligado, chat e chatStream mandam think:false; chamada que pede pensar explicitamente é respeitada; sem padrão, o campo não vai',
    tipo: 'unidade',
    async executar() {
      const corpos = [];
      const srv = http.createServer((req, res) => {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => {
          const corpo = JSON.parse(b);
          corpos.push(corpo);
          if (corpo.stream) {
            res.setHeader('Content-Type', 'application/x-ndjson');
            res.write(`${JSON.stringify({ message: { content: '<think>hmm</think>Olá' } })}\n`);
            return res.end(`${JSON.stringify({ done: true })}\n`);
          }
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: { content: 'ok' } }));
        });
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const host = `http://127.0.0.1:${srv.address().port}`;
      try {
        ollama.definirPensarPadrao(false);
        await ollama.chat({ host, model: 'x', messages: [{ role: 'user', content: 'a' }] });
        const stream = await ollama.chatStream({ host, model: 'x', messages: [{ role: 'user', content: 'a' }] });
        await ollama.chat({ host, model: 'x', messages: [{ role: 'user', content: 'a' }], pensar: true });
        ollama.definirPensarPadrao(null);
        await ollama.chat({ host, model: 'x', messages: [{ role: 'user', content: 'a' }] });
        return [
          corpos[0].think === false || `chat: ${JSON.stringify(corpos[0])}`,
          corpos[1].think === false || `chatStream: ${JSON.stringify(corpos[1])}`,
          stream.content === 'Olá' || `bloco <think> sai do texto do stream: ${stream.content}`,
          corpos[2].think === true || 'pensar explícito vence o padrão',
          !('think' in corpos[3]) || 'sem padrão, não manda think (fora do agente)',
        ];
      } finally {
        ollama.definirPensarPadrao(null);
        await new Promise((r) => srv.close(r));
      }
    },
  },
  {
    nome: 'pedido aberto: a destilação pede "fatos marcantes" (não "o que serve") e a redação organiza por tema; pedido comum não muda',
    tipo: 'unidade',
    executar() {
      const capturado = [];
      // o prompt é interno; dá para vê-lo pelo que maximoQueCabe mede, mas é
      // mais direto conferir o texto montado pela mesma função usada na chamada
      const aberto = destilador.__promptParaTeste?.('Me conte mais sobre o Black bird sr71', 'x', 'material') || '';
      const comum = destilador.__promptParaTeste?.('qual a cotação do dólar hoje', 'x', 'material') || '';
      capturado.push(aberto, comum);
      const redAberto = prompts.pedidoDeResposta({ objetivo: 'Me conte mais sobre o Black bird sr71', material: 'm', foco: '', conversa: [], cobertura: 'boa', fontes: [] });
      const redComum = prompts.pedidoDeResposta({ objetivo: 'qual a cotação do dólar hoje', material: 'm', foco: '', conversa: [], cobertura: 'boa', fontes: [] });
      return [
        /mais marcantes/.test(aberto) && /Só escreva NADA se o material não for sobre esse assunto/.test(aberto) || 'destilação de pedido aberto',
        /apenas o que serve para responder/.test(comum) && !/mais marcantes/.test(comum) || 'destilação de pedido comum continua igual',
        /seções por TEMA/.test(redAberto) && /nunca "Resumo das informações principais"/.test(redAberto) || 'redação de pedido aberto organiza por tema',
        !/seções por TEMA/.test(redComum) || 'pedido comum não recebe a regra de panorama',
      ];
    },
  },
  {
    nome: 'Wikipédia na pesquisa: só pt e en, cada uma uma vez por execução (antes: 6 línguas, 22 destilações)',
    tipo: 'unidade',
    executar() {
      const estado = {};
      const urls = ['en', 'pt', 'es', 'fr', 'ru', 'simple', 'en'].map((l) => `https://${l}.wikipedia.org/wiki/Lockheed_SR-71_Blackbird`);
      const decisoes = urls.map((u) => web.decidirWikipedia(u, estado));
      return [
        decisoes.map((d) => d.ler).join(',') === 'true,true,false,false,false,false,false' || JSON.stringify(decisoes),
        /outra língua/.test(decisoes[2].motivo) || 'motivo do descarte',
        web.decidirWikipedia('https://www.aereo.jor.br/sr-71', estado) === null || 'site comum não passa por esta regra',
        web.decidirWikipedia('https://pt.m.wikipedia.org/wiki/X', {}).ler === true || 'versão móvel conta como pt',
      ];
    },
  },
];
