'use strict';

const path = require('path');
const { buscarVarias, qualidadeDoDominio } = require('./search');
const { PROFUNDIDADES } = require('./web');
const { ler } = require('./extract');
const { conferirDestino } = require('./rede');
const { HistoricoDePrecos } = require('../compras/historico');
const {
  extrairPrecos,
  detectarParcelamento,
  normalizarProduto,
  mesmoProduto,
  precoEfetivo,
  formatar,
} = require('../compras/normalizar');

/**
 * Ferramentas de compras.
 *
 * Construídas sobre o que já existe — cadeia de busca, leitura de página,
 * cache, controle de domínio — em vez de uma camada de raspagem dedicada.
 * Grandes lojas bloqueiam raspagem, e uma engine que finge funcionar produz
 * preço errado, que é pior que preço nenhum.
 *
 * Onde a leitura direta falha, o caminho honesto é o navegador interativo: a
 * página abre na tela do usuário e o preço lido é o que ele está vendo.
 */

const LOJAS_CONHECIDAS = {
  'mercadolivre.com.br': 'Mercado Livre',
  'amazon.com.br': 'Amazon',
  'magazineluiza.com.br': 'Magazine Luiza',
  'americanas.com.br': 'Americanas',
  'casasbahia.com.br': 'Casas Bahia',
  'kabum.com.br': 'KaBuM!',
  'terabyteshop.com.br': 'Terabyte',
  'pichau.com.br': 'Pichau',
  'shoptime.com.br': 'Shoptime',
  'submarino.com.br': 'Submarino',
  'carrefour.com.br': 'Carrefour',
  'fastshop.com.br': 'Fast Shop',
  'aliexpress.com': 'AliExpress',
};

const lojaDe = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [dominio, nome] of Object.entries(LOJAS_CONHECIDAS)) {
      if (host === dominio || host.endsWith(`.${dominio}`)) return nome;
    }
    return host;
  } catch {
    return 'desconhecida';
  }
};

const historicoDe = (ctx) => new HistoricoDePrecos(path.join(ctx.sandbox.root, '.augpt'));

/** Sites que aparecem em busca de preço mas não vendem nada. */
const NAO_VENDE = /wikipedia|wikimedia|gov\.br|\.edu|reddit|forum|blogspot|quora|youtube|facebook|instagram|duckduckgo|google\./i;

/** Comparadores: úteis, mas o preço é de terceiro e pode estar velho. */
const COMPARADOR = /(zoom|buscape|bondfaro|shopping\.uol|jacotei|melhorcompra|achapromo|promobit|pelando)\./i;

/**
 * Ranqueamento para COMPRAS.
 *
 * A ordenação normal existe para pesquisa factual: coloca órgão oficial e
 * enciclopédia na frente. Em busca de preço isso é exatamente ao contrário —
 * a Wikipédia não vende placa de vídeo. Aqui quem vende vem primeiro.
 */
function ordenarLojas(resultados) {
  return resultados
    .map((r, posicao) => {
      let nota = -posicao * 0.3;
      const url = String(r.url);
      const conhecida = Object.keys(LOJAS_CONHECIDAS).some((d) => url.includes(d));

      if (conhecida) nota += 12;
      else if (COMPARADOR.test(url)) nota += 4;
      else if (NAO_VENDE.test(url)) nota -= 20;
      else nota += 2; // loja pequena que não está na lista

      // sinal de página de produto, não de categoria
      if (/\/(p|produto|product|dp|item|mlb)[-/]/i.test(url)) nota += 3;
      if (/\/(busca|search|categoria|c\/)/i.test(url)) nota -= 3;

      // domínio marcado como não confiável continua descendo
      const q = qualidadeDoDominio(url);
      if (q.alerta) nota -= 10;

      return { ...r, notaLoja: nota, conhecida };
    })
    .sort((a, b) => b.notaLoja - a.notaLoja);
}

