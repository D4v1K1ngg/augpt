'use strict';

/**
 * Revisão v4 (07/10/2026) — execuções reais depois do Controlador v2:
 * contracheque (credenciais, janela nova, download), Bose, Simgot EM6L ×
 * SuperMix 4, Kinera Celest Sol. Valores de login/senha aqui são FALSOS.
 */

const fs = require('fs');
const path = require('path');
const { executarCasoAgente } = require('../motor');
const { segredosDoTexto, mascarar, mascararProfundo } = require('../../src/agent/segredos');

const LOGIN = '01234567';
const SENHA = 'abc999';
const PEDIDO_PORTAL = `Acesse esse site (https://portal.exemplo/Interno) o login é (${LOGIN}) e a senha é (${SENHA}), após realizar o login vá em contracheque`;

function arquivosCom(dir, texto) {
  const achados = [];
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p);
      else if (fs.statSync(p).size < 5e6 && fs.readFileSync(p, 'utf8').includes(texto)) achados.push(path.relative(dir, p));
    }
  };
  if (dir && fs.existsSync(dir)) andar(dir);
  return achados;
}

function sessaoComSenha() {
  const paginas = {
    login: { url: 'https://portal.exemplo/Interno', titulo: 'Login', elementos: ['[1] campo "Usuário"', '[2] campo de senha "Senha"', '[3] botão "Entrar"'], texto: 'Acesso restrito.' },
    inicio: { url: 'https://portal.exemplo/Interno/inicio', titulo: 'Início', elementos: ['[1] link "Sair"', '[2] link "Contracheque"'], texto: 'Bem-vindo.' },
  };
  let atual = 'login';
  return {
    async navegar() {
      atual = 'login';
      return { ...paginas[atual] };
    },
    async ler() {
      return { ...paginas[atual] };
    },
    async preencher() {
      return { ...paginas[atual] };
    },
    async clicar(n) {
      if (atual === 'login' && Number(n) === 3) atual = 'inicio';
      return { ...paginas[atual] };
    },
  };
}

