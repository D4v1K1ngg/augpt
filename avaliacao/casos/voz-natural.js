'use strict';

/**
 * A voz natural (Qwen3-TTS, 1/11): as 9 vozes, o processo da voz (por linhas de JSON — aqui, um de mentira), as
 * frases já gravadas e as regras do processo principal: com o modelo principal escrevendo, a voz natural não gera.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { VozQwen, VOZES_NATURAIS, FRASES_PRONTAS, separarFrasePronta, pedacosNaturais, UV } = require('../../src/fala/voz-qwen');

/** Um processo da voz de mentira: responde "pronto" e devolve, para cada frase, 0,1 s de áudio por letra. */
function processoFalso(registro) {
  return (exe, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    registro.push({ exe, args });
    p.stdin = {
      write(linha) {
        const j = JSON.parse(linha);
        setImmediate(() => {
          if (j.texto === 'quebra') return p.stdout.emit('data', `${JSON.stringify({ id: j.id, erro: 'falhou' })}\n`);
          const pcm = new Float32Array(Math.round(j.texto.length * 0.1 * 24000)).fill(0.1);
          p.stdout.emit('data', `${JSON.stringify({ id: j.id, taxa: 24000, pcm: Buffer.from(pcm.buffer).toString('base64') })}\n`);
        });
      },
    };
    p.kill = () => setImmediate(() => p.emit('exit', 0));
    setImmediate(() => p.stdout.emit('data', `aviso perdido no meio\n${JSON.stringify({ pronto: true, vozes: ['ryan'], taxa: 24000 })}\n`));
    return p;
  };
}

