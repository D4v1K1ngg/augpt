'use strict';

/**
 * Contas e boletos (31/10, pedido do Davi): o PDF do boleto anexado vira o valor, o vencimento, quem cobra e a
 * linha digitável, e um lembrete na Agenda para o dia anterior. "quais contas eu tenho este mês?" lista os boletos
 * guardados e o total. Tudo no PC: o PDF é lido pelo leitor do próprio AuGPT (src/formatos/pdf.js).
 *
 * A linha digitável só vale com os dígitos de verificação conferidos (módulo 10 e 11 da Febraban): um número
 * qualquer de 47 dígitos não vira boleto. O vencimento vem do texto ("Vencimento 07/11/2026") e, sem ele, do
 * fator de vencimento (a base mudou em 22/02/2025: o fator 1000 recomeça ali).
 */

const fs = require('fs');
const path = require('path');
const { pdf } = require('../formatos/pdf');
const { Agenda, paraData } = require('../agenda');
const { Sandbox } = require('../tools/sandbox');

const SEM_PESQUISA = { fontes: [], produto: false, assuntos: [], buscou: false, entendimento: { precisaBuscar: false, assuntos: [] } };
const ANEXOS = /(?:^|\n\n)Arquivos anexados, já copiados para a pasta de trabalho:\n((?:- .+\n?)+)Use ler_arquivo para abri-los\./;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const so = (t) => String(t).replace(/\D/g, '');

/* ------------------------------ dígitos de verificação ------------------------------ */

