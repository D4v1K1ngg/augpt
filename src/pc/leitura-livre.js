'use strict';

/**
 * Leitura livre do PC (19/10, pedido do Davi): para o que as consultas fixas do
 * inspetor não cobrem ("meu chipset está atualizado?", "veja as políticas de
 * grupo", "o que tem no Run do registro?"), o modelo pesquisa como ler e escreve
 * o comando de PowerShell — e este módulo só deixa rodar o que é LEITURA.
 *
 * A trava não confia no texto: o próprio PowerShell analisa o script (AST) e
 * cada comando, método e redirecionamento passa por uma lista fechada:
 *  - cmdlets Get-* (menos Get-Credential) e os de filtrar e formatar
 *    (Select/Where/Sort/Group/Measure/Format/ConvertTo-Json…);
 *  - ForEach-Object só com bloco de código (-MemberName chamaria um método);
 *  - programas do Windows só no modo de consulta (reg query, gpresult /r,
 *    powercfg /list, sc query, schtasks /query, wevtutil qe, pnputil /enum-…);
 *  - métodos só os de texto, número e data (.Delete(), ::Start() ficam de fora);
 *  - versão fechada (decisão do Davi): conteúdo de arquivo não se lê (Get-Content,
 *    Select-String, ${C:\arquivo}, [IO.File]::ReadAllText) nem a área de transferência —
 *    registro, drivers, dispositivos, rede, serviços, políticas e eventos, sim;
 *  - sem & e . (rodar texto como código), sem gravar em arquivo, sem função nova,
 *    sem atribuir a nada além de variável simples, sem -ComputerName/-Credential.
 * Depois de aprovado, roda em ConstrainedLanguage, sem administrador, com tempo
 * e tamanho de saída limitados. Nada sai do computador.
 */

const { execFile } = require('child_process');

