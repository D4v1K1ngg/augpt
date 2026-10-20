'use strict';

/* Parte da tela do AuGPT (renderer/app.js dividido em 19/10): os arquivos app*.js são scripts comuns,
 * carregados em ordem no index.html, e compartilham as mesmas variáveis do nível de cima. */

/* ============================ eventos do agente ============================ */

// Rótulo do cartão de crítica por `fase` (ver Agent.criticaAutomatica em
// loop.js) — sem `fase` (crítica periódica de sempre, criticaDoPlano) cai no
// padrão "crítica ao plano", comportamento inalterado.
const ROTULO_FASE_CRITICA = {
  entendimento: 'crítica ao entendimento',
  'plano-inicial': 'crítica ao plano',
  'direcao-pesquisa': 'crítica à direção da pesquisa',
  'parte-concluida': 'crítica da parte concluída',
  'pre-redacao': 'crítica antes de redigir',
};

const manipuladores = {
  inicio({ objetivo, modelo }) {
    // Execução iniciada fora do envio normal (rotina automática disparando
    // sozinha): a UI nunca criou o turno antes de chamar api.agent.start,
    // então cria aqui — mesmo estado que enviarPedido() prepara na mão.
    if (!agente.rodando) {
      agente.rodando = true;
      el.aEntrada.disabled = true;
      el.aEnviar.textContent = '■';
      el.aEnviar.classList.add('parando');
      agente.conversa.push({ role: 'user', content: objetivo });
      criarTurno(objetivo);
    }
    agente.fontes = new Set();
    agente.inicio = Date.now();
    el.tokens.textContent = '0';
    el.iteracao.textContent = '0';
    el.contexto.textContent = '—'; // 1º valor real só chega na 1ª decisão (evento 'janela-contexto')
    clearInterval(agente.cronometro);
    agente.cronometro = setInterval(() => {
      const s = Math.floor((Date.now() - agente.inicio) / 1000);
      el.tempo.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
    }, 1000);
    situacao(`pensando · ${modelo}`);
  },

  // 19/10: o caminho novo começa por aqui, e sem isto o "decorrido" ficava em 0s e passos/tokens
  // mostravam os números da execução anterior
  'inicio-rapido'({ objetivo }) {
    manipuladores.inicio({ objetivo, modelo: config?.model || '' });
  },

  iteracao({ n, de }) {
    el.iteracao.textContent = n;
    el.max.textContent = de;
    // 19/10: o nó nasce com o primeiro conteúdo do passo (pensamento, ação…); só com o
    // número, a trilha virava uma pilha de bolinhas e o "raciocínio" parecia não abrir
    if (agente.turno) agente.turno.passoAtual = n;
    situacao(`passo ${n} de ${de}`);
  },

  pensando({ n }) {
    const alvo = no(n);
    if (!alvo.querySelector('.cartao.pensamento')) {
      cartao(alvo, 'pensamento provisorio', 'raciocinando', '<div class="digitando"><i></i><i></i><i></i></div>');
    }
    situacao('raciocinando…');
  },

  raciocinio({ n, pensamento, raciocinio, plano, critica }) {
    const alvo = no(n);
    alvo.querySelector('.cartao.provisorio')?.remove();
    cartao(
      alvo,
      'pensamento',
      'raciocínio',
      [
        pensamento ? `<p>${esc(pensamento)}</p>` : '',
        raciocinio ? `<p class="secundario">${esc(raciocinio)}</p>` : '',
        critica ? `<div class="critica"><b>risco</b><br>${esc(critica)}</div>` : '',
      ].join('')
    );
    if (pensamento) situacao(pensamento.slice(0, 70));
    if (plano?.length) {
      const t = agente.turno;
      if (t) {
        let caixa = t.caixa.querySelector('.plano-turno');
        if (!caixa) {
          caixa = document.createElement('ol');
          caixa.className = 'plano-turno';
          t.ancora.before(caixa);
        }
        caixa.innerHTML = plano.slice(0, 6).map((p) => `<li>${esc(p)}</li>`).join('');
      }
    }
  },

  ferramenta({ n, nome, argumentos, risco }) {
    const args = Object.entries(argumentos || {})
      .map(([k, v]) => {
        const texto = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        return `<div class="arg"><dt>${esc(k)}</dt><dd>${esc(String(texto).slice(0, 4000))}</dd></div>`;
      })
      .join('');
    cartao(
      no(n),
      'acao',
      `ação<span class="selo ${esc(risco)}">${esc(risco)}</span>`,
      `<div class="assinatura"><span class="fn">${esc(nome)}</span>()</div>${args ? `<dl class="args">${args}</dl>` : ''}`
    );
    if (GERACOES_DE_ARQUIVO.includes(nome) && agente.turno) {
      agente.turno.chamadasDeArquivo[n] = { nome, argumentos };
    }
    situacao(`executando ${nome}`);
  },

  aprovacao({ id, nome, argumentos, risco, descricao, critica, permiteSempre, motivo }) {
    abrirDetalhe();
    situacao('aguardando sua confirmação');
    // Fase 1 de segurança (2026-09-23): o cartão mostra EXATAMENTE o que vai
    // rodar (o comando, o código, o arquivo, a URL) — antes só aparecia o
    // nome da ferramenta, e o usuário aprovava "executar_comando" sem ver o
    // comando. E "Sempre permitir" some pras ações que não aceitam
    // autorização permanente (`permiteSempre: false`, ver src/config.js).
    const detalhes = Object.entries(argumentos || {})
      .map(([k, v]) => {
        const texto = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        return `<div class="arg"><dt>${esc(k)}</dt><dd>${esc(String(texto).slice(0, 4000))}</dd></div>`;
      })
      .join('');
    const card = cartao(
      agente.turno?.noAtual || noSolto(),
      'aprovacao',
      `precisa da sua confirmação<span class="selo ${esc(risco)}">${esc(risco)}</span>`,
      `<p>Executar <b>${esc(nome)}</b>?</p><p class="secundario">${esc(descricao)}</p>
       ${motivo ? `<p class="critica-segunda-opiniao">⚠ ${esc(motivo)}</p>` : ''}
       ${detalhes ? `<dl class="args">${detalhes}</dl>` : ''}
       ${critica ? `<p class="critica-segunda-opiniao">⚠ segunda opinião: ${esc(critica)}</p>` : ''}
       <div class="acoes">
         <button class="btn-primario" data-d="aprovar">Executar</button>
         <button class="btn-secundario" data-d="negar">Recusar</button>
         ${permiteSempre === false ? '' : '<button class="btn-secundario" data-d="sempre">Sempre permitir</button>'}
       </div>`
    );
    // Pedido de Davi 2026-09-18 (plano das "2 IAs em paralelo"): o cartão
    // agora aparece SEM esperar a segunda opinião terminar — ela chega
    // depois, se der tempo, pelo evento 'aprovacao-critica' (ver
    // manipuladores['aprovacao-critica'] abaixo). O `data-id` é como aquele
    // handler encontra ESTE cartão específico pra anexar o texto.
    card.dataset.id = id;
    card.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', async () => {
        await api.agent.respond(id, b.dataset.d);
        card.classList.add('resolvido');
        card.querySelector('.acoes').innerHTML = `<span class="secundario">${
          b.dataset.d === 'negar' ? 'recusado' : 'autorizado'
        } · ${esc(nome)}</span>`;
        if (b.dataset.d === 'sempre') carregarConfig();
      })
    );
    rolar(el.aRolagem, true);
  },

  // Chega depois do cartão de aprovação, só quando a segunda opinião
  // (segundaOpiniao, em paralelo com o cartão desde o início) responde ANTES
  // de o usuário decidir — se o cartão já foi resolvido ('.resolvido') ou
  // nem existe mais na tela, não há mais nada pra anexar, ignora.
  'aprovacao-critica'({ id, critica }) {
    const card = el.aRolagem.querySelector(`.cartao.aprovacao[data-id="${id}"]`);
    if (!card || card.classList.contains('resolvido') || card.querySelector('.critica-segunda-opiniao')) return;
    const p = document.createElement('p');
    p.className = 'critica-segunda-opiniao';
    p.textContent = `⚠ segunda opinião: ${critica}`;
    card.querySelector('.secundario').after(p);
  },

  pergunta({ id, pergunta }) {
    abrirDetalhe();
    situacao('o agente fez uma pergunta');
    const card = cartao(
      agente.turno?.noAtual || noSolto(),
      'pergunta',
      'o agente perguntou',
      `<p>${esc(pergunta)}</p>
       <div class="resposta-campo"><input type="text" placeholder="Sua resposta" /><button class="btn-primario">Responder</button></div>`
    );
    const input = card.querySelector('input');
    const enviar = async () => {
      const valor = input.value.trim();
      if (!valor) return;
      await api.agent.respond(id, valor);
      card.classList.add('resolvido');
      card.querySelector('.resposta-campo').innerHTML = `<span class="secundario">você: ${esc(valor)}</span>`;
    };
    card.querySelector('button').addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && enviar());
    input.focus();
    rolar(el.aRolagem, true);
  },

  resultado({ n, nome, saida, erro, duracao }) {
    const texto = erro || saida || '(sem saída)';
    const card = cartao(
      no(n),
      `saida${erro ? ' falha' : ''}`,
      erro ? `falhou · ${esc(nome)}` : `resultado · ${esc(nome)}`,
      `<pre>${esc(texto)}</pre>`,
      ms(duracao)
    );
    if (texto.length > 900) {
      const btn = document.createElement('button');
      btn.className = 'expandir';
      btn.textContent = 'mostrar tudo';
      btn.addEventListener('click', () => {
        card.classList.toggle('aberto');
        btn.textContent = card.classList.contains('aberto') ? 'recolher' : 'mostrar tudo';
      });
      card.appendChild(btn);
    }

    const pendente = agente.turno?.chamadasDeArquivo[n];
    if (pendente && !erro) {
      const caminho = caminhoCriadoDaSaida(saida) || pendente.argumentos?.caminho;
      if (caminho) agente.turno.arquivosGerados.push({ caminho, tamanho: tamanhoDaSaida(saida) });
    }

    carregarMemoria();
    // consultar_critico pode ter acabado de carregar o modelo dedicado do
    // Copiloto — atualiza o indicador na hora, sem esperar o polling de 20s.
    if (nome === 'consultar_critico') carregarStatusCopiloto();
  },

  skills({ etapa, nomes }) {
    const t = agente.turno;
    if (!t || !nomes.length) return;
    t.skillsVistas = t.skillsVistas || new Set();
    const novas = nomes.filter((n) => !t.skillsVistas.has(`${etapa}:${n}`));
    novas.forEach((n) => t.skillsVistas.add(`${etapa}:${n}`));
    if (!novas.length) return;

    let faixa = t.caixa.querySelector('.skills-ativas');
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.className = 'skills-ativas';
      faixa.innerHTML = '<span class="rotulo-skill">skills</span>';
      t.ancora.before(faixa);
    }
    for (const nome of novas) {
      const selo = document.createElement('span');
      selo.className = 'selo-skill';
      selo.textContent = nome;
      selo.title = `Ativada na etapa de ${etapa}`;
      faixa.appendChild(selo);
    }
  },

  cobertura({ nivel, encontrados, total, ausentes }) {
    const t = agente.turno;
    if (!t || nivel === 'boa') return;
    const faixa = document.createElement('div');
    faixa.className = `cobertura ${nivel}`;
    faixa.innerHTML =
      nivel === 'ausente'
        ? '<b>a busca não trouxe material sobre isto</b> — respondendo com conhecimento próprio do modelo'
        : `<b>material cobre parte do pedido</b> (${encontrados} de ${total} termos)${
            ausentes?.length ? ` — sem cobertura: ${esc(ausentes.slice(0, 4).join(', '))}` : ''
          }`;
    t.resposta.before(faixa);
  },

  redigindo({ fontes }) {
    const t = agente.turno;
    if (!t) return;
    situacao(`redigindo a resposta a partir de ${fontes} fonte(s)…`);
    t.detalhe.open = false;
    t.resposta.hidden = false;
    t.buffer = '';
    t.resposta.classList.remove('provisoria');
    t.resposta.innerHTML = '<span class="cursor"></span>';
    rolar(el.aRolagem, true);
  },

  'resposta-token'({ pedaco }) {
    const t = agente.turno;
    if (!t) return;
    t.buffer = (t.buffer || '') + pedaco;
    t.resposta.classList.remove('provisoria'); // o texto de verdade substitui o resultado parcial
    t.resposta.innerHTML = `${window.md.render(t.buffer)}<span class="cursor"></span>`;
    rolar(el.aRolagem);
  },

  // Caso real (Davi, 2026-09-18): o sistema de verificação pós-resposta
  // (verificador.verificar/reescrever, src/agent/loop.js) pode descartar e
  // reescrever a resposta uma ou mais vezes antes de aceitar o resultado
  // final — sempre existiu, mas o evento não vinha com NENHUMA explicação,
  // então pro usuário parecia um glitch ("para de escrever, apaga tudo e
  // começa de novo") em vez de um comportamento intencional. `motivo` (novo,
  // opcional) deixa isso visível: mantém o cursor piscando mas mostra POR QUE
  // está reescrevendo, na mesma barra de situação usada pelo resto do fluxo.
  'resposta-reinicia'({ motivo } = {}) {
    const t = agente.turno;
    if (!t) return;
    t.buffer = '';
    t.resposta.innerHTML = motivo
      ? `<p class="secundario resposta-revisao"><span class="cursor"></span> ${esc(motivo)}</p>`
      : '<span class="cursor"></span>';
    if (motivo) situacao(motivo);
  },

  fonte({ tipo, provedor, url, falhas }) {
    if (url) agente.fontes.add(url);
    const alvo = agente.turno?.noAtual;
    if (!alvo) return;
    let caixa = alvo.querySelector('.fontes');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'fontes';
      alvo.appendChild(caixa);
    }
    const span = document.createElement('span');
    span.className = 'fonte-selo';
    span.textContent = tipo === 'busca' ? `busca: ${provedor}` : `leitura: ${provedor}`;
    span.title = url || (falhas?.length ? `reservas acionadas — ${falhas.join(' | ')}` : '');
    caixa.appendChild(span);
  },

  negado({ n, nome }) {
    cartao(no(n), 'aviso', 'recusado', `<p class="secundario">${esc(nome)} não foi executado.</p>`);
  },

  'protocolo-invalido'({ estado, motivo, bruto }) {
    const rotulos = {
      'json-invalido': 'JSON inválido',
      'protocolo-invalido': 'fora do protocolo',
      'ferramenta-invalida': 'ferramenta inexistente',
      'argumentos-invalidos': 'argumentos incompletos',
    };
    cartao(
      agente.turno?.noAtual || noSolto(),
      'aviso tecnico', // escondido fora do modo "detalhes técnicos" (ver aplicarPreferenciasDeTela)
      rotulos[estado] || 'resposta fora do protocolo',
      `<p class="secundario">${esc(motivo || '')}</p>${
        bruto ? `<pre class="secundario">${esc(bruto.slice(0, 300))}</pre>` : ''
      }`
    );
  },

  'protocolo-recuperado'({ via, ferramenta }) {
    const alvo = agente.turno?.noAtual;
    if (!alvo) return;
    const selo = document.createElement('span');
    selo.className = 'fonte-selo tecnico';
    selo.textContent = `recuperado: ${via}`;
    selo.title = `A decisão veio mal formada e foi convertida em ${ferramenta} sem gastar uma rodada`;
    let caixa = alvo.querySelector('.fontes');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'fontes';
      alvo.appendChild(caixa);
    }
    caixa.appendChild(selo);
  },

  compactado({ n, mensagens }) {
    cartao(no(n), 'aviso tecnico', 'contexto compactado', `<p class="secundario">${mensagens} mensagens viraram resumo.</p>`);
  },

  aviso({ texto }) {
    // o mesmo aviso pode disparar a cada passo; mostrar uma vez por turno basta
    const t = agente.turno;
    if (!t) return;
    t.avisos = t.avisos || new Set();
    const chave = texto.slice(0, 60);
    if (t.avisos.has(chave)) return;
    t.avisos.add(chave);

    const dica = /nomic-embed-text/.test(texto)
      ? '<p class="secundario">Rode <code>ollama pull nomic-embed-text</code> para ativar a memória vetorial.</p>'
      : '';
    cartao(noSolto(), 'aviso', 'aviso', `<p class="secundario">${esc(texto)}</p>${dica}`);
  },

  // Controlador v2: avisos técnicos curtos (uma vez por turno, como aviso)
  'limite-atingido'({ iteracoes }) {
    manipuladores.aviso({ texto: `Chegou ao limite de ${iteracoes || ''} passos — a resposta vem com o que foi reunido até aqui.`.replace('de  passos', 'de passos') });
  },
  'contexto-saturado'() {
    manipuladores.aviso({ texto: 'O histórico encheu a janela de contexto do modelo; partes antigas foram cortadas. Se as respostas piorarem, aumente o contexto em Ajustes.' });
  },
  'contexto-ajustado'() {},
  // Revisão v4: download do navegador dentro da pasta de trabalho vira anexo
  // (mesmo cartão dos arquivos gerados); fora dela, só o aviso com o caminho
  'arquivo-criado'({ relativo, bytes }) {
    const t = agente.turno;
    if (t && relativo) t.arquivosGerados.push({ caminho: relativo, tamanho: bytes || null });
  },
  'investigacao-plano'({ subtemas = [], minutos, lacunas }) {
    situacao(lacunas ? `investigação: mais ${subtemas.length} partes para cobrir o que faltou` : `investigação de ${minutos} min: ${subtemas.length} partes planejadas`);
  },
  'investigacao-progresso'({ parte, previstas, titulo, restanteS }) {
    situacao(`investigando parte ${parte} de ~${previstas}: ${titulo} · faltam ${Math.max(1, Math.round(restanteS / 60))} min`);
  },
  'investigacao-secao'() {},

  'download-concluido'({ nome, caminho, relativo, bytes }) {
    const t = agente.turno;
    if (t && relativo) t.arquivosGerados.push({ caminho: relativo, tamanho: bytes || null });
    else manipuladores.aviso({ texto: `Arquivo baixado pelo navegador: ${nome}${caminho ? ` — salvo em ${caminho}` : ''}` });
  },
  'critica-por-evento'() {},

  uso({ prompt, completion }) {
    el.tokens.textContent = (prompt + completion).toLocaleString('pt-BR');
  },

  // Item 2 da análise comparativa (2026-09-21, "indicador de uso de
  // contexto"): percentual real do último passo, não acumulado (ver
  // comentário em src/agent/loop.js sobre a diferença com o evento 'uso').
  'janela-contexto'({ percentual }) {
    el.contexto.textContent = percentual == null ? '—' : `${percentual}%`;
  },

  concluido({ resumo, iteracoes }) {
    const t = agente.turno;
    encerrarTurno();
    agente.conversa.push({ role: 'assistant', content: resumo });
    salvarConversa('agente');
    if (!t) return;
    t.resposta.hidden = false;
    t.resposta.classList.remove('provisoria');
    t.resposta.innerHTML = window.md.render(resumo); // troca o texto em streaming pelo definitivo
    window.md.montarGraficos(t.resposta);
    // Painel "Arquivos" da lateral direita (fase 2 da reforma visual) —
    // mesmos dados do cartão de anexo abaixo, só que acumulados pela
    // conversa inteira em vez de só este turno.
    t.arquivosGerados.forEach((a) => adicionarSaida({ caminho: a.caminho, tamanho: a.tamanho, tipo: 'gerado' }));
    if (t.arquivosGerados.length) renderizarAnexosGerados(t.resposta, t.arquivosGerados);
    if (agente.fontes.size) {
      const rodape = document.createElement('p');
      rodape.className = 'secundario meta-turno';
      rodape.textContent = `${iteracoes} passos · ${agente.fontes.size} fonte(s)`;
      t.resposta.appendChild(rodape);
    }
    carregarArvore(true);
    carregarMemoria();
    rolar(el.aRolagem, true);
  },

  limite({ iteracoes }) {
    const t = agente.turno;
    encerrarTurno();
    agente.conversa.push({ role: 'assistant', content: `_(parou em ${iteracoes} passos sem concluir)_` });
    salvarConversa('agente');
    if (!t) return;
    t.resposta.hidden = false;
    t.resposta.innerHTML = `<p>Parei em ${iteracoes} passos sem concluir.</p><p class="secundario">Aumente o limite em Ajustes ou peça algo mais específico.</p>`;
    t.arquivosGerados.forEach((a) => adicionarSaida({ caminho: a.caminho, tamanho: a.tamanho, tipo: 'gerado' }));
    if (t.arquivosGerados.length) renderizarAnexosGerados(t.resposta, t.arquivosGerados);
  },

  interrompido({ iteracoes }) {
    const t = agente.turno;
    encerrarTurno();
    if (!t) return;
    t.resposta.hidden = false;
    t.resposta.innerHTML = `<p class="secundario">Interrompido por você após ${iteracoes} passos.</p>`;
    t.arquivosGerados.forEach((a) => adicionarSaida({ caminho: a.caminho, tamanho: a.tamanho, tipo: 'gerado' }));
    if (t.arquivosGerados.length) renderizarAnexosGerados(t.resposta, t.arquivosGerados);
  },

  erro({ mensagem, amigavel }) {
    const t = agente.turno;
    encerrarTurno();
    if (!t) {
      criarTurno('—');
      encerrarTurno();
    }
    const alvo = agente.turno;
    alvo.resposta.hidden = false;
    alvo.caixa.classList.add('erro');
    // Fase 2 (facilidade de uso): quando o processo principal reconhece o
    // erro (src/primeiro-uso.js, mensagemAmigavel), mostra a frase que diz o
    // que fazer e deixa o texto técnico original logo abaixo, menor.
    alvo.resposta.textContent = amigavel || mensagem;
    if (amigavel && mensagem && amigavel !== mensagem) {
      const detalhe = document.createElement('div');
      detalhe.className = 'erro-detalhe';
      detalhe.textContent = `detalhe técnico: ${mensagem}`;
      alvo.resposta.appendChild(detalhe);
    }
    if (/Ollama|modelo/i.test(amigavel || mensagem || '')) atualizarPrimeiroUso();
    rolar(el.aRolagem, true);
  },

  lacunas({ nivel, encontrados, total, ausentes }) {
    const t = agente.turno;
    if (!t) return;
    situacao(
      nivel === 'boa'
        ? `material suficiente (${encontrados}/${total} termos cobertos)`
        : `faltam dados: ${(ausentes || []).slice(0, 3).join(', ')}`
    );
  },

  // Lista de tarefas com estado (ver reconciliarChecklist em loop.js). Além
  // do resumo compacto na linha de situação (já existia), agora também
  // alimenta o painel "Progresso" da lateral direita (fase 2 da reforma
  // visual) — pintarProgresso() lê agente.checklist.
  checklist(lista) {
    const t = agente.turno;
    if (!t || !Array.isArray(lista) || !lista.length) return;
    agente.checklist = lista;
    pintarProgresso();
    const feitos = lista.filter((i) => i.status === 'feito').length;
    const pendentes = lista.filter((i) => i.status === 'pendente').map((i) => i.texto);
    situacao(
      `plano: ${feitos}/${lista.length} concluído(s)` +
        (pendentes.length ? ` · a fazer: ${pendentes.slice(0, 2).join(', ')}` : '')
    );
  },

  // Entendimento (pedido de Davi 2026-09-14, "apertar as rédeas": mostrar
  // que o agente entendeu o pedido antes de agir) — só dispara quando
  // verificarAmbiguidade de fato reescreveu o objetivo resolvendo uma
  // referência à conversa anterior ("faz de novo aquilo", ver o comentário
  // em loop.js/run()); num pedido novo e autossuficiente não há nada pra
  // mostrar aqui, e o cartão não aparece — menos ruído, não mais.
  // Modo AUTO (10/10): qual nível o pedido ganhou, logo no começo
  'nivel-auto'({ nivel, nome, motivo }) {
    cartao(noSolto(), 'entendimento', `modo auto · nível ${nivel}`, `<p><b>${esc(nome || '')}</b> — ${esc(motivo || '')}</p>`);
  },
  'auto-correcao'({ fato, de, para }) {
    cartao(noSolto(), 'entendimento', 'número conferido', `<p>${esc(fato)}: ${esc(de)} → <b>${esc(para)}</b> (pela ficha da Wikipédia)</p>`);
  },

  'objetivo-reescrito'({ reescrito }) {
    cartao(noSolto(), 'entendimento', 'entendi que você quer', `<p>${esc(reescrito)}</p>`);
  },

  // Subagente crítico (crítica periódica do plano, ver criticaDoPlano em
  // loop.js) OU um dos 4 checkpoints automáticos do Copiloto (ver
  // criticaAutomatica — `fase` distingue qual: entendimento/plano-inicial,
  // antes de qualquer passo numerado, viram cartão avulso; parte-concluida/
  // pre-redacao, e a crítica periódica de sempre sem `fase` nenhuma, ficam
  // presas ao passo em que dispararam) — questiona o rumo geral, não uma
  // ação específica; some da situação e vira um cartão, pra ficar claro que
  // é uma observação de fora do que decidiu.
  'critica-plano'({ n, texto, fase }) {
    situacao(`revisão do plano: ${texto.slice(0, 90)}`);
    const rotulo = ROTULO_FASE_CRITICA[fase] || 'crítica ao plano';
    const pai = fase === 'entendimento' || fase === 'plano-inicial' ? noSolto() : no(n);
    cartao(pai, 'critica-plano', rotulo, `<p>${esc(texto)}</p>`);
    // `fase` só vem preenchida nos checkpoints automáticos (criticaAutomatica
    // em loop.js) — atualiza o contador do badge na hora, mesmo padrão já
    // usado pra 'consultar_critico' em manipuladores.resultado, acima.
    if (fase) carregarStatusCopiloto();
  },

  // Criação automática de skills (item 5) — dispara em segundo plano, pode
  // chegar bem depois do turno que a motivou já ter terminado. Um cartão
  // avulso (não preso a um passo numerado) avisa; a revisão de verdade
  // acontece na aba Skills → Sugestões, nunca sozinha.
  'skill-sugerida'(dados) {
    const passou = dados?.autoteste?.passou;
    cartao(
      noSolto(),
      'skill-sugerida',
      'skill sugerida',
      `<p>O agente notou um pedido repetido sem skill cobrindo e propôs <b>${esc(dados?.nome || dados?.rascunho?.nome || 'uma skill nova')}</b> — ${
        passou ? 'passou no autoteste que ele mesmo rodou' : 'NÃO passou no autoteste que ele mesmo rodou'
      }. Revise em Skills → Sugestões antes de qualquer coisa entrar em uso.</p>`
    );
    if (!$('painelSugestoes').hidden) carregarSugestoes();
  },

  // Progresso da instalação do SearXNG embutido (ver aba Ajustes) — atualiza
  // só o texto de status; não é um evento do agente, mas passa pelo mesmo
  // canal genérico já usado por todos os outros eventos.
  'runtime-searxng-progresso'({ fase }) {
    const alvo = $('sxStatus');
    if (alvo) alvo.textContent = FASES_SX_EMBUTIDO[fase] || fase;
  },

  // Oferta de início automático do Ollama — dispara quando uma checagem de
  // saúde (início ou o polling de 20s) detecta o Ollama desligado com o
  // binário instalado (ver ipcMain.handle('ollama:health', ...),
  // electron/main.js). Mesmo canal genérico de sempre, evento avulso, não
  // preso a nenhuma execução do agente.
  'ollama-oferecer-inicio'() {
    mostrarFaixaOllama();
  },

  // Progresso do download de um modelo (ollama.pullModel) — mesmo padrão do
  // progresso do SearXNG embutido acima, formato de linha diferente
  // ({status, total, completed}).
  'imagem-progresso'({ texto }) {
    if (texto) $('compImgStatus').textContent = texto;
  },

  'tesseract-progresso'({ texto }) {
    if (texto) $('compOcrStatus').textContent = texto;
  },

  'ytdlp-progresso'({ texto }) {
    if (texto) $('compYtStatus').textContent = texto;
  },

  'ollama-instalacao-progresso'({ texto }) {
    if (texto) $('compOllamaStatus').textContent = texto;
  },

  'ollama-pull-progresso'(dados) {
    if (primeiroUso.baixando) pintarProgressoPrimeiroUso(dados);
    else pintarProgressoBaixarModelo(dados);
  },

  'fonte-marcada'({ url, risco, motivo }) {
    const alvo = agente.turno?.noAtual;
    if (!alvo) return;
    let caixa = alvo.querySelector('.fontes');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'fontes';
      alvo.appendChild(caixa);
    }
    const selo = document.createElement('span');
    selo.className = `fonte-selo alerta${risco === 'satira' ? ' satira' : ''}`;
    selo.textContent = risco === 'satira' ? 'sátira' : 'fonte de baixa credibilidade';
    selo.title = `${motivo} — ${url}`;
    caixa.appendChild(selo);
  },

  confianca({ nivel, motivos }) {
    const t = agente.turno;
    if (!t) return;
    const faixa = document.createElement('div');
    faixa.className = `confianca ${nivel === 'alta' ? 'alta' : nivel === 'média' ? 'media' : 'baixa'}`;
    faixa.innerHTML = `<b>confiança ${esc(nivel)}</b>${
      motivos.length ? ` — ${esc(motivos.join('; '))}` : ' — material cobre o pedido e há corroboração entre fontes'
    }`;
    t.resposta.appendChild(faixa);
  },

  confronto(c) {
    const t = agente.turno;
    if (!t || !c.suficiente) return;
    const faixa = document.createElement('div');
    faixa.className = `verificacao ${c.divergencias.length ? 'alerta' : 'ok'}`;
    const partes = [`<b>${c.dominios}</b> fontes cruzadas · ${c.confirmados.length} dado(s) confirmado(s) por mais de uma`];
    for (const d of c.divergencias.slice(0, 3)) {
      partes.push(
        `divergência em ${esc(d.unidade)}: <code>${esc(d.a.texto)}</code> em ${d.a.dominios.length} fontes, ` +
          `<code>${esc(d.b.texto)}</code> em ${esc(d.b.dominios[0])}`
      );
    }
    faixa.innerHTML = `${partes.join(' · ')}<span class="verif-nota">confronto entre fontes</span>`;
    t.resposta.appendChild(faixa);
  },

  verificacao(v) {
    const t = agente.turno;
    if (!t) return;
    t.caixa.querySelector('.verificacao')?.remove();
    if (v.aprovado || v.semMaterial) return;

    const faixa = document.createElement('div');
    faixa.className = `verificacao ${v.totalSuspeitas ? 'alerta' : 'ok'}`;
    const partes = [];
    if (!v.respondeAoPedido) partes.push('a resposta pode não tratar do que foi perguntado');
    if (v.totalSuspeitas) {
      partes.push(
        `<b>${v.totalSuspeitas} de ${v.totalAfirmacoes}</b> valores não foram encontrados nas fontes: ` +
          v.suspeitas.map((sp) => `<code>${esc(sp.valor)}</code>`).join(' ')
      );
    }
    faixa.innerHTML = `${partes.join(' · ')}<span class="verif-nota">verificação automática — confira antes de usar</span>`;
    t.resposta.appendChild(faixa);
  },

  registro({ id, resumo }) {
    const t = agente.turno;
    if (!t) return;
    const linha = document.createElement('div');
    linha.className = 'resumo-execucao';
    linha.innerHTML = `
      <span>${resumo.passos} passos · ${resumo.ferramentas} ferramentas · ${resumo.fontes} fontes · ${(
      resumo.duracaoMs / 1000
    ).toFixed(1)}s · ${resumo.tokens.toLocaleString('pt-BR')} tokens${
      resumo.erros ? ` · <b class="ruim">${resumo.erros} erros</b>` : ''
    }</span>
      <button class="btn-linha">relatório</button>`;
    linha.querySelector('button').addEventListener('click', () => {
      trocarAba('execucoes');
      abrirRelatorio(id);
    });
    t.resposta.appendChild(linha);
  },

  // Motor de pesquisa (src/agent/motor-pesquisa.js, 2026-09-24): em pedido
  // de recomendação/comparação, o plano de pesquisa, as opções encontradas e
  // a matriz opção × critério viram cartões na trilha — é o "porquê" da
  // comparação, visível antes da resposta chegar.
  // Cadeia do uso (2026-09-28): do pedido até o que decide, e os critérios com o porquê
  'pesquisa-cadeia'({ atividade = '', tipoDeUso = '', exige = [] }) {
    situacao('pesquisa planejada: pensando no uso antes de buscar');
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'raciocínio do uso',
      `<p class="pp-nota">${esc(atividade)} → ${esc(tipoDeUso)}</p>${
        exige.length ? `<ul class="pp-lista">${exige.map((x) => `<li>${esc(x.o)}${x.porque ? ` — ${esc(x.porque)}` : ''}</li>`).join('')}</ul>` : ''
      }`
    );
  },

  'pesquisa-criterios'({ tipoDeUso = '', criterios = [], fontes = [] }) {
    cartao(
      noSolto(),
      'pesquisa-planejada',
      `o que decide em ${tipoDeUso || 'este uso'}`,
      `<ul class="pp-lista">${criterios
        .map((k) => `<li><strong>${esc(k.nome)}</strong> (${esc(k.peso)})${k.porque ? ` — ${esc(k.porque)}` : ''}</li>`)
        .join('')}</ul>${fontes.length ? `<p class="pp-nota">de: ${esc(fontes.join(', '))}</p>` : ''}`
    );
  },

  // Fase B da pesquisa pela comunidade: o que o agente pensou antes de
  // pesquisar, e depois o que o material disse de cada hipótese
  'pesquisa-mapa'({ decide = [], elimina = [], alternativas = [], hipoteses = [] }) {
    situacao('pesquisa planejada: pensando no problema antes de buscar');
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'mapa do problema',
      `${decide.length ? `<p class="pp-nota">o que decide: ${esc(decide.map((d) => d.fator).join(', '))}</p>` : ''}${
        elimina.length ? `<p class="pp-nota">o uso não tolera: ${esc(elimina.map((d) => d.fator).join('; '))}</p>` : ''
      }${
        hipoteses.length ? `<p>hipóteses a conferir:</p><ul class="pp-lista">${hipoteses.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''
      }${alternativas.length ? `<p class="pp-nota">alternativas a considerar: ${esc(alternativas.map((a) => a.nome).join('; '))}</p>` : ''}`
    );
  },

  // Evidência → Dados → Análise (2026-09-27): o que o código extraiu e calculou
  'serie-de-precos'({ produtos = [], observacoes = 0, moeda = null, meses = [], medias = [], grafico = false }) {
    const moedaTxt = moeda === 'BRL' ? 'R$' : moeda === 'USD' ? 'US$' : '';
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'série de preços (calculada pelo código)',
      observacoes && meses.length
        ? `<p class="pp-nota">${esc(String(observacoes))} preço(s) com data em ${esc(String(meses.length))} mês(es) · ${esc(produtos.join(', '))}${grafico ? ' · gráfico montado' : ''}</p><ul class="pp-lista">${medias
            .map((m) => `<li>${esc(m.produto)}: ${m.n ? `média ${esc(moedaTxt)} ${esc(Number(m.media).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))} (${esc(String(m.n))} obs.)` : 'sem preço datado'}</li>`)
            .join('')}</ul>`
        : '<p class="pp-nota">nenhum preço com data encontrado nas páginas lidas</p>'
    );
  },

  'contrato-incompleto'({ itens = [] }) {
    cartao(noSolto(), 'pesquisa-planejada', 'o que ficou faltando', `<ul class="pp-lista">${itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  },

  'pesquisa-hipoteses'({ hipoteses = [] }) {
    const marca = { confirmada: '✓ confirmada', derrubada: '✗ derrubada', 'sem dados': '? sem dados' };
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'hipóteses conferidas',
      `<ul class="pp-lista">${hipoteses
        .map((h) => `<li>${esc(h.hipotese)} <span class="pp-peso">${esc(marca[h.veredito] || h.veredito)}</span></li>`)
        .join('')}</ul>`
    );
  },

  'pesquisa-plano'({ uso, criterios = [], opcoesCitadas = [] }) {
    situacao('pesquisa planejada: critérios definidos, buscando as opções');
    const lista = criterios
      .map((c) => `<li>${esc(c.nome)} <span class="pp-peso">${c.peso === 'alto' ? 'peso alto' : c.peso === 'baixo' ? 'peso baixo' : 'peso médio'}</span></li>`)
      .join('');
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'plano de pesquisa',
      `<p>${esc(uso)}</p><ul class="pp-lista">${lista}</ul>${
        opcoesCitadas.length ? `<p class="pp-nota">opções citadas por você: ${esc(opcoesCitadas.join(', '))}</p>` : ''
      }`
    );
  },

  'pesquisa-candidatos'({ finalistas = [], outros = [], descartados = 0 }) {
    // Fase C: quantas conversas da comunidade recomendam, e por quê
    const contagem = (f) =>
      `${f.topicos ? `${f.topicos} tópico${f.topicos === 1 ? '' : 's'} · ` : ''}${f.sites} site${f.sites === 1 ? '' : 's'}`;
    const html = finalistas.length
      ? `<ul class="pp-lista">${finalistas
          .map(
            (f) =>
              `<li>${esc(f.nome)} <span class="pp-peso">${contagem(f)}</span>${
                f.motivo ? `<br><span class="pp-nota">“${esc(f.motivo.slice(0, 140))}”</span>` : ''
              }</li>`
          )
          .join('')}</ul>${outros.length ? `<p class="pp-nota">também citadas: ${esc(outros.join(', '))}</p>` : ''}${
          descartados ? `<p class="pp-nota tecnico">${descartados} nome(s) sugerido(s) pelo modelo não estavam no material e foram descartados</p>` : ''
        }`
      : '<p>o material não apontou opções concretas o bastante para comparar</p>';
    cartao(noSolto(), 'pesquisa-planejada', 'opções encontradas', html);

    // Resultado parcial (11/10): a descoberta termina na metade da pesquisa —
    // os minutos seguintes são ficha e opinião de cada opção. Em vez de só
    // "pesquisando…", a resposta já mostra quem está na disputa; o texto
    // final substitui este bloco quando chega (ver 'resposta-token').
    const t = agente.turno;
    if (t && finalistas.length && !t.buffer) {
      const linhas = ['*Resultado parcial — ainda estou lendo a ficha técnica e a opinião de quem usa cada opção. A ordem pode mudar.*', '', '### Opções encontradas até agora'];
      finalistas.forEach((f, i) => {
        linhas.push('', `#### ${i + 1}. ${f.nome}`, `**Até agora:** ${contagem(f)}.`);
        if (f.motivo) linhas.push(`> "${f.motivo.slice(0, 200).replace(/\n/g, ' ')}"`);
      });
      t.resposta.hidden = false;
      t.resposta.classList.add('provisoria');
      t.resposta.innerHTML = window.md.render(linhas.join('\n'));
    }
  },

  'pesquisa-matriz'({ cobertura = 0, buscas = 0, lacunas = [], descartadas = [], resumos = [] }) {
    situacao(`pesquisa planejada: ${Math.round(cobertura * 100)}% da comparação com evidência`);
    const faltas = lacunas.slice(0, 4).map((l) => `${l.criterio} de ${l.candidato}`);
    cartao(
      noSolto(),
      'pesquisa-planejada',
      'comparação montada',
      `<p><b>${Math.round(cobertura * 100)}%</b> das combinações opção × critério têm evidência · ${buscas} busca(s)</p>${
        faltas.length ? `<p class="pp-nota">sem evidência: ${esc(faltas.join('; '))}${lacunas.length > 4 ? '…' : ''}</p>` : ''
      }${
        // julgamento das células (motor-pesquisa.js): trecho que citava a opção mas não falava daquele critério
        descartadas.length ? `<p class="pp-nota tecnico">${descartadas.length} trecho(s) descartado(s) por não falar da opção naquele critério</p>` : ''
      }${
        // pesquisa por produto: de quais opções achou ficha técnica e opinião da comunidade
        resumos.length
          ? `<p class="pp-nota">${resumos
              .map((r) => `${esc(r.opcao)}: ficha ${r.ficha ? '✓' : '—'} · comunidade ${r.comunidade ? '✓' : '—'}`)
              .join('<br>')}</p>`
          : ''
      }`
    );
  },

  'workspace-changed'() {
    carregarArvore(true);
  },

  'config-alterada'() {
    carregarConfig();
  },

  'agendamento-pulado'({ texto }) {
    situacao(`rotina automática pulada (agente ocupado): ${texto.slice(0, 60)}`);
  },
};

