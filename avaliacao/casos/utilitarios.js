'use strict';

/**
 * Aba Utilitários e "o que você pode fazer?" (19/10): a mesma lista do catálogo
 * alimenta os cartões e a resposta do chat; o exemplo de cada cartão aciona o
 * recurso de verdade (não cai na pesquisa genérica).
 */

const capacidades = require('../../src/agent/capacidades');
const rotas = require('../../src/agent/rotas-do-codigo');

module.exports = [
  {
    nome: 'utilitários: "o que você pode fazer?" / "quais utilitários você tem?" são reconhecidos, "o que eu posso fazer para melhorar a internet?" não',
    tipo: 'unidade',
    executar() {
      const sim = ['o que você pode fazer?', 'quais utilitarios voce tem?', 'me mostra seus recursos', 'quais são suas ferramentas?', 'como você pode me ajudar?'];
      const nao = ['o que o pubg faz?', 'o que eu posso fazer para melhorar a internet?', 'quais os recursos do windows 11?'];
      return [...sim.map((t) => capacidades.pedeOQueFaz(t) || t), ...nao.map((t) => !capacidades.pedeOQueFaz(t) || t)];
    },
  },
  {
    nome: 'utilitários: o exemplo de cada cartão cai na rota que o cartão declara (o mesmo roteador do app); ids únicos; falta de componente e de Windows aparece no cartão e no texto do chat',
    tipo: 'unidade',
    executar() {
      const cartoes = capacidades.utilitarios({ instalados: { youtube: true, imagem: false }, plataforma: 'win32' });
      const rota = (t) => rotas.escolherRota({ objetivo: t, conversa: [], deps: {} })?.rota.id || 'pesquisa';
      const texto = capacidades.textoDosUtilitarios(cartoes);
      const linux = capacidades.utilitarios({ plataforma: 'linux' });
      return [
        // cada exemplo cai na rota que o cartão declara (sem `rota`: na pesquisa)
        ...cartoes.filter((c) => c.exemplo).map((c) => rota(c.exemplo) === (c.rota || 'pesquisa') || `${c.id} → ${rota(c.exemplo)} (esperava ${c.rota || 'pesquisa'})`),
        cartoes.filter((c) => c.rota).length >= 17 || 'cartões com rota',
        new Set(cartoes.map((c) => c.id)).size === cartoes.length || 'ids repetidos',
        cartoes.every((c) => c.exemplo || c.dica) || 'cartão sem como usar',
        cartoes.find((c) => c.id === 'criar_imagem').disponivel === false && cartoes.find((c) => c.id === 'youtube').disponivel === true || 'componentes',
        /\*\*Criar imagens\*\*.*instale o Criar imagens em Ajustes → Componentes/.test(texto) && /aba \*\*Utilitários\*\*/.test(texto) && /\*\*Este computador\*\*/.test(texto) || texto.slice(0, 300),
        linux.find((c) => c.id === 'espaco').disponivel === false && linux.find((c) => c.id === 'pesquisa').disponivel === true || 'só no Windows',
      ];
    },
  },
];
