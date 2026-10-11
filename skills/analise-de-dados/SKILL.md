---
nome: Análise de dados
descricao: Como analisar CSV, planilha ou conjunto de números com código
gatilhos: [csv, planilha, dados, analise, análise, calcule, estatística, média, gráfico, xlsx]
nao_use_para: [pesquisa profunda, notícia]
ferramentas: [ler_arquivo, executar_codigo, calcular]
etapa: decisao
prioridade: 2
---

## Método

1. `listar_arquivos` e `ler_arquivo` primeiro: veja o cabeçalho e as 5 primeiras linhas antes de qualquer conta.
2. Confira o formato real — separador (`,` ou `;`), decimal (`.` ou `,`), encoding, coluna de data. Arquivo brasileiro costuma vir com `;` e vírgula decimal.
3. Só então use `executar_codigo` para calcular.

## Ao escrever o script

- Sempre imprima o resultado com `print`. Script que não imprime não devolve nada ao agente.
- Trate valor vazio e linha malformada em vez de deixar estourar exceção.
- Imprima também a contagem de linhas processadas e descartadas: isso revela erro de parsing.
- Prefira a biblioteca padrão (`csv`, `statistics`). Nem toda máquina tem pandas instalado.

## Na resposta

Traga os números com unidade e o tamanho da amostra. "Média de R$ 1.240 em 372 pedidos" é análise; "a média foi alta" não é.

Aponte o que os dados NÃO permitem concluir. Amostra pequena, período curto e coluna com muitos vazios são limitações que precisam aparecer.
