'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { protegerSessaoWeb } = require('./sessao-segura');

/**
 * Navegação com interação.
 *
 * O Electron já embute o Chromium, então não há por que trazer um Playwright e
 * baixar um segundo navegador — isso quebraria a promessa de zero dependências
 * do projeto por uma capacidade que a plataforma já oferece.
 *
 * Duas decisões que mudam a usabilidade:
 *
 * 1. A janela é VISÍVEL por padrão. Sites com login são justamente o caso que a
 *    renderização offscreen não resolve, e para logar o usuário precisa ver a
 *    tela. Ele entra uma vez; o agente continua dali.
 *
 * 2. Os elementos são NUMERADOS, não endereçados por seletor CSS. Modelo de 8B
 *    não escreve seletor confiável, mas acerta "clicar no 3" sem esforço.
 */

const PARTICAO = 'persist:augpt-navegador'; // cookies sobrevivem entre sessões: login feito uma vez

/**
 * Revisão v4 (07/10/2026, contracheque real): o agente clicou em "Emitir", o
 * portal abriu uma JANELA NOVA, ele clicou em "Download PDF" e o arquivo foi
 * baixado — mas nada disso aparecia pra ele. A leitura seguia na janela de
 * antes ("nada mudou"), o download não virava evento, e ele terminou dizendo
 * que não conseguiu. Agora janela nova vira a janela ATIVA, e download,
 * janela aberta/fechada viram EVENTOS que vão junto da próxima leitura.
 */
const ESPERA_DOWNLOAD_COM_DIALOGO_MS = 120000; // o usuário escolhe a pasta na janela "Salvar como"
const ESPERA_DOWNLOAD_AUTOMATICO_MS = 60000;
const sessoesComDownload = new WeakSet();
let instanciaAtual = null;

function nomeDeArquivoSeguro(nome) {
  const base = path.basename(String(nome || 'download')).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 120);
  return base || 'download';
}
function caminhoLivre(pasta, nome) {
  const ext = path.extname(nome);
  const raiz = nome.slice(0, nome.length - ext.length);
  let alvo = path.join(pasta, nome);
  for (let i = 2; fs.existsSync(alvo) && i < 1000; i++) alvo = path.join(pasta, `${raiz} (${i})${ext}`);
  return alvo;
}

/**
 * Revisão da navegação (17/10/2026), medida numa página de teste com as
 * armadilhas de sites reais (scratchpad nav-teste.js): antes falhavam 11 de 12.
 * - Lista de elementos: o corte nos 120 primeiros pegava só o menu; agora
 *   campos de formulário sempre entram, depois o que está na tela, depois o
 *   mais perto dela. Entram também botões dentro de shadow DOM e campos de
 *   iframes do mesmo site.
 * - Rótulo: o <label> do campo vem antes do atributo name ("Usuário", não
 *   "j_username"); seleção mostra o valor e as opções; caixa diz se está marcada.
 * - Texto: página longa rolada mostra o texto a partir da tela atual, com a
 *   posição ("tela 3 de 7").
 */
const PREAMBULO = `
  const limpar = (t) => String(t || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
  // o que rola de fato: a página, ou o maior contêiner rolável (sites de uma página só)
  const rolavel = () => {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > innerHeight + 50) return se;
    let melhor = null;
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > innerHeight * 0.4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && (!melhor || el.clientHeight > melhor.clientHeight)) melhor = el;
    }
    return melhor || se;
  };
`;

