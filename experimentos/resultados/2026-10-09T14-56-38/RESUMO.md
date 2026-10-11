# Experimento A/B/C — mesmo dossiê

**Pergunta:** Quais são os 5 melhores fones intra-auriculares (IEM) para jogar PUBG no PC? Explique os critérios do ranking, as vantagens e limitações de cada um e a recomendação final.
**Modelo:** qwen2.5:7b · contexto 9216 · nível leve · leitura com JavaScript ligada
**Motor de pesquisa acionado:** sim (modo recomendacao)
**Pesquisa até a resposta:** 154.1 s · total 167.7 s
**Fontes da comunidade no dossiê:** reddit.com, clubedohardware.com.br (de 19 domínios lidos)

- **A** = montada pelo código (padrão atual)
- **B** = redigida pelo modelo sobre o mesmo dossiê e o mesmo plano
- **C** = Ollama direto, sem pesquisa (referência)

| Versão | Tempo da redação | Tokens (prompt / saída) | Palavras | Valores sem respaldo no dossiê | Verificador aprovaria |
|---|---|---|---|---|---|
| A | 3.5 s | 751 / 305 | 864 | 1 | não |
| B | 10.0 s | 4610 / 749 | 363 | 1 | não |
| C | 14.2 s | 80 / 1323 | 597 | 3 | não |

Em C, "valores sem respaldo" mede o que o modelo afirmou que NÃO aparece no material que a pesquisa encontrou — é um indicador de invenção, não uma prova.

## Janela de contexto
- 37 chamadas ao modelo; 0 precisaram de corte de contexto; 0 usaram 90% ou mais da janela.
- Maior uso: 59% (5477 de 9216 tokens) na etapa "execução".

Observação: B recebeu o dossiê e o plano da resposta, mas não a observação do crítico pré-redação que o caminho "redigido" normal receberia. Ações negadas pelo modo sem interface: nenhuma.

## Como avaliar (antes de abrir o gabarito)

Leia as três respostas em cego/ e dê uma nota de 1 a 5 em cada critério:

| Critério | O que olhar |
|---|---|
| Correção factual | Os produtos existem? Specs, preços e afirmações batem com o dossie.md? |
| Fundamentação | As afirmações importantes vêm do material (fontes, comentários) ou parecem "de cabeça"? |
| Fidelidade ao pedido | Responde o que foi pedido: 5 opções, critérios, prós/contras, recomendação final? |
| Raciocínio | Explica POR QUE cada opção entrou e por que nessa ordem, ligando ao uso (FPS, passos, posicionamento)? |
| Naturalidade | Lê como um especialista explicando, ou como um formulário preenchido? |
| Utilidade | Depois de ler, você saberia o que comprar? |

Só depois de anotar as notas, abra gabarito.json para ver qual resposta era A, B e C.
