'use strict';

/**
 * O PC pela voz (31/10, pedido do Davi): "aumenta o volume", "volume em 30%", "muta o som", "abre o Discord",
 * "desliga o PC daqui a 1 hora", "cancela o desligamento", "bloqueia o PC". Nenhuma configuração do sistema muda:
 * o volume é a tecla de volume do teclado, o programa abre pelo menu Iniciar (o mesmo do clique), o desligamento
 * é o `shutdown` do Windows com hora marcada — e "cancela o desligamento" desfaz (`shutdown /a`).
 */

const { execFile, spawn } = require('child_process');
const { duracaoNoTexto, horarioNoTexto, emNumeros } = require('./timer-no-chat');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const palavras = (t) => semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

const PC = '(?:o )?(?:pc|computador|notebook|windows|maquina)';

/* ------------------------------ que pedido é ------------------------------ */

/** { acao, ... } ou null. */
function pedidoDoPc(texto) {
  const t = emNumeros(semAcento(texto).replace(/^(ei |ok |hey )?(jarvis|augpt|gpt)[,!.]?\s*/, '').replace(/[?!.]+$/, '').replace(/\s+por favor$/, '').replace(/\s+/g, ' ').trim());
  // volume
  const nivel = /^(?:(?:coloca|deixa|poe|bota|muda) (?:o )?)?volume (?:em|para|pra|no|a|de)? ?(\d{1,3}) ?(?:%|por cento)?$/.exec(t);
  if (nivel && Number(nivel[1]) <= 100) return { acao: 'volume', nivel: Number(nivel[1]) };
  if (/^(?:(?:coloca|deixa|poe|bota) (?:o )?)?volume (?:no )?(?:maximo|maxima|100)$/.test(t)) return { acao: 'volume', nivel: 100 };
  if (/^(aumenta|aumente|sobe|suba|mais) (o )?(volume|som)( um pouco)?$|^volume mais alto$/.test(t)) return { acao: 'volume', passo: +10 };
  if (/^(abaixa|abaixe|diminui|diminua|baixa|baixe|menos) (o )?(volume|som)( um pouco)?$|^volume mais baixo$/.test(t)) return { acao: 'volume', passo: -10 };
  if (/^(muta|mute|silencia|silencie|tira o som|corta o som|desmuta|tira (?:do|o) mudo|ativa o som|liga o som)( o som| o audio| o pc| o computador)?( do pc| do computador)?$/.test(t)) return { acao: 'mudo' };
  // desligar / reiniciar, com hora ou não
  if (new RegExp(`^cancela(r)? (o |a )?(desligamento|reinicio|reinicializacao)|^nao (desliga|reinicia) (mais )?${PC}?`).test(t)) return { acao: 'cancelar_desligar' };
  const desl = new RegExp(`^(desliga|desligue|desligar|reinicia|reinicie|reiniciar) ${PC}(.*)$`).exec(t);
  if (desl) {
    const resto = desl[2] || '';
    const reiniciar = /^rein/.test(desl[1]);
    const dur = /\b(em|daqui a|daqui|dentro de)\b/.test(resto) ? duracaoNoTexto(resto) : null;
    const hora = !dur ? horarioNoTexto(resto) : null;
    if (resto.trim() && !dur && !hora) return null; // "desliga o pc da tomada?" — não é isto
    return { acao: 'desligar', reiniciar, segundos: dur?.segundos ?? null, hora: hora ? { hora: hora.hora, minuto: hora.minuto } : null };
  }
  if (new RegExp(`^(bloqueia|bloqueie|trava|trave|tranca|tranque) (a tela|${PC})$`).test(t)) return { acao: 'bloquear' };
  // abrir programa: "abre o Discord" — site, arquivo e pasta ficam com o agente
  const abre = /^(?:(?:pode |voce pode )?(?:abre|abra|abrir|inicia|inicie|executa|execute|roda|rode|liga|ligue))(?: o| a| meu| minha)? (.{2,40})$/.exec(t);
  if (abre && !/\b(site|pagina|link|arquivo|pasta|planilha|documento|pdf|foto|imagem|video|https?|www|aba|janela do|conversa|chat|agenda|ajustes|configurac|luz|tv|ar condicionado|porta|portao)\b|\.[a-z]{2,4}\b/.test(abre[1])) return { acao: 'abrir', nome: abre[1].replace(/\b(pra mim|para mim|ai|aqui|agora)$/, '').trim() };
  return null;
}

