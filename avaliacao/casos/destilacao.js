'use strict';

const { materialOriginal, limparRuido } = require('../../src/agent/destilador');

/** Página realista: conteúdo útil afogado em navegação e rodapé. */
const PAGINA = `
Menu principal Home Esportes Economia Assine Newsletter Cookies
Leia também: as 10 melhores dicas · Publicidade · Compartilhe nas redes
${'Banner de assinatura com oferta imperdível para novos leitores do portal. '.repeat(12)}
Previsão para Vitória-ES: sexta 14/08 máxima de 32°C, mínima de 21°C, 30% de chuva.
Sábado 15/08: máxima de 26°C, mínima de 21°C, 90% de chuva, 7,2 mm.
Índice de churrasco: tempo instável. Índice de frizz: umidade moderada.
${'Rodapé institucional com endereço, telefone e política de privacidade do portal. '.repeat(12)}
`;

module.exports = [
  {
    nome: 'destilação troca ruído por fatos e preserva o bruto',
    pedido: 'Qual a previsão do tempo para Vitória nesta semana?',
    arquivos: { 'pagina.txt': PAGINA },
    config: { destilarFatos: true, destilarAcimaDe: 500 },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'pagina.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'previsão por dia' } },
    ],
    redacao: 'Sexta: 32°C/21°C com 30% de chuva. Sábado: 26°C/21°C com 90% de chuva.',
    espera: {
      ok: true,
      destilou: true,
      // o redator agora também recebe um trecho do texto ORIGINAL (não só os
      // fatos destilados — ver materialOriginal em destilador.js), mas isso
      // passa por uma limpeza das categorias de ruído óbvias (menu, banner,
      // rodapé, política de privacidade): essas continuam fora do prompt.
      // "umidade moderada" (índice de frizz, um widget do portal, não a
      // previsão em si) não é lixo de marketing — sobrevive à limpeza leve e
      // pode chegar ao redator agora; o foco pedido ("previsão por dia")
      // orienta o redator a não usá-lo na resposta.
      promptRedacaoNaoContem: ['Banner de assinatura', 'política de privacidade'],
      respostaContem: ['32°C'],
    },
  },

  {
    nome: 'material curto não é destilado à toa',
    pedido: 'O que diz a nota?',
    arquivos: { 'nota.txt': 'Valor de R$ 1.240,00 pago em 12/08/2026.' },
    config: { destilarFatos: true, destilarAcimaDe: 1500 },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'A nota registra R$ 1.240,00 pagos em 12/08/2026.',
    espera: { ok: true, destilou: false, promptRedacaoContem: ['1.240,00'] },
  },

  {
    nome: 'destilação desligada mantém o material inteiro',
    pedido: 'Qual a previsão?',
    arquivos: { 'pagina.txt': PAGINA },
    config: { destilarFatos: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'pagina.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'previsão' } },
    ],
    redacao: 'Sexta: 32°C com 30% de chuva.',
    espera: { ok: true, destilou: false, promptRedacaoContem: ['umidade moderada'] },
  },
];

module.exports.push(
  {
    nome: 'limparRuido descarta categorias de lixo de portal, preserva o resto',
    tipo: 'unidade',
    executar() {
      const limpo = limparRuido(PAGINA);
      return [
        !limpo.includes('Banner de assinatura') || 'não removeu o banner',
        !limpo.includes('Rodapé institucional') || 'não removeu o rodapé',
        !limpo.includes('Newsletter') || 'não removeu o convite de newsletter',
        limpo.includes('32°C') || 'removeu dado legítimo (previsão) junto com o lixo',
        limpo.includes('umidade moderada') || 'removeu conteúdo real que não é lixo de marketing',
      ];
    },
  },

  {
    nome: 'materialOriginal reparte o orçamento entre fontes destiladas e ignora as não destiladas',
    tipo: 'unidade',
    executar() {
      const dossie = [
        { origem: 'fonte A', destilado: true, bruto: 'A'.repeat(2000), texto: '- fato a' },
        { origem: 'fonte B', destilado: true, bruto: 'B'.repeat(2000), texto: '- fato b' },
        { origem: 'fonte C', destilado: false, bruto: 'C'.repeat(2000), texto: 'C'.repeat(2000) },
      ];
      // orçamento generoso o bastante para não bater no piso de 800/fonte
      const material = materialOriginal(dossie, 3000);

      return [
        material.includes('[trecho original de fonte A]') || 'não incluiu a fonte A',
        material.includes('[trecho original de fonte B]') || 'não incluiu a fonte B',
        !material.includes('[trecho original de fonte C]') || 'incluiu fonte não destilada (já vai inteira via soltos)',
        // 2 fontes: ~1500 caracteres cada (orçamento ÷ fontes) + cabeçalhos curtos
        material.length < 3300 || `orçamento não foi respeitado (${material.length} caracteres)`,
        materialOriginal([]) === '' || 'dossiê vazio deveria devolver string vazia',
      ];
    },
  }
);
