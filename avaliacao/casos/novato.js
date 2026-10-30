'use strict';

/**
 * O AuGPT pelos olhos de um novato (30/10): modo simples, voz oferecida na boas-vindas, a pesquisa andando na
 * tela, a barra do topo em português comum e o aviso de cautela em direito, saúde e dinheiro.
 */

const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

module.exports = [
  {
    nome: 'novato — modo simples: instalação nova começa no simples, quem já usava começa com tudo à vista; Ajustes só com o essencial, Automático e Conversar, menu enxuto; "Mostrar todos os ajustes" traz tudo',
    tipo: 'unidade',
    executar() {
      const config = ler('src/config.js');
      const simples = ler('renderer/modo-simples.js');
      const html = ler('renderer/index.html');
      const css = ler('renderer/tema.css');
      return [
        /modoAvancado: false,/.test(config) || 'padrão: simples',
        /if \(salvo\.modoAvancado === undefined && salvo\.boasVindasConcluida === true\) this\.data\.modoAvancado = true;/.test(config) || 'quem já usava vê tudo',
        /id="cfgModoAvancado"/.test(html) && /<script src="modo-simples\.js"><\/script>/.test(html) || 'chave e script',
        /const MODOS_SIMPLES = new Set\(\['automatico', 'conversa'\]\);/.test(simples) || 'dois modos',
        ['navConversa', 'navSkills', 'navUtilitarios', 'navExecucoes'].every((id) => simples.includes(`'${id}'`)) || 'menu enxuto',
        ['ajPesquisa', 'ajMemoria', 'ajTarefas', 'ajComponentes', 'ajAvancado'].every((id) => simples.includes(`'${id}'`)) || 'abas avançadas',
        /body\.modo-simples \.fora-do-simples,/.test(css) && /body\.modo-simples #modoDoAgente/.test(css) || 'CSS',
        /window\.modoSimples\?\.aplicar\(\);/.test(ler('renderer/app-ajustes.js')) || 'aplica quando a config chega',
      ];
    },
  },
  {
    nome: 'novato — a voz oferecida na boas-vindas: um botão instala o reconhecimento de fala, a escuta do nome e a voz, e liga o "Ei Jarvis"; o tamanho total; o nome que a escuta usa',
    tipo: 'unidade',
    executar() {
      const bv = ler('renderer/boas-vindas.js');
      return [
        /titulo: t\('Falar com o AuGPT'\)/.test(bv) && bv.indexOf("t('Falar com o AuGPT')") < bv.indexOf("t('Busca na web (SearXNG embutido)')") || 'o primeiro dos opcionais',
        /await api\.ditado\.instalar\(\)[\s\S]{0,300}await api\.ditado\.instalarEscuta\([\s\S]{0,300}await api\.voz\.instalar\(\)[\s\S]{0,200}api\.config\.set\(\{ ouvirChamada: true \}\)/.test(bv) || 'as três instalações e a escuta ligada',
        /window\.escutaPorVoz\?\.nome\?\.\(\)/.test(bv) || 'o nome da escuta',
        /\(megas \/ 1024\)\.toFixed\(1\)/.test(bv) || 'tamanho total',
        /\[bv\.voz, bv\.ditado\] = await Promise\.all/.test(bv) || 'confere o que já está instalado',
      ];
    },
  },
  {
    nome: 'novato — a pesquisa andando na tela: no modo simples, frases ("Pesquisando: …", "Lendo CanalTech: …", "Escrevendo a resposta…") no lugar de "passo 1 de 6", "executando buscar_na_web" e dos medidores',
    tipo: 'unidade',
    executar() {
      const simples = ler('renderer/modo-simples.js');
      const css = ler('renderer/tema.css');
      return [
        /\/\^\(passo\|step\) \\d\+ \(de\|of\) \\d\+\$\/i\.test\(t\)\) return undefined;/.test(simples) || 'sem "passo N de M"',
        /buscar_na_web: 'Pesquisando na internet…'/.test(simples) && /\(\?:executando\|running\) \(\[a-z_\]\+\)/.test(simples) || 'ferramenta vira frase',
        ["embrulhar('fonte'", "embrulhar('achado'", "embrulhar('redigindo'", "embrulhar('nucleo-entendimento'"].every((x) => simples.includes(x)) || 'as frases de cada momento',
        /body\.modo-simples \.turno-medidores,/.test(css) && /body\.modo-simples \.atividade > details\.detalhe/.test(css) || 'medidores e raciocínio fora da vista',
      ];
    },
  },
  {
    nome: 'novato — a barra do topo em português comum no modo simples ("IA no seu computador · pesquisa quando precisa"); no avançado, o nome do modelo como antes',
    tipo: 'unidade',
    executar() {
      const h = ler('renderer/app-historico.js');
      return [
        /const simples = document\.body\.classList\.contains\('modo-simples'\);/.test(h) || 'olha o modo',
        /tr\('IA no seu computador'\)/.test(h) && /tr\('pesquisa quando precisa'\)/.test(h) && /tr\('A IA está desligada — clique para ver'\)/.test(h) || 'as frases',
        /: desligado \? tr\('Ollama desligado · \{resto\}'/.test(h) || 'avançado como antes',
        /body\.modo-simples \.deck-foot,/.test(ler('renderer/tema.css')) || 'sem o "Pesquisa" solto',
      ];
    },
  },
  {
    nome: 'novato — aviso de cautela: saúde, direito e dinheiro, só quando a pergunta é sobre a situação da pessoa (não conceito, não questão de prova); link de redirecionamento do Google não vira fonte',
    tipo: 'unidade',
    executar() {
      const nucleo = require('../../src/agent/nucleo');
      const aviso = (p) => nucleo.avisoDeCautela(p);
      const { normalizar } = require('../../src/tools/search');
      return [
        /saúde/.test(aviso('Posso tomar dipirona com ibuprofeno?')) && /saúde/.test(aviso('Minha mãe toma remédio para pressão alta, pode tomar café?')) || 'saúde',
        /direito/.test(aviso('Fui demitido por justa causa, tenho direito a quê?')) || 'direito',
        /dinheiro/.test(aviso('Vale a pena investir no tesouro direto?')) || 'dinheiro',
        !aviso('O que é o contrato social de uma empresa?') && !aviso('Quanto tempo uma calopsita vive?') && !aviso('Questão 1: segundo a Lei 8.906/94, posso?\nA) Sim\nB) Não') || 'sem aviso à toa',
        /const cautela = avisoDeCautela\(pergunta, deps\.idioma\);/.test(ler('src/agent/nucleo/index.js')) || 'no fim da resposta',
        normalizar([{ url: 'https://www.google.com/goto?url=CAESbQ', titulo: 'x' }, { url: 'https://farmacerto.com/a', titulo: 'y' }], 'searxng').map((r) => r.url).join() === 'https://farmacerto.com/a' || 'sem redirecionamento do Google',
      ];
    },
  },
];
