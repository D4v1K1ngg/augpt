---
nome: Analisar documento anexado
descricao: Como ler e resumir boleto, nota fiscal, contrato, fatura, extrato ou currículo
gatilhos: [boleto, nota fiscal, contrato, fatura, extrato, recibo, currículo, curriculo, anexo, anexado, documento, este arquivo, esse arquivo, analise, analisar, resuma o]
# Caso real (v0.5.7, teste ao vivo): pedido "crie um documento
# word com um resumo sobre X" ativou esta skill (gatilho solto "documento"
# bateu) ao lado de "Gerar PDF, Word e Excel" — e a instrução "leia antes de
# qualquer outra coisa" fez o modelo chamar `ler_documento` num arquivo que
# não existia (ele estava tentando CRIAR o documento, não ler um que já
# existisse). nao_use_para cobre só o padrão de verdade que causou isso:
# pedir pra CRIAR um documento, não analisar um que já está na pasta.
nao_use_para: [crie um documento, criar um documento, crie o documento, gere um documento, gerar um documento, escreva um documento, novo documento]
ferramentas: [ler_documento, inspecionar_arquivo, listar_arquivos]
etapa: ambas
prioridade: 4
---

Arquivo anexado já está na pasta de trabalho. Leia antes de qualquer outra coisa — **não pesquise na web** para entender um documento que você tem em mãos.

## Como ler

Se não souber o nome exato, `listar_arquivos` primeiro e copie o nome de lá — inteiro, com acento e hífen. Nome de arquivo em português não vira inglês: "importante-4.txt" continua "importante-4.txt".

Anexo nunca está em Downloads nem em outra pasta do computador: ele já foi copiado para a pasta de trabalho. Não tente mover arquivo com comando de terminal.

`ler_documento` com o caminho do arquivo. Ele abre PDF (inclusive os cifrados com senha vazia, como boleto de banco), Word, Excel, PowerPoint e o resto. Uma chamada basta.

Se vier "sem texto extraível", o PDF é digitalizado de verdade e só OCR resolve. Diga isso ao usuário em vez de pedir outro formato — talvez ele não tenha outro.

## O que extrair, por tipo

**Boleto / fatura**: valor, vencimento, beneficiário e CNPJ, pagador, linha digitável, nosso número, multa e juros após o vencimento, descontos por pagamento antecipado e o prazo de cada um.

**Nota fiscal**: número, data de emissão, emitente, destinatário, itens com quantidade e valor unitário, impostos, valor total.

**Contrato**: partes, objeto, valor, vigência, condições de rescisão, multa, foro. Destaque prazo e penalidade — é o que costuma pegar as pessoas.

**Extrato**: período, saldo inicial e final, maiores entradas e saídas, total de tarifas.

**Currículo**: formação, tempo de experiência, tecnologias, último cargo.

## Como responder

Tabela de campo e valor para os dados principais, e depois duas ou três linhas com o que realmente importa: quanto pagar, até quando, e o que muda se atrasar.

Reproduza número exatamente como está no documento. Valor, data, CPF e linha digitável errados por um dígito são piores que resposta nenhuma.

Não dê conselho jurídico nem financeiro. Aponte o que o documento diz, não o que a pessoa deveria fazer.

## Privacidade

O documento pode ter CPF, endereço e conta bancária. Está tudo na máquina do usuário e não sai dela — mas não repita dados sensíveis sem necessidade: se a pergunta foi sobre o valor, responda o valor.
