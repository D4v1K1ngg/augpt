'use strict';

/**
 * Casos de unidade pra src/config.js — nível de raciocínio unificado (Peça 1,
 * pedido do Davi 2026-09-19): `derivarConfigDoNivel()` pros 4 níveis, e a
 * migração de config salvo antigo (só `profundidadePesquisa`, sem
 * `nivelRaciocinio`) feita em `Config.load()`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Config, derivarConfigDoNivel } = require('../../src/config');

/** Cria uma pasta temporária isolada por teste, devolve { dir, limpar() }. */
function pastaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-config-teste-'));
  return {
    dir,
    limpar() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = [
  {
    nome: 'config: derivarConfigDoNivel("leve") reproduz o comportamento de hoje',
    tipo: 'unidade',
    executar() {
      const d = derivarConfigDoNivel('leve');
      return [
        d.profundidadePesquisa === 'normal' || `esperava normal, veio ${d.profundidadePesquisa}`,
        d.pipelineForcadoUniversal === false || 'leve não deveria forçar o pipeline',
        d.reselecaoDeSkill === 'deterministica' || `reselecaoDeSkill inesperado: ${d.reselecaoDeSkill}`,
        d.criticaAutomaticaPorEtapaMax === 12 || `esperava o teto de hoje (12), veio ${d.criticaAutomaticaPorEtapaMax}`,
      ];
    },
  },
  {
    nome: 'config: derivarConfigDoNivel("medio") liga pipeline forçado e reforço Nomic',
    tipo: 'unidade',
    executar() {
      const d = derivarConfigDoNivel('medio');
      return [
        d.profundidadePesquisa === 'media' || `esperava media, veio ${d.profundidadePesquisa}`,
        d.pipelineForcadoUniversal === true || 'medio deveria forçar o pipeline',
        d.reselecaoDeSkill === 'reforcoNomic' || `reselecaoDeSkill inesperado: ${d.reselecaoDeSkill}`,
        d.criticaAutomaticaPorEtapaMax === 12 || `medio ainda usa o teto padrão, veio ${d.criticaAutomaticaPorEtapaMax}`,
      ];
    },
  },
  {
    nome: 'config: derivarConfigDoNivel("alto") vai pra busca alta, reseleção via crítico e teto de checkpoint maior',
    tipo: 'unidade',
    executar() {
      const d = derivarConfigDoNivel('alto');
      return [
        d.profundidadePesquisa === 'alta' || `esperava alta, veio ${d.profundidadePesquisa}`,
        d.pipelineForcadoUniversal === true || 'alto deveria forçar o pipeline',
        d.reselecaoDeSkill === 'criticoParteConcluida' || `reselecaoDeSkill inesperado: ${d.reselecaoDeSkill}`,
        d.criticaAutomaticaPorEtapaMax === 18 || `esperava teto 18, veio ${d.criticaAutomaticaPorEtapaMax}`,
      ];
    },
  },
  {
    nome: 'config: derivarConfigDoNivel("extremo") vai pra deliberação dedicada e o maior teto de checkpoint',
    tipo: 'unidade',
    executar() {
      const d = derivarConfigDoNivel('extremo');
      return [
        d.profundidadePesquisa === 'alta' || `esperava alta, veio ${d.profundidadePesquisa}`,
        d.pipelineForcadoUniversal === true || 'extremo deveria forçar o pipeline',
        d.reselecaoDeSkill === 'deliberacaoDedicada' || `reselecaoDeSkill inesperado: ${d.reselecaoDeSkill}`,
        d.criticaAutomaticaPorEtapaMax === 24 || `esperava teto 24 (o maior de todos), veio ${d.criticaAutomaticaPorEtapaMax}`,
        d.criticaAutomaticaPorEtapaMax > derivarConfigDoNivel('alto').criticaAutomaticaPorEtapaMax ||
          'extremo deveria ter um teto estritamente maior que alto',
      ];
    },
  },
  {
    nome: 'config: derivarConfigDoNivel com valor desconhecido cai pra "leve" (nunca quebra)',
    tipo: 'unidade',
    executar() {
      const d = derivarConfigDoNivel('nivel-que-nao-existe');
      return [d.profundidadePesquisa === 'normal' || 'valor desconhecido deveria cair pro padrão de "leve"'];
    },
  },
  {
    nome: 'config: primeira execução (sem config salvo) usa nivelRaciocinio "leve" por padrão',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        const cfg = new Config(dir);
        return [
          cfg.data.nivelRaciocinio === 'leve' || `esperava leve, veio ${cfg.data.nivelRaciocinio}`,
          cfg.data.profundidadePesquisa === 'normal' || 'primeira execução deveria manter profundidadePesquisa normal',
        ];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: migração — config salvo só com profundidadePesquisa "normal" vira nivelRaciocinio "leve"',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ profundidadePesquisa: 'normal' }), 'utf8');
        const cfg = new Config(dir);
        return [cfg.data.nivelRaciocinio === 'leve' || `migração de "normal" falhou: veio ${cfg.data.nivelRaciocinio}`];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: migração — config salvo só com profundidadePesquisa "media" vira nivelRaciocinio "medio"',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ profundidadePesquisa: 'media' }), 'utf8');
        const cfg = new Config(dir);
        return [cfg.data.nivelRaciocinio === 'medio' || `migração de "media" falhou: veio ${cfg.data.nivelRaciocinio}`];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: migração — config salvo só com profundidadePesquisa "alta" vira nivelRaciocinio "alto" (nunca "extremo")',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ profundidadePesquisa: 'alta' }), 'utf8');
        const cfg = new Config(dir);
        return [cfg.data.nivelRaciocinio === 'alto' || `migração de "alta" falhou: veio ${cfg.data.nivelRaciocinio}`];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: se o arquivo salvo já tem nivelRaciocinio, a migração não sobrescreve',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        // profundidadePesquisa "alta" migraria pra "alto" — mas como
        // nivelRaciocinio já está salvo como "extremo" (escolha explícita
        // do usuário), a migração precisa respeitar e não pisar em cima.
        fs.writeFileSync(
          path.join(dir, 'config.json'),
          JSON.stringify({ profundidadePesquisa: 'alta', nivelRaciocinio: 'extremo' }),
          'utf8'
        );
        const cfg = new Config(dir);
        return [cfg.data.nivelRaciocinio === 'extremo' || `não deveria ter sobrescrito: veio ${cfg.data.nivelRaciocinio}`];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: save() com nivelRaciocinio novo já deriva profundidadePesquisa/pipelineForcadoUniversal na mesma chamada',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        const cfg = new Config(dir);
        cfg.save({ nivelRaciocinio: 'alto' });
        return [
          cfg.data.profundidadePesquisa === 'alta' || `save() não derivou profundidadePesquisa: veio ${cfg.data.profundidadePesquisa}`,
          cfg.data.pipelineForcadoUniversal === true || 'save() não derivou pipelineForcadoUniversal',
        ];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: tentar setar profundidadePesquisa direto (sem mexer no nível) é sobrescrito pelo nível salvo',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        const cfg = new Config(dir);
        cfg.save({ nivelRaciocinio: 'leve' });
        // Alguém (UI antiga, chamada manual) tenta setar profundidadePesquisa
        // direto sem passar pelo nível — aplicarNivelRaciocinio() precisa
        // reverter pro valor derivado de "leve" (normal), não deixar o
        // campo "solto" fora de sincronia com o nível escolhido.
        cfg.save({ profundidadePesquisa: 'alta' });
        return [
          cfg.data.profundidadePesquisa === 'normal' ||
            `campo derivado deveria ter sido restaurado pro nível "leve": veio ${cfg.data.profundidadePesquisa}`,
        ];
      } finally {
        limpar();
      }
    },
  },
  {
    nome: 'config: save() persiste em disco e uma nova instância recarrega o mesmo nivelRaciocinio',
    tipo: 'unidade',
    executar() {
      const { dir, limpar } = pastaTemporaria();
      try {
        const cfg1 = new Config(dir);
        cfg1.save({ nivelRaciocinio: 'medio' });
        const cfg2 = new Config(dir);
        return [cfg2.data.nivelRaciocinio === 'medio' || `não recarregou do disco: veio ${cfg2.data.nivelRaciocinio}`];
      } finally {
        limpar();
      }
    },
  },
];
