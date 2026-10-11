# AuGPT — arquitetura e decisões de projeto

> Este documento era o README original do projeto. Ele explica **como** o AuGPT funciona por dentro e **por que** cada peça existe. Para instalar e usar, veja o [README](../README.md).
>
> Alguns números aqui (quantidade de ferramentas, skills e casos de teste) são de versões anteriores e podem estar desatualizados; o README principal traz os valores atuais.

Agente autônomo de desktop no estilo AutoGPT, com o modelo de linguagem rodando **localmente** via Ollama (a pesquisa na web, naturalmente, usa a internet — ver "Segurança e rede" no README). Electron + Node.js, sem dependência de runtime além do próprio Electron.

Você escreve um objetivo. O agente decide os passos, executa ferramentas reais no seu computador e mostra cada decisão na trilha de execução — o que pensou, a ação que escolheu, o risco que enxergou e o que aconteceu de fato.

---

## Instalação

```bash
# 1. Ollama rodando com pelo menos um modelo instruído
ollama pull llama3.1          # ou qwen2.5:7b, mistral-nemo…
ollama pull nomic-embed-text  # opcional: liga a memória vetorial

# 2. O app
npm install
npm start
```

Sem o `nomic-embed-text` o agente continua funcionando: a memória cai automaticamente para similaridade léxica.

**Modelos:** o protocolo exige JSON estruturado a cada passo. Modelos com 7B+ parâmetros seguem bem; abaixo disso o loop gasta iterações se corrigindo. O app usa `format: "json"` do Ollama para forçar saída válida.

---

## Como funciona

```
objetivo
   ↓
┌─────────────────────────────────────────────┐
│  monta contexto                             │
│  system + memória relevante + resumo +      │  ← memória vetorial (top-k)
│  últimas trocas                             │
├─────────────────────────────────────────────┤
│  Ollama /api/chat (format: json)            │
├─────────────────────────────────────────────┤
│  pensamento · raciocínio · plano · crítica  │  ← vai para a trilha
│  ferramenta: { nome, argumentos }           │
├─────────────────────────────────────────────┤
│  portão de aprovação                        │  ← manual / guiado / automático
├─────────────────────────────────────────────┤
│  execução na sandbox → resultado            │
├─────────────────────────────────────────────┤
│  grava na memória · realimenta o histórico  │
└──────────────────┬──────────────────────────┘
                   └──→ repete até concluir() ou bater o limite de passos
```

Quando o histórico passa da janela de contexto, as mensagens antigas são resumidas pelo próprio modelo e o loop continua sem estourar o `num_ctx`.

### Arquivos

```
electron/
  main.js          processo principal: janela, IPC, orquestração do agente
  preload.js       contextBridge — a única superfície exposta ao renderer
src/
  config.js        preferências persistidas em userData
  llm/ollama.js    cliente HTTP: chat, embeddings, tags, version
  agent/
    loop.js        o ciclo: raciocinar → aprovar → executar → memorizar
    prompts.js     prompt de sistema e protocolo JSON
    memory.js      memória vetorial com fallback léxico
    memoria-operacional.js  fatos de evento + reflexão de estratégia (pasta de trabalho)
    memoria-central.js      fatos duráveis sobre o usuário (nível do app, entre pastas)
  skills/
    index.js       leitor de SKILL.md, seleção por gatilho
  tools/
    index.js       catálogo, despacho e política de aprovação
    sandbox.js     jail de caminhos da pasta de trabalho
    files.js  web.js  code.js  shell.js
renderer/
  index.html  styles.css  app.js  md.js
skills/
  pesquisa-web/SKILL.md   previsao-do-tempo/SKILL.md   texto-longo/SKILL.md
  comparativo/SKILL.md    analise-de-dados/SKILL.md    documento-markdown/SKILL.md
  revisao-de-codigo/SKILL.md
```

---

## Ferramentas

| Ferramenta | Risco | O que faz |
|---|---|---|
| `listar_arquivos` | baixo | Lista a pasta de trabalho |
| `ler_arquivo` | baixo | Lê texto (trunca em 60k caracteres) |
| `buscar_no_projeto` | baixo | Procura um termo em todos os arquivos |
| `ler_documento` | baixo | PDF, docx, xlsx, pptx, odt, ePub, RTF, CSV, JSON |
| `inspecionar_arquivo` | baixo | Formato e prévia sem carregar o conteúdo |
| `calcular` | baixo | Aritmética exata (ferramenta externa de exemplo) |
| `buscar_web` | baixo | Busca com cadeia de provedores gratuitos |
| `abrir_pagina` | baixo | Lê uma URL em camadas até conseguir o texto |
| `pesquisar_e_ler` | baixo | Busca e já lê as páginas mais promissoras |
| `responder` | baixo | Entrega a resposta final em markdown e encerra |
| `salvar_memoria` | baixo | Guarda um fato na memória de longo prazo (desta tarefa) |
| `atualizar_memoria_central` | baixo | Guarda um fato duradouro sobre o usuário (vale para qualquer pasta) |
| `perguntar_usuario` | baixo | Devolve a palavra a você no meio do loop |
| `concluir` | baixo | Encerra a execução |
| `escrever_arquivo` | médio | Cria ou sobrescreve |
| `acrescentar_ao_arquivo` | médio | Acrescenta texto ao final de arquivo de texto (antes `anexar_arquivo`; recusa conteúdo vazio e mídia) |
| `apagar_arquivo` | alto | Remove um arquivo |
| `executar_codigo` | alto | Roda um script Python ou Node |
| `executar_comando` | alto | Roda um comando de terminal |

## Ferramentas modulares

Um arquivo `.js` numa pasta de ferramentas vira uma ferramenta — sem tocar no código do app:

```js
module.exports = {
  name: 'minha_ferramenta',        // minúsculas, números e _
  risk: 'baixo',                   // baixo (não pede aprovação) | medio | alto
  description: 'o que faz',        // entra no catálogo do prompt
  args: { parametro: 'descrição vista pelo modelo' },
  async run({ parametro }, ctx) { return 'resultado em texto'; },
};
```

O `ctx` traz `sandbox` (jail da pasta de trabalho), `config`, `memory`, `emit`, `ask`, `render`, `objetivo` e `estado`. Devolva sempre string; para erro, lance `Error` com mensagem clara.

**Dependências declaradas.** Uma ferramenta pode depender do que não vem no pacote:

```js
requer: ['python:docx', 'cmd:git', 'node:playwright']
```

O registry confere na carga, marca a ferramenta como indisponível, tira ela do catálogo do prompt e mostra o comando de instalação no painel. Sem isso o modelo só descobre no erro, gastando um passo e às vezes concluindo que a tarefa é impossível. As ferramentas `gerar_docx`, `gerar_xlsx` e `gerar_pdf` usam esse mecanismo.

**Skills declaram ferramentas.** No frontmatter, `ferramentas: [ler_documento, calcular]` garante que elas apareçam no catálogo quando a skill for ativada — é a skill dizendo de que a tarefa depende. É também o que permitirá, mais adiante, um catálogo seletivo sem esconder a ferramenta certa do modelo.

Duas origens, como nas skills: `ferramentas/` no app e `ferramentas/` nos dados do usuário. Copie `ferramentas/_MODELO.js` (arquivos com `_` são ignorados), edite, e clique em **Recarregar** na aba Skills > Ferramentas. Sem reiniciar.

O carregador valida nome, campos obrigatórios e duplicidade. Ferramenta quebrada não derruba o app: o erro aparece no painel e as demais seguem funcionando. Cada ferramenta pode ser ligada e desligada individualmente — exceto `responder` e `concluir`, sem as quais o loop não fecha.

## Navegação com interação

Quando a página exige login, clique ou preenchimento, `abrir_pagina` não basta. As ferramentas `navegar`, `clicar`, `preencher_campo` e `enviar_formulario` abrem uma janela de navegador de verdade e agem nela.

**Sem dependência nova**: o Electron já embute o Chromium. Trazer um Playwright significaria baixar um segundo navegador por uma capacidade que a plataforma já oferece.

Duas decisões que mudam a usabilidade:

**A janela é visível.** Site com login é justamente o caso que a renderização offscreen não resolve — e para logar, o usuário precisa ver a tela. Ele entra uma vez, o agente continua dali, e a sessão fica salva entre execuções.

**Os elementos são numerados, não endereçados por seletor CSS.** A leitura devolve:

```
ELEMENTOS INTERAGÍVEIS (use o número):
[1] campo "usuário"
[2] campo de senha "senha"
[3] botão "Entrar"
```

Modelo de 8B não escreve seletor CSS confiável, mas acerta "clicar no 3" sem esforço. A numeração é refeita a cada ação, porque a página muda.

**Toda ação pede aprovação** — o navegador age na web com as **suas** sessões abertas. Clicar em "confirmar" logado é irreversível como qualquer comando de terminal. Só `ver_pagina` passa direto: reler a tela não muda nada.

A skill de navegação orienta a tentar `abrir_pagina` primeiro (mais rápido e sem aprovação), nunca preencher campo de senha, e parar depois de três ações sem progresso.

## Servidores MCP

O AuGPT é **cliente MCP** (Model Context Protocol). Um servidor MCP entrega várias ferramentas prontas — sistema de arquivos, Git, GitHub, banco de dados, APIs —, e cada uma entra no catálogo como qualquer outra ferramenta do projeto.

Configure em **Skills → Ferramentas → Servidores MCP**:

| Campo | Exemplo |
|---|---|
| nome | `arquivos` |
| comando | `npx` |
| argumentos | `-y @modelcontextprotocol/server-filesystem /home/user/docs` |

O botão **Testar** conecta e lista as ferramentas antes de você salvar.

MCP é JSON-RPC 2.0 com mensagens delimitadas por quebra de linha, e são três chamadas que importam: `initialize`, `tools/list` e `tools/call`. Por isso o cliente cabe em um arquivo e **não trouxe nenhuma dependência** — o que mantém a promessa do projeto.

**Segurança.** Toda ferramenta vinda de MCP entra com **risco alto**, e isso não é excesso de zelo: o servidor é um processo externo rodando com os seus privilégios, e o AuGPT não tem como saber o que cada ferramenta faz. Ela sempre passa pelo portão de aprovação, com o nome do servidor visível na confirmação. Quem confia num servidor marca as ferramentas dele como sempre permitidas.

Nomes recebem o prefixo do servidor (`erp_teste_buscar_nota`), então dois servidores com a mesma função não colidem. Servidor que falha na conexão não impede o app de abrir nem derruba os outros — vira problema listado no painel.

## Modo de resposta

Um seletor ao lado do campo de mensagem escolhe **como** a resposta é escrita:

- **direta** — no tamanho que a pergunta pede; pergunta simples não vira relatório
- **detalhada** — subtítulos, listas, comparações e conclusão
- **técnica** — linguagem formal, fato separado de inferência, limitações declaradas

O modo técnico recebe a **rastreabilidade já medida**: quantas fontes foram lidas, quantos dados têm confirmação de mais de uma e quantas divergências existem. Ele não estima isso — usa o confronto entre fontes que já era calculado.

O seletor de **fontes** continua na barra superior e é outra coisa: um define quantas fontes ler, o outro como escrever o resultado.

## Gráficos no chat

O modelo produz **dados**, não desenho. A ferramenta `gerar_grafico` valida a especificação e o renderer desenha em Canvas — linha, área, barra, coluna, barra horizontal, pizza e rosca. **Nada vindo do modelo é executado**: o que chega é JSON, conferido campo a campo antes de virar pixel.

