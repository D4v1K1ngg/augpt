'use strict';

/**
 * Ferramentas de ver e agir na tela do Windows (19/11). Como no navegador do AuGPT, a tela vira uma lista NUMERADA
 * (pela automação de interface do Windows) e o modelo diz "clicar no 5", "digitar no 3"; o que a lista não mostra, o
 * olho (um modelo de visão pequeno, o Qwen 3.5 4B — medido em 19/11: 4 de 4 botões achados, erro de 3 px, ~0,5 s)
 * aponta pela foto.
 *
 * Segurança:
 *  - a janela do próprio AuGPT nunca é alvo; gerenciador de senha também não;
 *  - campo de senha: o AuGPT não digita (quem digita é o usuário);
 *  - teclas que apagam, salvam por cima ou fecham (Ctrl+A e Delete, Ctrl+S, Ctrl+W, Alt+F4) pedem confirmação até no
 *    modo automático (19/11: num teste, o Bloco de Notas reabriu as abas antigas e o texto foi para um arquivo do
 *    usuário); "abrir o Bloco de Notas" abre uma aba NOVA;
 *  - parar na hora: o mouse no canto superior esquerdo da tela interrompe antes da próxima ação.
 */

const fs = require('fs');
const tela = require('../pc/tela');

const PROIBIDOS = /^(keepass\w*|1password|bitwarden|lastpass|dashlane|enpass|nordpass|securityhealthsystray|secHealthUI)$/i;
const DESTRUTIVAS = /^(ctrl\+s|ctrl\+w|alt\+f4|ctrl\+shift\+s|ctrl\+shift\+w|shift\+delete|delete|del|backspace)$/i;
// colar põe na janela o que o usuário copiou — pode ser pessoal (19/11: num teste, o 9B colou o que estava copiado)
const COLAR = /^(ctrl\+v|shift\+insert|ctrl\+shift\+v)$/i;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
// as páginas das Configurações do Windows (ms-settings:<página>), pelas palavras do pedido (sem acento)
const PAGINAS_DAS_CONFIGURACOES = {
  'gaming-gamemode': /modo de jogo|game ?mode/,
  'gaming-gamebar': /game ?bar|barra de jogo/,
  'colors': /modo escuro|tema escuro|modo claro|cores/,
  'nightlight': /luz noturna/,
  'quiethours': /nao perturbe|assistente de foco/,
  'display': /\btela\b|monitor|resolucao|escala|video/,
  'sound': /\bsom\b|audio|alto-?falante|microfone/,
  'bluetooth': /bluetooth/,
  'network-wifi': /wi-?fi/,
  'windowsupdate': /atualiza/,
  'powersleep': /energia|bateria|suspender/,
  'notifications': /notifica/,
  'mousetouchpad': /mouse|touchpad/,
  'appsfeatures': /aplicativos|programas instalados/,
  'privacy': /privacidade/,
};

// Jogos (21/11, Davi: "testa com jogos mais simples, paciência, xadrez"): no teste, o 9B lia e clicava certo mas jogava
// mal — perdeu o jogo da velha sem bloquear, na paciência só virou o monte (passou por um Ás). Uma regra curta do jogo,
// junto de cada leitura, lembra o que olhar antes do lance.
const DICAS_DE_JOGO = [
  [/jogo da velha|tic.?tac/, 'antes de cada lance: 1) se você completa 3 em linha, jogue lá; 2) se o adversário completa 3 no próximo lance, bloqueie essa casa; 3) senão, o centro, depois um canto.'],
  [/paciencia|solitaire|klondike/, 'antes de virar o monte: 1) Ás vai para a fundação, e depois o 2, o 3… do mesmo naipe; 2) procure uma carta aberta (das colunas ou do descarte) que vá numa coluna: cor diferente e um número abaixo — de preferência a que libera uma carta virada; 3) Rei vai em coluna vazia; 4) só sem nenhum desses lances, vire o monte.'],
  [/xadrez|chess/, 'antes de cada lance: 1) se o seu rei está em xeque, tire-o do xeque; 2) capture uma peça que o adversário deixou sem defesa; 3) não ponha peça sua numa casa onde um peão ou peça do adversário a captura de graça; 4) desenvolva cavalos e bispos e ocupe o centro. Um lance é uma chamada: mover_na_tela com de "e2" e para "e4".'],
];
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const ehJogo = (ctx) => /\bjog(a|ue|ar)\b/.test(semAcento(ctx.objetivo));
const dicaDoJogo = (titulo, objetivo) => (DICAS_DE_JOGO.find(([re]) => re.test(semAcento(`${titulo} ${objetivo}`))) || [])[1] || '';

