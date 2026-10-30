'use strict';

/* Parte da tela do AuGPT (renderer/app.js dividido em 19/10): os arquivos app*.js são scripts comuns,
 * carregados em ordem no index.html, e compartilham as mesmas variáveis do nível de cima. */

/* ============================ início ============================ */

(async function iniciar() {
  await carregarConfig();
  await verificarOllama();
  await carregarConversas();
  await carregarMemoria();
  autoAltura(el.aEntrada);
  autoAltura(el.cEntrada);
  el.aEntrada.focus();
  setInterval(verificarOllama, 20000);
})();

/* ============================ conversas salvas ============================ */

const historico = { itens: [], selecao: new Set(), modoSelecao: false, filtro: '' };

function modoDaAba() {
  return abaAtual === 'conversa' ? 'conversa' : 'agente';
}

async function carregarConversas() {
  historico.itens = await api.chats.list();
  pintarConversas();
}

function pintarConversas() {
  const modo = modoDaAba();
  const filtro = historico.filtro.toLowerCase();
  const visiveis = historico.itens
    .filter((c) => c.modo === modo)
    .filter((c) => !filtro || c.titulo.toLowerCase().includes(filtro));

  el.lista.innerHTML = '';
  if (!visiveis.length) {
    el.lista.innerHTML = `<li class="vazio-lista">${
      historico.filtro ? 'Nada encontrado.' : 'Nenhuma conversa ainda.'
    }</li>`;
    return;
  }

  const idAtivo = modo === 'agente' ? agente.idConversa : chat.idConversa;

  for (const c of visiveis) {
    const li = document.createElement('li');
    li.className = `item-conversa${c.id === idAtivo ? ' ativa' : ''}${
      historico.selecao.has(c.id) ? ' marcada' : ''
    }`;
    li.dataset.id = c.id;
    li.innerHTML = `
      ${historico.modoSelecao ? `<input type="checkbox" class="marcador" ${historico.selecao.has(c.id) ? 'checked' : ''} />` : ''}
      <div class="item-texto">
        <span class="item-titulo"></span>
        <span class="item-meta">${quando(c.atualizadoEm)} · ${c.trocas} ${c.trocas === 1 ? 'troca' : 'trocas'}</span>
      </div>
      <button class="tres-pontos" title="Opções" aria-label="Opções">⋯</button>`;
    li.querySelector('.item-titulo').textContent = c.titulo;

    li.querySelector('.tres-pontos').addEventListener('click', (e) => {
      e.stopPropagation();
      abrirMenu(c, e.currentTarget);
    });

    li.querySelector('.marcador')?.addEventListener('click', (e) => {
      e.stopPropagation();
      alternarSelecao(c.id);
    });

    li.addEventListener('click', () => {
      if (historico.modoSelecao) alternarSelecao(c.id);
      else abrirConversa(c.id);
    });

    el.lista.appendChild(li);
  }
}

function alternarSelecao(id) {
  if (historico.selecao.has(id)) historico.selecao.delete(id);
  else historico.selecao.add(id);
  $('contagemSelecao').textContent = `${historico.selecao.size} selecionada${historico.selecao.size === 1 ? '' : 's'}`;
  pintarConversas();
}

function entrarEmSelecao(idInicial) {
  historico.modoSelecao = true;
  historico.selecao.clear();
  if (idInicial) historico.selecao.add(idInicial);
  $('barraSelecao').hidden = false;
  $('contagemSelecao').textContent = `${historico.selecao.size} selecionada${historico.selecao.size === 1 ? '' : 's'}`;
  pintarConversas();
}

function sairDaSelecao() {
  historico.modoSelecao = false;
  historico.selecao.clear();
  $('barraSelecao').hidden = true;
  pintarConversas();
}

/* menu de três pontos */

let menuAlvo = null;

function abrirMenu(conversa, botao) {
  const menu = $('menuConversa');
  menuAlvo = conversa;
  menu.hidden = false;
  const r = botao.getBoundingClientRect();
  const altura = menu.offsetHeight || 190;
  menu.style.left = `${Math.min(r.left, window.innerWidth - 210)}px`;
  menu.style.top = `${r.bottom + altura > window.innerHeight ? r.top - altura - 4 : r.bottom + 4}px`;
}

function fecharMenu() {
  $('menuConversa').hidden = true;
  menuAlvo = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#menuConversa') && !e.target.closest('.tres-pontos')) fecharMenu();
});

$('menuConversa').addEventListener('click', async (e) => {
  const acao = e.target.closest('button')?.dataset.acao;
  if (!acao || !menuAlvo) return;
  const alvo = menuAlvo;
  fecharMenu();

  if (acao === 'abrir') return abrirConversa(alvo.id);
  if (acao === 'selecionar') return entrarEmSelecao(alvo.id);
  if (acao === 'exportar') return void api.chats.export(alvo.id);

  // Item 2 da análise comparativa (2026-09-21, "comando manual de
  // compactação"): funde agora os turnos fora da janela dos últimos 6, sem
  // esperar a próxima execução — mesmo mecanismo automático de sempre (ver
  // 'janela-contexto' e IPC chats:compact), só que sob demanda.
  if (acao === 'compactar') {
    const r = await api.chats.compact(alvo.id);
    if (!r.ok) return alert(`Não foi possível compactar: ${r.error}`);
    return alert(r.compactou ? 'Conversa compactada.' : 'Nada novo pra compactar — já está tudo dentro da janela recente.');
  }

  if (acao === 'renomear') {
    const novo = prompt('Novo título:', alvo.titulo);
    if (novo?.trim()) {
      await api.chats.rename(alvo.id, novo.trim());
      await carregarConversas();
    }
    return;
  }

  if (acao === 'excluir') {
    if (!confirm(`Excluir "${alvo.titulo}"? Isso não pode ser desfeito.`)) return;
    await api.chats.remove(alvo.id);
    if (agente.idConversa === alvo.id) novaConversa('agente');
    if (chat.idConversa === alvo.id) novaConversa('conversa');
    await carregarConversas();
  }
});

$('btnExcluirSelecionadas').addEventListener('click', async () => {
  const ids = [...historico.selecao];
  if (!ids.length) return;
  if (!confirm(`Excluir ${ids.length} conversa(s)? Isso não pode ser desfeito.`)) return;
  await api.chats.remove(ids);
  if (ids.includes(agente.idConversa)) novaConversa('agente');
  if (ids.includes(chat.idConversa)) novaConversa('conversa');
  sairDaSelecao();
  await carregarConversas();
});

$('btnCancelarSelecao').addEventListener('click', sairDaSelecao);
$('btnSelecionar').addEventListener('click', () => (historico.modoSelecao ? sairDaSelecao() : entrarEmSelecao()));

$('buscaConversa').addEventListener('input', (e) => {
  historico.filtro = e.target.value.trim();
  pintarConversas();
});

/* abrir e criar */

async function abrirConversa(id) {
  const conversa = await api.chats.read(id);
  if (!conversa) return;

  if (conversa.modo === 'conversa') {
    trocarAba('conversa');
    chat.idConversa = conversa.id;
    chat.historico = conversa.mensagens.map(({ role, content }) => ({ role, content }));
    el.cMensagens.innerHTML = '';
    el.cAbertura.hidden = true;
    for (const m of conversa.mensagens) bolha(m.role === 'user' ? 'user' : 'assistant', m.content);
    $('tituloConversaChat').textContent = conversa.titulo;
    rolar(el.cRolagem, true);
  } else {
    trocarAba('agente');
    if (agente.rodando) await api.agent.stop();
    agente.idConversa = conversa.id;
    agente.conversa = conversa.mensagens.map(({ role, content }) => ({ role, content }));
    el.aMensagens.innerHTML = '';
    el.aAbertura.hidden = true;
    // Progresso/arquivos da lateral direita não são persistidos (ver
    // pintarProgresso/pintarSaidas acima) — reabrir uma conversa antiga
    // sempre volta com os dois painéis vazios, não é o histórico de quando
    // ela rodou. "Parágrafos" é diferente: o texto de cada turno JÁ está
    // sendo reconstruído aqui embaixo (restaurarTurno), então dá pra
    // reancorar nele — zera e deixa restaurarTurno repopular.
    agente.checklist = [];
    agente.saidas = [];
    agente.paragrafos = [];
    for (const m of conversa.mensagens) restaurarTurno(m);
    $('tituloConversaAgente').textContent = conversa.titulo;
    pintarProgresso();
    pintarSaidas();
    pintarParagrafos();
    rolar(el.aRolagem, true);
  }
  pintarConversas();
}

