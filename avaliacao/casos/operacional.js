'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { MemoriaOperacional, observar } = require('../../src/agent/memoria-operacional');

module.exports = [
  {
    nome: 'memória operacional: aprende, ganha confiança e injeta no prompt',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-op-${Date.now()}`);
      const m = new MemoriaOperacional(dir);

      // uma ocorrência pode ser acaso: só a repetição vira confiança
      observar(m, 'fonte', { tipo: 'leitura', provedor: 'render-js', url: 'https://loja.exemplo.com/produto/1' });
      const antes = m.estrategiaDeSite('https://loja.exemplo.com/outro');
      observar(m, 'fonte', { tipo: 'leitura', provedor: 'render-js', url: 'https://loja.exemplo.com/produto/2' });
      const depois = m.estrategiaDeSite('https://www.loja.exemplo.com/terceiro');

      observar(m, 'resultado', { nome: 'ler_arquivo', erro: '"nota" não existe na pasta. Nomes parecidos: nota-1.txt' });
      observar(m, 'resultado', { nome: 'ler_arquivo', erro: '"x" não existe na pasta de trabalho.' });

      m.aprender({ tipo: 'preferencia', chave: 'formato', licao: 'prefere resposta em tabela', peso: 2 });

      const prompt = m.paraPrompt('pesquise na loja.exemplo.com');
      const persistida = new MemoriaOperacional(dir).listar();
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        antes === null || `confiou numa única ocorrência (${antes})`,
        depois === 'render-js' || `não aprendeu a estratégia do site (${depois})`,
        prompt.includes('O QUE VOCÊ JÁ APRENDEU') || 'bloco não foi montado para o prompt',
        prompt.includes('loja.exemplo.com') || 'lição relevante ficou de fora do prompt',
        prompt.includes('tabela') || 'preferência do usuário não entrou',
        prompt.length < 900 || `bloco grande demais: ${prompt.length} caracteres`,
        persistida.length >= 3 || `persistiu só ${persistida.length} itens`,
        persistida.every((i) => i.rotulo) || 'item sem rótulo de tipo',
      ];
    },
  },

  {
    nome: 'memória operacional: lição nova substitui a antiga da mesma chave',
    tipo: 'unidade',
    executar() {
      const dir = path.join(os.tmpdir(), `augpt-op2-${Date.now()}`);
      const m = new MemoriaOperacional(dir);
      m.aprender({ tipo: 'site', chave: 'a.com', licao: 'precisa de JavaScript', peso: 3 });
      m.aprender({ tipo: 'site', chave: 'a.com', licao: 'passou a funcionar direto' });
      const itens = m.listar().filter((i) => i.chave === 'a.com');
      const esquecidos = m.esquecer('a.com');
      const depois = m.listar().filter((i) => i.chave === 'a.com').length;
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        itens.length === 1 || `ficou com ${itens.length} lições para a mesma chave`,
        itens[0].licao.includes('direto') || 'manteve a lição antiga',
        itens[0].vezes === 1 || 'herdou a confiança da lição antiga',
        esquecidos === 1 || `esqueceu ${esquecidos} em vez de 1`,
        depois === 0 || 'não removeu de fato',
      ];
    },
  },

  {
    nome: 'memória operacional desligada não injeta nada no prompt',
    pedido: 'Qual o valor da nota?',
    arquivos: { 'nota.txt': 'Valor R$ 90,00' },
    config: { memoriaOperacional: false },
    roteiro: [
      { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
      { ferramenta: 'responder', argumentos: { foco: 'o valor' } },
    ],
    redacao: 'A nota é de R$ 90,00.',
    espera: { ok: true, promptDecisaoNaoContem: ['O QUE VOCÊ JÁ APRENDEU'] },
  },
];