/** Um elemento da última leitura pelo número ou pelo nome ("e2", "Descarte", "Fundação de copas"). */
function elementoPorNumeroOuNome(ctx, alvo) {
  if (/^\s*\d+\s*$/.test(String(alvo))) return elementoPorNumero(ctx, alvo);
  const lista = ctx.estado.tela?.elementos || [];
  const a = semAcento(alvo);
  const e = lista.find((x) => semAcento(x.nome) === a) ||
    lista.find((x) => semAcento(x.nome).startsWith(a) && !/[a-z0-9]/.test(semAcento(x.nome)[a.length] || '')) ||
    lista.find((x) => semAcento(x.nome).includes(a));
  if (!e) throw new Error(`não achei "${alvo}" na última leitura — use o número ou o nome como aparece na leitura`);
  return e;
}

/** A janela de trabalho: a escolhida (focar_janela), senão a da frente que não é o AuGPT. */
async function janelaAlvo(ctx) {
  const { janelas, frente } = await tela.janelas();
  // as janelas do próprio AuGPT são do processo principal (a do chat, a faixa de aviso); pelo nome não: outros apps em
  // Electron (Discord, VS Code) e o electron.exe de um teste são alvos legítimos (19/11)
  const minhas = (w) => w.pid === process.pid;
  const est = (ctx.estado.tela ||= {});
  const escolhida = est.hwnd && janelas.find((w) => w.hwnd === est.hwnd);
  const alvo = escolhida || janelas.find((w) => w.hwnd === frente && !minhas(w)) || janelas.find((w) => !minhas(w));
  if (!alvo) throw new Error('não achei nenhuma janela aberta além do AuGPT');
  if (PROIBIDOS.test(alvo.processo)) throw new Error(`a janela "${alvo.titulo}" é de um gerenciador de senhas: o AuGPT não mexe nela`);
  est.hwnd = alvo.hwnd;
  return alvo;
}

/** O usuário levou o mouse ao canto superior esquerdo: para tudo. */
async function conferirParada() {
  const c = await tela.cursor();
  if (c.x <= 4 && c.y <= 4) throw new Error('PARADO pelo usuário (mouse no canto superior esquerdo da tela). Não faça mais nada na tela; responda o que foi feito até aqui.');
}

function rotulo(e) {
  const nome = e.nome ? ` "${e.nome}"` : '';
  // documento (Bloco de Notas, editor): o texto linha por linha — numa linha só, o modelo achava que a lista "um item por
  // linha" não tinha saído e digitava de novo (19/11: a lista 7 vezes)
  if (e.tipo === 'documento' && e.valor && /\n/.test(e.valor)) {
    const linhas = e.valor.replace(/\n+$/, '').split('\n');
    return `documento${nome} com ${linhas.length} linha(s):\n${linhas.slice(0, 40).map((l) => `      | ${l.slice(0, 120)}`).join('\n')}`;
  }
  const valor = e.senha ? ' (campo de SENHA — o AuGPT não digita aqui)' : e.valor ? ` = "${e.valor.slice(0, 80)}"` : '';
  const marcado = e.marcado ? ` (${e.marcado === 'sim' ? 'marcada' : 'desmarcada'})` : '';
  return `${e.tipo}${nome}${valor}${marcado}${e.ativo === false ? ' (desativado)' : ''}`;
}

