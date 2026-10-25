'use strict';

/**
 * Conferência das ações (25/10, pedido do Davi: "conferir o próprio trabalho antes de dizer pronto").
 *
 * Nas execuções reais, a resposta final dizia o que o modelo ACHAVA que tinha feito, não o que as
 * ferramentas devolveram: "PDF gerado com sucesso contendo o conteúdo" (o texto estava cortado e o
 * modelo completou sozinho); "o arquivo EnableLoudness.ps1 foi salvo localmente" (o passo anterior
 * falhou: "caracteres inválidos no caminho"); "acesso realizado com sucesso" sem abrir o contracheque.
 *
 * Aqui o CÓDIGO confere, sem modelo: cada arquivo que uma ferramenta disse ter criado existe na pasta
 * e não está vazio; cada comando terminou com código 0; cada ação no site deu certo. O resultado vira
 * (1) um aviso ao agente antes de concluir — uma chance de corrigir ou admitir — e (2) o bloco
 * "O que foi conferido" no fim da resposta.
 */

const fs = require('fs');
const path = require('path');

/** O tamanho de um arquivo da pasta de trabalho (bytes), ou null se não existe — pelo Sandbox da execução. */
const tamanhoNaPasta = (sandbox) => (relativo) => {
  try {
    const st = fs.statSync(sandbox.resolve(String(relativo)));
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
};

const GERA_ARQUIVO = /^(escrever_arquivo|acrescentar_ao_arquivo|gerar_docx|gerar_xlsx|gerar_pdf|gerar_html|gerar_grafico)$/;
const APAGA = /^apagar_arquivo$/;
const RODA = /^(executar_comando|executar_codigo)$/;
const NO_SITE = /^(navegar|clicar|preencher_campo|enviar_formulario)$/;
const ehAcao = (nome) => GERA_ARQUIVO.test(nome) || APAGA.test(nome) || RODA.test(nome) || NO_SITE.test(nome);

const curto = (t, n = 140) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** O arquivo que a ação criou: do resultado da ferramenta ("Arquivo criado: x.pdf (12 KB)", "Gravado 10 bytes em x") ou dos argumentos. */
function arquivoDaAcao(a) {
  const r = String(a.resultado || '');
  const doResultado = (r.match(/Arquivo criado: (.+?) \(/) || r.match(/Gravado \d+ bytes em (\S+)/) || r.match(/Acrescentado a (\S+)/) || [])[1];
  const args = a.argumentos || {};
  return doResultado || args.caminho || args.arquivo || args.nome || null;
}

/** A linha que explica o erro de um comando (a última de stderr, ou a primeira com "erro"/"error"). */
function linhaDeErro(resultado) {
  const r = String(resultado || '');
  const stderr = (r.split(/\nstderr:\n/)[1] || '').trim().split(/\r?\n/).filter((l) => l.trim());
  const PALAVRA = /(erro|error|exception|não é reconhecido|not recognized|denied|negado|não encontrad|not found|falh)/i;
  // a frase principal: a 1ª linha do stderr com palavra de erro, senão a 1ª do stderr, senão a 1ª do resto com erro
  const linha = stderr.find((l) => PALAVRA.test(l)) || stderr[0] || r.split(/\r?\n/).find((l) => PALAVRA.test(l)) || '';
  return curto(linha, 160);
}

/**
 * As ações da tarefa, conferidas. `tamanhoDe(caminhoRelativo)` → bytes, ou null se não existe.
 * → [{ ok, texto, tipo }] — arquivo reescrito conta uma vez (a última); no site, só as falhas e um total.
 */
function conferirAcoes(acoes = [], { tamanhoDe = () => null } = {}) {
  const porArquivo = new Map();
  const itens = [];
  let noSite = 0;
  for (const a of acoes) {
    if (!a || !ehAcao(a.nome)) continue;
    if (a.aprovada === false) {
      itens.push({ ok: false, tipo: 'recusada', texto: `${a.nome.replace(/_/g, ' ')}: você não autorizou` });
      continue;
    }
    if (GERA_ARQUIVO.test(a.nome)) {
      const arq = arquivoDaAcao(a);
      let item;
      if (a.erro) item = { ok: false, tipo: 'arquivo', texto: `${arq || a.nome}: não foi criado — ${curto(a.erro)}` };
      else {
        const t = arq ? tamanhoDe(arq) : null;
        if (t === null) item = { ok: false, tipo: 'arquivo', texto: `${arq || a.nome}: a ferramenta disse que gravou, mas o arquivo não está na pasta de trabalho` };
        else if (t === 0) item = { ok: false, tipo: 'arquivo', texto: `${arq}: foi criado vazio` };
        else item = { ok: true, tipo: 'arquivo', texto: `${arq} (${kb(t)})` };
      }
      // arquivo reescrito: só a última vez vale (a anterior pode ter falhado e a nova, dado certo)
      if (arq && porArquivo.has(arq)) itens[porArquivo.get(arq)] = item;
      else {
        if (arq) porArquivo.set(arq, itens.length);
        itens.push(item);
      }
    } else if (APAGA.test(a.nome)) {
      const arq = a.argumentos?.caminho;
      const ainda = arq ? tamanhoDe(arq) : null;
      itens.push(a.erro ? { ok: false, tipo: 'arquivo', texto: `${arq}: não foi apagado — ${curto(a.erro)}` } : ainda !== null ? { ok: false, tipo: 'arquivo', texto: `${arq}: ainda está na pasta` } : { ok: true, tipo: 'arquivo', texto: `${arq} apagado (dá para restaurar)` });
    } else if (RODA.test(a.nome)) {
      const r = String(a.resultado || '');
      const codigo = (r.match(/código de saída: (-?\d+|null)/) || [])[1];
      const interrompido = /\[interrompido/.test(r);
      const oQue = a.nome === 'executar_comando' ? `comando \`${curto(a.argumentos?.comando, 70)}\`` : `script ${a.argumentos?.linguagem || ''}`.trim();
      const ok = !a.erro && !interrompido && codigo === '0';
      const motivo = a.erro ? curto(a.erro) : interrompido ? 'demorou demais e foi interrompido' : codigo === undefined ? curto(r, 140) || 'não rodou' : `terminou com erro (código ${codigo})${linhaDeErro(r) ? `: ${linhaDeErro(r)}` : ''}`;
      itens.push({ ok, tipo: 'comando', texto: ok ? `${oQue}: rodou sem erro` : `${oQue}: ${motivo}` });
    } else if (NO_SITE.test(a.nome)) {
      if (a.erro) itens.push({ ok: false, tipo: 'site', texto: `${a.nome.replace(/_/g, ' ')} no site: ${curto(a.erro)}` });
      else noSite += 1;
    }
  }
  if (noSite) itens.push({ ok: true, tipo: 'site', texto: `${noSite} ${noSite === 1 ? 'ação' : 'ações'} no site sem erro` });
  return itens;
}

const RECONHECE_FALHA = /n[ãa]o (consegui|foi poss[ií]vel|deu certo|funcionou|rodou)|falh|\berro\b|não (foi|ficou) (criad|salv|gerad)/i;
const DIZ_QUE_CRIOU = /(gerad|criad|salv|gravad|export|cri(ei|ou)|ger(ei|ou)|salv(ei|ou))\w*/i;

/** Arquivos que a RESPOSTA diz que foram criados e que não estão na pasta (nem foram criados por ferramenta). */
function arquivosSoNaResposta(texto, { tamanhoDe = () => null, criados = [] } = {}) {
  const t = String(texto || '');
  const nomes = new Set();
  for (const frase of t.split(/(?<=[.!?\n])\s+/)) {
    if (!DIZ_QUE_CRIOU.test(frase) || RECONHECE_FALHA.test(frase)) continue;
    for (const m of frase.matchAll(/[\w.\-/\\]+\.(pdf|docx|xlsx|csv|txt|md|html|png|jpg|json|ps1|py|js|bat|zip)\b/gi)) nomes.add(m[0].replace(/^[`'"(]+|[`'")]+$/g, ''));
  }
  const base = (n) => path.basename(String(n).replace(/\\/g, '/')).toLowerCase();
  const conhecidos = new Set(criados.map(base));
  return [...nomes].filter((n) => !/^https?:/i.test(n) && !conhecidos.has(base(n)) && tamanhoDe(n) === null && tamanhoDe(base(n)) === null);
}

/**
 * O material da redação quando a execução AGIU (25/10): no app, "crie o arquivo e rode o comando" virou
 * "A busca não retornou material…" e "o terminal retornaria…" — o redator via só o dossiê da pesquisa,
 * vazio, e não o que as ferramentas fizeram. Aqui vai o resultado real de cada ação.
 */
function materialDasAcoes(acoes = [], { tamanhoDe = () => null } = {}) {
  const itens = conferirAcoes(acoes, { tamanhoDe });
  if (!itens.length) return '';
  const saidas = acoes
    .filter((a) => RODA.test(a?.nome) && a.resultado)
    .slice(-4)
    .map((a) => `Saída de ${a.nome === 'executar_comando' ? `\`${curto(a.argumentos?.comando, 80)}\`` : 'um script'}:\n${String(a.resultado).slice(0, 900)}`);
  return `O QUE FOI FEITO NESTA EXECUÇÃO (resultado real das ferramentas, conferido pelo código — é a verdade sobre o que aconteceu):\n${itens.map((i) => `${i.ok ? '✓' : '✗'} ${i.texto}`).join('\n')}${saidas.length ? `\n\n${saidas.join('\n\n')}` : ''}`;
}

/**
 * O que o PEDIDO mandou fazer e nenhuma ferramenta fez (25/10, no app: "rode o comando X" — o agente
 * decidiu sozinho que o programa não existia e respondeu sem rodar). → ['rodar o comando `x`', …]
 */
const PEDE_RODAR = /\b(rode|rodar|roda|execute|executar|executa|run)\b[^.?!\n]{0,60}\b(comando|script|terminal|powershell|cmd|prompt|\.ps1|\.bat|\.py)\b|\b(rode|rodar|roda|execute|executar|executa|run)\s+`[^`]+`/i;
const PEDE_ARQUIVO = /\b(crie|criar|cria|salve|salvar|salva|grave|gravar|escreva|escrever|gere|gerar|gera|create|save|write)\b[^.?!\n]{0,40}\b(arquivo|planilha|pdf|documento|docx|xlsx|csv|txt|file)\b/i;
function pedidoSemAcao(objetivo, acoes = []) {
  const t = String(objetivo || '').split(/\n\nArquivos anexados/)[0];
  // pergunta de como fazer ("como criar um arquivo .bat?") pede explicação, não ação
  if (/^\s*(como|how|o que|what|qual|quais|por ?que|why|onde|where|[ée] poss[ií]vel|d[aá] (pra|para)|posso|consigo|can i)\b/i.test(t)) return [];
  const fez = (re) => acoes.some((a) => a && re.test(a.nome) && a.aprovada !== false);
  const faltam = [];
  if (PEDE_RODAR.test(t) && !fez(RODA)) {
    const comando = (t.match(/`([^`]{2,120})`/) || [])[1];
    faltam.push(comando ? `rodar o comando \`${comando}\`` : 'rodar o comando pedido');
  }
  if (PEDE_ARQUIVO.test(t) && !fez(GERA_ARQUIVO)) faltam.push('criar o arquivo pedido');
  return faltam;
}

/** O aviso ao agente antes de concluir (uma vez): o que falhou e o que fazer. null se nada falhou. */
function avisoAntesDeConcluir(itens, faltando = [], naoFeitos = []) {
  const falhas = itens.filter((i) => !i.ok);
  if (!falhas.length && !faltando.length && !naoFeitos.length) return null;
  const linhas = [...falhas.map((i) => `✗ ${i.texto}`), ...faltando.map((n) => `✗ ${n}: você diz que criou, mas não está na pasta`), ...naoFeitos.map((n) => `✗ o usuário pediu para ${n}, e isso não foi feito (nenhuma ferramenta rodou) — faça agora com a ferramenta certa, em vez de supor o resultado`)];
  return `Conferi o que foi feito antes de você concluir:\n${linhas.join('\n')}\nCorrija agora, se der (tente de outro jeito, confira com listar_arquivos). Se não der, diga na resposta, com todas as letras, o que NÃO deu certo — não diga que foi feito.`;
}

/** O bloco do fim da resposta. '' quando não houve nenhuma ação conferível. */
function blocoDaConferencia(itens, faltando = [], { idioma = 'pt', naoFeitos = [] } = {}) {
  if (!itens.length && !faltando.length && !naoFeitos.length) return '';
  const en = idioma === 'en';
  const linhas = [
    ...itens.map((i) => `- ${i.ok ? '✓' : '✗'} ${i.texto}`),
    ...faltando.map((n) => `- ✗ ${n}: ${en ? 'the answer says it was created, but it is not in the work folder' : 'a resposta diz que foi criado, mas não está na pasta de trabalho'}`),
    ...naoFeitos.map((n) => `- ✗ ${en ? `not done: ${n}` : `não foi feito: ${n}`}`),
  ];
  const falhou = itens.some((i) => !i.ok) || faltando.length || naoFeitos.length;
  const titulo = en ? (falhou ? '**Checked — not everything worked:**' : '**Checked:**') : falhou ? '**O que foi conferido — nem tudo deu certo:**' : '**O que foi conferido:**';
  return `${titulo}\n${linhas.join('\n')}`;
}

module.exports = { tamanhoNaPasta, materialDasAcoes, conferirAcoes, pedidoSemAcao, arquivosSoNaResposta, avisoAntesDeConcluir, blocoDaConferencia, arquivoDaAcao, ehAcao, RECONHECE_FALHA };