O gráfico também entra na resposta quando o redator esquece de copiar o bloco: modelo pequeno erra JSON com frequência, e é melhor o gráfico no fim que gráfico nenhum.

## Compras

`buscar_produtos` compara preço entre lojas usando a cadeia de busca e a leitura de páginas que já existiam — sem camada de raspagem dedicada, porque as grandes lojas bloqueiam raspagem e uma engine que finge funcionar produz preço errado, que é pior que preço nenhum.

A busca de preço **respeita o seletor de profundidade** e usa um ranqueamento próprio: quem vende vem primeiro. A ordenação normal existe para pesquisa factual e coloca órgão oficial e enciclopédia na frente — em busca de preço isso é exatamente ao contrário, porque a Wikipédia não vende placa de vídeo. Loja conhecida ganha peso, comparador ganha menos, e enciclopédia, fórum e rede social são descartados.

As consultas também vão loja a loja (`RTX 5070 kabum`, `RTX 5070 pichau`) em vez de só `RTX 5070 preço` — consulta genérica devolve comparador e blog, não página de produto.

**A origem do preço define o quanto ele vale:**

| Confiança | De onde veio |
|---|---|
| alta | dado estruturado publicado pela própria loja (JSON-LD) |
| média | preço lido do texto da página do produto |
| baixa | resumo de busca, sem confirmação na página |

Quando a loja não entrega preço legível, o caminho honesto é o navegador interativo: a página abre na tela e o preço lido é o que você está vendo — sem burlar proteção, sem preço fantasma.

O resultado sai com data e hora da consulta, e com as ressalvas obrigatórias: é o menor preço **entre as fontes consultadas**, nunca "o melhor da internet"; frete não apurado pode mudar o total; produtos podem ser variações diferentes.

`historico_precos` guarda cada consulta em `.augpt/precos.json` e monta a curva por dia usando o **menor preço de cada data**. É o que permite avaliar "de R$ 5.999 por R$ 2.999": se o preço "de" for maior que o máximo já observado, o desconto não se sustenta. Sem ao menos três observações, não afirma nem desmente.

## Geração de documentos

O que o AuGPT lê, ele agora escreve — e **sem dependência nenhuma**:

| Ferramenta | Formato | O que converte |
|---|---|---|
| `gerar_docx` | Word | títulos, tabelas, listas, negrito, itálico, código, citações |
| `gerar_xlsx` | Excel | tabela markdown ou CSV, várias abas, cabeçalho fixo e filtro |
| `gerar_pdf` | PDF | títulos, tabelas, listas, quebra de página e numeração |
| `gerar_html` | página | HTML autocontido, com tema claro e escuro |

Todas aceitam markdown, porque é o que o modelo escreve bem.

A versão anterior chamava Python — `python-docx`, `openpyxl`, `reportlab` — e por isso aparecia **indisponível** para quem não tinha instalado, que é a maioria de quem só quer usar o programa. Agora docx e xlsx são gerados escrevendo o ZIP e o XML direto (o Node já traz o zlib), e o PDF usa as fontes base-14 que todo leitor tem embutidas, com codificação WinAnsi para a acentuação.

**A parte que importa no xlsx não é o XML, é o tipo da célula.** Planilha onde todo número virou texto não soma, não ordena e não vira gráfico — é uma tabela disfarçada. `R$ 482.900,50` vira 482900,5 com formato de moeda, `12,5%` vira 0,125 com formato de percentual, `17/08/2026` vira data de verdade. E `1.204` vira mil duzentos e quatro, não um vírgula dois.

Cada formato tem teste de ida e volta na bancada: gera, relê com o leitor do projeto e confere o conteúdo.

## Leitura de documentos

`ler_documento` extrai texto de PDF, Word, Excel, PowerPoint, OpenDocument, ePub, RTF, CSV e JSON — tudo sem dependência externa.

docx, xlsx, pptx, odt e ePub são arquivos ZIP com XML dentro, e o Node já traz o `zlib`: um leitor de ZIP de 90 linhas destrava os cinco. As tabelas do Word e as abas do Excel saem em markdown, datas do Excel são convertidas (inclusive formatos customizados) e as notas do PowerPoint seguem o `.rels` do slide, não a numeração — que não corresponde.

PDF é o caso difícil, e foram quatro obstáculos até funcionar:

1. **Cadeia de filtros** — `[/ASCII85Decode /FlateDecode]` é comum; aplicar só o Flate falha. Implementados ASCII85, ASCIIHex e RunLength além do Flate.
2. **Criptografia com senha vazia** — boleto de banco, fatura e extrato quase sempre vêm cifrados: abrem em qualquer leitor sem pedir senha, mas os streams estão embaralhados. O handler padrão está implementado (RC4 V1–V4 e AES-128), com derivação de chave por MD5 e chave por objeto. AES-256 é detectado e reportado em vez de falhar em silêncio.
3. **`stream` dentro de `endstream`** — a busca ingênua pela palavra gerava falso positivo a cada bloco.
4. **Dicionário do vizinho** — ler 900 bytes para trás pegava o objeto anterior, e um stream de texto herdava o `/Subtype/Image` do vizinho, sumindo do resultado. O recorte agora começa no `N G obj` mais recente.

Quando o texto sai ilegível — fonte sem mapa de codificação — ele tenta `pdfplumber` ou `pypdf` se houver Python. PDF digitalizado de verdade não tem texto nenhum: o app diz isso, e distingue esse caso de "PDF com estrutura incomum" em vez de chutar.

O formato é detectado pela assinatura dos primeiros bytes, não pela extensão — arquivo renomeado funciona igual. E `ler_arquivo` delega sozinho para o extrator quando a extensão não é de texto, então o modelo não precisa escolher a ferramenta certa.

---

## Pesquisa na web

**Busca** — cadeia de provedores, o primeiro que responder vence:

1. **SearXNG** local (opcional, o melhor) — agrega Google, DDG, Brave e dezenas de outros. `docker run -d -p 8888:8080 searxng/searxng` e aponte nos ajustes
2. **DuckDuckGo HTML** — raspagem do endpoint sem JS
3. **DuckDuckGo Lite** — layout mais simples, sobrevive quando o primeiro muda
4. **Marginalia** — índice independente com JSON de verdade (chave `public` tem limite compartilhado)
5. **Wikipédia** — API oficial, boa para pergunta enciclopédica
6. **Jina** (`s.jina.ai`) — último recurso, ~20 requisições/minuto sem chave

Quando um provedor cai, a trilha mostra qual respondeu e o que falhou antes.

**Leitura** — tabelas viram markdown (a versão antiga achatava "Item Preço Teclado R$ 199,90" e a relação entre coluna e valor se perdia), a data de publicação é extraída de meta tag, JSON-LD ou `<time>`, e dados estruturados de produto e artigo são lidos do próprio JSON-LD do site — mais confiável que qualquer heurística sobre o texto.

Quatro camadas até obter texto utilizável:

1. **API dedicada** quando existe (Wikipédia)
2. **HTML direto** com extração própria: JSON-LD (`articleBody`), container semântico (`article`/`main`) e densidade de parágrafo, descartando bloco dominado por link
3. **Renderização com JavaScript** numa janela offscreen do Electron — resolve SPA sem depender de serviço externo
4. **Leitor externo** (`r.jina.ai`), desligável nos ajustes

Charset é detectado por cabeçalho e meta tag, então página em ISO-8859-1 não vira mojibake.

## As abas

**Agente** — chat com ferramentas. Você pede, ele planeja e executa; a resposta vem numa bolha e o raciocínio fica dobrado atrás de "ver raciocínio". Mantém contexto entre pedidos, então "e amanhã?" funciona como pergunta de acompanhamento.

Atalho: **Ctrl+B** oculta e mostra o painel lateral.

**Skills** — catálogo de métodos e de ferramentas: ativar, desativar, ler, criar e ver dependências.

**Configurações** — pasta de trabalho, memória, conexão, execução e pesquisa, tudo em uma página só.

À esquerda, o histórico de conversas: busca, três pontos por item (abrir, renomear, exportar em markdown, selecionar, excluir), seleção múltipla e **Nova conversa**. Cada conversa é um JSON em `conversas/` nos dados do usuário — arquivo corrompido não derruba a lista, some dela.

**Conversa** — chat puro com o modelo: streaming token a token, markdown renderizado, histórico das últimas 30 mensagens, Enter envia e Shift+Enter quebra linha. Sem agente e sem ferramentas — é o caminho certo para pergunta simples, onde o loop só desperdiçaria iterações.

O markdown é renderizado por um parser próprio de ~100 linhas que escapa tudo antes de aplicar marcação: a saída fica restrita a uma lista branca de tags e atributos, e link só vira link se for `http`/`https`.

## O protocolo de decisão

Quatro camadas, cada uma com erro próprio e instrução própria. "Sua resposta não seguiu o protocolo" não diz ao modelo o que consertar; "faltou o campo ferramenta.nome" diz.

| Camada | O que garante | Falha produz |
|---|---|---|
| JSON Schema no `format` | a forma, pela gramática de decodificação | — |
| Leitura tolerante | objeto extraível de markdown, texto em volta, geração truncada | `json-invalido` |
| Protocolo | `ferramenta.nome` presente | `protocolo-invalido` |
| Ferramenta | existe e está ativa | `ferramenta-invalida` |
| Argumentos | os obrigatórios vieram preenchidos | `argumentos-invalidos` |

**Schema estruturado é o caminho principal.** O Ollama aceita JSON Schema no campo `format` desde a v0.5, e o `enum` com os nomes das ferramentas ativas torna ferramenta inexistente **impossível por construção**, em vez de detectável depois de gastar uma iteração. Instalação que não suporta cai para `format: "json"` na primeira falha, e o par host+modelo fica marcado — não insiste.

**Recuperação antes de retry.** `{"resposta": "Python é..."}` não é ruído: é o modelo respondendo direto, mal embrulhado. Converter em `responder` custa zero chamadas; pedir de novo custa uma iteração e pode falhar igual. Também recupera nome de ferramenta com erro de digitação, argumentos no nível de cima e sinônimos (`tool`, `action`).

**O histórico não guarda o defeito.** A resposta malformada NÃO volta ao contexto — relê-la no turno seguinte ensina o modelo a repetir o erro. Só a instrução de correção entra.

**O catálogo mostra JSON válido.** Antes: `argumentos: { "fato": <informação a memorizar> }` — que não é JSON, dentro de um prompt exigindo JSON estrito. Modelo pequeno imita a forma que vê. Agora: `argumentos: {"fato":"string — informação a memorizar"}`, válido e autodocumentado, com o tipo inferido da descrição. Se o modelo copiar o valor de exemplo ao pé da letra, o validador descarta.

## Decidir em JSON, escrever em texto

O agente faz **duas chamadas de natureza diferente** ao modelo:

1. **Decisão** — `format: json`, resposta curta: qual ferramenta usar e por quê.
2. **Redação** — texto puro, sem gramática restrita, com o dossiê de tudo que foi lido.

A separação existe porque pedir a um modelo de 8B que escreva uma resposta longa *dentro de um campo JSON* falha de forma previsível: ele precisa escapar aspas, quebras de linha e acentos, sob limite de tokens, e acaba devolvendo o campo vazio. Na redação ele só escreve markdown — que é o que sabe fazer.

Efeito colateral bom: a resposta final chega em streaming, palavra por palavra, na bolha do chat.

## Skills

Skill é uma pasta com um `SKILL.md` dentro. O arquivo abre com metadados e o resto é instrução em markdown, injetada no prompt quando o pedido casa com os gatilhos:

