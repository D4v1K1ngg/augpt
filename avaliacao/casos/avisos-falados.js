'use strict';

/**
 * Avisos falados (27/10, fase 2 da conversa estilo Jarvis): lembretes, tarefas e novidades ditos em voz
 * alta — fora do horário de silêncio, sem tela cheia, sem "não incomodar" e sem outro programa no microfone.
 */

const fs = require('fs');
const path = require('path');
const { interpretar, emSilencio } = require('../../src/pc-ocupado');

const ler = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const as = (h, m) => new Date(2026, 9, 27, h, m);

module.exports = [
  {
    nome: 'avisos falados: o estado do Windows decide (só o 5 fala); microfone de outro programa segura, o do próprio AuGPT não; o silêncio passa da meia-noite',
    tipo: 'unidade',
    executar() {
      const discord = interpretar('estado=5\nmic=C:#Users#x#AppData#Local#Discord#app-1.0#Discord.exe\n');
      return [
        interpretar('estado=5\n').livre === true || 'livre',
        interpretar('estado=3\n').motivo === 'um jogo em tela cheia' || JSON.stringify(interpretar('estado=3')),
        interpretar('estado=6').livre === false || 'não incomodar',
        (discord.livre === false && /Discord\.exe/.test(discord.motivo)) || JSON.stringify(discord),
        interpretar('estado=5\nmic=C:#Projetos#augpt#node_modules#electron#dist#electron.exe\nmic=C:#Users#x#AppData#Local#Programs#AuGPT#AuGPT.exe').livre === true || 'o próprio AuGPT',
        interpretar('').livre === true || 'sem resposta: livre',
        emSilencio(as(23, 0), '22:00', '07:00') && emSilencio(as(6, 59), '22:00', '07:00') || 'noite',
        !emSilencio(as(7, 0), '22:00', '07:00') && !emSilencio(as(15, 0), '22:00', '07:00') || 'dia',
        emSilencio(as(13, 30), '13:00', '14:00') && !emSilencio(as(14, 0), '13:00', '14:00') || 'no mesmo dia',
        !emSilencio(as(23, 0), '', '07:00') && !emSilencio(as(23, 0), '25:00', '07:00') || 'vazio ou inválido: sem silêncio',
      ];
    },
  },
  {
    nome: 'avisos falados no app: lembrete, preço, novidade, data e tarefa também falam; a voz confere silêncio e PC livre antes; não fala por cima de outra fala; Ajustes',
    tipo: 'unidade',
    executar() {
      const main = ler('electron/main.js');
      const fala = ler('renderer/fala.js');
      const html = ler('renderer/index.html');
      return [
        (main.match(/falarAviso\(`/g) || []).length >= 4 || 'lembrete, preço, novidade e data',
        /falarAviso\(item\.estado === 'pronta' \? `Prontinho\$\{virgulaNome\(\)\}! Terminei a tarefa/.test(main) || 'tarefa',
        /if \(emSilencio\(new Date\(\), c\.silencioDe, c\.silencioAte\)\) return;\s*const pc = await estadoDoPc\(\);\s*if \(!pc\.livre\) return;/.test(main) || 'silêncio e PC livre',
        /c\.avisosFalados === false \|\| idiomaEfetivo\(\) === 'en' \|\| !voz\?\.instalada\(\)/.test(main) || 'ligado, português e voz instalada',
        /manipuladores\['aviso-falado'\][\s\S]{0,200}atual !== null \|\| agente\.rodando\) return;/.test(fala) || 'não fala por cima',
        /avisosFalados: true,\s*silencioDe: '22:00',\s*silencioAte: '07:00',/.test(ler('src/config.js')) || 'padrões',
        /id="cfgAvisosFalados"/.test(html) && /id="cfgSilencioDe"/.test(html) && /id="cfgSilencioAte"/.test(html) || 'Ajustes',
      ];
    },
  },
];
