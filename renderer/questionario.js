'use strict';

/**
 * Questionário no chat (18/11, Davi: "igual ao que o ChatGPT usa quando precisa saber o que eu preciso", e "se eu pedir
 * para o AuGPT criar um formulário ou questionário, ele faz um no chat"). Três jeitos de chegar aqui:
 *  - bloco ```questionario com JSON na resposta (o modelo escreve quando o usuário pede um questionário, quiz ou
 *    formulário): { titulo, descricao, perguntas: [{ texto, tipo: unica|multipla|texto|escala, opcoes, correta,
 *    explicacao, min, max }] };
 *  - lista de perguntas com as respostas entre parênteses, "Qual o orçamento? (até 300 | até 600 | tanto faz)" — o
 *    "Para acertar na escolha" das respostas de produto (converterListas);
 *  - a pergunta do agente no meio do trabalho (perguntar_usuario, com opções).
 * Formulário: as respostas vão como uma mensagem nova. Quiz (com "correta"): confere na hora, com a explicação.
 */
(function (global) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let seq = 0;
  // manda como mensagem do usuário (el e enviarPedido são do app: scripts comuns, mesmo escopo de cima)
  const mandar = (texto) => {
    if (typeof el === 'undefined' || typeof enviarPedido !== 'function') return false;
    el.aEntrada.value = texto;
    enviarPedido();
    return true;
  };

  /** JSON do modelo, com as falhas comuns (vírgula sobrando, aspas curvas) consertadas. */
  function ler(spec) {
    if (typeof spec !== 'string') return spec;
    try {
      return JSON.parse(spec);
    } catch {
      return JSON.parse(spec.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'));
    }
  }

  function normalizar(s) {
    const perguntas = (Array.isArray(s?.perguntas) ? s.perguntas : [])
      .map((p) => {
        const opcoes = (Array.isArray(p.opcoes) ? p.opcoes : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 12);
        let tipo = ['unica', 'multipla', 'texto', 'escala'].includes(p.tipo) ? p.tipo : opcoes.length ? 'unica' : 'texto';
        if ((tipo === 'unica' || tipo === 'multipla') && !opcoes.length) tipo = 'texto';
        const correta = Number.isInteger(p.correta) && p.correta >= 0 && p.correta < opcoes.length ? p.correta : null;
        return { texto: String(p.texto || p.pergunta || '').trim(), tipo, opcoes, correta: tipo === 'unica' ? correta : null, explicacao: String(p.explicacao || '').trim(), outro: p.outro !== false && tipo === 'unica' && correta == null, min: Number(p.min) || 1, max: Number(p.max) || 5 };
      })
      .filter((p) => p.texto)
      .slice(0, 30);
    if (!perguntas.length) throw new Error('questionário sem perguntas');
    return { titulo: String(s.titulo || '').trim(), descricao: String(s.descricao || '').trim(), perguntas, quiz: perguntas.some((p) => p.correta != null) };
  }

  function campo(p, i, nome) {
    if (p.tipo === 'texto') return `<textarea rows="2" name="${nome}" placeholder="Sua resposta"></textarea>`;
    if (p.tipo === 'escala') {
      const meio = Math.round((p.min + p.max) / 2);
      return `<div class="q-escala"><span>${p.min}</span><input type="range" name="${nome}" min="${p.min}" max="${p.max}" step="1" value="${meio}" /><span>${p.max}</span><output>${meio}</output></div>`;
    }
    const tipo = p.tipo === 'multipla' ? 'checkbox' : 'radio';
    const opcoes = p.opcoes.map((o, k) => `<label class="q-opcao"><input type="${tipo}" name="${nome}" value="${k}" /><span>${esc(o)}</span></label>`).join('');
    const outro = p.outro ? `<label class="q-opcao q-outro"><input type="${tipo}" name="${nome}" value="outro" /><input type="text" class="q-outro-texto" placeholder="Outra resposta…" /></label>` : '';
    return `<div class="q-opcoes">${opcoes}${outro}</div>`;
  }

  /** A resposta de uma pergunta, em texto ('' = em branco). */
  function respostaDe(form, p, nome) {
    if (p.tipo === 'texto') return form.querySelector(`[name="${nome}"]`).value.trim();
    if (p.tipo === 'escala') return `${form.querySelector(`[name="${nome}"]`).value} de ${p.max}`;
    const marcadas = [...form.querySelectorAll(`[name="${nome}"]:checked`)];
    return marcadas
      .map((m) => (m.value === 'outro' ? m.closest('.q-opcao').querySelector('.q-outro-texto').value.trim() : p.opcoes[Number(m.value)]))
      .filter(Boolean)
      .join('; ');
  }

  /**
   * O cartão. `aoEnviar(texto, respostas)`: o que fazer com as respostas (padrão: mandar como mensagem no chat).
   * Devolve o elemento.
   */
  function criar(spec, { aoEnviar = null, rotuloDoBotao = '' } = {}) {
    const q = normalizar(ler(spec));
    const id = `q${(seq += 1)}`;
    const raiz = document.createElement('form');
    raiz.className = `questionario${q.quiz ? ' quiz' : ''}`;
    raiz.dataset.semTraducao = '';
    raiz.innerHTML = `${q.titulo ? `<div class="q-titulo">${esc(q.titulo)}</div>` : ''}${q.descricao ? `<div class="q-descricao">${esc(q.descricao)}</div>` : ''}${q.perguntas
      .map((p, i) => `<fieldset class="q-pergunta" data-i="${i}"><legend>${q.perguntas.length > 1 ? `<span class="q-num">${i + 1}.</span> ` : ''}${esc(p.texto)}${p.tipo === 'multipla' ? ' <span class="q-dica">(pode marcar mais de uma)</span>' : ''}</legend>${campo(p, i, `${id}-${i}`)}<div class="q-retorno" hidden></div></fieldset>`)
      .join('')}<div class="q-acoes"><button type="submit" class="btn-primario">${esc(rotuloDoBotao || (q.quiz ? 'Conferir respostas' : 'Enviar respostas'))}</button><span class="q-aviso"></span></div>`;
    // escala mostra o valor; "outro" com texto marca a opção sozinho
    raiz.querySelectorAll('.q-escala input').forEach((r) => r.addEventListener('input', () => (r.parentElement.querySelector('output').textContent = r.value)));
    raiz.querySelectorAll('.q-outro-texto').forEach((t) => t.addEventListener('input', () => (t.closest('.q-opcao').querySelector('input:not(.q-outro-texto)').checked = Boolean(t.value.trim()))));
    raiz.addEventListener('submit', async (e) => {
      e.preventDefault();
      const respostas = q.perguntas.map((p, i) => respostaDe(raiz, p, `${id}-${i}`));
      const faltam = respostas.filter((r, i) => !r && q.perguntas[i].tipo !== 'escala').length;
      if (faltam === q.perguntas.length) return (raiz.querySelector('.q-aviso').textContent = 'Responda pelo menos uma pergunta.');
      raiz.querySelectorAll('input, textarea').forEach((c) => (c.disabled = true));
      if (q.quiz) return conferir(raiz, q, id);
      const texto = `${q.titulo ? `Minhas respostas (${q.titulo}):` : 'Minhas respostas:'}\n${q.perguntas.map((p, i) => `${i + 1}. ${p.texto} — ${respostas[i] || '(em branco)'}`).join('\n')}`;
      raiz.querySelector('.q-acoes').innerHTML = '<span class="q-feito">✓ Respostas enviadas</span>';
      raiz.classList.add('respondido');
      if (aoEnviar) return aoEnviar(texto, respostas);
      mandar(texto);
    });
    return raiz;
  }

  /** Quiz: certo/errado em cada pergunta, a explicação e a nota; dá para pedir a explicação das erradas. */
  function conferir(raiz, q, id) {
    let certas = 0;
    const erradas = [];
    q.perguntas.forEach((p, i) => {
      const caixa = raiz.querySelector(`.q-pergunta[data-i="${i}"]`);
      if (p.correta == null) return;
      const marcada = raiz.querySelector(`[name="${id}-${i}"]:checked`);
      const ok = marcada && Number(marcada.value) === p.correta;
      if (ok) certas += 1;
      else erradas.push(i);
      caixa.classList.add(ok ? 'certa' : 'errada');
      caixa.querySelectorAll('.q-opcao').forEach((o, k) => k === p.correta && o.classList.add('gabarito'));
      const r = caixa.querySelector('.q-retorno');
      r.hidden = false;
      r.innerHTML = `${ok ? '✓ Certo' : `✗ A certa é: <b>${esc(p.opcoes[p.correta])}</b>`}${p.explicacao ? ` — ${esc(p.explicacao)}` : ''}`;
    });
    const total = q.perguntas.filter((p) => p.correta != null).length;
    const acoes = raiz.querySelector('.q-acoes');
    acoes.innerHTML = `<span class="q-nota">${certas} de ${total} certas</span>${erradas.length ? '<button type="button" class="btn-link">Explicar as que errei</button>' : ''}`;
    raiz.classList.add('respondido');
    acoes.querySelector('button')?.addEventListener('click', () => {
      mandar(`Errei estas do questionário${q.titulo ? ` "${q.titulo}"` : ''}. Explique cada uma:\n${erradas.map((i) => `- ${q.perguntas[i].texto} (a certa: ${q.perguntas[i].opcoes[q.perguntas[i].correta]})`).join('\n')}`);
    });
  }

  // "Qual o seu orçamento? (até 300 | até 600 | tanto faz)"
  const COM_OPCOES = /^(.+?\?)\s*\(([^()]*\|[^()]*)\)\s*\.?$/;

  /**
   * Lista em que TODO item é uma pergunta com as respostas entre parênteses vira questionário (o "Para acertar na
   * escolha" das respostas de produto). Lista comum fica como está.
   */
  function converterListas(elemento) {
    for (const lista of elemento.querySelectorAll('ol, ul')) {
      if (lista.closest('.questionario')) continue;
      const itens = [...lista.children].filter((x) => x.tagName === 'LI');
      const lidas = itens.map((li) => COM_OPCOES.exec(li.textContent.replace(/\s+/g, ' ').trim()));
      if (!itens.length || lidas.some((m) => !m)) continue;
      const perguntas = lidas.map((m) => ({ texto: m[1].trim(), tipo: 'unica', opcoes: m[2].split('|').map((o) => o.trim()).filter(Boolean) }));
      try {
        lista.replaceWith(criar({ perguntas }));
      } catch {
        /* fica a lista */
      }
    }
  }

  global.questionario = { criar, converterListas, normalizar, ler };
})(window);