```markdown
---
nome: Previsão do tempo
descricao: Como obter e apresentar previsão meteorológica
gatilhos: [previsão, tempo, clima, chuva, temperatura]
etapa: ambas          # decisao | redacao | ambas
prioridade: 3
sempre: false         # true = entra em todo pedido
---

## O que ignorar
Índice de churrasco, frizz, mosquitos, qualidade do ar…
```

**Duas origens, mesmo tratamento:** as embutidas ficam em `skills/` no app; as suas em `skills/` dentro dos dados do usuário (o botão *Abrir pasta* leva até lá). *Nova skill* cria o esqueleto já preenchido.

**Dois pontos de injeção.** `etapa: decisao` orienta a escolha de ferramentas; `etapa: redacao` orienta como escrever a resposta final; `ambas` entra nos dois. Uma skill de previsão do tempo precisa das duas coisas — onde buscar e como tabelar.

**Antigatilhos.** Além de `gatilhos`, uma skill pode declarar `nao_use_para` — e o antigatilho vence tudo. Foi o que resolveu uma colisão real: a skill de auto-conhecimento tinha `pdf` na lista e roubava os pedidos de geração de documento. Com o catálogo crescendo, saber de onde uma skill deve ficar **longe** vale tanto quanto saber quando usá-la.

**Gatilho tolera palavra no meio.** `como funciona` casa com "como **ela** funciona" — que é como as pessoas escrevem. Sem isso, a skill de explicação didática ficava praticamente muda na pergunta mais comum de todas.

**Compatível com o formato padrão.** Skill escrita no formato Agent Skills (`name` e `description` em inglês, sem gatilhos) é carregada: os campos são reconhecidos e os gatilhos derivados da descrição — termos entre aspas e o que vem depois de "triggers include". Basta soltar a pasta em `skills/`. A seleção continua sendo determinística por gatilho, que não gasta token para decidir.

**Seleção por gatilho.** Palavra inteira vale 3 pontos, ocorrência parcial vale 1, e a prioridade desempata. Entram no máximo 3 skills e 7.000 caracteres por prompt, para não comer a janela de contexto. A aba Skills tem um campo para testar qual pedido ativa o quê, e cada turno do agente mostra em selo quais skills foram usadas.

As 19 embutidas: pesquisa na web, pesquisa profunda, previsão do tempo, notícias recentes, texto longo, comparativo, decisão e cenários, matemática e cálculo, análise de dados, gerar PDF/Word/Excel, documento em arquivo, organizar arquivos, revisão de código, escrever e depurar código, tradução, redigir mensagens, explicação didática, analisar documento anexado e o próprio AuGPT. As primeiras nasceram de erros observados em execução real, não em tese.

## Anexar arquivos

O botão **+** ao lado do campo de mensagem, nas duas abas de chat, com comportamentos diferentes:

- **Agente** — o arquivo é copiado para a pasta de trabalho (nome normalizado, colisão resolvida com sufixo) e o pedido ganha a lista de caminhos. Daí em diante as ferramentas leem, editam e convertem normalmente. Qualquer formato.
- **Conversa** — não há ferramenta nenhuma ali, então só faz sentido para texto: o conteúdo vai direto na mensagem, até 120.000 caracteres. Formato binário é recusado com aviso, apontando para a aba Agente.

## Custo por decisão

Cada passo do agente reenvia o bloco fixo — instruções, catálogo e skills. Numa execução de 19 passos isso somava **54 mil tokens de repetição**, e sobrava pouco da janela para o material coletado. Quatro medidas atacam isso:

| Medida | Efeito |
|---|---|
| `numCtx` 8.192 → 16.384 | espaço para material e histórico **2,6× maior** |
| `keep_alive` de 30 min | o Ollama para de descarregar o modelo entre chamadas |
| Blocos voláteis no fim do prompt | memória e resumo mudavam a cada passo **antes** do histórico, invalidando o cache de prefixo; agora o prefixo estável é bem maior |
| Catálogo seletivo | 1.195 → ~650 tokens por decisão |
| Histórico enxuto | resultado antigo vira uma linha; a decisão guardada perde pensamento, plano e crítica |
| Memória a cada 4 passos | eram 19 chamadas de embedding numa execução de 19 passos |
| ~~`numPredict` 1.024 → 320 nas decisões~~ | **nunca foi aplicado** (campo não era lido; revisão v3, 03/10). Decisões reais chegam a ~400 tokens com plano, e `escrever_arquivo` leva o conteúdo inteiro — 320 cortaria o JSON. Hoje `numPredict` (1.024) é o teto da decisão e `numPredictDecisao` saiu da config |
| Limiar de compactação por fração da janela | antes `numCtx × 3` só disparava com o histórico já ocupando 85% do contexto |

O corte do histórico é o único que **cresce com a duração**. Medido numa execução de 13 decisões com 12 leituras pesadas: **57 mil tokens contra 123 mil** sem enxugar.

A ideia é simples: o dossiê é a memória da *resposta*, o histórico só precisa do bastante para a *próxima decisão*. Reler 6.000 caracteres do passo 3 no passo 12 não ajuda a decidir nada — os dois resultados mais recentes ficam íntegros, os anteriores viram `RESULTADO DE ler_arquivo: ok, 47 linhas já registradas no dossiê`.

O catálogo seletivo mostra descrição completa só das ferramentas relevantes ao pedido, mais o núcleo que aparece sempre (`responder`, `concluir`, `perguntar_usuario`, `listar_arquivos`, `ler_arquivo`, `pesquisar_e_ler`) e as que a skill ativa declarou precisar. As demais entram como uma linha de nomes — **nada fica inalcançável**, e o `enum` do schema continua aceitando todas.

Leitura em paralelo, em lotes de 3: com profundidade alta, 6 fontes que levavam 3,6 s passam a levar 1,3 s.

## Teto de buscas

A profundidade limita quantas **fontes** entram por busca, não quantas **buscas** acontecem. Numa execução observada com qwen2.5:14b, o modelo encadeou 27 consultas ligeiramente diferentes — 18 minutos e 189 mil tokens — e o guarda de repetição não pegou, porque cada consulta era única.

Agora há teto por execução: 4 buscas no modo normal, 6 no médio, 9 no alto. Ao atingir, a instrução é direta: responda com o que já tem, e diga o que não foi encontrado.

## Profundidade da pesquisa

Quantas fontes ler é **procedimento, não julgamento**. Deixar isso com o modelo é o que fazia uma execução usar 2 fontes e a seguinte usar 8 para a mesma pergunta. Agora é política, com seletor na barra superior:

| Nível | Fontes | Quando usar |
|---|---|---|
| normal | 3 a 6 | pergunta do dia a dia |
| média | 4 a 8 | comparativo, decisão de compra |
| alta | 6 a 10 | tema técnico ou sensível, onde corroboração importa |

**A diversidade vale para a execução inteira, não por busca.** O filtro por domínio era local a cada chamada: a segunda busca recomeçava a contagem e relia o mesmo portal. Agora são no máximo 2 páginas por domínio na execução toda, e domínio nunca lido entra na frente da fila. Quando os resultados só repetem domínios já consultados, a ferramenta diz isso e sugere mudar o ângulo — em vez de devolver erro de leitura.

**Contagem por domínio, não por página.** Oito resultados do mesmo portal são uma fonte; o que vale é diversidade de domínio. A leitura pula domínio repetido e o cabeçalho registra quantas fontes distintas entraram.

Uma URL lida duas vezes na mesma execução custa uma requisição só — o cache vive junto da execução e some com ela.

## Pesquisa planejada (recomendação e comparação)

Para "qual o melhor X" ou "compare A e B", decidir uma busca de cada vez é o pior caminho: o modelo reformula a mesma pergunta, os critérios que decidem "melhor" ficam implícitos e ninguém descobre quais são as opções antes de compará-las. Nesses pedidos (detectados por regra de código, `motor-pesquisa.js`), antes da primeira decisão:

0a. **Cadeia do uso** — antes de tudo, o agente desce do pedido até as características técnicas, como uma pessoa que entende do assunto faria: produto, atividade, tipo de uso ("jogar PUBG no PC" → "jogo de tiro (FPS) competitivo"), o que esse uso exige (ouvir os passos, saber de onde vem cada som) e as características que entregam isso (palco sonoro e imagem, separação, isolamento...), com termos em inglês. Com a cadeia, o código faz 1 ou 2 **buscas de conhecimento** ("o que torna um fone bom para FPS", em português e inglês) ANTES de procurar produto, e uma chamada lê esse material e devolve de 3 a 6 critérios com peso e **o porquê** de cada um. O que o conhecimento não trouxe, a cadeia completa. Com 3+ critérios assim, eles substituem os do plano (do plano só fica preço); "design compacto", "qualidade", "feedback da comunidade" não entram. O porquê vai pro plano da resposta como a seção "Como escolhi". As páginas de conhecimento também entram na descoberta (guia de "o que torna bom" costuma citar produtos).
0. **Mapa do problema** — antes do plano, uma chamada faz o agente pensar no problema de quem pergunta, sem citar produto: perfis de uso, o que decide a escolha, o que o uso não tolera (ELIMINA — ex.: atraso de áudio em jogo competitivo), alternativas que o pedido não citou, armadilhas e 3 a 5 hipóteses. O "o que decide" vira a base dos critérios do plano e o ELIMINA vira critério de peso alto; o que um perfil diz que importa e nenhum critério cobre ("baixa latência") entra como critério de peso médio; critério sobre a pesquisa e não sobre o produto ("feedback da comunidade", "disponibilidade") não entra. Depois da descoberta, o que os tópicos da comunidade discutem vira critério: uma tabela pequena de ideias (posicionamento dos sons — "footsteps", "imaging", "soundstage" —, latência e conexão, microfone, isolamento, conforto) é contada nos tópicos; ideia em 2+ tópicos que nenhum critério cobre entra, com peso alto a partir de 3; as hipóteses são conferidas no fim (passo 6b).
1. **Plano** — uma chamada ao modelo, em texto: o uso que decide o que é "melhor", 3 a 6 critérios com peso e termos de busca, as opções que o próprio usuário citou e buscas de descoberta por ângulos diferentes. O código tira do uso e das buscas condição que o pedido não disse (ex.: "sem fio") e critério pendurado no fim ("... com isolamento acústico", "... with noise cancellation" — no 10º teste real isso levou a descoberta inteira para fones Bluetooth com ANC), descarta critério vago ("compatibilidade") e junta sinônimos ("atraso" e "latência").
2. **Descoberta** — o código roda as buscas de descoberta, mais uma busca "site:" em cada fonte da comunidade (Reddit, Clube do Hardware, Fórum Adrenaline; Head-Fi quando o assunto é áudio — lista em `dados/comunidades.json`, trocável nos Ajustes), e uma segunda chamada lista as opções citadas. Cada nome é conferido no material (nome inventado cai fora) e ordenado por quantos sites diferentes o citam. Se o usuário já nomeou as opções, esta etapa é pulada. Pedido de "top N" aceita até N nomes. Reddit e Head-Fi buscam com a "busca em inglês" do plano.
   **Lista larga por consenso**: cada nome ganha pontos por quantas CONVERSAS o recomendam — num tópico de Reddit/fórum vale o melhor comentário que cita o nome: recomendação (elogio, "vai de", lista de indicação, ou "uso o X" junto do uso pedido) vale 2, +1 se fala do uso (passos, PUBG, imaging…), +1 com 5+ votos e +1 com 20+; menção solta ("tenho os Bose QC20 há 6 anos") vale 0,5; crítica 0 —, site de review/guia só conta quando a página ou a frase do nome fala do uso (ou elogia o nome), e no máximo 3 pontos no total (1 site = 1, 2-3 = 2, 4+ = 3) — quantidade de sites não manda —, loja 0 (vitrine cita tudo o que vende), mais elogios e menos críticas nas frases que o citam, e +1 se o modelo o nomeou lendo o material. A lista guarda de 8 a 15 nomes (conforme o nível) com a frase que diz por que recomendam; os finalistas são os primeiros dela. Abaixo do mínimo de nomes (5 a 8), há uma segunda rodada numa fonte da comunidade ainda não usada (ou na 2ª busca de descoberta do plano).
   **Citações**: de cada nome saem até 3 comentários pra citar na resposta (os de mais votos, que falam do uso, que recomendam ou trazem dado técnico — "1DD+4BA", "imaging"; no máximo uma crítica), com a fonte (r/iems) e os votos; vão pro plano da resposta como "O QUE OS USUÁRIOS DIZEM" e pra lista top N.
   **Tópico da comunidade** entra sempre, primeiro e pelo texto cru na leitura de nomes (comentário de fórum vem em minúscula, e o destilador chegou a devolver "nada relevante" num tópico certo); na pesquisa planejada, tópico nem passa pelo destilador. Linha de vitrine ("– A partir de R$ 109", linha de tabela) não vira "por que é recomendada".
   **Filtros de nome**: o padrão de texto não aceita nome que começa com palavra comum ("Seu ANC"), com número puro ou com palavra repetida ("15 15 Pro 15 Pro", pedaço de lista de iPhone) nem nome de site ("JBL Brasil"). E, quando a categoria do pedido é conhecida (fone, monitor, placa de vídeo, teclado, mouse, cadeira, celular, notebook), cada nome precisa aparecer como algo dessa categoria: numa frase com um termo dela (ou na anterior), numa página cujo título é da categoria, ou num tópico de Reddit/fórum sobre ela. Nome de série que o material quase sempre escreve com o número do modelo depois ("JBL Quantum" × "JBL Quantum 50") some dentro do modelo; palavra de categoria não separa variantes ("EDX Pro Intra-auricular" = "KZ EDX Pro"). Pedido de intra-auricular é mais estrito: nome que só aparece junto de "headset"/"headphone"/"over-ear" e nunca junto de intra/IEM/earbud (conferindo o nome inteiro e contíguo — "HyperX Cloud II" não pega o "earbuds" do "HyperX Cloud Earbuds II") é de outro tipo e sai. O que não passa sai da lista (fica registrado em `foraDaCategoria`), a não ser que sobrem menos de 3.
