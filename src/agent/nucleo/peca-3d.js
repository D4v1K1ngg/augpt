'use strict';

/**
 * Peças para impressão 3D (27/11, Davi: "é possível implementar um sistema no augpt para criar objetos de impressão 3d?"
 * — "a primeira opção seria o ideal": o modelo escreve OpenSCAD). Medido no mesmo dia, 15 pedidos reais (caixa, arruela,
 * placa com furos, organizador, cantoneira, knob, chaveiro, gancho, suportes, engrenagem, ponteira, presilha, tampa),
 * olhando cada peça: Qwen 3.5 9B 2–3 certas, 9B pensando 6, gpt-oss 20B ~7, Gemma 4 26B ~9; nenhum acertou gancho em J,
 * suporte inclinado, suporte de parede nem engrenagem de verdade, e o 9B nem conhecia a linguagem (guardava forma em
 * variável) — o guia curto da linguagem e a biblioteca (src/cad/augpt.scad, as formas difíceis prontas e medidas) vão
 * junto. O Gemma 4 é o especialista padrão quando está instalado (src/agent/especialistas.js).
 *
 * Caminho: o modelo escreve → o OpenSCAD gera (erro volta para o modelo, até 2 vezes) → o modelo olha as fotos de cima e
 * de baixo com as medidas e corrige (até 2 vezes; só modelo que enxerga) → STL, 3MF e o código na pasta de trabalho, e o
 * visualizador 3D no chat. "deixa a parede com 3 mm" depois de uma peça ajusta a mesma peça.
 */

const sem = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const VERBO = /\b(crie|cria|criar|crio|fa[cç]a|faz|fazer|gere|gera|gerar|modele|modela|modelar|desenhe|desenha|desenhar|projete|projeta|projetar|monte|monta)\b/;
const EM_3D = /\b(3d|stl|3mf|openscad|imprimir|impressao|impressora)\b/;
const PERGUNTA = /^\s*(qual|quais|como|onde|quanto|quantos|quando|por ?que|o que|que |vale a pena|e possivel|da pra|tem como)\b/;

/** "cria uma peça 3D de…", "faz um suporte de headset para imprimir", "modela uma caixa em STL" (não pergunta). */
function pedePeca3d(pergunta) {
  const t = sem(pergunta);
  return VERBO.test(t) && EM_3D.test(t) && !PERGUNTA.test(t);
}

// a última peça desta conversa: o código fica na pasta de trabalho, citado na resposta
const ARQUIVO_SCAD = /`(pecas-3d\/[^`\s]+\.scad)`/;
function pecaAnterior(conversa = []) {
  const ultima = [...conversa].reverse().find((m) => m.role === 'assistant');
  const texto = String(ultima?.content || '');
  return /\{3d:[a-z]+\.stl\}/.test(texto) ? (ARQUIVO_SCAD.exec(texto) || [])[1] || null : null;
}
const AJUSTE = /\b(deixa|deixe|aumenta|aumente|diminui|diminua|muda|mude|troca|troque|coloca|coloque|poe|ponha|tira|tire|adiciona|adicione|acrescenta|acrescente|arredonda|arredonde|engrossa|afina|alarga|estica|encurta|alonga|gira|vira|inverte|faz|faca|refaz|refaca|corrige|corrija|agora)\b/;
/** Ajuste da peça que acabou de sair ("deixa a parede com 3 mm"): devolve o .scad dela, ou null. */
function ajusteDaPeca(pergunta, conversa = []) {
  const t = sem(pergunta);
  if (PERGUNTA.test(t) || t.length > 400) return null;
  const anterior = pecaAnterior(conversa);
  // "Na peça acima, em a face de trás (…)": o pedido feito pelo visualizador (botão direito numa face)
  return anterior && (/^na peca acima\b/.test(t) || AJUSTE.test(t) || /\b\d+([.,]\d+)?\s*(mm|cm|graus?)\b/.test(t)) ? anterior : null;
}

const SISTEMA = `Você cria peças para impressão 3D escrevendo código OpenSCAD.
Regras:
- Unidades em milímetros. A peça fica apoiada na mesa: o ponto mais baixo em z = 0.
- A 1ª linha do código é um comentário com o nome curto da peça: // Peça: Suporte de celular
- Medidas principais em variáveis no começo, com nomes em português. Círculos com $fn = 64.
- Furos e cortes passam um pouco além da superfície (0,01 a 1 mm), para não deixar película.
- Uma peça só, inteira; nada solto ou flutuando; evite balanços grandes sem apoio.

