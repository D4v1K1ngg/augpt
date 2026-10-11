'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { MemoriaCentral } = require('../../src/agent/memoria-central');
const { MemoriaOperacional } = require('../../src/agent/memoria-operacional');

/**
 * Servidor de embedding fake com vetor fixo por texto — mesmo padrão já usado
 * em melhorias.js (casosClusteringDeDominio) e skills-embedding.js, copiado
 * aqui em vez de compartilhado (mesma escolha já feita nos outros dois: cada
 * arquivo de caso fica autocontido).
 */
function subirServidorEmbeddingControlado(mapaTextoParaVetor) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo || '{}');
        } catch {
          /* ignora corpo inválido */
        }
        const texto = String(pedido.input || '');
        const vetor = mapaTextoParaVetor[texto];
        if (!vetor) throw new Error(`vetor não mapeado pro texto de teste: ${JSON.stringify(texto)}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ embeddings: [vetor] }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve(servidor));
  });
}

/**
 * Casos das três melhorias de "Nível 1": reflexão pós-execução, memória
 * central do usuário e segunda opinião antes de ação destrutiva.
 */

module.exports = [
  /* ------------------------------ memória central (unidade) ------------------------------ */

  {
    nome: 'memória central: grava, persiste, esquece e entra no bloco do prompt',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-central-${Date.now()}`);
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'Nome', valor: 'Davi' });
      m.definir({ chave: 'formato preferido', valor: 'tabelas quando houver série de dados' });

      const bloco = m.paraPrompt();
      const persistida = new MemoriaCentral(dir).listar(); // recarrega do disco
      const esquecidos = m.esquecer('nome');
      const depois = new MemoriaCentral(dir).listar();
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        bloco.includes('O QUE VOCÊ SABE SOBRE O USUÁRIO') || 'bloco não foi montado',
        bloco.includes('Davi') || 'fato não entrou no bloco',
        persistida.length === 2 || `persistiu ${persistida.length} item(ns) em vez de 2`,
        esquecidos === 1 || `esqueceu ${esquecidos} em vez de 1`,
        depois.length === 1 || 'não removeu a chave esquecida',
        depois[0].chave === 'formato_preferido' || 'normalização de chave com espaço falhou',
      ];
    },
  },

  /* ------------------------------ item 7: supressão de fato quase-duplicado (unidade) ------------------------------ */

  {
    nome: 'quase-duplicata: sem embedModel configurado, sai de fora sem tentar nada (custo zero)',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-sem-modelo-'));
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'formato_preferido', valor: 'tabelas quando houver série de dados' });
      const resultado = await m.encontrarQuaseDuplicata({
        chave: 'formato_resposta', valor: 'prefere tabela', host: 'http://127.0.0.1:1', embedModel: undefined,
      });
      fs.rmSync(dir, { recursive: true, force: true });
      return [resultado === null || `esperava null sem embedModel, obteve ${JSON.stringify(resultado)}`];
    },
  },

  {
    nome: 'quase-duplicata: memória central vazia, nada pra comparar, fica de fora',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-vazia-'));
      const m = new MemoriaCentral(dir);
      const resultado = await m.encontrarQuaseDuplicata({
        chave: 'nome', valor: 'Davi', host: 'http://127.0.0.1:1', embedModel: 'nomic-embed-text',
      });
      fs.rmSync(dir, { recursive: true, force: true });
      return [resultado === null || `sem nenhum fato gravado ainda, esperava null, obteve ${JSON.stringify(resultado)}`];
    },
  },

  {
    nome: 'quase-duplicata: cosseno acima do limiar (0,90 > 0,85) encontra o fato existente parecido',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-acha-'));
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'formato_preferido', valor: 'tabelas quando houver série de dados' });

      const chave = 'formato_resposta';
      const valor = 'gosta de tabela';
      const mapa = {
        [`${chave} ${valor}`]: [1, 0],
        'formato_preferido tabelas quando houver série de dados': [0.9, 0.4358898943540673], // cosseno 0,90
      };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const resultado = await m.encontrarQuaseDuplicata({ chave, valor, host, embedModel: 'nomic-embed-text' });
        return [
          !!resultado || 'esperava encontrar quase-duplicata, obteve null',
          resultado?.chave === 'formato_preferido' || `esperava achar "formato_preferido", obteve ${JSON.stringify(resultado)}`,
        ];
      } finally {
        servidor.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    nome: 'quase-duplicata: cosseno abaixo do limiar (0,80 < 0,85) não confunde fatos diferentes',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-longe-'));
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'nome', valor: 'Davi' });

      const chave = 'formato_preferido';
      const valor = 'tabelas quando houver série de dados';
      const mapa = {
        [`${chave} ${valor}`]: [1, 0],
        'nome Davi': [0.8, 0.6], // cosseno 0,80
      };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const resultado = await m.encontrarQuaseDuplicata({ chave, valor, host, embedModel: 'nomic-embed-text' });
        return [resultado === null || `cosseno 0,80 está abaixo do limiar 0,85, esperava null, obteve ${JSON.stringify(resultado)}`];
      } finally {
        servidor.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    // Se a chave nova já existir EXATA na memória (o caminho que `definir()`
    // já resolve por igualdade), `encontrarQuaseDuplicata` não deve contar o
    // próprio item como "parecido consigo mesmo" — quem chama já sabe tratar
    // esse caso sem precisar do resultado do clustering. Servidor de
    // embedding DE VERDADE (não host inalcançável) de propósito: com o texto
    // igual mapeado pra cosseno 1.0, se o filtro estivesse quebrado o método
    // encontraria a PRÓPRIA chave como "quase-duplicata de si mesma" (sempre
    // o match perfeito) em vez de simplesmente devolver null por falha de
    // rede — prova o filtro em si, não uma rede inacessível.
    nome: 'quase-duplicata: não considera a própria chave (já existente, exata) como candidata',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-self-'));
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'nome', valor: 'Davi' });

      // chave/valor idênticos ao item já gravado: texto de busca do "fato
      // novo" e texto do "candidato" são a MESMA string, então só precisa de
      // uma entrada no mapa — e o cosseno de um vetor consigo mesmo é 1.0.
      const mapa = { 'nome Davi': [1, 0] };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const resultado = await m.encontrarQuaseDuplicata({ chave: 'nome', valor: 'Davi', host, embedModel: 'nomic-embed-text' });
        return [resultado === null || `a própria chave não deveria contar como candidata, obteve ${JSON.stringify(resultado)}`];
      } finally {
        servidor.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  {
    nome: 'quase-duplicata: definir() invalida o vetor cacheado quando o valor muda',
    tipo: 'unidade',
    executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-invalida-'));
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'formato_preferido', valor: 'tabelas' });
      const item = m.itens.find((i) => i.chave === 'formato_preferido');
      item.vec = [1, 0, 0]; // simula vetor já cacheado por uma comparação anterior

      m.definir({ chave: 'formato_preferido', valor: 'tabelas quando houver série de dados' }); // valor mudou
      // snapshot já-em-booleano: `item`/`depoisDeMudar` são o MESMO objeto (array
      // não é clonado por `find`), então reler `.vec` depois de reatribuí-lo mais
      // abaixo enxergaria o valor NOVO — a comparação precisa travar aqui.
      const vecSumiuAposMudar = m.itens.find((i) => i.chave === 'formato_preferido').vec === undefined;

      item.vec = [1, 0, 0];
      m.definir({ chave: 'formato_preferido', valor: 'tabelas quando houver série de dados' }); // valor igual, repete
      const vecContinuouAposRepetir = m.itens.find((i) => i.chave === 'formato_preferido').vec !== undefined;

      fs.rmSync(dir, { recursive: true, force: true });
      return [
        vecSumiuAposMudar || 'valor mudou, mas o vetor cacheado antigo não foi invalidado',
        vecContinuouAposRepetir || 'valor repetido não deveria ter apagado um vetor cacheado válido',
      ];
    },
  },

  {
    // Ponto de integração: a ferramenta é quem decide gravar na chave
    // EXISTENTE quando acha quase-duplicata, em vez de criar uma chave nova —
    // é esse comportamento (não só o método isolado acima) que evita a
    // memória central inchar com sinônimo do mesmo fato.
    nome: 'quase-duplicata: ferramenta atualizar_memoria_central grava na chave existente em vez de duplicar',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-central-dup-ferramenta-'));
      const m = new MemoriaCentral(dir);
      m.definir({ chave: 'formato_preferido', valor: 'tabelas quando houver série de dados' });

      const chaveNova = 'formato_resposta';
      const valorNovo = 'gosta de tabela';
      const mapa = {
        [`${chaveNova} ${valorNovo}`]: [1, 0],
        'formato_preferido tabelas quando houver série de dados': [0.9, 0.4358898943540673],
      };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      const tools = require('../../src/tools');
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const ferramenta = tools.get('atualizar_memoria_central');
        const resposta = await ferramenta.run(
          { chave: chaveNova, valor: valorNovo },
          { memoriaCentral: m, config: { host, embedModel: 'nomic-embed-text' } },
        );
        const itens = m.listar();
        return [
          itens.length === 1 || `esperava continuar com 1 fato só (atualizado), ficou com ${itens.length}`,
          itens[0]?.chave === 'formato_preferido' || `esperava manter a chave "formato_preferido", obteve ${JSON.stringify(itens[0])}`,
          itens[0]?.valor === valorNovo || 'não atualizou o valor do fato existente',
          /formato_preferido/.test(resposta) || 'mensagem de retorno não avisou qual chave foi atualizada',
        ];
      } finally {
        servidor.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  /* ------------------------------ reflexão (unidade) ------------------------------ */

  {
    nome: 'reflexão: uma única ocorrência já é confiável e substitui a anterior',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-reflexao-${Date.now()}`);
      const m = new MemoriaOperacional(dir);

      m.refletir({ chave: 'pesquisa na web', licao: 'leia o site oficial antes de comparar preços' });
      const confiavelDeImediato = m.saber('estrategia', 'pesquisa na web');
      const prompt = m.paraPrompt('pesquisar preço na web');

      m.refletir({ chave: 'pesquisa na web', licao: 'peça no máximo duas fontes para pergunta simples' });
      const itens = m.listar().filter((i) => i.tipo === 'estrategia');
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        Boolean(confiavelDeImediato) || 'exigiu repetição para confiar numa reflexão',
        prompt.includes('site oficial') || 'reflexão não entrou no prompt',
        itens.length === 1 || `ficou com ${itens.length} lições em vez de substituir`,
        itens[0].licao.includes('duas fontes') || 'não substituiu pela reflexão mais recente',
      ];
    },
  },

  /* ------------------------------ reflexão (execução do agente) ------------------------------ */

  {
    nome: 'reflexão pós-execução grava uma lição de estratégia',
    pedido: 'Qual o valor do boleto?',
    arquivos: { 'boleto.txt': 'Valor: R$ 128,40' },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'O valor do boleto é R$ 128,40.',
    destilacao: (prompt) =>
      prompt.includes('REFLEXÃO PÓS-EXECUÇÃO')
        ? 'da próxima vez, leia o arquivo direto sem confirmar a existência antes'
        : 'NADA',
    espera: { ok: true },
    // a asserção fina (o item ficou gravado em disco) é feita no pós-processamento abaixo
    posVerificar(obtido) {
      const itens = new MemoriaOperacional(path.join(obtido.workspace, '.augpt')).listar();
      const estrategia = itens.find((i) => i.tipo === 'estrategia');
      return [
        Boolean(estrategia) || 'nenhuma lição de estratégia foi gravada',
        estrategia?.licao.includes('leia o arquivo direto') || 'lição gravada não é a esperada',
        estrategia?.vezes === 1 || 'não deveria exigir repetição',
      ];
    },
  },

  {
    nome: 'reflexão desligada por config não grava nada',
    pedido: 'Qual o valor do boleto?',
    arquivos: { 'boleto.txt': 'Valor: R$ 128,40' },
    config: { reflexaoPosExecucao: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'boleto.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'O valor do boleto é R$ 128,40.',
    destilacao: (prompt) => (prompt.includes('REFLEXÃO PÓS-EXECUÇÃO') ? 'não deveria ter perguntado isto' : 'NADA'),
    espera: { ok: true },
    posVerificar(obtido) {
      const itens = new MemoriaOperacional(path.join(obtido.workspace, '.augpt')).listar();
      return [itens.every((i) => i.tipo !== 'estrategia') || 'gravou reflexão mesmo desligada'];
    },
  },

  /* ------------------------------ memória central (execução do agente) ------------------------------ */

  {
    nome: 'memória central existente entra no prompt de decisão',
    pedido: 'Oi',
    // na bancada, userDataPath == pasta de trabalho preparada para o caso
    arquivos: {
      'memoria-central.json': JSON.stringify([{ chave: 'nome', valor: 'Davi', em: new Date().toISOString() }]),
    },
    roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'cumprimento' } }],
    redacao: 'Oi, Davi!',
    espera: { ok: true, promptDecisaoContem: ['O QUE VOCÊ SABE SOBRE O USUÁRIO', 'nome: Davi'] },
  },

  {
    nome: 'agente grava um fato duradouro na memória central',
    pedido: 'Meu nome é Davi, lembre disso para sempre',
    roteiro: [
      { ferramenta: 'atualizar_memoria_central', argumentos: { chave: 'nome', valor: 'Davi' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'Guardado.' } },
    ],
    espera: { ok: true, ferramentasChamadas: ['atualizar_memoria_central'] },
    posVerificar(obtido) {
      const itens = new MemoriaCentral(obtido.workspace).listar();
      const nome = itens.find((i) => i.chave === 'nome');
      return [nome?.valor === 'Davi' || 'fato não foi persistido na memória central'];
    },
  },

  /* ------------------------------ segunda opinião ------------------------------ */

  {
    nome: 'segunda opinião acompanha a aprovação de apagar_arquivo',
    pedido: 'Apague o arquivo de rascunho',
    autonomia: 'manual',
    arquivos: { 'rascunho.txt': 'x' },
    roteiro: [
      { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'rascunho.txt' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'Apagado.' } },
    ],
    destilacao: (prompt) =>
      prompt.includes('AVALIE O RISCO') ? 'confirme que é o rascunho e não o arquivo final antes de apagar' : 'NADA',
    espera: {
      ok: true,
      aprovacoesPedidas: ['apagar_arquivo'],
      criticaPedida: 'apagar_arquivo',
      criticaContem: ['confirme que é o rascunho'],
    },
  },

  {
    nome: 'ação de risco médio não recebe segunda opinião',
    pedido: 'Crie um arquivo de notas',
    autonomia: 'manual',
    roteiro: [
      { ferramenta: 'escrever_arquivo', argumentos: { caminho: 'notas.md', conteudo: 'notas' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'Criado.' } },
    ],
    espera: { ok: true, aprovacoesPedidas: ['escrever_arquivo'], semCriticaPara: ['escrever_arquivo'] },
  },

  {
    nome: 'segunda opinião desligada por config não impede a aprovação normal',
    pedido: 'Apague o arquivo de rascunho',
    autonomia: 'manual',
    config: { segundaOpiniaoRiscoAlto: false },
    arquivos: { 'rascunho.txt': 'x' },
    roteiro: [
      { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'rascunho.txt' } },
      { ferramenta: 'concluir', argumentos: { resumo: 'Apagado.' } },
    ],
    destilacao: () => 'não deveria ter sido chamada',
    espera: { ok: true, aprovacoesPedidas: ['apagar_arquivo'], semCriticaPara: ['apagar_arquivo'] },
  },
];
