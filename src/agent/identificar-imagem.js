'use strict';

/**
 * Identificar a imagem anexada (16/11, Davi: "buscar na web com exatidão a imagem e me dizer o que ela é", como a
 * busca por imagem do Google). Sem enviar a foto a nenhum serviço de fora:
 *   1. a visão olha a foto e diz o que mostra, os palpites de nome (modelo, lugar, espécie, obra) e a busca;
 *   2. a busca de imagens (SearXNG) roda com a busca e cada palpite; o app baixa as fotos achadas;
 *   3. o código compara cada foto com a do usuário pelo dHash: distância baixa é a MESMA imagem em outro site —
 *      o título dessas páginas costuma dizer o que ela é;
 *   4. a visão olha a foto do usuário ao lado das 4 melhores candidatas (com o título de cada página) e diz quais
 *      mostram exatamente a mesma coisa e o que ela é, com a certeza.
 * Pessoas: o AuGPT não diz quem é pelo rosto nem lista as páginas com a mesma foto — só busca imagens parecidas.
 */

const imagens = require('../tools/imagens');
const { conferirComAVisao } = require('./imagens-no-chat');

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const MESMA = 10; // dHash: até 10 de 64 bits diferentes = a mesma foto (outro tamanho, recomprimida, com marca d'água)

// com a foto anexada: "o que é isso?", "identifique", "busque esta imagem", "de onde é", "imagens parecidas"
const PARECIDAS = /\b(parecid\w*|similar\w*|semelhant\w*|mesmo estilo|desse estilo|deste estilo)\b/;
const IDENTIFICAR = new RegExp([
  /\bidentifi\w*/.source,
  /\breconhe[cç]\w*/.source,
  /\bo que (e|eh|seria) (isso|isto|essa|esta|esse|este|aquilo)\b/.source,
  /\b(que|qual) (lugar|planta|flor|arvore|animal|bicho|inseto|passaro|ave|raca|especie|carro|moto|modelo|produto|objeto|peca|marca|obra|quadro|predio|monumento|cidade|personagem|jogo|filme|anime|cogumelo|fruta|pedra) (e|eh|seria) (esse|essa|este|esta|isso|isto)\b/.source,
  /\bde onde (e|eh|vem|veio) (essa|esta|esse|este|isso|isto)\b/.source,
  // "qual o nome desse fone?", "qual é o modelo dessa placa?", "que fone é esse?" (16/11, print do Davi)
  /\b(qual|que) (e |eh )?(o )?(nome|modelo|marca|especie|raca) (d(ess|est)[ea]s?|disso|disto)\b/.source,
  /\b(que|qual) (fone|headset|tenis|sapato|roupa|camisa|relogio|celular|notebook|teclado|mouse|placa|console|controle|oculos|bolsa|mochila|cadeira|monitor|caixa de som|logo|fonte|estilo) (e|eh|seria) (esse|essa|este|esta|isso|isto)\b/.source,
  /\b(bus[cq]|procur|pesquis|encontr|ach)\w* (essa|esta|a) (imagem|foto|figura) (na (web|internet)|no google)\b/.source,
  /\b(bus[cq]|procur|pesquis|encontr|ach)\w* (essa|esta) (imagem|foto|figura)\b/.source,
  /\bonde (encontro|acho|compro|fica) (isso|isto|esse|essa|este|esta)\b/.source,
].join('|'));
// perguntas sobre o conteúdo do print/documento continuam com a visão de sempre
const DO_CONTEUDO = /\b(escrito|diz|dizendo|traduz\w*|erro|codigo|planilha|grafico|conta|boleto|documento|print|tela|resum\w*|leia|ler|texto)\b/;

/** A foto anexada é para identificar/buscar na web? → { parecidas } ou null. */
function pedidoDeIdentificacao(texto, temImagem) {
  if (!temImagem) return null;
  const t = norm(texto);
  if (PARECIDAS.test(t) && /\b(imagem|imagens|foto|fotos|figura|figuras|parecid\w*|similar\w*|coisas?)\b/.test(t)) return { parecidas: true };
  if (IDENTIFICAR.test(t) && !DO_CONTEUDO.test(t)) return { parecidas: false };
  return null;
}