/* ---------------- painel "Atividade do agente" (13/10) ----------------
 * Linha do tempo das etapas e dos sites lidos, montada SÓ com os eventos que o
 * agente já emite — nada aqui é estimado ou inventado. Uma etapa aparece
 * quando começa; a anterior ganha o ✓. Fica aberto durante a execução e
 * recolhe quando a resposta chega.
 * ponytail: página que falhou ao ler não aparece (a ferramenta só avisa a
 * leitura que deu certo); emitir 'fonte' com erro em src/tools/web.js se fizer falta.
 */
const hora = () => new Date().toLocaleTimeString('pt-BR');
const FERRAMENTAS_DE_PESQUISA = /^(pesquisar|ler_pagina|buscar|navegar|comparar_precos)/;

function etapaDaAtividade(chave, titulo, descricao = '') {
  const t = agente.turno;
  if (!t) return;
  const painel = t.caixa.querySelector('.atividade');
  const lista = painel.querySelector('.atividade-etapas');
  let atual = lista.lastElementChild;
  if (!atual || atual.dataset.chave !== chave) {
    atual?.classList.replace('atual', 'feita');
    atual = document.createElement('li');
    atual.className = 'atual';
    atual.dataset.chave = chave;
    atual.innerHTML = '<i class="marca"></i><div><b></b><p></p><time></time></div>';
    atual.querySelector('b').textContent = titulo;
    atual.querySelector('time').textContent = hora();
    lista.appendChild(atual);
    painel.hidden = false;
  }
  if (descricao) atual.querySelector('p').textContent = String(descricao).slice(0, 160);
  resumoDaAtividade();
  // a esfera: a etapa nova acende, a anterior conta como concluída (dispara um pulso)
  const T = t.esferaT;
  if (T) {
    const ult = T.steps[T.steps.length - 1];
    if (!ult || ult.id !== chave) {
      if (ult && ult.s === 'act') ult.s = 'ok';
      T.steps.push({ id: chave, t: titulo, d: String(descricao || '').slice(0, 160), s: 'act' });
      T.total = Math.max(T.total, T.steps.length + 1);
    } else if (descricao) ult.d = String(descricao).slice(0, 160);
    // a legenda: o que o agente pensou ou, sem isso (o modelo pequeno quase não escreve), o que ele está fazendo
    if (!T.pensou) T.lastThought = descricao ? `${titulo}: ${String(descricao).slice(0, 150)}` : titulo;
    t.esfera?.kick();
  }
}

