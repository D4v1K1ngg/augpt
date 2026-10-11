'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../../src/agent/loop');
const { Skills } = require('../../src/skills');
const { MemoriaOperacional } = require('../../src/agent/memoria-operacional');
const { servidorFalso, prepararPasta } = require('../motor');

/**
 * Criação automática de skills (item 5 do plano de melhorias). Três camadas
 * testadas separadamente, pelo mesmo motivo que o item 3 (fallback semântico)
 * já separou: o agrupamento por embedding é matemática pura (testável sem
 * rede), e o autoteste isolado (uma execução INTEIRA de Agent dentro de
 * outra) tem sua própria seção do plano — testar as duas camadas juntas, de
 * ponta a ponta, exigiria uma segunda instância de servidor falso só pra não
 * misturar o roteiro do autoteste com o da conversa que o disparou. Aqui:
 * (1) MemoriaOperacional.registrarTarefaSemSkill/formarCluster — clustering;
 * (2) Skills.criar/selecionar/aprovarSugestao — sugestão nunca compete sozinha;
 * (3) Agent.autotestarSkill — o contido: risco alto simulado, interativo
 *     respondido sozinho, autoavaliação passando e falhando;
 * (4) Agent.proporSkillFromCluster — a orquestração ponta a ponta dessas duas
 *     últimas peças (rascunho → autoteste → grava como sugestão).
 */

function vetorAleatorioPerto(base, ruido = 0.02) {
  return base.map((v) => v + (Math.random() - 0.5) * ruido);
}

function vetorAleatorio(tamanho = 8) {
  return Array.from({ length: tamanho }, () => Math.random() * 2 - 1);
}

