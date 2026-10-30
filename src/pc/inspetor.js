'use strict';

/**
 * Inspetor do PC (19/10, pedido do Davi: "dar ao AuGPT acesso ao meu
 * computador só para ver os dados e consultar, sem alterar nada").
 *
 * Regras:
 * - SÓ LEITURA: um conjunto fixo de consultas do Windows (Get-CimInstance,
 *   Get-PnpDevice, registro…), todas de leitura e sem administrador. O modelo
 *   nunca escreve comando: ele (ou as palavras do pedido) escolhe QUAIS
 *   consultas rodam; o código roda as consultas prontas daqui.
 * - os arquivos são CONTADOS (fotos, vídeos, músicas), nunca abertos; a
 *   resposta diz quantos e em que pastas, não o nome de cada um.
 * - nada sai do computador.
 *
 * Mouse e teclado: o Windows chama tudo de "Mouse compatível com HID"; o nome
 * de verdade é o que o aparelho relata ao conectar (DEVPKEY_Device_BusReportedDeviceDesc):
 * no PC do Davi, "ATK Mouse 8K Dongle" e "Drunkdeer A75 ANSI".
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function rodar(comando, args, { timeout = 60000 } = {}) {
  return new Promise((ok) => {
    execFile(comando, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, saida) => ok(String(saida || '')));
  });
}

/* ------------------------------ as consultas (PowerShell, só leitura) ------------------------------ */

const PS = {
  sistema: `
$os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; $mb = Get-CimInstance Win32_BaseBoard; $bios = Get-CimInstance Win32_BIOS
$r.sistema = [pscustomobject]@{
  fabricante = $cs.Manufacturer; modelo = $cs.Model; cpu = ($cpu.Name -replace '\\s+', ' ').Trim(); nucleos = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors
  ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1); ramLivreGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  pentes = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ gb = [math]::Round($_.Capacity / 1GB); mhz = $_.ConfiguredClockSpeed; fabricante = ($_.Manufacturer -replace '\\s+$', ''); modelo = ($_.PartNumber -replace '\\s+$', '') } })
  placaMae = "$($mb.Manufacturer) $($mb.Product)".Trim(); bios = "$($bios.SMBIOSBIOSVersion)"; biosData = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null }
  windows = "$($os.Caption)"; ligadoDesde = $os.LastBootUpTime.ToString('s')
}`,
  discos: `
$r.unidades = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ letra = $_.DeviceID; nome = $_.VolumeName; totalGB = [math]::Round($_.Size / 1GB, 1); livreGB = [math]::Round($_.FreeSpace / 1GB, 1) } })
$r.discos = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ modelo = $_.FriendlyName; tipo = [string]$_.MediaType; barramento = [string]$_.BusType; tamanhoGB = [math]::Round($_.Size / 1GB); saude = [string]$_.HealthStatus } })`,
  windows: `
$os = Get-CimInstance Win32_OperatingSystem; $cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$r.windows = [pscustomobject]@{ nome = $os.Caption; versao = $cv.DisplayVersion; build = "$($cv.CurrentBuild).$($cv.UBR)"
  ultimas = @(Get-HotFix -ErrorAction SilentlyContinue | Where-Object InstalledOn | Sort-Object InstalledOn -Descending | Select-Object -First 5 | ForEach-Object { [pscustomobject]@{ id = $_.HotFixID; tipo = $_.Description; em = $_.InstalledOn.ToString('yyyy-MM-dd') } }) }`,
  video: `
$r.video = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Virtual|Remote|Basic Display|Parsec|Meta' } | ForEach-Object { [pscustomobject]@{ nome = $_.Name; driver = $_.DriverVersion; data = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null }; resolucao = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)"; hz = $_.CurrentRefreshRate } })`,
  perifericos: `
$todos = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'OK' })
$vids = @{}
foreach ($d in $todos | Where-Object { $_.Class -in 'Mouse','Keyboard' }) { if ($d.InstanceId -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') { $vids["$($matches[1])&$($matches[2])"] = $d.Class } }
$r.perifericos = @(foreach ($k in $vids.Keys) {
  $usb = $todos | Where-Object { $_.InstanceId -match "^USB\\\\VID_$($k -replace '&','&PID_')" } | Select-Object -First 1
  $nome = if ($usb) { (Get-PnpDeviceProperty -InstanceId $usb.InstanceId -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc' -ErrorAction SilentlyContinue).Data } else { $null }
  $fab = if ($usb) { (Get-PnpDeviceProperty -InstanceId $usb.InstanceId -KeyName 'DEVPKEY_Device_Manufacturer' -ErrorAction SilentlyContinue).Data } else { $null }
  [pscustomobject]@{ tipo = $vids[$k]; vid = ($k -split '&')[0]; nome = $nome; fabricante = $fab; bluetooth = [bool]($todos | Where-Object { $_.InstanceId -match "BTH" -and $_.InstanceId -match $k }) }
})
$r.bluetooth = @($todos | Where-Object { $_.Class -eq 'Bluetooth' -and $_.FriendlyName -notmatch 'Adapter|Adaptador|Enumerator|Enumerador|Radio|Rádio|Protocol|Protocolo|RFCOMM|Service|Serviço|LE Generic|Generic Attribute|Device Information' } | ForEach-Object { $_.FriendlyName } | Select-Object -Unique)
$r.monitores = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ fabricante = (($_.ManufacturerName | Where-Object { $_ }) | ForEach-Object { [char]$_ }) -join ''; modelo = (($_.UserFriendlyName | Where-Object { $_ }) | ForEach-Object { [char]$_ }) -join '' } })
$r.cameras = @($todos | Where-Object { $_.Class -in 'Camera','Image' } | ForEach-Object { $_.FriendlyName })`,
  audio: `
$r.audio = @(Get-CimInstance Win32_SoundDevice | ForEach-Object { [pscustomobject]@{ nome = $_.Name; fabricante = $_.Manufacturer } })`,
  programas: `
$chaves = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$r.programas = @(Get-ItemProperty $chaves -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | ForEach-Object { [pscustomobject]@{ nome = $_.DisplayName; versao = $_.DisplayVersion; editora = $_.Publisher; em = $_.InstallDate } } | Sort-Object nome -Unique)`,
  inicializacao: `
$r.inicializacao = @(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ nome = $_.Name; onde = $_.Location } })`,
  bateria: `
$r.bateria = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ nome = $_.Name; carga = $_.EstimatedChargeRemaining; status = $_.BatteryStatus } })`,
};

