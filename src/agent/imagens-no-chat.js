'use strict';

/**
 * Buscar imagens (21/10, pedido do Davi): "busque uma imagem de um carro", "mostre fotos da Torre
 * Eiffel", "quero ver imagens desses setups". Antes, isso caía na pesquisa e voltava em texto (e a
 * resposta chegou a falar de "JPG, PNG"). O modelo só diz O QUE buscar — com "desses", os itens da
 * resposta anterior; o código busca (SearXNG, categoria imagens), baixa pelo app (a tela nunca
 * carrega imagem da internet) e monta uma galeria por item, com a etiqueta do site de cada foto.
 * "Crie/gere/desenhe uma imagem" é a criação de imagens, não esta busca.
 */

const imagens = require('../tools/imagens');

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const VERBO = /\b(bus[cq]\w*|procur\w*|pesquis\w*|mostr\w*|me (mostra|manda|envia|traz)|quero ver|queria ver|ver (as |umas? )?(fotos?|imagens?)|traga|traz|encontr\w*|ach\w*|mand\w*|envi\w*|exib\w*)\b/;
const IMAGEM = /\b(imagem|imagens|foto|fotos|fotografia|fotografias|figura|figuras|wallpapers?|papel de parede|referencias? visua(l|is))\b/;
const CRIAR = /\b(cri[ae]\w*|ger[ae]\w*|desenh\w*|pint\w*|ilustr\w*|edit\w*|fa[cz]\w* (uma |um )?(imagem|foto|logo|desenho))\b/;

/** O pedido é para buscar imagens (e não criar)? */
// "quantas fotos eu tenho no meu PC?", "mostre as fotos da minha pasta": são os arquivos do usuário (consulta do PC)
const DO_USUARIO = /\b(no|do|neste|nesse) (meu |minha )?(pc|computador|notebook|celular|hd|ssd)\b|\b(meu|minha|meus|minhas) (pc|computador|notebook|pasta|fotos|imagens|arquivos|galeria)\b|\btenho\b|\bpasta\b|\banex\w*/;

function pedidoDeImagens(texto) {
  const t = norm(texto);
  return IMAGEM.test(t) && VERBO.test(t) && !CRIAR.test(t) && !DO_USUARIO.test(t);
}

/** Os itens numerados da resposta anterior ("1. Setup Cyberpunk", "#### 2. Hyte Y70"), para "imagens desses". */
function itensDaResposta(texto) {
  return [...String(texto || '').matchAll(/^#{2,5}\s+(?:####\s+)?\d+\.\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, '').replace(/\s*[—–:].*$/, '').trim()).filter(Boolean).slice(0, 8);
}

function pedidoDoQueBuscar(pergunta, anteriores, itens) {
  return `O usuário quer VER IMAGENS (fotos da internet). Diga o que buscar.
Pedido: ${pergunta}
${anteriores ? `Conversa até aqui (resumo):\n${anteriores}\n` : ''}${itens.length ? `Itens da última resposta do AuGPT: ${itens.join(' | ')}\n` : ''}
Responda só com JSON, no formato do exemplo: {"itens": [{"nome": "Fusca 1975", "busca": "Volkswagen Beetle 1975"}]}
- "nome": o nome da coisa, para o usuário ler (em português). "busca": a busca de imagem curta, em inglês se ajudar.
- Um item para cada coisa que o usuário quer ver; se ele se refere à resposta anterior ("desses", "deles", "dessas opções"), um item para cada item dela (até 6), com o nome dela.
- A busca leva o assunto junto (ex.: "cyberpunk gaming setup desk", "Hyte Y70 PC case", "red sports car").
- Se o pedido é de uma coisa só ("uma imagem de um carro"), um item só.`;
}

const lerJson = (t) => {
  try {
    return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)[0]);
  } catch {
    return null;
  }
};

/** Até `n` fotos de uma busca: as que o título cita o item primeiro, depois as outras da busca (o buscador já ordenou). */
async function fotosDe(item, { n, dir, config, deps }) {
  const todas = await (deps.buscarImagens || imagens.buscarImagens)(item.busca || item.nome, { config, deps, maximo: 24, grande: true });
  const citam = todas.filter((c) => imagens.tituloCita(c.titulo, item.nome) || imagens.tituloCita(c.titulo, item.busca || ''));
  const ordem = [...citam, ...todas.filter((c) => !citam.includes(c))];
  const achadas = [];
  for (let i = 0; i < ordem.length && achadas.length < n; i += 4) {
    const lote = ordem.slice(i, i + 4);
    const baixadas = await Promise.all(lote.map((c) => imagens.guardarImagem(c.url, { dir, config, deps }).catch(() => null)));
    lote.forEach((c, k) => {
      if (baixadas[k] && achadas.length < n && !achadas.some((a) => a.uri === baixadas[k])) achadas.push({ uri: baixadas[k], pagina: c.pagina });
    });
  }
  return achadas;
}

