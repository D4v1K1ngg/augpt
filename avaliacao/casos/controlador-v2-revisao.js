'use strict';

/**
 * Revisão independente do Controlador v2 (06/10/2026). Cada caso trava um
 * achado da revisão:
 *   R1. mesmaPergunta: Jaccard sem palavras de moldura; teto de 2 vetos
 *   R2. repetição de ação de página: só barra na 2ª se a anterior idêntica
 *       NÃO mudou nada; valores digitados entram na chave
 *   R3. progresso: qualquer mudança zera; caixa/opção/seleção/campo e voltar
 *       não contam como "sem progresso"
 *   R4. caberNaJanela: remove em pares, encurta do mais antigo, protege as
 *       2 últimas e o pedido; avisa quando nem assim coube
 *   R5. calibração chars/token: só desce, limitada a [2.2, 3.6]
 *   R7. itens de entrega fecham no responder
 *   R8. status: "não encontrei" no meio de resposta longa não é fracasso
 *   R9. itemDaAcao: item com 2 ações ou outro site não é cumprido por 1 ação
 *   R10. eventos novos chegam ao renderer
 *   R11. impressão da página: texto inteiro, sem relógio
 *   S1–S6. segunda revisão: saturado falso em janela grande, clique que
 *       "cumpria" download, perguntas com mês/ano/número, voltar liberado
 *       no beco sem saída, aviso de progresso junto do resultado, navegar
 *       fora do bloqueio de estratégia
 */

const fs = require('fs');
const path = require('path');
const { executarCasoAgente } = require('../motor');
const { caberNaJanela, calibrarRazao, chaveDeRepeticao, itemDaAcao, mesmaPergunta } = require('../../src/agent/loop');
const { statusDaTarefa } = require('../../src/registro');
const nav = require('../../src/tools/navegador');

