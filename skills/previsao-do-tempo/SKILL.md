---
nome: Previsão do tempo
descricao: Como obter e apresentar previsão meteorológica de uma cidade
gatilhos: [previsão do tempo, previsao, clima, chuva, temperatura, meteorologia, vai chover, graus]
# Dois casos reais de falso positivo pelo fallback semântico (não por gatilho,
# que aqui pontua 0): pedido sobre PUBG/Unreal Engine 5 (log de 09/11, v0.5.5)
# e pedido sobre trocar notebook/RAM pra rodar modelo local (teste ao vivo,
# v0.5.6) — nenhum dos dois tem nada a ver com clima, mas o embedding da
# descrição desta skill pontuou perto o bastante pra passar do limiar antes do
# antigatilho valer também pro fallback semântico (ver `temAntigatilho` em
# src/skills/index.js). Lista curta de propósito: só os assuntos que já
# causaram problema de verdade, não uma tentativa de prever todo falso positivo futuro.
nao_use_para: [notebook, computador, hardware, placa de vídeo, placa de video, RAM, GPU, jogo, PUBG, unreal engine]
ferramentas: [pesquisar_e_ler, buscar_web]
etapa: ambas
prioridade: 3
---

## Onde buscar

Consulta: `previsão do tempo <cidade> <estado> <N> dias`.

Sites com tabela diária de mín/máx e chance de chuva funcionam melhor que os que só descrevem o céu em texto. Se a primeira fonte só trouxer frases do tipo "sol com muitas nuvens", abra a segunda: você precisa dos números.

## O que extrair de cada dia

- Data e dia da semana
- Temperatura mínima e máxima em °C
- Chance de chuva em % e volume em mm quando houver
- Vento, só se for relevante (acima de 30 km/h)

## O que ignorar

Índice de churrasco, frizz, mosquitos, vitamina D, ressecamento da pele, qualidade do ar, notícias da home, banners de localização. Nada disso é previsão do tempo — é preenchimento de página.

## Formato da resposta

Tabela markdown, um dia por linha, sem linha em branco entre as linhas:

| Dia | Mín/Máx | Chuva |
|---|---|---|
| Qui 14/08 | 21/32°C | 30% |
| Sex 15/08 | 21/26°C | 90% |

Depois da tabela, duas ou três linhas apontando o que muda no período: a virada, o dia mais quente, o fim de semana. Nada de "planeje suas atividades" nem "esperamos que ajude".
