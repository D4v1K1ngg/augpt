---
nome: Pesquisa na web
descricao: Método para pesquisar, escolher fontes e saber a hora de parar
gatilhos: [pesquise, pesquisa, busque, procure, descubra, quem é, o que é, quais, notícia, atual, hoje]
ferramentas: [pesquisar_e_ler, buscar_web, abrir_pagina]
etapa: decisao
prioridade: 2
sempre: true
---

## Onde procurar primeiro

Pergunta sobre o mundo (fato, notícia, produto, conceito, lugar) começa na **web**. Não gaste passo com `listar_arquivos` — a pasta de trabalho é sua área de rascunho, não uma base de conhecimento. Só olhe os arquivos locais quando o pedido citar um arquivo, ou quando você mesmo tiver gravado algo naquela sessão.

## Como pesquisar

1. Use `pesquisar_e_ler` na primeira tentativa, não `buscar_web`. Você precisa do conteúdo, não da lista de links.
2. Uma consulta bem formulada vale mais que três genéricas. Inclua o termo técnico correto e, quando fizer diferença, o ano.
3. Se o resultado vier fraco, mude as PALAVRAS da consulta. Repetir a mesma busca com mais páginas devolve o mesmo material.

## Quando parar

**Quantas fontes usar não é decisão sua.** O número vem do nível de profundidade que o usuário escolheu, e `pesquisar_e_ler` já traz a quantidade certa numa chamada só — o cabeçalho do resultado informa qual é o intervalo em vigor.

Pare e chame `responder` quando:

- O bloco SITUAÇÃO disser que o material já cobre o pedido
- Uma nova busca trouxer as mesmas páginas da anterior
- Você atingir o limite de buscas da execução

Buscar de novo porque "talvez tenha mais" é o desperdício mais comum aqui: repetir a consulta com outras palavras costuma devolver os mesmos domínios.

## Hierarquia de fontes

1. Fonte primária: órgão oficial, artigo científico, documentação do fabricante, dado bruto
2. Imprensa estabelecida e enciclopédia
3. Blog, agregador, site de conteúdo — só para complementar

Quando duas fontes divergirem em um número, diga o que cada uma afirma em vez de escolher uma calado.

## Quando a busca não acha

Nem tudo tem página na web. Pergunta conceitual ("X consegue fazer Y?", "como funciona Z?") muitas vezes volta com resultado sobre assunto vizinho.

Nesse caso, chame `responder` mesmo assim e diga no `foco` que a busca não achou material específico. A resposta será escrita com conhecimento geral, avisando disso. Continuar pesquisando com variações da mesma consulta não muda o resultado.

O que nunca fazer: montar resposta com o material vizinho fingindo que responde. Tabela de benchmarks não responde "esse programa gera PDF?".

## O que não fazer

- Não afirme nada que não estava no material lido. Se não achou, escreva que não achou.
- Não cite uma URL que você não abriu.
- Não escreva arquivo para "guardar" a resposta de uma pergunta. Pergunta se responde com `responder`.
