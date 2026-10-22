'use strict';

/* Parte da tela do AuGPT (renderer/app.js dividido em 19/10): os arquivos app*.js são scripts comuns,
 * carregados em ordem no index.html, e compartilham as mesmas variáveis do nível de cima. */

/* ============================ enviar pedido ao agente ============================ */

async function enviarPedido() {
  if (agente.rodando) {
    await api.agent.stop();
    return;
  }
  const pedido = el.aEntrada.value.trim();
  if (!pedido) return;
  if (!el.modelo.value) {
    // Fase 2: antes mandava rodar "ollama pull" num terminal — mesmo com o
    // Ollama nem instalado. Agora aponta pro guia de primeira execução, que
    // sabe exatamente qual passo falta e faz o download pelo próprio app.
    criarTurno(pedido);
    manipuladores.erro({
      mensagem: 'Ainda não há um modelo de IA pronto pra usar. Siga os passos de "Antes de começar" na tela inicial do Agente (botão Nova conversa) — o AuGPT mostra o que falta e baixa o modelo pra você.',
    });
    atualizarPrimeiroUso();
    return;
  }

  // Snapshot antes de consumirAnexos('agente') zerar a fila — precisamos dos
  // itens individuais (caminho na pasta de trabalho) pro painel "Arquivos" da
  // lateral direita, que consumirAnexos não devolve (só o rótulo/contexto
  // pro prompt).
  const anexosParaPainel = anexos.agente.filter((a) => !a.erro && a.relativo);
  const { rotulo, contexto } = consumirAnexos('agente');
  const pedidoCompleto = pedido + contexto;

  el.aEntrada.value = '';
  autoAltura(el.aEntrada);
  el.aEntrada.disabled = true;
  el.aEnviar.textContent = '■';
  el.aEnviar.classList.add('parando');
  agente.rodando = true;

  const turno = criarTurno(pedido);
  if (rotulo) {
    const marca = document.createElement('div');
    marca.className = 'anexos-enviados';
    marca.textContent = `anexos: ${rotulo}`;
    turno.caixa.previousElementSibling.querySelector('.msg-corpo').appendChild(marca);
  }
  anexosParaPainel.forEach((a) => adicionarSaida({ caminho: a.relativo, tamanho: a.tamanho, tipo: 'anexado' }));
  agente.conversa.push({ role: 'user', content: pedidoCompleto });

  const r = await api.agent.start(pedidoCompleto, agente.conversa.slice(0, -1), agente.idConversa);
  if (!r.ok) manipuladores.erro({ mensagem: r.error, amigavel: r.amigavel });
}

el.aEnviar.addEventListener('click', enviarPedido);
el.aEntrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarPedido();
  }
});
el.aEntrada.addEventListener('input', () => autoAltura(el.aEntrada));

for (const alvo of [el.aMensagens, el.aAbertura]) {
  alvo.addEventListener('click', (e) => {
    const li = e.target.closest('.exemplos li');
    if (!li) return;
    el.aEntrada.value = li.textContent.trim();
    autoAltura(el.aEntrada);
    el.aEntrada.focus();
  });
}

/* ============================ abas ============================ */

// Nomes exibidos no rótulo da seção atual (#secaoAtual, barra superior) —
// mesmas chaves de ABAS abaixo.
const ROTULOS_ABAS = {
  agente: 'Agente',
  conversa: 'Conversa',
  skills: 'Skills',
  utilitarios: 'Utilitários',
  execucoes: 'Execuções',
  config: 'Ajustes',
};

// Navegação principal — pedido do Davi (2026-09-18): as abas que ficavam no
// topo se mudaram pra uma lista de ícones na lateral esquerda (#navPrincipal,
// renderer/index.html), junto da lista de conversas. `aba` aqui aponta pro
// item de navegação correspondente (mesmo papel que o antigo botão de aba).
const ABAS = {
  agente: { view: 'viewAgente', aba: 'navAgente' },
  conversa: { view: 'viewConversa', aba: 'navConversa' },
  skills: { view: 'viewSkills', aba: 'navSkills' },
  utilitarios: { view: 'viewUtilitarios', aba: 'navUtilitarios' },
  execucoes: { view: 'viewExecucoes', aba: 'navExecucoes' },
  config: { view: 'viewConfig', aba: 'navConfig' },
};