/** Lê a janela de trabalho e devolve o texto numerado (os números valem até a próxima leitura). */
async function lerTela(ctx, { aviso = '' } = {}) {
  const alvo = await janelaAlvo(ctx);
  let { elementos } = await tela.elementos(alvo.hwnd);
  // Chromium (Chrome, Edge, apps em Electron) só liga a acessibilidade quando alguém pergunta: a 1ª leitura vem quase
  // vazia e a 2ª, meio segundo depois, traz os campos (19/11: o formulário saiu em branco por isso)
  if (elementos.filter((e) => e.tipo !== 'texto').length < 4) {
    await pausa(600);
    ({ elementos } = await tela.elementos(alvo.hwnd));
  }
  // dentro da janela; os textos soltos vão no fim, como contexto (sem número)
  const dentro = elementos.filter((e) => e.x + e.w > alvo.x && e.y + e.h > alvo.y && e.x < alvo.x + alvo.w && e.y < alvo.y + alvo.h);
  const acionaveis = dentro.filter((e) => e.tipo !== 'texto');
  const textos = dentro.filter((e) => e.tipo === 'texto').map((e) => e.nome).filter((t, i, a) => a.indexOf(t) === i);
  ctx.estado.tela.elementos = acionaveis;
  ctx.estado.tela.janela = alvo;
  ctx.emit?.('tela-controle', { ativo: true, janela: alvo.titulo });
  const dica = ehJogo(ctx) ? dicaDoJogo(alvo.titulo, ctx.objetivo) : '';
  // num jogo, cada lance gasta passos e uma partida não cabe nos 40 (21/11: o xadrez parou no 7º lance): a janela que
  // mudou depois de uma ação dá um passo a mais; parada (o mesmo clique sem efeito), não — o teto geral segura
  // curta: entra também na chave da trava de ação repetida do loop (o mesmo clique numa janela que mudou é outro lance)
  let assinatura = 0;
  for (const c of `${acionaveis.map(rotulo).join('|')}#${textos.join('|')}`) assinatura = (assinatura * 31 + c.charCodeAt(0)) | 0;
  assinatura = (assinatura >>> 0).toString(36);
  if (ehJogo(ctx) && aviso && ctx.estado.tela.assinatura && assinatura !== ctx.estado.tela.assinatura) ctx.estenderPassos?.(1);
  ctx.estado.tela.assinatura = assinatura;
  return [
    aviso,
    `JANELA: "${alvo.titulo}" (${alvo.processo})`,
    dica && `REGRA DO JOGO — ${dica} Cada lance é UMA chamada de mover_na_tela com de e para (números ou nomes da leitura); para só apertar um botão (virar o monte), clicar_na_tela.`,
    acionaveis.length ? acionaveis.slice(0, 120).map((e, i) => `[${i + 1}] ${rotulo(e)}`).join('\n') : '(a janela não mostra botões nem campos para o Windows — use apontar_na_tela com a descrição do que procura)',
    textos.length ? `\nTEXTOS NA JANELA: ${textos.slice(0, 60).join(' · ').slice(0, 1500)}` : '',
    // as outras janelas (19/11: sem saber que o formulário já estava aberto, o modelo abriu o Edge do usuário)
    await tela
      .janelas()
      .then(({ janelas }) => janelas.filter((w) => w.pid !== process.pid && w.hwnd !== alvo.hwnd).slice(0, 8))
      .then((outras) => (outras.length ? `\nOUTRAS JANELAS ABERTAS (use focar_janela se o pedido for numa delas): ${outras.map((w) => `"${w.titulo.slice(0, 60)}"`).join(' · ')}` : ''))
      .catch(() => ''),
  ]
    .filter(Boolean)
    .join('\n');
}

function elementoPorNumero(ctx, numero) {
  const lista = ctx.estado.tela?.elementos;
  if (!lista) throw new Error('leia a tela antes (ver_tela) para saber os números');
  const e = lista[Number(numero) - 1];
  if (!e) throw new Error(`não há elemento ${numero} na última leitura — leia de novo com ver_tela`);
  return e;
}

