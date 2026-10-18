'use strict';

/**
 * Revisão da navegação (17/10): rolar a página, posição na leitura, elementos
 * fora da lista e verificação anti-robô. O Electron de verdade foi medido à
 * parte numa página com as armadilhas de sites reais (campo de React, botão
 * que só aceita clique de verdade, shadow DOM, iframe, resultado que chega
 * 2,5 s depois, rolagem infinita): 16 de 16.
 */

const navegacao = require('../../src/tools/navegador');

const { descrever } = navegacao;
const ferramenta = (nome) => navegacao.find((t) => t.name === nome);

module.exports = [
  {
    nome: 'navegação: rolar_pagina chega à sessão e diz quando não há mais o que rolar; a leitura mostra a posição, os elementos fora da lista e a verificação anti-robô (pedir ao usuário, sem contornar)',
    tipo: 'unidade',
    async executar() {
      const r = [];
      const paginas = [
        { url: 'https://loja.exemplo/', titulo: 'Loja', elementos: ['[1] link "Ofertas"'], texto: 'Topo', posicao: { topo: 0, altura: 4000, tela: 800 }, omitidos: 30 },
        { url: 'https://loja.exemplo/', titulo: 'Loja', elementos: ['[1] botão "Comprar"'], texto: 'Rodapé', posicao: { topo: 3200, altura: 4000, tela: 800 } },
        { url: 'https://loja.exemplo/', titulo: 'Loja', elementos: ['[1] botão "Comprar"'], texto: 'Rodapé', posicao: { topo: 3200, altura: 4000, tela: 800 } },
      ];
      const direcoes = [];
      const ctx = {
        estado: {},
        emit() {},
        navegador: {
          async ler() {
            return paginas[0];
          },
          async rolar(d) {
            direcoes.push(d);
            return paginas[direcoes.length];
          },
        },
      };
      const l0 = await ferramenta('ver_pagina').run({}, ctx);
      r.push(/POSIÇÃO: tela 1 de 5 — há mais abaixo \(rolar_pagina\)/.test(l0) || `posição no topo: ${l0}`);
      r.push(/\+30 longe da tela/.test(l0) || 'elementos fora da lista');
      const l1 = await ferramenta('rolar_pagina').run({ direcao: 'fim' }, ctx);
      r.push((direcoes[0] === 'fim' && /tela 5 de 5 \(fim da página\)/.test(l1) && /Rodapé/.test(l1)) || `rolou: ${l1}`);
      const l2 = await ferramenta('rolar_pagina').run({}, ctx);
      r.push((direcoes[1] === 'baixo' && /não andou/.test(l2)) || `fim da página: ${l2}`);
      r.push(ferramenta('rolar_pagina').risk === 'baixo' || 'rolar é de risco baixo');
      const captcha = descrever({ url: 'https://x', titulo: 'Login', elementos: [], texto: '', antiRobo: true, quadrosExternos: 1 });
      r.push((/ANTI-ROBÔ/.test(captcha) && /não tente resolver/.test(captcha) && /perguntar_usuario/.test(captcha)) || 'aviso de captcha');
      r.push(/quadro\(s\) embutido\(s\) de outro site/.test(captcha) || 'quadro externo');
      r.push(!/POSIÇÃO|ANTI-ROBÔ/.test(descrever({ url: 'https://x', titulo: 'Curta', elementos: [], texto: 'a', posicao: { topo: 0, altura: 700, tela: 800 } })) || 'página curta sem posição');
      return r;
    },
  },
];
