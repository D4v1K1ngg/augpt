'use strict';

/**
 * A pesquisa narrada no chat (31/10, pedido do Davi: "ir construindo a resposta no chat", como o Claude faz).
 * Começa na primeira busca na web (resposta rápida não busca e não tem narração): uma frase com o plano, uma
 * frase por página que trouxe algo (no máximo uma a cada 5 s, e 5 por resposta) e "montando a resposta" quando a
 * escrita começa. Cada frase leva o que aconteceu desde a anterior ("3 buscas · 2 páginas"), que abre a
 * Atividade do agente. As frases vêm do modelo leve no processador (qwen3.5:4b, escolhido em Ajustes → Voz) —
 * com número conferido contra a página — ou do código, sem ele. A mesma frase da página serve à voz (uma chamada só).
 */
(function () {
  const ENTRE_FRASES_MS = 5000;
  const MAXIMO = 5;
  const QUIETO_MS = 15000;
  let n = null;

  const embrulhar = (canal, antes) => {
    const original = manipuladores[canal];
    manipuladores[canal] = (d = {}) => {
      try {
        antes(d);
      } catch {
        // a narração nunca atrapalha a tela
      }
      return original?.(d);
    };
  };
  const ingles = () => window.i18n?.idioma === 'en';
  const plural = (q, um, muitos) => `${q} ${q === 1 ? um : muitos}`;

  function parar() {
    if (n) clearInterval(n.laco);
    n = null;
  }

  /** "· 3 buscas · 2 páginas" desde a frase anterior — o clique abre a Atividade do agente. */
  function meta() {
    const b = n.buscas - n.base.buscas;
    const l = n.lidas - n.base.lidas;
    n.base = { buscas: n.buscas, lidas: n.lidas };
    const partes = [];
    if (b) partes.push(ingles() ? plural(b, 'search', 'searches') : plural(b, 'busca', 'buscas'));
    if (l) partes.push(ingles() ? plural(l, 'page read', 'pages read') : plural(l, 'página lida', 'páginas lidas'));
    return partes.join(' · ');
  }

  function escrever(texto, { comMeta = true } = {}) {
    if (!n || !texto || !n.turno.caixa.isConnected) return;
    let caixa = n.turno.caixa.querySelector('.narracao');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'narracao';
      caixa.dataset.semTraducao = '';
      n.turno.atividade.before(caixa);
      // a narração vira o andamento visível; os passos ficam no cartão, fechado
      n.turno.atividade.open = false;
    }
    const linha = document.createElement('p');
    linha.className = 'narracao-frase';
    linha.textContent = texto;
    const m = comMeta ? meta() : '';
    if (m) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'narracao-meta';
      b.textContent = `${m} ▸`;
      b.title = ingles() ? 'See the agent activity' : 'Ver a atividade do agente';
      const atividade = n.turno.atividade;
      b.addEventListener('click', () => {
        atividade.hidden = false;
        atividade.open = !atividade.open;
      });
      linha.append(' ', b);
    }
    caixa.appendChild(linha);
    n.frases += 1;
    n.ultima = Date.now();
    if (typeof rolar === 'function') rolar(el.aRolagem);
  }

  function abrir() {
    const meu = n;
    meu.aberta = true;
    meu.ocupado = true;
    const pedido = ingles() ? Promise.resolve({ texto: "I'll look this up and tell you what I find." }) : api.narrador.abertura({ pedido: meu.pedido });
    pedido
      .then((r) => n === meu && !meu.fim && escrever(r?.texto, { comMeta: false }))
      .catch(() => {})
      .finally(() => (meu.ocupado = false));
  }

  function passo() {
    if (!n || n.fim || n.ocupado || !n.aberta || ingles()) return;
    if (n.frases >= MAXIMO || Date.now() - n.ultima < ENTRE_FRASES_MS) return;
    // quieto por 15 s (31/10, teste: 30 s sem nada quando a pesquisa não leu página nova): o andamento, pelo código
    if (!n.achados.length && n.ultima && Date.now() - n.ultima > QUIETO_MS && n.quietas < 2) {
      n.quietas += 1;
      const b = plural(n.buscas, 'busca', 'buscas');
      escrever(n.lidas ? `Já li ${plural(n.lidas, 'página', 'páginas')} e sigo comparando o que as fontes dizem.` : `Já fiz ${b} e estou comparando o que apareceu.`);
      return;
    }
    if (!n.achados.length) return;
    const meu = n;
    const achado = meu.achados.pop(); // a mais nova; as que ficaram para trás saem
    meu.achados = [];
    meu.ocupado = true;
    api.voz
      .narrar({ pedido: meu.pedido, achado, primeira: !meu.disse, anterior: meu.anterior || '' })
      .then((r) => {
        if (n !== meu || meu.fim || !r?.texto) return;
        meu.disse = true;
        meu.anterior = r.texto;
        escrever(r.texto);
      })
      .catch(() => {})
      .finally(() => (meu.ocupado = false));
  }

  embrulhar('inicio', ({ objetivo } = {}) => {
    parar();
    if (config.narrarNoChat === false || !agente.turno) return;
    n = { turno: agente.turno, pedido: String(objetivo || '').split(/\n\nArquivos anexados/)[0].slice(0, 300), achados: [], buscas: 0, lidas: 0, base: { buscas: 0, lidas: 0 }, frases: 0, ultima: 0, ocupado: false, aberta: false, fim: false, disse: false, quietas: 0 };
    n.laco = setInterval(passo, 800);
  });
  embrulhar('fonte', (d) => {
    if (!n || n.fim) return;
    if (d.tipo === 'busca') {
      n.buscas += 1;
      if (!n.aberta) abrir(); // a primeira busca: é pesquisa, e vale narrar
    } else if (d.tipo === 'leitura') n.lidas += 1;
  });
  embrulhar('achado', (d) => {
    if (n && !n.fim && n.aberta) n.achados.push(d);
  });
  // a escrita começou: a última frase, e a narração para
  embrulhar('redigindo', () => {
    if (!n || n.fim) return;
    // sem o "▸ desde a anterior": ao lado do total ("Li 9 páginas"), parecia conta errada
    if (n.frases) escrever(ingles() ? `Got what I need — writing the answer now.` : n.lidas ? `Li ${plural(n.lidas, 'página', 'páginas')}; agora estou montando a resposta.` : 'Agora estou montando a resposta.', { comMeta: false });
    n.fim = true;
  });
  embrulhar('resposta-token', () => {
    if (n) n.fim = true;
  });
  for (const fim of ['concluido', 'erro', 'interrompido', 'limite']) embrulhar(fim, parar);

  // Ajustes → Geral (a caixa é pintada com as outras, em app-ajustes.js)
  document.getElementById('cfgNarrarNoChat')?.addEventListener('change', async (e) => {
    config = await api.config.set({ narrarNoChat: e.target.checked });
  });
})();
