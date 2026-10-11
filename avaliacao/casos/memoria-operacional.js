'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoriaOperacional, estadoDoItem } = require('../../src/agent/memoria-operacional');

/**
 * Item 2 do consenso com o Davi sobre o documento de arquitetura de memória
 * (2026-09-21): estados de confiança/validade pra itens da memória
 * operacional (site/ferramenta/estratégia/preferência) — antes desta
 * correção, uma lição NOVA que contradizia uma já CONFIRMADA (`vezes >=
 * minimoPara`) simplesmente apagava a antiga e recomeçava a contagem do
 * zero, sem deixar rastro nenhum: a próxima observação isolada da lição nova
 * já era tratada com a MESMA confiança de uma primeira observação qualquer.
 *
 * A correção (`aprender()`/`saber()`/`paraPrompt()`/`listar()` em
 * memoria-operacional.js) marca a lição nova como `contraditadoPor` quando
 * ela substitui uma que já tinha confiança, e exige o DOBRO de observações
 * (`limiarConfianca`) antes de `saber()` voltar a confiar nela — sem apagar
 * o histórico, sem grafo, sem tabela nova: só um campo a mais no mesmo item
 * e uma barra que muda de altura, o mesmo espírito do saldo que
 * `credibilidade` já usa.
 */
function novaMemoria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-operacional-'));
  return new MemoriaOperacional(dir);
}

module.exports = [
  {
    nome: 'aprender: lição repetida até o mínimo vira "confirmado" — comportamento de sempre, sem contradição nenhuma',
    tipo: 'unidade',
    async executar() {
      const memoria = novaMemoria();
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'precisa de JS' });
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'precisa de JS' });
      const item = memoria.itens.find((i) => i.chave === 'exemplo.com');
      return [
        Boolean(memoria.saber('site', 'exemplo.com')) || 'esperava saber() confiar após 2 observações da mesma lição (mínimo do tipo "site")',
        estadoDoItem(item) === 'confirmado' || `esperava estado "confirmado", obteve "${estadoDoItem(item)}"`,
        !item.contraditadoPor || 'não deveria ter marca de contradição — nunca houve lição diferente antes',
      ];
    },
  },

  {
    nome: 'aprender: lição diferente que substitui uma AINDA NÃO confirmada é troca simples, sem marca de contradição',
    tipo: 'unidade',
    async executar() {
      const memoria = novaMemoria();
      // só 1 observação — "precisa de JS" nunca chegou ao mínimo (2) do tipo "site"
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'precisa de JS' });
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'bloqueia raspagem' });
      const item = memoria.itens.find((i) => i.chave === 'exemplo.com');
      return [
        item.licao === 'bloqueia raspagem' || `esperava a lição nova, obteve "${item.licao}"`,
        !item.contraditadoPor || 'não deveria marcar contradição — a lição anterior nunca tinha ficado confiável',
        estadoDoItem(item) === 'não confirmado' || `esperava estado "não confirmado", obteve "${estadoDoItem(item)}"`,
      ];
    },
  },

  {
    // O caso central desta correção: o bug real que o documento do Davi
    // descrevia (uma lição contraditada reconquistando confiança rápido
    // demais, como se nunca tivesse sido contestada).
    nome: 'aprender: lição diferente que substitui uma JÁ CONFIRMADA fica marcada — exige o DOBRO de reconfirmações, não reconquista confiança no mesmo ritmo de antes',
    tipo: 'unidade',
    async executar() {
      const memoria = novaMemoria();
      // "precisa de JS" chega a CONFIRMADO (mínimo do tipo "site" = 2)
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'precisa de JS' });
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'precisa de JS' });
      if (!memoria.saber('site', 'exemplo.com')) return ['pré-condição falhou: "precisa de JS" deveria estar confirmado antes da contradição'];

      // contradiz: o site mudou, "não precisa mais de JS"
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'não precisa mais de JS' });
      let item = memoria.itens.find((i) => i.chave === 'exemplo.com');
      const falhas = [];
      if (item.contraditadoPor !== 'precisa de JS') falhas.push(`esperava contraditadoPor="precisa de JS", obteve "${item.contraditadoPor}"`);
      if (estadoDoItem(item) !== 'contraditado — aguardando reconfirmação') falhas.push(`esperava estado de contradição, obteve "${estadoDoItem(item)}"`);
      if (memoria.saber('site', 'exemplo.com')) falhas.push('saber() não deveria confiar ainda — só 1 observação da lição nova, contraditada');

      // reforça a lição NOVA até bater o mínimo NORMAL (2) — antes desta
      // correção, isso já seria suficiente pra "confirmado" de novo. Com a
      // correção, ainda não é (precisa de 4 — o dobro).
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'não precisa mais de JS' });
      item = memoria.itens.find((i) => i.chave === 'exemplo.com');
      if (memoria.saber('site', 'exemplo.com')) {
        falhas.push('REGRESSÃO: saber() voltou a confiar na lição contraditada só com o mínimo normal (2) — a barra dobrada não foi aplicada');
      }
      if (estadoDoItem(item) !== 'contraditado — aguardando reconfirmação') {
        falhas.push(`com 2 observações ainda deveria estar "aguardando reconfirmação", obteve "${estadoDoItem(item)}"`);
      }

      // completa o dobro (4 observações da lição nova) — agora sim estável.
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'não precisa mais de JS' });
      memoria.aprender({ tipo: 'site', chave: 'exemplo.com', licao: 'não precisa mais de JS' });
      item = memoria.itens.find((i) => i.chave === 'exemplo.com');
      if (!memoria.saber('site', 'exemplo.com')) falhas.push('esperava saber() confiar após 4 observações (o dobro) da lição reconfirmada');
      if (estadoDoItem(item) !== 'estável (reconfirmada após contradição)') {
        falhas.push(`esperava estado "estável (reconfirmada após contradição)", obteve "${estadoDoItem(item)}"`);
      }

      return falhas.length ? falhas : [true];
    },
  },

  {
    nome: 'paraPrompt: lição contraditada (ainda não reconfirmada em dobro) não entra no bloco do prompt',
    tipo: 'unidade',
    async executar() {
      const memoria = novaMemoria();
      memoria.aprender({ tipo: 'ferramenta', chave: 'conversor', licao: 'aceita só CSV' });
      memoria.aprender({ tipo: 'ferramenta', chave: 'conversor', licao: 'aceita só CSV' });
      memoria.aprender({ tipo: 'ferramenta', chave: 'conversor', licao: 'aceita CSV e XLSX agora' });
      const bloco = memoria.paraPrompt('preciso converter uma planilha com o conversor');
      return [
        !bloco.includes('aceita CSV e XLSX agora') ||
          'a lição recém-contraditada (1 observação) não deveria aparecer no prompt como se já fosse confiável',
      ];
    },
  },

  {
    nome: 'listar: expõe o campo "estado" pros itens gerais (não-credibilidade) refletindo o ciclo de vida',
    tipo: 'unidade',
    async executar() {
      const memoria = novaMemoria();
      memoria.aprender({ tipo: 'preferencia', chave: 'formato', licao: 'prefere tabela' });
      const [item] = memoria.listar();
      return [
        item.estado === 'não confirmado' || `esperava estado "não confirmado" com 1 observação, obteve "${item.estado}"`,
      ];
    },
  },
];
