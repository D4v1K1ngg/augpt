'use strict';

/**
 * Credenciais fora de tudo que fica gravado (07/10/2026, execução real do
 * contracheque). O agente repetia login e senha no plano, na pergunta ao
 * usuário e na resposta final — e cada passo ia pra memória permanente com os
 * argumentos inteiros, inclusive o `valor` do campo de senha. Dali a senha
 * voltava como "MEMÓRIA RELEVANTE" em tarefas sem relação nenhuma, e o
 * relatório exportado (que já foi mandado pra outras IAs analisarem) levava
 * tudo junto.
 *
 * O modelo continua vendo o pedido inteiro (precisa do valor pra preencher o
 * campo); o que muda é o que SAI dele: eventos (tela, registro, conversa
 * salva) e memória passam por `mascarar`.
 */

const MASCARA = '••••••';

// palavra que anuncia um segredo; o valor é o 1º token depois dela que não
// é conector ("login e senha: 0100/abc123", "a senha de acesso é 4821")
const ANUNCIO = /\b(senha|password|passwd|pin|token|login|usu[aá]rio|user(?:name)?|matr[ií]cula|cpf)\b/gi;
const CONECTOR = new Set([
  'e', 'é', 'eh', 'de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'meu', 'minha', 'meus', 'minhas', 'acesso', 'senha', 'senhas',
  'login', 'usuario', 'usuário', 'user', 'password', 'pin', 'são', 'sao', 'seria', 'será', 'sera', 'fica', 'vai', 'ser', ':', '=', '-', '–',
]);

// palavras que vêm depois de "senha"/"usuário" sem ser o valor
const NAO_E_VALOR = new Set([
  'esta', 'está', 'estao', 'estão', 'correta', 'correto', 'certa', 'certo', 'errada', 'errado', 'nova', 'novo', 'antiga',
  'antigo', 'forte', 'fraca', 'informada', 'informado', 'digitada', 'digitado', 'fornecida', 'fornecido', 'dele', 'dela',
  'no', 'na', 'em', 'para', 'pra', 'que', 'nao', 'não', 'sim', 'pode', 'precisa', 'tem', 'foi', 'campo', 'acima', 'abaixo',
  'mesma', 'mesmo', 'dessa', 'desse', 'deste', 'desta', 'pediu', 'pede', 'quer', 'final', 'agent', 'page', 'com', 'oauth',
]);

/**
 * Um valor só conta como segredo com sinal forte (2ª revisão): tem dígito, ou
 * símbolo no MEIO e 6+ caracteres. "usuário-final", "senha (anotada no
 * papel)", "token (JWT)" não são credencial.
 */
function pareceCredencial(valor) {
  if (!valor || valor.length < 3 || valor.length > 64) return false;
  if (/^[-–_.]/.test(valor) || NAO_E_VALOR.has(valor.toLowerCase())) return false;
  if (/\d/.test(valor)) return true;
  return valor.length >= 6 && /[A-Za-z].*[@#$%&*_!?.-].*|[@#$%&*_!].*[A-Za-z]/.test(valor) && /[@#$%&*_!]/.test(valor);
}

/** Valores secretos escritos no texto (pedido ou mensagens do usuário). */
function segredosDoTexto(texto) {
  const t = String(texto || '');
  const achados = new Set();
  for (const m of t.matchAll(ANUNCIO)) {
    // os próximos tokens depois da palavra-chave: parêntese/aspas valem como um bloco
    const resto = t.slice(m.index + m[0].length, m.index + m[0].length + 120);
    const tokens = resto.match(/\([^()]{1,70}\)|["“'‘][^"“”'‘’]{1,70}["”'’]|[^\s,;()]+/g) || [];
    for (const bruto of tokens.slice(0, 8)) {
      const delimitado = /^[("“'‘]/.test(bruto);
      let tok = delimitado ? bruto.slice(1, -1).trim() : bruto.replace(/[.,;?)]+$/, '');
      const semPontuacao = tok.toLowerCase().replace(/[:=]+$/, '');
      if (!delimitado && (!semPontuacao || CONECTOR.has(semPontuacao))) continue;
      // bloco entre parênteses com espaço é frase ("anotada no papel"), não valor
      if (delimitado && /\s/.test(tok)) break;
      tok = tok.replace(/^[:=]+/, '');
      // "0100/abc123": login/senha juntos
      for (const parte of tok.includes('/') && !/^https?:/i.test(tok) ? tok.split('/') : [tok]) if (pareceCredencial(parte)) achados.add(parte);
      break;
    }
  }
  return [...achados];
}

function escaparRegex(t) {
  return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Troca cada segredo por •••••• (texto qualquer). */
function mascarar(texto, segredos) {
  if (typeof texto !== 'string' || !segredos?.length) return texto;
  let saida = texto;
  for (const s of segredos) {
    if (!s || s.length < 3) continue;
    saida = saida.replace(new RegExp(escaparRegex(s), 'g'), MASCARA);
  }
  return saida;
}

/** Mesma coisa em objetos e listas (eventos), sem mexer no original. */
function mascararProfundo(valor, segredos, profundidade = 0) {
  if (!segredos?.length) return valor;
  if (typeof valor === 'string') return mascarar(valor, segredos);
  if (!valor || typeof valor !== 'object' || profundidade > 8) return valor;
  if (Array.isArray(valor)) return valor.map((v) => mascararProfundo(v, segredos, profundidade + 1));
  // só objeto "de dados" — instância de classe (Tarefa, Error…) passa intacta
  const proto = Object.getPrototypeOf(valor);
  if (proto !== Object.prototype && proto !== null) return valor;
  const copia = {};
  // ids (aprovacao-<timestamp>-…) não são mascarados: um segredo de 3–4
  // dígitos dentro do timestamp quebraria a resposta do usuário ao cartão
  for (const [k, v] of Object.entries(valor)) copia[k] = k === 'id' ? v : mascararProfundo(v, segredos, profundidade + 1);
  return copia;
}

module.exports = { MASCARA, segredosDoTexto, pareceCredencial, mascarar, mascararProfundo };
