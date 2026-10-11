'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Histórico de conversas.
 *
 * Um arquivo JSON por conversa, em vez de um índice único: conversa corrompida
 * não derruba as outras, e dá para abrir, editar ou apagar no explorador.
 */

const LIMITE_MENSAGENS = 200;

function idNovo() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function tituloDe(mensagens) {
  const primeira = mensagens.find((m) => m.role === 'user')?.content || '';
  const limpo = String(primeira)
    .split('\n')
    .find((l) => l.trim() && !/^Arquivos anexados/i.test(l)) || 'Conversa';
  return limpo.trim().slice(0, 60) || 'Conversa';
}

class Conversas {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  caminho(id) {
    if (!/^[\w-]+$/.test(String(id))) throw new Error('identificador inválido');
    return path.join(this.dir, `${id}.json`);
  }

  /** Resumo de todas, ordenado da mais recente para a mais antiga. */
  listar() {
    let arquivos;
    try {
      arquivos = fs.readdirSync(this.dir).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }

    return arquivos
      .map((nome) => {
        try {
          const dados = JSON.parse(fs.readFileSync(path.join(this.dir, nome), 'utf8'));
          return {
            id: dados.id,
            modo: dados.modo === 'conversa' ? 'conversa' : 'agente',
            titulo: dados.titulo || tituloDe(dados.mensagens || []),
            criadoEm: dados.criadoEm,
            atualizadoEm: dados.atualizadoEm || dados.criadoEm,
            trocas: (dados.mensagens || []).filter((m) => m.role === 'user').length,
          };
        } catch {
          return null; // arquivo corrompido: some da lista, não quebra o app
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
  }

  ler(id) {
    try {
      return JSON.parse(fs.readFileSync(this.caminho(id), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Cria ou atualiza. Devolve a conversa gravada, já com id e título. */
  salvar({ id, modo = 'agente', titulo, mensagens = [] }) {
    const agora = new Date().toISOString();
    const identificador = id && /^[\w-]+$/.test(id) ? id : idNovo();
    const anterior = id ? this.ler(identificador) : null;

    const conversa = {
      id: identificador,
      modo,
      titulo: titulo || anterior?.titulo || tituloDe(mensagens),
      criadoEm: anterior?.criadoEm || agora,
      atualizadoEm: agora,
      mensagens: mensagens.slice(-LIMITE_MENSAGENS),
    };

    fs.writeFileSync(this.caminho(identificador), JSON.stringify(conversa, null, 2), 'utf8');
    return conversa;
  }

  /**
   * Grava o resumo acumulado da conversa (turnos mais antigos que já saíram
   * da janela dos últimos 6 — ver prompts.sistema()/loop.js run()), sem tocar
   * em mais nada do registro. Método dedicado, não uma chamada a `salvar()`,
   * porque `salvar()` teria que receber `mensagens` de novo (senão o default
   * `mensagens = []` apagaria o histórico da conversa) — aqui só os dois
   * campos do resumo mudam. Sem efeito numa conversa que ainda não existe em
   * disco (não há onde persistir; a próxima `salvar()` real cria o arquivo).
   */
  atualizarResumo(id, resumoConversa, resumoConversaTurnos) {
    const conversa = id ? this.ler(id) : null;
    if (!conversa) return null;
    conversa.resumoConversa = String(resumoConversa || '');
    conversa.resumoConversaTurnos = Number(resumoConversaTurnos) || 0;
    fs.writeFileSync(this.caminho(id), JSON.stringify(conversa, null, 2), 'utf8');
    return conversa;
  }

  /**
   * Grava o estado atual da `Tarefa` da execução em andamento nesta conversa
   * (pedido do Davi 2026-09-21, análise comparativa item 1 — "persistir
   * Tarefa por conversa", inspirado no `research_plan.md` do
   * web-ui/deep_research_agent.py: um checklist que sobrevive a reinício).
   * Mesmo padrão de `atualizarResumo()` — método dedicado, não `salvar()`
   * (que apagaria `mensagens` sem o argumento), só este campo muda. Sem
   * efeito numa conversa que ainda não existe em disco (agendamento sem
   * `idConversa`, ou primeiro turno antes do primeiro `chats:save`).
   */
  atualizarTarefa(id, tarefa) {
    const conversa = id ? this.ler(id) : null;
    if (!conversa) return null;
    conversa.tarefa = tarefa || null;
    fs.writeFileSync(this.caminho(id), JSON.stringify(conversa, null, 2), 'utf8');
    return conversa;
  }

  renomear(id, titulo) {
    const conversa = this.ler(id);
    if (!conversa) return null;
    conversa.titulo = String(titulo).trim().slice(0, 80) || conversa.titulo;
    conversa.atualizadoEm = new Date().toISOString();
    fs.writeFileSync(this.caminho(id), JSON.stringify(conversa, null, 2), 'utf8');
    return conversa;
  }

  excluir(id) {
    try {
      fs.unlinkSync(this.caminho(id));
      return true;
    } catch {
      return false;
    }
  }

  excluirVarias(ids = []) {
    return ids.filter((id) => this.excluir(id)).length;
  }

  /** Exporta em markdown, para o usuário guardar fora do app. */
  exportar(id) {
    const conversa = this.ler(id);
    if (!conversa) return null;
    const linhas = [
      `# ${conversa.titulo}`,
      '',
      `_${conversa.modo === 'conversa' ? 'Conversa' : 'Agente'} · ${new Date(conversa.criadoEm).toLocaleString('pt-BR')}_`,
      '',
    ];
    for (const m of conversa.mensagens) {
      linhas.push(m.role === 'user' ? '## Você' : '## Assistente', '', String(m.content).trim(), '');
    }
    return { nome: `${conversa.titulo.replace(/[^\w\sÀ-ÿ-]/g, '').trim() || 'conversa'}.md`, texto: linhas.join('\n') };
  }
}

module.exports = { Conversas, tituloDe };