/** Reconstrói a bolha de uma conversa salva. O raciocínio não é guardado. */
function restaurarTurno(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'eu' : 'ia'}`;
  div.innerHTML = `<div class="msg-quem">${m.role === 'user' ? 'você' : 'agente'}</div><div class="msg-corpo"></div>`;
  const corpo = div.querySelector('.msg-corpo');
  if (m.role === 'user') {
    corpo.textContent = m.content;
    registrarParagrafo(div, m.content);
  } else {
    corpo.innerHTML = window.md.render(m.content);
    window.md.montarGraficos(corpo);
  }
  el.aMensagens.appendChild(div);
}

function novaConversa(modo = modoDaAba()) {
  if (modo === 'conversa') {
    chat.idConversa = null;
    chat.historico = [];
    el.cMensagens.innerHTML = '';
    el.cAbertura.hidden = false;
    $('tituloConversaChat').textContent = '';
    el.cEntrada.focus();
  } else {
    agente.idConversa = null;
    agente.conversa = [];
    el.aMensagens.innerHTML = '';
    el.aAbertura.hidden = false;
    $('tituloConversaAgente').textContent = '';
    agente.checklist = [];
    agente.saidas = [];
    agente.paragrafos = [];
    pintarProgresso();
    pintarSaidas();
    pintarParagrafos();
    el.aEntrada.focus();
  }
  pintarConversas();
}

$('btnNovaConversa').addEventListener('click', async () => {
  if (modoDaAba() === 'agente' && agente.rodando) await api.agent.stop();
  if (modoDaAba() === 'conversa' && chat.ocupado) await api.chat.stop();
  novaConversa();
});

/** Grava o estado atual. Chamado ao fim de cada turno. */
async function salvarConversa(modo) {
  const mensagens = modo === 'conversa' ? chat.historico : agente.conversa;
  if (!mensagens.length) return;
  const gravada = await api.chats.save({
    id: modo === 'conversa' ? chat.idConversa : agente.idConversa,
    modo,
    mensagens,
  });
  if (modo === 'conversa') {
    chat.idConversa = gravada.id;
    $('tituloConversaChat').textContent = gravada.titulo;
  } else {
    agente.idConversa = gravada.id;
    $('tituloConversaAgente').textContent = gravada.titulo;
  }
  await carregarConversas();
}
const RISCOS = { baixo: 'lê apenas', medio: 'modifica arquivos', alto: 'executa ou apaga' };

function cartaoFerramenta(f) {
  const div = document.createElement('article');
  div.className = `skill ${f.ativa ? '' : 'inativa'}`;
  const args = Object.entries(f.args || {});
  div.innerHTML = `
    <div class="skill-topo">
      <div class="skill-titulo">
        <h3><code>${esc(f.name)}</code></h3>
        <span class="selo ${esc(f.risk)}">${esc(f.risk)}</span>
        ${
          f.origem === 'nucleo'
            ? ''
            : `<span class="origem ${f.origem === 'sua' ? 'sua' : ''}${f.origem === 'mcp' ? ' mcp' : ''}">${
                f.origem === 'mcp' ? `MCP · ${esc(f.servidor)}` : esc(f.origem)
              }</span>`
        }
        ${f.essencial ? '<span class="origem sempre">essencial</span>' : ''}
        ${f.disponivel ? '' : '<span class="origem falta">dependência faltando</span>'}
      </div>
      <label class="interruptor" title="${f.essencial ? 'não pode ser desativada' : f.ativa ? 'Desativar' : 'Ativar'}">
        <input type="checkbox" ${f.ativa ? 'checked' : ''} ${f.essencial ? 'disabled' : ''} />
        <i></i>
      </label>
    </div>
    <p class="skill-desc">${esc(f.description)}</p>
    ${
      f.disponivel
        ? f.requer?.length
          ? `<div class="deps ok">requer ${f.requer.map((d) => `<code>${esc(d)}</code>`).join(' ')} — tudo presente</div>`
          : ''
        : `<div class="deps falta">Falta: ${f.faltando
            .map((d) => `<code>${esc(d.nome)}</code>`)
            .join(' ')}<br>Instale com <code>${esc(f.faltando[0]?.instalar || '')}</code> e clique em Recarregar.</div>`
    }
    ${
      args.length
        ? `<dl class="args-ferramenta">${args
            .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
            .join('')}</dl>`
        : ''
    }
    <div class="skill-rodape">
      <span class="skill-meta">${esc(RISCOS[f.risk] || '')}${f.arquivo ? ' · arquivo externo' : ''}</span>
      ${f.arquivo ? '<button class="btn-linha ver">mostrar arquivo</button>' : ''}
    </div>`;

  if (!f.disponivel) div.classList.add('indisponivel');
  const caixa = div.querySelector('input');
  if (!f.essencial) {
    caixa.addEventListener('change', async (e) => {
      config = await api.tools.toggle(f.name, e.target.checked);
      div.classList.toggle('inativa', !e.target.checked);
    });
  }
  div.querySelector('.ver')?.addEventListener('click', () => api.tools.openFile(f.name));
  return div;
}

const mcpEstado = { servidores: [] };

async function carregarMcp() {
  const { servidores, estado, problemas } = await api.mcp.list();
  mcpEstado.servidores = servidores;
  $('mcpTotal').textContent = servidores.length;

  const alvo = $('mcpLista');
  alvo.innerHTML = '';
  if (!servidores.length) {
    alvo.innerHTML = '<p class="dica">Nenhum servidor configurado.</p>';
  }

  for (const [i, s] of servidores.entries()) {
    const vivo = estado.find((e) => e.nome === s.nome);
    const problema = problemas.find((p) => p.startsWith(`${s.nome}:`));
    const div = document.createElement('div');
    div.className = `mcp-item${vivo?.conectado ? ' conectado' : problema ? ' falho' : ''}`;
    div.innerHTML = `
      <div class="mcp-info">
        <span class="mcp-nome"></span>
        <span class="mcp-cmd"></span>
        <span class="mcp-status">${
          vivo?.conectado
            ? `conectado · ${vivo.ferramentas} ferramenta(s) · ${esc(vivo.servidor || '')}`
            : problema
              ? esc(problema.replace(`${s.nome}: `, '').slice(0, 90))
              : 'desligado'
        }</span>
      </div>
      <label class="interruptor" title="${s.ativo === false ? 'Ativar' : 'Desativar'}">
        <input type="checkbox" ${s.ativo === false ? '' : 'checked'} /><i></i>
      </label>
      <button class="btn-linha" title="Remover">✕</button>`;
    div.querySelector('.mcp-nome').textContent = s.nome;
    div.querySelector('.mcp-cmd').textContent = `${s.comando} ${(s.argumentos || []).join(' ')}`.trim();

    div.querySelector('input').addEventListener('change', async (e) => {
      mcpEstado.servidores[i].ativo = e.target.checked;
      await api.mcp.save(mcpEstado.servidores);
      carregarMcp();
      carregarFerramentas();
    });
    div.querySelector('.btn-linha').addEventListener('click', async () => {
      if (!confirm(`Remover o servidor "${s.nome}"?`)) return;
      mcpEstado.servidores.splice(i, 1);
      await api.mcp.save(mcpEstado.servidores);
      carregarMcp();
      carregarFerramentas();
    });
    alvo.appendChild(div);
  }
}

function lerFormularioMcp() {
  const nome = $('mcpNome').value.trim();
  const comando = $('mcpComando').value.trim();
  if (!nome || !comando) return null;
  return {
    nome,
    comando,
    argumentos: $('mcpArgs').value.trim().split(/\s+/).filter(Boolean),
    ativo: true,
  };
}

$('btnTestarMcp').addEventListener('click', async () => {
  const servidor = lerFormularioMcp();
  const alvo = $('mcpResultado');
  if (!servidor) {
    alvo.innerHTML = '<span class="ruim">informe ao menos nome e comando</span>';
    return;
  }
  alvo.textContent = 'testando…';
  const r = await api.mcp.test(servidor);
  alvo.innerHTML = r.ok
    ? `<b>conectou</b> — ${esc(r.servidor || servidor.nome)} · ${r.ferramentas} ferramenta(s): ${r.nomes
        .map((n) => `<code>${esc(n)}</code>`)
        .join(' ')}`
    : `<span class="ruim">falhou — ${esc(r.erro)}</span>`;
});

$('btnAddMcp').addEventListener('click', async () => {
  const servidor = lerFormularioMcp();
  if (!servidor) return;
  mcpEstado.servidores.push(servidor);
  await api.mcp.save(mcpEstado.servidores);
  $('mcpNome').value = '';
  $('mcpComando').value = '';
  $('mcpArgs').value = '';
  $('mcpResultado').textContent = '';
  carregarMcp();
  carregarFerramentas();
});

$('btnReconectarMcp').addEventListener('click', async () => {
  $('mcpResultado').textContent = 'reconectando…';
  const r = await api.mcp.reconnect();
  $('mcpResultado').innerHTML = `${r.ferramentas} ferramenta(s) registrada(s)${
    r.problemas.length ? ` · <span class="ruim">${esc(r.problemas.join(' | '))}</span>` : ''
  }`;
  carregarMcp();
  carregarFerramentas();
});

async function carregarFerramentas() {
  const { ferramentas, problemas } = await api.tools.list();
  const lista = $('ferramentasLista');
  lista.innerHTML = '';

  const alerta = $('problemasFerramentas');
  alerta.innerHTML = problemas?.length
    ? `<b>${problemas.length} arquivo(s) com problema</b><br>${problemas.map((p) => esc(p)).join('<br>')}`
    : '';
  alerta.hidden = !problemas?.length;

  carregarMcp();
  const ordem = { nucleo: 0, embutida: 1, sua: 2, mcp: 3 };
  ferramentas
    .sort((a, b) => (ordem[a.origem] ?? 9) - (ordem[b.origem] ?? 9) || a.name.localeCompare(b.name))
    .forEach((f) => lista.appendChild(cartaoFerramenta(f)));
}

function trocarSubAba(qual) {
  $('painelSkills').hidden = qual !== 'skills';
  $('painelSugestoes').hidden = qual !== 'sugestoes';
  $('painelFerramentas').hidden = qual !== 'ferramentas';
  $('subSkills').classList.toggle('ativa', qual === 'skills');
  $('subSugestoes').classList.toggle('ativa', qual === 'sugestoes');
  $('subFerramentas').classList.toggle('ativa', qual === 'ferramentas');
  if (qual === 'ferramentas') carregarFerramentas();
  else if (qual === 'sugestoes') carregarSugestoes();
  else carregarSkills();
}

$('subSkills').addEventListener('click', () => trocarSubAba('skills'));
$('subSugestoes').addEventListener('click', () => trocarSubAba('sugestoes'));
$('subFerramentas').addEventListener('click', () => trocarSubAba('ferramentas'));
$('btnAbrirFerramentas').addEventListener('click', () => api.tools.openFolder());
$('btnRecarregarFerramentas').addEventListener('click', async () => {
  const r = await api.tools.reload();
  await carregarFerramentas();
  if (r.problemas?.length) $('problemasFerramentas').hidden = false;
});

/**
 * Cartão de uma skill. A função tinha se perdido na reescrita do renderer, e
 * `carregarSkills` chamava algo que não existia — por isso a aba abria vazia.
 */
function cartaoSkill(skill) {
  const div = document.createElement('article');
  div.className = `skill ${skill.ativa ? '' : 'inativa'}`;
  div.innerHTML = `
    <div class="skill-topo">
      <div class="skill-titulo">
        <h3></h3>
        <span class="origem ${skill.origem === 'sua' ? 'sua' : ''}">${skill.origem === 'sua' ? 'sua' : 'embutida'}</span>
        ${skill.sempre ? '<span class="origem sempre">sempre ativa</span>' : ''}
        ${skill.temRotina ? '<span class="origem">com rotina</span>' : ''}
        ${skill.importada ? '<span class="origem">formato padrão</span>' : ''}
      </div>
      <label class="interruptor" title="${skill.ativa ? 'Desativar' : 'Ativar'}">
        <input type="checkbox" ${skill.ativa ? 'checked' : ''} />
        <i></i>
      </label>
    </div>
    <p class="skill-desc"></p>
    <details class="skill-detalhes"><summary>gatilhos e ferramentas</summary>
    ${
      skill.ferramentas?.length
        ? `<div class="deps ok">usa ${skill.ferramentas.map((f) => `<code>${esc(f)}</code>`).join(' ')}</div>`
        : ''
    }
    ${
      skill.naoUsePara?.length
        ? `<div class="gatilhos negativos">não usar para: ${skill.naoUsePara
            .map((g) => `<span class="gatilho">${esc(g)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="gatilhos">${
      skill.gatilhos.length
        ? skill.gatilhos.map((g) => `<span class="gatilho">${esc(g)}</span>`).join('')
        : '<span class="gatilho vazio">sem gatilhos</span>'
    }</div>
    </details>
    <div class="skill-rodape">
      <span class="skill-meta">${esc(skill.etapa)} · prioridade ${skill.prioridade} · ${skill.tamanho} caracteres</span>
      <button class="btn-linha ver">ver instruções</button>
    </div>`;

  div.querySelector('h3').textContent = skill.nome;
  div.querySelector('.skill-desc').textContent = skill.descricao || 'sem descrição';

  div.querySelector('input').addEventListener('change', async (e) => {
    config = await api.skills.toggle(skill.id, e.target.checked);
    div.classList.toggle('inativa', !e.target.checked);
    testarSkills();
  });

  div.querySelector('.ver').addEventListener('click', async () => {
    const r = await api.skills.read(skill.id);
    if (!r.ok) return;
    $('dlgSkillNome').textContent = r.nome;
    $('dlgSkillCorpo').textContent = r.bruto;
    $('dlgSkill').dataset.id = skill.id;
    $('dlgSkill').showModal();
  });

  return div;
}

/**
 * Cartão de uma sugestão de skill (item 5: criação automática). Mostra o
 * veredito do autoteste que o próprio agente já rodou sozinho — mesmo uma
 * reprovação aparece aqui, claramente marcada, em vez de escondida: você
 * decide se ajusta ou descarta, o autoteste só dá mais evidência.
 */
function cartaoSugestao(sugestao) {
  const div = document.createElement('article');
  div.className = 'skill sugestao';
  const badge = sugestao.autotestada
    ? '<span class="origem ok">passou no autoteste</span>'
    : '<span class="origem ruim">não passou no autoteste</span>';
  div.innerHTML = `
    <div class="skill-topo">
      <div class="skill-titulo">
        <h3></h3>
        <span class="origem sua">sugerida pelo agente</span>
        ${badge}
      </div>
    </div>
    <p class="skill-desc"></p>
    <p class="autoteste-resumo"></p>
    <div class="gatilhos">${
      sugestao.gatilhos?.length
        ? sugestao.gatilhos.map((g) => `<span class="gatilho">${esc(g)}</span>`).join('')
        : '<span class="gatilho vazio">sem gatilhos</span>'
    }</div>
    <div class="skill-rodape">
      <span class="skill-meta">${sugestao.previa ? esc(sugestao.previa.slice(0, 120)) + '…' : ''}</span>
      <div class="linha-botoes">
        <button class="btn-secundario aprovar">Aprovar</button>
        <button class="btn-secundario descartar">Descartar</button>
      </div>
    </div>`;

  div.querySelector('h3').textContent = sugestao.nome;
  div.querySelector('.skill-desc').textContent = sugestao.descricao || 'sem descrição';
  div.querySelector('.autoteste-resumo').textContent = sugestao.autotesteResumo || '';

  div.querySelector('.aprovar').addEventListener('click', async () => {
    await api.skills.aprovarSugestao(sugestao.id);
    carregarSugestoes();
  });
  div.querySelector('.descartar').addEventListener('click', async () => {
    if (!confirm(`Descartar a sugestão "${sugestao.nome}"?`)) return;
    await api.skills.descartarSugestao(sugestao.id);
    carregarSugestoes();
  });

  return div;
}

async function carregarSugestoes() {
  const sugestoes = await api.skills.sugeridas();
  $('sugTotal').textContent = sugestoes.length;
  const lista = $('sugestoesLista');
  lista.innerHTML = '';
  if (!sugestoes.length) {
    lista.innerHTML = '<p class="dica">Nenhuma sugestão no momento. Quando o mesmo tipo de pedido se repetir sem nenhuma skill cobrindo, uma proposta testada aparece aqui.</p>';
    return;
  }
  sugestoes.forEach((s) => lista.appendChild(cartaoSugestao(s)));
}

async function carregarSkills() {
  const { skills } = await api.skills.list();
  const lista = $('skillsLista');
  lista.innerHTML = '';
  if (!skills.length) {
    lista.innerHTML = '<p class="dica">Nenhuma skill encontrada. Clique em "Nova skill" para criar a primeira.</p>';
    return;
  }
  skills
    .sort((a, b) => a.origem.localeCompare(b.origem) || a.nome.localeCompare(b.nome))
    .forEach((s) => lista.appendChild(cartaoSkill(s)));
  testarSkills();
}

let temporizadorTeste = null;
async function testarSkills() {
  const texto = $('testeSkill').value.trim();
  const alvo = $('testeResultado');
  if (!texto) {
    alvo.innerHTML = '';
    return;
  }
  const r = await api.skills.preview(texto);
  const linha = (rotulo, nomes) =>
    `<div class="teste-linha"><span>${rotulo}</span>${
      nomes.length ? nomes.map((n) => `<span class="selo-skill">${esc(n)}</span>`).join('') : '<em>nenhuma</em>'
    }</div>`;
  alvo.innerHTML = linha('decisão', r.decisao) + linha('redação', r.redacao);
}

$('testeSkill').addEventListener('input', () => {
  clearTimeout(temporizadorTeste);
  temporizadorTeste = setTimeout(testarSkills, 220);
});

$('btnRecarregarSkills').addEventListener('click', async () => {
  await api.skills.reload();
  carregarSkills();
});

$('btnAbrirSkills').addEventListener('click', () => api.skills.openFolder());

$('btnNovaSkill').addEventListener('click', async () => {
  const nome = prompt('Nome da nova skill:');
  if (!nome?.trim()) return;
  const r = await api.skills.create(nome.trim());
  if (r.ok) carregarSkills();
});

$('btnFecharSkill').addEventListener('click', () => $('dlgSkill').close());
$('btnRevelarSkill').addEventListener('click', () => api.skills.openFile($('dlgSkill').dataset.id));


/* ============================ arquivos gerados (anexo no chat) ============================ */

/** Pedido real do Davi: arquivo que o agente gera não deve só cair na pasta
 * de trabalho sem aviso — vira um cartão anexado à resposta, com "Visualizar"
 * (pré-via dentro do próprio AuGPT) e "Salvar como…" (diálogo nativo do
 * Windows). O arquivo continua sendo escrito de verdade na pasta de trabalho
 * (decisão do Davi) — isto só muda como ele é apresentado no chat. */
function renderizarAnexosGerados(container, lista) {
  const caixa = document.createElement('div');
  caixa.className = 'arquivos-gerados';
  lista.forEach(({ caminho, tamanho }) => {
    const nome = caminho.split(/[/\\]/).pop();
    const ext = (nome.split('.').pop() || '').toUpperCase().slice(0, 4);
    const item = document.createElement('div');
    item.className = 'arquivo-anexo';
    item.innerHTML = `
      <div class="arquivo-icone">${esc(ext || '?')}</div>
      <div class="arquivo-info">
        <div class="arquivo-nome" title="${esc(caminho)}">${esc(nome)}</div>
        <div class="arquivo-tam">${tamanho != null ? kb(tamanho) : ''}</div>
      </div>
      <div class="arquivo-acoes">
        <button class="btn-secundario btn-ver">Visualizar</button>
        <button class="btn-secundario btn-baixar">Salvar como…</button>
      </div>`;
    item.querySelector('.btn-ver').addEventListener('click', () => abrirPreviaArquivo(caminho, nome));
    item.querySelector('.btn-baixar').addEventListener('click', () => api.arquivos.salvarComo(caminho));
    caixa.appendChild(item);
  });
  container.appendChild(caixa);
}

async function abrirPreviaArquivo(caminho, nome) {
  $('dlgArquivoNome').textContent = nome;
  const corpo = $('dlgArquivoCorpo');
  corpo.className = 'previa-arquivo';
  corpo.innerHTML = '<p class="secundario">carregando…</p>';
  $('dlgArquivo').dataset.caminho = caminho;
  $('dlgArquivo').showModal();

  const r = await api.arquivos.previa(caminho);
  if (!r.ok) {
    corpo.innerHTML = `<p class="indisponivel">Não foi possível abrir: ${esc(r.error || 'erro desconhecido')}</p>`;
    return;
  }
  if (r.tipo === 'pdf') {
    corpo.innerHTML = `<iframe src="${r.dataUrl}"></iframe>`;
  } else if (r.tipo === 'imagem') {
    corpo.innerHTML = `<img src="${r.dataUrl}" alt="${esc(nome)}" />`;
  } else if (r.tipo === 'html') {
    // Fase 1 de segurança (2026-09-23): `sandbox` vazio = sem script, sem
    // formulário e com origem opaca. Sem ele, o HTML da prévia (arquivo
    // anexado ou escrito pelo agente) ficava na MESMA origem desta janela, com
    // acesso a `window.augpt` — inclusive a canais que iniciam processos.
    // Só a prévia fica estática; "Abrir com o app padrão" continua abrindo no
    // navegador com tudo funcionando.
    corpo.innerHTML = '<iframe sandbox=""></iframe>';
    corpo.querySelector('iframe').srcdoc = r.conteudo;
  } else if (r.tipo === 'markdown') {
    corpo.className = 'previa-arquivo msg-corpo';
    corpo.innerHTML = window.md.render(r.conteudo);
  } else if (r.tipo === 'texto') {
    corpo.innerHTML = `<pre>${esc(r.conteudo)}</pre>`;
  } else {
    corpo.innerHTML = `<p class="indisponivel">${esc(
      r.motivo || 'sem pré-visualização pra este formato'
    )} — use "Abrir com o app padrão".</p>`;
  }
}

$('btnFecharArquivo').addEventListener('click', () => $('dlgArquivo').close());
$('btnBaixarArquivo').addEventListener('click', () => {
  const caminho = $('dlgArquivo').dataset.caminho;
  if (caminho) api.arquivos.salvarComo(caminho);
});
$('btnAbrirExternoArquivo').addEventListener('click', async () => {
  const caminho = $('dlgArquivo').dataset.caminho;
  if (!caminho) return;
  const r = await api.arquivos.abrirExterno(caminho);
  // executável/script é só mostrado na pasta (Fase 1 de segurança) — avisa o porquê
  if (r && !r.ok && r.error) alert(r.error);
});


/* ============================ execuções ============================ */

const execucoes = { origem: '', itens: [], mostrar: 60 };

const RESULTADO_ROTULO = {
  concluido: { texto: 'concluído', classe: 'ok' },
  limite: { texto: 'bateu o limite', classe: 'alerta' },
  interrompido: { texto: 'interrompido', classe: 'alerta' },
  erro: { texto: 'erro', classe: 'falha' },
};

const seg = (ms) => `${(ms / 1000).toFixed(1)}s`;
/** As linhas de tempo do relatório (29/10): etapas, somas por tipo de chamada e os buscadores. */
function linhasDeTempo(t = {}) {
  const NOMES = { entendimento: 'entender', pesquisa: 'pesquisar', material: 'material', escrita: 'escrever', conferencia: 'conferir', modelo: 'modelo', buscas: 'buscas', paginas: 'páginas', embeddings: 'embeddings' };
  const lista = (o) => Object.entries(o || {}).filter(([, ms]) => ms > 0).map(([k, ms]) => `${NOMES[k] || k} ${seg(ms)}`).join(' · ');
  const buscadores = Object.entries(t.buscadores || {}).map(([nome, b]) => `${nome} ${b.vezes}× (média ${seg(b.ms / Math.max(1, b.vezes))})`).join(' · ');
  const juntou = Object.entries(t.combinacoes || {}).filter(([k]) => k.includes('+')).map(([k, n]) => `${k} ${n}×`).join(' · ');
  return [
    t.primeiraPalavraMs && `1ª palavra:  ${seg(t.primeiraPalavraMs)}`,
    lista(t.etapas) && `Etapas:      ${lista(t.etapas)}`,
    lista(t.somas) && `Somas:       ${lista(t.somas)} (em paralelo)`,
    buscadores && `Buscadores:  ${buscadores}${juntou ? ` · juntou: ${juntou}` : ''}`,
    Object.keys(t.falhas || {}).length && `Falharam:    ${Object.entries(t.falhas).map(([nome, f]) => `${nome} ${f.vezes}× (${f.motivo})`).join(' · ')}`,
    // 30/10: os sites que mais demoraram para abrir (média acima de 3 s), e os que não abriram
    (() => {
      const lentos = Object.entries(t.sites || {}).map(([s, x]) => [s, x.ms / Math.max(1, x.vezes), x]).filter(([, media, x]) => media > 3000 || x.falhas).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return lentos.length && `Sites lentos: ${lentos.map(([s, media, x]) => `${s} ${seg(media)}${x.falhas ? ` (${x.falhas} sem abrir)` : ''}`).join(' · ')}`;
    })(),
  ].filter(Boolean);
}

async function carregarExecucoes() {
  const filtro = execucoes.origem ? { origem: execucoes.origem } : {};
  const [lista, stats] = await Promise.all([api.runs.list(filtro), api.runs.stats(filtro)]);
  execucoes.itens = lista;
  pintarEstatisticas(stats);
  const modelos = [...new Set(lista.map((r) => r.modelo).filter(Boolean))];
  const sel = $('execModelo');
  const antes = sel.value;
  sel.innerHTML = '<option value="">todos os modelos</option>' + modelos.map((m) => `<option>${esc(m)}</option>`).join('');
  sel.value = modelos.includes(antes) ? antes : '';
  pintarResumoExecucoes(lista);
  pintarExecucoesFiltradas();
}

// Fase 1 (16/10): filtros da lista e resumo da semana do modelo em uso
function execucoesFiltradas() {
  const dias = Number($('execPeriodo').value);
  const desde = dias ? Date.now() - dias * 864e5 : 0;
  const [tipo, resultado, modelo] = [$('execTipo').value, $('execResultado').value, $('execModelo').value];
  return execucoes.itens.filter(
    (r) => new Date(r.em).getTime() >= desde && (!tipo || r.tipo === tipo) && (!resultado || r.resultado === resultado) && (!modelo || r.modelo === modelo)
  );
}

function pintarExecucoesFiltradas() {
  execucoes.mostrar = 60;
  const lista = execucoesFiltradas();
  $('execContagem').textContent = `${lista.length} execuç${lista.length === 1 ? 'ão' : 'ões'}`;
  pintarExecucoes(lista);
}
['execPeriodo', 'execTipo', 'execResultado', 'execModelo'].forEach((id) => $(id).addEventListener('change', pintarExecucoesFiltradas));

function pintarResumoExecucoes(lista) {
  const modelo = config.model || '';
  const semana = lista.filter((r) => r.modelo === modelo && Date.now() - new Date(r.em).getTime() < 7 * 864e5);
  $('execResumoModelo').textContent = modelo || 'nenhum modelo';
  if (!semana.length) {
    $('execResumo').innerHTML = '<p class="dica">Nenhuma execução com este modelo nos últimos 7 dias.</p>';
    return;
  }
  const tempos = semana.map((r) => r.duracaoMs).sort((a, b) => a - b);
  const virgula = (n) => n.toFixed(1).replace('.', ',');
  const media = (f) => virgula(semana.reduce((t, r) => t + (f(r) || 0), 0) / semana.length);
  const concluidas = semana.filter((r) => r.resultado === 'concluido').length;
  const notas = semana.filter((r) => r.nota);
  const caixas = [
    [semana.length, 'execuções'],
    [`${Math.round((concluidas / semana.length) * 100)}%`, 'concluídas'],
    [seg(tempos[Math.floor(tempos.length / 2)]), 'tempo típico (mediana)'],
    [media((r) => r.buscas), 'buscas por execução'],
    [media((r) => r.fontes), 'páginas lidas por execução'],
    [notas.length ? virgula(notas.reduce((t, r) => t + r.nota, 0) / notas.length) : '—', `nota média${notas.length ? ` (${notas.length})` : ''}`],
  ];
  $('execResumo').innerHTML = caixas.map(([v, r]) => `<div><b>${esc(String(v))}</b><span>${r}</span></div>`).join('');
}

function pintarEstatisticas(stats) {
  const tabela = $('statsModelos');
  if (!stats.length) {
    tabela.innerHTML = '<tr><td class="vazio">Nenhuma execução registrada ainda.</td></tr>';
    return;
  }
  const colunas = [
    ['modelo', 'modelo'],
    ['execuções', 'execucoes'],
    ['conclusão', 'conclusao', (v) => `${v}%`],
    ['passos', 'passosMedios'],
    ['tempo', 'segundosMedios', (v) => `${v}s`],
    ['tokens', 'tokensMedios', (v) => v.toLocaleString('pt-BR')],
    ['erros', 'errosPorExecucao'],
    ['incidentes', 'incidentesPorExecucao'],
    ['nota', 'nota', (v, l) => (v ? `${v} (${l.avaliadas})` : '—')],
  ];
  tabela.innerHTML =
    `<thead><tr>${colunas.map(([r]) => `<th>${r}</th>`).join('')}</tr></thead>` +
    `<tbody>${stats
      .map(
        (l) =>
          `<tr>${colunas
            .map(([, chave, fmt]) => `<td>${esc(fmt ? fmt(l[chave], l) : l[chave])}</td>`)
            .join('')}</tr>`
      )
      .join('')}</tbody>`;
}

function pintarExecucoes(lista) {
  const alvo = $('listaExecucoes');
  alvo.innerHTML = '';
  if (!lista.length) {
    alvo.innerHTML = '<p class="dica">Nenhuma execução ainda. Peça algo ao agente e ela aparece aqui.</p>';
    return;
  }

  for (const r of lista.slice(0, execucoes.mostrar)) {
    const rotulo = RESULTADO_ROTULO[r.resultado] || { texto: r.resultado || '—', classe: '' };
    const div = document.createElement('article');
    div.className = 'execucao';
    div.innerHTML = `
      <div class="exec-topo">
        <span class="exec-resultado ${rotulo.classe}">${rotulo.texto}</span>
        <span class="exec-modelo">${esc(r.modelo || '—')}</span>
        ${r.tipo ? `<span class="origem">${r.tipo}</span>` : ''}
        ${r.origem === 'bancada' ? `<span class="origem">bancada${r.caso ? `: ${esc(r.caso.slice(0, 34))}` : ''}</span>` : ''}
        <span class="exec-quando">${quando(r.em)}</span>
      </div>
      <p class="exec-pedido"></p>
      ${r.sites?.length ? `<p class="exec-sites" title="${esc(r.sites.join(', '))}">${esc(r.sites.slice(0, 6).join(' · '))}${r.sites.length > 6 ? ` · +${r.sites.length - 6}` : ''}</p>` : ''}
      <div class="exec-medidas">
        ${r.profundidade ? `<span>pesquisa <b>${esc(r.profundidade)}</b></span>` : ''}
        ${r.tipo === 'tarefa' ? `<span><b>${r.passos}</b> passos</span><span><b>${r.ferramentas}</b> ferramentas</span>` : ''}
        <span><b>${r.buscas ?? 0}</b> buscas</span>
        <span><b>${r.fontes}</b> páginas lidas</span>
        <span><b>${seg(r.duracaoMs)}</b></span>
        <span><b>${(r.tokens || 0).toLocaleString('pt-BR')}</b> tokens</span>
        ${r.erros ? `<span class="ruim"><b>${r.erros}</b> erros</span>` : ''}
        ${r.cobertura && r.cobertura !== 'boa' ? `<span class="ruim">cobertura ${r.cobertura}</span>` : ''}
        ${
          // Caso real (Davi, 2026-09-18): pediu como saber com certeza que
          // "2 IAs" consultou o modelo dedicado — este selo confirma isso
          // sem precisar abrir o relatório inteiro (ver 'ver relatório').
          r.copilotoDedicado
            ? `<span title="consultas que caíram no modelo dedicado (CPU), não no principal"><b>${r.copilotoDedicado}</b> no crítico dedicado</span>`
            : ''
        }
      </div>
      <div class="exec-rodape">
        <div class="notas" data-id="${esc(r.id)}">
          ${[1, 2, 3, 4, 5]
            .map((n) => `<button class="estrela${r.nota >= n ? ' cheia' : ''}" data-nota="${n}" title="${n} de 5">★</button>`)
            .join('')}
          <span class="nota-dica">${r.nota ? `sua nota: ${r.nota}` : 'avalie a qualidade'}</span>
        </div>
        <button class="btn-linha ver-relatorio">ver relatório</button>
      </div>`;
    div.querySelector('.exec-pedido').textContent = r.pedido || '(sem pedido)';

    div.querySelectorAll('.estrela').forEach((b) =>
      b.addEventListener('click', async () => {
        await api.runs.rate(r.id, Number(b.dataset.nota));
        carregarExecucoes();
      })
    );
    div.querySelector('.ver-relatorio').addEventListener('click', () => abrirRelatorio(r.id));
    alvo.appendChild(div);
  }
  // a grade mostra 60 por vez (22/10: antes parava nas 60 sem avisar)
  if (lista.length > execucoes.mostrar) {
    const mais = document.createElement('button');
    mais.className = 'btn-secundario exec-mais';
    mais.textContent = `Mostrar mais (${lista.length - execucoes.mostrar} restantes)`;
    mais.addEventListener('click', () => {
      execucoes.mostrar += 60;
      pintarExecucoes(lista);
    });
    alvo.appendChild(mais);
  }
}

const ROTULO_FONTE_ROTA = { regra: 'regras', decisor: 'modelo de decisão (trocou a regra)', 'regra+decisor': 'regras, confirmadas pelo modelo de decisão' };

/** Mesmo texto de src/modelos-carregados.js (resumoDoQuadro) — o renderer não faz require. */
function resumoDosModelos(linhas = []) {
  return linhas.map((l) => {
    const onde = l.carregado ? `${l.onde}${l.onde === 'GPU+CPU' ? ` (${l.gpuPct}% na GPU)` : ''}` : 'não carregado';
    const marca = l.situacao === 'ok' ? '✓' : l.situacao === 'atencao' ? '⚠' : '·';
    return `${marca} ${l.papel}: ${l.modelo} — ${onde}${l.esperado ? ` (esperado: ${l.esperado})` : ''}`;
  });
}

/** Relatório detalhado de uma execução, no formato de laudo. */
async function abrirRelatorio(id) {
  const r = await api.runs.read(id);
  if (!r) return;

  const linhas = [
    `EXECUÇÃO ${r.id}`,
    '',
    `Modelo:      ${r.modelo || '—'}`,
    `Origem:      ${r.origem}${r.caso ? ` · ${r.caso}` : ''}`,
    `Quando:      ${new Date(r.em).toLocaleString('pt-BR')}`,
    `Tempo:       ${seg(r.duracaoMs)}`,
    `Passos:      ${r.passos} de ${r.maxPassos}`,
    `Chamadas:    ${r.chamadas.decisao} decisão · ${r.chamadas.redacao} redação`,
    `Tokens:      ${r.tokens.total.toLocaleString('pt-BR')} (${r.tokens.prompt} entrada · ${r.tokens.completion} saída)`,
    // 29/10: quanto levou cada etapa e cada buscador (as somas rodam em paralelo: passam do tempo total)
    ...(r.tempos ? linhasDeTempo(r.tempos) : []),
    // Caso real (Davi, 2026-09-18): "implemente uma função no relatório pra
    // vermos quando as AIs estão sendo usadas, 100% de certeza que está
    // funcionando" — linha de resumo aqui em cima (visão rápida), seção
    // completa mais abaixo (visão detalhada, por origem da consulta).
    r.copiloto?.consultas
      ? `Copiloto:    ${r.copiloto.consultas} consulta(s) · ${r.copiloto.dedicado} no modelo dedicado${
          r.copiloto.modeloDedicado ? ` (${r.copiloto.modeloDedicado})` : ''
        } · ${r.copiloto.principal} no principal${r.copiloto.falhas ? ` · ${r.copiloto.falhas} falharam` : ''}`
      : 'Copiloto:    nenhuma consulta ao crítico nesta execução',
    '',
    'PEDIDO',
    r.pedido || '—',
    '',
    ...(r.entendimento
      ? [
          'ENTENDIMENTO (pedido reescrito pela verificação de ambiguidade)',
          `  original:  ${r.entendimento.original}`,
          `  entendido: ${r.entendimento.reescrito}`,
          '',
        ]
      : []),
    'SKILLS ATIVADAS',
    ...(r.skills.length ? r.skills.map((s) => `  ${s.etapa}: ${s.nomes.join(', ')}`) : ['  nenhuma']),
    '',
    'FERRAMENTAS',
    ...(r.ferramentas.length
      ? r.ferramentas.map(
          (f) =>
            `  ${f.erro ? '✗' : '✓'} ${f.nome.padEnd(20)} ${String(f.duracaoMs).padStart(6)}ms${f.erro ? `  ${f.erro.slice(0, 90)}` : ''}` +
            // Etapa A: o que foi pedido à ferramenta (consulta, URL, foco)
            (f.argumentos ? `\n      ${Object.entries(f.argumentos).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' | ') : v}`).join(' · ').slice(0, 220)}` : '')
        )
      : ['  nenhuma']),
    ...(r.statusDaTarefa ? ['', `STATUS DA TAREFA: ${r.statusDaTarefa.status}${r.statusDaTarefa.motivos?.length ? ` — ${r.statusDaTarefa.motivos.join('; ')}` : ''}`] : []),
    ...(r.tipoDePedido
      ? ['', `TIPO DE PEDIDO: ${r.tipoDePedido.tipo} (${r.tipoDePedido.motivo || ''})${r.tipoDePedido.fonte ? ` · decidido por: ${ROTULO_FONTE_ROTA[r.tipoDePedido.fonte] || r.tipoDePedido.fonte}` : ''}`]
      : []),
    ...(r.assuntoDaConversa ? [`ASSUNTO DA CONVERSA: ${r.assuntoDaConversa.motivo || ''}`] : []),
    ...(r.planoInicial?.length ? ['', 'PLANO INICIAL', ...r.planoInicial.map((p) => `  - ${p}`)] : []),
    ...(r.checklist?.length ? ['', 'CHECKLIST (estado final)', ...r.checklist.map((i) => `  [${i.status === 'feito' ? 'x' : ' '}] ${i.texto}`)] : []),
    ...(r.descartes?.length ? ['', `DESCARTES (${r.descartes.length})`, ...r.descartes.slice(0, 40).map((x) => `  ${x.etapa}: ${x.alvo} — ${x.motivo}`)] : []),
    ...(r.dialogos?.length ? ['', `PERGUNTAS AO USUÁRIO (${r.dialogos.length})`, ...r.dialogos.map((x) => `  P: ${x.pergunta}\n  R: ${x.resposta}`)] : []),
    '',
    'FONTES',
    ...(r.fontes.length
      ? r.fontes.map((f) => `  ${f.id ? `${f.id} ` : ''}${f.tipo === 'busca' ? '⌕' : '✓'} ${f.provedor}${f.consultas?.length ? ` — "${f.consultas.join('" / "').slice(0, 120)}"` : ''}${f.url ? ` — ${f.url.slice(0, 70)}` : ''}`)
      : ['  nenhuma']),
    '',
    'COBERTURA DO MATERIAL',
    r.cobertura
      ? `  ${r.cobertura.nivel} (${r.cobertura.encontrados} de ${r.cobertura.total} termos no material)`
      : '  não medida',
    '',
    'INCIDENTES',
    ...(Object.entries(r.incidentes).filter(([, v]) => v).length
      ? Object.entries(r.incidentes)
          .filter(([, v]) => v)
          .map(([k, v]) => `  ⚠ ${k}: ${v}`)
      : ['  nenhum']),
    '',
    `RESULTADO: ${(r.resultado || '—').toUpperCase()}${r.erro ? ` — ${r.erro}` : ''}`,
    r.nota ? `NOTA DO USUÁRIO: ${r.nota} de 5` : '',
    '',
    'RESPOSTA',
    r.resposta || '(sem resposta)',
    '',
    // Seção completa da consulta ao Copiloto ("2 IAs") — caso real (Davi,
    // 2026-09-18): ele pediu uma forma de confirmar com certeza que o modelo
    // DEDICADO está sendo usado, não só o principal se auto-avaliando. Cada
    // linha de origem vem do evento 'copiloto-consulta' (ver
    // Agent._perguntarAoCritico, loop.js) — é a contagem real de chamadas,
    // não uma estimativa.
    // Pedido do Davi (2026-10-10): ver QUANDO o Tev1 e o crítico entraram,
    // e onde cada modelo estava rodando (GPU/CPU) no fim da execução.
    // Modo AUTO (10/10): o nível que o pedido ganhou e o que ele desligou
    'MODO AUTO',
    ...(r.auto
      ? [
          `  nível ${r.auto.nivel} · ${r.auto.nome}${r.auto.nivelInicial !== undefined ? ` (começou no nível ${r.auto.nivelInicial})` : ''} — ${r.auto.motivo || ''}`,
          ...(Object.keys(r.auto.ajustes || {}).length
            ? [`  ajustes desta execução: ${Object.entries(r.auto.ajustes).map(([k, v]) => `${k}=${v}`).join(', ')}`]
            : []),
          ...(r.auto.rapida
            ? [
                `  resposta rápida em ${Math.round((r.auto.rapida.ms || 0) / 100) / 10} s · Wikipédia: ${r.auto.rapida.wikis.map((w) => `${w.idioma} "${w.titulo}" (${w.campos} campos)`).join(', ') || 'nenhuma'} · páginas: ${r.auto.rapida.paginas.length}`,
                `  conferência: ${r.auto.rapida.fatosConferiveis} dado(s) conferível(is); ${r.auto.rapida.correcoes.length ? `corrigido: ${r.auto.rapida.correcoes.map((c) => `${c.fato} ${c.de} → ${c.para}`).join('; ')}` : 'nada a corrigir'}`,
              ]
            : []),
        ]
      : ['  desligado (ou execução anterior a esta versão)']),
    '',
    'IAS AUXILIARES ACIONADAS (em ordem)',
    ...(r.acionamentos?.length
      ? r.acionamentos.map(
          (a) => `  ${a.ok === false ? '✗' : '•'} passo ${a.n} · ${a.quem}${a.modelo ? ` (${a.modelo})` : ''}: ${a.detalhe}${typeof a.ms === 'number' ? ` · ${a.ms} ms` : ''}`
        )
      : ['  nenhuma (roteador desligado e nenhuma consulta ao crítico), ou execução anterior a esta versão']),
    '',
    'ONDE CADA MODELO ESTAVA NO FIM DA EXECUÇÃO',
    ...(r.modelosNaExecucao?.length ? resumoDosModelos(r.modelosNaExecucao).map((l) => `  ${l}`) : ['  não registrado (execução sem conclusão normal, ou anterior a esta versão)']),
    '',
    'COPILOTO ("2 IAs") — CONSULTAS AO CRÍTICO',
    ...(r.copiloto?.consultas
      ? [
          `  ${r.copiloto.consultas} consulta(s) no total`,
          `  ${r.copiloto.dedicado} no modelo DEDICADO${r.copiloto.modeloDedicado ? ` (${r.copiloto.modeloDedicado}, CPU)` : ''}`,
          `  ${r.copiloto.principal} no modelo principal${r.copiloto.dedicado ? ' (fallback ou "modelo atual")' : ''}`,
          ...(r.copiloto.falhas ? [`  ⚠ ${r.copiloto.falhas} falharam (erro de rede/timeout)`] : []),
          '  por origem:',
          ...Object.entries(r.copiloto.porOrigem || {}).map(([origem, n]) => `    ${origem}: ${n}`),
        ]
      : ['  nenhuma consulta ao crítico nesta execução (ou execução anterior a esta versão)']),
    '',
    'CRÍTICAS DO COPILOTO',
    ...(r.criticasAutomaticas?.length
      ? r.criticasAutomaticas.map(
          (c) => `  [passo ${c.n} · ${ROTULO_FASE_CRITICA[c.fase] || c.fase}] ${c.texto}`
        )
      : ['  nenhuma']),
    '',
    'RACIOCÍNIO PASSO A PASSO',
    ...(r.passosDetalhados?.length
      ? r.passosDetalhados.flatMap((p) => [
          `  passo ${p.n}:`,
          p.pensamento ? `    pensamento: ${p.pensamento}` : null,
          p.raciocinio ? `    raciocínio: ${p.raciocinio}` : null,
          p.critica ? `    risco:      ${p.critica}` : null,
          p.plano?.length ? `    plano:      ${p.plano.join(' · ')}` : null,
          '',
        ].filter((l) => l !== null))
      : ['  não disponível para execuções anteriores a esta versão']),
  ];

  $('dlgSkillNome').textContent = `Execução · ${r.modelo || '—'}`;
  $('dlgSkillCorpo').textContent = linhas.join('\n');
  $('dlgSkill').dataset.id = '';
  $('dlgSkill').showModal();
}

