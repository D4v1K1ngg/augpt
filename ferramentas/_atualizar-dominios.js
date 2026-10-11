'use strict';

/**
 * NÃO É UMA FERRAMENTA DO AGENTE (o prefixo _ faz o carregador ignorar).
 *
 * Script de manutenção: reconstrói dados/dominios.json a partir de bases
 * públicas de credibilidade. Rode com `npm run atualizar-dominios`.
 *
 * Por que um script e não download em tempo de execução: o app funciona
 * offline, e baixar lista de terceiros a cada pesquisa seria lento, frágil e
 * uma dependência de rede que ninguém pediu.
 */

const fs = require('fs');
const path = require('path');

/**
 * Amostra o Fake.br Corpus (USP/ICMC) e devolve os portais de origem.
 *
 * O corpus tem 7.200 notícias com a URL de cada uma nos metadados. Os portais
 * se repetem muito, então uma amostra espaçada já revela todos — e é o único
 * sinal de credibilidade destas listas que cobre domínios `.br`.
 */
async function amostrarFakeBr({ total = 3600, passo = 3, concorrencia = 25 } = {}) {
  const contagem = { fake: {}, true: {} };

  const dominioDe = async (tipo, i) => {
    const url = `https://raw.githubusercontent.com/roneysco/Fake.br-Corpus/master/full_texts/${tipo}-meta-information/${i}-meta.txt`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const link = (await r.text()).split(/\r?\n/).find((l) => /^https?:\/\//.test(l.trim()));
      return link ? new URL(link.trim()).hostname.replace(/^www\./, '').toLowerCase() : null;
    } catch {
      return null;
    }
  };

  for (const tipo of ['fake', 'true']) {
    const indices = [];
    for (let i = 1; i <= total; i += passo) indices.push(i);
    for (let i = 0; i < indices.length; i += concorrencia) {
      const lote = indices.slice(i, i + concorrencia).map((n) => dominioDe(tipo, n));
      for (const d of await Promise.all(lote)) if (d) contagem[tipo][d] = (contagem[tipo][d] || 0) + 1;
    }
  }
  return contagem;
}

const FONTES = [
  {
    nome: 'OpenSources',
    url: 'https://raw.githubusercontent.com/OpenSourcesGroup/opensources/master/sources/sources.json',
    async processar(texto) {
      const dados = JSON.parse(texto);
      const saida = {};
      for (const [dominio, info] of Object.entries(dados)) {
        const tipos = [info.type, info['2nd type'], info['3rd type']]
          .filter(Boolean)
          .map((t) => String(t).trim().toLowerCase());
        const marca = classificar(tipos);
        if (marca) saida[dominio.toLowerCase().replace(/^www\./, '')] = marca;
      }
      return saida;
    },
  },
];

/**
 * Só categorias sobre FABRICAÇÃO entram.
 *
 * "bias" e "political" são juízo editorial sobre ponto de vista — usá-los para
 * ranquear embutiria a posição política de uma organização dentro do agente.
 * Penalizamos invenção, não opinião.
 */
function classificar(tipos) {
  const tem = (...alvos) => alvos.some((a) => tipos.some((t) => t.includes(a)));

  if (tem('fake', 'conspiracy', 'junksci', 'hate')) return { risco: 'alto', motivo: 'histórico de conteúdo fabricado' };
  if (tem('satire', 'satirical')) return { risco: 'satira', motivo: 'site de sátira — não é notícia real' };
  if (tem('unreliable', 'unrealiable', 'rumor', 'clickbait')) {
    return { risco: 'medio', motivo: 'apuração fraca ou sensacionalista' };
  }
  return null; // 'bias', 'political', 'reliable', 'state': fora de propósito
}