2b. **Comparação de produtos nomeados** — "qual a diferença entre A e B", "A vs B", "A ou B": as opções são as do pedido (mesmo que o plano não as liste), a descoberta é pulada, e antes da ficha de cada uma vêm duas buscas de confronto direto: "A vs B benchmark jogos fps 1440p 4k" (ou "comparativo teste" fora de jogo) e "site:reddit.com A vs B". O plano da resposta pede a diferença em % e um ponto de vista claro, e manda priorizar medição no uso real sobre teste sintético (PassMark, G3D Mark, 3DMark, Geekbench), rotulando o sintético. Pedido de recomendação ou comparação não passa pela bifurcação de interpretação (ela estreitava "top 10 intra pra PUBG" para "qualidade sonora" e a comparação de placas para "desempenho técnico").
3. **Pesquisa por produto** — para cada finalista, duas buscas: a ficha técnica ("<nome> especificações técnicas") e o que a comunidade diz ("site:reddit.com <nome>", sem filtro de idioma). Cada leitura fica marcada com a opção e o tipo de busca.
4. **Matriz** — opção × critério, montada pelo código a partir das frases que citam a opção e um termo do critério. Numa página lida para uma opção (ficha, tópico do Reddit), a frase vale para ela mesmo sem repetir o nome, desde que não cite outra finalista. A cobertura é medida por célula, ponderada pelo peso.
5. **Julgamento** — uma chamada por finalista: o que os trechos afirmam da opção em cada critério (ou "sem dados"), mais um resumo da ficha técnica e um da opinião da comunidade.
6. **Lacunas** — abaixo de 70% de cobertura (medida depois do julgamento), uma busca por finalista com os critérios que o juiz deixou vazios; a matriz é montada e julgada de novo.
6a. **Ordem pela evidência** — depois do julgamento, os finalistas são reordenados pelo que o material diz deles, não pela contagem: cada critério com veredito a favor soma o peso dele (alto 2, médio 1, baixo 0,5), veredito contra tira metade ("sem atraso" é a favor), e soma-se o consenso da comunidade. O plano da resposta traz essa ordem e pede pra recomendar a primeira, explicando por quê. Antes disso, os critérios são **pesados pela comunidade**: discutido em 3+ tópicos sobe pra peso alto; peso alto que nenhum tópico discute (com 4+ lidos) desce pra médio; preço nunca desce.
6b. **Hipóteses** — para cada hipótese do mapa, o código separa até 3 frases do material com palavras dela (comunidade primeiro, sem frase de loja) e uma chamada diz se o material confirma, derruba ou não fala dela. Hipótese sem trecho vira "sem dados" sem gastar chamada. Veredito que contradiz o próprio motivo é corrigido pelo código: motivo que divide 3+ palavras de conteúdo com a hipótese e tem a mesma polaridade confirma; polaridade oposta derruba.
7. **Plano da resposta** — (a lista "top N" é montada pelo código e anexada ao fim da resposta: comparadas primeiro, depois as outras citadas, com sites, tópicos e motivo, dizendo quando achou menos que N) — critérios, opções, a evidência de cada célula com o site (ou "sem evidência"), a ficha e a opinião da comunidade de cada opção, quantos critérios de peso alto cada uma tem com evidência, as hipóteses conferidas, as alternativas e armadilhas do mapa e o formato da tabela vão prontos pro redator.

O orçamento de buscas depende do nível de raciocínio (descoberta, finalistas × 2 e lacunas; leve até 9, extremo até 18) e conta no teto de buscas da execução. Na pesquisa planejada, cada página destila no máximo 2 pedaços de texto (uma vitrine de loja com 21 pedaços gastava 12 destilações no nível extremo). Com a pesquisa pronta, um "perguntar" da crítica periódica ou da pré-redação não trava mais a resposta: o que faltou vai dito na própria resposta. Se o plano vier ilegível ou a descoberta não achar opções, o agente segue o caminho normal com o que já coletou.

### Fontes da comunidade

`src/tools/comunidade.js` guarda a lista de fontes e lê tópico como conversa. Um tópico do Reddit é lido pela versão JSON pública (título, post e os comentários mais votados, até dois níveis de resposta); como o Reddit recusa esse JSON pedido por fora do navegador (HTTP 403 em todos os tópicos dos testes reais), a segunda tentativa é a página nova renderizada no navegador embutido, lida por um leitor próprio (`topicoDoRedditNovo`: comentários pelos blocos `t1_…-comment-rtjson-content`, votos do `<shreddit-comment>`, post e título do `<shreddit-post>`) — a extração genérica perdia os comentários porque a poda tira todo bloco com "comment" na classe. Depois vêm o old.reddit.com direto e o JSON aberto no navegador. Estratégia que falhou 3 vezes na sessão do app sem nunca funcionar é pulada, e o HTML de uma página nova sem comentário reconhecível vai para `userData/diagnostico` (até 2 por sessão) para ajustar o leitor à estrutura real. Cada falha vai para `tentativas` na fonte do registro da execução; um tópico de fórum XenForo (Adrenaline, Head-Fi) ou Invision (Clube do Hardware) vira pergunta + respostas, sem citação repetida, assinatura, menu ou rodapé — também quando o site está marcado como "precisa de navegador" na memória operacional. A busca aceita idioma por consulta: Reddit e Head-Fi vão sem filtro de idioma, fórum brasileiro em pt-BR. E o limite por domínio muda para fonte da comunidade: até 4 tópicos do mesmo fórum por busca e 16 por execução, porque cada tópico é uma conversa diferente.

## Contrato de conclusão

O plano da execução (checklist) já barrava `responder` com item pendente, mas só dizia "não é hora de encerrar". No 10º teste real (histórico de preços com gráfico), o item "Criar um gráfico" ficou pendente, o agente só sabia pesquisar de novo, e depois de 3 vetos a resposta saiu sem gráfico e sem dizer que faltava. Agora, item que só uma ferramenta cumpre — criar gráfico (`gerar_grafico`), planilha (`gerar_xlsx`), PDF, documento Word — é conferível de verdade:

- o veto diz qual ferramenta chamar ("para 'Criar um gráfico...', chame gerar_grafico com os números que você já coletou");
- esse tipo de item continua barrando mesmo com o teto de buscas atingido ou com a pesquisa planejada pronta — ele não precisa de busca;
- a ferramenta rodando com sucesso marca o item como feito (nos dois caminhos de execução), e gráfico montado por outro caminho (série de preços, `buscar_produtos`) também conta;
- gráfico montado que o redator não copiou entra no fim da resposta;
- o que chegar ao fim sem a ferramenta aparece na resposta como **O que ficou faltando do pedido** (e no registro, `contratoIncompleto`).

## Série de preços (evidência → dados → análise)

Pedido de histórico, evolução ou média de preço de produtos nomeados ("histórico de preços da RTX 5070 Ti e da RTX 5080 desde o lançamento") não deixa a conta com o modelo. `src/agent/serie-de-precos.js`, sem chamada de modelo:

1. **Evidência** — frases das páginas lidas com um produto do pedido e um preço. Parcela ("12x de R$ 700") não conta; o modelo com sufixo não se confunde com o sem ("5070" × "5070 Ti").
2. **Dados** — cada preço vira observação {produto, mês, preço, moeda, fonte, trecho}. O mês vem da frase ("junho de 2025", "15/03/2025") ou, sem ela, da data de publicação da página; preço sem data fica fora da série.
3. **Análise** — por moeda (real, se houver; nunca misturando com dólar): menor preço observado por mês, média aritmética das observações, menor, maior, N e período.
4. **Saída** — um bloco "DADOS CALCULADOS PELO CÓDIGO" entra no dossiê e no foco do redator (método, tabela, médias, aviso de série parcial com poucos meses e a fonte de cada ponto) e o gráfico de linha vai para a resposta. Como o bloco é material, o verificador reconhece as médias calculadas.

## Citações numeradas

As fontes lidas são numeradas e a numeração atravessa o pipeline inteiro: `--- FONTE 3` na leitura, `[3]` nos fatos destilados, `[3]` nas afirmações da resposta e `3.` no rodapé com título, data e link. O redator é instruído a citar só número que exista na lista.

O rodapé usa as fontes **realmente lidas**, não as URLs que o modelo declara — se ele citar um link que não abriu, ele não aparece.

## O que o agente sabe entre um passo e outro

Antes, cada decisão era tomada quase do zero: o plano era texto solto reinjetado, e a cobertura do material só era medida na redação — quando a pesquisa já tinha acabado e não dava mais para reagir. Agora um bloco de situação acompanha cada decisão:

```
SITUAÇÃO:
JÁ FEITO: pesquisar_e_ler(inflação brasil 2025) · ler_arquivo(dados.txt)
SEU PLANO: pesquisar → comparar → responder
AINDA SEM COBERTURA NO MATERIAL: cambio, importacao — busque especificamente por isto
```

A cobertura passou a ser medida **depois de cada leitura**, e não só no fim. Isso fecha um laço que já existia pela metade: o sistema sabia dizer quais termos do pedido não apareceram no material, mas descobria tarde demais. Quando a cobertura fica boa, o bloco avisa que dá para responder — critério objetivo de parada, em vez de esperar o modelo achar que já chega.

