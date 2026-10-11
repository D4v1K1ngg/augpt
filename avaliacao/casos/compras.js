'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const tools = require('../../src/tools');
const { Sandbox } = require('../../src/tools/sandbox');
const { HistoricoDePrecos } = require('../../src/compras/historico');
const {
  paraNumero, extrairPrecos, detectarParcelamento, normalizarProduto, mesmoProduto,
} = require('../../src/compras/normalizar');

module.exports = [
  {
    nome: 'compras: preço em pt-BR e ruído descartado',
    tipo: 'unidade',
    executar() {
      const casos = [
        ['R$ 3.899,90', 3899.9],
        ['1.240,50', 1240.5],
        ['R$ 89', 89],
        ['3899.90', 3899.9],
        ['R$ 0,50', null], // abaixo do piso: é frete ou centavo solto
        ['CEP 01310-100', null],
      ];
      const problemas = casos
        .map(([entrada, esperado]) => {
          const r = paraNumero(entrada);
          return r === esperado || `"${entrada}" virou ${r}, esperava ${esperado}`;
        })
        .filter((r) => r !== true);

      const parcela = detectarParcelamento('12x de R$ 324,99 sem juros');
      return [
        ...problemas,
        parcela?.total === 3899.88 || `parcelamento calculou ${parcela?.total}`,
        true,
      ];
    },
  },

  {
    nome: 'compras: origem do preço define a confiança',
    tipo: 'unidade',
    executar() {
      const comEstruturado = extrairPrecos(
        '[Produto: Teclado K70 · preço BRL 199.90 · InStock]\n\nTexto da página com R$ 250,00 em outro lugar.'
      );
      const soTexto = extrairPrecos('Placa de vídeo RTX 5070\nPor R$ 3.899,90 à vista');

      return [
        // dado publicado pela própria loja vale mais que número achado no texto
        comEstruturado[0]?.confianca === 'alta' || `JSON-LD deu confiança ${comEstruturado[0]?.confianca}`,
        comEstruturado[0]?.preco === 199.9 || 'não pegou o preço estruturado',
        comEstruturado[0]?.disponibilidade === 'disponível' || 'perdeu a disponibilidade',
        comEstruturado.length === 1 || 'misturou o preço solto do texto com o estruturado',
        soTexto[0]?.confianca === 'media' || `texto puro deu confiança ${soTexto[0]?.confianca}`,
        soTexto[0]?.preco === 3899.9 || `leu ${soTexto[0]?.preco}`,
      ];
    },
  },

  {
    nome: 'compras: só agrupa produtos com sinal forte',
    tipo: 'unidade',
    executar() {
      const a = normalizarProduto('Placa de Vídeo RTX 5070 12GB - frete grátis');
      const b = normalizarProduto('RTX 5070 12GB Placa de Vídeo em promoção');
      const c = normalizarProduto('Placa de Vídeo RTX 5070 Ti 16GB');
      const d = normalizarProduto('Teclado mecânico K70');

      return [
        a.capacidade === '12GB' || `capacidade lida: ${a.capacidade}`,
        mesmoProduto(a, b) || 'não agrupou o mesmo produto escrito de outro jeito',
        !mesmoProduto(a, d) || 'agrupou produtos sem relação',
        // capacidade diferente é produto diferente, mesmo com modelo parecido
        !mesmoProduto(a, c) || 'agrupou 12GB com 16GB',
      ];
    },
  },

  {
    nome: 'compras: histórico registra, agrega por dia e avalia desconto',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-precos-${Date.now()}`);
      const h = new HistoricoDePrecos(dir);

      h.registrar({ produto: 'RTX 5070 12GB', loja: 'KaBuM!', preco: 3899.9, total: 3899.9, confianca: 'alta' });
      h.registrar({ produto: 'RTX 5070 12GB', loja: 'Pichau', preco: 3799.0, total: 3799.0, confianca: 'alta' });
      // mesma loja no mesmo dia atualiza, não duplica
      h.registrar({ produto: 'RTX 5070 12GB', loja: 'KaBuM!', preco: 3850.0, total: 3850.0, confianca: 'alta' });

      const serie = h.serie('RTX 5070 12GB');
      const persistido = new HistoricoDePrecos(dir).serie('rtx 5070 12gb');
      const semBase = h.avaliarDesconto('RTX 5070 12GB', { precoDe: 5999, precoPor: 3799 });

      h.registrar({ produto: 'RTX 5070 12GB', loja: 'Terabyte', preco: 3820, total: 3820, confianca: 'media' });
      const comBase = h.avaliarDesconto('RTX 5070 12GB', { precoDe: 5999, precoPor: 3799 });
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        // três registros, mas o terceiro atualiza o primeiro: duas observações
        serie.observacoes === 2 || `guardou ${serie.observacoes} observações; a repetida deveria atualizar`,
        serie.valores.length === 1 || 'não agregou por dia',
        // a série usa o MENOR do dia: é o que interessa a quem compara
        serie.valores[0] === 3799 || `o dia ficou com ${serie.valores[0]} em vez do menor`,
        Boolean(persistido) || 'não persistiu no disco, ou não encontra por aproximação',
        semBase === null || 'avaliou desconto com menos de 3 observações',
        comBase?.suspeito === true || 'não desconfiou de "de 5999" com máximo observado de 3899',
        /maior que o máximo/.test(comBase?.motivo || '') || `motivo pouco claro: ${comBase?.motivo}`,
      ];
    },
  },

  {
    nome: 'compras: busca real entrega tabela, confiança e ressalvas',
    tipo: 'unidade',
    async executar() {
      const paginas = {
        '/loja1': `<html><head><script type="application/ld+json">
          {"@type":"Product","name":"RTX 5070 12GB","offers":{"price":"3899.90","priceCurrency":"BRL","availability":"https://schema.org/InStock"}}
          </script></head><body><article><p>Placa de vídeo RTX 5070 12GB disponível para entrega imediata em todo o Brasil.</p></article></body></html>`,
        '/loja2': `<html><body><article><p>RTX 5070 12GB Placa de Vídeo. Por R$ 3.799,00 à vista no pix. ${'Descrição do produto com detalhes técnicos. '.repeat(4)}</p></article></body></html>`,
      };

      const srv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          if (req.url.startsWith('/search')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(
              JSON.stringify({
                results: [
                  { title: 'Loja 1', url: `http://127.0.0.1:${s.address().port}/loja1`, content: '' },
                  { title: 'Loja 2', url: `http://127.0.0.2:${s.address().port}/loja2`, content: '' },
                ],
              })
            );
          }
          res.setHeader('Content-Type', 'text/html');
          res.end(paginas[req.url] || '<html><body><p>vazio</p></body></html>');
        });
        s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
      });

      const dir = path.join(os.tmpdir(), `augpt-compras-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const ctx = {
        sandbox: new Sandbox(dir),
        emit() {},
        estado: {},
        config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false },
      };

      const saida = await tools.get('buscar_produtos').run({ consulta: 'RTX 5070 12GB' }, ctx);
      await srv.fechar();
      const historico = new HistoricoDePrecos(path.join(dir, '.augpt')).serie('RTX 5070 12GB');
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        /\| Loja \| Produto \| Preço \| Confiança \|/.test(saida) || 'não montou a tabela',
        (saida.includes('3.899,90') && saida.includes('3.799,00')) || 'perdeu algum preço',
        // o espaço aqui é inquebrável: é assim que toLocaleString formata moeda
        /MENOR PREÇO ENTRE AS FONTES CONSULTADAS: R\$\s3\.799,00/.test(saida) || 'não identificou o menor total',
        // as ressalvas são a diferença entre comparador honesto e agregador ruim
        /nunca "o melhor da internet"/.test(saida) || 'não proibiu a frase enganosa',
        /Frete não foi apurado/.test(saida) || 'não avisou sobre o frete',
        /Consultado em/.test(saida) || 'não registrou a data da consulta',
        historico?.observacoes >= 2 || 'não gravou no histórico de preços',
      ];
    },
  },

  {
    nome: 'compras: profundidade do usuário vale na busca de preço',
    tipo: 'unidade',
    async executar() {
      // oito lojas distintas disponíveis; o alvo tem de vir da profundidade
      const lojas = ['kabum.com.br', 'terabyteshop.com.br', 'pichau.com.br', 'amazon.com.br',
        'magazineluiza.com.br', 'americanas.com.br', 'fastshop.com.br', 'casasbahia.com.br'];

      const srv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          if (req.url.startsWith('/search')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(
              JSON.stringify({
                results: lojas.map((l, i) => ({
                  title: l,
                  url: `http://127.0.0.${i + 1}:${s.address().port}/produto/rtx`,
                  content: '',
                })),
              })
            );
          }
          res.setHeader('Content-Type', 'text/html');
          res.end(
            `<html><body><article><p>RTX 5070 Ti disponível. Por R$ ${3500 + Math.floor(Math.random() * 400)},00 à vista. ${'Detalhes do produto. '.repeat(4)}</p></article></body></html>`
          );
        });
        s.listen(0, '0.0.0.0', () => resolve({ porta: s.address().port, fechar: () => new Promise((r) => s.close(r)) }));
      });

      const medir = async (profundidade) => {
        const dir = path.join(os.tmpdir(), `augpt-prof-${Date.now()}-${profundidade}`);
        fs.mkdirSync(dir, { recursive: true });
        const ctx = {
          sandbox: new Sandbox(dir),
          emit() {},
          estado: {},
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, profundidadePesquisa: profundidade },
        };
        const saida = await tools.get('buscar_produtos').run({ consulta: 'RTX 5070 Ti' }, ctx);
        fs.rmSync(dir, { recursive: true, force: true });
        return { linhas: (saida.match(/^\| (?!Loja|---)/gm) || []).length, saida };
      };

      const normal = await medir('normal');
      const alta = await medir('alta');
      await srv.fechar();

      return [
        // antes esta ferramenta tinha teto próprio de 8 e ignorava o seletor
        normal.linhas >= 3 && normal.linhas <= 6 || `modo normal trouxe ${normal.linhas} ofertas (esperado 3 a 6)`,
        alta.linhas >= 6 || `modo alto trouxe ${alta.linhas} ofertas (mínimo 6)`,
        alta.linhas > normal.linhas || 'o seletor não mudou nada entre normal e alto',
        /profundidade alta \(alvo: 6–10\)/.test(alta.saida) || 'não registrou a profundidade em vigor',
      ];
    },
  },

  {
    nome: 'compras: enciclopédia e fórum não entram como loja',
    tipo: 'unidade',
    executar() {
      const { qualidadeDoDominio, ordenarPorQualidade } = require('../../src/tools/search');
      // na busca geral, fórum casava com a regra de .org e virava "organização"
      const forum = qualidadeDoDominio('https://forum.manjaro.org/t/x');
      const ong = qualidadeDoDominio('https://exemplo.org/x');
      const buscador = qualidadeDoDominio('https://duckduckgo.com/?q=x');

      const ordem = ordenarPorQualidade([
        { titulo: 'ddg', url: 'https://duckduckgo.com/?q=x' },
        { titulo: 'oficial', url: 'https://ibge.gov.br/x' },
      ]).map((r) => r.titulo);

      return [
        forum.tipo === 'fórum' || `fórum classificado como "${forum.tipo}"`,
        forum.peso < ong.peso || 'fórum vale o mesmo que organização',
        buscador.peso < 0 || 'página do buscador não foi descartada',
        ordem[0] === 'oficial' || 'buscador ficou na frente da fonte oficial',
      ];
    },
  },

  {
    nome: 'gráfico: lista em pt-BR e recusa de dado inválido',
    tipo: 'unidade',
    async executar() {
      const f = tools.get('gerar_grafico');
      const ctx = { emit() {}, estado: {}, config: {} };

      await f.run(
        { tipo: 'bar', titulo: 'Faturamento', rotulos: 'Sudeste, Nordeste, Sul', valores: '482900,50; 201450,00; 121300,25' },
        ctx
      );
      const spec = JSON.parse(ctx.estado.graficos[0].replace(/```chart|```/g, ''));

      const erros = [];
      for (const [args, esperado] of [
        [{ rotulos: 'a', valores: '1' }, /ao menos 2/],
        [{ rotulos: 'a,b,c', valores: '1,2' }, /mesmo tamanho/],
        [{ rotulos: 'a,b', valores: 'x,y' }, /número/],
      ]) {
        const msg = await f.run({ tipo: 'bar', ...args }, { emit() {}, estado: {}, config: {} }).catch((e) => e.message);
        if (!esperado.test(String(msg))) erros.push(`recusa fraca: ${msg}`);
      }

      return [
        // vírgula é decimal em pt-BR: dividir por vírgula dobrava os valores
        spec.datasets[0].data.length === 3 || `separou em ${spec.datasets[0].data.length} valores`,
        spec.datasets[0].data[0] === 482900.5 || `primeiro valor virou ${spec.datasets[0].data[0]}`,
        ...erros,
        true,
      ];
    },
  },
];
