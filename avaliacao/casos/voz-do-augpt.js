'use strict';

/**
 * A voz do AuGPT (27/10, Kokoro no processador): o que se fala da resposta, as frases, o .tgz do motor
 * (só o binário do sistema) e a ligação no app. O modelo de verdade é medido fora da bancada (não vem nela).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { textoParaFalar, frasesParaFalar, extrairTgz, ARQUIVOS, MOTOR, Voz } = require('../../src/fala/voz');

const raiz = path.join(__dirname, '../..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

/** Um .tgz mínimo no formato do npm (ustar), para o extrator. */
function tgz(entradas) {
  const blocos = [];
  for (const [nome, conteudo] of entradas) {
    const dados = Buffer.from(conteudo);
    const cab = Buffer.alloc(512);
    cab.write(`package/${nome}`.slice(0, 100), 0);
    cab.write('0000644\0', 100);
    cab.write(`${dados.length.toString(8).padStart(11, '0')}\0`, 124);
    cab.write('        ', 148);
    cab.write('0', 156);
    cab.write('ustar\0', 257);
    let soma = 0;
    for (const b of cab) soma += b;
    cab.write(`${soma.toString(8).padStart(6, '0')}\0 `, 148);
    blocos.push(cab, dados, Buffer.alloc((512 - (dados.length % 512)) % 512));
  }
  blocos.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocos));
}

