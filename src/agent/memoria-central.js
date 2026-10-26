'use strict';

const fs = require('fs');
const path = require('path');
const { cosine, vetorDe } = require('./embeddings');

/**
 * Memória central.
 *
 * A memória vetorial (`memory.js`) e a operacional (`memoria-operacional.js`)
 * vivem dentro da PASTA DE TRABALHO — trocar de pasta é começar do zero. Esta
 * mora em `userData`, no nível do aplicativo: fatos duráveis sobre o usuário
 * ("meu nome é Davi", "prefiro resposta em tabela", "trabalho em português")
 * que valem para qualquer pasta, qualquer projeto.
 *
 * Inspirada na "core memory" do MemGPT/Letta: pequena, sempre presente no
 * prompt (não filtrada por relevância como a vetorial), e curada pelo próprio
 * agente através de uma ferramenta dedicada — não um efeito colateral de
 * `salvar_memoria`, que guarda fato de execução, não identidade do usuário.
 */

const LIMITE_ITENS = 40;
const LIMITE_PROMPT = 1500; // caracteres do bloco injetado — precisa ficar pequeno, entra sempre

// Item 7 da análise comparativa (pedido do Davi 2026-09-22, "supressão de fato
// quase-duplicado"): mesmo limiar já validado em produção por
// `credibilidadePorClustering()` (memoria-operacional.js) para o mesmo tipo de
// decisão (cosseno de embedding decidindo "é o mesmo fato/domínio ou não") —
// reaproveitado aqui de propósito, não um valor novo escolhido a dedo.
const LIMIAR_QUASE_DUPLICATA = 0.85;