async function responderImagens({ pergunta, conversa = [], deps, dir, config = {} }) {
  const emit = deps.emit || (() => {});
  const vazio = { fontes: [], produto: false, assuntos: [], buscou: true, entendimento: { precisaBuscar: false, assuntos: [] }, modo: 'imagens' };
  if (!dir || config.imagensNasRespostas === false || !config.searxngUrl) {
    const texto = config.imagensNasRespostas === false
      ? 'As imagens nas respostas estão desligadas em **Ajustes → Pesquisa na web**. Ligue lá para eu buscar fotos.'
      : 'Para buscar imagens, o AuGPT usa a busca embutida (SearXNG), que não está ligada. Ative em **Ajustes → Pesquisa na web**.';
    emit('resposta-token', { pedaco: texto });
    return { ...vazio, texto };
  }
  const anterior = [...conversa].reverse().find((m) => m.role === 'assistant')?.content || '';
  const itens = /\b(desse|dessa|desses|dessas|deles|delas|destes|destas|dos itens|das opcoes|acima)\b/.test(norm(pergunta)) ? itensDaResposta(anterior) : [];
  const resumo = conversa.slice(-4).map((m) => `${m.role === 'user' ? 'Usuário' : 'AuGPT'}: ${String(m.content || '').slice(0, 240)}`).join('\n');
  emit('ferramenta', { nome: 'buscar_imagens', argumentos: { consulta: 'escolhendo o que buscar' }, risco: 'leitura' });
  let lista = [];
  try {
    const j = lerJson((await deps.chamar([{ role: 'user', content: pedidoDoQueBuscar(pergunta, resumo, itens) }], { json: true, numPredict: 400 })).content);
    // nome copiado do formato ("como mostrar ao usuário", "o nome da coisa"): vale o item da resposta anterior ou a busca
    const copiado = (t) => /como mostrar|nome da coisa|para o usu[aá]rio|busca de imagem/i.test(String(t || ''));
    lista = (j?.itens || [])
      .filter((x) => x && (x.nome || x.busca))
      .map((x, i) => ({ nome: String(copiado(x.nome) || !x.nome ? itens[i] || x.busca : x.nome).slice(0, 80), busca: String(copiado(x.busca) || !x.busca ? itens[i] || x.nome : x.busca).slice(0, 100) }))
      .filter((x) => x.nome && x.busca && !copiado(x.busca));
  } catch {
    lista = [];
  }
  // sem o modelo: os itens da resposta anterior, ou o próprio pedido sem o verbo
  if (!lista.length) lista = itens.length ? itens.map((nome) => ({ nome, busca: nome })) : [{ nome: pergunta, busca: norm(pergunta).replace(VERBO, '').replace(IMAGEM, '').replace(/\b(uma?|umas?|de|do|da|dos|das|pra|para|mim|me|eu)\b/g, ' ').replace(/\s+/g, ' ').trim() }];
  lista = lista.slice(0, 6);
  const porItem = lista.length === 1 ? 6 : 3;
  const resultados = await Promise.all(
    lista.map((item) => {
      emit('ferramenta', { nome: 'buscar_imagens', argumentos: { consulta: item.busca }, risco: 'leitura' });
      return fotosDe(item, { n: porItem, dir, config, deps }).catch(() => []);
    })
  );
  const blocos = [];
  lista.forEach((item, i) => {
    const fotos = resultados[i];
    if (!fotos.length) return;
    const titulo = lista.length > 1 ? `**${item.nome}**\n` : '';
    const linha = fotos.map((f) => imagens.marcacao(item.nome, f.uri)).join(' ');
    const sites = fotos.filter((f) => f.pagina).map((f, k) => `[(${k + 1})](${f.pagina})`).join('');
    blocos.push(`${titulo}${linha}${sites ? `\n\nDe: ${sites}` : ''}`);
  });
  const achou = resultados.filter((r) => r.length).length;
  const texto = blocos.length
    ? `${lista.length > 1 ? `Imagens de ${achou === lista.length ? 'cada um' : `${achou} de ${lista.length}`}:` : 'Aqui estão as imagens que encontrei:'}\n\n${blocos.join('\n\n')}${achou < lista.length ? `\n\n*Não achei imagens boas de: ${lista.filter((_, i) => !resultados[i].length).map((x) => x.nome).join(', ')}.*` : ''}\n\n*As fotos são da internet (busca de imagens); clique numa etiqueta para ver a página de onde ela veio.*`
    : `Não encontrei imagens para "${lista.map((x) => x.nome).join(', ')}". Tente descrever de outro jeito (por exemplo, em inglês ou com o nome exato).`;
  emit('resposta-token', { pedaco: texto });
  return { ...vazio, texto };
}

module.exports = { pedidoDeImagens, itensDaResposta, responderImagens };