module.exports = [
  {
    nome: 'voz: da resposta só se fala o texto (sem código, tabela, link, citação e fontes); resposta longa fica nas primeiras frases e avisa que o resto está na tela',
    tipo: 'unidade',
    executar() {
      const clima = textoParaFalar('Agora em **Vitória, ES**: **28 °C**, céu limpo.\n\n```clima {"x":1}```\n\n---\n**Fontes**\n1. [x](https://x)');
      const longo = textoParaFalar(`${'A placa é boa para jogos em 4K e tem bastante memória. '.repeat(15)}`);
      const tabela = textoParaFalar('Veja a comparação:\n\n| Placa | Preço |\n|---|---|\n| RTX 5080 | R$ 6.999 |\n\nA melhor é a RTX 5080 [1] [(8)](https://uol.com.br).');
      return [
        clima === 'Agora em Vitória, ES: 28 °C, céu limpo.' || clima,
        (longo.length < 560 && /Os detalhes estão na tela\.$/.test(longo)) || longo,
        (!/\||https|\[|RTX 5080 \|/.test(tabela) && /A melhor é a RTX 5080\./.test(tabela)) || tabela,
        frasesParaFalar('Primeira frase. Segunda frase! Terceira?').length === 3 || 'frases',
        // 27/10: o ponto de número e de arquivo não corta a frase
        JSON.stringify(frasesParaFalar('Custa R$ 6.999,90 hoje. Salvei em teclado.txt agora!')) === JSON.stringify(['Custa R$ 6.999,90 hoje.', 'Salvei em teclado.txt agora!']) || JSON.stringify(frasesParaFalar('Custa R$ 6.999,90 hoje. Salvei em teclado.txt agora!')),
        frasesParaFalar('palavra '.repeat(80)).every((f) => f.length <= 220) || 'frase longa é cortada',
      ];
    },
  },
  {
    nome: 'voz: o motor vem do .tgz do npm só com o JavaScript e o binário deste sistema (os outros sistemas e "../" ficam de fora)',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-voz-'));
      try {
        const arquivo = path.join(dir, 'p.tgz');
        const meu = `bin/napi-v3/${process.platform}/${process.arch}/onnxruntime_binding.node`;
        fs.writeFileSync(arquivo, tgz([['package.json', '{"name":"x"}'], ['dist/index.js', 'module.exports=1'], [meu, 'binario'], ['bin/napi-v3/linux/x64/libonnxruntime.so', 'outro sistema'], ['../fora.txt', 'nao'], ['README.md', 'leia']]));
        const destino = path.join(dir, 'saida');
        const plataforma = `bin/napi-v3/${process.platform}/${process.arch}/`;
        await extrairTgz(arquivo, destino, (n) => n === 'package.json' || n.startsWith('dist/') || n.startsWith(plataforma));
        return [
          fs.readFileSync(path.join(destino, meu), 'utf8') === 'binario' || 'binário deste sistema',
          fs.existsSync(path.join(destino, 'dist/index.js')) && fs.existsSync(path.join(destino, 'package.json')) || 'dist e package.json',
          !fs.existsSync(path.join(destino, 'bin/napi-v3/linux')) || 'outro sistema entrou',
          !fs.existsSync(path.join(dir, 'fora.txt')) && !fs.existsSync(path.join(destino, 'README.md')) || '"../" ou arquivo fora da lista',
        ];
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    nome: 'voz: tudo o que é baixado tem SHA-256 e revisão fixa; nada instalado sem o clique; o tokenizador põe "$" nas pontas e ignora o que não conhece',
    tipo: 'unidade',
    executar() {
      const v = new Voz(path.join(os.tmpdir(), 'augpt-voz-nao-existe'));
      v.vocab = { $: 0, a: 43, b: 44 };
      return [
        [...ARQUIVOS, ...MOTOR].every((a) => /^[0-9a-f]{64}$/.test(a.sha256) && a.bytes > 0) || 'SHA-256',
        /const REV = '[0-9a-f]{40}';/.test(ler('src/fala/voz.js')) && /resolve\/\$\{REV\}/.test(ler('src/fala/voz.js')) || 'revisão fixa',
        v.instalada() === false || 'sem instalar',
        JSON.stringify(v.ids('ab?a')) === JSON.stringify([0, 43, 44, 43, 0]) || JSON.stringify(v.ids('ab?a')),
      ];
    },
  },
  {
    nome: 'voz no app: fala quando você chamou pela voz (padrão), sempre ou nunca; "Ei Jarvis" e pedido novo calam a fala; "para" diz "Parei"; a seção em Ajustes',
    tipo: 'unidade',
    executar() {
      const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
      const fala = ler('renderer/fala.js');
      const escuta = ler('renderer/escuta.js');
      return [
        /vozFalar: 'voz'/.test(ler('src/config.js')) || 'padrão',
        /quando !== 'nunca' && \(quando === 'sempre' \|\| window\.falaPorVoz\.pedidoPorVoz\)/.test(fala) || 'quando falar',
        // 27/10: a fala começa durante a escrita — não em preço, produto ou o que muda com o tempo; reescrita cala
        /if \(d\.produto\) turnoDaFala\.podeAntes = false;/.test(fala) && fala.includes("if (/R\\$|US\\$|€|%/.test(corrido)) turnoDaFala.podeAntes = false;") || 'produto e preço esperam o fim',
        /manipuladores\['resposta-reinicia'\][\s\S]{0,200}parar\(\);/.test(fala) || 'reescrita cala',
        /fins\.length >= 1 && corrido\.length >= 80/.test(fala) && /\.split\(\/```\|\\n\\s\*\\\|\|\\n-\{3,\}\/\)\[0\]/.test(fala) || 'só texto corrido, 1ª frase',
        /falar\(corrido\.slice\(0, fins\[fins\.length - 1\]\.index \+ 1\), \{ parcial: true \}\)/.test(fala) || 'parcial',
        /if \(atual !== null\) api\.voz\.falar\(d\.resumo, \{ continuar: true \}\)/.test(fala) || 'continua sem repetir; parada não recomeça',
        /window\.falaPorVoz\.pedidoPorVoz = true/.test(escuta) || 'pedido pela voz marca',
        /g\.calouAFala = Boolean\(window\.falaPorVoz\?\.falando\(\)\);\s*window\.falaPorVoz\?\.parar\(\);/.test(escuta) || 'a chamada cala a fala',
        /window\.falaPorVoz\?\.parar\(\); \/\/ a voz do AuGPT/.test(ler('renderer/app-abas.js')) || 'pedido novo cala',
        (/id="btnVozInstalar"/.test(ler('renderer/index.html')) && /<script src="fala.js"><\/script>/.test(ler('renderer/index.html'))) || 'Ajustes e script',
        /ipcMain\.handle\('voz:falar'/.test(ler('electron/main.js')) && /voz = new Voz\(/.test(ler('electron/main.js')) || 'processo principal',
        /const iguais = falado\.every\(\(f, i\) => semEspaco\(f\) === semEspaco\(frases\[i\]\)\);/.test(ler('electron/main.js')) || 'continuar confere o que já foi dito',
        textoParaFalar('Uma frase. '.repeat(80), { semAviso: true }).endsWith('frase.') || 'parcial sem o aviso do fim',
      ];
    },
  },
];
