'use strict';

/**
 * Retomada de execução interrompida (2026-10-10): páginas baixadas e
 * destilações da execução anterior INTERROMPIDA da mesma conversa são
 * reaproveitadas; execução anterior concluída limpa tudo. Ver src/agent/retomada.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Retomada } = require('../../src/agent/retomada');
const { executarCasoAgente } = require('../motor');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-retomada-'));
const INTERROMPIDA = { estado: 'executando', subtarefas: [] };

module.exports = [
  {
    nome: 'retomada: guarda e relê página e destilação; o que passou de 12h expira; limpar apaga o arquivo; id de conversa vira nome seguro',
    tipo: 'unidade',
    executar() {
      const dir = tmp();
      let agora = 1_000_000;
      const r = new Retomada({ dir, idConversa: '../c:1', agora: () => agora });
      r.guardarPagina('https://site.com/a?utm=x#y', { texto: 'conteúdo A', titulo: 'A', via: 'direto', tentativas: [{ x: 1 }] });
      r.guardarPagina('https://site.com/vazia', { texto: '' });
      const chave = Retomada.chaveDestilacao({ objetivo: 'o', foco: 'f', opcao: '', texto: 'conteúdo A' });
      r.guardarDestilacao(chave, [{ texto: 'fato 1', origem: 'pesquisar_e_ler(site.com)' }]);
      const arquivos = fs.readdirSync(path.join(dir, 'retomada'));
      const relida = new Retomada({ dir, idConversa: '../c:1', agora: () => agora }).carregar();
      const pag = relida.pagina('https://site.com/a?outro=1');
      agora += 13 * 60 * 60 * 1000;
      const expirada = new Retomada({ dir, idConversa: '../c:1', agora: () => agora }).carregar();
      const destilacaoRelida = relida.destilacao(chave)?.[0]?.texto;
      const vazia = relida.pagina('https://site.com/vazia');
      const outroObjetivo = relida.destilacao(Retomada.chaveDestilacao({ objetivo: 'outro pedido', foco: 'f', opcao: '', texto: 'conteúdo A' }));
      relida.limpar();
      return [
        arquivos.length === 1 && !/[./:]/.test(arquivos[0].replace(/\.json$/, '')) || `nome do arquivo: ${arquivos}`,
        pag?.texto === 'conteúdo A' || `página relida: ${JSON.stringify(pag)}`,
        pag && !pag.tentativas || 'diagnóstico da leitura original não vai pro disco',
        vazia === null || 'página sem texto não é guardada',
        destilacaoRelida === 'fato 1' || 'destilação relida',
        outroObjetivo === null || 'outro objetivo não reaproveita a destilação',
        expirada.vazia || 'depois de 12h nada deveria ser retomado',
        !fs.existsSync(path.join(dir, 'retomada', arquivos[0])) || 'limpar() deveria apagar o arquivo',
      ];
    },
  },
  {
    nome: 'retomada (ponta a ponta): execução interrompida → a seguinte na mesma conversa não baixa de novo as páginas; execução anterior concluída → começa do zero',
    tipo: 'unidade',
    async executar() {
      const srv = await buscaFalsa([
        {
          contem: 'historia do pubg',
          paginas: [
            pagina('O PUBG foi lançado em março de 2017 em acesso antecipado pela Bluehole.'),
            pagina('A versão 1.0 do PUBG saiu em dezembro de 2017 no PC.'),
          ],
        },
      ]);
      if (!srv) return [];
      const caso = (extra) => ({
        nome: 'retomada: pubg',
        pedido: 'Qual a história do lançamento do PUBG?',
        idConversa: 'conversa-retomada',
        manterPasta: true,
        config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirLeitorExterno: false, subconsultas: false },
        roteiro: [
          { ferramenta: 'pesquisar_e_ler', argumentos: { consulta: 'historia do pubg' } },
          { ferramenta: 'responder', argumentos: { foco: 'pubg' } },
        ],
        redacao: 'Resposta de teste.',
        ...extra,
      });
      try {
        const primeira = await executarCasoAgente(caso({ manterPasta: false }));
        const segunda = await executarCasoAgente(caso({ tarefaAnterior: INTERROMPIDA }));
        const terceira = await executarCasoAgente(caso({ tarefaAnterior: null }));
        const r1 = primeira.registro?.retomada;
        const r2 = segunda.registro?.retomada || {};
        const r3 = terceira.registro?.retomada;
        return [
          !r1 || (r1.paginasUsadas === 0 && r1.destilacoesUsadas === 0) || `a 1ª execução não tinha o que retomar: ${JSON.stringify(r1)}`,
          r2.disponiveis?.paginas >= 2 || `a 2ª deveria encontrar as páginas da 1ª: ${JSON.stringify(r2)}`,
          r2.paginasUsadas >= 2 || `a 2ª deveria reaproveitar as 2 páginas: ${JSON.stringify(r2)}`,
          r2.destilacoesUsadas >= 2 || `a 2ª deveria reaproveitar as destilações: ${JSON.stringify(r2)}`,
          /2017/.test(segunda.promptRedacao) || 'o material retomado tem que chegar à redação',
          !r3 || (r3.paginasUsadas === 0 && r3.destilacoesUsadas === 0) || `anterior concluída: nada a retomar (${JSON.stringify(r3)})`,
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'retomada: arquivo lido da pasta de trabalho não vai para o cache de retomada (só leitura da web pública)',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'retomada: arquivo',
        pedido: 'Leia notas.txt e me diga o valor da multa',
        idConversa: 'conversa-arquivo',
        arquivos: { 'notas.txt': 'A multa por cancelamento é de R$ 350,00 conforme a cláusula 7.' },
        roteiro: [
          { ferramenta: 'ler_arquivo', argumentos: { caminho: 'notas.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'multa' } },
        ],
        redacao: 'A multa é de R$ 350,00.',
      });
      // mesma pasta que avaliacao/motor.js (prepararPasta) monta para o caso
      const pasta = path.join(os.tmpdir(), 'augpt-avaliacao', 'retomada-arquivo', '.augpt', 'retomada');
      const conteudo = fs.existsSync(pasta) ? fs.readdirSync(pasta).map((n) => fs.readFileSync(path.join(pasta, n), 'utf8')).join('') : '';
      return [
        obtido.ferramentasChamadas.includes('ler_arquivo') || 'cenário: o arquivo deveria ter sido lido',
        /350/.test(obtido.promptRedacao) || 'cenário: o conteúdo do arquivo deveria chegar à redação',
        !/350/.test(conteudo) || 'o conteúdo do arquivo do usuário foi parar no cache de retomada',
      ];
    },
  },
];