`JÁ FEITO` ataca os dois erros que apareceram nos registros reais: repetir uma ação já concluída e encerrar antes da hora.

## Fatos fundidos

Se três fontes dizem "máxima de 32°C", o dossiê carregava a linha três vezes. Agora vira uma só, com a atribuição junta:

```
- Máxima de 32°C na sexta [1][3]
- Chuva de 30% [1]
```

Economiza contexto e deixa a corroboração visível **no próprio fato** — antes só o confronto enxergava isso, num bloco separado. Os mais corroborados aparecem primeiro.

## Subconsultas

"Inflação **e** câmbio do Brasil em 2025" buscado como frase única devolve página genérica sobre economia. O pedido é dividido em consultas focadas — `inflação do Brasil em 2025` e `câmbio do Brasil em 2025` — e os resultados se juntam sem repetir URL.

A divisão é **por regra, sem chamada ao modelo**: liga em "e", "vs", "ou", "comparado com"; o sufixo com preposição vira contexto herdado pelas partes; verbo de comando ("compare", "analise") sai da frente. As regras são conservadoras de propósito e a consulta original **sempre** fica na lista — dividir errado custa uma busca, não dividir custa a resposta.

Frase longa ou sem estrutura clara não é dividida.

## Resposta parte a parte

"O valor, o vencimento **e** o que acontece se eu atrasar" são três perguntas. A verificação antiga media sobreposição de palavras no conjunto, e uma resposta que cobrisse duas de três passava. Agora cada parte é conferida sozinha, e a instrução de correção diz **qual** ficou de fora:

```
A resposta anterior deixou de fora: "o que acontece se eu atrasar".
Responda TODAS as partes do pedido.
```

## Confiança declarada

Calculada do que já é medido — cobertura do pedido, corroboração entre fontes, divergências e afirmações sem respaldo. Determinística de propósito: dizer "alta confiança" com base em palpite seria pior que calar.

| Nível | Situação típica |
|---|---|
| alta | material cobre o pedido, 3+ domínios, dados corroborados, nada sem respaldo |
| média | cobertura parcial, ou fontes divergindo em algum dado |
| baixa | sem material, fonte única, ou valores que não aparecem nas fontes |

Quando não é alta, a resposta traz a nota com o motivo, e a interface mostra a faixa colorida. As duas vêm do mesmo cálculo.

## Credibilidade do domínio

Em **Configurações → Domínios e credibilidade** dá para consultar qualquer domínio e ver o peso que ele recebe, além de manter suas próprias marcações — confiável, apuração fraca, não confiável ou sátira. **O seu julgamento vence a base pública**: você conhece os sites do seu assunto melhor que uma lista genérica de 2017.


Além das regras de tipo de domínio, o projeto traz uma tabela de **725 domínios com histórico de fabricação, sátira ou apuração fraca**, derivada da base pública OpenSources. Fonte marcada desce na fila de leitura e a marcação viaja junto:

```
--- FONTE 3: Manchete sensacional
https://exemplo-fabricado.com/materia
(domínio exemplo-fabricado.com · site · histórico de conteúdo fabricado · via densidade)
⚠ ATENÇÃO: histórico de conteúdo fabricado. Trate esta fonte com reserva
  e não a use como única base.
```

**Nada é bloqueado em silêncio.** A fonte continua legível — some da frente da fila, e o aviso chega ao modelo e à interface. Sumir com uma fonte sem dizer é pior que mostrá-la com ressalva.

Três decisões que valem explicar:

- **Só categorias de fabricação entram.** A base original também classifica ~200 domínios por viés político. Usar isso para ranquear embutiria a posição política de uma organização dentro do agente. Penalizamos invenção, não ponto de vista.
- **Sátira é marcada, não removida.** Site satírico lido como notícia é uma das formas mais comuns de desinformação chegar a uma resposta.
- **A cobertura em português vem de outra base** (veja abaixo) — a OpenSources é quase toda de sites em inglês e não tem nenhum domínio `.br`.

### Bases brasileiras

**Fake.br Corpus (USP/ICMC)** — 7.200 notícias com a URL de origem nos metadados. Amostrando o corpus saem os portais recorrentes: 4 catalogados como fonte de notícia falsa e 13 veículos verificados, todos `.br`. É o único sinal de credibilidade destas listas que cobre o Brasil, e vem de pesquisa acadêmica, não de curadoria editorial.

**Lista de bloqueio judicial (Router-X)** — 49.663 domínios com ordem de bloqueio de ANATEL, ANCINE e Judiciário: aposta, pirataria, IPTV. **Não é julgamento de credibilidade** — o repositório de origem não endossa nem contesta as ordens, e o AuGPT também não. O uso é prático: domínio bloqueado provavelmente não abre a partir do Brasil, e gastar uma das poucas leituras nele é desperdício. Carregada por demanda, porque a maioria das pesquisas nunca esbarra em nenhuma.

Um detalhe que quase virou bug grave: a base de origem traz **`com.br` como entrada**. Aceitá-la literalmente bloquearia todo site brasileiro. Sufixos públicos são descartados na geração e recusados de novo na leitura.

A tabela vive em `dados/dominios.json` e é regenerável:

```bash
npm run atualizar-dominios
```

Baixar listas de terceiros a cada pesquisa seria lento, frágil e uma dependência de rede que ninguém pediu — por isso é script de manutenção, e o app continua funcionando offline.

## Qualidade da fonte

A skill de pesquisa pedia fonte primária, mas nada garantia: a ordem de leitura era a do buscador. Agora é determinístico — órgão oficial e universidade primeiro, referência e imprensa depois, agregador e blog por último. Ano no caminho da URL serve de pista de recência quando o pedido fala em "atual" ou cita um ano.

Isso importa mais desde que o limite de fontes ficou rígido: **as primeiras da fila são as que serão lidas**.

## Confronto entre fontes

Ler cinco páginas não adianta se os dados chegam lado a lado e o redator escolhe em silêncio. Antes de escrever, os valores são cruzados:

```
CONFRONTO ENTRE AS 3 FONTES LIDAS:
- Confirmados por mais de uma fonte: 30% (3 fontes) · 32°C (2 fontes)
- Aparecem em uma fonte só: R$ 410,49 (climatempo.com.br)
- DIVERGÊNCIA em °C: 32°C em 2 fontes, mas 28°C em inmet.gov.br
```

A detecção de divergência compara cada valor de fonte única com o valor **corroborado mais próximo da mesma unidade** — sem isso, comparar a mínima de um site com a máxima de outro produziria divergência falsa a cada execução.

Cruza sempre o texto **bruto**, não o destilado: a destilação pode ter descartado justamente o número que a outra fonte contradiz.

## Pesquisa: revisão v2 (2026-09-28)

Depois do 14º teste real (10 intra pra PUBG, RTX 5070 Ti × 5080, "fone mais usado pelos profissionais") e da análise do ChatGPT, a pesquisa passou a tratar evidência como **dado estruturado**, não como texto. O LLM interpreta e escreve frases; o código extrai, conta, calcula e confere.

- **Roteador de modos** (`motor-pesquisa.modoDaPesquisa`, só regra de código): `recomendacao` (top N, "quais os melhores"), `desempenho` (diferença de desempenho entre placas/processadores nomeados), `uso-profissional` ("mais usado pelos profissionais"). Fora disso, o laço de sempre.
- **Livro de evidências** (`src/agent/evidencias.js`, em `Tarefa.livro`): cada coisa concreta vira um objeto com ID (`E0001`) — recomendação/crítica de comentário, benchmark (produto A × B, FPS, resolução, jogo), especificação, preço, uso por profissional, avaliação de célula. Status por célula calculado pelo código: corroborado (2+ fontes independentes), fonte única, contraditório, indireto, sem dados. A tabela da resposta é uma visão do livro.
- **Comunidade** (Etapa C): bateria de buscas montada pelo código (`bateriaDaComunidade`: IEM em inglês, subreddit do jogo e da categoria, Clube do Hardware/Adrenaline em pt) e **extração por tópico** — o 7B lê um tópico por vez e aponta produto + nº do comentário; o código confere o nome no comentário, decide o tom (recomenda / critica / pergunta / menção) com o contexto do tópico, e grava no livro. Nome canônico (sem prefixo de loja, grafia da marca corrigida). Tópico conta por tópico, não por domínio.
- **Escopo e páginas** (`src/agent/escopo.js`): home, índice de fórum/subreddit, rede social, login, canal e agenda não são lidos; leitura de variante excluída ("PUBG Mobile" num pedido de PC) ou que não cita o produto nomeado não entra no dossiê.
- **Perfis de uso** (`dados/perfis-de-uso.md`, editável; `src/agent/perfis.js`): critérios curados com o porquê (fone pra FPS, headset pra FPS, placa de vídeo pra jogos). Critério que o pedido não sustenta sai (over-ear num intra, microfone sem pedir). A ficha técnica confere a categoria do finalista.
- **Desempenho A × B** (`src/agent/comparativo-de-desempenho.js`): FPS por jogo e "X% mais rápida" extraídos das páginas, mediana por resolução, teste sintético à parte, ficha e preço pelo código.
- **Dado de uso** (`src/agent/uso-profissional.js`): tabela jogador → equipamento contada por jogador distinto; porcentagens declaradas com a fonte.
- **Resposta montada** (`src/agent/compositor.js`): o código monta o esqueleto (resposta direta, como escolhi, um bloco por opção com citações e status, tabela, qual escolher, o que não foi confirmado); o modelo escreve só frases numa chamada, cada uma conferida (número fora dos fatos derruba a frase).
- **Afirmação → evidência** (`src/agent/afirmacoes.js`): cada número da resposta (FPS, %, R$) é conferido no livro com produto E condição — "113 FPS em 1440p" quando o 113 é de 4K é contexto errado e pede reescrita.
- **Registro**: argumentos de cada ferramenta, plano inicial, checklist final, IDs de busca (B001) e fonte (F001), descartes com motivo, nomes por tópico, livro de evidências, afirmações conferidas.

## Pesquisa: revisão v3 (2026-10-05)

Depois dos 4 chats reais de 29/09 (10 fones, Gojo, táticas de PUBG, tutorial "dentro do jogo").

- **Tipo de pedido** (`src/agent/tipo-de-pedido.js`, só regra de código): o **objeto** decide antes da palavra. `produto` (algo que se compra/escolhe, ou escolha entre itens de catálogo) → motor como antes; `guia` (táticas, estratégias, dicas, tutorial; "como melhorar" só com contexto de jogo) → pesquisa de guia; `explicacao` (por que, como funciona, o que é, diferença entre conceitos) → sem plano forçado, sem checklist, sem crítico periódico, 1–3 buscas (`modoExplicacao`, padrão `true`); `local` (arquivos) e `livre` → laço de sempre. "Melhores táticas de PUBG" não entra mais no modo produto.
- **Guia** (`src/agent/guia.js`): bateria pelo código (subreddit do jogo, guia em inglês, profissionais, português; sem jogo, o assunto em português); o 7B lista "dica | nº do comentário" por tópico (`prompts.pedidoDeDicasDoTopico`) e o código confere o comentário (nº inexistente, número inventado e eco do formato saem); páginas de guia entram com os fatos destilados que parecem conselho. Dicas parecidas se juntam, contam fontes independentes e votos e são encaixadas por etapa da partida. Resposta montada pelo código (`compositor.montarGuia`): passo a passo por etapa, respaldo de cada dica, citação traduzida, erros comuns, o que vem dos profissionais.
- **Assunto da conversa** (`src/agent/assunto-da-conversa.js`): jogo, plataforma, categoria e produtos tirados dos pedidos anteriores do usuário (recalculado do histórico a cada turno). "O jogo", "esse fone", "a placa" sem nome próprio depois = referência; o que falta entra junto da expressão ("dentro do jogo (PUBG de PC)") antes de tudo — tipo de pedido, escopo e buscas já enxergam o assunto. `prompts.referenciaConversa` também reconhece essas expressões.
- **Correções pontuais**: "10 **melhor** fones" e "10 fones" pedem lista de 10; termos de busca não perdem mais o "o" depois de acento ("visã mapa"); eco da linha de formato do prompt não vira ficha nem veredito; citação repetida em vários produtos é traduzida uma vez e vale em todos; checklist e Tarefa usam a mesma chave (sem acento) e a leitura marca o item que ela atende; checkpoint sem consulta limpa a recomendação velha do crítico; limite de passos com material lido entrega resposta; busca com nome de ferramenta ou URL inventada é recusada; `anexar_arquivo` virou `acrescentar_ao_arquivo` (recusa conteúdo vazio e mídia); `numPredict` vale na decisão (`numPredictDecisao` saiu); a resposta do usuário ao `perguntar_usuario` vai pro registro (`dialogos`).

