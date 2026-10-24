'use strict';

/**
 * Ditado por voz (24/10): a permissão (só o microfone, só da janela principal, nunca a câmera), a
 * limpeza do que o Whisper devolve, a janela de áudio do tamanho da fala e o que roda no processador.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { soMicrofoneDe } = require('../../electron/sessao-segura');
const d = require('../../src/ditado');

module.exports = [
  {
    nome: 'ditado: o microfone só para a janela principal, só áudio e só com o ditado instalado; câmera, notificação e outras janelas continuam negadas',
    tipo: 'unidade',
    executar() {
      const principal = { id: 1 };
      const outra = { id: 2 };
      let instalado = true;
      const pode = soMicrofoneDe(() => principal, () => instalado);
      const resultado = [
        pode(principal, 'media', ['audio']) === true || 'microfone da janela principal',
        pode(principal, 'media', ['video']) === false && pode(principal, 'media', ['audio', 'video']) === false || 'câmera',
        pode(principal, 'media', []) === false || 'sem tipo',
        pode(outra, 'media', ['audio']) === false || 'outra janela (Execuções, navegador)',
        pode(principal, 'notifications', []) === false && pode(principal, 'geolocation', []) === false || 'outras permissões',
      ];
      instalado = false;
      resultado.push(pode(principal, 'media', ['audio']) === false || 'sem o ditado instalado, nem o microfone');
      return resultado;
    },
  },
  {
    nome: 'ditado: o texto sai limpo (sem [BLANK_AUDIO], (música), marcas de tempo), a janela de áudio acompanha a fala, o modelo segue os núcleos e o binário e os modelos têm SHA-256 fixo',
    tipo: 'unidade',
    executar() {
      return [
        d.limparTranscricao('[00:00:00.000 --> 00:00:04.000]   Me lembra amanhã às nove.\n [BLANK_AUDIO]\n(música)\n') === 'Me lembra amanhã às nove.' || d.limparTranscricao('[00:00:00.000 --> 00:00:04.000]   Me lembra amanhã às nove.\n [BLANK_AUDIO]\n(música)\n'),
        d.limparTranscricao(' Olá,\n tudo bem? ') === 'Olá, tudo bem?' || 'junta as linhas',
        d.janelaDeAudio(1) === 384 && d.janelaDeAudio(8) === 512 && d.janelaDeAudio(28) === 1500 && d.janelaDeAudio(90) === 1500 || [1, 8, 28, 90].map(d.janelaDeAudio).join(','),
        d.modeloRecomendado(16) === 'turbo' && d.modeloRecomendado(4) === 'pequeno' || 'modelo por núcleos',
        d.nucleosParaUsar(16) === 8 && d.nucleosParaUsar(4) === 2 || 'núcleos',
        [d.BINARIO, ...Object.values(d.MODELOS)].every((x) => /^[0-9a-f]{64}$/.test(x.sha256) && x.bytes > 1e6) || 'SHA-256 fixos',
      ];
    },
  },
  {
    nome: 'ditado: transcrever chama o whisper-cli no processador (-ng), com o idioma da tela, busca simples e a janela do tamanho do áudio; sem instalar, avisa',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ditado-'));
      const chamadas = [];
      const ditado = new d.Ditado(dir, { executar: async (exe, args) => (chamadas.push(args), ' Teste de ditado.\n') });
      const semInstalar = await ditado.transcrever(path.join(dir, 'x.wav')).catch((e) => e.message);
      fs.mkdirSync(path.join(dir, 'ditado', 'bin', 'Release'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'ditado', 'bin', 'Release', 'whisper-cli.exe'), '');
      fs.mkdirSync(path.join(dir, 'ditado', 'modelos'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'ditado', 'modelos', d.MODELOS.turbo.arquivo), '');
      const wav = path.join(dir, 'fala.wav');
      fs.writeFileSync(wav, Buffer.alloc(44 + 32000 * 8)); // 8 s
      const r = await ditado.transcrever(wav, { idioma: 'en' });
      const a = chamadas[0] || [];
      const valor = (f) => a[a.indexOf(f) + 1];
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        /não está instalado/.test(semInstalar) || semInstalar,
        r.texto === 'Teste de ditado.' || r.texto,
        a.includes('-ng') && valor('-l') === 'en' && valor('-bs') === '1' && valor('-ac') === '512' || a.join(' '),
      ];
    },
  },
];
