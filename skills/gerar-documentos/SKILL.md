---
nome: Gerar PDF, Word e Excel
descricao: Como produzir docx, xlsx, pdf e html de verdade, chamando a ferramenta nativa direto
gatilhos: [html, pagina html, pdf, docx, word, excel, xlsx, planilha, apresentacao, gráfico, grafico, exporte, converta]
# Caso real (v0.5.7, teste ao vivo): pedido "crie um documento
# word com um resumo sobre X" nunca chamou `gerar_docx` — o modelo tentou
# `ler_documento` num arquivo que não existia, pesquisou na web e no fim só
# respondeu em texto, sem gerar arquivo nenhum. Corpo antigo mandava usar
# `executar_codigo` em Python (python-docx/openpyxl/reportlab), que nem
# aparece mais no catálogo de ferramentas desde que isso virou nativo — o
# modelo lia "não saem de escrever_arquivo, use Python" e não tinha pra onde
# ir. As ferramentas nativas já existiam (`src/tools/gerar.js`) muito antes
# desta correção; só a instrução aqui estava desatualizada.
ferramentas: [gerar_docx, gerar_xlsx, gerar_pdf, gerar_html]
etapa: decisao
prioridade: 3
---

Chame a ferramenta certa direto — nenhuma delas precisa de Python nem de nada instalado (gera o zip com XML por baixo, código nativo do próprio AuGPT). **Nunca use `executar_codigo`/python-docx/openpyxl/reportlab pra isso** — essas bibliotecas não fazem parte do catálogo de ferramentas, e tentar instalá-las é o motivo mais comum de o arquivo nunca sair.

## Word (.docx) — `gerar_docx`

`caminho` (ex.: "relatorio.docx"), `conteudo` (o texto inteiro em markdown — títulos com `#`, listas, tabelas, negrito, itálico), `titulo` opcional (metadado do arquivo, não aparece impresso).

## Excel (.xlsx) — `gerar_xlsx`

`caminho`, e `dados` (uma tabela em markdown ou CSV, primeira linha é o cabeçalho) — ou `abas` pra várias abas de uma vez: objeto com uma tabela por aba, ex.: `{"Vendas": "...", "Resumo": "..."}`. Número, moeda, percentual e data na tabela viram valor de verdade na planilha (soma e ordena, não fica preso como texto).

## PDF — `gerar_pdf`

`caminho`, `conteudo` em markdown (títulos, tabelas, listas viram página formatada com numeração), `titulo` opcional (impresso no topo da primeira página).

## Página HTML — `gerar_html`

`caminho`, `conteudo` em markdown, `titulo` opcional. Sai pronta pra abrir num navegador com duplo clique, sem depender de internet.

## Gráfico dentro da resposta (isso NÃO é arquivo)

`gerar_grafico` é outra ferramenta, com outro propósito: não grava nada em disco, monta um bloco que aparece desenhado na própria resposta do chat. Use quando o pedido for tipo "compare X e Y num gráfico" sem pedir arquivo nenhum. Se o pedido quer um arquivo com gráfico dentro (ex.: "um pdf com o gráfico de vendas"), não dá pra desenhar dentro do docx/xlsx/pdf nativo — descreva os números em tabela no `conteudo` do `gerar_pdf`/`gerar_docx` em vez disso, e diga isso ao usuário.

Se o pedido for especificamente por uma imagem de gráfico (.png) pra usar fora do AuGPT, aí sim não tem ferramenta nativa — use `executar_codigo` com `matplotlib` (`matplotlib.use('Agg')`, sem tela disponível) só pra esse caso específico, não pros formatos acima.

## Sempre

- Uma chamada por arquivo, com o conteúdo inteiro de uma vez — escrever vazio e completar depois desperdiça um passo.
- Depois de gerar, confirme com `listar_arquivos` antes de dizer que está pronto.
- Se o pedido não disser o formato ("gere um relatório"), pergunte ou use o que já foi mencionado na conversa; não invente Word se ninguém pediu Word.