function modulo10(numero) {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** Módulo 11 do código de barras bancário (pesos 2 a 9; 0, 10 e 11 viram 1). */
function modulo11Banco(numero) {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação (contas de consumo): 0 e 1 viram 0 (10 vira 0 também). */
function modulo11Arrecadacao(numero) {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

/* ------------------------------ a linha digitável ------------------------------ */

const DIA = 86400000;

/** O fator de vencimento (4 dígitos) na data mais perto de hoje: a base de 1997 ou a nova, de 22/02/2025. */
function dataDoFator(fator, agora = new Date()) {
  if (!fator) return null;
  const antiga = Date.UTC(1997, 9, 7) + fator * DIA;
  const nova = Date.UTC(2025, 1, 22) + (fator - 1000) * DIA;
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const ms = fator >= 1000 && Math.abs(nova - hoje) < Math.abs(antiga - hoje) ? nova : antiga;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 47 dígitos (boleto bancário) com os DVs conferidos → { tipo, linha, valor, vencimentoDoFator } ou null. */
function lerLinhaBancaria(digitos, agora) {
  const l = so(digitos);
  if (l.length !== 47) return null;
  const campos = [[0, 9], [10, 20], [21, 31]];
  const dvs = [9, 20, 31];
  if (!campos.every(([a, b], i) => modulo10(l.slice(a, b)) === Number(l[dvs[i]]))) return null;
  const barras = l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
  if (modulo11Banco(barras.slice(0, 4) + barras.slice(5)) !== Number(barras[4])) return null;
  const fator = Number(l.slice(33, 37));
  const valor = Number(l.slice(37, 47)) / 100;
  const formatada = `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
  return { tipo: 'bancario', linha: formatada, valor: valor || null, vencimentoDoFator: dataDoFator(fator, agora) };
}

/** 48 dígitos (conta de luz, água, telefone, imposto) com os DVs conferidos → { tipo, linha, valor } ou null. */
function lerLinhaArrecadacao(digitos) {
  const l = so(digitos);
  if (l.length !== 48 || l[0] !== '8') return null;
  const blocos = [0, 12, 24, 36].map((i) => l.slice(i, i + 12));
  const comMod10 = l[2] === '6' || l[2] === '7';
  const dv = comMod10 ? modulo10 : modulo11Arrecadacao;
  if (!blocos.every((b) => dv(b.slice(0, 11)) === Number(b[11]))) return null;
  const barras = blocos.map((b) => b.slice(0, 11)).join('');
  if (dv(barras.slice(0, 3) + barras.slice(4)) !== Number(barras[3])) return null;
  // identificador 6 ou 8: o valor efetivo está no código; 7 ou 9: é referência (vale o do texto)
  const valor = l[2] === '6' || l[2] === '8' ? Number(barras.slice(4, 15)) / 100 : null;
  return { tipo: 'arrecadacao', linha: blocos.map((b) => `${b.slice(0, 11)}-${b[11]}`).join(' '), valor: valor || null, vencimentoDoFator: null };
}

/** A linha digitável no texto do PDF (com pontos, espaços e quebras no meio). */
function acharLinha(texto, agora = new Date()) {
  const corrido = String(texto || '').replace(/[.\-\s]/g, ' ');
  // sequências de dígitos e espaços longas o bastante
  for (const m of corrido.matchAll(/\d[\d ]{45,80}\d/g)) {
    const d = so(m[0]);
    for (let i = 0; i + 47 <= d.length; i += 1) {
      const banco = lerLinhaBancaria(d.slice(i, i + 47), agora);
      if (banco) return banco;
      const conta = d[i] === '8' && i + 48 <= d.length ? lerLinhaArrecadacao(d.slice(i, i + 48)) : null;
      if (conta) return conta;
    }
  }
  return null;
}

const DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;

/** O que o texto diz: vencimento, valor e quem cobra. */
function lerTexto(texto) {
  const t = String(texto || '');
  const venc = /vencimento\s*:?\s*(?:\n\s*)?(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] || null;
  const valorTxt = /valor\s+(?:do\s+documento|cobrado|a\s+pagar|total)?\s*:?\s*(?:\n\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(t)?.[1] || null;
  const quem = /(?:benefici[áa]rio|cedente)\s*(?:final)?\s*:?\s*(?:\n\s*)?([^\n]{3,80})/i.exec(t)?.[1]?.replace(/\s*(CNPJ|CPF|Ag[êe]ncia).*$/i, '').trim() || null;
  const iso = (d) => { const m = DATA.exec(d || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  return { vencimento: iso(venc), valor: valorTxt ? Number(valorTxt.replace(/\./g, '').replace(',', '.')) : null, beneficiario: quem };
}

/* ------------------------------ que pedido é ------------------------------ */

const PDF_ANEXADO = (objetivo) => {
  const m = ANEXOS.exec(String(objetivo || ''));
  if (!m) return [];
  return m[1].split('\n').map((l) => l.replace(/^- /, '').replace(/ \([^)]*\)\s*$/, '').trim()).filter((a) => /\.pdf$/i.test(a));
};

/**
 * O boleto anexado (lido aqui, para só aceitar quando é mesmo um boleto) → { boletos: [...], pergunta } ou null.
 * `workspace`: a pasta de trabalho, onde o anexo foi copiado.
 */
function pedidoDeBoleto(objetivo, { workspace, agora = new Date() } = {}) {
  const pdfs = PDF_ANEXADO(objetivo);
  if (!pdfs.length || !workspace || pdfs.length > 6) return null;
  const pergunta = String(objetivo).replace(ANEXOS, '').trim();
  // "resuma este contrato" com um PDF: não é conta — só olha se o pedido é vazio ou fala de pagar
  if (pergunta && !/\b(boleto|boletos|conta|contas|fatura|pagar|pagamento|vencimento|vence|lembr|agenda|anota|quanto|valor|linha digitavel|codigo de barras|o que e isso|o que e isto)\b/.test(semAcento(pergunta))) return null;
  const boletos = [];
  for (const rel of pdfs) {
    try {
      const arquivo = new Sandbox(workspace).resolve(rel); // dentro da pasta de trabalho, ou erro
      if (fs.statSync(arquivo).size > 8 * 1024 * 1024) continue;
      const { texto } = pdf(fs.readFileSync(arquivo), { caminho: arquivo, limite: 60_000 });
      const linha = acharLinha(texto, agora);
      if (!linha) continue;
      const doTexto = lerTexto(texto);
      boletos.push({
        nome: path.basename(rel),
        linha: linha.linha,
        tipo: linha.tipo,
        valor: linha.valor || doTexto.valor,
        vencimento: doTexto.vencimento || linha.vencimentoDoFator,
        beneficiario: doTexto.beneficiario,
      });
    } catch {
      // PDF que não abre: o agente cuida dele
    }
  }
  // todos os PDFs têm de ser boletos; senão, o agente (que lê qualquer PDF) responde
  return boletos.length === pdfs.length ? { acao: 'ler', boletos, pergunta } : null;
}

const CONTAS = /^(quais|que) (contas|boletos)( eu)? (tenho|tem|faltam|vencem)|^(minhas|as) contas (do mes|deste mes|desse mes|da semana)|^(contas|boletos) (do mes|deste mes|a pagar|pra pagar|para pagar|pendentes)|^quanto (eu )?(tenho|falta) (de contas|pra pagar|para pagar)/;
const pedidoDeContas = (texto) => (CONTAS.test(semAcento(texto).replace(/^(ei |ok )?(jarvis|augpt|gpt)[,!.]?\s*/, '').trim()) ? { acao: 'listar' } : null);

/* ------------------------------ a resposta ------------------------------ */

const reais = (v, en) => (v == null ? (en ? 'amount not found' : 'valor não encontrado') : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dataBonita = (iso, en) => new Date(`${iso}T12:00:00`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

function responderBoleto({ pedido, deps = {}, config = {}, pasta, agora = new Date() }) {
  const en = config.idiomaEfetivo === 'en';
  const responder = (texto) => {
    deps.emit?.('resposta-token', { pedaco: texto, noIdioma: en });
    deps.emit?.('agenda-mudou', {});
    return { ...SEM_PESQUISA, texto, modo: 'boleto', noIdioma: en };
  };
  const agenda = pasta ? new Agenda(pasta) : null;
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  if (pedido.acao === 'listar') {
    // os próximos 30 dias e as vencidas ainda não marcadas como feitas ("este mês" no dia 31 não acharia o boleto do dia 7)
    const ate = new Date(hoje.getTime() + 31 * DIA);
    const contas = (agenda?.listar() || []).filter((i) => i.conta && !i.feito && i.conta.vencimento && new Date(`${i.conta.vencimento}T12:00:00`) < ate).sort((a, b) => a.conta.vencimento.localeCompare(b.conta.vencimento));
    if (!contas.length) return responder(en ? 'No bills to pay in the next 30 days. Attach the bill PDF and I\'ll read it.' : 'Nenhuma conta a pagar nos próximos 30 dias. Anexe o PDF do boleto que eu leio.');
    const total = contas.reduce((n, i) => n + (i.conta.valor || 0), 0);
    const linhas = contas.map((i) => {
      const vencida = new Date(`${i.conta.vencimento}T12:00:00`) < hoje;
      return `- **${dataBonita(i.conta.vencimento, en)}** — ${i.conta.beneficiario || i.titulo}: ${reais(i.conta.valor, en)}${vencida ? (en ? ' ⚠️ overdue' : ' ⚠️ vencida') : ''}`;
    });
    return responder(`${en ? 'Bills to pay (next 30 days):' : 'Contas a pagar (próximos 30 dias):'}\n\n${linhas.join('\n')}\n\n**${en ? 'Total' : 'Total'}: ${reais(total, en)}**`);
  }

  const partes = [];
  for (const b of pedido.boletos) {
    const quem = b.beneficiario ? ` ${en ? 'from' : 'de'} **${b.beneficiario}**` : '';
    let quando = '';
    let lembrete = '';
    if (b.vencimento) {
      const dia = new Date(`${b.vencimento}T12:00:00`);
      const faltam = Math.round((new Date(dia.getFullYear(), dia.getMonth(), dia.getDate()) - hoje) / DIA);
      quando = faltam < 0
        ? (en ? `, **overdue** since ${dataBonita(b.vencimento, true)} (${-faltam} days ago) — check the late fee before paying` : `, **venceu** em ${dataBonita(b.vencimento, false)} (há ${-faltam} dias) — confira juros e multa antes de pagar`)
        : faltam === 0 ? (en ? ', due **today**' : ', vence **hoje**')
        : (en ? `, due **${dataBonita(b.vencimento, true)}** (in ${faltam} days)` : `, vence **${dataBonita(b.vencimento, false)}** (daqui a ${faltam} dia${faltam > 1 ? 's' : ''})`);
      // o lembrete: 9h do dia anterior; vencendo hoje ou amanhã, daqui a 1 hora; vencida, nenhum
      if (agenda && faltam >= 0) {
        const ja = agenda.listar().find((i) => i.conta?.linha === b.linha);
        let alvo = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() - 1, 9, 0);
        if (alvo <= agora) alvo = new Date(agora.getTime() + 3600000);
        const quandoIso = `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')}T${String(alvo.getHours()).padStart(2, '0')}:${String(alvo.getMinutes()).padStart(2, '0')}`;
        if (!ja) {
          agenda.adicionar({ tipo: 'lembrete', titulo: `${en ? 'Pay the bill' : 'Pagar o boleto'}${b.beneficiario ? ` ${en ? 'from' : 'de'} ${b.beneficiario}` : ''} — ${reais(b.valor, en)}`, quando: quandoIso, conta: { linha: b.linha, valor: b.valor, vencimento: b.vencimento, beneficiario: b.beneficiario } });
        }
        const d = paraData(quandoIso);
        lembrete = ja
          ? (en ? 'This bill was already in your agenda.' : 'Este boleto já estava na sua agenda.')
          : (en ? `I'll remind you on ${d.toLocaleDateString('en-US', { weekday: 'long' })} at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} (it's in **Agenda**).` : `Te lembro ${d.toLocaleDateString('pt-BR', { weekday: 'long' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (está na **Agenda**).`);
      }
    }
    const tipo = b.tipo === 'arrecadacao' ? (en ? 'Bill' : 'Conta') : (en ? 'Bank slip' : 'Boleto');
    partes.push(`🧾 **${tipo}**${quem} — **${reais(b.valor, en)}**${quando}.${lembrete ? ` ${lembrete}` : ''}\n\n${en ? 'Typeable line (checked):' : 'Linha digitável (conferida):'}\n\n\`\`\`\n${b.linha}\n\`\`\``);
  }
  const fim = en
    ? 'Before paying, check in your bank app that the **beneficiary** matches who you owe — that is where boleto scams show up.'
    : 'Antes de pagar, confira no app do banco se o **beneficiário** é mesmo quem você deve — é ali que aparece o golpe do boleto.';
  return responder(`${partes.join('\n\n')}\n\n${fim}`);
}

module.exports = { pedidoDeBoleto, pedidoDeContas, responderBoleto, acharLinha, lerLinhaBancaria, lerLinhaArrecadacao, lerTexto, dataDoFator, modulo10, modulo11Banco, modulo11Arrecadacao };
