#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { executarCasoAgente, comparar, RAIZ } = require('./motor');

// Os servidores falsos da bancada (páginas, SearXNG, Ollama, MCP) rodam em
// 127.0.0.1 — que as ferramentas web bloqueiam por padrão desde a Fase 1 de
// segurança (src/tools/rede.js). Liberado só aqui, pro processo da bancada;
// os casos de avaliacao/casos/seguranca.js desligam de novo pra testar o
// bloqueio de verdade.
process.env.AUGPT_PERMITIR_REDE_LOCAL = '1';

/**
 * Bancada de avaliação do AuGPT.
 *
 *   npm run avaliar                    todos os casos, modelo falso
 *   npm run avaliar -- --grupo=loop    só um grupo
 *   npm run avaliar -- --caso=nome     só os casos cujo nome contém o texto
 *   npm run avaliar -- --verboso       mostra o detalhe de cada caso
 *   npm run avaliar -- --real          usa o Ollama de verdade (mede, não afirma)
 */

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, valor] = a.replace(/^--/, '').split('=');
    return [chave, valor ?? true];
  })
);

// Bancada hermética (2026-10-11): fora do --real, nenhum caso sai pra
// internet. As URLs dos roteiros (loja.com, kabum.com.br…) batiam em sites de
// verdade, e o resultado e a duração dependiam da rede do dia. Agora só os
// servidores falsos em 127.0.0.1 respondem; o resto falha na hora, como num
// computador offline.
const barrados = new Set();
if (!argumentos.real) {
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (entrada, opcoes) => {
    const host = new URL(entrada?.url ?? entrada).hostname;
    if (/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(host)) return fetchReal(entrada, opcoes);
    barrados.add(host);
    return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', hostname: host } }));
  };
}

const PLACAR = path.join(__dirname, 'ultimo-resultado.json');
const COR = process.stdout.isTTY;
const c = (codigo, texto) => (COR ? `\u001b[${codigo}m${texto}\u001b[0m` : texto);
const verde = (t) => c(32, t);
const vermelho = (t) => c(31, t);
const cinza = (t) => c(90, t);
const amarelo = (t) => c(33, t);

function carregarCasos() {
  const dir = path.join(__dirname, 'casos');
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.js'))
    .flatMap((arquivo) => {
      const grupo = arquivo.replace('.js', '');
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(path.join(dir, arquivo)).map((caso) => ({ ...caso, grupo }));
    })
    .filter((caso) => (argumentos.real ? caso.somenteReal : !caso.somenteReal))
    .filter((caso) => !argumentos.grupo || caso.grupo === argumentos.grupo)
    .filter((caso) => !argumentos.caso || caso.nome.toLowerCase().includes(String(argumentos.caso).toLowerCase()));
}

/** Caso de unidade devolve uma lista onde `true` é sucesso e string é a falha. */
async function executarUnidade(caso) {
  const inicio = Date.now();
  try {
    const resultados = await caso.executar();
    const falhas = (Array.isArray(resultados) ? resultados : [resultados]).filter((r) => r !== true);
    return { falhas: falhas.map(String), duracao: Date.now() - inicio };
  } catch (err) {
    return { falhas: [`exceção: ${err.message}`], duracao: Date.now() - inicio };
  }
}

