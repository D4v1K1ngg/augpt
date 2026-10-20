'use strict';

/**
 * Esfera neural (20/10): desligada por padrão em hardware fraco; alimentada pelos eventos do
 * cartão de atividade (etapas, sites, raciocínio, fim). Medido na RTX 3060 Ti com o qwen3.5:4b:
 * a escrita foi a 102,0 tok/s com a esfera em Alto e 102,2 desligada (dentro da variação).
 */

const fs = require('fs');
const path = require('path');
const { esferaRecomendada } = require('../../src/verificador-de-hardware');
const tela = require('../texto-da-tela')();
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');

module.exports = [
  {
    nome: 'esfera neural: hardware fraco (sem placa, menos de 4 GB, AMD antiga como a RX 580) vem desligada, com o motivo; placa boa vem no Alto',
    tipo: 'unidade',
    executar() {
      const casos = [
        [{ vramGB: 8, gpus: [{ nome: 'NVIDIA GeForce RTX 3060 Ti', vramGB: 8 }] }, 'alto'],
        [{ vramGB: 8, gpus: [{ nome: 'AMD Radeon RX 580 2048SP', vramGB: 8 }] }, 'off'],
        [{ vramGB: 2, gpus: [{ nome: 'NVIDIA GeForce GT 1030', vramGB: 2 }] }, 'off'],
        [{ vramGB: 0, gpus: [] }, 'off'],
      ];
      return [
        ...casos.map(([c, m]) => esferaRecomendada(c).modo === m || `${c.gpus[0]?.nome || 'sem placa'} → ${esferaRecomendada(c).modo}`),
        /disputaria a placa/.test(esferaRecomendada({ vramGB: 0, gpus: [] }).motivo) || 'motivo',
      ];
    },
  },
  {
    nome: 'esfera neural: a three.js local carrega antes da tela; o turno cria a esfera dentro do cartão de atividade; etapas, sites, raciocínio e o fim chegam a ela; Ajustes → Geral tem o modo e a janela de ajustes',
    tipo: 'unidade',
    executar() {
      const ordem = ['vendor/three-r128.js', 'esfera.js', 'app.js'].map((f) => html.indexOf(`<script src="${f}"></script>`));
      return [
        ordem.every((i) => i > 0) && ordem[0] < ordem[1] && ordem[1] < ordem[2] || `ordem dos scripts: ${ordem}`,
        /Esfera\?\.criar\(turno\.esferaT, dele, \{ act: turno\.atividade \}\)/.test(tela) || 'o turno cria a esfera',
        /T\.steps\.push\(\{ id: chave/.test(tela) && /T\.sites\.push\(host\)/.test(tela) && /esferaT\.lastThought = frase/.test(tela) && /t\.esfera\?\.end\(\)/.test(tela) || 'eventos chegam à esfera',
        /id="cfgEsferaModo"/.test(html) && /id="btnAjustarEsfera"/.test(html) && /Esfera\?\.padrao\(config\.esferaModoPadrao/.test(tela) || 'Ajustes e padrão',
        fs.statSync(path.join(__dirname, '..', '..', 'renderer', 'vendor', 'three-r128.js')).size > 500000 || 'three.js local',
      ];
    },
  },
];
