'use strict';

/**
 * "O que tem na minha tela?" (25/10): o botão ao lado do + (ou Ctrl+Alt+A, de qualquer lugar do
 * Windows) chama a captura no processo principal; a imagem volta como anexo do Agente. Com uma
 * pergunta junto (pela voz: "Ei GPT, o que é isso na tela?"), o pedido já vai.
 */
(function () {
  const botao = $('btnTelaAgente');
  const avisar = (texto) => {
    const a = window.ditadoPorVoz?.doAgente();
    if (!a) return;
    window.ditadoPorVoz.aviso(a.botao, texto);
    setTimeout(() => window.ditadoPorVoz.aviso(a.botao, ''), 7000);
  };

  async function capturar(opcoes = {}) {
    botao.disabled = true;
    try {
      const r = await api.tela.capturar(opcoes);
      if (!r.ok && !r.cancelado) avisar(tr('Não consegui capturar a tela: {erro}', { erro: r.error }));
      return r;
    } finally {
      botao.disabled = false;
    }
  }
  botao.addEventListener('click', () => capturar());

  // a captura chegou (do botão, do atalho ou da voz): vira anexo do Agente
  manipuladores['tela-capturada'] = ({ anexo, pergunta }) => {
    trocarAba('agente');
    anexos.agente.push(anexo);
    pintarAnexos('agente');
    const caixa = el.aEntrada;
    if (pergunta && !agente.rodando) {
      caixa.value = pergunta;
      autoAltura(caixa);
      enviarPedido();
      return;
    }
    if (pergunta) caixa.value = pergunta;
    const original = caixa.dataset.placeholderOriginal || (caixa.dataset.placeholderOriginal = caixa.placeholder);
    caixa.placeholder = tr('Pergunte sobre a captura — ex.: "que erro é esse?", "traduz isso"');
    setTimeout(() => (caixa.placeholder = original), 90000);
    caixa.focus();
  };

  // pelo "Ei GPT" (escuta.js): o pedido fala da tela → captura a tela inteira e manda junto
  const SOBRE_A_TELA = /\b(na|nessa|nesta|minha|desta|dessa|esta|essa)\s+tela\b|\b(on|in) (my|the|this) screen\b|\bthis screen\b/i;
  window.telaPorVoz = {
    falaDaTela: (texto) => SOBRE_A_TELA.test(String(texto || '')),
    capturarEPerguntar: (pergunta) => capturar({ inteira: true, pergunta }),
  };
})();
