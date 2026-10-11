'use strict';

const protocolo = require('../../src/agent/protocolo');
const tools = require('../../src/tools');

const catalogo = () => tools.ativas([]);
const analisar = (bruto) =>
  protocolo.analisar(bruto, { catalogo: catalogo(), obterFerramenta: (n) => tools.get(n) });

module.exports = [
  {
    nome: 'protocolo: JSON sintaticamente inválido',
    tipo: 'unidade',
    executar() {
      const casos = [
        ['{ ferramenta: responder }', 'chave sem aspas'],
        ['{"ferramenta": {"nome": "concluir",}}', 'vírgula sobrando'],
        ["{'ferramenta': {'nome': 'concluir'}}", 'aspas simples'],
        ['{"ferramenta": {"nome": "salvar_memoria", "argumentos": {"fato": <texto>}}}', 'espaço reservado'],
      ];
      const problemas = [];
      for (const [bruto, nome] of casos) {
        const r = analisar(bruto);
        // reparáveis devem virar decisão; irreparáveis, erro classificado
        if (r.estado !== protocolo.ESTADOS.OK && r.estado !== protocolo.ESTADOS.ARGUMENTOS_INVALIDOS) {
          problemas.push(`${nome}: ${r.estado} — ${r.motivo}`);
        }
      }
      const semNada = analisar('não vou responder em JSON');
      return [
        problemas.length ? problemas.join(' | ') : true,
        semNada.estado === protocolo.ESTADOS.JSON_INVALIDO || `texto puro virou ${semNada.estado}`,
        /apenas o objeto/i.test(semNada.instrucao) || 'instrução não diz o que fazer',
      ];
    },
  },

  {
    nome: 'protocolo: JSON válido mas fora do protocolo',
    tipo: 'unidade',
    executar() {
      const semNada = analisar('{"campo": 1, "outro": 2}');
      const soResposta = analisar('{"resposta": "Python é uma linguagem de programação de alto nível."}');
      const comoChave = analisar('{"listar_arquivos": {"caminho": "."}}');
      return [
        semNada.estado === protocolo.ESTADOS.PROTOCOLO_INVALIDO || `virou ${semNada.estado}`,
        semNada.motivo.includes('campos recebidos') || 'motivo não diz o que chegou',
        // recuperação: intenção clara não precisa de nova rodada
        soResposta.estado === protocolo.ESTADOS.OK || `resposta direta virou ${soResposta.estado}`,
        soResposta.decisao?.ferramenta.nome === 'responder' || 'não converteu em responder',
        comoChave.estado === protocolo.ESTADOS.OK || `ferramenta como chave virou ${comoChave.estado}`,
        comoChave.decisao?.ferramenta.argumentos.caminho === '.' || 'perdeu os argumentos na recuperação',
      ];
    },
  },

  {
    nome: 'protocolo: ferramenta inexistente e nome aproximado',
    tipo: 'unidade',
    executar() {
      const inexistente = analisar(
        '{"pensamento":"x","ferramenta":{"nome":"ferramenta_que_nao_existe","argumentos":{}}}'
      );
      const digitacao = analisar('{"pensamento":"x","ferramenta":{"nome":"listar_arquivo","argumentos":{"caminho":"."}}}');
      // caso observado em execução real: uma letra a menos em buscar_no_projeto
      const umaLetra = analisar('{"pensamento":"x","ferramenta":{"nome":"busca_no_projeto","argumentos":{"termo":"a"}}}');
      const inventadoDeVerdade = analisar('{"pensamento":"x","ferramenta":{"nome":"extrair_informacoes","argumentos":{}}}');
      return [
        umaLetra.decisao?.ferramenta.nome === 'buscar_no_projeto' ||
          `"busca_no_projeto" virou ${umaLetra.decisao?.ferramenta.nome || umaLetra.estado}`,
        inventadoDeVerdade.estado === protocolo.ESTADOS.FERRAMENTA_INVALIDA ||
          'aceitou nome sem correspondência real',
        inexistente.estado === protocolo.ESTADOS.FERRAMENTA_INVALIDA || `virou ${inexistente.estado}`,
        inexistente.instrucao.includes('listar_arquivos') || 'não ofereceu o catálogo na instrução',
        digitacao.estado === protocolo.ESTADOS.OK || `erro de digitação virou ${digitacao.estado}`,
        digitacao.decisao?.ferramenta.nome === 'listar_arquivos' || 'não corrigiu o nome aproximado',
      ];
    },
  },

  {
    nome: 'protocolo: argumentos ausentes, sobrando e mal tipados',
    tipo: 'unidade',
    executar() {
      const faltando = analisar('{"pensamento":"x","ferramenta":{"nome":"ler_arquivo","argumentos":{}}}');
      const exemploCopiado = analisar(
        '{"pensamento":"x","ferramenta":{"nome":"ler_arquivo","argumentos":{"caminho":"string — arquivo relativo"}}}'
      );
      const listaComoTexto = analisar(
        '{"pensamento":"x","ferramenta":{"nome":"responder","argumentos":{"foco":"o valor","fontes":"[\\"https://a.com\\"]"}}}'
      );
      const terminalVazio = analisar('{"pensamento":"acabou","ferramenta":{"nome":"responder","argumentos":{}}}');
      return [
        faltando.estado === protocolo.ESTADOS.ARGUMENTOS_INVALIDOS || `virou ${faltando.estado}`,
        faltando.instrucao.includes('PREENCHA') || 'instrução não mostra o que preencher',
        exemploCopiado.estado === protocolo.ESTADOS.ARGUMENTOS_INVALIDOS || 'aceitou o valor de exemplo do catálogo',
        Array.isArray(listaComoTexto.decisao?.ferramenta.argumentos.fontes) || 'não converteu lista em texto',
        // encerrar é sinal: não pode ser barrado por falta de argumento
        terminalVazio.estado === protocolo.ESTADOS.OK || `responder vazio virou ${terminalVazio.estado}`,
      ];
    },
  },

  {
    // Caso real de produção (2026-09-14, rastro de 24 passos): o modelo
    // chamou `listar_arquivos` sem "caminho" duas vezes, cada uma virando um
    // passo inteiro perdido em "argumentos-invalidos" — mesmo o `run()` já
    // tendo `caminho = '.'` como default. Causa: sem `obrigatorios`
    // declarado, `validarArgumentos` (protocolo.js) cai na convenção "o
    // primeiro argumento é essencial" e rejeita ANTES do run() rodar,
    // deixando o default morto letra. Corrigido com `obrigatorios: []`
    // explícito em `listar_arquivos` (src/tools/files.js).
    nome: 'protocolo: listar_arquivos sem "caminho" não é mais barrado (o default "." do run() agora vale de verdade)',
    tipo: 'unidade',
    executar() {
      const semCaminho = analisar('{"pensamento":"x","ferramenta":{"nome":"listar_arquivos","argumentos":{}}}');
      return [
        semCaminho.estado === protocolo.ESTADOS.OK || `listar_arquivos sem "caminho" virou ${semCaminho.estado}`,
        semCaminho.decisao?.ferramenta.nome === 'listar_arquivos' || 'decisão não bateu com a ferramenta pedida',
      ];
    },
  },

  {
    nome: 'protocolo: JSON em markdown e com texto em volta',
    tipo: 'unidade',
    executar() {
      const emMarkdown = analisar(
        '```json\n{"pensamento":"vou listar","ferramenta":{"nome":"listar_arquivos","argumentos":{"caminho":"."}}}\n```'
      );
      const comTexto = analisar(
        'Vou pesquisar isso para você.\n\n{"pensamento":"x","ferramenta":{"nome":"listar_arquivos","argumentos":{"caminho":"."}}}\n\nEspero que ajude!'
      );
      const truncado = analisar('{"pensamento":"x","ferramenta":{"nome":"listar_arquivos","argumentos":{"caminho":"."');
      return [
        emMarkdown.estado === protocolo.ESTADOS.OK || `markdown virou ${emMarkdown.estado}`,
        comTexto.estado === protocolo.ESTADOS.OK || `texto em volta virou ${comTexto.estado}`,
        comTexto.decisao?.ferramenta.nome === 'listar_arquivos' || 'extraiu a decisão errada',
        truncado.estado === protocolo.ESTADOS.OK || `geração truncada virou ${truncado.estado}`,
      ];
    },
  },

  {
    nome: 'protocolo: schema traz o enum das ferramentas ativas',
    tipo: 'unidade',
    executar() {
      const esquema = protocolo.esquemaDeDecisao(catalogo());
      const enumerado = esquema.properties.ferramenta.properties.nome.enum;
      return [
        Array.isArray(enumerado) && enumerado.includes('responder') || 'enum sem as ferramentas',
        !enumerado.includes('ferramenta_que_nao_existe') || 'enum aceita nome inválido',
        esquema.required.join(',') === 'pensamento,ferramenta' || `obrigatórios: ${esquema.required.join(',')}`,
        !esquema.required.includes('critica') || 'exige campo que não muda a decisão',
      ];
    },
  },

  {
    nome: 'protocolo: catálogo só mostra JSON válido ao modelo',
    tipo: 'unidade',
    executar() {
      const catalogoTexto = tools.catalogo();
      const exemplos = [...catalogoTexto.matchAll(/argumentos: (\{.*\})/g)].map((m) => m[1]);
      const invalidos = exemplos.filter((e) => {
        try {
          JSON.parse(e);
          return false;
        } catch {
          return true;
        }
      });
      return [
        exemplos.length >= 15 || `só ${exemplos.length} exemplos no catálogo`,
        invalidos.length === 0 || `exemplos inválidos: ${invalidos.slice(0, 2).join(' | ')}`,
        !catalogoTexto.includes('<') || 'ainda há espaço reservado em <colchetes> no catálogo',
      ];
    },
  },

  {
    nome: 'protocolo: resposta defeituosa não volta ao histórico',
    pedido: 'Liste os arquivos',
    arquivos: { 'a.txt': 'conteúdo' },
    roteiro: [
      'isto não é JSON de jeito nenhum',
      { ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } },
      { ferramenta: 'responder', argumentos: { foco: 'o que existe' } },
    ],
    redacao: 'A pasta contém a.txt.',
    espera: {
      ok: true,
      protocoloRecusou: 'json-invalido',
      // a resposta ruim não pode reaparecer no prompt seguinte
      promptDecisaoNaoContem: ['isto não é JSON de jeito nenhum'],
      promptDecisaoContem: ['apenas o objeto'],
      respostaContem: ['a.txt'],
    },
  },

  {
    nome: 'protocolo: decisão mal embrulhada é recuperada sem gastar rodada',
    pedido: 'O que é Python?',
    roteiro: ['{"resposta": "Python é uma linguagem de programação interpretada e de alto nível."}'],
    redacao: 'Python é uma linguagem interpretada de alto nível.',
    espera: {
      ok: true,
      passos: { max: 1 },
      protocoloRecuperou: 'resposta-direta',
      ferramentasChamadas: ['responder'],
    },
  },

  {
    nome: 'protocolo: schema é enviado ao Ollama na decisão',
    pedido: 'Liste os arquivos',
    roteiro: [{ ferramenta: 'listar_arquivos', argumentos: { caminho: '.' } }, { ferramenta: 'responder', argumentos: { foco: 'x' } }],
    redacao: 'Pasta vazia.',
    espera: { ok: true, esquemaEnviado: true },
  },
];