/* ------------------------------ o Windows ------------------------------ */

const rodar = (exe, args, opcoes = {}) => new Promise((ok, falha) => execFile(exe, args, { windowsHide: true, timeout: 20000, encoding: 'utf8', ...opcoes }, (err, saida) => (err ? falha(err) : ok(String(saida || '')))));
const powershell = (script) => rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);

/** Teclas de volume (0xAF sobe, 0xAE desce, 0xAD mudo): cada toque é 2%. */
function teclasDeVolume(lista) {
  const toques = lista.map(([vk, n]) => `for ($i = 0; $i -lt ${n}; $i++) { [AuGPT.V]::keybd_event(${vk},0,1,[UIntPtr]::Zero); [AuGPT.V]::keybd_event(${vk},0,3,[UIntPtr]::Zero) }`).join('; ');
  return powershell(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);' -Name V -Namespace AuGPT; ${toques}`);
}

let cacheDeApps = null;
/** Os programas do menu Iniciar: [{ nome, id }] (sem desinstaladores e links de site), guardados por 5 min. */
async function appsDoIniciar() {
  if (cacheDeApps && Date.now() - cacheDeApps.em < 5 * 60000) return cacheDeApps.lista;
  const saida = await powershell('[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | ForEach-Object { $_.Name + "`t" + $_.AppID }');
  const lista = saida.split(/\r?\n/).map((l) => l.split('\t')).filter(([n, id]) => n && id && !/uninstall|desinstal|unins\d|remover|remove /i.test(`${n} ${id}`) && !/^https?:/i.test(id)).map(([nome, id]) => ({ nome: nome.trim(), id: id.trim() }));
  cacheDeApps = { em: Date.now(), lista };
  return lista;
}

const APELIDOS = { calculadora: 'Calculadora', 'bloco de notas': 'Bloco de notas', notepad: 'Bloco de notas', navegador: 'Microsoft Edge', edge: 'Microsoft Edge', chrome: 'Google Chrome', 'explorador de arquivos': 'Explorador de Arquivos', explorer: 'Explorador de Arquivos', paint: 'Paint', zap: 'WhatsApp', whats: 'WhatsApp', word: 'Word', excel: 'Excel', 'gerenciador de tarefas': 'Gerenciador de Tarefas' };