$('filtroOrigem').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  execucoes.origem = chip.dataset.origem;
  $('filtroOrigem').querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativo', c === chip));
  carregarExecucoes();
});

// Pedido de Davi 2026-09-23: "Visualizar Execuções" em janela própria
// (3 colunas + buscador + gráfico de linhas) — ver renderer/execucoes.html/js.
$('btnAbrirJanelaExec').addEventListener('click', () => api.runs.abrirJanela());

$('btnExportarExec').addEventListener('click', () => api.runs.export(execucoesFiltradas().map((r) => r.id)));

$('btnLimparExec').addEventListener('click', async () => {
  const alvo = execucoes.origem || null;
  if (!confirm(`Apagar ${alvo ? `as execuções de "${alvo}"` : 'todas as execuções'}?`)) return;
  await api.runs.clear(alvo);
  carregarExecucoes();
});

/* ------------------ botão central da barra (2026-10-11) ------------------ */
// Um botão só resume modelo · autonomia · raciocínio e abre o painel com os
// seletores e o estado do Ollama. Os seletores e indicadores são os de
// sempre (mesmos ids); aqui só mora o abre/fecha e o texto do botão.
(function botaoDaExecucao() {
  const botao = $('btnExecucao');
  const painel = $('painelExecucao');
  if (!botao || !painel) return;
  const abrir = (aberto) => {
    painel.hidden = !aberto;
    botao.setAttribute('aria-expanded', String(aberto));
  };
  botao.addEventListener('click', (e) => {
    e.stopPropagation();
    abrir(painel.hidden);
  });
  painel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => abrir(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !painel.hidden) abrir(false);
  });

  let buscaFraca = false; // um buscador ou nenhum respondendo (ver verBusca, abaixo)
  const curto = (select) => (select?.selectedOptions?.[0]?.textContent || '').split('·')[0].trim();
  const resumir = () => {
    const ollama = $('statusOllama');
    const modelos = $('btnModelos');
    const pesquisa = $('modoDePesquisa').value === 'investigacao' ? tr('investigação {n} min', { n: config.minutosDeInvestigacao || 10 }) : $('modoDePesquisa').value === 'conversa' ? tr('só conversar') : tr('pesquisa {modo}', { modo: curto($('modoDePesquisa')) });
    const partes = [$('modelo').value || tr('sem modelo'), pesquisa, curto($('modoResposta'))].filter(Boolean);
    const desligado = ollama.classList.contains('offline');
    const texto = desligado ? tr('Ollama desligado · {resto}', { resto: partes.join(' · ') }) : partes.join(' · ');
    if ($('resumoExecucao').textContent !== texto) $('resumoExecucao').textContent = texto;
    botao.classList.toggle('offline', desligado);
    const atencao = modelos.classList.contains('modelos-atencao') || buscaFraca;
    botao.classList.toggle('atencao', !desligado && atencao);
    botao.classList.toggle('ok', ollama.classList.contains('online') && !atencao);
  };

  // Buscadores do SearXNG: quantos responderam na última pesquisa (11/10 —
  // três dos cinco estavam suspensos e a busca voltava vazia sem aviso)
  const verBusca = async () => {
    const s = await api.ollama.saudeDaBusca().catch(() => null);
    if (!s?.em) return;
    const el = $('statusBusca');
    const ok = s.respondendo.length;
    el.hidden = false;
    el.querySelector('span').textContent = `busca · ${ok} de ${ok + s.semResposta.length} buscadores`;
    el.title = [ok ? `respondendo: ${s.respondendo.join(', ')}` : 'nenhum buscador respondeu na última pesquisa', ...s.semResposta.map((f) => `${f.nome}: ${f.motivo}`)].join('\n');
    el.classList.toggle('online', ok >= 2);
    el.classList.toggle('copiloto-gpu', ok === 1); // o mesmo âmbar do aviso do copiloto
    el.classList.toggle('offline', ok === 0);
    buscaFraca = ok <= 1;
  };
  setInterval(verBusca, 15000);
  verBusca();
  // ponytail: releitura a cada 600 ms — os seletores também mudam por código
  // (carregar ajustes, lista de modelos), sem evento; trocar por eventos se pesar
  setInterval(resumir, 600);
  resumir();
})();