// atualizações pendentes do Windows: pela própria fila do Windows Update (só pesquisa, não instala); demora
const PENDENTES = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { $s = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher(); $res = $s.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
  @($res.Updates | ForEach-Object { [pscustomobject]@{ titulo = $_.Title; driver = [bool]($_.Categories | Where-Object { $_.Name -match 'Driver' }) } }) | ConvertTo-Json -Compress } catch { 'erro' }`;

const lista = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

/* ------------------------------ arquivos (contados no Node, sem abrir) ------------------------------ */

const TIPOS = {
  fotos: /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|raw|cr2|nef|arw|dng)$/i,
  videos: /\.(mp4|mkv|mov|avi|wmv|webm|m4v|mts|m2ts|3gp|flv)$/i,
  musicas: /\.(mp3|flac|wav|m4a|aac|ogg|wma|opus)$/i,
  documentos: /\.(pdf|docx?|xlsx?|pptx?|odt|ods|txt|rtf|csv)$/i,
};
// pastas que não são do usuário (programas, sistema, caches): fora da contagem
const PULAR = /^(windows|program files( \(x86\))?|programdata|\$recycle\.bin|system volume information|appdata|node_modules|\.git|\.cache|cache|caches|temp|tmp|steamapps|xboxgames|msocache|recovery|\$windows\.~bt|\$winreagent|perflogs|onedrivetemp)$/i;

/**
 * Conta fotos, vídeos, músicas e documentos. Pastas do usuário sempre; o disco
 * todo (as outras unidades) com `discoTodo`. Para em `limiteMs` (fica "parcial").
 */
function contarArquivos({ raizes, limiteMs = 25000, maxEntradas = 400000 } = {}) {
  const inicio = Date.now();
  const total = Object.fromEntries(Object.keys(TIPOS).map((k) => [k, { n: 0, bytes: 0, pastas: new Map() }]));
  let vistos = 0;
  let parcial = false;
  const pilha = raizes.filter((r) => fs.existsSync(r)).map((r) => ({ dir: r, raiz: r }));
  const vistas = new Set();
  while (pilha.length) {
    if (Date.now() - inicio > limiteMs || vistos > maxEntradas) {
      parcial = true;
      break;
    }
    const { dir, raiz } = pilha.pop();
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (vistas.has(real)) continue; // OneDrive dentro de Imagens e afins não contam duas vezes
    vistas.add(real);
    let itens;
    try {
      itens = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of itens) {
      vistos += 1;
      if (it.isDirectory()) {
        if (!PULAR.test(it.name) && !it.name.startsWith('.')) pilha.push({ dir: path.join(dir, it.name), raiz });
        continue;
      }
      if (!it.isFile()) continue;
      for (const [tipo, re] of Object.entries(TIPOS)) {
        if (!re.test(it.name)) continue;
        const t = total[tipo];
        t.n += 1;
        try {
          t.bytes += fs.statSync(path.join(dir, it.name)).size;
        } catch {
          /* sem tamanho */
        }
        // agrupa pelas 2 primeiras pastas a partir da raiz (~\Pictures\Screenshots, não o caminho inteiro)
        const rel = path.relative(raiz, dir).split(path.sep).filter(Boolean).slice(0, 1);
        const grupo = path.join(raiz, ...rel);
        t.pastas.set(grupo, (t.pastas.get(grupo) || 0) + 1);
        break;
      }
    }
  }
  const resultado = {};
  for (const [tipo, t] of Object.entries(total)) {
    resultado[tipo] = { n: t.n, gb: Math.round((t.bytes / 1e9) * 10) / 10, pastas: [...t.pastas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([dir, n]) => ({ dir, n })) };
  }
  return { ...resultado, parcial, segundos: Math.round((Date.now() - inicio) / 100) / 10 };
}

/* ------------------------------ o que perguntaram ------------------------------ */

const norm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const QUAIS = [
  ['discos', /espaco|\bdiscos?\b|\bhd\b|\bssd\b|\bnvme\b|armazenamento|particao|particoes|unidade [a-z]:?|\b[cd]:/],
  ['sistema', /configurac|especificac|hardware|processador|\bcpu\b|memoria( ram)?|\bram\b|placa[- ]mae|bios|pecas|\bqual (e )?o meu (pc|computador|notebook)\b|ligado (ha|desde)/],
  ['windows', /windows.{0,30}(atualizad|versao|build|update|atualizac)|atualizac\w* do windows|versao do windows|windows update/],
  // (19/10: o "\bdriver\b" sozinho puxava a placa de vídeo para "driver do chipset" e "driver do processador")
  ['video', /placa de video|\bgpu\b|driver (da|de|do) (placa|video|nvidia|radeon|geforce)|\bnvidia\b|geforce|radeon/],
  ['perifericos', /mouse|teclado|headset|perifer|monitor|webcam|camera|bluetooth|controle|joystick|\busb\b/],
  ['audio', /placa de som|\baudio\b|\bsom\b|alto-?falante|caixa de som|microfone|dac\b|interface de audio/],
  ['arquivos', /\bfotos?\b|\bimagens\b|\bvideos\b|\bmusicas?\b|\bdocumentos\b|\barquivos\b|onde (estao|ficam)/],
  ['programas', /programas?|aplicativos?|softwares?|instalad[oa]s?\b/],
  ['inicializacao', /inicializac|iniciam? (junto )?com o windows|abrem? sozinhos?|startup/],
  ['bateria', /bateria/],
];
const DO_USUARIO = /\b(meu|minha|meus|minhas|tenho|tem no|neste|nesse|desse|deste|aqui|no (meu )?(pc|computador|notebook))\b/;
// ("meu windows está atualizado?": pergunta de sim ou não também é consulta)
const ACAO = /^\s*(veja|ve|mostre|mostra|liste|lista|verifique|verifica|confira|confere|consulte|descubra|me (diga|fala|mostra))\b|\b(quanto|quantos|quantas|qual|quais|onde|tenho|tem|esta|estao)\b/;
// avaliação e conselho ficam com a pesquisa ("meu mouse é bom para PUBG?" pede opinião, não leitura)
const OPINIAO = /\b(e bom|e boa|vale a pena|melhor|recomend\w*|compar\w*|devo|deveria|como (melhorar|aumentar|liberar|limpar|resolver|atualizar))\b/;

const ESPECIFICO = /adaptador|placa de rede|realtek|chipset|politica|gpedit|registro|regedit|servico|tarefas? agendada|firewall|defender|antivirus|bitlocker|\btpm\b|secure boot|uefi|plano de energia|\beventos?\b|tela azul|bsod|variave(l|is) de ambiente|certificado|\bdrivers?\b(?! (da|de|do) (placa|video))/;

/** As consultas que a pergunta pede (vazio = não é pergunta sobre este PC). */
// pergunta sobre o próprio PC é curta (30/10, registros do Davi: uma prova da OAB colada — 5.490 letras — tinha
// "nesse", "está" e "espaço" espalhados e foi respondida 3 vezes com o espaço dos discos)
const PEDIDO_CURTO = 400;

function consultasDoPedido(texto) {
  const t = norm(texto);
  if (t.length > PEDIDO_CURTO || !DO_USUARIO.test(t) || !ACAO.test(t) || OPINIAO.test(t)) return [];
  let ids = QUAIS.filter(([, re]) => re.test(t)).map(([id]) => id);
  // assunto específico (19/10: "driver do meu processador", "configurações do meu adaptador de rede"):
  // a ficha geral não responde — sem ela, a pergunta vai para a leitura livre
  if (ESPECIFICO.test(t)) ids = ids.filter((id) => id !== 'sistema');
  // "qual a configuração do meu pc?" pede a ficha completa
  if (ids.includes('sistema') && /configurac|especificac|ficha|pecas|hardware/.test(t)) ids.push('discos', 'video');
  return [...new Set(ids)];
}

// leitura livre (19/10): o resto do que é do PC — chipset, drivers, registro, políticas, serviços, adaptador…
const SOBRE_O_PC = /\b(pc|computador|notebook|windows|drivers?|chipset|registro|regedit|politicas?|gpedit|servicos?|processos?|tarefas? agendadas?|firewall|defender|antivirus|bitlocker|tpm|secure boot|uefi|bios|plano de energia|eventos?|tela azul|bsod|adaptador|placa de rede|realtek|intel|amd|ryzen|dispositivos?|usb|bluetooth|variave(l|is) de ambiente|certificados?|conta|usuarios?|versao|instalad[oa]s?|atualizad[oa]s?|configurac\w*|ajustes?|propriedades)\b/;
const LER = /\b(analis\w*|examin\w*|leia|ler|veja|ve|verifi\w*|confir\w*|confer\w*|mostr\w*|list\w*|consult\w*|descobr\w*)\b/;

/** A pergunta é sobre este PC, mas nenhuma consulta fixa responde? (o chat decide se a rede vem antes) */
function pedidoDeLeituraLivre(texto) {
  const t = norm(texto);
  if (t.length > PEDIDO_CURTO || !DO_USUARIO.test(t) || OPINIAO.test(t) || !(ACAO.test(t) || LER.test(t))) return false;
  return SOBRE_O_PC.test(t) && !consultasDoPedido(texto).length;
}

/* ------------------------------ rodar ------------------------------ */

/**
 * Roda as consultas pedidas. deps: { executar, contar, home, verificador } (a bancada passa dublês).
 */
async function consultar(ids, { deps = {}, texto = '', aoProgresso = () => {} } = {}) {
  if (process.platform !== 'win32' && !deps.executar) throw new Error('a consulta ao PC, por enquanto, é só para Windows');
  const executar = deps.executar || rodar;
  const doPS = ids.filter((id) => PS[id]);
  const r = {};
  const tarefas = [];
  if (doPS.length) {
    aoProgresso(`lendo ${doPS.join(', ')}`);
    const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ErrorActionPreference = 'SilentlyContinue'\n$r = @{}\n${doPS.map((id) => `try {${PS[id]}\n} catch {}`).join('\n')}\n$r | ConvertTo-Json -Depth 5 -Compress`;
    tarefas.push(
      executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 60000 }).then((saida) => {
        try {
          Object.assign(r, JSON.parse(saida));
        } catch {
          r.erro = 'o Windows não respondeu às consultas';
        }
      })
    );
  }
  // atualizações pendentes só quando perguntam se o Windows está atualizado
  if (ids.includes('windows') && /atualiz|update|pendente/.test(norm(texto))) {
    aoProgresso('procurando atualizações pendentes no Windows Update (só pesquisa)');
    tarefas.push(
      executar('powershell', ['-NoProfile', '-NonInteractive', '-Command', PENDENTES], { timeout: 90000 }).then((saida) => {
        try {
          r.pendentes = saida.trim() === 'erro' || !saida.trim() ? null : lista(JSON.parse(saida));
        } catch {
          r.pendentes = null;
        }
      })
    );
  }
  if (ids.includes('video')) {
    // a memória de vídeo do Windows para em 4 GB (campo de 32 bits): vem do verificador do app
    const detectar = deps.detectarGpus || require('../verificador-de-hardware').detectarGpus;
    tarefas.push(detectar().then((g) => (r.gpus = g)).catch(() => {}));
  }
  if (ids.includes('arquivos')) {
    aoProgresso('contando fotos, vídeos e músicas (sem abrir nenhum arquivo)');
    const home = deps.home || os.homedir();
    const discoTodo = /\b(pc|computador|notebook) (todo|inteiro)|todos os discos|todas as unidades|disco todo|no pc todo/.test(norm(texto));
    const raizes = ['Pictures', 'Imagens', 'Videos', 'Vídeos', 'Music', 'Músicas', 'Desktop', 'Área de Trabalho', 'Downloads', 'Documents', 'Documentos', 'OneDrive'].map((p) => path.join(home, p));
    tarefas.push(
      (async () => {
        let outras = [];
        if (discoTodo) {
          // as outras unidades fixas (D:, E:…), sem as pastas de sistema
          outras = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => fs.existsSync(d));
        }
        const contar = deps.contar || contarArquivos;
        r.arquivos = { ...contar({ raizes: [...raizes, ...outras], limiteMs: discoTodo ? 60000 : 25000 }), discoTodo };
      })()
    );
  }
  await Promise.all(tarefas);
  for (const k of ['unidades', 'discos', 'perifericos', 'bluetooth', 'monitores', 'cameras', 'audio', 'programas', 'inicializacao', 'bateria', 'video']) if (k in r) r[k] = lista(r[k]);
  if (r.windows) r.windows.ultimas = lista(r.windows.ultimas);
  if (r.sistema) r.sistema.pentes = lista(r.sistema.pentes);
  return r;
}