function trocarAba(qual) {
  abaAtual = qual;
  for (const [nome, ref] of Object.entries(ABAS)) {
    $(ref.view).hidden = nome !== qual;
    if (ref.aba) {
      $(ref.aba).classList.toggle('ativo', nome === qual);
      $(ref.aba).setAttribute('aria-selected', String(nome === qual));
    }
  }
  $('secaoAtual').textContent = ROTULOS_ABAS[qual] || '';

  // A lateral (navegação + lista de conversas) fica sempre visível agora,
  // em qualquer seção — antes só aparecia em Agente/Conversa (mesmo espírito
  // do Claude/Cowork: dá pra trocar de conversa mesmo estando em Skills ou
  // Ajustes, sem precisar voltar primeiro).
  const comLateral = qual === 'agente' || qual === 'conversa';
  $('campoAutonomia').hidden = qual !== 'agente';
  $('campoNivelRaciocinio').hidden = qual !== 'agente';

  // Lateral direita ("Progresso"/"Arquivos", fase 2 da reforma visual) só
  // faz sentido na aba Agente — checklist e arquivos gerados por ferramenta
  // não existem na aba Conversa (só pergunta/resposta direta ao modelo, sem
  // agente nem ferramentas).
  $('lateralDireita').hidden = qual !== 'agente';

  if (comLateral) {
    historico.filtro = '';
    $('buscaConversa').value = '';
    pintarConversas();
  }

  if (qual === 'conversa') {
    el.cModelo.textContent = config.model || 'nenhum modelo';
    el.cEntrada.focus();
  } else if (qual === 'skills') {
    if (!$('painelFerramentas').hidden) carregarFerramentas();
    else if (!$('painelSugestoes').hidden) carregarSugestoes();
    else carregarSkills();
  } else if (qual === 'utilitarios') {
    carregarUtilitarios();
  } else if (qual === 'execucoes') {
    carregarExecucoes();
  } else if (qual === 'config') {
    preencherConfig();
    carregarArvore();
    carregarMemoria();
    carregarDominios();
    carregarAgendamentos();
    carregarEstadoSearxngRuntime();
    carregarRecomendacaoHardware();
    carregarModelosEComponentes();
    pintarEspelhos();
  } else {
    el.aEntrada.focus();
  }
}

$('navAgente').addEventListener('click', () => trocarAba('agente'));
$('navConversa').addEventListener('click', () => trocarAba('conversa'));
$('navSkills').addEventListener('click', () => trocarAba('skills'));
$('navUtilitarios').addEventListener('click', () => trocarAba('utilitarios'));

/* ============================ utilitários (19/10) ============================ */