async function executarAgente(caso) {
  const inicio = Date.now();
  try {
    const obtido = await executarCasoAgente(caso, {
      real: Boolean(argumentos.real),
      host: argumentos.host || 'http://127.0.0.1:11434',
      modelo: argumentos.modelo || 'llama3.1',
      modeloRedacao: argumentos.modeloRedacao || '',
      // no modo real, grava no mesmo lugar que o app: dá para comparar depois
      gravarRegistro: argumentos.real
        ? argumentos.registros ||
          path.join(
            os.homedir(),
            process.platform === 'win32' ? 'AppData/Roaming/AuGPT/execucoes' : '.config/AuGPT/execucoes'
          )
        : null,
    });
    // No modo real não há roteiro: em vez de passar/falhar, mede a proporção
    // de fatos esperados que apareceram na resposta.
    let qualidade = null;
    if (argumentos.real && caso.fatos) {
      const texto = obtido.resposta.toLowerCase();
      const encontrados = caso.fatos.filter((f) => texto.includes(String(f).toLowerCase()));
      const linhas = obtido.resposta.split('\n').filter((l) => l.trim()).length;
      qualidade = {
        fatos: `${encontrados.length}/${caso.fatos.length}`,
        proporcao: encontrados.length / caso.fatos.length,
        faltando: caso.fatos.filter((f) => !encontrados.includes(f)),
        inventou: (caso.naoDeveConter || []).filter((f) => texto.includes(String(f).toLowerCase())),
        tamanhoOk: !caso.linhasMinimas || linhas >= caso.linhasMinimas,
        arquivosOk:
          !caso.arquivosEsperados || caso.arquivosEsperados.every((a) => obtido.arquivos.includes(a)),
      };
    }

    // `posVerificar` é para asserções que olham estado fora do que `comparar`
    // já expõe (por exemplo, o que ficou gravado em disco depois da execução).
    const falhasPos =
      !argumentos.real && typeof caso.posVerificar === 'function'
        ? (caso.posVerificar(obtido) || []).filter((r) => r !== true).map(String)
        : [];

    return {
      qualidade,
      falhas: argumentos.real ? [] : [...comparar(caso.espera, obtido), ...falhasPos],
      duracao: Date.now() - inicio,
      medidas: {
        passos: obtido.passos,
        ferramentas: obtido.ferramentasChamadas.length,
        resposta: obtido.resposta.length,
        perguntou: obtido.perguntouAoUsuario,
      },
      obtido,
    };
  } catch (err) {
    return { falhas: [`exceção: ${err.message}`], duracao: Date.now() - inicio };
  }
}

