'use strict';

/**
 * A régua fora de produto (24/11, fase 4 do sistema global): as checagens de qualidade/perguntas.js recebem o tipo das
 * fontes que foram para o escritor (os da fase 1) e o perfil da pergunta; sem material, a checagem de fonte não se aplica.
 */

const fs = require('fs');
const path = require('path');
const { rodarChecagens } = require('../qualidade');
const perguntas = require('../qualidade/perguntas');

const lista = Array.isArray(perguntas) ? perguntas : Object.values(perguntas).flat();
const achar = (id) => lista.find((p) => p && p.id === id);

module.exports = [
  {
    nome: 'régua das fontes: notícia com metade do material de notícia/oficial passa, com afiliado/loja demais não; sem material (resposta de cabeça) a checagem de fonte passa; as perguntas novas (GTA 6, decidível) existem; o núcleo manda o tipo do material e o perfil',
    tipo: 'unidade',
    executar() {
      const gta = achar('gta6-vazamento');
      const decidivel = achar('decidivel');
      const deFonte = (p) => p.checagens.map((c, i) => (/material/.test(c.nome) ? i : -1)).filter((i) => i >= 0);
      const resultado = (p, tiposUsados) => deFonte(p).map((i) => rodarChecagens(p, 'Em 23 de novembro, a Rockstar confirmou…', { tiposUsados })[i]);
      const nucleo = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      return [
        Boolean(gta && decidivel) || 'as perguntas novas',
        JSON.stringify(resultado(gta, ['noticia', 'noticia', 'referencia', 'outro'])) === '[true,true]' || `bom: ${resultado(gta, ['noticia', 'noticia', 'referencia', 'outro'])}`,
        JSON.stringify(resultado(gta, ['afiliado', 'loja', 'noticia', 'outro'])) === '[false,false]' || 'afiliado e loja demais',
        JSON.stringify(resultado(decidivel, [])) === '[true,true]' || 'sem material, não se aplica',
        rodarChecagens(gta, 'Em 23 de novembro, a Rockstar confirmou…', {})[0] === true || 'a data',
        /tiposUsados: usadas\.filter\(\(f\) => !f\.video && !f\.imagem\)\.map\(classeDaFonte\), perfil,/.test(nucleo) || 'o núcleo manda o tipo do material e o perfil',
      ];
    },
  },
];
