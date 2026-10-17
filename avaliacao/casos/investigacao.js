'use strict';

/**
 * Investigação com tempo (17/10): o código comanda o tempo e a ordem —
 * plano, uma seção por subtema, lacunas se sobrar tempo, resumo e relatório.
 * Modelo, busca e relógio são dublês (o relógio anda 1 min por busca).
 */

const { investigar, lerPlano } = require('../../src/agent/nucleo/investigacao');

function montar({ subtemas = 3, lacunas = [], minutosPorBusca = 1, abortarNaParte = 0 } = {}) {
  let agora = 0;
  const controle = new AbortController();
  const chamadas = { plano: 0, lacunas: 0, secoes: [], resumo: null };
  let partes = 0;
  const deps = {
    signal: controle.signal,
    chamar: async (messages, opcoes = {}) => {
      const c = messages[0].content;
      if (/"precisa_buscar"/.test(c)) return { content: JSON.stringify({ precisa_buscar: true, produto: false, assuntos: ['Segunda Guerra'], pergunta: 'como foi a Segunda Guerra Mundial?' }) };
      if (/Você vai planejar uma investigação/.test(c)) {
        chamadas.plano += 1;
        return { content: JSON.stringify({ titulo: 'Segunda Guerra Mundial', subtemas: Array.from({ length: subtemas }, (_, i) => ({ titulo: `Parte ${i + 1}`, pergunta: `Segunda Guerra parte ${i + 1}` })) }) };
      }
      if (/Ainda há tempo/.test(c)) {
        chamadas.lacunas += 1;
        return { content: JSON.stringify({ subtemas: lacunas }) };
      }
      if (opcoes.tools) return { content: '', chamadas: [{ function: { name: 'buscar_na_web', arguments: { buscas: [`Segunda Guerra ${messages[1].content.slice(-12)}`] } } }, { function: { name: 'pronto', arguments: {} } }] };
      return { content: '' };
    },
    escrever: async (messages) => {
      const sistema = messages[0].content;
      if (/RESUMO de uma investigação/.test(sistema)) {
        chamadas.resumo = sistema;
        return 'A guerra durou de 1939 a 1945 [1]. Ver também [2].';
      }
      chamadas.secoes.push(messages[1].content);
      partes += 1;
      if (abortarNaParte && partes === abortarNaParte) controle.abort();
      return '## título que o modelo não devia pôr\nTexto da seção, com o dado de 1939 [1].';
    },
    // a página "comum" aparece em todas as partes: tem de virar UMA fonte no índice
    buscar: async (q) => {
      agora += minutosPorBusca * 60000;
      return [
        { titulo: 'Página comum sobre a Segunda Guerra 1939 1945', url: 'https://comum.com/guerra', resumo: 'A Segunda Guerra foi de 1939 a 1945.' },
        { titulo: `Página da ${q}`, url: `https://site.com/${encodeURIComponent(q)}`, resumo: `Sobre ${q}, 1939.` },
      ];
    },
    lerPagina: async (url) => ({ texto: `Conteúdo de ${url}: a Segunda Guerra começou em 1939 e terminou em 1945. `.repeat(10) }),
    emit: () => {},
  };
  return { deps, chamadas, relogio: () => agora };
}

module.exports = [
  {
    nome: 'investigação: plano em subtemas, uma seção por subtema com fontes num índice único (a mesma página em várias partes é uma fonte só), resumo para o chat e relatório com seções e fontes',
    tipo: 'unidade',
    async executar() {
      const m = montar({ subtemas: 3 });
      const r = await investigar({ pergunta: 'como foi a segunda guerra mundial?', minutos: 60, deps: m.deps, hoje: '17/10/2026', agora: m.relogio });
      const comum = r.relatorio.markdown.match(/https:\/\/comum\.com\/guerra/g) || [];
      return [
        r.secoes.join('|').startsWith('Parte 1|Parte 2|Parte 3') || `seções: ${r.secoes}`,
        comum.length === 1 || `página comum uma vez só nas fontes: ${comum.length}`,
        /^# Segunda Guerra Mundial/.test(r.relatorio.markdown) && /## Resumo/.test(r.relatorio.markdown) && /## 1\. Parte 1/.test(r.relatorio.markdown) && /## Fontes/.test(r.relatorio.markdown) || 'relatório com título, resumo, seções e fontes',
        !/título que o modelo não devia pôr/.test(r.relatorio.markdown) || 'o título que o modelo escreveu na seção sai',
        /1939 a 1945 \[1\]/.test(r.texto) && /Parte 1/.test(m.chamadas.resumo) || 'resumo para o chat a partir das seções',
        r.modo === 'investigacao' && r.fontes.every((f) => f.n && f.url) || 'fontes numeradas',
      ];
    },
  },
  {
    nome: 'investigação: o tempo manda — não começa parte que não dá tempo de terminar (guardando a reserva do relatório); com tempo sobrando depois da lista, busca as lacunas; cancelada no meio, entrega o que já tem',
    tipo: 'unidade',
    async executar() {
      // 10 min, cada parte gasta ~1 min de busca (fora as leituras do relógio falso): cabem só algumas das 12
      const curta = montar({ subtemas: 12, minutosPorBusca: 1.5 });
      const r1 = await investigar({ pergunta: 'como foi a segunda guerra mundial?', minutos: 10, deps: curta.deps, hoje: 'x', agora: curta.relogio });
      // 60 min com 2 partes: sobra tempo, pede lacunas
      const longa = montar({ subtemas: 2, lacunas: [{ titulo: 'Lacuna A', pergunta: 'Segunda Guerra lacuna A' }] });
      const r2 = await investigar({ pergunta: 'como foi a segunda guerra mundial?', minutos: 60, deps: longa.deps, hoje: 'x', agora: longa.relogio });
      // cancelada na 2ª parte
      const cancelada = montar({ subtemas: 5, abortarNaParte: 2 });
      const r3 = await investigar({ pergunta: 'como foi a segunda guerra mundial?', minutos: 60, deps: cancelada.deps, hoje: 'x', agora: cancelada.relogio });
      return [
        r1.secoes.length >= 2 && r1.secoes.length < 12 && curta.relogio() <= 10 * 60000 || `10 min: ${r1.secoes.length} partes, relógio ${curta.relogio() / 60000} min`,
        longa.chamadas.lacunas >= 1 && r2.secoes.includes('Lacuna A') || `lacunas: ${longa.chamadas.lacunas} / ${r2.secoes}`,
        r3.interrompida && r3.secoes.length === 2 && /interrompida antes do fim/.test(r3.relatorio.markdown) || `cancelada: ${r3.secoes.length} partes`,
      ];
    },
  },
  {
    nome: 'investigação: plano ilegível ou vazio não quebra (vira uma parte só, com a pergunta); subtema sem pergunta sai',
    tipo: 'unidade',
    executar() {
      const ok = lerPlano('{"titulo":"T","subtemas":[{"titulo":"A","pergunta":"pergunta A completa"},{"titulo":"B"},{"titulo":"","pergunta":"x"}]}', 'p');
      const ruim = lerPlano('não sei', 'p');
      return [
        ok.titulo === 'T' && ok.subtemas.map((s) => s.titulo).join() === 'A' || `plano: ${JSON.stringify(ok)}`,
        ruim.subtemas.length === 0 || 'ilegível: vazio (o investigar usa a pergunta)',
      ];
    },
  },
];