Como o OpenSCAD funciona:
- Formas NÃO são valores: não existe "x = cube(...)". Variável guarda número, vetor ou texto. Para reaproveitar forma, use module nome() { ... } e chame nome();
- cube([x, y, z]) (canto na origem), cylinder(h=, d=) ou cylinder(h=, d1=, d2=) para cone, sphere(d=), linear_extrude(height=) sobre 2D (square, circle, polygon, text), rotate_extrude() para revolução.
- union() { ... }, difference() { corpo; corte1; corte2; }, intersection(), hull().
- translate([x, y, z]) forma; rotate([ax, ay, az]) forma; for (i = [0 : n - 1]) ...
- Cada forma termina em ";" e blocos { } não levam ";".

Biblioteca do AuGPT — comece com: include <augpt.scad>
Se o pedido é uma destas peças, USE o módulo com as medidas do pedido (e acrescente o que faltar com union/difference):
- caixa(largura, profundidade, altura, parede=2, fundo=2, divisorias_x=0, divisorias_y=0, raio=0) — caixa aberta em cima; divisórias formam compartimentos iguais
- tampa(largura, profundidade, espessura=2, parede_da_caixa=2, aba=5, espessura_aba=1.5, folga=0.3, raio=0) — tampa de encaixe para a caixa (medida de fora)
- placa(largura, profundidade, espessura, raio=0) — placa, cantos arredondados com raio
- placa_com_furos(largura, profundidade, espessura, d_furo, margem=5, furos=[], raio=0) — furos nos 4 cantos a 'margem' das bordas, ou nos pontos furos=[[x,y], ...]
- furo(x, y, d, altura) — furo vertical passante (dentro de difference)
- tubo(d_externo, altura, parede=2, fundo=0) — cilindro oco; fundo > 0 vira copo
- cantoneira(aba_deitada, aba_de_pe, largura, espessura, d_furo=0) — L com furo no meio de cada aba
- gancho_j(altura=60, largura=20, espessura=4, alcance=25, ponta=15, d_furo=4, furos=2) — gancho de parede em J
- suporte_inclinado(largura=70, profundidade=80, altura_encosto=90, angulo=60, espessura=4, borda=10) — suporte de mesa para celular/tablet
- suporte_parede(largura=40, altura=50, espessura=5, braco=60, borda=10, largura_braco=20, d_furo=4) — placa de parede com braço e borda (headset, ferramenta)
- engrenagem(dentes=20, modulo=2, espessura=5, d_furo=5) — engrenagem reta de verdade
- knob(diametro=30, altura=15, d_eixo=6, chato=4.5, profundidade_furo=12, recartilhado=24) — botão com furo em D
- texto(t, tamanho, x, y, base, altura=1) — texto em relevo centrado em (x, y) sobre a altura 'base'

Responda só com o código, num bloco \`\`\`openscad.`;

const codigoDe = (t) => ((/```(?:openscad|scad)?\s*\n([\s\S]*?)```/i.exec(String(t || '')) || [])[1] || String(t || '')).trim();
const nomeDe = (codigo) => (/^\s*\/\/\s*pe[çc]a\s*:\s*(.+)$/im.exec(codigo) || [])[1]?.trim().slice(0, 60) || 'Peça 3D';
// 'huggingface.co/mradermacher/Qwen3.8-27B-GGUF:Q3_K_M' → 'Qwen3.8-27B'; 'gemma4:26b-a4b-it-qat' fica
const rotuloDoModelo = (m) => String(m || 'modelo').split('/').pop().replace(/-GGUF(:.*)?$/i, '');
const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

