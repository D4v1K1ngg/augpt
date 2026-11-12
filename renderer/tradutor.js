'use strict';

/**
 * Tradutor (12/11): a tela. A tradução vem do processo principal (src/tradutor) e aparece enquanto é escrita;
 * idiomas, tom e modelo ficam no localStorage (só conveniência). O 🔊 reaproveita o botão das respostas (estudio.js).
 */
(() => {
  const api = window.augpt;
  const $ = (id) => document.getElementById(id);
  const CHAVE = 'augpt.tradutor.v1';
  let escolhas = {};
  try {
    escolhas = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {};
  } catch {
    escolhas = {};
  }
  const guardar = () => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(escolhas));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  };
  let carregado = false;
  let traduzindo = false;
  let ultima = '';

  async function carregar() {
    if (!carregado) {
      const idiomas = await api.tradutor.idiomas();
      const opcoes = (lista) => lista.map(([id, nome]) => `<option value="${id}">${nome}</option>`).join('');
      $('tradDe').innerHTML = opcoes(idiomas);
      $('tradPara').innerHTML = opcoes(idiomas.filter(([id]) => id !== 'auto'));
      $('tradDe').value = escolhas.de || 'auto';
      $('tradPara').value = escolhas.para || 'en';
      $('tradTom').value = escolhas.tom || 'natural';
      carregado = true;
    }
    // os modelos podem mudar (baixou um novo): a lista é refeita a cada visita
    const [m, cfg] = await Promise.all([api.ollama.models().catch(() => ({ models: [] })), api.config.get().catch(() => ({}))]);
    const nomes = [...new Set((m.models || []).map((x) => x.name || x).filter(Boolean))];
    $('tradModelo').innerHTML = `<option value="">Modelo do chat${cfg.model ? ` (${cfg.model})` : ''}</option>${nomes.map((n) => `<option value="${n}">${n}</option>`).join('')}`;
    $('tradModelo').value = nomes.includes(escolhas.modelo) ? escolhas.modelo : '';
    $('tradTexto').focus();
  }

  const contar = () => ($('tradContagem').textContent = `${$('tradTexto').value.length} caracteres`);
  function mostrar(texto) {
    $('tradSaida').textContent = texto;
    $('tradSaida').classList.toggle('vazia', !texto);
  }

  async function traduzir() {
    const texto = $('tradTexto').value;
    if (!texto.trim() || traduzindo) return;
    traduzindo = true;
    $('tradTraduzir').disabled = true;
    $('tradParar').hidden = false;
    $('tradAudio').innerHTML = '';
    $('tradStatus').textContent = 'Traduzindo…';
    mostrar('');
    const r = await api.tradutor.traduzir({ texto, de: $('tradDe').value, para: $('tradPara').value, tom: $('tradTom').value, modelo: $('tradModelo').value || undefined });
    traduzindo = false;
    $('tradTraduzir').disabled = false;
    $('tradParar').hidden = true;
    if (!r.ok) {
      $('tradStatus').textContent = r.interrompido ? 'Parado.' : `Não deu: ${r.amigavel || r.error}`;
      return;
    }
    ultima = r.traducao;
    mostrar(ultima);
    $('tradStatus').textContent = `${r.segundos.toFixed(1)} s${r.partes > 1 ? ` · ${r.partes} partes` : ''}`;
    window.botaoDeAudio?.($('tradAudio'), ultima);
  }

  $('tradTexto').addEventListener('input', contar);
  $('tradTexto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      traduzir();
    }
  });
  $('tradTraduzir').addEventListener('click', traduzir);
  $('tradParar').addEventListener('click', () => api.tradutor.parar());
  for (const [id, chave] of [['tradDe', 'de'], ['tradPara', 'para'], ['tradTom', 'tom'], ['tradModelo', 'modelo']]) {
    $(id).addEventListener('change', (e) => ((escolhas[chave] = e.target.value), guardar()));
  }
  $('tradTrocar').addEventListener('click', () => {
    const de = $('tradDe').value;
    const para = $('tradPara').value;
    // "Detectar idioma" não vira destino: o destino passa a ser o português (ou o inglês, se já era português)
    $('tradDe').value = para;
    $('tradPara').value = de === 'auto' ? (para === 'pt' ? 'en' : 'pt') : de;
    if (ultima) {
      $('tradTexto').value = ultima;
      ultima = '';
      mostrar('');
      $('tradAudio').innerHTML = '';
      contar();
    }
    escolhas.de = $('tradDe').value;
    escolhas.para = $('tradPara').value;
    guardar();
  });
  $('tradCopiar').addEventListener('click', async () => {
    if (!ultima) return;
    await navigator.clipboard.writeText(ultima).catch(() => {});
    $('tradStatus').textContent = 'Copiado ✓';
  });
  $('tradLimpar').addEventListener('click', () => {
    $('tradTexto').value = '';
    ultima = '';
    mostrar('');
    $('tradAudio').innerHTML = '';
    contar();
    $('tradTexto').focus();
  });
  mostrar('');

  window.carregarTradutor = () => carregar().catch((err) => ($('tradStatus').textContent = `Erro: ${err.message}`));
  window.tradutorEvento = (canal, dados) => {
    if (canal === 'tradutor-pedaco' && traduzindo) mostrar(dados.texto || '');
  };
})();
