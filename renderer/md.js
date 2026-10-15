'use strict';

/**
 * Renderizador de markdown mínimo, sem dependências.
 * Ordem importa: escapa TUDO primeiro, depois aplica marcação — nada que vier
 * do modelo consegue injetar HTML.
 */
(function (global) {
  const escapar = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(t) {
    return t
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-externo="1">$1</a>')
      .replace(/(^|[\s])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" data-externo="1">$2</a>');
  }

  const desescapar = (t) =>
    String(t)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');

  // specs de gráfico da última renderização, consumidas por montarGraficos
  let graficos = {};

  function render(texto) {
    graficos = {};
    const blocos = [];
    // 1. blocos de código saem de cena antes de qualquer outra regra
    let src = escapar(texto).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, codigo) => {
      // Bloco ```chart vira marcador; o Canvas é montado depois, fora do HTML.
      // O JSON NUNCA é executado — é validado e desenhado como dado.
      if (String(lang).toLowerCase() === 'chart') {
        blocos.push(`<div class="grafico-lugar" data-grafico="${blocos.length}"></div>`);
        graficos[blocos.length - 1] = desescapar(codigo);
        return `\u0000B${blocos.length - 1}\u0000`;
      }
      blocos.push(`<pre class="bloco-codigo"${lang ? ` data-lang="${lang}"` : ''}><code>${codigo.replace(/\n$/, '')}</code></pre>`);
      return `\u0000BLOCO${blocos.length - 1}\u0000`;
    });

    const linhas = src.split('\n');
    const saida = [];
    let lista = null; // 'ul' | 'ol'
    let citacao = false;

    const celulas = (linha) =>
      linha
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
    const ehSeparador = (linha) => /^\s*\|?[\s:-]*-[-\s|:]*\|?\s*$/.test(linha) && linha.includes('-');

    const fecharLista = () => {
      if (lista) {
        saida.push(`</${lista}>`);
        lista = null;
      }
    };
    const fecharCitacao = () => {
      if (citacao) {
        saida.push('</blockquote>');
        citacao = false;
      }
    };
    let cartao = false;
    const fecharCartao = () => {
      if (cartao) {
        saida.push('</section>');
        cartao = false;
      }
    };

    for (let i = 0; i < linhas.length; i += 1) {
      const linha = linhas[i];

      // Tabela. Modelos locais quase sempre intercalam linha em branco entre as
      // linhas da tabela, então pulamos vazios ao procurar separador e corpo.
      const proximaComTexto = (de) => {
        let j = de;
        while (j < linhas.length && !linhas[j].trim()) j += 1;
        return j;
      };
      const ehLinhaDeTabela = (l) => l !== undefined && l.includes('|') && l.trim().length > 2;

      if (ehLinhaDeTabela(linha) && ehSeparador(linhas[proximaComTexto(i + 1)] || '')) {
        fecharLista();
        fecharCitacao();
        const cabecalho = celulas(linha);
        const corpo = [];
        let j = proximaComTexto(proximaComTexto(i + 1) + 1);
        while (j < linhas.length && ehLinhaDeTabela(linhas[j]) && !ehSeparador(linhas[j])) {
          corpo.push(celulas(linhas[j]));
          j = proximaComTexto(j + 1);
        }
        i = j - 1;
        saida.push(
          `<table><thead><tr>${cabecalho.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
            corpo
              .map((linhaCorpo) => {
                const ajustada = [...linhaCorpo];
                while (ajustada.length < cabecalho.length) ajustada.push('');
                return `<tr>${ajustada
                  .slice(0, cabecalho.length)
                  .map((c) => `<td>${inline(c)}</td>`)
                  .join('')}</tr>`;
              })
              .join('') +
            '</tbody></table>'
        );
        continue;
      }

      if (/^\u0000BLOCO\d+\u0000$/.test(linha.trim())) {
        fecharLista();
        fecharCitacao();
        saida.push(linha.trim());
        continue;
      }

      const cabecalho = /^(#{1,4})\s+(.*)$/.exec(linha);
      if (cabecalho) {
        fecharLista();
        fecharCitacao();
        fecharCartao();
        const n = cabecalho[1].length + 1;
        // "#### 1. Nome do produto": cada opção de uma recomendação vira um
        // cartão, que vai até o próximo título
        if (cabecalho[1].length === 4 && /^\d+\.\s/.test(cabecalho[2])) {
          saida.push('<section class="cartao-produto">');
          cartao = true;
        }
        saida.push(`<h${n}>${inline(cabecalho[2])}</h${n}>`);
        continue;
      }

      // Imagem numa linha só: `![texto](augpt-img://arquivo.jpg)`. SÓ esse
      // endereço é aceito — é o app que serve o arquivo (electron/main.js), a
      // tela nunca carrega imagem direto da internet. Dentro de um cartão de
      // produto, logo depois do nome, a foto vai para ANTES do título, pra
      // ficar à esquerda do cartão inteiro.
      const imagem = /^\s*!\[([^\]]*)\]\((augpt-img:\/\/[a-z]{20,64}\.(?:jpg|png|webp))\)\s*$/.exec(linha);
      if (imagem) {
        fecharLista();
        fecharCitacao();
        const figura = `<figure class="md-figura"><img src="${imagem[2]}" alt="${imagem[1]}" loading="lazy" /></figure>`;
        const anterior = saida[saida.length - 1] || '';
        if (cartao && /^<h5>/.test(anterior)) saida.splice(saida.length - 1, 0, figura);
        // imagens seguidas fora de cartão (uma por assunto: "Tesla e Edison") viram uma galeria
        else if (!cartao && anterior.startsWith('<figure class="md-figura">')) saida[saida.length - 1] = `<div class="md-galeria">${anterior}${figura}</div>`;
        else if (!cartao && anterior.startsWith('<div class="md-galeria">')) saida[saida.length - 1] = anterior.replace(/<\/div>$/, `${figura}</div>`);
        else saida.push(figura);
        continue;
      }

      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(linha)) {
        fecharLista();
        fecharCitacao();
        saida.push('<hr />');
        continue;
      }

      const numerada = /^\s*\d+[.)]\s+(.*)$/.exec(linha);
      const marcada = /^\s*[-*+]\s+(.*)$/.exec(linha);
      if (numerada || marcada) {
        fecharCitacao();
        const tipo = numerada ? 'ol' : 'ul';
        if (lista !== tipo) {
          fecharLista();
          saida.push(`<${tipo}>`);
          lista = tipo;
        }
        saida.push(`<li>${inline((numerada || marcada)[1])}</li>`);
        continue;
      }
      fecharLista();

      const cit = /^\s*&gt;\s?(.*)$/.exec(linha);
      if (cit) {
        if (!citacao) {
          saida.push('<blockquote>');
          citacao = true;
        }
        saida.push(`<p>${inline(cit[1])}</p>`);
        continue;
      }
      fecharCitacao();

      if (!linha.trim()) continue;
      saida.push(`<p>${inline(linha)}</p>`);
    }
    fecharLista();
    fecharCitacao();
    fecharCartao();

    return saida
      .join('\n')
      .replace(/\u0000BLOCO(\d+)\u0000/g, (_, i) => blocos[Number(i)]);
  }

  /**
   * Troca os marcadores por Canvas de verdade. Chamado depois de inserir o HTML,
   * porque canvas precisa estar no documento para ter largura.
   */
  function montarGraficos(elemento) {
    if (!global.grafico) return;
    for (const lugar of elemento.querySelectorAll('.grafico-lugar[data-grafico]')) {
      const spec = graficos[lugar.dataset.grafico];
      if (spec === undefined) continue;
      lugar.replaceWith(global.grafico.criar(spec));
    }
  }

  global.md = { render, escapar, montarGraficos, get graficos() { return graficos; } };
})(window);