const SCRIPT_DE_LEITURA = `(() => {
  ${PREAMBULO}
  const LIMITE = 120;
  const SELETORES = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [role=option], [role=radio], [contenteditable=""], [contenteditable=true], [onclick]';
  const achados = [];
  let externos = 0;
  let antiRobo = false;
  const coletar = (raiz, prof) => {
    if (prof > 6) return;
    for (const el of raiz.querySelectorAll('*')) {
      if (el.matches(SELETORES)) achados.push(el);
      if (el.shadowRoot) coletar(el.shadowRoot, prof + 1);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        if (/recaptcha|hcaptcha|turnstile|challenges\\.cloudflare|arkoselabs|funcaptcha/i.test(el.src || '')) antiRobo = true;
        let d = null;
        try { d = el.contentDocument; } catch (e) { d = null; }
        if (d && d.body) coletar(d, prof + 1);
        else if (el.src && !/^about:/.test(el.src)) externos++;
      }
    }
  };
  coletar(document, 0);

  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const e = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    // caixa e opção estilizadas costumam ter opacidade 0 por cima do desenho
    const transparente = e.opacity === '0' && !/^(checkbox|radio)$/i.test(el.type || '');
    return r.width > 0 && r.height > 0 && e.visibility !== 'hidden' && e.display !== 'none' && !transparente;
  };
  // posição na janela principal (soma o deslocamento dos iframes)
  const topoNaJanela = (el) => {
    let y = el.getBoundingClientRect().top;
    let w = el.ownerDocument.defaultView;
    while (w && w !== window && w.frameElement) { y += w.frameElement.getBoundingClientRect().top; w = w.parent; }
    return y;
  };
  const ehCampo = (el) => /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable;

  const visiveis = achados.filter(visivel);
  let escolhidos = visiveis;
  if (visiveis.length > LIMITE) {
    const prioridade = (el) => {
      if (ehCampo(el)) return 0;
      const y = topoNaJanela(el);
      const tela = y >= 0 && y <= innerHeight ? 1 : 2 + Math.abs(y < 0 ? y : y - innerHeight) / innerHeight;
      // menu, cabeçalho e rodapé repetem em toda página: o conteúdo vem antes
      return tela + (el.closest && el.closest('nav, header, footer, aside, [role=navigation], [role=menubar], [role=banner], [role=contentinfo]') ? 1.5 : 0);
    };
    const ordem = visiveis.map((el, i) => [i, prioridade(el)]).sort((a, b) => a[1] - b[1]).slice(0, LIMITE).map(([i]) => i).sort((a, b) => a - b);
    escolhidos = ordem.map((i) => visiveis[i]);
  }
  window.__augpt = escolhidos;

  const rotulo = (el) => {
    const doc = el.ownerDocument;
    const aria = limpar(el.getAttribute('aria-label'));
    if (aria) return aria;
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const t = limpar(ids.split(/\\s+/).map((id) => (doc.getElementById(id) || {}).textContent || '').join(' '));
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      // <label>Estado <select>…</select></label>: só o texto do rótulo, sem as opções
      const copia = el.labels[0].cloneNode(true);
      copia.querySelectorAll('select, input, textarea').forEach((n) => n.remove());
      const t = limpar(copia.textContent);
      if (t) return t;
    }
    const tag = el.tagName.toLowerCase();
    const campoDeTexto = (tag === 'input' && !/^(submit|button|reset|image)$/i.test(el.type)) || tag === 'textarea' || tag === 'select';
    const candidatos = [el.getAttribute('placeholder'), el.getAttribute('title'), campoDeTexto ? '' : el.innerText || el.value, el.getAttribute('alt'), el.querySelector && el.querySelector('img[alt]') && el.querySelector('img[alt]').getAttribute('alt'), el.getAttribute('name')];
    for (const c of candidatos) if (limpar(c)) return limpar(c);
    return tag;
  };

  const tipoDe = (el) => {
    const tag = el.tagName.toLowerCase();
    const papel = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'a' || papel === 'link') return 'link';
    if (tag === 'select') return 'seleção';
    if (tag === 'textarea' || el.isContentEditable) return 'campo';
    if (papel === 'checkbox' || papel === 'switch') return 'caixa';
    if (papel === 'radio' || papel === 'option') return 'opção';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return t === 'checkbox' ? 'caixa' : 'opção';
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'botão';
      return 'campo' + (t === 'password' ? ' de senha' : '');
    }
    return 'botão';
  };

  const lista = escolhidos.map((el, i) => {
    const tipo = tipoDe(el);
    let extra = '';
    if (tipo === 'seleção') {
      const opcoes = Array.from(el.options || []).map((o) => limpar(o.text)).filter(Boolean);
      extra = ' = "' + limpar(el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '') + '" (opções: ' + opcoes.slice(0, 12).join('; ') + (opcoes.length > 12 ? '; …' : '') + ')';
    } else if (tipo === 'caixa' || tipo === 'opção') {
      const marcada = el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
      extra = marcada ? ' (marcada)' : '';
    } else if (tipo === 'campo' && el.value) {
      extra = ' = "' + String(el.value).slice(0, 30) + '"';
    }
    return '[' + (i + 1) + '] ' + tipo + ' "' + rotulo(el) + '"' + extra;
  });

  let corpo = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
  const area = rolavel();
  const total = corpo.length;
  // rolou numa página longa: o texto começa na tela atual (procura o texto do
  // elemento no topo da tela perto da posição proporcional)
  // ponytail: casa pelo texto, então trecho repetido pode ancorar um pouco antes
  if (total > 6000 && area.scrollTop > 50) {
    const estimado = Math.floor(total * area.scrollTop / Math.max(1, area.scrollHeight));
    let inicio = estimado;
    const noTopo = document.elementFromPoint(innerWidth / 2, Math.min(80, innerHeight / 4));
    const trecho = noTopo && limpar(noTopo.innerText).slice(0, 40);
    if (trecho && trecho.length >= 8) {
      const achou = corpo.indexOf(trecho, Math.max(0, estimado - 4000));
      if (achou >= 0 && achou < estimado + 4000) inicio = achou;
    }
    corpo = corpo.slice(inicio);
  }
  if (/n[aã]o sou um rob[oô]|i'?m not a robot|verify you are human|verifique que voc[eê] [eé] humano|confirme que voc[eê] [eé] humano/i.test(corpo.slice(0, 4000))) antiRobo = true;

  return {
    url: location.href,
    titulo: document.title,
    elementos: lista,
    omitidos: visiveis.length - escolhidos.length,
    quadrosExternos: externos,
    antiRobo,
    posicao: { topo: Math.round(area.scrollTop), altura: Math.round(area.scrollHeight), tela: Math.round(area.clientHeight || innerHeight) },
    texto: corpo.slice(0, 6000),
    truncado: corpo.length > 6000,
  };
})()`;

