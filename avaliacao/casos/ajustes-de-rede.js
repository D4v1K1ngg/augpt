'use strict';

/**
 * Ajustes da placa de rede (18/10, item 4). NADA é aplicado de verdade: o
 * executor é um dublê que lê o script gerado e finge a janela de permissão do
 * Windows (UAC). O estado vem do formato real da placa do Davi (Realtek, com o
 * driver em espanhol: "Desactivado"/"Activado").
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const ajustes = require('../../src/rede/ajustes');
const { pedidoDeAjuste, responderAjuste, MARCA_DO_PLANO } = require('../../src/agent/rede-no-chat');

const estado = (economia = 'Activado', dns = { servidores: ['192.168.0.1'], estatico: false }) => ({
  adaptador: { nome: 'Ethernet', indice: 7, descricao: 'Realtek Gaming 2.5GbE Family Controller', wifi: false },
  dns,
  propriedades: [
    { nome: 'Energia Eficiente Ethernet', valor: economia, chave: '*EEE', valorReg: economia === 'Activado' ? '1' : '0', exibe: ['Desactivado', 'Activado'], reg: ['0', '1'] },
    { nome: 'Ethernet Verde', valor: 'Desactivado', chave: 'EnableGreenEthernet', valorReg: '0', exibe: ['Desactivado', 'Activado'], reg: ['0', '1'] },
    { nome: 'Velocidad y dúplex', valor: 'Auto', chave: '*SpeedDuplex', valorReg: '0', exibe: ['Auto'], reg: ['0'] },
  ],
});

/** Dublê do PowerShell elevado: lê o .ps1, guarda os comandos e escreve "ok" no resultado (ou cancela). */
function executorFalso({ cancelar = false } = {}) {
  const comandos = [];
  const executar = async (cmd, args) => {
    const linha = args.join(' ');
    if (/Start-Process powershell -Verb RunAs/.test(linha)) {
      if (cancelar) return { saida: '', erro: 'Start-Process : This command cannot be run due to the error: The operation was canceled by the user.' };
      const script = /-File','"([^"]+)"'/.exec(linha)[1];
      const corpo = fs.readFileSync(script, 'utf8');
      comandos.push(...corpo.split('\n').filter((l) => /^\s{2}(Set-|Clear-)/.test(l)).map((l) => l.trim()));
      fs.writeFileSync(/Out-File -Encoding utf8 '([^']+)'/.exec(corpo)[1], 'ok');
      return { saida: '', erro: '' };
    }
    comandos.push(`${cmd} ${args.join(' ')}`);
    return { saida: '', erro: '' };
  };
  return { executar, comandos };
}

