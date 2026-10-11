---
nome: Comparativo
descricao: Como comparar produtos, ferramentas ou alternativas
gatilhos: [compare, comparar, comparativo, versus, vs, melhor, diferença, qual escolher, opções, alternativas]
nao_use_para: [migrar, decidir, devo, vale a pena]
ferramentas: [pesquisar_e_ler, calcular, investigar_subtarefa]
etapa: ambas
prioridade: 2
---

## Antes de qualquer coisa: o pedido também pede um arquivo?

Se o pedido tiver "planilha", "xlsx", "pdf", "docx", "word", "exporte", "gere um arquivo" ou parecido — caso real e comum: "compare 3 X e gere uma planilha com o comparativo" é literalmente um dos exemplos sugeridos na tela inicial do AuGPT — **PARE**: a tabela do "## Formato" abaixo é só pra aparecer solta no chat, e sozinha ela NÃO satisfaz um pedido de arquivo. Gere o arquivo de verdade com `gerar_xlsx`/`gerar_pdf`/`gerar_docx` (skill "Gerar PDF, Word e Excel") — a mesma tabela critério×opção vira `dados` ou `conteudo` dela. Só siga pro formato de tabela solta abaixo quando **ninguém** pediu arquivo nenhum.

## Antes de comparar

Defina os critérios que importam para o uso descrito. Comparar por critério errado é pior que não comparar: preço não importa para quem perguntou sobre latência.

Pesquise cada item separadamente. Uma busca do tipo "A vs B vs C" devolve resenha rasa dos três.

Prefira despachar as buscas dos itens com `investigar_subtarefa` (até 4 de uma vez, um objetivo em
comum — ex.: "levantar características técnicas dos finalistas", uma consulta por item — devolve o
resultado já destilado) em vez de `pesquisar_e_ler` um item de cada vez: mesma pesquisa item-a-item, menos
rodadas de decisão gastas repetindo a mesma busca genérica.

## Fonte certa por critério

Cada critério pode pedir fonte diferente, não a mesma fonte "confiável" pra tudo: especificação/
compatibilidade → fabricante; medição/desempenho → teste técnico; conforto/durabilidade → comunidade e uso
prolongado; preço → loja atual. Fonte ótima pra um critério pode não servir pro outro.

## Formato

Tabela com uma linha por critério e uma coluna por item — nunca o contrário, porque critério é o que se lê de lado a lado:

| Critério | Opção A | Opção B |
|---|---|---|
| Preço | R$ 400 | R$ 650 |
| Pontos fortes | ... | ... |

Datas e preços mudam: registre quando o dado foi consultado.

## Depois da tabela

Recomende. Uma tabela sem conclusão devolve o trabalho ao usuário.

Escreva em duas ou três linhas para quem serve cada opção — "A se você prioriza X, B se o orçamento permitir Y" — e diga qual você escolheria no cenário descrito.

Se faltou dado de algum item, escreva que faltou em vez de deixar a célula em branco.
