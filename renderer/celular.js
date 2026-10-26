'use strict';

/**
 * Acesso pelo celular, do lado do PC (26/10, fase 1):
 * - o pedido que chega do celular roda aqui, como se você tivesse digitado (mesma conversa, mesmos cartões);
 * - o cartão de aprovação/pergunta respondido pelo celular fecha aqui também;
 * - Ajustes → Geral: ligar, o QR code (vendor/qrcode-generator) e "Gerar novo código".
 */
(function () {
  /* ---------------- o pedido do celular ---------------- */
  manipuladores['remoto-pedido'] = async ({ texto, idConversa } = {}) => {
    if (!texto || agente.rodando) return;
    trocarAba('agente');
    if (idConversa && idConversa !== agente.idConversa) await abrirConversa(idConversa);
    else if (!idConversa && agente.idConversa) novaConversa('agente');
    el.aEntrada.value = texto;
    autoAltura(el.aEntrada);
    enviarPedido();
  };

  manipuladores['remoto-respondeu'] = ({ id, valor } = {}) => {
    const card = el.aRolagem.querySelector(`.cartao[data-id="${CSS.escape(String(id || ''))}"]`);
    if (!card || card.classList.contains('resolvido')) return;
    card.classList.add('resolvido');
    const texto = valor === 'aprovar' ? tr('autorizado pelo celular') : valor === 'negar' ? tr('recusado pelo celular') : tr('respondido pelo celular');
    const alvo = card.querySelector('.acoes, .resposta-campo');
    if (alvo) alvo.replaceChildren(Object.assign(document.createElement('span'), { className: 'secundario', textContent: texto }));
  };

  /* ---------------- Ajustes → Geral ---------------- */
  function desenharQr(url) {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    // GIF em data: — o CSP da tela já aceita data: em img
    return qr.createDataURL(6, 4);
  }

  async function pintarCelular() {
    const ligado = config.acessoCelular === true;
    $('cfgAcessoCelular').checked = ligado;
    const st = await api.remoto.estado().catch(() => ({}));
    const status = $('celularStatus');
    $('celularAcesso').hidden = !(ligado && st.ligado && st.enderecos?.length);
    if (!ligado) {
      status.textContent = '';
      return;
    }
    if (st.erro) {
      status.textContent = tr('Não deu para ligar: {erro}', { erro: st.erro });
      return;
    }
    if (!st.enderecos?.length) {
      status.textContent = tr('Ligado, mas este computador não está numa rede da casa (Wi-Fi ou cabo).');
      return;
    }
    status.textContent = tr('Ligado — escaneie o QR code com o celular.');
    const url = st.enderecos[0];
    $('celularQr').src = desenharQr(url);
    // o mesmo endereço do QR, para digitar no celular se a câmera não ler
    $('celularEndereco').textContent = url;
  }

  $('cfgAcessoCelular').addEventListener('change', async (e) => {
    config = await api.config.set({ acessoCelular: e.target.checked });
    // o servidor liga em segundo plano: espera um instante e pinta
    setTimeout(pintarCelular, 400);
  });
  $('btnCelularNovoCodigo').addEventListener('click', async () => {
    await api.remoto.novoCodigo();
    config = await api.config.get();
    pintarCelular();
  });

  // pinta quando a aba Geral de Ajustes abre (o mesmo momento do ditado)
  document.querySelector('[data-painel="ajGeral"]')?.addEventListener('click', () => setTimeout(pintarCelular, 50));
  document.getElementById('navConfig')?.addEventListener('click', () => setTimeout(pintarCelular, 50));
  window.acessoPeloCelular = { pintar: pintarCelular };
})();
