---
nome: Navegação com interação
descricao: Quando o site exige login, clique ou preenchimento para chegar ao dado
gatilhos: [login, entrar no site, preencher formulário, preencher formulario, clicar, botão, botao, painel, portal, sistema interno, área do cliente, area do cliente, consultar no site, extrato online]
ferramentas: [navegar, ver_pagina, clicar, preencher_campo, enviar_formulario, abrir_pagina]
etapa: decisao
prioridade: 3
---

## Antes de abrir o navegador

Tente `abrir_pagina` primeiro. Ela é muito mais rápida e resolve a maioria dos casos. O navegador interativo só se justifica quando:

- a página exige login
- o dado só aparece depois de clicar ou preencher algo
- há paginação ou busca dentro do site

Abrir o navegador para ler uma página pública é desperdício e ainda pede aprovação ao usuário.

## O ciclo

Sempre o mesmo: **ver → agir → ver de novo**.

1. `navegar` na URL — devolve o texto e os elementos numerados
2. Escolha o número do elemento e use `clicar` ou `preencher_campo`
3. A ferramenta já devolve a página atualizada — **a numeração muda a cada ação**

Nunca reutilize um número de uma leitura anterior. Se ficou em dúvida, `ver_pagina` renumera.

## Formulários

Preencha todos os campos primeiro, um `preencher_campo` por vez, e só então `enviar_formulario` apontando um dos campos.

Campo marcado como "de senha" é do usuário. **Não invente credencial e não preencha senha.** Se a página pedir login, pare e use `perguntar_usuario`: a janela está aberta na tela dele, ele entra, e você segue dali — a sessão continua válida.

## Limites

Cada clique custa uma aprovação e alguns segundos. Planeje o caminho mais curto até o dado em vez de explorar o site.

Se depois de três ações você não chegou mais perto, diga o que encontrou e o que faltou. Vagar por um site é a forma mais cara de não responder.

Não clique em "confirmar", "comprar", "excluir" ou "enviar" nada que tenha efeito real sem que o usuário tenha pedido exatamente isso.