## Controlador v2 (2026-10-05)

Depois das execuções de 05/10 (portal com login, EPZ × Dunu, táticas, fones 2026) e das análises do ChatGPT e do Gemini. A detecção de problemas já existia; o que faltava era transformar detecção em controle.

- **Guarda de repetição pela ação completa** (`loop.chaveDeRepeticao`): antes a chave era só `nome + consulta/url/caminho/motivo/objetivo` — clicar e preencher não têm nenhum desses, então todo clique da execução era "a mesma ação" e o 3º era barrado (o agente chegou na tela certa e foi barrado 15 vezes). Agora entram os argumentos inteiros e, nas ações de página, a impressão digital da página. A mesma ação na mesma página (que, portanto, não mudou nada) é barrada já na 2ª vez, com instrução de escolher outro elemento. Estratégia marcada como insuficiente não bloqueia mais ações de página.
- **Mudança na página medida pelo código** (`tools/navegador.js`, `registrarPagina`): impressão digital (URL + título + elementos + começo do texto) antes e depois de cada ação; a saída começa com "MUDANÇA NA PÁGINA: sim/NENHUMA". Duas ações seguidas sem mudança → aviso de progresso; três → o portão `sem-progresso` manda responder ou perguntar.
- **Plano marcado pela ação**: clicar no elemento "Contracheque" marca o item "Clique em contracheque…" (`loop.itemDaAcao`, pelo rótulo do elemento ou pelo site aberto).
- **Prompt de decisão cabe na janela** (`loop.caberNaJanela`): os prompts subiam até 9.215 tokens com `numCtx` 9.216 — o Ollama cortava o começo sem avisar. Agora sistema + histórico + estado têm orçamento (`numCtx − reserva − folga`), com cortes em ordem (memória → histórico antigo encurtado → estado encurtado → histórico antigo removido → últimas encurtadas). Caracteres por token calibrados pelo `prompt_eval_count`; prompt no teto vira incidente `contextoSaturado`.
- **Status da tarefa** (`registro.statusDaTarefa`): `sucesso` / `parcial` / `falha` / `interrompido`, separado de `resultado`. Parcial: itens do plano não feitos, limite de passos, contrato incompleto ou resposta que admite não ter conseguido.
- **Orçamento único de vetos** ao `responder` (`orcamentoVetosDeResposta`, padrão 2), somando checklist, crítico e material insuficiente.
- **"Perguntar" do crítico só com falta confirmada** (`criticoSoPerguntaComFaltaConfirmada`, padrão `true`): só vale quando a verificação de ambiguidade do início confirmou que falta um dado do usuário, ou sob demanda.
- **Crítica por evento** (`criticaPeriodicaModo: 'evento'`, opção na tela de configurações; padrão continua `'frequencia'`): roda depois de erro de ferramenta, ação repetida barrada, página sem mudança ou falha de protocolo.
- **Pergunta já respondida não se repete**: portão `pergunta-repetida` devolve ao agente a resposta que o usuário já deu.

### Revisão independente (2026-10-06)

Ajustes depois de uma revisão do próprio Controlador v2 (casos em `avaliacao/casos/controlador-v2-revisao.js`):

- **Repetição de ação de página**: só é barrada na 2ª vez se a tentativa anterior idêntica **não mudou nada**. "Próximo → voltar → próximo" volta à mesma impressão e é legítimo. Os valores digitados (`estado.preenchidos`) entram na chave: "Entrar" depois de corrigir a senha é outra tentativa, mesmo com a página igual (senha não aparece na leitura).
- **Progresso**: qualquer mudança zera o contador; clique em caixa/opção/seleção/campo e `voltar_pagina` não contam como "sem progresso"; preencher com valor novo conta como progresso.
- **Impressão da página**: texto inteiro (o corte em 3.000 caracteres escondia mensagens no rodapé) e sem horários/datas (relógio da página fazia tudo parecer "novo").
- **`caberNaJanela`**: remove o histórico em pares (decisão + resultado, nunca um resultado órfão) e em blocos (o começo do prompt muda menos, o Ollama reaproveita o cache); encurta do mais antigo pro mais novo; as 2 últimas mensagens ficam com ≥ 4.000 caracteres e o pedido com ≥ 1.000; quando nem assim cabe, emite `contexto-saturado` antes de enviar.
- **Calibração** (`calibrarRazao`): caracteres/token só desce, entre 2,2 e 3,6.
- **`mesmaPergunta`**: Jaccard das palavras de conteúdo, sem moldura ("informe", "verifique", "está correta"); o portão `pergunta-repetida` veta no máximo 2 vezes.
- **Status da tarefa**: o checklist final vai para o registro no `responder` (antes ficava o do planejamento); itens de entrega ("redigir/apresentar/resumir…") não contam como pendentes; a admissão de falha só é procurada no começo e no fim da resposta, e "falhou"/"não está disponível" saíram (descreviam o assunto, não a tarefa).
- **`itemDaAcao`**: item com duas ações ("acesse e baixe") ou que cita outro site não é cumprido por uma ação só.
- **Eventos** `limite-atingido`, `contexto-ajustado`, `contexto-saturado`, `critica-por-evento` chegam ao renderer.

Segunda revisão (mesmo dia):

- "Saturado" só quando o prompt passa de `max(95% da janela, numCtx − 600)` — em janelas de 20k+ um prompt que coube no orçamento passava de 95% e virava aviso falso.
- `itemDaAcao` confere o verbo: clicar no link "Contracheque" cumpre "Clique/Acesse/Abra contracheque", nunca "Baixe o contracheque" nem "Entrega do contracheque em PDF"; preencher só o usuário não cumpre "Preencher usuário e senha". "Abril" e "entrega" deixaram de contar como verbo.
- `mesmaPergunta` mantém palavras curtas que diferenciam (mês, ano, CPF) e trata número diferente como outra pergunta.
- No beco sem saída, `voltar_pagina` passa pelo portão `sem-progresso` e zera o contador; o aviso de PROGRESSO vai dentro do resultado da ação (antes vinha antes da decisão que ele descreve) e não sugere mais `ver_pagina`.
- `navegar` também fica fora do bloqueio de estratégia insuficiente (o replanejamento bloqueava voltar à página de login).

## Revisão v4 (2026-10-07)

Depois das execuções de 06–07/10 (Bose com fio, Bose × QC 20, Simgot EM6L × SuperMix 4, contracheque, Kinera Celest Sol). Casos em `avaliacao/casos/revisao-v4.js` e no fim de `motor-pesquisa.js`.

- **Credenciais mascaradas** (`src/agent/segredos.js`): login/senha escritos pelo usuário ("o login é (…) e a senha é (…)", "login e senha: a/b", "a senha de acesso é …") e o valor digitado num campo de senha viram segredos da execução. Todo evento sai mascarado (`Agent.emit`), então tela, registro, conversa salva e tarefa persistida não guardam o valor; a memória também não (`memorizar`), passos de `preencher_campo` não viram memória e o arquivo de candidatas a skill recebe o pedido mascarado. Ao carregar, a memória antiga é limpa (`Memory.limparSegredosAntigos`). O modelo continua vendo o pedido inteiro. Valor só conta como segredo com dígito, ou com símbolo e 6+ caracteres. A mensagem que o próprio usuário digitou continua como ele escreveu, no histórico da conversa.
- **Navegador enxerga janela nova e download** (`electron/navegador.js`): janela aberta pelo site vira a ativa (pilha de janelas; ao fechar, volta pra anterior); janela aberta só pra baixar é fechada sozinha; `will-download` vira evento entregue na próxima leitura. `src/tools/navegador.js` escreve "NOVA JANELA ABERTA…", "DOWNLOAD CONCLUÍDO: arquivo (KB) salvo em …" e conta isso como mudança; o loop marca os itens de baixar/salvar e "aguarde a nova janela". Opção `downloadsDoNavegador`: `perguntar` (padrão, janela "Salvar como") ou `pasta-de-trabalho` (salva em `<pasta>/downloads` e anexa na conversa).
- **Tipo `site`** (`tipo-de-pedido.js`): endereço + imperativo de ação (faça login, clique, preencha, baixe, emita, selecione, entre com…). Portão `site-pelo-navegador`: até 2 vetos a abrir_pagina/pesquisa/pergunta antes do primeiro `navegar`. O plano desse tipo começa pelo navegador.
- **Plano sem cardápio**: o prompt não lista mais "calcular, gerar um arquivo"; `itemForaDoPedido` tira cálculo, arquivo/resumo e preço/loja que o pedido não pediu.
- **Produtos nomeados** (`produtosNomeados`): nome entre parênteses/aspas (com maiúscula ou dígito, 2+ palavras ou com dígito; fora preço, unidade, jogo/plataforma) + pergunta que avalia/compara → motor, com as opções do usuário (sem descoberta). Um nome só = avaliação (`compositor.montarAvaliacao`). O plano do 7B com "A, B" numa linha vira duas opções.
- **Status e avisos**: o status considera o verificador (menos em ação num site e em resposta montada); resposta montada sem um produto que o usuário nomeou ganha aviso e status parcial. Portão `pergunta-cardapio` (uma vez). Consulta embrulhada ("pesquisar_e_ler(…)") é desembrulhada; "veja", "pra mim" não são assunto.

## Decisores (2026-10-08)

`avaliacao/decisores.js` compara as regras de roteamento com modelos de decisão do Ollama (`/v1/systemone`, Ollama ≥ 0.35: Tev1 0.8B/4B, Nimble) e, opcionalmente, com o Qwen classificando em JSON. Quatro decisões por pedido: rota (produto · guia · explicação · site · tarefa), precisa de web, produto nomeado e continuação da conversa. Os rótulos vêm dos registros de execução reais, com login/senha mascarados (`avaliacao/decisores/pedidos-reais.json`, fora do Git) e casos extras (`pedidos-extras.json`). Só mede; não muda o comportamento do agente.

Primeira medição só das regras (215 pedidos reais + 15 extras): rota efetiva 80%, produto nomeado 93%, continuação 78%. A maior fraqueza é explicação ("Me conte quem foi…", "como uma estrela se forma") caindo no laço comum (28 de 48). A rotulagem mostrou dois erros de regra, corrigidos: o "(especificamente: …)" que a reescrita acrescenta virava produto nomeado e mandava "O que é o protocolo TCP?" para o motor de recomendação; questão de prova ("Questão 1 (Teoria da Complexidade)…", "Pergunta 1 … a. b. c.") caía em "produto".

