'use strict';

/**
 * "Onde está aquilo?" no chat (31/10): "acha o contrato do aluguel", "onde está o meu currículo?", "procura nos
 * meus arquivos a garantia do monitor", "qual o valor da minha conta de luz de setembro?". Busca no índice das
 * pastas escolhidas em Ajustes (src/busca-local.js) e responde com o cartão ```arquivos (Abrir, Mostrar na pasta).
 * Pergunta de fato ("qual", "quanto", "quando") sobre um documento seu: o modelo local responde só pelo que está
 * nos arquivos achados, citando o nome. Nada sai do PC.
 */

const path = require('path');
const { BuscaLocal } = require('../busca-local');
const { vetorDe } = require('./embeddings');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const EXPLICITO = /\b(?:n[oa]s? (?:meus|minhas) (?:arquivos|documentos|pastas|pdfs|fotos|prints|coisas|downloads)|no meu (?:pc|computador|notebook)|aqui no (?:pc|computador))\b/;
// o que é documento de alguém (para "acha o X" sem "nos meus arquivos")
const DOC = /\b(contrato|comprovante|boleto|nota fiscal|notas fiscais|recibo|documento|rg|cpf|cnh|certidao|curriculo|foto|fotos|print|planilha|pdf|laudo|exame|exames|receita|extrato|fatura|holerite|contracheque|declaracao|apolice|garantia|manual|passagem|voo|reserva|ingresso|boletim|historico escolar|diploma|certificado|relatorio|trabalho de|apresentacao|carteirinha|conta de (luz|agua|gas|internet|telefone|energia)|escritura|matricula|orcamento|proposta)\b/;
const MEU = /\b(meu|minha|meus|minhas|aquele|aquela|aqueles|aquelas)\b/;

/** { consulta, fato } ou null. */
function pedidoDeBuscaLocal(texto) {
  const t = semAcento(texto).replace(/^(ei |ok |hey )?(jarvis|augpt|gpt)[,!.]?\s*/, '').replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim();
  const explicito = EXPLICITO.test(t);
  let m;
  let consulta = null;
  let fato = false;
  if ((m = /^(?:onde (?:esta|estao|ta|tao|fica|ficou|guardei|salvei|deixei|botei|coloquei|baixei)|cade) (.{3,80})$/.exec(t)) && (DOC.test(m[1]) || explicito)) consulta = m[1]; // "onde está o meu mouse?" não
  else if ((m = /^(?:me )?(?:acha|ache|achar|encontra|encontre|encontrar|procura|procure|procurar|busca|busque|localiza|localize|abre|abra) (.{3,80})$/.exec(t)) && (explicito || (DOC.test(m[1]) && MEU.test(m[1])) || /^(o|a|os|as) (contrato|comprovante|curriculo|laudo|holerite|escritura|apolice|certidao)\b/.test(m[1]))) consulta = m[1];
  else if (/^(qual|quais|quanto|quanta|quando|quem|que dia|o que diz|o que dizia)\b/.test(t) && MEU.test(t) && DOC.test(t)) {
    consulta = t;
    fato = true;
  } else if (explicito && /^(tem|existe|ha|eu tenho)\b/.test(t)) consulta = t;
  if (!consulta) return null;
  consulta = consulta.replace(EXPLICITO, ' ').trim().replace(/^((o|a|os|as|meu|minha|meus|minhas|aquele|aquela) )+/, '').replace(/\b(pra mim|para mim|por favor|ai)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return consulta.length >= 2 ? { consulta, fato, explicito } : null;
}

const quando = (ms, en) => new Date(ms).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

async function responderBuscaLocal({ pedido, deps = {}, config = {}, pasta, pergunta = '' }) {
  const en = config.idiomaEfetivo === 'en';
  const responder = (texto, extra = {}) => {
    deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
    return { ...SEM_PESQUISA, texto, modo: 'busca-local', noIdioma: en, ...extra };
  };
  const pastas = Array.isArray(config.buscaLocalPastas) ? config.buscaLocalPastas.filter(Boolean) : [];
  if (!pastas.length) {
    // sem pastas escolhidas: só responde quando o pedido falou dos arquivos ("nos meus arquivos"); senão, segue a vida
    if (!pedido.explicito) return null;
    return responder(en
      ? 'To search your files, choose the folders in **Settings → Memory → Search your files** (Documents, Downloads…). I read them on your PC — nothing leaves it.'
      : 'Para eu procurar nos seus arquivos, escolha as pastas em **Ajustes → Memória → Busca nos seus arquivos** (Documentos, Downloads…). Eu leio aqui no PC — nada sai dele.');
  }
  const busca = BuscaLocal.de(path.join(pasta, 'busca-local'), { vetor: (t) => vetorDe(t, { host: config.host, embedModel: config.embedModel || 'nomic-embed-text' }) });
  if (!busca.estado().arquivos) {
    return responder(en ? 'I haven\'t read your folders yet — it is happening in the background. Ask again in a few minutes.' : 'Ainda não terminei de ler as suas pastas — está acontecendo em segundo plano. Pergunte de novo daqui a alguns minutos.');
  }
  deps.emit?.('ferramenta', { nome: 'buscar_nos_seus_arquivos', argumentos: { consulta: pedido.consulta }, risco: 'leitura' });
  const achados = await busca.buscar(pedido.consulta, { n: 6 });
  if (!achados.length) {
    return responder(en ? `I didn't find anything about **"${pedido.consulta}"** in your folders.` : `Não achei nada sobre **"${pedido.consulta}"** nas suas pastas.`);
  }
  const bloco = {
    idioma: en ? 'en' : 'pt',
    itens: achados.map((a) => ({ caminho: a.caminho, nome: a.nome, pasta: path.basename(path.dirname(a.caminho)), data: quando(a.mtime, en), trecho: a.trecho })),
  };
  let topo = achados.length === 1 ? (en ? 'Found it:' : 'Achei:') : (en ? `I found ${achados.length} files — the first one fits best:` : `Achei ${achados.length} arquivos — o primeiro é o que mais bate:`);
  if (pedido.fato && deps.chamar) {
    const trechos = achados.slice(0, 3).map((a) => `[${a.nome}]\n${a.texto.slice(0, 3000)}`).join('\n\n');
    try {
      const r = await deps.chamar([
        { role: 'system', content: en
          ? "You answer from the user's own files below. Use ONLY what is written there and say which file the answer came from, by name. If the files don't have the answer, say so. Short and plain, in English."
          : 'Você responde pelos arquivos do próprio usuário, abaixo. Use SÓ o que está escrito neles e diga de qual arquivo veio a resposta, pelo nome. Se os arquivos não têm a resposta, diga isso. Curto e simples, em português do Brasil.' },
        { role: 'user', content: `${trechos}\n\n${en ? 'Question' : 'Pergunta'}: ${pergunta || pedido.consulta}` },
      ], { numPredict: 300 });
      const resposta = String(r?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (resposta) topo = `${resposta}\n\n${en ? 'Files:' : 'Arquivos:'}`;
    } catch {
      // sem o modelo: só os arquivos
    }
  }
  return responder(`${topo}\n\n\`\`\`arquivos\n${JSON.stringify(bloco)}\n\`\`\``);
}

module.exports = { pedidoDeBuscaLocal, responderBuscaLocal };
