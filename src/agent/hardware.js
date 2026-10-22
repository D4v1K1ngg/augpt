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

module.exports = { detectarHardware };
