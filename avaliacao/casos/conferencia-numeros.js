'use strict';

/**
 * Conferência dos números (19/10, revisão do histórico): 12 dos 14 avisos "⚠ número sem fonte"
 * eram falsos — IP e versão picados em pedaços, o build do Windows lido do PC, contas da prova
 * de exatas, "Ryzen 5000", "0%". O aviso que grita à toa faz o usuário ignorar o que importa.
 */

const { conferirFatos } = require('../../src/agent/nucleo');

const marcados = (texto, opcoes) => conferirFatos(texto, opcoes).numeros.join(',');

module.exports = [
  {
    nome: 'conferência dos números: IP, DNS e versão conferidos inteiros; número do material vale por partes; prova de exatas, 0% e número de modelo não são marcados',
    tipo: 'unidade',
    executar() {
      return [
        marcados('Use o DNS 8.8.8.8 e o gateway 192.168.0.1.', { material: 'gateway 192.168.0.1 dns 8.8.8.8' }) === '' || 'IP/DNS',
        marcados('A versão instalada é 8.08.12.551.', { material: 'AMD Chipset Software 8.08.12.551' }) === '' || 'versão inteira',
        marcados('O seu Windows é o build 26200.', { material: 'Windows 11 Pro build 26200.6584' }) === '' || 'build por partes',
        marcados('Perda de 0%, um Ryzen 5000 e uma RTX 4090 no Windows 11.', { material: 'sem números' }) === '' || 'modelo e 0%',
        marcados('O resultado é 216 e depois 243.', { material: 'x', semNumeros: true }) === '' || 'exatas',
      ];
    },
  },
  {
    nome: 'conferência dos números: o que é inventado continua marcado (a versão 7.06.02.123 do chat do chipset, a área de 97,1 km² sem fonte)',
    tipo: 'unidade',
    executar() {
      const r = conferirFatos('A versão instalada é 7.06.02.123.', { material: 'AMD Chipset Software 8.08.12.551' });
      return [
        r.numeros.join() === '7.06.02.123' && /7\.06\.02\.123 ⚠/.test(r.texto) || JSON.stringify(r.numeros),
        marcados('Vitória tem 343.378 habitantes e 97,1 km².', { material: '343.378 habitantes' }) === '97,1' || 'área sem fonte',
        !/⁣/.test(conferirFatos('versão 8.08.12.551', { material: '8.08.12.551' }).texto) || 'marca invisível ficou no texto',
      ];
    },
  },
];
