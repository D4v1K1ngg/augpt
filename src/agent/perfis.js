'use strict';

/**
 * Perfis de uso curados (Etapa E da revisão v2, 2026-09-28). O arquivo
 * `dados/perfis-de-uso.md` é Markdown que o Davi pode editar: cada perfil diz
 * QUANDO vale (palavras do produto + do uso) e os critérios com o porquê.
 *
 * Por quê: no 14º teste real o 7B montou a cadeia do uso de "intra pra PUBG"
 * como "transmitir sons de tiros e explosões", "comunicação com o time",
 * "sensibilidade alta em situações de baixa luz", e os critérios finais
 * foram microfone, latência e "cabo over-ear firmes" — nada de passos,
 * posicionamento ou palco, que é o raciocínio que o Davi faz de cabeça. Para
 * os casos frequentes, o conhecimento fica escrito; o modelo só confirma.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', '..', 'dados', 'perfis-de-uso.md');

const normalizar = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9|+]+/g, ' ')
    .trim();

/** Lê o Markdown dos perfis. Perfil sem "quando" ou com menos de 3 critérios é ignorado. */
function lerPerfis(texto) {
  const perfis = [];
  let atual = null;
  for (const bruta of String(texto || '').split('\n')) {
    const linha = bruta.trim();
    const titulo = /^##\s+(.+)$/.exec(linha);
    if (titulo) {
      atual = { nome: titulo[1].trim(), quando: [], criterios: [] };
      perfis.push(atual);
      continue;
    }
    if (!atual) continue;
    const quando = /^quando\s*:\s*(.+)$/i.exec(linha);
    if (quando) {
      atual.quando = quando[1]
        .split(/\s\+\s/)
        .map((parte) => parte.split('|').map((p) => normalizar(p)).filter(Boolean))
        .filter((alternativas) => alternativas.length);
      continue;
    }
    if (/^[-*]\s/.test(linha)) {
      const [nome, peso, porque, termos] = linha.replace(/^[-*]\s+/, '').split('|').map((p) => (p || '').trim());
      if (!nome) continue;
      const pn = normalizar(peso);
      atual.criterios.push({
        nome,
        peso: /^alt/.test(pn) ? 'alto' : /^baix/.test(pn) ? 'baixo' : 'medio',
        porque: porque || '',
        termos: [...new Set([nome, ...String(termos || '').split(',').map((t) => t.trim()).filter(Boolean)])].slice(0, 8),
        doPerfil: true,
      });
    }
  }
  return perfis.filter((p) => p.quando.length && p.criterios.length >= 3);
}

let cache = null;
function perfisPadrao() {
  if (cache) return cache;
  try {
    cache = lerPerfis(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    cache = [];
  }
  return cache;
}

/** O primeiro perfil (na ordem do arquivo) cujas partes do "quando" aparecem todas no pedido. */
function perfilDoPedido(objetivo, perfis = perfisPadrao()) {
  const t = ` ${normalizar(objetivo)} `;
  const tem = (p) => t.includes(` ${p} `) || (p.length >= 5 && t.includes(p));
  return perfis.find((perfil) => perfil.quando.every((alternativas) => alternativas.some(tem))) || null;
}

module.exports = { lerPerfis, perfilDoPedido, perfisPadrao, ARQUIVO };