/**
 * Espera a página parar de mudar: 700 ms sem mudança. `primeiraMs` é quanto
 * esperar pela PRIMEIRA mudança — depois de clicar num botão, o resultado
 * costuma chegar da rede 2-3 s depois, sem nada mudar antes.
 */
const scriptDeCalma = (primeiraMs) => `new Promise((pronto) => {
  let fim = null;
  const terminar = () => { clearTimeout(fim); clearTimeout(teto); obs.disconnect(); pronto(true); };
  const obs = new MutationObserver(() => { clearTimeout(fim); fim = setTimeout(terminar, 700); });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  fim = setTimeout(terminar, ${Number(primeiraMs) || 700});
  const teto = setTimeout(terminar, ${(Number(primeiraMs) || 700) + 4000});
})`;

class SessaoNavegador {
  constructor({ visivel = true, timeout = 30000, obterConfig = () => ({}) } = {}) {
    this.visivel = visivel;
    this.timeout = timeout;
    this.obterConfig = obterConfig;
    this.janela = null; // janela ATIVA (a última aberta que continua aberta)
    this.janelas = []; // pilha: principal + janelas novas que o site abriu
    this.ultimaLeitura = null;
    this.eventos = []; // download / janela nova / janela fechada, entregues na próxima leitura
    this.downloadsPendentes = new Set();
    this.carregandoJanelaNova = null;
  }

  get aberta() {
    return Boolean(this.janela) && !this.janela.isDestroyed();
  }

