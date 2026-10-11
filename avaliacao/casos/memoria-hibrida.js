'use strict';

const { Memory, ordenarPorHibrido, pontuarBM25, contarTokens, diasVelhoAgora } = require('../../src/agent/memory');

/**
 * Busca híbrida na memória vetorial (vetor + BM25 via Reciprocal Rank
 * Fusion). Motivação: Davi notou na prática que a busca puramente por
 * cosine deixava passar termo exato — dois itens semanticamente parecidos
 * (mesmo vetor, ou vetores muito próximos) empatam ou quase empatam no
 * cosine, e o item que contém a palavra exata da consulta pode perder pra um
 * vizinho "parecido, mas não é bem aquilo". BM25 entra como critério
 * lexical complementar, combinado por posição no ranking (RRF) — não por
 * valor bruto, que teria escalas incompatíveis (cosine 0-1 vs. BM25 aberto).
 *
 * Testado como função pura (`ordenarPorHibrido`), sem precisar de um
 * servidor Ollama falso: os vetores e textos são todos construídos à mão.
 */
module.exports = [
  {
    nome: 'busca híbrida: BM25 resgata o item com o termo exato quando o cosine empata todos',
    tipo: 'unidade',
    async executar() {
      // Os três itens têm o MESMO vetor — cosine == 1 para todos, empate
      // total. Só o item B contém o termo raro da consulta.
      const vecEmpatado = [1, 0, 0];
      const itens = [
        { texto: 'Anotação qualquer sobre outro assunto completamente diferente.', vec: vecEmpatado },
        { texto: 'O protocolo omega envolve reiniciar o serviço na porta certa.', vec: vecEmpatado },
        { texto: 'Mais uma nota qualquer, sem relação nenhuma com o resto.', vec: vecEmpatado },
      ];
      const consultaTokens = [...contarTokens('como funciona o protocolo omega').keys()];
      const resultado = ordenarPorHibrido({ itens, vec: vecEmpatado, consultaTokens, k: 3, tokensDoItem: (i) => contarTokens(i.texto) });
      return [
        (resultado[0] === itens[1]) ||
          'esperava que o item com "protocolo omega" viesse primeiro, mesmo com cosine empatado para os três',
      ];
    },
  },
  {
    nome: 'busca híbrida: termo exato entra mesmo com cosine abaixo do piso semântico',
    tipo: 'unidade',
    async executar() {
      const vecConsulta = [1, 0, 0];
      const itens = [
        // ortogonal ao vetor da consulta (cosine 0) — nunca passaria pelo piso 0.15 sozinho
        { texto: 'Termo exclusivo aparece bem aqui: xylophone-config.', vec: [0, 1, 0] },
        { texto: 'Item semanticamente relacionado, mas sem o termo da busca.', vec: [0.9, 0.1, 0] },
      ];
      const consultaTokens = [...contarTokens('onde fica o xylophone-config').keys()];
      const resultado = ordenarPorHibrido({ itens, vec: vecConsulta, consultaTokens, k: 2, tokensDoItem: (i) => contarTokens(i.texto) });
      return [
        resultado.includes(itens[0]) ||
          'item com o termo exato deveria aparecer via BM25 mesmo com cosine abaixo do piso semântico',
      ];
    },
  },
  {
    nome: 'busca híbrida: item sem sinal nenhum (nem vetor nem termo) fica de fora',
    tipo: 'unidade',
    async executar() {
      const vecConsulta = [1, 0, 0];
      const itens = [
        { texto: 'Relevante de verdade, bate o termo da consulta: caldeira industrial modelo 9.', vec: [1, 0, 0] },
        { texto: 'Totalmente sem relação, nem no vetor nem no texto.', vec: [0, 0, 1] },
      ];
      const consultaTokens = [...contarTokens('manual da caldeira industrial').keys()];
      const resultado = ordenarPorHibrido({ itens, vec: vecConsulta, consultaTokens, k: 5, tokensDoItem: (i) => contarTokens(i.texto) });
      return [
        !resultado.includes(itens[1]) || 'item sem nenhum sinal de relevância não deveria aparecer no resultado',
        resultado.includes(itens[0]) || 'item claramente relevante deveria aparecer',
      ];
    },
  },
  {
    nome: 'busca híbrida: BM25 satura repetição (5 ocorrências não vale 5x mais que 1)',
    tipo: 'unidade',
    async executar() {
      const itens = [
        { texto: 'gato gato gato gato gato' },
        { texto: 'gato aparece uma vez só, mas junto de outras palavras relevantes aqui' },
      ];
      const consultaTokens = [...contarTokens('gato').keys()];
      const [scoreRepetido, scoreUnico] = pontuarBM25(consultaTokens, itens);
      return [
        scoreRepetido > scoreUnico || 'repetir o termo ainda deveria pontuar mais que aparecer uma vez',
        scoreRepetido < scoreUnico * 5 || 'BM25 deveria saturar — 5 ocorrências não deveria valer literalmente 5x mais',
      ];
    },
  },
  {
    nome: 'Memory.buscar(): a fusão híbrida roda de verdade dentro da classe, não só na função pura',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: 'fake-embed' } });
      // Monkey-patch só do cálculo do vetor (não há Ollama de verdade aqui) —
      // todo item e toda consulta recebem o MESMO vetor, então cosine empata
      // tudo e só o BM25 consegue desempatar. Isso exercita `buscar()` de
      // verdade (constrói os tokens da consulta, chama `ordenarPorHibrido`),
      // não só a função pura testada acima.
      memoria.vetor = async () => [1, 0, 0];
      await memoria.add('Anotação qualquer sobre outro assunto completamente diferente.');
      await memoria.add('O protocolo omega envolve reiniciar o serviço na porta certa.');
      await memoria.add('Mais uma nota qualquer, sem relação nenhuma com o resto.');
      const resultado = await memoria.buscar('como funciona o protocolo omega', 3);
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        (resultado[0] && /protocolo omega/.test(resultado[0].texto)) ||
          'Memory.buscar() deveria trazer o item com o termo exato primeiro, mesmo com cosine empatado — a fusão precisa estar de fato ligada, não só existir como função solta',
      ];
    },
  },
  {
    nome: 'Memory.buscar(): sem embedModel configurado, cai no fallback léxico de sempre (inalterado)',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: null } });
      await memoria.add('Arquivo de configuração principal do projeto.', 'passo');
      await memoria.add('Uma anotação qualquer sem relação.', 'passo');
      const resultado = await memoria.buscar('configuração principal', 4);
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        (resultado.length === 1 && /configuração principal/.test(resultado[0].texto)) ||
          'sem embedModel, a busca deveria continuar achando por sobreposição léxica (Jaccard), como antes',
      ];
    },
  },

  /* -------- Peça 3 do plano de nível de raciocínio: memória curta (idConversa) -------- */

  {
    nome: 'diasVelhoAgora: soma a idade que já tinha ao gravar mais os dias corridos desde então',
    tipo: 'unidade',
    executar() {
      const dezDiasAtras = new Date(Date.now() - 10 * 86400000).toISOString();
      const item = { em: dezDiasAtras, diasVelhoQuandoSalvo: 5 };
      const idade = diasVelhoAgora(item, new Date());
      return [idade === 15 || `esperava 5 (na gravação) + 10 (desde então) = 15, obteve ${idade}`];
    },
  },
  {
    nome: 'diasVelhoAgora: sem data nenhuma encontrada na gravação (null), nunca vira "velho" — sem sinal não é sinal de idade',
    tipo: 'unidade',
    executar() {
      const item = { em: new Date(Date.now() - 100 * 86400000).toISOString(), diasVelhoQuandoSalvo: null };
      return [diasVelhoAgora(item) === null || 'item sem diasVelhoQuandoSalvo deveria devolver null, nunca uma idade inventada'];
    },
  },
  {
    nome: 'Memory.add(): idConversa/bruto são opcionais — chamada antiga (add(texto, tipo)) continua funcionando igual',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-retrocompat-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: null } });
      await memoria.add('Nota antiga, sem terceiro argumento nenhum.', 'nota');
      fs.rmSync(dir, { recursive: true, force: true });
      const item = memoria.items[0];
      return [
        item.idConversa === null || `esperava idConversa null (chamada antiga), obteve ${JSON.stringify(item.idConversa)}`,
        item.diasVelhoQuandoSalvo === null || 'sem bruto, diasVelhoQuandoSalvo deveria ficar null',
      ];
    },
  },
  {
    // O caso central da Peça 3: item já lido NESTA conversa deve ser achado
    // na busca escopada mesmo quando um item de OUTRA conversa também bateria
    // lexicalmente — sem escopo, a busca não teria como saber qual dos dois
    // "é sobre o que estamos conversando agora".
    nome: 'Memory.buscar(idConversa): prioriza item da MESMA conversa sobre um item de outra conversa igualmente relevante',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-escopo-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: null } });
      await memoria.add('Preço do processador Ryzen 7 9800X3D encontrado na KaBuM.', 'dossie', { idConversa: 'conversa-A' });
      await memoria.add('Preço do processador Ryzen 7 9800X3D encontrado na Pichau.', 'dossie', { idConversa: 'conversa-B' });
      const resultado = await memoria.buscar('processador Ryzen 7 9800X3D', 4, { idConversa: 'conversa-A' });
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        (resultado.length === 1 && /KaBuM/.test(resultado[0].texto)) ||
          `esperava só o item da conversa-A (KaBuM), obteve ${JSON.stringify(resultado.map((r) => r.texto))}`,
      ];
    },
  },
  {
    nome: 'Memory.buscar(idConversa): sem nada relevante NA conversa, cai pro resto da pasta (fallback)',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-fallback-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: null } });
      // nada com idConversa 'conversa-nova' — só uma nota de uma pasta antiga, sem conversa nenhuma
      await memoria.add('Preço do processador Ryzen 7 9800X3D encontrado na Terabyte.', 'dossie', { idConversa: 'conversa-velha' });
      const resultado = await memoria.buscar('processador Ryzen 7 9800X3D', 4, { idConversa: 'conversa-nova' });
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        (resultado.length === 1 && /Terabyte/.test(resultado[0].texto)) ||
          `sem nada na conversa-nova, esperava cair no fallback e achar o item de conversa-velha, obteve ${JSON.stringify(resultado.map((r) => r.texto))}`,
      ];
    },
  },
  {
    // Frescor: item da MESMA conversa existe e bateria na busca, mas é
    // velho demais pro limite passado — precisa ser descartado do escopo (e
    // cair no fallback), não reaproveitado como se fosse atual.
    nome: 'Memory.buscar(idConversa, frescorMaximoDias): item da conversa velho demais é descartado do escopo e cai no fallback',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-frescor-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: null } });
      await memoria.add('Cotação do dólar hoje encontrada numa fonte.', 'dossie', { idConversa: 'c1' });
      // força o item recém-gravado a parecer velho: 10 dias "quando salvo" e
      // gravado ele mesmo há mais 5 dias — 15 dias de idade agora.
      memoria.items[0].diasVelhoQuandoSalvo = 10;
      memoria.items[0].em = new Date(Date.now() - 5 * 86400000).toISOString();
      // fallback: outra fonte, sem conversa nenhuma, mais recente
      await memoria.add('Cotação do dólar hoje encontrada em outra fonte.', 'nota');

      const resultado = await memoria.buscar('cotação do dólar hoje', 4, { idConversa: 'c1', frescorMaximoDias: 7 });
      fs.rmSync(dir, { recursive: true, force: true });
      return [
        resultado.length > 0 || 'esperava cair no fallback e ainda achar alguma coisa, não veio nada',
        !resultado.some((r) => r.idConversa === 'c1') ||
          'o item de 15 dias (acima do limite de 7) não deveria ter sido reaproveitado do escopo da conversa',
      ];
    },
  },
  {
    nome: 'Memory.buscar() sem idConversa continua igual a antes desta peça — nunca filtra por conversa nem por frescor',
    tipo: 'unidade',
    async executar() {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-memoria-semescopo-'));
      const memoria = new Memory({ dir, config: { host: 'http://127.0.0.1:1', embedModel: null } });
      await memoria.add('Preço do monitor ultrawide encontrado numa loja.', 'dossie', { idConversa: 'qualquer-conversa' });
      const resultado = await memoria.buscar('monitor ultrawide', 4);
      fs.rmSync(dir, { recursive: true, force: true });
      return [resultado.length === 1 || 'buscar() sem idConversa deveria achar o item normalmente, como sempre'];
    },
  },
];
