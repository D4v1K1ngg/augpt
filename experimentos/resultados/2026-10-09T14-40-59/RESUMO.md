# Experimento A/B/C — mesmo dossiê

**Pergunta:** Quais são os 5 melhores fones intra-auriculares (IEM) para jogar PUBG no PC? Explique os critérios do ranking, as vantagens e limitações de cada um e a recomendação final.
**Modelo:** qwen2.5:7b · contexto 9216 · nível leve
**Motor de pesquisa acionado:** sim (modo recomendacao)
**Pesquisa até a resposta:** 119.0 s · total 132.5 s

- **A** = montada pelo código (padrão atual)
- **B** = redigida pelo modelo sobre o mesmo dossiê e o mesmo plano
- **C** = Ollama direto, sem pesquisa (referência)

| Versão | Tempo da redação | Tokens (prompt / saída) | Palavras | Valores sem respaldo no dossiê | Verificador aprovaria |
|---|---|---|---|---|---|
| A | 2.0 s | 414 / 178 | 644 | 1 | não |
| B | 11.5 s | 4610 / 915 | 431 | 1 | não |
| C | 9.2 s | 80 / 879 | 500 | 3 | não |

Em C, "valores sem respaldo" mede o que o modelo afirmou que NÃO aparece no material que a pesquisa encontrou — é um indicador de invenção, não uma prova.

## Janela de contexto
- 36 chamadas ao modelo; 0 precisaram de corte de contexto; 0 usaram 90% ou mais da janela.
- Maior uso: 63% (5771 de 9216 tokens) na etapa "execução".

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