// Fase 3 (16/10): a miniatura de um vídeo vira o player do youtube-nocookie.com
// só no clique — antes disso, nenhuma página do YouTube é carregada na tela.
document.addEventListener('click', (e) => {
  const figura = e.target.closest('.md-video[data-yt]');
  if (!figura || figura.querySelector('iframe') || !/^[A-Za-z0-9_-]{11}$/.test(figura.dataset.yt)) return;
  const quadro = document.createElement('iframe');
  quadro.src = `https://www.youtube-nocookie.com/embed/${figura.dataset.yt}?autoplay=1&rel=0`;
  quadro.allow = 'autoplay; encrypted-media; picture-in-picture';
  quadro.referrerPolicy = 'strict-origin-when-cross-origin';
  quadro.title = figura.querySelector('figcaption')?.textContent || 'vídeo';
  figura.querySelector('img').replaceWith(quadro);
});

/* Imagens das respostas (23/10, pedido do Davi): clicar na foto abre ela grande; o botão no canto
   (aparece ao passar o mouse) baixa a imagem ou abre a página de onde ela veio. */
const imagemAberta = { nome: null, legenda: '', origem: null };
const nomeDaImagem = (img) => /^augpt-img:\/\/([a-z]{20,64}\.(?:jpg|png|webp))/.exec(img?.getAttribute('src') || '')?.[1] || null;

