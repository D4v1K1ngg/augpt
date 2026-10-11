'use strict';

const fs = require('fs');
const path = require('path');
const { normalizarProduto } = require('./normalizar');

/**
 * Histórico de preços.
 *
 * É a parte mais valiosa do módulo de compras e a mais simples: guardar o que
 * já foi consultado. Sem histórico próprio não existe tendência, e não existe
 * como desconfiar de "de R$ 5.999 por R$ 2.999" — a única defesa contra falso
 * desconto é ter visto o preço antes.
 *
 * Fica na pasta de trabalho, em JSON legível. É dado do usuário, não do
 * programa.
 */

const LIMITE_POR_PRODUTO = 200;
const LIMITE_PRODUTOS = 300;

class HistoricoDePrecos {
  constructor(dir) {
    this.arquivo = path.join(dir, 'precos.json');
    this.dados = this.carregar();
  }

  carregar() {
    try {
      const bruto = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      return bruto && typeof bruto === 'object' ? bruto : {};
    } catch {
      return {};
    }
  }

  gravar() {
    try {
      fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
      fs.writeFileSync(this.arquivo, JSON.stringify(this.dados, null, 1), 'utf8');
    } catch {
      /* sem permissão: o histórico apenas não persiste */
    }
  }

  /** Registra uma observação. Mesma loja no mesmo dia atualiza em vez de duplicar. */
  registrar({ produto, loja, preco, total, url, confianca }) {
    if (!produto || !preco) return null;
    const chave = normalizarProduto(produto).chave || produto.slice(0, 40);
    const hoje = new Date().toISOString().slice(0, 10);

    this.dados[chave] = this.dados[chave] || { produto: produto.slice(0, 140), observacoes: [] };
    const lista = this.dados[chave].observacoes;

    const existente = lista.find((o) => o.data === hoje && o.loja === loja);
    if (existente) {
      Object.assign(existente, { preco, total: total ?? preco, url, confianca });
    } else {
      lista.push({ data: hoje, em: new Date().toISOString(), loja, preco, total: total ?? preco, url, confianca });
    }

    if (lista.length > LIMITE_POR_PRODUTO) lista.splice(0, lista.length - LIMITE_POR_PRODUTO);

    const chaves = Object.keys(this.dados);
    if (chaves.length > LIMITE_PRODUTOS) {
      // descarta o que não é consultado há mais tempo
      chaves
        .map((k) => ({ k, ultimo: this.dados[k].observacoes.at(-1)?.em || '' }))
        .sort((a, b) => String(a.ultimo).localeCompare(String(b.ultimo)))
        .slice(0, chaves.length - LIMITE_PRODUTOS)
        .forEach(({ k }) => delete this.dados[k]);
    }

    this.gravar();
    return chave;
  }

  /** Busca por aproximação: o usuário não digita a chave normalizada. */
  encontrar(consulta) {
    const alvo = normalizarProduto(consulta).chave.split('-').filter(Boolean);
    if (!alvo.length) return null;

    let melhor = null;
    let melhorNota = 0;
    for (const [chave, registro] of Object.entries(this.dados)) {
      const palavras = chave.split('-');
      const comuns = alvo.filter((p) => palavras.includes(p)).length;
      const nota = comuns / Math.max(alvo.length, 1);
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = { chave, ...registro };
      }
    }
    return melhorNota >= 0.5 ? melhor : null;
  }

  /**
   * Série por dia, usando o MENOR preço observado em cada data — que é o que
   * interessa a quem compara, e evita que uma loja cara distorça a curva.
   */
  serie(chaveOuConsulta) {
    const registro = this.dados[chaveOuConsulta] || this.encontrar(chaveOuConsulta);
    if (!registro) return null;

    const porDia = new Map();
    for (const o of registro.observacoes) {
      const atual = porDia.get(o.data);
      if (!atual || o.total < atual.total) porDia.set(o.data, o);
    }

    const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const valores = dias.map(([, o]) => o.total);

    return {
      produto: registro.produto,
      dias: dias.map(([data]) => data),
      valores,
      lojas: [...new Set(registro.observacoes.map((o) => o.loja))],
      minimo: Math.min(...valores),
      maximo: Math.max(...valores),
      atual: valores.at(-1),
      observacoes: registro.observacoes.length,
    };
  }

  /**
   * O "de R$ X por R$ Y" bate com o que já foi visto?
   * Devolve null quando não há histórico suficiente — dizer "é falso desconto"
   * sem base seria tão irresponsável quanto acreditar no anúncio.
   */
  avaliarDesconto(consulta, { precoDe, precoPor }) {
    const s = this.serie(consulta);
    if (!s || s.observacoes < 3) return null;

    const referencia = Number(precoDe);
    const oferta = Number(precoPor);
    if (!referencia || !oferta) return null;

    const acimaDoMaximo = referencia > s.maximo * 1.05;
    const ofertaComum = oferta >= s.minimo * 0.98;

    return {
      maximoObservado: s.maximo,
      minimoObservado: s.minimo,
      observacoes: s.observacoes,
      desde: s.dias[0],
      suspeito: acimaDoMaximo || ofertaComum,
      motivo: acimaDoMaximo
        ? `o preço "de" (${referencia}) é maior que o máximo já observado (${s.maximo})`
        : ofertaComum
          ? `o preço "por" está no patamar habitual — o mínimo já observado foi ${s.minimo}`
          : 'o desconto é compatível com o histórico',
    };
  }

  limpar() {
    const total = Object.keys(this.dados).length;
    this.dados = {};
    this.gravar();
    return total;
  }
}

module.exports = { HistoricoDePrecos };