/** O olho: um modelo de visão pequeno acha na foto da janela o que a descrição diz; devolve o ponto em pixels da tela. */
async function apontar(ctx, descricao) {
  const alvo = await janelaAlvo(ctx);
  const { arquivo, x, y, w, h } = await tela.foto(alvo.hwnd);
  const imagem = fs.readFileSync(arquivo).toString('base64');
  fs.rmSync(arquivo, { force: true });
  const ollama = require('../llm/ollama');
  const instalados = await ollama.listModels(ctx.config?.host).then((l) => l.map((m) => m.name)).catch(() => []);
  const preferido = String(ctx.config?.olhoDaTela || 'qwen3.5:4b');
  const modelo = instalados.includes(preferido) ? preferido : ctx.config?.model;
  const r = await ollama.chat({ host: ctx.config?.host, model: modelo, messages: [{ role: 'user', content: `Localize ${descricao} nesta captura de tela. Responda só com JSON: {"bbox_2d": [x1, y1, x2, y2]} em coordenadas de 0 a 1000 relativas à imagem. Se não estiver na imagem, responda {"bbox_2d": []}.`, images: [imagem] }], temperature: 0, numPredict: 80, pensar: false });
  const dentro = (/"bbox_2d"\s*:\s*\[([^\]]*)\]/.exec(r.content || '') || [])[1] || '';
  let n = (dentro.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  if (n.length < 4) return null;
  if (/gemma/i.test(modelo)) n = [n[1], n[0], n[3], n[2]]; // o Gemma devolve [y1, x1, y2, x2]
  return { x: x + (((n[0] + n[2]) / 2) / 1000) * w, y: y + (((n[1] + n[3]) / 2) / 1000) * h, modelo };
}

async function prepararJanela(ctx) {
  await conferirParada();
  const alvo = await janelaAlvo(ctx);
  await tela.focar(alvo.hwnd);
  await pausa(150);
  return alvo;
}