## Revisão v5 (2026-10-08)

Origem: o log do Ollama 0.40.1 depois do teste do DeepSeek R1 no AuGPT e do teste da RTX 5080 no chat do próprio Ollama.

- **Prompt maior que a janela**: no motor novo (llama-server) o Ollama recusa com erro 400 ("request (N tokens) exceeds the available context size (M tokens)") em vez de cortar o começo em silêncio. `ollama.chat`/`chatStream` reconhecem o erro (`codigo: 'contexto'`), cortam o MEIO da maior mensagem (começo e fim ficam) usando a razão caracteres/token medida no próprio erro e reenviam uma vez; o resultado traz `contextoReduzido` e o agente avisa (`aviso` + `contexto-saturado`). Antes de enviar, a destilação mede a densidade do material (`estimarTokens`: dígito e pontuação contam como token; página de preço passa de 0,5 token por caractere, texto corrido fica perto de 0,32) e corta o pedaço no tamanho que cabe (`maximoQueCabe`, também usado na divisão em pedaços).
- **Modelos**: `/api/show` informa as capacidades. Modelo de decisão (`decision`, ou tev1/Nimble pelo nome) sai das listas de modelo; como principal, a execução para antes de começar com a explicação; como copiloto dedicado, é ignorado na execução e o crítico usa o modelo principal. Modelo que pensa (`thinking`: R1, QwQ) aparece marcado como lento, não entra na lista de copiloto e gera aviso quando é o principal. O erro "Jinja Exception: System message must be at the beginning" ganhou explicação amigável.
- **Histórico e estimativa de preço**: `estatisticasDaPagina` lê o que os sites de histórico já calculam (menor preço atual, mínimo/mediana de N meses, média de 30 dias, data de "atualizado em", lançamento) — o rótulo de cada preço é a própria linha (ou a anterior, quando o preço está sozinho), a partir da última frase, para o "Parcelado em Loja B" de um preço não contaminar a "Média dos últimos 30 dias" do seguinte; parcelado e "a partir de" ficam fora; página de uma versão específica (marca de fabricante no título) fica marcada e só aparece sem estatística da linha. Preço de loja ou agregador sem data na frase vale como preço de hoje (antes a data de cadastro da página virava "dez/2024"); preço datado antes do lançamento sai da série; estatística de período não vira ponto do mês; numa vitrine fica só o menor preço da página por mês. Valor abaixo de 50% ou acima de 250% da mediana do produto é descartado (o "R$ 1.924,00" do Hardware Barato era a mediana do eBay em dólar). Pedido de estimativa (Black Friday, "quanto vai chegar"): com Black Friday anterior na série, aplica a queda observada (nov contra set–out) ao preço de referência (±3%); sem ela, faixa entre a referência e a queda de 12 meses (mediana → mínimo), limitada a 15% e nunca abaixo do mínimo de 12 meses, dita como hipótese; sem base, o bloco manda dizer que não há. Enquanto nenhuma página de histórico foi lida, o modelo de decisão recebe a dica de buscar uma (no máximo por 2 buscas).
- **Revisão independente (09/10/2026)**, nove achados corrigidos, cada um com caso no grupo `v5 rev`:
  - **Produto de cada preço:** é a última menção de modelo da mesma família antes dele (`mencoesDeModelo`: mesmo prefixo e mesma quantidade de dígitos). Preço depois de outro modelo ("RTX 5070 Ti", "RTX 5080 Super") fica fora, na página e na frase.
  - **Lançamento:** só vale com rótulo ("Lançamento", "Release Date", "lançada em"; "released" solto pegava data de driver). Um lançamento que apagaria metade ou mais da série é ignorado.
  - **Faixa de plausibilidade:** as estatísticas são comparadas com tudo; as observações da série, só com o mesmo mês (queda real de R$ 13 mil para R$ 4 mil ao longo dos anos não é erro).
  - **Reenvio por contexto:** corta o material antes da mensagem system, que só entra em último caso. A contagem real do 400 recalibra caracteres/token da decisão, e `calibrarRazao` nunca aumenta a razão.
  - **Início da execução:** `rodando` e o controller são marcados antes de conferir os modelos, para que um segundo início seja barrado e o `parar()` funcione nesse intervalo.
  - **Estimativa de Black Friday:** novembro do ano corrente não conta como Black Friday observada, e só queda conta como queda. Referência no mínimo de 12 meses ou abaixo dele resulta em sem estimativa, com o motivo (antes a faixa saía invertida).
  - **Pedido de estimativa:** a palavra de estimativa precisa falar de preço ("estimativa de tempo de entrega" e "tendência de consumo" não contam).
  - **Rótulo das observações:** preço de loja sem data aparece como "preço do dia".

## Ajustes de 10/10/2026: roteador híbrido, retomada e erros temporários

Origem: a análise do documento de arquitetura que o Davi discutiu com o Gemini e o ChatGPT, cruzada com o código atual. Casos em `avaliacao/casos/roteador.js`, `retomada.js` e `erros-temporarios.js`.

- **Roteador híbrido** (`src/agent/roteador.js`): a regra de `tipo-de-pedido.js` decide primeiro; com `roteadorDecisor` ligado (Ajustes → Pesquisa na web, desligado por padrão), um modelo de decisão do Ollama (`modeloDecisor`, padrão `tev1`, via `/v1/systemone`) confere a rota e troca quando a confiança é ≥ `limiarDecisor` (0,6). Nunca troca `local` nem `site` (a regra é exata) e ignora "site" do modelo sem endereço. Decidido uma vez em `run()` e repassado a `ehPedidoDeRecomendacao`/`modoDaPesquisa`/`executarPesquisaPlanejada` (`{ rota }`), para o loop e o motor não discordarem. Erro, demora (`tempoLimiteDecisorMs`, 8 s) ou resposta sem decisão: a regra decide e o motivo vai para o aviso e para o registro (`tipoDePedido.fonte`, `tipoDaRegra`, `decisor`, `falhaDoDecisor`). Simulado com o código real sobre as decisões gravadas em 08/10 (230 pedidos): rota 80,0% (regras) → 93,9% (tev1 4B) e 87,8% (tev1:0.8b). O limite foi escolhido nesses mesmos dados; rotular pedidos novos e conferir antes de ligar por padrão.
- **Retomada** (`src/agent/retomada.js`): `retomarDe()` só repassava o checklist. Agora páginas baixadas (`tools/web.js: lerComCache`) e destilações (`destilarLeitura`, chave = objetivo + foco + opção + texto) ficam em `<pasta>/.augpt/retomada/<conversa>.json` e a execução seguinte da mesma conversa, quando a anterior foi interrompida (`tarefaAnterior`), não baixa nem destila de novo. Anterior concluída ou ausente: o arquivo é apagado no início. Tudo expira em 12 h. Só leitura da web pública (`pesquisar_e_ler`, `abrir_pagina`): arquivo do usuário e página do navegador do app não vão para o disco por este caminho. A busca em si continua sendo refeita (é barata). `retomarLeituras: false` desliga. Registro: `retomada.disponiveis`, `paginasUsadas`, `destilacoesUsadas`.
- **Erro temporário × definitivo** (`src/tools/erros.js`): `buscar_web`, `abrir_pagina` e `pesquisar_e_ler` ganham UMA nova tentativa quando a falha é rápida e passageira (HTTP 429/5xx, conexão derrubada) e a primeira tentativa levou menos de 8 s. Timeout e "nenhum provedor de busca respondeu" não repetem: a primeira versão repetia e a bancada foi de 16 s para 293 s. Erro definitivo (404, 403, endereço bloqueado, arquivo inexistente) volta ao modelo com a marca "erro definitivo: repetir a mesma chamada não adianta", e a `Tarefa` bloqueia a mesma assinatura. Escrever, executar e agir em site nunca são repetidos.

## Quando a pesquisa não acha

Nem toda pergunta tem página na web. Perguntas conceituais ("X consegue fazer Y?") costumam voltar com material sobre assunto vizinho, e o risco é o agente montar uma resposta plausível que não responde nada.

Antes de redigir, o loop mede se o material coletado **cobre** o pedido: extrai os termos que identificam o assunto (descartando interrogativas, verbos de pedido e marcadores de tempo), ignora o cabeçalho que as ferramentas de busca acrescentam — senão o eco da própria consulta garante casamento falso — e compara por radical, para flexão casar.

Três resultados, três comportamentos do redator:

| Cobertura | O que o redator faz |
|---|---|
| boa | usa o material; dado concreto só de fonte |
| parcial | usa o material no que cobre e separa o resto: "as fontes trazem X; sobre Y..." |
| ausente | responde com conhecimento próprio, abrindo com aviso — e é proibido de responder "não há informações suficientes" |

Em cobertura parcial ou ausente, a interface mostra a faixa de aviso acima da resposta, com os termos que ficaram sem cobertura.

## Guarda-corpos de qualidade da resposta

Modelo local pequeno erra de formas previsíveis. Três dessas falhas são interceptadas em código, não só no prompt:

- **Pergunta prematura** — `perguntar_usuario` é recusada nos dois primeiros passos enquanto nada tiver sido pesquisado. O modelo recebe de volta a instrução de trabalhar antes de devolver o pedido ao usuário.
- **Resposta curta demais** — se o pedido trouxe um tamanho ("50 linhas", "300 palavras", "5 parágrafos", "10 itens") e a resposta entrega menos de 70% disso, `responder` recusa e manda reescrever com o material que já foi lido. Teto de duas revisões, para não virar laço infinito.
- **Tabela mal formada** — modelos intercalam linha em branco entre as linhas da tabela. O renderizador pula os vazios e completa células faltantes em vez de cuspir texto com barras verticais.
- **Ação repetida** — a mesma busca pela terceira vez é recusada, com a instrução de responder com o que já tem. Modelo pequeno tende a repetir a consulta aumentando os parâmetros, sem que o resultado mude.
- **Encerrar sem responder** — se o agente pesquisou, não escreveu arquivo nenhum e chama `concluir`, a resposta é redigida assim mesmo. "Objetivo concluído" não é resposta para quem fez uma pergunta.
- **Contexto estourado** — `pesquisar_e_ler` tem teto rígido de 4 páginas, 4.000 caracteres por página e 13.000 no total. Material demais empurrava a resposta para fora da janela do modelo, e era essa a origem do JSON truncado.

## Contenção

Um agente que escreve arquivos e roda comandos precisa de freios reais. Os que estão aqui:

- **Jail de caminhos** — todo I/O passa por `Sandbox.resolve()`. `../` e caminhos absolutos são rejeitados antes de qualquer operação.
- **Nome aproximado na leitura** — modelo pequeno erra uma letra do nome do arquivo com frequência ("importante-4.txt" vira "important-4.txt") e um ENOENT cru o manda procurar em Downloads. As ferramentas de leitura resolvem por aproximação, ignorando acento, caixa, espaço e hífen, e informam a correção. Ambiguidade não é adivinhada: o erro lista os candidatos. `apagar_arquivo` nunca aproxima.
- **Portão de aprovação** — ferramentas que só leem (busca, leitura de página, listar arquivo) nunca pedem confirmação, em modo nenhum: elas não alteram nada. No modo *guiado* (padrão) tudo que escreve ou executa para e espera sua confirmação, com os argumentos exatos à vista. *Manual* confirma toda escrita e execução; *automático* não pergunta.
- **Lista de bloqueio do terminal** — `rm -rf /`, `mkfs`, `dd of=/dev/…`, fork bombs, `curl | sh` e afins são recusados mesmo no modo automático.
- **Timeouts** — comandos e scripts são mortos ao ultrapassar o limite configurado.
- **Teto de passos** — o loop para sozinho no `maxIterations`.
- **Isolamento do renderer** — `contextIsolation` ligado, `nodeIntegration` desligado, CSP restritiva, navegação externa bloqueada.
- **Segunda opinião em `apagar_arquivo` e `executar_comando`** — antes do portão de aprovação, uma chamada curta pede ao modelo uma crítica focada NESTA chamada específica ("é o arquivo certo? o comando é reversível?"), não no risco genérico da ferramenta. Não substitui sua decisão — só chega junto dela, marcada em vermelho no card de confirmação. Some sozinha quando não há nada além do óbvio, e desliga em `segundaOpiniaoRiscoAlto: false`.

