---
nome: Pesquisa profunda
descricao: Investigação de tema amplo com várias fontes, ângulos e checagem cruzada
gatilhos: [pesquisa profunda, pesquisa completa, investigue, levantamento, panorama, estado da arte, análise aprofundada, analise aprofundada, tudo sobre, relatório sobre, relatorio sobre, estudo sobre]
ferramentas: [pesquisar_e_ler, abrir_pagina, buscar_web, investigar_subtarefa]
etapa: ambas
prioridade: 3
---

## Ângulos, não repetição

Tema amplo pede consultas por ângulos diferentes, não a mesma consulta com outras palavras:

- o que é e como funciona
- números e dados atuais
- quem são os envolvidos
- críticas, limitações e riscos
- o que mudou recentemente

Duas buscas em ângulos distintos valem mais que cinco na mesma direção. Cada busca já traz várias fontes — o nível de profundidade define quantas.

Despache os ângulos com `investigar_subtarefa` (até 4 buscas relacionadas numa chamada só, objetivo em
comum — ex.: "levantar números atuais e críticas sobre X" com uma consulta por ângulo — devolve o
resultado já destilado) em vez de `pesquisar_e_ler` um ângulo de cada vez. Achado revisando uma execução
real (2026-09-22, "melhor fone pra PUBG"): o agente tinha essa ferramenta disponível e só a usou 1 vez em
9 buscas — o resto foi a mesma pergunta reformulada, lida em duas dezenas de blog quase idênticos.

Para tema amplo, vale sugerir ao usuário o nível **alto** no seletor do topo, que amplia o intervalo de fontes por busca.

## Diversidade de fonte

Prefira domínios diferentes entre si: órgão oficial, imprensa, publicação técnica. Cinco páginas do mesmo portal são uma fonte só.

Para dado numérico, procure a fonte primária. "Segundo reportagem que cita o IBGE" é pior que o IBGE.

## Fonte certa por tipo de dado

Fonte boa depende do que você tira dela: especificação/compatibilidade → fabricante; medição/desempenho →
teste técnico; uso/conforto/durabilidade → comunidade; preço → loja/mercado agora. Comunidade é ruim pra
"qual a latência exata" e ótima pra "trava depois de um tempo?" — não valide tudo na mesma fonte.

## Quando as fontes discordam

Não escolha em silêncio. Diga o que cada uma afirma, com a data de cada uma, e qual é mais recente ou mais
próxima da origem — vale pra opinião também, não só número.

## Estrutura da resposta

1. Resposta direta em duas ou três linhas — quem só ler isso já sai sabendo
2. O que os dados mostram, com números e datas
3. Onde há controvérsia ou incerteza
4. O que não foi possível apurar

Marque cada afirmação com o número da fonte. Ponto com fonte única deve ser dito como tal — não afirme com o mesmo tom do que foi confirmado por três.
