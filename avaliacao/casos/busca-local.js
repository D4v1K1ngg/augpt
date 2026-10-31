'use strict';

/**
 * Busca nos seus arquivos (31/10, "onde está aquilo?"): o índice das pastas escolhidas, a busca por palavras e
 * sentido, a rota do chat e as guardas do processo principal. O "sentido" aqui é de mentira (contagem de
 * palavras), para a bancada não depender do Ollama.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BuscaLocal } = require('../../src/busca-local');
const chat = require('../../src/agent/busca-local-no-chat');

// um "embedding" de mentira: 1024 posições, cada palavra soma 1 numa delas
const vetor = async (t) => {
  const v = new Array(1024).fill(0);
  for (const p of String(t).toLowerCase().replace(/^search_(query|document): /, '').split(/[^a-zà-ú0-9]+/).filter((x) => x.length > 2)) v[[...p].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 1024, 7)] += 1;
  return v;
};

function montar(dir) {
  const t = (rel, txt) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), txt);
  };
  t('Casa/locacao-apto-302.txt', 'CONTRATO DE LOCAÇÃO RESIDENCIAL. Valor mensal do aluguel: R$ 1.850,00, vencimento todo dia 10.');
  t('Casa/conta-cpfl-setembro.txt', 'CPFL Paulista. Conta de energia elétrica. Referência: setembro/2026. Total a pagar: R$ 187,45.');
  t('curriculo-davi.md', '# Davi\nDesenvolvedor JavaScript e Electron.');
  t('receita-bolo.txt', 'Bolo de cenoura com cobertura de chocolate.');
  t('node_modules/lixo.txt', 'contrato aluguel');
  t('.escondida/contrato.txt', 'contrato aluguel');
  t('programa.exe', 'MZ');
}

module.exports = [
  {
    nome: 'busca local: lê só documentos (sem node_modules, pasta escondida, .exe), acha pelo nome e pelo texto, relê só o que mudou, tira o que sumiu e pausa sem conferir o Windows a cada arquivo',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-bl-'));
      try {
        const docs = path.join(dir, 'Documentos');
        montar(docs);
        let conferencias = 0;
        const b = new BuscaLocal(path.join(dir, 'indice'), { vetor, ocupado: async () => { conferencias += 1; return false; } });
        const r1 = await b.atualizar([docs]);
        const aluguel = await b.buscar('contrato do aluguel');
        const luz = await b.buscar('conta de luz de setembro');
        const nada = await b.buscar('imposto de renda');
        const r2 = await b.atualizar([docs]);
        fs.writeFileSync(path.join(docs, 'receita-bolo.txt'), 'Bolo de fubá.');
        fs.utimesSync(path.join(docs, 'receita-bolo.txt'), new Date(), new Date(Date.now() + 5000));
        fs.rmSync(path.join(docs, 'curriculo-davi.md'));
        const r3 = await b.atualizar([docs]);
        const outra = new BuscaLocal(path.join(dir, 'indice'), { vetor }); // lê do disco
        return [
          r1.lidos === 4 && r1.total === 4 || JSON.stringify(r1),
          aluguel[0]?.nome === 'locacao-apto-302.txt' && /LOCAÇÃO/.test(aluguel[0].trecho) || JSON.stringify(aluguel.map((a) => a.nome)),
          luz[0]?.nome === 'conta-cpfl-setembro.txt' || JSON.stringify(luz.map((a) => a.nome)),
          nada.length === 0 || `imposto de renda achou ${nada.map((a) => a.nome)}`,
          r2.lidos === 0 && r3.lidos === 1 && r3.removidos === 1 && r3.total === 3 || JSON.stringify([r2, r3]),
          conferencias <= 3 || `conferiu o Windows ${conferencias} vezes`,
          outra.estado().arquivos === 3 || 'o índice gravado',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'busca local no chat: "acha o contrato do aluguel", "onde está o meu currículo?", "qual o valor da minha conta de luz?" (fato), "nos meus arquivos"; e não: "acha o melhor monitor", "onde está o meu mouse?", "onde fica Iconha?", "abre o Discord"',
    tipo: 'unidade',
    executar() {
      const p = (t) => chat.pedidoDeBuscaLocal(t);
      const rotas = require('../../src/agent/rotas-do-codigo');
      return [
        p('acha o contrato do aluguel')?.consulta === 'contrato do aluguel' || JSON.stringify(p('acha o contrato do aluguel')),
        p('onde está o meu currículo?')?.consulta === 'curriculo' || JSON.stringify(p('onde está o meu currículo?')),
        p('procura nos meus arquivos a garantia do monitor')?.consulta === 'garantia do monitor' && p('procura nos meus arquivos a garantia do monitor').explicito === true || 'explícito',
        p('qual o valor da minha conta de luz de setembro?')?.fato === true && p('quando é o meu voo pra Florianópolis?')?.fato === true || 'fato',
        ['acha o melhor monitor de 144Hz', 'procura o preço da RTX 5080', 'onde está o meu mouse?', 'onde fica Iconha?', 'qual o melhor contrato de internet?', 'abre o Discord', 'quanto custa um exame de sangue?'].every((t) => p(t) === null) || 'o que não é busca nos arquivos',
        rotas.escolherRota({ objetivo: 'abre o contrato do aluguel', conversa: [] })?.rota?.id === 'busca_local' && rotas.escolherRota({ objetivo: 'abre o Discord', conversa: [] })?.rota?.id === 'controle_do_pc' || 'rotas',
      ];
    },
  },
  {
    nome: 'busca local no chat: sem pastas, só o pedido explícito explica onde ligar; com índice, o cartão ```arquivos; pergunta de fato vai ao modelo só com os arquivos achados; o processo principal só abre o que está no índice',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-bl-'));
      try {
        const docs = path.join(dir, 'Documentos');
        montar(docs);
        await BuscaLocal.de(path.join(dir, 'busca-local'), { vetor }).atualizar([docs]);
        const deps = { emit: () => {} };
        const semPastas = await chat.responderBuscaLocal({ pedido: chat.pedidoDeBuscaLocal('acha nos meus arquivos o contrato'), deps, config: {}, pasta: dir });
        const implicito = await chat.responderBuscaLocal({ pedido: chat.pedidoDeBuscaLocal('acha o contrato do aluguel'), deps, config: {}, pasta: dir });
        // a instância é a mesma por pasta, e quem criou primeiro (aqui, com o sentido de mentira) manda
                const config = { buscaLocalPastas: [docs] };
        const lista = await chat.responderBuscaLocal({ pedido: chat.pedidoDeBuscaLocal('acha o contrato do aluguel'), deps, config, pasta: dir });
        const pedidos = [];
        const fato = await chat.responderBuscaLocal({
          pedido: chat.pedidoDeBuscaLocal('qual o valor da minha conta de luz de setembro?'),
          deps: { ...deps, chamar: async (m) => (pedidos.push(m), { content: 'R$ 187,45, conforme o arquivo [conta-cpfl-setembro.txt].' }) },
          config,
          pasta: dir,
          pergunta: 'qual o valor da minha conta de luz de setembro?',
        });
        const bloco = JSON.parse(/```arquivos\n([\s\S]*?)\n```/.exec(lista.texto)[1]);
        const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
        return [
          /Ajustes → Memória → Busca nos seus arquivos/.test(semPastas.texto) && implicito === null || `${semPastas?.texto} / ${implicito}`,
          bloco.itens[0].nome === 'locacao-apto-302.txt' && bloco.itens[0].caminho === path.join(docs, 'Casa', 'locacao-apto-302.txt') && bloco.itens[0].pasta === 'Casa' || JSON.stringify(bloco.itens[0]),
          /^R\$ 187,45, conforme o arquivo/.test(fato.texto) && /Use SÓ o que está escrito/.test(pedidos[0][0].content) && /\[conta-cpfl-setembro\.txt\]/.test(pedidos[0][1].content) || fato.texto,
          /Boolean\(buscaLocal\?\.carregar\(\)\.arquivos\[p\]\)/.test(main) && /delete seguro\.buscaLocalPastas/.test(main) && /\^\[a-z\]:\\\\\?\$/.test(main) || 'guardas do processo principal',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'timer: o aviso do Windows sai pelo processo principal (a janela não tem permissão de notificação) e clicar nele cala o bipe',
    tipo: 'unidade',
    executar() {
      const timer = fs.readFileSync(path.join(__dirname, '../../renderer/timer.js'), 'utf8');
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      return [
        !/new Notification\(/.test(timer) && /api\.timer\?\.avisar\(/.test(timer) || 'o timer ainda usa a notificação da janela',
        /ipcMain\.handle\('timer:avisar'/.test(main) && /acao: 'parar-som'/.test(main) && /acao === 'parar-som'/.test(timer) || 'o aviso pelo processo principal',
      ];
    },
  },
];