module.exports = [
  {
    name: 'ver_tela',
    risk: 'baixo',
    description:
      'Lê a janela de um programa aberto no computador do usuário (não o navegador do AuGPT): o título e a lista NUMERADA de botões, campos, menus e abas, com o que cada campo contém. Use antes de clicar ou digitar num programa (Bloco de Notas, Explorador, Configurações, um site aberto no navegador do usuário).',
    args: {},
    async run(_args, ctx) {
      return lerTela(ctx);
    },
  },
  {
    name: 'focar_janela',
    risk: 'baixo',
    description: 'Escolhe a janela de trabalho pelo título (parte do título basta) e a traz para a frente; sem título, lista as janelas abertas.',
    args: { titulo: 'parte do título da janela, como "Bloco de notas" ou "Formulário"' },
    async run({ titulo } = {}, ctx) {
      const { janelas } = await tela.janelas();
      const outras = janelas.filter((w) => w.pid !== process.pid);
      if (!titulo) return `JANELAS ABERTAS:\n${outras.map((w) => `- "${w.titulo}" (${w.processo})`).join('\n')}`;
      const t = String(titulo).toLowerCase();
      const achada = outras.find((w) => w.titulo.toLowerCase().includes(t)) || outras.find((w) => w.processo.toLowerCase().includes(t));
      if (!achada) return `Nenhuma janela com "${titulo}". JANELAS ABERTAS:\n${outras.map((w) => `- "${w.titulo}" (${w.processo})`).join('\n')}`;
      (ctx.estado.tela ||= {}).hwnd = achada.hwnd;
      await tela.focar(achada.hwnd);
      await pausa(250);
      return lerTela(ctx);
    },
  },
  {
    name: 'abrir_programa',
    risk: 'medio',
    description: 'Abre um programa do Windows pelo nome (Bloco de Notas, Calculadora, Paint, Explorador…) e o deixa como janela de trabalho. O Bloco de Notas abre numa aba nova, em branco. Para as Configurações, diga também a página: "configurações modo de jogo", "configurações som", "configurações tela", "configurações bluetooth"…',
    args: { nome: 'nome do programa, como "bloco de notas" ou "configurações modo de jogo"' },
    obrigatorios: ['nome'],
    async run({ nome }, ctx) {
      const { spawn } = require('child_process');
      const antes = new Set((await tela.janelas()).janelas.map((w) => w.hwnd));
      const n = String(nome).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const conhecidos = { notepad: /bloco|notepad|notas/, calc: /calculadora|calc/, mspaint: /paint/, explorer: /explorador|explorer|arquivos/ };
      // as Configurações do Windows abrem direto na página (20/11, o modo de jogo): ms-settings:<página>
      const ehConfiguracoes = /configurac|settings|modo de jogo|modo escuro|luz noturna|bluetooth/.test(n);
      const exe = ehConfiguracoes ? null : Object.keys(conhecidos).find((k) => conhecidos[k].test(n));
      if (ehConfiguracoes) {
        const pagina = Object.entries(PAGINAS_DAS_CONFIGURACOES).find(([, re]) => re.test(n))?.[0] || '';
        spawn('explorer.exe', [`ms-settings:${pagina}`], { detached: true, stdio: 'ignore' }).unref();
      } else if (exe) spawn(`${exe}.exe`, [], { detached: true, stdio: 'ignore' }).unref();
      else {
        const pc = require('../agent/controle-do-pc');
        const app = pc.acharApp(await pc.appsDoIniciar(), String(nome));
        if (!app) throw new Error(`não achei o programa "${nome}" no menu Iniciar`);
        spawn('explorer.exe', [`shell:AppsFolder\\${app.id || app.AppID || app}`], { detached: true, stdio: 'ignore' }).unref();
      }
      let alvo = null;
      for (let i = 0; i < 40 && !alvo; i += 1) {
        await pausa(250);
        const { janelas, frente } = await tela.janelas();
        alvo = janelas.find((w) => !antes.has(w.hwnd) && w.pid !== process.pid) || (exe && janelas.find((w) => w.hwnd === frente && new RegExp(exe, 'i').test(w.processo))) || (ehConfiguracoes && janelas.find((w) => w.hwnd === frente && /configura|settings/i.test(w.titulo)));
      }
      if (!alvo) throw new Error(`abri "${nome}", mas a janela não apareceu`);
      (ctx.estado.tela ||= {}).hwnd = alvo.hwnd;
      await tela.focar(alvo.hwnd);
      await pausa(300);
      // o Bloco de Notas do Windows 11 reabre as abas antigas: uma aba nova, para não escrever num arquivo do usuário
      if (exe === 'notepad') {
        await tela.teclas('ctrl+n');
        await pausa(400);
      }
      return lerTela(ctx, { aviso: `Abri "${nome}".` });
    },
  },
  {
    name: 'clicar_na_tela',
    risk: 'alto',
    description: 'Clica num elemento da janela de trabalho: pelo número da última leitura (ver_tela) ou, se ele não estiver na lista, pela descrição (o AuGPT acha na imagem). Depois devolve a nova leitura. Para mover uma peça ou carta (clicar na origem e depois no destino), use mover_na_tela, num passo só.',
    args: { numero: 'número do elemento na leitura', descricao: 'o que clicar, se não houver número (ex.: "o botão azul Enviar")', duplo: 'true para clique duplo' },
    async run({ numero: n, posicao, indice, elemento, descricao, duplo } = {}, ctx) {
      const numero = n ?? posicao ?? indice ?? (typeof elemento === 'number' || /^\d+$/.test(String(elemento ?? '')) ? elemento : undefined);
      await prepararJanela(ctx);
      let x;
      let y;
      let o = '';
      if (numero) {
        const e = elementoPorNumero(ctx, numero);
        [x, y, o] = [e.x + e.w / 2, e.y + e.h / 2, rotulo(e)];
      } else if (descricao) {
        const p = await apontar(ctx, String(descricao));
        if (!p) return `Não achei "${descricao}" na janela.\n\n${await lerTela(ctx)}`;
        [x, y, o] = [p.x, p.y, `"${descricao}" (achado na imagem)`];
      } else throw new Error('informe o número do elemento ou a descrição');
      await tela.clicar(x, y, { duplo: duplo === true || duplo === 'true' });
      await pausa(500);
      return lerTela(ctx, { aviso: `Cliquei em ${o}.` });
    },
  },
  {
    name: 'mover_na_tela',
    risk: 'alto',
    description: 'Um lance inteiro num passo: clica no elemento "de" e depois no "para" (mover peça ou carta num jogo, levar um item a outro lugar). Cada um pelo número da leitura ou pelo nome como aparece nela (ex.: de "e2" para "e4"; de "Descarte" para "Coluna 3"). Depois devolve a nova leitura.',
    args: { de: 'número ou nome do elemento de origem', para: 'número ou nome do destino' },
    obrigatorios: ['de', 'para'],
    async run({ de, para } = {}, ctx) {
      await prepararJanela(ctx);
      if (!ctx.estado.tela?.elementos) await lerTela(ctx);
      const a = elementoPorNumeroOuNome(ctx, de);
      // o destino pelo nome é achado depois do 1º clique (a janela pode se redesenhar); pelo número, vale a leitura de antes
      const b0 = /^\s*\d+\s*$/.test(String(para)) ? elementoPorNumero(ctx, para) : null;
      await tela.clicar(a.x + a.w / 2, a.y + a.h / 2);
      await pausa(300);
      if (!b0) ctx.estado.tela.elementos = (await tela.elementos(ctx.estado.tela.hwnd)).elementos.filter((e) => e.tipo !== 'texto');
      const b = b0 || elementoPorNumeroOuNome(ctx, para);
      await conferirParada();
      await tela.clicar(b.x + b.w / 2, b.y + b.h / 2);
      await pausa(500);
      return lerTela(ctx, { aviso: `Cliquei em ${rotulo(a)} e depois em ${rotulo(b)}.` });
    },
  },
  {
    name: 'digitar_na_tela',
    risk: 'alto',
    description: 'Digita um texto num campo da janela de trabalho — diga QUAL: o número da leitura (numero) ou o nome do campo (campo, ex.: "E-mail"). Num formulário, uma chamada por campo. Texto de várias linhas vai de uma vez (cada quebra de linha vira Enter). Não digita em campo de senha. Para Tab e atalhos use tecla_na_tela.',
    args: { texto: 'o texto a digitar', numero: 'número do campo na leitura', campo: 'ou o nome do campo, como aparece na leitura (ex.: "Nome completo")' },
    obrigatorios: ['texto'],
    async run({ texto, numero: n, posicao, indice, elemento, campo } = {}, ctx) {
      const numero = n ?? posicao ?? indice ?? (typeof elemento === 'number' || /^\d+$/.test(String(elemento ?? '')) ? elemento : undefined);
      await prepararJanela(ctx);
      if (!ctx.estado.tela?.elementos) await lerTela(ctx);
      const lista = ctx.estado.tela.elementos;
      const editaveis = lista.filter((e) => e.tipo === 'campo' || e.tipo === 'documento');
      const sem = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
      // 19/11 (formulário de teste): o 9B chamava sem dizer o campo e o texto ia para lugar nenhum — o campo pelo número,
      // pelo nome, ou o único campo da janela (Bloco de Notas); com vários e nenhum escolhido, a lista volta para ele
      let e = null;
      if (numero) e = elementoPorNumero(ctx, numero);
      else if (campo) e = editaveis.find((x) => sem(x.nome) === sem(campo)) || editaveis.find((x) => sem(x.nome).includes(sem(campo)) || (sem(x.nome) && sem(campo).includes(sem(x.nome))));
      else if (editaveis.length === 1) e = editaveis[0];
      else if (editaveis.length > 1) {
        return `Não digitei: a janela tem ${editaveis.length} campos — diga em qual, pelo número ou pelo nome:\n${editaveis.map((x) => `[${lista.indexOf(x) + 1}] ${rotulo(x)}`).join('\n')}`;
      }
      if (campo && !e) return `Não achei o campo "${campo}". Os campos da janela:\n${editaveis.map((x) => `[${lista.indexOf(x) + 1}] ${rotulo(x)}`).join('\n') || '(nenhum)'}`;
      if (e) {
        if (e.senha) throw new Error('é um campo de SENHA: o AuGPT não digita senhas — peça ao usuário para digitar ele mesmo');
        if (e.tipo === 'documento') {
          // documento (Bloco de Notas, editor): o texto continua do fim — clicar nele levava o cursor ao começo da 1ª linha
          // e "feijão" grudava em "arroz" (19/11)
          await tela.teclas('ctrl+end');
        } else await tela.clicar(e.x + Math.min(e.w / 2, 60), e.y + Math.min(e.h / 2, 12));
        await pausa(150);
      }
      // "Ctrl+A" mandado como texto (19/11, o 9B fez isso): é um atalho — aperta, não escreve
      if (/^\s*(ctrl|alt|shift|win)\s*\+\s*[a-z0-9]+\s*$/i.test(String(texto)) || /^\s*(enter|tab|esc)\s*$/i.test(String(texto))) {
        return module.exports.find((f) => f.name === 'tecla_na_tela').run({ teclas: String(texto).trim() }, ctx);
      }
      await tela.digitar(String(texto));
      await pausa(300);
      return lerTela(ctx, { aviso: `Digitei ${String(texto).length} caracteres${e ? ` em ${rotulo(e).replace(/ = ".*$/, '').split('\n')[0]}` : ''}. Confira o texto na leitura abaixo.` });
    },
  },
  {
    name: 'tecla_na_tela',
    risk: 'alto',
    description: 'Aperta uma tecla ou atalho na janela de trabalho: "enter", "tab", "esc", "ctrl+a", "ctrl+s", "alt+tab", "f5", setas ("baixo"). Apagar, salvar e fechar pedem confirmação ao usuário.',
    args: { teclas: 'a tecla ou o atalho, como "ctrl+s" (vários: "ctrl+a, backspace")', texto: 'opcional: um texto digitado ANTES das teclas (ex.: texto "feijão" e teclas "enter")' },
    obrigatorios: ['teclas'],
    async run({ teclas, texto } = {}, ctx) {
      // "ctrl+a, backspace": uma sequência (19/11: o 9B mandava assim); tecla desconhecida: erro antes de qualquer coisa
      const sequencia = String(teclas || '').split(/\s*,\s*/).filter(Boolean);
      if (!sequencia.length) throw new Error('informe a tecla, como "enter" ou "ctrl+s"');
      for (const combo of sequencia) tela.codigosDaTecla(combo);
      const perigosas = sequencia.filter((c) => DESTRUTIVAS.test(c.toLowerCase().replace(/\s+/g, '')) || COLAR.test(c.toLowerCase().replace(/\s+/g, '')));
      if (perigosas.length && typeof ctx.ask === 'function') {
        const colar = perigosas.some((c) => COLAR.test(c.toLowerCase().replace(/\s+/g, '')));
        const r = String((await ctx.ask(`Posso apertar "${teclas}" na janela "${(await janelaAlvo(ctx)).titulo}"? ${colar ? 'Isso cola o que está copiado no seu computador (pode ser algo pessoal).' : 'Isso pode apagar, salvar por cima ou fechar algo.'}`, ['Sim, pode', 'Não'])) || '');
        if (!/^\s*(sim|s|pode|ok|yes)/i.test(r)) return `O usuário não autorizou "${teclas}". Não aperte; siga sem isso (para escrever, use digitar_na_tela) ou pergunte o que ele prefere.`;
      }
      await prepararJanela(ctx);
      // com texto junto ("digita feijão e aperta Enter", como o 9B chama): digita primeiro
      if (texto) {
        await tela.digitar(String(texto));
        await pausa(150);
      }
      for (const combo of sequencia) {
        await tela.teclas(combo);
        await pausa(150);
      }
      await pausa(250);
      return lerTela(ctx, { aviso: `${texto ? `Digitei ${String(texto).length} caracteres e apertei` : 'Apertei'} ${sequencia.join(', ')}.` });
    },
  },
  {
    name: 'rolar_tela',
    risk: 'baixo',
    description: 'Rola a janela de trabalho para baixo (passos positivos) ou para cima (negativos), para ver o resto.',
    args: { passos: 'quantos passos (3 = um bom pedaço; negativo sobe)' },
    async run({ passos = 3 } = {}, ctx) {
      const alvo = await prepararJanela(ctx);
      await tela.rolar(alvo.x + alvo.w / 2, alvo.y + alvo.h / 2, Number(passos) || 3);
      await pausa(300);
      return lerTela(ctx);
    },
  },
];