  abrir() {
    if (this.aberta) return this.janela;
    instanciaAtual = this;
    this.janela = new BrowserWindow({
      width: 1200,
      height: 860,
      show: this.visivel,
      title: 'AuGPT · navegador',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTICAO,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    // Fase 1 de segurança (2026-09-23): permissões negadas e rede local
    // barrada dentro do navegador (redirecionamento, iframe, fetch) — ver
    // electron/sessao-segura.js. Janelas novas (pop-up de login "Entrar com
    // Google" e afins) continuam abrindo, mas só http(s), na MESMA sessão
    // protegida e com as mesmas travas (sandbox, sem Node).
    protegerSessaoWeb(this.janela.webContents.session, { obterConfig: this.obterConfig });
    this.prepararDownloads(this.janela.webContents.session);
    const principal = this.janela;
    this.janelas = [principal];
    this.prepararJanela(principal);
    principal.on('closed', () => {
      // fechar a principal fecha a sessão inteira
      for (const j of this.janelas) if (j !== principal && !j.isDestroyed()) j.destroy();
      this.janelas = [];
      this.janela = null;
    });
    return this.janela;
  }

  /** Janela nova aberta pelo site (window.open, target=_blank) vira a ATIVA. */
  prepararJanela(janela) {
    janela.webContents.setWindowOpenHandler(({ url }) =>
      /^https?:/i.test(url)
        ? {
            action: 'allow',
            overrideBrowserWindowOptions: {
              autoHideMenuBar: true,
              show: this.visivel,
              webPreferences: { partition: PARTICAO, sandbox: true, contextIsolation: true, nodeIntegration: false },
            },
          }
        : { action: 'deny' }
    );
    janela.webContents.on('did-create-window', (filha, { url } = {}) => {
      this.janelas.push(filha);
      this.janela = filha;
      this.ultimaLeitura = null;
      const evento = { tipo: 'janela-nova', url: url || '' };
      this.eventos.push(evento);
      filha.__eventoDeAbertura = evento;
      this.prepararJanela(filha);
      this.carregandoJanelaNova = new Promise((resolve) => {
        let resolvida = false;
        const terminar = (espera = 0) => {
          if (resolvida) return;
          resolvida = true;
          clearTimeout(fim);
          setTimeout(resolve, espera);
        };
        const fim = setTimeout(() => terminar(), this.timeout);
        // 2ª revisão: janela que é só um download nunca dispara did-finish-load
        filha.webContents.once('did-finish-load', () => terminar(600));
        filha.webContents.once('did-stop-loading', () => terminar(600));
        filha.webContents.once('did-fail-load', () => terminar());
        filha.once('closed', () => terminar());
        filha.__terminarCarregamento = terminar;
      });
      filha.once('closed', () => {
        this.janelas = this.janelas.filter((j) => j !== filha && !j.isDestroyed());
        if (this.janela === filha) {
          this.janela = this.janelas[this.janelas.length - 1] || null;
          this.ultimaLeitura = null;
          if (this.janela) this.eventos.push({ tipo: 'janela-fechada' });
        }
      });
    });
  }

  /**
   * Download: por padrão o Electron abre a janela "Salvar como" (o usuário
   * escolhe a pasta, como já acontecia). Com `downloadsDoNavegador:
   * 'pasta-de-trabalho'`, salva sozinho em <pasta de trabalho>/downloads.
   * Nos dois casos o fim do download vira evento pro agente.
   */
  prepararDownloads(sessao) {
    if (!sessao || sessoesComDownload.has(sessao)) return;
    sessoesComDownload.add(sessao);
    sessao.on('will-download', (_e, item, origem) => {
      const dona = instanciaAtual;
      if (!dona) return;
      // 2ª revisão: janela nova aberta SÓ pra baixar (window.open(pdf)) fica em
      // branco e viraria a janela ativa — fecha, e a anterior volta a ser a ativa
      const carregadora = dona.janelas.find((j, i) => i > 0 && !j.isDestroyed() && j.webContents === origem);
      if (carregadora) {
        const url = carregadora.webContents.getURL?.() || '';
        if (!url || url === 'about:blank' || url === item.getURL?.()) {
          // sai da pilha JÁ (a leitura depois da ação volta pra janela anterior)
          // e o "nova janela aberta" some — pro agente, foi só um download
          dona.janelas = dona.janelas.filter((j) => j !== carregadora);
          if (dona.janela === carregadora) {
            dona.janela = dona.janelas[dona.janelas.length - 1] || null;
            dona.ultimaLeitura = null;
          }
          dona.eventos = dona.eventos.filter((e) => e !== carregadora.__eventoDeAbertura);
          carregadora.__terminarCarregamento?.();
          setTimeout(() => !carregadora.isDestroyed() && carregadora.destroy(), 50);
        }
      }
      const cfg = dona.obterConfig() || {};
      const nome = nomeDeArquivoSeguro(item.getFilename());
      const automatico = cfg.downloadsDoNavegador === 'pasta-de-trabalho' && cfg.workspace;
      if (automatico) {
        try {
          const pasta = path.join(cfg.workspace, 'downloads');
          fs.mkdirSync(pasta, { recursive: true });
          item.setSavePath(caminhoLivre(pasta, nome));
        } catch {
          /* sem pasta: cai na janela "Salvar como" de sempre */
        }
      }
      const download = { nome, automatico: Boolean(automatico) };
      download.fim = new Promise((resolve) => {
        item.once('done', (_ev, estado) => {
          dona.downloadsPendentes.delete(download);
          dona.eventos.push({
            tipo: 'download',
            estado: estado === 'completed' ? 'concluido' : estado === 'cancelled' ? 'cancelado' : 'falhou',
            nome,
            caminho: item.getSavePath() || '',
            bytes: item.getReceivedBytes() || 0,
          });
          resolve();
        });
      });
      dona.downloadsPendentes.add(download);
    });
  }

  /** Espera janela nova carregar e downloads que a ação disparou terminarem. */
  async aguardarEfeitos() {
    if (this.carregandoJanelaNova) {
      await this.carregandoJanelaNova;
      this.carregandoJanelaNova = null;
    }
    if (!this.downloadsPendentes.size) return;
    const pendentes = [...this.downloadsPendentes];
    const limite = pendentes.some((d) => !d.automatico) ? ESPERA_DOWNLOAD_COM_DIALOGO_MS : ESPERA_DOWNLOAD_AUTOMATICO_MS;
    let estourou = false;
    await Promise.race([
      Promise.all(pendentes.map((d) => d.fim)),
      new Promise((r) => setTimeout(() => {
        estourou = true;
        r();
      }, limite)),
    ]);
    if (estourou) {
      for (const d of pendentes) if (this.downloadsPendentes.has(d)) this.eventos.push({ tipo: 'download', estado: 'em-andamento', nome: d.nome });
    }
  }

  /**
   * Depois de navegar ou agir: se a ação abriu uma página, espera carregar
   * (no máximo o timeout, e aí lê o que já veio — site cheio de anúncio nunca
   * "termina"); depois espera o conteúdo parar de mudar (resultado que chega
   * por XHR 2-3 s depois do clique). Antes era uma espera fixa de 1,2 s.
   */
  async aguardarPagina(minimoMs = 250, primeiraMudancaMs = 700) {
    await new Promise((r) => setTimeout(r, minimoMs));
    await this.aguardarEfeitos();
    if (!this.aberta) return;
    const wc = this.janela.webContents;
    if (wc.isLoading()) {
      await new Promise((resolve) => {
        const fim = setTimeout(resolve, this.timeout);
        wc.once('did-stop-loading', () => {
          clearTimeout(fim);
          resolve();
        });
      });
    }
    try {
      await Promise.race([wc.executeJavaScript(scriptDeCalma(primeiraMudancaMs), true), new Promise((r) => setTimeout(r, primeiraMudancaMs + 5000))]);
    } catch {
      /* a página trocou no meio: a leitura seguinte pega a nova */
    }
  }

  async navegar(url) {
    this.abrir();
    let erro = null;
    // loadURL nunca resolve em página que não termina de carregar: o teto é o timeout
    await Promise.race([
      this.janela.loadURL(url).catch((e) => {
        erro = e;
      }),
      new Promise((r) => setTimeout(r, this.timeout)),
    ]);
    // ERR_ABORTED: redirecionamento ou download, não falha
    if (erro && !/ERR_ABORTED|\(-3\)/.test(`${erro.code || ''} ${erro.message || ''}`)) throw new Error(`falha ao carregar (${erro.code || erro.message})`);
    await this.aguardarPagina(0);
    return this.ler();
  }

  async ler(entregarEventos = true) {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    let leitura;
    try {
      leitura = await this.janela.webContents.executeJavaScript(SCRIPT_DE_LEITURA, true);
    } catch {
      // a página trocou bem na hora da leitura: espera e tenta de novo
      await this.aguardarPagina(500);
      leitura = await this.janela.webContents.executeJavaScript(SCRIPT_DE_LEITURA, true);
    }
    this.ultimaLeitura = leitura;
    const eventos = entregarEventos ? this.eventos.splice(0) : [];
    return eventos.length ? { ...leitura, eventos, janelasAbertas: this.janelas.length } : leitura;
  }

  /**
   * Prepara o elemento N na página (script `preparo`, que vê `el`) e devolve
   * o que o script devolveu. Os eventos da ação vão na leitura depois dela.
   */
  async noElemento(numero, preparo) {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    if (!this.ultimaLeitura) await this.ler(false);
    const indice = Number(numero) - 1;
    if (!Number.isInteger(indice) || indice < 0) throw new Error('informe o número do elemento, como aparece na leitura');
    const resultado = await this.janela.webContents.executeJavaScript(
      `(() => {
        const el = (window.__augpt || [])[${indice}];
        if (!el || !el.isConnected) return { erro: 'elemento ${Number(numero)} não existe nesta página. Releia com ver_pagina.' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        ${preparo}
      })()`,
      true
    );
    if (resultado?.erro) throw new Error(resultado.erro);
    return resultado || {};
  }

  /**
   * Clique de verdade (17/10): o mouse do sistema no meio do elemento, como uma
   * pessoa — botão de cookies, de login e menus que ignoram el.click() (evento
   * sintético) passam a responder. Se outra coisa cobre o elemento (aviso,
   * janela por cima), o clique de mouse cairia nela: aí vai o el.click().
   */
  async clicar(numero) {
    const alvo = await this.noElemento(
      numero,
      `if (el.tagName === 'SELECT') {
          const opcoes = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean).slice(0, 12).join('; ');
          return { erro: 'o elemento ${Number(numero)} é uma seleção: use preencher_campo com o texto da opção (' + opcoes + ').' };
        }
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const raiz = el.getRootNode();
        const emCima = (raiz.elementFromPoint ? raiz : el.ownerDocument).elementFromPoint(cx, cy);
        const livre = emCima && (emCima === el || el.contains(emCima) || emCima.contains(el) || (el.labels && Array.from(el.labels).some((l) => l.contains(emCima))));
        let x = cx, y = cy, w = el.ownerDocument.defaultView;
        while (w && w !== window && w.frameElement) { const f = w.frameElement.getBoundingClientRect(); x += f.left; y += f.top; w = w.parent; }
        const naTela = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
        // caixa, opção e campo mudam sem mudar a página: não há resultado a esperar
        const esperaResultado = !/^(input|select|textarea)$/i.test(el.tagName) || /^(submit|button|image)$/i.test(el.type || '');
        if (!livre || !naTela) { el.click(); return { sintetico: true, esperaResultado }; }
        return { x, y, esperaResultado };`
    );
    if (!alvo.sintetico) {
      const wc = this.janela.webContents;
      const zoom = wc.getZoomFactor?.() || 1;
      const x = Math.round(alvo.x * zoom);
      const y = Math.round(alvo.y * zoom);
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }
    await this.aguardarPagina(250, alvo.esperaResultado ? 3500 : 700);
    return this.ler();
  }

  /**
   * Preencher (17/10): o texto entra como digitação (execCommand insertText,
   * que gera o evento de entrada de verdade) — atribuir el.value não chegava
   * aos campos de React/Vue, que guardam o valor por conta própria. Seleção
   * escolhe pelo texto da opção; caixa aceita "sim"/"não".
   */
  async preencher(numero, valor) {
    const seguro = JSON.stringify(String(valor ?? ''));
    await this.noElemento(
      numero,
      `const valor = ${seguro};
        const norm = (t) => String(t || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const avisar = () => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
        if (el.tagName === 'SELECT') {
          const opcoes = Array.from(el.options);
          const v = norm(valor);
          const op = opcoes.find((o) => norm(o.text) === v || norm(o.value) === v) || (v && opcoes.find((o) => norm(o.text).includes(v)));
          if (!op) return { erro: 'nenhuma opção "' + valor + '" na seleção ${Number(numero)}. Opções: ' + opcoes.map((o) => o.text.trim()).filter(Boolean).slice(0, 12).join('; ') };
          el.value = op.value;
          avisar();
          return { ok: true };
        }
        if (/^(checkbox|radio)$/i.test(el.type || '') || /^(checkbox|switch|radio)$/.test(el.getAttribute('role') || '')) {
          const querMarcada = !/^(nao|não|false|0|desmarcar|desmarcada|off)$/i.test(norm(valor));
          const marcada = el.checked || el.getAttribute('aria-checked') === 'true';
          if (marcada !== querMarcada) el.click();
          return { ok: true };
        }
        const doc = el.ownerDocument;
        el.focus();
        if (el.isContentEditable) {
          const faixa = doc.createRange();
          faixa.selectNodeContents(el);
          const sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(faixa);
        } else if (el.value) {
          // limpa pelo setter nativo (o React enxerga) — select() não vale em campo de e-mail/número
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (valor) doc.execCommand('insertText', false, valor);
        else if (el.isContentEditable) doc.execCommand('delete');
        const atual = el.isContentEditable ? el.innerText : el.value;
        // campo que recusa a digitação (raro): valor pelo setter nativo, que o React também enxerga
        if (valor && !String(atual || '').trim()) {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value');
          if (setter && !el.isContentEditable) setter.set.call(el, valor);
          else el.textContent = valor;
          avisar();
        } else {
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { ok: true };`
    );
    await this.aguardarPagina();
    return this.ler();
  }

  /** Enter de verdade no campo: o formulário envia como se a pessoa apertasse a tecla. */
  async enviar(numero) {
    await this.noElemento(numero, `el.focus(); return { ok: true };`);
    const wc = this.janela.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await this.aguardarPagina(250, 3500);
    return this.ler();
  }

  /** Rola a página (ou o contêiner que rola, nos sites de uma página só). */
  async rolar(direcao = 'baixo') {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    const d = JSON.stringify(String(direcao || 'baixo').toLowerCase());
    await this.janela.webContents.executeJavaScript(
      `(() => {
        ${PREAMBULO}
        const area = rolavel();
        const passo = Math.round((area.clientHeight || innerHeight) * 0.85);
        const d = ${d};
        const alvo = /topo|inicio|início/.test(d) ? 0 : /fim|final|rodap/.test(d) ? area.scrollHeight : area.scrollTop + (/cima|sobe|subir/.test(d) ? -passo : passo);
        area.scrollTo({ top: alvo, behavior: 'instant' });
        // a página de verdade avisa "rolou" (carregamento sob demanda escuta isso)
        (area === document.scrollingElement ? window : area).dispatchEvent(new Event('scroll'));
      })()`,
      true
    );
    await this.aguardarPagina(400);
    return this.ler();
  }

  async voltar() {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    const nav = this.janela.webContents.navigationHistory;
    if (nav?.canGoBack?.()) nav.goBack();
    else this.janela.webContents.goBack?.();
    await this.aguardarPagina(400);
    return this.ler();
  }

  fechar() {
    for (const j of this.janelas) if (j && !j.isDestroyed()) j.destroy();
    if (this.aberta) this.janela.destroy();
    this.janelas = [];
    this.janela = null;
    this.ultimaLeitura = null;
    this.eventos = [];
  }
}

module.exports = { SessaoNavegador, PARTICAO };
