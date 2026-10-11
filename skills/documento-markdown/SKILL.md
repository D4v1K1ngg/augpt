---
nome: Documento em arquivo
descricao: Como criar relatório, resumo ou documentação em arquivo
gatilhos: [crie um arquivo, salve, escreva em, gere um documento, relatório, arquivo, documente]
nao_use_para: [pdf, docx, xlsx]
ferramentas: [escrever_arquivo, ler_arquivo, listar_arquivos]
etapa: decisao
prioridade: 2
---

## Antes de escrever

`listar_arquivos` primeiro. Se o arquivo já existe, leia antes: `escrever_arquivo` sobrescreve tudo. Para acrescentar, use `acrescentar_ao_arquivo`.

Nome de arquivo em minúsculas, sem acento e sem espaço: `previsao-vitoria.md`, não `Previsão Vitória ES.txt`. Extensão `.md` para texto estruturado.

## Conteúdo

Escreva o documento inteiro numa chamada só. Criar arquivo vazio e depois preencher com `acrescentar_ao_arquivo` desperdiça um passo e costuma dar erro.

Estrutura mínima: um título `#`, seções `##`, e ao final uma seção de fontes com as URLs consultadas e a data.

## Depois de gravar

Confirme com `ler_arquivo` que o conteúdo entrou. Então chame `concluir` dizendo o nome do arquivo e o que ele contém.

Atenção: se o usuário fez uma **pergunta**, ele quer a resposta na tela, não um arquivo. Só crie arquivo quando ele pedir arquivo.