async function prepararImagem(img) {
  imagemAberta.nome = nomeDaImagem(img);
  imagemAberta.legenda = img.alt || img.closest('figure')?.querySelector('figcaption')?.textContent || '';
  imagemAberta.origem = imagemAberta.nome ? await api.imagem.origem(imagemAberta.nome).catch(() => null) : null;
  return imagemAberta;
}
const fonteDaImagem = () => imagemAberta.origem?.pagina || imagemAberta.origem?.url || null;

async function baixarImagem(status) {
  if (!imagemAberta.nome) return;
  const r = await api.imagem.salvar(imagemAberta.nome, imagemAberta.legenda);
  if (!status) return;
  status.textContent = '';
  if (r.ok) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = tr('salva — mostrar na pasta');
    botao.addEventListener('click', () => api.imagem.mostrarNaPasta(r.caminho));
    status.append(botao);
  } else if (!r.cancelado) status.textContent = tr('não consegui salvar ({erro})', { erro: r.error });
}

function abrirImagemGrande(img) {
  $('dlgImagemFoto').src = img.getAttribute('src');
  $('dlgImagemFoto').alt = imagemAberta.legenda;
  $('dlgImagemLegenda').textContent = imagemAberta.legenda;
  $('dlgImagemStatus').textContent = '';
  $('btnImagemFonte').hidden = !fonteDaImagem();
  $('dlgImagem').showModal();
}

