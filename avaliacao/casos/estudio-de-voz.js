'use strict';

/**
 * Estúdio de voz (11/11): texto → arquivo de áudio com o Qwen3-TTS e o OmniVoice. O que a bancada confere sem a placa:
 * a divisão do texto, o texto preparado para falar, a legenda, os filtros do ffmpeg, a trava da clonagem (só com
 * autorização) e que apagar uma voz não sai da pasta das vozes. A geração de verdade foi conferida à parte
 * (RTX 5070 Ti, os dois motores, os três modos).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const e = require('../../src/estudio-de-voz');

module.exports = [
  {
    nome: 'estúdio de voz: parágrafos viram partes, parágrafo longo quebra nas frases; números e siglas por extenso em português, marcas do OmniVoice intactas; inglês fica como está',
    tipo: 'unidade',
    executar() {
      const longo = `${'Esta é uma frase de teste com algumas palavras. '.repeat(12)}Fim.`;
      const partes = e.dividirTexto(`Primeiro parágrafo.\n\nSegundo, com **negrito**.\n\n${longo}`);
      const pt = e.prepararParte('A RTX 5070 Ti custa R$ 6.499 [laughter] hoje.', { idioma: 'portuguese' });
      return [
        partes.length >= 4 && partes[0] === 'Primeiro parágrafo.' || JSON.stringify(partes.slice(0, 3)),
        partes.every((p) => p.length <= 420) || 'parte longa demais',
        /seis mil quatrocentos e noventa e nove reais/.test(pt) && /cinquenta setenta/.test(pt) && /\[laughter\]/.test(pt) || pt,
        e.prepararParte('Segundo, com **negrito**.', { idioma: 'portuguese' }) === 'Segundo, com negrito.' || 'markdown',
        e.prepararParte('It costs 300 dollars.', { idioma: 'english' }) === 'It costs 300 dollars.' || 'inglês mexido',
        e.prepararParte('Custa R$ 10.', { idioma: 'portuguese', porExtenso: false }) === 'Custa R$ 10.' || 'por extenso desligado',
        e.prepararParte(longo, { idioma: 'portuguese' }).length > 450 || 'o texto foi cortado (o corte de 450 do chat não vale aqui)',
      ];
    },
  },
  {
    nome: 'estúdio de voz: legenda pelas durações das partes (frases dividem o tempo, pausa entre partes, velocidade encurta); filtros do ffmpeg (tom mantém a duração, atempo encadeado fora de 0,5–2)',
    tipo: 'unidade',
    executar() {
      const srt = e.legenda([{ texto: 'Olá. Tudo bem?', segundos: 2 }, { texto: 'Fim.', segundos: 1 }], { pausa: 0.5 });
      const rapido = e.legenda([{ texto: 'Um.', segundos: 4 }], { pausa: 0, velocidade: 2 });
      return [
        /1\n00:00:00,000 --> 00:00:00,615\nOlá\./.test(srt) && /3\n00:00:02,500 --> 00:00:03,500\nFim\./.test(srt) || srt,
        /00:00:00,000 --> 00:00:02,000/.test(rapido) || rapido,
        e.filtros({ velocidade: 1, tom: 0, volume: 0, normalizar: false }) === '' || 'sem ajuste, sem filtro',
        e.filtros({ velocidade: 3, normalizar: false }) === 'atempo=2,atempo=1.5000' || e.filtros({ velocidade: 3, normalizar: false }),
        /^asetrate=\d+,aresample=24000,atempo=0\.\d+$/.test(e.filtros({ tom: 2, normalizar: false })) || e.filtros({ tom: 2, normalizar: false }),
        /loudnorm=I=-16/.test(e.filtros({})) || 'volume padrão de vídeo',
        e.tempoSrt(3725.5) === '01:02:05,500' || e.tempoSrt(3725.5),
      ];
    },
  },
  {
    nome: 'estúdio de voz: clonar só com autorização; apagar voz não sai da pasta das vozes; motor não instalado e texto vazio dão erro claro; o que a tela monta vem da lista dos motores',
    tipo: 'unidade',
    async executar() {
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-estudio-'));
      const fora = path.join(pasta, 'importante.txt');
      fs.writeFileSync(fora, 'não apagar');
      const s = new e.EstudioDeVoz(pasta, { ffmpeg: path.join(pasta, 'ffmpeg.exe') });
      const erro = async (f) => {
        try {
          await f();
          return '';
        } catch (err) {
          return err.message;
        }
      };
      const semAutorizacao = await erro(() => s.salvarVoz({ nome: 'x', origem: fora }));
      fs.mkdirSync(path.join(pasta, 'vozes', 'a'), { recursive: true });
      fs.writeFileSync(path.join(pasta, 'vozes', 'a', 'voz.json'), JSON.stringify({ nome: 'A', texto: 'oi', autorizada: true }));
      const antes = s.vozesSalvas().length;
      s.apagarVoz('..');
      s.apagarVoz('../..');
      const naoSaiu = fs.existsSync(fora) && s.vozesSalvas().length === antes;
      s.apagarVoz('a');
      const st = s.estado();
      const resultado = [
        /autoriza/.test(semAutorizacao) || `sem autorização: ${semAutorizacao}`,
        antes === 1 && naoSaiu && s.vozesSalvas().length === 0 || 'apagar voz',
        /não está instalado/.test(await erro(() => s.gerar({ motor: 'qwen', texto: 'oi' }))) || 'motor não instalado',
        !st.motores.omni.instalado && st.motores.qwen.vozes.length === 9 && st.motores.omni.descricao.idade.length === 5 || 'estado',
        e.UV.sha256.length === 64 && /\/0\.13\.5\//.test(e.UV.url) || 'uv com versão e SHA-256 fixos',
        ['omni', 'qwen'].every((m) => e.MOTORES[m].parametros.every((p) => p.chave && p.rotulo && (p.tipo === 'sim' || (p.min < p.max && p.padrao >= p.min && p.padrao <= p.max)))) || 'parâmetros com faixa e padrão válidos',
      ];
      fs.rmSync(pasta, { recursive: true, force: true });
      return resultado;
    },
  },
  {
    nome: 'estúdio de voz (fluidez): pausa longa no meio da fala vira a pausa máxima, a curta (vírgula, consoante) fica, as pontas saem; formato inesperado fica como está; velocidade e tom pelo rubberband',
    tipo: 'unidade',
    executar() {
      // 24 kHz: fala (seno alto) 1 s · respiração baixa 1,2 s · fala 0,5 s · pausa curta 0,15 s · fala 0,5 s, com 0,4 s de silêncio nas pontas
      const taxa = 24000;
      const trechos = [[0.4, 0], [1, 8000], [1.2, 150], [0.5, 8000], [0.15, 150], [0.5, 8000], [0.4, 0]];
      const amostras = [];
      for (const [seg, amp] of trechos) for (let i = 0; i < Math.round(seg * taxa); i += 1) amostras.push(Math.round(amp * Math.sin(i / 3)));
      const dados = Buffer.from(new Int16Array(amostras).buffer);
      const cab = Buffer.alloc(44);
      cab.write('RIFF', 0); cab.writeUInt32LE(36 + dados.length, 4); cab.write('WAVE', 8); cab.write('fmt ', 12);
      cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22); cab.writeUInt32LE(taxa, 24);
      cab.writeUInt32LE(taxa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34); cab.write('data', 36); cab.writeUInt32LE(dados.length, 40);
      const r = e.encurtarPausas(Buffer.concat([cab, dados]), { maxima: 0.3 });
      // esperado: 1 + 0,3 + 0,5 + 0,15 + 0,5 + 2 × 0,03 (pontas) ≈ 2,51 s (antes: 4,15 s)
      const fala = (r.wav.length - 44) / 2;
      return [
        r && Math.abs(r.segundos - 2.51) < 0.06 || `duração ${r?.segundos}`,
        fala === Math.round(r.segundos * taxa) && r.wav.readUInt32LE(40) === fala * 2 || 'cabeçalho do WAV',
        e.encurtarPausas(Buffer.from('não é wav'), { maxima: 0.3 }) === null || 'formato inesperado',
        /^rubberband=tempo=1.1000:pitch=0.94387:formant=preserved/.test(e.filtros({ velocidade: 1.1, tom: -1 }, 24000, { rubberband: true })) || e.filtros({ velocidade: 1.1, tom: -1 }, 24000, { rubberband: true }),
        e.ACABAMENTO.some((p) => p.chave === 'pausaMaxima' && p.padrao === 0.3) || 'ajuste da pausa máxima na tela',
      ];
    },
  },
  {
    nome: 'estúdio de voz: texto com siglas e números avisa que o Qwen embola (o OmniVoice lê melhor); narração comum não avisa; nenhum caractere de controle no código do estúdio (12/11: um "\b" virou backspace e a checagem do rubberband respondia sempre "não")',
    tipo: 'unidade',
    executar() {
      const raiz = path.join(__dirname, '..', '..');
      const arquivos = ['src/estudio-de-voz/index.js', 'src/estudio-de-voz/servidor.py', 'renderer/estudio.js'];
      const sujos = arquivos.filter((a) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(path.join(raiz, a), 'utf8')));
      return [
        e.cheioDeSiglas('A RTX 5070 Ti tem 16 GB de memória GDDR7 e roda em 1440p.') || 'texto técnico',
        !e.cheioDeSiglas('Neste vídeo, vamos montar um PC gamer do zero. Primeiro, escolhemos a placa-mãe.') || 'narração comum',
        !sujos.length || `caractere de controle em: ${sujos.join(', ')}`,
        /embola siglas/.test(e.MOTORES.qwen.resumo) || 'o resumo do Qwen avisa',
      ];
    },
  },
];
