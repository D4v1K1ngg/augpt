'use strict';

/**
 * Efeitos de escrita no chat (26/11, demonstração do Davi "laboratório de efeitos de escrita"): as 14 predefinições,
 * escolhidas em Ajustes → Aparência e guardadas no config; "Nenhum" é o padrão. O ponto principal: o efeito anima o que
 * chega do Ollama e NUNCA segura o texto (o agendamento acelera para não passar de ATRASO_MAX).
 */

const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\r/g, '');
const efeitos = require('../../renderer/efeitos-escrita.js');

module.exports = [
  {
    nome: 'efeitos de escrita: as 14 predefinições, na Aparência, no config ("nenhum" por padrão) e ligadas aos dois chats',
    tipo: 'unidade',
    executar() {
      const html = ler('renderer/index.html');
      const aparencia = html.slice(html.indexOf('id="ajAparencia"'), html.indexOf('<!-- ---------------- Celular e atalhos'));
      const css = ler('renderer/efeitos-escrita.css');
      const ids = efeitos.PREDEFINICOES.map((p) => p.id).join(',');
      const anims = [...new Set(efeitos.PREDEFINICOES.map((p) => p.anim))];
      return [
        ids === 'maquina,stream,palavra,nevoa,decodificar,ouro,cometa,onda,pulso,linhas,pincel,queda,pop,glitch' || ids,
        efeitos.PREDEFINICOES.every((p) => ['letra', 'token', 'palavra', 'bloco'].includes(p.unidade) && p.base > 0 && p.dur > 0) || 'unidade, ritmo e duração de cada uma',
        anims.every((a) => new RegExp(`\\[data-escrita="${a}"\\] \\.esc-[ub] \\{ animation-name: esc-`).test(css) || a === 'brush') || 'cada animação no CSS',
        /id="cfgEfeitoEscrita"/.test(aparencia) && /id="cfgVelocidadeEscrita"/.test(aparencia) && /id="escritaPrevia"/.test(aparencia) && /id="cfgEscritaSempre"/.test(aparencia) || 'efeito, velocidade, prévia e a opção do Windows na Aparência',
        /efeitoEscrita: 'nenhum',/.test(ler('src/config.js')) && /escritaComAnimacaoDesligada: false,/.test(ler('src/config.js')) || 'no config, "nenhum" por padrão',
        /window\.efeitosDeEscrita\?\.animar\(t\.resposta\)/.test(ler('renderer/app-eventos.js')) && /window\.efeitosDeEscrita\?\.animar\(t\.resposta, \{ fim: true \}\)/.test(ler('renderer/app-eventos.js')) || 'o chat do Agente (streaming e final)',
        /window\.efeitosDeEscrita\?\.animar\(chat\.alvo\)/.test(ler('renderer/app-abas.js')) || 'o chat da Conversa',
        html.indexOf('<script src="efeitos-escrita.js">') > html.indexOf('<script src="app-abas.js">') && /href="efeitos-escrita\.css"/.test(html) || 'o script e o CSS carregados',
        // reduzir animações do Windows: sem a opção, nada é marcado; os blocos especiais nunca são quebrados
        /if \(reduzido\?\.matches && !c\.escritaComAnimacaoDesligada\) return null;/.test(ler('renderer/efeitos-escrita.js')) || 'respeita "reduzir animações"',
        ((lista) => ['pre', 'code', 'a', 'sup', '.cita', '.grafico-lugar', '.cartao-lugar', '.caixa-lugar', '.md-figura', 'table'].every((s) => lista.includes(s)))(/const NAO_QUEBRAR = '([^']+)'/.exec(ler('renderer/efeitos-escrita.js'))[1].split(', ')) || 'não quebra código, links, citações, gráficos, cartões, fotos e tabelas',
      ];
    },
  },
  {
    nome: 'efeitos de escrita: o efeito não segura o texto — tudo que chegou aparece em até ATRASO_MAX, mesmo devagar e com texto longo',
    tipo: 'unidade',
    executar() {
      const { agendar, PREDEFINICOES, ATRASO_MAX } = efeitos;
      const falhas = [];
      const longo = 'Palavra comprida, com pontuação. '.repeat(60); // ~2.000 letras de uma vez (a resposta final sem streaming)
      for (const p of PREDEFINICOES) {
        for (const vel of [0.5, 1, 3]) {
          // pedaços pequenos a cada 30 ms, como o Ollama, e depois um bloco grande
          const chegada = [];
          let agora = 1000;
          for (let i = 0; i < 40; i++, agora += 30) {
            agendar(chegada, 'abc, ', agora, p, vel);
            if (chegada.at(-1) > agora + ATRASO_MAX + 0.001) falhas.push(`${p.id} ${vel}× pedaço ${i}: +${Math.round(chegada.at(-1) - agora)} ms`);
          }
          agendar(chegada, longo, agora, p, vel);
          if (chegada.at(-1) > agora + ATRASO_MAX + 0.001) falhas.push(`${p.id} ${vel}× texto longo: +${Math.round(chegada.at(-1) - agora)} ms`);
          if (chegada.length !== 40 * 5 + longo.length) falhas.push(`${p.id}: ${chegada.length} horários para ${40 * 5 + longo.length} letras`);
          if (chegada.some((t, i) => i && t < chegada[i - 1])) falhas.push(`${p.id}: fora de ordem`);
        }
      }
      // o ritmo do efeito vale quando o modelo é lento: máquina de escrever, 1×, uma letra a cada 24 ms
      const lenta = agendar([], 'ab', 0, PREDEFINICOES[0], 1);
      return [falhas.length === 0 || falhas.slice(0, 5).join(' | '), lenta[1] - lenta[0] === 24 || `ritmo ${lenta[1] - lenta[0]}`];
    },
  },
];