// Ícones dos cartões (traço de 1.6, como os da lateral); a lista vem do catálogo do agente.
const ICONES_UTIL = {
  velocidade: '<path d="M3.5 14a6.5 6.5 0 1 1 13 0"/><path d="M10 14l3-4.5"/>',
  pulso: '<path d="M2 10h4l2-5 4 10 2-5h4"/>',
  jogo: '<rect x="2" y="6" width="16" height="9" rx="4"/><path d="M6 9v3M4.5 10.5h3"/><circle cx="13.5" cy="9.5" r=".6"/><circle cx="15" cy="11.5" r=".6"/>',
  raiox: '<path d="M2.5 8a11 11 0 0 1 15 0M5 11a7 7 0 0 1 10 0M7.5 14a3 3 0 0 1 5 0"/><circle cx="10" cy="16.5" r=".7"/>',
  aparelhos: '<rect x="2" y="4" width="10" height="7" rx="1"/><path d="M5 14h4"/><rect x="13.5" y="7" width="4.5" height="9" rx="1"/>',
  trafego: '<path d="M6 3v14M6 17l-3-3M6 17l3-3M14 17V3M14 3l-3 3M14 3l3 3"/>',
  ajustes: '<path d="M2 5h9M15 5h3M2 10h3M7 10h11M2 15h9M15 15h3"/><circle cx="12" cy="5" r="2"/><circle cx="5" cy="10" r="2"/><circle cx="12" cy="15" r="2"/>',
  disco: '<ellipse cx="10" cy="5" rx="7" ry="2.5"/><path d="M3 5v10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5M3 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  cpu: '<rect x="5" y="5" width="10" height="10" rx="1.5"/><rect x="8" y="8" width="4" height="4"/><path d="M8 2v3M12 2v3M8 15v3M12 15v3M2 8h3M2 12h3M15 8h3M15 12h3"/>',
  janela: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M2.5 7h15M10 7v9.5"/>',
  placa: '<rect x="2" y="5" width="16" height="9" rx="1"/><circle cx="12.5" cy="9.5" r="2.5"/><path d="M4 14v2M7 14v2M5 8h3"/>',
  mouse: '<rect x="5.5" y="2.5" width="9" height="15" rx="4.5"/><path d="M10 2.5v5"/>',
  som: '<path d="M3 8v4h3l4 3.5v-11L6 8H3Z"/><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10"/>',
  fotos: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><circle cx="7" cy="8" r="1.5"/><path d="M2.5 14l4.5-4 4 3.5 2.5-2 4 3"/>',
  programas: '<rect x="2.5" y="2.5" width="6" height="6" rx="1"/><rect x="11.5" y="2.5" width="6" height="6" rx="1"/><rect x="2.5" y="11.5" width="6" height="6" rx="1"/><rect x="11.5" y="11.5" width="6" height="6" rx="1"/>',
  ligar: '<path d="M10 2.5v7"/><path d="M6 5a6.5 6.5 0 1 0 8 0"/>',
  lupa: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5l5 5"/>',
  carrinho: '<path d="M2 3h2.5l2 10h9l2-7H5.5"/><circle cx="8" cy="16.5" r="1"/><circle cx="14.5" cy="16.5" r="1"/>',
  relatorio: '<path d="M5 2.5h7l3.5 3.5v11.5h-10.5Z"/><path d="M12 2.5V6h3.5M7.5 10h5M7.5 13h5"/>',
  video: '<rect x="2" y="4.5" width="16" height="11" rx="3"/><path d="M8.5 7.5v5l4-2.5Z"/>',
  grafico: '<path d="M3 3v14h14"/><path d="M6 13l3.5-4 3 2.5L17 6"/>',
  codigo: '<path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11 4l-2 12"/>',
  pincel: '<path d="M16.5 3.5l-8 8"/><path d="M8.5 11.5c-2 0-3.5 1.5-3.5 3.5 0 1-1 1.5-2 1.5 3 1.5 7.5 1 7.5-3"/>',
  olho: '<path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Z"/><circle cx="10" cy="10" r="2.5"/>',
  globo: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5Z"/>',
  arquivo: '<path d="M5 2.5h7l3.5 3.5v11.5h-10.5Z"/><path d="M12 2.5V6h3.5"/>',
};

