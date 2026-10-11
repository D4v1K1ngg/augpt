# Bancada de avaliação

```bash
npm run avaliar                     # todos os casos · ~1 segundo
npm run avaliar -- --grupo=loop     # só um grupo
npm run avaliar -- --caso=boleto    # casos cujo nome contém o texto
npm run avaliar -- --verboso        # passos e tamanho da resposta por caso
npm run avaliar -- --real           # contra o seu Ollama: mede, não afirma
```

Sai com código 1 se algum caso falhar, então serve em hook de commit ou CI.

## O que ela testa

Não a inteligência do modelo — isso não é determinístico. Ela testa **tudo em volta**: como o loop reage quando o modelo devolve campo vazio, erra o nome de um arquivo, repete a mesma busca ou responde fora do protocolo. Foi exatamente ali que moraram todos os bugs encontrados até aqui.

Um servidor falso responde no lugar do Ollama seguindo um roteiro fixo. Mesmo caso, mesmo resultado, sempre.

## Escrever um caso

```js
{
  nome: 'responder com campo vazio ainda entrega resposta',
  pedido: 'Analise a nota anexada',
  arquivos: { 'nota.txt': 'Valor de R$ 1.240,00 pagos em 12/08.' },
  roteiro: [
    { ferramenta: 'ler_arquivo', argumentos: { caminho: 'nota.txt' } },
    { ferramenta: 'responder', argumentos: { resposta: '' } },   // falha proposital
  ],
  redacao: 'O documento registra R$ 1.240,00 pagos em 12/08.',
  espera: {
    passos: { max: 3 },
    respostaContem: ['1.240,00'],
    perguntouAoUsuario: false,
  },
}
```

O `roteiro` é o que o modelo falso "decide" a cada passo. Uma string crua no lugar do objeto simula resposta fora do protocolo. `redacao` pode ser função `(prompt, tentativa) => texto`, útil para simular resposta curta seguida de resposta completa.

## Afirmações disponíveis

| Afirmação | Verifica |
|---|---|
| `ok` | a execução terminou com sucesso |
| `passos` | `{ max, min }` de iterações |
| `ferramentasChamadas` / `ferramentasNaoChamadas` | quais rodaram |
| `perguntouAoUsuario` | se interrompeu para perguntar |
| `aprovacoesPedidas` / `semAprovacaoPara` | portão de aprovação |
| `respostaContem` / `respostaNaoContem` / `respostaLinhasMin` | conteúdo entregue |
| `promptDecisaoContem` / `promptDecisaoNaoContem` / `promptRedacaoContem` | o que chegou ao modelo |
| `skillsAtivadas` / `skillsNaoAtivadas` | roteamento de skills |
| `coberturaNivel` | `boa`, `parcial` ou `ausente` |
| `eventos` | `protocolo-invalido`, `limite`, `redigindo`… |
| `erroContem` | mensagens de erro das ferramentas |
| `arquivosCriados` | estado final da pasta |

Casos de unidade (`tipo: 'unidade'`) não passam pelo agente: têm uma função `executar()` que devolve uma lista onde `true` é sucesso e string é a falha.

## Regressão

O resultado fica em `ultimo-resultado.json`. A execução seguinte compara e avisa:

```
REGRESSÃO: nome de arquivo com letra trocada é resolvido
corrigidos: ferramenta desativada some do catálogo
execução anterior: 35/36 em 1s
```

## O limite honesto

A bancada pega **regressão no nosso código**. Ela não descobre que o modelo passou a errar de um jeito novo — isso continua vindo dos seus logs. Quando aparecer um, o caminho é: virar caso aqui, ver falhar, corrigir, ver passar.