module.exports = [
  {
    nome: 'voz natural: as 9 vozes prontas ("qwen:ryan"…); só no Windows com placa NVIDIA; a saudação e o nome saem para casar com as frases gravadas; uv e modelo em versões fixas',
    tipo: 'unidade',
    executar() {
      const v = new VozQwen(path.join(os.tmpdir(), 'nao-existe'));
      return [
        Object.keys(VOZES_NATURAIS).length === 9 && Object.keys(VOZES_NATURAIS).every((k) => k.startsWith('qwen:')) || Object.keys(VOZES_NATURAIS).join(),
        process.platform !== 'win32' || (v.suportado([{ nome: 'NVIDIA GeForce RTX 3060 Ti' }]) && !v.suportado([{ nome: 'AMD Radeon RX 7800 XT' }]) && !v.suportado([])) || 'placa NVIDIA',
        JSON.stringify(separarFrasePronta('Bom dia, Davi! Claro, Davi, já vejo isso pra você.', 'Davi')) === '{"saudacao":"Bom dia!","resto":"Claro, já vejo isso pra você."}' || JSON.stringify(separarFrasePronta('Bom dia, Davi! Claro, Davi, já vejo isso pra você.', 'Davi')),
        separarFrasePronta('Davi, já vejo isso pra você.', 'Davi').resto === 'Já vejo isso pra você.' && separarFrasePronta('Deixa comigo, Davi.', 'Davi').resto === 'Deixa comigo.' || 'o nome',
        /^[a-f0-9]{64}$/.test(UV.sha256) && /\/0\.13\.0\//.test(UV.url) && FRASES_PRONTAS.includes('Deixa comigo.') || 'versões fixas',
        !v.instalada() || 'sem a pasta, não está instalada',
        // pedaços curtos (1/11: a 1ª frase de 220 letras levava ~12 s para começar a tocar)
        JSON.stringify(pedacosNaturais('A fotossíntese é o processo pelo qual as plantas, algas e algumas bactérias transformam a energia da luz do sol em energia química, armazenada na forma de glicose, usando gás carbônico e água e liberando oxigênio como subproduto. Ela acontece nos cloroplastos. O preço é R$ 6.999,90 hoje.').map((x) => x.length)) === '[49,113,65,30,27]' || JSON.stringify(pedacosNaturais('A fotossíntese é o processo pelo qual as plantas, algas e algumas bactérias transformam a energia da luz do sol em energia química, armazenada na forma de glicose, usando gás carbônico e água e liberando oxigênio como subproduto.')),
      ];
    },
  },
  {
    nome: 'voz natural: o processo da voz responde por linhas de JSON (aviso solto no meio é ignorado), frase por frase; erro de uma frase não derruba; a frase gravada toca com a saudação na frente; desliga sozinho',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-vn-'));
      const fonte = path.join(dir, 'servidor-fonte.py');
      fs.writeFileSync(fonte, '# servidor');
      try {
        const chamadas = [];
        const v = new VozQwen(dir, { processo: processoFalso(chamadas), servidorFonte: fonte });
        const um = await v.gerar('Oi, tudo bem?', 'ryan');
        const frases = [];
        for await (const { frase, pcm } of v.falar('Bom dia. Vou pesquisar isso agora.', { voz: 'aiden' })) frases.push(`${frase} (${(pcm.length / 24000).toFixed(1)} s)`);
        let erro = '';
        await v.gerar('quebra').catch((e) => (erro = e.message));
        const depois = await v.gerar('Ainda funciona.');
        await v.prepararFrases('ryan');
        const gravadas = fs.readdirSync(path.join(dir, 'frases', 'ryan')).length;
        const deixa = v.frasePronta('Deixa comigo, Davi.', 'ryan', 'Davi');
        const comOi = v.frasePronta('Bom dia, Davi! Deixa comigo.', 'ryan', 'Davi');
        const nada = v.frasePronta('Achei três fontes no Reddit.', 'ryan', 'Davi');
        const servidorCopiado = fs.readFileSync(path.join(dir, 'servidor.py'), 'utf8');
        v.parar();
        return [
          um.length === Math.round('Oi, tudo bem?'.length * 0.1 * 24000) && chamadas.length === 1 && chamadas[0].args.includes(path.join(dir, 'modelo')) || `áudio ${um.length}`,
          frases.length === 2 && /^Bom dia\./.test(frases[0]) || frases.join(' | '),
          erro === 'falhou' && depois.length > 0 && chamadas.length === 1 || `${erro} / ${chamadas.length} processos`,
          gravadas === FRASES_PRONTAS.length || `${gravadas} frases gravadas`,
          deixa?.length === Math.round('Deixa comigo.'.length * 0.1 * 24000) && comOi?.length === Math.round('Bom dia!'.length * 0.1 * 24000) + 4800 + deixa.length && nada === null || `${deixa?.length} / ${comOi?.length} / ${nada}`,
          servidorCopiado === '# servidor' || 'o servidor copiado para a pasta do componente',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'voz natural no processo principal: com o modelo escrevendo, a fala do meio da escrita espera o fim (mesmo id), a confirmação toca gravada e a narração fica só no chat; falhou, a frase sai pelo Kokoro; o servidor não suja o protocolo',
    tipo: 'unidade',
    executar() {
      const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');
      const main = ler('electron/main.js');
      const servidor = ler('src/fala/qwen/servidor.py');
      return [
        /if \(natural && agent\?\.rodando\) \{[\s\S]{0,200}if \(parcial\) \{[\s\S]{0,200}falaAdiada = id;/.test(main) || 'a fala do meio da escrita espera',
        /if \(continuar && \(falado\.length \|\| falaAdiada === falaAtual\)\)/.test(main) || 'o "continuar" fala tudo com o mesmo id',
        /vozNatural\.frasePronta\(String\(texto \|\| ''\), natural, primeiroNome\(\)\)/.test(main) && /a voz natural espera o modelo principal terminar/.test(main) || 'a confirmação gravada e a narração calada',
        /console\.warn\('voz natural:'[\s\S]{0,300}for await \(const \{ pcm \} of voz\.falar\(frase, opcoes\)\)/.test(main) || 'o Kokoro de reserva',
        /PROTOCOLO = os\.fdopen\(os\.dup\(sys\.stdout\.fileno\(\)\)/.test(servidor) && /sys\.stdout = sys\.stderr/.test(servidor) && /HF_HUB_OFFLINE/.test(servidor) || 'o servidor',
        /if \(\(porVoz === true \|\| config\.data\.vozFalar === 'sempre'\) && vozNaturalEscolhida\(\)\) vozNatural\.iniciar\(\)/.test(main) && /vozNatural\?\.parar\(\);/.test(main) || 'liga no pedido pela voz e desliga ao fechar',
      ];
    },
  },
];