function novaPastaTemp(prefixo) {
  const dir = path.join(os.tmpdir(), `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = [
  /* -------------------- (1) agrupamento por embedding -------------------- */

  {
    nome: 'skills automáticas: 5 tarefas parecidas sem skill formam cluster; menos que isso não forma',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-cluster-'));
      const memoria = new MemoriaOperacional(dir);
      const base = vetorAleatorio();

      for (let i = 0; i < 4; i += 1) {
        memoria.registrarTarefaSemSkill({ objetivo: `tarefa parecida ${i}`, licao: 'x', vec: vetorAleatorioPerto(base) });
      }
      const cedo = memoria.formarCluster();

      memoria.registrarTarefaSemSkill({ objetivo: 'tarefa parecida 5', licao: 'x', vec: vetorAleatorioPerto(base) });
      const cluster = memoria.formarCluster();

      return [
        cedo === null || `com só 4 ocorrências não deveria formar cluster ainda: ${JSON.stringify(cedo)}`,
        (cluster && cluster.length === 5) || `esperava cluster de 5, obteve ${JSON.stringify(cluster)}`,
      ];
    },
  },

  {
    nome: 'skills automáticas: objetivos sem relação semântica entre si não formam cluster mesmo com 5+',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-cluster-sem-relacao-'));
      const memoria = new MemoriaOperacional(dir);
      for (let i = 0; i < 5; i += 1) {
        memoria.registrarTarefaSemSkill({ objetivo: `tarefa sem relação ${i}`, licao: 'x', vec: vetorAleatorio() });
      }
      const cluster = memoria.formarCluster();
      return [cluster === null || `vetores sem relação não deveriam formar cluster: ${JSON.stringify(cluster)}`];
    },
  },

  {
    nome: 'skills automáticas: candidatas já usadas num cluster não formam outro depois',
    tipo: 'unidade',
    async executar() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-cluster-reuso-'));
      const memoria = new MemoriaOperacional(dir);
      const base = vetorAleatorio();
      for (let i = 0; i < 5; i += 1) {
        memoria.registrarTarefaSemSkill({ objetivo: `tarefa ${i}`, licao: 'x', vec: vetorAleatorioPerto(base) });
      }
      const primeiro = memoria.formarCluster();
      const segundoImediato = memoria.formarCluster();
      return [
        (primeiro && primeiro.length === 5) || 'esperava o primeiro cluster de 5',
        segundoImediato === null || `as mesmas 5 candidatas não deveriam formar um segundo cluster: ${JSON.stringify(segundoImediato)}`,
      ];
    },
  },

  /* -------------------- (2) Skills: sugestão nunca compete sozinha -------------------- */

  {
    nome: 'skills automáticas: criar() com rascunho grava sugerida/autotestada, e selecionar() nunca a escolhe',
    tipo: 'unidade',
    async executar() {
      const dirUsuario = novaPastaTemp('augpt-skills-sugerida');
      const dirEmbutidas = novaPastaTemp('augpt-skills-sugerida-embutidas-vazia');
      const skills = new Skills({ dirEmbutidas, dirUsuario });

      const criada = skills.criar('Skill Sugerida De Teste', {
        descricao: 'Sempre que o pedido mencionar exatamente esta skill de teste',
        gatilhos: ['skill sugerida de teste'],
        corpo: 'Método de teste.',
        sugerida: true,
        autotestada: true,
        autotesteResumo: 'passou no autoteste',
      });

      const carregada = skills.lista.find((s) => s.id === criada.id);
      // pedido que casaria em cheio pelo gatilho, se a skill não estivesse marcada como sugestão
      const selecao = await skills.selecionar('skill sugerida de teste', { etapa: 'decisao' });

      return [
        Boolean(carregada) || 'skill sugerida não foi carregada por recarregar()',
        carregada?.sugerida === true || 'sugerida:true não foi lido do frontmatter',
        carregada?.autotestada === true || 'autotestada:true não foi lido do frontmatter',
        selecao.every((s) => s.id !== criada.id) ||
          'uma skill sugerida (mesmo autotestada) nunca deveria ser escolhida numa seleção normal',
      ];
    },
  },

  {
    nome: 'skills automáticas: aprovarSugestao() faz a skill competir normalmente; descartarSugestao() apaga',
    tipo: 'unidade',
    async executar() {
      const dirUsuario = novaPastaTemp('augpt-skills-aprovacao');
      const dirEmbutidas = novaPastaTemp('augpt-skills-aprovacao-embutidas-vazia');
      const skills = new Skills({ dirEmbutidas, dirUsuario });

      const criada = skills.criar('Skill Para Aprovar', {
        descricao: 'Sempre que o pedido mencionar aprovar esta skill',
        gatilhos: ['aprovar esta skill'],
        corpo: 'Método de teste.',
        sugerida: true,
        autotestada: true,
      });

      skills.aprovarSugestao(criada.id);
      const depoisDeAprovar = await skills.selecionar('aprovar esta skill', { etapa: 'decisao' });

      const outra = skills.criar('Skill Para Descartar', {
        descricao: 'teste', gatilhos: ['descartar esta skill'], corpo: 'x', sugerida: true, autotestada: false,
      });
      skills.descartarSugestao(outra.id);
      const pastaAindaExiste = fs.existsSync(path.dirname(outra.caminho));

      return [
        depoisDeAprovar.some((s) => s.id === criada.id) || 'depois de aprovada, a skill deveria competir normalmente',
        !pastaAindaExiste || 'descartarSugestao() deveria ter apagado a pasta da skill',
      ];
    },
  },

  /* -------------------- (3) autoteste em modo contido -------------------- */

  {
    nome: 'skills automáticas: autoteste em modo contido nunca executa risco alto de verdade',
    tipo: 'unidade',
    async executar() {
      const workspace = prepararPasta('autoteste-risco-alto', { 'perigoso.txt': 'não me apague de verdade' });
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'apagar_arquivo', argumentos: { caminho: 'perigoso.txt' } },
          { ferramenta: 'responder', argumentos: { foco: 'concluído' } },
        ],
      });
      try {
        const skills = new Skills({
          dirEmbutidas: novaPastaTemp('augpt-autoteste-embutidas-vazia'),
          dirUsuario: novaPastaTemp('augpt-autoteste-usuario-vazia'),
        });
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`, model: 'falso', modelDecisao: '', modelRedacao: '',
            embedModel: 'nomic-embed-text', temperature: 0.3, numCtx: 8192, numPredict: 1024,
            numPredictResposta: 2048, maxIterations: 6, autonomy: 'auto', shellTimeoutMs: 8000, codeTimeoutMs: 8000,
            workspace, memoryTopK: 2, alwaysAllow: [], usarRotinas: false, criticaPeriodica: false,
            verificarAmbiguidade: false, criacaoAutomaticaDeSkills: false, skillsDesativadas: [], ferramentasDesativadas: [],
            permitirLeitorExterno: false, renderizarJs: false,
          },
          userDataPath: novaPastaTemp('augpt-autoteste-userdata'),
          skills,
        });

        const autoteste = await agente.autotestarSkill({
          rascunho: { nome: 'Apagar arquivo perigoso', descricao: 'teste', corpo: 'Apague o arquivo indicado.' },
          objetivoDeTeste: 'apague o arquivo perigoso.txt',
        });

        const arquivoAindaExiste = fs.existsSync(path.join(workspace, 'perigoso.txt'));

        return [
          arquivoAindaExiste || 'o autoteste apagou o arquivo de verdade — modo contido não conteve o risco alto',
          /não executado de verdade/i.test(autoteste.resumo) ||
            `o resumo do autoteste deveria registrar que o risco alto foi simulado: ${autoteste.resumo}`,
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'skills automáticas: autoteste responde sozinho a perguntar_usuario, sem travar',
    tipo: 'unidade',
    async executar() {
      const workspace = prepararPasta('autoteste-interativo', {});
      const falso = await servidorFalso({
        roteiro: [
          { ferramenta: 'perguntar_usuario', argumentos: { pergunta: 'qual arquivo?' } },
          { ferramenta: 'responder', argumentos: { foco: 'concluído' } },
        ],
      });
      try {
        const skills = new Skills({
          dirEmbutidas: novaPastaTemp('augpt-autoteste-interativo-embutidas'),
          dirUsuario: novaPastaTemp('augpt-autoteste-interativo-usuario'),
        });
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`, model: 'falso', modelDecisao: '', modelRedacao: '',
            embedModel: 'nomic-embed-text', temperature: 0.3, numCtx: 8192, numPredict: 1024,
            numPredictResposta: 2048, maxIterations: 6, autonomy: 'auto', shellTimeoutMs: 8000, codeTimeoutMs: 8000,
            workspace, memoryTopK: 2, alwaysAllow: [], usarRotinas: false, criticaPeriodica: false,
            verificarAmbiguidade: false, criacaoAutomaticaDeSkills: false, skillsDesativadas: [], ferramentasDesativadas: [],
            permitirLeitorExterno: false, renderizarJs: false,
          },
          userDataPath: novaPastaTemp('augpt-autoteste-interativo-userdata'),
          skills,
        });

        const inicio = Date.now();
        const autoteste = await agente.autotestarSkill({
          rascunho: { nome: 'Skill interativa', descricao: 'teste', corpo: 'Pergunte e responda.' },
          objetivoDeTeste: 'faça uma pergunta e conclua',
        });
        const duracao = Date.now() - inicio;

        return [
          duracao < 5000 || `autoteste com pergunta demorou demais (${duracao}ms) — pode ter travado esperando um humano`,
          typeof autoteste.passou === 'boolean' || 'autoteste deveria terminar com um veredito',
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  {
    nome: 'skills automáticas: autoavaliação "não passou" é respeitada no veredito do autoteste',
    tipo: 'unidade',
    async executar() {
      const workspace = prepararPasta('autoteste-reprovado', {});
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'concluído' } }],
        autoavaliacaoDeSkill: 'não passou: a skill conduziu a tarefa para o lugar errado',
      });
      try {
        const skills = new Skills({
          dirEmbutidas: novaPastaTemp('augpt-autoteste-reprovado-embutidas'),
          dirUsuario: novaPastaTemp('augpt-autoteste-reprovado-usuario'),
        });
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`, model: 'falso', modelDecisao: '', modelRedacao: '',
            embedModel: 'nomic-embed-text', temperature: 0.3, numCtx: 8192, numPredict: 1024,
            numPredictResposta: 2048, maxIterations: 6, autonomy: 'auto', shellTimeoutMs: 8000, codeTimeoutMs: 8000,
            workspace, memoryTopK: 2, alwaysAllow: [], usarRotinas: false, criticaPeriodica: false,
            verificarAmbiguidade: false, criacaoAutomaticaDeSkills: false, skillsDesativadas: [], ferramentasDesativadas: [],
            permitirLeitorExterno: false, renderizarJs: false,
          },
          userDataPath: novaPastaTemp('augpt-autoteste-reprovado-userdata'),
          skills,
        });

        const autoteste = await agente.autotestarSkill({
          rascunho: { nome: 'Skill que falha', descricao: 'teste', corpo: 'x' },
          objetivoDeTeste: 'tarefa de teste',
        });

        return [
          autoteste.passou === false || 'esperava passou:false quando a autoavaliação diz "não passou"',
          /lugar errado/.test(autoteste.motivo) || `esperava o motivo da reprovação no veredito: ${autoteste.motivo}`,
        ];
      } finally {
        await falso.fechar();
      }
    },
  },

  /* -------------------- (4) orquestração ponta a ponta -------------------- */

  {
    nome: 'skills automáticas: proporSkillFromCluster grava sugestão testada e emite skill-sugerida',
    tipo: 'unidade',
    async executar() {
      const workspace = prepararPasta('propor-skill-sucesso', {});
      const falso = await servidorFalso({
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'concluído' } }],
        rascunhoDeSkill: {
          nome: 'Resumo de nota fiscal',
          descricao: 'Sempre que o pedido for sobre resumir uma nota fiscal anexada',
          gatilhos: ['nota fiscal', 'resumir nota'],
          corpo: 'Leia o PDF anexado e liste valor total, data e emitente.',
        },
        autoavaliacaoDeSkill: 'passou: seguiu o método proposto e concluiu',
      });
      try {
        const dirUsuario = novaPastaTemp('augpt-propor-skill-usuario');
        const skills = new Skills({ dirEmbutidas: novaPastaTemp('augpt-propor-skill-embutidas-vazia'), dirUsuario });
        const agente = new Agent({
          config: {
            host: `http://127.0.0.1:${falso.porta}`, model: 'falso', modelDecisao: '', modelRedacao: '',
            embedModel: 'nomic-embed-text', temperature: 0.3, numCtx: 8192, numPredict: 1024,
            numPredictResposta: 2048, maxIterations: 6, autonomy: 'auto', shellTimeoutMs: 8000, codeTimeoutMs: 8000,
            workspace, memoryTopK: 2, alwaysAllow: [], usarRotinas: false, criticaPeriodica: false,
            verificarAmbiguidade: false, criacaoAutomaticaDeSkills: false, skillsDesativadas: [], ferramentasDesativadas: [],
            permitirLeitorExterno: false, renderizarJs: false,
          },
          userDataPath: novaPastaTemp('augpt-propor-skill-userdata'),
          skills,
        });

        let eventoRecebido = null;
        agente.on('skill-sugerida', (d) => {
          eventoRecebido = d;
        });

        const cluster = Array.from({ length: 5 }, (_, i) => ({ objetivo: `resuma a nota fiscal ${i}.pdf` }));
        const resultado = await agente.proporSkillFromCluster({ cluster });

        const bruto = fs.readFileSync(resultado.caminho, 'utf8');
        const naoCompeteAindaAgora = await skills.selecionar('resumir nota fiscal anexada', { etapa: 'decisao' });

        return [
          Boolean(resultado) || 'proporSkillFromCluster deveria retornar o resultado gravado',
          /sugerida:\s*true/.test(bruto) || 'SKILL.md gravado deveria ter sugerida: true',
          /autotestada:\s*true/.test(bruto) || `esperava autotestada: true (autoavaliação disse "passou"): ${bruto}`,
          Boolean(eventoRecebido) || 'evento skill-sugerida não foi emitido',
          eventoRecebido?.autoteste?.passou === true || 'evento deveria trazer o veredito do autoteste',
          naoCompeteAindaAgora.every((s) => s.pasta !== 'resumo-de-nota-fiscal') ||
            'a sugestão recém-criada não deveria competir numa seleção normal antes de aprovada',
        ];
      } finally {
        await falso.fechar();
      }
    },
  },
];
