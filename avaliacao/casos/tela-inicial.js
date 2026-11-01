'use strict';

/**
 * A tela inicial (1/11, a partir da maquete do Davi, nas cores e temas do AuGPT): o orbe "Au", o título com o nome,
 * os 4 atalhos e os modos; o fundo de ondas só na tela inicial, parado com o modelo trabalhando, e a opção em Ajustes.
 */

const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'tela inicial: o orbe, o título, os 4 atalhos (pesquisar, comprar, seus arquivos, dia a dia) e os modos de pesquisa; o carrossel saiu; o fundo de ondas atrás da tela do Agente',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const inicio = html.slice(html.indexOf('<div class="inicio" id="inicioAgente">'), html.indexOf('<!-- Fase 2 (facilidade de uso'));
      const atalhos = [...inicio.matchAll(/class="inicio-atalho" data-pedido="([^"]+)"[\s\S]*?<b>([^<]+)<\/b>/g)].map((m) => m[2]);
      return [
        atalhos.join(',') === 'Pesquisar,Comprar e comparar,Seus arquivos,Dia a dia' || atalhos.join(','),
        /class="inicio-nucleo"><span>Au<\/span>/.test(inicio) && /<animateMotion/.test(inicio) || 'o orbe',
        /id="modoDoAgente"/.test(inicio) && /data-modo="investigacao"/.test(inicio) && /class="deck-foot inicio-modos"/.test(inicio) || 'os modos continuam (e somem no modo simples)',
        !fs.existsSync(path.join(__dirname, '../../renderer/abertura-deck.js')) && !/abertura-deck\.js|id="deckAbertura"/.test(html) && /<script src="inicio\.js"><\/script>/.test(html) || 'o carrossel saiu',
        /<section class="conversa" id="viewAgente">\n\s*<canvas class="ondas-inicio" id="ondasInicio"/.test(html) || 'o fundo de ondas',
        /document\.querySelector\('#inicioAgente h1'\)/.test(ler('renderer/app-ajustes.js')) || '"O que você precisa, Davi?" no título novo',
      ];
    },
  },
  {
    nome: 'tela inicial: as ondas só desenham com a tela inicial à vista e o app em primeiro plano; param com o modelo trabalhando; "Seguir o Windows" respeita os efeitos de animação desligados; a cor vem do tema',
    tipo: 'unidade',
    executar() {
      const js = ler('renderer/inicio.js');
      return [
        /const visivel = \(\) => !el\.aAbertura\.hidden && !document\.getElementById\('viewAgente'\)\.hidden && !document\.hidden;/.test(js) || 'só à vista',
        /const parado = \(\) => semAnimacao\(\) \|\| \(typeof agente !== 'undefined' && agente\.rodando\);/.test(js) || 'para com o modelo',
        /return modo === 'parado' \|\| \(modo === 'auto' && Boolean\(reduzido\?\.matches\)\);/.test(js) && /ondasInicio: 'auto'/.test(ler('src/config.js')) || 'a opção, seguindo o Windows por padrão',
        /getPropertyValue\('--gold'\)/.test(js) && /attributeFilter: \['data-theme'\]/.test(js) || 'a cor do tema',
        /<select id="cfgOndasInicio"><option value="auto">Seguir o Windows<\/option><option value="animado">Animado<\/option><option value="parado">Parado<\/option><\/select>/.test(ler('renderer/index.html')) || 'Ajustes → Geral',
      ];
    },
  },
];
