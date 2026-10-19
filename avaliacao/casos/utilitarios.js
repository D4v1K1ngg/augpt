'use strict';

/**
 * Aba Utilitários e "o que você pode fazer?" (19/10): a mesma lista do catálogo
 * alimenta os cartões e a resposta do chat; o exemplo de cada cartão aciona o
 * recurso de verdade (não cai na pesquisa genérica).
 */

const capacidades = require('../../src/agent/capacidades');
const { pedidoDeConsultaPC } = require('../../src/agent/pc-no-chat');
const rede = require('../../src/agent/rede-no-chat');

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
    nome: 'utilitários: cada exemplo dos cartões de rede e do PC cai na rota certa; ids únicos; falta de componente e de Windows aparece no cartão e no texto do chat',
    tipo: 'unidade',
    executar() {
      const cartoes = capacidades.utilitarios({ instalados: { youtube: true, imagem: false }, plataforma: 'win32' });
      const rota = (t) => pedidoDeConsultaPC(t) ? 'pc' : rede.pedidoDeDiagnostico(t) ? 'raiox' : rede.pedidoDeTrafego(t) ? 'trafego' : rede.pedidoDeRota(t) ? 'rota' : rede.pedidoDeAjuste(t, []) ? 'ajuste' : rede.pedidoDeRede(t, []) ? 'rede' : 'nucleo';
      const esperado = { teste_de_velocidade: 'rede', ping: 'rede', rota_de_jogo: 'rota', raio_x: 'raiox', aparelhos: 'raiox', trafego: 'trafego', ajustes_de_rede: 'ajuste', espaco: 'pc', configuracao: 'pc', windows: 'pc', drivers: 'pc', perifericos: 'pc', audio: 'pc', arquivos_do_pc: 'pc', programas: 'pc', inicializacao: 'pc' };
      const texto = capacidades.textoDosUtilitarios(cartoes);
      const linux = capacidades.utilitarios({ plataforma: 'linux' });
      return [
        ...Object.entries(esperado).map(([id, r]) => rota(cartoes.find((c) => c.id === id).exemplo) === r || `${id} → ${rota(cartoes.find((c) => c.id === id).exemplo)}`),
        new Set(cartoes.map((c) => c.id)).size === cartoes.length || 'ids repetidos',
        cartoes.every((c) => c.exemplo || c.dica) || 'cartão sem como usar',
        cartoes.find((c) => c.id === 'criar_imagem').disponivel === false && cartoes.find((c) => c.id === 'youtube').disponivel === true || 'componentes',
        /\*\*Criar imagens\*\*.*instale o Criar imagens em Ajustes → Componentes/.test(texto) && /aba \*\*Utilitários\*\*/.test(texto) && /\*\*Este computador\*\*/.test(texto) || texto.slice(0, 300),
        linux.find((c) => c.id === 'espaco').disponivel === false && linux.find((c) => c.id === 'pesquisa').disponivel === true || 'só no Windows',
      ];
    },
  },
];
