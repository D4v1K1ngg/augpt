---
nome: Matemática e cálculo
descricao: Como resolver conta, porcentagem, juros, proporção e estatística sem errar
gatilhos: [quanto é, quanto e, calcule, calcular, cálculo, calculo, porcentagem, por cento, juros, desconto, média, media, soma, dividido, multiplicado, raiz, equação, equacao, proporção, regra de três]
nao_use_para: [previsão do tempo, notícia]
ferramentas: [calcular, executar_codigo]
etapa: ambas
prioridade: 3
---

## Nunca calcule de cabeça

Use `calcular` para toda conta, inclusive as que parecem óbvias. Modelo de linguagem prevê o próximo token, não executa aritmética — e erra com frequência em número grande, decimal e porcentagem composta.

Para cálculo com muitos passos, dados ou estatística, use `executar_codigo` em Python e imprima o resultado.

## Antes de calcular

Escreva a expressão completa antes de rodar. "17% de 3480 dividido por 12" vira `(3480 * 0.17) / 12` — e é isso que vai para a ferramenta.

Quando a frase for ambígua, diga qual leitura você adotou: "aumento de 20% e depois 10%" é `1.20 * 1.10`, não `1.30`.

## Contas que costumam sair erradas

- **Porcentagem sobre porcentagem**: 100 → +50% → −50% dá 75, não 100
- **Juros compostos**: `valor * (1 + taxa) ** periodos`, não `valor * taxa * periodos`
- **Regra de três com grandeza inversa**: mais operários, menos tempo — inverte o produto
- **Média de médias** não é a média do conjunto quando os grupos têm tamanhos diferentes
- **Variação percentual** usa o valor inicial como base: de 40 para 50 é +25%, não +20%

## Na resposta

Mostre a expressão, o resultado e a unidade. Uma linha por passo quando houver mais de dois.

Confira a ordem de grandeza antes de entregar: se um desconto deixou o valor maior que o original, há erro no caminho — diga isso em vez de entregar o número.

Arredonde só no fim, e diga quantas casas usou.