const VALIDAR_E_RODAR = String.raw`
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$src = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AUGPT_LEITURA))
$tokens = $null; $erros = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$erros)
$motivos = New-Object System.Collections.Generic.List[string]
if ($erros.Count) { $motivos.Add('erro de sintaxe: ' + $erros[0].Message) }
$cmdlets = 'Select-Object','Where-Object','ForEach-Object','Sort-Object','Group-Object','Measure-Object','Format-Table','Format-List','Format-Wide','Out-String','ConvertTo-Json','ConvertTo-Csv','ConvertFrom-Json','ConvertFrom-Csv','ConvertFrom-StringData','Test-Path','Resolve-Path','Split-Path','Join-Path','Compare-Object','Write-Output','Out-Null'
$negados = 'Get-Credential','Get-Content','Get-Clipboard','Get-Secret','Get-StoredCredential','Get-PfxCertificate','Get-PfxData'
$metodos = 'ToString','Trim','TrimStart','TrimEnd','Split','Replace','Substring','ToLower','ToUpper','ToLowerInvariant','ToUpperInvariant','StartsWith','EndsWith','Contains','IndexOf','LastIndexOf','PadLeft','PadRight','Round','Floor','Ceiling','Abs','Max','Min','Truncate','ToShortDateString','ToLongDateString','ToShortTimeString','AddDays','AddHours','AddMinutes','AddSeconds','Subtract','GetValue','GetValueNames','GetSubKeyNames','OpenSubKey','Equals','CompareTo','Format','Join','Parse','TryParse','ParseExact','GetType','FromFileTime','ToDateTime','Where','ForEach','ToInt32','ToInt64','ToDouble','IsNullOrEmpty','IsNullOrWhiteSpace','Normalize','GetBytes','ToBase64String','Matches','Match','IsMatch','ToArray'
$paramsNegados = 'ComputerName','CimSession','Session','Credential','PSSession','OutFile','FilePath','LiteralPath_out'
function Nativo($nome, $args0) {
  $a = @($args0 | ForEach-Object { "$_".ToLower() })
  $p = if ($a.Count) { $a[0] } else { '' }
  $remoto = @($a | Where-Object { $_ -in '/s','/u','/p','/node' }).Count -gt 0
  switch ($nome) {
    'reg' { return $p -eq 'query' }
    'gpresult' { return -not $remoto -and @($a | Where-Object { $_ -in '/h','/x','/f' }).Count -eq 0 }
    'driverquery' { return -not $remoto }
    'systeminfo' { return -not $remoto }
    'tasklist' { return -not $remoto }
    'whoami' { return $true }
    'hostname' { return $true }
    'ipconfig' { return @($a | Where-Object { $_ -notin '/all','/displaydns','/allcompartments' }).Count -eq 0 }
    'powercfg' { return $p -in '/l','/list','/q','/query','/a','/availablesleepstates','/getactivescheme','/devicequery','/lastwake','/aliases' }
    'auditpol' { return $p -eq '/get' }
    'netsh' { return ($a -contains 'show') -and @($a | Where-Object { $_ -in 'set','add','delete','reset','start','stop','import','export','connect','disconnect','install','uninstall','dump' }).Count -eq 0 }
    'pnputil' { return $p -like '/enum-*' }
    'sc' { return $p -in 'query','queryex','qc','qdescription','qfailure','qtriggerinfo','getdisplayname','getkeyname','enumdepend' }
    'schtasks' { return $p -eq '/query' -and -not $remoto }
    'wevtutil' { return $p -in 'qe','query-events','gl','get-log','el','enum-logs','gp','get-publisher','ep','enum-publishers' }
    'w32tm' { return $p -eq '/query' }
    'bcdedit' { return $p -eq '/enum' }
    'manage-bde' { return $p -eq '-status' }
    'vssadmin' { return $p -eq 'list' }
    'query' { return $p -in 'user','session' }
    'quser' { return $true }
    'arp' { return $p -eq '-a' }
    'route' { return $p -eq 'print' }
    'netstat' { return $true }
    'nvidia-smi' { return @($a | Where-Object { $_ -notlike '--query*' -and $_ -notlike '--format*' -and $_ -notin '-q','-l','--list-gpus' }).Count -eq 0 }
    'wmic' { return -not $remoto -and @($a | Where-Object { $_ -in 'call','delete','create','set' }).Count -eq 0 }
  }
  return $false
}
if (-not $motivos.Count) {
  foreach ($n in $ast.FindAll({ $true }, $true)) {
    switch ($n.GetType().Name) {
      'CommandAst' {
        if ($n.InvocationOperator -ne 'Unknown') { $motivos.Add('& e . (rodar texto como código) não são permitidos'); break }
        $nome = $n.GetCommandName()
        if (-not $nome) { $motivos.Add('comando montado em tempo de execução'); break }
        $c = Get-Command ([System.Management.Automation.WildcardPattern]::Escape($nome)) -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c -and $c.CommandType -eq 'Alias') { $c = $c.ResolvedCommand }
        if (-not $c) { $motivos.Add("comando desconhecido: $nome"); break }
        $resto = @($n.CommandElements | Select-Object -Skip 1)
        if ($c.CommandType -eq 'Application') {
          $base = [IO.Path]::GetFileNameWithoutExtension($c.Name).ToLower()
          $valores = @()
          foreach ($e in $resto) {
            if ($e -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $valores += $e.Value }
            elseif ($e -is [System.Management.Automation.Language.CommandParameterAst]) { $valores += $e.Extent.Text }
            else { $valores = $null; break }
          }
          if ($null -eq $valores) { $motivos.Add("$base com argumento variável"); break }
          if (-not (Nativo $base $valores)) { $motivos.Add("$base $($valores -join ' ') não é uma consulta de leitura permitida") }
          break
        }
        if ($c.CommandType -notin 'Cmdlet','Function') { $motivos.Add("$nome não é permitido"); break }
        $cn = $c.Name
        if ($cn -in $negados) { $motivos.Add("$cn fica de fora: conteúdo de arquivo, senha e área de transferência não são lidos"); break }
        if (-not (($cn -like 'Get-*') -or ($cn -in $cmdlets))) { $motivos.Add("$cn não é de leitura"); break }
        foreach ($e in $resto) {
          if ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -in $paramsNegados) { $motivos.Add("-$($e.ParameterName) não é permitido") }
        }
        if ($cn -eq 'ForEach-Object') {
          foreach ($e in $resto) {
            $ok = ($e -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) -or ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -in 'Begin','Process','End')
            if (-not $ok) { $motivos.Add('ForEach-Object só com bloco { }'); break }
          }
        }
      }
      'InvokeMemberExpressionAst' {
        $m = $n.Member
        if ($m -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { $motivos.Add('método montado em tempo de execução'); break }
        if ($m.Value -notin $metodos) { $motivos.Add("o método .$($m.Value)() não é permitido") }
      }
      'FileRedirectionAst' { if ($n.Location.Extent.Text -ne '$null') { $motivos.Add('gravar em arquivo não é permitido') } }
      'AssignmentStatementAst' {
        $l = $n.Left
        if ($l -is [System.Management.Automation.Language.ConvertExpressionAst]) { $l = $l.Child }
        if ($l -isnot [System.Management.Automation.Language.VariableExpressionAst] -or $l.VariablePath.DriveName -or $l.VariablePath.UserPath -in 'ExecutionContext','Host','PSDefaultParameterValues','ErrorActionPreference','ConfirmPreference','env') { $motivos.Add('só dá para guardar em variável simples') }
      }
      'VariableExpressionAst' { if ($n.VariablePath.DriveName -and $n.VariablePath.DriveName -notin 'env','variable') { $motivos.Add('ler arquivo pelo caminho não é permitido') } }
      'FunctionDefinitionAst' { $motivos.Add('definir função não é permitido') }
      'UsingStatementAst' { $motivos.Add('using não é permitido') }
      'TypeDefinitionAst' { $motivos.Add('definir classe não é permitido') }
    }
  }
}
if ($motivos.Count) { 'AUGPT-RECUSADO:' + (@($motivos | Select-Object -Unique) -join ' | '); exit }
'AUGPT-APROVADO'
# o script do modelo roda já em ConstrainedLanguage (criado depois da troca: um bloco
# criado antes manteria a linguagem completa)
$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'
try { Invoke-Expression $src 2>&1 | Out-String -Width 220 } catch { 'ERRO: ' + $_.Exception.Message }
`;

