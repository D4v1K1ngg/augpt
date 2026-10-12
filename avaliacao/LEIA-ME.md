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

## Medição de qualidade (`npm run qualidade`)

A bancada acima diz se o código em volta do modelo quebrou. Ela não diz se a resposta que o usuário recebe é boa. Para isso existe a medição de qualidade: roda o agente **de verdade** (Ollama, internet, os seus Ajustes) num conjunto fixo de perguntas, e um modelo-juiz dá nota de 0 a 10 a cada resposta.

```bash
npm run qualidade                        # as 45 perguntas (cerca de 1 hora)
npm run qualidade -- --so=explicacao     # só um tipo: explicacao, fato, produto, guia
npm run qualidade -- --id=gerador,lua    # só estas
npm run qualidade -- --juiz=qwen2.5:14b  # modelo que corrige (padrão: qwen2.5:14b, se instalado)
npm run qualidade -- --modelo=qwen2.5:7b # modelo do agente (padrão: o dos Ajustes)
```

Como a nota é dada:

- Cada pergunta de `qualidade/perguntas.js` tem um gabarito: `fatos` que a resposta deve trazer e, para pedidos sem resposta única (recomendação, preço), `criterios` que ela deve cumprir.
- O juiz não avalia de cabeça. Ele marca cada fato como presente, ausente ou contradito e cada critério como cumprido ou não; a conta é do código: `10 × itens atendidos ÷ itens`, menos 3 pontos por fato contradito.
- Antes de corrigir, o juiz é **calibrado**: recebe respostas erradas de propósito (campo `errada`), o próprio gabarito e um "não sei". Se não der nota baixa, alta e zero, a rodada para — troque o modelo em `--juiz`.

Cada rodada grava em `qualidade/resultados/` (fora do Git) a nota, o tempo, os passos, quem respondeu a busca e a resposta inteira, e compara com a rodada anterior nas perguntas em comum. Rode antes e depois de uma mudança no agente: é o que mostra se ela melhorou a resposta ou só deixou mais lento.

Limites: o juiz é um modelo local e erra; a nota vale como comparação entre rodadas, não como verdade absoluta. Pergunta de preço ou recomendação muda com o dia. Ao acrescentar pergunta, use fato curto e estável.

### Pesquisas de produto: rode pelo Electron

```bash
npm run qualidade:app -- --id=fones-pubg
```

No Node puro (`npm run qualidade`) a medição não lê páginas que precisam de JavaScript — entre elas os tópicos do Reddit, que o agente usa como a principal evidência numa recomendação. A resposta sai, mas montada só com listas de sites, e a nota não representa o app. `qualidade:app` roda a mesma medição dentro do Electron, com a leitura de páginas igual à do app. Para explicações e fatos diretos, o Node puro basta.

Cada resultado guarda também para onde foi o tempo: segundos no modelo e nas ferramentas, chamadas por tipo e quantas destilações voltaram sem nenhum fato.

### Rodadas repetidas, checagens por código e rodada noturna

```bash
npm run qualidade:app -- --rodadas=3     # cada pergunta 3 vezes; a nota é a média
npm run qualidade:agendar                # agenda a medição para toda madrugada (03:00)
npm run qualidade:agendar -- --remover   # desfaz
```

- **`--rodadas=N`** (até 5): a mesma pesquisa de produto variou de 212 s a 336 s entre execuções. Com uma rodada só não dá para separar melhora de sorte; com três, a nota e o tempo são a média e as três notas aparecem ao lado.
- **`checagens`** no gabarito: o que dá para conferir pelo texto, o código confere, sem juiz — cinco opções numeradas, nenhuma opção de outro tipo, citações com a origem, preço em reais. Entram na nota como os critérios. Nasceram de um caso real: só com critérios para o juiz, uma recomendação sem nenhuma citação da comunidade tirou 10.
- **`qualidade:agendar`** cria uma tarefa no Agendador do Windows (em Linux e macOS, mostra a linha do crontab). O computador precisa estar ligado e o Ollama aberto.
