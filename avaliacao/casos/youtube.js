'use strict';

/**
 * YouTube pelo yt-dlp (Fase 3, 16/10): escolha da legenda, instalação com
 * SHA-256, volta à versão anterior e as ferramentas do núcleo. O executável,
 * o GitHub e o YouTube são dublês.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { YtDlp, escolherLegenda, textoDaLegenda, idDoVideo, pareceMudancaDoYouTube } = require('../../src/ytdlp');
const nucleo = require('../../src/agent/nucleo');

const resposta = (corpo, { json = false } = {}) => ({
  ok: true,
  status: 200,
  json: async () => (json ? corpo : JSON.parse(corpo)),
  arrayBuffer: async () => Buffer.from(corpo),
});

module.exports = [
  {
    nome: 'youtube: legenda manual em pt/en primeiro; senão a automática no idioma ORIGINAL (a traduzida dava HTTP 429); sem trilha, null; json3 vira texto; id do vídeo em vários formatos de link',
    tipo: 'unidade',
    executar() {
      const j3 = (u) => [{ ext: 'vtt', url: `${u}.vtt` }, { ext: 'json3', url: u }];
      const manual = escolherLegenda({ language: 'en', subtitles: { 'en-US': j3('m-en') }, automatic_captions: { 'en-orig': j3('a-en') } });
      const auto = escolherLegenda({ language: 'en-US', subtitles: {}, automatic_captions: { pt: j3('traduzida'), 'en-orig': j3('original'), en: j3('en') } });
      const nada = escolherLegenda({ subtitles: {}, automatic_captions: {} });
      const texto = textoDaLegenda({ events: [{ segs: [{ utf8: 'o som ' }, { utf8: 'é neutro' }] }, { tStartMs: 1 }, { segs: [{ utf8: '\n e o grave' }] }] });
      return [
        manual?.url === 'm-en' && manual.automatica === false || `manual: ${JSON.stringify(manual)}`,
        auto?.url === 'original' && auto.idioma === 'en' && auto.automatica === true || `automática original: ${JSON.stringify(auto)}`,
        nada === null || 'sem legenda: null',
        texto === 'o som é neutro e o grave' || `texto: "${texto}"`,
        ['https://www.youtube.com/watch?v=rY-FTPEzDCk&t=3', 'https://youtu.be/rY-FTPEzDCk', 'https://www.youtube.com/shorts/rY-FTPEzDCk'].every((u) => idDoVideo(u) === 'rY-FTPEzDCk') && idDoVideo('https://x.com') === null || 'id do vídeo',
        pareceMudancaDoYouTube('ERROR: [youtube] x: Sign in to confirm you’re not a bot') && !pareceMudancaDoYouTube('ERROR: Video unavailable') || 'erro de "o YouTube mudou"',
      ];
    },
  },
  {
    nome: 'youtube: instalar confere o SHA-256 (arquivo adulterado não troca nada), testa a versão nova antes de trocar, guarda a anterior e "voltar" restaura; versão nova mais recente vira "atualizar"',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ytdlp-'));
      const versoes = { v1: 'BIN-v1', v2: 'BIN-v2' };
      let publicada = 'v1';
      let adulterado = false;
      const sha = (t) => crypto.createHash('sha256').update(Buffer.from(t)).digest('hex');
      const buscar = async (url) => {
        if (/api\.github\.com/.test(url)) return resposta({ tag_name: publicada, assets: [{ name: 'yt-dlp.exe', browser_download_url: `bin/${publicada}` }, { name: 'SHA2-256SUMS', browser_download_url: `somas/${publicada}` }] }, { json: true });
        if (url.startsWith('somas/')) return resposta(`${sha(versoes[url.slice(6)])}  yt-dlp.exe\n${'0'.repeat(64)}  yt-dlp_linux\n`);
        if (url.startsWith('bin/')) return resposta(adulterado ? 'BIN-malicioso' : versoes[url.slice(4)]);
        throw new Error(`url inesperada ${url}`);
      };
      // "rodar" o executável = ler o arquivo; a versão é o que vem depois de "BIN-"
      const executar = async (arquivo) => fs.readFileSync(arquivo, 'utf8').replace('BIN-', '');
      const y = new YtDlp(dir, { plataforma: 'win32', buscar, executar });
      const r = [];
      await y.instalar();
      const e1 = await y.estado();
      r.push((e1.instalada === 'v1' && !e1.atualizar && !e1.temAnterior) || `instalou v1: ${JSON.stringify(e1)}`);
      publicada = 'v2';
      adulterado = true;
      const recusou = await y.instalar().then(() => false, (err) => /SHA-256/.test(err.message));
      r.push((recusou && (await y.versao()) === 'v1' && !fs.existsSync(`${y.caminho}.novo`)) || 'adulterado: recusa e mantém a v1');
      r.push((await y.estado()).atualizar === true || 'v2 publicada: oferece atualizar');
      adulterado = false;
      await y.instalar();
      const e2 = await y.estado();
      r.push((e2.instalada === 'v2' && e2.temAnterior) || `atualizou guardando a anterior: ${JSON.stringify(e2)}`);
      const e3 = await y.voltar();
      r.push((e3.instalada === 'v1' && !e3.temAnterior) || `voltou: ${JSON.stringify(e3)}`);
      fs.rmSync(dir, { recursive: true, force: true });
      return r;
    },
  },
  {
    nome: 'youtube no núcleo: com o yt-dlp, o pesquisador ganha buscar_no_youtube e ver_video; o vídeo vira fonte com o que é falado e os comentários; sem legenda, avisa; "o YouTube mudou" vira aviso; sem yt-dlp ou no modo rápido, nada muda',
    tipo: 'unidade',
    async executar() {
      const rodar = async ({ modo = 'normal', comYoutube = true, legenda = 'O Titan S tem grave controlado e palco amplo para o preço. '.repeat(10), falha = null } = {}) => {
        const roteiro = [
          { ferramentas: [['buscar_no_youtube', { buscas: ['dunu titan s review'] }], ['buscar_na_web', { buscas: ['dunu titan s'] }]] },
          { ferramentas: [['ver_video', { fonte: 1, foco: 'som' }], ['pronto', {}]] },
        ];
        let passo = 0;
        const chamadas = [];
        const eventos = [];
        const escritas = [];
        const deps = {
          chamar: async (messages, opcoes = {}) => {
            chamadas.push({ messages, opcoes });
            if (opcoes.json) return { content: JSON.stringify({ precisa_buscar: true, produto: false, pergunta: 'o dunu titan s é bom?' }), chamadas: [] };
            const r = roteiro[passo++];
            return { content: '', chamadas: (r ? r.ferramentas : [['pronto', {}]]).map(([name, args]) => ({ function: { name, arguments: args } })) };
          },
          escrever: async (messages, onToken) => (escritas.push(messages), onToken('ok [1]'), 'ok [1]'),
          buscar: async (q) => Array.from({ length: 4 }, (_, i) => ({ titulo: `${q} ${i}`, url: `https://site${i}.com/${encodeURIComponent(q)}`, resumo: 'texto' })),
          lerPagina: async () => ({ texto: 'conteúdo da página '.repeat(30) }),
          emit: (e, d) => eventos.push([e, d]),
        };
        if (comYoutube) {
          deps.buscarNoYoutube = async () => [{ id: 'rY-FTPEzDCk', url: 'https://www.youtube.com/watch?v=rY-FTPEzDCk', titulo: 'Dunu Titan S review', canal: 'Hangout Audio', duracao: 370, visualizacoes: 59779 }];
          deps.verVideo = async () => {
            if (falha) throw Object.assign(new Error(falha), { mudancaDoYouTube: /Sign in/.test(falha) });
            return { titulo: 'Dunu Titan S review', canal: 'Hangout Audio', descricao: 'Review do Titan S.', legenda, comentarios: [{ texto: 'Melhor fone até 100 dólares', curtidas: 40 }] };
          };
        }
        const res = await nucleo.responder({ pergunta: 'o dunu titan s é bom?', modo, deps });
        const ferramentas = chamadas.filter((c) => c.opcoes.tools).flatMap((c) => c.opcoes.tools.map((t) => t.function.name));
        const material = escritas[0]?.[0]?.content || '';
        return { res, ferramentas, material, eventos };
      };
      const ok = await rodar();
      const semLegenda = await rodar({ legenda: '' });
      const mudou = await rodar({ falha: 'Sign in to confirm you’re not a bot' });
      const sem = await rodar({ comYoutube: false });
      const rapido = await rodar({ modo: 'rapido' });
      const video = ok.res.fontes.find((f) => f.video);
      return [
        ok.ferramentas.includes('buscar_no_youtube') && ok.ferramentas.includes('ver_video') || `ferramentas: ${[...new Set(ok.ferramentas)]}`,
        /No vídeo \(Hangout Audio\): O Titan S tem grave controlado/.test(ok.material) && /Comentários mais curtidos de quem assistiu: "Melhor fone até 100 dólares"/.test(ok.material) || 'a escrita recebe o que é falado e os comentários',
        video?.lido === true && video.url.includes('rY-FTPEzDCk') || `a fonte volta marcada como vídeo lido: ${JSON.stringify(ok.res.fontes)}`,
        ok.eventos.some(([e, d]) => e === 'fonte' && d.provedor === 'youtube' && d.tipo === 'leitura') || 'painel de atividade vê a leitura do vídeo',
        /Vídeo sem legenda: não dá para saber o que é falado/.test(semLegenda.material) && /Review do Titan S/.test(semLegenda.material) || 'sem legenda: avisa e usa a descrição',
        mudou.eventos.some(([e, d]) => e === 'aviso' && /Componentes/.test(d.texto)) || '"o YouTube mudou": aviso para atualizar',
        !sem.ferramentas.includes('buscar_no_youtube') && !rapido.ferramentas.includes('buscar_no_youtube') || 'sem yt-dlp ou no rápido: sem ferramentas do YouTube',
      ];
    },
  },
  {
    nome: 'youtube na tela: "![▶ título](augpt-img://…){yt:ID}" vira a miniatura clicável (sem carregar nada do YouTube); id inválido ou endereço de fora não vira vídeo',
    tipo: 'unidade',
    executar() {
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      global.window = antes;
      const ok = global.md.render('![▶ Review <b>do</b> Titan S](augpt-img://abcdefghijklmnopqrstuvwxyz.jpg){yt:rY-FTPEzDCk}');
      const idRuim = global.md.render('![▶ x](augpt-img://abcdefghijklmnopqrstuvwxyz.jpg){yt:"><script>}');
      const fora = global.md.render('![▶ x](https://i.ytimg.com/vi/rY-FTPEzDCk/hqdefault.jpg){yt:rY-FTPEzDCk}');
      return [
        /<figure class="md-video" data-yt="rY-FTPEzDCk"/.test(ok) && /src="augpt-img:\/\/abcdefghijklmnopqrstuvwxyz\.jpg"/.test(ok) && !/iframe|youtube/.test(ok) || `miniatura: ${ok}`,
        !/<b>/.test(ok) || 'título escapado',
        !/md-video/.test(idRuim) && !/<script>/.test(idRuim) || `id inválido: ${idRuim}`,
        !/md-video|<img/.test(fora) || `imagem de fora: ${fora}`,
      ];
    },
  },
  {
    nome: 'glossário (16/10): "reviews em vídeo" não vira "em V" + "ídeo" — o termo não pode estar colado em letra acentuada; a ocorrência certa mais adiante ainda é explicada',
    tipo: 'unidade',
    executar() {
      const { explicarTermos } = require('../../src/agent/glossario');
      const r = explicarTermos('Baseada nos reviews em vídeo, o som em V do fone agrada.');
      return [
        !/\)ídeo/.test(r) &&/reviews em vídeo/.test(r) || `"em vídeo" intacto: ${r}`,
        /som em V \(graves e agudos realçados/.test(r) || `"em V" de verdade explicado: ${r}`,
      ];
    },
  },
  {
    nome: 'tela (16/10): a lista de Fontes mantém o número escrito ("13. …" continua 13), para a citação [13] do texto bater com a fonte',
    tipo: 'unidade',
    executar() {
      const antes = global.window;
      global.window = global;
      delete require.cache[require.resolve('../../renderer/md.js')];
      require('../../renderer/md.js');
      global.window = antes;
      const html = global.md.render('13. [a](https://a.com)\n16. [b](https://b.com)');
      return [/<li value="13">.*<li value="16">/s.test(html) || `números: ${html}`];
    },
  },
];