const lerJson = (t) => {
  try {
    return JSON.parse(String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/)[0]);
  } catch {
    return null;
  }
};

const PEDIDO_DE_OLHAR = `Olhe a imagem e responda SÓ com um JSON:
{"o_que_e": "o que a imagem mostra, em português, uma frase", "pessoa": true ou false, "palpites": ["nome específico, se você reconhece"], "busca": "busca de imagens em inglês, até 8 palavras", "texto": "texto legível na imagem, ou vazio"}
- "palpites": até 3, do mais provável ao menos: modelo exato do produto, nome do lugar ou monumento, espécie, raça, obra, personagem, jogo. Vazio se é algo genérico.
- "busca": com o nome específico quando houver; senão, o objeto ou cena, o estilo e as cores.
- "pessoa": true se o assunto principal é uma pessoa real. Nunca diga quem é uma pessoa pelo rosto: descreva só a cena.`;

function pedidoDeConferir(olhado, candidatas) {
  return `A primeira imagem é a do usuário. As outras ${candidatas.length} vieram da busca na web, nesta ordem:
${candidatas.map((c, i) => `${i + 1}. página: "${String(c.titulo || 'sem título').slice(0, 120)}"${c.mesma ? ' (o código viu que é a MESMA foto do usuário)' : ''}`).join('\n')}
O que a primeira parece ser: ${olhado.o_que_e || '?'}${olhado.palpites?.length ? `. Palpites: ${olhado.palpites.join('; ')}` : ''}

Diga quais imagens da busca mostram EXATAMENTE a mesma coisa da do usuário (o mesmo modelo, lugar, obra, espécie — não só parecida) e, pelo que as imagens e os títulos mostram, o que é a imagem do usuário.
Responda SÓ com um JSON:
{"iguais": [números das iguais], "identificacao": "o que é", "certeza": "alta", "media" ou "baixa"}
- "identificacao": em português, de 1 a 3 frases, direto ao assunto ("É a Torre Eiffel, em Paris, vista do rio Sena."): o nome específico só se os títulos ou a imagem confirmam, e o que vale saber dele. Não fale de "primeira imagem", das outras imagens nem da busca.
- "certeza": alta só quando o nome está confirmado (a mesma foto achada, ou títulos e imagens batendo); para algo genérico sem nome, "media".`;
}

/** Baixa as fotos das buscas (sem repetir) e mede cada uma contra a do usuário. */
async function candidatasDasBuscas(buscas, { hashDoUsuario, dir, config, deps, maximo = 24 }) {
  const buscar = deps.buscarImagens || imagens.buscarImagens;
  const listas = await Promise.all(buscas.map((b) => buscar(b, { config, deps, maximo: 12, grande: true }).catch(() => [])));
  const vistas = new Set();
  const todas = [];
  // intercaladas: a 1ª de cada busca, depois a 2ª… — nenhuma busca toma a lista toda
  for (let i = 0; i < 12; i += 1) {
    for (const [k, lista] of listas.entries()) {
      const c = lista[i];
      if (c && !vistas.has(c.url)) {
        vistas.add(c.url);
        todas.push({ ...c, busca: buscas[k] });
      }
    }
  }
  const prontas = [];
  for (let i = 0; i < todas.length && prontas.length < maximo; i += 6) {
    const lote = todas.slice(i, i + 6);
    // a original passa de 1,5 MB muitas vezes: fica a miniatura do buscador (basta para comparar e mostrar)
    const guardar = (u, c) => (u ? imagens.guardarImagem(u, { pagina: c.pagina, dir, config, deps }).catch(() => null) : null);
    const uris = await Promise.all(lote.map(async (c) => (await guardar(c.url, c)) || (c.miniatura !== c.url ? guardar(c.miniatura, c) : null)));
    lote.forEach((c, k) => {
      if (!uris[k] || prontas.some((p) => p.uri === uris[k])) return;
      const arquivo = imagens.arquivoDaUri(dir, uris[k]);
      const tam = (deps.tamanhoDaImagem || imagens.tamanhoDaImagem)(arquivo);
      if (tam && Math.max(tam.largura, tam.altura) < 200) return; // miniatura de ícone
      const distancia = imagens.distanciaDoHash(hashDoUsuario, (deps.hashDaImagem || imagens.hashDaImagem)(arquivo));
      prontas.push({ ...c, uri: uris[k], arquivo, distancia, mesma: distancia <= MESMA });
    });
  }
  return prontas;
}

