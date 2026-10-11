'use strict';

const fs = require('fs');
const path = require('path');
const { cosine, vetorDe } = require('./embeddings');

/**
 * Memória operacional.
 *
 * A memória vetorial guarda O QUE foi dito. Esta guarda COMO as coisas
 * funcionam: que site precisa de JavaScript, que provedor de busca anda
 * falhando, que formato pede qual ferramenta, o que o usuário prefere.
 *
 * É o que faz o agente melhorar com o uso em vez de recomeçar do zero toda vez.
 * Fica na pasta de trabalho, ao lado da memória vetorial, e é um JSON legível.
 */

const TIPOS = {
  site: 'Sites',
  fonte: 'Provedores de busca',
  ferramenta: 'Ferramentas',
  preferencia: 'Preferências do usuário',
  estrategia: 'Estratégias de tarefa',
  credibilidade: 'Credibilidade de domínio (aprendida)',
};

const LIMITE = 120;
const MINIMO_PARA_CONFIAR = 2; // uma ocorrência pode ser acaso

// Criação automática de skills (item 5): quantas tarefas sem skill nenhuma
// cobrindo precisam se acumular, e o quão parecidas (cosseno do embedding do
// objetivo) precisam ser entre si, antes de sequer propor um rascunho.
// Decisão confirmada (10/09): começar conservador — mais fácil afrouxar depois
// com casos reais do que reconquistar confiança depois de sugestões ruins.
const MIN_CLUSTER = 5;
const LIMIAR_CLUSTER = 0.85;
const LIMITE_CANDIDATAS = 50;

/**
 * `estrategia` não passa por este portão: não vem de um padrão detectado por
 * regex (que pode ser coincidência), vem de uma reflexão deliberada do próprio
 * modelo ao final da tarefa — já é, por natureza, uma segunda ocorrência de
 * julgamento. Exigir repetição aqui só atrasaria a lição em uma execução à toa.
 */
const minimoPara = (tipo) => (tipo === 'estrategia' ? 1 : MINIMO_PARA_CONFIAR);

/**
 * Item 2 do consenso com o Davi sobre o documento de arquitetura (2026-09-21):
 * a memória operacional já tinha um contador de confiança (`vezes`) pros
 * tipos gerais (site/ferramenta/estratégia/preferência), mas uma lição NOVA
 * que contradiz uma já CONFIRMADA (`aprender()`, antes desta correção)
 * simplesmente apagava a antiga e recomeçava a contagem do zero, sem deixar
 * rastro — o site podia ter sido confirmado "precisa de JS" 5 vezes, uma
 * mudança fazer a lição virar "não precisa mais", e a próxima leitura
 * isolada já reconfiar nisso com o MESMO peso de uma primeira observação.
 * É o mesmo "esquecimento silencioso" que o documento aponta, só que na
 * memória operacional em vez do resumo de execução.
 *
 * A correção reaproveita a MESMA ideia que `credibilidade` já usa (saldo que
 * nunca é apagado por um evento isolado): quando uma lição CONFIRMADA é
 * contradita, a nova começa marcada (`contraditadoPor`) e precisa vencer uma
 * barra mais alta (`FATOR_RECONFIRMACAO_APOS_CONTRADICAO`× o normal) antes de
 * `saber()`/`paraPrompt()` voltarem a confiar nela — não é bloqueio
 * permanente, é só reconfirmação: uma lição contraditada que se repete o
 * suficiente vira "estável" de novo. Nenhuma tabela nova, nenhum grafo — só
 * mais um campo no mesmo item e uma barra que muda de altura.
 */
const FATOR_RECONFIRMACAO_APOS_CONTRADICAO = 2;

function limiarConfianca(item) {
  const base = minimoPara(item.tipo);
  return item.contraditadoPor ? base * FATOR_RECONFIRMACAO_APOS_CONTRADICAO : base;
}