module.exports = [
  {
    nome: 'revisão v2 (R1): perguntas diferentes que dividem uma palavra não são "a mesma"; moldura ("informe", "verifique") não conta',
    tipo: 'unidade',
    executar() {
      return [
        !mesmaPergunta('Qual sua senha?', 'Qual sua senha do e-mail novo?') || 'senha × senha do e-mail novo',
        !mesmaPergunta('Qual o período do contracheque?', 'Qual o período das férias?') || 'período do contracheque × das férias',
        mesmaPergunta('Qual o período do contracheque?', 'Pode informar o período do contracheque, por favor?') || 'mesma pergunta com cortesia',
        mesmaPergunta('A senha está correta?', 'a senha esta correta?') || 'igual sem acento',
      ];
    },
  },
  {
    nome: 'revisão v2 (R1): o veto de pergunta repetida tem teto de 2 — na 3ª insistência o usuário decide',
    tipo: 'unidade',
    async executar() {
      // o 7B reformula a cada tentativa (texto idêntico cai no guarda geral de repetição)
      const p = (pergunta) => ({ ferramenta: 'perguntar_usuario', argumentos: { pergunta } });
      const obtido = await executarCasoAgente({
        nome: 'r1 teto',
        pedido: 'Leia base.txt e me diga o que fazer',
        arquivos: { 'base.txt': 'Instruções com 3 passos.' },
        respostaDoUsuario: 'agosto de 2026',
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          p('Qual o período do contracheque?'),
          p('Pode informar o período do contracheque?'),
          p('Período do contracheque, por favor?'),
          p('Qual período do contracheque você quer?'),
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Ok.',
        maxIterations: 12,
      });
      const vetos = obtido.copiloto.filter((c) => c.gate === 'pergunta-repetida').length;
      return [vetos === 2 || `vetos de pergunta repetida: ${vetos}`, (obtido.registro.dialogos || []).length === 2 || `perguntas feitas: ${(obtido.registro.dialogos || []).length}`];
    },
  },
  {
    nome: 'revisão v2 (R2): senha errada → corrige o campo → "Entrar" de novo na MESMA página não é barrado; próximo → voltar → próximo também não',
    tipo: 'unidade',
    async executar() {
      // login: a senha não aparece na leitura; Entrar só passa com "certa"
      const paginas = {
        login: { url: 'https://p.exemplo/', titulo: 'Login', elementos: ['[1] campo de senha "Senha"', '[2] botão "Entrar"'], texto: 'Acesso.' },
        dentro: { url: 'https://p.exemplo/inicio', titulo: 'Início', elementos: ['[1] link "Sair"'], texto: 'Bem-vindo.' },
      };
      let atual = 'login';
      let senha = '';
      const acoes = [];
      const login = {
        async navegar() {
          atual = 'login';
          return { ...paginas[atual] };
        },
        async ler() {
          return { ...paginas[atual] };
        },
        async preencher(_n, v) {
          senha = v;
          return { ...paginas[atual] };
        },
        async clicar(n) {
          acoes.push(`clicar:${atual}:${n}`);
          if (atual === 'login' && Number(n) === 2 && senha === 'certa') atual = 'dentro';
          return { ...paginas[atual] };
        },
      };
      const a = await executarCasoAgente({
        nome: 'r2 senha corrigida',
        pedido: 'abra https://p.exemplo/ e entre com a senha',
        navegador: login,
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://p.exemplo/' } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 1, valor: 'errada' } },
          { ferramenta: 'clicar', argumentos: { numero: 2 } },
          { ferramenta: 'preencher_campo', argumentos: { numero: 1, valor: 'certa' } },
          { ferramenta: 'clicar', argumentos: { numero: 2 } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Entrei.',
        maxIterations: 10,
      });
      // carrossel: próximo leva a B, voltar leva a A (mesma impressão), próximo de novo
      const telas = {
        A: { url: 'https://c.exemplo/', titulo: 'A', elementos: ['[1] botão "Próximo"'], texto: 'Tela A.' },
        B: { url: 'https://c.exemplo/b', titulo: 'B', elementos: ['[1] botão "Anterior"'], texto: 'Tela B.' },
      };
      let tela = 'A';
      const cliques = [];
      const carrossel = {
        async navegar() {
          tela = 'A';
          return { ...telas[tela] };
        },
        async ler() {
          return { ...telas[tela] };
        },
        async clicar(n) {
          cliques.push(`${tela}:${n}`);
          tela = tela === 'A' ? 'B' : 'A';
          return { ...telas[tela] };
        },
        async voltar() {
          tela = 'A';
          return { ...telas[tela] };
        },
      };
      const b = await executarCasoAgente({
        nome: 'r2 carrossel',
        pedido: 'abra https://c.exemplo/ e veja as telas',
        navegador: carrossel,
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://c.exemplo/' } },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'voltar_pagina', argumentos: {} },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Vi.',
        maxIterations: 10,
      });
      const ga = a.copiloto.map((c) => c.gate);
      const gb = b.copiloto.map((c) => c.gate);
      return [
        !ga.includes('acao-repetida') || `senha corrigida barrada: ${ga}`,
        acoes.join(' ') === 'clicar:login:2 clicar:login:2' || acoes.join(' '),
        !gb.includes('acao-repetida') || `carrossel barrado: ${gb}`,
        cliques.join(' ') === 'A:1 A:1' || cliques.join(' '),
        chaveDeRepeticao('clicar', { numero: 2 }, { impressao: 'x' }, { 1: 'a' }) !== chaveDeRepeticao('clicar', { numero: 2 }, { impressao: 'x' }, { 1: 'b' }) || 'valores na chave',
        chaveDeRepeticao('clicar', { numero: 2 }, { impressao: 'x' }, {}) === chaveDeRepeticao('clicar', { numero: 2 }, { impressao: 'x' }) || 'sem valores = chave antiga',
      ];
    },
  },
  {
    nome: 'revisão v2 (R3, R11): marcar caixa e voltar não contam como "sem progresso"; qualquer mudança zera; relógio não muda a página; mudança no fim do texto longo muda',
    tipo: 'unidade',
    executar() {
      const base = { url: 'https://f.exemplo/', titulo: 'Form', elementos: ['[1] caixa "Lembrar"', '[2] botão "Ok"', '[3] campo "Nome"'], texto: 'Formulário.' };
      const ctx = {};
      nav.registrarPagina(ctx, base, 'navegar');
      const caixa = nav.registrarPagina(ctx, base, 'clicar', { numero: 1 });
      const n1 = ctx.estado.navSemProgresso;
      nav.registrarPagina(ctx, base, 'voltar_pagina');
      const n2 = ctx.estado.navSemProgresso;
      nav.registrarPagina(ctx, base, 'clicar', { numero: 2 });
      nav.registrarPagina(ctx, base, 'clicar', { numero: 2 });
      const n3 = ctx.estado.navSemProgresso;
      const preencheu = nav.registrarPagina(ctx, base, 'preencher_campo', { numero: 3, valor: 'Davi' });
      const n4 = ctx.estado.navSemProgresso;
      const mesmoValor = nav.registrarPagina(ctx, base, 'preencher_campo', { numero: 3, valor: 'Davi' });
      const longo = 'a'.repeat(5000);
      return [
        /normal ao clicar em caixa/.test(caixa) || caixa,
        n1 === 0 || `caixa contou: ${n1}`,
        n2 === 0 || `voltar contou: ${n2}`,
        n3 === 2 || `botão sem efeito deve contar: ${n3}`,
        /valor digitado/.test(preencheu) || preencheu,
        n4 === 0 || `valor novo no campo é progresso: ${n4}`,
        /mesmo valor/.test(mesmoValor) || mesmoValor,
        nav.impressaoDaPagina({ ...base, texto: 'Sessão expira às 10:41:02 em 06/10/2026' }) === nav.impressaoDaPagina({ ...base, texto: 'Sessão expira às 10:42:13 em 06/10/2026' }) || 'relógio mudou a impressão',
        nav.impressaoDaPagina({ ...base, texto: `${longo} fim` }) !== nav.impressaoDaPagina({ ...base, texto: `${longo} erro: senha inválida` }) || 'mudança no fim do texto ignorada',
      ];
    },
  },
  {
    nome: 'revisão v2 (R4): caberNaJanela remove histórico em pares, protege as 2 últimas mensagens e o pedido, e avisa quando nem assim coube',
    tipo: 'unidade',
    executar() {
      const historico = [{ role: 'user', content: `PEDIDO ${'p'.repeat(3000)}` }];
      for (let i = 0; i < 20; i += 1) {
        historico.push({ role: 'assistant', content: `decisão ${i} ${'x'.repeat(300)}` });
        historico.push({ role: 'user', content: `RESULTADO ${i} ${'y'.repeat(6000)}` });
      }
      const r = caberNaJanela({ sistema: 's'.repeat(12000), historico, volatil: ['SITUAÇÃO'], numCtx: 9216, razao: 2.8 });
      const corpo = r.mensagens.filter((m) => m.role !== 'system');
      const removidas = Number((r.cortes.find((c) => c.startsWith('historico-removido')) || ':0').split(':')[1]);
      // última mensagem enorme (página recém-aberta): fica com ≥ 4000
      const grande = [...historico.slice(0, 9), { role: 'user', content: `PÁGINA NOVA ${'z'.repeat(20000)}` }];
      const g = caberNaJanela({ sistema: 's'.repeat(9000), historico: grande, volatil: [], numCtx: 9216, razao: 2.8 }).mensagens.filter((m) => m.role !== 'system');
      // em vários tamanhos, a mensagem logo depois do pedido nunca é um resultado órfão
      const medio = [{ role: 'user', content: 'PEDIDO curto' }];
      for (let i = 0; i < 20; i += 1) medio.push({ role: 'assistant', content: `decisão ${i} ${'x'.repeat(200)}` }, { role: 'user', content: `RESULTADO ${i} ${'y'.repeat(1300)}` });
      const orfaos = Array.from({ length: 30 }, (_, k) => 4000 + k * 500).filter((t) => {
        const m = caberNaJanela({ sistema: 's'.repeat(t), historico: medio, volatil: [], numCtx: 9216, razao: 2.8 }).mensagens.filter((x) => x.role !== 'system');
        return m.length > 1 && /^RESULTADO/.test(m[1].content);
      });
      const impossivel = caberNaJanela({ sistema: 's'.repeat(40000), historico: historico.slice(0, 3), volatil: [], numCtx: 4096, razao: 2.8 });
      return [
        removidas % 2 === 0 || `removeu número ímpar: ${removidas}`,
        corpo.at(-1).content.length >= 4000 || `última encurtada demais: ${corpo.at(-1).content.length}`,
        corpo.at(-2).content.length >= Math.min(4000, historico.at(-2).content.length) || 'penúltima encurtada demais',
        corpo[0].content.length >= 1000 || `pedido encurtado demais: ${corpo[0].content.length}`,
        /^PEDIDO/.test(corpo[0].content) || 'pedido fica',
        !r.estourou || 'coube',
        g.at(-1).content.length >= 4000 || `página recém-aberta encurtada pra ${g.at(-1).content.length}`,
        orfaos.length === 0 || `resultado sem a decisão que o pediu (sistema ${orfaos})`,
        impossivel.estourou === true || 'não coube e não avisou',
      ];
    },
  },
  {
    nome: 'revisão v2 (R5): calibração de caracteres por token só desce, fica em [2.2, 3.6], e prompt no teto da janela conta como saturado',
    tipo: 'unidade',
    executar() {
      return [
        calibrarRazao(2.8, 4000, 1000, 9216).razao === 2.8 || 'medição alta (4.0) subiu a razão',
        calibrarRazao(2.8, 2500, 1000, 9216).razao === 2.5 || 'medição menor desce',
        calibrarRazao(2.5, 2000, 1000, 9216).razao === 2.2 || 'piso 2.2',
        calibrarRazao(undefined, 3000, 1000, 9216).razao === 2.8 || 'começa em 2.8',
        calibrarRazao(2.8, 9000, 9000, 9216).saturado === true || 'saturado',
        Math.abs(calibrarRazao(2.8, 9000, 9000, 9216).razao - 2.38) < 0.01 || 'saturado baixa 15%',
        calibrarRazao(2.8, 100, 20, 9216).razao === 2.8 || 'medição absurda ignorada',
      ];
    },
  },
  {
    nome: 'revisão v2 (R7, R8): itens de entrega fecham no responder; "não encontrei" no meio de resposta longa não é fracasso',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'r7 entrega',
        pedido: 'Leia base.txt e resuma',
        arquivos: { 'base.txt': 'Conteúdo com 2 números: 10 e 20.' },
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial: '- Ler base.txt\n- Redigir a resposta final para o usuário',
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'resumo' } },
        ],
        redacao: 'Resumo: 10 e 20.',
      });
      // orçamento de vetos esgotado com item real pendente: a entrega fecha,
      // o item lido fica feito NO REGISTRO (antes ficava o checklist do plano)
      const esgotado = await executarCasoAgente({
        nome: 'r7 entrega com pendente',
        pedido: 'Leia base.txt e extra.txt e resuma',
        arquivos: { 'base.txt': 'Conteúdo com 2 números: 10 e 20.', 'extra.txt': 'Mais 30.' },
        config: { pipelineForcadoUniversal: true },
        planejamentoInicial: '- Ler base.txt\n- Ler o arquivo extra.txt\n- Redigir a resposta final para o usuário',
        roteiro: [{ ferramenta: 'ler_arquivo', argumentos: { caminho: 'base.txt' } }, ...Array.from({ length: 4 }, () => ({ ferramenta: 'responder', argumentos: { foco: 'resumo' } }))],
        redacao: 'Resumo: 10 e 20.',
      });
      const meio = `${'Comparação detalhada dos dois modelos. '.repeat(30)}Para o modelo B não encontrei medição de distorção. ${'Mais análise com fontes. '.repeat(40)}Recomendação: modelo A.`;
      return [
        (obtido.checklist || []).every((i) => i.status === 'feito') || JSON.stringify(obtido.checklist),
        obtido.registro.statusDaTarefa?.status === 'sucesso' || JSON.stringify(obtido.registro.statusDaTarefa),
        (esgotado.registro.checklist || []).map((i) => i.status).join(',') === 'feito,pendente,feito' || JSON.stringify(esgotado.registro.checklist),
        (esgotado.registro.statusDaTarefa?.motivos || [])[0] === '1 item(ns) do plano não feito(s)' || JSON.stringify(esgotado.registro.statusDaTarefa),
        statusDaTarefa({ resultado: 'concluido', resposta: meio, checklist: [] }).status === 'sucesso' || 'meio da resposta',
        statusDaTarefa({ resultado: 'concluido', resposta: `Não encontrei o contracheque. ${'x '.repeat(800)}`, checklist: [] }).status === 'parcial' || 'começo da resposta',
        statusDaTarefa({ resultado: 'concluido', resposta: 'O teste falhou em 2 de 10 casos, como o artigo mostra.', checklist: [] }).status === 'sucesso' || '"falhou" descrevendo o assunto',
        statusDaTarefa({ resultado: 'concluido', resposta: 'Ok.', checklist: [{ texto: 'Apresentar o resultado ao usuário', status: 'pendente' }] }).status === 'sucesso' || 'apresentar = entrega',
      ];
    },
  },
  {
    nome: 'revisão v2 (R9): item com duas ações ou com outro site não é cumprido por uma ação só',
    tipo: 'unidade',
    executar() {
      const ck = [
        { texto: 'Acesse portal.exemplo e baixe o PDF do contracheque', status: 'pendente' },
        { texto: 'Compare os preços em loja.exemplo e kabum.com.br', status: 'pendente' },
        { texto: 'Clique em Emitir', status: 'pendente' },
      ];
      return [
        itemDaAcao(ck, { nome: 'navegar', url: 'https://portal.exemplo/' }) === null || 'acessar+baixar marcado pela navegação',
        itemDaAcao(ck, { nome: 'navegar', url: 'https://loja.exemplo/' }) === null || 'outro site citado no item',
        itemDaAcao(ck, { nome: 'clicar', rotulo: 'Emitir' })?.texto === 'Clique em Emitir' || 'rótulo que parece verbo ("Emitir") não conta como 2ª ação',
      ];
    },
  },
  {
    nome: 'revisão v2 (R10): eventos novos do controlador chegam ao renderer (EVENTOS do processo principal + manipuladores)',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const app = fs.readFileSync(path.join(__dirname, '../../renderer/app.js'), 'utf8');
      return ['limite-atingido', 'contexto-ajustado', 'contexto-saturado', 'critica-por-evento'].flatMap((e) => [
        main.includes(`'${e}'`) || `${e} fora de EVENTOS`,
        app.includes(`'${e}'(`) || `${e} sem manipulador`,
      ]);
    },
  },
  {
    nome: 'revisão v2 (S1, S3): janela grande não vira "saturada" com prompt que coube; mês × ano e números diferentes são outra pergunta',
    tipo: 'unidade',
    executar() {
      return [
        calibrarRazao(2.8, 19580 * 2.8, 19580, 20480).saturado === false || 'numCtx 20480: prompt dentro do orçamento marcado saturado',
        calibrarRazao(2.8, 31868 * 2.8, 31868, 32768).saturado === false || 'numCtx 32768: idem',
        calibrarRazao(2.8, 9215 * 2.8, 9215, 9216).saturado === true || 'teto real (9215/9216) continua saturado',
        !mesmaPergunta('Qual mês do contracheque você quer?', 'Qual ano do contracheque você quer?') || 'mês × ano',
        !mesmaPergunta('Posso usar a senha 1234?', 'Posso usar a senha 5678?') || 'números diferentes',
        !mesmaPergunta('Posso usar a senha 1234 no portal do RH da empresa?', 'Posso usar a senha 5678 no portal do RH da empresa?') || 'números diferentes (só o número muda)',
        !mesmaPergunta('Qual a sua senha no site da Receita?', 'Qual a sua senha no site do Gov?') || 'Receita × Gov',
        mesmaPergunta('A senha informada está correta?', 'A senha está correta? Verifique e informe.') || 'continua casando a mesma pergunta',
      ];
    },
  },
  {
    nome: 'revisão v2 (S2): clicar no link "Contracheque" não cumpre "Baixar o contracheque"; "Entrega" não é verbo; preencher só o usuário não cumpre "usuário e senha"',
    tipo: 'unidade',
    executar() {
      const ck = (texto) => [{ texto, status: 'pendente' }];
      return [
        itemDaAcao(ck('Baixar o contracheque'), { nome: 'clicar', rotulo: 'Contracheque' }) === null || 'baixar cumprido por clique no menu',
        itemDaAcao(ck('Entrega do contracheque em PDF'), { nome: 'clicar', rotulo: 'Contracheque' }) === null || 'entrega cumprida por clique',
        itemDaAcao(ck('Preencher usuário e senha'), { nome: 'preencher_campo', rotulo: 'Usuário' }) === null || 'só o usuário',
        itemDaAcao(ck('Clique em Contracheque'), { nome: 'clicar', rotulo: 'Contracheque' }) !== null || 'clique continua valendo',
        itemDaAcao(ck('Abra o menu Contracheque'), { nome: 'clicar', rotulo: 'Contracheque' }) !== null || 'abra continua valendo',
        itemDaAcao(ck('Emitir o contracheque'), { nome: 'clicar', rotulo: 'Emitir' }) !== null || 'botão com o próprio verbo',
        itemDaAcao(ck('Preencher o período de abril'), { nome: 'preencher_campo', rotulo: 'Período' }) !== null || '"abril" não é verbo',
      ];
    },
  },
  {
    nome: 'revisão v2 (S4, S5): no beco sem saída voltar_pagina passa e zera o contador; o aviso de progresso vem junto do resultado, depois da decisão',
    tipo: 'unidade',
    async executar() {
      const parada = {
        async navegar() {
          return { url: 'https://x.exemplo/', titulo: 'Igual', elementos: ['[1] botão "A"', '[2] botão "B"', '[3] botão "C"', '[4] botão "D"'], texto: 'nada muda', truncado: false };
        },
        async clicar() {
          return this.navegar();
        },
        async ler() {
          return this.navegar();
        },
        async voltar() {
          return this.navegar();
        },
      };
      const obtido = await executarCasoAgente({
        nome: 's4 voltar',
        pedido: 'abra https://x.exemplo/ e encontre o botão certo',
        navegador: parada,
        roteiro: [
          { ferramenta: 'navegar', argumentos: { url: 'https://x.exemplo/' } },
          { ferramenta: 'clicar', argumentos: { numero: 1 } },
          { ferramenta: 'clicar', argumentos: { numero: 2 } },
          { ferramenta: 'clicar', argumentos: { numero: 3 } },
          { ferramenta: 'voltar_pagina', argumentos: {} },
          { ferramenta: 'clicar', argumentos: { numero: 4 } },
          { ferramenta: 'responder', argumentos: { foco: 'x' } },
        ],
        redacao: 'Não achei.',
        maxIterations: 12,
      });
      const semProgresso = obtido.copiloto.filter((c) => c.gate === 'sem-progresso').map((c) => c.nome);
      // a mensagem que traz o aviso é o próprio resultado, e vem depois de uma decisão (assistant)
      const msgs = (obtido.mensagensDeDecisao || []).find((ms) => ms.some((m) => /PROGRESSO \(aviso do sistema\)/.test(m.content))) || [];
      const i = msgs.findIndex((m) => /PROGRESSO \(aviso do sistema\)/.test(m.content));
      return [
        !semProgresso.includes('voltar_pagina') || 'voltar barrado no beco sem saída',
        semProgresso.length === 0 || `barrou depois de voltar: ${semProgresso}`,
        i > 0 || 'aviso de progresso ausente',
        (/RESULTADO/.test(msgs[i]?.content || '') && msgs[i].role === 'user') || 'aviso não está dentro do resultado',
        msgs[i - 1]?.role === 'assistant' || `antes do aviso: ${msgs[i - 1]?.role}`,
      ];
    },
  },
  {
    nome: 'revisão v2 (S6): replanejar não bloqueia voltar à URL do login (navegar fica fora do bloqueio de estratégia)',
    tipo: 'unidade',
    executar() {
      const { Tarefa } = require('../../src/agent/tarefa');
      const t = new Tarefa('x');
      t.registrarAcao({ nome: 'navegar', argumentos: { url: 'https://portal.exemplo/Interno' } });
      t.marcarPlanoAnterior('insuficiente', 'teste');
      return [!t.acaoBloqueada('navegar', { url: 'https://portal.exemplo/Interno' }) || 'login bloqueado'];
    },
  },
];
