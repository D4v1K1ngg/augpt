# AuGPT

Um agente de IA para o seu computador. Você escreve um objetivo em português, e o AuGPT planeja os passos, pesquisa na web, lê e cria arquivos, e mostra na tela cada decisão que tomou. O modelo de linguagem roda na sua máquina, pelo [Ollama](https://ollama.com): nenhuma conversa é enviada a um serviço de IA na nuvem.

> **Versão 0.6 — primeira versão pública.** O app está em uso diário, mas ainda é um projeto jovem. Leia a seção [Segurança e rede](#segurança-e-rede) antes de usar o modo automático.

## O que ele faz

- **Pesquisa de verdade.** Busca em várias fontes, lê as páginas, cruza números e opiniões entre sites, avisa quando as fontes divergem e confere a resposta final contra o material lido.
- **Trabalha com arquivos.** Lê PDF (inclusive boleto protegido), Word, Excel, PowerPoint, OpenDocument, ePub e texto. Gera `.docx`, `.xlsx`, `.pdf`, `.html` e gráficos sem instalar nada além do app.
- **Compara preços** entre lojas e guarda um histórico pra identificar desconto falso.
- **Navega em sites** que exigem clique ou formulário, numa janela de navegador separada.
- **Lembra** do que foi lido na conversa, do que funciona em cada site e de fatos sobre você que você pedir pra guardar.
- **Segue métodos (skills)** para tipos comuns de tarefa: pesquisa acadêmica, redação do ENEM, análise de documento, revisão de código, tradução e outros 18.
- **Pode ter um revisor.** O "Copiloto" critica o plano durante a execução, usando o mesmo modelo ou um segundo modelo dedicado.

Tudo isso vem em 35 ferramentas nativas, 23 skills e suporte a servidores [MCP](https://modelcontextprotocol.io) para acrescentar mais.

## Requisitos

- **Windows, Linux ou macOS.** O desenvolvimento e o uso do dia a dia são no Windows; nos outros sistemas o app roda, mas é menos testado.
- **[Node.js](https://nodejs.org) 20 ou mais novo** (ainda não há instalador pronto; veja [Instalação](#instalação)).
- **[Ollama](https://ollama.com/download)** instalado.
- **Memória:** o que mais pesa é o modelo. Use a tabela abaixo como ponto de partida.

| Memória do computador | Modelo sugerido | Como vai ser |
|---|---|---|
| 8 GB, sem placa de vídeo dedicada | `llama3.2:3b` | Funciona, mas cada pedido pode levar minutos. Reduza a janela de contexto (veja [Problemas comuns](#problemas-comuns)) |
| 16 GB, ou placa de vídeo com 6–8 GB | `llama3.1:8b` ou `qwen2.5:7b` | O uso recomendado |
| 32 GB ou mais, ou placa de vídeo com 12 GB+ | modelos de 14B, ou dois modelos ao mesmo tempo (Copiloto dedicado) | Respostas melhores e revisão por um segundo modelo |

Modelos muito pequenos (2–3B) erram mais o formato que o agente usa pra decidir cada passo e gastam passos se corrigindo.

## Instalação

1. Instale o [Ollama](https://ollama.com/download).
2. Baixe o AuGPT e instale as dependências (só o Electron, uns 100 MB):

   ```bash
   git clone https://github.com/D4v1K1ngg/augpt.git
   cd augpt
   npm install
   npm start
   ```

3. Na primeira vez, a tela do **Agente** mostra um guia de preparação em três passos: confere se o Ollama está instalado, liga ele se estiver fechado e baixa o modelo recomendado pra memória do seu computador (mais o `nomic-embed-text`, que melhora a memória do agente). É só seguir os botões; o modelo baixado já fica escolhido.

   Se preferir o terminal, o equivalente é:

   ```bash
   ollama pull llama3.1:8b        # ou llama3.2:3b com 8 GB de memória
   ollama pull nomic-embed-text   # opcional: melhora a memória
   ```

   Modelos de embedding como o `nomic-embed-text` não aparecem no seletor **modelo**: eles servem só pra memória e não conversam.

Numa instalação nova, em computador com menos de 12 GB de memória, o AuGPT já começa com a janela de contexto menor e sem a criação automática de skills em segundo plano, pra cada pedido não levar minutos.

## Primeiros passos

Abra **Agente** no menu lateral e peça algo concreto, por exemplo:

- "Pesquise os três melhores fones intra-auriculares até R$ 300 e compare numa tabela."
- "Leia o contrato.pdf da pasta de trabalho e me diga as multas por cancelamento."
- "Crie uma planilha com os gastos deste mês a partir do extrato.csv."

Os controles no topo mudam como ele trabalha:

- **autonomia**: `manual` confirma toda ação; `guiado` (o padrão) confirma só as arriscadas, como apagar arquivo, rodar comando ou enviar formulário; `automático` não pergunta nada.
- **raciocínio**: `leve` é o mais rápido. `médio`, `alto` e `extremo` planejam mais, leem mais fontes e revisam mais, e ficam bem mais lentos.

Em pedidos de recomendação ou comparação ("qual o melhor fone para jogar PUBG", "compare A e B"), o agente faz uma **pesquisa planejada**: define os critérios que importam para o uso descrito, descobre quais opções são recomendadas (e confere cada nome no material, descartando o que o modelo inventar), pesquisa cada finalista e monta uma tabela opção × critério com a fonte de cada célula antes de responder. Leva mais tempo que uma busca simples; dá pra desligar em **Ajustes → Pesquisa na web**.

Os arquivos que o agente lê e cria ficam em **Documentos/AuGPT Workspace**; as ferramentas de arquivo não saem dessa pasta. A aba **Conversa** é um chat direto com o modelo, sem ferramentas. **Execuções** guarda o histórico de cada pedido, com tempo, custo e o raciocínio passo a passo.

## Segurança e rede

O AuGPT é um agente: ele age no seu computador. Vale saber exatamente o que isso significa.

**O que ele pode fazer.** Ler e escrever arquivos na pasta de trabalho, rodar comandos no terminal e código em Python ou JavaScript (com as suas permissões, não só dentro da pasta), abrir sites e preencher formulários no navegador do app. No modo `guiado`, comandos, código, exclusão de arquivos, gravação na memória central e ações em sites pedem sua confirmação antes, e o cartão mostra exatamente o que vai rodar. No modo `automático`, nada pede (o app avisa e pede confirmação antes de ligar esse modo).

**Proteções que já vêm ligadas:**

- **Páginas da web são tratadas como dado, não como ordem.** Se uma página tentar fazer o agente abrir um endereço inventado carregando dados (por exemplo, o conteúdo de um arquivo seu), ele para e pede sua confirmação mostrando o endereço.
- **Rede local bloqueada.** O agente não abre endereços do seu computador nem da sua rede (localhost, 192.168.x.x, o roteador), nem por redirecionamento. Dá pra liberar em **Ajustes → Pesquisa na web**, se você quiser que ele leia um servidor local.
- **Sem "sempre permitir" pra comando, código e exclusão de arquivo.** Essas ações são aprovadas uma de cada vez.
- **A pasta de trabalho não vaza por atalho.** Links e junções que apontam pra fora dela são recusados.
- **Programas só rodam com a sua confirmação.** Todo servidor MCP novo mostra o comando num aviso do sistema antes de iniciar, e "Abrir com o app padrão" não executa `.exe`, `.bat`, scripts e afins.
- **Comandos não enxergam suas credenciais.** Variáveis de ambiente com cara de segredo (`*_TOKEN`, `*_API_KEY`, `*_SECRET`, `*_PASSWORD`) não são repassadas ao terminal nem ao código que o agente roda.
- **O navegador do app não ganha permissões.** Câmera, microfone, notificações e localização são sempre negados.

**O que ainda depende de você:**

- **Não use o modo automático com uma pasta de trabalho que tenha arquivos importantes.** Nenhuma proteção contra injeção de prompt é perfeita, e no automático nada pede confirmação.
- **Ferramentas extras e servidores MCP rodam com as suas permissões.** Só adicione o que você confia. As ferramentas que você coloca na pasta de ferramentas do usuário (**Skills → Ferramentas → Abrir pasta**) sempre pedem confirmação no modo guiado.

**O que sai do seu computador.** O modelo de IA roda localmente, mas pesquisar na web exige internet:

- As buscas vão para DuckDuckGo, Marginalia e Wikipédia (ou para um SearXNG, se você ativar).
- O leitor externo `r.jina.ai`, que recebe o endereço de páginas que não abrem direto, vem **desligado**. Dá pra ligar em **Ajustes → Pesquisa na web**.
- Ativar o **SearXNG embutido** baixa Python e o SearXNG da internet.

Conversas, memória e registros de execução ficam em arquivos JSON na pasta de dados do app, sem criptografia.

## Problemas comuns

**"ollama offline" no topo.** O Ollama não está rodando. Enquanto não houver modelo pronto, a tela do **Agente** mostra o guia de preparação com um botão pra ligar o Ollama; depois disso, o AuGPT oferece ligar sozinho sempre que ele cair. Também dá pra abrir o aplicativo do Ollama ou rodar `ollama serve` num terminal. O AuGPT procura o Ollama também nas pastas onde o instalador costuma colocá-lo, então não precisa reiniciar o computador depois de instalar.

**"Nenhum modelo do Ollama disponível".** Volte à tela do **Agente**: o guia mostra em que passo parou (instalar, ligar ou baixar o modelo).

**Uma mensagem de erro que não ajuda.** Os erros mais comuns (modelo não baixado, Ollama fora do ar, falta de memória, demora demais, nenhum buscador respondendo) já aparecem explicados, com o texto técnico original numa linha menor embaixo. Pra ver também os cartões internos de recuperação ("JSON inválido", "contexto compactado"), ligue **Ajustes → Avançado → Mostrar detalhes técnicos da execução**.

**Muito lento.** Use o raciocínio `leve`, um modelo menor, e reduza **Ajustes → Avançado → Janela de contexto — decisão** para 8192.

**Mexi em algum ajuste e piorou.** O botão **Restaurar padrões**, no topo de Ajustes, volta todos os ajustes aos valores de fábrica. A pasta de trabalho, o modelo escolhido, as rotinas, os servidores MCP e os domínios marcados continuam como estavam.

**A pesquisa não acha nada.** Os buscadores públicos às vezes limitam o acesso. Ative o **SearXNG embutido** em Ajustes, ou aponte pra um SearXNG que você já tenha.

## Para quem quer mexer no código

```bash
npm run avaliar     # 828 casos de teste em ~15 s, sem precisar do Ollama nem de internet
npm run dev         # abre o app com as ferramentas de desenvolvedor
npm run comparar -- llama3.1:8b qwen2.5:7b   # compara modelos em tarefas reais (precisa do Ollama)
node avaliacao/decisores.js                  # regras × modelos de decisão (tev1…) nos seus pedidos (Ollama ≥ 0.35)
```

| Pasta | O que tem |
|---|---|
| `src/agent/` | o laço do agente, planejamento, verificação, memória |
| `src/tools/` | as ferramentas (web, arquivos, documentos, navegador, terminal) |
| `src/formatos/` | leitura e geração de PDF, Office e ePub, sem bibliotecas externas |
| `skills/` | os métodos por tipo de tarefa, em Markdown |
| `ferramentas/` | ferramentas extras em JavaScript; copie `_MODELO.js` pra criar uma |
| `electron/`, `renderer/` | o app de desktop e a interface |
| `avaliacao/` | a bancada de testes |
| `dados/` | listas de credibilidade de domínios ([fontes e licenças](dados/FONTES.md)) |

A explicação completa de como o agente funciona e por que cada peça existe está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

Toda correção de bug vira um caso na bancada. Se for mandar uma melhoria, rode `npm run avaliar` antes.

## Licença

[MIT](LICENSE). As listas em `dados/` vêm de fontes de terceiros com licenças próprias; veja [dados/FONTES.md](dados/FONTES.md).