O modo automático continua sendo modo automático: use em pasta descartável até confiar no comportamento do seu modelo. A segunda opinião acima só aparece quando existe portão de aprovação — em modo automático ela não entra em cena, pelo mesmo motivo que nenhuma outra confirmação entra.

---

## Ajustes

Servidor Ollama, modelo de embedding, máximo de passos, temperatura, janela de contexto, timeout do terminal e a lista de ferramentas sempre permitidas — todos na engrenagem do topo, persistidos entre execuções.

## Execuções

A contagem de tokens inclui **decisão, destilação e redação**. Antes só as decisões entravam, e execuções que rodam por rotina — sem passar pelo laço — apareciam com custo zero.

Cada execução do agente vira um registro em JSON: modelo, passos, ferramentas com duração e erro, fontes lidas, skills ativadas, cobertura do material, tokens, incidentes e resultado. A aba **Execuções** mostra o histórico, um relatório detalhado por execução e — a parte que interessa — o **comparativo por modelo**:

| modelo | execuções | conclusão | passos | tempo | tokens | erros | incidentes | nota |
|---|---|---|---|---|---|---|---|---|
| qwen2.5:14b | 12 | 92% | 4,1 | 31,2s | 9.840 | 0,3 | 0,1 | 4,3 |
| llama3.1:8b | 18 | 72% | 6,8 | 12,4s | 7.210 | 1,2 | 0,8 | 3,1 |

O coletor vive no agente, não na interface, de propósito: **a bancada em modo real grava no mesmo formato**. Rodar `npm run avaliar -- --real --modelo=qwen2.5:14b` popula a mesma tabela, então medição sintética e uso real caem no mesmo placar em vez de virarem dois números que não se comparam.

As estrelas em cada execução são a única medida de qualidade que não dá para automatizar. Sem elas a tabela mostra velocidade e obediência, não se a resposta prestou.

## Destilação de fatos

Uma leitura devolve 9 mil caracteres de página com menu, rodapé e "leia também". Empilhar três dessas enche a janela de contexto de ruído. Depois de cada leitura, uma chamada curta ao modelo de decisão transforma o material numa lista de fatos relevantes ao pedido — números e datas copiados exatamente.

Regra que não pode ser quebrada: **o texto bruto é preservado**. A verificação de evidências e a medição de cobertura conferem contra ele, senão um número que a destilação não copiou viraria "inventado" na verificação seguinte.

Se a destilação falhar ou devolver quase nada, fica com o material original — perder conteúdo é pior que gastar contexto. Liga e desliga em `destilarFatos`, com piso em `destilarAcimaDe` (1.500 caracteres por padrão).

## Rotinas executáveis

Skill descreve método em texto e o modelo interpreta. **Rotina é o caminho já decidido**: uma sequência fixa de ferramentas num `workflow.json` ao lado do `SKILL.md`.

```json
{
  "nome": "Previsão do tempo",
  "parametros": [{ "nome": "cidade", "descricao": "cidade e estado", "obrigatorio": true }],
  "passos": [
    { "ferramenta": "pesquisar_e_ler",
      "argumentos": { "consulta": "previsão do tempo {cidade} {dias} dias", "paginas": 2 } }
  ],
  "foco": "Tabela com um dia por linha: data, mínima e máxima, chance de chuva."
}
```

Quando a skill correspondente é ativada, o loop faz **uma** chamada para extrair os parâmetros e executa os passos direto, indo para a redação. Onde o caminho é sempre o mesmo, deixar um modelo de 8B redescobri-lo a cada vez só cria chance de erro.

**Limite deliberado: passos lineares, sem condicional e sem laço.** Assim que se admite `if`, o JSON vira linguagem de programação sem depurador. Faltou parâmetro no pedido, ou um passo falhou? A rotina devolve o controle ao agente com o que já coletou, e o laço normal segue dali.

As rotinas usam o mesmo executor do laço: aprovação, dossiê, destilação e registro continuam valendo. Elas pulam as decisões, não as salvaguardas.

## Memória operacional

A memória vetorial guarda **o que** foi dito. Esta guarda **como as coisas funcionam**:

- `loja.exemplo.com: só entrega o conteúdo depois do JavaScript — vá direto para a renderização`
- `ler_arquivo: copie o nome exatamente de listar_arquivos antes de chamar`
- `formato: prefere resposta em tabela`

Aprende sozinha, observando os próprios eventos — sem custo de chamada ao modelo. **Uma observação não vira lição**: só a partir da segunda ocorrência ela ganha confiança e passa a valer, porque uma vez pode ser acaso.

Serve para duas coisas: entra no prompt de decisão como um bloco curto filtrado pelo pedido atual, e é consultada na hora de ler — site conhecido por exigir JavaScript pula a tentativa direta, economizando uma requisição e alguns segundos.

Fica em `.augpt/operacional.json` na pasta de trabalho, e a página de Configurações lista tudo com contagem de ocorrências e botão de esquecer, item a item.

## Reflexão pós-execução

A memória operacional acima aprende **fatos** de um evento (site X exige JavaScript). Isto aprende **estratégia**: ao final de cada execução, uma chamada curta e assíncrona pergunta ao próprio modelo, em uma frase, o que ele faria diferente numa tarefa parecida — e a resposta vira uma lição guardada sob o tipo "estratégia", indexada pelo tipo de tarefa (a skill que foi ativada, ou "geral" quando nenhuma foi).

**Não passa pelo mesmo portão de confiança que um fato de evento.** Um padrão detectado por regex (como "este site precisa de JavaScript") pode ser coincidência da primeira vez — por isso exige a segunda ocorrência. Uma reflexão é diferente: é o próprio modelo julgando deliberadamente o que acabou de fazer, então já entra confiável na primeira vez, e a lição mais recente para o mesmo tipo de tarefa substitui a anterior — não acumula.

**Não custa nada na prática.** É assíncrona como a gravação na memória vetorial: não atrasa a resposta ao usuário, e uma falha na chamada não derruba a execução — é bônus, não requisito. Desliga junto com a memória operacional, ou sozinha em `reflexaoPosExecucao: false`.

## Memória central

A memória vetorial e a operacional vivem dentro da **pasta de trabalho** — trocar de pasta é começar do zero. A memória central mora um nível acima, junto com as configurações do aplicativo: fatos duráveis sobre **o usuário**, que valem em qualquer projeto — nome, formato de resposta preferido, o que quer que valha a pena lembrar de uma pasta para a outra.

É pequena de propósito e **sempre** entra no prompt de decisão, ao contrário da memória vetorial (que só entra por relevância ao pedido). A ferramenta `atualizar_memoria_central` é a única forma de gravar ali — não é efeito colateral de `salvar_memoria`, que continua sendo sobre a tarefa atual, não sobre quem pediu a tarefa. Para esquecer uma chave, o próprio agente chama de novo com o valor vazio; a página de Configurações também lista tudo e apaga item a item.

## Verificação de evidências

Depois de redigir, o loop confere se os **números e datas da resposta aparecem no material coletado**. Se a proporção sem respaldo for alta, ou se a resposta não tratar do que foi perguntado, pede uma reescrita — uma só, porque insistir com modelo pequeno degrada em vez de corrigir. Fica com a versão que tiver menos afirmações sem respaldo.

O trabalho de verdade está na **normalização**, não na comparação. A fonte traz `410,49` e o modelo escreve `R$ 410,49`; a fonte traz `17/08/2026` e ele escreve `17 de agosto`. Comparação literal marcaria resposta correta como inventada — e um verificador que grita errado é pior que nenhum. O conversor trata separador brasileiro e americano, moeda, unidades, percentual, pontuação grudada e arredondamento até 0,5%.

Além de conferir se o número está no material, o verificador confere se os números **fecham entre si**: valor em dólar seguido de valor em real ("$1.000 (R$ 1.000 a R$ 1.200)", "$999 (ou R$ 9.990)") numa razão fora de 3,5–8 reais por dólar, e "média" seguida de uma faixa ("Preço médio: R$ 8.499,99 a R$ 9.599,99"). Inconsistência pede reescrita e a instrução diz o que corrigir.

Nas perguntas com várias partes, vírgula dentro de aspas é lista de nomes e não vira parte ("fóruns como 'reddit, clube do hardware, forum do adrenaline'" era lido como três perguntas, e a resposta saía três vezes), e trecho curto que começa com conectivo ("após obter os dados") não é parte. O complemento de uma parte não recebe o plano da resposta inteiro, é descartado se só repete a resposta (mesmos títulos ou metade das linhas) e só é aceito se cobrir mais partes que antes.

O resultado é **suspeita, nunca veredicto**: nada é apagado da resposta. Remover uma frase do meio de um texto gerado deixa referência solta, e se o verificador errar, apagou informação correta sem o usuário saber. A interface marca os valores contestados abaixo da resposta.

## Modelo por função

Decidir é classificação curta; redigir é geração longa. Em **Configurações → Conexão** dá para usar modelos diferentes: um pequeno e rápido decidindo, um maior escrevendo. O passo caro acontece uma vez por execução, não uma vez por passo.

No comparativo por modelo, a configuração híbrida aparece como `qwen2.5:3b → qwen2.5:14b`.

## Comparar modelos

```bash
npm run comparar -- llama3.1 qwen2.5:14b
npm run comparar -- "qwen2.5:3b→qwen2.5:14b"
```

Roda o mesmo conjunto de 9 tarefas reais em cada configuração e imprime a tabela:

```
configuração              fatos  passos  s/tarefa  inventou  total
llama3.1                  61%    6.8     12.4      2         112s
qwen2.5:14b               89%    4.1     31.2      0         281s
```

**fatos** é a proporção dos dados esperados que apareceram na resposta — cada tarefa carrega o próprio gabarito, o que é a única forma honesta de medir qualidade sem juiz externo. Repare que modelo mais lento pode perder no uso real mesmo ganhando em fatos: a coluna `s/tarefa` existe para isso.

## Bancada de avaliação

```bash
npm run avaliar
```

121 casos em cerca de dois segundos, contra um Ollama falso com roteiro fixo. Cada bug já corrigido virou um caso — se voltar a falhar, é regressão, e o executor avisa comparando com a rodada anterior.

Ela não testa a inteligência do modelo, que não é determinística. Testa o que está em volta: como o loop reage quando o modelo devolve campo vazio, erra uma letra do nome do arquivo, repete a mesma busca ou responde fora do protocolo. Foi exatamente ali que moraram os bugs.

`npm run avaliar -- --real` roda contra o seu Ollama de verdade, sem roteiro: não passa nem falha, **mede** passos, chamadas e tamanho da resposta. Serve para comparar modelos ou avaliar mudança de prompt com número em vez de impressão.

Detalhes e como escrever um caso: `avaliacao/LEIA-ME.md`.

## Empacotar

```bash
npm i -D electron-builder
npm run dist
```
