'use strict';

/**
 * "O que tem na minha tela?" (25/10): Ctrl+Alt+A, o botão ao lado do + e "Ei GPT, o que é isso na
 * tela?". A captura vira anexo do Agente (o mesmo caminho do +); a janela de recorte é isolada e só
 * ela responde; o atalho se solta ao fechar o app e pode ser desligado.
 */

const fs = require('fs');
const path = require('path');
const ler = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

module.exports = [
  {
    nome: 'tela: a janela de recorte é isolada (sandbox, sem Node, sem navegar) e só ela entrega a área; área pequena demais não vale; a foto é cortada na escala da tela',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const html = ler('renderer/recorte.html');
      return [
        /preload: path\.join\(__dirname, 'recorte-preload\.js'\), contextIsolation: true, sandbox: true, nodeIntegration: false/.test(main) || 'janela isolada',
        /'recorte:imagem', \(e\) => \(e\.sender === janela\.webContents/.test(main) && /'recorte:escolha', \(e, r\) => \{\s*if \(e\.sender !== janela\.webContents\) return;/.test(main) || 'só a janela de recorte responde',
        /r\.width >= 8 && r\.height >= 8/.test(main) || 'área mínima',
        /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)[\s\S]{0,120}will-navigate/.test(main) || 'sem abrir nem navegar',
        /imagem\.getSize\(\)\.width \/ foto\.display\.bounds\.width/.test(main) || 'corte na escala',
        /default-src 'none'; img-src data:; style-src 'self'; script-src 'self'/.test(html) || 'CSP do recorte',
      ];
    },
  },
  {
    nome: 'tela: Ctrl+Alt+A ligado por padrão e desligável em Ajustes; solto ao fechar; a captura vai para a pasta de trabalho como anexo e chega à tela pelo evento tela-capturada',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const cfg = ler('src/config.js');
      const preload = ler('electron/preload.js');
      return [
        /atalhoDaTela: true/.test(cfg) || 'padrão ligado',
        /config\.data\.atalhoDaTela === false\) return false/.test(main) && /'atalhoDaTela' in patch\) estadoDoAtalho = aplicarAtalhoDaTela\(\)/.test(main) || 'desligável',
        /app\.on\('will-quit', \(\) => require\('electron'\)\.globalShortcut\.unregisterAll\(\)\)/.test(main) || 'solto ao fechar',
        /new Sandbox\(config\.data\.workspace\)[\s\S]{0,400}captura-\$\{/.test(main) && /enviar\('tela-capturada'/.test(main) || 'anexo na pasta de trabalho',
        /'tela-capturada',/.test(main) || 'evento liberado',
        /tela: \{\s*capturar:/.test(preload) || 'API da tela',
      ];
    },
  },
  {
    nome: 'tela pela voz: "o que é isso na tela?", "o que tem na minha tela", "what is on my screen?" capturam; "o que é a tela azul?" e "troca a tela do celular" não',
    tipo: 'unidade',
    executar() {
      const fonte = ler('renderer/tela.js');
      const re = new RegExp(fonte.match(/const SOBRE_A_TELA = \/(.+)\/i;/)[1], 'i');
      const escuta = ler('renderer/escuta.js');
      return [
        ['o que é isso na tela?', 'o que tem na minha tela', 'what is on my screen?', 'traduz o que está nesta tela'].every((t) => re.test(t)) || 'capturam',
        !['o que é a tela azul?', 'troca a tela do celular', 'qual a melhor tela para jogos'].some((t) => re.test(t)) || 'não capturam',
        /telaPorVoz\?\.falaDaTela\(texto\)[\s\S]{0,120}capturarEPerguntar\(texto\)/.test(escuta) || 'a escuta usa',
      ];
    },
  },
];
