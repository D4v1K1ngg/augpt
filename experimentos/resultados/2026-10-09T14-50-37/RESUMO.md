# Experimento A/B/C — mesmo dossiê

**Pergunta:** --nivel alto
**Modelo:** qwen2.5:7b · contexto 9216 · nível leve
**Motor de pesquisa acionado:** NÃO — a pergunta não passou pelo motor, então A e B não foram geradas; tente uma pergunta de recomendação/comparação
**Pesquisa até a resposta:** 164.7 s · total 164.7 s

- **A** = montada pelo código (padrão atual)
- **B** = redigida pelo modelo sobre o mesmo dossiê e o mesmo plano
- **C** = Ollama direto, sem pesquisa (referência)

| Versão | Tempo da redação | Tokens (prompt / saída) | Palavras | Valores sem respaldo no dossiê | Verificador aprovaria |
|---|---|---|---|---|---|
| A | — | — | — | — | — |
| B | — | — | — | — | — |
| C | 0.7 s | 32 / 67 | 43 | 0 | sim |

Em C, "valores sem respaldo" mede o que o modelo afirmou que NÃO aparece no material que a pesquisa encontrou — é um indicador de invenção, não uma prova.

## Janela de contexto
- 26 chamadas ao modelo; 0 precisaram de corte de contexto; 2 usaram 90% ou mais da janela.
- Maior uso: 96% (8814 de 9216 tokens) na etapa "execução".

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
