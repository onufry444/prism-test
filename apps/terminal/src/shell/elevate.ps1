# Prism: run one command with administrator rights.
#   dot-sourced by the PowerShell profile (defines __prism_elevate)
#   run by cmd and bash `sudo`:  powershell -File elevate.ps1 -Kind cmd   (the command is in $env:PRISM_SUDO)
# Inside Prism the command runs in the same tab (or a new admin window, see Settings > Administrator).
# Outside Prism it opens an administrator PowerShell window.
param([string]$Kind = '')

function global:__prism_elevate([string]$Kind, [string]$Command) {
  if (-not $Command -or -not $Command.Trim()) { Write-Host 'usage: sudo COMMAND [ARGS...]'; $global:LASTEXITCODE = 2; return }
  if ($env:PRISM_ELEVATED -eq '1') {
    # Prism itself runs as administrator: nothing to ask for
    if ($Kind -eq 'cmd') { & cmd.exe /d /c $Command } else { Invoke-Expression $Command }
    return
  }
  if (-not ($env:PRISM_INBOX -and $env:PRISM_TAB -and $env:PRISM_RESULTS -and (Test-Path -LiteralPath $env:PRISM_INBOX))) {
    $shell = (Get-Process -Id $PID).Path
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
    try { Start-Process -FilePath $shell -Verb RunAs -WorkingDirectory (Get-Location).ProviderPath -ArgumentList '-NoExit', '-EncodedCommand', $enc; $global:LASTEXITCODE = 0 }
    catch { Write-Host 'Cancelled: Windows did not give administrator rights.' -ForegroundColor Yellow; $global:LASTEXITCODE = 1223 }
    return
  }
  $id = [guid]::NewGuid().ToString('N')
  $cwd = (Get-Location).ProviderPath
  if (-not $cwd) { $cwd = $HOME }
  $req = [ordered]@{ id = $id; tab = $env:PRISM_TAB; kind = $Kind; cmd = $Command; cwd = $cwd } | ConvertTo-Json -Compress
  $msg = 'elevate;' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($req))
  [IO.File]::WriteAllText((Join-Path $env:PRISM_INBOX ('elev-{0}.msg' -f $id)), "$msg`n")
  # Prism shows the command's output in this tab and sends your keys to it; wait here until it reports back
  $res = Join-Path $env:PRISM_RESULTS "$id.json"
  $n = 0
  while (-not (Test-Path -LiteralPath $res)) {
    Start-Sleep -Milliseconds 100
    if ((++$n % 30) -eq 0 -and $env:PRISM_PID -and -not (Get-Process -Id $env:PRISM_PID -ErrorAction SilentlyContinue)) { $global:LASTEXITCODE = 1; return }
  }
  $r = $null
  for ($i = 0; $i -lt 20 -and -not $r; $i++) { try { $r = [IO.File]::ReadAllText($res) | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 50 } }
  Remove-Item -LiteralPath $res -Force -ErrorAction SilentlyContinue
  if (-not $r) { $global:LASTEXITCODE = 1; return }
  if ($r.message) { Write-Host $r.message -ForegroundColor $(if ($r.cancelled) { 'Yellow' } else { 'DarkGray' }) }
  $global:LASTEXITCODE = [int]$r.code
}

if ($Kind -and $MyInvocation.InvocationName -ne '.') {
  $cmd = $env:PRISM_SUDO
  Remove-Item Env:PRISM_SUDO -ErrorAction SilentlyContinue
  __prism_elevate $Kind $cmd
  exit $global:LASTEXITCODE
}
