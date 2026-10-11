---
nome: Escrever e depurar código
descricao: Como criar código novo e interpretar erro de execução
gatilhos: [crie uma função, escreva um script, escreva um código, escreva um codigo, faça um programa, implemente, erro, exception, traceback, stack trace, não funciona, nao funciona, undefined, syntax error, depurar, debugar]
nao_use_para: [revise, revisão do código]
ferramentas: [executar_codigo, escrever_arquivo, ler_arquivo, buscar_no_projeto]
etapa: ambas
prioridade: 3
---

## Escrever código novo

1. Confirme a linguagem e a versão pelo que o usuário disse ou pelo que existe na pasta
2. Escreva a versão mais simples que resolve — sem abstração que ninguém pediu
3. **Execute com `executar_codigo` antes de entregar**, com um caso normal e um de borda
4. Só então grave em arquivo, se for o pedido

Código que não foi executado é palpite. Entregar palpite como solução é o erro mais comum aqui.

## Depurar erro

Leia a mensagem inteira, de baixo para cima: a última linha diz o quê, as anteriores dizem onde.

- `undefined is not a function` — o nome existe mas não é função ali: import errado, typo, ou objeto diferente do esperado
- `cannot read property de undefined` — algo na cadeia veio vazio; encontre qual elo, não conserte o sintoma
- `ENOENT` — caminho errado, quase sempre relativo à pasta errada
- `SyntaxError` — o erro costuma estar na linha ANTERIOR à apontada

Reproduza o menor caso possível antes de corrigir. Se não conseguiu reproduzir, ainda não entendeu o problema.

## Antes de entregar

Rode de novo depois da correção. Diga o que mudou e por quê, uma linha por alteração.

Se o código depende de biblioteca que pode não estar instalada, dê o comando de instalação junto.