module.exports = [
  {
    name: 'buscar_produtos',
    risk: 'baixo',
    description:
      'Procura um produto em lojas e devolve os preços encontrados, com a loja, o link, a data da consulta e o quanto cada preço é confiável. Use para comparar preço, não para pesquisar sobre o produto.',
    args: {
      consulta: 'o produto, o mais específico possível: "RTX 5070 12GB" e não "placa de vídeo"',
      lojas: 'opcional: lista de lojas para restringir, ex.: "kabum, pichau"',
      quantidade: 'quantas ofertas devolver',
    },
    obrigatorios: ['consulta'],
    async run({ consulta, lojas, quantidade }, ctx) {
      if (!consulta) throw new Error('Informe "consulta" com o nome do produto.');

      // Marcado ANTES de qualquer return antecipado (inclusive o caminho
      // "nenhum preço confirmado" logo abaixo, que hoje é o mais comum contra
      // loja grande — ela bloqueia leitura automática). `ctx.estado.ofertas`
      // só existe quando esta ferramenta CONSEGUE ler um preço sozinha; esta
      // flag existe pra sinalizar "estamos numa comparação de preço" mesmo
      // quando ela falha e o agente segue comparando via `navegar` manual —
      // ver mensagemDeAcaoRepetida em loop.js, que sem isso não teria como
      // saber que está no meio de uma comparação de preço.
      ctx.estado.tentandoComprar = consulta;

      // A profundidade escolhida pelo usuário vale aqui também. Antes esta
      // ferramenta tinha um teto próprio de 8 e ignorava o seletor — por isso
      // uma busca em modo alto voltava com uma loja só.
      const regra = PROFUNDIDADES[ctx.config?.profundidadePesquisa] || PROFUNDIDADES.normal;
      const alvo = Math.max(regra.minimo, Math.min(Number(quantidade) || regra.maximo, regra.maximo));

      const restricao = String(lojas || '')
        .split(/[;,]/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean);

      // Consulta genérica devolve comparador e blog. Perguntar loja a loja é o
      // que traz página de produto com preço de verdade.
      const consultas = [`${consulta} preço`, `comprar ${consulta}`];
      if (restricao.length) {
        consultas.push(...restricao.map((l) => `${consulta} ${l}`));
      } else {
        const principais = ctx.config?.lojasPreferidas?.length
          ? ctx.config.lojasPreferidas
          : ['kabum', 'mercado livre', 'terabyte', 'pichau', 'amazon.com.br', 'magazine luiza'];
        consultas.push(...principais.slice(0, regra.minimo).map((l) => `${consulta} ${l}`));
      }

      const { resultados, provedor, falhas } = await buscarVarias(consultas, {
        searxngUrl: ctx.config.searxngUrl,
        marginaliaKey: ctx.config.marginaliaKey,
      });
      if (!resultados.length) {
        throw new Error(`Nenhum provedor de busca respondeu. Detalhes — ${falhas.join(' | ')}`);
      }
      ctx.emit('fonte', { tipo: 'busca', provedor, falhas });

      const candidatos = ordenarLojas(resultados)
        .filter((r) => !restricao.length || restricao.some((l) => r.url.toLowerCase().includes(l)))
        .filter((r) => !NAO_VENDE.test(r.url))
        .slice(0, alvo + 8);

      const ofertas = [];
      const capturadoEm = new Date().toISOString();
      const historico = historicoDe(ctx);

      const lojasVistas = new Set();
      for (const candidato of candidatos) {
        if (ofertas.length >= alvo) break;
        const loja = lojaDe(candidato.url);
        if (lojasVistas.has(loja)) continue;
        try {
          const pagina = await ler(candidato.url, {
            render: ctx.render,
            // mesma regra de web.js/lerComCache (Fase 1 de segurança): leitor
            // externo só com opt-in explícito, e endereço interno barrado
            permitirExterno: ctx.config.permitirLeitorExterno === true,
            estrategia: ctx.operacional?.estrategiaDeSite(candidato.url) || null,
            conferir: (destino) => conferirDestino(destino, ctx.config),
          });

          const encontrados = extrairPrecos(pagina.texto, { limite: 2 });
          if (!encontrados.length) continue;
          lojasVistas.add(loja);

          const parcelado = detectarParcelamento(pagina.texto);
          for (const achado of encontrados.slice(0, 1)) {
            const { total, freteConhecido } = precoEfetivo({ preco: achado.preco, frete: null, desconto: null });
            const oferta = {
              loja: lojaDe(candidato.url),
              titulo: achado.titulo || pagina.titulo || candidato.titulo,
              preco: achado.preco,
              frete: null,
              freteConhecido,
              precoTotal: total,
              url: candidato.url,
              disponibilidade: achado.disponibilidade,
              parcelado,
              confianca: achado.confianca,
              motivo: achado.motivo,
              capturadoEm,
            };
            ofertas.push(oferta);
            historico.registrar({
              produto: consulta,
              loja: oferta.loja,
              preco: oferta.preco,
              total: oferta.precoTotal,
              url: oferta.url,
              confianca: oferta.confianca,
            });
          }
          ctx.emit('fonte', { tipo: 'leitura', provedor: pagina.via, url: candidato.url });
        } catch {
          /* página inacessível: segue para a próxima */
        }
      }

      if (!ofertas.length) {
        return (
          `Nenhum preço confirmado para "${consulta}".\n\n` +
          'As páginas encontradas não entregaram preço legível — grandes lojas costumam exigir JavaScript ou ' +
          'bloquear leitura automática. Para estas, use `navegar` e leia o preço na página aberta, ' +
          'ou peça ao usuário o link direto do produto.'
        );
      }

      // agrupa o que parece ser o mesmo produto, sem afirmar identidade sem base
      const grupos = [];
      for (const oferta of ofertas) {
        const normalizado = normalizarProduto(oferta.titulo);
        const grupo = grupos.find((g) => mesmoProduto(g.normalizado, normalizado));
        if (grupo) grupo.ofertas.push(oferta);
        else grupos.push({ normalizado, ofertas: [oferta] });
      }

      ofertas.sort((a, b) => a.precoTotal - b.precoTotal);
      const barato = ofertas[0];
      ctx.estado.ofertas = ofertas;

      const lojasComPreco = new Set(ofertas.map((o) => o.loja));
      const linhas = [
        `Consulta: "${consulta}" · ${ofertas.length} oferta(s) em ${lojasComPreco.size} loja(s) ` +
          `· profundidade ${ctx.config?.profundidadePesquisa || 'normal'} (alvo: ${regra.minimo}–${regra.maximo})`,
        lojasComPreco.size < regra.minimo
          ? `[apenas ${lojasComPreco.size} de ${regra.minimo} lojas mínimas entregaram preço legível — as demais exigem JavaScript ou bloquearam a leitura]`
          : '',
        `Consultado em ${new Date(capturadoEm).toLocaleString('pt-BR')}`,
        '',
        '| Loja | Produto | Preço | Confiança |',
        '| --- | --- | ---: | --- |',
        ...ofertas.map(
          (o) =>
            `| ${o.loja} | ${o.titulo.slice(0, 60)} | ${formatar(o.precoTotal)} | ${o.confianca} |`
        ),
        '',
        `MENOR PREÇO ENTRE AS FONTES CONSULTADAS: ${formatar(barato.precoTotal)} na ${barato.loja} (${barato.confianca} confiança)`,
        `${barato.url}`,
        '',
        'AVISOS OBRIGATÓRIOS PARA A RESPOSTA:',
        '- Diga que este é o menor preço ENTRE AS FONTES CONSULTADAS, nunca "o melhor da internet".',
        '- Informe a data e a hora da consulta: preço muda a qualquer momento.',
        '- Frete não foi apurado; o total pode subir. Diga isso.',
        ofertas.some((o) => o.confianca !== 'alta')
          ? '- Há preços de confiança média ou baixa na lista. Marque quais e recomende confirmar na loja.'
          : '',
        grupos.length > 1
          ? `- As ofertas podem ser de ${grupos.length} produtos diferentes (variações de modelo ou capacidade). Não some nem compare cegamente.`
          : '',
      ];

      return linhas.filter(Boolean).join('\n');
    },
  },

  {
    name: 'historico_precos',
    risk: 'baixo',
    description:
      'Mostra a evolução dos preços já observados para um produto nas consultas anteriores, com mínimo, máximo e tendência. Também avalia se um "de X por Y" bate com o histórico.',
    args: {
      consulta: 'o produto',
      preco_de: 'opcional: o preço "de" anunciado, para conferir o desconto',
      preco_por: 'opcional: o preço "por" anunciado',
    },
    obrigatorios: ['consulta'],
    async run({ consulta, preco_de: precoDe, preco_por: precoPor }, ctx) {
      const historico = historicoDe(ctx);
      const serie = historico.serie(consulta);

      if (!serie) {
        return (
          `Ainda não há histórico para "${consulta}".\n` +
          'O histórico é construído pelas suas próprias consultas: use buscar_produtos algumas vezes ' +
          'ao longo dos dias e a tendência aparece.'
        );
      }

      const partes = [
        `Histórico de "${serie.produto}"`,
        `${serie.observacoes} observação(ões) em ${serie.dias.length} dia(s), ${serie.lojas.length} loja(s)`,
        '',
        `Mínimo observado: ${formatar(serie.minimo)}`,
        `Máximo observado: ${formatar(serie.maximo)}`,
        `Último: ${formatar(serie.atual)}`,
      ];

      if (serie.dias.length >= 2) {
        const variacao = ((serie.atual - serie.valores[0]) / serie.valores[0]) * 100;
        partes.push(
          `Variação no período: ${variacao > 0 ? '+' : ''}${variacao.toFixed(1).replace('.', ',')}%`
        );

        // o gráfico vira bloco na resposta, pelo mesmo caminho de gerar_grafico
        ctx.estado.graficos = ctx.estado.graficos || [];
        ctx.estado.graficos.push(
          `\`\`\`chart\n${JSON.stringify(
            {
              type: 'line',
              title: `Preço de ${serie.produto.slice(0, 50)}`,
              labels: serie.dias.map((d) => d.slice(5).split('-').reverse().join('/')),
              datasets: [{ label: 'menor preço do dia', data: serie.valores }],
            },
            null,
            1
          )}\n\`\`\``
        );
        partes.push('', 'Um gráfico da evolução foi anexado à resposta.');
      }

      if (precoDe && precoPor) {
        const avaliacao = historico.avaliarDesconto(consulta, { precoDe, precoPor });
        partes.push('');
        if (!avaliacao) {
          partes.push('Histórico insuficiente para avaliar o desconto — são necessárias ao menos 3 observações.');
        } else {
          partes.push(
            avaliacao.suspeito ? 'DESCONTO SUSPEITO' : 'Desconto compatível com o histórico',
            avaliacao.motivo,
            `(base: ${avaliacao.observacoes} observações desde ${avaliacao.desde})`
          );
        }
      }

      return partes.join('\n');
    },
  },
];

module.exports.lojaDe = lojaDe;
module.exports.LOJAS_CONHECIDAS = LOJAS_CONHECIDAS;
