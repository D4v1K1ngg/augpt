---
nome: Comparar preços e produtos
descricao: Como pesquisar produto, comparar preço entre lojas e não cair em falso desconto
gatilhos: [preço, preco, quanto custa, mais barato, comprar, oferta, promoção, promocao, desconto, loja, comparar preços, comparar precos, vale a pena comprar, black friday]
ferramentas: [buscar_produtos, historico_precos, navegar, abrir_pagina, gerar_grafico]
nao_use_para: [previsão do tempo, notícia]
etapa: ambas
prioridade: 3
---

## O caminho

1. `buscar_produtos` com o nome mais específico possível — "RTX 5070 12GB", não "placa de vídeo"
2. Se as lojas grandes não entregarem preço, `navegar` na página do produto: a janela abre e o preço lido é o que está na tela
3. `historico_precos` quando o usuário perguntar se está barato, ou quando houver "de X por Y"

## O que nunca fazer

**Nunca diga "o melhor preço da internet".** Você consultou algumas lojas, não a internet. A frase correta é "o menor preço entre as fontes consultadas".

**Sempre informe a data e a hora da consulta.** Preço muda a qualquer momento, e uma resposta sem data envelhece sem avisar.

**Preço não confirmado não é preço atual.** Se veio de resumo de busca e a página não abriu, diga isso — "encontrado em resultado de busca, não confirmado na loja".

**Frete muda o resultado.** Se não foi apurado, avise que o total pode subir. Comparar preço sem frete é a forma mais comum de um comparativo enganar.

## Produtos diferentes não se comparam

Modelo, capacidade, cor e voltagem mudam o preço. Antes de dizer que uma loja está mais barata, confira que é o mesmo produto. Na dúvida, apresente separado e diga que podem ser variações diferentes.

Vendedor terceiro em marketplace não é a loja: cite quem vende.

## Falso desconto

"De R$ 5.999 por R$ 2.999" só significa alguma coisa se o produto já foi vendido por R$ 5.999. Use `historico_precos`: se o preço "de" for maior que o máximo já observado, ou se o "por" for o patamar de sempre, diga que o desconto não se sustenta.

Sem histórico suficiente, não afirme nem desminta — diga que não há base para avaliar.

## Na resposta

Tabela com loja, produto, preço e confiança. Depois dela, o menor preço em destaque com o link, a data da consulta e as ressalvas que couberem.

Gráfico só quando houver histórico de vários dias — comparação entre 4 lojas cabe na tabela.
