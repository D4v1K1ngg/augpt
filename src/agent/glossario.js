'use strict';

/**
 * Glossário dos termos técnicos das respostas de produto (14/10). O 7B não
 * explica termo nem com instrução nem com exemplo (medido: 0 explicações em
 * 10 cartões), e o Davi pediu que a resposta "explique os termos". Definição
 * de termo é conhecimento estável — fica no código, igual em toda resposta, e
 * entra entre parênteses na PRIMEIRA vez que o termo aparece no texto.
 * ponytail: lista fixa por categoria; termo novo entra aqui (ou vira skill de
 * categoria, se a lista crescer demais).
 */

const TERMOS = [
  // áudio
  { termo: /\bpalco sonoro\b/i, explica: 'a sensação de espaço e de onde vem cada som' },
  { termo: /\bimaging\b/i, explica: 'a precisão para localizar cada som no espaço' },
  { termo: /\bassinatura sonora\b/i, explica: 'o "tempero" do som: quanto de grave, médio e agudo ele realça' },
  { termo: /\bdriver dinâmico\b/i, explica: 'o alto-falante tradicional, com cone que se move' },
  { termo: /\barmaduras? balanceadas?\b/i, explica: 'alto-falante minúsculo, bom em detalhe e agudo' },
  { termo: /\bdrivers? planar(es)?\b|\bmagn[ée]tico planar\b/i, explica: 'membrana fina movida por ímãs, conhecida pelo detalhe e grave limpo' },
  { termo: /\bimped[âa]ncia\b/i, explica: 'a resistência elétrica do fone; alta pede um amplificador' },
  { termo: /\bsensibilidade\b(?= [^.]*\bdB\b|\s*de \d)/i, explica: 'quanto volume o fone entrega com a mesma potência' },
  { termo: /\b(ANC|cancelamento (ativo )?de ru[ií]do)\b/, explica: 'microfones que "apagam" o barulho de fora' },
  { termo: /\bIEMs?\b/, explica: 'fone intra-auricular, que entra no canal do ouvido' },
  { termo: /\bV-shape\b|\bem V\b/i, explica: 'graves e agudos realçados, médios mais recuados' },
  { termo: /\bDAC\b/, explica: 'o conversor que transforma o sinal digital em som' },
  // mouse e teclado
  { termo: /\bDPI\b|\bCPI\b/, explica: 'pontos por polegada: quanto maior, mais o cursor anda com o mesmo movimento' },
  { termo: /\bpolling rate\b|\btaxa de (polling|resposta do sensor)\b/i, explica: 'quantas vezes por segundo o mouse informa a posição ao PC' },
  { termo: /\bswitch(es)? (ó|o)ptic[oa]s?\b/i, explica: 'botão que registra o clique por luz, sem contato metálico, e dura mais' },
  { termo: /\bskates?\b|\bpés de PTFE\b/i, explica: 'os pés deslizantes embaixo do mouse' },
  { termo: /\blift[- ]off\b|\bLOD\b/, explica: 'a altura em que o sensor para de ler quando você levanta o mouse' },
  { termo: /\bhot[- ]?swap\b/i, explica: 'trocar as teclas mecânicas sem solda', so: ['teclado'] },
  { termo: /\bTKL\b/, explica: 'teclado sem o bloco numérico' },
  { termo: /\bswitch(es)? mec[âa]nic[oa]s?\b/i, explica: { teclado: 'a peça sob cada tecla que define o toque e o som', mouse: 'o botão de clique com contato metálico: clique firme, mas que pode gastar e dar clique duplo', outro: 'a peça sob cada tecla ou botão que define o toque e o som' } },
  // monitor e TV
  { termo: /\bpainel IPS\b|\bIPS\b(?= )/, explica: 'tipo de tela com cores fiéis e bom ângulo de visão' },
  { termo: /\bpainel VA\b/, explica: 'tipo de tela com preto mais profundo, mas cor menos fiel de lado' },
  { termo: /\bOLED\b/, explica: 'tela em que cada ponto acende sozinho: preto absoluto' },
  { termo: /\btaxa de atualiza[çc][ãa]o\b/i, explica: 'quantas imagens por segundo a tela mostra; mais Hz, movimento mais suave', so: ['tela'] },
  { termo: /\btempo de resposta\b/i, explica: 'quanto o ponto da tela demora para mudar de cor; menor, menos rastro', so: ['tela'] },
  { termo: /\bHDR\b/, explica: 'imagem com mais contraste entre partes claras e escuras' },
  { termo: /\bnits\b/i, explica: 'medida de brilho da tela' },
  // eletrodomésticos
  { termo: /\bfrost free\b/i, explica: 'sistema que não deixa formar gelo, sem precisar descongelar' },
  { termo: /\binverter\b/i, explica: 'motor que muda de velocidade em vez de liga-desliga, gastando menos energia' },
  { termo: /\bkWh\b/, explica: 'quilowatt-hora, a unidade da conta de luz' },
  { termo: /\bselo Procel\b|\bProcel\b/, explica: 'selo de eficiência energética do Inmetro; A é o mais econômico' },
];

/**
 * Do que o texto trata: o aparelho que ele mais cita (16/10: numa resposta de
 * mouse, "switch mecânico" saía explicado como peça de teclado e "taxa de
 * atualização" — a do mouse — como a da tela).
 */
const APARELHOS = {
  mouse: /\bmouses?\b/gi,
  teclado: /\bteclados?\b/gi,
  tela: /\b(monitor(es)?|telas?|tvs?|televis(ão|ores))\b/gi,
  fone: /\b(fones?|iems?|headsets?|earbuds?)\b/gi,
};
function assuntoDoTexto(texto) {
  const contagem = Object.entries(APARELHOS).map(([nome, re]) => [nome, (String(texto).match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  return contagem[0][1] ? contagem[0][0] : 'outro';
}

/**
 * Explica, entre parênteses, a 1ª ocorrência de cada termo do glossário no
 * texto — fora de título, tabela, citação e link, e só se o termo já não vier
 * explicado (parêntese logo depois).
 */
function explicarTermos(texto) {
  const vistos = new Set();
  const assunto = assuntoDoTexto(texto);
  return String(texto || '')
    .split('\n')
    .map((linha) => {
      if (/^\s*(#|\||>|!\[)/.test(linha)) return linha;
      let saida = linha;
      for (const [i, t] of TERMOS.entries()) {
        if (vistos.has(i) || (t.so && !t.so.includes(assunto))) continue;
        const explica = typeof t.explica === 'string' ? t.explica : t.explica[assunto] || t.explica.outro;
        // não mexe dentro de link markdown
        const semLinks = saida.replace(/\[[^\]]*\]\([^)]*\)/g, (x) => ' '.repeat(x.length));
        // o \b do JavaScript não conhece letra acentuada: "em v" + "ídeo" passava como "em V" (16/10)
        const colada = (c) => /[\p{L}\d]/u.test(c || '');
        const m = [...semLinks.matchAll(new RegExp(t.termo.source, `${t.termo.flags.replace('g', '')}g`))].find((x) => !colada(semLinks[x.index - 1]) && !colada(semLinks[x.index + x[0].length]));
        if (!m) continue;
        vistos.add(i);
        const fim = m.index + m[0].length;
        if (/^\s*\(/.test(saida.slice(fim))) continue; // já explicado pelo modelo
        saida = `${saida.slice(0, fim)} (${explica})${saida.slice(fim)}`;
      }
      return saida;
    })
    .join('\n');
}

module.exports = { explicarTermos, assuntoDoTexto, TERMOS };
