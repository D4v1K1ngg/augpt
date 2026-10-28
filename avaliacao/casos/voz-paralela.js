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
        andamento === 'Ainda estou nisso: pesquisando na internet. Até agora, 6 buscas, 3 páginas em 3 sites. Já faz 39 segundos.' || andamento,
        /Já faz 2 minutos\.$/.test(v.respostaDeAndamento({ segundos: 130 })) || 'minutos',
        JSON.stringify(v.lerRespostaParalela('[FILA] Pode **deixar**.')) === '{"fila":true,"resposta":"Pode deixar."}' || 'marcação [FILA]',
        /Nunca afirme fatos/.test(v.sistemaDaVozParalela({ objetivo: 'x' })) && /conte só o que está no andamento/.test(v.sistemaDaVozParalela({})) || 'regras do modelo leve',
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
        /if \(perguntaDeAndamento\(texto\)\) return [^\n]+\n\s*if \(precisaDoPrincipal\(texto\)\) return \{ ok: true, fila: true, resposta: FRASE_DA_FILA \};/.test(main) || 'o código antes do modelo',
        /ocupado && config\.modeloDaVoz && window\.falaPorVoz\?\.emParalelo/.test(escuta) || 'escuta',
        /if \(r\.fila\) await api\.fundo\.adicionar\(texto\)/.test(fala) || 'a fila de verdade',
        /modeloDaVoz: '',/.test(ler('src/config.js')) && /id="cfgModeloDaVoz"/.test(ler('renderer/index.html')) || 'padrão (nenhum) e Ajustes',
      ];
    },
  },
];
