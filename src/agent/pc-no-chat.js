'use strict';

/**
 * Consultas ao PC pelo chat (19/10): "quanto espaço livre meu pc tem?",
 * "qual a marca do meu mouse?", "meu windows está atualizado?", "quantas fotos
 * eu tenho e onde estão?". O código lê (src/pc/inspetor.js, só leitura), faz as
 * tabelas e o resumo do que chamou atenção; o modelo explica em linguagem simples.
 */

const inspetor = require('../pc/inspetor');
const { lerComComando } = require('../pc/leitura-livre');
const catalogo = require('./capacidades');

/** A pergunta é sobre este PC? → { ids } ou null. */
function pedidoDeConsultaPC(texto) {
  const ids = inspetor.consultasDoPedido(texto);
  return ids.length ? { ids } : null;
}

function pedidoDeExplicacao(pergunta, blocos, avisos, hoje) {
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de CONSULTAR o computador do usuário (só leitura: não mudou nada). O que ele leu:

${blocos.join('\n\n')}

O que chamou atenção: ${avisos.length ? avisos.join('; ') : 'nada fora do normal'}.

Responda ao que o usuário perguntou, em português do Brasil, em 1 a 3 parágrafos curtos, para quem não é técnico (as tabelas já aparecem acima: não as repita inteiras).
- Comece pela resposta direta, com os números lidos.
- Explique o que for termo técnico (SSD, NVMe, driver, build) numa frase.
- Se algo chamou atenção, diga o que fazer, de forma prática — quem faz é o usuário (o AuGPT só consulta).
- Use SÓ o que foi lido acima; não invente marca, modelo ou número.`,
    },
    { role: 'user', content: pergunta },
  ];
}

async function responderConsultaPC({ pergunta, deps, ids: dados = null, hoje = new Date().toLocaleDateString('pt-BR'), modulo = inspetor }) {
  const emit = deps.emit || (() => {});
  // pelo entendimento sem palavras que apontem a consulta: a ficha básica do PC
  const ids = dados || modulo.consultasDoPedido(pergunta);
  // pelo entendimento ("consultar_pc") sem consulta fixa: a leitura livre; se não for do PC, a ficha básica
  if (!ids.length && deps.chamar && modulo === inspetor) {
    const livre = await responderLeituraLivre({ pergunta, deps, hoje }).catch(() => null);
    if (livre) return livre;
  }
  const escolhidas = ids.length ? ids : ['sistema', 'discos'];
  emit('ferramenta', { nome: 'consultar_pc', argumentos: { consulta: `lendo ${escolhidas.join(', ')} (só leitura)` }, risco: 'leitura' });
  const r = await modulo.consultar(escolhidas, { texto: pergunta, aoProgresso: (p) => emit('ferramenta', { nome: 'consultar_pc', argumentos: { consulta: p }, risco: 'leitura' }) });
  const { blocos, avisos, ofertas } = modulo.blocosDaResposta(escolhidas, r);
  // "tenho o Discord instalado?": a resposta direta pela lista de programas
  if (r.programas) {
    const achados = modulo.programasDaPergunta(pergunta, r.programas);
    if (achados && achados.length) blocos.push(`**Instalado:** ${achados.slice(0, 8).map((p) => `${p.nome}${p.versao ? ` ${p.versao}` : ''}`).join('; ')}.`);
    else if (achados) blocos.push('**Não encontrei esse programa** na lista do que está instalado.');
  }
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'pc' };
  if (r.erro && !blocos.length) {
    const texto = `Não consegui consultar o computador: ${r.erro}.`;
    emit('resposta-token', { pedaco: texto });
    return { ...vazio, texto };
  }
  const resumo = avisos.length ? `**O que chamou atenção:**\n${avisos.map((a) => `- ${a}`).join('\n')}` : '';
  const topo = `${blocos.join('\n\n')}${resumo ? `\n\n${resumo}` : ''}`;
  emit('resposta-token', { pedaco: `${topo}\n\n` });
  const explicacao = String((await deps.escrever(pedidoDeExplicacao(pergunta, blocos, avisos, hoje), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  const oferta = ofertas.length ? `\n\n${catalogo.ofertaDePesquisa(ofertas[0])}` : '';
  return { ...vazio, texto: `${topo}\n\n${explicacao}\n\n*Só consultei: nada foi mudado no seu computador, e nada saiu dele.*${oferta}`, pc: r };
}

/* ------------------------------ leitura livre (19/10) ------------------------------ */

const lerJson = (t) => {
  try {
    return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)[0]);
  } catch {
    return null;
  }
};
const comLimite = (p, ms, valor) => Promise.race([Promise.resolve(p).catch(() => valor), new Promise((ok) => setTimeout(() => ok(valor), ms))]);
const COMANDO = /(Get-[A-Za-z]+|\breg query\b|\bgpresult\b|\bpowercfg\b|\bpnputil\b|\bdriverquery\b|\bsc query\b|\bschtasks\b|\bwevtutil\b|\bnetsh\b.*\bshow\b)/i;
const VERSAO = /\b\d+\.\d+(\.\d+)+\b/;

/**
 * Por onde começar, por assunto: leituras que funcionam no Windows sem administrador. Não é
 * uma capacidade a mais — o modelo pequeno não lembra de gpresult nem de
 * Get-NetAdapterAdvancedProperty, e inventava cmdlets (Get-GPPermission).
 */
const RECEITAS = String.raw`- programa/pacote instalado e versão (chipset, drivers em pacote): Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*, HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object { $_.DisplayName -like '*nome*' } | Select-Object DisplayName, DisplayVersion, InstallDate | Format-Table -AutoSize
- driver de um dispositivo: Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -like '*nome*' -or $_.Manufacturer -like '*fabricante*' } | Select-Object DeviceName, DriverVersion, DriverDate, Manufacturer | Format-Table -AutoSize
- ajustes avançados da placa de rede: Get-NetAdapterAdvancedProperty -Name * | Select-Object Name, DisplayName, DisplayValue | Format-Table -AutoSize
- placas de rede, velocidade, driver: Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, LinkSpeed, DriverVersion | Format-Table -AutoSize
- IP, DNS, gateway: Get-NetIPConfiguration | Format-List
- políticas de grupo: gpresult /r /scope user  e  reg query HKLM\SOFTWARE\Policies /s  e  reg query HKCU\SOFTWARE\Policies /s
- registro: reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"  (ou Get-ItemProperty no caminho)
- serviços: Get-Service | Where-Object Status -eq Running | Select-Object Name, DisplayName | Format-Table -AutoSize
- tarefas agendadas: Get-ScheduledTask | Where-Object State -ne Disabled | Select-Object TaskPath, TaskName, State | Format-Table -AutoSize
- erros recentes do Windows: Get-WinEvent -LogName System -MaxEvents 30 | Where-Object Level -le 2 | Select-Object TimeCreated, ProviderName, Message | Format-List
- plano de energia: powercfg /list
- firewall: Get-NetFirewallProfile | Select-Object Name, Enabled | Format-Table
- antivírus (Defender): Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated | Format-List
- Secure Boot: Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State | Select-Object UEFISecureBootEnabled
- dispositivos (USB, Bluetooth, áudio…): Get-PnpDevice -PresentOnly -Class USB | Select-Object FriendlyName, Status | Format-Table -AutoSize
- variáveis de ambiente: Get-ChildItem Env: | Format-Table -AutoSize`;

/** Colunas pedidas no Select-Object que vieram vazias em TODOS os itens (a propriedade não existe nesse objeto). */
function colunasVazias(saida, script = '') {
  const pedidas = ((String(script).match(/Select-Object\s+(?:-Property\s+)?([\w ,]+?)(?:\s*\||\s+-|$)/i) || [])[1] || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!pedidas.length) return [];
  const linhas = String(saida || '').split('\n');
  const vazias = [];
  for (const col of pedidas) {
    const lista = linhas.map((l) => l.match(new RegExp(`^${col.replace(/[^\w]/g, '')}\\s+:\\s?(.*)$`))).filter(Boolean);
    if (lista.length && lista.every((m) => !m[1].trim())) vazias.push(col);
    // tabela: a coluna existe no cabeçalho e nenhuma linha tem valor embaixo dela
    const cab = linhas.findIndex((l) => new RegExp(`(^|\\s)${col}(\\s|$)`).test(l) && /^[\w ]+$/.test(l.trim()));
    if (!lista.length && cab >= 0 && /^-[- ]+$/.test((linhas[cab + 1] || '').trim())) {
      const ini = linhas[cab].search(new RegExp(`(^|\\s)${col}(\\s|$)`)) + (/^\s/.test(linhas[cab].slice(linhas[cab].search(new RegExp(`(^|\\s)${col}`)))) ? 1 : 0);
      const corpo = linhas.slice(cab + 2).filter((l) => l.trim());
      if (corpo.length && corpo.every((l) => !l.slice(ini, ini + col.length + 2).trim())) vazias.push(col);
    }
  }
  return vazias;
}

/**
 * O registro de programas instalados tem três ramos e o modelo lê um só (19/10: o "AMD Chipset
 * Software" fica no de 32 bits, WOW6432Node): o código completa o caminho.
 */
const RAMO = /HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\*/i;
function completarComando(script) {
  if (!RAMO.test(script) || /WOW6432Node/i.test(script)) return script;
  return script.replace(RAMO, String.raw`HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*, HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*, HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*`);
}

/** Versões citadas na explicação que não estão no que foi lido nem nas fontes. */
const versoesSemOrigem = (texto, lidos, fontes) => {
  const base = [...lidos.map((l) => l.saida), ...fontes.map((f) => f.trecho)].join('\n');
  return [...new Set((String(texto).match(/\b\d+\.\d+(\.\d+)+\b/g) || []).filter((v) => !base.includes(v)))];
};

/**
 * Um exemplo real do que o começo do comando devolve, com todas as propriedades — o modelo
 * corrige o filtro e as colunas pelo que existe ("AMD" está como "Advanced Micro Devices").
 */
function exploracao(script) {
  const comeco = String(script).split('|')[0].trim();
  if (!/^Get-[A-Za-z]+/i.test(comeco)) return null;
  const termo = (String(script).match(/-(?:i?like|match)\s+['"]\*?([^'"*|]{2,40})\*?['"]/i) || [])[1];
  return termo
    ? `${comeco} | Where-Object { ($_ | Format-List * | Out-String) -like '*${termo.replace(/'/g, '')}*' } | Select-Object -First 3 | Format-List *`
    : `${comeco} | Select-Object -First 2 | Format-List *`;
}