async function carregarUtilitarios() {
  const lista = $('listaUtilitarios');
  if (lista.childElementCount) return; // a lista não muda com o app aberto
  const cartoes = await api.utilitarios.listar().catch(() => []);
  const grupos = new Map();
  for (const c of cartoes) (grupos.get(c.grupo) || grupos.set(c.grupo, []).get(c.grupo)).push(c);
  for (const [nome, itens] of grupos) {
    const h = document.createElement('h2');
    h.className = 'util-grupo';
    h.textContent = nome;
    const grade = document.createElement('div');
    grade.className = 'util-grade';
    for (const c of itens) {
      const card = document.createElement('article');
      card.className = 'util-card' + (c.disponivel ? '' : ' indisponivel');
      card.innerHTML = `<svg class="util-icone" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES_UTIL[c.icone] || ICONES_UTIL.lupa}</svg><h3></h3><p class="util-desc"></p><p class="util-como"></p><div class="util-rodape"></div>`;
      card.querySelector('h3').textContent = c.nome;
      card.querySelector('.util-desc').textContent = c.descricao;
      card.querySelector('.util-como').textContent = c.exemplo ? `"${c.exemplo}"` : c.dica || '';
      const rodape = card.querySelector('.util-rodape');
      if (!c.disponivel) {
        rodape.textContent = c.falta;
      } else if (c.exemplo) {
        const b = document.createElement('button');
        b.className = 'btn-secundario';
        b.textContent = 'Usar';
        b.addEventListener('click', () => {
          trocarAba('agente');
          el.aEntrada.value = c.exemplo;
          enviarPedido();
        });
        rodape.append(b);
      }
      grade.append(card);
    }
    lista.append(h, grade);
  }
}
$('navExecucoes').addEventListener('click', () => trocarAba('execucoes'));
// Fase 2: clicar em Ajustes estando em Ajustes não pula mais pro Agente
// (parecia que o botão "fechava" a página sem motivo).
$('navConfig').addEventListener('click', () => trocarAba('config'));

// Ajustes em abas (Fase 1, 16/10)
function abrirAjuste(painel) {
  document.querySelectorAll('.ajustes-aba').forEach((b) => b.classList.toggle('ativa', b.dataset.painel === painel));
  document.querySelectorAll('.ajustes-painel').forEach((p) => (p.hidden = p.id !== painel));
  document.querySelector('#viewConfig .pagina-rolagem').scrollTop = 0;
}
document.querySelectorAll('.ajustes-aba').forEach((b) => b.addEventListener('click', () => abrirAjuste(b.dataset.painel)));
// cada aba de Ajustes com o ícone dela, no traço da lateral (22/10)
const ICONE_DA_ABA = { ajGeral: 'ajustes', ajModelos: 'cpu', ajPesquisa: 'lupa', ajMemoria: 'relatorio', ajTarefas: 'programas', ajComponentes: 'disco', ajAvancado: 'codigo' };
document.querySelectorAll('.ajustes-aba').forEach((b) => {
  const desenho = ICONES_UTIL[ICONE_DA_ABA[b.dataset.painel]];
  if (desenho) b.insertAdjacentHTML('afterbegin', `<svg class="aba-icone" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${desenho}</svg>`);
});

// Modelo, profundidade e tipo de resposta na aba Geral são cópias dos
// seletores do topo: mudar um muda o outro (o "change" do topo grava).
function pintarEspelhos() {
  document.querySelectorAll('[data-espelho]').forEach((copia) => {
    const original = $(copia.dataset.espelho);
    copia.innerHTML = original.innerHTML;
    copia.value = original.value;
  });
}
document.querySelectorAll('[data-espelho]').forEach((copia) =>
  copia.addEventListener('change', () => {
    const original = $(copia.dataset.espelho);
    original.value = copia.value;
    original.dispatchEvent(new Event('change'));
  })
);

/* ============================ conversa (chat puro) ============================ */

function bolha(quem, conteudo, classe = '') {
  el.cAbertura.hidden = true;
  const div = document.createElement('div');
  div.className = `msg ${quem === 'user' ? 'eu' : 'ia'} ${classe}`;
  div.innerHTML = `<div class="msg-quem">${quem === 'user' ? 'você' : 'assistente'}</div><div class="msg-corpo"></div>`;
  const corpo = div.querySelector('.msg-corpo');
  if (quem === 'user') corpo.textContent = conteudo;
  else {
    corpo.innerHTML = window.md.render(conteudo);
    window.md.montarGraficos(corpo);
  }
  el.cMensagens.appendChild(div);
  return corpo;
}

api.chat.onToken(({ id, pedaco }) => {
  if (id !== chat.idAtual || !chat.alvo) return;
  chat.buffer += pedaco;
  chat.alvo.innerHTML = `${window.md.render(chat.buffer)}<span class="cursor"></span>`;
  rolar(el.cRolagem);
});

