'use strict';

/**
 * Gabarito objetivo (12/11, pedido do Davi: "melhorar a pesquisa e a resposta"). O juiz dava 10 para quase tudo e
 * escondia o que uma mudança fazia (a pauta da escrita: notas iguais, dicas cobertas de 5 a 9). Aqui cada pergunta
 * tem os PONTOS que uma boa resposta traz — o que as fontes boas desse assunto dizem —, e o código confere quais
 * aparecem na resposta. A cobertura (pontos presentes / total) sai ao lado da nota do juiz, com a média e a pior
 * de várias rodadas (`--rodadas=3`): uma rodada só engana (a mesma pergunta tirou 10 e 2,9).
 *
 * Cada ponto: [nome, regex]. A regex é larga de propósito (sinônimos, com e sem acento): o que se mede é se o
 * assunto foi tratado, não a frase exata. `fora`: o que indica que a resposta fugiu do assunto (conta, não pontua).
 */

const GABARITO = {
  'otimizar-windows-jogos': {
    pontos: [
      ['Modo de Jogo', /modo de jogo|game mode/i],
      ['plano de energia de alto desempenho', /plano de energia|desempenho m[aá]ximo|alto desempenho|ultimate performance/i],
      ['agendamento de GPU por hardware (HAGS)', /agendamento (de )?gpu|agendamento acelerado|hags/i],
      ['integridade de memória / VBS', /\bvbs\b|integridade de mem[oó]ria|isolamento (de )?n[uú]cleo|core isolation/i],
      ['drivers da placa de vídeo', /driver/i],
      ['apps em segundo plano e na inicialização', /segundo plano|inicializa[cç][aã]o|startup/i],
      ['efeitos visuais', /efeitos visuais|anima[cç][oõ]es|transpar[eê]ncia/i],
      ['Xbox Game Bar / capturas', /game bar|xbox|captura(s)? em segundo plano/i],
      ['otimizações para jogos em janela', /jogos em janela|windowed/i],
      ['taxa de atualização do monitor', /taxa de atualiza[cç][aã]o|\d{2,3}\s?hz\b/i],
      ['notificações / Assistente de Foco', /notifica[cç][oõ]es|assistente de foco|n[aã]o perturbe/i],
      ['armazenamento / SSD / limpeza', /\bssd\b|limpeza de disco|sensor de armazenamento|armazenamento/i],
    ],
    fora: /\bping\b|lat[eê]ncia de rede|roteador|bufferbloat/gi,
  },
  'bateria-android': {
    pontos: [
      ['brilho / brilho automático', /brilho/i],
      ['modo escuro em tela OLED/AMOLED', /modo escuro|tema escuro|dark mode/i],
      ['taxa de atualização da tela', /taxa de atualiza[cç][aã]o|\b(60|90|120)\s?hz\b/i],
      ['apps em segundo plano', /segundo plano|background/i],
      ['modo de economia de bateria', /economia de (bateria|energia)|modo de economia|economizador|poupan[cç]a de energia/i],
      ['localização / GPS', /localiza[cç][aã]o|\bgps\b/i],
      ['5G / dados móveis / sinal fraco', /\b5g\b|dados m[oó]veis|sinal (fraco|ruim)|rede m[oó]vel/i],
      ['bateria adaptativa', /bateria adaptativa|adaptive battery|otimiza[cç][aã]o (da|de) bateria/i],
      ['ver o consumo em Configurações > Bateria', /uso (da|de) bateria|consumo (da|de) bateria|configura[cç][oõ]es\s*>\s*bateria/i],
      ['Wi-Fi, Bluetooth e NFC quando não usa', /bluetooth|\bnfc\b/i],
      ['mito de fechar os apps à força', /fechar (todos )?os apps|for[cç]ar (o )?fechamento|mito|fechar aplicativos/i],
      ['calor e carga entre 20% e 80%', /calor|temperatura|\b20\s?%|\b80\s?%|carregamento (otimizado|adaptativo)/i],
    ],
  },
  'carro-usado': {
    pontos: [
      ['multas, IPVA e débitos', /multas?|d[eé]bitos|ipva/i],
      ['consulta no Detran / pela placa', /detran|consulta (pela|da) placa/i],
      ['histórico de sinistro ou leilão', /sinistro|leil[aã]o/i],
      ['recall pendente', /recall/i],
      ['chassi e motor batendo com o documento', /chassi/i],
      ['vistoria / laudo cautelar', /vistoria|cautelar|laudo/i],
      ['mecânico de confiança', /mec[aâ]nico/i],
      ['test drive', /test[- ]?drive|dirigir o carro|andar com o carro/i],
      ['histórico de revisões / manual', /revis[oõ]es|manual do propriet|hist[oó]rico de manuten/i],
      ['quilometragem adulterada', /quilometragem|hod[oô]metro|km rodad/i],
      ['documento e transferência (CRV/CRLV)', /\bcrlv\b|\bcrv\b|transfer[eê]ncia|documenta[cç][aã]o/i],
      ['preço pela Tabela FIPE', /fipe/i],
      ['golpes e sinais de alerta', /golpe|fraude|clonad|desconfi/i],
      ['pintura, lataria e pneus', /pintura|lataria|pneus?/i],
    ],
  },
  'taticas-pubg': {
    pontos: [
      ['onde pousar (drop)', /pous|\bdrop\b|saltar|salto/i],
      ['loot e equipamento', /\bloot\b|equipamento|saquear|itens/i],
      ['zona azul / círculo', /zona|c[ií]rculo|blue ?zone/i],
      ['rotação e posicionamento', /rota[cç][aã]o|posicion|rotacionar/i],
      ['veículos', /ve[ií]culo|carro|moto\b/i],
      ['usar cobertura', /cobertura|abrigo|\bcover\b/i],
      ['som e passos', /\bsom\b|passos|[aá]udio|fone/i],
      ['granadas e fumaça', /granada|fuma[cç]a|smoke|molotov/i],
      ['armas e acessórios', /\barma|rifle|acess[oó]rio|attachment|mira/i],
      ['cuidado com o terceiro time', /terceir|third[- ]?part/i],
      ['comunicação da equipe', /comunica|equipe|squad|time/i],
      ['inclinar / peek (Q e E)', /\bpeek|inclinar|\blean\b|\bq e e\b/i],
    ],
  },
  'midterms-2026': {
    pontos: [
      ['Câmara', /c[aâ]mara/i],
      ['Senado', /senado/i],
      ['democratas', /democrat/i],
      ['republicanos', /republican/i],
      ['diz o resultado (quem ganhou)', /venceu|venceram|conquist|ganhou|ganharam|elegeram|maioria/i],
      ['a data (3 de novembro de 2026)', /3 de novembro|03\/11|november 3/i],
    ],
  },
  'spray-pubg': {
    pontos: [
      ['puxar o mouse para baixo (recuo vertical)', /para baixo|pra baixo|recuo vertical|vertical/i],
      ['recuo horizontal', /horizontal/i],
      ['sensibilidade', /sensibilidade/i],
      ['multiplicador / sensibilidade vertical', /sensibilidade vertical|multiplicador vertical|vertical sensitivity/i],
      ['DPI', /\bdpi\b/i],
      ['acessórios (compensador, grip, coronha)', /compensador|grip|empunhadura|coronha|freio de boca|supressor|quebra-chama/i],
      ['agachado ou deitado', /agachad|deitad|\bprone\b|crouch/i],
      ['rajadas curtas / tiros controlados', /rajada|burst|\btap\b|tiros? (curtos|controlad)|cad[eê]ncia/i],
      ['treinar no Campo de Treinamento', /treino|treinar|training|campo de treinamento/i],
      ['mira e zoom (red dot, holo, 2x+)', /red ?dot|holo|\d+x\b|escopo|luneta/i],
      ['postura: braço, pulso e mousepad', /mousepad|bra[cç]o|pulso/i],
      ['qual arma tem menos recuo', /\b(m416|beryl|akm|scar|aug|ace32|m762|groza|ump)\b/i],
    ],
  },
  'internet-jogos': {
    pontos: [
      ['cabo de rede em vez de Wi-Fi', /cabo|ethernet/i],
      ['Wi-Fi em 5 GHz', /5 ?ghz/i],
      ['posição do roteador', /posi[cç][aã]o do roteador|perto do roteador|posicion/i],
      ['QoS no roteador', /\bqos\b/i],
      ['downloads, streaming e outros aparelhos', /download|streaming|outros (aparelhos|dispositivos)|atualiza[cç][oõ]es em segundo plano/i],
      ['DNS', /\bdns\b/i],
      ['bufferbloat / SQM', /bufferbloat|\bsqm\b/i],
      ['servidor / região do jogo', /servidor|regi[aã]o/i],
      ['firmware e reiniciar o roteador', /firmware|reinici/i],
      ['medir ping, jitter e perda de pacotes', /jitter|perda de pacotes|packet loss/i],
      ['operadora / plano', /operadora|provedor|plano de internet/i],
      ['VPN ou acelerador (ExitLag)', /\bvpn\b|exitlag|acelerador/i],
    ],
  },
  'regedit-jogos': {
    pontos: [
      ['o ganho é pequeno ou nenhum', /pouco|pequen|m[ií]nimo|marginal|mito|placebo|n[aã]o (h[aá]|traz|d[aá]) ganho|quase nada|insignificante/i],
      ['backup / ponto de restauração', /backup|ponto de restaura[cç][aã]o|restaurar/i],
      ['risco de instabilidade', /inst[aá]vel|instabilidade|travar|quebrar|risco/i],
      ['NetworkThrottlingIndex / SystemResponsiveness', /networkthrottling|systemresponsiveness/i],
      ['prioridade (Win32PrioritySeparation, GPU Priority)', /win32priorityseparation|gpu priority|prioridade/i],
      ['algoritmo de Nagle (TcpNoDelay)', /nagle|tcpnodelay|tcpackfrequency/i],
      ['o que o Windows já oferece (Modo de Jogo, HAGS)', /modo de jogo|agendamento (de )?gpu|hags/i],
      ['cuidado com scripts e otimizadores prontos', /script|otimizador|tweak|programas? de otimiza/i],
      ['medir antes e depois', /medir|benchmark|antes e depois|comparar/i],
    ],
  },
  'chipset-amd': {
    pontos: [
      ['baixar do site da AMD (suporte)', /amd\.com|site (oficial )?da amd|suporte da amd|p[aá]gina de (suporte|drivers) da amd/i],
      ['escolher o chipset da placa-mãe (B650, X670…)', /\b[abx]\d{3}e?\b|chipset da placa|modelo da placa-m[aã]e/i],
      ['detecção automática da AMD', /auto-?detect|detec[cç][aã]o autom[aá]tica|ferramenta de detec/i],
      ['ver a versão instalada', /vers[aã]o (atual|instalada)|aplicativos instalados|programas e recursos|gerenciador de dispositivos/i],
      ['site do fabricante da placa-mãe', /fabricante da placa|\b(asus|gigabyte|msi|asrock)\b/i],
      ['BIOS é outra coisa', /\bbios\b/i],
      ['reiniciar depois de instalar', /reinici/i],
      ['ponto de restauração / backup', /ponto de restaura|backup/i],
    ],
  },
  'gddr7-lpddr': {
    pontos: [
      ['GDDR: muita largura de banda', /largura de banda|bandwidth/i],
      ['LPDDR: baixo consumo', /baixo consumo|low power|consome menos|efici[eê]ncia energ/i],
      ['LPDDR é de celular e notebook', /celular|smartphone|notebook|dispositivos m[oó]veis|port[aá]te/i],
      ['velocidade em Gbps', /gbps/i],
      ['barramento (bits)', /barramento|\bbus\b|\d{2,3}\s?bits?/i],
      ['PAM3 da GDDR7', /pam3|pam-3/i],
      ['custo e capacidade', /custo|mais barat|capacidade/i],
      ['latência', /lat[eê]ncia/i],
      ['o efeito em jogos', /jogos?/i],
    ],
  },
  'mitigacoes-jogos': {
    pontos: [
      ['Spectre e Meltdown', /spectre|meltdown/i],
      ['em jogos o ganho é pequeno', /pouco|pequen|m[ií]nimo|marginal|insignificante|\b[1-5]\s?%/i],
      ['risco de segurança', /seguran[cç]a|vulner|ataque|explora/i],
      ['processadores novos sofrem menos', /processadores (mais )?(novos|recentes|modernos)|gera[cç][oõ]es (mais )?(novas|recentes)|corrigid[oa]s? no hardware|no hardware/i],
      ['como desligar (InSpectre, registro)', /inspectre|featuresettingsoverride|mitigations=off|registro/i],
      ['onde há ganho (disco, compilação, VMs)', /disco|\bi\/o\b|compila|virtualiza|servidor/i],
      ['testes e benchmarks', /benchmark|testes?/i],
      ['não é recomendado no dia a dia', /n[aã]o (é )?recomend|n[aã]o vale|s[oó] (vale|compensa)|desaconselh/i],
    ],
  },
  'rtx5080-ou-rtx60': {
    pontos: [
      ['quando a RTX 60 deve sair', /(lan[cç]amento|chegar|sair|lan[cç]ad).{0,80}20(26|27|28)|20(26|27|28).{0,80}(lan[cç]amento|chegar|sair)/i],
      ['são rumores, nada confirmado', /rumor|especula|n[aã]o (foi )?confirmad|sem confirma/i],
      ['preço da RTX 5080 hoje', /R\$\s?\d|pre[cç]o/i],
      ['lançamento novo sai caro e esgota', /esgot|escassez|pre[cç]o de lan[cç]amento|mais car|estoque/i],
      ['o desempenho da 5080 (4K, 1440p)', /\b4k\b|1440p|desempenho/i],
      ['16 GB de VRAM', /16\s?gb|vram/i],
      ['DLSS 4 / geração de quadros', /dlss|frame generation|gera[cç][aã]o de quadros/i],
      ['recomendação conforme o caso', /se (voc[eê]|precisa|quer)|depende|vale a pena/i],
    ],
  },
  'fonte-rtx5080': {
    pontos: [
      ['850 W', /850\s?w/i],
      ['1000 W como folga', /1\.?000\s?w|\b1\s?kw/i],
      ['conector 12V-2x6 / 16 pinos', /12v-?2x6|12vhpwr|16 pinos|16-pin/i],
      ['padrão ATX 3.x', /atx\s?3/i],
      ['80 Plus Gold ou melhor', /80 plus|\bgold\b|platinum/i],
      ['marcas e modelos', /corsair|seasonic|\bmsi\b|cooler master|\bxpg\b|be quiet|asus|thermaltake|super flower|lian li|montech|rise mode|gamemax/i],
      ['consumo da placa (~360 W)', /360\s?w/i],
      ['somar o processador e o resto', /processador|\bcpu\b|consumo total|resto do (sistema|pc)/i],
      ['modular e qualidade (tier list)', /modular|tier/i],
    ],
  },
  'ax73-jogos': {
    pontos: [
      ['Wi-Fi 6', /wi-?fi 6|802\.11ax/i],
      ['AX5400 (velocidade)', /ax5400|5400|4804|4\.804/i],
      ['portas gigabit, sem 2,5G', /gigabit|2[.,]5\s?g/i],
      ['QoS', /\bqos\b/i],
      ['OFDMA / MU-MIMO', /ofdma|mu-?mimo/i],
      ['antenas e alcance', /antena|cobertura|alcance/i],
      ['preço', /R\$|pre[cç]o/i],
      ['pontos fracos', /ponto fraco|limita|desvantagem|contra\b|n[aã]o tem/i],
      ['veredito para jogos', /jogos?/i],
    ],
  },
};

/** Os pontos que a resposta cobre: { feitos, total, faltam, fora }. Sem gabarito: null. */
function cobertura(id, resposta) {
  const g = GABARITO[id];
  if (!g) return null;
  const r = String(resposta || '').replace(/\s?⚠(?!️)/g, '');
  const faltam = g.pontos.filter(([, re]) => !re.test(r)).map(([nome]) => nome);
  return { feitos: g.pontos.length - faltam.length, total: g.pontos.length, faltam, fora: g.fora ? (r.match(g.fora) || []).length : 0 };
}

module.exports = { GABARITO, cobertura };
