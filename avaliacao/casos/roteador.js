'use strict';

/**
 * Roteador híbrido (2026-10-10): regra de código + modelo de decisão (Tev1).
 * Ver src/agent/roteador.js. Os casos usam um decisor falso — a bancada não
 * depende do Ollama real nem do Tev1 instalado.
 */

const fs = require('fs');
const path = require('path');
const ollama = require('../../src/llm/ollama');
const { decidirRota, combinar } = require('../../src/agent/roteador');
const { tipoDoPedido } = require('../../src/agent/tipo-de-pedido');
const mp = require('../../src/agent/motor-pesquisa');
const { executarCasoAgente } = require('../motor');

const TCP = 'O que é o protocolo TCP three-way handshake? Qual a diferença entre um switch e um roteador?';
const TESLA = 'Me conte quem foi nicola tesla e quais foram as invenções mais importantes que ele criou ?';
const ligado = { roteadorDecisor: true, modeloDecisor: 'tev1', limiarDecisor: 0.6 };
const decisorQueDiz = (valor, confidence) => async () => ({ rota: { choice: valor, confidence, probabilities: { [valor]: confidence } } });

module.exports = [
  {
    nome: 'roteador: com confiança ≥ limite o decisor troca a rota da regra (TCP: regra dizia produto, vira explicação)',
    tipo: 'unidade',
    async executar() {
      const regra = tipoDoPedido(TCP).tipo;
      const r = await decidirRota(TCP, { config: ligado, decidir: decisorQueDiz('explicacao', 0.9) });
      return [
        regra === 'produto' || `cenário: a regra deveria errar este pedido (deu ${regra})`,
        r.tipo === 'explicacao' || `tipo: ${r.tipo}`,
        r.fonte === 'decisor' || `fonte: ${r.fonte}`,
        r.tipoDaRegra === 'produto' || `tipoDaRegra: ${r.tipoDaRegra}`,
        mp.ehPedidoDeRecomendacao(TCP) === true || 'sem rota, o motor continua achando que é recomendação (comportamento antigo)',
        mp.ehPedidoDeRecomendacao(TCP, { rota: r }) === false || 'com a rota do decisor, explicação não abre o motor de produto',
      ];
    },
  },
  {
    nome: 'roteador: confiança abaixo do limite fica com a regra; decisor desligado nem é chamado',
    tipo: 'unidade',
    async executar() {
      const baixa = await decidirRota(TESLA, { config: ligado, decidir: decisorQueDiz('explicacao', 0.4) });
      let chamou = false;
      const desligado = await decidirRota(TESLA, {
        config: { ...ligado, roteadorDecisor: false },
        decidir: async () => {
          chamou = true;
          return {};
        },
      });
      return [
        baixa.tipo === tipoDoPedido(TESLA).tipo || `confiança 0,4 trocou a rota: ${baixa.tipo}`,
        baixa.fonte === 'regra' || `fonte: ${baixa.fonte}`,
        baixa.decisor?.confianca === 0.4 || 'a decisão ignorada continua registrada (para medir depois)',
        !chamou || 'desligado não pode chamar o modelo',
        desligado.fonte === 'regra' || `fonte: ${desligado.fonte}`,
      ];
    },
  },
  {
    nome: 'roteador: arquivo (local) e site com endereço nunca são trocados pelo modelo; "site" do modelo sem endereço é ignorado',
    tipo: 'unidade',
    async executar() {
      const local = 'leia o contrato.pdf da pasta de trabalho e me diga as multas';
      const site = 'entre em https://loja.exemplo.com com meu login e clique em rastrear pedido';
      let chamadas = 0;
      const contar = async () => {
        chamadas += 1;
        return { rota: { choice: 'produto', confidence: 0.99 } };
      };
      const rLocal = await decidirRota(local, { config: ligado, decidir: contar });
      const rSite = await decidirRota(site, { config: ligado, decidir: contar });
      const rSiteDoModelo = combinar({ tipo: 'livre', motivo: 'x' }, { valor: 'site', confianca: 0.99 });
      return [
        rLocal.tipo === 'local' || `local: ${rLocal.tipo}`,
        rSite.tipo === 'site' || `site: ${rSite.tipo}`,
        chamadas === 0 || `regra exata não deveria gastar chamada ao modelo (${chamadas})`,
        rSiteDoModelo.tipo === 'livre' || `"site" do modelo sem endereço: ${rSiteDoModelo.tipo}`,
      ];
    },
  },
  {
    nome: 'roteador: erro ou demora do modelo de decisão cai na regra, com o motivo guardado; interrupção do usuário propaga',
    tipo: 'unidade',
    async executar() {
      const r = await decidirRota(TESLA, {
        config: ligado,
        decidir: async () => {
          throw new Error('Ollama 404: model "tev1" not found');
        },
      });
      const ctrl = new AbortController();
      ctrl.abort(new Error('interrompido'));
      let propagou = false;
      try {
        await decidirRota(TESLA, {
          config: ligado,
          signal: ctrl.signal,
          decidir: async () => {
            throw new Error('interrompido');
          },
        });
      } catch {
        propagou = true;
      }
      return [
        r.fonte === 'regra' || `fonte: ${r.fonte}`,
        /not found/.test(r.falhaDoDecisor || '') || `falhaDoDecisor: ${r.falhaDoDecisor}`,
        propagou || 'interrupção pelo usuário não pode virar "cai na regra e segue"',
      ];
    },
  },
  {
    nome: 'roteador: modoDaPesquisa com rota do decisor — produto vira recomendação, guia vira guia, tarefa sai do motor; rota da regra não muda nada',
    tipo: 'unidade',
    executar() {
      const p = 'Fale sobre o Simgot EM6L para jogar';
      const doDecisor = (tipo) => ({ tipo, fonte: 'decisor' });
      const recomendacao = 'Quais os melhores fones intra-auriculares para jogar PUBG no PC?';
      return [
        mp.modoDaPesquisa(p, { rota: doDecisor('produto') }) === 'recomendacao' || 'produto do decisor → recomendação',
        mp.modoDaPesquisa(p, { rota: doDecisor('guia') }) === 'guia' || 'guia do decisor → guia',
        mp.modoDaPesquisa(recomendacao, { rota: doDecisor('livre') }) === null || 'tarefa do decisor tira do motor',
        mp.modoDaPesquisa(recomendacao, { rota: { tipo: 'produto', fonte: 'regra' } }) === mp.modoDaPesquisa(recomendacao) || 'rota da regra = comportamento de sempre',
      ];
    },
  },
  {
    nome: 'roteador (pedidos reais de 08/10): a política escolhida acerta mais que as regras sozinhas nas decisões gravadas do tev1',
    tipo: 'unidade',
    executar() {
      // os pedidos reais e o resultado ficam fora do Git (avaliacao/decisores/.gitignore)
      const pasta = path.join(__dirname, '..', 'decisores');
      const arqResultado = fs.existsSync(pasta) && fs.readdirSync(pasta).filter((n) => /^resultado-.*\.json$/.test(n)).sort().pop();
      if (!arqResultado || !fs.existsSync(path.join(pasta, 'pedidos-reais.json'))) return [true];
      const resultado = JSON.parse(fs.readFileSync(path.join(pasta, arqResultado), 'utf8'));
      const linhas = resultado.detalhes?.tev1;
      if (!Array.isArray(linhas)) return [true];
      const pedidos = [path.join(pasta, 'pedidos-reais.json'), path.join(pasta, 'pedidos-extras.json')]
        .filter((f) => fs.existsSync(f))
        .flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
      const porId = new Map(pedidos.map((p) => [String(p.id), p]));
      const efetiva = (pedido, rota) => {
        const t = rota ? rota.tipo : tipoDoPedido(pedido).tipo;
        if (t === 'site' || t === 'explicacao') return t;
        const modo = mp.modoDaPesquisa(pedido, { rota });
        return modo === 'guia' ? 'guia' : modo ? 'produto' : 'tarefa';
      };
      let n = 0;
      let regras = 0;
      let hibrido = 0;
      for (const l of linhas) {
        const p = porId.get(String(l.id));
        if (!p || !l.decisao?.rota) continue;
        n += 1;
        regras += efetiva(p.pedido, null) === p.esperado.rota ? 1 : 0;
        hibrido += efetiva(p.pedido, combinar(tipoDoPedido(p.pedido), l.decisao.rota, { limite: 0.6 })) === p.esperado.rota ? 1 : 0;
      }
      if (!n) return [true];
      return [hibrido / n >= regras / n + 0.08 || `híbrido ${(100 * hibrido / n).toFixed(1)}% × regras ${(100 * regras / n).toFixed(1)}% (${n} pedidos)`];
    },
  },
  {
    nome: 'roteador (ponta a ponta): decisor diz explicação no pedido do TCP — o motor de produto não roda e o registro guarda quem decidiu',
    tipo: 'unidade',
    async executar() {
      const original = ollama.decidir;
      ollama.decidir = decisorQueDiz('explicacao', 0.92);
      try {
        const obtido = await executarCasoAgente({
          nome: 'roteador: tcp',
          pedido: TCP,
          config: { ...ligado, motorDePesquisa: true },
          roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'tcp' } }],
          redacao: 'Resposta de teste.',
        });
        const t = obtido.registro?.tipoDePedido || {};
        return [
          obtido.chamadasPlanoDePesquisa === 0 || `o motor de produto rodou (${obtido.chamadasPlanoDePesquisa} plano(s))`,
          t.tipo === 'explicacao' || `tipo no registro: ${JSON.stringify(t)}`,
          t.fonte === 'decisor' || `fonte no registro: ${t.fonte}`,
          t.tipoDaRegra === 'produto' || `tipoDaRegra no registro: ${t.tipoDaRegra}`,
        ];
      } finally {
        ollama.decidir = original;
      }
    },
  },
  {
    nome: 'roteador (ponta a ponta): Ollama sem /v1/systemone (servidor falso) — a execução segue com a regra e avisa uma vez',
    tipo: 'unidade',
    async executar() {
      const obtido = await executarCasoAgente({
        nome: 'roteador: sem decisor',
        pedido: TESLA,
        config: ligado,
        roteiro: [{ ferramenta: 'responder', argumentos: { foco: 'tesla' } }],
        redacao: 'Resposta de teste.',
      });
      const t = obtido.registro?.tipoDePedido || {};
      return [
        obtido.ok || `a execução deveria concluir: ${obtido.motivo}`,
        t.fonte === 'regra' || `fonte: ${t.fonte}`,
        Boolean(t.falhaDoDecisor) || 'o motivo da falha do decisor deveria ir pro registro',
        obtido.eventos.filter((e) => e === 'aviso').length >= 1 || 'deveria avisar que o decisor não respondeu',
      ];
    },
  },
  {
    nome: 'roteador em cascata (11/10): o modelo rápido decide sozinho quando tem confiança; sem confiança o principal é consultado; sem modelo rápido nada muda; rápido fora do ar não impede o principal',
    tipo: 'unidade',
    async executar() {
      const chamadas = [];
      const decidir = (respostas) => async ({ model }) => {
        chamadas.push(model);
        const r = respostas[model];
        if (r instanceof Error) throw r;
        return { rota: { choice: r[0], confidence: r[1] } };
      };
      const cascata = { ...ligado, modeloDecisorRapido: 'tev1-0.8b-cpu' };
      const confiante = await decidirRota(TESLA, { config: cascata, decidir: decidir({ 'tev1-0.8b-cpu': ['explicacao', 0.93] }) });
      const soRapido = chamadas.join();
      chamadas.length = 0;
      const duvida = await decidirRota(TESLA, { config: cascata, decidir: decidir({ 'tev1-0.8b-cpu': ['tarefa', 0.41], tev1: ['explicacao', 0.9] }) });
      const osDois = chamadas.join();
      chamadas.length = 0;
      await decidirRota(TESLA, { config: ligado, decidir: decidir({ tev1: ['explicacao', 0.9] }) });
      const semRapido = chamadas.join();
      chamadas.length = 0;
      const caiu = await decidirRota(TESLA, { config: cascata, decidir: decidir({ 'tev1-0.8b-cpu': new Error('timeout'), tev1: ['explicacao', 0.9] }) });
      return [
        (soRapido === 'tev1-0.8b-cpu' && confiante.tipo === 'explicacao' && confiante.decisor.modelo === 'tev1-0.8b-cpu') || `rápido confiante: chamou ${soRapido}, tipo ${confiante.tipo}`,
        (osDois === 'tev1-0.8b-cpu,tev1' && duvida.tipo === 'explicacao' && duvida.decisor.modelo === 'tev1') || `rápido em dúvida: chamou ${osDois}, decidiu ${duvida.decisor?.modelo}`,
        semRapido === 'tev1' || `sem modelo rápido: chamou ${semRapido}`,
        (caiu.tipo === 'explicacao' && !caiu.falhaDoDecisor) || `rápido fora do ar: ${JSON.stringify(caiu).slice(0, 120)}`,
      ];
    },
  },
];