function fecharMenuImagem() {
  $('menuImagem').hidden = true;
  document.querySelectorAll('.md-img-acoes[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

document.addEventListener('click', async (e) => {
  const botao = e.target.closest('.md-img-acoes');
  if (botao) {
    e.stopPropagation();
    const aberto = botao.getAttribute('aria-expanded') === 'true';
    fecharMenuImagem();
    if (aberto) return;
    const img = botao.closest('figure').querySelector('img');
    await prepararImagem(img);
    menuImagem.img = img;
    const menu = $('menuImagem');
    menu.querySelector('[data-acao="fonte"]').hidden = !fonteDaImagem();
    menu.hidden = false;
    const r = botao.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${r.bottom + 6 + menu.offsetHeight > innerHeight ? r.top - menu.offsetHeight - 6 : r.bottom + 6}px`;
    botao.setAttribute('aria-expanded', 'true');
    return;
  }
  const item = e.target.closest('#menuImagem [data-acao]');
  if (item) {
    const acao = item.dataset.acao;
    fecharMenuImagem();
    if (acao === 'abrir') abrirImagemGrande(menuImagem.img);
    if (acao === 'baixar') baixarImagem(null);
    if (acao === 'fonte' && fonteDaImagem()) window.open(fonteDaImagem(), '_blank');
    return;
  }
  if (!e.target.closest('#menuImagem')) fecharMenuImagem();
  const img = e.target.closest('.md-figura img');
  if (img && !e.target.closest('.md-video')) {
    await prepararImagem(img);
    abrirImagemGrande(img);
  }
});
const menuImagem = { img: null };
document.addEventListener('keydown', (e) => e.key === 'Escape' && fecharMenuImagem());
document.addEventListener('scroll', fecharMenuImagem, true);
$('btnImagemFechar').addEventListener('click', () => $('dlgImagem').close());
$('btnImagemBaixar').addEventListener('click', () => baixarImagem($('dlgImagemStatus')));
$('btnImagemFonte').addEventListener('click', () => fonteDaImagem() && window.open(fonteDaImagem(), '_blank'));
// clicar fora da imagem (no fundo escuro) fecha
$('dlgImagem').addEventListener('click', (e) => e.target === $('dlgImagem') && $('dlgImagem').close());

// Fase 4 (16/10): setas do carrossel de imagens (md.js) — uma imagem por clique
document.addEventListener('click', (e) => {
  const seta = e.target.closest('.md-carrossel .md-seta');
  if (!seta) return;
  const trilho = seta.parentElement.querySelector('.md-trilho');
  const passo = trilho.querySelector('.md-figura')?.offsetWidth || trilho.clientWidth;
  trilho.scrollBy({ left: Number(seta.dataset.dir) * (passo + 10), behavior: 'smooth' });
});