(async function principal() {
  const casos = carregarCasos();
  if (!casos.length) {
    console.log('Nenhum caso corresponde ao filtro.');
    process.exit(0);
  }

  console.log(
    `\nBancada AuGPT · ${casos.length} casos${argumentos.real ? amarelo(' · MODELO REAL (medição)') : ''}\n`
  );

  const inicio = Date.now();
  const resultados = [];
  let grupoAtual = null;

  for (const caso of casos) {
    if (caso.grupo !== grupoAtual) {
      grupoAtual = caso.grupo;
      console.log(cinza(`  ${grupoAtual}`));
    }

    const r = caso.tipo === 'unidade' ? await executarUnidade(caso) : await executarAgente(caso);
    const passou = r.falhas.length === 0;
    resultados.push({
      nome: caso.nome, grupo: caso.grupo, passou, falhas: r.falhas,
      duracao: r.duracao, medidas: r.medidas, qualidade: r.qualidade,
    });

    const tempo = cinza(argumentos.real ? `${(r.duracao / 1000).toFixed(1)}s` : `${r.duracao}ms`);
    const marca = argumentos.real
      ? r.qualidade
        ? r.qualidade.proporcao === 1 && !r.qualidade.inventou.length
          ? verde('✓')
          : r.qualidade.proporcao >= 0.5
            ? amarelo('~')
            : vermelho('✗')
        : cinza('·')
      : passou
        ? verde('✓')
        : vermelho('✗');
    console.log(`    ${marca} ${caso.nome} ${tempo}${r.qualidade ? cinza(` fatos ${r.qualidade.fatos}`) : ''}`);
    if (r.qualidade?.faltando.length) console.log(cinza(`        faltou: ${r.qualidade.faltando.join(', ')}`));
    if (r.qualidade?.inventou.length) console.log(vermelho(`        inventou: ${r.qualidade.inventou.join(', ')}`));
    if (r.qualidade && !r.qualidade.tamanhoOk) console.log(amarelo('        resposta menor que o tamanho pedido'));
    if (r.qualidade && !r.qualidade.arquivosOk) console.log(amarelo('        arquivo esperado não foi criado'));
    if (!passou) r.falhas.forEach((f) => console.log(`        ${vermelho('→')} ${f}`));

    if (argumentos.verboso && r.medidas) {
      console.log(
        cinza(
          `        passos ${r.medidas.passos} · ${r.medidas.ferramentas} chamadas · resposta ${r.medidas.resposta} chars`
        )
      );
    }
    if (argumentos.real && r.obtido) {
      const m = r.obtido.registro;
      console.log(
        cinza(
          `        ${m.passos} passos · ${m.ferramentas.length} ferramentas · ${m.tokens.total} tokens · ` +
            `${(m.duracaoMs / 1000).toFixed(1)}s · ${m.incidentes.errosDeFerramenta} erros`
        )
      );
      console.log(cinza(`        ${r.obtido.resposta.replace(/\n/g, ' ').slice(0, 110)}`));
    }
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
  const passaram = resultados.filter((r) => r.passou).length;
  const falharam = resultados.length - passaram;

  console.log(
    `\n${falharam ? vermelho(`${passaram}/${resultados.length} casos`) : verde(`${passaram}/${resultados.length} casos`)} · ${duracao}s`
  );

  if (barrados.size) console.log(cinza(`rede externa barrada: ${barrados.size} endereço(s) fora da bancada`));

  // comparação com a execução anterior: é isto que denuncia regressão
  let anterior = null;
  try {
    anterior = JSON.parse(fs.readFileSync(PLACAR, 'utf8'));
  } catch {
    /* primeira execução */
  }

  if (anterior && !argumentos.real) {
    const antes = new Map(anterior.resultados.map((r) => [r.nome, r.passou]));
    const quebrou = resultados.filter((r) => !r.passou && antes.get(r.nome) === true);
    const consertou = resultados.filter((r) => r.passou && antes.get(r.nome) === false);
    const novos = resultados.filter((r) => !antes.has(r.nome));

    if (quebrou.length) console.log(vermelho(`REGRESSÃO: ${quebrou.map((r) => r.nome).join(', ')}`));
    if (consertou.length) console.log(verde(`corrigidos: ${consertou.map((r) => r.nome).join(', ')}`));
    if (novos.length) console.log(cinza(`novos: ${novos.length}`));
    console.log(cinza(`execução anterior: ${anterior.passaram}/${anterior.total} em ${anterior.duracao}s`));
  }

  if (argumentos.real) {
    const medidos = resultados.filter((r) => r.medidas);
    const comQualidade = resultados.filter((r) => r.qualidade);
    const media = (lista, f) => (lista.reduce((n, r) => n + f(r), 0) / (lista.length || 1));
    const acerto = media(comQualidade, (r) => r.qualidade.proporcao) * 100;
    const inventou = comQualidade.filter((r) => r.qualidade.inventou.length).length;

    console.log(`\n${amarelo('MEDIÇÃO')} · ${argumentos.modelo || 'llama3.1'}`);
    console.log(`  fatos encontrados   ${acerto.toFixed(0)}%`);
    console.log(`  passos por tarefa   ${media(medidos, (r) => r.medidas.passos).toFixed(1)}`);
    console.log(`  segundos por tarefa ${media(medidos, (r) => r.duracao / 1000).toFixed(1)}`);
    console.log(`  perguntou ao usuário ${medidos.filter((r) => r.medidas.perguntou).length} vez(es)`);
    if (inventou) console.log(vermelho(`  inventou dado em ${inventou} tarefa(s)`));
    console.log(cinza('  gravado em execuções — o comparativo por modelo está na aba Execuções'));
  }

  if (!argumentos.real && !argumentos.caso && !argumentos.grupo) {
    fs.writeFileSync(
      PLACAR,
      JSON.stringify(
        { em: new Date().toISOString(), total: resultados.length, passaram, duracao: Number(duracao), resultados },
        null,
        2
      ),
      'utf8'
    );
  }

  fs.rmSync(RAIZ, { recursive: true, force: true });
  console.log();
  process.exit(falharam && !argumentos.real ? 1 : 0);
})();
