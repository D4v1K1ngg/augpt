'use strict';

/**
 * Consultas ao PC, só leitura (19/10). O Windows é um dublê com os dados lidos
 * no PC do Davi (Ryzen 7 7800X3D, RTX 3060 Ti, mouse ATK 8K, teclado Drunkdeer
 * A75, Sound BlasterX G6, unidade E: quase cheia, 1 atualização pendente).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const inspetor = require('../../src/pc/inspetor');
const { responderConsultaPC } = require('../../src/agent/pc-no-chat');
const capacidades = require('../../src/agent/capacidades');

const LIDO = {
  sistema: { cpu: 'AMD Ryzen 7 7800X3D 8-Core Processor', nucleos: 8, threads: 16, ramGB: 31.7, ramLivreGB: 19, pentes: [{ gb: 16, mhz: 6000 }, { gb: 16, mhz: 6000 }], placaMae: 'ASUSTeK COMPUTER INC. TUF GAMING B650M-PLUS', bios: '3222', biosData: '2025-03-04', windows: 'Microsoft Windows 11 Pro', ligadoDesde: new Date(Date.now() - 20 * 864e5).toISOString() },
  unidades: [{ letra: 'C:', totalGB: 475.6, livreGB: 94.2 }, { letra: 'E:', nome: 'Novo volume', totalGB: 48.8, livreGB: 2.2 }],
  discos: { modelo: 'Netac NVMe SSD 512GB', tipo: 'SSD', barramento: 'NVMe', tamanhoGB: 477, saude: 'Healthy' }, // 1 item vem solto do PowerShell
  windows: { nome: 'Microsoft Windows 11 Pro', versao: '25H2', build: '26200.6584', ultimas: { id: 'KB5127647', tipo: 'Security Update', em: '2026-10-14' } },
  video: [{ nome: 'NVIDIA GeForce RTX 3060 Ti', driver: '32.0.15.6094', data: '2026-01-10', resolucao: '1728x1080', hz: 144 }],
  perifericos: [{ tipo: 'Mouse', vid: '373B', nome: 'ATK Mouse 8K Dongle', fabricante: '(Standard USB Host Controller)' }, { tipo: 'Keyboard', vid: '352D', nome: 'Drunkdeer A75 ANSI', fabricante: null }],
  monitores: [{ fabricante: 'BNQ', modelo: 'ZOWIE XL LCD' }],
  audio: [{ nome: 'Sound BlasterX G6', fabricante: 'Creative Technology Ltd.' }, { nome: 'NVIDIA High Definition Audio', fabricante: 'NVIDIA' }, { nome: 'Dispositivo de High Definition Audio', fabricante: 'Microsoft' }],
  programas: [{ nome: 'Discord', versao: '1.0.9262' }, { nome: 'Steam', versao: '2.10' }],
};

const executarFalso = (comandos) => async (cmd, args) => {
  comandos.push(args.join(' '));
  if (/Microsoft\.Update\.Session/.test(args.join(' '))) return JSON.stringify({ titulo: '2026-10 Atualização de Segurança (KB5127648)', driver: false });
  return JSON.stringify(LIDO);
};

module.exports = [
  {
    nome: 'consultar PC: a pergunta escolhe as consultas ("espaço livre" → discos, "marca do mouse" → periféricos, "está atualizado?" → windows, "tenho o Discord instalado?" → programas, não discos); opinião e conselho ficam com a pesquisa',
    tipo: 'unidade',
    executar() {
      const c = (t) => inspetor.consultasDoPedido(t).join();
      return [
        c('veja quanto espaço livre meu pc tem') === 'discos' || c('veja quanto espaço livre meu pc tem'),
        c('qual a configuração do meu pc?') === 'sistema,discos,video' || c('qual a configuração do meu pc?'),
        c('meu windows está atualizado?') === 'windows' || 'windows',
        c('minha placa de video esta atualizada?') === 'video' || 'vídeo',
        c('qual a marca do meu mouse e teclado?') === 'perifericos' || 'periféricos',
        c('eu tenho placa de som?') === 'audio' || 'áudio',
        c('quantas fotos o meu pc tem? onde elas estão?') === 'arquivos' || 'arquivos',
        c('tenho o discord instalado?') === 'programas' || c('tenho o discord instalado?'),
        c('qual a melhor placa de video?') === '' && c('meu mouse é bom para pubg?') === '' && c('como liberar espaço no meu pc?') === '' || 'opinião/conselho',
      ];
    },
  },
  {
    nome: 'consultar PC: as tabelas saem dos dados lidos (lista de 1 item solta do PowerShell, driver NVIDIA 32.0.15.6094 = 560.94, fabricante genérico escondido, BenQ pela sigla, placa de som dedicada); avisos de unidade quase cheia, PC ligado há semanas, atualização pendente e driver velho (com a oferta de pesquisar)',
    tipo: 'unidade',
    async executar() {
      const comandos = [];
      const ids = ['sistema', 'discos', 'windows', 'video', 'perifericos', 'audio'];
      const r = await inspetor.consultar(ids, { texto: 'meu windows está atualizado?', deps: { executar: executarFalso(comandos), detectarGpus: async () => [{ nome: 'NVIDIA GeForce RTX 3060 Ti', vramGB: 8 }] } });
      const { blocos, avisos, ofertas } = inspetor.blocosDaResposta(ids, r);
      const t = blocos.join('\n');
      return [
        comandos.length === 2 && comandos.every((c) => !/Set-|Remove-|Install-|New-Item|Stop-|Restart-/.test(c)) || 'só leitura',
        /Discos físicos: 1/.test(t) && /Netac NVMe SSD 512GB \| SSD NVMe \| 477 GB \| boa/.test(t) || t.slice(0, 600),
        /560\.94 \(32\.0\.15\.6094\)/.test(t) && /\| 8 GB \|/.test(t) || 'driver NVIDIA',
        /\| Mouse \| ATK Mouse 8K Dongle \|/.test(t) && !/Standard USB Host/.test(t) && /BenQ ZOWIE XL LCD/.test(t) || 'periféricos',
        /tem placa de som dedicada: \*\*Sound BlasterX G6\*\*/.test(t) || 'placa de som',
        /Atualizações pendentes \| \*\*1\*\*: 2026-10 Atualização de Segurança/.test(t) || 'pendentes',
        avisos.some((a) => /E: está com menos de 10% livre/.test(a)) && avisos.some((a) => /ligado há 20 dias/.test(a)) && avisos.some((a) => /1 atualização/.test(a)) && avisos.some((a) => /driver da NVIDIA GeForce RTX 3060 Ti é de 10\/01\/2026/.test(a)) || JSON.stringify(avisos),
        /versão mais nova do driver da NVIDIA GeForce RTX 3060 Ti \(a instalada é a 560\.94/.test(ofertas[0] || '') || JSON.stringify(ofertas),
      ];
    },
  },
  {
    nome: 'consultar PC: arquivos são contados sem abrir (fotos, vídeos, músicas, documentos), agrupados por pasta, sem programa, cache nem AppData; sem contar duas vezes; para no limite de tempo',
    tipo: 'unidade',
    executar() {
      const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'augpt-arquivos-'));
      const criar = (rel, bytes = 10) => {
        fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
        fs.writeFileSync(path.join(raiz, rel), Buffer.alloc(bytes));
      };
      ['Pictures/Screenshots/a.png', 'Pictures/Screenshots/b.png', 'Pictures/Ferias/2025/c.JPG', 'Videos/d.mp4', 'Music/e.mp3', 'Documents/f.pdf', 'AppData/Local/x.png', 'Pictures/node_modules/y.png', 'Desktop/notas.txt', 'Desktop/z.exe'].forEach((f) => criar(f));
      const r = inspetor.contarArquivos({ raizes: [path.join(raiz, 'Pictures'), path.join(raiz, 'Videos'), path.join(raiz, 'Music'), path.join(raiz, 'Documents'), path.join(raiz, 'Desktop'), path.join(raiz, 'Pictures')] });
      const parado = inspetor.contarArquivos({ raizes: [raiz], limiteMs: -1 });
      fs.rmSync(raiz, { recursive: true, force: true });
      return [
        r.fotos.n === 3 && r.videos.n === 1 && r.musicas.n === 1 && r.documentos.n === 2 || JSON.stringify({ f: r.fotos.n, v: r.videos.n, m: r.musicas.n, d: r.documentos.n }),
        r.fotos.pastas[0].n === 2 && /Screenshots$/.test(r.fotos.pastas[0].dir) && /Ferias$/.test(r.fotos.pastas[1].dir) || JSON.stringify(r.fotos.pastas),
        parado.parcial === true || 'limite de tempo',
      ];
    },
  },
  {
    nome: 'consultar PC no chat: tabelas + o que chamou atenção + explicação do modelo com os dados + "só consultei"; "tenho o Discord instalado?" responde direto; está no catálogo e a trava de promessa aceita "posso consultar o seu computador"',
    tipo: 'unidade',
    async executar() {
      const escritas = [];
      const modulo = { ...inspetor, consultar: async (ids, o) => inspetor.consultar(ids, { ...o, deps: { executar: executarFalso([]), detectarGpus: async () => [] } }) };
      const deps = { escrever: async (m, onToken) => (escritas.push(m), onToken('Você tem pouco espaço na E:.'), 'Você tem pouco espaço na E:.'), emit: () => {} };
      const r = await responderConsultaPC({ pergunta: 'veja quanto espaço livre meu pc tem', deps, modulo });
      const r2 = await responderConsultaPC({ pergunta: 'tenho o discord instalado?', deps, modulo });
      return [
        /Espaço nas unidades/.test(r.texto) && /O que chamou atenção/.test(r.texto) && /Você tem pouco espaço na E:\./.test(r.texto) && /Só consultei: nada foi mudado/.test(r.texto) || r.texto.slice(0, 400),
        /só leitura: não mudou nada/.test(escritas[0][0].content) && /E: está com menos de 10% livre/.test(escritas[0][0].content) || 'a explicação recebe os dados',
        /\*\*Instalado:\*\* Discord 1\.0\.9262/.test(r2.texto) || r2.texto.slice(0, 300),
        capacidades.EXECUTAVEIS.includes('consultar_pc') || 'catálogo',
        capacidades.conferirPromessas('Posso consultar o seu computador para ver o espaço livre.').tiradas.length === 0 || 'promessa válida',
      ];
    },
  },
];
