'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Skills } = require('../../src/skills');

/**
 * Fallback semântico de seleção de skill (item 3 do plano de melhorias):
 * quando NENHUM gatilho bate, `Skills.selecionar()` tenta uma comparação de
 * embeddings antes de desistir. Aqui não dá pra usar um embedding de verdade
 * (o Ollama de mentira do resto da bancada devolve sempre o mesmo vetor
 * fixo, o que tornaria qualquer par de textos "idêntico"), então este
 * arquivo sobe seu próprio servidor HTTP fake, com um embedding simples e
 * determinístico: um vetor de presença/ausência sobre um vocabulário fixo,
 * grande o bastante para diferenciar dois assuntos sem relação nenhuma.
 */

const VOCAB = [
  'previsao', 'tempo', 'chuva', 'temperatura',
  'codigo', 'erro', 'depurar', 'funcao', 'python', 'programacao',
];

function semAcento(t) {
  return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function vetorFake(texto) {
  const alvo = semAcento(texto);
  return VOCAB.map((v) => (alvo.includes(v) ? 1 : 0));
}

function subirServidorEmbedding() {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo || '{}');
        } catch {
          /* ignora corpo inválido */
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ embeddings: [vetorFake(String(pedido.input || ''))] }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve(servidor));
  });
}

/**
 * Servidor fake de propósito diferente do de cima: em vez de um vetor de
 * presença/ausência (que só dá 0 ou 1, nunca um cosseno intermediário), devolve
 * um vetor exato por texto (mapa exato, sem normalização) — dá controle fino
 * sobre o cosseno resultante, o que é o que precisa pra testar LIMIAR_SEMANTICO
 * e MARGEM_SEMANTICA_MINIMA como números, não só como "bate ou não bate".
 * Vetores em [cos(ângulo), sin(ângulo)]: cosseno entre dois deles é
 * cos(diferença de ângulo) — dá pra mirar um cosseno exato escolhendo o ângulo.
 */
