# Ajustes de 10/10/2026 — para revisar antes de aplicar

Três ajustes no AuGPT, feitos numa cópia e testados com a bancada:
`npm run avaliar` deu **794/800**. As 6 falhas são os casos do `ollama-runtime`
que dependem de `tasklist`/`setx` do Windows e falham igual no projeto
original fora do Windows. No seu PC devem passar.

## O que mudou

1. **Roteador híbrido com o Tev1** (`src/agent/roteador.js`, novo)
   - Vem **desligado**. Para ligar: Ajustes → Pesquisa na web → "Modelo de decisão confere o tipo do pedido".
   - Simulado com o código real sobre os seus 230 pedidos de 08/10: rota de 80,0% para 93,9% com o `tev1` (4B), e 87,8% com o `tev1:0.8b`.
   - Sugestão: um `tev1-cpu` (Modelfile com `PARAMETER num_gpu 0`), para não disputar a placa com o Qwen.
   - Se o modelo não responder ou não estiver instalado, as regras decidem como hoje.
2. **Retomada completa** (`src/agent/retomada.js`, novo)
   - Execução interrompida → a seguinte na mesma conversa não baixa nem destila de novo as páginas já lidas (até 12 h).
   - Fica em `<pasta de trabalho>/.augpt/retomada/`.
   - Só leitura da web pública: arquivos seus e páginas logadas do navegador do app não entram.
3. **Erro temporário × definitivo** (`src/tools/erros.js`, novo)
   - HTTP 429/5xx e conexão derrubada ganham uma segunda tentativa automática, só em busca e leitura de página.
   - 404, 403, endereço bloqueado e arquivo inexistente voltam ao modelo marcados como "erro definitivo", e a mesma chamada fica bloqueada.

O registro de cada execução passa a guardar quem decidiu a rota (`tipoDePedido.fonte`) e o que foi retomado (`retomada`). Com isso dá para medir no uso real se o Tev1 está ajudando.

## Como aplicar

- **Opção A:** copie o conteúdo de `arquivos/` por cima da raiz do projeto. A estrutura de pastas é a mesma.
- **Opção B:** com Git, rode `git apply _revisao-2026-10-10/ajustes-2026-10-10.patch` na raiz do projeto.

Depois rode `npm run avaliar` e confira. Os detalhes técnicos estão no `docs/ARQUITETURA.md`, seção "Ajustes de 10/10/2026".
