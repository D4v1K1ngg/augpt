'use strict';

/**
 * Alertas dos registros de execução (5/11): os pedidos em que um filtro jogou fora o que importava, ou em
 * que a resposta ficou sem o dado pedido — para virar caso da bancada. Lê a pasta de execuções do app; só
 * lê, nada sai do PC.
 *
 *   npm run alertas                  os últimos 7 dias
 *   npm run alertas -- --dias=30
 *
 * O que acende:
 *   - fonte do produto tirada como "fora do assunto": o título descartado cita o modelo pedido (4/11: as
 *     páginas da Corsair RM1000x saíram e a resposta disse "não encontrei o preço");
 *   - lojas sem o modelo: houve ofertas, nenhuma passou no filtro do produto;
 *   - pediu preço e a resposta diz que não achou;
 *   - resposta lenta: mais de 90 s.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { produtosDoPedido } = require('../src/agent/serie-de-precos');
const { padraoDoProduto } = require('../src/agent/nucleo');
const { normalizar } = require('../src/agent/nucleo/ranking');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const DIAS = Number(args.dias) || 7;
const PASTA = args.pasta || path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming/AuGPT' : '.config/AuGPT', 'execucoes');

function alertasDe(r) {
  const pedido = String(r.objetivo || r.pedido || '');
  const resposta = String(r.resposta || '');
  const avisos = (r.avisos || []).map(String);
  const saida = [];
  const padroes = produtosDoPedido(pedido).map((p) => padraoDoProduto(p.nome)).filter(Boolean);
  const fora = avisos.find((a) => a.startsWith('fora do assunto'));
  if (fora && padroes.length) {
    const titulos = fora.replace(/^[^:]*:\s*/, '').split(' · ');
    const doProduto = titulos.filter((t) => padroes.some((re) => re.test(normalizar(t))));
    if (doProduto.length) saida.push(`filtro tirou ${doProduto.length} página(s) do produto: ${doProduto.slice(0, 2).join(' · ').slice(0, 120)}`);
  }
  const lojas = avisos.find((a) => /^lojas: \d+ ofertas/.test(a));
  if (lojas) saida.push(lojas);
  if (/\b(pre[cç]o|quanto custa|quanto est[aá]|valor)\b/i.test(pedido) && /n[aã]o (encontrei|achei)[^.\n]{0,80}pre[cç]o/i.test(resposta)) saida.push('pediu preço e a resposta diz que não achou');
  const seg = Math.round((r.duracaoMs || 0) / 1000);
  if (seg > 90) saida.push(`lenta: ${seg} s`);
  return saida;
}

function executar() {
  if (!fs.existsSync(PASTA)) {
    console.log(`sem a pasta de execuções: ${PASTA}`);
    return [];
  }
  const desde = Date.now() - DIAS * 86400000;
  const achados = [];
  for (const nome of fs.readdirSync(PASTA).filter((n) => n.endsWith('.json'))) {
    const arq = path.join(PASTA, nome);
    if (fs.statSync(arq).mtimeMs < desde) continue;
    let r;
    try {
      r = JSON.parse(fs.readFileSync(arq, 'utf8'));
    } catch {
      continue;
    }
    const lista = alertasDe(r);
    if (lista.length) achados.push({ quando: fs.statSync(arq).mtime, pedido: String(r.objetivo || r.pedido || '').split('\n')[0].slice(0, 80), lista });
  }
  achados.sort((a, b) => a.quando - b.quando);
  for (const a of achados) {
    console.log(`\n${a.quando.toLocaleString('pt-BR')}  "${a.pedido}"`);
    for (const l of a.lista) console.log(`   ⚠ ${l}`);
  }
  console.log(`\n${achados.length} pedido(s) com alerta nos últimos ${DIAS} dias.`);
  return achados;
}

if (require.main === module) executar();
module.exports = { alertasDe };
