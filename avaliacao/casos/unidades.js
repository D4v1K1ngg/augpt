'use strict';

/**
 * Casos de unidade: não passam pelo agente. Verificam os componentes que
 * quebraram no passado — leitores de formato, markdown, jail, cobertura.
 */

const path = require('path');
const fs = require('fs');
const { extrair } = require('../../src/formatos');
const { pdf, ascii85, pareceLegivel } = require('../../src/formatos/pdf');
const cripto = require('../../src/formatos/pdf-cripto');
const { Sandbox } = require('../../src/tools/sandbox');
const { Skills } = require('../../src/skills');
const tools = require('../../src/tools');
const { Registro, Registros } = require('../../src/registro');
const { EventEmitter } = require('events');

const fixture = (n) => path.join(__dirname, '..', 'fixtures', n);

/* markdown roda fora do navegador com um window falso */
function carregarMd() {
  const alvo = {};
  const fonte = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'md.js'), 'utf8');
  new Function('window', fonte.replace('})(window);', '})(window);'))(alvo);
  return alvo.md;
}

const TAGS_PERMITIDAS = new Set([
  'p', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'strong', 'em', 'del', 'code', 'pre',
  'blockquote', 'hr', 'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

module.exports = [
  {
    nome: 'docx: título, parágrafos e tabela',
    tipo: 'unidade',
    executar() {
      const r = extrair(fixture('relatorio.docx'));
      return [
        r.tipo === 'docx' || `tipo veio "${r.tipo}"`,
        r.texto.includes('## Relatório de Vendas') || 'título não virou cabeçalho markdown',
        r.texto.includes('| Região | Pedidos | Faturamento |') || 'tabela não foi extraída',
        r.texto.includes('R$ 482.900') || 'valor da tabela ausente',
      ];
    },
  },

  {
    nome: 'xlsx: abas, datas e fórmula sem célula vazia',
    tipo: 'unidade',
    executar() {
      const r = extrair(fixture('planilha.xlsx'));
      return [
        r.texto.includes('2026-08-12') || 'data ficou como número serial',
        r.texto.includes('## Aba: Pedidos') || 'nome da aba ausente',
        r.texto.includes('## Aba: Resumo') || 'segunda aba ausente',
        !/\|\s*\|\s*$/m.test(r.texto) || 'sobrou célula vazia no fim da linha',
      ];
    },
  },

  {
    nome: 'pptx: slides e nota no slide certo',
    tipo: 'unidade',
    executar() {
      const r = extrair(fixture('apresentacao.pptx'));
      const slide1 = r.texto.split('## Slide 2')[0];
      return [
        r.meta.slides === 2 || `contou ${r.meta.slides} slides`,
        r.texto.includes('> Notas:') || 'nota do slide não foi extraída',
        !slide1.includes('> Notas:') || 'nota foi parar no slide errado',
      ];
    },
  },

  {
    nome: 'pdf: cadeia de filtros ASCII85 + Flate',
    tipo: 'unidade',
    executar() {
      const r = pdf(fs.readFileSync(fixture('manual.pdf')));
      return [
        r.meta.via === 'nativo' || `extraiu via "${r.meta.via}" em vez de nativo`,
        r.meta.streams > 0 || 'nenhum stream foi descomprimido',
        r.texto.includes('Manual de Operação') || 'texto não foi extraído',
        r.texto.includes('Óleo') || 'acentuação perdida',
      ];
    },
  },

  {
    // Caso real (chat "Como funciona as ondas de radio frequencia", 2026-09-19):
    // um PDF acadêmico ("145_OBJETIVOS_INVESTIGACAO.pdf") tinha capa/resumo numa
    // fonte normal seguida de um corpo grande (82% do texto) numa fonte sem mapa
    // de codificação — embaralhado. `pareceLegivel` só amostrava os primeiros
    // 4000 caracteres, então aprovava o documento inteiro pela capa legível; o
    // corpo embaralhado foi parar direto no material coletado sem `meta.aviso`
    // nenhum, a destilação saiu fraca e manteve o lixo original, e a resposta
    // final ao Davi foi o próprio lixo (bytes de controle) "formatado" pelo
    // modelo. Esta fixture reproduz a mesma forma (>4000 chars legíveis no
    // início, corpo embaralhado depois) sem depender do PDF real.
    nome: 'pdf: pareceLegivel detecta capa legível + corpo embaralhado (amostra não pode olhar só o início)',
    tipo: 'unidade',
    executar() {
      const legivel =
        'Os objetivos de pesquisa definem o que o estudo pretende alcançar, com direção clara e etapas específicas. '.repeat(
          40
        );
      const embaralhado = '°+X@ 01Y 532765 4\'&##5! # \u0007\u0006\u0015\u0011#\u0001#\u0017\u001633\u0015!'.repeat(
        300
      );
      const misto = legivel.slice(0, 4200) + embaralhado; // capa > 4000 chars, corpo embaralhado é a maior parte
      return [
        pareceLegivel(misto) === false || 'não detectou o corpo embaralhado escondido atrás de uma capa legível',
        pareceLegivel(legivel.repeat(20)) === true || 'marcou documento normal e longo como ilegível (falso positivo)',
        pareceLegivel(embaralhado) === false || 'não detectou texto totalmente embaralhado (regressão do comportamento antigo)',
      ];
    },
  },

  {
    nome: 'pdf: primitivas de criptografia',
    tipo: 'unidade',
    executar() {
      const chave = Buffer.from('chave-de-teste');
      const claro = Buffer.from('Boleto com acentuação: R$ 410,49');
      const cifrado = cripto.rc4(chave, claro);
      const decifrado = cripto.rc4(chave, cifrado);
      const a85 = ascii85('87cURD]i,"Ebo80~>');
      return [
        !cifrado.equals(claro) || 'rc4 não alterou o conteúdo',
        decifrado.equals(claro) || 'rc4 não é reversível',
        a85.toString().includes('Hello') || `ascii85 decodificou como "${a85.toString()}"`,
      ];
    },
  },

  {
    nome: 'formato detectado por assinatura, não por extensão',
    tipo: 'unidade',
    executar() {
      const disfarcado = path.join(require('os').tmpdir(), 'augpt-disfarce.txt');
      fs.writeFileSync(disfarcado, fs.readFileSync(fixture('manual.pdf')));
      const r = extrair(disfarcado);
      fs.unlinkSync(disfarcado);
      return [r.tipo === 'pdf' || `PDF renomeado para .txt foi lido como "${r.tipo}"`];
    },
  },

  {
    nome: 'formatos antigos falham com instrução útil',
    tipo: 'unidade',
    executar() {
      const alvo = path.join(require('os').tmpdir(), 'augpt-antigo.doc');
      fs.writeFileSync(alvo, Buffer.from('d0cf11e0a1b11ae1', 'hex'));
      let mensagem = '';
      try {
        extrair(alvo);
      } catch (e) {
        mensagem = e.message;
      }
      fs.unlinkSync(alvo);
      return [mensagem.includes('Salve como .docx') || `mensagem pouco útil: "${mensagem}"`];
    },
  },

  {
    nome: 'markdown: tabela com linha em branco entre as linhas',
    tipo: 'unidade',
    executar() {
      const md = carregarMd();
      const saida = md.render('| Dia | Chuva |\n\n| --- | --- |\n\n| Qui | 30% |');
      return [
        saida.includes('<table>') || 'tabela não foi reconhecida',
        saida.includes('<td>30%</td>') || 'linha do corpo não entrou',
      ];
    },
  },

  {
    nome: 'markdown: nenhuma tag fora da lista branca',
    tipo: 'unidade',
    executar() {
      const md = carregarMd();
      const ataques = [
        '<img src=x onerror=alert(1)>',
        '[a](javascript:alert(1))',
        '<script>alert(2)</script>',
        '| <script>x</script> | b |\n|---|---|\n| c | d |',
      ];
      const problemas = [];
      for (const a of ataques) {
        for (const m of md.render(a).matchAll(/<\/?([a-z0-9-]+)/gi)) {
          if (!TAGS_PERMITIDAS.has(m[1].toLowerCase())) problemas.push(`<${m[1]}> escapou de "${a.slice(0, 24)}"`);
        }
        if (/href="(?!https?:)/.test(md.render(a))) problemas.push(`href perigoso em "${a.slice(0, 24)}"`);
      }
      return problemas.length ? problemas : [true];
    },
  },

  {
    nome: 'jail rejeita caminho para fora e resolve o de dentro',
    tipo: 'unidade',
    executar() {
      const sb = new Sandbox(path.join(require('os').tmpdir(), 'augpt-jail'));
      let bloqueou = false;
      try {
        sb.resolve('../../etc/passwd');
      } catch {
        bloqueou = true;
      }
      return [
        bloqueou || 'caminho com ../ não foi bloqueado',
        sb.resolve('sub/a.txt').startsWith(sb.root) || 'caminho interno resolveu fora da raiz',
      ];
    },
  },

  {
    nome: 'skills: seleção por gatilho e teto de caracteres',
    tipo: 'unidade',
    async executar() {
      const s = new Skills({
        dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
        dirUsuario: path.join(require('os').tmpdir(), 'augpt-skills-vazio'),
      });
      const clima = await s.selecionar('previsão do tempo para amanhã', { etapa: 'decisao' });
      const total = clima.reduce((n, k) => n + k.tamanho, 0);
      return [
        s.lista.length >= 15 || `carregou só ${s.lista.length} skills`,
        clima.some((k) => k.nome === 'Previsão do tempo') || 'skill de clima não foi selecionada',
        clima.length <= 3 || `selecionou ${clima.length} skills, o teto é 3`,
        total <= 9000 || `injetaria ${total} caracteres de skill`,
      ];
    },
  },

  {
    nome: 'ferramentas: carga, validação e dependências',
    tipo: 'unidade',
    executar() {
      const r = tools.recarregar({
        dirEmbutidas: path.join(__dirname, '..', '..', 'ferramentas'),
        dirUsuario: path.join(require('os').tmpdir(), 'augpt-ferramentas-vazio'),
      });
      const semRun = tools.TODAS.filter((t) => typeof t.run !== 'function');
      return [
        r.problemas.length === 0 || `problemas na carga: ${r.problemas.join(' | ')}`,
        semRun.length === 0 || `ferramentas sem run: ${semRun.map((t) => t.name).join(', ')}`,
        tools.TODAS.length >= 18 || `só ${tools.TODAS.length} ferramentas`,
        !tools.EXTERNAS.some((f) => f.name === 'exemplo_ferramenta') || '_MODELO.js foi carregado indevidamente',
      ];
    },
  },

  {
    nome: 'registro: coleta, agrega e avalia execuções',
    tipo: 'unidade',
    executar() {
      const dir = path.join(require('os').tmpdir(), `augpt-registros-${Date.now()}`);
      const loja = new Registros(dir, 3);

      const criar = (modelo, resultado, passos, nota) => {
        const r = new Registro({ origem: 'bancada', modelo, host: 'x' });
        Object.assign(r.dados, {
          passos,
          tokens: { prompt: 100, completion: 50, total: 150 },
          incidentes: { ...r.dados.incidentes, errosDeFerramenta: resultado === 'erro' ? 2 : 0 },
        });
        r.encerrar(resultado, 'resposta');
        const salvo = loja.salvar(r.dados);
        if (nota) loja.avaliar(salvo.id, nota);
        return salvo;
      };

      criar('modelo-a', 'concluido', 4, 5);
      criar('modelo-a', 'erro', 8, 2);
      criar('modelo-b', 'concluido', 3, 4);

      const stats = loja.estatisticas();
      const a = stats.find((s) => s.modelo === 'modelo-a');
      const b = stats.find((s) => s.modelo === 'modelo-b');

      // o teto de 3 registros precisa podar o mais antigo
      criar('modelo-c', 'concluido', 1);
      const depois = loja.todas().length;
      fs.rmSync(dir, { recursive: true, force: true });

      return [
        stats.length === 2 || `agrupou em ${stats.length} modelos`,
        a.conclusao === 50 || `taxa de conclusão do modelo-a veio ${a.conclusao}%`,
        a.passosMedios === 6 || `passos médios do modelo-a vieram ${a.passosMedios}`,
        a.nota === 3.5 || `nota média do modelo-a veio ${a.nota}`,
        b.conclusao === 100 || `taxa do modelo-b veio ${b.conclusao}%`,
        depois === 3 || `poda falhou: sobraram ${depois} registros`,
      ];
    },
  },

  {
    nome: 'registro (Fase 1, 16/10): lista traz tipo (pergunta/produto/tarefa), profundidade, buscas e sites lidos; registro antigo do núcleo vira pergunta',
    tipo: 'unidade',
    executar() {
      const dir = path.join(require('os').tmpdir(), `augpt-registros-tipo-${Date.now()}`);
      const loja = new Registros(dir);
      const salvar = (extra) => {
        const r = new Registro({ origem: 'app', modelo: 'm', host: 'x' });
        Object.assign(r.dados, extra);
        r.encerrar('concluido', 'ok');
        return loja.salvar(r.dados).id;
      };
      const leituras = [
        { tipo: 'busca', provedor: 'web' },
        { tipo: 'leitura', url: 'https://www.reddit.com/r/x' },
        { tipo: 'leitura', url: 'https://reddit.com/r/y' },
        { tipo: 'leitura', url: 'https://rtings.com/a' },
      ];
      const ids = {
        produto: salvar({ nucleo: { modo: 'profundo', produto: true }, fontes: leituras }),
        antigo: salvar({ fontes: leituras }),
        tarefa: salvar({ ferramentas: [{ nome: 'escrever_arquivo' }] }),
      };
      const lista = loja.listar();
      const de = (id) => lista.find((r) => r.id === id);
      fs.rmSync(dir, { recursive: true, force: true });
      const p = de(ids.produto);
      return [
        p.tipo === 'produto' && p.profundidade === 'profundo' && p.buscas === 1 && p.fontes === 3 || `produto: ${JSON.stringify(p)}`,
        p.sites.join(',') === 'reddit.com,rtings.com' || `sites sem www e sem repetir: ${p.sites}`,
        de(ids.antigo).tipo === 'pergunta' || `antigo do núcleo: ${de(ids.antigo).tipo}`,
        de(ids.tarefa).tipo === 'tarefa' || `tarefa: ${de(ids.tarefa).tipo}`,
      ];
    },
  },

  {
    // Pedido de Davi 2026-09-15: "anexar todo o raciocinio que podemos ver
    // na tela do chat junto do relatorio na aba execuções" — caso real que
    // motivou isso: mu2shec3-1pru.json (pergunta sobre relatividade saiu
    // como ensaio de história da arte) não tinha COMO ser diagnosticado
    // depois, porque o registro só guardava agregados. Este teste confirma
    // que acompanhar() agora captura o texto de raciocínio/crítica igual ao
    // que já aparece ao vivo na UI, não só contagens.
    nome: 'registro: captura entendimento, raciocínio e críticas do Copiloto',
    tipo: 'unidade',
    executar() {
      const agente = new EventEmitter();
      const registro = new Registro({ origem: 'app', modelo: 'modelo-x', host: 'x' }).acompanhar(agente);

      agente.emit('objetivo-reescrito', { original: 'como fica melhor', reescrito: 'como melhorar no jogo PUBG' });
      agente.emit('raciocinio', {
        n: 1,
        pensamento: 'vou buscar fontes sobre o tema',
        raciocinio: 'o pedido menciona X, então...',
        plano: ['buscar fontes', 'ler resultado'],
      });
      agente.emit('raciocinio', { n: 2, pensamento: 'agora vou redigir', critica: 'cuidado com data desatualizada' });
      agente.emit('critica-plano', { n: 1, fase: 'entendimento', texto: 'confirma que entendeu certo' });
      agente.emit('critica-plano', { n: 3, texto: 'crítica periódica de sempre, sem fase' });

      const d = registro.dados;
      return [
        (d.entendimento?.original === 'como fica melhor' && d.entendimento?.reescrito === 'como melhorar no jogo PUBG') ||
          `entendimento veio ${JSON.stringify(d.entendimento)}`,
        d.passosDetalhados.length === 2 || `capturou ${d.passosDetalhados.length} passos, esperava 2`,
        d.passosDetalhados[0].raciocinio === 'o pedido menciona X, então...' || 'raciocínio do passo 1 não bateu',
        (d.passosDetalhados[0].plano || []).length === 2 || 'plano do passo 1 não foi capturado',
        d.passosDetalhados[1].critica === 'cuidado com data desatualizada' || 'crítica de risco do passo 2 não bateu',
        d.criticasAutomaticas.length === 2 || `capturou ${d.criticasAutomaticas.length} críticas, esperava 2`,
        d.criticasAutomaticas[0].fase === 'entendimento' || 'fase do checkpoint 1 não bateu',
        d.criticasAutomaticas[1].fase === 'periodica' || 'crítica sem `fase` devia cair em "periodica"',
      ];
    },
  },

  {
    // Pedido de Davi 2026-09-23: ao revisar o último chat real, achamos que
    // cross-validation de opinião (confronto.js) e descoberta de autoridade
    // em duas fases (web.js) funcionam de verdade mas somem do registro —
    // 'confronto' só copiava 4 campos escolhidos a dedo (sem
    // divergenciasOpiniao) e 'autoridade-descoberta' não tinha handler
    // nenhum. Este teste confirma que os dois ficam capturados agora.
    nome: 'registro: captura divergência de opinião do confronto e domínios promovidos pela descoberta de autoridade',
    tipo: 'unidade',
    executar() {
      const agente = new EventEmitter();
      const registro = new Registro({ origem: 'app', modelo: 'modelo-x', host: 'x' }).acompanhar(agente);

      agente.emit('confronto', {
        dominios: 3,
        confirmados: [{ x: 1 }],
        isolados: [],
        divergencias: [],
        divergenciasOpiniao: [{ entidade: 'Fone Omega', positivos: ['a'], negativos: ['b'] }],
      });
      agente.emit('autoridade-descoberta', { consulta: 'melhores fones intra-auriculares', dominios: ['rtings.com'] });

      const d = registro.dados;
      return [
        d.confronto?.divergenciasOpiniao === 1 || `divergenciasOpiniao veio ${d.confronto?.divergenciasOpiniao}`,
        d.autoridade.length === 1 || `capturou ${d.autoridade.length} eventos de autoridade, esperava 1`,
        d.autoridade[0]?.consulta === 'melhores fones intra-auriculares' || 'consulta da descoberta de autoridade não bateu',
        (d.autoridade[0]?.dominios || []).includes('rtings.com') || 'domínio promovido não foi capturado',
      ];
    },
  },

  {
    // Pedido de Davi 2026-09-23, mesma rodada: `Agent.contabilizar()` passou
    // a emitir 'uso-chamada' (tipo + tokens + duração) por chamada real ao
    // modelo — este teste confirma que `registro.js` captura essa lista
    // (base do gráfico "qual parte do raciocínio levou mais tempo/custou
    // mais tokens" na nova janela "Visualizar Execuções"), inclusive uma
    // chamada com duracaoMs null (quando `meta.duracaoMs` não é passado).
    nome: 'registro: captura custoPorChamada (tipo/tokens/duração) do evento uso-chamada',
    tipo: 'unidade',
    executar() {
      const agente = new EventEmitter();
      const registro = new Registro({ origem: 'app', modelo: 'modelo-x', host: 'x' }).acompanhar(agente);

      agente.emit('uso-chamada', { tipo: 'decisao', promptTokens: 500, completionTokens: 80, duracaoMs: 2100 });
      agente.emit('uso-chamada', { tipo: 'redacao', promptTokens: 900, completionTokens: 300, duracaoMs: 4300 });
      agente.emit('uso-chamada', { tipo: 'rotina', promptTokens: 50, completionTokens: 10 }); // sem duracaoMs

      const d = registro.dados;
      return [
        d.custoPorChamada.length === 3 || `capturou ${d.custoPorChamada.length} chamadas, esperava 3`,
        d.custoPorChamada[0].tipo === 'decisao' && d.custoPorChamada[0].duracaoMs === 2100 || 'chamada de decisão não bateu',
        d.custoPorChamada[1].tipo === 'redacao' && d.custoPorChamada[1].prompt === 900 || 'chamada de redação não bateu',
        d.custoPorChamada[2].duracaoMs === null || `chamada sem duração deveria vir null, veio ${d.custoPorChamada[2].duracaoMs}`,
      ];
    },
  },

  {
    nome: 'calculadora não avalia código',
    tipo: 'unidade',
    async executar() {
      const calc = tools.get('calcular');
      const ok = await calc.run({ expressao: '(1250 * 1.18) / 3' }, {});
      let recusou = false;
      try {
        await calc.run({ expressao: 'process.exit(1)' }, {});
      } catch {
        recusou = true;
      }
      return [ok.includes('491,6') || `resultado inesperado: ${ok}`, recusou || 'aceitou código no lugar de expressão'];
    },
  },

  {
    // Caso real de produção (Davi): bateria de 7 questões de combinatória/
    // probabilidade — metade precisava de fatorial (permutação circular,
    // C(15,6) etc.) e a calculadora rejeitava "!" com "a expressão só pode
    // conter números e os operadores...". O modelo tentou reformular a MESMA
    // conta várias vezes, bateu no guarda de "ação repetida" 12 vezes
    // seguidas (ver incidentes.acaoRepetida no registro da execução
    // mu1bv10f-js94) e nunca chegou a um valor exato pra essas questões.
    nome: 'calculadora resolve fatorial (permutação/combinação, o caso que faltava)',
    tipo: 'unidade',
    async executar() {
      const calc = tools.get('calcular');
      const cincoFatorial = await calc.run({ expressao: '5!' }, {});
      // C(15, 6) = 15! / (6! * 9!) = 5005 — a mesma conta que a IA precisava
      // fazer pra escalar o time de vôlei na bateria de questões do Davi.
      const combinacao = await calc.run({ expressao: '15! / (6! * 9!)' }, {});
      const negativoFatorial = await calc.run({ expressao: '-5!' }, {});
      const potenciaDepoisDeFatorial = await calc.run({ expressao: '3!^2' }, {});

      let recusouNegativo = false;
      try {
        await calc.run({ expressao: '(0-5)!' }, {});
      } catch {
        recusouNegativo = true;
      }
      let recusouGrandeDemais = false;
      try {
        await calc.run({ expressao: '999!' }, {});
      } catch {
        recusouGrandeDemais = true;
      }

      return [
        cincoFatorial.includes('120') || `5! deveria dar 120, veio: ${cincoFatorial}`,
        combinacao.includes('5.005') || combinacao.includes('5005') || `C(15,6) deveria dar 5005, veio: ${combinacao}`,
        negativoFatorial.includes('-120') || `-5! deveria dar -120 (convenção: -(5!)), veio: ${negativoFatorial}`,
        potenciaDepoisDeFatorial.includes('36') || `3!^2 deveria dar (3!)^2 = 36, veio: ${potenciaDepoisDeFatorial}`,
        recusouNegativo || 'fatorial de número negativo deveria ser recusado',
        recusouGrandeDemais || 'fatorial de 999 deveria ser recusado (estoura precisão)',
      ];
    },
  },
];
