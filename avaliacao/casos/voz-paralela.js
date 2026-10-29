'use strict';

/**
 * Etapa 2 do Jarvis (28/10): enquanto o modelo principal trabalha, um modelo leve na CPU conversa pela voz.
 * O código decide o que é dele (papo) e o que não é (andamento, dito pelo código; pesquisa e fatos, para a fila).
 */

const fs = require('fs');
const path = require('path');
const v = require('../../src/fala/voz-paralela');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

module.exports = [
  {
    nome: 'voz em paralelo: preço, clima, lembrete, "vê pra mim" e pergunta de fato vão para a fila; papo e andamento ficam; o andamento é dito pelo código, com o que a tela mostra',
    tipo: 'unidade',
    executar() {
      const fila = ['Depois vê pra mim quanto está o PS5 Slim', 'vai chover amanhã em Vitória?', 'me lembra amanhã às 9 de ligar pro dentista', 'quem ganhou o jogo do Flamengo?', 'E qual é a capital da Austrália?'];
      const papo = ['Me conta uma piada enquanto isso', 'que calor hoje, né?', 'Estou cansado, viu', 'O que você acha disso tudo?'];
      const andamento = v.respostaDeAndamento({ etapa: 'Pesquisando na internet\nbuscas: placas 1440p', resumo: '· 6 buscas · 108 resultados vistos · 3 páginas em 3 sites', segundos: 39 });
      return [
        ...fila.map((t) => v.precisaDoPrincipal(t) || `fila: ${t}`),
        ...papo.map((t) => !v.precisaDoPrincipal(t) || `papo: ${t}`),
        v.perguntaDeAndamento('E aí, como está indo?') && v.perguntaDeAndamento('Vai demorar muito?') && !v.precisaDoPrincipal('Vai demorar muito?') || 'andamento',
        // o jeito de dizer varia (28/10); o que é dito, não: a etapa, as contas da tela e o tempo
        /estou pesquisando na internet\. Até agora, 6 buscas, 3 páginas em 3 sites\. Já faz 39 segundos\.$/.test(andamento) || andamento,
        // 60 vezes: o nome sai em ~1/3 delas (com 8, falhava ~4% das vezes por azar)
        /Davi/.test(Array.from({ length: 60 }, () => v.respostaDeAndamento({ etapa: 'Lendo', usuario: 'Davi' })).join(' ')) || 'o nome às vezes',
        /Já faz 2 minutos\.$/.test(v.respostaDeAndamento({ segundos: 130 })) || 'minutos',
        JSON.stringify(v.lerRespostaParalela('[FILA] Pode **deixar**.')) === '{"fila":true,"resposta":"Pode deixar."}' || 'marcação [FILA]',
        /Nunca afirme fatos/.test(v.sistemaDaVozParalela({ objetivo: 'x' })) && /conte só o que está no andamento/.test(v.sistemaDaVozParalela({})) || 'regras do modelo leve',
      ];
    },
  },
  {
    nome: 'narrar a pesquisa: o núcleo avisa o que cada página trouxe; a frase pelo código sem o modelo leve; o modelo só reconta o trecho, varia o começo; a narração prepara a próxima enquanto fala, cala quando a resposta fala',
    tipo: 'unidade',
    executar() {
      const fala = ler('renderer/fala.js');
      const sistema = v.sistemaDaNarracao({ pedido: 'placas 1440p', primeira: false, anterior: 'Encontrei também no newegg' });
      return [
        /emit\('achado', \{ titulo: [^\n]+site: dominio\(f\.url\), trecho:/.test(ler('src/agent/nucleo/index.js')) || 'evento achado',
        /'fonte', 'achado'/.test(ler('electron/main.js')) || 'o evento chega na tela',
        [1, 2, 3, 4].every(() => /(achei "Melhores placas para 1440p", no canaltech\.|no canaltech: Melhores placas para 1440p\.)$/.test(v.narracaoPadrao({ titulo: 'Melhores placas para 1440p | Canaltech', site: 'www.canaltech.com.br' }))) || v.narracaoPadrao({ titulo: 'Melhores placas para 1440p | Canaltech', site: 'www.canaltech.com.br' }),
        [1, 2, 3, 4].every(() => /[nd]o reddit\.$/.test(v.narracaoPadrao({ site: 'reddit.com' }, false))) || v.narracaoPadrao({ site: 'reddit.com' }, false),
        /Não comece com "Encontrei também"/.test(sistema) && /Use só o que está no trecho/.test(sistema) && /Não conclua, não recomende/.test(sistema) || 'regras da narração',
        /narrarPesquisa: true/.test(ler('src/config.js')) && /id="cfgNarrarPesquisa"/.test(ler('renderer/index.html')) || 'padrão e Ajustes',
        /if \(deveFalar\(\) && config\.narrarPesquisa !== false\)/.test(fala) || 'só em pedido falado',
        /!agente\.rodando \|\| turnoDaFala\.falouAntes\) return pararNarracao\(\)/.test(fala) || 'cala quando a resposta fala',
        /narra\.fase === 'pesquisa' && !narra\.pronta && !narra\.gerando/.test(fala) && /if \(atual !== null \|\| Date\.now\(\) - narra\.ultima < NARRAR_A_CADA_MS\) return;/.test(fala) || 'prepara enquanto fala',
      ];
    },
  },
  {
    nome: 'pronúncia (28/10): versão com ponto ("3.1" → "três ponto um"), site sem ".com.br", sigla no plural (GPUs), letra no meio de modelo (B580, 24H2, 7800X3D) e as palavras de hardware',
    tipo: 'unidade',
    executar() {
      const f = require('../../src/fala/fonemas-pt-br');
      const ext = (t) => f.porExtenso(t);
      return [
        ext('ATX 3.1 e PCIe 5.0') === 'ATX três ponto um e PCIe cinco ponto zero' || ext('ATX 3.1 e PCIe 5.0'),
        ext('custa 5.299 reais') === 'custa cinco mil duzentos e noventa e nove reais' || 'milhar continua milhar',
        ext('Arc B580, Windows 24H2, Galaxy S25') === 'Arc bê quinhentos e oitenta, Windows vinte e quatro agá dois, Galaxy ésse vinte e cinco' || ext('Arc B580, Windows 24H2, Galaxy S25'),
        ext('Ryzen 7800X3D') === 'Ryzen setenta e oito cem xis três dê' || ext('Ryzen 7800X3D'),
        ext('conector 12V-2x6') === 'conector doze vê-dois xis seis' || ext('conector 12V-2x6'),
        f.textoEmFonemas('Achei no 4gamers.com.br um ranking de GPUs.').normalize('NFC') === 'aʃˈej nu kwˈatɾu ɡˈejmeɾs ũ xˈɐ̃kĩ ʤi ʒˈe pˈe ˈus.'.normalize('NFC') || f.textoEmFonemas('Achei no 4gamers.com.br um ranking de GPUs.'),
        f.textoEmFonemas('Abri o teclado.txt') === f.textoEmFonemas('Abri o teclado ponto TXT') || 'arquivo continua "ponto"',
        /xˈejʤiõ/.test(f.textoEmFonemas('Radeon').normalize('NFC')) && /fɾˈajdej/.test(f.textoEmFonemas('Black Friday').normalize('NFC')) && /kabˈũ/.test(f.textoEmFonemas('KaBuM!').normalize('NFC')) || 'palavras de hardware',
      ];
    },
  },
  {
    nome: 'voz em paralelo no app: só na CPU (num_gpu 0) e carregado por 1 h; o código responde andamento e fila antes do modelo; a escuta usa com o agente ocupado; Ajustes',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const escuta = ler('renderer/escuta.js');
      const fala = ler('renderer/fala.js');
      return [
        /numGpu: 0, manterVivo: '60m'/.test(main) || 'CPU e 1 h',
        /if \(perguntaDeAndamento\(texto\)\) return [^\n]+\n\s*if \(precisaDoPrincipal\(texto\)\) return \{ ok: true, fila: true, resposta: fraseDaFila\(primeiroNome\(\)\) \|\| FRASE_DA_FILA \};/.test(main) || 'o código antes do modelo',
        /ocupado && config\.modeloDaVoz && window\.falaPorVoz\?\.emParalelo/.test(escuta) || 'escuta',
        /if \(r\.fila\) await api\.fundo\.adicionar\(texto\)/.test(fala) || 'a fila de verdade',
        /modeloDaVoz: '',/.test(ler('src/config.js')) && /id="cfgModeloDaVoz"/.test(ler('renderer/index.html')) || 'padrão (nenhum) e Ajustes',
      ];
    },
  },
];
