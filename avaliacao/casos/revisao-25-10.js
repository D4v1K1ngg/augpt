'use strict';

/**
 * Revisão de ponta a ponta (25/10): a faxina dos caches (mapa e fotos sem uso) e as travas novas
 * do processo principal (uma instância só, erros registrados, "mostrar na pasta" só do que o app salvou).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { faxina } = require('../../src/faxina');

const DIA = 24 * 3600 * 1000;

module.exports = [
  {
    nome: 'faxina: pedaço de mapa com mais de 30 dias sai; foto com mais de 90 dias sai só se nenhuma conversa nem execução usa; o resto fica',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-faxina-'));
      const criar = (rel, idadeDias, conteudo = 'x') => {
        const arq = path.join(dir, rel);
        fs.mkdirSync(path.dirname(arq), { recursive: true });
        fs.writeFileSync(arq, conteudo);
        const t = new Date(Date.now() - idadeDias * DIA);
        fs.utimesSync(arq, t, t);
        return arq;
      };
      const mapaVelho = criar('mapa/osm/5/1/2.png', 40);
      const mapaNovo = criar('mapa/osm/5/1/3.png', 3);
      const usadaNaConversa = criar('imagens/abcdefghijabcdefghijaa.jpg', 200);
      const usadaNaExecucao = criar('imagens/abcdefghijabcdefghijbb.jpg', 200);
      const semUsoVelha = criar('imagens/abcdefghijabcdefghijcc.jpg', 200);
      const semUsoNova = criar('imagens/abcdefghijabcdefghijdd.jpg', 10);
      const origens = criar('imagens/origens.json', 200, '{}');
      criar('conversas/c1.json', 1, JSON.stringify({ mensagens: [{ content: '![a](augpt-img://abcdefghijabcdefghijaa.jpg)' }] }));
      criar('execucoes/e1.json', 1, JSON.stringify({ resposta: '![b](augpt-img://abcdefghijabcdefghijbb.jpg)' }));
      const r = await faxina({ userData: dir });
      const existe = (a) => fs.existsSync(a);
      const resultado = [
        !existe(mapaVelho) && existe(mapaNovo) || 'mapa',
        existe(usadaNaConversa) && existe(usadaNaExecucao) || 'foto usada ficou',
        !existe(semUsoVelha) && existe(semUsoNova) || 'foto sem uso: só a velha sai',
        existe(origens) || 'origens.json não é foto',
        r.mapa === 1 && r.imagens === 1 && r.bytes > 0 || JSON.stringify(r),
      ];
      fs.rmSync(dir, { recursive: true, force: true });
      return resultado;
    },
  },
  {
    nome: 'processo principal: uma instância só (a segunda traz a janela para frente), erros sem tratamento vão para diagnostico/erros.log, e "mostrar na pasta" só abre o que o "Salvar como" gravou',
    tipo: 'unidade',
    executar() {
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      return [
        /requestSingleInstanceLock\(\)[\s\S]{0,200}app\.exit\(0\)/.test(main) && /app\.on\('second-instance'/.test(main) || 'instância única',
        /process\.on\('unhandledRejection'/.test(main) && /process\.on\('uncaughtException'/.test(main) && /erros\.log/.test(main) || 'erros registrados',
        /salvasPeloApp\.has\(caminho\)/.test(main) && /salvasPeloApp\.add\(r\.filePath\)/.test(main) || 'mostrar na pasta restrito',
      ];
    },
  },
  {
    nome: 'leitura em segundo plano: anúncio, rastreador, vídeo e fonte ficam de fora (só nela — o navegador do agente não usa); o conteúdo do site passa',
    tipo: 'unidade',
    executar() {
      const { bloqueavelNaLeitura: b } = require('../../electron/sessao-segura');
      const render = fs.readFileSync(path.join(__dirname, '../../electron/render.js'), 'utf8');
      const navegador = fs.readFileSync(path.join(__dirname, '../../electron/navegador.js'), 'utf8');
      return [
        ['https://tracookiepixel.xyz/log', 'https://www.googletagmanager.com/gtm.js', 'https://securepubads.g.doubleclick.net/x', 'https://static.hotjar.com/h.js', 'https://ads.exemplo.com/a.js'].every((u) => b(u, 'script')) || 'rastreadores',
        b('https://fonts.gstatic.com/a.woff2', 'font') && b('https://v.exemplo.com/v.mp4', 'media') || 'fonte e vídeo',
        !b('https://www.kabum.com.br/_next/static/app.js', 'script') && !b('https://www.tecmundo.com.br/api/artigo', 'xhr') && !b('https://loads.example.com/app.js', 'script') || 'conteúdo passa',
        /soLeitura: true/.test(render) && !/soLeitura/.test(navegador) || 'só na leitura',
      ];
    },
  },
  {
    nome: 'pesquisa: fonte fora do assunto não vai para a escrita (RTX 3060 / GeForce 30 numa pergunta da RTX 60; longe da melhor semelhança; sem palavra da pergunta), a melhor sempre fica e o redator ignora em silêncio',
    tipo: 'unidade',
    executar() {
      const { padraoDoProduto, semFontesForaDoAssunto, sistemaDoEscritor } = require('../../src/agent/nucleo');
      const { normalizar } = require('../../src/agent/nucleo/ranking');
      const re = padraoDoProduto('RTX 60');
      const it = (titulo, texto, semelhanca, palavras = 1) => ({ f: { titulo }, texto, semelhanca, palavras });
      const rtx = semFontesForaDoAssunto('quando a série RTX 60 será lançada?', [it('rumor', 'A RTX 6090 sai em 2027', 0.81), it('GeForce 30', 'RTX 3060 a 60 fps', 0.66), it('RTX 60 vs 50', 'vale esperar a RTX 60?', 0.6)]).map((x) => x.f.titulo);
      const nenhumaCita = semFontesForaDoAssunto('quando a série RTX 60 será lançada?', [it('GeForce 30', 'RTX 3060 a 60 fps', 0.66), it('Zen 3', 'AMD', 0.5)]);
      const bufferbloat = semFontesForaDoAssunto('o que é bufferbloat?', [it('Bufferbloat', 'latência', 0.68), it('São Paulo', 'cidade', 0.52, 0), it('Zen 3', 'cpu', 0.35, 0), it('Redes', 'atraso', 0.6, 2)]).map((x) => x.f.titulo);
      const semEmbed = semFontesForaDoAssunto('o que é bufferbloat?', [it('a', 'x', null), it('b', 'y', null)]);
      const md = fs.readFileSync(path.join(__dirname, '../../renderer/md.js'), 'utf8');
      return [
        ['rtx 60 series', 'rtx 6090', 'rtx60'].every((t) => re.test(normalizar(t))) && !['rtx 3060', '60 fps'].some((t) => re.test(normalizar(t))) || 'padrão do produto',
        String(padraoDoProduto('RTX 5080')) === '/\\b5080\\b/' && padraoDoProduto('PS5') === null || 'número longo basta; sem linha, sem regra',
        JSON.stringify(rtx) === '["rumor","RTX 60 vs 50"]' || `rtx: ${rtx}`,
        JSON.stringify(bufferbloat) === '["Bufferbloat","Redes"]' || `bufferbloat: ${bufferbloat}`,
        semEmbed.length === 2 || 'sem embeddings não corta',
        nenhumaCita.length === 0 || 'nenhuma cita o produto: nenhuma fonte',
        require('../../src/agent/nucleo/graficos').separarGraficos('```chart\n{"type":"line","title":"t","labels":["a","b"],"datasets":[{"label":"s","data":[1,1]}]}\n```').validos === 0 || 'gráfico não pedido com valores iguais',
        /ignore em silêncio/.test(sistemaDoEscritor({ hoje: 'x', comFontes: true })) || 'instrução do redator',
        /\(\?:\[\^\\s\(\)\]\|\\\(\[\^\\s\(\)\]\*\\\)\)\+/.test(md) || 'link com parênteses (Wikipédia) no chat',
      ];
    },
  },
  {
    nome: 'Ollama aberto para a rede: detectado pelo IP da casa (só com o Ollama deste PC) e avisado em Ajustes; ícone do app no instalador, nas janelas e nos avisos',
    tipo: 'unidade',
    async executar() {
      const { expostoNaRede } = require('../../src/ollama-remoto');
      const pedidos = [];
      const aberto = await expostoNaRede({ ips: ['192.168.0.9'], fetchImpl: async (u) => (pedidos.push(u), { ok: true, json: async () => ({ version: '0.12' }) }) });
      const fechado = await expostoNaRede({ ips: ['192.168.0.9'], fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
      const main = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
      const pkg = require('../../package.json');
      return [
        aberto.exposto && aberto.ip === '192.168.0.9' && pedidos[0] === 'http://192.168.0.9:11434/api/version' || JSON.stringify(aberto),
        !fechado.exposto || 'fechado',
        /ollama:exposicao[\s\S]{0,120}ehLocal\(config\.data\.host\)/.test(main) || 'só o Ollama deste PC',
        pkg.build.win.icon === 'build/icon.ico' && fs.existsSync(path.join(__dirname, '../../build/icon.ico')) && fs.existsSync(path.join(__dirname, '../../renderer/icone.png')) || 'arquivos do ícone',
        (main.match(/icon: ICONE/g) || []).length >= 3 || 'janelas e avisos com o ícone',
      ];
    },
  },
];