function normalizarChave(chave) {
  return String(chave || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

class MemoriaCentral {
  constructor(userDataPath) {
    this.arquivo = path.join(userDataPath, 'memoria-central.json');
    this.itens = [];
    this.carregar();
  }

  carregar() {
    try {
      this.itens = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
    } catch {
      this.itens = [];
    }
    return this.itens;
  }

  gravar() {
    try {
      fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
      fs.writeFileSync(this.arquivo, JSON.stringify(this.itens, null, 2), 'utf8');
    } catch {
      /* sem permissão de escrita: a memória central apenas não persiste */
    }
  }

  /** Grava ou substitui um fato. Chave repetida atualiza em vez de duplicar. */
  definir({ chave, valor }) {
    const chaveNormalizada = normalizarChave(chave);
    const texto = String(valor || '').trim().slice(0, 240);
    if (!chaveNormalizada || !texto) return null;

    const existente = this.itens.find((i) => i.chave === chaveNormalizada);
    if (existente) {
      // `encontrarQuaseDuplicata()` abaixo cacheia o vetor do TEXTO atual em
      // `existente.vec` (mesmo truque de `credibilidadePorClustering()`); se o
      // valor muda, esse vetor cacheado fica descrevendo um texto que não
      // existe mais — melhor recalcular na próxima comparação do que comparar
      // contra um fato desatualizado.
      if (existente.valor !== texto) delete existente.vec;
      existente.valor = texto;
      existente.em = new Date().toISOString();
    } else {
      this.itens.push({ chave: chaveNormalizada, valor: texto, em: new Date().toISOString() });
    }

    // pequena de propósito: sem isso o bloco "sempre no prompt" cresceria sem
    // limite e passaria a competir por espaço com o que muda a cada pedido
    if (this.itens.length > LIMITE_ITENS) {
      this.itens.sort((a, b) => String(b.em).localeCompare(String(a.em)));
      this.itens = this.itens.slice(0, LIMITE_ITENS);
    }
    this.gravar();
    return this.itens.find((i) => i.chave === chaveNormalizada);
  }

  /**
   * Item 7 da análise comparativa (pedido do Davi 2026-09-22, "supressão de
   * fato quase-duplicado em memória"): `definir()` acima só dedupe por CHAVE
   * exatamente igual (normalizada) — mas quem escolhe a chave a cada chamada
   * da ferramenta `atualizar_memoria_central` é o próprio modelo, e nada
   * garante que ele escolha SEMPRE a mesma palavra para o mesmo fato
   * ("formato_preferido" numa conversa, "formato_resposta" ou
   * "prefere_tabela" noutra). Sem isto, cada variação de palavra vira uma
   * entrada NOVA — e aqui, diferente da memória operacional (cujo
   * `paraPrompt()` filtra por relevância ao pedido), `paraPrompt()` é "core
   * memory": entra por completo no prompt até o limite de caracteres, então
   * um fato duplicado ocupa espaço fixo de `LIMITE_ITENS`/`LIMITE_PROMPT` que
   * um fato DIFERENTE, não-redundante, poderia ter usado.
   *
   * (Investigação que acompanha esta mudança: `memoria-operacional.js` foi
   * checada e NÃO tem o mesmo risco — toda chamada de `aprender()` ali usa
   * uma `chave` derivada por código, nunca escolhida livremente pelo modelo
   * — domínio via `dominioDe()`, nome de ferramenta literal, nome de skill.
   * Por isso o escopo deste item ficou só na memória central.)
   *
   * Reaproveita o MESMO padrão de `credibilidadePorClustering()` em
   * `memoria-operacional.js` (cosseno + limiar alto, vetor cacheado no
   * próprio item): compara o embedding do fato novo contra os fatos JÁ
   * existentes (excluindo a própria chave — essa `definir()` já resolve por
   * igualdade exata) e devolve o item mais parecido, se passar do limiar.
   * Quem chama decide gravar usando a chave DELE em vez de criar uma entrada
   * nova — não decide sozinho aqui dentro, pra quem chama poder avisar o
   * usuário/modelo do que aconteceu. Sai de fora sem custo nenhum
   * (`embedModel` ausente, ou nenhum outro fato gravado ainda) — mesma
   * degradação graciosa do resto do projeto.
   */
  async encontrarQuaseDuplicata({ chave, valor, host, embedModel }) {
    if (!embedModel) return null;
    const chaveNormalizada = normalizarChave(chave);
    const candidatos = this.itens.filter((i) => i.chave !== chaveNormalizada);
    if (!candidatos.length) return null;

    const vetorNovo = await vetorDe(`${chave} ${valor}`.trim(), { host, embedModel });
    if (!vetorNovo) return null;

    let melhor = null;
    let melhorScore = 0;
    for (const candidato of candidatos) {
      // eslint-disable-next-line no-await-in-loop -- lista cabe em LIMITE_ITENS (40), e a maioria já vem cacheada em candidato.vec
      const vetorCandidato = candidato.vec || (await vetorDe(`${candidato.chave} ${candidato.valor}`.trim(), { host, embedModel }));
      if (!vetorCandidato) continue;
      if (!candidato.vec) candidato.vec = vetorCandidato;
      const score = cosine(vetorNovo, vetorCandidato);
      if (score > melhorScore) {
        melhorScore = score;
        melhor = candidato;
      }
    }
    if (!melhor || melhorScore <= LIMIAR_QUASE_DUPLICATA) return null;

    this.gravar(); // persiste os vetores de candidato calculados agora (cache entre execuções, como credibilidadePorClustering já faz)
    return melhor;
  }

  esquecer(chave) {
    const chaveNormalizada = normalizarChave(chave);
    const antes = this.itens.length;
    this.itens = this.itens.filter((i) => i.chave !== chaveNormalizada);
    this.gravar();
    return antes - this.itens.length;
  }

  limpar() {
    const total = this.itens.length;
    this.itens = [];
    this.gravar();
    return total;
  }

  listar() {
    return [...this.itens].sort((a, b) => String(b.em).localeCompare(String(a.em)));
  }

  /**
   * Bloco para o prompt de sistema. Diferente da memória operacional, não é
   * filtrado por relevância ao pedido — é "core memory": pouca coisa, mas
   * sempre visível, porque é sobre quem é o usuário, não sobre a tarefa atual.
   */
  paraPrompt({ instrucoes } = {}) {
    if (!this.itens.length) return '';
    const linhas = [];
    let total = 0;
    // `instrucoes` (27/10): as instruções por assunto que valem para este pedido; sem a lista, todas
    for (const item of this.listar().filter((i) => !instrucoes || !i.chave.startsWith('instrucao_') || instrucoes.has(i.chave))) {
      const linha = `- ${item.chave}: ${item.valor}`;
      if (total + linha.length > LIMITE_PROMPT) break;
      linhas.push(linha);
      total += linha.length;
    }
    return linhas.length
      ? `\nO QUE VOCÊ SABE SOBRE O USUÁRIO (vale para qualquer pasta de trabalho; uma linha "Quando o assunto for X" vale só se o pedido for sobre X):\n${linhas.join('\n')}\n`
      : '';
  }
}

module.exports = { MemoriaCentral, normalizarChave, LIMITE_ITENS, LIMIAR_QUASE_DUPLICATA };