async function enviarMensagem() {
  if (chat.ocupado) {
    await api.chat.stop();
    return;
  }
  const texto = el.cEntrada.value.trim();
  if (!texto) return;
  if (!config.model) {
    bolha('assistant', 'Ainda não há um modelo de IA pronto. Abra a aba Agente: a tela inicial mostra o que falta e baixa o modelo pra você.', 'erro');
    return;
  }

  const { rotulo, contexto } = consumirAnexos('chat');

  el.cEntrada.value = '';
  autoAltura(el.cEntrada);
  const corpoUsuario = bolha('user', texto);
  if (rotulo) {
    const marca = document.createElement('div');
    marca.className = 'anexos-enviados';
    marca.textContent = `anexos: ${rotulo}`;
    corpoUsuario.appendChild(marca);
  }
  chat.historico.push({ role: 'user', content: texto + contexto });

  chat.ocupado = true;
  chat.buffer = '';
  chat.idAtual = `c${Date.now()}`;
  chat.alvo = bolha('assistant', '');
  chat.alvo.innerHTML = '<span class="cursor"></span>';
  el.cEnviar.textContent = '■';
  el.cEnviar.classList.add('parando');
  rolar(el.cRolagem, true);

  const r = await api.chat.send(chat.idAtual, chat.historico);

  if (r.ok) {
    chat.alvo.innerHTML = window.md.render(r.conteudo);
    window.md.montarGraficos(chat.alvo);
    chat.historico.push({ role: 'assistant', content: r.conteudo });
  } else if (r.interrompido) {
    chat.alvo.innerHTML = window.md.render(chat.buffer || '_(interrompido)_');
    window.md.montarGraficos(chat.alvo);
    if (chat.buffer) chat.historico.push({ role: 'assistant', content: chat.buffer });
  } else {
    chat.alvo.closest('.msg').classList.add('erro');
    // Fase 2: frase que diz o que fazer, com o texto técnico junto (ver manipuladores.erro)
    chat.alvo.textContent = r.amigavel ? `${r.amigavel}\n\ndetalhe técnico: ${r.error}` : r.error;
    chat.historico.pop();
  }

  chat.ocupado = false;
  chat.alvo = null;
  el.cEnviar.textContent = '↑';
  el.cEnviar.classList.remove('parando');
  rolar(el.cRolagem);
  salvarConversa('conversa');
}

el.cEnviar.addEventListener('click', enviarMensagem);
el.cEntrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarMensagem();
  }
});
el.cEntrada.addEventListener('input', () => autoAltura(el.cEntrada));

document.addEventListener('click', (e) => {
  if (e.target.closest('a[data-externo]')) e.preventDefault();
});

/* ============================ painel lateral ============================ */

function aplicarLateral(aberta) {
  document.body.classList.toggle('sem-lateral', !aberta);
  const btn = $('btnLateral');
  btn.classList.toggle('fechado', !aberta);
  btn.title = aberta ? 'Ocultar painel (Ctrl+B)' : 'Mostrar painel (Ctrl+B)';
  btn.setAttribute('aria-expanded', String(aberta));
}

async function alternarLateral() {
  const aberta = document.body.classList.contains('sem-lateral');
  aplicarLateral(aberta);
  config = await api.config.set({ lateralAberta: aberta });
}

$('btnLateral').addEventListener('click', alternarLateral);

// coluna da direita (Progresso, Arquivos, Parágrafos), 20/10: recolhida por padrão — o cartão de
// atividade já mostra o progresso; o botão do topo abre, e a escolha fica guardada
function aplicarPainelDireito(aberto) {
  document.body.classList.toggle('sem-direita', !aberto);
  $('btnPainelDireito').setAttribute('aria-expanded', String(aberto));
  $('btnPainelDireito').classList.toggle('ativo', aberto);
}
$('btnPainelDireito').addEventListener('click', async () => {
  const aberto = document.body.classList.contains('sem-direita');
  aplicarPainelDireito(aberto);
  config = await api.config.set({ painelDireitoAberto: aberto });
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    alternarLateral();
  }
  if (e.key === 'Escape') {
    fecharMenu();
    if (historico.modoSelecao) sairDaSelecao();
  }
});