/** `saber()`/`paraPrompt()`/`listar()` usam o MESMO critério — só ele muda de altura após uma contradição. */
function itemConfiavel(item) {
  return item.vezes >= limiarConfianca(item);
}

/** Estado de confiança de um item geral (não-credibilidade, que já tem o seu próprio conceito de saldo/risco). */
function estadoDoItem(item) {
  if (!item.contraditadoPor) return item.vezes >= minimoPara(item.tipo) ? 'confirmado' : 'não confirmado';
  return item.vezes >= limiarConfianca(item) ? 'estável (reconfirmada após contradição)' : 'contraditado — aguardando reconfirmação';
}

function dominioDe(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

class MemoriaOperacional {
  constructor(dir) {
    this.arquivo = path.join(dir, 'operacional.json');
    // Buffer separado (item 5): não reaproveita o formato licao/vezes de
    // `estrategia` porque ali uma lição nova SUBSTITUI a anterior na mesma
    // chave (ver `aprender()`) — aqui o que importa é justamente ACUMULAR
    // ocorrências parecidas até formar um padrão, não guardar só a última.
    this.arquivoCandidatas = path.join(dir, 'candidatas-skill.json');
    this.itens = [];
    this.candidatas = [];
    // Peça 4 (agrupamento de domínios por clustering, pedido do Davi
    // 2026-09-19): cache só-desta-instância (= só desta execução, já que
    // `new MemoriaOperacional()` é criado uma vez por `run()`) dos domínios
    // já testados contra os clusters — nunca escrito em disco, de propósito.
    // Evita pagar embedding de novo pro MESMO domínio "sem sinal" que aparece
    // em várias buscas dentro da mesma execução (decisão do Davi: "reativo,
    // com cache").
    this.clusterTentados = new Map();
    this.carregar();
    this.carregarCandidatas();
  }

  carregar() {
    try {
      this.itens = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
    } catch {
      this.itens = [];
    }
    return this.itens;
  }

  gravar() {
    try {
      fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
      fs.writeFileSync(this.arquivo, JSON.stringify(this.itens, null, 2), 'utf8');
    } catch {
      /* sem permissão de escrita: a memória apenas não persiste */
    }
  }

  /**
   * Registra uma observação. Repetir a mesma soma confiança em vez de duplicar
   * — e é a contagem que separa acaso de padrão.
   *
   * Ver `estadoDoItem`/`limiarConfianca` acima: uma lição DIFERENTE que
   * substitui uma já CONFIRMADA não apaga isso sem rastro — fica marcada
   * como contraditada, e passa a exigir reconfirmação em dobro antes de
   * `saber()`/`paraPrompt()` voltarem a confiar nela. Uma lição diferente
   * que substitui outra que AINDA NÃO tinha confiança (nunca chegou a
   * `minimoPara`) continua sendo troca simples — não havia nada firme pra
   * contradizer.
   *
   * `contraditadoPor`, uma vez marcado, NUNCA é apagado por uma repetição —
   * de propósito: apagar no primeiro reforço (`vezes` só bate o mínimo
   * NORMAL de novo) devolveria a barra à altura de antes da contradição
   * rápido demais, isto é, com a MESMA facilidade de uma lição que nunca
   * tinha sido contestada. A barra dobrada (`limiarConfianca`) já é o
   * suficiente pra decidir "confiável de novo" (vira "estável" — ver
   * `estadoDoItem`) — não precisa apagar a marca pra isso acontecer.
   */
  aprender({ tipo, chave, licao, peso = 1 }) {
    if (!TIPOS[tipo] || !chave || !licao) return null;

    const existente = this.itens.find((i) => i.tipo === tipo && i.chave === chave && i.licao === licao);
    if (existente) {
      existente.vezes += peso;
      existente.em = new Date().toISOString();
    } else {
      const anterior = this.itens.find((i) => i.tipo === tipo && i.chave === chave);
      const contradiz = anterior && anterior.vezes >= minimoPara(tipo);
      // uma lição nova sobre a mesma chave substitui a anterior daquele tipo
      this.itens = this.itens.filter((i) => !(i.tipo === tipo && i.chave === chave));
      const novo = { tipo, chave, licao, vezes: peso, em: new Date().toISOString() };
      if (contradiz) novo.contraditadoPor = anterior.licao.slice(0, 200);
      this.itens.push(novo);
    }

    if (this.itens.length > LIMITE) {
      this.itens.sort((a, b) => b.vezes - a.vezes || String(b.em).localeCompare(String(a.em)));
      this.itens = this.itens.slice(0, LIMITE);
    }
    this.gravar();
    return this.itens.find((i) => i.tipo === tipo && i.chave === chave);
  }

  /**
   * O que se sabe sobre uma chave específica, se já houver confiança. Uma
   * lição CONTRADITADA (ver `aprender()`) precisa vencer uma barra mais alta
   * (`itemConfiavel`) antes de valer de novo — não basta a mesma contagem
   * mínima de uma primeira observação.
   */
  saber(tipo, chave) {
    const item = this.itens.find((i) => i.tipo === tipo && i.chave === chave);
    return item && itemConfiavel(item) ? item : null;
  }

  /**
   * Reflexão pós-execução (Reflexion leve).
   *
   * A memória operacional já aprendia FATOS pontuais (site, ferramenta) sem
   * custo de chamada ao modelo. Isto aprende ESTRATÉGIA: uma frase de
   * autocrítica que o próprio agente escreve ao concluir uma tarefa, indexada
   * pelo tipo de tarefa (`chave`) para reaparecer numa tarefa parecida.
   *
   * É um `aprender` comum, só que sempre confiável (ver `minimoPara`) — a
   * substituição na mesma chave já existente é o comportamento desejado aqui:
   * a lição mais recente sobre "pesquisa na web", por exemplo, é a que vale.
   */
  refletir({ chave, licao }) {
    return this.aprender({ tipo: 'estrategia', chave: chave || 'geral', licao });
  }

  /** Estratégia conhecida para um site: 'render-js', 'leitor-externo' ou null. */
  estrategiaDeSite(url) {
    const dominio = dominioDe(url);
    if (!dominio) return null;
    const item = this.saber('site', dominio);
    return item?.estrategia || (item ? /javascript/i.test(item.licao) ? 'render-js' : null : null);
  }

  /**
   * Credibilidade de domínio é um SALDO (acertos - erros), não uma última
   * palavra que se sobrescreve — um domínio pode divergir uma vez e corroborar
   * outras três depois, e isso deve pesar mais que "a última coisa que
   * aconteceu". Método próprio em vez de `aprender()` porque o formato do
   * item é diferente do resto (licao/vezes único): aqui são dois contadores.
   */
  aprenderCredibilidade({ dominio, positivo, motivo }) {
    if (!dominio) return null;
    let item = this.itens.find((i) => i.tipo === 'credibilidade' && i.chave === dominio);
    if (!item) {
      item = { tipo: 'credibilidade', chave: dominio, acertos: 0, erros: 0, em: null };
      this.itens.push(item);
    }
    if (positivo) item.acertos += 1;
    else item.erros += 1;
    item.ultimoMotivo = motivo;
    item.em = new Date().toISOString();

    if (this.itens.length > LIMITE) {
      const pontuarLimite = (i) => (i.tipo === 'credibilidade' ? i.acertos + i.erros : i.vezes);
      this.itens.sort((a, b) => pontuarLimite(b) - pontuarLimite(a) || String(b.em).localeCompare(String(a.em)));
      this.itens = this.itens.slice(0, LIMITE);
    }
    this.gravar();
    return item;
  }

  /**
   * Domínios com sinal suficiente (acertos + erros >= mínimo) para influenciar
   * a fila de leitura da próxima pesquisa, no formato que
   * search.definirAprendidos() espera. Nunca na primeira ocorrência isolada —
   * um evento só pode ser a fonte única estando CERTA (ou errada) por acaso,
   * não o padrão. Saldo positivo reforça (risco 'confiavel', que
   * qualidadeDoDominio() em search.js já sabe premiar); saldo negativo
   * rebaixa ('medio'); saldo no meio (empate ou quase) ainda não diz nada
   * com confiança e fica de fora.
   */
  credibilidadeAprendida() {
    return this.itens
      .filter((i) => i.tipo === 'credibilidade' && i.acertos + i.erros >= minimoPara('credibilidade'))
      .map((i) => {
        const saldo = i.acertos - i.erros;
        const risco = saldo <= -2 ? 'medio' : saldo >= 2 ? 'confiavel' : null;
        return risco ? { dominio: i.chave, risco, motivo: i.ultimoMotivo } : null;
      })
      .filter(Boolean);
  }

  /**
   * Peça 4 do plano de nível de raciocínio (pedido do Davi 2026-09-19):
   * `credibilidadeAprendida()` acima só cobre domínio que JÁ tem sinal
   * próprio — um domínio nunca visto começa sempre do zero (cold start),
   * mesmo sendo parecido (mesma categoria, mesmo tipo de site) com outro que
   * o agente já aprendeu a desconfiar ou confiar. Isto reaproveita o MESMO
   * padrão de `formarCluster()` (cosseno + `LIMIAR_CLUSTER`) só que aplicado
   * a domínio: embedding do domínio + assunto atual comparado contra os
   * domínios que JÁ têm sinal próprio, e — se cair dentro do limiar de um
   * deles — herda METADE do saldo dele (nunca o saldo inteiro: é uma
   * suposição por semelhança, não uma observação direta deste domínio).
   *
   * Reativo por natureza (só dá pra calcular quando o domínio aparece, não
   * antes) e propositalmente CACHEADO por execução (decisão do Davi ao
   * revisar a troca de custo/latência: "reativo, com cache") — `this.
   * clusterTentados` nunca é gravado em disco, some quando a instância
   * termina, mas evita reembedar o MESMO domínio "sem sinal" várias vezes na
   * mesma execução (o caso comum: o mesmo domínio aparecendo em buscas
   * diferentes dentro de um único pedido). Fica de fora sozinho (retorna
   * null sem chamar embedding nenhum) sempre que: falta `embedModel`
   * configurado (mesma degradação graciosa do resto do embedding no
   * projeto), o domínio já tem sinal próprio (clustering não serve pra
   * nada aqui) ou não existe NENHUM domínio com sinal pra comparar ainda.
   */
  async credibilidadePorClustering({ dominio, assunto, host, embedModel }) {
    if (!embedModel || !dominio) return null;
    // Checagem direta em vez de `this.saber('credibilidade', dominio)`: `saber()`
    // compara `item.vezes` (contador genérico que credibilidade não usa — aqui é
    // acertos/erros), então sempre daria `undefined >= minimoPara(...)` = false e
    // NUNCA pularia o clustering pra um domínio que já tem sinal próprio de
    // verdade. Achado revisando este método antes de escrever os testes.
    const temSinalProprio = this.itens.some(
      (i) => i.tipo === 'credibilidade' && i.chave === dominio && i.acertos + i.erros >= minimoPara('credibilidade'),
    );
    if (temSinalProprio) return null;
    if (this.clusterTentados.has(dominio)) return this.clusterTentados.get(dominio);

    const resultado = await this._compararComClustersDeCredibilidade({ dominio, assunto, host, embedModel });
    this.clusterTentados.set(dominio, resultado);
    return resultado;
  }

  /** Núcleo de `credibilidadePorClustering()`, separado só pra manter o cache acima simples de ler. */
  async _compararComClustersDeCredibilidade({ dominio, assunto, host, embedModel }) {
    // Teto (mesmo espírito de LIMITE_CANDIDATAS em formarCluster): embedar
    // dezenas de domínios candidatos na primeira chamada, de uma vez, seria
    // caro demais — os mais recentes (fim do array, ver aprenderCredibilidade)
    // são também os mais prováveis de ainda estar em jogo no mesmo tipo de
    // pesquisa de hoje.
    const candidatos = this.itens
      .filter((i) => i.tipo === 'credibilidade' && i.chave !== dominio && i.acertos + i.erros >= minimoPara('credibilidade'))
      .slice(-30);
    if (!candidatos.length) return null;

    const vetorDominio = await vetorDe(`${dominio} ${assunto || ''}`.trim(), { host, embedModel });
    if (!vetorDominio) return null;

    let melhor = null;
    let melhorScore = 0;
    for (const candidato of candidatos) {
      // O vetor do CANDIDATO (não do domínio novo) fica cacheado no próprio
      // item e é gravado em disco — diferente de `clusterTentados` (que é só
      // desta execução), este vale pra sempre: o candidato já tem sinal
      // consolidado, seu embedding não muda de uma execução pra outra.
      // eslint-disable-next-line no-await-in-loop -- teto de 30 candidatos acima, e a maioria já vem cacheada em candidato.vec
      const vetorCandidato = candidato.vec || (await vetorDe(`${candidato.chave} ${candidato.ultimoMotivo || ''}`.trim(), { host, embedModel }));
      if (!vetorCandidato) continue;
      if (!candidato.vec) candidato.vec = vetorCandidato;
      const score = cosine(vetorDominio, vetorCandidato);
      if (score > melhorScore) {
        melhorScore = score;
        melhor = candidato;
      }
    }
    if (!melhor || melhorScore <= LIMIAR_CLUSTER) return null;

    const saldoOriginal = melhor.acertos - melhor.erros;
    const saldoHerdado = Math.trunc(saldoOriginal / 2);
    const risco = saldoHerdado <= -2 ? 'medio' : saldoHerdado >= 2 ? 'confiavel' : null;
    if (!risco) return null;

    this.gravar(); // persiste os vetores de candidato calculados agora (cache entre execuções)
    return {
      dominio,
      risco,
      motivo: `parecido com ${melhor.chave} (domínio nunca visto antes, herdando metade do saldo aprendido por semelhança)`,
      herdadoDe: melhor.chave,
    };
  }

  /** Bloco curto para o prompt de decisão, filtrado pelo que é relevante. */
  paraPrompt(objetivo = '', limite = 700) {
    const alvo = String(objetivo).toLowerCase();
    // itemConfiavel() (não mais só `vezes >= minimoPara`): uma lição
    // contraditada não volta a aparecer aqui com a MESMA facilidade de uma
    // primeira observação — precisa reconfirmar (ver `aprender()`/`saber()`).
    const confiaveis = this.itens.filter((i) => itemConfiavel(i));
    if (!confiaveis.length) return '';

    const pontuar = (i) => {
      let pontos = i.vezes;
      if (i.tipo === 'preferencia') pontos += 6; // preferência vale sempre
      if (i.tipo === 'estrategia') pontos += 4; // reflexão já é julgamento deliberado, não coincidência
      if (alvo.includes(String(i.chave).toLowerCase().slice(0, 12))) pontos += 8;
      return pontos;
    };

    const escolhidos = [...confiaveis].sort((a, b) => pontuar(b) - pontuar(a));
    const linhas = [];
    let total = 0;
    for (const item of escolhidos) {
      const linha = `- ${item.chave}: ${item.licao}`;
      if (total + linha.length > limite) break;
      linhas.push(linha);
      total += linha.length;
    }

    return linhas.length ? `\nO QUE VOCÊ JÁ APRENDEU NESTA PASTA DE TRABALHO:\n${linhas.join('\n')}\n` : '';
  }

  listar() {
    const pontuar = (i) => (i.tipo === 'credibilidade' ? i.acertos + i.erros : i.vezes);
    return [...this.itens]
      .sort((a, b) => a.tipo.localeCompare(b.tipo) || pontuar(b) - pontuar(a))
      .map((i) => {
        if (i.tipo === 'credibilidade') {
          const saldo = i.acertos - i.erros;
          return {
            ...i,
            confiavel: i.acertos + i.erros >= minimoPara('credibilidade') && Math.abs(saldo) >= 2,
            motivo: i.ultimoMotivo,
            // campos abaixo só existem para a lista genérica (que espera licao/vezes
            // de qualquer tipo) conseguir mostrar um item de credibilidade também
            licao:
              i.ultimoMotivo ||
              (saldo > 0
                ? 'mais vezes corroborou do que divergiu de outras fontes'
                : saldo < 0
                  ? 'mais vezes divergiu do que corroborou outras fontes'
                  : 'sinal ainda empatado entre acertos e erros'),
            vezes: i.acertos + i.erros,
            saldo,
            rotulo: TIPOS[i.tipo],
          };
        }
        return { ...i, confiavel: itemConfiavel(i), estado: estadoDoItem(i), rotulo: TIPOS[i.tipo] };
      });
  }

  esquecer(chave, tipo = null) {
    const antes = this.itens.length;
    this.itens = this.itens.filter((i) => !(i.chave === chave && (!tipo || i.tipo === tipo)));
    this.gravar();
    return antes - this.itens.length;
  }

  limpar() {
    const total = this.itens.length;
    this.itens = [];
    this.gravar();
    return total;
  }

  /* --------------------- criação automática de skills (item 5) --------------------- */

  carregarCandidatas() {
    try {
      this.candidatas = JSON.parse(fs.readFileSync(this.arquivoCandidatas, 'utf8'));
    } catch {
      this.candidatas = [];
    }
    return this.candidatas;
  }

  gravarCandidatas() {
    try {
      fs.mkdirSync(path.dirname(this.arquivoCandidatas), { recursive: true });
      fs.writeFileSync(this.arquivoCandidatas, JSON.stringify(this.candidatas, null, 2), 'utf8');
    } catch {
      /* sem permissão de escrita: só não persiste — não é motivo pra derrubar nada */
    }
  }

  /**
   * `refletir()` já classifica toda tarefa por `chave` (nome da skill que
   * cobriu, ou 'geral' quando nenhuma cobriu) sem custo extra — isto grava,
   * SÓ para o caso 'geral', o objetivo e o embedding dele num buffer próprio,
   * para `formarCluster()` mais tarde encontrar padrões repetidos.
   */
  registrarTarefaSemSkill({ objetivo, licao, vec }) {
    if (!objetivo || !Array.isArray(vec) || !vec.length) return null;
    const item = {
      objetivo: String(objetivo).slice(0, 300),
      licao: String(licao || '').slice(0, 240),
      vec,
      em: new Date().toISOString(),
      usadoEmSugestao: false,
    };
    this.candidatas.push(item);
    if (this.candidatas.length > LIMITE_CANDIDATAS) {
      this.candidatas = this.candidatas.slice(-LIMITE_CANDIDATAS);
    }
    this.gravarCandidatas();
    return item;
  }

  /**
   * Procura, entre as candidatas ainda não usadas em nenhuma sugestão, um
   * grupo de MIN_CLUSTER ou mais que sejam parecidas o bastante (cosseno >
   * LIMIAR_CLUSTER) com a mais recente. `chave === 'geral'` sozinho mistura
   * tarefas completamente diferentes; a comparação de embedding é o que
   * garante que só formam cluster pedidos que também são parecidos ENTRE SI.
   * Marca as usadas para não formarem outro cluster depois — cada candidata
   * conta para no máximo uma sugestão.
   */
  formarCluster({ minOcorrencias = MIN_CLUSTER, limiar = LIMIAR_CLUSTER } = {}) {
    const disponiveis = this.candidatas.filter((c) => !c.usadoEmSugestao && Array.isArray(c.vec) && c.vec.length);
    if (disponiveis.length < minOcorrencias) return null;

    const alvo = disponiveis[disponiveis.length - 1];
    const parecidas = disponiveis.filter((c) => c === alvo || cosine(c.vec, alvo.vec) > limiar);
    if (parecidas.length < minOcorrencias) return null;

    for (const c of parecidas) c.usadoEmSugestao = true;
    this.gravarCandidatas();
    return parecidas;
  }
}

/**
 * Traduz eventos da execução em lições. Fica separado da classe para que a
 * regra de "o que vale aprender" seja fácil de ler e de mudar.
 */
function observar(memoria, evento, dados) {
  if (evento === 'fonte') {
    if (dados.tipo === 'leitura' && dados.url) {
      const dominio = dominioDe(dados.url);
      if (!dominio) return;
      if (dados.provedor === 'render-js') {
        memoria.aprender({
          tipo: 'site', chave: dominio,
          licao: 'só entrega o conteúdo depois do JavaScript — vá direto para a renderização',
        });
      } else if (dados.provedor === 'leitor-externo') {
        memoria.aprender({
          tipo: 'site', chave: dominio,
          licao: 'bloqueia leitura direta; só funcionou pelo leitor externo',
        });
      } else if (dados.provedor === 'api-wikipedia') {
        memoria.aprender({ tipo: 'site', chave: dominio, licao: 'tem API própria, melhor que raspagem' });
      }
    }

    if (dados.tipo === 'busca' && dados.falhas?.length) {
      memoria.aprender({
        tipo: 'fonte', chave: 'cadeia de busca',
        licao: `${dados.provedor} respondeu depois de ${dados.falhas.length} provedor(es) falharem`,
      });
    }
  }

  // Confronto entre fontes (ver confronto.js, emitido em finalizarComResposta
  // no fim de cada execução). Uma divergência não significa que o domínio
  // isolado está errado — corroboração não é verdade, só é mais gente
  // dizendo a mesma coisa. Por isso isto é um SALDO (aprenderCredibilidade),
  // nunca um veredicto isolado: um evento não bloqueia nem acusa, e só passa
  // a valer a partir do mínimo de ocorrências somadas (minimoPara).
  if (evento === 'confronto') {
    if (Array.isArray(dados.divergencias)) {
      for (const d of dados.divergencias) {
        const dominio = d?.b?.dominios?.[0];
        if (!dominio) continue;
        memoria.aprenderCredibilidade({
          dominio,
          positivo: false,
          motivo: 'divergiu do valor corroborado por outra(s) fonte(s) em consulta(s) anterior(es) — não é veredicto, mas mereceu registro',
        });
      }
    }

    // O lado que faltava: um domínio do lado CORROBORADO de um valor confirmado
    // (2+ fontes concordando, ver confronto.confrontar()) também merece
    // registro — hoje só se aprendia a desconfiar, nunca a confiar mais.
    if (Array.isArray(dados.confirmados)) {
      for (const v of dados.confirmados) {
        for (const dominio of v?.dominios || []) {
          memoria.aprenderCredibilidade({
            dominio,
            positivo: true,
            motivo: 'corroborou um valor confirmado por outra(s) fonte(s) em consulta(s) anterior(es)',
          });
        }
      }
    }
  }

  if (evento === 'resultado' && dados.erro) {
    if (/não existe na pasta|Nomes parecidos/.test(dados.erro)) {
      memoria.aprender({
        tipo: 'ferramenta', chave: dados.nome,
        licao: 'copie o nome do arquivo exatamente de listar_arquivos antes de chamar',
      });
    }
    if (/formato binário|Salve como/.test(dados.erro)) {
      memoria.aprender({
        tipo: 'ferramenta', chave: dados.nome,
        licao: 'use ler_documento para formato binário em vez de ler_arquivo',
      });
    }
  }
}

module.exports = { MemoriaOperacional, observar, TIPOS, dominioDe, estadoDoItem, itemConfiavel };