/** O app que mais bate com o nome: igual, começa com, ou todas as palavras no nome. */
function acharApp(lista, nome) {
  const alvo = APELIDOS[semAcento(nome)] || nome;
  const busca = palavras(alvo);
  if (!busca.length) return null;
  const nota = (a) => {
    const p = palavras(a.nome);
    if (p.join(' ') === busca.join(' ')) return 100;
    if (p.join(' ').startsWith(busca.join(' '))) return 80 - p.length;
    if (busca.every((b) => p.includes(b))) return 60 - p.length;
    if (busca.length === 1 && busca[0].length >= 4 && p.some((w) => w.startsWith(busca[0]))) return 40 - p.length;
    return 0;
  };
  const melhor = lista.map((a) => ({ a, n: nota(a) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n)[0];
  return melhor?.a || null;
}

/* ------------------------------ a resposta ------------------------------ */

async function responderPc({ pedido, deps = {}, config = {}, agora = new Date(), win = { rodar, teclasDeVolume, appsDoIniciar, abrirApp: (id) => spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).unref() } }) {
  const en = config.idiomaEfetivo === 'en';
  const responder = (texto) => {
    deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
    return { ...SEM_PESQUISA, texto, modo: 'controle-do-pc', noIdioma: en };
  };
  if (process.platform !== 'win32' && !deps.emTeste) return responder(en ? 'Controlling the PC is only available on Windows for now.' : 'Controlar o PC por enquanto só funciona no Windows.');
  try {
    if (pedido.acao === 'volume') {
      if (pedido.passo) {
        await win.teclasDeVolume([[pedido.passo > 0 ? 0xaf : 0xae, Math.abs(pedido.passo) / 2]]);
        return responder(pedido.passo > 0 ? (en ? '🔊 Volume up.' : '🔊 Aumentei o volume.') : (en ? '🔉 Volume down.' : '🔉 Abaixei o volume.'));
      }
      // ponytail: sem ler o volume atual — zera (50 toques) e sobe até o pedido; o Core Audio do Windows leria direto
      await win.teclasDeVolume([[0xae, 50], [0xaf, Math.round(pedido.nivel / 2)]]);
      return responder(en ? `🔊 Volume at ${pedido.nivel}%.` : `🔊 Volume em ${pedido.nivel}%.`);
    }
    if (pedido.acao === 'mudo') {
      await win.teclasDeVolume([[0xad, 1]]);
      return responder(en ? '🔇 Mute toggled (say it again to undo).' : '🔇 Liguei/desliguei o mudo (diga de novo para desfazer).');
    }
    if (pedido.acao === 'cancelar_desligar') {
      try {
        await win.rodar('shutdown.exe', ['/a']);
        return responder(en ? '✅ Shutdown cancelled.' : '✅ Cancelei o desligamento.');
      } catch {
        return responder(en ? 'There was no shutdown scheduled.' : 'Não havia desligamento marcado.');
      }
    }
    if (pedido.acao === 'desligar') {
      let segundos = pedido.segundos;
      if (pedido.hora) {
        const alvo = new Date(agora);
        alvo.setHours(pedido.hora.hora, pedido.hora.minuto, 0, 0);
        if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);
        segundos = Math.round((alvo - agora) / 1000);
      }
      // sem hora: em 1 minuto (dá tempo de salvar ou de cancelar)
      segundos = Math.max(60, Math.min(segundos ?? 60, 24 * 3600));
      await win.rodar('shutdown.exe', [pedido.reiniciar ? '/r' : '/s', '/t', String(segundos)]);
      const hora = new Date(agora.getTime() + segundos * 1000).toLocaleTimeString(en ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
      const oQue = pedido.reiniciar ? (en ? 'restart' : 'reiniciar') : (en ? 'shut down' : 'desligar');
      return responder(en
        ? `⏻ The PC will ${oQue} at **${hora}**. Save your work. To undo, say **"cancel the shutdown"**.`
        : `⏻ O PC vai ${oQue} às **${hora}**. Salve o que estiver aberto. Para desfazer, diga **"cancela o desligamento"**.`);
    }
    if (pedido.acao === 'bloquear') {
      await win.rodar('rundll32.exe', ['user32.dll,LockWorkStation']);
      return responder(en ? '🔒 Screen locked.' : '🔒 Tela bloqueada.');
    }
    if (pedido.acao === 'abrir') {
      const app = acharApp(await win.appsDoIniciar(), pedido.nome);
      if (!app) return responder(en ? `I didn't find **${pedido.nome}** in the Start menu. Is it installed?` : `Não achei **${pedido.nome}** no menu Iniciar. Ele está instalado?`);
      win.abrirApp(app.id);
      return responder(en ? `🚀 Opening **${app.nome}**.` : `🚀 Abrindo **${app.nome}**.`);
    }
  } catch (err) {
    return responder(en ? `I couldn't do that: ${err.message}` : `Não consegui: ${err.message}`);
  }
  return null;
}

module.exports = { pedidoDoPc, acharApp, responderPc, appsDoIniciar };