async function criarPeca3d({ pergunta, conversa = [], ent = {}, deps }) {
  const { chamar, emit = () => {} } = deps;
  const inicio = Date.now();
  const anterior = ajusteDaPeca(pergunta, conversa);
  const codigoAnterior = anterior && typeof deps.lerPecaAnterior === 'function' ? await deps.lerPecaAnterior(anterior).catch(() => '') : '';
  const pedido = codigoAnterior
    ? `PEÇA ATUAL:\n\`\`\`openscad\n${codigoAnterior}\n\`\`\`\nAJUSTE PEDIDO: ${pergunta}\n${/^\s*na pe[çc]a acima/i.test(pergunta) ? 'As coordenadas do pedido (x, y, z em mm) são as da peça gerada por este código, como ela fica na mesa: x = largura, y = profundidade (y menor = frente), z = altura. "Virada para" é a direção para fora da face. Mexa SÓ nessa face/nesse ponto.\n' : ''}Mande o código inteiro já ajustado (mantenha o resto da peça).`
    : pergunta;
  const msgs = [{ role: 'system', content: SISTEMA }, { role: 'user', content: pedido }];
  emit('ferramenta', { nome: 'escrever_peca_3d', argumentos: { consulta: pergunta.slice(0, 200) }, risco: 'leitura' });
  let resposta = (await chamar(msgs, { numPredict: 3000 })).content;
  let codigo = codigoDe(resposta);
  let r = await deps.compilarPeca({ codigo, nome: 'peca' });
  const historico = [];
  for (let i = 0; !r.ok && i < 2; i += 1) {
    historico.push(`erro do OpenSCAD: ${String(r.erro).split('\n')[0].slice(0, 120)}`);
    msgs.push({ role: 'assistant', content: resposta }, { role: 'user', content: `O OpenSCAD deu erro:\n${r.erro}\nCorrija e mande o código inteiro.` });
    resposta = (await chamar(msgs, { numPredict: 3000 })).content;
    codigo = codigoDe(resposta);
    r = await deps.compilarPeca({ codigo, nome: 'peca' });
  }
  if (!r.ok) {
    return { vista: '', texto: `Não consegui gerar a peça: o OpenSCAD recusou o código ${historico.length + 1} vezes (${String(r.erro).split('\n')[0].slice(0, 200)}). Tente descrever a peça de outro jeito, com as medidas principais.\n\n\`\`\`openscad\n${codigo}\n\`\`\``, fontes: [], entendimento: ent, buscou: false, produto: false, assuntos: [], modo: 'peca3d', anosSemFonte: [] };
  }
  // conferência pela foto: o modelo vê a peça de cima e de baixo, com as medidas, e corrige (só quem enxerga)
  const correcoes = [];
  for (let rodada = 0; rodada < 2 && !deps.semVisao && r.fotos?.length; rodada += 1) {
    emit('ferramenta', { nome: 'conferir_peca_3d', argumentos: { consulta: `rodada ${rodada + 1}` }, risco: 'leitura' });
    const medidas = r.caixa ? `Medidas da peça gerada (caixa envolvente, x × y × z): ${r.caixa.tam.join(' × ')} mm; ponto mais baixo em z = ${r.caixa.min[2]}.` : '';
    const rv = String((await chamar([{ role: 'system', content: SISTEMA }, { role: 'user', content: `PEDIDO: ${pergunta}${codigoAnterior ? ' (ajuste da peça anterior)' : ''}\n\nCÓDIGO ATUAL:\n\`\`\`openscad\n${codigo}\n\`\`\`\n${medidas}\nAs imagens mostram a peça gerada, de cima e de baixo. Confira com o pedido: formato, medidas, furos, partes que faltam ou sobram, peça flutuando. Se estiver certa, responda só OK. Se não, diga em uma linha o problema e mande o código corrigido inteiro.`, images: r.fotosBase64 }], { numPredict: 3000 })).content || '');
    if (/^\s*ok\b/i.test(rv) || !/```/.test(rv)) break;
    const novo = codigoDe(rv);
    const r2 = await deps.compilarPeca({ codigo: novo, nome: 'peca' });
    if (!r2.ok) break; // a correção nem gera a peça: fica a anterior
    correcoes.push(rv.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'ajuste sem explicação');
    [codigo, r] = [novo, r2];
  }
  const final = await deps.guardarPeca({ codigo, compilado: r, nome: nomeDe(codigo) });
  const segundos = Math.round((Date.now() - inicio) / 1000);
  const [x, y, z] = r.caixa?.tam || [];
  const texto = [
    `![${final.nome.replace(/[[\]\n]/g, ' ')}](${final.foto}){3d:${final.stl}}`,
    '',
    r.caixa ? `**Medidas:** ${fmt(x)} × ${fmt(y)} × ${fmt(z)} mm (largura × profundidade × altura, como fica na mesa da impressora)` : '',
    `**Arquivos** (na pasta de trabalho): \`${final.caminhos.stl}\`${final.caminhos.tresmf ? ` · \`${final.caminhos.tresmf}\`` : ''} · \`${final.caminhos.scad}\``,
    '',
    `*Feita com o OpenSCAD e o ${rotuloDoModelo(deps.modeloDaPeca)} em ${segundos} s${correcoes.length ? `; corrigida ${correcoes.length === 1 ? '1 vez' : `${correcoes.length} vezes`} depois de olhar a peça (${correcoes.join('; ').slice(0, 300)})` : deps.semVisao ? '' : '; conferida pela foto'}. Confira no fatiador antes de imprimir.*`,
    '',
    'Para mudar, é só pedir: "deixa a parede com 3 mm", "aumenta o furo para 5 mm", "arredonda os cantos".',
    '',
    '```openscad',
    codigo,
    '```',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return { vista: '', texto, fontes: [], entendimento: ent, buscou: false, produto: false, assuntos: [], modo: 'peca3d', anosSemFonte: [], pecaCriada: { nome: final.nome, caixa: r.caixa, correcoes: correcoes.length, ajuste: Boolean(codigoAnterior), caminhos: final.caminhos } };
}

module.exports = { rotuloDoModelo, pedePeca3d, ajusteDaPeca, pecaAnterior, criarPeca3d, SISTEMA, codigoDe, nomeDe };
