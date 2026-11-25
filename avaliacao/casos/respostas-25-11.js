'use strict';

/**
 * Os 5 defeitos da leitura das 17 respostas da régua (25/11, Davi: "vamos olhar as respostas e ver se estão saindo boas").
 */

const fs = require('fs');
const path = require('path');
const { explicarTermos } = require('../../src/agent/glossario');
const { semPrecoComLoja } = require('../../src/agent/onde-comprar');
const { semPalavrao } = require('../../src/agent/sem-palavrao');
const { semEnchimento } = require('../../src/agent/capacidades');

module.exports = [
  {
    nome: 'respostas de 25/11: o glossário não explica o verbo "inverter"; a cotação não leva a ficha do PC e o escritor só usa o dado do PC que muda a resposta; o "Preço: não especificado" sai do cartão com loja; palavrão de fórum sai; a data que sobra da abertura sai',
    tipo: 'unidade',
    executar() {
      const nucleo = fs.readFileSync(path.join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
      const comLoja = '#### 1. Simgot EM6L\n\n**Onde comprar (preços de 25/11/2026):** [Zoom: a partir de R$ 946,03](x)\n\nServe bem.\n**Preço:** Não especificado nas fontes (bla).\n**Atenção:** nada.\n';
      return [
        !/inverter \(/.test(explicarTermos('Você precisa inverter isso nas configurações.')) || 'o verbo',
        /Inverter \(motor/.test(explicarTermos('O ar-condicionado Gree Inverter gasta menos.')) && /compressor inverter \(motor/.test(explicarTermos('Tem compressor inverter.')) || 'o aparelho',
        /'calendario', 'cotacao'\]\.includes\(ent\.acao\)/.test(nucleo) && /SO_O_QUE_MUDA = 'Use cada dado só onde ele muda a resposta/.test(nucleo) || 'o PC na cotação e a regra do escritor',
        !/não especificado/i.test(semPrecoComLoja(comLoja)) && /Atenção/.test(semPrecoComLoja(comLoja)) && !/não especifica/.test(semPrecoComLoja(comLoja.replace('Não especificado nas fontes', 'A fonte não especifica o valor'))) || 'preço com loja',
        /não especificado/i.test(semPrecoComLoja('#### 1. X\n**Preço:** Não especificado nas fontes.\n')) || 'sem loja, a linha fica',
        semPalavrao('uma opção de "puta de uma melhora" em relação') === 'uma opção de "baita melhora" em relação' && semPalavrao('essa merda trava') === 'essa m**** trava' || 'palavrão',
        semPalavrao('computador, disputa, reputação') === 'computador, disputa, reputação' && semPalavrao('o que é porra?', 'o que é porra?') === 'o que é porra?' || 'palavra comum e o palavrão do próprio usuário',
        semEnchimento('Com base nas fontes mais recentes de hoje, **25 de novembro de 2026**, aqui estão as notícias:').startsWith('Aqui estão') || 'a data que sobra',
        semEnchimento('25 de novembro de 2026: o dia em que algo aconteceu.').startsWith('25 de novembro') || 'a resposta que começa pela data fica',
      ];
    },
  },
];
module.exports.push({
  nome: 'fontes (25/11): a página vazia (índice, grade de programa) não vai para o escritor — só se não sobrar nada; em produto, na mesma faixa, a fonte do Brasil (.br ou em português) antes da de fora',
  tipo: 'unidade',
  async executar() {
    const nucleo = require('../../src/agent/nucleo');
    const p = (n, url, tipoFonte, texto) => ({ n, url, titulo: `p${n}`, tipoFonte, trechos: [`Página ${n}: ${texto}. `.repeat(80)] });
    const pt = 'A air fryer de 5 litros serve uma família de quatro pessoas e esquenta rápido';
    const en = 'This air fryer with a 6 quart basket is great for a family of four and heats up quickly';
    const noticias = [p(1, 'https://band.com.br/brasil-urgente', 'vazio', pt), p(2, 'https://g1.globo.com/a', 'noticia', pt), p(3, 'https://uol.com.br/b', 'noticia', pt)];
    const n1 = (await nucleo.materialDaEscrita('air fryer família', noticias, { limite: 9000, perfil: 'noticia' })).map((f) => f.n);
    const soVazias = (await nucleo.materialDaEscrita('air fryer família', [noticias[0]], { limite: 9000, perfil: 'noticia' })).map((f) => f.n);
    const compra = [...[1, 2, 3, 4, 5].map((n) => p(n, `https://www.reddit.com/r/airfryer/${n}`, 'comunidade', en)), p(6, 'https://www.clubedohardware.com.br/x', 'comunidade', pt)];
    const ordem = (await nucleo.materialDaEscrita('air fryer basket family quart', compra, { limite: 2500, perfil: 'produto' })).map((f) => f.n);
    const fonte = require('fs').readFileSync(require('path').join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
    return [
      !n1.includes(1) && n1.includes(2) || `vazia: ${n1}`,
      soVazias.includes(1) || 'só vazias: ficam',
      ordem.includes(6) && ordem.length === 4 || `o do Brasil entra antes do corte: ${ordem}`,
      /Medidas do Brasil: litros, °C/.test(fonte) || 'a regra das medidas no formato de produto',
    ];
  },
});
module.exports.push({
  nome: 'config (25/11): o "conferirAfirmacoes": false gravado antes vira true uma vez; desligado depois da revisão, fica desligado',
  tipo: 'unidade',
  executar() {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { Config } = require('../../src/config');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-cfg-'));
    const ler = (salvo) => {
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(salvo));
      const c = new Config(dir);
      return c.load();
    };
    const antigo = ler({ conferirAfirmacoes: false });
    const desligou = ler({ conferirAfirmacoes: false, conferirAfirmacoesRevista: true });
    fs.rmSync(dir, { recursive: true, force: true });
    return [antigo.conferirAfirmacoes === true || 'o antigo liga', desligou.conferirAfirmacoes === false || 'o desligado depois fica'];
  },
});
module.exports.push({
  nome: 'régua do método (25/11): "fiz um teste de velocidade e deu 500 Mbps, isso quer dizer…?" não vira a oferta de medir ("testa de novo agora" vira); o Windows pelo build (26200 = Windows 11); a ficha do PC só quando a pergunta fala do computador ("meu mouse", não)',
  tipo: 'unidade',
  executar() {
    const rede = require('../../src/agent/rede-no-chat');
    const { nomeDoSistema } = require('../../src/verificador-de-hardware');
    const fonte = require('fs').readFileSync(require('path').join(__dirname, '../../src/agent/nucleo/index.js'), 'utf8');
    const PISTA = new RegExp(/const PISTA_DO_PC = \/(.+)\/i;/.exec(fonte)[1], 'i');
    return [
      rede.pedidoDeRede('Fiz um teste de velocidade e deu 500 Mbps. Isso quer dizer que minha internet está estável para jogar?') === null || 'teste já feito',
      Boolean(rede.pedidoDeRede('o speedtest deu 20 mega, testa de novo agora') && rede.pedidoDeRede('faz um teste de velocidade')) || 'pedido de medir',
      nomeDoSistema('win32', '10.0.26200') === 'Windows 11 (build 26200)' && nomeDoSistema('win32', '10.0.19045') === 'Windows 10 (build 19045)' || 'Windows',
      !PISTA.test('como saber se eu preciso ajustar o ângulo do sensor no meu mouse ?') && PISTA.test('como melhorar o desempenho do meu computador para jogos fps') || 'ficha do PC',
      /doPc && !ent\.conversa/.test(fonte) || 'a ficha depende da pista',
    ];
  },
});
module.exports.push({
  nome: 'tela (25/11, no app): o usuário contando o teste que fez no Paint ("eu fiz o teste… após ativar o recurso… eu percebi que as linhas ficavam mais regulares") não é pedido de agir num programa; "ativa o modo de jogo" e "abre o bloco de notas e digita…" continuam',
  tipo: 'unidade',
  executar() {
    const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');
    const contou = "eu fiz o teste no paint usando '0' e depois '-1' e senti diferença, ao testar usando o ajuste do mouse '0' desligado as linhas que fiz com o olho fechado ficavam irregulares e pendiam 'caiam' para a direita, porém apos ativar o recurso de correção de angulo e setar o valor para '-1' eu percebi que as linhas ficavam mais regulares e não pendiam mais para nenhum lado";
    return [
      tipoDoPedido(contou).tipo !== 'tela' || 'contou o que fez',
      tipoDoPedido('ativa o modo de jogo').tipo === 'tela' && tipoDoPedido('abre o bloco de notas e digita ola').tipo === 'tela' || 'pedidos de tela',
    ];
  },
});
