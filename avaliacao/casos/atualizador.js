'use strict';

/**
 * Atualizar o AuGPT (21/10): confere a Release do GitHub, baixa o instalador e só o entrega se o
 * SHA-512 e o tamanho batem com o latest.yml da mesma versão.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const a = require('../../src/atualizador');

const exe = Buffer.from('instalador falso do AuGPT');
const yml = (sha = crypto.createHash('sha512').update(exe).digest('base64'), tam = exe.length) =>
  `version: 0.28.0\nfiles:\n  - url: AuGPT-Setup-0.28.0.exe\n    sha512: ${sha}\n    size: ${tam}\npath: AuGPT-Setup-0.28.0.exe\nsha512: ${sha}\nreleaseDate: '2026-10-21T12:00:00.000Z'\n`;

function github({ status = 200, latest = yml() } = {}) {
  return async (url) => {
    if (url.endsWith('/latest/download/latest.yml')) return { status, ok: status === 200, text: async () => latest };
    return { ok: true, status: 200, headers: new Map([['content-length', String(exe.length)]]), body: [exe.subarray(0, 10), exe.subarray(10)] };
  };
}

module.exports = [
  {
    nome: 'atualizador: compara versões, lê o latest.yml, acha a Release nova e não avisa quem já está em dia',
    tipo: 'unidade',
    async executar() {
      const nova = await a.verificar({ atual: '0.27.0', buscar: github() });
      const igual = await a.verificar({ atual: '0.28.0', buscar: github() });
      const sem = await a.verificar({ atual: '0.27.0', buscar: github({ status: 404 }) });
      return [
        a.maisNova('v0.28.0', '0.27.0') && a.maisNova('0.27.10', '0.27.9') && a.maisNova('1.0.0', '0.99.99') || 'mais nova',
        !a.maisNova('0.27.0', '0.27.0') && !a.maisNova('0.26.9', '0.27.0') || 'não é mais nova',
        a.lerLatestYml(yml('abc', 5))?.sha512 === 'abc' && a.lerLatestYml(yml('abc', 5)).tamanho === 5 && a.lerLatestYml(yml()).caminho === 'AuGPT-Setup-0.28.0.exe' || 'latest.yml',
        nova.disponivel && nova.versao === '0.28.0' && nova.instalador === 'https://github.com/D4v1K1ngg/augpt/releases/download/v0.28.0/AuGPT-Setup-0.28.0.exe' && /tag\/v0\.28\.0$/.test(nova.pagina) || JSON.stringify(nova),
        igual.disponivel === false || 'em dia',
        sem.disponivel === false && /nenhuma/.test(sem.motivo) || 'sem release',
      ];
    },
  },
  {
    nome: 'atualizador: o instalador baixado só é entregue se o SHA-512 e o tamanho conferem com o latest.yml',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-atu-'));
      const info = await a.verificar({ atual: '0.27.0', buscar: github() });
      const progresso = [];
      const arquivo = await a.baixar(info, { dir, buscar: github(), emitir: (p) => progresso.push(p.porcento) });
      const falso = await a.baixar({ ...info, yml: a.lerLatestYml(yml('outro-hash')) }, { dir, buscar: github() }).catch((e) => e.message);
      const curto = await a.baixar({ ...info, yml: a.lerLatestYml(yml(undefined, 999)) }, { dir, buscar: github() }).catch((e) => e.message);
      const ok = fs.readFileSync(arquivo).equals(exe);
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        ok && path.basename(arquivo) === 'AuGPT-Setup-0.28.0.exe' || arquivo,
        progresso.includes(100) || progresso.join(','),
        /SHA-512.*não confere/.test(falso) || falso,
        /tamanho.*não confere/.test(curto) || curto,
      ];
    },
  },
  {
    nome: 'novidades: cada versão do package.json tem a sua entrada em dados/novidades.json, em português e inglês, da mais nova para a mais antiga',
    tipo: 'unidade',
    executar() {
      const lista = JSON.parse(fs.readFileSync(path.join(__dirname, '../../dados/novidades.json'), 'utf8'));
      const versao = require('../../package.json').version;
      const ordem = lista.every((n, i) => i === 0 || a.maisNova(lista[i - 1].versao, n.versao));
      return [
        lista[0]?.versao === versao || `falta a entrada da ${versao} (a mais nova é a ${lista[0]?.versao})`,
        ordem || 'fora de ordem',
        ...lista.map((n) => (n.pt?.titulo && n.en?.titulo && n.pt.itens?.length && n.pt.itens.length === n.en?.itens?.length && /^\d{4}-\d{2}-\d{2}$/.test(n.data)) || `entrada ${n.versao}`),
      ];
    },
  },
  {
    nome: 'novidades: depois de atualizar mostra as versões puladas até a instalada; vindo de versão sem a janela, só a atual; a da faixa vem da tag no GitHub',
    tipo: 'unidade',
    async executar() {
      const lista = ['0.36.0', '0.35.0', '0.34.0', '0.30.0'].map((versao) => ({ versao }));
      const v = (l) => l.map((n) => n.versao).join(',');
      let pedido = '';
      const remotas = await a.novidadesRemotas('0.35.0', { buscar: async (url) => ((pedido = url), { ok: true, json: async () => lista }) });
      const fora = await a.novidadesRemotas('0.35.0', { buscar: async () => ({ ok: false, status: 404 }) }).catch((e) => e.message);
      return [
        v(a.novidadesEntre(lista, '0.30.0', '0.35.0')) === '0.35.0,0.34.0' || 'puladas',
        v(a.novidadesEntre(lista, null, '0.34.0')) === '0.34.0' || 'sem a anterior',
        v(a.novidadesEntre(lista, '0', '0.34.0')) === '0.34.0,0.30.0' || 'histórico',
        pedido === 'https://raw.githubusercontent.com/D4v1K1ngg/augpt/v0.35.0/dados/novidades.json' && remotas.length === 4 || pedido,
        /404/.test(fora) || fora,
      ];
    },
  },
];