function resumoDaAtividade() {
  const t = agente.turno;
  if (!t) return;
  const a = (t.contagem = t.contagem || { buscas: 0, sites: new Map() });
  const paginas = [...a.sites.values()].reduce((s, x) => s + x.paginas, 0);
  const partes = [];
  if (a.buscas) partes.push(`${a.buscas} busca${a.buscas === 1 ? '' : 's'}`);
  if (a.resultados) partes.push(`${a.resultados} resultado${a.resultados === 1 ? "" : "s"} vistos`);
  if (paginas) partes.push(`${paginas} página${paginas === 1 ? '' : 's'} em ${a.sites.size} site${a.sites.size === 1 ? '' : 's'}`);
  t.caixa.querySelector('.atividade-resumo').textContent = partes.length ? `· ${partes.join(' · ')}` : '';
}

function siteConsultado(url) {
  const t = agente.turno;
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return; // documento local, não é site
  }
  if (!t || !host) return;
  const a = (t.contagem = t.contagem || { buscas: 0, sites: new Map() });
  let site = a.sites.get(host);
  if (!site) {
    const linha = document.createElement('a');
    linha.className = 'atividade-site';
    linha.target = '_blank';
    linha.innerHTML = '<i></i><span class="nome"></span><span class="qtd"></span>';
    linha.querySelector('i').textContent = host[0].toUpperCase();
    linha.querySelector('.nome').textContent = host;
    t.caixa.querySelector('.atividade-lista').appendChild(linha);
    t.caixa.querySelector('.atividade-sites').hidden = false;
    site = { paginas: 0, linha };
    a.sites.set(host, site);
  }
  site.paginas += 1;
  site.linha.href = url; // abre a última página lida daquele site
  site.linha.title = url;
  site.linha.querySelector('.qtd').textContent = `${site.paginas} página${site.paginas === 1 ? '' : 's'} ✓`;
  // a esfera: cada site lido vira um nó com anel e etiqueta
  const T = t?.esferaT;
  if (T && host && !T.sites.includes(host)) {
    T.sites.push(host);
    T.sa.push(Math.max(0, T.steps.length - 1));
    T.sat.push(Date.now() - T.t0);
    t.esfera?.kick();
  }
}