module.exports = [
  {
    nome: 'revisão v4 (credenciais): login e senha escritos no pedido são reconhecidos; frases comuns com "senha" não',
    tipo: 'unidade',
    executar() {
      const achados = segredosDoTexto(PEDIDO_PORTAL);
      return [
        achados.includes(LOGIN) || `login: ${achados}`,
        achados.includes(SENHA) || `senha: ${achados}`,
        segredosDoTexto('Minha senha: P@ss_w0rd!').includes('P@ss_w0rd!') || 'senha com símbolo no fim',
        segredosDoTexto('a senha está correta? o login e senha são meus, use uma senha forte').length === 0 || 'frases comuns',
        segredosDoTexto('qual o melhor usuário de linux?').length === 0 || 'usuário sem valor',
        mascarar(`senha ${SENHA}!`, [SENHA]) === 'senha ••••••!' || 'máscara',
        JSON.stringify(mascararProfundo({ a: [SENHA, { b: `x ${LOGIN}` }] }, [SENHA, LOGIN])).includes(SENHA) === false || 'máscara profunda',
      ];
    },
  },
  {
    nome: 'revisão v4 (credenciais): plano, pergunta, resposta, registro e memória gravada saem sem login e senha; o modelo continua vendo o pedido',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v4 credenciais',
        pedido: PEDIDO_PORTAL,
        navegador: sessaoComSenha(),
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial: `- Acesse o portal\n- Entre com login ${LOGIN} e senha ${SENHA}\n- Clique em Contracheque`,
        respostaDoUsuario: 'sim',
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://portal.exemplo/Interno' } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 1, valor: LOGIN } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 2, valor: SENHA } },
          { ferramenta: 'clicar', argumentos: { numero: 3 } },
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta: `O login ${LOGIN} e a senha ${SENHA} estão certos?` } },
          { ferramenta: 'responder', argumentos: { foco: 'entrei' } },
        ],
        redacao: `Entrei no portal com o login ${LOGIN} e a senha ${SENHA}.`,
        maxIterations: 12,
      });
      const registro = JSON.stringify(obtido.registro || {});
      const gravados = [...arquivosCom(obtido.workspace, SENHA), ...arquivosCom(obtido.workspace, LOGIN)];
      return [
        !registro.includes(SENHA) || 'senha no registro',
        !registro.includes(LOGIN) || 'login no registro',
        /••••••/.test(obtido.registro?.resposta || '') || `resposta: ${obtido.registro?.resposta}`,
        gravados.length === 0 || `gravado em: ${gravados}`,
        arquivosCom(obtido.workspace, 'clicar(').length > 0 || 'a memória dos passos não foi gravada (o teste acima não mediria nada)',
        arquivosCom(obtido.workspace, 'preencher_campo(').length === 0 || 'passo de preencher_campo na memória',
        obtido.promptDecisao.includes(SENHA) || 'o modelo precisa ver a senha do pedido pra preencher',
      ];
    },
  },
  {
    nome: 'revisão v4 (credenciais): senha digitada num campo de senha é mascarada mesmo sem estar no pedido',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v4 campo de senha',
        pedido: 'abra https://portal.exemplo/Interno e entre com a senha que está no arquivo base.txt',
        arquivos: { 'base.txt': 'a combinação é zz77qq' },
        navegador: sessaoComSenha(),
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://portal.exemplo/Interno' } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 2, valor: 'zz77qq' } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Preenchi.',
      });
      const registro = JSON.stringify(obtido.registro || {});
      return [!registro.includes('zz77qq') || 'valor do campo de senha no registro', arquivosCom(obtido.workspace, 'zz77qq').filter((f) => f !== 'base.txt').length === 0 || 'gravado'];
    },
  },
  {
    nome: 'revisão v4 (navegador, Electron simulado): janela nova vira a ativa, download concluído e janela fechada viram eventos da leitura',
    tipo: 'unidade',
    async executar() {
      const { EventEmitter } = require('events');
      const Module = require('module');
      const sessao = Object.assign(new EventEmitter(), {});
      class Conteudo extends EventEmitter {
        constructor(janela) {
          super();
          this.janela = janela;
          this.session = sessao;
          this.navigationHistory = { canGoBack: () => false };
        }
        setWindowOpenHandler() {}
        isLoading() {
          return false;
        }
        sendInputEvent() {}
        async loadURL(url) {
          this.janela.url = url;
          setTimeout(() => this.emit('did-finish-load'), 5);
        }
        getURL() {
          return this.janela.url || '';
        }
        async executeJavaScript(codigo) {
          if (/__augpt \|\| \[\]\)\[/.test(codigo)) return this.janela.aoAgir?.() || { ok: true };
          return { url: this.janela.url, titulo: this.janela.titulo, elementos: this.janela.elementos || [], texto: this.janela.titulo, truncado: false };
        }
      }
      class Janela extends EventEmitter {
        constructor(opcoes = {}) {
          super();
          this.titulo = opcoes.title || 'janela';
          this.webContents = new Conteudo(this);
          this.destruida = false;
        }
        loadURL(url) {
          return this.webContents.loadURL(url);
        }
        isDestroyed() {
          return this.destruida;
        }
        destroy() {
          this.destruida = true;
          this.emit('closed');
        }
      }
      const carregar = Module._load;
      Module._load = function (pedido, pai, ...resto) {
        if (pedido === 'electron') return { BrowserWindow: Janela };
        if (pedido === './sessao-segura' && /electron[\\/]navegador\.js$/.test(pai?.filename || '')) return { protegerSessaoWeb() {} };
        return carregar.call(this, pedido, pai, ...resto);
      };
      const caminho = require.resolve('../../electron/navegador');
      delete require.cache[caminho];
      let leituras;
      try {
        const { SessaoNavegador } = require(caminho);
        const s = new SessaoNavegador({ visivel: false, timeout: 2000, obterConfig: () => ({}) });
        await s.navegar('https://portal.exemplo/contracheque');
        const principal = s.janela;
        principal.titulo = 'Contracheque';
        principal.elementos = ['[1] botão "Emitir"'];
        await s.ler();
        // "Emitir" abre janela nova
        let popup;
        principal.aoAgir = () => {
          popup = new Janela({ title: 'Contracheque 09/2026' });
          popup.url = 'https://portal.exemplo/emitido';
          popup.elementos = ['[1] botão "Download PDF"'];
          principal.webContents.emit('did-create-window', popup, { url: popup.url });
          setTimeout(() => popup.webContents.emit('did-finish-load'), 10);
          return { ok: true };
        };
        const l1 = await s.clicar(1);
        // "Download PDF" baixa e o site fecha a janela
        popup.aoAgir = () => {
          const item = Object.assign(new EventEmitter(), {
            getFilename: () => 'contracheque.pdf',
            getSavePath: () => 'C:\\Users\\x\\Downloads\\contracheque.pdf',
            getReceivedBytes: () => 86000,
            setSavePath() {},
          });
          sessao.emit('will-download', {}, item);
          setTimeout(() => item.emit('done', {}, 'completed'), 20);
          return { ok: true };
        };
        const l2 = await s.clicar(1);
        popup.destroy();
        const l3 = await s.ler();
        // modo "salvar sozinho na pasta de trabalho"
        const os = require('os');
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ws-'));
        const s2 = new SessaoNavegador({ visivel: false, timeout: 2000, obterConfig: () => ({ downloadsDoNavegador: 'pasta-de-trabalho', workspace: ws }) });
        await s2.navegar('https://portal.exemplo/x');
        let salvoEm = '';
        s2.janela.elementos = ['[1] botão "Baixar"'];
        await s2.ler();
        s2.janela.aoAgir = () => {
          const item = Object.assign(new EventEmitter(), {
            getFilename: () => '../contra:cheque.pdf',
            getSavePath: () => salvoEm,
            getReceivedBytes: () => 1000,
            setSavePath(p) {
              salvoEm = p;
            },
          });
          sessao.emit('will-download', {}, item);
          setTimeout(() => item.emit('done', {}, 'completed'), 10);
          return { ok: true };
        };
        const l4 = await s2.clicar(1);
        fs.rmSync(ws, { recursive: true, force: true });
        // janela nova que é só um download (window.open(pdf)): em branco, sem did-finish-load
        const s3 = new SessaoNavegador({ visivel: false, timeout: 20000, obterConfig: () => ({}) });
        await s3.navegar('https://portal.exemplo/lista');
        const p3 = s3.janela;
        p3.titulo = 'Lista';
        p3.elementos = ['[1] link "PDF"'];
        await s3.ler();
        p3.aoAgir = () => {
          const branca = new Janela({ title: '' });
          branca.url = '';
          p3.webContents.emit('did-create-window', branca, { url: '' });
          const item = Object.assign(new EventEmitter(), {
            getFilename: () => 'folha.pdf',
            getSavePath: () => 'C:\\x\\folha.pdf',
            getReceivedBytes: () => 500,
            getURL: () => 'https://portal.exemplo/folha.pdf',
            setSavePath() {},
          });
          setTimeout(() => {
            sessao.emit('will-download', {}, item, branca.webContents);
            setTimeout(() => item.emit('done', {}, 'completed'), 10);
          }, 10);
          return { ok: true };
        };
        const t0 = Date.now();
        const l5 = await s3.clicar(1);
        const demorou = Date.now() - t0;
        leituras = [l1, l2, l3, { l4, salvoEm, ws, l5, demorou, ativa: s3.janela === p3 }];
      } finally {
        Module._load = carregar;
        delete require.cache[caminho];
      }
      const [l1, l2, l3, auto] = leituras;
      return [
        auto.ativa || 'janela em branco do download ficou como a ativa',
        auto.demorou < 5000 || `esperou ${auto.demorou} ms pela janela em branco`,
        !(auto.l5.eventos || []).some((e) => e.tipo === 'janela-nova') || 'a janela que era só download apareceu como "nova janela"',
        (auto.l5.eventos || []).some((e) => e.tipo === 'download' && e.estado === 'concluido') || `eventos: ${JSON.stringify(auto.l5.eventos)}`,
        auto.salvoEm === path.join(auto.ws, 'downloads', 'contra_cheque.pdf') || `salvo em: ${auto.salvoEm}`,
        (auto.l4.eventos || []).some((e) => e.tipo === 'download' && e.caminho === auto.salvoEm) || 'evento do download automático',
        l1.titulo === 'Contracheque 09/2026' || `leitura depois de "Emitir" ainda na janela de antes: ${l1.titulo}`,
        (l1.eventos || []).some((e) => e.tipo === 'janela-nova') || 'evento janela nova',
        (l2.eventos || []).some((e) => e.tipo === 'download' && e.estado === 'concluido' && e.nome === 'contracheque.pdf' && /Downloads/.test(e.caminho)) || `download: ${JSON.stringify(l2.eventos)}`,
        l3.titulo === 'Contracheque' || `depois de fechar a janela nova: ${l3.titulo}`,
        (l3.eventos || []).some((e) => e.tipo === 'janela-fechada') || 'evento janela fechada',
      ];
    },
  },
  {
    nome: 'revisão v4 (navegador): com o download concluído e a janela nova à vista, o agente recebe os eventos, o plano fica cumprido e a tarefa sai como sucesso',
    tipo: 'unidade',
    async executar() {
      const telas = {
        lista: { url: 'https://portal.exemplo/contracheque', titulo: 'Contracheque', elementos: ['[1] seleção "Mês"', '[2] botão "Emitir"'], texto: 'Escolha o mês.' },
        emitido: { url: 'https://portal.exemplo/emitido', titulo: 'Contracheque 09/2026', elementos: ['[1] botão "Download PDF"'], texto: 'Folha mensal.' },
      };
      let atual = 'lista';
      const sessao = {
        async navegar() {
          atual = 'lista';
          return { ...telas.lista };
        },
        async ler() {
          return { ...telas[atual] };
        },
        async clicar(n) {
          if (atual === 'lista' && Number(n) === 2) {
            atual = 'emitido';
            return { ...telas.emitido, eventos: [{ tipo: 'janela-nova', url: telas.emitido.url }] };
          }
          if (atual === 'emitido' && Number(n) === 1) {
            return { ...telas.emitido, eventos: [{ tipo: 'download', estado: 'concluido', nome: 'contracheque.pdf', caminho: 'C:\\Users\\x\\Downloads\\contracheque.pdf', bytes: 86000 }] };
          }
          return { ...telas[atual] };
        },
      };
      const obtido = await executarCasoAgente({
        nome: 'v4 download',
        pedido: 'acesse https://portal.exemplo/contracheque, clique em emitir, na nova janela clique em download pdf',
        navegador: sessao,
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial: "- Acesse o portal\n- Clique em 'emitir'\n- Aguarde a abertura da nova janela\n- Clique em 'download pdf' na nova janela\n- Baixe o PDF do contracheque de setembro",
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://portal.exemplo/contracheque' } },
          { ferramenta: 'clicar', argumentos: { numero: 2 } },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'responder', argumentos: { foco: 'baixado' } },
        ],
        redacao: 'O PDF do contracheque foi baixado.',
        maxIterations: 10,
      });
      const pendentes = (obtido.registro.checklist || []).filter((i) => i.status !== 'feito').map((i) => i.texto);
      return [
        /NOVA JANELA ABERTA/.test(obtido.promptDecisao) || 'janela nova no prompt',
        /DOWNLOAD CONCLUÍDO: \\?"contracheque\.pdf\\?" \(84 KB\)/.test(obtido.promptDecisao) || `download no prompt: ${(obtido.promptDecisao.match(/.{0,200}DOWNLOAD.{0,200}/) || ['nenhum'])[0]}`,
        pendentes.length === 0 || `pendentes: ${pendentes}`,
        !/NENHUMA/.test(obtido.promptDecisao.slice(obtido.promptDecisao.indexOf('DOWNLOAD CONCLU'), obtido.promptDecisao.indexOf('DOWNLOAD CONCLU') + 400)) || 'download contado como "nada mudou"',
        (() => {
          const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
          const app = require('../texto-da-tela')();
          return (main.includes("'download-concluido'") && app.includes("'download-concluido'(")) || 'evento download-concluido não chega à tela';
        })(),
        (obtido.registro.downloads || [])[0]?.nome === 'contracheque.pdf' || 'download no registro',
        obtido.registro.statusDaTarefa?.status === 'sucesso' || JSON.stringify(obtido.registro.statusDaTarefa),
      ];
    },
  },
  {
    nome: 'revisão v4 (tipo): endereço + login/clique/download é "agir num site"; só ler um endereço não é',
    tipo: 'unidade',
    executar() {
      const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');
      return [
        tipoDoPedido(PEDIDO_PORTAL).tipo === 'site' || tipoDoPedido(PEDIDO_PORTAL).tipo,
        tipoDoPedido('entre em https://loja.exemplo e clique em rastrear pedido').tipo === 'site' || 'clique',
        tipoDoPedido('resuma https://exemplo.com/artigo').tipo !== 'site' || 'ler não é agir',
        tipoDoPedido('qual a melhor senha para wifi?').tipo !== 'site' || 'sem endereço',
      ];
    },
  },
  {
    nome: 'revisão v4 (site): abrir_pagina/pesquisar antes do navegador é vetado com a instrução de navegar; depois do navegar, segue normal',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'v4 site pelo navegador',
        pedido: PEDIDO_PORTAL,
        navegador: sessaoComSenha(),
        roteiro: [
          { ferramenta: 'abrir_pagina', argumentos: { url: 'https://portal.exemplo/Interno' } },
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'O login está certo?' } },
          { ferramenta: 'navegar', argumentos: { url: 'https://portal.exemplo/Interno' } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Abri o portal.',
        maxIterations: 10,
      });
      const gates = obtido.copiloto.filter((c) => c.gate === 'site-pelo-navegador').map((c) => c.nome);
      return [
        gates[0] === 'abrir_pagina' || `vetos: ${gates}`,
        /"nome": "navegar", "argumentos": \{"url": "https:\/\/portal\.exemplo\/Interno"/.test(obtido.promptDecisao.replace(/\\"/g, '"')) || 'instrução com a URL do pedido',
        !obtido.perguntouAoUsuario || 'perguntou antes de tentar o login',
        obtido.ok || obtido.motivo,
      ];
    },
  },
  {
    nome: 'revisão v4 (plano): sem cardápio no prompt; "calcular"/"gerar resumo"/preço que o pedido não pediu saem do plano; "pesquise o site" sai do plano de agir no site',
    tipo: 'unidade',
    async executar() {
      const { itemNaoExecutavel } = require('../../src/agent/loop');
      const kinera = 'Realize uma pesquisa sobre esse fone (Kinera Celest Sol Headphone 1DD+1BC) veja pra min se ele é bom para jogos fps ?';
      const obtido = await executarCasoAgente({
        nome: 'v4 plano sem cardapio',
        pedido: kinera,
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial:
          '- Pesquisar especificações técnicas do fone Kinera Celest Sol\n- Calcular a compatibilidade entre o fone e os principais jogos FPS atuais\n- Comparar preços em marketplaces\n- Gerar um resumo comparativo das informações coletadas\n- Responder se o fone é bom para FPS',
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'x' } }],
        redacao: 'Resposta.',
      });
      const itens = (obtido.checklist || []).map((i) => i.texto).join(' | ');
      return [
        !/calcular, gerar um arquivo/.test(obtido.promptPlanejamento) || 'cardápio ainda no prompt',
        !/Calcular|Comparar preços|Gerar um resumo/.test(itens) || `plano: ${itens}`,
        /Pesquisar especificações/.test(itens) || `item legítimo saiu: ${itens}`,
        itemNaoExecutavel('Calcular a média de preço', 'qual a média de preço da RTX 5070 nos últimos meses?') === null || 'cálculo pedido fica',
        itemNaoExecutavel('Gerar um relatório em PDF', 'pesquise X e gere um relatório em pdf') === null || 'arquivo pedido fica',
        itemNaoExecutavel('Pesquise o site https://portal.exemplo/Interno', PEDIDO_PORTAL, 'site') !== null || 'pesquisar o site num pedido de agir',
      ];
    },
  },
  {
    nome: 'revisão v4 (memória): ao carregar, passos de preencher_campo antigos saem e "a senha é (…)" gravado antes da correção vira ••••••',
    tipo: 'unidade',
    executar() {
      const os = require('os');
      const { Memory } = require('../../src/agent/memory');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-mem-'));
      try {
        fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify([
          { id: '1', tipo: 'passo', texto: `Passo 12 — preencher_campo({"numero":"2","valor":"${SENHA}"}) → ok` },
          { id: '2', tipo: 'tarefa', texto: `Pedido: entre no portal, o login é (${LOGIN}) e a senha é (${SENHA}).` },
          { id: '3', tipo: 'nota', texto: 'Davi prefere respostas em tópicos.' },
        ]));
        const m = new Memory({ dir, config: {} });
        const gravado = fs.readFileSync(path.join(dir, 'memory.json'), 'utf8');
        return [
          m.items.length === 2 || `itens: ${m.items.length}`,
          !gravado.includes(SENHA) && !gravado.includes(LOGIN) || 'segredo continua no arquivo',
          gravado.includes('Davi prefere respostas em tópicos.') || 'nota comum foi mexida',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'revisão v4 (status, consulta, cardápio): verificador entra no status (menos em ação num site); consulta embrulhada na chamada é desembrulhada; "veja" não é assunto',
    tipo: 'unidade',
    executar() {
      const { statusDaTarefa } = require('../../src/registro');
      const protocolo = require('../../src/agent/protocolo');
      const loop = require('../../src/agent/loop');
      const base = { resultado: 'concluido', resposta: 'Recomendo o HD 560S.', checklist: [], verificacao: { respondeAoPedido: false } };
      const arg = { consulta: 'pesquisar_e_ler(comentários uso fones jogos fps)' };
      const semSentido = protocolo.argumentoSemSentido({ name: 'pesquisar_e_ler' }, arg, {});
      const cob = loop.medirCobertura('Realize uma pesquisa sobre esse fone (Kinera Celest Sol) veja pra min se ele é bom para jogos fps', [{ texto: 'nada aqui' }]);
      return [
        statusDaTarefa({ ...base, tipoDePedido: { tipo: 'produto' } }).status === 'parcial' || 'resposta fora do pedido saiu sucesso',
        statusDaTarefa({ ...base, tipoDePedido: { tipo: 'site' } }).status === 'sucesso' || 'ação num site não usa o verificador de texto',
        semSentido === null && arg.consulta === 'comentários uso fones jogos fps' || `consulta: ${arg.consulta} / ${semSentido?.motivo}`,
        (cob.ausentes.length >= 3 && !cob.ausentes.includes('veja') && !cob.ausentes.includes('min')) || `termos: ${JSON.stringify(cob.ausentes)}`,
      ];
    },
  },
  {
    nome: 'revisão v4 (Bose): pergunta-cardápio ("quer saber specs, preços ou avaliações?") com pedido claro é vetada uma vez',
    tipo: 'unidade',
    async executar() {
      const pergunta = 'Você gostaria de saber sobre as especificações técnicas, os preços ou as avaliações?';
      const obtido = await executarCasoAgente({
        nome: 'v4 cardapio',
        pedido: 'Leia base.txt e me conte mais sobre esse fone',
        arquivos: { 'base.txt': 'Fone X: driver de 10 mm, 32 ohms.' },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'O fone X tem driver de 10 mm.',
      });
      const gates = obtido.copiloto.map((c) => c.gate);
      return [gates.includes('pergunta-cardapio') || `gates: ${gates}`, !obtido.perguntouAoUsuario || 'perguntou mesmo assim'];
    },
  },
  {
    nome: 'revisão v4 (Simgot): plano do motor com as duas opções numa linha só vira duas opções',
    tipo: 'unidade',
    executar() {
      const { lerPlanoDePesquisa } = require('../../src/agent/motor-pesquisa');
      const plano = lerPlanoDePesquisa(
        'USO: jogar PUBG\nCRITÉRIOS:\n- posicionamento | alto | passos\n- conforto | médio | conforto\nOPÇÕES CITADAS NO PEDIDO:\n- Simgot EM6L, Simgot SuperMix 4\nBUSCAS DE DESCOBERTA:\n- fones pubg',
        'qual fone para pubg?'
      );
      return [JSON.stringify(plano?.opcoesCitadas) === JSON.stringify(['Simgot EM6L', 'Simgot SuperMix 4']) || JSON.stringify(plano?.opcoesCitadas)];
    },
  },
  {
    nome: 'revisão v4 (2ª revisão): credenciais nas frases comuns; sem falso segredo, falso produto ou falso "site"; consulta "read_csv(...)" intacta; ids não mascarados; contas pedidas ficam no plano',
    tipo: 'unidade',
    executar() {
      const { tipoDoPedido, produtosNomeados } = require('../../src/agent/tipo-de-pedido');
      const protocolo = require('../../src/agent/protocolo');
      const { itemNaoExecutavel } = require('../../src/agent/loop');
      const seg = (t) => JSON.stringify(segredosDoTexto(t));
      const busca = { consulta: 'read_csv(delimiter)' };
      protocolo.argumentoSemSentido({ name: 'pesquisar_e_ler' }, busca, { catalogo: [{ name: 'pesquisar_e_ler' }] });
      return [
        seg('login e senha: 0100/abc123') === '["0100","abc123"]' || seg('login e senha: 0100/abc123'),
        seg('usuário e senha: Abc12345') === '["Abc12345"]' || 'usuário e senha',
        seg('a senha de acesso é 4821') === '["4821"]' || 'senha de acesso',
        ['o usuário-final quer', 'user-agent do chrome', 'senha (anotada no papel)', 'senha (trocada em 2024)', 'usuário (meu CPF)', 'token (JWT)', 'login com OAuth'].every((t) => seg(t) === '[]') || 'falso segredo',
        ['qual o melhor fone (até R$ 300) para pubg?', 'qual melhor fone (Bluetooth) pra jogar?', 'melhor fone para jogar (PUBG Mobile)?', 'qual o melhor celular para jogar (Free Fire)?', 'vale a pena o iPhone 15 (128 GB)?', 'qual o melhor notebook (Obs: precisa ter 16GB)?'].every((t) => produtosNomeados(t).length === 0) || 'falso produto nomeado',
        ['Leia https://x.com/a sobre selecionar um plano', 'Resuma https://blog.x.com notas fiscais emitidas', 'O que https://docs.x.com diz sobre login com OAuth?', 'acesse https://x.com e resuma'].every((t) => tipoDoPedido(t).tipo !== 'site') || 'falso site',
        busca.consulta === 'read_csv(delimiter)' || `consulta mexida: ${busca.consulta}`,
        mascararProfundo({ id: 'aprovacao-1791-4821', texto: 'senha 4821' }, ['4821']).id === 'aprovacao-1791-4821' || 'id mascarado',
        itemNaoExecutavel('Calcular a soma', 'Some 12 e 15') === null || 'some',
        itemNaoExecutavel('Calcular o valor de x', 'Resolva 3x+5=20') === null || 'resolva',
      ];
    },
  },
  {
    nome: 'revisão v4 (2ª revisão): status — resposta montada não cai pelo verificador de texto; produto nomeado que ficou de fora deixa parcial; senha dada na resposta ao agente é mascarada',
    tipo: 'unidade',
    async executar() {
      const { statusDaTarefa } = require('../../src/registro');
      const obtido = await executarCasoAgente({
        nome: 'v4 senha na resposta',
        pedido: 'abra https://portal.exemplo/Interno e entre',
        navegador: sessaoComSenha(),
        respostaDoUsuario: 'a senha é qq88zz',
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://portal.exemplo/Interno' } },
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'Qual a senha?' } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Usei a senha qq88zz.',
        maxIterations: 8,
      });
      return [
        statusDaTarefa({ resultado: 'concluido', resposta: 'x', checklist: [], verificacao: { respondeAoPedido: false }, respostaMontada: true, tipoDePedido: { tipo: 'produto' } }).status === 'sucesso' || 'montada caiu pelo verificador',
        statusDaTarefa({ resultado: 'concluido', resposta: 'x', checklist: [], respostaIncompleta: ['Simgot EM6L'], respostaMontada: true }).status === 'parcial' || 'nomeado de fora não deixou parcial',
        !JSON.stringify(obtido.registro).includes('qq88zz') || 'senha da resposta no registro',
      ];
    },
  },
  {
    nome: 'decisores (08/10): "(especificamente: …)" da reescrita e o assunto de "Questão 1 (…)" não são produto; questão de prova não cai em "produto"',
    tipo: 'unidade',
    executar() {
      const { tipoDoPedido, produtosNomeados } = require('../../src/agent/tipo-de-pedido');
      const { modoDaPesquisa } = require('../../src/agent/motor-pesquisa');
      const tcp = 'O que é o protocolo TCP three-way handshake? (especificamente: Explicar os conceitos técnicos)';
      const prova = 'Questão 1 (Teoria da Complexidade) Qual foi o primeiro problema NP-Completo? Questão 2 (Sistemas Operacionais) O que é thrashing?';
      const pergunta = 'Pergunta 1 Qual dos modelos a seguir não é considerado para o gerenciamento de serviços de TI? a. PMBOK. b. ITIL. c. MOF. d. CMMI SVC.';
      return [
        produtosNomeados(tcp).length === 0 || JSON.stringify(produtosNomeados(tcp)),
        modoDaPesquisa(tcp) === null || `TCP foi pro motor: ${modoDaPesquisa(tcp)}`,
        produtosNomeados(prova).length === 0 || JSON.stringify(produtosNomeados(prova)),
        tipoDoPedido(prova).tipo === 'livre' || tipoDoPedido(prova).tipo,
        tipoDoPedido(pergunta).tipo === 'livre' || tipoDoPedido(pergunta).tipo,
        JSON.stringify(produtosNomeados('Me conte mais sobre esse fone de ouvido (Bose Noise Cancelling Wired Earbuds)')) === '["Bose Noise Cancelling Wired Earbuds"]' || 'nome sem dígito depois de "fone" continua valendo',
        produtosNomeados('Procure os melhores preços (especificamente: RTX 5080 Founders Edition)').length === 0 || 'rótulo "especificamente:" com dígito',
        produtosNomeados('vale a pena visitar o museu (Grande Colisor de Hadrons) em Genebra?').length === 0 || 'nome próprio sem dígito e sem substantivo de produto antes',
      ];
    },
  },
  {
    nome: 'decisores: o comparador fala com /v1/systemone (formato da documentação), mede acerto/confiança/latência e pula os modelos quando o Ollama é anterior à 0.35',
    tipo: 'unidade',
    async executar() {
      const http = require('http');
      const decisores = require('../decisores');
      const pedidos = [
        { id: 'a', pedido: 'qual o melhor fone intra para pubg?', esperado: { rota: 'produto', precisa_web: true, produto_nomeado: false, continuacao: false } },
        { id: 'b', pedido: 'como funciona um buraco negro?', esperado: { rota: 'explicacao', precisa_web: false, produto_nomeado: false, continuacao: false } },
      ];
      const recebidos = [];
      let versao = '0.35.1';
      const srv = http.createServer((req, res) => {
        let corpo = '';
        req.on('data', (c) => (corpo += c));
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/api/version') return res.end(JSON.stringify({ version: versao }));
          const j = JSON.parse(corpo || '{}');
          recebidos.push({ url: req.url, j });
          const ehBuraco = /buraco/.test(j.state);
          res.end(JSON.stringify({
            model: j.model,
            answers: {
              rota: { type: 'choice', choice: ehBuraco ? 'explicacao' : 'produto', probabilities: ehBuraco ? { explicacao: 0.9, produto: 0.1 } : { produto: 0.55, tarefa: 0.45 }, confidence: ehBuraco ? 0.8 : 0.3 },
              precisa_web: { type: 'noul', noul: ehBuraco ? 0.2 : 0.9 },
              produto_nomeado: { type: 'noul', noul: 0.1 },
              continuacao: { type: 'noul', noul: 0.05 },
            },
            usage: { input_tokens: 200, output_tokens: 4 },
          }));
        });
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const host = `http://127.0.0.1:${srv.address().port}`;
      try {
        const r = await decisores.executar({ host, modelos: ['tev1:0.8b'], pedidos, log: () => {} });
        versao = '0.30.10';
        const antigo = await decisores.executar({ host, modelos: ['tev1:0.8b'], pedidos, log: () => {} });
        const req = recebidos.find((x) => x.url === '/v1/systemone')?.j || {};
        const m = r.resultados['tev1:0.8b'];
        return [
          req.model === 'tev1:0.8b' && typeof req.state === 'string' && req.questions?.rota?.type === 'choice' && req.questions.rota.criteria?.site && req.questions.precisa_web?.type === 'noul' || `pedido: ${JSON.stringify(req).slice(0, 300)}`,
          m.decisoes.rota.acerto === 1 && m.decisoes.precisa_web.acerto === 1 || JSON.stringify(m.decisoes),
          m.decisoes.rota.cobertura === 0.5 && m.decisoes.rota.acertoConfiante === 1 || `confiança: ${JSON.stringify(m.decisoes.rota)}`,
          r.resultados.regras.decisoes.rota.n === 2 || 'regras também medidas',
          (!antigo.resultados['tev1:0.8b'] && Boolean(antigo.resultados.regras)) || 'Ollama antigo deveria pular o modelo e manter as regras',
          decisores.compararVersao('0.30.10', '0.35.0') < 0 && decisores.compararVersao('0.35.2', '0.35.0') > 0 || 'comparação de versão',
          (() => {
            const muitos = ['produto', 'guia', 'tarefa'].flatMap((rota) => Array.from({ length: 10 }, (_, i) => ({ id: `${rota}${i}`, esperado: { rota } })));
            const am = decisores.amostrar(muitos, 9);
            return (am.length === 9 && ['produto', 'guia', 'tarefa'].every((rota) => am.filter((p) => p.esperado.rota === rota).length === 3)) || `amostra: ${am.map((p) => p.id)}`;
          })(),
          (() => {
            const comb = decisores.combinarComRegras(r.detalhes['tev1:0.8b'], r.detalhes.regras, 0.6);
            // "a" (confiança 0,3) fica com a regra; "b" (0,8) fica com o modelo
            return (comb.find((l) => l.id === 'a').decisao.rota.origem === 'regra' && comb.find((l) => l.id === 'b').decisao.rota.origem === 'modelo' && r.resultados['tev1:0.8b+regras']) ? true : 'combinação modelo confiante + regra';
          })(),
        ];
      } finally {
        await new Promise((r) => srv.close(r));
      }
    },
  },
];
