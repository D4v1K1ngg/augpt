# Fontes dos dados de domínios

Os dois arquivos desta pasta ajudam o AuGPT a desconfiar de sites com histórico de
notícias fabricadas e a evitar domínios bloqueados por ordem judicial no Brasil. Eles
são **gerados** a partir de bases públicas de terceiros pelo script
`ferramentas/_atualizar-dominios.js`:

```
npm run atualizar-dominios
```

O app funciona sem eles: se algum arquivo faltar, a checagem de credibilidade usa só as
regras internas por domínio (`src/tools/search.js`).

## `dominios.json` — credibilidade

Classificação de risco por domínio, montada a partir de duas fontes. Só categorias de
**fabricação** são usadas; classificações de viés político são ignoradas de propósito.

| Fonte | O que se usa | Licença |
|---|---|---|
| [OpenSources](https://github.com/OpenSourcesGroup/opensources) (`sources/sources.json`) | tipo de cada domínio (fake, satire, conspiracy…) | LGPL-3.0, conforme o repositório de origem |
| [Fake.br Corpus](https://github.com/roneysco/Fake.br-Corpus) (USP/ICMC) | só o **domínio** de origem de cada notícia, contado por rótulo (falsa/verdadeira). Nenhum texto do corpus é copiado | sem licença declarada; os autores pedem citação (abaixo) |

Citação pedida pelos autores do Fake.br Corpus:

> Monteiro R.A., Santos R.L.S., Pardo T.A.S., de Almeida T.A., Ruiz E.E.S., Vale O.A.
> *Contributions to the Study of Fake News in Portuguese: New Corpus and Automatic
> Detection Results.* PROPOR 2018. Lecture Notes in Computer Science, vol. 11122.
> Springer, Cham.

## `bloqueados-br.txt` — bloqueio judicial

Lista de domínios bloqueados no Brasil, copiada de
[Router-X/Websites_blocked_Brazil](https://github.com/Router-X/Websites_blocked_Brazil)
(sufixos públicos como `com.br` são descartados). **O repositório de origem não declara
licença.** A lista é um conjunto de nomes de domínio derivados de ordens públicas, mas,
sem licença explícita, a redistribuição não está formalmente autorizada.

## Aviso

Estas listas são sinais auxiliares, não verdade absoluta. Estar numa delas não prova que
um site é falso ou ilegal, e não estar não prova que é confiável. Os mantenedores das
fontes não têm relação com o AuGPT nem endossam este projeto.
