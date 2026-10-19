'use strict';

/**
 * Ollama de outro computador da rede (19/10): achar, testar e não confundir com o deste PC.
 */

const remoto = require('../../src/ollama-remoto');
const primeiroUso = require('../../src/primeiro-uso');

// um "Ollama" falso em 192.168.0.40, com dois modelos
const fetchFalso = async (url) => {
  if (url.startsWith('http://192.168.0.40:11434/api/version')) return { ok: true, json: async () => ({ version: '0.40.1' }) };
  if (url.startsWith('http://192.168.0.40:11434/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen3.5:9b' }, { name: 'nomic-embed-text:latest' }] }) };
  throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
};

module.exports = [
  {
    nome: 'ollama remoto: localhost/127.x/::1 são deste PC, um IP da rede não; a busca usa só as redes privadas das placas de verdade (VPN como Radmin e Hamachi, virtuais e IP público ficam de fora)',
    tipo: 'unidade',
    executar() {
      const interfaces = {
        Ethernet: [{ family: 'IPv4', address: '192.168.0.10', internal: false }],
        'Radmin VPN': [{ family: 'IPv4', address: '26.10.0.5', internal: false }],
        'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
        Hamachi: [{ family: 'IPv4', address: '10.0.0.7', internal: false }],
        'Wi-Fi': [{ family: 'IPv4', address: '200.1.2.3', internal: false }],
        Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      };
      return [
        remoto.ehLocal('http://127.0.0.1:11434') && remoto.ehLocal('http://localhost:11434') && remoto.ehLocal('http://[::1]:11434') || 'local',
        !remoto.ehLocal('http://192.168.0.40:11434') || 'IP da rede',
        remoto.redesLocais(interfaces).join() === '192.168.0.' || remoto.redesLocais(interfaces).join(),
      ];
    },
  },
  {
    nome: 'ollama remoto: a busca acha o servidor da rede com a versão e os modelos; o teste de um endereço que não responde diz "não respondeu"',
    tipo: 'unidade',
    async executar() {
      const r = await remoto.procurarNaRede({ fetchImpl: fetchFalso, prefixos: ['192.168.0.'], prazoMs: 50 });
      const ok = await remoto.testar('http://192.168.0.40:11434/', { fetchImpl: fetchFalso });
      const nao = await remoto.testar('http://192.168.0.99:11434', { fetchImpl: fetchFalso });
      return [
        r.achados.length === 1 && r.achados[0].host === 'http://192.168.0.40:11434' && r.achados[0].versao === '0.40.1' && r.achados[0].modelos.includes('qwen3.5:9b') || JSON.stringify(r),
        ok.ok && ok.host === 'http://192.168.0.40:11434' && ok.modelos.length === 2 || JSON.stringify(ok),
        !nao.ok && nao.erro === 'não respondeu' || JSON.stringify(nao),
      ];
    },
  },
  {
    nome: 'ollama remoto: o guia de primeira execução do Ollama de outro PC fora do ar pede para ligar AQUELE (não instala nem liga o deste)',
    tipo: 'unidade',
    executar() {
      const fs = require('fs');
      const path = require('path');
      const main = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8');
      const tela = require('../texto-da-tela')();
      const d = primeiroUso.diagnosticarPrimeiroUso({ online: false, binarioEncontrado: true });
      return [
        /etapa: 'remoto-desligado'/.test(main) && /if \(!ollamaRemoto\.ehLocal\(config\.data\.host\)\) return \{ \.\.\.saude, remoto: true \}/.test(main) || 'main: não liga o Ollama deste PC',
        /d\.etapa === 'remoto-desligado'/.test(tela) && /data-pu="usar-local"/.test(tela) || 'tela: passo do outro PC',
        d.etapa === 'ollama-desligado' || 'o local continua igual',
      ];
    },
  },
];
