'use strict';

/**
 * Tema "Vidro líquido" (26/11, protótipo do Davi): um tema a mais em Ajustes → Aparência, sem mexer no padrão.
 * Confere o registro (o seletor, o CSS e o script carregados), que a escolha fica gravada antes de pintar, que tudo
 * do CSS vale só com data-estilo="vidro" e que o fundo WebGL para sozinho (foco, modelo, "reduzir animações").
 */

const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');

module.exports = [
  {
    nome: 'tema Vidro líquido: registrado na aba Aparência, gravado, escopado e com o fundo que para sozinho',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const aparencia = html.slice(html.indexOf('id="ajAparencia"'), html.indexOf('<!-- ---------------- Celular e atalhos'));
      const css = ler('renderer/tema-vidro.css');
      const js = ler('renderer/tema-vidro.js');
      const tema = ler('renderer/tema.js');
      // cada regra do CSS (fora o canvas do fundo) só vale com o tema escolhido
      const seletores = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
      const soltos = seletores.filter((s) => !s.startsWith('html[data-estilo="vidro"]') && !s.startsWith('#vidroFundo'));
      return [
        /<select id="cfgEstilo"><option value="padrao">Padrão \(café\)<\/option><option value="vidro">Vidro líquido<\/option><\/select>/.test(aparencia) || 'o seletor de tema na Aparência',
        /<select id="cfgVidroAnimacao"><option value="auto">Seguir o Windows<\/option><option value="animado">Animado<\/option><option value="parado">Parado<\/option><\/select>/.test(aparencia) || 'a opção de desligar só a animação',
        html.indexOf('href="tema-vidro.css"') > html.indexOf('href="tema-lume.css"') || 'o CSS depois do tema-lume',
        html.indexOf('<script src="tema-vidro.js">') > html.indexOf('<script src="inicio.js">') || 'o script depois do inicio.js',
        /localStorage\.getItem\('augpt:estilo'\) === 'vidro'/.test(tema) || 'a escolha lida antes de pintar (tema.js)',
        /gravar\(ESTILO, selEstilo\.value\)/.test(js) && /gravar\(ANIMACAO, selAnimacao\.value\)/.test(js) || 'a escolha gravada',
        soltos.length === 0 || `regras fora do tema: ${soltos.join(' | ')}`,
        /html\[data-estilo="vidro"\]\[data-theme="light"\]/.test(css) || 'a versão Dia',
        /backdrop-filter: blur\(16px\) saturate\(175%\)/.test(css) || 'os painéis de vidro',
        /document\.hidden \|\| !document\.hasFocus\(\) \|\| \(typeof agente !== 'undefined' && agente\.rodando\)/.test(js) || 'para fora de foco e com o modelo trabalhando',
        /prefers-reduced-motion: reduce/.test(js) && /modo\(\) === 'auto' && !reduzido\?\.matches/.test(js) || '"Seguir o Windows" respeita reduzir animações',
        !/https?:\/\//.test(css + js) || 'nada carregado de fora',
      ];
    },
  },
];