const LIMITE_SAIDA = 6000;

const comPowerShell = (script, env, timeout) =>
  new Promise((ok) => {
    const codificado = Buffer.from(VALIDAR_E_RODAR, 'utf16le').toString('base64');
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado], { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } }, (err, saida) =>
      ok({ saida: String(saida || ''), tempoEsgotado: !!(err && err.killed) })
    );
  });

/**
 * Valida e roda um script de leitura → { ok, recusado, motivo, saida, cortada }.
 * deps.executar(script, env, timeout) substitui o PowerShell na bancada.
 */
async function lerComComando(script, { timeout = 45000, deps = {} } = {}) {
  if (process.platform !== 'win32' && !deps.executar) return { ok: false, motivo: 'a leitura livre só existe no Windows, por enquanto' };
  const texto = String(script || '').trim();
  if (!texto) return { ok: false, motivo: 'comando vazio' };
  if (texto.length > 4000) return { ok: false, recusado: true, motivo: 'comando grande demais' };
  const env = { AUGPT_LEITURA: Buffer.from(texto, 'utf8').toString('base64') };
  const r = await (deps.executar || comPowerShell)(texto, env, timeout);
  const linhas = r.saida.replace(/\r/g, '');
  const recusa = linhas.match(/^AUGPT-RECUSADO:(.*)$/m);
  if (recusa) return { ok: false, recusado: true, motivo: recusa[1].trim() };
  const i = linhas.indexOf('AUGPT-APROVADO');
  if (i < 0) return { ok: false, motivo: r.tempoEsgotado ? 'tempo esgotado' : 'o PowerShell não respondeu' };
  const saida = linhas.slice(i + 'AUGPT-APROVADO'.length).replace(/\n{3,}/g, '\n\n').trim();
  if (r.tempoEsgotado) return { ok: !!saida, motivo: 'tempo esgotado', saida: saida.slice(0, LIMITE_SAIDA), cortada: true };
  return { ok: true, saida: saida.slice(0, LIMITE_SAIDA), cortada: saida.length > LIMITE_SAIDA };
}

module.exports = { lerComComando, VALIDAR_E_RODAR };
