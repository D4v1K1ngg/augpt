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

/** Roda na página e cataloga o que dá para clicar, preencher e ler. */
const SCRIPT_DE_LEITURA = `(() => {
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const e = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && e.visibility !== 'hidden' && e.display !== 'none' && e.opacity !== '0';
  };

  const rotulo = (el) => {
    const proprio = (el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.value || el.innerText || el.getAttribute('name') || '').trim();
    if (proprio) return proprio.replace(/\\s+/g, ' ').slice(0, 70);
    const id = el.getAttribute('id');
    if (id) {
      const lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (lab) return lab.innerText.trim().replace(/\\s+/g, ' ').slice(0, 70);
    }
    return el.tagName.toLowerCase();
  };

  const tipoDe = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'seleção';
    if (tag === 'textarea') return 'campo';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return t === 'checkbox' ? 'caixa' : 'opção';
      if (t === 'submit' || t === 'button') return 'botão';
      return 'campo' + (t === 'password' ? ' de senha' : '');
    }
    return 'botão';
  };

  const seletores = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [onclick]';
  const elementos = Array.from(document.querySelectorAll(seletores)).filter(visivel).slice(0, 120);
  window.__augpt = elementos;

  const lista = elementos.map((el, i) => {
    const tipo = tipoDe(el);
    const valor = (el.value && tipo.startsWith('campo') && el.type !== 'password') ? ' = "' + String(el.value).slice(0, 30) + '"' : '';
    return '[' + (i + 1) + '] ' + tipo + ' "' + rotulo(el) + '"' + valor;
  });

  const corpo = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();

  return {
    url: location.href,
    titulo: document.title,
    elementos: lista,
    texto: corpo.slice(0, 6000),
    truncado: corpo.length > 6000,
  };
})()`;

class SessaoNavegador {
  constructor({ visivel = true, timeout = 30000, obterConfig = () => ({}), esperaAposAcao = 1200 } = {}) {
    this.visivel = visivel;
    this.esperaAposAcao = esperaAposAcao;
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

  /** Espera o carregamento terminar, com folga para conteúdo que chega por XHR. */
  aguardarCarregamento(esperaExtra = 900) {
    return new Promise((resolve, reject) => {
      const cronometro = setTimeout(() => reject(new Error('a página não terminou de carregar a tempo')), this.timeout);
      const pronto = () => {
        clearTimeout(cronometro);
        setTimeout(resolve, esperaExtra);
      };
      this.janela.webContents.once('did-finish-load', pronto);
      this.janela.webContents.once('did-fail-load', (_e, codigo, descricao) => {
        if (codigo === -3) return; // abortado por redirecionamento
        clearTimeout(cronometro);
        reject(new Error(`falha ao carregar (${codigo}: ${descricao})`));
      });
    });
  }

  async navegar(url) {
    this.abrir();
    const carregou = this.aguardarCarregamento();
    await this.janela.loadURL(url);
    await carregou;
    return this.ler();
  }

  async ler(entregarEventos = true) {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    const leitura = await this.janela.webContents.executeJavaScript(SCRIPT_DE_LEITURA, true);
    this.ultimaLeitura = leitura;
    const eventos = entregarEventos ? this.eventos.splice(0) : [];
    return eventos.length ? { ...leitura, eventos, janelasAbertas: this.janelas.length } : leitura;
  }

  /** Executa uma ação sobre o elemento numerado e relê a página. */
  async agir(numero, acao) {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    // releitura sem consumir os eventos (eles vão na leitura DEPOIS da ação)
    if (!this.ultimaLeitura) await this.ler(false);

    const indice = Number(numero) - 1;
    if (!Number.isInteger(indice) || indice < 0) throw new Error('informe o número do elemento, como aparece na leitura');

    const resultado = await this.janela.webContents.executeJavaScript(
      `(() => {
        const el = (window.__augpt || [])[${indice}];
        if (!el) return { erro: 'elemento ${numero} não existe nesta página. Releia com ver_pagina.' };
        el.scrollIntoView({ block: 'center' });
        ${acao}
        return { ok: true, tag: el.tagName.toLowerCase() };
      })()`,
      true
    );

    if (resultado?.erro) throw new Error(resultado.erro);

    // clique costuma navegar; damos tempo e relemos
    await new Promise((r) => setTimeout(r, this.esperaAposAcao));
    await this.aguardarEfeitos();
    return this.ler();
  }

  clicar(numero) {
    return this.agir(numero, 'el.click();');
  }

  preencher(numero, valor) {
    const seguro = JSON.stringify(String(valor ?? ''));
    return this.agir(
      numero,
      `el.focus();
       el.value = ${seguro};
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));`
    );
  }

  enviar(numero) {
    return this.agir(
      numero,
      `el.focus();
       const f = el.form || el.closest('form');
       if (f) { f.requestSubmit ? f.requestSubmit() : f.submit(); }
       else { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); }`
    );
  }

  async voltar() {
    if (!this.aberta) throw new Error('o navegador não está aberto');
    const nav = this.janela.webContents.navigationHistory;
    if (nav?.canGoBack?.()) nav.goBack();
    else this.janela.webContents.goBack?.();
    await new Promise((r) => setTimeout(r, this.esperaAposAcao));
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
