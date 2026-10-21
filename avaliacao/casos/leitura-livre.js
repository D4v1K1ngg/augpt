'use strict';

/**
 * Leitura livre do PC (19/10): o modelo escreve o comando, o PowerShell só deixa rodar
 * leitura. Casos do chat do Davi: chipset, ajustes do Realtek, políticas de grupo.
 */

const { lerComComando } = require('../../src/pc/leitura-livre');
const pc = require('../../src/agent/pc-no-chat');

module.exports = [
  {
    nome: 'leitura livre: a trava do PowerShell deixa ler (registro, CIM, gpresult /r, reg query) e recusa o que muda, roda texto, grava, sai da máquina ou lê conteúdo de arquivo',
    tipo: 'unidade',
    async executar() {
      if (process.platform !== 'win32') return [true];
      const pode = ['Get-CimInstance Win32_BIOS | Select-Object SMBIOSBIOSVersion', 'gpresult /r /scope user', String.raw`reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v ProductName`, '$x = Get-Service | ? Status -eq Running; $x.Count'];
      const nao = ['Get-Process notepad | Stop-Process', 'Get-Process | % Kill', '(Get-Process notepad).Kill()', String.raw`Get-Date > C:\x.txt`, String.raw`reg add HKCU\x /v a /d b`, "iex 'Remove-Item x'", "$c='Remove-Item'; & $c x", "[Diagnostics.Process]::Start('calc')", 'Get-WmiObject Win32_BIOS -ComputerName outro', 'ipconfig /release', String.raw`Get-Content C:\senhas.txt`, '${C:\\senhas.txt}', 'Get-Clipboard', String.raw`Get-Item HKCU:\Software | % { $_.DeleteSubKey('x') }`];
      const r = await Promise.all([...pode, ...nao].map((s) => lerComComando(s)));
      return [...pode.map((s, i) => (r[i].ok && r[i].saida.trim() !== '') || `${s} → ${r[i].motivo}`), ...nao.map((s, i) => (!r[pode.length + i].ok && r[pode.length + i].recusado) || `${s} passou`)];
    },
  },
  {
    nome: 'leitura livre: chipset, driver do processador, ajustes do adaptador, políticas e regedit vão para a leitura livre; o que as consultas fixas cobrem, a rede e o conselho não',
    tipo: 'unidade',
    executar() {
      const sim = ['qual o meu driver do chipset da amd atual ?', 'e o chipset do meu ryzen, ele esta atualizado ?', 'e quanto ao driver do meu processador ? ele esta atualizado ?', 'quais são as minhas configurações atuais do meu adaptador de rede ?', 'Eu quero saber quais os ajustes do meu adaptador de rede da realtek', 'veja as politicas de grupo do meu windows', 'analise o meu regedit do windows'];
      const nao = ['minha placa de video esta atualizada ?', 'quanto espaço livre meu pc tem?', 'qual a configuração do meu pc?', 'como atualizar o chipset do processador ?', 'minha internet está lenta?', 'qual a versão do windows 12?'];
      return [...sim.map((t) => pc.pedidoDeLeituraLivre(t) || t), ...nao.map((t) => !pc.pedidoDeLeituraLivre(t) || t), (pc.pedidoDeConsultaPC('minha placa de video esta atualizada ?')?.ids || []).join() === 'video' || 'vídeo continua fixo'];
    },
  },
  {
    nome: 'leitura livre: o registro de programas ganha os 3 ramos; coluna pedida que veio vazia é detectada; versão citada sem origem vira aviso',
    tipo: 'unidade',
    executar() {
      const c = pc.completarComando(String.raw`Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object DisplayName -like '*AMD*'`);
      return [
        /WOW6432Node/.test(c) && /HKCU:/.test(c) || c,
        pc.colunasVazias('FriendlyName : AMD PCI\nDriverVersion : \n\nFriendlyName : AMD PSP\nDriverVersion : ', 'Get-PnpDevice | Select-Object FriendlyName, DriverVersion | Format-List').join() === 'DriverVersion' || 'lista',
        pc.colunasVazias('Name     DriverVersion\n----     -------------\nEthernet 1125.21.903.2024', 'Get-NetAdapter | Select-Object Name, DriverVersion').length === 0 || 'tabela cheia',
        pc.versoesSemOrigem('instalada 8.05.04.516; a mais nova 8.08.12.551', [{ saida: 'AMD Chipset Software 8.08.12.551' }], []).join() === '8.05.04.516' || 'aviso',
      ];
    },
  },
  {
    nome: 'leitura livre no chat: filtro que não trouxe nada recebe o exemplo real ("Advanced Micro Devices") e o modelo corrige; mostra o comando e a saída; pesquisa a versão mais nova; "você não tem" nunca; pedido que não é do PC volta para a pesquisa',
    tipo: 'unidade',
    async executar() {
      const pedidos = [];
      const rodados = [];
      const respostas = [
        '{"do_pc":true,"o_que":"versão do driver do chipset AMD","busca":"powershell amd chipset version","versao_mais_nova":true,"produto":"AMD Chipset Software"}',
        `{"comandos":[{"para":"drivers AMD","script":"Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.Manufacturer -like '*AMD*' } | Select-Object DeviceName, DriverVersion"}]}`,
        `{"comandos":[{"para":"drivers AMD","script":"Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.Manufacturer -like '*Advanced Micro*' } | Select-Object DeviceName, DriverVersion"}]}`,
      ];
      const ler = async (script) => {
        rodados.push(script);
        if (/Out-String\) -like '\*AMD\*'/.test(script)) return { ok: true, saida: 'DeviceName : AMD PCI\nManufacturer : Advanced Micro Devices, Inc.\nDriverVersion : 1.0.0.90' };
        if (/'\*AMD\*'/.test(script)) return { ok: true, saida: '' };
        return { ok: true, saida: 'DeviceName  DriverVersion\n----------  -------------\nAMD PCI     1.0.0.90' };
      };
      const deps = {
        chamar: async (m) => (pedidos.push(m[0].content), { content: respostas.shift() }),
        escrever: async (m, onToken) => (pedidos.push(m[0].content), onToken('O driver AMD PCI está na versão 1.0.0.90; a mais nova é a 1.0.0.95 [1].'), 'O driver AMD PCI está na versão 1.0.0.90; a mais nova é a 1.0.0.95 [1].'),
        buscar: async (q) => (/latest version/.test(q) ? [{ titulo: 'AMD Chipset Drivers', url: 'https://www.amd.com/x', resumo: 'AMD PCI Driver 1.0.0.95' }] : [{ titulo: 'como ver', url: 'https://x', resumo: 'Get-CimInstance Win32_PnPSignedDriver' }]),
        emit: () => {},
      };
      const r = await pc.responderLeituraLivre({ pergunta: 'meu chipset está atualizado?', deps, ler });
      const naoEDoPC = await pc.responderLeituraLivre({ pergunta: 'qual a versão do meu iphone?', deps: { ...deps, chamar: async () => ({ content: '{"do_pc":false}' }) }, ler });
      return [
        rodados.some((s) => /Out-String\) -like '\*AMD\*'/.test(s)) && /Advanced Micro Devices/.test(pedidos[2]) || 'o exemplo real vai para a correção',
        /\*\*O que eu li no seu PC\*\*/.test(r.texto) && /```powershell\n.*Advanced Micro/.test(r.texto) && /1\.0\.0\.90/.test(r.texto) || r.texto.slice(0, 300),
        r.fontes.length === 1 && /AMD PCI Driver 1\.0\.0\.95/.test(pedidos[3]) && /NUNCA "você não tem"/.test(pedidos[3]) || 'versão mais nova e regra',
        /Só li: nada foi mudado/.test(r.texto) && !/⚠/.test(r.texto) || 'rodapé, sem aviso (os números têm origem)',
        naoEDoPC === null || 'não é do PC',
      ];
    },
  },
];