module.exports = [
  {
    nome: 'ajustes: lista fechada pelo pedido ("mude meu DNS para o Cloudflare", "otimize a placa", "limpe o cache de DNS"); o plano compara com o estado (o que já está desligado diz "já está assim"); comandos só com índice e valores válidos do Windows',
    tipo: 'unidade',
    executar() {
      const p1 = ajustes.planejar(['dns_cloudflare'], estado());
      const p2 = ajustes.planejar(['economia_de_energia', 'limpar_dns'], estado('Desactivado'));
      const p3 = ajustes.planejar(['economia_de_energia'], estado('Activado'));
      return [
        ajustes.ajustesPedidos('mude meu DNS para o Cloudflare').join() === 'dns_cloudflare' || 'cloudflare',
        ajustes.ajustesPedidos('otimize minha placa de rede').join() === 'economia_de_energia,limpar_dns' && ajustes.ajustesPedidos('otimize minha placa de rede', { wifi: true }).includes('wifi_5ghz') || 'otimizar',
        ajustes.ajustesPedidos('desative o firewall e mude o MTU') .length === 0 || 'fora da lista fechada',
        p1.passos[0].mudar && p1.passos[0].aplicar === "Set-DnsClientServerAddress -InterfaceIndex 7 -ServerAddresses '1.1.1.1','1.0.0.1'" && p1.passos[0].desfazer === 'Set-DnsClientServerAddress -InterfaceIndex 7 -ResetServerAddresses' || JSON.stringify(p1.passos[0]),
        p2.passos.filter((p) => p.id === 'economia_de_energia').every((p) => !p.mudar) && /já está assim/.test(ajustes.tabelaDoPlano(p2)) || ajustes.tabelaDoPlano(p2),
        p3.passos.length === 2 && p3.passos[0].mudar && p3.passos[0].aplicar === "Set-NetAdapterAdvancedProperty -Name 'Ethernet' -RegistryKeyword '*EEE' -RegistryValue '0'" && p3.passos[0].desfazer.endsWith("-RegistryValue '1'") && p3.passos[0].reinicia || JSON.stringify(p3.passos),
      ];
    },
  },
  {
    nome: 'ajustes: aplicar guarda a volta ANTES, roda tudo numa janela de permissão do Windows e o cache de DNS sem permissão; permissão negada não muda nada; "desfazer" volta na ordem inversa e apaga a volta',
    tipo: 'unidade',
    async executar() {
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-ajustes-teste-'));
      const plano = ajustes.planejar(['dns_cloudflare', 'economia_de_energia', 'limpar_dns'], estado('Activado'));
      const negado = executorFalso({ cancelar: true });
      const r0 = await ajustes.aplicar(plano, { pasta, executar: negado.executar });
      fs.rmSync(path.join(pasta, 'ajustes-de-rede.json'), { force: true });
      const x = executorFalso();
      const r1 = await ajustes.aplicar(plano, { pasta, executar: x.executar });
      const volta = JSON.parse(fs.readFileSync(path.join(pasta, 'ajustes-de-rede.json'), 'utf8'));
      const y = executorFalso();
      const r2 = await ajustes.desfazer({ pasta, executar: y.executar });
      const r3 = await ajustes.desfazer({ pasta, executar: y.executar });
      fs.rmSync(pasta, { recursive: true, force: true });
      return [
        !r0.ok && /permissão de administrador foi negada/.test(r0.motivo) && negado.comandos.length === 0 || JSON.stringify(r0),
        r1.ok && x.comandos[0].startsWith('Set-DnsClientServerAddress -InterfaceIndex 7 -ServerAddresses') && x.comandos[1].startsWith('Set-NetAdapterAdvancedProperty') && x.comandos[2] === 'ipconfig /flushdns' || JSON.stringify(x.comandos),
        volta.passos.length === 2 && volta.passos[0].agora === '192.168.0.1 (automático)' || JSON.stringify(volta),
        r2.ok && y.comandos[0].endsWith("-RegistryValue '1'") && y.comandos[1].endsWith('-ResetServerAddresses') || JSON.stringify(y.comandos),
        !r3.ok && /não há ajustes do AuGPT para desfazer/.test(r3.motivo) || JSON.stringify(r3),
      ];
    },
  },
  {
    nome: 'ajustes no chat: o pedido mostra o plano (Agora | Depois | por quê) e nada muda; "aplicar" só logo depois do plano; "como mudar o DNS?" é pergunta; plano sem mudança diz que já está assim',
    tipo: 'unidade',
    async executar() {
      const aplicados = [];
      const modulo = {
        ...ajustes,
        lerEstado: async () => estado('Activado'),
        aplicar: async (plano) => (aplicados.push(plano.passos.filter((p) => p.mudar).map((p) => p.id)), { ok: true, aplicados: plano.passos.filter((p) => p.mudar).map((p) => p.titulo) }),
      };
      const deps = { emit: () => {} };
      const r1 = await responderAjuste({ pergunta: 'mude meu DNS para o Cloudflare', deps, pasta: os.tmpdir(), modulo });
      const aplicadosNoPlano = aplicados.length;
      const conversa = [{ role: 'user', content: 'mude meu DNS para o Cloudflare' }, { role: 'assistant', content: r1.texto }];
      const pedido = pedidoDeAjuste('aplicar', conversa);
      const r2 = await responderAjuste({ pergunta: 'aplicar', conversa, deps, pasta: os.tmpdir(), modulo, pedido });
      const r3 = await responderAjuste({ pergunta: 'desligue a economia de energia da placa', deps, pasta: os.tmpdir(), modulo: { ...modulo, lerEstado: async () => estado('Desactivado') } });
      return [
        /\| DNS da Cloudflare \| 192\.168\.0\.1 \(automático\) \| \*\*1\.1\.1\.1, 1\.0\.0\.1\*\* \|/.test(r1.texto) && /o ping dos jogos não muda/.test(r1.texto) && /responda \*\*"aplicar"\*\*/.test(r1.texto) && r1.texto.includes(`${MARCA_DO_PLANO} dns_cloudflare`) && aplicadosNoPlano === 0 || r1.texto,
        pedido?.tipo === 'aplicar' && pedido.ids.join() === 'dns_cloudflare' || JSON.stringify(pedido),
        aplicados.length === 1 && aplicados[0].join() === 'dns_cloudflare' && /Pronto — aplicado/.test(r2.texto) && /desfazer ajustes de rede/.test(r2.texto) || r2.texto,
        pedidoDeAjuste('aplicar', []) === null && pedidoDeAjuste('como mudar o DNS no Windows?') === null && pedidoDeAjuste('qual DNS é melhor para jogos?') === null || 'não é pedido de ajuste',
        /Nada a mudar/.test(r3.texto) && !r3.texto.includes(MARCA_DO_PLANO) || r3.texto,
      ];
    },
  },
];
