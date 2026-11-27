'use strict';

/**
 * 19/11 (Davi: "dá uma olhada nos chats de hoje e me diga o que você acha" — a mesma prova em 6 modelos e um óleo da
 * Shopee): o link de loja que não abre, a instrução do formato de produto vazando, o anúncio como fato, as citações
 * "[1, 2, 15]" e os especialistas por tipo de pedido.
 */

const fs = require('fs');
const path = require('path');
const nucleo = require('../../src/agent/nucleo');
const { escolherEspecialista, TAREFAS } = require('../../src/agent/especialistas');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'link de loja que não abre: sai das fontes, o código busca pelos números do anúncio e lê o mesmo anúncio; o escritor é avisado e nunca deduz pelo número',
    tipo: 'unidade',
    executar() {
      const n = ler('src/agent/nucleo/index.js');
      return [
        nucleo.buscaPeloLink('https://shopee.com.br/product/1282348597/23594313976?d_id=1') === 'shopee "1282348597.23594313976"' || 'Shopee product/',
        nucleo.buscaPeloLink('https://shopee.com.br/Oleo-i.352111474.22198255259') === 'shopee "352111474.22198255259"' || 'Shopee -i.',
        nucleo.buscaPeloLink('https://produto.mercadolivre.com.br/MLB-1812616280-placa') === 'mercado livre MLB1812616280' && nucleo.buscaPeloLink('https://www.amazon.com.br/x/dp/B0F5X9P8WC') === 'amazon B0F5X9P8WC' || 'Mercado Livre e Amazon',
        /fontes\.splice\(fontes\.indexOf\(f\), 1\);/.test(n) && /fontes\.linkNaoAbriu = url;/.test(n) || 'o link não lido sai das fontes',
        /const mesmo = numeros\.length \?/.test(n) && /await executarLeitura\(\{ fonte: mesmo\.n, foco: pergunta \}/.test(n) || 'o código lê o mesmo anúncio',
        /Nunca deduza o que é o produto pelo número ou pelo endereço do link/.test(n) && /sem exemplos inventados/.test(n) || 'o aviso ao escritor',
      ];
    },
  },
  {
    nome: '"para que serve" não é recomendação; a instrução do formato de produto não vaza (também "#### 1." entre aspas); anúncio de loja vai marcado; "[1, 2, 15]" vira "[1][2][15]"',
    tipo: 'unidade',
    executar() {
      const vazou = 'Como não consigo confirmar o modelo, não posso aplicar o formato rígido de recomendação de hardware ("#### 1. Se você puder me dizer o nome, eu pesquiso.\n\n#### 1. Logitech G Pro\nBom mouse.';
      const limpo = nucleo.conferirResposta(vazou, { numeros: [], material: 'Logitech G Pro' }).texto;
      const bloco = nucleo.blocoDeFontes([{ n: 1, url: 'https://shopee.com.br/x', titulo: 'Óleo', conteudo: 'c' }, { n: 2, url: 'https://pt.wikipedia.org/x', titulo: 'W', conteudo: 'c' }]);
      const n = ler('src/agent/nucleo/index.js');
      return [
        nucleo.pedeRecomendacao('para que serve esse produto óleo ozonizado?', []) === false && nucleo.pedeRecomendacao('o que é esse produto?', []) === false && nucleo.pedeRecomendacao('qual o melhor mouse para cs2?', []) === true || 'para que serve',
        !/formato rígido/.test(limpo) && /^#### 1\. Logitech G Pro$/m.test(limpo) && /Se você puder me dizer o nome/.test(limpo) || limpo,
        /site="shopee\.com\.br" anuncio="sim"/.test(bloco) && /site="pt\.wikipedia\.org">/.test(bloco) || bloco,
        /\$\{usadas\.some\(\(f\) => ehLoja\(f\.url\)\) \? REGRA_DE_ANUNCIO : ''\}/.test(n) && /é o VENDEDOR dizendo/.test(n) || 'a regra do anúncio para o escritor',
        /\.split\(\/\(```\[\\s\\S\]\*\?```\|`\[\^`\\n\]\*`\)\/\)/.test(n) && /parte\.replace\(\/\\\[\(\\d\{1,2\}/.test(n) || 'citações em lista, fora do código',
      ];
    },
  },
  {
    nome: 'especialistas: prova e imagem anexada com o seu modelo (Ajustes); vazio = o do topo; modelo que não está instalado segue com o do topo e avisa; a prova com "Pergunta N" ganha o limite de escrita de várias questões',
    tipo: 'unidade',
    async executar() {
      const config = { especialistas: { prova: 'qwen3.8:27b', imagem: 'nao-existe:1b' } };
      const listar = async () => ['qwen3.8:27b', 'qwen3.5:9b-q8_0'];
      const PROVA = 'Pergunta 1\nQual?\na. x\nb. y';
      const p = await escolherEspecialista({ objetivo: PROVA, config, listar });
      const i = await escolherEspecialista({ objetivo: 'o que é isso?', imagens: [{}], config, listar });
      const nada = await escolherEspecialista({ objetivo: PROVA, config: { especialistas: { prova: '' } }, listar });
      const comum = await escolherEspecialista({ objetivo: 'qual o melhor fone?', config, listar });
      const loop = ler('src/agent/loop-nucleo.js');
      return [
        p?.modelo === 'qwen3.8:27b' && p.tarefa === 'prova' || JSON.stringify(p),
        i?.faltando === 'nao-existe:1b' && !i.modelo || JSON.stringify(i),
        nada === null && comum === null || 'vazio e pedido comum: o do topo',
        TAREFAS.map((t) => t.id).join() === 'prova,imagem,peca3d' || 'as tarefas', // peca3d: 27/11 (avaliacao/casos/pecas-3d.js)
        /const modelo = especialista\?\.modelo \|\| cfg\.model;/.test(loop) && /model: especialista\?\.modelo \|\| cfg\.modelRedacao \|\| modelo/.test(loop) || 'o especialista pesquisa e escreve',
        /especialistas: \{ prova: \$\('cfgEspProva'\)\.value, imagem: \$\('cfgEspImagem'\)\.value \}/.test(ler('renderer/app-ajustes.js')) && /id="cfgEspProva"/.test(ler('renderer/index.html')) || 'a opção em Ajustes',
        /quest\(\?:ão\|ao\)\|pergunta\|exerc\[ií\]cio/.test(loop) || '"Pergunta N" conta para o limite da escrita',
      ];
    },
  },
];
