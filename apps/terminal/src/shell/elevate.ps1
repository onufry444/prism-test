# Prism: requests a shell makes to the Prism app, and waits for the answer.
#   sudo   run one command with administrator rights, in the same tab (or a new admin window)
#   toys   fetch, lava, matrix, pipes, donut, clock, visualizer: Prism draws them in the tab
# Dot-sourced by the PowerShell profile. cmd and bash run it as a script:
#   powershell -File elevate.ps1 -Kind cmd           (sudo; the command is in $env:PRISM_SUDO)
#   powershell -File elevate.ps1 -Toy lava [args]
param([string]$Kind = '', [string]$Toy = '', [Parameter(ValueFromRemainingArguments = $true)][string[]]$ToyArgs = @())

$global:__PrismInPrism = { [bool]($env:PRISM_INBOX -and $env:PRISM_TAB -and $env:PRISM_RESULTS -and (Test-Path -LiteralPath $env:PRISM_INBOX)) }
# Sends "<type>;<json>" to Prism and waits until Prism writes the answer (Prism owns the tab meanwhile).
function global:__prism_call([string]$Type, [System.Collections.IDictionary]$Fields) {
  $id = [guid]::NewGuid().ToString('N')
  $req = [ordered]@{ id = $id; tab = $env:PRISM_TAB }
  foreach ($k in $Fields.Keys) { $req[$k] = $Fields[$k] }
  $msg = $Type + ';' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($req | ConvertTo-Json -Compress)))
  [IO.File]::WriteAllText((Join-Path $env:PRISM_INBOX ('{0}-{1}.msg' -f $Type, $id)), "$msg`n")
  $res = Join-Path $env:PRISM_RESULTS "$id.json"
  $n = 0
  while (-not (Test-Path -LiteralPath $res)) {
    Start-Sleep -Milliseconds 100
    if ((++$n % 30) -eq 0 -and $env:PRISM_PID -and -not (Get-Process -Id $env:PRISM_PID -ErrorAction SilentlyContinue)) { return $null }
  }
  $r = $null
  for ($i = 0; $i -lt 20 -and -not $r; $i++) { try { $r = [IO.File]::ReadAllText($res, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 50 } }
  Remove-Item -LiteralPath $res -Force -ErrorAction SilentlyContinue
  return $r
}
function global:__prism_toy([string]$Name, [string[]]$Rest) {
  if (-not (& $global:__PrismInPrism)) { Write-Host "$Name runs inside Prism. Open Prism and try it there."; $global:LASTEXITCODE = 1; return }
  $r = __prism_call 'toy' ([ordered]@{ name = $Name; args = @($Rest) })
  if ($r -and $r.text) { [Console]::Write($r.text) }
  $global:LASTEXITCODE = if ($r) { [int]$r.code } else { 1 }
}

function global:__prism_elevate([string]$Kind, [string]$Command) {
  if (-not $Command -or -not $Command.Trim()) { Write-Host 'usage: sudo COMMAND [ARGS...]'; $global:LASTEXITCODE = 2; return }
  if ($env:PRISM_ELEVATED -eq '1') {
    # Prism itself runs as administrator: nothing to ask for
    if ($Kind -eq 'cmd') { & cmd.exe /d /c $Command } else { Invoke-Expression $Command }
    return
  }
  if (-not (& $global:__PrismInPrism)) {
    $shell = (Get-Process -Id $PID).Path
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
    try { Start-Process -FilePath $shell -Verb RunAs -WorkingDirectory (Get-Location).ProviderPath -ArgumentList '-NoExit', '-EncodedCommand', $enc; $global:LASTEXITCODE = 0 }
    catch { Write-Host 'Cancelled: Windows did not give administrator rights.' -ForegroundColor Yellow; $global:LASTEXITCODE = 1223 }
    return
  }
  $cwd = (Get-Location).ProviderPath
  if (-not $cwd) { $cwd = $HOME }
  # Prism shows the command's output in this tab and sends your keys to it; wait here until it reports back
  $r = __prism_call 'elevate' ([ordered]@{ kind = $Kind; cmd = $Command; cwd = $cwd })
  if (-not $r) { $global:LASTEXITCODE = 1; return }
  if ($r.message) { Write-Host $r.message -ForegroundColor $(if ($r.cancelled) { 'Yellow' } else { 'DarkGray' }) }
  $global:LASTEXITCODE = [int]$r.code
}

if ($Toy -and $MyInvocation.InvocationName -ne '.') {
  __prism_toy $Toy $ToyArgs
  exit $global:LASTEXITCODE
}
if ($Kind -and $MyInvocation.InvocationName -ne '.') {
  $cmd = $env:PRISM_SUDO
  Remove-Item Env:PRISM_SUDO -ErrorAction SilentlyContinue
  __prism_elevate $Kind $cmd
  exit $global:LASTEXITCODE
}