/* ------------------------------ a resposta (feita pelo código) ------------------------------ */

const dataBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const diasDesde = (d) => (d ? Math.floor((Date.now() - Date.parse(d)) / 864e5) : null);
const gb = (x) => `${Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
// NVIDIA: o Windows mostra 32.0.15.6094; o número que a NVIDIA usa é 560.94 (os 5 últimos dígitos)
function versaoNvidia(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 5 ? `${d.slice(-5, -2)}.${d.slice(-2)}` : null;
}
const AUDIO_DEDICADO = /sound ?blaster|creative|focusrite|behringer|presonus|steinberg|motu|asus xonar|xonar|audient|universal audio|fiio|topping|schiit|evo ?\d|scarlett|g6\b|maono|fifine|elgato wave/i;
const AUDIO_VIRTUAL = /virtual|steam streaming|nvidia high definition|amd high definition|hdmi|displayport|voicemeeter|vb-audio|discord|oculus|meta|nahimic|sonic|parsec|wave link/i;

function blocosDaResposta(ids, r) {
  const b = [];
  const avisos = [];
  const ofertas = [];
  if (r.sistema) {
    const s = r.sistema;
    const pentes = s.pentes.length ? `${s.pentes.length} pente(s): ${s.pentes.map((p) => `${p.gb} GB${p.mhz ? ` a ${p.mhz} MHz` : ''}`).join(' + ')}` : '';
    const horas = s.ligadoDesde ? Math.round((Date.now() - Date.parse(s.ligadoDesde)) / 36e5) : null;
    b.push(['**Configuração**', '| Item | Do seu PC |', '| --- | --- |', `| Processador | ${s.cpu} (${s.nucleos} núcleos, ${s.threads} threads) |`, `| Memória RAM | ${gb(s.ramGB)} (${gb(s.ramLivreGB)} livres agora)${pentes ? ` — ${pentes}` : ''} |`, `| Placa-mãe | ${s.placaMae || '—'} |`, `| BIOS | ${s.bios || '—'}${s.biosData ? ` (${dataBr(s.biosData)})` : ''} |`, `| Sistema | ${s.windows} |`, ...(horas !== null ? [`| Ligado há | ${horas < 48 ? `${horas} hora${horas === 1 ? '' : 's'}` : `${Math.round(horas / 24)} dias`} |`] : [])].join('\n'));
    if (horas !== null && horas > 24 * 14) avisos.push(`o PC está ligado há ${Math.round(horas / 24)} dias sem reiniciar — reiniciar de vez em quando aplica atualizações e libera memória`);
  }
  if (r.unidades || r.discos) {
    const un = (r.unidades || []).map((u) => `| ${u.letra} ${u.nome ? `(${u.nome})` : ''} | ${gb(u.livreGB)} livres de ${gb(u.totalGB)} | ${Math.round((u.livreGB / u.totalGB) * 100)}% livre |`);
    const ds = (r.discos || []).map((d) => `| ${d.modelo} | ${/ssd/i.test(d.tipo) ? 'SSD' : /hdd/i.test(d.tipo) ? 'HD' : d.tipo || '—'}${/nvme/i.test(d.barramento) ? ' NVMe' : ''} | ${gb(d.tamanhoGB)} | ${/healthy|íntegro/i.test(d.saude) ? 'boa' : d.saude || '—'} |`);
    b.push([`**Espaço nas unidades**`, '| Unidade | Espaço | Livre |', '| --- | --- | --- |', ...un, '', `**Discos físicos: ${(r.discos || []).length}**`, '| Disco | Tipo | Tamanho | Saúde |', '| --- | --- | --- | --- |', ...ds].join('\n'));
    for (const u of r.unidades || []) if (u.totalGB && u.livreGB / u.totalGB < 0.1) avisos.push(`a unidade ${u.letra} está com menos de 10% livre (${gb(u.livreGB)}) — o Windows fica lento e as atualizações podem falhar`);
    for (const d of r.discos || []) if (d.saude && !/healthy|íntegro|ok/i.test(d.saude)) avisos.push(`o disco ${d.modelo} está com saúde "${d.saude}" — faça backup do que é importante`);
  }
  if (r.windows) {
    const w = r.windows;
    const ultima = w.ultimas[0];
    const linhas = ['**Windows**', '| Item | Situação |', '| --- | --- |', `| Versão | ${w.nome} ${w.versao || ''} (build ${w.build}) |`, `| Última atualização instalada | ${ultima ? `${ultima.id} em ${dataBr(ultima.em)}` : '—'} |`];
    if (r.pendentes !== undefined) linhas.push(`| Atualizações pendentes | ${r.pendentes === null ? 'não consegui consultar o Windows Update' : r.pendentes.length ? `**${r.pendentes.length}**: ${r.pendentes.slice(0, 4).map((p) => p.titulo).join('; ')}${r.pendentes.length > 4 ? '…' : ''}` : 'nenhuma — está em dia'} |`);
    b.push(linhas.join('\n'));
    if (r.pendentes?.length) avisos.push(`há ${r.pendentes.length} atualização(ões) esperando: instale em Configurações → Windows Update (o AuGPT só consulta, não instala)`);
    else if (ultima && diasDesde(ultima.em) > 60) avisos.push(`a última atualização instalada é de ${dataBr(ultima.em)} (mais de 2 meses)`);
  }
  if (r.video) {
    const linhas = ['**Placa de vídeo**', '| Placa | Memória | Driver | Data do driver | Tela |', '| --- | --- | --- | --- | --- |'];
    for (const v of r.video) {
      const g = (r.gpus || []).find((x) => String(x.nome || '').toLowerCase().includes(String(v.nome).toLowerCase().replace(/^nvidia /, '').slice(0, 12)) || String(v.nome).toLowerCase().includes(String(x.nome || '').toLowerCase().slice(0, 12)));
      const nv = /nvidia|geforce|rtx|gtx/i.test(v.nome) ? versaoNvidia(v.driver) : null;
      linhas.push(`| ${v.nome} | ${g?.vramGB ? gb(g.vramGB) : '—'} | ${nv ? `${nv} (${v.driver})` : v.driver || '—'} | ${dataBr(v.data)} | ${v.resolucao} ${v.hz ? `@ ${v.hz} Hz` : ''} |`);
      const dias = diasDesde(v.data);
      if (dias !== null && dias > 90 && /nvidia|geforce|radeon|amd|intel arc/i.test(v.nome)) {
        avisos.push(`o driver da ${v.nome} é de ${dataBr(v.data)} (${Math.round(dias / 30)} meses): provavelmente há versão mais nova`);
        ofertas.push(`a versão mais nova do driver da ${v.nome} (a instalada é a ${nv || v.driver}, de ${dataBr(v.data)})`);
      }
    }
    b.push(linhas.join('\n'));
  }
  if (r.perifericos || r.monitores) {
    const linhas = ['**Periféricos**', '| Aparelho | Nome (o que ele informa) |', '| --- | --- |'];
    // fabricante genérico do Windows ("(Standard USB Host Controller)", "Microsoft") não diz nada
    const generico = (f) => !f || /^\(|standard|microsoft|generic|gen[ée]ric|padr[ãa]o/i.test(f);
    for (const p of r.perifericos || []) linhas.push(`| ${p.tipo === 'Mouse' ? 'Mouse' : 'Teclado'}${p.bluetooth ? ' (Bluetooth)' : ''} | ${p.nome || 'não informa o nome'}${!generico(p.fabricante) ? ` — ${p.fabricante}` : ''} |`);
    for (const m of r.monitores || []) linhas.push(`| Monitor | ${[MARCA_DO_MONITOR[m.fabricante] || m.fabricante, m.modelo].filter(Boolean).join(' ')} |`);
    for (const c of r.cameras || []) linhas.push(`| Câmera | ${c} |`);
    for (const n of r.bluetooth || []) linhas.push(`| Bluetooth | ${n} |`);
    b.push(linhas.join('\n'));
  }
  if (r.audio) {
    const reais = r.audio.filter((a) => !AUDIO_VIRTUAL.test(`${a.nome} ${a.fabricante}`));
    const dedicada = reais.filter((a) => AUDIO_DEDICADO.test(`${a.nome} ${a.fabricante}`));
    b.push(['**Áudio**', '| Dispositivo | Fabricante | O que é |', '| --- | --- | --- |', ...r.audio.map((a) => `| ${a.nome} | ${a.fabricante || '—'} | ${AUDIO_DEDICADO.test(`${a.nome} ${a.fabricante}`) ? '**placa de som dedicada**' : AUDIO_VIRTUAL.test(`${a.nome} ${a.fabricante}`) ? 'virtual / da placa de vídeo (HDMI)' : /usb/i.test(a.nome) ? 'áudio USB (fone, headset ou DAC)' : 'áudio da placa-mãe'} |`), '', dedicada.length ? `Sim, tem placa de som dedicada: **${dedicada.map((a) => a.nome).join(', ')}**.` : 'Não há placa de som dedicada: o som sai pelo áudio da placa-mãe (ou de um fone USB).'].join('\n'));
  }
  if (r.arquivos) {
    const a = r.arquivos;
    const NOMES = { fotos: 'Fotos', videos: 'Vídeos', musicas: 'Músicas', documentos: 'Documentos' };
    const linhas = [`**Arquivos${a.discoTodo ? ' (todas as unidades)' : ' (pastas do usuário)'}**`, '| Tipo | Quantos | Espaço | Onde mais tem |', '| --- | --- | --- | --- |'];
    for (const [k, nome] of Object.entries(NOMES)) {
      const x = a[k];
      linhas.push(`| ${nome} | **${x.n.toLocaleString('pt-BR')}** | ${gb(x.gb)} | ${x.pastas.slice(0, 3).map((p) => `${p.dir.replace(os.homedir(), '~')} (${p.n})`).join('; ') || '—'} |`);
    }
    linhas.push('', `*Contei sem abrir nenhum arquivo, em ${a.segundos} s${a.parcial ? ' — **contagem parcial**: parei no limite de tempo' : ''}.${a.discoTodo ? '' : ' Para incluir as outras unidades, pergunte "no PC todo".'}*`);
    b.push(linhas.join('\n'));
  }
  if (r.programas) b.push(`**Programas instalados: ${r.programas.length}**`);
  if (r.inicializacao) b.push(['**Abrem junto com o Windows**', ...(r.inicializacao.length ? r.inicializacao.map((p) => `- ${p.nome}`) : ['- nenhum programa encontrado'])].join('\n'));
  if (r.bateria) b.push(r.bateria.length ? `**Bateria:** ${r.bateria.map((x) => `${x.carga}%`).join(', ')}` : '**Bateria:** este PC não tem bateria (é um desktop).');
  return { blocos: b, avisos, ofertas };
}

const MARCA_DO_MONITOR = { BNQ: 'BenQ', AUS: 'ASUS', ACR: 'Acer', AOC: 'AOC', DEL: 'Dell', GSM: 'LG', SAM: 'Samsung', SNY: 'Sony', LEN: 'Lenovo', HPN: 'HP', HWP: 'HP', MSI: 'MSI', PHL: 'Philips', VSC: 'ViewSonic', GBT: 'Gigabyte', AOP: 'AOpen', LGD: 'LG', BOE: 'BOE', AUO: 'AU Optronics', CMN: 'Innolux', SHP: 'Sharp', IVM: 'Iiyama', ENC: 'Eizo', XMI: 'Xiaomi' };

/** "tenho o Discord instalado?": os programas cujo nome bate com o que foi perguntado. */
function programasDaPergunta(texto, programas = []) {
  const t = norm(texto).replace(/\b(tenho|o|a|os|as|meu|minha|pc|computador|instalad[oa]s?|programas?|aplicativos?|no|na|esta|e|qual|quais|versao|do|da|de)\b/g, ' ');
  const palavras = t.split(/[^a-z0-9.+#-]+/).filter((w) => w.length >= 3);
  if (!palavras.length) return null;
  return programas.filter((p) => palavras.some((w) => norm(p.nome).includes(w)));
}

module.exports = { pedidoDeLeituraLivre, consultar, consultasDoPedido, blocosDaResposta, contarArquivos, versaoNvidia, programasDaPergunta, PS };
