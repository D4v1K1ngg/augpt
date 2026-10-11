'use strict';

/**
 * Busca falsa com vários "sites" (motor de pesquisa, 2026-09-24).
 *
 * `regras`: [{ contem: 'texto da consulta', paginas: ['<html>...', ...] }]. A
 * consulta (minúscula, sem acento) cai na PRIMEIRA regra cujo `contem` ela
 * inclui — ponha a regra mais específica antes. Cada página é servida por um
 * servidor num endereço de loopback diferente (127.0.0.2, 127.0.0.3, ...):
 * endereços diferentes contam como domínios diferentes, então o limite de 2
 * páginas por domínio (tools/web.js) e a contagem "citada em N sites" do
 * motor funcionam como na web de verdade.
 *
 * Windows e Linux respondem em todo 127.0.0.0/8; o macOS, por padrão, só em
 * 127.0.0.1 — lá o `listen` falha com EADDRNOTAVAIL e a função devolve null,
 * e o caso que depende disso deve se pular (ver os usos).
 */

const http = require('http');

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const escutar = (servidor, host) =>
  new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, host, () => resolve(servidor.address().port));
  });

async function buscaFalsa(regras) {
  const servidores = [];
  const fechar = () => Promise.all(servidores.map((s) => new Promise((r) => s.close(r))));
  let proximo = 2;
  const comUrls = [];
  try {
    for (const regra of regras) {
      const urls = [];
      // `mesmoHost: true`: todas as páginas da regra num host só (/p0, /p1…),
      // como vários tópicos do mesmo fórum (pesquisa pela comunidade, 2026-09-26)
      if (regra.mesmoHost) {
        const host = `127.0.0.${proximo}`;
        proximo += 1;
        const s = http.createServer((req, res) => {
          const i = Number(/\/p(\d+)/.exec(req.url)?.[1] || 0);
          res.setHeader('Content-Type', 'text/html');
          res.end(regra.paginas[i] || '');
        });
        servidores.push(s);
        const porta = await escutar(s, host);
        regra.paginas.forEach((_, i) => urls.push(`http://${host}:${porta}/p${i}`));
        comUrls.push({ contem: semAcento(regra.contem), urls, host });
        continue;
      }
      for (const html of regra.paginas) {
        const host = `127.0.0.${proximo}`;
        proximo += 1;
        const s = http.createServer((req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        });
        servidores.push(s);
        urls.push(`http://${host}:${await escutar(s, host)}/p`);
      }
      comUrls.push({ contem: semAcento(regra.contem), urls });
    }
  } catch (err) {
    await fechar();
    if (err.code === 'EADDRNOTAVAIL') {
      console.log('      (pulado: este sistema não aceita endereços de loopback além de 127.0.0.1)');
      return null;
    }
    throw err;
  }

  const consultas = [];
  // parâmetros completos de cada busca (idioma, categoria) — só pra conferir
  const pedidos = [];
  const busca = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const params = new URL(req.url, 'http://x').searchParams;
    const q = semAcento(params.get('q') || '');
    consultas.push(q);
    pedidos.push({ q, idioma: params.get('language'), categoria: params.get('categories') });
    const regra = comUrls.find((r) => q.includes(r.contem));
    res.end(JSON.stringify({
      results: (regra?.urls || []).map((url, i) => ({ title: `Fonte ${i + 1}`, url, content: '' })),
    }));
  });
  servidores.push(busca);
  const porta = await escutar(busca, '127.0.0.1');
  return { porta, consultas, pedidos, hosts: comUrls.map((r) => r.host).filter(Boolean), fechar };
}

/** HTML mínimo que o extrator aceita como artigo. */
const pagina = (texto) =>
  `<html><body><article><p>${texto} Contexto suficiente para o extrator aceitar este bloco como conteúdo de verdade.</p></article></body></html>`;

module.exports = { buscaFalsa, pagina };
