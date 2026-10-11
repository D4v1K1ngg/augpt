'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sandbox } = require('../../src/tools/sandbox');
const tools = require('../../src/tools');

/**
 * Caso real (Davi, 2026-09-14, bateria de projeção do dólar): o modelo
 * chamou `executar_codigo` com `pd.read_csv('historico_dolar.csv')` como se
 * o arquivo já existisse — sem nunca tê-lo criado (nem com
 * escrever_arquivo, nem dentro do próprio script) — e repetiu o MESMO erro
 * 15 passos depois (passos 5 e 20, idêntico), sem aprender do primeiro
 * traceback. Ver a checagem em `src/tools/code.js` (arquivoInventado).
 */

function ctxDeTeste() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-codigo-teste-'));
  return {
    sandbox: new Sandbox(dir),
    config: { codeTimeoutMs: 5000 },
    emit() {},
  };
}

module.exports = [
  {
    nome: 'executar_codigo: barra leitura de CSV nunca criado, com instrução acionável (caso real: historico_dolar.csv)',
    tipo: 'unidade',
    async executar() {
      const ferramenta = tools.get('executar_codigo');
      const ctx = ctxDeTeste();
      try {
        await ferramenta.run(
          { linguagem: 'python', codigo: "import pandas as pd\nd = pd.read_csv('historico_dolar.csv')\nprint(d)" },
          ctx
        );
        return ['deveria ter barrado a leitura do arquivo inexistente'];
      } catch (err) {
        return [
          err.message.includes('historico_dolar.csv') || `erro não cita o arquivo: ${err.message}`,
          /não existe na pasta de trabalho/.test(err.message) || `erro não explica o motivo: ${err.message}`,
          /escrever_arquivo/.test(err.message) || `erro não sugere a saída (escrever_arquivo): ${err.message}`,
        ];
      }
    },
  },

  {
    nome: 'executar_codigo: NÃO barra quando o próprio script escreve o CSV antes de ler (uso legítimo)',
    tipo: 'unidade',
    async executar() {
      const ferramenta = tools.get('executar_codigo');
      const ctx = ctxDeTeste();
      try {
        // node é garantido no ambiente da bancada — usa javascript pra não
        // depender de python estar instalado na máquina que roda o teste.
        const saida = await ferramenta.run(
          {
            linguagem: 'javascript',
            codigo:
              "const fs = require('fs');\n" +
              "fs.writeFileSync('gerado.json', JSON.stringify({ok:true}));\n" +
              "console.log(fs.readFileSync('gerado.json', 'utf8'));",
          },
          ctx
        );
        return [
          typeof saida === 'string' && saida.includes('ok') || `esperava a saída do script, veio: ${String(saida).slice(0, 200)}`,
        ];
      } catch (err) {
        return [`não deveria barrar nem falhar: ${err.message}`];
      }
    },
  },

  {
    nome: 'executar_codigo: NÃO barra leitura de arquivo que já existe de verdade na pasta de trabalho',
    tipo: 'unidade',
    async executar() {
      const ferramenta = tools.get('executar_codigo');
      const ctx = ctxDeTeste();
      fs.writeFileSync(path.join(ctx.sandbox.root, 'real.json'), '{"ok":true}');
      try {
        const saida = await ferramenta.run(
          {
            linguagem: 'javascript',
            codigo: "const fs = require('fs');\nconsole.log(fs.readFileSync('real.json', 'utf8'));",
          },
          ctx
        );
        return [
          typeof saida === 'string' && saida.includes('ok') || `esperava a saída do script, veio: ${String(saida).slice(0, 200)}`,
        ];
      } catch (err) {
        return [`não deveria barrar um arquivo que existe de verdade: ${err.message}`];
      }
    },
  },

  {
    nome: 'executar_codigo: NÃO barra caminho absoluto/URL (fora do padrão do bug — só caminho relativo é checado)',
    tipo: 'unidade',
    async executar() {
      const ferramenta = tools.get('executar_codigo');
      const ctx = ctxDeTeste();
      try {
        // não precisa nem existir de verdade — o ponto é que este padrão de
        // caminho nem entra na checagem de "inventado", então o erro (se
        // houver) vem só do próprio runtime, não da barreira nova.
        await ferramenta.run(
          {
            linguagem: 'javascript',
            codigo: "const fs = require('fs');\ntry { fs.readFileSync('/tmp/augpt-inexistente-xyz.json', 'utf8'); } catch (e) { console.log('runtime: ' + e.code); }",
          },
          ctx
        );
        return [true];
      } catch (err) {
        return [!/barreira|inventado/i.test(err.message) || `deveria ter deixado passar pro runtime, mas a barreira nova pegou: ${err.message}`];
      }
    },
  },
];