/** A ordem para a visão e a galeria: a mesma foto, depois as que o título cita um palpite, depois as mais próximas. */
function ordenar(candidatas, palpites = []) {
  const cita = (c) => palpites.some((p) => imagens.tituloCita(c.titulo, p));
  return [...candidatas].sort((a, b) => Number(b.mesma) - Number(a.mesma) || Number(cita(b)) - Number(cita(a)) || a.distancia - b.distancia);
}

async function identificarImagem({ pergunta, imagem, parecidas = false, deps, dir, config = {} }) {
  const emit = deps.emit || (() => {});
  const base = { fontes: [], produto: false, assuntos: [], buscou: true, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'imagens', rota: 'identificar_imagem' };
  if (!dir || !config.searxngUrl) return null; // sem a busca de imagens: a visão de sempre responde
  emit('ferramenta', { nome: 'olhar_imagem', argumentos: { consulta: 'o que a imagem mostra' }, risco: 'leitura' });
  const olhado = lerJson((await deps.chamar([{ role: 'user', content: PEDIDO_DE_OLHAR, images: [imagem.base64] }], { json: true, numPredict: 400 }).catch(() => null))?.content) || {};
  const pessoa = olhado.pessoa === true;
  const palpites = pessoa ? [] : (Array.isArray(olhado.palpites) ? olhado.palpites : []).map((p) => String(p).trim())
    // só nome próprio (maiúscula ou número: "HyperX Cloud II", "Torre Eiffel"); "criação artística" vira busca ruim
    .filter((p) => p.length >= 3 && /[A-Z0-9À-Ý]/.test(p)).slice(0, 3);
  const busca = String(olhado.busca || olhado.o_que_e || '').replace(/["\n]/g, ' ').trim().slice(0, 100);
  if (!busca && !palpites.length) return null;
  const texto = String(olhado.texto || '').trim();
  const buscas = [...new Set([busca, ...(pessoa ? [] : palpites), ...(!pessoa && texto.length >= 4 && texto.length <= 40 ? [texto] : [])].filter(Boolean))].slice(0, 4);
  for (const b of buscas) emit('ferramenta', { nome: 'buscar_imagens', argumentos: { consulta: b }, risco: 'leitura' });
  const hashDoUsuario = imagem.arquivo ? (deps.hashDaImagem || imagens.hashDaImagem)(imagem.arquivo) : null;
  const candidatas = ordenar(await candidatasDasBuscas(buscas, { hashDoUsuario, dir, config, deps }), palpites);

  // a visão confere as 4 melhores ao lado da foto do usuário
  let conferido = null;
  const paraConferir = candidatas.slice(0, 4);
  if (paraConferir.length && !pessoa) {
    emit('ferramenta', { nome: 'comparar_imagens', argumentos: { consulta: `comparando com ${paraConferir.length} imagens da web` }, risco: 'leitura' });
    const fotos = paraConferir.map((c) => imagens.miniaturaBase64(c.arquivo, 512)).filter(Boolean);
    if (fotos.length === paraConferir.length) {
      conferido = lerJson((await deps.chamar([{ role: 'user', content: pedidoDeConferir(olhado, paraConferir), images: [imagens.miniaturaBase64(imagem.arquivo, 768) || imagem.base64, ...fotos] }], { json: true, numPredict: 500 }).catch(() => null))?.content);
    }
  }
  const iguais = new Set((Array.isArray(conferido?.iguais) ? conferido.iguais : []).map(Number).filter((n) => n >= 1 && n <= paraConferir.length).map((n) => paraConferir[n - 1].uri));
  for (const c of candidatas) c.igual = c.mesma || iguais.has(c.uri);
  const mesmas = pessoa ? [] : candidatas.filter((c) => c.mesma && c.pagina);
  // "alta" só com nome confirmado: a mesma foto achada ou um palpite de nome próprio (genérico fica no máximo "média")
  let certeza = ['alta', 'media', 'baixa'].includes(conferido?.certeza) ? conferido.certeza : mesmas.length ? 'media' : 'baixa';
  if (certeza === 'alta' && !mesmas.length && !palpites.length) certeza = 'media';
  const identificacao = String(conferido?.identificacao || olhado.o_que_e || '').trim();

  const partes = [];
  if (!parecidas || identificacao) {
    partes.push('### O que é', '', identificacao || 'Não consegui dizer com segurança o que a imagem mostra.');
    const porque = [mesmas.length && `achei a mesma foto em ${mesmas.length} ${mesmas.length === 1 ? 'página' : 'páginas'}`, candidatas.filter((c) => c.igual && !c.mesma).length && 'imagens da web mostram a mesma coisa'].filter(Boolean);
    partes.push('', `*Certeza ${certeza === 'media' ? 'média' : certeza}${porque.length ? ` — ${porque.join(' e ')}` : ''}.${pessoa ? ' Por privacidade, não identifico pessoas pelo rosto; abaixo, só imagens parecidas.' : ''}*`);
  }
  if (mesmas.length) {
    partes.push('', '### Onde esta imagem aparece', '', ...mesmas.slice(0, 5).map((c) => `- [${String(c.titulo || new URL(c.pagina).hostname).replace(/[[\]]/g, '').slice(0, 90)}](${c.pagina})`));
  }
  // galeria: as que mostram a mesma coisa primeiro; a mesma foto do usuário não se repete
  let galeria = [...candidatas.filter((c) => c.igual && !c.mesma), ...candidatas.filter((c) => !c.igual)];
  // a IA confere a galeria como na busca de imagens: tira o que não tem a ver ("gato astronauta" trouxe filhotes de cachorro)
  if (galeria.length > 3 && config.buscaImagensConferir !== false) {
    const nome = palpites[0] || olhado.o_que_e || busca;
    emit('ferramenta', { nome: 'conferir_imagens', argumentos: { consulta: `a IA confere ${Math.min(galeria.length, 16)} fotos parecidas` }, risco: 'leitura' });
    const boas = await conferirComAVisao({ nome, busca }, galeria.slice(0, 16), { deps, dir });
    if (boas.length) galeria = boas;
  }
  galeria = galeria.slice(0, parecidas ? 8 : 6);
  if (galeria.length) {
    const nome = palpites[0] || olhado.o_que_e || 'imagem parecida';
    partes.push('', `### ${parecidas ? 'Imagens parecidas' : 'Imagens parecidas na web'}`, '', galeria.map((c) => imagens.marcacao(nome, c.uri)).join(' '));
    const sites = galeria.filter((c) => c.pagina).map((c, k) => `[(${k + 1})](${c.pagina})`).join('');
    if (sites) partes.push('', `De: ${sites}`);
  }
  if (!candidatas.length) partes.push('', '*A busca de imagens não trouxe resultados agora; a identificação acima é só do que o modelo viu.*');
  partes.push('', `*Buscas usadas: ${buscas.map((b) => `"${b}"`).join(', ')}. A sua imagem não sai do computador: o AuGPT busca pelo que ela mostra e compara as fotos achadas aqui.*`);
  const resposta = partes.join('\n').replace(/^\n+/, '');
  emit('resposta-token', { pedaco: resposta });
  return { ...base, texto: resposta, fontes: mesmas.slice(0, 5).map((c, i) => ({ n: i + 1, url: c.pagina, titulo: c.titulo || c.pagina })), assuntos: palpites.slice(0, 1) };
}

module.exports = { pedidoDeIdentificacao, identificarImagem, ordenar, MESMA };
