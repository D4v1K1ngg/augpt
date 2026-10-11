'use strict';

const os = require('os');

/**
 * Detecção de hardware — item novo do planejamento do Copiloto nível 2 (ver
 * `AuGPT-plano-de-implementacao.md`, seção "Copiloto nível 2, escolha de modo
 * por hardware, e ciclo de vida do Ollama").
 *
 * Sem dependência nova: só `os` nativo do Node. Propositalmente NÃO detecta
 * GPU — não é nativo do Node, exigiria chamar `nvidia-smi`/consultar registro
 * do Windows, é frágil entre fabricantes, e não é o fator que decide se um
 * segundo modelo CABE na máquina (isso é RAM livre) — GPU só afetaria
 * velocidade, não a decisão de "cabe ou não cabe" que este módulo existe pra
 * responder.
 */
function detectarHardware() {
  return {
    ramTotalGB: arredondar(os.totalmem() / 1024 ** 3),
    ramLivreGB: arredondar(os.freemem() / 1024 ** 3),
    nucleosCpu: os.cpus().length,
  };
}

function arredondar(n) {
  return Math.round(n * 10) / 10;
}

/**
 * RAM livre necessária pra recomendar "2 IAs" com conforto: modelo principal
 * já carregado + um crítico dedicado pequeno (ex.: Llama 3.2 3B, ~2-3GB em
 * quantização padrão) rodando em paralelo, com folga pro sistema
 * operacional e pro resto do AuGPT (Electron, navegador embutido etc.).
 * Limiar conservador de propósito — nunca bloqueia a escolha do usuário
 * (ver `recomendarModoCopiloto`), só orienta.
 */
const RAM_LIVRE_MINIMA_DOIS_MODELOS_GB = 6;

/**
 * Recomenda um modo do Copiloto nível 2 a partir do hardware detectado — NUNCA
 * bloqueia: é só uma sugestão com o motivo em português, pronta pra UI
 * mostrar. A escolha final é sempre do usuário (ver `copiloto2Modo` em
 * `src/config.js`).
 */
function recomendarModoCopiloto(hardware = detectarHardware()) {
  if (hardware.ramLivreGB >= RAM_LIVRE_MINIMA_DOIS_MODELOS_GB) {
    return {
      modo: 'doisModelos',
      motivo:
        `Seu computador tem ${hardware.ramLivreGB}GB de RAM livre — dá pra manter o modelo ` +
        'principal e um crítico dedicado pequeno rodando ao mesmo tempo, com folga.',
    };
  }
  return {
    modo: 'mesmoModelo',
    motivo:
      `Seu computador tem ${hardware.ramLivreGB}GB de RAM livre — rodar dois modelos ao mesmo ` +
      'tempo pode deixar tudo lento ou travar. Recomendamos usar o modelo atual (mais leve); ' +
      'dá pra escolher "2 IAs" mesmo assim, por sua conta.',
  };
}

module.exports = { detectarHardware, recomendarModoCopiloto, RAM_LIVRE_MINIMA_DOIS_MODELOS_GB };
