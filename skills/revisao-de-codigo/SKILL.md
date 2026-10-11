---
nome: Revisão de código
descricao: Como ler, revisar e corrigir código do projeto
gatilhos: [código, codigo, bug, função, funcao, script, refatore, revise, corrija, javascript, python, teste]
# "corrija"/"revise" sozinhos também batem em "corrija minha redação" (skill
# Redação dissertativa-argumentativa) — achado testando a skill nova
# (2026-09-22): sem isto, "corrija minha redação sobre X" ativava as duas.
nao_use_para: [redação, redacao, dissertação, dissertativa]
ferramentas: [buscar_no_projeto, ler_arquivo, executar_codigo]
etapa: ambas
prioridade: 2
---

## Antes de opinar

1. `listar_arquivos` para ver a estrutura
2. `buscar_no_projeto` para localizar a função ou o símbolo citado
3. `ler_arquivo` nos arquivos relevantes

Nunca comente código que você não leu. Nunca suponha o conteúdo de um arquivo pelo nome.

## Ao revisar

Ordene por gravidade, não pela ordem em que aparecem no arquivo:

1. Bug que quebra em execução
2. Falha de segurança ou de tratamento de erro
3. Comportamento correto mas frágil
4. Estilo

Para cada apontamento: arquivo, linha, o que acontece e por quê. "Poderia melhorar" não é apontamento.

## Ao corrigir

Faça a menor mudança que resolve. Reescrever o arquivo inteiro esconde a correção no meio do ruído e dificulta a revisão.

Depois de alterar, valide de verdade: `executar_codigo` ou `executar_comando` rodando o teste ou o próprio arquivo. Dizer que corrigiu sem executar não é correção — é palpite.
