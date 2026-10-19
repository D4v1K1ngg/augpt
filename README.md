# AuGPT

Um assistente de IA que roda no seu computador. Você pergunta ou pede em português, e o AuGPT pesquisa na web citando as fontes, lê e cria arquivos, mede a sua internet, consulta o seu PC e mostra na tela cada passo que deu. O modelo de linguagem roda na sua máquina, pelo [Ollama](https://ollama.com): nenhuma conversa é enviada a um serviço de IA na nuvem.

> **Versão 0.20.** O app está em uso diário, mas ainda é um projeto jovem e o uso do dia a dia é no Windows. Leia a seção [Segurança e rede](#segurança-e-rede) antes de usar o modo automático.

## O que ele faz

Tudo isto também aparece na aba **Utilitários** do app, com um botão para usar cada recurso. Ou é só perguntar a ele: *"o que você pode fazer?"*

**Pesquisa**

- **Responde citando as fontes.** Busca em várias fontes, lê as páginas, confere os números e os anos da resposta contra o que leu e marca com ⚠ o que não achou nas fontes.
- **Produtos e onde comprar.** Recomenda em cartões, com o que a comunidade diz (Reddit e fóruns) e o preço de hoje nas lojas.
- **Investigação com relatório.** Pesquisa pelo tempo que você escolher e entrega um resumo no chat e o relatório completo em PDF.
- **Vídeos do YouTube.** Assiste pela legenda e lê os comentários mais curtidos (com o yt-dlp, instalado por um clique).

**Este computador** (só leitura; nada é mudado e nada sai do PC)

- **Espaço e discos**, **configuração** (processador, RAM, placa-mãe), **Windows atualizado?**, **driver da placa de vídeo**, **periféricos** (a marca do mouse e do teclado), **placa de som**, **fotos, vídeos e músicas** (contados sem abrir nenhum), **programas instalados** e **o que abre com o Windows**.
- **Ler outros dados do PC**: chipset e outros drivers, registro, políticas de grupo, serviços, ajustes da placa de rede. O AuGPT pesquisa como ler, escreve o comando de PowerShell e o código só deixa rodar o que é leitura (veja [Segurança](#segurança-e-rede)).

**Rede e internet**

- **Teste de velocidade** (download, upload, ping, jitter e bufferbloat, com gráfico) ou **só o ping**.
- **Ping e rota para jogos**: PUBG, Fortnite, CS2, Dota 2, LoL e Valorant, com o caminho até o melhor servidor.
- **Raio-X da rede**: cabo ou Wi-Fi, sinal, ping até o roteador, modelo do roteador e os aparelhos conectados.
- **O que usa a internet**: quanto a placa está usando agora e quais programas estão conectados.
- **Ajustes da placa de rede** (DNS, economia de energia, 5 GHz): mostra o plano antes, só aplica com a sua aprovação e dá para desfazer.

**Criar**

- **Gráficos interativos** e **páginas interativas** (calculadoras, simulações, quizzes) dentro da resposta.
- **Imagens** com o FLUX.2 Klein, no seu computador (instalado por um clique, se a placa de vídeo comportar).
- **Ler fotos e prints** que você anexar.

**Sites e arquivos**

- **Navega em sites** que exigem login, clique ou formulário, num navegador separado.
- **Lê e cria arquivos**: PDF (inclusive boleto protegido), Word, Excel, PowerPoint, OpenDocument, ePub e texto; gera `.docx`, `.xlsx`, `.pdf` e `.html` sem instalar nada além do app.
- **Segue métodos (skills)** para tipos comuns de tarefa e aceita servidores [MCP](https://modelcontextprotocol.io) para acrescentar ferramentas.

## Requisitos

- **Windows 10 ou 11.** O app também roda no Linux e no macOS, mas os recursos do computador e da rede são só do Windows por enquanto, e esses sistemas são pouco testados.
- **[Ollama](https://ollama.com/download)** instalado. A tela inicial do app instala e liga para você, se faltar.
- **Memória:** o que mais pesa é o modelo. Na primeira vez, o app olha a sua placa de vídeo e sugere um destes:

| Placa de vídeo (ou memória) | Modelo sugerido | Como vai ser |
|---|---|---|
| sem placa dedicada, ou menos de 4,5 GB | `qwen3.5:2b` | Funciona, mas erra mais e cada pesquisa leva minutos |
| 4,5 a 7 GB (ou AMD antiga, como a RX 580) | `qwen3.5:4b` | Bom para o dia a dia |
| 8 a 16 GB | `qwen3.5:9b` | O recomendado: erra bem menos que o 4B |
| 20 GB ou mais | `qwen3.5:27b` | Respostas melhores, mais lento |

Os modelos Qwen 3.5 também enxergam imagens (fotos e prints anexados).

## Instalação

**Com o instalador (Windows).** Baixe o `AuGPT Setup x.y.z.exe` da página de [Releases](https://github.com/D4v1K1ngg/augpt/releases) e rode. O instalador ainda não tem assinatura digital, então o Windows mostra o aviso "Editor desconhecido": clique em **Mais informações → Executar assim mesmo**.

**Pelo código-fonte** (qualquer sistema, precisa do [Node.js](https://nodejs.org) 20 ou mais novo):

```bash
git clone https://github.com/D4v1K1ngg/augpt.git
cd augpt
npm install
npm start
```

Na primeira vez, a tela de boas-vindas confere se o Ollama está instalado, liga ele se estiver fechado e baixa o modelo recomendado para o seu computador (mais o `nomic-embed-text`, que melhora a memória do agente). É só seguir os botões. Pelo terminal, o equivalente é:

```bash
ollama pull qwen3.5:4b         # ou o da tabela acima
ollama pull nomic-embed-text   # opcional: melhora a memória
```

## Primeiros passos

Abra **Agente** no menu lateral e peça algo concreto, por exemplo:

- "Quais os melhores fones intra-auriculares para PUBG até R$ 300?"
- "Teste minha internet" ou "qual meu ping nos servidores do PUBG?"
- "Meu driver do chipset está atualizado?"
- "Leia o contrato.pdf da pasta de trabalho e me diga as multas por cancelamento."

O seletor ao lado da caixa de mensagem escolhe quanto ele pesquisa: **Automático** (o padrão: produto pesquisa a fundo, o resto pesquisa normal), **Rápido**, **Normal**, **Profundo** ou **Investigação** (você dá o tempo; vem o relatório em PDF). Dá para trocar no meio da conversa. O cartão **Atividade do agente** mostra as etapas e os sites consultados, e o botão **raciocínio** dentro dele abre cada busca e cada página lida.

Em tarefas com arquivo, pasta, site ou comando, a **autonomia** (na barra de cima) diz o que ele pode fazer sem perguntar: `manual` confirma toda ação; `guiado` (o padrão) confirma só as arriscadas, como apagar arquivo, rodar comando ou enviar formulário; `automático` não pergunta nada.

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
- **O PC é só lido.** As consultas ao computador são comandos fixos de leitura. Na leitura livre, em que o modelo escreve o comando, o próprio PowerShell analisa o script antes de rodar e só passa leitura: comandos `Get-*` e de filtrar, programas do Windows em modo de consulta (`reg query`, `gpresult /r`…) e métodos de texto e número. Nada de apagar, parar, instalar, gravar em arquivo ou rodar texto como código, e o script roda em ConstrainedLanguage, sem administrador. Conteúdo de arquivos, senhas e área de transferência ficam de fora.
- **A rede só muda com a sua aprovação.** Os ajustes da placa de rede mostram o plano (antes e depois), só aplicam quando você responde "aplicar", pedem a permissão de administrador do Windows e guardam o estado de antes para "desfazer ajustes de rede".

**O que ainda depende de você:**

- **Não use o modo automático com uma pasta de trabalho que tenha arquivos importantes.** Nenhuma proteção contra injeção de prompt é perfeita, e no automático nada pede confirmação.
- **Ferramentas extras e servidores MCP rodam com as suas permissões.** Só adicione o que você confia. As ferramentas que você coloca na pasta de ferramentas do usuário (**Skills → Ferramentas → Abrir pasta**) sempre pedem confirmação no modo guiado.

**O que sai do seu computador.** O modelo de IA roda localmente, mas pesquisar na web exige internet:

- As buscas vão para DuckDuckGo, Marginalia e Wikipédia (ou para o SearXNG embutido, se você ativar).
- O teste de velocidade baixa e envia dados de teste para a Cloudflare (até ~300 MB no completo); o ping dos jogos mede os servidores deles. Nada do seu computador vai junto.
- As consultas ao seu PC e a leitura livre não usam a internet, a não ser a busca de "como ler" e a da versão mais nova de um driver.
- O leitor externo `r.jina.ai`, que recebe o endereço de páginas que não abrem direto, vem **desligado**. Dá pra ligar em **Ajustes → Pesquisa na web**.
- Ativar o **SearXNG embutido** baixa Python e o SearXNG da internet.

Conversas, memória e registros de execução ficam em arquivos JSON na pasta de dados do app, sem criptografia.

## Problemas comuns

**"ollama offline" no topo.** O Ollama não está rodando. Enquanto não houver modelo pronto, a tela do **Agente** mostra o guia de preparação com um botão pra ligar o Ollama; depois disso, o AuGPT oferece ligar sozinho sempre que ele cair. Também dá pra abrir o aplicativo do Ollama ou rodar `ollama serve` num terminal. O AuGPT procura o Ollama também nas pastas onde o instalador costuma colocá-lo, então não precisa reiniciar o computador depois de instalar.

**"Nenhum modelo do Ollama disponível".** Volte à tela do **Agente**: o guia mostra em que passo parou (instalar, ligar ou baixar o modelo).

**Uma mensagem de erro que não ajuda.** Os erros mais comuns (modelo não baixado, Ollama fora do ar, falta de memória, demora demais, nenhum buscador respondendo) já aparecem explicados, com o texto técnico original numa linha menor embaixo. Pra ver também os cartões internos de recuperação ("JSON inválido", "contexto compactado"), ligue **Ajustes → Avançado → Mostrar detalhes técnicos da execução**.

**Muito lento.** Escolha **Rápido** no seletor da caixa de mensagem, use um modelo menor e reduza **Ajustes → Avançado → Janela de contexto — decisão** para 8192.

**Mexi em algum ajuste e piorou.** O botão **Restaurar padrões**, no topo de Ajustes, volta todos os ajustes aos valores de fábrica. A pasta de trabalho, o modelo escolhido, as rotinas, os servidores MCP e os domínios marcados continuam como estavam.

**A pesquisa não acha nada.** Os buscadores públicos às vezes limitam o acesso. Ative o **SearXNG embutido** em Ajustes, ou aponte pra um SearXNG que você já tenha.

## Para quem quer mexer no código

```bash
npm run avaliar     # ~980 casos de teste em ~30 s, sem precisar do Ollama nem de internet
npm run fumaca      # abre uma cópia isolada do app e confere a tela (precisa do Ollama); rode antes de gerar o instalador
npm run dist        # gera o instalador em dist/
npm run qualidade   # roda o agente de verdade em 46 perguntas e um modelo-juiz dá a nota (precisa do Ollama)
npm run dev         # abre o app com as ferramentas de desenvolvedor
npm run comparar -- llama3.1:8b qwen2.5:7b   # compara modelos em tarefas reais (precisa do Ollama)
node avaliacao/decisores.js                  # regras × modelos de decisão (tev1…) nos seus pedidos (Ollama ≥ 0.35)
```

| Pasta | O que tem |
|---|---|
| `src/agent/` | o laço do agente, o núcleo de pesquisa (`nucleo/`), as rotas que o código responde (`rotas-do-codigo.js`) e o catálogo do que o AuGPT faz (`capacidades.js`) |
| `src/rede/`, `src/pc/` | teste de velocidade, rotas, raio-X e ajustes da rede; consultas e leitura livre do PC |
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