function pedidoDePlano(pergunta, conversa, pc) {
  const antes = (conversa || []).slice(-4).map((m) => `${m.role === 'user' ? 'Usuário' : 'AuGPT'}: ${String(m.content || '').slice(0, 300)}`).join('\n');
  return `O usuário quer que o AuGPT LEIA algo do próprio computador (Windows), sem mudar nada.
${pc ? `${pc}\n` : ''}${antes ? `Conversa até aqui:\n${antes}\n` : ''}Pedido: ${pergunta}

Responda só com JSON:
{"do_pc": true se o pedido é sobre ESTE computador (false se é sobre outro aparelho, um site ou um assunto geral),
 "o_que": "o que ler, com as palavras do pedido (ajustes são ajustes, versão é versão; ex.: versão do driver do chipset AMD)",
 "busca": "busca em inglês de como LER isso pelo PowerShell (ex.: powershell get AMD chipset driver version)",
 "versao_mais_nova": true se o usuário quer saber se está atualizado ou qual a versão mais nova,
 "produto": "nome para pesquisar a versão mais nova (ex.: AMD Chipset Software AM5), ou vazio"}`;
}

function pedidoDeComandos({ pergunta, plano, dicas, tentativas }) {
  return `Escreva comandos de Windows PowerShell 5.1 que LEIAM, no computador do usuário, o que ele pediu.
Pedido do usuário: ${pergunta}${plano.o_que ? `\n(em resumo: ${plano.o_que})` : ''}
${dicas.length ? `Comandos que aparecem em páginas sobre o assunto:\n${dicas.map((d) => `- ${d}`).join('\n')}\n` : ''}${tentativas.length ? `Tentativas que NÃO deram certo (não repita; corrija pelos dados reais abaixo):\n${tentativas.map((t) => `- ${t.script}\n  → ${t.motivo || 'não trouxe nada'}${t.exemplo ? `\n  O que esse comando devolve de verdade (propriedades e valores reais deste PC):\n${t.exemplo.split('\n').slice(0, 45).join('\n')}` : ''}`).join('\n')}\n` : ''}
Regras (um verificador recusa o resto):
- Só leitura e sem administrador: cmdlets Get-* (Get-CimInstance, Get-ItemProperty no registro, Get-NetAdapter, Get-NetAdapterAdvancedProperty, Get-PnpDevice, Get-Service, Get-ScheduledTask, Get-WinEvent, Get-ChildItem para listar), filtros (Where-Object, Select-Object, Sort-Object, Format-Table, Format-List) e programas em modo consulta (reg query, gpresult /r /scope user, powercfg /list, sc query, schtasks /query, wevtutil qe, pnputil /enum-devices, driverquery, netsh … show).
- Proibido: o que muda algo (Set-, Remove-, Stop-, Start-, Invoke-, New-, Enable-, Disable-), ler conteúdo de arquivo (Get-Content), métodos .NET ([math]::Round, .Kill()), & e iex, -ComputerName. Para arredondar: '{0:N1}' -f ($x / 1GB).
- Programa instalado: os DOIS ramos do registro, HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* e HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*, com Where-Object { $_.DisplayName -like '*nome*' }.
- Driver de dispositivo: Get-CimInstance Win32_PnPSignedDriver (DeviceName, DriverVersion, DriverDate, Manufacturer); filtre com -like '*texto*' no DeviceName E no Manufacturer.
Leituras que funcionam neste Windows (comece por elas quando o assunto bater):
${RECEITAS}

- Use só propriedades que existem no objeto (veja os dados reais, quando houver) e filtros amplos: o fabricante pode estar por extenso (ex.: "Advanced Micro Devices" em vez de "AMD").
- Termine com Select-Object só das colunas que respondem, e Format-Table -AutoSize ou Format-List.
- No máximo 3 comandos; cada um em uma linha.

Responda só com JSON: {"comandos": [{"para": "o que este comando lê", "script": "o comando"}]}`;
}

