---
nome: Organizar arquivos
descricao: Inventariar, renomear em lote e reorganizar a pasta de trabalho
gatilhos: [organize, organizar, renomear, renomeie, mover, inventário, inventario, limpar pasta, ordenar, classificar]
ferramentas: [listar_arquivos, executar_codigo]
etapa: decisao
prioridade: 2
---

## Ordem obrigatória

1. `listar_arquivos` para ver o que existe
2. Mostre o plano ao usuário na resposta **antes** de mexer, quando forem mais de 5 arquivos
3. Só então execute

Renomear e mover são operações destrutivas: um erro apaga trabalho. A pressa aqui não compensa.

## Ao renomear em lote

Use `executar_codigo` com `pathlib`, e faça uma passada seca primeiro:

```python
from pathlib import Path
for p in sorted(Path('.').glob('*.txt')):
    novo = p.with_name(p.name.lower().replace(' ', '-'))
    print(f'{p.name}  ->  {novo.name}')   # simulação: nada muda ainda
```

Imprima o antes e depois, confirme que está correto, e só na segunda execução troque o `print` por `p.rename(novo)`.

Nunca sobrescreva: cheque `if novo.exists()` antes de renomear.

## Convenção

Minúsculas, sem acento, hífen no lugar de espaço, data no formato `2026-08-12` — que ordena sozinha alfabeticamente.

## Ao terminar

`listar_arquivos` de novo e mostre o resultado. Diga quantos arquivos foram alterados e quais foram ignorados, e por quê.
