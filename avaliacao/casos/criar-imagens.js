'use strict';

/**
 * Fase 5 (16/10): criar imagens com o FLUX.2 Klein (stable-diffusion.cpp).
 * Recomendação pela placa, instalação com SHA-256, geração com a troca de
 * memória e o fluxo do núcleo (prompt → gerar → revisar). Programa, rede e
 * modelo são dublês.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const { GeradorDeImagens, recomendar, MODELOS } = require('../../src/gerador-de-imagens');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const resposta = (corpo) => {
  const b = Buffer.isBuffer(corpo) ? corpo : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  return { ok: true, status: 200, headers: { get: () => String(b.length) }, body: [b], json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b };
};

module.exports = [
  {
    nome: 'imagens: recomendação pela placa — NVIDIA com 8 GB usa CUDA, outra placa com 8 GB+ usa Vulkan (avisando que é lenta), placa pequena ou sem placa fica desligada com o motivo',
    tipo: 'unidade',
    executar() {
      const r = (gpus, plataforma = 'win32') => recomendar({ gpus, plataforma });
      const nvidia = r([{ nome: 'NVIDIA GeForce RTX 3060 Ti', vramGB: 8 }]);
      const amd = r([{ nome: 'AMD Radeon RX 7800 XT', vramGB: 16 }]);
      const pequena = r([{ nome: 'NVIDIA GeForce GTX 1650', vramGB: 4 }]);
      return [
        nvidia.pode && nvidia.motor === 'cuda' || `NVIDIA: ${JSON.stringify(nvidia)}`,
        amd.pode && amd.motor === 'vulkan' && /lenta/.test(amd.motivo) || `AMD: ${JSON.stringify(amd)}`,
        !pequena.pode && /4 GB/.test(pequena.motivo) || `pequena: ${JSON.stringify(pequena)}`,
        !r([]).pode && !r([{ nome: 'Apple M2', vramGB: 16 }], 'darwin').pode || 'sem placa / fora do Windows: desligado',
      ];
    },
  },
  {
    nome: 'imagens: instalar confere o SHA-256 do programa e de cada modelo (adulterado não fica), não baixa de novo o modelo que já está certo, guarda a versão anterior do programa e "voltar" restaura',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-flux-'));
      const zip = (v) => Buffer.from(`zip-${v}`);
      let versao = 'master-10-aaa';
      let adulterar = false;
      const baixados = [];
      // os modelos de verdade têm GB: o dublê troca bytes e SHA-256 pelos do conteúdo falso
      const modelos = MODELOS.map((m) => ({ ...m, conteudo: Buffer.from(`modelo ${m.nome}`) }));
      MODELOS.forEach((m, i) => Object.assign(m, { _bytes: m.bytes, _sha: m.sha256, bytes: modelos[i].conteudo.length, sha256: sha(modelos[i].conteudo) }));
      const buscar = async (url) => {
        baixados.push(url);
        if (/api\.github\.com/.test(url)) {
          return resposta({ tag_name: versao, assets: [{ name: `sd-${versao}-bin-win-cuda12-x64.zip`, browser_download_url: `zip/${versao}`, size: 9, digest: `sha256:${sha(zip(versao))}` }, { name: 'cudart-sd-bin-win-cu12-x64.zip', browser_download_url: 'zip/cudart', size: 9, digest: `sha256:${sha(zip('cudart'))}` }] });
        }
        if (url.startsWith('zip/')) return resposta(adulterar ? Buffer.from('outra coisa') : zip(url.slice(4)));
        const m = modelos.find((x) => url.endsWith(x.arquivo));
        return resposta(m.conteudo);
      };
      const extrairZip = (buffer, destino) => {
        fs.mkdirSync(destino, { recursive: true });
        if (/cudart/.test(buffer.toString())) fs.writeFileSync(path.join(destino, 'cudart64_12.dll'), 'x');
        else fs.writeFileSync(path.join(destino, 'sd-cli.exe'), buffer.toString());
      };
      const g = new GeradorDeImagens(dir, { buscar, extrairZip, plataforma: 'win32' });
      const r = [];
      try {
        await g.instalar({ motor: 'cuda' });
        r.push((g.instalado() && g.info().versao === 'master-10-aaa' && fs.existsSync(path.join(g.bin, 'cudart64_12.dll'))) || 'instalou programa, bibliotecas e modelos');
        versao = 'master-11-bbb';
        const e = await g.estado({ gpus: [{ nome: 'NVIDIA GeForce RTX 3060 Ti', vramGB: 8 }], plataforma: 'win32' });
        r.push((e.atualizar && e.disponivel === 'master-11-bbb') || `oferece atualizar: ${JSON.stringify(e)}`);
        adulterar = true;
        const recusou = await g.instalar({ motor: 'cuda' }).then(() => false, (err) => /SHA-256/.test(err.message));
        r.push((recusou && g.info().versao === 'master-10-aaa') || 'programa adulterado: recusa e mantém o instalado');
        adulterar = false;
        baixados.length = 0;
        await g.instalar({ motor: 'cuda' });
        r.push((g.info().versao === 'master-11-bbb' && fs.existsSync(g.anterior)) || 'atualizou guardando a anterior');
        r.push(!baixados.some((u) => /huggingface/.test(u)) || 'modelos já certos não são baixados de novo');
        g.voltar();
        r.push(g.info().versao === 'master-10-aaa' || 'voltou para a anterior');
        fs.writeFileSync(path.join(g.modelos, MODELOS[2].nome), Buffer.alloc(MODELOS[2].bytes, 7)); // mesmo tamanho, conteúdo errado
        await g.instalar({ motor: 'cuda' });
        r.push(fs.readFileSync(path.join(g.modelos, MODELOS[2].nome)).equals(modelos[2].conteudo) || 'modelo corrompido é baixado de novo');
      } finally {
        MODELOS.forEach((m) => Object.assign(m, { bytes: m._bytes, sha256: m._sha }));
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return r;
    },
  },
  {
    nome: 'imagens: gerar passa prompt, tamanho, semente e imagem de referência ao sd-cli com tudo na placa; sem memória, tenta de novo com o codificador de texto no processador',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-flux-gerar-'));
      const g = new GeradorDeImagens(dir, { plataforma: 'win32' });
      fs.mkdirSync(g.bin, { recursive: true });
      fs.writeFileSync(g.exe, '');
      fs.writeFileSync(path.join(g.bin, 'versao.json'), JSON.stringify({ versao: 'master-1-a', motor: 'cuda' }));
      fs.mkdirSync(g.modelos, { recursive: true });
      for (const m of MODELOS) fs.closeSync(fs.openSync(path.join(g.modelos, m.nome), 'w')), fs.truncateSync(path.join(g.modelos, m.nome), m.bytes);
      const chamadas = [];
      g.executar = async (exe, args) => {
        chamadas.push(args);
        if (chamadas.length === 1) throw Object.assign(new Error('ggml_cuda: out of memory'), { saida: '' });
        fs.writeFileSync(args[args.indexOf('-o') + 1], 'png');
        return '';
      };
      const saida = path.join(dir, 'x.png');
      await g.gerar({ prompt: 'a red fox', saida, largura: 1216, altura: 832, semente: 7, referencias: ['C:/foto.jpg'] });
      const [a, b] = chamadas;
      fs.rmSync(dir, { recursive: true, force: true });
      const valor = (args, f) => args[args.indexOf(f) + 1];
      return [
        valor(a, '-p') === 'a red fox' && valor(a, '-W') === '1216' && valor(a, '-H') === '832' && valor(a, '-s') === '7' && valor(a, '-r') === 'C:/foto.jpg' || `argumentos: ${a.join(' ')}`,
        valor(a, '--params-backend') === 'te=CUDA0,vae=CUDA0' && valor(a, '--steps') === '4' || 'tudo na placa, 4 passos',
        valor(b, '--params-backend') === 'te=cpu,vae=CUDA0' || `sem memória: ${valor(b, '--params-backend')}`,
      ];
    },
  },
  {
    nome: 'imagens no núcleo: "crie uma imagem…" não pesquisa — o Qwen escreve o prompt, o FLUX gera, a revisão refaz com o prompt corrigido e a mesma semente (no máximo 2 vezes); sem o gerador, a resposta diz como instalar',
    tipo: 'unidade',
    async executar() {
      const rodar = async ({ revisoes = [{ ok: false, problemas: 'faltou o chapéu', prompt: 'a cat astronaut wearing a red hat' }, { ok: true }], comGerador = true, imagens = [] } = {}) => {
        const chamadas = [];
        const geradas = [];
        let rev = 0;
        const deps = {
          chamar: async (messages, opcoes = {}) => {
            chamadas.push({ messages, opcoes });
            const c = messages[0].content;
            if (/Responda SÓ com um JSON:\n\{"precisa_buscar"/.test(c)) return { content: JSON.stringify({ precisa_buscar: true, produto: false, criar_imagem: true, assuntos: [], pergunta: 'crie um gato astronauta de chapéu' }) };
            if (/Você escreve o prompt para o gerador/.test(c)) return { content: JSON.stringify({ prompt: 'a cat astronaut floating in space, 3D render', formato: imagens.length ? 'igual' : 'paisagem', legenda: 'Um gato astronauta flutuando no espaço' }) };
            if (/Esta imagem foi gerada/.test(c)) return { content: JSON.stringify(revisoes[rev++] || { ok: true }) };
            if (messages.some((m) => m.images)) return { content: 'Uma foto de um gato.\nIdentificação: um gato — certo.' };
            throw new Error(`chamada inesperada: ${c.slice(0, 80)}`);
          },
          escrever: async () => {
            throw new Error('não devia escrever resposta de pesquisa');
          },
          buscar: async () => {
            throw new Error('não devia pesquisar');
          },
          lerPagina: async () => ({}),
        };
        if (comGerador) deps.gerarImagem = async (o) => (geradas.push(o), { uri: `augpt-img://${'a'.repeat(30)}.png`, base64: 'UE5H', ms: 7000, caminho: 'imagens-criadas/gato.png' });
        else deps.semGerador = 'Para criar imagens… Ajustes → Componentes';
        const r = await nucleo.responder({ pergunta: 'crie uma imagem de um gato astronauta de chapéu', deps, imagens });
        return { r, chamadas, geradas };
      };
      const ok = await rodar();
      const sem = await rodar({ comGerador: false });
      const semRevisao = await rodar({ revisoes: [{ ok: true }] });
      const editar = await rodar({ imagens: [{ nome: 'gato.jpg', arquivo: 'C:/w/gato.jpg', base64: 'QUJD', texto: '' }] });
      const revisaoComImagem = ok.chamadas.find((c) => /Esta imagem foi gerada/.test(c.messages[0].content));
      return [
        ok.geradas.length === 2 && ok.geradas[1].prompt === 'a cat astronaut wearing a red hat' && ok.geradas[0].semente === ok.geradas[1].semente || `revisão refaz com o prompt corrigido e a mesma semente: ${JSON.stringify(ok.geradas)}`,
        ok.geradas[0].largura === 1216 && ok.geradas[0].altura === 832 || 'paisagem = 1216×832',
        revisaoComImagem?.messages[0].images?.[0] === 'UE5H' || 'a revisão olha a imagem gerada',
        /^!\[Um gato astronauta flutuando no espaço\]\(augpt-img:\/\/a+\.png\)/.test(ok.r.texto) && /refeita 1 vez depois da revisão \(faltou o chapéu\)/.test(ok.r.texto) && /\*\*Prompt usado:\*\* a cat astronaut wearing a red hat/.test(ok.r.texto) && /imagens-criadas\/gato\.png/.test(ok.r.texto) || `texto: ${ok.r.texto}`,
        ok.r.buscou === false || 'não pesquisa',
        semRevisao.geradas.length === 1 || 'revisão aprovada: uma imagem só',
        /Ajustes → Componentes/.test(sem.r.texto) && sem.geradas.length === 0 || 'sem gerador: diz como instalar',
        !/sem acento/.test(ok.r.texto) || 'sem texto entre aspas: sem aviso de acento',
        editar.geradas[0].referencias[0] === 'C:/w/gato.jpg' && editar.geradas[0].largura === null || `edição: usa a foto anexada e o tamanho dela: ${JSON.stringify(editar.geradas[0])}`,
      ];
    },
  },
  {
    nome: 'imagens no núcleo: texto do pedido escrito sem acento no prompt ("Pao Dourado", porque o gerador escreveu "Pãno") leva o aviso na resposta',
    tipo: 'unidade',
    async executar() {
      const deps = {
        revisoesDeImagem: 0,
        chamar: async (messages, opcoes = {}) => {
          const c = messages[0].content;
          if (opcoes.json && /"criar_imagem"/.test(c)) return { content: JSON.stringify({ precisa_buscar: false, criar_imagem: true, assuntos: [], pergunta: 'logo Pão Dourado' }) };
          return { content: JSON.stringify({ prompt: 'A logo for a bakery named "Pao Dourado", golden bread', formato: 'quadrado', legenda: 'Logo da padaria Pão Dourado' }) };
        },
        gerarImagem: async () => ({ uri: `augpt-img://${'b'.repeat(30)}.png`, base64: 'x', ms: 7000, caminho: null }),
      };
      const r = await nucleo.responder({ pergunta: 'crie um logo para a padaria Pão Dourado', deps });
      return [/escrito sem acento \("Pao Dourado"\)/.test(r.texto) || `aviso: ${r.texto}`];
    },
  },
];