// o padrão da esfera pelo hardware, calculado na primeira abertura (main.js)
function esferaPadraoCalculado(d) {
  if (!d?.modo) return;
  config.esferaModoPadrao = d.modo;
  window.Esfera?.padrao(d.modo);
  if ($('cfgEsferaModo') && window.Esfera) $('cfgEsferaModo').value = window.Esfera.modo();
}

function atividade(canal, d) {
  if (canal === 'config-alterada-esfera') return esferaPadraoCalculado(d);
  const t = agente.turno;
  if (!t) return;
  // a esfera: o que o agente está pensando vira a frase embaixo dela
  if (canal === 'raciocinio' && d.pensamento && t.esferaT) {
    const frase = String(d.pensamento).replace(/\s+/g, ' ').trim().slice(0, 180);
    t.esferaT.lastThought = frase;
    t.esferaT.pensou = true;
    t.esferaT.think.push(frase);
    t.esfera?.kick();
  }
  const nomes = (lista) => lista.map((x) => x.nome || x).filter(Boolean).slice(0, 4).join(', ');
  switch (canal) {
    case 'inicio':
      return etapaDaAtividade('entender', 'Entendendo o pedido');
    // núcleo de pesquisa (15/10): a pergunta como o modelo entendeu, e o que o pesquisador vai pensando
    case 'nucleo-entendimento':
      return etapaDaAtividade('entender', 'Entendendo o pedido', d.precisaBuscar === false ? 'responde sem pesquisar' : `${d.pergunta}${d.modo ? ` · pesquisa ${d.modo}` : ''}`);
    case 'raciocinio':
      if (t.caixa.querySelector('.atividade-etapas li:last-child')?.dataset.chave === 'pesquisar') return etapaDaAtividade('pesquisar', 'Pesquisando na internet', d.pensamento);
      return;
    case 'nivel-auto':
      return etapaDaAtividade('entender', 'Entendendo o pedido', `${d.nome || `nível ${d.nivel}`}${d.motivo ? ` — ${d.motivo}` : ''}`);
    case 'pesquisa-cadeia':
      return etapaDaAtividade('planejar', 'Planejando a pesquisa', [d.atividade, d.tipoDeUso].filter(Boolean).join(' · '));
    case 'pesquisa-criterios':
    case 'pesquisa-plano':
      return etapaDaAtividade('planejar', 'Planejando a pesquisa', d.criterios?.length ? `Critérios: ${nomes(d.criterios)}` : '');
    case 'ferramenta':
      if (!FERRAMENTAS_DE_PESQUISA.test(d.nome)) return etapaDaAtividade('agir', 'Executando ações', d.nome);
      return etapaDaAtividade('pesquisar', 'Pesquisando na internet', d.argumentos?.consulta ? `Busca: ${d.argumentos.consulta}` : d.argumentos?.url || '');
    case 'fonte':
      t.contagem = t.contagem || { buscas: 0, sites: new Map() };
      if (d.tipo === 'busca') {
        t.contagem.buscas += 1;
        t.contagem.resultados = (t.contagem.resultados || 0) + (Number(d.resultados) || 0);
        etapaDaAtividade('pesquisar', 'Pesquisando na internet', d.consultas?.length ? `Busca: ${d.consultas[d.consultas.length - 1]}` : '');
      } else if (d.url) {
        siteConsultado(d.url);
        resumoDaAtividade();
      }
      return;
    case 'pesquisa-candidatos':
      return etapaDaAtividade('comparar', 'Comparando as opções encontradas', d.finalistas?.length ? `Na frente: ${nomes(d.finalistas)}` : '');
    case 'pesquisa-matriz':
      return etapaDaAtividade('conferir-evidencias', 'Conferindo as evidências de cada opção', `${Math.round((d.cobertura || 0) * 100)}% dos critérios com evidência`);
    case 'redigindo':
      return etapaDaAtividade('escrever', 'Escrevendo a resposta', d.fontes ? `A partir de ${d.fontes} fonte(s)` : '');
    case 'verificacao':
      return etapaDaAtividade('verificar', 'Conferindo a resposta com as fontes');
    case 'concluido':
    case 'limite':
    case 'interrompido':
    case 'erro': {
      // a esfera: fecha com o brilho final (ok) ou para onde estava
      const T = t.esferaT;
      if (T && !T.ended) {
        const kind = canal === 'concluido' ? 'ok' : canal === 'interrompido' ? 'stop' : 'err';
        T.steps.forEach((x) => { if (x.s === 'act') x.s = kind === 'ok' ? 'ok' : 'err'; });
        Object.assign(T, { ended: true, kind, ms: Date.now() - T.t0 });
        t.esfera?.end();
      }
      const painel = t.caixa.querySelector('.atividade');
      painel.querySelector('.atual')?.classList.replace('atual', canal === 'concluido' ? 'feita' : 'parada');
      painel.open = false;
      return;
    }
    default:
  }
}