function subirServidorEmbeddingControlado(mapaTextoParaVetor) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => {
        corpo += d;
      });
      req.on('end', () => {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo || '{}');
        } catch {
          /* ignora corpo inválido */
        }
        const texto = String(pedido.input || '');
        const vetor = mapaTextoParaVetor[texto];
        if (!vetor) throw new Error(`vetor não mapeado pro texto de teste: ${JSON.stringify(texto)}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ embeddings: [vetor] }));
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolve(servidor));
  });
}

/** Duas skills sintéticas com `gatilhos: []`, cada uma com a descrição exata dada. */
function criarDuasSkillsComDescricoes(descA, descB) {
  const dirUsuario = path.join(os.tmpdir(), `augpt-skills-controlado-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(path.join(dirUsuario, 'skill-a'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'skill-a', 'SKILL.md'),
    `---\nnome: Skill A\ndescricao: ${descA}\ngatilhos: []\netapa: redacao\nprioridade: 1\n---\nCorpo A.\n`
  );
  fs.mkdirSync(path.join(dirUsuario, 'skill-b'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'skill-b', 'SKILL.md'),
    `---\nnome: Skill B\ndescricao: ${descB}\ngatilhos: []\netapa: redacao\nprioridade: 1\n---\nCorpo B.\n`
  );
  const dirEmbutidas = path.join(os.tmpdir(), `augpt-skills-embutidas-vazia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dirEmbutidas, { recursive: true });
  return new Skills({ dirEmbutidas, dirUsuario });
}

/**
 * Uma skill sintética com `gatilhos: []` (só pontua por embedding) e
 * `nao_use_para` — pra testar que `selecionarPorEmbedding` respeita o
 * antigatilho, não só `pontuar`.
 */
function criarSkillComAntigatilho(descricao, naoUsePara) {
  const dirUsuario = path.join(os.tmpdir(), `augpt-skills-antigatilho-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(path.join(dirUsuario, 'skill-com-antigatilho'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'skill-com-antigatilho', 'SKILL.md'),
    `---\nnome: Skill com antigatilho\ndescricao: ${descricao}\ngatilhos: []\nnao_use_para: [${naoUsePara.join(', ')}]\netapa: decisao\nprioridade: 1\n---\nCorpo.\n`
  );
  const dirEmbutidas = path.join(os.tmpdir(), `augpt-skills-embutidas-vazia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dirEmbutidas, { recursive: true });
  return new Skills({ dirEmbutidas, dirUsuario });
}

/**
 * Duas skills sintéticas com `gatilhos: []` — ou seja, NUNCA pontuam pelo
 * sistema de gatilho, não importa o pedido. Assim, qualquer seleção só pode
 * vir do fallback semântico, isolando exatamente o que este teste cobre.
 */
function criarSkillsSemanticas() {
  const dirUsuario = path.join(os.tmpdir(), `augpt-skills-embedding-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(path.join(dirUsuario, 'clima-semantico'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'clima-semantico', 'SKILL.md'),
    `---
nome: Previsão do tempo (teste semântico)
descricao: Ajuda a interpretar previsao do tempo, chuva e temperatura.
gatilhos: []
etapa: decisao
prioridade: 1
---
Corpo de teste da skill de clima.
`
  );

  fs.mkdirSync(path.join(dirUsuario, 'codigo-semantico'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'codigo-semantico', 'SKILL.md'),
    `---
nome: Programação (teste semântico)
descricao: Ajuda a escrever codigo, corrigir erro, depurar funcao em python e programacao.
gatilhos: []
etapa: decisao
prioridade: 1
---
Corpo de teste da skill de código.
`
  );

  // pasta de embutidas vazia — só as duas sintéticas competem, sem o catálogo
  // real (que tem gatilhos próprios e poderia bater antes do fallback entrar em jogo)
  const dirEmbutidas = path.join(os.tmpdir(), `augpt-skills-embutidas-vazia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dirEmbutidas, { recursive: true });

  return new Skills({ dirEmbutidas, dirUsuario });
}

/**
 * Uma skill com gatilho de VERDADE ("chuva", pontua sem precisar de embedding
 * nenhum) e outra sem gatilho algum (só pontua por embedding) — pra testar o
 * `reforcoSemantico` (Peça 2 do nível de raciocínio unificado): com gatilho
 * batendo, `candidatas.length > 0`, então o fallback semântico normal nem
 * roda (`selecionar` só cai nele quando ZERO gatilho bate) — `reforcoSemantico`
 * é o que faz o embedding rodar MESMO ASSIM, como reforço, pra pegar a skill
 * sem gatilho que o pedido também toca.
 */
function criarSkillsParaReforco() {
  const dirUsuario = path.join(os.tmpdir(), `augpt-skills-reforco-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(path.join(dirUsuario, 'clima-gatilho'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'clima-gatilho', 'SKILL.md'),
    `---
nome: Clima (com gatilho)
descricao: Ajuda com previsão do tempo.
gatilhos: [chuva]
etapa: decisao
prioridade: 1
---
Corpo de teste da skill de clima.
`
  );
  fs.mkdirSync(path.join(dirUsuario, 'codigo-semantico'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'codigo-semantico', 'SKILL.md'),
    `---
nome: Programação (só embedding, sem gatilho)
descricao: Ajuda a escrever codigo, corrigir erro, depurar funcao em python e programacao.
gatilhos: []
etapa: decisao
prioridade: 1
---
Corpo de teste da skill de código.
`
  );
  const dirEmbutidas = path.join(os.tmpdir(), `augpt-skills-embutidas-vazia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dirEmbutidas, { recursive: true });
  return new Skills({ dirEmbutidas, dirUsuario });
}

/**
 * Três skills sintéticas pra testar `reforcarObjetivo` (Item 2 da rodada de
 * 2026-09-22, ver comentário do parâmetro em `Skills.selecionar`) isolado do
 * catálogo real: "base" é `sempre: true` (sempre pontua, como "Pesquisa na
 * web"); "alvo-reforco" só pontua com o gatilho "tema amplo" (simula uma
 * skill que bateu no OBJETIVO mas não bate na subtarefa estreita); "vetada"
 * tem o MESMO gatilho de "alvo-reforco" mas também um `nao_use_para` — prova
 * que o reforço respeita o antigatilho contra o texto ATUAL, não repesca uma
 * skill vetada só por ela constar em `reforcarObjetivo`.
 */
function criarSkillsParaReforcoObjetivo() {
  const dirUsuario = path.join(os.tmpdir(), `augpt-skills-reforco-objetivo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(path.join(dirUsuario, 'base'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'base', 'SKILL.md'),
    '---\nnome: Base (sempre)\ndescricao: Sempre ativa, como Pesquisa na web.\ngatilhos: []\netapa: decisao\nprioridade: 1\nsempre: true\n---\nCorpo base.\n'
  );
  fs.mkdirSync(path.join(dirUsuario, 'alvo-reforco'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'alvo-reforco', 'SKILL.md'),
    '---\nnome: Alvo do reforço\ndescricao: Só pontua no objetivo amplo.\ngatilhos: [tema amplo]\netapa: decisao\nprioridade: 1\n---\nCorpo alvo.\n'
  );
  fs.mkdirSync(path.join(dirUsuario, 'vetada'), { recursive: true });
  fs.writeFileSync(
    path.join(dirUsuario, 'vetada', 'SKILL.md'),
    '---\nnome: Vetada pela subtarefa\ndescricao: Mesmo gatilho do alvo, mas vetada pra subtarefa de teste.\ngatilhos: [tema amplo]\nnao_use_para: [assunto proibido]\netapa: decisao\nprioridade: 1\n---\nCorpo vetada.\n'
  );
  const dirEmbutidas = path.join(os.tmpdir(), `augpt-skills-embutidas-vazia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dirEmbutidas, { recursive: true });
  return new Skills({ dirEmbutidas, dirUsuario });
}

module.exports = [
  {
    nome: 'skills: fallback semântico escolhe a skill certa quando nenhum gatilho bate',
    tipo: 'unidade',
    async executar() {
      const servidor = await subirServidorEmbedding();
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarSkillsSemanticas();
        const opcoes = { etapa: 'decisao', host, embedModel: 'nomic-embed-text' };

        const paraClima = await skills.selecionar('previsao do tempo: vai ter chuva e qual a temperatura', opcoes);
        const paraCodigo = await skills.selecionar('meu codigo tem erro, preciso depurar essa funcao em python', opcoes);

        return [
          (paraClima.length === 1 && paraClima[0].pasta === 'clima-semantico') ||
            `esperava só a skill de clima, obteve ${JSON.stringify(paraClima.map((s) => s.pasta))}`,
          (paraCodigo.length === 1 && paraCodigo[0].pasta === 'codigo-semantico') ||
            `esperava só a skill de código, obteve ${JSON.stringify(paraCodigo.map((s) => s.pasta))}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'skills: fallback semântico não força nada sem relação com nenhuma skill',
    tipo: 'unidade',
    async executar() {
      const servidor = await subirServidorEmbedding();
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarSkillsSemanticas();
        const nada = await skills.selecionar('quanto custa uma passagem de avião para a lua', {
          etapa: 'decisao',
          host,
          embedModel: 'nomic-embed-text',
        });
        return [nada.length === 0 || `esperava nenhuma skill, obteve ${JSON.stringify(nada.map((s) => s.pasta))}`];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'skills: sem embedModel configurado, fallback semântico simplesmente não roda',
    tipo: 'unidade',
    async executar() {
      const skills = criarSkillsSemanticas();
      // host de propósito inalcançável: se o fallback tentasse chamar a rede mesmo
      // assim, o teste ficaria lento/instável em vez de simplesmente falhar rápido
      const nada = await skills.selecionar('previsao do tempo: vai ter chuva e qual a temperatura', {
        etapa: 'decisao',
        host: 'http://127.0.0.1:1',
        embedModel: undefined,
      });
      return [nada.length === 0 || `esperava degradar sem embedModel, obteve ${JSON.stringify(nada.map((s) => s.pasta))}`];
    },
  },

  /* -------- recalibração do limiar (caso real: "Previsão do tempo" ativando em pedido de PUBG) -------- */

  {
    // Caso real de produção (log de 09/11, pós-v0.5.5): "Previsão do tempo"
    // ativou na redação de um pedido sobre PUBG/Unreal Engine 5, com gatilho
    // zerado (confirmado rodando pontuar() contra o texto de verdade) — só
    // pode ter vindo do fallback semântico com um cosseno "meio-termo", o
    // tipo de escore que o limiar antigo (0,55) deixava passar e o novo
    // (0,68) não. Vetores controlados: cosseno exato 0,60 entre pedido e a
    // única skill elegível — antes selecionava, agora não.
    nome: 'skills: fallback semântico não escolhe mais um escore "meio-termo" (0,60) — limiar subiu de 0,55 pra 0,68',
    tipo: 'unidade',
    async executar() {
      const pedido = 'De uma olhada pra mim em como vai ser o pubg na unreal engine 5';
      const descA = 'skill de teste com cosseno 0,60';
      const mapa = { [pedido]: [1, 0], [descA]: [0.6, 0.8] };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarDuasSkillsComDescricoes(descA, descA); // só uma "família" de descrição, sem competidor
        // remove a segunda skill pra isolar só o teste de limiar (sem entrar teste de margem aqui)
        skills.lista = skills.lista.filter((s) => s.pasta === 'skill-a');
        const r = await skills.selecionar(pedido, { etapa: 'redacao', host, embedModel: 'nomic-embed-text' });
        return [r.length === 0 || `esperava rejeitar escore 0,60 (abaixo do novo limiar 0,68), selecionou ${JSON.stringify(r.map((s) => s.pasta))}`];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'skills: fallback semântico não escolhe quando 1º e 2º colocados estão colados, mesmo os dois acima do limiar',
    tipo: 'unidade',
    async executar() {
      const pedido = 'pedido de teste pra margem semântica';
      const descA = 'skill de teste com cosseno 0,75';
      const descB = 'skill de teste com cosseno 0,71';
      const mapa = { [pedido]: [1, 0], [descA]: [0.75, 0.6614378277661477], [descB]: [0.71, 0.7042016756583301] };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarDuasSkillsComDescricoes(descA, descB);
        const r = await skills.selecionar(pedido, { etapa: 'redacao', host, embedModel: 'nomic-embed-text' });
        return [
          r.length === 0 ||
            `esperava rejeitar por falta de margem (0,75 vs 0,71 = 0,04 < 0,05), selecionou ${JSON.stringify(r.map((s) => s.pasta))}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    nome: 'skills: fallback semântico ainda escolhe um escore alto e isolado (limiar e margem não travam o caso bom)',
    tipo: 'unidade',
    async executar() {
      const pedido = 'pedido de teste pra confianca alta';
      const descA = 'skill de teste com cosseno 0,90';
      const descB = 'skill de teste com cosseno 0,30';
      const mapa = { [pedido]: [1, 0], [descA]: [0.9, 0.4358898943540673], [descB]: [0.3, 0.9539392014169457] };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarDuasSkillsComDescricoes(descA, descB);
        const r = await skills.selecionar(pedido, { etapa: 'redacao', host, embedModel: 'nomic-embed-text' });
        return [
          (r.length === 1 && r[0].pasta === 'skill-a') ||
            `esperava selecionar a skill de escore 0,90 (isolada), obteve ${JSON.stringify(r.map((s) => s.pasta))}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  /* -------- antigatilho também vale pro fallback semântico (v0.5.7) -------- */

  {
    // Antes desta correção, `nao_use_para` só zerava o escore de GATILHO
    // (`pontuar`) — `selecionarPorEmbedding` nunca olhava pra ele, então uma
    // skill podia ser escolhida pelo fallback semântico mesmo pra um pedido
    // que ela mesma declara não cobrir. Escore bem acima do limiar e isolado
    // (sem 2º colocado) — se o antigatilho não tivesse efeito aqui, seria
    // escolhida sem dúvida nenhuma.
    nome: 'skills: fallback semântico não escolhe uma skill cujo antigatilho bate no pedido, mesmo com escore alto e isolado',
    tipo: 'unidade',
    async executar() {
      const pedido = 'me ajuda com uma duvida sobre meu notebook';
      const desc = 'skill de teste com escore alto';
      const mapa = { [pedido]: [1, 0], [desc]: [0.95, 0.31224989991991995] };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarSkillComAntigatilho(desc, ['notebook']);
        const r = await skills.selecionar(pedido, { etapa: 'decisao', host, embedModel: 'nomic-embed-text' });
        return [
          r.length === 0 ||
            `esperava rejeitar por antigatilho ("notebook"), selecionou ${JSON.stringify(r.map((s) => s.pasta))}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  {
    // Caso real ao vivo (teste manual com o Ollama do Davi, v0.5.6): "Previsão
    // do tempo" ativou pra "Vale a pena eu trocar meu notebook atual por um
    // novo com mais RAM pra rodar modelos locais maiores?" — sem nenhum
    // gatilho de clima na frase. Usa a skill REAL (não uma sintética) porque
    // cobre as duas frentes da correção juntas: o `nao_use_para` novo no
    // SKILL.md da skill de verdade E o fallback semântico respeitando
    // antigatilho — se qualquer uma regredir, este teste falha.
    nome: 'skills: "Previsão do tempo" (skill real) não é escolhida pra pergunta de hardware/notebook, nem pelo fallback semântico',
    tipo: 'unidade',
    async executar() {
      const pedido = 'Vale a pena eu trocar meu notebook atual por um novo com mais RAM pra rodar modelos locais maiores?';
      const descPrevisao = 'Como obter e apresentar previsão meteorológica de uma cidade';
      const mapa = { [pedido]: [1, 0], [descPrevisao]: [0.95, 0.31224989991991995] };
      const servidor = await subirServidorEmbeddingControlado(mapa);
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const dirUsuarioVazio = path.join(os.tmpdir(), `augpt-skills-usuario-vazia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        fs.mkdirSync(dirUsuarioVazio, { recursive: true });
        const skills = new Skills({ dirEmbutidas: path.join(__dirname, '..', '..', 'skills'), dirUsuario: dirUsuarioVazio });
        // isola só a skill de clima: sem isso, o fallback precisaria de um vetor
        // mapeado pra descrição de CADA skill embutida (~20), e o teste ficaria
        // acoplado ao catálogo inteiro em vez de só à correção que ele cobre
        skills.lista = skills.lista.filter((s) => s.pasta === 'previsao-do-tempo');
        const r = await skills.selecionar(pedido, { etapa: 'decisao', host, embedModel: 'nomic-embed-text' });
        return [
          r.length === 0 ||
            `esperava rejeitar "Previsão do tempo" por antigatilho ("notebook"/"RAM"), selecionou ${JSON.stringify(r.map((s) => s.pasta))}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },

  /* -------- reforcoSemantico (Peça 2, nível de raciocínio "médio"+) -------- */

  {
    nome: 'skills: sem reforcoSemantico, gatilho batendo NÃO aciona o fallback semântico (comportamento de sempre)',
    tipo: 'unidade',
    async executar() {
      const servidor = await subirServidorEmbedding();
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarSkillsParaReforco();
        const pedido = 'vai ter chuva forte; meu codigo tem erro, preciso depurar essa funcao em python de programacao';
        const r = await skills.selecionar(pedido, { etapa: 'decisao', host, embedModel: 'nomic-embed-text' });
        return [
          (r.length === 1 && r[0].pasta === 'clima-gatilho') ||
            `esperava só a skill do gatilho, obteve ${JSON.stringify(r.map((s) => s.pasta))}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },
  {
    // Mesmo pedido do teste acima, mas com `reforcoSemantico: true` — a skill
    // sem gatilho nenhum (só pontua por embedding) deveria entrar como
    // REFORÇO, junto com a que já bateu por gatilho, sem deslocá-la.
    nome: 'skills: com reforcoSemantico, uma skill sem gatilho mas semanticamente forte entra JUNTO com a que bateu por gatilho',
    tipo: 'unidade',
    async executar() {
      const servidor = await subirServidorEmbedding();
      try {
        const host = `http://127.0.0.1:${servidor.address().port}`;
        const skills = criarSkillsParaReforco();
        const pedido = 'vai ter chuva forte; meu codigo tem erro, preciso depurar essa funcao em python de programacao';
        const r = await skills.selecionar(pedido, {
          etapa: 'decisao', host, embedModel: 'nomic-embed-text', reforcoSemantico: true,
        });
        const pastas = r.map((s) => s.pasta).sort();
        return [
          pastas.includes('clima-gatilho') || `perdeu a skill do gatilho, obteve ${JSON.stringify(pastas)}`,
          pastas.includes('codigo-semantico') ||
            `não reforçou com a skill semântica sem gatilho, obteve ${JSON.stringify(pastas)}`,
          pastas.length === 2 || `esperava exatamente as duas, obteve ${JSON.stringify(pastas)}`,
        ];
      } finally {
        servidor.close();
      }
    },
  },
  {
    nome: 'skills: reforcoSemantico sem embedModel configurado simplesmente não reforça nada (degrada como o resto do fallback)',
    tipo: 'unidade',
    async executar() {
      const skills = criarSkillsParaReforco();
      const pedido = 'vai ter chuva forte; meu codigo tem erro, preciso depurar essa funcao em python de programacao';
      const r = await skills.selecionar(pedido, {
        etapa: 'decisao', host: 'http://127.0.0.1:1', embedModel: undefined, reforcoSemantico: true,
      });
      return [
        (r.length === 1 && r[0].pasta === 'clima-gatilho') ||
          `sem embedModel deveria só manter o gatilho, obteve ${JSON.stringify(r.map((s) => s.pasta))}`,
      ];
    },
  },

  /* -------- reforcarObjetivo (Item 2 da rodada de 2026-09-22) -------- */

  {
    nome: 'skills: reforcarObjetivo resgata skill sem gatilho na subtarefa, mas respeita o antigatilho contra o texto atual',
    tipo: 'unidade',
    async executar() {
      const skills = criarSkillsParaReforcoObjetivo();
      const alvo = skills.lista.find((s) => s.pasta === 'alvo-reforco');
      const vetada = skills.lista.find((s) => s.pasta === 'vetada');

      // texto da subtarefa: não repete "tema amplo" (nenhum gatilho bate) e
      // menciona "assunto proibido" (aciona o nao_use_para de "vetada").
      const subtarefa = 'cuidar do assunto proibido agora';

      const semReforco = await skills.selecionar(subtarefa, { etapa: 'decisao' });
      const comReforco = await skills.selecionar(subtarefa, {
        etapa: 'decisao',
        reforcarObjetivo: [alvo.id, vetada.id],
      });
      const pastasSemReforco = semReforco.map((s) => s.pasta).sort();
      const pastasComReforco = comReforco.map((s) => s.pasta).sort();

      return [
        (pastasSemReforco.length === 1 && pastasSemReforco[0] === 'base') ||
          `sem reforcarObjetivo deveria sobrar só "base", obteve ${JSON.stringify(pastasSemReforco)}`,
        pastasComReforco.includes('alvo-reforco') ||
          `reforcarObjetivo deveria resgatar "alvo-reforco", obteve ${JSON.stringify(pastasComReforco)}`,
        !pastasComReforco.includes('vetada') ||
          `"vetada" tem antigatilho batendo no texto atual — reforcarObjetivo não deveria repescá-la, obteve ${JSON.stringify(pastasComReforco)}`,
        pastasComReforco.length === 2 ||
          `esperava exatamente "base" + "alvo-reforco", obteve ${JSON.stringify(pastasComReforco)}`,
      ];
    },
  },
  {
    nome: 'skills: reforcarObjetivo não duplica uma skill que já foi escolhida por gatilho na própria subtarefa',
    tipo: 'unidade',
    async executar() {
      const skills = criarSkillsParaReforcoObjetivo();
      const alvo = skills.lista.find((s) => s.pasta === 'alvo-reforco');

      // agora a subtarefa BATE o gatilho de "alvo-reforco" sozinha
      const subtarefa = 'um pedido sobre tema amplo, de verdade';
      const r = await skills.selecionar(subtarefa, { etapa: 'decisao', reforcarObjetivo: [alvo.id] });
      const pastas = r.map((s) => s.pasta);

      return [
        pastas.filter((p) => p === 'alvo-reforco').length === 1 ||
          `"alvo-reforco" não deveria aparecer duplicada, obteve ${JSON.stringify(pastas)}`,
      ];
    },
  },
];