async function principal() {
  const tabela = {};
  const relatorio = [];

  // ---------- Fake.br Corpus: os únicos domínios .br destas bases ----------
  process.stdout.write('amostrando Fake.br Corpus (USP/ICMC)… ');
  try {
    const c = await amostrarFakeBr();
    let falsos = 0;
    let verdadeiros = 0;

    for (const [dominio, vezes] of Object.entries(c.fake)) {
      // um caso isolado pode ser artigo avulso; a recorrência é que caracteriza
      if (vezes < 3 || c.true[dominio]) continue;
      tabela[dominio] = { risco: 'alto', motivo: 'portal catalogado como fonte de notícia falsa (Fake.br/USP)' };
      falsos += 1;
    }
    for (const [dominio, vezes] of Object.entries(c.true)) {
      if (vezes < 3 || c.fake[dominio]) continue;
      tabela[dominio] = { risco: 'nenhum', reforco: 'imprensa verificada no corpus Fake.br (USP)' };
      verdadeiros += 1;
    }
    console.log(`${falsos} portais de desinformação, ${verdadeiros} veículos verificados`);
    relatorio.push(`Fake.br Corpus: ${falsos} falsos + ${verdadeiros} verificados`);
  } catch (err) {
    console.log(`falhou (${err.message})`);
  }

  for (const fonte of FONTES) {
    process.stdout.write(`baixando ${fonte.nome}… `);
    try {
      const res = await fetch(fonte.url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parcial = await fonte.processar(await res.text());
      Object.assign(tabela, parcial);
      console.log(`${Object.keys(parcial).length} domínios`);
      relatorio.push(`${fonte.nome}: ${Object.keys(parcial).length}`);
    } catch (err) {
      console.log(`falhou (${err.message})`);
    }
  }

  if (!Object.keys(tabela).length) {
    console.error('nenhuma fonte respondeu; o arquivo atual foi preservado');
    process.exit(1);
  }

  // ---------- Blocklist judicial brasileira ----------
  // NÃO é julgamento de credibilidade: são ordens de bloqueio (aposta, pirataria,
  // IPTV). O repositório de origem não endossa nem contesta as ordens, e nós
  // também não. Serve para não gastar leitura em domínio inacessível daqui.
  process.stdout.write('baixando lista de bloqueio judicial (Router-X)… ');
  try {
    const r = await fetch(
      'https://raw.githubusercontent.com/Router-X/Websites_blocked_Brazil/main/Websites_for_block',
      { signal: AbortSignal.timeout(60000) }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // Sufixos públicos precisam ser descartados: a base de origem traz
    // "com.br" como entrada, e aceitá-la bloquearia TODO site brasileiro.
    const SUFIXOS = new Set([
      'com', 'net', 'org', 'gov', 'edu', 'info', 'io', 'br', 'com.br', 'net.br', 'org.br',
      'gov.br', 'edu.br', 'blog.br', 'app.br', 'co.uk', 'com.ar', 'com.pt', 'bet', 'online',
      'shop', 'top', 'site', 'xyz', 'club', 'live', 'vip', 'app', 'dev',
    ]);

    const linhas = (await r.text())
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase().replace(/^www\./, ''))
      .filter((l) => l && !l.startsWith('#'))
      .filter((l) => l.includes('.') && !SUFIXOS.has(l))
      .filter((l) => l.split('.')[0].length >= 2);

    const descartadas = new Set([...linhas]).size;

    const arquivo = path.join(__dirname, '..', 'dados', 'bloqueados-br.txt');
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, `${[...new Set(linhas)].sort().join('\n')}\n`, 'utf8');
    console.log(`${descartadas} domínios (sufixos públicos descartados)`);
    relatorio.push(`Bloqueio judicial BR: ${descartadas}`);
  } catch (err) {
    console.log(`falhou (${err.message})`);
  }

  const destino = path.join(__dirname, '..', 'dados', 'dominios.json');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(
    destino,
    JSON.stringify(
      {
        atualizadoEm: new Date().toISOString().slice(0, 10),
        origens: relatorio,
        aviso:
          'Categorias de fabricação apenas. Classificações de viés político são ignoradas de propósito. ' +
          'A base é majoritariamente de sites em inglês — a cobertura em português é baixa.',
        dominios: tabela,
      },
      null,
      1
    ),
    'utf8'
  );

  console.log(`\ngravado dados/dominios.json com ${Object.keys(tabela).length} domínios`);
  const contagem = {};
  for (const v of Object.values(tabela)) contagem[v.risco] = (contagem[v.risco] || 0) + 1;
  console.log(Object.entries(contagem).map(([k, v]) => `${k}: ${v}`).join(' · '));
}

principal();