api.onEvent(({ canal, dados }) => {
  // antes do manipulador: 'concluido' encerra o turno. 19/10: um erro aqui (t.atividade virou o
  // cartão e a contagem de buscas quebrava) não pode mais calar o manipulador do evento
  try {
    atividade(canal, dados || {});
  } catch (err) {
    console.error('atividade', canal, err);
  }
  window.boasVindasEvento?.(canal, dados || {}); // progresso das instalações na tela de boas-vindas
  manipuladores[canal]?.(dados || {});
});

/* ====================== encerramento (checklist de IAs) ====================== */
/**
 * Pedido de Davi 2026-09-14: ao clicar em fechar o AuGPT, antes de fechar de
 * verdade, um checklist visível mostra cada IA carregada (GPU/CPU) sendo
 * descarregada (ver encerrarModelosEFechar, electron/main.js). Overlay
 * simples, criado na hora — não precisa existir em index.html porque só
 * aparece nos poucos segundos entre clicar em fechar e a janela sumir.
 */
function mostrarEncerrando({ modelos }) {
  let overlay = $('encerrandoOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'encerrandoOverlay';
    overlay.className = 'encerrando-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="encerrando-caixa">
      <h2>Encerrando o AuGPT…</h2>
      <p class="secundario">Descarregando as IAs em memória antes de fechar, pra liberar os recursos do PC.</p>
      <ul class="encerrando-lista">
        ${modelos
          .map(
            (m) =>
              `<li data-modelo="${esc(m.nome)}"><span class="ponto"></span>${esc(m.nome)} <span class="secundario">(${
                m.gpu ? 'GPU' : 'CPU'
              })</span></li>`
          )
          .join('')}
      </ul>
    </div>`;
  overlay.classList.add('visivel');
}

function marcarModeloEncerrado({ nome, ok }) {
  const item = $('encerrandoOverlay')?.querySelector(`li[data-modelo="${CSS.escape(nome)}"]`);
  item?.classList.add(ok ? 'feito' : 'falhou');
}

api.sistema?.onEncerrando(({ fase, modelos, nome, ok }) => {
  if (fase === 'inicio') mostrarEncerrando({ modelos: modelos || [] });
  else if (fase === 'progresso') marcarModeloEncerrado({ nome, ok });
});