function pedidoDaResposta({ pergunta, plano, lidos, falhas, fontes, hoje }) {
  return [
    {
      role: 'system',
      content: `Você é o AuGPT. Hoje é ${hoje}. O AuGPT acabou de LER o computador do usuário com estes comandos (só leitura, nada foi mudado):

${lidos.length ? lidos.map((l) => `### ${l.para}\nComando: ${l.script}\nSaída:\n${l.saida.slice(0, 3000)}`).join('\n\n') : 'NADA foi lido: os comandos falharam ou foram recusados.'}
${falhas.length ? `\nNão deu para ler: ${falhas.map((f) => f.motivo).join('; ')}` : ''}
${fontes.length ? `\nVersão mais nova, segundo as fontes:\n${fontes.map((f) => `[${f.n}] ${f.titulo}\n${f.trecho}`).join('\n\n')}` : ''}

Responda ao pedido, em português do Brasil, em 1 a 3 parágrafos curtos para quem não é técnico (a saída já aparece acima: não a repita inteira).
- Comece pela resposta direta, com os valores LIDOS (nome e versão como aparecem na saída).
- Use SÓ o que está na saída e nas fontes; não invente versão, data nem configuração, e não deduza o que a saída não diz.
- Se algo não apareceu na saída, diga "não consegui ler" — NUNCA "você não tem" ou "não existe".
${plano.versao_mais_nova ? `- Compare a versão lida com a mais nova das fontes, citando [n]. Se as fontes não trazem a versão mais nova, diga isso.\n` : ''}- Explique termo técnico numa frase. Quem muda alguma coisa é o usuário: o AuGPT só leu.`,
    },
    { role: 'user', content: pergunta },
  ];
}

/**
 * "meu chipset está atualizado?", "veja as políticas de grupo", "os ajustes do meu adaptador Realtek":
 * pesquisa como ler, o modelo escreve o comando, src/pc/leitura-livre.js só deixa rodar leitura.
 * → resposta, ou null se o pedido não é sobre este PC.
 */
async function responderLeituraLivre({ pergunta, conversa = [], deps, hoje = new Date().toLocaleDateString('pt-BR'), ler = lerComComando }) {
  const emit = deps.emit || (() => {});
  const passo = (consulta) => emit('ferramenta', { nome: 'ler_pc', argumentos: { consulta }, risco: 'leitura' });
  passo('planejando a leitura (só leitura)');
  const pc = deps.sobreOUsuario ? await comLimite(deps.sobreOUsuario(), 8000, '') : '';
  const plano = lerJson((await deps.chamar([{ role: 'user', content: pedidoDePlano(pergunta, conversa, String(pc || '').split('\n')[0]) }], { json: true, numPredict: 400 })).content);
  if (!plano || plano.do_pc === false) return null;

  // como ler: as linhas de comando das páginas sobre o assunto
  const dicas = [];
  if (plano.busca && deps.buscar) {
    passo(`pesquisando como ler: ${plano.busca}`);
    const achados = await comLimite(deps.buscar(plano.busca), 15000, []);
    const paginas = deps.lerPagina ? await comLimite(Promise.all(achados.slice(0, 2).map((a) => deps.lerPagina(a.url).catch(() => null))), 20000, []) : [];
    for (const texto of [...achados.slice(0, 5).map((a) => a.resumo), ...paginas.map((p) => p?.texto)]) {
      for (const linha of String(texto || '').split('\n')) {
        const l = linha.trim();
        if (COMANDO.test(l) && l.length <= 220 && !dicas.includes(l) && dicas.length < 25) dicas.push(l);
      }
    }
  }

  const lidos = [];
  const falhas = [];
  let completos = 0;
  // mais uma rodada enquanto nada respondeu OU há falha com o exemplo real para corrigir
  let corrigiveis = 0;
  for (let rodada = 0; rodada < 3 && (!completos || corrigiveis); rodada += 1) {
    corrigiveis = 0;
    const pedido = lerJson((await deps.chamar([{ role: 'user', content: pedidoDeComandos({ pergunta, plano, dicas, tentativas: falhas.slice(-4) }) }], { json: true, numPredict: 700 })).content);
    const comandos = (pedido?.comandos || []).filter((x) => x && x.script && !lidos.some((l) => l.script === x.script) && !falhas.some((f) => f.script === x.script)).slice(0, 3);
    if (!comandos.length) break;
    for (const c of comandos) {
      c.script = completarComando(String(c.script));
      passo(`lendo: ${c.script.slice(0, 160)}`);
      const r = await ler(c.script);
      const vazia = r.ok && !String(r.saida || '').trim();
      const erro = r.ok && /^ERRO:/.test(r.saida);
      const semValor = r.ok && !vazia && !erro ? colunasVazias(r.saida, c.script) : [];
      if (r.ok && !vazia && !erro && lidos.some((l) => l.saida === r.saida)) {
        if (!semValor.length) completos += 1;
        continue; // a mesma saída de outro comando: não repete na resposta
      }
      if (r.ok && !vazia && !erro) {
        lidos.push({ para: c.para || plano.o_que || 'leitura', script: c.script, saida: r.saida, cortada: r.cortada });
        if (!semValor.length) completos += 1;
      }
      if (!r.ok || vazia || erro || semValor.length) {
        const falha = { script: c.script, motivo: semValor.length ? `as colunas ${semValor.join(', ')} vieram vazias (essa propriedade não existe nesse objeto)` : vazia ? 'não trouxe nada (filtro errado?)' : r.recusado ? `recusado: ${r.motivo}` : erro ? r.saida.slice(0, 200) : r.motivo };
        // o que o comando devolve de verdade: só para leitura que rodou (recusado não se explora)
        const explorar = !r.recusado && rodada < 2 && exploracao(c.script);
        if (explorar) {
          const e = await ler(explorar);
          if (e.ok && String(e.saida || '').trim() && !/^ERRO:/.test(e.saida)) {
            falha.exemplo = e.saida.slice(0, 2500);
            corrigiveis += 1;
          }
        }
        falhas.push(falha);
      }
    }
  }
  // leitura parcial substituída por uma completa do mesmo assunto: fica só a completa
  if (completos) for (let i = lidos.length - 1; i >= 0; i -= 1) if (colunasVazias(lidos[i].saida, lidos[i].script).length) lidos.splice(i, 1);

  // "está atualizado?": a versão mais nova pelas páginas do fabricante e de download
  const fontes = [];
  const produto = String(plano.produto || plano.o_que || '').replace(/^vers[aã]o (do |da |de )?/i, '').trim();
  if (plano.versao_mais_nova && produto && deps.buscar && lidos.length) {
    passo(`pesquisando a versão mais nova: ${produto}`);
    const achados = await comLimite(deps.buscar(`${produto} latest version`), 15000, []);
    const paginas = deps.lerPagina ? await comLimite(Promise.all(achados.slice(0, 3).map((a) => deps.lerPagina(a.url).catch(() => null))), 25000, []) : [];
    achados.slice(0, 5).forEach((a, i) => {
      const linhas = String(paginas[i]?.texto || '').split('\n').map((l) => l.trim()).filter((l) => VERSAO.test(l) && l.length <= 300).slice(0, 12);
      const trecho = [a.resumo, ...linhas].filter(Boolean).join('\n').slice(0, 1500);
      if (trecho) fontes.push({ n: fontes.length + 1, titulo: paginas[i]?.titulo || a.titulo || a.url, url: a.url, trecho });
    });
  }

  const vazio = { produto: false, assuntos: [], buscou: fontes.length > 0, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'pc-livre' };
  const bloco = (l) => `*${l.para}*\n\`\`\`powershell\n${l.script}\n\`\`\`\n\`\`\`\n${l.saida.split('\n').slice(0, 40).join('\n')}${l.cortada || l.saida.split('\n').length > 40 ? '\n…' : ''}\n\`\`\``;
  const topo = lidos.length ? `**O que eu li no seu PC**\n\n${lidos.map(bloco).join('\n\n')}` : '';
  if (topo) emit('resposta-token', { pedaco: `${topo}\n\n` });
  let explicacao = String((await deps.escrever(pedidoDaResposta({ pergunta, plano, lidos, falhas, fontes, hoje }), (pedaco) => emit('resposta-token', { pedaco }))) || '').trim();
  // citação sem fonte ("[1]" quando nada foi pesquisado) sai do texto
  if (!fontes.length) explicacao = explicacao.replace(/\s?\[\d+\](\s*,?\s*\[\d+\])*/g, '');
  const semOrigem = versoesSemOrigem(explicacao, lidos, fontes);
  const aviso = semOrigem.length ? `\n\n*⚠ Estes números não aparecem no que eu li nem nas fontes: ${semOrigem.join(', ')}. Vale conferir.*` : '';
  if (aviso) emit('resposta-token', { pedaco: aviso });
  const rodape = '*Só li: nada foi mudado no seu computador, e nada saiu dele. Conteúdo de arquivos, senhas e área de transferência ficam de fora.*';
  return { ...vazio, texto: `${topo ? `${topo}\n\n` : ''}${explicacao}${aviso}\n\n${rodape}`, fontes: fontes.map(({ n, titulo, url }) => ({ n, titulo, url })), leitura: { plano, lidos, falhas } };
}

module.exports = { completarComando, colunasVazias, exploracao, versoesSemOrigem, pedidoDeConsultaPC, responderConsultaPC, responderLeituraLivre, pedidoDeLeituraLivre: inspetor.pedidoDeLeituraLivre };
